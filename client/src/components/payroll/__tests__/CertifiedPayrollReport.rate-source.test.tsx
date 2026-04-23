// @vitest-environment jsdom
/**
 * Task #1329 — verifies the on-screen certified-payroll viewer renders the
 * Davis-Bacon rate-source caption ("Project override" / "DOL feed") under
 * the rate-of-pay column for each worker, matching the captions on the
 * generated WH-347 PDF.
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import CertifiedPayrollReportView from "../CertifiedPayrollReport";

const QUERY_KEY = ["/api/payroll/pay-runs", "pr-1", "certified-report"];

function makeReport() {
  return {
    header: {
      contractorName: "Acme Construction",
      payrollNumber: "1",
      weekEndingDate: "2026-04-19",
      projectName: "Test Project",
    },
    employees: [
      {
        name: "Alex DOL",
        workClassification: "Carpenter-DOL",
        regularHours: 40,
        overtimeHours: 0,
        totalHours: 40,
        rateOfPay: 50,
        overtimeRate: 75,
        grossEarned: 2000,
        fica: 0,
        withholdingTax: 0,
        otherDeductions: 0,
        totalDeductions: 0,
        netWages: 2000,
        projectName: "Test Project",
        prevailingRate: 50,
        belowPrevailingWage: false,
        prevailingRateSource: "DOL_FEED" as const,
      },
      {
        name: "Pat Override",
        workClassification: "Electrician-PO",
        regularHours: 40,
        overtimeHours: 0,
        totalHours: 40,
        rateOfPay: 60,
        overtimeRate: 90,
        grossEarned: 2400,
        fica: 0,
        withholdingTax: 0,
        otherDeductions: 0,
        totalDeductions: 0,
        netWages: 2400,
        projectName: "Test Project",
        prevailingRate: 60,
        belowPrevailingWage: false,
        prevailingRateSource: "PROJECT_OVERRIDE" as const,
      },
      {
        name: "Sam None",
        workClassification: "Laborer-N",
        regularHours: 40,
        overtimeHours: 0,
        totalHours: 40,
        rateOfPay: 25,
        overtimeRate: 37.5,
        grossEarned: 1000,
        fica: 0,
        withholdingTax: 0,
        otherDeductions: 0,
        totalDeductions: 0,
        netWages: 1000,
        projectName: "Test Project",
        prevailingRate: null,
        belowPrevailingWage: false,
        prevailingRateSource: "NONE" as const,
      },
    ],
    totals: { totalGross: 5400, totalDeductions: 0, totalNet: 5400 },
    statementOfCompliance: {
      fringeBenefitsPaidToPlan: false,
      fringeBenefitsPaidInCash: false,
      noFringeBenefitsRequired: true,
    },
  };
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  }
});

afterEach(() => cleanup());

describe("CertifiedPayrollReportView — rate source caption", () => {
  it("renders the Davis-Bacon source under the rate cell for DOL_FEED and PROJECT_OVERRIDE workers, and omits it for NONE", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QUERY_KEY, makeReport());

    render(
      <QueryClientProvider client={qc}>
        <Dialog open onOpenChange={() => undefined}>
          <DialogContent>
            <CertifiedPayrollReportView payRunId="pr-1" payRunNumber="1" />
          </DialogContent>
        </Dialog>
      </QueryClientProvider>,
    );

    // Each captioned worker has its caption in the dynamic test id slot the
    // component sets via `text-rate-source-${i}`. We assert exact text on
    // the first two and assert absence on the third.
    const dolCaption = screen.getByTestId("text-rate-source-0");
    expect(dolCaption.textContent).toBe("DOL feed");

    const overrideCaption = screen.getByTestId("text-rate-source-1");
    expect(overrideCaption.textContent).toBe("Project override");

    expect(screen.queryByTestId("text-rate-source-2")).toBeNull();
  });

  it("shows the PW shortfall caption alongside the source caption for below-prevailing workers (matches PDF precedence)", () => {
    const report = makeReport();
    // Mark the first worker as below-PW so the red "PW $X.XX" caption
    // appears. The on-screen viewer renders both captions stacked; the
    // PDF only renders the PW caption (asserted in the PDF test). This
    // test pins the viewer behavior so a future change to the PW caption
    // doesn't accidentally drop the source label too.
    report.employees[0].rateOfPay = 20;
    report.employees[0].belowPrevailingWage = true;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QUERY_KEY, report);

    render(
      <QueryClientProvider client={qc}>
        <Dialog open onOpenChange={() => undefined}>
          <DialogContent>
            <CertifiedPayrollReportView payRunId="pr-1" payRunNumber="1" />
          </DialogContent>
        </Dialog>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("text-pw-rate-0").textContent).toContain("PW: $50.00");
    expect(screen.getByTestId("text-rate-source-0").textContent).toBe("DOL feed");
  });
});
