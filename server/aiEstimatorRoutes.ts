import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  bids,
  projects,
  aiEstimatorRateSamples,
  takeoffMeasurements,
  takeoffSheets,
  standaloneTakeoffs,
} from "@shared/schema";
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
import {
  listLessons,
  softDeleteLesson,
} from "./services/aiEstimator/lessons";
import {
  indexPlanSheetsForBid,
  getSheetIndexForBid,
} from "./services/aiEstimator/sheetIndex";
import {
  listAssemblies,
  getAssembly,
  createAssembly,
  updateAssembly,
  deleteAssembly,
} from "./services/aiEstimator/assemblies";
import {
  getOrgFactors,
  upsertOrgFactors,
} from "./services/aiEstimator/orgFactors";
import {
  listLegendSymbolsForBid,
  upsertLegendSymbol,
  deleteLegendSymbol,
} from "./services/aiEstimator/legendSymbols";
// Task #2577 Phase B — Trade material templates, map-reduce drafter,
// and schedule symbol auto-counting.
import {
  listTradeTemplates,
  applyTradeTemplate,
  applyTradeTemplateToBid,
} from "./services/aiEstimator/tradeMaterialTemplates";
import {
  mapReduceDraftFromPlans,
  cachePageTextOnSheets,
} from "./services/aiEstimator/mapReduceDraft";
import {
  extractScheduleSymbolsForBid,
  listScheduleSymbolsForBid,
  acceptScheduleSymbols,
  rejectScheduleSymbols,
  editScheduleSymbol,
} from "./services/aiEstimator/scheduleCounts";
import {
  insertAiEstimatorAssemblySchema,
  insertAiEstimatorAssemblyComponentSchema,
  insertAiEstimatorOrgFactorsSchema,
  insertAiEstimatorLegendSymbolSchema,
  SHEET_DISCIPLINES,
} from "@shared/schema";

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
    // Task #2453 — for `library_assignment` samples, the sourceRowId is the
    // standalone-takeoff measurement id. Resolve back to the parent
    // standalone takeoff so the drill-down can show its title and link.
    const libraryMeasurementIds = Array.from(
      new Set(
        samples
          .filter((s) => s.sourceType === "library_assignment" && s.sourceRowId)
          .map((s) => s.sourceRowId as string),
      ),
    );

    const [projectRows, bidRows, takeoffRows] = await Promise.all([
      projectIds.length ? db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(sql`${projects.id} = ANY(${projectIds})`) : Promise.resolve([]),
      bidIds.length ? db.select({ id: bids.id, name: bids.name, code: bids.code }).from(bids).where(sql`${bids.id} = ANY(${bidIds})`) : Promise.resolve([]),
      libraryMeasurementIds.length
        ? db
            .select({
              measurementId: takeoffMeasurements.id,
              standaloneTakeoffId: standaloneTakeoffs.id,
              standaloneTakeoffTitle: standaloneTakeoffs.title,
            })
            .from(takeoffMeasurements)
            .innerJoin(takeoffSheets, eq(takeoffSheets.id, takeoffMeasurements.sheetId))
            .innerJoin(standaloneTakeoffs, eq(standaloneTakeoffs.id, takeoffSheets.standaloneTakeoffId))
            .where(sql`${takeoffMeasurements.id} = ANY(${libraryMeasurementIds})`)
        : Promise.resolve([]),
    ]);

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));
    const bidMap = new Map(bidRows.map((b) => [b.id, b]));
    const standaloneTakeoffByMeasurement = new Map(
      takeoffRows.map((r) => [r.measurementId, { id: r.standaloneTakeoffId, title: r.standaloneTakeoffTitle }]),
    );

    const enrichedSamples = samples.map((s) => ({
      ...s,
      project: s.projectId ? projectMap.get(s.projectId) ?? null : null,
      bid: s.bidId ? bidMap.get(s.bidId) ?? null : null,
      standaloneTakeoff:
        s.sourceType === "library_assignment" && s.sourceRowId
          ? standaloneTakeoffByMeasurement.get(s.sourceRowId) ?? null
          : null,
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
// Task #2415 — Admin: list and soft-delete qualitative lessons. Lessons
// are generated by a Claude summarizer when AI_PROVIDER_TAKEOFF is on
// and a user EDITs an AI suggestion; admins can review or remove them.
// =====================================================================
router.get(
  `${estimatorBase}/admin/lessons`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    const includeStaleParam = String(req.query.includeStale ?? "")
      .toLowerCase()
      .trim();
    const includeStale = includeStaleParam === "1" || includeStaleParam === "true";
    const lessons = await listLessons({
      organizationId: orgId,
      activeOnly: !includeStale,
      costCode: typeof req.query.costCode === "string" ? req.query.costCode : null,
      tradeType: typeof req.query.tradeType === "string" ? req.query.tradeType : null,
      surface: typeof req.query.surface === "string" ? req.query.surface : null,
      limit: 200,
    });
    res.json({
      lessons: lessons.map((l) => ({
        id: l.id,
        title: l.title,
        contentSnippet: l.contentSnippet,
        scope: l.lessonScope,
        status: l.lessonStatus,
        surface: l.lessonSurface,
        costCode: l.costCode,
        tradeType: l.tradeType,
        numericFacets: l.numericFacets,
        derivedFromFeedbackIds: l.derivedFromFeedbackIds,
        supersedesRowId: l.supersedesRowId,
        indexedAt: l.indexedAt,
      })),
    });
  },
);

router.delete(
  `${estimatorBase}/admin/lessons/:id`,
  requireAuth,
  requireFeaturePermission("canManageAiEstimator"),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId!;
      const row = await softDeleteLesson(orgId, req.params.id);
      if (!row) return res.status(404).json({ error: "Lesson not found" });
      try {
        await logDelete(
          req.user!.id,
          "ai_estimator_lesson",
          row.id,
          {
            title: row.title,
            scope: row.lessonScope,
            surface: row.lessonSurface,
            costCode: row.costCode,
            tradeType: row.tradeType,
          },
          req,
        );
      } catch (auditErr) {
        logWarn("Audit log for lesson delete failed", { error: String(auditErr) });
      }
      res.status(204).end();
    } catch (err) {
      logError("Failed to soft-delete lesson", { error: String(err) });
      res.status(500).json({ error: "Failed to delete lesson" });
    }
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
      // Task #2517 — Long-running estimator drafts move to the
      // pg-boss queue (`ai_estimator_draft`). The route returns a
      // job id immediately and the client polls `/api/jobs/:id` for
      // the result (`output.result` / `output.blocked` / etc).
      const { enqueueJob } = await import("./jobQueue");
      const enq = await enqueueJob(
        "ai_estimator_draft",
        {
          mode: "estimate",
          draftOptions: {
            organizationId: req.user!.organizationId!,
            userId: req.user!.id,
            bidId: data.bidId,
            takeoffSheetIds: data.takeoffSheetIds,
            scopeNotes: data.scopeNotes,
          },
        },
        {
          organizationId: req.user!.organizationId!,
          userId: req.user!.id,
          idempotencyKey: `ai_estimator_draft:estimate:${data.bidId}:${req.user!.id}`,
        },
      );
      res.status(202).json({
        jobId: enq.jobId,
        idempotencyKey: enq.idempotencyKey,
        deduplicated: enq.deduplicated,
        status: "QUEUED",
      });
    } catch (err) {
      logError("Draft estimate enqueue failed", { error: String(err) });
      res.status(500).json({ error: "Failed to enqueue draft estimate" });
    }
  },
);
// =====================================================================
// Draft a takeoff from one or more plan documents.
// =====================================================================
const draftTakeoffSchema = z
  .object({
    // Task #2577 Phase B — cap raised from 8 → 200 so plan-set drafts
    // can cover full multi-trade plan sets. Large sets are routed
    // through the map-reduce drafter automatically when a `bidId` is
    // supplied (see job handler).
    planDocumentIds: z.array(z.string().min(1)).max(200).optional(),
    projectId: z.string().min(1).optional(),
    // Task #2551 — Standalone takeoff source. When provided, plan
    // documents are pulled from `standalone_takeoff_files` for the
    // takeoff (org-scoped); planDocumentIds/projectId may be omitted.
    standaloneTakeoffId: z.string().min(1).optional(),
    // Task #2577 Phase B — when `bidId` is supplied, the job handler
    // dispatches to `mapReduceDraftFromPlans` (sheet-cited, scales to
    // 200+ sheets). `useMapReduce: false` forces the legacy path.
    bidId: z.string().min(1).optional(),
    disciplines: z.array(z.string().min(1).max(8)).max(20).optional(),
    tradeFilter: z.string().max(120).optional(),
    useMapReduce: z.boolean().optional(),
    scopeNotes: z.string().max(2000).optional(),
    // Task #2530 — when true, the route enqueues `ai_estimator_draft`
    // and returns `{ jobId }` so the UI can subscribe to live progress
    // via `useJobProgress` instead of blocking on the HTTP call.
    async: z.boolean().optional(),
  })
  .refine(
    (d) =>
      (d.planDocumentIds && d.planDocumentIds.length > 0) ||
      !!d.projectId ||
      !!d.standaloneTakeoffId ||
      !!d.bidId,
    { message: "Provide planDocumentIds, projectId, standaloneTakeoffId, or bidId" },
  );
