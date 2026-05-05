// Task #2341 — Shared aggregation helper for the AI takeoff accuracy
// dashboard. Extracted from `aiTakeoffFeatureRoutes.ts` so the org-wide
// admin endpoint and the per-user "My AI accuracy" panel can share the
// same SQL/aggregation paths instead of duplicating them.

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { aiTakeoffSuggestions, aiTakeoffConfidenceCalibration } from "@shared/schema";

export interface AccuracyAggregateOptions {
  organizationId: string;
  /** Window length in days. Caller is responsible for clamping. */
  days: number;
  /**
   * When provided, scopes every aggregation to suggestions reviewed by this
   * user. PENDING rows are naturally excluded because they have no reviewer.
   */
  reviewedByUserId?: string;
}

export interface AccuracyTotals {
  PENDING: number;
  ACCEPTED: number;
  REJECTED: number;
  EDITED: number;
}

export interface AccuracyByTrade {
  tradeType: string;
  accepted: number;
  edited: number;
  rejected: number;
  pending: number;
  accuracy: number;
}

export interface AccuracyByBucket {
  bucket: number;
  accepted: number;
  edited: number;
  rejected: number;
  accuracy: number;
}

export interface AccuracyTrendPoint {
  day: string;
  accepted: number;
  rejected: number;
  accuracy: number;
}

export interface AccuracyRejectReason {
  reason: string;
  count: number;
}

export interface AccuracyAggregate {
  windowDays: number;
  totals: AccuracyTotals;
  reviewed: number;
  accuracy: number;
  accuracyByTrade: AccuracyByTrade[];
  accuracyByBucket: AccuracyByBucket[];
  trend: AccuracyTrendPoint[];
  rejectReasons: AccuracyRejectReason[];
  // Task #2391 — most recent `updated_at` across the org's confidence
  // calibration rows, so the dashboard can render "last calibrated 2h ago"
  // and visually flag stale calibrations (>48h) when the nightly job has
  // failed to run. `null` means the org has never been calibrated.
  lastCalibratedAt: string | null;
}

