/**
 * Task #1950 — Real-time Postgres pool health surface.
 *
 * Task #1949 added structured `pool_exhausted` vs `query_failed` log
 * lines but admins still had to grep production logs to know when the
 * shared connection pool was starving. This module exposes:
 *
 *   1. Live pool counters (`active`, `idle`, `waiting`, `total`, `max`)
 *      pulled directly from the `pg.Pool` instance in `server/db.ts`.
 *   2. A small in-process ring buffer of the last 50 `pool_exhausted`
 *      events emitted by `logJobErrorWithKind` in `jobRunner.ts`.
 *
 * Both surfaces are intentionally process-local — the goal is "spot the
 * problem in the dashboard before the next republish hangs", not durable
 * audit. Persisting every starvation event would add write pressure on
 * the very pool we're trying to monitor.
 */

import type { Pool } from "pg";
import { pool as defaultPool } from "../db";

export interface PoolStats {
  active: number;
  idle: number;
  waiting: number;
  total: number;
  max: number;
}

export interface PoolExhaustedEvent {
  timestamp: number;
  job: string;
  message: string;
  error: string;
}

const MAX_EVENTS = 50;
const events: PoolExhaustedEvent[] = [];

/**
 * Read the live pg.Pool counters. Defaults to the shared pool exported
 * from `server/db.ts`; tests can pass a stub.
 */
export function getPoolStats(pool: Pool = defaultPool): PoolStats {
  const total = pool.totalCount ?? 0;
  const idle = pool.idleCount ?? 0;
  const waiting = pool.waitingCount ?? 0;
  const max =
    typeof (pool as unknown as { options?: { max?: number } }).options?.max === "number"
      ? ((pool as unknown as { options: { max: number } }).options.max)
      : 0;
  return {
    active: Math.max(0, total - idle),
    idle,
    waiting,
    total,
    max,
  };
}

/**
 * Append a `pool_exhausted` event to the rolling 50-entry buffer. Older
 * events are dropped FIFO so the buffer stays bounded.
 */
export function recordPoolExhaustedEvent(event: {
  job: string;
  message: string;
  error: string;
}): PoolExhaustedEvent {
  const entry: PoolExhaustedEvent = {
    timestamp: Date.now(),
    job: event.job,
    message: event.message,
    error: event.error,
  };
  events.push(entry);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  return entry;
}

/**
 * Return the buffered `pool_exhausted` events, newest first.
 */
export function getRecentPoolExhaustedEvents(): PoolExhaustedEvent[] {
  return events.slice().reverse();
}

/**
 * Test helper — drop all buffered events.
 */
export function resetPoolExhaustedEvents(): void {
  events.length = 0;
}

export const POOL_EXHAUSTED_BUFFER_SIZE = MAX_EVENTS;
