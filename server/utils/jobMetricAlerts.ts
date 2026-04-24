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
import { and, desc, eq, gt, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  jobMetricAlertEvents,
  jobMetricAlertQuietHoursDigestSends,
  jobMetricAlertRules,
  users,
  type JobMetricAlertRule,
} from "@shared/schema";

import { getAllJobMetrics, type JobCounters } from "./jobMetrics";
import { logError, logInfo } from "./logger";
import { insertNotifications } from "../services/notificationService";
import { sendEmail } from "../services/emailService";

function buildDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const full = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  if (full) return full;
  return email ?? null;
}

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SPIKE_MULTIPLIER = 3;
export const DEFAULT_SPIKE_MIN_ABSOLUTE = 5;
export const DEFAULT_STALL_HOURS = 4;
export const DEFAULT_DEDUPE_MINUTES = 60;
// Built-in email-escalation thresholds — applied when a rule does not
// specify its own `emailWhenAbove`. Tuned to "high-severity only" so
// Super Admins are not flooded with routine spikes.
export const DEFAULT_EMAIL_SPIKE_MULTIPLIER = 10;
export const DEFAULT_EMAIL_STALL_HOURS = 12;

export type AlertKind = "spike" | "stall";

export interface JobMetricAlert {
  job: string;
  counter: string | null;
  kind: AlertKind;
  ruleId: string | null;
  message: string;
  observedValue: number | null;
  baselineValue: number | null;
  emailed: boolean;
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
  /**
   * Optional severity escalation. When set and the observed value
   * (spike: lastHour count, stall: idle hours) meets or exceeds it,
   * Super Admins receive a SendGrid email in addition to the in-app
   * notification. `null` means "in-app only — no email escalation".
   */
  emailWhenAbove: number | null;
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
  const emailRaw = (row as unknown as { emailWhenAbove: string | null }).emailWhenAbove;
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
    emailWhenAbove:
      emailRaw === null || emailRaw === undefined ? null : toNumber(emailRaw, 0),
  };
}

/**
 * Task #1417 / #1453 — Per-job override for the built-in defaults. Used
 * when a job's natural cadence makes the engine-wide defaults (designed
 * for frequently-ticking jobs like notification fan-out) noisy or wrong.
 *
 * The engine ships with `DEFAULT_STALL_HOURS = 4` and
 * `DEFAULT_EMAIL_STALL_HOURS = 12`, which are appropriate for jobs
 * that tick every few minutes. Any cron-driven job in
 * `server/jobs/jobRunner.ts` whose natural cadence is longer than 4h
 * would otherwise page Super Admins on the very next evaluation tick
 * after a successful run (the 4h window expires long before the next
 * scheduled run). The map below tunes the stall threshold (and email
 * escalation floor) to "tolerate exactly one missed run" for each such
 * job so an alert only fires after the second consecutive missed run.
 * Dedupe windows are widened to match the cadence so a sustained
 * outage doesn't re-page on every 15-minute alert tick.
 *
 * No DB seeding is required — `resolveRule` consults this map whenever
 * no operator-authored rule exists for a (job, counter, kind), so a
 * fresh deploy is alerted out of the box. Operators can still override
 * any of these via `jobMetricAlertRules` rows from the dashboard.
 *
 * Job names mirror the snake_case identifier passed to
 * `recordJobMetrics` (where the job already publishes samples) or the
 * runner's task variable (for jobs that will start publishing later).
 * Adding a defensive entry now is a no-op until the job publishes its
 * first sample — `getAllJobMetrics()` only surfaces jobs the engine
 * has actually seen — but it guarantees the right policy is in place
 * the moment metrics are wired up.
 */
interface PerJobDefaults {
  stall?: {
    thresholdHours: number;
    dedupeMinutes?: number;
    emailWhenAboveHours?: number | null;
  };
  spikes?: Record<
    string,
    {
      multiplier: number;
      minAbsolute: number;
      dedupeMinutes?: number;
      emailWhenAbove?: number | null;
    }
  >;
}

// Standard "tolerate one missed run" stall override for once-daily jobs
// (cron `* * * * *` ticks at most once per 24h). 36h gives the next
// scheduled run a 12h grace window before the second missed run pages.
const DAILY_STALL: PerJobDefaults["stall"] = {
  thresholdHours: 36,
  dedupeMinutes: 24 * 60,
  emailWhenAboveHours: 36,
};

// Standard override for jobs that tick every 6h (cron `0 */6 * * *`).
// 14h tolerates one fully missed run plus a 2h grace for clock skew /
// long-running ticks before the second missed run pages.
const SIX_HOURLY_STALL: PerJobDefaults["stall"] = {
  thresholdHours: 14,
  dedupeMinutes: 6 * 60,
  emailWhenAboveHours: 14,
};

// Standard override for the weekly periodic-report fan-out (cron
// `0 7 * * 1`). 8 days = 192h tolerates a single missed Monday before
// alerting; dedupe matches the 7-day cadence so a sustained outage
// pages once per missed week, not every 15 minutes.
const WEEKLY_STALL: PerJobDefaults["stall"] = {
  thresholdHours: 8 * 24,
  dedupeMinutes: 7 * 24 * 60,
  emailWhenAboveHours: 8 * 24,
};

// Standard override for the monthly periodic-report fan-out (cron
// `0 7 1 * *`). 32 days tolerates a single missed month-start before
// alerting; dedupe matches the 30-day cadence.
const MONTHLY_STALL: PerJobDefaults["stall"] = {
  thresholdHours: 32 * 24,
  dedupeMinutes: 30 * 24 * 60,
  emailWhenAboveHours: 32 * 24,
};

export const PER_JOB_DEFAULTS: Record<string, PerJobDefaults> = {
  // ---- Daily (cron `<m> <h> * * *`, ~24h cadence) -------------------
  //
  // Each of these jobs runs at most once per day, so the engine's 4h
  // default would page on the very first alert tick after a healthy
  // run. The 36h DAILY_STALL override fires only after a second
  // consecutive missed run.

  // Nightly DOL Davis-Bacon stale wage decision sweep — `0 6 * * *`.
  // First per-job override added in Task #1417; the `failed` spike
  // rule below is specific to this job because the prior nightly runs
  // form a clean baseline for "DOL endpoints starting to reject us".
  wage_decision_stale_refresh: {
    stall: DAILY_STALL,
    spikes: {
      // 3× jump with an absolute floor of 3 keeps the rule from
      // firing on the 1-failure-vs-0-baseline case while still
      // catching real outages quickly.
      failed: {
        multiplier: 3,
        minAbsolute: 3,
        dedupeMinutes: 24 * 60,
        emailWhenAbove: 3,
      },
    },
  },

  // Orphan wage-decision row pruning — runs as a side effect of the
  // wage-decision retry sweep (`processFailedWageDecisionRetries`),
  // which is the parent `wage_decision_retry` job. That job has no
  // cron of its own anymore (Task #1368 superseded it with the
  // generic `integration_sync_retry` sweep) so in practice the
  // orphan sweep only publishes samples when an operator clicks
  // "Run job now". DAILY_STALL keeps the engine quiet between rare
  // manual runs while still alerting if a once-it-was-running cadence
  // disappears for a full day.
  //
  // Task #1463 — spike rule on `deleted` so a misconfigured retention
  // window or a buggy code path that suddenly removes a large batch
  // of rows in a single tick pages Super Admins before the table is
  // decimated. 5× baseline with a 10-row absolute floor avoids
  // flapping on the routine "1-row vs 0-baseline" case while still
  // catching genuine over-deletes.
  wage_decision_orphan_sweep: {
    stall: DAILY_STALL,
    spikes: {
      deleted: {
        multiplier: 5,
        minAbsolute: 10,
        dedupeMinutes: 24 * 60,
        emailWhenAbove: 10,
      },
    },
  },

  // Retention-policy sweep that hard-deletes rows past their org's
  // retention window — `0 2 * * *`.
  //
  // Task #1502 — spike rules on `deleted` / `hardDeleted` so a
  // misconfigured retention window or a buggy code path that suddenly
  // removes a large batch of rows in a single nightly tick pages
  // Super Admins before whole tables are decimated. 5× baseline with
  // a 25-row absolute floor avoids flapping on routine "small batch
  // vs 0-baseline" cases while still catching genuine over-deletes.
  // Dedupe matches the once-daily natural cadence so a sustained
  // outage doesn't re-page on every 15-minute alert tick. Email
  // escalation matches the absolute floor so the very first run that
  // crosses the threshold escalates to SendGrid.
  retention_policy_sweep: {
    stall: DAILY_STALL,
    spikes: {
      deleted: {
        multiplier: 5,
        minAbsolute: 25,
        dedupeMinutes: 24 * 60,
        emailWhenAbove: 25,
      },
      hardDeleted: {
        multiplier: 5,
        minAbsolute: 25,
        dedupeMinutes: 24 * 60,
        emailWhenAbove: 25,
      },
    },
  },

  // OAuth token expiry warning sweep for connected social accounts —
  // `0 3 * * *`.
  social_token_expiry_check: { stall: DAILY_STALL },

  // Per-project KPI snapshot capture that powers portfolio
  // sparklines — `15 2 * * *`.
  portfolio_kpi_snapshot: { stall: DAILY_STALL },

  // Pending-project geocoder for the Projects map view —
  // `30 4 * * *`.
  project_geocode: { stall: DAILY_STALL },

  // Compliance & expirations digest fan-out — `0 7 * * *`.
  compliance_expiration_check: { stall: DAILY_STALL },

  // SWPPP overdue corrective-action reminder fan-out —
  // `0 7 * * *`.
  swppp_overdue_corrective_actions: { stall: DAILY_STALL },

  // Daily CRM birthday email fan-out (separate from the hourly
  // birthday digest tick which already publishes samples every hour) —
  // `0 7 * * *`.
  crm_birthday_daily_digest: { stall: DAILY_STALL },

  // Idle-opportunity sweep for the CRM "needs attention" queue —
  // `0 8 * * *`.
  idle_opportunity_check: { stall: DAILY_STALL },

  // Davis-Bacon "missing wage decision" daily reminder fan-out —
  // `0 8 * * *`.
  wage_decision_missing_reminder: { stall: DAILY_STALL },

  // Hard-delete sweep for archived certified payroll PDFs past their
  // org's retention window — `30 3 * * *`.
  //
  // Task #1502 — spike rules on `deleted` / `hardDeleted` so a
  // misconfigured retention window (e.g. operator drops the value
  // from 1095 to 30 days) or a buggy code path that suddenly removes
  // a large batch of archived PDFs in a single nightly tick pages
  // Super Admins before the underlying GCS blobs are gone for good.
  // 5× baseline with a 25-row absolute floor mirrors the retention
  // policy sweep above; dedupe matches the once-daily natural cadence
  // and email escalation matches the floor.
  certified_payroll_purge: {
    stall: DAILY_STALL,
    spikes: {
      deleted: {
        multiplier: 5,
        minAbsolute: 25,
        dedupeMinutes: 24 * 60,
        emailWhenAbove: 25,
      },
      hardDeleted: {
        multiplier: 5,
        minAbsolute: 25,
        dedupeMinutes: 24 * 60,
        emailWhenAbove: 25,
      },
    },
  },

  // ---- Every 6 hours (cron `0 */6 * * *`) ---------------------------

  // Lightweight DB connectivity / latency probe used by the operations
  // dashboard — `0 */6 * * *`.
  db_health_check: { stall: SIX_HOURLY_STALL },

  // ---- Weekly (cron `0 7 * * 1`) ------------------------------------

  // Weekly periodic-report generator — `0 7 * * 1`. Runs once per
  // week on Mondays; an 8-day stall tolerates a single missed Monday.
  periodic_report_weekly: { stall: WEEKLY_STALL },

  // ---- Monthly (cron `0 7 1 * *`) -----------------------------------

  // Monthly periodic-report generator — `0 7 1 * *`. Runs on the 1st
  // of each month; a 32-day stall tolerates a single missed run.
  periodic_report_monthly: { stall: MONTHLY_STALL },
};

