import { logError, logWarn } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { mobileDevices, offlineSyncQueue, mobilePendingUploads, projects, timeClockShifts, haulTickets, dailyInspectorReports, swpppInspections, rfis, dailyReports, media, punchListItems, projectInspections, submittals, submittalReviews, submittalActivity, mobileSyncEvents, payRuns, users } from "@shared/schema";
import { ENTITY_STRATEGY_MAP, type SyncStrategy, type SyncOutcome } from "@shared/schema/features/mobileSync";
import { eq, and, count, max, desc, gte, inArray, or, isNull, isNotNull, lte, lt } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { advanceChain } from "./submittalRoutes";
import { parsePagination, buildPage, setNextLinkHeader, cursorWhere, type PaginationCursor } from "./utils/pagination";

// Task #2693: per-entity conflict strategy engine helper.
// Writes a mobile_sync_events row for every push operation outcome.
async function writeSyncEvent(params: {
  organizationId: string;
  deviceId: string;
  entityType: string;
  localId?: string | null;
  serverId?: string | null;
  operation: string;
  strategy: SyncStrategy;
  outcome: SyncOutcome;
  clientTimestamp?: Date | null;
  logicalClock?: number | null;
  conflictPayload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(mobileSyncEvents).values({
      organizationId: params.organizationId,
      deviceId: params.deviceId,
      entityType: params.entityType,
      localId: params.localId ?? null,
      serverId: params.serverId ?? null,
      operation: params.operation,
      strategy: params.strategy,
      outcome: params.outcome,
      clientTimestamp: params.clientTimestamp ?? null,
      serverTimestamp: new Date(),
      logicalClock: params.logicalClock ?? null,
      conflictPayload: params.conflictPayload ?? null,
    });
  } catch (err) {
    // Non-fatal — never let sync event logging break the push response
    logWarn("[mobile-sync] Failed to write mobile_sync_events row", { entityType: params.entityType, err: String(err) });
  }
}

// Task #2693: time clock deduplication window (default 5 minutes in ms)
const TIME_CLOCK_DEDUP_WINDOW_MS = Number(process.env.TIME_CLOCK_DEDUP_WINDOW_MS ?? 5 * 60 * 1000);
// Task #2693: shift-end gap detection threshold (default 12 hours in ms)
const SHIFT_GAP_THRESHOLD_MS = Number(process.env.SHIFT_GAP_THRESHOLD_MS ?? 12 * 60 * 60 * 1000);

const router = Router();

// Mobile sync typed contracts (shared by GET/POST sync handlers)
type SyncEntityKey = "HAUL_TICKET" | "INSPECTOR_REPORT" | "SWPPP_INSPECTION" | "RFI"
  | "DAILY_REPORT" | "PUNCH_ITEM" | "INSPECTION" | "DRAWING_MARKUP";
type OfflineOperation = "CREATE" | "UPDATE" | "DELETE";
type MobileSyncRecord = {
  id?: string;
  localId?: string;
  clientTimestamp?: string;
  logicalClock?: number;
  attachments?: Array<{
    localId: string;
    name?: string;
    mime?: string;
    size?: number;
    objectKey?: string;
  }>;
  [k: string]: unknown;
};
type ProcessedItem = {
  localId: string;
  status: "QUEUED" | "CONFLICT" | "SAVED" | "DUPLICATE" | "FAILED";
  serverUpdatedAt?: string;
  serverId?: string;
  // Task #1607: when a SUBMITTAL_STAMP is rejected because the target
  // review row was already resolved (APPROVED/REJECTED/etc) by office
  // staff while the field reviewer was offline, we surface the
  // server-side status so the device can render a clear
  // "this review was already <status>" message instead of a generic
  // CONFLICT pill.
  serverStatus?: string;
  reason?: string;
};
type ConflictItem = {
  // Task #1607: SUBMITTAL_STAMP joins the conflict surface (alongside
  // the timestamp-based offline-queue entities) when the target review
  // is no longer actionable. Keep the union narrow — only entities the
  // server actually emits conflicts for.
  entityType: SyncEntityKey | "SUBMITTAL_STAMP";
  entityId: string;
  localId?: string;
  serverUpdatedAt: string;
  clientTimestamp?: string;
  reason?: string;
  serverStatus?: string;
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
  // Task #798: RFIs are first-class on the web AND queued from mobile, so
  // conflict detection (server-vs-client updatedAt comparison) applies the
  // same way as the legacy entities above.
  RFI: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: rfis.updatedAt })
      .from(rfis)
      .where(and(eq(rfis.id, id), eq(rfis.organizationId, orgId)))
      .limit(1);
    return row;
  },
  DAILY_REPORT: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: dailyReports.updatedAt })
      .from(dailyReports)
      .where(and(eq(dailyReports.id, id), eq(dailyReports.organizationId, orgId)))
      .limit(1);
    return row;
  },
  PUNCH_ITEM: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: punchListItems.updatedAt })
      .from(punchListItems)
      .innerJoin(projects, eq(projects.id, punchListItems.projectId))
      .where(and(eq(punchListItems.id, id), eq(projects.gcOrganizationId, orgId)))
      .limit(1);
    return row;
  },
  INSPECTION: async (id, orgId) => {
    const [row] = await db
      .select({ updatedAt: projectInspections.updatedAt })
      .from(projectInspections)
      .innerJoin(projects, eq(projects.id, projectInspections.projectId))
      .where(and(eq(projectInspections.id, id), eq(projects.gcOrganizationId, orgId)))
      .limit(1);
    return row;
  },
  // DRAWING_MARKUP has no authoritative server-side domain table yet (markups
  // are immutable overlay events stored only in mobilePendingUploads / GCS).
  // Returning undefined here means server?.updatedAt is always undefined so
  // the conflict-detection block is a no-op — the item always queues as PENDING
  // with the MERGE_FIELDS strategy tag for the background processor.
  DRAWING_MARKUP: async (_id: string, _orgId: string) => undefined,
};

