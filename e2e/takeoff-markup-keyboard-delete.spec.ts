/**
 * Task #1861 — Delete/Backspace on multi-selected takeoff markups
 * fires the same single bulk DELETE the toolbar button does.
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

// HIGHLIGHT renders as a filled Rect (opacity 0.35), so a click
// anywhere inside its bbox reliably hits the body — same choice as
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

interface SeededWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
  markupA: MarkupResponse;
  markupB: MarkupResponse;
}

async function seedTwoMarkups(
  page: Page,
  suffix: number,
): Promise<SeededWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Markup Keydelete Bid ${suffix}`,
      clientName: "PW Markup Keydelete Client",
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
        fileUrl: "https://example.com/markup-keydelete-plan.pdf",
        fileName: "Markup Keydelete Sheet",
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  const sheetId = planBody.sheets[0].id;

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

  // Suppress the Joyride bid-plans tour so it doesn't overlay the
  // canvas on first load (mirrors `seedWorkspace` in the sibling
  // takeoff-markup-history-wiring spec).
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

  return { bidId, bidCode, sheetId, markupA, markupB };
}

async function multiSelectAandB(page: Page) {
  // Click A → Shift+click B; the panel header flipping to "Edit 2
  // markups" is the canonical signal that selectedMarkupIds.size === 2.
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

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff markup keyboard delete - Task #1861", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("Delete fires one bulk DELETE for both selected markups", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markupA, markupB } = await seedTwoMarkups(
      page,
      Date.now(),
    );

    {
      const before = await listMarkups(page, sheetId);
      expect(before.find((m) => m.id === markupA.id)).toBeTruthy();
      expect(before.find((m) => m.id === markupB.id)).toBeTruthy();
    }

    await multiSelectAandB(page);

    // Capture outbound markup DELETEs to prove ONE bulk request
    // (not N per-id deletes) — bulk endpoint is
    // `/api/takeoff/markups/bulk`, per-id is `/api/takeoff/markups/<id>`.
    const deletedRequests: Array<{ url: string; postData: string | null }> = [];
    page.on("request", (req) => {
      if (req.method() !== "DELETE") return;
      const url = req.url();
      if (!url.includes("/api/takeoff/markups")) return;
      deletedRequests.push({ url, postData: req.postData() });
    });

    await page.keyboard.press("Delete");

    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, sheetId);
          return {
            hasA: list.some((m) => m.id === markupA.id),
            hasB: list.some((m) => m.id === markupB.id),
          };
        },
        {
          message:
            "expected both selected markups to be deleted by Delete keypress",
          timeout: 15_000,
        },
      )
      .toEqual({ hasA: false, hasB: false });

    expect(deletedRequests.length).toBe(1);
    expect(deletedRequests[0].url).toMatch(/\/api\/takeoff\/markups\/bulk$/);
    const body = JSON.parse(deletedRequests[0].postData ?? "{}");
    expect(body.ids).toBeInstanceOf(Array);
    expect(new Set(body.ids)).toEqual(new Set([markupA.id, markupB.id]));
  });

  test("Backspace also fires the bulk delete after multi-select", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markupA, markupB } = await seedTwoMarkups(
      page,
      Date.now() + 1,
    );

    await multiSelectAandB(page);
    await page.keyboard.press("Backspace");

    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, sheetId);
          return {
            hasA: list.some((m) => m.id === markupA.id),
            hasB: list.some((m) => m.id === markupB.id),
          };
        },
        {
          message:
            "expected Backspace to delete both selected markups via bulk endpoint",
          timeout: 15_000,
        },
      )
      .toEqual({ hasA: false, hasB: false });
  });

  test("Backspace inside a focused text input does not delete markups", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markupA, markupB } = await seedTwoMarkups(
      page,
      Date.now() + 2,
    );

    await multiSelectAandB(page);

    // Inject + focus a synthetic <input> rather than relying on a
    // brittle selector against a real header search field.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "pw-suppression-input";
      input.type = "text";
      input.value = "abc";
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.press("Backspace");

    // 1.5s is enough for the optimistic strip + server round-trip to
    // land if the suppression ever regresses.
    await page.waitForTimeout(1500);

    const after = await listMarkups(page, sheetId);
    expect(after.find((m) => m.id === markupA.id)).toBeTruthy();
    expect(after.find((m) => m.id === markupB.id)).toBeTruthy();

    await page.evaluate(() => {
      document.getElementById("pw-suppression-input")?.remove();
    });
  });

  test("Delete on a focused button outside the workspace does not delete markups", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markupA, markupB } = await seedTwoMarkups(
      page,
      Date.now() + 3,
    );

    await multiSelectAandB(page);

    // Inject a <button> *outside* the takeoff workspace
    // (`workspaceRef`) and focus it. The handler should refuse to
    // fire because focus is on a non-text control that lives outside
    // the canvas/workspace container — Delete must not double as a
    // global "delete selected markups" hotkey.
    await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.id = "pw-outside-button";
      btn.type = "button";
      btn.textContent = "Outside button";
      // Force-mount as the LAST child of <body> so it lives outside
      // the workspace's React root, which is itself nested inside
      // the SPA shell. `position: fixed` keeps it visible without
      // disturbing layout.
      btn.style.position = "fixed";
      btn.style.bottom = "10px";
      btn.style.right = "10px";
      btn.style.zIndex = "99999";
      document.body.appendChild(btn);
      btn.focus();
    });

    // Sanity: the button is truly the active element before we send
    // the key. If a stray re-render stole focus back to the canvas,
    // this assertion catches that and the rest of the test would be
    // measuring the wrong thing.
    expect(
      await page.evaluate(
        () => document.activeElement?.id === "pw-outside-button",
      ),
    ).toBe(true);

    await page.keyboard.press("Delete");
    await page.waitForTimeout(1500);

    const after = await listMarkups(page, sheetId);
    expect(after.find((m) => m.id === markupA.id)).toBeTruthy();
    expect(after.find((m) => m.id === markupB.id)).toBeTruthy();

    await page.evaluate(() => {
      document.getElementById("pw-outside-button")?.remove();
    });
  });
});
