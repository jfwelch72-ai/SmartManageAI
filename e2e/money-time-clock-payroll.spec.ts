/**
 * Money path: Time clock in/out → manager approves shift → time entry
 * approved → pay run created → WH-347 (certified payroll) PDF export
 * downloads.
 *
 * - Worker (`FIELD_WORKER`) clocks in (with geofence override since no
 *   geofence zone is seeded) and clocks out.
 * - Manager (`MANAGER`) approves the shift with `createTimeEntry:true`
 *   so the underlying time entry is materialised, then approves the
 *   time entry itself (shift-approve creates entries as PENDING).
 * - Admin (`ADMIN`) creates a pay run covering the period and pulls
 *   the WH-347 PDF. The dev sandbox auto-enables `WH_347_PAYROLL`, so
 *   the export endpoint is available.
 *
 * If the WH-347 export ever stops producing a valid PDF, this is the
 * spec that will scream — that's the federal certified-payroll filing
 * customers depend on us for, so we sample the magic-number bytes
 * rather than just the HTTP status.
 */
import { test, expect } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";
import {
  approveShift,
  approveTimeEntry,
  clockIn,
  clockOut,
  createPayRun,
  createProject,
} from "./helpers/factories";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

test.describe("Money path: time clock → approval → pay run → WH-347 PDF", () => {
  test("worker hours flow into a pay run and a downloadable WH-347 PDF", async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const workerCtx = await browser.newContext();
    const managerCtx = await browser.newContext();

    try {
      const adminPage = await adminCtx.newPage();
      const workerPage = await workerCtx.newPage();
      const managerPage = await managerCtx.newPage();

      await Promise.all([
        installCsrf(adminPage),
        installCsrf(workerPage),
        installCsrf(managerPage),
      ]);
      await devLogin(adminPage, "ADMIN");
      const worker = await devLogin(workerPage, "FIELD_WORKER");
      await devLogin(managerPage, "MANAGER");

      const project = await createProject(adminPage, { contractAmount: 50_000 });

      // Worker clocks in then immediately out — totalHours ends up
      // ~0 but is enough for the pay-run query to find an APPROVED
      // entry in the period.
      const shift = await clockIn(workerPage, { projectId: project.id });
      await clockOut(workerPage);

      // Manager approves the shift AND materialises the time entry,
      // then explicitly approves the (PENDING) time entry so the pay
      // run query (`approvalStatus = APPROVED`) actually sees it.
      const approval = await approveShift(managerPage, shift.id, { createTimeEntry: true });
      expect(approval.shift.approvalStatus).toBe("APPROVED");
      expect(approval.timeEntryId, "shift approve must create a time entry").toBeTruthy();
      await approveTimeEntry(managerPage, approval.timeEntryId!);

      // Build a pay run that spans today (the clockIn date).
      const today = isoDate(new Date());
      const payRun = await createPayRun(adminPage, {
        payPeriodStart: today,
        payPeriodEnd: today,
      });
      expect(payRun.id).toBeTruthy();

      // Worker should be reflected in the pay-run line items.
      const stubsRes = await adminPage.request.get(
        `${BASE_URL}/api/payroll/pay-runs/${payRun.id}/pay-stubs`,
      );
      expect(stubsRes.status()).toBe(200);
      const stubs = await stubsRes.json();
      const stubArr = (Array.isArray(stubs) ? stubs : stubs.payStubs ?? stubs.stubs ?? []) as Array<{
        userId: string;
      }>;
      expect(stubArr.some((s) => s.userId === worker.user.id)).toBe(true);

      // WH-347 certified payroll PDF — must be a real PDF.
      const pdfRes = await adminPage.request.get(
        `${BASE_URL}/api/payroll/pay-runs/${payRun.id}/certified-payroll-pdf`,
      );
      expect(pdfRes.status()).toBe(200);
      expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
      const buf = await pdfRes.body();
      expect(buf.byteLength).toBeGreaterThan(500);
      expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    } finally {
      await adminCtx.close();
      await workerCtx.close();
      await managerCtx.close();
    }
  });
});
