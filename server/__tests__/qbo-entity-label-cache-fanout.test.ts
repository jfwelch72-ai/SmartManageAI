// Task #1976 — When an INTEGRATION_SYNC_RETRIES_EXHAUSTED notification
// fans out to multiple admin recipients, the per-batch QBO label cache
// installed by deliverNotifications must collapse the lookup so
// resolveQboEntityLabel runs once per (organizationId, entityType) pair
// instead of once per recipient.
//
// Without the cache, an org with 5 admins × 20 failed rows would produce
// 100 redundant resolver calls for the same 20 records. With it, that
// same fan-out only resolves each distinct entityType once.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- DB stub: parallel deliverNotification calls share the mock, so we
// can't rely on a strict queue order. Instead the chain detects which
// table is being queried via its .from() argument and returns a canned
// row appropriate for that table. The QBO label resolver itself is
// stubbed out via __qboEntityLabelInternals below — its db calls never
// reach this mock.
type Row = Record<string, unknown>;
type SelectShape = { __table?: string };

const tableRows: Record<string, Row[]> = {};
function setTableRows(table: string, rows: Row[]): void {
  tableRows[table] = rows;
}

function tableNameOf(arg: unknown): string {
  if (!arg || typeof arg !== "object") return "unknown";
  // Drizzle exposes the table via Symbol-keyed metadata; for the in-memory
  // schema imports (users, etc.) we just compare object identity through
  // the registry below.
  const entry = tableRegistry.get(arg as object);
  return entry ?? "unknown";
}

const tableRegistry = new WeakMap<object, string>();

function makeSelectChain(): SelectShape & {
  from: (t: unknown) => unknown;
  where: () => unknown;
  limit: () => unknown;
  orderBy: () => unknown;
  innerJoin: () => unknown;
  leftJoin: () => unknown;
  then: (resolve: (v: Row[]) => unknown) => Promise<unknown>;
} {
  const chain = {} as SelectShape & Record<string, unknown>;
  chain.from = (t: unknown) => {
    chain.__table = tableNameOf(t);
    return chain;
  };
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.then = (resolve: (v: Row[]) => unknown) => {
    const rows = tableRows[chain.__table ?? "unknown"] ?? [];
    return Promise.resolve(rows).then(resolve);
  };
  return chain as ReturnType<typeof makeSelectChain>;
}

