// Task #2481 — Accounting sync handler.
//
// Wraps the existing Sage / QBO periodic sync entry points so they can
// be triggered from the queue. The cron loop in `server/jobs/jobRunner`
// can be migrated incrementally to enqueue these instead of inline
// invocation.

import { defineJob, type JobContext } from "../index";
import { logError, logInfo } from "../../utils/logger";

export interface AccountingSyncPayload {
  provider: "sage" | "qbo";
  organizationId: string;
}

export function registerAccountingSyncJob(): void {
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
