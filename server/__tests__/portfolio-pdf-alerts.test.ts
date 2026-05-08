import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { getTableName } from "drizzle-orm";
import {
  portfolioPdfAlertRecipients,
  portfolioPdfAlertDeliveries,
  users,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Logger mock — silence noise from production code paths under test.
// ---------------------------------------------------------------------------
vi.mock("../utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DB mock — every persistence path in portfolio-pdf-alerts.ts and
// portfolio-pdf-service.ts goes through `../db`. We never want a real
// connection in these unit tests, so the mock returns programmable rows
// and captures writes.
// ---------------------------------------------------------------------------
interface DbState {
  recipientRows: any[][];
  userRows: any[][];
  insertedDeliveries: any[];
  insertDeliveryShouldThrow: boolean;
  selectedFromTables: string[];
}

const dbState: DbState = {
  recipientRows: [],
  userRows: [],
  insertedDeliveries: [],
  insertDeliveryShouldThrow: false,
  selectedFromTables: [],
};

// FIFO queues for the various select() shapes. If the queue holds more than
// one entry the next call shifts the head (lets us model multi-step flows
// like "DB empty → fall through to env/admins"). Once down to a single
// entry that entry is kept and returned for every subsequent call, which
// matches the real DB behaviour where the same recipient list is read
// multiple times during a single dispatch.
function takeNext<T>(queue: T[][]): T[] {
  if (queue.length === 0) return [] as T[];
  if (queue.length === 1) return queue[0];
  return queue.shift()!;
}

vi.mock("../db", () => {
  function selectChain(table: any) {
    const tableName = getTableName(table);
    dbState.selectedFromTables.push(tableName);
    let resolveRows: () => any[];
    if (tableName === getTableName(portfolioPdfAlertRecipients)) {
      resolveRows = () => takeNext(dbState.recipientRows);
    } else if (tableName === getTableName(users)) {
      resolveRows = () => takeNext(dbState.userRows);
    } else {
      // portfolio_pdf_render_samples or anything else — empty.
      resolveRows = () => [];
    }
    const chain: any = {
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (onF: any, onR: any) =>
        Promise.resolve(resolveRows()).then(onF, onR),
      catch: (onR: any) => Promise.resolve(resolveRows()).catch(onR),
      finally: (onFin: any) =>
        Promise.resolve(resolveRows()).finally(onFin),
    };
    return chain;
  }

  return {
    db: {
      select: vi.fn((_arg?: any) => ({
        from: vi.fn((t: any) => selectChain(t)),
      })),
      insert: vi.fn((table: any) => {
        const tableName = getTableName(table);
        return {
          values: vi.fn(async (vals: any) => {
            if (tableName === getTableName(portfolioPdfAlertDeliveries)) {
              if (dbState.insertDeliveryShouldThrow) {
                throw new Error("db-insert-fail");
              }
              dbState.insertedDeliveries.push(vals);
            }
            return undefined;
          }),
        };
      }),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        returning: vi.fn(async () => []),
      })),
    },
    pool: { end: vi.fn(async () => undefined) },
  };
});

// ---------------------------------------------------------------------------
// Email + notification mocks — track invocations so we can assert on
// recipient targeting and dispatch outcomes.
// ---------------------------------------------------------------------------
const sendEmailMock = vi.fn(async (_opts: any) => true);
vi.mock("../email", () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...(args as [any])),
}));

const insertNotificationsMock = vi.fn(async () => undefined);
vi.mock("../services/notificationService", () => ({
  insertNotifications: (...args: unknown[]) => {
    const fn = insertNotificationsMock as (...a: unknown[]) => Promise<undefined>;
    return fn(...args);
  },
}));

// ---------------------------------------------------------------------------
// Playwright mock — used for the alert-evaluation suite that needs to
// actually drive renders through portfolio-pdf-service so samples land in
// the in-memory history.
// ---------------------------------------------------------------------------
interface MockBrowser extends EventEmitter {
  __id: number;
  __connected: boolean;
  __closed: boolean;
  isConnected: () => boolean;
  newContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const launchedBrowsers: MockBrowser[] = [];
let launchCallCount = 0;
let pdfDelayMs = 0;
let nextRenderShouldFail = false;

function makeBrowser(): MockBrowser {
  launchCallCount++;
  const ee = new EventEmitter() as MockBrowser;
  ee.__id = launchCallCount;
  ee.__connected = true;
  ee.__closed = false;
  ee.isConnected = () => ee.__connected && !ee.__closed;
  ee.close = vi.fn(async () => {
    ee.__closed = true;
    ee.__connected = false;
  });
  ee.newContext = vi.fn(async () => {
    if (nextRenderShouldFail) {
      nextRenderShouldFail = false;
      throw new Error("forced-render-failure");
    }
    const page = {
      setDefaultTimeout: vi.fn(),
      route: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      pdf: vi.fn(async () => {
        if (pdfDelayMs > 0) {
          await new Promise((r) => setTimeout(r, pdfDelayMs));
        }
        return Buffer.from(`portfolio-pdf-${ee.__id}`);
      }),
    };
    return {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
  });
  launchedBrowsers.push(ee);
  return ee;
}

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => makeBrowser()),
  },
}));

