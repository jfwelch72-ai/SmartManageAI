// Task #1368 — Generic scheduled-retry helper for failed integration syncs.
//
// Task #1354 introduced exponential-backoff retries for Davis-Bacon
// wage-decision syncs by piggy-backing on the `retry_count` /
// `next_retry_at` columns on `integration_sync_state`. The same columns
// are now available to every integration that writes sync rows (QBO,
// social, email, etc.) but until this task only the Davis-Bacon path
// used them.
//
// This module hosts the reusable backoff/retry plumbing so any provider
// can opt in by:
//   1. Calling `recordSyncFailure(...)` from its sync entry point on
//      failure and `recordSyncSuccess(...)` on success — these stamp the
//      retry bookkeeping columns.
//   2. Registering a retry handler via `registerSyncRetryHandler(...)` so
//      the generic sweep (`processIntegrationSyncRetries`) knows how to
//      re-run the original operation when its backoff window is due.
//
// The same backoff schedule used for Davis-Bacon (5/15/45/120/360 minutes,
// 6 attempts total ≈ 9h budget) applies to every provider. If a provider
// later needs a custom schedule it can pass `backoffMinutes` when recording
// the failure.

import type { IntegrationConnection, IntegrationSyncState } from "@shared/schema";
import { db } from "../db";
import { integrationConnections, integrationSyncState } from "@shared/schema";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { logError, logInfo, logWarn } from "../utils/logger";
import { decryptMetadata } from "./encryption";

type SyncStateInsert = typeof integrationSyncState.$inferInsert;
type SyncStateUpdate = Partial<SyncStateInsert>;
type SyncStateMetadata = SyncStateInsert["metadata"];

export const SYNC_RETRY_BACKOFF_MINUTES: readonly number[] = [5, 15, 45, 120, 360];
export const MAX_SYNC_RETRIES = SYNC_RETRY_BACKOFF_MINUTES.length + 1;

/**
 * Maps the Nth failure (1-based) to a delay slot. After every backoff
 * slot is consumed, returns null so the failure path persists
 * `nextRetryAt = null` and the sweep stops considering the row until a
 * manual retry re-arms it.
 */
export function computeNextSyncRetryAt(
  failureNumber: number,
  now: Date = new Date(),
  backoff: readonly number[] = SYNC_RETRY_BACKOFF_MINUTES,
): Date | null {
  const idx = failureNumber - 1;
  if (idx < 0 || idx >= backoff.length) return null;
  return new Date(now.getTime() + backoff[idx] * 60_000);
}

interface UpsertPatch {
  metadata?: SyncStateMetadata;
  cursor?: string | null;
  lastSyncAt?: Date | null;
  lastError?: string | null;
  retryCount?: number;
  nextRetryAt?: Date | null;
  bumpAttempt?: boolean;
}

async function upsertSyncStateRow(
  connection: Pick<IntegrationConnection, "id" | "organizationId">,
  entityType: string,
  patch: UpsertPatch,
): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, entityType),
      ),
    );

  if (existing) {
    const update: SyncStateUpdate = { updatedAt: now };
    if (patch.bumpAttempt !== false) update.lastAttemptAt = now;
    if (patch.metadata !== undefined) update.metadata = patch.metadata;
    if (patch.cursor !== undefined) update.cursor = patch.cursor;
    if (patch.lastSyncAt !== undefined) update.lastSyncAt = patch.lastSyncAt;
    if (patch.lastError !== undefined) update.lastError = patch.lastError;
    if (patch.retryCount !== undefined) update.retryCount = patch.retryCount;
    if (patch.nextRetryAt !== undefined) update.nextRetryAt = patch.nextRetryAt;
    await db
      .update(integrationSyncState)
      .set(update)
      .where(eq(integrationSyncState.id, existing.id));
  } else {
    const insert: SyncStateInsert = {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      entityType,
      metadata: patch.metadata ?? null,
      cursor: patch.cursor ?? null,
      lastSyncAt: patch.lastSyncAt ?? null,
      lastAttemptAt: patch.bumpAttempt === false ? null : now,
      lastError: patch.lastError ?? null,
      retryCount: patch.retryCount ?? 0,
      nextRetryAt: patch.nextRetryAt ?? null,
    };
    await db.insert(integrationSyncState).values(insert);
  }
}

export interface RecordFailureResult {
  retryCount: number;
  nextRetryAt: Date | null;
  exhausted: boolean;
}

/**
 * Persist a failed sync attempt to `integration_sync_state` and schedule
 * the next backoff window. After MAX_SYNC_RETRIES failures (or when the
 * provided backoff array is exhausted) `nextRetryAt` is left null so the
 * sweep stops chasing the row and the failure waits for manual intervention.
 */
