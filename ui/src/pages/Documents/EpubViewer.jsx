import { useEffect, useRef, useState } from "react";
import { Alert, Button, ButtonGroup, Form, Spinner } from "react-bootstrap";
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

function chapterHtml(id, chapterPath, source, settings) {
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, iframe, object, embed").forEach((element) => element.remove());
  document.querySelectorAll("img[src]").forEach((image) => {
    image.src = resourceUrl(id, resourcePath(chapterPath, image.getAttribute("src")));
  });
  document.querySelectorAll("link[href]").forEach((link) => {
    link.href = resourceUrl(id, resourcePath(chapterPath, link.getAttribute("href")));
  });
  const body = document.body || document.documentElement;
  const themes = {
    light: { background: "#ffffff", foreground: "#202124", link: "#1769aa" },
    dark: { background: "#202124", foreground: "#eeeeee", link: "#8ab4f8" },
    sepia: { background: "#f4ecd8", foreground: "#493b2a", link: "#76552b" },
  };
  const theme = themes[settings.theme];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *, *::before, *::after { box-sizing: border-box; }
    html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${theme.background}; }
    body { margin: 0; width: 100vw; height: 100vh; padding: 1rem; font-size: ${settings.fontSize}px; line-height: ${settings.lineHeight}; font-family: ${settings.fontFamily}; text-align: ${settings.textAlign}; color: ${theme.foreground}; background: ${theme.background}; column-width: calc(100vw - 2rem); column-gap: 2rem; column-fill: auto; overflow: visible; overflow-wrap: anywhere; }
    img, video, svg { max-width: 100%; height: auto; } table { display: block; max-width: 100%; overflow-x: auto; } pre { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; } a { color: ${theme.link}; } h1,h2,h3 { line-height: 1.25; }
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
  const chapters = Array.from(opf.querySelectorAll("spine > itemref"))
    .map((itemref) => manifest.get(itemref.getAttribute("idref")))
    .filter(Boolean);
  if (!chapters.length) throw new Error("EPUB has no readable chapters");
  return chapters;
}

function sumPages(pageCounts, until) {
  return pageCounts.reduce((total, count, index) => total + (index < until ? count || 0 : 0), 0);
}

