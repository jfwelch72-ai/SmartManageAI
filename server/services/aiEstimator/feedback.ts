import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorFeedbackEvents,
  type AiEstimatorFeedbackEvent,
  type InsertAiEstimatorFeedbackEvent,
} from "@shared/schema";
import { recordRateSample, type RateMetric } from "./learnedRates";
import { logError } from "../../utils/logger";

export type FeedbackOutcome =
  | "ACCEPTED"
  | "EDITED"
  | "REJECTED"
  | "THUMBS_UP"
  | "THUMBS_DOWN";

export type FeedbackSurface =
  | "takeoff_draft"
  | "estimate_draft"
  | "inline_unit_cost"
  | "inline_labor_hours"
  | "inline_production_rate"
  | "chat_answer"
  | "web_research";

export interface RecordFeedbackInput
  extends Omit<InsertAiEstimatorFeedbackEvent, "outcome" | "surface"> {
  surface: FeedbackSurface;
  outcome: FeedbackOutcome;
  /** When set, the rate sample is upserted into the learned-rates store. */
  rateSample?: {
    metric: RateMetric;
    unit: string;
    value: number;
  };
}

export async function recordFeedback(
  input: RecordFeedbackInput,
): Promise<AiEstimatorFeedbackEvent> {
  const [event] = await db
    .insert(aiEstimatorFeedbackEvents)
    .values({
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      surface: input.surface,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      bidId: input.bidId ?? null,
      estimateId: input.estimateId ?? null,
      projectId: input.projectId ?? null,
      takeoffSheetId: input.takeoffSheetId ?? null,
      costCode: input.costCode ?? null,
      tradeType: input.tradeType ?? null,
      outcome: input.outcome,
      originalValue: input.originalValue ?? null,
      finalValue: input.finalValue ?? null,
      comment: input.comment ?? null,
      aiAuditId: input.aiAuditId ?? null,
    })
    .returning();

  if (
    input.rateSample &&
    input.costCode &&
    Number.isFinite(input.rateSample.value) &&
    (input.outcome === "ACCEPTED" || input.outcome === "EDITED")
  ) {
    try {
      await recordRateSample(input.organizationId, {
        costCode: input.costCode,
        metric: input.rateSample.metric,
        unit: input.rateSample.unit,
        value: input.rateSample.value,
        sourceType: "feedback_event",
      });
    } catch (err) {
      logError("Failed to update learned rate from feedback", { error: String(err) });
    }
  }
  return event;
}

export async function listRecentFeedback(
  organizationId: string,
  limit: number = 50,
): Promise<AiEstimatorFeedbackEvent[]> {
  return db
    .select()
    .from(aiEstimatorFeedbackEvents)
    .where(eq(aiEstimatorFeedbackEvents.organizationId, organizationId))
    .orderBy(desc(aiEstimatorFeedbackEvents.createdAt))
    .limit(limit);
}

export interface FeedbackStats {
  totalEvents: number;
  total: number;
  accepted: number;
  edited: number;
  rejected: number;
  acceptanceRate: number;
  bySurface: Record<string, number>;
}

export async function getFeedbackStats(
  organizationId: string,
  sinceDays: number = 30,
): Promise<FeedbackStats> {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const [outcomeRows, surfaceRows] = await Promise.all([
    db
      .select({
        outcome: aiEstimatorFeedbackEvents.outcome,
        count: sql<number>`count(*)::int`,
      })
      .from(aiEstimatorFeedbackEvents)
      .where(
        and(
          eq(aiEstimatorFeedbackEvents.organizationId, organizationId),
          gte(aiEstimatorFeedbackEvents.createdAt, since),
        ),
      )
      .groupBy(aiEstimatorFeedbackEvents.outcome),
    db
      .select({
        surface: aiEstimatorFeedbackEvents.surface,
        count: sql<number>`count(*)::int`,
      })
      .from(aiEstimatorFeedbackEvents)
      .where(
        and(
          eq(aiEstimatorFeedbackEvents.organizationId, organizationId),
          gte(aiEstimatorFeedbackEvents.createdAt, since),
        ),
      )
      .groupBy(aiEstimatorFeedbackEvents.surface),
  ]);

  const stats: FeedbackStats = {
    totalEvents: 0,
    total: 0,
    accepted: 0,
    edited: 0,
    rejected: 0,
    acceptanceRate: 0,
    bySurface: {},
  };
  for (const r of outcomeRows) {
    stats.total += r.count;
    if (r.outcome === "ACCEPTED") stats.accepted += r.count;
    else if (r.outcome === "EDITED") stats.edited += r.count;
    else if (r.outcome === "REJECTED") stats.rejected += r.count;
  }
  stats.totalEvents = stats.total;
  stats.acceptanceRate = stats.total === 0 ? 0 : (stats.accepted + stats.edited) / stats.total;
  for (const r of surfaceRows) {
    stats.bySurface[r.surface] = r.count;
  }
  return stats;
}
