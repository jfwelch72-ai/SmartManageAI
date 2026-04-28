// @vitest-environment jsdom
/**
 * Task #2344 — Bottom-bar calibration chip uses the four-level
 * `SheetCalibrationConfidence` helper output instead of the old
 * binary `scaleSource`/`scaleConfidence` derive.
 *
 * Pins the contract so a future refactor that drops the
 * `calibrationConfidence` prop (or stops surfacing the level / drift
 * marker) regresses the chip back to the binary "calibrated dot"
 * estimators complained about.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { WorkspaceBottomBar } from "../WorkspaceBottomBar";
import type { TakeoffSheet } from "@shared/schema";
import type { SheetCalibrationConfidence } from "../../sheetCalibrationConfidence";

afterEach(() => cleanup());

const baseSheet: TakeoffSheet = {
  id: "s1",
  sheetName: "A1",
  scalePxPerFoot: 24 as unknown as TakeoffSheet["scalePxPerFoot"],
  scaleLabel: '1/4" = 1\'',
  units: "ft",
} as TakeoffSheet;

const baseProps = {
  selectedMeasurementCount: 0,
  bulkDeletePending: false,
  onBulkDelete: () => {},
  onClearSelection: () => {},
  selectedSheet: "s1",
  measurements: [],
  showCostPanel: false,
  onToggleCostPanel: () => {},
  showOverlaySlider: false,
  onToggleOverlaySlider: () => {},
  showMeasurementTable: false,
  onToggleMeasurementTable: () => {},
  showReviewQueue: false,
  onToggleReviewQueue: () => {},
  reviewQueueCount: null,
  stageScale: 1,
  currentSheet: baseSheet,
};

const HIGH_CONF: SheetCalibrationConfidence = {
  confidence: "HIGH",
  label: "High",
  dotClass: "bg-green-500 dark:bg-green-400",
  chipClass: "border-green-500/50",
  sourceText: "Calibrated by you (two-point ruler)",
  tooltip: "High confidence tooltip.",
  measurementCount: 12,
  hasDrift: false,
  driftLabels: [],
};

const LOW_DRIFT_CONF: SheetCalibrationConfidence = {
  confidence: "LOW",
  label: "Low",
  dotClass: "bg-orange-500 dark:bg-orange-400",
  chipClass: "border-orange-500/50",
  sourceText: "Auto-detected from sheet",
  tooltip: "Low confidence with drift.",
  measurementCount: 3,
  hasDrift: true,
  driftLabels: ['1/8" = 1\''],
};

describe("WorkspaceBottomBar calibration chip (Task #2344)", () => {
  it("renders the supplied four-level confidence label and data-attribute", () => {
    render(<WorkspaceBottomBar {...baseProps} calibrationConfidence={HIGH_CONF} />);
    const chip = screen.getByTestId("status-calibration-chip");
    expect(chip.getAttribute("data-confidence")).toBe("HIGH");
    expect(chip.getAttribute("title")).toBe("High confidence tooltip.");
    expect(screen.getByTestId("text-scale-confidence").textContent).toContain("High");
    // Drift marker should be absent when hasDrift is false.
    expect(screen.queryByTestId("status-calibration-chip-drift")).toBeNull();
  });

  it("surfaces the drift marker when the helper reports drift", () => {
    render(
      <WorkspaceBottomBar {...baseProps} calibrationConfidence={LOW_DRIFT_CONF} />,
    );
    const chip = screen.getByTestId("status-calibration-chip");
    expect(chip.getAttribute("data-confidence")).toBe("LOW");
    expect(screen.getByTestId("status-calibration-chip-drift")).toBeTruthy();
    // The mobile chip mirrors the same drift marker for phone users.
    expect(screen.getByTestId("status-calibration-mobile-drift")).toBeTruthy();
  });

  it("falls back to UNVERIFIED when no calibrationConfidence is supplied", () => {
    render(<WorkspaceBottomBar {...baseProps} calibrationConfidence={null} />);
    const chip = screen.getByTestId("status-calibration-chip");
    expect(chip.getAttribute("data-confidence")).toBe("UNVERIFIED");
  });

  it("opens the calibration drawer when the desktop chip is clicked", () => {
    const onOpenCalibration = vi.fn();
    render(
      <WorkspaceBottomBar
        {...baseProps}
        calibrationConfidence={HIGH_CONF}
        onOpenCalibration={onOpenCalibration}
      />,
    );
    const chip = screen.getByTestId("status-calibration-chip");
    expect(chip.tagName).toBe("BUTTON");
    fireEvent.click(chip);
    expect(onOpenCalibration).toHaveBeenCalledTimes(1);
  });

  it("opens the calibration drawer when the mobile chip is tapped", () => {
    const onOpenCalibration = vi.fn();
    render(
      <WorkspaceBottomBar
        {...baseProps}
        calibrationConfidence={HIGH_CONF}
        onOpenCalibration={onOpenCalibration}
      />,
    );
    const chip = screen.getByTestId("status-calibration-mobile");
    expect(chip.tagName).toBe("BUTTON");
    fireEvent.click(chip);
    expect(onOpenCalibration).toHaveBeenCalledTimes(1);
  });

  it("renders the chip as a non-interactive span when no onOpenCalibration is supplied", () => {
    render(<WorkspaceBottomBar {...baseProps} calibrationConfidence={HIGH_CONF} />);
    const chip = screen.getByTestId("status-calibration-chip");
    expect(chip.tagName).toBe("SPAN");
  });
});
