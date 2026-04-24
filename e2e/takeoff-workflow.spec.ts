import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  bidId: string | null;
  scalePxPerFoot: number | null;
  units: string;
  rotation: number;
  sheetIndex: number;
}

interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  computedLengthFt: number | null;
  computedAreaFt2: number | null;
  computedVolumeCy: number | null;
  count: number | null;
  takeoffVersionId: string | null;
  originMeasurementId: string | null;
}

interface CategoryResponse {
  id: string;
  name: string;
  color: string;
}

interface GroupResponse {
  id: string;
  name: string;
  sheetId: string;
  color: string;
}

interface VersionResponse {
  id: string;
  versionNumber: number;
  status: string;
  label: string | null;
  measurements?: MeasurementResponse[];
}

interface ComparisonResponse {
  versionA: VersionResponse;
  versionB: VersionResponse;
  summary: {
    addedCount: number;
    removedCount: number;
    changedCount: number;
    unchangedCount: number;
  };
  added: MeasurementResponse[];
  removed: MeasurementResponse[];
  changed: Array<{
    older: MeasurementResponse;
    newer: MeasurementResponse;
    deltas: Record<string, number>;
  }>;
  unchanged: MeasurementResponse[];
}

test.describe("Takeoff Workflow - Playwright E2E", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("full takeoff lifecycle: plan upload through versioning and sheet operations", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    // --- Create bid and navigate to detail page ---
    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: {
        name: `PW Takeoff Bid ${suffix}`,
        clientName: "PW Takeoff Client",
        bidAmount: "100000",
      },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();
    const bidId = bid.id;
    const bidCode = bid.code;

    await page.goto(`${BASE_URL}/bids/${bidCode}`);
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toContain(bidCode);

    // --- Upload plans and create sheets ---
    const plan1Upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
    const planRes = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
      {
        data: {
          fileUrl: plan1Upload.objectKey,
          objectKey: plan1Upload.objectKey,
          fileName: "PW Test Plan Sheet 1",
        },
      }
    );
    expect(planRes.status()).toBe(201);
    const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
    expect(planBody.sheets).toHaveLength(1);
    const sheetId = planBody.sheets[0].id;
    expect(planBody.sheets[0].sheetName).toBe("PW Test Plan Sheet 1");
    expect(planBody.sheets[0].bidId).toBe(bidId);

    const plan2Upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
    const plan2Res = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
      {
        data: {
          fileUrl: plan2Upload.objectKey,
          objectKey: plan2Upload.objectKey,
          fileName: "PW Test Plan Sheet 2",
        },
      }
    );
    expect(plan2Res.status()).toBe(201);
    const plan2Body = (await plan2Res.json()) as { sheets: SheetResponse[] };
    const sheet2Id = plan2Body.sheets[0].id;

    const listSheetsRes = await page.request.get(
      `${BASE_URL}/api/bids/${bidId}/takeoff/sheets`
    );
    expect(listSheetsRes.status()).toBe(200);
    const sheetsInitial = (await listSheetsRes.json()) as SheetResponse[];
    expect(sheetsInitial.length).toBeGreaterThanOrEqual(2);

    // --- Calibration ---
    const calibRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
      { data: { scalePxPerFoot: 10.0, units: "ft" } }
    );
    expect(calibRes.status()).toBe(200);
    const calibBody = (await calibRes.json()) as SheetResponse;
    expect(calibBody.scalePxPerFoot).toBe(10.0);
    expect(calibBody.units).toBe("ft");

    const invalidCalibRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
      { data: { scalePxPerFoot: -5, units: "ft" } }
    );
    expect(invalidCalibRes.status()).toBe(400);

    // --- Category management ---
    const catRes = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/categories`,
      {
        data: {
          name: "Electrical Conduit",
          color: "#ef4444",
          lineStyle: "dashed",
          lineWidth: 4,
          wasteFactor: 0.1,
          unitCost: 5.5,
        },
      }
    );
    expect(catRes.status()).toBe(201);
    const category = (await catRes.json()) as CategoryResponse;
    const categoryId = category.id;
    expect(category.name).toBe("Electrical Conduit");

    // --- Measurement CRUD: all types ---
    const linearRes = await page.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "LINEAR",
          label: "Wall Run A",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ]),
          categoryId,
        },
      }
    );
    expect(linearRes.status()).toBe(201);
    const linearM = (await linearRes.json()) as MeasurementResponse;
    const linearMeasurementId = linearM.id;
    expect(linearM.type).toBe("LINEAR");
    expect(linearM.computedLengthFt).toBeCloseTo(10.0, 1);

    const areaRes = await page.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "AREA",
          label: "Floor Section B",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 },
          ]),
        },
      }
    );
    expect(areaRes.status()).toBe(201);
    const areaM = (await areaRes.json()) as MeasurementResponse;
    const areaMeasurementId = areaM.id;
    expect(areaM.computedAreaFt2).toBeCloseTo(50.0, 1);

    const volumeRes = await page.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "VOLUME",
          label: "Concrete Pad",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 },
          ]),
          depthFeet: 3,
        },
      }
    );
    expect(volumeRes.status()).toBe(201);
    const volumeM = (await volumeRes.json()) as MeasurementResponse;
    const volumeMeasurementId = volumeM.id;
    expect(volumeM.computedAreaFt2).toBeCloseTo(50.0, 1);
    expect(volumeM.computedVolumeCy).toBeCloseTo((50.0 * 3.0) / 27, 1);

    const countRes = await page.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "COUNT",
          label: "Light Fixtures",
          points: JSON.stringify([{ x: 200, y: 200 }]),
          count: 12,
        },
      }
    );
    expect(countRes.status()).toBe(201);
    const countM = (await countRes.json()) as MeasurementResponse;
    const countMeasurementId = countM.id;
    expect(countM.count).toBe(12);

    // Update measurement
    const updateMRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/measurements/${linearMeasurementId}`,
      { data: { label: "Updated Wall Run A" } }
    );
    expect(updateMRes.status()).toBe(200);
    const updatedM = (await updateMRes.json()) as MeasurementResponse;
    expect(updatedM.label).toBe("Updated Wall Run A");

    // List measurements
    const listMRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`
    );
    expect(listMRes.status()).toBe(200);
    const measurements = (await listMRes.json()) as MeasurementResponse[];
    expect(measurements.length).toBeGreaterThanOrEqual(4);

    // Delete measurement
    const delMRes = await page.request.delete(
      `${BASE_URL}/api/takeoff/measurements/${countMeasurementId}`
    );
    expect(delMRes.status()).toBe(200);

    // --- Calibration recalculation ---
    const recalibRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
      { data: { scalePxPerFoot: 20.0, units: "ft" } }
    );
    expect(recalibRes.status()).toBe(200);

    const recalcMRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`
    );
    const recalcMs = (await recalcMRes.json()) as MeasurementResponse[];
    const recalcLinear = recalcMs.find((m) => m.id === linearMeasurementId);
    expect(recalcLinear).toBeDefined();
    expect(recalcLinear!.computedLengthFt).toBeCloseTo(5.0, 1);
    const recalcArea = recalcMs.find((m) => m.id === areaMeasurementId);
    expect(recalcArea!.computedAreaFt2).toBeCloseTo(12.5, 1);
    const recalcVolume = recalcMs.find((m) => m.id === volumeMeasurementId);
    expect(recalcVolume!.computedVolumeCy).toBeCloseTo((12.5 * 3.0) / 27, 1);

    // --- Measurement groups ---
    const groupRes = await page.request.post(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/groups`,
      { data: { name: "Electrical Group", color: "#f59e0b", sortOrder: 0 } }
    );
    expect(groupRes.status()).toBe(201);
    const group = (await groupRes.json()) as GroupResponse;
    const groupId = group.id;
    expect(group.name).toBe("Electrical Group");

    const updateGRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/groups/${groupId}`,
      { data: { name: "Updated Group", color: "#10b981" } }
    );
    expect(updateGRes.status()).toBe(200);

    const visRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/groups/${groupId}/visibility`,
      { data: { visible: false } }
    );
    expect(visRes.status()).toBe(200);

    const delGRes = await page.request.delete(
      `${BASE_URL}/api/takeoff/groups/${groupId}`
    );
    expect(delGRes.status()).toBe(200);

    // --- Versioning and locking ---
    const v1Res = await page.request.post(
      `${BASE_URL}/api/takeoff/versions`,
      { data: { sheetId, label: "Initial Takeoff" } }
    );
    expect(v1Res.status()).toBe(201);
    const v1 = (await v1Res.json()) as VersionResponse;
    const version1Id = v1.id;
    expect(v1.versionNumber).toBe(1);
    expect(v1.status).toBe("DRAFT");

    const v2Res = await page.request.post(
      `${BASE_URL}/api/takeoff/versions`,
      { data: { sheetId, label: "Revised Takeoff" } }
    );
    expect(v2Res.status()).toBe(201);
    const v2 = (await v2Res.json()) as VersionResponse;
    const version2Id = v2.id;
    expect(v2.versionNumber).toBe(2);

    // Verify v1 is locked
    const versionsRes = await page.request.get(
      `${BASE_URL}/api/takeoff/versions?sheetId=${sheetId}`
    );
    const versions = (await versionsRes.json()) as VersionResponse[];
    const lockedV1 = versions.find((v) => v.id === version1Id);
    expect(lockedV1!.status).toBe("LOCKED");

    // Locked version rejects edits
    const v1MRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements?versionId=${version1Id}`
    );
    const v1Measurements = (await v1MRes.json()) as MeasurementResponse[];
    expect(v1Measurements.length).toBeGreaterThan(0);
    const lockedId = v1Measurements[0].id;

    const editLockedRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/measurements/${lockedId}`,
      { data: { label: "Should Fail" } }
    );
    expect(editLockedRes.status()).toBe(403);
    const editErr = (await editLockedRes.json()) as { error: string };
    expect(editErr.error).toContain("locked");

    const delLockedRes = await page.request.delete(
      `${BASE_URL}/api/takeoff/measurements/${lockedId}`
    );
    expect(delLockedRes.status()).toBe(403);

    // Draft version allows edits
    const v2MRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements?versionId=${version2Id}`
    );
    const v2Measurements = (await v2MRes.json()) as MeasurementResponse[];
    expect(v2Measurements.length).toBeGreaterThan(0);
    const draftId = v2Measurements[0].id;

    const editDraftRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/measurements/${draftId}`,
      { data: { label: "Updated in v2" } }
    );
    expect(editDraftRes.status()).toBe(200);

    // Version detail with measurements
    const vDetailRes = await page.request.get(
      `${BASE_URL}/api/takeoff/versions/${version2Id}`
    );
    expect(vDetailRes.status()).toBe(200);
    const vDetail = (await vDetailRes.json()) as VersionResponse;
    expect(vDetail.measurements).toBeDefined();
    expect(vDetail.measurements!.length).toBeGreaterThan(0);

    // --- Version comparison ---
    await page.request.patch(
      `${BASE_URL}/api/takeoff/measurements/${draftId}`,
      {
        data: {
          label: "Modified for comparison",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ]),
          type: "LINEAR",
        },
      }
    );

    const compareRes = await page.request.get(
      `${BASE_URL}/api/takeoff/versions/compare?versionAId=${version1Id}&versionBId=${version2Id}`
    );
    expect(compareRes.status()).toBe(200);
    const comparison = (await compareRes.json()) as ComparisonResponse;
    expect(comparison.versionA).toBeDefined();
    expect(comparison.versionB).toBeDefined();
    expect(typeof comparison.summary.addedCount).toBe("number");
    expect(typeof comparison.summary.changedCount).toBe("number");
    expect(comparison.added).toBeDefined();
    expect(comparison.changed).toBeDefined();

    const missingCompareRes = await page.request.get(
      `${BASE_URL}/api/takeoff/versions/compare`
    );
    expect(missingCompareRes.status()).toBe(400);

    // --- Sheet operations ---
    const renameRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheet2Id}/rename`,
      { data: { sheetName: "Renamed Sheet 2" } }
    );
    expect(renameRes.status()).toBe(200);
    const renamed = (await renameRes.json()) as SheetResponse;
    expect(renamed.sheetName).toBe("Renamed Sheet 2");

    const rotateRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheet2Id}/rotation`,
      { data: { rotation: 90 } }
    );
    expect(rotateRes.status()).toBe(200);
    expect(((await rotateRes.json()) as SheetResponse).rotation).toBe(90);

    const invalidRotateRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheet2Id}/rotation`,
      { data: { rotation: 45 } }
    );
    expect(invalidRotateRes.status()).toBe(400);

    const dupRes = await page.request.post(
      `${BASE_URL}/api/takeoff/sheets/${sheet2Id}/duplicate`
    );
    expect(dupRes.status()).toBe(201);
    const dupBody = (await dupRes.json()) as {
      sheet: SheetResponse;
      measurementsCopied: number;
    };
    expect(dupBody.sheet.sheetName).toContain("Copy");

    const sheetsBeforeDel = await page.request.get(
      `${BASE_URL}/api/bids/${bidId}/takeoff/sheets`
    );
    const sheetsBeforeList = (await sheetsBeforeDel.json()) as SheetResponse[];
    const countBefore = sheetsBeforeList.length;

    const order = sheetsBeforeList.map((s, i) => ({
      id: s.id,
      sheetIndex: sheetsBeforeList.length - 1 - i,
    }));
    const reorderRes = await page.request.patch(
      `${BASE_URL}/api/bids/${bidId}/takeoff/sheets/reorder`,
      { data: { order } }
    );
    expect(reorderRes.status()).toBe(200);

    const delSheetRes = await page.request.delete(
      `${BASE_URL}/api/takeoff/sheets/${dupBody.sheet.id}`
    );
    expect(delSheetRes.status()).toBe(200);

    const sheetsAfterDel = await page.request.get(
      `${BASE_URL}/api/bids/${bidId}/takeoff/sheets`
    );
    const sheetsAfterList = (await sheetsAfterDel.json()) as SheetResponse[];
    expect(sheetsAfterList.length).toBe(countBefore - 1);

    // --- Category deletion ---
    const delCatRes = await page.request.delete(
      `${BASE_URL}/api/quantity-categories/${categoryId}`
    );
    expect(delCatRes.status()).toBe(200);

    // --- All-measurements aggregation ---
    const allMRes = await page.request.get(
      `${BASE_URL}/api/bids/${bidId}/takeoff/all-measurements`
    );
    expect(allMRes.status()).toBe(200);
    const allMeasurements = (await allMRes.json()) as MeasurementResponse[];
    expect(allMeasurements.length).toBeGreaterThan(0);

    // --- Final navigation check ---
    await page.goto(`${BASE_URL}/bids/${bidCode}`);
    await page.waitForLoadState("networkidle");
    const finalBody = await page.locator("body").textContent();
    expect(finalBody).toContain(bidCode);
  });

  test("role-based access: ESTIMATOR role cannot access ADMIN-created takeoff data", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: {
        name: `PW Auth Test Bid ${suffix}`,
        clientName: "Auth Client",
      },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();
    const bidId = bid.id;

    const authPlanUpload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
    const planRes = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
      {
        data: {
          fileUrl: authPlanUpload.objectKey,
          objectKey: authPlanUpload.objectKey,
          fileName: "Auth Test Sheet",
        },
      }
    );
    expect(planRes.status()).toBe(201);
    const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
    const sheetId = planBody.sheets[0].id;

    const mRes = await page.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "LINEAR",
          label: "Auth Test Line",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 50, y: 0 },
          ]),
        },
      }
    );
    expect(mRes.status()).toBe(201);
    const measurement = (await mRes.json()) as MeasurementResponse;

    await devLogin(page, "ESTIMATOR");

    const sheetsRes = await page.request.get(
      `${BASE_URL}/api/bids/${bidId}/takeoff/sheets`
    );
    expect([403, 404]).toContain(sheetsRes.status());

    const createPlanRes = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
      {
        data: {
          fileUrl: "https://evil.com/plan.pdf",
          fileName: "Evil Plan",
        },
      }
    );
    expect([403, 404]).toContain(createPlanRes.status());

    const getMRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`
    );
    expect([403, 404]).toContain(getMRes.status());

    const createMRes = await page.request.post(
      `${BASE_URL}/api/takeoff/measurements`,
      {
        data: {
          sheetId,
          type: "LINEAR",
          label: "Evil Measurement",
          points: JSON.stringify([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ]),
        },
      }
    );
    expect([403, 404]).toContain(createMRes.status());

    const updateMRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/measurements/${measurement.id}`,
      { data: { label: "Hacked" } }
    );
    expect([403, 404]).toContain(updateMRes.status());

    const calibRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
      { data: { scalePxPerFoot: 999, units: "ft" } }
    );
    expect([403, 404]).toContain(calibRes.status());

    const catRes = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/categories`,
      { data: { name: "Evil Category" } }
    );
    expect([403, 404]).toContain(catRes.status());

    const groupRes = await page.request.post(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/groups`,
      { data: { name: "Evil Group" } }
    );
    expect([403, 404]).toContain(groupRes.status());

    const versionRes = await page.request.post(
      `${BASE_URL}/api/takeoff/versions`,
      { data: { sheetId, label: "Evil Version" } }
    );
    expect([403, 404]).toContain(versionRes.status());
  });
});
