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
import { insertNotification } from "./notificationService";
import { logError, logInfo } from "../utils/logger";

type UserRole = (typeof userRoleEnum.enumValues)[number];
const ADMIN_ROLES: readonly UserRole[] = ["ADMIN", "SUPER_ADMIN"];

async function getOrgAdminUserIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.role, ADMIN_ROLES),
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
  const title = `Integration sync gave up: ${integrationLabel} (${args.entityType})`;
  const message =
    `Automatic retries for ${integrationLabel} — entity "${args.entityType}" — ` +
    `have been exhausted after the configured backoff schedule. ` +
    `Last error: ${trimmedError}. ` +
    `Open the Integrations page to review the failure and trigger a manual retry.`;

  let delivered = 0;
  for (const userId of adminIds) {
    try {
      const payload: InsertNotification = {
        userId,
        organizationId: args.organizationId,
        type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
        title,
        message,
        relatedEntityId: args.syncStateId,
        relatedEntityType: "INTEGRATION_SYNC_STATE",
      };
      await insertNotification(payload);
      delivered += 1;
    } catch (err) {
      logError(
        "Failed to deliver exhausted sync retry notification",
        {
          organizationId: args.organizationId,
          syncStateId: args.syncStateId,
          userId,
        },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
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
