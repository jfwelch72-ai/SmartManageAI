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
 * Run the quarterly fetch + diff + alert pipeline. Safe to call ad-hoc
 * (e.g. from an admin endpoint or a one-off `tsx -e` invocation) — does
 * not depend on cron scheduling state.
 */
export async function processDotPayItemsRefresh(): Promise<DotPayItemsRefreshOutcome> {
  logInfo("DOT pay-item refresh starting");
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

  logInfo("DOT pay-item refresh complete", {
    agenciesProcessed: summary.results.length,
    successes: summary.successes,
    failures: summary.failures,
    regressions: regressions.length,
    alertsSent,
  });

  return {
    agenciesProcessed: summary.results.length,
    successes: summary.successes,
    failures: summary.failures,
    regressions: regressions.length,
    alertsSent,
  };
}
