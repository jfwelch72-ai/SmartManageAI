/**
 * Shared canvas drag/click helpers (Task #1867).
 *
 * The Konva-backed plan/takeoff specs all need the same "drag the mouse
 * across the stage and let the React-Konva pipeline observe enough
 * synthetic mousemoves to settle" choreography. WebKit and Firefox
 * dispatch synthetic mousemoves less aggressively than Chromium when
 * `steps` is small, so the canvas-heavy specs that drive Konva need
 * larger step counts and longer settle waits on those engines.
 *
 * Tasks #1741 / #1761 / #1822 originally inlined that logic in three
 * sibling specs (`takeoff-markup-drawing.spec.ts`,
 * `takeoff-markup-undo.spec.ts`, `takeoff-markup-history-wiring.spec.ts`).
 * Task #1867 folds it into a single helper module so the
 * plan-side specs (`plan-markup-group-drag.spec.ts`,
 * `plan-markup-marquee-select.spec.ts`, `plan-pins.spec.ts`,
 * `drawing-set-pin-bulk.spec.ts`) can share the same engine-aware
 * tuning instead of reinventing it (or worse, missing it entirely and
 * flaking on Firefox/WebKit).
 *
 * The two flavors:
 *
 *   - `dragSequence(page, from, to, browserName, opts?)` — operates in
 *     viewport pixel coordinates. Use when you already have absolute
 *     positions (e.g. the plan-side overlay paths that compute
 *     centroids from a `boundingBox()` of the PDF preview).
 *   - `dragOnCanvas(page, canvas, start, end, browserName, opts?)` —
 *     operates in canvas-relative coordinates. Use when the spec works
 *     in "world" space inside a Konva stage.
 *
 * The defaults dispatch two short pre-moves so Konva's drag-distance
 * threshold clears without collapsing into a click; pass an
 * `intermediate` array to override that with a custom path (e.g. the
 * FREEHAND tool that needs a real curve recorded).
 *
 * Task #1887: every drag gesture is wrapped in a `test.step` with a
 * descriptive title and a JSON attachment that records the resolved
 * from/to points, intermediate waypoints, engine tuning, and (for
 * canvas-relative drags) the canvas bounding box. When a spec flakes
 * the Playwright HTML report shows the actual coordinates inline, so
 * we no longer have to re-run with extra logging to figure out whether
 * Konva missed the drag-distance threshold or the click landed on the
 * wrong shape.
 *
 * Task #1904: the same descriptive title is also opened as a
 * `page.context().tracing.group(...)` so the Playwright trace viewer's
 * left-hand action list shows the resolved gesture (e.g.
 * "dragOnCanvas chromium (50,40) → (200,180) on canvas[…]") wrapping
 * the raw `mouse.move/down/up` calls, instead of just the bare pointer
 * actions. The grouping is best-effort — if tracing isn't recording
 * (or the call site lacks a browser context), the helpers fall back
 * to running the gesture without a group rather than failing the test.
 *
 * Task #1905 extends the same `test.step` + JSON attachment treatment
 * to `clickOnCanvas` because several specs use it to select Konva
 * shapes and the same "did the click land on the wrong spot?"
 * debugging problem applies there too.
 *
 * Task #1885 finishes the centralization for the plan-side specs by
 * adding three small siblings:
 *
 *   - `dragThresholdNudge(from)` — canonical 2-waypoint intermediate
 *     path (`+10,+10`, `+30,+20`) used by every spec that needs to
 *     clear Konva's drag-distance threshold (and the plan-side
 *     marquee's `MARQUEE_MIN_DRAG_PX`) before the final move lands.
 *   - `clickSequence(page, point, browserName)` — the absolute-coord
 *     sibling of `clickOnCanvas`, for plan-side specs that compute
 *     positions from a `pdf-preview-overlay` bounding box instead of
 *     a Konva canvas locator.
 *   - `release: false` option on `dragSequence` plus a companion
 *     `releaseDrag(page, browserName)` — for the marquee mid-drag
 *     assertion that has to fire while the mouse is still pressed.
 *
 * Together these let `plan-markup-group-drag.spec.ts` and
 * `plan-markup-marquee-select.spec.ts` stop issuing raw `page.mouse.*`
 * sequences for canvas drags, so a future cross-engine timing tweak
 * only has to be applied here.
 */
