// Task #1445 — Cover the new DOL mapping management endpoints introduced
// in Task #1411 (`GET / PATCH / DELETE /api/labor-rates/dol-classification-mappings`).
// Without this spec a future refactor could silently:
//   * leak another tenant's mappings into the list response,
//   * accept a mapping id from a different org on PATCH/DELETE,
//   * accept a target classification from a different org on PATCH,
//   * leave a stale mapping in place after DELETE so the next sync still
//     auto-applies the old (project, classification) pair instead of
//     falling back to the empty-mapping path that lets PMs re-pick.
//
// The handler under test mirrors `prevailing-wage-dol-feed-override.test.ts`
// (Task #1396) for the bootstrap pattern (org/user/project/classifications
// + Express app wired to the labor-rate router) and exercises the post-
// delete fallback against `applySavedMappingsForDecision` — the same seam
// the scheduled DOL sync calls. That keeps the assertion focused on the
// observable contract ("after delete, this mapping no longer steers the
// sync") without dragging the SAM.gov network surface into the test.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
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
import { generateToken, authMiddleware } from "../auth";
import {
  applySavedMappingsForDecision,
  type DavisBaconWageRate,
} from "../integrations/providers/dol_davis_bacon/sync";

const PREFIX = "__dolmapmgmt__";
const DECISION = "CA20260099";

vi.mock("../integrations/providers/dol_davis_bacon/sync", async (orig) => {
  const actual = await orig<typeof import("../integrations/providers/dol_davis_bacon/sync")>();
  return {
    ...actual,
    queueWageDecisionSync: vi.fn(async () => ({ status: "queued" as const })),
  };
});

let app: Express;

// Org A — the "PM's own" tenant.
let orgAId: string;
let projectAId: string;
let carpenterAId: string;
let ironworkerAId: string;
let tokenA: string;

// Org B — used to prove the routes never cross tenant boundaries.
let orgBId: string;
let projectBId: string;
let carpenterBId: string;
let tokenB: string;

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

