// Task #2455 — Coverage for the standalone takeoff AI Estimator
// ingestion hooks wired into server/standaloneTakeoffRoutes.ts:
//
//   POST   /api/takeoff/standalone           → indexStandaloneTakeoffSafe
//   PATCH  /api/takeoff/standalone/:id       → indexStandaloneTakeoffSafe
//   POST   /api/takeoff/standalone/:id/tags  → emitLibraryAssignmentSamplesSafe
//
// The fire-and-forget *Safe wrappers don't await, so each test polls the
// downstream tables until the side effect has landed (with a generous
// timeout). We also exercise the underlying functions directly to keep
// the assertions tight where the route returns before the hook resolves.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  standaloneTakeoffs,
  takeoffSheets,
  takeoffMeasurements,
  aiEstimatorKnowledgeIndex,
  aiEstimatorLearnedRates,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import {
  indexStandaloneTakeoff,
  emitLibraryAssignmentSamplesForTakeoff,
} from "../services/aiEstimator/standaloneIngestion";
import { retrieveContext } from "../services/aiEstimator/retrieval";

const PREFIX = "__standalone_ingest__";

let app: Express;
let orgId: string;
let userId: string;
let userToken: string;
let bidId: string;

async function cleanup(): Promise<void> {
  await db
    .execute(
      sql`DELETE FROM ai_estimator_rate_samples WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`,
    )
    .catch(() => {});
  await db
    .execute(
      sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`,
    )
    .catch(() => {});
  await db
    .execute(
      sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`,
    )
    .catch(() => {});
  // Bids/standalone takeoffs cascade into their children.
  await db
    .execute(
      sql`DELETE FROM bids WHERE gc_organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`,
    )
    .catch(() => {});
  await db
    .execute(
      sql`DELETE FROM standalone_takeoffs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`,
    )
    .catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  { timeoutMs = 5_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Standalone Ingest Org",
      slug: `${PREFIX}org-${stamp}`,
      tradeType: "CONCRETE",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}user-${stamp}@test.local`,
      passwordHash,
      firstName: "Standalone",
      lastName: "Tester",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  userId = user.id;
  userToken = generateToken(user.id, user.tokenVersion ?? 0);

  const [bid] = await db
    .insert(bids)
    .values({
      name: "Concrete Plaza Bid",
      code: `${PREFIX}bid-${stamp}`,
      clientName: "Acme Plaza",
      gcOrganizationId: orgId,
      status: "DRAFT",
    })
    .returning();
  bidId = bid.id;

  const standaloneTakeoffRoutes = (await import("../standaloneTakeoffRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(standaloneTakeoffRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

function authCookie(token: string) {
  return [`auth_token=${token}`];
}

async function createSheetWithMeasurements(
  takeoffId: string,
  measurements: Array<{
    label: string;
    type: "LINEAR" | "AREA" | "VOLUME" | "COUNT";
    quantity: number;
    unitCost: number | null;
    costCodeId: string | null;
  }>,
): Promise<string> {
  const [sheet] = await db
    .insert(takeoffSheets)
    .values({
      standaloneTakeoffId: takeoffId,
      imageUrl: "https://example.invalid/sheet.png",
      sheetIndex: 0,
      sheetName: "Sheet 1",
    })
    .returning();
  for (const m of measurements) {
    await db.insert(takeoffMeasurements).values({
      sheetId: sheet.id,
      type: m.type,
      label: m.label,
      points: "[]",
      computedLengthFt: m.type === "LINEAR" ? m.quantity : null,
      computedAreaFt2: m.type === "AREA" ? m.quantity : null,
      computedVolumeCy: m.type === "VOLUME" ? m.quantity : null,
      count: m.type === "COUNT" ? m.quantity : null,
      unitCost: m.unitCost,
      costCodeId: m.costCodeId,
    });
  }
  return sheet.id;
}

describe("POST /api/takeoff/standalone — indexes a standalone_takeoff knowledge row", () => {
  it("creates the takeoff and writes a sourceType='standalone_takeoff' row", async () => {
    const res = await request(app)
      .post("/api/takeoff/standalone")
      .set("Cookie", authCookie(userToken))
      .send({
        title: "Plaza Curb & Gutter",
        tradeType: "CONCRETE",
        clientName: "Acme Plaza",
        notes: "speculative pre-bid takeoff",
      });
    expect(res.status).toBe(201);
    const takeoffId: string = res.body.id;
    expect(takeoffId).toBeTruthy();

    const row = await waitFor(async () => {
      const [r] = await db
        .select()
        .from(aiEstimatorKnowledgeIndex)
        .where(
          and(
            eq(aiEstimatorKnowledgeIndex.organizationId, orgId),
            eq(aiEstimatorKnowledgeIndex.sourceType, "standalone_takeoff"),
            eq(aiEstimatorKnowledgeIndex.sourceId, takeoffId),
          ),
        )
        .limit(1);
      return r ?? null;
    });
    expect(row.title).toContain("Plaza Curb & Gutter");
    expect(row.tradeType).toBe("CONCRETE");
    expect(row.tags).toEqual(expect.arrayContaining(["CONCRETE", "standalone_takeoff"]));
  });
});

describe("PATCH /api/takeoff/standalone/:id — re-indexes the knowledge row", () => {
  it("refreshes the snippet/title after the user edits the takeoff", async () => {
    const create = await request(app)
      .post("/api/takeoff/standalone")
      .set("Cookie", authCookie(userToken))
      .send({ title: "Initial Title", tradeType: "CONCRETE" });
    expect(create.status).toBe(201);
    const takeoffId: string = create.body.id;

    // Wait for the initial index pass to land.
    await waitFor(async () => {
      const [r] = await db
        .select({ title: aiEstimatorKnowledgeIndex.title })
        .from(aiEstimatorKnowledgeIndex)
        .where(
          and(
            eq(aiEstimatorKnowledgeIndex.sourceType, "standalone_takeoff"),
            eq(aiEstimatorKnowledgeIndex.sourceId, takeoffId),
          ),
        )
        .limit(1);
      return r?.title?.includes("Initial Title") ? r : null;
    });

    const patch = await request(app)
      .patch(`/api/takeoff/standalone/${takeoffId}`)
      .set("Cookie", authCookie(userToken))
      .send({ title: "Renamed Plaza Takeoff", notes: "updated notes" });
    expect(patch.status).toBe(200);

    const updated = await waitFor(async () => {
      const [r] = await db
        .select()
        .from(aiEstimatorKnowledgeIndex)
        .where(
          and(
            eq(aiEstimatorKnowledgeIndex.sourceType, "standalone_takeoff"),
            eq(aiEstimatorKnowledgeIndex.sourceId, takeoffId),
          ),
        )
        .limit(1);
      return r?.title?.includes("Renamed Plaza Takeoff") ? r : null;
    });
    expect(updated.contentSnippet).toContain("updated notes");
  });
});

describe("POST /api/takeoff/standalone/:id/tags — emits library_assignment samples for costed measurements", () => {
  it("records one sample per costed measurement and skips uncosted ones", async () => {
    // Seed a takeoff via the route so the row+initial index exist.
    const create = await request(app)
      .post("/api/takeoff/standalone")
      .set("Cookie", authCookie(userToken))
      .send({ title: "Library Source Takeoff", tradeType: "CONCRETE" });
    expect(create.status).toBe(201);
    const takeoffId: string = create.body.id;

    // Two costed measurements (different cost codes) + one uncosted +
    // one with no cost code → only the first two should produce samples.
    await createSheetWithMeasurements(takeoffId, [
      { label: "Curb LF", type: "LINEAR", quantity: 240, unitCost: 32.5, costCodeId: "CC-CURB" },
      { label: "Slab CY", type: "VOLUME", quantity: 18, unitCost: 410, costCodeId: "CC-SLAB" },
      { label: "Sidewalk SF (uncosted)", type: "AREA", quantity: 1200, unitCost: null, costCodeId: "CC-SIDEWALK" },
      { label: "Bollard EA (no cost code)", type: "COUNT", quantity: 6, unitCost: 250, costCodeId: null },
    ]);

    // Drive the hook directly so we can assert on its return value (the
    // route's *Safe wrapper is fire-and-forget).
    const written = await emitLibraryAssignmentSamplesForTakeoff(takeoffId, { bidId });
    expect(written).toBe(2);

    const rows = await db
      .select()
      .from(aiEstimatorLearnedRates)
      .where(eq(aiEstimatorLearnedRates.organizationId, orgId));
    const byCode = new Map(rows.map((r) => [r.costCode, r]));
    expect(byCode.get("CC-CURB")?.lastSourceType).toBe("library_assignment");
    expect(byCode.get("CC-CURB")?.unit).toBe("LF");
    expect(Number(byCode.get("CC-CURB")?.meanValue)).toBeCloseTo(32.5, 4);
    expect(byCode.get("CC-SLAB")?.unit).toBe("CY");
    expect(Number(byCode.get("CC-SLAB")?.meanValue)).toBeCloseTo(410, 4);
    // Uncosted / no-cost-code rows must not have produced learned-rate rows.
    expect(byCode.get("CC-SIDEWALK")).toBeUndefined();

    // Re-running is additive (each call appends another sample).
    const written2 = await emitLibraryAssignmentSamplesForTakeoff(takeoffId, { bidId });
    expect(written2).toBe(2);
    const [curbAfter] = await db
      .select()
      .from(aiEstimatorLearnedRates)
      .where(
        and(
          eq(aiEstimatorLearnedRates.organizationId, orgId),
          eq(aiEstimatorLearnedRates.costCode, "CC-CURB"),
        ),
      );
    expect(curbAfter.sampleSize).toBe(2);

  });

  it("the POST /tags route itself fires emitLibraryAssignmentSamplesSafe", async () => {
    // Use a fresh takeoff with a single costed measurement so the only
    // possible source of a CC-ROUTE-WIRING learned-rate row is the
    // route-driven hook — direct ingestion is NEVER called in this test.
    const create = await request(app)
      .post("/api/takeoff/standalone")
      .set("Cookie", authCookie(userToken))
      .send({ title: "Route Wiring Takeoff", tradeType: "CONCRETE" });
    expect(create.status).toBe(201);
    const takeoffId: string = create.body.id;
    await createSheetWithMeasurements(takeoffId, [
      { label: "Curb LF (route wiring)", type: "LINEAR", quantity: 100, unitCost: 27.75, costCodeId: "CC-ROUTE-WIRING" },
    ]);

    // Pre-condition: no learned-rate row for this brand-new cost code.
    const before = await db
      .select()
      .from(aiEstimatorLearnedRates)
      .where(
        and(
          eq(aiEstimatorLearnedRates.organizationId, orgId),
          eq(aiEstimatorLearnedRates.costCode, "CC-ROUTE-WIRING"),
        ),
      );
    expect(before).toHaveLength(0);

    const tagRes = await request(app)
      .post(`/api/takeoff/standalone/${takeoffId}/tags`)
      .set("Cookie", authCookie(userToken))
      .send({ bidId });
    expect([200, 201]).toContain(tagRes.status);

    // Post-condition: the fire-and-forget hook must have produced a
    // library_assignment-sourced row for this measurement's cost code.
    const after = await waitFor(async () => {
      const [r] = await db
        .select()
        .from(aiEstimatorLearnedRates)
        .where(
          and(
            eq(aiEstimatorLearnedRates.organizationId, orgId),
            eq(aiEstimatorLearnedRates.costCode, "CC-ROUTE-WIRING"),
          ),
        )
        .limit(1);
      return r ?? null;
    });
    expect(after.lastSourceType).toBe("library_assignment");
    expect(after.unit).toBe("LF");
    expect(after.sampleSize).toBe(1);
    expect(Number(after.meanValue)).toBeCloseTo(27.75, 4);
  });

  it("no-ops when the takeoff has no costed measurements", async () => {
    const create = await request(app)
      .post("/api/takeoff/standalone")
      .set("Cookie", authCookie(userToken))
      .send({ title: "Empty Library Takeoff", tradeType: "CONCRETE" });
    const takeoffId: string = create.body.id;
    await createSheetWithMeasurements(takeoffId, [
      { label: "Just a sketch", type: "LINEAR", quantity: 50, unitCost: null, costCodeId: "CC-SKETCH" },
    ]);
    const written = await emitLibraryAssignmentSamplesForTakeoff(takeoffId, { bidId });
    expect(written).toBe(0);
  });
});

describe("retrieveContext surfaces standalone takeoff rows for similar trades", () => {
  it("returns the standalone_takeoff and takeoff_measurement rows when the org/trade matches", async () => {
    // Seed a takeoff + measurement and run indexing directly so the
    // assertion isn't racing the fire-and-forget wrapper.
    const [takeoff] = await db
      .insert(standaloneTakeoffs)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        title: "Retrieval Coverage Takeoff",
        tradeType: "CONCRETE",
        clientName: "Retrieval Client",
        notes: "Decorative stamped concrete plaza demo.",
      })
      .returning();
    await createSheetWithMeasurements(takeoff.id, [
      { label: "Stamped slab area", type: "AREA", quantity: 850, unitCost: 14.25, costCodeId: "CC-STAMPED" },
    ]);
    await indexStandaloneTakeoff(takeoff.id);

    const rows = await retrieveContext({
      organizationId: orgId,
      query: "stamped",
      limit: 25,
    });
    const sourceTypes = new Set(rows.map((r) => r.sourceType));
    expect(sourceTypes.has("standalone_takeoff")).toBe(true);
    expect(sourceTypes.has("takeoff_measurement")).toBe(true);

    const standaloneRow = rows.find(
      (r) => r.sourceType === "standalone_takeoff" && r.sourceId === takeoff.id,
    );
    expect(standaloneRow?.tradeType).toBe("CONCRETE");
    expect(standaloneRow?.title).toContain("Retrieval Coverage Takeoff");

    const measurementRow = rows.find(
      (r) => r.sourceType === "takeoff_measurement" && r.title.includes("Stamped slab area"),
    );
    expect(measurementRow).toBeDefined();
    expect(measurementRow?.tradeType).toBe("CONCRETE");
  });
});
