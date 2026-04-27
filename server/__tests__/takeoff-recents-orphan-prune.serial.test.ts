// Task #2157 — Integration test for `pruneOrphanedTakeoffRecents`.
//
// The hermetic suite in `takeoff-recents-cleanup.test.ts` drives the
// nightly sweep against an in-process drizzle mock, so it can prove the
// helper issues two `NOT EXISTS` DELETEs scoped to the right parent
// tables — but it never runs the SQL against Postgres. A subtle schema
// drift (column rename, table rename, type mismatch) or a regressed
// `NOT EXISTS` predicate would still pass that suite while silently
// leaving every orphan in place in production. This test seeds real
// rows in the test database, rips out a parent bid + project via raw
// SQL (bypassing the per-delete `pruneTakeoffRecentsForEntity` hook
// added in Task #2105), runs the sweep, and asserts the orphan rows
// are gone, the live rows are untouched, and the per-kind counts the
// cron wrapper logs come from real `.returning()` payloads.
//
// EXECUTION ISOLATION: this file is named `*.serial.test.ts` and is
// excluded from the default `npm test` parallel run by vitest.config.ts.
// The sweep reaches across users/orgs (no userId / organizationId
// filter — that's the whole point of Task #2129), so running it
// alongside other tests that happen to seed `takeoff_recents` rows
// pointing at non-existent bids / projects (e.g. fixture-built rows
// that are torn down out of order) would have it delete those rows
// out from under the parallel worker. Run it explicitly with file
// parallelism disabled:
//
//   RUN_SERIAL_DB_TESTS=1 npx vitest run \
//     server/__tests__/takeoff-recents-orphan-prune.serial.test.ts \
//     --no-file-parallelism

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  bids,
  takeoffRecents,
} from "@shared/schema";
import { pruneOrphanedTakeoffRecents } from "../takeoffRecentsCleanup";

const PREFIX = "__torphan__";

