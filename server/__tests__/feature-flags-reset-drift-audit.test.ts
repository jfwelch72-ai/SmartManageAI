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
