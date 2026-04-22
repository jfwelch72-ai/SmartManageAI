import * as cron from "node-cron";
import { logError, logInfo } from "./utils/logger";
import {
  runAlertFailureDigest,
  type AlertFailureDigestRunSummary,
} from "./services/transcriptBackfillNotifications";

/**
 * Task #1065 — daily digest of CRM transcript-backfill alert delivery
 * failures.
 *
 * Task #1051 already emails admins the moment an alert delivery fails, but
 * a transient hiccup followed by a recovery still produces a one-off email
 * with no overall context. This once-a-day rollup gives ops a calmer
 * baseline view in addition to the real-time fan-out, and surfaces trends
 * (e.g. the same webhook failing intermittently) that single emails hide.
 *
 * Runs once a day at 07:00 server time. Orgs with zero failures in the
 * window receive nothing.
 */
export class CrmBackfillAlertDigestScheduler {
  private task: ReturnType<typeof cron.schedule> | null = null;

  start() {
    if (this.task) return;
    this.task = cron.schedule("0 7 * * *", async () => {
      try {
        const summary = await runAlertFailureDigest();
        logInfo(
          "[CRM Backfill Alert Digest] daily run complete",
          summary as unknown as Record<string, unknown>,
        );
      } catch (err) {
        logError(
          "[CRM Backfill Alert Digest] daily run failed",
          {},
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });
    logInfo("[CRM Backfill Alert Digest] Scheduler started (daily at 07:00)");
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runOnce(): Promise<AlertFailureDigestRunSummary> {
    return runAlertFailureDigest();
  }
}

export const crmBackfillAlertDigestScheduler =
  new CrmBackfillAlertDigestScheduler();
