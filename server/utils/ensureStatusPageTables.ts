import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureStatusPageTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_components" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "key" text NOT NULL UNIQUE,
      "name" text NOT NULL,
      "description" text,
      "probe_kind" text NOT NULL DEFAULT 'http_get',
      "probe_url" text,
      "probe_expect_status" integer NOT NULL DEFAULT 200,
      "probe_timeout_ms" integer NOT NULL DEFAULT 8000,
      "enabled" boolean NOT NULL DEFAULT true,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_probes" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "component_id" varchar NOT NULL REFERENCES "status_components"("id") ON DELETE CASCADE,
      "ok" boolean NOT NULL,
      "status_code" integer,
      "response_ms" integer,
      "error" text,
      "region" text NOT NULL DEFAULT 'local',
      "checked_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  // Backfill region column on existing installations
  await db.execute(sql`ALTER TABLE "status_probes" ADD COLUMN IF NOT EXISTS "region" text NOT NULL DEFAULT 'local'`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_probes_component_checked_idx" ON "status_probes" ("component_id","checked_at" DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_probes_component_region_checked_idx" ON "status_probes" ("component_id","region","checked_at" DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_probe_daily" (
      "component_id" varchar NOT NULL REFERENCES "status_components"("id") ON DELETE CASCADE,
      "day" date NOT NULL,
      "total" integer NOT NULL DEFAULT 0,
      "ok" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("component_id","day")
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_probe_daily_day_idx" ON "status_probe_daily" ("day" DESC)`);

  // Backfill rollup from any existing raw probes that are not yet represented.
  // Safe to run repeatedly: ON CONFLICT keeps whichever counts are larger so we
  // don't lose data once raw rows have been pruned past 35 days.
  await db.execute(sql`
    INSERT INTO "status_probe_daily" ("component_id","day","total","ok")
    SELECT
      component_id,
      (checked_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*)::int AS total,
      SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS ok
    FROM "status_probes"
    GROUP BY component_id, (checked_at AT TIME ZONE 'UTC')::date
    ON CONFLICT ("component_id","day") DO UPDATE
      SET total = GREATEST("status_probe_daily".total, EXCLUDED.total),
          ok = GREATEST("status_probe_daily".ok, EXCLUDED.ok)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_incidents" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" text NOT NULL,
      "status" text NOT NULL DEFAULT 'INVESTIGATING',
      "impact" text NOT NULL DEFAULT 'MINOR',
      "affected_components" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "started_at" timestamp NOT NULL DEFAULT now(),
      "resolved_at" timestamp,
      "postmortem_url" text,
      "postmortem" text,
      "created_by_user_id" varchar REFERENCES "users"("id"),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_incidents_started_idx" ON "status_incidents" ("started_at" DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_incident_updates" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "incident_id" varchar NOT NULL REFERENCES "status_incidents"("id") ON DELETE CASCADE,
      "status" text NOT NULL,
      "body" text NOT NULL,
      "created_by_user_id" varchar REFERENCES "users"("id"),
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_incident_updates_incident_idx" ON "status_incident_updates" ("incident_id","created_at" DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_subscribers" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" text NOT NULL UNIQUE,
      "confirmed" boolean NOT NULL DEFAULT false,
      "confirm_token" text NOT NULL,
      "unsubscribe_token" text NOT NULL,
      "last_notified_incident_id" varchar,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "confirmed_at" timestamp
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_subscriber_removals" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" text NOT NULL,
      "removed_by_user_id" varchar REFERENCES "users"("id"),
      "reason" text,
      "removed_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_subscriber_removals_removed_at_idx" ON "status_subscriber_removals" ("removed_at" DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_incident_notifications" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "incident_id" varchar NOT NULL REFERENCES "status_incidents"("id") ON DELETE CASCADE,
      "update_id" varchar REFERENCES "status_incident_updates"("id") ON DELETE CASCADE,
      "subscriber_id" varchar NOT NULL REFERENCES "status_subscribers"("id") ON DELETE CASCADE,
      "sent_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "status_incident_notifications_unique" ON "status_incident_notifications" ("incident_id","update_id","subscriber_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_alert_state" (
      "component_id" varchar PRIMARY KEY REFERENCES "status_components"("id") ON DELETE CASCADE,
      "is_alerting" boolean NOT NULL DEFAULT false,
      "consecutive_failures" integer NOT NULL DEFAULT 0,
      "opened_at" timestamp,
      "last_alert_sent_at" timestamp,
      "last_recovery_sent_at" timestamp,
      "last_error" text,
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "status_alert_dispatches" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "component_id" varchar NOT NULL REFERENCES "status_components"("id") ON DELETE CASCADE,
      "kind" text NOT NULL,
      "channel" text NOT NULL,
      "target" text NOT NULL,
      "ok" boolean NOT NULL,
      "error" text,
      "consecutive_failures" integer,
      "sent_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "status_alert_dispatches_component_idx" ON "status_alert_dispatches" ("component_id","sent_at" DESC)`);

  // Seed default components if table is empty
  const existing = await db.execute(sql`SELECT COUNT(*)::int AS c FROM "status_components"`);
  const count = (existing.rows[0] as { c: number }).c;
  if (count === 0) {
    const defaults: Array<{ key: string; name: string; kind: string; sort: number }> = [
      { key: "web", name: "Web application", kind: "http_public", sort: 1 },
      { key: "api", name: "API", kind: "http_self_health", sort: 2 },
      { key: "database", name: "Database", kind: "db_ping", sort: 3 },
      { key: "files", name: "File uploads & downloads", kind: "object_storage", sort: 4 },
      { key: "email", name: "Email & notifications", kind: "config_present", sort: 5 },
      { key: "ai", name: "AI features", kind: "config_present", sort: 6 },
    ];
    for (const c of defaults) {
      await db.execute(sql`
        INSERT INTO "status_components" ("key","name","probe_kind","sort_order")
        VALUES (${c.key}, ${c.name}, ${c.kind}, ${c.sort})
        ON CONFLICT ("key") DO NOTHING
      `);
    }
    console.log("[migration] status_page — seeded default components");
  }

  // Upgrade legacy "web" component from local self-check to real outbound HTTP probe
  await db.execute(sql`
    UPDATE "status_components"
    SET probe_kind = 'http_public'
    WHERE key = 'web' AND probe_kind = 'http_self'
  `);

  console.log("[migration] status_page — tables ready");
}
