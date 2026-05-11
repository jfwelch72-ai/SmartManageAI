// Task #2761 — Shared helper that encapsulates the "check TILE_RENDERING_ENABLED
// feature flag → conditionally enqueue pdf_tile_prerender" pattern used at three
// dispatch sites (plan-document upload, from-url import, bid conversion).
//
// Extracted into its own module so the gate logic can be unit-tested without
// spinning up the full route / storage function machinery.

import { logWarn } from "../utils/logger";

export interface TileDispatchInput {
  planDocumentId: string;
  organizationId: string;
  userId: string;
  /** Short label used in log messages to identify which upload path triggered the dispatch. */
  site: "upload" | "from-url" | "bid-conversion";
}

export interface TileDispatchResult {
  dispatched: boolean;
  /** Present when the flag was ON and the job was successfully enqueued. */
  jobId?: string;
}

/**
 * Enqueue a `pdf_tile_prerender` job for the given plan document, gated
 * behind the `TILE_RENDERING_ENABLED` feature flag.
 *
 * Returns `{ dispatched: false }` when the flag is OFF (the normal case).
 * Returns `{ dispatched: true, jobId }` when the flag is ON and the job was
 * enqueued.
 *
 * **This function CAN throw** if `isFeatureEnabled` or `enqueueJob` reject.
 * Callers that must not block on enqueue errors should use
 * `tryEnqueueTilePrerender` instead, which wraps this in a try/catch.
 */
export async function maybeEnqueueTilePrerender(
  input: TileDispatchInput,
): Promise<TileDispatchResult> {
  const { isFeatureEnabled } = await import("./featureFlagService");
  const flagOn = await isFeatureEnabled(input.organizationId, "TILE_RENDERING_ENABLED");
  if (!flagOn) {
    return { dispatched: false };
  }

  const { enqueueJob } = await import("../jobQueue");
  const result = await enqueueJob(
    "pdf_tile_prerender",
    { planDocumentId: input.planDocumentId },
    {
      organizationId: input.organizationId,
      userId: input.userId,
      idempotencyKey: `pdf_tile_prerender:${input.planDocumentId}`,
    },
  );
  return { dispatched: true, jobId: result.jobId };
}

/**
 * Wrapper that calls `maybeEnqueueTilePrerender` and swallows any exception,
 * logging a WARN instead. Mirrors the try/catch pattern the three dispatch
 * sites previously used inline.
 */
export async function tryEnqueueTilePrerender(
  input: TileDispatchInput,
): Promise<void> {
  try {
    await maybeEnqueueTilePrerender(input);
  } catch (err) {
    logWarn(`pdf_tile_prerender enqueue failed (${input.site})`, {
      planDocumentId: input.planDocumentId,
      organizationId: input.organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
