import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export interface DotProgressLineItem {
  lineNumber: number;
  payItemNumber: string | null;
  itemCode: string | null;
  description: string;
  unit: string | null;
  specSection: string | null;
  contractQty: number;
  priorQty: number;
  thisPeriodQty: number;
  totalQty: number;
  percentComplete: number;
  unitPrice: number;
  priorAmount: number;
  thisPeriodAmount: number;
  totalAmount: number;
}

export interface DotProgressEstimateData {
  applicationNumber: number;
  periodFrom: string;
  periodTo: string;
  projectName: string;
  projectCode: string | null;
  projectLocation: string;
  contractorName: string;
  ownerName: string;
  agencyName: string | null;
  agencyCode: string | null;
  contractNumber: string | null;
  originalContractSum: number;
  netChangeOrders: number;
  contractSumToDate: number;
  totalCompletedToDate: number;
  retainagePercent: number;
  totalRetained: number;
  lessPreviousCertificates: number;
  currentPaymentDue: number;
  balanceToFinish: number;
  lineItems: DotProgressLineItem[];
}

function fmtMoney(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

export function generateDotProgressEstimatePDF(data: DotProgressEstimateData): PassThrough {
  const doc = new PDFDocument({ margin: 30, size: 'LETTER', layout: 'landscape' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const navy = '#1a365d';
  const pageW = 732;
  const leftX = 30;

  // ===== Cover Header =====
  doc.fontSize(14).fillColor(navy).text('DOT PROGRESS ESTIMATE', leftX, 30, { align: 'center', width: pageW });
  const subtitle = data.agencyName ? `${data.agencyName}${data.agencyCode ? ` (${data.agencyCode})` : ''}` : 'State Department of Transportation';
  doc.fontSize(10).fillColor('#374151').text(subtitle, leftX, 48, { align: 'center', width: pageW });

  doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(leftX, 66).lineTo(leftX + pageW, 66).stroke();

  // ===== Project / Period block =====
  let y = 74;
  const colW = pageW / 2;
  doc.fontSize(8).fillColor('#6b7280').text('PROJECT:', leftX, y);
  doc.fontSize(9).fillColor('#111827').text(`${data.projectCode ? data.projectCode + ' — ' : ''}${data.projectName}`, leftX, y + 10);
  doc.fontSize(8).fillColor('#374151').text(data.projectLocation, leftX, y + 22);

  doc.fontSize(8).fillColor('#6b7280').text('CONTRACTOR:', leftX + colW, y);
  doc.fontSize(9).fillColor('#111827').text(data.contractorName || '', leftX + colW, y + 10);

  y += 36;
  doc.fontSize(8).fillColor('#6b7280').text('OWNER:', leftX, y);
  doc.fontSize(9).fillColor('#111827').text(data.ownerName || '', leftX, y + 10);

  doc.fontSize(8).fillColor('#6b7280').text('CONTRACT NO:', leftX + colW, y);
  doc.fontSize(9).fillColor('#111827').text(data.contractNumber || '—', leftX + colW, y + 10);

  y += 26;
  doc.fontSize(8).fillColor('#6b7280').text(`ESTIMATE NO: ${data.applicationNumber}`, leftX, y);
  doc.text(`PERIOD: ${fmtDate(data.periodFrom)} — ${fmtDate(data.periodTo)}`, leftX + 160, y);

  y += 14;
  doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(leftX, y).lineTo(leftX + pageW, y).stroke();
  y += 8;

  // ===== Summary box (right) and pay-item table (full width below) =====
  const summary = [
    ['Original Contract', fmtMoney(data.originalContractSum)],
    ['Net Change Orders', fmtMoney(data.netChangeOrders)],
    ['Contract Sum to Date', fmtMoney(data.contractSumToDate)],
    ['Completed to Date', fmtMoney(data.totalCompletedToDate)],
    [`Retainage (${data.retainagePercent}%)`, fmtMoney(data.totalRetained)],
    ['Less Previous Estimates', fmtMoney(data.lessPreviousCertificates)],
  ];
  const sumX = leftX + pageW - 280;
  doc.fontSize(8).fillColor('#374151');
  for (const [label, value] of summary) {
    doc.text(label, sumX, y, { width: 180 });
    doc.text(value, sumX + 180, y, { width: 100, align: 'right' });
    y += 11;
  }
  doc.rect(sumX - 4, y - 2, 284, 16).fill('#e2e8f0');
  doc.fontSize(9).fillColor(navy).text('AMOUNT DUE THIS PERIOD', sumX, y + 2, { width: 180 });
  doc.text(fmtMoney(data.currentPaymentDue), sumX + 180, y + 2, { width: 100, align: 'right' });
  y += 18;
  doc.fontSize(8).fillColor('#374151');
  doc.text('Balance to Finish', sumX, y, { width: 180 });
  doc.text(fmtMoney(data.balanceToFinish), sumX + 180, y, { width: 100, align: 'right' });
  y += 16;

  // ===== Pay-item table grouped by spec section =====
  doc.fontSize(10).fillColor(navy).text('PAY ITEMS — QUANTITIES COMPLETED', leftX, y, { width: pageW });
  y += 14;

  const colWidths = [22, 60, 140, 28, 46, 46, 46, 46, 36, 56, 66, 70, 70];
  const headers = [
    '#', 'Pay Item', 'Description', 'Unit', 'Contract Qty', 'Prior Qty', 'This Period', 'Total Qty', '% Comp', 'Unit Price', 'Prior $', 'This Period $', 'Total Amount',
  ];

  const drawHeader = (yPos: number) => {
    doc.rect(leftX, yPos, pageW, 18).fill(navy);
    let xPos = leftX;
    doc.fontSize(7).fillColor('#ffffff');
    headers.forEach((h, i) => {
      const align = i <= 2 ? 'left' : 'right';
      doc.text(h, xPos + 2, yPos + 5, { width: colWidths[i] - 4, align });
      xPos += colWidths[i];
    });
    return yPos + 20;
  };

  y = drawHeader(y);
  const maxY = 540;

  // Group by spec section
  const grouped = new Map<string, DotProgressLineItem[]>();
  for (const li of data.lineItems) {
    const key = li.specSection || 'Other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(li);
  }
  const sortedSections = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let totalContract = 0, totalPrior = 0, totalThis = 0, totalSum = 0, totalScheduled = 0;

  for (const section of sortedSections) {
    if (y > maxY) {
      doc.addPage();
      y = drawHeader(40);
    }
    // Section header band
    doc.rect(leftX, y, pageW, 14).fill('#f1f5f9');
    doc.fontSize(8).fillColor(navy).text(`§ ${section}`, leftX + 4, y + 3, { width: pageW - 8 });
    y += 16;

    const items = grouped.get(section)!;
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (y > maxY) {
        doc.addPage();
        y = drawHeader(40);
      }

      if (idx % 2 === 0) {
        doc.rect(leftX, y, pageW, 14).fill('#f9fafb');
      }

      const codeLabel = item.payItemNumber || item.itemCode || '-';
      const desc = item.description.length > 42 ? item.description.substring(0, 42) + '…' : item.description;
      const rowData = [
        String(item.lineNumber),
        codeLabel,
        desc,
        item.unit || '-',
        fmtQty(item.contractQty),
        fmtQty(item.priorQty),
        fmtQty(item.thisPeriodQty),
        fmtQty(item.totalQty),
        item.percentComplete.toFixed(1) + '%',
        fmtMoney(item.unitPrice),
        fmtMoney(item.priorAmount),
        fmtMoney(item.thisPeriodAmount),
        fmtMoney(item.totalAmount),
      ];

      let xPos = leftX;
      doc.fontSize(7).fillColor('#111827');
      rowData.forEach((val, i) => {
        const align = i <= 2 ? 'left' : 'right';
        doc.text(val, xPos + 2, y + 3, { width: colWidths[i] - 4, align });
        xPos += colWidths[i];
      });
      y += 14;

      totalContract += item.contractQty;
      totalPrior += item.priorAmount;
      totalThis += item.thisPeriodAmount;
      totalSum += item.totalAmount;
      totalScheduled += item.contractQty * item.unitPrice;
    }
  }

  // Grand totals
  if (y > maxY) {
    doc.addPage();
    y = 40;
  }
  doc.rect(leftX, y, pageW, 18).fill('#e2e8f0');
  let xPos = leftX;
  doc.fontSize(8).fillColor(navy);
  const totals = ['', '', 'GRAND TOTAL', '', '', '', '', '', '', fmtMoney(totalScheduled), fmtMoney(totalPrior), fmtMoney(totalThis), fmtMoney(totalSum)];
  totals.forEach((val, i) => {
    const align = i <= 2 ? 'left' : 'right';
    doc.text(val, xPos + 2, y + 5, { width: colWidths[i] - 4, align });
    xPos += colWidths[i];
  });
  y += 22;

  // ===== Signature block =====
  if (y > 520) { doc.addPage(); y = 40; }
  y += 8;
  doc.fontSize(9).fillColor(navy).text('CERTIFICATION & APPROVAL', leftX, y, { width: pageW });
  y += 14;
  doc.fontSize(7).fillColor('#374151');
  doc.text('I hereby certify that the quantities reported above are correct and that the work has been satisfactorily performed in accordance with the contract documents.', leftX, y, { width: pageW });
  y += 24;

  const sigW = (pageW - 24) / 3;
  ['CONTRACTOR', 'PROJECT ENGINEER', 'OWNER / AGENCY'].forEach((role, i) => {
    const sigX = leftX + i * (sigW + 12);
    doc.fontSize(7).fillColor('#6b7280').text(role, sigX, y);
    doc.strokeColor('#9ca3af').lineWidth(0.5).moveTo(sigX, y + 28).lineTo(sigX + sigW - 8, y + 28).stroke();
    doc.text('Signature', sigX, y + 30);
    doc.text('Date: ____________', sigX, y + 42);
  });

  doc.fontSize(7).fillColor('#9ca3af');
  doc.text(`DOT Progress Estimate #${data.applicationNumber} | Generated ${new Date().toLocaleString()}`, leftX, 570, { align: 'center', width: pageW });

  doc.end();
  return stream;
}
