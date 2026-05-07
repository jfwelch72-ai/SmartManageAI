// Task #2481 — AI Estimator draft handler.
//
// Wraps `draftTakeoffFromPlans` and `generateDraftEstimate` so estimator
// drafts run on the queue with retries / DLQ / per-tenant fairness like
// other long-running AI work. Callers enqueue with the same options
// object the underlying service expects, plus a `mode` discriminator.

import { defineJob, type JobContext } from "../index";
import { logInfo } from "../../utils/logger";

export interface AiEstimatorJobPayload {
  mode?: "takeoff" | "estimate";
  draftOptions: Record<string, unknown>;
}

export function registerAiEstimatorJob(): void {
  defineJob<AiEstimatorJobPayload>(
    "ai_estimator_draft",
    async (payload, ctx: JobContext) => {
      const mode = payload.mode ?? "takeoff";
      await ctx.progress(5, `Starting estimator ${mode} draft`);
      // Task #2535 — bridge per-phase progress emitted by the underlying
      // service ("Indexing sheets" / "Calling AI" / "Validating draft" /
      // etc.) to the job queue's progress channel so any UI subscribed
      // to the job id sees the bar advance through real phases instead
      // of jumping from 0 → 100.
      const onProgress = async (pct: number, message: string): Promise<void> => {
        await ctx.progress(pct, message);
      };
      // Lazy-import to keep boot fast and to avoid pulling unrelated
      // service dependencies into the HTTP-only pod.
      let result: unknown;
      if (mode === "estimate") {
        const { generateDraftEstimate } = await import(
          "../../services/aiEstimator/draftEstimate"
        );
        result = await generateDraftEstimate({
          ...(payload.draftOptions as Parameters<typeof generateDraftEstimate>[0]),
          onProgress,
        });
      } else {
        const { draftTakeoffFromPlans } = await import(
          "../../services/aiEstimator/takeoffDraft"
        );
        result = await draftTakeoffFromPlans({
          ...(payload.draftOptions as Parameters<typeof draftTakeoffFromPlans>[0]),
          onProgress,
        });
      }
      await ctx.progress(100, "Draft complete");
      logInfo("AI estimator draft completed via queue", { jobId: ctx.jobId, mode });
      return result;
    },
    { perTenantConcurrency: 1 },
  );
}
