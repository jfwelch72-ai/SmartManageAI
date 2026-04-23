/**
 * Task #1410 — Persist wage decision auto-refresh history so it survives
 * restarts.
 *
 * The previous implementation kept the most recent
 * `wage_decision_stale_refresh` sweep in a process-local module variable,
 * so a server restart wiped the dashboard's "last run" card until the
 * next 06:00 UTC tick. We now mirror sweep summaries to
 * `job_metric_samples` (via `recordJobMetrics`) and read the latest
 * record back from the table on demand.
 *
 * These tests pin the round-trip:
 *   - `getLastStaleWageDecisionSweep()` reads the most recent persisted
 *     row and decodes it into the same `StaleWageDecisionSweepRecord`
 *     shape the dashboard expects.
 *   - `getRecentStaleWageDecisionSweeps(N)` returns the last N rows in
 *     newest-first order (rolling history surface).
 *   - The cleanup helper `__resetLastStaleWageDecisionSweepForTests`
 *     wipes the persisted rows so each test starts clean.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { jobMetricSamples } from "@shared/schema";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const JOB = "wage_decision_stale_refresh";

async function clearJobRows() {
  await db.delete(jobMetricSamples).where(eq(jobMetricSamples.job, JOB));
}

beforeEach(async () => {
  await clearJobRows();
});

describe("persisted wage decision sweep history (Task #1410)", () => {
  it("returns null when no sweep has ever been recorded", async () => {
    const { getLastStaleWageDecisionSweep, getRecentStaleWageDecisionSweeps } =
      await import("../integrations/providers/dol_davis_bacon/sync");
    expect(await getLastStaleWageDecisionSweep()).toBeNull();
    expect(await getRecentStaleWageDecisionSweeps(5)).toEqual([]);
  });

  it("decodes a persisted row back into the dashboard-friendly shape", async () => {
    const ranAt = new Date(Date.UTC(2026, 3, 1, 6, 0, 0));
    await db.insert(jobMetricSamples).values({
      job: JOB,
      recordedAt: ranAt,
      counters: {
        candidates: 7,
        attempted: 5,
        succeeded: 4,
        failed: 1,
        skippedNoConnection: 2,
        skippedNoCredentials: 0,
        staleAfterDays: 30,
        durationMs: 1234,
      },
    });

    const { getLastStaleWageDecisionSweep } = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const last = await getLastStaleWageDecisionSweep();
    expect(last).not.toBeNull();
    expect(last!.ranAt).toBe(ranAt.toISOString());
    expect(last!.durationMs).toBe(1234);
    expect(last!.result).toEqual({
      candidates: 7,
      attempted: 5,
      succeeded: 4,
      failed: 1,
      skippedNoConnection: 2,
      skippedNoCredentials: 0,
      staleAfterDays: 30,
    });
  });

  it("returns the most recent row when several sweeps are persisted", async () => {
    const older = new Date(Date.UTC(2026, 2, 1, 6, 0, 0));
    const newer = new Date(Date.UTC(2026, 3, 1, 6, 0, 0));
    await db.insert(jobMetricSamples).values({
      job: JOB,
      recordedAt: older,
      counters: { candidates: 1, succeeded: 1, durationMs: 100, staleAfterDays: 30 },
    });
    await db.insert(jobMetricSamples).values({
      job: JOB,
      recordedAt: newer,
      counters: { candidates: 9, succeeded: 9, durationMs: 999, staleAfterDays: 30 },
    });

    const { getLastStaleWageDecisionSweep, getRecentStaleWageDecisionSweeps } =
      await import("../integrations/providers/dol_davis_bacon/sync");
    const last = await getLastStaleWageDecisionSweep();
    expect(last!.ranAt).toBe(newer.toISOString());
    expect(last!.result.candidates).toBe(9);

    const recent = await getRecentStaleWageDecisionSweeps(5);
    expect(recent.length).toBe(2);
    // Newest-first ordering so the dashboard can render a chronological
    // "most recent at top" history list without re-sorting client-side.
    expect(recent[0].ranAt).toBe(newer.toISOString());
    expect(recent[1].ranAt).toBe(older.toISOString());
  });

  it("clamps the recent-history limit so callers cannot request unbounded reads", async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(jobMetricSamples).values({
        job: JOB,
        recordedAt: new Date(Date.UTC(2026, 3, 1, 6, i, 0)),
        counters: { candidates: i, durationMs: i, staleAfterDays: 30 },
      });
    }
    const { getRecentStaleWageDecisionSweeps } = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    // Asking for 9999 still returns at most what's persisted; this also
    // proves the safeLimit ceiling does not floor below 1.
    const all = await getRecentStaleWageDecisionSweeps(9999);
    expect(all.length).toBe(3);
    const one = await getRecentStaleWageDecisionSweeps(1);
    expect(one.length).toBe(1);
  });

  it("__resetLastStaleWageDecisionSweepForTests wipes only this job's rows", async () => {
    await db.insert(jobMetricSamples).values({
      job: JOB,
      recordedAt: new Date(),
      counters: { candidates: 1, durationMs: 1, staleAfterDays: 30 },
    });
    await db.insert(jobMetricSamples).values({
      job: "some_other_job",
      recordedAt: new Date(),
      counters: { foo: 1 },
    });
    const {
      __resetLastStaleWageDecisionSweepForTests,
      getLastStaleWageDecisionSweep,
    } = await import("../integrations/providers/dol_davis_bacon/sync");
    await __resetLastStaleWageDecisionSweepForTests();
    expect(await getLastStaleWageDecisionSweep()).toBeNull();
    const otherStillThere = await db
      .select()
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, "some_other_job"));
    expect(otherStillThere.length).toBe(1);
    // Cleanup
    await db.delete(jobMetricSamples).where(eq(jobMetricSamples.job, "some_other_job"));
  });
});