import { test, type Locator, type Page } from "@playwright/test";

export interface Point {
  x: number;
  y: number;
}

export interface DragTuning {
  /** `steps` argument passed to intermediate `mouse.move()` calls. */
  interStep: number;
  /** `steps` argument passed to the final `mouse.move()` to the end point. */
  finalStep: number;
  /** `waitForTimeout` between intermediate moves, ms. */
  interWait: number;
  /**
   * `waitForTimeout` after `mouse.down()` and before the final
   * `mouse.up()`, ms. Gives the engine time to settle before the next
   * pointer event.
   */
  edgeWait: number;
  /** `waitForTimeout` after `mouse.up()`, ms. */
  postUpWait: number;
  /** `waitForTimeout` between `mouse.down()` and `mouse.up()` for clicks, ms. */
  clickHoldWait: number;
  /**
   * Task #2241 — `waitForTimeout` to insert *between* a synthetic
   * `dragstart` `page.evaluate(...)` and the follow-up
   * `dragover`/`drop` `page.evaluate(...)`, ms.
   *
   * The HTML5 drag specs in `e2e/takeoff-sheet-sets.spec.ts` synthesize
   * a `DragEvent` lifecycle directly via `page.evaluate` because
   * Playwright's mouse-based `dragTo` won't ship the custom
   * `application/x-takeoff-sheet` MIME the React drop handlers read.
   * The reorder flow gates the target's `onDrop` on a local React
   * state (`draggingSheetId`) that's only set inside the source's
   * `onDragStart` — so the spec has to give React a tick to flush
   * that setState commit before the next evaluate dispatches
   * `dragover`/`drop`. Chromium typically flushes within ~30–50ms;
   * webkit and firefox are slower at scheduling the React work loop
   * after a synthetic event, so the same 50ms wait the chromium-only
   * spec used originally races on those engines and the drop closure
   * reads `draggingSheetId === null`.
   *
   * Bumping the wait on webkit/firefox is enough — there's no native
   * animation frame to coordinate with, just React's microtask queue.
   * Centralizing the constant here so any future spec that needs to
   * synthesize a multi-evaluate HTML5 drag (the panel's drop-onto-row
   * flow, future palette-into-canvas drops, etc.) can share the same
   * tuning instead of re-deriving it.
   */
  syntheticDragReactFlushWait: number;
}

/**
 * Returns the per-engine timing/step tuning the drag helpers use.
 *
 * Exported so individual specs can branch on it for one-off paths
 * (e.g. multi-stage gestures that use `page.mouse` directly but still
 * want the same Firefox/WebKit accommodation).
 */
export function getDragTuning(browserName: string): DragTuning {
  const isChromium = browserName === "chromium";
  return {
    interStep: isChromium ? 4 : 8,
    finalStep: isChromium ? 12 : 20,
    interWait: isChromium ? 25 : 50,
    edgeWait: isChromium ? 60 : 120,
    postUpWait: isChromium ? 120 : 200,
    clickHoldWait: isChromium ? 30 : 60,
    // Task #2241 — webkit/firefox need more headroom for React to
    // commit a setState scheduled inside a synthetic dragstart before
    // the next evaluate dispatches dragover/drop. See the JSDoc on
    // `DragTuning.syntheticDragReactFlushWait` for the full story.
    syntheticDragReactFlushWait: isChromium ? 60 : 150,
  };
}

export interface DragOptions {
  /**
   * Custom intermediate waypoints, in the same coordinate space as
   * `from`/`to`. When omitted, two short pre-moves clear Konva's
   * drag-distance threshold without registering as a click. Pass a
   * non-empty array to override (e.g. record a freehand stroke).
   */
  intermediate?: Point[];
  /**
   * When true (the default), if no `intermediate` waypoints are
   * supplied, the helper inserts two short pre-moves to clear Konva's
   * drag-distance threshold. Set to false for callers that want to
   * skip the warmup (rare).
   */
  preMoves?: boolean;
  /**
   * When true (the default), the helper releases the mouse button at
   * the end of the gesture. Set to false to leave the pointer pressed
   * at `to` so the caller can run an assertion mid-drag (e.g. checking
   * that the marquee overlay is visible while the mouse is still
   * down). Pair with `releaseDrag(page, browserName)` to finish the
   * gesture once the mid-drag assertion has settled. Task #1885 added
   * this so the plan-side marquee spec can stop hand-rolling its own
   * partial drag sequence.
   */
  release?: boolean;
}

