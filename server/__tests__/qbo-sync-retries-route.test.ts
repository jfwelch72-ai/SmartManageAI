// Task #1394 — verifies the per-connection QBO sync retry feed
// (`GET /api/integrations/connections/:id/qbo-sync-retries`) returned
// from `server/integrationRoutes.ts`. The endpoint backs a focused
// "failing QBO syncs" panel on the QuickBooks integration detail page,
// so admins can see which customer/invoice/pay-run/scheduled rows are
// mid-retry, when the next attempt is, and which need manual
// intervention.
//
// Coverage:
//   - Returns rows whose entity_type starts with `qbo_sync:` for the
//     supplied connection only (skips other connections + non-QBO
//     entityTypes + healthy rows with no lastError).
//   - Classifies entity types into the four kinds (customer / invoice /
//     pay_run / scheduled_op) with sensible labels + itemId extraction.
//   - Surfaces lastError / retryCount / nextRetryAt and flags exhausted
//     rows (retryCount >= MAX_SYNC_RETRIES with nextRetryAt = null).
//   - Enforces org isolation (rows owned by another org are not exposed
//     even if the route param is reused).
//   - Returns 400 for non-QBO connections so the UI can't accidentally
//     query Sage/StackCT/etc through the QBO-only feed.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
} from "@shared/schema";
import { MAX_SYNC_RETRIES } from "../integrations/syncRetry";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

type TestUser = { id: string; organizationId: string; role: string } | null;
let testUser: TestUser = null;

vi.mock("../auth", () => ({
  requireAuth: (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
    next();
  },
  requireRole: (..._roles: string[]) =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!testUser) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      req.user = testUser;
      next();
    },
}));

const PREFIX = "__qbosr__";

let orgId: string;
let otherOrgId: string;
let app: Express;
let qboConnectionId: string;
let otherQboConnectionId: string;
let sageConnectionId: string;
let crossOrgConnectionId: string;

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, id));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

beforeAll(async () => {
  await cleanup();
  const [org] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}org`, slug: `${PREFIX}org-${Date.now()}` })
    .returning();
  orgId = org.id;
  const [other] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}other`, slug: `${PREFIX}other-${Date.now()}` })
    .returning();
  otherOrgId = other.id;

  const { default: router } = await import("../integrationRoutes");
  app = express();
  app.use(express.json());
  app.use(router);
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, orgId));
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, otherOrgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, otherOrgId));

  const [qbo] = await db
    .insert(integrationConnections)
    .values({
      organizationId: orgId,
      provider: "qbo",
      displayName: "QBO Test",
      status: "active",
      metadata: {},
    })
    .returning();
  qboConnectionId = qbo.id;

  const [otherQbo] = await db
    .insert(integrationConnections)
    .values({
      organizationId: orgId,
      provider: "qbo",
      displayName: "QBO Other Connection",
      status: "active",
      metadata: {},
    })
    .returning();
  otherQboConnectionId = otherQbo.id;

  const [sage] = await db
    .insert(integrationConnections)
    .values({
      organizationId: orgId,
      provider: "sage_intacct",
      displayName: "Sage Test",
      status: "active",
      metadata: {},
    })
    .returning();
  sageConnectionId = sage.id;

  const [cross] = await db
    .insert(integrationConnections)
    .values({
      organizationId: otherOrgId,
      provider: "qbo",
      displayName: "Other Org QBO",
      status: "active",
      metadata: {},
    })
    .returning();
  crossOrgConnectionId = cross.id;

  testUser = { id: "test-user-id", organizationId: orgId, role: "ADMIN" };
});

async function seedSyncRow(args: {
  connectionId: string;
  organizationId: string;
  entityType: string;
  retryCount?: number;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  lastAttemptAt?: Date | null;
}) {
  await db.insert(integrationSyncState).values({
    organizationId: args.organizationId,
    connectionId: args.connectionId,
    entityType: args.entityType,
    retryCount: args.retryCount ?? 1,
    lastError: args.lastError === undefined ? "boom" : args.lastError,
    nextRetryAt:
      args.nextRetryAt === undefined ? new Date(Date.now() + 5 * 60_000) : args.nextRetryAt,
    lastAttemptAt: args.lastAttemptAt ?? new Date(),
  });
}

