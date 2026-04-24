/**
 * Task #1484 — verifies the WH-347 PDF surfaces unacknowledged Davis-Bacon
 * rate-change records via a "Rate changed YYYY-MM-DD" caption next to the
 * affected worker's classification cell plus a footnote at the bottom of
 * the page. This mirrors the on-screen "Rate changed recently" badge so a
 * PM who downloads/prints the form without scrolling the viewer still sees
 * the signal.
 */

import { describe, it, expect } from "vitest";
import {
  generateWH347Pdf,
  type WH347ReportData,
  type WH347Employee,
} from "../services/wh347Generator";

async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const standardFontDataUrl = path.resolve(
    here,
    "../../node_modules/pdfjs-dist/standard_fonts/",
  ) + "/";
  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl,
  }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as Array<{ str?: string }>) {
      if (typeof item.str === "string") parts.push(item.str);
    }
  }
  await doc.destroy();
  return parts.join("\n");
}

function makeEmployee(overrides: Partial<WH347Employee>): WH347Employee {
  return {
    name: "Worker",
    workClassification: "Carpenter",
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
    prevailingRate: null,
    belowPrevailingWage: false,
    ...overrides,
  };
}

function makeReport(employees: WH347Employee[]): WH347ReportData {
  return {
    contractorName: "Acme Construction",
    payrollNumber: "1",
    weekEndingDate: "2026-04-19",
    projectName: "Test Project",
    employees,
    totals: {
      totalGross: employees.reduce((s, e) => s + e.grossEarned, 0),
      totalDeductions: 0,
      totalNet: employees.reduce((s, e) => s + e.netWages, 0),
    },
    fringeBenefitsPaidToPlan: false,
    fringeBenefitsPaidInCash: false,
    noFringeBenefitsRequired: true,
  };
}

describe("WH-347 PDF — recent Davis-Bacon rate-change annotation (Task #1484)", () => {
  it("renders a 'Rate changed YYYY-MM-DD' caption and footnote when a worker's classification has an unacknowledged rate change", async () => {
    const employees: WH347Employee[] = [
      makeEmployee({
        name: "Alex Carpenter",
        workClassification: "Carpenter",
        recentRateChange: {
          changeKind: "changed",
          detectedAt: "2026-04-20T12:34:56.000Z",
        },
      }),
      makeEmployee({
        name: "Pat Electrician",
        workClassification: "Electrician",
        recentRateChange: null,
      }),
    ];

    const buf = await generateWH347Pdf(makeReport(employees), "WH_347");
    const text = await extractPdfText(buf);

    // Per-row caption uses the ISO date prefix.
    expect(text).toContain("Rate changed 2026-04-20");
    // Page-level footnote appears whenever any row has a rate change.
    expect(text).toContain(
      "Davis-Bacon rate for this classification changed recently",
    );
  });

  it("omits the caption and footnote entirely when no worker has a rate-change record", async () => {
    const employees: WH347Employee[] = [
      makeEmployee({
        name: "Alex Carpenter",
        workClassification: "Carpenter",
        recentRateChange: null,
      }),
    ];

    const buf = await generateWH347Pdf(makeReport(employees), "WH_347");
    const text = await extractPdfText(buf);

    expect(text).not.toContain("Rate changed");
    expect(text).not.toContain(
      "Davis-Bacon rate for this classification changed recently",
    );
  });

  it("falls back to 'Rate changed recently' when detectedAt is null", async () => {
    const employees: WH347Employee[] = [
      makeEmployee({
        name: "Alex Carpenter",
        workClassification: "Carpenter",
        recentRateChange: { changeKind: "added", detectedAt: null },
      }),
    ];

    const buf = await generateWH347Pdf(makeReport(employees), "WH_347");
    const text = await extractPdfText(buf);

    expect(text).toContain("Rate changed recently");
  });
});
