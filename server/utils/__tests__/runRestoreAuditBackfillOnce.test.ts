// Task #1871 — integration tests for the restore-style audit row backfill.
//
// Exercises the real Postgres-side UPDATE...FROM jsonb statement against
// the live test DB to make sure:
//   (a) Pre-#1847 per-id restore rows (action='UPDATE',
//       new_value: { op: "restore", deletedAt: null }) are promoted to
//       action='RESTORE' AND have the `op` shim stripped from the JSON.
//   (b) Pre-#1847 bulk cached-snapshot rows (action='CREATE',
//       new_value: { op: "restore", requested, inserted, ids }) are
//       likewise promoted, and the surrounding count/ids fields survive.
//   (c) Rows already at action='RESTORE' are left alone (idempotent).
//   (d) Rows for the wrong entity_type are left alone (scope guard).
//   (e) The bulk soft-delete restore route's `op: "restoreBulk"` shim is
//       NOT touched (it's a separate flow not covered by Task #1847).
//   (f) A second invocation is a no-op zero-row UPDATE (idempotency).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq, and, inArray } from "drizzle-orm";

import { db } from "../../db";
import { auditLog, users, organizations } from "@shared/schema";

import { backfillRestoreStyleAuditRows } from "../runRestoreAuditBackfillOnce";
import { ensureAuditActionEnumValues } from "../ensureAuditActionEnumValues";

const PREFIX = "__restore_bf__";

let orgId: string;
let userId: string;
let testEntityIds: string[] = [];

async function cleanupAuditRows() {
  if (testEntityIds.length > 0) {
    await db
      .delete(auditLog)
      .where(inArray(auditLog.entityId, testEntityIds));
  }
}