/**
 * Canonical pair of intermediate waypoints used to clear Konva's
 * `drag-distance` threshold (and the plan-side marquee's
 * `MARQUEE_MIN_DRAG_PX` threshold) before the final move lands.
 *
 * The exact offsets — `+10,+10` then `+30,+20` — mirror what the
 * takeoff/plan specs originally inlined. Centralizing them here lets
 * a future cross-engine timing tweak live in one place; today every
 * call site that needed a custom intermediate path was using these
 * same numbers.
 *
 * Use as `intermediate: dragThresholdNudge(from)` when calling
 * `dragSequence` / `dragOnCanvas`. `from` is in whatever coordinate
 * space the surrounding drag uses (viewport pixels for `dragSequence`,
 * canvas-relative for `dragOnCanvas`).
 */
export function dragThresholdNudge(from: Point): Point[] {
  return [
    { x: from.x + 10, y: from.y + 10 },
    { x: from.x + 30, y: from.y + 20 },
  ];
}

/** Format a point as a compact `(x, y)` string for step titles. */
function fmtPoint(p: Point): string {
  return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
}

/**
 * Format a bounding box as a compact `[x,y w×h]` string suitable for
 * embedding in trace-viewer group titles. The trace viewer's action
 * list truncates aggressively, so keep this terse.
 */
function fmtBox(box: { x: number; y: number; width: number; height: number }): string {
  return (
    `[${box.x.toFixed(1)},${box.y.toFixed(1)} ` +
    `${box.width.toFixed(1)}×${box.height.toFixed(1)}]`
  );
}

/**
 * Attach a JSON blob describing the gesture to the active test step.
 *
 * Wrapped in try/catch so the helpers stay usable from contexts where
 * `test.info()` isn't available (e.g. global setup, ad-hoc scripts).
 */
async function attachGesture(name: string, payload: unknown): Promise<void> {
  try {
    await test.info().attach(name, {
      body: JSON.stringify(payload, null, 2),
      contentType: "application/json",
    });
  } catch {
    // Outside a Playwright test runtime — skip the attachment silently.
  }
}

/**
 * Open a Playwright `tracing.group` named `title`, run `fn`, and make
 * sure the matching `groupEnd()` runs even when `fn` throws. The group
 * surfaces the resolved gesture in the trace viewer's left-hand action
 * list, wrapping the raw `mouse.move/down/up` calls underneath.
 *
 * `tracing.group` is a no-op when tracing isn't recording, but the
 * surrounding `page.context()` lookup throws if the helper is called
 * outside a real browser context (e.g. ad-hoc scripts). We swallow
 * those errors so the gesture still runs — the trace just won't have
 * the pretty group label.
 */
async function withTracingGroup<T>(
  page: Page,
  title: string,
  fn: () => Promise<T>,
): Promise<T> {
  let opened = false;
  let tracing: ReturnType<Page["context"]>["tracing"] | undefined;
  try {
    tracing = page.context().tracing;
    await tracing.group(title);
    opened = true;
  } catch {
    // Tracing API unavailable (no context, or the channel rejected) —
    // run the gesture without a group rather than failing the test.
  }
  try {
    return await fn();
  } finally {
    if (opened && tracing) {
      try {
        await tracing.groupEnd();
      } catch {
        // Best effort — never let a teardown failure mask the real error.
      }
    }
  }
}

/**
 * Drag the mouse from `from` to `to` in viewport pixel coordinates.
 *
 * The helper applies engine-aware step counts and waits so the same
 * call site behaves consistently on Chromium, Firefox, and WebKit.
 *
 * Wrapped in a `test.step` so the resolved gesture (from/to,
 * intermediate waypoints, tuning) shows up inline in the Playwright
 * HTML report when an assertion downstream fails.
 */
