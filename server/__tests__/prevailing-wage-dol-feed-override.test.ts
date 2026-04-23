// Task #1350 — POST /api/labor-rates/prevailing-wage-rates must accept the
// synthetic `dol-feed:<name>` classification id used by the project
// prevailing-wage panel (Task #1342) for cached DOL classifications that do
// not yet have a matching `job_classifications` row. The handler should
// find-or-create the underlying classification and then persist the
// override, instead of failing the FK on `prevailing_wage_rates.classification_id`.

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
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__pwdolovr__";

vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  queueWageDecisionSync: vi.fn(async () => ({ status: "queued" as const })),
}));

let app: Express;
let orgId: string;
let projectId: string;
let existingClassId: string;
let token: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
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
    name: "PW DOL Override Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "PW",
    lastName: "Admin",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  token = generateToken(user.id, user.tokenVersion ?? 0);

  const [project] = await db.insert(projects).values({
    name: "PW DOL Override Project",
    code: `${PREFIX}P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "PW Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
  }).returning();
  projectId = project.id;

  // Pre-existing classification used to exercise the "synthetic id whose
  // name actually matches an existing row" path (find, don't create).
  const [cls] = await db.insert(jobClassifications).values({
    organizationId: orgId,
    name: "Existing Carpenter",
  }).returning();
  existingClassId = cls.id;

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
  await db.delete(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgId));
  // Reset classifications back to just the seeded `Existing Carpenter` row
  // so each test starts from the same baseline.
  await db
    .delete(jobClassifications)
    .where(and(
      eq(jobClassifications.organizationId, orgId),
      sql`${jobClassifications.id} <> ${existingClassId}`,
    ));
});

const cookieFor = (t: string) => `auth_token=${t}`;

describe("POST /api/labor-rates/prevailing-wage-rates — DOL feed override (Task #1350)", () => {
  it("auto-creates the missing job_classifications row and persists the override", async () => {
    const newName = "Brand New Ironworker";
    const res = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        classificationId: `dol-feed:${newName.toLowerCase()}`,
        classificationName: newName,
        wageRate: "52.00",
        fringeRate: "11.00",
        fringeHealthRate: "0",
        fringePensionRate: "0",
        fringeVacationRate: "0",
        fringeTrainingRate: "0",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
        wageDecision: "WD-IRON-001",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    // The persisted row references a real (UUID) classification id, not
    // the synthetic one we sent.
    expect(typeof res.body.classificationId).toBe("string");
    expect(res.body.classificationId.startsWith("dol-feed:")).toBe(false);
    expect(parseFloat(res.body.wageRate)).toBe(52);
    expect(parseFloat(res.body.totalRate)).toBe(63);

    // The classification was actually created with the right name + org.
    const created = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, orgId),
        eq(jobClassifications.id, res.body.classificationId),
      ));
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe(newName);
    // Defaults derived from the wage rate × overtime multiplier.
    expect(created[0].defaultRegularRate).toBe("52.00");
    expect(created[0].defaultOvertimeRate).toBe("78.00");

    // And the prevailing wage row was actually persisted.
    const stored = await db
      .select()
      .from(prevailingWageRates)
      .where(eq(prevailingWageRates.id, res.body.id));
    expect(stored).toHaveLength(1);
    expect(stored[0].classificationId).toBe(created[0].id);
    expect(stored[0].projectId).toBe(projectId);
  });

  it("reuses an existing job_classifications row when the synthetic name matches case-insensitively", async () => {
    const res = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        // Same name as the seeded `Existing Carpenter` row but lowercased
        // (the panel emits the lowercased name in the synthetic id).
        classificationId: "dol-feed:existing carpenter",
        classificationName: "Existing Carpenter",
        wageRate: "60.00",
        fringeRate: "10.00",
        fringeHealthRate: "0",
        fringePensionRate: "0",
        fringeVacationRate: "0",
        fringeTrainingRate: "0",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
      });

    expect(res.status).toBe(201);
    expect(res.body.classificationId).toBe(existingClassId);

    // No duplicate classification was created.
    const all = await db
      .select()
      .from(jobClassifications)
      .where(eq(jobClassifications.organizationId, orgId));
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(existingClassId);
  });

  it("real classification ids still flow through unchanged", async () => {
    const res = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        classificationId: existingClassId,
        wageRate: "45.00",
        fringeRate: "5.00",
        fringeHealthRate: "0",
        fringePensionRate: "0",
        fringeVacationRate: "0",
        fringeTrainingRate: "0",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
      });

    expect(res.status).toBe(201);
    expect(res.body.classificationId).toBe(existingClassId);
    // Make sure no extra job_classifications row leaked in.
    const all = await db
      .select()
      .from(jobClassifications)
      .where(eq(jobClassifications.organizationId, orgId));
    expect(all).toHaveLength(1);
  });
});
