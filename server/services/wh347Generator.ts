import { PDFDocument, PDFFont, StandardFonts, rgb, PDFPage, PDFForm } from "pdf-lib";
import type { PayrollFormVariant } from "@shared/schema/enums";

export type { PayrollFormVariant };

/**
 * Source of the prevailing-wage rate shown on a WH-347 row.
 *  - `PROJECT_OVERRIDE`: an explicit `prevailing_wage_rates` row for the
 *    (project, classification) — entered or imported by the contractor.
 *  - `DOL_FEED`: pulled from a cached Davis-Bacon wage determination synced
 *    from DOL/SAM.gov via the `dol_davis_bacon` provider.
 *  - `NONE`: no prevailing-wage rate could be resolved (manual entry only).
 */
export type WH347RateSource = "PROJECT_OVERRIDE" | "DOL_FEED" | "NONE";

export interface WH347Employee {
  name: string;
  workClassification: string;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  rateOfPay: number;
  overtimeRate: number;
  grossEarned: number;
  fica: number;
  withholdingTax: number;
  otherDeductions: number;
  totalDeductions: number;
  netWages: number;
  projectName: string;
  prevailingRate: number | null;
  belowPrevailingWage: boolean;
  // Task #494: where the prevailing-wage figure came from. Rendered as a
  // small caption under the rate column on the WH-347 PDF so auditors can
  // tell at a glance whether a rate is a project override or a federal feed.
  prevailingRateSource?: WH347RateSource;
}

/**
 * A wage decision number that the project references but which has not been
 * imported via the DOL Davis-Bacon sync. Surfaced in the PDF compliance block
 * so the contractor knows the rate column is incomplete and an import is due.
 */
export interface WH347MissingWageDecision {
  projectName: string;
  wageDecision: string;
}

export interface WH347FringeRate {
  classification: string;
  health: number;
  pension: number;
  vacation: number;
  training: number;
  total: number;
}

export interface WH347ReportData {
  contractorName: string;
  contractorAddress?: string;
  payrollNumber: string | null;
  weekEndingDate: string;
  projectName: string;
  projectLocation?: string;
  projectNumber?: string;
  employees: WH347Employee[];
  totals: {
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
  };
  fringeBenefitsPaidToPlan: boolean;
  fringeBenefitsPaidInCash: boolean;
  noFringeBenefitsRequired: boolean;
  signerName?: string;
  signerTitle?: string;
  fringeRates?: WH347FringeRate[];
  // Task #494: any wage decisions referenced by projects in this report that
  // have not yet been pulled from DOL/SAM.gov. Rendered as a callout near the
  // statement of compliance so the auditor can spot incomplete data.
  missingWageDecisions?: WH347MissingWageDecision[];
}

interface VariantConfig {
  formNumber: string;
  formAgency: string;
  formTitle: string;
  certificationLeadIn: string;
  jurisdictionFooter: string;
}

