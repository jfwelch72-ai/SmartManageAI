// @vitest-environment jsdom
/**
 * Task #1840 — Cover the popover Save button's loading and error UX.
 *
 * Task #1772 locked in the history-stack contract for the popover Save
 * button (one PATCH, one Undo entry, no phantom entry on failure). This
 * file locks in the user-visible side effects of that flow:
 *
 *   1. The Save button is disabled and re-labelled "Saving..." while
 *      EITHER `updateMarkupMutation` (single-select) OR
 *      `bulkUpdateMarkupsMutation` (multi-select) is in flight. A future
 *      refactor that drops one of the checks could let users double-fire
 *      the button during a slow bulk PATCH and re-introduce the
 *      double-history-entry regression Task #1772 prevented at the
 *      history layer. The Save button itself is the
 *      `MarkupStylingPopoverSaveButton` exported component, so these
 *      tests render the same JSX production renders.
 *   2. The success toast pluralization: single-select fires
 *      "Markup updated"; multi-select fires "Updated N markups".
 *   3. On a bulk-save failure: the popover stays open (`close` not
 *      called) AND a destructive error toast fires from
 *      `bulkUpdateMarkupsMutation.onError` (use-takeoff-data.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { mockApiRequest, sharedQc, mockToast } = vi.hoisted(() => {
  return {
    mockApiRequest: vi.fn(),
    sharedQc: { current: null as QueryClient | null },
    mockToast: vi.fn(),
  };
});

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const qc = new QueryClient({
    defaultOptions: {
      queries: { queryFn: async () => [], retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  sharedQc.current = qc;
  return {
    apiRequest: mockApiRequest,
    queryClient: qc,
    getQueryFn: () => async () => [],
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { useTakeoffData } from "@/hooks/use-takeoff-data";
import { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import {
  MarkupStylingPopoverSaveButton,
  saveMarkupStylingPopover,
  type MarkupStylingDraft,
  type MarkupStylingTarget,
} from "@/components/TakeoffWorkspace";

const noopCallbacks = {
  setUploadDialogOpen: () => {},
  setSelectedSheet: () => {},
  setSelectedMeasurementId: () => {},
  setRenameDialogOpen: () => {},
  setDeleteSheetConfirmOpen: () => {},
  setCategoryDialogOpen: () => {},
  setEditingCategory: () => {},
  setCategoryName: () => {},
  setCategoryColor: () => {},
  setSelectedCategoryId: () => {},
};

type WorkspaceLike = {
  data: ReturnType<typeof useTakeoffData>;
  history: ReturnType<typeof useTakeoffHistory>;
};

function makeWrapper() {
  const qc = sharedQc.current;
  if (!qc) throw new Error("Test setup: sharedQc was not initialized by the @/lib/queryClient mock");
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function renderWorkspaceLike(selectedSheet: string | null = "sheet-1") {
  return renderHook(
    (): WorkspaceLike => {
      const history = useTakeoffHistory(selectedSheet);
      const data = useTakeoffData({
        projectId: "p1",
        projectCode: "P1",
        selectedSheet,
        uploadDialogOpen: false,
        takeoffHistory: history,
        selectedCategoryId: null,
        callbacks: noopCallbacks,
      });
      return { history, data };
    },
    { wrapper: makeWrapper() },
  );
}

/**
 * Creates a controllable promise. Calling `resolve()` settles the
 * promise on the next microtask. Used to keep a mutation in flight
 * (`isPending === true`) so we can inspect the Save button mid-PATCH.
 */
