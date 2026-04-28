/**
 * Shared HTML5 DataTransfer drag-and-drop helpers (Task #2242).
 *
 * Several takeoff specs need to synthesize a DataTransfer-bearing
 * HTML5 drag lifecycle (dragstart → dragenter → dragover → drop →
 * dragend) because Playwright's mouse-driven `dragTo` does NOT ship
 * a custom MIME payload — and our drop handlers all key off of one.
 * That's a different problem from the Konva mouse choreography
 * handled by `canvasDrag.ts`: there's no Konva stage in the loop,
 * just plain React event handlers reading `e.dataTransfer.getData`.
 *
 * Before this helper, three specs had each grown their own copy of
 * the same `page.evaluate(() => { const dt = new DataTransfer(); ...
 * srcEl.dispatchEvent(new DragEvent("dragstart", ...)); ... })`
 * pattern:
 *
 *   - `takeoff-tool-chest.spec.ts` — chest item onto canvas (single
 *     synthesized tick: the canvas drop handler reads only the
 *     custom MIME payload).
 *   - `takeoff-sheet-sets.spec.ts` — `dispatchSheetThumbnailDrop`
 *     (single synthesized tick: same shape, just a different MIME).
 *   - `takeoff-sheet-sets.spec.ts` — the SheetSetsPanel member
 *     reorder (two synthesized ticks: dragstart sets a React state
 *     `draggingSheetId` and the target's onDrop closure won't see
 *     it until React commits the setState).
 *
 * Every copy re-derived the MIME contract, the `text/plain`
 * fallback, the dragenter/dragover/drop ordering, and — for the
 * reorder case — the React-flush split. This module collapses all
 * of that into two API entry points so the next spec author isn't
 * faced with reinventing it (or worse, missing the React-flush
 * split entirely and getting a flake on slow CI runs).
 *
 * # Picking the right variant
 *
 * - **`dispatchHtml5Drop`** — single-tick lifecycle. Use when the
 *   target's `onDrop` handler reads everything it needs from the
 *   DataTransfer (e.g. a JSON blob under a custom MIME). The whole
 *   dragstart → drop sequence runs inside ONE `page.evaluate` tick
 *   so it's fast and there's nothing for React to flush in
 *   between. Examples: chest item onto canvas, sheet thumbnail onto
 *   set row.
 *
 * - **`dispatchHtml5Reorder`** — two-tick lifecycle. Use when the
 *   target's `onDrop` (or `onDragOver`) closure reads from React
 *   component state that was just set by the source's `onDragStart`
 *   handler. React batches the setState, so a same-tick drop
 *   dispatch sees a stale closure. The helper splits the lifecycle
 *   across two `page.evaluate` calls with a short wait in between
 *   so the dragstart-driven render commits before the dragover/drop
 *   pair fires. Example: SheetSetsPanel member reorder, where the
 *   source <li> sets `draggingSheetId` on dragstart and the target
 *   row reads it on drop.
 *
 * If a spec ever needs a flush AFTER dragover (e.g. a handler that
 * reads `hoverIndex` set by onDragOver), reach for
 * `dispatchHtml5Reorder` with `flushAfter: "dragover"`. The default
 * is `"dragstart"` because that's by far the more common shape.
 *
 * # Why the helper accepts Locators
 *
 * Locators are the modern Playwright-recommended primitive (auto-
 * waiting, strict mode, etc.) and the surrounding spec code is
 * already constructing them with `page.getByTestId(...)` — passing
 * those through directly avoids the round-trip to a raw selector
 * string. Internally we resolve each Locator to an `ElementHandle`
 * exactly once and pass the handles into `page.evaluate` so the
 * synthesized events fire on the resolved DOM nodes. Handles are
 * disposed in a `finally` block so a synthesized-drop assertion
 * failure mid-flight doesn't leak handles to the next test.
 */
import type { Locator } from "@playwright/test";

/**
 * Optional payload to load onto the synthesized DataTransfer. The
 * helper writes the payload under both `mime` and `text/plain` —
 * every production drop handler in the codebase that consumes a
 * custom MIME also writes a `text/plain` mirror in its `onDragStart`
 * (see `PageThumbnailStrip.tsx` and `SheetSetsPanel.tsx`), so the
 * mirror keeps the synthesized DataTransfer faithful to what a real
 * browser drag would carry. Handlers that read only the custom MIME
 * are unaffected.
 */
