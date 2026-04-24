/**
 * Task #1609 — Canvas-2D markup renderer used by the print/PDF-export
 * page (`PlanDocumentPrintPage`). Mirrors the same six tools the
 * interactive react-konva renderer (`MarkupRenderer.tsx`) supports so
 * burned-in PDFs match what users see on screen.
 *
 * Coordinates in `points` are normalized 0-1 within the page; the
 * renderer scales them to the supplied canvas dimensions.
 *
 * Cloud-bump geometry lives in `./cloudPath` and is shared verbatim with
 * the on-screen renderer (Task #1632) so SVG output and Path2D output
 * stay in lockstep.
 */

import { buildCloudPath2D } from "./cloudPath";

export type MarkupTool =
  | "ARROW"
  | "TEXT"
  | "RECTANGLE"
  | "CLOUD"
  | "HIGHLIGHT"
  | "FREEHAND";

export interface MarkupForRender {
  tool: MarkupTool | string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  text?: string;
  /**
   * Task #1677 — optional layer assignment used to render a small
   * color-coded chip in the corner of each markup so the printed
   * page communicates which named layer the annotation belongs to.
   * Absence (e.g. legacy callers / on-screen rendering) suppresses
   * the chip, preserving the prior visual.
   */
  layer?: { name: string; color: string } | null;
}

export function renderMarkupToCanvas(
  ctx: CanvasRenderingContext2D,
  m: MarkupForRender,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const pts = m.points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x * canvasWidth, y: p.y * canvasHeight }));
  if (pts.length === 0) return;

  ctx.save();
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.thickness;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (m.tool) {
    case "ARROW": {
      if (pts.length < 2) break;
      const [a, b] = [pts[0], pts[pts.length - 1]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // Arrow head
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = Math.max(10, m.thickness * 4);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case "RECTANGLE": {
      if (pts.length < 2) break;
      const [a, b] = [pts[0], pts[pts.length - 1]];
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    }
    case "CLOUD": {
      if (pts.length < 2) break;
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const path = buildCloudPath2D(a.x, a.y, b.x, b.y, 24);
      ctx.stroke(path);
      break;
    }
    case "HIGHLIGHT": {
      if (pts.length < 2) break;
      const [a, b] = [pts[0], pts[pts.length - 1]];
      ctx.globalAlpha = 0.35;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.globalAlpha = 1;
      break;
    }
    case "FREEHAND": {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      break;
    }
    case "TEXT": {
      const a = pts[0];
      const fontSize = Math.max(12, m.thickness * 6);
      ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(m.text || "", a.x, a.y);
      break;
    }
    default:
      break;
  }
  ctx.restore();

  // Task #1677 — overlay a tiny color-coded chip at the top-left of the
  // markup's bounding box so the printed page records which named layer
  // each annotation belongs to. The chip is rendered after the shape so
  // arrows/highlights/etc. can't paint over it.
  if (m.layer && m.layer.name) {
    drawLayerChip(ctx, pts, m.layer);
  }
}

function computeBoundingBox(pts: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function drawLayerChip(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  layer: { name: string; color: string },
): void {
  const bbox = computeBoundingBox(pts);
  // Anchor at the top-left of the bounding box, nudged outward so the
  // chip doesn't sit directly on top of the stroke.
  const anchorX = bbox.x;
  const anchorY = bbox.y - 18;
  const fontPx = 10;
  const padX = 5;
  const padY = 3;
  const swatchSize = 8;

  ctx.save();
  ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = "top";
  // Truncate long names so the chip stays compact regardless of layer
  // name (e.g. an unbounded "Discipline / Civil / 2024 review" string).
  const label = layer.name.length > 24 ? layer.name.slice(0, 23) + "…" : layer.name;
  const textW = ctx.measureText(label).width;
  const chipW = padX + swatchSize + 4 + textW + padX;
  const chipH = fontPx + padY * 2;

  // Pill background — semi-opaque white so the chip is legible over both
  // light and dark portions of the underlying PDF.
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = layer.color || "#94a3b8";
  ctx.lineWidth = 1;
  const r = Math.min(6, chipH / 2);
  roundedRect(ctx, anchorX, anchorY, chipW, chipH, r);
  ctx.fill();
  ctx.stroke();

  // Color swatch.
  ctx.fillStyle = layer.color || "#94a3b8";
  ctx.fillRect(anchorX + padX, anchorY + padY + 1, swatchSize, swatchSize);

  // Label text.
  ctx.fillStyle = "#0f172a";
  ctx.fillText(label, anchorX + padX + swatchSize + 4, anchorY + padY);
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
