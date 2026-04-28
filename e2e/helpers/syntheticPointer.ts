/**
 * Task #2221 — Synthetic pointer / touch event harness for the takeoff
 * mobile-stylus contract specs.
 *
 * The takeoff workspace's mobile/stylus precision pass (Task #2142,
 * runbook in `docs/runbooks/takeoff-stylus-hardware-qa.md`) is built on
 * top of `client/src/lib/pointerInput.ts`. Unit + jsdom integration
 * tests cover the helpers in isolation, but the four end-to-end
 * scenarios that mattered enough to ship a runbook for —
 *
 *   1. Palm rejected mid-stroke while a pen is in contact
 *   2. Stylus long-press opens the snap-mode HUD
 *   3. Two-finger rotate is gated by the per-user toggle
 *   4. The ribbon collapses low-priority groups on narrow viewports
 *
 * — used to require an actual iPad / Surface to verify because vitest
 * cannot fabricate `PointerEvent`s with `pointerType: "pen"` plus a
 * palm-shaped touch in the same frame against the real Konva DOM tree.
 *
 * This module gives Playwright specs a small, well-typed kit for
 * dispatching realistic pointer / touch sequences inside the page
 * context so the same scenarios can be asserted on plain CI hardware
 * (the dedicated `chromium-touch` Playwright project in
 * `playwright.config.ts` flips `hasTouch: true` so `Touch`/`TouchEvent`
 * constructors are available in the page).
 *
 * All gestures are dispatched via `page.evaluate` so Chromium builds
 * the events inside the real page context — that's the only way the
 * production listeners (Konva on `stage.container()`, the long-press
 * detector on `containerRef`) see a `pointerType` and `width`/`height`
 * they actually believe.
 */
import type { Page } from "@playwright/test";

export type PointerKind = "pen" | "touch" | "mouse";
export type PointerEventType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel";
export type TouchEventType = "touchstart" | "touchmove" | "touchend";

export interface SyntheticPointerInit {
  /** Stable pointerId for the lifetime of the gesture. The production
   *  long-press detector and palm tracker key off this. */
  pointerId: number;
  pointerType: PointerKind;
  clientX: number;
  clientY: number;
  /** Contact size in CSS px. Defaults to 1 (a clean stylus tip).
   *  Set both to a value above the palm-rejection band (default 24)
   *  to simulate a resting palm. */
  width?: number;
  height?: number;
  /** Surface Pen / Apple Pencil report pressures in 0..1; default 0.5
   *  for pen, 0 for touch. Provided so future tests that branch on
   *  pressure (e.g. "ignore feather-light pen rests") have a clean
   *  knob. */
  pressure?: number;
  isPrimary?: boolean;
}

export interface SyntheticTouch {
  /** Stable touch identifier. Touch lists must keep identifiers
   *  consistent across `touchstart` → `touchmove` → `touchend` for
   *  Konva to correlate them. */
  identifier: number;
  clientX: number;
  clientY: number;
  /** Touch contact radii in CSS px. Defaults to 5; bump to >24 to
   *  simulate a palm contact when paired with a pen `PointerEvent`. */
  radiusX?: number;
  radiusY?: number;
  force?: number;
}

/**
 * Dispatch a synthetic `PointerEvent` on the first matching CSS
 * selector. Runs entirely inside the page context so Chromium builds
 * a real `PointerEvent` (with `pointerType` honored) that bubbles
 * through the real DOM tree to whichever production listener is
 * registered upstream — Konva's listener on `stage.container()`, the
 * long-press detector on the takeoff `containerRef`, etc.
 */
export async function dispatchPointer(
  page: Page,
  selector: string,
  type: PointerEventType,
  init: SyntheticPointerInit,
): Promise<void> {
  await page.evaluate(
    ({ selector, type, init }) => {
      const target = document.querySelector(selector);
      if (!target) {
        throw new Error(`dispatchPointer: no element matched ${selector}`);
      }
      const evt = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: init.pointerId,
        pointerType: init.pointerType,
        clientX: init.clientX,
        clientY: init.clientY,
        width: init.width ?? 1,
        height: init.height ?? 1,
        pressure:
          init.pressure ?? (init.pointerType === "pen" ? 0.5 : 0),
        isPrimary: init.isPrimary ?? true,
      });
      target.dispatchEvent(evt);
    },
    { selector, type, init },
  );
}

/**
 * Dispatch a synthetic `TouchEvent` carrying the supplied touch list
 * at the given client coordinates. Mirrors the multi-touch payload
 * that the `useTakeoffInteractions` `handleTouchMove` hook reads via
 * `e.evt.touches[0..1]`. `touchend` events automatically receive an
 * empty touches list (per the DOM spec) while still publishing the
 * lifted touches in `changedTouches`.
 */
