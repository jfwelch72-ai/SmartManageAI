import { db } from "./db";
import {
  users,
  pdfAlertRecipients,
  pdfAlertDeliveries,
  type PdfAlertRecipient,
  type PdfAlertDelivery,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { sendEmail } from "./email";
import { insertNotifications } from "./services/notificationService";
import { logError, logInfo } from "./utils/logger";

/**
 * Task #990 — shared abstraction backing both Gantt and Portfolio PDF
 * alerting pipelines. Each pipeline keeps its own monitor/state but goes
 * through this module for recipient lookup, email + in-app delivery, audit
 * logging, and CRUD.
 */

export type PdfAlertService = "gantt" | "portfolio";

export interface PdfAlertServiceConfig {
  service: PdfAlertService;
  /** Env var name with comma/semicolon-separated fallback emails. */
  envVar: string;
  /** Notification.relatedEntityType written to the in-app notification table. */
  notificationEntityType: string;
  /** Human-readable label, used in log messages. */
  label: string;
}

const SERVICE_CONFIG: Record<PdfAlertService, PdfAlertServiceConfig> = {
  gantt: {
    service: "gantt",
    envVar: "GANTT_PDF_ALERT_EMAILS",
    notificationEntityType: "gantt_pdf_alert",
    label: "Gantt PDF",
  },
  portfolio: {
    service: "portfolio",
    envVar: "PORTFOLIO_PDF_ALERT_EMAILS",
    notificationEntityType: "portfolio_pdf_alert",
    label: "Portfolio PDF",
  },
};

function notifyColumn(service: PdfAlertService) {
  return service === "gantt"
    ? pdfAlertRecipients.notifyGantt
    : pdfAlertRecipients.notifyPortfolio;
}

function notifyKey(service: PdfAlertService): "notifyGantt" | "notifyPortfolio" {
  return service === "gantt" ? "notifyGantt" : "notifyPortfolio";
}

function parseEnvRecipients(envVar: string): string[] {
  const raw = process.env[envVar] || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("@"));
}

export interface PdfAlertRecipientResolved {
  email: string;
  userId: string | null;
  notifyInApp: boolean;
}

async function resolveUserIdsForEmails(
  emails: string[],
  service: PdfAlertService,
): Promise<Map<string, string>> {
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
      `Failed to resolve userIds for ${SERVICE_CONFIG[service].label} alert recipients`,
      { emailCount: lower.length },
      err instanceof Error ? err : new Error(String(err)),
    );
    return new Map();
  }
}

