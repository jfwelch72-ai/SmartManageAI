// Task #2269 — End-to-end coverage for the typed-length **chain mode**
// (Repeat / chain switch) on NON-LINEAR draw tools.
//
// The sister spec at `e2e/takeoff-dim-chain-and-tab-reopen.spec.ts`
// (Task #2227) pins down chain behavior end-to-end for the LINEAR tool
// only. The same chain-mode wiring applies to every draw tool that
// resolves a click through `resolvePoint` in
// `client/src/hooks/use-takeoff-interactions.ts` — i.e. any tool whose
// next vertex gets clamped via `applyFixedLength(pt, anchor, lengthPx)`
// when `pendingDimLengthFt > 0`. In this codebase that is:
//
//   - `linear` / `linear_with_drop` / `pitched_linear` / `dimension`
//   - `arc` (3 sequential vertices)
//   - `area` / `polygon` / `volume` / `pitched_area` / `surface_area`
//   - `circle` (2 vertices: center + edge)
//   - `segment` / `deduct`
//
// A regression in any of those branches (e.g. a future refactor that
// moves `applyFixedLength` into the LINEAR-only branch, or that drops
// `dimInputRepeatRef.current` from `onConsumeDimLength` so chain mode
// silently degrades to one-shot mode) would slip through the existing
// LINEAR-only spec. This file covers ARC (3-point curve commit) and
// AREA (multi-vertex polygon commit through `completePolygon` via the
// window-level Enter handler). Task #2301 extends the contract to the
// remaining tools (`circle`, `segment`, `deduct`, `volume`,
// `pitched_area`, `surface_area`) in a sibling spec that reuses the
// shared helpers in `e2e/helpers/dimChain.ts`.
//
// Setup mirrors the LINEAR chain spec exactly: same `dev/test-login`
// flow, same `seed-takeoff-fixture` (sheet pre-calibrated to
// `scalePxPerFoot: 10` per `server/devSeedEnterprise.ts:885`), and the
// same `unified-takeoff-ribbon` + Verify/Measure ribbon-group
// open-then-click choreography. Task #2301 extracted those helpers to
// `e2e/helpers/dimChain.ts` so the sibling specs stay aligned.

import { test, expect, type Locator } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";
import {
  EXPECTED_PX,
  LOCKED_LENGTH_FT,
  PX_TOLERANCE,
  captureNextCommit,
  devLogin,
  expectAllSegmentsLocked,
  expectChipStillChained,
  gotoTakeoff,
  lockChainLength,
  seedTakeoffFixture,
  segmentPx,
  selectMeasureTool,
} from "./helpers/dimChain";

