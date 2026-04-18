import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { requireAuth, type AuthRequest } from "./auth";
import { mobileDevices, offlineSyncQueue, mobilePendingUploads, projects, timeClockShifts, haulTickets, dailyInspectorReports, swpppInspections } from "@shared/schema";
import { eq, and, count, max, desc, gte } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

// Mobile sync typed contracts (shared by GET/POST sync handlers)
type SyncEntityKey = "HAUL_TICKET" | "INSPECTOR_REPORT" | "SWPPP_INSPECTION";
type OfflineOperation = "CREATE" | "UPDATE" | "DELETE";
type MobileSyncRecord = {
  id?: string;
  localId?: string;
  clientTimestamp?: string;
  attachments?: Array<{
    localId: string;
    name?: string;
    mime?: string;
    size?: number;
    objectKey?: string;
  }>;
  [k: string]: unknown;
};
type ProcessedItem = { localId: string; status: "QUEUED" | "CONFLICT"; serverUpdatedAt?: string };
type ConflictItem = {
  entityType: SyncEntityKey;
  entityId: string;
  localId?: string;
  serverUpdatedAt: string;
  clientTimestamp?: string;
};
// Org-scoped server lookup for conflict detection. Each entity's lookup runs
// a typed query bounded by both id AND organizationId to prevent any
// cross-tenant metadata leakage from the conflict response.
type ServerSyncRow = { updatedAt: Date | null };
const lookupServerRow: Record<SyncEntityKey, (id: string, orgId: string) => Promise<ServerSyncRow | undefined>> = {
  HAUL_TICKET: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: haulTickets.updatedAt })
      .from(haulTickets)
      .where(and(eq(haulTickets.id, id), eq(haulTickets.organizationId, orgId)))
      .limit(1);
    return row;
  },
  INSPECTOR_REPORT: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: dailyInspectorReports.updatedAt })
      .from(dailyInspectorReports)
      .where(and(eq(dailyInspectorReports.id, id), eq(dailyInspectorReports.organizationId, orgId)))
      .limit(1);
    return row;
  },
  SWPPP_INSPECTION: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: swpppInspections.updatedAt })
      .from(swpppInspections)
      .where(and(eq(swpppInspections.id, id), eq(swpppInspections.organizationId, orgId)))
      .limit(1);
    return row;
  },
};

router.get("/api/ai-features/mobile-sync", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const devices = await db.select().from(mobileDevices)
      .where(and(eq(mobileDevices.organizationId, orgId), eq(mobileDevices.userId, userId)))
      .orderBy(desc(mobileDevices.createdAt));

    const queue = await db.select().from(offlineSyncQueue)
      .where(and(eq(offlineSyncQueue.organizationId, orgId), eq(offlineSyncQueue.userId, userId)))
      .orderBy(desc(offlineSyncQueue.createdAt))
      .limit(50);

    const [deviceCount] = await db.select({ count: count() }).from(mobileDevices)
      .where(and(eq(mobileDevices.organizationId, orgId), eq(mobileDevices.userId, userId)));

    const [pendingCount] = await db.select({ count: count() }).from(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.organizationId, orgId),
        eq(offlineSyncQueue.userId, userId),
        eq(offlineSyncQueue.status, "PENDING")
      ));

    const [lastSyncRow] = await db.select({ lastSync: max(mobileDevices.lastSyncAt) }).from(mobileDevices)
      .where(and(eq(mobileDevices.organizationId, orgId), eq(mobileDevices.userId, userId)));

    const mappedDevices = devices.map(d => ({
      id: d.id,
      userId: d.userId,
      deviceName: d.deviceModel || d.deviceId,
      deviceType: d.platform as "IOS" | "ANDROID" | "PWA",
      lastSyncAt: d.lastSyncAt?.toISOString() || undefined,
      syncStatus: d.lastSyncAt ? "SYNCED" : "PENDING",
      offlineDataSize: 0,
      isActive: d.isActive,
      registeredAt: d.createdAt.toISOString(),
    }));

    const mappedQueue = queue.map(q => ({
      id: q.id,
      entityType: q.entityType,
      entityId: q.entityId || "",
      action: q.operationType as "CREATE" | "UPDATE" | "DELETE",
      status: q.status as "PENDING" | "SYNCING" | "SYNCED" | "FAILED",
      retryCount: q.retryCount,
      createdAt: q.createdAt.toISOString(),
    }));

    res.json({
      devices: mappedDevices,
      syncQueue: mappedQueue,
      stats: {
        totalDevices: deviceCount.count,
        pendingChanges: pendingCount.count,
        lastSync: lastSyncRow.lastSync?.toISOString() || null,
        offlineDataSize: 0,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/ai-features/mobile-sync/sync", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const { deviceId } = req.body || {};

    const conditions = [
      eq(offlineSyncQueue.organizationId, orgId),
      eq(offlineSyncQueue.userId, userId),
      eq(offlineSyncQueue.status, "PENDING"),
    ];

    const pendingItems = await db.select().from(offlineSyncQueue)
      .where(and(...conditions));

    if (pendingItems.length > 0) {
      await db.update(offlineSyncQueue)
        .set({ status: "SYNCED", syncedAt: new Date(), updatedAt: new Date() })
        .where(and(...conditions));
    }

    if (deviceId) {
      await db.update(mobileDevices)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(and(eq(mobileDevices.id, deviceId), eq(mobileDevices.organizationId, orgId)));
    } else {
      await db.update(mobileDevices)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(and(eq(mobileDevices.organizationId, orgId), eq(mobileDevices.userId, userId)));
    }

    res.json({ success: true, syncedCount: pendingItems.length });
  } catch (error: any) {
    next(error);
  }
});

