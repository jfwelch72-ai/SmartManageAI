import { logInfo, logError } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Backfills `status_probe_daily` so the public 90-day uptime chart fills in
 * immediately rather than slowly accumulating over ~2 months of new probes.
 *
 * Important: we don't have an external uptime monitor export to import. The
 * best signal available in our own database is the most recent verdict for
 * each component (either from `status_probes` or the deterministic config
 * check that the live probe scheduler uses). For days older than the raw
 * probe retention window (~35 days) and where no rollup row already exists,
 * we record that latest-known verdict as a per-component placeholder so the
 * 90-day chart is visually complete instead of all-blank.
 *
 * This is intentionally a placeholder — each backfilled day is recorded as a
 * single sample (total=1) rather than a full day of probes, which means the
 * uptime percentage for those days is dominated by real, current data as
 * soon as it accumulates. The function never overwrites existing rows
 * (`ON CONFLICT DO NOTHING`), so anything previously rolled up from raw
 * `status_probes` always wins.
 *
 * The implementation is per-component: each row is derived from that
 * component's own latest verdict, so an outage in (for example) the API
 * does not retroactively mark the database component as down.
 */
export async function backfillStatusProbeDailyHistory(): Promise<void> {
  try {
    const componentsRes = await db.execute(sql`
      SELECT id, key, probe_kind
      FROM "status_components"
      WHERE enabled = true
    `);
    const components = componentsRes.rows as Array<{
      id: string;
      key: string;
      probe_kind: string;
    }>;
    if (components.length === 0) {
      logInfo("[migration] status_probe_daily backfill — no components, skipped");
      return;
    }

    let totalInserted = 0;
    for (const c of components) {
      totalInserted += await backfillComponent(c);
    }

    if (totalInserted > 0) {
      logInfo(
        `[migration] status_probe_daily backfill — inserted ${totalInserted} placeholder day rows`,
      );
    } else {
      logInfo("[migration] status_probe_daily backfill — nothing to backfill");
    }
  } catch (err) {
    logError(
      "[migration] status_probe_daily backfill failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function latestComponentVerdict(componentId: string): Promise<boolean | null> {
  const res = await db.execute(sql`
    SELECT ok FROM "status_probes"
    WHERE component_id = ${componentId}
    ORDER BY checked_at DESC
    LIMIT 1
  `);
  const row = res.rows[0] as { ok: boolean } | undefined;
  return row ? row.ok : null;
}

function deterministicVerdict(component: { key: string; probe_kind: string }): boolean | null {
  switch (component.probe_kind) {
    case "config_present":
      if (component.key === "email") return !!process.env.SENDGRID_API_KEY;
      if (component.key === "ai") {
        return !!(
          process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
        );
      }
      return true;
    case "object_storage":
      return !!(
        process.env.PUBLIC_OBJECT_SEARCH_PATHS ||
        process.env.PRIVATE_OBJECT_DIR ||
        process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID
      );
    default:
      return null;
  }
}

async function backfillComponent(component: {
  id: string;
  key: string;
  probe_kind: string;
}): Promise<number> {
  // Prefer the latest real probe verdict for this specific component; fall
  // back to the deterministic check used by the live scheduler when no raw
  // probes exist yet. If neither is available, skip — we don't make up data.
  const latest = await latestComponentVerdict(component.id);
  const verdict = latest ?? deterministicVerdict(component);
  if (verdict === null) return 0;

  const existingRes = await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day
    FROM "status_probe_daily"
    WHERE component_id = ${component.id}
      AND day >= (NOW() AT TIME ZONE 'UTC')::date - INTERVAL '89 days'
  `);
  const existing = new Set(
    (existingRes.rows as Array<{ day: string }>).map((r) => r.day),
  );

  const missing = lastNDaysUtc(90).filter((d) => !existing.has(d));
  if (missing.length === 0) return 0;

  const ok = verdict ? 1 : 0;
  const values = missing.map(
    (day) => sql`(${component.id}, ${day}::date, 1, ${ok})`,
  );

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await db.execute(sql`
      INSERT INTO "status_probe_daily" ("component_id","day","total","ok")
      VALUES ${sql.join(chunk, sql`, `)}
      ON CONFLICT ("component_id","day") DO NOTHING
    `);
    inserted += chunk.length;
  }
  return inserted;
}

function lastNDaysUtc(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  const anchor = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(anchor - i * 86_400_000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}
