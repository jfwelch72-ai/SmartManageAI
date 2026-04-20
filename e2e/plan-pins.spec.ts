import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface Project {
  id: string;
  code: string;
  gcOrganizationId: string | null;
}

interface PlanDocument {
  id: string;
  projectId: string;
  title: string;
}

interface Rfi {
  id: string;
  projectId: string;
  rfiNumber: string;
}

interface PlanPin {
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

async function getCsrfHeader(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "csrf_token");
  return csrf ? { "x-csrf-token": csrf.value } : {};
}

async function devLogin(page: Page, role: string) {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function createProject(page: Page, name: string): Promise<Project> {
  const headers = await getCsrfHeader(page);
  const r = await page.request.post(`${BASE_URL}/api/projects`, {
    data: { name, clientName: "PW Pin Client", status: "PLANNING" },
    headers,
  });
  expect(r.status()).toBe(201);
  return r.json();
}

async function createPlanDocument(
  page: Page,
  projectId: string,
  title: string,
): Promise<PlanDocument> {
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

async function createRfi(page: Page, projectId: string, subject: string): Promise<Rfi> {
  const headers = await getCsrfHeader(page);
  const r = await page.request.post(`${BASE_URL}/api/rfi`, {
    data: { projectId, subject, question: "test question for pin", status: "DRAFT" },
    headers,
  });
  expect(r.status()).toBe(201);
  return r.json();
}

async function createPin(
  page: Page,
  projectCode: string,
  documentId: string,
  refId: string,
  x: number,
  y: number,
): Promise<PlanPin> {
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
): Promise<PlanPin[]> {
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
  pin: PlanPin;
}

async function setupHarness(page: Page, label: string): Promise<Harness> {
  const project = await createProject(page, `PW Pin ${label} ${Date.now()}`);
  const doc = await createPlanDocument(page, project.id, `Pin Doc ${label}`);
  const rfi = await createRfi(page, project.id, `Pin RFI ${label}`);
  const pin = await createPin(page, project.code, doc.id, rfi.id, 0.25, 0.25);
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
    const body = (await ok.json()) as PlanPin;
    expect(body.x).toBe(0);
    expect(body.y).toBe(1);
  });
});
