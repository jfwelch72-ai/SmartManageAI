// Task #1363 — Integration tests for the Safety Hub summary endpoints
// added in task #1358:
//   * GET /api/daily-inspector-reports/summary
//       - "unsigned" = status IN ('DRAFT','REVISED')
//       - "overdue"  = unsigned AND reportDate < CURRENT_DATE
//       - boundary: reportDate = CURRENT_DATE counts as unsigned (not overdue)
//   * GET /api/material-certifications/summary
//       - rows without expirationDate are excluded
//       - "expired"        = expirationDate < CURRENT_DATE
//       - "expiringSoon"   = CURRENT_DATE <= expirationDate <= CURRENT_DATE + 30 days
//       - boundary: expirationDate = CURRENT_DATE counts as expiringSoon (not expired)
//       - boundary: expirationDate = CURRENT_DATE + 30 days counts as expiringSoon
//
// Both endpoints must be strictly tenant-scoped, and a SUPER_ADMIN may
// target a specific org by passing ?organizationId=<orgId>.

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
  dailyInspectorReports,
  materialCertifications,
  auditLog,
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setAllFeatureFlags } from "../services/featureFlagService";

const PREFIX = "__safetyhub_sum__";

interface TenantCtx {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
}

let app: Express;
let tenantA: TenantCtx;
let tenantB: TenantCtx;
let superAdmin: { userId: string; token: string };

async function seedTenant(label: string): Promise<TenantCtx> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Safety Hub Sum Org ${label}`,
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
      firstName: "Safety",
      lastName: `Sum-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `Safety Hub Sum Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}`,
      clientName: `Safety Hub Sum Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);

  return { orgId: org.id, userId: user.id, token, projectId: project.id };
}

async function seedSuperAdmin(): Promise<{ userId: string; token: string }> {
  const slug = `${PREFIX}sa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Safety",
      lastName: "SuperAdmin",
      role: "SUPER_ADMIN",
      organizationId: null,
      isActive: true,
    })
    .returning();
  return { userId: user.id, token: generateToken(user.id, user.tokenVersion ?? 0) };
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

  [tenantA, tenantB, superAdmin] = await Promise.all([
    seedTenant("a"),
    seedTenant("b"),
    seedSuperAdmin(),
  ]);

  // Both summary routes sit behind org-scoped feature-flag gates
  // (DAILY_INSPECTOR_REPORTS for IDRs, BUY_AMERICA for material
  // certifications). Enable them for both seeded tenants so the
  // routes return their aggregate JSON instead of a 403 Feature
  // disabled response.
  const flags: FeatureFlagKey[] = ["DAILY_INSPECTOR_REPORTS", "BUY_AMERICA"];
  const flagMap = Object.fromEntries(flags.map((k) => [k, true])) as Record<FeatureFlagKey, boolean>;
  await Promise.all([
    setAllFeatureFlags(tenantA.orgId, flagMap),
    setAllFeatureFlags(tenantB.orgId, flagMap),
  ]);
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

// ============================================================================
// IDR helpers
// ============================================================================
interface IdrOpts {
  orgId: string;
  projectId: string;
  reportDate?: string;
  status?: "DRAFT" | "REVISED" | "SUBMITTED" | "APPROVED";
  reportNumber?: string;
}

