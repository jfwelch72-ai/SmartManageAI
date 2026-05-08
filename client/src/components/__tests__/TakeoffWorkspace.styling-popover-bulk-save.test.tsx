// @vitest-environment jsdom
/**
 * Task #1772 — Locks in the markup styling popover's Save behavior.
 *
 * The popover's Save handler is the exported `saveMarkupStylingPopover`
 * helper at the bottom of `client/src/components/TakeoffWorkspace.tsx`.
 * The workspace's inline `save = () => saveMarkupStylingPopover({...})`
 * delegates to it directly, so calling the helper here exercises the
 * real production code path with real `useTakeoffData` mutations and a
 * real `useTakeoffHistory` instance — no duplicated control flow.
 *
 * Contract under test:
 *   - Multi-select (>=2 markups) → ONE bulk PATCH +
 *     ONE MARKUP_UPDATE_BATCH history entry (depth-1 stack).
 *   - Single-select → per-id PATCH via `updateMarkupMutation` whose
 *     onSuccess pushes ONE MARKUP_UPDATE entry (depth-1 stack).
 *   - Failed bulk PATCH → no history entry (no phantom Undo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { mockApiRequest, sharedQc } = vi.hoisted(() => {
  return {
    mockApiRequest: vi.fn(),
    sharedQc: { current: null as QueryClient | null },
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
  useToast: () => ({ toast: vi.fn() }),
}));

import { useTakeoffData } from "@/hooks/use-takeoff-data";
import { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import {
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

function renderWorkspaceLike(selectedSheet: string | null = "sheet-1") {
  const qc = sharedQc.current;
  if (!qc) throw new Error("Test setup: sharedQc was not initialized by the @/lib/queryClient mock");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
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
    { wrapper },
  );
}

/**
 * Invokes the real production `saveMarkupStylingPopover` helper with the
 * same argument shape the workspace's inline `save` callback passes.
 * `anchor` defaults to the first selected markup (matches the workspace).
 */
