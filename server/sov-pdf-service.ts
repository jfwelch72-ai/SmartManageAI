import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

interface SOVBranding {
  organizationName: string;
  primaryColor?: string;
  accentColor?: string;
}

interface SOVLineItem {
  lineNumber: number;
  itemCode: string | null;
  description: string;
  category: string | null;
  scheduledValue: string | null;
  previouslyCompleted: string | null;
  thisPeriodCompleted: string | null;
  materialsStored: string | null;
  totalCompletedAndStored: string | null;
  percentComplete: string | null;
  balanceToFinish: string | null;
  retainageAmount: string | null;
}

interface SOVData {
  sov: {
    sovNumber: string;
    title: string;
    description: string | null;
    contractValue: string | null;
    retainagePercent: string | null;
    periodNumber: number;
    periodStart: string | null;
    periodEnd: string | null;
    status: string;
    totalScheduledValue: string | null;
    totalPreviouslyCompleted: string | null;
    totalThisPeriod: string | null;
    totalCompletedToDate: string | null;
    totalMaterialsStored: string | null;
    totalRetainage: string | null;
    totalEarnedLessRetainage: string | null;
    createdAt: Date;
  };
  lineItems: SOVLineItem[];
  project: {
    name: string;
    code: string;
    clientName?: string;
    locationAddress?: string | null;
    city?: string | null;
    state?: string | null;
  };
  branding?: SOVBranding;
}

function formatCurrency(value: string | number | null): string {
  if (value === null || value === undefined) return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: string | number | null): string {
  if (value === null || value === undefined) return '0.00%';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0.00%';
  return num.toFixed(2) + '%';
}

