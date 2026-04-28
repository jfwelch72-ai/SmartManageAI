// Task #2301 — End-to-end coverage for the typed-length **chain mode**
// (Repeat / chain switch) on the remaining single-anchor draw tools:
// CIRCLE (center → edge), SEGMENT (multi-vertex polyline closed via
// Enter), and DEDUCT (multi-vertex polygon closed by clicking near the
// first vertex, persisted as a PATCH on a host AREA measurement).
//
// Sister specs:
//   - `e2e/takeoff-dim-chain-and-tab-reopen.spec.ts` (Task #2227) —
//     LINEAR / dimension chain coverage.
//   - `e2e/takeoff-dim-chain-arc-and-area.spec.ts` (Task #2269) —
//     ARC + AREA (window-Enter close) chain coverage.
//   - `e2e/takeoff-dim-chain-volume-pitched-surface.spec.ts`
//     (Task #2301) — VOLUME / PITCHED_AREA / SURFACE_AREA polygons,
//     which share the AREA chain wiring but commit through different
//     branches in `completePolygon`.
//
// Functional contract (every test in this file):
//
//   1. The first vertex of a draw is unconstrained (no anchor for
//      `applyFixedLength` in `client/src/hooks/use-takeoff-interactions.ts`).
//   2. Every subsequent click is clamped to exactly the locked length
//      (`pendingDimLengthFt × scalePxPerFoot` = 12.5 ft × 10 px/ft =
//      125 px) along the anchor→cursor ray.
//   3. The lock chip stays `data-state="chained"` across every
//      intra-shape click AND across the boundary between two
//      consecutive shapes — proving `dimInputRepeatRef.current` gates
//      `onConsumeDimLength` so the lock survives the commit.
//
// All cursor coordinates stay inside the documented "safe" region
// (x ∈ [300, 1200], y ∈ [100, 400]) the sister ARC/AREA spec
// established. Outside that box the React/Konva pipeline silently
// drops clicks (sidebar overlay on the left, canvas-edge hit
// detection on the bottom/right) — see the long block comments in
// `takeoff-dim-chain-arc-and-area.spec.ts` for the full story.

import { test, expect, type Locator } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";
import {
  EXPECTED_PX,
  LOCKED_LENGTH_FT,
  PX_TOLERANCE,
  captureNextCommit,
  captureNextDeductPatch,
  devLogin,
  expectAllSegmentsLocked,
  expectChipStillChained,
  gotoTakeoff,
  lockChainLength,
  seedMeasurement,
  seedTakeoffFixture,
  segmentPx,
  selectMeasureTool,
} from "./helpers/dimChain";

