// Task #1366 — Integration tests for the remaining Safety Hub tile-badge
// summary endpoints added in task #1362:
//   * GET /api/safety-training/summary
//       - "overdue"      = status <> 'COMPLETED' AND
//                          (status = 'OVERDUE' OR dueDate < CURRENT_DATE)
//       - "expiringSoon" = status <> 'COMPLETED' AND
//                          CURRENT_DATE <= dueDate <= CURRENT_DATE + 30 days
//       - boundary: dueDate = CURRENT_DATE counts as expiringSoon (not overdue)
//       - boundary: dueDate = CURRENT_DATE + 30 days counts as expiringSoon
//       - boundary: dueDate = CURRENT_DATE + 31 days is excluded
//       - rows with status='COMPLETED' are always excluded
//       - "maxDaysOverdue" is the largest CURRENT_DATE - dueDate gap
//   * GET /api/compliance/summary
//       - aggregates expired/expiringSoon across DBE certs
//         (crm_organisation_certifications), surety bonds, CRM org
//         insurance / WC / license, and project permits
//       - bonds with status RELEASED/CANCELED are excluded
//       - permits with status RENEWED are excluded
//       - rows without an expirationDate/expiryDate are not counted
//       - "maxDaysExpired" is the largest CURRENT_DATE - expiry gap across
//         all four sources
//
// Both endpoints must be strictly tenant-scoped: tenant B never sees tenant
// A's data.

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
  safetyTrainings,
  safetyTrainingAssignments,
  crmOrganisations,
  crmOrganisationCertifications,
  suretyBonds,
  projectPermits,
  auditLog,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__safetyhub_tc__";

