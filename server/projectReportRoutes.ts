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

export async function aggregateReportData(projectId: string, startDate: string, endDate: string, reportType: "WEEKLY" | "MONTHLY") {
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
  } catch {
  }

  let scheduleSummary = { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, delayedTasks: 0 };
  try {
    const schedResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress
       FROM project_schedule_tasks pst
       JOIN project_schedules ps ON pst.schedule_id = ps.id
       WHERE ps.project_id = $1`,
      [projectId]
    );
    const r = schedResult.rows[0];
    scheduleSummary = {
      totalTasks: parseInt(r?.total || "0"),
      completedTasks: parseInt(r?.completed || "0"),
      inProgressTasks: parseInt(r?.in_progress || "0"),
      delayedTasks: 0,
    };
  } catch {
  }

  let financialSummary: any = null;
  try {
    const finResult = await pool.query(
      `SELECT budget, original_contract_value FROM projects WHERE id = $1`,
      [projectId]
    );
    const fin = finResult.rows[0];
    const budget = parseFloat(fin?.budget || "0");
    const contractValue = parseFloat(fin?.original_contract_value || "0");

    let actualCost = 0;
    try {
      const costResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM project_costs WHERE project_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [projectId, startDate, endDate + "T23:59:59.999Z"]
      );
      actualCost = parseFloat(costResult.rows[0]?.total || "0");
    } catch {}

    financialSummary = {
      budget,
      originalContractValue: contractValue,
      actualCostInPeriod: Math.round(actualCost * 100) / 100,
      budgetVariance: Math.round((budget - actualCost) * 100) / 100,
      changeOrdersSummary: {
        total: cos.length,
        approved: cos.filter(c => c.status === "APPROVED").length,
        approvedAmount: cos.filter(c => c.status === "APPROVED").reduce((s, c) => s + parseFloat(c.amount || "0"), 0),
        pending: cos.filter(c => c.status === "PENDING" || c.status === "SUBMITTED").length,
      },
    };
  } catch {}

  let healthScore: number | null = null;
  try {
    const hsResult = await pool.query(
      `SELECT score FROM project_health_scores WHERE project_id = $1 ORDER BY calculated_at DESC LIMIT 1`,
      [projectId]
    );
    healthScore = hsResult.rows[0]?.score ?? null;
  } catch {}

  let procurement: any = null;
  try {
    const poResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'RECEIVED') as received,
        COUNT(*) FILTER (WHERE status = 'PENDING' OR status = 'ORDERED') as pending
       FROM purchase_orders WHERE project_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [projectId, startDate, endDate + "T23:59:59.999Z"]
    );
    const po = poResult.rows[0];
    procurement = {
      totalOrders: parseInt(po?.total || "0"),
      received: parseInt(po?.received || "0"),
      pending: parseInt(po?.pending || "0"),
    };
  } catch {}

  let subcontractors: any = null;
  try {
    const subResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT sc.id) as total_subs,
        COUNT(DISTINCT sp.id) as pay_apps
       FROM subcontracts sc
       LEFT JOIN subcontract_pay_applications sp ON sp.subcontract_id = sc.id AND sp.created_at >= $2 AND sp.created_at <= $3
       WHERE sc.project_id = $1`,
      [projectId, startDate, endDate + "T23:59:59.999Z"]
    );
    const sr = subResult.rows[0];
    subcontractors = {
      totalSubcontracts: parseInt(sr?.total_subs || "0"),
      payApplicationsInPeriod: parseInt(sr?.pay_apps || "0"),
    };
  } catch {}

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
    healthScore,
  };
}

export function generateReportPDF(reportData: any, branding?: OrganizationBrandingPDF): PassThrough {
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
  doc.text(`Completed: ${p.schedule.completedTasks}`);
  doc.text(`In Progress: ${p.schedule.inProgressTasks}`);
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
    doc.text(`Original Contract: $${p.financials.originalContractValue.toLocaleString()}`);
    if (p.financials.actualCostInPeriod !== undefined) {
      doc.text(`Actual Cost (Period): $${p.financials.actualCostInPeriod.toLocaleString()}`);
      doc.text(`Budget Variance: $${p.financials.budgetVariance.toLocaleString()}`);
    }
    doc.text(`Approved COs: ${p.financials.changeOrdersSummary.approved} ($${p.financials.changeOrdersSummary.approvedAmount.toLocaleString()})`);
    doc.text(`Pending COs: ${p.financials.changeOrdersSummary.pending}`);
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
    doc.fontSize(13).fillColor(primaryColor).text("Subcontractor Summary");
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Active Subcontracts: ${p.subcontractors.totalSubcontracts}`);
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

        const [updated] = await db.update(projectReports)
          .set({
            status: "COMPLETED",
            reportData,
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

      const orgResult = await pool.query(
        `SELECT name, primary_color FROM organizations WHERE id = $1`,
        [orgId]
      );
      const org = orgResult.rows[0];
      const branding: OrganizationBrandingPDF = {
        organizationName: org?.name || "SmartManageAI",
        primaryColor: org?.primary_color || "#1a365d",
      };

      const pdfStream = generateReportPDF(report.reportData as any, branding);
      const filename = `${report.reportType.toLowerCase()}_report_${report.dateRangeStart}_${report.dateRangeEnd}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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
