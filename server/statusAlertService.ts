import { db } from "./db";
import { sql } from "drizzle-orm";
import { sendEmail } from "./services/emailService";
import { logError, logInfo } from "./utils/logger";

export type AlertConfig = {
  enabled: boolean;
  threshold: number;
  componentKeys: string[];
  emails: string[];
  webhookUrl: string | null;
  repeatHours: number;
  publicUrl: string;
};

export function getAlertConfig(): AlertConfig {
  const disabled = ["1", "true", "yes"].includes(
    (process.env.STATUS_ALERT_DISABLED || "").trim().toLowerCase(),
  );
  const threshold = Math.max(1, parseInt(process.env.STATUS_ALERT_THRESHOLD || "3", 10) || 3);
  const componentKeys = (process.env.STATUS_ALERT_COMPONENT_KEYS || "web")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emails = (process.env.STATUS_ALERT_EMAILS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && /.+@.+\..+/.test(s));
  const webhookUrl = (process.env.STATUS_ALERT_WEBHOOK_URL || "").trim() || null;
  const repeatHours = Math.max(0, parseInt(process.env.STATUS_ALERT_REPEAT_HOURS || "0", 10) || 0);
  const publicUrl =
    process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "") ||
    "https://smartmanageai.ai";
  return {
    enabled: !disabled && (emails.length > 0 || !!webhookUrl),
    threshold,
    componentKeys,
    emails,
    webhookUrl,
    repeatHours,
    publicUrl,
  };
}

type AlertableComponent = { id: string; key: string; name: string };

async function getAlertableComponents(keys: string[]): Promise<AlertableComponent[]> {
  if (keys.length === 0) return [];
  const r = await db.execute(sql`
    SELECT id, key, name FROM "status_components"
    WHERE enabled = true AND lower(key) IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
  `);
  return r.rows as AlertableComponent[];
}

type AlertState = {
  component_id: string;
  is_alerting: boolean;
  consecutive_failures: number;
  opened_at: Date | null;
  last_alert_sent_at: Date | null;
  last_recovery_sent_at: Date | null;
  last_error: string | null;
};

async function getAlertState(componentId: string): Promise<AlertState | null> {
  const r = await db.execute(sql`SELECT * FROM "status_alert_state" WHERE component_id = ${componentId} LIMIT 1`);
  return (r.rows[0] as AlertState | undefined) ?? null;
}

async function upsertAlertState(s: {
  componentId: string;
  isAlerting: boolean;
  consecutiveFailures: number;
  openedAt: Date | null;
  lastAlertSentAt: Date | null;
  lastRecoverySentAt: Date | null;
  lastError: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO "status_alert_state"
      (component_id, is_alerting, consecutive_failures, opened_at, last_alert_sent_at, last_recovery_sent_at, last_error, updated_at)
    VALUES
      (${s.componentId}, ${s.isAlerting}, ${s.consecutiveFailures}, ${s.openedAt}, ${s.lastAlertSentAt}, ${s.lastRecoverySentAt}, ${s.lastError}, NOW())
    ON CONFLICT (component_id) DO UPDATE SET
      is_alerting = EXCLUDED.is_alerting,
      consecutive_failures = EXCLUDED.consecutive_failures,
      opened_at = EXCLUDED.opened_at,
      last_alert_sent_at = EXCLUDED.last_alert_sent_at,
      last_recovery_sent_at = EXCLUDED.last_recovery_sent_at,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
  `);
}

async function recordDispatch(
  componentId: string,
  kind: "down" | "still_down" | "recovered" | "test",
  channel: "email" | "webhook",
  target: string,
  ok: boolean,
  error: string | null,
  consecutiveFailures: number | null,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO "status_alert_dispatches" (component_id, kind, channel, target, ok, error, consecutive_failures)
      VALUES (${componentId}, ${kind}, ${channel}, ${target}, ${ok}, ${error}, ${consecutiveFailures})
    `);
  } catch (err) {
    logError("Failed to record alert dispatch", { componentId, kind, channel }, err instanceof Error ? err : new Error(String(err)));
  }
}

