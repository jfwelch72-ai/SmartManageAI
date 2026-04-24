/**
 * Task #1599 — tests for the Submittal/RFI Log PDF stream generators
 * (`server/services/logPdfService.ts`).
 *
 * The service streams PDFs directly to the HTTP response (no temp
 * file) and is consumed by the desktop "Download log (PDF)" buttons.
 * We assert two regression-critical contracts:
 *   1. The returned stream produces a syntactically valid PDF (starts
 *      with %PDF-, ends with %%EOF) for both kinds.
 *   2. Empty `rows` is handled without throwing (an empty project log
 *      should still be downloadable).
 *
 * The PDF generator is pure (no DB, no I/O beyond the in-memory
 * stream), so this test runs without DB scaffolding.
 */

import { describe, it, expect } from "vitest";

import {
  generateSubmittalLogPdf,
  generateRfiLogPdf,
  type SubmittalLogRow,
  type RfiLogRow,
} from "../services/logPdfService";

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c as Buffer));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

const sampleSubmittals: SubmittalLogRow[] = [
  {
    submittalNumber: "SUB-0001",
    subject: "HMA Mix Design — Section 411",
    status: "APPROVED",
    specSection: "32 12 16",
    dateSubmitted: new Date("2026-03-01T00:00:00Z"),
    dateRequired: new Date("2026-03-15T00:00:00Z"),
    dateReviewed: new Date("2026-03-10T00:00:00Z"),
    reviewerName: "Pat AE",
    submittedByName: "Sam PM",
  },
  {
    submittalNumber: "SUB-0002",
    subject: "Precast box culvert shop drawings",
    status: "REVISE_AND_RESUBMIT",
    specSection: "33 41 13",
    dateSubmitted: "2026-03-05",
    dateRequired: "2026-03-20",
    dateReviewed: null,
    reviewerName: null,
    submittedByName: "Sam PM",
  },
];

const sampleRfis: RfiLogRow[] = [
  {
    rfiNumber: "RFI-0001",
    subject: "Conduit conflict at STA 12+50",
    status: "ANSWERED",
    priority: "HIGH",
    dateSubmitted: new Date("2026-03-02T00:00:00Z"),
    dateRequired: new Date("2026-03-09T00:00:00Z"),
    dateAnswered: new Date("2026-03-08T00:00:00Z"),
    submittedByName: "Sam PM",
    answeredByName: "Pat AE",
  },
  {
    rfiNumber: "RFI-0002",
    subject: "Subgrade prep tolerance",
    status: "OVERDUE",
    priority: "MEDIUM",
    dateSubmitted: "2026-03-04",
    dateRequired: "2026-03-11",
    dateAnswered: null,
    submittedByName: "Sam PM",
    answeredByName: null,
  },
];

describe("logPdfService — Submittal Log PDF", () => {
  it("streams a syntactically valid PDF for a populated log", async () => {
    const stream = generateSubmittalLogPdf({
      branding: { organizationName: "Acme Civil", primaryColor: "#1a365d" },
      projectName: "I-95 Widening",
      rows: sampleSubmittals,
    });

    const buf = await collect(stream);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // PDFKit emits %%EOF as the last marker; allow trailing newline.
    expect(buf.toString("ascii", buf.length - 8)).toContain("%%EOF");
  });

  it("renders an empty log without throwing", async () => {
    const stream = generateSubmittalLogPdf({
      projectName: "Greenfield Project",
      rows: [],
    });
    const buf = await collect(stream);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

describe("logPdfService — RFI Log PDF", () => {
  it("streams a syntactically valid PDF for a populated log", async () => {
    const stream = generateRfiLogPdf({
      branding: { organizationName: "Acme Civil", primaryColor: "#1a365d" },
      projectName: "I-95 Widening",
      rows: sampleRfis,
    });

    const buf = await collect(stream);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.toString("ascii", buf.length - 8)).toContain("%%EOF");
  });

  it("renders an empty log without throwing", async () => {
    const stream = generateRfiLogPdf({
      projectName: "Greenfield Project",
      rows: [],
    });
    const buf = await collect(stream);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