/** All shared rows (regardless of per-service opt-in). */
export async function listAllSharedRecipients(): Promise<PdfAlertRecipient[]> {
  try {
    return await db
      .select()
      .from(pdfAlertRecipients)
      .orderBy(asc(pdfAlertRecipients.email));
  } catch (err) {
    logError(
      "Failed to load PDF alert recipients from database",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

/** Shared rows opted-in to the given service. */
export async function listSharedRecipientsForService(
  service: PdfAlertService,
): Promise<PdfAlertRecipient[]> {
  try {
    return await db
      .select()
      .from(pdfAlertRecipients)
      .where(eq(notifyColumn(service), true))
      .orderBy(asc(pdfAlertRecipients.email));
  } catch (err) {
    logError(
      `Failed to load ${SERVICE_CONFIG[service].label} alert recipients from database`,
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

/**
 * Resolve the actual list of email recipients for a service, applying the
 * three-tier fallback chain: DB rows opted in → env var → active SUPER_ADMINs.
 */
export async function getServiceRecipients(
  service: PdfAlertService,
): Promise<PdfAlertRecipientResolved[]> {
  const cfg = SERVICE_CONFIG[service];
  const dbRows = await listSharedRecipientsForService(service);
  if (dbRows.length > 0) {
    const missingUserEmails = dbRows.filter((r) => !r.userId).map((r) => r.email);
    const lookup = missingUserEmails.length
      ? await resolveUserIdsForEmails(missingUserEmails, service)
      : new Map<string, string>();
    return dbRows.map((r) => ({
      email: r.email,
      userId: r.userId ?? lookup.get(r.email.toLowerCase()) ?? null,
      notifyInApp: r.notifyInApp,
    }));
  }
  const envEmails = parseEnvRecipients(cfg.envVar);
  if (envEmails.length > 0) {
    const lookup = await resolveUserIdsForEmails(envEmails, service);
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
      `Failed to load SUPER_ADMIN users for ${cfg.label} alerts`,
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

export type PdfAlertRecipientSource = "database" | "env" | "super_admins";

export interface PdfAlertRecipientView {
  id: string | null;
  email: string;
  notifyInApp: boolean;
  userId: string | null;
  notifyGantt?: boolean;
  notifyPortfolio?: boolean;
}

export async function getServiceRecipientSource(service: PdfAlertService): Promise<{
  source: PdfAlertRecipientSource;
  recipientDetails: PdfAlertRecipientView[];
  envRecipients: string[];
}> {
  const cfg = SERVICE_CONFIG[service];
  const envEmails = parseEnvRecipients(cfg.envVar);
  const dbRows = await listSharedRecipientsForService(service);
  let source: PdfAlertRecipientSource;
  let recipientDetails: PdfAlertRecipientView[];
  if (dbRows.length > 0) {
    source = "database";
    recipientDetails = dbRows.map((r) => ({
      id: r.id,
      email: r.email,
      notifyInApp: r.notifyInApp,
      userId: r.userId,
      notifyGantt: r.notifyGantt,
      notifyPortfolio: r.notifyPortfolio,
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
    const list = await getServiceRecipients(service);
    recipientDetails = list.map((r) => ({
      id: null,
      email: r.email,
      notifyInApp: r.notifyInApp,
      userId: r.userId,
    }));
  }
  return { source, recipientDetails, envRecipients: envEmails };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Add or upsert a shared recipient. If a row already exists for the email,
 * its per-service flag for `service` is set to true (preserving the other
 * service's flag) and `notifyInApp` is updated when provided. Throws a
 * conflict-style error when the existing row was already opted in to this
 * service, so route handlers can map to HTTP 409 like before.
 */
export async function addServiceRecipient(
  service: PdfAlertService,
  input: { email: string; notifyInApp?: boolean },
): Promise<PdfAlertRecipient> {
  const email = normalizeEmail(input.email);
  const lookup = await resolveUserIdsForEmails([email], service);
  const existing = await db
    .select()
    .from(pdfAlertRecipients)
    .where(eq(pdfAlertRecipients.email, email))
    .limit(1);
  if (existing.length > 0) {
    const cur = existing[0];
    const flagKey = notifyKey(service);
    if (cur[flagKey]) {
      const err = new Error(
        `duplicate key: recipient already opted in for ${service}`,
      );
      // Tag so route handlers can match without depending on Postgres error
      // shape (existing routes use a /duplicate key|unique/i regex).
      throw err;
    }
    const updates: Record<string, unknown> = {
      [flagKey === "notifyGantt" ? "notifyGantt" : "notifyPortfolio"]: true,
      updatedAt: new Date(),
    };
    if (typeof input.notifyInApp === "boolean") updates.notifyInApp = input.notifyInApp;
    if (!cur.userId) updates.userId = lookup.get(email) ?? null;
    const [row] = await db
      .update(pdfAlertRecipients)
      .set(updates)
      .where(eq(pdfAlertRecipients.id, cur.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(pdfAlertRecipients)
    .values({
      email,
      notifyInApp: input.notifyInApp ?? true,
      notifyGantt: service === "gantt",
      notifyPortfolio: service === "portfolio",
      userId: lookup.get(email) ?? null,
    } as typeof pdfAlertRecipients.$inferInsert)
    .returning();
  return row;
}

export async function updateSharedRecipient(
  id: string,
  patch: {
    email?: string;
    notifyInApp?: boolean;
    notifyGantt?: boolean;
    notifyPortfolio?: boolean;
  },
  service: PdfAlertService = "gantt",
): Promise<PdfAlertRecipient | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.notifyInApp === "boolean") updates.notifyInApp = patch.notifyInApp;
  if (typeof patch.notifyGantt === "boolean") updates.notifyGantt = patch.notifyGantt;
  if (typeof patch.notifyPortfolio === "boolean")
    updates.notifyPortfolio = patch.notifyPortfolio;
  if (typeof patch.email === "string" && patch.email.trim().length > 0) {
    const email = normalizeEmail(patch.email);
    updates.email = email;
    const lookup = await resolveUserIdsForEmails([email], service);
    updates.userId = lookup.get(email) ?? null;
  }
  const [row] = await db
    .update(pdfAlertRecipients)
    .set(updates)
    .where(eq(pdfAlertRecipients.id, id))
    .returning();
  return row ?? null;
}

/**
 * "Delete" from a service's perspective: clear that service's opt-in flag.
 * If no opt-ins remain, fully delete the row so the shared list stays tidy.
 * Returns true when something changed.
 */
export async function removeServiceRecipient(
  service: PdfAlertService,
  id: string,
): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(pdfAlertRecipients)
    .where(eq(pdfAlertRecipients.id, id))
    .limit(1);
  if (!existing) return false;
  const otherFlag =
    service === "gantt" ? existing.notifyPortfolio : existing.notifyGantt;
  if (!otherFlag) {
    const rows = await db
      .delete(pdfAlertRecipients)
      .where(eq(pdfAlertRecipients.id, id))
      .returning({ id: pdfAlertRecipients.id });
    return rows.length > 0;
  }
  const updates: Record<string, unknown> = {
    [service === "gantt" ? "notifyGantt" : "notifyPortfolio"]: false,
    updatedAt: new Date(),
  };
  const [row] = await db
    .update(pdfAlertRecipients)
    .set(updates)
    .where(eq(pdfAlertRecipients.id, id))
    .returning({ id: pdfAlertRecipients.id });
  return !!row;
}

// ---------- Deliveries ----------

export interface ListPdfAlertDeliveryFilters {
  limit?: number;
  kinds?: string[];
  emailSuccess?: boolean;
  sinceMs?: number;
}

export async function listServiceDeliveries(
  service: PdfAlertService,
  filtersOrLimit: ListPdfAlertDeliveryFilters | number = 20,
): Promise<PdfAlertDelivery[]> {
  const filters: ListPdfAlertDeliveryFilters =
    typeof filtersOrLimit === "number" ? { limit: filtersOrLimit } : filtersOrLimit;
  const safeLimit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 20)));
  try {
    const conditions: SQL[] = [eq(pdfAlertDeliveries.service, service)];
    if (filters.kinds && filters.kinds.length > 0) {
      conditions.push(inArray(pdfAlertDeliveries.kind, filters.kinds));
    }
    if (typeof filters.emailSuccess === "boolean") {
      conditions.push(eq(pdfAlertDeliveries.emailSuccess, filters.emailSuccess));
    }
    if (typeof filters.sinceMs === "number" && filters.sinceMs > 0) {
      conditions.push(
        gte(pdfAlertDeliveries.createdAt, new Date(Date.now() - filters.sinceMs)),
      );
    }
    return await db
      .select()
      .from(pdfAlertDeliveries)
      .where(and(...conditions))
      .orderBy(desc(pdfAlertDeliveries.createdAt))
      .limit(safeLimit);
  } catch (err) {
    logError(
      `Failed to load ${SERVICE_CONFIG[service].label} alert deliveries`,
      { limit: safeLimit },
      err instanceof Error ? err : new Error(String(err)),
    );
    return [];
  }
}

export async function clearServiceDeliveries(
  service: PdfAlertService,
  options?: { olderThanMs?: number },
): Promise<number> {
  try {
    const olderThanMs = options?.olderThanMs;
    if (typeof olderThanMs === "number" && olderThanMs > 0) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const rows = await db
        .delete(pdfAlertDeliveries)
        .where(
          and(
            eq(pdfAlertDeliveries.service, service),
            lt(pdfAlertDeliveries.createdAt, cutoff),
          ),
        )
        .returning({ id: pdfAlertDeliveries.id });
      return rows.length;
    }
    const rows = await db
      .delete(pdfAlertDeliveries)
      .where(eq(pdfAlertDeliveries.service, service))
      .returning({ id: pdfAlertDeliveries.id });
    return rows.length;
  } catch (err) {
    logError(
      `Failed to clear ${SERVICE_CONFIG[service].label} alert deliveries`,
      { olderThanMs: options?.olderThanMs ?? null },
      err instanceof Error ? err : new Error(String(err)),
    );
    return 0;
  }
}

async function recordDelivery(
  service: PdfAlertService,
  kind: string,
  emailTargets: string[],
  emailSuccess: boolean,
  errorMessage: string | null,
  triggeredBy: string | null,
): Promise<void> {
  try {
    await db.insert(pdfAlertDeliveries).values({
      service,
      kind,
      recipients: emailTargets,
      recipientCount: emailTargets.length,
      emailSuccess,
      errorMessage,
      triggeredBy,
    });
  } catch (err) {
    logError(
      `Failed to persist ${SERVICE_CONFIG[service].label} alert delivery record`,
      { kind, recipientCount: emailTargets.length },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

/**
 * Send a single alert email + in-app notification to all currently-resolved
 * recipients for `service`, recording the result in pdf_alert_deliveries.
 */
export async function dispatchServiceAlert(
  service: PdfAlertService,
  kind: string,
  subject: string,
  text: string,
  html: string,
  opts?: { triggeredBy?: string | null },
): Promise<void> {
  const cfg = SERVICE_CONFIG[service];
  const triggeredBy = opts?.triggeredBy ?? null;
  const recipients = await getServiceRecipients(service);
  if (recipients.length === 0) {
    logInfo(`${cfg.label} alert skipped: no recipients configured`, { kind });
    await recordDelivery(service, kind, [], false, "No recipients configured", triggeredBy);
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
      logError(`${cfg.label} alert email returned false`, {
        kind,
        recipientCount: emailTargets.length,
      });
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logError(
      `Failed to send ${cfg.label} alert email`,
      { kind },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
  await recordDelivery(service, kind, emailTargets, emailSuccess, errorMessage, triggeredBy);

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
          relatedEntityType: cfg.notificationEntityType,
          relatedEntityId: kind,
        })),
      );
    } catch (err) {
      logError(
        `Failed to insert ${cfg.label} alert notifications`,
        { kind, userCount: userIds.length },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

export const PDF_ALERT_DELIVERIES_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function pruneOldServiceDeliveries(
  service: PdfAlertService,
): Promise<number> {
  return clearServiceDeliveries(service, {
    olderThanMs: PDF_ALERT_DELIVERIES_RETENTION_MS,
  });
}

// Test helper for unit tests — wipes all shared rows so suites can start clean.
export async function __resetSharedPdfAlertTablesForTests(): Promise<void> {
  try {
    await db.delete(pdfAlertDeliveries);
    await db.delete(pdfAlertRecipients);
  } catch {
    // best-effort
  }
}