function defaultSpikeRule(job: string, counter: string): AlertRuleResolved {
  const override = PER_JOB_DEFAULTS[job]?.spikes?.[counter];
  if (override) {
    return {
      id: null,
      job,
      counter,
      kind: "spike",
      threshold: override.multiplier,
      minAbsolute: override.minAbsolute,
      dedupeMinutes: override.dedupeMinutes ?? DEFAULT_DEDUPE_MINUTES,
      enabled: true,
      isDefault: true,
      emailWhenAbove:
        override.emailWhenAbove === undefined
          ? DEFAULT_EMAIL_SPIKE_MULTIPLIER
          : override.emailWhenAbove,
    };
  }
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
    emailWhenAbove: DEFAULT_EMAIL_SPIKE_MULTIPLIER,
  };
}

function defaultStallRule(job: string): AlertRuleResolved {
  const override = PER_JOB_DEFAULTS[job]?.stall;
  if (override) {
    return {
      id: null,
      job,
      counter: null,
      kind: "stall",
      threshold: override.thresholdHours,
      minAbsolute: 0,
      dedupeMinutes: override.dedupeMinutes ?? DEFAULT_DEDUPE_MINUTES,
      enabled: true,
      isDefault: true,
      emailWhenAbove:
        override.emailWhenAboveHours === undefined
          ? DEFAULT_EMAIL_STALL_HOURS
          : override.emailWhenAboveHours,
    };
  }
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
    emailWhenAbove: DEFAULT_EMAIL_STALL_HOURS,
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
  emailsSent: number;
  // Task #744 — count of alerts where email delivery was attempted but
  // failed. Useful in operational logs and for the cron tick to surface.
  emailsFailed: number;
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

export interface SuperAdminRecipient {
  id: string;
  email: string;
  receivesJobMetricAlertEmails: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
  quietHoursWeekdays: number[] | null;
}

async function loadSuperAdmins(): Promise<SuperAdminRecipient[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      receivesJobMetricAlertEmails: users.receivesJobMetricAlertEmails,
      quietHoursEnabled: users.jobMetricAlertQuietHoursEnabled,
      quietHoursStart: users.jobMetricAlertQuietHoursStart,
      quietHoursEnd: users.jobMetricAlertQuietHoursEnd,
      quietHoursTimezone: users.jobMetricAlertQuietHoursTimezone,
      quietHoursWeekdays: users.jobMetricAlertQuietHoursWeekdays,
    })
    .from(users)
    .where(eq(users.role, "SUPER_ADMIN"));
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({
      id: r.id,
      email: r.email,
      receivesJobMetricAlertEmails: r.receivesJobMetricAlertEmails,
      quietHoursEnabled: r.quietHoursEnabled ?? false,
      quietHoursStart: r.quietHoursStart ?? null,
      quietHoursEnd: r.quietHoursEnd ?? null,
      quietHoursTimezone: r.quietHoursTimezone ?? null,
      quietHoursWeekdays: r.quietHoursWeekdays ?? null,
    }));
}

export type QuietHoursDigestFormat = "summary" | "full" | "grouped";

// Task #797 — recipient-chosen clock format for digest timestamps.
export type QuietHoursDigestTimeFormat = "12h" | "24h";

/**
 * Task #797 — Snapshot of the per-recipient timestamp formatting prefs
 * threaded through `formatDigestTimestamp` and `buildDigestEmailBody`.
 * `locale` is BCP-47; `null` falls back to "en-US" so the legacy
 * formatting stays exactly the same for recipients who never opted in.
 */
export interface QuietHoursDigestTimestampOptions {
  locale: string | null;
  timeFormat: QuietHoursDigestTimeFormat;
  showWeekday: boolean;
}

interface QuietHoursDigestRecipient extends SuperAdminRecipient {
  digestEnabled: boolean;
  lastDigestAt: Date | null;
  // Task #761 — recipient's preferred detail level for the digest body.
  digestFormat: QuietHoursDigestFormat;
  // Task #764 — when true, attach a CSV of every matched event so the
  // recipient can audit large windows offline (the in-email body is
  // still capped at digestMaxEvents rows).
  digestCsvEnabled: boolean;
  // Task #776 — per-recipient cap on how many recent alerts the digest
  // email body — and the in-app preview — surface. Falls back to
  // DIGEST_MAX_EVENTS_DEFAULT when unset (e.g. legacy callers/tests).
  digestMaxEvents?: number | null;
  // Task #797 — locale + 12h/24h + weekday preferences for the
  // recipient's digest timestamps.
  digestLocale: string | null;
  digestTimeFormat: QuietHoursDigestTimeFormat;
  digestShowWeekday: boolean;
}

// Task #776 — Allowed values for the per-recipient max-events cap. Kept
// in sync with the Zod schema in `authProfileRoutes.ts` and the
// <Select> options in `NotificationPrefsSection.tsx`.
export const DIGEST_MAX_EVENTS_OPTIONS = [25, 50, 100, 250] as const;
export type DigestMaxEventsOption = (typeof DIGEST_MAX_EVENTS_OPTIONS)[number];

function clampDigestMaxEvents(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  // Bucket-up policy: snap a stale or hand-edited value to the smallest
  // allowed option that is >= the stored value, so a recipient never
  // silently gets *fewer* alerts than they previously had configured.
  // Anything above 250 is capped at 250.
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  return 250;
}

async function loadSuperAdminsForDigest(): Promise<QuietHoursDigestRecipient[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      receivesJobMetricAlertEmails: users.receivesJobMetricAlertEmails,
      quietHoursEnabled: users.jobMetricAlertQuietHoursEnabled,
      quietHoursStart: users.jobMetricAlertQuietHoursStart,
      quietHoursEnd: users.jobMetricAlertQuietHoursEnd,
      quietHoursTimezone: users.jobMetricAlertQuietHoursTimezone,
      quietHoursWeekdays: users.jobMetricAlertQuietHoursWeekdays,
      digestEnabled: users.jobMetricAlertQuietHoursDigestEnabled,
      lastDigestAt: users.jobMetricAlertQuietHoursLastDigestAt,
      digestFormat: users.jobMetricAlertQuietHoursDigestFormat,
      digestCsvEnabled: users.jobMetricAlertQuietHoursDigestCsvEnabled,
      digestMaxEvents: users.jobMetricAlertQuietHoursDigestMaxEvents,
      digestLocale: users.jobMetricAlertQuietHoursDigestLocale,
      digestTimeFormat: users.jobMetricAlertQuietHoursDigestTimeFormat,
      digestShowWeekday: users.jobMetricAlertQuietHoursDigestShowWeekday,
    })
    .from(users)
    .where(eq(users.role, "SUPER_ADMIN"));
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({
      id: r.id,
      email: r.email,
      receivesJobMetricAlertEmails: r.receivesJobMetricAlertEmails,
      quietHoursEnabled: r.quietHoursEnabled ?? false,
      quietHoursStart: r.quietHoursStart ?? null,
      quietHoursEnd: r.quietHoursEnd ?? null,
      quietHoursTimezone: r.quietHoursTimezone ?? null,
      quietHoursWeekdays: r.quietHoursWeekdays ?? null,
      digestEnabled: r.digestEnabled ?? true,
      lastDigestAt: r.lastDigestAt ? new Date(r.lastDigestAt) : null,
      digestFormat: (r.digestFormat as QuietHoursDigestFormat | null) ?? "full",
      digestCsvEnabled: r.digestCsvEnabled ?? false,
      digestMaxEvents: clampDigestMaxEvents(r.digestMaxEvents),
      digestLocale: r.digestLocale ?? null,
      digestTimeFormat: (r.digestTimeFormat as QuietHoursDigestTimeFormat | null) ?? "12h",
      digestShowWeekday: r.digestShowWeekday ?? false,
    }));
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function parseHHMMToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Task #748: Returns true when `now` falls inside the recipient's
 * quiet-hours window. Supports windows that wrap past midnight (e.g.
 * 22:00 → 07:00) and weekday filters (where the weekday is keyed off
 * the day the window *starts*, so a Monday-night-into-Tuesday-morning
 * window with weekdays=[Mon] still suppresses Tuesday's pre-end alerts).
 *
 * If the recipient has not enabled quiet hours, or has not configured
 * a valid start/end pair, this returns false (no suppression).
 */
export function isInJobMetricAlertQuietWindow(
  recipient: {
    quietHoursEnabled?: boolean | null;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    quietHoursTimezone?: string | null;
    quietHoursWeekdays?: number[] | null;
  },
  now: Date,
): boolean {
  if (!recipient.quietHoursEnabled) return false;
  const startMin = parseHHMMToMinutes(recipient.quietHoursStart);
  const endMin = parseHHMMToMinutes(recipient.quietHoursEnd);
  if (startMin === null || endMin === null) return false;
  if (startMin === endMin) return false; // empty window

  const tz = recipient.quietHoursTimezone || "UTC";
  let parts: Record<string, string> = {};
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  } catch {
    // Bad timezone string — fail open (do not suppress) so admins are
    // not silently locked out of alerts by a typo.
    return false;
  }

  // Some ICU locales render "24" for midnight; normalize to 00.
  const hourRaw = parseInt(parts.hour ?? "0", 10);
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = parseInt(parts.minute ?? "0", 10);
  const minutesNow = hour * 60 + minute;
  const todayIdx = WEEKDAY_INDEX[parts.weekday] ?? -1;

  const weekdays = recipient.quietHoursWeekdays;
  const dayMatches = (idx: number): boolean => {
    if (!weekdays || weekdays.length === 0) return true;
    return weekdays.includes(idx);
  };

  if (startMin < endMin) {
    // Same-day window, e.g. 09:00 → 17:00.
    if (minutesNow >= startMin && minutesNow < endMin) {
      return dayMatches(todayIdx);
    }
    return false;
  }

  // Wrap-around window (start > end), e.g. 22:00 → 07:00.
  if (minutesNow >= startMin) {
    // Inside the late-evening half; weekday-keyed off today.
    return dayMatches(todayIdx);
  }
  if (minutesNow < endMin) {
    // Inside the early-morning half; weekday-keyed off the previous day.
    const yesterdayIdx = (todayIdx + 6) % 7;
    return dayMatches(yesterdayIdx);
  }
  return false;
}

