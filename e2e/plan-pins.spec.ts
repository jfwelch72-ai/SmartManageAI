import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { authedRequest, getCsrfHeader } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string, endpoint = "/api/dev/test-login") {
  const response = await page.request.post(`${BASE_URL}${endpoint}`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

// ─── Shared interfaces ──────────────────────────────────────────────────────
interface ProjectResponse {
  id: string;
  code: string;
  name: string;
  status?: string;
  gcOrganizationId?: string | null;
}

interface PlanDocumentResponse {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
}

interface RfiResponse {
  id: string;
  rfiNumber: string;
  subject: string;
  status: string;
}

interface PunchItemResponse {
  id: string;
  itemNumber: string;
  title: string;
  status: string;
}

interface SubmittalResponse {
  id: string;
  subject: string;
  status: string;
}

interface PlanPinResponse {
  id: string;
  organizationId: string;
  projectCode: string;
  planDocumentId: string;
  pageNumber: number;
  x: number;
  y: number;
  pinType: "RFI" | "PUNCH" | "SUBMITTAL";
  refTable: string;
  refId: string;
}

// `/api/rfi` returns either a flat RFI or a wrapper { rfi, ... } depending on
// includes — model both shapes explicitly so we never need an `any` cast.
type RfiListEntry = RfiResponse | { rfi: RfiResponse };
function unwrapRfi(entry: RfiListEntry): RfiResponse {
  return "rfi" in entry ? entry.rfi : entry;
}

// ─── Minimal PDF generated once per worker (used to stub the stream) ───────
let cachedPdf: Buffer | null = null;
async function getMinimalPdf(): Promise<Buffer> {
  if (cachedPdf) return cachedPdf;
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawText("E2E Test Plan", { x: 50, y: 750, size: 20 });
  const bytes = await doc.save();
  cachedPdf = Buffer.from(bytes);
  return cachedPdf;
}

async function stubPlanStream(page: Page) {
  const buf = await getMinimalPdf();
  await page.route(/\/api\/projects\/[^/]+\/documents\/[^/]+\/stream$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "Cache-Control": "no-cache" },
      body: buf,
    });
  });
}

