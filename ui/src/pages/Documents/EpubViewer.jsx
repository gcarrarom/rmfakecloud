import { useEffect, useState } from "react";
import { Alert, Button, ButtonGroup, Spinner } from "react-bootstrap";
import Navbar from "react-bootstrap/Navbar";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa6";
import apiservice from "../../services/api.service";
import NameTag from "../../components/NameTag";
import constants from "../../common/constants";
import styles from "./Documents.module.scss";

function parseXml(source) {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid EPUB metadata");
  return document;
}

function joinPath(...parts) {
  const result = [];
  for (const part of parts.join("/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}

function resourcePath(base, href) {
  return joinPath(base.substring(0, base.lastIndexOf("/") + 1), decodeURIComponent(href.split("#")[0]));
}

function resourceUrl(id, path) {
  return `${constants.ROOT_URL}/documents/${id}/epub/resource?path=${encodeURIComponent(path)}`;
}

function chapterHtml(id, chapterPath, source) {
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, iframe, object, embed").forEach((element) => element.remove());
  document.querySelectorAll("img[src]").forEach((image) => {
    image.src = resourceUrl(id, resourcePath(chapterPath, image.getAttribute("src")));
  });
  document.querySelectorAll("link[href]").forEach((link) => {
    link.href = resourceUrl(id, resourcePath(chapterPath, link.getAttribute("href")));
  });
  const body = document.body || document.documentElement;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 18px/1.65 system-ui, sans-serif; max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; color: #202124; }
    img { max-width: 100%; height: auto; } a { color: #1769aa; } h1,h2,h3 { line-height: 1.25; }
  </style></head><body>${body.innerHTML}</body></html>`;
}

async function textResource(id, path) {
  return (await apiservice.getEpubResource(id, path)).text();
}

async function loadChapters(id) {
  const container = parseXml(await textResource(id, "META-INF/container.xml"));
  const rootfile = container.querySelector("rootfile");
  if (!rootfile) throw new Error("EPUB package not found");
  const packagePath = rootfile.getAttribute("full-path");
  const opf = parseXml(await textResource(id, packagePath));
  const manifest = new Map();
  opf.querySelectorAll("manifest > item").forEach((item) => manifest.set(item.getAttribute("id"), {
    href: resourcePath(packagePath, item.getAttribute("href") || ""),
    title: item.getAttribute("title") || "",
  }));
  return Array.from(opf.querySelectorAll("spine > itemref"))
    .map((itemref) => manifest.get(itemref.getAttribute("idref")))
    .filter(Boolean);
}

export default function EpubViewer({ file, onSelect }) {
  const { data } = file;
  const [chapters, setChapters] = useState([]);
  const [chapter, setChapter] = useState(0);
  const [contents, setContents] = useState({});
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadChapters(data.id), apiservice.getReadingProgress(data.id)]).then(([book, progress]) => {
      if (cancelled) return;
      setChapters(book);
      setChapter(Math.min(Math.max((progress.currentPage || 1) - 1, 0), book.length - 1));
      setProgressLoaded(true);
      setLoading(false);
    }).catch((reason) => {
      if (!cancelled) {
        setError(reason.message || "Failed to load EPUB");
        setLoading(false);
        setProgressLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [data.id]);

  useEffect(() => {
    if (!chapters.length) return undefined;
    let cancelled = false;
    const indices = [chapter, chapter + 1, chapter - 1].filter((index) => index >= 0 && index < chapters.length);
    Promise.all(indices.map(async (index) => {
      if (contents[index]) return null;
      const source = await textResource(data.id, chapters[index].href);
      return [index, chapterHtml(data.id, chapters[index].href, source)];
    })).then((loaded) => {
      if (cancelled) return;
      setContents((current) => Object.fromEntries([
        ...Object.entries(current),
        ...loaded.filter(Boolean),
      ]));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [data.id, chapter, chapters.length]);

  useEffect(() => {
    if (!progressLoaded || !chapters.length) return undefined;
    const timeout = setTimeout(() => apiservice.updateReadingProgress(data.id, chapter + 1).catch(() => {}), 400);
    return () => clearTimeout(timeout);
  }, [data.id, chapter, chapters.length, progressLoaded]);

  if (loading) return <div className="text-center p-5"><Spinner animation="border" /> Loading EPUB...</div>;
  if (error) return <Alert variant="danger" className="m-3">{error}</Alert>;
  const current = chapters[chapter];
  return (
    <div className={styles.viewerShell}>
      <Navbar className={styles.breadcrumbBar}><NameTag node={file} onSelect={onSelect} /></Navbar>
      <Navbar className={styles.toolbar}>
        <div className={styles.pageStatus}>
          <ButtonGroup aria-label="Chapter navigation">
            <Button size="sm" variant="outline-secondary" disabled={chapter === 0} onClick={() => setChapter((value) => Math.max(value - 1, 0))}><FaChevronLeft /></Button>
            <Button size="sm" variant="outline-secondary" disabled={chapter === chapters.length - 1} onClick={() => setChapter((value) => Math.min(value + 1, chapters.length - 1))}><FaChevronRight /></Button>
          </ButtonGroup>
          <span style={{ margin: "0 10px" }}>Chapter {chapter + 1} of {chapters.length} ({Math.round(((chapter + 1) / chapters.length) * 100)}%)</span>
        </div>
      </Navbar>
      <div className={styles.viewerContent}>
        {contents[chapter] ? <iframe key={current.href} title={current.title || `Chapter ${chapter + 1}`} sandbox="allow-same-origin" srcDoc={contents[chapter]} style={{ width: "100%", height: "100%", minHeight: "32rem", border: 0 }} /> : <div className="text-center p-5"><Spinner animation="border" /> Loading chapter...</div>}
      </div>
    </div>
  );
}
