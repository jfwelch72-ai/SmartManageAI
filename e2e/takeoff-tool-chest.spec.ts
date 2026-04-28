import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { dispatchHtml5Drop } from "./helpers/htmlDrag";

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

// Drag-lifecycle helpers used by the Task #2215 reorder tests.
//
// `ChestSection.handleDrop` reads the React `hoverIndex` state from
// the closure that was active when its `onDragOver` ran. When all
// drag events are dispatched in one synchronous tick (single
// page.evaluate call) React never flushes between dragover and drop,
// so the drop handler sees a stale hoverIndex of null and bails.
// Splitting the dragover and drop phases into separate page.evaluate
// calls lets us await a deterministic UI signal (the `ring-2` drop
// target class) between them — which is exactly what real-browser
// drag events do naturally (one task per event).
async function dispatchDragoverPhase(
  page: Page,
  srcSelector: string,
  dstSelector: string,
) {
  await page.evaluate(
    ({ srcSelector, dstSelector }) => {
      const src = document.querySelector(srcSelector) as HTMLElement | null;
      const dst = document.querySelector(dstSelector) as HTMLElement | null;
      if (!src || !dst) throw new Error("reorder targets not found");
      const dt = new DataTransfer();
      (window as unknown as { __chestDt: DataTransfer }).__chestDt = dt;
      src.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
      );
      dst.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
      );
      dst.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    },
    { srcSelector, dstSelector },
  );
}

