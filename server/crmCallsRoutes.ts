/**
 * Task #890 — CRM Call Logging + Unified Activity Timeline
 *
 * - GET    /api/crm/calls                          (list with filters)
 * - POST   /api/crm/calls                          (manual log)
 * - PATCH  /api/crm/calls/:id                      (edit single)
 * - DELETE /api/crm/calls/:id
 * - PATCH  /api/crm/calls/bulk                     (bulk edit outcome/notes)
 * - POST   /api/crm/calls/click-to-call            (Twilio outbound, gated)
 * - POST   /api/crm/calls/twilio/webhook           (Twilio status callback)
 * - GET    /api/crm/contacts/:id/calls
 * - GET    /api/crm/opportunities/:id/calls
 * - GET    /api/crm/activity                       (unified merged timeline)
 */

import { Router } from "express";
import { and, desc, eq, gte, lte, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import twilio from "twilio";
import { db } from "./db";
import {
  crmCalls,
  crmCallRecordings,
  crmContacts,
  crmOpportunities,
  crmOpportunityActivities,
  crmEmailMessages,
  crmQuotes,
  crmTranscriptBackfillJobs,
  notificationChannelPrefs,
  organizations,
  users,
  insertCrmCallSchema,
  type CrmTranscriptBackfillJob,
} from "@shared/schema";
import { sendEmail } from "./services/emailService";
import { sendSlackMessage, isValidSlackWebhookUrl } from "./services/slackService";
import { sendTeamsMessage, isValidTeamsWebhookUrl } from "./services/teamsService";
import {
  createCrmTranscriptBackfillJob,
  createCrmTranscriptBackfillTestAlert,
  getCrmTranscriptBackfillJob,
  getCrmTranscriptBackfillJobByIdAcrossOrgs,
  clearCrmTranscriptBackfillTestResult,
  getCrmTranscriptBackfillNotificationSettings,
  getCrmTranscriptBackfillOperatorContact,
  getLatestCrmTranscriptBackfillTestAlert,
  listCrmTranscriptBackfillAlertDeliveries,
  listOrgAdminAlertFailureModes,
  summarizeOrgAdminAlertFailureFallbackMutes,
  listCrmTranscriptBackfillTestAlerts,
  getCrmTranscriptBackfillTestAlertUsageSummary,
  getCrmTranscriptBackfillTestAlertUsageBuckets,
  recordCrmTranscriptBackfillTestResult,
  getRunningCrmTranscriptBackfillJob,
  listCrmTranscriptBackfillJobs,
  listCrmTranscriptBackfillNotificationsForJobs,
  listCrmTranscriptBackfillOperators,
  listCrmTranscriptBackfillCancellers,
  locateCrmTranscriptBackfillJobPage,
  getCrmTranscriptBackfillLineages,
  listMostRecentRunningCrmTranscriptBackfillJobsPerOrg,
  listRunningCrmTranscriptBackfillJobsWithOrg,
  recordCrmTranscriptBackfillNotification,
  updateCrmTranscriptBackfillJob,
  upsertCrmTranscriptBackfillNotificationSettings,
} from "./storage";
import {
  notifyBackfillCompletion,
  resendBackfillAlertDelivery,
  sendTestBackfillAlert,
  getBackfillNotificationConfig,
  buildAlertFailureFallbackContent,
  buildAlertFailureDigestContent,
  checkAndNotifyTestAlertThresholdBreach,
  DEFAULT_TEST_ALERT_THRESHOLD_PER_DAY,
} from "./services/transcriptBackfillNotifications";
import {
  requireAuth,
  requireRole,
  requireRoleOrFeature,
  type AuthRequest,
} from "./auth";
import { getOrgIdForFilter, isSuperAdmin } from "./orgFilter";
import { isFeatureEnabled } from "./services/featureFlagService";
import { logError, logInfo, logWarn } from "./utils/logger";
import { eventBus } from "./events";
import {
  queueCallTranscription,
  transcribeCallRecording,
} from "./services/callTranscriptionService";
import { insertNotifications } from "./services/notificationService";
import { objectStorageClient } from "./objectStorage";

const router = Router();

const PIPELINE_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";

function parseStorageKey(storageKey: string): { bucketName: string; objectName: string } | null {
  const path = storageKey.startsWith("/") ? storageKey.slice(1) : storageKey;
  const slashIdx = path.indexOf("/");
  if (slashIdx <= 0) return null;
  return {
    bucketName: path.substring(0, slashIdx),
    objectName: path.substring(slashIdx + 1),
  };
}

async function downloadRecordingToStorage(
  twilioRecordingUrl: string,
  callId: string,
  recordingSid: string,
): Promise<string | null> {
  try {
    const privateDir =
      process.env.PRIVATE_OBJECT_DIR || process.env.REPLIT_OBJECT_STORAGE_PRIVATE_DIR;
    if (!privateDir) {
      logWarn("crmCalls: PRIVATE_OBJECT_DIR not set; skipping recording cache");
      return null;
    }
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      logWarn("crmCalls: Twilio credentials missing; cannot cache recording");
      return null;
    }

    const url = twilioRecordingUrl.endsWith(".mp3")
      ? twilioRecordingUrl
      : `${twilioRecordingUrl}.mp3`;
    const basic = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const upstream = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
    if (!upstream.ok) {
      logWarn("crmCalls: failed to fetch recording from Twilio for cache", {
        status: upstream.status,
        callId,
      });
      return null;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());

    const storageKey = `crm/call-recordings/${callId}/${recordingSid}.mp3`;
    const fullPath = `${privateDir}/${storageKey}`;
    const parsed = parseStorageKey(fullPath);
    if (!parsed) return null;
    const bucket = objectStorageClient.bucket(parsed.bucketName);
    const file = bucket.file(parsed.objectName);
    await file.save(buf, { contentType: "audio/mpeg", metadata: { contentType: "audio/mpeg" } });
    logInfo("crmCalls: cached recording to object storage", { callId, storageKey });
    return storageKey;
  } catch (e) {
    logError(
      "crmCalls: failed caching recording to object storage",
      { callId },
      e instanceof Error ? e : new Error(String(e)),
    );
    return null;
  }
}

function resolveOrg(req: AuthRequest, res: any): string | null {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  if (shouldFilter && orgId) return orgId;
  return req.user?.organizationId || null;
}

const callDirection = z.enum(["INBOUND", "OUTBOUND"]);
const callOutcome = z.enum([
  "CONNECTED",
  "VOICEMAIL",
  "NO_ANSWER",
  "BUSY",
  "FAILED",
  "WRONG_NUMBER",
  "MEETING_SCHEDULED",
]);

