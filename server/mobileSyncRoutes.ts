import { Router } from "express";
import { db } from "./db";
import { requireAuth, type AuthRequest } from "./auth";
import { mobileDevices, offlineSyncQueue } from "@shared/schema";
import { eq, and, count, max, desc } from "drizzle-orm";

const router = Router();

router.get("/api/ai-features/mobile-sync", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Mobile sync status error:", error.message);
    res.status(500).json({ error: "Failed to get mobile sync status" });
  }
});

router.post("/api/ai-features/mobile-sync/sync", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Mobile sync trigger error:", error.message);
    res.status(500).json({ error: "Failed to trigger sync" });
  }
});

router.delete("/api/ai-features/mobile-sync/devices/:deviceId", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Remove device error:", error.message);
    res.status(500).json({ error: "Failed to remove device" });
  }
});

router.post("/api/ai-features/mobile-sync/clear-offline", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Clear offline data error:", error.message);
    res.status(500).json({ error: "Failed to clear offline data" });
  }
});

router.get("/api/ai-features/mobile-sync/conflicts", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Get conflicts error:", error.message);
    res.status(500).json({ error: "Failed to get conflicts" });
  }
});

router.patch("/api/ai-features/mobile-sync/conflicts/:id", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Resolve conflict error:", error.message);
    res.status(500).json({ error: "Failed to resolve conflict" });
  }
});

export default router;
