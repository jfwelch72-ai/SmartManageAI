import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

export interface HeavyCivilProjectSummaryData {
  projectName: string;
  projectCode: string | null;
  clientName: string | null;
  location: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  contractSumToDate: number | null;
  totalCompletedToDate: number | null;
  percentComplete: number;

  dbe: {
    enabled: boolean;
    goals: Array<{ certificationType: string; goalPercent: number; awardedDollars: number; awardedPercent: number }>;
    totalGoalPercent: number;
    totalAwardedPercent: number;
  };

  haul: {
    enabled: boolean;
    totalTickets: number;
    pendingApproval: number;
    totalQuantity: number;
    totalCost: number;
    byMaterial: Array<{ material: string; quantity: number; unit: string; cost: number }>;
  };

  idr: {
    enabled: boolean;
    totalReports: number;
    last30Days: number;
    last30DaysExpected: number;
    streakDays: number;
    lastSubmittedDate: string | null;
  };

  buyAmerica: {
    enabled: boolean;
    total: number;
    compliant: number;
    waiver: number;
    pending: number;
    nonCompliant: number;
  };

  bonds: {
    enabled: boolean;
    active: number;
    totalAmount: number;
    expiringSoon: Array<{ bondNumber: string; bondType: string; suretyCompany: string; expirationDate: string; bondAmount: number }>;
  };

