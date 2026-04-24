import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

/**
 * Task #1599 — Log PDF generation for the office team.
 *
 * Two log types are exported via this service: a Submittal Log and an
 * RFI Log. Both are project-scoped, sorted oldest-to-newest, and
 * intentionally use the same column-family layout (number, subject,
 * status, dates, owner) so a project manager can scan the two logs
 * side by side without re-orienting.
 *
 * Implementation notes
 * --------------------
 *   - Mirrors the streaming `PassThrough` pattern used by the rest of
 *     the PDF services in this repo (see `server/pdf-service.ts`),
 *     which lets the route pipe directly to the HTTP response without
 *     buffering the whole document.
 *   - PDFKit's text cursor flows top-to-bottom; we draw each row at
 *     the current `doc.y` and rely on PDFKit's automatic page break
 *     when the cursor would overflow the page. After a break we
 *     re-render the column header so every page is self-describing.
 *   - Status badges are rendered as a single coloured pill so a
 *     printed log is still legible after photocopying.
 */

export interface LogPdfBranding {
  organizationName?: string | null;
  primaryColor?: string | null;
}

export interface SubmittalLogRow {
  submittalNumber: string;
  subject: string;
  status: string;
  specSection?: string | null;
  dateSubmitted?: Date | string | null;
  dateRequired?: Date | string | null;
  dateReviewed?: Date | string | null;
  reviewerName?: string | null;
  submittedByName?: string | null;
  // Task #1599 — log fields required by the project log PDF spec.
  // Ball-in-court is the user/role currently expected to act
  // (typically the active reviewer for IN_REVIEW submittals,
  // submitter for DRAFT, or "—" once closed). Last activity is the
  // most recent activity timestamp (review stamp, comment, forward).
  ballInCourt?: string | null;
  lastActivity?: Date | string | null;
}

export interface RfiLogRow {
  rfiNumber: string;
  subject: string;
  status: string;
  priority?: string | null;
  dateSubmitted?: Date | string | null;
  dateRequired?: Date | string | null;
  dateAnswered?: Date | string | null;
  submittedByName?: string | null;
  answeredByName?: string | null;
  ballInCourt?: string | null;
  lastActivity?: Date | string | null;
}

export interface LogPdfMeta {
  // Identifies who hit "Download log (PDF)". Surfaced in the footer
  // so a printed copy carries chain-of-custody back to the user who
  // generated it.
  generatedByName?: string | null;
}

export interface SubmittalLogInput {
  branding?: LogPdfBranding;
  projectName: string;
  rows: SubmittalLogRow[];
  meta?: LogPdfMeta;
}

export interface RfiLogInput {
  branding?: LogPdfBranding;
  projectName: string;
  rows: RfiLogRow[];
  meta?: LogPdfMeta;
}

const PAGE_MARGIN = 40;
const PAGE_WIDTH = 612; // US Letter portrait
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("APPROVED") || s === "ANSWERED" || s === "CLOSED") return "#15803d";
  if (s.includes("REJECT") || s === "OVERDUE") return "#b91c1c";
  if (s.includes("REVISE") || s === "RESUBMITTED") return "#b45309";
  if (s === "UNDER_REVIEW" || s === "IN_REVIEW" || s === "FORWARDED") return "#1d4ed8";
  if (s === "DRAFT") return "#6b7280";
  return "#374151";
}

function renderHeader(
  doc: PDFKit.PDFDocument,
  branding: LogPdfBranding | undefined,
  title: string,
  subtitle: string,
  meta?: LogPdfMeta,
) {
  const primary = branding?.primaryColor || "#1a365d";
  const company = branding?.organizationName || "SmartManageAI";
  doc.fontSize(18).fillColor(primary).text(company, PAGE_MARGIN, PAGE_MARGIN, { align: "left" });
  doc.fontSize(14).fillColor("#111827").text(title, PAGE_MARGIN, PAGE_MARGIN, { align: "right" });
  doc.fontSize(10).fillColor("#6b7280").text(subtitle, { align: "right" });
  doc.moveDown(0.5);
  const generatedBy = meta?.generatedByName ? ` by ${meta.generatedByName}` : "";
  doc.fontSize(9).fillColor("#9ca3af").text(
    `Generated ${new Date().toLocaleString()}${generatedBy}`,
    PAGE_MARGIN,
    doc.y,
    { align: "right" },
  );
  doc.moveTo(PAGE_MARGIN, doc.y + 4)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 4)
    .strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(0.6);
}

function renderColumnHeaders(
  doc: PDFKit.PDFDocument,
  cols: { label: string; width: number }[],
) {
  let x = PAGE_MARGIN;
  const top = doc.y;
  doc.fontSize(8).fillColor("#374151");
  cols.forEach(c => {
    doc.text(c.label.toUpperCase(), x + 2, top, { width: c.width - 4 });
    x += c.width;
  });
  doc.y = top + 14;
  doc.moveTo(PAGE_MARGIN, doc.y - 2)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y - 2)
    .strokeColor("#d1d5db").lineWidth(0.5).stroke();
  doc.moveDown(0.2);
}

function pageBreakIfNeeded(
  doc: PDFKit.PDFDocument,
  estimatedRowHeight: number,
  redrawHeaders: () => void,
) {
  if (doc.y + estimatedRowHeight > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
    redrawHeaders();
  }
}