function shouldEmail(rule: AlertRuleResolved, observed: number): boolean {
  if (rule.emailWhenAbove === null || rule.emailWhenAbove === undefined) return false;
  if (rule.emailWhenAbove <= 0) return false;
  return observed >= rule.emailWhenAbove;
}

interface EmailDeliveryResult {
  delivered: boolean;
  recipientCount: number;
  // Task #744 — true whenever we actually invoked sendEmail (so failures
  // are recorded distinctly from "didn't try"). `error` captures why a
  // delivery attempt failed when known.
  attempted: boolean;
  error: string | null;
}

async function emailSuperAdminsForAlert(
  alert: JobMetricAlert,
  rule: AlertRuleResolved,
  recipients: Array<{ email: string }>,
): Promise<EmailDeliveryResult> {
  if (recipients.length === 0) {
    return { delivered: false, recipientCount: 0, attempted: false, error: null };
  }
  const emails = Array.from(
    new Set(recipients.map((r) => r.email).filter((e): e is string => !!e && e.length > 0)),
  );
  if (emails.length === 0) {
    return { delivered: false, recipientCount: 0, attempted: false, error: null };
  }

  const subject =
    alert.kind === "spike"
      ? `[High severity] Job spike: ${alert.job}${alert.counter ? ` · ${alert.counter}` : ""}`
      : `[High severity] Job stalled: ${alert.job}`;
  const escalation =
    alert.kind === "spike"
      ? `Observed ${alert.observedValue?.toFixed?.(2) ?? alert.observedValue} in the last hour vs baseline ${alert.baselineValue?.toFixed?.(2) ?? alert.baselineValue}/hr (email threshold ≥ ${rule.emailWhenAbove}× baseline).`
      : `Job has been silent for ${alert.observedValue?.toFixed?.(1) ?? alert.observedValue}h (email threshold ≥ ${rule.emailWhenAbove}h).`;
  const baseUrl = (
    process.env.APP_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.FRONTEND_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "")
  ).replace(/\/$/, "");
  const dashboardUrl = `${baseUrl}/admin/job-metrics`;
  const text = `${alert.message}\n\n${escalation}\n\nReview: ${dashboardUrl}`;
  const html = `<p>${alert.message}</p><p>${escalation}</p><p><a href="${dashboardUrl}">Open the job metrics dashboard</a></p>`;

  try {
    const ok = await sendEmail({ to: emails, subject, text, html });
    if (ok) {
      return { delivered: true, recipientCount: emails.length, attempted: true, error: null };
    }
    // sendEmail returned false — SendGrid declined the message. We log it
    // (matching the pre-#744 behavior) but also surface the failure to the
    // caller so it lands in the dashboard.
    logError("Job metric alerts: email delivery failed", {
      error: "sendEmail returned false",
      job: alert.job,
      kind: alert.kind,
    });
    return {
      delivered: false,
      recipientCount: 0,
      attempted: true,
      error: "SendGrid did not accept the message",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("Job metric alerts: email delivery failed", {
      error: message,
      job: alert.job,
      kind: alert.kind,
    });
    return {
      delivered: false,
      recipientCount: 0,
      attempted: true,
      error: message,
    };
  }
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
    emailsSent: 0,
    emailsFailed: 0,
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
  // Parallel array — index N here corresponds to fired[N]. Tracks the
  // resolved rule + the value to compare against `emailWhenAbove` so
  // we can email after dedupe has already filtered out repeats.
  const firedRules: Array<{ rule: AlertRuleResolved; emailMetric: number }> = [];

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
        emailed: false,
      };
      fired.push(alert);
      // For spike emails, compare the observed multiple-vs-baseline to
      // the email threshold so "emailWhenAbove: 10" means ">=10× baseline".
      firedRules.push({ rule, emailMetric: baseline > 0 ? lastHour / baseline : 0 });
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
            emailed: false,
          };
          fired.push(alert);
          // For stall emails, compare idle hours directly against the
          // email threshold ("emailWhenAbove: 12" means >=12h idle).
          firedRules.push({ rule: stallRule, emailMetric: idleHours });
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

  let admins: Array<{ id: string; email: string; receivesJobMetricAlertEmails: boolean }> = [];
  try {
    admins = await loadSuperAdmins();
  } catch (err) {
    logError("Job metric alerts: failed to load super admins", { error: String(err) });
  }
  const adminIds = admins.map((a) => a.id);

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

  // Email escalation — for each newly-fired alert (already deduped by
  // the in-app pass above) decide whether the rule's `emailWhenAbove`
  // threshold is met and, if so, email every active Super Admin who has
  // not opted out of job-metric alert emails (task #740). In-app
  // notifications still go to every Super Admin — only the SendGrid
  // email is suppressed for opted-out users. The dedupe window is shared
  // with the in-app pass, so an alert that was suppressed earlier in the
  // loop is never emailed either. We email BEFORE persisting the event
  // rows so the `emailed` outcome (task #739) is written in a single
  // INSERT and visible on the dashboard.
  // Task #748: a recipient is also excluded when their personal quiet-
  // hours window is active. In-app notifications already went out above
  // — only the email channel is suppressed during quiet hours.
  const evaluatedAt = new Date(now);
  const emailRecipients = admins.filter(
    (a) => a.receivesJobMetricAlertEmails && !isInJobMetricAlertQuietWindow(a, evaluatedAt),
  );
  if (emailRecipients.length > 0) {
    for (let i = 0; i < fired.length; i++) {
      const alert = fired[i];
      const meta = firedRules[i];
      if (!meta) continue;
      if (!shouldEmail(meta.rule, meta.emailMetric)) continue;
      const outcome = await emailSuperAdminsForAlert(alert, meta.rule, emailRecipients);
      if (outcome.attempted) {
        eventRows[i].emailAttempted = true;
      }
      if (outcome.delivered) {
        alert.emailed = true;
        result.emailsSent++;
        eventRows[i].emailed = true;
        eventRows[i].emailedRecipientCount = outcome.recipientCount;
      } else if (outcome.attempted) {
        // Task #744 — record the failure reason so the dashboard can show
        // a distinct "email failed" warning instead of looking identical to
        // an alert that simply didn't meet the email threshold.
        eventRows[i].emailError = outcome.error ?? "Unknown email delivery failure";
        result.emailsFailed++;
      }
    }
  }

  // Persist event rows (with the actual notified count and email
  // escalation outcome) for the dashboard.
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
    emailsSent: result.emailsSent,
    emailsFailed: result.emailsFailed,
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
  acknowledgedByName: string | null;
  snoozedUntil: number | null;
  snoozedById: string | null;
  snoozedByName: string | null;
  // Task #739 — email escalation outcome recorded at alert-time.
  emailed: boolean;
  emailedRecipientCount: number;
  // Task #744 — distinguish "email never attempted" from
  // "email attempted but SendGrid delivery failed". When `emailAttempted`
  // is true and `emailed` is false, `emailError` carries the failure
  // reason so the dashboard can surface it.
  emailAttempted: boolean;
  emailError: string | null;
}

export async function listRecentJobMetricAlertEvents(limit = 50): Promise<{
  events: JobMetricAlertEventView[];
  activeByJob: Record<string, number>;
}> {
  const now = nowFn();
  const cutoff = new Date(now - 24 * HOUR_MS);
  const ackUser = alias(users, "ack_user");
  const snoozeUser = alias(users, "snooze_user");
  const rows = await db
    .select({
      event: jobMetricAlertEvents,
      ackFirst: ackUser.firstName,
      ackLast: ackUser.lastName,
      ackEmail: ackUser.email,
      snoozeFirst: snoozeUser.firstName,
      snoozeLast: snoozeUser.lastName,
      snoozeEmail: snoozeUser.email,
    })
    .from(jobMetricAlertEvents)
    .leftJoin(ackUser, eq(ackUser.id, jobMetricAlertEvents.acknowledgedById))
    .leftJoin(snoozeUser, eq(snoozeUser.id, jobMetricAlertEvents.snoozedById))
    .where(gte(jobMetricAlertEvents.triggeredAt, cutoff))
    .orderBy(desc(jobMetricAlertEvents.triggeredAt));

  const activeCutoff = now - HOUR_MS;
  const activeByJob: Record<string, number> = {};
  const events = rows.slice(0, limit).map(({ event: r, ackFirst, ackLast, ackEmail, snoozeFirst, snoozeLast, snoozeEmail }) => {
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
      acknowledgedByName: r.acknowledgedById ? buildDisplayName(ackFirst, ackLast, ackEmail) : null,
      snoozedUntil: snoozeTs,
      snoozedById: r.snoozedById ?? null,
      snoozedByName: r.snoozedById ? buildDisplayName(snoozeFirst, snoozeLast, snoozeEmail) : null,
      emailed: Boolean((r as unknown as { emailed?: boolean }).emailed ?? false),
      emailedRecipientCount: Number(
        (r as unknown as { emailedRecipientCount?: number }).emailedRecipientCount ?? 0,
      ),
      emailAttempted: Boolean((r as unknown as { emailAttempted?: boolean }).emailAttempted ?? false),
      emailError: ((r as unknown as { emailError?: string | null }).emailError ?? null),
    };
  });
  return { events, activeByJob };
}

