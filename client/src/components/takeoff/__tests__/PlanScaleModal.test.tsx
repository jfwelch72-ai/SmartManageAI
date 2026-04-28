// @vitest-environment jsdom
/**
 * Task #2140 — Regression guard for `PlanScaleModal`.
 *
 * Two-point calibration moved into `InlineCalibrationDrawer`. The
 * modal must therefore be strictly Standard Scales + Custom ratio
 * with no "Calibrate" tab and no "Start Calibration" button. This
 * test pins that contract so a future refactor can't quietly
 * re-introduce the dual-flow state the task explicitly forbids.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlanScaleModal } from "../PlanScaleModal";

afterEach(() => cleanup());

describe("PlanScaleModal", () => {
  it("renders only the Standard Scales and Custom tabs (no Calibrate tab)", () => {
    render(
      <PlanScaleModal
        open
        onClose={vi.fn()}
        onApplyScale={vi.fn()}
        currentScalePxPerFoot={null}
      />,
    );

    expect(screen.getByTestId("tab-standard-scales")).toBeTruthy();
    expect(screen.getByTestId("tab-custom")).toBeTruthy();

    expect(screen.queryByTestId("tab-calibrate")).toBeNull();
    expect(screen.queryByTestId("button-start-calibration")).toBeNull();
  });
});
