/**
 * Task #2222 / #2221 — End-to-end touch-emulation coverage for the
 * takeoff stylus / palm-rejection / two-finger-rotate / narrow-ribbon
 * contract.
 *
 * Task #2205 added vitest+jsdom integration tests that drive synthetic
 * `PointerEvent`s through `PlanMarkupLayer` (palm rejection), the long
 * -press → snap HUD bridge (`useStylusLongPress`), and the two-finger
 * rotate gate inside `useTakeoffInteractions`. Those tests pin down
 * the contract but cannot:
 *
 *   • Confirm the hooks are actually wired into `TakeoffWorkspace`'s
 *     real DOM tree (the snap-HUD bridge there is a hand-rolled vitest
 *     harness because TakeoffWorkspace is too large to unit-mount).
 *   • Assert visual outcomes — the snap HUD popover content, the
 *     marquee rectangle's anchor position, the sheet rotating on
 *     screen, the ribbon collapsing on a narrow viewport — because
 *     jsdom has no Konva canvas pipeline and no real
 *     `window.matchMedia` viewport contract.
 *
 * This spec runs in a dedicated `chromium-touch` Playwright project
 * (declared in `playwright.config.ts`) which sets `hasTouch: true` so
 * the page exposes the `Touch` / `TouchEvent` constructors and the
 * stylus-flavoured `PointerEvent` fields (`pointerType: "pen"`,
 * `width`, `height`) that the production code reads.
 *
 * Coverage — mirrors the four scenarios in
 * `docs/runbooks/takeoff-stylus-hardware-qa.md`:
 *
 *   1. **Palm rejection** in the plan-side `PlanMarkupLayer`. Dispatches
 *      a pen `pointerdown` (which arms the SELECT-mode marquee at the
 *      pen position) followed by a fat-finger `pointerdown`
 *      (`pointerType: "touch"`, `width`/`height` > the palm rejection
 *      band). Asserts the marquee rectangle stays anchored at the pen
 *      position — the palm touch is dropped before the SELECT branch
 *      can re-anchor.
 *
 *   2. **Stylus long-press → snap HUD** in the standalone takeoff
 *      workspace. Dispatches a `pointerdown` with `pointerType: "pen"`
 *      on the canvas viewport, holds without moving for the configured
 *      `stylusLongPressMs`, and asserts the `snap-hud` popover opens.
 *
 *   3. **Two-finger rotate gating** in the takeoff canvas — the
 *      gesture rotates the sheet 90° when the per-user
 *      `allowTwoFingerRotate` toggle is **on**, and is a complete
 *      no-op when the toggle is **off** (Task #2221's regression
 *      guard for the runbook's "rotate stays off when toggle is off"
 *      check).
 *
 *   4. **Narrow-viewport ribbon** in `UnifiedTakeoffRibbon`. Mounts the
 *      takeoff workspace at a sub-768px viewport and asserts the
 *      low-priority groups (snap / constrain / view / verify) start
 *      collapsed while the primary groups (select / measure /
 *      annotate) stay expanded — the contract documented as
 *      `NARROW_DEFAULT_COLLAPSED_GROUPS` in the ribbon source.
 *
 * Dispatch strategy: every gesture is dispatched via `page.evaluate`
 * (see `helpers/syntheticPointer.ts`) so the `PointerEvent` /
 * `TouchEvent` constructors run inside the real Chromium page context.
 * Konva attaches its native event listeners to `stage.container()`;
 * pointer events bubble from the `<canvas>` up to that container, and
 * the long-press hook listens on the takeoff `containerRef` div which
 * sits above the Konva canvas in the DOM tree, so events bubble
 * straight to it as well.
 */
import { test, expect, type Page } from "@playwright/test";
import { authedRequest, installCsrf } from "./helpers/csrf";
import { getMinimalPdf, uploadFixturePdf } from "./helpers/uploadFixturePdf";
import {
  dispatchPointer,
  dispatchTouch,
  synthesizeTwoFingerRotate,
} from "./helpers/syntheticPointer";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface BidResponse {
  id: string;
  code: string;
}

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
}

interface PlanDocumentResponse {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
}

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: Array<{ x: number; y: number }>;
}

interface TakeoffSheet {
  id: string;
  rotation: number | null;
}

