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
import {
  createCrmTranscriptBackfillJob,
  getCrmTranscriptBackfillJob,
  getCrmTranscriptBackfillNotificationSettings,
  getCrmTranscriptBackfillOperatorContact,
  getRunningCrmTranscriptBackfillJob,
  listCrmTranscriptBackfillJobs,
  listCrmTranscriptBackfillOperators,
  getCrmTranscriptBackfillLineages,
  listMostRecentRunningCrmTranscriptBackfillJobsPerOrg,
  listRunningCrmTranscriptBackfillJobsWithOrg,
  updateCrmTranscriptBackfillJob,
  upsertCrmTranscriptBackfillNotificationSettings,
} from "./storage";
import {
  notifyBackfillCompletion,
  sendTestBackfillAlert,
  getBackfillNotificationConfig,
} from "./services/transcriptBackfillNotifications";
import { isValidSlackWebhookUrl } from "./services/slackService";
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
  status: "RUNNING" | "COMPLETED" | "FAILED";
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
};

const MAX_BACKFILL_ERROR_SAMPLES = 50;
// If a job's heartbeat is older than this, the worker is presumed dead (the
// process restarted) and the job is marked FAILED on the next read.
const BACKFILL_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export function __rowToBackfillStateForTests(row: CrmTranscriptBackfillJob): BackfillJobState {
  return rowToState(row);
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
      })
      .from(crmTranscriptBackfillJobs)
      .leftJoin(users, eq(users.id, crmTranscriptBackfillJobs.startedById))
      .where(eq(crmTranscriptBackfillJobs.id, jobId))
      .limit(1);

    if (!jobRow) return;
    if (jobRow.status !== "COMPLETED" && jobRow.status !== "FAILED") return;

    const [orgRow] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, jobRow.organizationId))
      .limit(1);

    // Pick admins for the org. Left join channel prefs so admins without an
    // explicit prefs row still receive these (they're a transactional ack
    // for a run the admin themselves started). Anyone with prefs.email_enabled
    // explicitly set to false is treated as opted out.
    const adminRows = await db
      .select({
        email: users.email,
        emailEnabled: notificationChannelPrefs.emailEnabled,
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

    const recipients = Array.from(
      new Set(
        adminRows
          .filter((r) => r.emailEnabled !== false) // null = no prefs row = include
          .map((r) => r.email)
          .filter((e): e is string => typeof e === "string" && e.length > 0),
      ),
    );

    if (recipients.length === 0) {
      logInfo("crmCalls: backfill summary email skipped (no eligible admin recipients)", {
        jobId,
        orgId: jobRow.organizationId,
      });
      return;
    }

    const completedAt = jobRow.completedAt ?? new Date();
    const duration = formatBackfillDuration(jobRow.startedAt, completedAt);
    const operatorName =
      [jobRow.operatorFirstName, jobRow.operatorLastName]
        .filter((p): p is string => !!p)
        .join(" ")
        .trim() ||
      jobRow.operatorEmail ||
      "an administrator";
    const orgName = orgRow?.name || "your organization";
    const isRetry = !!jobRow.parentJobId;
    const runLabel = isRetry ? "Transcript backfill retry" : "Transcript backfill";
    const statusLabel = jobRow.status === "COMPLETED" ? "completed" : "failed";

    const baseUrl = process.env.APP_BASE_URL || "";
    const historyUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, "")}/admin/transcript-backfill`
      : "/admin/transcript-backfill";

    const subject = `${runLabel} ${statusLabel} — ${jobRow.succeeded}/${jobRow.total} succeeded`;

    const textLines = [
      `${runLabel} ${statusLabel} for ${orgName}.`,
      ``,
      `Status:    ${jobRow.status}`,
      `Processed: ${jobRow.processed} of ${jobRow.total}`,
      `Succeeded: ${jobRow.succeeded}`,
      `Failed:    ${jobRow.failed}`,
      `Duration:  ${duration}`,
      `Started:   ${jobRow.startedAt.toISOString()}`,
      `Finished:  ${completedAt.toISOString()}`,
      `Operator:  ${operatorName}`,
      `Job ID:    ${jobRow.id}`,
      ``,
      `View history: ${historyUrl}`,
    ];
    const text = textLines.join("\n");

    const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <h2 style="margin:0 0 8px;">${escapeBackfillHtml(runLabel)} ${escapeBackfillHtml(statusLabel)}</h2>
  <p style="margin:0 0 16px;color:#444;">Organization: <strong>${escapeBackfillHtml(orgName)}</strong></p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;">
    <tbody>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Status</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(jobRow.status)}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Processed</strong></td><td style="border:1px solid #e5e7eb;">${jobRow.processed} of ${jobRow.total}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Succeeded</strong></td><td style="border:1px solid #e5e7eb;">${jobRow.succeeded}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Failed</strong></td><td style="border:1px solid #e5e7eb;">${jobRow.failed}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Duration</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(duration)}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Started</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(jobRow.startedAt.toISOString())}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Finished</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(completedAt.toISOString())}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Operator</strong></td><td style="border:1px solid #e5e7eb;">${escapeBackfillHtml(operatorName)}</td></tr>
      <tr><td style="border:1px solid #e5e7eb;background:#f9fafb;"><strong>Job ID</strong></td><td style="border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${escapeBackfillHtml(jobRow.id)}</td></tr>
    </tbody>
  </table>
  <p style="margin:16px 0 0;"><a href="${escapeBackfillHtml(historyUrl)}" style="color:#2563eb;">View backfill history</a></p>
</body></html>`;

    await sendEmail({ to: recipients, subject, html, text });

    logInfo("crmCalls: backfill summary email sent", {
      jobId,
      orgId: jobRow.organizationId,
      status: jobRow.status,
      recipientCount: recipients.length,
    });
  } catch (e) {
    logError(
      "crmCalls: failed to send backfill summary email",
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
      const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
      await Promise.all(workers);
      if (maxRecords !== null && job.processed >= maxRecords) break;

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
    job.status = "COMPLETED";
  } catch (e) {
    job.status = "FAILED";
    logError(
      "crmCalls: transcript backfill job failed",
      { jobId: job.id },
      e instanceof Error ? e : new Error(String(e)),
    );
  } finally {
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
        },
        operator,
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
//   - If the heartbeat is still fresh (< BACKFILL_HEARTBEAT_STALE_MS), some
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
      if (heartbeatAgeMs < BACKFILL_HEARTBEAT_STALE_MS) {
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
        if (heartbeatAgeMs > BACKFILL_HEARTBEAT_STALE_MS) {
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
          runningJobs.push({
            ...rowToState(reaped),
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

      let activeJob: BackfillJobState | null = null;
      const runningRow = await getRunningCrmTranscriptBackfillJob(
        scopedOrgId as string,
      );
      if (runningRow) {
        const reaped = await reapIfStale(runningRow);
        activeJob = reaped ? rowToState(reaped) : null;
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
      const orgId = resolveOrg(req, res);
      if (!orgId) return;

      const schema = z.object({
        // By default the backfill processes ALL eligible recordings via
        // pagination. `maxRecords` is an optional safety cap for one-off
        // partial runs (e.g. a small dry run before processing everything).
        maxRecords: z.number().int().min(1).optional(),
        concurrency: z.number().int().min(1).max(4).optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const maxRecords = parsed.data.maxRecords ?? null;
      const concurrency = parsed.data.concurrency ?? 2;

      // Don't allow two concurrent backfills for the same org — they would
      // race over the same PENDING/FAILED rows. A RUNNING row whose heartbeat
      // is stale was orphaned by a process restart; mark it FAILED so a fresh
      // run can start.
      const existingRunning = await getRunningCrmTranscriptBackfillJob(orgId);
      if (existingRunning) {
        const heartbeatAgeMs =
          Date.now() - new Date(existingRunning.heartbeatAt).getTime();
        if (heartbeatAgeMs <= BACKFILL_HEARTBEAT_STALE_MS) {
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

// Task #1032 — admin "notification destinations" panel. Returns whether
// the Slack webhook and email recipient list env vars are configured so the
// admin page can show the current setup state up front (instead of forcing
// admins to click "Send test alert" to find out). The Slack webhook URL
// itself is intentionally NOT returned — only a configured/valid summary.
router.get(
  "/api/crm/calls/transcripts/backfill/notification-config",
  requireAuth,
  requireRole("ADMIN"),
  async (_req: AuthRequest, res, next) => {
    try {
      res.json(getBackfillNotificationConfig());
    } catch (e) {
      next(e);
    }
  },
);

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

      const operator = req.user?.id
        ? await getCrmTranscriptBackfillOperatorContact(req.user.id)
        : null;

      const result = await sendTestBackfillAlert(orgId, operator);
      res.json(result);
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
      const ALLOWED_STATUSES = ["RUNNING", "COMPLETED", "FAILED"];
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

      res.json({
        total,
        limit,
        offset,
        crossOrg: superAdmin && !scopedOrgId,
        jobs: rows.map((row) => {
          const rootId = jobToRoot.get(row.id) ?? row.id;
          const lineage = lineagesByRoot.get(rootId) ?? [];
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
      });
      res.json({
        slackWebhookUrl: saved.slackWebhookUrl ?? "",
        emailRecipients: saved.emailRecipients ?? [],
        updatedAt: saved.updatedAt,
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

      const ALLOWED_STATUSES = ["RUNNING", "COMPLETED", "FAILED"];
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
        Date.now() - new Date(row.heartbeatAt).getTime() > BACKFILL_HEARTBEAT_STALE_MS
      ) {
        const reaped = await updateCrmTranscriptBackfillJob(row.id, {
          status: "FAILED",
          completedAt: new Date(),
        });
        scheduleBackfillCompletionEmail(row.id);
        return res.json(rowToState(reaped ?? { ...row, status: "FAILED", completedAt: new Date() }));
      }
      res.json(rowToState(row));
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
        if (heartbeatAgeMs <= BACKFILL_HEARTBEAT_STALE_MS) {
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