const dbMock = {
  select: () => makeSelectChain(),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

// --- Side-effect mocks: keep email/sms/push/etc inert.
const sendEmailMock = vi.fn(async () => true);
vi.mock("../services/emailService", () => ({
  sendEmail: sendEmailMock,
  sendEmailWithResult: vi.fn(async () => ({ success: true })),
  sendNotificationEmail: vi.fn(async () => true),
}));
vi.mock("../email", () => ({
  sendNotificationEmail: vi.fn(async () => true),
}));
vi.mock("../services/pushService", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../services/nativePushService", () => ({ sendNativePushToUser: vi.fn() }));
vi.mock("../services/smsService", () => ({
  sendSms: vi.fn(),
  isTwilioConfigured: () => false,
}));
vi.mock("../services/teamsService", () => ({ sendTeamsMessage: vi.fn() }));
vi.mock("../services/slackService", () => ({ sendSlackMessage: vi.fn() }));
vi.mock("../services/featureAccess", () => ({ hasFeature: vi.fn(async () => false) }));
vi.mock("../services/featureFlagService", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

// --- The whole point of the test: spy on resolveQboEntityLabel via the
// `__qboEntityLabelInternals` indirection that the cached variant uses.
// We can't simply vi.mock the resolveQboEntityLabel export because the
// cached helper lives in the same module and ESM live bindings don't
// re-route an in-module function call through the mocked export.
const resolveQboEntityLabelMock = vi.fn(async (_orgId: string, entityType: string) => ({
  subKind: "invoice" as const,
  itemId: entityType.split(":").pop() || "x",
  displayName: `Pay app for ${entityType}`,
  link: `/progress-billing?payApplicationId=x`,
}));

let deliverNotifications: typeof import("../services/notificationDelivery")["deliverNotifications"];
let internals: typeof import("../services/qboEntityLabels")["__qboEntityLabelInternals"];
let originalResolve: typeof internals["resolve"];

beforeEach(async () => {
  for (const k of Object.keys(tableRows)) delete tableRows[k];
  sendEmailMock.mockClear();
  resolveQboEntityLabelMock.mockClear();
  vi.resetModules();
  ({ deliverNotifications } = await import("../services/notificationDelivery"));
  ({ __qboEntityLabelInternals: internals } = await import(
    "../services/qboEntityLabels"
  ));
  originalResolve = internals.resolve;
  internals.resolve = resolveQboEntityLabelMock as typeof internals.resolve;

  // Register the schema tables under their export names so the .from()
  // call in deliverNotification can be matched back to a canned row set.
  const schema = await import("@shared/schema");
  tableRegistry.set(schema.users as object, "users");
  tableRegistry.set(schema.notificationChannelPrefs as object, "notificationChannelPrefs");
  tableRegistry.set(schema.notificationTypePrefs as object, "notificationTypePrefs");
  tableRegistry.set(schema.integrationSyncState as object, "integrationSyncState");
});

afterEach(() => {
  if (internals && originalResolve) internals.resolve = originalResolve;
});

function configureMockDb(opts: { entityType: string; provider: string }): void {
  setTableRows("users", [{
    email: "admin@example.com",
    phone: null,
    organizationId: "org-1",
    integrationSyncExhaustedEmailOptOut: false,
  }]);
  setTableRows("notificationChannelPrefs", [{
    emailEnabled: true, smsEnabled: false, pushEnabled: false,
    teamsEnabled: false, slackEnabled: false,
    smsPhoneNumber: null, teamsWebhookUrl: null, slackWebhookUrl: null,
  }]);
  setTableRows("notificationTypePrefs", []);
  setTableRows("integrationSyncState", [{
    connectionId: "conn-qbo",
    organizationId: "org-1",
    entityType: opts.entityType,
    provider: opts.provider,
    displayName: "QuickBooks Online",
  }]);
}

describe("Task #1976 — per-batch QBO label cache", () => {
  it("invokes resolveQboEntityLabel once per (org, entityType) when the same notification fans out to N recipients", async () => {
    const recipients = 5;
    configureMockDb({ entityType: "qbo_sync:invoice:inv-7", provider: "qbo" });

    const notifications = Array.from({ length: recipients }, (_, i) => ({
      id: `n-${i}`,
      userId: `u-${i}`,
      type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED" as const,
      title: "Integration sync gave up: QuickBooks Online — Invoice inv-7 (qbo_sync:invoice:inv-7)",
      message: "QuickBooks ran out of automatic retries while syncing this invoice (id inv-7).",
      relatedEntityId: "sync-state-42",
      relatedEntityType: "INTEGRATION_SYNC_STATE",
    }));

    await deliverNotifications(notifications);

    // Without the cache we'd see one call per recipient (5).
    // With it, the same (org, entityType) pair only resolves once.
    expect(resolveQboEntityLabelMock).toHaveBeenCalledTimes(1);
    expect(resolveQboEntityLabelMock).toHaveBeenCalledWith(
      "org-1",
      "qbo_sync:invoice:inv-7",
    );
  });

  it("resolveQboEntityLabelCached collapses duplicate (org, entityType) pairs and bypasses the cache when none is supplied", async () => {
    const { resolveQboEntityLabelCached, createQboEntityLabelCache } = await import(
      "../services/qboEntityLabels"
    );

    // Same cache, same key called 4 times: only one underlying invocation.
    const cache = createQboEntityLabelCache();
    await Promise.all([
      resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-1", cache),
      resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-1", cache),
      resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-1", cache),
      resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-1", cache),
    ]);
    expect(resolveQboEntityLabelMock).toHaveBeenCalledTimes(1);

    // Distinct (org, entityType) pairs add one call each.
    await Promise.all([
      resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-2", cache),
      resolveQboEntityLabelCached("org-2", "qbo_sync:invoice:inv-1", cache),
    ]);
    expect(resolveQboEntityLabelMock).toHaveBeenCalledTimes(3);

    // Without a cache, the helper degrades to a passthrough.
    resolveQboEntityLabelMock.mockClear();
    await resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-1");
    await resolveQboEntityLabelCached("org-1", "qbo_sync:invoice:inv-1");
    expect(resolveQboEntityLabelMock).toHaveBeenCalledTimes(2);
  });
});
