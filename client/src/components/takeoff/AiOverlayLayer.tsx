/**
 * Task #3045 — AI Overlay Layer for the Konva takeoff canvas.
 *
 * Renders semi-transparent color-coded polygons (or bounding-box rects as
 * fallback) for every `takeoff_measurements` row that carries an `aiGeometry`
 * value.  Shapes are colored by `csiDivision` using the CSI_DIVISION_COLORS
 * palette and filtered by the caller-supplied `hiddenDivisions` set.
 *
 * Layer ordering: this component is rendered INSIDE the existing single Konva
 * Layer (in the rotation Group), positioned after the tile/placeholder images
 * and before user-drawn measurements, so AI geometry always renders below the
 * estimator's own work.
 *
 * Coordinate system: `aiGeometry` stores page-normalised values (0–1).
 * Multiply by `pageWidth` / `pageHeight` to get Konva world coordinates.
 *
 * Task #3048 — Vertex-drag reshape mode.
 * When `editingMeasurementId` matches a measurement's id and `activeTool`
 * is "select", the overlay renders draggable vertex handles (Circles) so the
 * estimator can correct AI geometry errors.  For polygon shapes the handles sit
 * on each polygon vertex; for bounding-box shapes the four corners are used.
 * Drag positions are reported back in page-normalised coordinates via the
 * `onAiVertexDrag` callback so the caller can update its draft state.
 */

import { Fragment, useState } from "react";
import { Line, Rect, Text, Group, Circle } from "react-konva";
import { getCsiDivisionColor } from "@shared/csiDivisionColors";
import type { TakeoffMeasurement } from "@shared/schema";

interface AiGeometry {
  boundingBox: { x: number; y: number; w: number; h: number };
  polygonPoints?: Array<{ x: number; y: number }>;
}

interface TooltipState {
  x: number;
  y: number;
  label: string;
  quantity: string;
  confidence: string;
  division: string;
}

export interface AiOverlayLayerProps {
  measurements: TakeoffMeasurement[];
  hiddenDivisions: Set<string>;
  pageWidth: number;
  pageHeight: number;
  stageScale: number;
  selectedMeasurementId: string | null;
  setSelectedMeasurementId: (id: string | null) => void;

  /** Task #3048 — active canvas tool; vertex handles only appear when "select". */
  activeTool?: string;
  /** Task #3048 — id of the measurement currently in vertex-drag reshape mode. */
  editingMeasurementId?: string | null;
  /**
   * Task #3048 — live draft vertex positions for the measurement being reshaped,
   * in page-normalised coordinates (0–1).  For polygon overlays each element
   * is a polygon vertex; for bounding-box overlays the array holds the four
   * corners in TL → TR → BR → BL order.
   */
  editingPoints?: Array<{ x: number; y: number }> | null;
  /**
   * Task #3048 — called when the user drags a vertex handle.
   * `idx` is the vertex index within `editingPoints`.
   * `pt` is the new position in page-normalised coordinates.
   */
  onAiVertexDrag?: (idx: number, pt: { x: number; y: number }) => void;
  /**
   * Task #3048 — called when the user clicks an AI polygon while activeTool
   * is "select".  The caller should enter reshape mode for this measurement.
   */
  onEnterAiEditMode?: (
    measurementId: string,
    initialPoints: Array<{ x: number; y: number }>,
    isPolygon: boolean,
  ) => void;
}

function parseAiGeometry(raw: unknown): AiGeometry | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    const { boundingBox, polygonPoints } = obj as AiGeometry;
    if (
      !boundingBox ||
      typeof boundingBox.x !== "number" ||
      typeof boundingBox.y !== "number" ||
      typeof boundingBox.w !== "number" ||
      typeof boundingBox.h !== "number"
    ) {
      return null;
    }
    return { boundingBox, polygonPoints };
  } catch {
    return null;
  }
}

function parseMetaConfidence(m: TakeoffMeasurement): string {
  try {
    const meta = m.metadata
      ? typeof m.metadata === "string"
        ? JSON.parse(m.metadata)
        : m.metadata
      : null;
    const conf = meta?.confidence ?? meta?.aiConfidence;
    if (typeof conf === "number") {
      if (conf >= 85) return "HIGH";
      if (conf >= 65) return "MEDIUM";
      return "LOW";
    }
    return "";
  } catch {
    return "";
  }
}

