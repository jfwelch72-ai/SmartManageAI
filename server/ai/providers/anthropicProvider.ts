/**
 * Task #2410 — Anthropic Claude implementation of the AiProvider contract.
 *
 * Maps the OpenAI-shaped chat request onto Anthropic Messages API:
 *   - system messages    -> concatenated into the top-level `system` field
 *   - user/assistant     -> Anthropic messages
 *   - image_url parts    -> {type:'image', source:{type:'base64'|'url', ...}}
 *   - PDF data URL parts -> {type:'document', source:{type:'base64', media_type:'application/pdf', ...}}
 *   - response_format:json_object -> appended instruction + assistant `{` prefill
 *   - max_completion_tokens -> max_tokens
 *
 * Vision parity: every Takeoff/Heavy-Civil call site passes images to Claude
 * the same way it does to GPT, so the routing decision is transparent.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logError } from "../../utils/logger";
import type {
  AiProvider,
  AiChatRequest,
  AiChatResponse,
  AiMessage,
} from "./types";

// The newest Anthropic model is "claude-sonnet-4-5", released September 29, 2025.
// Do not change without a model-bump task — the prompt budgets and JSON-shape
// expectations downstream were tuned against this model.
export const ANTHROPIC_MODEL_SONNET_4_5 = "claude-sonnet-4-5";

let clientInstance: Anthropic | null = null;
function getClient(): Anthropic {
  if (clientInstance) return clientInstance;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it via Replit Secrets to enable Claude routing.",
    );
  }
  clientInstance = new Anthropic({ apiKey });
  return clientInstance;
}

/**
 * Task #2948 — Creates a one-off Anthropic client using an org-supplied BYOK
 * key. The global singleton is never touched so no cross-org bleed can occur.
 */
function makeClientWithKey(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

interface AnthropicTextBlock { type: "text"; text: string }
interface AnthropicImageBlock {
  type: "image";
  source:
    | { type: "base64"; media_type: string; data: string }
    | { type: "url"; url: string };
}
interface AnthropicDocumentBlock {
  type: "document";
  source:
    | { type: "base64"; media_type: "application/pdf"; data: string }
    | { type: "url"; url: string };
}
type AnthropicBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[] | string;
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(url);
  if (!m) return null;
  const mediaType = m[1] || "application/octet-stream";
  const isBase64 = !!m[2];
  if (!isBase64) {
    // Anthropic only accepts base64 for inline media. URL-encoded payloads
    // are rare in this code base; convert to base64 so we don't drop content.
    return { mediaType, data: Buffer.from(decodeURIComponent(m[3]), "utf8").toString("base64") };
  }
  return { mediaType, data: m[3] };
}

function imageBlockFromUrl(url: string): AnthropicImageBlock | AnthropicDocumentBlock | null {
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    if (!parsed) return null;
    if (parsed.mediaType === "application/pdf") {
      return {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: parsed.data },
      };
    }
    return {
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
    };
  }
  // Public-fetchable URL — Anthropic supports url image sources.
  if (url.toLowerCase().endsWith(".pdf")) {
    return { type: "document", source: { type: "url", url } };
  }
  return { type: "image", source: { type: "url", url } };
}

function partsToAnthropicBlocks(parts: AiMessage["content"]): AnthropicBlock[] {
  if (typeof parts === "string") return [{ type: "text", text: parts }];
  const out: AnthropicBlock[] = [];
  for (const p of parts) {
    if (p.type === "text") {
      if (p.text) out.push({ type: "text", text: p.text });
      continue;
    }
    if (p.type === "image_url") {
      const block = imageBlockFromUrl(p.image_url.url);
      if (block) out.push(block);
      else out.push({ type: "text", text: "[image dropped: unparseable data url]" });
    }
  }
  return out;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly defaultModel = ANTHROPIC_MODEL_SONNET_4_5;

  /** Task #2948 — when set, bypasses the global singleton for BYOK calls. */
  private readonly overrideClient: Anthropic | null;

  constructor(apiKey?: string) {
    this.overrideClient = apiKey ? makeClientWithKey(apiKey) : null;
  }

  isConfigured(): boolean {
    return !!(this.overrideClient || process.env.ANTHROPIC_API_KEY);
  }

  async chatCompletion(req: AiChatRequest): Promise<AiChatResponse> {
    const startedAt = Date.now();
    const client = this.overrideClient ?? getClient();

    // Pull every system message off the front (in order) and concat. If a
    // caller interleaves system messages later in the conversation we still
    // collect them — Anthropic only has one system slot.
    const systemTexts: string[] = [];
    const conversation: AnthropicMessage[] = [];
    for (const m of req.messages) {
      if (m.role === "system") {
        const text = typeof m.content === "string"
          ? m.content
          : m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map(p => p.text).join("\n");
        if (text) systemTexts.push(text);
        continue;
      }
      conversation.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: partsToAnthropicBlocks(m.content),
      });
    }

    let systemPrompt = systemTexts.join("\n\n");
    const wantsJson = req.response_format?.type === "json_object";
    if (wantsJson) {
      systemPrompt = `${systemPrompt}\n\nReturn ONLY a single valid JSON object — no prose, no markdown fences, no explanation before or after.`.trim();
    }

    // Anthropic requires the conversation to start with a user turn. If the
    // caller only sent system messages (rare; defensive), inject a tiny user
    // turn so the API doesn't 400.
    if (conversation.length === 0) {
      conversation.push({ role: "user", content: [{ type: "text", text: "Proceed." }] });
    } else if (conversation[0].role !== "user") {
      conversation.unshift({ role: "user", content: [{ type: "text", text: "Proceed." }] });
    }

    // JSON-mode prefill: nudge the model to emit a JSON object by pre-seeding
    // the assistant turn with `{`. We strip the prefill back off in post.
    let prefilled = false;
    if (wantsJson) {
      conversation.push({ role: "assistant", content: [{ type: "text", text: "{" }] });
      prefilled = true;
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model || this.defaultModel,
      max_tokens: Math.max(1, Math.min(req.max_completion_tokens || 1024, 16384)),
      system: systemPrompt || undefined,
      messages: conversation as unknown as Anthropic.MessageParam[],
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(params);
    } catch (err) {
      logError("Anthropic chatCompletion failed", { model: params.model }, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const finalText = prefilled ? `{${text}` : text;

    return {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: finalText || null },
          finish_reason: response.stop_reason ?? null,
        },
      ],
      usage: {
        prompt_tokens: response.usage?.input_tokens ?? 0,
        completion_tokens: response.usage?.output_tokens ?? 0,
      },
      model: response.model || params.model,
      provider: "anthropic",
      fallbackUsed: false,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export const anthropicProvider = new AnthropicProvider();

/**
 * Task #2948 — BYOK factory: creates a one-off Anthropic provider that uses
 * the supplied org-level API key instead of the platform env-var key.
 */
export function createAnthropicProviderWithKey(apiKey: string): AnthropicProvider {
  return new AnthropicProvider(apiKey);
}
