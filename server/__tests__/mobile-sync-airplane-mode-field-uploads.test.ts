import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  mobileDevices,
  mobilePendingUploads,
  dailyReports,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__sync_field_uploads__";

interface ProcessedItem {
  localId: string;
  status: "QUEUED" | "CONFLICT" | "SAVED" | "DUPLICATE";
  serverId?: string;
}

interface SyncResponseBody {
  processed: {
    photos: ProcessedItem[];
    punchItems: ProcessedItem[];
    inspections: ProcessedItem[];
    dailyReports: ProcessedItem[];
    drawingMarkups: ProcessedItem[];
  };
}

let app: Express;
let orgId: string;
let userId: string;
let projectId: string;
let deviceTextId: string;
let devicePk: string;
let dupDailyReportLocalId: string;

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
      name: `Sync Field Uploads Org ${Date.now()}`,
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
      lastName: "Field",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning({ id: users.id });
  userId = user.id;

  const [proj] = await db
    .insert(projects)
    .values({
      name: `Sync Field Uploads Project`,
      code: `${TEST_PREFIX}P-${Date.now()}`,
      clientName: "Test Client",
      gcOrganizationId: orgId,
      status: "ACTIVE",
    })
    .returning({ id: projects.id });
  projectId = proj.id;

  deviceTextId = `device-${TEST_PREFIX}-${Date.now()}`;
  const [device] = await db
    .insert(mobileDevices)
    .values({
      organizationId: orgId,
      userId,
      deviceId: deviceTextId,
      platform: "IOS",
      syncToken: "test-sync-token",
    })
    .returning({ id: mobileDevices.id });
  devicePk = device.id;

  // Pre-seed a daily_reports row so that pushing the same submittedLocalId
  // again from the field will violate the (organizationId, submittedLocalId)
  // unique index and force the route into the queuePending fallback. This
  // is the cleanest way to exercise the DAILY_REPORT queuePending branch
  // without relying on schema validation rules that may evolve.
  dupDailyReportLocalId = `dr-dup-${Date.now()}`;
  await db.insert(dailyReports).values({
    organizationId: orgId,
    projectId,
    reportDate: "2026-02-01",
    notes: "pre-seeded so resync collides",
    submittedById: userId,
    submittedLocalId: dupDailyReportLocalId,
  });
}, 60_000);

