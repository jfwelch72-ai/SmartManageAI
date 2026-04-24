/**
 * Task #1609 — react-konva renderer for plan_document_markups.
 *
 * Pure presentational layer. Reused by `<PlanMarkupLayer />` (interactive),
 * the bid-side `<TakeoffWorkspace />` (rendered inside the takeoff Stage),
 * and any future read-only viewer. Coordinates in `points` are normalized
 * 0-1 and scaled to the supplied stage dimensions when used through
 * `<MarkupRenderer />`. When `<MarkupShapeView />` is consumed directly,
 * callers pass already-denormalized `pts` in their own coordinate space
 * (e.g. raw PDF pixels for the takeoff workspace).
 */
import { useMemo } from "react";
import { Stage, Layer, Arrow, Rect, Path, Line, Text, Group, Circle } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import { buildCloudPath } from "./cloudPath";

// Re-exported for backwards compatibility with existing call sites and
// tests that imported `buildCloudPath` from this module before the
// geometry was extracted into ./cloudPath (Task #1632).
export { buildCloudPath };

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

export interface MarkupShapeViewProps {
  shape: MarkupShape;
  pts: Array<{ x: number; y: number }>;
  selected: boolean;
  onSelect?: () => void;
  readOnly?: boolean;
  /** Per-shape hit-testing toggle. Defaults to !readOnly. The takeoff
   *  workspace flips this off when the active tool is not "select" so
   *  markup shapes don't intercept clicks meant for the underlying PDF. */
  listening?: boolean;
  /** Multiplier applied to all on-screen sizes (cloud bump, arrow head,
   *  text fontSize, selection shadow). Defaults to 1. The takeoff
   *  workspace passes 1 / stageScale so visuals stay constant in pixels
   *  regardless of zoom. */
  pixelScale?: number;
  /** Extra props spread on the wrapping `<Group>`. Lets the takeoff
   *  workspace make selected markups draggable without re-implementing
   *  the per-tool rendering switch. */
  groupProps?: Konva.NodeConfig & {
    onMouseEnter?: (evt: KonvaEventObject<MouseEvent>) => void;
    onMouseLeave?: (evt: KonvaEventObject<MouseEvent>) => void;
    onDragStart?: (evt: KonvaEventObject<DragEvent>) => void;
    onDragMove?: (evt: KonvaEventObject<DragEvent>) => void;
    onDragEnd?: (evt: KonvaEventObject<DragEvent>) => void;
  };
}

export function MarkupShapeView({
  shape,
  pts,
  selected,
  onSelect,
  readOnly,
  listening,
  pixelScale = 1,
  groupProps,
}: MarkupShapeViewProps) {
  const stroke = shape.color || "#ff0000";
  const thickness = shape.thickness || 2;
  const isInteractive = listening ?? !readOnly;
  const handle = isInteractive && onSelect
    ? (evt: KonvaEventObject<MouseEvent>) => {
        evt.cancelBubble = true;
        onSelect();
      }
    : undefined;
  const shadow = {
    shadowEnabled: selected,
    shadowColor: "#3b82f6",
    shadowBlur: 6 * pixelScale,
  } as const;

  if (pts.length === 0) return null;

  let inner: React.ReactNode = null;

  switch (shape.tool) {
    case "ARROW": {
      if (pts.length < 2) break;
      const flat = [pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y];
      inner = (
        <Arrow
          points={flat}
          stroke={stroke}
          fill={stroke}
          strokeWidth={thickness * pixelScale}
          pointerLength={Math.max(8, thickness * 3) * pixelScale}
          pointerWidth={Math.max(8, thickness * 3) * pixelScale}
          listening={isInteractive}
          {...shadow}
        />
      );
      break;
    }
    case "RECTANGLE": {
      if (pts.length < 2) break;
      const a = pts[0];
      const b = pts[pts.length - 1];
      inner = (
        <Rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          stroke={stroke}
          strokeWidth={thickness * pixelScale}
          listening={isInteractive}
          {...shadow}
        />
      );
      break;
    }
    case "CLOUD": {
      if (pts.length < 2) break;
      const a = pts[0];
      const b = pts[pts.length - 1];
      inner = (
        <Path
          data={buildCloudPath(a.x, a.y, b.x, b.y, 24 * pixelScale)}
          stroke={stroke}
          strokeWidth={thickness * pixelScale}
          listening={isInteractive}
          {...shadow}
        />
      );
      break;
    }
    case "HIGHLIGHT": {
      if (pts.length < 2) break;
      const a = pts[0];
      const b = pts[pts.length - 1];
      inner = (
        <Rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={stroke}
          opacity={0.35}
          listening={isInteractive}
          {...shadow}
        />
      );
      break;
    }
    case "FREEHAND": {
      if (pts.length < 2) break;
      inner = (
        <Line
          points={pts.flatMap((p) => [p.x, p.y])}
          stroke={stroke}
          strokeWidth={thickness * pixelScale}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
          listening={isInteractive}
          {...shadow}
        />
      );
      break;
    }
    case "TEXT": {
      const a = pts[0];
      const fontSize = Math.max(12, thickness * 6) * pixelScale;
      inner = (
        <>
          <Text
            x={a.x}
            y={a.y}
            text={shape.text || ""}
            fontSize={fontSize}
            fill={stroke}
            listening={isInteractive}
          />
          {selected && (
            <Circle x={a.x} y={a.y} radius={4 * pixelScale} stroke="#3b82f6" strokeWidth={1 * pixelScale} listening={false} />
          )}
        </>
      );
      break;
    }
    default:
      break;
  }

  if (!inner) return null;

  // Wrap in a Group so callers can attach drag handlers / extra props
  // without re-implementing the per-tool rendering switch. We also hoist
  // the click handler to the group so any child shape that bubbles up
  // triggers selection consistently.
  const userOnClick = groupProps?.onClick;
  const userOnTap = groupProps?.onTap;
  return (
    <Group
      listening={isInteractive}
      {...groupProps}
      onClick={(evt) => {
        handle?.(evt);
        userOnClick?.(evt);
      }}
      onTap={(evt) => {
        handle?.(evt);
        userOnTap?.(evt);
      }}
    >
      {inner}
    </Group>
  );
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
