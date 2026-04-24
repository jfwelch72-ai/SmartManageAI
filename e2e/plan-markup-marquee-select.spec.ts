/**
 * Task #1738 — End-to-end browser coverage for the lasso/marquee
 * selection gesture on plan markups.
 *
 * Drives a real browser through the full path that unit tests cannot
 * cover:
 *
 *   sign in → open Plans tab with seeded markups → SELECT mode →
 *   drag a marquee box across multiple markups → all intersecting
 *   markups become selected → plain-click on empty canvas clears it →
 *   a tighter marquee selects only the markups it actually crosses
 *
 * The Shift+marquee extension path is exhaustively covered by the
 * `PlanMarkupLayer.marquee.test.tsx` unit suite — driving Shift via
 * Playwright's keyboard API on top of Konva's pointer events is
 * flakey across browsers, so the modifier branch lives in the unit
 * tier where it can stay deterministic.
 *
 * Mirrors the seeding strategy used by `plan-markup-group-drag.spec.ts`
 * (HIGHLIGHT markups via the API, stubbed PDF stream) so the marquee
 * gesture runs against deterministic positions rather than whatever
 * happens to live on a shared dev document.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { authedRequest, getCsrfHeader, installCsrf } from "./helpers/csrf";
import { getMinimalPdf, uploadFixturePdf } from "./helpers/uploadFixturePdf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
}

interface PlanDocumentResponse {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
}

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  text?: string | null;
  layerId?: string | null;
  groupId?: string | null;
}

const PDF_LABEL = "Marquee-select E2E";

async function stubPlanStream(page: Page) {
  const buf = await getMinimalPdf(PDF_LABEL);
  await page.route(
    /\/api\/projects\/[^/]+\/documents\/[^/]+\/stream$/,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "Cache-Control": "no-cache" },
        body: buf,
      });
    },
  );
}

async function devLogin(page: Page, role: string) {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function createProject(
  page: Page,
  suffix: string | number,
): Promise<ProjectResponse> {
  const r = await authedRequest(page, "POST", `${BASE_URL}/api/projects`, {
    data: {
      name: `PW Marquee ${suffix}`,
      clientName: "PW Marquee Client",
      status: "PLANNING",
    },
  });
  if (r.status() !== 201) {
    throw new Error(`Project create failed (${r.status()}): ${await r.text()}`);
  }
  return (await r.json()) as ProjectResponse;
}

async function createPlanDocument(
  page: Page,
  projectId: string,
  suffix: string | number,
): Promise<PlanDocumentResponse> {
  const { objectKey } = await uploadFixturePdf(page, {
    baseUrl: BASE_URL,
    label: PDF_LABEL,
  });
  const r = await authedRequest(page, "POST", `${BASE_URL}/api/documents`, {
    data: {
      projectId,
      type: "PLANS",
      title: `PW Marquee Plan ${suffix}`,
      fileName: `pw-marquee-${suffix}.pdf`,
      fileUrl: objectKey,
      mimeType: "application/pdf",
    },
  });
  if (r.status() !== 201) {
    throw new Error(
      `Plan document create failed (${r.status()}): ${await r.text()}`,
    );
  }
  return (await r.json()) as PlanDocumentResponse;
}

async function createMarkup(
  page: Page,
  documentId: string,
  body: {
    pageNumber: number;
    tool: string;
    points: Array<{ x: number; y: number }>;
    color: string;
    thickness: number;
  },
): Promise<MarkupResponse> {
  const r = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/plan-documents/${documentId}/markups`,
    { data: body },
  );
  if (r.status() !== 201) {
    throw new Error(`Markup create failed (${r.status()}): ${await r.text()}`);
  }
  return (await r.json()) as MarkupResponse;
}

// Disable Playwright video capture for this spec (the Replit container
// doesn't ship ffmpeg by default).
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("PlanMarkupLayer — marquee selection E2E (Task #1738)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("marquee drag selects intersecting markups; click clears; tighter drag selects only what it crosses", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const suffix = Date.now();
    await stubPlanStream(page);
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    // Seed three HIGHLIGHT markups in the upper-left quadrant so the
    // entire marquee gesture stays inside the visible PDF preview
    // pane. Coordinates are normalized 0..1 (matching the server
    // schema). HIGHLIGHT renders as a filled Konva Rect, so its
    // bounding box is exactly the rectangle defined by points[0]
    // and points[1] — that's the box my marquee algorithm tests
    // for intersection.
    const PAGE_NUMBER = 1;
    const markupA_pts = [
      { x: 0.05, y: 0.05 },
      { x: 0.15, y: 0.10 },
    ];
    const markupB_pts = [
      { x: 0.20, y: 0.05 },
      { x: 0.30, y: 0.10 },
    ];
    const markupC_pts = [
      // Place this one outside the marquee so we can prove the gesture
      // SELECTS only what it crosses, not everything on the page.
      { x: 0.70, y: 0.70 },
      { x: 0.85, y: 0.80 },
    ];

    const markupA = await createMarkup(page, doc.id, {
      pageNumber: PAGE_NUMBER,
      tool: "HIGHLIGHT",
      points: markupA_pts,
      color: "#3b82f6",
      thickness: 2,
    });
    const markupB = await createMarkup(page, doc.id, {
      pageNumber: PAGE_NUMBER,
      tool: "HIGHLIGHT",
      points: markupB_pts,
      color: "#10b981",
      thickness: 2,
    });
    const markupC = await createMarkup(page, doc.id, {
      pageNumber: PAGE_NUMBER,
      tool: "HIGHLIGHT",
      points: markupC_pts,
      color: "#f59e0b",
      thickness: 2,
    });

    await page.goto(
      `${BASE_URL}/projects/${project.code}?tab=plans&documentId=${doc.id}`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByTestId("unified-plan-toolbar")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("plan-markup-layer")).toBeVisible({
      timeout: 30_000,
    });

    // The Konva stage only renders once the PDF has loaded and reported
    // a non-zero canvas size. Wait for the stage canvas to materialize.
    const stageCanvas = page
      .locator('[data-testid="pdf-preview-overlay"] .konvajs-content canvas')
      .first();
    await stageCanvas.waitFor({ state: "visible", timeout: 30_000 });

    await page.getByTestId("pdf-preview-overlay").scrollIntoViewIfNeeded();

    // Engage SELECT mode so dragging starts a marquee instead of a
    // draw-tool gesture.
    await page.getByTestId("button-markup-tool-select").click();

    const overlayBox = await page
      .getByTestId("pdf-preview-overlay")
      .boundingBox();
    expect(overlayBox).not.toBeNull();
    const { x: ox, y: oy, width: ow, height: oh } = overlayBox!;

    // Helper: convert normalized (0..1) coordinates to viewport pixels.
    const px = (nx: number, ny: number) => ({
      x: ox + nx * ow,
      y: oy + ny * oh,
    });

    // ───────────────────────── Case 1: marquee selects A + B ─────────────────────────
    // Drag a marquee that covers BOTH markup A and markup B but stays
    // clear of markup C. Coordinates: from (0.02, 0.02) to (0.35, 0.18).
    {
      const start = px(0.02, 0.02);
      const end = px(0.35, 0.18);

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      // Stepped pre-move so the gesture clears the MARQUEE_MIN_DRAG_PX
      // threshold before we check for the marquee div.
      await page.mouse.move(start.x + 10, start.y + 10, { steps: 4 });
      await page.mouse.move(end.x, end.y, { steps: 12 });

      // While the mouse is still down, the marquee overlay rectangle
      // must be in the DOM with a non-zero size.
      await expect(page.getByTestId("markup-marquee")).toBeVisible({
        timeout: 5_000,
      });

      await page.mouse.up();

      // After release, the marquee div is removed.
      await expect(page.getByTestId("markup-marquee")).toHaveCount(0, {
        timeout: 5_000,
      });

      // Only ONE selection toolbar renders at a time (anchored to
      // the most-recently-selected member — see `lastSelected` in
      // PlanMarkupLayer). The canonical signal that the marquee
      // selected ≥2 markups is the floating Group button — it
      // only appears once `selectionCount >= 2`.
      await expect(page.getByTestId("button-markup-group")).toBeVisible({
        timeout: 5_000,
      });
      // Markup C, which sits in the bottom-right and is NOT covered by
      // the marquee, must not have its own toolbar (it would appear if
      // the algorithm wrongly selected it last).
      await expect(
        page.getByTestId(`markup-selection-toolbar-${markupC.id}`),
      ).toHaveCount(0);
    }

    // ───────────────────────── Case 2: plain click clears ─────────────────────────
    // Click on an obviously empty area in SELECT mode — the existing
    // selection should be wiped out (no marquee, no Shift, plain click).
    {
      const empty = px(0.50, 0.40);
      await page.mouse.click(empty.x, empty.y);

      await expect(
        page.getByTestId(`markup-selection-toolbar-${markupA.id}`),
      ).toHaveCount(0, { timeout: 5_000 });
      await expect(
        page.getByTestId(`markup-selection-toolbar-${markupB.id}`),
      ).toHaveCount(0);
    }

    // ───────────────────────── Case 3: marquee selects only what it crosses ─────────────────────────
    // Drag a small marquee that ONLY crosses markup A. C must remain
    // untouched — proves the marquee uses bounding-box intersection
    // (not "everything on the page" or "everything inside the
    // start point's quadrant").
    {
      const start = px(0.02, 0.02);
      const end = px(0.18, 0.13);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 10, start.y + 10, { steps: 4 });
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.up();

      // Only A is selected → its toolbar is visible, the multi-select
      // Group button is NOT shown (selectionCount === 1), and B and C
      // remain unselected.
      await expect(
        page.getByTestId(`markup-selection-toolbar-${markupA.id}`),
      ).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId("button-markup-group")).toHaveCount(0);
      await expect(
        page.getByTestId(`markup-selection-toolbar-${markupB.id}`),
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`markup-selection-toolbar-${markupC.id}`),
      ).toHaveCount(0);
    }

    // (Shift-drag extension is exhaustively covered by the
    // PlanMarkupLayer.marquee.test.tsx unit suite — driving Shift via
    // Playwright's keyboard API on top of Konva's pointer events is
    // flakey across browsers, so we keep the keyboard-modifier case
    // in the unit-level coverage where it can be deterministic.)
  });
});
