import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeAIScheduler } from "./ai/scheduler";
import { aiNotesScheduler } from "./aiNotesScheduler";

const app = express();

// Trust proxy - Required for accurate IP detection behind Replit proxy
app.set("trust proxy", 1);

// CORS Configuration - Fixed default to localhost:5173
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // AI Schedulers only run in production mode
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      // Initialize AI PM + CFO scheduler (runs at configured daily time, default 6:00 AM)
      initializeAIScheduler().catch(error => {
        console.error('Failed to initialize AI scheduler:', error);
      });
      
      // Initialize AI Notes Analysis scheduler (hourly + daily at 6 PM)
      try {
        aiNotesScheduler.start();
        console.log('AI Notes Scheduler started successfully');
      } catch (error) {
        console.error('Failed to start AI Notes Scheduler:', error);
      }
      
      console.log('AI auto-scan schedulers ENABLED (production mode)');
    } else {
      console.log('AI auto-scan schedulers are DISABLED (development mode)');
      console.log('   Use the manual "Run AI Analysis" button to trigger scans');
      console.log('   Set NODE_ENV=production to enable schedulers');
    }
  });
})();