// ─── Setup helpers (project, document, sources) — Task #594 ─────────────────
async function createProject(page: Page, suffix: string | number, name = "PW Plan Pins"): Promise<ProjectResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/projects`, {
    data: { name: `${name} ${suffix}`, clientName: "Pin Client", status: "PLANNING" },
  });
  if (res.status() !== 201) {
    throw new Error(`Project create failed (${res.status()}): ${await res.text()}`);
  }
  return (await res.json()) as ProjectResponse;
}

async function createPlanDocument(
  page: Page,
  projectId: string,
  suffix: string | number,
): Promise<PlanDocumentResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/documents`, {
    data: {
      projectId,
      type: "PLANS",
      title: `PW Pin Plan ${suffix}`,
      fileName: `pw-pin-plan-${suffix}.pdf`,
      fileUrl: `https://example.com/pw-pin-plan-${suffix}.pdf`,
      mimeType: "application/pdf",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as PlanDocumentResponse;
}

async function createRfi(page: Page, projectId: string, suffix: string | number): Promise<RfiResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/rfi`, {
    data: {
      projectId,
      subject: `PW Pin RFI ${suffix}`,
      question: "Need clarification at this location on the plan.",
      status: "DRAFT",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as RfiResponse;
}

async function createPunch(page: Page, projectCode: string, suffix: string | number): Promise<PunchItemResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/projects/${projectCode}/punch-list`, {
    data: { title: `PW Pin Punch ${suffix}`, description: "Touch up paint" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as PunchItemResponse;
}

async function createSubmittal(page: Page, projectId: string, suffix: string | number): Promise<SubmittalResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/submittals`, {
    data: {
      projectId,
      subject: `PW Pin Submittal ${suffix}`,
      description: "Submittal anchored to plan location",
      submittalType: "CONTRACTOR",
      phase: "CONSTRUCTION",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as SubmittalResponse;
}

async function createPin(
  page: Page,
  projectCode: string,
  body: {
    planDocumentId: string;
    pageNumber: number;
    x: number;
    y: number;
    pinType: "RFI" | "PUNCH" | "SUBMITTAL";
    refTable: string;
    refId: string;
  },
): Promise<PlanPinResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/projects/${projectCode}/plan-pins`, {
    data: body,
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as PlanPinResponse;
}

// Hint to the active filter chip: shadcn primary background applies when active
const ACTIVE_CHIP_CLASS_RE = /bg-primary/;

// ─── Drag-test helpers (Task #602) ──────────────────────────────────────────
async function createHarnessProject(page: Page, name: string): Promise<ProjectResponse> {
  const headers = await getCsrfHeader(page);
  const r = await page.request.post(`${BASE_URL}/api/projects`, {
    data: { name, clientName: "PW Pin Client", status: "PLANNING" },
    headers,
  });
  expect(r.status()).toBe(201);
  return r.json();
}

async function createHarnessPlanDocument(
  page: Page,
  projectId: string,
  title: string,
): Promise<PlanDocumentResponse> {
  const headers = await getCsrfHeader(page);
  const r = await page.request.post(`${BASE_URL}/api/documents`, {
    data: {
      projectId,
      title,
      fileName: `${title}.pdf`,
      // Non-storage URL → trySetObjectEntityAclPolicy returns it as-is, no real upload needed.
      fileUrl: "https://example.com/pin-test-fixture.pdf",
      type: "PLANS",
      mimeType: "application/pdf",
    },
    headers,
  });
  expect(r.status()).toBe(201);
  return r.json();
}

async function createHarnessRfi(page: Page, projectId: string, subject: string): Promise<RfiResponse> {
  const headers = await getCsrfHeader(page);
  const r = await page.request.post(`${BASE_URL}/api/rfi`, {
    data: { projectId, subject, question: "test question for pin", status: "DRAFT" },
    headers,
  });
  expect(r.status()).toBe(201);
  return r.json();
}

async function createHarnessPin(
  page: Page,
  projectCode: string,
  documentId: string,
  refId: string,
  x: number,
  y: number,
): Promise<PlanPinResponse> {
  const headers = await getCsrfHeader(page);
  const r = await page.request.post(`${BASE_URL}/api/projects/${projectCode}/plan-pins`, {
    data: {
      planDocumentId: documentId,
      pageNumber: 1,
      x,
      y,
      pinType: "RFI",
      refTable: "rfis",
      refId,
    },
    headers,
  });
  expect(r.status()).toBe(201);
  return r.json();
}

async function listPins(
  page: Page,
  projectCode: string,
  documentId: string,
): Promise<PlanPinResponse[]> {
  const r = await page.request.get(
    `${BASE_URL}/api/projects/${projectCode}/plan-pins?documentId=${documentId}&page=1`,
  );
  expect(r.status()).toBe(200);
  return r.json();
}

async function patchPin(page: Page, pinId: string, data: Record<string, unknown>) {
  const headers = await getCsrfHeader(page);
  return page.request.patch(`${BASE_URL}/api/plan-pins/${pinId}`, { data, headers });
}

interface Harness {
  projectCode: string;
  projectId: string;
  documentId: string;
  pin: PlanPinResponse;
}

async function setupHarness(page: Page, label: string): Promise<Harness> {
  const project = await createHarnessProject(page, `PW Pin ${label} ${Date.now()}`);
  const doc = await createHarnessPlanDocument(page, project.id, `Pin Doc ${label}`);
  const rfi = await createHarnessRfi(page, project.id, `Pin RFI ${label}`);
  const pin = await createHarnessPin(page, project.code, doc.id, rfi.id, 0.25, 0.25);
  return { projectCode: project.code, projectId: project.id, documentId: doc.id, pin };
}

function harnessUrl(h: Harness, width = 800, height = 600) {
  const q = new URLSearchParams({
    projectCode: h.projectCode,
    projectId: h.projectId,
    documentId: h.documentId,
    pageNumber: "1",
    width: String(width),
    height: String(height),
  });
  return `${BASE_URL}/test/plan-pins-harness?${q.toString()}`;
}

// ─── Drag and move tests (Task #602) ────────────────────────────────────────
test.describe("PlanPin drag and move (Task #602)", () => {
  test("drag persists new x/y after page reload", async ({ page }) => {
    await devLogin(page, "ADMIN");
    const h = await setupHarness(page, "drag");

    await page.goto(harnessUrl(h, 800, 600));
    const harness = page.locator('[data-testid="harness-page"]');
    await expect(harness).toBeVisible();
    const pin = page.locator(`[data-testid="plan-pin-${h.pin.id}"]`);
    await expect(pin).toBeVisible();

    const harnessBox = await harness.boundingBox();
    expect(harnessBox).not.toBeNull();
    const { x: bx, y: by, width: bw, height: bh } = harnessBox!;

    // Drag from current location (0.25, 0.25) → target (0.7, 0.6)
    const targetX = bx + 0.7 * bw;
    const targetY = by + 0.6 * bh;

    const pinBox = await pin.boundingBox();
    expect(pinBox).not.toBeNull();
    const startX = pinBox!.x + pinBox!.width / 2;
    const startY = pinBox!.y + pinBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Multiple intermediate moves so the drag threshold is exceeded.
    await page.mouse.move(startX + 20, startY + 20, { steps: 5 });
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await page.mouse.up();

    // Wait for the PATCH to flush; the pin's reported coords should update.
    await expect.poll(async () => {
      const pins = await listPins(page, h.projectCode, h.documentId);
      const updated = pins.find((p) => p.id === h.pin.id);
      return updated ? { x: updated.x, y: updated.y } : null;
    }, { timeout: 10_000 }).toMatchObject({
      x: expect.closeTo(0.7, 1),
      y: expect.closeTo(0.6, 1),
    });

    // Reload — new coords should still render at the new position.
    await page.reload();
    const reloadedPin = page.locator(`[data-testid="plan-pin-${h.pin.id}"]`);
    await expect(reloadedPin).toBeVisible();
    const reloadedBox = await reloadedPin.boundingBox();
    expect(reloadedBox).not.toBeNull();
    const newHarnessBox = (await harness.boundingBox())!;
    const centerX = reloadedBox!.x + reloadedBox!.width / 2;
    const centerY = reloadedBox!.y + reloadedBox!.height / 2;
    const fracX = (centerX - newHarnessBox.x) / newHarnessBox.width;
    const fracY = (centerY - newHarnessBox.y) / newHarnessBox.height;
    expect(fracX).toBeGreaterThan(0.6);
    expect(fracX).toBeLessThan(0.8);
    expect(fracY).toBeGreaterThan(0.5);
    expect(fracY).toBeLessThan(0.7);
  });

  test("clicking a pin without dragging opens the popover", async ({ page }) => {
    await devLogin(page, "ADMIN");
    const h = await setupHarness(page, "click");

    await page.goto(harnessUrl(h));
    const pin = page.locator(`[data-testid="plan-pin-${h.pin.id}"]`);
    await expect(pin).toBeVisible();

    // Plain click — no drag.
    await pin.click();

    const popover = page.locator(`[data-testid="plan-pin-popover-${h.pin.id}"]`);
    await expect(popover).toBeVisible();
    await expect(popover.locator('[data-testid="plan-pin-popover-title"]')).toContainText(/RFI|Pin RFI/);

    // Coordinates must NOT have changed because no drag happened.
    const pinsAfter = await listPins(page, h.projectCode, h.documentId);
    const same = pinsAfter.find((p) => p.id === h.pin.id)!;
    expect(same.x).toBeCloseTo(0.25, 5);
    expect(same.y).toBeCloseTo(0.25, 5);
  });

  test("coordinates clamp to 0..1 when the pointer leaves the page bounds", async ({ page }) => {
    await devLogin(page, "ADMIN");
    const h = await setupHarness(page, "clamp");

    await page.goto(harnessUrl(h, 600, 400));
    const harness = page.locator('[data-testid="harness-page"]');
    const pin = page.locator(`[data-testid="plan-pin-${h.pin.id}"]`);
    await expect(harness).toBeVisible();
    await expect(pin).toBeVisible();

    const box = (await harness.boundingBox())!;
    const pinBox = (await pin.boundingBox())!;
    const startX = pinBox.x + pinBox.width / 2;
    const startY = pinBox.y + pinBox.height / 2;

    // Drag well past the bottom-right corner of the harness container.
    const farX = box.x + box.width + 500;
    const farY = box.y + box.height + 500;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 10, startY + 10, { steps: 3 });
    await page.mouse.move(farX, farY, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const pins = await listPins(page, h.projectCode, h.documentId);
      const u = pins.find((p) => p.id === h.pin.id)!;
      return { x: u.x, y: u.y };
    }, { timeout: 10_000 }).toEqual({ x: 1, y: 1 });

    // Reset pin to mid-page so the next drag origin is well inside the harness
    // (a pin at (1,1) is clipped at the corner due to overflow:hidden).
    const reset = await patchPin(page, h.pin.id, { x: 0.5, y: 0.5 });
    expect(reset.status()).toBe(200);

    // Reload to pick up the reset position (React Query cache is unaware of
    // the out-of-band PATCH performed via the request context).
    await page.reload();
    await expect(page.locator(`[data-testid="plan-pin-${h.pin.id}"]`)).toBeVisible();

    // Now drag past the top-left corner — should clamp to (0, 0).
    const pin2 = page.locator(`[data-testid="plan-pin-${h.pin.id}"]`);
    const pinBox2 = (await pin2.boundingBox())!;
    const sx2 = pinBox2.x + pinBox2.width / 2;
    const sy2 = pinBox2.y + pinBox2.height / 2;
    const negX = box.x - 500;
    const negY = box.y - 500;

    await page.mouse.move(sx2, sy2);
    await page.mouse.down();
    await page.mouse.move(sx2 - 10, sy2 - 10, { steps: 3 });
    await page.mouse.move(negX, negY, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const pins = await listPins(page, h.projectCode, h.documentId);
      const u = pins.find((p) => p.id === h.pin.id)!;
      return { x: u.x, y: u.y };
    }, { timeout: 10_000 }).toEqual({ x: 0, y: 0 });
  });

  test("server rejects out-of-range x/y on PATCH", async ({ page }) => {
    await devLogin(page, "ADMIN");
    const h = await setupHarness(page, "server-clamp");

    const tooLow = await patchPin(page, h.pin.id, { x: -0.1, y: 0.5 });
    expect(tooLow.status()).toBe(400);

    const tooHigh = await patchPin(page, h.pin.id, { x: 0.5, y: 1.5 });
    expect(tooHigh.status()).toBe(400);

    // Boundary values 0 and 1 are accepted.
    const ok = await patchPin(page, h.pin.id, { x: 0, y: 1 });
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as PlanPinResponse;
    expect(body.x).toBe(0);
    expect(body.y).toBe(1);
  });
});

