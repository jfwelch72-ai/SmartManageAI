/**
 * Tests for GET /api/admin/status/webhook-secrets (Task #884).
 *
 * The pure helper `collectWebhookSecretFindings()` is unit-tested in
 * `webhook-secrets-audit.test.ts`. This file covers the admin route
 * itself: auth/role enforcement, response shape, and — most
 * importantly — that no actual secret VALUES are leaked in the response
 * body for any combination of env vars.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

type TestUser = { id: string; role: string; effectiveRole?: string } | null;
let testUser: TestUser = null;

vi.mock("../auth", () => ({
  requireAuth: (
    req: Request & { user?: TestUser },
    res: Response,
    next: NextFunction,
  ) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
    next();
  },
  requireRole: (...roles: string[]) =>
    (
      req: Request & { user?: TestUser },
      res: Response,
      next: NextFunction,
    ) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (req.user.role === "SUPER_ADMIN") {
        next();
        return;
      }
      const role = req.user.effectiveRole || req.user.role;
      if (!roles.includes(role)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      next();
    },
}));

// Heavy modules pulled in by statusPageRoutes that are irrelevant here.
vi.mock("../statusProbeScheduler", () => ({ runProbeSweep: vi.fn() }));
vi.mock("../statusAlertService", () => ({
  getAlertOverview: vi.fn(),
  sendTestAlert: vi.fn(),
}));
vi.mock("../services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const WEBHOOK_ENV_VARS = [
  "RESEND_WEBHOOK_SIGNING_SECRET",
  "RESEND_WEBHOOK_SECRET",
  "EMAIL_WEBHOOK_SECRET",
  "GMAIL_PUBSUB_TOPIC",
  "GMAIL_PUBSUB_AUDIENCE",
] as const;

const savedEnv: Record<string, string | undefined> = {};

let app: Express;
let collectWebhookSecretFindings: typeof import("../webhookSecretsAudit").collectWebhookSecretFindings;

beforeAll(async () => {
  const { default: statusPageRoutes } = await import("../statusPageRoutes");
  ({ collectWebhookSecretFindings } = await import("../webhookSecretsAudit"));

  app = express();
  app.use(express.json());
  app.use(statusPageRoutes);

  for (const k of WEBHOOK_ENV_VARS) {
    savedEnv[k] = process.env[k];
  }
});

beforeEach(() => {
  testUser = null;
  for (const k of WEBHOOK_ENV_VARS) {
    delete process.env[k];
  }
});

afterAll(() => {
  for (const k of WEBHOOK_ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
});

describe("GET /api/admin/status/webhook-secrets — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(401);
  });

  it("returns 403 for an authenticated non-SUPER_ADMIN user", async () => {
    testUser = { id: "user-1", role: "ADMIN" };
    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(403);
  });

  it("returns 403 for HUSTLER users even with an effectiveRole override", async () => {
    testUser = { id: "user-2", role: "HUSTLER", effectiveRole: "MANAGER" };
    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(403);
  });

  it("returns 200 for SUPER_ADMIN", async () => {
    testUser = { id: "super-1", role: "SUPER_ADMIN" };
    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/status/webhook-secrets — response shape", () => {
  beforeEach(() => {
    testUser = { id: "super-1", role: "SUPER_ADMIN" };
  });

  it("returns { findings: [] } when every webhook secret is configured", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "whsec_aaaaaaaaaaaaaaaa";
    process.env.EMAIL_WEBHOOK_SECRET = "shared-secret-bbbbbbbbbbbbbbbb";
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/t";
    process.env.GMAIL_PUBSUB_AUDIENCE = "https://app.example.com/webhook";

    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ findings: [] });
  });

  it("returns findings whose shape exactly matches collectWebhookSecretFindings()", async () => {
    // Resend ERROR + EMAIL_WEBHOOK_SECRET WARN + Gmail audience WARN.
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/t";

    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(200);

    const expected = collectWebhookSecretFindings().map((f) => ({
      variable: f.variable,
      integration: f.integration,
      severity: f.severity,
      message: f.message,
    }));
    expect(res.body).toEqual({ findings: expected });

    // Each finding only carries the four documented fields — nothing extra
    // (such as a `value` field) sneaks through.
    for (const finding of res.body.findings) {
      expect(Object.keys(finding).sort()).toEqual([
        "integration",
        "message",
        "severity",
        "variable",
      ]);
      expect(["warn", "error"]).toContain(finding.severity);
      expect(typeof finding.variable).toBe("string");
      expect(typeof finding.integration).toBe("string");
      expect(typeof finding.message).toBe("string");
    }
  });

  it("flags Resend as WARN (not ERROR) when a shared-secret fallback is present", async () => {
    process.env.RESEND_WEBHOOK_SECRET = "shared-fallback-cccccccccccccccc";
    process.env.EMAIL_WEBHOOK_SECRET = "shared-secret-bbbbbbbbbbbbbbbb";

    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(200);
    const resend = (res.body.findings as Array<{ variable: string; severity: string }>)
      .find((f) => f.variable === "RESEND_WEBHOOK_SIGNING_SECRET");
    expect(resend?.severity).toBe("warn");
  });

  it("does not flag GMAIL_PUBSUB_AUDIENCE when Gmail Pub/Sub isn't wired up", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = "whsec_aaaaaaaaaaaaaaaa";
    process.env.EMAIL_WEBHOOK_SECRET = "shared-secret-bbbbbbbbbbbbbbbb";

    const res = await request(app).get("/api/admin/status/webhook-secrets");
    expect(res.status).toBe(200);
    const variables = (res.body.findings as Array<{ variable: string }>).map((f) => f.variable);
    expect(variables).not.toContain("GMAIL_PUBSUB_AUDIENCE");
  });
});

describe("GET /api/admin/status/webhook-secrets — never leaks secret VALUES", () => {
  // Distinctive sentinel values for each env var. If any of these strings
  // appear anywhere in the JSON response body the route is leaking the
  // secret rather than just naming the variable.
  const SECRET_VALUES: Record<string, string> = {
    RESEND_WEBHOOK_SIGNING_SECRET: "whsec_LEAK_SIGNING_d4f3a1e9b7c8",
    RESEND_WEBHOOK_SECRET: "LEAK_RESEND_SHARED_8b2c1d4e7f0a",
    EMAIL_WEBHOOK_SECRET: "LEAK_EMAIL_SHARED_a1b2c3d4e5f60718",
    GMAIL_PUBSUB_TOPIC: "projects/LEAK_PROJECT_92xy/topics/LEAK_TOPIC_31qq",
    GMAIL_PUBSUB_AUDIENCE: "https://LEAK-AUDIENCE-7531.example.com/webhook",
  };

  beforeEach(() => {
    testUser = { id: "super-1", role: "SUPER_ADMIN" };
  });

  function assertNoSecretsLeaked(body: unknown, present: string[]) {
    const serialized = JSON.stringify(body);
    for (const k of present) {
      const value = SECRET_VALUES[k];
      expect(
        serialized.includes(value),
        `Response body must not contain the value of ${k}`,
      ).toBe(false);
    }
  }

  // Build a matrix of env var combinations to exercise every code path
  // through `collectWebhookSecretFindings` while making sure none of the
  // configured secret values bleeds into the response.
  const SCENARIOS: Array<{ name: string; present: Array<keyof typeof SECRET_VALUES> }> = [
    { name: "no env vars set (Resend ERROR + EMAIL warn)", present: [] },
    {
      name: "all secrets set",
      present: [
        "RESEND_WEBHOOK_SIGNING_SECRET",
        "EMAIL_WEBHOOK_SECRET",
        "GMAIL_PUBSUB_TOPIC",
        "GMAIL_PUBSUB_AUDIENCE",
      ],
    },
    {
      name: "shared-secret fallback only (Resend WARN)",
      present: ["RESEND_WEBHOOK_SECRET", "EMAIL_WEBHOOK_SECRET"],
    },
    {
      name: "Gmail topic configured but no audience (audience WARN)",
      present: [
        "RESEND_WEBHOOK_SIGNING_SECRET",
        "EMAIL_WEBHOOK_SECRET",
        "GMAIL_PUBSUB_TOPIC",
      ],
    },
    {
      name: "EMAIL_WEBHOOK_SECRET set but no Resend secret (Resend ERROR)",
      present: ["EMAIL_WEBHOOK_SECRET"],
    },
    {
      name: "only RESEND_WEBHOOK_SIGNING_SECRET set (EMAIL warn)",
      present: ["RESEND_WEBHOOK_SIGNING_SECRET"],
    },
  ];

  for (const scenario of SCENARIOS) {
    it(`does not leak any secret value: ${scenario.name}`, async () => {
      for (const k of scenario.present) {
        process.env[k] = SECRET_VALUES[k];
      }

      const res = await request(app).get("/api/admin/status/webhook-secrets");
      expect(res.status).toBe(200);

      // Sanity: the body should be valid and well-shaped before checking
      // for leakage so a totally empty body doesn't trivially pass.
      expect(Array.isArray(res.body.findings)).toBe(true);

      assertNoSecretsLeaked(res.body, scenario.present);
    });
  }
});
