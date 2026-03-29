import { logError } from "./utils/logger";
import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  scheduleOfValues, sovLineItems, sovPayments, projects, organizations, users,
  payApplications, storedMaterials, retentionReleases, changeOrders, tmTickets,
  purchaseOrders, purchaseOrderItems,
} from "@shared/schema";
import { eq, and, desc, sql, gte, lte, inArray, type SQL } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole, requireFeaturePermission } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { verifyProjectAccess, verifySOVAccess, calculateSOVTotals } from "./sovHelpers";
import { generateAIAG702PDF, generateAIAG703PDF } from "./aia-pdf-service";
import { insertNotifications } from "./services/notificationService";
import { sendEmail } from "./services/emailService";

const router = Router();

router.use(requireAuth);
router.use(requireFeaturePermission("canAccessFinancials"));

const validPayAppStatusTransitions: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED", "UNDER_REVIEW"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "SUBMITTED"],
  APPROVED: [],
  REJECTED: ["DRAFT"],
  PAID: ["ARCHIVED"],
  ARCHIVED: [],
};

// ========================================
// PAY APPLICATION CRUD
// ========================================

router.get("/pay-applications", async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(payApplications.organizationId, orgId));
    }

    const apps = await db.select({
      id: payApplications.id,
      organizationId: payApplications.organizationId,
      projectId: payApplications.projectId,
      sovId: payApplications.sovId,
      applicationNumber: payApplications.applicationNumber,
      periodTo: payApplications.periodTo,
      contractorName: payApplications.contractorName,
      originalContractSum: payApplications.originalContractSum,
      contractSumToDate: payApplications.contractSumToDate,
      totalCompletedAndStored: payApplications.totalCompletedAndStored,
      currentPaymentDue: payApplications.currentPaymentDue,
      totalRetained: payApplications.totalRetained,
      balanceToFinish: payApplications.balanceToFinish,
      status: payApplications.status,
      submittedAt: payApplications.submittedAt,
      approvedAt: payApplications.approvedAt,
      createdAt: payApplications.createdAt,
      projectName: projects.name,
      projectCode: projects.code,
      sovNumber: scheduleOfValues.sovNumber,
    })
    .from(payApplications)
    .innerJoin(projects, eq(payApplications.projectId, projects.id))
    .innerJoin(scheduleOfValues, eq(payApplications.sovId, scheduleOfValues.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(payApplications.createdAt))
    .limit(200);

    res.json(apps);
  } catch (error) {
    logError("Get pay applications error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pay-applications/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [app] = await db.select().from(payApplications).where(eq(payApplications.id, id)).limit(1);
    if (!app) return res.status(404).json({ error: "Pay application not found" });
    if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    const lineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, app.sovId)).orderBy(sovLineItems.lineNumber);
    const [project] = await db.select().from(projects).where(eq(projects.id, app.projectId)).limit(1);
    const [sov] = await db.select().from(scheduleOfValues).where(eq(scheduleOfValues.id, app.sovId)).limit(1);

    res.json({ ...app, lineItems, project, sov });
  } catch (error) {
    logError("Get pay application error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createPayAppSchema = z.object({
  projectId: z.string().min(1),
  sovId: z.string().min(1),
  periodTo: z.string().optional(),
  architectName: z.string().optional(),
  architectAddress: z.string().optional(),
  ownerName: z.string().optional(),
  ownerAddress: z.string().optional(),
  contractorName: z.string().optional(),
  contractorAddress: z.string().optional(),
  contractDate: z.string().optional(),
  contractFor: z.string().optional(),
});

router.post("/pay-applications", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = createPayAppSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const data = parsed.data;
    const { sov, hasAccess } = await verifySOVAccess(data.sovId, orgId, shouldFilter);
    if (!sov || !hasAccess) return res.status(404).json({ error: "SOV not found" });

    if (sov.projectId !== data.projectId) {
      return res.status(400).json({ error: "Project ID does not match the SOV's project" });
    }

    const existingApps = await db.select({ applicationNumber: payApplications.applicationNumber })
      .from(payApplications)
      .where(eq(payApplications.projectId, data.projectId))
      .orderBy(desc(payApplications.applicationNumber))
      .limit(1);

    const nextAppNumber = existingApps.length > 0 ? existingApps[0].applicationNumber + 1 : 1;

    const approvedCOs = await db.select({ amount: changeOrders.amount })
      .from(changeOrders)
      .where(and(eq(changeOrders.projectId, data.projectId), eq(changeOrders.status, "APPROVED")));

    const netCO = approvedCOs.reduce((sum, co) => sum + parseFloat(co.amount || "0"), 0);
    const originalContract = parseFloat(sov.contractValue || "0");
    const contractSumToDate = originalContract + netCO;
    const totalCompleted = parseFloat(sov.totalCompletedToDate || "0");
    const retPct = parseFloat(sov.retainagePercent || "10");
    const totalRetained = totalCompleted * (retPct / 100);
    const totalEarned = totalCompleted - totalRetained;

    const [latestPriorApp] = await db.select({ totalEarnedLessRetainage: payApplications.totalEarnedLessRetainage })
      .from(payApplications)
      .where(and(
        eq(payApplications.projectId, data.projectId),
        sql`application_number < ${nextAppNumber}`,
        sql`${payApplications.status} IN ('APPROVED', 'PAID', 'ARCHIVED')`
      ))
      .orderBy(desc(payApplications.applicationNumber))
      .limit(1);
    const previousCerts = parseFloat(latestPriorApp?.totalEarnedLessRetainage || "0");

    const currentDue = totalEarned - previousCerts;
    const balance = contractSumToDate - totalCompleted;

    const [newApp] = await db.insert(payApplications).values({
      organizationId: sov.organizationId,
      projectId: data.projectId,
      sovId: data.sovId,
      applicationNumber: nextAppNumber,
      periodTo: data.periodTo || null,
      architectName: data.architectName || null,
      architectAddress: data.architectAddress || null,
      ownerName: data.ownerName || null,
      ownerAddress: data.ownerAddress || null,
      contractorName: data.contractorName || null,
      contractorAddress: data.contractorAddress || null,
      contractDate: data.contractDate || null,
      contractFor: data.contractFor || null,
      originalContractSum: String(originalContract),
      netChangeByChangeOrders: String(netCO),
      contractSumToDate: String(contractSumToDate),
      totalCompletedAndStored: String(totalCompleted),
      retainagePercent: String(retPct),
      totalRetained: String(totalRetained.toFixed(2)),
      totalEarnedLessRetainage: String(totalEarned.toFixed(2)),
      lessPreviousCertificates: String(previousCerts.toFixed(2)),
      currentPaymentDue: String(Math.max(0, currentDue).toFixed(2)),
      balanceToFinish: String(balance.toFixed(2)),
      status: "DRAFT",
      createdById: req.user?.id,
    }).returning();

    res.status(201).json(newApp);
  } catch (error) {
    logError("Create pay application error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updatePayAppStatusSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "UNDER_REVIEW", "PAID", "ARCHIVED"]),
  rejectionReason: z.string().optional(),
});

