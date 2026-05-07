// Task #2481 — Dedicated job worker entrypoint.
//
// Boots the pg-boss queue + handlers WITHOUT the HTTP server. Run via
// the `Job worker` workflow (`tsx server/worker.ts`). On the autoscale
// deployment this can be deployed as a separate background worker.
//
// Env knobs:
//   - DATABASE_URL  (required; same DB the app uses)
//   - PGBOSS_SCHEMA (optional; defaults to "pgboss")

import "dotenv/config";
import { logError, logInfo } from "./utils/logger";
import { initSentry } from "./sentry";
import { installAsyncErrorShim } from "./utils/expressAsyncShim";
import { installCorrelatedFetch } from "./utils/correlatedFetch";
import { startJobQueue, stopJobQueue } from "./jobQueue";
import { registerAllJobHandlers } from "./jobQueue/handlers";

installAsyncErrorShim();
initSentry();
installCorrelatedFetch();

process.on("uncaughtException", (err) => {
  logError("Worker uncaughtException", {}, err);
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logError("Worker unhandledRejection", {}, err);
});

async function main() {
  registerAllJobHandlers();
  await startJobQueue({ withWorkers: true });
  logInfo("Job worker is running. Awaiting work…");
}

async function shutdown(signal: string) {
  logInfo("Job worker shutting down", { signal });
  try {
    await stopJobQueue();
  } catch (err) {
    logError("Job worker shutdown error", {}, err instanceof Error ? err : new Error(String(err)));
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  logError("Job worker failed to start", {}, err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