router.post(
  `${estimatorBase}/draft-takeoff`,
  requireAuth,
  requireEstimatorAccess,
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(draftTakeoffSchema, req.body, res);
    if (!data) return;
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.id;
    // Task #2577 Phase B — when a `bidId` is supplied (or the caller
    // explicitly sets `useMapReduce: true`), the job handler routes to
    // `mapReduceDraftFromPlans` so 200+ sheet plan sets are covered
    // with sheet citations instead of being silently truncated to 8
    // documents by the legacy path.
    const useMapReduce =
      data.useMapReduce === true || (data.useMapReduce !== false && !!data.bidId);
    const draftOptions = {
      organizationId,
      userId,
      planDocumentIds: data.planDocumentIds,
      projectId: data.projectId,
      standaloneTakeoffId: data.standaloneTakeoffId,
      bidId: data.bidId,
      disciplines: data.disciplines,
      tradeFilter: data.tradeFilter,
      useMapReduce,
      scopeNotes: data.scopeNotes,
    };
    try {
      // Task #2517 — Enqueue plan-document → takeoff drafting on
      // the pg-boss queue (`ai_estimator_draft`). HTTP returns a
      // job id; client polls `/api/jobs/:id` (or subscribes via
      // SSE / `useJobProgress`) for the result. The `async` flag
      // from Task #2530 is now the implicit default and accepted
      // for backward compatibility.
      const { enqueueJob } = await import("./jobQueue");
      // Task #2577 Phase B — `bidId` is now a first-class scope for
      // map-reduce drafts; it MUST be part of the dedupe key or
      // distinct bids for the same user collapse onto one job. We
      // also fold in disciplines / tradeFilter / useMapReduce so a
      // narrowed-scope re-run isn't deduped to a prior wide run.
      const idemBasisParts = [
        data.planDocumentIds?.slice().sort().join(","),
        data.projectId,
        data.standaloneTakeoffId,
        data.bidId ? `bid:${data.bidId}` : undefined,
        data.disciplines?.slice().sort().join("+"),
        data.tradeFilter,
        useMapReduce ? "mr" : undefined,
      ].filter((p): p is string => Boolean(p));
      const idemBasis = idemBasisParts.join("|") || "default";
      const enq = await enqueueJob(
        "ai_estimator_draft",
        { mode: "takeoff", draftOptions },
        {
          organizationId,
          userId,
          idempotencyKey: `ai_estimator_draft:takeoff:${idemBasis}:${userId}`,
        },
      );
      res.status(202).json({
        jobId: enq.jobId,
        idempotencyKey: enq.idempotencyKey,
        deduplicated: enq.deduplicated,
        status: "QUEUED",
      });
    } catch (err) {
      logError("Draft takeoff enqueue failed", { error: String(err) });
      res.status(500).json({ error: "Failed to enqueue draft takeoff" });
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

// =====================================================================
// Task #2466 Phase 1 — Sheet indexing & trade routing.
// =====================================================================
router.post(
  `${estimatorBase}/bids/:bidId/sheet-index`,
  requireAuth,
  requireEstimatorAccess,
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const orgId = req.user!.organizationId!;
    try {
      const out = await indexPlanSheetsForBid({
        organizationId: orgId,
        userId: req.user!.id,
        bidId: req.params.bidId,
      });
      if (out.aiBlocked) return blockedResponse(res, out.reason);
      res.json(out);
    } catch (err) {
      logError("AI Estimator sheet-index failed", { error: String(err) });
      res.status(500).json({ error: "Sheet index failed" });
    }
  },
);

router.get(
  `${estimatorBase}/bids/:bidId/sheet-index`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const rows = await getSheetIndexForBid({
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
    });
    const byDiscipline: Record<string, typeof rows> = {};
    for (const r of rows) {
      const k = r.discipline ?? "UNCLASSIFIED";
      (byDiscipline[k] ??= []).push(r);
    }
    res.json({
      sheets: rows,
      byDiscipline,
      disciplines: SHEET_DISCIPLINES,
    });
  },
);