export default function EpubViewer({ file, onSelect }) {
  const { data } = file;
  const iframeRef = useRef(null);
  const [chapters, setChapters] = useState([]);
  const [chapter, setChapter] = useState(0);
  const [page, setPage] = useState(0);
  const [targetPage, setTargetPage] = useState(1);
  const [contents, setContents] = useState({});
  const [pageCounts, setPageCounts] = useState([]);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState("system-ui, sans-serif");
  const [lineHeight, setLineHeight] = useState(1.65);
  const [theme, setTheme] = useState("light");
  const [textAlign, setTextAlign] = useState("left");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadChapters(data.id), apiservice.getReadingProgress(data.id)]).then(([book, progress]) => {
      if (cancelled) return;
      setChapters(book);
      setTargetPage(progress.currentPage || 1);
      setProgressLoaded(true);
      setLoading(false);
    }).catch((reason) => {
      if (!cancelled) {
        setError(reason.message || "Failed to load EPUB");
        setLoading(false);
        setProgressLoaded(true);
        setRestoring(false);
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
      return [index, chapterHtml(data.id, chapters[index].href, source, { fontSize, fontFamily, lineHeight, theme, textAlign })];
    })).then((loaded) => {
      if (cancelled) return;
      const newContents = loaded.filter(Boolean);
      if (newContents.length > 0) {
        setContents((current) => Object.fromEntries([...Object.entries(current), ...newContents]));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [data.id, chapter, chapters.length, contents, fontSize, fontFamily, lineHeight, theme, textAlign]);

  useEffect(() => {
    if (!progressLoaded || !chapters.length || restoring || !pageCounts[chapter]) return undefined;
    const currentPage = sumPages(pageCounts, chapter) + page + 1;
    const knownPageCount = pageCounts.length === chapters.length && pageCounts.every(Boolean)
      ? pageCounts.reduce((total, count) => total + count, 0)
      : 0;
    const timeout = setTimeout(() => apiservice.updateReadingProgress(data.id, currentPage, knownPageCount).catch(() => {}), 400);
    return () => clearTimeout(timeout);
  }, [data.id, page, chapter, pageCounts, progressLoaded, restoring]);

  useEffect(() => {
    const document = iframeRef.current?.contentDocument;
    const width = document?.documentElement?.clientWidth;
    if (width) iframeRef.current.contentWindow.scrollTo(page * width, 0);
  }, [chapter, page, contents]);

  const onChapterMeasured = () => {
    const document = iframeRef.current?.contentDocument;
    const width = document?.documentElement?.clientWidth || 1;
    const scrollWidth = document?.documentElement?.scrollWidth || width;
    const measured = Math.max(1, Math.ceil(scrollWidth / width));
    setPageCounts((current) => {
      const next = [...current];
      next[chapter] = measured;
      if (restoring) {
        const before = sumPages(next, chapter);
        if (targetPage <= before + measured) {
          setPage(Math.max(0, targetPage - before - 1));
          setRestoring(false);
        } else if (chapter + 1 < chapters.length) {
          setPage(0);
          setChapter(chapter + 1);
        } else {
          setPage(Math.max(0, measured - 1));
          setRestoring(false);
        }
      } else {
        setPage((currentPage) => Math.min(currentPage, measured - 1));
      }
      return next;
    });
  };

  const moveToPage = (nextPage) => {
    const chapterPages = pageCounts[chapter] || 1;
    setRestoring(false);
    setPage(Math.min(Math.max(nextPage, 0), chapterPages - 1));
  };

  const movePrevious = () => {
    if (page > 0) return moveToPage(page - 1);
    if (chapter > 0) {
      setRestoring(false);
      setChapter(chapter - 1);
      setPage(Math.max(0, (pageCounts[chapter - 1] || 1) - 1));
    }
  };

  const moveNext = () => {
    if (page + 1 < (pageCounts[chapter] || 1)) return moveToPage(page + 1);
    if (chapter + 1 < chapters.length) {
      setRestoring(false);
      setChapter(chapter + 1);
      setPage(0);
    }
  };

  const jumpToGlobalPage = (value) => {
    const requested = Number(value);
    if (!Number.isInteger(requested) || requested < 1) return;
    let remaining = requested;
    for (let index = 0; index < pageCounts.length; index += 1) {
      const count = pageCounts[index] || 0;
      if (count && remaining <= count) {
        setRestoring(false);
        setChapter(index);
        setPage(remaining - 1);
        return;
      }
      remaining -= count;
    }
    setTargetPage(requested);
    setRestoring(true);
    setChapter(0);
    setPage(0);
  };

  const resetTypography = (setter, value) => {
    setContents({});
    setter(value);
    setPageCounts([]);
    setRestoring(false);
    setPage(0);
  };

  if (loading) return <div className="text-center p-5"><Spinner animation="border" /> Loading EPUB...</div>;
  if (error) return <Alert variant="danger" className="m-3">{error}</Alert>;
  const current = chapters[chapter];
  const globalPage = sumPages(pageCounts, chapter) + page + 1;
  const knownTotal = pageCounts.reduce((total, count) => total + (count || 0), 0);
  const hasCompletePageCount = pageCounts.length === chapters.length && pageCounts.every(Boolean);
  return (
    <div className={styles.viewerShell}>
      <Navbar className={styles.breadcrumbBar}><NameTag node={file} onSelect={onSelect} /></Navbar>
      <Navbar className={`${styles.toolbar} flex-wrap gap-2`}>
        <div className={styles.pageStatus}>
          <ButtonGroup aria-label="Page navigation">
            <Button size="sm" variant="outline-secondary" disabled={chapter === 0 && page === 0} onClick={movePrevious}><FaChevronLeft /></Button>
            <Button size="sm" variant="outline-secondary" disabled={chapter === chapters.length - 1 && page + 1 >= (pageCounts[chapter] || 1)} onClick={moveNext}><FaChevronRight /></Button>
          </ButtonGroup>
          <span style={{ margin: "0 10px" }}>Page {globalPage}{hasCompletePageCount ? ` of ${knownTotal}` : ""}</span>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Form.Control size="sm" type="number" min="1" value={globalPage} onChange={(event) => jumpToGlobalPage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") jumpToGlobalPage(event.target.value); }} aria-label="Jump to page" style={{ width: "6rem" }} />
          <Form.Select size="sm" value={chapter} onChange={(event) => { setRestoring(false); setChapter(Number(event.target.value)); setPage(0); }} aria-label="Jump to chapter" style={{ width: "12rem" }}>
            {chapters.map((item, index) => <option key={item.href} value={index}>{item.title || `Chapter ${index + 1}`}</option>)}
          </Form.Select>
          <Form.Select size="sm" value={fontSize} onChange={(event) => resetTypography(setFontSize, Number(event.target.value))} aria-label="Font size" style={{ width: "7rem" }}>
            {[14, 16, 18, 20, 22, 24, 28].map((size) => <option key={size} value={size}>{size}px</option>)}
          </Form.Select>
          <Form.Select size="sm" value={fontFamily} onChange={(event) => resetTypography(setFontFamily, event.target.value)} aria-label="Font family" style={{ width: "9rem" }}>
            <option value="system-ui, sans-serif">System</option><option value="Georgia, serif">Serif</option><option value="Arial, sans-serif">Arial</option><option value="monospace">Mono</option>
          </Form.Select>
          <Form.Select size="sm" value={lineHeight} onChange={(event) => resetTypography(setLineHeight, Number(event.target.value))} aria-label="Line spacing" style={{ width: "7rem" }}>
            {[1.4, 1.65, 1.9, 2.2].map((spacing) => <option key={spacing} value={spacing}>Line {spacing}</option>)}
          </Form.Select>
          <Form.Select size="sm" value={theme} onChange={(event) => resetTypography(setTheme, event.target.value)} aria-label="Reader theme" style={{ width: "7rem" }}>
            <option value="light">Light</option><option value="dark">Dark</option><option value="sepia">Sepia</option>
          </Form.Select>
          <Form.Select size="sm" value={textAlign} onChange={(event) => resetTypography(setTextAlign, event.target.value)} aria-label="Text alignment" style={{ width: "8rem" }}>
            <option value="left">Aligned left</option><option value="justify">Justified</option><option value="center">Centered</option>
          </Form.Select>
        </div>
      </Navbar>
      <div className={styles.viewerContent}>
        {contents[chapter] ? <iframe ref={iframeRef} key={`${current.href}-${fontSize}-${fontFamily}-${lineHeight}-${theme}-${textAlign}`} title={current.title || `Chapter ${chapter + 1}`} onLoad={onChapterMeasured} sandbox="allow-same-origin" srcDoc={contents[chapter]} style={{ width: "100%", height: "100%", minHeight: "32rem", border: 0 }} /> : <div className="text-center p-5"><Spinner animation="border" /> Loading page...</div>}
      </div>
    </div>
  );
}
