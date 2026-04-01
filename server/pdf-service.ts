import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export interface OrganizationBrandingPDF {
  organizationName: string;
  primaryColor?: string;
  accentColor?: string;
}

function renderPDFHeader(
  doc: PDFKit.PDFDocument, 
  branding?: OrganizationBrandingPDF,
  subtitle?: string
) {
  const companyName = branding?.organizationName || 'SmartManageAI';
  const primaryColor = branding?.primaryColor || '#1a365d';

  doc.fontSize(24).fillColor(primaryColor).text(companyName, { align: 'center' });
  if (subtitle) {
    doc.fontSize(18).fillColor('#374151').text(subtitle, { align: 'center' });
  }
  doc.moveDown(0.5);
}

interface ScopeItem {
  description: string;
  category: string;
  quantity: number;
  unit: string;
  totalCost: number;
  laborCost: number;
  materialCost: number;
  equipmentCost: number;
  subcontractCost: number;
}

interface Quote {
  subcontractorName: string;
  scopeOfWork: string;
  quoteAmount: number;
  isSelected: boolean;
}

interface MaterialQuote {
  materialName: string;
  description: string;
  cost: number;
  supplierName: string | null;
  isSelected: boolean;
}

interface EquipmentSelection {
  equipmentName: string;
  equipmentType: string;
  source: string;
  plannedDays: number | null;
  plannedHours: number | null;
  estimatedCost: number | null;
}

interface BidData {
  bid: {
    id: string;
    name: string;
    code: string;
    clientName: string;
    clientContactName: string | null;
    clientContactEmail: string | null;
    clientContactPhone: string | null;
    locationAddress: string | null;
    city: string | null;
    state: string | null;
    description: string | null;
    bidAmount: number | null;
    dueDate: Date | null;
  };
  scopeItems: ScopeItem[];
  subQuotes: Quote[];
  materialQuotes: MaterialQuote[];
  equipmentSelections: EquipmentSelection[];
  summary: {
    totalDirectCost: number;
    overheadPercent: number;
    overheadAmount: number;
    profitPercent: number;
    profitAmount: number;
    finalBidAmount: number;
    taxRate?: number;
    taxAmount?: number;
  };
  branding?: OrganizationBrandingPDF;
}

