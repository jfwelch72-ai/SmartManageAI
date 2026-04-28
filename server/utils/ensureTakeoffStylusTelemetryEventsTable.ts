import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2220 — Anonymous, tenant-scoped log of the three takeoff
 * pen/touch interactions whose defaults Section 7 of the Takeoff
 * Interaction Map currently tunes by hand: palm rejection, the
 * stylus long-press snap-HUD opening, and the two-finger rotate
 * gesture.
 *
 * Idempotent — runs at every server boot via runStartupMigrations.
 * Mirrors the Drizzle definition in shared/schema/operations.ts.
 */
export async function ensureTakeoffStylusTelemetryEventsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "takeoff_stylus_telemetry_events" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "event_type" text NOT NULL,
        "pointer_type" text,
        "device_class" text,
        "dwell_ms" integer,
        "contact_size_px" double precision,
        "rotation_delta_deg" double precision,
        "band_px" integer,
        "configured_threshold_ms" integer,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    // Idempotently add columns introduced after the initial table
    // shipped, so a server upgraded mid-flight picks up the new
    // shape without an out-of-band migration step.
    await db.execute(sql`
      ALTER TABLE "takeoff_stylus_telemetry_events"
        ADD COLUMN IF NOT EXISTS "configured_threshold_ms" integer
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "takeoff_stylus_telemetry_org_created_idx"
        ON "takeoff_stylus_telemetry_events" ("organization_id", "created_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "takeoff_stylus_telemetry_event_type_idx"
        ON "takeoff_stylus_telemetry_events" ("event_type")
    `);
    console.log("[migration] takeoff_stylus_telemetry_events table ready");
  } catch (err) {
    logError(
      "[migration] failed ensuring takeoff_stylus_telemetry_events table",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