let orgId: string;
let userId: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;
  // takeoff_recents has FKs to users + organizations (cascade), but
  // explicit cleanup keeps the order obvious and survives any future
  // FK changes.
  await db
    .delete(takeoffRecents)
    .where(inArray(takeoffRecents.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(projects)
    .where(inArray(projects.gcOrganizationId, orgIds))
    .catch(() => {});
  await db
    .delete(bids)
    .where(inArray(bids.gcOrganizationId, orgIds))
    .catch(() => {});
  await db
    .delete(users)
    .where(inArray(users.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(organizations)
    .where(inArray(organizations.id, orgIds))
    .catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Takeoff Orphan Prune Org",
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      firstName: "Takeoff",
      lastName: "Orphan",
      role: "ADMIN",
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(async () => {
  // Each test re-seeds bids / projects / takeoff_recents so the
  // raw-SQL parent deletes below don't bleed across test cases.
  await db
    .delete(takeoffRecents)
    .where(inArray(takeoffRecents.organizationId, [orgId]));
  await db.delete(projects).where(inArray(projects.gcOrganizationId, [orgId]));
  await db.delete(bids).where(inArray(bids.gcOrganizationId, [orgId]));
});

interface SeededFixtures {
  bidLiveId: string;
  bidDeadId: string;
  projectLiveId: string;
  projectDeadId: string;
  recentBidLiveId: string;
  recentBidDeadId: string;
  recentProjectLiveId: string;
  recentProjectDeadId: string;
}

async function seedFixtures(suffix: string): Promise<SeededFixtures> {
  const [bidLive, bidDead] = await db
    .insert(bids)
    .values([
      {
        name: `Bid Live ${suffix}`,
        code: `${PREFIX}bid-live-${suffix}`,
        clientName: "ACME",
        gcOrganizationId: orgId,
        status: "ACTIVE",
      },
      {
        name: `Bid Dead ${suffix}`,
        code: `${PREFIX}bid-dead-${suffix}`,
        clientName: "ACME",
        gcOrganizationId: orgId,
        status: "ACTIVE",
      },
    ])
    .returning();

  const [projectLive, projectDead] = await db
    .insert(projects)
    .values([
      {
        name: `Project Live ${suffix}`,
        code: `${PREFIX}proj-live-${suffix}`,
        clientName: "ACME",
        gcOrganizationId: orgId,
        status: "PLANNING",
      },
      {
        name: `Project Dead ${suffix}`,
        code: `${PREFIX}proj-dead-${suffix}`,
        clientName: "ACME",
        gcOrganizationId: orgId,
        status: "PLANNING",
      },
    ])
    .returning();

  const recents = await db
    .insert(takeoffRecents)
    .values([
      {
        userId,
        organizationId: orgId,
        kind: "bid",
        entityId: bidLive.id,
        entityCode: bidLive.code,
        entityName: bidLive.name,
      },
      {
        userId,
        organizationId: orgId,
        kind: "bid",
        entityId: bidDead.id,
        entityCode: bidDead.code,
        entityName: bidDead.name,
      },
      {
        userId,
        organizationId: orgId,
        kind: "project",
        entityId: projectLive.id,
        entityCode: projectLive.code,
        entityName: projectLive.name,
      },
      {
        userId,
        organizationId: orgId,
        kind: "project",
        entityId: projectDead.id,
        entityCode: projectDead.code,
        entityName: projectDead.name,
      },
    ])
    .returning();

  const recentBidLive = recents.find((r) => r.entityId === bidLive.id)!;
  const recentBidDead = recents.find((r) => r.entityId === bidDead.id)!;
  const recentProjectLive = recents.find((r) => r.entityId === projectLive.id)!;
  const recentProjectDead = recents.find((r) => r.entityId === projectDead.id)!;

  return {
    bidLiveId: bidLive.id,
    bidDeadId: bidDead.id,
    projectLiveId: projectLive.id,
    projectDeadId: projectDead.id,
    recentBidLiveId: recentBidLive.id,
    recentBidDeadId: recentBidDead.id,
    recentProjectLiveId: recentProjectLive.id,
    recentProjectDeadId: recentProjectDead.id,
  };
}

async function loadRecentIds(orgIdLocal: string): Promise<Set<string>> {
  const rows = (await db.execute(
    sql`SELECT id FROM takeoff_recents WHERE organization_id = ${orgIdLocal}`,
  )) as unknown as { rows?: { id: string }[] };
  return new Set((rows.rows ?? []).map((r) => r.id));
}

describe("pruneOrphanedTakeoffRecents — integration (Task #2157)", () => {
  it("removes the orphaned bid + project rows and leaves the live ones untouched", async () => {
    const fx = await seedFixtures("a");

    // Direct SQL DELETE of one bid + one project — this is the path
    // that bypasses the per-delete `pruneTakeoffRecentsForEntity` hook
    // (the hook only fires from the bid / project DELETE Express
    // handlers in `bidRoutes2.ts` / `projectCrudRoutes.ts`). After
    // these run, two rows in `takeoff_recents` are orphans and exactly
    // the kind of garbage Task #2129 was written to reclaim.
    await db.execute(sql`DELETE FROM bids WHERE id = ${fx.bidDeadId}`);
    await db.execute(
      sql`DELETE FROM projects WHERE id = ${fx.projectDeadId}`,
    );

    // Sanity: all four takeoff_recents rows still exist before the
    // sweep — otherwise something in the schema (e.g. a new FK with
    // ON DELETE CASCADE) would have already done the job for us and
    // the test wouldn't actually be exercising the prune helper.
    const before = await loadRecentIds(orgId);
    expect(before.size).toBe(4);
    expect(before.has(fx.recentBidLiveId)).toBe(true);
    expect(before.has(fx.recentBidDeadId)).toBe(true);
    expect(before.has(fx.recentProjectLiveId)).toBe(true);
    expect(before.has(fx.recentProjectDeadId)).toBe(true);

    const result = await pruneOrphanedTakeoffRecents();

    // Per-kind + total counts mirror what the cron wrapper logs.
    expect(result.bidRowsPruned).toBe(1);
    expect(result.projectRowsPruned).toBe(1);
    expect(result.totalPruned).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const after = await loadRecentIds(orgId);
    expect(after.size).toBe(2);
    // Orphans are gone…
    expect(after.has(fx.recentBidDeadId)).toBe(false);
    expect(after.has(fx.recentProjectDeadId)).toBe(false);
    // …live rows are untouched. A regressed `NOT EXISTS` predicate
    // (e.g. one that subqueried the wrong parent table) would either
    // delete these too or leave the orphans in place.
    expect(after.has(fx.recentBidLiveId)).toBe(true);
    expect(after.has(fx.recentProjectLiveId)).toBe(true);
  }, 60_000);

  it("is a no-op when every takeoff_recents row still has a live parent", async () => {
    const fx = await seedFixtures("b");

    const result = await pruneOrphanedTakeoffRecents();

    expect(result.bidRowsPruned).toBe(0);
    expect(result.projectRowsPruned).toBe(0);
    expect(result.totalPruned).toBe(0);

    const after = await loadRecentIds(orgId);
    expect(after.size).toBe(4);
    expect(after.has(fx.recentBidLiveId)).toBe(true);
    expect(after.has(fx.recentBidDeadId)).toBe(true);
    expect(after.has(fx.recentProjectLiveId)).toBe(true);
    expect(after.has(fx.recentProjectDeadId)).toBe(true);
  }, 60_000);

  it("does not mistakenly delete a bid-kind row when a project with the same id (or vice versa) is gone", async () => {
    // Cross-kind safety: the two `NOT EXISTS` subqueries are scoped
    // by `kind` and to the right parent table. A regression that
    // dropped the `kind` filter — or pointed both passes at the same
    // table — would surface here as the surviving entity's recent
    // entry being collateral damage.
    const fx = await seedFixtures("c");

    // Yank only the bid; leave the project alive.
    await db.execute(sql`DELETE FROM bids WHERE id = ${fx.bidDeadId}`);

    const result = await pruneOrphanedTakeoffRecents();
    expect(result.bidRowsPruned).toBe(1);
    expect(result.projectRowsPruned).toBe(0);
    expect(result.totalPruned).toBe(1);

    const after = await loadRecentIds(orgId);
    // Both project recents survive — the project pass must not have
    // touched them just because a bid disappeared.
    expect(after.has(fx.recentProjectLiveId)).toBe(true);
    expect(after.has(fx.recentProjectDeadId)).toBe(true);
    expect(after.has(fx.recentBidLiveId)).toBe(true);
    expect(after.has(fx.recentBidDeadId)).toBe(false);
  }, 60_000);
});
