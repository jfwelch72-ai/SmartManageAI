/**
 * Operational Routes
 * 
 * Health checks, readiness probes, and operational endpoints
 * for load balancers and monitoring systems.
 *
 * @openapi
 * /healthz:
 *   get:
 *     tags: [Operations]
 *     summary: Health check endpoint
 *     description: Returns basic health status. Used by load balancers. Always returns 200 if the server is running.
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 timestamp: { type: string, format: date-time }
 * /readyz:
 *   get:
 *     tags: [Operations]
 *     summary: Readiness check
 *     description: Returns 200 if the server and database are ready to accept traffic.
 *     security: []
 *     responses:
 *       200:
 *         description: Server is ready
 *       503:
 *         description: Server is not ready (e.g. database unreachable)
 * /api/ops/status:
 *   get:
 *     tags: [Operations]
 *     summary: Detailed system status
 *     description: Returns detailed operational status including database connectivity, uptime, and monitoring metrics.
 *     security: []
 *     responses:
 *       200:
 *         description: Detailed status report
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { logInfo, logError } from './utils/logger';
import { getMonitoringStatus } from './utils/monitoring';
import { getPoolStats } from './utils/poolHealth';
import { getAllJobMetrics } from './utils/jobMetrics';
import { getWebVitalsSnapshot } from './webVitalsRoutes';
import { getPromptInjectionMetricsSnapshot } from './ai/promptInjectionGuard';
import { getCronMissedTicksSnapshot } from './utils/cronMissedTicks';

const router = Router();

// Rate limiter for ops endpoints (protect against brute force)
const opsRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // 30 requests per minute
  message: { error: 'Too many requests to ops endpoints' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /healthz - Health check endpoint
 * 
 * Returns basic health status. Used by load balancers.
 * Always returns 200 if the server is running.
 * No authentication required.
 */
router.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

/**
 * GET /readyz - Readiness check endpoint
 * 
 * Checks if the application is ready to serve traffic.
 * Verifies database connectivity.
 * No authentication required.
 */