async function makeOrg(label: string): Promise<{ orgId: string; token: string }> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db.insert(organizations).values({
    name: `DOL Map Mgmt ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "PM",
    lastName: label,
    role: "MANAGER",
    organizationId: org.id,
    isActive: true,
  }).returning();
  return { orgId: org.id, token: generateToken(user.id, user.tokenVersion ?? 0) };
}

beforeAll(async () => {
  await cleanup();

  ({ orgId: orgAId, token: tokenA } = await makeOrg("a"));
  ({ orgId: orgBId, token: tokenB } = await makeOrg("b"));

  const [projA] = await db.insert(projects).values({
    name: "Org A Project",
    code: `${PREFIX}PA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Client A",
    gcOrganizationId: orgAId,
    status: "ACTIVE",
    wageDecision: DECISION,
  }).returning();
  projectAId = projA.id;

  const [projB] = await db.insert(projects).values({
    name: "Org B Project",
    code: `${PREFIX}PB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Client B",
    gcOrganizationId: orgBId,
    status: "ACTIVE",
    wageDecision: DECISION,
  }).returning();
  projectBId = projB.id;

  const [carpA] = await db.insert(jobClassifications).values({
    organizationId: orgAId, name: "Carpenter",
  }).returning();
  carpenterAId = carpA.id;
  const [ironA] = await db.insert(jobClassifications).values({
    organizationId: orgAId, name: "Ironworker",
  }).returning();
  ironworkerAId = ironA.id;
  const [carpB] = await db.insert(jobClassifications).values({
    organizationId: orgBId, name: "Carpenter",
  }).returning();
  carpenterBId = carpB.id;

  const laborRateRoutes = (await import("../laborRateRoutes")).default;
  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/labor-rates", laborRateRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(async () => {
  await db.delete(prevailingWageRates).where(inArray(prevailingWageRates.organizationId, [orgAId, orgBId]));
  await db.delete(dolClassificationMappings).where(inArray(dolClassificationMappings.organizationId, [orgAId, orgBId]));
});

const cookieFor = (t: string) => `auth_token=${t}`;

async function seedMapping(opts: {
  organizationId: string;
  projectId: string;
  dolFeedName: string;
  classificationId: string;
}): Promise<string> {
  const [row] = await db.insert(dolClassificationMappings).values(opts).returning();
  return row.id;
}

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
];

describe("DOL classification mappings management endpoints (Task #1411 / #1445)", () => {
  describe("GET /api/labor-rates/dol-classification-mappings", () => {
    it("lists only the caller's mappings for the requested project, with the joined classification", async () => {
      await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });
      // Another mapping in the SAME org but on a different (fake) project
      // would normally be filtered out by projectId — exercise the
      // tenant-scoped Org B mapping instead which must never appear.
      await seedMapping({
        organizationId: orgBId, projectId: projectBId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterBId,
      });

      const res = await request(app)
        .get(`/api/labor-rates/dol-classification-mappings?projectId=${projectAId}`)
        .set("Cookie", cookieFor(tokenA))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      const [row] = res.body;
      expect(row.projectId).toBe(projectAId);
      expect(row.dolFeedName).toBe("carpenter (group 1)");
      expect(row.classificationId).toBe(carpenterAId);
      expect(row.classification).toMatchObject({ id: carpenterAId, name: "Carpenter" });
    });

    it("returns 400 when projectId is missing", async () => {
      const res = await request(app)
        .get("/api/labor-rates/dol-classification-mappings")
        .set("Cookie", cookieFor(tokenA))
        .expect(400);
      expect(res.body.error).toMatch(/projectId/i);
    });

    it("returns 404 when the requested project belongs to another org", async () => {
      await request(app)
        .get(`/api/labor-rates/dol-classification-mappings?projectId=${projectBId}`)
        .set("Cookie", cookieFor(tokenA))
        .expect(404);
    });
  });

  describe("PATCH /api/labor-rates/dol-classification-mappings/:id", () => {
    it("re-maps a mapping the PM owns to a different classification in the same org", async () => {
      const mappingId = await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });

      const res = await request(app)
        .patch(`/api/labor-rates/dol-classification-mappings/${mappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .send({ classificationId: ironworkerAId })
        .expect(200);

      expect(res.body.id).toBe(mappingId);
      expect(res.body.classificationId).toBe(ironworkerAId);

      const [persisted] = await db.select().from(dolClassificationMappings)
        .where(eq(dolClassificationMappings.id, mappingId));
      expect(persisted.classificationId).toBe(ironworkerAId);
    });

    it("rejects a missing classificationId payload with 400", async () => {
      const mappingId = await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });
      await request(app)
        .patch(`/api/labor-rates/dol-classification-mappings/${mappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .send({})
        .expect(400);
    });

    it("returns 404 when the mapping id belongs to another org (tenant isolation)", async () => {
      const otherMappingId = await seedMapping({
        organizationId: orgBId, projectId: projectBId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterBId,
      });

      await request(app)
        .patch(`/api/labor-rates/dol-classification-mappings/${otherMappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .send({ classificationId: ironworkerAId })
        .expect(404);

      // The cross-tenant row must be untouched.
      const [persisted] = await db.select().from(dolClassificationMappings)
        .where(eq(dolClassificationMappings.id, otherMappingId));
      expect(persisted.classificationId).toBe(carpenterBId);
    });

    it("returns 404 when the target classification belongs to another org", async () => {
      const mappingId = await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });

      await request(app)
        .patch(`/api/labor-rates/dol-classification-mappings/${mappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .send({ classificationId: carpenterBId })
        .expect(404);

      // The mapping must NOT have been re-pointed at a foreign classification.
      const [persisted] = await db.select().from(dolClassificationMappings)
        .where(eq(dolClassificationMappings.id, mappingId));
      expect(persisted.classificationId).toBe(carpenterAId);
    });
  });

  describe("DELETE /api/labor-rates/dol-classification-mappings/:id", () => {
    it("deletes a mapping the PM owns and returns success", async () => {
      const mappingId = await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });

      await request(app)
        .delete(`/api/labor-rates/dol-classification-mappings/${mappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .expect(200);

      const after = await db.select().from(dolClassificationMappings)
        .where(eq(dolClassificationMappings.id, mappingId));
      expect(after).toHaveLength(0);
    });

    it("returns 404 (and leaves the row intact) when the mapping id belongs to another org", async () => {
      const otherMappingId = await seedMapping({
        organizationId: orgBId, projectId: projectBId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterBId,
      });

      await request(app)
        .delete(`/api/labor-rates/dol-classification-mappings/${otherMappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .expect(404);

      const after = await db.select().from(dolClassificationMappings)
        .where(eq(dolClassificationMappings.id, otherMappingId));
      expect(after).toHaveLength(1);
    });

    // Done-criteria: "Deleting a mapping causes the next sync (or summary
    // fetch) to fall back to name-match / create-new". We exercise this
    // against `applySavedMappingsForDecision`, which is the seam the
    // scheduled DOL sync calls. With the mapping in place a sync writes a
    // prevailing_wage_rates row; after DELETE the same sync must NOT
    // auto-apply the old (project, classification) pair, leaving the PM's
    // re-mapping path (name-match / create-new) free to take over.
    it("after deletion, the next sync no longer auto-applies the old mapping (fallback path)", async () => {
      const mappingId = await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });

      // Before delete: sync writes the prevailing_wage_rates row using the
      // saved mapping.
      const before = await applySavedMappingsForDecision(orgAId, DECISION, sampleRates(50));
      expect(before).toEqual({ projectsUpdated: 1, ratesUpserted: 1 });
      const beforeRows = await db.select().from(prevailingWageRates)
        .where(and(
          eq(prevailingWageRates.projectId, projectAId),
          eq(prevailingWageRates.classificationId, carpenterAId),
        ));
      expect(beforeRows).toHaveLength(1);

      // Wipe prevailing wage rates so we're observing only what the next
      // sync writes — not what was left over from the pre-delete run.
      await db.delete(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgAId));

      await request(app)
        .delete(`/api/labor-rates/dol-classification-mappings/${mappingId}`)
        .set("Cookie", cookieFor(tokenA))
        .expect(200);

      // After delete: the saved-mapping sync seam writes nothing for this
      // feed name, so a future PM action (re-pick via the override dialog
      // or accept the create-new prompt) is what will reattach the rate.
      const after = await applySavedMappingsForDecision(orgAId, DECISION, sampleRates(55));
      expect(after).toEqual({ projectsUpdated: 0, ratesUpserted: 0 });

      const afterRows = await db.select().from(prevailingWageRates)
        .where(eq(prevailingWageRates.organizationId, orgAId));
      expect(afterRows).toHaveLength(0);
    });
  });

  describe("auth", () => {
    it("rejects unauthenticated callers with 401", async () => {
      await request(app)
        .get(`/api/labor-rates/dol-classification-mappings?projectId=${projectAId}`)
        .expect(401);
    });

    it("Org B's PM cannot list Org A's mappings even by guessing the project id", async () => {
      await seedMapping({
        organizationId: orgAId, projectId: projectAId,
        dolFeedName: "carpenter (group 1)", classificationId: carpenterAId,
      });
      await request(app)
        .get(`/api/labor-rates/dol-classification-mappings?projectId=${projectAId}`)
        .set("Cookie", cookieFor(tokenB))
        .expect(404);
    });
  });
});
