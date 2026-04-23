/**
 * Task #1329 — render test for the prevailing-wage rate-source caption that
 * appears under the rate-of-pay column on the WH-347 PDF.
 *
 * `server/services/wh347Generator.ts` draws a small caption ("DOL feed" /
 * "Project override") under the rate column whenever `prevailingRateSource`
 * is set on the employee row. The route handler in `server/payrollRoutes.ts`
 * already populates that field, but the *PDF rendering* of the label is the
 * thing inspectors actually see, so this test extracts text from the
 * generated PDF and asserts that both labels are present for the matching
 * workers and absent for workers whose source is "NONE".
 *
 * pdfjs-dist's legacy build exposes a Node-friendly `getDocument` that
 * decodes the FlateDecoded content streams pdf-lib produces, so we don't
 * need a custom decompressor. Running this in vitest's node environment
 * works because we use the `legacy/build/pdf.mjs` entry — the regular ESM
 * entry pulls in DOM/canvas helpers we don't have.
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

describe("WH-347 PDF — prevailing rate source caption", () => {
  it("renders 'DOL feed' under the rate column for DOL_FEED workers and 'Project override' for PROJECT_OVERRIDE workers", async () => {
    const employees: WH347Employee[] = [
      makeEmployee({
        name: "Alex DOL",
        workClassification: "Carpenter-DOL",
        prevailingRate: 50,
        prevailingRateSource: "DOL_FEED",
      }),
      makeEmployee({
        name: "Pat Override",
        workClassification: "Electrician-PO",
        prevailingRate: 60,
        rateOfPay: 60,
        prevailingRateSource: "PROJECT_OVERRIDE",
      }),
      makeEmployee({
        name: "Sam None",
        workClassification: "Laborer-N",
        prevailingRateSource: "NONE",
      }),
    ];

    const buf = await generateWH347Pdf(makeReport(employees), "WH_347");
    const text = await extractPdfText(buf);

    expect(text).toContain("DOL feed");
    expect(text).toContain("Project override");

    // The "NONE" source must not produce either caption. We assert by
    // counting occurrences so a future regression that adds a stray
    // caption to NONE workers would be caught.
    const dolFeedCount = (text.match(/DOL feed/g) || []).length;
    const overrideCount = (text.match(/Project override/g) || []).length;
    expect(dolFeedCount).toBe(1);
    expect(overrideCount).toBe(1);
  });

  it("suppresses the source caption when the worker is paid below the prevailing wage (the PW shortfall takes precedence)", async () => {
    // belowPrevailingWage workers get a red "PW $X.XX" caption instead of
    // the source label — the generator only renders one caption slot.
    const employees: WH347Employee[] = [
      makeEmployee({
        name: "Below PW",
        workClassification: "Carpenter-Low",
        rateOfPay: 20,
        prevailingRate: 50,
        belowPrevailingWage: true,
        prevailingRateSource: "DOL_FEED",
      }),
    ];

    const buf = await generateWH347Pdf(makeReport(employees), "WH_347");
    const text = await extractPdfText(buf);

    expect(text).toContain("PW $50.00");
    expect(text).not.toContain("DOL feed");
  });
});
