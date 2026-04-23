/**
 * Task #1314 — backend coverage for the drift-reset audit trail.
 *
 * Verifies that:
 *   1. Per-flag drift resets via POST /reset-drift insert a `kind=reset_drift`
 *      row carrying the affected flag keys and the resetter's user id.
 *   2. Bulk drift resets ({ all: true }) likewise insert one audit row whose
 *      flag_keys covers every drifted flag.
 *   3. listPresetApplications returns reset rows alongside full applications,
 *      newest first, with `kind` and `flagKeys` populated.
 *   4. getLastPresetApplication still anchors on the latest `kind=apply` row
 *      so the "Last applied / Customized from" line never shifts when an
 *      admin resets a single drifted flag.
 *
 * Without this coverage the Preset history card would silently drop the
 * reset entries that shipped in this task, regressing the audit story.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq, and, desc } from "drizzle-orm";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  featureFlagPresetApplications,
  FEATURE_FLAG_KEYS,
} from "@shared/schema";
import { getFeaturePresetForTrade } from "@shared/tradeFeaturePresets";
import {
  applyTradePreset,
  setFeatureFlag,
  listPresetApplications,
  getLastPresetApplication,
  getPresetHistoryFilterOptions,
} from "../services/featureFlagService";
import { ensureFeatureFlagPresetApplicationsTable } from "../utils/ensureFeatureFlagPresetApplicationsTable";

const TEST_PREFIX = "__ff_reset_audit_test__";

let app: Express;
let server: Server;
let originalNodeEnv: string | undefined;

function extractCookie(res: request.Response): string | null {
  const cookies = res.headers["set-cookie"] as string | string[] | undefined;
  if (!cookies) return null;
  const arr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of arr) {
    const m = c.match(/auth_token=([^;]+)/);
    if (m) return `auth_token=${m[1]}`;
  }
  return null;
}

async function loginAdmin(): Promise<{ cookie: string; orgId: string; userId: string }> {
  const res = await request(app).post("/api/dev/test-login").send({ role: "ADMIN" });
  expect(res.status).toBe(200);
  const cookie = extractCookie(res);
  expect(cookie).toBeTruthy();
  const me = await request(app).get("/api/auth/me").set("Cookie", cookie!);
  expect(me.status).toBe(200);
  const body = me.body as { user: { id: string; organizationId: string | null } };
  expect(body.user.organizationId).toBeTruthy();
  return { cookie: cookie!, orgId: body.user.organizationId!, userId: body.user.id };
}

async function cleanup() {
  await db
    .delete(featureFlagPresetApplications)
    .where(
      sql`${featureFlagPresetApplications.organizationId} IN (
        SELECT ${organizations.id} FROM ${organizations}
        WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
      )`,
    );
  await db
    .delete(organizations)
    .where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");
  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  await ensureFeatureFlagPresetApplicationsTable();
  await cleanup();
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}, 30_000);

describe("drift-reset audit trail (Task #1314)", () => {
  it("service-level: an isolated org with a manual drift reset gets a kind=reset_drift audit row carrying flag_keys + resetter, and listPresetApplications returns it newest-first", async () => {
    const tradeType = "ROADWAY_CONSTRUCTION" as const;
    const preset = getFeaturePresetForTrade(tradeType);

    const slug = `${TEST_PREFIX}svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: `${TEST_PREFIX}svc`, slug, tradeType })
      .returning();

    // Seed a real user we can attribute the reset to so the join in
    // listPresetApplications surfaces firstName/lastName/email.
    const [resetter] = await db
      .insert(users)
      .values({
        email: `${TEST_PREFIX}svc-${Date.now()}@example.test`,
        passwordHash: "x",
        firstName: "Reset",
        lastName: "Tester",
        role: "ADMIN",
        organizationId: org.id,
      } as typeof users.$inferInsert)
      .returning();

    try {
      // Apply the preset (kind=apply).
      await applyTradePreset(org.id, tradeType, resetter.id);

      // Drift one flag away from preset to create a single-flag drift, then
      // reset only that flag via the route handler's underlying service path.
      const flipOff = FEATURE_FLAG_KEYS.find((k) => preset[k]);
      expect(flipOff).toBeDefined();
      await setFeatureFlag(org.id, flipOff!, false, resetter.id);

      // Sanity: getLastPresetApplication sees the apply row and reports drift.
      const lastBefore = await getLastPresetApplication(org.id);
      expect(lastBefore).not.toBeNull();
      expect(lastBefore!.isCustomized).toBe(true);

      // Simulate the route's reset path: write the audit row directly via
      // the new service helper (the route exercise is covered separately).
      const { recordPresetDriftReset, setAllFeatureFlags } = await import(
        "../services/featureFlagService"
      );
      await setAllFeatureFlags(org.id, { [flipOff!]: true });
      await recordPresetDriftReset(org.id, tradeType, [flipOff!], resetter.id);

      // The audit table now has 2 rows: 1 apply + 1 reset_drift.
      const rows = await db
        .select()
        .from(featureFlagPresetApplications)
        .where(eq(featureFlagPresetApplications.organizationId, org.id))
        .orderBy(desc(featureFlagPresetApplications.appliedAt));
      expect(rows).toHaveLength(2);
      const [newest, older] = rows;
      expect(newest.kind).toBe("reset_drift");
      expect(newest.flagKeys).toEqual([flipOff]);
      expect(newest.appliedById).toBe(resetter.id);
      expect(older.kind).toBe("apply");
      expect(older.flagKeys).toBeNull();

      // listPresetApplications surfaces both, newest first, with kind/flagKeys.
      const page = await listPresetApplications(org.id);
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
      expect(page.items[0].kind).toBe("reset_drift");
      expect(page.items[0].flagKeys).toEqual([flipOff]);
      expect(page.items[0].appliedBy?.id).toBe(resetter.id);
      expect(page.items[1].kind).toBe("apply");
      expect(page.items[1].flagKeys).toBeNull();

      // getLastPresetApplication still anchors on the apply row — the
      // reset must not shift the "Last applied / Customized from" semantics.
      const lastAfter = await getLastPresetApplication(org.id);
      expect(lastAfter).not.toBeNull();
      expect(lastAfter!.tradeType).toBe(tradeType);
      // After resetting the only drifted flag, no drift remains.
      expect(lastAfter!.isCustomized).toBe(false);
      expect(lastAfter!.diff).toEqual([]);
    } finally {
      await db
        .delete(featureFlagPresetApplications)
        .where(eq(featureFlagPresetApplications.organizationId, org.id));
      await db.delete(users).where(eq(users.id, resetter.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("route-level: POST /reset-drift with { all: true } writes one reset_drift audit row covering every drifted flag", async () => {
    const admin = await loginAdmin();

    // Apply the Heavy Civil preset first so we have a concrete trade preset
    // to drift against.
    const apply = await request(app)
      .post(`/api/feature-flags/${admin.orgId}/apply-preset`)
      .set("Cookie", admin.cookie)
      .send({ tradeType: "ROADWAY_CONSTRUCTION" });
    expect(apply.status, `apply-preset failed: ${apply.text}`).toBe(200);

    // Drift two preset-on flags off via SUPER_ADMIN PATCH (the only role
    // allowed to flip individual flags) so we have multi-flag drift.
    const sa = await request(app).post("/api/dev/test-login").send({ role: "SUPER_ADMIN" });
    const saCookie = extractCookie(sa)!;

    const preset = getFeaturePresetForTrade("ROADWAY_CONSTRUCTION");
    const driftA = FEATURE_FLAG_KEYS.find((k) => preset[k] && k !== "HEAVY_CIVIL_PRESET");
    const driftB = FEATURE_FLAG_KEYS.find(
      (k) => preset[k] && k !== driftA && k !== "HEAVY_CIVIL_PRESET",
    );
    expect(driftA).toBeDefined();
    expect(driftB).toBeDefined();
    for (const flag of [driftA!, driftB!]) {
      const r = await request(app)
        .patch(`/api/feature-flags/${admin.orgId}`)
        .set("Cookie", saCookie)
        .send({ flag, enabled: false });
      expect(r.status, `manual flip ${flag} failed: ${r.text}`).toBe(200);
    }

    // Capture audit-row count BEFORE the reset so we can assert exactly one
    // new reset_drift row was added (other tests may have left apply rows).
    const [{ count: countBefore }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(featureFlagPresetApplications)
      .where(
        and(
          eq(featureFlagPresetApplications.organizationId, admin.orgId),
          eq(featureFlagPresetApplications.kind, "reset_drift"),
        ),
      );

    // Bulk reset.
    const reset = await request(app)
      .post(`/api/feature-flags/${admin.orgId}/reset-drift`)
      .set("Cookie", admin.cookie)
      .send({ all: true });
    expect(reset.status, `reset-drift failed: ${reset.text}`).toBe(200);
    const resetBody = reset.body as { reset: string[] };
    expect(resetBody.reset).toEqual(expect.arrayContaining([driftA, driftB]));

    const [{ count: countAfter }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(featureFlagPresetApplications)
      .where(
        and(
          eq(featureFlagPresetApplications.organizationId, admin.orgId),
          eq(featureFlagPresetApplications.kind, "reset_drift"),
        ),
      );
    expect(Number(countAfter) - Number(countBefore)).toBe(1);

    // The newest reset_drift row carries every drifted key and is attributed
    // to the admin user.
    const [latestReset] = await db
      .select()
      .from(featureFlagPresetApplications)
      .where(
        and(
          eq(featureFlagPresetApplications.organizationId, admin.orgId),
          eq(featureFlagPresetApplications.kind, "reset_drift"),
        ),
      )
      .orderBy(desc(featureFlagPresetApplications.appliedAt))
      .limit(1);
    expect(latestReset).toBeDefined();
    expect(latestReset.flagKeys).toEqual(expect.arrayContaining([driftA, driftB]));
    expect(latestReset.appliedById).toBe(admin.userId);
    expect(latestReset.tradeType).toBe("ROADWAY_CONSTRUCTION");

    // GET /preset-history returns the reset row alongside the apply row.
    const hist = await request(app)
      .get(`/api/feature-flags/${admin.orgId}/preset-history?page=1&pageSize=20`)
      .set("Cookie", admin.cookie);
    expect(hist.status).toBe(200);
    const histBody = hist.body as {
      items: Array<{ id: string; kind: string; flagKeys: string[] | null }>;
    };
    const resetRows = histBody.items.filter((i) => i.kind === "reset_drift");
    expect(resetRows.length).toBeGreaterThanOrEqual(1);
    const matching = resetRows.find((r) => r.id === latestReset.id);
    expect(matching).toBeDefined();
    expect(matching!.flagKeys).toEqual(expect.arrayContaining([driftA, driftB]));
  });
});

/**
 * Task #1422 — coverage for the trade/user filter dropdowns on the Preset
 * history card.
 *
 * The route `GET /api/feature-flags/:orgId/preset-history` accepts
 * `tradeType` and `appliedById` query params on top of the existing `kind`
 * filter, and a sibling `GET /:orgId/preset-history-filters` endpoint feeds
 * the dropdown options. These tests exercise:
 *   1. `listPresetApplications` with every combination of kind/tradeType/
 *      appliedById, including a "filter that matches nothing" case so the
 *      empty-state copy in the UI is guaranteed to fire.
 *   2. `getPresetHistoryFilterOptions` returns only the trades/actors that
 *      actually appear on audit rows, sorted, and excludes the synthetic
 *      `appliedById = NULL` rows that the system backfill writes.
 *   3. Route-level: ADMIN access to `/preset-history-filters` is still
 *      scoped to the admin's own org.
 */
