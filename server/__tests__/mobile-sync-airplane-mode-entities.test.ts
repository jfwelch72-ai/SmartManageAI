import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  dailyInspectorReports,
  swpppInspections,
  rfis,
  mobileDevices,
  offlineSyncQueue,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__sync_airplane_entities__";

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
  processed: {
    dailyInspectorReports: ProcessedItem[];
    swpppInspections: ProcessedItem[];
    rfis: ProcessedItem[];
  };
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

interface EntityFixture {
  staleId: string;
  staleUpdatedAt: Date;
  healthyId: string;
  healthyUpdatedAt: Date;
}

let idr: EntityFixture;
let swppp: EntityFixture;
let rfi: EntityFixture;

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
      name: `Sync Airplane Entities Org ${Date.now()}`,
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
      name: `Sync Airplane Entities Project`,
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

  // Inspector reports — unique on (project_id, report_date), so use distinct dates.
  const [staleIdr] = await db
    .insert(dailyInspectorReports)
    .values({
      organizationId: orgId,
      projectId,
      reportDate: "2026-01-01",
      reportNumber: "IDR-STALE",
      workPerformed: "initial",
    })
    .returning({ id: dailyInspectorReports.id, updatedAt: dailyInspectorReports.updatedAt });
  const [healthyIdr] = await db
    .insert(dailyInspectorReports)
    .values({
      organizationId: orgId,
      projectId,
      reportDate: "2026-01-02",
      reportNumber: "IDR-HEALTHY",
      workPerformed: "initial",
    })
    .returning({ id: dailyInspectorReports.id, updatedAt: dailyInspectorReports.updatedAt });
  idr = {
    staleId: staleIdr.id,
    staleUpdatedAt: staleIdr.updatedAt,
    healthyId: healthyIdr.id,
    healthyUpdatedAt: healthyIdr.updatedAt,
  };

  const [staleSwppp] = await db
    .insert(swpppInspections)
    .values({
      organizationId: orgId,
      projectId,
      inspectionDate: "2026-01-01",
      inspectionType: "ROUTINE",
      notes: "initial",
    })
    .returning({ id: swpppInspections.id, updatedAt: swpppInspections.updatedAt });
  const [healthySwppp] = await db
    .insert(swpppInspections)
    .values({
      organizationId: orgId,
      projectId,
      inspectionDate: "2026-01-02",
      inspectionType: "ROUTINE",
      notes: "initial",
    })
    .returning({ id: swpppInspections.id, updatedAt: swpppInspections.updatedAt });
  swppp = {
    staleId: staleSwppp.id,
    staleUpdatedAt: staleSwppp.updatedAt,
    healthyId: healthySwppp.id,
    healthyUpdatedAt: healthySwppp.updatedAt,
  };

  const [staleRfi] = await db
    .insert(rfis)
    .values({
      organizationId: orgId,
      projectId,
      rfiNumber: `RFI-STALE-${Date.now()}`,
      subject: "Stale RFI",
      question: "initial?",
      submittedById: userId,
    })
    .returning({ id: rfis.id, updatedAt: rfis.updatedAt });
  const [healthyRfi] = await db
    .insert(rfis)
    .values({
      organizationId: orgId,
      projectId,
      rfiNumber: `RFI-HEALTHY-${Date.now()}`,
      subject: "Healthy RFI",
      question: "initial?",
      submittedById: userId,
    })
    .returning({ id: rfis.id, updatedAt: rfis.updatedAt });
  rfi = {
    staleId: staleRfi.id,
    staleUpdatedAt: staleRfi.updatedAt,
    healthyId: healthyRfi.id,
    healthyUpdatedAt: healthyRfi.updatedAt,
  };
}, 60_000);

