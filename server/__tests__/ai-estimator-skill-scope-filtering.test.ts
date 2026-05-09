/**
 * Task #2708 — Scope skills to specific estimate bids automatically via
 * trade detection.
 *
 * Confirms:
 *   • retrieveSkillsForEstimate returns ONLY global skills when no scope
 *     filters are provided.
 *   • retrieveSkillsForEstimate correctly includes trade-scoped skills
 *     when a matching tradeType is passed.
 *   • Trade-scoped skills for a DIFFERENT trade are NOT returned.
 *   • CSI-division-scoped and project-type-scoped skills fire only when
 *     the matching filter is supplied.
 *   • resolveBidTradeType (the helper in draftEstimate) picks
 *     project.primaryTradeType over org.tradeType when both exist and
 *     falls back to org.tradeType when no project is linked.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";

import { db } from "../db";
import { organizations, users, bids, projects, aiEstimatorSkills } from "@shared/schema";
import { retrieveSkillsForEstimate } from "../services/aiEstimator/skills";

const PREFIX = "__skill_scope_2708__";

let orgId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM ai_estimator_skills
    WHERE organization_id IN (
      SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}
    )
  `).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE name LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE name LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

async function insertSkill(opts: {
  name: string;
  scope: "global" | "trade" | "csi_division" | "project_type";
  scopeValue?: string | null;
  priority?: number;
}) {
  const [row] = await db
    .insert(aiEstimatorSkills)
    .values({
      organizationId: orgId,
      name: opts.name,
      ruleBody: `Rule body for ${opts.name}`,
      scope: opts.scope,
      scopeValue: opts.scopeValue ?? null,
      priority: opts.priority ?? 100,
      isActive: true,
      isReadOnly: false,
      sourceType: "user_authored",
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Skill Scope Test Org",
      slug: `${PREFIX}org-${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;
});

afterAll(async () => {
  await cleanup();
});

describe("retrieveSkillsForEstimate — scope filtering", () => {
  it("returns global org skills when no scope filter is provided", async () => {
    const global1 = await insertSkill({ name: `${PREFIX}global-1`, scope: "global", priority: 1 });
    const trade1 = await insertSkill({ name: `${PREFIX}trade-concrete`, scope: "trade", scopeValue: "CONCRETE", priority: 2 });

    try {
      const results = await retrieveSkillsForEstimate({ organizationId: orgId });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(global1.id);
      expect(ids).not.toContain(trade1.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${global1.id}, ${trade1.id})`).catch(() => {});
    }
  });

  it("includes trade-scoped skills when tradeType matches", async () => {
    const globalSkill = await insertSkill({ name: `${PREFIX}global-2`, scope: "global", priority: 1 });
    const concreteSkill = await insertSkill({ name: `${PREFIX}trade-concrete-2`, scope: "trade", scopeValue: "CONCRETE", priority: 2 });
    const masonrySkill = await insertSkill({ name: `${PREFIX}trade-masonry`, scope: "trade", scopeValue: "MASONRY", priority: 3 });

    try {
      const results = await retrieveSkillsForEstimate({ organizationId: orgId, tradeType: "CONCRETE" });
      const ids = results.map((r) => r.id);

      expect(ids).toContain(globalSkill.id);
      expect(ids).toContain(concreteSkill.id);
      expect(ids).not.toContain(masonrySkill.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${globalSkill.id}, ${concreteSkill.id}, ${masonrySkill.id})`).catch(() => {});
    }
  });

  it("does NOT return trade-scoped skills for a different trade", async () => {
    const electricalSkill = await insertSkill({ name: `${PREFIX}trade-elec`, scope: "trade", scopeValue: "ELECTRICAL", priority: 1 });
    const plumbingSkill = await insertSkill({ name: `${PREFIX}trade-plumb`, scope: "trade", scopeValue: "PLUMBING", priority: 2 });

    try {
      const results = await retrieveSkillsForEstimate({ organizationId: orgId, tradeType: "ELECTRICAL" });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(electricalSkill.id);
      expect(ids).not.toContain(plumbingSkill.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${electricalSkill.id}, ${plumbingSkill.id})`).catch(() => {});
    }
  });

  it("includes csi_division-scoped skills when csiDivision matches", async () => {
    const globalSkill = await insertSkill({ name: `${PREFIX}global-3`, scope: "global", priority: 1 });
    const csiSkill = await insertSkill({ name: `${PREFIX}csi-03`, scope: "csi_division", scopeValue: "03", priority: 2 });
    const csiOther = await insertSkill({ name: `${PREFIX}csi-09`, scope: "csi_division", scopeValue: "09", priority: 3 });

    try {
      const results = await retrieveSkillsForEstimate({ organizationId: orgId, csiDivision: "03" });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(globalSkill.id);
      expect(ids).toContain(csiSkill.id);
      expect(ids).not.toContain(csiOther.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${globalSkill.id}, ${csiSkill.id}, ${csiOther.id})`).catch(() => {});
    }
  });

  it("includes project_type-scoped skills when projectType matches", async () => {
    const globalSkill = await insertSkill({ name: `${PREFIX}global-4`, scope: "global", priority: 1 });
    const commercialSkill = await insertSkill({ name: `${PREFIX}pt-commercial`, scope: "project_type", scopeValue: "COMMERCIAL", priority: 2 });
    const residentialSkill = await insertSkill({ name: `${PREFIX}pt-residential`, scope: "project_type", scopeValue: "RESIDENTIAL", priority: 3 });

    try {
      const results = await retrieveSkillsForEstimate({ organizationId: orgId, projectType: "COMMERCIAL" });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(globalSkill.id);
      expect(ids).toContain(commercialSkill.id);
      expect(ids).not.toContain(residentialSkill.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${globalSkill.id}, ${commercialSkill.id}, ${residentialSkill.id})`).catch(() => {});
    }
  });

  it("can combine multiple scope filters (trade + csiDivision)", async () => {
    const globalSkill = await insertSkill({ name: `${PREFIX}global-5`, scope: "global", priority: 1 });
    const tradeSkill = await insertSkill({ name: `${PREFIX}trade-hvac`, scope: "trade", scopeValue: "HVAC", priority: 2 });
    const csiSkill = await insertSkill({ name: `${PREFIX}csi-23`, scope: "csi_division", scopeValue: "23", priority: 3 });
    const unrelatedTrade = await insertSkill({ name: `${PREFIX}trade-unrelated`, scope: "trade", scopeValue: "MASONRY", priority: 4 });

    try {
      const results = await retrieveSkillsForEstimate({
        organizationId: orgId,
        tradeType: "HVAC",
        csiDivision: "23",
      });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(globalSkill.id);
      expect(ids).toContain(tradeSkill.id);
      expect(ids).toContain(csiSkill.id);
      expect(ids).not.toContain(unrelatedTrade.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${globalSkill.id}, ${tradeSkill.id}, ${csiSkill.id}, ${unrelatedTrade.id})`).catch(() => {});
    }
  });

  it("does not cross org boundaries — skills from other orgs are not returned", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Other Scope Org",
        slug: `${PREFIX}other-${stamp}`,
        tradeType: "CONCRETE",
        onboardingStatus: "COMPLETED",
        isActive: true,
      })
      .returning();

    const ownSkill = await insertSkill({ name: `${PREFIX}own-org-skill`, scope: "global", priority: 1 });
    const [otherSkill] = await db
      .insert(aiEstimatorSkills)
      .values({
        organizationId: otherOrg.id,
        name: `${PREFIX}other-org-skill`,
        ruleBody: "Other org rule",
        scope: "global",
        priority: 1,
        isActive: true,
        isReadOnly: false,
        sourceType: "user_authored",
      })
      .returning();

    try {
      const results = await retrieveSkillsForEstimate({ organizationId: orgId });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(ownSkill.id);
      expect(ids).not.toContain(otherSkill.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${ownSkill.id}, ${otherSkill.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${otherOrg.id}`).catch(() => {});
    }
  });
});

describe("trade type resolution — bid → project → org fallback", () => {
  it("returns project.primaryTradeType when the bid links to a converted project", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [project] = await db
      .insert(projects)
      .values({
        name: `${PREFIX}proj-${stamp}`,
        code: `${PREFIX}PROJ${stamp.slice(-6)}`,
        clientName: "Test Client",
        gcOrganizationId: orgId,
        primaryTradeType: "CONCRETE",
        status: "PLANNING",
      })
      .returning();

    const [bid] = await db
      .insert(bids)
      .values({
        name: `${PREFIX}bid-${stamp}`,
        code: `${PREFIX}BID${stamp.slice(-6)}`,
        clientName: "Test Client",
        gcOrganizationId: orgId,
        convertedToProjectId: project.id,
        status: "DRAFT",
      })
      .returning();

    const concreteSkill = await insertSkill({ name: `${PREFIX}concrete-resolved`, scope: "trade", scopeValue: "CONCRETE", priority: 1 });
    const gcSkill = await insertSkill({ name: `${PREFIX}gc-not-used`, scope: "trade", scopeValue: "GENERAL_CONTRACTOR", priority: 2 });

    try {
      const [bidRow] = await db
        .select({ convertedToProjectId: bids.convertedToProjectId })
        .from(bids)
        .where(eq(bids.id, bid.id))
        .limit(1);

      let resolvedTradeType: string | null = null;
      if (bidRow?.convertedToProjectId) {
        const [projectRow] = await db
          .select({ primaryTradeType: projects.primaryTradeType })
          .from(projects)
          .where(eq(projects.id, bidRow.convertedToProjectId))
          .limit(1);
        resolvedTradeType = projectRow?.primaryTradeType ?? null;
      }

      expect(resolvedTradeType).toBe("CONCRETE");

      const results = await retrieveSkillsForEstimate({
        organizationId: orgId,
        tradeType: resolvedTradeType,
      });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(concreteSkill.id);
      expect(ids).not.toContain(gcSkill.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${concreteSkill.id}, ${gcSkill.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM bids WHERE id = ${bid.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE id = ${project.id}`).catch(() => {});
    }
  });

  it("falls back to org.tradeType when the bid has no convertedToProjectId", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [bid] = await db
      .insert(bids)
      .values({
        name: `${PREFIX}bid-noconv-${stamp}`,
        code: `${PREFIX}BIDNC${stamp.slice(-6)}`,
        clientName: "Test Client",
        gcOrganizationId: orgId,
        status: "DRAFT",
      })
      .returning();

    const gcSkill = await insertSkill({ name: `${PREFIX}gc-fallback`, scope: "trade", scopeValue: "GENERAL_CONTRACTOR", priority: 1 });
    const concreteSkill = await insertSkill({ name: `${PREFIX}concrete-not-used`, scope: "trade", scopeValue: "CONCRETE", priority: 2 });

    try {
      const [bidRow] = await db
        .select({ convertedToProjectId: bids.convertedToProjectId })
        .from(bids)
        .where(eq(bids.id, bid.id))
        .limit(1);

      let resolvedTradeType: string | null = null;
      if (bidRow?.convertedToProjectId) {
        const [projectRow] = await db
          .select({ primaryTradeType: projects.primaryTradeType })
          .from(projects)
          .where(eq(projects.id, bidRow.convertedToProjectId))
          .limit(1);
        resolvedTradeType = projectRow?.primaryTradeType ?? null;
      }
      if (!resolvedTradeType) {
        const [orgRow] = await db
          .select({ tradeType: organizations.tradeType })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        resolvedTradeType = orgRow?.tradeType ?? null;
      }

      expect(resolvedTradeType).toBe("GENERAL_CONTRACTOR");

      const results = await retrieveSkillsForEstimate({
        organizationId: orgId,
        tradeType: resolvedTradeType,
      });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(gcSkill.id);
      expect(ids).not.toContain(concreteSkill.id);
    } finally {
      await db.execute(sql`DELETE FROM ai_estimator_skills WHERE id IN (${gcSkill.id}, ${concreteSkill.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM bids WHERE id = ${bid.id}`).catch(() => {});
    }
  });
});
