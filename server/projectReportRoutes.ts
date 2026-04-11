import { Router, Response } from "express";
import { db } from "./db";
import { projectReports, projectNotes, timeEntries, changeOrders } from "@shared/schema/operations";
import { projects, users } from "@shared/schema/core";
import { eq, desc, and, gte, lte, sql, between, count } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { pool } from "./db";
import type { OrganizationBrandingPDF } from "./pdf-service";
import { objectStorageClient } from "./objectStorage";
import { logError } from "./utils/logger";

interface ReportData {
  project: { id: string; name: string; projectCode: string | null; status: string };
  period: { start: string; end: string; type: string };
  dailyNotes: { total: number; entries: Array<{ date: Date | string | null; text: string; type: string | null }> };
  labor: { totalRegularHours: number; totalOvertimeHours: number; totalHours: number; uniqueWorkers: number; entriesCount: number };
  safety: { ppeViolations: number; materialTestsFailed: number; totalIncidents: number };
  schedule: { totalTasks: number; completedTasks: number; inProgressTasks: number; delayedTasks: number; startedTasks: number };
  changeOrders: { total: number; items: Array<{ number: number | null; description: string | null; amount: string | null; status: string }> };
  financials: { budget: number; actualCost: number; variance: number; variancePercent: number; changeOrdersSummary: { approved: number; pending: number } } | null;
  procurement: { totalOrders: number; received: number; pending: number } | null;
  subcontractors: { totalSubcontracts: number; payApplicationsInPeriod: number; totalContractValue: number; billedToDate: number } | null;
  materialsReceived: { totalDeliveries: number; totalAmount: number; items: Array<{ description: string; amount: number; vendor: string | null; deliveryDate: string | null }> } | null;
  weatherSummary: { daysWithData: number; entries: Array<{ date: string; conditions: string }> } | null;
  keyPhotos: { totalPhotos: number; batches: number } | null;
  healthScore: number | null;
}

export function streamToBuffer(stream: PassThrough): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function persistPdfToStorage(pdfStorageKey: string, pdfBuffer: Buffer): Promise<void> {
  try {
    const privateDir = process.env.PRIVATE_OBJECT_DIR || process.env.REPLIT_OBJECT_STORAGE_PRIVATE_DIR;
    if (!privateDir) return;
    const fullPath = `${privateDir}/${pdfStorageKey}`;
    const slashIdx = fullPath.indexOf("/");
    const bucketName = fullPath.substring(0, slashIdx);
    const objectName = fullPath.substring(slashIdx + 1);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(pdfBuffer, { contentType: "application/pdf" });
  } catch (err) {
    logError("Failed to persist PDF to storage", { pdfStorageKey }, err instanceof Error ? err : new Error(String(err)));
  }
}

