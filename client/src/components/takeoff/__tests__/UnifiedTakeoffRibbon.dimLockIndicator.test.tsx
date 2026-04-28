// @vitest-environment jsdom
/**
 * Task #2226 — Persistent typed-length lock indicator in the ribbon.
 *
 * Pins the contract for the right-rail Dim Lock chip:
 *
 *   1. Hidden when no length is locked (pendingDimLengthFt is null
 *      or 0). Estimators shouldn't see a stale chip after a click
 *      consumes the lock.
 *   2. Visible when a length is locked, displaying the length and a
 *      "Lock" / "Chain" affordance. The data-state attribute
 *      reflects whether the lock is one-shot (`locked`) or chained
 *      across multiple clicks (`chained`).
 *   3. Clicking the chip calls `onOpenDimInput` so the user can
 *      reopen the Dim Input dialog the same way pressing Tab would.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UnifiedTakeoffRibbon, type UnifiedTakeoffRibbonProps } from "../UnifiedTakeoffRibbon";

afterEach(() => cleanup());

function renderRibbon(overrides: Partial<UnifiedTakeoffRibbonProps> = {}) {
  const props: UnifiedTakeoffRibbonProps = {
    userId: "user-test",
    activeTool: "select",
    onToolSelect: vi.fn(),
    enabledSnapModes: [],
    setEnabledSnapModes: vi.fn(),
    snapHudOpen: false,
    setSnapHudOpen: vi.fn(),
    constraintMode: "none",
    setConstraintMode: vi.fn(),
    orthoPresetIndex: 0,
    setOrthoPresetIndex: vi.fn(),
    orthoLock: false,
    setOrthoLock: vi.fn(),
    gridEnabled: false,
    setGridEnabled: vi.fn(),
    onOpenCalibrate: vi.fn(),
    isCalibrated: false,
    onStartVerifyScale: vi.fn(),
    onOpenDimInput: vi.fn(),
    onShowLayers: vi.fn(),
    onToggleOverlay: vi.fn(),
    onShowVersions: vi.fn(),
    onOpenCheatSheet: vi.fn(),
    isOffline: false,
    pendingOutboxCount: 0,
    isSyncing: false,
    ...overrides,
  };
  const utils = render(
    <TooltipProvider>
      <UnifiedTakeoffRibbon {...props} />
    </TooltipProvider>,
  );
  return { ...utils, props };
}

describe("UnifiedTakeoffRibbon — Dim Lock indicator (Task #2226)", () => {
  it("hides the chip when no length is locked", () => {
    renderRibbon({ pendingDimLengthFt: null });
    expect(screen.queryByTestId("indicator-dim-lock")).toBeNull();
  });

  it("hides the chip when the locked length is zero", () => {
    renderRibbon({ pendingDimLengthFt: 0 });
    expect(screen.queryByTestId("indicator-dim-lock")).toBeNull();
  });

  it("shows a Lock chip when a one-shot length is locked", () => {
    renderRibbon({ pendingDimLengthFt: 12.5, dimInputRepeat: false });
    const chip = screen.getByTestId("indicator-dim-lock");
    expect(chip.getAttribute("data-state")).toBe("locked");
    expect(chip.textContent).toContain("Lock");
    expect(screen.getByTestId("text-dim-lock-length").textContent).toBe("12.50 ft");
  });

  it("shows a Chain chip when chain mode is on", () => {
    renderRibbon({ pendingDimLengthFt: 8, dimInputRepeat: true });
    const chip = screen.getByTestId("indicator-dim-lock");
    expect(chip.getAttribute("data-state")).toBe("chained");
    expect(chip.textContent).toContain("Chain");
    expect(screen.getByTestId("text-dim-lock-length").textContent).toBe("8.00 ft");
  });

  it("opens the Dim Input dialog when the chip is clicked", () => {
    const onOpenDimInput = vi.fn();
    renderRibbon({
      pendingDimLengthFt: 24,
      dimInputRepeat: false,
      onOpenDimInput,
    });
    fireEvent.click(screen.getByTestId("indicator-dim-lock"));
    expect(onOpenDimInput).toHaveBeenCalledTimes(1);
  });
});
