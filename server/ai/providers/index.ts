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
import { openaiProvider, createOpenAIProviderWithKey } from "./openaiProvider";
import { anthropicProvider, createAnthropicProviderWithKey } from "./anthropicProvider";
import { isFeatureEnabled } from "../../services/featureFlagService";
import { consume as consumeBillingUsage, checkQuota as checkBillingQuota, QuotaExceededError } from "../../services/billing/usageMetering";
import { resolveOrgKey } from "./orgKeyResolver";
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
  GeneralFeatureKey,
  TakeoffFeatureKey,
} from "./types";
import type { FeatureFlagKey } from "@shared/schema";

export type {
  AiChatRequest,
  AiChatResponse,
  AiProviderName,
  GeneralFeatureKey,
  TakeoffFeatureKey,
} from "./types";
export type { PriorContextScope } from "../priorContextBridge";
export {
  openaiEmbeddingProvider,
  routedEmbedding,
  OPENAI_EMBEDDING_MODEL_DEFAULT,
} from "./embeddingProvider";
export type {
  AiEmbeddingRequest,
  AiEmbeddingResponse,
  AiEmbeddingProvider,
  EmbeddingFeatureKey,
} from "./types";

interface ResolvedRouting {
  primary: AiProvider;
  secondary: AiProvider | null;
  source: "flag-anthropic" | "flag-openai" | "anthropic-not-configured";
}

/**
 * Task #2948 — Given per-org BYOK keys (may be null for each provider),
 * substitute the provider instances in the routing result with per-call
 * instances that carry the org key. Returns the updated routing and a
 * Set of provider names that were patched with a BYOK key so callers can
 * determine `keySource` AFTER the call (based on which provider actually
 * answered) rather than before (which could misattribute when a non-BYOK
 * fallback responds).
 */
function applyByokKeys(
  routing: ResolvedRouting,
  openaiKey: string | null,
  anthropicKey: string | null,
): { routing: ResolvedRouting; byokProviders: Set<string> } {
  const byokProviders = new Set<string>();

  // Special case: routing resolved to "anthropic-not-configured" (the flag
  // wanted Anthropic primary but the platform ANTHROPIC_API_KEY is absent).
  // If the org has a BYOK Anthropic key we can recover the intended routing —
  // use Anthropic-BYOK as primary with the platform (or BYOK) OpenAI as fallback.
  if (routing.source === "anthropic-not-configured" && anthropicKey) {
    byokProviders.add("anthropic");
    const fallback = openaiKey
      ? (byokProviders.add("openai"), createOpenAIProviderWithKey(openaiKey))
      : openaiProvider.isConfigured() ? openaiProvider : null;
    return {
      routing: {
        primary: createAnthropicProviderWithKey(anthropicKey),
        secondary: fallback,
        source: routing.source,
      },
      byokProviders,
    };
  }

  const patchProvider = (p: AiProvider): AiProvider => {
    if (p.name === "openai" && openaiKey) {
      byokProviders.add("openai");
      return createOpenAIProviderWithKey(openaiKey);
    }
    if (p.name === "anthropic" && anthropicKey) {
      byokProviders.add("anthropic");
      return createAnthropicProviderWithKey(anthropicKey);
    }
    return p;
  };

  return {
    routing: {
      ...routing,
      primary: patchProvider(routing.primary),
      secondary: routing.secondary ? patchProvider(routing.secondary) : null,
    },
    byokProviders,
  };
}

