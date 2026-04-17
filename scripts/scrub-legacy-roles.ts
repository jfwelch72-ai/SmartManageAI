/**
 * Idempotent pre-migration scrub: convert legacy 18-role values to the 8-role
 * canonical values across every table that uses the user_role enum, so that
 * `drizzle-kit push` can safely recast the column to the new enum without
 * tripping "invalid input value for enum user_role" errors.
 *
 * Safe to run multiple times. No-ops when no legacy values are present, when
 * the columns don't exist yet, or when the database is unreachable.
 */
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

const ROLE_REMAP: Record<string, string> = {
  OFFICE_MANAGER: "MANAGER",
  HR_MANAGER: "MANAGER",
  SALES: "MANAGER",
  MARKETING: "MANAGER",
  PROCUREMENT_MANAGER: "MANAGER",
  SAFETY_MANAGER: "SUPERINTENDENT",
  DISPATCHER: "SUPERINTENDENT",
  PROJECT_ENGINEER: "ESTIMATOR",
  MAINTENANCE_MANAGER: "FIELD_WORKER",
  EQUIPMENT_MANAGER: "FIELD_WORKER",
  HOURLY_EMPLOYEE: "FIELD_WORKER",
};

const TARGETS: { table: string; column: string }[] = [
  { table: "users", column: "role" },
  { table: "ai_tasks", column: "role" },
  { table: "hustler_organizations", column: "role_override" },
  { table: "hustler_link_requests", column: "role_override" },
];

async function main() {
  if (!DATABASE_URL) {
    console.log("[scrub-legacy-roles] DATABASE_URL not set — skipping");
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  let totalUpdated = 0;

  try {
    const enumCheck = await pool.query(
      `SELECT 1 FROM pg_type WHERE typname = 'user_role' LIMIT 1`,
    );
    if (enumCheck.rowCount === 0) {
      console.log("[scrub-legacy-roles] user_role enum not present yet — skipping");
      return;
    }

    const enumLabels = await pool.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'user_role'::regtype`,
    );
    const labels = new Set(enumLabels.rows.map((r) => r.enumlabel));

    const presentLegacy = Object.keys(ROLE_REMAP).filter((l) => labels.has(l));
    if (presentLegacy.length === 0) {
      console.log("[scrub-legacy-roles] no legacy role labels present in user_role enum — nothing to scrub");
      return;
    }

    if (!labels.has("FIELD_WORKER")) {
      console.log("[scrub-legacy-roles] adding FIELD_WORKER to user_role enum");
      try {
        await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'FIELD_WORKER'`);
      } catch (err) {
        console.warn("[scrub-legacy-roles] ALTER TYPE FIELD_WORKER warning:", (err as Error).message);
      }
    }

    for (const { table, column } of TARGETS) {
      const colCheck = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
        [table, column],
      );
      if (colCheck.rowCount === 0) continue;

      for (const legacy of presentLegacy) {
        const replacement = ROLE_REMAP[legacy];
        try {
          const res = await pool.query(
            `UPDATE "${table}" SET "${column}" = $1::user_role WHERE "${column}"::text = $2`,
            [replacement, legacy],
          );
          if (res.rowCount && res.rowCount > 0) {
            totalUpdated += res.rowCount;
            console.log(`[scrub-legacy-roles] ${table}.${column}: ${res.rowCount} ${legacy} → ${replacement}`);
          }
        } catch (err) {
          console.warn(`[scrub-legacy-roles] ${table}.${column} ${legacy}→${replacement} skipped:`, (err as Error).message);
        }
      }
    }

    console.log(`[scrub-legacy-roles] complete — ${totalUpdated} row(s) remapped`);
  } catch (err) {
    console.warn("[scrub-legacy-roles] non-fatal error:", (err as Error).message);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.warn("[scrub-legacy-roles] fatal error (continuing):", err?.message || err);
  process.exit(0);
});
