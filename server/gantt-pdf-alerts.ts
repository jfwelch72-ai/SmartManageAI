import { db } from "./db";
import { users } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { sendEmail } from "./email";
import { insertNotifications } from "./services/notificationService";
import { logError, logInfo } from "./utils/logger";
import { getGanttPdfStats } from "./gantt-pdf-service";

const ALERT_RATE_LIMIT_MS = 30 * 60 * 1000;
const DISCONNECT_ALERT_THRESHOLD_MS = 2 * 60 * 1000;
const QUEUE_DEPTH_ALERT_RATIO = 1;
const MONITOR_INTERVAL_MS = 30 * 1000;

type AlertKind =
  | "queue_full"
  | "browser_disconnected"
  | "queue_drained"
  | "browser_reconnected";

interface AlertState {
  lastSentAt: Map<AlertKind, number>;
  disconnectedSince: number | null;
  notifiedDisconnectAt: number | null;
  queueAlertActive: boolean;
  queueAlertStartedAt: number | null;
  browserDisconnectAlertActive: boolean;
  browserDisconnectAlertStartedAt: number | null;
  monitorTimer: NodeJS.Timeout | null;
}

const state: AlertState = {
  lastSentAt: new Map(),
  disconnectedSince: null,
  notifiedDisconnectAt: null,
  queueAlertActive: false,
  queueAlertStartedAt: null,
  browserDisconnectAlertActive: false,
  browserDisconnectAlertStartedAt: null,
  monitorTimer: null,
};

function parseEnvRecipients(): string[] {
  const raw = process.env.GANTT_PDF_ALERT_EMAILS || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("@"));
}

interface Recipient {
  email: string;
  userId: string | null;
}