const HTML = "<html><body>Portfolio</body></html>";
const RENDER_OPTS = { allowedOrigins: [] };

async function freshImport() {
  vi.resetModules();
  return {
    service: await import("../portfolio-pdf-service"),
    alerts: await import("../portfolio-pdf-alerts"),
  };
}

function resetMockState() {
  dbState.recipientRows = [];
  dbState.userRows = [];
  dbState.insertedDeliveries = [];
  dbState.insertDeliveryShouldThrow = false;
  dbState.selectedFromTables = [];
  launchedBrowsers.length = 0;
  launchCallCount = 0;
  pdfDelayMs = 0;
  nextRenderShouldFail = false;
  sendEmailMock.mockClear();
  sendEmailMock.mockImplementation(async () => true);
  insertNotificationsMock.mockClear();
  insertNotificationsMock.mockImplementation(async () => undefined);
  delete process.env.PORTFOLIO_PDF_ALERT_EMAILS;
}

// ===========================================================================
// evaluatePortfolioPdfAlerts — breach detection + cooldown
// ===========================================================================
describe("evaluatePortfolioPdfAlerts", () => {
  beforeEach(() => {
    resetMockState();
  });

  afterEach(async () => {
    const mod = await import("../portfolio-pdf-service");
    mod.__resetPortfolioPdfHistoryForTests();
    mod.setPortfolioPdfAlertDispatcher(null);
    await mod.shutdownPortfolioBrowser().catch(() => undefined);
    vi.useRealTimers();
  });

  it("does not trigger when sample count is below minSamples", async () => {
    const { service } = await freshImport();
    service.__resetPortfolioPdfHistoryForTests();
    service.updatePortfolioPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 5,
      failureRatePct: 1,
      avgDurationMs: 1,
      maxDurationMs: 1,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    service.setPortfolioPdfAlertDispatcher((e) => {
      dispatched.push(e);
    });

    // Two renders only — well below minSamples=5.
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);

    expect(dispatched).toHaveLength(0);
    expect(service.getPortfolioPdfAlertState().lastBreaches).toEqual([]);
  });

  it("triggers a FAILURE_RATE breach once minSamples is reached", async () => {
    const { service } = await freshImport();
    service.__resetPortfolioPdfHistoryForTests();
    service.updatePortfolioPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 2,
      failureRatePct: 50,
      avgDurationMs: 0, // disabled
      maxDurationMs: 0, // disabled
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    service.setPortfolioPdfAlertDispatcher((e) => {
      dispatched.push(e);
    });

    // 1 success + 1 failure = 50% failure rate, meets threshold.
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    nextRenderShouldFail = true;
    await expect(
      service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS),
    ).rejects.toThrow("forced-render-failure");

    expect(dispatched).toHaveLength(1);
    const reasons = dispatched[0].breaches.map((b: any) => b.reason);
    expect(reasons).toContain("FAILURE_RATE");
    expect(reasons).not.toContain("AVG_DURATION");
    expect(reasons).not.toContain("MAX_DURATION");
  });

  it("triggers AVG_DURATION when the windowed average crosses the threshold", async () => {
    const { service } = await freshImport();
    service.__resetPortfolioPdfHistoryForTests();
    service.updatePortfolioPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 1,
      failureRatePct: 0,
      avgDurationMs: 5,
      maxDurationMs: 0,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    service.setPortfolioPdfAlertDispatcher((e) => {
      dispatched.push(e);
    });

    pdfDelayMs = 20; // > avgDurationMs=5
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);

    expect(dispatched).toHaveLength(1);
    expect(
      dispatched[0].breaches.some((b: any) => b.reason === "AVG_DURATION"),
    ).toBe(true);
  });

  it("triggers MAX_DURATION when a single render exceeds the max threshold", async () => {
    const { service } = await freshImport();
    service.__resetPortfolioPdfHistoryForTests();
    service.updatePortfolioPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 1,
      failureRatePct: 0,
      avgDurationMs: 0,
      maxDurationMs: 5,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    service.setPortfolioPdfAlertDispatcher((e) => {
      dispatched.push(e);
    });

    pdfDelayMs = 20; // > maxDurationMs=5
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);

    expect(dispatched).toHaveLength(1);
    expect(
      dispatched[0].breaches.some((b: any) => b.reason === "MAX_DURATION"),
    ).toBe(true);
  });

  it("suppresses repeat dispatches inside the cooldown window", async () => {
    const { service } = await freshImport();
    service.__resetPortfolioPdfHistoryForTests();
    service.updatePortfolioPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 1,
      failureRatePct: 0,
      avgDurationMs: 1,
      maxDurationMs: 0,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    service.setPortfolioPdfAlertDispatcher((e) => {
      dispatched.push(e);
    });

    pdfDelayMs = 10;
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    expect(dispatched).toHaveLength(1);

    // Long cooldown — second breach must NOT dispatch.
    service.updatePortfolioPdfAlertConfig({ cooldownMs: 10 * 60 * 1000 });
    const before = dispatched.length;
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    expect(dispatched.length).toBe(before);

    // Drop cooldown — next render dispatches again.
    service.updatePortfolioPdfAlertConfig({ cooldownMs: 0 });
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    expect(dispatched.length).toBeGreaterThan(before);
  });

  it("does not dispatch when alerting is disabled", async () => {
    const { service } = await freshImport();
    service.__resetPortfolioPdfHistoryForTests();
    service.updatePortfolioPdfAlertConfig({
      enabled: false,
      minSamples: 1,
      avgDurationMs: 1,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    service.setPortfolioPdfAlertDispatcher((e) => {
      dispatched.push(e);
    });

    pdfDelayMs = 10;
    await service.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    expect(dispatched).toHaveLength(0);
  });
});

