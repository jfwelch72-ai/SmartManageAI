/**
 * Task #718 — Alert engine for the in-process job metrics surface.
 *
 * Reads the rolling 24h window from `jobMetrics.ts`, evaluates two
 * kinds of conditions per job/counter, and emits a notification to
 * every Super Admin when a threshold is crossed:
 *
 *   - `spike`  : last-hour total of a counter exceeds
 *                `threshold * baseline_avg_per_hour` AND meets an
 *                absolute minimum (so "1 vs 0.05 baseline" doesn't
 *                trigger noise).
 *   - `stall`  : a job that has previously published samples has gone
 *                silent for at least `threshold` hours.
 *
 * Rules live in `jobMetricAlertRules` and override the built-in
 * defaults (which apply to every job / every counter when there is no
 * explicit row). Fired alerts are recorded in `jobMetricAlertEvents`
 * so the dashboard can show current alert state and the engine can
 * dedupe — within a rule's `dedupeMinutes` window the same
 * job+counter+kind will not fire twice.
 */

import { db } from "../db";
import { and, desc, eq, gt, gte } from "drizzle-orm";
import {
  jobMetricAlertEvents,
  jobMetricAlertRules,
  users,
  type JobMetricAlertRule,
} from "@shared/schema";
import { getAllJobMetrics, type JobCounters } from "./jobMetrics";
import { logError, logInfo } from "./logger";
import { insertNotifications } from "../services/notificationService";

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SPIKE_MULTIPLIER = 3;
export const DEFAULT_SPIKE_MIN_ABSOLUTE = 5;
export const DEFAULT_STALL_HOURS = 4;
export const DEFAULT_DEDUPE_MINUTES = 60;

export type AlertKind = "spike" | "stall";

export interface JobMetricAlert {
  job: string;
  counter: string | null;
  kind: AlertKind;
  ruleId: string | null;
  message: string;
  observedValue: number | null;
  baselineValue: number | null;
}

interface AlertRuleResolved {
  id: string | null;
  job: string;
  counter: string | null;
  kind: AlertKind;
  threshold: number;
  minAbsolute: number;
  dedupeMinutes: number;
  enabled: boolean;
  isDefault: boolean;
}

let lastEvaluationAt: number | null = null;

/** Test seam — overridable so unit tests can supply their own clock. */
let nowFn: () => number = () => Date.now();
export function setJobMetricAlertsClockForTests(fn: () => number): void {
  nowFn = fn;
}
export function resetJobMetricAlertsClockForTests(): void {
  nowFn = () => Date.now();
}

function toNumber(value: string | number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ruleFromRow(row: JobMetricAlertRule): AlertRuleResolved {
  return {
    id: row.id,
    job: row.job,
    counter: row.counter,
    kind: row.kind === "stall" ? "stall" : "spike",
    threshold: toNumber(row.threshold as unknown as string, 0),
    minAbsolute: row.minAbsolute,
    dedupeMinutes: row.dedupeMinutes,
    enabled: row.enabled,
    isDefault: false,
  };
}

function defaultSpikeRule(job: string, counter: string): AlertRuleResolved {
  return {
    id: null,
    job,
    counter,
    kind: "spike",
    threshold: DEFAULT_SPIKE_MULTIPLIER,
    minAbsolute: DEFAULT_SPIKE_MIN_ABSOLUTE,
    dedupeMinutes: DEFAULT_DEDUPE_MINUTES,
    enabled: true,
    isDefault: true,
  };
}

function defaultStallRule(job: string): AlertRuleResolved {
  return {
    id: null,
    job,
    counter: null,
    kind: "stall",
    threshold: DEFAULT_STALL_HOURS,
    minAbsolute: 0,
    dedupeMinutes: DEFAULT_DEDUPE_MINUTES,
    enabled: true,
    isDefault: true,
  };
}

/**
 * Resolve which rule applies to a (job, kind, counter) combination.
 * The most specific match wins:
 *   1. exact (job, counter, kind)
 *   2. job-wide for that kind (counter = null)
 *   3. wildcard (job = "*"), counter exact then null
 *   4. built-in default
 */
function resolveRule(
  job: string,
  counter: string | null,
  kind: AlertKind,
  rules: JobMetricAlertRule[],
): AlertRuleResolved | null {
  const candidates: Array<{ row: JobMetricAlertRule; specificity: number }> = [];
  for (const r of rules) {
    if (r.kind !== kind) continue;
    const jobMatch = r.job === job ? 2 : r.job === "*" ? 1 : 0;
    if (jobMatch === 0) continue;
    const counterMatch =
      r.counter === counter ? 2 : r.counter === null ? 1 : 0;
    if (kind === "spike" && counterMatch === 0) continue;
    candidates.push({ row: r, specificity: jobMatch * 10 + counterMatch });
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.specificity - a.specificity);
    return ruleFromRow(candidates[0].row);
  }
  if (kind === "spike" && counter) return defaultSpikeRule(job, counter);
  if (kind === "stall") return defaultStallRule(job);
  return null;
}