async function devLogin(page: Page, role: string) {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function suppressBidPlansTour(page: Page) {
  // Same Joyride suppression as `takeoff-standalone-workspace.spec.ts`
  // so the tour overlay doesn't intercept synthetic touches.
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;
  await page.evaluate((tourKey) => {
    localStorage.setItem(tourKey, "1");
  }, `bid-plans-tour-completed-${userId}`);
}

// Top-level — Playwright forbids `test.use({ video })` inside a describe
// because the video setting is per-worker.
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff touch-emulation gestures (Task #2222)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  // -------------------------------------------------------------------
  // 1. Stylus long-press → snap HUD opens
  // -------------------------------------------------------------------
  test("stylus long-press on the takeoff canvas opens the snap HUD", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await devLogin(page, "ADMIN");

    const fixtureRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/dev/seed-takeoff-fixture`,
      { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
    );
    expect(fixtureRes.status()).toBe(200);
    const fixture = (await fixtureRes.json()) as {
      bid: BidResponse;
      sheetIds: string[];
    };

    // Pre-seed the active sheet so the workspace mounts straight into a
    // rendered Konva stage. Mirrors `takeoff-standalone-workspace.spec.ts`.
    await page.goto(`${BASE_URL}/bids/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.evaluate(
      ({ key, value }) => {
        sessionStorage.setItem(key, value);
      },
      {
        key: `takeoff-sheet-${fixture.bid.id}`,
        value: fixture.sheetIds[0],
      },
    );

    await page.goto(`${BASE_URL}/takeoff/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 30_000,
    });
    const canvas = page.locator(".konvajs-content canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 30_000 });

    // Snap HUD must start closed — sanity check so a previous test
    // leaving it open can't make this case silently pass.
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Pen pointerdown anywhere on the canvas. The takeoff workspace
    // attaches its long-press listener to the CanvasViewport
    // `containerRef` div which sits above the canvas — pointer events
    // bubble straight to it.
    await dispatchPointer(page, ".konvajs-content canvas", "pointerdown", {
      pointerId: 1,
      pointerType: "pen",
      clientX: cx,
      clientY: cy,
    });

    // Wait past the default 500 ms hold (`DEFAULT_STYLUS_LONG_PRESS_MS`).
    // A small safety margin so the timer fires before we assert. We do
    // NOT dispatch any pointermove — the detector cancels the hold if
    // the pen drifts past the 8 px movement budget.
    await page.waitForTimeout(700);

    // Release the pen so any later test code (or the surrounding
    // workspace) sees a clean pointer state.
    await dispatchPointer(page, ".konvajs-content canvas", "pointerup", {
      pointerId: 1,
      pointerType: "pen",
      clientX: cx,
      clientY: cy,
    });

    await expect(page.getByTestId("snap-hud")).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------
  // 2. Palm rejection — fat finger touch does not re-anchor the marquee
  //    while a pen is in contact.
  // -------------------------------------------------------------------
  test("palm-touch pointerdown does not re-anchor the SELECT marquee while a pen is in contact", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await devLogin(page, "ADMIN");

    const suffix = Date.now();
    const projectRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/projects`,
      {
        data: {
          name: `PW Touch Palm ${suffix}`,
          clientName: "PW Touch Palm Client",
          status: "PLANNING",
        },
      },
    );
    expect(projectRes.status()).toBe(201);
    const project = (await projectRes.json()) as ProjectResponse;

    const PDF_LABEL = "Palm-rejection E2E";
    const upload = await uploadFixturePdf(page, {
      baseUrl: BASE_URL,
      label: PDF_LABEL,
    });
    const docRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/documents`,
      {
        data: {
          projectId: project.id,
          type: "PLANS",
          title: `PW Palm Plan ${suffix}`,
          fileName: `pw-palm-${suffix}.pdf`,
          fileUrl: upload.objectKey,
          mimeType: "application/pdf",
        },
      },
    );
    expect(docRes.status()).toBe(201);
    const doc = (await docRes.json()) as PlanDocumentResponse;

    // One small HIGHLIGHT in the upper-left so the layer has at least
    // one shape and the cache is populated. The gesture under test
    // happens in empty stage area — the markup is just here to make
    // the layer indistinguishable from the production seeded state.
    const markupRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/plan-documents/${doc.id}/markups`,
      {
        data: {
          pageNumber: 1,
          tool: "HIGHLIGHT",
          points: [
            { x: 0.05, y: 0.05 },
            { x: 0.10, y: 0.10 },
          ],
          color: "#3b82f6",
          thickness: 2,
        },
      },
    );
    expect(markupRes.status()).toBe(201);
    await markupRes.json() as MarkupResponse;

    // Stub the PDF stream so the layer renders deterministically.
    const pdfBuf = await getMinimalPdf(PDF_LABEL);
    await page.route(
      /\/api\/projects\/[^/]+\/documents\/[^/]+\/stream$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: { "Cache-Control": "no-cache" },
          body: pdfBuf,
        });
      },
    );

    await page.goto(
      `${BASE_URL}/projects/${project.code}?tab=plans&documentId=${doc.id}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("unified-plan-toolbar")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("plan-markup-layer")).toBeVisible({
      timeout: 30_000,
    });
    const stageCanvas = page
      .locator('[data-testid="pdf-preview-overlay"] .konvajs-content canvas')
      .first();
    await stageCanvas.waitFor({ state: "visible", timeout: 30_000 });

    // Engage SELECT mode so empty-stage pointerdown arms the marquee.
    await page.getByTestId("button-markup-tool-select").click();

    const overlayBox = await page
      .getByTestId("pdf-preview-overlay")
      .boundingBox();
    expect(overlayBox).not.toBeNull();
    const { x: ox, y: oy, width: ow, height: oh } = overlayBox!;

    // Pen anchor: middle of the overlay (clearly empty stage).
    const penX = ox + ow * 0.5;
    const penY = oy + oh * 0.5;
    // Palm anchor: a clearly different location so a re-anchor would
    // shift the marquee far enough to be unmistakable in the assertion.
    const palmX = ox + ow * 0.8;
    const palmY = oy + oh * 0.8;

    // Pen pointerdown arms the marquee at (penX, penY). The Konva stage
    // listener lives on `.konvajs-content`'s parent div; pointer events
    // bubble to it from the canvas.
    await dispatchPointer(
      page,
      '[data-testid="pdf-preview-overlay"] .konvajs-content canvas',
      "pointerdown",
      {
        pointerId: 1,
        pointerType: "pen",
        clientX: penX,
        clientY: penY,
        width: 1,
        height: 1,
      },
    );

    // Drag the pen a few pixels so the marquee rectangle has a visible
    // (non-zero) size — Playwright's `toBeVisible` filters out 0×0
    // elements, which is what an unmoved pen-down marquee starts as.
    await dispatchPointer(
      page,
      '[data-testid="pdf-preview-overlay"] .konvajs-content canvas',
      "pointermove",
      {
        pointerId: 1,
        pointerType: "pen",
        clientX: penX + 12,
        clientY: penY + 12,
        width: 1,
        height: 1,
      },
    );

    // The marquee div renders as soon as the SELECT branch sets
    // `marquee` state. Wait for it to materialise so we can read the
    // pen-anchored position. We use `toHaveCount(1)` rather than
    // `toBeVisible` so the assertion is robust whether the React
    // commit lands before or after the pointermove fattens the rect.
    const marquee = page.getByTestId("markup-marquee");
    await expect(marquee).toHaveCount(1, { timeout: 5_000 });
    const penLeft = await marquee.evaluate(
      (el) => Number.parseFloat((el as HTMLElement).style.left || "0"),
    );

    // Palm pointerdown — width/height clearly above the default 24 px
    // palm-rejection band. Without rejection, this would re-anchor the
    // marquee at (palmX, palmY).
    await dispatchPointer(
      page,
      '[data-testid="pdf-preview-overlay"] .konvajs-content canvas',
      "pointerdown",
      {
        pointerId: 2,
        pointerType: "touch",
        clientX: palmX,
        clientY: palmY,
        width: 80,
        height: 80,
      },
    );

    // Give React a beat to flush. If palm rejection is broken the
    // marquee state will have already been re-anchored synchronously
    // inside the pointerdown handler.
    await page.waitForTimeout(150);

    const afterPalmLeft = await marquee.evaluate(
      (el) => Number.parseFloat((el as HTMLElement).style.left || "0"),
    );
    expect(afterPalmLeft).toBe(penLeft);

    // Release both pointers so the workspace returns to a clean state.
    await dispatchPointer(
      page,
      '[data-testid="pdf-preview-overlay"] .konvajs-content canvas',
      "pointerup",
      {
        pointerId: 2,
        pointerType: "touch",
        clientX: palmX,
        clientY: palmY,
        width: 80,
        height: 80,
      },
    );
    await dispatchPointer(
      page,
      '[data-testid="pdf-preview-overlay"] .konvajs-content canvas',
      "pointerup",
      {
        pointerId: 1,
        pointerType: "pen",
        clientX: penX,
        clientY: penY,
      },
    );
  });

  // -------------------------------------------------------------------
  // 3. Two-finger rotate advances sheetRotation by 90° per quarter turn
  // -------------------------------------------------------------------
  test("two-finger rotate gesture advances sheetRotation by 90° per quarter turn when the pref is on", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await devLogin(page, "ADMIN");

    // Enable the per-user "Allow two-finger rotate" preference.
    // Without this the gesture is intentionally a no-op so accidental
    // pinch rotations don't spin the sheet.
    const prefRes = await authedRequest(
      page,
      "PATCH",
      `${BASE_URL}/api/user-settings`,
      { data: { allowTwoFingerRotate: true } },
    );
    expect(prefRes.status()).toBe(200);

    const fixtureRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/dev/seed-takeoff-fixture`,
      { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
    );
    expect(fixtureRes.status()).toBe(200);
    const fixture = (await fixtureRes.json()) as {
      bid: BidResponse;
      sheetIds: string[];
    };
    const sheetId = fixture.sheetIds[0];

    // Confirm the seeded sheet starts at rotation 0 so the assertion
    // really proves the gesture moved it.
    const initialSheets = await page.request.get(
      `${BASE_URL}/api/bids/${fixture.bid.id}/takeoff/sheets`,
    );
    expect(initialSheets.status()).toBe(200);
    const initialRows = (await initialSheets.json()) as TakeoffSheet[];
    const initialRotation =
      initialRows.find((s) => s.id === sheetId)?.rotation ?? 0;
    expect(initialRotation).toBe(0);

    await page.goto(`${BASE_URL}/bids/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.evaluate(
      ({ key, value }) => {
        sessionStorage.setItem(key, value);
      },
      {
        key: `takeoff-sheet-${fixture.bid.id}`,
        value: sheetId,
      },
    );

    await page.goto(`${BASE_URL}/takeoff/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 30_000,
    });
    const canvas = page.locator(".konvajs-content canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 30_000 });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    // 200 px between the two touches so the angle delta is large
    // enough to clear floating-point noise — the production code reads
    // `Math.atan2(t2.y - t1.y, t2.x - t1.x)` and accumulates deltas.
    const radius = 200;

    // Frame 1: baseline (no rotation accumulated). Touches lie on the
    // horizontal axis through the pinch center: angle = 0.
    await dispatchTouch(page, ".konvajs-content canvas", "touchstart", [
      { identifier: 1, clientX: cx - radius, clientY: cy },
      { identifier: 2, clientX: cx + radius, clientY: cy },
    ]);
    // The hook only does its rotate accumulator on `touchmove` (it
    // needs a `lastPinchAngleRef` baseline first), so we send the same
    // baseline as a touchmove to seed the angle reference.
    await dispatchTouch(page, ".konvajs-content canvas", "touchmove", [
      { identifier: 1, clientX: cx - radius, clientY: cy },
      { identifier: 2, clientX: cx + radius, clientY: cy },
    ]);

    // Frame 2: rotate the touch axis 90° counter-clockwise. atan2 goes
    // from 0 → π/2, so the cumulative delta crosses one quarter turn
    // and the hook fires `onRotateCW` exactly once. (The signed delta
    // is positive because clientY grows downward in screen space, so
    // the canvas-frame rotation is interpreted as CW.)
    await dispatchTouch(page, ".konvajs-content canvas", "touchmove", [
      { identifier: 1, clientX: cx, clientY: cy - radius },
      { identifier: 2, clientX: cx, clientY: cy + radius },
    ]);

    // Release both touches so the workspace state is clean.
    await dispatchTouch(page, ".konvajs-content canvas", "touchend", [
      { identifier: 1, clientX: cx, clientY: cy - radius },
      { identifier: 2, clientX: cx, clientY: cy + radius },
    ]);

    // The rotate handler fires `handleRotate` synchronously on the
    // gesture, which sets `localRotation` (immediate) and dispatches
    // `PATCH /api/takeoff/sheets/:id/rotation`. Poll the persisted
    // rotation rather than reading the DOM — the canvas transform is
    // hard to inspect from Playwright and the persisted value is the
    // canonical signal that the gesture took effect end-to-end.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(
            `${BASE_URL}/api/bids/${fixture.bid.id}/takeoff/sheets`,
          );
          if (r.status() !== 200) return null;
          const rows = (await r.json()) as TakeoffSheet[];
          return rows.find((s) => s.id === sheetId)?.rotation ?? null;
        },
        {
          message: "expected sheet rotation to advance to 90 after one quarter turn",
          timeout: 10_000,
        },
      )
      .toBe(90);
  });

  // -------------------------------------------------------------------
  // 4. Two-finger rotate gating — when the per-user toggle is OFF the
  //    same gesture must be a complete no-op (Task #2221).
  //
  //    The runbook calls this out as a hard contract because rotating
  //    the sheet while a user is actually mid-pinch-to-zoom would
  //    silently corrupt their measurements. The gate already had unit
  //    coverage in `pointerInput.test.ts`, but only an end-to-end check
  //    can prove the consumer (TakeoffWorkspace + use-takeoff-
  //    interactions) honors the preference value coming from
  //    `useTakeoffStylusPrefs` against the real DOM tree.
  // -------------------------------------------------------------------
  test("two-finger rotate gesture is a no-op when the rotate toggle is off", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await devLogin(page, "ADMIN");

    // Defensively clear the toggle in case a previous test (notably the
    // sibling rotate-on case above) left it enabled on the shared
    // ADMIN account that `devLogin` hands back.
    const prefRes = await authedRequest(
      page,
      "PATCH",
      `${BASE_URL}/api/user-settings`,
      { data: { allowTwoFingerRotate: false } },
    );
    expect(prefRes.status()).toBe(200);

    const fixtureRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/dev/seed-takeoff-fixture`,
      { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
    );
    expect(fixtureRes.status()).toBe(200);
    const fixture = (await fixtureRes.json()) as {
      bid: BidResponse;
      sheetIds: string[];
    };
    const sheetId = fixture.sheetIds[0];

    const initialSheets = await page.request.get(
      `${BASE_URL}/api/bids/${fixture.bid.id}/takeoff/sheets`,
    );
    expect(initialSheets.status()).toBe(200);
    const initialRows = (await initialSheets.json()) as TakeoffSheet[];
    expect(initialRows.find((s) => s.id === sheetId)?.rotation ?? 0).toBe(0);

    await page.goto(`${BASE_URL}/bids/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.evaluate(
      ({ key, value }) => {
        sessionStorage.setItem(key, value);
      },
      {
        key: `takeoff-sheet-${fixture.bid.id}`,
        value: sheetId,
      },
    );

    // Capture every PATCH issued against the rotation endpoint while
    // the test runs. With the toggle off there should be zero — that
    // is the canonical signal the consumer respected the preference.
    const rotationPatches: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "PATCH" &&
        /\/api\/takeoff\/sheets\/[^/]+\/rotation$/.test(req.url())
      ) {
        rotationPatches.push(req.url());
      }
    });

    await page.goto(`${BASE_URL}/takeoff/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 30_000,
    });
    const canvas = page.locator(".konvajs-content canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 30_000 });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Use the shared rotate-gesture helper so the dispatch sequence
    // stays in lockstep with the rotate-on test above. Same magnitude
    // (π/2 = one quarter turn) so any consumer-side regression would
    // be just as visible here as in test 3 — only the toggle differs.
    await synthesizeTwoFingerRotate(page, ".konvajs-content canvas", {
      centerX: cx,
      centerY: cy,
      radius: 200,
      angleRadians: Math.PI / 2,
    });

    // Hold the assertion window open long enough for any debounced
    // PATCH or async rotation update to land. The rotate-on case
    // typically settles within ~1 s; 1.5 s gives us margin without
    // bloating the suite.
    await page.waitForTimeout(1500);

    // No rotation PATCH should have fired.
    expect(rotationPatches).toEqual([]);

    // And the persisted rotation must still be the original 0.
    const finalSheets = await page.request.get(
      `${BASE_URL}/api/bids/${fixture.bid.id}/takeoff/sheets`,
    );
    expect(finalSheets.status()).toBe(200);
    const finalRows = (await finalSheets.json()) as TakeoffSheet[];
    expect(finalRows.find((s) => s.id === sheetId)?.rotation ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------
  // 5. Narrow-viewport ribbon — when the workspace mounts at <768 px
  //    the low-priority groups (snap / constrain / view / verify) must
  //    start collapsed so the ribbon stays one comfortable row of
  //    primary tools (select / measure / annotate). Mirrors Test 4 of
  //    the hardware QA runbook (Task #2221).
  //
  //    The contract lives in `NARROW_DEFAULT_COLLAPSED_GROUPS` inside
  //    `UnifiedTakeoffRibbon.tsx`, gated by a `matchMedia` listener on
  //    `(max-width: 767px)`. jsdom can't fake `matchMedia` against the
  //    real Vite-bundled hook tree, so we drive a Chromium page with
  //    a narrow viewport and read the rendered `data-collapsed`
  //    attribute on each `ribbon-group-*` section.
  // -------------------------------------------------------------------
  test("narrow viewport collapses snap/constrain/view/verify and keeps select/measure/annotate expanded", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Hand-tuned narrow viewport: phone-landscape / tablet-half-screen.
    // Anything strictly below 768 px will trigger the collapse rule.
    await page.setViewportSize({ width: 600, height: 900 });

    await devLogin(page, "ADMIN");

    // Wipe any persisted ribbon collapse state from previous test runs
    // on this shared ADMIN account so the assertion measures the
    // narrow-viewport *default* — not whatever a teammate (or earlier
    // test) might have left in localStorage. The key shape comes from
    // `ribbonGroupsStorageKey` in
    // `client/src/components/takeoff/hosts/takeoff-shortcuts.ts`.
    const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
    expect(meRes.status()).toBe(200);
    const userId = ((await meRes.json()) as { user: { id: string } })
      .user.id;

    const fixtureRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/dev/seed-takeoff-fixture`,
      { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
    );
    expect(fixtureRes.status()).toBe(200);
    const fixture = (await fixtureRes.json()) as {
      bid: BidResponse;
      sheetIds: string[];
    };

    await page.goto(`${BASE_URL}/bids/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.evaluate(
      ({ ribbonKey, sheetKey, sheetValue }) => {
        localStorage.removeItem(ribbonKey);
        sessionStorage.setItem(sheetKey, sheetValue);
      },
      {
        ribbonKey: `takeoff-ribbon-groups-${userId}`,
        sheetKey: `takeoff-sheet-${fixture.bid.id}`,
        sheetValue: fixture.sheetIds[0],
      },
    );

    await page.goto(`${BASE_URL}/takeoff/${fixture.bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 30_000,
    });
    // Sanity: the ribbon should report it sees a narrow viewport. The
    // attribute is set from the `useIsNarrowViewport` matchMedia hook
    // — if this fails it means matchMedia did not pick up the
    // setViewportSize change, which would invalidate every collapse
    // assertion below.
    await expect(page.getByTestId("unified-takeoff-ribbon")).toHaveAttribute(
      "data-narrow",
      "true",
    );

    // Primary groups remain expanded.
    for (const id of ["select", "measure", "annotate"] as const) {
      await expect(page.getByTestId(`ribbon-group-${id}`)).toHaveAttribute(
        "data-collapsed",
        "false",
      );
      await expect(
        page.getByTestId(`ribbon-group-tools-${id}`),
      ).toBeVisible();
    }

    // Low-priority groups start collapsed. The collapsed branch removes
    // the `ribbon-group-tools-*` div from the DOM entirely (see
    // `{!isCollapsed && (...)}` in UnifiedTakeoffRibbon.tsx), so we
    // assert both the marker attribute *and* the absence of the tools
    // container — either alone could regress without the other.
    for (const id of ["snap", "constrain", "view", "verify"] as const) {
      await expect(page.getByTestId(`ribbon-group-${id}`)).toHaveAttribute(
        "data-collapsed",
        "true",
      );
      await expect(
        page.getByTestId(`ribbon-group-tools-${id}`),
      ).toHaveCount(0);
    }
  });
});
