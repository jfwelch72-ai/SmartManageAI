import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { logWarn } from "./utils/logger";
import {
  buildLineItemFormulaBreakdowns,
  type FormulaBlock,
  type LineItemFormulaInputs,
} from "./materialFormulaBreakdown";

export interface EstimateLineItemForPdf extends LineItemFormulaInputs {
  id: string;
  description: string;
  category: string;
  quantity: number | string | null;
  unit: string | null;
  totalCost: number | string | null;
  materialCost?: number | string | null;
  laborCost?: number | string | null;
  equipmentCost?: number | string | null;
  subcontractCost?: number | string | null;
  notes?: string | null;
  photoUrls?: string[] | null;
  photoUrl?: string | null;
}

export interface EstimateTotalsForPdf {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  consumablesCost?: number;
  subcontractCost: number;
  overheadAllocation: number;
  profitAllocation: number;
  totalCost: number;
}

export interface EstimatePdfData {
  estimate: {
    id: string;
    versionNumber: number;
    status: string;
    notes?: string | null;
  };
  context: {
    title: string;
    subtitle?: string;
    code?: string;
    clientName?: string;
  };
  lineItems: EstimateLineItemForPdf[];
  totals: EstimateTotalsForPdf;
  branding?: {
    organizationName?: string;
    primaryColor?: string;
  };
  /**
   * When true, append a "Calculation Breakdowns" section that renders the
   * same step-by-step derivations the user sees behind the Material
   * Calculator's "Show Formulas" toggle. Defaults to false so existing
   * exports keep their previous shape unless the caller opts in.
   */
  includeFormulas?: boolean;
  resolvePhoto: (
    photoUrl: string,
  ) => Promise<{ buffer: Buffer; contentType?: string } | null>;
}

const fmtMoney = (n: number | string | null | undefined) => {
  const v = Number(n || 0);
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtNum = (n: number | string | null | undefined, frac = 2) => {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: frac });
};

function uniquePhotoUrls(item: EstimateLineItemForPdf): string[] {
  const out: string[] = [];
  const push = (u?: string | null) => {
    if (!u) return;
    if (!out.includes(u)) out.push(u);
  };
  push(item.photoUrl);
  if (Array.isArray(item.photoUrls)) {
    for (const u of item.photoUrls) push(u);
  }
  return out;
}

