/**
 * Task #2415 — Qualitative-lesson generator.
 *
 * Watches EDIT-type feedback events and asks Claude (via the routed
 * provider) to write a short, structured "lesson" capturing the user's
 * correction. The lesson is persisted as a `qualitative_lesson` row in
 * `ai_estimator_knowledge_index` and surfaced into future estimator
 * prompts via `retrieveLessons`.
 *
 * Design notes:
 *   - Fire-and-forget from `recordFeedback` — never throws back to the
 *     caller. Lesson generation must never break the user's feedback
 *     write.
 *   - Gated by `AI_PROVIDER_TAKEOFF` so behaviour for non-flagged orgs
 *     is unchanged.
 *   - JSON-mode + ≤300 tokens to keep cost bounded.
 *   - Dedup by `(organizationId, lessonScope, costCode|tradeType|surface,
 *     contentHash)`. If a different lesson already exists in the same
 *     bucket, the new lesson supersedes it and the old row is marked
 *     `lessonStatus='stale'` (no hard deletes).
 */

import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiActionAudit,
  aiEstimatorKnowledgeIndex,
  aiEstimatorLearnedRates,
  type AiEstimatorKnowledgeIndex,
} from "@shared/schema";
import { governedAiCall } from "../aiGovernance";
import { routedChatCompletion } from "../../ai/providers";
import { summarizeRate, type RateMetric } from "./learnedRates";
import { isFeatureEnabled } from "../featureFlagService";
import { logError, logInfo, logWarn } from "../../utils/logger";

export type LessonScope = "global" | "cost_code" | "trade" | "surface";
export type LessonStatus = "active" | "stale" | "deleted";

interface LessonModelOutput {
  lesson: string;
  scope: LessonScope;
  costCode?: string | null;
  tradeType?: string | null;
  biasFactor?: number | null;
  confidence?: number | null;
}

const ALLOWED_SCOPES: LessonScope[] = ["global", "cost_code", "trade", "surface"];

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function hashLesson(parts: { lesson: string; scope: string; bucketKey: string }): string {
  return crypto
    .createHash("sha256")
    .update(`${parts.scope}|${parts.bucketKey}|${parts.lesson.trim().toLowerCase()}`)
    .digest("hex");
}

function bucketKeyFor(out: LessonModelOutput, surface: string): string {
  switch (out.scope) {
    case "cost_code":
      return out.costCode ?? "";
    case "trade":
      return out.tradeType ?? "";
    case "surface":
      return surface;
    case "global":
    default:
      return "global";
  }
}

/**
 * Returns true if a lesson row for this feedback event already exists
 * (any status). Prevents duplicate writes when the lesson job is
 * retried for the same event.
 */
