// Task #2105 — Auto-tidy stale Takeoff "Recent" entries when their
// underlying bid or project is deleted.
//
// The `takeoff_recents` table only references users.id and organizations.id
// at the schema level (Task #2079), so a row keyed by (kind, entityId)
// happily outlives the bid or project it points at. The Takeoff index page
// already filters orphaned entries on render, but every dead row still
// counts against the per-user 24-entry cap. This helper is called from the
// bid and project DELETE handlers so the rail and the table stay in sync.
//
// Failures here are intentionally swallowed and logged — the parent delete
// has already happened by the time we run, the index page filters orphans
// anyway, and a full prune-on-render would be a worse fallback than a
// best-effort tidy.
//
// Task #2129 — `pruneOrphanedTakeoffRecents` is the nightly safety-net
// counterpart. The per-delete hook above only runs when the regular
// DELETE handlers in `bidRoutes2.ts` / `projectCrudRoutes.ts` execute,
// so a row that sneaks into `takeoff_recents` via a raw-SQL migration,
// an admin script, or a partial mid-delete failure can outlive its
// referenced bid / project indefinitely. This helper drops any
// `takeoff_recents` row whose `(kind, entityId)` no longer maps to a
// live bid (kind = 'bid') or project (kind = 'project') and is invoked
// from the cron registered in `server/jobs/jobRunner.ts`. Counts are
// returned per-kind so ops can spot a silently regressed hook in the
// per-run log line.

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { takeoffRecents, bids, projects } from "@shared/schema";
import { logError } from "./utils/logger";

export type TakeoffRecentEntityKind = "bid" | "project";

export async function pruneTakeoffRecentsForEntity(
  kind: TakeoffRecentEntityKind,
  entityId: string,
): Promise<void> {
  if (!entityId) return;
  try {
    await db
      .delete(takeoffRecents)
      .where(
        and(
          eq(takeoffRecents.kind, kind),
          eq(takeoffRecents.entityId, entityId),
        ),
      );
  } catch (error) {
    logError(
      "Failed to prune takeoff_recents for deleted entity",
      { kind, entityId },
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export interface PruneOrphanedTakeoffRecentsResult {
  /** Rows removed where `kind = 'bid'` and entityId no longer exists in `bids`. */
  bidRowsPruned: number;
  /** Rows removed where `kind = 'project'` and entityId no longer exists in `projects`. */
  projectRowsPruned: number;
  /** Convenience sum of the two per-kind counts. */
  totalPruned: number;
  /** Wall-clock duration of the sweep in milliseconds. */
  durationMs: number;
}

/**
 * Task #2129 — Nightly safety-net. Drops every `takeoff_recents` row
 * whose `(kind, entityId)` no longer points at a live row in `bids`
 * (kind = 'bid') or `projects` (kind = 'project').
 *
 * The two kinds are pruned with separate `NOT EXISTS` DELETEs so a
 * failure in one pass cannot silently mask the other, and so the
 * caller can log per-kind counts. Failures are re-thrown so the cron
 * wrapper in `jobRunner.ts` records a failed sample for the job
 * instead of marking every tick as a success when the DB misbehaves
 * (mirrors the pattern used by `purgePlanDocumentMarkupTrash` and the
 * other nightly purge helpers).
 */
export async function pruneOrphanedTakeoffRecents(): Promise<PruneOrphanedTakeoffRecentsResult> {
  const startedAt = Date.now();

  const deletedBids = await db
    .delete(takeoffRecents)
    .where(
      and(
        eq(takeoffRecents.kind, "bid"),
        sql`NOT EXISTS (SELECT 1 FROM ${bids} WHERE ${bids.id} = ${takeoffRecents.entityId})`,
      ),
    )
    .returning({ id: takeoffRecents.id });

  const deletedProjects = await db
    .delete(takeoffRecents)
    .where(
      and(
        eq(takeoffRecents.kind, "project"),
        sql`NOT EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${takeoffRecents.entityId})`,
      ),
    )
    .returning({ id: takeoffRecents.id });

  const bidRowsPruned = deletedBids.length;
  const projectRowsPruned = deletedProjects.length;

  return {
    bidRowsPruned,
    projectRowsPruned,
    totalPruned: bidRowsPruned + projectRowsPruned,
    durationMs: Date.now() - startedAt,
  };
}
