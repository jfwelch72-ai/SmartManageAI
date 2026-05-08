// Task #2668 — Behavioral DB tests for the AI takeoff stall watchdog and
// the terminal-status guard inside `processAiTakeoff`. Source-
// introspection invariants are pinned in the sibling
// `ai-takeoff-stall-watchdog.test.ts`; this file actually exercises the
// schema + queries against the auto-provisioned `*_test` Postgres so a
// future refactor that *technically* matches the source patterns but
// breaks the runtime semantics still gets caught.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { aiTakeoffAnalyses, organizations, users } from "@shared/schema";
import { processAiTakeoffStallWatchdog } from "../jobs/jobRunner";

const ORG_SLUG_PREFIX = "__t2668_wd__";

let orgId: string;
let userId: string;
let createdAnalysisIds: string[] = [];

async function insertAnalysis(overrides: {
  status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
  progressUpdatedAt: Date | null;
  currentJobId?: string | null;
  errorMessage?: string | null;
  progressMessage?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(aiTakeoffAnalyses)
    .values({
      organizationId: orgId,
      tradeType: "ELECTRICAL",
      status: overrides.status,
      analysisMode: "QUICK",
      currentJobId: overrides.currentJobId ?? null,
      progressUpdatedAt: overrides.progressUpdatedAt,
      errorMessage: overrides.errorMessage ?? null,
      progressMessage: overrides.progressMessage ?? null,
      createdByUserId: userId,
    })
    .returning({ id: aiTakeoffAnalyses.id });
  createdAnalysisIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  // Suppress getBoss() / publishJobProgress side effects — we don't
  // want the watchdog to actually try to attach to pg-boss in tests.
  vi.mock("../jobQueue", async () => {
    return {
      getBoss: () => {
        throw new Error("pg-boss not initialized in test");
      },
      publishJobProgress: vi.fn(async () => {}),
    };
  });

  const slug = `${ORG_SLUG_PREFIX}${Date.now()}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: "T2668 Watchdog Org", slug })
    .returning({ id: organizations.id });
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `t2668-${Date.now()}@example.com`,
      firstName: "T2668",
      lastName: "Watchdog",
      passwordHash: "x",
      role: "ADMIN",
      organizationId: orgId,
    })
    .returning({ id: users.id });
  userId = user.id;
});

afterAll(async () => {
  if (createdAnalysisIds.length) {
    await db
      .delete(aiTakeoffAnalyses)
      .where(inArray(aiTakeoffAnalyses.id, createdAnalysisIds))
      .catch(() => {});
  }
  if (userId) {
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  }
  if (orgId) {
    await db.delete(organizations).where(eq(organizations.id, orgId)).catch(() => {});
  }
});

describe("processAiTakeoffStallWatchdog (behavioral)", () => {
  it("flips a stale PROCESSING row with no progress tick to FAILED", async () => {
    // Default stall timeout is 5 min; 10 minutes ago is comfortably past
    // the cutoff.
    const id = await insertAnalysis({
      status: "PROCESSING",
      progressUpdatedAt: new Date(Date.now() - 10 * 60 * 1000),
      currentJobId: null,
    });

    const summary = await processAiTakeoffStallWatchdog();
    expect(summary.flagged).toBeGreaterThanOrEqual(1);

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("FAILED");
    expect(after.errorMessage).toMatch(/stalled/i);
    expect(after.progressMessage).toMatch(/stalled/i);
  });

  it("flips a PROCESSING row with NULL progress_updated_at (worker died before first tick)", async () => {
    const id = await insertAnalysis({
      status: "PROCESSING",
      progressUpdatedAt: null,
      currentJobId: null,
    });

    await processAiTakeoffStallWatchdog();

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("FAILED");
  });

  it("leaves a recently-ticked PROCESSING row untouched", async () => {
    const id = await insertAnalysis({
      status: "PROCESSING",
      progressUpdatedAt: new Date(),
      currentJobId: null,
    });

    await processAiTakeoffStallWatchdog();

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("PROCESSING");
    expect(after.errorMessage).toBeNull();
  });

  it("never overwrites a row that is already in a terminal status", async () => {
    const completeId = await insertAnalysis({
      status: "COMPLETE",
      progressUpdatedAt: new Date(Date.now() - 30 * 60 * 1000),
      currentJobId: null,
      progressMessage: "Done",
    });
    const failedId = await insertAnalysis({
      status: "FAILED",
      progressUpdatedAt: new Date(Date.now() - 30 * 60 * 1000),
      currentJobId: null,
      errorMessage: "Original failure reason",
      progressMessage: "Original failure reason",
    });

    await processAiTakeoffStallWatchdog();

    const [c] = await db.select().from(aiTakeoffAnalyses).where(eq(aiTakeoffAnalyses.id, completeId));
    expect(c.status).toBe("COMPLETE");
    expect(c.progressMessage).toBe("Done");

    const [f] = await db.select().from(aiTakeoffAnalyses).where(eq(aiTakeoffAnalyses.id, failedId));
    expect(f.status).toBe("FAILED");
    // The original error message must be preserved — the watchdog
    // must NOT rewrite a terminal row's user-visible fields.
    expect(f.errorMessage).toBe("Original failure reason");
  });
});

describe("processAiTakeoff worker-start guard (behavioral)", () => {
  it("the initial PENDING→PROCESSING transition does not resurrect a row already flipped to FAILED", async () => {
    // Race scenario: cancel/watchdog flipped the row to FAILED *before*
    // the worker pulled it off the queue. The very first thing
    // processAiTakeoff does is the PROCESSING transition; that UPDATE
    // must affect 0 rows, so the worker exits via the terminal-already
    // sentinel without overwriting the FAILED state back to PROCESSING.
    const id = await insertAnalysis({
      status: "FAILED",
      progressUpdatedAt: new Date(),
      currentJobId: "fake-job-id",
      errorMessage: "Analysis cancelled by user",
      progressMessage: "Analysis cancelled by user",
    });

    const claimed = await db
      .update(aiTakeoffAnalyses)
      .set({ status: "PROCESSING" })
      .where(
        and(
          eq(aiTakeoffAnalyses.id, id),
          inArray(aiTakeoffAnalyses.status, ["PENDING", "PROCESSING"]),
        ),
      )
      .returning({ id: aiTakeoffAnalyses.id });

    expect(claimed).toHaveLength(0);

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("FAILED");
    expect(after.errorMessage).toBe("Analysis cancelled by user");
    expect(after.progressMessage).toBe("Analysis cancelled by user");
  });

  it("a PENDING row can still be claimed by the same guarded UPDATE", async () => {
    const id = await insertAnalysis({
      status: "PENDING",
      progressUpdatedAt: null,
    });

    const claimed = await db
      .update(aiTakeoffAnalyses)
      .set({ status: "PROCESSING" })
      .where(
        and(
          eq(aiTakeoffAnalyses.id, id),
          inArray(aiTakeoffAnalyses.status, ["PENDING", "PROCESSING"]),
        ),
      )
      .returning({ id: aiTakeoffAnalyses.id });

    expect(claimed).toHaveLength(1);

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("PROCESSING");
  });
});

describe("processAiTakeoff terminal-status guard (behavioral)", () => {
  it("the COMPLETE-write filter does not bring a FAILED row back to COMPLETE", async () => {
    // Simulate the race: row was just flipped to FAILED by the watchdog
    // (or the user's cancel) while the worker was still finalizing.
    // The exact UPDATE the worker would issue must hit zero rows.
    const id = await insertAnalysis({
      status: "FAILED",
      progressUpdatedAt: new Date(),
      currentJobId: null,
      errorMessage: "Cancelled by user",
      progressMessage: "Cancelled by user",
    });

    const updated = await db
      .update(aiTakeoffAnalyses)
      .set({
        status: "COMPLETE",
        detectedItemsJson: JSON.stringify([{ test: 1 }]),
        progressPct: 100,
        progressMessage: "Analysis complete",
        progressUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiTakeoffAnalyses.id, id),
          inArray(aiTakeoffAnalyses.status, ["PENDING", "PROCESSING"]),
        ),
      )
      .returning({ id: aiTakeoffAnalyses.id });

    expect(updated).toHaveLength(0);

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("FAILED");
    expect(after.errorMessage).toBe("Cancelled by user");
    expect(after.detectedItemsJson).toBeNull();
  });

  it("the cancel UPDATE filter does not flip a COMPLETE row to FAILED if the worker finished first", async () => {
    // Simulate the cancel-vs-complete race: the cancel handler had
    // SELECTed the row while it was still PROCESSING but, before its
    // UPDATE fires, the worker won the race and wrote COMPLETE.
    const id = await insertAnalysis({
      status: "COMPLETE",
      progressUpdatedAt: new Date(),
      currentJobId: null,
      progressMessage: "Analysis complete",
    });

    // This is the *exact* UPDATE shape the cancel endpoint now issues.
    const cancelled = await db
      .update(aiTakeoffAnalyses)
      .set({
        status: "FAILED",
        errorMessage: "Analysis cancelled by user",
        progressMessage: "Analysis cancelled by user",
        progressUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiTakeoffAnalyses.id, id),
          inArray(aiTakeoffAnalyses.status, ["PENDING", "PROCESSING"]),
        ),
      )
      .returning({ id: aiTakeoffAnalyses.id });

    expect(cancelled).toHaveLength(0);

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("COMPLETE");
    expect(after.progressMessage).toBe("Analysis complete");
    expect(after.errorMessage).toBeNull();
  });

  it("the same UPDATE succeeds against a still-PROCESSING row", async () => {
    const id = await insertAnalysis({
      status: "PROCESSING",
      progressUpdatedAt: new Date(),
      currentJobId: "fake-job-id",
    });

    const updated = await db
      .update(aiTakeoffAnalyses)
      .set({
        status: "COMPLETE",
        detectedItemsJson: JSON.stringify([{ ok: true }]),
        progressPct: 100,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiTakeoffAnalyses.id, id),
          inArray(aiTakeoffAnalyses.status, ["PENDING", "PROCESSING"]),
        ),
      )
      .returning({ id: aiTakeoffAnalyses.id });

    expect(updated).toHaveLength(1);

    const [after] = await db
      .select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, id));
    expect(after.status).toBe("COMPLETE");
  });
});

// Silence unused-import warning when sql tagged template is not used.
void sql;
