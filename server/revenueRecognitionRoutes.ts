import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { requireFeaturePermission } from "./auth";
import {
  calculateProjectWip,
  calculateAllProjectsWip,
  generateMonthlySnapshot,
  getHistoricalSnapshots,
  type WipProjectData,
} from "./revenueRecognitionService";
import { db } from "./db";
import { projects, revenueRecognition } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/api/revenue-recognition/project/:projectId", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const wipData = await calculateProjectWip(projectId);
    res.json(wipData);
  } catch (error) {
    console.error("Get project WIP error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/revenue-recognition/project-by-code/:code", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const wipData = await calculateProjectWip(project.id);
    res.json(wipData);
  } catch (error) {
    console.error("Get project WIP by code error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/revenue-recognition/wip-report", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ projects: [], totals: null });
    }

    const filterOrgId = shouldFilter ? orgId : undefined;
    const wipData = await calculateAllProjectsWip(filterOrgId || undefined);

    const totals = wipData.reduce(
      (acc, p) => ({
        contractValue: acc.contractValue + p.contractValue,
        changeOrderAdjustments: acc.changeOrderAdjustments + p.changeOrderAdjustments,
        adjustedContractValue: acc.adjustedContractValue + p.adjustedContractValue,
        costsToDate: acc.costsToDate + p.costsToDate,
        estimatedTotalCost: acc.estimatedTotalCost + p.estimatedTotalCost,
        earnedRevenue: acc.earnedRevenue + p.earnedRevenue,
        billingsToDate: acc.billingsToDate + p.billingsToDate,
        overUnderBilling: acc.overUnderBilling + p.overUnderBilling,
        grossProfit: acc.grossProfit + p.grossProfit,
      }),
      {
        contractValue: 0,
        changeOrderAdjustments: 0,
        adjustedContractValue: 0,
        costsToDate: 0,
        estimatedTotalCost: 0,
        earnedRevenue: 0,
        billingsToDate: 0,
        overUnderBilling: 0,
        grossProfit: 0,
      },
    );

    const totalPercentComplete = totals.estimatedTotalCost > 0
      ? (totals.costsToDate / totals.estimatedTotalCost) * 100
      : 0;
    const totalGrossProfitPercent = totals.earnedRevenue > 0
      ? (totals.grossProfit / totals.earnedRevenue) * 100
      : 0;

    res.json({
      projects: wipData,
      totals: {
        ...totals,
        percentComplete: Math.round(totalPercentComplete * 100) / 100,
        grossProfitPercent: Math.round(totalGrossProfitPercent * 100) / 100,
      },
    });
  } catch (error) {
    console.error("WIP report error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/revenue-recognition/snapshot", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const count = await generateMonthlySnapshot(orgId);
    res.json({ message: `Snapshot generated for ${count} projects`, count });
  } catch (error) {
    console.error("Generate snapshot error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/revenue-recognition/history", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess || !orgId) {
      return res.json([]);
    }

    const projectId = req.query.projectId as string | undefined;
    const months = parseInt(req.query.months as string) || 12;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const snapshots = await getHistoricalSnapshots(orgId, projectId, months, startDate, endDate);
    res.json(snapshots);
  } catch (error) {
    console.error("Get history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/revenue-recognition/wip-report/csv", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const mode = req.query.mode as string || "current";
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const months = parseInt(req.query.months as string) || 12;

    if (mode === "history" && orgId) {
      const snapshots = await getHistoricalSnapshots(orgId, undefined, months, startDate, endDate);
      const projectIds = [...new Set(snapshots.map((s) => s.projectId))];
      const projectLookup: Record<string, { code: string; name: string }> = {};
      for (const pid of projectIds) {
        const [proj] = await db.select({ code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, pid)).limit(1);
        if (proj) projectLookup[pid] = proj;
      }
      const histHeaders = ["Period", "Project Code", "Project Name", "Contract Value", "Adj. Contract", "Costs to Date", "Est. Total Cost", "% Complete", "Earned Revenue", "Billings to Date", "Over/(Under)", "Gross Profit", "GP%"];
      const histRows = snapshots.map((s) => [
        s.period,
        projectLookup[s.projectId]?.code || s.projectId,
        `"${(projectLookup[s.projectId]?.name || "").replace(/"/g, '""')}"`,
        s.contractValue,
        s.adjustedContractValue,
        s.costsToDate,
        s.estimatedTotalCost,
        s.percentComplete,
        s.earnedRevenue,
        s.billingsToDate,
        s.overUnderBilling,
        s.grossProfit,
        s.grossProfitPercent,
      ]);
      const csv = [histHeaders.join(","), ...histRows.map((r) => r.join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="wip-history-${new Date().toISOString().split("T")[0]}.csv"`);
      return res.send(csv);
    }

    const filterOrgId = shouldFilter ? orgId : undefined;
    const wipData = await calculateAllProjectsWip(filterOrgId || undefined);

    const headers = [
      "Project Code",
      "Project Name",
      "Client",
      "Contract Value",
      "Change Orders",
      "Adjusted Contract",
      "Costs to Date",
      "Est. Total Cost",
      "% Complete",
      "Earned Revenue",
      "Billings to Date",
      "Over/(Under) Billing",
      "Gross Profit",
      "GP %",
    ];

    const rows = wipData.map((p) => [
      p.projectCode,
      `"${p.projectName.replace(/"/g, '""')}"`,
      `"${(p.clientName || "").replace(/"/g, '""')}"`,
      p.contractValue.toFixed(2),
      p.changeOrderAdjustments.toFixed(2),
      p.adjustedContractValue.toFixed(2),
      p.costsToDate.toFixed(2),
      p.estimatedTotalCost.toFixed(2),
      p.percentComplete.toFixed(2),
      p.earnedRevenue.toFixed(2),
      p.billingsToDate.toFixed(2),
      p.overUnderBilling.toFixed(2),
      p.grossProfit.toFixed(2),
      p.grossProfitPercent.toFixed(2),
    ]);

    const totals = wipData.reduce(
      (acc, p) => {
        acc.contractValue += p.contractValue;
        acc.changeOrderAdjustments += p.changeOrderAdjustments;
        acc.adjustedContractValue += p.adjustedContractValue;
        acc.costsToDate += p.costsToDate;
        acc.estimatedTotalCost += p.estimatedTotalCost;
        acc.earnedRevenue += p.earnedRevenue;
        acc.billingsToDate += p.billingsToDate;
        acc.overUnderBilling += p.overUnderBilling;
        acc.grossProfit += p.grossProfit;
        return acc;
      },
      {
        contractValue: 0, changeOrderAdjustments: 0, adjustedContractValue: 0,
        costsToDate: 0, estimatedTotalCost: 0, earnedRevenue: 0,
        billingsToDate: 0, overUnderBilling: 0, grossProfit: 0,
      },
    );

    const totalPctComplete = totals.estimatedTotalCost > 0 ? (totals.costsToDate / totals.estimatedTotalCost) * 100 : 0;
    const totalGPPct = totals.earnedRevenue > 0 ? (totals.grossProfit / totals.earnedRevenue) * 100 : 0;

    rows.push([
      "TOTALS",
      "",
      "",
      totals.contractValue.toFixed(2),
      totals.changeOrderAdjustments.toFixed(2),
      totals.adjustedContractValue.toFixed(2),
      totals.costsToDate.toFixed(2),
      totals.estimatedTotalCost.toFixed(2),
      totalPctComplete.toFixed(2),
      totals.earnedRevenue.toFixed(2),
      totals.billingsToDate.toFixed(2),
      totals.overUnderBilling.toFixed(2),
      totals.grossProfit.toFixed(2),
      totalGPPct.toFixed(2),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="wip-report-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error("WIP CSV export error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/revenue-recognition/wip-report/pdf", requireAuth, requireFeaturePermission("canAccessFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const mode = req.query.mode as string || "current";
    const pdStartDate = req.query.startDate as string | undefined;
    const pdEndDate = req.query.endDate as string | undefined;
    const pdfMonths = parseInt(req.query.months as string) || 12;

    let wipData: WipProjectData[];
    let reportTitle = "Work-in-Progress Schedule";

    if (mode === "history" && orgId) {
      const snapshots = await getHistoricalSnapshots(orgId, undefined, pdfMonths, pdStartDate, pdEndDate);
      const pdfProjectIds = [...new Set(snapshots.map((s) => s.projectId))];
      const pdfProjectLookup: Record<string, { code: string; name: string }> = {};
      for (const pid of pdfProjectIds) {
        const [proj] = await db.select({ code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, pid)).limit(1);
        if (proj) pdfProjectLookup[pid] = proj;
      }
      wipData = snapshots.map((s) => ({
        projectId: s.projectId,
        projectCode: `${pdfProjectLookup[s.projectId]?.code || s.projectId} (${s.period})`,
        projectName: pdfProjectLookup[s.projectId]?.name || s.projectId,
        clientName: null,
        contractValue: Number(s.contractValue),
        changeOrderAdjustments: Number(s.changeOrderAdjustments),
        adjustedContractValue: Number(s.adjustedContractValue),
        costsToDate: Number(s.costsToDate),
        estimatedTotalCost: Number(s.estimatedTotalCost),
        percentComplete: Number(s.percentComplete),
        earnedRevenue: Number(s.earnedRevenue),
        billingsToDate: Number(s.billingsToDate),
        overUnderBilling: Number(s.overUnderBilling),
        grossProfit: Number(s.grossProfit),
        grossProfitPercent: Number(s.grossProfitPercent),
      }));
      reportTitle = "WIP Historical Snapshot Report";
    } else {
      const filterOrgId = shouldFilter ? orgId : undefined;
      wipData = await calculateAllProjectsWip(filterOrgId || undefined);
    }

    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ layout: "landscape", size: "LEGAL", margin: 30 });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const pdfReady = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const reportDate = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });

    doc.fontSize(16).font("Helvetica-Bold").text(reportTitle, { align: "center" });
    doc.fontSize(10).font("Helvetica").text(`Report Date: ${reportDate}`, { align: "center" });
    doc.moveDown(1);

    const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const cols = [
      { header: "Project", width: 100, align: "left" as const },
      { header: "Contract", width: 75, align: "right" as const },
      { header: "COs", width: 60, align: "right" as const },
      { header: "Adj. Contract", width: 80, align: "right" as const },
      { header: "Costs", width: 75, align: "right" as const },
      { header: "Est. Total", width: 75, align: "right" as const },
      { header: "% Comp", width: 50, align: "right" as const },
      { header: "Earned Rev", width: 80, align: "right" as const },
      { header: "Billings", width: 75, align: "right" as const },
      { header: "Over/(Under)", width: 80, align: "right" as const },
      { header: "Gross Profit", width: 80, align: "right" as const },
      { header: "GP%", width: 45, align: "right" as const },
    ];

    let x = 30;
    const headerY = doc.y;
    doc.fontSize(7).font("Helvetica-Bold");
    for (const col of cols) {
      doc.text(col.header, x, headerY, { width: col.width, align: col.align });
      x += col.width + 4;
    }

    doc.moveTo(30, headerY + 12).lineTo(x, headerY + 12).stroke();
    doc.y = headerY + 16;
    doc.font("Helvetica").fontSize(7);

    for (const p of wipData) {
      const rowY = doc.y;
      if (rowY > doc.page.height - 60) {
        doc.addPage({ layout: "landscape", size: "LEGAL", margin: 30 });
      }
      const currentY = doc.y;
      x = 30;
      const values = [
        p.projectCode,
        fmt(p.contractValue),
        fmt(p.changeOrderAdjustments),
        fmt(p.adjustedContractValue),
        fmt(p.costsToDate),
        fmt(p.estimatedTotalCost),
        p.percentComplete.toFixed(1) + "%",
        fmt(p.earnedRevenue),
        fmt(p.billingsToDate),
        fmt(p.overUnderBilling),
        fmt(p.grossProfit),
        p.grossProfitPercent.toFixed(1) + "%",
      ];
      for (let i = 0; i < cols.length; i++) {
        doc.text(values[i], x, currentY, { width: cols[i].width, align: cols[i].align });
        x += cols[i].width + 4;
      }
      doc.y = currentY + 12;
    }

    const totals = wipData.reduce(
      (acc, p) => ({
        contractValue: acc.contractValue + p.contractValue,
        changeOrderAdjustments: acc.changeOrderAdjustments + p.changeOrderAdjustments,
        adjustedContractValue: acc.adjustedContractValue + p.adjustedContractValue,
        costsToDate: acc.costsToDate + p.costsToDate,
        estimatedTotalCost: acc.estimatedTotalCost + p.estimatedTotalCost,
        earnedRevenue: acc.earnedRevenue + p.earnedRevenue,
        billingsToDate: acc.billingsToDate + p.billingsToDate,
        overUnderBilling: acc.overUnderBilling + p.overUnderBilling,
        grossProfit: acc.grossProfit + p.grossProfit,
      }),
      { contractValue: 0, changeOrderAdjustments: 0, adjustedContractValue: 0, costsToDate: 0, estimatedTotalCost: 0, earnedRevenue: 0, billingsToDate: 0, overUnderBilling: 0, grossProfit: 0 },
    );

    const totalPctComplete = totals.estimatedTotalCost > 0 ? (totals.costsToDate / totals.estimatedTotalCost) * 100 : 0;
    const totalGPPct = totals.earnedRevenue > 0 ? (totals.grossProfit / totals.earnedRevenue) * 100 : 0;

    doc.moveTo(30, doc.y).lineTo(x, doc.y).stroke();
    doc.y += 4;
    doc.font("Helvetica-Bold").fontSize(7);
    const totalY = doc.y;
    x = 30;
    const totalValues = [
      "TOTALS",
      fmt(totals.contractValue),
      fmt(totals.changeOrderAdjustments),
      fmt(totals.adjustedContractValue),
      fmt(totals.costsToDate),
      fmt(totals.estimatedTotalCost),
      totalPctComplete.toFixed(1) + "%",
      fmt(totals.earnedRevenue),
      fmt(totals.billingsToDate),
      fmt(totals.overUnderBilling),
      fmt(totals.grossProfit),
      totalGPPct.toFixed(1) + "%",
    ];
    for (let i = 0; i < cols.length; i++) {
      doc.text(totalValues[i], x, totalY, { width: cols[i].width, align: cols[i].align });
      x += cols[i].width + 4;
    }

    doc.end();
    const pdfBuffer = await pdfReady;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="wip-report-${new Date().toISOString().split("T")[0]}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("WIP PDF export error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