interface SampleLike {
  timestamp: number;
  counters: JobCounters;
}

/**
 * Sum a counter across samples whose timestamp is in [from, to).
 */
function sumCounter(samples: SampleLike[], counter: string, from: number, to: number): number {
  let total = 0;
  for (const s of samples) {
    if (s.timestamp >= from && s.timestamp < to) {
      const v = s.counters[counter];
      if (typeof v === "number") total += v;
    }
  }
  return total;
}

/**
 * Compute the per-hour baseline for a counter across the prior `n`
 * hourly buckets ending at `endTs`. Returns the average bucket total.
 */
function baselineAvgPerHour(
  samples: SampleLike[],
  counter: string,
  endTs: number,
  buckets: number,
): number {
  if (buckets <= 0) return 0;
  let total = 0;
  for (let i = 0; i < buckets; i++) {
    const to = endTs - i * HOUR_MS;
    const from = to - HOUR_MS;
    total += sumCounter(samples, counter, from, to);
  }
  return total / buckets;
}

interface EvaluateOptions {
  /** Override metrics source — primarily for tests. */
  metricsSource?: () => Array<{
    job: string;
    samples: SampleLike[];
    latest: SampleLike | null;
    totals: JobCounters;
  }>;
}

export interface EvaluateResult {
  evaluatedAt: number;
  jobsScanned: number;
  alertsFired: JobMetricAlert[];
  alertsSuppressed: number;
  notifiedAdmins: number;
}

/**
 * Returns the latest active `snoozedUntil` timestamp for each
 * job/counter/kind key. An admin-issued snooze suppresses re-firing for
 * that key until the timestamp passes, on top of the regular dedupe
 * window.
 */
async function fetchActiveSnoozeLookup(now: number): Promise<Map<string, number>> {
  const cutoff = new Date(now);
  const rows = await db
    .select({
      job: jobMetricAlertEvents.job,
      counter: jobMetricAlertEvents.counter,
      kind: jobMetricAlertEvents.kind,
      snoozedUntil: jobMetricAlertEvents.snoozedUntil,
    })
    .from(jobMetricAlertEvents)
    .where(gt(jobMetricAlertEvents.snoozedUntil, cutoff));

  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.snoozedUntil) continue;
    const key = `${r.job}::${r.counter ?? ""}::${r.kind}`;
    const ts = new Date(r.snoozedUntil).getTime();
    const prev = map.get(key) ?? 0;
    if (ts > prev) map.set(key, ts);
  }
  return map;
}

