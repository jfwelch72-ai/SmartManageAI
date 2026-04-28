/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  ActivePointerTracker,
  classifyPointer,
  contactSizePx,
  createLongPressDetector,
  DEFAULT_PALM_REJECTION_BAND_PX,
  interpretPinchPan,
  pinchPanSnapshot,
  shouldRejectAsPalm,
} from "../pointerInput";

function fakePointer(p: Partial<PointerEvent> & { pointerId: number; pointerType?: string }): PointerEvent {
  return {
    pointerId: p.pointerId,
    pointerType: p.pointerType ?? "touch",
    clientX: p.clientX ?? 0,
    clientY: p.clientY ?? 0,
    width: p.width ?? 0,
    height: p.height ?? 0,
  } as unknown as PointerEvent;
}

describe("pointerInput", () => {
  describe("classifyPointer", () => {
    it("returns the pointerType when set", () => {
      expect(classifyPointer({ pointerType: "pen" })).toBe("pen");
      expect(classifyPointer({ pointerType: "touch" })).toBe("touch");
      expect(classifyPointer({ pointerType: "mouse" })).toBe("mouse");
    });
    it("falls back to event type prefix for legacy events", () => {
      expect(classifyPointer({ type: "touchstart" })).toBe("touch");
      expect(classifyPointer({ type: "mousedown" })).toBe("mouse");
    });
  });

  describe("contactSizePx", () => {
    it("returns the largest dimension across width/height/radius", () => {
      expect(contactSizePx({ width: 10, height: 30 })).toBe(30);
      expect(contactSizePx({ radiusX: 20, radiusY: 5 })).toBe(40); // doubled
      expect(contactSizePx({ width: 50, radiusX: 5 })).toBe(50);
    });
  });

  describe("shouldRejectAsPalm", () => {
    it("rejects fat touches when a pen is active", () => {
      const ctx = { penActive: true, bandPx: DEFAULT_PALM_REJECTION_BAND_PX };
      expect(shouldRejectAsPalm({ pointerType: "touch", width: 40, height: 40 } as any, ctx)).toBe(true);
      expect(shouldRejectAsPalm({ pointerType: "touch", width: 10, height: 10 } as any, ctx)).toBe(false);
    });
    it("never rejects pen pointers", () => {
      expect(
        shouldRejectAsPalm({ pointerType: "pen", width: 999, height: 999 } as any, {
          penActive: true,
          bandPx: 24,
        }),
      ).toBe(false);
    });
    it("never rejects mouse pointers", () => {
      expect(
        shouldRejectAsPalm({ pointerType: "mouse", width: 999, height: 999 } as any, {
          penActive: true,
          bandPx: 24,
        }),
      ).toBe(false);
    });
    it("honors finger touches when no pen is active", () => {
      expect(
        shouldRejectAsPalm({ pointerType: "touch", width: 999, height: 999 } as any, {
          penActive: false,
          bandPx: 24,
        }),
      ).toBe(false);
    });
  });

  describe("ActivePointerTracker", () => {
    it("tracks pen vs touch", () => {
      const t = new ActivePointerTracker();
      t.down(fakePointer({ pointerId: 1, pointerType: "touch" }));
      expect(t.penActive).toBe(false);
      expect(t.touchCount).toBe(1);
      t.down(fakePointer({ pointerId: 2, pointerType: "pen" }));
      expect(t.penActive).toBe(true);
      t.up(fakePointer({ pointerId: 2, pointerType: "pen" }));
      expect(t.penActive).toBe(false);
    });
  });

  describe("interpretPinchPan", () => {
    it("returns null without a previous snapshot", () => {
      const next = pinchPanSnapshot([
        { clientX: 0, clientY: 0 } as Touch,
        { clientX: 100, clientY: 0 } as Touch,
      ]);
      expect(next).not.toBeNull();
      expect(interpretPinchPan(null, next!)).toBeNull();
    });
    it("computes scale, pan, rotate between two snapshots", () => {
      const prev = pinchPanSnapshot([
        { clientX: 0, clientY: 0 } as Touch,
        { clientX: 100, clientY: 0 } as Touch,
      ])!;
      const next = pinchPanSnapshot([
        { clientX: 10, clientY: 10 } as Touch,
        { clientX: 210, clientY: 10 } as Touch,
      ])!;
      const step = interpretPinchPan(prev, next)!;
      expect(step.scaleDelta).toBe(2); // distance doubled
      expect(step.panX).toBe(60); // center moved from 50 → 110
      expect(step.panY).toBe(10);
      expect(step.rotateDelta).toBe(0); // both horizontal
    });
  });

  describe("createLongPressDetector", () => {
    it("fires after holdMs with no movement", async () => {
      vi.useFakeTimers();
      const onLongPress = vi.fn();
      const det = createLongPressDetector({ holdMs: 500, onLongPress });
      det.start(fakePointer({ pointerId: 1, pointerType: "pen", clientX: 50, clientY: 60 }));
      vi.advanceTimersByTime(499);
      expect(onLongPress).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onLongPress).toHaveBeenCalledWith(
        { x: 50, y: 60 },
        expect.objectContaining({
          configuredHoldMs: 500,
          // Task #2220 — measured dwell is wall-clock elapsed since
          // pointer-down, so it must be >= the configured threshold.
          measuredDwellMs: expect.any(Number) as unknown as number,
        }),
      );
      const meta = onLongPress.mock.calls[0][1] as { measuredDwellMs: number };
      expect(meta.measuredDwellMs).toBeGreaterThanOrEqual(500);
      vi.useRealTimers();
    });

    it("reports a measured dwell that grows with main-thread delay", () => {
      // Demonstrates the *behavioral* metric the dashboard tracks:
      // when timers fire late (busy main thread), measuredDwellMs
      // exceeds the configured holdMs. We can't simulate jank with
      // fake timers (advanceTimersByTime is instantaneous), so verify
      // that with real timers the measurement is bounded above the
      // threshold and reasonable.
      return new Promise<void>((resolve, reject) => {
        const onLongPress = vi.fn();
        const det = createLongPressDetector({ holdMs: 50, onLongPress });
        det.start(fakePointer({ pointerId: 1, pointerType: "pen", clientX: 0, clientY: 0 }));
        setTimeout(() => {
          try {
            expect(onLongPress).toHaveBeenCalledTimes(1);
            const meta = onLongPress.mock.calls[0][1] as {
              measuredDwellMs: number;
              configuredHoldMs: number;
            };
            expect(meta.configuredHoldMs).toBe(50);
            expect(meta.measuredDwellMs).toBeGreaterThanOrEqual(50);
            // Sanity ceiling — should fire within a small slack.
            expect(meta.measuredDwellMs).toBeLessThan(500);
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 120);
      });
    });
    it("cancels when movement exceeds budget", () => {
      vi.useFakeTimers();
      const onLongPress = vi.fn();
      const det = createLongPressDetector({ holdMs: 500, movementBudgetPx: 8, onLongPress });
      det.start(fakePointer({ pointerId: 1, pointerType: "pen", clientX: 0, clientY: 0 }));
      det.move(fakePointer({ pointerId: 1, pointerType: "pen", clientX: 20, clientY: 0 }));
      vi.advanceTimersByTime(600);
      expect(onLongPress).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
    it("ignores touch pointers when penOnly is true (default)", () => {
      vi.useFakeTimers();
      const onLongPress = vi.fn();
      const det = createLongPressDetector({ holdMs: 500, onLongPress });
      det.start(fakePointer({ pointerId: 1, pointerType: "touch" }));
      vi.advanceTimersByTime(600);
      expect(onLongPress).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
    it("can be cancelled by end()", () => {
      vi.useFakeTimers();
      const onLongPress = vi.fn();
      const det = createLongPressDetector({ holdMs: 500, onLongPress });
      det.start(fakePointer({ pointerId: 1, pointerType: "pen" }));
      det.end(fakePointer({ pointerId: 1, pointerType: "pen" }));
      vi.advanceTimersByTime(600);
      expect(onLongPress).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
