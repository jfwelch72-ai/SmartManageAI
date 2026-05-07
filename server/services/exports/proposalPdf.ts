/**
 * Task #2578 — Branded customer-facing proposal PDF.
 *
 * Renders the estimate as a clean, presentable proposal grouped by
 * line type: Base Bid, Alternates (with toggleable include/exclude),
 * Allowances, and Contingencies. Each section gets its own roll-up
 * subtotal and the cover summary lists the customer-facing totals.
 */

import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import type { OrganizationBranding } from "../../organizationBranding";

export interface ProposalLineItem {
  id: string;
  lineType: string; // BASE | ALTERNATE | ALLOWANCE | CONTINGENCY
  alternateGroupId?: string | null;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  totalCost: number;
  costBookSource?: string | null;
  costBookSourceCode?: string | null;
  costBookAsOfDate?: string | null;
}

export interface ProposalAlternateGroup {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  defaultIncluded: boolean;
}

export interface ProposalContext {
  title: string;
  code?: string;
  clientName?: string;
  projectAddress?: string;
  preparedBy?: string;
  preparedAt: Date;
  validUntil?: Date | null;
  notes?: string | null;
}

export interface ProposalPdfInput {
  branding: OrganizationBranding;
  context: ProposalContext;
  lineItems: ProposalLineItem[];
  alternateGroups: ProposalAlternateGroup[];
  /** Which alternate group ids should appear as INCLUDED in the totals. */
  includedAlternateIds?: string[];
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function generateProposalPDF(input: ProposalPdfInput): PassThrough {
  const { branding, context, lineItems, alternateGroups } = input;
  const includedAlternates = new Set(
    input.includedAlternateIds ?? alternateGroups.filter((g) => g.defaultIncluded).map((g) => g.id),
  );

  const baseLines = lineItems.filter((li) => li.lineType === "BASE");
  const altLines = lineItems.filter((li) => li.lineType === "ALTERNATE");
  const allowLines = lineItems.filter((li) => li.lineType === "ALLOWANCE");
  const contLines = lineItems.filter((li) => li.lineType === "CONTINGENCY");

  const baseSubtotal = baseLines.reduce((s, li) => s + Number(li.totalCost || 0), 0);
  const allowanceSubtotal = allowLines.reduce((s, li) => s + Number(li.totalCost || 0), 0);
  const contingencySubtotal = contLines.reduce((s, li) => s + Number(li.totalCost || 0), 0);
  const includedAltSubtotal = altLines
    .filter((li) => li.alternateGroupId && includedAlternates.has(li.alternateGroupId))
    .reduce((s, li) => s + Number(li.totalCost || 0), 0);
  const proposalTotal = baseSubtotal + allowanceSubtotal + contingencySubtotal + includedAltSubtotal;

  const doc = new PDFDocument({ margin: 54, size: "LETTER" });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primary = branding.primaryColor || "#1a365d";
  const accent = branding.accentColor || "#2563eb";
  const muted = "#6b7280";

  // Header
  doc.fontSize(22).fillColor(primary).text(branding.organizationName, { align: "left" });
  doc.fontSize(11).fillColor(muted).text("Project Proposal");
  doc.moveDown(0.5);

  doc.fontSize(16).fillColor("#111827").text(context.title);
  if (context.code) doc.fontSize(10).fillColor(muted).text(`Reference: ${context.code}`);
  doc.moveDown(0.4);

  // Client + meta block
  const metaY = doc.y;
  doc.fontSize(10).fillColor("#111827");
  if (context.clientName) doc.text(`Prepared for: ${context.clientName}`);
  if (context.projectAddress) doc.text(`Project address: ${context.projectAddress}`);
  doc.text(`Prepared on: ${context.preparedAt.toLocaleDateString()}`);
  if (context.preparedBy) doc.text(`Prepared by: ${context.preparedBy}`);
  if (context.validUntil) doc.text(`Valid until: ${context.validUntil.toLocaleDateString()}`);
  doc.moveDown();

  // Total summary box
  drawSummary(doc, primary, accent, {
    base: baseSubtotal,
    alternates: includedAltSubtotal,
    allowances: allowanceSubtotal,
    contingencies: contingencySubtotal,
    total: proposalTotal,
  });
  doc.moveDown();

  renderSection(doc, primary, "BASE BID — SCOPE OF WORK", baseLines, baseSubtotal);

  if (alternateGroups.length > 0 && altLines.length > 0) {
    doc.addPage();
    doc.fontSize(14).fillColor(primary).text("ALTERNATES", { underline: true });
    doc.moveDown(0.4);
    for (const grp of alternateGroups) {
      const linesForGroup = altLines.filter((li) => li.alternateGroupId === grp.id);
      if (linesForGroup.length === 0) continue;
      const groupSub = linesForGroup.reduce((s, li) => s + Number(li.totalCost || 0), 0);
      const isIncluded = includedAlternates.has(grp.id);
      doc.fontSize(11).fillColor("#111827")
        .text(`${grp.code} — ${grp.name}    [${isIncluded ? "INCLUDED" : "EXCLUDED"}]`);
      if (grp.description) doc.fontSize(9).fillColor(muted).text(grp.description);
      renderLineTable(doc, linesForGroup);
      doc.fontSize(10).fillColor("#111827")
        .text(`Subtotal: ${fmtMoney(groupSub)}`, { align: "right" });
      doc.moveDown(0.6);
    }
  }

  if (allowLines.length > 0) {
    doc.addPage();
    renderSection(doc, primary, "ALLOWANCES", allowLines, allowanceSubtotal);
  }
  if (contLines.length > 0) {
    if (doc.y > 600) doc.addPage();
    renderSection(doc, primary, "CONTINGENCIES", contLines, contingencySubtotal);
  }

  if (context.notes) {
    if (doc.y > 600) doc.addPage();
    doc.fontSize(12).fillColor(primary).text("NOTES & QUALIFICATIONS", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#111827").text(context.notes, { align: "left" });
  }

  // Footer with cost-book provenance summary
  if (doc.y > 600) doc.addPage();
  doc.moveDown();
  const refs = lineItems.filter((li) => li.costBookSource && li.costBookSourceCode);
  if (refs.length > 0) {
    doc.fontSize(9).fillColor(muted)
      .text("Pricing references: based on " +
        Array.from(new Set(refs.map((r) => `${r.costBookSource} (${r.costBookAsOfDate ?? "as-of n/a"})`))).join(", "));
  }

  doc.end();
  return stream;
}

function drawSummary(doc: PDFKit.PDFDocument, primary: string, accent: string, totals: {
  base: number; alternates: number; allowances: number; contingencies: number; total: number;
}) {
  const left = 54;
  const width = 504;
  const top = doc.y;
  const lineH = 16;
  const rows = 6;
  doc.rect(left, top, width, lineH * rows + 12).fillAndStroke("#f8fafc", "#e5e7eb");
  doc.fillColor(primary).fontSize(12).text("Proposal Summary", left + 10, top + 8);
  const cells: Array<[string, string]> = [
    ["Base bid", fmtMoney(totals.base)],
    ["Selected alternates", fmtMoney(totals.alternates)],
    ["Allowances", fmtMoney(totals.allowances)],
    ["Contingencies", fmtMoney(totals.contingencies)],
    ["TOTAL PROPOSAL", fmtMoney(totals.total)],
  ];
  cells.forEach(([label, value], i) => {
    const y = top + 26 + i * lineH;
    const isTotal = i === cells.length - 1;
    doc.fontSize(isTotal ? 11 : 10)
      .fillColor(isTotal ? accent : "#111827")
      .text(label, left + 14, y, { width: width - 160 });
    doc.fontSize(isTotal ? 11 : 10)
      .fillColor(isTotal ? accent : "#111827")
      .text(value, left + width - 150, y, { width: 134, align: "right" });
  });
  doc.y = top + lineH * rows + 18;
  doc.x = left;
}

function renderSection(doc: PDFKit.PDFDocument, primary: string, title: string, items: ProposalLineItem[], subtotal: number) {
  doc.fontSize(14).fillColor(primary).text(title, { underline: true });
  doc.moveDown(0.4);
  if (items.length === 0) {
    doc.fontSize(10).fillColor("#6b7280").text("(no items)");
  } else {
    renderLineTable(doc, items);
  }
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor("#111827").text(`Subtotal: ${fmtMoney(subtotal)}`, { align: "right" });
  doc.moveDown(0.6);
}

function renderLineTable(doc: PDFKit.PDFDocument, items: ProposalLineItem[]) {
  const headers = ["Description", "Qty", "Unit", "Source", "Total"];
  const widths = [240, 50, 40, 110, 70];
  const left = 54;
  let y = doc.y;
  doc.fontSize(9).fillColor("#6b7280");
  let x = left;
  headers.forEach((h, i) => {
    doc.text(h, x, y, { width: widths[i], align: i === 4 ? "right" : "left" });
    x += widths[i];
  });
  y = doc.y + 4;
  doc.strokeColor("#e5e7eb").moveTo(left, y).lineTo(left + widths.reduce((a, b) => a + b, 0), y).stroke();
  doc.y = y + 3;

  doc.fontSize(9).fillColor("#111827");
  for (const li of items) {
    if (doc.y > 700) doc.addPage();
    const rowY = doc.y;
    x = left;
    doc.text(li.description, x, rowY, { width: widths[0] });
    x += widths[0];
    doc.text(String(li.quantity ?? 0), x, rowY, { width: widths[1] });
    x += widths[1];
    doc.text(li.unit ?? "", x, rowY, { width: widths[2] });
    x += widths[2];
    const src = li.costBookSource && li.costBookSourceCode
      ? `${li.costBookSource} ${li.costBookSourceCode}`
      : "—";
    doc.text(src, x, rowY, { width: widths[3] });
    x += widths[3];
    doc.text(fmtMoney(Number(li.totalCost || 0)), x, rowY, { width: widths[4], align: "right" });
    doc.moveDown(0.6);
  }
}
