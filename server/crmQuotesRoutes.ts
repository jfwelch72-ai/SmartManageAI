import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { crmQuotes, crmQuoteLineItems, insertCrmQuoteSchema, insertCrmQuoteLineItemSchema, crmOpportunities } from "@shared/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { validateOrgRefs } from "./utils/orgRefValidator";
import { generateQuotePdf } from "./quote-pdf-service";
import crypto from "crypto";
import { crmQuoteAcceptanceTokens, crmQuoteTemplates, crmQuoteTemplateItems } from "@shared/schema";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;

async function nextQuoteNumber(orgId: string): Promise<string> {
  const yearPrefix = `Q${new Date().getFullYear()}-`;
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM crm_quotes WHERE organization_id = ${orgId} AND quote_number LIKE ${yearPrefix + "%"}
  `);
  const count = (result.rows[0] as { count: number }).count + 1;
  return `${yearPrefix}${String(count).padStart(4, "0")}`;
}

function recalcTotals(items: { quantity: number | string; unitPrice: number | string }[], taxRate: number, discount: number) {
  const subtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxBase = Math.max(0, subtotal - discount);
  const taxAmount = +(taxBase * (taxRate / 100)).toFixed(2);
  const total = +(taxBase + taxAmount).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxAmount, total };
}

router.get("/api/crm/quotes", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const { opportunityId, status } = req.query as Record<string, string>;
    const conds = [eq(crmQuotes.organizationId, orgId)];
    if (opportunityId) conds.push(eq(crmQuotes.opportunityId, opportunityId));
    if (status) conds.push(eq(crmQuotes.status, status));

    const rows = await db.select().from(crmQuotes).where(and(...conds)).orderBy(desc(crmQuotes.createdAt));
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/quotes/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [quote] = await db.select().from(crmQuotes).where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.organizationId, orgId))).limit(1);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    const items = await db.select().from(crmQuoteLineItems).where(eq(crmQuoteLineItems.quoteId, quote.id)).orderBy(crmQuoteLineItems.sortOrder);
    res.json({ ...quote, lineItems: items });
  } catch (error) {
    next(error);
  }
});

const lineItemBody = insertCrmQuoteLineItemSchema.omit({ quoteId: true });
const quoteBody = insertCrmQuoteSchema.omit({ organizationId: true, createdById: true, quoteNumber: true, subtotal: true, taxAmount: true, totalAmount: true }).extend({
  taxRate: z.union([z.number(), z.string()]).optional(),
  discountAmount: z.union([z.number(), z.string()]).optional(),
  lineItems: z.array(lineItemBody).default([]),
});

router.post("/api/crm/quotes", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = quoteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const body = parsed.data;
    const refCheck = await validateOrgRefs(orgId, { opportunityId: body.opportunityId, crmOrganisationId: body.crmOrganisationId, contactId: body.contactId });
    if (!refCheck.ok) return res.status(400).json({ error: `Invalid ${refCheck.field} for this organization` });

    const taxRate = Number(body.taxRate ?? 0);
    const discount = Number(body.discountAmount ?? 0);
    const totals = recalcTotals(body.lineItems.map(l => ({ ...l, quantity: l.quantity ?? "0", unitPrice: l.unitPrice ?? "0" })), taxRate, discount);
    const quoteNumber = await nextQuoteNumber(orgId);

    const [quote] = await db.insert(crmQuotes).values({
      organizationId: orgId,
      opportunityId: body.opportunityId ?? null,
      crmOrganisationId: body.crmOrganisationId ?? null,
      contactId: body.contactId ?? null,
      quoteNumber,
      title: body.title,
      status: body.status ?? "DRAFT",
      validUntil: body.validUntil ?? null,
      subtotal: String(totals.subtotal),
      taxRate: String(taxRate),
      taxAmount: String(totals.taxAmount),
      discountAmount: String(discount),
      totalAmount: String(totals.total),
      notes: body.notes ?? null,
      terms: body.terms ?? null,
      createdById: req.user!.id,
    }).returning();

    if (body.lineItems.length) {
      await db.insert(crmQuoteLineItems).values(body.lineItems.map((it, idx) => ({
        quoteId: quote.id,
        sortOrder: it.sortOrder ?? idx,
        description: it.description,
        quantity: String(it.quantity ?? 1),
        unit: it.unit ?? null,
        unitPrice: String(it.unitPrice ?? 0),
        lineTotal: String(+(Number(it.quantity ?? 1) * Number(it.unitPrice ?? 0)).toFixed(2)),
      })));
    }

    res.status(201).json(quote);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/crm/quotes/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = quoteBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [existing] = await db.select().from(crmQuotes).where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Quote not found" });

    const body = parsed.data;
    const refCheck = await validateOrgRefs(orgId, { opportunityId: body.opportunityId, crmOrganisationId: body.crmOrganisationId, contactId: body.contactId });
    if (!refCheck.ok) return res.status(400).json({ error: `Invalid ${refCheck.field} for this organization` });
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["title", "status", "validUntil", "notes", "terms", "opportunityId", "crmOrganisationId", "contactId"] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }

    if (body.lineItems) {
      await db.delete(crmQuoteLineItems).where(eq(crmQuoteLineItems.quoteId, existing.id));
      if (body.lineItems.length) {
        await db.insert(crmQuoteLineItems).values(body.lineItems.map((it, idx) => ({
          quoteId: existing.id,
          sortOrder: it.sortOrder ?? idx,
          description: it.description,
          quantity: String(it.quantity ?? 1),
          unit: it.unit ?? null,
          unitPrice: String(it.unitPrice ?? 0),
          lineTotal: String(+(Number(it.quantity ?? 1) * Number(it.unitPrice ?? 0)).toFixed(2)),
        })));
      }
      const taxRate = Number(body.taxRate ?? existing.taxRate ?? 0);
      const discount = Number(body.discountAmount ?? existing.discountAmount ?? 0);
      const totals = recalcTotals(body.lineItems.map(l => ({ ...l, quantity: l.quantity ?? "0", unitPrice: l.unitPrice ?? "0" })), taxRate, discount);
      patch.subtotal = String(totals.subtotal);
      patch.taxRate = String(taxRate);
      patch.taxAmount = String(totals.taxAmount);
      patch.discountAmount = String(discount);
      patch.totalAmount = String(totals.total);
    } else if (body.taxRate != null || body.discountAmount != null) {
      const items = await db.select().from(crmQuoteLineItems).where(eq(crmQuoteLineItems.quoteId, existing.id));
      const taxRate = Number(body.taxRate ?? existing.taxRate ?? 0);
      const discount = Number(body.discountAmount ?? existing.discountAmount ?? 0);
      const totals = recalcTotals(items, taxRate, discount);
      patch.taxRate = String(taxRate);
      patch.discountAmount = String(discount);
      patch.subtotal = String(totals.subtotal);
      patch.taxAmount = String(totals.taxAmount);
      patch.totalAmount = String(totals.total);
    }

    if (body.status === "SENT" && existing.status !== "SENT") patch.sentAt = new Date();
    if (body.status === "ACCEPTED" && existing.status !== "ACCEPTED") patch.acceptedAt = new Date();

    const [updated] = await db.update(crmQuotes).set(patch).where(eq(crmQuotes.id, existing.id)).returning();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/crm/quotes/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const result = await db.delete(crmQuotes).where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.organizationId, orgId))).returning();
    if (!result.length) return res.status(404).json({ error: "Quote not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Apply a quote template — returns a hydrated draft (does NOT save)
router.get("/api/crm/quotes/from-template/:templateId", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [tmpl] = await db.select().from(crmQuoteTemplates).where(and(eq(crmQuoteTemplates.id, req.params.templateId), eq(crmQuoteTemplates.organizationId, orgId))).limit(1);
    if (!tmpl) return res.status(404).json({ error: "Template not found" });
    const items = await db.select().from(crmQuoteTemplateItems).where(eq(crmQuoteTemplateItems.templateId, tmpl.id)).orderBy(crmQuoteTemplateItems.sortOrder);
    res.json({
      title: tmpl.name,
      taxRate: tmpl.defaultTaxRate,
      notes: tmpl.defaultNotes,
      terms: tmpl.defaultTerms,
      lineItems: items.map((it, idx) => ({
        sortOrder: idx, description: it.description, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice,
      })),
    });
  } catch (e) { next(e); }
});

// Save an existing quote AS a template
router.post("/api/crm/quotes/:id/save-as-template", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const schema = z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [quote] = await db.select().from(crmQuotes).where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.organizationId, orgId))).limit(1);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    const items = await db.select().from(crmQuoteLineItems).where(eq(crmQuoteLineItems.quoteId, quote.id));
    const [tmpl] = await db.insert(crmQuoteTemplates).values({
      organizationId: orgId, name: parsed.data.name, description: parsed.data.description ?? null,
      defaultTerms: quote.terms, defaultNotes: quote.notes, defaultTaxRate: quote.taxRate,
    }).returning();
    if (items.length) {
      await db.insert(crmQuoteTemplateItems).values(items.map((it, idx) => ({
        templateId: tmpl.id, sortOrder: it.sortOrder ?? idx,
        description: it.description, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice,
      })));
    }
    res.status(201).json(tmpl);
  } catch (e) { next(e); }
});

// Generate signed acceptance link
router.post("/api/crm/quotes/:id/send-for-acceptance", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const schema = z.object({ expiresInDays: z.number().int().min(1).max(90).default(14) });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [quote] = await db.select().from(crmQuotes).where(and(eq(crmQuotes.id, req.params.id), eq(crmQuotes.organizationId, orgId))).limit(1);
    if (!quote) return res.status(404).json({ error: "Quote not found" });

    // Approval gating: large quotes require approval (>$25k by default)
    const approvalThreshold = Number(process.env.CRM_QUOTE_APPROVAL_THRESHOLD ?? "25000");
    const totalAmount = Number(quote.totalAmount ?? 0);
    if (totalAmount >= approvalThreshold && quote.approvalStatus !== "APPROVED") {
      if (quote.approvalStatus === "PENDING") {
        return res.status(409).json({ error: "Quote already pending approval", approvalId: quote.approvalId });
      }
      const { createApprovalRequest } = await import("./services/approvalService");
      const approval = await createApprovalRequest(orgId, "CRM_QUOTE" as any, quote.id, req.user!.id, `Quote ${quote.quoteNumber} (${totalAmount.toFixed(2)}) requires approval before sending.`);
      await db.update(crmQuotes).set({ approvalStatus: "PENDING", approvalId: approval.id, updatedAt: new Date() }).where(eq(crmQuotes.id, quote.id));
      return res.status(202).json({ ok: false, requiresApproval: true, approvalId: approval.id });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86400000);

    await db.insert(crmQuoteAcceptanceTokens).values({
      organizationId: orgId, quoteId: quote.id, tokenHash, expiresAt, createdById: req.user!.id,
    });
    await db.update(crmQuotes).set({ status: "SENT", sentAt: new Date(), updatedAt: new Date() }).where(eq(crmQuotes.id, quote.id));

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    res.status(201).json({
      ok: true,
      acceptUrl: `${baseUrl}/quotes/accept/${token}`,
      expiresAt,
    });
  } catch (e) { next(e); }
});

// List acceptance tokens for a quote (latest first)
router.get("/api/crm/quotes/:id/acceptance-tokens", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select({
      id: crmQuoteAcceptanceTokens.id,
      status: crmQuoteAcceptanceTokens.status,
      expiresAt: crmQuoteAcceptanceTokens.expiresAt,
      viewedAt: crmQuoteAcceptanceTokens.viewedAt,
      decidedAt: crmQuoteAcceptanceTokens.decidedAt,
      signedName: crmQuoteAcceptanceTokens.signedName,
      signedEmail: crmQuoteAcceptanceTokens.signedEmail,
      declineReason: crmQuoteAcceptanceTokens.declineReason,
      createdAt: crmQuoteAcceptanceTokens.createdAt,
    }).from(crmQuoteAcceptanceTokens)
      .where(and(eq(crmQuoteAcceptanceTokens.quoteId, req.params.id), eq(crmQuoteAcceptanceTokens.organizationId, orgId)))
      .orderBy(desc(crmQuoteAcceptanceTokens.createdAt));
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/api/crm/quotes/:id/pdf", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const buf = await generateQuotePdf(req.params.id, orgId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="quote-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (error: any) {
    if (error?.message === "Quote not found") return res.status(404).json({ error: "Quote not found" });
    if (error?.message === "Forbidden") return res.status(403).json({ error: "Forbidden" });
    next(error);
  }
});

export default router;
