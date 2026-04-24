/**
 * Task #1883 — End-to-end coverage for the bulk-delete + Undo + Redo
 * round trip through the actual takeoff canvas.
 *
 * The server side of this flow is already locked down by
 * `server/__tests__/takeoff-workflow/takeoff-markups-restore-bulk.test.ts`
 * (Task #1860): it asserts that POST `/api/takeoff/markups/restore-bulk`
 * preserves original ids / authorship / sheet, and that a
 * delete → restore → delete redo cycle on the SAME id list works in one
 * round-trip. The hook side is covered by unit tests around
 * `useTakeoffHistory` (`MARKUP_DELETE_BATCH` push / undo / redo).
 *
 * What neither layer can prove is the user-visible canvas wiring:
 *
 *   1. The TakeoffWorkspace `keydown` effect (Task #1861) routes a
 *      Delete/Backspace press to `bulkDeleteMarkupsMutation`, whose
 *      `onSuccess` snapshots `previousMarkups` from the React-Query
 *      cache and pushes a single `MARKUP_DELETE_BATCH` history entry
 *      via `takeoffHistory.pushMarkupDeleteBatchAction`. A regression
 *      that drops the snapshot capture or pushes per-id `MARKUP_DELETE`
 *      entries (the pre-Task-#1860 shape) would silently ship — neither
 *      the server integration test nor the hook unit tests would notice.
 *   2. The `use-takeoff-interactions` window keydown handler routes
 *      Cmd/Ctrl+Z to `takeoffHistory.undo()`. The Undo branch of
 *      `MARKUP_DELETE_BATCH` reconstructs the restore-bulk payload
 *      from the captured snapshot — so if the snapshot is missing
 *      `organizationId` / `createdBy` / `tool` / `points` / `color` /
 *      `thickness` / `text` / `categoryId` the server would reject the
 *      restore at the validation layer and the markups would never
 *      reappear. Asserting both the original ids AND the original
 *      `createdBy` on the refetched list is what catches a regression
 *      that drops authorship from the snapshot.
 *   3. The same window keydown handler routes Cmd+Shift+Z (and Ctrl+Y)
 *      to `takeoffHistory.redo()`. The Redo branch of
 *      `MARKUP_DELETE_BATCH` re-issues the bulk DELETE against the same
 *      id list. A regression in the redo branch (e.g. accidentally
 *      sending the raw history entry instead of `{ ids }`) would let
 *      the bulk DELETE silently no-op.
 *
 * The seed flow (REST-API-created markups, sheet pre-selected via
 * sessionStorage, bid-plans Joyride suppressed via localStorage) is
 * intentionally identical to the sibling specs
 * (`takeoff-markup-keyboard-delete.spec.ts`,
 * `takeoff-markup-history-wiring.spec.ts`) so future refactors of the
 * workspace bootstrap only have one mental model to maintain.
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
  // The sheet-list endpoint includes `createdBy` on every row — the
  // server-side restore-bulk integration test
  // (`takeoff-markups-restore-bulk.test.ts`) asserts the field is
  // preserved across delete → restore, so we type and assert it here
  // too. A regression that drops authorship from the snapshot or from
  // the restore payload would surface as a `createdBy` mismatch on the
  // refetched list rather than a silent passthrough.
  createdBy: string;
  tool: string;
  text?: string | null;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
}

async function devLogin(page: Page, role: string) {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function listMarkups(
  page: Page,
  sheetId: string,
): Promise<MarkupResponse[]> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/markups`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as MarkupResponse[];
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
  // takeoff-markup specs and the shared `clickOnCanvas` helper.
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
  // `mouse.click({ modifiers })` overlay is not enough. Mirrors the
  // sibling keyboard-delete spec.
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

// HIGHLIGHT renders as a filled Rect (opacity 0.35) in the
// MarkupRenderer, so a click anywhere inside its bbox reliably hits
// the body — same shape choice as
// `takeoff-markup-keyboard-delete.spec.ts` and
// `takeoff-markup-history-wiring.spec.ts`.
const POINTS_A = [
  { x: 240, y: 220 },
  { x: 380, y: 320 },
];
const CENTROID_A = {
  x: (POINTS_A[0].x + POINTS_A[1].x) / 2,
  y: (POINTS_A[0].y + POINTS_A[1].y) / 2,
};
const POINTS_B = [
  { x: 480, y: 220 },
  { x: 620, y: 320 },
];
const CENTROID_B = {
  x: (POINTS_B[0].x + POINTS_B[1].x) / 2,
  y: (POINTS_B[0].y + POINTS_B[1].y) / 2,
};
const POINTS_C = [
  { x: 720, y: 220 },
  { x: 860, y: 320 },
];
const CENTROID_C = {
  x: (POINTS_C[0].x + POINTS_C[1].x) / 2,
  y: (POINTS_C[0].y + POINTS_C[1].y) / 2,
};

interface SeededWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
  markupA: MarkupResponse;
  markupB: MarkupResponse;
  markupC: MarkupResponse;
  authorId: string;
}

async function seedThreeMarkups(
  page: Page,
  suffix: number,
): Promise<SeededWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Markup Bulk-Delete-Undo Bid ${suffix}`,
      clientName: "PW Markup Bulk-Delete-Undo Client",
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
        fileUrl: "https://example.com/markup-bulk-delete-undo-plan.pdf",
        fileName: "Markup Bulk Delete Undo Sheet",
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  const sheetId = planBody.sheets[0].id;

  // Three HIGHLIGHT markups: we'll multi-select the first two for the
  // bulk-delete + Undo round trip and leave the third untouched as a
  // negative control. If the restore-bulk payload ever stops scoping
  // its inserts to the originally-deleted ids, the third markup would
  // end up duplicated or perturbed — asserting it's unchanged after
  // every step catches that.
  const markupA = await createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points: POINTS_A,
    color: "#3b82f6",
    thickness: 2,
  });
  const markupB = await createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points: POINTS_B,
    color: "#10b981",
    thickness: 2,
  });
  const markupC = await createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points: POINTS_C,
    color: "#f59e0b",
    thickness: 2,
  });

  // Confirm authorship up front. The point of the Undo assertion is
  // that the *original* `createdBy` survives the restore — capturing
  // the value here (as opposed to refetching after delete) gives us a
  // ground truth that's independent of the very flow under test.
  expect(markupA.createdBy).toBeTruthy();
  expect(markupB.createdBy).toBeTruthy();
  expect(markupA.createdBy).toBe(markupB.createdBy);
  const authorId = markupA.createdBy;

  // Suppress the Joyride bid-plans tour so it doesn't overlay the
  // canvas on first load (mirrors `seedTwoMarkups` in the sibling
  // keyboard-delete spec). The tour modal would block both the click
  // (selection) and the keyboard (delete/undo/redo) paths.
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;

  await page.goto(`${BASE_URL}/bids/${bidCode}`);
  await page.evaluate(
    ({ sheetKey, sheetVal, tourKey }) => {
      sessionStorage.setItem(sheetKey, sheetVal);
      localStorage.setItem(tourKey, "1");
    },
    {
      sheetKey: `takeoff-sheet-${bidId}`,
      sheetVal: sheetId,
      tourKey: `bid-plans-tour-completed-${userId}`,
    },
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  await page
    .locator(".konvajs-content canvas")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  return { bidId, bidCode, sheetId, markupA, markupB, markupC, authorId };
}

async function multiSelectAandB(page: Page) {
  // Click A → Shift+click B; the panel header flipping to "Edit 2
  // markups" is the canonical signal that selectedMarkupIds.size === 2.
  // Same gesture as the sibling keyboard-delete spec.
  await clickOnCanvas(page, CENTROID_A);
  await page
    .getByTestId("panel-markup-properties")
    .waitFor({ state: "visible", timeout: 10_000 });
  await shiftClickOnCanvas(page, CENTROID_B);
  await expect(page.getByTestId("text-markup-edit-header")).toHaveText(
    "Edit 2 markups",
    { timeout: 10_000 },
  );
}

async function waitForMarkupsGone(
  page: Page,
  sheetId: string,
  ids: string[],
  message: string,
) {
  await expect
    .poll(
      async () => {
        const list = await listMarkups(page, sheetId);
        return ids.every((id) => !list.some((m) => m.id === id));
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
}

async function waitForMarkupsPresent(
  page: Page,
  sheetId: string,
  ids: string[],
  message: string,
) {
  await expect
    .poll(
      async () => {
        const list = await listMarkups(page, sheetId);
        return ids.every((id) => list.some((m) => m.id === id));
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
}

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff markup bulk-delete + Undo + Redo - Task #1883", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test(
    "Backspace bulk-deletes, Cmd+Z restores ids+authorship, Cmd+Shift+Z re-deletes",
    async ({ page }) => {
      test.setTimeout(60_000);
      await devLogin(page, "ADMIN");
      const { sheetId, markupA, markupB, markupC, authorId } =
        await seedThreeMarkups(page, Date.now());

      // Sanity: the seed actually landed on the server with the
      // expected three rows. Asserting the pre-state explicitly makes
      // a "selection didn't take effect" failure later in the test
      // debuggable from the failure message alone.
      {
        const before = await listMarkups(page, sheetId);
        expect(before.find((m) => m.id === markupA.id)).toBeTruthy();
        expect(before.find((m) => m.id === markupB.id)).toBeTruthy();
        expect(before.find((m) => m.id === markupC.id)).toBeTruthy();
      }

      await multiSelectAandB(page);

      // ----- Step 1: Backspace bulk-deletes A + B -----
      // The TakeoffWorkspace keydown effect (Task #1861) routes
      // Backspace to `bulkDeleteMarkupsMutation`. After the mutation
      // resolves the panel state is cleared (`setMarkupEditDraft(null)`,
      // `setSelectedMarkupIds(new Set())`) so focus naturally returns
      // to the document body — a precondition for the Cmd+Z handler
      // in `use-takeoff-interactions` to fire on the next press.
      await page.keyboard.press("Backspace");

      await waitForMarkupsGone(
        page,
        sheetId,
        [markupA.id, markupB.id],
        "expected Backspace to bulk-delete both selected markups",
      );

      // Negative control: markup C was never selected, so it must
      // still be present after the bulk DELETE lands.
      {
        const afterDelete = await listMarkups(page, sheetId);
        expect(afterDelete.find((m) => m.id === markupC.id)).toBeTruthy();
        expect(afterDelete).toHaveLength(1);
      }

      // The properties panel disappears once the selection is cleared.
      // Waiting for it to go away is also the canonical signal that
      // the post-mutation cleanup ran (and therefore that the keyboard
      // delete path actually awaited the mutation, rather than firing
      // and forgetting). It also confirms focus is no longer trapped
      // inside the panel's inputs, which would block the Cmd+Z key
      // path in `use-takeoff-interactions`.
      await expect(page.getByTestId("panel-markup-properties")).toBeHidden({
        timeout: 10_000,
      });

      // ----- Step 2: Cmd/Ctrl+Z restores both markups -----
      // The `use-takeoff-interactions` window keydown handler routes
      // Cmd/Ctrl+Z to `takeoffHistory.undo()`, which finds the
      // `MARKUP_DELETE_BATCH` entry pushed by the bulk-delete mutation
      // and POSTs `/api/takeoff/markups/restore-bulk` with the captured
      // snapshot. The server re-inserts the rows with their ORIGINAL
      // ids and `createdBy` (verified server-side by Task #1860).
      // `ControlOrMeta+z` resolves to Meta on macOS and Control
      // elsewhere — we run on Linux in CI but the modifier-agnostic
      // form keeps local-dev runs on macOS happy too.
      await page.keyboard.press("ControlOrMeta+z");

      await waitForMarkupsPresent(
        page,
        sheetId,
        [markupA.id, markupB.id],
        "expected Cmd+Z (Undo) to restore both bulk-deleted markups",
      );

      // The hard contract from Task #1860: the restored rows carry
      // the SAME ids AND the SAME `createdBy` as the originals. If
      // the snapshot dropped `createdBy` (or the restore endpoint
      // started attributing rows to the requesting user instead of
      // preserving authorship), this assertion is the canary. We
      // also assert geometry/style passthrough so a regression that
      // restores rows but loses field data shows up here rather than
      // as a silent UI mismatch.
      {
        const restored = await listMarkups(page, sheetId);
        const restoredA = restored.find((m) => m.id === markupA.id);
        const restoredB = restored.find((m) => m.id === markupB.id);
        expect(restoredA).toBeTruthy();
        expect(restoredB).toBeTruthy();
        expect(restoredA!.createdBy).toBe(authorId);
        expect(restoredB!.createdBy).toBe(authorId);
        expect(restoredA!.tool).toBe("HIGHLIGHT");
        expect(restoredB!.tool).toBe("HIGHLIGHT");
        expect(restoredA!.color).toBe("#3b82f6");
        expect(restoredB!.color).toBe("#10b981");
        expect(restoredA!.points).toEqual(POINTS_A);
        expect(restoredB!.points).toEqual(POINTS_B);
        // Negative control still untouched.
        const stillC = restored.find((m) => m.id === markupC.id);
        expect(stillC).toBeTruthy();
        expect(stillC!.createdBy).toBe(authorId);
        expect(restored).toHaveLength(3);
      }

      // ----- Step 3: Cmd+Shift+Z re-deletes both markups -----
      // The same window keydown handler routes Cmd+Shift+Z (and
      // Ctrl+Y) to `takeoffHistory.redo()`. The Redo branch of
      // `MARKUP_DELETE_BATCH` re-issues the original bulk DELETE
      // against the same id list (Task #1860 server test confirms the
      // ids round-trip), so the canvas should match the post-Step-1
      // state.
      await page.keyboard.press("ControlOrMeta+Shift+z");

      await waitForMarkupsGone(
        page,
        sheetId,
        [markupA.id, markupB.id],
        "expected Cmd+Shift+Z (Redo) to re-delete both restored markups",
      );

      // Final state must match Step 1: only markup C survives.
      // Asserting the row count too (rather than just "A and B are
      // missing") catches a regression where the redo bulk DELETE
      // accidentally targets the wrong ids and removes C instead.
      {
        const afterRedo = await listMarkups(page, sheetId);
        expect(afterRedo.find((m) => m.id === markupA.id)).toBeFalsy();
        expect(afterRedo.find((m) => m.id === markupB.id)).toBeFalsy();
        const stillC = afterRedo.find((m) => m.id === markupC.id);
        expect(stillC).toBeTruthy();
        expect(stillC!.createdBy).toBe(authorId);
        expect(afterRedo).toHaveLength(1);
      }
    },
  );
});
