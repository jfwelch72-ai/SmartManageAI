/**
 * Task #2142 — Pointer input utility.
 *
 * Single source of truth for the takeoff workspace's mobile / stylus
 * input contract (Section 7 of the Takeoff Interaction Map):
 *
 *   • classifyPointer(evt)         → "mouse" | "touch" | "pen"
 *   • shouldRejectAsPalm(evt, ctx) → palm rejection: drop touches whose
 *                                    radiusX/radiusY (or PointerEvent
 *                                    width/height) exceeds the band
 *                                    while a stylus is in contact.
 *   • createLongPressDetector(...) → 500 ms long-press w/ 8 px movement
 *                                    budget; fires the supplied callback
 *                                    with the original touch point.
 *   • interpretPinchPan(touches)   → translate two-finger gestures into
 *                                    pan + zoom (+ optional rotate).
 *
 * All raw `TouchEvent` / `PointerEvent` reasoning the takeoff surface
 * does for mobile/stylus must go through this file. Callers above
 * (PlanMarkupLayer, CanvasViewport) should not parse `Touch.radiusX`
 * or PointerEvent `width/height` themselves; let this module be the
 * one place we tune palm-rejection heuristics.
 */

export type PointerKind = "mouse" | "touch" | "pen";

export const DEFAULT_PALM_REJECTION_BAND_PX = 24;
export const DEFAULT_STYLUS_LONG_PRESS_MS = 500;
export const STYLUS_LONG_PRESS_MOVEMENT_BUDGET_PX = 8;

/** PointerEvent.pointerType is the canonical signal; older browsers
 *  may surface only TouchEvent / MouseEvent, in which case we infer
 *  from the event type name. */
export function classifyPointer(
  evt: PointerEvent | MouseEvent | TouchEvent | { pointerType?: string; type?: string },
): PointerKind {
  const pointerType = (evt as { pointerType?: string }).pointerType;
  if (pointerType === "pen") return "pen";
  if (pointerType === "touch") return "touch";
  if (pointerType === "mouse") return "mouse";
  const type = (evt as { type?: string }).type ?? "";
  if (type.startsWith("touch")) return "touch";
  return "mouse";
}

/** Largest contact dimension in CSS pixels. PointerEvent width/height
 *  are normalized to CSS px; legacy Touch.radiusX/radiusY return half-
 *  axis values so we double them to get an effective dimension. */
export function contactSizePx(
  evt: PointerEvent | Touch | { width?: number; height?: number; radiusX?: number; radiusY?: number },
): number {
  const e = evt as { width?: number; height?: number; radiusX?: number; radiusY?: number };
  const widthPx = typeof e.width === "number" ? e.width : 0;
  const heightPx = typeof e.height === "number" ? e.height : 0;
  const rx = typeof e.radiusX === "number" ? e.radiusX * 2 : 0;
  const ry = typeof e.radiusY === "number" ? e.radiusY * 2 : 0;
  return Math.max(widthPx, heightPx, rx, ry);
}

export interface PalmRejectionContext {
  /** True when at least one active pointer is a stylus (pen). When
   *  false, finger touches are honored normally. */
  penActive: boolean;
  /** Maximum acceptable contact size for a finger touch while a pen
   *  is in contact. Touches whose largest dimension exceeds this
   *  band are treated as palm rest and dropped. */
  bandPx: number;
}

/** Returns true when the supplied pointer event should be ignored as
 *  a palm. We only reject finger touches (pointerType === "touch")
 *  whose contact size exceeds the band; pen and mouse events always
 *  pass through. When no stylus is in contact the band is irrelevant
 *  — finger taps work normally. */
export function shouldRejectAsPalm(
  evt: PointerEvent | Touch | { pointerType?: string },
  ctx: PalmRejectionContext,
): boolean {
  if (!ctx.penActive) return false;
  const pointerType = (evt as { pointerType?: string }).pointerType;
  // Touch.radiusX exists on Touch (no pointerType); treat as touch.
  const isTouch = pointerType === "touch" || pointerType === undefined;
  if (!isTouch) return false;
  const size = contactSizePx(evt as { width?: number; height?: number; radiusX?: number; radiusY?: number });
  return size > ctx.bandPx;
}

/**
 * Tracks active pointers so callers know whether a stylus is currently
 * in contact. Feed every `pointerdown` and `pointerup` (or
 * `pointercancel`) into the matching method; `penActive` reflects the
 * latest state.
 *
 * Designed to be cheap to construct (one per surface) and self-contained
 * — the underlying state is a Map keyed by pointerId so it correctly
 * handles browsers that interleave pen + touch pointers.
 */
export class ActivePointerTracker {
  private active = new Map<number, PointerKind>();

  down(evt: PointerEvent): void {
    this.active.set(evt.pointerId, classifyPointer(evt));
  }

  up(evt: PointerEvent): void {
    this.active.delete(evt.pointerId);
  }

  clear(): void {
    this.active.clear();
  }

  /** True when at least one active pointer is a pen. */
  get penActive(): boolean {
    let pen = false;
    // The TS target in this project is bundler/esnext, but the
    // Map.values() iterator hits TS2802 in our compiler config when
    // consumed via `for (... of ...)`. forEach sidesteps that without
    // requiring tsconfig changes.
    this.active.forEach((k) => {
      if (k === "pen") pen = true;
    });
    return pen;
  }

