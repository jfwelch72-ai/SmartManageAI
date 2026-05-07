# Metrics

We expose two complementary metric surfaces:

1. **`GET /metrics`** — Prometheus text-exposition format, intended for
   external scrapers (Prometheus, Grafana Agent, Datadog OpenMetrics,
   BetterStack). Defined in `server/opsRoutes.ts`.
2. **`GET /api/admin/metrics/jobs[/<job>]` and
   `GET /api/admin/metrics/pool`** — JSON, intended for the in-app
   Super Admin dashboards (`Jobs Health`, `Pool Health`). Defined in
   `server/routes.ts` and backed by `server/utils/jobMetrics.ts` /
   `server/utils/poolHealth.ts`.

Sentry remains the system-of-record for **errors** (see
`docs/runbooks/observability.md`); `/metrics` is for **counters and
gauges** that should be graphed over time.

## Catalog (`/metrics`)

| Name | Type | Labels | Source |
| --- | --- | --- | --- |
| `app_process_uptime_seconds` | gauge | — | `process.uptime()` |
| `app_process_memory_heap_used_bytes` | gauge | — | `process.memoryUsage().heapUsed` |
| `app_process_memory_heap_total_bytes` | gauge | — | `process.memoryUsage().heapTotal` |
| `app_process_memory_rss_bytes` | gauge | — | `process.memoryUsage().rss` |
| `app_db_pool_active` | gauge | — | `getPoolStats().active` |
| `app_db_pool_idle` | gauge | — | `getPoolStats().idle` |
| `app_db_pool_waiting` | gauge | — | `getPoolStats().waiting` |
| `app_db_pool_total` | gauge | — | `getPoolStats().total` |
| `app_db_pool_max` | gauge | — | configured `Pool { max }` in `server/db.ts` |
| `app_job_counter_total` | counter | `job`, `counter` | rolling 24h totals from `getAllJobMetrics()` |

Job/counter labels are sanitized to `[A-Za-z0-9_]` so Prometheus
ingestion never fails on a stray character. Cardinality is bounded by
the number of registered jobs (currently < 50) × the small fixed set
of counters each job publishes.

### Business signals worth alerting on

These are not separate metric names — they are queries you build on top
of the catalog above. The exact PromQL/LogQL will depend on your
provider; the *intent* is what matters.

| Signal | Built from | Alert threshold |
| --- | --- | --- |
| Request latency p50/p95/p99 | request log lines (`logger.ts`) — scrape via Loki / Datadog logs and aggregate; the JSON `duration` field is the source. | p95 > 2s for 5 minutes |
| AI job duration | `app_job_counter_total{job=~"ai_.*",counter="durationMs"}` rate | sustained > baseline × 3 |
| Pay-app submit count | `app_job_counter_total{job="pay_app_submit",counter="submitted"}` | rate drop > 80% vs same hour last week |
| Sync conflicts | `app_job_counter_total{counter="conflicts"}` | non-zero for 15 minutes |
| Rate-limit hits | `app_job_counter_total{counter="rate_limited"}` | > 100 / hour for any single job |
| DB pool starvation | `app_db_pool_waiting > 0` | sustained for 3 minutes (already paged via `pool_health.waitingSaturated`) |

## Authentication

`/metrics` is open in development. In production, set
`OPS_METRICS_TOKEN` and configure your scraper with:

```
Authorization: Bearer <OPS_METRICS_TOKEN>
```

Requests without the matching token receive `401`. Rate-limited at 30
req/min via the shared `opsRateLimiter`.

## Scrape examples

### Prometheus

```yaml
scrape_configs:
  - job_name: smartmanage
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets: ['app.smartmanage.ai']
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/smartmanage_metrics_token
    scrape_interval: 30s
```

### Datadog OpenMetrics check

```yaml
init_config:
instances:
  - openmetrics_endpoint: https://app.smartmanage.ai/metrics
    namespace: smartmanage
    headers:
      Authorization: Bearer <OPS_METRICS_TOKEN>
    metrics:
      - app_process_*
      - app_db_pool_*
      - app_job_counter_total
```

### Grafana Agent

```river
prometheus.scrape "smartmanage" {
  targets    = [{ "__address__" = "app.smartmanage.ai", "__scheme__" = "https" }]
  metrics_path = "/metrics"
  bearer_token_file = "/var/lib/grafana-agent/smartmanage_token"
  forward_to = [prometheus.remote_write.default.receiver]
}
```

## Adding a new metric

- **Process / system gauge** — add a `push(...)` line in the
  `/metrics` handler in `server/opsRoutes.ts`. Keep names prefixed
  with `app_` and use Prometheus base units (seconds, bytes).
- **Business counter** — call `recordJobMetrics("<jobName>",
  { yourCounter: 1 })` from your code path. The new counter
  automatically shows up under
  `app_job_counter_total{job="<jobName>",counter="yourCounter"}`
  on the next scrape — no schema change needed.
- **Beware label cardinality**: never put a user/org/project ID in a
  label. Use the JSON admin endpoints (which already segregate by
  org) for per-tenant breakdowns.
