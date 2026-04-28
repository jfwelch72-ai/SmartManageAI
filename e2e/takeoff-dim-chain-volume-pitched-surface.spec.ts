// Task #2301 — End-to-end coverage for the typed-length **chain mode**
// (Repeat / chain switch) on the AREA-branch sibling tools VOLUME,
// PITCHED_AREA, and SURFACE_AREA.
//
// Sister specs (every chain-mode spec follows the same pattern; see
// `e2e/helpers/dimChain.ts` for the shared boilerplate):
//   - `e2e/takeoff-dim-chain-and-tab-reopen.spec.ts` (Task #2227) —
//     LINEAR / dimension chain coverage.
//   - `e2e/takeoff-dim-chain-arc-and-area.spec.ts` (Task #2269) —
//     ARC + AREA chain coverage.
//   - `e2e/takeoff-dim-chain-circle-segment-deduct.spec.ts`
//     (Task #2301) — single-anchor (CIRCLE) and one-shot polyline /
//     polygon (SEGMENT, DEDUCT) chain coverage.
//
// Functional contract: VOLUME, PITCHED_AREA, and SURFACE_AREA share
// the same canvas branch as AREA in
// `client/src/hooks/use-takeoff-interactions.ts:761` —
//   `tool === "area" || tool === "volume" || tool === "pitched_area" || tool === "surface_area"`
// — so chain-mode behavior is identical for all four. They diverge
// in `completePolygon` (`use-takeoff-interactions.ts:483-538`), which
// dispatches a different `createMeasurementMutation` payload per
// canonical tool (`AREA` / `VOLUME` / `PITCHED_AREA` / `SURFACE_AREA`).
// This file pins each of the three non-AREA branches to the same
// chain-mode contract the AREA spec already enforces:
//
//   1. The first vertex is unconstrained; every subsequent vertex
//      click is clamped to EXPECTED_PX from the prior vertex.
//   2. The lock chip stays `data-state="chained"` across every
//      click AND across the Enter-driven `completePolygon` commit.
//   3. The committed measurement carries the canonical `type`
//      (`VOLUME` / `PITCHED_AREA` / `SURFACE_AREA`) — proving the
//      `completePolygon` dispatch survived the chain wiring without
//      collapsing back into the AREA branch.
//
// Cursor coordinates stay inside the documented "safe" canvas region
// (x ∈ [300, 1200], y ∈ [100, 400]) per the sister ARC/AREA spec.

import { test, expect, type Locator, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";
import {
  LOCKED_LENGTH_FT,
  captureNextCommit,
  devLogin,
  expectAllSegmentsLocked,
  expectChipStillChained,
  gotoTakeoff,
  lockChainLength,
  seedTakeoffFixture,
  selectMeasureTool,
} from "./helpers/dimChain";

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

/**
 * Run the shared "draw a 4-vertex snake polygon under chain mode and
 * commit via Enter" choreography. Returns the canvas locator for any
 * spec that wants to keep poking the canvas after the commit.
 *
 * The cursor box mirrors the sister AREA spec's polygon #1 exactly —
 * every cursor target sits in the safe canvas region (x ∈ [300, 1200],
 * y ∈ [100, 400]), and the snake trajectory monotonically moves AWAY
 * from the first vertex so the `< 10 px` close-on-first guard at
 * `use-takeoff-interactions.ts:771-772` never accidentally fires
 * before Enter does.
 */
async function drawChainPolygon(
  page: Page,
  toolId: "volume" | "pitched_area" | "surface_area",
  expectedType: "VOLUME" | "PITCHED_AREA" | "SURFACE_AREA",
  sheetId: string,
): Promise<Locator> {
  await selectMeasureTool(page, toolId);
  const canvas: Locator = page.locator(".konvajs-content canvas").first();
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // Same snake trajectory as `takeoff-dim-chain-arc-and-area.spec.ts`:
  //   v1 = (200, 100)            (raw)
  //   v2 = (325, 100)            (125 px right of v1)
  //   v3 ≈ (388, 208)            (125 px from v2, mostly downward)
  //   v4 ≈ (507, 245)            (125 px from v3, mostly rightward)
  // Cursor x kept ≤ 1000 so the resolved viewport coordinate stays
  // safely inside the canvas's right edge (the 1600-px viewport's
  // canvas extends to ~1300 px wide; clicks past ~1200 risk the
  // off-canvas silent-drop pitfall called out in the sister spec).
  const commit = captureNextCommit(page);
  await clickOnCanvas(page, canvas, { x: 200, y: 100 });
  await expectChipStillChained(page);
  await clickOnCanvas(page, canvas, { x: 500, y: 100 });
  await expectChipStillChained(page);
  await clickOnCanvas(page, canvas, { x: 500, y: 400 });
  await expectChipStillChained(page);
  await clickOnCanvas(page, canvas, { x: 1000, y: 400 });
  await expectChipStillChained(page);
  await page.keyboard.press("Enter");
  const body = await commit;

  expect(body.sheetId).toBe(sheetId);
  expect(body.type).toBe(expectedType);
  expect(Array.isArray(body.points)).toBe(true);
  expect(body.points!.length).toBe(4);
  // Every click-driven leg must be at the locked length. The
  // closing edge (v4 → v1) is implicit and NOT length-locked, so
  // we only assert the three click-driven segments via the helper.
  expectAllSegmentsLocked(body.points!);

  // Chip MUST still be chained after the polygon commit — the
  // contract this spec exists to enforce on the non-AREA polygon
  // branches.
  await expectChipStillChained(page);

  return canvas;
}

test.describe("Takeoff Dim Input — chain mode on VOLUME / PITCHED_AREA / SURFACE_AREA (Task #2301)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("chain mode locks every VOLUME polygon vertex through Enter-driven commit", async ({
    page,
  }) => {
    // VOLUME canonicalizes through `completePolygon`'s
    // `completeTool === "volume"` branch, which passes a default
    // 12-inch depth and dispatches `type: "VOLUME"`. The chain
    // wiring is the same as AREA (same `tool === ...` guard at
    // `use-takeoff-interactions.ts:761`), so the same contract
    // applies: each click after the first is clamped to EXPECTED_PX,
    // the chip stays chained across the Enter commit, and the
    // committed type is `VOLUME` (not `AREA`).
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);
    await drawChainPolygon(page, "volume", "VOLUME", sheetIds[0]);
  });

  test("chain mode locks every PITCHED_AREA polygon vertex through Enter-driven commit", async ({
    page,
  }) => {
    // PITCHED_AREA canonicalizes through `completePolygon`'s
    // `completeTool === "pitched_area"` branch, which dispatches
    // `type: "PITCHED_AREA"` and computes a pitched area via
    // `computePitchedAreaFt2`. The chain wiring is identical to
    // AREA so the same vertex-locking contract applies.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);
    await drawChainPolygon(page, "pitched_area", "PITCHED_AREA", sheetIds[0]);
  });

  test("chain mode locks every SURFACE_AREA polygon vertex through Enter-driven commit", async ({
    page,
  }) => {
    // SURFACE_AREA canonicalizes through `completePolygon`'s
    // `completeTool === "surface_area"` branch, which dispatches
    // `type: "SURFACE_AREA"` and computes a pitched surface via
    // `computePitchedAreaFt2`. Same chain contract as AREA.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);
    await drawChainPolygon(page, "surface_area", "SURFACE_AREA", sheetIds[0]);
  });
});
