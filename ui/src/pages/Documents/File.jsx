import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { Button, ButtonGroup, Dropdown, Spinner } from "react-bootstrap";
import Navbar from 'react-bootstrap/Navbar';
import { FaChevronRight, FaChevronLeft, } from "react-icons/fa6";
import { AiOutlineDownload } from "react-icons/ai";
import { BsPencil } from "react-icons/bs";
import constants from "../../common/constants";

import apiservice from "../../services/api.service"
import NameTag from "../../components/NameTag"

import { pdfjs, Document, Page } from "react-pdf";

const RmdocViewer = lazy(() => import("./RmdocViewer"));


export default function FileViewer({ file, onSelect }) {
  const { data } = file;

  const downloadUrl = `${constants.ROOT_URL}/documents/${file.id}`;

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

  let options = useMemo(() => {
    return {
      worker: new pdfjs.PDFWorker()
    }
  }, [pdfjs])

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
          <Document file={downloadUrl} onLoadSuccess={onLoadSuccess} options={options}>
            <Page pageNumber={page}
              height={height}
              renderAnnotationLayer={false}
              renderTextLayer={false}
            />
          </Document>
        </div>
      )}
    </>
  );
}