async function loadPdfFromStorage(pdfStorageKey: string): Promise<Buffer | null> {
  try {
    const privateDir = process.env.PRIVATE_OBJECT_DIR || process.env.REPLIT_OBJECT_STORAGE_PRIVATE_DIR;
    if (!privateDir) return null;
    const fullPath = `${privateDir}/${pdfStorageKey}`;
    const slashIdx = fullPath.indexOf("/");
    const bucketName = fullPath.substring(0, slashIdx);
    const objectName = fullPath.substring(slashIdx + 1);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buffer] = await file.download();
    return buffer;
  } catch (err) {
    logError("Failed to load PDF from storage", { pdfStorageKey }, err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

async function getProjectOrgId(projectId: string): Promise<string | null> {
  const [project] = await db.select({ gcOrganizationId: projects.gcOrganizationId })
    .from(projects).where(eq(projects.id, projectId));
  return project?.gcOrganizationId || null;
}

const router = Router();

const MANAGEMENT_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "HUSTLER"] as const;

const generateReportSchema = z.object({
  reportType: z.enum(["WEEKLY", "MONTHLY"]),
  dateRangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateRangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().optional(),
  emailRecipients: z.array(z.string().email()).optional(),
});

export async function aggregateReportData(projectId: string, startDate: string, endDate: string, reportType: "WEEKLY" | "MONTHLY"): Promise<ReportData> {
  const startTs = new Date(startDate);
  const endTs = new Date(endDate + "T23:59:59.999Z");

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const notes = await db.select({
    id: projectNotes.id,
    text: projectNotes.text,
    noteType: projectNotes.noteType,
    createdAt: projectNotes.createdAt,
    authorId: projectNotes.authorId,
  }).from(projectNotes)
    .where(and(
      eq(projectNotes.projectId, projectId),
      gte(projectNotes.createdAt, startTs),
      lte(projectNotes.createdAt, endTs),
    ))
    .orderBy(desc(projectNotes.createdAt));

  const labor = await db.select({
    id: timeEntries.id,
    userId: timeEntries.userId,
    date: timeEntries.date,
    hoursRegular: timeEntries.hoursRegular,
    hoursOvertime: timeEntries.hoursOvertime,
    costCode: timeEntries.costCode,
    approvalStatus: timeEntries.approvalStatus,
  }).from(timeEntries)
    .where(and(
      eq(timeEntries.projectId, projectId),
      gte(timeEntries.date, startTs),
      lte(timeEntries.date, endTs),
    ));

  const totalRegularHours = labor.reduce((sum, e) => sum + parseFloat(e.hoursRegular || "0"), 0);
  const totalOvertimeHours = labor.reduce((sum, e) => sum + parseFloat(e.hoursOvertime || "0"), 0);
  const uniqueWorkers = new Set(labor.map(e => e.userId)).size;

  const cos = await db.select({
    id: changeOrders.id,
    changeOrderNumber: changeOrders.changeOrderNumber,
    description: changeOrders.description,
    amount: changeOrders.amount,
    status: changeOrders.status,
    createdAt: changeOrders.createdAt,
  }).from(changeOrders)
    .where(and(
      eq(changeOrders.projectId, projectId),
      gte(changeOrders.createdAt, startTs),
      lte(changeOrders.createdAt, endTs),
    ));

  let safetyIncidents = 0;
  let ppeViolations = 0;
  let materialTestsFailed = 0;
  try {
    const safetyResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM ppe_compliance_logs WHERE project_id = $1 AND check_date >= $2 AND check_date <= $3 AND compliance_status = 'VIOLATION'`,
      [projectId, startDate, endDate]
    );
    ppeViolations = parseInt(safetyResult.rows[0]?.cnt || "0");

    const testResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM material_tests WHERE project_id = $1 AND test_date >= $2 AND test_date <= $3 AND status = 'FAILED'`,
      [projectId, startDate, endDate]
    );
    materialTestsFailed = parseInt(testResult.rows[0]?.cnt || "0");
    safetyIncidents = ppeViolations + materialTestsFailed;
  } catch (err) {
    logError("Failed to query safety incident data", { projectId }, err instanceof Error ? err : new Error(String(err)));
  }

  let scheduleSummary = { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, delayedTasks: 0, startedTasks: 0 };
  try {
    const schedResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pst.status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE pst.status = 'IN_PROGRESS') as in_progress,
        COUNT(*) FILTER (WHERE pst.status = 'IN_PROGRESS' AND pst.early_finish < $3) as delayed,
        COUNT(*) FILTER (WHERE pst.actual_start >= $2 AND pst.actual_start <= $3) as started
       FROM project_schedule_tasks pst
       JOIN project_schedules ps ON pst.schedule_id = ps.id
       WHERE ps.project_id = $1
         AND (pst.early_start <= $3 OR pst.actual_start <= $3 OR pst.status IN ('IN_PROGRESS','COMPLETED'))`,
      [projectId, startDate, endDate]
    );
    const r = schedResult.rows[0];
    scheduleSummary = {
      totalTasks: parseInt(r?.total || "0"),
      completedTasks: parseInt(r?.completed || "0"),
      inProgressTasks: parseInt(r?.in_progress || "0"),
      delayedTasks: parseInt(r?.delayed || "0"),
      startedTasks: parseInt(r?.started || "0"),
    };
  } catch (err) {
    logError("Failed to query schedule summary data", { projectId }, err instanceof Error ? err : new Error(String(err)));
  }

  let financialSummary: { budget: number; actualCost: number; variance: number; variancePercent: number; changeOrdersSummary: { approved: number; pending: number } } | null = null;
  try {
    const finResult = await pool.query(
      `SELECT budget, contract_amount FROM projects WHERE id = $1`,
      [projectId]
    );
    const fin = finResult.rows[0];
    const budget = parseFloat(fin?.budget || fin?.contract_amount || "0");

    let actualCost = 0;
    try {
      const costResult = await pool.query(
        `SELECT COALESCE(SUM(total_amount), 0) as total FROM cost_ledger_postings WHERE project_id = $1 AND posted_at >= $2 AND posted_at <= $3`,
        [projectId, startDate, endDate + "T23:59:59.999Z"]
      );
      actualCost = parseFloat(costResult.rows[0]?.total || "0");
    } catch (err) { logError("Failed to query cost ledger postings", { projectId }, err instanceof Error ? err : new Error(String(err))); }

    const variance = budget - actualCost;
    financialSummary = {
      budget,
      actualCost: Math.round(actualCost * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      variancePercent: budget > 0 ? Math.round((variance / budget) * 10000) / 100 : 0,
      changeOrdersSummary: {
        approved: cos.filter(c => c.status === "APPROVED").length,
        pending: cos.filter(c => c.status === "PENDING" || c.status === "SUBMITTED").length,
      },
    };
  } catch (err) { logError("Failed to aggregate financial summary", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  let healthScore: number | null = null;
  try {
    const hsResult = await pool.query(
      `SELECT score FROM project_health_scores WHERE project_id = $1 ORDER BY calculated_at DESC LIMIT 1`,
      [projectId]
    );
    healthScore = hsResult.rows[0]?.score ?? null;
  } catch (err) { logError("Failed to query project health score", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  let procurement: { totalOrders: number; received: number; pending: number } | null = null;
  try {
    const poResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('FULFILLED', 'PARTIAL')) as received,
        COUNT(*) FILTER (WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACKNOWLEDGED')) as pending
       FROM purchase_orders WHERE project_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [projectId, startDate, endDate + "T23:59:59.999Z"]
    );
    const po = poResult.rows[0];
    procurement = {
      totalOrders: parseInt(po?.total || "0"),
      received: parseInt(po?.received || "0"),
      pending: parseInt(po?.pending || "0"),
    };
  } catch (err) { logError("Failed to query procurement data", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  let subcontractors: { totalSubcontracts: number; payApplicationsInPeriod: number; totalContractValue: number; billedToDate: number } | null = null;
  try {
    const subResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT sc.id) as total_subs,
        COUNT(DISTINCT sp.id) as pay_apps,
        COALESCE(SUM(DISTINCT sc.contract_amount), 0) as total_value,
        COALESCE(SUM(sp.net_amount_due), 0) as billed
       FROM subcontractor_contracts sc
       LEFT JOIN sub_pay_applications sp ON sp.contract_id = sc.id AND sp.created_at >= $2 AND sp.created_at <= $3
       WHERE sc.project_id = $1`,
      [projectId, startDate, endDate + "T23:59:59.999Z"]
    );
    const sr = subResult.rows[0];
    subcontractors = {
      totalSubcontracts: parseInt(sr?.total_subs || "0"),
      payApplicationsInPeriod: parseInt(sr?.pay_apps || "0"),
      totalContractValue: Math.round(parseFloat(sr?.total_value || "0") * 100) / 100,
      billedToDate: Math.round(parseFloat(sr?.billed || "0") * 100) / 100,
    };
  } catch (err) { logError("Failed to query subcontractor data", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  let materialsReceived: { totalDeliveries: number; totalAmount: number; items: Array<{ description: string; amount: number; vendor: string | null; deliveryDate: string | null }> } | null = null;
  try {
    const matResult = await pool.query(
      `SELECT description, amount, vendor, delivery_date 
       FROM stored_materials 
       WHERE project_id = $1 AND delivery_date >= $2 AND delivery_date <= $3
       ORDER BY delivery_date DESC LIMIT 20`,
      [projectId, startDate, endDate]
    );
    const matCountResult = await pool.query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total 
       FROM stored_materials 
       WHERE project_id = $1 AND delivery_date >= $2 AND delivery_date <= $3`,
      [projectId, startDate, endDate]
    );
    const mc = matCountResult.rows[0];
    materialsReceived = {
      totalDeliveries: parseInt(mc?.cnt || "0"),
      totalAmount: Math.round(parseFloat(mc?.total || "0") * 100) / 100,
      items: matResult.rows.map((r: { description: string; amount: string; vendor: string | null; delivery_date: string | null }) => ({
        description: r.description,
        amount: parseFloat(r.amount || "0"),
        vendor: r.vendor,
        deliveryDate: r.delivery_date,
      })),
    };
  } catch (err) { logError("Failed to query materials received data", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  let weatherSummary: { daysWithData: number; entries: Array<{ date: string; conditions: string }> } | null = null;
  try {
    const weatherNotes = await pool.query(
      `SELECT DISTINCT ON (created_at::date) created_at::date as note_date, text
       FROM project_notes
       WHERE project_id = $1 AND created_at >= $2 AND created_at <= $3
         AND (LOWER(text) LIKE '%weather%' OR LOWER(text) LIKE '%rain%' OR LOWER(text) LIKE '%sunny%' OR LOWER(text) LIKE '%wind%' OR LOWER(text) LIKE '%storm%' OR LOWER(text) LIKE '%snow%' OR LOWER(text) LIKE '%clear%' OR LOWER(text) LIKE '%overcast%' OR LOWER(text) LIKE '%fog%')
       ORDER BY created_at::date, created_at DESC`,
      [projectId, startDate, endDate + "T23:59:59.999Z"]
    );
    if (weatherNotes.rows.length > 0) {
      weatherSummary = {
        daysWithData: weatherNotes.rows.length,
        entries: weatherNotes.rows.map((r: { note_date: string; text: string }) => ({
          date: r.note_date,
          conditions: r.text.substring(0, 200),
        })),
      };
    }
  } catch (err) { logError("Failed to query weather summary data", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  let keyPhotos: { totalPhotos: number; batches: number } | null = null;
  try {
    const photoResult = await pool.query(
      `SELECT COUNT(jp.id) as photo_count, COUNT(DISTINCT jb.id) as batch_count
       FROM jobsite_analysis_photos jp
       JOIN jobsite_analysis_batches jb ON jp.batch_id = jb.id
       WHERE jb.project_id = $1 AND jb.analysis_date >= $2 AND jb.analysis_date <= $3`,
      [projectId, startDate, endDate]
    );
    const pr = photoResult.rows[0];
    const photoCount = parseInt(pr?.photo_count || "0");
    if (photoCount > 0) {
      keyPhotos = {
        totalPhotos: photoCount,
        batches: parseInt(pr?.batch_count || "0"),
      };
    }
  } catch (err) { logError("Failed to query key photos data", { projectId }, err instanceof Error ? err : new Error(String(err))); }

  return {
    project: {
      id: project?.id,
      name: project?.name,
      projectCode: project?.projectCode,
      status: project?.status,
    },
    period: { start: startDate, end: endDate, type: reportType },
    dailyNotes: {
      total: notes.length,
      entries: notes.slice(0, 50).map(n => ({
        date: n.createdAt,
        text: n.text,
        type: n.noteType,
      })),
    },
    labor: {
      totalRegularHours: Math.round(totalRegularHours * 100) / 100,
      totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
      totalHours: Math.round((totalRegularHours + totalOvertimeHours) * 100) / 100,
      uniqueWorkers,
      entriesCount: labor.length,
    },
    safety: {
      ppeViolations,
      materialTestsFailed,
      totalIncidents: safetyIncidents,
    },
    schedule: scheduleSummary,
    changeOrders: {
      total: cos.length,
      items: cos.map(c => ({
        number: c.changeOrderNumber,
        description: c.description,
        amount: c.amount,
        status: c.status,
      })),
    },
    financials: financialSummary,
    procurement,
    subcontractors,
    materialsReceived,
    weatherSummary,
    keyPhotos,
    healthScore,
  };
}

export function generateReportPDF(reportData: ReportData, branding?: OrganizationBrandingPDF): PassThrough {
  const stream = new PassThrough();
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  doc.pipe(stream);

  const primaryColor = branding?.primaryColor || "#1a365d";
  const companyName = branding?.organizationName || "SmartManageAI";
  const p = reportData;

  doc.fontSize(22).fillColor(primaryColor).text(companyName, { align: "center" });
  doc.fontSize(16).fillColor("#374151").text(
    `${p.period.type === "WEEKLY" ? "Weekly" : "Monthly"} Progress Report`,
    { align: "center" }
  );
  doc.fontSize(11).fillColor("#6b7280").text(
    `${p.project?.name || "Project"} (${p.project?.projectCode || ""})`,
    { align: "center" }
  );
  doc.fontSize(10).text(`Period: ${p.period.start} to ${p.period.end}`, { align: "center" });
  doc.moveDown(1);

  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor("#e5e7eb").stroke();
  doc.moveDown(0.5);

  if (p.healthScore !== null && p.healthScore !== undefined) {
    doc.fontSize(13).fillColor(primaryColor).text("Project Health Score");
    doc.fontSize(24).fillColor(p.healthScore >= 70 ? "#059669" : p.healthScore >= 40 ? "#d97706" : "#dc2626")
      .text(`${p.healthScore}/100`);
    doc.moveDown(0.5);
  }

  doc.fontSize(13).fillColor(primaryColor).text("Labor Summary");
  doc.fontSize(10).fillColor("#374151");
  doc.text(`Regular Hours: ${p.labor.totalRegularHours}`);
  doc.text(`Overtime Hours: ${p.labor.totalOvertimeHours}`);
  doc.text(`Total Hours: ${p.labor.totalHours}`);
  doc.text(`Unique Workers: ${p.labor.uniqueWorkers}`);
  doc.text(`Time Entries: ${p.labor.entriesCount}`);
  doc.moveDown(0.5);

  doc.fontSize(13).fillColor(primaryColor).text("Safety Summary");
  doc.fontSize(10).fillColor("#374151");
  doc.text(`PPE Violations: ${p.safety.ppeViolations}`);
  doc.text(`Failed Material Tests: ${p.safety.materialTestsFailed}`);
  doc.text(`Total Incidents: ${p.safety.totalIncidents}`);
  doc.moveDown(0.5);

  doc.fontSize(13).fillColor(primaryColor).text("Schedule Progress");
  doc.fontSize(10).fillColor("#374151");
  doc.text(`Total Tasks: ${p.schedule.totalTasks}`);
  doc.text(`Started (Period): ${p.schedule.startedTasks || 0}`);
  doc.text(`Completed: ${p.schedule.completedTasks}`);
  doc.text(`In Progress: ${p.schedule.inProgressTasks}`);
  doc.text(`Delayed: ${p.schedule.delayedTasks || 0}`);
  doc.moveDown(0.5);

  if (p.changeOrders.total > 0) {
    doc.fontSize(13).fillColor(primaryColor).text("Change Orders");
    doc.fontSize(10).fillColor("#374151");
    for (const co of p.changeOrders.items.slice(0, 20)) {
      doc.text(`CO #${co.number}: ${co.description} — $${parseFloat(co.amount || 0).toLocaleString()} (${co.status})`);
    }
    doc.moveDown(0.5);
  }

  if (p.financials) {
    doc.fontSize(13).fillColor(primaryColor).text("Financial Summary");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Budget: $${p.financials.budget.toLocaleString()}`);
    doc.text(`Actual Cost (Period): $${p.financials.actualCost.toLocaleString()}`);
    doc.text(`Variance: $${p.financials.variance.toLocaleString()} (${p.financials.variancePercent}%)`);
    doc.text(`Approved COs: ${p.financials.changeOrdersSummary.approved}`);
    doc.text(`Pending COs: ${p.financials.changeOrdersSummary.pending}`);
    doc.moveDown(0.5);
  }

  if (p.weatherSummary) {
    doc.fontSize(13).fillColor(primaryColor).text("Weather Summary");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Days with weather data: ${p.weatherSummary.daysWithData}`);
    for (const w of (p.weatherSummary.entries || []).slice(0, 10)) {
      doc.text(`${w.date}: ${w.conditions || "N/A"}`);
    }
    doc.moveDown(0.5);
  }

  if (p.materialsReceived && p.materialsReceived.totalDeliveries > 0) {
    doc.fontSize(13).fillColor(primaryColor).text("Materials Received");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Total Deliveries: ${p.materialsReceived.totalDeliveries}`);
    doc.text(`Total Amount: $${p.materialsReceived.totalAmount.toLocaleString()}`);
    for (const m of (p.materialsReceived.items || []).slice(0, 10)) {
      doc.text(`• ${m.description} — $${m.amount.toLocaleString()}${m.vendor ? ` (${m.vendor})` : ""}`);
    }
    doc.moveDown(0.5);
  }

  if (p.keyPhotos) {
    doc.fontSize(13).fillColor(primaryColor).text("Site Photos");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Photos captured: ${p.keyPhotos.totalPhotos} across ${p.keyPhotos.batches} analysis batch(es)`);
    doc.moveDown(0.5);
  }

  if (p.procurement) {
    doc.fontSize(13).fillColor(primaryColor).text("Procurement Status");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Total Purchase Orders: ${p.procurement.totalOrders}`);
    doc.text(`Received: ${p.procurement.received}`);
    doc.text(`Pending/Ordered: ${p.procurement.pending}`);
    doc.moveDown(0.5);
  }

  if (p.subcontractors) {
    doc.fontSize(13).fillColor(primaryColor).text("Subcontractor Performance");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Active Subcontracts: ${p.subcontractors.totalSubcontracts}`);
    doc.text(`Total Contract Value: $${p.subcontractors.totalContractValue?.toLocaleString() ?? "0"}`);
    doc.text(`Billed to Date: $${p.subcontractors.billedToDate?.toLocaleString() ?? "0"}`);
    doc.text(`Pay Applications (Period): ${p.subcontractors.payApplicationsInPeriod}`);
    doc.moveDown(0.5);
  }

  if (p.dailyNotes.total > 0) {
    doc.addPage();
    doc.fontSize(13).fillColor(primaryColor).text("Daily Notes Summary");
    doc.fontSize(9).fillColor("#374151");
    for (const note of p.dailyNotes.entries.slice(0, 30)) {
      const dateStr = note.date ? new Date(note.date).toLocaleDateString() : "";
      doc.text(`[${dateStr}] ${note.text}`, { width: 500 });
      doc.moveDown(0.2);
    }
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor("#9ca3af").text(
    `Generated on ${new Date().toLocaleString()} by ${companyName}`,
    { align: "center" }
  );

  doc.end();
  return stream;
}

