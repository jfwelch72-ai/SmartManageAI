import { Router, Response, Request } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  subcontractorPayments,
  subcontractorContracts, 
  subcontractors,
  crmOrganisations,
  projects,
  users,
  notifications
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, requireRoleOrFeature, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { eventBus } from "./events";
import { logAudit, logCreate, logUpdate, logDelete } from "./auditLogger";
import { notifySubmitter } from "./services/approvalNotificationService";
import { insertNotifications } from "./services/notificationService";

const router = Router();

async function verifyPaymentAccess(paymentId: string, orgId: string | null, shouldFilter: boolean, isSuperAdmin: boolean = false): Promise<{ payment: any | null; hasAccess: boolean }> {
  const [payment] = await db
    .select()
    .from(subcontractorPayments)
    .where(eq(subcontractorPayments.id, paymentId))
    .limit(1);

  if (!payment) {
    return { payment: null, hasAccess: false };
  }

  if (isSuperAdmin) {
    return { payment, hasAccess: true };
  }

  if (shouldFilter && orgId && payment.organizationId !== orgId) {
    return { payment, hasAccess: false };
  }

  return { payment, hasAccess: true };
}

async function getNextPaymentNumber(contractId: string): Promise<number> {
  const [result] = await db
    .select({ max: sql<number>`COALESCE(MAX(${subcontractorPayments.paymentNumber}), 0)`.as("max") })
    .from(subcontractorPayments)
    .where(eq(subcontractorPayments.contractId, contractId));
  
  return (result?.max || 0) + 1;
}

