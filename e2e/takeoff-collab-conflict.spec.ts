import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

/**
 * Task #2651 — Two-browser end-to-end test for live takeoff
 * collaboration & conflicts.
 *
 * Exercises Task #2629 (optimistic-concurrency on measurement edits +
 * the "Edit conflict" toast in `client/src/hooks/use-takeoff-data.tsx`)
 * and the presence/cursor WebSocket layer added by Task #2579
 * (`server/takeoffCollaboration.ts`).
 *
 * Two browser contexts (User A = ADMIN, User B = ESTIMATOR) join the
 * same bid takeoff workspace and:
 *   1. Each sees the other's presence avatar
 *      (`avatar-collaborator-${userId}` rendered by
 *      `client/src/components/takeoff/hosts/CollabHost.tsx`).
 *   2. Mouse-moving the Konva stage on User A's page drives the real
 *      `collab.sendCursorMove` code path; User B's React state should
 *      then expose a `collab-cursor-${userIdA}` DOM mirror (the
 *      hidden testability node added alongside the Konva cursor
 *      markers in `CanvasStage.tsx`). This asserts the
 *      client-consumed cursor state — not just inbound socket
 *      traffic — so a regression in the reducer / host layer would
 *      fail the test.
 *   3. Both users race the same measurement: User A bumps the row
 *      via a silent API PATCH (server version: 1 → 2). User B then
 *      saves an inline edit through the sidebar — its mutation echoes
 *      its cached `expectedVersion: 1`, so the server returns 409
 *      `version_conflict`, the React mutation surfaces the
 *      "Edit conflict" toast, and the measurements query invalidates
 *      so the canvas re-renders the server's truth.
 */

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DevLoginResponse {
  user: { id: string; email: string; firstName: string | null; lastName: string | null };
}

interface BidResponse { id: string; code: string }
interface SheetResponse { id: string; sheetName: string | null }
interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  version: number;
  metadata: string | null;
}

