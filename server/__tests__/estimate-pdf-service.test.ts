import { describe, it, expect, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import { generateEstimatePdf } from "../estimate-pdf-service";
import { calculateMaterials } from "../materialCalculator";
import { buildLineItemFormulaBreakdowns } from "../materialFormulaBreakdown";

/**
 * Task #2106 — extract text from a PDFKit-generated buffer so the
 * "Calculation Breakdowns" assertions can verify each block actually
 * lands in the printed document. Mirrors `extractPdfText` in
 * `plan-document-pdf-export.test.ts` (pdfjs legacy build, system fonts
 * off, standard fonts pulled from the bundled directory).
 */
async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const nodePath = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const standardFontDataUrl =
    nodePath.resolve(here, "../../node_modules/pdfjs-dist/standard_fonts/") +
    "/";
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

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("generateEstimatePdf", () => {
  it("produces a non-empty PDF for an estimate with no line items", async () => {
    const buf = await generateEstimatePdf({
      estimate: { id: "e1", versionNumber: 1, status: "DRAFT" },
      context: { title: "Test Estimate" },
      lineItems: [],
      totals: {
        materialCost: 0,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      },
      resolvePhoto: async () => null,
    });
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("invokes the photo resolver for every line item photo URL", async () => {
    const calls: string[] = [];
    const resolvePhoto = vi.fn(async (url: string) => {
      calls.push(url);
      return { buffer: PNG_1x1, contentType: "image/png" };
    });

    const buf = await generateEstimatePdf({
      estimate: { id: "e2", versionNumber: 3, status: "APPROVED" },
      context: { title: "Photo Test", code: "BID-1", clientName: "Acme" },
      lineItems: [
        {
          id: "li-1",
          description: "Concrete pour",
          category: "MATERIAL",
          quantity: 10,
          unit: "CY",
          totalCost: 1500,
          photoUrl: "/api/estimates/line-item-photos/org/li-1/a.png",
          photoUrls: [
            "/api/estimates/line-item-photos/org/li-1/a.png", // duplicate of legacy, should dedupe
            "/api/estimates/line-item-photos/org/li-1/b.png",
          ],
        },
        {
          id: "li-2",
          description: "Rebar",
          category: "MATERIAL",
          quantity: 200,
          unit: "LF",
          totalCost: 800,
          photoUrls: ["/api/estimates/line-item-photos/org/li-2/c.png"],
        },
      ],
      totals: {
        materialCost: 2300,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 2300,
      },
      resolvePhoto,
    });

    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    expect(calls).toEqual([
      "/api/estimates/line-item-photos/org/li-1/a.png",
      "/api/estimates/line-item-photos/org/li-1/b.png",
      "/api/estimates/line-item-photos/org/li-2/c.png",
    ]);
  });

  it("includes the calculation breakdowns section when includeFormulas is true", async () => {
    const baseLineItem = {
      id: "li-1",
      description: "Slab on grade",
      category: "MATERIAL",
      quantity: 100,
      unit: "SF",
      totalCost: 1000,
      // Material calculator inputs / canonical results.
      concreteDepthInches: 4,
      concreteWasteFactor: 10,
      calculatedConcreteYards: 1.36,
      requiresRebar: true,
      rebarSpacingInches: 12,
      rebarLengthFeet: 20,
      rebarWasteFactor: 10,
      calculatedRebarCount: 13,
    };

    const without = await generateEstimatePdf({
      estimate: { id: "e4", versionNumber: 1, status: "DRAFT" },
      context: { title: "No Formulas" },
      lineItems: [baseLineItem],
      totals: {
        materialCost: 1000,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 1000,
      },
      resolvePhoto: async () => null,
    });

    const withFormulas = await generateEstimatePdf({
      estimate: { id: "e4", versionNumber: 1, status: "DRAFT" },
      context: { title: "With Formulas" },
      lineItems: [baseLineItem],
      totals: {
        materialCost: 1000,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 1000,
      },
      includeFormulas: true,
      resolvePhoto: async () => null,
    });

    expect(without.slice(0, 4).toString()).toBe("%PDF");
    expect(withFormulas.slice(0, 4).toString()).toBe("%PDF");
    // Adding the breakdown section should grow the PDF appreciably (it
    // adds a new page with two formula blocks).
    expect(withFormulas.length).toBeGreaterThan(without.length + 500);
  });

  it("does not add a breakdown page when no line item has calculator data", async () => {
    const without = await generateEstimatePdf({
      estimate: { id: "e5", versionNumber: 1, status: "DRAFT" },
      context: { title: "Plain" },
      lineItems: [
        {
          id: "li-1",
          description: "Generic",
          category: "MATERIAL",
          quantity: 1,
          unit: "EA",
          totalCost: 100,
        },
      ],
      totals: {
        materialCost: 100,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 100,
      },
      resolvePhoto: async () => null,
    });

    const withFlag = await generateEstimatePdf({
      estimate: { id: "e5", versionNumber: 1, status: "DRAFT" },
      context: { title: "Plain" },
      lineItems: [
        {
          id: "li-1",
          description: "Generic",
          category: "MATERIAL",
          quantity: 1,
          unit: "EA",
          totalCost: 100,
        },
      ],
      totals: {
        materialCost: 100,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 100,
      },
      includeFormulas: true,
      resolvePhoto: async () => null,
    });

    // Without any formula data the two PDFs should be byte-for-byte similar
    // in length (no extra page rendered just because the flag is on).
    expect(Math.abs(withFlag.length - without.length)).toBeLessThan(200);
  });

  it("prints every formula breakdown block (all 8 sections) into the PDF text", async () => {
    // Task #2106 — end-to-end coverage: render a real PDF for a line
    // item with all 8 calculator switches active, extract the printed
    // text, and assert each section title and its result line shows up.
    // This guards against a regression in `renderFormulaBreakdowns`
    // (e.g. a future block builder added to
    // `buildLineItemFormulaBreakdowns` but missed by the renderer).
    const calculatorInputs = {
      quantity: 240,
      unit: "SF",
      concreteDepthInches: 6,
      concreteWasteFactor: 10,
      requiresStoneBase: true,
      stoneType: "COMPACTED_BASE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      requiresExcavation: true,
      excavationDepthInches: 10,
      excavationSwellFactor: 25,
      requiresWireMesh: true,
      wireMeshCoverageSF: 100,
      wireMeshWasteFactor: 10,
      requiresRebar: true,
      rebarSpacingInches: 18,
      rebarLengthFeet: 20,
      rebarWasteFactor: 10,
      requiresDowels: true,
      dowelSpacingInches: 12,
      jointLengthFeet: 30,
      requiresSealer: true,
      sealerCoverageSFPerGallon: 200,
      sealerCoats: 2,
      sealerWasteFactor: 10,
      requiresUnderlayment: true,
      underlaymentOverlapInches: 6,
      underlaymentWasteFactor: 10,
    } as const;

    const r = calculateMaterials(calculatorInputs);

    const lineItem = {
      id: "li-all-blocks",
      description: "Slab on grade — full calculator coverage",
      category: "MATERIAL",
      quantity: calculatorInputs.quantity,
      unit: calculatorInputs.unit,
      totalCost: 5000,
      ...calculatorInputs,
      calculatedConcreteYards: r.calculatedConcreteYards!,
      calculatedStoneTons: r.calculatedStoneTons!,
      calculatedExcavationYards: r.calculatedExcavationYards!,
      calculatedWireMeshRolls: r.calculatedWireMeshRolls!,
      calculatedRebarCount: r.calculatedRebarCount!,
      calculatedDowelCount: r.calculatedDowelCount!,
      calculatedSealerGallons: r.calculatedSealerGallons!,
      calculatedUnderlaymentSF: r.calculatedUnderlaymentSF!,
    };

    // Source-of-truth blocks: whatever the shared helper produces is
    // exactly what the PDF renderer should print. Asserting against
    // these (rather than hard-coded literals) means a future formula
    // tweak that flows through both the helper and the renderer keeps
    // this test green, while a renderer-only regression (or a new
    // helper section the renderer ignores) breaks it.
    const expectedBlocks = buildLineItemFormulaBreakdowns(lineItem);
    expect(expectedBlocks).toHaveLength(8);

    const buf = await generateEstimatePdf({
      estimate: { id: "e2106", versionNumber: 1, status: "DRAFT" },
      context: { title: "Material Estimate — Formula Breakdowns" },
      lineItems: [lineItem],
      totals: {
        materialCost: 5000,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 5000,
      },
      includeFormulas: true,
      resolvePhoto: async () => null,
    });

    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    const rawText = await extractPdfText(buf);
    // PDFKit emits separately-positioned word fragments, so right-aligned
    // result lines like "31.00 Dowels" come back as two text items
    // ("31.00", "Dowels") joined by a newline. Collapse all whitespace
    // for substring assertions so we still verify the printed content
    // exactly without being sensitive to word-by-word layout.
    const normalized = rawText.replace(/\s+/g, " ");

    // The "Calculation Breakdowns" page header should be present.
    expect(normalized).toContain("Calculation Breakdowns");

    // Every block's title and result line must appear.
    for (const block of expectedBlocks) {
      expect(
        normalized,
        `expected block title "${block.title}" in PDF text`,
      ).toContain(block.title);
      const resultLine = `${block.result.toFixed(2)} ${block.resultUnit}`;
      expect(
        normalized,
        `expected result line "${resultLine}" for block "${block.title}" in PDF text`,
      ).toContain(resultLine);
    }

    // Sanity: confirm the eight expected section titles are all there.
    const expectedTitles = [
      "Concrete (Cubic Yards)",
      "Stone Sub-Base (Tons)",
      "Excavation (Cubic Yards)",
      "Wire Mesh (Rolls)",
      "Rebar (Pieces)",
      "Expansion Joint Dowels",
      "Sealer (Gallons)",
      "Plastic Underlayment (SF)",
    ];
    for (const title of expectedTitles) {
      expect(normalized).toContain(title);
    }
  });

  it("renders a placeholder when a photo cannot be resolved", async () => {
    const buf = await generateEstimatePdf({
      estimate: { id: "e3", versionNumber: 1, status: "DRAFT" },
      context: { title: "Missing photo" },
      lineItems: [
        {
          id: "li-1",
          description: "Asphalt",
          category: "MATERIAL",
          quantity: 1,
          unit: "TON",
          totalCost: 100,
          photoUrls: ["/api/estimates/line-item-photos/org/li-1/missing.png"],
        },
      ],
      totals: {
        materialCost: 100,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 100,
      },
      resolvePhoto: async () => null,
    });

    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });
});