router.get(
  "/api/projects/:id/progress-reports",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const reports = await db.select().from(projectReports)
        .where(eq(projectReports.projectId, projectId))
        .orderBy(desc(projectReports.createdAt));

      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  }
);

router.get(
  "/api/projects/:id/progress-reports/settings",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const result = await pool.query(
        `SELECT * FROM project_report_settings WHERE project_id = $1`,
        [projectId]
      );

      if (result.rows.length === 0) {
        return res.json({ projectId, autoWeekly: false, autoMonthly: false, emailRecipients: [] });
      }

      const s = result.rows[0];
      res.json({
        projectId: s.project_id,
        autoWeekly: s.auto_weekly,
        autoMonthly: s.auto_monthly,
        emailRecipients: s.email_recipients || [],
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch report settings" });
    }
  }
);

const reportSettingsSchema = z.object({
  autoWeekly: z.boolean(),
  autoMonthly: z.boolean(),
  emailRecipients: z.array(z.string().email()).default([]),
});

router.put(
  "/api/projects/:id/progress-reports/settings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HUSTLER"),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const parsed = reportSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const { autoWeekly, autoMonthly, emailRecipients } = parsed.data;

      await pool.query(
        `INSERT INTO project_report_settings (project_id, auto_weekly, auto_monthly, email_recipients, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (project_id) DO UPDATE SET
           auto_weekly = EXCLUDED.auto_weekly,
           auto_monthly = EXCLUDED.auto_monthly,
           email_recipients = EXCLUDED.email_recipients,
           updated_at = NOW()`,
        [projectId, autoWeekly, autoMonthly, emailRecipients]
      );

      res.json({ projectId, autoWeekly, autoMonthly, emailRecipients });
    } catch (err) {
      res.status(500).json({ error: "Failed to update report settings" });
    }
  }
);

