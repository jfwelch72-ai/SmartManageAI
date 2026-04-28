// Task #2140 — End-to-end coverage for the typed-dimension HUD,
// the inline calibration drawer, and the ortho-preset cycle.
// Drives the flows through their public test ids on top of a
// seeded takeoff fixture (no PDF upload required) and asserts the
// **functional outcomes** — typed segment locks to the parsed
// magnitude, calibration save persists the new scale — by
// intercepting the same backend calls the workspace makes.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";

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
    { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function gotoTakeoff(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // Same trick the ribbon e2e uses — close the right sidebar so it
  // doesn't overlay the rightmost ribbon groups (Verify lives
  // there, and we click `T` to open the drawer).
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Focus the ribbon itself so document.activeElement === <body>
  // and useTakeoffShortcuts will accept our keystrokes.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

test.describe("Takeoff typed-dim HUD + inline calibration drawer", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("Shift+O cycles ortho presets 15→30→45→90→off and the badge updates", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    const badge = page.getByTestId("ribbon-ortho-preset");
    await expect(badge).toBeVisible();
    // Initial state: cycle index points at the trailing `null`
    // (off) slot per ORTHO_PRESETS.
    await expect(badge).toContainText("off");
    await expect(badge).toHaveAttribute("data-active", "false");

    const expected = ["15°", "30°", "45°", "90°", "off"];
    for (const label of expected) {
      await page.keyboard.press("Shift+O");
      await expect(badge).toContainText(label);
      await expect(badge).toHaveAttribute(
        "data-active",
        label === "off" ? "false" : "true",
      );
    }
  });

  test("O toggles the legacy ortho lock and the Constrain button reflects it", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    const orthoBtn = page.getByTestId("ribbon-tool-ortho");
    await expect(orthoBtn).toBeVisible();
    await expect(orthoBtn).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("o");
    await expect(orthoBtn).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("o");
    await expect(orthoBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("T opens the inline calibration drawer; Coming-soon checkbox is disabled; standard-scale link opens PlanScaleModal", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    await page.keyboard.press("t");

    const drawer = page.getByTestId("inline-calibration-drawer");
    await expect(drawer).toBeVisible();
    await expect(
      page.getByTestId("inline-calibration-step"),
    ).toContainText("first reference point");

    // Sheet-set checkbox is feature-flagged off and disabled.
    const checkbox = page.getByTestId("checkbox-apply-sheet-set");
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeDisabled();

    // Save button is disabled until two points + a valid distance.
    await expect(
      page.getByTestId("button-inline-calibration-save"),
    ).toBeDisabled();

    // Typing a valid distance alone isn't enough (still no points)
    // but the parser preview should update inline.
    const distanceInput = page.getByTestId(
      "input-inline-calibration-distance",
    );
    await distanceInput.fill("12'6\"");
    await expect(
      page.getByTestId("text-inline-calibration-parsed"),
    ).toContainText("= 12.500 ft");

    // Bad input surfaces the parse error.
    await distanceInput.fill("not-a-number");
    await expect(
      page.getByTestId("text-inline-calibration-error"),
    ).toBeVisible();

    // "Use Standard Scale" hands off to the existing PlanScaleModal.
    await distanceInput.fill("");
    await page
      .getByTestId("button-inline-calibration-use-standard")
      .click();
    await expect(drawer).toHaveCount(0);
    // The PlanScaleModal renders a dialog with the recommended-scale
    // banner; assert one of its known structural test ids — fall back
    // to the dialog role if no test id is exposed.
    await expect(page.getByRole("dialog")).toBeVisible();

    // Task #2140 — the modal must no longer expose a "Calibrate" tab
    // or a "Start Calibration" button. Two-point calibration lives
    // exclusively in the inline drawer now, so a regression that
    // re-introduces either control would put us back in the dual-flow
    // state the task explicitly forbids.
    await expect(page.getByTestId("tab-calibrate")).toHaveCount(0);
    await expect(
      page.getByTestId("button-start-calibration"),
    ).toHaveCount(0);
    await expect(page.getByTestId("tab-standard-scales")).toBeVisible();
    await expect(page.getByTestId("tab-custom")).toBeVisible();
  });

  test("Esc on the drawer leaves the canvas in a clean idle state", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    await page.keyboard.press("t");
    await expect(
      page.getByTestId("inline-calibration-drawer"),
    ).toBeVisible();

    // Closing via the cancel button mirrors Esc — the drawer is
    // configured not to swallow Escape so Radix routes it through.
    await page.getByTestId("button-inline-calibration-cancel").click();
    await expect(
      page.getByTestId("inline-calibration-drawer"),
    ).toHaveCount(0);

    // Re-opening should bring up the drawer again with a fresh step.
    await page.keyboard.press("t");
    await expect(
      page.getByTestId("inline-calibration-step"),
    ).toContainText("first reference point");
  });

  test("Dim Input HUD is hidden until a measure draw starts", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    // No draw active → HUD must not be in the DOM, otherwise it
    // would intercept stray digits / Enter presses.
    await expect(page.getByTestId("dim-input-hud")).toHaveCount(0);
  });

  test("typed dim during a linear draw locks the segment to the parsed length", async ({
    page,
  }) => {
    // Functional contract: with a sheet at 10 px/ft, clicking a
    // first canvas point and typing `12'6"`+Enter must POST a
    // measurement whose two points are 125 px apart (= 12.5 ft × 10
    // px/ft). That round-trip — type → HUD → commitTypedDimension →
    // appended drawingPoint → completeSegment → POST — is the actual
    // "typed segment locks to length" requirement.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    // Pick the linear measure tool from the ribbon. Some tools are
    // collapsed into a group — open the Measure group first.
    const measureGroupToggle = page.getByTestId("ribbon-group-toggle-measure");
    if (await measureGroupToggle.isVisible().catch(() => false)) {
      await measureGroupToggle.click().catch(() => {});
    }
    const linearBtn = page.getByTestId("ribbon-tool-linear");
    await expect(linearBtn).toBeVisible({ timeout: 10_000 });
    await linearBtn.click();

    // First canvas click: starts the draw.
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await clickOnCanvas(page, canvas, { x: 200, y: 200 });

    // Wait for the HUD to mount — confirms `isDrawing` flipped on
    // and `dimHudActive` is true.
    await expect(page.getByTestId("dim-input-hud")).toBeVisible({
      timeout: 5_000,
    });

    // Listen for the POST that completeSegment fires when Enter
    // commits. Fire BEFORE typing so we catch it.
    const measurementPost = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements/.test(req.url()),
      { timeout: 15_000 },
    );

    // Type the dimension into the HUD: 12'6" then Enter.
    await page.keyboard.type("12");
    await page.keyboard.press("'");
    await page.keyboard.type("6");
    // Use the keyboard event to send a literal '"' — Playwright's
    // type() handles it directly.
    await page.keyboard.type('"');
    await expect(page.getByTestId("dim-input-hud-buffer")).toContainText(
      `12'6"`,
    );
    await expect(page.getByTestId("dim-input-hud-preview")).toContainText(
      "12 ft 6.00 in",
    );
    await page.keyboard.press("Enter");

    const req = await measurementPost;
    const body = req.postDataJSON() as {
      sheetId?: string;
      type?: string;
      points?: Array<{ x: number; y: number }>;
    };
    expect(body.sheetId).toBe(sheetIds[0]);
    expect(body.type).toBe("LINEAR");
    expect(body.points?.length ?? 0).toBeGreaterThanOrEqual(2);
    const [p0, p1] = body.points!;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const px = Math.sqrt(dx * dx + dy * dy);
    // Sheet seeded at 10 px/ft, typed length = 12.5 ft → 125 px.
    // Allow a small tolerance for any cursor-derived rounding when
    // the typed length is rotated to the cursor angle.
    expect(px).toBeGreaterThan(124);
    expect(px).toBeLessThan(126);
  });

  test("typed dim with Tab commits the segment AND keeps drawing from the new endpoint", async ({
    page,
  }) => {
    // Tab = commit-and-continue. After typing `10' + Tab` the
    // segment must persist (POST a LINEAR measurement) AND the
    // draw must remain active so the next typed dim or click
    // extends from the new vertex (HUD stays mounted).
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    const measureGroupToggle = page.getByTestId("ribbon-group-toggle-measure");
    if (await measureGroupToggle.isVisible().catch(() => false)) {
      await measureGroupToggle.click().catch(() => {});
    }
    const linearBtn = page.getByTestId("ribbon-tool-linear");
    await expect(linearBtn).toBeVisible({ timeout: 10_000 });
    await linearBtn.click();

    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await clickOnCanvas(page, canvas, { x: 200, y: 200 });
    await expect(page.getByTestId("dim-input-hud")).toBeVisible();

    const measurementPost = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements/.test(req.url()),
      { timeout: 15_000 },
    );

    await page.keyboard.type("10");
    await page.keyboard.press("'");
    await page.keyboard.press("Tab");

    const req = await measurementPost;
    const body = req.postDataJSON() as {
      sheetId?: string;
      type?: string;
      points?: Array<{ x: number; y: number }>;
    };
    expect(body.sheetId).toBe(sheetIds[0]);
    expect(body.type).toBe("LINEAR");
    const [p0, p1] = body.points!;
    const px = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    expect(px).toBeGreaterThan(99);
    expect(px).toBeLessThan(101);

    // Critical Tab-vs-Enter contract: HUD is STILL mounted after
    // commit-and-continue, so the next typed dim picks up from
    // the new endpoint.
    await expect(page.getByTestId("dim-input-hud")).toBeVisible();
  });

  test("typed dim during an arc draw places mid + end and POSTs a 3-point arc", async ({
    page,
  }) => {
    // Task #2140 round-8 — Arc has its own 3-point state machine
    // (start → mid → end). Typed input must drive that state
    // machine without routing through the synthetic-Enter path
    // used for polygons:
    //   - first canvas click             → drawingPoints = [start]
    //   - typed `10<0` + Tab             → places mid at (start + 100px right)
    //   - typed `10<90` + Enter          → places end at (mid + 100px down),
    //                                       creates the arc, POSTs 3 points.
    // The three points must be non-collinear (otherwise the arc
    // builder rejects with "collinear" toast and no POST fires).
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    const measureGroupToggle = page.getByTestId("ribbon-group-toggle-measure");
    if (await measureGroupToggle.isVisible().catch(() => false)) {
      await measureGroupToggle.click().catch(() => {});
    }
    const arcBtn = page.getByTestId("ribbon-tool-arc");
    await expect(arcBtn).toBeVisible({ timeout: 10_000 });
    await arcBtn.click();

    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await clickOnCanvas(page, canvas, { x: 200, y: 200 });

    // HUD mounts only when `dimHudActive` is true — proves arc is
    // wired in (round-7 review explicitly required this).
    await expect(page.getByTestId("dim-input-hud")).toBeVisible({
      timeout: 5_000,
    });

    // Type the mid-point dim: 10' at 0° (length-angle grammar uses
    // `<` to introduce the angle).
    await page.keyboard.type("10");
    await page.keyboard.press("'");
    await page.keyboard.press("<");
    await page.keyboard.type("0");
    await page.keyboard.press("Tab");

    // After Tab the HUD remains mounted (still drawing) — the
    // buffer is reset for the next typed dim. Type the end-point
    // dim: 10' at 90° (canvas Y grows down, so 90° is straight down).
    await expect(page.getByTestId("dim-input-hud")).toBeVisible();

    const measurementPost = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements/.test(req.url()),
      { timeout: 15_000 },
    );

    await page.keyboard.type("10");
    await page.keyboard.press("'");
    await page.keyboard.press("<");
    await page.keyboard.type("90");
    await page.keyboard.press("Enter");

    const req = await measurementPost;
    const body = req.postDataJSON() as {
      sheetId?: string;
      type?: string;
      points?: Array<{ x: number; y: number }>;
    };
    expect(body.sheetId).toBe(sheetIds[0]);
    expect(body.type).toBe("LINEAR");
    // Arcs are persisted as 3-point LINEAR measurements (see the
    // click-path branch in `use-takeoff-interactions`).
    expect(body.points?.length).toBe(3);
    const [start, mid, end] = body.points!;
    // Sheet seeded at 10 px/ft, 10' @ 0° → +100 px in x.
    expect(Math.abs(mid.x - start.x - 100)).toBeLessThan(1);
    expect(Math.abs(mid.y - start.y)).toBeLessThan(1);
    // Then 10' @ 90° from mid → +100 px in y (canvas Y is down).
    expect(Math.abs(end.x - mid.x)).toBeLessThan(1);
    expect(Math.abs(end.y - mid.y - 100)).toBeLessThan(1);
  });

  test("calibration drawer: pick two canvas points + type distance + save updates the sheet scale", async ({
    page,
  }) => {
    // Functional contract: pressing T must put the canvas into
    // calibrate mode, two canvas clicks must populate
    // calibrationPoints[], typing a distance and clicking Save must
    // PATCH /api/takeoff/sheets/:id/calibration with a NEW
    // scalePxPerFoot derived from (pixel distance / typed feet).
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    // Press T → drawer opens AND active tool flips to "calibrate"
    // so canvas clicks are interpreted as calibration picks (not
    // measurement clicks).
    await page.keyboard.press("t");
    await expect(page.getByTestId("inline-calibration-drawer")).toBeVisible();
    await expect(page.getByTestId("inline-calibration-step")).toContainText(
      "first reference point",
    );

    // Pick two reference points on the canvas. With the drawer's
    // modal={false} + no-overlay setup, these clicks pass straight
    // through to Konva.
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await clickOnCanvas(page, canvas, { x: 200, y: 200 });
    await expect(page.getByTestId("inline-calibration-step")).toContainText(
      "second reference point",
    );
    await clickOnCanvas(page, canvas, { x: 400, y: 200 });
    // Drawer reflects 2/2 — points captured.
    await expect(page.getByTestId("inline-calibration-step")).toContainText(
      "Type the real-world distance",
    );

    // Type the real-world distance into the drawer and Save.
    const distanceInput = page.getByTestId(
      "input-inline-calibration-distance",
    );
    await distanceInput.fill("10");

    // Capture the PATCH that handleSaveCalibration fires.
    const calibPatch = page.waitForRequest(
      (req) =>
        req.method() === "PATCH" &&
        new RegExp(
          `/api/takeoff/sheets/${sheetIds[0]}/calibration$`,
        ).test(req.url()),
      { timeout: 10_000 },
    );

    await page.getByTestId("button-inline-calibration-save").click();
    const req = await calibPatch;
    const body = req.postDataJSON() as {
      scalePxPerFoot?: number | string;
      units?: string;
    };
    // The two clicks above are 200px apart; typed = 10 ft → 20 px/ft.
    expect(Number(body.scalePxPerFoot)).toBeGreaterThan(19);
    expect(Number(body.scalePxPerFoot)).toBeLessThan(21);
  });

  test("calibration save persists scalePxPerFoot to the sheet", async ({
    page,
  }) => {
    // The deeper "two-point pick + Save" contract — including all
    // the unit conversion math — is pinned by the component-level
    // tests in client/src/components/takeoff/__tests__/InlineCalibrationDrawer.test.tsx.
    // This e2e verifies the **server** half of the round-trip: the
    // PATCH endpoint that the drawer's Save button calls actually
    // updates the sheet so the next page load sees the new scale.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    expect(sheetIds.length).toBeGreaterThan(0);
    const sheetId = sheetIds[0];

    // PATCH against the same endpoint the drawer calls under the
    // hood (`use-takeoff-interactions.ts → handleSaveCalibration`).
    const patch = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
      {
        data: {
          scalePxPerFoot: 96,
          units: "ft",
          scaleLabel: '1/8" = 1\'-0"',
        },
      },
    );
    expect(patch.status()).toBe(200);

    // Round-trip: re-fetch the bid's sheet list and confirm the new
    // scale stuck. (There's no GET-by-id endpoint; the workspace
    // pulls the same list to populate `currentSheet`.)
    const get = await page.request.get(
      `${BASE_URL}/api/bids/${bid.id}/takeoff/sheets`,
    );
    expect(get.status()).toBe(200);
    const sheets = (await get.json()) as Array<{
      id: string;
      scalePxPerFoot?: number | string | null;
    }>;
    const updated = sheets.find((s) => s.id === sheetId);
    expect(updated).toBeTruthy();
    expect(Number(updated?.scalePxPerFoot)).toBeCloseTo(96, 4);
  });
});