afterAll(async () => {
  if (!orgId) return;
  await db.execute(sql`DELETE FROM offline_sync_queue WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM mobile_pending_uploads WHERE device_id IN (SELECT id FROM mobile_devices WHERE organization_id = ${orgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM mobile_devices WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM rfis WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM swppp_inspections WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM daily_inspector_reports WHERE organization_id = ${orgId}`).catch(() => {});
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
    .send(body);
}

function authedGet(path: string) {
  return request(app)
    .get(path)
    .set("X-Test-User-Id", userId)
    .set("X-Test-Org-Id", orgId);
}

describe("Offline sync engine — INSPECTOR_REPORT / SWPPP_INSPECTION / RFI airplane-mode", () => {
  it("flags stale UPDATEs as CONFLICT, queues healthy UPDATEs and fresh CREATEs across all three entities", async () => {
    const staleIdrTs = new Date(idr.staleUpdatedAt.getTime() - 60_000).toISOString();
    const healthyIdrTs = new Date(idr.healthyUpdatedAt.getTime() + 60_000).toISOString();
    const staleSwpppTs = new Date(swppp.staleUpdatedAt.getTime() - 60_000).toISOString();
    const healthySwpppTs = new Date(swppp.healthyUpdatedAt.getTime() + 60_000).toISOString();
    const staleRfiTs = new Date(rfi.staleUpdatedAt.getTime() - 60_000).toISOString();
    const healthyRfiTs = new Date(rfi.healthyUpdatedAt.getTime() + 60_000).toISOString();

    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        dailyInspectorReports: [
          {
            localId: "idr-create-1",
            reportNumber: "IDR-NEW",
            workPerformed: "new work",
            clientTimestamp: new Date().toISOString(),
          },
          {
            localId: "idr-update-stale",
            id: idr.staleId,
            workPerformed: "stale edit",
            clientTimestamp: staleIdrTs,
          },
          {
            localId: "idr-update-healthy",
            id: idr.healthyId,
            workPerformed: "healthy edit",
            clientTimestamp: healthyIdrTs,
          },
        ],
        swpppInspections: [
          {
            localId: "swppp-create-1",
            notes: "new inspection",
            clientTimestamp: new Date().toISOString(),
          },
          {
            localId: "swppp-update-stale",
            id: swppp.staleId,
            notes: "stale edit",
            clientTimestamp: staleSwpppTs,
          },
          {
            localId: "swppp-update-healthy",
            id: swppp.healthyId,
            notes: "healthy edit",
            clientTimestamp: healthySwpppTs,
          },
        ],
        rfis: [
          {
            localId: "rfi-create-1",
            subject: "New RFI",
            question: "new question?",
            clientTimestamp: new Date().toISOString(),
          },
          {
            localId: "rfi-update-stale",
            id: rfi.staleId,
            subject: "Stale RFI edit",
            clientTimestamp: staleRfiTs,
          },
          {
            localId: "rfi-update-healthy",
            id: rfi.healthyId,
            subject: "Healthy RFI edit",
            clientTimestamp: healthyRfiTs,
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;

    const collect = (items: ProcessedItem[]): Record<string, ProcessedItem> => {
      const out: Record<string, ProcessedItem> = {};
      for (const p of items) out[p.localId] = p;
      return out;
    };

    const idrByLocal = collect(body.processed.dailyInspectorReports);
    expect(body.processed.dailyInspectorReports).toHaveLength(3);
    expect(idrByLocal["idr-create-1"].status).toBe("QUEUED");
    expect(idrByLocal["idr-update-stale"].status).toBe("CONFLICT");
    expect(idrByLocal["idr-update-stale"].serverUpdatedAt).toBe(idr.staleUpdatedAt.toISOString());
    expect(idrByLocal["idr-update-healthy"].status).toBe("QUEUED");

    const swpppByLocal = collect(body.processed.swpppInspections);
    expect(body.processed.swpppInspections).toHaveLength(3);
    expect(swpppByLocal["swppp-create-1"].status).toBe("QUEUED");
    expect(swpppByLocal["swppp-update-stale"].status).toBe("CONFLICT");
    expect(swpppByLocal["swppp-update-stale"].serverUpdatedAt).toBe(swppp.staleUpdatedAt.toISOString());
    expect(swpppByLocal["swppp-update-healthy"].status).toBe("QUEUED");

    const rfiByLocal = collect(body.processed.rfis);
    expect(body.processed.rfis).toHaveLength(3);
    expect(rfiByLocal["rfi-create-1"].status).toBe("QUEUED");
    expect(rfiByLocal["rfi-update-stale"].status).toBe("CONFLICT");
    expect(rfiByLocal["rfi-update-stale"].serverUpdatedAt).toBe(rfi.staleUpdatedAt.toISOString());
    expect(rfiByLocal["rfi-update-healthy"].status).toBe("QUEUED");

    expect(Array.isArray(body.conflicts)).toBe(true);
    expect(body.conflicts).toHaveLength(3);
    const conflictsByEntity: Record<string, ConflictItem> = {};
    for (const c of body.conflicts) conflictsByEntity[c.entityType] = c;
    expect(conflictsByEntity.INSPECTOR_REPORT.entityId).toBe(idr.staleId);
    expect(conflictsByEntity.SWPPP_INSPECTION.entityId).toBe(swppp.staleId);
    expect(conflictsByEntity.RFI.entityId).toBe(rfi.staleId);

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
    // 3 creates + 3 healthy updates = 6 PENDING, 3 stale updates = 3 FAILED
    expect(pending).toHaveLength(6);
    expect(failed).toHaveLength(3);

    const failedByEntity: Record<string, (typeof failed)[number]> = {};
    for (const f of failed) failedByEntity[f.entityType] = f;
    for (const entityType of ["INSPECTOR_REPORT", "SWPPP_INSPECTION", "RFI"]) {
      const row = failedByEntity[entityType];
      expect(row, `expected FAILED row for ${entityType}`).toBeDefined();
      expect(row.operationType).toBe("UPDATE");
      expect(row.errorMessage || "").toMatch(/^CONFLICT:/);
    }
  });

  it("surfaces all three CONFLICT rows through GET /api/ai-features/mobile-sync/conflicts", async () => {
    const res = await authedGet("/api/ai-features/mobile-sync/conflicts");
    expect(res.status).toBe(200);
    const list = res.body as ConflictListItem[];
    expect(Array.isArray(list)).toBe(true);

    const targets = [
      { entityType: "INSPECTOR_REPORT", entityId: idr.staleId },
      { entityType: "SWPPP_INSPECTION", entityId: swppp.staleId },
      { entityType: "RFI", entityId: rfi.staleId },
    ];
    for (const t of targets) {
      const conflict = list.find((c) => c.entityId === t.entityId);
      expect(conflict, `expected conflict for ${t.entityType}`).toBeDefined();
      expect(conflict!.entityType).toBe(t.entityType);
      expect(conflict!.status).toBe("UNRESOLVED");
      const parsed = JSON.parse(conflict!.localValue) as { id: string };
      expect(parsed.id).toBe(t.entityId);
    }
  });

  it("accepts the next push when the mobile client sets _resolution: LOCAL_WINS (resolution loop)", async () => {
    // Re-push the still-stale RFI edit with the LOCAL_WINS override flag.
    // Without the override, the timestamp check would still flag CONFLICT
    // because the server row has not changed since the previous push.
    const staleRfiTs = new Date(rfi.staleUpdatedAt.getTime() - 60_000).toISOString();

    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        rfis: [
          {
            localId: "rfi-update-stale-localwins",
            id: rfi.staleId,
            subject: "Local wins edit",
            clientTimestamp: staleRfiTs,
            _resolution: "LOCAL_WINS",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(body.processed.rfis).toHaveLength(1);
    expect(body.processed.rfis[0].status).toBe("QUEUED");
    expect(body.conflicts).toHaveLength(0);

    const rows = await db
      .select()
      .from(offlineSyncQueue)
      .where(
        and(
          eq(offlineSyncQueue.organizationId, orgId),
          eq(offlineSyncQueue.userId, userId),
          eq(offlineSyncQueue.entityType, "RFI"),
          eq(offlineSyncQueue.entityId, rfi.staleId),
          eq(offlineSyncQueue.status, "PENDING")
        )
      );
    // The LOCAL_WINS push should have produced a new PENDING row that bypasses
    // the conflict check; the original FAILED row remains untouched.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const localWinsRow = rows.find((r) => {
      const payload = r.payload as { _resolution?: string } | null;
      return payload?._resolution === "LOCAL_WINS";
    });
    expect(localWinsRow).toBeDefined();
    expect(localWinsRow!.operationType).toBe("UPDATE");
  });
});
