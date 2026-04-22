import { db } from "./db";
import {
  users,
  portfolioPdfAlertRecipients,
  portfolioPdfAlertDeliveries,
  type PortfolioPdfAlertRecipient,
  type PortfolioPdfAlertDelivery,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { sendEmail } from "./email";
import { insertNotifications } from "./services/notificationService";
import { logError, logInfo } from "./utils/logger";
import {
  isPortfolioRendererAvailable,
  getPortfolioRendererStatus,
  setPortfolioPdfAlertDispatcher,
  onPortfolioPdfBrowserDisconnected,
  evaluatePortfolioPdfAlerts,
  type PortfolioPdfAlertEvent,
} from "./portfolio-pdf-service";

const ALERT_RATE_LIMIT_MS = 30 * 60 * 1000;
const UNAVAILABLE_ALERT_THRESHOLD_MS = 2 * 60 * 1000;
const MONITOR_INTERVAL_MS = 60 * 1000;
const AVAILABILITY_PROBE_INTERVAL_MS = 5 * 60 * 1000;
const DELIVERIES_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERIES_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

type AlertKind =
  | "renderer_unavailable"
  | "renderer_recovered"
  | "browser_disconnected"
  | "failure_rate"
  | "test_alert";

interface AlertState {
  lastSentAt: Map<AlertKind, number>;
  unavailableSince: number | null;
  notifiedUnavailableAt: number | null;
  unavailableAlertActive: boolean;
  unavailableAlertStartedAt: number | null;
  disconnectedSince: number | null;
  monitorTimer: NodeJS.Timeout | null;
  lastAvailabilityProbeAt: number | null;
  lastTestSentAt: number | null;
  lastPruneAt: number | null;
}

const state: AlertState = {
  lastSentAt: new Map(),
  unavailableSince: null,
  notifiedUnavailableAt: null,
  unavailableAlertActive: false,
  unavailableAlertStartedAt: null,
  disconnectedSince: null,
  monitorTimer: null,
  lastAvailabilityProbeAt: null,
  lastTestSentAt: null,
  lastPruneAt: null,
};

function parseEnvRecipients(): string[] {
  const raw = process.env.PORTFOLIO_PDF_ALERT_EMAILS || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("@"));
}

interface Recipient {
  email: string;
  userId: string | null;
  notifyInApp: boolean;
}

async function listDbRecipients(): Promise<PortfolioPdfAlertRecipient[]> {
  try {
    return await db
      .select()
      .from(portfolioPdfAlertRecipients)
      .orderBy(asc(portfolioPdfAlertRecipients.email));
  } catch (err) {
    logError(
      "Failed to load Portfolio PDF alert recipients from database",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

async function resolveUserIdsForEmails(emails: string[]): Promise<Map<string, string>> {
  const lower = emails.map((e) => e.toLowerCase()).filter((e) => e.length > 0);
  if (lower.length === 0) return new Map();
  try {
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(inArray(sql`lower(${users.email})`, lower), eq(users.isActive, true)));
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.email) map.set(r.email.toLowerCase(), r.id);
    }
    return map;
  } catch (err) {
    logError(
      "Failed to resolve userIds for Portfolio PDF alert recipients",
      { emailCount: lower.length },
      err instanceof Error ? err : new Error(String(err)),
    );
    return new Map();
  }
}