  get touchCount(): number {
    let n = 0;
    this.active.forEach((k) => {
      if (k === "touch") n++;
    });
    return n;
  }
}

/** Return value from a pinch-pan gesture interpretation step. Callers
 *  apply these incrementally to their stage transform. */
export interface PinchPanStep {
  /** Multiplicative zoom delta (1 = no change). */
  scaleDelta: number;
  /** Pixel pan in client coordinates since the previous step. */
  panX: number;
  panY: number;
  /** Rotation delta in radians (positive = counter-clockwise). Always
   *  computed; callers gate the apply on the user's "Allow rotate"
   *  preference. */
  rotateDelta: number;
  /** Center of the pinch in client coords for transform-around. */
  centerX: number;
  centerY: number;
}

interface PinchPanState {
  dist: number;
  angle: number;
  centerX: number;
  centerY: number;
}

/** Snapshot the geometry of two touches so subsequent calls can
 *  compute incremental deltas. */
export function pinchPanSnapshot(touches: ArrayLike<Touch>): PinchPanState | null {
  if (touches.length < 2) return null;
  const t1 = touches[0];
  const t2 = touches[1];
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return {
    dist: Math.sqrt(dx * dx + dy * dy),
    angle: Math.atan2(dy, dx),
    centerX: (t1.clientX + t2.clientX) / 2,
    centerY: (t1.clientY + t2.clientY) / 2,
  };
}

/** Compare two snapshots and return the incremental pan / zoom /
 *  rotate. `prev` may be null on the first frame of a pinch — in that
 *  case the function returns null and callers should just store the
 *  fresh snapshot. */
export function interpretPinchPan(
  prev: PinchPanState | null,
  next: PinchPanState,
): PinchPanStep | null {
  if (!prev) return null;
  const scaleDelta = prev.dist > 0 ? next.dist / prev.dist : 1;
  return {
    scaleDelta,
    panX: next.centerX - prev.centerX,
    panY: next.centerY - prev.centerY,
    rotateDelta: next.angle - prev.angle,
    centerX: next.centerX,
    centerY: next.centerY,
  };
}

export interface LongPressDetectorOptions {
  /** Hold duration in ms before the long-press fires. */
  holdMs?: number;
  /** Maximum movement (CSS px) allowed during the hold without
   *  cancelling the gesture. */
  movementBudgetPx?: number;
  /** Only fire for pen pointers (the takeoff snap-HUD spec). When
   *  false, fires for any pointer kind. Default: true. */
  penOnly?: boolean;
  /** Callback fired when the long-press completes successfully.
   *  The second argument carries gesture telemetry meta:
   *  `measuredDwellMs` is the wall-clock elapsed from pointer-down to
   *  fire (always >= configured `holdMs`; gap reflects timer/main-
   *  thread drift), and `configuredHoldMs` is the threshold in effect
   *  for this gesture. Telemetry consumers should record
   *  `measuredDwellMs` so dwell distributions reflect real interaction
   *  behavior, not the setting. */
  onLongPress: (
    point: { x: number; y: number },
    meta: { measuredDwellMs: number; configuredHoldMs: number },
  ) => void;
}

export interface LongPressDetector {
  start: (evt: PointerEvent) => void;
  move: (evt: PointerEvent) => void;
  end: (evt?: PointerEvent) => void;
  /** Cancel any pending hold immediately. */
  cancel: () => void;
}

/** Builds a detector that tracks a single pointer's hold duration and
 *  fires a callback when it crosses the threshold without exceeding
 *  the movement budget. The detector is stateless across pointers —
 *  any new `start` cancels a pending hold. */
export function createLongPressDetector(opts: LongPressDetectorOptions): LongPressDetector {
  const holdMs = opts.holdMs ?? DEFAULT_STYLUS_LONG_PRESS_MS;
  const budget = opts.movementBudgetPx ?? STYLUS_LONG_PRESS_MOVEMENT_BUDGET_PX;
  const penOnly = opts.penOnly ?? true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let startTimeMs = 0;
  let activePointerId: number | null = null;

  // performance.now() when present (monotonic, sub-ms) and Date.now()
  // otherwise (test environments / very old browsers without
  // performance API). Both are wall-clock-monotonic enough for the
  // sub-second dwell measurement we need.
  const nowMs = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    activePointerId = null;
  };

  return {
    start(evt: PointerEvent) {
      cancel();
      const kind = classifyPointer(evt);
      if (penOnly && kind !== "pen") return;
      activePointerId = evt.pointerId;
      startX = evt.clientX;
      startY = evt.clientY;
      startTimeMs = nowMs();
      timer = setTimeout(() => {
        timer = null;
        // Measured dwell — wall-clock elapsed since pointer-down.
        // Always >= holdMs; the gap is timer/main-thread drift and is
        // the actual signal we want telemetry to surface.
        const measuredDwellMs = Math.max(0, Math.round(nowMs() - startTimeMs));
        opts.onLongPress(
          { x: startX, y: startY },
          { measuredDwellMs, configuredHoldMs: holdMs },
        );
      }, holdMs);
    },
    move(evt: PointerEvent) {
      if (timer === null || activePointerId === null) return;
      if (evt.pointerId !== activePointerId) return;
      const dx = evt.clientX - startX;
      const dy = evt.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > budget) cancel();
    },
    end(evt?: PointerEvent) {
      if (evt && activePointerId !== null && evt.pointerId !== activePointerId) return;
      cancel();
    },
    cancel,
  };
}
