/**
 * Task #2410 — Provider router with org-level routing + graceful fallback.
 *
 * Decision tree for every Takeoff-family call:
 *   1. Look up the org's `AI_PROVIDER_TAKEOFF` flag.
 *      - true  -> Anthropic primary, OpenAI fallback
 *      - false -> OpenAI primary (no fallback to Anthropic; behavior preserved)
 *   2. If primary throws (network, 5xx, parse), retry once on the secondary
 *      and stamp `fallbackUsed: true` so the audit row makes the swap visible.
 *   3. If neither provider is configured, surface a clear error.
 *
 * Existing AI features (insights, daily run, hiring scoring, etc.) keep using
 * the raw `openai` client — they never call this router.
 */

import { logWarn, logInfo } from "../../utils/logger";
import { openaiProvider } from "./openaiProvider";
import { anthropicProvider } from "./anthropicProvider";
import { isFeatureEnabled } from "../../services/featureFlagService";
import type {
  AiChatRequest,
  AiChatResponse,
  AiProvider,
  AiProviderName,
  TakeoffFeatureKey,
} from "./types";

export type { AiChatRequest, AiChatResponse, AiProviderName, TakeoffFeatureKey } from "./types";

interface ResolvedRouting {
  primary: AiProvider;
  secondary: AiProvider | null;
  source: "flag-anthropic" | "flag-openai" | "anthropic-not-configured";
}

async function resolveRouting(orgId: string): Promise<ResolvedRouting> {
  let preferAnthropic = false;
  try {
    preferAnthropic = await isFeatureEnabled(orgId, "AI_PROVIDER_TAKEOFF");
  } catch (err) {
    logWarn("AI provider flag lookup failed; defaulting to OpenAI", {
      orgId,
      error: String(err),
    });
  }

  if (preferAnthropic) {
    if (!anthropicProvider.isConfigured()) {
      // Flag is on but key missing — log once per call so operators see it,
      // and route to OpenAI without fallback flag (it's the only choice).
      return {
        primary: openaiProvider,
        secondary: null,
        source: "anthropic-not-configured",
      };
    }
    return {
      primary: anthropicProvider,
      secondary: openaiProvider.isConfigured() ? openaiProvider : null,
      source: "flag-anthropic",
    };
  }
  return {
    primary: openaiProvider,
    secondary: null, // existing-org behaviour: don't silently swap to Claude
    source: "flag-openai",
  };
}

/**
 * Recoverable-error heuristic. We retry on:
 *   - network / timeout errors (no `status`)
 *   - HTTP 5xx
 *   - 408 (timeout) / 429 (rate limit) / 529 (Anthropic overloaded)
 * 4xx client errors that aren't 408/429 are NOT retried — those are bugs in
 * the request (bad model name, oversize payload) and would just fail again.
 */
function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  const status = (err as { status?: number }).status;
  if (typeof status !== "number") return true;
  if (status >= 500) return true;
  if (status === 408 || status === 429 || status === 529) return true;
  return false;
}

export interface RouteOptions {
  orgId: string;
  featureKey: TakeoffFeatureKey;
  request: AiChatRequest;
  /**
   * When true (default), failures on the primary provider are retried on the
   * secondary provider. Tests can pass false to assert raw provider behavior.
   */
  allowFallback?: boolean;
}

export async function routedChatCompletion(opts: RouteOptions): Promise<AiChatResponse> {
  const { orgId, featureKey, request } = opts;
  const allowFallback = opts.allowFallback !== false;
  const routing = await resolveRouting(orgId);

  if (routing.source === "anthropic-not-configured") {
    logWarn("AI_PROVIDER_TAKEOFF=on but ANTHROPIC_API_KEY missing — using OpenAI", {
      orgId,
      featureKey,
    });
  }

  try {
    const result = await routing.primary.chatCompletion(request);
    return result;
  } catch (primaryErr) {
    if (!allowFallback || !routing.secondary || !isRetryableError(primaryErr)) {
      throw primaryErr;
    }
    logWarn("AI primary provider failed; falling back", {
      orgId,
      featureKey,
      primary: routing.primary.name,
      secondary: routing.secondary.name,
      error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
    });
    const secondaryResult = await routing.secondary.chatCompletion(request);
    secondaryResult.fallbackUsed = true;
    logInfo("AI fallback succeeded", {
      orgId,
      featureKey,
      provider: secondaryResult.provider,
      latencyMs: secondaryResult.latencyMs,
    });
    return secondaryResult;
  }
}

/**
 * Direct-provider escape hatches. The router is the supported entry point;
 * these are exported so the regression scorecard / tests can pin a provider.
 */
export { openaiProvider, anthropicProvider };
export { ANTHROPIC_MODEL_SONNET_4_5 } from "./anthropicProvider";
