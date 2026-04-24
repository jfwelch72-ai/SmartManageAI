/**
 * Task #1707 — End-to-end browser coverage for the plan-side group-drag flow
 * introduced in Task #1676.
 *
 * Drives a real browser through the full path that unit/integration tests
 * cannot cover:
 *
 *   sign in → open Plans tab → multi-select two markups → drag one →
 *   reload → assert both members landed at the same delta
 *
 * The drag is performed with the mouse on top of the Konva stage that
 * `<PlanMarkupLayer />` mounts inside `<PdfPreview />`. The PDF stream
 * is stubbed with a tiny in-memory PDF so the canvas renders fast and
 * deterministically.
 *
 * Note on multi-select: the implementation uses Shift+click (NOT a true
 * lasso/marquee — see `client/src/components/markups/PlanMarkupLayer.tsx`
 * `handleSelectShape`). The original task wording said "lasso-select",
 * but Shift+click is the supported multi-select gesture and is what the
 * code actually wires up. This test exercises that gesture.
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

const PDF_LABEL = "Group-drag E2E";

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
      name: `PW Group Drag ${suffix}`,
      clientName: "PW Group Drag Client",
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
      title: `PW Group Drag Plan ${suffix}`,
      fileName: `pw-group-drag-${suffix}.pdf`,
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

async function listMarkups(
  page: Page,
  documentId: string,
  pageNumber: number,
): Promise<MarkupResponse[]> {
  // Read endpoints don't require CSRF; use page.request directly.
  const r = await page.request.get(
    `${BASE_URL}/api/plan-documents/${documentId}/markups?page=${pageNumber}`,
    { headers: await getCsrfHeader(page) },
  );
  expect(r.status()).toBe(200);
  return (await r.json()) as MarkupResponse[];
}

// Disable Playwright video capture for this spec at the file level — the
// Replit container doesn't ship ffmpeg by default and the suite-wide
// retention setting would fail the test before any assertion runs.
// Trace/screenshot retention from the global config still applies.
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("PlanMarkupLayer — group drag E2E (Task #1707)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("multi-select two markups, drag one, both move and persist after reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const suffix = Date.now();
    await stubPlanStream(page);
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    // Seed two HIGHLIGHT markups via the API. HIGHLIGHT renders a filled
    // Konva Rect (vs. stroke-only RECTANGLE/ARROW), so its hit area
    // covers the entire interior — a click anywhere inside reliably
    // triggers `onSelect`. Coordinates are normalized 0..1.
    // Place both markups in the upper-left quadrant of the page so the
    // entire interaction stays inside the visible portion of the PDF
    // preview pane (its container is shorter than the 600×800 PDF, and
    // a marker outside the viewport cannot receive mouse events without
    // an extra scroll dance). Coordinates are normalized 0..1.
    const PAGE_NUMBER = 1;
    const markupA_initial = [
      { x: 0.10, y: 0.06 },
      { x: 0.22, y: 0.14 },
    ];
    const markupB_initial = [
      { x: 0.40, y: 0.06 },
      { x: 0.52, y: 0.14 },
    ];

    const markupA = await createMarkup(page, doc.id, {
      pageNumber: PAGE_NUMBER,
      tool: "HIGHLIGHT",
      points: markupA_initial,
      color: "#3b82f6",
      thickness: 2,
    });
    const markupB = await createMarkup(page, doc.id, {
      pageNumber: PAGE_NUMBER,
      tool: "HIGHLIGHT",
      points: markupB_initial,
      color: "#10b981",
      thickness: 2,
    });

    // Open the project's Plans tab focused on the seeded document.
    await page.goto(
      `${BASE_URL}/projects/${project.code}?tab=plans&documentId=${doc.id}`,
      { waitUntil: "domcontentloaded" },
    );

    // Wait for the unified plan toolbar and the markup overlay to mount.
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

    // Engage SELECT mode so clicks on existing markups select rather
    // than start a new drawing.
    await page.getByTestId("button-markup-tool-select").click();

    // Make sure the PDF preview is scrolled into view so the upper-left
    // corner (where we placed the markups) actually sits inside the
    // browser viewport — without this, a markup may exist on the canvas
    // but be clipped behind the toolbar/scrollable container and the
    // mouse events miss.
    await page.getByTestId("pdf-preview-overlay").scrollIntoViewIfNeeded();

    // Compute the canvas pixel positions of each markup's centroid.
    const overlayBox = await page
      .getByTestId("pdf-preview-overlay")
      .boundingBox();
    expect(overlayBox).not.toBeNull();
    const { x: ox, y: oy, width: ow, height: oh } = overlayBox!;

    const centroidPx = (pts: Array<{ x: number; y: number }>) => {
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      return { x: ox + cx * ow, y: oy + cy * oh };
    };
    const ptA = centroidPx(markupA_initial);
    const ptB = centroidPx(markupB_initial);

    // Plain click on markup A → selects A only. Confirm the floating
    // selection toolbar (anchored at A) becomes visible before the
    // shift-extension. `lastSelected` in PlanMarkupLayer iterates the
    // selectedIds Set in insertion order, so the toolbar testid uses
    // the FIRST-clicked markup's id (here: A) even after B is added.
    await page.mouse.move(ptA.x, ptA.y);
    await page.mouse.click(ptA.x, ptA.y);
    await expect(
      page.getByTestId(`markup-selection-toolbar-${markupA.id}`),
    ).toBeVisible({ timeout: 10_000 });

    // Shift+click on markup B → adds B to the selection. The
    // PlanMarkupLayer reads shiftKey via window.event at click time,
    // so we must hold Shift through the native dispatch.
    await page.keyboard.down("Shift");
    await page.mouse.move(ptB.x, ptB.y);
    await page.mouse.click(ptB.x, ptB.y);
    await page.keyboard.up("Shift");

    // When ≥2 markups are selected the Group button appears inside the
    // floating toolbar — its presence is the canonical signal that the
    // multi-select state wired through.
    await expect(page.getByTestId("button-markup-group")).toBeVisible({
      timeout: 10_000,
    });

    // Drag markup B by a known pixel delta. Konva's drag handlers fire
    // `onDragEnd` only after the mouse pointer has moved past Konva's
    // internal drag-distance threshold, so we step through several
    // intermediate positions before releasing. Keep the delta modest so
    // the drag endpoint stays inside the visible canvas.
    const DELTA_PX = { dx: 80, dy: 50 };
    const dragFrom = ptB;
    const dragTo = { x: ptB.x + DELTA_PX.dx, y: ptB.y + DELTA_PX.dy };

    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
    // Two short pre-moves to clear Konva's drag threshold without
    // triggering a click.
    await page.mouse.move(dragFrom.x + 10, dragFrom.y + 10, { steps: 4 });
    await page.mouse.move(dragFrom.x + 30, dragFrom.y + 20, { steps: 4 });
    await page.mouse.move(dragTo.x, dragTo.y, { steps: 12 });
    await page.mouse.up();

    // Convert the pixel delta to the same normalized delta the client
    // sends in the bulk PATCH payload.
    const expectedDx = DELTA_PX.dx / ow;
    const expectedDy = DELTA_PX.dy / oh;

    const expectedA = markupA_initial.map((p) => ({
      x: p.x + expectedDx,
      y: p.y + expectedDy,
    }));
    const expectedB = markupB_initial.map((p) => ({
      x: p.x + expectedDx,
      y: p.y + expectedDy,
    }));

    // Poll the API until the bulk PATCH lands. Use a generous tolerance
    // (~3px / canvas dimension) to absorb minor pointer rounding.
    const tolX = 4 / ow;
    const tolY = 4 / oh;

    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, doc.id, PAGE_NUMBER);
          const a = list.find((m) => m.id === markupA.id);
          const b = list.find((m) => m.id === markupB.id);
          if (!a || !b) return null;
          return { a: a.points, b: b.points };
        },
        {
          message:
            "expected bulk PATCH from group-drag to land for both markups",
          timeout: 15_000,
        },
      )
      .not.toEqual({ a: markupA_initial, b: markupB_initial });

    const afterDrag = await listMarkups(page, doc.id, PAGE_NUMBER);
    const aAfter = afterDrag.find((m) => m.id === markupA.id)!;
    const bAfter = afterDrag.find((m) => m.id === markupB.id)!;

    // Both markups must have moved by approximately the same delta.
    const aDx = aAfter.points[0].x - markupA_initial[0].x;
    const aDy = aAfter.points[0].y - markupA_initial[0].y;
    const bDx = bAfter.points[0].x - markupB_initial[0].x;
    const bDy = bAfter.points[0].y - markupB_initial[0].y;

    expect(Math.abs(aDx - bDx)).toBeLessThan(0.001);
    expect(Math.abs(aDy - bDy)).toBeLessThan(0.001);
    expect(aDx).toBeGreaterThan(0.05);
    expect(aDy).toBeGreaterThan(0.05);
    expect(Math.abs(aDx - expectedDx)).toBeLessThan(tolX * 2);
    expect(Math.abs(aDy - expectedDy)).toBeLessThan(tolY * 2);

    // Internal point arity per shape must be preserved (translate, not
    // collapse). Two-point shapes stay two-point.
    expect(aAfter.points).toHaveLength(2);
    expect(bAfter.points).toHaveLength(2);

    // Reload the Plans tab and assert the persisted points still
    // reflect the dragged delta — this guards against UI-only moves
    // that look right pre-reload but never round-tripped to the DB.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("plan-markup-layer")).toBeVisible({
      timeout: 30_000,
    });
    await page
      .locator('[data-testid="pdf-preview-overlay"] .konvajs-content canvas')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    const reloaded = await listMarkups(page, doc.id, PAGE_NUMBER);
    const aReloaded = reloaded.find((m) => m.id === markupA.id)!;
    const bReloaded = reloaded.find((m) => m.id === markupB.id)!;

    // Coordinates persist precisely; compare with the same tolerances.
    for (let i = 0; i < expectedA.length; i++) {
      expect(aReloaded.points[i].x).toBeCloseTo(expectedA[i].x, 3);
      expect(aReloaded.points[i].y).toBeCloseTo(expectedA[i].y, 3);
      expect(bReloaded.points[i].x).toBeCloseTo(expectedB[i].x, 3);
      expect(bReloaded.points[i].y).toBeCloseTo(expectedB[i].y, 3);
    }

    // Final invariant: the two markups moved by the same delta after the
    // round trip.
    const aDxR = aReloaded.points[0].x - markupA_initial[0].x;
    const aDyR = aReloaded.points[0].y - markupA_initial[0].y;
    const bDxR = bReloaded.points[0].x - markupB_initial[0].x;
    const bDyR = bReloaded.points[0].y - markupB_initial[0].y;
    expect(Math.abs(aDxR - bDxR)).toBeLessThan(0.001);
    expect(Math.abs(aDyR - bDyR)).toBeLessThan(0.001);
  });
});
