import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

interface SubcontractBranding {
  organizationName: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  email?: string;
  primaryColor?: string;
  accentColor?: string;
}

interface SubcontractData {
  contract: {
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string | null;
    startDate: Date | null;
    completionDate: Date | null;
    status: string;
    paymentTerms: string | null;
    retentionPercent: string | null;
    notes: string | null;
    createdAt: Date;
  };
  subcontractor: {
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    specialties: string[] | null;
  };
  project: {
    name: string;
    code: string;
    locationAddress: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    startDate: Date | null;
    targetCompletionDate: Date | null;
  };
  branding?: SubcontractBranding;
  includeSignaturePages?: boolean;
}

function formatCurrency(value: string | number | null): string {
  if (value === null || value === undefined) return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: string | number | null): string {
  if (value === null || value === undefined) return '0%';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0%';
  return num.toFixed(0) + '%';
}

function formatDate(date: Date | string | null): string {
  if (!date) return 'TBD';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function generateSubcontractPDF(data: SubcontractData): PassThrough {
  const doc = new PDFDocument({ 
    margin: 50, 
    size: 'LETTER',
    layout: 'portrait',
    bufferPages: true
  });
  const stream = new PassThrough();
  doc.pipe(stream);

  const primaryColor = data.branding?.primaryColor || '#1a365d';
  const accentColor = data.branding?.accentColor || '#2563eb';
  const gcName = data.branding?.organizationName || 'SmartManageAI';
  const lightGray = '#f3f4f6';
  const borderColor = '#e5e7eb';
  const textColor = '#374151';
  const marginLeft = 50;
  const marginRight = 562;
  const pageWidth = marginRight - marginLeft;

  doc.fontSize(18).fillColor(primaryColor).text(gcName, { align: 'center' });
  
  const addressParts: string[] = [];
  if (data.branding?.address) {
    addressParts.push(data.branding.address);
  }
  if (data.branding?.city || data.branding?.state || data.branding?.zipCode) {
    addressParts.push([data.branding?.city, data.branding?.state, data.branding?.zipCode].filter(Boolean).join(', '));
  }
  if (data.branding?.phone) {
    addressParts.push(`Tel: ${data.branding.phone}`);
  }
  if (data.branding?.email) {
    addressParts.push(data.branding.email);
  }
  if (addressParts.length > 0) {
    doc.fontSize(9).fillColor(textColor);
    doc.text(addressParts.join(' | '), { align: 'center' });
  }
  
  doc.moveDown(0.5);
  doc.strokeColor(primaryColor).lineWidth(2)
    .moveTo(marginLeft, doc.y)
    .lineTo(marginRight, doc.y)
    .stroke();
  doc.moveDown(1);

  doc.fontSize(16).fillColor(primaryColor).text('SUBCONTRACT AGREEMENT', { align: 'center' });
  doc.fontSize(10).fillColor(textColor).text(`Contract No: ${data.contract.contractNumber}`, { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(10).fillColor(textColor);
  doc.text(`This Subcontract Agreement ("Agreement") is entered into as of ${formatDate(data.contract.createdAt)}, by and between:`, marginLeft, doc.y, { width: pageWidth });
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('CONTRACTOR (General Contractor):', marginLeft);
  doc.font('Helvetica').text(gcName, marginLeft + 20);
  const gcAddressParts: string[] = [];
  if (data.branding?.address) {
    gcAddressParts.push(data.branding.address);
  }
  const gcCityStateZip = [data.branding?.city, data.branding?.state, data.branding?.zipCode].filter(Boolean).join(', ');
  if (gcCityStateZip) {
    gcAddressParts.push(gcCityStateZip);
  }
  if (gcAddressParts.length > 0) {
    doc.text(gcAddressParts.join(', '), marginLeft + 20);
  }
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').text('SUBCONTRACTOR:', marginLeft);
  doc.font('Helvetica').text(data.subcontractor.companyName, marginLeft + 20);
  if (data.subcontractor.address) {
    doc.text(data.subcontractor.address, marginLeft + 20);
  }
  if (data.subcontractor.contactName) {
    doc.text(`Attention: ${data.subcontractor.contactName}`, marginLeft + 20);
  }
  if (data.subcontractor.phone || data.subcontractor.email) {
    const contact = [
      data.subcontractor.phone ? `Tel: ${data.subcontractor.phone}` : null,
      data.subcontractor.email
    ].filter(Boolean).join(' | ');
    doc.text(contact, marginLeft + 20);
  }
  doc.moveDown(1.5);

  let articleNum = 1;

  function drawArticleHeader(title: string) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor);
    doc.text(`ARTICLE ${articleNum}: ${title}`, marginLeft);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor(textColor);
    articleNum++;
  }

  drawArticleHeader('PROJECT INFORMATION');
  doc.text(`Project Name: ${data.project.name}`, marginLeft + 20);
  doc.text(`Project Code: ${data.project.code}`, marginLeft + 20);
  if (data.project.locationAddress) {
    const projectLocation = [
      data.project.locationAddress,
      [data.project.city, data.project.state, data.project.zipCode].filter(Boolean).join(', ')
    ].filter(Boolean).join(', ');
    doc.text(`Location: ${projectLocation}`, marginLeft + 20);
  }
  doc.moveDown(1);

  drawArticleHeader('SCOPE OF WORK');
  doc.text('The Subcontractor agrees to furnish all labor, materials, equipment, and services necessary to complete the following work in accordance with the Contract Documents:', marginLeft + 20, doc.y, { width: pageWidth - 20 });
  doc.moveDown(0.5);
  
  const scopeLines = data.contract.scopeOfWork.split('\n').filter(line => line.trim());
  scopeLines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•') || /^\d+\./.test(trimmedLine)) {
      doc.text(trimmedLine, marginLeft + 30, doc.y, { width: pageWidth - 30 });
    } else {
      doc.text(trimmedLine, marginLeft + 20, doc.y, { width: pageWidth - 20 });
    }
    doc.moveDown(0.3);
  });
  doc.moveDown(0.5);

  if (data.subcontractor.specialties && data.subcontractor.specialties.length > 0) {
    doc.font('Helvetica-Oblique').text(`Subcontractor Specialties: ${data.subcontractor.specialties.join(', ')}`, marginLeft + 20, doc.y, { width: pageWidth - 20 });
    doc.font('Helvetica');
    doc.moveDown(1);
  }

  drawArticleHeader('CONTRACT PRICE');
  doc.text(`The Contractor agrees to pay the Subcontractor for the satisfactory completion of the Work the Contract Sum of:`, marginLeft + 20, doc.y, { width: pageWidth - 20 });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).text(formatCurrency(data.contract.contractAmount), { align: 'center' });
  doc.font('Helvetica').fontSize(10);
  doc.moveDown(0.5);
  
  if (data.contract.retentionPercent) {
    doc.text(`Retainage: ${formatPercent(data.contract.retentionPercent)} of each progress payment will be withheld until final completion.`, marginLeft + 20, doc.y, { width: pageWidth - 20 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.5);

  drawArticleHeader('TIME OF PERFORMANCE');
  doc.text(`Commencement Date: ${formatDate(data.contract.startDate)}`, marginLeft + 20);
  doc.text(`Substantial Completion Date: ${formatDate(data.contract.completionDate)}`, marginLeft + 20);
  doc.moveDown(0.5);
  doc.text('Time is of the essence of this Agreement. The Subcontractor shall prosecute the Work diligently and shall complete the Work within the time stated above.', marginLeft + 20, doc.y, { width: pageWidth - 20 });
  doc.moveDown(1);

  drawArticleHeader('PAYMENT TERMS');
  if (data.contract.paymentTerms) {
    doc.text(data.contract.paymentTerms, marginLeft + 20, doc.y, { width: pageWidth - 20 });
  } else {
    doc.text('Progress payments shall be made monthly based on the percentage of Work completed, less the retainage amount. Final payment, including release of retainage, shall be made upon satisfactory completion of all Work and receipt of all required documentation and releases.', marginLeft + 20, doc.y, { width: pageWidth - 20 });
  }
  doc.moveDown(1);

  drawArticleHeader('INSURANCE REQUIREMENTS');
  doc.text('The Subcontractor shall maintain, at its own expense, the following insurance coverage throughout the duration of this Agreement:', marginLeft + 20, doc.y, { width: pageWidth - 20 });
  doc.moveDown(0.5);
  const insuranceItems = [
    'Commercial General Liability Insurance with limits of not less than $1,000,000 per occurrence',
    'Workers\' Compensation Insurance as required by applicable law',
    'Automobile Liability Insurance with limits of not less than $1,000,000 combined single limit',
    'Umbrella/Excess Liability Insurance with limits of not less than $2,000,000'
  ];
  insuranceItems.forEach(item => {
    doc.text(`• ${item}`, marginLeft + 30, doc.y, { width: pageWidth - 30 });
    doc.moveDown(0.3);
  });
  doc.moveDown(0.5);

  drawArticleHeader('GENERAL CONDITIONS');
  const generalConditions = [
    'The Subcontractor shall comply with all applicable laws, ordinances, rules, regulations, and lawful orders of public authorities.',
    'The Subcontractor warrants that all Work shall be performed in a good and workmanlike manner and shall be free from defects.',
    'The Subcontractor shall be solely responsible for the safety of its employees and shall maintain a safe work environment.',
    'The Subcontractor shall indemnify and hold harmless the Contractor from any claims arising from the Subcontractor\'s performance.',
    'Any changes to the scope of Work must be approved in writing by both parties prior to implementation.'
  ];
  generalConditions.forEach((condition, index) => {
    doc.text(`${index + 1}. ${condition}`, marginLeft + 20, doc.y, { width: pageWidth - 20 });
    doc.moveDown(0.5);
  });

  if (data.contract.notes) {
    drawArticleHeader('ADDITIONAL TERMS');
    doc.text(data.contract.notes, marginLeft + 20, doc.y, { width: pageWidth - 20 });
    doc.moveDown(1);
  }

  if (data.includeSignaturePages !== false) {
    doc.addPage();
    
    doc.fontSize(14).fillColor(primaryColor).text('SIGNATURES', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor(primaryColor).lineWidth(1)
      .moveTo(marginLeft, doc.y)
      .lineTo(marginRight, doc.y)
      .stroke();
    doc.moveDown(1);

    doc.fontSize(10).fillColor(textColor);
    doc.text('IN WITNESS WHEREOF, the parties hereto have executed this Subcontract Agreement as of the date first written above.', marginLeft, doc.y, { width: pageWidth });
    doc.moveDown(2);

    doc.font('Helvetica-Bold').text('CONTRACTOR:', marginLeft);
    doc.font('Helvetica').text(gcName, marginLeft);
    doc.moveDown(2);

    doc.text('By: _______________________________________', marginLeft);
    doc.moveDown(0.5);
    doc.text('Name: ____________________________________', marginLeft);
    doc.moveDown(0.5);
    doc.text('Title: _____________________________________', marginLeft);
    doc.moveDown(0.5);
    doc.text('Date: _____________________________________', marginLeft);
    doc.moveDown(2);

    doc.font('Helvetica-Bold').text('SUBCONTRACTOR:', marginLeft);
    doc.font('Helvetica').text(data.subcontractor.companyName, marginLeft);
    doc.moveDown(2);

    doc.text('By: _______________________________________', marginLeft);
    doc.moveDown(0.5);
    doc.text('Name: ____________________________________', marginLeft);
    doc.moveDown(0.5);
    doc.text('Title: _____________________________________', marginLeft);
    doc.moveDown(0.5);
    doc.text('Date: _____________________________________', marginLeft);
  }

  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#9ca3af');
    doc.text(
      `Page ${i + 1} of ${pageCount} | Contract No: ${data.contract.contractNumber}`,
      marginLeft,
      doc.page.height - 30,
      { width: pageWidth, align: 'center' }
    );
  }

  doc.end();
  return stream;
}