/**
 * Mark an alert event as acknowledged. Hides it from the active banner
 * while preserving the row in the 24h history. Returns the updated row
 * (or null if not found).
 */
async function lookupUserName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) return null;
  return buildDisplayName(row.firstName, row.lastName, row.email);
}

async function hydrateEventRow(updated: typeof jobMetricAlertEvents.$inferSelect): Promise<JobMetricAlertEventView> {
  const [acknowledgedByName, snoozedByName] = await Promise.all([
    lookupUserName(updated.acknowledgedById),
    lookupUserName(updated.snoozedById),
  ]);
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
    acknowledgedByName,
    snoozedUntil: updated.snoozedUntil ? new Date(updated.snoozedUntil).getTime() : null,
    snoozedById: updated.snoozedById ?? null,
    snoozedByName,
    emailed: Boolean((updated as unknown as { emailed?: boolean }).emailed ?? false),
    emailedRecipientCount: Number(
      (updated as unknown as { emailedRecipientCount?: number }).emailedRecipientCount ?? 0,
    ),
    emailAttempted: Boolean(
      (updated as unknown as { emailAttempted?: boolean }).emailAttempted ?? false,
    ),
    emailError: ((updated as unknown as { emailError?: string | null }).emailError ?? null),
  };
}

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
  return hydrateEventRow(updated);
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
  return hydrateEventRow(updated);
}

/**
 * Clear an active snooze early so the alert can re-fire if its
 * underlying condition still holds. The acknowledgement record is
 * preserved so the dashboard still shows who handled it originally.
 */
export async function unsnoozeJobMetricAlertEvent(
  id: string,
): Promise<JobMetricAlertEventView | null> {
  // Only clear `snoozedUntil` — keep `snoozedById` so the dashboard
  // and audit trail still show who originally snoozed the alert.
  const [updated] = await db
    .update(jobMetricAlertEvents)
    .set({ snoozedUntil: null })
    .where(eq(jobMetricAlertEvents.id, id))
    .returning();
  if (!updated) return null;
  return hydrateEventRow(updated);
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
  /**
   * Opt-in email escalation. `null` (or omitted) disables email and the
   * rule stays in-app only. A positive number enables email when the
   * observed metric (multiplier for spike, hours for stall) is at least
   * this value.
   */
  emailWhenAbove?: number | null;
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
    emailWhenAbove:
      input.emailWhenAbove === undefined || input.emailWhenAbove === null
        ? null
        : Number(input.emailWhenAbove).toFixed(4),
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

// ---------------------------------------------------------------------
// Task #754 — Quiet-hours digest
// ---------------------------------------------------------------------
// Once a recipient exits their quiet-hours window, send (at most once
// per window) a single email summarizing alerts that fired during the
// period that they were silenced. The cron tick runs frequently
// (every 15 minutes) and uses `users.jobMetricAlertQuietHoursLastDigestAt`
// as a high-water mark so that each finished quiet window produces a
// single digest, even across multiple ticks.
//
// Selection rule for "in the digest" — an event fired between the
// recipient's `lastDigestAt` (or 24h ago, whichever is later) and now,
// whose triggered timestamp falls inside the recipient's quiet-hours
// window for that timestamp. Events that fired while the recipient
// was awake are not part of the digest because the recipient already
// received the regular per-alert email (subject to other filters).
// ---------------------------------------------------------------------

const DIGEST_LOOKBACK_MS = 24 * HOUR_MS;
// Task #776 — Default cap when a recipient has no per-user override
// configured. The actual cap is now `users.jobMetricAlertQuietHoursDigestMaxEvents`,
// resolved per-recipient via clampDigestMaxEvents above.
const DIGEST_MAX_EVENTS_DEFAULT = 100;

export interface QuietHoursDigestSummary {
  evaluatedAt: number;
  recipientsConsidered: number;
  digestsSent: number;
  digestsSkippedNoEvents: number;
  digestsSkippedInQuiet: number;
  digestsSkippedDisabled: number;
}

interface DigestEventRow {
  job: string;
  counter: string | null;
  kind: string;
  message: string;
  triggeredAt: Date;
  emailed: boolean;
}

async function fetchDigestEventsSince(since: Date): Promise<DigestEventRow[]> {
  return db
    .select({
      job: jobMetricAlertEvents.job,
      counter: jobMetricAlertEvents.counter,
      kind: jobMetricAlertEvents.kind,
      message: jobMetricAlertEvents.message,
      triggeredAt: jobMetricAlertEvents.triggeredAt,
      emailed: jobMetricAlertEvents.emailed,
    })
    .from(jobMetricAlertEvents)
    .where(gte(jobMetricAlertEvents.triggeredAt, since))
    .orderBy(jobMetricAlertEvents.triggeredAt);
}

/**
 * Task #770 — Fetch alert events triggered between [from, to] for the
 * dashboard CSV export. Mirrors the columns used by the digest CSV so
 * a download from the dashboard matches the file delivered by email.
 */
export async function fetchAlertEventsBetween(
  from: Date,
  to: Date,
  filters: { job?: string | null; counter?: string | null } = {},
): Promise<DigestEventRow[]> {
  const conditions = [
    gte(jobMetricAlertEvents.triggeredAt, from),
    lte(jobMetricAlertEvents.triggeredAt, to),
  ];
  if (filters.job) {
    conditions.push(eq(jobMetricAlertEvents.job, filters.job));
  }
  if (filters.counter) {
    conditions.push(eq(jobMetricAlertEvents.counter, filters.counter));
  }
  return db
    .select({
      job: jobMetricAlertEvents.job,
      counter: jobMetricAlertEvents.counter,
      kind: jobMetricAlertEvents.kind,
      message: jobMetricAlertEvents.message,
      triggeredAt: jobMetricAlertEvents.triggeredAt,
      emailed: jobMetricAlertEvents.emailed,
    })
    .from(jobMetricAlertEvents)
    .where(and(...conditions))
    .orderBy(jobMetricAlertEvents.triggeredAt);
}

/**
 * Task #774 — Shared helper that powers
 * `GET /api/admin/metrics/jobs/alerts/events.csv`.
 *
 * Parsing the `from`/`to`/`range` query, enforcing the 90-day cap, and
 * stitching together `fetchAlertEventsBetween` + `buildDigestCsv` lives
 * here so the route in `server/routes.ts` stays a thin wrapper and so
 * the CSV contract (header + escape rules + filename format) can be
 * pinned by the existing job metric alert test suite without spinning
 * up the full Express app.
 */
export interface AlertEventsCsvQuery {
  from?: string;
  to?: string;
  range?: string;
  job?: string;
  counter?: string;
}

export type AlertEventsCsvResponse =
  | {
      ok: true;
      from: Date;
      to: Date;
      csv: string;
      filename: string;
      contentType: string;
    }
  | { ok: false; status: 400; error: string; details?: unknown };

const ALERT_EVENTS_CSV_MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

function isIsoDateTimeWithOffset(value: string): boolean {
  // RFC 3339 with offset (Z or ±HH:MM); mirrors zod's
  // `z.string().datetime({ offset: true })` behavior closely enough
  // for the CSV endpoint without pulling zod into the helper.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  );
}

export function resolveAlertEventsCsvRange(
  query: AlertEventsCsvQuery,
  now: number,
):
  | { ok: true; from: Date; to: Date }
  | { ok: false; status: 400; error: string; details?: unknown } {
  if (
    query.range !== undefined &&
    query.range !== "24h" &&
    query.range !== "7d"
  ) {
    return {
      ok: false,
      status: 400,
      error: "Invalid range",
      details: [{ path: ["range"], message: "Expected '24h' or '7d'" }],
    };
  }
  if (query.from !== undefined && !isIsoDateTimeWithOffset(query.from)) {
    return {
      ok: false,
      status: 400,
      error: "Invalid range",
      details: [{ path: ["from"], message: "Expected ISO 8601 with offset" }],
    };
  }
  if (query.to !== undefined && !isIsoDateTimeWithOffset(query.to)) {
    return {
      ok: false,
      status: 400,
      error: "Invalid range",
      details: [{ path: ["to"], message: "Expected ISO 8601 with offset" }],
    };
  }
  if (query.job !== undefined && query.job.trim().length > 200) {
    return {
      ok: false,
      status: 400,
      error: "Invalid range",
      details: [{ path: ["job"], message: "Must be 200 characters or fewer" }],
    };
  }
  if (query.counter !== undefined && query.counter.trim().length > 200) {
    return {
      ok: false,
      status: 400,
      error: "Invalid range",
      details: [{ path: ["counter"], message: "Must be 200 characters or fewer" }],
    };
  }
  if (query.from || query.to) {
    if (!query.from || !query.to) {
      return {
        ok: false,
        status: 400,
        error: "Both 'from' and 'to' are required for a custom range",
      };
    }
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { ok: false, status: 400, error: "Invalid 'from' or 'to' timestamp" };
    }
    if (from.getTime() >= to.getTime()) {
      return { ok: false, status: 400, error: "'from' must be before 'to'" };
    }
    if (to.getTime() - from.getTime() > ALERT_EVENTS_CSV_MAX_RANGE_MS) {
      return { ok: false, status: 400, error: "Range must be 90 days or less" };
    }
    return { ok: true, from, to };
  }
  const rangeKey = query.range ?? "24h";
  const lookbackMs = rangeKey === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return { ok: true, from: new Date(now - lookbackMs), to: new Date(now) };
}

