/**
 * Task #1948 — Quarterly automated refresh for the verbatim DOT pay-item
 * catalogs that back `server/seedDotAgencies.ts`.
 *
 * Today the JSON catalogs under `server/data/dot/pay-items/<CODE>.json`
 * are produced by hand-running `tsx scripts/fetch-dot-pay-items.ts`
 * whenever an agency posts an updated XLSX/PDF. This job runs the same
 * fetcher pipeline on a quarterly cadence so the catalog tracks the
 * agency's published spec without manual intervention.
 *
 * Per tick we:
 *   1. Snapshot the previously-persisted catalog item counts.
 *   2. Run `runFetcher()` (which honours the same parse / artifact /
 *      < 200-item guards as the CLI script).
 *   3. Compute per-agency added / removed / changed deltas vs the
 *      previous catalog and log them at INFO.
 *   4. Compare each successful catalog's item count against the
 *      `AGENCY_MIN_ITEMS` threshold exported from
 *      `server/seedDotAgencies.ts`. Any agency that drops below its
 *      threshold (or whose fetcher failed outright) is included in a
 *      single alert email to the on-call recipient list.
 *   5. Return counters consumed by `recordJobMetrics()` so the
 *      existing job-status surface ('dot_pay_items_refresh') gets a
 *      per-tick succeeded / failed / coverage_regressions sample.
 */

import { runFetcher, type AgencyRefreshResult } from "../../scripts/fetch-dot-pay-items";
import { AGENCY_MIN_ITEMS } from "../seedDotAgencies";
import { sendEmail } from "../services/emailService";
import { logError, logInfo, logWarn } from "../utils/logger";
import { recordJobMetrics, type JobCounters } from "../utils/jobMetrics";
import { db } from "../db";
import { jobMetricSamples } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

export const DOT_PAY_ITEMS_REFRESH_JOB = "dot_pay_items_refresh";

/**
 * Comma/semicolon/whitespace-separated list of email recipients to notify
 * when a catalog regresses below its `AGENCY_MIN_ITEMS` threshold or its
 * fetcher fails. Falls back to the generic ops alert list so this job
 * piggybacks on the same on-call rotation as the status-page alerts when
 * a dedicated DOT_ALERT_EMAILS isn't set.
 */
function getAlertRecipients(): string[] {
  const raw = process.env.DOT_PAY_ITEM_ALERT_EMAILS || process.env.STATUS_ALERT_EMAILS || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && /.+@.+\..+/.test(s));
}

interface CoverageRegression {
  code: string;
  itemCount: number;
  threshold: number;
  reason: "below_threshold" | "fetcher_failed";
  detail?: string;
}

