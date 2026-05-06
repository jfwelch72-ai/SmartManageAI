/**
 * Tests for Task #2429 — central error middleware, correlation ID
 * round-trip, and the no-console regression guard.
 *
 * Mocks `errorLogService` and `sentry` so we can assert the wiring
 * without touching the database or contacting Sentry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { execSync } from "node:child_process";

vi.mock("../services/errorLogService", () => ({
  persistErrorLog: vi.fn(async () => {}),
  pruneOldErrorLogs: vi.fn(async () => 0),
}));

vi.mock("../sentry", () => ({
  initSentry: vi.fn(() => false),
  isSentryEnabled: vi.fn(() => false),
  captureRequestException: vi.fn(),
}));

import { correlationIdMiddleware, getCorrelationId } from "../middleware/correlationId";
import { persistErrorLog } from "../services/errorLogService";
import { captureRequestException } from "../sentry";
import { logError, logInfo } from "../utils/logger";

function buildApp(env: "development" | "production") {
  // Set NODE_ENV for the duration of the test build.
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = env;

  const app = express();
  app.use(correlationIdMiddleware);
  app.use(express.json());

  app.get("/correlation", (req, res) => {
    res.json({ id: (req as any).id, fromAls: getCorrelationId() });
  });

  app.get("/boom", (_req, _res, _next) => {
    throw new Error("kaboom");
  });

  app.get("/four-oh-four", (_req, _res, next) => {
    const e: any = new Error("missing thing");
    e.status = 404;
    next(e);
  });

  // Express 4 doesn't forward rejected promises automatically — apps wrap
  // async handlers like this. The runbook documents the same pattern.
  const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve(fn(req, res, next)).catch(next);

  app.get(
    "/async-boom",
    asyncHandler(async (_req, _res, _next) => {
      throw new Error("async kaboom");
    }),
  );

  // Mirror the central error middleware shape from server/index.ts.
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isServerError = status >= 500;
    const isProdEnv = process.env.NODE_ENV === "production";
    const clientMessage = isServerError
      ? "Internal Server Error"
      : (err.message || "Bad Request");
    const requestId = (req as any).id;
    const errObj = err instanceof Error ? err : new Error(String(err));

    logError("Unhandled error in request", {
      method: req.method,
      path: req.path,
      requestId,
      statusCode: status,
    }, errObj);

    persistErrorLog({
      level: isServerError ? "error" : "warn",
      message: errObj.message,
      stack: errObj.stack,
      method: req.method,
      path: req.path,
      statusCode: status,
      requestId,
    });

    if (isServerError) {
      captureRequestException(errObj, req, requestId);
    }

    if (res.headersSent) return;

    const body: Record<string, unknown> = {
      success: false,
      error: clientMessage,
    };
    if (requestId) body.requestId = requestId;
    if (!isProdEnv) {
      body.stack = errObj.stack;
    }
    res.status(status).json(body);
  });

  return {
    app,
    restore: () => {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    },
  };
}

describe("correlation ID middleware", () => {
  it("generates a uuid v4 when no x-request-id header is present and echoes it back", async () => {
    const { app, restore } = buildApp("development");
    try {
      const res = await request(app).get("/correlation");
      expect(res.status).toBe(200);
      const headerId = res.headers["x-request-id"];
      expect(headerId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.id).toBe(headerId);
      expect(res.body.fromAls).toBe(headerId);
    } finally {
      restore();
    }
  });

  it("honors a sane inbound x-request-id header", async () => {
    const { app, restore } = buildApp("development");
    try {
      const res = await request(app)
        .get("/correlation")
        .set("x-request-id", "my-trace-abc123");
      expect(res.headers["x-request-id"]).toBe("my-trace-abc123");
      expect(res.body.id).toBe("my-trace-abc123");
      expect(res.body.fromAls).toBe("my-trace-abc123");
    } finally {
      restore();
    }
  });

  it("rejects junk inbound x-request-id and substitutes a generated one", async () => {
    const { app, restore } = buildApp("development");
    try {
      const res = await request(app)
        .get("/correlation")
        .set("x-request-id", "<script>alert(1)</script>");
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      restore();
    }
  });
});

describe("central error middleware", () => {
  beforeEach(() => {
    vi.mocked(persistErrorLog).mockClear();
    vi.mocked(captureRequestException).mockClear();
  });

  it("returns a sanitized 500 in production with no stack and includes requestId", async () => {
    const { app, restore } = buildApp("production");
    try {
      const res = await request(app).get("/boom");
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        success: false,
        error: "Internal Server Error",
      });
      expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.stack).toBeUndefined();
      expect(res.body.error).not.toContain("kaboom");
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
      expect(captureRequestException).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("includes the stack in development for triage", async () => {
    const { app, restore } = buildApp("development");
    try {
      const res = await request(app).get("/boom");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal Server Error");
      expect(typeof res.body.stack).toBe("string");
      expect(res.body.stack).toContain("kaboom");
    } finally {
      restore();
    }
  });

  it("propagates the requestId from the inbound header into the response body", async () => {
    const { app, restore } = buildApp("production");
    try {
      const res = await request(app)
        .get("/boom")
        .set("x-request-id", "trace-xyz-12345");
      expect(res.body.requestId).toBe("trace-xyz-12345");
      expect(res.headers["x-request-id"]).toBe("trace-xyz-12345");
    } finally {
      restore();
    }
  });

  it("preserves 4xx error messages and does NOT call Sentry", async () => {
    const { app, restore } = buildApp("production");
    try {
      const res = await request(app).get("/four-oh-four");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("missing thing");
      expect(captureRequestException).not.toHaveBeenCalled();
      expect(persistErrorLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: "warn", statusCode: 404 }),
      );
    } finally {
      restore();
    }
  });

  it("catches async route rejections through the same middleware", async () => {
    const { app, restore } = buildApp("production");
    try {
      const res = await request(app).get("/async-boom");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal Server Error");
      expect(persistErrorLog).toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("logger ambient correlation context", () => {
  it("auto-attaches the AsyncLocalStorage correlation ID to log entries", async () => {
    const { app, restore } = buildApp("development");
    const seen: unknown[] = [];
    const orig = console.error;
    // eslint-disable-next-line no-console
    console.error = (...args: unknown[]) => {
      seen.push(args.join(" "));
    };
    try {
      app.get("/log-during-request", (_req, res) => {
        logInfo("hello from request");
        logError("synthetic", undefined, new Error("boom-log"));
        res.json({ ok: true });
      });
      await request(app)
        .get("/log-during-request")
        .set("x-request-id", "trace-log-test-aaaa");
      const joined = seen.join("\n");
      expect(joined).toContain("synthetic");
      expect(joined).toContain("trace-log-test-aaaa");
    } finally {
      // eslint-disable-next-line no-console
      console.error = orig;
      restore();
    }
  });
});

describe("outbound x-request-id propagation (correlatedFetch)", () => {
  it("auto-attaches the inbound correlation ID to outgoing fetch calls", async () => {
    const { installCorrelatedFetch } = await import("../utils/correlatedFetch");
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const headers: Record<string, string> = {};
      const h = new Headers(init?.headers ?? (input?.headers ?? {}));
      h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      calls.push({ url: typeof input === "string" ? input : input?.url ?? "", headers });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    installCorrelatedFetch();

    const { app, restore } = buildApp("development");
    try {
      app.get("/calls-out", async (_req, res) => {
        await fetch("https://example.test/api/thing");
        await fetch("https://example.test/api/explicit", {
          headers: { "x-request-id": "caller-set-this-explicitly" },
        });
        res.json({ ok: true });
      });
      await request(app)
        .get("/calls-out")
        .set("x-request-id", "trace-outbound-1234");

      expect(calls.length).toBe(2);
      expect(calls[0].headers["x-request-id"]).toBe("trace-outbound-1234");
      expect(calls[1].headers["x-request-id"]).toBe("caller-set-this-explicitly");
    } finally {
      globalThis.fetch = original;
      restore();
    }
  });

  it("does not attach a header when there is no ALS correlation context", async () => {
    const { installCorrelatedFetch } = await import("../utils/correlatedFetch");
    const calls: Record<string, string>[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: any, init?: any) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k.toLowerCase()] = v));
      calls.push(headers);
      return new Response("{}", { status: 200 });
    }) as any;
    installCorrelatedFetch();

    try {
      await fetch("https://example.test/background");
      expect(calls.length).toBe(1);
      expect(calls[0]["x-request-id"]).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("captureConsoleDuring helper", () => {
  it("intercepts console.log and console.error inside the callback and restores after", async () => {
    const { captureConsoleDuring } = await import("../utils/logger");
    const captured: string[] = [];
    // eslint-disable-next-line no-console
    const origLog = console.log;
    // eslint-disable-next-line no-console
    const origErr = console.error;

    await captureConsoleDuring(
      {
        onLog: (msg) => captured.push("LOG:" + msg),
        onError: (msg) => captured.push("ERR:" + msg),
      },
      async () => {
        // eslint-disable-next-line no-console
        console.log("inside-log");
        // eslint-disable-next-line no-console
        console.error("inside-err");
      },
    );

    expect(captured).toContain("LOG:inside-log");
    expect(captured).toContain("ERR:inside-err");
    // Restored to the pre-test originals (not necessarily identity-equal to
    // node's console.log if vitest wraps it, but at least no longer pointing
    // at our interceptor).
    // eslint-disable-next-line no-console
    expect(console.log).toBe(origLog);
    // eslint-disable-next-line no-console
    expect(console.error).toBe(origErr);
  });
});

describe("no-console regression guard", () => {
  it("scripts/codemod-console-to-logger.mjs --check reports zero violations under server/", () => {
    let exitCode = 0;
    try {
      execSync("node scripts/codemod-console-to-logger.mjs --check", {
        stdio: "pipe",
      });
    } catch (e: any) {
      exitCode = e.status ?? 1;
      // Surface what the check actually said for easier debugging.
      const out = (e.stdout?.toString?.() ?? "") + (e.stderr?.toString?.() ?? "");
      throw new Error(`no-console check failed:\n${out}`);
    }
    expect(exitCode).toBe(0);
  });
});
