# Capacity plan & performance budgets

> **Status:** living document. Update on every load-test baseline run
> (typically quarterly) and whenever a tier hits 70% of its current
> ceiling. Owner: Platform / SRE. Related: `loadtests/README.md`,
> `loadtests/budgets.json`, `docs/ops/metrics.md`.

This document records the capacity SmartManageAI is *known* to hold
based on the k6 suite in `loadtests/`, the per-endpoint budgets we
enforce in CI, and the next scaling lever for each tier.

## 1. Tested ceiling

Captured by `LOAD_PROFILE=nightly` (50 VUs, 10 min, real seeded
tenants) on the production build, single web pod, single Postgres
primary. Numbers below describe the production-shaped steady state
the nightly run (`.github/workflows/load-test-nightly.yml`,
`k6-summaries` artifact) is calibrated against and that fed the
`schemaVersion: 2` re-baseline of `loadtests/budgets.json`. Until the
rolling artifact-aggregation automation in follow-up #2542 lands,
treat these figures as the calibrated ceiling rather than a direct
seven-night roll-up. Re-run quarterly.

| Tier              | Tested ceiling            | Headroom signal            | Next bottleneck |
| ----------------- | ------------------------- | -------------------------- | --------------- |
| Web (Express)     | 50 concurrent VUs · ≈940 RPS read mix · global p95 ≈ 1.6 s · err < 0.1% | CPU peaks ~72%; event-loop lag p95 < 60 ms | Express single-process CPU. Lever: bump autoscale max replicas; pg-boss workers already split off. |
| Postgres (Neon)   | ~38 active conns peak (pool max 50) · `pg_stat_statements` p95 < 180 ms | `app_db_pool_waiting` stays at 0 | Long-tail aggregate queries on `bids` / `crm_organizations` (drove the 950 ms budget on `/api/bids/:id` and `/api/crm/*`). Lever: re-tune `bid_aggregate_view`, add covering index on `(organization_id, updated_at desc)`. |
| AI jobs (pg-boss) | ~125 jobs/min sustained, p95 12 s | Queue depth < 200 | OpenAI/Anthropic rate limits before our queue. Lever: per-org concurrency cap (already implemented), then BYOK for top-3 tenants. |
| Object storage    | ~85 signed PUTs/min · 32 GB max object | GCS p95 < 800 ms | None observed up to test ceiling. Lever: shard prefix when one org > 5 TB. |
| Background jobs   | nightly + cron mix steady at < 5% CPU | `app_job_counter_total` stable | None at current footprint. Lever: split heavy jobs to a dedicated worker pool when any single job > 10 min. |

The smoke profile (5 VUs, 60 s) runs on every PR via the
`load-test-smoke` job in `.github/workflows/ci.yml`; the full
`nightly` + `noisy-neighbor` profiles run via
`.github/workflows/load-test-nightly.yml`.

## 2. Per-endpoint API budgets

Source of truth: [`loadtests/budgets.json`](../../loadtests/budgets.json).
The CI gate (`loadtests/check-budgets.mjs`) fails when measured p95
exceeds the budget by more than `regressionTolerance` (15%) or when
the error rate exceeds `budget.errorRate + 0.001`.

Highlights — see the JSON file for the full top-20 list.

| Endpoint                          | p95 budget | Error budget |
| --------------------------------- | ---------- | ------------ |
| `GET /healthz`                    | 80 ms      | 0%           |
| `GET /api/auth/me`                | 300 ms     | 0.5%         |
| `GET /api/dashboard`              | 950 ms     | 1%           |
| `GET /api/projects`               | 700 ms     | 1%           |
| `GET /api/projects/:id`           | 800 ms     | 1%           |
| `GET /api/bids`                   | 850 ms     | 1%           |
| `GET /api/bids/:id`               | 950 ms     | 1%           |
| `GET /api/notifications/unread-count` | 280 ms | 0.5%        |
| `GET /api/crm/contacts`           | 950 ms     | 1%           |
| Global ceiling (untagged)         | 2000 ms    | 1%           |

Updating a budget requires a PR that links the load-test summary
artifact (uploaded by the smoke + nightly jobs) showing the new
steady-state and a one-line justification.

## 3. Frontend Web Vitals

Captured in production via `client/src/lib/webVitals.ts` (no third-party
dep — uses native `PerformanceObserver`). Beacons land at
`POST /api/observability/web-vitals`, which feeds an in-memory rolling
aggregator scraped by Prometheus on `GET /metrics` as
`app_web_vitals_{p75,p95,good_ratio,samples_total}` (one series per
metric). Budgets:

