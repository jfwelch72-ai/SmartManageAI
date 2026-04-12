import { Router } from "express";
import { logError } from "./utils/logger";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { db } from "./db";
import { parsePagination } from "./utils/pagination";
import { emailCampaigns, emailCampaignContacts, emailCampaignTemplates } from "@shared/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "./services/emailService";

const router = Router();

const createCampaignSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  htmlContent: z.string().min(1),
  textContent: z.string().optional(),
  fromName: z.string().optional(),
  replyTo: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  htmlContent: z.string().min(1).optional(),
  textContent: z.string().optional(),
  fromName: z.string().optional(),
  replyTo: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  htmlContent: z.string().min(1),
  category: z.enum(["GENERAL", "NEWSLETTER", "PROMOTION", "ANNOUNCEMENT", "FOLLOW_UP"]).optional(),
  isDefault: z.boolean().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().optional(),
  htmlContent: z.string().min(1).optional(),
  category: z.enum(["GENERAL", "NEWSLETTER", "PROMOTION", "ANNOUNCEMENT", "FOLLOW_UP"]).optional(),
  isDefault: z.boolean().optional(),
});

const addContactsSchema = z.object({
  contacts: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
  })).min(1),
});

const scheduleCampaignSchema = z.object({
  scheduledAt: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Invalid date" }),
});

router.get("/api/email-campaigns/templates", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = orgCtx.isSuperAdmin ? [] : [eq(emailCampaignTemplates.organizationId, orgCtx.orgId!)];
    const templates = await db.select().from(emailCampaignTemplates).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(emailCampaignTemplates.createdAt));
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

router.post("/api/email-campaigns/templates", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const orgId = orgCtx.orgId || authReq.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const [template] = await db.insert(emailCampaignTemplates).values({
      ...parsed.data,
      organizationId: orgId,
    }).returning();
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/email-campaigns/templates/:id", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const conditions = [eq(emailCampaignTemplates.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaignTemplates.organizationId, orgCtx.orgId!));

    const [template] = await db.update(emailCampaignTemplates)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/email-campaigns/templates/:id", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaignTemplates.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaignTemplates.organizationId, orgCtx.orgId!));

    const [deleted] = await db.delete(emailCampaignTemplates).where(and(...conditions)).returning();
    if (!deleted) return res.status(404).json({ error: "Template not found" });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/api/email-campaigns", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const conditions = orgCtx.isSuperAdmin ? [] : [eq(emailCampaigns.organizationId, orgCtx.orgId!)];
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [campaigns, totalResult] = await Promise.all([
      db.select().from(emailCampaigns).where(whereClause).orderBy(desc(emailCampaigns.createdAt)).limit(limit).offset(offset),
      db.select({ count: count() }).from(emailCampaigns).where(whereClause),
    ]);

    res.json({ data: campaigns, total: totalResult[0]?.count || 0 });
  } catch (error) {
    next(error);
  }
});

router.get("/api/email-campaigns/:id", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [campaign] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const contacts = await db.select().from(emailCampaignContacts).where(eq(emailCampaignContacts.campaignId, campaign.id));

    res.json({ ...campaign, contacts });
  } catch (error) {
    next(error);
  }
});

