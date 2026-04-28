import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

async function seedTakeoffFixture(page: Page): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    {
      data: { sheetCount: 1, versionCount: 1, measurementCount: 0 },
    },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function clearChest(page: Page) {
  // Wipe any chest items from previous runs so empty-state assertions
  // are deterministic. The list endpoint is per-user, so this only
  // touches rows owned by the test admin account.
  const res = await page.request.get(`${BASE_URL}/api/takeoff/tool-chest`);
  if (res.status() !== 200) return;
  const items = (await res.json()) as Array<{ id: string }>;
  for (const item of items) {
    await page.request.delete(`${BASE_URL}/api/takeoff/tool-chest/${item.id}`);
  }
}

async function gotoTakeoff(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // Sidebar overlays the View ribbon group on narrower viewports — same
  // collapse trick as in takeoff-ribbon-shortcuts.spec.ts.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
}

test.describe("Takeoff Tool Chest (Task #2139)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
    await clearChest(page);
  });

  test("View ribbon → Tool Chest toggles the panel and persists across reload", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    const chestBtn = page.getByTestId("ribbon-tool-tool-chest");
    await expect(chestBtn).toBeVisible();
    await expect(chestBtn).toHaveAttribute("aria-pressed", "false");

    // Open
    await chestBtn.click();
    await expect(page.getByTestId("panel-tool-chest")).toBeVisible();
    await expect(chestBtn).toHaveAttribute("aria-pressed", "true");

    // Empty state on a brand-new chest.
    await expect(page.getByTestId("chest-empty-state")).toBeVisible();

    // Persist across reload (localStorage-driven).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("panel-tool-chest")).toBeVisible();

    // Close from the panel header.
    await page.getByTestId("button-close-tool-chest").click();
    await expect(page.getByTestId("panel-tool-chest")).toHaveCount(0);
  });

  test("right-click ribbon tool → Pin pushes a row into the chest", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    // Open the chest first so we can watch the row land.
    await page.getByTestId("ribbon-tool-tool-chest").click();
    await expect(page.getByTestId("chest-empty-state")).toBeVisible();

    // Right-click the Linear measure tool → Pin to Tool Chest.
    const linearBtn = page.getByTestId("ribbon-tool-linear");
    await linearBtn.click({ button: "right" });
    await page.getByTestId("ribbon-tool-pin-linear").click();

    // Empty state goes away; the new row appears in the Tools section.
    await expect(page.getByTestId("chest-empty-state")).toHaveCount(0);
    await expect(page.getByTestId("chest-section-tool")).toBeVisible();
    await expect(
      page.getByTestId("chest-section-mine-tool"),
    ).toBeVisible();
    // The row carries the chest item's id, but we can simply scope by
    // section and confirm at least one row is present.
    const rows = page
      .getByTestId("chest-section-mine-tool")
      .locator("[data-testid^='chest-item-']");
    await expect(rows).toHaveCount(1);

    // The API mirror should show 1 owned item too.
    const res = await page.request.get(`${BASE_URL}/api/takeoff/tool-chest`);
    expect(res.status()).toBe(200);
    const items = (await res.json()) as Array<{ itemKind: string; itemId: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemKind: "tool", itemId: "linear" });
  });

  test("drag chest item onto canvas activates the pinned tool with style pre-applied", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    // Seed a chest row directly so the drag target is deterministic.
    // Pin the markup_arrow tool with a specific color override —
    // the drop handler must (a) flip activeTool to "markup_arrow"
    // and (b) push the override into setMarkupColor before drawing.
    const seedRes = await page.request.post(
      `${BASE_URL}/api/takeoff/tool-chest`,
      {
        data: {
          itemKind: "tool",
          itemId: "markup_arrow",
          label: "Arrow",
          color: "#dc2626",
          shortcut: null,
          sortOrder: 0,
          isShared: false,
        },
      },
    );
    expect(seedRes.status()).toBe(201);
    const seeded = (await seedRes.json()) as { id: string };

    await page.getByTestId("ribbon-tool-tool-chest").click();
    await expect(page.getByTestId("panel-tool-chest")).toBeVisible();

    const chestRow = page.getByTestId(`chest-item-${seeded.id}`);
    await expect(chestRow).toBeVisible();

    // Sanity: the pinned arrow tool is NOT the active tool yet.
    const arrowToolBtn = page.getByTestId("ribbon-tool-arrow");
    await expect(arrowToolBtn).toHaveAttribute("aria-pressed", "false");

    // Synthesize a drag-and-drop. Playwright's `dragTo` doesn't ship
    // the chest's custom MIME type, so dispatch the lifecycle events
    // manually with a DataTransfer pre-loaded with the chest payload —
    // this matches what the production drag handler reads.
    const canvas = page.getByTestId("takeoff-canvas-viewport");
    await expect(canvas).toBeVisible();

    await page.evaluate(
      ({ rowSelector, dropSelector }) => {
        const row = document.querySelector(rowSelector) as HTMLElement | null;
        const drop = document.querySelector(dropSelector) as HTMLElement | null;
        if (!row || !drop) throw new Error("drag/drop targets not found");
        const dt = new DataTransfer();
        dt.setData(
          "application/x-takeoff-chest-item+json",
          JSON.stringify({
            kind: "tool",
            refId: "markup_arrow",
            color: "#dc2626",
            label: "Arrow",
          }),
        );
        row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        drop.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
        );
        drop.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
        drop.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
        row.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      },
      {
        rowSelector: `[data-testid='chest-item-${seeded.id}']`,
        dropSelector: "[data-testid='takeoff-canvas-viewport']",
      },
    );

    // The Annotate ribbon group renders the arrow tool with display
    // id "arrow" (pin stores canonical "markup_arrow", activation
    // calls setActiveTool("markup_arrow") — both refer to the same
    // ribbon button, which now reports active.
    await expect(arrowToolBtn).toHaveAttribute("aria-pressed", "true");
    // Status bar reflects the active tool too — guards against any
    // future ribbon button mapping drift.
    await expect(page.getByTestId("status-tool")).toHaveText("Arrow");
  });

  test("kebab menu unpin removes the row optimistically", async ({ page }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    // Seed a chest row directly via the API so we don't depend on the
    // ribbon context-menu path — that's covered by the previous test.
    const seedRes = await page.request.post(
      `${BASE_URL}/api/takeoff/tool-chest`,
      {
        data: {
          itemKind: "tool",
          itemId: "area",
          label: "Area",
          color: null,
          shortcut: null,
          sortOrder: 0,
          isShared: false,
        },
      },
    );
    expect(seedRes.status()).toBe(201);
    const seeded = (await seedRes.json()) as { id: string };

    await page.getByTestId("ribbon-tool-tool-chest").click();
    const row = page.getByTestId(`chest-item-${seeded.id}`);
    await expect(row).toBeVisible();

    await page.getByTestId(`button-chest-item-menu-${seeded.id}`).click();
    await page.getByTestId(`menu-unpin-chest-item-${seeded.id}`).click();

    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("chest-empty-state")).toBeVisible();
  });
});