export async function dragSequence(
  page: Page,
  from: Point,
  to: Point,
  browserName: string,
  options: DragOptions = {},
): Promise<void> {
  const { intermediate, preMoves = true, release = true } = options;
  const tuning = getDragTuning(browserName);
  const { interStep, finalStep, interWait, edgeWait, postUpWait } = tuning;

  // Resolve the path up-front so the trace records what actually got
  // dispatched (not just what the caller asked for).
  let waypoints: Point[];
  let waypointSource: "custom" | "preMoves" | "none";
  if (intermediate && intermediate.length > 0) {
    waypoints = intermediate;
    waypointSource = "custom";
  } else if (preMoves) {
    waypoints = [
      { x: from.x + 8, y: from.y + 6 },
      { x: from.x + 20, y: from.y + 14 },
    ];
    waypointSource = "preMoves";
  } else {
    waypoints = [];
    waypointSource = "none";
  }

  const stepTitle =
    `canvasDrag.dragSequence ${browserName} ` +
    `${fmtPoint(from)} → ${fmtPoint(to)} ` +
    `[${waypoints.length} waypoint${waypoints.length === 1 ? "" : "s"}]`;

  await test.step(stepTitle, async () => {
    await attachGesture("canvas-drag.gesture", {
      kind: "dragSequence",
      browserName,
      from,
      to,
      waypoints,
      waypointSource,
      preMoves,
      release,
      tuning,
    });

    // Open a tracing group so the trace viewer's action list shows the
    // resolved gesture title alongside the raw mouse events instead of
    // a pile of bare `mouse.move/down/up` rows.
    await withTracingGroup(page, stepTitle, async () => {
      // Two `mouse.move()` calls so WebKit reliably dispatches the initial
      // mousemove before the synthetic mousedown lands.
      await page.mouse.move(from.x, from.y);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(edgeWait);

      for (const p of waypoints) {
        await page.mouse.move(p.x, p.y, { steps: interStep });
        await page.waitForTimeout(interWait);
      }

      await page.mouse.move(to.x, to.y, { steps: finalStep });
      await page.waitForTimeout(edgeWait);
      if (release) {
        await page.mouse.up();
        await page.waitForTimeout(postUpWait);
      }
    });
  });
}

/**
 * Release the mouse button that a previous `dragSequence(..., {
 * release: false })` call left pressed, applying the same engine-aware
 * `postUpWait` so the surrounding spec doesn't have to re-derive the
 * tuning. Pair with the `release: false` option on `dragSequence` /
 * `dragOnCanvas` for mid-drag assertions (e.g. checking that the
 * marquee overlay is visible while the mouse is still down).
 */
export async function releaseDrag(
  page: Page,
  browserName: string,
): Promise<void> {
  const tuning = getDragTuning(browserName);
  await test.step(`canvasDrag.releaseDrag ${browserName}`, async () => {
    await attachGesture("canvas-drag.gesture", {
      kind: "releaseDrag",
      browserName,
      tuning,
    });
    await page.mouse.up();
    await page.waitForTimeout(tuning.postUpWait);
  });
}

/**
 * Click the mouse at `point` in viewport pixel coordinates.
 *
 * Mirrors `clickOnCanvas` but for callers that already work in
 * absolute viewport coordinates (e.g. plan-side specs that compute
 * positions from a `pdf-preview-overlay` bounding box rather than the
 * Konva canvas itself). Two `mouse.move()` calls so WebKit reliably
 * dispatches the initial mousemove before the click sequence, and
 * `clickHoldWait` is taken from `getDragTuning` so the engine-aware
 * timing matches every other helper in this module.
 *
 * Wrapped in a `test.step` + JSON attachment so the resolved click
 * point shows up inline in the Playwright HTML report (same treatment
 * as `clickOnCanvas`). Task #1885 added this helper so the plan-side
 * markup specs can stop hand-rolling their own click sequences.
 */
export async function clickSequence(
  page: Page,
  point: Point,
  browserName: string,
): Promise<void> {
  const tuning = getDragTuning(browserName);
  const stepTitle =
    `canvasDrag.clickSequence ${browserName} ` +
    `${fmtPoint(point)} (viewport)`;

  await test.step(stepTitle, async () => {
    await attachGesture("canvas-drag.gesture", {
      kind: "clickSequence",
      browserName,
      point,
      tuning,
    });

    await page.mouse.move(point.x, point.y);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { delay: tuning.clickHoldWait });
  });
}

/**
 * Drag the mouse on a Konva canvas (or any element) using
 * canvas-relative coordinates. Resolves the canvas's bounding box
 * once and then delegates to `dragSequence`.
 *
 * Wrapped in a `test.step` so the trace records both the
 * canvas-relative gesture the spec asked for and the resolved canvas
 * bounding box. That makes it possible to tell at a glance whether a
 * failing click landed on the wrong shape because the canvas moved or
 * because the relative coordinates were off.
 */