async function sendPayableNotifications(
  paymentId: string,
  organizationId: string,
  projectId: string,
  action: string,
  amount: string,
  subcontractorName: string,
  triggeredByUserId: string
): Promise<void> {
  try {
    const typeMap: Record<string, string> = {
      CREATED: "PAYABLE_SUBMITTED",
      APPROVED: "PAYABLE_APPROVED",
      REJECTED: "PAYABLE_REJECTED",
    };
    const notificationType = typeMap[action] || "GENERAL";
    const formattedAmount = `$${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const eligibleUsers = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.isActive, true),
          inArray(users.role, ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"])
        )
      );

    const notificationRecords = eligibleUsers
      .filter(u => u.id !== triggeredByUserId)
      .map(user => ({
        userId: user.id,
        type: notificationType as any,
        title: `Subcontractor Payable ${action === "CREATED" ? "Submitted" : action.charAt(0) + action.slice(1).toLowerCase()}`,
        message: `A ${action === "CREATED" ? "new" : action.toLowerCase()} payable for ${subcontractorName} - ${formattedAmount}`,
        isRead: false,
        relatedEntityType: "PAYABLE",
        relatedEntityId: paymentId,
        metadata: JSON.stringify({
          projectId,
          action,
          amount,
          subcontractorName
        })
      }));

    if (notificationRecords.length > 0) {
      await insertNotifications(notificationRecords);
    }
  } catch (error) {
    console.error("Error sending payable notifications:", error);
  }
}

router.get("/payables", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { status, projectId, subcontractorId } = req.query;

    let conditions = [];

    if (shouldFilter && orgId) {
      conditions.push(eq(subcontractorPayments.organizationId, orgId));
    }

    if (status && typeof status === "string") {
      conditions.push(eq(subcontractorPayments.status, status));
    }

    const payablesQuery = await db
      .select({
        payment: subcontractorPayments,
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects,
        createdBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email
        }
      })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .leftJoin(users, eq(subcontractorPayments.createdById, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(subcontractorPayments.createdAt));

    let filteredPayables = payablesQuery;

    if (projectId && typeof projectId === "string") {
      filteredPayables = filteredPayables.filter(p => p.project.id === projectId);
    }

    if (subcontractorId && typeof subcontractorId === "string") {
      filteredPayables = filteredPayables.filter(p => p.subcontractor.id === subcontractorId);
    }

    const result = filteredPayables.map(p => ({
      ...p.payment,
      contract: {
        id: p.contract.id,
        contractNumber: p.contract.contractNumber,
        scopeOfWork: p.contract.scopeOfWork,
        contractAmount: p.contract.contractAmount
      },
      subcontractor: {
        id: p.subcontractor.id,
        companyName: p.subcontractor.companyName,
        contactName: p.subcontractor.contactName,
        email: p.subcontractor.email,
        phone: p.subcontractor.phone
      },
      project: {
        id: p.project.id,
        name: p.project.name,
        code: p.project.code
      },
      createdBy: p.createdBy
    }));

    res.json(result);
  } catch (error) {
    console.error("Get payables error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/payables/summary", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    let conditions = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(subcontractorPayments.organizationId, orgId));
    }

    const allPayments = await db
      .select({
        status: subcontractorPayments.status,
        amount: subcontractorPayments.amount
      })
      .from(subcontractorPayments)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const summary = {
      pending: { count: 0, total: 0 },
      approved: { count: 0, total: 0 },
      paid: { count: 0, total: 0 },
      rejected: { count: 0, total: 0 },
      totalPayables: allPayments.length
    };

    allPayments.forEach(p => {
      const amount = parseFloat(p.amount || "0");
      const status = p.status.toLowerCase() as keyof typeof summary;
      if (status in summary && typeof summary[status] === "object") {
        (summary[status] as { count: number; total: number }).count++;
        (summary[status] as { count: number; total: number }).total += amount;
      }
    });

    res.json(summary);
  } catch (error) {
    console.error("Get payables summary error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/payables/:id", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER", "OFFICE_MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    const { payment, hasAccess } = await verifyPaymentAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!payment || !hasAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    const [fullPayment] = await db
      .select({
        payment: subcontractorPayments,
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects
      })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .where(eq(subcontractorPayments.id, id))
      .limit(1);

    if (!fullPayment) {
      return res.status(404).json({ error: "Payable not found" });
    }

    res.json({
      ...fullPayment.payment,
      contract: fullPayment.contract,
      subcontractor: fullPayment.subcontractor,
      project: {
        id: fullPayment.project.id,
        name: fullPayment.project.name,
        code: fullPayment.project.code
      }
    });
  } catch (error) {
    console.error("Get payable error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const createPayableSchema = z.object({
  contractId: z.string().min(1),
  amount: z.string().or(z.number()),
  retentionHeld: z.string().or(z.number()).optional().nullable(),
  description: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable()
});

router.post("/payables", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = createPayableSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const data = validationResult.data;

    const [contract] = await db
      .select({
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects
      })
      .from(subcontractorContracts)
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .where(eq(subcontractorContracts.id, data.contractId))
      .limit(1);

    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    if (shouldFilter && orgId && contract.project.gcOrganizationId !== orgId) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const targetOrgId = contract.project.gcOrganizationId;
    if (!targetOrgId && !isSuperAdmin) {
      return res.status(400).json({ error: "Contract project has no organization" });
    }

    const paymentNumber = await getNextPaymentNumber(data.contractId);

    const [newPayment] = await db
      .insert(subcontractorPayments)
      .values({
        organizationId: targetOrgId!,
        contractId: data.contractId,
        paymentNumber,
        amount: String(data.amount),
        retentionHeld: data.retentionHeld ? String(data.retentionHeld) : null,
        description: data.description,
        invoiceNumber: data.invoiceNumber,
        status: "PENDING",
        autoCreated: false,
        createdById: req.user!.id
      })
      .returning();

    await logCreate(
      req.user!.id,
      "subcontractor_payments",
      newPayment.id,
      newPayment,
      req as Request
    );

    await sendPayableNotifications(
      newPayment.id,
      targetOrgId!,
      contract.project.id,
      "CREATED",
      String(data.amount),
      contract.subcontractor.companyName,
      req.user!.id
    );

    import("./costLedgerRoutes").then(m => m.evaluateBudgetAlerts(contract.project.id)).catch(e => console.error("Budget alert eval after sub payment:", e));

    res.status(201).json({
      ...newPayment,
      contract: {
        id: contract.contract.id,
        contractNumber: contract.contract.contractNumber,
        scopeOfWork: contract.contract.scopeOfWork
      },
      subcontractor: {
        id: contract.subcontractor.id,
        companyName: contract.subcontractor.companyName
      },
      project: {
        id: contract.project.id,
        name: contract.project.name,
        code: contract.project.code
      }
    });
  } catch (error) {
    console.error("Create payable error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payables/:id/approve", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    const { payment, hasAccess } = await verifyPaymentAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!payment || !hasAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    if (payment.status !== "PENDING") {
      return res.status(400).json({ error: `Cannot approve payable in ${payment.status} status` });
    }

    const oldPayment = { ...payment };

    const [updatedPayment] = await db
      .update(subcontractorPayments)
      .set({
        status: "APPROVED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(subcontractorPayments.id, id))
      .returning();

    const [fullPayment] = await db
      .select({
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects
      })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .where(eq(subcontractorPayments.id, id))
      .limit(1);

    await logUpdate(
      req.user!.id,
      "subcontractor_payments",
      id,
      oldPayment,
      updatedPayment,
      req as Request
    );

    await sendPayableNotifications(
      id,
      payment.organizationId,
      fullPayment.project.id,
      "APPROVED",
      payment.amount,
      fullPayment.subcontractor.companyName,
      req.user!.id
    );

    if (payment.createdById && payment.createdById !== req.user!.id) {
      await notifySubmitter(payment.createdById, {
        type: "PAYABLE_APPROVED",
        title: "Subcontractor Payable Approved",
        message: `Subcontractor payable for ${fullPayment.subcontractor.companyName} - $${parseFloat(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} has been approved`,
        relatedEntityId: id,
        relatedEntityType: "PAYABLE",
      });
    }

    res.json({
      ...updatedPayment,
      contract: {
        id: fullPayment.contract.id,
        contractNumber: fullPayment.contract.contractNumber
      },
      subcontractor: {
        id: fullPayment.subcontractor.id,
        companyName: fullPayment.subcontractor.companyName
      },
      project: {
        id: fullPayment.project.id,
        name: fullPayment.project.name
      }
    });
  } catch (error) {
    console.error("Approve payable error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const rejectPayableSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required")
});

router.post("/payables/:id/reject", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    const validationResult = rejectPayableSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { rejectionReason } = validationResult.data;

    const { payment, hasAccess } = await verifyPaymentAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!payment || !hasAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    if (payment.status !== "PENDING") {
      return res.status(400).json({ error: `Cannot reject payable in ${payment.status} status` });
    }

    const oldPayment = { ...payment };

    const [updatedPayment] = await db
      .update(subcontractorPayments)
      .set({
        status: "REJECTED",
        rejectedById: req.user!.id,
        rejectedAt: new Date(),
        rejectionReason,
        updatedAt: new Date()
      })
      .where(eq(subcontractorPayments.id, id))
      .returning();

    const [fullPayment] = await db
      .select({
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects
      })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .where(eq(subcontractorPayments.id, id))
      .limit(1);

    await logUpdate(
      req.user!.id,
      "subcontractor_payments",
      id,
      oldPayment,
      updatedPayment,
      req as Request
    );

    await sendPayableNotifications(
      id,
      payment.organizationId,
      fullPayment.project.id,
      "REJECTED",
      payment.amount,
      fullPayment.subcontractor.companyName,
      req.user!.id
    );

    if (payment.createdById && payment.createdById !== req.user!.id) {
      await notifySubmitter(payment.createdById, {
        type: "PAYABLE_REJECTED",
        title: "Subcontractor Payable Rejected",
        message: `Subcontractor payable for ${fullPayment.subcontractor.companyName} - $${parseFloat(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} has been rejected: ${rejectionReason}`,
        relatedEntityId: id,
        relatedEntityType: "PAYABLE",
      });
    }

    res.json({
      ...updatedPayment,
      contract: {
        id: fullPayment.contract.id,
        contractNumber: fullPayment.contract.contractNumber
      },
      subcontractor: {
        id: fullPayment.subcontractor.id,
        companyName: fullPayment.subcontractor.companyName
      },
      project: {
        id: fullPayment.project.id,
        name: fullPayment.project.name
      }
    });
  } catch (error) {
    console.error("Reject payable error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const markPaidSchema = z.object({
  paymentDate: z.string().min(1, "Payment date is required"),
  checkNumber: z.string().optional().nullable(),
  paymentMethod: z.enum(["CHECK", "ACH", "WIRE", "CREDIT_CARD", "CASH"]).optional().nullable()
});

router.post("/payables/:id/mark-paid", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    const validationResult = markPaidSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { paymentDate, checkNumber, paymentMethod } = validationResult.data;

    const { payment, hasAccess } = await verifyPaymentAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!payment || !hasAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    if (payment.status !== "APPROVED") {
      return res.status(400).json({ error: `Cannot mark as paid - payable must be in APPROVED status (currently ${payment.status})` });
    }

    const oldPayment = { ...payment };

    const [updatedPayment] = await db
      .update(subcontractorPayments)
      .set({
        status: "PAID",
        paidById: req.user!.id,
        paidAt: new Date(),
        paymentDate: new Date(paymentDate),
        checkNumber,
        paymentMethod,
        updatedAt: new Date()
      })
      .where(eq(subcontractorPayments.id, id))
      .returning();

    const [fullPayment] = await db
      .select({
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects
      })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .where(eq(subcontractorPayments.id, id))
      .limit(1);

    await logUpdate(
      req.user!.id,
      "subcontractor_payments",
      id,
      oldPayment,
      updatedPayment,
      req as Request
    );

    await sendPayableNotifications(
      id,
      payment.organizationId,
      fullPayment.project.id,
      "PAID",
      payment.amount,
      fullPayment.subcontractor.companyName,
      req.user!.id
    );

    try {
      await eventBus.emit({
        version: 1,
        orgId: payment.organizationId || "",
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "subcontractor.payment_made" as const,
        payload: {
          paymentId: id,
          contractId: payment.contractId,
          projectId: fullPayment.project.id,
          costCode: fullPayment.contract.costCode || null,
          amount: parseFloat(payment.amount?.toString() || "0"),
        },
      });
    } catch (emitErr) {
      console.error("Failed to emit subcontractor.payment_made event:", emitErr);
    }

    res.json({
      ...updatedPayment,
      contract: {
        id: fullPayment.contract.id,
        contractNumber: fullPayment.contract.contractNumber
      },
      subcontractor: {
        id: fullPayment.subcontractor.id,
        companyName: fullPayment.subcontractor.companyName
      },
      project: {
        id: fullPayment.project.id,
        name: fullPayment.project.name
      }
    });
  } catch (error) {
    console.error("Mark paid error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/payables/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    const { payment, hasAccess } = await verifyPaymentAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!payment || !hasAccess) {
      return res.status(404).json({ error: "Payable not found" });
    }

    if (payment.status === "PAID") {
      return res.status(400).json({ error: "Cannot delete a paid payable" });
    }

    await db
      .delete(subcontractorPayments)
      .where(eq(subcontractorPayments.id, id));

    await logDelete(
      req.user!.id,
      "subcontractor_payments",
      id,
      payment,
      req as Request
    );

    res.json({ message: "Payable deleted successfully" });
  } catch (error) {
    console.error("Delete payable error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export async function createAutoPayableFromContract(
  contractId: string,
  organizationId: string,
  triggeredByUserId: string
): Promise<{ success: boolean; paymentId?: string; error?: string }> {
  try {
    const [contract] = await db
      .select({
        contract: subcontractorContracts,
        subcontractor: subcontractors,
        project: projects
      })
      .from(subcontractorContracts)
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .where(eq(subcontractorContracts.id, contractId))
      .limit(1);

    if (!contract) {
      return { success: false, error: "Contract not found" };
    }

    const existingPayables = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subcontractorPayments)
      .where(
        and(
          eq(subcontractorPayments.contractId, contractId),
          eq(subcontractorPayments.autoCreated, true)
        )
      );

    if (existingPayables[0].count > 0) {
      return { success: false, error: "Auto-created payable already exists for this contract" };
    }

    const paymentNumber = await getNextPaymentNumber(contractId);

    const amount = contract.contract.contractAmount || "0";
    const retentionPercent = parseFloat(contract.contract.retentionPercent || "0");
    const retentionHeld = (parseFloat(amount) * retentionPercent / 100).toFixed(2);

    const [newPayment] = await db
      .insert(subcontractorPayments)
      .values({
        organizationId,
        contractId,
        paymentNumber,
        amount,
        retentionHeld,
        description: `Final payment for contract ${contract.contract.contractNumber} - Scope: ${contract.contract.scopeOfWork}`,
        status: "PENDING",
        autoCreated: true,
        createdById: triggeredByUserId
      })
      .returning();

    await logAudit({
      userId: triggeredByUserId,
      action: "CREATE",
      entityType: "subcontractor_payments",
      entityId: newPayment.id,
      oldValue: null,
      newValue: JSON.stringify({ ...newPayment, autoCreated: true, triggerReason: "Contract marked COMPLETED" })
    });

    await sendPayableNotifications(
      newPayment.id,
      organizationId,
      contract.project.id,
      "CREATED",
      amount,
      contract.subcontractor.companyName,
      triggeredByUserId
    );

    return { success: true, paymentId: newPayment.id };
  } catch (error) {
    console.error("Error creating auto payable:", error);
    return { success: false, error: "Failed to create auto payable" };
  }
}

// Backfill endpoint to create payables for completed contracts that are missing payments
router.post("/payables/backfill", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Security: Deny access if multi-tenant filtering requires it
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Non-super-admins must ALWAYS have an orgId to prevent cross-tenant operations
    // This is critical for backfill - we don't want ADMINs backfilling across all orgs
    if (!isSuperAdmin && !orgId) {
      return res.status(403).json({ error: "Organization context required for backfill" });
    }

    // Find all COMPLETED contracts that don't have any payments
    // organizationId comes from projects.gcOrganizationId (the GC organization for this project)
    // NOTE: subcontractorId references crmOrganisations (CRM entities), not the subcontractors table
    const completedContractsWithoutPayments = await db
      .select({
        contractId: subcontractorContracts.id,
        contractNumber: subcontractorContracts.contractNumber,
        organizationId: projects.gcOrganizationId,
        projectId: subcontractorContracts.projectId,
        subcontractorId: subcontractorContracts.subcontractorId,
        contractAmount: subcontractorContracts.contractAmount,
        subcontractorName: crmOrganisations.name,
        projectName: projects.name,
      })
      .from(subcontractorContracts)
      .innerJoin(crmOrganisations, eq(subcontractorContracts.subcontractorId, crmOrganisations.id))
      .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .leftJoin(subcontractorPayments, eq(subcontractorContracts.id, subcontractorPayments.contractId))
      .where(
        and(
          eq(subcontractorContracts.status, "COMPLETED"),
          sql`${subcontractorPayments.id} IS NULL`,
          // Always filter by org for non-super-admins (orgId guaranteed to exist from earlier check)
          !isSuperAdmin && orgId ? eq(projects.gcOrganizationId, orgId) : undefined
        )
      );

    if (completedContractsWithoutPayments.length === 0) {
      return res.json({ 
        message: "No completed contracts without payables found",
        created: 0,
        details: []
      });
    }

    const results: Array<{ contractNumber: string; payableId: string; amount: string; status: string }> = [];

    for (const contract of completedContractsWithoutPayments) {
      // Skip contracts without an organization ID
      if (!contract.organizationId) {
        console.log(`Backfill: Skipping contract ${contract.contractNumber} - no gcOrganizationId on project`);
        results.push({
          contractNumber: contract.contractNumber,
          payableId: "",
          amount: contract.contractAmount || "0",
          status: "skipped_no_org"
        });
        continue;
      }

      try {
        const paymentNumber = await getNextPaymentNumber(contract.contractId);
        const amount = contract.contractAmount || "0";
        const organizationId = contract.organizationId;

        const [newPayment] = await db
          .insert(subcontractorPayments)
          .values({
            contractId: contract.contractId,
            organizationId,
            paymentNumber,
            amount,
            status: "PENDING",
            invoiceDate: new Date().toISOString().split('T')[0],
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
            description: `Final payment for completed contract ${contract.contractNumber}`,
            notes: `Auto-created by backfill process for completed contract`,
            autoCreated: true,
            createdById: userId
          })
          .returning();

        await logAudit({
          userId,
          action: "CREATE",
          entityType: "subcontractor_payments",
          entityId: newPayment.id,
          oldValue: null,
          newValue: JSON.stringify({ ...newPayment, backfillCreated: true, triggerReason: "Backfill for completed contract" })
        });

        await sendPayableNotifications(
          newPayment.id,
          organizationId,
          contract.projectId,
          "CREATED",
          amount,
          contract.subcontractorName,
          userId
        );

        results.push({
          contractNumber: contract.contractNumber,
          payableId: newPayment.id,
          amount,
          status: "created"
        });

        console.log(`Backfill: Created payable ${newPayment.id} for contract ${contract.contractNumber}`);
      } catch (err) {
        console.error(`Backfill: Failed to create payable for contract ${contract.contractNumber}:`, err);
        results.push({
          contractNumber: contract.contractNumber,
          payableId: "",
          amount: contract.contractAmount || "0",
          status: "failed"
        });
      }
    }

    const successCount = results.filter(r => r.status === "created").length;
    const failCount = results.filter(r => r.status === "failed").length;

    res.json({
      message: `Backfill complete: ${successCount} payables created, ${failCount} failed`,
      created: successCount,
      failed: failCount,
      details: results
    });
  } catch (error) {
    console.error("Error running payables backfill:", error);
    res.status(500).json({ error: "Failed to run payables backfill" });
  }
});

export default router;