async function dispatchAlert(
  cfg: AlertConfig,
  comp: AlertableComponent,
  kind: "down" | "still_down" | "recovered" | "test",
  details: { consecutiveFailures: number; lastError: string | null; downSinceISO: string | null },
): Promise<void> {
  const titleVerb =
    kind === "down" ? "is DOWN"
    : kind === "still_down" ? "is STILL DOWN"
    : kind === "recovered" ? "has RECOVERED"
    : "ALERT TEST";
  const subject = `[SmartManageAI Status] ${comp.name} ${titleVerb}`;
  const lines = [
    `Component: ${comp.name} (${comp.key})`,
    `Status: ${kind === "recovered" ? "RESOLVED" : kind === "test" ? "TEST" : "FAILING"}`,
    `Consecutive failed probes: ${details.consecutiveFailures}`,
  ];
  if (details.downSinceISO) lines.push(`Down since: ${details.downSinceISO}`);
  if (details.lastError) lines.push(`Last error: ${details.lastError}`);
  lines.push("", `Status page: ${cfg.publicUrl}/status`);
  const text = lines.join("\n");
  const html = `<h2>${comp.name} ${titleVerb}</h2>
<ul>
  <li><strong>Component:</strong> ${comp.name} (<code>${comp.key}</code>)</li>
  <li><strong>Status:</strong> ${kind === "recovered" ? "RESOLVED" : kind === "test" ? "TEST" : "FAILING"}</li>
  <li><strong>Consecutive failed probes:</strong> ${details.consecutiveFailures}</li>
  ${details.downSinceISO ? `<li><strong>Down since:</strong> ${details.downSinceISO}</li>` : ""}
  ${details.lastError ? `<li><strong>Last error:</strong> ${escapeHtml(details.lastError)}</li>` : ""}
</ul>
<p><a href="${cfg.publicUrl}/status">View status page</a></p>`;

  for (const to of cfg.emails) {
    try {
      await sendEmail({ to, subject, text, html });
      await recordDispatch(comp.id, kind, "email", to, true, null, details.consecutiveFailures);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError("Status alert email failed", { to, component: comp.key, kind }, err instanceof Error ? err : new Error(msg));
      await recordDispatch(comp.id, kind, "email", to, false, msg, details.consecutiveFailures);
    }
  }

  if (cfg.webhookUrl) {
    const payload = {
      type: kind === "recovered" ? "status.recovered" : kind === "test" ? "status.test" : "status.down",
      component: { id: comp.id, key: comp.key, name: comp.name },
      consecutiveFailures: details.consecutiveFailures,
      downSince: details.downSinceISO,
      lastError: details.lastError,
      statusPageUrl: `${cfg.publicUrl}/status`,
      timestamp: new Date().toISOString(),
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "SmartManageAI-StatusAlerts/1" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const ok = res.status >= 200 && res.status < 300;
      await recordDispatch(comp.id, kind, "webhook", cfg.webhookUrl, ok, ok ? null : `status ${res.status}`, details.consecutiveFailures);
      if (!ok) logError("Status alert webhook non-2xx", { component: comp.key, kind, status: res.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError("Status alert webhook failed", { component: comp.key, kind }, err instanceof Error ? err : new Error(msg));
      await recordDispatch(comp.id, kind, "webhook", cfg.webhookUrl, false, msg, details.consecutiveFailures);
    } finally {
      clearTimeout(t);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Evaluate consecutive-failure / recovery state for alertable components and
 * dispatch notifications. Idempotent: only fires on transitions (or repeats
 * once STATUS_ALERT_REPEAT_HOURS has elapsed for an unresolved outage).
 */
export async function evaluateAlertsAfterSweep(): Promise<{
  evaluated: number;
  opened: number;
  recovered: number;
  repeated: number;
}> {
  const cfg = getAlertConfig();
  if (!cfg.enabled) {
    return { evaluated: 0, opened: 0, recovered: 0, repeated: 0 };
  }
  const components = await getAlertableComponents(cfg.componentKeys);
  let opened = 0;
  let recovered = 0;
  let repeated = 0;

  for (const comp of components) {
    try {
      // Pull a window large enough to compute the true streak length (not
      // just whether the threshold has been crossed). Capping at 500 keeps
      // the query bounded; if the outage exceeds 500 probes (~8h at 1/min)
      // the engine is still firing on streak >= threshold and reporting
      // streak >= 500 is plenty for ops observability.
      const probesRes = await db.execute(sql`
        SELECT ok, error, checked_at FROM "status_probes"
        WHERE component_id = ${comp.id}
        ORDER BY checked_at DESC
        LIMIT 500
      `);
      const probes = probesRes.rows as Array<{ ok: boolean; error: string | null; checked_at: Date }>;
      if (probes.length === 0) continue;

      const latest = probes[0];
      const state = await getAlertState(comp.id);

      // Compute current consecutive_failures (run from latest backwards
      // until the first OK probe). This is the true streak, not capped at
      // the alert threshold.
      let currentStreak = 0;
      for (const p of probes) {
        if (p.ok === false) currentStreak++;
        else break;
      }
      const failingStreakHits = currentStreak >= cfg.threshold;

      if (failingStreakHits && (!state || !state.is_alerting)) {
        await dispatchAlert(cfg, comp, "down", {
          consecutiveFailures: currentStreak,
          lastError: latest.error,
          downSinceISO: probes[probes.length - 1].checked_at.toISOString(),
        });
        await upsertAlertState({
          componentId: comp.id,
          isAlerting: true,
          consecutiveFailures: currentStreak,
          openedAt: probes[probes.length - 1].checked_at,
          lastAlertSentAt: new Date(),
          lastRecoverySentAt: state?.last_recovery_sent_at ?? null,
          lastError: latest.error,
        });
        opened++;
        logInfo("Status alert opened", { component: comp.key, consecutiveFailures: currentStreak });
      } else if (state?.is_alerting && latest.ok) {
        await dispatchAlert(cfg, comp, "recovered", {
          consecutiveFailures: 0,
          lastError: state.last_error,
          downSinceISO: state.opened_at ? state.opened_at.toISOString() : null,
        });
        await upsertAlertState({
          componentId: comp.id,
          isAlerting: false,
          consecutiveFailures: 0,
          openedAt: null,
          lastAlertSentAt: state.last_alert_sent_at,
          lastRecoverySentAt: new Date(),
          lastError: null,
        });
        recovered++;
        logInfo("Status alert recovered", { component: comp.key });
      } else if (state?.is_alerting && !latest.ok) {
        // Still down. Optionally re-notify.
        const shouldRepeat =
          cfg.repeatHours > 0 &&
          state.last_alert_sent_at &&
          Date.now() - new Date(state.last_alert_sent_at).getTime() >= cfg.repeatHours * 3600 * 1000;
        if (shouldRepeat) {
          await dispatchAlert(cfg, comp, "still_down", {
            consecutiveFailures: currentStreak,
            lastError: latest.error,
            downSinceISO: state.opened_at ? state.opened_at.toISOString() : null,
          });
          repeated++;
        }
        await upsertAlertState({
          componentId: comp.id,
          isAlerting: true,
          consecutiveFailures: currentStreak,
          openedAt: state.opened_at,
          lastAlertSentAt: shouldRepeat ? new Date() : state.last_alert_sent_at,
          lastRecoverySentAt: state.last_recovery_sent_at,
          lastError: latest.error,
        });
      } else {
        // Update streak counter quietly so admin UI / reporting reflects reality.
        await upsertAlertState({
          componentId: comp.id,
          isAlerting: false,
          consecutiveFailures: currentStreak,
          openedAt: null,
          lastAlertSentAt: state?.last_alert_sent_at ?? null,
          lastRecoverySentAt: state?.last_recovery_sent_at ?? null,
          lastError: latest.ok ? null : latest.error,
        });
      }
    } catch (err) {
      logError("Alert evaluation failed", { component: comp.key }, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return { evaluated: components.length, opened, recovered, repeated };
}

export async function sendTestAlert(targetComponentKey?: string): Promise<{
  ok: boolean;
  reason?: string;
  dispatched?: { emails: number; webhook: boolean };
}> {
  const cfg = getAlertConfig();
  if (!cfg.enabled) {
    return { ok: false, reason: "Alerting disabled or no recipients configured" };
  }
  const key = (targetComponentKey || cfg.componentKeys[0] || "web").toLowerCase();
  const comps = await getAlertableComponents([key]);
  if (comps.length === 0) {
    return { ok: false, reason: `No enabled component with key '${key}'` };
  }
  await dispatchAlert(cfg, comps[0], "test", {
    consecutiveFailures: cfg.threshold,
    lastError: "This is a test alert. No outage is in progress.",
    downSinceISO: new Date().toISOString(),
  });
  return { ok: true, dispatched: { emails: cfg.emails.length, webhook: !!cfg.webhookUrl } };
}

export async function getAlertOverview() {
  const cfg = getAlertConfig();
  const stateRows = await db.execute(sql`
    SELECT s.component_id, c.key, c.name, s.is_alerting, s.consecutive_failures,
           s.opened_at, s.last_alert_sent_at, s.last_recovery_sent_at, s.last_error
    FROM "status_alert_state" s
    JOIN "status_components" c ON c.id = s.component_id
    ORDER BY c.sort_order, c.name
  `);
  const recentRes = await db.execute(sql`
    SELECT d.id, d.component_id, c.key AS component_key, c.name AS component_name,
           d.kind, d.channel, d.target, d.ok, d.error, d.consecutive_failures, d.sent_at
    FROM "status_alert_dispatches" d
    JOIN "status_components" c ON c.id = d.component_id
    ORDER BY d.sent_at DESC
    LIMIT 50
  `);
  return {
    config: {
      enabled: cfg.enabled,
      threshold: cfg.threshold,
      componentKeys: cfg.componentKeys,
      recipientCount: cfg.emails.length,
      recipients: cfg.emails,
      webhookConfigured: !!cfg.webhookUrl,
      repeatHours: cfg.repeatHours,
    },
    states: stateRows.rows,
    recentDispatches: recentRes.rows,
  };
}
