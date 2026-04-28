// @vitest-environment jsdom
/**
 * Task #2227 — Cursor-badge contract for the typed-dimension lock.
 *
 * The badge floats below the cursor on the canvas while a measure
 * draw is in progress and tells the estimator at a glance:
 *
 *   - whether a typed length is currently locked (no badge → no lock),
 *   - and whether that lock is one-shot (`Lock`, cyan) or chained
 *     across every click (`Chain`, amber).
 *
 * This suite pins the conditional render contract of
 * `DimInputCursorBadge` directly:
 *
 *   1. Hidden when `isDrawing` is false (no draw in progress) — even
 *      if a length is locked, the badge has no anchor to float under.
 *   2. Hidden when `cursorPosition` is null — same reason.
 *   3. Hidden when no length is locked (`pendingDimLengthFt` null,
 *      undefined, 0, or negative). Stale badges from a consumed
 *      lock would mislead the user about the next click's behaviour.
 *   4. Visible with the "Lock" label + cyan fill when chain mode is
 *      off, "Chain" + amber when chain mode is on. The badge text
 *      includes the locked length to two decimal places of feet.
 *
 * The component renders Konva nodes, not DOM, so the assertions
 * walk the live `Konva.Stage` (registered on `Konva.stages` by
 * react-konva when the Stage mounts) the same way the markup-layer
 * suites do (see `PlanMarkupLayer.bulkMoveOptimistic.test.tsx`).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import Konva from "konva";
import {
  DimInputCursorBadge,
  type DimInputCursorBadgeProps,
} from "../DimInputCursorBadge";

afterEach(() => cleanup());

function getActiveStage(): Konva.Stage {
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  expect(stages.length).toBeGreaterThan(0);
  return stages[stages.length - 1];
}

function findBadge(stage: Konva.Stage): Konva.Node | undefined {
  const layer = stage.getLayers()[0];
  if (!layer) return undefined;
  // Konva's `findOne` returns `undefined` (not `null`) when no
  // matching node exists, so callers compare with `toBeFalsy()`.
  return layer.findOne(".dim-input-cursor-badge") as Konva.Node | undefined;
}

function renderBadge(overrides: Partial<DimInputCursorBadgeProps> = {}) {
  const props: DimInputCursorBadgeProps = {
    isDrawing: true,
    cursorPosition: { x: 100, y: 100 },
    pendingDimLengthFt: 12.5,
    dimInputRepeat: false,
    stageScale: 1,
    ...overrides,
  };
  return render(
    <Stage width={400} height={400}>
      <Layer>
        <DimInputCursorBadge {...props} />
      </Layer>
    </Stage>,
  );
}

describe("DimInputCursorBadge (Task #2227)", () => {
  it("hides the badge when not drawing, even with a locked length", () => {
    renderBadge({ isDrawing: false, pendingDimLengthFt: 12 });
    expect(findBadge(getActiveStage())).toBeFalsy();
  });

  it("hides the badge when there is no cursor position", () => {
    renderBadge({ cursorPosition: null, pendingDimLengthFt: 12 });
    expect(findBadge(getActiveStage())).toBeFalsy();
  });

  it("hides the badge when no length is locked (null)", () => {
    renderBadge({ pendingDimLengthFt: null });
    expect(findBadge(getActiveStage())).toBeFalsy();
  });

  it("hides the badge when no length is locked (undefined)", () => {
    renderBadge({ pendingDimLengthFt: undefined });
    expect(findBadge(getActiveStage())).toBeFalsy();
  });

  it("hides the badge when the locked length is zero", () => {
    renderBadge({ pendingDimLengthFt: 0 });
    expect(findBadge(getActiveStage())).toBeFalsy();
  });

  it("renders a Lock badge in cyan when chain mode is off", () => {
    renderBadge({
      isDrawing: true,
      cursorPosition: { x: 50, y: 50 },
      pendingDimLengthFt: 12.5,
      dimInputRepeat: false,
    });
    const badge = findBadge(getActiveStage());
    expect(badge).toBeTruthy();
    expect(badge!.getAttr("data-mode")).toBe("lock");

    const group = badge as Konva.Group;
    const rect = group.findOne("Rect") as Konva.Rect;
    const text = group.findOne("Text") as Konva.Text;
    expect(rect).toBeTruthy();
    expect(text).toBeTruthy();
    // Cyan fill — see `DimInputCursorBadge.tsx`. Asserting the exact
    // colour pins the visual swap that distinguishes Lock from Chain.
    expect(rect.fill()).toBe("rgba(8, 145, 178, 0.9)");
    expect(text.text()).toBe("Lock: 12.50 ft");
  });

  it("renders a Chain badge in amber when chain mode is on", () => {
    renderBadge({
      isDrawing: true,
      cursorPosition: { x: 50, y: 50 },
      pendingDimLengthFt: 8,
      dimInputRepeat: true,
    });
    const badge = findBadge(getActiveStage());
    expect(badge).toBeTruthy();
    expect(badge!.getAttr("data-mode")).toBe("chain");

    const group = badge as Konva.Group;
    const rect = group.findOne("Rect") as Konva.Rect;
    const text = group.findOne("Text") as Konva.Text;
    // Amber fill — distinct from the cyan Lock palette.
    expect(rect.fill()).toBe("rgba(180, 83, 9, 0.9)");
    expect(text.text()).toBe("Chain: 8.00 ft");
  });

  it("re-renders the badge when chain mode toggles mid-draw", () => {
    const { rerender } = renderBadge({
      isDrawing: true,
      cursorPosition: { x: 50, y: 50 },
      pendingDimLengthFt: 4,
      dimInputRepeat: false,
    });
    let badge = findBadge(getActiveStage());
    expect(badge!.getAttr("data-mode")).toBe("lock");
    expect((badge as Konva.Group).findOne("Text")!.attrs.text).toBe(
      "Lock: 4.00 ft",
    );

    rerender(
      <Stage width={400} height={400}>
        <Layer>
          <DimInputCursorBadge
            isDrawing={true}
            cursorPosition={{ x: 50, y: 50 }}
            pendingDimLengthFt={4}
            dimInputRepeat={true}
            stageScale={1}
          />
        </Layer>
      </Stage>,
    );

    badge = findBadge(getActiveStage());
    expect(badge!.getAttr("data-mode")).toBe("chain");
    expect((badge as Konva.Group).findOne("Text")!.attrs.text).toBe(
      "Chain: 4.00 ft",
    );
  });
});