export async function dragOnCanvas(
  page: Page,
  canvas: Locator,
  start: Point,
  end: Point,
  browserName: string,
  options: DragOptions = {},
): Promise<void> {
  const stepTitle =
    `canvasDrag.dragOnCanvas ${browserName} ` +
    `${fmtPoint(start)} → ${fmtPoint(end)} (canvas-relative)`;

  await test.step(stepTitle, async () => {
    const box = await canvas.boundingBox();
    if (!box) {
      await attachGesture("canvas-drag.gesture", {
        kind: "dragOnCanvas",
        browserName,
        start,
        end,
        error: "Canvas has no bounding box",
      });
      throw new Error("Canvas has no bounding box");
    }
    const offset = (p: Point): Point => ({ x: box.x + p.x, y: box.y + p.y });
    const resolvedStart = offset(start);
    const resolvedEnd = offset(end);
    const resolvedIntermediate = options.intermediate?.map(offset);

    await attachGesture("canvas-drag.gesture", {
      kind: "dragOnCanvas",
      browserName,
      canvasBoundingBox: box,
      relative: { start, end, intermediate: options.intermediate ?? null },
      resolved: {
        from: resolvedStart,
        to: resolvedEnd,
        intermediate: resolvedIntermediate ?? null,
      },
      preMoves: options.preMoves ?? true,
      tuning: getDragTuning(browserName),
    });

    // Trace-viewer group title now that we know the canvas bounding box —
    // having the box inline makes it possible to tell at a glance whether
    // the canvas-relative coordinates resolved to the expected viewport
    // pixels without scrubbing through the snapshot timeline. The inner
    // dragSequence opens a nested group with the resolved viewport coords.
    const tracingTitle =
      `canvasDrag.dragOnCanvas ${browserName} ` +
      `${fmtPoint(start)} → ${fmtPoint(end)} on canvas ${fmtBox(box)}`;

    await withTracingGroup(page, tracingTitle, async () => {
      await dragSequence(
        page,
        resolvedStart,
        resolvedEnd,
        browserName,
        {
          ...options,
          intermediate: resolvedIntermediate,
        },
      );
    });
  });
}

/**
 * Click on a Konva canvas (or any element) at a canvas-relative point.
 * Two `mouse.move()` calls so WebKit reliably dispatches the initial
 * mousemove before the click sequence.
 *
 * Wrapped in a `test.step` so the trace records both the
 * canvas-relative point the spec asked for and the resolved viewport
 * coordinates. Mirrors the format used by `dragOnCanvas` so a failing
 * click-based spec shows the resolved coordinates inline in the
 * Playwright HTML report — no need to re-run with extra logging to
 * figure out whether the click landed on the wrong shape.
 */
export async function clickOnCanvas(
  page: Page,
  canvas: Locator,
  point: Point,
  browserName = "chromium",
): Promise<void> {
  // Resolve the canvas bounding box up-front so the `test.step` title
  // can include the resolved viewport coordinates. That makes a failing
  // click-based spec scannable in the Playwright HTML report without
  // having to expand the step's JSON attachment.
  const box = await canvas.boundingBox();
  if (!box) {
    await attachGesture("canvas-drag.gesture", {
      kind: "clickOnCanvas",
      browserName,
      relative: { point },
      error: "Canvas has no bounding box",
    });
    throw new Error("Canvas has no bounding box");
  }
  const resolved: Point = { x: box.x + point.x, y: box.y + point.y };
  const tuning = getDragTuning(browserName);

  const stepTitle =
    `canvasDrag.clickOnCanvas ${browserName} ` +
    `${fmtPoint(point)} → ${fmtPoint(resolved)} (viewport)`;

  await test.step(stepTitle, async () => {
    await attachGesture("canvas-drag.gesture", {
      kind: "clickOnCanvas",
      browserName,
      canvasBoundingBox: box,
      relative: { point },
      resolved: { point: resolved },
      tuning,
    });

    await page.mouse.move(resolved.x, resolved.y);
    await page.mouse.move(resolved.x, resolved.y);
    await page.mouse.down();
    await page.waitForTimeout(tuning.clickHoldWait);
    await page.mouse.up();
  });
}