router.patch("/pay-applications/:id/status", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updatePayAppStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid status", details: parsed.error.flatten() });
    const { status, rejectionReason } = parsed.data;

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [app] = await db.select().from(payApplications).where(eq(payApplications.id, id)).limit(1);
    if (!app) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    const allowedNext = validPayAppStatusTransitions[app.status] || [];
    if (!allowedNext.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${app.status} to ${status}` });
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "SUBMITTED") updates.submittedAt = new Date();
    if (status === "APPROVED") { updates.approvedAt = new Date(); updates.approvedById = req.user?.id; }
    if (status === "REJECTED") updates.rejectionReason = rejectionReason || null;

    const [updated] = await db.update(payApplications).set(updates).where(eq(payApplications.id, id)).returning();

    const sovStatusMap: Record<string, string> = { SUBMITTED: "SUBMITTED", APPROVED: "APPROVED", REJECTED: "REJECTED", UNDER_REVIEW: "UNDER_REVIEW", DRAFT: "DRAFT" };
    const mappedSOVStatus = sovStatusMap[status];
    if (mappedSOVStatus && app.sovId) {
      await db.update(scheduleOfValues).set({ status: mappedSOVStatus as "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "UNDER_REVIEW", updatedAt: new Date() }).where(eq(scheduleOfValues.id, app.sovId));
    }

    if (status === "SUBMITTED" && req.user?.organizationId) {
      try {
        const admins = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.organizationId, req.user.organizationId), eq(users.isActive, true)))
          .limit(20);
        const approvers = admins.filter(a => a.id !== req.user?.id);
        if (approvers.length > 0) {
          await insertNotifications(approvers.map(a => ({
            userId: a.id,
            type: "SOV_ITEM_COMPLETED" as const,
            title: "Pay Application Submitted",
            message: `Pay Application #${app.applicationNumber} has been submitted for review`,
            relatedEntityId: app.projectId,
            relatedEntityType: "project" as const,
          })));
        }

        const [project] = await db.select({
          clientContactEmail: projects.clientContactEmail,
          clientName: projects.clientName,
          name: projects.name,
        }).from(projects).where(eq(projects.id, app.projectId)).limit(1);

        if (project?.clientContactEmail) {
          const clientUserConditions = [eq(users.email, project.clientContactEmail)];
          if (req.user?.organizationId) {
            clientUserConditions.push(eq(users.organizationId, req.user.organizationId));
          }
          const clientUsers = await db.select({ id: users.id }).from(users)
            .where(and(...clientUserConditions)).limit(1);
          if (clientUsers.length > 0) {
            await insertNotifications([{
              userId: clientUsers[0].id,
              type: "SOV_ITEM_COMPLETED" as const,
              title: "Pay Application Submitted for Review",
              message: `Pay Application #${app.applicationNumber} for ${project.clientName || "project"} has been submitted and requires your review`,
              relatedEntityId: app.projectId,
              relatedEntityType: "project" as const,
            }]);
          }

          await sendEmail({
            to: project.clientContactEmail,
            subject: `Pay Application #${app.applicationNumber} Submitted for Review - ${project.name || project.clientName || "Project"}`,
            html: `<p>A new pay application has been submitted for your review.</p>
              <p><strong>Project:</strong> ${project.name || "N/A"}</p>
              <p><strong>Application #:</strong> ${app.applicationNumber}</p>
              <p><strong>Amount Due:</strong> $${parseFloat(app.currentPaymentDue || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              <p>Please log in to review and approve this application.</p>`,
            text: `Pay Application #${app.applicationNumber} for ${project.name || "project"} has been submitted for your review. Amount due: $${parseFloat(app.currentPaymentDue || "0").toFixed(2)}. Please log in to review.`,
          }).catch(() => {});
        }
      } catch (e) { /* non-blocking */ }
    }

    res.json(updated);
  } catch (error) {
    logError("Update pay app status error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive("Payment amount must be positive"),
  paymentReference: z.string().optional(),
  paymentMethod: z.enum(["CHECK", "ACH", "WIRE", "CREDIT_CARD", "OTHER"]).optional().default("CHECK"),
});

