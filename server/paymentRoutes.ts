import { logError } from "./utils/logger";
import { Router, Response } from "express";
import { db } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireRoleOrFeature, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { z } from "zod";
import {
  unifiedPayments,
  payApplications,
  auditLog,
  tmInvoices,
} from "@shared/schema";

const router = Router();

const VALID_INVOICE_TYPES = ["AIA_PAY_APP", "TM_INVOICE", "GENERAL"] as const;
type InvoiceType = typeof VALID_INVOICE_TYPES[number];

const VALID_PAYMENT_METHODS = ["CHECK", "ACH", "WIRE", "CREDIT_CARD", "OTHER"] as const;
type PaymentMethod = typeof VALID_PAYMENT_METHODS[number];

const VALID_PAYMENT_STATUSES = ["ACTIVE", "VOIDED"] as const;
type PaymentStatus = typeof VALID_PAYMENT_STATUSES[number];

function isValidInvoiceType(val: string): val is InvoiceType {
  return (VALID_INVOICE_TYPES as readonly string[]).includes(val);
}

function isValidPaymentStatus(val: string): val is PaymentStatus {
  return (VALID_PAYMENT_STATUSES as readonly string[]).includes(val);
}

const recordPaymentSchema = z.object({
  invoiceType: z.enum(VALID_INVOICE_TYPES),
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive("Payment amount must be positive"),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  paymentMethod: z.enum(VALID_PAYMENT_METHODS).optional().default("CHECK"),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  projectId: z.string().optional(),
});

const voidPaymentSchema = z.object({
  reason: z.string().min(1, "Void reason is required"),
});

interface InvoiceRow {
  invoice_id: string;
  invoice_type: string;
  organization_id: string;
  project_id: string | null;
  project_name: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  status: string;
}

interface InvoiceDetail {
  invoiceId: string;
  invoiceType: string;
  invoiceNumber: string;
  projectId: string | null;
  projectName: string | null;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  dueDate: string | null;
  daysOverdue: number;
  isOverdue: boolean;
  status: string;
}