const VARIANT_CONFIG: Record<PayrollFormVariant, VariantConfig> = {
  WH_347: {
    formNumber: "WH-347",
    formAgency: "U.S. Department of Labor — Wage and Hour Division",
    formTitle: "PAYROLL",
    certificationLeadIn:
      "I, the undersigned, do hereby state that I pay or supervise the payment of the persons employed on the above project, and that during the payroll period commencing on the first day and ending on the last day of the period shown above, all persons employed on said project have been paid the full weekly wages earned, that no rebates have been or will be made and that no deductions have been made other than permissible deductions as defined in Regulations, Part 3 (29 C.F.R. Subtitle A).",
    jurisdictionFooter:
      "Pursuant to the Davis-Bacon and Related Acts (40 U.S.C. § 3142). OMB Control Number 1235-0008.",
  },
  CALTRANS_CEM_2502: {
    formNumber: "CEM-2502",
    formAgency: "California Department of Transportation (Caltrans)",
    formTitle: "STATEMENT OF COMPLIANCE / FRINGE BENEFIT STATEMENT (Certified Payroll)",
    certificationLeadIn:
      "I, the undersigned, certify under penalty of perjury under the laws of the State of California that, during the payroll period commencing on the first day and ending on the last day of the period shown above, all persons employed on the above public works project have been paid not less than the general prevailing rate of per diem wages for the work performed, and that no rebates have been made and no deductions have been taken other than those permitted under Labor Code §§ 1771, 1774-1776 and California Code of Regulations, Title 8.",
    jurisdictionFooter:
      "Filed pursuant to California Labor Code § 1776 and Caltrans Construction Manual Section 8-1.02.",
  },
  ODOT_CA_D_9C: {
    formNumber: "CA-D-9C",
    formAgency: "Ohio Department of Transportation (ODOT)",
    formTitle: "WEEKLY PAYROLL REPORT (Certified)",
    certificationLeadIn:
      "I certify that the wage rates and fringe benefits paid to all employees on this project during the payroll period shown comply with the federal Davis-Bacon Act, Ohio Revised Code Chapter 4115, and the contract wage decision incorporated into the contract.",
    jurisdictionFooter:
      "Submit weekly to the ODOT Project Engineer per ODOT Construction & Material Specifications 107.18.",
  },
  TXDOT: {
    formNumber: "WH-347 (TxDOT)",
    formAgency: "Texas Department of Transportation (TxDOT)",
    formTitle: "CERTIFIED WEEKLY PAYROLL REPORT",
    certificationLeadIn:
      "I certify that the wages reported above are the wages actually paid to each employee for work performed on the captioned TxDOT project, that the classifications shown are correct, and that no deductions other than those permitted by 29 C.F.R. Part 3 have been made.",
    jurisdictionFooter:
      "Submit weekly via TxDOT Site Manager. Required by Texas Government Code § 2258 and 23 U.S.C. § 113.",
  },
  FDOT: {
    formNumber: "WH-347 (FDOT)",
    formAgency: "Florida Department of Transportation (FDOT)",
    formTitle: "CERTIFIED WEEKLY PAYROLL",
    certificationLeadIn:
      "I certify that the payroll information set forth above is true and correct, that all laborers and mechanics employed on the above FDOT project were paid not less than the prevailing wage rates required by the contract, and that no unauthorized deductions have been taken.",
    jurisdictionFooter:
      "Submit weekly via the FDOT Equal Opportunity Compliance (EOC) System per FDOT Standard Specification 7-19.",
  },
  GENERIC: {
    formNumber: "Certified Payroll",
    formAgency: "Certified Payroll Report",
    formTitle: "WEEKLY CERTIFIED PAYROLL REPORT",
    certificationLeadIn:
      "I certify that the payroll information shown above is a true and complete record of wages paid to each employee on the above project for the payroll period indicated, and that no deductions have been made other than those permitted by applicable law.",
    jurisdictionFooter: "Generated for prevailing-wage compliance reporting.",
  },
};

const PAGE_WIDTH = 1008; // 14 in landscape
const PAGE_HEIGHT = 612; // 8.5 in landscape
const MARGIN_X = 24;
const MARGIN_Y = 24;
const ROWS_PER_PAGE = 8;

const COLS: Array<{ label: string; width: number; field: keyof WH347Employee | "blank" | "rate"; align?: "left" | "right" | "center" }> = [
  { label: "Name & Last 4 of SSN", width: 150, field: "name", align: "left" },
  { label: "Work Classification", width: 130, field: "workClassification", align: "left" },
  { label: "ST Hrs", width: 50, field: "regularHours", align: "right" },
  { label: "OT Hrs", width: 50, field: "overtimeHours", align: "right" },
  { label: "Total Hrs", width: 60, field: "totalHours", align: "right" },
  { label: "Rate / Hr", width: 65, field: "rateOfPay", align: "right" },
  { label: "Gross Earned", width: 80, field: "grossEarned", align: "right" },
  { label: "FICA", width: 60, field: "fica", align: "right" },
  { label: "W/H Tax", width: 65, field: "withholdingTax", align: "right" },
  { label: "Other", width: 60, field: "otherDeductions", align: "right" },
  { label: "Total Ded.", width: 70, field: "totalDeductions", align: "right" },
  { label: "Net Wages Paid", width: 90, field: "netWages", align: "right" },
];

