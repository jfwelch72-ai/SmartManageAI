/**
 * Task #1846 — nightly hard-delete sweep for soft-deleted
 * `plan_document_markups` rows whose `deleted_at` is older than the
 * configured retention window (default 30 days).
 *
 * Background: Task #1775 reworked `DELETE /api/plan-document-markups/:id`
 * from a hard delete into a soft delete (stamp `deleted_at`) so the
 * companion `POST /api/plan-document-markups/:id/restore` route can
 * bring a markup back with its original id, layer, group and every
 * other column intact. Without a retention sweep the table grows
 * monotonically — every "deleted" markup remains on disk forever,
 * inflating the table, the indexes, and the per-document SELECT plans
 * even though the rows are filtered out by the LIST endpoint via
 * `deleted_at IS NULL`. This sweep keeps the table bounded while
 * preserving the one-click undo window.
 *
 * Retention defaults to PLAN_DOCUMENT_MARKUP_TRASH_DEFAULT_RETENTION_DAYS
 * (30 days), exposed as a single named constant so it's easy to tune.
 * For ops flexibility the value can also be overridden at runtime via
 * the PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS env var. Override
 * semantics mirror the sibling `pruneProjectLogEmailScheduleAttempts`
 * helper:
 *   - unset / blank        -> use the default (30 days)
 *   - non-numeric          -> use the default (30 days)
 *   - <= 0                 -> disables the sweep entirely so operators
 *                             can pause it without redeploying
 *
 * Deletion is performed in capped batches (SELECT id LIMIT N, then
 * DELETE WHERE id IN (...)) so a single nightly run on a large tenant
 * cannot grab a long row-level lock, balloon WAL, or starve the
 * markup write path.
 *
 * Per-run counters (deleted, batches, durationMs, cappedAtMaxBatches)
 * are surfaced via `recordJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB)`
 * so the operations dashboard shows every nightly tick — including the
 * "nothing to purge" path — and the over-delete spike rules have a
 * baseline to compare against.
 *
 * DB failures are logged AND re-thrown so the cron wrapper in
 * `jobRunner.ts` records a failed sample for the purge job instead of
 * silently marking every tick as a success when the DB is misbehaving.
 */

import { asc, inArray, isNotNull, lt, and } from "drizzle-orm";
import { db } from "../db";
import { planDocumentMarkups } from "@shared/schema";
import { logError, logInfo } from "../utils/logger";
import { recordJobMetrics } from "../utils/jobMetrics";

export const PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB = "plan_document_markup_trash_purge";

export const PLAN_DOCUMENT_MARKUP_TRASH_DEFAULT_RETENTION_DAYS = 30;

/**
 * Per-iteration cap on rows deleted. Small enough that a single
 * statement holds row locks for a few hundred milliseconds at most on
 * the largest tenants we've seen, big enough that a busy account with
 * tens of thousands of stale rows still drains in well under a minute.
 */
export const PLAN_DOCUMENT_MARKUP_TRASH_PURGE_BATCH_SIZE = 1000;

/**
 * Hard ceiling on how many batches a single nightly run will issue.
 * 200 batches * 1000 rows = 200k rows / night, comfortably outpacing
 * the worst-case soft-delete rate. If we ever hit the ceiling we log
 * a warning, mark the run with `cappedAtMaxBatches`, and leave the
 * rest for tomorrow rather than running unbounded.
 */
export const PLAN_DOCUMENT_MARKUP_TRASH_PURGE_MAX_BATCHES = 200;

export function getPlanDocumentMarkupTrashRetentionDays(): number {
  const raw = process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return PLAN_DOCUMENT_MARKUP_TRASH_DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return PLAN_DOCUMENT_MARKUP_TRASH_DEFAULT_RETENTION_DAYS;
  }
  return parsed;
}

export interface PurgePlanDocumentMarkupTrashResult {
  deleted: number;
  batches: number;
  cappedAtMaxBatches: boolean;
  durationMs: number;
}

