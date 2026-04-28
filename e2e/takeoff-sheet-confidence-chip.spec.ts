// Task #2346 — End-to-end coverage for the sheet header's
// `data-testid="badge-calibration-status"` confidence chip introduced
// in Task #2332. Today, only `computeSheetCalibrationConfidence` has
// unit coverage (`sheetCalibrationConfidence.test.ts`); the rendered
// chip — its color, tooltip, drift warning, and click-to-calibrate
// hand-off — is verified by hand. This spec seeds sheets in each of
// the four states (HIGH / MEDIUM / LOW / UNVERIFIED) plus the
// drift-demotion path, and asserts the chip matches the rule matrix
// the helper defines. It also verifies that clicking the chip opens
// the same `InlineCalibrationDrawer` (`activeTool === "calibrate"`)
// that the `T` shortcut and bottom-bar chip use, so the header entry
// point doesn't quietly stop routing through the shared flow.

import { test, expect, type Page } from "@playwright/test";
import { installCsrf, authedRequest } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
}

async function seedFixture(page: Page, sheetCount = 1): Promise<TakeoffFixture> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    {
      // measurementCount: 0 keeps `scaleAtCaptureLabel` snapshots out of
      // the picture for the basic state-matrix tests — the seed inserts
      // measurements directly with NULL provenance, which is fine for
      // drift-free runs but not what we need when we want a captured
      // label to disagree with the sheet (the drift test seeds via the
      // POST route below for that reason).
      data: { sheetCount, versionCount: 1, measurementCount: 0 },
    },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

interface CalibrationPatch {
  scalePxPerFoot?: number;
  scaleLabel?: string | null;
  scaleSource: string;
  scaleConfidence: string;
}

async function patchSheetCalibration(
  page: Page,
  sheetId: string,
  body: CalibrationPatch,
): Promise<void> {
  const res = await authedRequest(
    page,
    "PATCH",
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
    {
      data: {
        // Default scalePxPerFoot to 10 (matches the seed) so the chip
        // doesn't fall through the `scalePxPerFoot == null → UNVERIFIED`
        // early return inside the helper.
        scalePxPerFoot: 10,
        units: "ft",
        ...body,
      },
    },
  );
  expect(res.status()).toBe(200);
}

/**
 * Workspace bootstrap: pin `selectedSheet` + `open-tabs` in
 * sessionStorage BEFORE navigation so the workspace selects the
 * target sheet on first mount. Without this the workspace would
 * default to whichever sheet the auto-selection logic prefers (which
 * isn't stable across this test's sheet ordering) and the chip we
 * assert on could belong to a different sheet than the one we PATCHed.
 */
async function pinSelectedSheet(
  page: Page,
  bidId: string,
  sheetId: string,
): Promise<void> {
  await page.addInitScript(
    ({ bidId: b, sheetId: s }: { bidId: string; sheetId: string }) => {
      try {
        window.sessionStorage.setItem(`takeoff-sheet-${b}`, s);
        window.sessionStorage.setItem(
          `takeoff-sheet-${b}-open-tabs`,
          JSON.stringify([s]),
        );
      } catch {
        /* noop */
      }
    },
    { bidId, sheetId },
  );
}

async function gotoTakeoff(page: Page, bidCode: string): Promise<void> {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // The chip lives in the sheet header, so wait for the sheet
  // selector to mount before asserting on it.
  await expect(page.getByTestId("badge-calibration-status")).toBeVisible({
    timeout: 15_000,
  });
}

interface ExpectedChip {
  level: "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";
  label: string;
  /** Tailwind class fragment that uniquely identifies the dot color. */
  dotClass: string;
  /** Substring expected in the tooltip body / aria-label `sourceText`. */
  sourceText: string;
}

