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
 * Before this helper (and the follow-up Task #2288 migration that
 * moved the last stragglers in), several specs had each grown their
 * own copy of the same `page.evaluate(() => { const dt = new
 * DataTransfer(); ... srcEl.dispatchEvent(new DragEvent("dragstart",
 * ...)); ... })` pattern:
 *
 *   - `takeoff-tool-chest.spec.ts` — chest item onto canvas (single
 *     synthesized tick: the canvas drop handler reads only the
 *     custom MIME payload).
 *   - `takeoff-tool-chest.spec.ts` — chest row reorder (two
 *     synthesized ticks gated by the `ring-2` drop-target class:
 *     ChestSection's `onDrop` reads `hoverIndex` from React state
 *     set by `onDragOver`).
 *   - `takeoff-sheet-sets.spec.ts` — sheet thumbnail onto set row
 *     (single synthesized tick: same shape, just a different MIME).
 *   - `takeoff-sheet-sets.spec.ts` — the SheetSetsPanel member
 *     reorder (two synthesized ticks: dragstart sets a React state
 *     `draggingSheetId` and the target's onDrop closure won't see
 *     it until React commits the setState).
 *   - `takeoff-sheet-sets.spec.ts` — cross-set move + self-drop
 *     no-op (single synthesized tick with three discrete MIMEs and
 *     `effectAllowed = "move"`).
 *
 * Every copy re-derived the MIME contract, the `text/plain`
 * fallback, the dragenter/dragover/drop ordering, and — for the
 * reorder cases — the React-flush split (timed wait *or* a
 * deterministic UI-signal gate). This module collapses all of that
 * into two API entry points so the next spec author isn't faced
 * with reinventing it (or worse, missing the React-flush split
 * entirely and getting a flake on slow CI runs).
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
import { getDragTuning } from "./canvasDrag";

/**
 * Optional payload to load onto the synthesized DataTransfer. When
 * passed via the singular `payload` option, the helper writes the
 * value under both `mime` and `text/plain` — every production drop
 * handler in the codebase that consumes a custom MIME also writes a
 * `text/plain` mirror in its `onDragStart` (see
 * `PageThumbnailStrip.tsx` and `SheetSetsPanel.tsx`), so the mirror
 * keeps the synthesized DataTransfer faithful to what a real browser
 * drag would carry. Handlers that read only the custom MIME are
 * unaffected.
 *
 * Specs that need multiple discrete MIMEs (e.g. the sheet-sets
 * cross-set move dispatches a JSON payload, a different `text/plain`
 * value, and a marker MIME like
 * `application/x-takeoff-sheet-source-${id}`) should use the
 * `payloads` option instead — the helper writes each entry verbatim
 * with no auto-mirroring.
 */
export interface Html5DragPayload {
  /** Custom MIME, e.g. `application/x-takeoff-chest-item+json`. */
  mime: string;
  /** Stringified payload (typically JSON). */
  data: string;
}

/** Subset of DataTransfer.effectAllowed accepted by the helpers. */
export type Html5DragEffectAllowed =
  | "none"
  | "copy"
  | "copyLink"
  | "copyMove"
  | "link"
  | "linkMove"
  | "move"
  | "all"
  | "uninitialized";

