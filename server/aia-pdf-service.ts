import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

interface G702Data {
  ownerName: string;
  ownerAddress: string;
  architectName: string;
  architectAddress: string;
  contractorName: string;
  contractorAddress: string;
  projectName: string;
  projectLocation: string;
  applicationNumber: number;
  periodTo: string;
  contractDate: string;
  contractFor: string;
  originalContractSum: number;
  netChangeByChangeOrders: number;
  contractSumToDate: number;
  totalCompletedAndStored: number;
  retainagePercent: number;
  totalRetained: number;
  totalEarnedLessRetainage: number;
  lessPreviousCertificates: number;
  currentPaymentDue: number;
  balanceToFinish: number;
  changeOrdersSummary: { number: string; date: string; amount: number }[];
}

interface G703LineItem {
  lineNumber: number;
  itemCode: string | null;
  payItemNumber?: string | null;
  specSection?: string | null;
  description: string;
  scheduledValue: number;
  previouslyCompleted: number;
  thisPeriodCompleted: number;
  materialsStored: number;
  totalCompletedAndStored: number;
  percentComplete: number;
  balanceToFinish: number;
  retainageAmount: number;
}

interface G703Data {
  applicationNumber: number;
  periodTo: string;
  projectName: string;
  contractorName: string;
  lineItems: G703LineItem[];
}