// Full-row snapshot fetched only on the conflict path (not hot-path) so the
// conflict review UI can render both local and server versions side-by-side.
// Returns an opaque Record so the payload stays schema-agnostic.
const lookupServerSnapshot: Partial<Record<SyncEntityKey, (id: string, orgId: string) => Promise<Record<string, unknown> | undefined>>> = {
  HAUL_TICKET: async (id, orgId) => {
    const [row] = await db.select().from(haulTickets)
      .where(and(eq(haulTickets.id, id), eq(haulTickets.organizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
  },
  INSPECTOR_REPORT: async (id, orgId) => {
    const [row] = await db.select().from(dailyInspectorReports)
      .where(and(eq(dailyInspectorReports.id, id), eq(dailyInspectorReports.organizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
  },
  SWPPP_INSPECTION: async (id, orgId) => {
    const [row] = await db.select().from(swpppInspections)
      .where(and(eq(swpppInspections.id, id), eq(swpppInspections.organizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
  },
  RFI: async (id, orgId) => {
    const [row] = await db.select().from(rfis)
      .where(and(eq(rfis.id, id), eq(rfis.organizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
  },
  DAILY_REPORT: async (id, orgId) => {
    const [row] = await db.select().from(dailyReports)
      .where(and(eq(dailyReports.id, id), eq(dailyReports.organizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
  },
  PUNCH_ITEM: async (id, orgId) => {
    const [row] = await db.select({
      id: punchListItems.id, title: punchListItems.title, description: punchListItems.description,
      status: punchListItems.status, priority: punchListItems.priority,
      assignedToName: punchListItems.assignedToName, dueDate: punchListItems.dueDate,
      updatedAt: punchListItems.updatedAt, createdAt: punchListItems.createdAt,
    })
      .from(punchListItems)
      .innerJoin(projects, eq(projects.id, punchListItems.projectId))
      .where(and(eq(punchListItems.id, id), eq(projects.gcOrganizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
  },
  INSPECTION: async (id, orgId) => {
    const [row] = await db.select({
      id: projectInspections.id, title: projectInspections.title,
      status: projectInspections.status, inspectionType: projectInspections.inspectionType,
      scheduledDate: projectInspections.scheduledDate, completedDate: projectInspections.completedDate,
      updatedAt: projectInspections.updatedAt, createdAt: projectInspections.createdAt,
    })
      .from(projectInspections)
      .innerJoin(projects, eq(projects.id, projectInspections.projectId))
      .where(and(eq(projectInspections.id, id), eq(projects.gcOrganizationId, orgId))).limit(1);
    return row as Record<string, unknown> | undefined;
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
    const actorId = req.user!.id;
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

    // Task #2693: write a mobile_sync_events resolution record so the audit log
    // captures every manual override action from the legacy conflict endpoint.
    const strategy: SyncStrategy = ENTITY_STRATEGY_MAP[
      (item.entityType ?? "") as keyof typeof ENTITY_STRATEGY_MAP
    ] ?? "LAST_WRITE_WINS";
    await writeSyncEvent({
      organizationId: orgId,
      deviceId: item.deviceId ?? "unknown",
      entityType: item.entityType ?? "UNKNOWN",
      localId: null,
      serverId: item.entityId ?? null,
      operation: item.operationType ?? "UPDATE",
      strategy,
      outcome: "SAVED",
      clientTimestamp: item.clientTimestamp ?? null,
      logicalClock: null,
      conflictPayload: {
        resolution,
        resolvedBy: actorId,
        resolvedAt: new Date().toISOString(),
        originalError: item.errorMessage ?? null,
      },
    });

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

    // RFIs are first-class on the web — pull them so the mobile RFI screen
    // can render server-backed data (not just locally-queued drafts).
    const rfiChanges = await db.select()
      .from(rfis)
      .where(and(
        eq(rfis.organizationId, organizationId),
        gte(rfis.updatedAt, syncTime)
      ))
      .limit(100);

    // Task #1599: pull submittals the user actually participates in —
    // either as the submitter OR as a (current/past) reviewer. This
    // keeps the mobile cache focused on the user's own work instead of
    // sending the whole org's submittal log over LTE.
    const reviewedSubmittalIds = await db.selectDistinct({
      submittalId: submittalReviews.submittalId,
    })
      .from(submittalReviews)
      .where(and(
        eq(submittalReviews.organizationId, organizationId),
        eq(submittalReviews.reviewerId, userId),
      ));
    const involvedIds = reviewedSubmittalIds.map(r => r.submittalId);

    const submittalChanges = involvedIds.length === 0
      ? await db.select()
          .from(submittals)
          .where(and(
            eq(submittals.organizationId, organizationId),
            eq(submittals.submittedById, userId),
            gte(submittals.updatedAt, syncTime),
          ))
          .limit(100)
      : await db.select()
          .from(submittals)
          .where(and(
            eq(submittals.organizationId, organizationId),
            gte(submittals.updatedAt, syncTime),
            or(
              eq(submittals.submittedById, userId),
              inArray(submittals.id, involvedIds),
            ),
          ))
          .limit(100);

    // Task #1599: pull the FULL review chain for every submittal the
    // user can see in this delta — submitter OR any-time reviewer —
    // so the mobile Submittals screen can render the complete chain
    // detail (past steps with their stamps, the active IN_REVIEW row,
    // and future PENDING steps for context). We derive the chain set
    // from `submittalChanges` (the actual submittals returned to the
    // device) rather than only from reviewer-derived `involvedIds` so
    // submitter-only users — who never appear as a reviewerId — also
    // get the full chain context for their own submittals.
    //
    // This is read-only data for display; stamp authorization is
    // still enforced server-side in the SUBMITTAL_STAMP push handler,
    // which only accepts updates to rows the current user owns AND
    // whose status is IN_REVIEW (so a PENDING future step can never
    // be stamped out of sequence even if it appears in this pull).
    const visibleSubmittalIds = submittalChanges.map((s) => s.id);
    const submittalReviewChanges = visibleSubmittalIds.length === 0
      ? []
      : await db.select({
          id: submittalReviews.id,
          submittalId: submittalReviews.submittalId,
          organizationId: submittalReviews.organizationId,
          reviewerRole: submittalReviews.reviewerRole,
          reviewerId: submittalReviews.reviewerId,
          reviewerName: submittalReviews.reviewerName,
          sequenceOrder: submittalReviews.sequenceOrder,
          status: submittalReviews.status,
          comments: submittalReviews.comments,
          stampAction: submittalReviews.stampAction,
          dateAssigned: submittalReviews.dateAssigned,
          dateReviewed: submittalReviews.dateReviewed,
        })
          .from(submittalReviews)
          .where(and(
            eq(submittalReviews.organizationId, organizationId),
            inArray(submittalReviews.submittalId, visibleSubmittalIds),
          ))
          .limit(500);

    // Task #807: pull-down delta for the field-action entities now that
    // the POST handler persists them to first-class tables. Without these
    // sections the mobile cache could drift from the server (e.g. office
    // staff edits a punch item or daily report on the web).
    const dailyReportChanges = await db.select()
      .from(dailyReports)
      .where(and(
        eq(dailyReports.organizationId, organizationId),
        gte(dailyReports.updatedAt, syncTime)
      ))
      .limit(100);

    // media has no updatedAt column — fall back to uploadedAt for delta.
    // Org scoping rides on the projects join: media rows are always tied
    // to a project, and projects.gcOrganizationId is the tenant boundary.
    const photoChanges = await db.select({
      id: media.id,
      projectId: media.projectId,
      type: media.type,
      fileName: media.fileName,
      fileUrl: media.fileUrl,
      objectKey: media.objectKey,
      mimeType: media.mimeType,
      caption: media.caption,
      uploadedById: media.uploadedById,
      uploadedAt: media.uploadedAt,
    })
      .from(media)
      .innerJoin(projects, eq(projects.id, media.projectId))
      .where(and(
        eq(projects.gcOrganizationId, organizationId),
        gte(media.uploadedAt, syncTime),
        eq(media.type, "IMAGE"),
      ))
      .limit(200);

    const punchChanges = await db.select({
      id: punchListItems.id,
      projectId: punchListItems.projectId,
      itemNumber: punchListItems.itemNumber,
      title: punchListItems.title,
      description: punchListItems.description,
      status: punchListItems.status,
      priority: punchListItems.priority,
      trade: punchListItems.trade,
      assignedToName: punchListItems.assignedToName,
      assignedToEmail: punchListItems.assignedToEmail,
      dueDate: punchListItems.dueDate,
      createdAt: punchListItems.createdAt,
      updatedAt: punchListItems.updatedAt,
    })
      .from(punchListItems)
      .innerJoin(projects, eq(projects.id, punchListItems.projectId))
      .where(and(
        eq(projects.gcOrganizationId, organizationId),
        gte(punchListItems.updatedAt, syncTime),
      ))
      .limit(200);

    const inspectionChanges = await db.select({
      id: projectInspections.id,
      projectId: projectInspections.projectId,
      inspectionNumber: projectInspections.inspectionNumber,
      inspectionType: projectInspections.inspectionType,
      title: projectInspections.title,
      description: projectInspections.description,
      status: projectInspections.status,
      requestedDate: projectInspections.requestedDate,
      scheduledDate: projectInspections.scheduledDate,
      completedDate: projectInspections.completedDate,
      resultNotes: projectInspections.resultNotes,
      createdAt: projectInspections.createdAt,
      updatedAt: projectInspections.updatedAt,
    })
      .from(projectInspections)
      .innerJoin(projects, eq(projects.id, projectInspections.projectId))
      .where(and(
        eq(projects.gcOrganizationId, organizationId),
        gte(projectInspections.updatedAt, syncTime),
      ))
      .limit(200);

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
        rfis: rfiChanges,
        submittals: submittalChanges,
        submittalReviews: submittalReviewChanges,
        dailyReports: dailyReportChanges,
        photos: photoChanges,
        punchItems: punchChanges,
        inspections: inspectionChanges,
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
        // Task #798: native mobile field workflows. These are queued into
        // mobilePendingUploads using the same pattern as timeClockEvents and
        // attachments — office staff process them through the existing
        // mobile-pending-uploads worker. Persisting them here closes the gap
        // where mobile screens were enqueueing records that never reached
        // the server.
        photos?: Array<{ localId: string; [k: string]: unknown }>;
        punchItems?: Array<{ localId: string; [k: string]: unknown }>;
        rfis?: Array<{ localId: string; [k: string]: unknown }>;
        inspections?: Array<{ localId: string; [k: string]: unknown }>;
        dailyReports?: Array<{ localId: string; [k: string]: unknown }>;
        drawingMarkups?: Array<{ localId: string; [k: string]: unknown }>;
        // Task #1599: offline-queued submittal review stamps. Each entry
        // is keyed by submittal review id and carries the action enum.
        submittalStamps?: Array<{
          localId: string;
          submittalId: string;
          reviewId: string;
          action: string;
          comments?: string;
          [k: string]: unknown;
        }>;
      };
    };
    // CRITICAL: mobile_pending_uploads.device_id is a FK to mobileDevices.id
    // (UUID PK), but the mobile client sends the installation `deviceId`
    // (text/unique column on mobileDevices). Resolve the text id to the row
    // PK before any insert; if the device hasn't called /register yet, return
    // a structured 412 so the client can register and retry rather than
    // silently swallowing FK violations.
    let devicePk: string | null = null;
    if (deviceId) {
      const [device] = await db
        .select({ id: mobileDevices.id })
        .from(mobileDevices)
        .where(and(eq(mobileDevices.deviceId, deviceId), eq(mobileDevices.userId, userId)))
        .limit(1);
      if (!device) {
        return res.status(412).json({
          error: "Device not registered",
          code: "DEVICE_NOT_REGISTERED",
          hint: "POST /api/ai-features/mobile/register before syncing.",
        });
      }
      devicePk = device.id;
    }

    const processed: {
      timeClockEvents: ProcessedItem[];
      dailyLogs: ProcessedItem[];
      photos: ProcessedItem[];
      haulTickets: ProcessedItem[];
      dailyInspectorReports: ProcessedItem[];
      swpppInspections: ProcessedItem[];
      attachments: ProcessedItem[];
      punchItems: ProcessedItem[];
      rfis: ProcessedItem[];
      inspections: ProcessedItem[];
      dailyReports: ProcessedItem[];
      drawingMarkups: ProcessedItem[];
      submittalStamps: ProcessedItem[];
    } = { timeClockEvents: [], dailyLogs: [], photos: [], haulTickets: [], dailyInspectorReports: [], swpppInspections: [], attachments: [], punchItems: [], rfis: [], inspections: [], dailyReports: [], drawingMarkups: [], submittalStamps: [] };
    const conflicts: ConflictItem[] = [];

    if (changes?.timeClockEvents) {
      if (!devicePk) {
        return res.status(412).json({ error: "deviceId is required for time clock sync", code: "DEVICE_NOT_REGISTERED" });
      }
      // Task #2693: DEDUPLICATE_WINDOW strategy for time clock events.
      // Check for existing events within the dedup window before inserting.
      // Never silently discard — log DEDUPLICATED to mobile_sync_events so
      // the event is visible in the conflict review UI.
      for (const event of changes.timeClockEvents) {
        const localId: string = event.localId ?? "";
        const clientTs = event.clientTimestamp ? new Date(event.clientTimestamp as string) : new Date();
        const logicalClock = typeof event.logicalClock === "number" ? event.logicalClock : null;
        const strategy: SyncStrategy = "DEDUPLICATE_WINDOW";

        // Check dedup: look for existing pending upload with same device + worker
        // within the TIME_CLOCK_DEDUP_WINDOW_MS window around clientTs.
        const windowStart = new Date(clientTs.getTime() - TIME_CLOCK_DEDUP_WINDOW_MS);
        const windowEnd = new Date(clientTs.getTime() + TIME_CLOCK_DEDUP_WINDOW_MS);

        // Check mobilePendingUploads for events from this device with same
        // worker ID and event type within the window
        const workerId = typeof event.workerId === "string" ? event.workerId
          : typeof event.userId === "string" ? event.userId : null;
        const eventType = typeof event.eventType === "string" ? event.eventType : null;

        let isDuplicate = false;
        if (workerId && eventType && devicePk) {
          // Dedup: scan stored events for the same worker + eventType whose
          // clientTimestamp (stored in recordDataJson) falls within the
          // dedup window around the incoming event's clientTimestamp.
          // We parse clientTimestamp from the stored JSON — NOT createdAt —
          // to correctly dedup events that arrive out of order or are
          // re-pushed after a network failure.
          // Dedup is org-wide, not device-scoped — a worker can clock in
          // on one device and inadvertently re-sync from another (e.g. a
          // supervisor device) before the server-side shift materialises.
          // Join through mobileDevices to scope by org without relying on
          // the same-device FK.
          const candidateUploads = await db.select({ id: mobilePendingUploads.id, recordDataJson: mobilePendingUploads.recordDataJson })
            .from(mobilePendingUploads)
            .innerJoin(mobileDevices, eq(mobileDevices.id, mobilePendingUploads.deviceId))
            .where(and(
              eq(mobileDevices.organizationId, organizationId),
              eq(mobilePendingUploads.recordType, "TIME_CLOCK_EVENT"),
              // Broad createdAt window to bound the query, then check
              // actual clientTimestamp below in-process.
              gte(mobilePendingUploads.createdAt, new Date(clientTs.getTime() - 24 * 60 * 60 * 1000)),
              lte(mobilePendingUploads.createdAt, new Date(clientTs.getTime() + 24 * 60 * 60 * 1000)),
            ))
            .limit(100);

          for (const existing of candidateUploads) {
            try {
              const data = JSON.parse(existing.recordDataJson);
              // Check workerId matches
              const sameWorker = data.workerId === workerId || data.userId === workerId;
              // Check eventType matches
              const sameType = data.eventType === eventType;
              // Check localId is different (same localId = same record, not a dup)
              const differentRecord = data.localId !== localId;
              // Check clientTimestamp proximity using the actual event timestamp
              const existingTs = data.clientTimestamp ? new Date(data.clientTimestamp).getTime() : null;
              const withinWindow = existingTs !== null &&
                Math.abs(existingTs - clientTs.getTime()) <= TIME_CLOCK_DEDUP_WINDOW_MS;
              if (sameWorker && sameType && differentRecord && withinWindow) {
                isDuplicate = true;
                break;
              }
            } catch { }
          }
        }

        // Also check authoritative server-side shift records for the same
        // worker + event type within the dedup window. This catches
        // geofence-triggered server events that were never in the pending
        // uploads table but would duplicate a manual device clock-in/out.
        // Org-scoped via JOIN through users so a workerId collision across
        // tenants cannot produce a cross-tenant false-duplicate.
        if (!isDuplicate && workerId && eventType) {
          if (eventType === "CLOCK_IN") {
            const serverDup = await db.select({ id: timeClockShifts.id })
              .from(timeClockShifts)
              .innerJoin(users, eq(users.id, timeClockShifts.userId))
              .where(and(
                eq(timeClockShifts.userId, workerId),
                eq(users.organizationId, organizationId),
                gte(timeClockShifts.clockIn, windowStart),
                lte(timeClockShifts.clockIn, windowEnd),
              ))
              .limit(1);
            if (serverDup.length > 0) isDuplicate = true;
          } else if (eventType === "CLOCK_OUT") {
            const serverDup = await db.select({ id: timeClockShifts.id })
              .from(timeClockShifts)
              .innerJoin(users, eq(users.id, timeClockShifts.userId))
              .where(and(
                eq(timeClockShifts.userId, workerId),
                eq(users.organizationId, organizationId),
                isNotNull(timeClockShifts.clockOut),
                gte(timeClockShifts.clockOut, windowStart),
                lte(timeClockShifts.clockOut, windowEnd),
              ))
              .limit(1);
            if (serverDup.length > 0) isDuplicate = true;
          }
        }

        if (isDuplicate) {
          // Log as DEDUPLICATED — never silently discard
          await writeSyncEvent({
            organizationId,
            deviceId: deviceId ?? "unknown",
            entityType: "TIME_CLOCK_EVENT",
            localId,
            operation: "CREATE",
            strategy,
            outcome: "DEDUPLICATED",
            clientTimestamp: clientTs,
            logicalClock,
          });
          processed.timeClockEvents.push({ localId, status: "DUPLICATE" });
          continue;
        }

        await db.insert(mobilePendingUploads).values({
          deviceId: devicePk,
          localId,
          recordType: "TIME_CLOCK_EVENT",
          recordDataJson: JSON.stringify(event),
          status: "PENDING",
        });
        await writeSyncEvent({
          organizationId,
          deviceId: deviceId ?? "unknown",
          entityType: "TIME_CLOCK_EVENT",
          localId,
          operation: "CREATE",
          strategy,
          outcome: "SAVED",
          clientTimestamp: clientTs,
          logicalClock,
        });
        processed.timeClockEvents.push({ localId, status: "QUEUED" });
      }

      // Task #2693: time clock gap detection (idempotent).
      // After processing, scan open shifts for orphaned clock-ins (clockIn
      // without clockOut older than SHIFT_GAP_THRESHOLD_MS).
      // Scope includes the authenticated submitter AND every unique workerId
      // present in the submitted time clock events, so multi-worker payloads
      // (e.g. supervisor syncing crew events) don't miss orphaned shifts.
      // timeClockShifts has no organizationId column — scope by userId only
      // (userId is org-scoped via the users table FK).
      // Idempotency: skip writing if an unresolved FLAGGED event already
      // exists for the same shiftId so repeated syncs don't fan-out dupes.
      try {
        const gapThresholdDate = new Date(Date.now() - SHIFT_GAP_THRESHOLD_MS);
        // Collect all unique worker IDs from the submitted payload.
        const submittedWorkerIds = new Set<string>([userId]);
        for (const event of changes.timeClockEvents) {
          const wid = typeof event.workerId === "string" ? event.workerId
            : typeof event.userId === "string" ? event.userId : null;
          if (wid) submittedWorkerIds.add(wid);
        }
        const workerIdList = [...submittedWorkerIds];
        // Org-scoped via JOIN through users — prevents cross-tenant gap
        // detection if a workerId value collides across organizations.
        const openShifts = await db.select({
          id: timeClockShifts.id,
          userId: timeClockShifts.userId,
          clockIn: timeClockShifts.clockIn,
        })
          .from(timeClockShifts)
          .innerJoin(users, eq(users.id, timeClockShifts.userId))
          .where(and(
            inArray(timeClockShifts.userId, workerIdList),
            eq(users.organizationId, organizationId),
            isNull(timeClockShifts.clockOut),
            lt(timeClockShifts.clockIn, gapThresholdDate),
          ))
          .limit(50);

        for (const shift of openShifts) {
          // Idempotency guard: skip if an open FLAGGED gap event already exists
          // for this shiftId so repeated syncs don't produce duplicate flags.
          const [existing] = await db.select({ id: mobileSyncEvents.id })
            .from(mobileSyncEvents)
            .where(and(
              eq(mobileSyncEvents.organizationId, organizationId),
              eq(mobileSyncEvents.entityType, "TIME_CLOCK_GAP"),
              eq(mobileSyncEvents.serverId, shift.id),
              eq(mobileSyncEvents.outcome, "FLAGGED"),
              isNull(mobileSyncEvents.resolvedAt),
            ))
            .limit(1);
          if (existing) continue;

          await writeSyncEvent({
            organizationId,
            deviceId: deviceId ?? "unknown",
            entityType: "TIME_CLOCK_GAP",
            serverId: shift.id,
            operation: "DETECT",
            strategy: "FLAG_BOTH",
            outcome: "FLAGGED",
            clientTimestamp: null,
            conflictPayload: {
              shiftId: shift.id,
              workerId: shift.userId,
              clockIn: shift.clockIn?.toISOString(),
              detectedAt: new Date().toISOString(),
              reason: "Clock-in has no matching clock-out after threshold",
            },
          });
        }
      } catch (gapErr) {
        logError(gapErr, { route: "mobile-sync TIME_CLOCK_GAP detection" });
      }
    }

    const queueOffline = async (entityType: SyncEntityKey, record: MobileSyncRecord): Promise<ProcessedItem> => {
      const localId: string = record.localId ?? record.id ?? "";

      // Task #2693: resolve per-entity conflict strategy
      const strategy: SyncStrategy = ENTITY_STRATEGY_MAP[entityType as keyof typeof ENTITY_STRATEGY_MAP] ?? "LAST_WRITE_WINS";
      const clientTs = record.clientTimestamp ? new Date(record.clientTimestamp) : null;
      const logicalClock = typeof record.logicalClock === "number" ? record.logicalClock : null;

      // Mobile clients flag user-resolved "keep my changes" pushes with
      // _resolution: "LOCAL_WINS" so the server skips the conflict check.
      const overrideLocalWins =
        (record as { _resolution?: string })._resolution === "LOCAL_WINS" ||
        (record as { payload?: { _resolution?: string } })?.payload?._resolution === "LOCAL_WINS";

      // --- Task #2693: Per-entity pre-queue strategy execution ---

      // APPEND_ONLY: always accept, no conflict check possible.
      // Used for photo/media blobs — each upload is a distinct event.
      if (strategy === "APPEND_ONLY") {
        const operationType: OfflineOperation = "CREATE";
        await db.insert(offlineSyncQueue).values({
          organizationId, userId, operationType, entityType,
          entityId: record.id ?? localId ?? null,
          payload: { ...record, _syncStrategy: strategy },
          status: "PENDING", deviceId,
          clientTimestamp: clientTs ?? null,
        });
        await writeSyncEvent({
          organizationId, deviceId: deviceId ?? "unknown", entityType,
          localId, serverId: null, operation: operationType,
          strategy, outcome: "SAVED", clientTimestamp: clientTs, logicalClock,
        });
        return { localId, status: "QUEUED" };
      }

      // SERVER_WINS_STATUS_CLIENT_WINS_DRAFT: strip authoritative server fields
      // (status, statusReason, workflowState) from the client payload before
      // queuing so the server-controlled state machine is never overridden.
      let processedRecord = record;
      if (strategy === "SERVER_WINS_STATUS_CLIENT_WINS_DRAFT" && record.id) {
        const { status: _s, statusReason: _sr, workflowState: _ws, ...draftFields } = record as Record<string, unknown>;
        processedRecord = draftFields as MobileSyncRecord;
      }

      // Conflict detection (org-scoped): compare server updatedAt against
      // client timestamp. Scoped by both id AND organizationId.
      // Lamport tie-break: if wall-clock timestamps are identical and the
      // device carries a positive logicalClock (more recent mutations since
      // last sync), the device version is accepted without a conflict.
      if (!overrideLocalWins && processedRecord.id && processedRecord.clientTimestamp) {
        const server = await lookupServerRow[entityType](processedRecord.id, organizationId);
        if (server?.updatedAt) {
          const clientMs = new Date(processedRecord.clientTimestamp).getTime();
          const serverMs = server.updatedAt.getTime();
          // Lamport tie-break: ONLY applies when client and server wall-clock
          // timestamps are exactly equal (same millisecond). In that narrow
          // deterministic-tie case, a positive logical clock on the device
          // means the device has accumulated more mutations since the last sync
          // and its version is treated as the winner.
          //
          // A broader tolerance (e.g. 1 second) would let logicalClock > 0
          // suppress real conflicts where the server is genuinely newer, which
          // risks silent data loss. Since the logical clock is not compared
          // against a server-side counter (server has no LWW counter today),
          // the only safe tie-break scenario is exact wall-clock equality.
          const wallClockTie = clientMs === serverMs;
          const lamportClientWins = wallClockTie && logicalClock !== null && logicalClock > 0;
          if (clientMs < serverMs && !lamportClientWins) {
            const serverIso = server.updatedAt.toISOString();
            // Fetch full server snapshot so the conflict review UI can render
            // both versions side-by-side. Only fetched on the conflict path.
            const serverVersion = lookupServerSnapshot[entityType]
              ? await lookupServerSnapshot[entityType]!(processedRecord.id, organizationId)
              : undefined;

            if (strategy === "FLAG_BOTH") {
              // FLAG_BOTH: device version is held in FAILED status (not PENDING)
              // so the background processor cannot apply it before a manager
              // adjudicates the conflict. The FLAGGED event in mobile_sync_events
              // carries both local and server versions for the review UI.
              // heldQueueRowId is stored so the resolve endpoint can target this
              // exact row (avoiding broad entity-type scans that could affect
              // multiple FAILED rows for the same entity).
              const heldPayload = { ...processedRecord, _syncStrategy: strategy, _flaggedConflict: true };
              const [heldRow] = await db.insert(offlineSyncQueue).values({
                organizationId, userId, operationType: "UPDATE", entityType,
                entityId: processedRecord.id, payload: heldPayload,
                status: "FAILED",
                errorMessage: "HELD_FOR_REVIEW: FLAG_BOTH conflict requires manager adjudication before apply",
                deviceId, clientTimestamp: clientTs ?? null,
              }).returning({ id: offlineSyncQueue.id });
              await writeSyncEvent({
                organizationId, deviceId: deviceId ?? "unknown", entityType,
                localId, serverId: processedRecord.id, operation: "UPDATE",
                strategy, outcome: "FLAGGED", clientTimestamp: clientTs, logicalClock,
                conflictPayload: {
                  localVersion: processedRecord, serverVersion, serverUpdatedAt: serverIso,
                  heldQueueRowId: heldRow?.id ?? null,
                },
              });
              return { localId, status: "QUEUED" };
            }

            if (strategy === "MERGE_FIELDS") {
              // MERGE_FIELDS on conflict: DAILY_REPORT UPDATE is handled with an
              // inline merge in its own section (see below) so this branch is only
              // reached by future MERGE_FIELDS entity types that don't yet have an
              // inline merger. Fall back to queuing with _mergeBase so the item is
              // not lost; a future migration or processor can apply the merge later.
              const mergedPayload = { ...processedRecord, _syncStrategy: strategy, _mergeBase: serverIso };
              await db.insert(offlineSyncQueue).values({
                organizationId, userId, operationType: "UPDATE", entityType,
                entityId: processedRecord.id, payload: mergedPayload,
                status: "PENDING", deviceId, clientTimestamp: clientTs ?? null,
              });
              await writeSyncEvent({
                organizationId, deviceId: deviceId ?? "unknown", entityType,
                localId, serverId: processedRecord.id, operation: "UPDATE",
                strategy, outcome: "MERGED", clientTimestamp: clientTs, logicalClock,
                conflictPayload: { localVersion: processedRecord, serverVersion, serverUpdatedAt: serverIso },
              });
              return { localId, status: "QUEUED" };
            }

            // LAST_WRITE_WINS / SERVER_WINS_STATUS_CLIENT_WINS_DRAFT (conflict path):
            // Persist in the existing FAILED-status conflict queue consumed by
            // GET /api/ai-features/mobile-sync/conflicts for resolution.
            // heldQueueRowId stored for pinpoint targeting in the resolve endpoint.
            const [lwwHeldRow] = await db.insert(offlineSyncQueue).values({
              organizationId, userId, operationType: "UPDATE", entityType,
              entityId: processedRecord.id,
              payload: { ...processedRecord, _syncStrategy: strategy },
              status: "FAILED",
              errorMessage: `CONFLICT: server updatedAt ${serverIso} > client ${processedRecord.clientTimestamp}`,
              deviceId, clientTimestamp: clientTs ?? null,
            }).returning({ id: offlineSyncQueue.id });
            conflicts.push({
              entityType, entityId: processedRecord.id, localId,
              serverUpdatedAt: serverIso, clientTimestamp: processedRecord.clientTimestamp,
            });
            await writeSyncEvent({
              organizationId, deviceId: deviceId ?? "unknown", entityType,
              localId, serverId: processedRecord.id, operation: "UPDATE",
              strategy, outcome: "CONFLICT", clientTimestamp: clientTs, logicalClock,
              conflictPayload: {
                localVersion: processedRecord, serverVersion, serverUpdatedAt: serverIso,
                heldQueueRowId: lwwHeldRow?.id ?? null,
              },
            });
            return { localId, status: "CONFLICT", serverUpdatedAt: serverIso };
          }
        }
      }

      const operationType: OfflineOperation = processedRecord.id ? "UPDATE" : "CREATE";
      await db.insert(offlineSyncQueue).values({
        organizationId, userId, operationType, entityType,
        entityId: processedRecord.id ?? localId ?? null,
        payload: { ...processedRecord, _syncStrategy: strategy },
        status: "PENDING", deviceId,
        clientTimestamp: clientTs ?? null,
      });
      await writeSyncEvent({
        organizationId, deviceId: deviceId ?? "unknown", entityType,
        localId, serverId: processedRecord.id ?? null, operation: operationType,
        strategy, outcome: "SAVED", clientTimestamp: clientTs, logicalClock,
      });
      // Queue any inline attachments to mobilePendingUploads for binary upload
      if (Array.isArray(processedRecord.attachments) && devicePk) {
        for (const att of processedRecord.attachments) {
          if (!att?.localId) continue;
          await db.insert(mobilePendingUploads).values({
            deviceId: devicePk,
            localId: att.localId,
            recordType: `${entityType}_ATTACHMENT`,
            recordDataJson: JSON.stringify({
              parentEntityType: entityType,
              parentLocalId: localId,
              parentEntityId: processedRecord.id ?? null,
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

    // Task #798: queue native field-app entities into mobilePendingUploads.
    // These are kept distinct from the legacy offlineSyncQueue conflict
    // pipeline because they currently have no first-class table to merge
    // against — office processing materialises them server-side. Conflict
    // detection for these entities will land alongside their dedicated
    // tables in a follow-up.
    const queuePending = async (
      list: Array<{ localId: string; [k: string]: unknown }> | undefined,
      recordType: string,
      bucket: ProcessedItem[]
    ): Promise<void> => {
      if (!Array.isArray(list) || list.length === 0) return;
      // mobilePendingUploads.deviceId is a FK to mobileDevices.id (UUID PK).
      // Use the resolved devicePk — never the raw installation deviceId
      // string from the request — or the insert violates the FK.
      if (!devicePk) {
        throw new Error("DEVICE_NOT_REGISTERED");
      }
      const strategy: SyncStrategy = ENTITY_STRATEGY_MAP[recordType as keyof typeof ENTITY_STRATEGY_MAP] ?? "LAST_WRITE_WINS";
      for (const item of list) {
        if (!item?.localId) continue;
        await db.insert(mobilePendingUploads).values({
          deviceId: devicePk,
          localId: item.localId,
          recordType,
          recordDataJson: JSON.stringify({ ...item, _syncStrategy: strategy }),
          status: "PENDING",
        });
        bucket.push({ localId: item.localId, status: "QUEUED" });
        // Task #2693: every queued item writes a mobile_sync_events row.
        const clientTs = typeof item.clientTimestamp === "string" ? new Date(item.clientTimestamp) : null;
        const logicalClockVal = typeof item.logicalClock === "number" ? item.logicalClock : null;
        await writeSyncEvent({
          organizationId,
          deviceId: deviceId ?? "unknown",
          entityType: recordType,
          localId: item.localId,
          serverId: null,
          operation: "CREATE",
          strategy,
          outcome: "SAVED",
          clientTimestamp: clientTs,
          logicalClock: logicalClockVal,
        });
      }
    };
    // Task #807: persist field-action entities directly into first-class
    // server tables so office staff can see them on the existing web pages
    // (punch list, inspections, media gallery, RFIs, daily reports) instead
    // of waiting for a separate processing pass over mobilePendingUploads.
    // Each helper is best-effort: if required columns are missing or any
    // database error occurs, we fall back to queueing the raw payload into
    // mobilePendingUploads so nothing is lost.

    // Idempotency marker: we record every successful direct-persist as a
    // COMPLETED mobile_pending_uploads row keyed by (deviceId, localId,
    // recordType). Re-syncing the same localId becomes a no-op.
    const alreadyPersisted = async (recordType: string, localId: string): Promise<boolean> => {
      if (!devicePk) return false;
      const [existing] = await db.select({ id: mobilePendingUploads.id })
        .from(mobilePendingUploads)
        .where(and(
          eq(mobilePendingUploads.deviceId, devicePk),
          eq(mobilePendingUploads.localId, localId),
          eq(mobilePendingUploads.recordType, recordType),
          eq(mobilePendingUploads.status, "COMPLETED"),
        ))
        .limit(1);
      return !!existing;
    };
    const markPersisted = async (recordType: string, localId: string, payload: unknown): Promise<void> => {
      if (!devicePk) return;
      await db.insert(mobilePendingUploads).values({
        deviceId: devicePk,
        localId,
        recordType,
        recordDataJson: JSON.stringify(payload),
        status: "COMPLETED",
        processedAt: new Date(),
      });
    };

    // Verify a project belongs to the caller's org so a malicious client
    // cannot inject rows into other tenants' projects by guessing IDs.
    const projectInOrg = async (projectId: string | undefined | null): Promise<boolean> => {
      if (!projectId) return false;
      const [p] = await db.select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)))
        .limit(1);
      return !!p;
    };

    // ---- DAILY_REPORT ------------------------------------------------------
    if (Array.isArray(changes?.dailyReports)) {
      for (const item of changes.dailyReports) {
        if (!item?.localId) continue;
        const drClientTs = typeof item.clientTimestamp === "string" ? new Date(item.clientTimestamp) : null;
        const drLogicalClock = typeof item.logicalClock === "number" ? item.logicalClock : null;
        if (await alreadyPersisted("DAILY_REPORT", item.localId)) {
          processed.dailyReports.push({ localId: item.localId, status: "DUPLICATE" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "DAILY_REPORT",
            localId: item.localId, serverId: null, operation: "CREATE",
            strategy: "MERGE_FIELDS", outcome: "DEDUPLICATED",
            clientTimestamp: drClientTs, logicalClock: drLogicalClock,
          });
          continue;
        }
        // UPDATE path: if the payload carries a server ID, apply MERGE_FIELDS
        // inline — fetch the current server row, compute non-overlapping merged
        // values, and UPDATE the domain table directly. This replaces the former
        // queue-with-_mergeBase approach (which had no background processor to
        // actually execute the merge).
        //
        // Merge semantics:
        //   notes        — concatenate server + device if both non-null and differ
        //                  (server text is preserved first, device appended)
        //   weather      — device wins (field observation is most current)
        //   attachments  — union by localId (new device attachments appended)
        if (item.id && typeof item.id === "string") {
          const drServerId = item.id;
          try {
            const [serverRow] = await db.select().from(dailyReports)
              .where(and(
                eq(dailyReports.id, drServerId),
                eq(dailyReports.organizationId, organizationId),
              ))
              .limit(1);
            if (!serverRow) {
              // Row no longer exists — queue for retry as a safe fallback.
              await queuePending([item], "DAILY_REPORT", processed.dailyReports);
              continue;
            }
            // Merge: notes
            const devNotes = typeof item.notes === "string" ? item.notes.trim() : null;
            const srvNotes = typeof serverRow.notes === "string" ? serverRow.notes.trim() : null;
            let mergedNotes: string | null;
            if (!devNotes) {
              mergedNotes = srvNotes;
            } else if (!srvNotes || srvNotes === devNotes) {
              mergedNotes = devNotes;
            } else {
              mergedNotes = `${srvNotes}\n[Device addendum: ${devNotes}]`;
            }
            // Merge: weather (device field observation wins)
            const mergedWeather = typeof item.weather === "string" ? item.weather : serverRow.weather;
            // Merge: attachmentsJson (union by localId)
            type DailyReportAttachment = { localId?: string; name?: string; mime?: string; size?: number; objectKey?: string; url?: string };
            const srvAttachments: DailyReportAttachment[] = Array.isArray(serverRow.attachmentsJson)
              ? (serverRow.attachmentsJson as DailyReportAttachment[])
              : [];
            const devAttachments = Array.isArray(item.attachments)
              ? (item.attachments as Array<Record<string, unknown>>)
              : [];
            const srvLocalIds = new Set(srvAttachments.map((a) => a.localId).filter((id): id is string => typeof id === "string"));
            const newAttachments = devAttachments
              .filter((a) => typeof a.localId !== "string" || !srvLocalIds.has(a.localId))
              .map((a) => ({
                localId: typeof a.localId === "string" ? a.localId : undefined,
                name: typeof a.name === "string" ? a.name : undefined,
                mime: typeof a.mime === "string" ? a.mime : undefined,
                size: typeof a.size === "number" ? a.size : undefined,
                objectKey: typeof a.objectKey === "string" ? a.objectKey : undefined,
                url: typeof a.url === "string" ? a.url : undefined,
              }));
            await db.update(dailyReports).set({
              notes: mergedNotes,
              weather: mergedWeather,
              attachmentsJson: [...srvAttachments, ...newAttachments],
              updatedAt: new Date(),
            }).where(and(
              eq(dailyReports.id, drServerId),
              eq(dailyReports.organizationId, organizationId),
            ));
            await markPersisted("DAILY_REPORT", item.localId, item);
            processed.dailyReports.push({ localId: item.localId, status: "SAVED", serverId: drServerId });
            await writeSyncEvent({
              organizationId, deviceId: deviceId ?? "unknown", entityType: "DAILY_REPORT",
              localId: item.localId, serverId: drServerId, operation: "UPDATE",
              strategy: "MERGE_FIELDS", outcome: "MERGED",
              clientTimestamp: drClientTs, logicalClock: drLogicalClock,
              conflictPayload: { mergedFields: ["notes", "weather", "attachmentsJson"] },
            });
          } catch (err) {
            logError(err, { route: "mobile-sync DAILY_REPORT merge", localId: item.localId });
            await queuePending([item], "DAILY_REPORT", processed.dailyReports);
          }
          continue;
        }
        const projectId = typeof item.projectId === "string" ? item.projectId : null;
        const validProject = projectId && await projectInOrg(projectId);
        const reportDateRaw = (item.date ?? item.reportDate) as string | undefined;
        const reportDate = reportDateRaw && /^\d{4}-\d{2}-\d{2}/.test(reportDateRaw)
          ? reportDateRaw.slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        try {
          const [row] = await db.insert(dailyReports).values({
            organizationId,
            projectId: validProject ? projectId : null,
            reportDate,
            notes: typeof item.notes === "string" ? item.notes : null,
            weather: typeof item.weather === "string" ? item.weather : null,
            attachmentsJson: Array.isArray(item.attachments)
              ? (item.attachments as Array<Record<string, unknown>>).map((a) => ({
                  localId: typeof a.localId === "string" ? a.localId : undefined,
                  name: typeof a.name === "string" ? a.name : undefined,
                  mime: typeof a.mime === "string" ? a.mime : undefined,
                  size: typeof a.size === "number" ? a.size : undefined,
                  objectKey: typeof a.objectKey === "string" ? a.objectKey : undefined,
                  url: typeof a.url === "string" ? a.url : undefined,
                }))
              : [],
            submittedById: userId,
            submittedByDeviceId: deviceId ?? null,
            submittedLocalId: item.localId,
          }).returning({ id: dailyReports.id });
          await markPersisted("DAILY_REPORT", item.localId, item);
          processed.dailyReports.push({ localId: item.localId, status: "SAVED", serverId: row?.id });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "DAILY_REPORT",
            localId: item.localId, serverId: row?.id ?? null, operation: "CREATE",
            strategy: "MERGE_FIELDS", outcome: "SAVED",
            clientTimestamp: drClientTs, logicalClock: drLogicalClock,
          });
        } catch (err) {
          logError(err, { route: "mobile-sync DAILY_REPORT persist", localId: item.localId });
          await queuePending([item], "DAILY_REPORT", processed.dailyReports);
        }
      }
    }

    // ---- PHOTO -------------------------------------------------------------
    if (Array.isArray(changes?.photos)) {
      for (const item of changes.photos) {
        if (!item?.localId) continue;
        const phClientTs = typeof item.clientTimestamp === "string" ? new Date(item.clientTimestamp) : null;
        const phLogicalClock = typeof item.logicalClock === "number" ? item.logicalClock : null;
        if (await alreadyPersisted("PHOTO", item.localId)) {
          processed.photos.push({ localId: item.localId, status: "DUPLICATE" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "PHOTO",
            localId: item.localId, serverId: null, operation: "CREATE",
            strategy: "APPEND_ONLY", outcome: "DEDUPLICATED",
            clientTimestamp: phClientTs, logicalClock: phLogicalClock,
          });
          continue;
        }
        const projectId = typeof item.projectId === "string" ? item.projectId : null;
        const validProject = projectId && await projectInOrg(projectId);
        const fileUrl = typeof item.fileUrl === "string" ? item.fileUrl
          : typeof item.url === "string" ? item.url : null;
        const fileName = typeof item.fileName === "string" ? item.fileName
          : typeof item.name === "string" ? item.name : null;
        if (!validProject || !fileUrl || !fileName) {
          await queuePending([item], "PHOTO", processed.photos);
          continue;
        }
        try {
          const [row] = await db.insert(media).values({
            projectId: projectId!,
            type: "IMAGE",
            fileName,
            fileUrl,
            objectKey: typeof item.objectKey === "string" ? item.objectKey : null,
            mimeType: typeof item.mime === "string" ? item.mime
              : typeof item.mimeType === "string" ? item.mimeType : null,
            fileSize: typeof item.size === "number" ? item.size : null,
            caption: typeof item.caption === "string" ? item.caption
              : typeof item.notes === "string" ? item.notes : null,
            uploadedById: userId,
            uploadedAt: typeof item.takenAt === "string" ? new Date(item.takenAt) : new Date(),
          }).returning({ id: media.id });
          await markPersisted("PHOTO", item.localId, item);
          processed.photos.push({ localId: item.localId, status: "SAVED", serverId: row?.id });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "PHOTO",
            localId: item.localId, serverId: row?.id ?? null, operation: "CREATE",
            strategy: "APPEND_ONLY", outcome: "SAVED",
            clientTimestamp: phClientTs, logicalClock: phLogicalClock,
          });
        } catch (err) {
          logError(err, { route: "mobile-sync PHOTO persist", localId: item.localId });
          await queuePending([item], "PHOTO", processed.photos);
        }
      }
    }

    // ---- PUNCH_ITEM --------------------------------------------------------
    if (Array.isArray(changes?.punchItems)) {
      for (const item of changes.punchItems) {
        if (!item?.localId) continue;
        const piClientTs = typeof item.clientTimestamp === "string" ? new Date(item.clientTimestamp) : null;
        const piLogicalClock = typeof item.logicalClock === "number" ? item.logicalClock : null;
        if (await alreadyPersisted("PUNCH_ITEM", item.localId)) {
          processed.punchItems.push({ localId: item.localId, status: "DUPLICATE" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "PUNCH_ITEM",
            localId: item.localId, serverId: null, operation: "CREATE",
            strategy: "FLAG_BOTH", outcome: "DEDUPLICATED",
            clientTimestamp: piClientTs, logicalClock: piLogicalClock,
          });
          continue;
        }
        // UPDATE path: if the payload carries a server ID, route through the
        // strategy engine (FLAG_BOTH) so conflict detection is applied and
        // the device version is held for review when the server is newer.
        if (item.id && typeof item.id === "string") {
          const result = await queueOffline("PUNCH_ITEM", item as MobileSyncRecord);
          processed.punchItems.push(result);
          continue;
        }
        const projectId = typeof item.projectId === "string" ? item.projectId : null;
        const title = typeof item.title === "string" && item.title.trim().length > 0 ? item.title : null;
        const validProject = projectId && await projectInOrg(projectId);
        if (!validProject || !title) {
          await queuePending([item], "PUNCH_ITEM", processed.punchItems);
          continue;
        }
        try {
          const [{ n }] = await db.select({ n: count() })
            .from(punchListItems)
            .where(eq(punchListItems.projectId, projectId!));
          const itemNumber = `PLI-${String(projectId).slice(-6).toUpperCase()}-${String(Number(n) + 1).padStart(3, "0")}`;
          const [row] = await db.insert(punchListItems).values({
            projectId: projectId!,
            itemNumber,
            title,
            description: typeof item.description === "string" ? item.description : null,
            assignedToName: typeof item.assignee === "string" ? item.assignee
              : typeof item.assignedToName === "string" ? item.assignedToName : null,
            assignedToEmail: typeof item.assignedToEmail === "string" ? item.assignedToEmail : null,
            createdById: userId,
          }).returning({ id: punchListItems.id });
          await markPersisted("PUNCH_ITEM", item.localId, item);
          processed.punchItems.push({ localId: item.localId, status: "SAVED", serverId: row?.id });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "PUNCH_ITEM",
            localId: item.localId, serverId: row?.id ?? null, operation: "CREATE",
            strategy: "FLAG_BOTH", outcome: "SAVED",
            clientTimestamp: piClientTs, logicalClock: piLogicalClock,
          });
        } catch (err) {
          logError(err, { route: "mobile-sync PUNCH_ITEM persist", localId: item.localId });
          await queuePending([item], "PUNCH_ITEM", processed.punchItems);
        }
      }
    }

    // ---- RFI ---------------------------------------------------------------
    // RFIs continue through the conflict-detecting offline queue (so server
    // edits during offline windows surface in /conflicts), AND we attempt to
    // materialise the row in `rfis` so office staff see it on /rfi without
    // a separate processing pass.
    if (Array.isArray(changes?.rfis)) {
      for (const r of changes.rfis) {
        const queueResult = await queueOffline("RFI", r as MobileSyncRecord);
        processed.rfis.push(queueResult);
        if (queueResult.status !== "QUEUED" || !r?.localId) continue;
        if (await alreadyPersisted("RFI", r.localId)) continue;
        const projectId = typeof r.projectId === "string" ? r.projectId : null;
        const subject = typeof r.subject === "string" ? r.subject : null;
        const question = typeof r.question === "string" ? r.question : null;
        if (!projectId || !subject || !question) continue;
        if (!(await projectInOrg(projectId))) continue;
        try {
          const [{ n }] = await db.select({ n: count() })
            .from(rfis)
            .where(eq(rfis.organizationId, organizationId));
          const rfiNumber = typeof r.rfiNumber === "string" ? r.rfiNumber
            : `RFI-${String(Number(n) + 1).padStart(4, "0")}`;
          await db.insert(rfis).values({
            organizationId,
            projectId,
            rfiNumber,
            subject,
            question,
            submittedById: userId,
            submittedByName: typeof r.submittedByName === "string" ? r.submittedByName : null,
            dateSubmitted: new Date(),
          });
          await markPersisted("RFI", r.localId, r);
        } catch (err) {
          logError(err, { route: "mobile-sync RFI persist", localId: r.localId });
        }
      }
    }

    // ---- INSPECTION --------------------------------------------------------
    if (Array.isArray(changes?.inspections)) {
      for (const item of changes.inspections) {
        if (!item?.localId) continue;
        const insClientTs = typeof item.clientTimestamp === "string" ? new Date(item.clientTimestamp) : null;
        const insLogicalClock = typeof item.logicalClock === "number" ? item.logicalClock : null;
        if (await alreadyPersisted("INSPECTION", item.localId)) {
          processed.inspections.push({ localId: item.localId, status: "DUPLICATE" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "INSPECTION",
            localId: item.localId, serverId: null, operation: "CREATE",
            strategy: "FLAG_BOTH", outcome: "DEDUPLICATED",
            clientTimestamp: insClientTs, logicalClock: insLogicalClock,
          });
          continue;
        }
        // UPDATE path: if the payload carries a server ID, route through the
        // strategy engine (FLAG_BOTH) so conflict detection is applied and
        // the device version is held for review when the server is newer.
        if (item.id && typeof item.id === "string") {
          const result = await queueOffline("INSPECTION", item as MobileSyncRecord);
          processed.inspections.push(result);
          continue;
        }
        const projectId = typeof item.projectId === "string" ? item.projectId : null;
        const validProject = projectId && await projectInOrg(projectId);
        const ALLOWED_INSPECTION_TYPES = ["CITY_OFFICIAL", "GC_REPRESENTATIVE", "OWNER_REPRESENTATIVE"] as const;
        type InspectionType = typeof ALLOWED_INSPECTION_TYPES[number];
        const rawType = typeof item.inspectionType === "string" ? item.inspectionType.toUpperCase() : null;
        const inspectionType = (ALLOWED_INSPECTION_TYPES as readonly string[]).includes(rawType ?? "")
          ? (rawType as InspectionType)
          : null;
        const title = typeof item.title === "string" ? item.title : null;
        if (!validProject || !inspectionType || !title) {
          await queuePending([item], "INSPECTION", processed.inspections);
          continue;
        }
        try {
          const [{ n }] = await db.select({ n: count() })
            .from(projectInspections)
            .where(eq(projectInspections.projectId, projectId!));
          const inspectionNumber = `INSP-${String(projectId).slice(-6).toUpperCase()}-${String(Number(n) + 1).padStart(3, "0")}`;
          const completedAt = typeof item.completedAt === "string" ? new Date(item.completedAt) : null;
          const [row] = await db.insert(projectInspections).values({
            projectId: projectId!,
            inspectionNumber,
            inspectionType,
            title,
            description: typeof item.description === "string" ? item.description : null,
            requestedDate: completedAt ?? new Date(),
            completedDate: completedAt,
            status: completedAt ? "PASSED" : "REQUESTED",
            resultNotes: typeof item.answers === "string"
              ? item.answers
              : item.answers !== undefined ? JSON.stringify(item.answers) : null,
            createdById: userId,
          }).returning({ id: projectInspections.id });
          await markPersisted("INSPECTION", item.localId, item);
          processed.inspections.push({ localId: item.localId, status: "SAVED", serverId: row?.id });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "INSPECTION",
            localId: item.localId, serverId: row?.id ?? null, operation: "CREATE",
            strategy: "FLAG_BOTH", outcome: "SAVED",
            clientTimestamp: insClientTs, logicalClock: insLogicalClock,
          });
        } catch (err) {
          logError(err, { route: "mobile-sync INSPECTION persist", localId: item.localId });
          await queuePending([item], "INSPECTION", processed.inspections);
        }
      }
    }

    // DRAWING_MARKUP uses the strategy engine path (MERGE_FIELDS) so UPDATE
    // operations carry the _mergeBase sentinel for the background processor.
    // queueOffline() returns QUEUED for every item (no domain table = no
    // conflict detection; see lookupServerRow["DRAWING_MARKUP"]).
    if (Array.isArray(changes?.drawingMarkups)) {
      for (const item of changes.drawingMarkups) {
        if (!item?.localId) continue;
        const dmResult = await queueOffline("DRAWING_MARKUP", item as MobileSyncRecord);
        processed.drawingMarkups.push(dmResult);
      }
    }

    // ---- SUBMITTAL_STAMP ---------------------------------------------------
    // Apply queued review stamps from the field reviewer's device.
    if (Array.isArray(changes?.submittalStamps)) {
      const ALLOWED = ["APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"] as const;
      for (const stamp of changes.submittalStamps) {
        if (!stamp?.localId) continue;
        const ssClientTs = typeof stamp.clientTimestamp === "string" ? new Date(stamp.clientTimestamp) : null;
        const ssLogicalClock = typeof stamp.logicalClock === "number" ? stamp.logicalClock : null;
        if (await alreadyPersisted("SUBMITTAL_STAMP", stamp.localId)) {
          processed.submittalStamps.push({ localId: stamp.localId, status: "DUPLICATE" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "SUBMITTAL_STAMP",
            localId: stamp.localId, serverId: null, operation: "UPDATE",
            strategy: "LAST_WRITE_WINS", outcome: "DEDUPLICATED",
            clientTimestamp: ssClientTs, logicalClock: ssLogicalClock,
          });
          continue;
        }
        const reviewId = typeof stamp.reviewId === "string" ? stamp.reviewId : null;
        const submittalId = typeof stamp.submittalId === "string" ? stamp.submittalId : null;
        const action = typeof stamp.action === "string" ? stamp.action : null;
        if (!reviewId || !submittalId || !action || !(ALLOWED as readonly string[]).includes(action)) {
          processed.submittalStamps.push({ localId: stamp.localId, status: "FAILED" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "SUBMITTAL_STAMP",
            localId: stamp.localId, serverId: null, operation: "UPDATE",
            strategy: "LAST_WRITE_WINS", outcome: "FAILED",
            clientTimestamp: ssClientTs, logicalClock: ssLogicalClock,
            conflictPayload: { reason: "Missing or invalid reviewId/submittalId/action" },
          });
          continue;
        }
        try {
          // Strict authorization: the review must (a) belong to this
          // tenant, (b) be on the supplied submittal, (c) be assigned
          // to *this* user, and (d) still be open (PENDING/IN_REVIEW).
          // A tampered mobile payload that points at someone else's
          // review row, a closed review, or a row in another tenant
          // will not match and we return FAILED instead of touching
          // anything. This is a single SELECT so we can rely on the
          // result for both authz and the activity-row lookup.
          // Match the web stamp route exactly: only the currently
          // ACTIVE review row (status === "IN_REVIEW") may be stamped.
          // Allowing PENDING here would let a downstream reviewer act
          // before the chain has reached them, breaking sequence
          // integrity and short-circuiting the workflow.
          const [reviewRow] = await db
            .select({
              id: submittalReviews.id,
              submittalId: submittalReviews.submittalId,
              status: submittalReviews.status,
              reviewerId: submittalReviews.reviewerId,
              reviewerName: submittalReviews.reviewerName,
            })
            .from(submittalReviews)
            .innerJoin(submittals, eq(submittals.id, submittalReviews.submittalId))
            .where(and(
              eq(submittalReviews.id, reviewId),
              eq(submittalReviews.submittalId, submittalId),
              eq(submittalReviews.organizationId, organizationId),
              eq(submittals.organizationId, organizationId),
              eq(submittalReviews.reviewerId, userId),
              eq(submittalReviews.status, "IN_REVIEW"),
            ))
            .limit(1);
          // Task #1607: stale-review detection. The strict lookup
          // above rejects when status !== "IN_REVIEW", but it can't
          // tell the device *why* it failed (truly missing row vs.
          // resolved-by-office vs. wrong-reviewer-id). Run a
          // tenant- and reviewer-scoped lookup without the status
          // gate so we can distinguish a review that was already
          // stamped/cancelled by office staff while the field
          // reviewer was offline. When detected, surface it as a
          // CONFLICT (not a generic FAILED) so the mobile UI can
          // tell the user "office already resolved this review"
          // and let them clear the queued tap instead of silently
          // overwriting the resolved row.
          const RESOLVED_STATUSES = [
            "APPROVED",
            "APPROVED_AS_NOTED",
            "REJECTED",
            "REVISE_AND_RESUBMIT",
            "CANCELLED",
          ];
          const detectStale = async (): Promise<boolean> => {
            const [staleRow] = await db
              .select({
                id: submittalReviews.id,
                status: submittalReviews.status,
                dateReviewed: submittalReviews.dateReviewed,
                reviewerId: submittalReviews.reviewerId,
              })
              .from(submittalReviews)
              .innerJoin(submittals, eq(submittals.id, submittalReviews.submittalId))
              .where(and(
                eq(submittalReviews.id, reviewId),
                eq(submittalReviews.submittalId, submittalId),
                eq(submittalReviews.organizationId, organizationId),
                eq(submittals.organizationId, organizationId),
                eq(submittalReviews.reviewerId, userId),
              ))
              .limit(1);
            if (!staleRow || !RESOLVED_STATUSES.includes(staleRow.status as string)) {
              return false;
            }
            const serverIso = (staleRow.dateReviewed ?? new Date()).toISOString();
            const reason = `Review was already resolved (${staleRow.status}) before your stamp arrived`;
            // Mark this stamp idempotent so the next push round does not
            // re-attempt it after the user resolves the conflict on the
            // device. Without this, the FAILED row would replay until
            // the retry cap and surface as a generic failure.
            await markPersisted("SUBMITTAL_STAMP", stamp.localId, {
              ...stamp,
              _conflictReason: reason,
              _serverStatus: staleRow.status,
            });
            conflicts.push({
              entityType: "SUBMITTAL_STAMP",
              entityId: reviewId,
              localId: stamp.localId,
              serverUpdatedAt: serverIso,
              reason,
              serverStatus: staleRow.status as string,
            });
            processed.submittalStamps.push({
              localId: stamp.localId,
              status: "CONFLICT",
              serverUpdatedAt: serverIso,
              serverStatus: staleRow.status as string,
              reason,
            });
            await writeSyncEvent({
              organizationId, deviceId: deviceId ?? "unknown", entityType: "SUBMITTAL_STAMP",
              localId: stamp.localId, serverId: reviewId, operation: "UPDATE",
              strategy: "LAST_WRITE_WINS", outcome: "CONFLICT",
              clientTimestamp: ssClientTs, logicalClock: ssLogicalClock,
              conflictPayload: { serverUpdatedAt: serverIso, serverStatus: staleRow.status, reason },
            });
            return true;
          };
          if (!reviewRow) {
            if (await detectStale()) continue;
            processed.submittalStamps.push({ localId: stamp.localId, status: "FAILED" });
            continue;
          }
          const comments = typeof stamp.comments === "string" ? stamp.comments : null;
          // Task #1607: atomic conditional update — guard the SET on
          // status='IN_REVIEW' AND use .returning() so we can detect
          // a SELECT→UPDATE race where office staff resolved the row
          // between our authz lookup and the write. Without this, a
          // 0-row UPDATE would silently fall through to writing an
          // activity row + advancing the chain on a review the office
          // already closed. We re-run stale detection on a 0-row
          // UPDATE to surface the conflict instead.
          // The four allowed action values are also valid
          // submittal_review_status enum members.
          const updated = await db
            .update(submittalReviews)
            .set({
              status: action as "APPROVED" | "APPROVED_AS_NOTED" | "REJECTED" | "REVISE_AND_RESUBMIT",
              stampAction: action,
              comments,
              dateReviewed: new Date(),
            })
            .where(and(
              eq(submittalReviews.id, reviewId),
              eq(submittalReviews.organizationId, organizationId),
              eq(submittalReviews.reviewerId, userId),
              eq(submittalReviews.status, "IN_REVIEW"),
            ))
            .returning({ id: submittalReviews.id });
          if (updated.length === 0) {
            if (await detectStale()) continue;
            processed.submittalStamps.push({ localId: stamp.localId, status: "FAILED" });
            await writeSyncEvent({
              organizationId, deviceId: deviceId ?? "unknown", entityType: "SUBMITTAL_STAMP",
              localId: stamp.localId, serverId: reviewId, operation: "UPDATE",
              strategy: "LAST_WRITE_WINS", outcome: "FAILED",
              clientTimestamp: ssClientTs, logicalClock: ssLogicalClock,
              conflictPayload: { reason: "Race condition — review resolved between authz check and write" },
            });
            continue;
          }
          await db.insert(submittalActivity).values({
            submittalId,
            userId,
            userName: req.user?.firstName ? `${req.user.firstName} ${req.user.lastName ?? ""}`.trim() : null,
            action: `Stamp queued from mobile — ${action}`,
            comment: comments,
          });
          await advanceChain(submittalId, userId, organizationId);
          await markPersisted("SUBMITTAL_STAMP", stamp.localId, stamp);
          processed.submittalStamps.push({ localId: stamp.localId, status: "SAVED" });
          await writeSyncEvent({
            organizationId, deviceId: deviceId ?? "unknown", entityType: "SUBMITTAL_STAMP",
            localId: stamp.localId, serverId: reviewId, operation: "UPDATE",
            strategy: "LAST_WRITE_WINS", outcome: "SAVED",
            clientTimestamp: ssClientTs, logicalClock: ssLogicalClock,
          });
        } catch (err) {
          logError(err, { route: "mobile-sync SUBMITTAL_STAMP persist", localId: stamp.localId });
          processed.submittalStamps.push({ localId: stamp.localId, status: "FAILED" });
        }
      }
    }

    res.json({
      success: true,
      processed,
      conflicts,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DEVICE_NOT_REGISTERED") {
      return res.status(412).json({ error: "Device not registered", code: "DEVICE_NOT_REGISTERED" });
    }
    next(error);
  }
});

// Task #807: web-side read endpoint for the dailyReports rows persisted by
// the mobile sync route. Office staff use the new /daily-reports page to
// review what crews submitted from the field.
router.get("/api/daily-reports", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { projectId } = req.query as { projectId?: string };
    const where = projectId
      ? and(eq(dailyReports.organizationId, organizationId), eq(dailyReports.projectId, projectId))
      : eq(dailyReports.organizationId, organizationId);
    const rows = await db.select()
      .from(dailyReports)
      .where(where)
      .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt))
      .limit(200);
    res.json({ dailyReports: rows });
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

// ============================================================
// Task #2693: Sync Event Log API
// ============================================================

/**
 * GET /api/mobile-sync/events
 * Project manager + admin: paginated sync event log, filterable
 * by entityType, outcome, deviceId, and dateRange.
 */
router.get("/api/mobile-sync/events", requireAuth, requireRole("MANAGER", "ADMIN", "SUPER_ADMIN", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) return res.status(400).json({ error: "No organization" });

    const { entityType, outcome, deviceId: filterDeviceId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

    let pagination: ReturnType<typeof parsePagination>;
    try {
      pagination = parsePagination(req.query);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    const { pageSize, cursor } = pagination;

    // Build filter conditions
    const conditions = [eq(mobileSyncEvents.organizationId, organizationId)];
    if (entityType) conditions.push(eq(mobileSyncEvents.entityType, entityType));
    if (outcome) conditions.push(eq(mobileSyncEvents.outcome, outcome));
    if (filterDeviceId) conditions.push(eq(mobileSyncEvents.deviceId, filterDeviceId));
    if (dateFrom) conditions.push(gte(mobileSyncEvents.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(mobileSyncEvents.createdAt, new Date(dateTo)));

    // Keyset pagination: desc(createdAt) with tie-break on desc(id).
    // cursorWhere() uses lt(tsCol, cursorTs) OR (eq(tsCol, cursorTs) AND lt(idCol, cursorId))
    // which is correct for descending insertion-time ordering.
    const cursorCond = cursorWhere(mobileSyncEvents.createdAt, mobileSyncEvents.id, cursor);
    if (cursorCond) conditions.push(cursorCond);

    const rows = await db.select()
      .from(mobileSyncEvents)
      .where(and(...conditions))
      .orderBy(desc(mobileSyncEvents.createdAt), desc(mobileSyncEvents.id))
      .limit(pageSize + 1);

    const page = buildPage(rows, pageSize, (row) => ({
      ts: row.createdAt.toISOString(),
      id: row.id,
    } as PaginationCursor));
    setNextLinkHeader(res, req.originalUrl, page.nextCursor);
    res.json(page);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/mobile-sync/events/:id/resolve
 * Resolves a CONFLICT or FLAGGED sync event by recording the resolution choice
 * and, for DEVICE wins on CONFLICT outcomes, re-queuing the device version
 * into offlineSyncQueue so the background worker can apply it to the domain table.
 *
 * choice:
 *   "DEVICE"       — accept the device version: re-queue with _resolution: "LOCAL_WINS"
 *                    so the push handler bypasses the next conflict check.
 *   "SERVER"       — accept the server version: mark as acknowledged, no data change.
 *   "FLAG_PAYROLL" — for TIME_CLOCK_GAP events: mark for payroll review.
 */
router.patch("/api/mobile-sync/events/:id/resolve", requireAuth, requireRole("MANAGER", "ADMIN", "SUPER_ADMIN", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    if (!organizationId || !userId) return res.status(400).json({ error: "No organization" });

    const { id } = req.params;
    const { choice, note } = req.body as { choice?: "SERVER" | "DEVICE" | "FLAG_PAYROLL"; note?: string };

    const [event] = await db.select()
      .from(mobileSyncEvents)
      .where(and(
        eq(mobileSyncEvents.id, id),
        eq(mobileSyncEvents.organizationId, organizationId),
      ))
      .limit(1);

    if (!event) return res.status(404).json({ error: "Sync event not found" });
    if (event.resolvedAt) return res.status(409).json({ error: "Already resolved" });

    // Validate that choice is appropriate for this event's outcome.
    // FLAG_PAYROLL is only meaningful for TIME_CLOCK_GAP events.
    // DEVICE/SERVER are only meaningful for CONFLICT or FLAGGED events.
    if (!choice) return res.status(400).json({ error: "choice is required" });
    if (choice === "FLAG_PAYROLL" && event.entityType !== "TIME_CLOCK_GAP") {
      return res.status(400).json({ error: "FLAG_PAYROLL is only valid for TIME_CLOCK_GAP events" });
    }
    if ((choice === "DEVICE" || choice === "SERVER") &&
        event.outcome !== "CONFLICT" && event.outcome !== "FLAGGED") {
      return res.status(400).json({ error: `${choice} choice requires a CONFLICT or FLAGGED event` });
    }
    // DEVICE choice requires an actionable localVersion in the conflict payload.
    // Without it we cannot re-queue anything meaningful, so we refuse early with
    // a clear error rather than silently resolving with no data applied.
    // Supported entity types are the ones the push handler knows how to re-apply;
    // TIME_CLOCK_GAP events do not carry a localVersion (they represent a missing
    // clock-out, not a data conflict) and must use FLAG_PAYROLL or SERVER instead.
    if (choice === "DEVICE") {
      const cp = event.conflictPayload as Record<string, unknown> | null;
      const localVersion = cp?.localVersion as Record<string, unknown> | undefined;
      if (!localVersion || Object.keys(localVersion).length === 0) {
        return res.status(422).json({
          error: "Cannot apply device version: this event has no localVersion payload. Use SERVER or FLAG_PAYROLL to acknowledge it.",
          hint: event.entityType === "TIME_CLOCK_GAP"
            ? "TIME_CLOCK_GAP events represent a missing clock-out and do not carry a device version. Use FLAG_PAYROLL to route to payroll review."
            : "The conflict payload for this event does not include a device version to re-apply. Use SERVER to accept the current server state.",
        });
      }
    }

    // For CONFLICT or FLAGGED events where the manager chose to keep the device
    // version, re-queue the local version with _resolution: "LOCAL_WINS" so
    // the next push handler bypasses the timestamp conflict check and applies it.
    // This covers both LAST_WRITE_WINS CONFLICT rows AND FLAG_BOTH FLAGGED rows —
    // FLAG_BOTH rows are held as FAILED (HELD_FOR_REVIEW) in offlineSyncQueue so
    // nothing is auto-applied; re-queuing here is what finally applies the device
    // version after manager adjudication.
    //
    // Deliberate async-apply: we re-queue to offlineSyncQueue (PENDING) rather
    // than applying synchronously in this transaction. This keeps the resolution
    // path simple and avoids coupling the resolve endpoint to all domain-table
    // write paths. The background processor picks it up on the next tick (usually
    // within seconds). The sync event stays in RESOLVED state immediately so the
    // UI is responsive; the background apply is idempotent and safe to retry.
    if (choice === "DEVICE" &&
        (event.outcome === "CONFLICT" || event.outcome === "FLAGGED") &&
        event.conflictPayload) {
      const payload = event.conflictPayload as Record<string, unknown>;
      const localVersion = payload.localVersion as Record<string, unknown> | undefined;
      if (localVersion && event.entityType) {
        const requeued = {
          ...localVersion,
          _resolution: "LOCAL_WINS",
          _resolvedBy: userId,
          _resolvedAt: new Date().toISOString(),
        };
        // Promote the specific held FAILED row — use its ID from conflictPayload
        // when available (set at push time) to avoid affecting other FAILED rows
        // for the same entity. Fall back to entity-scoped match only when the ID
        // is absent (legacy events written before this field was added).
        type OfflineEntityType = typeof offlineSyncQueue.$inferInsert["entityType"];
        const heldQueueRowId = (payload.heldQueueRowId as string | null | undefined) ?? null;
        let promoted = false;
        if (heldQueueRowId !== null) {
          const result = await db.update(offlineSyncQueue)
            .set({ status: "PENDING", errorMessage: null, payload: requeued, updatedAt: new Date() })
            .where(and(
              eq(offlineSyncQueue.id, heldQueueRowId),
              eq(offlineSyncQueue.organizationId, organizationId),
              eq(offlineSyncQueue.status, "FAILED"),
            ))
            .returning({ id: offlineSyncQueue.id });
          promoted = result.length > 0;
        } else if (event.serverId && event.entityType) {
          // Legacy fallback: no stored row ID — match by entity scope.
          const result = await db.update(offlineSyncQueue)
            .set({ status: "PENDING", errorMessage: null, payload: requeued, updatedAt: new Date() })
            .where(and(
              eq(offlineSyncQueue.organizationId, organizationId),
              eq(offlineSyncQueue.entityId, event.serverId),
              eq(offlineSyncQueue.entityType, event.entityType as OfflineEntityType),
              eq(offlineSyncQueue.status, "FAILED"),
            ))
            .returning({ id: offlineSyncQueue.id });
          promoted = result.length > 0;
        }
        if (!promoted) {
          // No held row found — insert a fresh PENDING row as fallback.
          await db.insert(offlineSyncQueue).values({
            organizationId, userId, operationType: "UPDATE",
            entityType: event.entityType as OfflineEntityType,
            entityId: event.serverId ?? event.localId,
            payload: requeued, status: "PENDING",
            deviceId: event.deviceId, clientTimestamp: event.clientTimestamp ?? null,
          });
        }
      }
    }

    // SERVER and FLAG_PAYROLL: delete the specific held FAILED queue row.
    // Use heldQueueRowId from conflictPayload when available for pinpoint
    // deletion; fall back to entity-scoped delete for legacy events.
    if ((choice === "SERVER" || choice === "FLAG_PAYROLL") && event.entityType) {
      type OfflineEntityType = typeof offlineSyncQueue.$inferInsert["entityType"];
      const cpPayload = event.conflictPayload as Record<string, unknown> | null;
      const heldQueueRowId = (cpPayload?.heldQueueRowId as string | null | undefined) ?? null;
      if (heldQueueRowId !== null) {
        await db.delete(offlineSyncQueue)
          .where(and(
            eq(offlineSyncQueue.id, heldQueueRowId),
            eq(offlineSyncQueue.organizationId, organizationId),
            eq(offlineSyncQueue.status, "FAILED"),
          ));
      } else if (event.serverId) {
        await db.delete(offlineSyncQueue)
          .where(and(
            eq(offlineSyncQueue.organizationId, organizationId),
            eq(offlineSyncQueue.entityId, event.serverId),
            eq(offlineSyncQueue.entityType, event.entityType as OfflineEntityType),
            eq(offlineSyncQueue.status, "FAILED"),
          ));
      }
    }

    // FLAG_PAYROLL payroll note side-effect: append a human-readable note to
    // the most recent DRAFT pay run for this org so payroll administrators
    // can see the flagged gap when they review the pay run.
    // Best-effort — never fails the resolution if no DRAFT run exists.
    if (choice === "FLAG_PAYROLL") {
      try {
        const [draftRun] = await db.select({ id: payRuns.id, notes: payRuns.notes })
          .from(payRuns)
          .where(and(eq(payRuns.organizationId, organizationId), eq(payRuns.status, "DRAFT")))
          .orderBy(desc(payRuns.createdAt))
          .limit(1);
        if (draftRun) {
          const flagLine = `[Time Clock Risk – Sync Event ${id}] Entity: ${event.entityType ?? "TIME_CLOCK_GAP"}, Server ID: ${event.serverId ?? "n/a"}, Flagged by: ${userId}, Flagged at: ${new Date().toISOString()}${note ? `. Note: ${note}` : ""}.`;
          const updatedNotes = draftRun.notes ? `${draftRun.notes}\n${flagLine}` : flagLine;
          await db.update(payRuns).set({ notes: updatedNotes }).where(eq(payRuns.id, draftRun.id));
        }
      } catch (err) {
        logWarn("[mobile-sync] FLAG_PAYROLL: failed to append note to pay run", { syncEventId: id, err: String(err) });
      }
    }

    const [updated] = await db.update(mobileSyncEvents)
      .set({
        resolvedBy: userId,
        resolvedAt: new Date(),
        conflictPayload: event.conflictPayload
          ? {
              ...(event.conflictPayload as Record<string, unknown>),
              resolution: choice ?? "ACKNOWLEDGED",
              note: note ?? null,
              resolvedAt: new Date().toISOString(),
            }
          : { resolution: choice ?? "ACKNOWLEDGED", note: note ?? null, resolvedAt: new Date().toISOString() },
      })
      .where(and(
        eq(mobileSyncEvents.id, id),
        eq(mobileSyncEvents.organizationId, organizationId),
        isNull(mobileSyncEvents.resolvedAt),
      ))
      .returning();

    if (!updated) return res.status(409).json({ error: "Conflict while resolving — please retry" });
    res.json({ success: true, event: updated, requeued: choice === "DEVICE" });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Task #2693: Sync Health Endpoint
// ============================================================

const STALE_DEVICE_THRESHOLD_HOURS = 48;

/**
 * GET /api/mobile-sync/devices
 * Project manager + admin: per-device health table.
 * Returns lastSyncAt, pendingOutboxCount, unresolvedConflicts, appVersion.
 * Devices not synced in 48+ hours are flagged stale.
 */
router.get("/api/mobile-sync/devices", requireAuth, requireRole("MANAGER", "ADMIN", "SUPER_ADMIN", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) return res.status(400).json({ error: "No organization" });

    const devices = await db.select()
      .from(mobileDevices)
      .where(and(
        eq(mobileDevices.organizationId, organizationId),
        eq(mobileDevices.isActive, true),
      ))
      .orderBy(desc(mobileDevices.lastSyncAt))
      .limit(200);

    const staleThreshold = new Date(Date.now() - STALE_DEVICE_THRESHOLD_HOURS * 60 * 60 * 1000);
    const deviceIds = devices.map((d) => d.deviceId);

    // Two bulk aggregate queries replace the previous N+1 per-device loops.
    //
    // pendingOutboxCount includes both PENDING (not yet pushed) and FAILED
    // (background processor attempted apply and failed) rows. FAILED rows
    // require human review before they can be re-synced; counting them here
    // gives the field health dashboard a complete picture of items that need
    // attention for that device — it is intentionally broader than "items
    // waiting to sync for the first time."
    const [queueCountRows, conflictCountRows] = await Promise.all([
      deviceIds.length === 0 ? [] : db.select({
        deviceId: offlineSyncQueue.deviceId,
        n: count(),
      }).from(offlineSyncQueue)
        .where(and(
          eq(offlineSyncQueue.organizationId, organizationId),
          inArray(offlineSyncQueue.deviceId, deviceIds),
          or(eq(offlineSyncQueue.status, "PENDING"), eq(offlineSyncQueue.status, "FAILED")),
        ))
        .groupBy(offlineSyncQueue.deviceId),

      deviceIds.length === 0 ? [] : db.select({
        deviceId: mobileSyncEvents.deviceId,
        n: count(),
      }).from(mobileSyncEvents)
        .where(and(
          eq(mobileSyncEvents.organizationId, organizationId),
          inArray(mobileSyncEvents.deviceId, deviceIds),
          or(eq(mobileSyncEvents.outcome, "CONFLICT"), eq(mobileSyncEvents.outcome, "FLAGGED")),
          isNull(mobileSyncEvents.resolvedAt),
        ))
        .groupBy(mobileSyncEvents.deviceId),
    ]);

    const queueMap = new Map<string, number>(queueCountRows.map((r) => [r.deviceId ?? "", Number(r.n)]));
    const conflictMap = new Map<string, number>(conflictCountRows.map((r) => [r.deviceId ?? "", Number(r.n)]));

    const result = devices.map((d) => {
      const isStale = !d.lastSyncAt || d.lastSyncAt < staleThreshold;
      return {
        deviceId: d.deviceId,
        deviceModel: d.deviceModel,
        platform: d.platform,
        appVersion: d.appVersion,
        lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
        pendingOutboxCount: queueMap.get(d.deviceId) ?? 0,
        unresolvedConflicts: conflictMap.get(d.deviceId) ?? 0,
        isStale,
        userId: d.userId,
      };
    });

    res.json({
      devices: result,
      staleThresholdHours: STALE_DEVICE_THRESHOLD_HOURS,
      // pendingOutboxCount includes PENDING (awaiting first push) + FAILED
      // (push attempted but rejected; requires human review). This is
      // intentionally broader than "queued to sync" — the dashboard purpose
      // is to surface items that need attention, not just items in flight.
      pendingOutboxCountNote: "Counts items in PENDING (not yet pushed) and FAILED (held for review) states. A non-zero count means the device has items that need attention before they are fully synced.",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