// ─── Plan Pins UI / API / cross-org tests (Task #594) ───────────────────────
test.describe("Plan Pins E2E", () => {
  test("UI: drop RFI pin on plan, verify pin renders, exercise filter chips, click-through to RFI tab", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const suffix = Date.now();
    await stubPlanStream(page);
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    // Pre-create a PUNCH pin via API so we have a second pin type for chip toggling.
    const punch = await createPunch(page, project.code, suffix);
    const punchPin = await createPin(page, project.code, {
      planDocumentId: doc.id,
      pageNumber: 1,
      x: 0.7,
      y: 0.3,
      pinType: "PUNCH",
      refTable: "punch_list_items",
      refId: punch.id,
    });

    // ─── Navigate to Plans tab with the document pre-selected ───────────────
    await page.goto(`${BASE_URL}/projects/${project.code}?tab=plans&documentId=${doc.id}`, {
      waitUntil: "domcontentloaded",
    });

    // Pin filter toolbar appears once a PDF document is selected.
    const toolbar = page.getByTestId("plan-pin-toolbar");
    await expect(toolbar).toBeVisible({ timeout: 30_000 });

    // PDF.js renders the page → overlay activates → existing pin shows up.
    const punchPinEl = page.getByTestId(`plan-pin-${punchPin.id}`);
    await expect(punchPinEl).toBeVisible({ timeout: 30_000 });

    // ─── Drop an RFI pin via the real UI ───────────────────────────────────
    await page.getByTestId("button-toggle-pin-mode").click();

    const canvas = page.getByTestId("pdf-preview-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("PDF canvas has no bounding box");
    // Click in the upper-left quadrant so the pin sits well inside the page.
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);

    await page.getByTestId("pin-picker").waitFor({ state: "visible" });
    await page.getByTestId("pin-picker-rfi").click();

    const dialog = page.getByTestId("dialog-pin-create");
    await expect(dialog).toBeVisible();
    const rfiSubject = `UI Pin RFI ${suffix}`;
    await page.getByTestId("input-pin-title").fill(rfiSubject);
    await page.getByTestId("input-pin-description").fill("Created via UI pin drop test");

    // Capture the created pin id from the network response.
    const pinCreateResp = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/projects/${project.code}/plan-pins`) &&
        r.request().method() === "POST" &&
        r.status() === 201,
    );
    await page.getByTestId("button-pin-create-submit").click();
    const pinResp = await pinCreateResp;
    const newPin = (await pinResp.json()) as PlanPinResponse;
    expect(newPin.pinType).toBe("RFI");

    // The freshly created pin should render in the overlay.
    const newPinEl = page.getByTestId(`plan-pin-${newPin.id}`);
    await expect(newPinEl).toBeVisible({ timeout: 15_000 });
    // Both pins are visible under the default "All" filter.
    await expect(punchPinEl).toBeVisible();

    // ─── Filter chips: real DOM toggling drives PinPlanLayer.visiblePins ───
    const chipAll = page.getByTestId("chip-filter-all");
    const chipRfi = page.getByTestId("chip-filter-rfi");
    const chipPunch = page.getByTestId("chip-filter-punch");
    const chipSubmittal = page.getByTestId("chip-filter-submittal");

    // Default state: ALL is the active chip.
    await expect(chipAll).toHaveClass(ACTIVE_CHIP_CLASS_RE);

    // Click "RFIs" → only RFI pin remains visible.
    await chipRfi.click();
    await expect(chipRfi).toHaveClass(ACTIVE_CHIP_CLASS_RE);
    await expect(newPinEl).toBeVisible();
    await expect(punchPinEl).toHaveCount(0);

    // Click "Punch" → only PUNCH pin remains visible.
    await chipPunch.click();
    await expect(chipPunch).toHaveClass(ACTIVE_CHIP_CLASS_RE);
    await expect(punchPinEl).toBeVisible();
    await expect(newPinEl).toHaveCount(0);

    // Click "Submittals" → neither pin should be visible.
    await chipSubmittal.click();
    await expect(chipSubmittal).toHaveClass(ACTIVE_CHIP_CLASS_RE);
    await expect(newPinEl).toHaveCount(0);
    await expect(punchPinEl).toHaveCount(0);

    // Click "All" → both pins return.
    await chipAll.click();
    await expect(chipAll).toHaveClass(ACTIVE_CHIP_CLASS_RE);
    await expect(newPinEl).toBeVisible();
    await expect(punchPinEl).toBeVisible();

    // ─── Click-through navigation: click the pin, open the popover, hit "Open" ──
    await newPinEl.click();
    const openBtn = page.getByTestId(`button-open-pin-source-${newPin.id}`);
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${project.code}\\?tab=rfis&id=${newPin.refId}`));
    // The destination tab actually renders the RFI subject we just created,
    // proving the click-through reaches the RFI panel and not just the URL.
    await expect(page.getByText(rfiSubject)).toBeVisible({ timeout: 15_000 });
  });

  test("API: validates input, scopes to project, and supports list/delete", async ({ page }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    const project = await createProject(page, `${suffix}-api`);
    const doc = await createPlanDocument(page, project.id, suffix);
    const rfi = await createRfi(page, project.id, suffix);
    const submittal = await createSubmittal(page, project.id, suffix);
    const punch = await createPunch(page, project.code, suffix);

    const rfiPin = await createPin(page, project.code, {
      planDocumentId: doc.id, pageNumber: 1, x: 0.25, y: 0.5, pinType: "RFI",
      refTable: "rfis", refId: rfi.id,
    });
    const punchPin = await createPin(page, project.code, {
      planDocumentId: doc.id, pageNumber: 1, x: 0.6, y: 0.2, pinType: "PUNCH",
      refTable: "punch_list_items", refId: punch.id,
    });
    const submittalPin = await createPin(page, project.code, {
      planDocumentId: doc.id, pageNumber: 1, x: 0.8, y: 0.8, pinType: "SUBMITTAL",
      refTable: "submittals", refId: submittal.id,
    });

    // RFI is reachable via /api/rfi with a typed response shape (no `any` cast).
    const rfiListRes = await page.request.get(`${BASE_URL}/api/rfi?projectId=${project.id}`);
    expect(rfiListRes.status()).toBe(200);
    const rfiList = (await rfiListRes.json()) as RfiListEntry[];
    expect(rfiList.find((r) => unwrapRfi(r).id === rfi.id)).toBeTruthy();

    // List pins for doc/page returns all 3 created pins.
    const allRes = await page.request.get(
      `${BASE_URL}/api/projects/${project.code}/plan-pins?documentId=${doc.id}&page=1`,
    );
    expect(allRes.status()).toBe(200);
    const allPins = (await allRes.json()) as PlanPinResponse[];
    const ours = allPins.filter((p) => [rfiPin.id, punchPin.id, submittalPin.id].includes(p.id));
    expect(ours).toHaveLength(3);

    // Page-scoped: page=2 returns nothing for our pins.
    const otherPageRes = await page.request.get(
      `${BASE_URL}/api/projects/${project.code}/plan-pins?documentId=${doc.id}&page=2`,
    );
    const otherPagePins = (await otherPageRes.json()) as PlanPinResponse[];
    expect(otherPagePins.find((p) => p.id === rfiPin.id)).toBeFalsy();

    // Validation: x/y must be 0..1
    const badCoord = await authedRequest(page, "POST",
      `${BASE_URL}/api/projects/${project.code}/plan-pins`,
      {
        data: {
          planDocumentId: doc.id, pageNumber: 1, x: 1.5, y: 0.5,
          pinType: "RFI", refTable: "rfis", refId: rfi.id,
        },
      },
    );
    expect(badCoord.status()).toBe(400);

    // Validation: refTable must be allowed
    const badRef = await authedRequest(page, "POST",
      `${BASE_URL}/api/projects/${project.code}/plan-pins`,
      {
        data: {
          planDocumentId: doc.id, pageNumber: 1, x: 0.5, y: 0.5,
          pinType: "RFI", refTable: "evil_table", refId: rfi.id,
        },
      },
    );
    expect(badRef.status()).toBe(400);

    // Validation: planDocument from another project rejected
    const otherProject = await createProject(page, `${suffix}-other`, "PW Other");
    const wrongDoc = await authedRequest(page, "POST",
      `${BASE_URL}/api/projects/${otherProject.code}/plan-pins`,
      {
        data: {
          planDocumentId: doc.id, pageNumber: 1, x: 0.5, y: 0.5,
          pinType: "RFI", refTable: "rfis", refId: rfi.id,
        },
      },
    );
    expect(wrongDoc.status()).toBe(404);

    // Delete one pin → it disappears
    const del = await authedRequest(page, "DELETE", `${BASE_URL}/api/plan-pins/${rfiPin.id}`);
    expect(del.status()).toBe(200);
    const after = await page.request.get(
      `${BASE_URL}/api/projects/${project.code}/plan-pins?documentId=${doc.id}&page=1`,
    );
    const afterPins = (await after.json()) as PlanPinResponse[];
    expect(afterPins.find((p) => p.id === rfiPin.id)).toBeFalsy();
    expect(afterPins.find((p) => p.id === punchPin.id)).toBeTruthy();

    // Delete again → 404
    const delAgain = await authedRequest(page, "DELETE", `${BASE_URL}/api/plan-pins/${rfiPin.id}`);
    expect(delAgain.status()).toBe(404);
  });

  test("Cross-org isolation: other org users cannot see or delete pins", async ({ page }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    const project = await createProject(page, `${suffix}-iso`, "PW Iso");
    const doc = await createPlanDocument(page, project.id, suffix);
    const rfi = await createRfi(page, project.id, suffix);
    const pin = await createPin(page, project.code, {
      planDocumentId: doc.id, pageNumber: 1, x: 0.3, y: 0.3, pinType: "RFI",
      refTable: "rfis", refId: rfi.id,
    });

    // Switch to a fresh admin from a different organization.
    await devLogin(page, "ADMIN", "/api/dev/fresh-admin-login");

    const listRes = await page.request.get(
      `${BASE_URL}/api/projects/${project.code}/plan-pins?documentId=${doc.id}&page=1`,
    );
    if (listRes.status() === 200) {
      const otherList = (await listRes.json()) as PlanPinResponse[];
      expect(otherList.find((p) => p.id === pin.id)).toBeFalsy();
    } else {
      expect(listRes.status()).toBe(404);
    }

    const otherOrgDel = await authedRequest(page, "DELETE", `${BASE_URL}/api/plan-pins/${pin.id}`);
    // 403 (forbidden) or 404 (not visible) both prove isolation.
    expect([403, 404]).toContain(otherOrgDel.status());

    // Original org admin can still delete the pin (cleanup).
    await devLogin(page, "ADMIN");
    const cleanup = await authedRequest(page, "DELETE", `${BASE_URL}/api/plan-pins/${pin.id}`);
    expect(cleanup.status()).toBe(200);
  });
});
