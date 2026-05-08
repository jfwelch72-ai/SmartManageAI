/**
 * Task #1968 — Pin the `recordJobMetrics(...)` calls wired up around
 * the plan-document bulk markup endpoints in
 * `server/planDocumentMarkupRoutes.ts` so that a future refactor can't
 * silently drop the visibility we rely on.
 *
 * Two endpoints are covered, each with happy-path and failure-path
 * assertions:
 *
 *  - `PATCH /api/plan-documents/:docId/markups/bulk`
 *      counter: `plan_document_markups_bulk_move`
 *      success: `ok: 1`, `count == updates.length`, finite numeric `ms`
 *      failure: `error: 1`, finite numeric `ms`
 *
 *  - `DELETE /api/plan-documents/:docId/markups/bulk`
 *      counter: `plan_document_markups_bulk_delete`
 *      success: `ok: 1`, `count == ids.length`, finite numeric `ms`
 *      failure: `error: 1`, finite numeric `ms`
 *
 * Failure-path tests deliberately use a Zod-validation failure (the
 * only failure mode that lands in the route's `catch` block, which is
 * where the `error: 1` metric call lives). Other failures — 404 for a
 * missing doc, 400 for cross-doc, 403 for cross-tenant — short-circuit
 * with `res.status(...).json(...); return` BEFORE the metric call
 * fires, so they are NOT a useful proxy for "the error counter works".
 *
 * We snapshot the in-memory totals + sample count BEFORE firing each
 * request and assert the deltas, so this suite remains correct even
 * when other tests in the same process have already pushed samples
 * into the rolling window.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
} from "@shared/schema";
import { generateToken } from "../auth";
import { getJobMetrics } from "../utils/jobMetrics";

// Hardcoded counter names so a future rename of the metric in the
// route file fails this suite loudly rather than silently dropping
// the SRE-facing visibility.
const BULK_MOVE_METRIC = "plan_document_markups_bulk_move";
const BULK_DELETE_METRIC = "plan_document_markups_bulk_delete";

const TEST_PREFIX = "__plandoc_bulk_metrics__";

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
  layerId: string | null;
  groupId: string | null;
}

let app: Express;
let server: Server;
let adminToken: string;
let docId: string;

function apiPost(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).delete(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function cleanup(): Promise<void> {
  const orgs = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgs.rows;
  for (const { id: orgId } of rows) {
    const projSub = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const docSub = sql`(SELECT id FROM plan_documents WHERE project_id IN ${projSub})`;
    await db.execute(sql`DELETE FROM plan_document_markups WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_pins WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_markup_layer_visibility WHERE layer_id IN (SELECT id FROM plan_markup_layers WHERE plan_document_id IN ${docSub})`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_markup_layers WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN ${projSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const slug = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: "PD Bulk Metrics Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "PD",
    lastName: "Metrics",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [project] = await db.insert(projects).values({
    code: `${slug}-PRJ`,
    name: "PD Bulk Metrics Project",
    clientName: "PD Bulk Metrics Client",
    gcOrganizationId: org.id,
  }).returning();

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: "Doc",
    fileName: "bulk-metrics.pdf",
    fileUrl: "https://example.com/bulk-metrics.pdf",
    uploadedById: admin.id,
  }).returning();
  docId = doc.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function seedMarkups(count: number, page = 11): Promise<MarkupResponse[]> {
  const out: MarkupResponse[] = [];
  for (let i = 0; i < count; i++) {
    const res = await apiPost(
      `/api/plan-documents/${docId}/markups`,
      adminToken,
      {
        pageNumber: page,
        tool: "RECTANGLE",
        points: [
          { x: 0.1 + i * 0.01, y: 0.1 + i * 0.01 },
          { x: 0.5 + i * 0.01, y: 0.5 + i * 0.01 },
        ],
        color: "#0ea5e9",
        thickness: 3,
      },
    );
    expect(res.status).toBe(201);
    out.push(res.body as MarkupResponse);
  }
  return out;
}

describe("plan_document_markups bulk endpoints — job metrics (Task #1968)", () => {
  describe(`PATCH /api/plan-documents/:docId/markups/bulk → ${BULK_MOVE_METRIC}`, () => {
    it("records a sample with ok:1, count==batch size, and a numeric ms on success", async () => {
      const markups = await seedMarkups(3);
      const updates = markups.map((m) => ({
        id: m.id,
        points: m.points.map((p) => ({ x: p.x + 0.01, y: p.y + 0.02 })),
      }));

      const okBefore = getJobMetrics(BULK_MOVE_METRIC).totals.ok ?? 0;
      const errBefore = getJobMetrics(BULK_MOVE_METRIC).totals.error ?? 0;
      const samplesBefore = getJobMetrics(BULK_MOVE_METRIC).samples.length;

      const res = await apiPatch(
        `/api/plan-documents/${docId}/markups/bulk`,
        adminToken,
        { updates },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, count: updates.length });

      const after = getJobMetrics(BULK_MOVE_METRIC);
      // Exactly one new sample for this request — the route records
      // once per call, not once per update inside the batch.
      expect(after.samples.length).toBe(samplesBefore + 1);
      // Success path bumps `ok` by 1 and never bumps `error`.
      expect(after.totals.ok ?? 0).toBe(okBefore + 1);
      expect(after.totals.error ?? 0).toBe(errBefore);

      const latest = after.latest!;
      expect(latest).toBeTruthy();
      expect(latest.counters.ok).toBe(1);
      expect(latest.counters.error ?? 0).toBe(0);
      // `count` mirrors `body.updates.length` — the dimension SREs use
      // to spot tenants pushing huge group-drag gestures.
      expect(latest.counters.count).toBe(updates.length);
      // `ms` is wall-clock time spent in the handler. CI is noisy so
      // we can't assert a tight upper bound, but it must be finite and
      // non-negative — that's what the dashboard charts.
      expect(typeof latest.counters.ms).toBe("number");
      expect(Number.isFinite(latest.counters.ms)).toBe(true);
      expect(latest.counters.ms).toBeGreaterThanOrEqual(0);
    });

    it("records a sample with error:1 and a numeric ms when the request fails Zod validation", async () => {
      const okBefore = getJobMetrics(BULK_MOVE_METRIC).totals.ok ?? 0;
      const errBefore = getJobMetrics(BULK_MOVE_METRIC).totals.error ?? 0;
      const samplesBefore = getJobMetrics(BULK_MOVE_METRIC).samples.length;

      // Non-numeric coordinates trip the per-update Zod schema, which
      // throws inside the route's try block and lands in the catch
      // that owns the `error: 1` metric call. Using a Zod failure
      // (rather than e.g. a missing-id 404 or cross-doc 400, which
      // short-circuit BEFORE either metric call fires) is what
      // guarantees the failure counter actually gets tagged.
      const res = await apiPatch(
        `/api/plan-documents/${docId}/markups/bulk`,
        adminToken,
        { updates: [{ id: "abc", points: [{ x: "oops", y: 1 }] }] },
      );
      expect(res.status).toBe(400);

      const after = getJobMetrics(BULK_MOVE_METRIC);
      expect(after.samples.length).toBe(samplesBefore + 1);
      // Failure path bumps `error` by 1 and never bumps `ok`.
      expect(after.totals.error ?? 0).toBe(errBefore + 1);
      expect(after.totals.ok ?? 0).toBe(okBefore);

      const latest = after.latest!;
      expect(latest).toBeTruthy();
      expect(latest.counters.error).toBe(1);
      expect(latest.counters.ok ?? 0).toBe(0);
      // `ms` must still be tagged on the failure path so the
      // dashboard can chart "how long do failed bulk PATCHes take?"
      // alongside the happy-path latency.
      expect(typeof latest.counters.ms).toBe("number");
      expect(Number.isFinite(latest.counters.ms)).toBe(true);
      expect(latest.counters.ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe(`DELETE /api/plan-documents/:docId/markups/bulk → ${BULK_DELETE_METRIC}`, () => {
    it("records a sample with ok:1, count==batch size, and a numeric ms on success", async () => {
      const markups = await seedMarkups(4);
      const ids = markups.map((m) => m.id);

      const okBefore = getJobMetrics(BULK_DELETE_METRIC).totals.ok ?? 0;
      const errBefore = getJobMetrics(BULK_DELETE_METRIC).totals.error ?? 0;
      const samplesBefore = getJobMetrics(BULK_DELETE_METRIC).samples.length;

      const res = await apiDelete(
        `/api/plan-documents/${docId}/markups/bulk`,
        adminToken,
        { ids },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, count: ids.length });

      const after = getJobMetrics(BULK_DELETE_METRIC);
      expect(after.samples.length).toBe(samplesBefore + 1);
      expect(after.totals.ok ?? 0).toBe(okBefore + 1);
      expect(after.totals.error ?? 0).toBe(errBefore);

      const latest = after.latest!;
      expect(latest).toBeTruthy();
      expect(latest.counters.ok).toBe(1);
      expect(latest.counters.error ?? 0).toBe(0);
      // `count` mirrors the de-duplicated `ids.length` the route
      // operated on (we send unique ids here, so the two are equal).
      expect(latest.counters.count).toBe(ids.length);
      expect(typeof latest.counters.ms).toBe("number");
      expect(Number.isFinite(latest.counters.ms)).toBe(true);
      expect(latest.counters.ms).toBeGreaterThanOrEqual(0);
    });

    it("records a sample with error:1 and a numeric ms when the request fails Zod validation", async () => {
      const okBefore = getJobMetrics(BULK_DELETE_METRIC).totals.ok ?? 0;
      const errBefore = getJobMetrics(BULK_DELETE_METRIC).totals.error ?? 0;
      const samplesBefore = getJobMetrics(BULK_DELETE_METRIC).samples.length;

      // Empty `ids` array trips `z.array(...).min(1)`, which throws
      // inside the route's try block and lands in the catch that owns
      // the `error: 1` metric call. Same rationale as the bulk-PATCH
      // failure-path test above: any pre-Zod 4xx (cross-doc, cross-
      // tenant, missing doc) short-circuits BEFORE the metric fires
      // and would not exercise the failure counter.
      const res = await apiDelete(
        `/api/plan-documents/${docId}/markups/bulk`,
        adminToken,
        { ids: [] },
      );
      expect(res.status).toBe(400);

      const after = getJobMetrics(BULK_DELETE_METRIC);
      expect(after.samples.length).toBe(samplesBefore + 1);
      expect(after.totals.error ?? 0).toBe(errBefore + 1);
      expect(after.totals.ok ?? 0).toBe(okBefore);

      const latest = after.latest!;
      expect(latest).toBeTruthy();
      expect(latest.counters.error).toBe(1);
      expect(latest.counters.ok ?? 0).toBe(0);
      expect(typeof latest.counters.ms).toBe("number");
      expect(Number.isFinite(latest.counters.ms)).toBe(true);
      expect(latest.counters.ms).toBeGreaterThanOrEqual(0);
    });
  });
});
