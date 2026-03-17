import { Router } from "express";
import { db } from "./db";
import {
  crmOpportunities,
  crmOpportunityActivities,
  crmOrganisations,
  crmContacts,
  insertCrmOpportunitySchema,
  insertCrmOpportunityActivitySchema,
  auditLog,
  users,
  projects,
} from "@shared/schema";
import { eq, and, desc, sql, ilike, or, type SQL, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const PIPELINE_ROLES = ["ADMIN", "MANAGER", "ESTIMATOR", "SALES", "OFFICE_MANAGER"] as const;
const EDIT_ROLES = ["ADMIN", "MANAGER", "ESTIMATOR", "SALES"] as const;
const DELETE_ROLES = ["ADMIN", "MANAGER"] as const;

const STAGE_LABELS: Record<string, string> = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  ESTIMATING: "Estimating",
  BID_SUBMITTED: "Bid Submitted",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

router.get("/api/crm/pipeline/users", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(users.organizationId, orgId));
    conditions.push(eq(users.isActive, true));

    const orgUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.firstName));

    res.json(orgUsers);
  } catch (error) {
    console.error("Get pipeline users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/pipeline/stats", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const opps = await db
      .select({
        stage: crmOpportunities.stage,
        dealValue: crmOpportunities.dealValue,
        probability: crmOpportunities.probability,
      })
      .from(crmOpportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    let totalValue = 0;
    let weightedValue = 0;
    let wonValue = 0;
    let wonCount = 0;
    let lostCount = 0;
    const stageCounts: Record<string, number> = {};
    const stageValues: Record<string, number> = {};

    for (const opp of opps) {
      const val = parseFloat(opp.dealValue ?? "0") || 0;
      const prob = opp.probability ?? 10;
      stageCounts[opp.stage] = (stageCounts[opp.stage] ?? 0) + 1;
      stageValues[opp.stage] = (stageValues[opp.stage] ?? 0) + val;

      if (opp.stage !== "WON" && opp.stage !== "LOST") {
        totalValue += val;
        weightedValue += val * prob / 100;
      }
      if (opp.stage === "WON") { wonValue += val; wonCount++; }
      if (opp.stage === "LOST") lostCount++;
    }

    const winRate = (wonCount + lostCount) > 0 ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0;

    res.json({
      totalValue,
      weightedValue,
      wonValue,
      winRate,
      openDeals: opps.filter(o => o.stage !== "WON" && o.stage !== "LOST").length,
      totalDeals: opps.length,
      stageCounts,
      stageValues,
    });
  } catch (error) {
    console.error("Pipeline stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const oppSelectFields = {
  id: crmOpportunities.id,
  organizationId: crmOpportunities.organizationId,
  name: crmOpportunities.name,
  stage: crmOpportunities.stage,
  dealValue: crmOpportunities.dealValue,
  probability: crmOpportunities.probability,
  crmOrganisationId: crmOpportunities.crmOrganisationId,
  contactId: crmOpportunities.contactId,
  assignedToId: crmOpportunities.assignedToId,
  projectType: crmOpportunities.projectType,
  projectLocation: crmOpportunities.projectLocation,
  expectedCloseDate: crmOpportunities.expectedCloseDate,
  source: crmOpportunities.source,
  notes: crmOpportunities.notes,
  lostReason: crmOpportunities.lostReason,
  createdById: crmOpportunities.createdById,
  createdAt: crmOpportunities.createdAt,
  updatedAt: crmOpportunities.updatedAt,
  crmOrgName: crmOrganisations.name,
  contactFirstName: crmContacts.firstName,
  contactLastName: crmContacts.lastName,
  assignedFirstName: users.firstName,
  assignedLastName: users.lastName,
};

function buildOppBaseQuery() {
  return db
    .select(oppSelectFields)
    .from(crmOpportunities)
    .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmOpportunities.crmOrganisationId))
    .leftJoin(crmContacts, eq(crmContacts.id, crmOpportunities.contactId))
    .leftJoin(users, eq(users.id, crmOpportunities.assignedToId));
}

router.get("/api/crm/opportunities", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { stage, assignedToId, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));
    if (stage && stage !== "all") {
      conditions.push(sql`${crmOpportunities.stage} = ${stage}`);
    }
    if (assignedToId && assignedToId !== "all") {
      conditions.push(eq(crmOpportunities.assignedToId, assignedToId));
    }
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(crmOpportunities.name, term),
          ilike(crmOpportunities.projectType, term),
          ilike(crmOpportunities.projectLocation, term),
        ) as SQL
      );
    }

    const results = await buildOppBaseQuery()
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(crmOpportunities.updatedAt))
      .limit(limitNum)
      .offset(offset);

    res.json(results);
  } catch (error) {
    console.error("Get opportunities error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/opportunities/:id", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await buildOppBaseQuery()
      .where(and(...conditions))
      .limit(1);

    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    res.json(opp);
  } catch (error) {
    console.error("Get opportunity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/opportunities", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const parsed = insertCrmOpportunitySchema.safeParse({
      ...req.body,
      organizationId: orgId,
      createdById: req.user!.id,
    });

    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const [created] = await db.insert(crmOpportunities).values(parsed.data).returning();

    await db.insert(crmOpportunityActivities).values({
      opportunityId: created.id,
      activityType: "NOTE",
      description: `Opportunity created at stage: ${STAGE_LABELS[created.stage] ?? created.stage}`,
      createdById: req.user!.id,
    });

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "crm_opportunities",
      entityId: created.id,
      newValue: JSON.stringify({ name: created.name, stage: created.stage }),
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("Create opportunity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/crm/opportunities/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [existing] = await db.select().from(crmOpportunities).where(and(...conditions)).limit(1);
    if (!existing) return res.status(404).json({ error: "Opportunity not found" });

    const parsed = insertCrmOpportunitySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const { organizationId: _orgId, ...safeData } = parsed.data;

    const [updated] = await db
      .update(crmOpportunities)
      .set({ ...safeData, updatedAt: new Date() })
      .where(eq(crmOpportunities.id, req.params.id))
      .returning();

    if (safeData.stage && safeData.stage !== existing.stage) {
      await db.insert(crmOpportunityActivities).values({
        opportunityId: existing.id,
        activityType: "NOTE",
        description: `[Stage Change] ${STAGE_LABELS[existing.stage] ?? existing.stage} → ${STAGE_LABELS[safeData.stage] ?? safeData.stage}`,
        createdById: req.user!.id,
      });
    }

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "crm_opportunities",
      entityId: updated.id,
      oldValue: JSON.stringify({ stage: existing.stage }),
      newValue: JSON.stringify({ stage: updated.stage }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Update opportunity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crm/opportunities/:id", requireAuth, requireRole(...DELETE_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [existing] = await db.select().from(crmOpportunities).where(and(...conditions)).limit(1);
    if (!existing) return res.status(404).json({ error: "Opportunity not found" });

    await db.delete(crmOpportunities).where(and(...conditions));

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "crm_opportunities",
      entityId: existing.id,
      oldValue: JSON.stringify({ name: existing.name }),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete opportunity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/opportunities/:id/activities", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    const createdByAlias = db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(users).as("creator");

    const activities = await db
      .select({
        id: crmOpportunityActivities.id,
        opportunityId: crmOpportunityActivities.opportunityId,
        activityType: crmOpportunityActivities.activityType,
        description: crmOpportunityActivities.description,
        scheduledAt: crmOpportunityActivities.scheduledAt,
        completedAt: crmOpportunityActivities.completedAt,
        createdById: crmOpportunityActivities.createdById,
        createdAt: crmOpportunityActivities.createdAt,
        createdByFirstName: createdByAlias.firstName,
        createdByLastName: createdByAlias.lastName,
      })
      .from(crmOpportunityActivities)
      .leftJoin(createdByAlias, eq(createdByAlias.id, crmOpportunityActivities.createdById))
      .where(eq(crmOpportunityActivities.opportunityId, req.params.id))
      .orderBy(desc(crmOpportunityActivities.createdAt));

    res.json(activities);
  } catch (error) {
    console.error("Get activities error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/opportunities/:id/activities", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    const parsed = insertCrmOpportunityActivitySchema.safeParse({
      ...req.body,
      opportunityId: req.params.id,
      createdById: req.user!.id,
    });

    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const [created] = await db.insert(crmOpportunityActivities).values(parsed.data).returning();

    const createdByAlias = db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(users).as("creator");

    const [withUser] = await db
      .select({
        id: crmOpportunityActivities.id,
        opportunityId: crmOpportunityActivities.opportunityId,
        activityType: crmOpportunityActivities.activityType,
        description: crmOpportunityActivities.description,
        scheduledAt: crmOpportunityActivities.scheduledAt,
        completedAt: crmOpportunityActivities.completedAt,
        createdById: crmOpportunityActivities.createdById,
        createdAt: crmOpportunityActivities.createdAt,
        createdByFirstName: createdByAlias.firstName,
        createdByLastName: createdByAlias.lastName,
      })
      .from(crmOpportunityActivities)
      .leftJoin(createdByAlias, eq(createdByAlias.id, crmOpportunityActivities.createdById))
      .where(eq(crmOpportunityActivities.id, created.id));

    res.status(201).json(withUser);
  } catch (error) {
    console.error("Create activity error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const BID_CODE_START = 260001;
async function getNextProjectCode(): Promise<string> {
  const result = await db.execute(sql`
    SELECT GREATEST(
      COALESCE((SELECT MAX(CAST(code AS INTEGER)) FROM bids WHERE code ~ '^[0-9]+$' AND CAST(code AS INTEGER) >= ${BID_CODE_START}), ${BID_CODE_START - 1}),
      COALESCE((SELECT MAX(CAST(code AS INTEGER)) FROM projects WHERE code ~ '^[0-9]+$' AND CAST(code AS INTEGER) >= ${BID_CODE_START}), ${BID_CODE_START - 1})
    ) as max_code
  `);
  const maxCode = Number(result.rows[0]?.max_code) || BID_CODE_START - 1;
  return String(maxCode + 1);
}

router.post("/api/crm/opportunities/:id/convert-to-project", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });
    if (opp.stage !== "WON") return res.status(400).json({ error: "Only WON opportunities can be converted to projects" });

    const { name, clientName, description, startDate, targetEndDate, location } = req.body as {
      name?: string;
      clientName?: string;
      description?: string;
      startDate?: string;
      targetEndDate?: string;
      location?: string;
    };

    const code = await getNextProjectCode();

    const [newProject] = await db.insert(projects).values({
      gcOrganizationId: orgId,
      code,
      name: name || opp.name,
      clientName: clientName || opp.crmOrganisationId || "TBD",
      description: description || opp.notes || null,
      locationAddress: location || opp.projectLocation || null,
      startDate: startDate ? new Date(startDate) : null,
      status: "PLANNING",
      contractAmount: opp.dealValue || null,
    }).returning();

    await db.insert(crmOpportunityActivities).values({
      opportunityId: opp.id,
      activityType: "NOTE",
      description: `[Converted] Opportunity converted to project: ${newProject.name} (ID: ${newProject.id})`,
      createdById: req.user!.id,
    });

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "projects",
      entityId: newProject.id,
      newValue: JSON.stringify({ name: newProject.name, fromOpportunity: opp.id }),
    });

    res.status(201).json({ project: newProject, opportunityId: opp.id });
  } catch (error) {
    console.error("Convert to project error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