const RULE_MATRIX: Array<{
  name: string;
  patch: CalibrationPatch;
  expected: ExpectedChip;
}> = [
  {
    name: "HIGH (USER_TWO_POINT + server HIGH)",
    patch: {
      scaleSource: "USER_TWO_POINT",
      scaleConfidence: "HIGH",
      scaleLabel: '1/8" = 1\'-0"',
    },
    expected: {
      level: "HIGH",
      label: "High",
      dotClass: "bg-green-500",
      sourceText: "Calibrated by you (two-point ruler)",
    },
  },
  {
    name: "MEDIUM (AI_DETECTED + server MEDIUM)",
    patch: {
      scaleSource: "AI_DETECTED",
      scaleConfidence: "MEDIUM",
      scaleLabel: '1/4" = 1\'-0"',
    },
    expected: {
      level: "MEDIUM",
      label: "Medium",
      dotClass: "bg-amber-500",
      sourceText: "Auto-detected from sheet",
    },
  },
  {
    name: "LOW (INHERITED_FROM_PARENT + server LOW)",
    patch: {
      scaleSource: "INHERITED_FROM_PARENT",
      scaleConfidence: "LOW",
      scaleLabel: '3/8" = 1\'-0"',
    },
    expected: {
      level: "LOW",
      label: "Low",
      dotClass: "bg-orange-500",
      sourceText: "Inherited from previous revision",
    },
  },
  {
    name: "UNVERIFIED (server downgraded after supersede)",
    patch: {
      scaleSource: "UNVERIFIED",
      scaleConfidence: "UNVERIFIED",
      scaleLabel: null,
    },
    expected: {
      level: "UNVERIFIED",
      label: "Unverified",
      dotClass: "bg-red-500",
      sourceText: "Scale not yet verified",
    },
  },
];

