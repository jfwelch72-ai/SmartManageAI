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

import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { takeoffRecents } from "@shared/schema";
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
