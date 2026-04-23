// Task #1175 — Integration tests for the SWPPP resolve / reopen flow.
//
// Guards covered:
//   * POST /api/swppp-inspections/:id/resolve flips status to RESOLVED and
//     stamps resolvedAt / resolvedById, and writes a RESOLVE audit row.
//   * POST /api/swppp-inspections/:id/reopen flips status back to OPEN and
//     clears resolvedAt / resolvedById, and writes a REOPEN audit row.
//   * Cross-tenant resolve / reopen attempts return 404 (the row is
//     hidden by the org scope, never mutated).
//   * PATCH /api/swppp-inspections/:id silently strips status / resolvedAt /
//     resolvedById from the request body so clients can't forge resolution.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  swpppInspections,
  auditLog,
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setAllFeatureFlags } from "../services/featureFlagService";

const PREFIX = "__swppp_rr__";

interface TenantCtx {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
}

let app: Express;
let tenantA: TenantCtx;
let tenantB: TenantCtx;

async function seedTenant(label: string): Promise<TenantCtx> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `SWPPP RR Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Swppp",
      lastName: `Admin-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `SWPPP RR Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}`,
      clientName: `SWPPP RR Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);

  return { orgId: org.id, userId: user.id, token, projectId: project.id };
}

interface IdRow { id: string }
interface ExecuteResult<T> { rows?: T[] }

async function cleanup(): Promise<void> {
  const orgs = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as ExecuteResult<IdRow>;
  const orgIds: string[] = orgs.rows?.map((r) => r.id) ?? [];
  const userRows = (await db.execute(
    sql`SELECT id FROM users WHERE email LIKE ${PREFIX + "%"}`,
  )) as unknown as ExecuteResult<IdRow>;
  const userIds: string[] = userRows.rows?.map((r) => r.id) ?? [];

  if (userIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.userId, userIds)).catch(() => {});
  }
  if (orgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();

  const dotRoutes = (await import("../dotRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(dotRoutes);

  [tenantA, tenantB] = await Promise.all([seedTenant("a"), seedTenant("b")]);

  const flags: FeatureFlagKey[] = ["SWPPP_INSPECTIONS"];
  await setAllFeatureFlags(
    tenantA.orgId,
    Object.fromEntries(flags.map((k) => [k, true])) as Record<FeatureFlagKey, boolean>,
  );
  await setAllFeatureFlags(
    tenantB.orgId,
    Object.fromEntries(flags.map((k) => [k, true])) as Record<FeatureFlagKey, boolean>,
  );
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

function authCookie(token: string): string {
  return `auth_token=${token}`;
}

async function createInspection(ctx: TenantCtx): Promise<string> {
  const res = await request(app)
    .post("/api/swppp-inspections")
    .set("Cookie", authCookie(ctx.token))
    .send({
      projectId: ctx.projectId,
      inspectionDate: "2026-04-22",
      inspectionType: "ROUTINE",
    });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe("OPEN");
  expect(res.body.resolvedAt).toBeFalsy();
  expect(res.body.resolvedById).toBeFalsy();
  return res.body.id as string;
}

async function loadInspection(id: string) {
  const [row] = await db
    .select()
    .from(swpppInspections)
    .where(eq(swpppInspections.id, id))
    .limit(1);
  return row;
}

async function countAuditRows(
  userId: string,
  entityId: string,
  action: string,
): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        eq(auditLog.entityType, "swppp_inspection"),
        eq(auditLog.entityId, entityId),
        eq(auditLog.action, action as "CREATE"),
      ),
    );
  return rows.length;
}

describe("SWPPP resolve / reopen flow — task #1175", () => {
  it("resolve flips status to RESOLVED, stamps resolvedAt/resolvedById, writes audit row", async () => {
    const id = await createInspection(tenantA);

    const res = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantA.token))
      .send({ resolutionNotes: "BMPs repaired, re-inspected" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
    expect(res.body.resolvedAt).toBeTruthy();
    expect(res.body.resolvedById).toBe(tenantA.userId);
    expect(res.body.resolutionNotes).toBe("BMPs repaired, re-inspected");

    const row = await loadInspection(id);
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.resolvedById).toBe(tenantA.userId);
    expect(row.correctiveActionCompletedAt).toBeInstanceOf(Date);

    expect(await countAuditRows(tenantA.userId, id, "RESOLVE")).toBe(1);
  });

  it("resolve is idempotent — second call returns the existing RESOLVED row without re-stamping", async () => {
    const id = await createInspection(tenantA);

    const first = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantA.token))
      .send({});
    expect(first.status).toBe(200);
    const firstResolvedAt = first.body.resolvedAt as string;
    expect(firstResolvedAt).toBeTruthy();

    const second = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantA.token))
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("RESOLVED");
    expect(second.body.resolvedAt).toBe(firstResolvedAt);

    expect(await countAuditRows(tenantA.userId, id, "RESOLVE")).toBe(1);
  });

  it("reopen flips status back to OPEN, clears resolvedAt/resolvedById, writes audit row", async () => {
    const id = await createInspection(tenantA);

    const resolveRes = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantA.token))
      .send({ resolutionNotes: "Fixed" });
    expect(resolveRes.status).toBe(200);

    const reopenRes = await request(app)
      .post(`/api/swppp-inspections/${id}/reopen`)
      .set("Cookie", authCookie(tenantA.token))
      .send({});
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.status).toBe("OPEN");
    expect(reopenRes.body.resolvedAt).toBeNull();
    expect(reopenRes.body.resolvedById).toBeNull();
    expect(reopenRes.body.resolutionNotes).toBeNull();

    const row = await loadInspection(id);
    expect(row.status).toBe("OPEN");
    expect(row.resolvedAt).toBeNull();
    expect(row.resolvedById).toBeNull();
    expect(row.resolutionNotes).toBeNull();
    expect(row.correctiveActionCompletedAt).toBeNull();

    expect(await countAuditRows(tenantA.userId, id, "REOPEN")).toBe(1);
  });

  it("reopen on an already-OPEN inspection is a no-op", async () => {
    const id = await createInspection(tenantA);

    const res = await request(app)
      .post(`/api/swppp-inspections/${id}/reopen`)
      .set("Cookie", authCookie(tenantA.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OPEN");

    expect(await countAuditRows(tenantA.userId, id, "REOPEN")).toBe(0);
  });

  it("rejects cross-tenant resolve attempts (404, no mutation)", async () => {
    const id = await createInspection(tenantA);

    const res = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantB.token))
      .send({ resolutionNotes: "should not work" });

    expect(res.status).toBe(404);

    const row = await loadInspection(id);
    expect(row.status).toBe("OPEN");
    expect(row.resolvedAt).toBeNull();
    expect(row.resolvedById).toBeNull();
    expect(await countAuditRows(tenantB.userId, id, "RESOLVE")).toBe(0);
  });

  it("rejects cross-tenant reopen attempts (404, no mutation)", async () => {
    const id = await createInspection(tenantA);

    const resolveRes = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantA.token))
      .send({});
    expect(resolveRes.status).toBe(200);

    const res = await request(app)
      .post(`/api/swppp-inspections/${id}/reopen`)
      .set("Cookie", authCookie(tenantB.token))
      .send({});

    expect(res.status).toBe(404);

    const row = await loadInspection(id);
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.resolvedById).toBe(tenantA.userId);
    expect(await countAuditRows(tenantB.userId, id, "REOPEN")).toBe(0);
  });

  it("PATCH cannot mutate status / resolvedAt / resolvedById even when the client sends them", async () => {
    const id = await createInspection(tenantA);

    const forgedResolvedAt = new Date("2020-01-01T00:00:00.000Z");
    const res = await request(app)
      .patch(`/api/swppp-inspections/${id}`)
      .set("Cookie", authCookie(tenantA.token))
      .send({
        notes: "legitimate edit",
        status: "RESOLVED",
        resolvedAt: forgedResolvedAt.toISOString(),
        resolvedById: tenantA.userId,
        resolutionNotes: "forged via PATCH",
      });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe("legitimate edit");
    expect(res.body.status).toBe("OPEN");
    expect(res.body.resolvedAt).toBeNull();
    expect(res.body.resolvedById).toBeNull();
    expect(res.body.resolutionNotes).toBeNull();

    const row = await loadInspection(id);
    expect(row.notes).toBe("legitimate edit");
    expect(row.status).toBe("OPEN");
    expect(row.resolvedAt).toBeNull();
    expect(row.resolvedById).toBeNull();
    expect(row.resolutionNotes).toBeNull();
  });

  it("PATCH cannot reopen an already-RESOLVED inspection by sending status=OPEN", async () => {
    const id = await createInspection(tenantA);

    const resolveRes = await request(app)
      .post(`/api/swppp-inspections/${id}/resolve`)
      .set("Cookie", authCookie(tenantA.token))
      .send({ resolutionNotes: "done" });
    expect(resolveRes.status).toBe(200);
    const resolvedAtIso = resolveRes.body.resolvedAt as string;

    const res = await request(app)
      .patch(`/api/swppp-inspections/${id}`)
      .set("Cookie", authCookie(tenantA.token))
      .send({
        status: "OPEN",
        resolvedAt: null,
        resolvedById: null,
        resolutionNotes: null,
        notes: "trying to forge a reopen",
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
    expect(res.body.resolvedAt).toBe(resolvedAtIso);
    expect(res.body.resolvedById).toBe(tenantA.userId);
    expect(res.body.resolutionNotes).toBe("done");
    expect(res.body.notes).toBe("trying to forge a reopen");
  });
});
