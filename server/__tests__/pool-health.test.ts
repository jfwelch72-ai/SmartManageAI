/**
 * Task #1950 — smoke tests for the in-process pool health surface.
 *
 * The module is process-local with no DB dependency for the buffer
 * portion, so we exercise the recording / retrieval / ring-buffer
 * trimming behaviour directly. `getPoolStats` is exercised against a
 * stub pool to avoid binding to live `db.ts` state.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getPoolStats,
  recordPoolExhaustedEvent,
  getRecentPoolExhaustedEvents,
  resetPoolExhaustedEvents,
  POOL_EXHAUSTED_BUFFER_SIZE,
} from "../utils/poolHealth";
import type { Pool } from "pg";

function stubPool(opts: {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  max: number;
}): Pool {
  return {
    totalCount: opts.totalCount,
    idleCount: opts.idleCount,
    waitingCount: opts.waitingCount,
    options: { max: opts.max },
  } as unknown as Pool;
}

beforeEach(() => {
  resetPoolExhaustedEvents();
});

describe("poolHealth.getPoolStats", () => {
  it("derives active = total - idle and surfaces max", () => {
    const stats = getPoolStats(
      stubPool({ totalCount: 10, idleCount: 3, waitingCount: 2, max: 60 }),
    );
    expect(stats).toEqual({
      active: 7,
      idle: 3,
      waiting: 2,
      total: 10,
      max: 60,
    });
  });

  it("clamps active to zero when the pool reports nonsensical idle > total", () => {
    const stats = getPoolStats(
      stubPool({ totalCount: 0, idleCount: 5, waitingCount: 0, max: 10 }),
    );
    expect(stats.active).toBe(0);
  });

  it("returns 0 max when the pool config does not expose options.max", () => {
    const pool = { totalCount: 0, idleCount: 0, waitingCount: 0 } as unknown as Pool;
    const stats = getPoolStats(pool);
    expect(stats.max).toBe(0);
  });
});

describe("poolHealth recent events buffer", () => {
  it("records events newest-first", () => {
    recordPoolExhaustedEvent({ job: "outbox", message: "Outbox processing failed", error: "timeout" });
    recordPoolExhaustedEvent({ job: "social_posts", message: "Social post processing failed", error: "Connection terminated unexpectedly" });

    const events = getRecentPoolExhaustedEvents();
    expect(events).toHaveLength(2);
    expect(events[0].job).toBe("social_posts");
    expect(events[1].job).toBe("outbox");
  });

  it("caps the buffer at POOL_EXHAUSTED_BUFFER_SIZE entries", () => {
    for (let i = 0; i < POOL_EXHAUSTED_BUFFER_SIZE + 10; i++) {
      recordPoolExhaustedEvent({ job: `job_${i}`, message: "msg", error: "err" });
    }
    const events = getRecentPoolExhaustedEvents();
    expect(events).toHaveLength(POOL_EXHAUSTED_BUFFER_SIZE);
    // The newest event is at index 0; the oldest retained should be the
    // (10th + 1) recorded event since the first 10 were evicted.
    expect(events[0].job).toBe(`job_${POOL_EXHAUSTED_BUFFER_SIZE + 9}`);
    expect(events[events.length - 1].job).toBe(`job_10`);
  });

  it("captures timestamp, job, message, and error on each entry", () => {
    const before = Date.now();
    const entry = recordPoolExhaustedEvent({
      job: "scheduled_campaigns",
      message: "Scheduled campaign processing failed",
      error: "timeout exceeded when trying to connect",
    });
    const after = Date.now();
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.job).toBe("scheduled_campaigns");
    expect(entry.message).toBe("Scheduled campaign processing failed");
    expect(entry.error).toMatch(/timeout/);
  });
});
