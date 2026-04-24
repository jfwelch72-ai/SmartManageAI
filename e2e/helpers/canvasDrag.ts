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
 * Task #1887: every gesture is wrapped in a `test.step` with a
 * descriptive title and a JSON attachment that records the resolved
 * from/to points, intermediate waypoints, engine tuning, and (for
 * canvas-relative drags) the canvas bounding box. When a spec flakes
 * the Playwright HTML report shows the actual coordinates inline, so
 * we no longer have to re-run with extra logging to figure out whether
 * Konva missed the drag-distance threshold or the click landed on the
 * wrong shape.
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
}

/** Format a point as a compact `(x, y)` string for step titles. */
function fmtPoint(p: Point): string {
  return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
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
  const { intermediate, preMoves = true } = options;
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
      tuning,
    });

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
    await page.mouse.up();
    await page.waitForTimeout(postUpWait);
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
}

/**
 * Click on a Konva canvas (or any element) at a canvas-relative point.
 * Two `mouse.move()` calls so WebKit reliably dispatches the initial
 * mousemove before the click sequence.
 */
export async function clickOnCanvas(
  page: Page,
  canvas: Locator,
  point: Point,
  browserName = "chromium",
): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");
  const x = box.x + point.x;
  const y = box.y + point.y;
  const { clickHoldWait } = getDragTuning(browserName);
  await page.mouse.move(x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(clickHoldWait);
  await page.mouse.up();
}
