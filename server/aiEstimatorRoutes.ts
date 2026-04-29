import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users, bids, projects, aiEstimatorRateSamples } from "@shared/schema";
import {
  type AuthRequest,
  requireAuth,
  requireFeaturePermission,
  getEffectivePermissions,
} from "./auth";
import { sensitiveLimiter } from "./rateLimiter";
import { logError, logWarn } from "./utils/logger";
import { isFeatureEnabled } from "./services/featureFlagService";
import { validateBody } from "./utils/validation";
import {
  getAccessStatus,
  listOrgAccess,
  setUserAccess,
} from "./services/aiEstimator/access";
import {
  listLearnedRatesForOrg,
  getLearnedRate,
  listExcludedSources,
  addExcludedSource,
  removeExcludedSource,
  listRateSamples,
  recomputeLearnedRate,
  confidenceBucket,
} from "./services/aiEstimator/learnedRates";
import {
  recordFeedback,
  listRecentFeedback,
  getFeedbackStats,
  type FeedbackOutcome,
  type FeedbackSurface,
} from "./services/aiEstimator/feedback";
import {
  listIngestRuns,
  runIngestion,
} from "./services/aiEstimator/ingestion";
import { logCreate, logDelete } from "./auditLogger";
import { suggestInline } from "./services/aiEstimator/inlineSuggest";
import { generateDraftEstimate } from "./services/aiEstimator/draftEstimate";
import { draftTakeoffFromPlans } from "./services/aiEstimator/takeoffDraft";
import {
  createSession,
  getSessionForUser,
  listMessages,
  listSessions,
  sendChatTurn,
  setMessageFeedback,
} from "./services/aiEstimator/chat";
import {
  fetchAllowed,
  WEB_RESEARCH_ALLOWLIST,
  WebResearchDomainBlockedError,
} from "./services/aiEstimator/webResearch";

const router = Router();

const estimatorBase = "/ai-estimator";

// =====================================================================
// Org-flag + access gate. AI Estimator is feature-flagged at the org
// level; once on, individual users must also be enabled by an admin.
// =====================================================================
async function requireEstimatorAccess(
  req: AuthRequest,
  res: Response,
  next: () => void,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role === "SUPER_ADMIN") {
    next();
    return;
  }
  const orgId = req.user.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const status = await getAccessStatus(orgId, req.user.id);
  if (!status.enabled) {
    res.status(403).json({
      error: "AI Estimator not enabled for this user",
      reason: status.reason,
      featureFlag: "AI_ESTIMATOR",
    });
    return;
  }
  next();
}

function blockedResponse(res: Response, reason?: string) {
  return res
    .status(429)
    .json({ error: "AI quota exceeded", reason: reason ?? "AI usage limit reached. Try again tomorrow or contact your admin." });
}

// =====================================================================
// Status endpoint — used by every UI surface to know whether to render
// the AI Estimator entry points.
// =====================================================================
router.get(`${estimatorBase}/status`, requireAuth, async (req: AuthRequest, res: Response) => {
  if (!req.user?.organizationId) {
    return res.json({ enabled: false, reason: "FEATURE_FLAG_OFF", featureFlagOn: false, canTrain: false, canManage: false });
  }
  const flagOn = await isFeatureEnabled(req.user.organizationId, "AI_ESTIMATOR");
  const status = await getAccessStatus(req.user.organizationId, req.user.id);
  const effectiveRole = req.user.effectiveRole || req.user.role;
  const perms = await getEffectivePermissions(req.user.id, req.user.organizationId, effectiveRole);
  res.json({
    enabled: status.enabled,
    canTrain: status.canTrain,
    canManage:
      !!perms.canManageAiEstimator ||
      req.user.role === "ADMIN" ||
      req.user.role === "SUPER_ADMIN",
    featureFlagOn: flagOn,
    reason: status.reason,
  });
});

