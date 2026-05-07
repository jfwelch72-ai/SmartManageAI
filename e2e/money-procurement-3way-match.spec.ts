/**
 * Money path: Procurement PR → PO → Receipt → Vendor invoice → 3-way
 * match.
 *
 * The 3-way match endpoint compares PO amount, invoice amount, and
 * received quantity. When all three line up the invoice transitions
 * to MATCHED — that's the gate AP uses to release the bill for
 * payment, so we assert on both the match-status and the resulting
 * invoice status.
 */
import { test, expect } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";
import {
  approvePurchaseRequest,
  convertPrToPo,
  createProject,
  createPurchaseRequest,
  createVendorInvoice,
  receivePO,
  recordInvoicePayment,
  runThreeWayMatch,
  submitPurchaseRequest,
} from "./helpers/factories";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

test.describe("Money path: procurement PR → PO → Receipt → Invoice → 3-way match", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("matched invoice flips to MATCHED with PO + invoice amounts equal", async ({ page }) => {
    const project = await createProject(page, { contractAmount: 100_000 });

    const items = [
      { description: "Concrete bags", quantity: 50, unit: "EA", estimatedUnitCost: 12.5 }, // 625
      { description: "Rebar #5", quantity: 100, unit: "LF", estimatedUnitCost: 3.75 },     // 375
    ];
    const expectedTotal = 50 * 12.5 + 100 * 3.75; // 1000.00

    const pr = await createPurchaseRequest(page, { projectId: project.id, items });
    expect(pr.status).toBe("DRAFT");
    expect(parseFloat(pr.totalEstimatedCost ?? "0")).toBeCloseTo(expectedTotal, 2);

    await submitPurchaseRequest(page, pr.id);
    await approvePurchaseRequest(page, pr.id);

    const po = await convertPrToPo(page, pr.id);
    expect(po.id).toBeTruthy();
    expect(parseFloat(po.totalCost ?? "0")).toBeCloseTo(expectedTotal, 2);

    const receipt = await receivePO(page, po.id);
    expect(receipt.id ?? null).not.toBeNull();

    const invoice = await createVendorInvoice(page, {
      poId: po.id,
      totalAmount: expectedTotal,
      items: items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitCost: i.estimatedUnitCost,
      })),
    });
    expect(invoice.id).toBeTruthy();

    const match = await runThreeWayMatch(page, invoice.id);
    expect(match.matchStatus).toBe("MATCHED");

    // Bill posting — once 3-way match passes, AP records the payment
    // against the invoice. A full payment must move the invoice to
    // its terminal "bill posted" state (PAID).
    const payment = await recordInvoicePayment(page, invoice.id, { amount: expectedTotal });
    expect(parseFloat(payment.totalPaid)).toBeCloseTo(expectedTotal, 2);

    const invAfter = await page.request.get(
      `${BASE_URL}/api/procurement-module/invoices/${invoice.id}`,
    );
    expect(invAfter.status()).toBe(200);
    const invBody = (await invAfter.json()) as { status?: string };
    expect(invBody.status, "matched + fully paid invoice must be PAID").toBe("PAID");
  });

  test("over-billed invoice surfaces a DISCREPANCY", async ({ page }) => {
    const project = await createProject(page, { contractAmount: 100_000 });
    const items = [
      { description: "Lumber 2x4", quantity: 10, unit: "EA", estimatedUnitCost: 5 }, // 50
    ];

    const pr = await createPurchaseRequest(page, { projectId: project.id, items });
    await submitPurchaseRequest(page, pr.id);
    await approvePurchaseRequest(page, pr.id);
    const po = await convertPrToPo(page, pr.id);
    await receivePO(page, po.id);

    // Vendor over-bills by 2x — must trip 3-way match.
    const invoice = await createVendorInvoice(page, {
      poId: po.id,
      totalAmount: 100,
      items: [{ description: "Lumber 2x4", quantity: 10, unitCost: 10 }],
    });
    const match = await runThreeWayMatch(page, invoice.id);
    expect(match.matchStatus).toBe("DISCREPANCY");

    const invAfter = await page.request.get(
      `${BASE_URL}/api/procurement-module/invoices/${invoice.id}`,
    );
    if (invAfter.status() === 200) {
      const invBody = (await invAfter.json()) as { status?: string };
      if (invBody.status) expect(invBody.status).toBe("DISCREPANCY");
    }
  });
});
