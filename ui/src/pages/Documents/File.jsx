import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Button, ButtonGroup, Dropdown, Spinner } from "react-bootstrap";
import Navbar from 'react-bootstrap/Navbar';
import { FaChevronRight, FaChevronLeft, } from "react-icons/fa6";
import { AiOutlineDownload } from "react-icons/ai";
import { BsPencil } from "react-icons/bs";
import constants from "../../common/constants";

import apiservice from "../../services/api.service"
import NameTag from "../../components/NameTag"

import { Document, Page } from "react-pdf";

const RmdocViewer = lazy(() => import("./RmdocViewer"));

function usePdfData(fileId) {
  const [pdfData, setPdfData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfData(null);

    const url = `${constants.ROOT_URL}/documents/${fileId}`;
    console.log("[File] Fetching PDF data from:", url);

    fetch(url, { credentials: 'include' })
      .then((response) => {
        console.log("[File] PDF fetch response:", response.status, response.headers.get('content-type'));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.arrayBuffer();
      })
      .then((data) => {
        if (!cancelled) {
          console.log("[File] PDF data loaded, size:", data.byteLength);
          setPdfData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[File] PDF fetch error:", err);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [fileId]);

  return { pdfData, error, loading };
}

export default function FileViewer({ file, onSelect }) {
  const { data } = file;

  const { pdfData, error: pdfError, loading: pdfLoading } = usePdfData(file.id);

  const [viewMode, setViewMode] = useState("pdf"); // "pdf" or "rmdoc"
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [height, setHeight] = useState(100);
  const onLoadSuccess = (pdf) => {
    setPage(1);
    setPages(pdf.numPages);
  };
  const onPrev = () => {
    setPage((p) => Math.max(p - 1, 1));
  };
  const onNext = () => {
    setPage((p) => Math.min(p + 1, pages));
  };
  const parent = useRef(null);
  useEffect(() => {
    const resizeObserver = new ResizeObserver((event) => {
      setHeight(event[0].contentBoxSize[0].blockSize);
    });
    if (parent.current) resizeObserver.observe(parent.current);
    return () => resizeObserver.disconnect();
  }, []);

  const triggerDownload = (blob, filename) => {
    var url = window.URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const onDownloadPdf = () => {
    apiservice.download(data.id)
      .then(blob => triggerDownload(blob, data.name + '.pdf'))
      .catch(() => {})
  }

  const onDownloadRmdoc = () => {
    apiservice.download(data.id, 'rmdoc')
      .then(blob => triggerDownload(blob, data.name + '.rmdoc'))
      .catch(() => {})
  }

  if (viewMode === "rmdoc") {
    return (
      <Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>
        <RmdocViewer file={file} onSelect={onSelect} />
      </Suspense>
    );
  }

  return (
    <>
      <Navbar style={{ marginLeft: '-12px' }}>
        {file && (<div><NameTag node={file} onSelect={onSelect} /></div>)}
      </Navbar>

      <Navbar>
        {pages > 1 && (
          <div>
            <ButtonGroup aria-label="Basic example">
              <Button size="sm" variant="outline-secondary" onClick={onPrev}><FaChevronLeft /></Button>
              <Button size="sm" variant="outline-secondary" onClick={onNext}><FaChevronRight /></Button>
            </ButtonGroup>
            <span style={{ margin: '0 10px' }}>
              Page: {page} of {pages}
            </span>
          </div>
        )}
        <div style={{ flex: 1 }}></div>

        <Button
          size="sm"
          variant="outline-info"
          onClick={() => setViewMode("rmdoc")}
          className="me-2"
          title="View & edit natively"
        >
          <BsPencil /> Native
        </Button>

        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="secondary">
            <AiOutlineDownload />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={onDownloadPdf}>Download PDF</Dropdown.Item>
            <Dropdown.Item onClick={onDownloadRmdoc}>Download .rmdoc</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

      </Navbar>


      {file && (
        <div ref={parent} style={{ height: "95%" }}>
          {pdfLoading && <div className="text-center p-5"><Spinner animation="border" /> Loading PDF…</div>}
          {pdfError && <div className="text-center p-5 text-danger">Failed to load PDF: {pdfError}</div>}
          {pdfData && (
            <Document
              file={pdfData}
              onLoadSuccess={onLoadSuccess}
              onLoadError={(error) => console.error("[File] PDF render error:", error)}
            >
              <Page pageNumber={page}
                height={height}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </Document>
          )}
        </div>
      )}
    </>
  );
}