router.post("/", requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const { invoiceType, invoiceId, amount, paymentDate, paymentMethod, referenceNumber, notes, projectId } = parsed.data;

    let resolvedOrgId = orgId || req.user?.organizationId || "";
    let resolvedProjectId = projectId || null;

    if (invoiceType === "AIA_PAY_APP") {
      const [app] = await db.select().from(payApplications).where(eq(payApplications.id, invoiceId)).limit(1);
      if (!app) return res.status(404).json({ error: "Pay application not found" });
      if (shouldFilter && orgId && app.organizationId !== orgId) return res.status(404).json({ error: "Not found" });
      resolvedOrgId = app.organizationId;
      resolvedProjectId = app.projectId;
    } else if (invoiceType === "TM_INVOICE") {
      const [invoice] = await db.select().from(tmInvoices).where(eq(tmInvoices.id, invoiceId)).limit(1);
      if (!invoice) return res.status(404).json({ error: "T&M invoice not found" });
      if (shouldFilter && orgId && invoice.organizationId !== orgId) return res.status(404).json({ error: "Not found" });
      resolvedOrgId = invoice.organizationId;
      resolvedProjectId = invoice.projectId;
    }

    const [payment] = await db.insert(unifiedPayments).values({
      organizationId: resolvedOrgId,
      invoiceType,
      invoiceId,
      projectId: resolvedProjectId,
      amount: amount.toFixed(2),
      paymentDate: paymentDate || new Date().toISOString().split("T")[0],
      paymentMethod: paymentMethod || "CHECK",
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      status: "ACTIVE",
      recordedById: req.user?.id,
    }).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "unified_payment",
      entityId: payment.id,
      newValue: JSON.stringify({ invoiceType, invoiceId, amount, paymentMethod }),
    });

    res.json(payment);
  } catch (error) {
    logError("Record unified payment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canViewFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { invoiceType, invoiceId, projectId, status } = req.query;

    const conditions = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(unifiedPayments.organizationId, orgId));
    }
    if (typeof invoiceType === "string" && isValidInvoiceType(invoiceType)) {
      conditions.push(eq(unifiedPayments.invoiceType, invoiceType));
    }
    if (typeof invoiceId === "string" && invoiceId.length > 0) {
      conditions.push(eq(unifiedPayments.invoiceId, invoiceId));
    }
    if (typeof projectId === "string" && projectId.length > 0) {
      conditions.push(eq(unifiedPayments.projectId, projectId));
    }
    if (typeof status === "string" && isValidPaymentStatus(status)) {
      conditions.push(eq(unifiedPayments.status, status));
    } else {
      conditions.push(eq(unifiedPayments.status, "ACTIVE"));
    }

    const payments = await db.select()
      .from(unifiedPayments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(unifiedPayments.paymentDate));

    res.json(payments);
  } catch (error) {
    logError("List unified payments error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/void", requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = voidPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const [payment] = await db.select().from(unifiedPayments).where(eq(unifiedPayments.id, id)).limit(1);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (shouldFilter && orgId && payment.organizationId !== orgId) return res.status(404).json({ error: "Not found" });

    if (payment.status === "VOIDED") {
      return res.status(400).json({ error: "Payment is already voided" });
    }

    const [updated] = await db.update(unifiedPayments).set({
      status: "VOIDED",
      voidedAt: new Date(),
      voidedById: req.user?.id,
      voidReason: parsed.data.reason,
      updatedAt: new Date(),
    }).where(eq(unifiedPayments.id, id)).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "unified_payment",
      entityId: id,
      newValue: JSON.stringify({ status: "VOIDED", reason: parsed.data.reason }),
    });

    res.json(updated);
  } catch (error) {
    logError("Void unified payment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ar-summary", requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canViewFinancials"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const orgFilter = shouldFilter && orgId ? sql`AND organization_id = ${orgId}` : sql``;

    const aiaInvoices = await db.execute(sql`
      SELECT 
        pa.id as invoice_id,
        'AIA_PAY_APP' as invoice_type,
        pa.organization_id,
        pa.project_id,
        p.name as project_name,
        CONCAT('Pay App #', pa.application_number) as invoice_number,
        pa.period_to as invoice_date,
        pa.period_to as due_date,
        COALESCE(pa.current_payment_due, '0')::numeric as total_amount,
        pa.status,
        pa.created_at
      FROM pay_applications pa
      LEFT JOIN projects p ON pa.project_id = p.id
      WHERE pa.status IN ('APPROVED', 'SUBMITTED')
      ${orgFilter}
    `);

    const tmOrgFilter = shouldFilter && orgId ? sql`AND ti.organization_id = ${orgId}` : sql``;
    const tmInvoiceRows = await db.execute(sql`
      SELECT 
        ti.id as invoice_id,
        'TM_INVOICE' as invoice_type,
        ti.organization_id,
        ti.project_id,
        p.name as project_name,
        ti.invoice_number,
        ti.invoice_date,
        ti.due_date,
        COALESCE(ti.total, '0')::numeric as total_amount,
        ti.status,
        ti.created_at
      FROM tm_invoices ti
      LEFT JOIN projects p ON ti.project_id = p.id
      WHERE ti.status = 'SENT'
      ${tmOrgFilter}
    `);

    const generalBillingOrgFilter = shouldFilter && orgId
      ? sql`AND si.project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`
      : sql``;
    const generalBillingEvents = await db.execute(sql`
      SELECT
        be.id as invoice_id,
        'GENERAL' as invoice_type,
        COALESCE(p.gc_organization_id, '') as organization_id,
        si.project_id as project_id,
        p.name as project_name,
        CONCAT('BE-', SUBSTRING(be.id, 1, 8)) as invoice_number,
        be.created_at::date::text as invoice_date,
        be.created_at::date::text as due_date,
        COALESCE(be.total_amount, '0')::numeric as total_amount,
        'BILLED' as status,
        be.created_at
      FROM billing_events be
      LEFT JOIN scope_items si ON be.scope_item_id = si.id
      LEFT JOIN projects p ON si.project_id = p.id
      WHERE be.total_amount::numeric > 0
      ${generalBillingOrgFilter}
    `);

    const paymentOrgFilter = shouldFilter && orgId ? sql`AND organization_id = ${orgId}` : sql``;
    const activePayments = await db.execute(sql`
      SELECT invoice_type, invoice_id, SUM(amount::numeric) as total_paid
      FROM unified_payments
      WHERE status = 'ACTIVE'
      ${paymentOrgFilter}
      GROUP BY invoice_type, invoice_id
    `);

    const paymentMap = new Map<string, number>();
    for (const row of activePayments.rows) {
      const key = `${row.invoice_type}:${row.invoice_id}`;
      paymentMap.set(key, Number(row.total_paid || 0));
    }

    const allInvoices: InvoiceRow[] = [
      ...aiaInvoices.rows,
      ...tmInvoiceRows.rows,
      ...generalBillingEvents.rows,
    ].map((row) => ({
      invoice_id: String(row.invoice_id || ""),
      invoice_type: String(row.invoice_type || ""),
      organization_id: String(row.organization_id || ""),
      project_id: row.project_id ? String(row.project_id) : null,
      project_name: row.project_name ? String(row.project_name) : null,
      invoice_number: String(row.invoice_number || ""),
      invoice_date: String(row.invoice_date || ""),
      due_date: row.due_date ? String(row.due_date) : null,
      total_amount: Number(row.total_amount || 0),
      status: String(row.status || ""),
    }));

    let totalOutstanding = 0;
    let totalOverdue = 0;
    const aging = { current: 0, thirtyDay: 0, sixtyDay: 0, ninetyDay: 0, ninetyPlus: 0 };
    const invoiceDetails: InvoiceDetail[] = [];

    for (const inv of allInvoices) {
      const key = `${inv.invoice_type}:${inv.invoice_id}`;
      const totalAmount = inv.total_amount;
      const paid = paymentMap.get(key) || 0;
      const outstanding = Math.max(0, totalAmount - paid);

      if (outstanding <= 0) continue;

      totalOutstanding += outstanding;

      const dueDate = inv.due_date || inv.invoice_date;
      let daysOverdue = 0;
      let isOverdue = false;

      if (dueDate) {
        const dueDateObj = new Date(dueDate);
        const diffMs = today.getTime() - dueDateObj.getTime();
        daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        isOverdue = daysOverdue > 0;
      }

      if (isOverdue) {
        totalOverdue += outstanding;
        if (daysOverdue <= 30) {
          aging.thirtyDay += outstanding;
        } else if (daysOverdue <= 60) {
          aging.sixtyDay += outstanding;
        } else if (daysOverdue <= 90) {
          aging.ninetyDay += outstanding;
        } else {
          aging.ninetyPlus += outstanding;
        }
      } else {
        aging.current += outstanding;
      }

      invoiceDetails.push({
        invoiceId: inv.invoice_id,
        invoiceType: inv.invoice_type,
        invoiceNumber: inv.invoice_number,
        projectId: inv.project_id,
        projectName: inv.project_name,
        totalAmount,
        paidAmount: paid,
        outstandingAmount: outstanding,
        dueDate,
        daysOverdue: isOverdue ? daysOverdue : 0,
        isOverdue,
        status: inv.status,
      });
    }

    const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString().split("T")[0];
    const totalPaymentsFilter = shouldFilter && orgId
      ? sql`WHERE organization_id = ${orgId} AND status = 'ACTIVE' AND payment_date >= ${startOfYear}`
      : sql`WHERE status = 'ACTIVE' AND payment_date >= ${startOfYear}`;
    const totalReceivedResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount::numeric), 0) as total
      FROM unified_payments
      ${totalPaymentsFilter}
    `);
    const totalReceivedYTD = Number(totalReceivedResult.rows[0]?.total || 0);

    const totalBilledAmount = allInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);
    const collectionRate = totalBilledAmount > 0 ? (totalReceivedYTD / totalBilledAmount) * 100 : 0;

    invoiceDetails.sort((a, b) => b.daysOverdue - a.daysOverdue);

    res.json({
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      totalReceivedYTD: Math.round(totalReceivedYTD * 100) / 100,
      collectionRate: Math.round(collectionRate * 10) / 10,
      aging: {
        current: Math.round(aging.current * 100) / 100,
        thirtyDay: Math.round(aging.thirtyDay * 100) / 100,
        sixtyDay: Math.round(aging.sixtyDay * 100) / 100,
        ninetyDay: Math.round(aging.ninetyDay * 100) / 100,
        ninetyPlus: Math.round(aging.ninetyPlus * 100) / 100,
      },
      invoices: invoiceDetails,
      invoiceCount: invoiceDetails.length,
      overdueCount: invoiceDetails.filter((i) => i.isOverdue).length,
    });
  } catch (error) {
    logError("AR summary error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