async function fetchRecentEventLookup(now: number): Promise<Map<string, number>> {
  // Pull the most recent event per job+counter+kind in the last 24h —
  // 24h is the longest dedupe window we expect in practice (default
  // 60 min), so a single bounded query covers all callers.
  const cutoff = new Date(now - 24 * HOUR_MS);
  const rows = await db
    .select({
      job: jobMetricAlertEvents.job,
      counter: jobMetricAlertEvents.counter,
      kind: jobMetricAlertEvents.kind,
      triggeredAt: jobMetricAlertEvents.triggeredAt,
    })
    .from(jobMetricAlertEvents)
    .where(gte(jobMetricAlertEvents.triggeredAt, cutoff))
    .orderBy(desc(jobMetricAlertEvents.triggeredAt));

  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.job}::${r.counter ?? ""}::${r.kind}`;
    if (!map.has(key)) {
      map.set(key, new Date(r.triggeredAt).getTime());
    }
  }
  return map;
}

async function loadSuperAdminIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "SUPER_ADMIN"));
  return rows.map((r) => r.id);
}

/**
 * Evaluate every active rule against the in-memory metrics window and
 * fire alerts where thresholds are crossed. Safe to call from a cron
 * tick or manually from an admin endpoint.
 */
export async function evaluateJobMetricAlerts(
  opts: EvaluateOptions = {},
): Promise<EvaluateResult> {
  const now = nowFn();
  lastEvaluationAt = now;
  const result: EvaluateResult = {
    evaluatedAt: now,
    jobsScanned: 0,
    alertsFired: [],
    alertsSuppressed: 0,
    notifiedAdmins: 0,
  };

  const source = opts.metricsSource ?? (() => getAllJobMetrics());
  const jobs = source();
  result.jobsScanned = jobs.length;
  if (jobs.length === 0) return result;

  let rules: JobMetricAlertRule[] = [];
  try {
    rules = await db.select().from(jobMetricAlertRules).where(eq(jobMetricAlertRules.enabled, true));
  } catch (err) {
    logError("Job metric alerts: failed to load rules", { error: String(err) });
    return result;
  }

  const recentEvents = await fetchRecentEventLookup(now).catch((err) => {
    logError("Job metric alerts: failed to load recent events for dedupe", { error: String(err) });
    return new Map<string, number>();
  });

  const activeSnoozes = await fetchActiveSnoozeLookup(now).catch((err) => {
    logError("Job metric alerts: failed to load active snoozes", { error: String(err) });
    return new Map<string, number>();
  });

  const fired: JobMetricAlert[] = [];
  const eventRows: Array<typeof jobMetricAlertEvents.$inferInsert> = [];

  for (const j of jobs) {
    // ---- Spike checks (per counter) ----
    const counters = new Set<string>();
    for (const c of Object.keys(j.totals)) counters.add(c);
    for (const s of j.samples) for (const c of Object.keys(s.counters)) counters.add(c);

    for (const counter of counters) {
      const rule = resolveRule(j.job, counter, "spike", rules);
      if (!rule || !rule.enabled) continue;

      const lastHour = sumCounter(j.samples, counter, now - HOUR_MS, now);
      const baseline = baselineAvgPerHour(j.samples, counter, now - HOUR_MS, 23);

      if (lastHour < rule.minAbsolute) continue;
      // A non-zero baseline of 0 means we have no comparison data yet —
      // skip rather than firing a divide-by-zero false positive.
      if (baseline <= 0) continue;
      if (lastHour < rule.threshold * baseline) continue;

      const dedupeKey = `${j.job}::${counter}::spike`;
      const snoozedUntil = activeSnoozes.get(dedupeKey);
      if (snoozedUntil && snoozedUntil > now) {
        result.alertsSuppressed++;
        continue;
      }
      const lastFired = recentEvents.get(dedupeKey);
      if (lastFired && now - lastFired < rule.dedupeMinutes * 60 * 1000) {
        result.alertsSuppressed++;
        continue;
      }

      const message = `Counter "${counter}" on job "${j.job}" spiked: ${lastHour} in the last hour vs baseline ${baseline.toFixed(2)}/hr (≥ ${rule.threshold}× baseline${rule.isDefault ? ", default rule" : ""}).`;
      const alert: JobMetricAlert = {
        job: j.job,
        counter,
        kind: "spike",
        ruleId: rule.id,
        message,
        observedValue: lastHour,
        baselineValue: baseline,
      };
      fired.push(alert);
      eventRows.push({
        job: alert.job,
        counter: alert.counter,
        kind: alert.kind,
        ruleId: alert.ruleId,
        message: alert.message,
        observedValue: lastHour.toFixed(4),
        baselineValue: baseline.toFixed(4),
        triggeredAt: new Date(now),
      });
      recentEvents.set(dedupeKey, now);
    }

    // ---- Stall check (job-wide) ----
    const stallRule = resolveRule(j.job, null, "stall", rules);
    if (stallRule && stallRule.enabled && j.latest) {
      const idleMs = now - j.latest.timestamp;
      const stallMs = stallRule.threshold * HOUR_MS;
      if (idleMs >= stallMs) {
        const dedupeKey = `${j.job}::::stall`;
        const snoozedUntil = activeSnoozes.get(dedupeKey);
        const lastFired = recentEvents.get(dedupeKey);
        if (snoozedUntil && snoozedUntil > now) {
          result.alertsSuppressed++;
        } else if (lastFired && now - lastFired < stallRule.dedupeMinutes * 60 * 1000) {
          result.alertsSuppressed++;
        } else {
          const idleHours = idleMs / HOUR_MS;
          const message = `Job "${j.job}" has not produced a sample for ${idleHours.toFixed(1)}h (threshold ${stallRule.threshold}h${stallRule.isDefault ? ", default rule" : ""}).`;
          const alert: JobMetricAlert = {
            job: j.job,
            counter: null,
            kind: "stall",
            ruleId: stallRule.id,
            message,
            observedValue: idleHours,
            baselineValue: stallRule.threshold,
          };
          fired.push(alert);
          eventRows.push({
            job: alert.job,
            counter: null,
            kind: alert.kind,
            ruleId: alert.ruleId,
            message: alert.message,
            observedValue: idleHours.toFixed(4),
            baselineValue: stallRule.threshold.toFixed(4),
            triggeredAt: new Date(now),
          });
          recentEvents.set(dedupeKey, now);
        }
      }
    }
  }

  if (fired.length === 0) return result;

  let adminIds: string[] = [];
  try {
    adminIds = await loadSuperAdminIds();
  } catch (err) {
    logError("Job metric alerts: failed to load super admins", { error: String(err) });
  }

  // Notify every Super Admin in-app — one notification per alert per admin.
  if (adminIds.length > 0) {
    const notifications = fired.flatMap((alert) =>
      adminIds.map((userId) => ({
        userId,
        type: "GENERAL" as const,
        title:
          alert.kind === "spike"
            ? `Job metric spike: ${alert.job}`
            : `Job has gone silent: ${alert.job}`,
        message: alert.message,
        relatedEntityType: "job_metric_alert",
        relatedEntityId: `${alert.job}:${alert.counter ?? "_"}:${alert.kind}`,
      })),
    );
    try {
      await insertNotifications(notifications);
      result.notifiedAdmins = adminIds.length;
    } catch (err) {
      logError("Job metric alerts: failed to insert notifications", { error: String(err) });
    }
  }

  // Persist event rows (with the actual notified count) for the dashboard.
  for (const row of eventRows) row.notifiedUserCount = adminIds.length;
  try {
    await db.insert(jobMetricAlertEvents).values(eventRows);
  } catch (err) {
    logError("Job metric alerts: failed to persist alert events", { error: String(err) });
  }

  result.alertsFired = fired;
  logInfo("Job metric alerts evaluated", {
    fired: fired.length,
    suppressed: result.alertsSuppressed,
    notifiedAdmins: result.notifiedAdmins,
  });
  return result;
}

export function getLastEvaluationAt(): number | null {
  return lastEvaluationAt;
}

/**
 * Read recent alert events for the admin dashboard. Returns the most
 * recent N events overall, plus a quick lookup of "currently active"
 * alerts (those triggered within the last hour) keyed by job.
 */
export interface JobMetricAlertEventView {
  id: string;
  job: string;
  counter: string | null;
  kind: AlertKind;
  message: string;
  observedValue: number | null;
  baselineValue: number | null;
  triggeredAt: number;
  notifiedUserCount: number;
  acknowledgedAt: number | null;
  acknowledgedById: string | null;
  snoozedUntil: number | null;
  snoozedById: string | null;
}

export async function listRecentJobMetricAlertEvents(limit = 50): Promise<{
  events: JobMetricAlertEventView[];
  activeByJob: Record<string, number>;
}> {
  const now = nowFn();
  const cutoff = new Date(now - 24 * HOUR_MS);
  const rows = await db
    .select()
    .from(jobMetricAlertEvents)
    .where(gte(jobMetricAlertEvents.triggeredAt, cutoff))
    .orderBy(desc(jobMetricAlertEvents.triggeredAt));

  const activeCutoff = now - HOUR_MS;
  const activeByJob: Record<string, number> = {};
  const events = rows.slice(0, limit).map((r) => {
    const ts = new Date(r.triggeredAt).getTime();
    const ackTs = r.acknowledgedAt ? new Date(r.acknowledgedAt).getTime() : null;
    const snoozeTs = r.snoozedUntil ? new Date(r.snoozedUntil).getTime() : null;
    // Acknowledged or actively snoozed events are no longer "active"
    // for the banner — they were handled.
    const isHandled = ackTs !== null || (snoozeTs !== null && snoozeTs > now);
    if (ts >= activeCutoff && !isHandled) {
      activeByJob[r.job] = (activeByJob[r.job] ?? 0) + 1;
    }
    return {
      id: r.id,
      job: r.job,
      counter: r.counter,
      kind: (r.kind === "stall" ? "stall" : "spike") as AlertKind,
      message: r.message,
      observedValue: r.observedValue !== null ? toNumber(r.observedValue as unknown as string, 0) : null,
      baselineValue: r.baselineValue !== null ? toNumber(r.baselineValue as unknown as string, 0) : null,
      triggeredAt: ts,
      notifiedUserCount: r.notifiedUserCount,
      acknowledgedAt: ackTs,
      acknowledgedById: r.acknowledgedById ?? null,
      snoozedUntil: snoozeTs,
      snoozedById: r.snoozedById ?? null,
    };
  });
  return { events, activeByJob };
}

/**
 * Mark an alert event as acknowledged. Hides it from the active banner
 * while preserving the row in the 24h history. Returns the updated row
 * (or null if not found).
 */
export async function acknowledgeJobMetricAlertEvent(
  id: string,
  userId: string,
): Promise<JobMetricAlertEventView | null> {
  const now = new Date(nowFn());
  const [updated] = await db
    .update(jobMetricAlertEvents)
    .set({ acknowledgedAt: now, acknowledgedById: userId })
    .where(eq(jobMetricAlertEvents.id, id))
    .returning();
  if (!updated) return null;
  return {
    id: updated.id,
    job: updated.job,
    counter: updated.counter,
    kind: (updated.kind === "stall" ? "stall" : "spike") as AlertKind,
    message: updated.message,
    observedValue: updated.observedValue !== null ? toNumber(updated.observedValue as unknown as string, 0) : null,
    baselineValue: updated.baselineValue !== null ? toNumber(updated.baselineValue as unknown as string, 0) : null,
    triggeredAt: new Date(updated.triggeredAt).getTime(),
    notifiedUserCount: updated.notifiedUserCount,
    acknowledgedAt: updated.acknowledgedAt ? new Date(updated.acknowledgedAt).getTime() : null,
    acknowledgedById: updated.acknowledgedById ?? null,
    snoozedUntil: updated.snoozedUntil ? new Date(updated.snoozedUntil).getTime() : null,
    snoozedById: updated.snoozedById ?? null,
  };
}

/**
 * Snooze an alert (and by extension, future re-notifications for the
 * same job/counter/kind) for `hours` hours. Also marks the event as
 * acknowledged so it disappears from the active banner.
 */
export async function snoozeJobMetricAlertEvent(
  id: string,
  userId: string,
  hours: number,
): Promise<JobMetricAlertEventView | null> {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Snooze duration must be a positive number of hours");
  }
  const now = nowFn();
  const snoozedUntil = new Date(now + hours * HOUR_MS);
  const [updated] = await db
    .update(jobMetricAlertEvents)
    .set({
      snoozedUntil,
      snoozedById: userId,
      acknowledgedAt: new Date(now),
      acknowledgedById: userId,
    })
    .where(eq(jobMetricAlertEvents.id, id))
    .returning();
  if (!updated) return null;
  return {
    id: updated.id,
    job: updated.job,
    counter: updated.counter,
    kind: (updated.kind === "stall" ? "stall" : "spike") as AlertKind,
    message: updated.message,
    observedValue: updated.observedValue !== null ? toNumber(updated.observedValue as unknown as string, 0) : null,
    baselineValue: updated.baselineValue !== null ? toNumber(updated.baselineValue as unknown as string, 0) : null,
    triggeredAt: new Date(updated.triggeredAt).getTime(),
    notifiedUserCount: updated.notifiedUserCount,
    acknowledgedAt: updated.acknowledgedAt ? new Date(updated.acknowledgedAt).getTime() : null,
    acknowledgedById: updated.acknowledgedById ?? null,
    snoozedUntil: updated.snoozedUntil ? new Date(updated.snoozedUntil).getTime() : null,
    snoozedById: updated.snoozedById ?? null,
  };
}

export async function listJobMetricAlertRules(): Promise<JobMetricAlertRule[]> {
  return db.select().from(jobMetricAlertRules).orderBy(jobMetricAlertRules.job, jobMetricAlertRules.kind);
}

export interface UpsertRuleInput {
  id?: string | null;
  job: string;
  counter?: string | null;
  kind: AlertKind;
  threshold: number;
  minAbsolute?: number;
  dedupeMinutes?: number;
  enabled?: boolean;
}

export async function upsertJobMetricAlertRule(input: UpsertRuleInput): Promise<JobMetricAlertRule> {
  const values = {
    job: input.job,
    counter: input.kind === "stall" ? null : (input.counter ?? null),
    kind: input.kind,
    threshold: input.threshold.toFixed(4),
    minAbsolute: input.minAbsolute ?? (input.kind === "spike" ? DEFAULT_SPIKE_MIN_ABSOLUTE : 0),
    dedupeMinutes: input.dedupeMinutes ?? DEFAULT_DEDUPE_MINUTES,
    enabled: input.enabled ?? true,
    updatedAt: new Date(),
  };
  if (input.id) {
    const [updated] = await db
      .update(jobMetricAlertRules)
      .set(values)
      .where(eq(jobMetricAlertRules.id, input.id))
      .returning();
    return updated;
  }
  const [inserted] = await db.insert(jobMetricAlertRules).values(values).returning();
  return inserted;
}

export async function deleteJobMetricAlertRule(id: string): Promise<boolean> {
  const deleted = await db
    .delete(jobMetricAlertRules)
    .where(eq(jobMetricAlertRules.id, id))
    .returning({ id: jobMetricAlertRules.id });
  return deleted.length > 0;
}

export const ALERT_DEFAULTS = {
  spike: {
    multiplier: DEFAULT_SPIKE_MULTIPLIER,
    minAbsolute: DEFAULT_SPIKE_MIN_ABSOLUTE,
    dedupeMinutes: DEFAULT_DEDUPE_MINUTES,
  },
  stall: {
    hours: DEFAULT_STALL_HOURS,
    dedupeMinutes: DEFAULT_DEDUPE_MINUTES,
  },
} as const;