router.get('/readyz', async (_req, res) => {
  const checks: { name: string; status: 'ok' | 'fail'; latencyMs?: number; error?: string }[] = [];

  // Check database connectivity
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.push({
      name: 'database',
      status: 'ok',
      latencyMs: Date.now() - dbStart,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    checks.push({
      name: 'database',
      status: 'fail',
      latencyMs: Date.now() - dbStart,
      error: errorMessage,
    });
    logError('Readiness check failed: Database unavailable', {}, error as Error);
  }

  // Overall status
  const allOk = checks.every((c) => c.status === 'ok');

  if (allOk) {
    res.status(200).json({
      status: 'ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/ops/status - Extended status endpoint (requires auth in production)
 * 
 * Provides detailed operational status for debugging.
 * In development, accessible without auth.
 * Rate limited to 30 requests/minute.
 */
router.get('/api/ops/status', opsRateLimiter, (_req, res) => {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (!isDev) {
    // In production, require some form of auth header
    const authHeader = _req.headers['x-ops-token'];
    const expectedToken = process.env.OPS_STATUS_TOKEN;
    
    if (!expectedToken || authHeader !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const monitoring = getMonitoringStatus();

  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    },
    monitoring,
    node: {
      version: process.version,
      platform: process.platform,
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/api/ops/health-check', opsRateLimiter, async (_req, res) => {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const authHeader = _req.headers['x-ops-token'];
    const expectedToken = process.env.OPS_STATUS_TOKEN;
    if (!expectedToken || authHeader !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const checks: { name: string; status: 'ok' | 'fail'; detail?: string }[] = [];

  const cspHeader = res.getHeader('content-security-policy');
  checks.push({
    name: 'csp',
    status: cspHeader ? 'ok' : 'fail',
    detail: cspHeader ? 'CSP headers active' : 'CSP headers not detected',
  });

  try {
    const result = await db.execute(sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'error_logs') AS exists`);
    const tableExists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
    checks.push({
      name: 'error_logging',
      status: tableExists ? 'ok' : 'fail',
      detail: tableExists ? 'error_logs table exists' : 'error_logs table not found',
    });
  } catch (error) {
    checks.push({
      name: 'error_logging',
      status: 'fail',
      detail: 'Failed to verify error_logs table',
    });
  }

  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ name: 'database', status: 'ok' });
  } catch {
    checks.push({ name: 'database', status: 'fail', detail: 'Database unreachable' });
  }

  const allOk = checks.every((c) => c.status === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /metrics - Prometheus-format metrics endpoint.
 *
 * Exposes a small, hand-rolled set of process + business gauges/counters
 * in the Prometheus text-exposition format so any standard scraper
 * (Prometheus, Grafana Agent, Datadog OpenMetrics, BetterStack, etc.) can
 * ingest without us having to take a hard dependency on `prom-client`.
 *
 * Authentication: when `OPS_METRICS_TOKEN` is set, requests must carry a
 * matching `Authorization: Bearer <token>` header. When unset (typical in
 * dev), the endpoint is open. In production we recommend always setting
 * the token and scraping over the private network.
 *
 * See `docs/ops/metrics.md` for the full catalog and scrape examples.
 */
router.get('/metrics', opsRateLimiter, (req, res) => {
  const expected = process.env.OPS_METRICS_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';
  // Secure-by-default in production: refuse to serve metrics if the
  // operator forgot to set OPS_METRICS_TOKEN. Open in dev for easy
  // local inspection.
  if (isProd && !expected) {
    return res.status(503).type('text/plain').send('# metrics disabled: OPS_METRICS_TOKEN not set\n');
  }
  if (expected) {
    const auth = req.headers['authorization'];
    const token = typeof auth === 'string' && auth.startsWith('Bearer ')
      ? auth.slice('Bearer '.length).trim()
      : null;
    if (token !== expected) {
      return res.status(401).type('text/plain').send('# unauthorized\n');
    }
  }

  const lines: string[] = [];
  const push = (name: string, help: string, type: 'counter' | 'gauge', value: number, labels?: Record<string, string>) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    const labelStr = labels && Object.keys(labels).length
      ? `{${Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',')}}`
      : '';
    lines.push(`${name}${labelStr} ${value}`);
  };

  // Process / runtime
  const mem = process.memoryUsage();
  push('app_process_uptime_seconds', 'Process uptime in seconds.', 'gauge', process.uptime());
  push('app_process_memory_heap_used_bytes', 'V8 heap used.', 'gauge', mem.heapUsed);
  push('app_process_memory_heap_total_bytes', 'V8 heap total.', 'gauge', mem.heapTotal);
  push('app_process_memory_rss_bytes', 'Resident set size.', 'gauge', mem.rss);

  // DB pool
  try {
    const pool = getPoolStats();
    push('app_db_pool_active', 'Active (checked-out) DB connections.', 'gauge', pool.active);
    push('app_db_pool_idle', 'Idle DB connections.', 'gauge', pool.idle);
    push('app_db_pool_waiting', 'Clients waiting for a DB connection.', 'gauge', pool.waiting);
    push('app_db_pool_total', 'Total DB connections (active + idle).', 'gauge', pool.total);
    push('app_db_pool_max', 'Configured max pool size.', 'gauge', pool.max);
  } catch (err) {
    logError('Failed to read DB pool stats for /metrics', {}, err as Error);
  }

  // Job counters (rolling 24h totals from the in-process ring buffer).
  // Cardinality is bounded by the number of registered jobs (currently <50)
  // so emitting one series per (job, counter) pair is safe.
  try {
    const jobs = getAllJobMetrics();
    let helpEmitted = false;
    if (jobs.length && !helpEmitted) {
      lines.push('# HELP app_job_counter_total Background job counter totals over the 24h in-process window.');
      lines.push('# TYPE app_job_counter_total counter');
      helpEmitted = true;
    }
    for (const j of jobs) {
      for (const [counter, value] of Object.entries(j.totals)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const safeJob = String(j.job).replace(/[^A-Za-z0-9_]/g, '_');
        const safeCounter = String(counter).replace(/[^A-Za-z0-9_]/g, '_');
        lines.push(`app_job_counter_total{job="${safeJob}",counter="${safeCounter}"} ${value}`);
      }
    }
  } catch (err) {
    logError('Failed to read job metrics for /metrics', {}, err as Error);
  }

  // Task #2488 — Frontend RUM gauges. The /api/observability/web-vitals
  // beacon endpoint maintains a rolling-window aggregator; we expose
  // p75 / p95 / good-rate per metric so existing Prometheus scrapers
  // can alert when the budget set in `docs/ops/capacity.md` is breached.
  try {
    const snap = getWebVitalsSnapshot();
    const metricNames = Object.keys(snap);
    if (metricNames.length) {
      lines.push('# HELP app_web_vitals_p95 Frontend Core Web Vital p95 (ms; CLS scaled ×1000).');
      lines.push('# TYPE app_web_vitals_p95 gauge');
      for (const name of metricNames) {
        lines.push(`app_web_vitals_p95{metric="${name}"} ${snap[name].p95}`);
      }
      lines.push('# HELP app_web_vitals_p75 Frontend Core Web Vital p75 (ms; CLS scaled ×1000).');
      lines.push('# TYPE app_web_vitals_p75 gauge');
      for (const name of metricNames) {
        lines.push(`app_web_vitals_p75{metric="${name}"} ${snap[name].p75}`);
      }
      lines.push('# HELP app_web_vitals_good_ratio Fraction of samples rated "good".');
      lines.push('# TYPE app_web_vitals_good_ratio gauge');
      for (const name of metricNames) {
        lines.push(`app_web_vitals_good_ratio{metric="${name}"} ${snap[name].goodPct}`);
      }
      lines.push('# HELP app_web_vitals_samples_total Beacon samples observed since process start.');
      lines.push('# TYPE app_web_vitals_samples_total counter');
      for (const name of metricNames) {
        lines.push(`app_web_vitals_samples_total{metric="${name}"} ${snap[name].count}`);
      }
    }
  } catch (err) {
    logError('Failed to read web-vitals snapshot for /metrics', {}, err as Error);
  }

  // Task #2683 — Prompt-injection detection counter. One series per
  // (route, pattern_id, action) tuple. Cardinality is bounded by the
  // small set of LLM-calling routes × ~12 pattern ids × 3 actions
  // (flagged / refused / quarantined). See
  // `docs/architecture/prompt-injection.md` and
  // `docs/runbooks/observability.md` for triage steps.
  try {
    const piSnap = getPromptInjectionMetricsSnapshot();
    if (piSnap.length) {
      lines.push('# HELP ai_prompt_injection_detections_total Prompt-injection detections per LLM-calling route, partitioned by pattern_id and action (flagged|refused|quarantined).');
      lines.push('# TYPE ai_prompt_injection_detections_total counter');
      for (const row of piSnap) {
        lines.push(
          `ai_prompt_injection_detections_total{route="${row.route}",pattern_id="${row.patternId}",action="${row.action}"} ${row.value}`,
        );
      }
    }
  } catch (err) {
    logError('Failed to read prompt-injection metrics for /metrics', {}, err as Error);
  }

  // Task #2753 — Cron missed-tick counter. Emitted by `scheduleCron()`
  // in `server/jobs/jobRunner.ts` whenever node-cron fires an
  // `execution:missed` event — which happens when the event loop was too
  // busy to fire the cron on time. A non-zero value in production is a
  // signal that the scheduler is still being starved and needs attention.
  try {
    const missedTicks = getCronMissedTicksSnapshot();
    if (missedTicks.length) {
      lines.push('# HELP cron_missed_ticks_total Number of cron execution:missed events since process start, per job.');
      lines.push('# TYPE cron_missed_ticks_total counter');
      for (const { job, value } of missedTicks) {
        const safeJob = job.replace(/[^A-Za-z0-9_]/g, '_');
        lines.push(`cron_missed_ticks_total{job="${safeJob}"} ${value}`);
      }
    }
  } catch (err) {
    logError('Failed to read cron missed-tick counters for /metrics', {}, err as Error);
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

export default router;