// =====================================================================
// Admin: list org users + their AI Estimator access state, toggle access,
// view ingestion runs, kick off a manual re-ingest.
// =====================================================================
router.get(
  `${estimatorBase}/admin/access`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const [accessRows, orgUsers] = await Promise.all([
      listOrgAccess(orgId),
      db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.organizationId, orgId)),
    ]);
    const byUserId = new Map(accessRows.map((r) => [r.userId, r]));
    res.json({
      users: orgUsers.map((u) => {
        const a = byUserId.get(u.id);
        return {
          userId: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email,
          role: u.role,
          enabled: a?.enabled ?? false,
          canTrain: a?.canTrain ?? false,
          enabledAt: a?.enabledAt ?? null,
        };
      }),
    });
  },
);

const accessSchema = z.object({
  userId: z.string().min(1),
  enabled: z.boolean(),
  canTrain: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

router.put(
  `${estimatorBase}/admin/access`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(accessSchema, req.body, res);
    if (!data) return;
    try {
      const row = await setUserAccess({
        organizationId: req.user!.organizationId!,
        userId: data.userId,
        enabled: data.enabled,
        canTrain: data.canTrain,
        changedById: req.user!.id,
      });
      res.json(row);
    } catch (err) {
      logError("Failed to update AI Estimator access", { error: String(err) });
      res.status(500).json({ error: "Failed to update access" });
    }
  },
);

router.get(
  `${estimatorBase}/admin/ingest-runs`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const runs = await listIngestRuns(req.user!.organizationId!);
    res.json({ runs });
  },
);

router.post(
  `${estimatorBase}/admin/ingest`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const run = await runIngestion(req.user!.organizationId!, req.user!.id, "MANUAL");
      res.json({ run });
    } catch (err) {
      logError("AI Estimator ingestion failed", { error: String(err) });
      res.status(500).json({ error: "Ingestion failed" });
    }
  },
);

router.get(
  `${estimatorBase}/admin/learned-rates`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const rates = await listLearnedRatesForOrg(orgId);

    const excludedSources = await listExcludedSources(orgId);
    const excludedProjectIds = new Set(excludedSources.map((e) => e.projectId).filter(Boolean) as string[]);

    const enriched = await Promise.all(rates.map(async (r) => {
      const [sampleCountRow, excludedSampleCountRow] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` })
          .from(aiEstimatorRateSamples)
          .where(and(
            eq(aiEstimatorRateSamples.learnedRateId, r.id),
            eq(aiEstimatorRateSamples.organizationId, orgId),
          )),
        excludedProjectIds.size > 0
          ? db.select({ count: sql<number>`count(*)::int` })
              .from(aiEstimatorRateSamples)
              .where(and(
                eq(aiEstimatorRateSamples.learnedRateId, r.id),
                eq(aiEstimatorRateSamples.organizationId, orgId),
                sql`${aiEstimatorRateSamples.projectId} = ANY(${Array.from(excludedProjectIds)})`,
              ))
          : Promise.resolve([{ count: 0 }]),
      ]);

      const confidence = confidenceBucket(r.sampleSize, r.p25Value, r.p75Value, r.medianValue);
      const excludedSampleCount = excludedSampleCountRow[0]?.count ?? 0;

      return {
        ...r,
        mean: r.meanValue,
        median: r.medianValue,
        p25: r.p25Value,
        p75: r.p75Value,
        confidence,
        excludedSampleCount,
        sampleCount: sampleCountRow[0]?.count ?? r.sampleSize,
      };
    }));

    res.json({ rates: enriched });
  },
);

router.get(
  `${estimatorBase}/admin/learned-rates/export.csv`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const rates = await listLearnedRatesForOrg(orgId);
    const header = "id,costCode,metric,unit,sampleSize,mean,median,p25,p75,confidence,lastUpdatedAt\n";
    const rows = rates.map((r) => {
      const confidence = confidenceBucket(r.sampleSize, r.p25Value, r.p75Value, r.medianValue);
      return [r.id, r.costCode, r.metric, r.unit, r.sampleSize, r.meanValue ?? "", r.medianValue ?? "", r.p25Value ?? "", r.p75Value ?? "", confidence, r.lastUpdatedAt.toISOString()].join(",");
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="learned-rates.csv"`);
    res.send(header + rows.join("\n"));
  },
);

router.get(
  `${estimatorBase}/admin/learned-rates/:id/samples`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const { samples, total } = await listRateSamples({ organizationId: orgId, learnedRateId: req.params.id, limit, offset });

    const projectIds = Array.from(new Set(samples.map((s) => s.projectId).filter(Boolean) as string[]));
    const bidIds = Array.from(new Set(samples.map((s) => s.bidId).filter(Boolean) as string[]));

    const [projectRows, bidRows] = await Promise.all([
      projectIds.length ? db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(sql`${projects.id} = ANY(${projectIds})`) : Promise.resolve([]),
      bidIds.length ? db.select({ id: bids.id, name: bids.name, code: bids.code }).from(bids).where(sql`${bids.id} = ANY(${bidIds})`) : Promise.resolve([]),
    ]);

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));
    const bidMap = new Map(bidRows.map((b) => [b.id, b]));

    const enrichedSamples = samples.map((s) => ({
      ...s,
      project: s.projectId ? projectMap.get(s.projectId) ?? null : null,
      bid: s.bidId ? bidMap.get(s.bidId) ?? null : null,
    }));

    res.json({ samples: enrichedSamples, total, limit, offset });
  },
);

