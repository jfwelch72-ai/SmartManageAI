// Shared helpers for the takeoff "Dim Input" chain-mode end-to-end
// specs (Tasks #2227 LINEAR, #2269 ARC + AREA, #2301 CIRCLE / SEGMENT
// / DEDUCT / VOLUME / PITCHED_AREA / SURFACE_AREA).
//
// Every chain-mode spec needs the same boilerplate: a dev-login that
// installs an org-scoped session, a seeded PW takeoff fixture (sheet
// pre-calibrated to `scalePxPerFoot: 10` per
// `server/devSeedEnterprise.ts:885`), the same `?sheet=<id>` deep-link
// + sessionStorage handshake to make the workspace mount the canvas,
// and the same Verify / Measure ribbon-group choreography to open the
// Dim Input dialog and pick a draw tool. Centralizing these here so
// the per-spec files only contain the per-tool click sequences and
// the per-tool commit assertions, and so that a future tweak (e.g. a
// new ribbon group or an additional sidebar overlay) only has to be
// applied in one place.
//
// The constants below pin the locked length and the resulting locked
// pixel distance so cross-spec drift is obvious if either value
// moves.

import { expect, type Page, type Locator } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// 12.5 ft × 10 px/ft = 125 px on the seeded sheet — same magnitude
// every chain-mode spec uses, so cross-spec drift is obvious if any
// test's expectation moves.
export const LOCKED_LENGTH_FT = 12.5;
export const EXPECTED_PX = 125;
// `applyFixedLength` projects the cursor onto the anchor→cursor ray
// at exactly `lengthPx`, but the round-trip through Konva's stage
// transform + the React/Konva pointer event pipeline rounds at a few
// places (subpixel transforms, integer pointer coords). The LINEAR
// chain spec uses ±1 px and that's been stable across browsers, so we
// reuse the same tolerance here.
export const PX_TOLERANCE = 1;

export interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

export async function devLogin(page: Page, role: string): Promise<void> {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

export async function seedTakeoffFixture(
  page: Page,
  opts: { sheetCount?: number; versionCount?: number; measurementCount?: number } = {},
): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    {
      data: {
        sheetCount: opts.sheetCount ?? 1,
        versionCount: opts.versionCount ?? 1,
        measurementCount: opts.measurementCount ?? 0,
      },
    },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

/**
 * POST a measurement directly into the seeded sheet's DRAFT version.
 *
 * The DEDUCT spec needs an existing AREA host before the deduct tool
 * will commit (the canvas branch bails with a "Select Area First"
 * toast otherwise). Drawing the host through the chain-mode UI would
 * itself be length-locked to 125 px, which is too small to enclose
 * the deduct triangle whose legs are also locked at 125 px. Bypassing
 * the UI lets the host be arbitrarily large so the deduct centroid
 * check (`isPointInPolygon` in
 * `client/src/hooks/use-takeoff-interactions.ts`) passes.
 *
 * Returns the parsed JSON body so the spec can capture the host's id
 * for any later assertion.
 */
export async function seedMeasurement(
  page: Page,
  body: {
    sheetId: string;
    type: "AREA" | "VOLUME" | "PITCHED_AREA" | "SURFACE_AREA" | "LINEAR";
    points: Array<{ x: number; y: number }>;
    label?: string;
  },
): Promise<{ id: string; type: string }> {
  const res = await page.request.post(
    `${BASE_URL}/api/takeoff/measurements`,
    { data: body },
  );
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; type: string };
}