const logCallSchema = z.object({
  opportunityId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  crmOrganisationId: z.string().optional().nullable(),
  direction: callDirection.default("OUTBOUND"),
  outcome: callOutcome.optional().nullable(),
  fromNumber: z.string().optional().nullable(),
  toNumber: z.string().optional().nullable(),
  durationSeconds: z.number().int().min(0).default(0),
  startedAt: z.coerce.date().optional(),
  notes: z.string().max(5000).optional().nullable(),
});

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
router.get(
  "/api/crm/calls",
  requireAuth,
  requireRole(...PIPELINE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const opportunityId = req.query.opportunityId as string | undefined;
      const contactId = req.query.contactId as string | undefined;
      const crmOrganisationId = req.query.crmOrganisationId as string | undefined;
      const ownerId = req.query.ownerId as string | undefined;
      const directionParam = req.query.direction as string | undefined;
      const startedAfterRaw = req.query.startedAfter as string | undefined;
      const startedBeforeRaw = req.query.startedBefore as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);

      const conds: SQL[] = [eq(crmCalls.organizationId, orgId)];
      if (opportunityId) conds.push(eq(crmCalls.opportunityId, opportunityId));
      if (contactId) conds.push(eq(crmCalls.contactId, contactId));
      if (crmOrganisationId) conds.push(eq(crmCalls.crmOrganisationId, crmOrganisationId));
      if (ownerId) conds.push(eq(crmCalls.createdById, ownerId));
      if (directionParam === "INBOUND" || directionParam === "OUTBOUND") {
        conds.push(eq(crmCalls.direction, directionParam));
      }
      if (startedAfterRaw) {
        const d = new Date(startedAfterRaw);
        if (!isNaN(d.getTime())) conds.push(gte(crmCalls.startedAt, d));
      }
      if (startedBeforeRaw) {
        const d = new Date(startedBeforeRaw);
        if (!isNaN(d.getTime())) conds.push(lte(crmCalls.startedAt, d));
      }

      const rows = await db
        .select({
          id: crmCalls.id,
          opportunityId: crmCalls.opportunityId,
          contactId: crmCalls.contactId,
          crmOrganisationId: crmCalls.crmOrganisationId,
          direction: crmCalls.direction,
          outcome: crmCalls.outcome,
          status: crmCalls.status,
          fromNumber: crmCalls.fromNumber,
          toNumber: crmCalls.toNumber,
          durationSeconds: crmCalls.durationSeconds,
          startedAt: crmCalls.startedAt,
          endedAt: crmCalls.endedAt,
          notes: crmCalls.notes,
          source: crmCalls.source,
          twilioCallSid: crmCalls.twilioCallSid,
          createdById: crmCalls.createdById,
          ownerId: crmCalls.ownerId,
          followUpAt: crmCalls.followUpAt,
          createdAt: crmCalls.createdAt,
          createdByFirstName: users.firstName,
          createdByLastName: users.lastName,
        })
        .from(crmCalls)
        .leftJoin(users, eq(users.id, crmCalls.createdById))
        .where(and(...conds))
        .orderBy(desc(crmCalls.startedAt))
        .limit(limit);

      res.json(rows);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// CREATE (manual log)
// ---------------------------------------------------------------------------
router.post(
  "/api/crm/calls",
  requireAuth,
  requireRoleOrFeature([...EDIT_ROLES], "canLogCrmCalls"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const parsed = logCallSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const data = parsed.data;

      const startedAt = data.startedAt ?? new Date();
      const [created] = await db
        .insert(crmCalls)
        .values({
          organizationId: orgId,
          opportunityId: data.opportunityId || null,
          contactId: data.contactId || null,
          crmOrganisationId: data.crmOrganisationId || null,
          direction: data.direction,
          outcome: data.outcome || null,
          status: "LOGGED",
          fromNumber: data.fromNumber || null,
          toNumber: data.toNumber || null,
          durationSeconds: data.durationSeconds,
          startedAt,
          endedAt: data.durationSeconds > 0
            ? new Date(startedAt.getTime() + data.durationSeconds * 1000)
            : null,
          notes: data.notes || null,
          source: "MANUAL",
          createdById: req.user!.id,
          ownerId: req.user!.id,
        })
        .returning();

      // Mirror to opportunity activities for legacy listings.
      if (created.opportunityId) {
        await db.insert(crmOpportunityActivities).values({
          opportunityId: created.opportunityId,
          activityType: "CALL",
          description: data.notes || `Call ${data.direction.toLowerCase()} (${data.outcome || "logged"})`,
          completedAt: startedAt,
          createdById: req.user!.id,
        });
      }

      await eventBus.emit({
        type: "crm.call_logged",
        version: 1,
        orgId,
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          callId: created.id,
          opportunityId: created.opportunityId,
          contactId: created.contactId,
          direction: created.direction,
          outcome: created.outcome,
        },
      });

      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH single
// ---------------------------------------------------------------------------
const patchCallSchema = z.object({
  outcome: callOutcome.optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  durationSeconds: z.number().int().min(0).optional(),
});

router.patch(
  "/api/crm/calls/bulk",
  requireAuth,
  requireRoleOrFeature([...EDIT_ROLES], "canLogCrmCalls"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const schema = z.object({
        ids: z.array(z.string()).min(1).max(200),
        outcome: callOutcome.optional().nullable(),
        notes: z.string().max(5000).optional().nullable(),
        ownerId: z.string().optional().nullable(),
        followUpAt: z.coerce.date().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const { ids, outcome, notes, ownerId, followUpAt } = parsed.data;

      // Tenant guard: an ownerId must belong to a user in the same org. Reject
      // cross-tenant assignments outright instead of silently writing them.
      if (ownerId) {
        const [owner] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, ownerId), eq(users.organizationId, orgId)))
          .limit(1);
        if (!owner) {
          return res.status(400).json({ error: "Owner is not a member of this organization" });
        }
      }

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (outcome !== undefined) update.outcome = outcome;
      if (notes !== undefined) update.notes = notes;
      if (ownerId !== undefined) update.ownerId = ownerId;
      if (followUpAt !== undefined) update.followUpAt = followUpAt;
      if (Object.keys(update).length <= 1) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const result = await db
        .update(crmCalls)
        .set(update)
        .where(and(eq(crmCalls.organizationId, orgId), inArray(crmCalls.id, ids)))
        .returning({ id: crmCalls.id });

      res.json({ updated: result.length, ids: result.map((r) => r.id) });
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  "/api/crm/calls/:id",
  requireAuth,
  requireRoleOrFeature([...EDIT_ROLES], "canLogCrmCalls"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const parsed = patchCallSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }

      const [updated] = await db
        .update(crmCalls)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(crmCalls.organizationId, orgId), eq(crmCalls.id, req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Call not found" });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  "/api/crm/calls/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const result = await db
        .delete(crmCalls)
        .where(and(eq(crmCalls.organizationId, orgId), eq(crmCalls.id, req.params.id)))
        .returning({ id: crmCalls.id });
      if (!result.length) return res.status(404).json({ error: "Call not found" });
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Click-to-call (Twilio gated by feature flag)
// ---------------------------------------------------------------------------
router.post(
  "/api/crm/calls/click-to-call",
  requireAuth,
  requireRoleOrFeature([...EDIT_ROLES], "canLogCrmCalls"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const enabled = await isFeatureEnabled(orgId, "TWILIO_INTEGRATION");
      if (!enabled) {
        return res.status(403).json({ error: "Twilio click-to-call is not enabled for this organization." });
      }
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
        return res.status(503).json({ error: "Twilio is not configured." });
      }

      const schema = z.object({
        toNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, "Must be E.164"),
        contactId: z.string().optional().nullable(),
        opportunityId: z.string().optional().nullable(),
        crmOrganisationId: z.string().optional().nullable(),
        agentNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, "Must be E.164"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }

      const baseUrl = process.env.PUBLIC_APP_URL || `https://${req.get("host")}`;
      const statusCallback = `${baseUrl}/api/crm/calls/twilio/webhook`;

      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      // Bridge: dial the agent first; once they pick up, Twilio dials the destination.
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${TWILIO_FROM_NUMBER}" record="record-from-answer-dual" recordingStatusCallback="${statusCallback}"><Number>${parsed.data.toNumber}</Number></Dial></Response>`;
      const tCall = await client.calls.create({
        to: parsed.data.agentNumber,
        from: TWILIO_FROM_NUMBER,
        twiml,
        statusCallback,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
      });

      const [created] = await db
        .insert(crmCalls)
        .values({
          organizationId: orgId,
          opportunityId: parsed.data.opportunityId || null,
          contactId: parsed.data.contactId || null,
          crmOrganisationId: parsed.data.crmOrganisationId || null,
          direction: "OUTBOUND",
          status: "QUEUED",
          fromNumber: TWILIO_FROM_NUMBER,
          toNumber: parsed.data.toNumber,
          durationSeconds: 0,
          startedAt: new Date(),
          twilioCallSid: tCall.sid,
          source: "TWILIO",
          createdById: req.user!.id,
          ownerId: req.user!.id,
        })
        .returning();

      logInfo("crmCalls: click-to-call queued", { callId: created.id, twilioSid: tCall.sid });
      res.status(201).json(created);
    } catch (e) {
      logError("crmCalls click-to-call failed", {}, e instanceof Error ? e : new Error(String(e)));
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Twilio status webhook
// ---------------------------------------------------------------------------
router.post(
  "/api/crm/calls/twilio/webhook",
  async (req, res) => {
    try {
      // Twilio signature verification is mandatory: the webhook writes
      // RecordingUrl values that the recording proxy later fetches, so an
      // unauthenticated webhook would let an attacker poison those URLs.
      // Only allow skipping it in non-production when explicitly opted in.
      const skipForDev =
        process.env.NODE_ENV !== "production" &&
        process.env.TWILIO_WEBHOOK_SKIP_VERIFY === "1";
      if (!skipForDev) {
        if (!TWILIO_AUTH_TOKEN) {
          logWarn("crmCalls webhook rejected: TWILIO_AUTH_TOKEN not configured");
          return res.status(503).send("Webhook auth not configured");
        }
        const signature = (req.header("X-Twilio-Signature") || "").trim();
        if (!signature) {
          logWarn("crmCalls webhook rejected: missing signature");
          return res.status(403).send("Forbidden");
        }
        const baseUrl = process.env.PUBLIC_APP_URL || `https://${req.get("host")}`;
        const fullUrl = `${baseUrl}/api/crm/calls/twilio/webhook`;
        const ok = twilio.validateRequest(
          TWILIO_AUTH_TOKEN,
          signature,
          fullUrl,
          (req.body as Record<string, string>) || {},
        );
        if (!ok) {
          logWarn("crmCalls webhook signature mismatch");
          return res.status(403).send("Forbidden");
        }
      }

      const body = (req.body as Record<string, string>) || {};
      const callSid = body.CallSid;
      const recordingSid = body.RecordingSid;
      const recordingUrl = body.RecordingUrl;
      const duration = parseInt(body.RecordingDuration || body.CallDuration || "0", 10) || 0;
      const callStatus = (body.CallStatus || "").toUpperCase();

      if (!callSid) {
        return res.status(200).send("ok");
      }

      const [existing] = await db
        .select()
        .from(crmCalls)
        .where(eq(crmCalls.twilioCallSid, callSid))
        .limit(1);
      if (!existing) {
        logInfo("crmCalls webhook: no matching call", { callSid });
        return res.status(200).send("ok");
      }

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (callStatus === "COMPLETED") {
        update.status = "COMPLETED";
        update.endedAt = new Date();
        if (duration > 0) update.durationSeconds = duration;
      } else if (["BUSY", "NO-ANSWER", "FAILED", "CANCELED"].includes(callStatus)) {
        update.status = callStatus === "NO-ANSWER" ? "FAILED" : (callStatus as string);
      } else if (["RINGING", "IN-PROGRESS", "QUEUED", "INITIATED"].includes(callStatus)) {
        update.status = callStatus.replace("-", "_");
      }
      if (recordingSid) update.twilioRecordingSid = recordingSid;

      await db.update(crmCalls).set(update).where(eq(crmCalls.id, existing.id));

      if (recordingUrl && recordingSid) {
        const [exists] = await db
          .select({
            id: crmCallRecordings.id,
            transcriptStatus: crmCallRecordings.transcriptStatus,
          })
          .from(crmCallRecordings)
          .where(eq(crmCallRecordings.twilioRecordingSid, recordingSid))
          .limit(1);
        let recordingId: string | null = exists?.id ?? null;
        let existingStatus: string | null = exists?.transcriptStatus ?? null;
        if (!exists) {
          const [created] = await db
            .insert(crmCallRecordings)
            .values({
              callId: existing.id,
              recordingUrl,
              durationSeconds: duration,
              twilioRecordingSid: recordingSid,
            })
            .returning({ id: crmCallRecordings.id });
          recordingId = created?.id ?? null;
          existingStatus = "PENDING";

          // Task #922 — cache the recording to object storage so future plays
          // don't hit Twilio. Run in the background so we still ack the
          // webhook quickly.
          if (created) {
            void downloadRecordingToStorage(recordingUrl, existing.id, recordingSid).then(
              async (storageKey) => {
                if (!storageKey) return;
                try {
                  await db
                    .update(crmCallRecordings)
                    .set({ storageKey })
                    .where(eq(crmCallRecordings.id, created.id));
                } catch (e) {
                  logError(
                    "crmCalls: failed to persist storageKey",
                    { recordingId: created.id },
                    e instanceof Error ? e : new Error(String(e)),
                  );
                }
              },
            );
          }
        }
        // Task #921 — kick off transcription in the background so the webhook
        // can return immediately to Twilio. Errors are logged but never thrown.
        // Idempotency: Twilio retries the recording callback on its own, so
        // skip queueing when this recording is already done or in flight to
        // avoid duplicate billable Whisper runs.
        const status = (existingStatus || "PENDING").toUpperCase();
        if (recordingId && status !== "COMPLETED" && status !== "PROCESSING") {
          queueCallTranscription(recordingId);
        }
      }

      res.status(200).send("ok");
    } catch (e) {
      logError("crmCalls webhook error", {}, e instanceof Error ? e : new Error(String(e)));
      res.status(200).send("ok");
    }
  },
);

// ---------------------------------------------------------------------------
// Per-entity calls
// ---------------------------------------------------------------------------
router.get(
  "/api/crm/contacts/:id/calls",
  requireAuth,
  requireRole(...PIPELINE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const rows = await db
        .select()
        .from(crmCalls)
        .where(and(eq(crmCalls.organizationId, orgId), eq(crmCalls.contactId, req.params.id)))
        .orderBy(desc(crmCalls.startedAt))
        .limit(200);
      res.json(rows);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/crm/opportunities/:id/calls",
  requireAuth,
  requireRole(...PIPELINE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const rows = await db
        .select()
        .from(crmCalls)
        .where(and(eq(crmCalls.organizationId, orgId), eq(crmCalls.opportunityId, req.params.id)))
        .orderBy(desc(crmCalls.startedAt))
        .limit(200);
      res.json(rows);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Recording stream/download (proxies Twilio with our credentials so URLs
// don't leak and access stays gated to the call's organization).
// ---------------------------------------------------------------------------
router.get(
  "/api/crm/calls/:id/recording",
  requireAuth,
  requireRole(...PIPELINE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const [call] = await db
        .select({ id: crmCalls.id })
        .from(crmCalls)
        .where(and(eq(crmCalls.organizationId, orgId), eq(crmCalls.id, req.params.id)))
        .limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const [rec] = await db
        .select()
        .from(crmCallRecordings)
        .where(eq(crmCallRecordings.callId, call.id))
        .orderBy(desc(crmCallRecordings.createdAt))
        .limit(1);
      if (!rec) return res.status(404).json({ error: "Recording not found" });

      // Prefer the cached copy in object storage. Falls back to Twilio if
      // the cache is missing or the file vanished from the bucket.
      if (rec.storageKey) {
        const privateDir =
          process.env.PRIVATE_OBJECT_DIR || process.env.REPLIT_OBJECT_STORAGE_PRIVATE_DIR;
        if (privateDir) {
          try {
            const fullPath = `${privateDir}/${rec.storageKey}`;
            const parsed = parseStorageKey(fullPath);
            if (parsed) {
              const bucket = objectStorageClient.bucket(parsed.bucketName);
              const file = bucket.file(parsed.objectName);
              const [exists] = await file.exists();
              if (exists) {
                const [metadata] = await file.getMetadata();
                const totalSize = Number(metadata.size || 0);
                const contentType = metadata.contentType || "audio/mpeg";

                const rangeHeader = req.headers.range
                  ? String(req.headers.range)
                  : null;
                let start = 0;
                let end = totalSize > 0 ? totalSize - 1 : 0;
                let isPartial = false;
                if (rangeHeader && totalSize > 0) {
                  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
                  if (m) {
                    const s = m[1] === "" ? NaN : parseInt(m[1], 10);
                    const e = m[2] === "" ? NaN : parseInt(m[2], 10);
                    if (!Number.isNaN(s) && Number.isNaN(e)) {
                      start = s;
                      end = totalSize - 1;
                    } else if (Number.isNaN(s) && !Number.isNaN(e)) {
                      // Suffix range: last N bytes
                      start = Math.max(0, totalSize - e);
                      end = totalSize - 1;
                    } else if (!Number.isNaN(s) && !Number.isNaN(e)) {
                      start = s;
                      end = Math.min(e, totalSize - 1);
                    }
                    if (start > end || start < 0 || end >= totalSize) {
                      res.setHeader("content-range", `bytes */${totalSize}`);
                      return res.status(416).end();
                    }
                    isPartial = true;
                  }
                }

                res.setHeader("content-type", contentType);
                res.setHeader("accept-ranges", "bytes");
                if (req.query.download) {
                  res.setHeader(
                    "content-disposition",
                    `attachment; filename="call-${call.id}.mp3"`,
                  );
                }
                if (isPartial) {
                  res.setHeader("content-length", String(end - start + 1));
                  res.setHeader("content-range", `bytes ${start}-${end}/${totalSize}`);
                  res.status(206);
                } else {
                  if (totalSize > 0) res.setHeader("content-length", String(totalSize));
                  res.status(200);
                }

                const stream = file.createReadStream(
                  isPartial ? { start, end } : undefined,
                );
                stream.on("error", (err: Error) => {
                  logError(
                    "crmCalls recording: object storage stream error",
                    { callId: call.id },
                    err,
                  );
                  if (!res.headersSent) {
                    res.status(500).json({ error: "Failed to stream recording" });
                  } else {
                    res.end();
                  }
                });
                stream.pipe(res);
                return;
              }
              logWarn("crmCalls recording: cached object missing, falling back to Twilio", {
                callId: call.id,
                storageKey: rec.storageKey,
              });
            }
          } catch (e) {
            logError(
              "crmCalls recording: object storage read failed, falling back to Twilio",
              { callId: call.id },
              e instanceof Error ? e : new Error(String(e)),
            );
          }
        }
      }

      // SSRF guard: only allow https URLs hosted on a known recording provider.
      // Today that's Twilio's recording API; extend the allowlist if more
      // providers are integrated later.
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rec.recordingUrl);
      } catch {
        logWarn("crmCalls recording: malformed url", { callId: call.id });
        return res.status(502).json({ error: "Invalid recording URL" });
      }
      const ALLOWED_RECORDING_HOSTS = new Set(["api.twilio.com"]);
      if (
        parsedUrl.protocol !== "https:" ||
        !ALLOWED_RECORDING_HOSTS.has(parsedUrl.hostname.toLowerCase())
      ) {
        logWarn("crmCalls recording: host not allowed", {
          callId: call.id,
          host: parsedUrl.hostname,
        });
        return res.status(502).json({ error: "Recording host not allowed" });
      }

      // Twilio recording URLs need basic auth; append .mp3 to force audio.
      const isTwilio = parsedUrl.hostname.toLowerCase() === "api.twilio.com";
      const targetUrl = parsedUrl.pathname.endsWith(".mp3")
        ? parsedUrl.toString()
        : `${parsedUrl.toString()}.mp3`;
      if (isTwilio && (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN)) {
        return res.status(503).json({ error: "Twilio is not configured." });
      }

      const headers: Record<string, string> = {};
      if (isTwilio) {
        const basic = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
        headers.Authorization = `Basic ${basic}`;
      }
      if (req.headers.range) headers.Range = String(req.headers.range);

      const upstream = await fetch(targetUrl, { headers });
      if (!upstream.ok || !upstream.body) {
        logWarn("crmCalls recording fetch failed", { status: upstream.status, callId: call.id });
        return res.status(502).json({ error: "Failed to fetch recording" });
      }

      res.status(upstream.status);
      const passthrough = ["content-type", "content-length", "content-range", "accept-ranges"];
      for (const h of passthrough) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!upstream.headers.get("content-type")) res.setHeader("content-type", "audio/mpeg");
      if (req.query.download) {
        res.setHeader(
          "content-disposition",
          `attachment; filename="call-${call.id}.mp3"`,
        );
      }

      // Stream the body to the client.
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        const { value, done } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        if (value) res.write(Buffer.from(value));
        return pump();
      };
      await pump();
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Transcript: manual re-transcribe (admin/manager) for a call's most recent
// recording. Useful for retries after a Whisper failure or for backfilling
// transcripts on recordings created before Task #921.
// ---------------------------------------------------------------------------
router.post(
  "/api/crm/calls/:id/transcribe",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const [call] = await db
        .select({ id: crmCalls.id })
        .from(crmCalls)
        .where(and(eq(crmCalls.organizationId, orgId), eq(crmCalls.id, req.params.id)))
        .limit(1);
      if (!call) return res.status(404).json({ error: "Call not found" });

      const [rec] = await db
        .select({ id: crmCallRecordings.id })
        .from(crmCallRecordings)
        .where(eq(crmCallRecordings.callId, call.id))
        .orderBy(desc(crmCallRecordings.createdAt))
        .limit(1);
      if (!rec) return res.status(404).json({ error: "Recording not found" });

      // Run synchronously so the caller gets the transcript or error directly.
      const result = await transcribeCallRecording(rec.id);
      if (!result.ok) {
        return res.status(502).json({ error: result.error || "Transcription failed" });
      }
      res.json({ success: true, transcript: result.transcript });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Transcript backfill (admin) — Task #949. Iterates over recordings whose
// transcript is missing (transcriptStatus PENDING or FAILED) and runs them
// through Whisper with a small concurrency cap to respect rate limits. Runs
// in the background so the HTTP request returns immediately. Task #969:
// progress is persisted to `crm_transcript_backfill_jobs` so admins still see
// the last-known status if the Node process restarts mid-run. Each worker
// keeps a small in-memory mirror of the row and flushes mutations through
// the storage layer.
// ---------------------------------------------------------------------------
export type BackfillJobState = {
  id: string;
  orgId: string;
  // Task #1057 — CANCELLED is a distinct terminal state so admins can
  // tell a deliberately-stopped run apart from a crash. Existing FAILED
  // rows in the DB stay FAILED for backwards compatibility.
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recordingId: string; error: string }>;
  // Task #1003 — full set of failed recordingIds (unbounded), so the retry
  // endpoint can re-run every failure even past the bounded `errors` sample.
  failedRecordingIds: string[];
  startedAt: string;
  completedAt: string | null;
  startedById: string;
  parentJobId: string | null;
  // Task #1011 — surface the speed/cap chosen when the job was launched so the
  // history list and active-job UI can display them for auditing.
  concurrency: number | null;
  maxRecords: number | null;
  // Task #1070 — populated when the run transitions to CANCELLED so the UI
  // and run-completed Slack/email can show who stopped it (and optionally
  // why). Stays null on COMPLETED / FAILED runs.
  cancelledById: string | null;
  cancellationReason: string | null;
};

const MAX_BACKFILL_ERROR_SAMPLES = 50;
// Task #1078 — the heartbeat staleness window is the single source of truth
// for "the worker is presumed dead, reap the row". It used to be a hardcoded
// 5 minutes, which made the cross-org Cancel hint copy on the admin page
// silently lie if ops ever tuned the threshold (e.g. 10 minutes for slower
// workers). Read it from CRM_BACKFILL_HEARTBEAT_STALE_SECONDS so ops can tune
// it without a code change, and surface the resolved value to the client via
// the notification-config endpoint so the UI copy stays in sync automatically.
// Bounds: keep at least 30s (anything shorter races the heartbeat cadence) and
// at most 60 minutes (longer effectively disables reaping). Falls back to 5
// minutes on missing/invalid input.
// Operator runbook: docs/runbooks/crm-transcript-backfill-heartbeat.md
const DEFAULT_BACKFILL_HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const MIN_BACKFILL_HEARTBEAT_STALE_MS = 30 * 1000;
const MAX_BACKFILL_HEARTBEAT_STALE_MS = 60 * 60 * 1000;
// Task #1126 — when ops sets a bad value (non-numeric, negative, or out of
// the [30s, 60min] band) the resolver previously fell back / clamped silently.
// The runbook (docs/runbooks/crm-transcript-backfill-heartbeat.md) tells ops
// to verify via the notification-config endpoint, but a startup warning
// catches misconfigurations the moment the process boots. The optional
// `warn` parameter exists so unit tests can assert on the emitted warnings
// without spying on the global logger; production callers omit it and the
// resolver emits via `logWarn`.
export function resolveBackfillHeartbeatStaleMs(
  warn: (message: string, context?: Record<string, unknown>) => void = (
    message,
    context,
  ) => logWarn(message, context),
): number {
  const raw = process.env.CRM_BACKFILL_HEARTBEAT_STALE_SECONDS;
  if (raw === undefined || raw === "" || !raw.trim()) {
    return DEFAULT_BACKFILL_HEARTBEAT_STALE_MS;
  }
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warn(
      "crmCalls: CRM_BACKFILL_HEARTBEAT_STALE_SECONDS is invalid; falling back to default",
      {
        rawValue: raw,
        defaultMs: DEFAULT_BACKFILL_HEARTBEAT_STALE_MS,
        minMs: MIN_BACKFILL_HEARTBEAT_STALE_MS,
        maxMs: MAX_BACKFILL_HEARTBEAT_STALE_MS,
        runbook:
          "docs/runbooks/crm-transcript-backfill-heartbeat.md",
      },
    );
    return DEFAULT_BACKFILL_HEARTBEAT_STALE_MS;
  }
  const ms = Math.round(parsed * 1000);
  if (ms < MIN_BACKFILL_HEARTBEAT_STALE_MS) {
    warn(
      "crmCalls: CRM_BACKFILL_HEARTBEAT_STALE_SECONDS below minimum; clamping",
      {
        rawValue: raw,
        requestedMs: ms,
        clampedMs: MIN_BACKFILL_HEARTBEAT_STALE_MS,
        minMs: MIN_BACKFILL_HEARTBEAT_STALE_MS,
        maxMs: MAX_BACKFILL_HEARTBEAT_STALE_MS,
        runbook:
          "docs/runbooks/crm-transcript-backfill-heartbeat.md",
      },
    );
    return MIN_BACKFILL_HEARTBEAT_STALE_MS;
  }
  if (ms > MAX_BACKFILL_HEARTBEAT_STALE_MS) {
    warn(
      "crmCalls: CRM_BACKFILL_HEARTBEAT_STALE_SECONDS above maximum; clamping",
      {
        rawValue: raw,
        requestedMs: ms,
        clampedMs: MAX_BACKFILL_HEARTBEAT_STALE_MS,
        minMs: MIN_BACKFILL_HEARTBEAT_STALE_MS,
        maxMs: MAX_BACKFILL_HEARTBEAT_STALE_MS,
        runbook:
          "docs/runbooks/crm-transcript-backfill-heartbeat.md",
      },
    );
    return MAX_BACKFILL_HEARTBEAT_STALE_MS;
  }
  return ms;
}

// Task #1130 — structured resolution detail for the notification-config
// response so the admin UI can render "(clamped from X)" when ops set
// e.g. "20" expecting a 20-second window and the resolver rounded it up
// to the 30-second floor. Pure / non-emitting — the WARN side of Task
// #1130 is already covered by the per-bucket `warn(...)` calls inside
// `resolveBackfillHeartbeatStaleMs` (Task #1126), so we deliberately do
// NOT emit additional log lines here. `requestedMs` is null when the
// env var is unset OR could not be parsed as a positive finite number.
// `clamped` is true only when a parseable value fell outside [MIN, MAX].
export type BackfillHeartbeatStaleResolution = {
  effectiveMs: number;
  requestedMs: number | null;
  rawEnv: string | null;
  invalid: boolean;
  clamped: boolean;
};

export function resolveBackfillHeartbeatStaleConfig(): BackfillHeartbeatStaleResolution {
  const raw = process.env.CRM_BACKFILL_HEARTBEAT_STALE_SECONDS;
  // Task #1130 — empty/whitespace is intentionally treated identically to
  // "env var unset": no WARN, no `invalid` flag. Secret managers and
  // docker-compose `${VAR:-}` patterns commonly materialize unset vars as
  // an empty string, so warning on `""` would generate false-positive
  // boot noise on every deploy that hasn't explicitly opted in. Only
  // _explicit_ but unparseable values (e.g. "abc", "0", "-30") trip the
  // invalid path below.
  if (!raw || !raw.trim()) {
    return {
      effectiveMs: DEFAULT_BACKFILL_HEARTBEAT_STALE_MS,
      requestedMs: null,
      rawEnv: null,
      invalid: false,
      clamped: false,
    };
  }
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      effectiveMs: DEFAULT_BACKFILL_HEARTBEAT_STALE_MS,
      requestedMs: null,
      rawEnv: trimmed,
      invalid: true,
      clamped: false,
    };
  }
  const requestedMs = Math.round(parsed * 1000);
  let effectiveMs = requestedMs;
  if (effectiveMs < MIN_BACKFILL_HEARTBEAT_STALE_MS) {
    effectiveMs = MIN_BACKFILL_HEARTBEAT_STALE_MS;
  } else if (effectiveMs > MAX_BACKFILL_HEARTBEAT_STALE_MS) {
    effectiveMs = MAX_BACKFILL_HEARTBEAT_STALE_MS;
  }
  return {
    effectiveMs,
    requestedMs,
    rawEnv: trimmed,
    invalid: false,
    clamped: requestedMs !== effectiveMs,
  };
}

// Task #1131 — the heartbeat-staleness window used to be a module-level
// `const` captured at import time, then read directly from at least six
// worker sites (resume, cancel, reap, completion-email paths). That made
// the value impossible to override mid-process and forced tests to either
// re-import the module or monkey-patch internals to exercise alternate
// windows. We now resolve once at module load into a mutable cache and
// expose `getBackfillHeartbeatStaleMs()` as the single read accessor.
// All worker-site reads go through that accessor so future work can drive
// the value from a settings row, hot-reload it, or per-org tune it without
// touching every call site, and tests can override via
// `__setBackfillHeartbeatStaleMsForTests` without re-importing.
let currentBackfillHeartbeatStaleMs = resolveBackfillHeartbeatStaleMs();

export function getBackfillHeartbeatStaleMs(): number {
  return currentBackfillHeartbeatStaleMs;
}

// Test-only override. Pass a positive number to pin a specific window for
// the duration of a test, or `null` to reset back to the env-resolved
// default. Production code must never call this; the underscore prefix and
// `ForTests` suffix mark it as escape-hatch-only.
export function __setBackfillHeartbeatStaleMsForTests(ms: number | null): void {
  currentBackfillHeartbeatStaleMs =
    ms === null ? resolveBackfillHeartbeatStaleMs() : ms;
}

// Task #1130 — boot-time snapshot of the structured resolution so the
// notification-config endpoint can surface the operator's originally-
// requested value alongside the (potentially clamped) effective value.
// Captured once at module load, mirroring `currentBackfillHeartbeatStaleMs`.
export const BACKFILL_HEARTBEAT_STALE_RESOLUTION = resolveBackfillHeartbeatStaleConfig();

/**
 * @deprecated Use `getBackfillHeartbeatStaleMs()` instead. This export is
 * retained for backwards compatibility with existing tests and reflects only
 * the value resolved at module load time — it does NOT track runtime
 * overrides applied via `__setBackfillHeartbeatStaleMsForTests`.
 */
export const BACKFILL_HEARTBEAT_STALE_MS = currentBackfillHeartbeatStaleMs;

export function __rowToBackfillStateForTests(row: CrmTranscriptBackfillJob): BackfillJobState {
  return rowToState(row);
}

// Task #1070 — enrich a base BackfillJobState with the canceller's user
// profile (firstName/lastName/email) so the active job card can render
// "Cancelled by Sam Doe" without an extra round-trip from the client. The
// canceller is looked up via the same operator-contact helper as the
// run-completed notification path. Returns the input unchanged when the
// row was not cancelled or the canceller user has been deleted (we still
// preserve `cancelledById`/`cancellationReason` so the UI can fall back
// to the "(unknown — user record was deleted)" copy).
async function enrichWithCanceller<T extends BackfillJobState>(
  state: T,
): Promise<T & {
  cancelledBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}> {
  if (!state.cancelledById) {
    return { ...state, cancelledBy: null };
  }
  const canceller = await getCrmTranscriptBackfillOperatorContact(
    state.cancelledById,
  );
  return {
    ...state,
    cancelledBy: canceller
      ? {
          id: canceller.id,
          firstName: canceller.firstName ?? null,
          lastName: canceller.lastName ?? null,
          email: canceller.email ?? null,
        }
      : null,
  };
}

function rowToState(row: CrmTranscriptBackfillJob): BackfillJobState {
  return {
    id: row.id,
    orgId: row.organizationId,
    status: row.status as BackfillJobState["status"],
    total: row.total,
    processed: row.processed,
    succeeded: row.succeeded,
    failed: row.failed,
    errors: (row.errors as BackfillJobState["errors"]) ?? [],
    failedRecordingIds: (row.failedRecordingIds as string[] | null) ?? [],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    startedById: row.startedById ?? "",
    parentJobId: row.parentJobId ?? null,
    concurrency: row.concurrency ?? null,
    maxRecords: row.maxRecords ?? null,
    cancelledById: row.cancelledById ?? null,
    cancellationReason: row.cancellationReason ?? null,
  };
}

async function persistJobProgress(job: BackfillJobState) {
  // Use GREATEST(...) for the monotonic counters so out-of-order writes from
  // concurrent workers can never visibly regress the persisted progress
  // (e.g. a slow write with processed=2 landing after a fast write with
  // processed=3). The final completion write still flushes the canonical
  // values via the regular set path below.
  await db
    .update(crmTranscriptBackfillJobs)
    .set({
      status: job.status,
      total: sql`GREATEST(${crmTranscriptBackfillJobs.total}, ${job.total})`,
      processed: sql`GREATEST(${crmTranscriptBackfillJobs.processed}, ${job.processed})`,
      succeeded: sql`GREATEST(${crmTranscriptBackfillJobs.succeeded}, ${job.succeeded})`,
      failed: sql`GREATEST(${crmTranscriptBackfillJobs.failed}, ${job.failed})`,
      errors: job.errors,
      failedRecordingIds: job.failedRecordingIds,
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
      heartbeatAt: new Date(),
      updatedAt: new Date(),
      // Task #1070 — flush the canceller fields too so a CANCELLED row
      // persists who stopped it (and the optional reason). Both stay NULL
      // on COMPLETED / FAILED runs since the cancel signal never landed.
      cancelledById: job.cancelledById,
      cancellationReason: job.cancellationReason,
    })
    .where(eq(crmTranscriptBackfillJobs.id, job.id));
}

const BACKFILL_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Task #1006 — email a backfill summary to admins when a run finishes.
//
// Fired (fire-and-forget) from every code path that transitions a job to
// COMPLETED or FAILED. Loads the freshly-persisted job row, looks up the
// admin recipients for that org, and sends a single email summarising the
// run (status, totals, duration, operator, link back to the history page).
//
// Notification preferences: an admin who has a notification_channel_prefs
// row with email_enabled=false is treated as opted out and skipped. Admins
// without an explicit prefs row still receive these summaries — they're an
// operational signal for a run the admin themselves started.
//
// Idempotency: each finalization site flips the job to a terminal status
// exactly once (existing per-row guards), so it's safe to call this helper
// from each one without sending duplicates. We re-load the job row inside
// the helper so the email always reflects the persisted final state even
// when the caller has a slightly stale in-memory snapshot.
// ---------------------------------------------------------------------------
const BACKFILL_NOTIFIED_JOB_IDS = new Set<string>();
const BACKFILL_NOTIFIED_MAX = 1000;

function rememberBackfillNotified(jobId: string): boolean {
  if (BACKFILL_NOTIFIED_JOB_IDS.has(jobId)) return false;
  BACKFILL_NOTIFIED_JOB_IDS.add(jobId);
  // Bound memory growth in long-running processes.
  if (BACKFILL_NOTIFIED_JOB_IDS.size > BACKFILL_NOTIFIED_MAX) {
    const first = BACKFILL_NOTIFIED_JOB_IDS.values().next().value;
    if (first) BACKFILL_NOTIFIED_JOB_IDS.delete(first);
  }
  return true;
}

export function __resetBackfillNotifiedForTests() {
  BACKFILL_NOTIFIED_JOB_IDS.clear();
}

function formatBackfillDuration(startedAt: Date, completedAt: Date): string {
  const ms = Math.max(0, completedAt.getTime() - startedAt.getTime());
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function escapeBackfillHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Task #1046: Pure builder for the per-admin backfill summary message.
 *
 * Extracted out of `notifyBackfillCompletionToOrgAdmins` so the new
 * "Send test summary" admin endpoint can produce a sample preview in
 * exactly the same wording / layout as a real run-completion summary.
 *
 * `testPrefix` toggles "[Test]" markers on every channel (subject, HTML
 * heading, and Slack/Teams headline) plus a small footer/banner that
 * makes it unmistakably clear the message is a preview rather than a
 * notification about an actual backfill run.
 */
export interface BackfillSummaryContentInput {
  jobId: string;
  // Task #1057 — CANCELLED is a distinct terminal status; the builder uses
  // a "cancelled" verb/subject so admins can tell the run was deliberately
  // stopped rather than crashing.
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: Date;
  completedAt: Date;
  parentJobId: string | null;
  orgName: string;
  operatorName: string;
  testPrefix?: boolean;
  // Task #1070 — for CANCELLED runs, identify the admin who clicked Cancel
  // and (optionally) the free-text reason they typed in the confirm dialog
  // so the per-admin summary surfaces them too. Both fields are ignored on
  // COMPLETED / FAILED runs and may be omitted altogether by callers.
  cancelledByName?: string | null;
  cancellationReason?: string | null;
}

export interface BackfillSummaryContent {
  subject: string;
  text: string;
  html: string;
  chatTitle: string;
  chatBody: string;
  historyUrl: string;
}

export function buildBackfillSummaryContent(
  input: BackfillSummaryContentInput,
): BackfillSummaryContent {
  const {
    jobId, status, total, processed, succeeded, failed,
    startedAt, completedAt, parentJobId, orgName, operatorName,
    testPrefix = false,
    cancelledByName = null,
    cancellationReason = null,
  } = input;

  const duration = formatBackfillDuration(startedAt, completedAt);
  const isRetry = !!parentJobId;
  const runLabel = isRetry ? "Transcript backfill retry" : "Transcript backfill";
  // Task #1057 — separate label for cancelled runs so the email subject
  // and history copy don't read as a crash.
  const statusLabel =
    status === "COMPLETED"
      ? "completed"
      : status === "CANCELLED"
        ? "cancelled"
        : "failed";

  const baseUrl = process.env.APP_BASE_URL || "";
  const historyUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/admin/transcript-backfill`
    : "/admin/transcript-backfill";

  const prefix = testPrefix ? "[Test] " : "";
  const subject = `${prefix}${runLabel} ${statusLabel} — ${succeeded}/${total} succeeded`;

  const testBannerText = testPrefix
    ? "This is a sample summary triggered from your Notification Preferences. No real backfill ran.\n\n"
    : "";
  // Task #1070 — for CANCELLED runs, append a "Cancelled by" line (and the
  // optional reason) so admins reading the summary know who stopped it and
  // why without opening the admin page. Skipped on COMPLETED / FAILED.
  const cancelledLines: string[] = [];
  if (status === "CANCELLED") {
    cancelledLines.push(
      `Cancelled by: ${cancelledByName || "(unknown — user record was deleted)"}`,
    );
    if (cancellationReason) {
      cancelledLines.push(`Reason:       ${cancellationReason}`);
    }
  }
  const text =
    testBannerText +
    [
      `${runLabel} ${statusLabel} for ${orgName}.`,
      ``,
      `Status:    ${status}`,
      `Processed: ${processed} of ${total}`,
      `Succeeded: ${succeeded}`,
      `Failed:    ${failed}`,
      `Duration:  ${duration}`,
      `Started:   ${startedAt.toISOString()}`,
      `Finished:  ${completedAt.toISOString()}`,
      `Operator:  ${operatorName}`,
      ...cancelledLines,
      `Job ID:    ${jobId}`,
      ``,
      `View history: ${historyUrl}`,
    ].join("\n");

  const testBannerHtml = testPrefix
    ? `<p style="margin:0 0 12px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;color:#78350f;">
         <strong>Sample summary.</strong> This is a preview triggered from your Notification Preferences. No real backfill ran.
       </p>`
    : "";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;">
  ${testBannerHtml}
  <h2 style="margin:0 0 8px;">${escapeBackfillHtml(prefix)}${escapeBackfillHtml(runLabel)} ${escapeBackfillHtml(statusLabel)}</h2>
  <p style="margin:0 0 16px;color:#444;">Organization: <strong>${escapeBackfillHtml(orgName)}</strong></p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;">
    <tbody>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Status</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(status)}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Processed</strong></td><td style="border:1px solid #e5e7eb;">${processed} of ${total}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Succeeded</strong></td><td style="border:1px solid #e5e7eb;">${succeeded}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Failed</strong></td><td style="border:1px solid #e5e7eb;">${failed}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Duration</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(duration)}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Started</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(startedAt.toISOString())}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Finished</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(completedAt.toISOString())}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Operator</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(operatorName)}</td></tr>
      ${status === "CANCELLED" ? `
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Cancelled by</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(cancelledByName || "(unknown — user record was deleted)")}</td></tr>
      ${cancellationReason ? `<tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Reason</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(cancellationReason)}</td></tr>` : ""}
      ` : ""}
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Job ID</strong></td><td style="border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${escapeBackfillHtml(jobId)}</td></tr>
    </tbody>
  </table>
  <p style="margin:16px 0 0;"><a href="${escapeBackfillHtml(historyUrl)}" style="color:#2563eb;">View backfill history</a></p>
</body></html>`;

  const chatTitle = subject;
  const testChatFooter = testPrefix
    ? "\n_:test_tube: Sample summary triggered from Notification Preferences. No real backfill ran._"
    : "";
  const chatCancelLines: string[] = [];
  if (status === "CANCELLED") {
    chatCancelLines.push(
      `*Cancelled by:* ${cancelledByName || "(unknown — user record was deleted)"}`,
    );
    if (cancellationReason) {
      chatCancelLines.push(`*Reason:* ${cancellationReason}`);
    }
  }
  const chatBody =
    [
      `*Status:* ${status}`,
      `*Counts:* ${succeeded} succeeded / ${failed} failed / ${processed} of ${total}`,
      `*Duration:* ${duration}`,
      `*Operator:* ${operatorName}`,
      ...chatCancelLines,
      `*Job ID:* \`${jobId}\``,
    ].join("\n") + testChatFooter;

  return { subject, text, html, chatTitle, chatBody, historyUrl };
}

export async function notifyBackfillCompletionToOrgAdmins(jobId: string): Promise<void> {
  try {
    if (!rememberBackfillNotified(jobId)) return;

    const [jobRow] = await db
      .select({
        id: crmTranscriptBackfillJobs.id,
        organizationId: crmTranscriptBackfillJobs.organizationId,
        status: crmTranscriptBackfillJobs.status,
        total: crmTranscriptBackfillJobs.total,
        processed: crmTranscriptBackfillJobs.processed,
        succeeded: crmTranscriptBackfillJobs.succeeded,
        failed: crmTranscriptBackfillJobs.failed,
        startedAt: crmTranscriptBackfillJobs.startedAt,
        completedAt: crmTranscriptBackfillJobs.completedAt,
        parentJobId: crmTranscriptBackfillJobs.parentJobId,
        startedById: crmTranscriptBackfillJobs.startedById,
        operatorFirstName: users.firstName,
        operatorLastName: users.lastName,
        operatorEmail: users.email,
        // Task #1070 — also surface the canceller's identity + reason on
        // the per-admin run-completed summary. Pulled in the same query
        // via a separate aliased join on `users` so the existing operator
        // join keeps its column names.
        cancelledById: crmTranscriptBackfillJobs.cancelledById,
        cancellationReason: crmTranscriptBackfillJobs.cancellationReason,
      })
      .from(crmTranscriptBackfillJobs)
      .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
      .where(eq(crmTranscriptBackfillJobs.id, jobId))
      .limit(1);

    if (!jobRow) return;
    // Task #1057 — CANCELLED is a terminal state on par with COMPLETED /
    // FAILED, so the per-admin run summary should fire for it too.
    if (
      jobRow.status !== "COMPLETED" &&
      jobRow.status !== "FAILED" &&
      jobRow.status !== "CANCELLED"
    ) {
      return;
    }

    const [orgRow] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, jobRow.organizationId))
      .limit(1);

    // Task #1021: Pick admins for the org and respect each admin's per-event
    // backfill summary preferences (channel + failure-only filter). Left join
    // channel prefs to get their Slack/Teams webhook URLs without requiring
    // a prefs row for the email path. Anyone with the legacy
    // notification_channel_prefs.email_enabled flag explicitly set to false
    // continues to be treated as opted out of email (preserves Task #1006
    // behavior); the new per-event channel="none" or onFailureOnly filter
    // adds finer-grained controls on top.
    const adminRows = await db
      .select({
        email: users.email,
        emailEnabled: notificationChannelPrefs.emailEnabled,
        slackWebhookUrl: notificationChannelPrefs.slackWebhookUrl,
        teamsWebhookUrl: notificationChannelPrefs.teamsWebhookUrl,
        backfillChannel: users.crmBackfillSummaryChannel,
        backfillOnFailureOnly: users.crmBackfillSummaryOnFailureOnly,
      })
      .from(users)
      .leftJoin(notificationChannelPrefs, eq(notificationChannelPrefs.userId, users.id))
      .where(
        and(
          eq(users.organizationId, jobRow.organizationId),
          eq(users.role, "ADMIN"),
          eq(users.isActive, true),
        ),
      );

    const isFailure = jobRow.status === "FAILED";

    type Routed = {
      channel: "email" | "slack" | "teams";
      target: string; // email address or webhook URL
    };
    const routedSet = new Set<string>();
    const routed: Routed[] = [];
    for (const r of adminRows) {
      // Per-event filter: skip when admin only wants failures.
      if (r.backfillOnFailureOnly && !isFailure) continue;
      const channel = (r.backfillChannel ?? "email") as
        | "email" | "slack" | "teams" | "none";
      if (channel === "none") continue;
      if (channel === "email") {
        if (r.emailEnabled === false) continue; // legacy global opt-out
        const email = (r.email ?? "").trim();
        if (!email) continue;
        const key = `email:${email.toLowerCase()}`;
        if (routedSet.has(key)) continue;
        routedSet.add(key);
        routed.push({ channel: "email", target: email });
      } else if (channel === "slack") {
        const url = (r.slackWebhookUrl ?? "").trim();
        if (!url || !isValidSlackWebhookUrl(url)) continue;
        const key = `slack:${url}`;
        if (routedSet.has(key)) continue;
        routedSet.add(key);
        routed.push({ channel: "slack", target: url });
      } else if (channel === "teams") {
        const url = (r.teamsWebhookUrl ?? "").trim();
        if (!url || !isValidTeamsWebhookUrl(url)) continue;
        const key = `teams:${url}`;
        if (routedSet.has(key)) continue;
        routedSet.add(key);
        routed.push({ channel: "teams", target: url });
      }
    }

    if (routed.length === 0) {
      logInfo("crmCalls: backfill summary skipped (no eligible admin recipients)", {
        jobId,
        orgId: jobRow.organizationId,
        status: jobRow.status,
      });
      return;
    }

    const recipients = routed
      .filter((r) => r.channel === "email")
      .map((r) => r.target);

    const completedAt = jobRow.completedAt ?? new Date();
    const operatorName =
      [jobRow.operatorFirstName, jobRow.operatorLastName]
        .filter((p): p is string => !!p)
        .join(" ")
        .trim() ||
      jobRow.operatorEmail ||
      "an administrator";
    const orgName = orgRow?.name || "your organization";

    // Task #1070 — for CANCELLED runs, resolve the canceller's display name
    // so the per-admin summary can include "Cancelled by Sam Doe — bad
    // batch". Falls back to null when the user record was deleted; the
    // builder renders that as "(unknown — user record was deleted)".
    let cancelledByName: string | null = null;
    if (jobRow.status === "CANCELLED" && jobRow.cancelledById) {
      const canceller = await getCrmTranscriptBackfillOperatorContact(
        jobRow.cancelledById,
      );
      if (canceller) {
        const first = (canceller.firstName ?? "").trim();
        const last = (canceller.lastName ?? "").trim();
        const email = (canceller.email ?? "").trim();
        cancelledByName =
          [first, last].filter(Boolean).join(" ").trim() ||
          email ||
          null;
      }
    }

    // Task #1046: Centralized message builder so the "Send test" admin
    // endpoint can produce a sample with identical wording / layout.
    const { subject, text, html, chatTitle, chatBody, historyUrl } =
      buildBackfillSummaryContent({
        jobId: jobRow.id,
        status: jobRow.status as "COMPLETED" | "FAILED" | "CANCELLED",
        total: jobRow.total,
        processed: jobRow.processed,
        succeeded: jobRow.succeeded,
        failed: jobRow.failed,
        startedAt: jobRow.startedAt,
        completedAt,
        parentJobId: jobRow.parentJobId,
        orgName,
        operatorName,
        cancelledByName,
        cancellationReason: jobRow.cancellationReason,
      });

    const slackTargets = routed.filter((r) => r.channel === "slack").map((r) => r.target);
    const teamsTargets = routed.filter((r) => r.channel === "teams").map((r) => r.target);

    const dispatches: Array<Promise<unknown>> = [];

    if (recipients.length > 0) {
      dispatches.push(sendEmail({ to: recipients, subject, html, text }));
    }
    for (const url of slackTargets) {
      dispatches.push(
        sendSlackMessage(url, chatTitle, chatBody, historyUrl).catch((err) => {
          logWarn("crmCalls: backfill summary slack dispatch failed", {
            jobId,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    }
    for (const url of teamsTargets) {
      dispatches.push(
        sendTeamsMessage(url, chatTitle, chatBody, historyUrl).catch((err) => {
          logWarn("crmCalls: backfill summary teams dispatch failed", {
            jobId,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    }

    await Promise.all(dispatches);

    // Task #1022 — persist who was notified so the admin history page can
    // surface the recipient list later. Snapshotting the addresses (rather
    // than re-deriving from current admin roles) means the audit row stays
    // accurate even after admins are added/removed/opt-out post-run.
    if (recipients.length > 0) {
      try {
        await recordCrmTranscriptBackfillNotification({
          jobId,
          recipientEmails: recipients,
          channel: "EMAIL",
        });
      } catch (auditErr) {
        logWarn("crmCalls: failed to record backfill notification audit row", {
          jobId,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
      }
    }

    logInfo("crmCalls: backfill summary dispatched", {
      jobId,
      orgId: jobRow.organizationId,
      status: jobRow.status,
      emailRecipientCount: recipients.length,
      slackRecipientCount: slackTargets.length,
      teamsRecipientCount: teamsTargets.length,
    });
  } catch (e) {
    logError(
      "crmCalls: failed to send backfill summary",
      { jobId },
      e instanceof Error ? e : new Error(String(e)),
    );
  }
}

function scheduleBackfillCompletionEmail(jobId: string): void {
  setImmediate(() => {
    notifyBackfillCompletionToOrgAdmins(jobId).catch(() => undefined);
  });
}

/**
 * Task #1046 — preview the per-admin transcript backfill summary.
 *
 * Lets an org admin send themselves a sample summary in their currently
 * configured channel (email / Slack / Teams) so they can verify the
 * webhook URL and see what real run-completion summaries will look like
 * before the next backfill finishes. Uses the same message builder as
 * the real dispatcher, with a "[Test]" prefix and a sample-summary
 * banner so the message is unmistakably a preview.
 */
router.post(
  "/api/notifications/test-backfill-summary",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Your account is not associated with an organization." });
      }

      const channel = (req.user?.crmBackfillSummaryChannel ?? "email") as
        | "email" | "slack" | "teams" | "none";
      if (channel === "none") {
        return res.status(400).json({
          error: "Your delivery channel is set to \"Don't notify me\". Pick a channel before sending a test summary.",
        });
      }

      // Pull org name + the admin's webhook URLs from notification_channel_prefs.
      const [orgRow] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      const orgName = orgRow?.name || "your organization";

      const [prefsRow] = await db
        .select({
          slackWebhookUrl: notificationChannelPrefs.slackWebhookUrl,
          teamsWebhookUrl: notificationChannelPrefs.teamsWebhookUrl,
        })
        .from(notificationChannelPrefs)
        .where(eq(notificationChannelPrefs.userId, req.user!.id))
        .limit(1);

      const operatorName =
        [req.user?.firstName, req.user?.lastName]
          .filter((p): p is string => !!p)
          .join(" ")
          .trim() ||
        req.user?.email ||
        "you";

      const now = new Date();
      const startedAt = new Date(now.getTime() - 4 * 60 * 1000 - 12 * 1000);
      const sampleId = `sample-${now.getTime().toString(36)}`;

      // A "succeeded with a couple of failures" sample exercises both
      // the success and failure columns so admins can see what they'll
      // get for a typical mixed-result run.
      const content = buildBackfillSummaryContent({
        jobId: sampleId,
        status: "COMPLETED",
        total: 42,
        processed: 42,
        succeeded: 39,
        failed: 3,
        startedAt,
        completedAt: now,
        parentJobId: null,
        orgName,
        operatorName,
        testPrefix: true,
      });

      if (channel === "email") {
        const to = (req.user?.email ?? "").trim();
        if (!to) {
          return res.status(400).json({
            error: "Your account has no email address on file, so the sample can't be delivered.",
          });
        }
        try {
          const ok = await sendEmail({
            to: [to],
            subject: content.subject,
            text: content.text,
            html: content.html,
          });
          if (!ok) {
            return res.status(502).json({
              error: "Email transport reported a failure. Check the server logs and try again.",
            });
          }
          return res.json({ ok: true, channel: "email", target: to });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logWarn("crmCalls: test backfill summary email failed", { orgId, error: message });
          return res.status(502).json({ error: `Email delivery failed: ${message}` });
        }
      }

      if (channel === "slack") {
        const url = (prefsRow?.slackWebhookUrl ?? "").trim();
        if (!url) {
          return res.status(400).json({
            error: "No Slack webhook URL is configured. Add one in your channel preferences before sending a test.",
          });
        }
        if (!isValidSlackWebhookUrl(url)) {
          return res.status(400).json({
            error: "The configured Slack webhook URL is invalid (must start with https://hooks.slack.com/).",
          });
        }
        try {
          const payload = {
            blocks: [
              { type: "header", text: { type: "plain_text", text: content.chatTitle, emoji: true } },
              { type: "section", text: { type: "mrkdwn", text: content.chatBody } },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "View backfill history" },
                    url: content.historyUrl,
                    action_id: "open_app",
                  },
                ],
              },
            ],
          };
          const slackRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!slackRes.ok) {
            const body = await slackRes.text().catch(() => "");
            return res.status(502).json({
              error: `Slack webhook returned ${slackRes.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
            });
          }
          return res.json({ ok: true, channel: "slack" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logWarn("crmCalls: test backfill summary slack failed", { orgId, error: message });
          return res.status(502).json({ error: `Slack delivery failed: ${message}` });
        }
      }

      // channel === "teams"
      const url = (prefsRow?.teamsWebhookUrl ?? "").trim();
      if (!url) {
        return res.status(400).json({
          error: "No Microsoft Teams webhook URL is configured. Add one in your channel preferences before sending a test.",
        });
      }
      if (!isValidTeamsWebhookUrl(url)) {
        return res.status(400).json({
          error: "The configured Teams webhook URL is invalid (expected a Microsoft Teams or Office 365 connector URL).",
        });
      }
      try {
        const card = {
          type: "message",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                type: "AdaptiveCard",
                version: "1.4",
                body: [
                  { type: "TextBlock", text: content.chatTitle, weight: "Bolder", size: "Medium", wrap: true },
                  { type: "TextBlock", text: content.chatBody, wrap: true, spacing: "Small" },
                ],
                actions: [
                  { type: "Action.OpenUrl", title: "View backfill history", url: content.historyUrl },
                ],
              },
            },
          ],
        };
        const teamsRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(card),
        });
        if (!teamsRes.ok) {
          const body = await teamsRes.text().catch(() => "");
          return res.status(502).json({
            error: `Teams webhook returned ${teamsRes.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          });
        }
        return res.json({ ok: true, channel: "teams" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWarn("crmCalls: test backfill summary teams failed", { orgId, error: message });
        return res.status(502).json({ error: `Teams delivery failed: ${message}` });
      }
    } catch (e) {
      next(e);
    }
  },
);

/**
 * Task #1086 — preview the per-admin alert-delivery-failure emails.
 *
 * Mirrors Task #1046's `/test-backfill-summary` button: lets an org
 * admin email themselves a sample copy of either the real-time
 * fallback (`buildAlertFailureFallbackContent`) or the daily digest
 * (`buildAlertFailureDigestContent`) so they can verify their inbox/
 * filters without waiting for a real failure or the next nightly run.
 *
 * The email always goes to the requesting admin only (never the rest
 * of the org's admins), and the subject is prefixed with `[Test]` so
 * it can't be mistaken for a production alert. We deliberately do NOT
 * consult `alertFailureEmailMode` / mute toggles here — the whole
 * point of the button is to preview the template even when the admin
 * has the real stream silenced.
 */
router.post(
  "/api/notifications/test-alert-failure-email",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) {
        return res.status(400).json({
          error: "Your account is not associated with an organization.",
        });
      }

      const stream = (req.body?.stream ?? "realtime") as
        | "realtime"
        | "digest";
      if (stream !== "realtime" && stream !== "digest") {
        return res.status(400).json({
          error: 'Invalid stream — expected "realtime" or "digest".',
        });
      }

      const to = (req.user?.email ?? "").trim();
      if (!to) {
        return res.status(400).json({
          error:
            "Your account has no email address on file, so the sample can't be delivered.",
        });
      }

      const operatorName =
        [req.user?.firstName, req.user?.lastName]
          .filter((p): p is string => !!p)
          .join(" ")
          .trim() ||
        to ||
        "you";

      let subject: string;
      let text: string;
      let html: string;

      if (stream === "realtime") {
        const content = buildAlertFailureFallbackContent({
          orgId,
          jobId: `sample-${Date.now().toString(36)}`,
          channel: "slack",
          recipientSummary: operatorName,
          errorMessage:
            "Sample failure — Slack webhook returned 404 (no_service)",
        });
        subject = `[Test] ${content.subject}`;
        text =
          "This is a sample alert-delivery-failure email triggered from your notification preferences. " +
          "It was sent only to you so you can preview the format and verify your inbox/filters.\n\n" +
          content.text;
        html =
          `<p style="font-family:-apple-system,system-ui,sans-serif;font-size:13px;color:#6b7280;margin:0 0 12px;">` +
          `<em>This is a sample alert-delivery-failure email triggered from your notification preferences. ` +
          `It was sent only to you so you can preview the format and verify your inbox/filters.</em></p>` +
          content.html;
      } else {
        const now = new Date();
        const sampleEntry = {
          organizationId: orgId,
          total: 3,
          slackCount: 2,
          emailCount: 1,
          recentFailures: [
            {
              jobId: `sample-${now.getTime().toString(36)}-a`,
              channel: "slack" as const,
              recipientSummary: operatorName,
              errorMessage: "Slack webhook returned 404 (no_service)",
              attemptedAt: new Date(now.getTime() - 45 * 60 * 1000),
            },
            {
              jobId: `sample-${now.getTime().toString(36)}-b`,
              channel: "email" as const,
              recipientSummary: to,
              errorMessage: "SMTP transport refused: 550 mailbox unavailable",
              attemptedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
            },
            {
              jobId: `sample-${now.getTime().toString(36)}-c`,
              channel: "slack" as const,
              recipientSummary: operatorName,
              errorMessage: "Slack webhook returned 410 (channel_archived)",
              attemptedAt: new Date(now.getTime() - 18 * 60 * 60 * 1000),
            },
          ],
        };
        const content = buildAlertFailureDigestContent({
          entry: sampleEntry,
          windowHours: 24,
        });
        subject = `[Test] ${content.subject}`;
        text =
          "This is a sample alert-delivery-failure digest triggered from your notification preferences. " +
          "It was sent only to you so you can preview the format and verify your inbox/filters.\n\n" +
          content.text;
        html =
          `<p style="font-family:-apple-system,system-ui,sans-serif;font-size:13px;color:#6b7280;margin:0 0 12px;">` +
          `<em>This is a sample alert-delivery-failure digest triggered from your notification preferences. ` +
          `It was sent only to you so you can preview the format and verify your inbox/filters.</em></p>` +
          content.html;
      }

      try {
        const ok = await sendEmail({ to: [to], subject, text, html });
        if (!ok) {
          return res.status(502).json({
            error:
              "Email transport reported a failure. Check the server logs and try again.",
          });
        }
        return res.json({ ok: true, stream, target: to });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWarn("crmCalls: test alert-failure email send failed", {
          orgId,
          stream,
          error: message,
        });
        return res.status(502).json({ error: `Email delivery failed: ${message}` });
      }
    } catch (e) {
      next(e);
    }
  },
);

export async function fetchEligibleRecordingBatch(
  orgId: string,
  excludeIds: Set<string>,
  batchSize: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: crmCallRecordings.id })
    .from(crmCallRecordings)
    .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
    .where(
      and(
        eq(crmCalls.organizationId, orgId),
        sql`${crmCallRecordings.transcript} IS NULL`,
        inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
      ),
    )
    .orderBy(desc(crmCallRecordings.createdAt))
    // Pull a few extra rows so we can skip ones we've already attempted in
    // this run (e.g. failures that stay PENDING/FAILED in the table).
    .limit(batchSize + excludeIds.size);
  return rows.map((r) => r.id).filter((id) => !excludeIds.has(id)).slice(0, batchSize);
}

// Exported for tests only — Task #1014's coverage of the >50-failure retry
// flow needs to drive the worker without going through the POST endpoint
// (which paginates through every PENDING/FAILED recording in the org and
// makes it awkward to seed an exact failure count).
export async function __runTranscriptBackfillForTests(
  job: BackfillJobState,
  initialRecordingIds: string[],
  concurrency: number,
  maxRecords: number | null,
) {
  return runTranscriptBackfill(job, initialRecordingIds, concurrency, maxRecords);
}

// Task #1036 — cooperative cancellation. The cancel endpoint adds the job id
// to this set; the worker checks it on every iteration (and between batches)
// and bails out, marking the job FAILED. In-memory is sufficient because
// every backfill worker runs in the same Node process that owns the job
// (a different process won't see the in-memory active worker either, in
// which case the cancel endpoint reaps the row directly).
// Task #1070 — store the canceller's user id and optional free-text reason
// alongside the job id so the worker can persist them when it transitions
// the row to CANCELLED. A Set was sufficient before; a Map keyed by job id
// keeps the same "is this job cancelling?" semantics while also carrying
// the bookkeeping the new UI / notification copy needs.
type BackfillCancelRequest = {
  cancelledById: string;
  reason: string | null;
};
const cancelRequestedJobs = new Map<string, BackfillCancelRequest>();

export function __resetBackfillCancelRequestsForTests() {
  cancelRequestedJobs.clear();
}

export function __requestBackfillCancelForTests(
  jobId: string,
  cancelledById: string = "test-user",
  reason: string | null = null,
) {
  cancelRequestedJobs.set(jobId, { cancelledById, reason });
}

async function runTranscriptBackfill(
  job: BackfillJobState,
  initialRecordingIds: string[],
  concurrency: number,
  maxRecords: number | null,
) {
  // Track every recording id we've attempted (succeeded or failed) so we can
  // page forward without re-processing rows whose status didn't flip out of
  // PENDING/FAILED (e.g. transient Whisper errors).
  const attempted = new Set<string>();
  let queue: string[] = [...initialRecordingIds];

  const takeNext = (): string | null => {
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (!attempted.has(id)) {
        attempted.add(id);
        return id;
      }
    }
    return null;
  };

  const worker = async () => {
    while (true) {
      if (maxRecords !== null && job.processed >= maxRecords) return;
      // Task #1036 — cooperative cancel check on every iteration so we stop
      // before kicking off another transcription when an admin clicked Cancel.
      if (cancelRequestedJobs.has(job.id)) return;
      const recordingId = takeNext();
      if (!recordingId) return;
      try {
        const result = await transcribeCallRecording(recordingId);
        if (result.ok) {
          job.succeeded += 1;
        } else {
          job.failed += 1;
          // Task #1003 — always record the failed id (unbounded) so the retry
          // endpoint can re-run every failure, even past the bounded sample.
          job.failedRecordingIds.push(recordingId);
          if (job.errors.length < MAX_BACKFILL_ERROR_SAMPLES) {
            job.errors.push({ recordingId, error: result.error || "Unknown error" });
          }
          logWarn("crmCalls: transcript backfill recording failed", {
            jobId: job.id,
            recordingId,
            error: result.error,
          });
        }
      } catch (e) {
        job.failed += 1;
        // Task #1003 — same as the result.ok==false branch above: capture the
        // id unconditionally even when the error message sample is full.
        job.failedRecordingIds.push(recordingId);
        const msg = e instanceof Error ? e.message : String(e);
        if (job.errors.length < MAX_BACKFILL_ERROR_SAMPLES) {
          job.errors.push({ recordingId, error: msg.slice(0, 500) });
        }
        logError(
          "crmCalls: transcript backfill threw",
          { jobId: job.id, recordingId },
          e instanceof Error ? e : new Error(String(e)),
        );
      } finally {
        job.processed += 1;
        try {
          await persistJobProgress(job);
        } catch (e) {
          logWarn("crmCalls: failed to persist transcript backfill progress", {
            jobId: job.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  };

  try {
    while (true) {
      if (maxRecords !== null && job.processed >= maxRecords) break;
      // Task #1036 — bail out before spawning another batch of workers if a
      // cancel was requested while the previous batch was draining.
      if (cancelRequestedJobs.has(job.id)) break;
      const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
      await Promise.all(workers);
      if (maxRecords !== null && job.processed >= maxRecords) break;
      if (cancelRequestedJobs.has(job.id)) break;

      // After draining the current queue, look for any newly-discovered or
      // still-eligible recordings. Successful runs flip status to COMPLETED
      // and fall out of the filter; failures stay eligible but are excluded
      // via `attempted` so we don't loop forever on the same row.
      const remaining = maxRecords !== null ? maxRecords - job.processed : BACKFILL_BATCH_SIZE;
      const batchSize = Math.min(BACKFILL_BATCH_SIZE, Math.max(1, remaining));
      const next = await fetchEligibleRecordingBatch(job.orgId, attempted, batchSize);
      if (next.length === 0) break;
      queue = next;
      // job.total was initialized from the full up-front eligible count, so
      // we don't add the batch size here (that would double-count rows we
      // already accounted for). If new recordings arrived mid-run and push
      // processed past the initial estimate, bump total to keep the
      // displayed total >= processed for accurate progress percentages.
      if (job.processed + queue.length > job.total) {
        job.total = job.processed + queue.length;
      }
    }
    // Task #1036 — if cancellation was requested, mark the run terminal so
    // admins can distinguish a cancelled run from a clean completion. Clear
    // the request flag so a future job id reuse (impossible in practice but
    // cheap insurance) starts with a fresh slate.
    // Task #1057 — use the dedicated CANCELLED status (instead of FAILED)
    // so the badge, history label, and notification copy can reflect that
    // the run was deliberately stopped rather than crashing.
    {
      const cancelReq = cancelRequestedJobs.get(job.id);
      if (cancelReq) {
        cancelRequestedJobs.delete(job.id);
        job.status = "CANCELLED";
        // Task #1070 — record who clicked Cancel and the optional free-text
        // reason so the active-job card / history row / completion email can
        // surface them. Captured here (not at request time) so a worker that
        // happens to finish the same iteration as the cancel signal still
        // persists the canceller info on its way to terminal.
        job.cancelledById = cancelReq.cancelledById;
        job.cancellationReason = cancelReq.reason;
        logInfo("crmCalls: transcript backfill cancelled by admin", {
          jobId: job.id,
          orgId: job.orgId,
          processed: job.processed,
          cancelledById: cancelReq.cancelledById,
          hasReason: !!cancelReq.reason,
        });
      } else {
        job.status = "COMPLETED";
      }
    }
  } catch (e) {
    job.status = "FAILED";
    logError(
      "crmCalls: transcript backfill job failed",
      { jobId: job.id },
      e instanceof Error ? e : new Error(String(e)),
    );
  } finally {
    // Task #1036 — ensure the cancellation flag is always cleared on a
    // terminal exit (including the catch path above), so a stale entry
    // can never linger in the in-memory Set after the worker is gone.
    cancelRequestedJobs.delete(job.id);
    job.completedAt = new Date().toISOString();
    try {
      await persistJobProgress(job);
    } catch (e) {
      logError(
        "crmCalls: failed to persist final transcript backfill state",
        { jobId: job.id },
        e instanceof Error ? e : new Error(String(e)),
      );
    }
    logInfo("crmCalls: transcript backfill finished", {
      jobId: job.id,
      orgId: job.orgId,
      total: job.total,
      succeeded: job.succeeded,
      failed: job.failed,
    });
    // Task #1008 — surface the operator's display name + email in the
    // run-completed Slack/email notifications so admins know who to ask
    // about a failed run without opening the admin page. Falls back
    // gracefully when the user record was deleted (operator === null).
    try {
      const operator = job.startedById
        ? await getCrmTranscriptBackfillOperatorContact(job.startedById)
        : null;
      // Task #1070 — also resolve the canceller's contact (when the run was
      // cancelled) so the run-completed Slack/email can name them. Reuses
      // the same lookup helper as the operator since both join `users`.
      const canceller = job.cancelledById
        ? await getCrmTranscriptBackfillOperatorContact(job.cancelledById)
        : null;
      await notifyBackfillCompletion(
        {
          id: job.id,
          orgId: job.orgId,
          status: job.status,
          total: job.total,
          processed: job.processed,
          succeeded: job.succeeded,
          failed: job.failed,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          parentJobId: job.parentJobId,
          cancelledById: job.cancelledById,
          cancellationReason: job.cancellationReason,
        },
        operator,
        { canceller },
      );
    } catch (e) {
      logWarn("crmCalls: failed to dispatch transcript backfill notification", {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // Task #1006 — additionally email each org admin (respecting their
    // per-user notification prefs) a self-contained summary of the
    // finished run with a link to the admin transcript-backfill page.
    // Complementary to Task #1008, which sends a single ops-wide Slack
    // / email-list alert that includes the operator's contact info.
    scheduleBackfillCompletionEmail(job.id);
  }
}

// Maximum age (since startedAt) at which a RUNNING job is still considered
// resumable. Anything older is treated as a zombie and reaped to FAILED so
// it can't tie up the per-org "no concurrent backfills" guard forever.
// Configurable via env so ops can tune it without a code change.
const BACKFILL_MAX_RESUMABLE_AGE_MS = (() => {
  const raw = Number(process.env.CRM_BACKFILL_MAX_RESUMABLE_AGE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
})();
// Default concurrency used when resuming an interrupted job that predates
// Task #992 and therefore has NULL persisted concurrency. Newer jobs persist
// the originally-requested value and use it instead (see Task #1012).
const BACKFILL_RESUME_CONCURRENCY = 2;

// Test-only seam (Task #1012): allow the resume path to call a stubbed
// runTranscriptBackfill so tests can assert it is invoked with the exact
// (concurrency, maxRecords) values loaded from the persisted job row without
// having to count side-effects of the real worker. Production code path is
// unchanged: the variable defaults to the real implementation.
let runTranscriptBackfillForResume: typeof runTranscriptBackfill = runTranscriptBackfill;
export function __setResumeRunTranscriptBackfillForTests(
  fn: typeof runTranscriptBackfill | null,
) {
  runTranscriptBackfillForResume = fn ?? runTranscriptBackfill;
}

// On boot, look at the most-recent RUNNING job per org and decide whether to
// resume it or reap it.
//
//   - If the heartbeat is still fresh (< getBackfillHeartbeatStaleMs()), some
//     other instance may still own the job in a multi-process / rolling
//     deploy setup. Leave it alone; the lazy on-read reaper in the GET
//     handler will catch it later if that instance is actually dead.
//   - If startedAt is older than BACKFILL_MAX_RESUMABLE_AGE_MS, treat the
//     job as a zombie and reap it to FAILED so a fresh backfill can start.
//   - Otherwise, the worker that owned this job died with the process. The
//     transcript worker is idempotent (it only operates on rows whose
//     transcript is still NULL with status PENDING/FAILED), so we can re-
//     launch it against the still-eligible recordings while keeping the
//     original id, started_at, started_by_id, and counters so the admin
//     sees a single continuous progress bar.
// Task #1005: build the in-app notification payload(s) for a reaped backfill
// job. We prefer the original starter (the admin who kicked off the run) so
// the notification lands in their inbox; if that account is gone or
// deactivated we fan out to every active org admin so the org isn't left
// without a signal.
async function notifyAdminsOfReapedBackfill(row: CrmTranscriptBackfillJob): Promise<void> {
  const recipients: string[] = [];
  if (row.startedById) {
    const [starter] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, row.startedById), eq(users.isActive, true)))
      .limit(1);
    if (starter) recipients.push(starter.id);
  }

  if (recipients.length === 0) {
    const orgAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, row.organizationId),
          eq(users.role, "ADMIN"),
          eq(users.isActive, true),
        ),
      );
    for (const admin of orgAdmins) recipients.push(admin.id);
  }

  if (recipients.length === 0) return;

  const processed = row.processed ?? 0;
  const total = row.total ?? 0;
  const succeeded = row.succeeded ?? 0;
  const failed = row.failed ?? 0;
  const message =
    `A CRM call transcript backfill was stuck for too long and has been ` +
    `marked failed on server restart. Processed ${processed}` +
    (total ? ` of ${total}` : "") +
    ` recording(s) (${succeeded} succeeded, ${failed} failed) before it was ` +
    `reaped. Start a fresh backfill to pick up where it left off.`;

  await insertNotifications(
    recipients.map((userId) => ({
      userId,
      organizationId: row.organizationId,
      type: "CRM_TRANSCRIPT_BACKFILL_REAPED" as const,
      title: "CRM transcript backfill was reaped",
      message,
      relatedEntityId: row.id,
      relatedEntityType: "CRM_TRANSCRIPT_BACKFILL_JOB" as const,
    })),
  );
}

let backfillBootRecoveryStarted = false;
// Test-only seam: allow the vitest suite to re-run the boot recovery path
// across multiple scenarios without having to reload the module.
export function __resetBackfillBootRecoveryStartedForTests() {
  backfillBootRecoveryStarted = false;
}
export async function resumeOrReapBackfillJobsOnBoot() {
  if (backfillBootRecoveryStarted) return;
  backfillBootRecoveryStarted = true;
  try {
    const candidates = await listMostRecentRunningCrmTranscriptBackfillJobsPerOrg();
    if (candidates.length === 0) return;

    const now = Date.now();
    let resumed = 0;
    let reaped = 0;
    let skipped = 0;

    for (const row of candidates) {
      const heartbeatAgeMs = now - new Date(row.heartbeatAt).getTime();
      const startedAgeMs = now - new Date(row.startedAt).getTime();

      // Another live instance probably owns this job — don't touch it.
      if (heartbeatAgeMs < getBackfillHeartbeatStaleMs()) {
        skipped += 1;
        continue;
      }

      // Stuck / zombie job — reap so the per-org guard doesn't block forever.
      if (startedAgeMs >= BACKFILL_MAX_RESUMABLE_AGE_MS) {
        await updateCrmTranscriptBackfillJob(row.id, {
          status: "FAILED",
          completedAt: new Date(),
        });
        reaped += 1;
        logInfo("crmCalls: reaped zombie transcript backfill job on boot", {
          jobId: row.id,
          orgId: row.organizationId,
          startedAgeMs,
        });
        // Task #1005: surface the reap as an in-app (and optionally emailed)
        // notification so admins don't only learn about the failure when
        // they next visit the page hours later. Routes through the standard
        // notification pipeline, which respects each user's per-channel
        // opt-out preferences (the same toggle used for other admin alerts).
        try {
          await notifyAdminsOfReapedBackfill(row);
        } catch (notifyErr) {
          logWarn("crmCalls: failed to notify admins of reaped backfill", {
            jobId: row.id,
            orgId: row.organizationId,
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
          });
        }
        // Task #1006 — also email each org admin a summary of the reaped
        // (FAILED) job so the alert lands in their inbox alongside the
        // in-app notification above.
        scheduleBackfillCompletionEmail(row.id);
        continue;
      }

      // Resumable — bump the heartbeat right away so any concurrent boot of
      // another instance sees a fresh heartbeat and won't try to resume the
      // same job in parallel. Then re-launch the worker against the
      // still-eligible recordings.
      try {
        await updateCrmTranscriptBackfillJob(row.id, { heartbeatAt: new Date() });

        const job = rowToState(row);
        const eligible = await fetchEligibleRecordingBatch(
          job.orgId,
          new Set(),
          BACKFILL_BATCH_SIZE,
        );

        if (eligible.length === 0) {
          // Nothing left to do — close out the job cleanly so the admin sees
          // a definitive completed state instead of a perpetually-RUNNING row.
          job.status = "COMPLETED";
          job.completedAt = new Date().toISOString();
          await persistJobProgress(job);
          logInfo("crmCalls: resumed transcript backfill had nothing left to process", {
            jobId: job.id,
            orgId: job.orgId,
          });
          scheduleBackfillCompletionEmail(job.id);
          continue;
        }

        // Keep the job's existing id, startedAt, startedById, and counters
        // (they were loaded via rowToState above) so the admin's progress
        // bar continues from where it left off. Task #992: honor the
        // originally-requested concurrency and maxRecords if they were
        // persisted; older rows (pre-Task #992) fall back to the prior
        // defaults so behavior is unchanged for in-flight jobs.
        const resumeConcurrency = row.concurrency ?? BACKFILL_RESUME_CONCURRENCY;
        const resumeMaxRecords = row.maxRecords ?? null;
        void runTranscriptBackfillForResume(job, eligible, resumeConcurrency, resumeMaxRecords);
        resumed += 1;
        logInfo("crmCalls: resumed interrupted transcript backfill on boot", {
          jobId: job.id,
          orgId: job.orgId,
          processed: job.processed,
          total: job.total,
          concurrency: resumeConcurrency,
          maxRecords: resumeMaxRecords,
          heartbeatAgeMs,
        });
      } catch (e) {
        logWarn("crmCalls: failed to resume transcript backfill on boot", {
          jobId: row.id,
          orgId: row.organizationId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (resumed > 0 || reaped > 0 || skipped > 0) {
      logInfo("crmCalls: transcript backfill boot recovery summary", {
        resumed,
        reaped,
        skipped,
      });
    }
  } catch (e) {
    logWarn("crmCalls: failed to resume/reap transcript backfill jobs on boot", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
// Boot recovery is now triggered from server/index.ts after
// runStartupMigrations() finishes so the crm_transcript_backfill_jobs table
// is guaranteed to exist on a fresh database. Calling it at module-import
// time used to race the migration on first boot, producing a "relation does
// not exist" warning and skipping recovery for that boot entirely.

// Pending-count endpoint so the admin UI can show how many recordings are
// missing a transcript before launching a backfill, plus surface the currently
// running job (if any) so a fresh page load can resume polling. Task #969:
// activeJob now comes from the persisted backfill jobs table so it survives a
// server restart, and stale RUNNING rows are reaped on read.
router.get(
  "/api/crm/calls/transcripts/backfill",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      // Task #1019 — SUPER_ADMINs need a roll-up across every tenant so a
      // runaway backfill in another org can't hide behind their own org's
      // pending counter. They may also pin the banner to a single org via
      // `?organizationId=<id>` (matches the picker on the history view).
      // Org-scoped admins are still locked to their own org.
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | null = null;
      if (superAdmin) {
        const requested = typeof req.query.organizationId === "string"
          ? req.query.organizationId.trim()
          : "";
        scopedOrgId = requested.length > 0 ? requested : null;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const crossOrg = superAdmin && scopedOrgId === null;

      // Pending count: scope to a single org when one is selected, otherwise
      // sum across every org for the cross-org roll-up.
      const pendingWhere = crossOrg
        ? and(
            sql`${crmCallRecordings.transcript} IS NULL`,
            inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
          )
        : and(
            eq(crmCalls.organizationId, scopedOrgId as string),
            sql`${crmCallRecordings.transcript} IS NULL`,
            inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
          );
      const [{ count: pendingRaw }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmCallRecordings)
        .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
        .where(pendingWhere);
      const pending = Number(pendingRaw) || 0;

      // Reap stale RUNNING rows just like the single-org path used to. For
      // cross-org, do it for every running job so the banner doesn't keep
      // showing a worker that died in some other tenant.
      const reapIfStale = async (
        row: CrmTranscriptBackfillJob,
      ): Promise<CrmTranscriptBackfillJob | null> => {
        const heartbeatAgeMs = Date.now() - new Date(row.heartbeatAt).getTime();
        if (heartbeatAgeMs > getBackfillHeartbeatStaleMs()) {
          const reaped = await updateCrmTranscriptBackfillJob(row.id, {
            status: "FAILED",
            completedAt: new Date(),
          });
          // Mirror the other reap sites: notify the operator that their
          // backfill ended (failed) so they don't silently lose visibility.
          scheduleBackfillCompletionEmail(row.id);
          return reaped;
        }
        return row;
      };

      if (crossOrg) {
        const runningRows = await listRunningCrmTranscriptBackfillJobsWithOrg();
        const runningJobs: Array<
          BackfillJobState & {
            organization: { id: string; name: string | null; slug: string | null };
          }
        > = [];
        for (const row of runningRows) {
          const reaped = await reapIfStale(row);
          if (!reaped || reaped.status !== "RUNNING") continue;
          // Task #1070 — running rows can never have a canceller yet, but
          // we still pipe through `enrichWithCanceller` so the response
          // shape stays uniform with the single-org branch below.
          const enriched = await enrichWithCanceller(rowToState(reaped));
          runningJobs.push({
            ...enriched,
            organization: {
              id: row.organizationId,
              name: row.organizationName,
              slug: row.organizationSlug,
            },
          });
        }
        // `activeJob` stays null in cross-org mode so the client doesn't pin
        // its single-job poller to one tenant; the UI uses `runningJobs`
        // instead. The summary endpoint itself is still polled for refresh.
        res.json({
          pending,
          activeJob: null,
          crossOrg: true,
          scopedOrganizationId: null,
          runningJobs,
        });
        return;
      }

      let activeJob:
        | (BackfillJobState & {
            cancelledBy: {
              id: string;
              firstName: string | null;
              lastName: string | null;
              email: string | null;
            } | null;
          })
        | null = null;
      const runningRow = await getRunningCrmTranscriptBackfillJob(
        scopedOrgId as string,
      );
      if (runningRow) {
        const reaped = await reapIfStale(runningRow);
        // Task #1070 — enrich the active job with the canceller profile so
        // the active card can render "Cancelled by …" the moment a CANCELLED
        // run is reaped (the worker also writes cancelledById on the row).
        activeJob = reaped ? await enrichWithCanceller(rowToState(reaped)) : null;
      }

      res.json({
        pending,
        activeJob,
        ...(superAdmin
          ? { crossOrg: false, scopedOrganizationId: scopedOrgId }
          : {}),
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1010 — drill-down list of recordings still missing transcripts. Mirrors
// the eligibility filter used by `fetchEligibleRecordingBatch` so admins
// triaging a reaped backfill see exactly what a fresh backfill would pick up.
// Results are paginated and joined back to their parent call so the UI can
// link the user straight to the deal/contact for individual triage.
router.get(
  "/api/crm/calls/transcripts/backfill/pending",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
        100,
      );
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

      const eligibility = and(
        eq(crmCalls.organizationId, orgId),
        sql`${crmCallRecordings.transcript} IS NULL`,
        inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
      );

      const [{ count: totalRaw }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmCallRecordings)
        .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
        .where(eligibility);
      const total = Number(totalRaw) || 0;

      const rows = await db
        .select({
          recordingId: crmCallRecordings.id,
          callId: crmCallRecordings.callId,
          transcriptStatus: crmCallRecordings.transcriptStatus,
          transcriptError: crmCallRecordings.transcriptError,
          recordingDurationSeconds: crmCallRecordings.durationSeconds,
          recordingCreatedAt: crmCallRecordings.createdAt,
          opportunityId: crmCalls.opportunityId,
          contactId: crmCalls.contactId,
          crmOrganisationId: crmCalls.crmOrganisationId,
          direction: crmCalls.direction,
          fromNumber: crmCalls.fromNumber,
          toNumber: crmCalls.toNumber,
          callStartedAt: crmCalls.startedAt,
          callDurationSeconds: crmCalls.durationSeconds,
        })
        .from(crmCallRecordings)
        .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
        .where(eligibility)
        .orderBy(desc(crmCallRecordings.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        total,
        limit,
        offset,
        recordings: rows.map((r) => ({
          recordingId: r.recordingId,
          callId: r.callId,
          transcriptStatus: r.transcriptStatus,
          transcriptError: r.transcriptError,
          recordingDurationSeconds: r.recordingDurationSeconds,
          recordingCreatedAt: r.recordingCreatedAt
            ? new Date(r.recordingCreatedAt).toISOString()
            : null,
          opportunityId: r.opportunityId,
          contactId: r.contactId,
          crmOrganisationId: r.crmOrganisationId,
          direction: r.direction,
          fromNumber: r.fromNumber,
          toNumber: r.toNumber,
          callStartedAt: r.callStartedAt ? new Date(r.callStartedAt).toISOString() : null,
          callDurationSeconds: r.callDurationSeconds,
        })),
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1027 — per-recording retry. Lets admins re-run transcription for a
// single stuck row (e.g. a one-off Whisper failure) directly from the
// drill-down list, without spinning up a new backfill job. Mirrors the
// eligibility filter used by `fetchEligibleRecordingBatch` so the UI and
// retry agree on what "still needs a transcript" means.
router.post(
  "/api/crm/calls/transcripts/recordings/:id/retry",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const recordingId = req.params.id;

      // Confirm the recording exists, belongs to this org, and is still
      // eligible (no transcript and status PENDING/FAILED). Anything else is
      // either already transcribed, currently being processed by another
      // worker, or owned by a different org — all of which should not be
      // retried from this endpoint.
      const [eligible] = await db
        .select({
          id: crmCallRecordings.id,
          transcriptStatus: crmCallRecordings.transcriptStatus,
        })
        .from(crmCallRecordings)
        .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
        .where(
          and(
            eq(crmCallRecordings.id, recordingId),
            eq(crmCalls.organizationId, orgId),
            sql`${crmCallRecordings.transcript} IS NULL`,
            inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
          ),
        )
        .limit(1);

      if (!eligible) {
        // Distinguish "not yours / not found" from "already done" so the UI
        // can show a helpful message. We re-query without the eligibility
        // filter (still scoped to the org) to figure out which case applies.
        const [existing] = await db
          .select({
            id: crmCallRecordings.id,
            transcriptStatus: crmCallRecordings.transcriptStatus,
          })
          .from(crmCallRecordings)
          .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
          .where(
            and(
              eq(crmCallRecordings.id, recordingId),
              eq(crmCalls.organizationId, orgId),
            ),
          )
          .limit(1);
        if (!existing) {
          return res.status(404).json({ error: "Recording not found" });
        }
        return res.status(409).json({
          error: "Recording is no longer eligible for retry",
          transcriptStatus: existing.transcriptStatus,
        });
      }

      logInfo("crmCalls: per-recording transcript retry started", {
        recordingId,
        orgId,
        previousStatus: eligible.transcriptStatus,
        startedById: req.user!.id,
      });

      // Run synchronously so the admin gets immediate feedback (success or
      // the specific error). `transcribeCallRecording` updates the row's
      // status/transcript itself, so a successful run causes the row to drop
      // out of the pending list on the next refetch.
      const result = await transcribeCallRecording(recordingId);
      if (!result.ok) {
        return res.status(502).json({
          error: result.error || "Transcription failed",
          recordingId,
        });
      }
      res.json({
        success: true,
        recordingId,
        transcript: result.transcript,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/api/crm/calls/transcripts/backfill",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const schema = z.object({
        // By default the backfill processes ALL eligible recordings via
        // pagination. `maxRecords` is an optional safety cap for one-off
        // partial runs (e.g. a small dry run before processing everything).
        maxRecords: z.number().int().min(1).optional(),
        concurrency: z.number().int().min(1).max(4).optional(),
        // Task #1036 — SUPER_ADMINs may target a specific tenant from the
        // platform admin page (e.g. to start a corrective run after cancelling
        // a runaway backfill). Org-scoped admins are still locked to their
        // own org via resolveOrg below regardless of this field.
        organizationId: z.string().min(1).optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const maxRecords = parsed.data.maxRecords ?? null;
      const concurrency = parsed.data.concurrency ?? 2;

      // Task #1036 — resolve target org. Super admins may pick any tenant via
      // body.organizationId; org-scoped admins are forced to their own org
      // (any organizationId in the body is ignored, matching the existing
      // tenant-isolation guarantees).
      let orgId: string | null;
      if (isSuperAdmin(req.user) && parsed.data.organizationId) {
        orgId = parsed.data.organizationId;
      } else {
        orgId = resolveOrg(req, res);
        if (!orgId) return;
      }

      // Don't allow two concurrent backfills for the same org — they would
      // race over the same PENDING/FAILED rows. A RUNNING row whose heartbeat
      // is stale was orphaned by a process restart; mark it FAILED so a fresh
      // run can start.
      const existingRunning = await getRunningCrmTranscriptBackfillJob(orgId);
      if (existingRunning) {
        const heartbeatAgeMs =
          Date.now() - new Date(existingRunning.heartbeatAt).getTime();
        if (heartbeatAgeMs <= getBackfillHeartbeatStaleMs()) {
          return res.status(409).json({
            error: "A transcript backfill is already running for this organization",
            jobId: existingRunning.id,
          });
        }
        await updateCrmTranscriptBackfillJob(existingRunning.id, {
          status: "FAILED",
          completedAt: new Date(),
        });
        logWarn("crmCalls: reaped stale transcript backfill job before starting a new one", {
          jobId: existingRunning.id,
          orgId,
          heartbeatAgeMs,
        });
        scheduleBackfillCompletionEmail(existingRunning.id);
      }

      // Seed the worker queue with the first batch. The job will keep paging
      // forward until no more eligible recordings exist (or maxRecords hit).
      const firstBatchSize =
        maxRecords !== null ? Math.min(BACKFILL_BATCH_SIZE, maxRecords) : BACKFILL_BATCH_SIZE;
      const eligible = await fetchEligibleRecordingBatch(orgId, new Set(), firstBatchSize);

      // Also count total eligible rows up front so admins see a meaningful
      // initial total in the progress endpoint. The number can grow if new
      // recordings arrive mid-run; the worker loop tops `job.total` up as it
      // discovers them.
      const [{ count: totalEligibleRaw }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crmCallRecordings)
        .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
        .where(
          and(
            eq(crmCalls.organizationId, orgId),
            sql`${crmCallRecordings.transcript} IS NULL`,
            inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
          ),
        );
      const totalEligible = Number(totalEligibleRaw) || 0;
      const initialTotal = maxRecords !== null ? Math.min(totalEligible, maxRecords) : totalEligible;

      const jobId = `backfill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const persistedRow = await createCrmTranscriptBackfillJob({
        id: jobId,
        organizationId: orgId,
        status: "RUNNING",
        total: initialTotal,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        failedRecordingIds: [],
        completedAt: null,
        startedById: req.user!.id,
        // Task #992 — persist the admin's chosen speed and safety cap so a
        // resume after a server restart honors them instead of falling back
        // to hardcoded defaults.
        concurrency,
        maxRecords,
      });
      const job = rowToState(persistedRow);

      logInfo("crmCalls: transcript backfill started", {
        jobId,
        orgId,
        total: job.total,
        concurrency,
        startedById: job.startedById,
      });

      if (eligible.length === 0) {
        job.status = "COMPLETED";
        job.completedAt = new Date().toISOString();
        await persistJobProgress(job);
        scheduleBackfillCompletionEmail(jobId);
        return res.status(200).json({ jobId, total: 0, message: "No recordings to backfill" });
      }

      // Fire-and-forget; the request returns immediately. The worker keeps
      // paginating through eligible recordings until none remain. Progress is
      // flushed to the persisted row after each recording.
      void runTranscriptBackfill(job, eligible, concurrency, maxRecords);

      res.status(202).json({ jobId, total: job.total });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1032 / #1059 — admin "notification destinations" panel. Returns
// whether a Slack webhook and email recipient list are configured for the
// caller's org so the admin page can show the current setup state up front
// (instead of forcing admins to click "Send test alert" to find out).
// Sources the per-org settings row saved from the in-app settings UI
// (Task #1017), with the same env-var fallback as
// `resolveBackfillNotificationDestinations` for deployments that haven't
// migrated yet — so this endpoint matches what the test-alert button and
// the real run-completed dispatcher will actually target. The Slack
// webhook URL itself is intentionally NOT returned — only a
// configured/valid summary.
router.get(
  "/api/crm/calls/transcripts/backfill/notification-config",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      // Task #1078 — also surface the heartbeat staleness window so the
      // admin UI's cross-org Cancel hint can render the live value instead
      // of a hardcoded "5 minutes" string.
      const cfg = await getBackfillNotificationConfig(orgId);
      // Task #1130 — also surface the operator's originally-requested value
      // (or null if the env was unset/invalid) so the admin UI can render a
      // "(clamped from X)" hint when ops set e.g. "20" expecting a 20-second
      // window and the resolver rounded it up to the 30-second floor. The
      // effective `heartbeatStaleMs` comes from the live accessor (Task
      // #1131) so test-time overrides via `__setBackfillHeartbeatStaleMsForTests`
      // are reflected here too.
      res.json({
        ...cfg,
        heartbeatStaleMs: getBackfillHeartbeatStaleMs(),
        heartbeatStaleRequestedMs:
          BACKFILL_HEARTBEAT_STALE_RESOLUTION.requestedMs,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1085 — list each active org admin alongside their currently-saved
// `alertFailureEmailMode` so the admin transcript-backfill page can render
// a "who's set to receive what" panel and flag orgs where nobody is on the
// realtime stream (so a misconfigured webhook would only be noticed via
// the next day's digest). Mirrors the auth posture of the sibling
// notification-config endpoint above (ADMIN-only, scoped to caller org).
router.get(
  "/api/crm/calls/transcripts/backfill/admin-alert-failure-modes",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const admins = await listOrgAdminAlertFailureModes(orgId);
      const realtimeRecipientCount = admins.filter(
        (a) =>
          a.alertFailureEmailMode === "both" ||
          a.alertFailureEmailMode === "realtime",
      ).length;
      // Task #1102 — aggregate "who would actually be paged" counts so the
      // UI can warn when nobody is left covering a channel after Task #1051
      // / Task #1066 opt-outs are applied. An admin counts as a recipient
      // for a channel when they:
      //   - aren't fully opted out via crmAlertFailureFallbackEnabled,
      //   - haven't muted that specific channel, AND
      //   - are on a stream that includes real-time pages
      //     (mode === "both" | "realtime"); the per-failure fallback only
      //     fires for the realtime stream.
      const isRealtime = (
        m: (typeof admins)[number]["alertFailureEmailMode"],
      ) => m === "both" || m === "realtime";
      const slackRecipientCount = admins.filter(
        (a) =>
          a.fallbackEnabled &&
          !a.fallbackMutedChannels.includes("slack") &&
          isRealtime(a.alertFailureEmailMode),
      ).length;
      const emailRecipientCount = admins.filter(
        (a) =>
          a.fallbackEnabled &&
          !a.fallbackMutedChannels.includes("email") &&
          isRealtime(a.alertFailureEmailMode),
      ).length;
      const fullyOptedOutCount = admins.filter(
        (a) => !a.fallbackEnabled,
      ).length;
      res.json({
        admins,
        realtimeRecipientCount,
        noRealtimeRecipients:
          admins.length > 0 && realtimeRecipientCount === 0,
        slackRecipientCount,
        emailRecipientCount,
        fullyOptedOutCount,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1053 — per-org cooldown between test-alert dispatches. The audit
// trail (Task #1033) made it obvious that the button has no rate limiting,
// so an admin (or a misclick) can spam Slack channels and email recipients
// at network speed. 30s is long enough to prevent accidental flooding
// while still allowing legitimate retesting after fixing settings.
const TEST_ALERT_COOLDOWN_SECONDS = 30;

// Task #1018 — admin "send test alert" endpoint. Dispatches a sample
// completion + failure notification through whichever Slack/email
// destinations are configured so admins can verify their setup without
// waiting for a real backfill to finish or fail. Returns per-channel
// success/failure so the UI can show distinct toasts.
router.post(
  "/api/crm/calls/transcripts/backfill/test-alert",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      // Task #1053 — enforce per-org cooldown using the existing audit table
      // (no new state needed). If the latest recorded send is within the
      // cooldown window, reject with 429 + Retry-After so the UI can disable
      // the button until the cooldown clears.
      const previous = await getLatestCrmTranscriptBackfillTestAlert(orgId);
      if (previous) {
        const elapsedMs = Date.now() - new Date(previous.sentAt).getTime();
        const cooldownMs = TEST_ALERT_COOLDOWN_SECONDS * 1000;
        if (elapsedMs < cooldownMs) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((cooldownMs - elapsedMs) / 1000),
          );
          const nextAllowedAt = new Date(
            new Date(previous.sentAt).getTime() + cooldownMs,
          ).toISOString();
          res.setHeader("Retry-After", String(retryAfterSeconds));
          res.status(429).json({
            error: `Test alerts are rate-limited to one every ${TEST_ALERT_COOLDOWN_SECONDS} seconds per organization. Try again in ${retryAfterSeconds}s.`,
            cooldownSeconds: TEST_ALERT_COOLDOWN_SECONDS,
            retryAfterSeconds,
            nextAllowedAt,
          });
          return;
        }
      }

      const operator = req.user?.id
        ? await getCrmTranscriptBackfillOperatorContact(req.user.id)
        : null;

      const result = await sendTestBackfillAlert(orgId, operator);

      // Task #1033 — persist a per-channel audit row so admins can see in-app
      // who last clicked the button and whether each channel succeeded,
      // instead of having to grep server logs. Best-effort: a write failure
      // should not break the test-alert dispatch itself.
      try {
        await createCrmTranscriptBackfillTestAlert({
          organizationId: orgId,
          sentById: req.user?.id ?? null,
          operatorDisplay: result.operatorDisplay,
          slackConfigured: result.slack.configured,
          slackOk: result.slack.ok,
          slackError: result.slack.error ?? null,
          emailConfigured: result.email.configured,
          emailOk: result.email.ok,
          emailError: result.email.error ?? null,
          emailRecipients: result.email.recipients ?? [],
        });
      } catch (auditErr) {
        logWarn("crmCallsRoutes: failed to persist test-alert audit row", {
          orgId,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
      }

      // Task #1045 — also persist the outcome on the settings row so the
      // settings card can render last-known health (timestamp + per-channel
      // ok/error) without admins having to re-fire the test on every visit.
      const testedAt = new Date();
      try {
        await recordCrmTranscriptBackfillTestResult(orgId, result, testedAt);
      } catch (err) {
        // Persistence failure must not mask the dispatch result the admin is
        // waiting on; surface it in logs and continue.
        logWarn("crmCalls: failed to persist test-alert result", {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      res.json({ ...result, testedAt: testedAt.toISOString() });

      // Task #1094 — fire-and-forget the threshold check after responding to
      // the admin so a slow Slack/email transport for the breach alert can
      // never block the original button click. The notifier swallows its
      // own errors; we only catch here as a defence-in-depth measure.
      void checkAndNotifyTestAlertThresholdBreach(orgId).catch((err) => {
        logWarn("crmCallsRoutes: threshold-breach check threw", {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1033 — surface the most recent test-alert audit row for the current
// org so the admin page can show "Last test alert sent by Jane at 3:14pm"
// underneath the "Send test alert" button.
router.get(
  "/api/crm/calls/transcripts/backfill/test-alert/latest",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const row = await getLatestCrmTranscriptBackfillTestAlert(orgId);
      // Task #1053 — expose the cooldown window (and the next-allowed time
      // when one is in effect) so the admin page can disable the "Send test
      // alert" button + show a tooltip without hardcoding the duration.
      const cooldownMs = TEST_ALERT_COOLDOWN_SECONDS * 1000;
      let nextAllowedAt: string | null = null;
      if (row) {
        const lastSent = new Date(row.sentAt).getTime();
        if (Date.now() - lastSent < cooldownMs) {
          nextAllowedAt = new Date(lastSent + cooldownMs).toISOString();
        }
      }
      res.json({
        latest: row,
        cooldownSeconds: TEST_ALERT_COOLDOWN_SECONDS,
        nextAllowedAt,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1052 — paginated history of test-alert audit rows so admins debugging
// flaky Slack/email setups can scroll back through prior attempts (when a
// channel started failing, who has been hammering the button) without a SQL
// session. SUPER_ADMINs may pass `?organizationId=<id>` to scope to a single
// tenant or omit it for a platform-wide view, matching the main backfill
// history endpoint above. Org-scoped admins are hard-locked to their own org.
router.get(
  "/api/crm/calls/transcripts/backfill/test-alert/history",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg = typeof req.query.organizationId === "string"
          ? req.query.organizationId.trim()
          : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
        100,
      );
      const offset = Math.max(
        parseInt(String(req.query.offset ?? "0"), 10) || 0,
        0,
      );

      // Task #1061 — optional filters so admins debugging long-running
      // patterns (when a channel started failing, who has been hammering
      // the button) can narrow the panel without scrolling page by page.
      const senderRaw =
        typeof req.query.sender === "string" ? req.query.sender.trim() : "";
      const sender = senderRaw.length > 0 ? senderRaw.slice(0, 200) : undefined;

      const parseBool = (v: unknown): boolean | undefined => {
        if (typeof v !== "string") return undefined;
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s === "false" || s === "0") return false;
        return undefined;
      };
      const slackOk = parseBool(req.query.slackOk);
      const emailOk = parseBool(req.query.emailOk);
      const anyFailed = parseBool(req.query.anyFailed);

      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || v.length === 0) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const sentAfter = parseDate(req.query.sentAfter);
      const sentBefore = parseDate(req.query.sentBefore);

      const { rows, total } = await listCrmTranscriptBackfillTestAlerts({
        organizationId: scopedOrgId,
        limit,
        offset,
        sender,
        slackOk,
        emailOk,
        anyFailed,
        sentAfter,
        sentBefore,
      });

      res.json({
        total,
        limit,
        offset,
        crossOrg: superAdmin && !scopedOrgId,
        alerts: rows,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1096 — CSV export of the test-alert history. Mirrors the filters of
// the JSON endpoint above and the UX of the main backfill `history.csv`
// exporter so admins can save the filtered audit trail offline (to share
// with ops, vendors, etc.) without screenshotting paginated rows.
router.get(
  "/api/crm/calls/transcripts/backfill/test-alert/history.csv",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg = typeof req.query.organizationId === "string"
          ? req.query.organizationId.trim()
          : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const senderRaw =
        typeof req.query.sender === "string" ? req.query.sender.trim() : "";
      const sender = senderRaw.length > 0 ? senderRaw.slice(0, 200) : undefined;

      const parseBool = (v: unknown): boolean | undefined => {
        if (typeof v !== "string") return undefined;
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s === "false" || s === "0") return false;
        return undefined;
      };
      const slackOk = parseBool(req.query.slackOk);
      const emailOk = parseBool(req.query.emailOk);
      const anyFailed = parseBool(req.query.anyFailed);

      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || v.length === 0) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const sentAfter = parseDate(req.query.sentAfter);
      const sentBefore = parseDate(req.query.sentBefore);

      const escapeCsv = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const HEADERS = [
        "id",
        "organization_id",
        "organization_name",
        "sent_at",
        "sender_name",
        "sender_email",
        "operator_display",
        "slack_configured",
        "slack_ok",
        "slack_error",
        "email_configured",
        "email_ok",
        "email_error",
        "email_recipients",
      ];

      const PAGE = 100;
      const MAX_ROWS = 100_000;
      const lines: string[] = [HEADERS.join(",")];
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { rows } = await listCrmTranscriptBackfillTestAlerts({
          organizationId: scopedOrgId,
          limit: PAGE,
          offset,
          sender,
          slackOk,
          emailOk,
          anyFailed,
          sentAfter,
          sentBefore,
        });
        if (rows.length === 0) break;
        for (const row of rows) {
          const fullName = [row.sentByFirstName, row.sentByLastName]
            .filter(Boolean)
            .join(" ")
            .trim();
          const senderName = fullName || row.sentByEmail || row.operatorDisplay || "";
          const sentAtIso = row.sentAt ? new Date(row.sentAt).toISOString() : "";
          lines.push(
            [
              row.id,
              row.organizationId ?? "",
              row.organizationName ?? "",
              sentAtIso,
              senderName,
              row.sentByEmail ?? "",
              row.operatorDisplay ?? "",
              row.slackConfigured ? "true" : "false",
              row.slackOk ? "true" : "false",
              row.slackError ?? "",
              row.emailConfigured ? "true" : "false",
              row.emailOk ? "true" : "false",
              row.emailError ?? "",
              (row.emailRecipients ?? []).join("; "),
            ]
              .map(escapeCsv)
              .join(","),
          );
        }
        offset += rows.length;
        if (rows.length < PAGE) break;
        if (offset >= MAX_ROWS) break;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="transcript-backfill-test-alert-history-${stamp}.csv"`,
      );
      res.send(lines.join("\n") + "\n");
    } catch (e) {
      next(e);
    }
  },
);

// Task #1060 — usage frequency rollup for the test-alert button (counts in
// the last 24h / 7d / 30d). Lets admins see at a glance how often the button
// is being clicked, which is far easier to scan than the raw history list
// when looking for misuse or runaway scripts. SUPER_ADMINs can pass
// `?organizationId=<id>` to scope to a single tenant or omit it for a
// platform-wide view; org-scoped admins are hard-locked to their own org.
router.get(
  "/api/crm/calls/transcripts/backfill/test-alert/usage",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg =
          typeof req.query.organizationId === "string"
            ? req.query.organizationId.trim()
            : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const summary = await getCrmTranscriptBackfillTestAlertUsageSummary({
        organizationId: scopedOrgId,
      });

      res.json({
        ...summary,
        crossOrg: superAdmin && !scopedOrgId,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1093 — per-day usage buckets for the test-alert button so the admin
// page can render an inline sparkline of daily counts next to the
// 24h/7d/30d rollup. Same auth + org-scoping rules as the rollup endpoint:
// SUPER_ADMINs may pass `?organizationId=<id>` to scope to a tenant or omit
// it for a platform-wide view; org-scoped admins are hard-locked to their
// own org. The `days` query param is clamped (1..90, default 30) so a
// runaway value can't ask for an unbounded range.
router.get(
  "/api/crm/calls/transcripts/backfill/test-alert/usage-buckets",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg =
          typeof req.query.organizationId === "string"
            ? req.query.organizationId.trim()
            : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const requestedDays = parseInt(String(req.query.days ?? "30"), 10);
      const days = Number.isFinite(requestedDays) ? requestedDays : 30;

      const result = await getCrmTranscriptBackfillTestAlertUsageBuckets({
        organizationId: scopedOrgId,
        days,
      });

      res.json({
        ...result,
        crossOrg: superAdmin && !scopedOrgId,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #986 — list recent transcript backfill jobs for the current org so
// admins can see prior runs (status, totals, who started it, error samples)
// without needing to remember a specific job id.
router.get(
  "/api/crm/calls/transcripts/backfill/history",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      // Task #1007 — SUPER_ADMINs supporting multiple customers need a
      // platform-wide view. They can either omit the org filter to see every
      // org or pass `?organizationId=<id>` to scope to a specific tenant.
      // Org-scoped admins are still hard-locked to their own organization.
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg = typeof req.query.organizationId === "string"
          ? req.query.organizationId.trim()
          : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 100);
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

      // Status filter: accept a single value or a comma-separated list. Only
      // forward known statuses so a typo in the query string can't degrade the
      // SQL into matching nothing silently.
      const ALLOWED_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"]; // Task #1057
      const rawStatus = req.query.status;
      const statusList = Array.isArray(rawStatus)
        ? rawStatus.map(String)
        : typeof rawStatus === "string" && rawStatus.length > 0
        ? rawStatus.split(",")
        : [];
      const statuses = statusList
        .map((s) => s.trim().toUpperCase())
        .filter((s) => ALLOWED_STATUSES.includes(s));

      const operatorRaw = typeof req.query.operator === "string" ? req.query.operator.trim() : "";
      const operator = operatorRaw.length > 0 ? operatorRaw.slice(0, 200) : undefined;

      const startedByIdRaw =
        typeof req.query.startedById === "string" ? req.query.startedById.trim() : "";
      const startedById =
        startedByIdRaw.length > 0 ? startedByIdRaw.slice(0, 200) : undefined;

      // Task #1090 — exact-match filter on the canceller. Mirrors the
      // existing `startedById` quick-pick so admins can quickly find every
      // run a specific person stopped.
      const cancelledByIdRaw =
        typeof req.query.cancelledById === "string" ? req.query.cancelledById.trim() : "";
      const cancelledById =
        cancelledByIdRaw.length > 0 ? cancelledByIdRaw.slice(0, 200) : undefined;

      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || v.length === 0) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const startedAfter = parseDate(req.query.startedAfter);
      const startedBefore = parseDate(req.query.startedBefore);

      const { rows, total } = await listCrmTranscriptBackfillJobs({
        organizationId: scopedOrgId,
        limit,
        offset,
        statuses: statuses.length > 0 ? statuses : undefined,
        operator,
        startedById,
        cancelledById,
        startedAfter,
        startedBefore,
      });

      // Task #1004 — pull the full retry lineage for every job on this page in
      // one round-trip (recursive CTE) so each row can render its parent →
      // retry-N chain inline without N+1 lookups against `parent_job_id`.
      const { jobToRoot, lineagesByRoot } = await getCrmTranscriptBackfillLineages(
        scopedOrgId,
        rows.map((r) => r.id),
      );
      // Task #1022 — attach the recipient list of the run-completed admin
      // email (if one was sent) so the UI can show who was notified for each
      // run. Only fetched for the visible page so an org with thousands of
      // jobs doesn't pull a huge join.
      const notificationsByJob = await listCrmTranscriptBackfillNotificationsForJobs(
        rows.map((r) => r.id),
      );

      res.json({
        total,
        limit,
        offset,
        crossOrg: superAdmin && !scopedOrgId,
        jobs: rows.map((row) => {
          const rootId = jobToRoot.get(row.id) ?? row.id;
          const lineage = lineagesByRoot.get(rootId) ?? [];
          const note = notificationsByJob.get(row.id);
          return {
            ...rowToState(row),
            heartbeatAt: row.heartbeatAt.toISOString(),
            startedBy: row.startedById
              ? {
                  id: row.startedById,
                  firstName: row.startedByFirstName,
                  lastName: row.startedByLastName,
                  email: row.startedByEmail,
                }
              : null,
            // Task #1070 — surface the canceller (when present) and the
            // free-text reason captured at cancel time so the history row
            // can show "Cancelled by Sam Doe — bad batch" without a
            // second round-trip to the users table.
            cancelledBy: row.cancelledById
              ? {
                  id: row.cancelledById,
                  firstName: row.cancelledByFirstName ?? null,
                  lastName: row.cancelledByLastName ?? null,
                  email: row.cancelledByEmail ?? null,
                }
              : null,
            cancellationReason: row.cancellationReason ?? null,
            organization: {
              id: row.organizationId,
              name: row.organizationName,
              slug: row.organizationSlug,
            },
            // Inline retry chain: ordered by startedAt ASC, parent first. Only
            // included when the lineage actually has more than one entry so
            // standalone runs stay visually quiet.
            lineage: lineage.length > 1
              ? lineage.map((entry, idx) => ({
                  id: entry.id,
                  status: entry.status,
                  startedAt: entry.startedAt.toISOString(),
                  completedAt: entry.completedAt
                    ? entry.completedAt.toISOString()
                    : null,
                  parentJobId: entry.parentJobId,
                  // 0 = original run, 1+ = nth retry. Used by the UI to label
                  // each chip ("parent", "retry 1", "retry 2", …).
                  attempt: idx,
                }))
              : [],
            // Task #1022 — recipient snapshot for the run-completed admin
            // email. `null` when no notification was dispatched.
            notification: note
              ? {
                  channel: note.channel,
                  recipientEmails: note.recipientEmails,
                  recipientCount: note.recipientCount,
                  notifiedAt: note.notifiedAt.toISOString(),
                }
              : null,
          };
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1017 — per-organization Slack/email destinations for transcript
// backfill alerts. Admins can self-serve from the in-app settings page so
// they no longer need an ops change to set CRM_BACKFILL_NOTIFY_* env vars.
router.get(
  "/api/crm/calls/transcripts/backfill/notification-settings",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const settings = await getCrmTranscriptBackfillNotificationSettings(orgId);
      res.json({
        slackWebhookUrl: settings?.slackWebhookUrl ?? "",
        emailRecipients: settings?.emailRecipients ?? [],
        updatedAt: settings?.updatedAt ?? null,
        // Task #1045 — surface the persisted last-test outcome so the
        // settings card can show the destination's last-known health on load.
        lastTestAt: settings?.lastTestAt ? settings.lastTestAt.toISOString() : null,
        lastTestResult: settings?.lastTestResult ?? null,
        // Task #1094 — admin-tunable test-alert breach threshold; a null
        // saved value renders the service-level default in the UI.
        testAlertThresholdPerDay:
          settings?.testAlertThresholdPerDay ?? null,
        testAlertThresholdDefault: DEFAULT_TEST_ALERT_THRESHOLD_PER_DAY,
      });
    } catch (e) {
      next(e);
    }
  },
);

const backfillNotificationSettingsSchema = z.object({
  // Empty string clears the value. We validate non-empty values are valid
  // Slack incoming webhook URLs so admins get a clear error before the next
  // run silently fails to dispatch.
  slackWebhookUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === "" || isValidSlackWebhookUrl(v), {
      message: "Slack webhook URL must start with https://hooks.slack.com/",
    }),
  // Each entry must be a valid email; empty array clears all recipients.
  emailRecipients: z
    .array(z.string().trim().email("Each recipient must be a valid email address"))
    .max(50, "Up to 50 email recipients are allowed"),
  // Task #1094 — admin-tunable per-org threshold for the test-alert breach
  // notifier. Optional: omitting the field leaves the saved value alone;
  // explicit `null` clears it back to the service-level default. A
  // non-positive number disables the check entirely so admins can opt out
  // without us needing a separate enable flag.
  testAlertThresholdPerDay: z
    .number()
    .int("Threshold must be a whole number")
    .min(0, "Threshold cannot be negative")
    .max(10_000, "Threshold cannot exceed 10000")
    .nullable()
    .optional(),
});

router.put(
  "/api/crm/calls/transcripts/backfill/notification-settings",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const parsed = backfillNotificationSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.errors[0];
        return res.status(400).json({
          error: first?.message ?? "Invalid notification settings",
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      // De-dup recipients case-insensitively while preserving original case.
      const seen = new Set<string>();
      const recipients: string[] = [];
      for (const r of parsed.data.emailRecipients) {
        const key = r.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        recipients.push(r);
      }
      const saved = await upsertCrmTranscriptBackfillNotificationSettings(orgId, {
        slackWebhookUrl: parsed.data.slackWebhookUrl ? parsed.data.slackWebhookUrl : null,
        emailRecipients: recipients,
        updatedById: req.user?.id ?? null,
        // Task #1094 — pass the threshold through only when the client
        // included it in the payload. `undefined` preserves the saved
        // value; explicit `null` clears it back to the default.
        testAlertThresholdPerDay: parsed.data.testAlertThresholdPerDay,
      });
      res.json({
        slackWebhookUrl: saved.slackWebhookUrl ?? "",
        emailRecipients: saved.emailRecipients ?? [],
        updatedAt: saved.updatedAt,
        lastTestAt: saved.lastTestAt ? saved.lastTestAt.toISOString() : null,
        lastTestResult: saved.lastTestResult ?? null,
        testAlertThresholdPerDay: saved.testAlertThresholdPerDay ?? null,
        testAlertThresholdDefault: DEFAULT_TEST_ALERT_THRESHOLD_PER_DAY,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1045 — admin "dismiss the last test result" affordance. Lets an
// admin clear the inline health summary on the settings card after they've
// acknowledged it (e.g. fixed a misconfigured webhook) without having to
// fire another test just to overwrite it.
router.delete(
  "/api/crm/calls/transcripts/backfill/notification-settings/last-test",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      await clearCrmTranscriptBackfillTestResult(orgId);
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1015 — given a job id, tell the admin UI which page of the history
// listing contains that job so a click on an off-page lineage chip can jump
// directly to it. Mirrors the org scoping and filter parsing of the history
// endpoint so the offset matches the user's current view; if the target row
// doesn't satisfy the supplied filters, the helper falls back to the
// unfiltered listing and reports `filteredOut: true` so the UI can clear
// those filters before navigating.
router.get(
  "/api/crm/calls/transcripts/backfill/history/locate",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const jobId = typeof req.query.jobId === "string" ? req.query.jobId.trim() : "";
      if (!jobId) {
        return res.status(400).json({ error: "jobId query parameter is required" });
      }

      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg = typeof req.query.organizationId === "string"
          ? req.query.organizationId.trim()
          : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const ALLOWED_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"]; // Task #1057
      const rawStatus = req.query.status;
      const statusList = Array.isArray(rawStatus)
        ? rawStatus.map(String)
        : typeof rawStatus === "string" && rawStatus.length > 0
        ? rawStatus.split(",")
        : [];
      const statuses = statusList
        .map((s) => s.trim().toUpperCase())
        .filter((s) => ALLOWED_STATUSES.includes(s));

      const operatorRaw = typeof req.query.operator === "string" ? req.query.operator.trim() : "";
      const operator = operatorRaw.length > 0 ? operatorRaw.slice(0, 200) : undefined;

      const startedByIdRaw =
        typeof req.query.startedById === "string" ? req.query.startedById.trim() : "";
      const startedById =
        startedByIdRaw.length > 0 ? startedByIdRaw.slice(0, 200) : undefined;

      // Task #1090 — also honor the canceller quick-pick so jumping to an
      // off-page lineage chip respects the same filters the history list does.
      const cancelledByIdRaw =
        typeof req.query.cancelledById === "string" ? req.query.cancelledById.trim() : "";
      const cancelledById =
        cancelledByIdRaw.length > 0 ? cancelledByIdRaw.slice(0, 200) : undefined;

      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || v.length === 0) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const startedAfter = parseDate(req.query.startedAfter);
      const startedBefore = parseDate(req.query.startedBefore);

      // First attempt: scope to the user's currently-selected org (or all orgs
      // for super admins with no org filter). If the target lives in a
      // different org and the caller is a super admin, retry without the org
      // scope so cross-org lineage chips still resolve.
      let result = await locateCrmTranscriptBackfillJobPage(jobId, {
        organizationId: scopedOrgId,
        statuses: statuses.length > 0 ? statuses : undefined,
        operator,
        startedById,
        cancelledById,
        startedAfter,
        startedBefore,
      });

      let orgScopeChanged = false;
      if (!result.found && superAdmin && scopedOrgId) {
        const fallback = await locateCrmTranscriptBackfillJobPage(jobId, {
          statuses: statuses.length > 0 ? statuses : undefined,
          operator,
          startedById,
          cancelledById,
          startedAfter,
          startedBefore,
        });
        if (fallback.found) {
          result = fallback;
          orgScopeChanged = true;
        }
      }

      if (!result.found) {
        return res.status(404).json({ error: "Job not found" });
      }

      res.json({
        found: true,
        offset: result.offset,
        organizationId: result.organizationId,
        filteredOut: result.filteredOut,
        // True when the user's currently-selected org doesn't match the
        // target's org. The UI uses this (alongside `organizationId`) to
        // either switch the org picker to the target's org or to the
        // cross-org view before navigating.
        orgScopeChanged,
        pageSize: 20,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1031 — recent per-channel alert dispatch history so admins can
// confirm in-app whether the most recent backfill alerts actually reached
// the configured Slack/email destinations. Capped at 50 rows per request;
// the UI defaults to 10.
router.get(
  "/api/crm/calls/transcripts/backfill/alert-deliveries",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
        50,
      );
      const [rows, fallbackMuteSummary] = await Promise.all([
        listCrmTranscriptBackfillAlertDeliveries(orgId, limit),
        // Task #1079 — surface per-channel mute counts so the UI can render
        // a "fallback suppressed (channel muted by N admins)" badge on rows
        // whose realtime fan-out went to nobody because the org silenced
        // that channel.
        summarizeOrgAdminAlertFailureFallbackMutes(orgId),
      ]);
      res.json({
        deliveries: rows.map((row) => ({
          id: row.id,
          jobId: row.jobId,
          channel: row.channel,
          status: row.status,
          recipientSummary: row.recipientSummary,
          errorMessage: row.errorMessage,
          attemptedAt: row.attemptedAt.toISOString(),
          // Task #1069 — provenance of this row (`automatic` vs `resend`)
          // and, for resend rows, a display label for the admin who
          // clicked Resend so the UI can render "Resent by Jane".
          source: row.source,
          triggeredBy: row.triggeredBy
            ? {
                id: row.triggeredBy.id,
                displayName:
                  [row.triggeredBy.firstName, row.triggeredBy.lastName]
                    .filter((part): part is string =>
                      Boolean(part && part.trim()),
                    )
                    .join(" ")
                    .trim() || row.triggeredBy.email,
              }
            : null,
        })),
        fallbackMuteSummary,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1050 — admin "Resend" action on a previously-failed alert delivery.
// Re-runs the same dispatch (same job id, same channel) using the org's
// currently-saved Slack/email destinations and writes a brand-new delivery
// row reflecting the new outcome. Successful deliveries are rejected so the
// UI's "only show on failures" filter cannot be bypassed by a hand-crafted
// request.
router.post(
  "/api/crm/calls/transcripts/backfill/alert-deliveries/:id/resend",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const deliveryId = String(req.params.id || "").trim();
      if (!deliveryId) {
        return res.status(400).json({ error: "Missing delivery id" });
      }
      const result = await resendBackfillAlertDelivery(
        orgId,
        deliveryId,
        // Task #1069 — tag the new delivery row with the admin who clicked
        // Resend so the in-app history can render "Resent by Jane".
        req.user?.id ?? null,
      );
      if (!result.ok) {
        if (result.reason === "COOLDOWN") {
          // Task #1068 — short per-(delivery, channel) cooldown. Set the
          // standard Retry-After header (in seconds) and echo the value in
          // the body so the UI can render a friendly countdown without
          // having to parse headers from `apiRequest`.
          res.setHeader("Retry-After", String(result.retryAfterSeconds));
          return res.status(429).json({
            error: `Just resent — try again in ${result.retryAfterSeconds} seconds.`,
            reason: result.reason,
            retryAfterSeconds: result.retryAfterSeconds,
          });
        }
        const statusCode =
          result.reason === "NOT_FOUND" || result.reason === "JOB_MISSING"
            ? 404
            : 409;
        const message =
          result.reason === "NOT_FOUND"
            ? "Alert delivery not found."
            : result.reason === "NOT_FAILED"
              ? "Only failed deliveries can be resent."
              : result.reason === "JOB_MISSING"
                ? "The original backfill job is no longer available, so this alert can't be resent."
                : "No destination is currently configured for this channel. Update notification settings and try again.";
        return res.status(statusCode).json({ error: message, reason: result.reason });
      }
      const d = result.delivery;
      // Task #1069 — surface the same provenance fields as the list
      // endpoint so the optimistic refresh in the UI sees the new row's
      // "Resent by Jane" label without waiting for the next list poll.
      const actor = req.user;
      const actorDisplayName = actor
        ? [actor.firstName, actor.lastName]
            .filter((part): part is string => Boolean(part && part.trim()))
            .join(" ")
            .trim() || actor.email || ""
        : "";
      res.json({
        delivery: {
          id: d.id,
          jobId: d.jobId,
          channel: d.channel,
          status: d.status,
          recipientSummary: d.recipientSummary,
          errorMessage: d.errorMessage,
          attemptedAt:
            d.attemptedAt instanceof Date
              ? d.attemptedAt.toISOString()
              : new Date(d.attemptedAt as unknown as string).toISOString(),
          source: d.source ?? "resend",
          triggeredBy:
            d.triggeredById && actor
              ? { id: actor.id, displayName: actorDisplayName }
              : null,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1001 — list distinct operators that appear in this org's backfill
// history. Powers the quick-pick dropdown in the admin UI so admins don't have
// to remember exact spelling when filtering.
router.get(
  "/api/crm/calls/transcripts/backfill/operators",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const operators = await listCrmTranscriptBackfillOperators(orgId);
      res.json({ operators });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1090 — list distinct users who have cancelled at least one backfill
// in this org. Powers the "Cancelled by" quick-pick dropdown in the admin
// history UI so admins can filter without having to remember exact spelling.
// Mirrors the operators endpoint above.
router.get(
  "/api/crm/calls/transcripts/backfill/cancellers",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const cancellers = await listCrmTranscriptBackfillCancellers(orgId);
      res.json({ cancellers });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1000 — same filters as the JSON history endpoint, but stream the full
// matching set (not just the visible page) as CSV so admins can export it for
// auditing or sharing with stakeholders.
router.get(
  "/api/crm/calls/transcripts/backfill/history.csv",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      // Task #1007 — mirror the JSON history endpoint: SUPER_ADMINs may export
      // across all orgs (or a single org via ?organizationId=), org-scoped
      // admins are still locked to their own org.
      const superAdmin = isSuperAdmin(req.user);
      let scopedOrgId: string | undefined;
      if (superAdmin) {
        const requestedOrg = typeof req.query.organizationId === "string"
          ? req.query.organizationId.trim()
          : "";
        scopedOrgId = requestedOrg.length > 0 ? requestedOrg : undefined;
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        scopedOrgId = orgId;
      }

      const ALLOWED_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"]; // Task #1057
      const rawStatus = req.query.status;
      const statusList = Array.isArray(rawStatus)
        ? rawStatus.map(String)
        : typeof rawStatus === "string" && rawStatus.length > 0
        ? rawStatus.split(",")
        : [];
      const statuses = statusList
        .map((s) => s.trim().toUpperCase())
        .filter((s) => ALLOWED_STATUSES.includes(s));

      const operatorRaw = typeof req.query.operator === "string" ? req.query.operator.trim() : "";
      const operator = operatorRaw.length > 0 ? operatorRaw.slice(0, 200) : undefined;

      // Task #1001 — also accept the exact-match operator id so the CSV
      // export honors the same quick-pick filter the UI uses.
      const startedByIdRaw =
        typeof req.query.startedById === "string" ? req.query.startedById.trim() : "";
      const startedById =
        startedByIdRaw.length > 0 ? startedByIdRaw.slice(0, 200) : undefined;

      // Task #1090 — same treatment for the canceller quick-pick so an
      // exported CSV mirrors the filtered history view exactly.
      const cancelledByIdRaw =
        typeof req.query.cancelledById === "string" ? req.query.cancelledById.trim() : "";
      const cancelledById =
        cancelledByIdRaw.length > 0 ? cancelledByIdRaw.slice(0, 200) : undefined;

      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || v.length === 0) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const startedAfter = parseDate(req.query.startedAfter);
      const startedBefore = parseDate(req.query.startedBefore);

      const escapeCsv = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const HEADERS = [
        "id",
        "organization_id",
        "organization_name",
        "status",
        "total",
        "processed",
        "succeeded",
        "failed",
        "operator_name",
        "operator_email",
        "started_at",
        "completed_at",
        "duration_seconds",
      ];

      // Page through the same listing the UI uses so the CSV honors the active
      // filters but isn't capped at 100 rows. Hard cap iterations to a generous
      // ceiling so an unbounded org can't pin the request forever.
      const PAGE = 100;
      const MAX_ROWS = 100_000;
      const lines: string[] = [HEADERS.join(",")];
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { rows } = await listCrmTranscriptBackfillJobs({
          organizationId: scopedOrgId,
          limit: PAGE,
          offset,
          statuses: statuses.length > 0 ? statuses : undefined,
          operator,
          startedById,
          cancelledById,
          startedAfter,
          startedBefore,
        });
        if (rows.length === 0) break;
        for (const row of rows) {
          const fullName = [row.startedByFirstName, row.startedByLastName]
            .filter(Boolean)
            .join(" ")
            .trim();
          const operatorName = fullName || row.startedByEmail || "";
          const startedAtIso = row.startedAt ? new Date(row.startedAt).toISOString() : "";
          const completedAtIso = row.completedAt ? new Date(row.completedAt).toISOString() : "";
          const durationSeconds =
            row.startedAt && row.completedAt
              ? Math.max(
                  0,
                  Math.round(
                    (new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()) / 1000,
                  ),
                )
              : "";
          lines.push(
            [
              row.id,
              row.organizationId ?? "",
              row.organizationName ?? "",
              row.status,
              row.total,
              row.processed,
              row.succeeded,
              row.failed,
              operatorName,
              row.startedByEmail ?? "",
              startedAtIso,
              completedAtIso,
              durationSeconds,
            ]
              .map(escapeCsv)
              .join(","),
          );
        }
        offset += rows.length;
        if (rows.length < PAGE) break;
        if (offset >= MAX_ROWS) break;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="transcript-backfill-history-${stamp}.csv"`,
      );
      res.send(lines.join("\n") + "\n");
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/crm/calls/transcripts/backfill/:jobId",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const row = await getCrmTranscriptBackfillJob(req.params.jobId, orgId);
      if (!row) {
        return res.status(404).json({ error: "Backfill job not found" });
      }
      // If the row is still RUNNING but the worker hasn't checked in for a
      // while, the process that owned it almost certainly restarted. Surface
      // that as FAILED so admins see a definitive end-state instead of a
      // perpetually-stuck progress bar.
      if (
        row.status === "RUNNING" &&
        Date.now() - new Date(row.heartbeatAt).getTime() > getBackfillHeartbeatStaleMs()
      ) {
        const reaped = await updateCrmTranscriptBackfillJob(row.id, {
          status: "FAILED",
          completedAt: new Date(),
        });
        scheduleBackfillCompletionEmail(row.id);
        // Task #1070 — even on the reap path the row may already carry a
        // canceller (rare race: cancel landed just before the heartbeat
        // staleness check), so enrich consistently with the happy path.
        return res.json(
          await enrichWithCanceller(
            rowToState(reaped ?? { ...row, status: "FAILED", completedAt: new Date() }),
          ),
        );
      }
      res.json(await enrichWithCanceller(rowToState(row)));
    } catch (e) {
      next(e);
    }
  },
);

// Task #996 — targeted retry. Re-runs transcription only for the recordingIds
// captured in a previous job's `errors` jsonb, so admins don't need to launch a
// fresh full backfill (and re-spend Whisper credits) just to retry a handful of
// failures. Progress is tracked as a brand new backfill job whose `parentJobId`
// links back to the original run.
router.post(
  "/api/crm/calls/transcripts/backfill/:jobId/retry",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const schema = z.object({
        concurrency: z.number().int().min(1).max(4).optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const concurrency = parsed.data.concurrency ?? 2;

      const parent = await getCrmTranscriptBackfillJob(req.params.jobId, orgId);
      if (!parent) {
        return res.status(404).json({ error: "Backfill job not found" });
      }
      if (parent.status === "RUNNING") {
        return res.status(409).json({
          error: "Cannot retry a job that is still running",
          jobId: parent.id,
        });
      }

      // Task #1003 — pull failed recordingIds from the unbounded
      // `failed_recording_ids` jsonb (the new source of truth) AND from the
      // legacy bounded `errors` sample, then union + dedupe. Unioning rather
      // than picking one source covers two edge cases:
      //   1. Legacy jobs predating the column — only `errors` is populated.
      //   2. Mixed-version / partially-populated rows (e.g. an in-flight job
      //      flushed `errors` before the new column existed) — neither
      //      source alone is complete, but their union is.
      // Dedupe — either source may contain the same id more than once if a
      // row failed across paginated batches.
      const failedIdsFromColumn = (parent.failedRecordingIds as string[] | null) ?? [];
      const failedIdsFromErrors =
        (parent.errors as Array<{ recordingId: string; error: string }> | null ?? [])
          .map((e) => e.recordingId);
      const failedIds = Array.from(
        new Set(
          [...failedIdsFromColumn, ...failedIdsFromErrors]
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      if (failedIds.length === 0) {
        return res.status(400).json({
          error: "No failed recordings recorded for this backfill run",
        });
      }

      // Only retry recordings that still belong to this org and still need a
      // transcript (status PENDING/FAILED with no stored transcript). Anything
      // already transcribed or moved to a different state is silently skipped.
      const eligibleRows = await db
        .select({ id: crmCallRecordings.id })
        .from(crmCallRecordings)
        .innerJoin(crmCalls, eq(crmCalls.id, crmCallRecordings.callId))
        .where(
          and(
            eq(crmCalls.organizationId, orgId),
            inArray(crmCallRecordings.id, failedIds),
            sql`${crmCallRecordings.transcript} IS NULL`,
            inArray(crmCallRecordings.transcriptStatus, ["PENDING", "FAILED"]),
          ),
        );
      const eligibleIds = eligibleRows.map((r) => r.id);
      if (eligibleIds.length === 0) {
        return res.status(200).json({
          jobId: null,
          total: 0,
          message: "All previously failed recordings already have transcripts or are no longer eligible.",
        });
      }

      // Guard against two concurrent backfills for the same org. A stale
      // RUNNING row (process restart) is reaped before we proceed.
      const existingRunning = await getRunningCrmTranscriptBackfillJob(orgId);
      if (existingRunning) {
        const heartbeatAgeMs =
          Date.now() - new Date(existingRunning.heartbeatAt).getTime();
        if (heartbeatAgeMs <= getBackfillHeartbeatStaleMs()) {
          return res.status(409).json({
            error: "A transcript backfill is already running for this organization",
            jobId: existingRunning.id,
          });
        }
        await updateCrmTranscriptBackfillJob(existingRunning.id, {
          status: "FAILED",
          completedAt: new Date(),
        });
        logWarn("crmCalls: reaped stale transcript backfill job before starting a retry", {
          jobId: existingRunning.id,
          orgId,
          heartbeatAgeMs,
        });
        scheduleBackfillCompletionEmail(existingRunning.id);
      }

      const jobId = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const persistedRow = await createCrmTranscriptBackfillJob({
        id: jobId,
        organizationId: orgId,
        status: "RUNNING",
        total: eligibleIds.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        failedRecordingIds: [],
        completedAt: null,
        startedById: req.user!.id,
        parentJobId: parent.id,
        // Task #1011 — persist the speed/cap so the history UI shows the
        // actual settings for retry runs instead of falling back to
        // "default" / "no cap". The worker below is invoked with
        // `eligibleIds.length` as the cap, so record that as maxRecords.
        concurrency,
        maxRecords: eligibleIds.length,
      });
      const job = rowToState(persistedRow);

      logInfo("crmCalls: transcript backfill retry started", {
        jobId,
        parentJobId: parent.id,
        orgId,
        total: job.total,
        concurrency,
        startedById: job.startedById,
      });

      // Cap maxRecords at the eligible set size so the worker stops after
      // re-attempting just these recordings instead of paginating into every
      // other PENDING/FAILED row in the org.
      void runTranscriptBackfill(job, eligibleIds, concurrency, eligibleIds.length);

      res.status(202).json({ jobId, total: job.total, parentJobId: parent.id });
    } catch (e) {
      next(e);
    }
  },
);

// Task #1036 — cancel a running transcript backfill. Lets super admins stop
// a runaway job in any tenant from the platform admin page (the only place
// the cross-org running list is surfaced) without having to log into that
// tenant. Org-scoped admins can also cancel their own org's RUNNING job.
//
// Implementation notes:
//   - The worker lives in this same Node process, so we signal cancellation
//     by adding the job id to a module-level Set that the worker checks on
//     every iteration / between batches. The worker then transitions the
//     persisted row to FAILED through its existing finalisation path (which
//     also fires the completion notifications).
//   - When the worker is gone (process restart, heartbeat stale) we mark
//     the row FAILED directly so the cross-org banner clears immediately.
router.post(
  "/api/crm/calls/transcripts/backfill/:jobId/cancel",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const superAdmin = isSuperAdmin(req.user);
      let row: CrmTranscriptBackfillJob | null;
      if (superAdmin) {
        row = await getCrmTranscriptBackfillJobByIdAcrossOrgs(req.params.jobId);
      } else {
        const orgId = resolveOrg(req, res);
        if (!orgId) return;
        row = await getCrmTranscriptBackfillJob(req.params.jobId, orgId);
      }
      if (!row) {
        return res.status(404).json({ error: "Backfill job not found" });
      }
      if (row.status !== "RUNNING") {
        return res.status(409).json({
          error: `Backfill is already ${row.status.toLowerCase()}; nothing to cancel.`,
          jobId: row.id,
          status: row.status,
        });
      }

      // Task #1070 — accept an optional free-text reason from the confirm
      // dialog. Trimmed and length-capped so a malicious or accidentally
      // huge payload can't bloat the row. Empty string means "no reason
      // given" and is persisted as NULL.
      const rawReason = (req.body && typeof req.body.reason === "string")
        ? req.body.reason
        : "";
      const trimmedReason = rawReason.trim().slice(0, 500);
      const reason = trimmedReason.length > 0 ? trimmedReason : null;
      const cancelledById = req.user!.id;

      const heartbeatAgeMs = Date.now() - new Date(row.heartbeatAt).getTime();
      if (heartbeatAgeMs > getBackfillHeartbeatStaleMs()) {
        // Worker is dead (process restart since last heartbeat). Mark the
        // row terminal directly so the banner clears on the next refresh.
        // Task #1057 — surface CANCELLED here too: the admin asked to
        // cancel, so the row should reflect that even when there's no
        // live worker to flip it cooperatively.
        // Task #1070 — also persist the canceller + reason on this path so
        // the history row / completion email match the live-worker path.
        const reaped = await updateCrmTranscriptBackfillJob(row.id, {
          status: "CANCELLED",
          completedAt: new Date(),
          cancelledById,
          cancellationReason: reason,
        });
        scheduleBackfillCompletionEmail(row.id);
        logInfo("crmCalls: cancelled stale transcript backfill (worker dead)", {
          jobId: row.id,
          orgId: row.organizationId,
          heartbeatAgeMs,
          cancelledBy: cancelledById,
          hasReason: !!reason,
          superAdmin,
        });
        return res.json({
          jobId: row.id,
          status: reaped?.status ?? "CANCELLED",
          reaped: true,
        });
      }

      // Worker is alive — signal cooperative cancellation. The worker will
      // flip the row to CANCELLED and fire the completion notification on
      // its next iteration / batch boundary, picking the canceller +
      // reason out of the in-memory request map below.
      cancelRequestedJobs.set(row.id, { cancelledById, reason });
      logInfo("crmCalls: transcript backfill cancellation requested", {
        jobId: row.id,
        orgId: row.organizationId,
        cancelledBy: cancelledById,
        hasReason: !!reason,
        superAdmin,
      });
      res.status(202).json({
        jobId: row.id,
        status: "CANCELLING",
        reaped: false,
        message: "Cancellation requested; the job will stop after the current recording finishes.",
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Transcript search — full-text-ish ILIKE match across an opportunity/contact/
// crmOrganisation's call transcripts. Returns the matching call rows so the
// client can deep-link into the activity timeline.
// ---------------------------------------------------------------------------
router.get(
  "/api/crm/calls/transcripts/search",
  requireAuth,
  requireRole(...PIPELINE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const q = String(req.query.q || "").trim();
      if (q.length < 2) {
        return res.status(400).json({ error: "Query must be at least 2 characters" });
      }
      const opportunityId = req.query.opportunityId as string | undefined;
      const contactId = req.query.contactId as string | undefined;
      const crmOrganisationId = req.query.crmOrganisationId as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);

      const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const like = `%${escaped}%`;

      const conds: SQL[] = [
        eq(crmCalls.organizationId, orgId),
        sql`${crmCallRecordings.transcript} IS NOT NULL`,
        sql`${crmCallRecordings.transcript} ILIKE ${like}`,
      ];
      if (opportunityId) conds.push(eq(crmCalls.opportunityId, opportunityId));
      if (contactId) conds.push(eq(crmCalls.contactId, contactId));
      if (crmOrganisationId) conds.push(eq(crmCalls.crmOrganisationId, crmOrganisationId));

      const rows = await db
        .select({
          callId: crmCalls.id,
          opportunityId: crmCalls.opportunityId,
          contactId: crmCalls.contactId,
          crmOrganisationId: crmCalls.crmOrganisationId,
          startedAt: crmCalls.startedAt,
          direction: crmCalls.direction,
          outcome: crmCalls.outcome,
          recordingId: crmCallRecordings.id,
          transcript: crmCallRecordings.transcript,
        })
        .from(crmCalls)
        .innerJoin(crmCallRecordings, eq(crmCallRecordings.callId, crmCalls.id))
        .where(and(...conds))
        .orderBy(desc(crmCalls.startedAt))
        .limit(limit);

      // Build a short snippet around the first match for each row.
      const results = rows.map((r) => {
        const text = r.transcript || "";
        const idx = text.toLowerCase().indexOf(q.toLowerCase());
        const start = Math.max(0, idx - 60);
        const end = idx >= 0 ? Math.min(text.length, idx + q.length + 60) : Math.min(text.length, 160);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
        return {
          callId: r.callId,
          recordingId: r.recordingId,
          opportunityId: r.opportunityId,
          contactId: r.contactId,
          crmOrganisationId: r.crmOrganisationId,
          startedAt: r.startedAt.toISOString(),
          direction: r.direction,
          outcome: r.outcome,
          snippet,
        };
      });

      res.json({ query: q, results });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Unified activity timeline
// ---------------------------------------------------------------------------
type ActivityRow = {
  id: string;
  type: "CALL" | "EMAIL" | "MEETING" | "NOTE" | "TASK" | "STATUS" | "QUOTE" | "FOLLOW_UP" | "SITE_VISIT";
  occurredAt: string;
  title: string;
  description: string | null;
  actorName: string | null;
  meta: Record<string, unknown>;
};

router.get(
  "/api/crm/activity",
  requireAuth,
  requireRole(...PIPELINE_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const opportunityId = req.query.opportunityId as string | undefined;
      const contactId = req.query.contactId as string | undefined;
      const crmOrganisationId = req.query.crmOrganisationId as string | undefined;
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : null;
      const limit = Math.min(parseInt((req.query.limit as string) || "200", 10), 500);

      if (!opportunityId && !contactId && !crmOrganisationId) {
        return res.status(400).json({ error: "Provide opportunityId, contactId, or crmOrganisationId" });
      }

      const out: ActivityRow[] = [];

      // ---- Calls ----
      {
        const conds: SQL[] = [eq(crmCalls.organizationId, orgId)];
        if (opportunityId) conds.push(eq(crmCalls.opportunityId, opportunityId));
        if (contactId) conds.push(eq(crmCalls.contactId, contactId));
        if (crmOrganisationId) conds.push(eq(crmCalls.crmOrganisationId, crmOrganisationId));
        if (since) conds.push(gte(crmCalls.startedAt, since));
        const rows = await db
          .select({
            id: crmCalls.id,
            direction: crmCalls.direction,
            outcome: crmCalls.outcome,
            durationSeconds: crmCalls.durationSeconds,
            notes: crmCalls.notes,
            startedAt: crmCalls.startedAt,
            fromNumber: crmCalls.fromNumber,
            toNumber: crmCalls.toNumber,
            createdByFirstName: users.firstName,
            createdByLastName: users.lastName,
            opportunityId: crmCalls.opportunityId,
            contactId: crmCalls.contactId,
          })
          .from(crmCalls)
          .leftJoin(users, eq(users.id, crmCalls.createdById))
          .where(and(...conds))
          .orderBy(desc(crmCalls.startedAt))
          .limit(limit);

        // Fetch recordings for the calls in one query.
        const callIds = rows.map((r) => r.id);
        const recordingsByCall = new Map<string, {
          id: string;
          durationSeconds: number;
          transcript: string | null;
          transcriptStatus: string;
          transcribedAt: string | null;
          summary: unknown;
          summaryGeneratedAt: string | null;
        }>();
        if (callIds.length) {
          const recRows = await db
            .select({
              id: crmCallRecordings.id,
              callId: crmCallRecordings.callId,
              durationSeconds: crmCallRecordings.durationSeconds,
              createdAt: crmCallRecordings.createdAt,
              transcript: crmCallRecordings.transcript,
              transcriptStatus: crmCallRecordings.transcriptStatus,
              transcribedAt: crmCallRecordings.transcribedAt,
              summary: crmCallRecordings.summary,
              summaryGeneratedAt: crmCallRecordings.summaryGeneratedAt,
            })
            .from(crmCallRecordings)
            .where(inArray(crmCallRecordings.callId, callIds))
            .orderBy(desc(crmCallRecordings.createdAt));
          for (const rec of recRows) {
            // Keep the most recent recording per call (first seen due to desc order).
            if (!recordingsByCall.has(rec.callId)) {
              recordingsByCall.set(rec.callId, {
                id: rec.id,
                durationSeconds: rec.durationSeconds,
                transcript: rec.transcript ?? null,
                transcriptStatus: rec.transcriptStatus ?? "PENDING",
                transcribedAt: rec.transcribedAt ? rec.transcribedAt.toISOString() : null,
                summary: rec.summary ?? null,
                summaryGeneratedAt: rec.summaryGeneratedAt ? rec.summaryGeneratedAt.toISOString() : null,
              });
            }
          }
        }

        for (const r of rows) {
          const rec = recordingsByCall.get(r.id) || null;
          out.push({
            id: `call:${r.id}`,
            type: "CALL",
            occurredAt: r.startedAt.toISOString(),
            title: `${r.direction === "OUTBOUND" ? "Outbound" : "Inbound"} call${r.outcome ? ` — ${r.outcome.replace(/_/g, " ").toLowerCase()}` : ""}`,
            description: r.notes,
            actorName: [r.createdByFirstName, r.createdByLastName].filter(Boolean).join(" ") || null,
            meta: {
              callId: r.id,
              direction: r.direction,
              outcome: r.outcome,
              durationSeconds: r.durationSeconds,
              fromNumber: r.fromNumber,
              toNumber: r.toNumber,
              opportunityId: r.opportunityId,
              contactId: r.contactId,
              recording: rec
                ? {
                    id: rec.id,
                    durationSeconds: rec.durationSeconds,
                    streamUrl: `/api/crm/calls/${r.id}/recording`,
                    downloadUrl: `/api/crm/calls/${r.id}/recording?download=1`,
                    transcript: rec.transcript,
                    transcriptStatus: rec.transcriptStatus,
                    transcribedAt: rec.transcribedAt,
                    summary: rec.summary,
                    summaryGeneratedAt: rec.summaryGeneratedAt,
                  }
                : null,
            },
          });
        }
      }

      // ---- Emails (CRM logged) ----
      {
        const conds: SQL[] = [eq(crmEmailMessages.organizationId, orgId)];
        if (opportunityId) conds.push(eq(crmEmailMessages.opportunityId, opportunityId));
        if (contactId) conds.push(eq(crmEmailMessages.contactId, contactId));
        if (since) conds.push(gte(crmEmailMessages.sentAt, since));
        const rows = await db
          .select({
            id: crmEmailMessages.id,
            subject: crmEmailMessages.subject,
            snippet: crmEmailMessages.snippet,
            direction: crmEmailMessages.direction,
            fromAddress: crmEmailMessages.fromAddress,
            toAddresses: crmEmailMessages.toAddresses,
            sentAt: crmEmailMessages.sentAt,
            externalMessageId: crmEmailMessages.externalMessageId,
            providerDeepLink: crmEmailMessages.providerDeepLink,
            threadId: crmEmailMessages.threadId,
          })
          .from(crmEmailMessages)
          .where(and(...conds))
          .orderBy(desc(crmEmailMessages.sentAt))
          .limit(limit);
        for (const r of rows) {
          out.push({
            id: `email:${r.id}`,
            type: "EMAIL",
            occurredAt: r.sentAt.toISOString(),
            title: r.subject || "(no subject)",
            description: r.snippet,
            actorName: r.direction === "OUTBOUND" ? null : r.fromAddress,
            meta: {
              messageId: r.id,
              externalMessageId: r.externalMessageId,
              direction: r.direction,
              fromAddress: r.fromAddress,
              toAddresses: r.toAddresses,
              providerDeepLink: r.providerDeepLink,
              threadId: r.threadId,
              subject: r.subject,
            },
          });
        }
      }

      // ---- Activities (notes / meetings / follow-ups / site visits) ----
      // Mirrored CALL rows are also written here; we tag them so the client can
      // dedupe against direct call rows.
      if (opportunityId) {
        const conds: SQL[] = [eq(crmOpportunityActivities.opportunityId, opportunityId)];
        if (since) conds.push(gte(crmOpportunityActivities.createdAt, since));
        const rows = await db
          .select({
            id: crmOpportunityActivities.id,
            activityType: crmOpportunityActivities.activityType,
            description: crmOpportunityActivities.description,
            scheduledAt: crmOpportunityActivities.scheduledAt,
            completedAt: crmOpportunityActivities.completedAt,
            createdAt: crmOpportunityActivities.createdAt,
            createdByFirstName: users.firstName,
            createdByLastName: users.lastName,
          })
          .from(crmOpportunityActivities)
          .leftJoin(users, eq(users.id, crmOpportunityActivities.createdById))
          .where(and(...conds))
          .orderBy(desc(crmOpportunityActivities.createdAt))
          .limit(limit);
        for (const r of rows) {
          // Skip CALL mirrors — direct call rows already cover those.
          if (r.activityType === "CALL") continue;
          // Skip EMAIL mirrors — direct email rows already cover those.
          if (r.activityType === "EMAIL") continue;
          out.push({
            id: `activity:${r.id}`,
            type: r.activityType as ActivityRow["type"],
            occurredAt: (r.scheduledAt || r.completedAt || r.createdAt).toISOString(),
            title: r.activityType.charAt(0) + r.activityType.slice(1).toLowerCase().replace(/_/g, " "),
            description: r.description,
            actorName: [r.createdByFirstName, r.createdByLastName].filter(Boolean).join(" ") || null,
            meta: { activityId: r.id, activityType: r.activityType },
          });
        }
      }

      // ---- Quotes ----
      if (opportunityId) {
        const conds: SQL[] = [
          eq(crmQuotes.organizationId, orgId),
          eq(crmQuotes.opportunityId, opportunityId),
        ];
        if (since) conds.push(gte(crmQuotes.createdAt, since));
        const rows = await db
          .select({
            id: crmQuotes.id,
            quoteNumber: crmQuotes.quoteNumber,
            title: crmQuotes.title,
            status: crmQuotes.status,
            totalAmount: crmQuotes.totalAmount,
            sentAt: crmQuotes.sentAt,
            acceptedAt: crmQuotes.acceptedAt,
            createdAt: crmQuotes.createdAt,
          })
          .from(crmQuotes)
          .where(and(...conds))
          .orderBy(desc(crmQuotes.createdAt))
          .limit(limit);
        for (const r of rows) {
          out.push({
            id: `quote:${r.id}`,
            type: "QUOTE",
            occurredAt: (r.sentAt || r.acceptedAt || r.createdAt).toISOString(),
            title: `Quote ${r.quoteNumber} — ${r.title}`,
            description: `Status: ${r.status} • Total: $${r.totalAmount}`,
            actorName: null,
            meta: {
              quoteId: r.id,
              quoteNumber: r.quoteNumber,
              status: r.status,
              totalAmount: r.totalAmount,
            },
          });
        }
      }

      // ---- Stage changes — derived from audit_log on crm_opportunities ----
      if (opportunityId) {
        try {
          const stageRows = (await db.execute(sql`
            SELECT a.id, a.old_value, a.new_value, a.created_at,
                   u.first_name, u.last_name
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE a.entity_type = 'crm_opportunities'
              AND a.entity_id = ${opportunityId}
              AND a.action = 'UPDATE'
              AND a.old_value LIKE '%"stage"%'
              ${since ? sql`AND a.created_at >= ${since}` : sql``}
            ORDER BY a.created_at DESC
            LIMIT ${limit}
          `)) as unknown as { rows: Array<Record<string, unknown>> };
          for (const r of stageRows.rows || []) {
            let fromStage: string | null = null;
            let toStage: string | null = null;
            try {
              const ov = JSON.parse(String(r.old_value || "{}"));
              const nv = JSON.parse(String(r.new_value || "{}"));
              fromStage = (ov.stage as string) || null;
              toStage = (nv.stage as string) || null;
            } catch {
              continue;
            }
            if (!toStage || fromStage === toStage) continue;
            const occurredAt = r.created_at instanceof Date
              ? r.created_at.toISOString()
              : new Date(String(r.created_at)).toISOString();
            out.push({
              id: `stage:${r.id}`,
              type: "STATUS",
              occurredAt,
              title: `Stage changed: ${fromStage || "(start)"} → ${toStage}`,
              description: null,
              actorName: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
              meta: { fromStage, toStage },
            });
          }
        } catch {
          /* ignore */
        }
      }

      out.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
      res.json(out.slice(0, limit));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
