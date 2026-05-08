// Task #1391 — Email/in-app fan-out to org admins the first time an
// integration sync row exhausts its automatic retry budget
// (retry_count >= MAX_SYNC_RETRIES with no further nextRetryAt scheduled).
//
// Without this, the only surface for an exhausted sync was the
// "Integration sync retries" panel on the integrations page (Task #1378),
// which admins had to remember to visit. Now they get a heads-up the
// moment the automatic retry chain gives up so manual intervention can
// happen before the failure compounds (e.g. weeks of QBO entries falling
// behind, Davis-Bacon decisions never re-fetched).
//
// Dedup contract — exactly one notification per exhaustion event:
//   * The atomic UPDATE below stamps `exhausted_notified_at` only when
//     the marker is currently null, so concurrent failures racing on the
//     same row still produce exactly one fan-out (the loser's UPDATE
//     touches zero rows and skips the insertNotification loop).
//   * recordSyncSuccess and clearSyncRetryState (the manual "Retry" path)
//     clear `exhausted_notified_at`, re-arming the alert for any future
//     re-exhaustion.

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  integrationConnections,
  integrationSyncAlertMutes,
  integrationSyncState,
  userRoleEnum,
  users,
  type InsertNotification,
} from "@shared/schema";
import { insertNotification, insertNotifications } from "./notificationService";
import { logError, logInfo } from "../utils/logger";
import { MAX_SYNC_RETRIES } from "../integrations/syncRetry";
// Task #1945 — Re-export the friendly-label helpers so existing callers
// (and tests) can keep importing them from this module.
import {
  resolveQboEntityLabel,
  resolveQboEntityLabels,
  type QboResolvedEntity,
  type QboPerItemSubKind,
} from "./qboEntityLabels";
export {
  resolveQboEntityLabel,
  resolveQboEntityLabels,
  type QboResolvedEntity,
  type QboPerItemSubKind,
};

type UserRole = (typeof userRoleEnum.enumValues)[number];
const ADMIN_ROLES: readonly UserRole[] = ["ADMIN", "SUPER_ADMIN"];

// Task #1942 — duplicated locally (instead of imported from
// `../integrations/providers/qbo/sync`) to avoid the cycle: syncRetry.ts
// imports `notifyAdminsOfExhaustedSyncRetry` from this module, and
// `qbo/sync.ts` imports `registerSyncRetryHandler` from syncRetry.ts and
// registers at module load — pulling the QBO module in here would tear
// the registry handle down before its IIFE init runs.
const QBO_SYNC_ENTITY_TYPE_PREFIX = "qbo_sync:";

/**
 * Task #1942 — derive the human-friendly QuickBooks "kind" + item id from a
 * `qbo_sync:%` entityType (e.g. `qbo_sync:invoice:inv-7` →
 * `{ kindLabel: "Invoice", itemId: "inv-7" }`). Mirrors the classifier the
 * QboSyncRetryPanel route already uses (see server/integrationRoutes.ts) so
 * the email copy and the in-app panel stay in lockstep.
 */
export function classifyQboEntity(
  entityType: string,
): { kindLabel: string; itemId: string | null } {
  if (!entityType.startsWith(QBO_SYNC_ENTITY_TYPE_PREFIX)) {
    return { kindLabel: "Sync", itemId: null };
  }
  const operation = entityType.slice(QBO_SYNC_ENTITY_TYPE_PREFIX.length);
  const colonIdx = operation.indexOf(":");
  if (colonIdx > 0) {
    const subKind = operation.slice(0, colonIdx);
    const itemId = operation.slice(colonIdx + 1) || null;
    if (subKind === "customer") return { kindLabel: "Customer", itemId };
    if (subKind === "invoice") return { kindLabel: "Invoice", itemId };
    if (subKind === "payroll") return { kindLabel: "Payroll run", itemId };
    if (subKind === "certified_payroll") {
      return { kindLabel: "Certified payroll run", itemId };
    }
    // Task #1975 — per-record Bill / Vendor labels (matches the
    // resolver's bill / vendor subKinds in qboEntityLabels.ts).
    if (subKind === "bill") return { kindLabel: "Bill", itemId };
    if (subKind === "vendor") return { kindLabel: "Vendor", itemId };
    return { kindLabel: "Scheduled operation", itemId };
  }
  if (operation === "customers") {
    return { kindLabel: "Customer batch sync", itemId: null };
  }
  const pretty = operation
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
  return { kindLabel: `${pretty} sync`, itemId: null };
}

