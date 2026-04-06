import { logError } from "./utils/logger";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { execSync } from "child_process";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logOAuthRedirectUris } from "./utils/routeHelpers";
import { initializeAIScheduler } from "./ai/scheduler";
import { aiNotesScheduler } from "./aiNotesScheduler";
import { initializeEventBus } from "./events";
import { startOrphanScanScheduler } from "./storageOrphanScanJob";
import { startJobRunner } from "./jobs";
import { backfillMissingFeatureFlags } from "./services/featureFlagService";
import { ensureVideoCallTables } from "./utils/ensureVideoCallTables";
import { ensureEstimateSubcontractorTables } from "./utils/ensureEstimateSubcontractorTables";
import { ensureEquipmentColumns } from "./utils/ensureEquipmentColumns";
import { ensureMessageColumns } from "./utils/ensureMessageColumns";
import { ensureNotificationEnumValues } from "./utils/ensureNotificationEnumValues";
import { ensureEstimateCategoryEnumValues } from "./utils/ensureEstimateCategoryEnumValues";
import { ensureTakeoffEnhancements } from "./utils/ensureTakeoffEnhancements";
import { ensureFieldWorkerPermColumns } from "./utils/ensureFieldWorkerPermColumns";
import { ensurePeerRatingColumns } from "./utils/ensurePeerRatingColumns";
import { ensurePermissionPresetsTable } from "./utils/ensurePermissionPresetsTable";
import { seedBuiltInPresets } from "./dashboardRoutes";

const app = express();

// Trust proxy - Required for accurate IP detection behind Replit proxy
app.set("trust proxy", 1);

app.use(compression());

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: false,
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
  if (depth > 3 || obj === null || obj === undefined) return obj;
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

    logError("Unhandled error in request", {
      method: req.method,
      path: req.path,
      requestId,
    }, err instanceof Error ? err : new Error(String(err)));

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

  // One-time idempotent backfill: any org row with NULL/empty feature_flags
  // gets the full all-enabled set. No-op once data is populated. Runs in all
  // environments so both dev and prod orgs are covered on first restart after
  // this fix was deployed.
  await ensureVideoCallTables();
  await ensureEstimateSubcontractorTables();
  await ensureEquipmentColumns();
  await ensureMessageColumns();
  await ensureNotificationEnumValues();
  await ensureEstimateCategoryEnumValues();
  await ensureTakeoffEnhancements();
  await ensureFieldWorkerPermColumns();
  await ensurePeerRatingColumns();
  await ensurePermissionPresetsTable();
  await seedBuiltInPresets();
  await backfillMissingFeatureFlags();

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
      } catch (_) { /* ignore */ }
      setTimeout(() => {
        server.close();
        server.listen({ port, host: "0.0.0.0", reusePort: true });
      }, 1500);
    } else {
      logError("Server error:", {}, err instanceof Error ? err : new Error(String(err)));
      process.exit(1);
    }
  });

  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    logOAuthRedirectUris();
    
    // AI Schedulers only run in production mode
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      // Initialize AI PM + CFO scheduler (runs at configured daily time, default 6:00 AM)
      initializeAIScheduler().catch(error => {
        logError('Failed to initialize AI scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      });
      
      // Initialize AI Notes Analysis scheduler (hourly + daily at 6 PM)
      try {
        aiNotesScheduler.start();
        console.log('AI Notes Scheduler started successfully');
      } catch (error) {
        logError('Failed to start AI Notes Scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      // Initialize nightly GCS orphan scan (runs at 02:00 daily)
      try {
        startOrphanScanScheduler();
      } catch (error) {
        logError('Failed to start Storage Orphan Scan Scheduler:', {}, error instanceof Error ? error : new Error(String(error)));
      }

      // Start background job runner (outbox, retention, orphan uploads, etc.)
      try {
        startJobRunner();
      } catch (error) {
        logError('Failed to start background job runner:', {}, error instanceof Error ? error : new Error(String(error)));
      }
      
      console.log('AI auto-scan schedulers ENABLED (production mode)');
    } else {
      console.log('AI auto-scan schedulers are DISABLED (development mode)');
      console.log('   Use the manual "Run AI Analysis" button to trigger scans');
      console.log('   Set NODE_ENV=production to enable schedulers');
    }
  });
})();
