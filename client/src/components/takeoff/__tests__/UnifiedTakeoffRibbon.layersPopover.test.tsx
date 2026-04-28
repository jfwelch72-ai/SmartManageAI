// @vitest-environment jsdom
/**
 * Task #2202 — Layers ribbon popover.
 *
 * Pins the contract for the one-click visibility popover anchored to
 * the View > Layers ribbon button:
 *
 *   1. The popover only renders content when the parent says so via
 *      the controlled `layersPopoverOpen` prop. This is what lets the
 *      keyboard shortcut, the button click, and outside-click close
 *      all funnel through a single source of truth.
 *   2. Every measurement category gets a checkbox bound to
 *      `hiddenCategoryIds` — checked = visible, unchecked = hidden.
 *      Toggling a checkbox forwards the category id to
 *      `onToggleCategoryVisibility` exactly once.
 *   3. Pressing Escape asks Radix to close, which calls back into
 *      `onLayersPopoverOpenChange(false)` so the parent can mirror the
 *      new state and the panel actually unmounts. Focus restoration is
 *      handled in the parent via Radix's `onCloseAutoFocus` →
 *      `onLayersPopoverClose` callback (covered by the workspace
 *      integration; jsdom can't faithfully simulate Radix's focus
 *      scope auto-focus).
 *   4. With zero categories, the popover renders a friendly empty
 *      message instead of an empty list — so estimators understand
 *      they need to create categories first.
 */
import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
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