test.describe("Task #2346 — Sheet calibration confidence chip", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  for (const { name, patch, expected } of RULE_MATRIX) {
    test(`renders the ${name} chip with the matching color, label, and tooltip`, async ({
      page,
    }) => {
      const fixture = await seedFixture(page, 1);
      const sheetId = fixture.sheetIds[0];
      await patchSheetCalibration(page, sheetId, patch);
      await pinSelectedSheet(page, fixture.bid.id, sheetId);

      await gotoTakeoff(page, fixture.bid.code);

      const chip = page.getByTestId("badge-calibration-status");
      // The `data-confidence` attribute is the canonical, render-stable
      // signal of which level the helper landed on — the dot/chip
      // Tailwind classes below are only color hints derived from it.
      await expect(chip).toHaveAttribute("data-confidence", expected.level);

      // The aria-label always includes the human label + source text,
      // even on viewports below `sm` where the visible text is hidden,
      // so it's the most viewport-independent way to assert content.
      const ariaLabel = await chip.getAttribute("aria-label");
      expect(ariaLabel).toContain(`Scale confidence: ${expected.label}.`);
      expect(ariaLabel).toContain(expected.sourceText);
      // No drift on this row — make sure the helper didn't accidentally
      // append the drift sentence (which would mean the chip got
      // demoted off the expected level).
      expect(ariaLabel).not.toContain("Captured scale labels disagree");

      // The dot's color is the at-a-glance signal estimators triage
      // against — confirm the level-specific Tailwind class is present.
      const dot = chip.getByTestId("dot-scale-confidence");
      await expect(dot).toHaveClass(new RegExp(expected.dotClass));

      // Drift icon must NOT be in the chip when the helper reports
      // hasDrift=false.
      await expect(chip.getByTestId("icon-scale-drift")).toHaveCount(0);

      // Tooltip body — hover the chip and assert the shared rationale
      // text the helper produced ends up in the floating tooltip.
      // Radix renders the tooltip content in a Portal AND keeps a
      // hidden duplicate inside the trigger subtree for SSR/a11y, so
      // the test id resolves to two nodes — assert against the
      // visible portal copy via `.first()`.
      await chip.hover();
      const tooltip = page
        .getByTestId("text-scale-confidence-tooltip")
        .first();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(expected.sourceText);
      await expect(tooltip).toContainText("Click to open the calibration tool");
    });
  }

  test("drift demotion downgrades HIGH → MEDIUM and renders the warning icon + label list", async ({
    page,
  }) => {
    // Drift is the single most actionable indicator on the chip — it
    // means measurements on this sheet were captured against a
    // different `scaleLabel` than the sheet now reads, so quantities
    // computed before the recalibration may be wrong. The helper
    // demotes the level by one notch AND sets `hasDrift=true`, so the
    // chip should:
    //   - data-confidence=MEDIUM (one notch below the HIGH base)
    //   - icon-scale-drift visible
    //   - aria-label / tooltip mention the drift labels
    const fixture = await seedFixture(page, 1);
    const sheetId = fixture.sheetIds[0];

    // 1) PATCH the sheet to label "A" so the next measurement insert
    //    auto-stamps `scaleAtCaptureLabel="A"` from the sheet.
    await patchSheetCalibration(page, sheetId, {
      scaleSource: "USER_TWO_POINT",
      scaleConfidence: "HIGH",
      scaleLabel: '1/8" = 1\'-0"',
    });

    // 2) Create a measurement against the sheet via the public POST
    //    route. `applyProvenanceForInsert` on the server stamps
    //    scaleAtCaptureLabel from the sheet's current scaleLabel,
    //    locking in label "A" for this measurement forever.
    const meas = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "LINEAR",
          label: "PW Drift Probe",
          color: "#3b82f6",
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 100 },
          ],
        },
      },
    );
    expect(meas.status()).toBe(201);

    // 3) PATCH the sheet to label "B" — now the captured label "A"
    //    disagrees with the sheet's current label, which is exactly
    //    the drift case the helper demotes.
    await patchSheetCalibration(page, sheetId, {
      scaleSource: "USER_TWO_POINT",
      scaleConfidence: "HIGH",
      scaleLabel: '1/4" = 1\'-0"',
    });

    await pinSelectedSheet(page, fixture.bid.id, sheetId);
    await gotoTakeoff(page, fixture.bid.code);

    const chip = page.getByTestId("badge-calibration-status");
    // HIGH base, no measurement-count change, drift -> demoted to MEDIUM.
    await expect(chip).toHaveAttribute("data-confidence", "MEDIUM");

    // The drift warning icon must be present inside the chip.
    await expect(chip.getByTestId("icon-scale-drift")).toBeVisible();

    // aria-label must include the drift sentence so screen readers see
    // why the chip is demoted.
    const ariaLabel = await chip.getAttribute("aria-label");
    expect(ariaLabel).toContain("Scale confidence: Medium.");
    expect(ariaLabel).toContain(
      "Captured scale labels disagree with the sheet's current label.",
    );

    // Tooltip must enumerate the captured label that disagrees so the
    // estimator knows which measurements to revisit. Use `.first()`
    // for the same Radix portal+inline duplicate reason the matrix
    // tests above call out.
    await chip.hover();
    const tooltip = page
      .getByTestId("text-scale-confidence-tooltip")
      .first();
    await expect(tooltip).toBeVisible();
    // The drift sentence reads:
    //   Some measurements were captured at "<captured>" but the sheet
    //   now reads "<current>".
    // We assert on both label fragments so a regression that swaps
    // captured/current — or drops the drift sentence entirely —
    // surfaces immediately.
    await expect(tooltip).toContainText('Some measurements were captured at');
    await expect(tooltip).toContainText(`1/8" = 1'-0"`);
    await expect(tooltip).toContainText(`1/4" = 1'-0"`);
  });

  test("clicking the chip opens the inline calibration drawer (activeTool === 'calibrate')", async ({
    page,
  }) => {
    // The chip is the header entry point into the same calibration
    // flow the `T` shortcut and bottom-bar chip drive. A regression
    // that swaps the click handler for a no-op or routes it through
    // PlanScaleModal would silently break the only on-canvas way to
    // recover from a LOW/UNVERIFIED chip. We assert (a) the drawer
    // mounts AND (b) the drawer is in the `first reference point`
    // step — the step text only appears once `openCalibrationDrawer`
    // has reset `calibrationMode` to "first-point" and flipped
    // `activeTool` to "calibrate" (no other code path produces both).
    const fixture = await seedFixture(page, 1);
    const sheetId = fixture.sheetIds[0];
    await patchSheetCalibration(page, sheetId, {
      scaleSource: "AI_DETECTED",
      scaleConfidence: "MEDIUM",
      scaleLabel: '1/4" = 1\'-0"',
    });
    await pinSelectedSheet(page, fixture.bid.id, sheetId);

    await gotoTakeoff(page, fixture.bid.code);

    // Drawer must NOT already be open before the click — otherwise the
    // assertion below would pass even if the click did nothing.
    await expect(
      page.getByTestId("inline-calibration-drawer"),
    ).toHaveCount(0);

    await page.getByTestId("badge-calibration-status").click();

    await expect(
      page.getByTestId("inline-calibration-drawer"),
    ).toBeVisible();
    // The drawer's step text reads "first reference point" only after
    // openCalibrationDrawer() ran — which also sets activeTool to
    // "calibrate" (see TakeoffWorkspace.tsx → openCalibrationDrawer).
    await expect(page.getByTestId("inline-calibration-step")).toContainText(
      "first reference point",
    );
  });
});