router.post("/api/email-campaigns", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const orgId = orgCtx.orgId || authReq.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const [campaign] = await db.insert(emailCampaigns).values({
      ...parsed.data,
      organizationId: orgId,
      createdById: authReq.user!.id,
    }).returning();

    res.status(201).json(campaign);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/email-campaigns/:id", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = updateCampaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [existing] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (existing.status !== "DRAFT") return res.status(400).json({ error: "Only DRAFT campaigns can be updated" });

    const [campaign] = await db.update(emailCampaigns)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(emailCampaigns.id, req.params.id))
      .returning();

    res.json(campaign);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/email-campaigns/:id", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [existing] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (existing.status !== "DRAFT") return res.status(400).json({ error: "Only DRAFT campaigns can be deleted" });

    await db.delete(emailCampaigns).where(eq(emailCampaigns.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/email-campaigns/:id/send", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [campaign] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
      return res.status(400).json({ error: "Campaign must be in DRAFT or SCHEDULED status to send" });
    }

    const contacts = await db.select().from(emailCampaignContacts)
      .where(and(eq(emailCampaignContacts.campaignId, campaign.id), eq(emailCampaignContacts.status, "PENDING")));

    if (contacts.length === 0) return res.status(400).json({ error: "Campaign has no pending contacts" });

    await db.update(emailCampaigns).set({ status: "SENDING", updatedAt: new Date() }).where(eq(emailCampaigns.id, campaign.id));

    res.json({ message: "Campaign sending started", totalRecipients: contacts.length });

    let totalSent = 0;
    let totalBounced = 0;

    for (const contact of contacts) {
      try {
        const success = await sendEmail({
          to: contact.email,
          subject: campaign.subject,
          html: campaign.htmlContent,
          text: campaign.textContent || undefined,
          replyTo: campaign.replyTo || undefined,
        });

        if (success) {
          totalSent++;
          await db.update(emailCampaignContacts).set({ status: "SENT", sentAt: new Date() }).where(eq(emailCampaignContacts.id, contact.id));
        } else {
          totalBounced++;
          await db.update(emailCampaignContacts).set({ status: "BOUNCED", errorMessage: "Send failed" }).where(eq(emailCampaignContacts.id, contact.id));
        }
      } catch (err) {
        totalBounced++;
        await db.update(emailCampaignContacts).set({
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        }).where(eq(emailCampaignContacts.id, contact.id));
      }
    }

    await db.update(emailCampaigns).set({
      status: "SENT",
      sentAt: new Date(),
      totalSent,
      totalBounced,
      totalRecipients: contacts.length,
      updatedAt: new Date(),
    }).where(eq(emailCampaigns.id, campaign.id));
  } catch (error) {
    logError("Failed to send email campaign", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) next(error);
  }
});

router.post("/api/email-campaigns/:id/schedule", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = scheduleCampaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [existing] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (existing.status !== "DRAFT") return res.status(400).json({ error: "Only DRAFT campaigns can be scheduled" });

    const [campaign] = await db.update(emailCampaigns).set({
      status: "SCHEDULED",
      scheduledAt: new Date(parsed.data.scheduledAt),
      updatedAt: new Date(),
    }).where(eq(emailCampaigns.id, req.params.id)).returning();

    res.json(campaign);
  } catch (error) {
    next(error);
  }
});

router.post("/api/email-campaigns/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [existing] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (existing.status !== "SCHEDULED") return res.status(400).json({ error: "Only SCHEDULED campaigns can be cancelled" });

    const [campaign] = await db.update(emailCampaigns).set({
      status: "CANCELLED",
      scheduledAt: null,
      updatedAt: new Date(),
    }).where(eq(emailCampaigns.id, req.params.id)).returning();

    res.json(campaign);
  } catch (error) {
    next(error);
  }
});

router.post("/api/email-campaigns/:id/contacts", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = addContactsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [campaign] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const contacts = await db.insert(emailCampaignContacts).values(
      parsed.data.contacts.map((c) => ({
        campaignId: campaign.id,
        email: c.email,
        name: c.name,
      }))
    ).returning();

    await db.update(emailCampaigns).set({
      totalRecipients: sql`COALESCE(${emailCampaigns.totalRecipients}, 0) + ${contacts.length}`,
      updatedAt: new Date(),
    }).where(eq(emailCampaigns.id, campaign.id));

    res.status(201).json(contacts);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/email-campaigns/:id/contacts/:contactId", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [campaign] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const [deleted] = await db.delete(emailCampaignContacts)
      .where(and(eq(emailCampaignContacts.id, req.params.contactId), eq(emailCampaignContacts.campaignId, campaign.id)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Contact not found" });

    await db.update(emailCampaigns).set({
      totalRecipients: sql`GREATEST(COALESCE(${emailCampaigns.totalRecipients}, 0) - 1, 0)`,
      updatedAt: new Date(),
    }).where(eq(emailCampaigns.id, campaign.id));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/email-campaigns/:id/duplicate", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const orgCtx = getOrgIdForFilter(authReq);
    if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions = [eq(emailCampaigns.id, req.params.id)];
    if (!orgCtx.isSuperAdmin) conditions.push(eq(emailCampaigns.organizationId, orgCtx.orgId!));

    const [original] = await db.select().from(emailCampaigns).where(and(...conditions));
    if (!original) return res.status(404).json({ error: "Campaign not found" });

    const [campaign] = await db.insert(emailCampaigns).values({
      organizationId: original.organizationId,
      name: `${original.name} (Copy)`,
      subject: original.subject,
      htmlContent: original.htmlContent,
      textContent: original.textContent,
      fromName: original.fromName,
      replyTo: original.replyTo,
      tags: original.tags,
      createdById: authReq.user!.id,
    }).returning();

    res.status(201).json(campaign);
  } catch (error) {
    next(error);
  }
});

export default router;