router.post("/pay-applications/:id/record-payment", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const [app] = await db.select().from(payApplications).where(eq(payApplications.id, id)).limit(1);
    if (!app) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    if (app.status !== "APPROVED") {
      if (app.status === "PAID") {
        return res.status(400).json({ error: "Pay application is already fully paid" });
      }
      return res.status(400).json({ error: "Payment can only be recorded for approved pay applications" });
    }

    const { amount, paymentReference, paymentMethod } = parsed.data;
    const amountStr = amount.toFixed(2);

    const currentPaymentDue = parseFloat(app.currentPaymentDue || "0");
    const previouslyPaid = parseFloat(app.paidAmount || "0");
    const remainingDue = currentPaymentDue - previouslyPaid;

    if (remainingDue <= 0) {
      return res.status(400).json({ error: "No remaining balance due on this pay application" });
    }

    if (amount > remainingDue * 1.001) {
      return res.status(400).json({ error: `Payment amount ($${amountStr}) exceeds remaining balance due ($${remainingDue.toFixed(2)})` });
    }

    const existingPayments = await db.select({ maxNum: sql<number>`COALESCE(MAX(payment_number), 0)` })
      .from(sovPayments).where(eq(sovPayments.sovId, app.sovId));
    const nextPaymentNum = (existingPayments[0]?.maxNum || 0) + 1;

    await db.insert(sovPayments).values({
      organizationId: app.organizationId,
      sovId: app.sovId,
      paymentNumber: nextPaymentNum,
      amount: amountStr,
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: paymentMethod || "CHECK",
      referenceNumber: paymentReference || null,
      notes: `Pay Application #${app.applicationNumber} payment`,
      recordedById: req.user?.id,
    });

    const newTotalPaid = previouslyPaid + amount;
    const fullyPaid = currentPaymentDue > 0 && newTotalPaid >= currentPaymentDue * 0.999;

    const newStatus = fullyPaid ? "PAID" : "APPROVED";
    const [updated] = await db.update(payApplications).set({
      status: newStatus,
      paidAmount: newTotalPaid.toFixed(2),
      paidAt: fullyPaid ? new Date() : null,
      paymentReference: paymentReference || null,
      paymentMethod: paymentMethod || null,
      updatedAt: new Date(),
    }).where(eq(payApplications.id, id)).returning();

    if (fullyPaid && app.sovId) {
      await db.update(scheduleOfValues).set({ status: "PAID", updatedAt: new Date() }).where(eq(scheduleOfValues.id, app.sovId));
    }

    res.json(updated);
  } catch (error) {
    logError("Record payment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// AIA G702/G703 PDF GENERATION
// ========================================

router.post("/pay-applications/:id/sync-totals", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [app] = await db.select().from(payApplications).where(eq(payApplications.id, id)).limit(1);
    if (!app) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    if (app.status === "PAID" || app.status === "ARCHIVED") {
      return res.status(400).json({ error: "Cannot re-sync totals for paid or archived pay applications" });
    }

    const [sov] = await db.select().from(scheduleOfValues).where(eq(scheduleOfValues.id, app.sovId)).limit(1);
    if (!sov) return res.status(404).json({ error: "Linked SOV not found" });

    const lineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, app.sovId));
    const retainagePct = parseFloat(sov.retainagePercent || "10") / 100;
    const totals = calculateSOVTotals(lineItems, retainagePct);

    const cos = await db.select({ amount: changeOrders.amount, status: changeOrders.status })
      .from(changeOrders)
      .where(and(eq(changeOrders.projectId, app.projectId), eq(changeOrders.status, "APPROVED")));
    const netCOChange = cos.reduce((sum, co) => sum + parseFloat(co.amount || "0"), 0);
    const originalContract = parseFloat(sov.contractValue || "0") - netCOChange;

    const [latestPriorApp] = await db.select({ totalEarnedLessRetainage: payApplications.totalEarnedLessRetainage })
      .from(payApplications)
      .where(and(
        eq(payApplications.projectId, app.projectId),
        sql`application_number < ${app.applicationNumber}`,
        sql`${payApplications.status} IN ('APPROVED', 'PAID', 'ARCHIVED')`
      ))
      .orderBy(desc(payApplications.applicationNumber))
      .limit(1);
    const lessPrevCerts = parseFloat(latestPriorApp?.totalEarnedLessRetainage || "0");

    const totalEarnedLessRet = parseFloat(totals.totalCompletedToDate || "0") - parseFloat(totals.totalRetainage || "0");
    const currentPaymentDue = totalEarnedLessRet - lessPrevCerts;

    const [updated] = await db.update(payApplications).set({
      originalContractSum: String(originalContract.toFixed(2)),
      netChangeByChangeOrders: String(netCOChange.toFixed(2)),
      contractSumToDate: sov.contractValue,
      totalCompletedAndStored: totals.totalCompletedToDate,
      retainagePercent: sov.retainagePercent,
      totalRetained: totals.totalRetainage,
      totalEarnedLessRetainage: String(totalEarnedLessRet.toFixed(2)),
      lessPreviousCertificates: String(lessPrevCerts.toFixed(2)),
      currentPaymentDue: String(Math.max(0, currentPaymentDue).toFixed(2)),
      balanceToFinish: String(Math.max(0, parseFloat(sov.contractValue || "0") - parseFloat(totals.totalCompletedToDate || "0")).toFixed(2)),
      updatedAt: new Date(),
    }).where(eq(payApplications.id, id)).returning();

    res.json(updated);
  } catch (error) {
    logError("Sync pay app totals error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pay-applications/:id/g702-pdf", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [app] = await db.select().from(payApplications).where(eq(payApplications.id, id)).limit(1);
    if (!app) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    const [project] = await db.select().from(projects).where(eq(projects.id, app.projectId)).limit(1);

    const coSummary = await db.select({
      changeOrderNumber: changeOrders.changeOrderNumber,
      approvedAt: changeOrders.approvedAt,
      amount: changeOrders.amount,
    }).from(changeOrders)
      .where(and(eq(changeOrders.projectId, app.projectId), eq(changeOrders.status, "APPROVED")));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="G702-App${app.applicationNumber}.pdf"`);

    const pdfStream = generateAIAG702PDF({
      ownerName: app.ownerName || '',
      ownerAddress: app.ownerAddress || '',
      architectName: app.architectName || '',
      architectAddress: app.architectAddress || '',
      contractorName: app.contractorName || '',
      contractorAddress: app.contractorAddress || '',
      projectName: project?.name || '',
      projectLocation: [project?.locationAddress, project?.city, project?.state].filter(Boolean).join(', '),
      applicationNumber: app.applicationNumber,
      periodTo: app.periodTo || '',
      contractDate: app.contractDate || '',
      contractFor: app.contractFor || '',
      originalContractSum: parseFloat(app.originalContractSum || "0"),
      netChangeByChangeOrders: parseFloat(app.netChangeByChangeOrders || "0"),
      contractSumToDate: parseFloat(app.contractSumToDate || "0"),
      totalCompletedAndStored: parseFloat(app.totalCompletedAndStored || "0"),
      retainagePercent: parseFloat(app.retainagePercent || "0"),
      totalRetained: parseFloat(app.totalRetained || "0"),
      totalEarnedLessRetainage: parseFloat(app.totalEarnedLessRetainage || "0"),
      lessPreviousCertificates: parseFloat(app.lessPreviousCertificates || "0"),
      currentPaymentDue: parseFloat(app.currentPaymentDue || "0"),
      balanceToFinish: parseFloat(app.balanceToFinish || "0"),
      changeOrdersSummary: coSummary.map(co => ({
        number: co.changeOrderNumber || '',
        date: co.approvedAt ? co.approvedAt.toISOString() : '',
        amount: parseFloat(co.amount || "0"),
      })),
    });

    pdfStream.pipe(res);
  } catch (error) {
    logError("G702 PDF error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pay-applications/:id/g703-pdf", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [app] = await db.select().from(payApplications).where(eq(payApplications.id, id)).limit(1);
    if (!app) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    const lineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, app.sovId)).orderBy(sovLineItems.lineNumber);
    const [project] = await db.select().from(projects).where(eq(projects.id, app.projectId)).limit(1);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="G703-App${app.applicationNumber}.pdf"`);

    const pdfStream = generateAIAG703PDF({
      applicationNumber: app.applicationNumber,
      periodTo: app.periodTo || '',
      projectName: project?.name || '',
      contractorName: app.contractorName || '',
      lineItems: lineItems.map(li => ({
        lineNumber: li.lineNumber,
        itemCode: li.itemCode,
        description: li.description,
        scheduledValue: parseFloat(li.scheduledValue || "0"),
        previouslyCompleted: parseFloat(li.previouslyCompleted || "0"),
        thisPeriodCompleted: parseFloat(li.thisPeriodCompleted || "0"),
        materialsStored: parseFloat(li.materialsStored || "0"),
        totalCompletedAndStored: parseFloat(li.totalCompletedAndStored || "0"),
        percentComplete: parseFloat(li.percentComplete || "0"),
        balanceToFinish: parseFloat(li.balanceToFinish || "0"),
        retainageAmount: parseFloat(li.retainageAmount || "0"),
      })),
    });

    pdfStream.pipe(res);
  } catch (error) {
    logError("G703 PDF error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// PERIOD ROLL-FORWARD
// ========================================

router.post("/pay-applications/roll-forward", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { sovId, periodTo } = req.body;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);
    if (!sov || !hasAccess) return res.status(404).json({ error: "SOV not found" });

    const currentLineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, sovId)).orderBy(sovLineItems.lineNumber);
    const retainagePct = parseFloat(sov.retainagePercent || "10") / 100;

    const existingSOVs = await db.select({ periodNumber: scheduleOfValues.periodNumber })
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, sov.projectId))
      .orderBy(desc(scheduleOfValues.periodNumber))
      .limit(1);

    const nextPeriod = (existingSOVs[0]?.periodNumber || 0) + 1;

    const existingPayApps = await db.select({ maxAppNum: sql<number>`COALESCE(MAX(application_number), 0)` })
      .from(payApplications)
      .where(eq(payApplications.projectId, sov.projectId));
    const nextAppNumber = Math.max(nextPeriod, (existingPayApps[0]?.maxAppNum || 0) + 1);

    const [project] = await db.select().from(projects).where(eq(projects.id, sov.projectId)).limit(1);
    const sovNumber = `SOV-${project?.code || 'XXX'}-${String(nextPeriod).padStart(3, '0')}`;

    const [newSOV] = await db.insert(scheduleOfValues).values({
      organizationId: sov.organizationId,
      projectId: sov.projectId,
      sovNumber,
      title: `Pay Application #${nextAppNumber}`,
      description: `Roll-forward from ${sov.sovNumber}`,
      contractValue: sov.contractValue,
      retainagePercent: sov.retainagePercent,
      periodNumber: nextPeriod,
      periodStart: sov.periodEnd || null,
      periodEnd: periodTo || null,
      status: "DRAFT",
      createdById: req.user?.id,
    }).returning();

    const newLineItems = currentLineItems.map(item => {
      const prevCompleted = parseFloat(item.previouslyCompleted || "0");
      const thisPeriod = parseFloat(item.thisPeriodCompleted || "0");
      const stored = parseFloat(item.materialsStored || "0");
      const newPreviouslyCompleted = prevCompleted + thisPeriod;
      const scheduled = parseFloat(item.scheduledValue || "0");

      return {
        sovId: newSOV.id,
        lineNumber: item.lineNumber,
        itemCode: item.itemCode,
        description: item.description,
        category: item.category,
        scheduledValue: item.scheduledValue,
        previouslyCompleted: String(newPreviouslyCompleted),
        thisPeriodCompleted: "0",
        materialsStored: String(stored),
        totalCompletedAndStored: String(newPreviouslyCompleted + stored),
        percentComplete: scheduled > 0 ? String(((newPreviouslyCompleted + stored) / scheduled * 100).toFixed(2)) : "0",
        balanceToFinish: String(Math.max(0, scheduled - newPreviouslyCompleted - stored)),
        retainageAmount: String(((newPreviouslyCompleted + stored) * retainagePct).toFixed(2)),
        notes: item.notes,
        estimateLineItemId: item.estimateLineItemId,
        linkedChangeOrderId: item.linkedChangeOrderId,
        organizationSowItemId: item.organizationSowItemId,
      };
    });

    if (newLineItems.length > 0) {
      await db.insert(sovLineItems).values(newLineItems);
    }

    const allLineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, newSOV.id));
    const totals = calculateSOVTotals(allLineItems, retainagePct);
    await db.update(scheduleOfValues).set({ ...totals, updatedAt: new Date() }).where(eq(scheduleOfValues.id, newSOV.id));

    const cos = await db.select({ amount: changeOrders.amount })
      .from(changeOrders)
      .where(and(eq(changeOrders.projectId, sov.projectId), eq(changeOrders.status, "APPROVED")));
    const netCOChange = cos.reduce((sum, co) => sum + parseFloat(co.amount || "0"), 0);
    const contractValue = parseFloat(sov.contractValue || "0");
    const originalContract = contractValue - netCOChange;
    const totalCompleted = parseFloat(totals.totalCompletedToDate || "0");
    const totalRetainage = parseFloat(totals.totalRetainage || "0");
    const totalEarnedLessRet = totalCompleted - totalRetainage;

    const [latestPriorApp] = await db.select({ totalEarnedLessRetainage: payApplications.totalEarnedLessRetainage })
      .from(payApplications)
      .where(and(
        eq(payApplications.projectId, sov.projectId),
        sql`application_number < ${nextAppNumber}`,
        sql`${payApplications.status} IN ('APPROVED', 'PAID', 'ARCHIVED')`
      ))
      .orderBy(desc(payApplications.applicationNumber))
      .limit(1);
    const lessPrevCerts = parseFloat(latestPriorApp?.totalEarnedLessRetainage || "0");
    const currentPaymentDue = Math.max(0, totalEarnedLessRet - lessPrevCerts);

    const [newPayApp] = await db.insert(payApplications).values({
      organizationId: sov.organizationId,
      projectId: sov.projectId,
      sovId: newSOV.id,
      applicationNumber: nextAppNumber,
      periodTo: periodTo || null,
      originalContractSum: String(originalContract.toFixed(2)),
      netChangeByChangeOrders: String(netCOChange.toFixed(2)),
      contractSumToDate: sov.contractValue,
      totalCompletedAndStored: totals.totalCompletedToDate,
      retainagePercent: sov.retainagePercent,
      totalRetained: totals.totalRetainage,
      totalEarnedLessRetainage: String(totalEarnedLessRet.toFixed(2)),
      lessPreviousCertificates: String(lessPrevCerts.toFixed(2)),
      currentPaymentDue: String(currentPaymentDue.toFixed(2)),
      balanceToFinish: String(Math.max(0, contractValue - totalCompleted).toFixed(2)),
      status: "DRAFT",
      createdById: req.user?.id,
    }).returning();

    const newLineItemsByCode = new Map<string, string>();
    const newLineItemsByLine = new Map<number, string>();
    const newLineItemRows = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, newSOV.id));
    for (const li of newLineItemRows) {
      if (li.itemCode) newLineItemsByCode.set(li.itemCode, li.id);
      newLineItemsByLine.set(li.lineNumber, li.id);
    }

    const oldToNewLineItem = new Map<string, string>();
    for (const oldItem of currentLineItems) {
      const newId = (oldItem.itemCode && newLineItemsByCode.get(oldItem.itemCode)) || newLineItemsByLine.get(oldItem.lineNumber);
      if (newId) oldToNewLineItem.set(oldItem.id, newId);
    }

    const pendingMaterials = await db.select().from(storedMaterials)
      .where(and(
        eq(storedMaterials.sovId, sovId),
        sql`${storedMaterials.storageStatus} IN ('ON_SITE', 'OFF_SITE')`
      ));

    if (pendingMaterials.length > 0) {
      const carriedMaterials = pendingMaterials.map(m => ({
        organizationId: m.organizationId,
        projectId: m.projectId,
        sovId: newSOV.id,
        sovLineItemId: (m.sovLineItemId && oldToNewLineItem.get(m.sovLineItemId)) || null,
        description: m.description,
        amount: m.amount,
        deliveryDate: m.deliveryDate,
        storageLocation: m.storageLocation,
        storageStatus: m.storageStatus as "ON_SITE" | "OFF_SITE",
        vendor: m.vendor,
        invoiceReference: m.invoiceReference,
        notes: `Carried forward from ${sov.sovNumber}${m.notes ? ` | ${m.notes}` : ""}`,
      }));
      await db.insert(storedMaterials).values(carriedMaterials);
    }

    const [createdSOV] = await db.select().from(scheduleOfValues).where(eq(scheduleOfValues.id, newSOV.id)).limit(1);
    res.status(201).json({ sov: createdSOV, payApplication: newPayApp });
  } catch (error) {
    logError("Roll-forward error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// STORED MATERIALS
// ========================================

router.get("/stored-materials", async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(storedMaterials.organizationId, orgId));
    if (req.query.sovId) conditions.push(eq(storedMaterials.sovId, req.query.sovId as string));
    if (req.query.projectId) conditions.push(eq(storedMaterials.projectId, req.query.projectId as string));

    const materials = await db.select({
      id: storedMaterials.id,
      projectId: storedMaterials.projectId,
      sovId: storedMaterials.sovId,
      sovLineItemId: storedMaterials.sovLineItemId,
      description: storedMaterials.description,
      storageLocation: storedMaterials.storageLocation,
      storageStatus: storedMaterials.storageStatus,
      deliveryDate: storedMaterials.deliveryDate,
      incorporatedDate: storedMaterials.incorporatedDate,
      amount: storedMaterials.amount,
      vendor: storedMaterials.vendor,
      invoiceReference: storedMaterials.invoiceReference,
      notes: storedMaterials.notes,
      createdAt: storedMaterials.createdAt,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(storedMaterials)
    .innerJoin(projects, eq(storedMaterials.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(storedMaterials.createdAt))
    .limit(500);

    res.json(materials);
  } catch (error) {
    logError("Get stored materials error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createStoredMaterialSchema = z.object({
  projectId: z.string().min(1),
  sovId: z.string().min(1),
  sovLineItemId: z.string().optional(),
  description: z.string().min(1),
  storageLocation: z.string().optional(),
  storageStatus: z.enum(["ON_SITE", "OFF_SITE"]).optional().default("ON_SITE"),
  deliveryDate: z.string().optional(),
  amount: z.string().or(z.number()).transform(v => String(v)),
  vendor: z.string().optional(),
  invoiceReference: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/stored-materials", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = createStoredMaterialSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const data = parsed.data;
    const { sov, hasAccess } = await verifySOVAccess(data.sovId, orgId, shouldFilter);
    if (!sov || !hasAccess) return res.status(404).json({ error: "SOV not found" });

    if (sov.projectId !== data.projectId) {
      return res.status(400).json({ error: "Project ID does not match the SOV's project" });
    }

    if (data.sovLineItemId) {
      const [lineItem] = await db.select({ id: sovLineItems.id, sovId: sovLineItems.sovId })
        .from(sovLineItems).where(eq(sovLineItems.id, data.sovLineItemId)).limit(1);
      if (!lineItem || lineItem.sovId !== data.sovId) {
        return res.status(400).json({ error: "SOV line item does not belong to the specified SOV" });
      }
    }

    const [material] = await db.insert(storedMaterials).values({
      organizationId: sov.organizationId,
      projectId: data.projectId,
      sovId: data.sovId,
      sovLineItemId: data.sovLineItemId || null,
      description: data.description,
      storageLocation: data.storageLocation || null,
      storageStatus: data.storageStatus,
      deliveryDate: data.deliveryDate || null,
      amount: data.amount,
      vendor: data.vendor || null,
      invoiceReference: data.invoiceReference || null,
      notes: data.notes || null,
      createdById: req.user?.id,
    }).returning();

    if (data.sovLineItemId) {
      const [lineItem] = await db.select().from(sovLineItems).where(eq(sovLineItems.id, data.sovLineItemId)).limit(1);
      if (lineItem) {
        const newStored = parseFloat(lineItem.materialsStored || "0") + parseFloat(data.amount);
        const scheduled = parseFloat(lineItem.scheduledValue || "0");
        const prev = parseFloat(lineItem.previouslyCompleted || "0");
        const curr = parseFloat(lineItem.thisPeriodCompleted || "0");
        const total = prev + curr + newStored;
        const pct = scheduled > 0 ? Math.min(100, (total / scheduled) * 100) : 0;
        const balance = Math.max(0, scheduled - total);
        const retPct = parseFloat(sov.retainagePercent || "10") / 100;

        await db.update(sovLineItems).set({
          materialsStored: String(newStored),
          totalCompletedAndStored: String(total),
          percentComplete: String(pct.toFixed(2)),
          balanceToFinish: String(balance),
          retainageAmount: String((total * retPct).toFixed(2)),
          updatedAt: new Date(),
        }).where(eq(sovLineItems.id, data.sovLineItemId));
      }
    }

    res.status(201).json(material);
  } catch (error) {
    logError("Create stored material error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/stored-materials/:id/incorporate", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [material] = await db.select().from(storedMaterials).where(eq(storedMaterials.id, id)).limit(1);
    if (!material) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && material.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    if (material.storageStatus === "INCORPORATED") {
      return res.status(400).json({ error: "Material has already been incorporated" });
    }

    const [updated] = await db.update(storedMaterials).set({
      storageStatus: "INCORPORATED",
      incorporatedDate: new Date().toISOString().split('T')[0],
      updatedAt: new Date(),
    }).where(eq(storedMaterials.id, id)).returning();

    if (material.sovLineItemId) {
      const [lineItem] = await db.select().from(sovLineItems).where(eq(sovLineItems.id, material.sovLineItemId)).limit(1);
      if (lineItem) {
        const amt = parseFloat(material.amount || "0");
        const newStored = Math.max(0, parseFloat(lineItem.materialsStored || "0") - amt);
        const newThisPeriod = parseFloat(lineItem.thisPeriodCompleted || "0") + amt;
        const prev = parseFloat(lineItem.previouslyCompleted || "0");
        const scheduled = parseFloat(lineItem.scheduledValue || "0");
        const total = prev + newThisPeriod + newStored;
        const pct = scheduled > 0 ? Math.min(100, (total / scheduled) * 100) : 0;
        const balance = Math.max(0, scheduled - total);

        const [sov] = await db.select().from(scheduleOfValues).where(eq(scheduleOfValues.id, material.sovId)).limit(1);
        const retPct = parseFloat(sov?.retainagePercent || "10") / 100;

        await db.update(sovLineItems).set({
          materialsStored: String(newStored),
          thisPeriodCompleted: String(newThisPeriod),
          totalCompletedAndStored: String(total),
          percentComplete: String(pct.toFixed(2)),
          balanceToFinish: String(balance),
          retainageAmount: String((total * retPct).toFixed(2)),
          updatedAt: new Date(),
        }).where(eq(sovLineItems.id, material.sovLineItemId));
      }
    }

    res.json(updated);
  } catch (error) {
    logError("Incorporate material error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// CROSS-MODULE INTEGRATION
// ========================================

router.get("/billing-integration/change-orders/:projectId", async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const { project, hasAccess } = await verifyProjectAccess(projectId, orgId, shouldFilter);
    if (!project || !hasAccess) return res.status(404).json({ error: "Project not found" });

    const cos = await db.select({
      id: changeOrders.id,
      changeOrderNumber: changeOrders.changeOrderNumber,
      description: changeOrders.description,
      amount: changeOrders.amount,
      status: changeOrders.status,
      approvedAt: changeOrders.approvedAt,
    }).from(changeOrders)
      .where(and(eq(changeOrders.projectId, projectId), eq(changeOrders.status, "APPROVED")))
      .orderBy(desc(changeOrders.approvedAt));

    const existingLinks = await db.select({ linkedChangeOrderId: sovLineItems.linkedChangeOrderId })
      .from(sovLineItems)
      .innerJoin(scheduleOfValues, eq(sovLineItems.sovId, scheduleOfValues.id))
      .where(eq(scheduleOfValues.projectId, projectId));

    const linkedCoIds = new Set(existingLinks.filter(l => l.linkedChangeOrderId).map(l => l.linkedChangeOrderId));

    res.json(cos.map(co => ({ ...co, isLinkedToSOV: linkedCoIds.has(co.id) })));
  } catch (error) {
    logError("Get billing COs error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/billing-integration/add-co-to-sov", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { sovId, changeOrderId } = req.body;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);
    if (!sov || !hasAccess) return res.status(404).json({ error: "SOV not found" });

    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, changeOrderId)).limit(1);
    if (!co || co.status !== "APPROVED") return res.status(400).json({ error: "Change order must be approved" });
    if (co.projectId !== sov.projectId) return res.status(400).json({ error: "Change order does not belong to this SOV's project" });

    const existingItems = await db.select({ maxLine: sql<number>`COALESCE(MAX(line_number), 0)` })
      .from(sovLineItems).where(eq(sovLineItems.sovId, sovId));
    const nextLine = (existingItems[0]?.maxLine || 0) + 1;

    const amount = parseFloat(co.amount || "0");

    const [newItem] = await db.insert(sovLineItems).values({
      sovId,
      lineNumber: nextLine,
      itemCode: `CO-${co.changeOrderNumber}`,
      description: `Change Order #${co.changeOrderNumber}: ${co.description || ''}`.substring(0, 255),
      category: null,
      scheduledValue: String(amount),
      previouslyCompleted: "0",
      thisPeriodCompleted: "0",
      materialsStored: "0",
      totalCompletedAndStored: "0",
      percentComplete: "0",
      balanceToFinish: String(amount),
      retainageAmount: "0",
      linkedChangeOrderId: co.id,
    }).returning();

    const retainagePct = parseFloat(sov.retainagePercent || "10") / 100;
    const allLineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, sovId));
    const totals = calculateSOVTotals(allLineItems, retainagePct);
    await db.update(scheduleOfValues).set({ ...totals, updatedAt: new Date() }).where(eq(scheduleOfValues.id, sovId));

    res.status(201).json(newItem);
  } catch (error) {
    logError("Add CO to SOV error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/billing-integration/tm-tickets/:projectId", async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const { project, hasAccess } = await verifyProjectAccess(projectId, orgId, shouldFilter);
    if (!project || !hasAccess) return res.status(404).json({ error: "Project not found" });

    const tickets = await db.select({
      id: tmTickets.id,
      ticketNumber: tmTickets.ticketNumber,
      workDate: tmTickets.workDate,
      grandTotal: tmTickets.grandTotal,
      status: tmTickets.status,
      costCode: tmTickets.costCode,
    }).from(tmTickets)
      .where(and(eq(tmTickets.projectId, projectId), eq(tmTickets.status, "APPROVED")))
      .orderBy(desc(tmTickets.workDate));

    res.json(tickets);
  } catch (error) {
    logError("Get billing T&M tickets error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/billing-integration/po-costs/:projectId", async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const { project, hasAccess } = await verifyProjectAccess(projectId, orgId, shouldFilter);
    if (!project || !hasAccess) return res.status(404).json({ error: "Project not found" });

    const committedStatuses = ["APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL", "FULFILLED"];

    const pos = await db.select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      totalCost: purchaseOrders.totalCost,
    }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.projectId, projectId), inArray(purchaseOrders.status, committedStatuses)))
      .orderBy(desc(purchaseOrders.createdAt));

    const poItems = await db.select({
      poId: purchaseOrderItems.purchaseOrderId,
      costCode: purchaseOrderItems.costCode,
      totalPrice: purchaseOrderItems.totalPrice,
    }).from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .where(and(eq(purchaseOrders.projectId, projectId), inArray(purchaseOrders.status, committedStatuses)));

    const committedByCostCode: Record<string, number> = {};
    poItems.forEach(item => {
      const cc = item.costCode || "UNASSIGNED";
      committedByCostCode[cc] = (committedByCostCode[cc] || 0) + parseFloat(item.totalPrice || "0");
    });

    res.json({ purchaseOrders: pos, committedByCostCode });
  } catch (error) {
    logError("Get billing PO costs error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const importTmTicketsSchema = z.object({
  sovId: z.string().min(1),
  ticketIds: z.array(z.string().min(1)).min(1),
  groupByCostCode: z.boolean().optional().default(false),
});

router.post("/billing-integration/import-tm-tickets", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = importTmTicketsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const { sovId, ticketIds, groupByCostCode } = parsed.data;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);
    if (!sov || !hasAccess) return res.status(404).json({ error: "SOV not found" });

    const tickets = await db.select().from(tmTickets)
      .where(and(inArray(tmTickets.id, ticketIds), eq(tmTickets.projectId, sov.projectId), eq(tmTickets.status, "APPROVED")));

    if (tickets.length === 0) return res.status(400).json({ error: "No valid approved T&M tickets found for this project" });

    const existingItems = await db.select({ maxLine: sql<number>`COALESCE(MAX(line_number), 0)` })
      .from(sovLineItems).where(eq(sovLineItems.sovId, sovId));
    let nextLine = (existingItems[0]?.maxLine || 0) + 1;

    const newItems: typeof sovLineItems.$inferInsert[] = [];

    if (groupByCostCode) {
      const grouped: Record<string, { total: number; ticketNumbers: string[] }> = {};
      tickets.forEach(t => {
        const cc = t.costCode || "T&M";
        if (!grouped[cc]) grouped[cc] = { total: 0, ticketNumbers: [] };
        grouped[cc].total += parseFloat(t.grandTotal || "0");
        grouped[cc].ticketNumbers.push(t.ticketNumber || "?");
      });

      for (const [costCode, data] of Object.entries(grouped)) {
        newItems.push({
          sovId,
          lineNumber: nextLine++,
          itemCode: `TM-${costCode}`,
          description: `T&M ${costCode} (Tickets: ${data.ticketNumbers.join(", ")})`.substring(0, 255),
          scheduledValue: String(data.total),
          previouslyCompleted: "0",
          thisPeriodCompleted: String(data.total),
          materialsStored: "0",
          totalCompletedAndStored: String(data.total),
          percentComplete: "100",
          balanceToFinish: "0",
          retainageAmount: "0",
        });
      }
    } else {
      for (const t of tickets) {
        const amount = parseFloat(t.grandTotal || "0");
        newItems.push({
          sovId,
          lineNumber: nextLine++,
          itemCode: `TM-${t.ticketNumber}`,
          description: `T&M Ticket #${t.ticketNumber}${t.costCode ? ` (${t.costCode})` : ""}`.substring(0, 255),
          scheduledValue: String(amount),
          previouslyCompleted: "0",
          thisPeriodCompleted: String(amount),
          materialsStored: "0",
          totalCompletedAndStored: String(amount),
          percentComplete: "100",
          balanceToFinish: "0",
          retainageAmount: "0",
        });
      }
    }

    if (newItems.length > 0) {
      await db.insert(sovLineItems).values(newItems);
    }

    const retainagePct = parseFloat(sov.retainagePercent || "10") / 100;
    const allLineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, sovId));
    const totals = calculateSOVTotals(allLineItems, retainagePct);
    await db.update(scheduleOfValues).set({ ...totals, updatedAt: new Date() }).where(eq(scheduleOfValues.id, sovId));

    res.status(201).json({ imported: newItems.length, message: `Imported ${newItems.length} T&M line item(s) into SOV` });
  } catch (error) {
    logError("Import T&M tickets error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// RETENTION RELEASES
// ========================================

router.get("/retention-releases", async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(retentionReleases.organizationId, orgId));
    if (req.query.projectId) conditions.push(eq(retentionReleases.projectId, req.query.projectId as string));

    const releases = await db.select({
      id: retentionReleases.id,
      projectId: retentionReleases.projectId,
      sovId: retentionReleases.sovId,
      releaseType: retentionReleases.releaseType,
      status: retentionReleases.status,
      amount: retentionReleases.amount,
      reason: retentionReleases.reason,
      approvedAt: retentionReleases.approvedAt,
      releasedAt: retentionReleases.releasedAt,
      createdAt: retentionReleases.createdAt,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(retentionReleases)
    .innerJoin(projects, eq(retentionReleases.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(retentionReleases.createdAt));

    res.json(releases);
  } catch (error) {
    logError("Get retention releases error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createRetentionReleaseSchema = z.object({
  projectId: z.string().min(1),
  sovId: z.string().optional(),
  releaseType: z.enum(["PARTIAL", "FINAL"]),
  amount: z.string().or(z.number()).transform(v => String(v)),
  reason: z.string().optional(),
});

router.post("/retention-releases", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = createRetentionReleaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const data = parsed.data;
    const { project, hasAccess } = await verifyProjectAccess(data.projectId, orgId, shouldFilter);
    if (!project || !hasAccess) return res.status(404).json({ error: "Project not found" });

    if (data.releaseType === "FINAL") {
      if (project.status !== "COMPLETE" && project.status !== "CLOSED") {
        return res.status(400).json({ error: "Final retention release requires project to be marked as Complete or Closed" });
      }

      const unpaidPayApps = await db.select({ id: payApplications.id })
        .from(payApplications)
        .where(and(
          eq(payApplications.projectId, data.projectId),
          sql`${payApplications.status} NOT IN ('PAID', 'ARCHIVED')`
        ))
        .limit(1);
      if (unpaidPayApps.length > 0) {
        return res.status(400).json({ error: "Final retention release requires all pay applications to be paid or archived" });
      }
    }

    const useOrgId = orgId || project.gcOrganizationId;
    if (!useOrgId) return res.status(400).json({ error: "Organization context required" });

    const [release] = await db.insert(retentionReleases).values({
      organizationId: useOrgId,
      projectId: data.projectId,
      sovId: data.sovId || null,
      releaseType: data.releaseType,
      amount: data.amount,
      reason: data.reason || null,
      requestedById: req.user?.id,
    }).returning();

    res.status(201).json(release);
  } catch (error) {
    logError("Create retention release error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateRetentionReleaseStatusSchema = z.object({
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "RELEASED"]),
});

const validReleaseStatusTransitions: Record<string, string[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["RELEASED", "REJECTED"],
  REJECTED: ["REQUESTED"],
  RELEASED: [],
};

router.patch("/retention-releases/:id/status", requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateRetentionReleaseStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid status", details: parsed.error.flatten() });
    const { status } = parsed.data;

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [release] = await db.select().from(retentionReleases).where(eq(retentionReleases.id, id)).limit(1);
    if (!release) return res.status(404).json({ error: "Not found" });
    if (shouldFilter && orgId && release.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    const allowedNext = validReleaseStatusTransitions[release.status] || [];
    if (!allowedNext.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${release.status} to ${status}` });
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "APPROVED") { updates.approvedAt = new Date(); updates.approvedById = req.user?.id; }
    if (status === "RELEASED") updates.releasedAt = new Date();

    const [updated] = await db.update(retentionReleases).set(updates).where(eq(retentionReleases.id, id)).returning();
    res.json(updated);
  } catch (error) {
    logError("Update retention release error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// BILLING HUB SUMMARY
// ========================================

router.get("/billing-hub/summary", async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json({
      projects: [], recentPayApps: [],
      aging: { total: 0, current: 0, over30: 0, over60: 0, over90: 0 },
      retention: { totalHeld: 0, totalReleased: 0, remaining: 0 },
    });

    const sovConditions: SQL[] = [];
    if (shouldFilter && orgId) sovConditions.push(eq(scheduleOfValues.organizationId, orgId));

    const allSOVs = await db.select({
      id: scheduleOfValues.id,
      projectId: scheduleOfValues.projectId,
      sovNumber: scheduleOfValues.sovNumber,
      title: scheduleOfValues.title,
      status: scheduleOfValues.status,
      contractValue: scheduleOfValues.contractValue,
      totalCompletedToDate: scheduleOfValues.totalCompletedToDate,
      totalEarnedLessRetainage: scheduleOfValues.totalEarnedLessRetainage,
      totalRetainage: scheduleOfValues.totalRetainage,
      totalThisPeriod: scheduleOfValues.totalThisPeriod,
      submittedAt: scheduleOfValues.submittedAt,
      approvedAt: scheduleOfValues.approvedAt,
      paidAt: scheduleOfValues.paidAt,
      periodNumber: scheduleOfValues.periodNumber,
      createdAt: scheduleOfValues.createdAt,
      projectName: projects.name,
      projectCode: projects.code,
      clientName: projects.clientName,
    })
    .from(scheduleOfValues)
    .innerJoin(projects, eq(scheduleOfValues.projectId, projects.id))
    .where(sovConditions.length > 0 ? and(...sovConditions) : undefined)
    .orderBy(desc(scheduleOfValues.createdAt))
    .limit(500);

    const paymentConditions: SQL[] = [];
    if (shouldFilter && orgId) paymentConditions.push(eq(sovPayments.organizationId, orgId));

    const allPayments = await db.select({
      sovId: sovPayments.sovId,
      amount: sovPayments.amount,
      paymentDate: sovPayments.paymentDate,
    })
    .from(sovPayments)
    .where(paymentConditions.length > 0 ? and(...paymentConditions) : undefined);

    const paymentsBySov: Record<string, number> = {};
    allPayments.forEach(p => {
      paymentsBySov[p.sovId] = (paymentsBySov[p.sovId] || 0) + parseFloat(p.amount || "0");
    });

    const now = new Date();
    let totalAR = 0, current = 0, over30 = 0, over60 = 0, over90 = 0;
    let totalRetentionHeld = 0;

    const latestSOVByProject: Record<string, typeof allSOVs[0]> = {};
    for (const sov of allSOVs) {
      const existing = latestSOVByProject[sov.projectId];
      if (!existing || sov.periodNumber > existing.periodNumber) {
        latestSOVByProject[sov.projectId] = sov;
      }
    }

    const projectMap: Record<string, {
      projectId: string;
      projectName: string;
      projectCode: string;
      clientName: string | null;
      contractValue: number;
      totalBilled: number;
      totalPaid: number;
      totalRetention: number;
      sovCount: number;
      latestStatus: string;
    }> = {};

    for (const sov of allSOVs) {
      if (!projectMap[sov.projectId]) {
        const latest = latestSOVByProject[sov.projectId];
        const latestEarned = parseFloat(latest?.totalEarnedLessRetainage || "0");
        const latestRetention = parseFloat(latest?.totalRetainage || "0");
        const latestPaid = paymentsBySov[latest?.id || ""] || 0;

        projectMap[sov.projectId] = {
          projectId: sov.projectId,
          projectName: sov.projectName,
          projectCode: sov.projectCode,
          clientName: sov.clientName,
          contractValue: parseFloat(latest?.contractValue || sov.contractValue || "0"),
          totalBilled: latestEarned,
          totalPaid: latestPaid,
          totalRetention: latestRetention,
          sovCount: 0,
          latestStatus: latest?.status || sov.status,
        };

        totalRetentionHeld += latestRetention;
      }
      projectMap[sov.projectId].sovCount++;
    }

    const allPayAppsForAging = await db.select({
      currentPaymentDue: payApplications.currentPaymentDue,
      paidAmount: payApplications.paidAmount,
      status: payApplications.status,
      submittedAt: payApplications.submittedAt,
      approvedAt: payApplications.approvedAt,
      createdAt: payApplications.createdAt,
    }).from(payApplications)
      .where(shouldFilter && orgId ? eq(payApplications.organizationId, orgId) : undefined);

    for (const pa of allPayAppsForAging) {
      if (!["SUBMITTED", "APPROVED", "UNDER_REVIEW"].includes(pa.status)) continue;
      const due = parseFloat(pa.currentPaymentDue || "0");
      const paid = parseFloat(pa.paidAmount || "0");
      const outstanding = due - paid;
      if (outstanding > 0.01) {
        const submittedDate = pa.submittedAt || pa.approvedAt || pa.createdAt;
        const daysSince = Math.floor((now.getTime() - new Date(submittedDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince > 90) over90 += outstanding;
        else if (daysSince > 60) over60 += outstanding;
        else if (daysSince > 30) over30 += outstanding;
        else current += outstanding;
        totalAR += outstanding;
      }
    }

    const retConditions: SQL[] = [];
    if (shouldFilter && orgId) retConditions.push(eq(retentionReleases.organizationId, orgId));
    const allReleases = await db.select({
      amount: retentionReleases.amount,
      status: retentionReleases.status,
    }).from(retentionReleases)
      .where(retConditions.length > 0 ? and(...retConditions) : undefined);

    const totalReleased = allReleases
      .filter(r => r.status === "RELEASED")
      .reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0);

    const payAppConditions: ReturnType<typeof eq>[] = [];
    if (shouldFilter && orgId) payAppConditions.push(eq(payApplications.organizationId, orgId));
    const recentApps = await db.select({
      id: payApplications.id,
      applicationNumber: payApplications.applicationNumber,
      periodTo: payApplications.periodTo,
      currentPaymentDue: payApplications.currentPaymentDue,
      status: payApplications.status,
      submittedAt: payApplications.submittedAt,
      createdAt: payApplications.createdAt,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(payApplications)
    .innerJoin(projects, eq(payApplications.projectId, projects.id))
    .where(payAppConditions.length > 0 ? and(...payAppConditions) : undefined)
    .orderBy(desc(payApplications.createdAt))
    .limit(10);

    res.json({
      projects: Object.values(projectMap),
      recentPayApps: recentApps,
      aging: {
        total: Math.round(totalAR * 100) / 100,
        current: Math.round(current * 100) / 100,
        over30: Math.round(over30 * 100) / 100,
        over60: Math.round(over60 * 100) / 100,
        over90: Math.round(over90 * 100) / 100,
      },
      retention: {
        totalHeld: Math.round(totalRetentionHeld * 100) / 100,
        totalReleased: Math.round(totalReleased * 100) / 100,
        remaining: Math.round((totalRetentionHeld - totalReleased) * 100) / 100,
      },
    });
  } catch (error) {
    logError("Billing hub summary error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export async function syncApprovedCOToSOV(changeOrderId: string) {
  try {
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, changeOrderId)).limit(1);
    if (!co || co.status !== "APPROVED") return;

    const activeSovs = await db.select().from(scheduleOfValues)
      .where(and(
        eq(scheduleOfValues.projectId, co.projectId),
        inArray(scheduleOfValues.status, ["DRAFT", "PENDING", "UNDER_REVIEW"])
      ))
      .orderBy(desc(scheduleOfValues.periodNumber))
      .limit(1);

    if (activeSovs.length === 0) return;
    const sov = activeSovs[0];
    const coAmount = parseFloat(co.amount || "0");

    const existingLinks = await db.select().from(sovLineItems)
      .where(and(eq(sovLineItems.sovId, sov.id), eq(sovLineItems.linkedChangeOrderId, changeOrderId)))
      .limit(1);

    if (existingLinks.length > 0) {
      const existing = existingLinks[0];
      const prevScheduled = parseFloat(existing.scheduledValue || "0");
      if (Math.abs(prevScheduled - coAmount) > 0.005 || existing.description !== `Change Order: ${co.description || ""}`.substring(0, 255)) {
        const thisPeriod = parseFloat(existing.thisPeriodCompleted || "0");
        const prev = parseFloat(existing.previouslyCompleted || "0");
        const stored = parseFloat(existing.materialsStored || "0");
        const total = prev + thisPeriod + stored;
        const pct = coAmount > 0 ? Math.min(100, (total / coAmount) * 100) : 0;
        const balance = Math.max(0, coAmount - total);

        await db.update(sovLineItems).set({
          itemCode: `CO-${co.changeOrderNumber}`,
          description: `Change Order: ${co.description || ""}`.substring(0, 255),
          scheduledValue: String(coAmount),
          totalCompletedAndStored: String(total),
          percentComplete: String(pct.toFixed(2)),
          balanceToFinish: String(balance),
          updatedAt: new Date(),
        }).where(eq(sovLineItems.id, existing.id));
      }
    } else {
      const existingItems = await db.select({ maxLine: sql<number>`COALESCE(MAX(line_number), 0)` })
        .from(sovLineItems).where(eq(sovLineItems.sovId, sov.id));
      const nextLine = (existingItems[0]?.maxLine || 0) + 1;

      await db.insert(sovLineItems).values({
        sovId: sov.id,
        lineNumber: nextLine,
        itemCode: `CO-${co.changeOrderNumber}`,
        description: `Change Order: ${co.description || ""}`.substring(0, 255),
        scheduledValue: String(coAmount),
        previouslyCompleted: "0",
        thisPeriodCompleted: "0",
        materialsStored: "0",
        totalCompletedAndStored: "0",
        percentComplete: "0",
        balanceToFinish: String(coAmount),
        retainageAmount: "0",
        linkedChangeOrderId: changeOrderId,
      });
    }

    const retainagePct = parseFloat(sov.retainagePercent || "10") / 100;
    const allLineItems = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, sov.id));
    const totals = calculateSOVTotals(allLineItems, retainagePct);
    await db.update(scheduleOfValues).set({ ...totals, updatedAt: new Date() }).where(eq(scheduleOfValues.id, sov.id));
  } catch (error) {
    logError("Auto-sync CO to SOV error:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

export default router;
