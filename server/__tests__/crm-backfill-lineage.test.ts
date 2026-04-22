/**
 * Task #1016 — automated coverage for the recursive-CTE retry-chain lineage
 * helper added in Task #1004 (`getCrmTranscriptBackfillLineages` in
 * `server/storage.ts`).
 *
 * The production code uses one recursive CTE per page render to (a) climb
 * each visible job up to its root and (b) descend back down through every
 * retry, so each history row can show its full retry chain inline without
 * N+1 queries against `parent_job_id`. This file pins the contract:
 *
 *   1. Standalone runs (no parent, no children) return a one-entry lineage.
 *   2. A parent + single retry returns both rows in chronological order.
 *   3. Multi-level chains (parent → retry-1 → retry-2 → retry-3) climb all
 *      the way up from a deep descendant and descend all the way down from
 *      the root.
 *   4. Sibling retries from one parent (parent → {retry-A, retry-B}) all
 *      share the same root and surface together in startedAt order.
 *   5. Cross-tenant isolation: passing a job id that belongs to another
 *      organisation never leaks that org's rows, even when both orgs share
 *      identical chain shapes.
 *
 * Also asserts the `jobToRoot` map points every emitted row at the correct
 * root so the route handler in `crmCallsRoutes.ts` can fan one lineage out
 * to every page row that belongs to it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillJobs,
} from "@shared/schema";
import { getCrmTranscriptBackfillLineages } from "../storage";

const TEST_PREFIX = "__crm_backfill_lineage_test__";

async function cleanupTestData() {
  await db.delete(crmTranscriptBackfillJobs).where(
    sql`${crmTranscriptBackfillJobs.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db
    .delete(organizations)
    .where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
}

async function makeOrg(label: string): Promise<{ orgId: string; userId: string }> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}${label}`, slug })
    .returning();
  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_PREFIX}${label}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}@test.invalid`,
      passwordHash: "x",
      firstName: "Test",
      lastName: "Admin",
      organizationId: org.id,
      role: "ADMIN",
    })
    .returning();
  return { orgId: org.id, userId: u.id };
}

let stepCounter = 0;
function nextStartedAt(base: number): Date {
  // Force monotonically increasing timestamps so the ASC ordering inside the
  // CTE is unambiguous regardless of insert speed.
  stepCounter += 1;
  return new Date(base + stepCounter * 1000);
}

async function makeJob(opts: {
  orgId: string;
  userId: string;
  id: string;
  parentJobId?: string | null;
  status?: string;
  startedAt: Date;
  completedAt?: Date | null;
}): Promise<void> {
  await db.insert(crmTranscriptBackfillJobs).values({
    id: opts.id,
    organizationId: opts.orgId,
    status: opts.status ?? "COMPLETED",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    failedRecordingIds: [],
    startedById: opts.userId,
    parentJobId: opts.parentJobId ?? null,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt ?? null,
  });
}

beforeAll(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
});

beforeEach(async () => {
  await cleanupTestData();
  stepCounter = 0;
});

describe("getCrmTranscriptBackfillLineages — retry chain coverage", () => {
  it("returns no rows when called with an empty job id list", async () => {
    const { orgId } = await makeOrg("empty");
    const { jobToRoot, lineagesByRoot } =
      await getCrmTranscriptBackfillLineages(orgId, []);
    expect(jobToRoot.size).toBe(0);
    expect(lineagesByRoot.size).toBe(0);
  });

  it("returns a single-entry lineage for a standalone run", async () => {
    const { orgId, userId } = await makeOrg("standalone");
    const base = Date.now();
    await makeJob({
      orgId,
      userId,
      id: "solo-1",
      startedAt: nextStartedAt(base),
    });

    const { jobToRoot, lineagesByRoot } =
      await getCrmTranscriptBackfillLineages(orgId, ["solo-1"]);

    expect(jobToRoot.get("solo-1")).toBe("solo-1");
    expect(lineagesByRoot.size).toBe(1);
    const lineage = lineagesByRoot.get("solo-1");
    expect(lineage).toBeDefined();
    expect(lineage).toHaveLength(1);
    expect(lineage![0]).toMatchObject({
      id: "solo-1",
      parentJobId: null,
      status: "COMPLETED",
    });
    expect(lineage![0].startedAt).toBeInstanceOf(Date);
  });

  it("returns parent + single retry in chronological order from either id", async () => {
    const { orgId, userId } = await makeOrg("pair");
    const base = Date.now();
    await makeJob({ orgId, userId, id: "pair-parent", startedAt: nextStartedAt(base) });
    await makeJob({
      orgId,
      userId,
      id: "pair-retry",
      parentJobId: "pair-parent",
      startedAt: nextStartedAt(base),
      status: "FAILED",
    });

    // Climbing from the child should still yield the parent + child chain.
    const fromChild = await getCrmTranscriptBackfillLineages(orgId, ["pair-retry"]);
    expect(fromChild.jobToRoot.get("pair-parent")).toBe("pair-parent");
    expect(fromChild.jobToRoot.get("pair-retry")).toBe("pair-parent");
    const childLineage = fromChild.lineagesByRoot.get("pair-parent")!;
    expect(childLineage.map((e) => e.id)).toEqual(["pair-parent", "pair-retry"]);
    expect(childLineage[0].parentJobId).toBeNull();
    expect(childLineage[1].parentJobId).toBe("pair-parent");

    // Descending from the parent should yield the same chain — no duplicates,
    // no missing rows.
    const fromParent = await getCrmTranscriptBackfillLineages(orgId, ["pair-parent"]);
    expect(fromParent.lineagesByRoot.get("pair-parent")!.map((e) => e.id)).toEqual([
      "pair-parent",
      "pair-retry",
    ]);

    // Passing both ids must not double-emit rows in the lineage either —
    // the recursive CTE de-duplicates via UNION (not UNION ALL).
    const fromBoth = await getCrmTranscriptBackfillLineages(orgId, [
      "pair-parent",
      "pair-retry",
    ]);
    expect(fromBoth.lineagesByRoot.size).toBe(1);
    expect(
      fromBoth.lineagesByRoot.get("pair-parent")!.map((e) => e.id),
    ).toEqual(["pair-parent", "pair-retry"]);
  });

  it("walks a multi-level chain from any depth", async () => {
    const { orgId, userId } = await makeOrg("chain");
    const base = Date.now();
    await makeJob({ orgId, userId, id: "lvl-0", startedAt: nextStartedAt(base) });
    await makeJob({
      orgId,
      userId,
      id: "lvl-1",
      parentJobId: "lvl-0",
      startedAt: nextStartedAt(base),
    });
    await makeJob({
      orgId,
      userId,
      id: "lvl-2",
      parentJobId: "lvl-1",
      startedAt: nextStartedAt(base),
    });
    await makeJob({
      orgId,
      userId,
      id: "lvl-3",
      parentJobId: "lvl-2",
      startedAt: nextStartedAt(base),
      status: "RUNNING",
    });

    // Climb from the deepest descendant.
    const { jobToRoot, lineagesByRoot } =
      await getCrmTranscriptBackfillLineages(orgId, ["lvl-3"]);

    expect(lineagesByRoot.size).toBe(1);
    const lineage = lineagesByRoot.get("lvl-0")!;
    expect(lineage.map((e) => e.id)).toEqual(["lvl-0", "lvl-1", "lvl-2", "lvl-3"]);
    // Every emitted row must point at the same root.
    for (const id of ["lvl-0", "lvl-1", "lvl-2", "lvl-3"]) {
      expect(jobToRoot.get(id)).toBe("lvl-0");
    }
    // Strict chronological ordering — the route relies on this for the
    // "original / retry 1 / retry 2 / retry 3" chip labels.
    for (let i = 1; i < lineage.length; i++) {
      expect(lineage[i].startedAt.getTime()).toBeGreaterThan(
        lineage[i - 1].startedAt.getTime(),
      );
    }
  });

  it("groups sibling retries from one parent into the same lineage", async () => {
    const { orgId, userId } = await makeOrg("siblings");
    const base = Date.now();
    await makeJob({ orgId, userId, id: "sib-parent", startedAt: nextStartedAt(base) });
    // Two independent retries, both pointing at the same parent.
    await makeJob({
      orgId,
      userId,
      id: "sib-retry-A",
      parentJobId: "sib-parent",
      startedAt: nextStartedAt(base),
    });
    await makeJob({
      orgId,
      userId,
      id: "sib-retry-B",
      parentJobId: "sib-parent",
      startedAt: nextStartedAt(base),
    });

    const { jobToRoot, lineagesByRoot } =
      await getCrmTranscriptBackfillLineages(orgId, ["sib-retry-B"]);

    expect(lineagesByRoot.size).toBe(1);
    const lineage = lineagesByRoot.get("sib-parent")!;
    // Parent first, then A (older sibling), then B — startedAt ASC.
    expect(lineage.map((e) => e.id)).toEqual([
      "sib-parent",
      "sib-retry-A",
      "sib-retry-B",
    ]);
    expect(jobToRoot.get("sib-parent")).toBe("sib-parent");
    expect(jobToRoot.get("sib-retry-A")).toBe("sib-parent");
    expect(jobToRoot.get("sib-retry-B")).toBe("sib-parent");
    // Both siblings list the same parent.
    const byId = new Map(lineage.map((e) => [e.id, e] as const));
    expect(byId.get("sib-retry-A")!.parentJobId).toBe("sib-parent");
    expect(byId.get("sib-retry-B")!.parentJobId).toBe("sib-parent");
  });

  it("never leaks lineage rows across organisations", async () => {
    // Two orgs with identically-shaped chains. We then ask for each org's
    // chain while passing the *other* org's id, and expect no leakage in
    // either direction.
    const orgA = await makeOrg("tenantA");
    const orgB = await makeOrg("tenantB");
    const base = Date.now();

    // Org A: parent → retry
    await makeJob({
      orgId: orgA.orgId,
      userId: orgA.userId,
      id: "A-parent",
      startedAt: nextStartedAt(base),
    });
    await makeJob({
      orgId: orgA.orgId,
      userId: orgA.userId,
      id: "A-retry",
      parentJobId: "A-parent",
      startedAt: nextStartedAt(base),
    });

    // Org B: parent → retry, with the *same parent id pattern* so a buggy
    // CTE that ignored organization_id would happily traverse across orgs.
    await makeJob({
      orgId: orgB.orgId,
      userId: orgB.userId,
      id: "B-parent",
      startedAt: nextStartedAt(base),
    });
    await makeJob({
      orgId: orgB.orgId,
      userId: orgB.userId,
      id: "B-retry",
      parentJobId: "B-parent",
      startedAt: nextStartedAt(base),
    });

    // Even sneakier: a row in org B that *claims* org A's parent as its
    // parent. The CTE must refuse to splice it into A's lineage because
    // its organization_id doesn't match.
    await makeJob({
      orgId: orgB.orgId,
      userId: orgB.userId,
      id: "B-impostor-of-A",
      parentJobId: "A-parent",
      startedAt: nextStartedAt(base),
    });

    // Asking org A about its own retry must NOT include any B-* rows.
    const aResult = await getCrmTranscriptBackfillLineages(orgA.orgId, ["A-retry"]);
    expect(aResult.lineagesByRoot.size).toBe(1);
    const aLineage = aResult.lineagesByRoot.get("A-parent")!;
    expect(aLineage.map((e) => e.id)).toEqual(["A-parent", "A-retry"]);
    for (const id of aLineage.map((e) => e.id)) {
      expect(id.startsWith("B-")).toBe(false);
    }
    expect(aResult.jobToRoot.has("B-impostor-of-A")).toBe(false);
    expect(aResult.jobToRoot.has("B-retry")).toBe(false);

    // Asking org A for an id that belongs to org B must return nothing —
    // the seed clause is filtered by org, so the climb never starts.
    const aAskingB = await getCrmTranscriptBackfillLineages(orgA.orgId, ["B-retry"]);
    expect(aAskingB.jobToRoot.size).toBe(0);
    expect(aAskingB.lineagesByRoot.size).toBe(0);

    // Symmetric check for org B — its real parent → retry chain still
    // surfaces normally.
    const bResult = await getCrmTranscriptBackfillLineages(orgB.orgId, [
      "B-retry",
      "B-impostor-of-A",
    ]);
    const bLineage = bResult.lineagesByRoot.get("B-parent")!;
    expect(bLineage.map((e) => e.id)).toEqual(["B-parent", "B-retry"]);

    // The impostor row's `parent_job_id` points at org A's parent, which is
    // invisible to org B. The recursive CTE climbs to that parent, finds
    // nothing matching org B, never reaches a NULL-parent root, and so
    // returns no rows for the impostor at all. The route handler then
    // falls back to `row.id` as its own root and renders the row with an
    // empty lineage (no chips). Pinning the behavior here so a future
    // change that started leaking cross-tenant ancestors would fail
    // loudly.
    expect(bResult.jobToRoot.has("B-impostor-of-A")).toBe(false);
    expect(bResult.lineagesByRoot.has("B-impostor-of-A")).toBe(false);
    for (const id of bResult.jobToRoot.keys()) {
      expect(id.startsWith("A-")).toBe(false);
    }
  });
});
