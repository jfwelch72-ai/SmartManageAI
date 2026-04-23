/**
 * Task #1408 — verify the WAGE_DECISION_RATES_CHANGED email footer
 * carries a signed one-click mute link, and that the mute endpoint:
 *   1. Refuses tampered/missing tokens
 *   2. Only mutes the user encoded in the token (no cross-tenant abuse)
 *   3. Disables both email and in-app delivery for
 *      WAGE_DECISION_RATES_CHANGED
 *   4. Redirects to the settings page anchored to the per-type toggle
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-wdrc-mute";
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

describe("WAGE_DECISION_RATES_CHANGED email — one-click mute footer", () => {
  it("renders an HTML body with a signed mute link bound to the recipient", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const { verifyWageDecisionRatesChangedMuteToken } = await import(
      "../utils/wageDecisionRatesChangedMuteToken"
    );

    const result = composeEmailContent({
      id: "n1",
      userId: "user-recipient-1",
      type: "WAGE_DECISION_RATES_CHANGED",
      title: "Davis-Bacon wage rates changed",
      message: "Wage decision CA20260111 rates changed for Project Foo.",
      relatedEntityType: "project",
      relatedEntityId: "project-42",
    });

    expect(result.html).toBeDefined();
    expect(result.html).toContain("/api/notifications/mute/wage-decision-rates-changed?token=");
    expect(result.html).toContain("/settings/notifications#section-wage-decision-rates-changed-prefs");
    expect(result.html).toContain("Mute wage rate change alerts (email + in-app)");

    const tokenMatch = result.html!.match(/mute\/wage-decision-rates-changed\?token=([^"&]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = decodeURIComponent(tokenMatch![1]);
    const payload = verifyWageDecisionRatesChangedMuteToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-recipient-1");
    expect(payload!.scope).toBe("mute_wage_decision_rates_changed");
  });

  it("preserves the existing action button + actionUrl shape", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "WAGE_DECISION_RATES_CHANGED",
      title: "Davis-Bacon wage rates changed",
      message: "CA20260111 rates changed.",
      relatedEntityType: "project",
      relatedEntityId: "project-1",
    });
    expect(result.actionUrl).toContain("/projects/project-1");
    expect(result.actionText).toBe("Open Prevailing Wage Panel");
    expect(result.subject).toContain("Davis-Bacon wage rates changed");
  });

  it("rejects a Davis-Bacon-auto-sync mute token (scope-locked)", async () => {
    const { signDavisBaconMuteToken } = await import("../utils/davisBaconMuteToken");
    const { verifyWageDecisionRatesChangedMuteToken } = await import(
      "../utils/wageDecisionRatesChangedMuteToken"
    );
    const wrongScope = signDavisBaconMuteToken("user-A");
    expect(verifyWageDecisionRatesChangedMuteToken(wrongScope)).toBeNull();
  });
});

describe("GET /api/notifications/mute/wage-decision-rates-changed", () => {
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
      if (layer.route?.path === "/api/notifications/mute/wage-decision-rates-changed") {
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
    expect(ctx.redirected).toBe(
      "/settings/notifications?mute=invalid#section-wage-decision-rates-changed-prefs",
    );
    expect(insertedByTable["notification_type_prefs"] ?? []).toHaveLength(0);
  });

  it("rejects a missing token", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const ctx = makeReqRes(undefined);
    await handler(ctx.req, ctx.res, () => {});
    expect(ctx.redirected).toBe(
      "/settings/notifications?mute=invalid#section-wage-decision-rates-changed-prefs",
    );
  });

  it("rejects a token signed with a different scope (Davis-Bacon auto-sync)", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const { signDavisBaconMuteToken } = await import("../utils/davisBaconMuteToken");
    const wrongScopeToken = signDavisBaconMuteToken("user-X");
    const ctx = makeReqRes(wrongScopeToken);
    await handler(ctx.req, ctx.res, () => {});
    expect(ctx.redirected).toBe(
      "/settings/notifications?mute=invalid#section-wage-decision-rates-changed-prefs",
    );
    expect(insertedByTable["notification_type_prefs"] ?? []).toHaveLength(0);
  });

  it("on a valid token, upserts the user's per-type prefs to disable email + in-app", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const { signWageDecisionRatesChangedMuteToken } = await import(
      "../utils/wageDecisionRatesChangedMuteToken"
    );
    const token = signWageDecisionRatesChangedMuteToken("user-target-99");

    const ctx = makeReqRes(token);
    await handler(ctx.req, ctx.res, () => {});

    expect(ctx.redirected).toBe(
      "/settings/notifications?muted=wage_decision_rates_changed#section-wage-decision-rates-changed-prefs",
    );

    const inserts = insertedByTable["notification_type_prefs"] ?? [];
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.userId).toBe("user-target-99");
    expect(row.notificationType).toBe("WAGE_DECISION_RATES_CHANGED");
    expect(row.emailEnabled).toBe(false);
    expect(row.inAppEnabled).toBe(false);

    const sets = upsertSetByTable["notification_type_prefs"] ?? [];
    expect(sets).toHaveLength(1);
    const setPayload = sets[0] as Record<string, unknown>;
    expect(setPayload.emailEnabled).toBe(false);
    expect(setPayload.inAppEnabled).toBe(false);
  });

  it("a token signed for user A only mutes user A (no cross-tenant abuse)", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const { signWageDecisionRatesChangedMuteToken } = await import(
      "../utils/wageDecisionRatesChangedMuteToken"
    );
    const token = signWageDecisionRatesChangedMuteToken("user-A");

    // Even if the request also contained an unrelated `userId` body or
    // header, the route MUST derive the muted user solely from the
    // signed token. Mimic that by adding extra fields and confirming
    // they do not influence the upsert payload.
    const ctx = makeReqRes(token);
    (ctx.req as any).body = { userId: "user-B" };
    (ctx.req as any).headers = { "x-impersonate-user": "user-B" };
    await handler(ctx.req, ctx.res, () => {});

    const inserts = insertedByTable["notification_type_prefs"] ?? [];
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as Record<string, unknown>).userId).toBe("user-A");
    expect((inserts[0] as Record<string, unknown>).userId).not.toBe("user-B");
  });
});