export function generateInternalBidSummaryPDF(data: BidData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const accentColor = data.branding?.accentColor || '#2563eb';
  const lightGray = '#f3f4f6';

  renderPDFHeader(doc, data.branding, 'Internal Bid Summary');

  doc.fontSize(14).fillColor(primaryColor).text(`Bid: ${data.bid.name}`);
  doc.fontSize(10).fillColor('#374151').text(`Bid Code: ${data.bid.code}`);
  doc.text(`Client: ${data.bid.clientName}`);
  if (data.bid.locationAddress) {
    const address = [data.bid.locationAddress, data.bid.city, data.bid.state].filter(Boolean).join(', ');
    doc.text(`Location: ${address}`);
  }
  if (data.bid.dueDate) {
    doc.text(`Due Date: ${new Date(data.bid.dueDate).toLocaleDateString()}`);
  }
  doc.text(`Generated: ${new Date().toLocaleDateString()}`);
  doc.moveDown();

  const drawLine = () => {
    doc.strokeColor('#e5e7eb').lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(562, doc.y)
      .stroke();
    doc.moveDown(0.3);
  };

  doc.fontSize(14).fillColor(primaryColor).text('SCOPE OF WORK', { underline: true });
  doc.moveDown(0.5);

  if (data.scopeItems.length > 0) {
    const tableTop = doc.y;
    const colWidths = [200, 60, 40, 70, 80];
    const headers = ['Description', 'Qty', 'Unit', 'Category', 'Total'];

    doc.fontSize(9).fillColor('#6b7280');
    let xPos = 50;
    headers.forEach((header, i) => {
      doc.text(header, xPos, tableTop, { width: colWidths[i], align: i === 4 ? 'right' : 'left' });
      xPos += colWidths[i] + 10;
    });

    doc.moveDown(0.5);
    drawLine();

    doc.fontSize(9).fillColor('#374151');
    data.scopeItems.forEach((item) => {
      if (doc.y > 700) {
        doc.addPage();
      }
      xPos = 50;
      const y = doc.y;
      doc.text(item.description.substring(0, 40), xPos, y, { width: colWidths[0] });
      doc.text(item.quantity.toString(), xPos + colWidths[0] + 10, y, { width: colWidths[1] });
      doc.text(item.unit, xPos + colWidths[0] + colWidths[1] + 20, y, { width: colWidths[2] });
      doc.text(item.category, xPos + colWidths[0] + colWidths[1] + colWidths[2] + 30, y, { width: colWidths[3] });
      doc.text(`$${item.totalCost.toLocaleString()}`, xPos + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 40, y, { width: colWidths[4], align: 'right' });
      doc.moveDown(0.8);
    });

    const scopeTotal = data.scopeItems.reduce((sum, item) => sum + item.totalCost, 0);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(primaryColor)
      .text(`Scope Total: $${scopeTotal.toLocaleString()}`, 50, doc.y, { align: 'right', width: 500 });
  } else {
    doc.fontSize(10).fillColor('#6b7280').text('No scope items defined');
  }

  doc.moveDown();
  drawLine();

  if (data.materialQuotes.length > 0) {
    doc.fontSize(14).fillColor(primaryColor).text('MATERIAL QUOTES', { underline: true });
    doc.moveDown(0.5);

    const selectedMaterials = data.materialQuotes.filter(q => q.isSelected);
    const nonSelectedMaterials = data.materialQuotes.filter(q => !q.isSelected);

    if (selectedMaterials.length > 0) {
      doc.fontSize(11).fillColor(accentColor).text('Selected Quotes:');
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#374151');
      selectedMaterials.forEach(quote => {
        if (doc.y > 700) doc.addPage();
        doc.text(`• ${quote.materialName} - $${Number(quote.cost).toLocaleString()}${quote.supplierName ? ` (${quote.supplierName})` : ''}`);
        doc.moveDown(0.3);
      });
    }

    if (nonSelectedMaterials.length > 0) {
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#6b7280').text('Other Quotes:');
      doc.fontSize(9);
      nonSelectedMaterials.forEach(quote => {
        if (doc.y > 700) doc.addPage();
        doc.text(`• ${quote.materialName} - $${Number(quote.cost).toLocaleString()}${quote.supplierName ? ` (${quote.supplierName})` : ''}`);
        doc.moveDown(0.3);
      });
    }

    const materialTotal = selectedMaterials.reduce((sum, q) => sum + Number(q.cost), 0);
    doc.fontSize(10).fillColor(primaryColor)
      .text(`Selected Materials Total: $${materialTotal.toLocaleString()}`, { align: 'right' });
    doc.moveDown();
    drawLine();
  }

  if (data.equipmentSelections.length > 0) {
    if (doc.y > 600) doc.addPage();
    doc.fontSize(14).fillColor(primaryColor).text('EQUIPMENT', { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(9).fillColor('#374151');
    data.equipmentSelections.forEach(eq => {
      if (doc.y > 700) doc.addPage();
      const cost = eq.estimatedCost ? `$${Number(eq.estimatedCost).toLocaleString()}` : 'TBD';
      const duration = eq.plannedDays ? `${eq.plannedDays} days` : eq.plannedHours ? `${eq.plannedHours} hours` : '';
      doc.text(`• ${eq.equipmentName} (${eq.source}) - ${eq.equipmentType}${duration ? ` - ${duration}` : ''} - ${cost}`);
      doc.moveDown(0.3);
    });

    const equipmentTotal = data.equipmentSelections.reduce((sum, eq) => sum + (Number(eq.estimatedCost) || 0), 0);
    doc.fontSize(10).fillColor(primaryColor)
      .text(`Equipment Total: $${equipmentTotal.toLocaleString()}`, { align: 'right' });
    doc.moveDown();
    drawLine();
  }

  if (data.subQuotes.length > 0) {
    if (doc.y > 600) doc.addPage();
    doc.fontSize(14).fillColor(primaryColor).text('SUBCONTRACTOR QUOTES', { underline: true });
    doc.moveDown(0.5);

    const selectedSubs = data.subQuotes.filter(q => q.isSelected);
    const nonSelectedSubs = data.subQuotes.filter(q => !q.isSelected);

    if (selectedSubs.length > 0) {
      doc.fontSize(11).fillColor(accentColor).text('Selected Quotes:');
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#374151');
      selectedSubs.forEach(quote => {
        if (doc.y > 700) doc.addPage();
        doc.text(`• ${quote.subcontractorName} - ${quote.scopeOfWork}`);
        doc.text(`  Quote: $${Number(quote.quoteAmount).toLocaleString()}`, { indent: 10 });
        doc.moveDown(0.4);
      });
    }

    if (nonSelectedSubs.length > 0) {
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#6b7280').text('Other Quotes:');
      doc.fontSize(9);
      nonSelectedSubs.forEach(quote => {
        if (doc.y > 700) doc.addPage();
        doc.text(`• ${quote.subcontractorName} - $${Number(quote.quoteAmount).toLocaleString()}`);
        doc.moveDown(0.3);
      });
    }

    const subTotal = selectedSubs.reduce((sum, q) => sum + Number(q.quoteAmount), 0);
    doc.fontSize(10).fillColor(primaryColor)
      .text(`Selected Subcontractors Total: $${subTotal.toLocaleString()}`, { align: 'right' });
    doc.moveDown();
    drawLine();
  }

  if (doc.y > 500) doc.addPage();
  doc.fontSize(14).fillColor(primaryColor).text('BID SUMMARY', { underline: true });
  doc.moveDown(0.5);

  const summaryItems = [
    ['Total Direct Cost:', `$${data.summary.totalDirectCost.toLocaleString()}`],
    [`Overhead (${data.summary.overheadPercent}%):`, `$${data.summary.overheadAmount.toLocaleString()}`],
    [`Profit (${data.summary.profitPercent}%):`, `$${data.summary.profitAmount.toLocaleString()}`],
  ];

  doc.fontSize(11).fillColor('#374151');
  summaryItems.forEach(([label, value]) => {
    doc.text(label, 300, doc.y, { continued: true, width: 150 });
    doc.text(value, { align: 'right', width: 100 });
    doc.moveDown(0.4);
  });

  doc.moveDown(0.3);
  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(300, doc.y)
    .lineTo(512, doc.y)
    .stroke();
  doc.moveDown(0.5);

  doc.fontSize(16).fillColor(primaryColor)
    .text('FINAL BID AMOUNT:', 300, doc.y, { continued: true, width: 150 });
  doc.text(`$${data.summary.finalBidAmount.toLocaleString()}`, { align: 'right', width: 100 });

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#9ca3af')
    .text('CONFIDENTIAL - FOR INTERNAL USE ONLY', { align: 'center' });
  doc.text(`Generated on ${new Date().toLocaleString()}`, { align: 'center' });

  doc.end();
  return stream;
}

// Delay Notification PDF data interface
interface DelayNotificationData {
  notification: {
    subject: string;
    body: string;
    recipientName: string;
    recipientCompany: string | null;
    recipientEmail: string | null;
    recipientType: string;
    createdAt: Date;
  };
  delay: {
    delayNumber: string;
    reason: string;
    reasonLabel: string;
    reasonNotes: string | null;
    startDateTime: Date;
    endDateTime: Date | null;
    financiallyResponsible: string;
    responsibilityLabel: string;
    changeOrderRequired: boolean;
    status: string;
  };
  project: {
    name: string;
    code: string;
    clientName: string;
    locationAddress: string | null;
    city: string | null;
    state: string | null;
  };
  createdBy: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  branding?: OrganizationBrandingPDF;
}

export function generateDelayNotificationPDF(data: DelayNotificationData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const accentColor = '#dc2626';
  const companyName = data.branding?.organizationName || 'SmartManageAI';

  // Company Letterhead
  doc.fontSize(28).fillColor(primaryColor).text(companyName, { align: 'center' });
  doc.fontSize(10).fillColor('#6b7280').text('Construction Management', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).text('Contact your company administrator for details', { align: 'center' });
  doc.moveDown();

  // Decorative line
  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown();

  // Document Title
  doc.fontSize(16).fillColor(accentColor).text('PROJECT DELAY NOTIFICATION', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#374151').text(`Reference: ${data.delay.delayNumber}`, { align: 'center' });
  doc.moveDown();

  // Date and reference info
  const formattedDate = new Date(data.notification.createdAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  doc.fontSize(11).fillColor('#374151').text(formattedDate, { align: 'right' });
  doc.moveDown();

  // Recipient block
  doc.fontSize(12).fillColor(primaryColor).text('TO:');
  doc.fontSize(11).fillColor('#374151');
  doc.text(data.notification.recipientName);
  if (data.notification.recipientCompany) {
    doc.text(data.notification.recipientCompany);
  }
  if (data.notification.recipientEmail) {
    doc.text(data.notification.recipientEmail);
  }
  doc.moveDown();

  // Subject line
  doc.fontSize(11).fillColor(primaryColor).text('RE: ', { continued: true });
  doc.fillColor('#374151').text(data.notification.subject);
  doc.moveDown();

  // Light separator
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown();

  // Letter body - split by newlines and render each paragraph
  doc.fontSize(11).fillColor('#374151');
  const paragraphs = data.notification.body.split('\n');
  paragraphs.forEach(paragraph => {
    if (paragraph.trim()) {
      doc.text(paragraph.trim(), { align: 'justify', lineGap: 2 });
      doc.moveDown(0.5);
    } else {
      doc.moveDown(0.5);
    }
  });

  doc.moveDown();

  // Delay Details Summary Box
  if (doc.y > 550) doc.addPage();
  
  const boxTop = doc.y;
  doc.rect(50, boxTop, 512, 120).fillAndStroke('#f8fafc', '#e2e8f0');
  
  doc.fontSize(11).fillColor(primaryColor).text('DELAY DETAILS', 60, boxTop + 10);
  
  const detailsY = boxTop + 30;
  doc.fontSize(10).fillColor('#374151');
  
  // Left column
  doc.text(`Project: ${data.project.name}`, 60, detailsY);
  doc.text(`Project Code: ${data.project.code}`, 60, detailsY + 15);
  doc.text(`Delay Reason: ${data.delay.reasonLabel}`, 60, detailsY + 30);
  doc.text(`Status: ${data.delay.status}`, 60, detailsY + 45);
  
  // Right column
  const startDate = new Date(data.delay.startDateTime).toLocaleDateString();
  const endDate = data.delay.endDateTime ? new Date(data.delay.endDateTime).toLocaleDateString() : 'Ongoing';
  doc.text(`Start Date: ${startDate}`, 300, detailsY);
  doc.text(`End Date: ${endDate}`, 300, detailsY + 15);
  doc.text(`Financially Responsible: ${data.delay.responsibilityLabel}`, 300, detailsY + 30);
  if (data.delay.changeOrderRequired) {
    doc.fillColor(accentColor).text('Change Order Required: Yes', 300, detailsY + 45);
  } else {
    doc.text('Change Order Required: No', 300, detailsY + 45);
  }

  doc.y = boxTop + 130;
  doc.moveDown();

  // Signature block
  if (doc.y > 620) doc.addPage();
  
  doc.fontSize(11).fillColor('#374151');
  doc.text('Please acknowledge receipt of this notification and contact us should you have any questions.');
  doc.moveDown(2);
  
  doc.text('Respectfully,');
  doc.moveDown(2);
  
  // Signature line
  doc.strokeColor('#374151').lineWidth(0.5)
    .moveTo(50, doc.y)
    .lineTo(250, doc.y)
    .stroke();
  doc.moveDown(0.3);
  
  doc.fontSize(11).fillColor('#374151');
  doc.text(`${data.createdBy.firstName} ${data.createdBy.lastName}`);
  doc.fontSize(10).fillColor('#6b7280');
  doc.text(companyName);
  if (data.createdBy.phone) {
    doc.text(`Phone: ${data.createdBy.phone}`);
  }
  if (data.createdBy.email) {
    doc.text(`Email: ${data.createdBy.email}`);
  }

  // Footer
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#9ca3af')
    .text('This document serves as formal notification of project delay for record-keeping and documentation purposes.', { align: 'center' })
    .text(`Generated on ${new Date().toLocaleString()} | Reference: ${data.delay.delayNumber}`, { align: 'center' });

  doc.end();
  return stream;
}

export function generateCustomerQuotePDF(data: BidData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const companyName = data.branding?.organizationName || 'SmartManageAI';

  doc.fontSize(28).fillColor(primaryColor).text(companyName, { align: 'center' });
  doc.fontSize(10).fillColor('#6b7280').text('Construction Management', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).text('Powered by SmartManageAI', { align: 'center' });
  doc.moveDown();

  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown();

  doc.fontSize(18).fillColor(primaryColor).text('QUOTE', { align: 'center' });
  doc.moveDown();

  doc.fontSize(11).fillColor('#374151');
  doc.text(`Quote #: ${data.bid.code}`, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
  if (data.bid.dueDate) {
    doc.text(`Valid Until: ${new Date(data.bid.dueDate).toLocaleDateString()}`, { align: 'right' });
  }
  doc.moveDown();

  doc.fontSize(12).fillColor(primaryColor).text('PREPARED FOR:');
  doc.fontSize(11).fillColor('#374151');
  doc.text(data.bid.clientName);
  if (data.bid.clientContactName) {
    doc.text(`Attn: ${data.bid.clientContactName}`);
  }
  if (data.bid.locationAddress) {
    const address = [data.bid.locationAddress, data.bid.city, data.bid.state].filter(Boolean).join(', ');
    doc.text(address);
  }
  if (data.bid.clientContactPhone) {
    doc.text(`Phone: ${data.bid.clientContactPhone}`);
  }
  if (data.bid.clientContactEmail) {
    doc.text(`Email: ${data.bid.clientContactEmail}`);
  }
  doc.moveDown();

  doc.fontSize(12).fillColor(primaryColor).text('PROJECT:');
  doc.fontSize(11).fillColor('#374151').text(data.bid.name);
  doc.moveDown();

  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown();

  doc.fontSize(14).fillColor(primaryColor).text('SCOPE OF WORK & PRICING', { underline: true });
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const col1Width = 380;
  const col2Width = 100;

  doc.rect(50, tableTop - 5, col1Width + col2Width + 20, 20).fill('#f3f4f6');
  doc.fontSize(10).fillColor('#374151')
    .text('Description', 55, tableTop, { width: col1Width })
    .text('Amount', 55 + col1Width + 10, tableTop, { width: col2Width, align: 'right' });
  doc.moveDown(1.2);

  doc.fontSize(10).fillColor('#374151');
  let lineTotal = 0;

  if (data.scopeItems.length > 0) {
    data.scopeItems.forEach((item, index) => {
      if (doc.y > 650) {
        doc.addPage();
        doc.rect(50, doc.y - 5, col1Width + col2Width + 20, 20).fill('#f3f4f6');
        doc.fontSize(10).fillColor('#374151')
          .text('Description (continued)', 55, doc.y, { width: col1Width })
          .text('Amount', 55 + col1Width + 10, doc.y, { width: col2Width, align: 'right' });
        doc.moveDown(1.2);
      }

      const y = doc.y;
      if (index % 2 === 0) {
        doc.rect(50, y - 3, col1Width + col2Width + 20, 18).fill('#fafafa');
      }
      doc.fillColor('#374151');

      const desc = `${item.description}${item.quantity > 1 ? ` (${item.quantity} ${item.unit})` : ''}`;
      doc.text(desc.substring(0, 70), 55, y, { width: col1Width });
      doc.text(`$${item.totalCost.toLocaleString()}`, 55 + col1Width + 10, y, { width: col2Width, align: 'right' });
      lineTotal += item.totalCost;
      doc.moveDown(0.9);
    });
  }

  doc.moveDown(0.5);
  doc.strokeColor('#374151').lineWidth(1)
    .moveTo(350, doc.y)
    .lineTo(550, doc.y)
    .stroke();
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#374151')
    .text('Subtotal:', 350, doc.y, { continued: true, width: 100 })
    .text(`$${data.summary.totalDirectCost.toLocaleString()}`, { align: 'right', width: 100 });
  doc.moveDown(0.4);

  if (data.summary.overheadAmount > 0) {
    doc.text('Overhead & Profit:', 350, doc.y, { continued: true, width: 100 })
      .text(`$${(data.summary.overheadAmount + data.summary.profitAmount).toLocaleString()}`, { align: 'right', width: 100 });
    doc.moveDown(0.4);
  }

  const taxAmount = data.summary.taxAmount || 0;
  if (taxAmount > 0) {
    const taxRate = data.summary.taxRate || 0;
    doc.text(`Tax (${taxRate}%):`, 350, doc.y, { continued: true, width: 100 })
      .text(`$${taxAmount.toLocaleString()}`, { align: 'right', width: 100 });
    doc.moveDown(0.4);
  }

  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(350, doc.y)
    .lineTo(550, doc.y)
    .stroke();
  doc.moveDown(0.5);

  doc.fontSize(14).fillColor(primaryColor)
    .text('TOTAL:', 350, doc.y, { continued: true, width: 100 })
    .text(`$${data.summary.finalBidAmount.toLocaleString()}`, { align: 'right', width: 100 });

  doc.moveDown(2);

  if (data.bid.description) {
    if (doc.y > 550) doc.addPage();
    doc.fontSize(12).fillColor(primaryColor).text('DESCRIPTION OF WORK', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#374151').text(data.bid.description);
    doc.moveDown();
  }

  if (doc.y > 450) doc.addPage();

  doc.fontSize(12).fillColor(primaryColor).text('TERMS & CONDITIONS', { underline: true });
  doc.moveDown(0.5);

  const terms = [
    {
      title: 'LICENSES & INSURANCE',
      content: 'Company is fully licensed and insured. Proof of insurance and licensing available upon request.'
    },
    {
      title: 'COMPENSATION',
      content: 'This quote is valid for 30 days from the date above. Prices are subject to change after the expiration date.'
    },
    {
      title: 'INVOICING & PAYMENT',
      content: 'Progress billing will be submitted based on percentage of work completed. Payment terms are Net 30 days from invoice date. A 1.5% monthly interest charge will be applied to overdue balances.'
    },
    {
      title: 'EXCLUSIONS',
      content: 'Unless specifically noted, this quote excludes: permits, engineering, testing, soil preparation, saw cutting existing concrete, removal of existing structures, and work outside normal business hours.'
    },
    {
      title: 'CHANGE ORDERS',
      content: 'Any work not described in this quote will require a written change order and may result in additional charges and schedule adjustments.'
    },
    {
      title: 'WARRANTY',
      content: 'We provide a one-year warranty on workmanship. Material warranties are per manufacturer specifications.'
    }
  ];

  doc.fontSize(9);
  terms.forEach(term => {
    if (doc.y > 680) doc.addPage();
    doc.fillColor(primaryColor).text(term.title, { continued: false });
    doc.fillColor('#374151').text(term.content);
    doc.moveDown(0.5);
  });

  doc.addPage();
  doc.fontSize(14).fillColor(primaryColor).text('ACCEPTANCE', { align: 'center' });
  doc.moveDown();

  doc.fontSize(10).fillColor('#374151')
    .text('By signing below, the Client accepts this quote and authorizes the Contractor to proceed with the work described herein. This signature constitutes a binding agreement between the parties.');
  doc.moveDown(2);

  doc.text('The above prices, specifications, and conditions are satisfactory and are hereby accepted.');
  doc.moveDown(2);

  const signatureY = doc.y;
  doc.text('Client Signature:', 50, signatureY);
  doc.strokeColor('#374151').lineWidth(0.5)
    .moveTo(150, signatureY + 12)
    .lineTo(350, signatureY + 12)
    .stroke();
  doc.text('Date:', 370, signatureY);
  doc.strokeColor('#374151')
    .moveTo(400, signatureY + 12)
    .lineTo(550, signatureY + 12)
    .stroke();

  doc.moveDown(2);
  const printNameY = doc.y;
  doc.text('Print Name:', 50, printNameY);
  doc.strokeColor('#374151')
    .moveTo(120, printNameY + 12)
    .lineTo(350, printNameY + 12)
    .stroke();
  doc.text('Title:', 370, printNameY);
  doc.strokeColor('#374151')
    .moveTo(400, printNameY + 12)
    .lineTo(550, printNameY + 12)
    .stroke();

  doc.moveDown(3);
  doc.text('Contractor Representative:', 50, doc.y);
  doc.moveDown();
  const tfrSigY = doc.y;
  doc.text('Signature:', 50, tfrSigY);
  doc.strokeColor('#374151')
    .moveTo(110, tfrSigY + 12)
    .lineTo(350, tfrSigY + 12)
    .stroke();
  doc.text('Date:', 370, tfrSigY);
  doc.strokeColor('#374151')
    .moveTo(400, tfrSigY + 12)
    .lineTo(550, tfrSigY + 12)
    .stroke();

  doc.moveDown(3);
  doc.fontSize(8).fillColor('#9ca3af')
    .text(`${companyName} | Construction Management Platform`, { align: 'center' })
    .text(`Quote #${data.bid.code} | Generated ${new Date().toLocaleDateString()}`, { align: 'center' });

  doc.end();
  return stream;
}

export function generateWarrantyContractPDF(data: BidData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const companyName = data.branding?.organizationName || 'SmartManageAI';

  doc.fontSize(28).fillColor(primaryColor).text(companyName, { align: 'center' });
  doc.fontSize(10).fillColor('#6b7280').text('Construction Management', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).text('Powered by SmartManageAI', { align: 'center' });
  doc.moveDown();

  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown();

  doc.fontSize(20).fillColor(primaryColor).text('WARRANTY CONTRACT', { align: 'center' });
  doc.moveDown();

  doc.fontSize(11).fillColor('#374151');
  doc.text(`Contract #: ${data.bid.code}-WC`, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
  doc.moveDown();

  doc.fontSize(12).fillColor(primaryColor).text('PARTIES TO THIS AGREEMENT');
  doc.moveDown(0.3);
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#374151');
  doc.text(`Contractor: `, { continued: true });
  doc.fillColor('#111827').text(companyName);
  doc.moveDown(0.5);

  doc.fillColor('#374151').text(`Client: `, { continued: true });
  doc.fillColor('#111827').text(data.bid.clientName);
  if (data.bid.clientContactName) {
    doc.fillColor('#374151').text(`  Attn: ${data.bid.clientContactName}`);
  }
  if (data.bid.locationAddress) {
    const address = [data.bid.locationAddress, data.bid.city, data.bid.state].filter(Boolean).join(', ');
    doc.fillColor('#374151').text(`  Address: ${address}`);
  }
  if (data.bid.clientContactPhone) {
    doc.fillColor('#374151').text(`  Phone: ${data.bid.clientContactPhone}`);
  }
  if (data.bid.clientContactEmail) {
    doc.fillColor('#374151').text(`  Email: ${data.bid.clientContactEmail}`);
  }
  doc.moveDown();

  doc.fontSize(12).fillColor(primaryColor).text('PROJECT INFORMATION');
  doc.moveDown(0.3);
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#374151');
  doc.text(`Project Name: ${data.bid.name}`);
  doc.text(`Project Code: ${data.bid.code}`);
  if (data.bid.description) {
    doc.moveDown(0.3);
    doc.text(data.bid.description);
  }
  doc.moveDown();

  doc.fontSize(12).fillColor(primaryColor).text('SCOPE OF WORK COVERED BY WARRANTY');
  doc.moveDown(0.3);
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  doc.fontSize(10).fillColor('#374151');
  doc.text('This warranty covers the following scope of work as detailed in the project estimate:');
  doc.moveDown(0.5);

  if (data.scopeItems.length > 0) {
    data.scopeItems.forEach((item, index) => {
      if (doc.y > 680) doc.addPage();
      const y = doc.y;
      if (index % 2 === 0) {
        doc.rect(50, y - 3, 512, 18).fill('#fafafa');
      }
      doc.fillColor('#374151');
      const desc = `${index + 1}. ${item.description}${item.quantity > 1 ? ` (${item.quantity} ${item.unit})` : ''}`;
      doc.text(desc.substring(0, 90), 55, y, { width: 460 });
      doc.moveDown(0.7);
    });
  } else {
    doc.text('As described in the project scope and estimate documents.');
  }
  doc.moveDown();

  if (doc.y > 500) doc.addPage();

  doc.fontSize(12).fillColor(primaryColor).text('WARRANTY TERMS');
  doc.moveDown(0.3);
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  const warrantyTerms = [
    {
      title: '1. WORKMANSHIP WARRANTY',
      content: 'The Contractor warrants that all work performed under this contract shall be free from defects in workmanship for a period of one (1) year from the date of substantial completion. During this warranty period, the Contractor shall, at no additional cost to the Client, repair or replace any work that is found to be defective in workmanship.'
    },
    {
      title: '2. MATERIAL WARRANTIES',
      content: 'All materials used in the performance of this work are covered by the respective manufacturer warranties. The Contractor shall pass through and assign to the Client all manufacturer warranties applicable to materials installed as part of this project. Manufacturer warranty terms and durations vary by product and are governed by the individual manufacturer warranty documentation.'
    },
    {
      title: '3. WARRANTY PERIOD',
      content: 'The warranty period shall commence on the date of substantial completion of the project or the date of beneficial occupancy by the Client, whichever occurs first. The Contractor shall provide written notice of the warranty start date to the Client within ten (10) business days of the commencement date.'
    },
    {
      title: '4. WARRANTY RESPONSE TIME',
      content: 'Upon receipt of a warranty claim, the Contractor shall acknowledge the claim within two (2) business days and commence warranty repairs within seven (7) business days of acknowledgment. Emergency warranty items affecting life safety or building integrity shall be addressed within twenty-four (24) hours.'
    }
  ];

  doc.fontSize(10);
  warrantyTerms.forEach(term => {
    if (doc.y > 650) doc.addPage();
    doc.fillColor(primaryColor).text(term.title, { continued: false });
    doc.moveDown(0.2);
    doc.fillColor('#374151').text(term.content);
    doc.moveDown(0.7);
  });

  if (doc.y > 400) doc.addPage();

  doc.fontSize(12).fillColor(primaryColor).text('EXCLUSIONS AND LIMITATIONS');
  doc.moveDown(0.3);
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  const exclusions = [
    'Damage caused by the Client, third parties, or events beyond the Contractor\'s control, including but not limited to natural disasters, fire, flood, or acts of God.',
    'Normal wear and tear, including cosmetic deterioration that does not affect the functionality or structural integrity of the work.',
    'Damage resulting from improper use, lack of maintenance, unauthorized modifications, or alterations made by parties other than the Contractor.',
    'Defects or failures in materials or equipment supplied by the Client or third parties not under contract with the Contractor.',
    'Consequential, incidental, or indirect damages of any kind, including but not limited to loss of use, loss of revenue, or loss of profit.',
    'Work performed by subcontractors not engaged by the Contractor, unless such work is specifically included in the project scope.'
  ];

  doc.fontSize(10).fillColor('#374151');
  exclusions.forEach((exclusion, index) => {
    if (doc.y > 680) doc.addPage();
    doc.text(`${String.fromCharCode(97 + index)}. ${exclusion}`);
    doc.moveDown(0.4);
  });
  doc.moveDown();

  if (doc.y > 400) doc.addPage();

  doc.fontSize(12).fillColor(primaryColor).text('CLAIM AND CALLBACK PROCEDURES');
  doc.moveDown(0.3);
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  const procedures = [
    {
      title: 'Step 1: Submit Warranty Claim',
      content: 'The Client shall submit all warranty claims in writing to the Contractor, including a detailed description of the defect or issue, the location of the defect, photographs if applicable, and the date the defect was discovered.'
    },
    {
      title: 'Step 2: Inspection and Acknowledgment',
      content: 'The Contractor shall acknowledge receipt of the warranty claim within two (2) business days and schedule an inspection of the reported defect within five (5) business days of acknowledgment.'
    },
    {
      title: 'Step 3: Determination and Repair',
      content: 'Following inspection, the Contractor shall provide a written determination of whether the claim is covered under this warranty within three (3) business days. If covered, repairs shall be scheduled and completed in a timely manner, typically within fourteen (14) business days of determination.'
    },
    {
      title: 'Step 4: Completion and Sign-Off',
      content: 'Upon completion of warranty repairs, the Client shall inspect the work and provide written acceptance or identify any remaining deficiencies. The Contractor shall address any remaining items promptly.'
    }
  ];

  doc.fontSize(10);
  procedures.forEach(proc => {
    if (doc.y > 650) doc.addPage();
    doc.fillColor(primaryColor).text(proc.title);
    doc.moveDown(0.2);
    doc.fillColor('#374151').text(proc.content);
    doc.moveDown(0.7);
  });

  doc.addPage();

  doc.fontSize(14).fillColor(primaryColor).text('SIGNATURES', { align: 'center' });
  doc.moveDown();

  doc.fontSize(10).fillColor('#374151')
    .text('By signing below, both parties acknowledge and agree to the warranty terms, exclusions, and claim procedures outlined in this Warranty Contract. This agreement is binding upon execution by authorized representatives of both parties.');
  doc.moveDown(2);

  doc.fontSize(11).fillColor(primaryColor).text('CONTRACTOR');
  doc.moveDown(2);

  let sigY = doc.y;
  doc.fontSize(10).fillColor('#374151').text('Signature:', 50, sigY);
  doc.strokeColor('#374151').lineWidth(0.5)
    .moveTo(120, sigY + 12).lineTo(350, sigY + 12).stroke();
  doc.text('Date:', 370, sigY);
  doc.strokeColor('#374151')
    .moveTo(400, sigY + 12).lineTo(550, sigY + 12).stroke();

  doc.moveDown(2);
  const printY = doc.y;
  doc.text('Print Name:', 50, printY);
  doc.strokeColor('#374151')
    .moveTo(120, printY + 12).lineTo(350, printY + 12).stroke();
  doc.text('Title:', 370, printY);
  doc.strokeColor('#374151')
    .moveTo(400, printY + 12).lineTo(550, printY + 12).stroke();

  doc.moveDown(2);
  const companyY = doc.y;
  doc.text('Company:', 50, companyY);
  doc.strokeColor('#374151')
    .moveTo(120, companyY + 12).lineTo(350, companyY + 12).stroke();

  doc.moveDown(3);

  doc.fontSize(11).fillColor(primaryColor).text('CLIENT');
  doc.moveDown(2);

  sigY = doc.y;
  doc.fontSize(10).fillColor('#374151').text('Signature:', 50, sigY);
  doc.strokeColor('#374151').lineWidth(0.5)
    .moveTo(120, sigY + 12).lineTo(350, sigY + 12).stroke();
  doc.text('Date:', 370, sigY);
  doc.strokeColor('#374151')
    .moveTo(400, sigY + 12).lineTo(550, sigY + 12).stroke();

  doc.moveDown(2);
  const clientPrintY = doc.y;
  doc.text('Print Name:', 50, clientPrintY);
  doc.strokeColor('#374151')
    .moveTo(120, clientPrintY + 12).lineTo(350, clientPrintY + 12).stroke();
  doc.text('Title:', 370, clientPrintY);
  doc.strokeColor('#374151')
    .moveTo(400, clientPrintY + 12).lineTo(550, clientPrintY + 12).stroke();

  doc.moveDown(2);
  const clientCompanyY = doc.y;
  doc.text('Company:', 50, clientCompanyY);
  doc.strokeColor('#374151')
    .moveTo(120, clientCompanyY + 12).lineTo(350, clientCompanyY + 12).stroke();

  doc.moveDown(3);
  doc.fontSize(8).fillColor('#9ca3af')
    .text(`${companyName} | Construction Management Platform`, { align: 'center' })
    .text(`Warranty Contract #${data.bid.code}-WC | Generated ${new Date().toLocaleDateString()}`, { align: 'center' });

  doc.end();
  return stream;
}

// Inspection Request PDF Data Interface
interface InspectionRequestData {
  inspection: {
    inspectionNumber: string;
    title: string;
    description: string | null;
    inspectionType: string;
    typeLabel: string;
    requestMethod: string | null;
    requestMethodLabel: string | null;
    requestedDate: Date;
    scheduledDate: Date | null;
    status: string;
    statusLabel: string;
    inspectorName: string | null;
    inspectorCompany: string | null;
    inspectorPhone: string | null;
    inspectorEmail: string | null;
    gcRepName: string | null;
    gcRepCompany: string | null;
    gcRepPhone: string | null;
    gcRepEmail: string | null;
    ownerRepName: string | null;
    ownerRepCompany: string | null;
    ownerRepPhone: string | null;
    ownerRepEmail: string | null;
  };
  project: {
    name: string;
    code: string;
    clientName: string;
    locationAddress: string | null;
    city: string | null;
    state: string | null;
  };
  createdBy: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  organizationName?: string;
  branding?: OrganizationBrandingPDF;
}

export function generateInspectionRequestPDF(data: InspectionRequestData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const accentColor = data.branding?.accentColor || '#0284c7';

  // Company Letterhead
  const orgName = data.branding?.organizationName || data.organizationName || 'SmartManageAI';
  doc.fontSize(24).fillColor(primaryColor).text(orgName.toUpperCase(), { align: 'center' });
  doc.fontSize(10).fillColor('#6b7280').text('CONSTRUCTION MANAGEMENT', { align: 'center' });
  doc.moveDown();

  // Decorative line
  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown();

  // Document Title
  doc.fontSize(18).fillColor(accentColor).text('INSPECTION REQUEST', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#374151').text(`Reference: ${data.inspection.inspectionNumber}`, { align: 'center' });
  doc.moveDown();

  // Date
  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  doc.fontSize(11).fillColor('#374151').text(formattedDate, { align: 'right' });
  doc.moveDown();

  // Inspection Type Badge
  doc.fontSize(12).fillColor(primaryColor).text(`Inspection Type: `, { continued: true });
  doc.fillColor(accentColor).text(data.inspection.typeLabel);
  doc.moveDown();

  // Project Information Box
  const projectBoxTop = doc.y;
  doc.rect(50, projectBoxTop, 512, 80).fillAndStroke('#f0f9ff', '#bae6fd');
  
  doc.fontSize(12).fillColor(primaryColor).text('PROJECT INFORMATION', 60, projectBoxTop + 10);
  doc.fontSize(10).fillColor('#374151');
  doc.text(`Project Name: ${data.project.name}`, 60, projectBoxTop + 30);
  doc.text(`Project Code: ${data.project.code}`, 60, projectBoxTop + 45);
  doc.text(`Client: ${data.project.clientName}`, 60, projectBoxTop + 60);
  
  // Location on right side
  if (data.project.locationAddress) {
    const location = [
      data.project.locationAddress,
      [data.project.city, data.project.state].filter(Boolean).join(', ')
    ].filter(Boolean).join(', ');
    doc.text(`Location: ${location}`, 300, projectBoxTop + 30);
  }

  doc.y = projectBoxTop + 90;
  doc.moveDown();

  // Inspection Details Section
  doc.fontSize(14).fillColor(primaryColor).text('INSPECTION DETAILS');
  doc.moveDown(0.5);
  
  doc.strokeColor('#e5e7eb').lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#374151');
  doc.text(`Inspection Title: `, { continued: true });
  doc.fillColor('#111827').text(data.inspection.title);
  
  if (data.inspection.description) {
    doc.moveDown(0.3);
    doc.fillColor('#374151').text(`Description: `, { continued: true });
    doc.fillColor('#111827').text(data.inspection.description);
  }
  
  doc.moveDown(0.3);
  doc.fillColor('#374151').text(`Requested Date: `, { continued: true });
  doc.fillColor('#111827').text(new Date(data.inspection.requestedDate).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }));
  
  if (data.inspection.scheduledDate) {
    doc.moveDown(0.3);
    doc.fillColor('#374151').text(`Scheduled Date: `, { continued: true });
    doc.fillColor(accentColor).text(new Date(data.inspection.scheduledDate).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }));
  }
  
  if (data.inspection.requestMethod) {
    doc.moveDown(0.3);
    doc.fillColor('#374151').text(`Request Method: `, { continued: true });
    doc.fillColor('#111827').text(data.inspection.requestMethodLabel || data.inspection.requestMethod);
  }
  
  doc.moveDown(0.3);
  doc.fillColor('#374151').text(`Status: `, { continued: true });
  const statusColor = data.inspection.status === 'PASSED' ? '#059669' : 
                      data.inspection.status === 'FAILED' ? '#dc2626' : 
                      data.inspection.status === 'SCHEDULED' ? '#2563eb' : '#6b7280';
  doc.fillColor(statusColor).text(data.inspection.statusLabel);
  doc.moveDown();

  // Contacts Section
  if (data.inspection.inspectorName || data.inspection.gcRepName || data.inspection.ownerRepName) {
    doc.fontSize(14).fillColor(primaryColor).text('CONTACTS');
    doc.moveDown(0.5);
    
    doc.strokeColor('#e5e7eb').lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(562, doc.y)
      .stroke();
    doc.moveDown(0.5);

    // Inspector Contact
    if (data.inspection.inspectorName) {
      doc.fontSize(11).fillColor(accentColor).text('Inspector:');
      doc.fillColor('#374151').text(`  ${data.inspection.inspectorName}`);
      if (data.inspection.inspectorCompany) doc.text(`  ${data.inspection.inspectorCompany}`);
      if (data.inspection.inspectorPhone) doc.text(`  Phone: ${data.inspection.inspectorPhone}`);
      if (data.inspection.inspectorEmail) doc.text(`  Email: ${data.inspection.inspectorEmail}`);
      doc.moveDown(0.5);
    }

    // GC Representative
    if (data.inspection.gcRepName) {
      doc.fillColor(accentColor).text('GC Representative:');
      doc.fillColor('#374151').text(`  ${data.inspection.gcRepName}`);
      if (data.inspection.gcRepCompany) doc.text(`  ${data.inspection.gcRepCompany}`);
      if (data.inspection.gcRepPhone) doc.text(`  Phone: ${data.inspection.gcRepPhone}`);
      if (data.inspection.gcRepEmail) doc.text(`  Email: ${data.inspection.gcRepEmail}`);
      doc.moveDown(0.5);
    }

    // Owner Representative
    if (data.inspection.ownerRepName) {
      doc.fillColor(accentColor).text('Owner Representative:');
      doc.fillColor('#374151').text(`  ${data.inspection.ownerRepName}`);
      if (data.inspection.ownerRepCompany) doc.text(`  ${data.inspection.ownerRepCompany}`);
      if (data.inspection.ownerRepPhone) doc.text(`  Phone: ${data.inspection.ownerRepPhone}`);
      if (data.inspection.ownerRepEmail) doc.text(`  Email: ${data.inspection.ownerRepEmail}`);
      doc.moveDown(0.5);
    }
    doc.moveDown();
  }

  // Signature Section
  if (doc.y > 600) doc.addPage();

  doc.fontSize(11).fillColor('#374151')
    .text('This inspection request has been submitted for your review and scheduling.');
  doc.moveDown(2);

  doc.text('Requested by:');
  doc.moveDown(2);

  // Signature line
  doc.strokeColor('#374151').lineWidth(0.5)
    .moveTo(50, doc.y)
    .lineTo(250, doc.y)
    .stroke();
  doc.moveDown(0.3);

  doc.fontSize(11).fillColor('#374151');
  doc.text(`${data.createdBy.firstName} ${data.createdBy.lastName}`);
  doc.fontSize(10).fillColor('#6b7280');
  doc.text(orgName);
  if (data.createdBy.phone) {
    doc.text(`Phone: ${data.createdBy.phone}`);
  }
  if (data.createdBy.email) {
    doc.text(`Email: ${data.createdBy.email}`);
  }

  // Footer
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#9ca3af')
    .text('This document serves as a formal inspection request for project documentation purposes.', { align: 'center' })
    .text(`Generated on ${new Date().toLocaleString()} | Reference: ${data.inspection.inspectionNumber}`, { align: 'center' });

  doc.end();
  return stream;
}
