/**
 * Task #1665 — nightly retention sweep for
 * `project_log_email_schedule_attempts`.
 *
 * Every cron tick AND every manual "Send now" writes a row to this
 * table. With ~24 hourly cron checks per day per (project x log type),
 * the table will grow indefinitely. The project settings UI only ever
 * surfaces the most recent 10 (max 50) attempts per schedule, so
 * anything older than the retention window is audit dead-weight that
 * just slows the per-schedule history query and bloats the table.
 *
 * Retention defaults to PROJECT_LOG_EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS
 * (90 days), exposed as a single named constant so it's easy to tune.
 * For ops flexibility the value can also be overridden at runtime via
 * the PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS env var. Override
 * semantics, mirroring `pruneSuppressionResets`:
 *   - unset / blank        -> use the default (90 days)
 *   - non-numeric          -> use the default (90 days)
 *   - <= 0                 -> disables the sweep entirely so operators
 *                             can pause it without redeploying
 *
 * Deletion is performed in capped batches (SELECT id LIMIT N, then
 * DELETE WHERE id IN (...)) so a single nightly run on a large tenant
 * cannot grab a long row-level lock, balloon WAL, or starve the
 * schedule-attempts insert path that the cron and manual-send flows
 * depend on.
 *
 * DB failures are logged AND re-thrown so the cron wrapper in
 * `jobRunner.ts` records a failed sample for the prune job instead of
 * silently marking every tick as a success when the DB is misbehaving.
 */

import { asc, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import { withSystemJobContext } from "../dbContext";
import { projectLogEmailScheduleAttempts } from "@shared/schema";
import { logError, logInfo } from "../utils/logger";

export const PROJECT_LOG_EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS = 90;

/**
 * Per-iteration cap on rows deleted. Small enough that a single
 * statement holds row locks for a few hundred milliseconds at most on
 * the largest tenants we've seen, big enough that a busy account with
 * tens of thousands of stale rows still drains in well under a minute.
 */
export const PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_BATCH_SIZE = 1000;

/**
 * Hard ceiling on how many batches a single nightly run will issue.
 * 200 batches * 1000 rows = 200k rows / night, which comfortably
 * outpaces the worst-case insert rate (~24 attempts/day per schedule
 * x manual sends). If we ever hit the ceiling we log a warning and
 * leave the rest for tomorrow rather than running unbounded.
 */
export const PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_MAX_BATCHES = 200;

export function getProjectLogEmailAttemptRetentionDays(): number {
  const raw = process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return PROJECT_LOG_EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return PROJECT_LOG_EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS;
  }
  return parsed;
}

export interface PruneProjectLogEmailScheduleAttemptsResult {
  deleted: number;
  batches: number;
  cappedAtMaxBatches: boolean;
}

export async function pruneProjectLogEmailScheduleAttempts(
  opts: { now?: Date } = {},
): Promise<PruneProjectLogEmailScheduleAttemptsResult> {
  const days = getProjectLogEmailAttemptRetentionDays();
  if (!Number.isFinite(days) || days <= 0) {
    logInfo("[ProjectLogEmailRetention] attempt-history retention sweep disabled", { days });
    return { deleted: 0, batches: 0, cappedAtMaxBatches: false };
  }

  // Task #2673 — cross-tenant retention sweep. `withSystemJobContext`
  // delegates to `runAsSuperadmin` (audited). Disabled-sweep ticks
  // short-circuit above so we don't write an audit row when there is
  // no DB work to do.
  return withSystemJobContext("projectLogEmailScheduleAttemptPrune", async () => {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const batchSize = PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_BATCH_SIZE;
  const maxBatches = PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_MAX_BATCHES;

  let totalDeleted = 0;
  let batches = 0;
  let cappedAtMaxBatches = false;

  try {
    while (batches < maxBatches) {
      // Deterministic oldest-first order so each batch consumes the
      // earliest expired rows, draining predictably even if the
      // background insert path keeps appending fresh rows during the
      // sweep.
      const expired = await db
        .select({ id: projectLogEmailScheduleAttempts.id })
        .from(projectLogEmailScheduleAttempts)
        .where(lt(projectLogEmailScheduleAttempts.createdAt, cutoff))
        .orderBy(asc(projectLogEmailScheduleAttempts.createdAt))
        .limit(batchSize);

      if (expired.length === 0) break;

      const ids = expired.map((row) => row.id);
      const deleted = await db
        .delete(projectLogEmailScheduleAttempts)
        .where(inArray(projectLogEmailScheduleAttempts.id, ids))
        .returning({ id: projectLogEmailScheduleAttempts.id });

      batches += 1;
      totalDeleted += deleted.length;

      // Short-circuit when the SELECT returned a partial batch — there
      // can't be any more rows older than the cutoff to chase.
      if (expired.length < batchSize) break;
    }

    if (batches >= maxBatches) {
      cappedAtMaxBatches = true;
    }

    if (totalDeleted > 0 || cappedAtMaxBatches) {
      logInfo("[ProjectLogEmailRetention] pruned old attempt-history rows", {
        deleted: totalDeleted,
        batches,
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        cappedAtMaxBatches,
      });
    }

    return { deleted: totalDeleted, batches, cappedAtMaxBatches };
  } catch (err) {
    logError("[ProjectLogEmailRetention] failed to prune attempt-history rows", {
      error: err instanceof Error ? err.message : String(err),
      retentionDays: days,
      partialDeleted: totalDeleted,
      partialBatches: batches,
    });
    throw err;
  }
  });
}
