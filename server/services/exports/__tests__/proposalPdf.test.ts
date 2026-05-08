/**
 * Task #2603 — Unit tests for the branded proposal PDF generator.
 * Verifies money totals (base / alternates included vs excluded /
 * allowances / contingencies) and that the renderer produces a valid
 * PDF buffer for both populated and empty inputs.
 */
import { describe, it, expect } from "vitest";
import { PassThrough } from "stream";
import {
  computeProposalTotals,
  generateProposalPDF,
  type ProposalPdfInput,
} from "../proposalPdf";

const branding = {
  organizationName: "Acme Builders",
  logoUrl: null,
  letterheadUrl: null,
  primaryColor: "#1a365d",
  accentColor: "#2563eb",
};

const context = {
  title: "Sample Proposal",
  code: "EST-001",
  preparedAt: new Date("2026-05-01T00:00:00Z"),
};

function streamToBuffer(s: PassThrough): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    s.on("data", (c: Buffer) => chunks.push(c));
    s.on("end", () => resolve(Buffer.concat(chunks)));
    s.on("error", reject);
  });
}

const altGroups = [
  { id: "g1", code: "ALT-1", name: "Skylights", defaultIncluded: true },
  { id: "g2", code: "ALT-2", name: "Solar", defaultIncluded: false },
];

const lineItems = [
  { id: "b1", lineType: "BASE", description: "Concrete", category: "C", quantity: 1, unit: "LS", totalCost: 1000 },
  { id: "b2", lineType: "BASE", description: "Steel", category: "S", quantity: 1, unit: "LS", totalCost: 500 },
  { id: "a1", lineType: "ALTERNATE", alternateGroupId: "g1", description: "Skylight A", category: "A", quantity: 1, unit: "EA", totalCost: 250 },
  { id: "a2", lineType: "ALTERNATE", alternateGroupId: "g2", description: "Solar A", category: "A", quantity: 1, unit: "EA", totalCost: 750 },
  { id: "al1", lineType: "ALLOWANCE", description: "Finishes allowance", category: "F", quantity: 1, unit: "LS", totalCost: 200 },
  { id: "c1", lineType: "CONTINGENCY", description: "10% contingency", category: "C", quantity: 1, unit: "LS", totalCost: 175 },
];

describe("computeProposalTotals", () => {
  it("splits totals by line type and excludes non-default alternates", () => {
    const totals = computeProposalTotals({
      branding, context, lineItems, alternateGroups: altGroups,
    } as ProposalPdfInput);

    expect(totals.baseSubtotal).toBe(1500);
    expect(totals.allowanceSubtotal).toBe(200);
    expect(totals.contingencySubtotal).toBe(175);
    // Only g1 is defaultIncluded, so only the $250 alternate counts.
    expect(totals.includedAltSubtotal).toBe(250);
    expect(totals.proposalTotal).toBe(1500 + 200 + 175 + 250);
    expect(totals.includedAlternateIds).toEqual(["g1"]);
  });

  it("honors an explicit includedAlternateIds override", () => {
    const totals = computeProposalTotals({
      branding, context, lineItems, alternateGroups: altGroups,
      includedAlternateIds: ["g1", "g2"],
    } as ProposalPdfInput);
    expect(totals.includedAltSubtotal).toBe(1000);
    expect(totals.proposalTotal).toBe(1500 + 200 + 175 + 1000);
  });

  it("includes zero alternates when override is an empty array", () => {
    const totals = computeProposalTotals({
      branding, context, lineItems, alternateGroups: altGroups,
      includedAlternateIds: [],
    } as ProposalPdfInput);
    expect(totals.includedAltSubtotal).toBe(0);
    expect(totals.proposalTotal).toBe(1500 + 200 + 175);
  });

  it("returns zeros for an empty estimate", () => {
    const totals = computeProposalTotals({
      branding, context, lineItems: [], alternateGroups: [],
    } as ProposalPdfInput);
    expect(totals.baseSubtotal).toBe(0);
    expect(totals.allowanceSubtotal).toBe(0);
    expect(totals.contingencySubtotal).toBe(0);
    expect(totals.includedAltSubtotal).toBe(0);
    expect(totals.proposalTotal).toBe(0);
  });

  it("ignores non-numeric / null totalCost values", () => {
    const totals = computeProposalTotals({
      branding, context, alternateGroups: [],
      lineItems: [
        { id: "x", lineType: "BASE", description: "junk", category: "x",
          quantity: 1, unit: "LS", totalCost: NaN as unknown as number },
        { id: "y", lineType: "BASE", description: "ok", category: "x",
          quantity: 1, unit: "LS", totalCost: 100 },
      ],
    } as ProposalPdfInput);
    expect(totals.baseSubtotal).toBe(100);
  });
});

describe("generateProposalPDF", () => {
  it("produces a valid non-empty PDF buffer for a populated estimate", async () => {
    const stream = generateProposalPDF({
      branding, context, lineItems, alternateGroups: altGroups,
    } as ProposalPdfInput);
    const buf = await streamToBuffer(stream);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    expect(buf.toString("latin1")).toMatch(/%%EOF/);
  });

  it("produces a valid PDF for an empty estimate (no line items, no alternates)", async () => {
    const stream = generateProposalPDF({
      branding, context, lineItems: [], alternateGroups: [],
    } as ProposalPdfInput);
    const buf = await streamToBuffer(stream);
    expect(buf.length).toBeGreaterThan(200);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });
});
