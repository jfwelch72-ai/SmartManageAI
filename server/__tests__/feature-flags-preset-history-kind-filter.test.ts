/**
 * Task #1338 — backend coverage for the Preset history `kind` query param.
 *
 * Task #1338 added a server-side `kind` filter to
 *   GET /api/feature-flags/:orgId/preset-history
 * and a segmented filter to the Preset history card UI. Without automated
 * coverage a future refactor of listPresetApplications could silently break
 * the filter — the UI would still render rows, but the totals/pagination
 * contract would no longer match the items returned.
 *
 * This suite seeds an isolated org with a known mix of `kind=apply` and
 * `kind=reset_drift` audit rows (with deterministic appliedAt timestamps so
 * ordering is stable) and asserts that:
 *
 *   1. The unfiltered call returns every row, with `total` matching `items`.
 *   2. `?kind=apply` returns only apply rows, and `total` reflects the
 *      filtered count (not the full audit table) so the page-count arithmetic
 *      driving the Preset history pager stays correct.
 *   3. `?kind=reset_drift` returns only reset_drift rows with the same
 *      narrowed total.
 *   4. Filtered pagination produces the right page count: with 3 apply rows
 *      and pageSize=2, page 1 returns 2 items and page 2 returns 1, both
 *      reporting total=3. (Math.ceil(total / pageSize) = 2 pages.)
 *   5. An invalid `kind` value (e.g. `?kind=banana`) falls through to the
 *      unfiltered behavior and does NOT 500 — protecting the route from a
 *      stale UI sending an unknown segment value.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  featureFlagPresetApplications,
} from "@shared/schema";
import { ensureFeatureFlagPresetApplicationsTable } from "../utils/ensureFeatureFlagPresetApplicationsTable";

const TEST_PREFIX = "__ff_kind_filter_test__";
const TRADE = "ROADWAY_CONSTRUCTION" as const;

let app: Express;
let server: Server;
let originalNodeEnv: string | undefined;
let orgId: string;
let userId: string;
let saCookie: string;

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
    .delete(users)
    .where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
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

  // Seed an isolated org + attribution user.
  const slug = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}org`, slug, tradeType: TRADE })
    .returning();
  orgId = org.id;

  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_PREFIX}${Date.now()}@example.test`,
      passwordHash: "x",
      firstName: "Kind",
      lastName: "Filter",
      role: "ADMIN",
      organizationId: orgId,
    } as typeof users.$inferInsert)
    .returning();
  userId = u.id;

  // Seed 3 apply + 2 reset_drift rows with deterministic timestamps so
  // ordering (newest-first) is predictable. Spread by 1 minute so we don't
  // tie on appliedAt.
  const base = new Date("2024-01-01T00:00:00Z").getTime();
  const rows: Array<{
    appliedAt: Date;
    kind: "apply" | "reset_drift";
    flagKeys: string[] | null;
  }> = [
    { appliedAt: new Date(base + 0 * 60_000), kind: "apply", flagKeys: null },
    { appliedAt: new Date(base + 1 * 60_000), kind: "apply", flagKeys: null },
    {
      appliedAt: new Date(base + 2 * 60_000),
      kind: "reset_drift",
      flagKeys: ["HEAVY_CIVIL_PRESET"],
    },
    { appliedAt: new Date(base + 3 * 60_000), kind: "apply", flagKeys: null },
    {
      appliedAt: new Date(base + 4 * 60_000),
      kind: "reset_drift",
      flagKeys: ["HEAVY_CIVIL_PRESET", "DOT_INTEGRATIONS"],
    },
  ];
  for (const r of rows) {
    await db.insert(featureFlagPresetApplications).values({
      organizationId: orgId,
      tradeType: TRADE,
      appliedById: userId,
      kind: r.kind,
      flagKeys: r.flagKeys,
      appliedAt: r.appliedAt,
    } as typeof featureFlagPresetApplications.$inferInsert);
  }

  // SUPER_ADMIN can read any org's preset-history; using the dev test-login
  // mirrors the existing companion suite (Task #1314).
  const sa = await request(app).post("/api/dev/test-login").send({ role: "SUPER_ADMIN" });
  expect(sa.status, `dev test-login failed: ${sa.text}`).toBe(200);
  const cookie = extractCookie(sa);
  expect(cookie).toBeTruthy();
  saCookie = cookie!;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}, 30_000);

type HistoryResponse = {
  items: Array<{ id: string; kind: "apply" | "reset_drift"; flagKeys: string[] | null }>;
  total: number;
  page: number;
  pageSize: number;
};

async function getHistory(query: string): Promise<HistoryResponse> {
  const res = await request(app)
    .get(`/api/feature-flags/${orgId}/preset-history${query}`)
    .set("Cookie", saCookie);
  expect(res.status, `preset-history ${query} failed: ${res.text}`).toBe(200);
  return res.body as HistoryResponse;
}

describe("preset-history kind filter (Task #1338)", () => {
  it("unfiltered returns every seeded row with total matching items", async () => {
    const body = await getHistory("?page=1&pageSize=20");
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(5);
    // Newest-first: the two reset_drift rows were the two most recent inserts.
    expect(body.items[0].kind).toBe("reset_drift");
    expect(body.items[1].kind).toBe("apply");
  });

  it("?kind=apply returns only apply rows with a narrowed total", async () => {
    const body = await getHistory("?page=1&pageSize=20&kind=apply");
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
    expect(body.items.every((i) => i.kind === "apply")).toBe(true);
  });

  it("?kind=reset_drift returns only reset_drift rows with a narrowed total", async () => {
    const body = await getHistory("?page=1&pageSize=20&kind=reset_drift");
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items.every((i) => i.kind === "reset_drift")).toBe(true);
    // flagKeys round-trips through the API.
    expect(body.items[0].flagKeys).toEqual(["HEAVY_CIVIL_PRESET", "DOT_INTEGRATIONS"]);
    expect(body.items[1].flagKeys).toEqual(["HEAVY_CIVIL_PRESET"]);
  });

  it("filtered pagination yields the correct page count (3 apply rows / pageSize=2 => 2 pages)", async () => {
    const page1 = await getHistory("?page=1&pageSize=2&kind=apply");
    expect(page1.total).toBe(3);
    expect(page1.pageSize).toBe(2);
    expect(page1.page).toBe(1);
    expect(page1.items).toHaveLength(2);
    expect(page1.items.every((i) => i.kind === "apply")).toBe(true);

    const page2 = await getHistory("?page=2&pageSize=2&kind=apply");
    expect(page2.total).toBe(3);
    expect(page2.pageSize).toBe(2);
    expect(page2.page).toBe(2);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].kind).toBe("apply");

    // No overlap between pages.
    const page1Ids = new Set(page1.items.map((i) => i.id));
    expect(page1Ids.has(page2.items[0].id)).toBe(false);

    // Pager arithmetic: Math.ceil(total / pageSize) === 2.
    expect(Math.ceil(page1.total / page1.pageSize)).toBe(2);
  });

  it("an invalid kind falls through to unfiltered behavior (no 500)", async () => {
    const body = await getHistory("?page=1&pageSize=20&kind=banana");
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(5);
    // Both kinds are still represented.
    const kinds = new Set(body.items.map((i) => i.kind));
    expect(kinds.has("apply")).toBe(true);
    expect(kinds.has("reset_drift")).toBe(true);
  });
});