afterAll(async () => {
  if (!orgId) return;
  await db.execute(sql`DELETE FROM mobile_pending_uploads WHERE device_id IN (SELECT id FROM mobile_devices WHERE organization_id = ${orgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM mobile_devices WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM punch_list_items WHERE project_id = ${projectId}`).catch(() => {});
  await db.execute(sql`DELETE FROM project_inspections WHERE project_id = ${projectId}`).catch(() => {});
  await db.execute(sql`DELETE FROM media WHERE project_id = ${projectId}`).catch(() => {});
  await db.execute(sql`DELETE FROM daily_reports WHERE organization_id = ${orgId}`).catch(() => {});
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

function buildFallbackPayload(deviceId: string | undefined) {
  // Each item is intentionally crafted so the direct-persist branch fails
  // its precondition checks (or, for DAILY_REPORT, its unique index) and
  // falls back into the mobilePendingUploads queuePending branch — the
  // surface this test is meant to cover.
  return {
    ...(deviceId ? { deviceId } : {}),
    changes: {
      // PHOTO: direct persist requires validProject + fileUrl + fileName.
      // Omit projectId so it falls back.
      photos: [
        {
          localId: "photo-fallback-1",
          fileUrl: "https://example.com/p.jpg",
          fileName: "p.jpg",
          mime: "image/jpeg",
          size: 1024,
        },
      ],
      // PUNCH_ITEM: direct persist requires validProject + title.
      // Omit projectId so it falls back.
      punchItems: [
        {
          localId: "punch-fallback-1",
          title: "Touch up paint",
          description: "Hallway near room 101",
        },
      ],
      // INSPECTION: direct persist requires validProject + inspectionType + title.
      // Omit projectId so it falls back.
      inspections: [
        {
          localId: "inspection-fallback-1",
          inspectionType: "CITY_OFFICIAL",
          title: "Pre-pour inspection",
        },
      ],
      // DAILY_REPORT: direct persist will collide with the pre-seeded
      // (organization_id, submitted_local_id) unique row, so the catch
      // branch routes the payload into queuePending.
      dailyReports: [
        {
          localId: dupDailyReportLocalId,
          projectId,
          date: "2026-02-01",
          notes: "field resync should fall back",
        },
      ],
      // DRAWING_MARKUP: queuePending is the only branch — no direct
      // persist exists for this entity type today.
      drawingMarkups: [
        {
          localId: "markup-fallback-1",
          drawingId: "drw-1",
          shape: "RECT",
          coords: [0, 0, 10, 10],
        },
      ],
    },
  };
}

describe("Mobile sync — PHOTO / PUNCH_ITEM / INSPECTION / DAILY_REPORT / DRAWING_MARKUP queuePending branch", () => {
  it("queues each field-app entity type into mobile_pending_uploads with the registered devicePk and PENDING status", async () => {
    const res = await authedPost("/api/ai-features/mobile/sync", buildFallbackPayload(deviceTextId));

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;

    // Each entity type returned exactly one processed entry, and the
    // queuePending fallback path tags items with the QUEUED status.
    const expectations: Array<{ key: keyof SyncResponseBody["processed"]; localId: string; recordType: string }> = [
      { key: "photos", localId: "photo-fallback-1", recordType: "PHOTO" },
      { key: "punchItems", localId: "punch-fallback-1", recordType: "PUNCH_ITEM" },
      { key: "inspections", localId: "inspection-fallback-1", recordType: "INSPECTION" },
      { key: "dailyReports", localId: dupDailyReportLocalId, recordType: "DAILY_REPORT" },
      { key: "drawingMarkups", localId: "markup-fallback-1", recordType: "DRAWING_MARKUP" },
    ];

    for (const exp of expectations) {
      const list = body.processed[exp.key];
      expect(list, `expected processed.${exp.key} to be present`).toBeDefined();
      const entry = list.find((p) => p.localId === exp.localId);
      expect(entry, `expected processed.${exp.key} to contain ${exp.localId}`).toBeDefined();
      expect(entry!.status).toBe("QUEUED");
    }

    // mobile_pending_uploads must have exactly one PENDING row per entity
    // with the correct record_type and the resolved devicePk (FK target).
    for (const exp of expectations) {
      const rows = await db
        .select()
        .from(mobilePendingUploads)
        .where(
          and(
            eq(mobilePendingUploads.deviceId, devicePk),
            eq(mobilePendingUploads.localId, exp.localId),
            eq(mobilePendingUploads.recordType, exp.recordType)
          )
        );

      expect(rows, `expected a mobile_pending_uploads row for ${exp.recordType}`).toHaveLength(1);
      expect(rows[0].status).toBe("PENDING");
      expect(rows[0].deviceId).toBe(devicePk);
      expect(rows[0].recordType).toBe(exp.recordType);
      // The original payload is preserved verbatim so office processing
      // can still materialise the record server-side.
      const parsed = JSON.parse(rows[0].recordDataJson) as { localId?: string };
      expect(parsed.localId).toBe(exp.localId);
    }
  });

  it("returns 412 DEVICE_NOT_REGISTERED when the field client posts these uploads without a registered deviceId", async () => {
    // Reuse the same payload shape but omit the deviceId so devicePk
    // stays null inside the route. The first queuePending call must
    // throw, the outer handler must translate that to 412, and no new
    // mobile_pending_uploads rows may be written in this request.
    const before = await db
      .select({ id: mobilePendingUploads.id })
      .from(mobilePendingUploads)
      .where(eq(mobilePendingUploads.deviceId, devicePk));

    const res = await authedPost(
      "/api/ai-features/mobile/sync",
      buildFallbackPayload(undefined)
    );

    expect(res.status).toBe(412);
    expect(res.body?.code).toBe("DEVICE_NOT_REGISTERED");

    const after = await db
      .select({ id: mobilePendingUploads.id })
      .from(mobilePendingUploads)
      .where(eq(mobilePendingUploads.deviceId, devicePk));
    expect(after.length).toBe(before.length);
  });
});
