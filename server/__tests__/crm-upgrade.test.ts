import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

let app: Express;
let server: Server;
let adminCookie: string;
const suffix = Date.now();

function extractCookie(res: request.Response): string | null {
  const cookies = res.headers["set-cookie"] as string | string[] | undefined;
  if (!cookies) return null;
  const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of cookieArr) {
    const match = c.match(/auth_token=([^;]+)/);
    if (match) return `auth_token=${match[1]}`;
  }
  return null;
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const loginRes = await request(app).post("/api/dev/test-login").send({ role: "ADMIN" });
  const cookie = extractCookie(loginRes);
  if (cookie) adminCookie = cookie;
}, 60_000);

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

const auth = (m: "get" | "post" | "patch" | "delete") => (path: string) =>
  (request(app) as any)[m](path).set("Cookie", adminCookie);

describe("CRM Upgrade — Lead Forms", () => {
  let formId: string;
  let formSlug: string;

  it("creates a lead form", async () => {
    const res = await auth("post")("/api/crm/lead-forms").send({
      name: `Test Form ${suffix}`,
      status: "PUBLISHED",
      fields: [
        { key: "name", label: "Name", type: "TEXT", required: true },
        { key: "email", label: "Email", type: "EMAIL", required: true },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.slug).toBeTruthy();
    formId = res.body.id;
    formSlug = res.body.slug;
  });

  it("fetches the public form spec without auth", async () => {
    const res = await request(app).get(`/api/public/lead-forms/${formSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.fields).toHaveLength(2);
  });

  it("submits the public form and creates a lead-form submission", async () => {
    const res = await request(app)
      .post(`/api/public/lead-forms/${formSlug}/submit`)
      .send({ name: "Jane", email: `jane+${suffix}@example.com` });
    expect([200, 201]).toContain(res.status);
  });

  it("rejects submission missing required fields", async () => {
    const res = await request(app)
      .post(`/api/public/lead-forms/${formSlug}/submit`)
      .send({ name: "Bob" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("lists submissions for the org", async () => {
    const res = await auth("get")(`/api/crm/lead-forms/${formId}/submissions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("CRM Upgrade — Stage SLAs & Needs Attention", () => {
  it("upserts a stage SLA", async () => {
    const res = await auth("post")("/api/crm/stage-slas").send({
      stage: "QUALIFIED",
      maxDaysInStage: 5,
      warnAtDays: 3,
      notifyAssignee: true,
    });
    expect([200, 201]).toContain(res.status);
  });

  it("lists stage SLAs", async () => {
    const res = await auth("get")("/api/crm/stage-slas");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("runs the SLA check", async () => {
    const res = await auth("post")("/api/crm/sla/run-check").send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.flagged === "number" || typeof res.body.checked === "number").toBeTruthy();
  });

  it("returns needs-attention list", async () => {
    const res = await auth("get")("/api/crm/opportunities/needs-attention");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("CRM Upgrade — Automations", () => {
  let autoId: string;
  it("creates an automation rule", async () => {
    const res = await auth("post")("/api/crm/automations").send({
      name: `Auto ${suffix}`,
      trigger: "STAGE_CHANGE",
      isActive: true,
      triggerConfig: { toStage: "QUALIFIED" },
      actions: [{ type: "NOTIFY", config: { title: "t", message: "m" } }],
    });
    expect(res.status).toBe(201);
    autoId = res.body.id;
  });

  it("toggles automation active flag", async () => {
    const res = await auth("patch")(`/api/crm/automations/${autoId}`).send({ isActive: false });
    expect(res.status).toBe(200);
  });

  it("lists automations", async () => {
    const res = await auth("get")("/api/crm/automations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("CRM Upgrade — Custom Reports", () => {
  it("runs an ad-hoc opportunity-by-stage report", async () => {
    const res = await auth("post")("/api/crm/reports/run").send({
      entity: "opportunity",
      dimensions: ["stage"],
      measures: ["count", "sumDealValue"],
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it("rejects non-whitelisted dimensions", async () => {
    const res = await auth("post")("/api/crm/reports/run").send({
      entity: "opportunity",
      dimensions: ["passwordHash"],
      measures: ["count"],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("CRM Upgrade — Meeting Booking Links", () => {
  let linkSlug: string;
  it("creates a booking link", async () => {
    const res = await auth("post")("/api/crm/meeting-links").send({
      name: `Discovery ${suffix}`,
      durationMinutes: 30,
      timezone: "America/New_York",
      availability: { mon: [{ start: "09:00", end: "17:00" }] },
      isActive: true,
    });
    expect(res.status).toBe(201);
    linkSlug = res.body.slug;
  });

  it("returns booking link metadata publicly", async () => {
    const res = await request(app).get(`/api/public/meeting-links/${linkSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.durationMinutes).toBe(30);
  });

  it("returns available slots", async () => {
    const res = await request(app).get(`/api/public/meeting-links/${linkSlug}/slots`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.slots)).toBe(true);
  });
});

describe("CRM Upgrade — Send-Time Optimization", () => {
  it("defers a 2am-scheduled send to 10am local when the window is 9–11am", async () => {
    const { applyOptimizedSendWindow } = await import("../services/sequenceService");
    // 2am New_York on a winter day → UTC 07:00
    const tz = "America/New_York";
    const scheduled = new Date(Date.UTC(2026, 0, 12, 7, 0, 0));
    const out = applyOptimizedSendWindow(scheduled, tz, 9, 11);
    // Expect 10am NY → UTC 15:00 (EST = UTC-5)
    expect(out.toISOString()).toBe("2026-01-12T15:00:00.000Z");
  });

  it("defers an after-window send (8pm) to next day 10am local", async () => {
    const { applyOptimizedSendWindow } = await import("../services/sequenceService");
    const tz = "America/New_York";
    // 8pm NY on Jan 12 → UTC Jan 13 01:00
    const scheduled = new Date(Date.UTC(2026, 0, 13, 1, 0, 0));
    const out = applyOptimizedSendWindow(scheduled, tz, 9, 11);
    expect(out.toISOString()).toBe("2026-01-13T15:00:00.000Z");
  });

  it("leaves an in-window send (10:30am) alone", async () => {
    const { applyOptimizedSendWindow } = await import("../services/sequenceService");
    const tz = "America/New_York";
    const scheduled = new Date(Date.UTC(2026, 0, 12, 15, 30, 0)); // 10:30am NY
    const out = applyOptimizedSendWindow(scheduled, tz, 9, 11);
    expect(out.toISOString()).toBe(scheduled.toISOString());
  });

  it("honors a learned preferred hour when within the window", async () => {
    const { applyOptimizedSendWindow } = await import("../services/sequenceService");
    const tz = "America/New_York";
    const scheduled = new Date(Date.UTC(2026, 0, 12, 7, 0, 0)); // 2am NY
    const out = applyOptimizedSendWindow(scheduled, tz, 9, 11, 11);
    expect(out.toISOString()).toBe("2026-01-12T16:00:00.000Z"); // 11am NY → 16:00 UTC
  });

  it("falls back to window midpoint when preferred hour is outside the window", async () => {
    const { applyOptimizedSendWindow } = await import("../services/sequenceService");
    const tz = "America/New_York";
    const scheduled = new Date(Date.UTC(2026, 0, 12, 7, 0, 0));
    const out = applyOptimizedSendWindow(scheduled, tz, 9, 11, 18);
    expect(out.toISOString()).toBe("2026-01-12T15:00:00.000Z");
  });
});

describe("CRM Upgrade — CSV Import", () => {
  it("imports contacts from inline rows and reports counts", async () => {
    const res = await auth("post")("/api/crm/csv-imports").send({
      entityType: "CONTACT",
      mapping: { fullName: "fullName", email: "email" },
      rows: [
        { fullName: `Alice ${suffix}`, email: `alice+${suffix}@example.com` },
        { fullName: `Bob ${suffix}`, email: `bob+${suffix}@example.com` },
      ],
      filename: "test.csv",
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.insertedRows).toBeGreaterThanOrEqual(0);
  });
});
