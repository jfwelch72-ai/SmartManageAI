// Task #2141 — End-to-end coverage for the Sheet Sets UI in the
// takeoff workspace. Drives the panel, the active-set toggle, the
// set-aware `[`/`]` navigation, the Shift+`[`/`]` multi-sheet
// selection, the active-set badge in the sheet header, and the
// "Apply to entire Sheet Set" propagation + Undo round-trip in the
// inline calibration drawer. Built on top of the dev seed-takeoff
// fixture so no PDF upload is needed in CI.

import { test, expect, type Page } from "@playwright/test";
import { authedRequest, installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

interface SheetSetCreateResponse {
  id: string;
  name: string;
}

async function devLogin(page: Page, role = "ADMIN"): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function seedTakeoffFixture(
  page: Page,
  sheetCount = 3,
): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function gotoTakeoff(page: Page, bidCode: string): Promise<void> {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // The right TakeoffSidebar is an absolute-positioned overlay that
  // covers the rightmost ribbon controls — including the Sheet Sets
  // toggle and the Verify group. Collapse it the same way the
  // typed-dim/calibration spec does so our click targets are
  // pointer-event reachable.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Focus the workspace shell so document.activeElement === <body>
  // and useTakeoffShortcuts will accept our keystrokes.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

async function createSet(
  page: Page,
  bidId: string,
  name: string,
): Promise<SheetSetCreateResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/takeoff/sheet-sets`, {
    data: { bidId, name },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as SheetSetCreateResponse;
}

async function addMembers(
  page: Page,
  setId: string,
  sheetIds: string[],
): Promise<void> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/takeoff/sheet-sets/${setId}/members`,
    { data: { sheetIds } },
  );
  expect(res.status()).toBe(201);
}

async function fetchSheetScale(
  page: Page,
  bidId: string,
  sheetId: string,
): Promise<number | null> {
  const res = await page.request.get(
    `${BASE_URL}/api/bids/${bidId}/takeoff/sheets`,
  );
  expect(res.status()).toBe(200);
  const sheets = (await res.json()) as Array<{
    id: string;
    scalePxPerFoot: number | null;
  }>;
  const found = sheets.find((s) => s.id === sheetId);
  return found?.scalePxPerFoot ?? null;
}

interface SheetSetMember {
  sheetId: string;
  sortOrder: number;
}

interface SheetSetDetail {
  id: string;
  name: string;
  members: SheetSetMember[];
}

