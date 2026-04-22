import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Task #1002 — companion to crm-backfill-boot-ordering.test.ts. Drives the
// real `server/index.ts` IIFE end-to-end with every heavy module mocked,
// then asserts that `resumeOrReapBackfillJobsOnBoot` is invoked STRICTLY
// AFTER `runStartupMigrations()` resolves. This catches a regression that
// would re-introduce the cold-start race even without re-adding a
// module-import-time call inside crmCallsRoutes (e.g. someone reorders
// the awaits in server/index.ts and accidentally fires recovery before
// the migration that creates `crm_transcript_backfill_jobs`).

const hoisted = vi.hoisted(() => {
  const order: {
    migrationsResolvedAt: number | null;
    recoveryCalledAt: number | null;
  } = { migrationsResolvedAt: null, recoveryCalledAt: null };
  const recoverySpy = vi.fn(async () => {
    order.recoveryCalledAt = Date.now();
  });
  const runStartupMigrationsSpy = vi.fn(async () => {
    // Hold the migration step open long enough that an out-of-order
    // recovery call would demonstrably land first if the ordering
    // contract is broken.
    await new Promise((r) => setTimeout(r, 75));
    order.migrationsResolvedAt = Date.now();
  });
  return { recoverySpy, runStartupMigrationsSpy, order };
});

vi.mock("../utils/runStartupMigrations", () => ({
  runStartupMigrations: hoisted.runStartupMigrationsSpy,
}));

vi.mock("../crmCallsRoutes", () => ({
  resumeOrReapBackfillJobsOnBoot: hoisted.recoverySpy,
  default: {},
}));

// `registerRoutes` only needs to hand back something that quacks like an
// http.Server: `.on("error", ...)` and `.listen(opts, cb)` whose callback
// fires synchronously (so we don't actually bind to a port from a test).
class FakeServer extends EventEmitter {
  listen(_opts: unknown, cb?: () => void) {
    if (typeof cb === "function") cb();
    return this;
  }
  close() {
    return this;
  }
}

vi.mock("../routes", () => ({
  registerRoutes: vi.fn(async () => new FakeServer()),
}));

vi.mock("../vite", () => ({
  setupVite: vi.fn(async () => {}),
  serveStatic: vi.fn(),
  log: vi.fn(),
}));

vi.mock("../utils/routeHelpers", () => ({
  logOAuthRedirectUris: vi.fn(),
}));

vi.mock("../csrf", () => ({
  setCsrfToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  validateCsrf: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../ai/scheduler", () => ({
  initializeAIScheduler: vi.fn(async () => {}),
}));
vi.mock("../aiNotesScheduler", () => ({
  aiNotesScheduler: { start: vi.fn() },
}));
vi.mock("../crmTaskReminderScheduler", () => ({
  crmTaskReminderScheduler: { start: vi.fn() },
}));
vi.mock("../crmCsvImportWorker", () => ({
  startCrmCsvImportWorker: vi.fn(),
}));
vi.mock("../events", () => ({
  initializeEventBus: vi.fn(),
}));
vi.mock("../storageOrphanScanJob", () => ({
  startOrphanScanScheduler: vi.fn(),
}));
vi.mock("../jobs", () => ({
  startJobRunner: vi.fn(),
}));
vi.mock("../statusProbeScheduler", () => ({
  startStatusProbeScheduler: vi.fn(),
  runProbeSweep: vi.fn(async () => {}),
}));
vi.mock("../gantt-pdf-service", () => ({
  onGanttPdfQueueFull: vi.fn(),
  onGanttPdfBrowserDisconnected: vi.fn(),
  initializeGanttPdfHistory: vi.fn(async () => {}),
}));
vi.mock("../gantt-pdf-alerts", () => ({
  reportGanttPdfQueueFull: vi.fn(),
  reportGanttPdfBrowserDisconnected: vi.fn(),
  startGanttPdfHealthMonitor: vi.fn(),
}));
vi.mock("../portfolio-pdf-service", () => ({
  checkPortfolioRendererAtStartup: vi.fn(async () => {}),
  initializePortfolioPdfHistory: vi.fn(async () => {}),
}));
vi.mock("../portfolio-pdf-alerts", () => ({
  startPortfolioPdfHealthMonitor: vi.fn(),
}));
vi.mock("../services/featureFlagService", () => ({
  backfillMissingFeatureFlags: vi.fn(async () => {}),
}));
vi.mock("../dashboardRoutes", () => ({
  seedBuiltInPresets: vi.fn(async () => {}),
}));
vi.mock("../services/errorLogService", () => ({
  persistErrorLog: vi.fn(async () => {}),
}));
vi.mock("../services/integrationStatusService", () => ({
  getIntegrationStatus: () => ({}),
}));
vi.mock("../seedProjectTemplates", () => ({
  seedSystemProjectTemplates: vi.fn(async () => {}),
}));
vi.mock("../seedDotAgencies", () => ({
  seedDotAgenciesAndSpecBooks: vi.fn(async () => {}),
}));
vi.mock("../services/notificationService", () => ({
  recoverPendingContactReassignments: vi.fn(async () => {}),
  startContactReassignmentSweeper: vi.fn(),
}));
vi.mock("../utils/devSeedFlag", () => ({
  isDevSeedEnabled: () => false,
}));

describe("CRM transcript backfill boot recovery — server/index.ts ordering (Task #993 regression)", () => {
  beforeEach(() => {
    hoisted.recoverySpy.mockClear();
    hoisted.runStartupMigrationsSpy.mockClear();
    hoisted.order.migrationsResolvedAt = null;
    hoisted.order.recoveryCalledAt = null;
  });

  it("invokes resumeOrReapBackfillJobsOnBoot exactly once and only AFTER runStartupMigrations resolves", async () => {
    vi.resetModules();
    // Importing the entry-point file kicks the IIFE that orchestrates boot.
    await import("../index");
    // Allow the IIFE's awaited migration (75ms) plus all post-listen
    // microtasks to complete.
    await new Promise((r) => setTimeout(r, 400));

    expect(hoisted.runStartupMigrationsSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.recoverySpy).toHaveBeenCalledTimes(1);

    // Strict ordering: recovery must observe the post-migration timestamp,
    // not race ahead of it. If a regression invokes recovery before
    // `await runStartupMigrations()` resolves (e.g. moved above the await
    // in server/index.ts), recoveryCalledAt will be < migrationsResolvedAt
    // and this assertion fails.
    expect(hoisted.order.migrationsResolvedAt).not.toBeNull();
    expect(hoisted.order.recoveryCalledAt).not.toBeNull();
    expect(hoisted.order.recoveryCalledAt!).toBeGreaterThanOrEqual(
      hoisted.order.migrationsResolvedAt!,
    );
  });
});
