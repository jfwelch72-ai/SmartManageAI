// Task #1397 — POST /api/labor-rates/classifications/:id/merge must
// atomically re-point all child rows (prevailing wage rates, employee
// assignments, DOL mappings, project employee rates, estimate line items)
// from the source classification to the survivor, resolve unique-constraint
// conflicts on child rows by dropping the duplicate, hard-delete the source
// row, and audit-log the action.

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
  employeeClassifications,
  dolClassificationMappings,
  projectEmployeeRates,
  estimates,
  estimateLineItems,
  auditLog,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__jcmerge__";

vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  queueWageDecisionSync: vi.fn(async () => ({ status: "queued" as const })),
}));

let app: Express;
let orgId: string;
let projectId: string;
let userId: string;
let adminToken: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
  await db.delete(dolClassificationMappings).where(inArray(dolClassificationMappings.organizationId, orgIds)).catch(() => {});
  await db.delete(prevailingWageRates).where(inArray(prevailingWageRates.organizationId, orgIds)).catch(() => {});
  await db.delete(employeeClassifications).where(inArray(employeeClassifications.organizationId, orgIds)).catch(() => {});
  await db.execute(sql`DELETE FROM project_employee_rates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ANY(${orgIds}))`).catch(() => {});
  await db.delete(jobClassifications).where(inArray(jobClassifications.organizationId, orgIds)).catch(() => {});
  await db.delete(projects).where(inArray(projects.gcOrganizationId, orgIds)).catch(() => {});
  await db.delete(users).where(inArray(users.organizationId, orgIds)).catch(() => {});
  await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db.insert(organizations).values({
    name: "Merge Test Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "Merge",
    lastName: "Admin",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [employee] = await db.insert(users).values({
    email: `${slug}-emp@test.local`,
    passwordHash,
    firstName: "Crew",
    lastName: "Member",
    role: "FIELD_WORKER",
    organizationId: orgId,
    isActive: true,
  }).returning();
  userId = employee.id;

  const [project] = await db.insert(projects).values({
    name: "Merge Test Project",
    code: `${PREFIX}P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
  }).returning();
  projectId = project.id;

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
  await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE project_id = ${projectId})`);
  await db.delete(estimates).where(eq(estimates.projectId, projectId));
  await db.delete(projectEmployeeRates).where(eq(projectEmployeeRates.projectId, projectId));
  await db.delete(dolClassificationMappings).where(eq(dolClassificationMappings.organizationId, orgId));
  await db.delete(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgId));
  await db.delete(employeeClassifications).where(eq(employeeClassifications.organizationId, orgId));
  await db.delete(jobClassifications).where(eq(jobClassifications.organizationId, orgId));
});

const cookieFor = (t: string) => `auth_token=${t}`;

async function seedDuplicateClassifications(): Promise<{ survivorId: string; sourceId: string }> {
  const [survivor] = await db.insert(jobClassifications).values({
    organizationId: orgId,
    name: "Carpenter",
  }).returning();
  const [source] = await db.insert(jobClassifications).values({
    organizationId: orgId,
    name: "Carpenter (Form)",
  }).returning();
  return { survivorId: survivor.id, sourceId: source.id };
}