export interface Html5DragPayload {
  /** Custom MIME, e.g. `application/x-takeoff-chest-item+json`. */
  mime: string;
  /** Stringified payload (typically JSON). Also written under `text/plain`. */
  data: string;
}

export interface Html5DropOptions {
  source: Locator;
  target: Locator;
  /**
   * Optional DataTransfer payload. Omit when the target's onDrop
   * doesn't read from DataTransfer (e.g. it gates entirely on React
   * state — that's the `dispatchHtml5Reorder` shape).
   */
  payload?: Html5DragPayload;
}

export interface Html5ReorderOptions {
  source: Locator;
  target: Locator;
  /**
   * Optional DataTransfer payload. The reorder shape usually doesn't
   * need this (the handlers gate on React state), but production
   * code occasionally still writes a `text/plain` marker in
   * `onDragStart` for the OS-level drag image — pass it through if
   * the spec wants the synthesized DataTransfer to match.
   */
  payload?: Html5DragPayload;
  /**
   * Where to insert the React-flush wait. `"dragstart"` (the
   * default) splits the lifecycle so dragstart fires alone, then
   * waits, then dragenter/dragover/drop/dragend fire together —
   * matching handlers that gate on state set in onDragStart.
   * `"dragover"` fires dragstart/dragenter/dragover together, waits,
   * then drop/dragend — matching handlers that gate on state set in
   * onDragOver.
   */
  flushAfter?: "dragstart" | "dragover";
  /**
   * Milliseconds to wait between the two phases for React to flush.
   * 50ms matches what the original `takeoff-sheet-sets.spec.ts`
   * member-reorder migration used and is enough on every engine the
   * suite runs on. Bump it if a future spec finds a flake that this
   * cures.
   */
  flushWaitMs?: number;
}

/**
 * Internal — runs the dragstart/dragenter/dragover/drop/dragend
 * sequence inside the page. Designed to be called either as a
 * single tick (single-tick drop) or one phase at a time
 * (split-phase reorder). The resolved element handles are passed
 * through Playwright's argument bridge so the synthesized events
 * fire on the same DOM nodes the caller's Locators resolved to.
 */
type DragPhase = "start" | "enter" | "over" | "drop" | "end";

async function fireDragEvents(
  source: Locator,
  sourceHandle: Awaited<ReturnType<Locator["elementHandle"]>>,
  targetHandle: Awaited<ReturnType<Locator["elementHandle"]>>,
  phases: DragPhase[],
  payload: Html5DragPayload | null,
  /**
   * When supplied, the helper stashes the synthesized DataTransfer
   * on `window` under this key so a follow-up call can reuse it
   * across page.evaluate ticks. Real browsers carry the same
   * DataTransfer object across the lifecycle; we mirror that for
   * handlers that inspect it across ticks.
   */
  dtWindowKey: string,
): Promise<void> {
  if (!sourceHandle || !targetHandle) {
    throw new Error("htmlDrag: source or target element not found");
  }
  await source.page().evaluate(
    ({ src, dst, phaseList, payloadIn, dtKey }) => {
      const srcEl = src as HTMLElement;
      const dstEl = dst as HTMLElement;
      const win = window as unknown as Record<string, DataTransfer | undefined>;
      let dt = win[dtKey];
      if (!dt) {
        dt = new DataTransfer();
        if (payloadIn) {
          dt.setData(payloadIn.mime, payloadIn.data);
          // Mirror under text/plain so handlers that fall back to
          // the universal plain-text channel see the same payload —
          // production onDragStart code in the takeoff specs writes
          // both, so this keeps the synthesized DataTransfer honest.
          dt.setData("text/plain", payloadIn.data);
        }
        win[dtKey] = dt;
      }
      for (const phase of phaseList as Array<
        "start" | "enter" | "over" | "drop" | "end"
      >) {
        switch (phase) {
          case "start":
            srcEl.dispatchEvent(
              new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
            );
            break;
          case "enter":
            dstEl.dispatchEvent(
              new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
            );
            break;
          case "over":
            dstEl.dispatchEvent(
              new DragEvent("dragover", {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
              }),
            );
            break;
          case "drop":
            dstEl.dispatchEvent(
              new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
              }),
            );
            break;
          case "end":
            srcEl.dispatchEvent(
              new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
            );
            break;
        }
      }
    },
    {
      src: sourceHandle,
      dst: targetHandle,
      phaseList: phases,
      payloadIn: payload,
      dtKey: dtWindowKey,
    },
  );
}

