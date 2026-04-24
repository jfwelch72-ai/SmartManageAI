// @vitest-environment jsdom
/**
 * Task #1484 — verifies the CSV export from the certified-payroll viewer
 * includes a "Recent Rate Change" column populated for any worker whose
 * Davis-Bacon classification has an unacknowledged rate-change record.
 * Mirrors the on-screen "Rate changed recently" badge so a PM auditing
 * the exported CSV still sees the signal.
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
        name: "Alex Carpenter",
        workClassification: "Carpenter",
        regularHours: 40, overtimeHours: 0, totalHours: 40,
        rateOfPay: 50, overtimeRate: 75, grossEarned: 2000,
        fica: 0, withholdingTax: 0, otherDeductions: 0,
        totalDeductions: 0, netWages: 2000,
        projectName: "Test Project",
        prevailingRate: 50, belowPrevailingWage: false,
        prevailingRateSource: "DOL_FEED" as const,
        recentRateChange: { changeKind: "changed" as const, detectedAt: "2026-04-20T12:00:00Z" },
      },
      {
        name: "Pat Electrician",
        workClassification: "Electrician",
        regularHours: 40, overtimeHours: 0, totalHours: 40,
        rateOfPay: 60, overtimeRate: 90, grossEarned: 2400,
        fica: 0, withholdingTax: 0, otherDeductions: 0,
        totalDeductions: 0, netWages: 2400,
        projectName: "Test Project",
        prevailingRate: 60, belowPrevailingWage: false,
        prevailingRateSource: "PROJECT_OVERRIDE" as const,
        recentRateChange: null,
      },
    ],
    totals: { totalGross: 4400, totalDeductions: 0, totalNet: 4400 },
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

describe("CertifiedPayrollReportView — CSV export recent rate-change column (Task #1484)", () => {
  it("includes a 'Recent Rate Change' column populated for workers with an unacknowledged change and blank for the rest", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QUERY_KEY, makeReport());

    let capturedCsv = "";
    const originalBlob = global.Blob;
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
    const idx = header.indexOf("Recent Rate Change");
    expect(idx).toBeGreaterThan(-1);

    const rowFor = (name: string) =>
      lines.slice(1).find((l) => l.includes(name))!.split(",");

    // The "Rate changed 2026-04-20" string contains a space, so the CSV
    // column gets quoted. Strip surrounding quotes before asserting.
    const stripQuotes = (v: string) => v.replace(/^"|"$/g, "");
    expect(stripQuotes(rowFor("Alex Carpenter")[idx])).toBe("Rate changed 2026-04-20");
    expect(rowFor("Pat Electrician")[idx]).toBe("");
  });
});
