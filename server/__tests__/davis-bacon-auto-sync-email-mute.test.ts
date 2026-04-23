/**
 * Task #1361 — verify the Davis-Bacon auto-sync failure email footer
 * carries a signed one-click mute link, and that the mute endpoint:
 *   1. Refuses tampered/missing tokens
 *   2. Only mutes the user encoded in the token (no cross-tenant abuse)
 *   3. Disables both email and in-app delivery for
 *      DAVIS_BACON_AUTO_SYNC_FAILED
 *   4. Redirects to the settings page anchored to the per-type toggle
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-dba-mute";
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

describe("Davis-Bacon auto-sync failure email — one-click mute footer", () => {
  it("renders an HTML body with a signed mute link bound to the recipient", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const { verifyDavisBaconMuteToken } = await import("../utils/davisBaconMuteToken");

    const result = composeEmailContent({
      id: "n1",
      userId: "user-recipient-1",
      type: "DAVIS_BACON_AUTO_SYNC_FAILED",
      title: "Davis-Bacon auto-sync failed",
      message: "Automatic sync for wage decision CA20260111 failed: SAM.gov is down.",
      relatedEntityType: "INTEGRATION_CONNECTION",
      relatedEntityId: "conn-42",
    });

    expect(result.html).toBeDefined();
    expect(result.html).toContain("/api/notifications/mute/davis-bacon-auto-sync-failed?token=");
    expect(result.html).toContain("/settings/notifications#section-davis-bacon-auto-sync-failed-prefs");
    expect(result.html).toContain("Mute Davis-Bacon auto-sync failure alerts (email + in-app)");

    const tokenMatch = result.html!.match(/mute\/davis-bacon-auto-sync-failed\?token=([^"&]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = decodeURIComponent(tokenMatch![1]);
    const payload = verifyDavisBaconMuteToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-recipient-1");
    expect(payload!.scope).toBe("mute_davis_bacon_auto_sync_failed");
  });

  it("preserves the existing action button + actionUrl shape", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const result = composeEmailContent({
      id: "n1",
      userId: "u1",
      type: "DAVIS_BACON_AUTO_SYNC_FAILED",
      title: "Davis-Bacon auto-sync failed",
      message: "CA20260111 failed.",
      relatedEntityType: "INTEGRATION_CONNECTION",
      relatedEntityId: "conn-1",
    });
    expect(result.actionUrl).toContain("/integrations?provider=dol_davis_bacon");
    expect(result.actionText).toBe("Open Integrations");
    expect(result.subject).toContain("Davis-Bacon");
  });
});

describe("GET /api/notifications/mute/davis-bacon-auto-sync-failed", () => {
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
      if (layer.route?.path === "/api/notifications/mute/davis-bacon-auto-sync-failed") {
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
    expect(ctx.redirected).toBe("/settings/notifications?mute=invalid#section-davis-bacon-auto-sync-failed-prefs");
    expect(insertedByTable["notification_type_prefs"] ?? []).toHaveLength(0);
  });

  it("rejects a missing token", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const ctx = makeReqRes(undefined);
    await handler(ctx.req, ctx.res, () => {});
    expect(ctx.redirected).toBe("/settings/notifications?mute=invalid#section-davis-bacon-auto-sync-failed-prefs");
  });

  it("on a valid token, upserts the user's per-type prefs to disable email + in-app", async () => {
    const router = await loadRoute();
    const handler = findHandler(router);
    const { signDavisBaconMuteToken } = await import("../utils/davisBaconMuteToken");
    const token = signDavisBaconMuteToken("user-target-99");

    const ctx = makeReqRes(token);
    await handler(ctx.req, ctx.res, () => {});

    expect(ctx.redirected).toBe("/settings/notifications?muted=davis_bacon_auto_sync_failed#section-davis-bacon-auto-sync-failed-prefs");

    const inserts = insertedByTable["notification_type_prefs"] ?? [];
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.userId).toBe("user-target-99");
    expect(row.notificationType).toBe("DAVIS_BACON_AUTO_SYNC_FAILED");
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
    const { signDavisBaconMuteToken } = await import("../utils/davisBaconMuteToken");
    const token = signDavisBaconMuteToken("user-A");

    const ctx = makeReqRes(token);
    await handler(ctx.req, ctx.res, () => {});

    const inserts = insertedByTable["notification_type_prefs"] ?? [];
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as Record<string, unknown>).userId).toBe("user-A");
  });
});

// Real-behavior test for the coalescing window. Uses fake timers to
// advance past the window without sleeping, and a vi.mock spy on
// `insertNotification` so we can count exactly how many notifications
// the public helper actually emits.
const insertNotificationMock = vi.fn(async () => undefined);
vi.mock("../services/notificationService", () => ({
  insertNotification: insertNotificationMock,
  insertNotifications: vi.fn(async () => undefined),
}));
vi.mock("../integrations/encryption", () => ({
  decryptMetadata: (m: unknown) => m,
}));

describe("notifyDavisBaconAutoSyncFailure — coalescing window", () => {
  beforeEach(() => {
    insertNotificationMock.mockClear();
  });

  it("sends the first failure, suppresses repeats inside the window, and re-sends after the window with a count suffix", async () => {
    vi.useFakeTimers();
    try {
      const sync = await import("../integrations/providers/dol_davis_bacon/sync");
      sync.__resetDavisBaconFailureCoalesceForTests();

      const connection = {
        id: "conn-coalesce-1",
        organizationId: "org-1",
        createdByUserId: "owner-1",
        provider: "dol_davis_bacon",
        status: "active",
        metadata: { apiKey: "k" },
      } as any;

      // First failure → delivered.
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260999", "boom-1");
      expect(insertNotificationMock).toHaveBeenCalledTimes(1);
      const firstCall = insertNotificationMock.mock.calls[0][0] as Record<string, unknown>;
      expect(firstCall.userId).toBe("owner-1");
      expect((firstCall.message as string)).not.toContain("failures in the last hour");

      // Two more failures inside the 1-hour window → suppressed.
      vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000));
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260999", "boom-2");
      vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260999", "boom-3");
      expect(insertNotificationMock).toHaveBeenCalledTimes(1);

      // A failure for a *different* decision under the same connection is
      // tracked separately and goes through immediately.
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260000", "different");
      expect(insertNotificationMock).toHaveBeenCalledTimes(2);

      // Advance past the window → next failure for CA20260999 delivered
      // with a count suffix indicating how many attempts were absorbed.
      vi.setSystemTime(new Date(Date.now() + 61 * 60 * 1000));
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260999", "boom-4");
      expect(insertNotificationMock).toHaveBeenCalledTimes(3);
      const lastCall = insertNotificationMock.mock.calls[2][0] as Record<string, unknown>;
      expect(lastCall.message as string).toMatch(/failures in the last hour/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing (and does not crash) when the connection has no createdByUserId", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();
    const connection = {
      id: "conn-no-owner",
      organizationId: "org-2",
      createdByUserId: null,
      metadata: {},
    } as any;
    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA-X", "no owner");
    expect(insertNotificationMock).not.toHaveBeenCalled();
  });
});