describe("GET /api/integrations/connections/:id/qbo-sync-retries", () => {
  it("returns 401 when unauthenticated", async () => {
    testUser = null;
    const res = await request(app).get(`/connections/${qboConnectionId}/qbo-sync-retries`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown connection", async () => {
    const res = await request(app).get(
      `/connections/00000000-0000-0000-0000-000000000000/qbo-sync-retries`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for connection in another org (org isolation)", async () => {
    const res = await request(app).get(`/connections/${crossOrgConnectionId}/qbo-sync-retries`);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the connection is not QBO", async () => {
    const res = await request(app).get(`/connections/${sageConnectionId}/qbo-sync-retries`);
    expect(res.status).toBe(400);
  });

  it("classifies kinds, surfaces failure metadata, flags exhausted, and excludes other connections + healthy rows", async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 5 * 60_000);

    // Per-item failures across each kind on the target connection.
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:customer:cust-1",
      lastError: "Auth expired",
      retryCount: 2,
      nextRetryAt: future,
      lastAttemptAt: past,
    });
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:invoice:inv-7",
      lastError: "Validation failed: field X required",
      retryCount: 3,
      nextRetryAt: future,
    });
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:payroll:run-9",
      lastError: "QBO 502",
      retryCount: 1,
      nextRetryAt: future,
    });
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:certified_payroll:run-9",
      lastError: "QBO 503",
      retryCount: 1,
      nextRetryAt: future,
    });
    // Bare scheduled op + bulk customer scheduled op.
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:chart_of_accounts",
      lastError: "Network timeout",
      retryCount: 1,
      nextRetryAt: future,
    });
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:customers",
      lastError: "Bulk customer push failed",
      retryCount: 1,
      nextRetryAt: future,
    });
    // Exhausted row: retryCount >= MAX_SYNC_RETRIES, nextRetryAt = null.
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:invoice:inv-99",
      lastError: "Permanent failure",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    });
    // Healthy row (no lastError) — must NOT be returned.
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:invoice:inv-clean",
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
    });
    // Other QBO connection in same org — must NOT be returned.
    await seedSyncRow({
      connectionId: otherQboConnectionId,
      organizationId: orgId,
      entityType: "qbo_sync:customer:other-conn",
      lastError: "should not appear",
      retryCount: 1,
      nextRetryAt: future,
    });
    // Non-QBO entity type on the QBO connection — must NOT be returned.
    await seedSyncRow({
      connectionId: qboConnectionId,
      organizationId: orgId,
      entityType: "davis_bacon:wage-decision-1",
      lastError: "wrong prefix",
      retryCount: 1,
      nextRetryAt: future,
    });

    const res = await request(app).get(`/connections/${qboConnectionId}/qbo-sync-retries`);
    expect(res.status).toBe(200);

    const body = res.body as {
      connectionId: string;
      provider: string;
      maxRetries: number;
      retries: Array<{
        entityType: string;
        kind: "customer" | "invoice" | "pay_run" | "scheduled_op";
        label: string;
        itemId: string | null;
        lastError: string | null;
        retryCount: number;
        nextRetryAt: string | null;
        exhausted: boolean;
      }>;
    };
    expect(body.connectionId).toBe(qboConnectionId);
    expect(body.provider).toBe("qbo");
    expect(body.maxRetries).toBe(MAX_SYNC_RETRIES);

    // 7 expected: 4 per-item + 1 bare scheduled + 1 bulk customer + 1 exhausted invoice.
    expect(body.retries.length).toBe(7);

    const byEntity = new Map(body.retries.map(r => [r.entityType, r]));

    const cust = byEntity.get("qbo_sync:customer:cust-1")!;
    expect(cust.kind).toBe("customer");
    expect(cust.itemId).toBe("cust-1");
    expect(cust.label).toContain("cust-1");
    expect(cust.lastError).toBe("Auth expired");
    expect(cust.retryCount).toBe(2);
    expect(cust.exhausted).toBe(false);

    const inv = byEntity.get("qbo_sync:invoice:inv-7")!;
    expect(inv.kind).toBe("invoice");
    expect(inv.itemId).toBe("inv-7");

    const pay = byEntity.get("qbo_sync:payroll:run-9")!;
    expect(pay.kind).toBe("pay_run");
    expect(pay.itemId).toBe("run-9");

    const cpr = byEntity.get("qbo_sync:certified_payroll:run-9")!;
    expect(cpr.kind).toBe("pay_run");
    expect(cpr.itemId).toBe("run-9");

    const coa = byEntity.get("qbo_sync:chart_of_accounts")!;
    expect(coa.kind).toBe("scheduled_op");
    expect(coa.itemId).toBeNull();
    expect(coa.label).toBe("chart of accounts");

    const customers = byEntity.get("qbo_sync:customers")!;
    expect(customers.kind).toBe("customer");
    expect(customers.itemId).toBeNull();

    const exhausted = byEntity.get("qbo_sync:invoice:inv-99")!;
    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.nextRetryAt).toBeNull();
    expect(exhausted.retryCount).toBe(MAX_SYNC_RETRIES);

    // Negative checks:
    expect(byEntity.has("qbo_sync:invoice:inv-clean")).toBe(false);
    expect(byEntity.has("qbo_sync:customer:other-conn")).toBe(false);
    expect(byEntity.has("davis_bacon:wage-decision-1")).toBe(false);
  });

  it("returns an empty list when there are no failing QBO syncs", async () => {
    const res = await request(app).get(`/connections/${qboConnectionId}/qbo-sync-retries`);
    expect(res.status).toBe(200);
    expect(res.body.retries).toEqual([]);
    expect(res.body.maxRetries).toBe(MAX_SYNC_RETRIES);
  });
});
