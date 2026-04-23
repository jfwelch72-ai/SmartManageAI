import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { pgTable, text, integer } from "drizzle-orm/pg-core";

// Task #1136 — regression test for the `reconcileSchemaDrift()` guardrail
// that REFUSES to auto-add a NOT NULL column with no synthesizable default.
//
// The reconciler is supposed to skip such columns (which would otherwise
// take down dev startup with `column ... contains null values` against a
// populated table) and instead surface them in the loud "drift remains"
// banner alongside the `npx drizzle-kit push` repro hint. That contract
// lives in `buildAddColumnSql()` returning `null` and the failedColumns
// branch in `reconcileSchemaDrift()` printing the warn-level banner.
//
// Strategy: stand up a uniquely-named throwaway table in the real test DB
// that is missing one NOT NULL no-default column, then `vi.doMock` the
// `@shared/schema` module so the schemaDriftDetector sees ONLY our
// synthetic Drizzle table. That keeps the reconciler's diff focused on the
// single column we care about and avoids any interaction with the real
// project schema (no DROP COLUMN on `users`, no risk of leaking a partial
// auto-add into other parallel suites).

const TEST_TABLE = `task_1136_drift_${process.pid}_${Date.now()}`;
const NN_NO_DEFAULT_COLUMN = "needs_backfill";

async function getRealDb() {
  // Bypass the mocked `@shared/schema` by importing the runtime db handle
  // through a path the mock doesn't intercept.
  const { db } = await import("../db");
  return db;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const db = await getRealDb();
  const res = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
    LIMIT 1
  `);
  return res.rows.length > 0;
}

describe("reconcileSchemaDrift() — Task #1136 NOT NULL no-default guardrail", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];
  let prevDisableAutoSync: string | undefined;
  let prevNodeEnv: string | undefined;

  beforeEach(async () => {
    prevDisableAutoSync = process.env.DISABLE_AUTO_DB_SYNC;
    prevNodeEnv = process.env.NODE_ENV;
    delete process.env.DISABLE_AUTO_DB_SYNC;
    // Stay out of the production branch (which throws) and the opt-out
    // branch (which short-circuits before the auto-add loop) — we want the
    // dev auto-recovery code path to run end-to-end.
    process.env.NODE_ENV = "development";

    captured = [];
    warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      captured.push("WARN " + args.map((a) => String(a)).join(" "));
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      captured.push("ERROR " + args.map((a) => String(a)).join(" "));
    });
    infoSpy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      captured.push("INFO " + args.map((a) => String(a)).join(" "));
    });

    // Create the throwaway table WITHOUT the NOT NULL column. The
    // reconciler will then see that column as "missing from DB" and have
    // to decide whether to auto-add it. Seed one row so a hypothetical
    // bad ALTER TABLE ADD COLUMN ... NOT NULL would actually fail at
    // runtime (an empty table would mask the bug we're guarding against).
    const db = await getRealDb();
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TEST_TABLE}"`));
    await db.execute(
      sql.raw(`CREATE TABLE "${TEST_TABLE}" (id integer PRIMARY KEY, label text NOT NULL)`),
    );
    await db.execute(sql.raw(`INSERT INTO "${TEST_TABLE}" (id, label) VALUES (1, 'seed')`));
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    try {
      const db = await getRealDb();
      await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TEST_TABLE}"`));
    } catch {
      // best-effort cleanup
    }
    if (prevDisableAutoSync === undefined) delete process.env.DISABLE_AUTO_DB_SYNC;
    else process.env.DISABLE_AUTO_DB_SYNC = prevDisableAutoSync;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    vi.doUnmock("@shared/schema");
    vi.resetModules();
  });

  it("refuses to auto-add a NOT NULL column with no default and prints the drift-remains banner", async () => {
    // Synthetic Drizzle schema: one table, with one extra NOT NULL column
    // (no default) compared to what we created in the DB above. Because we
    // mock `@shared/schema` wholesale, `extractDrizzleSchema()` will only
    // discover this table — the reconciler's diff is pinned to the single
    // column we want to assert against.
    vi.doMock("@shared/schema", () => {
      const testTable = pgTable(TEST_TABLE, {
        id: integer("id").primaryKey(),
        label: text("label").notNull(),
        // The column under test: NOT NULL, no default. `buildAddColumnSql`
        // must return `null` for this so we never emit
        //   ALTER TABLE ... ADD COLUMN needs_backfill text NOT NULL
        // against a populated table.
        needsBackfill: text(NN_NO_DEFAULT_COLUMN).notNull(),
      });
      return { [`${TEST_TABLE}Table`]: testTable };
    });

    vi.resetModules();
    const { reconcileSchemaDrift } = await import("../utils/schemaDriftDetector");

    await reconcileSchemaDrift();

    // Contract #1: the DB is left untouched. The NOT NULL column must not
    // have been added — that would have either failed at runtime against
    // the seeded row, or worse, succeeded with a silent empty-string fill
    // on an empty table and left the populated table case as a latent
    // production bug.
    expect(await columnExists(TEST_TABLE, NN_NO_DEFAULT_COLUMN)).toBe(false);

    // Contract #2: the loud "drift remains" banner fires, naming the
    // failed column with the documented reason and the one-line repro
    // command (`npx drizzle-kit push`) so the next contributor doesn't
    // lose an hour to a mysterious 500.
    const log = captured.join("\n");
    expect(log).toMatch(/\[schema-drift\] Auto-sync handled \d+ column\(s\) but drift remains\./);
    expect(log).toMatch(/failed adds: [1-9]/);
    expect(log).toContain(NN_NO_DEFAULT_COLUMN);
    // The "first failures" line in the banner must name our column. The
    // accompanying reason can be either of two shapes, both of which are
    // valid evidence that the guardrail held:
    //   (a) `buildAddColumnSql()` bailed upfront with the documented
    //       "NOT NULL column with no default" reason, OR
    //   (b) Postgres rejected the ALTER TABLE because the populated row
    //       would have to take a NULL ("contains null values").
    // What we MUST NOT see is a silent success — i.e. `appliedColumns`
    // incrementing for this column. The `Auto-sync handled 0 column(s)`
    // assertion below pins that down.
    expect(log).toMatch(
      /(NOT NULL column with no default|contains null values|cannot be safely auto-added)/i,
    );
    expect(log).toMatch(/\[schema-drift\] Auto-sync handled 0 column\(s\)/);
    expect(log).toContain("npx drizzle-kit push");

    // The banner is printed at warn level (not error), matching the
    // non-production branch in `reconcileSchemaDrift()`.
    const bannerLines = captured.filter((l) =>
      l.includes("Auto-sync handled") && l.includes("drift remains"),
    );
    expect(bannerLines.length).toBeGreaterThan(0);
    expect(bannerLines.every((l) => l.startsWith("WARN"))).toBe(true);
  }, 30_000);
});
