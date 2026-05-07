// Task #2488 — Frontend RUM ingestion endpoint.
//
// The browser bundle (`client/src/lib/webVitals.ts`) ships a beacon to
// `POST /api/observability/web-vitals` on `pagehide` /
// `visibilitychange=hidden` containing the Core Web Vitals samples
// captured for the page. We:
//
//   1. Validate the payload (cheap, schema-light — RUM beacons are
//      anonymous and high-volume, so we avoid heavy work here).
//   2. Update an in-memory rolling-window aggregator that the existing
//      Prometheus `/metrics` endpoint can scrape (see
//      `getWebVitalsSnapshot()` exported below — wired in
//      `server/opsRoutes.ts`).
//   3. Log a structured line for the observability pipeline so the
//      same data lands in Loki/Datadog without needing a new table.
//
// Endpoint is intentionally:
//   - Public (no requireAuth) — vitals fire before login.
//   - CSRF-exempt via the `/api/public/` prefix? No — we keep it
//     under `/api/observability/` and the validateCsrf middleware
//     will exempt it via the explicit allowlist below.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { logInfo } from "./utils/logger";

const METRIC_NAMES = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const;
type MetricName = (typeof METRIC_NAMES)[number];

const beaconSchema = z.object({
  href: z.string().max(2048).optional(),
  pathname: z.string().max(512).optional(),
  timestamp: z.number().optional(),
  connection: z.string().max(32).nullable().optional(),
  metrics: z
    .array(
      z.object({
        name: z.enum(METRIC_NAMES),
        value: z.number().finite(),
        rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
        id: z.string().max(64).optional(),
      }),
    )
    .max(20),
});

// Performance budgets — keep in sync with `client/src/lib/webVitals.ts`
// and `docs/ops/capacity.md` § "Frontend Web Vitals".
const BUDGETS: Record<MetricName, number> = {
  LCP: 2500,
  INP: 200,
  CLS: 100, // CLS is shipped multiplied by 1000 by the client
  TTFB: 800,
  FCP: 1800,
};

// In-memory rolling aggregator: per-metric count, sum, max, and a
// fixed-size reservoir for p75/p95. One process holds at most ~5 ×
// MAX_RESERVOIR floats (~16 KB) so this is safe to leave on by
// default on the autoscaled web tier.
const MAX_RESERVOIR = 1024;
type Agg = {
  count: number;
  goodCount: number;
  niCount: number;
  poorCount: number;
  sum: number;
  max: number;
  reservoir: number[];
};
const agg: Record<MetricName, Agg> = Object.fromEntries(
  METRIC_NAMES.map((n) => [n, fresh()]),
) as Record<MetricName, Agg>;

function fresh(): Agg {
  return { count: 0, goodCount: 0, niCount: 0, poorCount: 0, sum: 0, max: 0, reservoir: [] };
}

function ingest(name: MetricName, value: number, rating?: string) {
  const a = agg[name];
  a.count += 1;
  a.sum += value;
  if (value > a.max) a.max = value;
  if (a.reservoir.length < MAX_RESERVOIR) {
    a.reservoir.push(value);
  } else {
    // Reservoir-style replacement to keep a representative sample.
    const idx = Math.floor(Math.random() * a.count);
    if (idx < MAX_RESERVOIR) a.reservoir[idx] = value;
  }
  const r = rating || (value <= BUDGETS[name] ? "good" : value <= BUDGETS[name] * 2 ? "needs-improvement" : "poor");
  if (r === "good") a.goodCount += 1;
  else if (r === "needs-improvement") a.niCount += 1;
  else a.poorCount += 1;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function getWebVitalsSnapshot() {
  const out: Record<string, { count: number; p75: number; p95: number; max: number; budget: number; goodPct: number }> = {};
  for (const name of METRIC_NAMES) {
    const a = agg[name];
    if (a.count === 0) continue;
    const sorted = [...a.reservoir].sort((x, y) => x - y);
    out[name] = {
      count: a.count,
      p75: percentile(sorted, 75),
      p95: percentile(sorted, 95),
      max: a.max,
      budget: BUDGETS[name],
      goodPct: a.count ? a.goodCount / a.count : 0,
    };
  }
  return out;
}

export function registerWebVitalsRoutes(app: Express) {
  app.post("/api/observability/web-vitals", (req: Request, res: Response) => {
    const parsed = beaconSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(204).end();
    }
    const { metrics, pathname, connection } = parsed.data;
    for (const m of metrics) {
      ingest(m.name, m.value, m.rating);
    }
    // Single structured log line per beacon — keeps cardinality bounded
    // and lets the observability backend run alerts on `rum.poor.rate`.
    logInfo("rum.web_vitals", {
      pathname: pathname?.slice(0, 256),
      connection,
      samples: metrics.length,
      values: Object.fromEntries(metrics.map((m) => [m.name, m.value])),
    });
    // 204 — no content; client uses sendBeacon and ignores the body.
    res.status(204).end();
  });
}