describe("POST /api/labor-rates/classifications/:id/merge", () => {
  it("re-points estimate line items and project employee rates within the org and ignores rows in other orgs", async () => {
    const { survivorId, sourceId } = await seedDuplicateClassifications();

    // Seed an estimate + line item in this org pointing at the source.
    const [estimate] = await db.insert(estimates).values({
      projectId,
      versionNumber: 1,
      status: "DRAFT",
      createdById: userId,
    }).returning();

    const [eli] = await db.insert(estimateLineItems).values({
      estimateId: estimate.id,
      category: "GENERAL",
      description: "Carpentry crew",
      quantity: "10",
      unit: "HR",
      totalCost: "100.00",
      jobClassificationId: sourceId,
    }).returning();

    await db.insert(projectEmployeeRates).values({
      projectId,
      userId,
      regularRate: "40.00",
      overtimeRate: "60.00",
      classificationId: sourceId,
    });

    const res = await request(app)
      .post(`/api/labor-rates/classifications/${survivorId}/merge`)
      .set("Cookie", cookieFor(adminToken))
      .send({ sourceId });

    expect(res.status).toBe(200);
    expect(res.body.estimateLineItemsRepointed).toBe(1);
    expect(res.body.projectEmployeeRatesRepointed).toBe(1);

    const [updatedEli] = await db.select().from(estimateLineItems).where(eq(estimateLineItems.id, eli.id));
    expect(updatedEli.jobClassificationId).toBe(survivorId);

    const perRows = await db.select().from(projectEmployeeRates).where(eq(projectEmployeeRates.projectId, projectId));
    expect(perRows).toHaveLength(1);
    expect(perRows[0].classificationId).toBe(survivorId);
  });

  it("re-points prevailing wage rates, employee assignments, and DOL mappings, then deletes the source", async () => {
    const { survivorId, sourceId } = await seedDuplicateClassifications();

    await db.insert(prevailingWageRates).values({
      organizationId: orgId,
      projectId,
      classificationId: sourceId,
      wageRate: "40.00",
      fringeRate: "5.00",
      totalRate: "45.00",
      overtimeMultiplier: "1.5",
      effectiveDate: "2026-01-01",
    });
    await db.insert(employeeClassifications).values({
      organizationId: orgId,
      userId,
      classificationId: sourceId,
      regularRate: "40.00",
      overtimeRate: "60.00",
      isPrimary: true,
      effectiveDate: "2026-01-01",
    });
    await db.insert(dolClassificationMappings).values({
      organizationId: orgId,
      projectId,
      dolFeedName: "carpenter (form)",
      classificationId: sourceId,
    });

    const res = await request(app)
      .post(`/api/labor-rates/classifications/${survivorId}/merge`)
      .set("Cookie", cookieFor(adminToken))
      .send({ sourceId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.prevailingWageRatesRepointed).toBe(1);
    expect(res.body.employeeClassificationsRepointed).toBe(1);
    expect(res.body.dolMappingsRepointed).toBe(1);

    const pwRows = await db.select().from(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgId));
    expect(pwRows).toHaveLength(1);
    expect(pwRows[0].classificationId).toBe(survivorId);

    const ecRows = await db.select().from(employeeClassifications).where(eq(employeeClassifications.organizationId, orgId));
    expect(ecRows).toHaveLength(1);
    expect(ecRows[0].classificationId).toBe(survivorId);

    const dolRows = await db.select().from(dolClassificationMappings).where(eq(dolClassificationMappings.organizationId, orgId));
    expect(dolRows).toHaveLength(1);
    expect(dolRows[0].classificationId).toBe(survivorId);

    const remaining = await db.select().from(jobClassifications).where(eq(jobClassifications.organizationId, orgId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(survivorId);

    const audit = await db.select().from(auditLog).where(and(
      eq(auditLog.entityType, "job_classification"),
      eq(auditLog.entityId, survivorId),
      eq(auditLog.action, "MERGE"),
    ));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("drops the duplicate child row when survivor and source both have a row for the same project / user (unique conflict)", async () => {
    const { survivorId, sourceId } = await seedDuplicateClassifications();

    await db.insert(prevailingWageRates).values([
      {
        organizationId: orgId,
        projectId,
        classificationId: survivorId,
        wageRate: "50.00", fringeRate: "5.00", totalRate: "55.00",
        overtimeMultiplier: "1.5", effectiveDate: "2026-01-01",
      },
      {
        organizationId: orgId,
        projectId,
        classificationId: sourceId,
        wageRate: "40.00", fringeRate: "5.00", totalRate: "45.00",
        overtimeMultiplier: "1.5", effectiveDate: "2026-01-01",
      },
    ]);
    await db.insert(employeeClassifications).values([
      { organizationId: orgId, userId, classificationId: survivorId, regularRate: "50.00", overtimeRate: "75.00", isPrimary: true, effectiveDate: "2026-01-01" },
      { organizationId: orgId, userId, classificationId: sourceId, regularRate: "40.00", overtimeRate: "60.00", isPrimary: false, effectiveDate: "2026-01-01" },
    ]);

    const res = await request(app)
      .post(`/api/labor-rates/classifications/${survivorId}/merge`)
      .set("Cookie", cookieFor(adminToken))
      .send({ sourceId });

    expect(res.status).toBe(200);

    // Survivor's existing rows are kept; source rows for the same
    // (project|user) are deleted to avoid a unique-constraint violation.
    const pwRows = await db.select().from(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgId));
    expect(pwRows).toHaveLength(1);
    expect(pwRows[0].classificationId).toBe(survivorId);
    expect(pwRows[0].wageRate).toBe("50.00");

    const ecRows = await db.select().from(employeeClassifications).where(eq(employeeClassifications.organizationId, orgId));
    expect(ecRows).toHaveLength(1);
    expect(ecRows[0].classificationId).toBe(survivorId);
    expect(ecRows[0].regularRate).toBe("50.00");

    const remaining = await db.select().from(jobClassifications).where(eq(jobClassifications.organizationId, orgId));
    expect(remaining.map((r) => r.id)).toEqual([survivorId]);
  });

  it("rejects merging a classification into itself", async () => {
    const { survivorId } = await seedDuplicateClassifications();
    const res = await request(app)
      .post(`/api/labor-rates/classifications/${survivorId}/merge`)
      .set("Cookie", cookieFor(adminToken))
      .send({ sourceId: survivorId });
    expect(res.status).toBe(400);
  });

  it("returns 404 when either classification is missing or belongs to another org", async () => {
    const { survivorId } = await seedDuplicateClassifications();
    const res = await request(app)
      .post(`/api/labor-rates/classifications/${survivorId}/merge`)
      .set("Cookie", cookieFor(adminToken))
      .send({ sourceId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });
});
