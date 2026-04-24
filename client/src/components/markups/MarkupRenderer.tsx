/**
 * Task #1609 — react-konva renderer for plan_document_markups.
 *
 * Pure presentational layer. Reused by `<PlanMarkupLayer />` (interactive)
 * and any future read-only viewer. Coordinates in `points` are normalized
 * 0-1 and scaled to the supplied stage dimensions.
 */
import { useMemo } from "react";
import { Stage, Layer, Arrow, Rect, Path, Line, Text, Group, Circle } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

// "SELECT" is a non-drawing mode that allows clicking existing markups
// to select/delete them without engaging a drawing tool. Drawing logic
// in PlanMarkupLayer treats it as a no-op for pointerdown.
export type MarkupTool = "SELECT" | "ARROW" | "TEXT" | "RECTANGLE" | "CLOUD" | "HIGHLIGHT" | "FREEHAND";

export interface MarkupShape {
  id: string;
  tool: MarkupTool | string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  text?: string | null;
  createdBy?: string;
}

export interface MarkupRendererProps {
  width: number;
  height: number;
  markups: MarkupShape[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** When true, the stage is non-interactive (just a render) — used in
   *  read-only contexts like the print page or the gallery. */
  readOnly?: boolean;
  /** Optional draft shape currently being drawn (overlaid on top). */
  draft?: MarkupShape | null;
  /** Optional pointer-down + pointer-move handlers so the parent layer
   *  can implement freehand / arrow / etc. drawing without re-listening
   *  to DOM events on top of Konva. */
  onPointerDown?: (point: { x: number; y: number }, evt: KonvaEventObject<PointerEvent>) => void;
  onPointerMove?: (point: { x: number; y: number }, evt: KonvaEventObject<PointerEvent>) => void;
  onPointerUp?: (point: { x: number; y: number }, evt: KonvaEventObject<PointerEvent>) => void;
}

/** Mirror of TakeoffWorkspace.buildCloudPath — kept inline so the
 *  PlansTab renderer doesn't have a transitive import on the 5000-line
 *  takeoff workspace file. */
function buildCloudPath(x1: number, y1: number, x2: number, y2: number, bumpSize: number): string {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const w = right - left;
  const h = bottom - top;
  if (w < 4 || h < 4) {
    return `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`;
  }
  const bx = Math.max(3, Math.round(w / bumpSize));
  const by = Math.max(3, Math.round(h / bumpSize));
  const sx = w / bx;
  const sy = h / by;
  const px = Math.max(4, sx * 0.45);
  const py = Math.max(4, sy * 0.45);
  let d = `M ${left} ${top}`;
  for (let i = 0; i < bx; i++) {
    const ex = left + (i + 1) * sx;
    const cx = left + i * sx + sx / 2;
    d += ` Q ${cx} ${top - py}, ${ex} ${top}`;
  }
  for (let i = 0; i < by; i++) {
    const ey = top + (i + 1) * sy;
    const cy = top + i * sy + sy / 2;
    d += ` Q ${right + px} ${cy}, ${right} ${ey}`;
  }
  for (let i = 0; i < bx; i++) {
    const ex = right - (i + 1) * sx;
    const cx = right - i * sx - sx / 2;
    d += ` Q ${cx} ${bottom + py}, ${ex} ${bottom}`;
  }
  for (let i = 0; i < by; i++) {
    const ey = bottom - (i + 1) * sy;
    const cy = bottom - i * sy - sy / 2;
    d += ` Q ${left - px} ${cy}, ${left} ${ey}`;
  }
  d += " Z";
  return d;
}

interface RenderedShape {
  shape: MarkupShape;
  pts: Array<{ x: number; y: number }>;
}

function denormalize(
  shape: MarkupShape,
  width: number,
  height: number,
): RenderedShape {
  const pts = (shape.points || [])
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x * width, y: p.y * height }));
  return { shape, pts };
}

