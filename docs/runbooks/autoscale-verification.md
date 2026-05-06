# Autoscale Verification Runbook (Task #2427)

This runbook covers how to verify SmartManageAI is safe to run on
multiple replicas under Reserved VM Autoscale, and how to debug issues
specific to multi-instance deployments. Read it end-to-end before you
turn the dial above 1 instance for the first time.

## What Task #2427 changed

The platform was originally written assuming a single Node process. Three
classes of state lived in per-process memory and would have misbehaved on
N pods:

| Subsystem | Old behaviour on N pods | After Task #2427 |
|---|---|---|
| `express-rate-limit` (5 limiters in `server/rateLimiter.ts`) | Each pod kept its own bucket → effective quota was N × configured limit | All 5 limiters use `PgExpressRateLimitStore` against the shared `rate_limit_state` table |
| In-process schedulers (`aiNotesScheduler`, `crmTaskReminderScheduler`, `crmBackfillAlertDigestScheduler`, `statusProbeScheduler`, `startJobRunner`, `initializeAIScheduler`) | Every pod fired every cron tick → duplicate notifications, duplicate provider syncs, duplicate digest emails | Each cron tick is wrapped in `withSchedulerLock(name, fn)` — one Postgres advisory lock per scheduler name, only the leader runs |
| `authUserCache` in `server/auth.ts` | 60-second TTL kept revoked-token windows open per pod | TTL reduced to 5s; `tokenVersion` mismatch on every hit still gates revoked tokens cross-pod |

The migration that backs the rate-limit columns is
`migrations/0078_rate_limit_state_counters.sql`, mirrored by the runtime
helper `ensureRateLimitStateCounters` (registered in
`runStartupMigrations.ts` so long-lived dev DBs catch up automatically).

## Pre-flight checklist before scaling above 1 instance

Run all of these in order. Stop and triage before scaling if any fails.

1. **Confirm the migration is applied.** From a DB shell:

   ```sql
   SELECT column_name
     FROM information_schema.columns
    WHERE table_name = 'rate_limit_state'
      AND column_name IN ('hit_count', 'window_expires_at');
   ```

   Expect 2 rows. If empty, run `npm run db:push` or restart the app
   (the startup migration runner will add the columns).

2. **Confirm the `rate_limit_state` partial index exists.**

   ```sql
   SELECT indexname FROM pg_indexes
    WHERE tablename = 'rate_limit_state'
      AND indexname = 'rate_limit_state_window_expires_idx';
   ```

3. **Confirm the env var defaults are right.** The Postgres-backed
   limiter is on by default. The escape hatch
   `RATE_LIMIT_USE_MEMORY_STORE=1` is for tests only — it must NOT be
   set in production.

4. **Run the multi-instance regression suite locally.**

   ```bash
   npx vitest run server/__tests__/multi-instance
   ```

   Both `rate-limiter-shared.test.ts` and `scheduler-lock.test.ts`
   should pass.

## Live verification on a multi-instance deployment

After the deploy reaches steady state with 2+ instances:

### 1. Rate limits are shared

Pick any limiter (e.g. the auth limiter, prefix `auth`). From the DB:

```sql
SELECT key,
       hit_count,
       window_expires_at,
       last_invoked_at
  FROM rate_limit_state
 WHERE key LIKE 'erl:%'
 ORDER BY last_invoked_at DESC
 LIMIT 20;
```

What you should see:
- Keys are `erl:<prefix>:<keyGen value>`. The 5 prefixes are `auth`,
  `sensitive`, `api`, `export`, `feedback` (see
  `server/rateLimiter.ts` for the source of truth).
- `hit_count` advances across HTTP requests irrespective of which pod
  served them. To prove this manually, hit the same endpoint twice
  rapidly and watch a single row's counter advance by 2 even if the
  load balancer routed the requests to different pods.

If you see two rows for the same `key` differing only by `hit_count`,
something is wrong — most likely the table was partitioned or the
`ON CONFLICT` clause is missing. Open a P1.

### 2. Scheduler ticks are leader-elected

The scheduler advisory locks live in the dedicated namespace
`SCHEDULER_LOCK_NAMESPACE = 0x534d31` (ASCII "SM1", see
`server/utils/schedulerLock.ts`). To list every live scheduler lock
across the fleet:

```sql
SELECT classid,
       objid,
       pid,
       granted,
       now() - state_change AS held_for
  FROM pg_locks
  JOIN pg_stat_activity USING (pid)
 WHERE locktype = 'advisory'
   AND classid = 5459761  -- 0x534d31
 ORDER BY held_for DESC;
```

