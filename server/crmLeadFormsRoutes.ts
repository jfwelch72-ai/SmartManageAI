import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  crmLeadForms, insertCrmLeadFormSchema,
  crmLeadFormSubmissions,
  crmContacts, crmOpportunities, crmOrganisations,
  notifications,
} from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { runAutomationsForTrigger } from "./services/crmAutomationEngine";
import rateLimit from "express-rate-limit";

const publicLeadFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again later." },
});

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["TEXT", "EMAIL", "PHONE", "TEXTAREA", "SELECT", "CHECKBOX", "NUMBER", "DATE"]),
  required: z.boolean().optional().default(false),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

const formBody = insertCrmLeadFormSchema.omit({ organizationId: true, slug: true, createdById: true }).extend({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/i, "lowercase letters, numbers, hyphens").optional(),
  fields: z.array(fieldSchema).default([]),
});

router.get("/api/crm/lead-forms", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmLeadForms).where(eq(crmLeadForms.organizationId, orgId)).orderBy(desc(crmLeadForms.createdAt));
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/api/crm/lead-forms/:id", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [row] = await db.select().from(crmLeadForms).where(and(eq(crmLeadForms.id, req.params.id), eq(crmLeadForms.organizationId, orgId))).limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

router.post("/api/crm/lead-forms", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = formBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const slug = parsed.data.slug || `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
    const [created] = await db.insert(crmLeadForms).values({
      ...parsed.data,
      slug,
      organizationId: orgId,
      createdById: req.user!.id,
    } as any).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/lead-forms/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = formBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmLeadForms)
      .set({ ...(parsed.data as any), updatedAt: new Date() })
      .where(and(eq(crmLeadForms.id, req.params.id), eq(crmLeadForms.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/lead-forms/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    await db.delete(crmLeadForms).where(and(eq(crmLeadForms.id, req.params.id), eq(crmLeadForms.organizationId, orgId)));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get("/api/crm/lead-forms/:id/submissions", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmLeadFormSubmissions)
      .where(and(eq(crmLeadFormSubmissions.formId, req.params.id), eq(crmLeadFormSubmissions.organizationId, orgId)))
      .orderBy(desc(crmLeadFormSubmissions.createdAt))
      .limit(200);
    res.json(rows);
  } catch (e) { next(e); }
});

// PUBLIC endpoints (no auth)
router.get("/api/public/lead-forms/:slug", async (req, res, next) => {
  try {
    const [row] = await db.select().from(crmLeadForms).where(and(eq(crmLeadForms.slug, req.params.slug), eq(crmLeadForms.status, "PUBLISHED"))).limit(1);
    if (!row) return res.status(404).json({ error: "Form not found" });
    res.json({ id: row.id, name: row.name, slug: row.slug, fields: row.fields, successMessage: row.successMessage });
  } catch (e) { next(e); }
});

router.post("/api/public/lead-forms/:slug/submit", publicLeadFormLimiter, async (req, res, next) => {
  try {
    const [form] = await db.select().from(crmLeadForms).where(and(eq(crmLeadForms.slug, req.params.slug), eq(crmLeadForms.status, "PUBLISHED"))).limit(1);
    if (!form) return res.status(404).json({ error: "Form not found" });

    const payload = (req.body && typeof req.body === "object") ? req.body : {};
    // Honeypot — silently accept to avoid signaling
    if (typeof payload.website === "string" && payload.website.length > 0) {
      return res.status(200).json({ ok: true });
    }
    if (typeof payload._gotcha === "string" && payload._gotcha.length > 0) {
      return res.status(200).json({ ok: true });
    }
    const fields = (form.fields as any[]) || [];
    for (const f of fields) {
      if (f.required && (payload[f.key] == null || payload[f.key] === "")) {
        return res.status(400).json({ error: `Missing required field: ${f.label}` });
      }
    }

    // Try to extract identity
    const email: string | undefined = payload.email || payload.Email || payload.emailAddress;
    const name: string = payload.name || payload.fullName || payload.full_name || `${payload.firstName ?? ""} ${payload.lastName ?? ""}`.trim() || "Web Lead";
    const phone: string | undefined = payload.phone || payload.Phone || payload.phoneNumber;
    const company: string | undefined = payload.company || payload.companyName;

    let contactId: string | null = null;
    if (email) {
      const [existing] = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, form.organizationId), eq(crmContacts.email, email))).limit(1);
      if (existing) {
        contactId = existing.id;
      } else {
        const orgName = company || "Web Leads";
        let [orgRow] = await db.select().from(crmOrganisations)
          .where(and(eq(crmOrganisations.organizationId, form.organizationId), eq(crmOrganisations.name, orgName)))
          .limit(1);
        if (!orgRow) {
          [orgRow] = await db.insert(crmOrganisations).values({
            organizationId: form.organizationId,
            name: orgName,
            type: "CONTRACTOR",
          } as any).returning();
        }
        const parts = name.split(/\s+/);
        const firstName = parts[0] || "Lead";
        const lastName = parts.slice(1).join(" ") || "Web";
        const [c] = await db.insert(crmContacts).values({
          organizationId: form.organizationId,
          organisationId: orgRow.id,
          firstName,
          lastName,
          email,
          phone: phone ?? null,
        } as any).returning();
        contactId = c.id;
      }
    }

    let opportunityId: string | null = null;
    if (form.createOpportunity) {
      const [opp] = await db.insert(crmOpportunities).values({
        organizationId: form.organizationId,
        name: company ? `${company} — ${form.name}` : `${name} — ${form.name}`,
        stage: form.defaultStage,
        source: form.defaultSource ?? "Web Form",
        contactId,
        notes: payload.message || payload.notes || null,
        stageEnteredAt: new Date(),
      } as any).returning();
      opportunityId = opp.id;
    }

    const [submission] = await db.insert(crmLeadFormSubmissions).values({
      organizationId: form.organizationId,
      formId: form.id,
      payload,
      contactId,
      opportunityId,
      remoteIp: req.ip,
      userAgent: req.get("user-agent") ?? null,
    } as any).returning();

    // Notify users
    const notifyIds = (form.notifyUserIds as string[]) || [];
    for (const uid of notifyIds) {
      try {
        await db.insert(notifications).values({
          userId: uid,
          organizationId: form.organizationId,
          type: "CRM_LEAD_FORM",
          title: "New lead from web form",
          message: `${name} submitted "${form.name}"`,
          relatedEntityId: opportunityId ?? submission.id,
          relatedEntityType: opportunityId ? "CRM_OPPORTUNITY" : "CRM_LEAD_FORM_SUBMISSION",
        } as any);
      } catch { /* non-fatal */ }
    }

    try {
      await runAutomationsForTrigger({
        orgId: form.organizationId,
        trigger: "FORM_SUBMIT",
        entityType: opportunityId ? "OPPORTUNITY" : "CONTACT",
        entityId: opportunityId ?? contactId ?? submission.id,
        context: { formId: form.id, submissionId: submission.id, payload },
      });
    } catch { /* non-fatal */ }

    res.status(201).json({ ok: true, message: form.successMessage });
  } catch (e) { next(e); }
});

export default router;
