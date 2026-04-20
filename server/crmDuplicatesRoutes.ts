import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { crmContacts, crmOrganisations, crmOpportunities, crmQuotes, crmTasks, crmOpportunityActivities, crmOrganisationNotes } from "@shared/schema";
import { and, eq, sql, ne } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

// Find contact duplicates by lower(email)
router.get("/api/crm/duplicates/contacts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const dupes = await db.execute<{ key: string; ids: string[]; cnt: number }>(sql`
      SELECT lower(email) as key, array_agg(id ORDER BY created_at) as ids, count(*)::int as cnt
      FROM crm_contacts
      WHERE organization_id = ${orgId} AND email IS NOT NULL AND email <> ''
      GROUP BY lower(email)
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 200
    `);

    const ids: string[] = Array.from(new Set((dupes.rows as any[]).flatMap(r => r.ids)));
    const records = ids.length ? await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, orgId))) : [];
    const byId = new Map(records.map(r => [r.id, r]));
    res.json((dupes.rows as any[]).map(g => ({
      key: g.key,
      count: g.cnt,
      records: g.ids.map((id: string) => byId.get(id)).filter(Boolean),
    })));
  } catch (e) { next(e); }
});

router.get("/api/crm/duplicates/organisations", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const dupes = await db.execute<{ key: string; ids: string[]; cnt: number }>(sql`
      SELECT lower(trim(name)) as key, array_agg(id ORDER BY created_at) as ids, count(*)::int as cnt
      FROM crm_organisations
      WHERE organization_id = ${orgId}
      GROUP BY lower(trim(name))
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 200
    `);

    const records = await db.select().from(crmOrganisations).where(eq(crmOrganisations.organizationId, orgId));
    const byId = new Map(records.map(r => [r.id, r]));
    res.json((dupes.rows as any[]).map(g => ({
      key: g.key,
      count: g.cnt,
      records: g.ids.map((id: string) => byId.get(id)).filter(Boolean),
    })));
  } catch (e) { next(e); }
});

const mergeSchema = z.object({
  type: z.enum(["contact", "organisation"]),
  keepId: z.string().min(1),
  mergeIds: z.array(z.string().min(1)).min(1).max(20),
});

router.post("/api/crm/duplicates/merge", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const { type, keepId, mergeIds } = parsed.data;

    if (mergeIds.includes(keepId)) return res.status(400).json({ error: "keepId cannot be in mergeIds" });

    if (type === "contact") {
      const [keep] = await db.select().from(crmContacts).where(and(eq(crmContacts.id, keepId), eq(crmContacts.organizationId, orgId))).limit(1);
      if (!keep) return res.status(404).json({ error: "Keep contact not found" });
      const sources = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, orgId), sql`${crmContacts.id} = ANY(${mergeIds})`));
      if (sources.length !== mergeIds.length) return res.status(400).json({ error: "Some merge contacts not found in this org" });
      for (const src of sources) {
        await db.update(crmOpportunities).set({ contactId: keepId }).where(and(eq(crmOpportunities.contactId, src.id), eq(crmOpportunities.organizationId, orgId)));
        await db.update(crmQuotes).set({ contactId: keepId }).where(and(eq(crmQuotes.contactId, src.id), eq(crmQuotes.organizationId, orgId)));
        await db.update(crmTasks).set({ contactId: keepId }).where(and(eq(crmTasks.contactId, src.id), eq(crmTasks.organizationId, orgId)));
        await db.delete(crmContacts).where(and(eq(crmContacts.id, src.id), eq(crmContacts.organizationId, orgId)));
      }
      return res.json({ ok: true, mergedCount: sources.length });
    }

    // organisation merge
    const [keepOrg] = await db.select().from(crmOrganisations).where(and(eq(crmOrganisations.id, keepId), eq(crmOrganisations.organizationId, orgId))).limit(1);
    if (!keepOrg) return res.status(404).json({ error: "Keep organisation not found" });
    const sources = await db.select().from(crmOrganisations).where(and(eq(crmOrganisations.organizationId, orgId), sql`${crmOrganisations.id} = ANY(${mergeIds})`));
    if (sources.length !== mergeIds.length) return res.status(400).json({ error: "Some merge organisations not found in this org" });
    for (const src of sources) {
      await db.update(crmContacts).set({ organisationId: keepId }).where(and(eq(crmContacts.organisationId, src.id), eq(crmContacts.organizationId, orgId)));
      await db.update(crmOpportunities).set({ crmOrganisationId: keepId }).where(and(eq(crmOpportunities.crmOrganisationId, src.id), eq(crmOpportunities.organizationId, orgId)));
      await db.update(crmQuotes).set({ crmOrganisationId: keepId }).where(and(eq(crmQuotes.crmOrganisationId, src.id), eq(crmQuotes.organizationId, orgId)));
      await db.update(crmTasks).set({ crmOrganisationId: keepId }).where(and(eq(crmTasks.crmOrganisationId, src.id), eq(crmTasks.organizationId, orgId)));
      await db.update(crmOrganisationNotes).set({ organisationId: keepId }).where(eq(crmOrganisationNotes.organisationId, src.id));
      await db.delete(crmOrganisations).where(and(eq(crmOrganisations.id, src.id), eq(crmOrganisations.organizationId, orgId)));
    }
    res.json({ ok: true, mergedCount: sources.length });
  } catch (e) { next(e); }
});

export default router;
