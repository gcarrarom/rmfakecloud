import { useRef, useEffect, useState, useCallback } from "react";
import { ButtonGroup, Button, Form } from "react-bootstrap";
import { textToStrokes } from "./rmBinaryWriter";

const CANVAS_W = 1404;
const CANVAS_H = 1872;

const BRUSH_TYPES = {
  BallPoint: 2,
  Marker: 3,
  Fineliner: 4,
  Highlighter: 5,
  Pencil: 7,
};

const PEN_COLORS = {
  Black: 0,
  Grey: 1,
  White: 2,
};

function renderStrokesToCanvas(ctx, doc, scale) {
  ctx.clearRect(0, 0, CANVAS_W * scale, CANVAS_H * scale);
  ctx.save();
  ctx.scale(scale, scale);

  if (!doc || !doc.layers) {
    ctx.restore();
    return;
  }

  for (const layer of doc.layers) {
    if (!layer.items) continue;
    for (const item of layer.items) {
      if (item.type !== "stroke" || !item.points || item.points.length === 0)
        continue;

      const pen = item.pen || "BallPoint";
      const penColour = item.penColour || "Black";
      const brushSize = item.brushSize || 2.0;

      let strokeWidth = brushSize * 6.0 - 10.8;
      if (strokeWidth < 0.5) strokeWidth = 0.5;

      let color = "rgba(0,0,0,1)";
      if (penColour === "Grey") color = "rgba(128,128,128,1)";
      else if (penColour === "White") color = "rgba(255,255,255,1)";

      if (pen === "Highlighter") {
        color = "rgba(255,255,0,0.3)";
        strokeWidth = brushSize * 8;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      const pts = item.points;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

export default function RmdocEditor({ pages, currentPage, onStrokeChange }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const textInputRef = useRef(null);

  const [tool, setTool] = useState("pen"); // "pen" or "text"
  const [penType, setPenType] = useState("BallPoint");
  const [penColor, setPenColor] = useState("Black");
  const [fontSize, setFontSize] = useState(24);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [scale, setScale] = useState(0.5);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInputPos, setTextInputPos] = useState({ x: 0, y: 0 });
  const [textInputValue, setTextInputValue] = useState("");

  const pageInfo = pages[currentPage];

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0].contentBoxSize[0].inlineSize;
      setScale(Math.min((w - 40) / CANVAS_W, 1));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    renderStrokesToCanvas(ctx, pageInfo?.doc, scale);
  }, [pageInfo, scale]);

  const getCanvasCoords = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [scale]
  );

  // --- Pen drawing ---
  const startDraw = useCallback(
    (e) => {
      if (tool !== "pen") return;
      e.preventDefault();
      setIsDrawing(true);
      const { x, y } = getCanvasCoords(e);
      setCurrentStroke({
        pen: penType,
        penColour: penColor,
        brushSize: 2.0,
        points: [{ x, y, speed: 0, direction: 0, width: 0, pressure: 0.5 }],
      });
    },
    [tool, getCanvasCoords, penType, penColor]
  );

  const moveDraw = useCallback(
    (e) => {
      if (tool !== "pen" || !isDrawing || !currentStroke) return;
      e.preventDefault();
      const { x, y } = getCanvasCoords(e);
      setCurrentStroke((prev) => ({
        ...prev,
        points: [
          ...prev.points,
          { x, y, speed: 0, direction: 0, width: 0, pressure: 0.5 },
        ],
      }));

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.scale(scale, scale);

      let color = "rgba(0,0,0,1)";
      if (penColor === "Grey") color = "rgba(128,128,128,1)";
      else if (penColor === "White") color = "rgba(255,255,255,1)";
      if (penType === "Highlighter") color = "rgba(255,255,0,0.3)";

      ctx.strokeStyle = color;
      ctx.lineWidth = penType === "Highlighter" ? 16 : 1.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const pts = currentStroke.points;
      if (pts.length >= 2) {
        const last = pts[pts.length - 1];
        const prev2 = pts[pts.length - 2];
        ctx.beginPath();
        ctx.moveTo(prev2.x, prev2.y);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    [tool, isDrawing, currentStroke, getCanvasCoords, scale, penType, penColor]
  );

  const endDraw = useCallback(() => {
    if (tool !== "pen" || !isDrawing || !currentStroke) return;
    setIsDrawing(false);

    if (currentStroke.points.length < 2) {
      setCurrentStroke(null);
      return;
    }

    const doc = pageInfo?.doc;
    if (!doc) {
      setCurrentStroke(null);
      return;
    }

    const newDoc = JSON.parse(JSON.stringify(doc));
    if (!newDoc.layers || newDoc.layers.length === 0) {
      newDoc.layers = [{ items: [] }];
    }
    const layer = newDoc.layers[0];
    if (!layer.items) layer.items = [];

    const strokeWidth =
      currentStroke.pen === "Highlighter"
        ? 16
        : currentStroke.brushSize * 6.0 - 10.8;

    layer.items.push({
      type: "stroke",
      pen: currentStroke.pen,
      penColour: currentStroke.penColour,
      brushSize: currentStroke.brushSize,
      points: currentStroke.points.map((p) => ({
        ...p,
        width: strokeWidth,
      })),
    });

    onStrokeChange(currentPage, newDoc);
    setCurrentStroke(null);
  }, [tool, isDrawing, currentStroke, pageInfo, currentPage, onStrokeChange]);

  // --- Text tool ---
  const handleCanvasClick = useCallback(
    (e) => {
      if (tool !== "text") return;
      const { x, y } = getCanvasCoords(e);
      setTextInputPos({ x, y });
      setTextInputValue("");
      setShowTextInput(true);
      setTimeout(() => textInputRef.current?.focus(), 50);
    },
    [tool, getCanvasCoords]
  );

  const submitText = useCallback(() => {
    if (!textInputValue.trim()) {
      setShowTextInput(false);
      return;
    }

    const doc = pageInfo?.doc;
    if (!doc) {
      setShowTextInput(false);
      return;
    }

    const textStrokes = textToStrokes(
      textInputValue,
      fontSize,
      "sans-serif",
      textInputPos.x,
      textInputPos.y
    );

    if (textStrokes.length === 0) {
      setShowTextInput(false);
      return;
    }

    const newDoc = JSON.parse(JSON.stringify(doc));
    if (!newDoc.layers || newDoc.layers.length === 0) {
      newDoc.layers = [{ items: [] }];
    }
    const layer = newDoc.layers[0];
    if (!layer.items) layer.items = [];

    for (const stroke of textStrokes) {
      layer.items.push(stroke);
    }

    onStrokeChange(currentPage, newDoc);
    setShowTextInput(false);
    setTextInputValue("");
  }, [
    textInputValue,
    textInputPos,
    fontSize,
    currentPage,
    pageInfo,
    onStrokeChange,
  ]);

  const handleCanvasEvent = useCallback(
    (e) => {
      if (tool === "text") {
        handleCanvasClick(e);
      } else {
        startDraw(e);
      }
    },
    [tool, handleCanvasClick, startDraw]
  );

  return (
    <div ref={containerRef} style={{ height: "100%", overflow: "auto", position: "relative" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "5px",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <ButtonGroup size="sm">
          <Button
            variant={tool === "pen" ? "primary" : "outline-secondary"}
            onClick={() => setTool("pen")}
          >
            Pen
          </Button>
          <Button
            variant={tool === "text" ? "primary" : "outline-secondary"}
            onClick={() => setTool("text")}
          >
            Text
          </Button>
        </ButtonGroup>

        {tool === "pen" && (
          <>
            <ButtonGroup size="sm">
              {Object.keys(BRUSH_TYPES).map((name) => (
                <Button
                  key={name}
                  variant={penType === name ? "primary" : "outline-secondary"}
                  onClick={() => setPenType(name)}
                >
                  {name}
                </Button>
              ))}
            </ButtonGroup>
            <ButtonGroup size="sm">
              {Object.keys(PEN_COLORS).map((name) => (
                <Button
                  key={name}
                  variant={penColor === name ? "dark" : "outline-secondary"}
                  onClick={() => setPenColor(name)}
                >
                  {name}
                </Button>
              ))}
            </ButtonGroup>
          </>
        )}

        {tool === "text" && (
          <Form.Control
            size="sm"
            type="number"
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            min={8}
            max={200}
            style={{ width: 70 }}
            title="Font size"
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W * scale}
          height={CANVAS_H * scale}
          style={{
            border: "1px solid #ccc",
            cursor: tool === "text" ? "text" : "crosshair",
            touchAction: "none",
          }}
          onMouseDown={handleCanvasEvent}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={handleCanvasEvent}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
        />

        {showTextInput && (
          <div
            style={{
              position: "absolute",
              left: textInputPos.x * scale + 200,
              top: textInputPos.y * scale + 40,
              zIndex: 10,
            }}
          >
            <Form.Control
              ref={textInputRef}
              as="textarea"
              rows={3}
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
                if (e.key === "Escape") setShowTextInput(false);
              }}
              style={{
                fontSize: fontSize * scale,
                fontFamily: "sans-serif",
                minWidth: 200,
              }}
              placeholder="Type here, Enter to confirm"
            />
            <Button size="sm" variant="primary" onClick={submitText} className="mt-1">
              Add
            </Button>{" "}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowTextInput(false)}
              className="mt-1"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