/**
 * Synthesize a single-tick HTML5 drag-and-drop lifecycle from
 * `source` onto `target`, optionally loading a DataTransfer
 * payload. All five lifecycle events (dragstart → dragenter →
 * dragover → drop → dragend) fire inside ONE `page.evaluate` tick.
 *
 * Use when the target's `onDrop` handler reads everything it needs
 * from `e.dataTransfer` and doesn't gate on React state set by
 * `onDragStart` / `onDragOver`. If it does, reach for
 * `dispatchHtml5Reorder` instead.
 */
export async function dispatchHtml5Drop(
  options: Html5DropOptions,
): Promise<void> {
  const { source, target, payload } = options;
  const sourceHandle = await source.elementHandle();
  const targetHandle = await target.elementHandle();
  // Unique key per call so two specs running in parallel can't
  // collide on `window.__htmlDragDt` (Playwright's worker isolation
  // already prevents this, but the unique key keeps the helper
  // robust against future contexts that share a Page).
  const dtKey = `__htmlDragDt_${Math.random().toString(36).slice(2)}`;
  try {
    await fireDragEvents(
      source,
      sourceHandle,
      targetHandle,
      ["start", "enter", "over", "drop", "end"],
      payload ?? null,
      dtKey,
    );
  } finally {
    // Best-effort cleanup of the stashed DataTransfer so we don't
    // leak it onto `window` for the rest of the page's lifetime.
    try {
      await source.page().evaluate((key) => {
        delete (window as unknown as Record<string, unknown>)[key];
      }, dtKey);
    } catch {
      // Page may have navigated mid-test; ignore.
    }
    await sourceHandle?.dispose();
    await targetHandle?.dispose();
  }
}

/**
 * Synthesize a two-phase HTML5 drag-and-drop lifecycle with a
 * React-flush wait inserted at `flushAfter`. All five events fire
 * with a *single* shared DataTransfer (mirroring what a real
 * browser carries across the lifecycle).
 *
 * The default split (`flushAfter: "dragstart"`) matches handlers
 * that read React state set by `onDragStart` (e.g. SheetSetsPanel's
 * `draggingSheetId`). Real-browser drag events naturally satisfy
 * the React-flush requirement because each event is its own task;
 * synthetic dispatches inside one `page.evaluate` would all run in
 * the same task, so we split across two evaluate calls with a
 * `flushWaitMs` (default 50ms) between them.
 */
export async function dispatchHtml5Reorder(
  options: Html5ReorderOptions,
): Promise<void> {
  const {
    source,
    target,
    payload,
    flushAfter = "dragstart",
    flushWaitMs = 50,
  } = options;
  const sourceHandle = await source.elementHandle();
  const targetHandle = await target.elementHandle();
  const dtKey = `__htmlDragDt_${Math.random().toString(36).slice(2)}`;
  const phaseSplit: { first: DragPhase[]; second: DragPhase[] } =
    flushAfter === "dragover"
      ? { first: ["start", "enter", "over"], second: ["drop", "end"] }
      : { first: ["start"], second: ["enter", "over", "drop", "end"] };
  try {
    await fireDragEvents(
      source,
      sourceHandle,
      targetHandle,
      phaseSplit.first,
      payload ?? null,
      dtKey,
    );
    // Yield to React so the setState committed by the first-phase
    // handler(s) commits before the second phase reads the closed-
    // over state.
    await source.page().waitForTimeout(flushWaitMs);
    await fireDragEvents(
      source,
      sourceHandle,
      targetHandle,
      phaseSplit.second,
      payload ?? null,
      dtKey,
    );
  } finally {
    try {
      await source.page().evaluate((key) => {
        delete (window as unknown as Record<string, unknown>)[key];
      }, dtKey);
    } catch {
      // ignore — page may have navigated
    }
    await sourceHandle?.dispose();
    await targetHandle?.dispose();
  }
}
