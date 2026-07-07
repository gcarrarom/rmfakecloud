export function strokeWidthForBrushSize(brushSize) {
  const width = brushSize * 6.0 - 10.8;
  return width < 0.5 ? 0.5 : width;
}

export function strokeWidthForPoint(pointWidth, brushSize) {
  if (typeof pointWidth === "number" && pointWidth > 0) {
    return pointWidth;
  }

  return strokeWidthForBrushSize(brushSize);
}
