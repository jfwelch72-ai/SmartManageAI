import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { requireAuth, type AuthRequest } from "./auth";
import { mobileDevices, offlineSyncQueue, mobilePendingUploads, projects, timeClockShifts, haulTickets, dailyInspectorReports, swpppInspections, rfis, dailyReports, media, punchListItems, projectInspections, submittals, submittalReviews, submittalActivity } from "@shared/schema";
import { eq, and, count, max, desc, gte, inArray, or } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { advanceChain } from "./submittalRoutes";

const router = Router();

// Mobile sync typed contracts (shared by GET/POST sync handlers)
type SyncEntityKey = "HAUL_TICKET" | "INSPECTOR_REPORT" | "SWPPP_INSPECTION" | "RFI";
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
      for (const event of changes.timeClockEvents) {
        await db.insert(mobilePendingUploads).values({
          deviceId: devicePk,
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
      // Mobile clients flag user-resolved "keep my changes" pushes with
      // _resolution: "LOCAL_WINS" in the payload so the server skips the
      // timestamp-based conflict check and accepts the local version.
      // Without this override the next push after resolution would loop
      // back into a CONFLICT response.
      const overrideLocalWins =
        (record as { _resolution?: string })._resolution === "LOCAL_WINS" ||
        (record as { payload?: { _resolution?: string } })?.payload?._resolution === "LOCAL_WINS";
      if (!overrideLocalWins && record.id && record.clientTimestamp) {
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
      if (Array.isArray(record.attachments) && devicePk) {
        for (const att of record.attachments) {
          if (!att?.localId) continue;
          await db.insert(mobilePendingUploads).values({
            deviceId: devicePk,
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
      for (const item of list) {
        if (!item?.localId) continue;
        await db.insert(mobilePendingUploads).values({
          deviceId: devicePk,
          localId: item.localId,
          recordType,
          recordDataJson: JSON.stringify(item),
          status: "PENDING",
        });
        bucket.push({ localId: item.localId, status: "QUEUED" });
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
        if (await alreadyPersisted("DAILY_REPORT", item.localId)) {
          processed.dailyReports.push({ localId: item.localId, status: "DUPLICATE" });
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
        if (await alreadyPersisted("PHOTO", item.localId)) {
          processed.photos.push({ localId: item.localId, status: "DUPLICATE" });
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
        if (await alreadyPersisted("PUNCH_ITEM", item.localId)) {
          processed.punchItems.push({ localId: item.localId, status: "DUPLICATE" });
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
          // Generate a per-project sequential item number. Cheap COUNT —
          // punchListItems already has a project_id index. Race-condition
          // collisions are rare in practice and we re-try on failure.
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
        if (await alreadyPersisted("INSPECTION", item.localId)) {
          processed.inspections.push({ localId: item.localId, status: "DUPLICATE" });
          continue;
        }
        const projectId = typeof item.projectId === "string" ? item.projectId : null;
        const validProject = projectId && await projectInOrg(projectId);
        // projectInspections.inspectionType is a Postgres enum; coercing an
        // unvetted string would either fail at insert time or silently break
        // the type system. Whitelist the known values to keep the type
        // narrow (rather than `as never`) and fall back to the queue for
        // anything else so office staff can still triage the payload.
        const ALLOWED_INSPECTION_TYPES = ["CITY_OFFICIAL", "GC_REPRESENTATIVE", "OWNER_REPRESENTATIVE"] as const;
        type InspectionType = typeof ALLOWED_INSPECTION_TYPES[number];
        const rawType = typeof item.inspectionType === "string" ? item.inspectionType.toUpperCase() : null;
        const inspectionType = (ALLOWED_INSPECTION_TYPES as readonly string[]).includes(rawType ?? "")
          ? (rawType as InspectionType)
          : null;
        const title = typeof item.title === "string" ? item.title : null;
        // projectInspections requires inspectionType (enum) + title — without
        // those the row would violate NOT NULL, so fall back to the queue.
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
            status: completedAt ? "COMPLETED" : "REQUESTED",
            resultNotes: typeof item.answers === "string"
              ? item.answers
              : item.answers !== undefined ? JSON.stringify(item.answers) : null,
            createdById: userId,
          }).returning({ id: projectInspections.id });
          await markPersisted("INSPECTION", item.localId, item);
          processed.inspections.push({ localId: item.localId, status: "SAVED", serverId: row?.id });
        } catch (err) {
          logError(err, { route: "mobile-sync INSPECTION persist", localId: item.localId });
          await queuePending([item], "INSPECTION", processed.inspections);
        }
      }
    }

    await queuePending(changes?.drawingMarkups, "DRAWING_MARKUP", processed.drawingMarkups);

    // ---- SUBMITTAL_STAMP ---------------------------------------------------
    // Apply queued review stamps from the field reviewer's device.
    if (Array.isArray(changes?.submittalStamps)) {
      const ALLOWED = ["APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"] as const;
      for (const stamp of changes.submittalStamps) {
        if (!stamp?.localId) continue;
        if (await alreadyPersisted("SUBMITTAL_STAMP", stamp.localId)) {
          processed.submittalStamps.push({ localId: stamp.localId, status: "DUPLICATE" });
          continue;
        }
        const reviewId = typeof stamp.reviewId === "string" ? stamp.reviewId : null;
        const submittalId = typeof stamp.submittalId === "string" ? stamp.submittalId : null;
        const action = typeof stamp.action === "string" ? stamp.action : null;
        if (!reviewId || !submittalId || !action || !(ALLOWED as readonly string[]).includes(action)) {
          processed.submittalStamps.push({ localId: stamp.localId, status: "FAILED" });
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
            continue;
          }
          await db.insert(submittalActivity).values({
            submittalId,
            userId,
            userName: req.user?.firstName ? `${req.user.firstName} ${req.user.lastName ?? ""}`.trim() : null,
            action: `Stamp queued from mobile — ${action}`,
            comment: comments,
          });
          // Drive the same post-stamp orchestration the web route uses:
          // advance to the next reviewer, roll up status when chain
          // completes, and notify the next reviewer (internal push or
          // external portal-link email). Without this, mobile-originated
          // stamps would dead-end mid-chain.
          await advanceChain(submittalId, userId, organizationId);
          await markPersisted("SUBMITTAL_STAMP", stamp.localId, stamp);
          processed.submittalStamps.push({ localId: stamp.localId, status: "SAVED" });
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

export default router;
