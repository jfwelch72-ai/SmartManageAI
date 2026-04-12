import { logError } from "./utils/logger";
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const router = Router();

const COLORS = {
  primary: '#1a365d',
  accent: '#2563eb',
  heading2: '#1e40af',
  heading3: '#1e3a5f',
  body: '#1f2937',
  muted: '#6b7280',
  bullet: '#3b82f6',
  divider: '#d1d5db',
  tableBorder: '#9ca3af',
  tableHeader: '#1e40af',
  tableHeaderText: '#ffffff',
  tableAlt: '#f3f4f6',
};

function parseMarkdownLine(line: string): { type: string; text: string; level?: number } {
  if (line.startsWith('# ')) return { type: 'h1', text: line.slice(2) };
  if (line.startsWith('## ')) return { type: 'h2', text: line.slice(3) };
  if (line.startsWith('### ')) return { type: 'h3', text: line.slice(4) };
  if (line.startsWith('#### ')) return { type: 'h4', text: line.slice(5) };
  if (line.startsWith('---')) return { type: 'divider', text: '' };
  if (line.startsWith('- **') && line.includes(':**')) return { type: 'bold-bullet', text: line.slice(2) };
  if (line.startsWith('- ')) return { type: 'bullet', text: line.slice(2) };
  if (line.startsWith('  - **') && line.includes(':**')) return { type: 'bold-sub-bullet', text: line.slice(4) };
  if (line.startsWith('  - ')) return { type: 'sub-bullet', text: line.slice(4) };
  if (line.startsWith('| ') && !line.startsWith('|---')) return { type: 'table-row', text: line };
  if (line.startsWith('|---') || line.startsWith('| ---')) return { type: 'table-separator', text: '' };
  if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) return { type: 'italic', text: line.replace(/^\*|\*$/g, '') };
  if (line.trim() === '') return { type: 'blank', text: '' };
  return { type: 'paragraph', text: line };
}

function renderRichText(doc: PDFKit.PDFDocument, text: string, options: any = {}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  const fragments: { text: string; bold: boolean }[] = [];
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      fragments.push({ text: part.slice(2, -2), bold: true });
    } else if (part) {
      fragments.push({ text: part, bold: false });
    }
  }

  if (fragments.length === 1 && !fragments[0].bold) {
    doc.font('Helvetica').fontSize(options.fontSize || 10).fillColor(options.color || COLORS.body).text(text, options);
    return;
  }

  let first = true;
  for (const frag of fragments) {
    const font = frag.bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(font).fontSize(options.fontSize || 10).fillColor(options.color || COLORS.body);
    if (first) {
      doc.text(frag.text, { ...options, continued: fragments.indexOf(frag) < fragments.length - 1 });
      first = false;
    } else {
      doc.text(frag.text, { continued: fragments.indexOf(frag) < fragments.length - 1 });
    }
  }
}

function addPageHeader(doc: PDFKit.PDFDocument) {
  const y = 20;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
    .text('SmartManageAI — Complete Platform Feature & Integration Guide', 50, y, { align: 'right', width: doc.page.width - 100 });
  doc.moveTo(50, y + 14).lineTo(doc.page.width - 50, y + 14).strokeColor(COLORS.divider).lineWidth(0.5).stroke();
}

function addPageFooter(doc: PDFKit.PDFDocument, pageNum: number) {
  const y = doc.page.height - 35;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(COLORS.divider).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
    .text(`Page ${pageNum}`, 50, y + 5, { align: 'center', width: doc.page.width - 100 });
}

function checkPageBreak(doc: PDFKit.PDFDocument, needed: number = 60) {
  if (doc.y > doc.page.height - 80 - needed) {
    doc.addPage();
    return true;
  }
  return false;
}

