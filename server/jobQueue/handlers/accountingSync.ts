// Task #2481 — Accounting sync handler.
//
// Wraps the existing Sage / QBO periodic sync entry points so they can
// be triggered from the queue. The cron loop in `server/jobs/jobRunner`
// can be migrated incrementally to enqueue these instead of inline
// invocation.

import { defineJob, onJobFailed, type JobContext } from "../index";
import { logError, logInfo, logWarn } from "../../utils/logger";
import { recordJobMetrics } from "../../utils/jobMetrics";
import { sendEmail } from "../../services/emailService";
import { db } from "../../db";
import { withSystemJobContext } from "../../dbContext";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface AccountingSyncPayload {
  provider: "sage" | "qbo";
  organizationId: string;
}

export function registerAccountingSyncJob(): void {
  onJobFailed("accounting_sync", async (job) => {
    const data = (job.data as Record<string, unknown> | null) ?? {};
    const payload = (data.payload as AccountingSyncPayload | undefined);
    const orgId = (payload?.organizationId ?? data.organizationId) as string | undefined;
    const userId = data.userId as string | undefined;
    const provider = payload?.provider ?? "unknown";
    const errMsg = (data.lastError as string | undefined)
      ?? `accounting_sync for provider "${provider}" failed permanently after ${job.retryCount + 1} attempt(s).`;
    logWarn("accounting_sync permanently failed after all retries", {
      jobId: job.id,
      provider,
      organizationId: orgId,
      retryCount: job.retryCount,
    });
    // Explicit per-job-type final-failure counter for the job metrics dashboard.
    recordJobMetrics("accounting_sync", { final_failure: 1 });
    if (userId && orgId) {
      const subject = "Accounting Sync Failed";
      const message = `Your accounting sync (${provider}) failed permanently. Error: ${errMsg.slice(0, 300)} — check the Job Queue for details.`;
      // In-app notification.
      try {
        const { insertNotification } = await import("../../services/notificationService");
        await insertNotification({
          userId,
          organizationId: orgId,
          type: "GENERAL",
          title: subject,
          message,
          relatedEntityType: "system",
          relatedEntityId: job.id,
        });
      } catch (_notifErr) {
        logWarn(`Could not send failure notification for accounting_sync job ${job.id}`, {});
      }
      // Email the submitting user directly so the failure is not lost in the
      // notification tray (email is the escalation path for permanent failures).
      try {
        const [userRow] = await withSystemJobContext("accounting_sync:failure-email", async () =>
          db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1),
        );
        if (userRow?.email) {
          await sendEmail({
            to: userRow.email,
            subject,
            text: message,
            html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
          });
        }
      } catch (_emailErr) {
        logWarn(`Could not send failure email for accounting_sync job ${job.id}`, {});
      }
    }
  });

  defineJob<AccountingSyncPayload>(
    "accounting_sync",
    async (payload, ctx: JobContext) => {
      await ctx.progress(5, `Starting ${payload.provider} sync`);
      try {
        if (payload.provider === "sage") {
          const { processSagePeriodicSync } = await import(
            "../../integrations/providers/sage/sync"
          );
          const result = await processSagePeriodicSync();
          await ctx.progress(100, "Sage sync complete");
          return result;
        }
        if (payload.provider === "qbo") {
          const mod = (await import(
            "../../integrations/providers/qbo/sync"
          ).catch(() => null)) as Record<string, unknown> | null;
          const fn = mod && (mod.runQboSyncForOrg as unknown);
          if (typeof fn === "function") {
            const result = await (fn as (orgId: string) => Promise<unknown>)(
              payload.organizationId,
            );
            await ctx.progress(100, "QBO sync complete");
            return result;
          }
          logInfo("accounting_sync: QBO entry point not yet exported");
          return { skipped: true, provider: "qbo" };
        }
        return { skipped: true };
      } catch (err) {
        logError(
          `accounting_sync handler failed for ${payload.provider}`,
          { jobId: ctx.jobId },
          err instanceof Error ? err : new Error(String(err)),
        );
        throw err;
      }
    },
    { perTenantConcurrency: 1 },
  );
}
