import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Task #1002 — regression test for the boot ordering race that was fixed in
// Task #993. The CRM transcript-backfill recovery routine
// (`resumeOrReapBackfillJobsOnBoot`) used to be invoked at module-import time
// from `server/crmCallsRoutes.ts`, which raced the migration that creates
// `crm_transcript_backfill_jobs` on a fresh database. Symptoms on the very
// first cold boot:
//
//   * a `relation "crm_transcript_backfill_jobs" does not exist` warning, and
//   * boot recovery silently skipped for that boot.
//
// This file pins down the crmCallsRoutes side of the fix:
//
//   1. Importing the module on a cold-start DB must NOT call into storage
//      (i.e. recovery is no longer invoked at module load).
//   2. The in-module idempotency guard (`backfillBootRecoveryStarted`)
//      collapses repeated invocations to a single storage hit.
//
// The complementary `server/index.ts` ordering assertion (recovery is
// invoked AFTER `runStartupMigrations()` resolves) lives in
// `crm-backfill-boot-index-ordering.test.ts`, separate so it can mock
// `../crmCallsRoutes` wholesale without affecting the module-load tests
// here, which need the real implementation.

const hoisted = vi.hoisted(() => ({
  listMostRecentSpy: vi.fn(),
}));

vi.mock("../storage", async () => {
  const actual =
    await vi.importActual<typeof import("../storage")>("../storage");
  return {
    ...actual,
    listMostRecentRunningCrmTranscriptBackfillJobsPerOrg: hoisted.listMostRecentSpy,
  };
});

describe("CRM transcript backfill boot recovery — crmCallsRoutes module load", () => {
  const captured: string[] = [];
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  function coldStartMissingTable() {
    hoisted.listMostRecentSpy.mockImplementation(async () => {
      const err: NodeJS.ErrnoException & { code?: string } = Object.assign(
        new Error('relation "crm_transcript_backfill_jobs" does not exist'),
        { code: "42P01" },
      );
      throw err;
    });
  }

  beforeEach(() => {
    captured.length = 0;
    hoisted.listMostRecentSpy.mockReset();
    coldStartMissingTable();
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...args: unknown[]) => {
        captured.push("WARN " + args.map((a) => String(a)).join(" "));
      });
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        captured.push("ERROR " + args.map((a) => String(a)).join(" "));
      });
    infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation((...args: unknown[]) => {
        captured.push("INFO " + args.map((a) => String(a)).join(" "));
      });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("does not invoke boot recovery at module-import time on a cold-start DB", async () => {
    vi.resetModules();
    // Importing the route module on a cold-start DB must NOT touch the
    // missing `crm_transcript_backfill_jobs` table. If a future refactor
    // re-adds something like `void resumeOrReapBackfillJobsOnBoot();` at the
    // bottom of crmCallsRoutes.ts, the storage call will fire during import,
    // hit our cold-start mock, and emit the "relation ... does not exist"
    // warning that this test asserts against.
    await import("../crmCallsRoutes");
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setImmediate(r));

    expect(hoisted.listMostRecentSpy).not.toHaveBeenCalled();
    expect(captured.join("\n")).not.toMatch(/relation .* does not exist/i);
  });

  it("runs boot recovery exactly once across repeated invocations and emits no missing-table warning", async () => {
    vi.resetModules();
    const mod = await import("../crmCallsRoutes");
    await new Promise((r) => setTimeout(r, 50));
    expect(hoisted.listMostRecentSpy).not.toHaveBeenCalled();

    // Now "runStartupMigrations" has resolved — the table exists, so the
    // storage call returns an empty list instead of throwing.
    hoisted.listMostRecentSpy.mockReset();
    hoisted.listMostRecentSpy.mockResolvedValue([]);
    captured.length = 0;

    // Drive recovery three times. The in-module idempotency guard
    // (`backfillBootRecoveryStarted`) must collapse this to a single
    // storage hit.
    await mod.resumeOrReapBackfillJobsOnBoot();
    await mod.resumeOrReapBackfillJobsOnBoot();
    await mod.resumeOrReapBackfillJobsOnBoot();

    expect(hoisted.listMostRecentSpy).toHaveBeenCalledTimes(1);
    expect(captured.join("\n")).not.toMatch(/relation .* does not exist/i);
  });
});