export function generateSubmittalLogPdf(input: SubmittalLogInput): PassThrough {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "LETTER" });
  const stream = new PassThrough();
  doc.pipe(stream);

  renderHeader(doc, input.branding, "SUBMITTAL LOG", input.projectName, input.meta);

  const cols = [
    { key: "num", label: "No.", width: 50 },
    { key: "subject", label: "Subject / Spec", width: 140 },
    { key: "status", label: "Status", width: 64 },
    { key: "submitted", label: "Submitted", width: 52 },
    { key: "required", label: "Required", width: 52 },
    { key: "reviewed", label: "Reviewed", width: 52 },
    { key: "ballInCourt", label: "Ball in court", width: 64 },
    { key: "lastActivity", label: "Last activity", width: 58 },
  ];

  const draw = () => renderColumnHeaders(doc, cols);
  draw();

  if (input.rows.length === 0) {
    doc.fontSize(10).fillColor("#6b7280").text("No submittals to display.", PAGE_MARGIN, doc.y + 8);
  } else {
    input.rows.forEach(row => {
      pageBreakIfNeeded(doc, 32, draw);
      const top = doc.y;
      let x = PAGE_MARGIN;
      doc.fontSize(9).fillColor("#111827");

      doc.text(row.submittalNumber, x + 2, top + 2, { width: cols[0].width - 4 });
      x += cols[0].width;

      doc.text(row.subject, x + 2, top + 2, { width: cols[1].width - 4 });
      if (row.specSection) {
        doc.fontSize(7).fillColor("#6b7280")
          .text(`Spec ${row.specSection}`, x + 2, top + 14, { width: cols[1].width - 4 });
        doc.fontSize(9).fillColor("#111827");
      }
      x += cols[1].width;

      doc.fillColor(statusColor(row.status)).text(row.status, x + 2, top + 2, { width: cols[2].width - 4 });
      doc.fillColor("#111827");
      x += cols[2].width;

      doc.text(fmtDate(row.dateSubmitted), x + 2, top + 2, { width: cols[3].width - 4 });
      x += cols[3].width;
      doc.text(fmtDate(row.dateRequired), x + 2, top + 2, { width: cols[4].width - 4 });
      x += cols[4].width;
      doc.text(fmtDate(row.dateReviewed), x + 2, top + 2, { width: cols[5].width - 4 });
      x += cols[5].width;
      doc.text(row.ballInCourt || row.reviewerName || row.submittedByName || "—", x + 2, top + 2, { width: cols[6].width - 4 });
      x += cols[6].width;
      doc.text(fmtDate(row.lastActivity), x + 2, top + 2, { width: cols[7].width - 4 });

      doc.y = Math.max(doc.y, top + 28);
      doc.moveTo(PAGE_MARGIN, doc.y - 2)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y - 2)
        .strokeColor("#f3f4f6").lineWidth(0.5).stroke();
    });
  }

  doc.end();
  return stream;
}

export function generateRfiLogPdf(input: RfiLogInput): PassThrough {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "LETTER" });
  const stream = new PassThrough();
  doc.pipe(stream);

  renderHeader(doc, input.branding, "RFI LOG", input.projectName, input.meta);

  const cols = [
    { key: "num", label: "No.", width: 50 },
    { key: "subject", label: "Subject", width: 140 },
    { key: "status", label: "Status", width: 60 },
    { key: "priority", label: "Priority", width: 48 },
    { key: "submitted", label: "Submitted", width: 50 },
    { key: "required", label: "Required", width: 50 },
    { key: "answered", label: "Answered", width: 50 },
    { key: "ballInCourt", label: "Ball in court", width: 60 },
    { key: "lastActivity", label: "Last activity", width: 24 },
  ];

  const draw = () => renderColumnHeaders(doc, cols);
  draw();

  if (input.rows.length === 0) {
    doc.fontSize(10).fillColor("#6b7280").text("No RFIs to display.", PAGE_MARGIN, doc.y + 8);
  } else {
    input.rows.forEach(row => {
      pageBreakIfNeeded(doc, 28, draw);
      const top = doc.y;
      let x = PAGE_MARGIN;
      doc.fontSize(9).fillColor("#111827");

      doc.text(row.rfiNumber, x + 2, top + 2, { width: cols[0].width - 4 });
      x += cols[0].width;
      doc.text(row.subject, x + 2, top + 2, { width: cols[1].width - 4 });
      x += cols[1].width;
      doc.fillColor(statusColor(row.status)).text(row.status, x + 2, top + 2, { width: cols[2].width - 4 });
      doc.fillColor("#111827");
      x += cols[2].width;
      doc.text(row.priority || "—", x + 2, top + 2, { width: cols[3].width - 4 });
      x += cols[3].width;
      doc.text(fmtDate(row.dateSubmitted), x + 2, top + 2, { width: cols[4].width - 4 });
      x += cols[4].width;
      doc.text(fmtDate(row.dateRequired), x + 2, top + 2, { width: cols[5].width - 4 });
      x += cols[5].width;
      doc.text(fmtDate(row.dateAnswered), x + 2, top + 2, { width: cols[6].width - 4 });
      x += cols[6].width;
      doc.text(row.ballInCourt || row.answeredByName || row.submittedByName || "—", x + 2, top + 2, { width: cols[7].width - 4 });
      x += cols[7].width;
      doc.fontSize(7).text(fmtDate(row.lastActivity), x + 2, top + 2, { width: cols[8].width - 4 });
      doc.fontSize(9);

      doc.y = Math.max(doc.y, top + 22);
      doc.moveTo(PAGE_MARGIN, doc.y - 2)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y - 2)
        .strokeColor("#f3f4f6").lineWidth(0.5).stroke();
    });
  }

  doc.end();
  return stream;
}
