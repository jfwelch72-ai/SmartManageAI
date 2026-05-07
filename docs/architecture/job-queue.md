# Background Job Queue (pg-boss)

Task #2481 introduces a real background job queue so AI takeoff,
AI document analysis, large PDF tile generation, certified-payroll
exports, and accounting sync can run outside the HTTP request lifecycle
with retries, dead-letter handling, per-tenant fairness, and progress
visible in the UI.

## Decision: pg-boss over BullMQ

| Factor | pg-boss | BullMQ |
| ------ | ------- | ------ |
| Backing store | Postgres (already shipped) | Redis (new infra) |
| Replit deploy | Works as-is | Requires managed Redis add-on |
| Throughput ceiling | Tens of jobs/sec/queue (plenty for the workloads here) | Far higher, but unused |
| Operational surface | One DB to back up / monitor | Two |
| Cross-pod fan-out | NOTIFY-driven, same primitives we already use in `messagingBus` | Native |
| RLS context | Trivial — same `pool`, same `withOrgContext` | Indirect |

We do not have Redis. The hot endpoints in scope (AI takeoff, AI
document analysis, AI estimator, PDF tile prerender, accounting sync,
exports) are bounded to single-digit jobs/sec/tenant. pg-boss easily
clears that bar and avoids a new managed dependency.

## Architecture

```
HTTP route ──► enqueueJob(...)
                 │
                 ▼
         pg-boss queue (Postgres)
                 │
                 ▼
       worker process(es) ── handler(payload, ctx)
                 │                 │
                 │                 └─ progress(...)  ── messagingBus ──► SSE clients
                 ▼
            result row in pgboss.job
```

Key files:

- `server/jobQueue/index.ts` — singleton boss, `registerHandlers`, `enqueueJob`,
  `getJobStatus`, `getQueueDepths`, `listDeadLetterJobs`, `retryDeadLetterJob`.
- `server/jobQueue/handlers/*.ts` — concrete job handlers
  (`ai_takeoff_analyze`, `ai_document_analyze`).
- `server/worker.ts` — dedicated entrypoint that boots only the queue + handlers,
  no HTTP server. Runs as the `Job worker` workflow in dev and as a
  separate Replit Reserved-VM "background worker" deployment in prod
  (Task #2519). The web/autoscale deployment pins `JOB_WORKER_INPROCESS=0`
  via `.replit`'s `[userenv.production]`, so the web pod only enqueues.
  See [`docs/ops/runbook.md` §7](../ops/runbook.md) for how to scale the
  worker pod and read its logs.
- `server/jobQueueAdminRoutes.ts` — Super Admin REST endpoints for
  queue depth, DLQ list, retry, archive.
- `client/src/pages/admin/job-queue.tsx` — the admin UI surface.

## Idempotency

Every `enqueueJob` accepts an `idempotencyKey` (or computes one from
`name + tenantId + payload`). pg-boss's `singletonKey` keeps any second
enqueue with the same key a no-op while the first is queued / running.
Handlers also receive the `idempotencyKey` so they can guard
DB-mutating side effects.

## Per-tenant concurrency

The default `teamConcurrency`/`teamSize` give us a global cap per
queue. We layer per-tenant fairness on top by:

1. Running with `teamSize=8, teamConcurrency=8` per queue.
2. Inside the handler wrapper, claiming a per-tenant semaphore before
   running. A tenant that is already at its per-tenant cap re-queues
   the job with a short delay rather than blocking the worker slot.

This stops one big customer from starving the queue while keeping the
implementation small.

## Retries & DLQ

Each job is enqueued with `retryLimit=5, retryBackoff=true,
retryDelay=10s`. Jobs that exhaust retries land in pg-boss's
`failed` archive and are surfaced to Super Admins via the admin UI,
which can retry or archive them.

## Tenant isolation (RLS)

The handler wrapper calls `withOrgContext({ organizationId, source:
"job:<name>", isSuperadmin: false })` before invoking the user handler,
so every DB call inside a job runs through the RLS-scoped client. This
matches Task #2478's defense-in-depth contract.

## Observability

Every job records `recordJobMetrics("queue:<name>", { succeeded|failed|skipped: 1 })`,
which feeds the existing Job Metrics dashboard and alert engine.