async function dispatchDropPhase(
  page: Page,
  srcSelector: string,
  dstSelector: string,
) {
  await page.evaluate(
    ({ srcSelector, dstSelector }) => {
      const src = document.querySelector(srcSelector) as HTMLElement | null;
      const dst = document.querySelector(dstSelector) as HTMLElement | null;
      if (!src || !dst) throw new Error("reorder targets not found");
      const dt = (window as unknown as { __chestDt: DataTransfer }).__chestDt;
      dst.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      src.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer: dt }),
      );
    },
    { srcSelector, dstSelector },
  );
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
    // this matches what the production drag handler reads. The
    // canvas drop handler reads only from DataTransfer (no React
    // state crosses event boundaries) so the single-tick variant is
    // appropriate here.
    const canvas = page.getByTestId("takeoff-canvas-viewport");
    await expect(canvas).toBeVisible();

    await dispatchHtml5Drop({
      source: chestRow,
      target: canvas,
      payload: {
        mime: "application/x-takeoff-chest-item+json",
        data: JSON.stringify({
          kind: "tool",
          refId: "markup_arrow",
          color: "#dc2626",
          label: "Arrow",
        }),
      },
    });

    // The Annotate ribbon group renders the arrow tool with display
    // id "arrow" (pin stores canonical "markup_arrow", activation
    // calls setActiveTool("markup_arrow") — both refer to the same
    // ribbon button, which now reports active.
    await expect(arrowToolBtn).toHaveAttribute("aria-pressed", "true");
    // Status bar reflects the active tool too — guards against any
    // future ribbon button mapping drift.
    await expect(page.getByTestId("status-tool")).toHaveText("Arrow");
  });

  test("drag-to-reorder rows persists across reload (Task #2215)", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    // Seed three owned chest rows with deterministic sortOrder so we
    // know exactly which row is "first" before the drag.
    const seedRow = async (itemId: string, sortOrder: number) => {
      const res = await page.request.post(
        `${BASE_URL}/api/takeoff/tool-chest`,
        {
          data: {
            itemKind: "tool",
            itemId,
            label: null,
            color: null,
            shortcut: null,
            sortOrder,
            isShared: false,
          },
        },
      );
      expect(res.status()).toBe(201);
      return (await res.json()) as { id: string; itemId: string };
    };
    const a = await seedRow("linear", 0);
    const b = await seedRow("area", 1);
    const c = await seedRow("count", 2);

    await page.getByTestId("ribbon-tool-tool-chest").click();
    await expect(page.getByTestId("panel-tool-chest")).toBeVisible();

    const section = page.getByTestId("chest-section-mine-tool");
    await expect(section).toBeVisible();

    const rowOrder = () =>
      section
        .locator("[data-testid^='chest-item-']")
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).getAttribute("data-testid")!),
        );

    expect(await rowOrder()).toEqual([
      `chest-item-${a.id}`,
      `chest-item-${b.id}`,
      `chest-item-${c.id}`,
    ]);

    // Drag the first row (linear) onto the third (count) — the section's
    // splice-then-insert reorder yields [b, c, a]. Playwright's dragTo
    // doesn't replay React's onDragStart/onDragOver chain reliably, so
    // drive the lifecycle events manually with a shared DataTransfer.
    //
    // The reorder handler reads `hoverIndex` from React state inside
    // onDrop — that means dragover and drop must arrive in *separate*
    // tasks so React can flush the setState in between. Real-browser
    // drag events naturally satisfy this, but synthetic dispatches
    // inside one page.evaluate would all run in the same task. Split
    // the dispatches across page.evaluate calls and stash a single
    // DataTransfer on the window so each call sees the same payload.
    const srcSelector = `[data-testid='chest-item-${a.id}']`;
    const dstSelector = `[data-testid='chest-item-${c.id}']`;
    await dispatchDragoverPhase(page, srcSelector, dstSelector);
    // Wait deterministically for the drop-target ring class — that's
    // the ChestSection's `isDropTarget` styling, which only paints
    // after React commits the dragover-driven setHoverIndex. Once it's
    // visible we know the next render's `handleDrop` closure will see
    // the up-to-date hoverIndex.
    await expect(page.locator(`${dstSelector}.ring-2`)).toBeVisible();
    await dispatchDropPhase(page, srcSelector, dstSelector);

    // Optimistic local order updates immediately.
    await expect
      .poll(async () => await rowOrder())
      .toEqual([
        `chest-item-${b.id}`,
        `chest-item-${c.id}`,
        `chest-item-${a.id}`,
      ]);

    // Server mirror reflects the new sortOrders for owned rows.
    await expect
      .poll(async () => {
        const res = await page.request.get(
          `${BASE_URL}/api/takeoff/tool-chest`,
        );
        const items = (await res.json()) as Array<{
          id: string;
          sortOrder: number;
        }>;
        return Object.fromEntries(items.map((i) => [i.id, i.sortOrder]));
      })
      .toMatchObject({ [b.id]: 0, [c.id]: 1, [a.id]: 2 });

    // Reload — the chest panel re-opens (localStorage), and rows render
    // in the persisted order pulled fresh from the API.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("panel-tool-chest")).toBeVisible();
    const sectionAfter = page.getByTestId("chest-section-mine-tool");
    await expect(sectionAfter).toBeVisible();
    await expect
      .poll(async () =>
        sectionAfter
          .locator("[data-testid^='chest-item-']")
          .evaluateAll((els) =>
            els.map((el) => (el as HTMLElement).getAttribute("data-testid")!),
          ),
      )
      .toEqual([
        `chest-item-${b.id}`,
        `chest-item-${c.id}`,
        `chest-item-${a.id}`,
      ]);
  });

  test("reorder rolls back the optimistic order when the server fails (Task #2215)", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    const seedRow = async (itemId: string, sortOrder: number) => {
      const res = await page.request.post(
        `${BASE_URL}/api/takeoff/tool-chest`,
        {
          data: {
            itemKind: "tool",
            itemId,
            label: null,
            color: null,
            shortcut: null,
            sortOrder,
            isShared: false,
          },
        },
      );
      expect(res.status()).toBe(201);
      return (await res.json()) as { id: string };
    };
    const a = await seedRow("linear", 0);
    const b = await seedRow("area", 1);

    await page.getByTestId("ribbon-tool-tool-chest").click();
    const section = page.getByTestId("chest-section-mine-tool");
    await expect(section).toBeVisible();

    // Force the reorder endpoint to error so the optimistic update is
    // rolled back. PATCH/DELETE/etc keep their normal behaviour.
    await page.route("**/api/takeoff/tool-chest/reorder", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "boom" }),
      }),
    );

    const srcSel = `[data-testid='chest-item-${a.id}']`;
    const dstSel = `[data-testid='chest-item-${b.id}']`;
    await dispatchDragoverPhase(page, srcSel, dstSel);
    await expect(page.locator(`${dstSel}.ring-2`)).toBeVisible();
    await dispatchDropPhase(page, srcSel, dstSel);

    // After the failed save the rows revert to the pre-drag order and
    // the user sees a destructive toast explaining the rollback.
    await expect
      .poll(async () =>
        section
          .locator("[data-testid^='chest-item-']")
          .evaluateAll((els) =>
            els.map((el) => (el as HTMLElement).getAttribute("data-testid")!),
          ),
      )
      .toEqual([`chest-item-${a.id}`, `chest-item-${b.id}`]);
    await expect(page.getByText("Reorder failed").first()).toBeVisible();
  });

  test("Alt+ArrowUp / Alt+ArrowDown reorders pinned rows from the keyboard (Task #2238)", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    // Three owned rows in a known starting order.
    const seedRow = async (itemId: string, sortOrder: number) => {
      const res = await page.request.post(
        `${BASE_URL}/api/takeoff/tool-chest`,
        {
          data: {
            itemKind: "tool",
            itemId,
            label: null,
            color: null,
            shortcut: null,
            sortOrder,
            isShared: false,
          },
        },
      );
      expect(res.status()).toBe(201);
      return (await res.json()) as { id: string };
    };
    const a = await seedRow("linear", 0);
    const b = await seedRow("area", 1);
    const c = await seedRow("count", 2);

    await page.getByTestId("ribbon-tool-tool-chest").click();
    const section = page.getByTestId("chest-section-mine-tool");
    await expect(section).toBeVisible();

    const rowOrder = () =>
      section
        .locator("[data-testid^='chest-item-']")
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).getAttribute("data-testid")!),
        );

    expect(await rowOrder()).toEqual([
      `chest-item-${a.id}`,
      `chest-item-${b.id}`,
      `chest-item-${c.id}`,
    ]);

    // Visually-hidden hint exposes the shortcut to assistive tech.
    const hint = page.getByTestId("chest-keyboard-hint-tool");
    await expect(hint).toHaveText(/Alt.*Arrow Up.*Alt.*Arrow Down/i);

    // Focus the first row, then press Alt+ArrowDown twice — `linear`
    // should walk past `area` and `count` to the bottom of the list.
    const rowA = page.getByTestId(`chest-item-${a.id}`);
    await rowA.focus();
    await expect(rowA).toBeFocused();
    await expect(rowA).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowUp Alt+ArrowDown",
    );

    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(async () => await rowOrder())
      .toEqual([
        `chest-item-${b.id}`,
        `chest-item-${a.id}`,
        `chest-item-${c.id}`,
      ]);
    // Focus rides along with the moved row so successive presses keep
    // moving the same item.
    await expect(rowA).toBeFocused();

    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(async () => await rowOrder())
      .toEqual([
        `chest-item-${b.id}`,
        `chest-item-${c.id}`,
        `chest-item-${a.id}`,
      ]);

    // Already at the bottom — another Alt+ArrowDown is a no-op.
    await page.keyboard.press("Alt+ArrowDown");
    expect(await rowOrder()).toEqual([
      `chest-item-${b.id}`,
      `chest-item-${c.id}`,
      `chest-item-${a.id}`,
    ]);

    // Walk back up one slot.
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(async () => await rowOrder())
      .toEqual([
        `chest-item-${b.id}`,
        `chest-item-${a.id}`,
        `chest-item-${c.id}`,
      ]);

    // Server mirror should reflect the latest ordering — Alt+Down,
    // Alt+Down, Alt+Up leaves [b, a, c] with sortOrders 0/1/2.
    await expect
      .poll(async () => {
        const res = await page.request.get(
          `${BASE_URL}/api/takeoff/tool-chest`,
        );
        const items = (await res.json()) as Array<{
          id: string;
          sortOrder: number;
        }>;
        return Object.fromEntries(items.map((i) => [i.id, i.sortOrder]));
      })
      .toMatchObject({ [b.id]: 0, [a.id]: 1, [c.id]: 2 });
  });

  test("Alt+Arrow keyboard reorder rolls back when the server fails (Task #2238)", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    const seedRow = async (itemId: string, sortOrder: number) => {
      const res = await page.request.post(
        `${BASE_URL}/api/takeoff/tool-chest`,
        {
          data: {
            itemKind: "tool",
            itemId,
            label: null,
            color: null,
            shortcut: null,
            sortOrder,
            isShared: false,
          },
        },
      );
      expect(res.status()).toBe(201);
      return (await res.json()) as { id: string };
    };
    const a = await seedRow("linear", 0);
    const b = await seedRow("area", 1);

    await page.getByTestId("ribbon-tool-tool-chest").click();
    const section = page.getByTestId("chest-section-mine-tool");
    await expect(section).toBeVisible();

    await page.route("**/api/takeoff/tool-chest/reorder", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "boom" }),
      }),
    );

    const rowA = page.getByTestId(`chest-item-${a.id}`);
    await rowA.focus();
    await page.keyboard.press("Alt+ArrowDown");

    // The optimistic local move is rolled back to the original order
    // and the destructive toast surfaces the failure to the user.
    await expect
      .poll(async () =>
        section
          .locator("[data-testid^='chest-item-']")
          .evaluateAll((els) =>
            els.map((el) => (el as HTMLElement).getAttribute("data-testid")!),
          ),
      )
      .toEqual([`chest-item-${a.id}`, `chest-item-${b.id}`]);
    await expect(page.getByText("Reorder failed").first()).toBeVisible();
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
