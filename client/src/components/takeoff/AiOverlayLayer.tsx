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
 */

import { Fragment, useState } from "react";
import { Line, Rect, Text, Group } from "react-konva";
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

export function AiOverlayLayer({
  measurements,
  hiddenDivisions,
  pageWidth,
  pageHeight,
  stageScale,
  selectedMeasurementId,
  setSelectedMeasurementId,
}: AiOverlayLayerProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  if (pageWidth === 0 || pageHeight === 0) return null;

  const aiMeasurements = measurements.filter(
    (m) => m.aiGeometry != null
  );
  if (aiMeasurements.length === 0) return null;

  const STROKE_W = 1.5 / stageScale;
  const FILL_OPACITY = 0.3;

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
        const strokeColor = isSelected ? color : color;
        const strokeWidth = isSelected ? STROKE_W * 2 : STROKE_W;

        const { boundingBox, polygonPoints } = geom;
        const bx = boundingBox.x * pageWidth;
        const by = boundingBox.y * pageHeight;
        const bw = boundingBox.w * pageWidth;
        const bh = boundingBox.h * pageHeight;

        const confidence = parseMetaConfidence(m);

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
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "pointer";
          buildTooltip(wx, wy);
        }

        function handleMouseLeave(e: any) {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "default";
          setTooltip(null);
        }

        const shapeKey = `ai-div-overlay-${m.id}`;

        if (polygonPoints && polygonPoints.length >= 3) {
          const flatPoints = polygonPoints.flatMap((p) => [
            p.x * pageWidth,
            p.y * pageHeight,
          ]);
          const cx = polygonPoints.reduce((s, p) => s + p.x, 0) / polygonPoints.length * pageWidth;
          const cy = polygonPoints.reduce((s, p) => s + p.y, 0) / polygonPoints.length * pageHeight;

          return (
            <Fragment key={shapeKey}>
              <Line
                points={flatPoints}
                closed
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                listening={true}
                perfectDrawEnabled={false}
                onMouseEnter={(e) => handleMouseEnter(e, cx, cy)}
                onMouseLeave={handleMouseLeave}
                onClick={() => setSelectedMeasurementId(m.id)}
                onTap={() => setSelectedMeasurementId(m.id)}
              />
            </Fragment>
          );
        }

        return (
          <Fragment key={shapeKey}>
            <Rect
              x={bx}
              y={by}
              width={bw}
              height={bh}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              listening={true}
              perfectDrawEnabled={false}
              onMouseEnter={(e) => handleMouseEnter(e, bx + bw / 2, by + bh / 2)}
              onMouseLeave={handleMouseLeave}
              onClick={() => setSelectedMeasurementId(m.id)}
              onTap={() => setSelectedMeasurementId(m.id)}
            />
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
