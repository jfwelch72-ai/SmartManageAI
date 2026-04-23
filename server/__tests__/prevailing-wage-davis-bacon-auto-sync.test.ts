// Task #1331 — When a prevailing wage rate row references a Davis-Bacon
// wage decision number that hasn't been imported yet, saving the row
// should queue the same auto-sync used by the project create/update path.
// Mirrors the project-side test pattern in davis-bacon-auto-sync.test.ts
// but exercises the labor-rate routes end-to-end and verifies the
// queueWageDecisionSync helper is invoked with the right decision number.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  jobClassifications,
  prevailingWageRates,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__pwdbsync__";

vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  queueWageDecisionSync: vi.fn(async () => ({ status: "queued" as const })),
}));

let app: Express;
let orgId: string;
let projectId: string;
let classificationId: string;
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
    name: "PW DB Sync Org",
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
    name: "PW DB Sync Project",
    code: `${PREFIX}P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "PW Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
  }).returning();
  projectId = project.id;

  const [cls] = await db.insert(jobClassifications).values({
    organizationId: orgId,
    name: "Carpenter",
    code: "CARP",
  }).returning();
  classificationId = cls.id;

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

const cookieFor = (t: string) => `auth_token=${t}`;

beforeEach(async () => {
  await db.delete(prevailingWageRates).where(eq(prevailingWageRates.organizationId, orgId));
  const sync = await import("../integrations/providers/dol_davis_bacon/sync");
  (sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("Prevailing wage rate routes — Davis-Bacon auto-sync (Task #1331)", () => {
  it("POST queues a wage decision sync when a new row references a wageDecision", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    const res = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        classificationId,
        wageRate: "45.00",
        fringeHealthRate: "5.00",
        fringePensionRate: "4.00",
        fringeVacationRate: "1.00",
        fringeTrainingRate: "1.00",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
        wageDecision: "CA20260010",
      });
    expect(res.status).toBe(201);
    // Allow the fire-and-forget sync queue call to be observed.
    await new Promise((r) => setImmediate(r));
    expect(queueMock).toHaveBeenCalledTimes(1);
    expect(queueMock).toHaveBeenCalledWith(orgId, "CA20260010");
  });

  it("POST does not queue a sync when wageDecision is omitted", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    const res = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        classificationId,
        wageRate: "45.00",
        fringeHealthRate: "5.00",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
      });
    expect(res.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    expect(queueMock).not.toHaveBeenCalled();
  });

  it("PATCH queues a sync when the wage decision changes to a new value", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    // Seed a row with no wage decision so the PATCH below is the first
    // reference to a decision number for this rate.
    const create = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        classificationId,
        wageRate: "45.00",
        fringeHealthRate: "5.00",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
      });
    expect(create.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    queueMock.mockClear();

    const patched = await request(app)
      .patch(`/api/labor-rates/prevailing-wage-rates/${create.body.id}`)
      .set("Cookie", cookieFor(token))
      .send({ wageDecision: "CA20260011" });
    expect(patched.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(queueMock).toHaveBeenCalledTimes(1);
    expect(queueMock).toHaveBeenCalledWith(orgId, "CA20260011");
  });

  it("PATCH does not re-queue a sync when wageDecision is unchanged", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    const create = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        classificationId,
        wageRate: "45.00",
        fringeHealthRate: "5.00",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
        wageDecision: "CA20260012",
      });
    expect(create.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    expect(queueMock).toHaveBeenCalledWith(orgId, "CA20260012");
    queueMock.mockClear();

    // PATCH that doesn't touch wageDecision should not re-queue the sync.
    const patched = await request(app)
      .patch(`/api/labor-rates/prevailing-wage-rates/${create.body.id}`)
      .set("Cookie", cookieFor(token))
      .send({ notes: "tweak" });
    expect(patched.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(queueMock).not.toHaveBeenCalled();
  });

  it("bulk import queues a sync once per distinct wage decision", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    const res = await request(app)
      .post("/api/labor-rates/prevailing-wage-rates/import")
      .set("Cookie", cookieFor(token))
      .send({
        projectId,
        rows: [
          {
            rowNumber: 2,
            classificationId,
            wageRate: "30.00",
            fringeHealthRate: "3.00",
            fringePensionRate: "2.00",
            fringeVacationRate: "0.50",
            fringeTrainingRate: "0.50",
            fringeRate: "",
            overtimeMultiplier: "1.5",
            effectiveDate: "2026-01-01",
            wageDecision: "CA20260020",
            action: "CREATE",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1 });
    await new Promise((r) => setImmediate(r));
    expect(queueMock).toHaveBeenCalledTimes(1);
    expect(queueMock).toHaveBeenCalledWith(orgId, "CA20260020");
  });
});