What you should see:
- At most ONE granted row per `objid`. `objid` is `hashtext(name)::int`
  for the scheduler name (e.g. `ai-notes:hourly`,
  `status-probe:sweep`, `job:outboxTask`).
- `held_for` should never exceed the natural duration of the tick.
  Locks held for hours indicate a tick that hung — find the pid in
  `pg_stat_activity` and investigate that pod's logs.

To smoke-test the leader election, scale the deployment to 2 instances,
tail logs from both, and watch a 1-minute scheduler (e.g.
`status-probe:sweep`). Exactly one pod per minute should log probe work;
the other should log nothing for that scheduler name. If both pods log
probe work, something is wrong with the lock — open a P1.

### 3. Auth cache is short-lived

The `authUserCache` in `server/auth.ts` was shortened from 60s to 5s.
After revoking a user (incrementing `users.token_version`), all pods
should reject their cached token within 5 seconds. To verify:

1. Issue a JWT, hit a protected endpoint twice across two pods (200 / 200).
2. Increment the user's `token_version` in the DB:
   ```sql
   UPDATE users SET token_version = token_version + 1 WHERE id = '<uid>';
   ```
3. Wait 5s, hit both pods again — both should 401.

If a pod still returns 200 after 5s, the cache TTL has regressed. Check
`USER_CACHE_TTL_MS` in `server/auth.ts`.

## Common incidents

### Rate limits suddenly stop firing

Most likely cause: `PgExpressRateLimitStore.increment` is failing OPEN
because Postgres is unreachable or the migration regressed. Check:

```sql
-- Did the columns get dropped / renamed?
\d+ rate_limit_state
```

Then grep recent application logs for
`PgExpressRateLimitStore.increment failed`. The store is intentionally
fail-open (we'd rather under-enforce than 500 every API call), so users
won't see errors — but every miss is logged loudly.

### Scheduler tick fired N times (duplicate notifications)

Most likely cause: the scheduler is running OUTSIDE `withSchedulerLock`.
Grep the scheduler module for `cron.schedule(` and confirm every
callback is wrapped:

```ts
cron.schedule("...", async () => {
  try {
    await withSchedulerLock("scheduler:name", async () => { ... });
  } catch (err) { ... }
});
```

In `server/jobs/jobRunner.ts` the lock name is `job:<varName>` — for
example `job:outboxTask`, `job:retentionTask`, `job:syncScheduleTask`.
A new task added without the wrapper will silently fan out under
autoscale.

### A scheduler stops running entirely

Most likely cause: the previous tick crashed mid-execution AFTER
acquiring the lock but BEFORE the wrapper's `ROLLBACK`. Because we use
`pg_try_advisory_xact_lock`, the lock auto-releases when the connection
dies — so this can only happen if the connection is still alive but
hung. Find the offending pod from `pg_stat_activity` (see query above)
and either kill the connection or restart that pod. The next tick on
any peer will re-acquire cleanly.

### Counter table grows unbounded

`pruneExpiredRateLimitCounters()` (defined in
`server/utils/expressRateLimitPgStore.ts`) deletes rows older than
1 hour past their window. It should be invoked from a scheduled job.
Confirm the row count is bounded:

```sql
SELECT count(*) FROM rate_limit_state WHERE window_expires_at < now();
```

If this number grows over hours/days, the prune is not running. Check
the Super Admin job-metrics dashboard for the pruner's name.

## Deferred / out-of-scope items

These are not blockers for autoscale but are worth knowing:

- **WebSocket fan-out.** The unified messaging system uses in-process
  WS rooms. Two replicas hosting two halves of a conversation will
  not see each other's messages until a pub/sub bus is added. Tracked
  separately.
- **In-process LRU caches** beyond `authUserCache` (e.g. feature-flag
  cache) still have per-process TTLs. They self-correct within their
  TTL window and do not affect correctness.
- **One-shot startup migrations.** The startup migration runner is
  idempotent but every pod runs it on boot. This is by design — if you
  scale to 100 pods, you'll see 100 startup migration log lines, all
  no-ops after the first.

## See also

- `server/utils/expressRateLimitPgStore.ts` — the rate-limit store impl
- `server/utils/schedulerLock.ts` — the advisory-lock wrapper
- `server/rateLimiter.ts` — the 5 limiter definitions
- `migrations/0078_rate_limit_state_counters.sql` — the schema migration
- `server/__tests__/multi-instance/` — the regression suite