interface TenantCtx {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  trainingId: string;
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
      name: `Hub TC Org ${label}`,
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
      firstName: "Hub",
      lastName: `TC-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `Hub TC Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}`,
      clientName: `Hub TC Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [training] = await db
    .insert(safetyTrainings)
    .values({
      organizationId: org.id,
      title: `Hub TC Training ${label}`,
      category: "GENERAL",
      frequency: "ONCE",
      isActive: true,
      createdBy: user.id,
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);

  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    trainingId: training.id,
  };
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
    // ON DELETE CASCADE on organization_id columns will clean up the
    // training programs / assignments / CRM orgs / certifications /
    // bonds / project permits we created during the test run.
    await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();

  const safetyTrainingRoutes = (await import("../safetyTrainingRoutes")).default;
  const complianceRoutes = (await import("../complianceRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  // safetyTrainingRoutes registers absolute paths like /api/safety-training/*
  // so it mounts at root. complianceRoutes is mounted at /api/compliance in
  // the real app (server/routes.ts).
  app.use(safetyTrainingRoutes);
  app.use("/api/compliance", complianceRoutes);

  [tenantA, tenantB] = await Promise.all([
    seedTenant("A"),
    seedTenant("B"),
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
// Safety training assignment helpers
// ============================================================================

interface AssignOpts {
  ctx: TenantCtx;
  dueDate?: string | null;
  status?: "PENDING" | "IN_PROGRESS" | "OVERDUE" | "COMPLETED";
}

async function insertAssignment(opts: AssignOpts): Promise<string> {
  // Each assignment needs a unique employee. The simplest way is to seed
  // a fresh user per row so we don't trip over a future "one assignment per
  // employee per training" unique constraint.
  const slug = `${PREFIX}emp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [emp] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Emp",
      lastName: slug.slice(-6),
      role: "FIELD_WORKER",
      organizationId: opts.ctx.orgId,
      isActive: true,
    })
    .returning();

  const [row] = await db
    .insert(safetyTrainingAssignments)
    .values({
      trainingId: opts.ctx.trainingId,
      organizationId: opts.ctx.orgId,
      employeeId: emp.id,
      assignedBy: opts.ctx.userId,
      dueDate: opts.dueDate ?? null,
      status: opts.status ?? "PENDING",
    })
    .returning();
  return row.id;
}

async function clearTenantAssignments(orgId: string): Promise<void> {
  await db.delete(safetyTrainingAssignments).where(
    sql`${safetyTrainingAssignments.organizationId} = ${orgId}`,
  );
}

// ============================================================================
// Compliance helpers
// ============================================================================

async function insertCrmOrg(ctx: TenantCtx, opts: {
  insuranceExpiration?: string | null;
  wcInsuranceExpiration?: string | null;
  licenseExpiration?: string | null;
} = {}): Promise<string> {
  const [row] = await db
    .insert(crmOrganisations)
    .values({
      organizationId: ctx.orgId,
      type: "SUBCONTRACTOR",
      name: `${PREFIX}org-${Math.random().toString(36).slice(2, 10)}`,
      // Drizzle accepts either a Date or a parseable string for timestamp
      // columns. Use a string with a UTC anchor to keep the test
      // deterministic regardless of host timezone.
      insuranceExpiration: opts.insuranceExpiration
        ? (new Date(`${opts.insuranceExpiration}T00:00:00.000Z`) as unknown as Date)
        : null,
      wcInsuranceExpiration: opts.wcInsuranceExpiration
        ? (new Date(`${opts.wcInsuranceExpiration}T00:00:00.000Z`) as unknown as Date)
        : null,
      licenseExpiration: opts.licenseExpiration
        ? (new Date(`${opts.licenseExpiration}T00:00:00.000Z`) as unknown as Date)
        : null,
    })
    .returning();
  return row.id;
}

async function insertCert(opts: {
  ctx: TenantCtx;
  crmOrganisationId: string;
  expirationDate: string | null;
  certificationType?: "DBE" | "MBE" | "WBE" | "SBE" | "VOSB" | "SDVOSB" | "HUBZONE" | "EIGHTA" | "ACDBE" | "OTHER";
  certifyingAgency?: string;
}): Promise<string> {
  const [row] = await db
    .insert(crmOrganisationCertifications)
    .values({
      organizationId: opts.ctx.orgId,
      crmOrganisationId: opts.crmOrganisationId,
      certificationType: opts.certificationType ?? "DBE",
      certifyingAgency:
        opts.certifyingAgency ??
        `${PREFIX}agency-${Math.random().toString(36).slice(2, 10)}`,
      expirationDate: opts.expirationDate,
    })
    .returning();
  return row.id;
}

async function insertBond(ctx: TenantCtx, opts: {
  expirationDate: string | null;
  status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "RELEASED" | "CLAIMED" | "CANCELED";
}): Promise<string> {
  const [row] = await db
    .insert(suretyBonds)
    .values({
      organizationId: ctx.orgId,
      bondType: "PERFORMANCE",
      status: opts.status ?? "ACTIVE",
      bondNumber: `${PREFIX}B-${Math.random().toString(36).slice(2, 10)}`,
      suretyCompany: "ACME Surety",
      bondAmount: "100000.00",
      expirationDate: opts.expirationDate,
    })
    .returning();
  return row.id;
}

async function insertPermit(ctx: TenantCtx, opts: {
  expiryDate: string | null;
  status?: "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "ACTIVE" | "EXPIRED" | "RENEWED";
}): Promise<string> {
  const [row] = await db
    .insert(projectPermits)
    .values({
      projectId: ctx.projectId,
      permitType: "BUILDING",
      status: opts.status ?? "ACTIVE",
      expiryDate: opts.expiryDate,
      createdById: ctx.userId,
    })
    .returning();
  return row.id;
}

async function clearTenantCompliance(ctx: TenantCtx): Promise<void> {
  await db.delete(projectPermits).where(
    sql`${projectPermits.projectId} = ${ctx.projectId}`,
  );
  await db.delete(suretyBonds).where(
    sql`${suretyBonds.organizationId} = ${ctx.orgId}`,
  );
  await db.delete(crmOrganisationCertifications).where(
    sql`${crmOrganisationCertifications.organizationId} = ${ctx.orgId}`,
  );
  await db.delete(crmOrganisations).where(
    sql`${crmOrganisations.organizationId} = ${ctx.orgId}`,
  );
}

// ============================================================================
// /api/safety-training/summary
// ============================================================================

describe("GET /api/safety-training/summary — task #1366", () => {
  it("returns zeros when the tenant has no assignments", async () => {
    await clearTenantAssignments(tenantA.orgId);

    const res = await request(app)
      .get("/api/safety-training/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overdueCount: 0, expiringSoonCount: 0, maxDaysOverdue: 0 });
  });

  it("excludes COMPLETED rows even when their dueDate is in the past", async () => {
    await clearTenantAssignments(tenantA.orgId);

    await insertAssignment({
      ctx: tenantA,
      dueDate: isoDate(-10),
      status: "COMPLETED",
    });
    await insertAssignment({
      ctx: tenantA,
      dueDate: isoDate(5),
      status: "COMPLETED",
    });

    const res = await request(app)
      .get("/api/safety-training/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overdueCount: 0, expiringSoonCount: 0, maxDaysOverdue: 0 });
  });

  it("status='OVERDUE' counts as overdue regardless of dueDate (even null/future)", async () => {
    await clearTenantAssignments(tenantA.orgId);

    // No due date but explicit OVERDUE status — must count as overdue. With
    // a null dueDate the maxDaysOverdue contribution is zero.
    await insertAssignment({
      ctx: tenantA,
      dueDate: null,
      status: "OVERDUE",
    });
    // Future due date but explicit OVERDUE status — still overdue. Future
    // dueDate cannot push maxDaysOverdue (CURRENT_DATE - dueDate would be
    // negative and is filtered out).
    await insertAssignment({
      ctx: tenantA,
      dueDate: isoDate(20),
      status: "OVERDUE",
    });

    const res = await request(app)
      .get("/api/safety-training/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.overdueCount).toBe(2);
    expect(res.body.maxDaysOverdue).toBe(0);
    // The future-dated OVERDUE row also satisfies the expiringSoon
    // predicate (dueDate within +30d), so it lands in both buckets — this
    // mirrors what the route SQL emits.
    expect(res.body.expiringSoonCount).toBe(1);
  });

  it("treats dueDate boundaries correctly: today and +30d count as expiringSoon, +31d is neither", async () => {
    await clearTenantAssignments(tenantA.orgId);

    await insertAssignment({ ctx: tenantA, dueDate: isoDate(0), status: "PENDING" });
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(30), status: "PENDING" });
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(31), status: "PENDING" });
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(365), status: "PENDING" });

    const res = await request(app)
      .get("/api/safety-training/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      overdueCount: 0,
      expiringSoonCount: 2, // today + +30d
      maxDaysOverdue: 0,
    });
  });

  it("splits overdue vs expiringSoon and returns the largest days-overdue gap", async () => {
    await clearTenantAssignments(tenantA.orgId);

    // PENDING but already past due — counts as overdue (3 days).
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(-3), status: "PENDING" });
    // IN_PROGRESS, very overdue — drives maxDaysOverdue (45 days).
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(-45), status: "IN_PROGRESS" });
    // PENDING due in 10 days — expiringSoon only.
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(10), status: "PENDING" });
    // COMPLETED but very overdue — must be ignored entirely.
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(-200), status: "COMPLETED" });

    const res = await request(app)
      .get("/api/safety-training/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.overdueCount).toBe(2);
    expect(res.body.expiringSoonCount).toBe(1);
    expect(res.body.maxDaysOverdue).toBe(45);
  });

  it("isolates results per tenant — tenant B never sees tenant A's assignments", async () => {
    await clearTenantAssignments(tenantA.orgId);
    await clearTenantAssignments(tenantB.orgId);

    // Tenant A: 1 overdue (5 days), 1 expiringSoon (15 days).
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(-5), status: "PENDING" });
    await insertAssignment({ ctx: tenantA, dueDate: isoDate(15), status: "PENDING" });

    // Tenant B: 2 overdue (max 60 days), 1 expiringSoon (today).
    await insertAssignment({ ctx: tenantB, dueDate: isoDate(-2), status: "PENDING" });
    await insertAssignment({ ctx: tenantB, dueDate: isoDate(-60), status: "IN_PROGRESS" });
    await insertAssignment({ ctx: tenantB, dueDate: isoDate(0), status: "PENDING" });

    const [resA, resB] = await Promise.all([
      request(app)
        .get("/api/safety-training/summary")
        .set("Cookie", authCookie(tenantA.token)),
      request(app)
        .get("/api/safety-training/summary")
        .set("Cookie", authCookie(tenantB.token)),
    ]);

    expect(resA.status).toBe(200);
    expect(resA.body).toEqual({ overdueCount: 1, expiringSoonCount: 1, maxDaysOverdue: 5 });

    expect(resB.status).toBe(200);
    expect(resB.body).toEqual({ overdueCount: 2, expiringSoonCount: 1, maxDaysOverdue: 60 });
  });
});

// ============================================================================
// /api/compliance/summary
// ============================================================================

describe("GET /api/compliance/summary — task #1366", () => {
  it("returns zeros when the tenant has no compliance items", async () => {
    await clearTenantCompliance(tenantA);

    const res = await request(app)
      .get("/api/compliance/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiredCount: 0, expiringSoonCount: 0, maxDaysExpired: 0 });
  });

  it("counts expired and expiringSoon DBE certifications and excludes null expirations", async () => {
    await clearTenantCompliance(tenantA);
    const orgId = await insertCrmOrg(tenantA);

    await insertCert({ ctx: tenantA, crmOrganisationId: orgId, expirationDate: isoDate(-12), certificationType: "DBE", certifyingAgency: "A1" });
    await insertCert({ ctx: tenantA, crmOrganisationId: orgId, expirationDate: isoDate(20), certificationType: "MBE", certifyingAgency: "A2" });
    // Null expiration is ignored.
    await insertCert({ ctx: tenantA, crmOrganisationId: orgId, expirationDate: null, certificationType: "WBE", certifyingAgency: "A3" });

    const res = await request(app)
      .get("/api/compliance/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiredCount: 1, expiringSoonCount: 1, maxDaysExpired: 12 });
  });

  it("excludes RELEASED and CANCELED surety bonds even when their expirationDate is in the past", async () => {
    await clearTenantCompliance(tenantA);

    // Active expired bond (8 days) — must count.
    await insertBond(tenantA, { expirationDate: isoDate(-8), status: "ACTIVE" });
    // RELEASED, very overdue — must NOT count.
    await insertBond(tenantA, { expirationDate: isoDate(-200), status: "RELEASED" });
    // CANCELED, expiring soon — must NOT count.
    await insertBond(tenantA, { expirationDate: isoDate(7), status: "CANCELED" });
    // Active expiring soon — counts.
    await insertBond(tenantA, { expirationDate: isoDate(14), status: "ACTIVE" });

    const res = await request(app)
      .get("/api/compliance/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiredCount: 1, expiringSoonCount: 1, maxDaysExpired: 8 });
  });

  it("aggregates CRM org insurance/WC/license columns independently into the totals", async () => {
    await clearTenantCompliance(tenantA);

    // One CRM org carrying THREE different coverages, each in a different
    // bucket: insurance expired (4d), WC expiring soon (10d), license well
    // outside both windows (+200d, ignored).
    await insertCrmOrg(tenantA, {
      insuranceExpiration: isoDate(-4),
      wcInsuranceExpiration: isoDate(10),
      licenseExpiration: isoDate(200),
    });
    // A second org with only a license expired 25 days ago — drives
    // maxDaysExpired and adds another expired count.
    await insertCrmOrg(tenantA, {
      licenseExpiration: isoDate(-25),
    });

    const res = await request(app)
      .get("/api/compliance/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiredCount: 2, expiringSoonCount: 1, maxDaysExpired: 25 });
  });

  it("excludes RENEWED project permits even when their expiryDate is in the past", async () => {
    await clearTenantCompliance(tenantA);

    // Active permit expired 30 days ago — counts.
    await insertPermit(tenantA, { expiryDate: isoDate(-30), status: "ACTIVE" });
    // APPROVED permit expiring in 5 days — counts as expiringSoon.
    await insertPermit(tenantA, { expiryDate: isoDate(5), status: "APPROVED" });
    // RENEWED but very overdue — must NOT count (the underlying record was
    // superseded by a renewal).
    await insertPermit(tenantA, { expiryDate: isoDate(-365), status: "RENEWED" });
    // No expiryDate — ignored.
    await insertPermit(tenantA, { expiryDate: null, status: "APPLIED" });

    const res = await request(app)
      .get("/api/compliance/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiredCount: 1, expiringSoonCount: 1, maxDaysExpired: 30 });
  });

  it("combines all four sources and surfaces the largest days-expired across them", async () => {
    await clearTenantCompliance(tenantA);
    const orgId = await insertCrmOrg(tenantA, {
      insuranceExpiration: isoDate(-3), // expired 3d (CRM org)
    });

    await insertCert({ ctx: tenantA, crmOrganisationId: orgId, expirationDate: isoDate(-15), certifyingAgency: "X" }); // expired 15d
    await insertCert({ ctx: tenantA, crmOrganisationId: orgId, expirationDate: isoDate(2), certificationType: "MBE", certifyingAgency: "Y" }); // expiringSoon
    await insertBond(tenantA, { expirationDate: isoDate(-90), status: "ACTIVE" }); // expired 90d — drives max
    await insertBond(tenantA, { expirationDate: isoDate(28), status: "ACTIVE" }); // expiringSoon
    await insertPermit(tenantA, { expiryDate: isoDate(-7), status: "ACTIVE" }); // expired 7d
    await insertPermit(tenantA, { expiryDate: isoDate(30), status: "APPROVED" }); // boundary expiringSoon

    const res = await request(app)
      .get("/api/compliance/summary")
      .set("Cookie", authCookie(tenantA.token));

    expect(res.status).toBe(200);
    expect(res.body.expiredCount).toBe(4); // cert + insurance + bond + permit
    expect(res.body.expiringSoonCount).toBe(3); // cert + bond + permit
    expect(res.body.maxDaysExpired).toBe(90);
  });

  it("isolates results per tenant — tenant B never sees tenant A's compliance items", async () => {
    await clearTenantCompliance(tenantA);
    await clearTenantCompliance(tenantB);

    // Tenant A: 1 expired bond (10d), 1 expiringSoon permit (15d).
    await insertBond(tenantA, { expirationDate: isoDate(-10), status: "ACTIVE" });
    await insertPermit(tenantA, { expiryDate: isoDate(15), status: "APPROVED" });

    // Tenant B: a much bigger expired bond (100d) and an expired permit
    // (50d). If isolation breaks tenant A would see the 100d max.
    await insertBond(tenantB, { expirationDate: isoDate(-100), status: "ACTIVE" });
    await insertPermit(tenantB, { expiryDate: isoDate(-50), status: "ACTIVE" });

    const [resA, resB] = await Promise.all([
      request(app)
        .get("/api/compliance/summary")
        .set("Cookie", authCookie(tenantA.token)),
      request(app)
        .get("/api/compliance/summary")
        .set("Cookie", authCookie(tenantB.token)),
    ]);

    expect(resA.status).toBe(200);
    expect(resA.body).toEqual({ expiredCount: 1, expiringSoonCount: 1, maxDaysExpired: 10 });

    expect(resB.status).toBe(200);
    expect(resB.body).toEqual({ expiredCount: 2, expiringSoonCount: 0, maxDaysExpired: 100 });
  });
});
