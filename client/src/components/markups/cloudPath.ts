/**
 * Task #1632 — single source of truth for the revision-cloud bump
 * geometry. Used by both the on-screen Konva renderer (which needs an
 * SVG path string, see `MarkupRenderer.tsx`) and the print/PDF Canvas-2D
 * renderer (which needs a Path2D, see `markupCanvasRenderer.ts`).
 *
 * Keeping the algorithm in one place ensures printed plans match what
 * users see on screen — previously the two renderers had two parallel
 * implementations that had to be kept in lockstep by hand.
 */

/**
 * Minimal sink interface the cloud-path tracer emits into. Both
 * `CanvasRenderingContext2D` / `Path2D` and a tiny SVG-string builder
 * implement these four operations.
 */
export interface CloudPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  close(): void;
}

/**
 * Walks the revision-cloud rectangle between diagonal corners
 * (x1, y1) and (x2, y2), emitting moveTo / lineTo / quadraticCurveTo
 * calls into the supplied sink. `bumpSize` controls the approximate
 * world-coordinate spacing between bumps.
 *
 * Boxes smaller than 4×4 fall back to a plain rectangle outline so the
 * cloud doesn't degenerate into noise.
 */
export function traceCloudPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bumpSize: number,
  sink: CloudPathSink,
): void {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const w = right - left;
  const h = bottom - top;
  if (w < 4 || h < 4) {
    sink.moveTo(left, top);
    sink.lineTo(right, top);
    sink.lineTo(right, bottom);
    sink.lineTo(left, bottom);
    sink.close();
    return;
  }
  const bx = Math.max(3, Math.round(w / bumpSize));
  const by = Math.max(3, Math.round(h / bumpSize));
  const sx = w / bx;
  const sy = h / by;
  const px = Math.max(4, sx * 0.45);
  const py = Math.max(4, sy * 0.45);
  sink.moveTo(left, top);
  for (let i = 0; i < bx; i++) {
    const ex = left + (i + 1) * sx;
    const cx = left + i * sx + sx / 2;
    sink.quadraticCurveTo(cx, top - py, ex, top);
  }
  for (let i = 0; i < by; i++) {
    const ey = top + (i + 1) * sy;
    const cy = top + i * sy + sy / 2;
    sink.quadraticCurveTo(right + px, cy, right, ey);
  }
  for (let i = 0; i < bx; i++) {
    const ex = right - (i + 1) * sx;
    const cx = right - i * sx - sx / 2;
    sink.quadraticCurveTo(cx, bottom + py, ex, bottom);
  }
  for (let i = 0; i < by; i++) {
    const ey = bottom - (i + 1) * sy;
    const cy = bottom - i * sy - sy / 2;
    sink.quadraticCurveTo(left - px, cy, left, ey);
  }
  sink.close();
}

/**
 * Builds an SVG path `d` attribute describing the revision cloud
 * between the two diagonal corners. Output is byte-for-byte identical
 * to the previous standalone implementation in `MarkupRenderer.tsx`.
 */
export function buildCloudPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bumpSize: number,
): string {
  let d = "";
  traceCloudPath(x1, y1, x2, y2, bumpSize, {
    moveTo(x, y) {
      d += `${d ? " " : ""}M ${x} ${y}`;
    },
    lineTo(x, y) {
      d += ` L ${x} ${y}`;
    },
    quadraticCurveTo(cx, cy, x, y) {
      d += ` Q ${cx} ${cy}, ${x} ${y}`;
    },
    close() {
      d += " Z";
    },
  });
  return d;
}

/**
 * Builds a `Path2D` describing the revision cloud between the two
 * diagonal corners, suitable for `ctx.stroke(path)` against a 2D canvas
 * context. Geometry is identical to the SVG variant above.
 */
export function buildCloudPath2D(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bumpSize: number,
): Path2D {
  const path = new Path2D();
  traceCloudPath(x1, y1, x2, y2, bumpSize, {
    moveTo(x, y) {
      path.moveTo(x, y);
    },
    lineTo(x, y) {
      path.lineTo(x, y);
    },
    quadraticCurveTo(cx, cy, x, y) {
      path.quadraticCurveTo(cx, cy, x, y);
    },
    close() {
      path.closePath();
    },
  });
  return path;
}