function fmt$(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function fmtH(n: number): string {
  if (!n) return "—";
  return n.toFixed(1);
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  options: { align?: "left" | "right" | "center"; width?: number; color?: ReturnType<typeof rgb> } = {}
) {
  const align = options.align || "left";
  const width = options.width;
  const color = options.color || rgb(0, 0, 0);
  let drawX = x;
  if (align !== "left" && width !== undefined) {
    const textWidth = font.widthOfTextAtSize(text, size);
    if (align === "right") drawX = x + width - textWidth - 3;
    else drawX = x + (width - textWidth) / 2;
  } else if (align === "left") {
    drawX = x + 3;
  }
  page.drawText(text, { x: drawX, y, size, font, color });
}

function drawRect(page: PDFPage, x: number, y: number, w: number, h: number, borderWidth = 0.5) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0, 0, 0),
    borderWidth,
  });
}

function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let t = text;
  while (font.widthOfTextAtSize(t, size) > maxWidth - 6 && t.length > 1) {
    t = t.slice(0, -1);
  }
  if (t !== text) t = t.slice(0, -1) + "…";
  return t;
}

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  form: PDFForm,
  data: WH347ReportData,
  variant: PayrollFormVariant,
  pageNum: number,
  totalPages: number,
  fieldSuffix: string
) {
  const cfg = VARIANT_CONFIG[variant];
  const top = PAGE_HEIGHT - MARGIN_Y;

  // Title block
  drawText(page, cfg.formAgency, MARGIN_X, top - 12, bold, 11);
  drawText(page, `${cfg.formTitle}  (Form ${cfg.formNumber})`, MARGIN_X, top - 26, bold, 10);
  drawText(
    page,
    `Page ${pageNum} of ${totalPages}`,
    PAGE_WIDTH - MARGIN_X - 80,
    top - 12,
    font,
    9,
    { align: "right", width: 80 }
  );

  // Info row with fillable form fields
  const infoY = top - 60;
  const infoH = 22;
  const fieldDefs = [
    { label: "Contractor / Subcontractor", value: data.contractorName, w: 260 },
    { label: "Address", value: data.contractorAddress || "", w: 220 },
    { label: "Payroll No.", value: data.payrollNumber || "", w: 90 },
    { label: "For Week Ending", value: data.weekEndingDate, w: 110 },
    { label: "Project / Contract No.", value: data.projectNumber || "", w: 130 },
    { label: "Project & Location", value: `${data.projectName}${data.projectLocation ? " — " + data.projectLocation : ""}`, w: PAGE_WIDTH - 2 * MARGIN_X - 260 - 220 - 90 - 110 - 130 },
  ];
  let cursorX = MARGIN_X;
  for (let i = 0; i < fieldDefs.length; i++) {
    const f = fieldDefs[i];
    drawRect(page, cursorX, infoY, f.w, infoH);
    drawText(page, f.label, cursorX + 3, infoY + infoH - 9, font, 7);
    const tf = form.createTextField(`hdr_${i}_${fieldSuffix}`);
    tf.addToPage(page, {
      x: cursorX + 3,
      y: infoY + 2,
      width: f.w - 6,
      height: infoH - 11,
      borderWidth: 0,
      font,
    });
    tf.setText(f.value);
    tf.setFontSize(9);
    cursorX += f.w;
  }
}

function drawTableHeader(page: PDFPage, font: PDFFont, bold: PDFFont, y: number) {
  const headerH = 24;
  let x = MARGIN_X;
  for (const col of COLS) {
    drawRect(page, x, y - headerH, col.width, headerH);
    // Wrap header label across two lines if it has a space and is wide
    const parts = col.label.split(" ");
    if (parts.length > 2 && col.width < 100) {
      const mid = Math.ceil(parts.length / 2);
      const l1 = parts.slice(0, mid).join(" ");
      const l2 = parts.slice(mid).join(" ");
      drawText(page, l1, x, y - 11, bold, 7.5, { align: "center", width: col.width });
      drawText(page, l2, x, y - 21, bold, 7.5, { align: "center", width: col.width });
    } else {
      drawText(page, col.label, x, y - 15, bold, 8, { align: "center", width: col.width });
    }
    x += col.width;
  }
  return headerH;
}