export async function generateEstimatePdf(data: EstimatePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || "#1a365d";
  const orgName = data.branding?.organizationName || "SmartManageAI";

  // Header
  doc.fontSize(20).fillColor(primaryColor).text(orgName, { align: "center" });
  doc.fontSize(16).fillColor("#374151").text(data.context.title, { align: "center" });
  if (data.context.subtitle) {
    doc.fontSize(11).fillColor("#6b7280").text(data.context.subtitle, { align: "center" });
  }
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor("#6b7280").text(
    `Version ${data.estimate.versionNumber} • Status: ${data.estimate.status} • Generated ${new Date().toLocaleString()}`,
    { align: "center" },
  );
  if (data.context.clientName) {
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#111827").text(`Client: ${data.context.clientName}`, { align: "center" });
  }
  doc.moveDown(1);

  // Summary box
  doc.fillColor("#111827").fontSize(13).text("Cost Summary", { underline: true });
  doc.moveDown(0.3);
  const t = data.totals;
  const summaryLines: [string, string][] = [
    ["Material", fmtMoney(t.materialCost)],
    ["Labor", fmtMoney(t.laborCost)],
    ["Equipment", fmtMoney(t.equipmentCost)],
    ["Subcontract", fmtMoney(t.subcontractCost)],
    ["Overhead", fmtMoney(t.overheadAllocation)],
    ["Profit", fmtMoney(t.profitAllocation)],
    ["Total", fmtMoney(t.totalCost)],
  ];
  doc.fontSize(10).fillColor("#111827").font("Helvetica");
  for (const [label, val] of summaryLines) {
    doc.text(`${label}: ${val}`);
  }
  doc.font("Helvetica").moveDown(1);

  // Line items table
  doc.fontSize(13).fillColor("#111827").text("Line Items", { underline: true });
  doc.moveDown(0.3);

  const cols = {
    desc: { x: 50, w: 230 },
    qty: { x: 285, w: 60 },
    unit: { x: 350, w: 50 },
    cat: { x: 405, w: 80 },
    total: { x: 490, w: 70 },
  } as const;

  const drawHeader = () => {
    doc.fontSize(9).fillColor("#ffffff");
    const y = doc.y;
    doc.rect(50, y, 510, 16).fill(primaryColor);
    doc.fillColor("#ffffff");
    doc.text("Description", cols.desc.x + 4, y + 4, { width: cols.desc.w });
    doc.text("Qty", cols.qty.x + 4, y + 4, { width: cols.qty.w, align: "right" });
    doc.text("Unit", cols.unit.x + 4, y + 4, { width: cols.unit.w });
    doc.text("Category", cols.cat.x + 4, y + 4, { width: cols.cat.w });
    doc.text("Total", cols.total.x + 4, y + 4, { width: cols.total.w, align: "right" });
    doc.y = y + 18;
    doc.fillColor("#111827").font("Helvetica");
  };

  drawHeader();

  const rowMinHeight = 18;
  for (const item of data.lineItems) {
    if (doc.y > 700) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.fontSize(9).fillColor("#111827");
    const descHeight = doc.heightOfString(item.description || "", { width: cols.desc.w - 6 });
    const rowH = Math.max(rowMinHeight, descHeight + 6);
    doc.rect(50, y, 510, rowH).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
    doc.text(item.description || "", cols.desc.x + 4, y + 3, { width: cols.desc.w - 6 });
    doc.text(fmtNum(item.quantity), cols.qty.x + 4, y + 3, { width: cols.qty.w - 6, align: "right" });
    doc.text(item.unit || "", cols.unit.x + 4, y + 3, { width: cols.unit.w - 6 });
    doc.text(item.category || "", cols.cat.x + 4, y + 3, { width: cols.cat.w - 6 });
    doc.text(fmtMoney(item.totalCost), cols.total.x + 4, y + 3, { width: cols.total.w - 6, align: "right" });
    doc.y = y + rowH;
  }

  // Photos pages: one section per line item that has photos
  const itemsWithPhotos = data.lineItems
    .map((it) => ({ item: it, urls: uniquePhotoUrls(it) }))
    .filter((x) => x.urls.length > 0);

  if (itemsWithPhotos.length > 0) {
    doc.addPage();
    doc.fontSize(16).fillColor(primaryColor).text("Reference Photos", { align: "center" });
    doc.moveDown(0.5);

    for (const { item, urls } of itemsWithPhotos) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(12).fillColor("#111827").font("Helvetica-Bold").text(item.description || "(no description)");
      doc.fontSize(9).fillColor("#6b7280").font("Helvetica").text(
        `${item.category || ""} • ${fmtNum(item.quantity)} ${item.unit || ""} • ${fmtMoney(item.totalCost)}`,
      );
      doc.moveDown(0.3);

      const photoWidth = 160;
      const photoHeight = 120;
      const gap = 10;
      const perRow = 3;
      let col = 0;
      let rowY = doc.y;
      for (const url of urls) {
        if (col === 0 && rowY + photoHeight + 30 > 750) {
          doc.addPage();
          rowY = doc.y;
        }
        const x = 50 + col * (photoWidth + gap);
        let drewImage = false;
        try {
          const fetched = await data.resolvePhoto(url);
          if (fetched && fetched.buffer && fetched.buffer.length > 0) {
            try {
              doc.image(fetched.buffer, x, rowY, {
                fit: [photoWidth, photoHeight],
                align: "center",
                valign: "center",
              });
              drewImage = true;
            } catch {
              logWarn("estimate pdf: pdfkit failed to embed photo");
            }
          }
        } catch {
          logWarn("estimate pdf: photo fetch failed");
        }
        if (!drewImage) {
          doc.rect(x, rowY, photoWidth, photoHeight).strokeColor("#d1d5db").lineWidth(0.5).stroke();
          doc.fontSize(8).fillColor("#9ca3af").text("[photo unavailable]", x, rowY + photoHeight / 2 - 4, {
            width: photoWidth,
            align: "center",
          });
        }
        col++;
        if (col >= perRow) {
          col = 0;
          rowY += photoHeight + gap + 4;
          doc.y = rowY;
        }
      }
      if (col !== 0) {
        doc.y = rowY + photoHeight + gap + 4;
      }
      doc.moveDown(0.5);
    }
  }

  if (data.includeFormulas) {
    renderFormulaBreakdowns(doc, data.lineItems, primaryColor);
  }

  doc.end();

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