function slugifyAlertEventsCsvFilter(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function appendAlertEventsCsvFilterSuffix(
  baseFilename: string,
  filters: { job?: string | null; counter?: string | null },
): string {
  const suffix = [
    filters.job ? `job-${slugifyAlertEventsCsvFilter(filters.job)}` : null,
    filters.counter
      ? `counter-${slugifyAlertEventsCsvFilter(filters.counter)}`
      : null,
  ]
    .filter(Boolean)
    .join("_");
  if (!suffix) return baseFilename;
  return baseFilename.replace(/\.csv$/, `_${suffix}.csv`);
}

export async function buildAlertEventsCsvResponse(opts: {
  query: AlertEventsCsvQuery;
  now?: number;
  fetchEvents?: (
    from: Date,
    to: Date,
    filters: { job?: string | null; counter?: string | null },
  ) => Promise<DigestEventRow[]>;
}): Promise<AlertEventsCsvResponse> {
  const now = opts.now ?? Date.now();
  const range = resolveAlertEventsCsvRange(opts.query, now);
  if (!range.ok) return range;
  const job = opts.query.job?.trim() || undefined;
  const counter = opts.query.counter?.trim() || undefined;
  const fetchEvents = opts.fetchEvents ?? fetchAlertEventsBetween;
  const events = await fetchEvents(range.from, range.to, { job, counter });
  const csv = buildDigestCsv(events);
  const baseFilename = buildDigestCsvFilename(range.from, range.to);
  const filename = appendAlertEventsCsvFilterSuffix(baseFilename, { job, counter });
  return {
    ok: true,
    from: range.from,
    to: range.to,
    csv,
    filename,
    contentType: "text/csv; charset=utf-8",
  };
}

/**
 * Task #786 — Inline <style> block for the digest email body. Provides
 * dark-mode + mobile responsive overrides for clients that respect
 * `<style>` blocks (Apple Mail, iOS Gmail, Outlook.com, etc.). Inline
 * styles on each element ensure the light-mode default still renders
 * for clients that strip <style> (e.g. Gmail web in some configs).
 */
const DIGEST_EMAIL_STYLE_BLOCK = `
<style>
  .qh-root { font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; padding: 16px; color: #333333; background-color: #ffffff; }
  .qh-title { color: #333333; margin: 0 0 8px; font-size: 20px; line-height: 1.3; }
  .qh-intro { color: #666666; line-height: 1.5; margin: 0 0 12px; word-wrap: break-word; overflow-wrap: anywhere; }
  .qh-card { list-style: none; padding: 8px 16px; margin: 16px 0; background: #fafafa; border: 1px solid #eeeeee; border-radius: 6px; color: #333333; }
  .qh-item { padding: 6px 0; border-bottom: 1px solid #f0f0f0; color: #333333; word-break: break-word; overflow-wrap: anywhere; }
  .qh-item-last { border-bottom: none; }
  .qh-muted { color: #666666; }
  .qh-subtle { color: #888888; }
  .qh-soft { color: #555555; }
  .qh-heading { color: #333333; font-size: 14px; margin: 18px 0 4px; }
  .qh-accent { color: #0070f3; }
  .qh-tag { text-transform: uppercase; font-size: 11px; color: #666666; letter-spacing: 0.04em; }
  .qh-button { background-color: #0070f3; color: #ffffff !important; padding: 12px 22px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px; }
  .qh-divider { border: none; border-top: 1px solid #eeeeee; margin-top: 30px; }
  .qh-footer { color: #999999; font-size: 12px; line-height: 1.5; }
  .qh-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; overflow-wrap: anywhere; }

  @media only screen and (max-width: 600px) {
    .qh-root { padding: 12px !important; }
    .qh-title { font-size: 18px !important; }
    .qh-card { padding: 8px 12px !important; margin: 12px 0 !important; }
    .qh-button { display: block !important; text-align: center !important; padding: 14px 20px !important; }
    .qh-heading { font-size: 15px !important; }
  }

  @media (prefers-color-scheme: dark) {
    .qh-root { background-color: #1a1a1a !important; color: #e6e6e6 !important; }
    .qh-title { color: #f5f5f5 !important; }
    .qh-intro { color: #c8c8c8 !important; }
    .qh-card { background-color: #242424 !important; border-color: #333333 !important; color: #e6e6e6 !important; }
    .qh-item { color: #e6e6e6 !important; border-bottom-color: #2e2e2e !important; }
    .qh-muted { color: #b8b8b8 !important; }
    .qh-subtle { color: #9a9a9a !important; }
    .qh-soft { color: #c8c8c8 !important; }
    .qh-heading { color: #f5f5f5 !important; }
    .qh-accent { color: #60a5fa !important; }
    .qh-tag { color: #b8b8b8 !important; }
    .qh-divider { border-top-color: #333333 !important; }
    .qh-footer { color: #b8b8b8 !important; }
    .qh-button { background-color: #2563eb !important; color: #ffffff !important; }
  }

  /* Outlook.com / Outlook web dark mode */
  [data-ogsc] .qh-root, [data-ogsb] .qh-root { background-color: #1a1a1a !important; color: #e6e6e6 !important; }
  [data-ogsc] .qh-title, [data-ogsc] .qh-heading { color: #f5f5f5 !important; }
  [data-ogsc] .qh-intro, [data-ogsc] .qh-soft, [data-ogsc] .qh-muted { color: #c8c8c8 !important; }
  [data-ogsb] .qh-card { background-color: #242424 !important; border-color: #333333 !important; }
  [data-ogsc] .qh-item { color: #e6e6e6 !important; }
  [data-ogsc] .qh-tag, [data-ogsc] .qh-subtle, [data-ogsc] .qh-footer { color: #b8b8b8 !important; }
  [data-ogsc] .qh-accent { color: #60a5fa !important; }
</style>
`.trim();

function wrapDigestHtml(titleLabel: string, innerHtml: string): string {
  // role="article" + aria-label give screen readers a stable hook and
  // make the digest body easy to assert against in e2e tests.
  return `${DIGEST_EMAIL_STYLE_BLOCK}
<div class="qh-root" role="article" aria-roledescription="email" aria-label="${escapeHtmlSafe(titleLabel)}" style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#333333;background-color:#ffffff;">
${innerHtml}
</div>`;
}

function formatDigestSubject(count: number): string {
  return count === 1
    ? `Quiet-hours digest: 1 alert fired while you were silenced`
    : `Quiet-hours digest: ${count} alerts fired while you were silenced`;
}

/**
 * Task #795 — Render a Date in the recipient's quiet-hours timezone
 * using a short, human-readable format such as `Apr 21, 6:00 PM PDT`.
 * Falls back to the raw ISO string if the timezone is unrecognized so
 * the digest never silently swallows a timestamp.
 */
function formatDigestTimestamp(
  d: Date,
  timezone: string | null,
  options: QuietHoursDigestTimestampOptions = {
    locale: null,
    timeFormat: "12h",
    showWeekday: false,
  },
): string {
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  const locale =
    options.locale && options.locale.length > 0 ? options.locale : "en-US";
  const hour12 = options.timeFormat !== "24h";
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      ...(options.showWeekday ? { weekday: "short" as const } : {}),
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZoneName: "short",
    });
    return fmt.format(d);
  } catch {
    // Bad locale or timezone string — retry once with safe en-US/UTC
    // defaults so the digest never silently swallows a timestamp, then
    // fall back to the raw ISO if that still fails.
    try {
      const fallback = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short",
      });
      return fallback.format(d);
    } catch {
      return d.toISOString();
    }
  }
}