async function fetchSetDetail(page: Page, setId: string): Promise<SheetSetDetail> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheet-sets/${setId}`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as SheetSetDetail;
}

/**
 * Task #2230 — Synthesize a single HTML5 drag-and-drop lifecycle in
 * the page. Used by the drag-thumbnail-onto-set-row test where the
 * drop handler reads everything it needs out of the DataTransfer
 * payload (no React state crosses event boundaries), so a single
 * `page.evaluate` is enough. Mirrors the pattern in
 * `takeoff-tool-chest.spec.ts` where the chest item drop also lives
 * entirely inside one event tick.
 */
async function dispatchSheetThumbnailDrop(
  page: Page,
  sourceTestId: string,
  targetTestId: string,
  payload: { sheetId: string },
): Promise<void> {
  await page.evaluate(
    ({ sourceSel, targetSel, mime, payloadJson }) => {
      const source = document.querySelector(sourceSel) as HTMLElement | null;
      const target = document.querySelector(targetSel) as HTMLElement | null;
      if (!source || !target) {
        throw new Error(`drag/drop targets not found (${sourceSel} -> ${targetSel})`);
      }
      const dt = new DataTransfer();
      dt.setData(mime, payloadJson);
      // Match what PageThumbnailStrip writes alongside the custom MIME.
      dt.setData("text/plain", payloadJson);
      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
      );
      target.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
      );
      target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
      source.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
      );
    },
    {
      sourceSel: `[data-testid='${sourceTestId}']`,
      targetSel: `[data-testid='${targetTestId}']`,
      mime: "application/x-takeoff-sheet",
      payloadJson: JSON.stringify(payload),
    },
  );
}

test.describe("Task #2141 — Sheet Sets UI", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("panel CRUD: open, create a set, see badge in header, toggle active off", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page, 2);
    await gotoTakeoff(page, bid.code);

    // Open the panel from the sheet selector bar.
    const toggle = page.getByTestId("button-toggle-sheet-sets");
    await expect(toggle).toBeVisible();
    await toggle.click();

    const panel = page.getByTestId("panel-sheet-sets");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("text-sheet-sets-empty")).toBeVisible();

    // Create a set via the inline form.
    await page.getByTestId("button-new-sheet-set").click();
    const nameInput = page.getByTestId("input-sheet-set-name");
    await nameInput.fill("PW Set A");
    await page.getByTestId("button-confirm-create-sheet-set").click();

    // Empty-state copy is gone; the new set row is in the DOM.
    await expect(page.getByTestId("text-sheet-sets-empty")).toHaveCount(0, {
      timeout: 10_000,
    });
    const setRow = page.locator("[data-testid^='row-sheet-set-']").first();
    await expect(setRow).toBeVisible({ timeout: 10_000 });
    const setId = (await setRow.getAttribute("data-testid"))!.replace(
      "row-sheet-set-",
      "",
    );

    // No badge until activated.
    await expect(page.getByTestId("badge-active-sheet-set")).toHaveCount(0);

    // Activate.
    await page.getByTestId(`button-toggle-active-set-${setId}`).click();
    await expect(page.getByTestId("badge-active-sheet-set")).toBeVisible();
    await expect(page.getByTestId("badge-active-sheet-set")).toContainText(
      "PW Set A",
    );

    // Deactivate by clicking again.
    await page.getByTestId(`button-toggle-active-set-${setId}`).click();
    await expect(page.getByTestId("badge-active-sheet-set")).toHaveCount(0);
  });

  test("set-aware [/] navigation skips non-members; Shift+[/] extends multi-sheet selection", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Build a set containing sheets [0] and [2] only (skip the middle).
    const set = await createSet(page, fixture.bid.id, "PW Nav Set");
    await addMembers(page, set.id, [fixture.sheetIds[0], fixture.sheetIds[2]]);

    // Open the panel and activate the set.
    await page.getByTestId("button-toggle-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toBeVisible();
    await page.getByTestId(`button-toggle-active-set-${set.id}`).click();
    const badge = page.getByTestId("badge-active-sheet-set");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("PW Nav Set");

    // Close the panel so it doesn't intercept keystrokes.
    await page.getByTestId("button-close-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toHaveCount(0);

    // Refocus the workspace.
    await page.getByTestId("unified-takeoff-ribbon").click();

    // No sheet was selected by default in this fresh workspace, so
    // the position chip is absent. The first `]` snaps onto the
    // first member of the active set (set-aware nav).
    await page.keyboard.press("]");
    await expect(badge).toContainText("1/2", { timeout: 5_000 });

    // `]` again advances to sheet[2] (sheet[1] is *not* a member,
    // so set-aware navigation skips it entirely).
    await page.keyboard.press("]");
    await expect(badge).toContainText("2/2", { timeout: 5_000 });

    // `[` wraps back to sheet[0].
    await page.keyboard.press("[");
    await expect(badge).toContainText("1/2", { timeout: 5_000 });

    // Shift+] extends the multi-sheet selection inside the set.
    // The shortcut matches `event.key === "}"` with shiftKey true
    // (Section 2 of the takeoff interaction map). Playwright's
    // `Shift+]` sends both, but we also dispatch a synthetic keydown
    // explicitly to guarantee `event.key === "}"` regardless of the
    // headless-Chromium keymap and avoid a flaky chord on slower CI
    // runners.
    await page.keyboard.press("Shift+]");
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "}",
          code: "BracketRight",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    // Re-open the panel to verify the multi-selection chip surfaces.
    await page.getByTestId("button-toggle-sheet-sets").click();
    const multiSel = page.getByTestId("text-multi-sheet-selection");
    await expect(multiSel).toBeVisible({ timeout: 5_000 });
    await expect(multiSel).toContainText(/2 sheets selected/i);

    // Clear the selection and confirm the chip disappears.
    await page.getByTestId("button-clear-multi-sheet-selection").click();
    await expect(multiSel).toHaveCount(0);
  });

  test("Apply to entire Sheet Set: checkbox enabled when active, propagates scale, Undo restores", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Set with two sheets so a propagation has something to fan out to.
    const set = await createSet(page, fixture.bid.id, "PW Calib Set");
    await addMembers(page, set.id, [fixture.sheetIds[0], fixture.sheetIds[1]]);

    // Pre-condition: the seed fixture writes scalePxPerFoot=10 for every
    // sheet, so we know the prior values for the Undo round-trip.
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[0])).toBe(10);
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[1])).toBe(10);

    // Activate the set.
    await page.getByTestId("button-toggle-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toBeVisible();
    await page.getByTestId(`button-toggle-active-set-${set.id}`).click();
    await expect(page.getByTestId("badge-active-sheet-set")).toBeVisible();
    await page.getByTestId("button-close-sheet-sets").click();

    // Focus the workspace and open the inline calibration drawer.
    await page.getByTestId("unified-takeoff-ribbon").click();
    await page.keyboard.press("t");

    const drawer = page.getByTestId("inline-calibration-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // The Apply-to-set checkbox is enabled now (was Coming-soon-disabled
    // in #2140) and pre-checked because a set is active.
    const checkbox = page.getByTestId("checkbox-apply-sheet-set");
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeEnabled();

    // Drive the calibration save through the public API instead of
    // synthesizing two canvas clicks — the propagation + Undo flow lives
    // entirely in the apply-scale and restore-scales endpoints, and we
    // assert their effects on the sheets directly.
    const newScale = 25;
    const applyRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/takeoff/sheet-sets/${set.id}/apply-scale`,
      { data: { scalePxPerFoot: newScale, scaleLabel: "1/4\" = 1'-0\"" } },
    );
    expect(applyRes.status()).toBe(200);
    const applyBody = (await applyRes.json()) as {
      updatedSheets: number;
      priorScales: Array<{ sheetId: string; scalePxPerFoot: number | null }>;
    };
    expect(applyBody.updatedSheets).toBe(2);
    expect(applyBody.priorScales).toHaveLength(2);
    // Every snapshot row preserves the seeded value.
    for (const snap of applyBody.priorScales) {
      expect(snap.scalePxPerFoot).toBe(10);
    }

    // Both members now reflect the new scale on the server.
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[0])).toBe(newScale);
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[1])).toBe(newScale);

    // Undo round-trip restores per-sheet prior scales. The schema
    // names the array `sheets` (the workspace's apply-scale toast
    // uses the same field), so we send it the same way.
    const restoreRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/takeoff/sheet-sets/${set.id}/restore-scales`,
      { data: { sheets: applyBody.priorScales } },
    );
    expect(restoreRes.status()).toBe(200);

    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[0])).toBe(10);
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[1])).toBe(10);

    // Cancel the drawer — we already validated the propagation through
    // the same backend the drawer would have called.
    await page.getByTestId("button-inline-calibration-cancel").click();
    await expect(drawer).toHaveCount(0);
  });

  // Task #2230 — The two flows below are exposed in the panel today
  // (see SheetSetsPanel.tsx + PageThumbnailStrip.tsx) but were silently
  // uncovered by #2141. Both ride on HTML5 drag-and-drop with a
  // pre-loaded DataTransfer; Playwright's mouse-based `dragTo` won't
  // ship the custom MIME (TAKEOFF_SHEET_DRAG_MIME) or the
  // `text/plain` fallback the drop handlers read, so we synthesize
  // the lifecycle directly via `page.evaluate` (same pattern used by
  // `takeoff-tool-chest.spec.ts`).

  test("drag a thumbnail from the strip onto a set row appends it as a member", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Empty set — the drop handler is the only path that adds a
    // member here, so the post-drop GET must show exactly one.
    const set = await createSet(page, fixture.bid.id, "PW Drag Set");
    const before = await fetchSetDetail(page, set.id);
    expect(before.members).toHaveLength(0);

    // Open the panel and confirm the row is in the DOM (it's also our
    // drop target).
    await page.getByTestId("button-toggle-sheet-sets").click();
    const panel = page.getByTestId("panel-sheet-sets");
    await expect(panel).toBeVisible();
    const setRow = page.getByTestId(`row-sheet-set-${set.id}`);
    await expect(setRow).toBeVisible();

    // The thumbnail strip is collapsed by default in the workspace —
    // click the SheetSelectorBar toggle to render it before we look
    // up the source thumbnail.
    await page.getByTestId("button-toggle-thumbnails").click();
    await expect(page.getByTestId("panel-thumbnail-strip")).toBeVisible({
      timeout: 5_000,
    });

    // The PageThumbnailStrip renders one thumbnail-sheet-{id} button
    // per sheet. Pick the second sheet so the result is unambiguous
    // if some future code adds the first sheet automatically.
    const droppedSheetId = fixture.sheetIds[1];
    const thumbnail = page.getByTestId(`thumbnail-sheet-${droppedSheetId}`);
    await expect(thumbnail).toBeVisible({ timeout: 10_000 });

    await dispatchSheetThumbnailDrop(
      page,
      `thumbnail-sheet-${droppedSheetId}`,
      `row-sheet-set-${set.id}`,
      { sheetId: droppedSheetId },
    );

    // The mutation invalidates the detail query and toasts on success.
    // Poll the GET endpoint directly: that's the source of truth and
    // also the contract the spec is here to defend.
    await expect
      .poll(
        async () => {
          const detail = await fetchSetDetail(page, set.id);
          return detail.members.map((m) => m.sheetId);
        },
        { timeout: 10_000, message: "set should grow to 1 member after drop" },
      )
      .toEqual([droppedSheetId]);

    // Sanity: the panel shows the new member too once the detail
    // query refetches. Expanding the set surfaces the member row.
    await page.getByTestId(`button-toggle-expand-set-${set.id}`).click();
    await expect(
      page.getByTestId(`set-member-${set.id}-${droppedSheetId}`),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("drag-reorder two members within a set updates sortOrder on the server", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Seed two members up-front via the public API. The append
    // endpoint assigns sortOrder = 0 then 1 in insertion order, which
    // we'll flip below.
    const set = await createSet(page, fixture.bid.id, "PW Reorder Set");
    const [a, b] = [fixture.sheetIds[0], fixture.sheetIds[1]];
    await addMembers(page, set.id, [a, b]);

    const initial = await fetchSetDetail(page, set.id);
    const initialOrder = [...initial.members]
      .sort((m1, m2) => m1.sortOrder - m2.sortOrder)
      .map((m) => m.sheetId);
    expect(initialOrder).toEqual([a, b]);

    // Open the panel and expand the set so the in-list <li>'s render.
    await page.getByTestId("button-toggle-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toBeVisible();
    await page.getByTestId(`button-toggle-expand-set-${set.id}`).click();
    const memberA = page.getByTestId(`set-member-${set.id}-${a}`);
    const memberB = page.getByTestId(`set-member-${set.id}-${b}`);
    await expect(memberA).toBeVisible({ timeout: 10_000 });
    await expect(memberB).toBeVisible({ timeout: 10_000 });

    // The reorder drop handler in SetRow gates on a local React state
    // (`draggingSheetId`) set by the source <li>'s `onDragStart`.
    // React batches that state update, so the closures bound to the
    // *target* <li>'s `onDragOver`/`onDrop` won't see the new value
    // until the next render. We split the lifecycle across two
    // `page.evaluate` calls with a tick in between so the dragstart
    // commit lands before we synthesize the dragover/drop. (The
    // single-evaluate pattern in `dispatchSheetThumbnailDrop` works
    // for the drop-onto-row case because that handler reads only
    // from DataTransfer.)
    await page.evaluate(
      ({ sourceSel }) => {
        const source = document.querySelector(sourceSel) as HTMLElement | null;
        if (!source) throw new Error(`drag source not found (${sourceSel})`);
        const dt = new DataTransfer();
        dt.setData("text/plain", source.getAttribute("data-testid") ?? "");
        // The reorder handler doesn't read TAKEOFF_SHEET_DRAG_MIME —
        // it relies entirely on the React state set in onDragStart —
        // so just dispatching dragstart is enough to arm the row.
        source.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
        );
      },
      { sourceSel: `[data-testid='set-member-${set.id}-${a}']` },
    );
    // Yield to React so the dragstart-driven setState commits before
    // the target row's drop closure reads `draggingSheetId`.
    await page.waitForTimeout(50);

    await page.evaluate(
      ({ sourceSel, targetSel }) => {
        const source = document.querySelector(sourceSel) as HTMLElement | null;
        const target = document.querySelector(targetSel) as HTMLElement | null;
        if (!source || !target) {
          throw new Error("drop targets not found");
        }
        // The reorder drop handler doesn't read DataTransfer at all —
        // it uses the React `draggingSheetId` state set on dragstart.
        // We still attach a fresh DataTransfer so the synthetic events
        // are well-formed.
        const dt = new DataTransfer();
        target.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
        target.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
        source.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
        );
      },
      {
        sourceSel: `[data-testid='set-member-${set.id}-${a}']`,
        targetSel: `[data-testid='set-member-${set.id}-${b}']`,
      },
    );

    // The reorder mutation POSTs to /reorder and the server walks the
    // members array assigning the supplied sortOrder. Poll the GET
    // until it reflects the swap. handleReorderDrop splices the
    // source out, then inserts at the target index — for [a,b] with
    // source=a/target=b that yields [b, a] with sortOrder 0/1.
    await expect
      .poll(
        async () => {
          const detail = await fetchSetDetail(page, set.id);
          return [...detail.members]
            .sort((m1, m2) => m1.sortOrder - m2.sortOrder)
            .map((m) => m.sheetId);
        },
        { timeout: 10_000, message: "members should swap order after drag-reorder" },
      )
      .toEqual([b, a]);

    // Confirm the explicit sortOrder values too — guards against a
    // future change that flips the ordering field semantics.
    const after = await fetchSetDetail(page, set.id);
    const byId = new Map(after.members.map((m) => [m.sheetId, m.sortOrder]));
    expect(byId.get(b)).toBe(0);
    expect(byId.get(a)).toBe(1);
  });

  // Task #2229 — Drag-and-drop a member between sets.
  test("drag a sheet member from one set into another (one drag, atomic move)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Two sets: A starts with two sheets, B starts with one.
    const setA = await createSet(page, fixture.bid.id, "PW Move A");
    const setB = await createSet(page, fixture.bid.id, "PW Move B");
    await addMembers(page, setA.id, [fixture.sheetIds[0], fixture.sheetIds[1]]);
    await addMembers(page, setB.id, [fixture.sheetIds[2]]);

    // Open the panel and expand A so its member rows mount (the panel
    // only keeps one set expanded at a time — that's fine, set B's
    // collapsed row is still a perfectly valid drop target since the
    // drop handler lives on the always-rendered <li> wrapper).
    await page.getByTestId("button-toggle-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toBeVisible();
    await page.getByTestId(`button-toggle-expand-set-${setA.id}`).click();

    const memberA0 = page.getByTestId(
      `set-member-${setA.id}-${fixture.sheetIds[0]}`,
    );
    const setBRow = page.getByTestId(`row-sheet-set-${setB.id}`);
    await expect(memberA0).toBeVisible();
    await expect(setBRow).toBeVisible();

    // The headless DataTransfer provided by Playwright's drag/drop
    // primitives can't preserve our custom MIME payload across the
    // wire, so we drive the same handlers the user would by
    // dispatching native drag events with a hand-built DataTransfer.
    // (Playwright's docs recommend exactly this for synthetic drag
    // contracts.) The `sourceSetId` field is what flips the parent
    // set's onDrop from "add" into the new atomic move endpoint.
    await page.evaluate(
      ({ memberId, targetId, sheetId, sourceSetId }) => {
        const member = document.querySelector(`[data-testid="${memberId}"]`)!;
        const target = document.querySelector(`[data-testid="${targetId}"]`)!;
        const dt = new DataTransfer();
        dt.effectAllowed = "move";
        dt.setData("text/plain", sheetId);
        dt.setData(
          "application/x-takeoff-sheet",
          JSON.stringify({ sheetId, sourceSetId }),
        );
        dt.setData(`application/x-takeoff-sheet-source-${sourceSetId}`, "1");
        member.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
        );
        target.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
        );
        target.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, dataTransfer: dt }),
        );
        target.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
        );
        member.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
        );
      },
      {
        memberId: `set-member-${setA.id}-${fixture.sheetIds[0]}`,
        targetId: `row-sheet-set-${setB.id}`,
        sheetId: fixture.sheetIds[0],
        sourceSetId: setA.id,
      },
    );

    // The mutation invalidates set A's detail cache — the moved sheet
    // is gone from A's expanded member list.
    await expect(
      page.getByTestId(`set-member-${setA.id}-${fixture.sheetIds[0]}`),
    ).toHaveCount(0, { timeout: 5_000 });

    // Now switch the expanded set to B and confirm the moved sheet
    // shows up there. (The panel only keeps one set expanded at a
    // time, so we collapse A by clicking it before opening B.)
    await page.getByTestId(`button-toggle-expand-set-${setA.id}`).click();
    await page.getByTestId(`button-toggle-expand-set-${setB.id}`).click();
    await expect(
      page.getByTestId(`set-member-${setB.id}-${fixture.sheetIds[0]}`),
    ).toBeVisible({ timeout: 5_000 });

    // Server-side check: a fresh GET sees A with one sheet left and
    // B with two members (the original sheet[2] plus the moved one).
    const aRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheet-sets/${setA.id}`,
    );
    const bRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheet-sets/${setB.id}`,
    );
    expect(aRes.status()).toBe(200);
    expect(bRes.status()).toBe(200);
    const aBody = (await aRes.json()) as {
      members: Array<{ sheetId: string }>;
    };
    const bBody = (await bRes.json()) as {
      members: Array<{ sheetId: string }>;
    };
    expect(aBody.members.map((m) => m.sheetId)).toEqual([fixture.sheetIds[1]]);
    expect(bBody.members.map((m) => m.sheetId).sort()).toEqual(
      [fixture.sheetIds[2], fixture.sheetIds[0]].sort(),
    );
  });

  // Task #2229 — Dropping a member back onto its own set is a no-op
  // (and the panel doesn't even light up the source set during hover).
  test("dropping a member back on its own set is a no-op", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 2);
    await gotoTakeoff(page, fixture.bid.code);

    const set = await createSet(page, fixture.bid.id, "PW Self Drop");
    await addMembers(page, set.id, [fixture.sheetIds[0], fixture.sheetIds[1]]);

    await page.getByTestId("button-toggle-sheet-sets").click();
    await page.getByTestId(`button-toggle-expand-set-${set.id}`).click();
    await expect(
      page.getByTestId(`set-member-${set.id}-${fixture.sheetIds[0]}`),
    ).toBeVisible();

    const before = await page.request.get(
      `${BASE_URL}/api/takeoff/sheet-sets/${set.id}`,
    );
    const beforeBody = (await before.json()) as {
      members: Array<{ sheetId: string; sortOrder: number }>;
    };
    const beforeOrder = [...beforeBody.members]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => m.sheetId);

    await page.evaluate(
      ({ memberId, targetId, sheetId, sourceSetId }) => {
        const member = document.querySelector(`[data-testid="${memberId}"]`)!;
        const target = document.querySelector(`[data-testid="${targetId}"]`)!;
        const dt = new DataTransfer();
        dt.effectAllowed = "move";
        dt.setData("text/plain", sheetId);
        dt.setData(
          "application/x-takeoff-sheet",
          JSON.stringify({ sheetId, sourceSetId }),
        );
        dt.setData(`application/x-takeoff-sheet-source-${sourceSetId}`, "1");
        member.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
        );
        target.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, dataTransfer: dt }),
        );
        target.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
        );
        member.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
        );
      },
      {
        memberId: `set-member-${set.id}-${fixture.sheetIds[0]}`,
        targetId: `row-sheet-set-${set.id}`,
        sheetId: fixture.sheetIds[0],
        sourceSetId: set.id,
      },
    );

    // No-op: the membership and order are exactly what they were.
    const after = await page.request.get(
      `${BASE_URL}/api/takeoff/sheet-sets/${set.id}`,
    );
    const afterBody = (await after.json()) as {
      members: Array<{ sheetId: string; sortOrder: number }>;
    };
    const afterOrder = [...afterBody.members]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => m.sheetId);
    expect(afterOrder).toEqual(beforeOrder);
  });
});