function fmt(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

export function generateAIAG702PDF(data: G702Data): PassThrough {
  const doc = new PDFDocument({ margin: 36, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const navy = '#1a365d';
  const pageW = 540;
  const leftX = 36;

  doc.fontSize(14).fillColor(navy).text('AIA DOCUMENT G702', leftX, 36, { align: 'center', width: pageW });
  doc.fontSize(10).fillColor('#374151').text('APPLICATION AND CERTIFICATE FOR PAYMENT', leftX, 52, { align: 'center', width: pageW });
  doc.moveDown(0.5);

  doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(leftX, doc.y).lineTo(leftX + pageW, doc.y).stroke();
  doc.moveDown(0.3);

  const colW = pageW / 2;
  let y = doc.y;

  doc.fontSize(8).fillColor('#6b7280').text('TO OWNER:', leftX, y);
  doc.fontSize(9).fillColor('#111827').text(data.ownerName || '', leftX, y + 10);
  doc.fontSize(8).fillColor('#374151').text(data.ownerAddress || '', leftX, y + 20);

  doc.fontSize(8).fillColor('#6b7280').text('FROM CONTRACTOR:', leftX + colW, y);
  doc.fontSize(9).fillColor('#111827').text(data.contractorName || '', leftX + colW, y + 10);
  doc.fontSize(8).fillColor('#374151').text(data.contractorAddress || '', leftX + colW, y + 20);

  y += 40;
  doc.fontSize(8).fillColor('#6b7280').text('VIA ARCHITECT:', leftX, y);
  doc.fontSize(9).fillColor('#111827').text(data.architectName || '', leftX, y + 10);
  doc.fontSize(8).fillColor('#374151').text(data.architectAddress || '', leftX, y + 20);

  doc.fontSize(8).fillColor('#6b7280').text('PROJECT:', leftX + colW, y);
  doc.fontSize(9).fillColor('#111827').text(data.projectName || '', leftX + colW, y + 10);
  doc.fontSize(8).fillColor('#374151').text(data.projectLocation || '', leftX + colW, y + 20);

  y += 40;
  doc.fontSize(8).fillColor('#6b7280').text(`APPLICATION NO: ${data.applicationNumber}`, leftX, y);
  doc.text(`PERIOD TO: ${fmtDate(data.periodTo)}`, leftX + 150, y);
  doc.text(`CONTRACT DATE: ${fmtDate(data.contractDate)}`, leftX + colW, y);

  y += 20;
  doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(leftX, y).lineTo(leftX + pageW, y).stroke();
  y += 8;

  doc.fontSize(10).fillColor(navy).text('CONTRACTOR\'S APPLICATION FOR PAYMENT', leftX, y, { width: pageW });
  y += 16;

  const summaryItems = [
    ['1. ORIGINAL CONTRACT SUM', fmt(data.originalContractSum)],
    ['2. Net change by Change Orders', fmt(data.netChangeByChangeOrders)],
    ['3. CONTRACT SUM TO DATE (Line 1 + 2)', fmt(data.contractSumToDate)],
    ['4. TOTAL COMPLETED & STORED TO DATE', fmt(data.totalCompletedAndStored)],
    [`5. RETAINAGE (${data.retainagePercent}%)`, fmt(data.totalRetained)],
    ['6. TOTAL EARNED LESS RETAINAGE (Line 4 - 5)', fmt(data.totalEarnedLessRetainage)],
    ['7. LESS PREVIOUS CERTIFICATES FOR PAYMENT', fmt(data.lessPreviousCertificates)],
    ['8. CURRENT PAYMENT DUE (Line 6 - 7)', fmt(data.currentPaymentDue)],
    ['9. BALANCE TO FINISH, INCLUDING RETAINAGE (Line 3 - 4)', fmt(data.balanceToFinish)],
  ];

  doc.fontSize(9).fillColor('#111827');
  for (const [label, value] of summaryItems) {
    const isTotal = label.includes('CURRENT PAYMENT DUE');
    if (isTotal) {
      doc.rect(leftX, y - 2, pageW, 16).fill('#e2e8f0');
      doc.fillColor(navy);
    }
    doc.text(label, leftX + 4, y, { width: 380 });
    doc.text(value, leftX + 380, y, { width: 156, align: 'right' });
    if (isTotal) doc.fillColor('#111827');
    y += 16;
  }

  if (data.changeOrdersSummary && data.changeOrdersSummary.length > 0) {
    y += 8;
    doc.fontSize(9).fillColor(navy).text('CHANGE ORDER SUMMARY', leftX, y, { width: pageW });
    y += 14;

    doc.fontSize(8).fillColor('#6b7280');
    doc.text('CO #', leftX + 4, y, { width: 80 });
    doc.text('Date', leftX + 84, y, { width: 100 });
    doc.text('Amount', leftX + 380, y, { width: 156, align: 'right' });
    y += 12;
    doc.strokeColor('#d1d5db').lineWidth(0.5).moveTo(leftX, y).lineTo(leftX + pageW, y).stroke();
    y += 4;

    doc.fontSize(8).fillColor('#111827');
    let coTotal = 0;
    for (const co of data.changeOrdersSummary) {
      doc.text(co.number, leftX + 4, y, { width: 80 });
      doc.text(fmtDate(co.date), leftX + 84, y, { width: 100 });
      doc.text(fmt(co.amount), leftX + 380, y, { width: 156, align: 'right' });
      coTotal += co.amount;
      y += 12;
    }

    doc.strokeColor('#d1d5db').lineWidth(0.5).moveTo(leftX, y).lineTo(leftX + pageW, y).stroke();
    y += 4;
    doc.fontSize(8).fillColor(navy).text('Total Change Orders:', leftX + 4, y, { width: 380 });
    doc.text(fmt(coTotal), leftX + 380, y, { width: 156, align: 'right' });
    y += 16;
  }

  y += 12;
  doc.strokeColor(navy).lineWidth(2).moveTo(leftX, y).lineTo(leftX + pageW, y).stroke();
  y += 12;

  doc.fontSize(10).fillColor(navy).text('ARCHITECT\'S CERTIFICATE FOR PAYMENT', leftX, y, { width: pageW });
  y += 14;
  doc.fontSize(8).fillColor('#374151');
  doc.text('In accordance with the Contract Documents, based on on-site observations and the data comprising the', leftX, y, { width: pageW });
  y += 10;
  doc.text('application, the Architect certifies to the Owner that to the best of the Architect\'s knowledge,', leftX, y, { width: pageW });
  y += 10;
  doc.text('information and belief the Work has progressed as indicated, the quality of the Work is in accordance', leftX, y, { width: pageW });
  y += 10;
  doc.text('with the Contract Documents, and the Contractor is entitled to payment of the AMOUNT CERTIFIED.', leftX, y, { width: pageW });

  y += 24;
  doc.fontSize(9).fillColor(navy).text('AMOUNT CERTIFIED: ' + fmt(data.currentPaymentDue), leftX, y);
  y += 20;

  doc.fontSize(8).fillColor('#374151');
  doc.text('ARCHITECT:', leftX, y);
  doc.text('By: ________________________________', leftX + 60, y);
  doc.text('Date: ____________', leftX + 350, y);
  y += 20;
  doc.text('CONTRACTOR:', leftX, y);
  doc.text('By: ________________________________', leftX + 60, y);
  doc.text('Date: ____________', leftX + 350, y);
  y += 20;
  doc.text('OWNER:', leftX, y);
  doc.text('By: ________________________________', leftX + 60, y);
  doc.text('Date: ____________', leftX + 350, y);

  doc.fontSize(7).fillColor('#9ca3af');
  doc.text(`Generated on ${new Date().toLocaleString()} | Application #${data.applicationNumber}`, leftX, 740, { align: 'center', width: pageW });

  doc.end();
  return stream;
}

export function generateAIAG703PDF(data: G703Data): PassThrough {
  const doc = new PDFDocument({ margin: 30, size: 'LETTER', layout: 'landscape' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const navy = '#1a365d';
  const pageW = 732;
  const leftX = 30;

  doc.fontSize(14).fillColor(navy).text('AIA DOCUMENT G703 - CONTINUATION SHEET', leftX, 30, { align: 'center', width: pageW });
  doc.fontSize(9).fillColor('#374151');
  doc.text(`Application No: ${data.applicationNumber}    Period To: ${fmtDate(data.periodTo)}    Project: ${data.projectName}`, leftX, 48, { align: 'center', width: pageW });
  doc.moveDown(0.5);

  const tableTop = doc.y + 4;
  const colWidths = [25, 70, 150, 65, 65, 65, 55, 70, 45, 65, 57];
  const headers = ['#', 'Pay Item / Code', 'Description of Work', 'Scheduled Value', 'From Previous', 'This Period', 'Materials Stored', 'Total Completed', '% Comp', 'Balance', 'Retainage'];

  doc.rect(leftX, tableTop, pageW, 18).fill(navy);
  let xPos = leftX;
  doc.fontSize(7).fillColor('#ffffff');
  headers.forEach((h, i) => {
    const align = i <= 2 ? 'left' : 'right';
    doc.text(h, xPos + 2, tableTop + 5, { width: colWidths[i] - 4, align });
    xPos += colWidths[i];
  });

  let yPos = tableTop + 20;
  const maxY = 520;

  for (let idx = 0; idx < data.lineItems.length; idx++) {
    const item = data.lineItems[idx];
    if (yPos > maxY) {
      doc.addPage();
      yPos = 40;
      doc.rect(leftX, yPos, pageW, 18).fill(navy);
      xPos = leftX;
      doc.fontSize(7).fillColor('#ffffff');
      headers.forEach((h, i) => {
        const align = i <= 2 ? 'left' : 'right';
        doc.text(h, xPos + 2, yPos + 5, { width: colWidths[i] - 4, align });
        xPos += colWidths[i];
      });
      yPos += 20;
    }

    if (idx % 2 === 0) {
      doc.rect(leftX, yPos, pageW, 16).fill('#f9fafb');
    }

    xPos = leftX;
    doc.fontSize(7).fillColor('#111827');
    const codeParts: string[] = [];
    if (item.payItemNumber) codeParts.push(item.payItemNumber);
    if (item.itemCode && item.itemCode !== item.payItemNumber) codeParts.push(item.itemCode);
    const codeLabel = codeParts.length > 0 ? codeParts.join(' / ') : '-';
    const codeWithSpec = item.specSection ? `${codeLabel}\n§${item.specSection}` : codeLabel;
    const rowData = [
      String(item.lineNumber),
      codeWithSpec,
      item.description.length > 34 ? item.description.substring(0, 34) + '...' : item.description,
      fmt(item.scheduledValue),
      fmt(item.previouslyCompleted),
      fmt(item.thisPeriodCompleted),
      fmt(item.materialsStored),
      fmt(item.totalCompletedAndStored),
      item.percentComplete.toFixed(1) + '%',
      fmt(item.balanceToFinish),
      fmt(item.retainageAmount),
    ];

    rowData.forEach((val, i) => {
      const align = i <= 2 ? 'left' : 'right';
      doc.text(val, xPos + 2, yPos + 4, { width: colWidths[i] - 4, align });
      xPos += colWidths[i];
    });
    yPos += 16;
  }

  doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(leftX, yPos).lineTo(leftX + pageW, yPos).stroke();
  yPos += 4;

  doc.rect(leftX, yPos, pageW, 18).fill('#e2e8f0');
  xPos = leftX;
  doc.fontSize(8).fillColor(navy);

  let totalScheduled = 0, totalPrevious = 0, totalCurrent = 0, totalStored = 0, totalCompleted = 0, totalRetainage = 0;
  data.lineItems.forEach(item => {
    totalScheduled += item.scheduledValue;
    totalPrevious += item.previouslyCompleted;
    totalCurrent += item.thisPeriodCompleted;
    totalStored += item.materialsStored;
    totalCompleted += item.totalCompletedAndStored;
    totalRetainage += item.retainageAmount;
  });

  const totalBalance = totalScheduled - totalCompleted;
  const totalPercent = totalScheduled > 0 ? (totalCompleted / totalScheduled) * 100 : 0;

  const totals = ['', '', 'GRAND TOTAL', fmt(totalScheduled), fmt(totalPrevious), fmt(totalCurrent), fmt(totalStored), fmt(totalCompleted), totalPercent.toFixed(1) + '%', fmt(totalBalance), fmt(totalRetainage)];
  totals.forEach((val, i) => {
    const align = i <= 2 ? 'left' : 'right';
    doc.text(val, xPos + 2, yPos + 5, { width: colWidths[i] - 4, align });
    xPos += colWidths[i];
  });

  doc.fontSize(7).fillColor('#9ca3af');
  doc.text(`AIA G703 Continuation Sheet | Generated ${new Date().toLocaleString()}`, leftX, 570, { align: 'center', width: pageW });

  doc.end();
  return stream;
}