function drawEmployeeRow(
  page: PDFPage,
  font: PDFFont,
  emp: WH347Employee,
  y: number
) {
  const rowH = 28;
  let x = MARGIN_X;
  const isWarn = emp.belowPrevailingWage;
  for (const col of COLS) {
    drawRect(page, x, y - rowH, col.width, rowH);
    if (isWarn) {
      page.drawRectangle({
        x: x + 0.5,
        y: y - rowH + 0.5,
        width: col.width - 1,
        height: rowH - 1,
        color: rgb(0.99, 0.93, 0.93),
      });
      drawRect(page, x, y - rowH, col.width, rowH);
    }
    let value = "";
    switch (col.field) {
      case "name":
        value = ellipsize(emp.name + (isWarn ? " *" : ""), font, 8.5, col.width);
        break;
      case "workClassification":
        value = ellipsize(emp.workClassification, font, 8.5, col.width);
        break;
      case "regularHours":
        value = fmtH(emp.regularHours);
        break;
      case "overtimeHours":
        value = fmtH(emp.overtimeHours);
        break;
      case "totalHours":
        value = emp.totalHours.toFixed(1);
        break;
      case "rateOfPay":
        value = fmt$(emp.rateOfPay);
        break;
      case "grossEarned":
        value = fmt$(emp.grossEarned);
        break;
      case "fica":
        value = fmt$(emp.fica);
        break;
      case "withholdingTax":
        value = fmt$(emp.withholdingTax);
        break;
      case "otherDeductions":
        value = fmt$(emp.otherDeductions);
        break;
      case "totalDeductions":
        value = fmt$(emp.totalDeductions);
        break;
      case "netWages":
        value = fmt$(emp.netWages);
        break;
    }
    drawText(page, value, x, y - 12, font, 8.5, {
      align: col.align || "left",
      width: col.width,
      color: isWarn ? rgb(0.6, 0.05, 0.05) : rgb(0, 0, 0),
    });
    if (col.field === "rateOfPay") {
      // Show PW shortfall in red when the worker is paid below the prevailing
      // rate, otherwise show the rate source caption (e.g. "DOL feed" /
      // "Project override") so auditors can verify the provenance of every
      // figure in the rate column.
      if (emp.belowPrevailingWage && emp.prevailingRate) {
        drawText(
          page,
          `PW ${fmt$(emp.prevailingRate)}`,
          x,
          y - 22,
          font,
          6.5,
          { align: "right", width: col.width, color: rgb(0.6, 0.05, 0.05) }
        );
      } else if (emp.prevailingRateSource && emp.prevailingRateSource !== "NONE") {
        const label = emp.prevailingRateSource === "DOL_FEED" ? "DOL feed" : "Project override";
        drawText(page, label, x, y - 22, font, 6.5, {
          align: "right",
          width: col.width,
          color: rgb(0.35, 0.35, 0.35),
        });
      }
    }
    x += col.width;
  }
  return rowH;
}

function drawTotalsRow(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  totals: { totalGross: number; totalDeductions: number; totalNet: number },
  employees: WH347Employee[],
  y: number
) {
  const rowH = 22;
  let x = MARGIN_X;
  const totRegHrs = employees.reduce((s, e) => s + e.regularHours, 0);
  const totOtHrs = employees.reduce((s, e) => s + e.overtimeHours, 0);
  const totHrs = employees.reduce((s, e) => s + e.totalHours, 0);
  const totFica = employees.reduce((s, e) => s + e.fica, 0);
  const totWh = employees.reduce((s, e) => s + e.withholdingTax, 0);
  const totOth = employees.reduce((s, e) => s + e.otherDeductions, 0);
  const values: Record<string, string> = {
    name: "TOTALS",
    workClassification: "",
    regularHours: totRegHrs.toFixed(1),
    overtimeHours: totOtHrs.toFixed(1),
    totalHours: totHrs.toFixed(1),
    rateOfPay: "",
    grossEarned: fmt$(totals.totalGross),
    fica: fmt$(totFica),
    withholdingTax: fmt$(totWh),
    otherDeductions: fmt$(totOth),
    totalDeductions: fmt$(totals.totalDeductions),
    netWages: fmt$(totals.totalNet),
  };
  for (const col of COLS) {
    drawRect(page, x, y - rowH, col.width, rowH);
    page.drawRectangle({
      x: x + 0.5,
      y: y - rowH + 0.5,
      width: col.width - 1,
      height: rowH - 1,
      color: rgb(0.93, 0.93, 0.93),
    });
    drawRect(page, x, y - rowH, col.width, rowH);
    drawText(page, values[col.field as string] || "", x, y - 14, bold, 8.5, {
      align: col.align || "left",
      width: col.width,
    });
    x += col.width;
  }
  return rowH;
}

