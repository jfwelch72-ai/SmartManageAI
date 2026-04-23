/**
 * Task #1287 — verify the SWPPP overdue email footer carries a signed
 * one-click mute link, and that the mute endpoint:
 *   1. Refuses tampered/missing tokens
 *   2. Only mutes the user encoded in the token (no cross-tenant abuse)
 *   3. Disables both email and in-app delivery for SWPPP overdue alerts
 *   4. Redirects to the settings page anchored to the SWPPP toggle
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-swppp-mute";
process.env.APP_BASE_URL = "https://app.test.example";

const insertedByTable: Record<string, unknown[]> = {};
const upsertSetByTable: Record<string, unknown[]> = {};
const upsertTargetByTable: Record<string, unknown[]> = {};

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

function makeInsertChain(t: unknown) {
  const tName = tableName(t);
  const chain: Record<string, unknown> = {};
  chain.values = (vals: unknown) => {
    (insertedByTable[tName] ??= []).push(vals);
    chain.onConflictDoUpdate = (cfg: { target: unknown; set: unknown }) => {
      (upsertTargetByTable[tName] ??= []).push(cfg.target);
      (upsertSetByTable[tName] ??= []).push(cfg.set);
      return Promise.resolve();
    };
    chain.returning = async () => [vals];
    return chain;
  };
  return chain;
}

const dbMock = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }),
  insert: (t: unknown) => makeInsertChain(t),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));
vi.mock("../auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

beforeEach(() => {
  for (const k of Object.keys(insertedByTable)) delete insertedByTable[k];
  for (const k of Object.keys(upsertSetByTable)) delete upsertSetByTable[k];
  for (const k of Object.keys(upsertTargetByTable)) delete upsertTargetByTable[k];
});

describe("SWPPP overdue email — one-click mute footer", () => {
  it("renders an HTML body with a signed mute link bound to the recipient", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const { verifySwpppMuteToken } = await import("../utils/swpppMuteToken");

    const result = composeEmailContent({
      id: "n1",
      userId: "user-recipient-1",
      type: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      title: "SWPPP corrective action overdue",
      message: "I-95 — Repair silt fence (3 days overdue)",
      relatedEntityType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      relatedEntityId: "insp-42",
    });

    expect(result.html).toBeDefined();
    expect(result.html).toContain("/api/notifications/mute/swppp-overdue?token=");
    expect(result.html).toContain("/settings/notifications#section-swppp-overdue-prefs");
    expect(result.html).toContain("Mute SWPPP overdue alerts");

    const tokenMatch = result.html!.match(/mute\/swppp-overdue\?token=([^"&]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = decodeURIComponent(tokenMatch![1]);
    const payload = verifySwpppMuteToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-recipient-1");
    expect(payload!.scope).toBe("mute_swppp_overdue");
  });

  it("preserves the existing action button + actionUrl shape", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      title: "SWPPP overdue",
      message: "Project — overdue.",
      relatedEntityType: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      relatedEntityId: "insp-1",
    });
    expect(result.actionUrl).toContain("/swppp-inspections?inspectionId=insp-1");
    expect(result.actionText).toBe("Open SWPPP Inspection");
    expect(result.subject).toContain("SWPPP Corrective Action Overdue");
  });
});

describe("GET /api/notifications/mute/swppp-overdue", () => {
  async function loadRoute() {
    const mod = await import("../notificationPreferencesRoutes");
    return mod.default;
  }

  function makeReqRes(token: string | undefined) {
    const req: any = { query: token === undefined ? {} : { token } };
    let redirected: string | null = null;
    let statusCode = 200;
    const res: any = {
      redirect: (url: string) => { redirected = url; },
      status: (code: number) => { statusCode = code; return res; },
      json: () => res,
    };
    return { req, res, get redirected() { return redirected; }, get statusCode() { return statusCode; } };
  }

  function findHandler(router: any) {
    for (const layer of router.stack) {
      if (layer.route?.path === "/api/notifications/mute/swppp-overdue") {
        return layer.route.stack[0].handle;
      }
    }
    throw new Error("mute route not found");
  }

  it("rejects an unsigned/garbage token by redirecting with mute=invalid", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const ctx = makeReqRes("not-a-real-token");
    await handler(ctx.req, ctx.res, () => {});
    expect(ctx.redirected).toBe("/settings/notifications?mute=invalid#section-swppp-overdue-prefs");
    expect(insertedByTable["notification_type_prefs"] ?? []).toHaveLength(0);
  });

  it("rejects a missing token", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const ctx = makeReqRes(undefined);
    await handler(ctx.req, ctx.res, () => {});
    expect(ctx.redirected).toBe("/settings/notifications?mute=invalid#section-swppp-overdue-prefs");
  });

  it("on a valid token, upserts the user's per-type prefs to disable email + in-app", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const { signSwpppMuteToken } = await import("../utils/swpppMuteToken");
    const token = signSwpppMuteToken("user-target-99");

    const ctx = makeReqRes(token);
    await handler(ctx.req, ctx.res, () => {});

    expect(ctx.redirected).toBe("/settings/notifications?muted=swppp_overdue#section-swppp-overdue-prefs");

    const inserts = insertedByTable["notification_type_prefs"] ?? [];
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.userId).toBe("user-target-99");
    expect(row.notificationType).toBe("SWPPP_OVERDUE_CORRECTIVE_ACTION");
    expect(row.emailEnabled).toBe(false);
    expect(row.inAppEnabled).toBe(false);

    const sets = upsertSetByTable["notification_type_prefs"] ?? [];
    expect(sets).toHaveLength(1);
    const setPayload = sets[0] as Record<string, unknown>;
    expect(setPayload.emailEnabled).toBe(false);
    expect(setPayload.inAppEnabled).toBe(false);
  });

  it("a token signed for user A cannot mute user B", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const { signSwpppMuteToken } = await import("../utils/swpppMuteToken");
    const token = signSwpppMuteToken("user-A");

    const ctx = makeReqRes(token);
    await handler(ctx.req, ctx.res, () => {});

    const inserts = insertedByTable["notification_type_prefs"] ?? [];
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as Record<string, unknown>).userId).toBe("user-A");
  });
});