// In org-wide mode the existing dashboard buckets by `created_at` so the
// "PENDING" row reflects suggestions still awaiting review. In per-user mode
// pending suggestions aren't personally meaningful (they have no reviewer
// yet), so we filter and bucket by `reviewed_at` and skip the `created_at`
// path entirely.
export async function computeAiTakeoffAccuracy(
  opts: AccuracyAggregateOptions,
): Promise<AccuracyAggregate> {
  const { organizationId, days, reviewedByUserId } = opts;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const personal = !!reviewedByUserId;

  const baseConds = [eq(aiTakeoffSuggestions.organizationId, organizationId)];
  if (personal) {
    baseConds.push(eq(aiTakeoffSuggestions.reviewedByUserId, reviewedByUserId!));
    baseConds.push(gte(aiTakeoffSuggestions.reviewedAt, since));
  } else {
    baseConds.push(gte(aiTakeoffSuggestions.createdAt, since));
  }
  const baseWhere = and(...baseConds);

  // Status breakdown
  const statusRows = await db.select({
    status: aiTakeoffSuggestions.status,
    count: sql<number>`count(*)::int`,
  })
    .from(aiTakeoffSuggestions)
    .where(baseWhere)
    .groupBy(aiTakeoffSuggestions.status);

  const totals: AccuracyTotals = { PENDING: 0, ACCEPTED: 0, REJECTED: 0, EDITED: 0 };
  for (const r of statusRows) {
    if (r.status in totals) totals[r.status as keyof AccuracyTotals] = Number(r.count);
  }
  const reviewed = totals.ACCEPTED + totals.REJECTED + totals.EDITED;
  // Accuracy = (accepted + edited) / reviewed. Edits still count as
  // "model was directionally right" — they're not full rejects.
  const accuracy = reviewed > 0
    ? (totals.ACCEPTED + totals.EDITED) / reviewed
    : 0;

  // Per-trade
  const tradeRows = await db.select({
    tradeType: aiTakeoffSuggestions.tradeType,
    status: aiTakeoffSuggestions.status,
    count: sql<number>`count(*)::int`,
  })
    .from(aiTakeoffSuggestions)
    .where(baseWhere)
    .groupBy(aiTakeoffSuggestions.tradeType, aiTakeoffSuggestions.status);

  const byTrade = new Map<string, { accepted: number; edited: number; rejected: number; pending: number }>();
  for (const r of tradeRows) {
    const t = r.tradeType as string;
    if (!byTrade.has(t)) byTrade.set(t, { accepted: 0, edited: 0, rejected: 0, pending: 0 });
    const slot = byTrade.get(t)!;
    const c = Number(r.count);
    if (r.status === "ACCEPTED") slot.accepted = c;
    else if (r.status === "EDITED") slot.edited = c;
    else if (r.status === "REJECTED") slot.rejected = c;
    else if (r.status === "PENDING") slot.pending = c;
  }
  const accuracyByTrade: AccuracyByTrade[] = Array.from(byTrade.entries())
    .map(([tradeType, s]) => {
      const r = s.accepted + s.edited + s.rejected;
      return {
        tradeType,
        accepted: s.accepted,
        edited: s.edited,
        rejected: s.rejected,
        pending: s.pending,
        accuracy: r > 0 ? (s.accepted + s.edited) / r : 0,
      };
    })
    .sort((a, b) => (b.accepted + b.edited + b.rejected) - (a.accepted + a.edited + a.rejected));

  // Per-confidence-bucket — same 60/70/80/90 buckets as the calibration table
  // so the dashboard maps 1:1 to what the nightly job writes.
  const bucketRows = personal
    ? await db.execute(sql`
        SELECT CASE
                 WHEN confidence >= 90 THEN 90
                 WHEN confidence >= 80 THEN 80
                 WHEN confidence >= 70 THEN 70
                 ELSE 60
               END AS bucket,
               status,
               count(*)::int AS count
          FROM ai_takeoff_suggestions
         WHERE organization_id = ${organizationId}
           AND reviewed_by_user_id = ${reviewedByUserId}
           AND reviewed_at >= ${since}
         GROUP BY bucket, status
      `)
    : await db.execute(sql`
        SELECT CASE
                 WHEN confidence >= 90 THEN 90
                 WHEN confidence >= 80 THEN 80
                 WHEN confidence >= 70 THEN 70
                 ELSE 60
               END AS bucket,
               status,
               count(*)::int AS count
          FROM ai_takeoff_suggestions
         WHERE organization_id = ${organizationId}
           AND created_at >= ${since}
         GROUP BY bucket, status
      `);
  const byBucket = new Map<number, { accepted: number; edited: number; rejected: number; pending: number }>();
  for (const r of (bucketRows.rows as Array<{ bucket: number; status: string; count: number }>)) {
    const b = Number(r.bucket);
    if (!byBucket.has(b)) byBucket.set(b, { accepted: 0, edited: 0, rejected: 0, pending: 0 });
    const slot = byBucket.get(b)!;
    const c = Number(r.count);
    if (r.status === "ACCEPTED") slot.accepted = c;
    else if (r.status === "EDITED") slot.edited = c;
    else if (r.status === "REJECTED") slot.rejected = c;
    else if (r.status === "PENDING") slot.pending = c;
  }
  const accuracyByBucket: AccuracyByBucket[] = [60, 70, 80, 90].map((b) => {
    const s = byBucket.get(b) ?? { accepted: 0, edited: 0, rejected: 0, pending: 0 };
    const r = s.accepted + s.edited + s.rejected;
    return {
      bucket: b,
      accepted: s.accepted,
      edited: s.edited,
      rejected: s.rejected,
      accuracy: r > 0 ? (s.accepted + s.edited) / r : 0,
    };
  });

  // Daily trendline (reviewed only). Always uses `reviewed_at` regardless of
  // mode because the trend is about completed reviews.
  const trendRows = personal
    ? await db.execute(sql`
        SELECT to_char(date_trunc('day', reviewed_at), 'YYYY-MM-DD') AS day,
               sum(CASE WHEN status IN ('ACCEPTED', 'EDITED') THEN 1 ELSE 0 END)::int AS accepted,
               sum(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected
          FROM ai_takeoff_suggestions
         WHERE organization_id = ${organizationId}
           AND reviewed_by_user_id = ${reviewedByUserId}
           AND reviewed_at IS NOT NULL
           AND reviewed_at >= ${since}
         GROUP BY day
         ORDER BY day ASC
      `)
    : await db.execute(sql`
        SELECT to_char(date_trunc('day', reviewed_at), 'YYYY-MM-DD') AS day,
               sum(CASE WHEN status IN ('ACCEPTED', 'EDITED') THEN 1 ELSE 0 END)::int AS accepted,
               sum(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected
          FROM ai_takeoff_suggestions
         WHERE organization_id = ${organizationId}
           AND reviewed_at IS NOT NULL
           AND reviewed_at >= ${since}
         GROUP BY day
         ORDER BY day ASC
      `);
  const trend: AccuracyTrendPoint[] = (trendRows.rows as Array<{ day: string; accepted: number; rejected: number }>)
    .map((r) => {
      const total = Number(r.accepted) + Number(r.rejected);
      return {
        day: r.day,
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
        accuracy: total > 0 ? Number(r.accepted) / total : 0,
      };
    });

  // Top reject reasons
  const reasonRows = await db.select({
    reason: aiTakeoffSuggestions.rejectReason,
    count: sql<number>`count(*)::int`,
  })
    .from(aiTakeoffSuggestions)
    .where(and(
      baseWhere,
      eq(aiTakeoffSuggestions.status, "REJECTED"),
      isNotNull(aiTakeoffSuggestions.rejectReason),
    ))
    .groupBy(aiTakeoffSuggestions.rejectReason);
  const rejectReasons: AccuracyRejectReason[] = reasonRows
    .filter((r) => r.reason !== null)
    .map((r) => ({ reason: r.reason as string, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);

  // Task #2391 — surface the most recent calibration `updated_at` so the
  // dashboard can render "last calibrated Xh ago" and badge stale rows.
  // Org-wide max is sufficient for the headline indicator; per-trade
  // freshness can layer on top of `accuracyByTrade` later if the design
  // calls for it.
  const [calibRow] = await db
    .select({
      lastCalibratedAt: sql<Date | null>`max(${aiTakeoffConfidenceCalibration.updatedAt})`,
    })
    .from(aiTakeoffConfidenceCalibration)
    .where(eq(aiTakeoffConfidenceCalibration.organizationId, organizationId));
  const lastCalibratedAt =
    calibRow?.lastCalibratedAt instanceof Date
      ? calibRow.lastCalibratedAt.toISOString()
      : null;

  return {
    windowDays: days,
    totals,
    reviewed,
    accuracy,
    accuracyByTrade,
    accuracyByBucket,
    trend,
    rejectReasons,
    lastCalibratedAt,
  };
}
