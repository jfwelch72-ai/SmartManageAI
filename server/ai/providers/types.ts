/**
 * Task #2410 — Multi-provider AI client abstraction.
 *
 * Existing call sites (Takeoff, Heavy-Civil, AI Estimator) pass arguments
 * shaped like OpenAI's chat.completions API and read `.choices[0].message.content`,
 * `.usage.prompt_tokens`, `.usage.completion_tokens`, `.model` off the response.
 *
 * To keep the cut-over surgical we expose an OpenAI-shaped result so call sites
 * change only their function call (not their result handling).
 */

export type AiProviderName = "openai" | "anthropic";

export interface AiTextPart {
  type: "text";
  text: string;
}

export interface AiImageUrlPart {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

export type AiContentPart = AiTextPart | AiImageUrlPart;

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string | AiContentPart[];
}

export interface AiChatRequest {
  messages: AiMessage[];
  /** Provider-agnostic upper bound on completion tokens. */
  max_completion_tokens: number;
  /** When `{type:'json_object'}`, ask the provider to return JSON. */
  response_format?: { type: "json_object" } | { type: "text" };
  /**
   * Optional override; usually omitted so the provider uses its own
   * task-appropriate default (gpt-5.2 / claude-sonnet-4-5).
   */
  model?: string;
  /** Sampling temperature; defaults to provider's standard. */
  temperature?: number;
}

export interface AiChatChoice {
  index: number;
  message: { role: "assistant"; content: string | null };
  finish_reason: string | null;
}

export interface AiChatResponse {
  /** Mirrors OpenAI's `choices` so call sites can keep reading `[0].message.content`. */
  choices: AiChatChoice[];
  usage: { prompt_tokens: number; completion_tokens: number };
  model: string;
  /** Which provider actually answered this request (set after fallback resolution). */
  provider: AiProviderName;
  /** True when the primary provider failed and we silently retried on the secondary. */
  fallbackUsed: boolean;
  /** Latency of the wire call(s) in ms; recorded in the audit row. */
  latencyMs: number;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly defaultModel: string;
  /** Returns true if the provider has the credentials it needs to make a call. */
  isConfigured(): boolean;
  chatCompletion(req: AiChatRequest): Promise<AiChatResponse>;
}

/**
 * Logical labels for every Takeoff-family call site. The router uses the label
 * only for telemetry; routing is decided per-org by `AI_PROVIDER_TAKEOFF`.
 */
export type TakeoffFeatureKey =
  | "takeoff.classify_trade"
  | "takeoff.analyze"
  | "takeoff.verify_detailed"
  | "heavy_civil.bid_tab.extract"
  | "heavy_civil.haul_ticket.ocr"
  | "heavy_civil.idr.summarize"
  | "heavy_civil.swppp.draft_corrective"
  | "heavy_civil.dbe.risk_score"
  | "heavy_civil.mass_haul.analyze"
  | "ai_estimator.takeoff_draft"
  | "ai_estimator.chat"
  | "ai_estimator.estimate_generate"
  | "ai_estimator.sheet_index"
  // Task #2591 — dedicated key for the schedule symbol extractor
  // (door/window/fixture/panel schedules). Split out from
  // `ai_estimator.sheet_index` so per-feature spend caps and AI-router
  // overrides can target schedule-extraction calls independently of
  // sheet classification calls.
  | "ai_estimator.schedule_extract"
  // Task #2414 — Claude-written narrative summary for each indexed
  // knowledge row. Runs at the end of `runIngestion()` for orgs that
  // have AI_PROVIDER_TAKEOFF enabled.
  | "ai_estimator.enrichment"
  // Task #2415 — Claude-powered summarizer that turns EDIT-type feedback
  // events into short qualitative "lessons" written into the knowledge
  // index. Uses JSON mode + ≤300 tokens, fire-and-forget.
  | "ai_estimator.lesson"
  // Task #2423 — Estimation-family migrations onto the provider router so
  // Claude (when AI_PROVIDER_TAKEOFF is on) becomes the primary AI for ALL
  // estimating/takeoff features, not just the AI Estimator.
  | "estimation.analyze"
  | "estimation.scope_predict"
  | "estimation.win_probability"
  | "estimation.vendor_price_extract"
  | "estimation.vendor_price_extract_fallback"
  | "estimation.trade_discovery"
  | "estimation.module_analyze.scheduling"
  | "estimation.module_analyze.delays"
  | "estimation.module_analyze.costs"
  | "estimation.module_analyze.equipment"
  | "estimation.module_analyze.vendor_pricing"
  | "estimation.module_analyze.project_health"
  // Task #2703 — AI-generated skill suggestions from lessons.
  | "ai_estimator.skill_suggestions"
  // Task #2926 — Bid wizard scope extraction moved to Takeoff family (Claude primary).
  | "takeoff.bid_wizard.scope_extract";