  certifications: Array<{
    organisationName: string;
    certificationType: string;
    expirationDate: string | null;
    daysUntilExpiry: number | null;
  }>;
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtQty(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export function generateHeavyCivilProjectSummaryPDF(data: HeavyCivilProjectSummaryData): PassThrough {
  const doc = new PDFDocument({ margin: 36, size: "LETTER" });
  const stream = new PassThrough();
  doc.pipe(stream);

  const navy = "#1a365d";
  const muted = "#6b7280";
  const text = "#111827";
  const pageW = 540;
  const leftX = 36;
  let y = 36;

  doc.fontSize(16).fillColor(navy).text("HEAVY-CIVIL PROJECT SUMMARY", leftX, y, { width: pageW, align: "center" });
  y += 22;
  doc.fontSize(10).fillColor(muted).text(
    `${data.projectCode ? data.projectCode + " — " : ""}${data.projectName}`,
    leftX, y, { width: pageW, align: "center" },
  );
  y += 16;
  doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(leftX, y).lineTo(leftX + pageW, y).stroke();
  y += 10;

  // Project header block
  const colW = pageW / 2;
  const labelVal = (label: string, val: string, x: number, yPos: number) => {
    doc.fontSize(7).fillColor(muted).text(label, x, yPos);
    doc.fontSize(9).fillColor(text).text(val, x, yPos + 9, { width: colW - 8 });
  };
  labelVal("CLIENT", data.clientName || "—", leftX, y);
  labelVal("STATUS", data.status, leftX + colW, y);
  y += 28;
  labelVal("LOCATION", data.location || "—", leftX, y);
  labelVal("DATES", `${fmtDate(data.startDate)} → ${fmtDate(data.endDate)}`, leftX + colW, y);
  y += 28;

  // Financial summary
  doc.fontSize(10).fillColor(navy).text("FINANCIAL SUMMARY", leftX, y);
  y += 14;
  const finRows: Array<[string, string]> = [
    ["Original Budget", fmtMoney(data.budget)],
    ["Contract Sum to Date", fmtMoney(data.contractSumToDate)],
    ["Completed to Date", fmtMoney(data.totalCompletedToDate)],
    ["% Complete", `${data.percentComplete.toFixed(1)}%`],
  ];
  doc.fontSize(9).fillColor(text);
  for (const [label, val] of finRows) {
    doc.fillColor(muted).text(label, leftX + 8, y, { width: 240 });
    doc.fillColor(text).text(val, leftX + 248, y, { width: 200, align: "right" });
    y += 12;
  }
  y += 8;

  const sectionHeader = (title: string) => {
    if (y > 700) { doc.addPage(); y = 36; }
    doc.rect(leftX, y, pageW, 16).fill("#f1f5f9");
    doc.fontSize(9).fillColor(navy).text(title, leftX + 6, y + 4);
    y += 20;
  };

  const disabledNote = (msg: string) => {
    doc.fontSize(8).fillColor(muted).text(msg, leftX + 8, y);
    y += 14;
  };

  // ===== DBE Participation =====
  sectionHeader("DBE / DISADVANTAGED BUSINESS PARTICIPATION");
  if (!data.dbe.enabled) {
    disabledNote("DBE tracking disabled for this organization.");
  } else if (data.dbe.goals.length === 0) {
    disabledNote("No DBE goals configured for this project.");
  } else {
    doc.fontSize(8).fillColor(muted);
    doc.text("Type", leftX + 8, y);
    doc.text("Goal %", leftX + 200, y, { width: 70, align: "right" });
    doc.text("Awarded $", leftX + 280, y, { width: 100, align: "right" });
    doc.text("Awarded %", leftX + 390, y, { width: 80, align: "right" });
    y += 11;
    doc.fontSize(9).fillColor(text);
    for (const g of data.dbe.goals) {
      if (y > 720) { doc.addPage(); y = 36; }
      doc.text(g.certificationType, leftX + 8, y, { width: 190 });
      doc.text(`${g.goalPercent.toFixed(2)}%`, leftX + 200, y, { width: 70, align: "right" });
      doc.text(fmtMoney(g.awardedDollars), leftX + 280, y, { width: 100, align: "right" });
      const meet = g.awardedPercent >= g.goalPercent;
      doc.fillColor(meet ? "#15803d" : "#b91c1c").text(`${g.awardedPercent.toFixed(2)}%`, leftX + 390, y, { width: 80, align: "right" });
      doc.fillColor(text);
      y += 12;
    }
    y += 4;
    doc.fontSize(8).fillColor(muted).text(
      `Total goal: ${data.dbe.totalGoalPercent.toFixed(2)}%   |   Total awarded: ${data.dbe.totalAwardedPercent.toFixed(2)}%`,
      leftX + 8, y,
    );
    y += 12;
  }
  y += 4;

  // ===== Haul Tickets =====
  sectionHeader("HAUL TICKETS");
  if (!data.haul.enabled) {
    disabledNote("Haul ticket tracking disabled for this organization.");
  } else if (data.haul.totalTickets === 0) {
    disabledNote("No haul tickets recorded.");
  } else {
    doc.fontSize(9).fillColor(text);
    doc.fillColor(muted).text("Total tickets", leftX + 8, y);
    doc.fillColor(text).text(String(data.haul.totalTickets), leftX + 200, y, { width: 100, align: "right" });
    doc.fillColor(muted).text("Pending approval", leftX + 320, y);
    doc.fillColor(text).text(String(data.haul.pendingApproval), leftX + 470, y, { width: 60, align: "right" });
    y += 12;
    doc.fillColor(muted).text("Total quantity (mixed units)", leftX + 8, y);
    doc.fillColor(text).text(fmtQty(data.haul.totalQuantity), leftX + 200, y, { width: 100, align: "right" });
    doc.fillColor(muted).text("Total cost", leftX + 320, y);
    doc.fillColor(text).text(fmtMoney(data.haul.totalCost), leftX + 470, y, { width: 60, align: "right" });
    y += 14;
    if (data.haul.byMaterial.length > 0) {
      doc.fontSize(7).fillColor(muted);
      doc.text("Material", leftX + 8, y);
      doc.text("Qty", leftX + 280, y, { width: 80, align: "right" });
      doc.text("Unit", leftX + 365, y, { width: 40, align: "right" });
      doc.text("Cost", leftX + 410, y, { width: 120, align: "right" });
      y += 10;
      doc.fontSize(9).fillColor(text);
      for (const m of data.haul.byMaterial.slice(0, 8)) {
        if (y > 720) { doc.addPage(); y = 36; }
        doc.text(m.material, leftX + 8, y, { width: 270 });
        doc.text(fmtQty(m.quantity), leftX + 280, y, { width: 80, align: "right" });
        doc.text(m.unit, leftX + 365, y, { width: 40, align: "right" });
        doc.text(fmtMoney(m.cost), leftX + 410, y, { width: 120, align: "right" });
        y += 11;
      }
    }
  }
  y += 6;

  // ===== IDR =====
  sectionHeader("DAILY INSPECTOR REPORTS (IDR)");
  if (!data.idr.enabled) {
    disabledNote("IDR tracking disabled for this organization.");
  } else {
    doc.fontSize(9);
    doc.fillColor(muted).text("Total reports", leftX + 8, y);
    doc.fillColor(text).text(String(data.idr.totalReports), leftX + 200, y, { width: 100, align: "right" });
    doc.fillColor(muted).text("Submission streak", leftX + 320, y);
    doc.fillColor(text).text(`${data.idr.streakDays} day${data.idr.streakDays === 1 ? "" : "s"}`, leftX + 470, y, { width: 60, align: "right" });
    y += 12;
    doc.fillColor(muted).text("Last 30 days submitted", leftX + 8, y);
    doc.fillColor(text).text(`${data.idr.last30Days} / ${data.idr.last30DaysExpected}`, leftX + 200, y, { width: 100, align: "right" });
    doc.fillColor(muted).text("Last submitted", leftX + 320, y);
    doc.fillColor(text).text(fmtDate(data.idr.lastSubmittedDate), leftX + 470, y, { width: 60, align: "right" });
    y += 14;
  }
  y += 4;

  // ===== Buy America =====
  sectionHeader("BUY AMERICA / MATERIAL CERTIFICATIONS");
  if (!data.buyAmerica.enabled) {
    disabledNote("Buy America tracking disabled for this organization.");
  } else if (data.buyAmerica.total === 0) {
    disabledNote("No material certifications recorded.");
  } else {
    const cells: Array<[string, number, string]> = [
      ["Compliant", data.buyAmerica.compliant, "#15803d"],
      ["Waiver", data.buyAmerica.waiver, "#a16207"],
      ["Pending", data.buyAmerica.pending, "#6b7280"],
      ["Non-compliant", data.buyAmerica.nonCompliant, "#b91c1c"],
    ];
    const cellW = pageW / 4;
    cells.forEach(([label, val, color], i) => {
      const x = leftX + i * cellW;
      doc.rect(x + 2, y, cellW - 4, 36).fill("#f9fafb");
      doc.fontSize(7).fillColor(muted).text(label, x + 6, y + 4, { width: cellW - 12 });
      doc.fontSize(16).fillColor(color).text(String(val), x + 6, y + 14, { width: cellW - 12 });
    });
    y += 42;
    doc.fontSize(8).fillColor(muted).text(`Total certifications: ${data.buyAmerica.total}`, leftX + 8, y);
    y += 12;
  }
  y += 4;

  // ===== Bonds & Certs =====
  sectionHeader("SURETY BONDS & SUBCONTRACTOR CERTIFICATIONS");
  if (!data.bonds.enabled) {
    disabledNote("Surety bond tracking disabled for this organization.");
  } else {
    doc.fontSize(9).fillColor(muted).text("Active bonds", leftX + 8, y);
    doc.fillColor(text).text(String(data.bonds.active), leftX + 200, y, { width: 100, align: "right" });
    doc.fillColor(muted).text("Total bonded", leftX + 320, y);
    doc.fillColor(text).text(fmtMoney(data.bonds.totalAmount), leftX + 420, y, { width: 110, align: "right" });
    y += 14;
    if (data.bonds.expiringSoon.length > 0) {
      doc.fontSize(8).fillColor(muted).text("Expiring within 90 days:", leftX + 8, y);
      y += 11;
      doc.fontSize(8);
      for (const b of data.bonds.expiringSoon.slice(0, 6)) {
        if (y > 720) { doc.addPage(); y = 36; }
        doc.fillColor(text).text(`• ${b.bondType} #${b.bondNumber} (${b.suretyCompany})`, leftX + 14, y, { width: 360 });
        doc.fillColor("#b91c1c").text(`exp ${fmtDate(b.expirationDate)} — ${fmtMoney(b.bondAmount)}`, leftX + 380, y, { width: 150, align: "right" });
        y += 11;
      }
    }
  }
  y += 4;
  if (data.certifications.length > 0) {
    if (y > 700) { doc.addPage(); y = 36; }
    doc.fontSize(8).fillColor(muted).text("Subcontractor / vendor certifications expiring within 90 days:", leftX + 8, y);
    y += 11;
    for (const c of data.certifications.slice(0, 8)) {
      if (y > 720) { doc.addPage(); y = 36; }
      doc.fontSize(8).fillColor(text).text(`• ${c.organisationName} — ${c.certificationType}`, leftX + 14, y, { width: 360 });
      const dStr = c.expirationDate ? fmtDate(c.expirationDate) : "—";
      const dColor = c.daysUntilExpiry != null && c.daysUntilExpiry <= 30 ? "#b91c1c" : "#a16207";
      doc.fillColor(dColor).text(`exp ${dStr}`, leftX + 380, y, { width: 150, align: "right" });
      y += 11;
    }
  }

  // Footer
  doc.fontSize(7).fillColor(muted)
    .text(`Heavy-Civil Project Summary | Generated ${new Date().toLocaleString()}`, leftX, 750, { width: pageW, align: "center" });

  doc.end();
  return stream;
}
