// Task #2481 — AI takeoff analyze handler.
//
// Wraps the existing `processAiTakeoff` so the long-running OpenAI /
// Claude calls live on the queue instead of a fire-and-forget
// `setTimeout` inside the HTTP request.

import { defineJob, type JobContext } from "../index";
import { processAiTakeoff } from "../../aiTakeoffFeatureRoutes";

export interface AiTakeoffJobPayload {
  analysisId: string;
  tradeType: string;
  focusAreas?: string[];
  needsAutoDetection?: boolean;
  userId: string | null;
}

export function registerAiTakeoffJob(): void {
  defineJob<AiTakeoffJobPayload>(
    "ai_takeoff_analyze",
    async (payload, ctx: JobContext) => {
      await ctx.progress(5, "Starting AI takeoff analysis");
      await processAiTakeoff(
        payload.analysisId,
        payload.tradeType,
        payload.focusAreas,
        payload.needsAutoDetection,
        payload.userId,
      );
      await ctx.progress(100, "Analysis complete", { analysisId: payload.analysisId });
      return { analysisId: payload.analysisId };
    },
    { perTenantConcurrency: 2 },
  );
}