function formatDate(dateStr: string | null | Date): string {
  if (!dateStr) return 'N/A';
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function generateSOVPDF(data: SOVData): PassThrough {
  const doc = new PDFDocument({ 
    margin: 30, 
    size: 'LETTER',
    layout: 'landscape'
  });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const accentColor = data.branding?.accentColor || '#2563eb';
  const companyName = data.branding?.organizationName || 'SmartManageAI';
  const lightGray = '#f3f4f6';
  const borderColor = '#e5e7eb';

  doc.fontSize(20).fillColor(primaryColor).text(companyName, { align: 'center' });
  doc.fontSize(16).fillColor('#374151').text('SCHEDULE OF VALUES', { align: 'center' });
  doc.moveDown(0.3);

  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(30, doc.y)
    .lineTo(762, doc.y)
    .stroke();
  doc.moveDown(0.5);

  const infoY = doc.y;
  doc.fontSize(10).fillColor('#374151');
  
  doc.text(`SOV Number: ${data.sov.sovNumber}`, 30, infoY);
  doc.text(`Project: ${data.project.name}`, 30, infoY + 12);
  doc.text(`Project Code: ${data.project.code}`, 30, infoY + 24);
  if (data.project.clientName) {
    doc.text(`Client: ${data.project.clientName}`, 30, infoY + 36);
  }

  doc.text(`Period: ${data.sov.periodNumber}`, 400, infoY);
  doc.text(`Period Start: ${formatDate(data.sov.periodStart)}`, 400, infoY + 12);
  doc.text(`Period End: ${formatDate(data.sov.periodEnd)}`, 400, infoY + 24);
  doc.text(`Status: ${data.sov.status}`, 400, infoY + 36);

  doc.text(`Contract Value: ${formatCurrency(data.sov.contractValue)}`, 600, infoY);
  doc.text(`Retainage: ${formatPercent(data.sov.retainagePercent)}`, 600, infoY + 12);
  doc.text(`Date: ${formatDate(new Date())}`, 600, infoY + 24);

  doc.y = infoY + 55;
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const colWidths = [30, 45, 175, 65, 65, 65, 55, 75, 50, 65, 55];
  const headers = ['#', 'Code', 'Description', 'Scheduled', 'Previous', 'This Period', 'Stored', 'Completed', '%', 'Balance', 'Retain'];
  
  doc.rect(30, tableTop, 732, 18).fill(primaryColor);
  
  let xPos = 30;
  doc.fontSize(8).fillColor('#ffffff');
  headers.forEach((header, i) => {
    const align = i <= 2 ? 'left' : 'right';
    const padding = i <= 2 ? 3 : 0;
    doc.text(header, xPos + padding, tableTop + 5, { width: colWidths[i] - 6, align });
    xPos += colWidths[i];
  });

  let yPos = tableTop + 20;
  const maxY = 520;

  data.lineItems.forEach((item, index) => {
    if (yPos > maxY) {
      doc.addPage();
      yPos = 40;
      
      doc.rect(30, yPos, 732, 18).fill(primaryColor);
      xPos = 30;
      doc.fontSize(8).fillColor('#ffffff');
      headers.forEach((header, i) => {
        const align = i <= 2 ? 'left' : 'right';
        const padding = i <= 2 ? 3 : 0;
        doc.text(header, xPos + padding, yPos + 5, { width: colWidths[i] - 6, align });
        xPos += colWidths[i];
      });
      yPos += 20;
    }

    if (index % 2 === 0) {
      doc.rect(30, yPos, 732, 16).fill(lightGray);
    }

    xPos = 30;
    doc.fontSize(8).fillColor('#374151');
    
    const rowData = [
      String(item.lineNumber),
      item.itemCode || '-',
      item.description.length > 35 ? item.description.substring(0, 35) + '...' : item.description,
      formatCurrency(item.scheduledValue),
      formatCurrency(item.previouslyCompleted),
      formatCurrency(item.thisPeriodCompleted),
      formatCurrency(item.materialsStored),
      formatCurrency(item.totalCompletedAndStored),
      formatPercent(item.percentComplete),
      formatCurrency(item.balanceToFinish),
      formatCurrency(item.retainageAmount),
    ];

    rowData.forEach((val, i) => {
      const align = i <= 2 ? 'left' : 'right';
      const padding = i <= 2 ? 3 : 0;
      doc.text(val, xPos + padding, yPos + 4, { width: colWidths[i] - 6, align });
      xPos += colWidths[i];
    });

    yPos += 16;
  });

  doc.strokeColor(borderColor).lineWidth(1)
    .moveTo(30, yPos)
    .lineTo(762, yPos)
    .stroke();

  yPos += 5;
  doc.rect(30, yPos, 732, 20).fill('#e2e8f0');
  
  xPos = 30;
  doc.fontSize(9).fillColor(primaryColor);
  
  const totals = [
    '',
    '',
    'TOTALS',
    formatCurrency(data.sov.totalScheduledValue),
    formatCurrency(data.sov.totalPreviouslyCompleted),
    formatCurrency(data.sov.totalThisPeriod),
    formatCurrency(data.sov.totalMaterialsStored),
    formatCurrency(data.sov.totalCompletedToDate),
    '',
    '',
    formatCurrency(data.sov.totalRetainage),
  ];

  totals.forEach((val, i) => {
    const align = i <= 2 ? 'left' : 'right';
    const padding = i <= 2 ? 3 : 0;
    doc.text(val, xPos + padding, yPos + 6, { width: colWidths[i] - 6, align });
    xPos += colWidths[i];
  });

  yPos += 30;

  if (yPos > 450) {
    doc.addPage();
    yPos = 50;
  }

  doc.fontSize(12).fillColor(primaryColor).text('SUMMARY', 30, yPos);
  yPos += 20;

  const summaryData = [
    ['Total Scheduled Value:', formatCurrency(data.sov.totalScheduledValue)],
    ['Work Completed - Previous Applications:', formatCurrency(data.sov.totalPreviouslyCompleted)],
    ['Work Completed - This Period:', formatCurrency(data.sov.totalThisPeriod)],
    ['Materials Presently Stored:', formatCurrency(data.sov.totalMaterialsStored)],
    ['Total Completed and Stored to Date:', formatCurrency(data.sov.totalCompletedToDate)],
    ['Less Retainage (' + formatPercent(data.sov.retainagePercent) + '):', formatCurrency(data.sov.totalRetainage)],
  ];

  doc.fontSize(10).fillColor('#374151');
  summaryData.forEach((row) => {
    doc.text(row[0], 30, yPos, { continued: true, width: 300 });
    doc.text(row[1], { align: 'right', width: 100 });
    yPos += 14;
  });

  yPos += 5;
  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(30, yPos)
    .lineTo(430, yPos)
    .stroke();
  yPos += 8;

  doc.fontSize(12).fillColor(primaryColor);
  doc.text('TOTAL EARNED LESS RETAINAGE:', 30, yPos, { continued: true, width: 300 });
  doc.text(formatCurrency(data.sov.totalEarnedLessRetainage), { align: 'right', width: 100 });

  yPos += 40;

  doc.fontSize(10).fillColor('#374151');
  doc.text('Contractor Signature: ________________________________', 30, yPos);
  doc.text('Date: ________________', 350, yPos);
  
  yPos += 25;
  doc.text('Owner/Architect Approval: ________________________________', 30, yPos);
  doc.text('Date: ________________', 350, yPos);

  doc.fontSize(8).fillColor('#9ca3af');
  doc.text(`Generated on ${new Date().toLocaleString()} | ${data.sov.sovNumber}`, 30, 580, { align: 'center', width: 732 });

  doc.end();
  return stream;
}