// =====================================================================
// Task #2466 Phase 2 (groundwork) — Assemblies catalog CRUD.
// =====================================================================
router.get(
  `${estimatorBase}/assemblies`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const out = await listAssemblies(req.user!.organizationId!, { search });
    res.json({ assemblies: out });
  },
);

router.get(
  `${estimatorBase}/assemblies/:id`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const out = await getAssembly(req.user!.organizationId!, req.params.id);
    if (!out) return res.status(404).json({ error: "Assembly not found" });
    res.json(out);
  },
);

const createAssemblyBodySchema = z.object({
  assembly: insertAiEstimatorAssemblySchema.omit({ organizationId: true }),
  components: z
    .array(insertAiEstimatorAssemblyComponentSchema.omit({ assemblyId: true }))
    .default([]),
});
router.post(
  `${estimatorBase}/assemblies`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(createAssemblyBodySchema, req.body, res);
    if (!data) return;
    try {
      const out = await createAssembly(
        {
          ...data.assembly,
          organizationId: req.user!.organizationId!,
          createdById: req.user!.id,
        },
        data.components,
      );
      await logCreate(
        req.user!.id,
        "ai_estimator_assembly",
        out.id,
        { name: out.name },
        req,
      );
      res.status(201).json(out);
    } catch (err) {
      logError("createAssembly failed", { error: String(err) });
      res.status(500).json({ error: "Could not create assembly" });
    }
  },
);