export async function recordSyncFailure(
  connection: Pick<IntegrationConnection, "id" | "organizationId">,
  entityType: string,
  error: unknown,
  opts: { backoffMinutes?: readonly number[]; now?: Date } = {},
): Promise<RecordFailureResult> {
  const backoff = opts.backoffMinutes ?? SYNC_RETRY_BACKOFF_MINUTES;
  const now = opts.now ?? new Date();

  const [existing] = await db
    .select({ retryCount: integrationSyncState.retryCount })
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, entityType),
      ),
    )
    .limit(1);

  const nextCount = (existing?.retryCount ?? 0) + 1;
  const nextAt = computeNextSyncRetryAt(nextCount, now, backoff);
  const exhausted = nextAt === null;

  await upsertSyncStateRow(connection, entityType, {
    lastError: String(error).slice(0, 1000),
    retryCount: nextCount,
    nextRetryAt: nextAt,
  });

  return { retryCount: nextCount, nextRetryAt: nextAt, exhausted };
}

/**
 * Persist a successful sync attempt. Clears any prior failure bookkeeping
 * so the project banner / "Retry" button resolves naturally and the retry
 * sweep stops chasing this entity.
 */
export async function recordSyncSuccess(
  connection: Pick<IntegrationConnection, "id" | "organizationId">,
  entityType: string,
  patch: { metadata?: SyncStateMetadata; cursor?: string | null; lastSyncAt?: Date } = {},
): Promise<void> {
  await upsertSyncStateRow(connection, entityType, {
    metadata: patch.metadata,
    cursor: patch.cursor,
    lastSyncAt: patch.lastSyncAt ?? new Date(),
    lastError: null,
    retryCount: 0,
    nextRetryAt: null,
  });
}

/**
 * Re-arm the auto-retry chain for an entity that previously exhausted its
 * retry budget — used by the manual "Retry" affordance so a fresh failure
 * can start the backoff schedule from scratch instead of being skipped by
 * the sweep (which ignores rows whose retryCount has hit MAX_SYNC_RETRIES).
 */
export async function clearSyncRetryState(
  connection: Pick<IntegrationConnection, "id" | "organizationId">,
  entityType: string,
): Promise<void> {
  await upsertSyncStateRow(connection, entityType, {
    retryCount: 0,
    nextRetryAt: null,
    bumpAttempt: false,
  });
}

export type SyncRetryHandlerResult = {
  success: boolean;
  error?: string;
  /**
   * If true, the handler has already persisted success/failure state via
   * recordSync*. The sweep will skip the auto-record path so we don't
   * double-write. Defaults to false.
   */
  selfRecorded?: boolean;
};

export type SyncRetryHandler = (
  connection: IntegrationConnection,
  row: IntegrationSyncState,
) => Promise<SyncRetryHandlerResult>;

interface HandlerRegistration {
  provider: string;
  /** Match an entity type by exact value or by prefix (`foo:` matches `foo:bar`). */
  entityTypePrefix: string;
  handler: SyncRetryHandler;
}

const handlerRegistry: HandlerRegistration[] = [];

/**
 * Register a retry handler for a (provider, entity-type-prefix) pair.
 * Multiple registrations are allowed; the first matching registration
 * wins. Re-registering the same pair replaces the previous handler so
 * provider modules can be hot-reloaded in tests.
 */
export function registerSyncRetryHandler(reg: HandlerRegistration): void {
  const idx = handlerRegistry.findIndex(
    (r) => r.provider === reg.provider && r.entityTypePrefix === reg.entityTypePrefix,
  );
  if (idx >= 0) handlerRegistry[idx] = reg;
  else handlerRegistry.push(reg);
}

export function __resetSyncRetryHandlersForTests(): void {
  handlerRegistry.length = 0;
}

function findHandler(provider: string, entityType: string): SyncRetryHandler | null {
  for (const reg of handlerRegistry) {
    if (reg.provider !== provider) continue;
    if (entityType === reg.entityTypePrefix) return reg.handler;
    if (reg.entityTypePrefix.endsWith(":") && entityType.startsWith(reg.entityTypePrefix)) {
      return reg.handler;
    }
  }
  return null;
}

export interface SyncRetrySweepResult {
  candidates: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNoConnection: number;
  skippedNoHandler: number;
  exhausted: number;
  byProvider: Record<string, { attempted: number; succeeded: number; failed: number }>;
}

/**
 * Generic scheduled-retry sweep. Picks up every `integration_sync_state`
 * row whose last attempt failed and whose backoff window is now due,
 * looks up a registered handler by (connection.provider, entityType
 * prefix), and re-runs the underlying sync.
 *
 * Designed to be idempotent and safe to call from a cron task (every
 * 5 minutes) and from the admin "Run job now" affordance. Connection
 * lookups are keyed by `row.connectionId` (not by org) so retries always
 * route through the original connection — protecting orgs that have
 * since rotated/replaced the connection from accidentally cross-firing
 * onto a different connection_id (Task #1354 review).
 */
