import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { organizations, crmOpportunities, crmContacts, crmOrganisations, crmOpportunityActivities } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import { evaluateAssignment } from "./utils/crmAssignmentEngine";
import rateLimit from "express-rate-limit";

const router = Router();

const publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again later." },
});

const leadSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(50).optional().nullable(),
  companyName: z.string().max(200).optional().nullable(),
  projectType: z.string().max(120).optional().nullable(),
  projectLocation: z.string().max(200).optional().nullable(),
  estimatedBudget: z.union([z.number(), z.string()]).optional().nullable(),
  message: z.string().max(4000).optional().nullable(),
  source: z.string().max(80).optional().default("WEB_FORM"),
  // Honeypot - if any value, treat as spam
  website: z.string().optional(),
});

router.post("/api/public/leads/:orgSlug", publicLeadLimiter, async (req, res, next) => {
  try {
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid submission", details: parsed.error.errors });

    // Honeypot trip — silently 200
    if (parsed.data.website && parsed.data.website.length > 0) {
      return res.status(200).json({ ok: true });
    }

    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, req.params.orgSlug)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const data = parsed.data;
    const dealValue = data.estimatedBudget != null && data.estimatedBudget !== "" ? String(data.estimatedBudget) : null;

    // Try to attach to existing CRM org by company name match
    let crmOrgId: string | null = null;
    if (data.companyName) {
      const [existingCrmOrg] = await db
        .select({ id: crmOrganisations.id })
        .from(crmOrganisations)
        .where(and(eq(crmOrganisations.organizationId, org.id), ilike(crmOrganisations.name, data.companyName)))
        .limit(1);
      crmOrgId = existingCrmOrg?.id ?? null;
    }

    // Try to attach to existing contact by email
    let contactId: string | null = null;
    const [existingContact] = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(and(eq(crmContacts.organizationId, org.id), ilike(crmContacts.email, data.email)))
      .limit(1);
    contactId = existingContact?.id ?? null;

    const assignedToId = await evaluateAssignment(org.id, {
      source: data.source,
      projectType: data.projectType,
      projectLocation: data.projectLocation,
      dealValue: dealValue,
    });

    const [opportunity] = await db.insert(crmOpportunities).values({
      organizationId: org.id,
      name: `${data.name}${data.companyName ? ` (${data.companyName})` : ""} — ${data.projectType ?? "Inquiry"}`,
      stage: "LEAD",
      dealValue,
      probability: 10,
      crmOrganisationId: crmOrgId,
      contactId,
      projectType: data.projectType ?? null,
      projectLocation: data.projectLocation ?? null,
      source: data.source ?? "WEB_FORM",
      notes: data.message ? `Inquiry from web form:\n${data.message}\n\nContact: ${data.name} <${data.email}>${data.phone ? ` ${data.phone}` : ""}` : `Web inquiry from ${data.name} <${data.email}>`,
      assignedToId,
    }).returning();

    await db.insert(crmOpportunityActivities).values({
      opportunityId: opportunity.id,
      activityType: "NOTE",
      description: `Lead captured from web form. Source: ${data.source ?? "WEB_FORM"}. Contact: ${data.name} <${data.email}>${data.phone ? ` ${data.phone}` : ""}.${assignedToId ? ` Auto-assigned via rules.` : ""}`,
    });

    res.status(201).json({ ok: true, opportunityId: opportunity.id });
  } catch (error) {
    next(error);
  }
});

export default router;
