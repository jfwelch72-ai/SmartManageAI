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

export default router;
