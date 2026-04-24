/**
 * Task #1609 — Canvas-2D markup renderer used by the print/PDF-export
 * page (`PlanDocumentPrintPage`). Mirrors the same six tools the
 * interactive react-konva renderer (`MarkupRenderer.tsx`) supports so
 * burned-in PDFs match what users see on screen.
 *
 * Coordinates in `points` are normalized 0-1 within the page; the
 * renderer scales them to the supplied canvas dimensions.
 */

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
}

/** Mirror of TakeoffWorkspace.buildCloudPath but emits a Path2D. */
function buildCloudPath2D(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bumpSize: number,
): Path2D {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const w = right - left;
  const h = bottom - top;
  const path = new Path2D();
  if (w < 4 || h < 4) {
    path.rect(left, top, w, h);
    return path;
  }
  const bx = Math.max(3, Math.round(w / bumpSize));
  const by = Math.max(3, Math.round(h / bumpSize));
  const sx = w / bx;
  const sy = h / by;
  const px = Math.max(4, sx * 0.45);
  const py = Math.max(4, sy * 0.45);
  path.moveTo(left, top);
  for (let i = 0; i < bx; i++) {
    const ex = left + (i + 1) * sx;
    const cx = left + i * sx + sx / 2;
    path.quadraticCurveTo(cx, top - py, ex, top);
  }
  for (let i = 0; i < by; i++) {
    const ey = top + (i + 1) * sy;
    const cy = top + i * sy + sy / 2;
    path.quadraticCurveTo(right + px, cy, right, ey);
  }
  for (let i = 0; i < bx; i++) {
    const ex = right - (i + 1) * sx;
    const cx = right - i * sx - sx / 2;
    path.quadraticCurveTo(cx, bottom + py, ex, bottom);
  }
  for (let i = 0; i < by; i++) {
    const ey = bottom - (i + 1) * sy;
    const cy = bottom - i * sy - sy / 2;
    path.quadraticCurveTo(left - px, cy, left, ey);
  }
  path.closePath();
  return path;
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
}
