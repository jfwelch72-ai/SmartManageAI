import { useEffect, useRef } from "react";
import {
  createLongPressDetector,
  type LongPressDetectorOptions,
} from "@/lib/pointerInput";

export interface UseStylusLongPressOptions {
  holdMs: number;
  onLongPress: LongPressDetectorOptions["onLongPress"];
  penOnly?: boolean;
  movementBudgetPx?: number;
  enabled?: boolean;
}

/**
 * Task #2142 / #2205 — Owns the takeoff canvas's stylus long-press →
 * snap HUD wiring. Attaches pointer listeners to `targetRef.current`
 * and drives a `createLongPressDetector` configured from the user's
 * stylus prefs. Extracted from `TakeoffWorkspace` so the wiring
 * contract (penOnly default, listener set, holdMs reactivity) can be
 * exercised by integration tests without mounting the entire 4k-line
 * workspace component, and so future surfaces (e.g. the markup layer's
 * own gesture pad) can reuse the same listener bookkeeping.
 *
 * The detector cancels any pending hold on cleanup and on `holdMs`
 * changes, so toggling the user pref while a press is pending will
 * abort it cleanly. `onLongPress` is intentionally NOT a dep of the
 * effect — TakeoffWorkspace passes an inline closure that changes on
 * every render, and rebinding listeners on every render would tear
 * down a pending hold timer mid-press. The latest callback is read
 * through a ref so the wiring stays mounted across re-renders while
 * still firing the most recent closure.
 */
export function useStylusLongPress(
  targetRef: React.RefObject<HTMLElement | null>,
  opts: UseStylusLongPressOptions,
): void {
  const {
    holdMs,
    onLongPress,
    penOnly = true,
    movementBudgetPx,
    enabled = true,
  } = opts;

  // Hold the latest callback in a ref so the effect below can call
  // through to the most recent identity without listing it as a dep.
  // This is the standard React pattern for "I want a stable handler
  // that always reflects the latest props".
  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  useEffect(() => {
    if (!enabled) return;
    const el = targetRef.current;
    if (!el) return;
    const detector = createLongPressDetector({
      holdMs,
      penOnly,
      movementBudgetPx,
      onLongPress: (point, meta) => onLongPressRef.current(point, meta),
    });
    const onDown = (e: PointerEvent) => detector.start(e);
    const onMove = (e: PointerEvent) => detector.move(e);
    const onUp = (e: PointerEvent) => detector.end(e);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onUp);
    return () => {
      detector.cancel();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onUp);
    };
  }, [targetRef, holdMs, penOnly, movementBudgetPx, enabled]);
}