router.get(
  "/api/projects/:id/progress-reports/:reportId",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const [report] = await db.select().from(projectReports)
        .where(and(
          eq(projectReports.id, req.params.reportId),
          eq(projectReports.projectId, projectId),
        ));

      if (!report) return res.status(404).json({ error: "Report not found" });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch report" });
    }
  }
);

router.post(
  "/api/projects/:id/progress-reports/generate",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const parsed = generateReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const { reportType, dateRangeStart, dateRangeEnd, title, emailRecipients } = parsed.data;
      const defaultTitle = `${reportType === "WEEKLY" ? "Weekly" : "Monthly"} Report: ${dateRangeStart} to ${dateRangeEnd}`;

      const [report] = await db.insert(projectReports).values({
        projectId,
        reportType,
        title: title || defaultTitle,
        dateRangeStart,
        dateRangeEnd,
        status: "GENERATING",
        generatedById: req.user!.id,
        emailRecipients: emailRecipients || null,
      }).returning();

      try {
        const reportData = await aggregateReportData(projectId, dateRangeStart, dateRangeEnd, reportType);
        const pdfStorageKey = `reports/${projectId}/${report.id}.pdf`;

        const orgResult = await pool.query(`SELECT name, primary_color FROM organizations WHERE id = $1`, [orgId]);
        const org = orgResult.rows[0] as { name?: string; primary_color?: string } | undefined;
        const branding: OrganizationBrandingPDF = {
          organizationName: org?.name || "SmartManageAI",
          primaryColor: org?.primary_color || "#1a365d",
        };
        const pdfStream = generateReportPDF(reportData, branding);
        const pdfBuffer = await streamToBuffer(pdfStream);
        await persistPdfToStorage(pdfStorageKey, pdfBuffer);

        const [updated] = await db.update(projectReports)
          .set({
            status: "COMPLETED",
            reportData,
            pdfStorageKey,
            generatedAt: new Date(),
          })
          .where(eq(projectReports.id, report.id))
          .returning();

        res.json(updated);
      } catch (genErr) {
        await db.update(projectReports)
          .set({ status: "FAILED" })
          .where(eq(projectReports.id, report.id));
        throw genErr;
      }
    } catch (err) {
      console.error("[progress-reports] Generate error:", err);
      res.status(500).json({ error: "Failed to generate report" });
    }
  }
);

