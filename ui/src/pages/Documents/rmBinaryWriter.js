import { strokeWidthForBrushSize } from "./strokeWidth";

const HEADER_V5 = "reMarkable .lines file, version=5          ";

function writeUint32LE(view, offset, value) {
  view.setUint32(offset, value, true);
  return offset + 4;
}

function writeFloat32LE(view, offset, value) {
  view.setFloat32(offset, value, true);
  return offset + 4;
}

function writePoints(view, offset, points) {
  for (const pt of points) {
    offset = writeFloat32LE(view, offset, pt.x || 0);
    offset = writeFloat32LE(view, offset, pt.y || 0);
    offset = writeFloat32LE(view, offset, pt.speed || 0);
    offset = writeFloat32LE(view, offset, pt.direction || 0);
    offset = writeFloat32LE(view, offset, pt.width || 0);
    offset = writeFloat32LE(view, offset, pt.pressure || 0);
  }
  return offset;
}

function serializeLayer(layer) {
  const items = (layer.items || []).filter(
    (it) => it.type === "stroke" && it.points && it.points.length > 0
  );

  let size = 4; // line count
  for (const item of items) {
    size += 4 * 4; // brushType, brushColor, padding, brushSize
    size += 4; // v5 unknown field
    size += 4; // point count
    size += item.points.length * 6 * 4; // 6 floats per point
  }
  return { items, size };
}

function traceContour(alpha, w, h, sx, sy, visited) {
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const contour = [];
  let x = sx,
    y = sy;
  let dir = 0;

  for (let limit = 0; limit < 10000; limit++) {
    contour.push({ x, y });
    visited[y * w + x] = 1;

    let found = false;
    for (let d = 0; d < 4; d++) {
      const nd = (dir + d) % 4;
      const nx = x + dirs[nd][0];
      const ny = y + dirs[nd][1];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (alpha[ny * w + nx] > 0 && !visited[ny * w + nx]) {
        x = nx;
        y = ny;
        dir = (nd + 3) % 4;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (x === sx && y === sy) break;
  }
  return contour;
}

export function textToStrokes(text, fontSize, fontFamily, offsetX, offsetY) {
  if (!text || !text.trim()) return [];

  const scale = 4;
  const canvasW = 600;
  const canvasH = Math.ceil(fontSize * 1.5 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "black";
  ctx.font = `bold ${fontSize * scale}px ${fontFamily || "sans-serif"}`;
  ctx.textBaseline = "top";

  const lines = text.split("\n");
  const lineHeight = fontSize * scale * 1.2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, i * lineHeight);
  }

  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  const alpha = new Uint8Array(canvasW * canvasH);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = imageData.data[i * 4 + 3] > 128 ? 1 : 0;
  }

  const visited = new Uint8Array(canvasW * canvasH);
  const contours = [];

  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      if (alpha[y * canvasW + x] && !visited[y * canvasW + x]) {
        let hasBgNeighbor = false;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx < 0 ||
            nx >= canvasW ||
            ny < 0 ||
            ny >= canvasH ||
            !alpha[ny * canvasW + nx]
          ) {
            hasBgNeighbor = true;
            break;
          }
        }
        if (hasBgNeighbor) {
          const contour = traceContour(alpha, canvasW, canvasH, x, y, visited);
          if (contour.length > 2) contours.push(contour);
        }
      }
    }
  }

  const strokes = [];
  const sampleStep = Math.max(1, Math.floor(2 / scale));
  const textBrushSize = Math.max(2.0, fontSize / 12);

  for (const contour of contours) {
    const points = [];
    for (let i = 0; i < contour.length; i += sampleStep) {
      const pt = contour[i];
      points.push({
        x: pt.x / scale + offsetX,
        y: pt.y / scale + offsetY,
        speed: 0,
        direction: 0,
        width: strokeWidthForBrushSize(textBrushSize),
        pressure: 0.5,
      });
    }
    if (points.length >= 2) {
      strokes.push({
        type: "stroke",
        pen: "BallPoint",
        penColour: "Black",
        brushSize: textBrushSize,
        points,
      });
    }
  }

  return strokes;
}

export function marshalRm(doc) {
  const layers = (doc.layers || []).filter(() => true);
  const serializedLayers = layers.map(serializeLayer);

  let totalSize = 43; // header
  totalSize += 4; // layer count
  for (const sl of serializedLayers) {
    totalSize += 4; // line count
    totalSize += sl.size - 4; // subtract the line count we already added
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Write header
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(HEADER_V5);
  new Uint8Array(buffer, 0, 43).set(headerBytes);
  offset = 43;

  // Write layer count
  offset = writeUint32LE(view, offset, layers.length);

  for (const sl of serializedLayers) {
    // Write line count
    offset = writeUint32LE(view, offset, sl.items.length);

    for (const item of sl.items) {
      const brushTypeMap = {
        BallPoint: 15,
        Marker: 16,
        Fineliner: 17,
        Highlighter: 18,
        Pencil: 13,
        Brush: 12,
        Eraser: 6,
      };
      const colorMap = { Black: 0, Grey: 1, White: 2 };

      offset = writeUint32LE(
        view,
        offset,
        brushTypeMap[item.pen] || 15
      );
      offset = writeUint32LE(
        view,
        offset,
        colorMap[item.penColour] ?? 0
      );
      offset = writeUint32LE(view, offset, 0); // padding
      offset = writeFloat32LE(view, offset, item.brushSize || 2.0);
      offset = writeFloat32LE(view, offset, 0); // v5 unknown

      offset = writeUint32LE(view, offset, item.points.length);
      offset = writePoints(view, offset, item.points);
    }
  }

  return new Uint8Array(buffer);
}

export async function buildRmdoc(pages, content, existingZip, existingFiles) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Re-add all non-.rm files from original zip
  for (const fileName of existingFiles) {
    if (fileName.endsWith(".rm")) continue;
    if (existingZip.files[fileName]) {
      const data = await existingZip.files[fileName].async("uint8array");
      zip.file(fileName, data);
    }
  }

  // Re-serialize each page's .rm data
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p.doc) continue;

    const rmBytes = marshalRm(p.doc);

    // Find the original filename for this page
    const originalEntry = existingFiles.find((f) => {
      const base = f.split("/").pop();
      return base === p.uuid + ".rm" || base === p.uuid;
    });

    const targetName = originalEntry || (p.uuid + ".rm");
    zip.file(targetName, rmBytes);
  }

  return zip;
}
