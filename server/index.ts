import { logError, logInfo } from "./utils/logger";
import { isDevSeedEnabled } from "./utils/devSeedFlag";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { execSync } from "child_process";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logOAuthRedirectUris } from "./utils/routeHelpers";
import { setCsrfToken, validateCsrf } from "./csrf";
import { initializeAIScheduler } from "./ai/scheduler";
import { aiNotesScheduler } from "./aiNotesScheduler";
import { crmTaskReminderScheduler } from "./crmTaskReminderScheduler";
import { startCrmCsvImportWorker } from "./crmCsvImportWorker";
import { initializeEventBus } from "./events";
import { startOrphanScanScheduler } from "./storageOrphanScanJob";
import { startJobRunner } from "./jobs";
import { startStatusProbeScheduler, runProbeSweep } from "./statusProbeScheduler";
import {
  onGanttPdfQueueFull,
  onGanttPdfBrowserDisconnected,
} from "./gantt-pdf-service";
import {
  reportGanttPdfQueueFull,
  reportGanttPdfBrowserDisconnected,
  startGanttPdfHealthMonitor,
} from "./gantt-pdf-alerts";
import { backfillMissingFeatureFlags } from "./services/featureFlagService";
import { runStartupMigrations } from "./utils/runStartupMigrations";
import { seedBuiltInPresets } from "./dashboardRoutes";
import { persistErrorLog } from "./services/errorLogService";
import { getIntegrationStatus } from "./services/integrationStatusService";
import { initializeGanttPdfHistory } from "./gantt-pdf-service";

process.on("uncaughtException", (err) => {
  logError("Uncaught exception", {}, err);
  persistErrorLog({
    level: "fatal",
    message: err.message,
    stack: err.stack,
    metadata: { type: "uncaughtException" },
  }).catch(() => {});
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logError("Unhandled promise rejection", {}, err);
  persistErrorLog({
    level: "error",
    message: err.message,
    stack: err.stack,
    metadata: { type: "unhandledRejection" },
  }).catch(() => {});
});

const app = express();

// Trust proxy - Required for accurate IP detection behind Replit proxy
app.set("trust proxy", 1);

app.use(compression());

const isProduction = process.env.NODE_ENV === "production";

const livekitDomain = process.env.LIVEKIT_URL
  ? new URL(process.env.LIVEKIT_URL.startsWith("wss://") ? process.env.LIVEKIT_URL.replace("wss://", "https://") : process.env.LIVEKIT_URL).hostname
  : null;
const livekitConnectSrc = livekitDomain
  ? [`wss://${livekitDomain}`, `https://${livekitDomain}`]
  : [];

app.use(helmet({
  contentSecurityPolicy: isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          imgSrc: ["'self'", "data:", "blob:", "https://storage.googleapis.com", "https://*.googleapis.com", "https://*.gstatic.com", "https://*.googleusercontent.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          connectSrc: [
            "'self'",
            "https://*.replit.dev", "wss://*.replit.dev",
            "https://api.openai.com",
            "https://storage.googleapis.com",
            ...livekitConnectSrc,
          ],
          workerSrc: ["'self'", "blob:"],
          childSrc: ["'self'", "blob:"],
          mediaSrc: ["'self'", "blob:", "https://storage.googleapis.com"],
          manifestSrc: ["'self'"],
          frameSrc: livekitDomain ? [`https://${livekitDomain}`] : ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: [
            "'self'",
            "https://accounts.google.com",
            "https://www.facebook.com",
            "https://www.linkedin.com",
            "https://twitter.com",
          ],
          upgradeInsecureRequests: [],
        },
      }
    : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: isProduction ? { policy: "same-origin" } : false,
  crossOriginResourcePolicy: isProduction ? { policy: "same-origin" } : { policy: "cross-origin" },
  frameguard: isProduction ? { action: "deny" } : false,
}));

