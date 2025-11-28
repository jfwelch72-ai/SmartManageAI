import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

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
}

export function generateInternalBidSummaryPDF(data: BidData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = '#1a365d';
  const accentColor = '#2563eb';
  const lightGray = '#f3f4f6';

  doc.fontSize(24).fillColor(primaryColor).text('TFR CONSTRUCTION', { align: 'center' });
  doc.fontSize(18).fillColor('#374151').text('Internal Bid Summary', { align: 'center' });
  doc.moveDown(0.5);

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

export function generateCustomerQuotePDF(data: BidData): PassThrough {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = '#1a365d';

  doc.fontSize(28).fillColor(primaryColor).text('TFR CONSTRUCTION', { align: 'center' });
  doc.fontSize(10).fillColor('#6b7280').text('LICENSED CONCRETE CONTRACTOR', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).text('Phone: (XXX) XXX-XXXX | Email: info@tfrconstruction.com', { align: 'center' });
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
      content: 'TFR Construction is a fully licensed and insured concrete contractor. Proof of insurance and licensing available upon request.'
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
      content: 'TFR Construction provides a one-year warranty on workmanship. Material warranties are per manufacturer specifications.'
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
    .text('By signing below, the Client accepts this quote and authorizes TFR Construction to proceed with the work described herein. This signature constitutes a binding agreement between the parties.');
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
  doc.text('TFR Construction Representative:', 50, doc.y);
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
    .text('TFR Construction | Licensed Concrete Contractor', { align: 'center' })
    .text(`Quote #${data.bid.code} | Generated ${new Date().toLocaleDateString()}`, { align: 'center' });

  doc.end();
  return stream;
}