async function getRecipients(): Promise<Recipient[]> {
  const envEmails = parseEnvRecipients();
  if (envEmails.length > 0) {
    return envEmails.map((email) => ({ email, userId: null }));
  }
  try {
    const admins = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true)));
    return admins
      .filter((a) => !!a.email)
      .map((a) => ({ email: a.email, userId: a.id }));
  } catch (err) {
    logError(
      "Failed to load SUPER_ADMIN users for Gantt PDF alerts",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

export async function getGanttPdfAlertConfig(): Promise<{
  source: "env" | "super_admins";
  recipients: string[];
  rateLimitMs: number;
  disconnectThresholdMs: number;
  lastSent: {
    queueFull: number | null;
    browserDisconnected: number | null;
    queueDrained: number | null;
    browserReconnected: number | null;
  };
}> {
  const envEmails = parseEnvRecipients();
  let recipients: string[];
  let source: "env" | "super_admins";
  if (envEmails.length > 0) {
    recipients = envEmails;
    source = "env";
  } else {
    const list = await getRecipients();
    recipients = list.map((r) => r.email);
    source = "super_admins";
  }
  return {
    source,
    recipients,
    rateLimitMs: ALERT_RATE_LIMIT_MS,
    disconnectThresholdMs: DISCONNECT_ALERT_THRESHOLD_MS,
    lastSent: {
      queueFull: state.lastSentAt.get("queue_full") ?? null,
      browserDisconnected: state.lastSentAt.get("browser_disconnected") ?? null,
      queueDrained: state.lastSentAt.get("queue_drained") ?? null,
      browserReconnected: state.lastSentAt.get("browser_reconnected") ?? null,
    },
  };
}

function shouldSend(kind: AlertKind, now: number): boolean {
  const last = state.lastSentAt.get(kind);
  if (!last) return true;
  return now - last >= ALERT_RATE_LIMIT_MS;
}

function markSent(kind: AlertKind, now: number): void {
  state.lastSentAt.set(kind, now);
}

async function dispatchAlert(
  kind: AlertKind,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const recipients = await getRecipients();
  if (recipients.length === 0) {
    logInfo("Gantt PDF alert skipped: no recipients configured", { kind });
    return;
  }

  const emailTargets = recipients.map((r) => r.email);
  try {
    const ok = await sendEmail({
      to: emailTargets,
      subject,
      text,
      html,
    });
    if (!ok) {
      logError("Gantt PDF alert email returned false", { kind, recipientCount: emailTargets.length });
    }
  } catch (err) {
    logError(
      "Failed to send Gantt PDF alert email",
      { kind },
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  const userIds = recipients.map((r) => r.userId).filter((id): id is string => !!id);
  if (userIds.length > 0) {
    try {
      await insertNotifications(
        userIds.map((userId) => ({
          userId,
          type: "GENERAL",
          title: subject,
          message: text,
          relatedEntityType: "gantt_pdf_alert",
          relatedEntityId: kind,
        })),
      );
    } catch (err) {
      logError(
        "Failed to insert Gantt PDF alert notifications",
        { kind, userCount: userIds.length },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

function buildQueueFullEmail(stats: ReturnType<typeof getGanttPdfStats>): {
  subject: string;
  text: string;
  html: string;
} {
  const { queue, limits } = stats;
  const subject = "Gantt PDF render queue is full";
  const text =
    `The Gantt PDF render queue is at capacity and is rejecting new requests.\n\n` +
    `Active renders: ${queue.activeRenders} / ${limits.maxConcurrentRenders}\n` +
    `Queued renders: ${queue.queuedRenders} / ${limits.maxQueueLength}\n\n` +
    `Users may see PDF export failures until the queue drains. ` +
    `Visit the Gantt PDF health admin page to investigate.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#b91c1c;">Gantt PDF render queue is full</h2>
      <p>The Gantt PDF render queue is at capacity and is rejecting new requests.</p>
      <ul>
        <li><strong>Active renders:</strong> ${queue.activeRenders} / ${limits.maxConcurrentRenders}</li>
        <li><strong>Queued renders:</strong> ${queue.queuedRenders} / ${limits.maxQueueLength}</li>
      </ul>
      <p>Users may see PDF export failures until the queue drains. Visit the
        <em>Gantt PDF health</em> admin page to investigate or recycle the cached browser.</p>
      <p style="color:#6b7280;font-size:12px;">Further alerts of this type will be suppressed for ${Math.round(
        ALERT_RATE_LIMIT_MS / 60000,
      )} minutes.</p>
    </div>`;
  return { subject, text, html };
}

function buildDisconnectEmail(disconnectedForMs: number): {
  subject: string;
  text: string;
  html: string;
} {
  const minutes = Math.max(1, Math.round(disconnectedForMs / 60000));
  const subject = "Gantt PDF browser is disconnected";
  const text =
    `The cached Chromium used to render Gantt PDFs has been disconnected for ` +
    `${minutes} minute${minutes === 1 ? "" : "s"}.\n\n` +
    `The next PDF render will attempt to launch a fresh browser, but repeated ` +
    `failures may indicate an environment problem (missing Chromium, OOM, ` +
    `sandbox issue, etc.). Visit the Gantt PDF health admin page to investigate.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#b91c1c;">Gantt PDF browser is disconnected</h2>
      <p>The cached Chromium used to render Gantt PDFs has been disconnected for
        <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>.</p>
      <p>The next PDF render will attempt to launch a fresh browser, but repeated
        failures may indicate an environment problem (missing Chromium, OOM,
        sandbox issue, etc.). Visit the <em>Gantt PDF health</em> admin page to
        investigate.</p>
      <p style="color:#6b7280;font-size:12px;">Further alerts of this type will be suppressed for ${Math.round(
        ALERT_RATE_LIMIT_MS / 60000,
      )} minutes.</p>
    </div>`;
  return { subject, text, html };
}

function buildQueueDrainedEmail(
  stats: ReturnType<typeof getGanttPdfStats>,
  durationMs: number,
): { subject: string; text: string; html: string } {
  const { queue, limits } = stats;
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const subject = "Gantt PDF render queue has drained";
  const text =
    `The Gantt PDF render queue has returned to a healthy depth.\n\n` +
    `Active renders: ${queue.activeRenders} / ${limits.maxConcurrentRenders}\n` +
    `Queued renders: ${queue.queuedRenders} / ${limits.maxQueueLength}\n\n` +
    `The previous queue-full incident lasted about ${minutes} minute${
      minutes === 1 ? "" : "s"
    }. New PDF requests should once again be accepted normally.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#15803d;">Gantt PDF render queue has drained</h2>
      <p>The Gantt PDF render queue has returned to a healthy depth.</p>
      <ul>
        <li><strong>Active renders:</strong> ${queue.activeRenders} / ${limits.maxConcurrentRenders}</li>
        <li><strong>Queued renders:</strong> ${queue.queuedRenders} / ${limits.maxQueueLength}</li>
      </ul>
      <p>The previous queue-full incident lasted about
        <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>.
        New PDF requests should once again be accepted normally.</p>
      <p style="color:#6b7280;font-size:12px;">Further alerts of this type will be suppressed for ${Math.round(
        ALERT_RATE_LIMIT_MS / 60000,
      )} minutes to avoid flapping notifications.</p>
    </div>`;
  return { subject, text, html };
}

function buildBrowserReconnectedEmail(durationMs: number): {
  subject: string;
  text: string;
  html: string;
} {
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const subject = "Gantt PDF browser has reconnected";
  const text =
    `A fresh cached Chromium for Gantt PDF rendering is back online and healthy.\n\n` +
    `The previous browser-disconnected incident lasted about ${minutes} minute${
      minutes === 1 ? "" : "s"
    }. PDF exports should now succeed again.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#15803d;">Gantt PDF browser has reconnected</h2>
      <p>A fresh cached Chromium for Gantt PDF rendering is back online and
        healthy.</p>
      <p>The previous browser-disconnected incident lasted about
        <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>.
        PDF exports should now succeed again.</p>
      <p style="color:#6b7280;font-size:12px;">Further alerts of this type will be suppressed for ${Math.round(
        ALERT_RATE_LIMIT_MS / 60000,
      )} minutes to avoid flapping notifications.</p>
    </div>`;
  return { subject, text, html };
}

export function reportGanttPdfQueueFull(): void {
  const now = Date.now();
  if (!shouldSend("queue_full", now)) return;
  markSent("queue_full", now);
  if (!state.queueAlertActive) {
    state.queueAlertActive = true;
    state.queueAlertStartedAt = now;
  }
  const stats = getGanttPdfStats();
  const { subject, text, html } = buildQueueFullEmail(stats);
  logInfo("Sending Gantt PDF queue-full alert", {
    queued: stats.queue.queuedRenders,
    active: stats.queue.activeRenders,
  });
  void dispatchAlert("queue_full", subject, text, html);
}

export function reportGanttPdfBrowserDisconnected(disconnectedAt: number): void {
  // Track when we first noticed the disconnect; the monitor decides when to
  // actually send an alert based on DISCONNECT_ALERT_THRESHOLD_MS.
  if (state.disconnectedSince === null) {
    state.disconnectedSince = disconnectedAt;
  }
}

export function clearGanttPdfBrowserDisconnect(): void {
  state.disconnectedSince = null;
  state.notifiedDisconnectAt = null;
}

async function runMonitorTick(): Promise<void> {
  try {
    const stats = getGanttPdfStats();
    const now = Date.now();

    // Queue depth: alert when queue is at capacity and has at least one waiter.
    const queueFullThreshold = Math.floor(
      stats.limits.maxQueueLength * QUEUE_DEPTH_ALERT_RATIO,
    );
    const queueIsFull =
      stats.limits.maxQueueLength > 0 &&
      stats.queue.queuedRenders >= queueFullThreshold;
    if (queueIsFull) {
      reportGanttPdfQueueFull();
    } else if (state.queueAlertActive) {
      // Recovery: queue has dropped below capacity since the last queue-full
      // alert. Treat "healthy" as queue empty AND not all worker slots in use,
      // so we don't ping the all-clear at the moment we just barely dipped
      // below capacity (helps mitigate flapping).
      const queueIsHealthy =
        stats.queue.queuedRenders === 0 &&
        stats.queue.activeRenders < stats.limits.maxConcurrentRenders;
      if (queueIsHealthy && shouldSend("queue_drained", now)) {
        markSent("queue_drained", now);
        const startedAt = state.queueAlertStartedAt ?? now;
        const durationMs = Math.max(0, now - startedAt);
        state.queueAlertActive = false;
        state.queueAlertStartedAt = null;
        const { subject, text, html } = buildQueueDrainedEmail(stats, durationMs);
        logInfo("Sending Gantt PDF queue-drained recovery alert", {
          durationMs,
        });
        await dispatchAlert("queue_drained", subject, text, html);
      }
    }

    // Browser disconnect: only alert if a browser was previously cached and is
    // now disconnected (not just absent because no PDFs have been rendered yet).
    const cb = stats.cachedBrowser;
    if (cb.present && !cb.connected && !cb.recycling) {
      if (state.disconnectedSince === null) {
        state.disconnectedSince = now;
      }
      const downFor = now - state.disconnectedSince;
      const alreadyNotified =
        state.notifiedDisconnectAt !== null &&
        state.notifiedDisconnectAt >= state.disconnectedSince;
      if (
        downFor >= DISCONNECT_ALERT_THRESHOLD_MS &&
        !alreadyNotified &&
        shouldSend("browser_disconnected", now)
      ) {
        markSent("browser_disconnected", now);
        state.notifiedDisconnectAt = now;
        if (!state.browserDisconnectAlertActive) {
          state.browserDisconnectAlertActive = true;
          state.browserDisconnectAlertStartedAt = state.disconnectedSince;
        }
        const { subject, text, html } = buildDisconnectEmail(downFor);
        logInfo("Sending Gantt PDF browser-disconnected alert", {
          downForMs: downFor,
        });
        await dispatchAlert("browser_disconnected", subject, text, html);
      }
    } else {
      // Cleared (browser absent, reconnected, or recycling on purpose).
      if (state.disconnectedSince !== null) {
        clearGanttPdfBrowserDisconnect();
      }
      // Recovery: only fire if we previously notified about a disconnect and a
      // healthy cached browser is back online (present + connected + not
      // mid-recycle). A merely-absent browser does not count as "recovered".
      if (
        state.browserDisconnectAlertActive &&
        cb.present &&
        cb.connected &&
        !cb.recycling &&
        shouldSend("browser_reconnected", now)
      ) {
        markSent("browser_reconnected", now);
        const startedAt = state.browserDisconnectAlertStartedAt ?? now;
        const durationMs = Math.max(0, now - startedAt);
        state.browserDisconnectAlertActive = false;
        state.browserDisconnectAlertStartedAt = null;
        const { subject, text, html } = buildBrowserReconnectedEmail(durationMs);
        logInfo("Sending Gantt PDF browser-reconnected recovery alert", {
          durationMs,
        });
        await dispatchAlert("browser_reconnected", subject, text, html);
      }
    }
  } catch (err) {
    logError(
      "Gantt PDF alert monitor tick failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export function startGanttPdfHealthMonitor(): void {
  if (state.monitorTimer) return;
  state.monitorTimer = setInterval(() => {
    void runMonitorTick();
  }, MONITOR_INTERVAL_MS);
  if (typeof state.monitorTimer.unref === "function") {
    state.monitorTimer.unref();
  }
  logInfo("Started Gantt PDF health monitor", {
    intervalMs: MONITOR_INTERVAL_MS,
    disconnectThresholdMs: DISCONNECT_ALERT_THRESHOLD_MS,
  });
}

export function stopGanttPdfHealthMonitor(): void {
  if (state.monitorTimer) {
    clearInterval(state.monitorTimer);
    state.monitorTimer = null;
  }
}

// Exposed for tests to reset internal state.
export function __resetGanttPdfAlertStateForTests(): void {
  state.lastSentAt.clear();
  state.disconnectedSince = null;
  state.notifiedDisconnectAt = null;
  state.queueAlertActive = false;
  state.queueAlertStartedAt = null;
  state.browserDisconnectAlertActive = false;
  state.browserDisconnectAlertStartedAt = null;
}
