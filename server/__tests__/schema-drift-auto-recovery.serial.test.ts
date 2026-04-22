import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { Express } from "express";
import type { Server } from "http";
import request from "supertest";

// Task #1088 — regression test for the auto-recovery behavior added in
// Task #1075.
//
// EXECUTION ISOLATION: this file is named `*.serial.test.ts` and is excluded
// from the default `npm test` parallel run by vitest.config.ts. It performs
// destructive, schema-level mutations against the shared test DB
// (DROP COLUMN on `users`, DROP TYPE on `backfill_summary_channel`) which,
// while only inverted within the test, would race other parallel workers
// SELECTing from `users` and surface as flaky `column ... does not exist`
// failures. Run it explicitly with file parallelism disabled:
//
//   RUN_SERIAL_DB_TESTS=1 npx vitest run \
//     server/__tests__/schema-drift-auto-recovery.serial.test.ts \
//     --no-file-parallelism
//
// The startup pipeline (`runStartupMigrations()`) is supposed to leave a
// freshly-pulled dev database in a runnable state — concretely, after a
// yank of a column + its enum:
//
//   1. `reconcileSchemaDrift()` (called at the end of the migrations pass)
//      recreates any missing pg enum types FIRST so subsequent ADD COLUMN
//      statements that reference them don't fail with `type "..." does not
//      exist`, then ADD COLUMN IF NOT EXISTS for any column the Drizzle
//      schema declares but the DB is missing — synthesizing a literal
//      DEFAULT from the column metadata where possible.
//   2. `/api/dev/test-login` — the canonical "did boot recover?" smoke
//      endpoint that originally regressed in Task #1075 — must return 200,
//      proving the dropped column on `users` is back and the post-login
//      activityLog write no longer 500s.
//
// This file pins down both halves: a focused unit-style test that calls
// `reconcileSchemaDrift()` directly to assert the enum-then-column ordering
// contract, and an integration test that drops the same column + enum,
// runs the full `runStartupMigrations()` pipeline, and hits
// `/api/dev/test-login` to confirm the user-visible startup recovery.

const TARGET_TABLE = "users";
const TARGET_COLUMN = "crm_backfill_summary_channel";
const TARGET_ENUM = "backfill_summary_channel";

let prevDisableAutoSync: string | undefined;
let prevNodeEnv: string | undefined;

beforeAll(() => {
  prevDisableAutoSync = process.env.DISABLE_AUTO_DB_SYNC;
  prevNodeEnv = process.env.NODE_ENV;
  delete process.env.DISABLE_AUTO_DB_SYNC;
  // /api/dev/test-login is gated by `isDevSeedEnabled()` which checks
  // NODE_ENV === "development". Vitest defaults NODE_ENV to "test", so we
  // flip it for the duration of this file. "development" also satisfies the
  // drift reconciler's "non-production" check, so the auto-mutation path
  // we're exercising is still active.
  process.env.NODE_ENV = "development";
});

afterAll(async () => {
  // Best-effort schema restoration: if a test aborted partway through (e.g.
  // assertion failure between DROP and recovery, or process kill), make
  // sure we leave the shared test DB in a runnable state for the next run
  // by re-invoking the same recovery path the tests exercise.
  try {
    const { reconcileSchemaDrift } = await import("../utils/schemaDriftDetector");
    await reconcileSchemaDrift();
  } catch {
    // Swallow — this is best-effort cleanup; the original test failure
    // (if any) is what the developer needs to see.
  }

  if (prevDisableAutoSync === undefined) delete process.env.DISABLE_AUTO_DB_SYNC;
  else process.env.DISABLE_AUTO_DB_SYNC = prevDisableAutoSync;
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
});

async function columnExists(table: string, column: string): Promise<boolean> {
  const { db } = await import("../db");
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

async function enumExists(name: string): Promise<boolean> {
  const { db } = await import("../db");
  const res = await db.execute(sql`
    SELECT 1 FROM pg_type WHERE typname = ${name} AND typtype = 'e' LIMIT 1
  `);
  return res.rows.length > 0;
}

async function dropTargetColumnAndEnum(): Promise<void> {
  const { db } = await import("../db");
  // Column must be dropped before the enum, or the enum drop fails on the
  // dependency. After both, the DB looks like a freshly-pulled checkout
  // that never received the Task #1089 migration.
  await db.execute(
    sql.raw(`ALTER TABLE "${TARGET_TABLE}" DROP COLUMN IF EXISTS "${TARGET_COLUMN}"`),
  );
  await db.execute(sql.raw(`DROP TYPE IF EXISTS "${TARGET_ENUM}"`));
}

describe("Schema drift auto-recovery — Task #1075 contract", () => {
  it("reconcileSchemaDrift() re-adds a missing enum type and the column that depends on it", async () => {
    const { db } = await import("../db");

    await dropTargetColumnAndEnum();
    expect(await columnExists(TARGET_TABLE, TARGET_COLUMN)).toBe(false);
    expect(await enumExists(TARGET_ENUM)).toBe(false);

    const { reconcileSchemaDrift } = await import("../utils/schemaDriftDetector");
    await reconcileSchemaDrift();

    // Enum must have been recreated FIRST — otherwise the column ADD would
    // have failed with `type "backfill_summary_channel" does not exist`.
    expect(await enumExists(TARGET_ENUM)).toBe(true);
    expect(await columnExists(TARGET_TABLE, TARGET_COLUMN)).toBe(true);

    // Sanity: the recreated column should carry the schema-declared NOT NULL
    // and DEFAULT 'email', otherwise existing user rows would have been
    // left in an inconsistent state by the auto-add.
    const meta = await db.execute(sql`
      SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${TARGET_TABLE}
        AND column_name = ${TARGET_COLUMN}
    `);
    const row = meta.rows[0] as { is_nullable: string; column_default: string | null };
    expect(row.is_nullable).toBe("NO");
    expect(row.column_default ?? "").toContain("email");
  }, 60_000);

  it("runStartupMigrations() recovers a freshly-pulled dev DB so /api/dev/test-login returns 200", async () => {
    // Re-yank to the freshly-pulled state so this test stands on its own
    // (vitest doesn't guarantee intra-file ordering across reruns).
    await dropTargetColumnAndEnum();
    expect(await columnExists(TARGET_TABLE, TARGET_COLUMN)).toBe(false);

    const { runStartupMigrations } = await import("../utils/runStartupMigrations");
    await runStartupMigrations();

    // After the full startup pipeline, both the enum and the column must be
    // back regardless of whether the dedicated ensureXxx() ran first or
    // the generic reconcileSchemaDrift() filled the gap — both paths are
    // part of the Task #1075 contract.
    expect(await enumExists(TARGET_ENUM)).toBe(true);
    expect(await columnExists(TARGET_TABLE, TARGET_COLUMN)).toBe(true);

    // End-to-end smoke: the original Task #1075 symptom was that
    // /api/dev/test-login 500'd because the post-login activityLog write
    // referenced the missing column. Now that recovery has run, the route
    // should return 200 with a user payload.
    const express = (await import("express")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const { registerRoutes } = await import("../routes");

    const app: Express = express();
    app.use(express.json());
    app.use(cookieParser());
    const server: Server = await registerRoutes(app);
    try {
      const res = await request(app)
        .post("/api/dev/test-login")
        .send({ role: "ADMIN" });
      expect(res.status).toBe(200);
      expect(res.body?.user?.role).toBe("ADMIN");
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  }, 120_000);
});
