import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

interface COBranding {
  organizationName: string;
  primaryColor?: string;
}

interface COLineItemsData {
  costBreakdown?: {
    sectionA?: { rows: Array<{ trade: string; stdHours: string; stdRate: string; premHours: string; premRate: string }> };
    sectionB?: { rows: Array<{ trade: string; stdAmount: string; premAmount: string }> };
    sectionC?: { rows: Array<{ description: string; quantity: string; unit: string; rate: string }> };
    sectionD?: { rows: Array<{ description: string; quantity: string; unit: string; rate: string }> };
    sectionE?: { rows: Array<{ description: string; quantity: string; unit: string; rate: string }> };
    sectionG?: { rows: Array<{ description: string; quantity: string; unit: string; rate: string }> };
    sectionI?: { rows: Array<{ description: string; total: string }> };
    sectionK?: { bondInsurance: string; permits: string; lodging: string; rows?: Array<{ description: string; total: string }> };
    sectionVisibility?: Record<string, boolean>;
  };
  overheadPercent?: string;
  profitPercent?: string;
  subcontractorMarkupPercent?: string;
  laborEntries?: Array<{ description: string; hours: number; rate: number; total: number }>;
  equipmentEntries?: Array<{ description: string; days: number; rate: number; total: number }>;
  materialEntries?: Array<{ description: string; quantity: number; unitCost: number; total: number }>;
}

interface COApproval {
  approverRole: string;
  status: string;
  stepOrder: number;
  comments: string | null;
  decidedAt: string | null;
  approverName?: string;
}

interface CORevision {
  revisionNumber: number;
  previousStatus: string;
  newStatus: string;
  description: string | null;
  createdAt: string;
  revisedByName?: string;
}

interface ChangeOrderPDFData {
  changeOrder: {
    id: string;
    changeOrderNumber: string;
    description: string;
    amount: string;
    status: string;
    createdAt: string | Date;
    updatedAt: string | Date;
    submittedAt?: string | Date | null;
    approvedAt?: string | Date | null;
    rejectionReason?: string | null;
    costCodeId?: number | null;
    costCodeLabel?: string | null;
    linkedTmTicketNumber?: string | null;
    linkedRfiNumber?: string | null;
    contractNumber?: string | null;
    requestedByName?: string;
    approvedByName?: string;
  };
  project: {
    name: string;
    code: string;
    clientName?: string;
    locationAddress?: string | null;
  };
  lineItems?: COLineItemsData | null;
  approvals?: COApproval[];
  revisions?: CORevision[];
  branding?: COBranding;
}