router.delete("/api/ai-features/mobile-sync/devices/:deviceId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const { deviceId } = req.params;

    const [device] = await db.select().from(mobileDevices)
      .where(and(eq(mobileDevices.id, deviceId), eq(mobileDevices.organizationId, orgId)));

    if (!device) return res.status(404).json({ error: "Device not found" });

    await db.delete(mobileDevices)
      .where(and(eq(mobileDevices.id, deviceId), eq(mobileDevices.organizationId, orgId)));

    res.json({ success: true });
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/ai-features/mobile-sync/clear-offline", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    await db.delete(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.organizationId, orgId),
        eq(offlineSyncQueue.userId, userId),
        eq(offlineSyncQueue.status, "SYNCED")
      ));

    res.json({ success: true });
  } catch (error: any) {
    next(error);
  }
});

router.get("/api/ai-features/mobile-sync/conflicts", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const failedItems = await db.select().from(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.organizationId, orgId),
        eq(offlineSyncQueue.userId, userId),
        eq(offlineSyncQueue.status, "FAILED")
      ))
      .orderBy(desc(offlineSyncQueue.createdAt));

    const conflicts = failedItems.map(item => ({
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId || "",
      localValue: JSON.stringify(item.payload),
      serverValue: "",
      conflictedAt: item.updatedAt.toISOString(),
      status: "UNRESOLVED" as const,
    }));

    res.json(conflicts);
  } catch (error: any) {
    next(error);
  }
});

router.patch("/api/ai-features/mobile-sync/conflicts/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const { id } = req.params;
    const { resolution } = req.body;

    if (!resolution || !["LOCAL_WINS", "SERVER_WINS"].includes(resolution)) {
      return res.status(400).json({ error: "resolution must be LOCAL_WINS or SERVER_WINS" });
    }

    const [item] = await db.select().from(offlineSyncQueue)
      .where(and(eq(offlineSyncQueue.id, id), eq(offlineSyncQueue.organizationId, orgId)));

    if (!item) return res.status(404).json({ error: "Conflict not found" });

    if (resolution === "SERVER_WINS") {
      await db.delete(offlineSyncQueue)
        .where(and(eq(offlineSyncQueue.id, id), eq(offlineSyncQueue.organizationId, orgId)));
    } else {
      await db.update(offlineSyncQueue)
        .set({ status: "PENDING", retryCount: 0, errorMessage: null, updatedAt: new Date() })
        .where(and(eq(offlineSyncQueue.id, id), eq(offlineSyncQueue.organizationId, orgId)));
    }

    res.json({ success: true, resolution });
  } catch (error: any) {
    next(error);
  }
});