function findCoverageRegressions(results: AgencyRefreshResult[]): CoverageRegression[] {
  const out: CoverageRegression[] = [];
  for (const r of results) {
    const threshold = AGENCY_MIN_ITEMS[r.code];
    if (threshold === undefined) continue; // No declared coverage expectation for this code.
    if (!r.ok) {
      out.push({
        code: r.code,
        itemCount: r.itemCount,
        threshold,
        reason: "fetcher_failed",
        detail: r.reason,
      });
      continue;
    }
    if (r.itemCount < threshold) {
      out.push({
        code: r.code,
        itemCount: r.itemCount,
        threshold,
        reason: "below_threshold",
      });
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatAlertEmail(regressions: CoverageRegression[], totalAgencies: number): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `[SmartManageAI] DOT pay-item catalog coverage regression (${regressions.length}/${totalAgencies} agencies)`;
  const lines = [
    `${regressions.length} of ${totalAgencies} DOT pay-item catalogs regressed during the quarterly refresh.`,
    "",
    "Agency        | Items   | Threshold | Reason",
    "------------- | ------- | --------- | ------",
  ];
  const rows: string[] = [];
  for (const r of regressions) {
    const reason =
      r.reason === "fetcher_failed"
        ? `fetcher failed${r.detail ? `: ${r.detail}` : ""}`
        : "below AGENCY_MIN_ITEMS";
    lines.push(
      `${r.code.padEnd(13)} | ${String(r.itemCount).padStart(7)} | ${String(r.threshold).padStart(9)} | ${reason}`,
    );
    rows.push(
      `<tr><td><code>${escapeHtml(r.code)}</code></td><td style="text-align:right">${r.itemCount}</td><td style="text-align:right">${r.threshold}</td><td>${escapeHtml(reason)}</td></tr>`,
    );
  }
  lines.push("", "Investigate the affected fetchers in scripts/fetch-dot-pay-items.ts.");
  const text = lines.join("\n");
  const html = `<h2>DOT pay-item catalog coverage regression</h2>
<p>${regressions.length} of ${totalAgencies} catalogs regressed during the quarterly refresh.</p>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">
<thead><tr><th>Agency</th><th>Items</th><th>Threshold</th><th>Reason</th></tr></thead>
<tbody>${rows.join("")}</tbody>
</table>
<p>Investigate the affected fetchers in <code>scripts/fetch-dot-pay-items.ts</code>.</p>`;
  return { subject, text, html };
}

export interface DotPayItemsRefreshOutcome {
  agenciesProcessed: number;
  successes: number;
  failures: number;
  regressions: number;
  alertsSent: number;
}

/**
 * Task #1962 — per-agency record stored on the run-history sample so the
 * admin dashboard can show added/removed/changed deltas per agency
 * without grepping logs.
 */
export interface DotPayItemsRefreshAgencyRecord {
  code: string;
  ok: boolean;
  itemCount: number;
  added: number | null;
  removed: number | null;
  changed: number | null;
  prevCount: number | null;
  wrote: boolean;
  reason: string | null;
}

export interface DotPayItemsRefreshRegressionRecord extends CoverageRegression {}

export interface DotPayItemsRefreshRecord {
  ranAt: string;
  durationMs: number;
  result: {
    agenciesProcessed: number;
    successes: number;
    failures: number;
    regressions: number;
    alertsSent: number;
    agencies: DotPayItemsRefreshAgencyRecord[];
    regressionDetails: DotPayItemsRefreshRegressionRecord[];
  };
}

function toAgencyRecord(r: AgencyRefreshResult): DotPayItemsRefreshAgencyRecord {
  return {
    code: r.code,
    ok: r.ok,
    itemCount: r.itemCount,
    added: r.delta?.added ?? null,
    removed: r.delta?.removed ?? null,
    changed: r.delta?.changed ?? null,
    prevCount: r.delta?.prevCount ?? null,
    wrote: r.wrote,
    reason: r.reason ?? null,
  };
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asBoolean(v: unknown): boolean {
  return v === true;
}

function asNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asNullableString(v: unknown): string | null {
  if (typeof v === "string") return v;
  return null;
}

function rowToHistoryRecord(row: {
  recordedAt: Date | string;
  counters: unknown;
}): DotPayItemsRefreshRecord {
  const c = (row.counters ?? {}) as Record<string, unknown>;
  const rawAgencies = Array.isArray(c.agencies_detail)
    ? (c.agencies_detail as unknown[])
    : [];
  const agencies: DotPayItemsRefreshAgencyRecord[] = rawAgencies.map((a) => {
    const ar = (a ?? {}) as Record<string, unknown>;
    return {
      code: typeof ar.code === "string" ? ar.code : "",
      ok: asBoolean(ar.ok),
      itemCount: asNumber(ar.itemCount),
      added: asNullableNumber(ar.added),
      removed: asNullableNumber(ar.removed),
      changed: asNullableNumber(ar.changed),
      prevCount: asNullableNumber(ar.prevCount),
      wrote: asBoolean(ar.wrote),
      reason: asNullableString(ar.reason),
    };
  });
  const rawRegs = Array.isArray(c.regressionDetails)
    ? (c.regressionDetails as unknown[])
    : [];
  const regressionDetails: DotPayItemsRefreshRegressionRecord[] = rawRegs.map((r) => {
    const rr = (r ?? {}) as Record<string, unknown>;
    const reason = rr.reason === "fetcher_failed" ? "fetcher_failed" : "below_threshold";
    return {
      code: typeof rr.code === "string" ? rr.code : "",
      itemCount: asNumber(rr.itemCount),
      threshold: asNumber(rr.threshold),
      reason,
      detail: typeof rr.detail === "string" ? rr.detail : undefined,
    };
  });
  return {
    ranAt: new Date(row.recordedAt).toISOString(),
    durationMs: asNumber(c.durationMs),
    result: {
      agenciesProcessed: asNumber(c.agencies ?? c.agencies_processed),
      successes: asNumber(c.succeeded ?? c.successes),
      failures: asNumber(c.failed ?? c.failures),
      regressions: asNumber(c.regressions),
      alertsSent: asNumber(c.alertsSent ?? c.alerts_sent),
      agencies,
      regressionDetails,
    },
  };
}

export async function getLastDotPayItemsRefresh(): Promise<DotPayItemsRefreshRecord | null> {
  try {
    const [row] = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, DOT_PAY_ITEMS_REFRESH_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(1);
    return row ? rowToHistoryRecord(row) : null;
  } catch (err) {
    logError("Failed to load last DOT pay-item refresh", { error: String(err) });
    return null;
  }
}

export async function getRecentDotPayItemsRefreshes(
  limit = 10,
): Promise<DotPayItemsRefreshRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const rows = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, DOT_PAY_ITEMS_REFRESH_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(safeLimit);
    return rows.map(rowToHistoryRecord);
  } catch (err) {
    logError("Failed to load recent DOT pay-item refreshes", { error: String(err) });
    return [];
  }
}

/**
 * Run the quarterly fetch + diff + alert pipeline. Safe to call ad-hoc
 * (e.g. from an admin endpoint or a one-off `tsx -e` invocation) — does
 * not depend on cron scheduling state.
 *
 * Task #1962 — also persists a per-run sample to `job_metric_samples`
 * with the per-agency added/removed/changed deltas + the coverage
 * regression list embedded in the JSONB `counters` column so the admin
 * dashboard can render run history without grepping logs. The numeric
 * counters (`agencies`, `succeeded`, `failed`, `regressions`,
 * `alerts_sent`, `durationMs`) are still recorded so the existing
 * Job Metrics surface and alerting engine continue to work.
 */
export async function processDotPayItemsRefresh(): Promise<DotPayItemsRefreshOutcome> {
  logInfo("DOT pay-item refresh starting");
  const startedAt = Date.now();
  const summary = await runFetcher();

  for (const r of summary.results) {
    if (r.ok && r.delta) {
      logInfo("DOT pay-item refresh: agency updated", {
        agency: r.code,
        items: r.itemCount,
        added: r.delta.added,
        removed: r.delta.removed,
        changed: r.delta.changed,
        previousItems: r.delta.prevCount,
        wrote: r.wrote,
      });
    } else if (!r.ok) {
      logWarn("DOT pay-item refresh: agency failed", {
        agency: r.code,
        items: r.itemCount,
        reason: r.reason,
      });
    }
  }

  const regressions = findCoverageRegressions(summary.results);
  let alertsSent = 0;
  if (regressions.length > 0) {
    const recipients = getAlertRecipients();
    if (recipients.length === 0) {
      logWarn(
        "DOT pay-item refresh: coverage regressions detected but no alert recipients configured",
        {
          regressionCount: regressions.length,
          envVarChecked: "DOT_PAY_ITEM_ALERT_EMAILS,STATUS_ALERT_EMAILS",
        },
      );
    } else {
      const { subject, text, html } = formatAlertEmail(regressions, summary.results.length);
      for (const to of recipients) {
        try {
          const ok = await sendEmail({ to, subject, text, html });
          if (ok) {
            alertsSent++;
          } else {
            logError("DOT pay-item refresh: alert email send returned false", { to });
          }
        } catch (err) {
          logError(
            "DOT pay-item refresh: alert email failed",
            { to },
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  logInfo("DOT pay-item refresh complete", {
    agenciesProcessed: summary.results.length,
    successes: summary.successes,
    failures: summary.failures,
    regressions: regressions.length,
    alertsSent,
    durationMs,
  });

  // Task #1962 — record a per-run sample with both the numeric counters
  // (consumed by the JobMetricsHealth dashboard + alert engine) and the
  // per-agency / regression detail (rendered by the Super Admin DOT
  // pay-item refresh history page). The cast through `unknown` is
  // necessary because `JobCounters` is `Record<string, number>` for its
  // numeric consumers — the underlying `job_metric_samples.counters`
  // column is `jsonb`, and the numeric-only aggregation paths in
  // `jobMetrics.ts` already skip non-numeric values defensively.
  const richCounters: Record<string, unknown> = {
    agencies: summary.results.length,
    succeeded: summary.successes,
    failed: summary.failures,
    regressions: regressions.length,
    alerts_sent: alertsSent,
    durationMs,
    agencies_detail: summary.results.map(toAgencyRecord),
    regressionDetails: regressions,
  };
  recordJobMetrics(
    DOT_PAY_ITEMS_REFRESH_JOB,
    richCounters as unknown as JobCounters,
  );

  return {
    agenciesProcessed: summary.results.length,
    successes: summary.successes,
    failures: summary.failures,
    regressions: regressions.length,
    alertsSent,
  };
}