function drawComplianceBlock(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  form: PDFForm,
  data: WH347ReportData,
  variant: PayrollFormVariant,
  fieldSuffix: string,
  y: number
) {
  const cfg = VARIANT_CONFIG[variant];
  const fringeRows = data.fringeRates ?? [];
  const fringeTableH = fringeRows.length > 0 ? 14 + fringeRows.length * 11 + 6 : 0;
  const missingWds = data.missingWageDecisions ?? [];
  const missingWdH = missingWds.length > 0 ? 12 + missingWds.length * 10 + 4 : 0;
  const blockH = 130 + fringeTableH + missingWdH;
  const blockY = y - blockH;
  drawRect(page, MARGIN_X, blockY, PAGE_WIDTH - 2 * MARGIN_X, blockH);
  drawText(page, "STATEMENT OF COMPLIANCE", MARGIN_X + 6, y - 12, bold, 10);

  // Wrap certification
  const maxWidth = PAGE_WIDTH - 2 * MARGIN_X - 12;
  const words = cfg.certificationLeadIn.split(" ");
  let line = "";
  let lineY = y - 26;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, 7.5) > maxWidth) {
      drawText(page, line, MARGIN_X + 6, lineY, font, 7.5);
      lineY -= 9;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    drawText(page, line, MARGIN_X + 6, lineY, font, 7.5);
    lineY -= 11;
  }

  // Fringe checkboxes
  const checkY = lineY - 4;
  const cboxes: Array<{ key: string; label: string; checked: boolean }> = [
    { key: "fb_plan", label: "Fringe benefits paid to approved plan(s)", checked: data.fringeBenefitsPaidToPlan },
    { key: "fb_cash", label: "Fringe benefits paid in cash", checked: data.fringeBenefitsPaidInCash },
    { key: "fb_none", label: "No fringe benefits required", checked: data.noFringeBenefitsRequired },
  ];
  let cx = MARGIN_X + 6;
  for (const cb of cboxes) {
    const f = form.createCheckBox(`${cb.key}_${fieldSuffix}`);
    f.addToPage(page, { x: cx, y: checkY, width: 9, height: 9 });
    if (cb.checked) f.check();
    drawText(page, cb.label, cx + 12, checkY + 1, font, 8);
    cx += font.widthOfTextAtSize(cb.label, 8) + 30;
  }

  // Fringe rate breakdown table (per classification)
  if (fringeRows.length > 0) {
    let fy = checkY - 12;
    drawText(page, "Fringe Benefit Hourly Rates by Classification", MARGIN_X + 6, fy, bold, 8);
    fy -= 10;
    const cols = [
      { label: "Classification", w: 220, key: "classification" as const },
      { label: "Health/Welfare", w: 90, key: "health" as const },
      { label: "Pension", w: 90, key: "pension" as const },
      { label: "Vacation/Holiday", w: 100, key: "vacation" as const },
      { label: "Training", w: 80, key: "training" as const },
      { label: "Total Fringe", w: 90, key: "total" as const },
    ];
    let hx = MARGIN_X + 6;
    for (const c of cols) {
      drawText(page, c.label, hx, fy, bold, 7, { align: c.key === "classification" ? "left" : "right", width: c.w });
      hx += c.w;
    }
    fy -= 10;
    for (const row of fringeRows) {
      let rx = MARGIN_X + 6;
      for (const c of cols) {
        let val = "";
        if (c.key === "classification") {
          val = ellipsize(row.classification, font, 7.5, c.w);
        } else {
          val = fmt$(row[c.key] as number);
        }
        drawText(page, val, rx, fy, font, 7.5, { align: c.key === "classification" ? "left" : "right", width: c.w });
        rx += c.w;
      }
      fy -= 11;
    }
  }

  // Missing wage decisions callout — listed in red so the contractor knows
  // which DOL determinations still need to be imported before the rates on
  // this report can be considered authoritative.
  if (missingWds.length > 0) {
    let my = blockY + 18 + 14 + missingWds.length * 10 + 4;
    drawText(
      page,
      "Wage decisions referenced by this report but not yet imported from DOL/SAM.gov:",
      MARGIN_X + 6,
      my,
      bold,
      8,
      { color: rgb(0.6, 0.05, 0.05) },
    );
    my -= 10;
    for (const wd of missingWds) {
      drawText(
        page,
        `• ${wd.wageDecision} — ${wd.projectName}`,
        MARGIN_X + 12,
        my,
        font,
        7.5,
        { color: rgb(0.6, 0.05, 0.05) },
      );
      my -= 10;
    }
  }

  // Signature row
  const sigY = blockY + 18;
  const sigW = (PAGE_WIDTH - 2 * MARGIN_X - 24) / 3;
  const fields = [
    { key: "sig_name", label: "Name & Signature of Authorized Officer", value: data.signerName || "" },
    { key: "sig_title", label: "Title", value: data.signerTitle || "" },
    { key: "sig_date", label: "Date", value: "" },
  ];
  let sx = MARGIN_X + 6;
  for (const f of fields) {
    const tf = form.createTextField(`${f.key}_${fieldSuffix}`);
    tf.addToPage(page, { x: sx, y: sigY + 2, width: sigW - 6, height: 14, borderWidth: 0, font });
    tf.setText(f.value);
    tf.setFontSize(9);
    page.drawLine({
      start: { x: sx, y: sigY },
      end: { x: sx + sigW - 6, y: sigY },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });
    drawText(page, f.label, sx, sigY - 9, font, 7);
    sx += sigW;
  }

  drawText(page, cfg.jurisdictionFooter, MARGIN_X + 6, blockY + 4, font, 6.5, { color: rgb(0.3, 0.3, 0.3) });
  return blockH;
}

