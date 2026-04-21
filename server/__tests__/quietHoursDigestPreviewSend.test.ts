/**
 * Task #777 — Tests for the quiet-hours digest preview endpoint
 * (POST /api/auth/profile/quiet-hours/preview-digest).
 *
 * Verifies:
 *   1. The "render" branch returns the digest body without invoking
 *      any email transport.
 *   2. The "send" branch, when EMAIL_TRANSPORT=noop is set, captures
 *      the outbound email in the in-memory test outbox instead of
 *      delivering real mail via Resend.
 *   3. The preview helper is invoked exactly once per request and the
 *      response shape is stable for both branches.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

type TestUser = {
  id: string;
  email: string;
  role: string;
  jobMetricAlertQuietHoursDigestFormat?: "summary" | "full" | "grouped";
} | null;

let testUser: TestUser = null;

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined, returning: async () => [] }),
  },
  pool: {},
}));

vi.mock("../auth", () => ({
  requireAuth: (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
    next();
  },
  hashPassword: async (s: string) => s,
  verifyPassword: async () => true,
  generateToken: () => "test-token",
  invalidateAuthCache: () => undefined,
  setAuthCookie: () => undefined,
  clearAuthCookie: () => undefined,
}));

vi.mock("../rateLimiter", () => ({
  authLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  sensitiveLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../auditLogger", () => ({
  logUpdate: vi.fn(async () => undefined),
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("../email", () => ({
  sendEmail: vi.fn(async () => true),
  getEmailVerificationHtml: () => "",
  getEmailVerificationText: () => "",
}));

const buildPreviewMock = vi.fn(async (format: string) => ({
  subject: `[Preview] sample subject (${format})`,
  html: `<p>preview html (${format})</p>`,
  text: `preview text (${format})`,
  isSynthetic: true,
  eventCount: 3,
}));

vi.mock("../utils/jobMetricAlerts", () => ({
  buildQuietHoursDigestPreview: (format: string) => buildPreviewMock(format),
}));

vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
}));

vi.mock("../services/featureFlagService", () => ({
  setAllFeatureFlags: vi.fn(async () => undefined),
}));

vi.mock("../utils/devSeedFlag", () => ({
  requireDevSeed: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

let app: Express;
let emailService: typeof import("../services/emailService");
let priorEmailTransport: string | undefined;

beforeAll(async () => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";
  emailService = await import("../services/emailService");
  const { default: router } = await import("../authProfileRoutes");
  app = express();
  app.use(express.json());
  app.use(router);
});

afterAll(() => {
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
});

beforeEach(() => {
  testUser = null;
  buildPreviewMock.mockClear();
  emailService.clearTestEmailOutbox();
});

afterEach(() => {
  emailService.clearTestEmailOutbox();
});

const ROUTE = "/api/auth/profile/quiet-hours/preview-digest";

describe("POST /api/auth/profile/quiet-hours/preview-digest (Task #777)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post(ROUTE).send({});
    expect(res.status).toBe(401);
  });

  it("render mode returns the preview body without sending email", async () => {
    testUser = {
      id: "u1",
      email: "preview-user@example.com",
      role: "ADMIN",
      jobMetricAlertQuietHoursDigestFormat: "full",
    };

    const res = await request(app)
      .post(ROUTE)
      .send({ mode: "render", format: "summary" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      mode: "render",
      format: "summary",
      isSynthetic: true,
      eventCount: 3,
      subject: "[Preview] sample subject (summary)",
    });
    expect(typeof res.body.html).toBe("string");
    expect(typeof res.body.text).toBe("string");

    expect(buildPreviewMock).toHaveBeenCalledTimes(1);
    expect(buildPreviewMock).toHaveBeenCalledWith("summary");

    // No email is dispatched in render mode.
    expect(emailService.getTestEmailOutbox()).toHaveLength(0);
  });

  it("send mode captures the email via the noop transport instead of contacting Resend", async () => {
    testUser = {
      id: "u2",
      email: "sender@example.com",
      role: "ADMIN",
      jobMetricAlertQuietHoursDigestFormat: "grouped",
    };

    expect(emailService.isEmailTransportNoop()).toBe(true);

    const res = await request(app).post(ROUTE).send({ mode: "send" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      mode: "send",
      format: "grouped",
      isSynthetic: true,
      eventCount: 3,
      sentTo: "sender@example.com",
    });
    // The render-only fields must be omitted on the send branch.
    expect(res.body).not.toHaveProperty("html");
    expect(res.body).not.toHaveProperty("text");
    expect(res.body).not.toHaveProperty("subject");

    expect(buildPreviewMock).toHaveBeenCalledTimes(1);
    expect(buildPreviewMock).toHaveBeenCalledWith("grouped");

    const outbox = emailService.getTestEmailOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual(["sender@example.com"]);
    expect(outbox[0].subject).toBe("[Preview] sample subject (grouped)");
    expect(outbox[0].html).toContain("preview html (grouped)");
    expect(outbox[0].text).toContain("preview text (grouped)");
  });

  it("rejects an invalid mode with 400", async () => {
    testUser = { id: "u3", email: "x@example.com", role: "ADMIN" };
    const res = await request(app).post(ROUTE).send({ mode: "explode" });
    expect(res.status).toBe(400);
    expect(emailService.getTestEmailOutbox()).toHaveLength(0);
  });
});