describe("UnifiedTakeoffRibbon — Layers popover (Task #2202)", () => {
  const categories = [
    { id: "cat-paving", name: "Paving", color: "#3b82f6" },
    { id: "cat-curb", name: "Curb & Gutter", color: "#ef4444" },
    { id: "cat-stripe", name: "Striping", color: "#10b981" },
  ];

  it("does not render popover content when closed", () => {
    renderRibbon({
      layersPopoverOpen: false,
      layersCategories: categories,
      hiddenCategoryIds: new Set(),
      onToggleCategoryVisibility: vi.fn(),
    });
    expect(screen.queryByTestId("popover-layers")).toBeNull();
    expect(screen.queryByTestId("layers-popover-panel")).toBeNull();
  });

  it("renders one checkbox per category, mirroring hiddenCategoryIds", () => {
    renderRibbon({
      layersPopoverOpen: true,
      layersCategories: categories,
      hiddenCategoryIds: new Set(["cat-curb"]),
      onToggleCategoryVisibility: vi.fn(),
    });
    expect(screen.getByTestId("layers-popover-panel")).toBeTruthy();
    // Visible count chip reflects the hidden set.
    expect(screen.getByTestId("text-layers-popover-count").textContent).toContain("2/3");

    // Each category renders with a checkbox in the right state.
    const pavingCb = screen.getByTestId("checkbox-layers-popover-cat-paving");
    const curbCb = screen.getByTestId("checkbox-layers-popover-cat-curb");
    const stripeCb = screen.getByTestId("checkbox-layers-popover-cat-stripe");
    expect(pavingCb.getAttribute("aria-checked")).toBe("true");
    expect(curbCb.getAttribute("aria-checked")).toBe("false");
    expect(stripeCb.getAttribute("aria-checked")).toBe("true");
  });

  it("forwards the category id to onToggleCategoryVisibility on click", () => {
    const onToggle = vi.fn();
    renderRibbon({
      layersPopoverOpen: true,
      layersCategories: categories,
      hiddenCategoryIds: new Set(),
      onToggleCategoryVisibility: onToggle,
    });
    const cb = screen.getByTestId("checkbox-layers-popover-cat-paving");
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("cat-paving");
  });

  it("closes when the parent flips layersPopoverOpen back to false", () => {
    // Real-world wiring: parent owns the boolean and mirrors
    // `onLayersPopoverOpenChange` into state, exactly like
    // TakeoffWorkspace does. Pressing Escape inside the popover should
    // therefore unmount the panel without any extra plumbing.
    const onOpenChange = vi.fn();
    function StatefulHost() {
      const [open, setOpen] = useState(true);
      const baseProps: UnifiedTakeoffRibbonProps = {
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
        layersPopoverOpen: open,
        onLayersPopoverOpenChange: (next) => {
          onOpenChange(next);
          setOpen(next);
        },
        onLayersPopoverClose: vi.fn(),
        layersCategories: categories,
        hiddenCategoryIds: new Set(),
        onToggleCategoryVisibility: vi.fn(),
      };
      return (
        <TooltipProvider>
          <UnifiedTakeoffRibbon {...baseProps} />
        </TooltipProvider>
      );
    }

    render(<StatefulHost />);
    expect(screen.getByTestId("layers-popover-panel")).toBeTruthy();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("layers-popover-panel")).toBeNull();
  });

  it("renders an empty-state message when there are no categories", () => {
    renderRibbon({
      layersPopoverOpen: true,
      layersCategories: [],
      hiddenCategoryIds: new Set(),
      onToggleCategoryVisibility: vi.fn(),
    });
    expect(screen.getByTestId("text-layers-popover-empty").textContent).toMatch(/No categories yet/i);
    // No category rows.
    expect(screen.queryByTestId("text-layers-popover-count")?.textContent).toContain("0/0");
  });

  // Task #2231 — bulk show/hide actions inside the popover header.
  describe("bulk show/hide all (Task #2231)", () => {
    it("Show all calls onSetAllCategoriesVisibility(true)", () => {
      const onSetAll = vi.fn();
      renderRibbon({
        layersPopoverOpen: true,
        layersCategories: categories,
        // Start with one hidden so "Show all" is enabled.
        hiddenCategoryIds: new Set(["cat-curb"]),
        onToggleCategoryVisibility: vi.fn(),
        onSetAllCategoriesVisibility: onSetAll,
      });
      const showAll = screen.getByTestId("button-layers-popover-show-all");
      expect(showAll.hasAttribute("disabled")).toBe(false);
      fireEvent.click(showAll);
      expect(onSetAll).toHaveBeenCalledTimes(1);
      expect(onSetAll).toHaveBeenCalledWith(true);
    });

    it("Hide all calls onSetAllCategoriesVisibility(false)", () => {
      const onSetAll = vi.fn();
      renderRibbon({
        layersPopoverOpen: true,
        layersCategories: categories,
        // Start with everything visible so "Hide all" is enabled.
        hiddenCategoryIds: new Set(),
        onToggleCategoryVisibility: vi.fn(),
        onSetAllCategoriesVisibility: onSetAll,
      });
      const hideAll = screen.getByTestId("button-layers-popover-hide-all");
      expect(hideAll.hasAttribute("disabled")).toBe(false);
      fireEvent.click(hideAll);
      expect(onSetAll).toHaveBeenCalledTimes(1);
      expect(onSetAll).toHaveBeenCalledWith(false);
    });

    it("disables Show all when every category is already visible", () => {
      renderRibbon({
        layersPopoverOpen: true,
        layersCategories: categories,
        hiddenCategoryIds: new Set(),
        onToggleCategoryVisibility: vi.fn(),
        onSetAllCategoriesVisibility: vi.fn(),
      });
      const showAll = screen.getByTestId("button-layers-popover-show-all");
      const hideAll = screen.getByTestId("button-layers-popover-hide-all");
      expect(showAll.hasAttribute("disabled")).toBe(true);
      expect(hideAll.hasAttribute("disabled")).toBe(false);
    });

    it("disables Hide all when every category is already hidden", () => {
      renderRibbon({
        layersPopoverOpen: true,
        layersCategories: categories,
        hiddenCategoryIds: new Set(categories.map((c) => c.id)),
        onToggleCategoryVisibility: vi.fn(),
        onSetAllCategoriesVisibility: vi.fn(),
      });
      const showAll = screen.getByTestId("button-layers-popover-show-all");
      const hideAll = screen.getByTestId("button-layers-popover-hide-all");
      expect(showAll.hasAttribute("disabled")).toBe(false);
      expect(hideAll.hasAttribute("disabled")).toBe(true);
    });

    it("does not render the bulk actions row when there are no categories", () => {
      renderRibbon({
        layersPopoverOpen: true,
        layersCategories: [],
        hiddenCategoryIds: new Set(),
        onToggleCategoryVisibility: vi.fn(),
        onSetAllCategoriesVisibility: vi.fn(),
      });
      expect(screen.queryByTestId("row-layers-popover-bulk-actions")).toBeNull();
    });
  });

  it("clicking the Layers ribbon button still routes through onShowLayers (parent-owned toggle)", () => {
    const onShowLayers = vi.fn();
    renderRibbon({
      layersPopoverOpen: false,
      layersCategories: categories,
      hiddenCategoryIds: new Set(),
      onToggleCategoryVisibility: vi.fn(),
      onShowLayers,
    });
    const btn = screen.getByTestId("ribbon-tool-layers");
    fireEvent.click(btn);
    expect(onShowLayers).toHaveBeenCalledTimes(1);
  });
});
