import { logError } from "./utils/logger";
import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  subcontractorContracts,
  subcontractSovLineItems,
  subPayApplications,
  subPayAppLineItems,
  subRetentionReleases,
  subPerformanceScores,
  subcontractAttachments,
  sovRevisionHistory,
  projects,
  crmOrganisations,
  users,
} from "@shared/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { requireAuth, requireRole, requireRoleOrFeature, AuthRequest } from "./auth";
import { requirePortalAuth, PortalRequest } from "./portalAuth";
import { getOrgIdForFilter } from "./orgFilter";
import { insertNotifications } from "./services/notificationService";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

const router = Router();

async function verifyContractAccessForMgmt(contractId: string, req: AuthRequest): Promise<{ contract: typeof subcontractorContracts.$inferSelect | null; hasAccess: boolean }> {
  const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
  if (mustDenyAccess) return { contract: null, hasAccess: false };

  const [contract] = await db
    .select({ contract: subcontractorContracts, project: { id: projects.id, gcOrganizationId: projects.gcOrganizationId } })
    .from(subcontractorContracts)
    .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
    .where(eq(subcontractorContracts.id, contractId))
    .limit(1);

  if (!contract) return { contract: null, hasAccess: false };

  if (shouldFilter && orgId && !isSuperAdmin && contract.project.gcOrganizationId !== orgId) {
    return { contract: contract.contract, hasAccess: false };
  }

  return { contract: contract.contract, hasAccess: true };
}

router.get("/subcontracts/:contractId/sov", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const items = await db
      .select()
      .from(subcontractSovLineItems)
      .where(eq(subcontractSovLineItems.contractId, contractId))
      .orderBy(asc(subcontractSovLineItems.itemNumber));

    res.json(items);
  } catch (error) {
    logError("Get subcontract SOV error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createSovLineItemSchema = z.object({
  description: z.string().min(1),
  scheduledValue: z.string().or(z.number()),
  itemNumber: z.number().optional(),
  changeOrderRef: z.string().optional().nullable(),
});

router.post("/subcontracts/:contractId/sov", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const parsed = createSovLineItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const data = parsed.data;
    let itemNumber = data.itemNumber;
    if (!itemNumber) {
      const [maxItem] = await db
        .select({ max: sql<number>`COALESCE(MAX(${subcontractSovLineItems.itemNumber}), 0)` })
        .from(subcontractSovLineItems)
        .where(eq(subcontractSovLineItems.contractId, contractId));
      itemNumber = (maxItem?.max || 0) + 1;
    }

    const [newItem] = await db
      .insert(subcontractSovLineItems)
      .values({
        contractId,
        itemNumber,
        description: data.description,
        scheduledValue: String(data.scheduledValue),
        originalValue: String(data.scheduledValue),
        changeOrderRef: data.changeOrderRef || null,
      })
      .returning();

    await db.insert(sovRevisionHistory).values({
      sovLineItemId: newItem.id,
      contractId,
      revisionType: "ITEM_ADDED",
      previousValue: null,
      newValue: `#${itemNumber} - ${data.description} ($${data.scheduledValue})`,
      changeOrderRef: data.changeOrderRef || null,
      changedById: req.user!.id,
    });

    res.status(201).json(newItem);
  } catch (error) {
    logError("Create SOV line item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateSovLineItemSchema = z.object({
  description: z.string().optional(),
  scheduledValue: z.string().or(z.number()).optional(),
  itemNumber: z.number().optional(),
  changeOrderRef: z.string().optional().nullable(),
});

