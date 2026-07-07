import { useState, useEffect, useCallback, useRef } from "react";
import { Button, ButtonGroup, Dropdown, Spinner, Alert } from "react-bootstrap";
import Navbar from "react-bootstrap/Navbar";
import { FaChevronRight, FaChevronLeft } from "react-icons/fa6";
import { AiOutlineDownload } from "react-icons/ai";
import { BsPencil, BsEye } from "react-icons/bs";
import JSZip from "jszip";
import { parse, renderToSvg } from "remarkable-rm";
import apiservice from "../../services/api.service";
import NameTag from "../../components/NameTag";
import RmdocEditor from "./RmdocEditor";
import { buildRmdoc } from "./rmBinaryWriter";

export default function RmdocViewer({ file, onSelect }) {
  const { data } = file;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pages, setPages] = useState([]);
  const [contentJson, setContentJson] = useState(null);
  const [page, setPage] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [modified, setModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const pageDataRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiservice
      .download(data.id, "rmdoc")
      .then(async (blob) => {
        if (cancelled) return;
        const arrayBuf = await blob.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuf);

        const contentFile = Object.keys(zip.files).find((f) =>
          f.endsWith(".content")
        );
        if (!contentFile) throw new Error("No .content file in archive");

        const contentStr = await zip.files[contentFile].async("string");
        const content = JSON.parse(contentStr);
        if (cancelled) return;
        setContentJson(content);

        const parsedPages = [];

        let pageUuids = content.pages || [];

        if (pageUuids.length === 0) {
          const allFiles = Object.keys(zip.files);
          const rmFiles = allFiles.filter((f) => {
            const base = f.split("/").pop();
            return base.endsWith(".rm") && !base.startsWith(".");
          });
          pageUuids = rmFiles.map((f) => {
            const base = f.split("/").pop();
            return base.replace(/\.rm$/, "");
          });
        }

        for (const uuid of pageUuids) {
          const rmEntry = Object.keys(zip.files).find((f) => {
            const base = f.split("/").pop();
            return base === uuid + ".rm" || base === uuid;
          });

          if (rmEntry && zip.files[rmEntry]) {
            const data = await zip.files[rmEntry].async("uint8array");
            try {
              const doc = parse(data);
              parsedPages.push({ uuid, doc, data, error: null });
            } catch (e) {
              parsedPages.push({ uuid, doc: null, data, error: e.message });
            }
          } else {
            parsedPages.push({ uuid, doc: null, data: null, error: "No .rm file" });
          }
        }

        if (cancelled) return;
        setPages(parsedPages);
        pageDataRef.current = { zip, contentFile, content, zipFiles: Object.keys(zip.files) };
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || "Failed to load rmdoc");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data.id]);

  const renderPage = useCallback(
    (pageIndex) => {
      if (pageIndex < 0 || pageIndex >= pages.length) return "";
      const p = pages[pageIndex];
      if (!p || !p.doc) return "";
      try {
        return renderToSvg(p.doc);
      } catch {
        return "";
      }
    },
    [pages]
  );

  const onPrev = () => setPage((p) => Math.max(p - 1, 0));
  const onNext = () => setPage((p) => Math.min(p + 1, pages.length - 1));

  const triggerDownload = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onDownloadPdf = () => {
    apiservice
      .download(data.id)
      .then((blob) => triggerDownload(blob, data.name + ".pdf"));
  };

  const onDownloadRmdoc = () => {
    apiservice
      .download(data.id, "rmdoc")
      .then((blob) => triggerDownload(blob, data.name + ".rmdoc"));
  };

  const onSaveRmdoc = async () => {
    if (!modified) return;
    setSaving(true);
    try {
      const { zip, contentFile, content, zipFiles } = pageDataRef.current;
      const updatedZip = await buildRmdoc(pages, content, zip, zipFiles);
      const blob = await updatedZip.generateAsync({ type: "blob" });
      await apiservice.uploadRmdoc(data.id, blob, data.name + ".rmdoc");
      setModified(false);
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const onStrokeChange = (pageIndex, newDoc) => {
    setPages((prev) => {
      const next = [...prev];
      next[pageIndex] = { ...next[pageIndex], doc: newDoc };
      return next;
    });
    setModified(true);
  };

  if (loading) {
    return (
      <div className="text-center p-5">
        <Spinner animation="border" /> <p>Loading rmdoc...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="danger" className="m-3">
        {error}
      </Alert>
    );
  }

  const svgHtml = renderPage(page);

  return (
    <>
      <Navbar style={{ marginLeft: "-12px" }}>
        {file && <NameTag node={file} onSelect={onSelect} />}
      </Navbar>

      <Navbar>
        {pages.length > 1 && (
          <div>
            <ButtonGroup aria-label="Page navigation">
              <Button size="sm" variant="outline-secondary" onClick={onPrev}>
                <FaChevronLeft />
              </Button>
              <Button size="sm" variant="outline-secondary" onClick={onNext}>
                <FaChevronRight />
              </Button>
            </ButtonGroup>
            <span style={{ margin: "0 10px" }}>
              Page: {page + 1} of {pages.length}
            </span>
          </div>
        )}
        <div style={{ flex: 1 }} />

        <Button
          size="sm"
          variant={editMode ? "outline-primary" : "outline-secondary"}
          onClick={() => setEditMode(!editMode)}
          className="me-2"
          title={editMode ? "Switch to view mode" : "Switch to edit mode"}
        >
          {editMode ? <BsEye /> : <BsPencil />}
        </Button>

        {modified && (
          <Button
            size="sm"
            variant="success"
            onClick={onSaveRmdoc}
            disabled={saving}
            className="me-2"
          >
            {saving ? <Spinner size="sm" animation="border" /> : "Save"}
          </Button>
        )}

        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="secondary">
            <AiOutlineDownload />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={onDownloadPdf}>Download PDF</Dropdown.Item>
            <Dropdown.Item onClick={onDownloadRmdoc}>
              Download .rmdoc
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </Navbar>

      <div style={{ height: "90%", overflow: "auto" }}>
        {editMode ? (
          <RmdocEditor
            pages={pages}
            currentPage={page}
            onStrokeChange={onStrokeChange}
          />
        ) : (
          <div
            dangerouslySetInnerHTML={{ __html: svgHtml }}
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "10px",
            }}
          />
        )}
      </div>
    </>
  );
}
