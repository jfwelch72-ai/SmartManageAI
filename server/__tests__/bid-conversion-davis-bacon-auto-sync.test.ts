// Task #1386 — When a bid carrying a Davis-Bacon `wageDecision` is converted
// to a project, the bid → project flow should propagate the decision number
// onto `projects.wageDecision` and queue the same Davis-Bacon auto-sync
// used by the project-create / labor-rate paths. Mirrors the route-level
// auto-sync coverage in `prevailing-wage-davis-bacon-auto-sync.test.ts`.

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
  bids,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__bidconvsync__";

vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  queueWageDecisionSync: vi.fn(async () => ({ status: "queued" as const })),
}));

let app: Express;
let orgId: string;
let token: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
  await db.delete(projects).where(inArray(projects.gcOrganizationId, orgIds)).catch(() => {});
  await db.delete(bids).where(inArray(bids.gcOrganizationId, orgIds)).catch(() => {});
  await db.delete(users).where(inArray(users.organizationId, orgIds)).catch(() => {});
  await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db.insert(organizations).values({
    name: "Bid Convert Sync Org",
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
    firstName: "Bid",
    lastName: "Admin",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  token = generateToken(user.id, user.tokenVersion ?? 0);

  const bidRoutes = (await import("../bidRoutes")).default;
  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(bidRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

const cookieFor = (t: string) => `auth_token=${t}`;

beforeEach(async () => {
  await db.delete(projects).where(eq(projects.gcOrganizationId, orgId));
  await db.delete(bids).where(eq(bids.gcOrganizationId, orgId));
  const sync = await import("../integrations/providers/dol_davis_bacon/sync");
  (sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>).mockClear();
});

async function seedBid(opts: { wageDecision: string | null; codeSuffix: string }) {
  const [bid] = await db.insert(bids).values({
    name: `Bid ${opts.codeSuffix}`,
    code: `${PREFIX}${opts.codeSuffix}`,
    clientName: "ACME Civil",
    gcOrganizationId: orgId,
    status: "ACTIVE",
    wageDecision: opts.wageDecision,
  }).returning();
  return bid;
}

describe("Bid → project conversion — Davis-Bacon auto-sync (Task #1386)", () => {
  it("PATCH /api/bids/:code allows wageDecision to be set on the bid", async () => {
    const bid = await seedBid({ wageDecision: null, codeSuffix: "patch1" });

    const patched = await request(app)
      .patch(`/api/bids/${bid.code}`)
      .set("Cookie", cookieFor(token))
      .send({ wageDecision: "CA20260100" });

    expect(patched.status).toBe(200);

    const [reloaded] = await db.select().from(bids).where(eq(bids.id, bid.id));
    expect(reloaded?.wageDecision).toBe("CA20260100");
  });

  it("convert propagates wageDecision to the new project and queues a sync", async () => {
    const bid = await seedBid({ wageDecision: "CA20260200", codeSuffix: "conv1" });

    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    const res = await request(app)
      .post(`/api/bids/${bid.code}/convert`)
      .set("Cookie", cookieFor(token))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body?.wageDecision).toBe("CA20260200");

    const [project] = await db.select().from(projects).where(eq(projects.code, bid.code));
    expect(project?.wageDecision).toBe("CA20260200");

    // Allow the fire-and-forget sync queue call to be observed.
    await new Promise((r) => setImmediate(r));
    expect(queueMock).toHaveBeenCalledTimes(1);
    expect(queueMock).toHaveBeenCalledWith(orgId, "CA20260200");
  });

  it("convert does not queue a sync when the bid has no wage decision", async () => {
    const bid = await seedBid({ wageDecision: null, codeSuffix: "conv2" });

    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const queueMock = sync.queueWageDecisionSync as unknown as ReturnType<typeof vi.fn>;

    const res = await request(app)
      .post(`/api/bids/${bid.code}/convert`)
      .set("Cookie", cookieFor(token))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body?.wageDecision ?? null).toBeNull();

    await new Promise((r) => setImmediate(r));
    expect(queueMock).not.toHaveBeenCalled();
  });
});
