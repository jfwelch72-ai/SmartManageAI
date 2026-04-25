/**
 * Task #2016 — Lock in the response shape of GET /api/admin/metrics/pool.
 *
 * The Job Metrics dashboard's `pool_health` JobCard pulls two new
 * fields off this endpoint (Task #2009): the synthetic job name
 * (`job: "pool_health"`) and the configured saturation-samples
 * threshold (`waitingSaturationSamples`, sourced from
 * `WAITING_SATURATION_SAMPLES` in `server/utils/poolHealth.ts`). If
 * either field is silently dropped from the route's payload, the
 * dashboard's per-counter tooltip stops naming the live threshold and
 * the card description loses the env-var label operators tweak.
 *
 * The production route is registered inline in `server/routes.ts`,
 * which means we can't `import` it as an isolated router (unlike
 * `jobMetricAlertRulesRoutes`). Instead, this suite mounts a tiny
 * Express app whose handler reuses the SAME imports the production
 * handler depends on — so removing or renaming any of those exports
 * surfaces here. A static-content guard at the bottom additionally
 * asserts the inline `routes.ts` handler still wires both fields,
 * so the in-memory test stays representative of production.
 */

import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getPoolStats,
  getRecentPoolExhaustedEvents,
  POOL_EXHAUSTED_BUFFER_SIZE,
  WAITING_SATURATION_SAMPLES,
  POOL_HEALTH_JOB,
} from "../utils/poolHealth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  // Mirrors the inline handler at `server/routes.ts` GET
  // /api/admin/metrics/pool. Auth/role middleware is intentionally
  // omitted: this suite is concerned with the response payload shape,
  // not access control (which is covered for SUPER_ADMIN-only
  // endpoints by the broader auth tests).
  app.get("/api/admin/metrics/pool", (_req, res: Response) => {
    res.json({
      stats: getPoolStats(),
      events: getRecentPoolExhaustedEvents(),
      bufferSize: POOL_EXHAUSTED_BUFFER_SIZE,
      job: POOL_HEALTH_JOB,
      waitingSaturationSamples: WAITING_SATURATION_SAMPLES,
    });
  });
});

describe("GET /api/admin/metrics/pool — Task #2009 contract (Task #2016)", () => {
  it("includes the synthetic job name 'pool_health'", async () => {
    const res = await request(app).get("/api/admin/metrics/pool");
    expect(res.status).toBe(200);
    expect(res.body.job).toBe("pool_health");
    expect(res.body.job).toBe(POOL_HEALTH_JOB);
  });

  it("includes the configured waitingSaturationSamples threshold", async () => {
    const res = await request(app).get("/api/admin/metrics/pool");
    expect(res.status).toBe(200);
    expect(typeof res.body.waitingSaturationSamples).toBe("number");
    expect(Number.isInteger(res.body.waitingSaturationSamples)).toBe(true);
    expect(res.body.waitingSaturationSamples).toBeGreaterThan(0);
    expect(res.body.waitingSaturationSamples).toBe(WAITING_SATURATION_SAMPLES);
  });

  it("preserves the legacy stats / events / bufferSize fields", async () => {
    const res = await request(app).get("/api/admin/metrics/pool");
    expect(res.status).toBe(200);
    expect(res.body.bufferSize).toBe(POOL_EXHAUSTED_BUFFER_SIZE);
    expect(res.body.stats).toMatchObject({
      active: expect.any(Number),
      idle: expect.any(Number),
      waiting: expect.any(Number),
      total: expect.any(Number),
      max: expect.any(Number),
    });
    expect(Array.isArray(res.body.events)).toBe(true);
  });
});

describe("server/routes.ts /api/admin/metrics/pool wiring (Task #2016)", () => {
  // Static guard against drift: the production handler is defined
  // inline in routes.ts and the in-memory test above replicates it.
  // If a future refactor drops `job` or `waitingSaturationSamples`
  // from the inline handler, this assertion catches it so the
  // dashboard never silently loses its threshold wording.
  it("emits both `job` and `waitingSaturationSamples` in the response payload", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../routes.ts"),
      "utf8",
    );
    const start = source.indexOf('"/api/admin/metrics/pool"');
    expect(start).toBeGreaterThan(-1);
    // Slice forward enough to capture the entire handler body but not
    // bleed into the next route registration.
    const handlerSlice = source.slice(start, start + 1500);
    expect(handlerSlice).toContain("WAITING_SATURATION_SAMPLES");
    expect(handlerSlice).toContain("POOL_HEALTH_JOB");
    expect(handlerSlice).toMatch(/job:\s*POOL_HEALTH_JOB/);
    expect(handlerSlice).toMatch(
      /waitingSaturationSamples:\s*WAITING_SATURATION_SAMPLES/,
    );
  });
});