/**
 * Task #2684 — Logical labels for every non-Takeoff call site that goes
 * through the General router (`routedGeneralChatCompletion`). Routing is
 * decided per-org by the `AI_PROVIDER_GENERAL` flag (default OFF =
 * OpenAI-only, ON = Anthropic primary with OpenAI fallback). Keep these
 * keys disjoint from `TakeoffFeatureKey` so per-feature spend and audit
 * filters can target each family independently.
 */
export type GeneralFeatureKey =
  // Documents / RFIs / submittals
  | "general.document.analyze"
  | "general.document.contract_analyze"
  | "general.document.compare"
  | "general.document.schedule_extract"
  | "general.document.search_assist"
  | "general.document.intent_classify"
  | "general.document.contract_extract_clause"
  // CRM / Email / Notes
  | "general.email.classify"
  | "general.email.thread_summary"
  | "general.email.reply_draft"
  | "general.email.daily_summary"
  | "general.notes.enrich"
  | "general.call.transcript_summary"
  | "general.coi.extract"
  // Hiring
  | "general.hiring.score_resume"
  // Risk / Health / Productivity / Equipment / Modifiers
  | "general.risk.score"
  | "general.risk.event_summary"
  | "general.project_health.summary"
  | "general.field_productivity.analyze"
  | "general.field_productivity.recommend"
  | "general.equipment.analyze"
  | "general.modifier.suggest"
  // Reporting / Digests
  | "general.executive_digest"
  // Marketing / Website / Social
  | "general.website.copy"
  | "general.website.section"
  | "general.website.brand"
  | "general.website.seo"
  | "general.website.blog_draft"
  | "general.social.post_draft"
  // Scheduling
  | "general.schedule.generate"
  // Onboarding
  | "general.onboarding.color_palette"
  | "general.onboarding.trade_research"
  // Bids
  | "general.bid.text_analysis"
  // Scope of Work / Units of Measure assistants
  | "general.sow.suggest"
  | "general.uom.suggest";

/**
 * Task #2684 — Embedding provider seam. The router emits
 * OpenAI-shaped vectors so any swap (Voyage, Cohere, Bedrock) only needs
 * to map through this interface. `AI_PROVIDER_EMBEDDINGS` is the per-org
 * flag that selects the primary; today only OpenAI is wired in.
 */
export type EmbeddingFeatureKey =
  | "embeddings.document"
  | "embeddings.knowledge"
  | "embeddings.search";

export interface AiEmbeddingRequest {
  /** A single string or batch of strings to embed. */
  input: string | string[];
  /** Optional model override; usually omitted to use provider default. */
  model?: string;
  /** Optional output dimensionality (OpenAI text-embedding-3-* supports this). */
  dimensions?: number;
}

export interface AiEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
  provider: AiProviderName;
  latencyMs: number;
}

export interface AiEmbeddingProvider {
  readonly name: AiProviderName;
  readonly defaultModel: string;
  isConfigured(): boolean;
  createEmbedding(req: AiEmbeddingRequest): Promise<AiEmbeddingResponse>;
}
