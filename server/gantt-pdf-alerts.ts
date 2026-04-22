import {
  type PdfAlertRecipient,
  type PdfAlertDelivery,
} from "@shared/schema";
import { logError, logInfo } from "./utils/logger";
import { getGanttPdfStats } from "./gantt-pdf-service";
import {
  PDF_ALERT_DELIVERIES_RETENTION_MS,
  addServiceRecipient,
  clearServiceDeliveries,
  dispatchServiceAlert,
  getServiceRecipientSource,
  getServiceRecipients,
  listServiceDeliveries,
  listSharedRecipientsForService,
  pruneOldServiceDeliveries,
  removeServiceRecipient,
  updateSharedRecipient,
  type ListPdfAlertDeliveryFilters,
  type PdfAlertRecipientSource,
  type PdfAlertRecipientView,
} from "./pdf-alerts-shared";

const SERVICE = "gantt" as const;

const ALERT_RATE_LIMIT_MS = 30 * 60 * 1000;
const DISCONNECT_ALERT_THRESHOLD_MS = 2 * 60 * 1000;
const QUEUE_DEPTH_ALERT_RATIO = 1;
const MONITOR_INTERVAL_MS = 30 * 1000;
const DELIVERIES_RETENTION_MS = PDF_ALERT_DELIVERIES_RETENTION_MS;
const DELIVERIES_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

type AlertKind =
  | "queue_full"
  | "browser_disconnected"
  | "queue_drained"
  | "browser_reconnected"
  | "test_alert";

interface AlertState {
  lastSentAt: Map<AlertKind, number>;
  disconnectedSince: number | null;
  notifiedDisconnectAt: number | null;
  queueAlertActive: boolean;
  queueAlertStartedAt: number | null;
  browserDisconnectAlertActive: boolean;
  browserDisconnectAlertStartedAt: number | null;
  monitorTimer: NodeJS.Timeout | null;
  lastTestSentAt: number | null;
  lastPruneAt: number | null;
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
  lastTestSentAt: null,
  lastPruneAt: null,
};

// ---------- Backwards-compatible types ----------
// Kept so importers (routes, tests) don't need to update; both now alias the
// shared types from pdf-alerts-shared.

export type GanttPdfAlertRecipientSource = PdfAlertRecipientSource;
export type GanttPdfAlertRecipientView = PdfAlertRecipientView;

export const GANTT_PDF_ALERT_DELIVERIES_RETENTION_MS = DELIVERIES_RETENTION_MS;

// ---------- Recipient + config queries ----------

export async function getGanttPdfAlertConfig(): Promise<{
  source: GanttPdfAlertRecipientSource;
  recipients: string[];
  recipientDetails: GanttPdfAlertRecipientView[];
  envRecipients: string[];
  rateLimitMs: number;
  disconnectThresholdMs: number;
  lastSent: {
    queueFull: number | null;
    browserDisconnected: number | null;
    queueDrained: number | null;
    browserReconnected: number | null;
    test: number | null;
  };
}> {
  const { source, recipientDetails, envRecipients } =
    await getServiceRecipientSource(SERVICE);
  return {
    source,
    recipients: recipientDetails.map((r) => r.email),
    recipientDetails,
    envRecipients,
    rateLimitMs: ALERT_RATE_LIMIT_MS,
    disconnectThresholdMs: DISCONNECT_ALERT_THRESHOLD_MS,
    lastSent: {
      queueFull: state.lastSentAt.get("queue_full") ?? null,
      browserDisconnected: state.lastSentAt.get("browser_disconnected") ?? null,
      queueDrained: state.lastSentAt.get("queue_drained") ?? null,
      browserReconnected: state.lastSentAt.get("browser_reconnected") ?? null,
      test: state.lastTestSentAt,
    },
  };
}

export async function listGanttPdfAlertRecipients(): Promise<PdfAlertRecipient[]> {
  return listSharedRecipientsForService(SERVICE);
}

export type ListGanttPdfAlertDeliveryFilters = ListPdfAlertDeliveryFilters;

export async function listGanttPdfAlertDeliveries(
  filtersOrLimit: ListPdfAlertDeliveryFilters | number = 20,
): Promise<PdfAlertDelivery[]> {
  return listServiceDeliveries(SERVICE, filtersOrLimit);
}

export async function clearGanttPdfAlertDeliveries(options?: {
  olderThanMs?: number;
}): Promise<number> {
  return clearServiceDeliveries(SERVICE, options);
}

export async function pruneOldGanttPdfAlertDeliveries(): Promise<number> {
  return pruneOldServiceDeliveries(SERVICE);
}

export async function addGanttPdfAlertRecipient(input: {
  email: string;
  notifyInApp?: boolean;
}): Promise<PdfAlertRecipient> {
  return addServiceRecipient(SERVICE, input);
}

