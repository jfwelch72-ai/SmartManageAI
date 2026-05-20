import * as cron from "node-cron";
import { and, desc, gte } from "drizzle-orm";
import { db } from "./db";
import { supportTickets } from "@shared/schema";
import { sendEmail } from "./email";
import { logError, logInfo } from "./utils/logger";
import { withSchedulerLock } from "./utils/schedulerLock";
import { runSlaSweep, runSlaRiskAlerts, runAutoAssign } from "./support/slaMonitor";

const REPORT_RECIPIENTS = (process.env.SUPPORT_REPORT_RECIPIENTS || process.env.SUPPORT_INBOX_EMAIL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

interface WeeklyMetrics {
  total: number;
  open: number;
  resolved: number;
  firstResponseBreached: number;
  resolutionBreached: number;
  topSubjects: Array<{ subject: string; count: number }>;
  adherencePct: number;
}

export async function buildWeeklyMetrics(): Promise<WeeklyMetrics> {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000);
  const rows = await db
    .select()
    .from(supportTickets)
    .where(and(gte(supportTickets.createdAt, since)))
    .orderBy(desc(supportTickets.createdAt));

  const total = rows.length;
  const open = rows.filter((r) => r.status === "open" || r.status === "in_progress").length;
  const resolved = rows.filter((r) => r.status === "resolved" || r.status === "closed").length;
  const firstResponseBreached = rows.filter((r) => r.slaFirstResponseBreached === 1).length;
  const resolutionBreached = rows.filter((r) => r.slaResolutionBreached === 1).length;

  const buckets = new Map<string, number>();
  for (const r of rows) {
    const key = r.subject.slice(0, 60);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const topSubjects = [...buckets.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const adherencePct = total === 0 ? 100 : Math.round(((1 - (firstResponseBreached + resolutionBreached) / (total * 2)) * 100));

  return { total, open, resolved, firstResponseBreached, resolutionBreached, topSubjects, adherencePct };
}

function renderReport(m: WeeklyMetrics): { subject: string; text: string; html: string } {
  const subject = `[SmartManageAI] Weekly support report — ${m.total} tickets, ${m.adherencePct}% SLA`;
  const lines = [
    `Weekly support report (last 7 days)`,
    `===================================`,
    ``,
    `Tickets opened:      ${m.total}`,
    `Open / in progress:  ${m.open}`,
    `Resolved / closed:   ${m.resolved}`,
    `First-response SLA breaches: ${m.firstResponseBreached}`,
    `Resolution SLA breaches:     ${m.resolutionBreached}`,
    `Overall SLA adherence:       ${m.adherencePct}%`,
    ``,
    `Top subjects:`,
    ...m.topSubjects.map((t, i) => `  ${i + 1}. (${t.count}) ${t.subject}`),
  ];
  const text = lines.join("\n");
  const html = `<pre style="font-family:ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;">${
    text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))
  }</pre>`;
  return { subject, text, html };
}

export async function runWeeklySupportReport(): Promise<void> {
  if (REPORT_RECIPIENTS.length === 0) {
    logInfo("[support-weekly] no recipients configured (SUPPORT_REPORT_RECIPIENTS), skipping");
    return;
  }
  const metrics = await buildWeeklyMetrics();
  const { subject, text, html } = renderReport(metrics);
  const ok = await sendEmail({ to: REPORT_RECIPIENTS, subject, text, html });
  if (ok) {
    logInfo(`[support-weekly] sent to ${REPORT_RECIPIENTS.length} recipients (${metrics.total} tickets)`);
  } else {
    logError("[support-weekly] failed to deliver report");
  }
}

let weeklyTask: ReturnType<typeof cron.schedule> | null = null;
let sweepTask: ReturnType<typeof cron.schedule> | null = null;
let riskTask: ReturnType<typeof cron.schedule> | null = null;
let autoAssignTask: ReturnType<typeof cron.schedule> | null = null;

export function startSupportWeeklyReportScheduler(): void {
  if (!weeklyTask) {
    // Mondays at 13:00 UTC (~ 09:00 ET / 06:00 PT) — early enough for the
    // team's weekly review.
    weeklyTask = cron.schedule("0 13 * * 1", () => {
      void withSchedulerLock("support-weekly-report", runWeeklySupportReport).catch((err) =>
        logError("[support-weekly] run failed", err),
      );
    });
    logInfo("[support-weekly] scheduler started (cron 0 13 * * 1 UTC)");
  }

  // Hourly: flip breach flags so weekly KPIs and the admin dashboard reflect
  // reality without any manual intervention.
  if (!sweepTask) {
    sweepTask = cron.schedule("0 * * * *", () => {
      void withSchedulerLock("support-sla-sweep", runSlaSweep).catch((err) =>
        logError("[support-sla] sweep run failed", err),
      );
    });
    logInfo("[support-sla] sweep scheduler started (hourly)");
  }

  // Every 15 minutes: proactively warn the support inbox when a ticket is
  // ≥ (org's threshold)% of the way through its first-response window without
  // a reply; also bumps priority and writes to audit_log (Task #2962).
  if (!riskTask) {
    riskTask = cron.schedule("*/15 * * * *", () => {
      void withSchedulerLock("support-sla-risk", runSlaRiskAlerts).catch((err) =>
        logError("[support-sla] risk alert run failed", err),
      );
    });
    logInfo("[support-sla] risk-alert scheduler started (every 15 min)");
  }

  // Hourly: auto-assign unassigned tickets to available agents (Task #2962).
  // Runs at the 30-minute mark so it doesn't compete with the breach sweep.
  if (!autoAssignTask) {
    autoAssignTask = cron.schedule("30 * * * *", () => {
      void withSchedulerLock("support-auto-assign", runAutoAssign).catch((err) =>
        logError("[support-sla] auto-assign run failed", err),
      );
    });
    logInfo("[support-sla] auto-assign scheduler started (every hour at :30)");
  }
}

export function stopSupportWeeklyReportScheduler(): void {
  weeklyTask?.stop();
  sweepTask?.stop();
  riskTask?.stop();
  autoAssignTask?.stop();
  weeklyTask = null;
  sweepTask = null;
  riskTask = null;
  autoAssignTask = null;
}
