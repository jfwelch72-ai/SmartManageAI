// prompt-injection-guard: tool inputs are validated against Zod schemas before any DB write; see chat.ts
// ai-router-bypass: ai-estimator-chat-claude-only-tool-use — this module provides the raw
// Anthropic tool-use call used by the AI Estimator chat. Claude is the only supported
// provider for tool-use in this call path; there is no OpenAI fallback by design.
/**
 * Task #2729 — Raw Anthropic call with tool-use support.
 *
 * This is a low-level escape hatch used ONLY by the AI Estimator chat service
 * when it needs to call Claude with tool definitions. The standard
 * `anthropicProvider.chatCompletion()` does not support tools; this module adds
 * that capability while reusing the same client-init and model constant.
 *
 * Caller is responsible for:
 *   - Building the system prompt + conversation messages
 *   - Defining the tools array (Anthropic.Tool[])
 *   - Parsing and validating the returned tool_use blocks
 *
 * Returns: the raw Anthropic.Message so callers can inspect both text and
 * tool_use content blocks directly.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logError } from "../../utils/logger";
import { ANTHROPIC_MODEL_SONNET_4_5 } from "./anthropicProvider";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it via Replit Secrets to enable Claude routing.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export interface AnthropicWithToolsRequest {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools: Anthropic.Tool[];
  maxTokens?: number;
}

export interface AnthropicToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicWithToolsResponse {
  textContent: string;
  toolUseBlocks: AnthropicToolUseBlock[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  latencyMs: number;
}

/**
 * Call the Anthropic Messages API with tool definitions. On a retryable error
 * (5xx, 429, 529, network) the call is retried ONCE against Claude itself —
 * there is no OpenAI fallback.
 */
export async function callAnthropicWithTools(
  req: AnthropicWithToolsRequest,
): Promise<AnthropicWithToolsResponse> {
  const startedAt = Date.now();
  const client = getClient();

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: ANTHROPIC_MODEL_SONNET_4_5,
    max_tokens: req.maxTokens ?? 4096,
    system: req.systemPrompt || undefined,
    messages: req.messages as Anthropic.MessageParam[],
    tools: req.tools,
  };

  let response: Anthropic.Message;
  try {
    response = await client.messages.create(params);
  } catch (primaryErr) {
    const isRetryable = isRetryableError(primaryErr);
    if (!isRetryable) {
      logError(
        "Anthropic callAnthropicWithTools failed (non-retryable)",
        { model: params.model },
        primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr)),
      );
      throw primaryErr;
    }
    // Retry once with Claude itself — no OpenAI fallback.
    logError(
      "Anthropic callAnthropicWithTools failed (retrying once)",
      { model: params.model },
      primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr)),
    );
    try {
      response = await client.messages.create(params);
    } catch (retryErr) {
      logError(
        "Anthropic callAnthropicWithTools retry also failed",
        { model: params.model },
        retryErr instanceof Error ? retryErr : new Error(String(retryErr)),
      );
      throw retryErr;
    }
  }

  const textContent = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const toolUseBlocks: AnthropicToolUseBlock[] = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input as Record<string, unknown>,
    }));

  return {
    textContent,
    toolUseBlocks,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    model: response.model || params.model,
    latencyMs: Date.now() - startedAt,
  };
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  const status = (err as { status?: number }).status;
  if (typeof status !== "number") return true;
  if (status >= 500) return true;
  if (status === 408 || status === 429 || status === 529) return true;
  return false;
}