export async function updateGanttPdfAlertRecipient(
  id: string,
  patch: { email?: string; notifyInApp?: boolean },
): Promise<PdfAlertRecipient | null> {
  return updateSharedRecipient(id, patch, SERVICE);
}

export async function deleteGanttPdfAlertRecipient(id: string): Promise<boolean> {
  return removeServiceRecipient(SERVICE, id);
}

// ---------- Throttle helpers ----------

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
  opts?: { triggeredBy?: string | null },
): Promise<void> {
  await dispatchServiceAlert(SERVICE, kind, subject, text, html, opts);
}

// ---------- Email body builders ----------

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

function buildTestAlertEmail(triggeredBy: string | null): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "[TEST] Gantt PDF alert recipients verification";
  const who = triggeredBy ? ` by ${triggeredBy}` : "";
  const text =
    `This is a TEST alert from the Gantt PDF health admin page${who}.\n\n` +
    `If you received this email and/or in-app notification, you are correctly ` +
    `configured to receive real Gantt PDF outage alerts (queue-full, browser-disconnected, etc.).\n\n` +
    `No action is required. Real alert cooldowns were not affected by this test.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#2563eb;">[TEST] Gantt PDF alert recipients verification</h2>
      <p>This is a <strong>TEST</strong> alert from the Gantt PDF health admin page${who ? ` (triggered${who})` : ""}.</p>
      <p>If you received this email and/or in-app notification, you are correctly
        configured to receive real Gantt PDF outage alerts (queue-full,
        browser-disconnected, etc.).</p>
      <p style="color:#6b7280;font-size:12px;">No action is required. Real alert
        cooldowns were not affected by this test.</p>
    </div>`;
  return { subject, text, html };
}

export async function sendGanttPdfTestAlert(options?: {
  triggeredBy?: string | null;
}): Promise<{
  recipientCount: number;
  recipients: string[];
  sentAt: number;
}> {
  const recipients = await getServiceRecipients(SERVICE);
  const now = Date.now();
  if (recipients.length === 0) {
    logInfo("Gantt PDF test alert skipped: no recipients configured", {});
    // Even with zero recipients, dispatchServiceAlert still records a
    // delivery row so the audit trail captures the attempt.
    await dispatchAlert(
      "test_alert",
      "[TEST] Gantt PDF alert recipients verification",
      "(no recipients)",
      "<p>(no recipients)</p>",
      { triggeredBy: options?.triggeredBy ?? null },
    );
    return { recipientCount: 0, recipients: [], sentAt: now };
  }
  const { subject, text, html } = buildTestAlertEmail(options?.triggeredBy ?? null);
  logInfo("Sending Gantt PDF test alert", {
    recipientCount: recipients.length,
    triggeredBy: options?.triggeredBy ?? null,
  });
  // Bypass per-kind throttle: dispatchAlert does not consult lastSentAt, and
  // we deliberately do not call markSent() so real alert cooldowns are not
  // reset by this verification.
  await dispatchAlert("test_alert", subject, text, html, {
    triggeredBy: options?.triggeredBy ?? null,
  });
  state.lastTestSentAt = now;
  return {
    recipientCount: recipients.length,
    recipients: recipients.map((r) => r.email),
    sentAt: now,
  };
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

    if (
      state.lastPruneAt === null ||
      now - state.lastPruneAt >= DELIVERIES_PRUNE_INTERVAL_MS
    ) {
      state.lastPruneAt = now;
      void pruneOldGanttPdfAlertDeliveries()
        .then((removed) => {
          if (removed > 0) {
            logInfo("Pruned old Gantt PDF alert deliveries", {
              removed,
              retentionMs: DELIVERIES_RETENTION_MS,
            });
          }
        })
        .catch((err) => {
          logError(
            "Failed to prune old Gantt PDF alert deliveries",
            {},
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    }

    const queueFullThreshold = Math.floor(
      stats.limits.maxQueueLength * QUEUE_DEPTH_ALERT_RATIO,
    );
    const queueIsFull =
      stats.limits.maxQueueLength > 0 &&
      stats.queue.queuedRenders >= queueFullThreshold;
    if (queueIsFull) {
      reportGanttPdfQueueFull();
    } else if (state.queueAlertActive) {
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
        logInfo("Sending Gantt PDF queue-drained recovery alert", { durationMs });
        await dispatchAlert("queue_drained", subject, text, html);
      }
    }

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
      if (state.disconnectedSince !== null) {
        clearGanttPdfBrowserDisconnect();
      }
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
        logInfo("Sending Gantt PDF browser-reconnected recovery alert", { durationMs });
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

export function __resetGanttPdfAlertStateForTests(): void {
  state.lastSentAt.clear();
  state.disconnectedSince = null;
  state.notifiedDisconnectAt = null;
  state.queueAlertActive = false;
  state.queueAlertStartedAt = null;
  state.browserDisconnectAlertActive = false;
  state.browserDisconnectAlertStartedAt = null;
  state.lastTestSentAt = null;
  state.lastPruneAt = null;
}
