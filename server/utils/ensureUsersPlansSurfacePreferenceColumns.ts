import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1695 — Per-user preferences for the Plans surface (takeoff
 * workspace), promoted from per-user-id `localStorage` keys to
 * server-side columns so the settings sync across devices.
 *
 *   - `plans_toolbar_labeled`  — labeled (icon + text) variant of the
 *                                unified plan toolbar. Default `false`
 *                                preserves the existing icon-only UI.
 *   - `plans_tour_completed`   — dismissal marker for the plans-surface
 *                                guided tour (Task #1663). Default
 *                                `false` so users who have never seen
 *                                the tour still get it once.
 *
 * Both columns are NOT NULL with safe defaults, so the schema-drift
 * reconciler (Task #1075) can also auto-add them on fresh dev DBs.
 * This explicit ensure keeps the startup migration manifest complete
 * and matches the pattern used by the other `users` preference helpers.
 *
 * Idempotent: safe to run on every startup.
 */
export async function ensureUsersPlansSurfacePreferenceColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "plans_toolbar_labeled" boolean NOT NULL DEFAULT false
  `);
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "plans_tour_completed" boolean NOT NULL DEFAULT false
  `);
}