const p = (v: string | undefined | null) => { const n = parseFloat(v || '0'); return isNaN(n) ? 0 : n; };
const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return 'N/A';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function generateChangeOrderPDF(data: ChangeOrderPDFData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const companyName = data.branding?.organizationName || 'SmartManageAI';
  const co = data.changeOrder;
  const proj = data.project;

  doc.fontSize(24).fillColor(primaryColor).text(companyName, { align: 'center' });
  doc.fontSize(10).fillColor('#6b7280').text('Construction Management', { align: 'center' });
  doc.moveDown(0.3);

  doc.strokeColor(primaryColor).lineWidth(2).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  doc.fontSize(18).fillColor(primaryColor).text('CHANGE ORDER', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).fillColor('#374151').text(`${co.changeOrderNumber}`, { align: 'center' });
  doc.moveDown(1);

  const drawLine = () => {
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);
  };

  const infoY = doc.y;
  doc.fontSize(10).fillColor('#374151');
  doc.text(`Project: ${proj.name}`, 50, infoY);
  doc.text(`Project Code: ${proj.code}`, 50, infoY + 14);
  if (proj.clientName) doc.text(`Client: ${proj.clientName}`, 50, infoY + 28);
  if (proj.locationAddress) doc.text(`Location: ${proj.locationAddress}`, 50, infoY + 42);

  doc.text(`Status: ${co.status}`, 350, infoY);
  doc.text(`Date: ${fmtDate(co.createdAt)}`, 350, infoY + 14);
  if (co.submittedAt) doc.text(`Submitted: ${fmtDate(co.submittedAt)}`, 350, infoY + 28);
  if (co.approvedAt) doc.text(`Approved: ${fmtDate(co.approvedAt)}`, 350, infoY + 42);

  doc.y = infoY + 60;
  doc.moveDown(0.5);
  drawLine();

  if (co.requestedByName) {
    doc.fontSize(9).fillColor('#6b7280').text('Requested By: ', { continued: true });
    doc.fillColor('#374151').text(co.requestedByName);
  }
  if (co.approvedByName) {
    doc.fontSize(9).fillColor('#6b7280').text('Approved By: ', { continued: true });
    doc.fillColor('#374151').text(co.approvedByName);
  }
  if (co.costCodeLabel) {
    doc.fontSize(9).fillColor('#6b7280').text('Cost Code: ', { continued: true });
    doc.fillColor('#374151').text(co.costCodeLabel);
  }
  doc.moveDown(0.5);

  doc.fontSize(12).fillColor(primaryColor).text('DESCRIPTION', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#374151').text(co.description, { align: 'justify', lineGap: 2 });
  doc.moveDown(0.5);

  if (co.linkedTmTicketNumber || co.linkedRfiNumber || co.contractNumber) {
    doc.fontSize(12).fillColor(primaryColor).text('LINKED REFERENCES', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#374151');
    if (co.linkedRfiNumber) doc.text(`RFI: ${co.linkedRfiNumber}`);
    if (co.linkedTmTicketNumber) doc.text(`T&M Ticket: ${co.linkedTmTicketNumber}`);
    if (co.contractNumber) doc.text(`Contract: ${co.contractNumber}`);
    doc.moveDown(0.5);
  }

  drawLine();

  if (data.lineItems?.costBreakdown) {
    const cb = data.lineItems.costBreakdown;
    const sv = cb.sectionVisibility || {};
    const ohPct = p(data.lineItems.overheadPercent);
    const profitPctVal = p(data.lineItems.profitPercent);
    const subPct = p(data.lineItems.subcontractorMarkupPercent);

    doc.fontSize(14).fillColor(primaryColor).text('COST BREAKDOWN', { underline: true });
    doc.moveDown(0.5);

    let subtotalAE = 0;

    const renderItemTable = (label: string, rows: Array<{ description: string; quantity: string; unit: string; rate: string }>, sectionKey: string) => {
      if (sv[sectionKey] === false) return 0;
      const validRows = rows.filter(r => p(r.quantity) > 0 || r.description.trim());
      if (validRows.length === 0) return 0;

      if (doc.y > 650) doc.addPage();
      doc.fontSize(11).fillColor(primaryColor).text(label);
      doc.moveDown(0.2);

      const colWidths = [220, 60, 50, 70, 80];
      doc.fontSize(8).fillColor('#6b7280');
      let xPos = 50;
      ['Description', 'Qty', 'Unit', 'Rate', 'Total'].forEach((h, i) => {
        doc.text(h, xPos, doc.y, { width: colWidths[i], align: i >= 3 ? 'right' : 'left' });
        xPos += colWidths[i] + 5;
      });
      doc.moveDown(0.5);

      let sectionTotal = 0;
      doc.fontSize(9).fillColor('#374151');
      for (const row of validRows) {
        if (doc.y > 700) doc.addPage();
        const total = p(row.quantity) * p(row.rate);
        sectionTotal += total;
        xPos = 50;
        const y = doc.y;
        doc.text(row.description.substring(0, 45), xPos, y, { width: colWidths[0] });
        doc.text(row.quantity, xPos + colWidths[0] + 5, y, { width: colWidths[1] });
        doc.text(row.unit, xPos + colWidths[0] + colWidths[1] + 10, y, { width: colWidths[2] });
        doc.text(fmt(p(row.rate)), xPos + colWidths[0] + colWidths[1] + colWidths[2] + 15, y, { width: colWidths[3], align: 'right' });
        doc.text(fmt(total), xPos + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 20, y, { width: colWidths[4], align: 'right' });
        doc.moveDown(0.7);
      }
      doc.fontSize(9).fillColor(primaryColor).text(`Subtotal: ${fmt(sectionTotal)}`, { align: 'right' });
      doc.moveDown(0.5);
      return sectionTotal;
    };

    if (sv.A !== false && cb.sectionA?.rows?.length) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(11).fillColor(primaryColor).text('Section A — Labor (Standard Time)');
      doc.moveDown(0.2);
      let laborTotal = 0;
      doc.fontSize(8).fillColor('#6b7280');
      let xPos = 50;
      ['Trade', 'Std Hrs', 'Rate', 'Prem Hrs', 'Rate', 'Total'].forEach((h, i) => {
        const w = i === 0 ? 140 : 70;
        doc.text(h, xPos, doc.y, { width: w, align: i >= 2 ? 'right' : 'left' });
        xPos += w + 5;
      });
      doc.moveDown(0.5);

      doc.fontSize(9).fillColor('#374151');
      for (const row of cb.sectionA.rows) {
        if (doc.y > 700) doc.addPage();
        const std = p(row.stdHours) * p(row.stdRate);
        const prem = p(row.premHours) * p(row.premRate);
        const total = std + prem;
        laborTotal += total;
        const y = doc.y;
        xPos = 50;
        doc.text(row.trade || '-', xPos, y, { width: 140 });
        doc.text(row.stdHours, xPos + 145, y, { width: 70 });
        doc.text(fmt(p(row.stdRate)), xPos + 220, y, { width: 70, align: 'right' });
        doc.text(row.premHours, xPos + 295, y, { width: 70 });
        doc.text(fmt(p(row.premRate)), xPos + 370, y, { width: 70, align: 'right' });
        doc.text(fmt(total), xPos + 445, y, { width: 70, align: 'right' });
        doc.moveDown(0.7);
      }
      doc.fontSize(9).fillColor(primaryColor).text(`Labor Subtotal (A+A1): ${fmt(laborTotal)}`, { align: 'right' });
      doc.moveDown(0.5);
      subtotalAE += laborTotal;
    }

    if (sv.B !== false && cb.sectionB?.rows?.length) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(11).fillColor(primaryColor).text('Section B — Fringes & Benefits');
      doc.moveDown(0.2);
      let fringeTotal = 0;
      doc.fontSize(9).fillColor('#374151');
      for (const row of cb.sectionB.rows) {
        if (doc.y > 700) doc.addPage();
        const total = p(row.stdAmount) + p(row.premAmount);
        fringeTotal += total;
        doc.text(`${row.trade || '-'}: Std ${fmt(p(row.stdAmount))}, Prem ${fmt(p(row.premAmount))} = ${fmt(total)}`);
        doc.moveDown(0.4);
      }
      doc.fontSize(9).fillColor(primaryColor).text(`Fringes Subtotal (B+B1): ${fmt(fringeTotal)}`, { align: 'right' });
      doc.moveDown(0.5);
      subtotalAE += fringeTotal;
    }

    subtotalAE += renderItemTable('Section C — Equipment Rental', cb.sectionC?.rows || [], 'C');
    subtotalAE += renderItemTable('Section D — Owned Equipment', cb.sectionD?.rows || [], 'D');
    subtotalAE += renderItemTable('Section E — Trucking', cb.sectionE?.rows || [], 'E');

    const overheadAmt = sv.F !== false ? subtotalAE * (ohPct / 100) : 0;
    const materialTotal = renderItemTable('Section G — Material', cb.sectionG?.rows || [], 'G');
    const subtotalForProfit = subtotalAE + overheadAmt + materialTotal;
    const profitAmt = sv.H !== false ? subtotalForProfit * (profitPctVal / 100) : 0;

    let subTotal = 0;
    if (sv.I !== false && cb.sectionI?.rows?.length) {
      for (const row of cb.sectionI.rows) subTotal += p(row.total);
      if (doc.y > 650) doc.addPage();
      doc.fontSize(11).fillColor(primaryColor).text('Section I — Subcontractor');
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor('#374151');
      for (const row of cb.sectionI.rows) {
        if (doc.y > 700) doc.addPage();
        doc.text(`${row.description || '-'}: ${fmt(p(row.total))}`);
        doc.moveDown(0.4);
      }
      doc.fontSize(9).fillColor(primaryColor).text(`Subcontractor Subtotal: ${fmt(subTotal)}`, { align: 'right' });
      doc.moveDown(0.5);
    }
    const subMarkupAmt = sv.J !== false ? subTotal * (subPct / 100) : 0;

    let miscTotal = 0;
    if (sv.K !== false) {
      miscTotal = p(cb.sectionK?.bondInsurance) + p(cb.sectionK?.permits) + p(cb.sectionK?.lodging);
      if (cb.sectionK?.rows) {
        for (const row of cb.sectionK.rows) miscTotal += p(row.total);
      }
    }

    if (doc.y > 550) doc.addPage();
    doc.moveDown(0.5);
    doc.strokeColor(primaryColor).lineWidth(1).moveTo(300, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor('#374151');
    const summaryLines: [string, string][] = [
      ['Direct Costs (A-E):', fmt(subtotalAE)],
    ];
    if (sv.F !== false) summaryLines.push([`Overhead (${ohPct}%):`, fmt(overheadAmt)]);
    if (sv.G !== false) summaryLines.push(['Material (G):', fmt(materialTotal)]);
    if (sv.H !== false) summaryLines.push([`Profit (${profitPctVal}%):`, fmt(profitAmt)]);
    if (sv.I !== false) summaryLines.push(['Subcontractor (I):', fmt(subTotal)]);
    if (sv.J !== false) summaryLines.push([`Sub Markup (${subPct}%):`, fmt(subMarkupAmt)]);
    if (sv.K !== false && miscTotal > 0) summaryLines.push(['Miscellaneous (K):', fmt(miscTotal)]);

    for (const [label, value] of summaryLines) {
      doc.text(label, 300, doc.y, { continued: true, width: 170 });
      doc.text(value, { align: 'right', width: 90 });
      doc.moveDown(0.3);
    }

    const grandTotal = subtotalForProfit + profitAmt + subTotal + subMarkupAmt + miscTotal;
    doc.moveDown(0.3);
    doc.strokeColor(primaryColor).lineWidth(2).moveTo(300, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(primaryColor).text('TOTAL:', 300, doc.y, { continued: true, width: 170 });
    doc.text(fmt(grandTotal), { align: 'right', width: 90 });
    doc.moveDown(1);
  } else if (data.lineItems?.laborEntries?.length || data.lineItems?.materialEntries?.length || data.lineItems?.equipmentEntries?.length) {
    doc.fontSize(14).fillColor(primaryColor).text('COST BREAKDOWN (Legacy)', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#374151');
    if (data.lineItems?.laborEntries?.length) {
      doc.fontSize(11).fillColor(primaryColor).text('Labor');
      for (const e of data.lineItems.laborEntries) {
        doc.fontSize(9).fillColor('#374151').text(`${e.description}: ${e.hours}h × ${fmt(e.rate)} = ${fmt(e.total)}`);
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }
    if (data.lineItems?.materialEntries?.length) {
      doc.fontSize(11).fillColor(primaryColor).text('Material');
      for (const e of data.lineItems.materialEntries) {
        doc.fontSize(9).fillColor('#374151').text(`${e.description}: ${e.quantity} × ${fmt(e.unitCost)} = ${fmt(e.total)}`);
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }
    if (data.lineItems?.equipmentEntries?.length) {
      doc.fontSize(11).fillColor(primaryColor).text('Equipment');
      for (const e of data.lineItems.equipmentEntries) {
        doc.fontSize(9).fillColor('#374151').text(`${e.description}: ${e.days}d × ${fmt(e.rate)} = ${fmt(e.total)}`);
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }
    doc.fontSize(14).fillColor(primaryColor).text(`Total Amount: ${fmt(Number(co.amount || 0))}`, { align: 'right' });
    doc.moveDown(1);
  } else {
    doc.fontSize(12).fillColor(primaryColor).text('TOTAL AMOUNT', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(16).fillColor(primaryColor).text(fmt(Number(co.amount || 0)), { align: 'right' });
    doc.moveDown(1);
  }

  drawLine();

  if (data.approvals?.length) {
    if (doc.y > 600) doc.addPage();
    doc.fontSize(12).fillColor(primaryColor).text('APPROVAL CHAIN', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#374151');
    for (const a of data.approvals) {
      const statusIcon = a.status === 'APPROVED' ? '✓' : a.status === 'REJECTED' ? '✗' : '○';
      doc.text(`${statusIcon} Step ${a.stepOrder} — ${a.approverRole}: ${a.status}${a.approverName ? ` (${a.approverName})` : ''}${a.decidedAt ? ` on ${fmtDate(a.decidedAt)}` : ''}`);
      if (a.comments) doc.text(`   Comments: ${a.comments}`);
      doc.moveDown(0.3);
    }
    doc.moveDown(0.5);
  }

  if (co.rejectionReason) {
    doc.fontSize(10).fillColor('#dc2626').text(`Rejection Reason: ${co.rejectionReason}`);
    doc.moveDown(0.5);
  }

  if (doc.y > 550) doc.addPage();
  doc.moveDown(1);
  doc.fontSize(12).fillColor(primaryColor).text('SIGNATURES');
  doc.moveDown(1);

  const sigY = doc.y;
  doc.fontSize(10).fillColor('#374151');

  doc.text('OWNER / CLIENT', 50, sigY);
  doc.moveDown(2);
  doc.strokeColor('#374151').lineWidth(0.5).moveTo(50, doc.y).lineTo(260, doc.y).stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).text('Signature', 50);
  doc.moveDown(0.5);
  doc.strokeColor('#374151').lineWidth(0.5).moveTo(50, doc.y).lineTo(200, doc.y).stroke();
  doc.moveDown(0.3);
  doc.text('Date', 50);

  const rightX = 310;
  doc.fontSize(10).text('CONTRACTOR', rightX, sigY);
  doc.y = sigY;
  doc.moveDown(2);
  const lineY1 = sigY + 40;
  doc.strokeColor('#374151').lineWidth(0.5).moveTo(rightX, lineY1).lineTo(520, lineY1).stroke();
  doc.fontSize(9).text('Signature', rightX, lineY1 + 4);
  const lineY2 = lineY1 + 25;
  doc.strokeColor('#374151').lineWidth(0.5).moveTo(rightX, lineY2).lineTo(460, lineY2).stroke();
  doc.text('Date', rightX, lineY2 + 4);

  doc.moveDown(3);

  doc.fontSize(8).fillColor('#9ca3af').text('This document is a formal Change Order for the referenced project.', { align: 'center' });
  doc.text(`Generated on ${new Date().toLocaleString()} | ${co.changeOrderNumber}`, { align: 'center' });

  doc.end();
  return stream;
}