export async function dispatchTouch(
  page: Page,
  selector: string,
  type: TouchEventType,
  touches: SyntheticTouch[],
): Promise<void> {
  await page.evaluate(
    ({ selector, type, touches }) => {
      const target = document.querySelector(selector) as Element | null;
      if (!target) {
        throw new Error(`dispatchTouch: no element matched ${selector}`);
      }
      const builtTouches = touches.map(
        (t) =>
          new Touch({
            identifier: t.identifier,
            target,
            clientX: t.clientX,
            clientY: t.clientY,
            screenX: t.clientX,
            screenY: t.clientY,
            pageX: t.clientX,
            pageY: t.clientY,
            radiusX: t.radiusX ?? 5,
            radiusY: t.radiusY ?? 5,
            force: t.force ?? 1,
          }),
      );
      const list = type === "touchend" ? [] : builtTouches;
      const evt = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        touches: list as unknown as Touch[],
        targetTouches: list as unknown as Touch[],
        changedTouches: builtTouches as unknown as Touch[],
      });
      target.dispatchEvent(evt);
    },
    { selector, type, touches },
  );
}

/**
 * Convenience: dispatch a pen pointerdown, optional drift moves, then
 * a pen pointerup. Mirrors a clean stylus tap-and-hold used by the
 * snap-HUD long-press scenario.
 */
export async function synthesizeStylusTap(
  page: Page,
  selector: string,
  init: { pointerId: number; clientX: number; clientY: number },
  options: {
    /** ms to wait between pointerdown and pointerup. Defaults to 0
     *  (instant tap). Set above the configured `stylusLongPressMs`
     *  (default 500) to fire the long-press detector. */
    holdMs?: number;
    /** Optional intermediate moves dispatched while the pen is down,
     *  so callers can simulate a drifting hold (e.g. to assert the
     *  long-press cancels past the 8 px movement budget). */
    moves?: Array<{ clientX: number; clientY: number; afterMs?: number }>;
  } = {},
): Promise<void> {
  await dispatchPointer(page, selector, "pointerdown", {
    pointerId: init.pointerId,
    pointerType: "pen",
    clientX: init.clientX,
    clientY: init.clientY,
  });
  for (const move of options.moves ?? []) {
    if (move.afterMs && move.afterMs > 0) {
      await page.waitForTimeout(move.afterMs);
    }
    await dispatchPointer(page, selector, "pointermove", {
      pointerId: init.pointerId,
      pointerType: "pen",
      clientX: move.clientX,
      clientY: move.clientY,
    });
  }
  if (options.holdMs && options.holdMs > 0) {
    await page.waitForTimeout(options.holdMs);
  }
  await dispatchPointer(page, selector, "pointerup", {
    pointerId: init.pointerId,
    pointerType: "pen",
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

/**
 * Convenience: dispatch a fat-finger touch pointerdown that should
 * be treated as a palm by the production palm-rejection logic
 * (contact size > the configured band, default 24 px).
 */
export async function synthesizePalmContact(
  page: Page,
  selector: string,
  init: {
    pointerId: number;
    clientX: number;
    clientY: number;
    /** Contact size in CSS px. Defaults to 80 (clearly above the
     *  default 24 px palm-rejection band). */
    sizePx?: number;
  },
): Promise<void> {
  const size = init.sizePx ?? 80;
  await dispatchPointer(page, selector, "pointerdown", {
    pointerId: init.pointerId,
    pointerType: "touch",
    clientX: init.clientX,
    clientY: init.clientY,
    width: size,
    height: size,
  });
}

/**
 * Convenience: dispatch a complete two-finger rotate sequence that
 * twists the touch axis by the supplied angle (radians) around a
 * center point at a given radius. Issues a baseline `touchstart` +
 * `touchmove` (so the production code seeds `lastPinchAngleRef`),
 * a rotated `touchmove`, and a final `touchend`.
 *
 * Positive `angleRadians` rotates clockwise in screen space (matching
 * the canvas-frame interpretation in `useTakeoffInteractions`).
 */
export async function synthesizeTwoFingerRotate(
  page: Page,
  selector: string,
  opts: {
    centerX: number;
    centerY: number;
    /** Distance from the center to each touch point. */
    radius: number;
    /** Total rotation applied between baseline and the rotated frame. */
    angleRadians: number;
  },
): Promise<void> {
  const { centerX, centerY, radius, angleRadians } = opts;
  // Baseline frame: horizontal touch axis (angle = 0).
  const baseline: SyntheticTouch[] = [
    { identifier: 1, clientX: centerX - radius, clientY: centerY },
    { identifier: 2, clientX: centerX + radius, clientY: centerY },
  ];
  await dispatchTouch(page, selector, "touchstart", baseline);
  // The hook only runs its rotate accumulator on `touchmove` — it
  // needs `lastPinchAngleRef` seeded first, so we send the same
  // baseline as a touchmove to establish the angle reference.
  await dispatchTouch(page, selector, "touchmove", baseline);

  // Rotated frame: rotate both touches by `angleRadians` around the
  // center.
  const rotated: SyntheticTouch[] = baseline.map((t) => {
    const dx = t.clientX - centerX;
    const dy = t.clientY - centerY;
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    return {
      identifier: t.identifier,
      clientX: centerX + dx * cos - dy * sin,
      clientY: centerY + dx * sin + dy * cos,
    };
  });
  await dispatchTouch(page, selector, "touchmove", rotated);
  await dispatchTouch(page, selector, "touchend", rotated);
}