async function lessonExistsForFeedback(
  organizationId: string,
  feedbackEventId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: aiEstimatorKnowledgeIndex.id })
    .from(aiEstimatorKnowledgeIndex)
    .where(
      and(
        eq(aiEstimatorKnowledgeIndex.organizationId, organizationId),
        eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
        sql`${aiEstimatorKnowledgeIndex.derivedFromFeedbackIds} @> ${JSON.stringify([feedbackEventId])}::jsonb`,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Look up the most recent active lesson in the same bucket so we can
 * either no-op (same hash) or supersede (different hash, same bucket).
 */
async function findActiveLessonInBucket(opts: {
  organizationId: string;
  scope: LessonScope;
  costCode: string | null;
  tradeType: string | null;
  surface: string | null;
}): Promise<AiEstimatorKnowledgeIndex | null> {
  const conds = [
    eq(aiEstimatorKnowledgeIndex.organizationId, opts.organizationId),
    eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
    eq(aiEstimatorKnowledgeIndex.lessonStatus, "active"),
    eq(aiEstimatorKnowledgeIndex.lessonScope, opts.scope),
  ];
  if (opts.scope === "cost_code") {
    if (!opts.costCode) return null;
    conds.push(eq(aiEstimatorKnowledgeIndex.costCode, opts.costCode));
  } else if (opts.scope === "trade") {
    if (!opts.tradeType) return null;
    conds.push(eq(aiEstimatorKnowledgeIndex.tradeType, opts.tradeType));
  } else if (opts.scope === "surface") {
    if (!opts.surface) return null;
    conds.push(eq(aiEstimatorKnowledgeIndex.lessonSurface, opts.surface));
  }
  const [row] = await db
    .select()
    .from(aiEstimatorKnowledgeIndex)
    .where(and(...conds))
    .orderBy(sql`${aiEstimatorKnowledgeIndex.indexedAt} desc`)
    .limit(1);
  return row ?? null;
}

interface FeedbackLike {
  id: string;
  organizationId: string;
  userId: string | null;
  surface: string;
  outcome: string;
  costCode: string | null;
  tradeType: string | null;
  originalValue: unknown;
  finalValue: unknown;
  comment: string | null;
  aiAuditId: string | null;
}

function metricFromSurface(surface: string): RateMetric | null {
  if (surface === "inline_unit_cost") return "unit_cost";
  if (surface === "inline_labor_hours") return "labor_hours_per_unit";
  if (surface === "inline_production_rate") return "production_rate";
  return null;
}

/**
 * Generate a qualitative lesson from an EDIT-type feedback event. Safe
 * to call from a fire-and-forget context — never throws.
 */
export async function generateLessonFromFeedback(
  event: FeedbackLike,
): Promise<AiEstimatorKnowledgeIndex | null> {
  try {
    if (event.outcome !== "EDITED") return null;

    // Dedup: if we already wrote a lesson for this exact event, skip.
    if (await lessonExistsForFeedback(event.organizationId, event.id)) {
      return null;
    }

    // Pull the originating audit row (if any) to give the model a hint
    // about which AI surface produced the original suggestion.
    let auditRationale: string | null = null;
    let auditModel: string | null = null;
    if (event.aiAuditId) {
      const [audit] = await db
        .select({
          rationale: aiActionAudit.rationale,
          model: aiActionAudit.model,
        })
        .from(aiActionAudit)
        .where(eq(aiActionAudit.id, event.aiAuditId))
        .limit(1);
      if (audit) {
        auditRationale = audit.rationale ?? null;
        auditModel = audit.model ?? null;
      }
    }

    // Pull the matching learned-rate (if surface is rate-bearing) so
    // the model can quote the org's percentile range when suggesting
    // a bias factor.
    let rateContext:
      | (ReturnType<typeof summarizeRate> & { metric: RateMetric; unit: string })
      | null = null;
    const metric = metricFromSurface(event.surface);
    if (metric && event.costCode) {
      // We don't know the unit on the feedback row but learned-rates are
      // keyed by (costCode, metric, unit). Pull the largest-sample row
      // for this bucket so the model can quote the org's percentile range.
      const [row] = await db
        .select()
        .from(aiEstimatorLearnedRates)
        .where(
          and(
            eq(aiEstimatorLearnedRates.organizationId, event.organizationId),
            eq(aiEstimatorLearnedRates.costCode, event.costCode),
            eq(aiEstimatorLearnedRates.metric, metric),
          ),
        )
        .orderBy(sql`${aiEstimatorLearnedRates.sampleSize} desc`)
        .limit(1);
      if (row) {
        const summary = summarizeRate(row);
        rateContext = { ...summary, metric, unit: row.unit };
      }
    }

    const sysPrompt = `You write SHORT, ACTIONABLE estimating "lessons" from a single user correction.
Lessons are surfaced into future AI Estimator prompts so the model learns the org's preferences.
Rules:
- One sentence, ≤200 characters. No hedging.
- If you can express it as a numeric bias (e.g. "+12% bias on cost code 03-30-00 mobilization for jobs under $500K"), do that.
- Otherwise write a clear prose rule (e.g. "User typically excludes weekend overtime from labor hours").
- Pick the tightest scope that still describes the intent: cost_code > trade > surface > global.
- Set biasFactor as a multiplier (e.g. 1.12 for +12%, 0.85 for -15%) ONLY when the edit is a single numeric value vs the AI's original. Otherwise null.
- confidence is 0..1. Be conservative — single-event lessons should be ≤0.6.
Return strict JSON: {"lesson": string, "scope": "global"|"cost_code"|"trade"|"surface", "costCode": string|null, "tradeType": string|null, "biasFactor": number|null, "confidence": number}`;

    const userPayload = JSON.stringify({
      surface: event.surface,
      costCode: event.costCode,
      tradeType: event.tradeType,
      originalAiValue: event.originalValue,
      userFinalValue: event.finalValue,
      userComment: event.comment,
      originatingAi: { rationale: auditRationale, model: auditModel },
      currentLearnedRate: rateContext,
    });

    const gov = await governedAiCall<string | null>({
      orgId: event.organizationId,
      userId: event.userId,
      actionType: "ai_estimator.lesson",
      inputRefs: { feedbackEventId: event.id, surface: event.surface },
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId: event.organizationId,
          featureKey: "ai_estimator.lesson",
          request: {
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: userPayload },
            ],
            max_completion_tokens: 300,
            response_format: { type: "json_object" },
          },
        });
        return { result: completion.choices[0]?.message?.content ?? null, completion };
      },
    });

    if (gov.blocked || !gov.result) {
      logInfo("Lesson generation skipped (blocked or empty)", {
        feedbackEventId: event.id,
        blocked: gov.blocked === true,
      });
      return null;
    }

    const parsed = safeJson<LessonModelOutput>(gov.result);
    if (!parsed || typeof parsed.lesson !== "string" || !parsed.lesson.trim()) {
      logWarn("Lesson generator returned non-conforming JSON", {
        feedbackEventId: event.id,
        rawSnippet: gov.result.slice(0, 120),
      });
      return null;
    }

    const scope: LessonScope = ALLOWED_SCOPES.includes(parsed.scope)
      ? parsed.scope
      : "global";
    // Coerce nulls so the bucket lookup matches what we'll actually persist.
    let lessonCostCode = scope === "cost_code"
      ? (parsed.costCode ?? event.costCode ?? null)
      : null;
    let lessonTradeType = scope === "trade"
      ? (parsed.tradeType ?? event.tradeType ?? null)
      : null;
    const lessonSurface = scope === "surface" ? event.surface : null;

    // If the model picked cost_code/trade but the dimension is missing,
    // fall back to global so we still capture the lesson.
    let effectiveScope: LessonScope = scope;
    if (scope === "cost_code" && !lessonCostCode) effectiveScope = "global";
    if (scope === "trade" && !lessonTradeType) effectiveScope = "global";
    if (effectiveScope === "global") {
      lessonCostCode = null;
      lessonTradeType = null;
    }

    const cleanLesson = parsed.lesson.trim().slice(0, 240);
    const bucketKey = bucketKeyFor({ ...parsed, scope: effectiveScope }, event.surface);
    const contentHash = hashLesson({ lesson: cleanLesson, scope: effectiveScope, bucketKey });

    // Dedup + supersede: look up an existing active lesson in the same
    // bucket. If hashes match, no-op. Otherwise mark the existing one
    // stale and link the new one with `supersedesRowId`.
    const existing = await findActiveLessonInBucket({
      organizationId: event.organizationId,
      scope: effectiveScope,
      costCode: lessonCostCode,
      tradeType: lessonTradeType,
      surface: lessonSurface,
    });
    if (existing && existing.contentHash === contentHash) {
      logInfo("Lesson dedup hit (same content hash) — no-op", {
        feedbackEventId: event.id,
        existingLessonId: existing.id,
      });
      return existing;
    }

    const supersedesRowId = existing ? existing.id : null;
    const derivedFromFeedbackIds = existing
      ? [
          ...(Array.isArray(existing.derivedFromFeedbackIds)
            ? (existing.derivedFromFeedbackIds as string[])
            : []),
          event.id,
        ]
      : [event.id];

    const sourceId = `lesson:${event.id}`;
    const title = `Lesson: ${effectiveScope === "cost_code" ? lessonCostCode : effectiveScope === "trade" ? lessonTradeType : effectiveScope === "surface" ? event.surface : "org-wide"}`;

    const numericFacets =
      typeof parsed.biasFactor === "number" && Number.isFinite(parsed.biasFactor)
        ? {
            biasFactor: parsed.biasFactor,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
          }
        : typeof parsed.confidence === "number"
          ? { confidence: parsed.confidence }
          : null;

    let inserted: AiEstimatorKnowledgeIndex | null = null;
    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(aiEstimatorKnowledgeIndex)
          .set({ lessonStatus: "stale" })
          .where(eq(aiEstimatorKnowledgeIndex.id, existing.id));
      }
      const [row] = await tx
        .insert(aiEstimatorKnowledgeIndex)
        .values({
          organizationId: event.organizationId,
          sourceType: "qualitative_lesson",
          sourceId,
          bidId: null,
          projectId: null,
          costCode: lessonCostCode,
          tradeType: lessonTradeType,
          title,
          contentSnippet: cleanLesson,
          tags: [
            effectiveScope,
            event.surface,
            lessonCostCode,
            lessonTradeType,
          ].filter((v): v is string => !!v),
          numericFacets,
          contentHash,
          lessonScope: effectiveScope,
          lessonStatus: "active",
          lessonSurface,
          supersedesRowId,
          derivedFromFeedbackIds,
        })
        .returning();
      inserted = row;
    });

    logInfo("Qualitative lesson recorded", {
      organizationId: event.organizationId,
      feedbackEventId: event.id,
      scope: effectiveScope,
      supersedesRowId,
      hasBias: typeof parsed.biasFactor === "number",
    });
    return inserted;
  } catch (err) {
    logError("Lesson generation failed", {
      feedbackEventId: event.id,
      organizationId: event.organizationId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Fire-and-forget wrapper — checks the AI_PROVIDER_TAKEOFF flag, then
 * schedules generation. Always resolves; never throws.
 */
export async function maybeEnqueueLessonGeneration(
  event: FeedbackLike,
): Promise<void> {
  if (event.outcome !== "EDITED") return;
  try {
    const flagOn = await isFeatureEnabled(event.organizationId, "AI_PROVIDER_TAKEOFF");
    if (!flagOn) return;
  } catch (err) {
    logWarn("Lesson flag check failed; skipping", {
      feedbackEventId: event.id,
      error: String(err),
    });
    return;
  }
  // Fire-and-forget. The generator itself swallows its own errors.
  void generateLessonFromFeedback(event).catch((err) => {
    logError("Background lesson job rejected unexpectedly", {
      feedbackEventId: event.id,
      error: String(err),
    });
  });
}

// =====================================================================
// Admin-facing helpers used by the Lessons Learned panel on AI Settings.
// =====================================================================

export interface LessonListFilters {
  organizationId: string;
  costCode?: string | null;
  tradeType?: string | null;
  surface?: string | null;
  /** Default true — when false, includes stale + deleted rows for audit views. */
  activeOnly?: boolean;
  limit?: number;
}

export async function listLessons(
  filters: LessonListFilters,
): Promise<AiEstimatorKnowledgeIndex[]> {
  const conds = [
    eq(aiEstimatorKnowledgeIndex.organizationId, filters.organizationId),
    eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
  ];
  const activeOnly = filters.activeOnly !== false;
  if (activeOnly) {
    conds.push(eq(aiEstimatorKnowledgeIndex.lessonStatus, "active"));
  }
  if (filters.costCode) {
    conds.push(eq(aiEstimatorKnowledgeIndex.costCode, filters.costCode));
  }
  if (filters.tradeType) {
    conds.push(eq(aiEstimatorKnowledgeIndex.tradeType, filters.tradeType));
  }
  if (filters.surface) {
    conds.push(eq(aiEstimatorKnowledgeIndex.lessonSurface, filters.surface));
  }
  return db
    .select()
    .from(aiEstimatorKnowledgeIndex)
    .where(and(...conds))
    .orderBy(sql`${aiEstimatorKnowledgeIndex.indexedAt} desc`)
    .limit(Math.min(filters.limit ?? 100, 500));
}

/** Soft-delete a lesson by id. Returns the updated row or null if not found. */
export async function softDeleteLesson(
  organizationId: string,
  lessonId: string,
): Promise<AiEstimatorKnowledgeIndex | null> {
  const [row] = await db
    .update(aiEstimatorKnowledgeIndex)
    .set({ lessonStatus: "deleted" })
    .where(
      and(
        eq(aiEstimatorKnowledgeIndex.id, lessonId),
        eq(aiEstimatorKnowledgeIndex.organizationId, organizationId),
        eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
      ),
    )
    .returning();
  return row ?? null;
}
