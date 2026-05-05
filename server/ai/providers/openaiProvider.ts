/**
 * Task #2410 — OpenAI implementation of the AiProvider contract.
 *
 * Thin adapter around the existing `openai` client. We deliberately do NOT
 * change how the underlying SDK is constructed — that path already supports
 * Replit AI Integrations (`AI_INTEGRATIONS_OPENAI_API_KEY`) plus a direct
 * `OPENAI_API_KEY` fallback.
 */

import { openai, AI_MODEL_GPT5 } from "../openaiClient";
import type {
  AiProvider,
  AiChatRequest,
  AiChatResponse,
  AiMessage,
} from "./types";

export class OpenAIProvider implements AiProvider {
  readonly name = "openai" as const;
  readonly defaultModel = AI_MODEL_GPT5;

  isConfigured(): boolean {
    return !!(
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY
    );
  }

  async chatCompletion(req: AiChatRequest): Promise<AiChatResponse> {
    const startedAt = Date.now();
    const completion = await openai.chat.completions.create({
      model: req.model || this.defaultModel,
      messages: req.messages.map(toOpenAiMessage) as any,
      max_completion_tokens: req.max_completion_tokens,
      ...(req.response_format ? { response_format: req.response_format as any } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });

    const latencyMs = Date.now() - startedAt;
    const choice = completion.choices?.[0];
    return {
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: (choice?.message?.content ?? null) as string | null,
          },
          finish_reason: (choice?.finish_reason as string) ?? null,
        },
      ],
      usage: {
        prompt_tokens: completion.usage?.prompt_tokens ?? 0,
        completion_tokens: completion.usage?.completion_tokens ?? 0,
      },
      model: completion.model || req.model || this.defaultModel,
      provider: "openai",
      fallbackUsed: false,
      latencyMs,
    };
  }
}

function toOpenAiMessage(m: AiMessage): unknown {
  // OpenAI's SDK already accepts our shape verbatim — both string content and
  // the (text + image_url) content-part array. Pass through as-is.
  return m;
}

export const openaiProvider = new OpenAIProvider();