const allowedOrigins: string[] = [];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);
if (process.env.REPLIT_DEV_DOMAIN) allowedOrigins.push(`https://${process.env.REPLIT_DEV_DOMAIN.trim()}`);
if (process.env.REPLIT_DOMAINS) {
  for (const d of process.env.REPLIT_DOMAINS.split(",")) {
    const trimmed = d.trim();
    if (trimmed) allowedOrigins.push(`https://${trimmed}`);
  }
}
if (allowedOrigins.length === 0) allowedOrigins.push("http://localhost:5173");
app.use(cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  credentials: true,
}));

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(setCsrfToken);
app.use(validateCsrf);

app.use((req, res, next) => {
  if (req.path === '/sw.js') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
  }
  next();
});

const SENSITIVE_KEYS = new Set([
  'password', 'passwordHash', 'password_hash',
  'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'secret', 'sessionSecret', 'apiKey', 'api_key',
  'authorization', 'cookie',
]);
const PII_KEYS = new Set(['email', 'phone', 'recipientEmail']);

function redactForLog(obj: any, depth = 0): any {
  if (depth > 6 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.length > 3 ? `[Array(${obj.length})]` : obj.map(item => redactForLog(item, depth + 1));
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const lk = key.toLowerCase();
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lk)) {
      result[key] = '[REDACTED]';
    } else if (PII_KEYS.has(key) || PII_KEYS.has(lk)) {
      const val = obj[key];
      if (typeof val === 'string' && val.includes('@')) {
        const [local, domain] = val.split('@');
        result[key] = `${local[0]}***@${domain}`;
      } else if (typeof val === 'string' && val.length > 4) {
        result[key] = `***${val.slice(-4)}`;
      } else {
        result[key] = '[REDACTED]';
      }
    } else {
      result[key] = redactForLog(obj[key], depth + 1);
    }
  }
  return result;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(redactForLog(capturedJsonResponse))}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const clientMessage = status >= 500 ? "Internal Server Error" : (err.message || "Internal Server Error");
    const requestId = (req as any).id || (req as any).requestId || undefined;
    const authUser = (req as any).user;

    logError("Unhandled error in request", {
      method: req.method,
      path: req.path,
      requestId,
    }, err instanceof Error ? err : new Error(String(err)));

    persistErrorLog({
      level: status >= 500 ? "error" : "warn",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      method: req.method,
      path: req.path,
      statusCode: status,
      userId: authUser?.id,
      organizationId: authUser?.organizationId,
      requestId,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    }).catch(() => {});

    if (!res.headersSent) {
      res.status(status).json({ error: clientMessage, ...(requestId ? { requestId } : {}) });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);

  // Initialize the internal domain event bus before listening to eliminate any
  // theoretical startup race where a request could arrive before listeners are wired.
  initializeEventBus();

  // Wire Gantt PDF queue/browser events to the alerter and start its monitor.
  onGanttPdfQueueFull(() => reportGanttPdfQueueFull());
  onGanttPdfBrowserDisconnected((at) => reportGanttPdfBrowserDisconnected(at));
  startGanttPdfHealthMonitor();

  // One-time idempotent backfill: any org row with NULL/empty feature_flags
  // gets the full all-enabled set. No-op once data is populated. Runs in all
  // environments so both dev and prod orgs are covered on first restart after
  // this fix was deployed.
  await runStartupMigrations();
  await seedBuiltInPresets();
  await backfillMissingFeatureFlags();

  // Task #722: re-arm any CRM contact reassignment summaries that were
  // buffered before the previous restart so the bundled notification still
  // fires.
  const {
    recoverPendingContactReassignments,
    startContactReassignmentSweeper,
  } = await import("./services/notificationService");
  recoverPendingContactReassignments().catch((err) => {
    logError(
      "Failed to recover pending contact reassignment buffers",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  });
  // Task #730: periodic sweeper picks up rows whose flush_at is well past
  // (e.g. server was down longer than the coalescing window) so no buffer
  // sits orphaned indefinitely.
  startContactReassignmentSweeper();

  // Hydrate persisted Gantt PDF render history from the database so the
  // admin chart survives restarts and deployments.
  initializeGanttPdfHistory().catch((err) => {
    logError("Failed to initialize Gantt PDF render history", {}, err instanceof Error ? err : new Error(String(err)));
  });

  // Task #805 — populate status component health on every cold start so the
  // /status page has data immediately even when the cron scheduler is off
  // (e.g. local dev without ENABLE_SCHEDULERS=true). When the scheduler is
  // enabled it owns its own startup sweep, so we only kick one here in dev
  // to avoid duplicate probe rows.
  if (!isProduction && process.env.ENABLE_SCHEDULERS !== "true") {
    setTimeout(() => {
      runProbeSweep().catch((err) =>
        logError("Initial status probe sweep failed", {}, err instanceof Error ? err : new Error(String(err))),
      );
    }, 8_000).unref?.();
  }

  // DOT pay item libraries: seed AFTER startup migrations so the dot_* tables
  // are guaranteed to exist on cold start.
  try {
    const { seedDotAgenciesAndSpecBooks } = await import("./seedDotAgencies");
    seedDotAgenciesAndSpecBooks().catch(err => {
      logError("Failed to seed DOT agencies:", {}, err instanceof Error ? err : new Error(String(err)));
    });
  } catch (err) {
    logError("Failed to import DOT seeder:", {}, err instanceof Error ? err : new Error(String(err)));
  }

  let portRetryCount = 0;
  const MAX_PORT_RETRIES = 3;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      portRetryCount++;
      if (portRetryCount > MAX_PORT_RETRIES) {
        logError(`Port ${port} is still in use after ${MAX_PORT_RETRIES} attempts. Exiting.`);
        process.exit(1);
      }
      logError(`Port ${port} is in use. Retry ${portRetryCount}/${MAX_PORT_RETRIES}...`);
      try {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      } catch (killErr) { logInfo(`fuser -k ${port}/tcp failed (expected if no process)`, { error: String(killErr) }); }
      setTimeout(() => {
        server.close();
        server.listen({ port, host: "0.0.0.0", reusePort: true });
      }, 1500);
    } else {
      logError("Server error:", {}, err instanceof Error ? err : new Error(String(err)));
      process.exit(1);
    }
  });

  const integrations = getIntegrationStatus();
  const configuredList = Object.entries(integrations)
    .map(([k, v]) => `${k}: ${v ? "configured" : "NOT configured"}`)
    .join(", ");
  log(`Integration status: ${configuredList}`);

  if (isDevSeedEnabled()) {
    log(`Dev seed routes: ENABLED`);
  }

  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    logOAuthRedirectUris();
    
    const schedulersEnabled = isProduction || process.env.ENABLE_SCHEDULERS === "true";

    if (schedulersEnabled) {
      initializeAIScheduler().catch(error => {
        logError('Failed to initialize AI scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      });

      try {
        aiNotesScheduler.start();
        logInfo('AI Notes Scheduler started successfully');
      } catch (error) {
        logError('Failed to start AI Notes Scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      try {
        startOrphanScanScheduler();
      } catch (error) {
        logError('Failed to start Storage Orphan Scan Scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      try {
        startJobRunner();
      } catch (error) {
        logError('Failed to start background job runner:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      try {
        crmTaskReminderScheduler.start();
      } catch (error) {
        logError('Failed to start CRM Task Reminder Scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      try {
        startCrmCsvImportWorker();
      } catch (error) {
        logError('Failed to start CRM CSV Import worker:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      try {
        startStatusProbeScheduler();
      } catch (error) {
        logError('Failed to start Status Probe scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      logInfo(`Background schedulers ENABLED (${isProduction ? 'production' : 'ENABLE_SCHEDULERS=true'})`);
    } else {
      logInfo('Background schedulers are DISABLED (development mode)');
      logInfo('   Set ENABLE_SCHEDULERS=true to enable in dev, or use the manual trigger API');
      logInfo('   POST /api/admin/jobs/:jobName/run — trigger any job on demand (Super Admin)');
    }
  });
})();
