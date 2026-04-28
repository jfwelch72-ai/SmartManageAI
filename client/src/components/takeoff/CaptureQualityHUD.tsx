import { Group, Rect, Text } from "react-konva";

/**
 * Task #2331 — Live capture-quality HUD.
 *
 * The hook `use-takeoff-interactions` records which snap mode (if any)
 * won at every committed vertex of an in-progress draft. That same
 * snap-hit ratio later drives the post-commit `needs_review` rule, so
 * estimators historically only learned they were drawing sloppily
 * after the row flag fired. This badge surfaces the running ratio
 * mid-draft so the user can self-correct before commit.
 *
 * Renders as a small Konva pill near the cursor, just below the
 * existing `runningMeasurement` HUD. The colour signals quality at a
 * glance:
 *   - >= 80 % hits → green
 *   -  50–79 %    → amber
 *   -  <  50 %    → red
 *
 * Visibility contract (matches the task's done-criteria):
 *   - Hidden until the draft has 2+ vertices (no value on first click)
 *   - Hidden when no cursor position is available
 *   - Hidden when there are no recorded vertices in stats (which
 *     happens immediately after `consumeSnapProvenance` clears state
 *     on commit, even if `drawingPoints` hasn't yet been drained)
 *
 * Pure presentation: all state lives in the hook so this component is
 * easy to unit-test and re-use under any host (CanvasStage today).
 */
export interface CaptureQualityHUDProps {
  /** True only while a measure draw is in progress. */
  isDrawing: boolean;
  /** Cursor position in stage (image) coordinates, or null. */
  cursorPosition: { x: number; y: number } | null;
  /** Number of vertices placed in the active draft. */
  drawingPointsCount: number;
  /** Snap stats accumulated by the hook for the in-progress draft. */
  snapStats: {
    vertices: number;
    hits: number;
    modeCounts: Record<string, number>;
  };
  /** Current Konva stage scale; used to keep the badge a constant
   *  pixel size regardless of zoom. */
  stageScale: number;
}

const SNAP_MODE_SHORT_LABEL: Record<string, string> = {
  endpoint: "End",
  midpoint: "Mid",
  intersection: "Int",
  perpendicular: "Perp",
  center: "Cen",
  nearest: "Near",
  grid: "Grid",
};

export function pickTopMode(
  modeCounts: Record<string, number>,
): { mode: string; count: number } | null {
  let topMode: string | null = null;
  let topCount = 0;
  for (const [mode, count] of Object.entries(modeCounts)) {
    if (count > topCount) {
      topMode = mode;
      topCount = count;
    }
  }
  return topMode ? { mode: topMode, count: topCount } : null;
}

export function pickQualityFill(ratio: number): string {
  if (ratio >= 0.8) return "rgba(22, 163, 74, 0.9)"; // green-600
  if (ratio >= 0.5) return "rgba(217, 119, 6, 0.9)"; // amber-600
  return "rgba(220, 38, 38, 0.9)"; // red-600
}

export function CaptureQualityHUD({
  isDrawing,
  cursorPosition,
  drawingPointsCount,
  snapStats,
  stageScale,
}: CaptureQualityHUDProps) {
  if (!isDrawing) return null;
  if (!cursorPosition) return null;
  // Done criteria: only visible while the draft has 2+ vertices
  // (drawingPointsCount counts the committed clicks; the first click
  // has no snap context worth showing yet).
  if (drawingPointsCount < 2) return null;
  if (snapStats.vertices === 0) return null;

  const ratio = snapStats.hits / snapStats.vertices;
  const top = pickTopMode(snapStats.modeCounts);
  const ratioText = `Snap ${snapStats.hits}/${snapStats.vertices}`;
  const modeLabel = top ? SNAP_MODE_SHORT_LABEL[top.mode] ?? top.mode : null;
  const modeText =
    top && modeLabel ? ` · ${modeLabel}${top.count > 1 ? ` ×${top.count}` : ""}` : "";
  const fullText = ratioText + modeText;
  const fill = pickQualityFill(ratio);

  // Position the badge above the running-measurement HUD so the two
  // stack cleanly without overlap. The runningMeasurement rect sits
  // at cursor.y - 28..-6 with the same +18 px x-offset; this badge
  // sits one row higher (cursor.y - 52..-32). Keeping both anchored
  // to the cursor on the same x-offset keeps the eye-trail short.
  const padX = 18 / stageScale;
  const badgeHeight = 18 / stageScale;
  const verticalOffset = 32 / stageScale; // gap above runningMeasurement
  const badgeWidth = Math.max(80, fullText.length * 7.5) / stageScale;
  const badgeY = cursorPosition.y - verticalOffset - badgeHeight;

  return (
    <Group
      listening={false}
      name="capture-quality-hud"
      data-testid="capture-quality-hud"
      data-quality={
        ratio >= 0.8 ? "high" : ratio >= 0.5 ? "medium" : "low"
      }
    >
      <Rect
        x={cursorPosition.x + padX}
        y={badgeY}
        width={badgeWidth}
        height={badgeHeight}
        fill={fill}
        cornerRadius={3 / stageScale}
        shadowColor="rgba(0,0,0,0.3)"
        shadowBlur={3 / stageScale}
        shadowOffset={{ x: 0, y: 1 / stageScale }}
      />
      <Text
        x={cursorPosition.x + padX + 6 / stageScale}
        y={badgeY + 3 / stageScale}
        text={fullText}
        fontSize={11 / stageScale}
        fill="#ffffff"
        fontStyle="bold"
        fontFamily="monospace"
      />
    </Group>
  );
}