async function devLogin(page: Page, role: string): Promise<DevLoginResponse> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status(), `dev-login as ${role} failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as DevLoginResponse;
}

test.describe("Takeoff live collaboration & conflict — two browsers", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("presence avatars + real cursor render + 409 conflict toast across two sessions", async ({
    browser,
  }) => {
    const suffix = Date.now();

    // --- User A (ADMIN) — author of the bid + the seed measurement ---
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await installCsrf(pageA);
    const userA = await devLogin(pageA, "ADMIN");

    const bidRes = await pageA.request.post(`${BASE_URL}/api/bids`, {
      data: {
        name: `Collab Conflict Bid ${suffix}`,
        clientName: "Collab Conflict Client",
        bidAmount: "100000",
      },
    });
    expect(bidRes.status()).toBe(201);
    const bid = (await bidRes.json()) as BidResponse;

    const planRes = await pageA.request.post(
      `${BASE_URL}/api/bids/${bid.id}/takeoff/plans`,
      {
        data: {
          fileUrl: "https://example.com/collab-conflict-plan.pdf",
          fileName: "Collab Conflict Sheet",
        },
      },
    );
    expect(planRes.status()).toBe(201);
    const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
    const sheetId = planBody.sheets[0].id;

    // Calibrate so subsequent measurements compute cleanly.
    const calibRes = await pageA.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
      { data: { scalePxPerFoot: 10.0, units: "ft" } },
    );
    expect(calibRes.status()).toBe(200);

    const mRes = await pageA.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "LINEAR",
          label: "Race Wall",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ]),
        },
      },
    );
    expect(mRes.status()).toBe(201);
    const measurement = (await mRes.json()) as MeasurementResponse;
    expect(measurement.version).toBe(1);

    // --- User B (ESTIMATOR) — second seat, same Dev Sandbox org ---
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await installCsrf(pageB);
    const userB = await devLogin(pageB, "ESTIMATOR");
    expect(userB.user.id).not.toBe(userA.user.id);

    // --- Both navigate to the takeoff workspace and pre-pick the sheet ---
    const seedSheetSelection = async (page: Page) => {
      // First nav primes sessionStorage; the second (post-seed) reload
      // mounts the workspace with the Konva Stage already on-screen.
      await page.goto(`${BASE_URL}/takeoff/${bid.code}`, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ({ key, value }) => sessionStorage.setItem(key, value),
        { key: `takeoff-sheet-${bid.id}`, value: sheetId },
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator(".konvajs-content canvas")
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      // Wait for the cursor-mirror anchor to be in the tree — this is
      // only rendered once CanvasStage has mounted with the collab hook
      // wired in, so it's a reliable ready-signal for the assertions
      // that follow.
      await page.getByTestId("collab-cursors-root").waitFor({ state: "attached", timeout: 15_000 });
    };

    await seedSheetSelection(pageA);
    await seedSheetSelection(pageB);

    // --- 1. Each user sees the other's presence avatar ---
    await expect(pageA.getByTestId(`avatar-collaborator-${userB.user.id}`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(pageB.getByTestId(`avatar-collaborator-${userA.user.id}`)).toBeVisible({
      timeout: 20_000,
    });

    // --- 2. Cursor flows through real client code path ---
    // Drive the Konva stage's onMouseMove on User A's page with a real
    // mouse move; that is what calls `collab.sendCursorMove`. Then
    // assert User B's CanvasStage rendered a `collab-cursor-${A}` DOM
    // mirror, which means the inbound CURSOR_MOVE was consumed by the
    // collab hook and surfaced into `collab.visibleCursors` — i.e. the
    // cursor would actually be drawn by Konva for the user.
    const canvasA = pageA.locator(".konvajs-content canvas").first();
    const canvasB = pageB.locator(".konvajs-content canvas").first();
    const boxA = await canvasA.boundingBox();
    expect(boxA, "User A's Konva canvas must have a bounding box").not.toBeNull();
    const cursorMirrorB = pageB.getByTestId(`collab-cursor-${userA.user.id}`);

    // The throttle in `sendCursorMove` is 50ms; nudge a few times to
    // guarantee at least one frame escapes the throttle window AND
    // arrives after User B's WS is fully attached as a peer.
    for (let i = 0; i < 6; i++) {
      await pageA.mouse.move(
        boxA!.x + 200 + i * 35,
        boxA!.y + 200 + i * 25,
        { steps: 4 },
      );
      // small breath between moves so the throttle releases
      // eslint-disable-next-line no-await-in-loop
      await pageA.waitForTimeout(120);
      // eslint-disable-next-line no-await-in-loop
      if (await cursorMirrorB.count()) break;
    }
    await expect(cursorMirrorB).toBeAttached({ timeout: 10_000 });

    // The mirror's data attributes carry the canvas-space coords from
    // collab.visibleCursors — assert that they are populated to numeric
    // values (not just an empty placeholder), proving the payload made
    // it from socket → reducer → render state intact.
    const cursorX = await cursorMirrorB.getAttribute("data-cursor-x");
    const cursorY = await cursorMirrorB.getAttribute("data-cursor-y");
    expect(cursorX, "User B's cursor mirror must carry an x coord from User A").toMatch(/^-?\d+$/);
    expect(cursorY, "User B's cursor mirror must carry a y coord from User A").toMatch(/^-?\d+$/);

    // Sanity-check: User B's canvas is still on screen and the mirror
    // is co-located with the Konva stage that would render the cursor.
    await expect(canvasB).toBeVisible();

    // --- 3. Race the same measurement and assert the 409 conflict UI ---
    // User A bumps the row server-side (no expectedVersion → legacy
    // last-write-wins, version 1 → 2) via a silent API PATCH. The
    // server takeoff-collaboration WS does NOT broadcast measurement
    // mutations issued through the REST API (only client-side
    // `MEASUREMENT_UPDATED` socket frames are fanned out — see
    // follow-up #2655), so User B's React Query cache stays at v1 —
    // exactly the precondition the optimistic-concurrency path is
    // designed to detect.
    const aPatch = await pageA.request.patch(
      `${BASE_URL}/api/takeoff/measurements/${measurement.id}`,
      { data: { label: "Race Wall (A wins)" } },
    );
    expect(aPatch.status()).toBe(200);
    const afterA = (await aPatch.json()) as MeasurementResponse;
    expect(afterA.version).toBe(2);

    // Wait for User B's sidebar row to be present (the row is only
    // rendered after the measurements query resolves).
    const measurementItem = pageB.getByTestId(`measurement-item-${measurement.id}`);
    await measurementItem.waitFor({ state: "visible", timeout: 20_000 });

    // Open the inline editor on User B's measurement card and save a
    // conflicting label.
    await measurementItem.scrollIntoViewIfNeeded();
    await measurementItem.click();
    await measurementItem.locator("span.font-medium.truncate").first().dblclick();

    const labelInput = pageB.getByTestId(`input-inline-edit-label-${measurement.id}`);
    await labelInput.waitFor({ state: "visible", timeout: 10_000 });
    await labelInput.fill("Race Wall (B tries)");
    await pageB.getByTestId(`button-inline-save-${measurement.id}`).click();

    // The losing user sees the "Edit conflict" toast.
    await expect(pageB.getByText("Edit conflict")).toBeVisible({ timeout: 15_000 });
    await expect(
      pageB.getByText(
        "Another teammate updated this measurement while you were editing. Pick whose version to keep.",
      ),
    ).toBeVisible({ timeout: 5_000 });

    // The canvas refreshes to the server's truth: the measurements
    // query was invalidated by the 409 onError handler, so a re-read
    // from the same authenticated context returns User A's label and
    // version=2.
    await expect
      .poll(
        async () => {
          const r = await pageB.request.get(
            `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`,
          );
          if (r.status() !== 200) return null;
          const list = (await r.json()) as MeasurementResponse[];
          const row = list.find((m) => m.id === measurement.id);
          return row ? { label: row.label, version: row.version } : null;
        },
        {
          message:
            "User B's measurements view should reflect User A's accepted edit (label + version)",
          timeout: 10_000,
        },
      )
      .toEqual({ label: "Race Wall (A wins)", version: 2 });

    // The sidebar text node also re-renders to the server's truth as
    // React Query refills the cache after invalidation.
    await expect
      .poll(
        async () => measurementItem.locator("span.font-medium.truncate").first().textContent(),
        { message: "sidebar label re-renders to server's truth", timeout: 10_000 },
      )
      .toBe("Race Wall (A wins)");

    await ctxA.close();
    await ctxB.close();
  });
});
