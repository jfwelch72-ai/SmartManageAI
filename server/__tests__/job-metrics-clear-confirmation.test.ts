/**
 * Task #717: route-level tests for the confirmation guard wrapping the
 * destructive `DELETE /api/admin/metrics/jobs[/:jobName]` endpoints.
 *
 * The endpoints themselves wipe persisted trend data with no recovery,
 * so a misclick (or a stale curl in someone's terminal history) needs
 * to bounce off a confirmation token instead of silently nuking real
 * history. These tests mount a tiny Express app with the same guard
 * middleware used in `server/routes.ts`, plus a stand-in handler that
 * records whether the destructive work was ever invoked. That keeps
 * the test hermetic (no DB, no auth wiring) while still exercising the
 * actual middleware code path in `server/utils/jobMetricsConfirmation.ts`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response } from "express";
import request from "supertest";

import {
  requireJobMetricsClearConfirmation,
  CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN,
} from "../utils/jobMetricsConfirmation";

const wipeAll = vi.fn();
const wipeOne = vi.fn();

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  app.delete(
    "/api/admin/metrics/jobs",
    requireJobMetricsClearConfirmation(CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN),
    (_req: Request, res: Response) => {
      wipeAll();
      res.json({ cleared: "*", deleted: 7 });
    },
  );

  app.delete(
    "/api/admin/metrics/jobs/:jobName",
    requireJobMetricsClearConfirmation((req) => req.params.jobName),
    (req: Request, res: Response) => {
      wipeOne(req.params.jobName);
      res.json({ cleared: req.params.jobName, deleted: 3 });
    },
  );

  return app;
}

beforeEach(() => {
  wipeAll.mockReset();
  wipeOne.mockReset();
});

describe("job metric clear confirmation guard (Task #717)", () => {
  it("rejects clear-all without ?confirm and never invokes the wipe", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/admin/metrics/jobs");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmation required/i);
    expect(res.body.expected).toBe(CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN);
    expect(res.body.hint).toMatch(/confirm=all/);
    expect(wipeAll).not.toHaveBeenCalled();
  });

  it("rejects clear-all when confirm token does not match exactly", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/admin/metrics/jobs?confirm=true");

    expect(res.status).toBe(400);
    expect(wipeAll).not.toHaveBeenCalled();
  });

  it("accepts clear-all with ?confirm=all", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/admin/metrics/jobs?confirm=all");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: "*", deleted: 7 });
    expect(wipeAll).toHaveBeenCalledTimes(1);
  });

  it("accepts clear-all when the confirm token is supplied in the JSON body", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete("/api/admin/metrics/jobs")
      .send({ confirm: "all" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(wipeAll).toHaveBeenCalledTimes(1);
  });

  it("rejects clear-one without confirmation and never invokes the wipe", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/admin/metrics/jobs/crm_birthday_digest");

    expect(res.status).toBe(400);
    expect(res.body.expected).toBe("crm_birthday_digest");
    expect(res.body.hint).toMatch(/confirm=crm_birthday_digest/);
    expect(wipeOne).not.toHaveBeenCalled();
  });

  it("rejects clear-one when the confirm token does not match the job name", async () => {
    const app = buildApp();
    const res = await request(app).delete(
      "/api/admin/metrics/jobs/crm_birthday_digest?confirm=outbox",
    );

    expect(res.status).toBe(400);
    expect(wipeOne).not.toHaveBeenCalled();
  });

  it("accepts clear-one when ?confirm matches the URL job name", async () => {
    const app = buildApp();
    const res = await request(app).delete(
      "/api/admin/metrics/jobs/crm_birthday_digest?confirm=crm_birthday_digest",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: "crm_birthday_digest", deleted: 3 });
    expect(wipeOne).toHaveBeenCalledWith("crm_birthday_digest");
  });

  it("accepts clear-one when the confirm token is supplied in the JSON body", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete("/api/admin/metrics/jobs/outbox")
      .send({ confirm: "outbox" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(wipeOne).toHaveBeenCalledWith("outbox");
  });

  it("treats an empty confirm value the same as a missing one", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/admin/metrics/jobs?confirm=");

    expect(res.status).toBe(400);
    expect(wipeAll).not.toHaveBeenCalled();
  });
});
