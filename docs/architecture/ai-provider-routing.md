# AI Provider Routing

> Task #2684 — single source of truth for the AI provider abstraction.
> Read this before adding a new LLM call site.

## TL;DR

Three router entrypoints — pick the right one for the call:

| Entrypoint | Family flag | Default behavior | When to use |
| --- | --- | --- | --- |
| `routedChatCompletion` | `AI_PROVIDER_TAKEOFF` | OpenAI primary; Anthropic primary when flag ON | Takeoff / Estimator / Heavy-Civil family (`TakeoffFeatureKey`) |
| `routedGeneralChatCompletion` | `AI_PROVIDER_GENERAL` | OpenAI primary, **no fallback** when flag OFF (byte-identical to legacy `openai.chat.completions.create`); Anthropic primary with OpenAI fallback when flag ON | Every other chat-completion call site (`GeneralFeatureKey`) |
| `routedEmbedding` | `AI_PROVIDER_EMBEDDINGS` | Always OpenAI today (no alternate provider wired in) | Every embedding call site (`EmbeddingFeatureKey`) |

All three live under `server/ai/providers/`. CI guard
`scripts/check-ai-router-bypass.mjs` (wired into `scripts/ci.sh`) fails the
build if any new file under `server/` calls
`openai.chat.completions.create` directly without either importing a
router entrypoint OR carrying an explicit `// ai-router-bypass: <reason>`
annotation.

## Why a router?

1. **Per-org provider choice.** Tenants can be moved between OpenAI and
   Anthropic without touching code. The flag flip happens via the
   feature-flag UI; the next request honors it.
2. **Automatic fallback.** When the primary provider returns a retryable
   error (rate-limit, 5xx, timeout) the router silently retries on the
   secondary. Audit logs record `fallbackUsed = true`.
3. **Per-call attribution.** Every call records `provider`, `model`,
   `tokensIn/out`, `cost`, `fallbackUsed`, `latencyMs` to
   `ai_action_audit` via `governedAiCall`. The router exposes the same
   shape as a legacy OpenAI completion (`choices[0].message.content`,
   `usage.{prompt,completion}_tokens`, `model`) so callers don't need
   downstream changes.
4. **Pre/post-flight billing.** `checkBillingQuota` runs before the
   provider call (fails fast with HTTP 402) and `consumeBillingUsage`
   meters `ai_tokens` + `ai_jobs` post-call against
   `organization_subscriptions` quotas.

## How to add a new General-family call site

```ts
import { routedGeneralChatCompletion } from "./ai/providers";
import { governedAiCall } from "./services/aiGovernance";

const governed = await governedAiCall({
  orgId,
  userId: req.user.id,
  actionType: "my_feature_action",
  inputRefs: { somethingShort: "for-audit" },
  fn: async () => {
    const completion = await routedGeneralChatCompletion({
      orgId,
      featureKey: "general.my_feature.action",  // add to GeneralFeatureKey
      request: {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
      },
    });
    return { result: parseAndValidate(completion.choices[0]?.message?.content), completion };
  },
});
```

Then add `"general.my_feature.action"` to the `GeneralFeatureKey` union
in `server/ai/providers/types.ts`. The TypeScript compiler will reject
unknown keys.

## Bypass annotations

Some call sites genuinely cannot route through the abstraction yet.
Document the reason at the top of the file:

```ts
// ai-router-bypass: vision (image_url) pipeline depends on OpenAI-typed
// mixed-content message shape; migration tracked as a follow-up under
// Task #2684.
```

Or — for one specific call inside an otherwise-migrated file — within
the 5 lines immediately before the call:

```ts
// ai-router-bypass: vision photo auto-tag — see top-of-file note.
const completion = await openai.chat.completions.create({...});
```

The CI guard accepts both forms. The annotation is the deliberate,
reviewable acknowledgement that this call site is exempt.

### Common reasons to bypass today

- **Vision (image_url content)** — the provider abstraction supports
  `AiContentPart[]` shapes, but the OpenAI SDK's
  `ChatCompletionMessageParam` typing isn't directly assignable to
  `AiMessage` without a manual rebuild. Migrate when the call is
  refactored anyway.
- **Tool / function calling** — the `tools` / `tool_choice` / function
  schema surface is OpenAI-only today. The Anthropic provider would
  need an equivalent translation layer.
- **Dynamic OpenAI client import** — a few endpoints lazy-load
  `openaiClient` to avoid a startup-time SDK dep. Migrating those
  requires removing the dynamic import.
- **Paired with prompt-injection quarantine envelope** — call sites
  that depend on the document-block mixed content output of
  `quarantineDocumentBlocks` (rather than plain text from
  `quarantineUntrustedText`) re-use the same OpenAI mixed-content
  shape; migrate together with that envelope.

## Embedding seam

Today every embedding call resolves to OpenAI's
`text-embedding-3-large`. The seam is in place so a future
Voyage / Cohere / Bedrock provider can be wired in without touching
callers. Use:

```ts
import { routedEmbedding } from "./ai/providers";

const result = await routedEmbedding({
  orgId,
  featureKey: "embeddings.document",
  request: { input: text },
});
const vector = result.data[0].embedding;
```

The `AI_PROVIDER_EMBEDDINGS` flag is reserved — flipping it ON has no
observable effect today (and logs a warning) because no alternative is
wired in. The flag exists so we can A/B a new provider when one lands.

## Operational levers

- **Default primary (Task #2851)**: `AI_PROVIDER_TAKEOFF` and
  `AI_PROVIDER_GENERAL` are **ON by default** for all new orgs.
  Claude (Anthropic) is the primary for both families; OpenAI is the
  automatic fallback. The flag lookup error path also defaults to
  Anthropic. Existing orgs that stored an explicit `false` for either
  flag continue routing to OpenAI for that family.
- **Per-org Claude opt-out**: set `AI_PROVIDER_TAKEOFF=false` or
  `AI_PROVIDER_GENERAL=false` on the org via Super Admin → Feature Flags
  to revert that family to OpenAI-primary with no fallback.
- **Anthropic outage fallback**: automatic — the router catches
  retryable errors and silently retries on OpenAI. Manual override:
  flip the per-org flag to OFF.
- **Quota gating**: `checkBillingQuota` returns HTTP 402 before the
  provider call when the org has run out of `ai_jobs` and has no
  Stripe metered price configured.
- **Per-call telemetry**: query `ai_action_audit` with `WHERE
  feature_key LIKE 'general.%'` for the General family.

## Reference files

- `server/ai/providers/index.ts` — router entrypoints
  (`routedChatCompletion`, `routedGeneralChatCompletion`).
- `server/ai/providers/types.ts` — `AiChatRequest` / `AiChatResponse` /
  `TakeoffFeatureKey` / `GeneralFeatureKey` /
  `EmbeddingFeatureKey` / `AiEmbeddingProvider`.
- `server/ai/providers/openaiProvider.ts` — OpenAI implementation.
- `server/ai/providers/anthropicProvider.ts` — Anthropic implementation.
- `server/ai/providers/embeddingProvider.ts` — embedding seam.
- `shared/schema/features/flags.ts` — `AI_PROVIDER_TAKEOFF` /
  `AI_PROVIDER_GENERAL` / `AI_PROVIDER_EMBEDDINGS`.
- `scripts/check-ai-router-bypass.mjs` — CI guard.
- `docs/ops/runbook.md` — incident response when a provider is down.