type PdfDoc = InstanceType<typeof PDFDocument>;

function renderFormulaBreakdowns(
  doc: PdfDoc,
  lineItems: EstimateLineItemForPdf[],
  primaryColor: string,
): void {
  const itemsWithFormulas = lineItems
    .map((li) => ({ item: li, blocks: buildLineItemFormulaBreakdowns(li) }))
    .filter((entry) => entry.blocks.length > 0);

  if (itemsWithFormulas.length === 0) return;

  doc.addPage();
  doc.fontSize(16).fillColor(primaryColor).font("Helvetica-Bold")
    .text("Calculation Breakdowns", { align: "center" });
  doc.font("Helvetica").fontSize(9).fillColor("#6b7280")
    .text(
      "Step-by-step derivations behind each calculated quantity. Numbers match the on-screen Material Calculator.",
      { align: "center" },
    );
  doc.moveDown(1);

  for (const { item, blocks } of itemsWithFormulas) {
    ensureSpace(doc, 80);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827")
      .text(item.description || "(no description)");
    doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(
      `${item.category || ""} • ${fmtNum(item.quantity)} ${item.unit || ""} • ${fmtMoney(item.totalCost)}`,
    );
    doc.moveDown(0.4);

    for (const block of blocks) {
      renderFormulaBlock(doc, block, primaryColor);
    }
    doc.moveDown(0.6);
  }
}

function ensureSpace(doc: PdfDoc, needed: number): void {
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > pageBottom) {
    doc.addPage();
  }
}

function renderFormulaBlock(
  doc: PdfDoc,
  block: FormulaBlock,
  primaryColor: string,
): void {
  // Approximate height before drawing so we can avoid splitting a block
  // mid-row across pages (which makes audits painful).
  const approxHeight = 60 + block.steps.length * 14;
  ensureSpace(doc, approxHeight);

  const startY = doc.y;
  const left = 50;
  const width = 510;

  doc.font("Helvetica-Bold").fontSize(10).fillColor(primaryColor)
    .text(block.title, left + 6, startY + 4, { width: width - 12 });
  let cursor = doc.y + 2;

  doc.font("Courier").fontSize(8).fillColor("#374151")
    .text(block.formula, left + 6, cursor, { width: width - 12 });
  cursor = doc.y + 4;

  doc.font("Helvetica").fontSize(8).fillColor("#6b7280")
    .text("Step-by-step:", left + 6, cursor, { width: width - 12 });
  cursor = doc.y + 2;

  doc.font("Helvetica").fontSize(8).fillColor("#111827");
  for (const step of block.steps) {
    const labelX = left + 6;
    const valueX = left + width / 2;
    doc.text(step.label, labelX, cursor, { width: width / 2 - 12 });
    const labelHeight = doc.heightOfString(step.label, { width: width / 2 - 12 });
    const right = step.calculation
      ? `${step.calculation} = ${step.value}`
      : step.value;
    doc.font("Courier").fontSize(8).text(right, valueX, cursor, {
      width: width / 2 - 12,
      align: "right",
    });
    doc.font("Helvetica").fontSize(8);
    cursor += Math.max(labelHeight, 10) + 2;
    doc.y = cursor;
  }

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827")
    .text("Final Result", left + 6, cursor, { width: width / 2 - 12 });
  doc.font("Courier").fontSize(9).fillColor(primaryColor).text(
    `${block.result.toFixed(2)} ${block.resultUnit}`,
    left + width / 2,
    cursor,
    { width: width / 2 - 12, align: "right" },
  );
  doc.font("Helvetica").fillColor("#111827");
  cursor = doc.y + 4;

  // Outline the block so PDF readers can see the grouping.
  doc.rect(left, startY, width, cursor - startY).strokeColor("#d1d5db")
    .lineWidth(0.5).stroke();
  doc.y = cursor + 6;
}