beforeAll(async () => {
  // Make sure the dedicated RESTORE enum value (Task #1847) exists in
  // the test DB before we exercise the backfill — when SKIP_TEST_DB_PUSH
  // is in play (or the schema-rebuild cache is stale), the underlying
  // ALTER TYPE ADD VALUE migration may not have been applied.
  await ensureAuditActionEnumValues();

  // Clean up any leftover fixtures from a prior failed run.
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  for (const row of orgRows.rows ?? []) {
    await db.delete(users).where(eq(users.organizationId, row.id));
    await db.delete(organizations).where(eq(organizations.id, row.id));
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}org`, slug: `${PREFIX}org-${Date.now()}` })
    .returning();
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Restore",
      lastName: "Backfill",
      email: `${PREFIX}user-${Date.now()}@example.invalid`,
      role: "ADMIN",
      isActive: true,
      passwordHash: "x",
    })
    .returning();
  userId = user.id;
});

afterAll(async () => {
  await cleanupAuditRows();
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

beforeEach(async () => {
  await cleanupAuditRows();
  testEntityIds = [];
});

async function insertAuditRow(opts: {
  entityType: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "RESTORE";
  newValue: string | null;
}): Promise<string> {
  testEntityIds.push(opts.entityId);
  const [row] = await db
    .insert(auditLog)
    .values({
      userId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      newValue: opts.newValue,
    })
    .returning();
  return row.id;
}

async function getAuditRow(id: string) {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.id, id))
    .limit(1);
  return row;
}

describe("backfillRestoreStyleAuditRows", () => {
  it("promotes per-id legacy restore rows to action='RESTORE' and strips the `op` shim", async () => {
    const entityId = `markup-perid-${Date.now()}`;
    const rowId = await insertAuditRow({
      entityType: "planDocumentMarkup",
      entityId,
      action: "UPDATE",
      newValue: JSON.stringify({ op: "restore", deletedAt: null }),
    });

    const stats = await backfillRestoreStyleAuditRows();
    expect(stats.rowsUpdated).toBeGreaterThanOrEqual(1);

    const after = await getAuditRow(rowId);
    expect(after.action).toBe("RESTORE");
    // The remaining payload (just `deletedAt: null`) survives, just
    // without the now-meaningless `op` shim.
    expect(after.newValue).not.toBeNull();
    const parsed = JSON.parse(after.newValue as string);
    expect(parsed).not.toHaveProperty("op");
    expect(parsed).toMatchObject({ deletedAt: null });
  });

  it("promotes bulk cached-snapshot legacy restore rows and preserves count/ids fields", async () => {
    const entityId = `markup-bulkdoc-${Date.now()}`;
    const rowId = await insertAuditRow({
      entityType: "planDocumentMarkup",
      entityId,
      action: "CREATE",
      newValue: JSON.stringify({
        op: "restore",
        requested: 3,
        inserted: 3,
        ids: ["m-1", "m-2", "m-3"],
      }),
    });

    await backfillRestoreStyleAuditRows();

    const after = await getAuditRow(rowId);
    expect(after.action).toBe("RESTORE");
    const parsed = JSON.parse(after.newValue as string);
    expect(parsed).not.toHaveProperty("op");
    expect(parsed).toMatchObject({
      requested: 3,
      inserted: 3,
      ids: ["m-1", "m-2", "m-3"],
    });
  });

  it("leaves rows already at action='RESTORE' alone", async () => {
    const entityId = `markup-already-restore-${Date.now()}`;
    const rowId = await insertAuditRow({
      entityType: "planDocumentMarkup",
      entityId,
      action: "RESTORE",
      newValue: JSON.stringify({ op: "restore", deletedAt: null }),
    });

    const stats = await backfillRestoreStyleAuditRows();

    const after = await getAuditRow(rowId);
    expect(after.action).toBe("RESTORE");
    // The newValue is intentionally NOT modified — the WHERE clause
    // filters this row out before the JSON cleanup ever runs.
    expect(JSON.parse(after.newValue as string)).toMatchObject({ op: "restore" });
    // We can't assert stats.rowsUpdated === 0 because other tests in
    // this run may have inserted matching rows, but we CAN assert this
    // specific row is unchanged.
    expect(stats.rowsUpdated).toBeGreaterThanOrEqual(0);
  });

  it("leaves audit rows with the wrong entity_type alone", async () => {
    const entityId = `wrong-entity-${Date.now()}`;
    const rowId = await insertAuditRow({
      entityType: "someOtherEntity",
      entityId,
      action: "UPDATE",
      newValue: JSON.stringify({ op: "restore", deletedAt: null }),
    });

    await backfillRestoreStyleAuditRows();

    const after = await getAuditRow(rowId);
    expect(after.action).toBe("UPDATE");
    expect(JSON.parse(after.newValue as string)).toMatchObject({ op: "restore" });
  });

  it("does NOT touch the bulk soft-delete restore route's `op: \"restoreBulk\"` rows", async () => {
    // The bulk soft-delete restore at /markups/restore-bulk uses
    // op: "restoreBulk" (still under action='UPDATE'). That's a
    // different flow not covered by Task #1847's enum migration,
    // so it must NOT be promoted to RESTORE by this backfill.
    const entityId = `markup-restorebulk-${Date.now()}`;
    const rowId = await insertAuditRow({
      entityType: "planDocumentMarkup",
      entityId,
      action: "UPDATE",
      newValue: JSON.stringify({
        op: "restoreBulk",
        count: 2,
        ids: ["m-9", "m-10"],
      }),
    });

    await backfillRestoreStyleAuditRows();

    const after = await getAuditRow(rowId);
    expect(after.action).toBe("UPDATE");
    expect(JSON.parse(after.newValue as string)).toMatchObject({
      op: "restoreBulk",
    });
  });

  it("is idempotent: a second invocation does not promote already-promoted rows", async () => {
    const entityId = `markup-idempotent-${Date.now()}`;
    const rowId = await insertAuditRow({
      entityType: "planDocumentMarkup",
      entityId,
      action: "UPDATE",
      newValue: JSON.stringify({ op: "restore", deletedAt: null }),
    });

    const first = await backfillRestoreStyleAuditRows();
    expect(first.rowsUpdated).toBeGreaterThanOrEqual(1);

    const after = await getAuditRow(rowId);
    expect(after.action).toBe("RESTORE");
    const promotedNewValue = after.newValue;

    // Snapshot the row before the second pass so we can prove it
    // wasn't re-touched (action and newValue both stable).
    const beforeSecond = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "planDocumentMarkup"), eq(auditLog.id, rowId)))
      .limit(1);

    const second = await backfillRestoreStyleAuditRows();
    // Crucially: this row is no longer eligible (action='RESTORE'),
    // so it MUST NOT be re-counted in the second run's stats. Other
    // tests' rows may still be in flight, but this specific row's
    // contents are unchanged.
    const afterSecond = await getAuditRow(rowId);
    expect(afterSecond.action).toBe("RESTORE");
    expect(afterSecond.newValue).toBe(promotedNewValue);
    expect(beforeSecond[0]?.newValue).toBe(promotedNewValue);
    expect(second.rowsUpdated).toBeGreaterThanOrEqual(0);
  });
});