router.put(
  `${estimatorBase}/assemblies/:id`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const patch = validateBody(
      insertAiEstimatorAssemblySchema.partial().omit({ organizationId: true }),
      req.body,
      res,
    );
    if (!patch) return;
    const out = await updateAssembly(
      req.user!.organizationId!,
      req.params.id,
      patch,
    );
    if (!out) return res.status(404).json({ error: "Assembly not found" });
    res.json(out);
  },
);

router.delete(
  `${estimatorBase}/assemblies/:id`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    await deleteAssembly(req.user!.organizationId!, req.params.id);
    await logDelete(req.user!.id, "ai_estimator_assembly", req.params.id, {}, req);
    res.status(204).send();
  },
);

// =====================================================================
// Task #2466 Phase 2 (groundwork) — Org-level estimating factors.
// =====================================================================
router.get(
  `${estimatorBase}/org-factors`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const row = await getOrgFactors(req.user!.organizationId!);
    res.json(row);
  },
);

router.put(
  `${estimatorBase}/org-factors`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const patch = validateBody(
      insertAiEstimatorOrgFactorsSchema.partial().omit({ organizationId: true }),
      req.body,
      res,
    );
    if (!patch) return;
    const row = await upsertOrgFactors(
      req.user!.organizationId!,
      patch,
      req.user!.id,
    );
    res.json(row);
  },
);

// =====================================================================
// Task #2466 Phase 1 — Legend symbols storage (parser is a follow-up).
// =====================================================================
router.get(
  `${estimatorBase}/bids/:bidId/legend-symbols`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const rows = await listLegendSymbolsForBid(
      req.user!.organizationId!,
      req.params.bidId,
    );
    res.json({ symbols: rows });
  },
);

router.post(
  `${estimatorBase}/bids/:bidId/legend-symbols`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const body = validateBody(
      insertAiEstimatorLegendSymbolSchema.omit({
        organizationId: true,
        bidId: true,
      }),
      req.body,
      res,
    );
    if (!body) return;
    const row = await upsertLegendSymbol({
      ...body,
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
    });
    res.status(201).json(row);
  },
);

router.delete(
  `${estimatorBase}/legend-symbols/:id`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    await deleteLegendSymbol(req.user!.organizationId!, req.params.id);
    res.status(204).send();
  },
);

// =====================================================================
// Task #2577 Phase B Step 1 — Trade material templates.
// =====================================================================
router.get(
  `${estimatorBase}/trade-templates`,
  requireAuth,
  requireEstimatorAccess,
  async (_req: AuthRequest, res: Response) => {
    res.json({ templates: listTradeTemplates() });
  },
);

const applyTemplateSchema = z.object({
  quantity: z.number().nonnegative(),
  options: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
});

router.post(
  `${estimatorBase}/trade-templates/:id/apply`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(applyTemplateSchema, req.body, res);
    if (!data) return;
    try {
      const out = applyTradeTemplate(req.params.id, {
        quantity: data.quantity,
        options: data.options as Record<string, number | string | boolean | undefined | null> | undefined,
      });
      if (!out) return res.status(404).json({ error: "Trade template not found" });
      res.json(out);
    } catch (err) {
      logError("trade-template apply failed", { id: req.params.id, error: String(err) });
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to apply template" });
    }
  },
);