export async function purgePlanDocumentMarkupTrash(
  opts: {
    now?: Date;
    /**
     * Test-only hook fired between the per-batch SELECT and DELETE.
     * Lets the unit test simulate a `POST /:id/restore` race
     * (clearing `deleted_at` on a row that was just selected) so we
     * can assert the DELETE predicate skips it instead of hard-
     * deleting a row the user just restored. Production callers
     * never set this.
     */
    afterSelectForTest?: (ids: string[]) => Promise<void> | void;
  } = {},
): Promise<PurgePlanDocumentMarkupTrashResult> {
  const startedAt = Date.now();
  const days = getPlanDocumentMarkupTrashRetentionDays();
  if (!Number.isFinite(days) || days <= 0) {
    logInfo("[PlanDocumentMarkupTrashPurge] sweep disabled", { days });
    const result = { deleted: 0, batches: 0, cappedAtMaxBatches: false, durationMs: Date.now() - startedAt };
    recordJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB, {
      deleted: 0,
      batches: 0,
      durationMs: result.durationMs,
    });
    return result;
  }

  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const batchSize = PLAN_DOCUMENT_MARKUP_TRASH_PURGE_BATCH_SIZE;
  const maxBatches = PLAN_DOCUMENT_MARKUP_TRASH_PURGE_MAX_BATCHES;

  let totalDeleted = 0;
  let batches = 0;
  let cappedAtMaxBatches = false;

  try {
    while (batches < maxBatches) {
      // Deterministic oldest-first order so each batch consumes the
      // earliest expired rows, draining predictably even if the
      // soft-delete path keeps appending fresh trashed rows during
      // the sweep.
      const expired = await db
        .select({ id: planDocumentMarkups.id })
        .from(planDocumentMarkups)
        .where(and(
          isNotNull(planDocumentMarkups.deletedAt),
          lt(planDocumentMarkups.deletedAt, cutoff),
        ))
        .orderBy(asc(planDocumentMarkups.deletedAt))
        .limit(batchSize);

      if (expired.length === 0) break;

      const ids = expired.map((row) => row.id);
      if (opts.afterSelectForTest) {
        await opts.afterSelectForTest(ids);
      }
      // The DELETE re-asserts the same `deleted_at IS NOT NULL AND
      // deleted_at < cutoff` predicate as the SELECT so a row that
      // gets restored (deleted_at cleared via POST /:id/restore) in
      // the gap between the two statements is safe — the predicate
      // mismatch causes the row to be skipped instead of hard-deleted
      // out from under the user.
      const deleted = await db
        .delete(planDocumentMarkups)
        .where(and(
          inArray(planDocumentMarkups.id, ids),
          isNotNull(planDocumentMarkups.deletedAt),
          lt(planDocumentMarkups.deletedAt, cutoff),
        ))
        .returning({ id: planDocumentMarkups.id });

      batches += 1;
      totalDeleted += deleted.length;

      // Short-circuit when the SELECT returned a partial batch — there
      // can't be any more rows older than the cutoff to chase.
      if (expired.length < batchSize) break;
    }

    if (batches >= maxBatches) {
      cappedAtMaxBatches = true;
    }

    const durationMs = Date.now() - startedAt;

    if (totalDeleted > 0 || cappedAtMaxBatches) {
      logInfo("[PlanDocumentMarkupTrashPurge] purged soft-deleted markups", {
        deleted: totalDeleted,
        batches,
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        cappedAtMaxBatches,
        durationMs,
      });
    }

    // Emit a sample on every tick — including the "nothing to do"
    // path — so the operations dashboard sees every nightly run and
    // the over-delete spike rules have a baseline.
    recordJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB, {
      deleted: totalDeleted,
      batches,
      durationMs,
      ...(cappedAtMaxBatches ? { cappedAtMaxBatches: 1 } : {}),
    });

    return { deleted: totalDeleted, batches, cappedAtMaxBatches, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logError("[PlanDocumentMarkupTrashPurge] failed to purge soft-deleted markups", {
      error: err instanceof Error ? err.message : String(err),
      retentionDays: days,
      partialDeleted: totalDeleted,
      partialBatches: batches,
      durationMs,
    });
    throw err;
  }
}
