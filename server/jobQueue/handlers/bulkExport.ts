// Task #2481 — Bulk export handler.
//
// Generic seam for long-running CSV / PDF export generation. Callers
// enqueue with `{ exportType, params }`; the handler routes to the
// appropriate generator and stores the result via the object storage
// layer. Concrete generators are migrated incrementally — the handler
// records a metric and returns when no generator is registered for the
// export type.

import { defineJob, type JobContext } from "../index";
import { logInfo } from "../../utils/logger";

export interface BulkExportPayload {
  exportType: string;
  params: Record<string, unknown>;
}

type ExportGenerator = (
  params: Record<string, unknown>,
  ctx: JobContext,
) => Promise<{ url?: string; bytes?: number }>;

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
      const result = await gen(payload.params, ctx);
      await ctx.progress(100, "Export complete");
      logInfo("bulk_export completed", { exportType: payload.exportType, jobId: ctx.jobId });
      return result;
    },
    { perTenantConcurrency: 2 },
  );
}