router.get(
  "/api/projects/:id/progress-reports/:reportId/pdf",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const [report] = await db.select().from(projectReports)
        .where(and(
          eq(projectReports.id, req.params.reportId),
          eq(projectReports.projectId, projectId),
        ));

      if (!report) return res.status(404).json({ error: "Report not found" });
      if (report.status !== "COMPLETED" || !report.reportData) {
        return res.status(400).json({ error: "Report not ready for PDF export" });
      }

      const filename = `${report.reportType.toLowerCase()}_report_${report.dateRangeStart}_${report.dateRangeEnd}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      if (report.pdfStorageKey) {
        const storedPdf = await loadPdfFromStorage(report.pdfStorageKey);
        if (storedPdf) {
          res.setHeader("Content-Length", storedPdf.length.toString());
          return res.end(storedPdf);
        }
      }

      const orgResult = await pool.query(
        `SELECT name, primary_color FROM organizations WHERE id = $1`,
        [orgId]
      );
      const org = orgResult.rows[0] as { name?: string; primary_color?: string } | undefined;
      const branding: OrganizationBrandingPDF = {
        organizationName: org?.name || "SmartManageAI",
        primaryColor: org?.primary_color || "#1a365d",
      };

      const pdfStream = generateReportPDF(report.reportData as ReportData, branding);
      pdfStream.pipe(res);
    } catch (err) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
);

router.delete(
  "/api/projects/:id/progress-reports/:reportId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "HUSTLER"),
  async (req: AuthRequest, res: Response) => {
    try {
      const projectId = req.params.id;
      const orgId = await getProjectOrgId(projectId);
      if (!orgId) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!verifyOrgAccess(req, res, orgId)) {
        return;
      }

      const [deleted] = await db.delete(projectReports)
        .where(and(
          eq(projectReports.id, req.params.reportId),
          eq(projectReports.projectId, projectId),
        ))
        .returning();

      if (!deleted) return res.status(404).json({ error: "Report not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete report" });
    }
  }
);

export default router;
