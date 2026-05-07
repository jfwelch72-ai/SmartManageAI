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
import { consume as consumeBillingUsage, checkQuota as checkBillingQuota, QuotaExceededError } from "../../services/billing/usageMetering";
import {
  buildPriorContextSystemMessage,
  capturePriorContext,
  type PriorContextScope,
} from "../priorContextBridge";
import type {
  AiChatRequest,
  AiChatResponse,
  AiMessage,
  AiProvider,
  AiProviderName,
  TakeoffFeatureKey,
} from "./types";

export type { AiChatRequest, AiChatResponse, AiProviderName, TakeoffFeatureKey } from "./types";
export type { PriorContextScope } from "../priorContextBridge";

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
  /**
   * Task #2423 — opt-in OpenAI→Claude prior-context bridge. When provided,
   * successful responses are captured into an in-memory ring keyed by
   * (orgId, scopeId), and Anthropic-routed calls get the trail prepended as
   * a system message so Claude can orchestrate across sibling features.
   * Omit when the call has no meaningful project/bid scope (e.g. trade
   * discovery before a project exists, vendor PDF extraction).
   */
  priorContext?: PriorContextScope;
}

function withPriorContextSystem(
  request: AiChatRequest,
  scope: PriorContextScope,
): AiChatRequest {
  const priorMsg = buildPriorContextSystemMessage(scope);
  if (!priorMsg) return request;
  const injected: AiMessage = { role: "system", content: priorMsg };
  return { ...request, messages: [injected, ...request.messages] };
}

export async function routedChatCompletion(opts: RouteOptions): Promise<AiChatResponse> {
  const { orgId, featureKey, priorContext } = opts;
  const allowFallback = opts.allowFallback !== false;

  // Task #2482 — pre-flight quota gate. We require headroom for one
  // more ai_jobs unit BEFORE invoking the provider. checkQuota will
  // either return allowed=true (under plan, OR over plan with metered
  // Stripe billing configured), or allowed=false in which case we
  // throw QuotaExceededError so the caller can surface a 402 instead
  // of silently spending tokens for an account that won't be billed.
  // We pass amount=1 for ai_jobs only — token volume isn't known
  // until after the provider responds, so token-tier gating happens
  // post-call inside `consume`.
  const preflight = await checkBillingQuota(orgId, "ai_jobs", 1);
  if (!preflight.allowed) {
    throw new QuotaExceededError(preflight, "ai_jobs");
  }

  const routing = await resolveRouting(orgId);

  if (routing.source === "anthropic-not-configured") {
    logWarn("AI_PROVIDER_TAKEOFF=on but ANTHROPIC_API_KEY missing — using OpenAI", {
      orgId,
      featureKey,
    });
  }

  // Inject prior-context only when the resolved primary is Anthropic. This
  // keeps existing OpenAI-default tenants on a byte-identical request shape.
  const primaryRequest = priorContext && routing.primary.name === "anthropic"
    ? withPriorContextSystem(opts.request, priorContext)
    : opts.request;

  let result: AiChatResponse;
  try {
    result = await routing.primary.chatCompletion(primaryRequest);
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
    // The secondary call uses the original (un-injected) request unless the
    // secondary itself is Anthropic — in practice it never is (secondary is
    // always OpenAI today), but we keep the conditional for symmetry.
    const secondaryRequest = priorContext && routing.secondary.name === "anthropic"
      ? withPriorContextSystem(opts.request, priorContext)
      : opts.request;
    result = await routing.secondary.chatCompletion(secondaryRequest);
    result.fallbackUsed = true;
    logInfo("AI fallback succeeded", {
      orgId,
      featureKey,
      provider: result.provider,
      latencyMs: result.latencyMs,
    });
  }

  if (priorContext) {
    capturePriorContext({
      scope: priorContext,
      featureKey,
      provider: result.provider,
      model: result.model,
      responseText: result.choices[0]?.message?.content ?? null,
    });
  }

  // Task #2482 — meter AI usage per org. `consume` performs the
  // plan-overage decision and, when the org is on Stripe with a
  // metered price configured for the key, emits a Stripe usage record
  // for the overage units. We run it post-call so a slow/missing
  // billing DB never blocks a successful AI response. If the org has
  // already exceeded its plan AND has no metered price configured,
  // `consume` throws QuotaExceededError — we log it; the next
  // pre-flight checkQuota call from the caller will gate further work.
  void (async () => {
    const tokens = (result.usage?.prompt_tokens ?? 0) + (result.usage?.completion_tokens ?? 0);
    try {
      if (tokens > 0) await consumeBillingUsage(orgId, "ai_tokens", tokens);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        logWarn("AI token quota exceeded (call already completed; future calls will be blocked)", {
          orgId,
          featureKey,
          used: e.meter.used,
          limit: e.meter.limit,
        });
      } else {
        logWarn("AI ai_tokens metering failed (non-blocking)", {
          orgId,
          featureKey,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    try {
      await consumeBillingUsage(orgId, "ai_jobs", 1);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        logWarn("AI job quota exceeded (call already completed; future calls will be blocked)", {
          orgId,
          featureKey,
          used: e.meter.used,
          limit: e.meter.limit,
        });
      } else {
        logWarn("AI ai_jobs metering failed (non-blocking)", {
          orgId,
          featureKey,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  })();

  return result;
}

/**
 * Direct-provider escape hatches. The router is the supported entry point;
 * these are exported so the regression scorecard / tests can pin a provider.
 */
export { openaiProvider, anthropicProvider };
export { ANTHROPIC_MODEL_SONNET_4_5 } from "./anthropicProvider";