router.patch("/subcontracts/:contractId/sov/:itemId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, itemId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const parsed = updateSovLineItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const data = parsed.data;

    const [existing] = await db.select().from(subcontractSovLineItems)
      .where(and(eq(subcontractSovLineItems.id, itemId), eq(subcontractSovLineItems.contractId, contractId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Line item not found" });

    const updates: Record<string, string | number | Date | null> = { updatedAt: new Date() };
    const revisions: { revisionType: string; previousValue: string; newValue: string; changeOrderRef: string | null }[] = [];

    if (data.description !== undefined && data.description !== existing.description) {
      updates.description = data.description;
      revisions.push({ revisionType: "DESCRIPTION_CHANGE", previousValue: existing.description, newValue: data.description, changeOrderRef: data.changeOrderRef || null });
    }
    if (data.scheduledValue !== undefined && String(data.scheduledValue) !== existing.scheduledValue) {
      updates.scheduledValue = String(data.scheduledValue);
      revisions.push({ revisionType: "VALUE_CHANGE", previousValue: existing.scheduledValue, newValue: String(data.scheduledValue), changeOrderRef: data.changeOrderRef || null });
    }
    if (data.itemNumber !== undefined) updates.itemNumber = data.itemNumber;
    if (data.changeOrderRef !== undefined) updates.changeOrderRef = data.changeOrderRef;

    const [updated] = await db
      .update(subcontractSovLineItems)
      .set(updates)
      .where(and(eq(subcontractSovLineItems.id, itemId), eq(subcontractSovLineItems.contractId, contractId)))
      .returning();

    if (revisions.length > 0) {
      await db.insert(sovRevisionHistory).values(revisions.map(r => ({
        sovLineItemId: itemId,
        contractId,
        ...r,
        changedById: req.user!.id,
      })));
    }

    res.json(updated);
  } catch (error) {
    logError("Update SOV line item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/subcontracts/:contractId/sov/:itemId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, itemId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const [existing] = await db.select().from(subcontractSovLineItems)
      .where(and(eq(subcontractSovLineItems.id, itemId), eq(subcontractSovLineItems.contractId, contractId))).limit(1);

    if (existing) {
      await db.insert(sovRevisionHistory).values({
        sovLineItemId: itemId,
        contractId,
        revisionType: "ITEM_REMOVED",
        previousValue: `#${existing.itemNumber} - ${existing.description} ($${existing.scheduledValue})`,
        newValue: null,
        changeOrderRef: null,
        changedById: req.user!.id,
      });
    }

    await db
      .delete(subcontractSovLineItems)
      .where(and(eq(subcontractSovLineItems.id, itemId), eq(subcontractSovLineItems.contractId, contractId)));

    res.status(204).send();
  } catch (error) {
    logError("Delete SOV line item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:contractId/pay-applications", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const apps = await db
      .select()
      .from(subPayApplications)
      .where(eq(subPayApplications.contractId, contractId))
      .orderBy(desc(subPayApplications.applicationNumber));

    res.json(apps);
  } catch (error) {
    logError("Get sub pay applications error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:contractId/pay-applications/:payAppId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, payAppId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const [payApp] = await db
      .select()
      .from(subPayApplications)
      .where(and(eq(subPayApplications.id, payAppId), eq(subPayApplications.contractId, contractId)))
      .limit(1);

    if (!payApp) return res.status(404).json({ error: "Pay application not found" });

    const lineItems = await db
      .select({
        lineItem: subPayAppLineItems,
        sovItem: subcontractSovLineItems,
      })
      .from(subPayAppLineItems)
      .innerJoin(subcontractSovLineItems, eq(subPayAppLineItems.sovLineItemId, subcontractSovLineItems.id))
      .where(eq(subPayAppLineItems.payAppId, payAppId))
      .orderBy(asc(subcontractSovLineItems.itemNumber));

    res.json({ ...payApp, lineItems: lineItems.map(li => ({ ...li.lineItem, sovItem: li.sovItem })) });
  } catch (error) {
    logError("Get sub pay application detail error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

function fmtCurrency(value: string | number | null): string {
  if (value === null || value === undefined) return "$0.00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(date: Date | string | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

router.get("/subcontracts/:contractId/pay-applications/:payAppId/pdf", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, payAppId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const [payApp] = await db
      .select()
      .from(subPayApplications)
      .where(and(eq(subPayApplications.id, payAppId), eq(subPayApplications.contractId, contractId)))
      .limit(1);

    if (!payApp) return res.status(404).json({ error: "Pay application not found" });

    const lineItems = await db
      .select({ lineItem: subPayAppLineItems, sovItem: subcontractSovLineItems })
      .from(subPayAppLineItems)
      .innerJoin(subcontractSovLineItems, eq(subPayAppLineItems.sovLineItemId, subcontractSovLineItems.id))
      .where(eq(subPayAppLineItems.payAppId, payAppId))
      .orderBy(asc(subcontractSovLineItems.itemNumber));

    const [project] = await db.select().from(projects).where(eq(projects.id, contract.projectId)).limit(1);
    const [sub] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, contract.subcontractorId)).limit(1);

    const doc = new PDFDocument({ margin: 50, size: "LETTER", layout: "landscape", bufferPages: true });
    const stream = new PassThrough();
    doc.pipe(stream);

    doc.fontSize(16).font("Helvetica-Bold").text("APPLICATION AND CERTIFICATE FOR PAYMENT", { align: "center" });
    doc.fontSize(10).font("Helvetica").text("(AIA G702 Style)", { align: "center" });
    doc.moveDown();

    doc.fontSize(10);
    const leftX = 50;
    const rightX = 450;
    doc.font("Helvetica-Bold").text("TO (OWNER/GC):", leftX, doc.y);
    doc.font("Helvetica").text(project?.name || "N/A", leftX + 120, doc.y - 12);
    doc.font("Helvetica-Bold").text("APPLICATION NO:", rightX, doc.y - 12);
    doc.font("Helvetica").text(String(payApp.applicationNumber), rightX + 120, doc.y - 12);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("FROM (CONTRACTOR):", leftX, doc.y);
    doc.font("Helvetica").text(sub?.name || "Unknown", leftX + 120, doc.y - 12);
    doc.font("Helvetica-Bold").text("PERIOD TO:", rightX, doc.y - 12);
    doc.font("Helvetica").text(payApp.periodTo || "N/A", rightX + 120, doc.y - 12);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("PROJECT:", leftX, doc.y);
    doc.font("Helvetica").text(`${project?.code || ""} - ${project?.name || ""}`, leftX + 120, doc.y - 12);
    doc.font("Helvetica-Bold").text("CONTRACT #:", rightX, doc.y - 12);
    doc.font("Helvetica").text(contract.contractNumber, rightX + 120, doc.y - 12);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("STATUS:", leftX, doc.y);
    doc.font("Helvetica").text(payApp.status, leftX + 120, doc.y - 12);
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(11).text("CONTINUATION SHEET (G703)", { align: "center" });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const colWidths = [30, 180, 75, 75, 75, 75, 75, 55, 65];
    const headers = ["#", "Description of Work", "Scheduled Value", "Previous", "This Period", "Materials", "Total Complete", "% Done", "Retention"];
    let xPos = leftX;

    doc.font("Helvetica-Bold").fontSize(7);
    headers.forEach((header, i) => {
      doc.text(header, xPos, tableTop, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
      xPos += colWidths[i] + 2;
    });

    doc.moveTo(leftX, tableTop + 12).lineTo(leftX + colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 2, tableTop + 12).stroke();

    let yPos = tableTop + 16;
    doc.font("Helvetica").fontSize(7);

    for (const { lineItem: li, sovItem } of lineItems) {
      if (yPos > 540) {
        doc.addPage();
        yPos = 50;
      }
      xPos = leftX;
      const vals = [
        String(sovItem.itemNumber),
        sovItem.description.substring(0, 40),
        fmtCurrency(sovItem.scheduledValue),
        fmtCurrency(li.previouslyCompleted),
        fmtCurrency(li.completedThisPeriod),
        fmtCurrency(li.materialsStored),
        fmtCurrency(li.totalCompleted),
        parseFloat(li.percentComplete || "0").toFixed(1) + "%",
        fmtCurrency(li.retentionHeld),
      ];
      vals.forEach((val, i) => {
        doc.text(val, xPos, yPos, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
        xPos += colWidths[i] + 2;
      });
      yPos += 12;
    }

    doc.moveTo(leftX, yPos).lineTo(leftX + colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 2, yPos).stroke();
    yPos += 4;

    doc.font("Helvetica-Bold").fontSize(8);
    xPos = leftX;
    doc.text("TOTALS", xPos, yPos, { width: colWidths[0] + colWidths[1] + 2, align: "left" });
    xPos = leftX + colWidths[0] + colWidths[1] + 4;
    doc.text(fmtCurrency(payApp.totalScheduledValue), xPos, yPos, { width: colWidths[2], align: "right" });
    xPos += colWidths[2] + 2;
    doc.text(fmtCurrency(payApp.totalCompletedPrevious), xPos, yPos, { width: colWidths[3], align: "right" });
    xPos += colWidths[3] + 2;
    doc.text(fmtCurrency(payApp.totalCompletedThisPeriod), xPos, yPos, { width: colWidths[4], align: "right" });
    xPos += colWidths[4] + 2;
    doc.text(fmtCurrency(payApp.totalMaterialsStored), xPos, yPos, { width: colWidths[5], align: "right" });
    xPos += colWidths[5] + 2;
    doc.text(fmtCurrency(payApp.totalCompletedToDate), xPos, yPos, { width: colWidths[6], align: "right" });
    xPos += colWidths[6] + 2 + colWidths[7] + 2;
    doc.text(fmtCurrency(payApp.totalRetentionHeld), xPos, yPos, { width: colWidths[8], align: "right" });

    yPos += 20;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`NET AMOUNT DUE THIS APPLICATION: ${fmtCurrency(payApp.netAmountDue)}`, leftX, yPos);

    if (payApp.approvedAt) {
      yPos += 30;
      doc.font("Helvetica").fontSize(9);
      doc.text(`Approved: ${fmtDate(payApp.approvedAt)}`, leftX, yPos);
    }
    if (payApp.paidAt) {
      doc.text(`Paid: ${fmtDate(payApp.paidAt)}`, leftX + 250, yPos);
    }

    doc.end();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="PayApp-${contract.contractNumber}-${payApp.applicationNumber}.pdf"`);
    stream.pipe(res);
  } catch (error) {
    logError("Generate pay app PDF error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createSubPayAppSchema = z.object({
  periodTo: z.string().optional(),
});

router.post("/subcontracts/:contractId/pay-applications", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const parsed = createSubPayAppSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed" });

    const sovItems = await db
      .select()
      .from(subcontractSovLineItems)
      .where(eq(subcontractSovLineItems.contractId, contractId))
      .orderBy(asc(subcontractSovLineItems.itemNumber));

    if (sovItems.length === 0) {
      return res.status(400).json({ error: "Cannot create pay application without SOV line items. Add scope items first." });
    }

    const [maxApp] = await db
      .select({ max: sql<number>`COALESCE(MAX(${subPayApplications.applicationNumber}), 0)` })
      .from(subPayApplications)
      .where(eq(subPayApplications.contractId, contractId));

    const applicationNumber = (maxApp?.max || 0) + 1;

    const retentionPct = parseFloat(contract.retentionPercent || "0") / 100;

    const previousApps = await db
      .select()
      .from(subPayApplications)
      .where(and(
        eq(subPayApplications.contractId, contractId),
        sql`${subPayApplications.status} IN ('APPROVED', 'PAID')`
      ));

    const previousLineItems = previousApps.length > 0
      ? await db
          .select()
          .from(subPayAppLineItems)
          .where(sql`${subPayAppLineItems.payAppId} IN (${sql.join(previousApps.map(a => sql`${a.id}`), sql`, `)})`)
      : [];

    const previousBySovItem: Record<string, number> = {};
    previousLineItems.forEach(li => {
      const key = li.sovLineItemId;
      previousBySovItem[key] = (previousBySovItem[key] || 0) + parseFloat(li.completedThisPeriod || "0") + parseFloat(li.materialsStored || "0");
    });

    const totalScheduledValue = sovItems.reduce((sum, item) => sum + parseFloat(item.scheduledValue || "0"), 0);

    const lineItemValues = sovItems.map(item => {
      const prevCompleted = previousBySovItem[item.id] || 0;
      return {
        payAppId: "",
        sovLineItemId: item.id,
        previouslyCompleted: String(prevCompleted),
        completedThisPeriod: "0",
        materialsStored: "0",
        totalCompleted: String(prevCompleted),
        percentComplete: String(parseFloat(item.scheduledValue || "0") > 0 ? ((prevCompleted / parseFloat(item.scheduledValue)) * 100).toFixed(2) : "0"),
        retentionHeld: String((prevCompleted * retentionPct).toFixed(2)),
      };
    });

    const totalPrevious = lineItemValues.reduce((s, li) => s + parseFloat(li.previouslyCompleted), 0);
    const totalCompletedToDate = lineItemValues.reduce((s, li) => s + parseFloat(li.totalCompleted), 0);
    const totalRetention = lineItemValues.reduce((s, li) => s + parseFloat(li.retentionHeld), 0);

    const [newApp] = await db
      .insert(subPayApplications)
      .values({
        contractId,
        applicationNumber,
        periodTo: parsed.data.periodTo || null,
        status: "DRAFT",
        totalScheduledValue: String(totalScheduledValue),
        totalCompletedPrevious: String(totalPrevious.toFixed(2)),
        totalCompletedThisPeriod: "0",
        totalMaterialsStored: "0",
        totalCompletedToDate: String(totalCompletedToDate.toFixed(2)),
        totalRetentionHeld: String(totalRetention.toFixed(2)),
        netAmountDue: "0",
        createdById: req.user!.id,
      })
      .returning();

    const finalLineItems = lineItemValues.map(li => ({ ...li, payAppId: newApp.id }));

    if (finalLineItems.length > 0) {
      await db.insert(subPayAppLineItems).values(finalLineItems);
    }

    res.status(201).json(newApp);
  } catch (error) {
    logError("Create sub pay application error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateSubPayAppLineItemSchema = z.object({
  lineItems: z.array(z.object({
    id: z.string(),
    completedThisPeriod: z.string().or(z.number()),
    materialsStored: z.string().or(z.number()),
  })),
});

router.patch("/subcontracts/:contractId/pay-applications/:payAppId/line-items", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, payAppId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const [payApp] = await db
      .select()
      .from(subPayApplications)
      .where(and(eq(subPayApplications.id, payAppId), eq(subPayApplications.contractId, contractId)))
      .limit(1);

    if (!payApp) return res.status(404).json({ error: "Pay application not found" });
    if (payApp.status !== "DRAFT") return res.status(400).json({ error: "Can only edit DRAFT pay applications" });

    const parsed = updateSubPayAppLineItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const retentionPct = parseFloat(contract.retentionPercent || "0") / 100;

    for (const item of parsed.data.lineItems) {
      const thisPeriodNum = parseFloat(String(item.completedThisPeriod));
      const storedNum = parseFloat(String(item.materialsStored));

      if (isNaN(thisPeriodNum) || !isFinite(thisPeriodNum) || thisPeriodNum < 0) {
        return res.status(400).json({ error: `Invalid value for completed this period on line item ${item.id}. Must be a non-negative number.` });
      }
      if (isNaN(storedNum) || !isFinite(storedNum) || storedNum < 0) {
        return res.status(400).json({ error: `Invalid value for materials stored on line item ${item.id}. Must be a non-negative number.` });
      }

      const [existing] = await db
        .select({ li: subPayAppLineItems, sov: subcontractSovLineItems })
        .from(subPayAppLineItems)
        .innerJoin(subcontractSovLineItems, eq(subPayAppLineItems.sovLineItemId, subcontractSovLineItems.id))
        .where(and(eq(subPayAppLineItems.id, item.id), eq(subPayAppLineItems.payAppId, payAppId)))
        .limit(1);

      if (!existing) continue;

      const prev = parseFloat(existing.li.previouslyCompleted || "0");
      const thisPeriod = thisPeriodNum;
      const stored = storedNum;
      const total = prev + thisPeriod + stored;
      const scheduledValue = parseFloat(existing.sov.scheduledValue || "0");

      if (scheduledValue > 0 && total > scheduledValue * 1.0001) {
        return res.status(400).json({ error: `Total completed ($${total.toFixed(2)}) exceeds scheduled value ($${scheduledValue.toFixed(2)}) for line item ${item.id}` });
      }

      const pctComplete = scheduledValue > 0 ? (total / scheduledValue) * 100 : 0;
      const retention = total * retentionPct;

      await db
        .update(subPayAppLineItems)
        .set({
          completedThisPeriod: String(thisPeriod),
          materialsStored: String(stored),
          totalCompleted: String(total),
          percentComplete: String(pctComplete.toFixed(2)),
          retentionHeld: String(retention.toFixed(2)),
        })
        .where(eq(subPayAppLineItems.id, item.id));
    }

    const allLineItems = await db
      .select()
      .from(subPayAppLineItems)
      .where(eq(subPayAppLineItems.payAppId, payAppId));

    let totalPrevious = 0;
    let totalThisPeriod = 0;
    let totalStored = 0;
    let totalCompleted = 0;
    let totalRetention = 0;

    for (const li of allLineItems) {
      totalPrevious += parseFloat(li.previouslyCompleted || "0");
      totalThisPeriod += parseFloat(li.completedThisPeriod || "0");
      totalStored += parseFloat(li.materialsStored || "0");
      totalCompleted += parseFloat(li.totalCompleted || "0");
      totalRetention += parseFloat(li.retentionHeld || "0");
    }

    const previousRetention = totalPrevious * (parseFloat(contract.retentionPercent || "0") / 100);
    const retentionThisPeriod = totalRetention - previousRetention;
    const netDue = (totalThisPeriod + totalStored) - retentionThisPeriod;

    const [updated] = await db
      .update(subPayApplications)
      .set({
        totalCompletedPrevious: String(totalPrevious.toFixed(2)),
        totalCompletedThisPeriod: String(totalThisPeriod.toFixed(2)),
        totalMaterialsStored: String(totalStored.toFixed(2)),
        totalCompletedToDate: String(totalCompleted.toFixed(2)),
        totalRetentionHeld: String(totalRetention.toFixed(2)),
        netAmountDue: String(Math.max(0, netDue).toFixed(2)),
        updatedAt: new Date(),
      })
      .where(eq(subPayApplications.id, payAppId))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Update sub pay app line items error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const validPayAppTransitions: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["PAID"],
  REJECTED: ["DRAFT"],
  PAID: [],
};

const updateSubPayAppStatusSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "PAID"]),
  rejectionReason: z.string().optional(),
});

router.patch("/subcontracts/:contractId/pay-applications/:payAppId/status", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, payAppId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const [payApp] = await db
      .select()
      .from(subPayApplications)
      .where(and(eq(subPayApplications.id, payAppId), eq(subPayApplications.contractId, contractId)))
      .limit(1);

    if (!payApp) return res.status(404).json({ error: "Pay application not found" });

    const parsed = updateSubPayAppStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed" });

    const { status, rejectionReason } = parsed.data;
    const allowed = validPayAppTransitions[payApp.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${payApp.status} to ${status}` });
    }

    const updates: Record<string, string | Date | null> = { status, updatedAt: new Date() };
    if (status === "SUBMITTED") updates.submittedAt = new Date();
    if (status === "UNDER_REVIEW") updates.reviewedAt = new Date();
    if (status === "APPROVED") { updates.approvedAt = new Date(); updates.approvedById = req.user!.id; }
    if (status === "REJECTED") updates.rejectionReason = rejectionReason || null;
    if (status === "PAID") updates.paidAt = new Date();

    const [updated] = await db
      .update(subPayApplications)
      .set(updates)
      .where(eq(subPayApplications.id, payAppId))
      .returning();

    if (["SUBMITTED", "APPROVED", "REJECTED"].includes(status)) {
      try {
        const [project] = await db
          .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
          .from(projects)
          .where(eq(projects.id, contract.projectId))
          .limit(1);

        if (project?.gcOrganizationId) {
          const eligibleUsers = await db
            .select({ id: users.id })
            .from(users)
            .where(and(
              eq(users.organizationId, project.gcOrganizationId),
              eq(users.isActive, true),
            ))
            .limit(20);

          const notifUsers = eligibleUsers.filter(u => u.id !== req.user!.id);
          if (notifUsers.length > 0) {
            await insertNotifications(notifUsers.map(u => ({
              userId: u.id,
              type: "GENERAL" as const,
              title: `Sub Pay App #${payApp.applicationNumber} ${status.replace('_', ' ')}`,
              message: `Pay application #${payApp.applicationNumber} for contract ${contract.contractNumber} has been ${status.toLowerCase().replace('_', ' ')}`,
              relatedEntityId: contractId,
              relatedEntityType: "subcontract" as const,
              organizationId: project.gcOrganizationId,
            })));
          }
        }
      } catch (e) {
        logError("Pay app status notification error (non-blocking):", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }

    res.json(updated);
  } catch (error) {
    logError("Update sub pay app status error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:contractId/retention", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const latestApprovedApp = await db
      .select()
      .from(subPayApplications)
      .where(and(
        eq(subPayApplications.contractId, contractId),
        sql`${subPayApplications.status} IN ('APPROVED', 'PAID')`
      ))
      .orderBy(desc(subPayApplications.applicationNumber))
      .limit(1);

    const totalRetentionHeld = latestApprovedApp.length > 0
      ? parseFloat(latestApprovedApp[0].totalRetentionHeld || "0")
      : 0;

    const releases = await db
      .select()
      .from(subRetentionReleases)
      .where(eq(subRetentionReleases.contractId, contractId))
      .orderBy(desc(subRetentionReleases.createdAt));

    const totalReleased = releases
      .filter(r => r.status === "APPROVED")
      .reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0);

    res.json({
      contractId,
      retentionPercent: contract.retentionPercent || "0",
      totalRetentionHeld: totalRetentionHeld.toFixed(2),
      totalReleased: totalReleased.toFixed(2),
      balanceRemaining: (totalRetentionHeld - totalReleased).toFixed(2),
      releases,
    });
  } catch (error) {
    logError("Get retention summary error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/retention/summary", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json({ totals: { totalRetentionHeld: "0.00", totalReleased: "0.00", balanceRemaining: "0.00" }, contracts: [] });

    const allContracts = await db
      .select({
        contract: subcontractorContracts,
        project: { id: projects.id, name: projects.name, code: projects.code, gcOrganizationId: projects.gcOrganizationId },
        subcontractor: { id: crmOrganisations.id, name: crmOrganisations.name },
      })
      .from(subcontractorContracts)
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .innerJoin(crmOrganisations, eq(subcontractorContracts.subcontractorId, crmOrganisations.id));

    let filteredContracts = allContracts;
    if (shouldFilter && orgId && !isSuperAdmin) {
      filteredContracts = allContracts.filter(c => c.project.gcOrganizationId === orgId);
    }

    const summaries = [];
    for (const c of filteredContracts) {
      const latestApp = await db
        .select({ totalRetentionHeld: subPayApplications.totalRetentionHeld })
        .from(subPayApplications)
        .where(and(
          eq(subPayApplications.contractId, c.contract.id),
          sql`${subPayApplications.status} IN ('APPROVED', 'PAID')`
        ))
        .orderBy(desc(subPayApplications.applicationNumber))
        .limit(1);

      const totalHeld = latestApp.length > 0 ? parseFloat(latestApp[0].totalRetentionHeld || "0") : 0;

      const releases = await db
        .select({ amount: subRetentionReleases.amount })
        .from(subRetentionReleases)
        .where(and(
          eq(subRetentionReleases.contractId, c.contract.id),
          eq(subRetentionReleases.status, "APPROVED")
        ));

      const totalReleased = releases.reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0);

      if (totalHeld > 0 || totalReleased > 0) {
        summaries.push({
          contractId: c.contract.id,
          contractNumber: c.contract.contractNumber,
          subcontractorName: c.subcontractor.name,
          projectName: c.project.name,
          retentionPercent: c.contract.retentionPercent || "0",
          totalRetentionHeld: totalHeld.toFixed(2),
          totalReleased: totalReleased.toFixed(2),
          balanceRemaining: (totalHeld - totalReleased).toFixed(2),
        });
      }
    }

    const totalHeld = summaries.reduce((s, r) => s + parseFloat(r.totalRetentionHeld), 0);
    const totalReleased = summaries.reduce((s, r) => s + parseFloat(r.totalReleased), 0);

    res.json({
      totals: {
        totalRetentionHeld: totalHeld.toFixed(2),
        totalReleased: totalReleased.toFixed(2),
        balanceRemaining: (totalHeld - totalReleased).toFixed(2),
      },
      contracts: summaries,
    });
  } catch (error) {
    logError("Get retention dashboard error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createRetentionReleaseSchema = z.object({
  amount: z.string().or(z.number()),
  releaseType: z.enum(["PARTIAL", "FULL"]),
  reason: z.string().optional(),
});

async function getRetentionBalance(contractId: string): Promise<number> {
  const latestApp = await db
    .select({ totalRetentionHeld: subPayApplications.totalRetentionHeld })
    .from(subPayApplications)
    .where(and(
      eq(subPayApplications.contractId, contractId),
      sql`${subPayApplications.status} IN ('APPROVED', 'PAID')`
    ))
    .orderBy(desc(subPayApplications.applicationNumber))
    .limit(1);

  const totalHeld = latestApp.length > 0 ? parseFloat(latestApp[0].totalRetentionHeld || "0") : 0;

  const releases = await db
    .select({ amount: subRetentionReleases.amount })
    .from(subRetentionReleases)
    .where(and(
      eq(subRetentionReleases.contractId, contractId),
      eq(subRetentionReleases.status, "APPROVED")
    ));

  const totalReleased = releases.reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0);
  return totalHeld - totalReleased;
}

router.post("/subcontracts/:contractId/retention/release", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const parsed = createRetentionReleaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const requestAmount = parseFloat(String(parsed.data.amount));
    if (isNaN(requestAmount) || requestAmount <= 0) {
      return res.status(400).json({ error: "Release amount must be a positive number" });
    }

    const availableBalance = await getRetentionBalance(contractId);
    if (requestAmount > availableBalance + 0.01) {
      return res.status(400).json({ error: `Release amount ($${requestAmount.toFixed(2)}) exceeds available retention balance ($${availableBalance.toFixed(2)})` });
    }

    const [newRelease] = await db
      .insert(subRetentionReleases)
      .values({
        contractId,
        amount: String(requestAmount.toFixed(2)),
        releaseType: parsed.data.releaseType,
        reason: parsed.data.reason || null,
        status: "PENDING",
        requestedById: req.user!.id,
      })
      .returning();

    res.status(201).json(newRelease);
  } catch (error) {
    logError("Create retention release error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const retentionReleaseActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().optional(),
});

router.patch("/subcontracts/:contractId/retention/release/:releaseId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, releaseId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const parsed = retentionReleaseActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed" });

    const [release] = await db
      .select()
      .from(subRetentionReleases)
      .where(and(eq(subRetentionReleases.id, releaseId), eq(subRetentionReleases.contractId, contractId)))
      .limit(1);

    if (!release) return res.status(404).json({ error: "Release not found" });
    if (release.status !== "PENDING") return res.status(400).json({ error: "Release is not pending" });

    if (parsed.data.action === "APPROVE") {
      const availableBalance = await getRetentionBalance(contractId);
      const releaseAmount = parseFloat(release.amount || "0");
      if (releaseAmount > availableBalance + 0.01) {
        return res.status(400).json({ error: `Release amount ($${releaseAmount.toFixed(2)}) exceeds available retention balance ($${availableBalance.toFixed(2)})` });
      }
    }

    const updates: Record<string, Date | string | null> = { updatedAt: new Date() };
    if (parsed.data.action === "APPROVE") {
      updates.status = "APPROVED";
      updates.approvedById = req.user!.id;
      updates.approvedAt = new Date();
    } else {
      updates.status = "REJECTED";
      updates.rejectedById = req.user!.id;
      updates.rejectedAt = new Date();
      updates.rejectionReason = parsed.data.rejectionReason || null;
    }

    const [updated] = await db
      .update(subRetentionReleases)
      .set(updates)
      .where(eq(subRetentionReleases.id, releaseId))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Update retention release error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:contractId/performance", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const scores = await db
      .select()
      .from(subPerformanceScores)
      .where(eq(subPerformanceScores.contractId, contractId))
      .orderBy(desc(subPerformanceScores.periodDate));

    const latest = scores[0];
    const avgRating = scores.length > 0
      ? (scores.reduce((sum, s) => sum + parseFloat(s.overallRating || "0"), 0) / scores.length).toFixed(1)
      : null;

    res.json({
      contractId,
      latestScore: latest || null,
      averageRating: avgRating,
      history: scores,
    });
  } catch (error) {
    logError("Get performance scores error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createPerformanceScoreSchema = z.object({
  periodDate: z.string(),
  scheduleAdherence: z.number().min(0).max(100).optional(),
  workCompletionPercent: z.number().min(0).max(100).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  safetyIncidents: z.number().min(0).optional(),
  punchListItems: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.post("/subcontracts/:contractId/performance", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const parsed = createPerformanceScoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const data = parsed.data;
    const schedule = data.scheduleAdherence || 0;
    const completion = data.workCompletionPercent || 0;
    const quality = data.qualityScore || 0;
    const safetyScore = Math.max(0, 100 - (data.safetyIncidents || 0) * 20);
    const punchScore = Math.max(0, 100 - (data.punchListItems || 0) * 5);

    const overallRating = ((schedule * 0.25) + (completion * 0.25) + (quality * 0.25) + (safetyScore * 0.15) + (punchScore * 0.1)) / 20;

    const [newScore] = await db
      .insert(subPerformanceScores)
      .values({
        contractId,
        periodDate: new Date(data.periodDate),
        scheduleAdherence: data.scheduleAdherence || null,
        workCompletionPercent: data.workCompletionPercent || null,
        qualityScore: data.qualityScore || null,
        safetyIncidents: data.safetyIncidents || 0,
        punchListItems: data.punchListItems || 0,
        overallRating: String(overallRating.toFixed(1)),
        notes: data.notes || null,
        scoredById: req.user!.id,
      })
      .returning();

    res.status(201).json(newScore);
  } catch (error) {
    logError("Create performance score error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/performance/summary", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const allContracts = await db
      .select({
        contract: subcontractorContracts,
        project: { id: projects.id, name: projects.name, gcOrganizationId: projects.gcOrganizationId },
        subcontractor: { id: crmOrganisations.id, name: crmOrganisations.name },
      })
      .from(subcontractorContracts)
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .innerJoin(crmOrganisations, eq(subcontractorContracts.subcontractorId, crmOrganisations.id));

    let filteredContracts = allContracts;
    if (shouldFilter && orgId && !isSuperAdmin) {
      filteredContracts = allContracts.filter(c => c.project.gcOrganizationId === orgId);
    }

    const summaries = [];
    for (const c of filteredContracts) {
      const scores = await db
        .select()
        .from(subPerformanceScores)
        .where(eq(subPerformanceScores.contractId, c.contract.id))
        .orderBy(desc(subPerformanceScores.periodDate));

      if (scores.length > 0) {
        const avgRating = scores.reduce((sum, s) => sum + parseFloat(s.overallRating || "0"), 0) / scores.length;
        const latest = scores[0];

        const trendData = scores
          .slice()
          .reverse()
          .map(s => ({
            period: s.periodDate ? new Date(s.periodDate).toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : "N/A",
            periodDate: s.periodDate ? new Date(s.periodDate).toISOString().split("T")[0] : null,
            rating: parseFloat(s.overallRating || "0"),
            schedule: s.scheduleAdherence || 0,
            quality: s.qualityScore || 0,
          }));

        summaries.push({
          contractId: c.contract.id,
          contractNumber: c.contract.contractNumber,
          subcontractorName: c.subcontractor.name,
          projectName: c.project.name,
          projectId: c.project.id,
          latestRating: latest.overallRating,
          averageRating: avgRating.toFixed(1),
          totalEntries: scores.length,
          latestScheduleAdherence: latest.scheduleAdherence,
          latestWorkCompletion: latest.workCompletionPercent,
          latestQuality: latest.qualityScore,
          latestSafety: latest.safetyIncidents,
          trendData,
        });
      }
    }

    summaries.sort((a, b) => parseFloat(b.averageRating) - parseFloat(a.averageRating));

    res.json(summaries);
  } catch (error) {
    logError("Get performance summary error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================
// Contract Attachments
// =====================

router.get("/subcontracts/:contractId/attachments", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const attachments = await db.select({
      attachment: subcontractAttachments,
      uploadedBy: { id: users.id, firstName: users.firstName, lastName: users.lastName },
    })
      .from(subcontractAttachments)
      .leftJoin(users, eq(subcontractAttachments.uploadedById, users.id))
      .where(eq(subcontractAttachments.contractId, contractId))
      .orderBy(desc(subcontractAttachments.createdAt));

    res.json(attachments.map(a => ({ ...a.attachment, uploadedBy: a.uploadedBy })));
  } catch (error) {
    logError("Get attachments error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/subcontracts/:contractId/attachments", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const schema = z.object({
      fileName: z.string().min(1),
      fileUrl: z.string().min(1),
      fileSize: z.number().optional(),
      fileType: z.string().optional(),
      category: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const [attachment] = await db.insert(subcontractAttachments).values({
      contractId,
      ...parsed.data,
      fileSize: parsed.data.fileSize ?? null,
      fileType: parsed.data.fileType ?? null,
      category: parsed.data.category ?? "GENERAL",
      uploadedById: req.user!.id,
    }).returning();

    res.status(201).json(attachment);
  } catch (error) {
    logError("Create attachment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/subcontracts/:contractId/attachments/:attachmentId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canEditFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, attachmentId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    await db.delete(subcontractAttachments)
      .where(and(eq(subcontractAttachments.id, attachmentId), eq(subcontractAttachments.contractId, contractId)));

    res.json({ success: true });
  } catch (error) {
    logError("Delete attachment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================
// SOV Revision History
// =====================

router.get("/subcontracts/:contractId/sov/revisions", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canViewFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const { contract, hasAccess } = await verifyContractAccessForMgmt(contractId, req);
    if (!contract || !hasAccess) return res.status(404).json({ error: "Contract not found" });

    const revisions = await db.select({
      revision: sovRevisionHistory,
      sovItem: { id: subcontractSovLineItems.id, description: subcontractSovLineItems.description, itemNumber: subcontractSovLineItems.itemNumber },
      changedBy: { id: users.id, firstName: users.firstName, lastName: users.lastName },
    })
      .from(sovRevisionHistory)
      .leftJoin(subcontractSovLineItems, eq(sovRevisionHistory.sovLineItemId, subcontractSovLineItems.id))
      .leftJoin(users, eq(sovRevisionHistory.changedById, users.id))
      .where(eq(sovRevisionHistory.contractId, contractId))
      .orderBy(desc(sovRevisionHistory.createdAt));

    res.json(revisions.map(r => ({ ...r.revision, sovItem: r.sovItem, changedBy: r.changedBy })));
  } catch (error) {
    logError("Get SOV revisions error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================
// Portal Pay App Submission (Subcontractor-facing)
// =====================

router.post("/portal/subcontracts/:contractId/pay-applications", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const { contractId } = req.params;
    const portal = req.portalToken!;

    const [contract] = await db.select().from(subcontractorContracts)
      .where(and(
        eq(subcontractorContracts.id, contractId),
        eq(subcontractorContracts.projectId, portal.projectId),
        eq(subcontractorContracts.subcontractorId, portal.crmOrganisationId),
      )).limit(1);
    if (!contract) return res.status(404).json({ error: "Contract not found or not accessible" });

    const sovItems = await db.select().from(subcontractSovLineItems)
      .where(eq(subcontractSovLineItems.contractId, contractId))
      .orderBy(asc(subcontractSovLineItems.itemNumber));

    if (sovItems.length === 0) return res.status(400).json({ error: "No SOV line items exist for this contract" });

    const existingApps = await db.select({ applicationNumber: subPayApplications.applicationNumber })
      .from(subPayApplications)
      .where(eq(subPayApplications.contractId, contractId))
      .orderBy(desc(subPayApplications.applicationNumber))
      .limit(1);

    const nextAppNumber = existingApps.length > 0 ? existingApps[0].applicationNumber + 1 : 1;

    const lastApprovedApp = await db.select({ id: subPayApplications.id })
      .from(subPayApplications)
      .where(and(
        eq(subPayApplications.contractId, contractId),
        sql`${subPayApplications.status} IN ('APPROVED', 'PAID')`,
      ))
      .orderBy(desc(subPayApplications.applicationNumber))
      .limit(1);

    const previousLineItems: Record<string, number> = {};
    if (lastApprovedApp.length > 0) {
      const prevItems = await db.select().from(subPayAppLineItems)
        .where(eq(subPayAppLineItems.payAppId, lastApprovedApp[0].id));
      for (const pi of prevItems) {
        previousLineItems[pi.sovLineItemId] = parseFloat(pi.totalCompleted || "0");
      }
    }

    const schema = z.object({
      periodTo: z.string().optional(),
      lineItems: z.array(z.object({
        sovLineItemId: z.string(),
        completedThisPeriod: z.string().or(z.number()).transform(v => String(v)),
        materialsStored: z.string().or(z.number()).transform(v => String(v)),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    for (const li of parsed.data.lineItems) {
      const completedVal = parseFloat(li.completedThisPeriod);
      const storedVal = parseFloat(li.materialsStored);
      if (!isFinite(completedVal) || completedVal < 0) return res.status(400).json({ error: `Completed this period must be a non-negative number for SOV item ${li.sovLineItemId}` });
      if (!isFinite(storedVal) || storedVal < 0) return res.status(400).json({ error: `Materials stored must be a non-negative number for SOV item ${li.sovLineItemId}` });
      const sovItem = sovItems.find(s => s.id === li.sovLineItemId);
      if (sovItem) {
        const scheduled = parseFloat(sovItem.scheduledValue);
        const prev = previousLineItems[li.sovLineItemId] || 0;
        if (prev + completedVal + storedVal > scheduled * 1.0001) {
          return res.status(400).json({ error: `Total completed for item ${li.sovLineItemId} exceeds scheduled value` });
        }
      }
    }

    let totalScheduled = 0, totalCompletedPrev = 0, totalCompletedThis = 0, totalStored = 0, totalCompleted = 0, totalRetention = 0, totalPrevRetention = 0;
    const retentionRate = parseFloat(contract.retentionPercent || "10") / 100;

    const lineItemValues = parsed.data.lineItems.map(li => {
      const sovItem = sovItems.find(s => s.id === li.sovLineItemId);
      if (!sovItem) throw new Error(`SOV item ${li.sovLineItemId} not found`);
      const scheduled = parseFloat(sovItem.scheduledValue);
      const prevCompleted = previousLineItems[li.sovLineItemId] || 0;
      const thisCompleted = parseFloat(li.completedThisPeriod) || 0;
      const stored = parseFloat(li.materialsStored) || 0;
      const total = prevCompleted + thisCompleted + stored;
      const pctComplete = scheduled > 0 ? (total / scheduled) * 100 : 0;
      const retentionCumulative = total * retentionRate;
      const retentionPrev = prevCompleted * retentionRate;

      totalScheduled += scheduled;
      totalCompletedPrev += prevCompleted;
      totalCompletedThis += thisCompleted;
      totalStored += stored;
      totalCompleted += total;
      totalRetention += retentionCumulative;
      totalPrevRetention += retentionPrev;

      return {
        sovLineItemId: li.sovLineItemId,
        previouslyCompleted: String(prevCompleted),
        completedThisPeriod: li.completedThisPeriod,
        materialsStored: li.materialsStored,
        totalCompleted: String(total),
        percentComplete: String(pctComplete.toFixed(2)),
        retentionHeld: String(retentionCumulative.toFixed(2)),
      };
    });

    const retentionThisPeriod = totalRetention - totalPrevRetention;
    const netDue = totalCompletedThis + totalStored - retentionThisPeriod;

    const [payApp] = await db.insert(subPayApplications).values({
      contractId,
      applicationNumber: nextAppNumber,
      periodTo: parsed.data.periodTo || null,
      status: "SUBMITTED",
      submittedAt: new Date(),
      totalScheduledValue: String(totalScheduled),
      totalCompletedPrevious: String(totalCompletedPrev),
      totalCompletedThisPeriod: String(totalCompletedThis),
      totalMaterialsStored: String(totalStored),
      totalCompletedToDate: String(totalCompleted),
      totalRetentionHeld: String(totalRetention),
      netAmountDue: String(netDue),
    }).returning();

    for (const li of lineItemValues) {
      await db.insert(subPayAppLineItems).values({ payAppId: payApp.id, ...li });
    }

    try {
      const [project] = await db.select().from(projects).where(eq(projects.id, contract.projectId)).limit(1);
      if (project) {
        const eligibleUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.organizationId, project.gcOrganizationId),
            sql`${users.role} IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER')`,
          ))
          .limit(20);

        if (eligibleUsers.length > 0) {
          await insertNotifications(eligibleUsers.map(u => ({
            userId: u.id,
            type: "GENERAL" as const,
            title: `Pay App #${nextAppNumber} Submitted by Subcontractor`,
            message: `Subcontractor submitted pay application #${nextAppNumber} for contract ${contract.contractNumber}. Review required.`,
            relatedEntityId: contractId,
            relatedEntityType: "subcontract" as const,
            organizationId: project.gcOrganizationId,
          })));
        }
      }
    } catch (notifErr) {
      logError("Portal pay app notification error:", {}, notifErr instanceof Error ? notifErr : new Error(String(notifErr)));
    }

    res.status(201).json(payApp);
  } catch (error) {
    logError("Portal pay app submission error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