// ===========================================================================
// Recipient resolution — DB > env > SUPER_ADMIN fallback
// ===========================================================================
describe("portfolio-pdf-alerts recipient resolution", () => {
  beforeEach(() => {
    resetMockState();
  });

  afterEach(async () => {
    const mod = await import("../portfolio-pdf-alerts");
    mod.__resetPortfolioPdfAlertStateForTests();
  });

  it("prefers DB-configured recipients over env and SUPER_ADMIN fallback", async () => {
    process.env.PORTFOLIO_PDF_ALERT_EMAILS = "env-only@example.com";

    // DB recipients present (one already has userId, one needs lookup).
    dbState.recipientRows = [
      [
        {
          id: "db-1",
          email: "db-already@example.com",
          notifyInApp: true,
          userId: "user-db-1",
        },
        {
          id: "db-2",
          email: "db-needs-lookup@example.com",
          notifyInApp: false,
          userId: null,
        },
      ],
    ];
    // The lookup query for the missing userId.
    dbState.userRows = [
      [{ id: "user-db-2", email: "db-needs-lookup@example.com" }],
    ];

    const { alerts } = await freshImport();
    const cfg = await alerts.getPortfolioPdfAlertRecipientConfig();

    expect(cfg.source).toBe("database");
    expect(cfg.recipients.sort()).toEqual(
      ["db-already@example.com", "db-needs-lookup@example.com"].sort(),
    );
    // env recipients are still surfaced for reference but not used.
    expect(cfg.envRecipients).toEqual(["env-only@example.com"]);
  });

  it("falls back to PORTFOLIO_PDF_ALERT_EMAILS when no DB recipients exist", async () => {
    process.env.PORTFOLIO_PDF_ALERT_EMAILS =
      "env-a@example.com, env-b@example.com";
    dbState.recipientRows = [[]]; // empty DB list
    // The env path triggers a single users lookup for userId resolution.
    dbState.userRows = [[{ id: "user-env-a", email: "env-a@example.com" }]];

    const { alerts } = await freshImport();
    const cfg = await alerts.getPortfolioPdfAlertRecipientConfig();

    expect(cfg.source).toBe("env");
    expect(cfg.recipients.sort()).toEqual(
      ["env-a@example.com", "env-b@example.com"].sort(),
    );
  });

  it("falls back to active SUPER_ADMIN users when DB and env are both empty", async () => {
    // Two select-from-recipients calls happen on this code path:
    //   1. listDbRecipients() inside the recipient summary
    //   2. listDbRecipients() again inside getRecipients() (super_admins branch)
    dbState.recipientRows = [[], []];
    // Two select-from-users calls happen on the super_admins branch (the
    // recipient summary calls getRecipients() which queries SUPER_ADMINs).
    const admins = [
      { id: "admin-1", email: "admin1@example.com" },
      { id: "admin-2", email: "admin2@example.com" },
    ];
    dbState.userRows = [admins];

    const { alerts } = await freshImport();
    const cfg = await alerts.getPortfolioPdfAlertRecipientConfig();

    expect(cfg.source).toBe("super_admins");
    expect(cfg.recipients.sort()).toEqual(
      admins.map((a) => a.email).sort(),
    );
  });
});