// ---------------------------------------------------------------------------
// Task #1945 — Friendly QBO entity labels (customer name / "Pay app #N —
// projectCode" / "Pay run #N") for admin emails + digests when the QBO
// sync row is keyed by a per-item entityType live in
// `./qboEntityLabels.ts` (re-exported above so callers keep the existing
// import path). The standalone module avoids the
// notificationDelivery → notificationService require cycle that would
// otherwise form when notificationDelivery imports this file.
// ---------------------------------------------------------------------------

async function getOrgAdminUserIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.role, [...ADMIN_ROLES] as Array<typeof users.$inferSelect.role>),
        eq(users.isActive, true),
      ),
    );
  return rows.map((r) => r.id);
}

export interface NotifyExhaustedRetryArgs {
  syncStateId: string;
  organizationId: string;
  connectionId: string;
  entityType: string;
  lastError: string | null;
}

export interface NotifyExhaustedRetryResult {
  recipients: number;
  /** False when another concurrent caller already marked the row notified
   *  (or the row was re-armed by clearSyncRetryState/recordSyncSuccess
   *  before this call could claim it). */
  notified: boolean;
  /** True when an active mute row for (connectionId, entityType) or for
   *  the whole connection silenced the fan-out. The atomic claim still
   *  stamps `exhausted_notified_at` so repeat failures on the muted row
   *  don't keep retrying the fan-out path — when the admin clears the
   *  mute, a subsequent re-exhaustion (after manual retry /
   *  recordSyncSuccess re-arms the marker) will produce a fresh alert. */
  muted?: boolean;
}

/**
 * Task #1404 — look for an active mute row for this (connectionId,
 * entityType). Connection-wide mutes (entity_type IS NULL) match every
 * entity; otherwise the exact entity_type must match. Returning early
 * here means admins don't get paged until the mute is cleared.
 */
