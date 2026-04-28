// @vitest-environment jsdom
/**
 * Task #2239 — Sidebar Layers panel bulk show/hide.
 *
 * Pins down that the legacy/full Layers panel inside the takeoff
 * sidebar exposes the same "Show all" / "Hide all" pair that Task
 * #2231 added to the Layers ribbon popover, so estimators no longer
 * have to click each row individually (or bounce out to the popover)
 * just to wipe or restore visibility.
 *
 * Coverage:
 *   1. Both buttons forward the visible flag to
 *      `onSetAllCategoriesVisibility` exactly once.
 *   2. Disabled rules match the popover (Show all disabled when
 *      nothing is hidden, Hide all disabled when everything is
 *      hidden) so the affordance honestly reflects the state of the
 *      hiddenCategoryIds set.
 *   3. The bulk action row is suppressed when the sidebar mounts
 *      without a parent `onSetAllCategoriesVisibility` handler — older
 *      callers (and any future contexts that intentionally opt out)
 *      keep the row-only UI rather than rendering an inert pair of
 *      buttons.
 *   4. Hidden behind the same `categories.length > 0` gate as the
 *      per-row list, so the empty-state message never collides with a
 *      stranded action row.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { TakeoffSidebar } from "../TakeoffSidebar";
import { queryClient as testQueryClient } from "@/lib/queryClient";

afterEach(() => cleanup());

const CATEGORIES = [
  { id: "cat-paving", name: "Paving", color: "#3b82f6" },
  { id: "cat-curb", name: "Curb & Gutter", color: "#ef4444" },
  { id: "cat-stripe", name: "Striping", color: "#10b981" },
];

// The full sidebar surface area is huge; this helper builds the
// minimum prop bag needed to render the Quantity Categories card and
// casts the remainder away. Anything the categories card touches has
// a real value; everything else is a no-op stub or empty default that
// keeps the rest of the sidebar rendering inert.
function makeProps(overrides: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    selectedSheet: "sheet-1",
    currentSheet: { id: "sheet-1", projectId: "p1", scalePxPerFoot: null } as unknown,
    projectId: "p1",
    calibrationMode: "idle",
    calibrationPoints: [],
    calibrationDistance: "",
    setCalibrationDistance: vi.fn(),
    units: "ft",
    setUnits: vi.fn(),
    onSaveCalibration: vi.fn(),
    activeTool: "select",
    categories: CATEGORIES,
    selectedCategoryId: null,
    setSelectedCategoryId: vi.fn(),
    setCategoryDialogOpen: vi.fn(),
    setEditingCategory: vi.fn(),
    onDeleteCategory: vi.fn(),
    hiddenCategoryIds: new Set<string>(),
    onToggleCategoryVisibility: vi.fn(),
    pitchRatio: "",
    setPitchRatio: vi.fn(),
    dropDistance: "",
    setDropDistance: vi.fn(),
    measurements: [],
    selectedMeasurementId: null,
    setSelectedMeasurementId: vi.fn(),
    selectedSegmentIndex: null,
    setSelectedSegmentIndex: vi.fn(),
    deleteMeasurementMutation: { mutate: vi.fn(), isPending: false },
    updateMeasurementMutation: { mutate: vi.fn(), isPending: false },
    aggregatedMeasurements: {
      byCategory: {},
      uncategorized: [],
      grandTotals: {
        linearTotal: 0,
        areaTotal: 0,
        volumeTotal: 0,
        countTotal: 0,
        linearWithDropTotal: 0,
        pitchedLinearTotal: 0,
        pitchedAreaTotal: 0,
        surfaceAreaTotal: 0,
        segmentTotal: 0,
      },
    },
    projectAddenda: [],
    addendaOverlays: {},
    setAddendaOverlays: vi.fn(),
    verifyMode: "idle",
    setVerifyMode: vi.fn(),
    verifyPoints: [],
    setVerifyPoints: vi.fn(),
    verifyExpectedDistance: "",
    setVerifyExpectedDistance: vi.fn(),
    verifyResult: null,
    setVerifyResult: vi.fn(),
    multiCalibMode: false,
    setMultiCalibMode: vi.fn(),
    multiCalibPoints: [],
    setMultiCalibPoints: vi.fn(),
    setCalibrationMode: vi.fn(),
    setCalibrationPoints: vi.fn(),
    workspaceRef: { current: null },
    aiPanelOpen: false,
  };
  return { ...base, ...overrides } as unknown as Parameters<typeof TakeoffSidebar>[0];
}

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return render(<TakeoffSidebar {...makeProps(overrides)} />, { wrapper: Wrapper });
}

describe("TakeoffSidebar — Layers panel bulk actions (Task #2239)", () => {
  it("Show all calls onSetAllCategoriesVisibility(true)", () => {
    const onSetAll = vi.fn();
    renderSidebar({
      // Start with one hidden so Show all is enabled.
      hiddenCategoryIds: new Set(["cat-curb"]),
      onSetAllCategoriesVisibility: onSetAll,
    });
    const showAll = screen.getByTestId("button-sidebar-layers-show-all");
    expect(showAll.hasAttribute("disabled")).toBe(false);
    fireEvent.click(showAll);
    expect(onSetAll).toHaveBeenCalledTimes(1);
    expect(onSetAll).toHaveBeenCalledWith(true);
  });

  it("Hide all calls onSetAllCategoriesVisibility(false)", () => {
    const onSetAll = vi.fn();
    renderSidebar({
      hiddenCategoryIds: new Set<string>(),
      onSetAllCategoriesVisibility: onSetAll,
    });
    const hideAll = screen.getByTestId("button-sidebar-layers-hide-all");
    expect(hideAll.hasAttribute("disabled")).toBe(false);
    fireEvent.click(hideAll);
    expect(onSetAll).toHaveBeenCalledTimes(1);
    expect(onSetAll).toHaveBeenCalledWith(false);
  });

  it("disables Show all when every category is already visible", () => {
    renderSidebar({
      hiddenCategoryIds: new Set<string>(),
      onSetAllCategoriesVisibility: vi.fn(),
    });
    const showAll = screen.getByTestId("button-sidebar-layers-show-all");
    const hideAll = screen.getByTestId("button-sidebar-layers-hide-all");
    expect(showAll.hasAttribute("disabled")).toBe(true);
    expect(hideAll.hasAttribute("disabled")).toBe(false);
  });

  it("disables Hide all when every category is already hidden", () => {
    renderSidebar({
      hiddenCategoryIds: new Set(CATEGORIES.map((c) => c.id)),
      onSetAllCategoriesVisibility: vi.fn(),
    });
    const showAll = screen.getByTestId("button-sidebar-layers-show-all");
    const hideAll = screen.getByTestId("button-sidebar-layers-hide-all");
    expect(showAll.hasAttribute("disabled")).toBe(false);
    expect(hideAll.hasAttribute("disabled")).toBe(true);
  });

  it("does not render the bulk actions row when no handler is wired", () => {
    renderSidebar({
      hiddenCategoryIds: new Set<string>(),
      // Intentionally omit onSetAllCategoriesVisibility — the row
      // should not appear at all (rather than render disabled buttons
      // that go nowhere).
    });
    expect(screen.queryByTestId("row-sidebar-layers-bulk-actions")).toBeNull();
  });

  it("does not render the bulk actions row when there are no categories", () => {
    renderSidebar({
      categories: [],
      hiddenCategoryIds: new Set<string>(),
      onSetAllCategoriesVisibility: vi.fn(),
    });
    expect(screen.queryByTestId("row-sidebar-layers-bulk-actions")).toBeNull();
  });
});