export function MarkupShapeView({
  shape,
  pts,
  selected,
  onSelect,
  readOnly,
}: {
  shape: MarkupShape;
  pts: Array<{ x: number; y: number }>;
  selected: boolean;
  onSelect?: () => void;
  readOnly?: boolean;
}) {
  const stroke = shape.color || "#ff0000";
  const thickness = shape.thickness || 2;
  const handle = readOnly ? undefined : onSelect;

  if (pts.length === 0) return null;

  switch (shape.tool) {
    case "ARROW": {
      if (pts.length < 2) return null;
      const flat = [pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y];
      return (
        <Arrow
          points={flat}
          stroke={stroke}
          fill={stroke}
          strokeWidth={thickness}
          pointerLength={Math.max(8, thickness * 3)}
          pointerWidth={Math.max(8, thickness * 3)}
          shadowEnabled={selected}
          shadowColor="#3b82f6"
          shadowBlur={6}
          onClick={handle}
          onTap={handle}
        />
      );
    }
    case "RECTANGLE": {
      if (pts.length < 2) return null;
      const a = pts[0];
      const b = pts[pts.length - 1];
      return (
        <Rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          stroke={stroke}
          strokeWidth={thickness}
          shadowEnabled={selected}
          shadowColor="#3b82f6"
          shadowBlur={6}
          onClick={handle}
          onTap={handle}
        />
      );
    }
    case "CLOUD": {
      if (pts.length < 2) return null;
      const a = pts[0];
      const b = pts[pts.length - 1];
      return (
        <Path
          data={buildCloudPath(a.x, a.y, b.x, b.y, 24)}
          stroke={stroke}
          strokeWidth={thickness}
          shadowEnabled={selected}
          shadowColor="#3b82f6"
          shadowBlur={6}
          onClick={handle}
          onTap={handle}
        />
      );
    }
    case "HIGHLIGHT": {
      if (pts.length < 2) return null;
      const a = pts[0];
      const b = pts[pts.length - 1];
      return (
        <Rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={stroke}
          opacity={0.35}
          shadowEnabled={selected}
          shadowColor="#3b82f6"
          shadowBlur={6}
          onClick={handle}
          onTap={handle}
        />
      );
    }
    case "FREEHAND": {
      if (pts.length < 2) return null;
      return (
        <Line
          points={pts.flatMap((p) => [p.x, p.y])}
          stroke={stroke}
          strokeWidth={thickness}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
          shadowEnabled={selected}
          shadowColor="#3b82f6"
          shadowBlur={6}
          onClick={handle}
          onTap={handle}
        />
      );
    }
    case "TEXT": {
      const a = pts[0];
      const fontSize = Math.max(12, thickness * 6);
      return (
        <Group onClick={handle} onTap={handle}>
          <Text
            x={a.x}
            y={a.y}
            text={shape.text || ""}
            fontSize={fontSize}
            fill={stroke}
          />
          {selected && (
            <Circle x={a.x} y={a.y} radius={4} stroke="#3b82f6" strokeWidth={1} />
          )}
        </Group>
      );
    }
    default:
      return null;
  }
}

export default function MarkupRenderer({
  width,
  height,
  markups,
  selectedId,
  onSelect,
  readOnly,
  draft,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MarkupRendererProps) {
  const rendered = useMemo(
    () => markups.map((m) => denormalize(m, width, height)),
    [markups, width, height],
  );
  const renderedDraft = useMemo(
    () => (draft ? denormalize(draft, width, height) : null),
    [draft, width, height],
  );

  const handleStagePointer = (
    handler: ((point: { x: number; y: number }, evt: KonvaEventObject<PointerEvent>) => void) | undefined,
    evt: KonvaEventObject<PointerEvent>,
  ) => {
    if (!handler) return;
    const stage = evt.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos || width <= 0 || height <= 0) return;
    handler({ x: pos.x / width, y: pos.y / height }, evt);
  };

  return (
    <Stage
      width={width}
      height={height}
      style={{ pointerEvents: readOnly ? "none" : "auto" }}
      onPointerDown={(e) => handleStagePointer(onPointerDown, e)}
      onPointerMove={(e) => handleStagePointer(onPointerMove, e)}
      onPointerUp={(e) => handleStagePointer(onPointerUp, e)}
      onClick={(e) => {
        // Click on empty stage clears selection.
        if (e.target === e.target.getStage() && onSelect) onSelect(null);
      }}
      data-testid="markup-renderer-stage"
    >
      <Layer listening={!readOnly}>
        {rendered.map(({ shape, pts }) => (
          <MarkupShapeView
            key={shape.id}
            shape={shape}
            pts={pts}
            selected={selectedId === shape.id}
            onSelect={() => onSelect?.(shape.id)}
            readOnly={readOnly}
          />
        ))}
        {renderedDraft && (
          <MarkupShapeView
            shape={renderedDraft.shape}
            pts={renderedDraft.pts}
            selected={false}
            readOnly
          />
        )}
      </Layer>
    </Stage>
  );
}
