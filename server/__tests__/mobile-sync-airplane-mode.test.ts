import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  haulTickets,
  mobileDevices,
  offlineSyncQueue,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__sync_airplane__";

interface ProcessedItem {
  localId: string;
  status: "QUEUED" | "CONFLICT";
  serverUpdatedAt?: string;
}

interface ConflictItem {
  entityType: string;
  entityId: string;
  serverUpdatedAt: string;
}

interface SyncResponseBody {
  processed: { haulTickets: ProcessedItem[] };
  conflicts: ConflictItem[];
}

interface ConflictListItem {
  id: string;
  entityType: string;
  entityId: string;
  localValue: string;
  status: "UNRESOLVED";
}

let app: Express;
let orgId: string;
let userId: string;
let projectId: string;
let deviceTextId: string;
let staleTicketId: string;
let healthyTicketId: string;
let staleTicketServerUpdatedAt: Date;
let healthyTicketServerUpdatedAt: Date;

async function buildApp(): Promise<Express> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const mobileSyncRoutes = (await import("../mobileSyncRoutes")).default;

  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(cookieParser());

  a.use((req: Request & { user?: { id: string; organizationId: string; role: string } }, _res: Response, next: NextFunction) => {
    const headerUserId = req.header("x-test-user-id");
    const headerOrgId = req.header("x-test-org-id");
    if (headerUserId && headerOrgId) {
      req.user = { id: headerUserId, organizationId: headerOrgId, role: "ADMIN" };
    }
    next();
  });

  a.use(mobileSyncRoutes);
  return a;
}

beforeAll(async () => {
  app = await buildApp();

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Sync Airplane Org ${Date.now()}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning({ id: organizations.id });
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "Test",
      lastName: "Sync",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning({ id: users.id });
  userId = user.id;

  const [proj] = await db
    .insert(projects)
    .values({
      name: `Sync Airplane Project`,
      code: `${TEST_PREFIX}P-${Date.now()}`,
      clientName: "Test Client",
      gcOrganizationId: orgId,
      status: "ACTIVE",
    })
    .returning({ id: projects.id });
  projectId = proj.id;

  deviceTextId = `device-${TEST_PREFIX}-${Date.now()}`;
  await db.insert(mobileDevices).values({
    organizationId: orgId,
    userId,
    deviceId: deviceTextId,
    platform: "IOS",
    syncToken: "test-sync-token",
  });

  const [staleTicket] = await db
    .insert(haulTickets)
    .values({
      organizationId: orgId,
      projectId,
      ticketNumber: `T-STALE-${Date.now()}`,
      ticketDate: new Date().toISOString().slice(0, 10),
      materialClass: "TYPE_1_AGGREGATE",
      quantity: "10.000",
      unit: "TON",
    })
    .returning({ id: haulTickets.id, updatedAt: haulTickets.updatedAt });
  staleTicketId = staleTicket.id;
  staleTicketServerUpdatedAt = staleTicket.updatedAt;

  const [healthyTicket] = await db
    .insert(haulTickets)
    .values({
      organizationId: orgId,
      projectId,
      ticketNumber: `T-HEALTHY-${Date.now()}`,
      ticketDate: new Date().toISOString().slice(0, 10),
      materialClass: "TYPE_1_AGGREGATE",
      quantity: "20.000",
      unit: "TON",
    })
    .returning({ id: haulTickets.id, updatedAt: haulTickets.updatedAt });
  healthyTicketId = healthyTicket.id;
  healthyTicketServerUpdatedAt = healthyTicket.updatedAt;
}, 60_000);

afterAll(async () => {
  if (!orgId) return;
  await db.execute(sql`DELETE FROM offline_sync_queue WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM mobile_pending_uploads WHERE device_id IN (SELECT id FROM mobile_devices WHERE organization_id = ${orgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM mobile_devices WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM haul_tickets WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
}, 30_000);

function authedPost(path: string, body: unknown) {
  return request(app)
    .post(path)
    .set("X-Test-User-Id", userId)
    .set("X-Test-Org-Id", orgId)
    .set("Content-Type", "application/json")
    .send(body as object);
}

function authedGet(path: string) {
  return request(app)
    .get(path)
    .set("X-Test-User-Id", userId)
    .set("X-Test-Org-Id", orgId);
}

describe("Offline sync engine — airplane-mode scenarios", () => {
  it("queues a fresh CREATE, flags a stale UPDATE as CONFLICT, and queues a healthy UPDATE", async () => {
    const staleClientTs = new Date(staleTicketServerUpdatedAt.getTime() - 60_000).toISOString();
    const healthyClientTs = new Date(healthyTicketServerUpdatedAt.getTime() + 60_000).toISOString();

    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        haulTickets: [
          {
            localId: "local-create-1",
            ticketNumber: "T-NEW-1",
            quantity: 5,
            clientTimestamp: new Date().toISOString(),
          },
          {
            localId: "local-update-stale",
            id: staleTicketId,
            ticketNumber: "T-STALE-EDIT",
            clientTimestamp: staleClientTs,
          },
          {
            localId: "local-update-healthy",
            id: healthyTicketId,
            ticketNumber: "T-HEALTHY-EDIT",
            clientTimestamp: healthyClientTs,
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(Array.isArray(body.processed?.haulTickets)).toBe(true);
    expect(body.processed.haulTickets).toHaveLength(3);

    const byLocal: Record<string, ProcessedItem> = {};
    for (const p of body.processed.haulTickets) byLocal[p.localId] = p;

    expect(byLocal["local-create-1"].status).toBe("QUEUED");
    expect(byLocal["local-update-stale"].status).toBe("CONFLICT");
    expect(byLocal["local-update-stale"].serverUpdatedAt).toBe(
      staleTicketServerUpdatedAt.toISOString()
    );
    expect(byLocal["local-update-healthy"].status).toBe("QUEUED");

    expect(Array.isArray(body.conflicts)).toBe(true);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].entityId).toBe(staleTicketId);

    const rows = await db
      .select()
      .from(offlineSyncQueue)
      .where(
        and(
          eq(offlineSyncQueue.organizationId, orgId),
          eq(offlineSyncQueue.userId, userId)
        )
      );

    const pending = rows.filter((r) => r.status === "PENDING");
    const failed = rows.filter((r) => r.status === "FAILED");
    expect(pending).toHaveLength(2);
    expect(failed).toHaveLength(1);

    const conflictRow = failed[0];
    expect(conflictRow.entityType).toBe("HAUL_TICKET");
    expect(conflictRow.entityId).toBe(staleTicketId);
    expect(conflictRow.errorMessage || "").toMatch(/^CONFLICT:/);
    expect(conflictRow.operationType).toBe("UPDATE");
  });

  it("surfaces the CONFLICT row through GET /api/ai-features/mobile-sync/conflicts", async () => {
    const res = await authedGet("/api/ai-features/mobile-sync/conflicts");
    expect(res.status).toBe(200);
    const list = res.body as ConflictListItem[];
    expect(Array.isArray(list)).toBe(true);
    const conflict = list.find((c) => c.entityId === staleTicketId);
    expect(conflict).toBeDefined();
    expect(conflict!.entityType).toBe("HAUL_TICKET");
    expect(conflict!.status).toBe("UNRESOLVED");
    const parsed = JSON.parse(conflict!.localValue) as { id: string; ticketNumber: string };
    expect(parsed.id).toBe(staleTicketId);
    expect(parsed.ticketNumber).toBe("T-STALE-EDIT");
  });
});