function createControllablePromise<T = unknown>(value: T) {
  let resolveFn!: () => void;
  let rejectFn!: (err: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = () => resolve(value);
    rejectFn = (err) => reject(err);
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockApiRequest.mockResolvedValue({ json: async () => ({}) });
  mockToast.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MarkupStylingPopoverSaveButton — loading state (Task #1840)", () => {
  it("idle (neither mutation in flight) → enabled, label 'Save'", () => {
    render(
      <MarkupStylingPopoverSaveButton
        onSave={() => {}}
        updatePending={false}
        bulkPending={false}
      />,
    );
    const btn = screen.getByTestId("button-save-markup-edit") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Save");
  });

  it("single-update mutation in flight → disabled, label 'Saving...'", () => {
    render(
      <MarkupStylingPopoverSaveButton
        onSave={() => {}}
        updatePending={true}
        bulkPending={false}
      />,
    );
    const btn = screen.getByTestId("button-save-markup-edit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Saving...");
  });

  it("bulk-update mutation in flight → disabled, label 'Saving...' (regression guard)", () => {
    // Without this assertion a refactor could silently drop the
    // bulk-pending check from the Save button and let users double-fire
    // a slow bulk PATCH, producing two MARKUP_UPDATE_BATCH history
    // entries from a single user intent.
    render(
      <MarkupStylingPopoverSaveButton
        onSave={() => {}}
        updatePending={false}
        bulkPending={true}
      />,
    );
    const btn = screen.getByTestId("button-save-markup-edit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Saving...");
  });

  it("both mutations in flight → disabled, label 'Saving...'", () => {
    render(
      <MarkupStylingPopoverSaveButton
        onSave={() => {}}
        updatePending={true}
        bulkPending={true}
      />,
    );
    const btn = screen.getByTestId("button-save-markup-edit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Saving...");
  });

  it("disabled while a real bulk PATCH is in flight, re-enables once it resolves", async () => {
    const { result } = renderWorkspaceLike();

    // Hold the bulk PATCH open so isPending stays true while we render.
    const inflight = createControllablePromise<{ json: () => Promise<unknown> }>({
      json: async () => ({}),
    });
    mockApiRequest.mockImplementationOnce(() => inflight.promise);

    // Fire-and-do-not-await — the mutation will sit at isPending=true
    // until we release `inflight.resolve()` below.
    let mutationDone!: Promise<unknown>;
    act(() => {
      mutationDone = result.current.data.bulkUpdateMarkupsMutation.mutateAsync({
        updates: [
          { id: "a", color: "#ff0000" },
          { id: "b", color: "#ff0000" },
        ],
      });
    });

    const Harness = () => (
      <MarkupStylingPopoverSaveButton
        onSave={() => {}}
        updatePending={result.current.data.updateMarkupMutation.isPending}
        bulkPending={result.current.data.bulkUpdateMarkupsMutation.isPending}
      />
    );
    const { rerender } = render(<Harness />);

    await waitFor(() => {
      expect(result.current.data.bulkUpdateMarkupsMutation.isPending).toBe(true);
    });
    rerender(<Harness />);
    const inflightBtn = screen.getByTestId("button-save-markup-edit") as HTMLButtonElement;
    expect(inflightBtn.disabled).toBe(true);
    expect(inflightBtn.textContent).toBe("Saving...");

    await act(async () => {
      inflight.resolve();
      await mutationDone;
    });
    rerender(<Harness />);
    await waitFor(() => {
      expect(result.current.data.bulkUpdateMarkupsMutation.isPending).toBe(false);
    });
    rerender(<Harness />);
    const settledBtn = screen.getByTestId("button-save-markup-edit") as HTMLButtonElement;
    expect(settledBtn.disabled).toBe(false);
    expect(settledBtn.textContent).toBe("Save");
  });
});

describe("saveMarkupStylingPopover — success toast pluralization (Task #1840)", () => {
  it("single-select success → 'Markup updated' toast", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "solo", tool: "ARROW", color: "#000000", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };
    const close = vi.fn();
    const helperToast = vi.fn();

    await act(async () => {
      await saveMarkupStylingPopover({
        draft,
        initial,
        showTextInput: false,
        isMulti: false,
        anchor: markups[0],
        selectedMarkups: markups,
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.data.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.data.bulkUpdateMarkupsMutation,
        takeoffHistory: result.current.history,
        toast: helperToast,
        close,
      });
    });

    expect(helperToast).toHaveBeenCalledTimes(1);
    expect(helperToast).toHaveBeenCalledWith({ title: "Markup updated" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("multi-select success → 'Updated N markups' toast with the right N", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "a", tool: "ARROW", color: "#000000", thickness: 2, text: null },
      { id: "b", tool: "ARROW", color: "#111111", thickness: 2, text: null },
      { id: "c", tool: "ARROW", color: "#222222", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };
    const close = vi.fn();
    const helperToast = vi.fn();

    await act(async () => {
      await saveMarkupStylingPopover({
        draft,
        initial,
        showTextInput: false,
        isMulti: true,
        anchor: markups[0],
        selectedMarkups: markups,
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.data.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.data.bulkUpdateMarkupsMutation,
        takeoffHistory: result.current.history,
        toast: helperToast,
        close,
      });
    });

    expect(helperToast).toHaveBeenCalledTimes(1);
    expect(helperToast).toHaveBeenCalledWith({ title: "Updated 3 markups" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("saveMarkupStylingPopover — bulk-save failure UX (Task #1840)", () => {
  it("popover stays open AND a destructive error toast fires", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "a", tool: "ARROW", color: "#000000", thickness: 2, text: null },
      { id: "b", tool: "ARROW", color: "#000000", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    mockApiRequest.mockReset();
    mockApiRequest.mockRejectedValueOnce(new Error("boom"));
    const close = vi.fn();
    const helperToast = vi.fn();

    await act(async () => {
      await saveMarkupStylingPopover({
        draft,
        initial,
        showTextInput: false,
        isMulti: true,
        anchor: markups[0],
        selectedMarkups: markups,
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.data.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.data.bulkUpdateMarkupsMutation,
        takeoffHistory: result.current.history,
        toast: helperToast,
        close,
      });
    });

    // Popover stays open: the helper neither closed it nor fired a
    // success toast. The user keeps their draft so they can retry.
    expect(close).not.toHaveBeenCalled();
    expect(helperToast).not.toHaveBeenCalled();

    // Destructive error toast fires from
    // `bulkUpdateMarkupsMutation.onError` in use-takeoff-data.ts via
    // `buildMarkupFailureSummary`. We only assert the destructive
    // variant + a non-empty title here so we don't couple to the
    // exact failure-summary phrasing (covered separately in the
    // markup-failure-helpers tests).
    expect(mockToast).toHaveBeenCalled();
    const destructiveCall = mockToast.mock.calls.find(
      ([arg]) => (arg as { variant?: string })?.variant === "destructive",
    );
    expect(destructiveCall).toBeDefined();
    const destructiveArg = destructiveCall![0] as { title: string; variant: string };
    expect(destructiveArg.title).toBeTruthy();
    expect(destructiveArg.variant).toBe("destructive");
  });
});
