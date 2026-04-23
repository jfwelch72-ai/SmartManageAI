// Task #1357 — Integration tests for GET /api/swppp-inspections/summary
// (added in task #1355). The aggregate must mirror the client-side
// reducer in `client/src/pages/swppp-inspections.tsx` exactly:
//   * a row counts only when `deficienciesFound` or `correctiveActions`
//     is non-empty after trimming (whitespace-only rows are excluded),
//   * RESOLVED rows never count,
//   * "open" means unresolved with corrective fields set and either no
//     due date or a due date >= today,
//   * "overdue" means unresolved with corrective fields set and a due
//     date < today, and `maxDaysOverdue` is the largest gap in days,
//   * results are scoped to the caller's organization.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql } from "drizzle-orm";

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

const PREFIX = "__swppp_sum__";

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
      name: `SWPPP Sum Org ${label}`,
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
      lastName: `Sum-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `SWPPP Sum Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}`,
      clientName: `SWPPP Sum Client ${label}`,
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

function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

interface InsertOpts {
  orgId: string;
  projectId: string;
  inspectionDate?: string;
  deficienciesFound?: string | null;
  correctiveActions?: string | null;
  correctiveActionDueDate?: string | null;
  status?: string;
}

async function insertInspection(opts: InsertOpts): Promise<string> {
  const [row] = await db
    .insert(swpppInspections)
    .values({
      organizationId: opts.orgId,
      projectId: opts.projectId,
      inspectionDate: opts.inspectionDate ?? isoDate(-30),
      inspectionType: "ROUTINE",
      deficienciesFound: opts.deficienciesFound ?? null,
      correctiveActions: opts.correctiveActions ?? null,
      correctiveActionDueDate: opts.correctiveActionDueDate ?? null,
      status: opts.status ?? "OPEN",
    })
    .returning();
  return row.id;
}

async function clearTenantInspections(orgId: string): Promise<void> {
  await db.delete(swpppInspections).where(
    sql`${swpppInspections.organizationId} = ${orgId}`,
  );
}

describe("GET /api/swppp-inspections/summary — task #1357", () => {
  it("returns zeros when the tenant has no inspections", async () => {
    await clearTenantInspections(tenantA.orgId);

    const res = await request(app)
      .get("/api/swppp-inspections/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openCount: 0, overdueCount: 0, maxDaysOverdue: 0 });
  });

  it("excludes rows without corrective actions and rows with whitespace-only corrective fields", async () => {
    await clearTenantInspections(tenantA.orgId);

    // Both deficiency/corrective fields null — must not count.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: null,
      correctiveActions: null,
      correctiveActionDueDate: isoDate(-5),
    });
    // Whitespace-only fields — must not count. Mirrors the client
    // `.trim()` reducer for the common form-submission case where the
    // user typed (and then deleted) into the textareas, leaving only
    // spaces. (Note: server-side TRIM() strips spaces; the client's
    // JS .trim() also strips tabs/newlines, so we deliberately use
    // spaces here to assert the contract both sides agree on.)
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "   ",
      correctiveActions: "     ",
      correctiveActionDueDate: isoDate(-10),
    });

    const res = await request(app)
      .get("/api/swppp-inspections/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openCount: 0, overdueCount: 0, maxDaysOverdue: 0 });
  });

  it("excludes RESOLVED rows even when they have corrective actions and a past due date", async () => {
    await clearTenantInspections(tenantA.orgId);

    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "Silt fence damaged",
      correctiveActions: "Repaired",
      correctiveActionDueDate: isoDate(-7),
      status: "RESOLVED",
    });

    const res = await request(app)
      .get("/api/swppp-inspections/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openCount: 0, overdueCount: 0, maxDaysOverdue: 0 });
  });

  it("counts open-not-yet-due rows toward openCount (future due date and null due date)", async () => {
    await clearTenantInspections(tenantA.orgId);

    // Future due date — open, not overdue.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "Inlet protection torn",
      correctiveActionDueDate: isoDate(5),
    });
    // Due today — boundary: due date is NOT less than today, so open.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      correctiveActions: "Replace gravel bag",
      correctiveActionDueDate: isoDate(0),
    });
    // Null due date with corrective fields — counted as open.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "Discharge near outlet",
      correctiveActionDueDate: null,
    });

    const res = await request(app)
      .get("/api/swppp-inspections/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.openCount).toBe(3);
    expect(res.body.overdueCount).toBe(0);
    expect(res.body.maxDaysOverdue).toBe(0);
  });

  it("counts overdue rows and returns the largest days-overdue gap", async () => {
    await clearTenantInspections(tenantA.orgId);

    // Overdue by 3 days.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "BMP failed",
      correctiveActionDueDate: isoDate(-3),
    });
    // Overdue by 14 days — should drive maxDaysOverdue.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      correctiveActions: "Re-stabilize slope",
      correctiveActionDueDate: isoDate(-14),
    });
    // Open (future) row — should not affect overdue counters but bumps openCount.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "Minor sediment tracking",
      correctiveActionDueDate: isoDate(7),
    });
    // RESOLVED but very overdue — must be ignored entirely.
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "Old finding",
      correctiveActionDueDate: isoDate(-90),
      status: "RESOLVED",
    });

    const res = await request(app)
      .get("/api/swppp-inspections/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.openCount).toBe(1);
    expect(res.body.overdueCount).toBe(2);
    expect(res.body.maxDaysOverdue).toBe(14);
  });

  it("isolates results per tenant — tenant B never sees tenant A's inspections", async () => {
    await clearTenantInspections(tenantA.orgId);
    await clearTenantInspections(tenantB.orgId);

    // Tenant A: 1 open + 1 overdue (5 days).
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "A open",
      correctiveActionDueDate: isoDate(10),
    });
    await insertInspection({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      deficienciesFound: "A overdue",
      correctiveActionDueDate: isoDate(-5),
    });

    // Tenant B: 2 open, 1 overdue (20 days).
    await insertInspection({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      deficienciesFound: "B open 1",
      correctiveActionDueDate: isoDate(2),
    });
    await insertInspection({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      correctiveActions: "B open 2",
      correctiveActionDueDate: null,
    });
    await insertInspection({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      deficienciesFound: "B overdue",
      correctiveActionDueDate: isoDate(-20),
    });

    const [resA, resB] = await Promise.all([
      request(app).get("/api/swppp-inspections/summary").set("Cookie", authCookie(tenantA.token)),
      request(app).get("/api/swppp-inspections/summary").set("Cookie", authCookie(tenantB.token)),
    ]);

    expect(resA.status).toBe(200);
    expect(resA.body).toEqual({ openCount: 1, overdueCount: 1, maxDaysOverdue: 5 });

    expect(resB.status).toBe(200);
    expect(resB.body).toEqual({ openCount: 2, overdueCount: 1, maxDaysOverdue: 20 });
  });
});
