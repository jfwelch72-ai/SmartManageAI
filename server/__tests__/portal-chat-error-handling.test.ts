import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

// Stub portalAuth so the request reaches the route handler with a fake token.
vi.mock("../portalAuth", () => ({
  requirePortalAuth: (req: any, _res: any, next: any) => {
    req.portalToken = {
      id: "tok-test",
      organizationId: "org-test",
      projectId: "proj-test",
      crmOrganisationId: "crm-test",
      contactEmail: "x@test.local",
      contactName: "Test",
      permissions: [],
    };
    next();
  },
}));

// Stub portalRoutes (subChatRoutes imports notifyChatTeamMembers from it) to
// avoid pulling in the full module graph.
vi.mock("../portalRoutes", () => ({
  notifyChatTeamMembers: () => {},
}));

vi.mock("../portalChatEvents", () => ({
  registerPortalSseClient: () => () => {},
  emitPortalChatMessage: () => {},
  emitPortalChatThreadUpdate: () => {},
}));

vi.mock("../services/storageKeyOwnership", () => ({
  assertPortalAttachmentUrlAllowed: async () => {},
}));

// Force every db query to throw so we hit the catch block.
vi.mock("../db", () => {
  const thrower = () => {
    throw new Error("simulated db failure");
  };
  const builder: any = new Proxy(
    {},
    {
      get: () => {
        return (..._args: any[]) => builder;
      },
    },
  );
  // Make the proxy thenable so awaiting it triggers the simulated failure.
  builder.then = (_resolve: any, reject: any) => reject(new Error("simulated db failure"));
  return {
    db: {
      select: thrower,
      insert: thrower,
      update: thrower,
      delete: thrower,
    },
  };
});

// Likewise for clientChatRoutes auth path which queries clientPortalAccess directly.
// Same db mock above covers it.

let app: Express;

beforeAll(async () => {
  const express = (await import("express")).default;
  const subChatRouter = (await import("../subChatRoutes")).default;
  const clientChatRouter = (await import("../clientChatRoutes")).default;

  app = express();
  app.use(express.json());
  app.use(subChatRouter);
  app.use(clientChatRouter);

  // Mirror the global error handler shape from server/index.ts so a thrown
  // error inside a handler — when forwarded via next(error) — produces a JSON
  // 500 instead of a default HTML crash response.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const clientMessage =
      status >= 500 ? "Internal Server Error" : err?.message || "Internal Server Error";
    if (!res.headersSent) {
      res.status(status).json({ error: clientMessage });
    }
  });
});

describe("portal/client chat error handling", () => {
  it("subChatRoutes: GET /portal/chat/threads returns JSON 500 when db throws (does not ReferenceError on `next`)", async () => {
    const res = await request(app).get("/portal/chat/threads");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error" });
    expect(res.text).not.toMatch(/ReferenceError/);
    expect(res.text).not.toMatch(/next is not defined/);
  });

  it("subChatRoutes: POST /portal/chat/threads returns JSON 500 when db throws", async () => {
    const res = await request(app)
      .post("/portal/chat/threads")
      .send({ subject: "hi", message: "hello" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error" });
  });

  it("clientChatRoutes: GET /client-portal/chat/threads returns JSON 500/401 on db failure (no ReferenceError)", async () => {
    const res = await request(app)
      .get("/client-portal/chat/threads")
      .set("x-client-email", "client@test.local")
      .set("x-client-project-id", "proj-test");
    // The auth middleware itself catches and forwards the db failure via next(error),
    // so we expect a clean JSON 500 — not a ReferenceError crash.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error" });
    expect(res.text).not.toMatch(/ReferenceError/);
    expect(res.text).not.toMatch(/next is not defined/);
  });
});