router.get(
  `${estimatorBase}/admin/learned-rates/:id/samples/export.csv`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const { samples } = await listRateSamples({ organizationId: orgId, learnedRateId: req.params.id, limit: 2000, offset: 0 });
    const header = "id,costCode,metric,unit,value,sourceType,sourceRowId,projectId,bidId,recordedAt\n";
    const rows = samples.map((s) => [s.id, s.costCode, s.metric, s.unit, s.value, s.sourceType, s.sourceRowId ?? "", s.projectId ?? "", s.bidId ?? "", s.recordedAt.toISOString()].join(","));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="rate-samples.csv"`);
    res.send(header + rows.join("\n"));
  },
);

router.get(
  `${estimatorBase}/admin/excluded-sources`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const excluded = await listExcludedSources(orgId);

    const projectIds = Array.from(new Set(excluded.map((e) => e.projectId).filter(Boolean) as string[]));
    const bidIds = Array.from(new Set(excluded.map((e) => e.bidId).filter(Boolean) as string[]));
    const userIds = Array.from(new Set(excluded.map((e) => e.excludedById).filter(Boolean) as string[]));

    const [projectRows, bidRows, userRows] = await Promise.all([
      projectIds.length ? db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(sql`${projects.id} = ANY(${projectIds})`) : Promise.resolve([]),
      bidIds.length ? db.select({ id: bids.id, name: bids.name, code: bids.code }).from(bids).where(sql`${bids.id} = ANY(${bidIds})`) : Promise.resolve([]),
      userIds.length ? db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(sql`${users.id} = ANY(${userIds})`) : Promise.resolve([]),
    ]);

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));
    const bidMap = new Map(bidRows.map((b) => [b.id, b]));
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    const enriched = excluded.map((e) => ({
      ...e,
      project: e.projectId ? projectMap.get(e.projectId) ?? null : null,
      bid: e.bidId ? bidMap.get(e.bidId) ?? null : null,
      excludedBy: e.excludedById ? userMap.get(e.excludedById) ?? null : null,
    }));

    res.json({ excludedSources: enriched });
  },
);

const excludeSourceSchema = z.object({
  projectId: z.string().min(1).optional(),
  bidId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

router.post(
  `${estimatorBase}/admin/excluded-sources`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(excludeSourceSchema, req.body, res);
    if (!data) return;
    if (!data.projectId && !data.bidId) {
      return res.status(400).json({ error: "projectId or bidId required" });
    }
    const orgId = req.user!.organizationId!;
    try {
      const row = await addExcludedSource({
        organizationId: orgId,
        projectId: data.projectId,
        bidId: data.bidId,
        reason: data.reason,
        excludedById: req.user!.id,
      });
      await logCreate(req.user!.id, "ai_estimator_excluded_source", row.id, { projectId: data.projectId, bidId: data.bidId, reason: data.reason }, req);

      if (data.projectId || data.bidId) {
        const affectedRates = await listLearnedRatesForOrg(orgId);
        const recomputeErrors: string[] = [];
        for (const rate of affectedRates) {
          await recomputeLearnedRate(orgId, rate.costCode, rate.metric, rate.unit).catch((e) => {
            recomputeErrors.push(`${rate.costCode}/${rate.metric}: ${String(e)}`);
          });
        }
        if (recomputeErrors.length > 0) {
          logError("Partial recompute failures after exclusion add", { orgId, errors: recomputeErrors });
        }
      }

      res.status(201).json(row);
    } catch (err) {
      logError("Failed to add excluded source", { error: String(err) });
      res.status(500).json({ error: "Failed to add excluded source" });
    }
  },
);

router.delete(
  `${estimatorBase}/admin/excluded-sources/:id`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    try {
      await logDelete(req.user!.id, "ai_estimator_excluded_source", req.params.id, {}, req);
      await removeExcludedSource(req.params.id, orgId);

      const affectedRates = await listLearnedRatesForOrg(orgId);
      const recomputeErrors: string[] = [];
      for (const rate of affectedRates) {
        await recomputeLearnedRate(orgId, rate.costCode, rate.metric, rate.unit).catch((e) => {
          recomputeErrors.push(`${rate.costCode}/${rate.metric}: ${String(e)}`);
        });
      }
      if (recomputeErrors.length > 0) {
        logError("Partial recompute failures after exclusion remove", { orgId, errors: recomputeErrors });
      }

      res.status(204).end();
    } catch (err) {
      logError("Failed to remove excluded source", { error: String(err) });
      res.status(500).json({ error: "Failed to remove excluded source" });
    }
  },
);

router.get(
  `${estimatorBase}/admin/feedback`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const [stats, recent] = await Promise.all([
      getFeedbackStats(orgId, 30),
      listRecentFeedback(orgId, 25),
    ]);
    res.json({ stats, recent });
  },
);

// =====================================================================
// Inline suggestion endpoint. Pure org-data lookup — no AI call so this
// is cheap to call per row as the user types.
// =====================================================================
const inlineSchema = z.object({
  costCode: z.string().min(1),
  metric: z.enum(["unit_cost", "labor_hours_per_unit", "production_rate"]),
  unit: z.string().min(1),
});
router.post(
  `${estimatorBase}/suggest/inline`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(inlineSchema, req.body, res);
    if (!data) return;
    const suggestion = await suggestInline({
      organizationId: req.user!.organizationId!,
      costCode: data.costCode,
      metric: data.metric,
      unit: data.unit,
    });
    res.json({ suggestion });
  },
);

// =====================================================================
// Draft estimate from a bid (uses takeoffs + learned rates + retrieval).
// =====================================================================
const draftEstimateSchema = z.object({
  bidId: z.string().min(1),
  takeoffSheetIds: z.array(z.string()).optional(),
  scopeNotes: z.string().max(2000).optional(),
});
router.post(
  `${estimatorBase}/draft-estimate`,
  requireAuth,
  requireEstimatorAccess,
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(draftEstimateSchema, req.body, res);
    if (!data) return;
    try {
      const out = await generateDraftEstimate({
        organizationId: req.user!.organizationId!,
        userId: req.user!.id,
        bidId: data.bidId,
        takeoffSheetIds: data.takeoffSheetIds,
        scopeNotes: data.scopeNotes,
      });
      if (out.blocked) return blockedResponse(res, out.reason);
      if (!out.result) return res.status(200).json({ fallback: true, message: out.reason ?? "AI did not produce a draft" });
      res.json(out.result);
    } catch (err) {
      logError("Draft estimate failed", { error: String(err) });
      res.status(500).json({ error: "Draft estimate failed" });
    }
  },
);

// =====================================================================
// Draft a takeoff from one or more plan documents.
// =====================================================================
const draftTakeoffSchema = z
  .object({
    planDocumentIds: z.array(z.string().min(1)).max(8).optional(),
    projectId: z.string().min(1).optional(),
    scopeNotes: z.string().max(2000).optional(),
  })
  .refine((d) => (d.planDocumentIds && d.planDocumentIds.length > 0) || !!d.projectId, {
    message: "Provide planDocumentIds or projectId",
  });
router.post(
  `${estimatorBase}/draft-takeoff`,
  requireAuth,
  requireEstimatorAccess,
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(draftTakeoffSchema, req.body, res);
    if (!data) return;
    try {
      const out = await draftTakeoffFromPlans({
        organizationId: req.user!.organizationId!,
        userId: req.user!.id,
        planDocumentIds: data.planDocumentIds,
        projectId: data.projectId,
        scopeNotes: data.scopeNotes,
      });
      if (out.blocked) return blockedResponse(res, out.reason);
      if (!out.result) return res.status(200).json({ fallback: true, message: out.reason });
      res.json(out.result);
    } catch (err) {
      logError("Draft takeoff failed", { error: String(err) });
      res.status(500).json({ error: "Draft takeoff failed" });
    }
  },
);

// =====================================================================
// Feedback capture — wired into every AI surface. Outcome must be one
// of ACCEPTED / EDITED / REJECTED / THUMBS_UP / THUMBS_DOWN.
// =====================================================================
const feedbackSchema = z.object({
  surface: z.enum([
    "takeoff_draft",
    "estimate_draft",
    "inline_unit_cost",
    "inline_labor_hours",
    "inline_production_rate",
    "chat_answer",
    "web_research",
  ]),
  outcome: z.enum(["ACCEPTED", "EDITED", "REJECTED", "THUMBS_UP", "THUMBS_DOWN"]),
  targetType: z.string().min(1),
  targetId: z.string().optional(),
  bidId: z.string().optional(),
  estimateId: z.string().optional(),
  projectId: z.string().optional(),
  takeoffSheetId: z.string().optional(),
  costCode: z.string().optional(),
  tradeType: z.string().optional(),
  originalValue: z.any().optional(),
  finalValue: z.any().optional(),
  comment: z.string().max(1000).optional(),
  aiAuditId: z.string().optional(),
  rateSample: z
    .object({
      metric: z.enum(["unit_cost", "labor_hours_per_unit", "production_rate"]),
      unit: z.string().min(1),
      value: z.number().finite(),
    })
    .optional(),
});
router.post(
  `${estimatorBase}/feedback`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(feedbackSchema, req.body, res);
    if (!data) return;
    try {
      const event = await recordFeedback({
        organizationId: req.user!.organizationId!,
        userId: req.user!.id,
        surface: data.surface as FeedbackSurface,
        outcome: data.outcome as FeedbackOutcome,
        targetType: data.targetType,
        targetId: data.targetId,
        bidId: data.bidId,
        estimateId: data.estimateId,
        projectId: data.projectId,
        takeoffSheetId: data.takeoffSheetId,
        costCode: data.costCode,
        tradeType: data.tradeType,
        originalValue: data.originalValue,
        finalValue: data.finalValue,
        comment: data.comment,
        aiAuditId: data.aiAuditId,
        rateSample: data.rateSample,
      });
      res.status(201).json(event);
    } catch (err) {
      logError("AI Estimator feedback record failed", { error: String(err) });
      res.status(500).json({ error: "Failed to record feedback" });
    }
  },
);

// =====================================================================
// Chat: list/create sessions, list/post messages, message feedback.
// =====================================================================
router.get(
  `${estimatorBase}/chat/sessions`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const sessions = await listSessions(req.user!.organizationId!, req.user!.id);
    res.json({ sessions });
  },
);

const newSessionSchema = z.object({
  bidId: z.string().optional(),
  estimateId: z.string().optional(),
  projectId: z.string().optional(),
  title: z.string().max(140).optional(),
});
router.post(
  `${estimatorBase}/chat/sessions`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(newSessionSchema, req.body, res);
    if (!data) return;
    const session = await createSession({
      organizationId: req.user!.organizationId!,
      userId: req.user!.id,
      bidId: data.bidId,
      estimateId: data.estimateId,
      projectId: data.projectId,
      title: data.title,
    });
    res.status(201).json(session);
  },
);

router.get(
  `${estimatorBase}/chat/sessions/:id/messages`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const session = await getSessionForUser(
      req.user!.organizationId!,
      req.user!.id,
      req.params.id,
    );
    if (!session) return res.status(404).json({ error: "Session not found" });
    const messages = await listMessages(session.id);
    res.json({ session, messages });
  },
);

const chatTurnSchema = z.object({ prompt: z.string().min(1).max(4000) });
router.post(
  `${estimatorBase}/chat/sessions/:id/messages`,
  requireAuth,
  requireEstimatorAccess,
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(chatTurnSchema, req.body, res);
    if (!data) return;
    const session = await getSessionForUser(
      req.user!.organizationId!,
      req.user!.id,
      req.params.id,
    );
    if (!session) return res.status(404).json({ error: "Session not found" });
    try {
      const out = await sendChatTurn({
        organizationId: req.user!.organizationId!,
        userId: req.user!.id,
        session,
        prompt: data.prompt,
      });
      if ("blocked" in out && out.blocked) return blockedResponse(res, out.reason);
      res.json(out);
    } catch (err) {
      logError("AI Estimator chat turn failed", { error: String(err) });
      res.status(500).json({ error: "Chat turn failed" });
    }
  },
);

const chatFeedbackSchema = z.object({
  outcome: z.enum(["THUMBS_UP", "THUMBS_DOWN"]).nullable(),
});
router.put(
  `${estimatorBase}/chat/sessions/:sid/messages/:mid/feedback`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(chatFeedbackSchema, req.body, res);
    if (!data) return;
    const session = await getSessionForUser(
      req.user!.organizationId!,
      req.user!.id,
      req.params.sid,
    );
    if (!session) return res.status(404).json({ error: "Session not found" });
    await setMessageFeedback(session.id, req.params.mid, data.outcome);
    res.status(204).end();
  },
);

// =====================================================================
// Web research — strict allow-list + per-org cache.
// =====================================================================
const webResearchSchema = z.object({
  url: z.string().url(),
  query: z.string().max(500).optional(),
});
router.post(
  `${estimatorBase}/web-research`,
  requireAuth,
  requireEstimatorAccess,
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(webResearchSchema, req.body, res);
    if (!data) return;
    try {
      const result = await fetchAllowed({
        organizationId: req.user!.organizationId!,
        userId: req.user!.id,
        url: data.url,
        query: data.query,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof WebResearchDomainBlockedError) {
        return res.status(400).json({
          error: "Domain not on allow-list",
          domain: err.domain,
          allowList: WEB_RESEARCH_ALLOWLIST,
        });
      }
      logWarn("AI Estimator web research failed", { error: String(err) });
      res.status(502).json({ error: "Web research fetch failed" });
    }
  },
);

router.get(
  `${estimatorBase}/web-research/allowlist`,
  requireAuth,
  requireEstimatorAccess,
  (_req, res) => {
    res.json({ allowList: WEB_RESEARCH_ALLOWLIST });
  },
);

export default router;
