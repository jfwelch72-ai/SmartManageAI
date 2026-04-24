// @vitest-environment jsdom
/**
 * Task #1833 — Frontend test that the markup recolor / restyle panel
 * routes a multi-select save through ONE
 * `bulkUpdateMarkupsMutation.mutateAsync` call instead of fanning the
 * gesture out into N parallel `updateMarkupMutation.mutateAsync` calls.
 *
 * Server-side integration tests already lock in the bulk endpoint
 * contract for color / thickness / text updates, but a regression on
 * the client (e.g. the popover quietly looping
 * `updateMarkupMutation.mutateAsync` per id again) would not break any
 * server suite — every PATCH would still land, just N round-trips
 * instead of one. This test pins the call-shape directly: it counts
 * mutateAsync invocations on each spy mutation and asserts the
 * single/multi branches dispatch through their intended path.
 *
 * The save handler is already extracted as the exported pure helper
 * `saveMarkupStylingPopover` (see Task #1772). Driving it through
 * mutation spies — the same harness style as
 * `markup-drag-commit.test.ts` — exercises the production code path
 * without standing up the workspace.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: {},
  getQueryFn: () => async () => [],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  saveMarkupStylingPopover,
  type MarkupSnapshot,
  type MarkupStylingDraft,
  type MarkupStylingTarget,
} from "@/components/TakeoffWorkspace";

type UpdateVars = {
  id: string;
  color?: string;
  thickness?: number;
  text?: string | null;
  previous?: { color?: string; thickness?: number; text?: string | null };
};

type BulkVars = {
  updates: Array<{ id: string; color?: string; thickness?: number; text?: string | null }>;
};

type UpdateMutationSpy = {
  mutateAsync: Mock<(vars: UpdateVars) => Promise<unknown>>;
};

type BulkMutationSpy = {
  mutateAsync: Mock<(vars: BulkVars) => Promise<unknown>>;
};

type HistorySpy = {
  pushMarkupUpdateBatchAction: Mock<
    (before: MarkupSnapshot[], after: MarkupSnapshot[], sheetId: string) => void
  >;
};

function makeUpdateMutation(): UpdateMutationSpy {
  return {
    mutateAsync: vi.fn<(vars: UpdateVars) => Promise<unknown>>(async () => ({ id: "ok" })),
  };
}

function makeBulkMutation(): BulkMutationSpy {
  return {
    mutateAsync: vi.fn<(vars: BulkVars) => Promise<unknown>>(async () => ({ ok: true })),
  };
}

function makeHistory(): HistorySpy {
  return {
    pushMarkupUpdateBatchAction: vi.fn<
      (before: MarkupSnapshot[], after: MarkupSnapshot[], sheetId: string) => void
    >(),
  };
}

describe("recolor panel routing — saveMarkupStylingPopover (Task #1833)", () => {
  let updateMutation: UpdateMutationSpy;
  let bulkMutation: BulkMutationSpy;
  let history: HistorySpy;
  let close: Mock<() => void>;
  let toast: Mock<(opts: { title: string }) => void>;

  beforeEach(() => {
    updateMutation = makeUpdateMutation();
    bulkMutation = makeBulkMutation();
    history = makeHistory();
    close = vi.fn();
    toast = vi.fn();
  });

  it("multi-select color change → exactly ONE bulk mutateAsync, ZERO per-id mutateAsync", async () => {
    const selectedMarkups: MarkupStylingTarget[] = [
      { id: "m1", tool: "ARROW", color: "#000000", thickness: 2, text: null },
      { id: "m2", tool: "ARROW", color: "#111111", thickness: 2, text: null },
      { id: "m3", tool: "ARROW", color: "#222222", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    await saveMarkupStylingPopover({
      draft,
      initial,
      showTextInput: false,
      isMulti: true,
      anchor: selectedMarkups[0]!,
      selectedMarkups,
      selectedSheet: "sheet-1",
      updateMarkupMutation: updateMutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
      toast,
      close,
    });

    // Critical contract: exactly one bulk PATCH, never the legacy
    // N-roundtrip fan-out via per-id `updateMarkupMutation.mutateAsync`.
    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();

    // Bulk payload carries one update per selected member, all with the
    // new color — proves the popover is recoloring every selection.
    const payload = bulkMutation.mutateAsync.mock.calls[0]![0];
    expect(payload.updates).toHaveLength(3);
    expect(payload.updates.map((u) => u.id).sort()).toEqual(["m1", "m2", "m3"]);
    expect(payload.updates.every((u) => u.color === "#ff0000")).toBe(true);

    // Successful bulk → exactly one MARKUP_UPDATE_BATCH history entry
    // with each member's individual prior color preserved.
    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledTimes(1);
    const [before, after, sheetId] = history.pushMarkupUpdateBatchAction.mock.calls[0]!;
    expect(sheetId).toBe("sheet-1");
    expect(before).toEqual([
      { id: "m1", color: "#000000" },
      { id: "m2", color: "#111111" },
      { id: "m3", color: "#222222" },
    ]);
    expect(after).toEqual([
      { id: "m1", color: "#ff0000" },
      { id: "m2", color: "#ff0000" },
      { id: "m3", color: "#ff0000" },
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("multi-select thickness change → exactly ONE bulk mutateAsync, ZERO per-id mutateAsync", async () => {
    const selectedMarkups: MarkupStylingTarget[] = [
      { id: "m1", tool: "RECTANGLE", color: "#ff0000", thickness: 2, text: null },
      { id: "m2", tool: "RECTANGLE", color: "#ff0000", thickness: 4, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 8, text: "" };

    await saveMarkupStylingPopover({
      draft,
      initial,
      showTextInput: false,
      isMulti: true,
      anchor: selectedMarkups[0]!,
      selectedMarkups,
      selectedSheet: "sheet-1",
      updateMarkupMutation: updateMutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
      toast,
      close,
    });

    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();
    const payload = bulkMutation.mutateAsync.mock.calls[0]![0];
    expect(payload.updates.every((u) => u.thickness === 8)).toBe(true);
  });

  it("single-select color change → per-id updateMarkupMutation PATCH (no bulk PATCH)", async () => {
    const selectedMarkups: MarkupStylingTarget[] = [
      { id: "solo", tool: "ARROW", color: "#000000", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    await saveMarkupStylingPopover({
      draft,
      initial,
      showTextInput: false,
      isMulti: false,
      anchor: selectedMarkups[0]!,
      selectedMarkups,
      selectedSheet: "sheet-1",
      updateMarkupMutation: updateMutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
      toast,
      close,
    });

    // Single-select must NOT collapse into the bulk endpoint — that
    // would skip `updateMarkupMutation.onSuccess` and lose the
    // MARKUP_UPDATE history entry that single-edit Undo depends on.
    expect(bulkMutation.mutateAsync).not.toHaveBeenCalled();
    expect(updateMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutation.mutateAsync).toHaveBeenCalledWith({
      id: "solo",
      color: "#ff0000",
      previous: { color: "#000000" },
    });

    // Per-id PATCH path uses the mutation's onSuccess to record
    // history; the helper itself must NOT push a batch entry here.
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("multi-select bulk PATCH rejection → no MARKUP_UPDATE_BATCH push (no phantom Undo)", async () => {
    bulkMutation.mutateAsync.mockRejectedValueOnce(new Error("network down"));

    const selectedMarkups: MarkupStylingTarget[] = [
      { id: "m1", tool: "ARROW", color: "#000000", thickness: 2, text: null },
      { id: "m2", tool: "ARROW", color: "#000000", thickness: 2, text: null },
    ];
    const initial: MarkupStylingDraft = { color: "#000000", thickness: 2, text: "" };
    const draft: MarkupStylingDraft = { color: "#ff0000", thickness: 2, text: "" };

    await saveMarkupStylingPopover({
      draft,
      initial,
      showTextInput: false,
      isMulti: true,
      anchor: selectedMarkups[0]!,
      selectedMarkups,
      selectedSheet: "sheet-1",
      updateMarkupMutation: updateMutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
      toast,
      close,
    });

    // Bulk PATCH was attempted exactly once.
    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    // Helper must NOT have fallen back to the per-id fan-out on
    // rejection — the bulk mutation's onError handles rollback /
    // toast, retrying per-id would re-introduce the gap.
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();
    // Critical: a failed bulk PATCH never lands a MARKUP_UPDATE_BATCH
    // history entry. Otherwise Undo would surface a phantom entry
    // claiming a recolor that never persisted.
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
    // Failed save must NOT close the popover — the user keeps their
    // unsaved draft so they can retry.
    expect(close).not.toHaveBeenCalled();
  });
});