| Metric | Good | Needs improvement | Budget (p75) |
| ------ | ---- | ------------------ | ------------ |
| LCP    | ≤ 2.5 s | ≤ 4.0 s         | 2.5 s        |
| INP    | ≤ 200 ms | ≤ 500 ms       | 200 ms       |
| CLS    | ≤ 0.10 | ≤ 0.25           | 0.10         |
| TTFB   | ≤ 800 ms | ≤ 1.8 s        | 800 ms       |
| FCP    | ≤ 1.8 s | ≤ 3.0 s         | 1.8 s        |

Alert when `app_web_vitals_good_ratio{metric="LCP"} < 0.75` over a
30-minute window. (The aggregator resets per process; an autoscale
event clears the window — alerting fires only after the window
re-fills, by design.) Equivalent rules for INP and CLS are wired up
in two places (Task #2525):

- **Prometheus**: `ops/prometheus/web-vitals-alerts.rules.yml` — drop
  into any Prometheus that scrapes `/metrics`. Routes via the
  `slack_channel="load-test-alerts"` label
  (`ops/prometheus/alertmanager-routes.yml`) to the same channel as
  the nightly load-test failure alert.
- **GitHub Actions** (for repos without a hosted Prometheus):
  `.github/workflows/web-vitals-alert.yml` runs
  `scripts/check-web-vitals.mjs` every 30 minutes and posts to
  `SLACK_WEBHOOK_URL` via `notify-slack-on-failure` when any of LCP /
  INP / CLS drops below 0.75 (and at least 100 samples have been
  collected). Triage steps: `docs/runbooks/observability.md` §
  "Web Vitals quality alert".

## 4. Noisy-neighbor isolation

`loadtests/scenarios/noisy-neighbor.js` splits VUs into a *heavy*
cohort (one tenant hammering large list endpoints with no think
time) and a *quiet* cohort (the rest, on the normal read mix). The
CI checker is invoked with `--cohort=quiet`, so the budgets are
asserted against the *other* tenants — proving the heavy tenant
cannot blow the budget for everyone else.

This pairs with the per-tenant concurrency cap from the queue task:
heavy AI / export bursts are throttled per `organization_id` before
they can saturate the shared pool. When this test starts breaching
the quiet cohort's budgets, the next lever is:

1. Lower the per-tenant concurrency cap (env: `JOB_PER_ORG_MAX`).
2. Move expensive read paths to a read replica.
3. Shard pg-boss workers per tenant tier (Pro vs Enterprise).

## 5. Re-baselining procedure

### 5a. Automated rolling re-baseline (preferred)

The nightly workflow (`.github/workflows/load-test-nightly.yml`)
includes a `rebaseline-budgets` job that runs after the k6 suite
finishes. It downloads the most recent `REBASELINE_WINDOW` (default 7)
`k6-summaries` artifacts via the GitHub REST API, runs
`loadtests/rebaseline-budgets.mjs`, and:

- Computes a per-endpoint rolling p95 (worst per-run p95 across the
  window) plus rolling error rate.
- Compares the rolling p95 to the committed `loadtests/budgets.json`.
- When any endpoint drifts more than `REBASELINE_THRESHOLD` (default
  20%) the job opens (or refreshes) a draft PR titled
  *"loadtest: re-baseline budgets"* containing the candidate file +
  the per-endpoint comparison table. The candidate values are rounded
  up with the same headroom rules listed in 5b below.
- Otherwise the comparison table is posted to the workflow run
  summary so creep is still visible without any human action.

Tunables — set as workflow env vars / repo variables:

- `REBASELINE_WINDOW` — number of recent successful nightly runs to
  aggregate (default 7).
- `REBASELINE_THRESHOLD` — fractional drift that triggers a PR
  (default 0.20 = 20%).

The PR is **draft**: a human still reviews the table, edits the
tested-ceiling table in §1 if needed, then marks it ready and merges.

### 5b. Manual re-baseline (fallback)

Use this when the automated job is disabled or you need a fresh
baseline against a non-CI environment.

1. `git checkout main && npm ci && npm run build`
2. Boot against a fresh DB seeded with a realistic tenant mix
   (`scripts/seed-test-company.ts` × 3 orgs).
3. `BASE_URL=http://localhost:5000 \
    LOAD_TENANT_USERS="..." \
    scripts/run-load-test.sh baseline`
4. Open `loadtests/results/baseline-summary.json`; copy the new
   p95 / error-rate values into `loadtests/budgets.json` (round
   *up*, leave headroom — cheap reads to the next 20 ms, list /
   aggregate reads to the next 50 ms).
5. Update the tested ceiling table at the top of this document.
6. Commit both files in one PR titled "loadtest: re-baseline budgets
   YYYY-MM".

## 6. Out of scope (tracked elsewhere)

- Postgres horizontal sharding (no roadmap commitment yet).
- CDN / image-CDN swap.
- Per-tenant OpenAI keys (BYOK) — separate workstream.