export function buildDigestEmailBody(
  events: DigestEventRow[],
  windowStart: Date,
  windowEnd: Date,
  format: QuietHoursDigestFormat = "full",
  timezone: string | null = null,
  // Task #797 — per-recipient locale & 12h/24h/weekday preferences for
  // every rendered timestamp. Defaults preserve the legacy "en-US,
  // 12-hour, no weekday" rendering so existing callers/tests remain
  // unaffected when they do not pass this parameter.
  timestampOptions: QuietHoursDigestTimestampOptions = {
    locale: null,
    timeFormat: "12h",
    showWeekday: false,
  },
): { text: string; html: string } {
  const fmtTs = (d: Date): string =>
    formatDigestTimestamp(d, timezone, timestampOptions);
  const baseUrl = (
    process.env.APP_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.FRONTEND_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "")
  ).replace(/\/$/, "");
  const dashboardUrl = `${baseUrl}/admin/job-metrics`;
  const windowStartLocal = fmtTs(windowStart);
  const windowEndLocal = fmtTs(windowEnd);
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();
  // Task #795 — Show the window range in the recipient's timezone for
  // legibility, but keep the raw ISO strings in the text body so the
  // digest remains machine-parseable.
  const rangeLocal = `${windowStartLocal} → ${windowEndLocal}`;
  const rangeIso = `${windowStartIso} → ${windowEndIso}`;
  const rangeText = `${rangeLocal} [${rangeIso}]`;
  const intro =
    `While you were inside your quiet-hours window (${rangeText}), the following ` +
    `${events.length} job-metric alert${events.length === 1 ? "" : "s"} fired`;
  const introHtml = `While you were inside your quiet-hours window
        (<span class="qh-code" style="word-break:break-word;overflow-wrap:anywhere;">${escapeHtmlSafe(rangeLocal)}</span>), the following
        <strong>${events.length}</strong> job-metric alert${events.length === 1 ? "" : "s"} fired`;
  const footerHtml = `
      <p style="margin-top:20px;">
        <a href="${dashboardUrl}" class="qh-button" style="background-color:#0070f3;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;font-size:14px;">
          Open the job metrics dashboard
        </a>
      </p>
      <hr class="qh-divider" style="margin-top:30px;border:none;border-top:1px solid #eeeeee;">
      <p class="qh-footer" style="color:#999999;font-size:12px;line-height:1.5;">
        You can change the digest detail level or disable it from your Notification Preferences page.
      </p>
  `;

  if (format === "summary") {
    // Counts only — total alerts, spike vs stall, and the top jobs.
    const spikes = events.filter((e) => e.kind === "spike").length;
    const stalls = events.filter((e) => e.kind === "stall").length;
    const byJob = new Map<string, number>();
    for (const e of events) byJob.set(e.job, (byJob.get(e.job) ?? 0) + 1);
    const topJobs = Array.from(byJob.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const counterCount = new Set(
      events.map((e) => `${e.job}::${e.counter ?? ""}`),
    ).size;
    const text =
      `${intro}.\n\n` +
      `Totals:\n` +
      `  • ${events.length} alert${events.length === 1 ? "" : "s"}\n` +
      `  • ${spikes} spike${spikes === 1 ? "" : "s"}, ${stalls} stall${stalls === 1 ? "" : "s"}\n` +
      `  • ${byJob.size} job${byJob.size === 1 ? "" : "s"}, ${counterCount} job/counter pair${counterCount === 1 ? "" : "s"}\n\n` +
      (topJobs.length
        ? `Top jobs:\n${topJobs.map(([j, c]) => `  • ${j} — ${c}`).join("\n")}\n\n`
        : "") +
      `Review the dashboard: ${dashboardUrl}`;
    const topJobsHtml = topJobs.length
      ? `<ul class="qh-card" role="list" aria-label="Top jobs by alert count" style="list-style:none;padding:8px 16px;margin:16px 0;background:#fafafa;border:1px solid #eeeeee;border-radius:6px;color:#333333;">
          ${topJobs
            .map(
              ([j, c], idx) => `<li class="qh-item${idx === topJobs.length - 1 ? " qh-item-last" : ""}" style="padding:6px 0;${idx === topJobs.length - 1 ? "" : "border-bottom:1px solid #f0f0f0;"}color:#333333;word-break:break-word;overflow-wrap:anywhere;">
            <strong>${escapeHtmlSafe(j)}</strong>
            <span class="qh-muted" style="color:#666666;"> — ${c} alert${c === 1 ? "" : "s"}</span>
          </li>`,
            )
            .join("")}
        </ul>`
      : "";
    const html = wrapDigestHtml(
      "Quiet-hours digest (summary)",
      `
        <h2 class="qh-title" style="color:#333333;margin:0 0 8px;font-size:20px;line-height:1.3;">Quiet-hours digest (summary)</h2>
        <p class="qh-intro" style="color:#666666;line-height:1.5;margin:0 0 12px;word-wrap:break-word;overflow-wrap:anywhere;">${introHtml}.</p>
        <ul class="qh-card" role="list" aria-label="Digest totals" style="list-style:none;padding:8px 16px;margin:16px 0;background:#fafafa;border:1px solid #eeeeee;border-radius:6px;color:#333333;">
          <li class="qh-item" style="padding:6px 0;border-bottom:1px solid #f0f0f0;color:#333333;"><strong>${events.length}</strong> alert${events.length === 1 ? "" : "s"} total</li>
          <li class="qh-item" style="padding:6px 0;border-bottom:1px solid #f0f0f0;color:#333333;"><strong>${spikes}</strong> spike${spikes === 1 ? "" : "s"}, <strong>${stalls}</strong> stall${stalls === 1 ? "" : "s"}</li>
          <li class="qh-item qh-item-last" style="padding:6px 0;color:#333333;"><strong>${byJob.size}</strong> job${byJob.size === 1 ? "" : "s"}, <strong>${counterCount}</strong> job/counter pair${counterCount === 1 ? "" : "s"}</li>
        </ul>
        ${topJobs.length ? `<h3 class="qh-heading" style="color:#333333;font-size:14px;margin:18px 0 4px;">Top jobs</h3>${topJobsHtml}` : ""}
        ${footerHtml}
      `,
    );
    return { text, html };
  }

  if (format === "grouped") {
    // Group events by job, preserving chronological order within each group.
    const groups = new Map<string, DigestEventRow[]>();
    for (const e of events) {
      const arr = groups.get(e.job) ?? [];
      arr.push(e);
      groups.set(e.job, arr);
    }
    const orderedJobs = Array.from(groups.keys()).sort(
      (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0),
    );
    const textGroups = orderedJobs.map((job) => {
      const list = groups.get(job) ?? [];
      const lines = list.map((e) => {
        const tsLocal = fmtTs(e.triggeredAt);
        const tsIso = e.triggeredAt.toISOString();
        const counter = e.counter ? ` · ${e.counter}` : "";
        const kindLabel = e.kind === "stall" ? "stall" : "spike";
        return `    • ${tsLocal} [${tsIso}] (${kindLabel})${counter} — ${e.message}`;
      });
      return `${job} (${list.length} alert${list.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
    });
    const text =
      `${intro}, grouped by job:\n\n` +
      `${textGroups.join("\n\n")}\n\n` +
      `Review the dashboard: ${dashboardUrl}`;
    const htmlGroups = orderedJobs
      .map((job) => {
        const list = groups.get(job) ?? [];
        const items = list
          .map((e, idx) => {
            const tsLocal = escapeHtmlSafe(fmtTs(e.triggeredAt));
            const tsIso = escapeHtmlSafe(e.triggeredAt.toISOString());
            const counter = e.counter ? ` · ${escapeHtmlSafe(e.counter)}` : "";
            const kindLabel = e.kind === "stall" ? "stall" : "spike";
            const isLast = idx === list.length - 1;
            return `<li class="qh-item${isLast ? " qh-item-last" : ""}" style="padding:6px 0;${isLast ? "" : "border-bottom:1px solid #f0f0f0;"}color:#333333;word-break:break-word;overflow-wrap:anywhere;">
              <strong class="qh-accent" style="color:#0070f3;word-break:break-word;overflow-wrap:anywhere;" title="${tsIso}">${tsLocal}</strong>
              <span class="qh-tag" style="text-transform:uppercase;font-size:11px;color:#666666;letter-spacing:0.04em;">${kindLabel}</span>${counter}<br/>
              <span class="qh-soft" style="color:#555555;">${escapeHtmlSafe(e.message)}</span>
            </li>`;
          })
          .join("");
        return `
          <h3 class="qh-heading" style="color:#333333;font-size:14px;margin:18px 0 4px;word-break:break-word;overflow-wrap:anywhere;">
            ${escapeHtmlSafe(job)}
            <span class="qh-subtle" style="color:#888888;font-weight:normal;font-size:12px;">— ${list.length} alert${list.length === 1 ? "" : "s"}</span>
          </h3>
          <ul class="qh-card" role="list" aria-label="Alerts for ${escapeHtmlSafe(job)}" style="list-style:none;padding:8px 16px;margin:0 0 8px;background:#fafafa;border:1px solid #eeeeee;border-radius:6px;">
            ${items}
          </ul>
        `;
      })
      .join("");
    const html = wrapDigestHtml(
      "Quiet-hours digest (grouped by job)",
      `
        <h2 class="qh-title" style="color:#333333;margin:0 0 8px;font-size:20px;line-height:1.3;">Quiet-hours digest (grouped by job)</h2>
        <p class="qh-intro" style="color:#666666;line-height:1.5;margin:0 0 12px;word-wrap:break-word;overflow-wrap:anywhere;">${introHtml}, grouped by job.</p>
        ${htmlGroups}
        ${footerHtml}
      `,
    );
    return { text, html };
  }

  // Default — "full" — original per-event flat list.
  const lines = events.map((e) => {
    const tsLocal = fmtTs(e.triggeredAt);
    const tsIso = e.triggeredAt.toISOString();
    const counter = e.counter ? ` · ${e.counter}` : "";
    const kindLabel = e.kind === "stall" ? "stall" : "spike";
    return `• ${tsLocal} [${tsIso}] (${kindLabel}) ${e.job}${counter} — ${e.message}`;
  });
  const text =
    `${intro}:\n\n` +
    `${lines.join("\n")}\n\n` +
    `Review the dashboard: ${dashboardUrl}`;

  const items = events
    .map((e, idx) => {
      const tsLocal = escapeHtmlSafe(fmtTs(e.triggeredAt));
      const tsIso = escapeHtmlSafe(e.triggeredAt.toISOString());
      const counter = e.counter ? ` · ${escapeHtmlSafe(e.counter)}` : "";
      const kindLabel = e.kind === "stall" ? "stall" : "spike";
      const isLast = idx === events.length - 1;
      return `<li class="qh-item${isLast ? " qh-item-last" : ""}" style="padding:6px 0;${isLast ? "" : "border-bottom:1px solid #f0f0f0;"}color:#333333;word-break:break-word;overflow-wrap:anywhere;">
        <strong class="qh-accent" style="color:#0070f3;word-break:break-word;overflow-wrap:anywhere;" title="${tsIso}">${tsLocal}</strong>
        <span class="qh-tag" style="text-transform:uppercase;font-size:11px;color:#666666;letter-spacing:0.04em;">${kindLabel}</span>
        <strong>${escapeHtmlSafe(e.job)}${counter}</strong><br/>
        <span class="qh-soft" style="color:#555555;">${escapeHtmlSafe(e.message)}</span>
      </li>`;
    })
    .join("");
  const html = wrapDigestHtml(
    "Quiet-hours digest",
    `
      <h2 class="qh-title" style="color:#333333;margin:0 0 8px;font-size:20px;line-height:1.3;">Quiet-hours digest</h2>
      <p class="qh-intro" style="color:#666666;line-height:1.5;margin:0 0 12px;word-wrap:break-word;overflow-wrap:anywhere;">${introHtml}.</p>
      <ul class="qh-card" role="list" aria-label="Quiet-hours digest alerts" style="list-style:none;padding:8px 16px;margin:16px 0;background:#fafafa;border:1px solid #eeeeee;border-radius:6px;">
        ${items}
      </ul>
      ${footerHtml}
    `,
  );
  return { text, html };
}

/**
 * Task #764 — Render a CSV row, escaping any field that contains a
 * quote, comma, newline, or carriage return per RFC 4180.
 */
function csvEscape(value: string | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Task #764 — Build the digest CSV body. Columns mirror the task spec:
 * job, counter, kind, triggeredAt (ISO-8601), message. The CSV is not
 * truncated by the in-email per-recipient max-events cap (Task #776).
 */
export function buildDigestCsv(events: DigestEventRow[]): string {
  const header = "job,counter,kind,triggeredAt,message";
  const lines = events.map((e) =>
    [
      csvEscape(e.job),
      csvEscape(e.counter ?? ""),
      csvEscape(e.kind),
      csvEscape(e.triggeredAt.toISOString()),
      csvEscape(e.message),
    ].join(","),
  );
  // Use CRLF per RFC 4180 so the file opens cleanly in spreadsheet apps
  // on Windows as well as macOS/Linux.
  return [header, ...lines].join("\r\n") + "\r\n";
}

function buildDigestCsvFilename(windowStart: Date, windowEnd: Date): string {
  const fmt = (d: Date): string =>
    d.toISOString().replace(/[:.]/g, "-").replace(/T/, "_").slice(0, 19);
  return `quiet-hours-digest_${fmt(windowStart)}_to_${fmt(windowEnd)}.csv`;
}

/**
 * Task #765 — Build a sample digest body for the "Preview digest" feature.
 *
 * Pulls the user's most recent real events from the last digest lookback
 * window and renders the digest body using the requested format. If no
 * real events exist (a fresh install, a quiet system, etc.) we fall back
 * to a small set of synthetic events so the preview still illustrates
 * each format's layout.
 */
export async function buildQuietHoursDigestPreview(
  format: QuietHoursDigestFormat,
  opts: {
    eventsSource?: (since: Date) => Promise<DigestEventRow[]>;
    nowMs?: number;
    // Task #776 — honor the recipient's per-user max-events cap so the
    // in-app preview matches what their next live digest will look like.
    // Defaults to 25 to preserve the original preview behavior when the
    // caller does not specify a cap.
    maxEvents?: number;
    // Task #795 — IANA timezone string used to render the digest's
    // window range and per-event timestamps in the recipient's locale
    // (e.g. "America/Los_Angeles"). Defaults to UTC if unset.
    timezone?: string | null;
    // Task #797 — per-recipient locale + 12h/24h + weekday options.
    // When omitted the legacy en-US, 12h, no-weekday rendering is used.
    timestampOptions?: QuietHoursDigestTimestampOptions;
  } = {},
): Promise<{
  subject: string;
  html: string;
  text: string;
  isSynthetic: boolean;
  eventCount: number;
  maxEvents: number;
}> {
  const previewMaxEvents = clampDigestMaxEvents(opts.maxEvents ?? 25);
  const nowMs = opts.nowMs ?? nowFn();
  const lookbackSince = new Date(nowMs - DIGEST_LOOKBACK_MS);
  let events: DigestEventRow[] = [];
  try {
    const fetched = await (opts.eventsSource ?? fetchDigestEventsSince)(lookbackSince);
    events = fetched.slice(-previewMaxEvents);
  } catch (err) {
    logError("Quiet-hours digest preview: failed to load events", { error: String(err) });
    events = [];
  }

  let isSynthetic = false;
  if (events.length === 0) {
    isSynthetic = true;
    const t = (mins: number) => new Date(nowMs - mins * 60 * 1000);
    events = [
      {
        job: "sample.daily-rollup",
        counter: "rows_processed",
        kind: "spike",
        message:
          "Sample: rows_processed spiked to 432 in the last hour (baseline ~25/hr)",
        triggeredAt: t(330),
        emailed: false,
      },
      {
        job: "sample.daily-rollup",
        counter: null,
        kind: "stall",
        message: "Sample: no samples received for 8h (expected within 4h)",
        triggeredAt: t(180),
        emailed: false,
      },
      {
        job: "sample.invoice-sync",
        counter: "errors",
        kind: "spike",
        message:
          "Sample: errors spiked to 18 in the last hour (baseline ~1/hr)",
        triggeredAt: t(90),
        emailed: false,
      },
      {
        job: "sample.invoice-sync",
        counter: "rows_processed",
        kind: "spike",
        message:
          "Sample: rows_processed spiked to 1,204 in the last hour (baseline ~120/hr)",
        triggeredAt: t(60),
        emailed: false,
      },
      {
        job: "sample.email-digest",
        counter: null,
        kind: "stall",
        message: "Sample: no samples received for 14h (expected within 6h)",
        triggeredAt: t(20),
        emailed: false,
      },
    ];
  }

  const windowStart = events.reduce(
    (acc, e) => (acc === null || e.triggeredAt < acc ? e.triggeredAt : acc),
    null as Date | null,
  ) ?? new Date(nowMs);
  const windowEnd = events.reduce(
    (acc, e) => (acc === null || e.triggeredAt > acc ? e.triggeredAt : acc),
    null as Date | null,
  ) ?? new Date(nowMs);

  const { text, html } = buildDigestEmailBody(
    events,
    windowStart,
    windowEnd,
    format,
    opts.timezone ?? null,
    opts.timestampOptions,
  );
  const subject = `[Preview] ${formatDigestSubject(events.length)}`;
  return { subject, html, text, isSynthetic, eventCount: events.length, maxEvents: previewMaxEvents };
}

function escapeHtmlSafe(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface DigestEvaluateOptions {
  /** Override recipient source — primarily for tests. */
  recipientsSource?: () => Promise<QuietHoursDigestRecipient[]>;
  /** Override events source — primarily for tests. */
  eventsSource?: (since: Date) => Promise<DigestEventRow[]>;
  /** Override email send — primarily for tests. */
  sendEmailFn?: typeof sendEmail;
  /** Skip persisting `lastDigestAt` to the database (tests only). */
  skipPersist?: boolean;
  /**
   * Task #760 — Skip the "currently inside quiet window" guard so admins
   * can fire a digest on demand from the dashboard. Also bypasses
   * `digestEnabled` and the missing-quiet-hours guard, falls back to the
   * full lookback window when `lastDigestAt` is unset, and tags the
   * recorded send as a test (still gated by `receivesJobMetricAlertEmails`).
   */
  forceSend?: boolean;
  /**
   * Task #760 — When true, an entry is written to
   * `jobMetricAlertQuietHoursDigestSends` so the dashboard can list it.
   * When false (the default for tests), nothing is recorded.
   */
  recordSends?: boolean;
}

/**
 * Iterate every Super Admin and (where applicable) send a once-per-
 * window digest of alerts that fired while they were inside their
 * quiet-hours window. Safe to run on a frequent cron tick; uses
 * `lastDigestAt` to avoid double-sending.
 */
export async function sendJobMetricAlertQuietHoursDigests(
  opts: DigestEvaluateOptions = {},
): Promise<QuietHoursDigestSummary> {
  const now = nowFn();
  const summary: QuietHoursDigestSummary = {
    evaluatedAt: now,
    recipientsConsidered: 0,
    digestsSent: 0,
    digestsSkippedNoEvents: 0,
    digestsSkippedInQuiet: 0,
    digestsSkippedDisabled: 0,
  };

  let recipients: QuietHoursDigestRecipient[];
  try {
    recipients = await (opts.recipientsSource ?? loadSuperAdminsForDigest)();
  } catch (err) {
    logError("Quiet-hours digest: failed to load recipients", { error: String(err) });
    return summary;
  }
  summary.recipientsConsidered = recipients.length;
  if (recipients.length === 0) return summary;

  const nowDate = new Date(now);
  // Pre-fetch events once for the global lookback window. The lookback
  // is bounded so this is cheap even with many recipients.
  const lookbackSince = new Date(now - DIGEST_LOOKBACK_MS);
  let allEvents: DigestEventRow[] = [];
  try {
    allEvents = await (opts.eventsSource ?? fetchDigestEventsSince)(lookbackSince);
  } catch (err) {
    logError("Quiet-hours digest: failed to load events", { error: String(err) });
    return summary;
  }

  const sendFn = opts.sendEmailFn ?? sendEmail;

  for (const r of recipients) {
    if (!opts.forceSend && !r.digestEnabled) {
      summary.digestsSkippedDisabled++;
      continue;
    }
    // Task #754: respect the existing email opt-out from Task #740 — a
    // Super Admin who silenced job-metric alert emails altogether
    // should not receive the digest either. In-app alerts still fire
    // independently of this path.
    if (!r.receivesJobMetricAlertEmails) {
      summary.digestsSkippedDisabled++;
      continue;
    }
    if (!opts.forceSend && (!r.quietHoursEnabled || !r.quietHoursStart || !r.quietHoursEnd)) {
      // Quiet hours not configured — nothing to digest.
      summary.digestsSkippedDisabled++;
      continue;
    }
    if (!r.email) {
      // No email address — cannot deliver.
      continue;
    }
    if (!opts.forceSend && isInJobMetricAlertQuietWindow(r, nowDate)) {
      // Still inside their quiet window — wait until they exit before
      // sending the digest. This is what gives the "once per window"
      // guarantee: we only send after the window closes.
      summary.digestsSkippedInQuiet++;
      continue;
    }

    const lowerBoundMs = opts.forceSend
      ? lookbackSince.getTime()
      : Math.max(
          lookbackSince.getTime(),
          r.lastDigestAt ? r.lastDigestAt.getTime() : 0,
        );

    // Task #764: collect every matched event so the optional CSV
    // attachment is complete for large windows.
    // Task #776: the in-email body is trimmed to the *most recent* N
    // events (slice(-N) below), where N is the recipient's per-user
    // cap. The lookback window is bounded to 24h so iterating every
    // event in the window is cheap even at high alert volumes.
    const recipientMaxEvents = clampDigestMaxEvents(r.digestMaxEvents);
    const matchedAll: DigestEventRow[] = [];
    let firstTs: number | null = null;
    let lastTs: number | null = null;
    for (const e of allEvents) {
      const ts = e.triggeredAt.getTime();
      if (ts <= lowerBoundMs) continue;
      if (ts > now) continue;
      // Task #760: when forceSend is set, include every event in the
      // lookback window regardless of the recipient's quiet-hours filter
      // so admins can preview a digest even if they aren't currently
      // configured for quiet hours.
      if (!opts.forceSend && !isInJobMetricAlertQuietWindow(r, e.triggeredAt)) continue;
      matchedAll.push(e);
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }
    // `allEvents` is sorted ascending by triggeredAt, so slice(-N)
    // selects the N most recent events while preserving chronological
    // order in the rendered email body.
    const matched =
      matchedAll.length > recipientMaxEvents
        ? matchedAll.slice(-recipientMaxEvents)
        : matchedAll;

    if (matchedAll.length === 0) {
      summary.digestsSkippedNoEvents++;
      // Still bump the high-water mark so future ticks don't re-scan
      // the same empty window forever. Persisting on a quiet-but-empty
      // window keeps the per-tick query cheap.
      if (!opts.skipPersist) {
        try {
          await db
            .update(users)
            .set({ jobMetricAlertQuietHoursLastDigestAt: nowDate })
            .where(eq(users.id, r.id));
        } catch (err) {
          logError("Quiet-hours digest: failed to update lastDigestAt", {
            userId: r.id,
            error: String(err),
          });
        }
      }
      continue;
    }

    const subject = formatDigestSubject(matchedAll.length);
    const windowStart = new Date(firstTs ?? lowerBoundMs);
    const windowEnd = new Date(lastTs ?? now);
    const { text, html } = buildDigestEmailBody(
      matched,
      windowStart,
      windowEnd,
      r.digestFormat,
      r.quietHoursTimezone,
      {
        locale: r.digestLocale,
        timeFormat: r.digestTimeFormat,
        showWeekday: r.digestShowWeekday,
      },
    );

    // Task #764: build a CSV attachment of every matched event when
    // the recipient opted in. Uses the full `matchedAll` list (no
    // 100-event cap) so large windows are still complete.
    const attachments =
      r.digestCsvEnabled && matchedAll.length > 0
        ? [
            {
              filename: buildDigestCsvFilename(windowStart, windowEnd),
              content: Buffer.from(buildDigestCsv(matchedAll), "utf8"),
              contentType: "text/csv",
            },
          ]
        : undefined;

    try {
      const ok = await sendFn({ to: r.email, subject, text, html, attachments });
      if (ok) {
        summary.digestsSent++;
        if (!opts.skipPersist) {
          try {
            await db
              .update(users)
              .set({ jobMetricAlertQuietHoursLastDigestAt: nowDate })
              .where(eq(users.id, r.id));
          } catch (err) {
            logError("Quiet-hours digest: failed to update lastDigestAt", {
              userId: r.id,
              error: String(err),
            });
          }
        }
        // Task #760 — append to the digest sends ledger so the admin
        // dashboard can show recent digests per recipient. We persist
        // even when `skipPersist` is set if the caller asked for sends
        // to be recorded (the test-digest button does so).
        if (opts.recordSends) {
          try {
            await db.insert(jobMetricAlertQuietHoursDigestSends).values({
              userId: r.id,
              recipientEmail: r.email,
              sentAt: nowDate,
              alertCount: matched.length,
              windowStart,
              windowEnd,
              subject,
              isTest: Boolean(opts.forceSend),
            });
          } catch (err) {
            logError("Quiet-hours digest: failed to record send", {
              userId: r.id,
              error: String(err),
            });
          }
        }
      }
    } catch (err) {
      logError("Quiet-hours digest: email delivery failed", {
        userId: r.id,
        error: String(err),
      });
    }
  }

  if (summary.digestsSent > 0 || summary.digestsSkippedNoEvents > 0) {
    logInfo("Quiet-hours digest evaluated", summary as unknown as Record<string, unknown>);
  }
  return summary;
}

// ---------------------------------------------------------------------
// Task #760 — Quiet-hours digest visibility for Super Admins
// ---------------------------------------------------------------------

export interface QuietHoursDigestSendView {
  id: string;
  userId: string;
  recipientName: string | null;
  recipientEmail: string;
  sentAt: number;
  alertCount: number;
  windowStart: number | null;
  windowEnd: number | null;
  subject: string;
  isTest: boolean;
}

export async function listRecentQuietHoursDigestSends(
  limit = 50,
): Promise<QuietHoursDigestSendView[]> {
  const rows = await db
    .select({
      send: jobMetricAlertQuietHoursDigestSends,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(jobMetricAlertQuietHoursDigestSends)
    .leftJoin(users, eq(users.id, jobMetricAlertQuietHoursDigestSends.userId))
    .orderBy(desc(jobMetricAlertQuietHoursDigestSends.sentAt))
    .limit(limit);
  return rows.map(({ send, firstName, lastName, email }) => ({
    id: send.id,
    userId: send.userId,
    recipientName: buildDisplayName(firstName, lastName, email),
    recipientEmail: send.recipientEmail,
    sentAt: new Date(send.sentAt).getTime(),
    alertCount: send.alertCount,
    windowStart: send.windowStart ? new Date(send.windowStart).getTime() : null,
    windowEnd: send.windowEnd ? new Date(send.windowEnd).getTime() : null,
    subject: send.subject,
    isTest: send.isTest,
  }));
}

/**
 * Task #760 — Send a one-off "test" quiet-hours digest to the given
 * Super Admin user. Bypasses the in-quiet-window guard so the admin
 * can preview the digest on demand. Persists the send to the digest
 * ledger (so it shows up in the dashboard) but never updates
 * `lastDigestAt`, ensuring it cannot interfere with the regular
 * digest cadence.
 */
export async function sendTestQuietHoursDigestToUser(
  userId: string,
): Promise<QuietHoursDigestSummary> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      receivesJobMetricAlertEmails: users.receivesJobMetricAlertEmails,
      quietHoursEnabled: users.jobMetricAlertQuietHoursEnabled,
      quietHoursStart: users.jobMetricAlertQuietHoursStart,
      quietHoursEnd: users.jobMetricAlertQuietHoursEnd,
      quietHoursTimezone: users.jobMetricAlertQuietHoursTimezone,
      quietHoursWeekdays: users.jobMetricAlertQuietHoursWeekdays,
      digestEnabled: users.jobMetricAlertQuietHoursDigestEnabled,
      lastDigestAt: users.jobMetricAlertQuietHoursLastDigestAt,
      digestFormat: users.jobMetricAlertQuietHoursDigestFormat,
      digestCsvEnabled: users.jobMetricAlertQuietHoursDigestCsvEnabled,
      digestMaxEvents: users.jobMetricAlertQuietHoursDigestMaxEvents,
      digestLocale: users.jobMetricAlertQuietHoursDigestLocale,
      digestTimeFormat: users.jobMetricAlertQuietHoursDigestTimeFormat,
      digestShowWeekday: users.jobMetricAlertQuietHoursDigestShowWeekday,
    })
    .from(users)
    .where(eq(users.id, userId));
  const [r] = rows;
  if (!r) {
    return {
      evaluatedAt: nowFn(),
      recipientsConsidered: 0,
      digestsSent: 0,
      digestsSkippedNoEvents: 0,
      digestsSkippedInQuiet: 0,
      digestsSkippedDisabled: 0,
    };
  }
  const recipient: QuietHoursDigestRecipient = {
    id: r.id,
    email: r.email,
    receivesJobMetricAlertEmails: r.receivesJobMetricAlertEmails,
    quietHoursEnabled: r.quietHoursEnabled ?? false,
    quietHoursStart: r.quietHoursStart ?? null,
    quietHoursEnd: r.quietHoursEnd ?? null,
    quietHoursTimezone: r.quietHoursTimezone ?? null,
    quietHoursWeekdays: r.quietHoursWeekdays ?? null,
    digestEnabled: r.digestEnabled ?? true,
    lastDigestAt: r.lastDigestAt ? new Date(r.lastDigestAt) : null,
    digestFormat: (r.digestFormat as QuietHoursDigestFormat | null) ?? "full",
    digestCsvEnabled: r.digestCsvEnabled ?? false,
    digestMaxEvents: clampDigestMaxEvents(r.digestMaxEvents),
    digestLocale: r.digestLocale ?? null,
    digestTimeFormat: (r.digestTimeFormat as QuietHoursDigestTimeFormat | null) ?? "12h",
    digestShowWeekday: r.digestShowWeekday ?? false,
  };
  return sendJobMetricAlertQuietHoursDigests({
    recipientsSource: async () => [recipient],
    forceSend: true,
    skipPersist: true,
    recordSends: true,
  });
}

export interface QuietHoursDigestEventView {
  id: string;
  job: string;
  counter: string | null;
  kind: string;
  message: string;
  triggeredAt: number;
  observedValue: string | null;
  baselineValue: string | null;
}

/**
 * Task #760 — Return the underlying `job_metric_alert_events` rows that
 * fell inside a recorded digest send's window. Powers the "View events"
 * expander in the dashboard so it links to real event records (not just
 * an in-memory filter of the rolling alerts feed).
 */
export async function listEventsForQuietHoursDigestSend(
  sendId: string,
): Promise<{ digestId: string; events: QuietHoursDigestEventView[] } | null> {
  const [send] = await db
    .select()
    .from(jobMetricAlertQuietHoursDigestSends)
    .where(eq(jobMetricAlertQuietHoursDigestSends.id, sendId))
    .limit(1);
  if (!send) return null;
  const start = send.windowStart ?? new Date(new Date(send.sentAt).getTime() - 24 * HOUR_MS);
  const end = send.windowEnd ?? new Date(send.sentAt);
  const rows = await db
    .select()
    .from(jobMetricAlertEvents)
    .where(
      and(
        gte(jobMetricAlertEvents.triggeredAt, start),
        lte(jobMetricAlertEvents.triggeredAt, end),
      ),
    )
    .orderBy(desc(jobMetricAlertEvents.triggeredAt))
    .limit(200);
  return {
    digestId: send.id,
    events: rows.map((e) => ({
      id: e.id,
      job: e.job,
      counter: e.counter ?? null,
      kind: e.kind,
      message: e.message,
      triggeredAt: new Date(e.triggeredAt).getTime(),
      observedValue: e.observedValue ?? null,
      baselineValue: e.baselineValue ?? null,
    })),
  };
}

export const ALERT_DEFAULTS = {
  spike: {
    multiplier: DEFAULT_SPIKE_MULTIPLIER,
    minAbsolute: DEFAULT_SPIKE_MIN_ABSOLUTE,
    dedupeMinutes: DEFAULT_DEDUPE_MINUTES,
    emailWhenAbove: DEFAULT_EMAIL_SPIKE_MULTIPLIER,
  },
  stall: {
    hours: DEFAULT_STALL_HOURS,
    dedupeMinutes: DEFAULT_DEDUPE_MINUTES,
    emailWhenAbove: DEFAULT_EMAIL_STALL_HOURS,
  },
} as const;