router.get('/marketing-document', (req, res) => {
  try {
    const mdPath = path.join(process.cwd(), 'smartmanageAI_features_integrations.md');
    if (!fs.existsSync(mdPath)) {
      return res.status(404).json({ error: 'Marketing document not found' });
    }

    const markdown = fs.readFileSync(mdPath, 'utf-8');
    const lines = markdown.split('\n');

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 55, right: 55 },
      bufferPages: true,
      info: {
        Title: 'SmartManageAI - Complete Platform Feature & Integration Guide',
        Author: 'SmartManageAI',
        Subject: 'Construction Management Platform Features & Integrations',
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="SmartManageAI_Features_Integrations.pdf"');
    doc.pipe(res);

    const pageWidth = doc.page.width - 110;

    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8fafc');
    doc.restore();

    doc.moveDown(6);
    doc.font('Helvetica-Bold').fontSize(32).fillColor(COLORS.primary)
      .text('SmartManageAI', { align: 'center' });
    doc.moveDown(0.3);

    doc.moveTo(doc.page.width / 2 - 100, doc.y).lineTo(doc.page.width / 2 + 100, doc.y)
      .strokeColor(COLORS.accent).lineWidth(2).stroke();
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(16).fillColor(COLORS.heading2)
      .text('Complete Platform Feature &\nIntegration Guide', { align: 'center' });
    doc.moveDown(2);

    doc.font('Helvetica').fontSize(11).fillColor(COLORS.body)
      .text('Enterprise-grade, white-label SaaS platform for the\nconstruction industry — from bid to closeout.', { align: 'center' });
    doc.moveDown(4);

    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
      .text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });

    doc.addPage();

    doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.primary).text('Table of Contents');
    doc.moveDown(0.5);
    doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y).strokeColor(COLORS.accent).lineWidth(1.5).stroke();
    doc.moveDown(0.8);

    const tocItems: string[] = [];
    for (const line of lines) {
      if (line.startsWith('## ') && !line.startsWith('## Table')) {
        tocItems.push(line.slice(3));
      }
    }
    for (let i = 0; i < tocItems.length; i++) {
      doc.font('Helvetica').fontSize(11).fillColor(COLORS.body)
        .text(`${tocItems[i]}`, 70, undefined, { width: pageWidth - 20 });
      doc.moveDown(0.3);
    }

    doc.addPage();

    let pageNum = 3;
    let inTable = false;
    let tableRows: string[][] = [];
    let skipTocSection = false;

    function flushTable() {
      if (tableRows.length === 0) return;
      const colWidths = [140, pageWidth - 145];
      const startX = 55;
      
      for (let r = 0; r < tableRows.length; r++) {
        const row = tableRows[r];
        const isHeader = r === 0;

        const cellTexts = row.slice(0, colWidths.length).map(c => c.replace(/\*\*/g, '').trim());
        const cellHeights = cellTexts.map((text, c) => {
          return doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
            .heightOfString(text, { width: colWidths[c] - 10 });
        });
        const rowHeight = Math.max(22, Math.max(...cellHeights) + 8);

        checkPageBreak(doc, rowHeight + 10);

        const y = doc.y;
        doc.save();
        if (isHeader) {
          doc.rect(startX, y - 2, pageWidth, rowHeight).fill(COLORS.tableHeader);
        } else if (r % 2 === 0) {
          doc.rect(startX, y - 2, pageWidth, rowHeight).fill(COLORS.tableAlt);
        }
        doc.restore();

        let xOff = startX + 5;
        for (let c = 0; c < cellTexts.length; c++) {
          const font = isHeader ? 'Helvetica-Bold' : 'Helvetica';
          const color = isHeader ? COLORS.tableHeaderText : COLORS.body;
          doc.font(font).fontSize(8.5).fillColor(color)
            .text(cellTexts[c], xOff, y + 3, { width: colWidths[c] - 10 });
          xOff += colWidths[c];
        }
        doc.y = y + rowHeight;
      }
      doc.moveDown(0.5);
      tableRows = [];
      inTable = false;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parsed = parseMarkdownLine(line);

      if (parsed.type === 'table-separator') continue;
      if (line.startsWith('## Table of Contents')) { skipTocSection = true; continue; }
      if (skipTocSection) {
        if (line.startsWith('---')) { skipTocSection = false; continue; }
        continue;
      }

      if (parsed.type === 'table-row') {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        if (cells.length >= 2) {
          if (!inTable) inTable = true;
          tableRows.push(cells);
        }
        continue;
      }

      if (inTable && parsed.type !== 'table-row') {
        flushTable();
      }

      switch (parsed.type) {
        case 'h1':
          break;

        case 'h2':
          doc.addPage();
          doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.primary)
            .text(parsed.text, 55, 55, { width: pageWidth });
          doc.moveDown(0.3);
          doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y)
            .strokeColor(COLORS.accent).lineWidth(1.5).stroke();
          doc.moveDown(0.8);
          break;

        case 'h3':
          checkPageBreak(doc, 40);
          doc.moveDown(0.4);
          doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.heading3)
            .text(parsed.text, { width: pageWidth });
          doc.moveDown(0.3);
          break;

        case 'h4':
          checkPageBreak(doc, 35);
          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.heading3)
            .text(parsed.text, { width: pageWidth });
          doc.moveDown(0.2);
          break;

        case 'divider':
          doc.moveDown(0.3);
          break;

        case 'bold-bullet':
          checkPageBreak(doc);
          doc.font('Helvetica').fontSize(10).fillColor(COLORS.bullet).text('●', 60, doc.y, { continued: false });
          doc.moveUp();
          renderRichText(doc, parsed.text, { fontSize: 10, color: COLORS.body, indent: 20, width: pageWidth - 25 });
          doc.moveDown(0.15);
          break;

        case 'bullet':
          checkPageBreak(doc);
          doc.font('Helvetica').fontSize(10).fillColor(COLORS.bullet).text('●', 60, doc.y, { continued: false });
          doc.moveUp();
          renderRichText(doc, parsed.text, { fontSize: 10, color: COLORS.body, indent: 20, width: pageWidth - 25 });
          doc.moveDown(0.15);
          break;

        case 'bold-sub-bullet':
          checkPageBreak(doc);
          doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('○', 78, doc.y, { continued: false });
          doc.moveUp();
          renderRichText(doc, parsed.text, { fontSize: 9.5, color: COLORS.body, indent: 35, width: pageWidth - 45 });
          doc.moveDown(0.1);
          break;

        case 'sub-bullet':
          checkPageBreak(doc);
          doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('○', 78, doc.y, { continued: false });
          doc.moveUp();
          renderRichText(doc, parsed.text, { fontSize: 9.5, color: COLORS.body, indent: 35, width: pageWidth - 45 });
          doc.moveDown(0.1);
          break;

        case 'italic':
          checkPageBreak(doc);
          doc.moveDown(0.5);
          doc.font('Helvetica-Oblique').fontSize(11).fillColor(COLORS.accent)
            .text(parsed.text, { align: 'center', width: pageWidth });
          doc.moveDown(0.3);
          break;

        case 'paragraph':
          checkPageBreak(doc);
          renderRichText(doc, parsed.text, { fontSize: 10, color: COLORS.body, width: pageWidth });
          doc.moveDown(0.3);
          break;

        case 'blank':
          break;
      }
    }

    flushTable();

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      if (i > 0) {
        addPageHeader(doc);
      }
      addPageFooter(doc, i + 1);
    }

    doc.end();
  } catch (error: any) {
    logError('Error generating marketing PDF:', {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      next(error);
    }
  }
});

export default router;
