/**
 * Money path: Bid → Award → Convert to project → SOV → AIA pay app →
 * owner approves → invoice / G702-G703 export.
 *
 * Exercises the canonical "we win the work and bill for it" lifecycle
 * end-to-end against the dev seed organization. All assertions are at
 * the API layer because the underlying business state (totals, status
 * transitions, generated PDFs) is what would actually break the
 * customer's invoicing — not the UI styling.
 */
import { test, expect } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";
import {
  awardBidAndConvert,
  createBid,
  createPayApp,
  createSOV,
  setPayAppStatus,
} from "./helpers/factories";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

test.describe("Money path: bid → award → SOV → AIA pay app", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("complete lifecycle ending in approved pay app + G702 PDF export", async ({ page }) => {
    const bid = await createBid(page, { bidAmount: 100_000 });
    expect(bid.status).toBe("DRAFT");

    const project = await awardBidAndConvert(page, bid.code);
    expect(project.code).toBe(bid.code);

    const bidAfter = await page.request.get(`${BASE_URL}/api/bids/${bid.code}`);
    expect(bidAfter.status()).toBe(200);
    expect((await bidAfter.json()).status).toBe("AWARDED");

    const sov = await createSOV(page, {
      projectId: project.id,
      contractValue: 100_000,
      lineItems: [
        { lineNumber: 1, description: "Mobilization", scheduledValue: 20_000, thisPeriodCompleted: 20_000 },
        { lineNumber: 2, description: "Site work", scheduledValue: 80_000, thisPeriodCompleted: 40_000 },
      ],
    });
    expect(sov.status).toBe("DRAFT");

    const payApp = await createPayApp(page, { projectId: project.id, sovId: sov.id });
    expect(payApp.applicationNumber).toBe(1);
    expect(payApp.status).toBe("DRAFT");
    expect(parseFloat(payApp.contractSumToDate)).toBeCloseTo(100_000, 2);

    const submitted = await setPayAppStatus(page, payApp.id, "SUBMITTED");
    expect(submitted.status).toBe("SUBMITTED");
    const approved = await setPayAppStatus(page, payApp.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");

    const pdfRes = await page.request.get(
      `${BASE_URL}/api/aia-billing/pay-applications/${payApp.id}/g702-pdf`,
    );
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    const buf = await pdfRes.body();
    expect(buf.byteLength).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