export async function gotoTakeoff(
  page: Page,
  bidCode: string,
  bidId?: string,
  sheetId?: string,
): Promise<void> {
  // The seeded takeoff fixture creates sheets but the workspace does
  // NOT auto-select one — without `?sheet=<id>` the canvas never
  // mounts and the page stays on the "Start Your Takeoff" empty
  // state. The standalone takeoff page reads `?sheet=` only via a
  // post-mount `useEffect` that writes through to `sessionStorage`
  // — by then the inner workspace has already initialized its
  // `selectedSheetId` from sessionStorage (which was empty), so
  // the deep link silently falls back to "no sheet". We seed the
  // sessionStorage key BEFORE the workspace mounts and then reload.
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  if (bidId && sheetId) {
    await page.evaluate(
      ({ key, val }) => {
        sessionStorage.setItem(key, val);
        // Keep the right-side TakeoffSidebar collapsed so its overlay
        // never intercepts ribbon clicks against the rightmost ribbon
        // groups, where Verify (and the Dim Input button) live.
        localStorage.setItem("takeoff-sidebar-collapsed", "true");
      },
      { key: `takeoff-sheet-${bidId}`, val: sheetId },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // Defensive — close the right sidebar if the localStorage hint
  // didn't propagate (e.g. when called without bidId/sheetId).
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Same focus-the-ribbon trick — the workspace-level Enter handler
  // for closing polygons is a window-level keydown listener and
  // Tab-to-reopen is workspace-level too. Focusing the ribbon
  // (a body-scoped target) ensures keystrokes reach those handlers
  // instead of being trapped by some other focused control.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

export async function openDimInputDialog(page: Page): Promise<void> {
  // The Dim Input button lives in the Verify ribbon group. The group
  // is expanded by default on a 1600×1000 viewport, but a previous
  // test run might have persisted a `collapsed[verify]=true` entry to
  // localStorage (the ribbon-shortcuts spec exercises that path), so
  // we MUST check the current state of the tools row before deciding
  // whether to click the toggle. Naively clicking the toggle whenever
  // it's visible would COLLAPSE an already-expanded group and hide
  // the very button we're trying to click.
  const tools = page.getByTestId("ribbon-group-tools-verify");
  if ((await tools.count()) === 0) {
    await page.getByTestId("ribbon-group-toggle-verify").click();
    await expect(tools).toBeVisible({ timeout: 5_000 });
  }
  const dimInputBtn = page.getByTestId("ribbon-tool-dim-input");
  await expect(dimInputBtn).toBeVisible({ timeout: 10_000 });
  await dimInputBtn.click();
  await expect(page.getByTestId("dialog-dim-input")).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Activate a measurement tool from the Measure ribbon group.
 *
 * Accepts any tool id rendered in the ribbon (e.g. `arc`, `area`,
 * `circle`, `segment`, `deduct`, `volume`, `pitched_area`,
 * `surface_area`, `linear`, `dimension`, `lasso`, `select`, `pan`).
 * Most of the chain-mode tools live in the `measure` group; tools
 * that don't (e.g. `select`, `pan`) need the `group` override so the
 * helper looks for the right collapsible row. The actual
 * `aria-pressed=true` assertion catches the case where a click missed
 * its target (e.g. obscured by a popover) before the test races the
 * canvas click that follows.
 */
export async function selectMeasureTool(
  page: Page,
  toolId: string,
  opts: { group?: "measure" | "nav" } = {},
): Promise<void> {
  const group = opts.group ?? "measure";
  const groupTools = page.getByTestId(`ribbon-group-tools-${group}`);
  if ((await groupTools.count()) === 0) {
    await page.getByTestId(`ribbon-group-toggle-${group}`).click();
    await expect(groupTools).toBeVisible({ timeout: 5_000 });
  }
  const btn = page.getByTestId(`ribbon-tool-${toolId}`);
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
}

export async function lockChainLength(
  page: Page,
  lengthFt: number,
): Promise<void> {
  await openDimInputDialog(page);
  const repeatSwitch = page.getByTestId("switch-dim-repeat");
  // Chain switch persists across reloads via localStorage, so it may
  // already be on. Force it to checked.
  if ((await repeatSwitch.getAttribute("data-state")) !== "checked") {
    await repeatSwitch.click();
  }
  await expect(repeatSwitch).toHaveAttribute("data-state", "checked");
  await page.getByTestId("input-dim-length").fill(String(lengthFt));
  // Apply button copy flips to "Chain Length" when chain mode is on —
  // the copy itself is the user-facing confirmation that the toggle
  // wired through.
  const applyBtn = page.getByTestId("button-dim-apply");
  await expect(applyBtn).toContainText("Chain Length");
  await applyBtn.click();
  await expect(page.getByTestId("dialog-dim-input")).toHaveCount(0);

  // Lock chip must immediately render in chained state at the locked
  // length — proves Apply pushed the value into TakeoffWorkspace.
  const chip = page.getByTestId("indicator-dim-lock");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-state", "chained");
  await expect(page.getByTestId("text-dim-lock-length")).toHaveText(
    `${lengthFt.toFixed(2)} ft`,
  );
}

export async function expectChipStillChained(
  page: Page,
  lengthFt: number = LOCKED_LENGTH_FT,
): Promise<void> {
  const chip = page.getByTestId("indicator-dim-lock");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-state", "chained");
  await expect(page.getByTestId("text-dim-lock-length")).toHaveText(
    `${lengthFt.toFixed(2)} ft`,
  );
}

export interface CommitBody {
  sheetId?: string;
  type?: string;
  points?: Array<{ x: number; y: number }>;
  // PATCH /api/takeoff/measurements/:id (deductions update) carries
  // a stringified JSON of `{ points, areaFt2, label }[]` here.
  deductions?: string;
}

/**
 * Resolve the next POST commit to `/api/takeoff/measurements`.
 *
 * Caller registers the listener BEFORE firing the canvas clicks (no
 * `await` here), then `await`s the returned promise AFTER the
 * commit-triggering click. This is the same pattern the LINEAR chain
 * spec uses with `page.waitForRequest(...)` inline.
 */
export function captureNextCommit(page: Page): Promise<CommitBody> {
  return page
    .waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements(\?|$)/.test(req.url()),
      { timeout: 15_000 },
    )
    .then((req) => req.postDataJSON() as CommitBody);
}

/**
 * Resolve the next PATCH update to a specific measurement.
 *
 * The DEDUCT canvas branch persists deduct polygons by PATCHing the
 * host measurement's `deductions` array (not by POSTing a new
 * measurement), so the chain-mode DEDUCT spec uses this instead of
 * `captureNextCommit`. Pass the host measurement's id so the matcher
 * doesn't confuse a generic PATCH (e.g. a label edit on another row)
 * for the deduct write under test.
 */
export function captureNextDeductPatch(
  page: Page,
  measurementId: string,
): Promise<CommitBody> {
  const target = `/api/takeoff/measurements/${measurementId}`;
  return page
    .waitForRequest(
      (req) =>
        req.method() === "PATCH" &&
        req.url().endsWith(target),
      { timeout: 15_000 },
    )
    .then((req) => req.postDataJSON() as CommitBody);
}

export function segmentPx(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Assert every consecutive pair of `points` is `EXPECTED_PX ± PX_TOLERANCE`
 * apart — the contract chain mode enforces on each click after the first.
 *
 * The first click of any draw tool is unconstrained (no anchor for
 * `applyFixedLength`); subsequent clicks are clamped along the
 * anchor→cursor ray to exactly the locked length. So a chain-mode
 * commit's `points[0..N-1]` segments must each equal the locked
 * pixel distance.
 */
export function expectAllSegmentsLocked(
  points: Array<{ x: number; y: number }>,
): void {
  for (let i = 0; i < points.length - 1; i += 1) {
    const dist = segmentPx(points[i], points[i + 1]);
    expect(dist).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
    expect(dist).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
  }
}