export interface Html5DropOptions {
  source: Locator;
  target: Locator;
  /**
   * Optional DataTransfer payload. Writes both `payload.mime` and a
   * mirrored `text/plain` entry. Omit when the target's onDrop
   * doesn't read from DataTransfer (e.g. it gates entirely on React
   * state — that's the `dispatchHtml5Reorder` shape).
   *
   * Mutually exclusive with `payloads`.
   */
  payload?: Html5DragPayload;
  /**
   * Optional list of DataTransfer entries written verbatim (no
   * auto-mirror to `text/plain`). Use when the spec needs multiple
   * discrete MIMEs — the sheet-sets cross-set move test loads three:
   * a custom JSON MIME, a separate `text/plain` value, and a marker
   * MIME whose name embeds the source set id.
   *
   * Mutually exclusive with `payload`.
   */
  payloads?: Html5DragPayload[];
  /**
   * Optional `DataTransfer.effectAllowed` setter, e.g. `"move"` for
   * handlers that branch on the drag effect.
   */
  effectAllowed?: Html5DragEffectAllowed;
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
   *
   * Mutually exclusive with `payloads`.
   */
  payload?: Html5DragPayload;
  /**
   * Optional list of DataTransfer entries written verbatim (no
   * auto-mirror). See `Html5DropOptions.payloads`.
   *
   * Mutually exclusive with `payload`.
   */
  payloads?: Html5DragPayload[];
  /**
   * Optional `DataTransfer.effectAllowed` setter.
   */
  effectAllowed?: Html5DragEffectAllowed;
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
   *
   * If omitted, the wait is derived from `browserName` via
   * `getDragTuning(browserName).syntheticDragReactFlushWait` —
   * webkit/firefox flush React's microtask queue noticeably slower
   * than chromium after a synthetic dragstart, so the engine-aware
   * value avoids races on those engines. When neither `browserName`
   * nor `flushWaitMs` is supplied, the helper falls back to 50ms
   * (the original chromium-only value).
   *
   * Ignored when `flushBetween` is supplied — the deterministic
   * UI-signal callback supersedes the timed wait.
   */
  flushWaitMs?: number;
  /**
   * Browser name (`"chromium"`, `"firefox"`, `"webkit"`) used to
   * derive a default `flushWaitMs` from `getDragTuning(...)
   * .syntheticDragReactFlushWait`. Pass the `browserName` fixture
   * straight through from the test signature so cross-engine timing
   * lives in one place.
   */
  browserName?: string;
  /**
   * Optional async callback awaited *between* the two phases instead
   * of the timed `flushWaitMs`. Use when the spec can pin a
   * deterministic UI signal that the React commit landed (e.g. a
   * drop-target ring class fades in once the target's
   * `setHoverIndex` commits). When supplied, the timed wait is
   * skipped — the callback is the React-flush gate.
   */
  flushBetween?: () => Promise<void>;
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

/**
 * Resolve the `payload`/`payloads` option pair into the verbatim
 * MIME/data list that gets written onto the synthesized
 * DataTransfer. Singular `payload` keeps its historical behavior
 * (writes both `payload.mime` and a mirrored `text/plain` entry);
 * `payloads` is passed through unchanged so callers can specify
 * multiple discrete MIMEs without auto-mirroring.
 */
function resolvePayloads(
  payload: Html5DragPayload | undefined,
  payloads: Html5DragPayload[] | undefined,
): Html5DragPayload[] | null {
  if (payload && payloads) {
    throw new Error(
      "htmlDrag: pass either `payload` or `payloads`, not both",
    );
  }
  if (payloads) return payloads;
  if (payload) {
    return [
      { mime: payload.mime, data: payload.data },
      // Mirror under text/plain so handlers that fall back to the
      // universal plain-text channel see the same payload —
      // production onDragStart code in the takeoff specs writes
      // both, so this keeps the synthesized DataTransfer honest.
      { mime: "text/plain", data: payload.data },
    ];
  }
  return null;
}

async function fireDragEvents(
  source: Locator,
  sourceHandle: Awaited<ReturnType<Locator["elementHandle"]>>,
  targetHandle: Awaited<ReturnType<Locator["elementHandle"]>>,
  phases: DragPhase[],
  payloads: Html5DragPayload[] | null,
  effectAllowed: Html5DragEffectAllowed | null,
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
    ({ src, dst, phaseList, payloadsIn, effectIn, dtKey }) => {
      const srcEl = src as HTMLElement;
      const dstEl = dst as HTMLElement;
      const win = window as unknown as Record<string, DataTransfer | undefined>;
      let dt = win[dtKey];
      if (!dt) {
        dt = new DataTransfer();
        if (effectIn) {
          dt.effectAllowed = effectIn as DataTransfer["effectAllowed"];
        }
        if (payloadsIn) {
          for (const entry of payloadsIn) {
            dt.setData(entry.mime, entry.data);
          }
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
      payloadsIn: payloads,
      effectIn: effectAllowed,
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
  const { source, target, payload, payloads, effectAllowed } = options;
  const resolvedPayloads = resolvePayloads(payload, payloads);
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
      resolvedPayloads,
      effectAllowed ?? null,
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
 * React-flush gate between them.
 *
 * Pick the gate that fits the spec:
 *
 *  - **`flushBetween`** — a deterministic UI-signal callback (e.g.
 *    `await expect(target).toHaveClass(/ring-2/)`). Use when the
 *    spec can pin a render side-effect that proves the first-phase
 *    setState committed.
 *  - **`browserName`** — derives `flushWaitMs` from
 *    `getDragTuning(...).syntheticDragReactFlushWait` so
 *    webkit/firefox get the longer wait their slower microtask
 *    flushing needs (Task #2241). Use this for fire-and-forget
 *    reorders that have no convenient UI signal.
 *  - **`flushWaitMs`** — bare millisecond override. Last resort.
 */
export async function dispatchHtml5Reorder(
  options: Html5ReorderOptions,
): Promise<void> {
  const {
    source,
    target,
    payload,
    payloads,
    effectAllowed,
    flushAfter = "dragstart",
    flushWaitMs,
    browserName,
    flushBetween,
  } = options;
  const resolvedPayloads = resolvePayloads(payload, payloads);
  // Pick the React-flush wait. Caller-supplied `flushWaitMs` wins;
  // otherwise derive from `browserName` so webkit/firefox get the
  // longer wait their slower microtask flushing needs (Task #2241);
  // fall back to the original chromium-friendly 50ms when neither is
  // supplied. Ignored when `flushBetween` is given — the callback
  // becomes the deterministic React-flush gate.
  const resolvedFlushWaitMs =
    flushWaitMs ??
    (browserName
      ? getDragTuning(browserName).syntheticDragReactFlushWait
      : 50);
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
      resolvedPayloads,
      effectAllowed ?? null,
      dtKey,
    );
    // Yield to React so the setState committed by the first-phase
    // handler(s) commits before the second phase reads the closed-
    // over state. Prefer the deterministic UI-signal callback when
    // the spec can pin one (e.g. a drop-target ring class); fall
    // back to the timed wait otherwise.
    if (flushBetween) {
      await flushBetween();
    } else {
      await source.page().waitForTimeout(resolvedFlushWaitMs);
    }
    await fireDragEvents(
      source,
      sourceHandle,
      targetHandle,
      phaseSplit.second,
      resolvedPayloads,
      effectAllowed ?? null,
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
