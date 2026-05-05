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
  // Task #2414 — Claude-written narrative summary for each indexed
  // knowledge row. Runs at the end of `runIngestion()` for orgs that
  // have AI_PROVIDER_TAKEOFF enabled.
  | "ai_estimator.enrichment";