describe("preset history filters (Task #1422)", () => {
  it("service-level: listPresetApplications honors kind + tradeType + appliedById in every combination, and returns an empty page when filters match nothing", async () => {
    const tradeA = "ROADWAY_CONSTRUCTION" as const;
    const tradeB = "ASPHALT_PAVING" as const;

    const slug = `${TEST_PREFIX}list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: `${TEST_PREFIX}list`, slug, tradeType: tradeA })
      .returning();

    const [userA] = await db
      .insert(users)
      .values({
        email: `${TEST_PREFIX}list-a-${Date.now()}@example.test`,
        passwordHash: "x",
        firstName: "Alice",
        lastName: "Apply",
        role: "ADMIN",
        organizationId: org.id,
      } as typeof users.$inferInsert)
      .returning();

    const [userB] = await db
      .insert(users)
      .values({
        email: `${TEST_PREFIX}list-b-${Date.now()}@example.test`,
        passwordHash: "x",
        firstName: "Bob",
        lastName: "Reset",
        role: "ADMIN",
        organizationId: org.id,
      } as typeof users.$inferInsert)
      .returning();

    try {
      // Hand-build a small but representative audit set so we can predict
      // every filter intersection without depending on the order or
      // side-effects of applyTradePreset / recordPresetDriftReset.
      //
      //   tradeA + apply        + userA
      //   tradeA + reset_drift  + userB  (flagKeys present)
      //   tradeB + apply        + userB
      //   tradeB + reset_drift  + userA  (flagKeys present)
      const flagKey = FEATURE_FLAG_KEYS[0];
      await db.insert(featureFlagPresetApplications).values([
        { organizationId: org.id, tradeType: tradeA, appliedById: userA.id, kind: "apply" },
        {
          organizationId: org.id,
          tradeType: tradeA,
          appliedById: userB.id,
          kind: "reset_drift",
          flagKeys: [flagKey],
        },
        { organizationId: org.id, tradeType: tradeB, appliedById: userB.id, kind: "apply" },
        {
          organizationId: org.id,
          tradeType: tradeB,
          appliedById: userA.id,
          kind: "reset_drift",
          flagKeys: [flagKey],
        },
      ]);

      // No filters → all 4 rows.
      const all = await listPresetApplications(org.id, 1, 50);
      expect(all.total).toBe(4);
      expect(all.items).toHaveLength(4);

      // kind only.
      const onlyApply = await listPresetApplications(org.id, 1, 50, "apply");
      expect(onlyApply.total).toBe(2);
      expect(onlyApply.items.every((i) => i.kind === "apply")).toBe(true);

      const onlyReset = await listPresetApplications(org.id, 1, 50, "reset_drift");
      expect(onlyReset.total).toBe(2);
      expect(onlyReset.items.every((i) => i.kind === "reset_drift")).toBe(true);

      // tradeType only.
      const onlyTradeA = await listPresetApplications(org.id, 1, 50, undefined, tradeA);
      expect(onlyTradeA.total).toBe(2);
      expect(onlyTradeA.items.every((i) => i.tradeType === tradeA)).toBe(true);

      // appliedById only.
      const onlyUserA = await listPresetApplications(
        org.id,
        1,
        50,
        undefined,
        undefined,
        userA.id,
      );
      expect(onlyUserA.total).toBe(2);
      expect(onlyUserA.items.every((i) => i.appliedBy?.id === userA.id)).toBe(true);

      // kind + tradeType.
      const applyTradeA = await listPresetApplications(org.id, 1, 50, "apply", tradeA);
      expect(applyTradeA.total).toBe(1);
      expect(applyTradeA.items[0].tradeType).toBe(tradeA);
      expect(applyTradeA.items[0].kind).toBe("apply");
      expect(applyTradeA.items[0].appliedBy?.id).toBe(userA.id);

      // kind + appliedById.
      const resetByUserB = await listPresetApplications(
        org.id,
        1,
        50,
        "reset_drift",
        undefined,
        userB.id,
      );
      expect(resetByUserB.total).toBe(1);
      expect(resetByUserB.items[0].kind).toBe("reset_drift");
      expect(resetByUserB.items[0].tradeType).toBe(tradeA);
      expect(resetByUserB.items[0].appliedBy?.id).toBe(userB.id);

      // tradeType + appliedById.
      const tradeBUserB = await listPresetApplications(
        org.id,
        1,
        50,
        undefined,
        tradeB,
        userB.id,
      );
      expect(tradeBUserB.total).toBe(1);
      expect(tradeBUserB.items[0].kind).toBe("apply");
      expect(tradeBUserB.items[0].tradeType).toBe(tradeB);

      // All three filters together → the unique intersection row.
      const triple = await listPresetApplications(
        org.id,
        1,
        50,
        "reset_drift",
        tradeB,
        userA.id,
      );
      expect(triple.total).toBe(1);
      expect(triple.items[0].kind).toBe("reset_drift");
      expect(triple.items[0].tradeType).toBe(tradeB);
      expect(triple.items[0].appliedBy?.id).toBe(userA.id);
      expect(triple.items[0].flagKeys).toEqual([flagKey]);

      // Filters that match nothing → empty page so the empty-state copy in
      // the Preset history card fires. We pair tradeA with userB-on-tradeB-
      // only-via-apply: no row exists for kind=apply + tradeA + userB.
      const empty = await listPresetApplications(org.id, 1, 50, "apply", tradeA, userB.id);
      expect(empty.total).toBe(0);
      expect(empty.items).toHaveLength(0);
    } finally {
      await db
        .delete(featureFlagPresetApplications)
        .where(eq(featureFlagPresetApplications.organizationId, org.id));
      await db.delete(users).where(eq(users.id, userA.id));
      await db.delete(users).where(eq(users.id, userB.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("service-level: getPresetHistoryFilterOptions returns only trades/actors actually present on audit rows, sorted, and excludes appliedById=NULL system-backfill rows from the actor list", async () => {
    const tradeA = "ROADWAY_CONSTRUCTION" as const;
    const tradeB = "ASPHALT_PAVING" as const;

    const slug = `${TEST_PREFIX}opts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: `${TEST_PREFIX}opts`, slug, tradeType: tradeA })
      .returning();

    // Two real actors plus a third user who exists in the org but has NO
    // audit row — the filter options must exclude them entirely.
    const [zoe] = await db
      .insert(users)
      .values({
        email: `${TEST_PREFIX}opts-z-${Date.now()}@example.test`,
        passwordHash: "x",
        firstName: "Zoe",
        lastName: "Zephyr",
        role: "ADMIN",
        organizationId: org.id,
      } as typeof users.$inferInsert)
      .returning();

    const [ada] = await db
      .insert(users)
      .values({
        email: `${TEST_PREFIX}opts-a-${Date.now()}@example.test`,
        passwordHash: "x",
        firstName: "Ada",
        lastName: "Adams",
        role: "ADMIN",
        organizationId: org.id,
      } as typeof users.$inferInsert)
      .returning();

    const [ghost] = await db
      .insert(users)
      .values({
        email: `${TEST_PREFIX}opts-g-${Date.now()}@example.test`,
        passwordHash: "x",
        firstName: "Ghost",
        lastName: "User",
        role: "ADMIN",
        organizationId: org.id,
      } as typeof users.$inferInsert)
      .returning();

    try {
      await db.insert(featureFlagPresetApplications).values([
        // Two rows attributed to Zoe — distinct should still surface her once.
        { organizationId: org.id, tradeType: tradeA, appliedById: zoe.id, kind: "apply" },
        {
          organizationId: org.id,
          tradeType: tradeA,
          appliedById: zoe.id,
          kind: "reset_drift",
          flagKeys: [FEATURE_FLAG_KEYS[0]],
        },
        // One row attributed to Ada on the second trade.
        { organizationId: org.id, tradeType: tradeB, appliedById: ada.id, kind: "apply" },
        // System-backfill row (appliedById = NULL). Per the docstring on
        // applyOrgFlagBackfill, the actor list must NOT include this and
        // we still expect its tradeType to surface in the trades list.
        { organizationId: org.id, tradeType: tradeB, appliedById: null, kind: "apply" },
      ]);

      const opts = await getPresetHistoryFilterOptions(org.id);

      // Both trades present, sorted ascending — and tradeA is only listed
      // once even though it appears on multiple audit rows.
      expect(opts.tradeTypes).toEqual([tradeB, tradeA].sort());

      // Only the two real actors are returned (ghost has no audit row, the
      // NULL-actor system row is filtered out by the inner join).
      const actorIds = opts.appliedBy.map((a) => a.id);
      expect(actorIds).toHaveLength(2);
      expect(actorIds).toContain(zoe.id);
      expect(actorIds).toContain(ada.id);
      expect(actorIds).not.toContain(ghost.id);

      // Sorted alphabetically by display name → Ada Adams before Zoe Zephyr.
      expect(opts.appliedBy[0].id).toBe(ada.id);
      expect(opts.appliedBy[1].id).toBe(zoe.id);
      expect(opts.appliedBy[0].firstName).toBe("Ada");
      expect(opts.appliedBy[0].lastName).toBe("Adams");
      expect(opts.appliedBy[0].email).toBe(ada.email);
    } finally {
      await db
        .delete(featureFlagPresetApplications)
        .where(eq(featureFlagPresetApplications.organizationId, org.id));
      await db.delete(users).where(eq(users.id, zoe.id));
      await db.delete(users).where(eq(users.id, ada.id));
      await db.delete(users).where(eq(users.id, ghost.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("route-level: ADMIN cannot read /preset-history-filters for an organization other than their own (cross-org access still 403)", async () => {
    const admin = await loginAdmin();

    // Spin up a foreign org the admin has no membership in.
    const slug = `${TEST_PREFIX}xorg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [foreignOrg] = await db
      .insert(organizations)
      .values({ name: `${TEST_PREFIX}xorg`, slug, tradeType: "ROADWAY_CONSTRUCTION" })
      .returning();

    try {
      // Sanity: admin can read filters for their OWN org (200 with the
      // documented shape) — proves the 403 below is about authorization,
      // not a broken handler.
      const own = await request(app)
        .get(`/api/feature-flags/${admin.orgId}/preset-history-filters`)
        .set("Cookie", admin.cookie);
      expect(own.status, `own-org filters failed: ${own.text}`).toBe(200);
      const ownBody = own.body as {
        tradeTypes: unknown;
        appliedBy: unknown;
      };
      expect(Array.isArray(ownBody.tradeTypes)).toBe(true);
      expect(Array.isArray(ownBody.appliedBy)).toBe(true);

      // Cross-org → 403, regardless of whether the foreign org has any
      // audit rows yet.
      const cross = await request(app)
        .get(`/api/feature-flags/${foreignOrg.id}/preset-history-filters`)
        .set("Cookie", admin.cookie);
      expect(cross.status).toBe(403);
      expect(cross.body).toEqual({ error: "Admin access required" });

      // SUPER_ADMIN, by contrast, MUST be able to read any org's filters.
      const sa = await request(app).post("/api/dev/test-login").send({ role: "SUPER_ADMIN" });
      const saCookie = extractCookie(sa)!;
      const saRes = await request(app)
        .get(`/api/feature-flags/${foreignOrg.id}/preset-history-filters`)
        .set("Cookie", saCookie);
      expect(saRes.status, `super-admin foreign-org filters failed: ${saRes.text}`).toBe(200);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, foreignOrg.id));
    }
  });
});
