// Task #2481 — Bulk export handler.
//
// Generic seam for long-running CSV / PDF export generation. Callers
// enqueue with `{ exportType, params }`; the handler routes to the
// appropriate generator and stores the result via the object storage
// layer. Concrete generators are migrated incrementally — the handler
// records a metric and returns when no generator is registered for the
// export type.

import { defineJob, onJobFailed, type JobContext } from "../index";
import { logInfo, logWarn } from "../../utils/logger";
import { recordJobMetrics } from "../../utils/jobMetrics";
import { sendEmail } from "../../services/emailService";
import { db } from "../../db";
import { withSystemJobContext } from "../../dbContext";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface BulkExportPayload {
  exportType: string;
  params: Record<string, unknown>;
}

export interface ExportGeneratorResult {
  url?: string;
  bytes?: number;
  // Inline payload for small / JSON exports streamed back via
  // `GET /api/jobs/:id` instead of object storage.
  data?: unknown;
  filename?: string;
}

type ExportGenerator = (
  params: Record<string, unknown>,
  ctx: JobContext,
) => Promise<ExportGeneratorResult>;

const generators = new Map<string, ExportGenerator>();

/**
 * Register a generator for a given export type. Call from the route
 * module that owns the export (e.g. payroll, change orders) at boot.
 */
export function registerExportGenerator(
  exportType: string,
  generator: ExportGenerator,
): void {
  generators.set(exportType, generator);
}

export function registerBulkExportJob(): void {
  onJobFailed("bulk_export", async (job) => {
    const data = (job.data as Record<string, unknown> | null) ?? {};
    const payload = (data.payload as BulkExportPayload | undefined);
    const exportType = payload?.exportType ?? (data.exportType as string | undefined) ?? "unknown";
    const orgId = (data.organizationId ?? (payload?.params as Record<string, unknown> | undefined)?.organizationId) as string | undefined;
    const userId = data.userId as string | undefined;
    const errMsg = (data.lastError as string | undefined)
      ?? `bulk_export for type "${exportType}" failed permanently after ${job.retryCount + 1} attempt(s).`;
    logWarn("bulk_export permanently failed after all retries", {
      jobId: job.id,
      exportType,
      retryCount: job.retryCount,
    });
    // Explicit per-job-type final-failure counter for the job metrics dashboard.
    recordJobMetrics("bulk_export", { final_failure: 1 });
    if (userId && orgId) {
      const subject = "Export Failed";
      const message = `Your "${exportType}" export failed permanently. Error: ${errMsg.slice(0, 300)} — check the Job Queue for details.`;
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
        logWarn(`Could not send failure notification for bulk_export job ${job.id}`, {});
      }
      // Email the submitting user directly so the failure is not lost in the
      // notification tray (email is the escalation path for permanent failures).
      try {
        const [userRow] = await withSystemJobContext("bulk_export:failure-email", async () =>
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
        logWarn(`Could not send failure email for bulk_export job ${job.id}`, {});
      }
    }
  });

  defineJob<BulkExportPayload>(
    "bulk_export",
    async (payload, ctx: JobContext) => {
      await ctx.progress(5, `Starting ${payload.exportType} export`);
      const gen = generators.get(payload.exportType);
      if (!gen) {
        // Fail loudly so missing wiring shows up in DLQ/admin instead
        // of reporting false success.
        const err = new Error(
          `bulk_export: no generator registered for exportType="${payload.exportType}" (call registerExportGenerator at boot)`,
        );
        logInfo("bulk_export failing — generator not registered", {
          exportType: payload.exportType,
        });
        throw err;
      }
      // Task #2535 — emit a couple of intermediate steps before/after the
      // generator runs so any UI subscribed to the job id sees the bar
      // advance even when the generator itself doesn't emit progress.
      // Generators that DO call `ctx.progress(...)` will overwrite these.
      await ctx.progress(20, `Gathering ${payload.exportType} data`);
      const result = await gen(payload.params, ctx);
      await ctx.progress(95, "Finalizing export file");
      await ctx.progress(100, "Export complete");
      logInfo("bulk_export completed", { exportType: payload.exportType, jobId: ctx.jobId });
      return result;
    },
    { perTenantConcurrency: 2 },
  );
}