// ===========================================================================
// recordDelivery + sendPortfolioPdfTestAlert
// ===========================================================================
describe("portfolio-pdf-alerts delivery recording", () => {
  beforeEach(() => {
    resetMockState();
  });

  afterEach(async () => {
    const mod = await import("../portfolio-pdf-alerts");
    mod.__resetPortfolioPdfAlertStateForTests();
  });

  it("records a successful delivery row when sendEmail succeeds", async () => {
    dbState.recipientRows = [
      [
        {
          id: "db-1",
          email: "ops@example.com",
          notifyInApp: true,
          userId: "user-1",
        },
      ],
    ];
    sendEmailMock.mockImplementation(async () => true);

    const { alerts } = await freshImport();
    const result = await alerts.sendPortfolioPdfTestAlert({
      triggeredBy: "tester@example.com",
    });

    expect(result.recipientCount).toBe(1);
    expect(result.recipients).toEqual(["ops@example.com"]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect((sendEmailMock.mock.calls[0] as unknown[])[0]).toMatchObject({
      to: ["ops@example.com"],
    });

    // recordDelivery wrote exactly one row with emailSuccess=true.
    expect(dbState.insertedDeliveries).toHaveLength(1);
    const row = dbState.insertedDeliveries[0];
    expect(row.kind).toBe("test_alert");
    expect(row.recipients).toEqual(["ops@example.com"]);
    expect(row.recipientCount).toBe(1);
    expect(row.emailSuccess).toBe(true);
    expect(row.errorMessage).toBeNull();
    expect(row.triggeredBy).toBe("tester@example.com");

    // In-app notification was created for the userId-bearing recipient.
    expect(insertNotificationsMock).toHaveBeenCalledTimes(1);
    expect((insertNotificationsMock.mock.calls[0] as unknown[])[0]).toEqual([
      expect.objectContaining({
        userId: "user-1",
        relatedEntityType: "portfolio_pdf_alert",
        relatedEntityId: "test_alert",
      }),
    ]);
  });

  it("records a failed delivery row when sendEmail throws", async () => {
    dbState.recipientRows = [
      [
        {
          id: "db-1",
          email: "ops@example.com",
          notifyInApp: false,
          userId: null,
        },
      ],
    ];
    sendEmailMock.mockImplementation(async () => {
      throw new Error("smtp-down");
    });

    const { alerts } = await freshImport();
    await alerts.sendPortfolioPdfTestAlert({ triggeredBy: null });

    expect(dbState.insertedDeliveries).toHaveLength(1);
    const row = dbState.insertedDeliveries[0];
    expect(row.kind).toBe("test_alert");
    expect(row.emailSuccess).toBe(false);
    expect(row.errorMessage).toBe("smtp-down");
    expect(row.recipientCount).toBe(1);
    // notifyInApp=false → no notification insert.
    expect(insertNotificationsMock).not.toHaveBeenCalled();
  });

  it("records a failed delivery row when sendEmail returns false", async () => {
    dbState.recipientRows = [
      [
        {
          id: "db-1",
          email: "ops@example.com",
          notifyInApp: true,
          userId: "user-1",
        },
      ],
    ];
    sendEmailMock.mockImplementation(async () => false);

    const { alerts } = await freshImport();
    await alerts.sendPortfolioPdfTestAlert({ triggeredBy: null });

    expect(dbState.insertedDeliveries).toHaveLength(1);
    const row = dbState.insertedDeliveries[0];
    expect(row.emailSuccess).toBe(false);
    expect(row.errorMessage).toBe("Email transport returned false");
  });

  it("short-circuits sendPortfolioPdfTestAlert when there are no recipients", async () => {
    // Empty DB list, no env, no SUPER_ADMINs.
    dbState.recipientRows = [[], []];
    dbState.userRows = [[]];

    const { alerts } = await freshImport();
    const result = await alerts.sendPortfolioPdfTestAlert({
      triggeredBy: "tester@example.com",
    });

    expect(result.recipientCount).toBe(0);
    expect(result.recipients).toEqual([]);
    // No email send was attempted.
    expect(sendEmailMock).not.toHaveBeenCalled();
    // A delivery row WAS recorded with the "no recipients" reason so the
    // attempt is auditable.
    expect(dbState.insertedDeliveries).toHaveLength(1);
    const row = dbState.insertedDeliveries[0];
    expect(row.kind).toBe("test_alert");
    expect(row.recipients).toEqual([]);
    expect(row.recipientCount).toBe(0);
    expect(row.emailSuccess).toBe(false);
    expect(row.errorMessage).toBe("No recipients configured");
    expect(row.triggeredBy).toBe("tester@example.com");
  });
});
