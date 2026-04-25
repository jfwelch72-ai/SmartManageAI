/**
 * Task #1922 — End-to-end coverage for the destructive bulk-delete
 * "Undo" toast on both takeoff layers (measurements and markups).
 *
 * Sister specs already cover adjacent slices of this flow:
 *   - `takeoff-markup-bulk-delete-undo.spec.ts` (Task #1883) walks the
 *     KEYBOARD path on the markup layer (Backspace → Cmd+Z → Cmd+Shift+Z)
 *     so the canvas wiring of the *history* round trip is locked down.
 *   - `client/src/hooks/__tests__/use-takeoff-data-bulk-delete-undo-toast.test.tsx`
 *     (Task #1882) and its measurement sibling
 *     `use-takeoff-data-bulk-delete-measurements-undo-toast.test.tsx`
 *     (Task #1901) lock down the toast contract at the hook level —
 *     destructive variant, "Deleted N …" title, ToastAction with the
 *     correct `data-testid`, single batch history push, etc.
 *
 * What neither layer can prove is the user-visible BUTTON path: the
 * gesture from "click Delete All / Delete N markups in the workspace"
 * → "see the destructive toast in the viewport" → "click Undo on the
 * toast" → "the rows reappear on the canvas". The wiring under test
 * spans `TakeoffWorkspace.tsx` (the batch action bar at line ~5004
 * for measurements, the multi-edit panel at line ~5481 for markups),
 * the bulk mutations in `use-takeoff-data.tsx`
 * (`bulkDeleteMeasurementsMutation` / `bulkDeleteMarkupsMutation`),
 * the `Toaster` viewport that re-renders on the `useToast` store, and
 * the `takeoffHistory.undo()` call the ToastAction `onClick` invokes
 * — none of which the unit tests cover together.
 *
 * Test 3 covers the dismiss-on-sheet-change branch from
 * `use-takeoff-data.tsx` (the `useEffect` keyed on `selectedSheet`
 * around line 100-111): switching sheets via the sheet-picker dropdown
 * must tear down the lingering toast so the user can't click Undo from
 * the wrong canvas context.
 *
 * The seed pattern (REST-API-created rows, sheet pre-selected via
 * sessionStorage, bid-plans Joyride suppressed via localStorage)
 * intentionally mirrors the sibling takeoff specs so the workspace
 * bootstrap is the same shape across the e2e fleet.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface SheetResponse {
  id: string;
  sheetName: string | null;
  bidId: string | null;
}

interface MarkupResponse {
  id: string;
  sheetId: string;
  createdBy: string;
  tool: string;
  text?: string | null;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
}

interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  points: string | { x: number; y: number }[];
}

async function devLogin(page: Page, role: string) {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function listMarkups(page: Page, sheetId: string): Promise<MarkupResponse[]> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/markups`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as MarkupResponse[];
}

async function listMeasurements(
  page: Page,
  sheetId: string,
): Promise<MeasurementResponse[]> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as MeasurementResponse[];
}

async function createMarkupApi(
  page: Page,
  body: {
    sheetId: string;
    tool: string;
    points: { x: number; y: number }[];
    color: string;
    thickness: number;
  },
): Promise<MarkupResponse> {
  const res = await page.request.post(`${BASE_URL}/api/takeoff/markups`, {
    data: body,
  });
  if (res.status() !== 201) {
    throw new Error(
      `Markup create failed (${res.status()}): ${await res.text()}`,
    );
  }
  return (await res.json()) as MarkupResponse;
}

async function createMeasurementApi(
  page: Page,
  body: {
    sheetId: string;
    type: string;
    label: string;
    points: { x: number; y: number }[];
    color?: string;
  },
): Promise<MeasurementResponse> {
  const res = await page.request.post(`${BASE_URL}/api/takeoff/measurements`, {
    data: body,
  });
  if (res.status() !== 201) {
    throw new Error(
      `Measurement create failed (${res.status()}): ${await res.text()}`,
    );
  }
  return (await res.json()) as MeasurementResponse;
}

async function getCanvasBox(page: Page) {
  const canvas = page.locator(".konvajs-content canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Konva canvas has no bounding box");
  return box;
}

async function clickOnCanvas(page: Page, point: { x: number; y: number }) {
  // Two `mouse.move()` calls so WebKit reliably dispatches the initial
  // mousemove before the click sequence — same shape as the sibling
  // takeoff-markup specs.
  const box = await getCanvasBox(page);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
}

async function shiftClickOnCanvas(
  page: Page,
  point: { x: number; y: number },
) {
  // Konva's click handler reads `window.event.shiftKey` (Task #1736),
  // so the modifier must be physically held — the synthetic
  // `mouse.click({ modifiers })` overlay is not enough.
  const box = await getCanvasBox(page);
  await page.keyboard.down("Shift");
  try {
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Shift");
  }
}

async function suppressBidPlansTour(
  page: Page,
  bidId: string,
  sheetId: string,
  opts: { collapseSidebar?: boolean } = { collapseSidebar: true },
) {
  // Mirror the sibling specs: pre-set sessionStorage so the workspace
  // mounts with the seeded sheet active, and pre-set the
  // bid-plans-tour-completed flag so the Joyride overlay doesn't block
  // canvas / button clicks. The tour modal would otherwise eat both
  // the multi-select gesture (Ctrl+A / shift-click) and the toast Undo
  // click that this spec is here to exercise.
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;
  await page.evaluate(
    ({ sheetKey, sheetVal, tourKey, collapseSidebar }) => {
      sessionStorage.setItem(sheetKey, sheetVal);
      localStorage.setItem(tourKey, "1");
      // The right-side TakeoffSidebar mounts `absolute right-0 w-[360px]`
      // over the workspace and *visually overlaps* the BatchActionBar's
      // "Delete All" button (justify-between → button is on the right
      // edge of the bar). Playwright will then route the click to the
      // sidebar instead of the button under test, which is exactly the
      // failure surfaced by the first run of this spec. For tests that
      // exercise the measurement BatchActionBar (which lives in the
      // central canvas area) we collapse the sidebar so the button is
      // unobstructed. For the markup test we DO need the sidebar
      // expanded — `button-delete-markups-bulk` lives inside it — so
      // callers can opt out of the collapse via `collapseSidebar:false`.
      if (collapseSidebar) {
        localStorage.setItem("takeoff-sidebar-collapsed", "true");
      } else {
        localStorage.removeItem("takeoff-sidebar-collapsed");
      }
    },
    {
      sheetKey: `takeoff-sheet-${bidId}`,
      sheetVal: sheetId,
      tourKey: `bid-plans-tour-completed-${userId}`,
      collapseSidebar: opts.collapseSidebar !== false,
    },
  );
}

interface SeededMeasurementWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
  measurements: MeasurementResponse[];
}

async function seedThreeMeasurements(
  page: Page,
  suffix: number,
): Promise<SeededMeasurementWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Measurement Bulk-Delete-Undo-Toast Bid ${suffix}`,
      clientName: "PW Measurement Bulk-Delete-Undo-Toast Client",
      bidAmount: "50000",
    },
  });
  expect(bidRes.status()).toBe(201);
  const bid = await bidRes.json();
  const bidId: string = bid.id;
  const bidCode: string = bid.code;

  const planRes = await page.request.post(
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl: "https://example.com/measurement-bulk-delete-undo-toast-plan.pdf",
        fileName: "Measurement Bulk Delete Undo Toast Sheet",
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  const sheetId = planBody.sheets[0].id;

  // Three COUNT measurements: simple type, no scale required, single
  // point each. The bulk-delete + Undo round trip is tool-agnostic so
  // COUNT is the lowest-overhead choice.
  const measurementA = await createMeasurementApi(page, {
    sheetId,
    type: "COUNT",
    label: "PW Meas A",
    points: [{ x: 240, y: 220 }],
    color: "#3b82f6",
  });
  const measurementB = await createMeasurementApi(page, {
    sheetId,
    type: "COUNT",
    label: "PW Meas B",
    points: [{ x: 480, y: 220 }],
    color: "#10b981",
  });
  const measurementC = await createMeasurementApi(page, {
    sheetId,
    type: "COUNT",
    label: "PW Meas C",
    points: [{ x: 720, y: 220 }],
    color: "#f59e0b",
  });

  await page.goto(`${BASE_URL}/bids/${bidCode}`);
  await suppressBidPlansTour(page, bidId, sheetId);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator(".konvajs-content canvas")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  return {
    bidId,
    bidCode,
    sheetId,
    measurements: [measurementA, measurementB, measurementC],
  };
}

interface SeededMarkupWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
  markupA: MarkupResponse;
  markupB: MarkupResponse;
  authorId: string;
}

const MARKUP_POINTS_A = [
  { x: 240, y: 220 },
  { x: 380, y: 320 },
];
const MARKUP_CENTROID_A = {
  x: (MARKUP_POINTS_A[0].x + MARKUP_POINTS_A[1].x) / 2,
  y: (MARKUP_POINTS_A[0].y + MARKUP_POINTS_A[1].y) / 2,
};
const MARKUP_POINTS_B = [
  { x: 480, y: 220 },
  { x: 620, y: 320 },
];
const MARKUP_CENTROID_B = {
  x: (MARKUP_POINTS_B[0].x + MARKUP_POINTS_B[1].x) / 2,
  y: (MARKUP_POINTS_B[0].y + MARKUP_POINTS_B[1].y) / 2,
};

async function seedTwoMarkups(
  page: Page,
  suffix: number,
): Promise<SeededMarkupWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Markup Bulk-Delete-Undo-Toast Bid ${suffix}`,
      clientName: "PW Markup Bulk-Delete-Undo-Toast Client",
      bidAmount: "50000",
    },
  });
  expect(bidRes.status()).toBe(201);
  const bid = await bidRes.json();
  const bidId: string = bid.id;
  const bidCode: string = bid.code;

  const planRes = await page.request.post(
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl: "https://example.com/markup-bulk-delete-undo-toast-plan.pdf",
        fileName: "Markup Bulk Delete Undo Toast Sheet",
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  const sheetId = planBody.sheets[0].id;

  const markupA = await createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points: MARKUP_POINTS_A,
    color: "#3b82f6",
    thickness: 2,
  });
  const markupB = await createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points: MARKUP_POINTS_B,
    color: "#10b981",
    thickness: 2,
  });
  expect(markupA.createdBy).toBeTruthy();
  expect(markupA.createdBy).toBe(markupB.createdBy);

  await page.goto(`${BASE_URL}/bids/${bidCode}`);
  // Markup test needs the right-side TakeoffSidebar EXPANDED so the
  // markup multi-edit panel (and `button-delete-markups-bulk` inside
  // it) is reachable. The sidebar lives `absolute right-0 w-[360px]`
  // — in the measurement tests we collapse it to clear the
  // BatchActionBar; here we leave it open.
  await suppressBidPlansTour(page, bidId, sheetId, { collapseSidebar: false });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator(".konvajs-content canvas")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  return {
    bidId,
    bidCode,
    sheetId,
    markupA,
    markupB,
    authorId: markupA.createdBy,
  };
}

async function waitForMeasurementsCount(
  page: Page,
  sheetId: string,
  expected: number,
  message: string,
) {
  await expect
    .poll(async () => (await listMeasurements(page, sheetId)).length, {
      message,
      timeout: 15_000,
    })
    .toBe(expected);
}

async function waitForMarkupsCount(
  page: Page,
  sheetId: string,
  expected: number,
  message: string,
) {
  await expect
    .poll(async () => (await listMarkups(page, sheetId)).length, {
      message,
      timeout: 15_000,
    })
    .toBe(expected);
}

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff bulk-delete Undo TOAST gesture - Task #1922", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test(
    "Measurements: Delete All in batch action bar surfaces toast, Undo restores rows",
    async ({ page }) => {
      test.setTimeout(60_000);
      await devLogin(page, "ADMIN");
      const { sheetId, measurements } = await seedThreeMeasurements(
        page,
        Date.now(),
      );

      // Sanity: the seed actually landed on the server. Asserting the
      // pre-state explicitly makes a "selection didn't take effect"
      // failure later in the test debuggable from the message alone.
      {
        const before = await listMeasurements(page, sheetId);
        expect(before).toHaveLength(3);
        for (const m of measurements) {
          expect(before.find((row) => row.id === m.id)).toBeTruthy();
        }
      }

      // Bring focus into the workspace by clicking the Konva canvas.
      // `use-takeoff-interactions.ts` listens for Ctrl/Cmd+A on the
      // window and gates it behind `canUseNavigationShortcuts` (no
      // active portal / iframe). A fresh page sometimes leaves focus
      // on a portal element from the dev-login flow, so the click
      // explicitly returns focus to the canvas before we send the
      // shortcut.
      await clickOnCanvas(page, { x: 50, y: 50 });

      // Ctrl/Cmd+A is the canonical gesture for "select all
      // measurements" (use-takeoff-interactions.ts line ~999). It
      // populates `selectedMeasurementIds` with the full set and the
      // batch action bar (TakeoffWorkspace.tsx line ~5004) becomes
      // visible the moment the size goes above 1.
      await page.keyboard.press("ControlOrMeta+a");

      const batchBar = page.getByTestId("batch-action-bar");
      await expect(batchBar).toBeVisible({ timeout: 10_000 });
      await expect(batchBar).toContainText("3 measurements selected");

      // The bottom-of-canvas status bar reflects what's actually
      // rendered on the canvas — it reads `measurements.length` from
      // the same query that drives the Konva measurement layer.
      // Capturing the pre-state UI count here lets the post-Undo
      // assertion below prove the UI/canvas re-render — not just the
      // REST list — returns to 3, which is the rendering wiring this
      // task is here to lock down.
      const canvasStatusBar = page
        .locator('[data-testid="takeoff-status-bar"]')
        .filter({ hasText: /\d+ measurement/ });
      await expect(canvasStatusBar).toContainText("3 measurements");

      // ----- Step 1: Click "Delete All" -----
      // Routes through `bulkDeleteMeasurementsMutation` whose
      // `onSuccess` (use-takeoff-data.tsx line ~510) invalidates the
      // measurements cache, pushes one MEASUREMENT_DELETE_BATCH
      // history entry, then surfaces the destructive toast with the
      // Undo action. Asserting on the toast title rather than waiting
      // on the API list-empty state is what locks down the BUTTON →
      // TOAST wiring (the unit tests already prove the toast call
      // shape; this proves it actually reaches the viewport).
      await page.getByTestId("button-batch-delete").click();

      const toastTitle = page.getByText("Deleted 3 measurements", {
        exact: true,
      });
      await expect(toastTitle).toBeVisible({ timeout: 10_000 });
      const undoButton = page.getByTestId(
        "button-toast-undo-bulk-delete-measurements",
      );
      await expect(undoButton).toBeVisible({ timeout: 5_000 });

      // The destructive variant matters — it is the visual signal to
      // the user that the action was destructive and Undo is the
      // recovery path. The hook unit test
      // (`use-takeoff-data-bulk-delete-measurements-undo-toast.test.tsx`)
      // already asserts `variant: "destructive"` on the toast call;
      // here we assert the rendered DOM carries the matching class so
      // the contract holds end-to-end through `Toaster`.
      const toastRoot = page.locator('[role="status"], li').filter({
        has: toastTitle,
      });
      await expect(toastRoot.first()).toHaveClass(/destructive/);

      // The bulk DELETE round trip should have removed all 3 rows
      // server-side. We poll because the per-id DELETE fan-out
      // (`Promise.all` in `bulkDeleteMeasurementsMutation` —
      // measurements has no `/bulk` DELETE endpoint, unlike markups)
      // resolves slightly after the toast appears.
      await waitForMeasurementsCount(
        page,
        sheetId,
        0,
        "expected bulk Delete All to remove every seeded measurement",
      );

      // ----- Step 2: Click the toast Undo button -----
      // The Undo `onClick` clears the toast ref and calls
      // `takeoffHistory.undo()`, which replays the
      // MEASUREMENT_DELETE_BATCH entry by re-POSTing each measurement.
      // Because the measurements API has no `/restore-bulk` endpoint
      // (unlike markups) the restore fans out N parallel POSTs — but
      // from the user's perspective the canvas just snaps back.
      await undoButton.click();

      await waitForMeasurementsCount(
        page,
        sheetId,
        3,
        "expected toast Undo to restore every bulk-deleted measurement",
      );

      // ----- Step 3: Prove the canvas/UI re-rendered, not just the API -----
      // The whole point of this spec is that the BUTTON → TOAST →
      // UNDO loop re-renders the workspace, not just that the REST
      // list refills. The canvas status bar reads measurement count
      // directly from the same query that drives the Konva
      // measurement layer, so its text returning to "3 measurements"
      // is a direct signal that the post-restore React Query
      // invalidation reached the canvas tree.
      await expect(canvasStatusBar).toContainText("3 measurements", {
        timeout: 10_000,
      });

      // Re-running the Ctrl+A select-all gesture and re-asserting the
      // BatchActionBar reports 3 selected proves the restored rows
      // are also INTERACTIVE on the canvas — not just visible. A
      // regression that restored rows to the cache but left them
      // un-selectable (e.g. wrong sheet, dropped from
      // selection-eligible set) would surface here.
      await clickOnCanvas(page, { x: 50, y: 50 });
      await page.keyboard.press("ControlOrMeta+a");
      await expect(batchBar).toContainText("3 measurements selected", {
        timeout: 10_000,
      });

      // Sheet scoping: every restored row must still belong to the
      // same sheet (no accidental cross-sheet writes from the restore
      // path). Asserting only the count would let a regression that
      // restored to the wrong sheet slip past — asserting the sheetId
      // pins the contract.
      {
        const restored = await listMeasurements(page, sheetId);
        expect(restored).toHaveLength(3);
        for (const m of restored) {
          expect(m.sheetId).toBe(sheetId);
        }
      }
    },
  );

  test(
    "Markups: Delete N markups in panel surfaces toast, Undo restores rows with original ids + author",
    async ({ page }) => {
      test.setTimeout(60_000);
      await devLogin(page, "ADMIN");
      const { sheetId, markupA, markupB, authorId } = await seedTwoMarkups(
        page,
        Date.now(),
      );

      // Multi-select via canvas click + shift-click — the same shape
      // the sibling markup specs use. The properties panel header
      // flipping to "Edit 2 markups" is the canonical signal that
      // selectedMarkupIds.size === 2.
      await clickOnCanvas(page, MARKUP_CENTROID_A);
      await page
        .getByTestId("panel-markup-properties")
        .waitFor({ state: "visible", timeout: 10_000 });
      await shiftClickOnCanvas(page, MARKUP_CENTROID_B);
      await expect(page.getByTestId("text-markup-edit-header")).toHaveText(
        "Edit 2 markups",
        { timeout: 10_000 },
      );

      // ----- Step 1: Click "Delete 2 markups" in the panel -----
      // Routes through `bulkDeleteMarkupsMutation` (single
      // `/api/takeoff/markups/bulk` round trip — Task #1832). The
      // onSuccess handler (use-takeoff-data.tsx line ~996) pushes one
      // MARKUP_DELETE_BATCH entry with full snapshots and surfaces
      // the destructive toast with the Undo action.
      await page.getByTestId("button-delete-markups-bulk").click();

      const toastTitle = page.getByText("Deleted 2 markups", { exact: true });
      await expect(toastTitle).toBeVisible({ timeout: 10_000 });
      const undoButton = page.getByTestId(
        "button-toast-undo-bulk-delete-markups",
      );
      await expect(undoButton).toBeVisible({ timeout: 5_000 });

      await waitForMarkupsCount(
        page,
        sheetId,
        0,
        "expected bulk delete to remove both markups server-side",
      );

      // ----- Step 2: Click the toast Undo -----
      // The Undo path POSTs `/api/takeoff/markups/restore-bulk` with
      // the full snapshot (Task #1860 server test confirms ids and
      // authorship round-trip). Asserting the restored rows carry the
      // ORIGINAL ids + ORIGINAL `createdBy` is the canary: a
      // regression that drops authorship from the snapshot or
      // reattributes restored rows to the requesting user would
      // surface as a `createdBy` mismatch here.
      await undoButton.click();

      await waitForMarkupsCount(
        page,
        sheetId,
        2,
        "expected toast Undo to restore both bulk-deleted markups",
      );

      const restored = await listMarkups(page, sheetId);
      const restoredA = restored.find((m) => m.id === markupA.id);
      const restoredB = restored.find((m) => m.id === markupB.id);
      expect(restoredA).toBeTruthy();
      expect(restoredB).toBeTruthy();
      expect(restoredA!.createdBy).toBe(authorId);
      expect(restoredB!.createdBy).toBe(authorId);
      expect(restoredA!.tool).toBe("HIGHLIGHT");
      expect(restoredB!.tool).toBe("HIGHLIGHT");

      // ----- Step 3: Prove the canvas re-rendered, not just the API -----
      // Re-running the same multi-select gesture on the SAME canvas
      // pixels and watching the multi-edit panel header flip back to
      // "Edit 2 markups" proves both restored markups were actually
      // re-rendered onto the Konva layer at their original positions
      // and are hit-testable. A regression that restored rows to the
      // cache but failed to round-trip the Konva re-render (or
      // restored them to the wrong coordinates / wrong sheet) would
      // miss the click and leave the header at "Markup details"
      // instead of "Edit 2 markups".
      await clickOnCanvas(page, MARKUP_CENTROID_A);
      await page
        .getByTestId("panel-markup-properties")
        .waitFor({ state: "visible", timeout: 10_000 });
      await shiftClickOnCanvas(page, MARKUP_CENTROID_B);
      await expect(page.getByTestId("text-markup-edit-header")).toHaveText(
        "Edit 2 markups",
        { timeout: 10_000 },
      );
    },
  );

  test(
    "Switching sheets dismisses the lingering bulk-delete toast (measurement layer)",
    async ({ page }) => {
      test.setTimeout(60_000);
      await devLogin(page, "ADMIN");

      // Seed a bid with TWO independent plan sheets (one POST per
      // plan). The dismiss-on-sheet-change branch is keyed on
      // `selectedSheet`, so we need two real sheets we can flip
      // between via the workspace's sheet-picker dropdown.
      const suffix = Date.now();
      const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
        data: {
          name: `PW Sheet-Change Toast-Dismiss Bid ${suffix}`,
          clientName: "PW Sheet-Change Toast-Dismiss Client",
          bidAmount: "50000",
        },
      });
      expect(bidRes.status()).toBe(201);
      const bid = await bidRes.json();
      const bidId: string = bid.id;
      const bidCode: string = bid.code;

      const plan1Res = await page.request.post(
        `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
        {
          data: {
            fileUrl: "https://example.com/sheet-change-toast-plan-1.pdf",
            fileName: "Sheet-Change Toast Plan 1",
          },
        },
      );
      expect(plan1Res.status()).toBe(201);
      const plan1Body = (await plan1Res.json()) as { sheets: SheetResponse[] };
      const sheet1Id = plan1Body.sheets[0].id;

      const plan2Res = await page.request.post(
        `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
        {
          data: {
            fileUrl: "https://example.com/sheet-change-toast-plan-2.pdf",
            fileName: "Sheet-Change Toast Plan 2",
          },
        },
      );
      expect(plan2Res.status()).toBe(201);
      const plan2Body = (await plan2Res.json()) as { sheets: SheetResponse[] };
      const sheet2Id = plan2Body.sheets[0].id;
      expect(sheet2Id).not.toBe(sheet1Id);

      // Two measurements on sheet 1 — bulk delete needs at least one
      // row to surface the toast. We use 2 so the toast title pluralises
      // correctly ("Deleted 2 measurements"), matching the assertion
      // shape from Test 1.
      await createMeasurementApi(page, {
        sheetId: sheet1Id,
        type: "COUNT",
        label: "PW Sheet-Change Meas A",
        points: [{ x: 240, y: 220 }],
        color: "#3b82f6",
      });
      await createMeasurementApi(page, {
        sheetId: sheet1Id,
        type: "COUNT",
        label: "PW Sheet-Change Meas B",
        points: [{ x: 480, y: 220 }],
        color: "#10b981",
      });

      await page.goto(`${BASE_URL}/bids/${bidCode}`);
      await suppressBidPlansTour(page, bidId, sheet1Id);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await page
        .locator(".konvajs-content canvas")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

      // Trigger the bulk delete + toast on sheet 1.
      await clickOnCanvas(page, { x: 50, y: 50 });
      await page.keyboard.press("ControlOrMeta+a");
      const batchBar = page.getByTestId("batch-action-bar");
      await expect(batchBar).toBeVisible({ timeout: 10_000 });
      await expect(batchBar).toContainText("2 measurements selected");
      await page.getByTestId("button-batch-delete").click();

      const undoButton = page.getByTestId(
        "button-toast-undo-bulk-delete-measurements",
      );
      await expect(undoButton).toBeVisible({ timeout: 10_000 });

      // ----- Switch sheets via the picker dropdown -----
      // The `selectedSheet` change fires the dismiss-on-sheet-change
      // useEffect in `use-takeoff-data.tsx` (line ~100): it inspects
      // the tracked `bulkDeleteMeasurementsToastRef` and dismisses it
      // because the toast's recorded `sheetId` no longer matches the
      // active sheet. Asserting the Undo button leaves the DOM (and
      // does so within the toast's natural close window — well under
      // the 8s `duration`) is what locks down the dismiss path
      // *specifically* via sheet change rather than via auto-dismiss.
      await page.getByTestId("select-sheet").click();
      // Radix renders the SelectContent inside a portal; the items
      // themselves are role="option". Clicking by accessible name is
      // the most stable selector since the SelectItem doesn't expose
      // its own data-testid here.
      await page
        .getByRole("option", { name: /Sheet-Change Toast Plan 2/ })
        .click();

      await expect(undoButton).toBeHidden({ timeout: 5_000 });
    },
  );
});