/** Convert bounding box (normalised) to the four corners in TL→TR→BR→BL order. */
function bboxToCorners(
  bb: { x: number; y: number; w: number; h: number },
): Array<{ x: number; y: number }> {
  return [
    { x: bb.x, y: bb.y },
    { x: bb.x + bb.w, y: bb.y },
    { x: bb.x + bb.w, y: bb.y + bb.h },
    { x: bb.x, y: bb.y + bb.h },
  ];
}

export function AiOverlayLayer({
  measurements,
  hiddenDivisions,
  pageWidth,
  pageHeight,
  stageScale,
  selectedMeasurementId,
  setSelectedMeasurementId,
  activeTool,
  editingMeasurementId,
  editingPoints,
  onAiVertexDrag,
  onEnterAiEditMode,
}: AiOverlayLayerProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  if (pageWidth === 0 || pageHeight === 0) return null;

  const aiMeasurements = measurements.filter(
    (m) => m.aiGeometry != null
  );
  if (aiMeasurements.length === 0) return null;

  const STROKE_W = 1.5 / stageScale;
  const FILL_OPACITY = 0.3;
  const inSelectMode = activeTool === "select" || activeTool === undefined;

  function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return (
    <Group>
      {aiMeasurements.map((m) => {
        const geom = parseAiGeometry(m.aiGeometry);
        if (!geom) return null;

        const div = m.csiDivision ?? "";
        if (div && hiddenDivisions.has(div)) return null;

        const color = getCsiDivisionColor(div || null);
        const fillColor = hexToRgba(color, FILL_OPACITY);
        const isSelected = selectedMeasurementId === m.id;
        const isEditing = editingMeasurementId === m.id;
        const strokeColor = isEditing ? "rgba(245,158,11,1)" : color;
        const strokeWidth = (isSelected || isEditing) ? STROKE_W * 2 : STROKE_W;

        const { boundingBox, polygonPoints } = geom;
        const bx = boundingBox.x * pageWidth;
        const by = boundingBox.y * pageHeight;
        const bw = boundingBox.w * pageWidth;
        const bh = boundingBox.h * pageHeight;

        const confidence = parseMetaConfidence(m);
        const hasPolygon = polygonPoints != null && polygonPoints.length >= 3;

        function buildTooltip(worldX: number, worldY: number) {
          const qty =
            m.computedLengthFt != null
              ? `${m.computedLengthFt.toFixed(1)} LF`
              : m.computedAreaFt2 != null
              ? `${m.computedAreaFt2.toFixed(1)} SF`
              : m.count != null
              ? `${m.count} EA`
              : "";
          setTooltip({
            x: worldX,
            y: worldY,
            label: m.label,
            quantity: qty,
            confidence,
            division: div,
          });
        }

        function handleMouseEnter(e: any, wx: number, wy: number) {
          if (isEditing) return;
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = inSelectMode ? "pointer" : "default";
          buildTooltip(wx, wy);
        }

        function handleMouseLeave(e: any) {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "default";
          setTooltip(null);
        }

        function handleClick() {
          setSelectedMeasurementId(m.id);
          if (inSelectMode && onEnterAiEditMode) {
            if (hasPolygon) {
              onEnterAiEditMode(m.id, polygonPoints!, true);
            } else {
              onEnterAiEditMode(m.id, bboxToCorners(boundingBox), false);
            }
          }
        }

        const shapeKey = `ai-div-overlay-${m.id}`;

        // Determine the live vertex positions to render (draft or persisted).
        const livePoints: Array<{ x: number; y: number }> | null =
          isEditing && editingPoints && editingPoints.length >= 3
            ? editingPoints
            : null;

        if (hasPolygon) {
          const pts = livePoints ?? polygonPoints!;
          const flatPoints = pts.flatMap((p) => [
            p.x * pageWidth,
            p.y * pageHeight,
          ]);
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length * pageWidth;
          const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length * pageHeight;

          return (
            <Fragment key={shapeKey}>
              <Line
                points={flatPoints}
                closed
                fill={isEditing ? "rgba(245,158,11,0.15)" : fillColor}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                listening={!isEditing}
                perfectDrawEnabled={false}
                onMouseEnter={(e) => handleMouseEnter(e, cx, cy)}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                onTap={handleClick}
                data-testid={`ai-overlay-polygon-${m.id}`}
              />
              {/* Task #3048 — Draggable vertex handles shown when in reshape mode. */}
              {isEditing && pts.map((pt, i) => (
                <Circle
                  key={`ai-edit-vtx-${m.id}-${i}`}
                  x={pt.x * pageWidth}
                  y={pt.y * pageHeight}
                  radius={6 / stageScale}
                  fill="rgba(245,158,11,0.90)"
                  stroke="white"
                  strokeWidth={1.5 / stageScale}
                  draggable={true}
                  onDragMove={(e) => {
                    const node = e.target;
                    onAiVertexDrag?.(i, {
                      x: Math.max(0, Math.min(1, node.x() / pageWidth)),
                      y: Math.max(0, Math.min(1, node.y() / pageHeight)),
                    });
                  }}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = "crosshair";
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = "default";
                  }}
                  perfectDrawEnabled={false}
                  data-testid={`ai-overlay-vertex-${m.id}-${i}`}
                />
              ))}
            </Fragment>
          );
        }

        // Bounding-box fallback.
        const corners = livePoints ?? bboxToCorners(boundingBox);
        // Build a flat rect from the live corners (axis-aligned from min/max).
        const minX = Math.min(...corners.map((c) => c.x)) * pageWidth;
        const minY = Math.min(...corners.map((c) => c.y)) * pageHeight;
        const maxX = Math.max(...corners.map((c) => c.x)) * pageWidth;
        const maxY = Math.max(...corners.map((c) => c.y)) * pageHeight;

        return (
          <Fragment key={shapeKey}>
            <Rect
              x={isEditing ? minX : bx}
              y={isEditing ? minY : by}
              width={isEditing ? maxX - minX : bw}
              height={isEditing ? maxY - minY : bh}
              fill={isEditing ? "rgba(245,158,11,0.15)" : fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              listening={!isEditing}
              perfectDrawEnabled={false}
              onMouseEnter={(e) => handleMouseEnter(e, bx + bw / 2, by + bh / 2)}
              onMouseLeave={handleMouseLeave}
              onClick={handleClick}
              onTap={handleClick}
              data-testid={`ai-overlay-rect-${m.id}`}
            />
            {/* Task #3048 — Draggable corner handles for bounding-box overlays. */}
            {isEditing && corners.map((corner, i) => (
              <Circle
                key={`ai-edit-corner-${m.id}-${i}`}
                x={corner.x * pageWidth}
                y={corner.y * pageHeight}
                radius={6 / stageScale}
                fill="rgba(245,158,11,0.90)"
                stroke="white"
                strokeWidth={1.5 / stageScale}
                draggable={true}
                onDragMove={(e) => {
                  const node = e.target;
                  onAiVertexDrag?.(i, {
                    x: Math.max(0, Math.min(1, node.x() / pageWidth)),
                    y: Math.max(0, Math.min(1, node.y() / pageHeight)),
                  });
                }}
                onMouseEnter={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = "crosshair";
                }}
                onMouseLeave={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = "default";
                }}
                perfectDrawEnabled={false}
                data-testid={`ai-overlay-corner-${m.id}-${i}`}
              />
            ))}
          </Fragment>
        );
      })}

      {tooltip && (
        <Group x={tooltip.x} y={tooltip.y} listening={false}>
          <Rect
            x={0}
            y={-(56 / stageScale) - 4 / stageScale}
            width={160 / stageScale}
            height={52 / stageScale}
            fill="rgba(15,23,42,0.90)"
            cornerRadius={4 / stageScale}
          />
          <Text
            x={6 / stageScale}
            y={-(52 / stageScale) - 4 / stageScale}
            text={[
              tooltip.label,
              tooltip.quantity ? `Qty: ${tooltip.quantity}` : null,
              tooltip.confidence ? `Confidence: ${tooltip.confidence}` : null,
              tooltip.division || null,
            ]
              .filter(Boolean)
              .join("\n")}
            fontSize={10 / stageScale}
            fill="#f8fafc"
            lineHeight={1.4}
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}
