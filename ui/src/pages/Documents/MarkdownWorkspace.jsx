import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { marked } from "marked";
import { parse } from "remarkable-rm";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import apiservice from "../../services/api.service";
import styles from "./Documents.module.scss";

const PAGE_WIDTH = 1404;
const PAGE_HEIGHT = 1872;

function safeMarkdown(source) {
  const html = marked.parse(source || "", { breaks: true });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());
  parsed.querySelectorAll("*[onload], *[onclick], *[onerror]").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
    });
  });
  return parsed.body.innerHTML;
}

function drawPage(canvas, doc) {
  const scale = canvas.clientWidth / PAGE_WIDTH;
  canvas.width = PAGE_WIDTH * scale;
  canvas.height = PAGE_HEIGHT * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const layer of doc?.layers || []) {
    for (const item of layer.items || []) {
      if (item.type !== "stroke" || item.points?.length < 2) continue;
      ctx.strokeStyle = item.pen === "Highlighter" ? "rgba(255, 220, 0, .35)" : "#222";
      ctx.lineWidth = item.pen === "Highlighter" ? 16 : Math.max(1, item.brushSize || 2);
      for (let i = 1; i < item.points.length; i += 1) {
        const previous = item.points[i - 1];
        const point = item.points[i];
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }
  }
}

function MarkdownPage({ source, doc }) {
  useEffect(() => {
    const canvas = document.querySelector(`[data-markdown-page="${source.page}"]`);
    if (canvas) drawPage(canvas, doc);
  }, [doc, source.page]);

  return (
    <div className={styles.markdownPage}>
      <div className={styles.markdownBackground} dangerouslySetInnerHTML={{ __html: safeMarkdown(source.text) }} />
      <canvas className={styles.markdownAnnotations} data-markdown-page={source.page} />
    </div>
  );
}

export default function MarkdownWorkspace({ file, onSelect }) {
  const [source, setSource] = useState("");
  const [baseVersion, setBaseVersion] = useState("");
  const [annotationPages, setAnnotationPages] = useState([]);
  const [mode, setMode] = useState("split");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiservice.getMarkdown(file.id),
      apiservice.download(file.id, "rmdoc").then(async (blob) => {
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const contentName = Object.keys(zip.files).find((name) => name.endsWith(".content"));
        if (!contentName) return [];
        const content = JSON.parse(await zip.files[contentName].async("string"));
        const pages = [];
        for (const uuid of content.pages || []) {
          const entry = Object.keys(zip.files).find((name) => name.split("/").pop() === `${uuid}.rm` || name.split("/").pop() === uuid);
          if (entry) {
            const data = await zip.files[entry].async("uint8array");
            try { pages.push(parse(data)); } catch (_) { pages.push(null); }
          } else pages.push(null);
        }
        return pages;
      }),
    ]).then(([document, pages]) => {
      if (cancelled) return;
      setSource(document.source || "");
      setBaseVersion(document.updatedAt || "");
      setAnnotationPages(pages);
      setLoading(false);
    }).catch((error) => {
      if (!cancelled) { setMessage(error.message); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [file.id]);

  const pages = useMemo(() => source.split(/\n---\n/g).map((text, page) => ({ text, page })), [source]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const document = await apiservice.updateMarkdown(file.id, source, baseVersion);
      setBaseVersion(document.updatedAt || "");
      setMessage("Markdown saved. Tablet annotations remain in the linked document.");
    } catch (error) {
      setMessage(error.message);
    } finally { setSaving(false); }
  };

  if (loading) return <div className="text-center p-5"><Spinner animation="border" /> Loading Markdown workspace...</div>;
  if (message && !source) return <Alert variant="danger" className="m-3">{message}</Alert>;

  return (
    <div className={styles.markdownWorkspace}>
      <div className={styles.markdownToolbar}>
        <Button size="sm" variant={mode === "edit" ? "primary" : "outline-secondary"} onClick={() => setMode("edit")}>Edit</Button>
        <Button size="sm" variant={mode === "preview" ? "primary" : "outline-secondary"} onClick={() => setMode("preview")}>Preview</Button>
        <Button size="sm" variant={mode === "split" ? "primary" : "outline-secondary"} onClick={() => setMode("split")}>Split</Button>
        <Button size="sm" variant="success" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Markdown"}</Button>
        <span className={styles.markdownHint}>Use a line containing <code>---</code> for a tablet page break.</span>
      </div>
      {message && <Alert variant="info" className="m-2">{message}</Alert>}
      <div className={`${styles.markdownPanels} ${styles[`markdownMode${mode}`]}`}>
        {mode !== "preview" && <Form.Control as="textarea" className={styles.markdownSource} value={source} onChange={(event) => setSource(event.target.value)} spellCheck="false" />}
        {mode !== "edit" && <div className={styles.markdownPreview}>{pages.map((page) => <MarkdownPage key={page.page} source={page} doc={annotationPages[page.page]} />)}</div>}
      </div>
    </div>
  );
}
