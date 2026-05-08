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
      let svc: { result: unknown; blocked?: boolean; reason?: string };
      if (mode === "estimate") {
        const { generateDraftEstimate } = await import(
          "../../services/aiEstimator/draftEstimate"
        );
        svc = await generateDraftEstimate({
          ...(payload.draftOptions as Parameters<typeof generateDraftEstimate>[0]),
          onProgress,
        });
      } else {
        // Task #2577 Phase B — route plan-set drafts through the
        // map-reduce drafter when a `bidId` is supplied (or the caller
        // explicitly opted in via `useMapReduce`). Map-reduce scales
        // to 200+ sheets and emits sheet citations per measurement,
        // replacing the legacy 8-doc cap as the primary path. The
        // legacy `draftTakeoffFromPlans` is retained for project- and
        // standalone-takeoff drafts that don't yet have an indexed
        // bid sheet set.
        const opts = payload.draftOptions as {
          bidId?: string;
          useMapReduce?: boolean;
          organizationId?: string;
          userId?: string;
          disciplines?: string[];
          [k: string]: unknown;
        };
        const shouldMapReduce =
          opts.useMapReduce === true ||
          (opts.useMapReduce !== false && typeof opts.bidId === "string" && opts.bidId.length > 0);
        if (shouldMapReduce && opts.bidId && opts.organizationId && opts.userId) {
          const { mapReduceDraftFromPlans } = await import(
            "../../services/aiEstimator/mapReduceDraft"
          );
          svc = await mapReduceDraftFromPlans({
            organizationId: opts.organizationId,
            userId: opts.userId,
            bidId: opts.bidId,
            disciplines: opts.disciplines,
            onProgress,
          });
          // Task #2625 — Persist successful map-reduce drafts as an
          // immutable revision so estimators can later diff this run
          // against another and promote the deltas. Failures are
          // swallowed inside `recordTakeoffRevision` so revision
          // bookkeeping never breaks a successful draft.
          if (svc.result && typeof svc.result === "object" && Array.isArray((svc.result as { measurements?: unknown }).measurements)) {
            const { recordTakeoffRevision } = await import(
              "../../services/aiEstimator/revisionStore"
            );
            const r = svc.result as Parameters<typeof recordTakeoffRevision>[0]["result"] & {
              modelId?: string | null;
              provider?: string | null;
            };
            const revision = await recordTakeoffRevision({
              organizationId: opts.organizationId,
              bidId: opts.bidId,
              userId: opts.userId,
              result: r,
              disciplines: opts.disciplines ?? null,
              mode: "map_reduce",
              modelId: r.modelId ?? null,
              provider: r.provider ?? null,
            });
            if (revision) {
              (svc.result as Record<string, unknown>).revisionId = revision.id;
            }
          }
        } else {
          const { draftTakeoffFromPlans } = await import(
            "../../services/aiEstimator/takeoffDraft"
          );
          svc = await draftTakeoffFromPlans({
            ...(payload.draftOptions as Parameters<typeof draftTakeoffFromPlans>[0]),
            onProgress,
          });
        }
      }
      await ctx.progress(100, "Draft complete");
      logInfo("AI estimator draft completed via queue", { jobId: ctx.jobId, mode });
      // Task #2517 — Normalize to the legacy client contract:
      // success → spread the draft fields (`lines`/`measurements`,
      // `notes`, `confidence`, ...) at the top level; missing/blocked
      // result → `{ fallback: true, message }` so existing UI handlers
      // surface the toast unchanged.
      if (svc.result && typeof svc.result === "object") {
        return svc.result;
      }
      return {
        fallback: true,
        blocked: svc.blocked ?? false,
        message: svc.reason ?? "AI estimator returned no usable draft",
      };
    },
    { perTenantConcurrency: 1 },
  );
}