// Task #2577 Phase B Step 1 — write template line items into the bid's
// takeoff as DRAFT measurements so estimators can pick a template from
// the takeoff workspace and immediately see primary + accessory rows
// in their measurement list. The estimator can then re-classify any
// row (LINEAR/AREA) or accept-as-is via the normal review queue.
const applyTemplateToBidSchema = z.object({
  bidId: z.string().min(1),
  quantity: z.number().nonnegative(),
  options: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
  sheetId: z.string().min(1).optional(),
});

router.post(
  `${estimatorBase}/trade-templates/:id/apply-to-bid`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(applyTemplateToBidSchema, req.body, res);
    if (!data) return;
    try {
      const out = await applyTradeTemplateToBid({
        organizationId: req.user!.organizationId!,
        bidId: data.bidId,
        templateId: req.params.id,
        quantity: data.quantity,
        options: data.options as Record<string, number | string | boolean | undefined | null> | undefined,
        sheetId: data.sheetId,
      });
      res.json(out);
    } catch (err) {
      logError("trade-template apply-to-bid failed", { id: req.params.id, error: String(err) });
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to apply template" });
    }
  },
);

// =====================================================================
// Task #2577 Phase B Step 2 — Map-reduce drafter for large plan sets.
// =====================================================================
const mapReduceDraftSchema = z.object({
  bidId: z.string().min(1),
  disciplines: z.array(z.string()).optional(),
});

router.post(
  `${estimatorBase}/draft/map-reduce`,
  sensitiveLimiter,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(mapReduceDraftSchema, req.body, res);
    if (!data) return;
    const out = await mapReduceDraftFromPlans({
      organizationId: req.user!.organizationId!,
      userId: req.user!.id,
      bidId: data.bidId,
      disciplines: data.disciplines,
    });
    if (out.blocked) return blockedResponse(res, out.reason);
    if (!out.result) return res.status(400).json({ error: out.reason || "Map-reduce draft produced no result" });
    res.json(out.result);
  },
);

// Cache per-page extracted text on takeoff_sheets — also runs OCR
// fallback on raster pages when an OCR provider is registered.
router.post(
  `${estimatorBase}/bids/:bidId/cache-page-text`,
  sensitiveLimiter,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const out = await cachePageTextOnSheets({
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
    });
    res.json(out);
  },
);

// =====================================================================
// Task #2577 Phase B Step 4 — Schedule symbol auto-counting.
// =====================================================================
router.post(
  `${estimatorBase}/bids/:bidId/schedule-symbols/extract`,
  sensitiveLimiter,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const out = await extractScheduleSymbolsForBid({
      organizationId: req.user!.organizationId!,
      userId: req.user!.id,
      bidId: req.params.bidId,
    });
    if (out.blocked) return blockedResponse(res, out.reason);
    res.json({
      extracted: out.extracted,
      candidateSheets: out.candidateSheets,
      reason: out.reason,
    });
  },
);

router.get(
  `${estimatorBase}/bids/:bidId/schedule-symbols`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const rows = await listScheduleSymbolsForBid({
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
    });
    res.json({ symbols: rows });
  },
);

const acceptScheduleSchema = z.object({
  symbolIds: z.array(z.string().min(1)).min(1),
});

router.post(
  `${estimatorBase}/bids/:bidId/schedule-symbols/accept`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(acceptScheduleSchema, req.body, res);
    if (!data) return;
    const out = await acceptScheduleSymbols({
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
      symbolIds: data.symbolIds,
    });
    res.json(out);
  },
);

const rejectScheduleSchema = z.object({
  symbolIds: z.array(z.string().min(1)).min(1),
});

router.post(
  `${estimatorBase}/bids/:bidId/schedule-symbols/reject`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(rejectScheduleSchema, req.body, res);
    if (!data) return;
    const out = await rejectScheduleSymbols({
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
      symbolIds: data.symbolIds,
    });
    res.json(out);
  },
);

const editScheduleSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  code: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
}).refine((v) => v.count !== undefined || v.code !== undefined || v.description !== undefined, {
  message: "At least one of count / code / description must be provided",
});

router.patch(
  `${estimatorBase}/bids/:bidId/schedule-symbols/:symbolId`,
  requireAuth,
  requireEstimatorAccess,
  async (req: AuthRequest, res: Response) => {
    const data = validateBody(editScheduleSchema, req.body, res);
    if (!data) return;
    const updated = await editScheduleSymbol({
      organizationId: req.user!.organizationId!,
      bidId: req.params.bidId,
      symbolId: req.params.symbolId,
      updates: data,
    });
    if (!updated) return res.status(404).json({ error: "Schedule symbol not found" });
    res.json({ symbol: updated });
  },
);

export default router;
