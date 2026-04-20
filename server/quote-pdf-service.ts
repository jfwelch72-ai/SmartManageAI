import PDFDocument from "pdfkit";
import { db } from "./db";
import { crmQuotes, crmQuoteLineItems, organizations, crmOrganisations, crmContacts } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function generateQuotePdf(quoteId: string, orgIdGuard: string): Promise<Buffer> {
  const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, quoteId)).limit(1);
  if (!quote) throw new Error("Quote not found");
  if (quote.organizationId !== orgIdGuard) throw new Error("Forbidden");

  const items = await db.select().from(crmQuoteLineItems).where(eq(crmQuoteLineItems.quoteId, quoteId)).orderBy(crmQuoteLineItems.sortOrder);

  const [org] = await db.select().from(organizations).where(eq(organizations.id, quote.organizationId)).limit(1);
  const [crmOrg] = quote.crmOrganisationId
    ? await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, quote.crmOrganisationId)).limit(1)
    : [null];
  const [contact] = quote.contactId
    ? await db.select().from(crmContacts).where(eq(crmContacts.id, quote.contactId)).limit(1)
    : [null];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).fillColor("#1f2937").text(org?.name ?? "Quotation", { align: "left" });
    doc.fontSize(28).fillColor("#ea580c").text("QUOTE", 400, 50, { align: "right" });
    doc.fontSize(10).fillColor("#374151").text(`Quote #: ${quote.quoteNumber}`, 400, 85, { align: "right" });
    doc.text(`Date: ${new Date(quote.createdAt).toLocaleDateString()}`, 400, 100, { align: "right" });
    if (quote.validUntil) doc.text(`Valid Until: ${new Date(quote.validUntil).toLocaleDateString()}`, 400, 115, { align: "right" });
    doc.text(`Status: ${quote.status}`, 400, 130, { align: "right" });

    // Bill To
    doc.moveDown(3);
    doc.fontSize(12).fillColor("#1f2937").text("Quote To:", 50, 170);
    doc.fontSize(10).fillColor("#374151");
    let y = 188;
    if (crmOrg) { doc.text(crmOrg.name, 50, y); y += 14; }
    if (contact) { doc.text(`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim(), 50, y); y += 14; if (contact.email) { doc.text(contact.email, 50, y); y += 14; } if (contact.phone) { doc.text(contact.phone, 50, y); y += 14; } }

    // Title
    doc.moveDown(2);
    doc.fontSize(14).fillColor("#1f2937").text(quote.title, 50, Math.max(y + 20, 280));

    // Line items header
    const tableTop = Math.max(y + 60, 320);
    doc.fontSize(10).fillColor("#ffffff").rect(50, tableTop, 512, 20).fill("#1f2937");
    doc.fillColor("#ffffff");
    doc.text("Description", 55, tableTop + 6, { width: 280 });
    doc.text("Qty", 340, tableTop + 6, { width: 50, align: "right" });
    doc.text("Unit Price", 395, tableTop + 6, { width: 75, align: "right" });
    doc.text("Total", 480, tableTop + 6, { width: 75, align: "right" });

    let rowY = tableTop + 24;
    doc.fillColor("#1f2937");
    for (const it of items) {
      if (rowY > 680) { doc.addPage(); rowY = 50; }
      doc.fontSize(10).text(it.description, 55, rowY, { width: 280 });
      const lineHeight = doc.heightOfString(it.description, { width: 280 });
      doc.text(`${Number(it.quantity)} ${it.unit ?? ""}`.trim(), 340, rowY, { width: 50, align: "right" });
      doc.text(`$${Number(it.unitPrice).toFixed(2)}`, 395, rowY, { width: 75, align: "right" });
      doc.text(`$${Number(it.lineTotal).toFixed(2)}`, 480, rowY, { width: 75, align: "right" });
      rowY += Math.max(lineHeight, 14) + 8;
      doc.moveTo(50, rowY - 4).lineTo(562, rowY - 4).strokeColor("#e5e7eb").stroke();
    }

    // Totals
    rowY += 10;
    const labelX = 380;
    const valueX = 480;
    doc.fontSize(10).fillColor("#374151");
    doc.text("Subtotal:", labelX, rowY, { width: 90, align: "right" });
    doc.text(`$${Number(quote.subtotal).toFixed(2)}`, valueX, rowY, { width: 75, align: "right" });
    rowY += 16;
    if (Number(quote.discountAmount) > 0) {
      doc.text("Discount:", labelX, rowY, { width: 90, align: "right" });
      doc.text(`-$${Number(quote.discountAmount).toFixed(2)}`, valueX, rowY, { width: 75, align: "right" });
      rowY += 16;
    }
    if (Number(quote.taxRate) > 0) {
      doc.text(`Tax (${Number(quote.taxRate).toFixed(2)}%):`, labelX, rowY, { width: 90, align: "right" });
      doc.text(`$${Number(quote.taxAmount).toFixed(2)}`, valueX, rowY, { width: 75, align: "right" });
      rowY += 16;
    }
    doc.fontSize(12).fillColor("#1f2937");
    doc.text("Total:", labelX, rowY + 4, { width: 90, align: "right" });
    doc.text(`$${Number(quote.totalAmount).toFixed(2)}`, valueX, rowY + 4, { width: 75, align: "right" });

    // Notes & Terms
    rowY += 40;
    if (quote.notes) {
      if (rowY > 680) { doc.addPage(); rowY = 50; }
      doc.fontSize(11).fillColor("#1f2937").text("Notes", 50, rowY);
      doc.fontSize(10).fillColor("#374151").text(quote.notes, 50, rowY + 16, { width: 512 });
      rowY += 16 + doc.heightOfString(quote.notes, { width: 512 }) + 16;
    }
    if (quote.terms) {
      if (rowY > 680) { doc.addPage(); rowY = 50; }
      doc.fontSize(11).fillColor("#1f2937").text("Terms & Conditions", 50, rowY);
      doc.fontSize(10).fillColor("#374151").text(quote.terms, 50, rowY + 16, { width: 512 });
    }

    doc.end();
  });
}
