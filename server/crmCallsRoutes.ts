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
  users,
  insertCrmCallSchema,
} from "@shared/schema";
import {
  requireAuth,
  requireRole,
  requireRoleOrFeature,
  type AuthRequest,
} from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { isFeatureEnabled } from "./services/featureFlagService";
import { logError, logInfo, logWarn } from "./utils/logger";
import { eventBus } from "./events";
import {
  queueCallTranscription,
  transcribeCallRecording,
} from "./services/callTranscriptionService";
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
// in the background so the HTTP request returns immediately; progress and
// failures are tracked in-memory and surfaced via a polling endpoint.
// ---------------------------------------------------------------------------
type BackfillJob = {
  id: string;
  orgId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recordingId: string; error: string }>;
  startedAt: string;
  completedAt: string | null;
  startedById: string;
};

const transcriptBackfillJobs = new Map<string, BackfillJob>();
const MAX_BACKFILL_ERROR_SAMPLES = 50;
const BACKFILL_JOB_TTL_MS = 60 * 60 * 1000; // keep finished jobs for 1h

function pruneBackfillJobs() {
  const now = Date.now();
  for (const [id, job] of transcriptBackfillJobs) {
    if (
      job.status !== "RUNNING" &&
      job.completedAt &&
      now - new Date(job.completedAt).getTime() > BACKFILL_JOB_TTL_MS
    ) {
      transcriptBackfillJobs.delete(id);
    }
  }
}

const BACKFILL_BATCH_SIZE = 100;

async function fetchEligibleRecordingBatch(
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

async function runTranscriptBackfill(
  job: BackfillJob,
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
    logInfo("crmCalls: transcript backfill finished", {
      jobId: job.id,
      orgId: job.orgId,
      total: job.total,
      succeeded: job.succeeded,
      failed: job.failed,
    });
  }
}

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

      pruneBackfillJobs();

      // Don't allow two concurrent backfills for the same org — they would
      // race over the same PENDING/FAILED rows.
      for (const job of transcriptBackfillJobs.values()) {
        if (job.orgId === orgId && job.status === "RUNNING") {
          return res.status(409).json({
            error: "A transcript backfill is already running for this organization",
            jobId: job.id,
          });
        }
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
      const job: BackfillJob = {
        id: jobId,
        orgId,
        status: "RUNNING",
        total: initialTotal,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
        startedById: req.user!.id,
      };
      transcriptBackfillJobs.set(jobId, job);

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
        return res.status(200).json({ jobId, total: 0, message: "No recordings to backfill" });
      }

      // Fire-and-forget; the request returns immediately. The worker keeps
      // paginating through eligible recordings until none remain.
      void runTranscriptBackfill(job, eligible, concurrency, maxRecords);

      res.status(202).json({ jobId, total: job.total });
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
      const job = transcriptBackfillJobs.get(req.params.jobId);
      if (!job || job.orgId !== orgId) {
        return res.status(404).json({ error: "Backfill job not found" });
      }
      res.json(job);
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