// Wider viewport than Playwright's 1280×720 default so the Verify and
// Measure ribbon groups (which `NARROW_DEFAULT_COLLAPSED_GROUPS` collapses
// at the default size — `UnifiedTakeoffRibbon.tsx:297`) render their
// tool buttons inline. The sister polygon/circle/lasso spec uses the
// same viewport for the same reason.
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff Dim Input — chain mode on ARC + AREA (Task #2269)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("chain mode keeps each AREA polygon vertex locked across two consecutive shapes", async ({
    page,
  }) => {
    // Functional contract: with chain mode on and 12.5 ft locked,
    // every vertex click on the AREA tool must commit at exactly
    // 125 px from the prior vertex (modulo angle-rotation rounding),
    // AND the lock chip must stay `data-state="chained"` across the
    // intra-polygon clicks AND across the boundary between two
    // consecutive polygons. The first vertex of each polygon is
    // unconstrained because `resolvePoint` only invokes
    // `applyFixedLength` when there is an existing `drawingPoints`
    // anchor — so checking that the SECOND polygon's interior
    // segments are also 125 px proves the lock survived the first
    // polygon's `completePolygon` commit (the `Enter` keydown path).
    //
    // Without the chain-mode gate
    // (`if (dimInputRepeatRef.current) return;` in
    // `onConsumeDimLength`), the SECOND vertex of polygon #1 would
    // commit correctly but the THIRD vertex onward would snap to
    // the cursor distance instead of the locked length, and the
    // chip would disappear after the second click.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);

    // Switch to AREA. The "polygon" ribbon entry would also work —
    // both go through `tool === "area"` after `canonicalTool`. We
    // pick "area" explicitly so a future split between the polygon
    // and area branches doesn't quietly pass without us noticing.
    await selectMeasureTool(page, "area");
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ---------- Polygon #1 ----------
    // Four cursor positions whose RESOLVED (post-`applyFixedLength`)
    // vertices stay well outside the close-on-first-vertex threshold
    // (10 px in image space — `use-takeoff-interactions.ts:771-772`).
    // The naive choice of a 200 px square (cursors at the corners of a
    // 200 px box) does NOT work: each clamped segment is only 125 px,
    // so when the path doubles back, the resolved fourth point can
    // land within 10 px of the first depending on rounding. We use a
    // "snake" trajectory that monotonically moves AWAY from the first
    // vertex — every subsequent resolved vertex is provably >
    // EXPECTED_PX from v1, so close-on-first can never accidentally
    // fire and Enter is the only commit path.
    //
    // Off-canvas safety (clicks landing within a few pixels of the
    // canvas's bottom/right edge silently dropping) is enforced by
    // `clickOnCanvas` itself (Task #2302) — if a coordinate lands
    // outside the visible canvas region the helper throws with the
    // resolved point, viewport size, and visible region inline, so
    // there's no need to hand-document a "y ≤ 400" safe box here.
    //
    // Resolved coordinates (computed with `applyFixedLength` projecting
    // each cursor onto the prior anchor's ray at exactly 125 image px):
    //   v1 = (200, 100)            (raw, no anchor)
    //   v2 = (325, 100)            (125 px right of v1)
    //   v3 ≈ (388, 208)            (125 px from v2, mostly downward)
    //   v4 ≈ (507, 245)            (125 px from v3, mostly rightward)
    // |v4 - v1| ≈ 340 px — comfortably outside the 10 px threshold.
    await clickOnCanvas(page, canvas, { x: 200, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 500, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 500, y: 400 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1000, y: 400 });
    await expectChipStillChained(page);

    // Close polygon #1 via Enter — `completePolygon` fires the POST
    // and resets `isDrawing` / `drawingPoints` so the next click
    // starts a fresh polygon.
    const firstPolygonCommit = captureNextCommit(page);
    await page.keyboard.press("Enter");
    const firstBody = await firstPolygonCommit;

    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("AREA");
    expect(Array.isArray(firstBody.points)).toBe(true);
    expect(firstBody.points!.length).toBe(4);

    // Each segment between consecutive committed vertices must be
    // EXPECTED_PX (the locked length). The first→second, second→
    // third, and third→fourth distances all go through
    // `applyFixedLength`. The fourth→first closing edge is NOT
    // length-locked (the polygon close-on-Enter doesn't append the
    // first vertex; `computePolygonAreaInFt2` treats it as implicit),
    // so we only assert the three click-driven segments.
    expectAllSegmentsLocked(firstBody.points!);

    // Chip is STILL chained after the commit — the contract this
    // spec exists to enforce on the AREA branch.
    await expectChipStillChained(page);

    // ---------- Polygon #2 ----------
    // Same snake trajectory shifted right by 200 px so it doesn't
    // overlap polygon #1. The first vertex is unconstrained (no
    // anchor); the next three are each locked to EXPECTED_PX. If a
    // future regression dropped the chain gate from
    // `onConsumeDimLength`, the SECOND polygon's interior segments
    // would snap to cursor distance and this loop would fail.
    // Off-canvas safety is again enforced by `clickOnCanvas` (Task
    // #2302), so the cursor x values are picked purely on the snake
    // trajectory, not as a hand-tuned safe box.
    const secondPolygonCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 500, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 400 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1200, y: 400 });
    await expectChipStillChained(page);
    await page.keyboard.press("Enter");
    const secondBody = await secondPolygonCommit;

    expect(secondBody.sheetId).toBe(sheetIds[0]);
    expect(secondBody.type).toBe("AREA");
    expect(secondBody.points!.length).toBe(4);
    expectAllSegmentsLocked(secondBody.points!);

    // And the chip is STILL chained after BOTH commits.
    await expectChipStillChained(page);
  });

  test("chain mode keeps each ARC's start→middle and middle→end legs locked across two consecutive arcs", async ({
    page,
  }) => {
    // Functional contract: ARC commits as a `LINEAR` measurement
    // with three points (start, middle, end —
    // `use-takeoff-interactions.ts:709-713`). With chain mode on and
    // 12.5 ft locked, the SECOND and THIRD click of each arc are
    // each clamped via `applyFixedLength` to be EXPECTED_PX away
    // from the previous click. So each committed arc's
    // start→middle and middle→end distances must equal the locked
    // length (the chord between the three points doesn't matter).
    //
    // The first click of each arc is unconstrained (no anchor), and
    // the third click commits + resets `drawingPoints`. The
    // start→middle of arc #2 going through `applyFixedLength` only
    // works if `pendingDimLengthFt` survived arc #1's commit — which
    // is precisely what `dimInputRepeatRef.current` gates inside
    // `onConsumeDimLength`. A regression that drops the chain gate
    // would snap arc #2's middle to the raw cursor and trip the
    // length tolerance below.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);

    await selectMeasureTool(page, "arc");
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ---------- Arc #1 ----------
    // Three click positions chosen so the cursor directions are
    // non-collinear (`createArcSegment` returns null for collinear
    // points and the commit aborts —
    // `use-takeoff-interactions.ts:697-703`). Locking to 125 px
    // means the actual committed middle/end points are pulled
    // toward the anchor along the cursor ray, so we deliberately
    // place the cursors well past EXPECTED_PX in distinct directions
    // to keep the resolved triple non-collinear.
    //
    // Cursor x is kept ≥ 300 so the resolved viewport coordinate is
    // safely past the left navigation sidebar — the sidebar overlay
    // sits on top of the Konva stage's full-viewport-width canvas in
    // z-order and silently swallows clicks whose viewport x lands
    // inside its footprint (~200 px wide). The visible-canvas region
    // check in `clickOnCanvas` (Task #2302) only catches points that
    // miss the canvas bounding box itself, not points that hit the
    // canvas-but-are-occluded-by-an-overlay.
    const firstArcCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 300, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 600, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 600, y: 350 });
    const firstBody = await firstArcCommit;

    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("LINEAR");
    expect(Array.isArray(firstBody.points)).toBe(true);
    expect(firstBody.points!.length).toBe(3);
    // start → middle and middle → end are both length-locked.
    {
      const startToMid = segmentPx(firstBody.points![0], firstBody.points![1]);
      const midToEnd = segmentPx(firstBody.points![1], firstBody.points![2]);
      expect(startToMid).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(startToMid).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
      expect(midToEnd).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(midToEnd).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }

    // Chip is STILL chained after the arc commit.
    await expectChipStillChained(page);

    // ---------- Arc #2 ----------
    // A second arc started in a different region of the canvas. The
    // start click is unconstrained; the middle and end clicks are
    // each locked to EXPECTED_PX from the prior point.
    const secondArcCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1100, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1100, y: 350 });
    const secondBody = await secondArcCommit;

    expect(secondBody.sheetId).toBe(sheetIds[0]);
    expect(secondBody.type).toBe("LINEAR");
    expect(secondBody.points!.length).toBe(3);
    {
      const startToMid = segmentPx(
        secondBody.points![0],
        secondBody.points![1],
      );
      const midToEnd = segmentPx(secondBody.points![1], secondBody.points![2]);
      expect(startToMid).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(startToMid).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
      expect(midToEnd).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(midToEnd).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }

    // And the chip is STILL chained after BOTH arc commits.
    await expectChipStillChained(page);
  });
});