async function getRecipients(): Promise<Recipient[]> {
  const dbRows = await listDbRecipients();
  if (dbRows.length > 0) {
    const missingUserEmails = dbRows.filter((r) => !r.userId).map((r) => r.email);
    const lookup = missingUserEmails.length
      ? await resolveUserIdsForEmails(missingUserEmails)
      : new Map<string, string>();
    return dbRows.map((r) => ({
      email: r.email,
      userId: r.userId ?? lookup.get(r.email.toLowerCase()) ?? null,
      notifyInApp: r.notifyInApp,
    }));
  }
  const envEmails = parseEnvRecipients();
  if (envEmails.length > 0) {
    const lookup = await resolveUserIdsForEmails(envEmails);
    return envEmails.map((email) => ({
      email,
      userId: lookup.get(email.toLowerCase()) ?? null,
      notifyInApp: true,
    }));
  }
  try {
    const admins = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true)));
    return admins
      .filter((a) => !!a.email)
      .map((a) => ({ email: a.email, userId: a.id, notifyInApp: true }));
  } catch (err) {
    logError(
      "Failed to load SUPER_ADMIN users for Portfolio PDF alerts",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

export type PortfolioPdfAlertRecipientSource = "database" | "env" | "super_admins";

export interface PortfolioPdfAlertRecipientView {
  id: string | null;
  email: string;
  notifyInApp: boolean;
  userId: string | null;
}

export async function getPortfolioPdfAlertRecipientConfig(): Promise<{
  source: PortfolioPdfAlertRecipientSource;
  recipients: string[];
  recipientDetails: PortfolioPdfAlertRecipientView[];
  envRecipients: string[];
  rateLimitMs: number;
  unavailableThresholdMs: number;
  lastSent: {
    rendererUnavailable: number | null;
    rendererRecovered: number | null;
    browserDisconnected: number | null;
    failureRate: number | null;
    test: number | null;
  };
}> {
  const envEmails = parseEnvRecipients();
  const dbRows = await listDbRecipients();
  let source: PortfolioPdfAlertRecipientSource;
  let recipientDetails: PortfolioPdfAlertRecipientView[];
  if (dbRows.length > 0) {
    source = "database";
    recipientDetails = dbRows.map((r) => ({
      id: r.id,
      email: r.email,
      notifyInApp: r.notifyInApp,
      userId: r.userId,
    }));
  } else if (envEmails.length > 0) {
    source = "env";
    recipientDetails = envEmails.map((email) => ({
      id: null,
      email,
      notifyInApp: true,
      userId: null,
    }));
  } else {
    source = "super_admins";
    const list = await getRecipients();
    recipientDetails = list.map((r) => ({
      id: null,
      email: r.email,
      notifyInApp: r.notifyInApp,
      userId: r.userId,
    }));
  }
  return {
    source,
    recipients: recipientDetails.map((r) => r.email),
    recipientDetails,
    envRecipients: envEmails,
    rateLimitMs: ALERT_RATE_LIMIT_MS,
    unavailableThresholdMs: UNAVAILABLE_ALERT_THRESHOLD_MS,
    lastSent: {
      rendererUnavailable: state.lastSentAt.get("renderer_unavailable") ?? null,
      rendererRecovered: state.lastSentAt.get("renderer_recovered") ?? null,
      browserDisconnected: state.lastSentAt.get("browser_disconnected") ?? null,
      failureRate: state.lastSentAt.get("failure_rate") ?? null,
      test: state.lastTestSentAt,
    },
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listPortfolioPdfAlertRecipients(): Promise<PortfolioPdfAlertRecipient[]> {
  return listDbRecipients();
}

export interface ListPortfolioPdfAlertDeliveryFilters {
  limit?: number;
  kinds?: string[];
  emailSuccess?: boolean;
  sinceMs?: number;
}

export async function listPortfolioPdfAlertDeliveries(
  filtersOrLimit: ListPortfolioPdfAlertDeliveryFilters | number = 20,
): Promise<PortfolioPdfAlertDelivery[]> {
  const filters: ListPortfolioPdfAlertDeliveryFilters =
    typeof filtersOrLimit === "number" ? { limit: filtersOrLimit } : filtersOrLimit;
  const safeLimit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 20)));
  try {
    const conditions: SQL[] = [];
    if (filters.kinds && filters.kinds.length > 0) {
      conditions.push(inArray(portfolioPdfAlertDeliveries.kind, filters.kinds));
    }
    if (typeof filters.emailSuccess === "boolean") {
      conditions.push(eq(portfolioPdfAlertDeliveries.emailSuccess, filters.emailSuccess));
    }
    if (typeof filters.sinceMs === "number" && filters.sinceMs > 0) {
      conditions.push(
        gte(portfolioPdfAlertDeliveries.createdAt, new Date(Date.now() - filters.sinceMs)),
      );
    }
    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);
    return await db
      .select()
      .from(portfolioPdfAlertDeliveries)
      .where(whereClause)
      .orderBy(desc(portfolioPdfAlertDeliveries.createdAt))
      .limit(safeLimit);
  } catch (err) {
    logError(
      "Failed to load Portfolio PDF alert deliveries",
      { limit: safeLimit },
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

export async function clearPortfolioPdfAlertDeliveries(options?: {
  olderThanMs?: number;
}): Promise<number> {
  try {
    const olderThanMs = options?.olderThanMs;
    if (typeof olderThanMs === "number" && olderThanMs > 0) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const rows = await db
        .delete(portfolioPdfAlertDeliveries)
        .where(lt(portfolioPdfAlertDeliveries.createdAt, cutoff))
        .returning({ id: portfolioPdfAlertDeliveries.id });
      return rows.length;
    }
    const rows = await db
      .delete(portfolioPdfAlertDeliveries)
      .returning({ id: portfolioPdfAlertDeliveries.id });
    return rows.length;
  } catch (err) {
    logError(
      "Failed to clear Portfolio PDF alert deliveries",
      { olderThanMs: options?.olderThanMs ?? null },
      err instanceof Error ? err : new Error(String(err)),
    );
    return 0;
  }
}

export async function pruneOldPortfolioPdfAlertDeliveries(): Promise<number> {
  return clearPortfolioPdfAlertDeliveries({ olderThanMs: DELIVERIES_RETENTION_MS });
}

export const PORTFOLIO_PDF_ALERT_DELIVERIES_RETENTION_MS = DELIVERIES_RETENTION_MS;

export async function addPortfolioPdfAlertRecipient(input: {
  email: string;
  notifyInApp?: boolean;
}): Promise<PortfolioPdfAlertRecipient> {
  const email = normalizeEmail(input.email);
  const lookup = await resolveUserIdsForEmails([email]);
  const [row] = await db
    .insert(portfolioPdfAlertRecipients)
    .values({
      email,
      notifyInApp: input.notifyInApp ?? true,
      userId: lookup.get(email) ?? null,
    })
    .returning();
  return row;
}

export async function updatePortfolioPdfAlertRecipient(
  id: string,
  patch: { email?: string; notifyInApp?: boolean },
): Promise<PortfolioPdfAlertRecipient | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.notifyInApp === "boolean") updates.notifyInApp = patch.notifyInApp;
  if (typeof patch.email === "string" && patch.email.trim().length > 0) {
    const email = normalizeEmail(patch.email);
    updates.email = email;
    const lookup = await resolveUserIdsForEmails([email]);
    updates.userId = lookup.get(email) ?? null;
  }
  const [row] = await db
    .update(portfolioPdfAlertRecipients)
    .set(updates)
    .where(eq(portfolioPdfAlertRecipients.id, id))
    .returning();
  return row ?? null;
}

