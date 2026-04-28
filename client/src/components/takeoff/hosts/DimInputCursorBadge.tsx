import { Group, Rect, Text } from "react-konva";

/**
 * Task #2227 — Active typed-dimension lock cursor badge.
 *
 * Floats below the cursor while a measure draw is in progress so the
 * estimator always sees the locked length without looking up at the
 * ribbon. Chain mode (typed length stays active across multiple
 * clicks) swaps to an amber palette + "Chain" label so a single
 * glance distinguishes one-shot Lock from sticky Chain.
 *
 * Extracted from `CanvasStage.tsx` so the conditional rendering
 * contract — hidden when not drawing, hidden when no length, label
 * + colour reflect Lock / Chain — can be exercised by the focused
 * unit suite under `__tests__/DimInputCursorBadge.test.tsx` without
 * mounting the entire `CanvasStage` (170+ props) for every assertion.
 */
export interface DimInputCursorBadgeProps {
  /** True only while a measure draw is in progress. */
  isDrawing: boolean;
  /** Cursor position in stage (image) coordinates, or null. */
  cursorPosition: { x: number; y: number } | null;
  /** Pending typed-length lock in feet, or null/0 when no lock. */
  pendingDimLengthFt: number | null | undefined;
  /** Chain mode flag — true → "Chain" label + amber palette. */
  dimInputRepeat: boolean | undefined;
  /** Current Konva stage scale; used to keep the badge a constant
   *  pixel size regardless of zoom. */
  stageScale: number;
}

export function DimInputCursorBadge({
  isDrawing,
  cursorPosition,
  pendingDimLengthFt,
  dimInputRepeat,
  stageScale,
}: DimInputCursorBadgeProps) {
  if (!isDrawing) return null;
  if (!cursorPosition) return null;
  if (pendingDimLengthFt == null || pendingDimLengthFt <= 0) return null;

  const label = dimInputRepeat ? "Chain" : "Lock";
  const lengthText = `${label}: ${pendingDimLengthFt.toFixed(2)} ft`;
  const fill = dimInputRepeat
    ? "rgba(180, 83, 9, 0.9)"
    : "rgba(8, 145, 178, 0.9)";
  const textColor = "#ffffff";

  return (
    <Group
      listening={false}
      data-testid="dim-input-cursor-badge"
      name="dim-input-cursor-badge"
      data-mode={dimInputRepeat ? "chain" : "lock"}
    >
      <Rect
        x={cursorPosition.x + 18 / stageScale}
        y={cursorPosition.y + 10 / stageScale}
        width={Math.max(70, lengthText.length * 7) / stageScale}
        height={18 / stageScale}
        fill={fill}
        cornerRadius={3 / stageScale}
        shadowColor="rgba(0,0,0,0.3)"
        shadowBlur={3 / stageScale}
        shadowOffset={{ x: 0, y: 1 / stageScale }}
      />
      <Text
        x={cursorPosition.x + 24 / stageScale}
        y={cursorPosition.y + 13 / stageScale}
        text={lengthText}
        fontSize={11 / stageScale}
        fill={textColor}
        fontStyle="bold"
        fontFamily="monospace"
      />
    </Group>
  );
}
