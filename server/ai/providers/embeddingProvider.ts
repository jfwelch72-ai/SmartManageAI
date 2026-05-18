/**
 * Task #2684 — Embedding provider router and OpenAI-backed implementation.
 *
 * Today every embedding call resolves to OpenAI's `text-embedding-3-large`.
 * The seam exists so a future Voyage/Cohere/Bedrock provider can be wired
 * in without re-touching every call site. `AI_PROVIDER_EMBEDDINGS` is the
 * per-org flag that selects the primary provider — flipping it ON has no
 * observable effect today because no alternative is wired in yet.
 *
 * Allowlisted by `scripts/check-prompt-injection-guard.mjs`-style guards
 * because this is the transport layer, not a caller.
 */

import OpenAI from "openai";
import { logWarn } from "../../utils/logger";
import { openai } from "../openaiClient";
import { isFeatureEnabled } from "../../services/featureFlagService";
import { resolveOrgKey } from "./orgKeyResolver";
import type {
  AiEmbeddingProvider,
  AiEmbeddingRequest,
  AiEmbeddingResponse,
  EmbeddingFeatureKey,
} from "./types";

export const OPENAI_EMBEDDING_MODEL_DEFAULT = "text-embedding-3-large";

export const openaiEmbeddingProvider: AiEmbeddingProvider = {
  name: "openai",
  defaultModel: OPENAI_EMBEDDING_MODEL_DEFAULT,
  isConfigured() {
    return Boolean(
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    );
  },
  async createEmbedding(req: AiEmbeddingRequest): Promise<AiEmbeddingResponse> {
    const start = Date.now();
    const model = req.model ?? OPENAI_EMBEDDING_MODEL_DEFAULT;
    const params: Record<string, unknown> = { model, input: req.input };
    if (typeof req.dimensions === "number") params.dimensions = req.dimensions;
    const result = await openai.embeddings.create(params as unknown as Parameters<typeof openai.embeddings.create>[0]);
    return {
      data: result.data.map((d) => ({ embedding: d.embedding, index: d.index })),
      model: result.model ?? model,
      usage: {
        prompt_tokens: result.usage?.prompt_tokens ?? 0,
        total_tokens: result.usage?.total_tokens ?? 0,
      },
      provider: "openai",
      latencyMs: Date.now() - start,
    };
  },
};

export interface EmbeddingRouteOptions {
  orgId: string;
  featureKey: EmbeddingFeatureKey;
  request: AiEmbeddingRequest;
}

/**
 * Routed embedding entrypoint. Today this always resolves to the OpenAI
 * provider regardless of `AI_PROVIDER_EMBEDDINGS` because no alternative
 * provider is wired in. The flag is read so operators can verify it is
 * being honored once a second provider lands.
 */
export async function routedEmbedding(
  opts: EmbeddingRouteOptions,
): Promise<AiEmbeddingResponse> {
  let preferAlternate = false;
  try {
    preferAlternate = await isFeatureEnabled(opts.orgId, "AI_PROVIDER_EMBEDDINGS");
  } catch (err) {
    logWarn("Embedding provider flag lookup failed; defaulting to OpenAI", {
      orgId: opts.orgId,
      featureKey: opts.featureKey,
      error: String(err),
    });
  }
  if (preferAlternate) {
    logWarn(
      "AI_PROVIDER_EMBEDDINGS=on but no alternate embedding provider is wired in; using OpenAI",
      { orgId: opts.orgId, featureKey: opts.featureKey },
    );
  }
  // Task #2948 — BYOK: resolve org key FIRST. If the org has its own OpenAI
  // key we use it regardless of whether the platform key is configured —
  // this lets orgs self-serve embeddings even when the platform key is absent.
  const orgKey = await resolveOrgKey(opts.orgId, "openai");
  if (orgKey) {
    const byokClient = new OpenAI({ apiKey: orgKey });
    const start = Date.now();
    const model = opts.request.model ?? OPENAI_EMBEDDING_MODEL_DEFAULT;
    const params: Record<string, unknown> = { model, input: opts.request.input };
    if (typeof opts.request.dimensions === "number") params.dimensions = opts.request.dimensions;
    const raw = await byokClient.embeddings.create(
      params as unknown as Parameters<typeof byokClient.embeddings.create>[0],
    );
    return {
      data: raw.data.map((d) => ({ embedding: d.embedding, index: d.index })),
      model: raw.model ?? model,
      usage: {
        prompt_tokens: raw.usage?.prompt_tokens ?? 0,
        total_tokens: raw.usage?.total_tokens ?? 0,
      },
      provider: "openai",
      latencyMs: Date.now() - start,
      keySource: "org_byok",
    };
  }

  // Fall back to platform provider — enforce configured check only here,
  // after we've already given the BYOK path a chance to run.
  if (!openaiEmbeddingProvider.isConfigured()) {
    throw new Error(
      "Embedding provider not configured: set OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY",
    );
  }
  const result = await openaiEmbeddingProvider.createEmbedding(opts.request);
  return { ...result, keySource: "platform" };
}