export async function deletePortfolioPdfAlertRecipient(id: string): Promise<boolean> {
  const rows = await db
    .delete(portfolioPdfAlertRecipients)
    .where(eq(portfolioPdfAlertRecipients.id, id))
    .returning({ id: portfolioPdfAlertRecipients.id });
  return rows.length > 0;
}

function shouldSend(kind: AlertKind, now: number): boolean {
  const last = state.lastSentAt.get(kind);
  if (!last) return true;
  return now - last >= ALERT_RATE_LIMIT_MS;
}

function markSent(kind: AlertKind, now: number): void {
  state.lastSentAt.set(kind, now);
}

async function recordDelivery(
  kind: AlertKind,
  emailTargets: string[],
  emailSuccess: boolean,
  errorMessage: string | null,
  triggeredBy: string | null,
): Promise<void> {
  try {
    await db.insert(portfolioPdfAlertDeliveries).values({
      kind,
      recipients: emailTargets,
      recipientCount: emailTargets.length,
      emailSuccess,
      errorMessage,
      triggeredBy,
    });
  } catch (err) {
    logError(
      "Failed to persist Portfolio PDF alert delivery record",
      { kind, recipientCount: emailTargets.length },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

async function dispatchAlert(
  kind: AlertKind,
  subject: string,
  text: string,
  html: string,
  opts?: { triggeredBy?: string | null },
): Promise<void> {
  const triggeredBy = opts?.triggeredBy ?? null;
  const recipients = await getRecipients();
  if (recipients.length === 0) {
    logInfo("Portfolio PDF alert skipped: no recipients configured", { kind });
    await recordDelivery(kind, [], false, "No recipients configured", triggeredBy);
    return;
  }
  const emailTargets = recipients.map((r) => r.email);
  let emailSuccess = false;
  let errorMessage: string | null = null;
  try {
    const ok = await sendEmail({ to: emailTargets, subject, text, html });
    emailSuccess = ok;
    if (!ok) {
      errorMessage = "Email transport returned false";
      logError("Portfolio PDF alert email returned false", { kind, recipientCount: emailTargets.length });
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logError(
      "Failed to send Portfolio PDF alert email",
      { kind },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
  await recordDelivery(kind, emailTargets, emailSuccess, errorMessage, triggeredBy);

  const userIds = recipients
    .filter((r) => r.notifyInApp && !!r.userId)
    .map((r) => r.userId as string);
  if (userIds.length > 0) {
    try {
      await insertNotifications(
        userIds.map((userId) => ({
          userId,
          type: "GENERAL",
          title: subject,
          message: text,
          relatedEntityType: "portfolio_pdf_alert",
          relatedEntityId: kind,
        })),
      );
    } catch (err) {
      logError(
        "Failed to insert Portfolio PDF alert notifications",
        { kind, userCount: userIds.length },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

function buildUnavailableEmail(downForMs: number, errorMessage: string | null): {
  subject: string; text: string; html: string;
} {
  const minutes = Math.max(1, Math.round(downForMs / 60000));
  const subject = "Portfolio PDF renderer is unavailable";
  const text =
    `The Portfolio PDF renderer (headless Chromium) has been unable to launch ` +
    `for ${minutes} minute${minutes === 1 ? "" : "s"}.\n\n` +
    (errorMessage ? `Last error: ${errorMessage}\n\n` : "") +
    `Users requesting /api/portfolio/summary-pdf will see export failures or ` +
    `HTML fallbacks until the renderer comes back online. Visit the Portfolio ` +
    `PDF health admin page to investigate.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#b91c1c;">Portfolio PDF renderer is unavailable</h2>
      <p>The Portfolio PDF renderer (headless Chromium) has been unable to launch for
        <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>.</p>
      ${errorMessage ? `<p><strong>Last error:</strong> <code>${errorMessage}</code></p>` : ""}
      <p>Users requesting <code>/api/portfolio/summary-pdf</code> will see export
        failures or HTML fallbacks until the renderer comes back online. Visit
        the <em>Portfolio PDF health</em> admin page to investigate.</p>
      <p style="color:#6b7280;font-size:12px;">Further alerts of this type will be suppressed for ${Math.round(
        ALERT_RATE_LIMIT_MS / 60000,
      )} minutes.</p>
    </div>`;
  return { subject, text, html };
}

function buildRecoveredEmail(durationMs: number): { subject: string; text: string; html: string } {
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const subject = "Portfolio PDF renderer has recovered";
  const text =
    `The Portfolio PDF renderer is back online and healthy.\n\n` +
    `The previous outage lasted about ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
    `Portfolio PDF exports should now succeed again.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#15803d;">Portfolio PDF renderer has recovered</h2>
      <p>The Portfolio PDF renderer is back online and healthy.</p>
      <p>The previous outage lasted about <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>.
        Portfolio PDF exports should now succeed again.</p>
    </div>`;
  return { subject, text, html };
}

function buildDisconnectEmail(disconnectedForMs: number): { subject: string; text: string; html: string } {
  const minutes = Math.max(1, Math.round(disconnectedForMs / 60000));
  const subject = "Portfolio PDF browser is disconnected";
  const text =
    `The cached Chromium used to render Portfolio PDFs has been disconnected for ` +
    `${minutes} minute${minutes === 1 ? "" : "s"}.\n\n` +
    `The next PDF render will attempt to launch a fresh browser, but repeated ` +
    `failures may indicate an environment problem (missing Chromium, OOM, ` +
    `sandbox issue, etc.).`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#b91c1c;">Portfolio PDF browser is disconnected</h2>
      <p>The cached Chromium used to render Portfolio PDFs has been disconnected for
        <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>.</p>
      <p>The next PDF render will attempt to launch a fresh browser, but repeated
        failures may indicate an environment problem.</p>
    </div>`;
  return { subject, text, html };
}

function buildFailureRateEmail(event: PortfolioPdfAlertEvent): { subject: string; text: string; html: string } {
  const w = event.window;
  const reasons = event.breaches.map((b) => `• ${b.message}`).join("\n");
  const subject = "Portfolio PDF render failures detected";
  const text =
    `Portfolio PDF render samples have crossed configured alert thresholds.\n\n` +
    `Window: last ${Math.round(w.rangeMs / 60000)} minutes\n` +
    `Total renders: ${w.total}\n` +
    `Failures: ${w.failures} (${w.failureRatePct}%)\n` +
    `Average duration: ${w.avgDurationMs ?? "n/a"}ms\n` +
    `Max duration: ${w.maxDurationMs ?? "n/a"}ms\n\n` +
    `Breaches:\n${reasons}\n\n` +
    `Visit the Portfolio PDF health admin page to investigate.`;
  const breachesHtml = event.breaches
    .map((b) => `<li><strong>${b.reason}</strong> — ${b.message}</li>`)
    .join("");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#b91c1c;">Portfolio PDF render failures detected</h2>
      <p>Portfolio PDF render samples have crossed configured alert thresholds.</p>
      <ul>
        <li><strong>Window:</strong> last ${Math.round(w.rangeMs / 60000)} minutes</li>
        <li><strong>Total renders:</strong> ${w.total}</li>
        <li><strong>Failures:</strong> ${w.failures} (${w.failureRatePct}%)</li>
        <li><strong>Average duration:</strong> ${w.avgDurationMs ?? "n/a"}ms</li>
        <li><strong>Max duration:</strong> ${w.maxDurationMs ?? "n/a"}ms</li>
      </ul>
      <p><strong>Breaches:</strong></p>
      <ul>${breachesHtml}</ul>
      <p>Visit the <em>Portfolio PDF health</em> admin page to investigate.</p>
      <p style="color:#6b7280;font-size:12px;">Further alerts will respect the configured cooldown of ${Math.round(
        event.config.cooldownMs / 60000,
      )} minutes.</p>
    </div>`;
  return { subject, text, html };
}

function buildTestAlertEmail(triggeredBy: string | null): { subject: string; text: string; html: string } {
  const subject = "[TEST] Portfolio PDF alert recipients verification";
  const who = triggeredBy ? ` by ${triggeredBy}` : "";
  const text =
    `This is a TEST alert from the Portfolio PDF health admin page${who}.\n\n` +
    `If you received this email and/or in-app notification, you are correctly ` +
    `configured to receive real Portfolio PDF outage alerts.\n\n` +
    `No action is required. Real alert cooldowns were not affected by this test.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color:#2563eb;">[TEST] Portfolio PDF alert recipients verification</h2>
      <p>This is a <strong>TEST</strong> alert from the Portfolio PDF health admin page${who ? ` (triggered${who})` : ""}.</p>
      <p>If you received this email and/or in-app notification, you are correctly
        configured to receive real Portfolio PDF outage alerts.</p>
      <p style="color:#6b7280;font-size:12px;">No action is required. Real alert
        cooldowns were not affected by this test.</p>
    </div>`;
  return { subject, text, html };
}

export async function sendPortfolioPdfTestAlert(options?: { triggeredBy?: string | null }): Promise<{
  recipientCount: number;
  recipients: string[];
  sentAt: number;
}> {
  const recipients = await getRecipients();
  const now = Date.now();
  if (recipients.length === 0) {
    logInfo("Portfolio PDF test alert skipped: no recipients configured", {});
    await recordDelivery(
      "test_alert",
      [],
      false,
      "No recipients configured",
      options?.triggeredBy ?? null,
    );
    return { recipientCount: 0, recipients: [], sentAt: now };
  }
  const { subject, text, html } = buildTestAlertEmail(options?.triggeredBy ?? null);
  logInfo("Sending Portfolio PDF test alert", {
    recipientCount: recipients.length,
    triggeredBy: options?.triggeredBy ?? null,
  });
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

export function reportPortfolioPdfBrowserDisconnected(disconnectedAt: number): void {
  if (state.disconnectedSince === null) {
    state.disconnectedSince = disconnectedAt;
  }
}

async function dispatchFailureRateEvent(event: PortfolioPdfAlertEvent): Promise<void> {
  const now = Date.now();
  if (!shouldSend("failure_rate", now)) return;
  markSent("failure_rate", now);
  const { subject, text, html } = buildFailureRateEmail(event);
  logInfo("Sending Portfolio PDF failure-rate alert", {
    failures: event.window.failures,
    total: event.window.total,
    failureRatePct: event.window.failureRatePct,
  });
  await dispatchAlert("failure_rate", subject, text, html);
}

async function runMonitorTick(): Promise<void> {
  try {
    const now = Date.now();

    if (
      state.lastPruneAt === null ||
      now - state.lastPruneAt >= DELIVERIES_PRUNE_INTERVAL_MS
    ) {
      state.lastPruneAt = now;
      void pruneOldPortfolioPdfAlertDeliveries()
        .then((removed) => {
          if (removed > 0) {
            logInfo("Pruned old Portfolio PDF alert deliveries", {
              removed,
              retentionMs: DELIVERIES_RETENTION_MS,
            });
          }
        })
        .catch((err) => {
          logError(
            "Failed to prune old Portfolio PDF alert deliveries",
            {},
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    }

    // Periodic availability probe — independently confirms Chromium can be
    // launched even when no PDFs are being requested. This is what catches a
    // missing-binary regression in production before the first user export.
    let probedNow = false;
    if (
      state.lastAvailabilityProbeAt === null ||
      now - state.lastAvailabilityProbeAt >= AVAILABILITY_PROBE_INTERVAL_MS
    ) {
      state.lastAvailabilityProbeAt = now;
      probedNow = true;
      await isPortfolioRendererAvailable();
    }

    const status = getPortfolioRendererStatus();
    const isUnavailable = status.available !== true && (probedNow || status.lastCheckedAt !== null);

    if (isUnavailable) {
      if (state.unavailableSince === null) {
        state.unavailableSince = status.lastCheckedAt ?? now;
      }
      const downFor = now - state.unavailableSince;
      const alreadyNotified =
        state.notifiedUnavailableAt !== null &&
        state.notifiedUnavailableAt >= state.unavailableSince;
      if (
        downFor >= UNAVAILABLE_ALERT_THRESHOLD_MS &&
        !alreadyNotified &&
        shouldSend("renderer_unavailable", now)
      ) {
        markSent("renderer_unavailable", now);
        state.notifiedUnavailableAt = now;
        if (!state.unavailableAlertActive) {
          state.unavailableAlertActive = true;
          state.unavailableAlertStartedAt = state.unavailableSince;
        }
        const { subject, text, html } = buildUnavailableEmail(downFor, status.error);
        logInfo("Sending Portfolio PDF renderer-unavailable alert", { downForMs: downFor });
        await dispatchAlert("renderer_unavailable", subject, text, html);
      }
    } else {
      if (state.unavailableSince !== null) {
        state.unavailableSince = null;
        state.notifiedUnavailableAt = null;
      }
      if (
        state.unavailableAlertActive &&
        status.available === true &&
        shouldSend("renderer_recovered", now)
      ) {
        markSent("renderer_recovered", now);
        const startedAt = state.unavailableAlertStartedAt ?? now;
        const durationMs = Math.max(0, now - startedAt);
        state.unavailableAlertActive = false;
        state.unavailableAlertStartedAt = null;
        const { subject, text, html } = buildRecoveredEmail(durationMs);
        logInfo("Sending Portfolio PDF renderer-recovered alert", { durationMs });
        await dispatchAlert("renderer_recovered", subject, text, html);
      }
    }

    // Periodic failure-rate evaluation — render-sample writes also trigger
    // evaluation, but a periodic call ensures alerts fire after restart
    // hydration and during low-traffic periods where samples don't arrive
    // for a while. dispatchFailureRateEvent is wired in via
    // setPortfolioPdfAlertDispatcher, so a non-null event from here will
    // run through the same recipient/cooldown pipeline.
    try {
      evaluatePortfolioPdfAlerts(now);
    } catch (err) {
      logError(
        "Portfolio PDF periodic failure-rate evaluation failed",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // Browser-disconnected: the cached Chromium dropped mid-flight. Distinct
    // from "renderer unavailable" — Chromium may still launch fresh, but the
    // pool churn is worth surfacing.
    if (state.disconnectedSince !== null) {
      const downFor = now - state.disconnectedSince;
      if (downFor >= UNAVAILABLE_ALERT_THRESHOLD_MS && shouldSend("browser_disconnected", now)) {
        markSent("browser_disconnected", now);
        state.disconnectedSince = null;
        const { subject, text, html } = buildDisconnectEmail(downFor);
        logInfo("Sending Portfolio PDF browser-disconnected alert", { downForMs: downFor });
        await dispatchAlert("browser_disconnected", subject, text, html);
      }
    }
  } catch (err) {
    logError(
      "Portfolio PDF alert monitor tick failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export function startPortfolioPdfHealthMonitor(): void {
  if (state.monitorTimer) return;
  // Wire the failure-rate dispatcher and the cached-browser disconnect hook
  // into this module's recipient/delivery pipeline.
  setPortfolioPdfAlertDispatcher((event) => dispatchFailureRateEvent(event));
  onPortfolioPdfBrowserDisconnected((at) => reportPortfolioPdfBrowserDisconnected(at));
  state.monitorTimer = setInterval(() => {
    void runMonitorTick();
  }, MONITOR_INTERVAL_MS);
  if (typeof state.monitorTimer.unref === "function") {
    state.monitorTimer.unref();
  }
  logInfo("Started Portfolio PDF health monitor", {
    intervalMs: MONITOR_INTERVAL_MS,
    unavailableThresholdMs: UNAVAILABLE_ALERT_THRESHOLD_MS,
    availabilityProbeMs: AVAILABILITY_PROBE_INTERVAL_MS,
  });
}

export function stopPortfolioPdfHealthMonitor(): void {
  if (state.monitorTimer) {
    clearInterval(state.monitorTimer);
    state.monitorTimer = null;
  }
  setPortfolioPdfAlertDispatcher(null);
}

export function __resetPortfolioPdfAlertStateForTests(): void {
  state.lastSentAt.clear();
  state.unavailableSince = null;
  state.notifiedUnavailableAt = null;
  state.unavailableAlertActive = false;
  state.unavailableAlertStartedAt = null;
  state.disconnectedSince = null;
  state.lastAvailabilityProbeAt = null;
  state.lastTestSentAt = null;
  state.lastPruneAt = null;
}
