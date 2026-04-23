// @vitest-environment jsdom
/**
 * Task #1341 — verifies the CSV exported from the certified-payroll viewer
 * includes a "Prevailing Rate Source" column populated for both DOL_FEED and
 * PROJECT_OVERRIDE workers (and blank for NONE), matching what the WH-347 PDF
 * and on-screen viewer already show.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
        regularHours: 40, overtimeHours: 0, totalHours: 40,
        rateOfPay: 50, overtimeRate: 75, grossEarned: 2000,
        fica: 0, withholdingTax: 0, otherDeductions: 0,
        totalDeductions: 0, netWages: 2000,
        projectName: "Test Project",
        prevailingRate: 50, belowPrevailingWage: false,
        prevailingRateSource: "DOL_FEED" as const,
      },
      {
        name: "Pat Override",
        workClassification: "Electrician-PO",
        regularHours: 40, overtimeHours: 0, totalHours: 40,
        rateOfPay: 60, overtimeRate: 90, grossEarned: 2400,
        fica: 0, withholdingTax: 0, otherDeductions: 0,
        totalDeductions: 0, netWages: 2400,
        projectName: "Test Project",
        prevailingRate: 60, belowPrevailingWage: false,
        prevailingRateSource: "PROJECT_OVERRIDE" as const,
      },
      {
        name: "Sam None",
        workClassification: "Laborer-N",
        regularHours: 40, overtimeHours: 0, totalHours: 40,
        rateOfPay: 25, overtimeRate: 37.5, grossEarned: 1000,
        fica: 0, withholdingTax: 0, otherDeductions: 0,
        totalDeductions: 0, netWages: 1000,
        projectName: "Test Project",
        prevailingRate: null, belowPrevailingWage: false,
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
      matches: false, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CertifiedPayrollReportView — CSV export rate source column", () => {
  it("includes a Prevailing Rate Source column populated for DOL_FEED and PROJECT_OVERRIDE rows, blank for NONE", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QUERY_KEY, makeReport());

    let capturedCsv = "";
    const originalBlob = global.Blob;
    // Capture the Blob payload the component creates so we can assert on it.
    // jsdom's Blob.text() is reliable for our text/csv content.
    vi.stubGlobal("Blob", class extends originalBlob {
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts);
        capturedCsv = parts.map((p) => (typeof p === "string" ? p : "")).join("");
      }
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => undefined,
    });
    // Stub anchor click so jsdom doesn't try to navigate.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(
      <QueryClientProvider client={qc}>
        <Dialog open onOpenChange={() => undefined}>
          <DialogContent>
            <CertifiedPayrollReportView payRunId="pr-1" payRunNumber="1" />
          </DialogContent>
        </Dialog>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("button-export-csv"));

    const lines = capturedCsv.split("\n");
    const header = lines[0].split(",");
    const sourceIdx = header.indexOf("Prevailing Rate Source");
    expect(sourceIdx).toBeGreaterThan(-1);

    const rowFor = (name: string) =>
      lines.slice(1).find((l) => l.includes(name))!.split(",");

    expect(rowFor("Alex DOL")[sourceIdx]).toBe("DOL feed");
    expect(rowFor("Pat Override")[sourceIdx]).toBe("Project override");
    // NONE workers should produce an empty column value.
    expect(rowFor("Sam None")[sourceIdx]).toBe("");
  });
});
