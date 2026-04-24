/**
 * Task #1757 — End-to-end coverage for the markup body-drag and resize
 * commit helpers extracted from `TakeoffWorkspace`. Driving the helpers
 * directly proves that:
 *   - Single body drags fire one PATCH on `updateMarkupMutation` that
 *     forwards `previous: { points }`, so its onSuccess records exactly
 *     one MARKUP_UPDATE history entry (#1742).
 *   - Multi-select body drags commit through ONE
 *     `bulkUpdateMarkupsMutation.mutateAsync` PATCH carrying the whole
 *     gesture (#1752 — one server round-trip + one cache invalidation,
 *     instead of the legacy N-parallel-PATCH fan-out) and only push the
 *     `MARKUP_UPDATE_BATCH` history entry AFTER it resolves (#1759 —
 *     prevents a phantom Undo entry when the bulk PATCH fails).
 *   - Resize-handle commits forward `previous: { points }` whenever the
 *     pre-resize ref is captured (#1754).
 *
 * These tests fail loudly the moment any call site or helper drops
 * `previous`, regresses the multi-select commit back to the per-markup
 * fan-out, or pushes the batch history entry up front again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import {
  commitMarkupBodyDrag,
  commitMarkupResize,
  type BulkMarkupUpdatePayload,
  type MarkupForSiblingLookup,
  type MarkupSnapshotForBatch,
  type MarkupUpdatePayload,
  type Point,
} from "../markup-drag-commit";

type MutationSpy = {
  mutate: Mock<(data: MarkupUpdatePayload) => void>;
  mutateAsync: Mock<(data: MarkupUpdatePayload) => Promise<unknown>>;
};

type BulkMutationSpy = {
  mutateAsync: Mock<(data: BulkMarkupUpdatePayload) => Promise<unknown>>;
};

type HistorySpy = {
  pushMarkupUpdateBatchAction: Mock<
    (
      before: MarkupSnapshotForBatch[],
      after: MarkupSnapshotForBatch[],
      sheetId: string,
    ) => void
  >;
};

function makeMutation(): MutationSpy {
  return {
    mutate: vi.fn<(data: MarkupUpdatePayload) => void>(),
    mutateAsync: vi.fn<(data: MarkupUpdatePayload) => Promise<unknown>>(
      async () => ({ id: "ok" }),
    ),
  };
}

function makeBulkMutation(): BulkMutationSpy {
  return {
    mutateAsync: vi.fn<(data: BulkMarkupUpdatePayload) => Promise<unknown>>(
      async () => ({ ok: true }),
    ),
  };
}

function makeHistory(): HistorySpy {
  return {
    pushMarkupUpdateBatchAction: vi.fn<
      (
        before: MarkupSnapshotForBatch[],
        after: MarkupSnapshotForBatch[],
        sheetId: string,
      ) => void
    >(),
  };
}

describe("commitMarkupBodyDrag", () => {
  let mutation: MutationSpy;
  let bulkMutation: BulkMutationSpy;
  let history: HistorySpy;

  beforeEach(() => {
    mutation = makeMutation();
    bulkMutation = makeBulkMutation();
    history = makeHistory();
  });

  it("is a no-op when the drag delta is zero (no PATCH, no history push)", async () => {
    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      dx: 0,
      dy: 0,
      siblingIds: [],
      markups: [],
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    expect(bulkMutation.mutateAsync).not.toHaveBeenCalled();
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
  });

  it("single-markup drag fires exactly one updateMarkupMutation PATCH with `previous: { points }` (no batch, no bulk) (#1742)", async () => {
    const rawPts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];

    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts,
      dx: 5,
      dy: 7,
      siblingIds: [],
      markups: [],
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mutation.mutate).toHaveBeenCalledWith({
      id: "m1",
      points: [{ x: 5, y: 7 }, { x: 15, y: 17 }],
      previous: { points: rawPts },
    });
    // The single-drag branch leans on `updateMarkupMutation.onSuccess` to
    // record one MARKUP_UPDATE entry — the helper must NOT push a batch
    // and must NOT commit through the bulk mutation for one markup.
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
    expect(bulkMutation.mutateAsync).not.toHaveBeenCalled();
    // skipHistory must NOT leak into the single-drag PATCH or the
    // mutation's onSuccess will silently skip the history entry.
    expect(mutation.mutate.mock.calls[0]![0].skipHistory).toBeUndefined();
  });

  it("multi-select drag commits ONE bulkUpdateMarkupsMutation PATCH for the whole gesture and never per-markup (#1752 / #1755)", async () => {
    const rawPts: Point[] = [{ x: 0, y: 0 }];
    const sibAPts: Point[] = [{ x: 100, y: 100 }];
    const sibBPts: Point[] = [{ x: 200, y: 200 }];
    const markups: MarkupForSiblingLookup[] = [
      { id: "m2", points: sibAPts },
      { id: "m3", points: sibBPts },
    ];

    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts,
      dx: 1,
      dy: 2,
      siblingIds: ["m2", "m3"],
      markups,
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    // Per-markup PATCHes must NOT fire in the multi-select branch — that
    // would resurrect the legacy N-parallel-PATCH fan-out that #1752
    // explicitly replaced.
    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(bulkMutation.mutateAsync).toHaveBeenCalledWith({
      updates: [
        { id: "m1", points: [{ x: 1, y: 2 }] },
        { id: "m2", points: [{ x: 101, y: 102 }] },
        { id: "m3", points: [{ x: 201, y: 202 }] },
      ],
    });
  });

  it("multi-select drag pushes the MARKUP_UPDATE_BATCH entry only after the bulk PATCH resolves (#1759)", async () => {
    // Arrange a controllable bulk-mutation promise so the test can prove
    // history push is deferred until resolution, not synchronous with
    // mutateAsync invocation.
    let resolveBulk!: (v: unknown) => void;
    bulkMutation.mutateAsync.mockImplementationOnce(
      () => new Promise((res) => { resolveBulk = res; }),
    );

    const rawPts: Point[] = [{ x: 0, y: 0 }];
    const sibPts: Point[] = [{ x: 100, y: 100 }];

    const commitPromise = commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts,
      dx: 10,
      dy: 20,
      siblingIds: ["m2"],
      markups: [{ id: "m2", points: sibPts }],
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    // Yield once so the helper enters the await on mutateAsync.
    await Promise.resolve();
    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    // Critical Task #1759 contract: the history push MUST NOT have fired
    // yet — the bulk PATCH is still in flight.
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();

    // Now resolve the bulk PATCH and let the helper finish.
    resolveBulk({ ok: true });
    await commitPromise;

    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledWith(
      [
        { id: "m1", points: rawPts },
        { id: "m2", points: sibPts },
      ],
      [
        { id: "m1", points: [{ x: 10, y: 20 }] },
        { id: "m2", points: [{ x: 110, y: 120 }] },
      ],
      "sheet-1",
    );
  });

  it("multi-select drag SKIPS the MARKUP_UPDATE_BATCH push when the bulk PATCH rejects (#1759 — no phantom Undo)", async () => {
    bulkMutation.mutateAsync.mockRejectedValueOnce(new Error("network down"));

    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts: [{ x: 0, y: 0 }],
      dx: 1,
      dy: 1,
      siblingIds: ["m2"],
      markups: [{ id: "m2", points: [{ x: 100, y: 100 }] }],
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    // Bulk PATCH was attempted, but its rejection means the gesture
    // never landed on the server — pushing a MARKUP_UPDATE_BATCH would
    // leave a phantom Undo entry claiming a move that never happened.
    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
  });

  it("multi-select drag handles JSON-string sibling points (mirrors cache-shape variation)", async () => {
    const rawPts: Point[] = [{ x: 0, y: 0 }];
    const stringPts = JSON.stringify([{ x: 50, y: 50 }]);
    const markups: MarkupForSiblingLookup[] = [
      { id: "m2", points: stringPts },
    ];

    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts,
      dx: 5,
      dy: 5,
      siblingIds: ["m2"],
      markups,
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    expect(bulkMutation.mutateAsync).toHaveBeenCalledWith({
      updates: [
        { id: "m1", points: [{ x: 5, y: 5 }] },
        { id: "m2", points: [{ x: 55, y: 55 }] },
      ],
    });
    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledWith(
      [
        { id: "m1", points: [{ x: 0, y: 0 }] },
        { id: "m2", points: [{ x: 50, y: 50 }] },
      ],
      [
        { id: "m1", points: [{ x: 5, y: 5 }] },
        { id: "m2", points: [{ x: 55, y: 55 }] },
      ],
      "sheet-1",
    );
  });

  it("multi-select drag skips siblings that are missing from the markups cache (still commits the primary)", async () => {
    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts: [{ x: 0, y: 0 }],
      dx: 1,
      dy: 1,
      siblingIds: ["missing"],
      markups: [],
      selectedSheet: "sheet-1",
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    // The missing sibling contributes nothing; the primary markup still
    // commits through the bulk mutation with a one-element updates array.
    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(bulkMutation.mutateAsync).toHaveBeenCalledWith({
      updates: [{ id: "m1", points: [{ x: 1, y: 1 }] }],
    });
    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledWith(
      [{ id: "m1", points: [{ x: 0, y: 0 }] }],
      [{ id: "m1", points: [{ x: 1, y: 1 }] }],
      "sheet-1",
    );
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("multi-select drag skips the batch push when there is no selectedSheet (bulk PATCH still fires)", async () => {
    await commitMarkupBodyDrag({
      markup: { id: "m1" },
      rawPts: [{ x: 0, y: 0 }],
      dx: 5,
      dy: 5,
      siblingIds: ["m2"],
      markups: [{ id: "m2", points: [{ x: 100, y: 100 }] }],
      selectedSheet: null,
      updateMarkupMutation: mutation,
      bulkUpdateMarkupsMutation: bulkMutation,
      takeoffHistory: history,
    });

    expect(bulkMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
});

describe("commitMarkupResize", () => {
  let mutation: MutationSpy;

  beforeEach(() => {
    mutation = makeMutation();
  });

  it("forwards `previous: { points }` when origPts is captured (#1754)", async () => {
    const origPts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const newPts: Point[] = [{ x: 0, y: 0 }, { x: 30, y: 30 }];

    await commitMarkupResize({
      markupId: "m1",
      newPts,
      origPts,
      updateMarkupMutation: mutation,
    });

    expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      id: "m1",
      points: newPts,
      previous: { points: origPts },
    });
  });

  it("omits `previous` when origPts is undefined (arrow handle dropped pre-resize ref)", async () => {
    const newPts: Point[] = [{ x: 0, y: 0 }, { x: 30, y: 30 }];

    await commitMarkupResize({
      markupId: "m1",
      newPts,
      origPts: undefined,
      updateMarkupMutation: mutation,
    });

    expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      id: "m1",
      points: newPts,
    });
    const payload = mutation.mutateAsync.mock.calls[0]![0];
    expect(payload.previous).toBeUndefined();
  });

  it("swallows mutateAsync errors so the optimistic-rollback path in the mutation can take over", async () => {
    mutation.mutateAsync.mockRejectedValueOnce(new Error("network down"));

    await expect(
      commitMarkupResize({
        markupId: "m1",
        newPts: [{ x: 0, y: 0 }],
        origPts: [{ x: 5, y: 5 }],
        updateMarkupMutation: mutation,
      }),
    ).resolves.toBeUndefined();
  });
});
