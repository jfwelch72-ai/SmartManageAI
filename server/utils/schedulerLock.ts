import { pool } from "../db";
import { logError, logWarn } from "./logger";

/**
 * Task #2427 — Postgres advisory-lock based leader election for the
 * in-process schedulers.
 *
 * Why
 * ---
 * The autoscale deployment runs N Node replicas behind a load balancer.
 * Each replica boots its own copies of `aiNotesScheduler`,
 * `crmTaskReminderScheduler`, `crmBackfillAlertDigestScheduler`,
 * `statusProbeScheduler`, `startJobRunner`, and `initializeAIScheduler`.
 * Without coordination, every cron tick fires on every pod — duplicate
 * notifications, duplicate provider syncs, duplicate Sage account
 * imports, etc.
 *
 * The fix
 * -------
 * `withSchedulerLock(name, fn)` opens a dedicated short-lived
 * Postgres connection, opens a transaction, attempts
 * `pg_try_advisory_xact_lock(<NAMESPACE>, hashtext(name))`. If the lock
 * is acquired, `fn()` runs and the lock auto-releases on COMMIT/ROLLBACK
 * (or when the connection is dropped, e.g. the pod is killed mid-tick).
 * If a peer holds the lock, the call resolves with `{ ran: false }` and
 * the caller skips this tick.
 *
 * The xact-scoped flavour is deliberate: it removes any need for
 * graceful-shutdown bookkeeping. If a leader pod dies between ticks,
 * the next tick on any peer simply acquires the lock cleanly. If a
 * leader dies mid-tick, Postgres tears down the lock with the
 * connection and the next tick proceeds as normal.
 *
 * Namespace
 * ---------
 * Postgres advisory locks share a single 64-bit keyspace. We use a
 * dedicated `int4` namespace `SCHEDULER_LOCK_NAMESPACE` so application
 * code that wants its own advisory locks (none today) can pick a
 * different namespace and never collide. The actual lock identity is
 * `(SCHEDULER_LOCK_NAMESPACE, hashtext(name))` — a stable hash of the
 * scheduler name string.
 */
export const SCHEDULER_LOCK_NAMESPACE = 0x534d31; // ASCII "SM1" — SmartManageAI scheduler v1

export interface SchedulerLockResult<T> {
  /** True when this replica acquired the lock and ran `fn`. */
  ran: boolean;
  /** Result of `fn`, present only when `ran` is true. */
  value?: T;
}

/**
 * Run `fn` if and only if this process can acquire the named scheduler
 * lock. Resolves with `{ ran: false }` when another replica is already
 * holding the lock — the cron tick should treat that as a no-op.
 *
 * Errors thrown by `fn` propagate after the lock has been released.
 * Errors acquiring the lock itself (Postgres unreachable, etc.) are
 * logged and the tick is treated as `{ ran: false }` — schedulers must
 * not block forever on a transient outage.
 */
export async function withSchedulerLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<SchedulerLockResult<T>> {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    logWarn("[scheduler-lock] failed to acquire pool client; skipping tick", {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: false };
  }

  try {
    await client.query("BEGIN");
    let acquired = false;
    try {
      const res = await client.query(
        "SELECT pg_try_advisory_xact_lock($1::int, hashtext($2)::int) AS got",
        [SCHEDULER_LOCK_NAMESPACE, name],
      );
      acquired = res.rows[0]?.got === true;
    } catch (err) {
      logError(
        "[scheduler-lock] pg_try_advisory_xact_lock failed",
        { name },
        err instanceof Error ? err : new Error(String(err)),
      );
      await client.query("ROLLBACK").catch(() => {});
      return { ran: false };
    }

    if (!acquired) {
      // Peer is already running this tick; commit the empty tx and bail.
      await client.query("COMMIT").catch(() => {});
      return { ran: false };
    }

    let value: T;
    try {
      value = await fn();
    } catch (err) {
      // Roll back so the lock is released, then re-throw to the caller's
      // try/catch so the existing scheduler-level logError still fires.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
    await client.query("COMMIT").catch(() => {});
    return { ran: true, value };
  } finally {
    client.release();
  }
}
