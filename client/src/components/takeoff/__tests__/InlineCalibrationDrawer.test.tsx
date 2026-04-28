// @vitest-environment jsdom
/**
 * Task #2140 — Functional coverage for the inline calibration drawer.
 *
 * The component-level e2e (`e2e/takeoff-typed-dim-and-calibration.spec.ts`)
 * pins the visible UI; this suite pins the **save contract** that
 * actually drives `PATCH /api/takeoff/sheets/:id/calibration`:
 *
 *   1. Save is disabled until two points + a valid distance.
 *   2. A successful Save calls `setCalibrationDistance` with the
 *      raw scalar (in `units`) the legacy save handler expects, then
 *      calls `onSaveCalibration` exactly once. Together with the
 *      e2e UI test this completes the "two-point calibration commit
 *      updates scale" check the code review asked for.
 *   3. The drawer surfaces a live preview scale (`px / ft`) once
 *      both points + a valid distance are present, and a plain-text
 *      current-scale label that callers can use for the
 *      "scale confirmation path".
 *   4. Multi-region "Add region" pushes a new region with the right
 *      pixel/feet pair and resets the capture state.
 *   5. The "Use Standard Scale" link delegates to the parent without
 *      touching the calibration distance state.
 *   6. The "Apply to entire Sheet Set" checkbox is disabled while
 *      the feature flag is off.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InlineCalibrationDrawer } from "../InlineCalibrationDrawer";

afterEach(() => cleanup());

interface Overrides {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  calibrationMode?: "idle" | "first-point" | "second-point";
  setCalibrationMode?: (m: "idle" | "first-point" | "second-point") => void;
  calibrationPoints?: { x: number; y: number }[];
  setCalibrationPoints?: (pts: { x: number; y: number }[]) => void;
  calibrationDistance?: string;
  setCalibrationDistance?: (v: string) => void;
  units?: "ft" | "m";
  setUnits?: (u: "ft" | "m") => void;
  currentScalePxPerFoot?: number | null;
  onSaveCalibration?: (distanceFt?: number) => void | Promise<void>;
  onUseStandardScale?: () => void;
  multiCalibMode?: boolean;
  setMultiCalibMode?: (v: boolean) => void;
  multiCalibPoints?: Array<{
    points: [{ x: number; y: number }, { x: number; y: number }];
    distance: number;
  }>;
  setMultiCalibPoints?: (
    v: Array<{
      points: [{ x: number; y: number }, { x: number; y: number }];
      distance: number;
    }>,
  ) => void;
}

function renderDrawer(overrides: Overrides = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    calibrationMode: "idle" as const,
    setCalibrationMode: vi.fn(),
    calibrationPoints: [],
    setCalibrationPoints: vi.fn(),
    calibrationDistance: "",
    setCalibrationDistance: vi.fn(),
    units: "ft" as const,
    setUnits: vi.fn(),
    currentScalePxPerFoot: null,
    onSaveCalibration: vi.fn(),
    onUseStandardScale: vi.fn(),
    multiCalibMode: false,
    setMultiCalibMode: vi.fn(),
    multiCalibPoints: [],
    setMultiCalibPoints: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <TooltipProvider>
      <InlineCalibrationDrawer {...props} />
    </TooltipProvider>,
  );
  return { ...utils, props };
}

describe("InlineCalibrationDrawer (Task #2140) — save contract", () => {
  it("disables Save until two points AND a valid distance are present", () => {
    const { rerender, props } = renderDrawer({ calibrationPoints: [] });
    expect(
      (screen.getByTestId("button-inline-calibration-save") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Two points but no distance → still disabled.
    cleanup();
    renderDrawer({
      calibrationPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    });
    expect(
      (screen.getByTestId("button-inline-calibration-save") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Valid distance but no points → still disabled.
    cleanup();
    const { ...rest } = renderDrawer({ calibrationDistance: "10" });
    expect(
      (screen.getByTestId("button-inline-calibration-save") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    void rerender;
    void props;
    void rest;
  });

  it("commits the parsed feet value through setCalibrationDistance and calls onSaveCalibration", async () => {
    const setCalibrationDistance = vi.fn();
    const onSaveCalibration = vi.fn();
    renderDrawer({
      calibrationPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      setCalibrationDistance,
      onSaveCalibration,
    });
    const distanceInput = screen.getByTestId(
      "input-inline-calibration-distance",
    );
    fireEvent.change(distanceInput, { target: { value: `12'6"` } });

    // Live preview = px/ft (100 px over 12.5 ft = 8.00 px/ft).
    expect(
      screen.getByTestId("text-inline-calibration-preview-scale").textContent,
    ).toMatch(/^8\.00 px\/ft$/);

    const save = screen.getByTestId(
      "button-inline-calibration-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      expect(setCalibrationDistance).toHaveBeenCalledTimes(1);
      expect(onSaveCalibration).toHaveBeenCalledTimes(1);
    });
    // The legacy save handler reads `calibrationDistance` as a raw
    // scalar in `units`. For ft units the typed-feet value passes
    // through unchanged.
    expect(setCalibrationDistance).toHaveBeenCalledWith("12.5");
  });

  it("converts the typed feet value back to meters before saving when units='m'", async () => {
    const setCalibrationDistance = vi.fn();
    const onSaveCalibration = vi.fn();
    renderDrawer({
      units: "m",
      calibrationPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      setCalibrationDistance,
      onSaveCalibration,
    });
    const distanceInput = screen.getByTestId(
      "input-inline-calibration-distance",
    );
    // 3 m → ~9.84 ft → must be saved back as ~3 m, not ~9.84.
    fireEvent.change(distanceInput, { target: { value: "3" } });

    const save = screen.getByTestId(
      "button-inline-calibration-save",
    ) as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() => expect(onSaveCalibration).toHaveBeenCalled());
    const arg = setCalibrationDistance.mock.calls[0][0];
    expect(parseFloat(arg)).toBeCloseTo(3.0, 4);
  });

  it("surfaces parse errors inline and keeps Save disabled", () => {
    renderDrawer({
      calibrationPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    const distanceInput = screen.getByTestId(
      "input-inline-calibration-distance",
    );
    fireEvent.change(distanceInput, { target: { value: "not-a-number" } });
    expect(screen.getByTestId("text-inline-calibration-error")).toBeTruthy();
    expect(
      (screen.getByTestId("button-inline-calibration-save") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('renders a "current scale" confirmation when the sheet is calibrated', () => {
    renderDrawer({ currentScalePxPerFoot: 96 });
    expect(
      screen.getByTestId("text-inline-calibration-current-scale").textContent,
    ).toMatch(/^Current scale: 96\.00 px\/ft$/);
  });

  it("Add region pushes the captured points + distance and resets capture", () => {
    const setMultiCalibPoints = vi.fn();
    const setCalibrationPoints = vi.fn();
    const setCalibrationMode = vi.fn();
    renderDrawer({
      calibrationPoints: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
      setCalibrationPoints,
      setCalibrationMode,
      multiCalibPoints: [],
      setMultiCalibPoints,
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByTestId("button-inline-calibration-add-region"));
    expect(setMultiCalibPoints).toHaveBeenCalledTimes(1);
    const region = setMultiCalibPoints.mock.calls[0][0][0];
    expect(region.distance).toBeCloseTo(5, 6);
    expect(region.points[0]).toEqual({ x: 10, y: 10 });
    expect(setCalibrationPoints).toHaveBeenCalledWith([]);
    expect(setCalibrationMode).toHaveBeenCalledWith("first-point");
  });

  it("Add region forwards the optional region label when provided", () => {
    const setMultiCalibPoints = vi.fn();
    renderDrawer({
      calibrationPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      multiCalibPoints: [],
      setMultiCalibPoints,
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "10" } },
    );
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-region-label"),
      { target: { value: "Foundation detail" } },
    );
    fireEvent.click(screen.getByTestId("button-inline-calibration-add-region"));
    const region = setMultiCalibPoints.mock.calls[0][0][0];
    expect(region.label).toBe("Foundation detail");
  });

  it("Add region omits an empty/whitespace-only label", () => {
    const setMultiCalibPoints = vi.fn();
    renderDrawer({
      calibrationPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      multiCalibPoints: [],
      setMultiCalibPoints,
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "10" } },
    );
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-region-label"),
      { target: { value: "   " } },
    );
    fireEvent.click(screen.getByTestId("button-inline-calibration-add-region"));
    const region = setMultiCalibPoints.mock.calls[0][0][0];
    expect(region.label).toBeUndefined();
  });

  it('"Use Standard Scale" hands off to the parent without writing distance', () => {
    const onUseStandardScale = vi.fn();
    const setCalibrationDistance = vi.fn();
    renderDrawer({ onUseStandardScale, setCalibrationDistance });
    fireEvent.click(
      screen.getByTestId("button-inline-calibration-use-standard"),
    );
    expect(onUseStandardScale).toHaveBeenCalledTimes(1);
    expect(setCalibrationDistance).not.toHaveBeenCalled();
  });

  it("disables the sheet-set checkbox while the feature flag is off", () => {
    renderDrawer();
    const checkbox = screen.getByTestId(
      "checkbox-apply-sheet-set",
    ) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
  });

  // Task #2320 — Typed-vs-AI delta warning. The drawer compares the
  // user's preview scale against the detector's pxPerFoot and only
  // surfaces the warning when the deltas disagree by more than 5%.
  // "Use detected" rewrites the typed feet value so the preview
  // realigns with the detector exactly.
  it("does NOT show the AI-delta warning when typed and detected scales agree (<5%)", () => {
    // 100 px / 12.5 ft = 8.00 px/ft. Detector at 8.20 px/ft → 2.5% delta.
    renderDrawer({
      calibrationPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      // @ts-expect-error overrides interface doesn't enumerate every prop
      aiDetectedScale: { label: '1/8" = 1\'-0"', pxPerFoot: 8.2 },
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: `12'6"` } },
    );
    expect(
      screen.queryByTestId("inline-calibration-ai-delta-warning"),
    ).toBeNull();
  });

  it("renders the AI-delta warning when typed scale disagrees with detected by >5%", () => {
    // 100 px / 10 ft = 10.00 px/ft. Detector at 8.00 px/ft → 25% delta.
    renderDrawer({
      calibrationPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      // @ts-expect-error overrides interface doesn't enumerate every prop
      aiDetectedScale: { label: '1/8" = 1\'-0"', pxPerFoot: 8 },
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "10" } },
    );
    expect(
      screen.getByTestId("inline-calibration-ai-delta-warning"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("text-inline-calibration-ai-scale-label").textContent,
    ).toBe('1/8" = 1\'-0"');
    expect(
      screen
        .getByTestId("text-inline-calibration-ai-delta-percent")
        .textContent?.replace(/\s/g, ""),
    ).toMatch(/^25\.0%$/);
  });

  it('"Use detected" rewrites the typed distance so the preview matches the detector', () => {
    // 100 px / 10 ft = 10.00 px/ft typed. Detector at 8 px/ft.
    // After "Use detected" the typed distance should become 12.5 ft
    // (100 / 8) so the preview re-aligns at 8.00 px/ft and the
    // warning self-dismisses.
    renderDrawer({
      calibrationPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      // @ts-expect-error overrides interface doesn't enumerate every prop
      aiDetectedScale: { label: '1/8" = 1\'-0"', pxPerFoot: 8 },
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "10" } },
    );
    fireEvent.click(
      screen.getByTestId("button-inline-calibration-use-detected"),
    );
    // Preview now reports 8.00 px/ft and the warning is gone.
    expect(
      screen.getByTestId("text-inline-calibration-preview-scale").textContent,
    ).toMatch(/^8\.00 px\/ft$/);
    expect(
      screen.queryByTestId("inline-calibration-ai-delta-warning"),
    ).toBeNull();
  });

  it('"Override" dismisses the AI delta warning while keeping the typed distance', () => {
    // The warning is informational — once the user explicitly
    // chooses to keep their typed value (e.g., they trust their own
    // measurement), the banner stops nagging. The typed distance
    // (and therefore the preview px/ft) does not change.
    renderDrawer({
      calibrationPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      // @ts-expect-error overrides interface doesn't enumerate every prop
      aiDetectedScale: { label: '1/8" = 1\'-0"', pxPerFoot: 8 },
    });
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "10" } },
    );
    expect(
      screen.queryByTestId("inline-calibration-ai-delta-warning"),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByTestId("button-inline-calibration-override-ai"),
    );
    // Warning gone, but the typed value (and preview at 10 px/ft) is preserved.
    expect(
      screen.queryByTestId("inline-calibration-ai-delta-warning"),
    ).toBeNull();
    expect(
      (
        screen.getByTestId(
          "input-inline-calibration-distance",
        ) as HTMLInputElement
      ).value,
    ).toBe("10");
    expect(
      screen.getByTestId("text-inline-calibration-preview-scale").textContent,
    ).toMatch(/^10\.00 px\/ft$/);
  });
});

describe("InlineCalibrationDrawer (Task #2228) — bulk-scale confirm", () => {
  function renderForBulkScale(opts: {
    memberCount: number;
    skip?: boolean;
    onApplyToSheetSet?: (input: {
      setId: string;
      scalePxPerFoot: number;
    }) => void | Promise<void>;
    onSaveCalibration?: (distanceFt?: number) => void | Promise<void>;
    onSkipChange?: (skip: boolean) => void | Promise<void>;
    defaultApply?: boolean;
  }) {
    const onApplyToSheetSet = opts.onApplyToSheetSet ?? vi.fn();
    const onSaveCalibration = opts.onSaveCalibration ?? vi.fn();
    const onSkipChange = opts.onSkipChange ?? vi.fn();
    const utils = render(
      <TooltipProvider>
        <InlineCalibrationDrawer
          open
          onOpenChange={vi.fn()}
          calibrationMode="idle"
          setCalibrationMode={vi.fn()}
          calibrationPoints={[
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ]}
          setCalibrationPoints={vi.fn()}
          calibrationDistance=""
          setCalibrationDistance={vi.fn()}
          units="ft"
          setUnits={vi.fn()}
          currentScalePxPerFoot={4}
          onSaveCalibration={onSaveCalibration}
          onUseStandardScale={vi.fn()}
          multiCalibMode={false}
          setMultiCalibMode={vi.fn()}
          multiCalibPoints={[]}
          setMultiCalibPoints={vi.fn()}
          activeSheetSet={{
            id: "set-1",
            name: "Civil bid #42",
            memberCount: opts.memberCount,
          }}
          onApplyToSheetSet={onApplyToSheetSet}
          defaultApplyToSheetSet={opts.defaultApply ?? true}
          skipBulkScalePropagationConfirm={opts.skip ?? false}
          onSkipBulkScalePropagationConfirmChange={onSkipChange}
        />
      </TooltipProvider>,
    );
    fireEvent.change(
      screen.getByTestId("input-inline-calibration-distance"),
      { target: { value: "12.5" } },
    );
    return { ...utils, onApplyToSheetSet, onSaveCalibration, onSkipChange };
  }

  it("opens the AlertDialog before propagating when the active set has more than 5 members", async () => {
    const { onApplyToSheetSet, onSaveCalibration } = renderForBulkScale({
      memberCount: 12,
    });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    // Save is intercepted: neither the per-sheet save nor the
    // propagation should have run yet.
    expect(onSaveCalibration).not.toHaveBeenCalled();
    expect(onApplyToSheetSet).not.toHaveBeenCalled();
    // Dialog renders with the from→to scale and member count.
    expect(screen.getByTestId("dialog-bulk-scale-confirm")).toBeTruthy();
    expect(
      screen.getByTestId("text-bulk-scale-set-name").textContent,
    ).toMatch(/Civil bid/);
    expect(
      screen.getByTestId("text-bulk-scale-from").textContent,
    ).toMatch(/4\.00 px\/ft/);
    expect(
      screen.getByTestId("text-bulk-scale-to").textContent,
    ).toMatch(/8\.00 px\/ft/);
    expect(
      screen.getByTestId("text-bulk-scale-member-count").textContent,
    ).toBe("12");
  });

  it("Cancel leaves the calibration unsaved and does not persist any preference", async () => {
    const { onApplyToSheetSet, onSaveCalibration, onSkipChange } =
      renderForBulkScale({ memberCount: 8 });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    fireEvent.click(screen.getByTestId("button-bulk-scale-cancel"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("dialog-bulk-scale-confirm"),
      ).toBeNull();
    });
    expect(onSaveCalibration).not.toHaveBeenCalled();
    expect(onApplyToSheetSet).not.toHaveBeenCalled();
    expect(onSkipChange).not.toHaveBeenCalled();
  });

  it("Confirm runs the per-sheet save AND the propagation exactly once", async () => {
    const { onApplyToSheetSet, onSaveCalibration } = renderForBulkScale({
      memberCount: 20,
    });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    fireEvent.click(screen.getByTestId("button-bulk-scale-confirm"));
    await waitFor(() => {
      expect(onSaveCalibration).toHaveBeenCalledTimes(1);
      expect(onApplyToSheetSet).toHaveBeenCalledTimes(1);
    });
    expect(onApplyToSheetSet).toHaveBeenCalledWith({
      setId: "set-1",
      scalePxPerFoot: 8,
    });
  });

  it("toggling 'Don't ask me again' before Confirm persists the user setting", async () => {
    const { onSkipChange, onApplyToSheetSet } = renderForBulkScale({
      memberCount: 30,
    });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    fireEvent.click(screen.getByTestId("checkbox-bulk-scale-dont-ask"));
    fireEvent.click(screen.getByTestId("button-bulk-scale-confirm"));
    await waitFor(() => {
      expect(onSkipChange).toHaveBeenCalledTimes(1);
      expect(onApplyToSheetSet).toHaveBeenCalledTimes(1);
    });
    expect(onSkipChange).toHaveBeenCalledWith(true);
  });

  it("skips the dialog when skipBulkScalePropagationConfirm is true", async () => {
    const { onApplyToSheetSet, onSaveCalibration } = renderForBulkScale({
      memberCount: 50,
      skip: true,
    });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    await waitFor(() => {
      expect(onSaveCalibration).toHaveBeenCalledTimes(1);
      expect(onApplyToSheetSet).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("dialog-bulk-scale-confirm")).toBeNull();
  });

  it("skips the dialog for small sets (<= 5 members) so the common path stays one-click", async () => {
    const { onApplyToSheetSet, onSaveCalibration } = renderForBulkScale({
      memberCount: 5,
    });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    await waitFor(() => {
      expect(onSaveCalibration).toHaveBeenCalledTimes(1);
      expect(onApplyToSheetSet).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("dialog-bulk-scale-confirm")).toBeNull();
  });

  it("skips the dialog when the Apply-to-Sheet-Set checkbox is unchecked", async () => {
    const { onApplyToSheetSet, onSaveCalibration } = renderForBulkScale({
      memberCount: 50,
      defaultApply: false,
    });
    fireEvent.click(screen.getByTestId("button-inline-calibration-save"));
    await waitFor(() => {
      expect(onSaveCalibration).toHaveBeenCalledTimes(1);
    });
    expect(onApplyToSheetSet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-bulk-scale-confirm")).toBeNull();
  });
});