const deviceRegisterSchema = z.object({
  deviceId: z.string(),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  appVersion: z.string().optional(),
  deviceModel: z.string().optional(),
  pushToken: z.string().optional(),
});

router.post("/api/ai-features/mobile/register", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = deviceRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { deviceId, platform, appVersion, deviceModel, pushToken } = parsed.data;
    const syncToken = crypto.randomBytes(16).toString("hex");

    const existing = await db.select()
      .from(mobileDevices)
      .where(eq(mobileDevices.deviceId, deviceId))
      .limit(1);

    let device;
    if (existing.length > 0) {
      [device] = await db.update(mobileDevices)
        .set({
          platform,
          appVersion,
          deviceModel,
          pushToken,
          syncToken,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(mobileDevices.deviceId, deviceId))
        .returning();
    } else {
      [device] = await db.insert(mobileDevices).values({
        organizationId,
        userId,
        deviceId,
        platform,
        appVersion,
        deviceModel,
        pushToken,
        syncToken,
      }).returning();
    }

    res.json({
      success: true,
      registrationId: device.id,
      syncToken,
      syncEndpoint: "/api/ai-features/mobile/sync",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/ai-features/mobile/sync", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { lastSyncAt, deviceId } = req.query;
    const syncTime = lastSyncAt ? new Date(lastSyncAt as string) : new Date(0);
    const nextSyncToken = crypto.randomBytes(8).toString("hex");

    const projectChanges = await db.select()
      .from(projects)
      .where(and(
        eq(projects.gcOrganizationId, organizationId),
        gte(projects.updatedAt, syncTime)
      ))
      .limit(50);

    const shiftChanges = await db.select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.userId, userId),
        gte(timeClockShifts.updatedAt, syncTime)
      ))
      .limit(100);

    const haulChanges = await db.select()
      .from(haulTickets)
      .where(and(
        eq(haulTickets.organizationId, organizationId),
        gte(haulTickets.updatedAt, syncTime)
      ))
      .limit(200);

    const idrChanges = await db.select()
      .from(dailyInspectorReports)
      .where(and(
        eq(dailyInspectorReports.organizationId, organizationId),
        gte(dailyInspectorReports.updatedAt, syncTime)
      ))
      .limit(100);

    const swpppChanges = await db.select()
      .from(swpppInspections)
      .where(and(
        eq(swpppInspections.organizationId, organizationId),
        gte(swpppInspections.updatedAt, syncTime)
      ))
      .limit(100);

    if (deviceId) {
      await db.update(mobileDevices)
        .set({ lastSyncAt: new Date(), syncToken: nextSyncToken })
        .where(eq(mobileDevices.deviceId, deviceId as string));
    }

    res.json({
      syncedAt: new Date().toISOString(),
      nextSyncToken,
      changes: {
        projects: {
          created: projectChanges.filter(p => p.createdAt >= syncTime),
          updated: projectChanges.filter(p => p.createdAt < syncTime),
          deleted: [],
        },
        timeClock: {
          shifts: shiftChanges,
          events: [],
        },
        haulTickets: haulChanges,
        dailyInspectorReports: idrChanges,
        swpppInspections: swpppChanges,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/ai-features/mobile/sync", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { deviceId, changes } = req.body as {
      deviceId?: string;
      changes?: {
        timeClockEvents?: Array<{ localId: string; [k: string]: unknown }>;
        haulTickets?: MobileSyncRecord[];
        dailyInspectorReports?: MobileSyncRecord[];
        swpppInspections?: MobileSyncRecord[];
      };
    };
    const processed: {
      timeClockEvents: ProcessedItem[];
      dailyLogs: ProcessedItem[];
      photos: ProcessedItem[];
      haulTickets: ProcessedItem[];
      dailyInspectorReports: ProcessedItem[];
      swpppInspections: ProcessedItem[];
      attachments: ProcessedItem[];
    } = { timeClockEvents: [], dailyLogs: [], photos: [], haulTickets: [], dailyInspectorReports: [], swpppInspections: [], attachments: [] };
    const conflicts: ConflictItem[] = [];

    if (changes?.timeClockEvents) {
      for (const event of changes.timeClockEvents) {
        await db.insert(mobilePendingUploads).values({
          deviceId,
          localId: event.localId,
          recordType: "TIME_CLOCK_EVENT",
          recordDataJson: JSON.stringify(event),
          status: "PENDING",
        });
        processed.timeClockEvents.push({ localId: event.localId, status: "QUEUED" });
      }
    }

    const queueOffline = async (entityType: SyncEntityKey, record: MobileSyncRecord): Promise<ProcessedItem> => {
      const localId: string = record.localId ?? record.id ?? "";
      // Conflict detection (org-scoped): when the client provides an existing
      // record.id and a clientTimestamp, compare against the server row's
      // updatedAt. The server lookup is org-scoped to prevent any
      // cross-tenant metadata leakage. If the server is newer, do not queue —
      // record a FAILED row in the existing offlineSyncQueue conflict pipeline
      // so the GET /conflicts endpoint surfaces it for resolution.
      if (record.id && record.clientTimestamp) {
        const server = await lookupServerRow[entityType](record.id, organizationId);
        if (server?.updatedAt && new Date(record.clientTimestamp) < server.updatedAt) {
          const serverIso = server.updatedAt.toISOString();
          // Persist the conflict in the existing FAILED-status conflict queue
          // consumed by GET /api/ai-features/mobile-sync/conflicts.
          await db.insert(offlineSyncQueue).values({
            organizationId,
            userId,
            operationType: "UPDATE",
            entityType,
            entityId: record.id,
            payload: record,
            status: "FAILED",
            errorMessage: `CONFLICT: server updatedAt ${serverIso} > client ${record.clientTimestamp}`,
            deviceId,
            clientTimestamp: new Date(record.clientTimestamp),
          });
          conflicts.push({
            entityType,
            entityId: record.id,
            localId,
            serverUpdatedAt: serverIso,
            clientTimestamp: record.clientTimestamp,
          });
          return { localId, status: "CONFLICT", serverUpdatedAt: serverIso };
        }
      }
      const operationType: OfflineOperation = record.id ? "UPDATE" : "CREATE";
      await db.insert(offlineSyncQueue).values({
        organizationId,
        userId,
        operationType,
        entityType,
        entityId: record.id ?? localId ?? null,
        payload: record,
        status: "PENDING",
        deviceId,
        clientTimestamp: record.clientTimestamp ? new Date(record.clientTimestamp) : null,
      });
      // Queue any inline attachments to mobilePendingUploads for binary upload
      if (Array.isArray(record.attachments)) {
        for (const att of record.attachments) {
          if (!att?.localId) continue;
          await db.insert(mobilePendingUploads).values({
            deviceId,
            localId: att.localId,
            recordType: `${entityType}_ATTACHMENT`,
            recordDataJson: JSON.stringify({
              parentEntityType: entityType,
              parentLocalId: localId,
              parentEntityId: record.id ?? null,
              name: att.name ?? null,
              mime: att.mime ?? null,
              size: att.size ?? null,
              objectKey: att.objectKey ?? null,
            }),
            status: "PENDING",
          });
          processed.attachments.push({ localId: att.localId, status: "QUEUED" });
        }
      }
      return { localId, status: "QUEUED" };
    };

    if (Array.isArray(changes?.haulTickets)) {
      for (const t of changes.haulTickets) {
        processed.haulTickets.push(await queueOffline("HAUL_TICKET", t));
      }
    }
    if (Array.isArray(changes?.dailyInspectorReports)) {
      for (const r of changes.dailyInspectorReports) {
        processed.dailyInspectorReports.push(await queueOffline("INSPECTOR_REPORT", r));
      }
    }
    if (Array.isArray(changes?.swpppInspections)) {
      for (const s of changes.swpppInspections) {
        processed.swpppInspections.push(await queueOffline("SWPPP_INSPECTION", s));
      }
    }

    res.json({
      success: true,
      processed,
      conflicts,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/ai-features/mobile/devices", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const devices = await db.select()
      .from(mobileDevices)
      .where(and(
        eq(mobileDevices.userId, userId),
        eq(mobileDevices.isActive, true)
      ))
      .orderBy(desc(mobileDevices.lastSyncAt));

    res.json({ devices });
  } catch (error) {
    next(error);
  }
});

export default router;