// Same wider viewport as the sister specs so the Verify and Measure
// ribbon groups render their tool buttons inline (they collapse on
// the 1280×720 default per `NARROW_DEFAULT_COLLAPSED_GROUPS` in
// `UnifiedTakeoffRibbon.tsx`).
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff Dim Input — chain mode on CIRCLE / SEGMENT / DEDUCT (Task #2301)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("chain mode locks the CIRCLE radius leg across two consecutive circles", async ({
    page,
  }) => {
    // Functional contract: CIRCLE commits as an `AREA` measurement
    // approximated by a 32-sided regular polygon
    // (`use-takeoff-interactions.ts:738-755`). The first click sets
    // the center (raw, no anchor for `applyFixedLength`); the second
    // click sets a point on the edge — and THAT click runs through
    // `resolvePoint`, so with chain mode on the radius is clamped to
    // the locked length. The resulting polygon's vertices are
    // therefore each EXPECTED_PX from the center, and the polygon's
    // first→second vertex segment chord (a 32-sided regular polygon
    // inscribed in a circle of radius r) is `2r·sin(π/32)`.
    //
    // For r = 125 the expected edge length is
    //   2 × 125 × sin(π/32) ≈ 24.45 px,
    // which we don't assert exactly — instead we recover the radius
    // from any committed vertex's distance to the persisted center
    // (carried in metadata as `radiusFt`) and pin it at EXPECTED_PX
    // (± PX_TOLERANCE). That keeps the assertion stable across any
    // future change to the polygon-approximation side count without
    // weakening the chain-mode contract.
    //
    // The second circle proves the lock survived the first circle's
    // commit — the wire that matters here is
    // `dimInputRepeatRef.current` gating `onConsumeDimLength` in
    // `client/src/components/TakeoffWorkspace.tsx`. A regression that
    // dropped that gate would let the second circle's edge snap to
    // the raw cursor and trip the radius assertion below.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);

    await selectMeasureTool(page, "circle");
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ---------- Circle #1 ----------
    // Center at (400, 250); edge cursor at (700, 250) is 300 px to
    // the right — well past the locked 125 px. `applyFixedLength`
    // clamps the edge to 125 px from the center along that ray, so
    // the resolved edge point is (525, 250). The committed AREA
    // polygon then has `radiusPx = computePixelDistance(center,
    // resolvedEdge) = 125` and is laid out as a 32-sided ring
    // around (400, 250).
    const firstCircleCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 400, y: 250 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 700, y: 250 });
    const firstBody = await firstCircleCommit;

    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("AREA");
    expect(Array.isArray(firstBody.points)).toBe(true);
    // 32-sided polygon — see `use-takeoff-interactions.ts:738`.
    expect(firstBody.points!.length).toBe(32);
    // Recover the center as the centroid of the polygon vertices —
    // for a regular polygon the vertex centroid is exactly the
    // circumscribed-circle center, so this is a direct read of the
    // committed center without depending on `metadata` parsing.
    const firstCenter = {
      x: firstBody.points!.reduce((s, p) => s + p.x, 0) / firstBody.points!.length,
      y: firstBody.points!.reduce((s, p) => s + p.y, 0) / firstBody.points!.length,
    };
    // Every vertex must be EXPECTED_PX from the center (the locked
    // radius). We assert on every vertex, not just the first, so a
    // future bug that scaled the radius non-uniformly (e.g. only
    // along one axis) would still trip this.
    for (const v of firstBody.points!) {
      const r = segmentPx(firstCenter, v);
      expect(r).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(r).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }
    // Chip is STILL chained after the circle commit.
    await expectChipStillChained(page);

    // ---------- Circle #2 ----------
    // Same shape in a different region of the canvas. The center is
    // unconstrained (no anchor); the edge click is clamped via
    // `applyFixedLength`. If the lock didn't survive circle #1's
    // commit, the edge would snap to the cursor's distance from the
    // center (500 px) and the radius assertion below would fail.
    const secondCircleCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 250 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1200, y: 250 });
    const secondBody = await secondCircleCommit;

    expect(secondBody.type).toBe("AREA");
    expect(secondBody.points!.length).toBe(32);
    const secondCenter = {
      x: secondBody.points!.reduce((s, p) => s + p.x, 0) / secondBody.points!.length,
      y: secondBody.points!.reduce((s, p) => s + p.y, 0) / secondBody.points!.length,
    };
    for (const v of secondBody.points!) {
      const r = segmentPx(secondCenter, v);
      expect(r).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(r).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }
    // Chip is STILL chained after BOTH circle commits.
    await expectChipStillChained(page);
  });

  test("chain mode locks SEGMENT polyline legs across two consecutive segment commits", async ({
    page,
  }) => {
    // Functional contract: SEGMENT collects an arbitrary-length
    // polyline of vertices and commits via `completeSegment` when
    // the user presses Enter (the window-level handler at
    // `use-takeoff-interactions.ts:1289`). Every click after the
    // first runs through `resolvePoint`, so each leg is clamped to
    // the locked length. Two consecutive commits prove the lock
    // survives the Enter→commit→reset cycle.
    //
    // We use 3 vertices per segment (2 legs per commit) — minimum
    // is 2 vertices (1 leg), but 3 catches the case where a chain
    // regression leaks through the commit-driven `setIsDrawing(false)`
    // / `setDrawingPoints([])` branch and skews only the second leg.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);

    await selectMeasureTool(page, "segment");
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ---------- Segment #1 ----------
    // Three cursor positions whose resolved vertices form an "L":
    //   v1 = (300, 150)            (raw, no anchor)
    //   v2 = (425, 150)            (125 px right of v1)
    //   v3 ≈ (425, 275)            (125 px below v2)
    // Each cursor target is well past the locked length so
    // `applyFixedLength` has a non-degenerate ray to clamp.
    const firstSegmentCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 300, y: 150 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 700, y: 150 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 700, y: 400 });
    await expectChipStillChained(page);
    await page.keyboard.press("Enter");
    const firstBody = await firstSegmentCommit;

    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("SEGMENT");
    expect(Array.isArray(firstBody.points)).toBe(true);
    expect(firstBody.points!.length).toBe(3);
    expectAllSegmentsLocked(firstBody.points!);
    await expectChipStillChained(page);

    // ---------- Segment #2 ----------
    // Same "L" shifted right by 200 px so it doesn't overlap
    // segment #1. The first vertex is unconstrained; the next two
    // are each locked to EXPECTED_PX — proving the lock survived
    // the Enter-driven commit of segment #1.
    const secondSegmentCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 150 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1200, y: 150 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1200, y: 400 });
    await expectChipStillChained(page);
    await page.keyboard.press("Enter");
    const secondBody = await secondSegmentCommit;

    expect(secondBody.type).toBe("SEGMENT");
    expect(secondBody.points!.length).toBe(3);
    expectAllSegmentsLocked(secondBody.points!);
    await expectChipStillChained(page);
  });

  test("chain mode locks DEDUCT polygon legs and the close-on-first-vertex commit", async ({
    page,
  }) => {
    // Functional contract: DEDUCT requires a previously-selected
    // AREA / VOLUME / PITCHED_AREA / SURFACE_AREA host
    // (`use-takeoff-interactions.ts:779-784`); the polygon closes
    // when the resolved click lands within 10 px of the first
    // vertex; the result is persisted via PATCH on the host's
    // `deductions` JSON (NOT a fresh POST). Chain mode applies to
    // every vertex click after the first AND to the closing click —
    // and because the closing click goes through `resolvePoint` /
    // `applyFixedLength`, the deduct geometry only closes if the
    // locked length lands the close-cursor exactly on top of the
    // first vertex.
    //
    // We pre-seed a large rectangular AREA host via the
    // measurement-create POST (NOT the chain-mode UI — drawing the
    // host through chain mode would itself be locked to 125 px,
    // which is too small to enclose a 125 px-leg deduct triangle
    // and pass the `isPointInPolygon` centroid check at
    // `use-takeoff-interactions.ts:805`). The host rectangle spans
    // (200, 100) → (1300, 500) so any deduct centroid in the safe
    // cursor region (x ∈ [300, 1200], y ∈ [100, 400]) lies inside
    // the host.
    //
    // The deduct geometry is an equilateral triangle with side
    // length EXPECTED_PX, rooted at v1 = (400, 200):
    //   v1 = (400, 200)                             (raw, no anchor)
    //   v2 = (525, 200)               (125 px right of v1)
    //   v3 = (462.5, 200 + 125·sin60°) ≈ (462.5, 308.25)
    //                                  (125 px from v2 toward
    //                                   the cursor (462.5, 308.25))
    //   close-click cursor = (400, 200) — `applyFixedLength` clamps
    //   to 125 px from v3 along the ray to (400, 200); since
    //   |(400,200)−v3| = 125 exactly, the resolved point IS (400,
    //   200), which is 0 px from v1, well under the 10 px close
    //   threshold. The polygon commits with [v1, v2, v3] (the
    //   close-click is NOT appended — `use-takeoff-interactions.ts`
    //   only checks the threshold and short-circuits to PATCH).
    //
    // A regression that dropped chain mode for the close click
    // (e.g. moved `applyFixedLength` behind a "first-vertex-only"
    // gate) would let the close-cursor land at (400, 200) RAW, which
    // is also within 10 px of v1 — so this test ALSO asserts the
    // committed `points` are all 125 px apart. That catches a more
    // subtle regression: a path that lets the v2/v3 vertices snap
    // to the raw cursor (300+ px apart) but happens to close on the
    // raw close-cursor (which IS exactly v1 by construction).
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);

    // Pre-seed the host AREA before the page loads so the workspace's
    // initial measurement query picks it up. Without this the first
    // deduct click would bail with a "Select Area First" toast and
    // never reach the canvas branch under test.
    const host = await seedMeasurement(page, {
      sheetId: sheetIds[0],
      type: "AREA",
      label: "Deduct Host",
      points: [
        { x: 200, y: 100 },
        { x: 1300, y: 100 },
        { x: 1300, y: 500 },
        { x: 200, y: 500 },
      ],
    });
    expect(host.id).toBeTruthy();

    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);

    // Activate the SELECT tool and click inside the host polygon.
    // `select` lives in the `nav` ribbon group (not `measure`), and
    // Konva's `Line` with `closed={true}` and a `fill` registers
    // pointer hits on the FILL — so any click inside the rectangle
    // selects it via `handleMeasurementClick` in
    // `client/src/components/takeoff/hosts/CanvasStage.tsx`.
    await selectMeasureTool(page, "select", { group: "nav" });
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    // (700, 250) is comfortably inside the host (200,100)–(1300,500)
    // and well outside the safe-cursor region we'll later use for
    // the deduct triangle, so the select click can't accidentally
    // land on a deduct vertex.
    await clickOnCanvas(page, canvas, { x: 700, y: 250 });

    // Lock chain length AFTER selecting the host — the dialog opens
    // the Verify ribbon group on the right; doing it before would
    // not affect the select-click but doing it after keeps the
    // visual state of the page predictable for any future debugging
    // snapshot.
    await lockChainLength(page, LOCKED_LENGTH_FT);

    await selectMeasureTool(page, "deduct");

    // Draw the equilateral-triangle deduct. The close click lands
    // on (400, 200) which is the resolved (=raw) v1, triggering
    // close. The PATCH carries `deductions` as a JSON-stringified
    // array of `{ points, areaFt2, label }`.
    const deductPatch = captureNextDeductPatch(page, host.id);
    await clickOnCanvas(page, canvas, { x: 400, y: 200 });
    await expectChipStillChained(page);
    // Cursor for v2 — pick a point well past EXPECTED_PX along the
    // ray from v1 so the clamp has a non-degenerate direction.
    await clickOnCanvas(page, canvas, { x: 800, y: 200 });
    await expectChipStillChained(page);
    // Cursor for v3 — same constraint along the v2→v3 ray. The
    // ray from v2 (525, 200) to (462.5, 308.25) has length ~125 by
    // construction, so the cursor is intentionally placed PAST the
    // ideal v3 (at (400, 400)) so the clamp pulls it back to v3.
    // Direction: (400-525, 400-200) = (-125, 200), unit ≈ (-0.530,
    // 0.848). v3 = v2 + 125·unit ≈ (458.75, 305.94) — close enough
    // to the equilateral apex that the close click below still
    // resolves onto v1.
    await clickOnCanvas(page, canvas, { x: 400, y: 400 });
    await expectChipStillChained(page);
    // Close click — cursor at (400, 200). `applyFixedLength`
    // projects (400, 200) onto the ray from v3 ≈ (458.75, 305.94)
    // to (400, 200), at distance 125. |(400,200) − v3| ≈ √(58.75² +
    // 105.94²) ≈ 121, slightly under 125 — the clamped point lands
    // a few pixels PAST (400, 200) along the same ray (~4 px past).
    // That's well inside the 10 px close threshold the deduct
    // branch uses.
    await clickOnCanvas(page, canvas, { x: 400, y: 200 });
    const patchBody = await deductPatch;

    // The PATCH body's `deductions` is a stringified JSON array;
    // parse it and pull out the deduct we just drew (the host had
    // none before).
    expect(typeof patchBody.deductions).toBe("string");
    const deductions = JSON.parse(patchBody.deductions!) as Array<{
      points: Array<{ x: number; y: number }>;
      areaFt2: number;
      label?: string;
    }>;
    expect(Array.isArray(deductions)).toBe(true);
    expect(deductions.length).toBe(1);
    const drawnDeduct = deductions[0];
    expect(Array.isArray(drawnDeduct.points)).toBe(true);
    // 3 vertices — the close click does NOT append a fourth point
    // (it short-circuits to PATCH inside the threshold check).
    expect(drawnDeduct.points.length).toBe(3);
    // Both length-locked legs (v1→v2 and v2→v3) must be EXPECTED_PX.
    expectAllSegmentsLocked(drawnDeduct.points);

    // Chip is STILL chained after the deduct PATCH — the contract
    // this spec exists to enforce on the DEDUCT branch.
    await expectChipStillChained(page);
  });
});