async function isMuted(
  connectionId: string,
  entityType: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: integrationSyncAlertMutes.id })
    .from(integrationSyncAlertMutes)
    .where(
      and(
        eq(integrationSyncAlertMutes.connectionId, connectionId),
        or(
          isNull(integrationSyncAlertMutes.entityType),
          eq(integrationSyncAlertMutes.entityType, entityType),
        ),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Fan out an INTEGRATION_SYNC_RETRIES_EXHAUSTED notification to every
 * active org admin (ADMIN, SUPER_ADMIN) for the integration owner.
 */
export async function notifyAdminsOfExhaustedSyncRetry(
  args: NotifyExhaustedRetryArgs,
): Promise<NotifyExhaustedRetryResult> {
  const now = new Date();

  // Atomic claim: stamp the marker only if it's currently null and the
  // row still represents an active failure (retry_count > 0). If a
  // concurrent recordSyncSuccess / clearSyncRetryState already cleared
  // the failure state, RETURNING yields zero rows and we skip the
  // fan-out entirely.
  const claimResult = await db.execute<{ id: string }>(sql`
    UPDATE integration_sync_state
       SET exhausted_notified_at = ${now}, updated_at = ${now}
     WHERE id = ${args.syncStateId}
       AND connection_id = ${args.connectionId}
       AND exhausted_notified_at IS NULL
       AND retry_count > 0
     RETURNING id
  `);
  if ((claimResult.rows?.length ?? 0) === 0) {
    return { recipients: 0, notified: false };
  }

  // Task #1404 — respect per-connection / per-entity mutes. The row is
  // still claimed above (so repeat failures don't keep retrying the
  // fan-out while muted); clearing the mute combined with a successful
  // sync or manual retry re-arms the marker and the next exhaustion
  // produces a fresh alert.
  if (await isMuted(args.connectionId, args.entityType)) {
    logInfo("Exhausted sync retry fan-out suppressed by active mute", {
      organizationId: args.organizationId,
      syncStateId: args.syncStateId,
      connectionId: args.connectionId,
      entityType: args.entityType,
    });
    return { recipients: 0, notified: true, muted: true };
  }

  const [conn] = await db
    .select({
      provider: integrationConnections.provider,
      displayName: integrationConnections.displayName,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, args.connectionId))
    .limit(1);

  const adminIds = await getOrgAdminUserIds(args.organizationId);
  if (adminIds.length === 0) {
    logInfo("No active org admins to notify of exhausted sync retries", {
      organizationId: args.organizationId,
      syncStateId: args.syncStateId,
      connectionId: args.connectionId,
      entityType: args.entityType,
    });
    return { recipients: 0, notified: true };
  }

  const integrationLabel =
    conn?.displayName?.trim() || conn?.provider || "integration";
  const trimmedError = (args.lastError ?? "(no error message recorded)").slice(0, 300);

  // Task #1942 — when a `qbo_sync:%` row exhausts, render copy that names
  // the QuickBooks kind (customer / invoice / pay run / scheduled op) and
  // the affected item id so admins reading the email can triage without
  // hopping back into the app. The full entityType is kept in parens so
  // existing test assertions (and grep-style log searches) still match.
  //
  // Task #1945 — for per-item rows (customer / invoice / payroll /
  // certified_payroll), look the local record up so the title + body
  // surface the human-readable label (customer name, "Pay app #N —
  // projectCode", "Pay run #runNumber") instead of forcing admins to
  // copy the raw uuid into another screen. Orphan IDs (record was
  // deleted) fall through to the existing kindLabel + itemId rendering.
  let title: string;
  let message: string;
  // Task #1974 — capture the resolved record link/label so it can be
  // persisted on the notification row itself (jsonb metadata column),
  // letting the in-app bell render a secondary "Open <recordLabel>"
  // link without re-resolving on every list call. Orphan IDs leave
  // these undefined so the secondary link is omitted (same as the
  // email path).
  let recordMetadata: { recordLink?: string; recordLabel?: string } | null = null;
  if (args.entityType.startsWith(QBO_SYNC_ENTITY_TYPE_PREFIX)) {
    const { kindLabel, itemId } = classifyQboEntity(args.entityType);
    const resolved = itemId
      ? await resolveQboEntityLabel(args.organizationId, args.entityType).catch(
          (err) => {
            // Lookup failures must not block the alert — fall back to the
            // raw label rather than swallowing the whole notification.
            logError(
              "Failed to resolve QBO entity label for exhausted sync alert",
              {
                organizationId: args.organizationId,
                syncStateId: args.syncStateId,
                entityType: args.entityType,
              },
              err instanceof Error ? err : new Error(String(err)),
            );
            return null;
          },
        )
      : null;
    const itemSuffix = itemId ? ` ${itemId}` : "";
    const titleSubject = resolved ? resolved.displayName : `${kindLabel}${itemSuffix}`;
    title =
      `Integration sync gave up: ${integrationLabel} — ${titleSubject} ` +
      `(${args.entityType})`;
    const lowerKind = kindLabel.charAt(0).toLowerCase() + kindLabel.slice(1);
    const itemPhrase = itemId ? ` (id ${itemId})` : "";
    const bodySubject = resolved
      ? `${resolved.displayName}${itemPhrase}`
      : `this ${lowerKind}${itemPhrase}`;
    message =
      `QuickBooks ran out of automatic retries while syncing ${bodySubject}. ` +
      `Last error: ${trimmedError}. ` +
      `Open the QuickBooks panel on the Integrations page to retry or investigate.`;
    if (resolved) {
      recordMetadata = {
        recordLink: resolved.link,
        recordLabel: resolved.displayName,
      };
    }
  } else {
    title = `Integration sync gave up: ${integrationLabel} (${args.entityType})`;
    message =
      `Automatic retries for ${integrationLabel} — entity "${args.entityType}" — ` +
      `have been exhausted after the configured backoff schedule. ` +
      `Last error: ${trimmedError}. ` +
      `Open the Integrations page to review the failure and trigger a manual retry.`;
  }

  // Task #1976 — Batch the fan-out through insertNotifications so every
  // recipient's deliverNotification shares the per-batch QBO label cache,
  // collapsing what used to be N redundant resolveQboEntityLabel calls
  // (one per admin) into one per (org, entityType) pair.
  // Task #1974 — propagate the resolved record link/label as opaque
  // notification metadata so the in-app bell can render a secondary
  // "Open <recordLabel>" link without re-resolving on every list call.
  const payloads: InsertNotification[] = adminIds.map((userId) => ({
    userId,
    organizationId: args.organizationId,
    type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
    title,
    message,
    relatedEntityId: args.syncStateId,
    relatedEntityType: "INTEGRATION_SYNC_STATE",
    metadata: recordMetadata,
  }));
  let delivered = 0;
  try {
    await insertNotifications(payloads);
    delivered = payloads.length;
  } catch (err) {
    logError(
      "Failed to deliver exhausted sync retry notifications",
      {
        organizationId: args.organizationId,
        syncStateId: args.syncStateId,
        recipients: payloads.length,
      },
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  if (delivered > 0) {
    logInfo("Integration sync retries exhausted — admins notified", {
      organizationId: args.organizationId,
      syncStateId: args.syncStateId,
      connectionId: args.connectionId,
      entityType: args.entityType,
      recipients: delivered,
      provider: conn?.provider,
    });
  }

  return { recipients: delivered, notified: true };
}

// ---------------------------------------------------------------------------
// Task #1405 — One-shot backfill so already-exhausted sync rows that pre-date
// the Task #1391 deploy still produce a heads-up admin alert.
//
// recordSyncFailure only fires the new notification on the *transition* into
// exhausted state. Any row that already had retry_count >= MAX_SYNC_RETRIES
// when the notification feature shipped would otherwise sit silently — admins
// would only learn about it the next time they happened to open the
// Integrations page. This sweep finds those rows, fans out one *summary*
// notification per (organization, connection), and stamps
// `exhausted_notified_at` so the regular per-row dedup keeps working.
// ---------------------------------------------------------------------------

interface BackfillRow {
  id: string;
  organization_id: string;
  connection_id: string;
  entity_type: string;
  last_error: string | null;
  [key: string]: unknown;
}

export interface BackfillExhaustedSyncAlertsResult {
  candidateRows: number;
  claimedRows: number;
  groupsNotified: number;
  groupsWithoutAdmins: number;
  recipients: number;
}

/**
 * Find every `integration_sync_state` row that is already exhausted but was
 * never notified (`retry_count >= MAX_SYNC_RETRIES AND exhausted_notified_at
 * IS NULL`), atomically claim them by stamping `exhausted_notified_at`, group
 * the claimed rows by (organization, connection), and emit one summary admin
 * notification per group.
 *
 * The atomic claim mirrors `notifyAdminsOfExhaustedSyncRetry` so concurrent
 * callers (a parallel deploy, a normal `recordSyncFailure` re-run on the
 * same row) cannot produce a duplicate alert: rows are returned only by the
 * UPDATE that successfully transitioned the marker from NULL.
 */
export async function backfillExhaustedSyncRetryAlerts(): Promise<BackfillExhaustedSyncAlertsResult> {
  const result: BackfillExhaustedSyncAlertsResult = {
    candidateRows: 0,
    claimedRows: 0,
    groupsNotified: 0,
    groupsWithoutAdmins: 0,
    recipients: 0,
  };

  const now = new Date();

  // Atomic claim: stamp every pre-existing exhausted row in one statement and
  // return the rows we won the race for. Anything already claimed by a racing
  // recordSyncFailure (or a previous backfill run) is skipped.
  const claimResult = await db.execute<BackfillRow>(sql`
    UPDATE integration_sync_state
       SET exhausted_notified_at = ${now}, updated_at = ${now}
     WHERE exhausted_notified_at IS NULL
       AND retry_count >= ${MAX_SYNC_RETRIES}
     RETURNING id,
               organization_id,
               connection_id,
               entity_type,
               last_error
  `);

  const claimed = claimResult.rows ?? [];
  result.candidateRows = claimed.length;
  result.claimedRows = claimed.length;
  if (claimed.length === 0) return result;

  // Group by (organization_id, connection_id) so each integration gets a
  // single rolled-up notification rather than one per entity.
  const groups = new Map<
    string,
    {
      organizationId: string;
      connectionId: string;
      rows: BackfillRow[];
    }
  >();
  for (const row of claimed) {
    const key = `${row.organization_id}::${row.connection_id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        organizationId: row.organization_id,
        connectionId: row.connection_id,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  // Cache admin lookups per org so multiple connections owned by the same
  // org don't re-query the users table.
  const adminCache = new Map<string, string[]>();
  async function adminsFor(organizationId: string): Promise<string[]> {
    const cached = adminCache.get(organizationId);
    if (cached) return cached;
    const ids = await getOrgAdminUserIds(organizationId);
    adminCache.set(organizationId, ids);
    return ids;
  }

  for (const group of groups.values()) {
    const [conn] = await db
      .select({
        provider: integrationConnections.provider,
        displayName: integrationConnections.displayName,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, group.connectionId))
      .limit(1);

    const adminIds = await adminsFor(group.organizationId);
    if (adminIds.length === 0) {
      // Marker is already stamped on every row in the group — they won't be
      // re-considered by future backfill runs. This matches the behaviour of
      // the per-row notifier when an org has no admins.
      result.groupsWithoutAdmins += 1;
      logInfo("Backfill: no active org admins for exhausted sync alert", {
        organizationId: group.organizationId,
        connectionId: group.connectionId,
        entityCount: group.rows.length,
      });
      continue;
    }

    const integrationLabel =
      conn?.displayName?.trim() || conn?.provider || "integration";
    const entityCount = group.rows.length;

    // Task #1945 — enrich each entity with the human-readable label
    // (customer name / "Pay app #N — projectCode" / "Pay run #N") when
    // we can resolve the local record. Orphans fall through to the raw
    // entity_type so the digest still renders without crashing.
    const labelMap = await resolveQboEntityLabels(
      group.organizationId,
      group.rows.map((r) => r.entity_type),
    ).catch((err) => {
      logError(
        "Backfill: failed to resolve QBO entity labels for digest",
        {
          organizationId: group.organizationId,
          connectionId: group.connectionId,
        },
        err instanceof Error ? err : new Error(String(err)),
      );
      return new Map<string, QboResolvedEntity>();
    });
    // For each entity, prefer the friendly displayName followed by the
    // raw `qbo_sync:%` token in parens so existing test assertions and
    // grep-style log searches still match. Falls back to the raw token
    // when no record was found (orphan ID).
    const renderedEntries = group.rows
      .map((r) => {
        const hit = labelMap.get(r.entity_type);
        return hit
          ? { sortKey: hit.displayName, rendered: `${hit.displayName} (${r.entity_type})` }
          : { sortKey: r.entity_type, rendered: r.entity_type };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const sampleEntries = renderedEntries.slice(0, 5);
    const moreSuffix =
      entityCount > sampleEntries.length
        ? `, and ${entityCount - sampleEntries.length} more`
        : "";
    const lastErrorSample = group.rows.find((r) => r.last_error)?.last_error;
    const trimmedError = (lastErrorSample ?? "(no error message recorded)").slice(0, 300);

    const title =
      entityCount === 1
        ? `Integration sync gave up: ${integrationLabel} (${renderedEntries[0].rendered})`
        : `Integration sync gave up: ${integrationLabel} (${entityCount} entities)`;
    const message =
      `Background sync retries for ${integrationLabel} were already exhausted ` +
      `for ${entityCount} ${entityCount === 1 ? "entity" : "entities"} ` +
      `(${sampleEntries.map((e) => e.rendered).join(", ")}${moreSuffix}). ` +
      `Sample last error: ${trimmedError}. ` +
      `Open the Integrations page to review and trigger a manual retry.`;

    // Anchor the related-entity link on the first claimed row so clicking
    // through the notification opens a real sync state record.
    const anchorRowId = group.rows[0].id;
    // Task #1974 — when the backfill summary covers a single resolved
    // QBO record, persist its {recordLink, recordLabel} so the in-app
    // bell row gets the same secondary "Open <label>" link the
    // per-row notify path emits. Multi-entity summaries intentionally
    // skip the secondary link (no single record to deep-link to);
    // orphan IDs likewise skip it (resolveQboEntityLabels left no
    // map entry).
    const anchorRow = group.rows[0];
    const anchorResolved = labelMap.get(anchorRow.entity_type);
    const recordMetadata: { recordLink?: string; recordLabel?: string } | null =
      entityCount === 1 && anchorResolved
        ? { recordLink: anchorResolved.link, recordLabel: anchorResolved.displayName }
        : null;

    let delivered = 0;
    for (const userId of adminIds) {
      try {
        const payload: InsertNotification = {
          userId,
          organizationId: group.organizationId,
          type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
          title,
          message,
          relatedEntityId: anchorRowId,
          relatedEntityType: "INTEGRATION_SYNC_STATE",
          metadata: recordMetadata,
        };
        await insertNotification(payload);
        delivered += 1;
      } catch (err) {
        logError(
          "Backfill: failed to deliver exhausted sync retry summary",
          {
            organizationId: group.organizationId,
            connectionId: group.connectionId,
            userId,
          },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    if (delivered > 0) {
      result.groupsNotified += 1;
      result.recipients += delivered;
      logInfo("Backfill: integration sync retries exhausted summary sent", {
        organizationId: group.organizationId,
        connectionId: group.connectionId,
        provider: conn?.provider,
        entityCount,
        recipients: delivered,
      });
    }
  }

  return result;
}