async function insertIdr(opts: IdrOpts): Promise<string> {
  const [row] = await db
    .insert(dailyInspectorReports)
    .values({
      organizationId: opts.orgId,
      projectId: opts.projectId,
      reportDate: opts.reportDate ?? isoDate(-1),
      status: opts.status ?? "DRAFT",
      reportNumber:
        opts.reportNumber ??
        `${PREFIX}IDR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  return row.id;
}

async function clearTenantIdrs(orgId: string): Promise<void> {
  await db.delete(dailyInspectorReports).where(
    sql`${dailyInspectorReports.organizationId} = ${orgId}`,
  );
}

// ============================================================================
// Material Certification helpers
// ============================================================================
interface CertOpts {
  orgId: string;
  projectId: string;
  expirationDate?: string | null;
  description?: string;
}

async function insertCert(opts: CertOpts): Promise<string> {
  const [row] = await db
    .insert(materialCertifications)
    .values({
      organizationId: opts.orgId,
      projectId: opts.projectId,
      materialDescription:
        opts.description ?? `${PREFIX}cert-${Math.random().toString(36).slice(2, 8)}`,
      expirationDate: opts.expirationDate ?? null,
    })
    .returning();
  return row.id;
}

async function clearTenantCerts(orgId: string): Promise<void> {
  await db.delete(materialCertifications).where(
    sql`${materialCertifications.organizationId} = ${orgId}`,
  );
}

// ============================================================================
// IDR summary tests
// ============================================================================
describe("GET /api/daily-inspector-reports/summary — task #1363", () => {
  it("returns zeros when the tenant has no IDRs", async () => {
    await clearTenantIdrs(tenantA.orgId);

    const res = await request(app)
      .get("/api/daily-inspector-reports/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unsignedCount: 0, overdueCount: 0, maxDaysOverdue: 0 });
  });

  it("excludes SUBMITTED and APPROVED rows even if their reportDate is in the past", async () => {
    await clearTenantIdrs(tenantA.orgId);

    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-10),
      status: "SUBMITTED",
    });
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-30),
      status: "APPROVED",
    });

    const res = await request(app)
      .get("/api/daily-inspector-reports/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unsignedCount: 0, overdueCount: 0, maxDaysOverdue: 0 });
  });

  it("splits unsigned vs overdue: future + today are unsigned, past is overdue", async () => {
    await clearTenantIdrs(tenantA.orgId);

    // Today's report — unsigned, NOT overdue (boundary: reportDate is
    // not strictly less than CURRENT_DATE).
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(0),
      status: "DRAFT",
    });
    // Future-dated draft (rare but possible) — unsigned, not overdue.
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(2),
      status: "DRAFT",
    });
    // Yesterday's REVISED report — overdue by 1 day. REVISED counts as
    // unsigned because it has been kicked back for changes.
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-1),
      status: "REVISED",
    });
    // 12-day-old draft — overdue, drives maxDaysOverdue.
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-12),
      status: "DRAFT",
    });
    // SUBMITTED for the past — must be ignored entirely.
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-50),
      status: "SUBMITTED",
    });

    const res = await request(app)
      .get("/api/daily-inspector-reports/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.unsignedCount).toBe(2); // today + future
    expect(res.body.overdueCount).toBe(2); // -1d revised + -12d draft
    expect(res.body.maxDaysOverdue).toBe(12);
  });

  it("isolates results per tenant — tenant B never sees tenant A's IDRs", async () => {
    await clearTenantIdrs(tenantA.orgId);
    await clearTenantIdrs(tenantB.orgId);

    // Tenant A: 1 unsigned today, 1 overdue (5 days)
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(0),
      status: "DRAFT",
    });
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-5),
      status: "DRAFT",
    });

    // Tenant B: 1 unsigned future, 2 overdue (max 20 days)
    await insertIdr({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      reportDate: isoDate(3),
      status: "REVISED",
    });
    await insertIdr({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      reportDate: isoDate(-2),
      status: "DRAFT",
    });
    await insertIdr({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      reportDate: isoDate(-20),
      status: "DRAFT",
    });

    const [resA, resB] = await Promise.all([
      request(app)
        .get("/api/daily-inspector-reports/summary")
        .set("Cookie", authCookie(tenantA.token)),
      request(app)
        .get("/api/daily-inspector-reports/summary")
        .set("Cookie", authCookie(tenantB.token)),
    ]);

    expect(resA.status).toBe(200);
    expect(resA.body).toEqual({ unsignedCount: 1, overdueCount: 1, maxDaysOverdue: 5 });

    expect(resB.status).toBe(200);
    expect(resB.body).toEqual({ unsignedCount: 1, overdueCount: 2, maxDaysOverdue: 20 });
  });

  it("super-admin without ?organizationId returns zeros (no implicit cross-org aggregation)", async () => {
    await clearTenantIdrs(tenantA.orgId);
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-7),
      status: "DRAFT",
    });

    const res = await request(app)
      .get("/api/daily-inspector-reports/summary")
      .set("Cookie", authCookie(superAdmin.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unsignedCount: 0, overdueCount: 0, maxDaysOverdue: 0 });
  });

  it("super-admin with ?organizationId targets exactly that org", async () => {
    await clearTenantIdrs(tenantA.orgId);
    await clearTenantIdrs(tenantB.orgId);

    // Tenant A: 1 overdue (3 days). Tenant B: 1 overdue (40 days) —
    // would dominate maxDaysOverdue if the super-admin were leaking
    // across orgs.
    await insertIdr({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      reportDate: isoDate(-3),
      status: "DRAFT",
    });
    await insertIdr({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      reportDate: isoDate(-40),
      status: "DRAFT",
    });

    const res = await request(app)
      .get("/api/daily-inspector-reports/summary")
      .query({ organizationId: tenantA.orgId })
      .set("Cookie", authCookie(superAdmin.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unsignedCount: 0, overdueCount: 1, maxDaysOverdue: 3 });
  });
});

// ============================================================================
// Material certification summary tests
// ============================================================================
describe("GET /api/material-certifications/summary — task #1363", () => {
  it("returns zeros when the tenant has no material certifications", async () => {
    await clearTenantCerts(tenantA.orgId);

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiringSoonCount: 0, expiredCount: 0, maxDaysExpired: 0 });
  });

  it("excludes rows whose expirationDate is null", async () => {
    await clearTenantCerts(tenantA.orgId);

    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: null,
    });
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: null,
    });

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiringSoonCount: 0, expiredCount: 0, maxDaysExpired: 0 });
  });

  it("treats expirationDate = CURRENT_DATE as expiringSoon, not expired (boundary)", async () => {
    await clearTenantCerts(tenantA.orgId);

    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(0),
    });

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiringSoonCount: 1, expiredCount: 0, maxDaysExpired: 0 });
  });

  it("treats expirationDate = CURRENT_DATE + 30 days as expiringSoon, but +31 as neither", async () => {
    await clearTenantCerts(tenantA.orgId);

    // On the +30-day boundary — must count as expiringSoon.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(30),
    });
    // One day past the window — must NOT count.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(31),
    });
    // Far future — must NOT count.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(365),
    });

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiringSoonCount: 1, expiredCount: 0, maxDaysExpired: 0 });
  });

  it("splits expired vs expiringSoon and returns the largest days-expired gap", async () => {
    await clearTenantCerts(tenantA.orgId);

    // Expired by 5 days.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(-5),
    });
    // Expired by 45 days — drives maxDaysExpired.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(-45),
    });
    // Expiring in 10 days.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(10),
    });
    // No expiration date — must be ignored.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: null,
    });

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.expiringSoonCount).toBe(1);
    expect(res.body.expiredCount).toBe(2);
    expect(res.body.maxDaysExpired).toBe(45);
  });

  it("isolates results per tenant — tenant B never sees tenant A's certifications", async () => {
    await clearTenantCerts(tenantA.orgId);
    await clearTenantCerts(tenantB.orgId);

    // Tenant A: 1 expiring soon (15d), 1 expired (10d).
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(15),
    });
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(-10),
    });

    // Tenant B: 2 expiring soon, 1 expired (60d).
    await insertCert({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      expirationDate: isoDate(5),
    });
    await insertCert({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      expirationDate: isoDate(28),
    });
    await insertCert({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      expirationDate: isoDate(-60),
    });

    const [resA, resB] = await Promise.all([
      request(app)
        .get("/api/material-certifications/summary")
        .set("Cookie", authCookie(tenantA.token)),
      request(app)
        .get("/api/material-certifications/summary")
        .set("Cookie", authCookie(tenantB.token)),
    ]);

    expect(resA.status).toBe(200);
    expect(resA.body).toEqual({ expiringSoonCount: 1, expiredCount: 1, maxDaysExpired: 10 });

    expect(resB.status).toBe(200);
    expect(resB.body).toEqual({ expiringSoonCount: 2, expiredCount: 1, maxDaysExpired: 60 });
  });

  it("super-admin without ?organizationId returns zeros (no implicit cross-org aggregation)", async () => {
    await clearTenantCerts(tenantA.orgId);
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(-15),
    });

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .set("Cookie", authCookie(superAdmin.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiringSoonCount: 0, expiredCount: 0, maxDaysExpired: 0 });
  });

  it("super-admin with ?organizationId targets exactly that org", async () => {
    await clearTenantCerts(tenantA.orgId);
    await clearTenantCerts(tenantB.orgId);

    // Tenant A: 1 expired by 7 days. Tenant B: 1 expired by 99 days —
    // must NOT show up in the targeted query.
    await insertCert({
      orgId: tenantA.orgId,
      projectId: tenantA.projectId,
      expirationDate: isoDate(-7),
    });
    await insertCert({
      orgId: tenantB.orgId,
      projectId: tenantB.projectId,
      expirationDate: isoDate(-99),
    });

    const res = await request(app)
      .get("/api/material-certifications/summary")
      .query({ organizationId: tenantA.orgId })
      .set("Cookie", authCookie(superAdmin.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiringSoonCount: 0, expiredCount: 1, maxDaysExpired: 7 });
  });
});