async function resolveRouting(
  orgId: string,
  flagKey: FeatureFlagKey = "AI_PROVIDER_TAKEOFF",
): Promise<ResolvedRouting> {
  // Task #2851: default to Claude (Anthropic) primary. If the flag lookup
  // fails, we still prefer Anthropic — the fallback chain will recover to
  // OpenAI automatically on any retryable provider error.
  let preferAnthropic = true;
  try {
    preferAnthropic = await isFeatureEnabled(orgId, flagKey);
  } catch (err) {
    logWarn("AI provider flag lookup failed; defaulting to Claude (Anthropic)", {
      orgId,
      flagKey,
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

async function executeRoutedChat(
  orgId: string,
  featureKey: string,
  routing: ResolvedRouting,
  request: AiChatRequest,
  priorContext: PriorContextScope | undefined,
  allowFallback: boolean,
): Promise<AiChatResponse> {
  // Inject prior-context only when the resolved primary is Anthropic. This
  // keeps existing OpenAI-default tenants on a byte-identical request shape.
  const primaryRequest = priorContext && routing.primary.name === "anthropic"
    ? withPriorContextSystem(request, priorContext)
    : request;

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
    const secondaryRequest = priorContext && routing.secondary.name === "anthropic"
      ? withPriorContextSystem(request, priorContext)
      : request;
    result = await routing.secondary.chatCompletion(secondaryRequest);
    result.fallbackUsed = true;
    logInfo("AI fallback succeeded", {
      orgId,
      featureKey,
      provider: result.provider,
      latencyMs: result.latencyMs,
    });
  }
  return result;
}

function meterRoutedUsageAsync(
  orgId: string,
  featureKey: string,
  result: AiChatResponse,
): void {
  // Task #2482 — meter AI usage per org. We run it post-call so a slow/missing
  // billing DB never blocks a successful AI response. If the org has already
  // exceeded its plan AND has no metered price configured, `consume` throws
  // QuotaExceededError — we log it; the next pre-flight checkQuota call from
  // the caller will gate further work.
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

  let routing = await resolveRouting(orgId, "AI_PROVIDER_TAKEOFF");

  if (routing.source === "anthropic-not-configured") {
    logWarn("AI_PROVIDER_TAKEOFF=on but ANTHROPIC_API_KEY missing — using OpenAI", {
      orgId,
      featureKey,
    });
  }

  // Task #2948 — BYOK: resolve any org-supplied provider keys and substitute
  // the provider instances before executing the chat. Runs in parallel for speed.
  const [openaiKey, anthropicKey] = await Promise.all([
    resolveOrgKey(orgId, "openai"),
    resolveOrgKey(orgId, "anthropic"),
  ]);
  const { routing: byokRouting, byokProviders } = applyByokKeys(routing, openaiKey, anthropicKey);
  routing = byokRouting;

  const result = await executeRoutedChat(
    orgId,
    featureKey,
    routing,
    opts.request,
    priorContext,
    allowFallback,
  );
  result.keySource = byokProviders.has(result.provider) ? "org_byok" : "platform";

  if (priorContext) {
    capturePriorContext({
      scope: priorContext,
      featureKey,
      provider: result.provider,
      model: result.model,
      responseText: result.choices[0]?.message?.content ?? null,
    });
  }

  meterRoutedUsageAsync(orgId, featureKey, result);
  return result;
}

/**
 * Task #2684 — General-family routed chat completion. Mirrors
 * `routedChatCompletion` but reads the `AI_PROVIDER_GENERAL` flag (default
 * OFF). When OFF the router resolves to OpenAI primary with NO fallback,
 * which is byte-for-byte identical to a direct
 * `openai.chat.completions.create` call. When ON, eligible orgs get
 * Anthropic Claude primary with OpenAI automatic fallback.
 *
 * Prior-context bridge is intentionally NOT exposed here — General-family
 * features are mostly stand-alone (digest, classification, hiring, copy)
 * and don't need cross-feature memory. Add it later if a use case appears.
 */
export interface GeneralRouteOptions {
  orgId: string;
  featureKey: GeneralFeatureKey;
  request: AiChatRequest;
  allowFallback?: boolean;
}

export async function routedGeneralChatCompletion(
  opts: GeneralRouteOptions,
): Promise<AiChatResponse> {
  const { orgId, featureKey } = opts;
  const allowFallback = opts.allowFallback !== false;

  const preflight = await checkBillingQuota(orgId, "ai_jobs", 1);
  if (!preflight.allowed) {
    throw new QuotaExceededError(preflight, "ai_jobs");
  }

  let routing = await resolveRouting(orgId, "AI_PROVIDER_GENERAL");

  if (routing.source === "anthropic-not-configured") {
    logWarn("AI_PROVIDER_GENERAL=on but ANTHROPIC_API_KEY missing — using OpenAI", {
      orgId,
      featureKey,
    });
  }

  // Task #2948 — BYOK: resolve any org-supplied provider keys and substitute
  // the provider instances before executing the chat. Runs in parallel for speed.
  const [openaiKey, anthropicKey] = await Promise.all([
    resolveOrgKey(orgId, "openai"),
    resolveOrgKey(orgId, "anthropic"),
  ]);
  const { routing: byokRouting, byokProviders } = applyByokKeys(routing, openaiKey, anthropicKey);
  routing = byokRouting;

  const result = await executeRoutedChat(
    orgId,
    featureKey,
    routing,
    opts.request,
    undefined,
    allowFallback,
  );
  result.keySource = byokProviders.has(result.provider) ? "org_byok" : "platform";

  meterRoutedUsageAsync(orgId, featureKey, result);
  return result;
}

/**
 * Direct-provider escape hatches. The router is the supported entry point;
 * these are exported so the regression scorecard / tests can pin a provider.
 */
export { openaiProvider, anthropicProvider };
export { ANTHROPIC_MODEL_SONNET_4_5 } from "./anthropicProvider";