export async function processIntegrationSyncRetries(
  now: Date = new Date(),
  filter?: { entityTypePattern?: string },
): Promise<SyncRetrySweepResult> {
  const result: SyncRetrySweepResult = {
    candidates: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedNoConnection: 0,
    skippedNoHandler: 0,
    exhausted: 0,
    byProvider: {},
  };

  const conditions: SQL[] = [
    isNotNull(integrationSyncState.lastError),
    isNotNull(integrationSyncState.nextRetryAt),
    lte(integrationSyncState.nextRetryAt, now),
  ];
  if (filter?.entityTypePattern) {
    conditions.push(sql`${integrationSyncState.entityType} LIKE ${filter.entityTypePattern}`);
  }

  const rows = await db
    .select()
    .from(integrationSyncState)
    .where(and(...conditions));

  result.candidates = rows.length;
  if (rows.length === 0) return result;

  const connectionCache = new Map<string, IntegrationConnection | null>();
  async function getConnection(connectionId: string): Promise<IntegrationConnection | null> {
    if (connectionCache.has(connectionId)) return connectionCache.get(connectionId)!;
    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.status, "active"),
        ),
      )
      .limit(1);
    if (!conn) {
      connectionCache.set(connectionId, null);
      return null;
    }
    const meta = (conn.metadata ?? {}) as Record<string, unknown>;
    const decrypted: IntegrationConnection = {
      ...conn,
      metadata: decryptMetadata(meta as Record<string, unknown>),
    };
    connectionCache.set(connectionId, decrypted);
    return decrypted;
  }

  function recordProviderTally(provider: string, kind: "attempted" | "succeeded" | "failed") {
    const bucket = result.byProvider[provider] ?? { attempted: 0, succeeded: 0, failed: 0 };
    bucket[kind] += 1;
    result.byProvider[provider] = bucket;
  }

  for (const row of rows) {
    if (row.retryCount >= MAX_SYNC_RETRIES) {
      result.exhausted += 1;
      try {
        await db
          .update(integrationSyncState)
          .set({ nextRetryAt: null, updatedAt: new Date() })
          .where(eq(integrationSyncState.id, row.id));
      } catch (err) {
        logWarn("Sync retry sweep: failed to clear exhausted nextRetryAt", {
          rowId: row.id,
          error: String(err),
        });
      }
      continue;
    }

    const connection = await getConnection(row.connectionId);
    if (!connection) {
      result.skippedNoConnection += 1;
      // Stop chasing rows whose original connection is gone or inactive —
      // they'd otherwise re-scan every 5 minutes forever. The manual
      // retry path will re-arm via clearSyncRetryState against the
      // current active connection.
      try {
        await db
          .update(integrationSyncState)
          .set({ nextRetryAt: null, updatedAt: new Date() })
          .where(eq(integrationSyncState.id, row.id));
      } catch (err) {
        logWarn("Sync retry sweep: failed to pause stale-connection row", {
          rowId: row.id,
          connectionId: row.connectionId,
          error: String(err),
        });
      }
      continue;
    }

    const handler = findHandler(connection.provider, row.entityType);
    if (!handler) {
      result.skippedNoHandler += 1;
      // Don't keep re-scanning a row no provider claims — pause the
      // schedule until a future deploy registers a handler (or the user
      // clears the failure manually).
      try {
        await db
          .update(integrationSyncState)
          .set({ nextRetryAt: null, updatedAt: new Date() })
          .where(eq(integrationSyncState.id, row.id));
      } catch (err) {
        logWarn("Sync retry sweep: failed to pause unhandled row", {
          rowId: row.id,
          provider: connection.provider,
          entityType: row.entityType,
          error: String(err),
        });
      }
      continue;
    }

    result.attempted += 1;
    recordProviderTally(connection.provider, "attempted");
    try {
      const out = await handler(connection, row);
      if (out.success) {
        result.succeeded += 1;
        recordProviderTally(connection.provider, "succeeded");
        if (!out.selfRecorded) {
          await recordSyncSuccess(connection, row.entityType);
        }
        logInfo("Integration sync scheduled retry succeeded", {
          provider: connection.provider,
          entityType: row.entityType,
          organizationId: row.organizationId,
          previousAttempts: row.retryCount,
        });
      } else {
        result.failed += 1;
        recordProviderTally(connection.provider, "failed");
        if (!out.selfRecorded) {
          await recordSyncFailure(connection, row.entityType, out.error ?? "Sync failed");
        }
      }
    } catch (err) {
      result.failed += 1;
      recordProviderTally(connection.provider, "failed");
      try {
        await recordSyncFailure(connection, row.entityType, err);
      } catch (recErr) {
        logWarn("Sync retry sweep: failed to persist retry failure", {
          rowId: row.id,
          error: String(recErr),
        });
      }
      logError("Integration sync scheduled retry threw", {
        provider: connection.provider,
        entityType: row.entityType,
        organizationId: row.organizationId,
        error: String(err),
      });
    }
  }

  return result;
}