async function invokeSave(
  workspace: WorkspaceLike,
  selectedMarkups: MarkupStylingTarget[],
  draft: MarkupStylingDraft,
  initial: MarkupStylingDraft,
  selectedSheet: string | null,
) {
  const isMulti = selectedMarkups.length > 1;
  const showTextInput = selectedMarkups.every((m) => m.tool === "TEXT");
  const close = vi.fn();
  await saveMarkupStylingPopover({
    draft,
    initial,
    showTextInput,
    isMulti,
    anchor: selectedMarkups[0],
    selectedMarkups,
    selectedSheet,
    updateMarkupMutation: workspace.data.updateMarkupMutation,
    bulkUpdateMarkupsMutation: workspace.data.bulkUpdateMarkupsMutation,
    takeoffHistory: workspace.history,
    toast: vi.fn(),
    close,
  });
  return { close };
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockApiRequest.mockResolvedValue({ json: async () => ({}) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveMarkupStylingPopover (Task #1772)", () => {
  it("multi-select color change → one bulk PATCH + one history entry", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "a", tool: "ARROW", color: "#000000", thickness: 2, text: null },
      { id: "b", tool: "ARROW", color: "#111111", thickness: 2, text: null },
      { id: "c", tool: "ARROW", color: "#222222", thickness: 2, text: null },
      { id: "d", tool: "ARROW", color: "#333333", thickness: 2, text: null },
      { id: "e", tool: "ARROW", color: "#444444", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    let closeSpy!: ReturnType<typeof vi.fn>;
    await act(async () => {
      ({ close: closeSpy } = await invokeSave(result.current, markups, draft, initial, "sheet-1"));
    });

    const bulkCalls = mockApiRequest.mock.calls.filter((c) => c[1] === "/api/takeoff/markups/bulk");
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0][0]).toBe("PATCH");
    expect((bulkCalls[0][2] as { updates: unknown[] }).updates).toHaveLength(5);

    // No per-id PATCHes leaked through.
    const perIdCalls = mockApiRequest.mock.calls.filter(
      (c) => typeof c[1] === "string" && (c[1] as string).startsWith("/api/takeoff/markups/") && c[1] !== "/api/takeoff/markups/bulk",
    );
    expect(perIdCalls).toHaveLength(0);

    expect(result.current.history.canUndo).toBe(true);
    expect(result.current.history.canRedo).toBe(false);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    mockApiRequest.mockClear();
    await act(async () => {
      await result.current.history.undo();
    });
    // Per-member prior color restored independently (not all to anchor's).
    expect(mockApiRequest.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { color: "#000000" }],
        ["PATCH", "/api/takeoff/markups/b", { color: "#111111" }],
        ["PATCH", "/api/takeoff/markups/c", { color: "#222222" }],
        ["PATCH", "/api/takeoff/markups/d", { color: "#333333" }],
        ["PATCH", "/api/takeoff/markups/e", { color: "#444444" }],
      ]),
    );
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(true);
  });

  it("multi-select thickness change → one bulk PATCH + one history entry", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "a", tool: "RECTANGLE", color: "#ff0000", thickness: 2, text: null },
      { id: "b", tool: "RECTANGLE", color: "#ff0000", thickness: 4, text: null },
      { id: "c", tool: "RECTANGLE", color: "#ff0000", thickness: 6, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 8, text: "" };

    await act(async () => {
      await invokeSave(result.current, markups, draft, initial, "sheet-1");
    });

    const bulkCalls = mockApiRequest.mock.calls.filter((c) => c[1] === "/api/takeoff/markups/bulk");
    expect(bulkCalls).toHaveLength(1);
    const updates = (bulkCalls[0][2] as { updates: Array<{ id: string; thickness: number }> }).updates;
    expect(updates).toHaveLength(3);
    expect(updates.every((u) => u.thickness === 8)).toBe(true);

    expect(result.current.history.canUndo).toBe(true);
    mockApiRequest.mockClear();
    await act(async () => {
      await result.current.history.undo();
    });
    expect(mockApiRequest.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { thickness: 2 }],
        ["PATCH", "/api/takeoff/markups/b", { thickness: 4 }],
        ["PATCH", "/api/takeoff/markups/c", { thickness: 6 }],
      ]),
    );
    expect(result.current.history.canUndo).toBe(false);
  });

  it("single-select color change → per-id PATCH + one MARKUP_UPDATE entry (no regression)", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "solo", tool: "ARROW", color: "#000000", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    await act(async () => {
      await invokeSave(result.current, markups, draft, initial, "sheet-1");
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/solo",
      { color: "#ff0000" },
    );

    expect(result.current.history.canUndo).toBe(true);
    expect(result.current.history.canRedo).toBe(false);

    mockApiRequest.mockClear();
    await act(async () => {
      await result.current.history.undo();
    });
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/solo",
      { color: "#000000" },
    );
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(true);
  });

  it("multi-select with mixed prior styles → each member's snapshot restored independently", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "a", tool: "ARROW", color: "#aaaaaa", thickness: 2, text: null },
      { id: "b", tool: "ARROW", color: "#bbbbbb", thickness: 4, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#aaaaaa", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 6, text: "" };

    await act(async () => {
      await invokeSave(result.current, markups, draft, initial, "sheet-1");
    });

    const bulkCalls = mockApiRequest.mock.calls.filter((c) => c[1] === "/api/takeoff/markups/bulk");
    expect(bulkCalls).toHaveLength(1);

    mockApiRequest.mockClear();
    await act(async () => {
      await result.current.history.undo();
    });
    expect(mockApiRequest.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { color: "#aaaaaa", thickness: 2 }],
        ["PATCH", "/api/takeoff/markups/b", { color: "#bbbbbb", thickness: 4 }],
      ]),
    );
    expect(result.current.history.canUndo).toBe(false);
  });

  it("bulk PATCH rejection → no history entry pushed (no phantom Undo)", async () => {
    const { result } = renderWorkspaceLike();
    const markups: MarkupStylingTarget[] = [
      { id: "a", tool: "ARROW", color: "#000000", thickness: 2, text: null },
      { id: "b", tool: "ARROW", color: "#000000", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    mockApiRequest.mockReset();
    mockApiRequest.mockRejectedValueOnce(new Error("boom"));

    let closeSpy!: ReturnType<typeof vi.fn>;
    await act(async () => {
      ({ close: closeSpy } = await invokeSave(result.current, markups, draft, initial, "sheet-1"));
    });

    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
    // Failed save must NOT close the popover — user keeps their draft.
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
