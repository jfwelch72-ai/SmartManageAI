/**
 * Task #2438 — Auto-wrap async route handlers so a missed try/catch can't
 * crash the request.
 *
 * Verifies that after `installAsyncErrorShim()` runs, an Express 4 route
 * which throws asynchronously WITHOUT a try/catch and WITHOUT being
 * wrapped in `asyncHandler` is still caught by the central error
 * middleware shape we use in `server/index.ts` — i.e. the request gets
 * a sanitized 500, a `requestId`, and `persistErrorLog` /
 * `captureRequestException` are invoked.
 *
 * This is the regression net for the entire class of "hung request, no
 * Sentry event" bugs that used to require every author to remember the
 * `asyncHandler` wrapper.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

vi.mock("../services/errorLogService", () => ({
  persistErrorLog: vi.fn(async () => {}),
  pruneOldErrorLogs: vi.fn(async () => 0),
}));

vi.mock("../sentry", () => ({
  initSentry: vi.fn(() => false),
  isSentryEnabled: vi.fn(() => false),
  captureRequestException: vi.fn(),
}));

import { correlationIdMiddleware } from "../middleware/correlationId";
import { persistErrorLog } from "../services/errorLogService";
import { captureRequestException } from "../sentry";
import { logError } from "../utils/logger";
import { installAsyncErrorShim } from "../utils/expressAsyncShim";
import { asyncHandler } from "../utils/asyncHandler";

beforeAll(() => {
  // Mirror what server/index.ts does at boot. Patches the shared Express
  // Layer prototype, so this affects every router/route created in this
  // process — including the ones built inside each test below.
  installAsyncErrorShim();
});

function buildAppWithCentralErrorMiddleware(env: "development" | "production") {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = env;

  const app = express();
  app.use(correlationIdMiddleware);
  app.use(express.json());

  // Naked async handler that throws — NO try/catch, NO asyncHandler wrap.
  // Without the shim this would hang the request until supertest times
  // out. With the shim, the rejection is forwarded to next(err).
  app.get("/naked-async-boom", async (_req, _res) => {
    throw new Error("naked async kaboom");
  });

  // Same idea, but the rejection comes from an awaited promise rather
  // than a synchronous throw inside the async function body.
  app.get("/naked-async-reject", async (_req, _res) => {
    await Promise.reject(new Error("naked async rejection"));
  });

  // Sanity check: the explicit wrapper still works (and stays compatible
  // with the shim — wrapping a wrapped handler must not double-call next).
  app.get(
    "/wrapped-async-boom",
    asyncHandler(async () => {
      throw new Error("wrapped async kaboom");
    }),
  );

  // Confirm sync throws — handled by Express itself — still pass through.
  app.get("/sync-boom", (_req, _res) => {
    throw new Error("sync kaboom");
  });

  // Routes mounted on a sub-Router must also be patched, since the shim
  // mutates the Layer prototype shared by all routers.
  const sub = express.Router();
  sub.get("/router-async-boom", async (_req, _res) => {
    throw new Error("router async kaboom");
  });
  app.use("/sub", sub);

  // Successful async handler must not be affected (no double-send, no
  // spurious next() call after res.json).
  app.get("/ok-async", async (_req, res) => {
    res.json({ ok: true });
  });

  // Mirror of the central error middleware in server/index.ts. Kept in
  // sync intentionally — the test asserts both the wire shape AND the
  // observability side-effects (errorLog row + Sentry capture).
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isServerError = status >= 500;
    const isProdEnv = process.env.NODE_ENV === "production";
    const clientMessage = isServerError
      ? "Internal Server Error"
      : err.message || "Bad Request";
    const requestId = (req as any).id;
    const errObj = err instanceof Error ? err : new Error(String(err));

    logError(
      "Unhandled error in request",
      { method: req.method, path: req.path, requestId, statusCode: status },
      errObj,
    );

    persistErrorLog({
      level: isServerError ? "error" : "warn",
      message: errObj.message,
      stack: errObj.stack,
      method: req.method,
      path: req.path,
      statusCode: status,
      requestId,
    });

    if (isServerError) captureRequestException(errObj, req, requestId);

    if (res.headersSent) return;
    const body: Record<string, unknown> = { success: false, error: clientMessage };
    if (requestId) body.requestId = requestId;
    if (!isProdEnv) body.stack = errObj.stack;
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

describe("installAsyncErrorShim — async rejections reach the central error middleware", () => {
  beforeEach(() => {
    vi.mocked(persistErrorLog).mockClear();
    vi.mocked(captureRequestException).mockClear();
  });

  it("catches a naked `async` handler that throws (no try/catch, no asyncHandler wrap)", async () => {
    const { app, restore } = buildAppWithCentralErrorMiddleware("production");
    try {
      const res = await request(app).get("/naked-async-boom");
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        success: false,
        error: "Internal Server Error",
      });
      expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.error).not.toContain("kaboom");
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
      expect(persistErrorLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          message: "naked async kaboom",
          statusCode: 500,
        }),
      );
      expect(captureRequestException).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("catches a naked `async` handler that awaits a rejecting promise", async () => {
    const { app, restore } = buildAppWithCentralErrorMiddleware("development");
    try {
      const res = await request(app).get("/naked-async-reject");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal Server Error");
      // Dev mode should still surface the stack for triage.
      expect(typeof res.body.stack).toBe("string");
      expect(res.body.stack).toContain("naked async rejection");
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("still forwards rejections from explicitly-wrapped asyncHandler routes (shim composes safely)", async () => {
    const { app, restore } = buildAppWithCentralErrorMiddleware("production");
    try {
      const res = await request(app).get("/wrapped-async-boom");
      expect(res.status).toBe(500);
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
      expect(captureRequestException).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("does not regress synchronous throws (Express handles those natively)", async () => {
    const { app, restore } = buildAppWithCentralErrorMiddleware("production");
    try {
      const res = await request(app).get("/sync-boom");
      expect(res.status).toBe(500);
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("patches handlers mounted on a sub-Router (Layer prototype is shared)", async () => {
    const { app, restore } = buildAppWithCentralErrorMiddleware("production");
    try {
      const res = await request(app).get("/sub/router-async-boom");
      expect(res.status).toBe(500);
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("does not interfere with successful async responses", async () => {
    const { app, restore } = buildAppWithCentralErrorMiddleware("production");
    try {
      const res = await request(app).get("/ok-async");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(persistErrorLog).not.toHaveBeenCalled();
      expect(captureRequestException).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("is idempotent — calling installAsyncErrorShim again does not double-wrap", async () => {
    installAsyncErrorShim();
    installAsyncErrorShim();
    const { app, restore } = buildAppWithCentralErrorMiddleware("production");
    try {
      const res = await request(app).get("/naked-async-boom");
      expect(res.status).toBe(500);
      // If the patch ran twice, persistErrorLog could be invoked more than
      // once for a single request (or next() would fire twice).
      expect(persistErrorLog).toHaveBeenCalledTimes(1);
      expect(captureRequestException).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
