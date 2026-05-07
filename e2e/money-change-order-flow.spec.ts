/**
 * Money path: Change order create → submit → approve → reflected in
 * SOV / CO tie-out reconciliation.
 *
 * The /api/sov/co-tieout endpoint is the canonical place where an
 * approved CO must show up against the SOV; if this stops being the
 * case the customer's billing rolls forward without the CO and we
 * under-bill.
 */
import { test, expect } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";
import {
  approveChangeOrder,
  awardBidAndConvert,
  createBid,
  createChangeOrder,
  createPayApp,
  createSOV,
  submitChangeOrder,
} from "./helpers/factories";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

test.describe("Money path: change order routes through approval and lands on SOV", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("approved CO is reflected in pay app contract sum and tie-out totals", async ({ page }) => {
    const bid = await createBid(page, { bidAmount: 200_000 });
    const project = await awardBidAndConvert(page, bid.code);
    const sov = await createSOV(page, {
      projectId: project.id,
      contractValue: 200_000,
    });

    // Baseline pay app — no COs yet.
    const baseline = await createPayApp(page, { projectId: project.id, sovId: sov.id });
    expect(parseFloat(baseline.contractSumToDate)).toBeCloseTo(200_000, 2);
    expect(parseFloat(baseline.netChangeByChangeOrders)).toBeCloseTo(0, 2);

    // Drive the CO through DRAFT → SUBMITTED → APPROVED.
    const co = await createChangeOrder(page, { projectId: project.id, amount: 15_000 });
    expect(co.status).toBe("DRAFT");
    const submitted = await submitChangeOrder(page, co.id);
    expect(submitted.status).toBe("SUBMITTED");
    const approval = await approveChangeOrder(page, co.id);
    // The dev seed has no multi-step workflow chain configured for
    // change orders, so /approve must take the CO to its terminal
    // APPROVED state in a single call. If a future seed change starts
    // wiring a chain, this assertion is the early-warning that the
    // money-path test needs to be updated (rather than silently
    // succeeding on a still-PENDING CO).
    expect(approval.finalApproved, "CO must final-approve in one step under the dev seed").toBe(true);

    const coAfter = await page.request.get(`${BASE_URL}/api/change-orders/${co.id}`);
    expect(coAfter.status()).toBe(200);
    expect((await coAfter.json()).status).toBe("APPROVED");

    // Next pay app should pick up the netCO.
    const payAppWithCo = await createPayApp(page, { projectId: project.id, sovId: sov.id });
    expect(parseFloat(payAppWithCo.netChangeByChangeOrders)).toBeCloseTo(15_000, 2);
    expect(parseFloat(payAppWithCo.contractSumToDate)).toBeCloseTo(215_000, 2);

    // CO tie-out report must surface the project with the CO total.
    const tieoutRes = await page.request.get(`${BASE_URL}/api/sov/co-tieout`);
    expect(tieoutRes.status()).toBe(200);
    const tieout = await tieoutRes.json();
    const reconciliation = (tieout.reconciliation ?? tieout) as Array<{
      projectId: string;
      approvedCOTotal: number;
      changeOrderCount: number;
    }>;
    const projectRow = reconciliation.find((r) => r.projectId === project.id);
    expect(projectRow, "tie-out should include this project").toBeTruthy();
    expect(projectRow!.approvedCOTotal).toBeCloseTo(15_000, 2);
    expect(projectRow!.changeOrderCount).toBeGreaterThanOrEqual(1);
  });
});
