/**
 * Task #1103 — route-level coverage for the Resend acting-admin plumbing.
 *
 * The companion service-level suite in
 * `transcript-backfill-notifications.test.ts` pins the contract that
 * `resendBackfillAlertDelivery(orgId, deliveryId, adminId)` writes the new
 * delivery row with `source='resend'` and `triggeredById=<adminId>`.
 *
 * This file pins the *other* half of the path: the HTTP handler in
 * `crmCallsRoutes.ts` for
 *   POST /api/crm/calls/transcripts/backfill/alert-deliveries/:id/resend
 * actually forwards `req.user.id` into that 3rd argument so the tagging the
 * service relies on can never silently regress to "anonymous resend".
 *
 * The transcription service is mocked because importing crmCallsRoutes
 * pulls it in transitively, matching the convention used by the other
 * route-level backfill suites.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Express, NextFunction, Response } from "express";
import request from "supertest";
import type { AuthRequest } from "../auth";

vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(),
  queueCallTranscription: vi.fn(),
}));

const resendMock = vi.fn();
vi.mock("../services/transcriptBackfillNotifications", async () => {
  const actual = await vi.importActual<
    typeof import("../services/transcriptBackfillNotifications")
  >("../services/transcriptBackfillNotifications");
  return {
    ...actual,
    resendBackfillAlertDelivery: resendMock,
  };
});

let app: Express;
type FakeUser = {
  id: string;
  role: "ADMIN" | "SUPER_ADMIN";
  organizationId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};
let currentUser: FakeUser | null = null;

beforeAll(async () => {
  const routes = await import("../crmCallsRoutes");
  const express = await import("express");
  app = express.default();
  app.use(express.default.json());
  app.use((req: AuthRequest, res: Response, next: NextFunction) => {
    if (!currentUser) {
      res.status(401).json({ error: "no test user configured" });
      return;
    }
    req.user = {
      id: currentUser.id,
      email: currentUser.email ?? "admin@test.invalid",
      firstName: currentUser.firstName ?? "Jane",
      lastName: currentUser.lastName ?? "Admin",
      role: currentUser.role,
      organizationId: currentUser.organizationId,
      isActive: true,
    } as AuthRequest["user"];
    next();
  });
  app.use(routes.default);
  app.use((err: unknown, _req: AuthRequest, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  });
});

beforeEach(() => {
  resendMock.mockReset();
  currentUser = null;
});

describe("POST /alert-deliveries/:id/resend forwards the acting admin id (Task #1103)", () => {
  it("passes req.user.id as triggeredById and surfaces the resend provenance in the response", async () => {
    currentUser = {
      id: "admin-jane",
      role: "ADMIN",
      organizationId: "org-1",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
    };
    resendMock.mockResolvedValueOnce({
      ok: true,
      delivery: {
        id: "del-new",
        orgId: "org-1",
        jobId: "job-1",
        channel: "slack",
        status: "success",
        recipientSummary: "hooks.slack.com",
        errorMessage: null,
        attemptedAt: new Date("2026-04-22T12:00:30.000Z"),
        source: "resend",
        triggeredById: "admin-jane",
      },
    });

    const res = await request(app)
      .post("/api/crm/calls/transcripts/backfill/alert-deliveries/del-original/resend")
      .send({});

    expect(res.status).toBe(200);
    // The route MUST hand `req.user.id` to the service as the 3rd
    // argument — that's the whole reason the new delivery row carries
    // the acting admin's id.
    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(resendMock).toHaveBeenCalledWith("org-1", "del-original", "admin-jane");

    // The response payload exposes the provenance fields (source +
    // triggeredBy display block) that the in-app history needs to render
    // "Resent by Jane Doe" without waiting for the next list poll.
    expect(res.body.delivery).toMatchObject({
      id: "del-new",
      source: "resend",
      triggeredBy: { id: "admin-jane", displayName: "Jane Doe" },
    });
  });

  it("propagates a 429 cooldown response from the service unchanged", async () => {
    // Sanity check that the route doesn't inadvertently swap or drop the
    // service result on the cooldown branch — the UI relies on the
    // Retry-After header + body to render its countdown.
    currentUser = {
      id: "admin-jane",
      role: "ADMIN",
      organizationId: "org-1",
    };
    resendMock.mockResolvedValueOnce({
      ok: false,
      reason: "COOLDOWN",
      retryAfterSeconds: 17,
    });

    const res = await request(app)
      .post("/api/crm/calls/transcripts/backfill/alert-deliveries/del-original/resend")
      .send({});

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("17");
    expect(res.body).toMatchObject({ reason: "COOLDOWN", retryAfterSeconds: 17 });
    expect(resendMock).toHaveBeenCalledWith("org-1", "del-original", "admin-jane");
  });
});
