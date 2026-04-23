// Task #1412 — Scheduled/manual DOL wage decision syncs must reuse the
// per-project `dol_classification_mappings` so refreshed rates flow into
// `prevailing_wage_rates` without requiring a PM to re-open the override
// dialog. We exercise `applySavedMappingsForDecision` directly because it
// is the seam `importWageDetermination` calls after the cache write
// succeeds — keeping the test focused on the mapping-reuse contract and
// avoiding the SAM.gov network surface entirely.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { inArray, sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  jobClassifications,
  prevailingWageRates,
  dolClassificationMappings,
} from "@shared/schema";
import {
  applySavedMappingsForDecision,
  type DavisBaconWageRate,
} from "../integrations/providers/dol_davis_bacon/sync";

const PREFIX = "__dbmapreuse__";
const DECISION = "CA20260042";

let orgId: string;
let projectId: string;
let otherProjectId: string;
let carpenterClassId: string;
let ironworkerClassId: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
  await db.delete(dolClassificationMappings).where(inArray(dolClassificationMappings.organizationId, orgIds)).catch(() => {});
  await db.delete(prevailingWageRates).where(inArray(prevailingWageRates.organizationId, orgIds)).catch(() => {});
  await db.delete(jobClassifications).where(inArray(jobClassifications.organizationId, orgIds)).catch(() => {});
  await db.delete(projects).where(inArray(projects.gcOrganizationId, orgIds)).catch(() => {});
  await db.delete(users).where(inArray(users.organizationId, orgIds)).catch(() => {});
  await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db.insert(organizations).values({
    name: "DOL Mapping Reuse Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const [project] = await db.insert(projects).values({
    name: "Mapping Reuse Project",
    code: `${PREFIX}P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
    wageDecision: DECISION,
  }).returning();
  projectId = project.id;

  // Second project that does NOT reference this wage decision — used to
  // prove the function scopes its writes to projects keyed off the
  // decision number rather than blindly walking every mapping in the org.
  const [otherProject] = await db.insert(projects).values({
    name: "Other Project",
    code: `${PREFIX}OP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
    wageDecision: "CA-DIFFERENT-DECISION",
  }).returning();
  otherProjectId = otherProject.id;

  const [carpenter] = await db.insert(jobClassifications).values({
    organizationId: orgId,
    name: "Carpenter",
  }).returning();
  carpenterClassId = carpenter.id;

  const [ironworker] = await db.insert(jobClassifications).values({
    organizationId: orgId,
    name: "Ironworker",
  }).returning();
  ironworkerClassId = ironworker.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(async () => {
  await db.delete(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgId));
  await db.delete(dolClassificationMappings).where(eq(dolClassificationMappings.organizationId, orgId));
});

const sampleRates = (carpenterBase: number): DavisBaconWageRate[] => [
  {
    classification: "Carpenter (Group 1)",
    baseRate: carpenterBase,
    fringeRate: 12.5,
    totalRate: carpenterBase + 12.5,
    health: 5,
    pension: 4,
    vacation: 2,
    training: 1.5,
  },
  {
    classification: "Ironworker",
    baseRate: 60,
    fringeRate: 15,
    totalRate: 75,
    health: 6,
    pension: 5,
    vacation: 2,
    training: 2,
  },
];

describe("applySavedMappingsForDecision (Task #1412)", () => {
  it("upserts prevailing_wage_rates for every saved mapping that matches a refreshed DOL feed name", async () => {
    // Saved mapping points the DOL feed name "Carpenter (Group 1)" at the
    // org's existing "Carpenter" classification — exactly the case the
    // override dialog produces today.
    await db.insert(dolClassificationMappings).values({
      organizationId: orgId,
      projectId,
      dolFeedName: "carpenter (group 1)",
      classificationId: carpenterClassId,
    });

    const out = await applySavedMappingsForDecision(orgId, DECISION, sampleRates(50));

    expect(out).toEqual({ projectsUpdated: 1, ratesUpserted: 1 });

    const rows = await db.select().from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.projectId, projectId),
        eq(prevailingWageRates.classificationId, carpenterClassId),
      ));
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(parseFloat(r.wageRate)).toBe(50);
    expect(parseFloat(r.fringeRate)).toBeCloseTo(12.5, 2);
    expect(parseFloat(r.totalRate)).toBeCloseTo(62.5, 2);
    expect(parseFloat(r.fringeHealthRate)).toBe(5);
    expect(parseFloat(r.fringePensionRate)).toBe(4);
    expect(parseFloat(r.fringeVacationRate)).toBe(2);
    expect(parseFloat(r.fringeTrainingRate)).toBe(1.5);
    expect(r.wageDecision).toBe(DECISION);
  });

  it("updates the existing prevailing_wage_rates row on a subsequent sync (idempotent + refreshed values)", async () => {
    await db.insert(dolClassificationMappings).values({
      organizationId: orgId,
      projectId,
      dolFeedName: "carpenter (group 1)",
      classificationId: carpenterClassId,
    });

    await applySavedMappingsForDecision(orgId, DECISION, sampleRates(50));
    // Second run with a higher base rate — the existing row should update,
    // not duplicate, so the (project, classification) unique stays clean.
    const out = await applySavedMappingsForDecision(orgId, DECISION, sampleRates(55));
    expect(out).toEqual({ projectsUpdated: 1, ratesUpserted: 1 });

    const rows = await db.select().from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.projectId, projectId),
        eq(prevailingWageRates.classificationId, carpenterClassId),
      ));
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].wageRate)).toBe(55);
    expect(parseFloat(rows[0].totalRate)).toBeCloseTo(67.5, 2);
  });

  it("ignores mappings on projects that don't reference this wage decision", async () => {
    // Mapping lives on a project keyed to a DIFFERENT wage decision; the
    // sync for `DECISION` must leave it untouched.
    await db.insert(dolClassificationMappings).values({
      organizationId: orgId,
      projectId: otherProjectId,
      dolFeedName: "carpenter (group 1)",
      classificationId: carpenterClassId,
    });

    const out = await applySavedMappingsForDecision(orgId, DECISION, sampleRates(50));
    expect(out).toEqual({ projectsUpdated: 0, ratesUpserted: 0 });

    const rows = await db.select().from(prevailingWageRates)
      .where(eq(prevailingWageRates.organizationId, orgId));
    expect(rows).toHaveLength(0);
  });

  it("skips mappings whose feed name is not present in the refreshed payload", async () => {
    await db.insert(dolClassificationMappings).values([
      {
        organizationId: orgId,
        projectId,
        dolFeedName: "carpenter (group 1)",
        classificationId: carpenterClassId,
      },
      {
        organizationId: orgId,
        projectId,
        dolFeedName: "boilermaker", // not in the refreshed payload
        classificationId: ironworkerClassId,
      },
    ]);

    const out = await applySavedMappingsForDecision(orgId, DECISION, sampleRates(50));
    expect(out).toEqual({ projectsUpdated: 1, ratesUpserted: 1 });

    const rows = await db.select().from(prevailingWageRates)
      .where(eq(prevailingWageRates.organizationId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0].classificationId).toBe(carpenterClassId);
  });
});