export async function generateWH347Pdf(
  data: WH347ReportData,
  variant: PayrollFormVariant = "WH_347"
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`${VARIANT_CONFIG[variant].formNumber} — ${data.contractorName} — ${data.payrollNumber || data.weekEndingDate}`);
  pdfDoc.setSubject("Certified Weekly Payroll");
  pdfDoc.setProducer("Construction Platform");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  const employees = data.employees.length > 0 ? data.employees : [];
  const totalPages = Math.max(1, Math.ceil(employees.length / ROWS_PER_PAGE));

  for (let p = 0; p < totalPages; p++) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isLast = p === totalPages - 1;
    const fieldSuffix = `p${p}`;

    drawHeader(page, font, bold, form, data, variant, p + 1, totalPages, fieldSuffix);

    const tableTop = PAGE_HEIGHT - MARGIN_Y - 95;
    const headerH = drawTableHeader(page, font, bold, tableTop);
    let rowY = tableTop - headerH;

    const slice = employees.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    for (const emp of slice) {
      const h = drawEmployeeRow(page, font, emp, rowY);
      rowY -= h;
    }

    if (isLast) {
      const h = drawTotalsRow(page, font, bold, data.totals, employees, rowY);
      rowY -= h;
      drawComplianceBlock(page, font, bold, form, data, variant, fieldSuffix, rowY - 8);
    }

    if (employees.some((e) => e.belowPrevailingWage)) {
      drawText(
        page,
        "* Worker paid below the prevailing wage rate for their classification — review immediately.",
        MARGIN_X,
        MARGIN_Y - 10,
        font,
        7,
        { color: rgb(0.6, 0.05, 0.05) }
      );
    }
  }

  // Keep form fields editable (do not flatten)
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export function variantDisplayName(v: PayrollFormVariant): string {
  return VARIANT_CONFIG[v].formNumber;
}
