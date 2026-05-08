// prompt-injection-guard: enrichment runs over tenant-internal taxonomy (trade types, cost codes); no untrusted free-text
/**
 * Task #2414 — Claude-written narrative summaries for the AI Estimator's
 * knowledge index.
 *
 * The mechanical ingest pass produces log-line snippets like
 * `"Qty 100 SF • $5,000 total • code 03-30-00"`. When the chat assistant
 * or the draft-estimate generator retrieves these rows as context, the
 * answers stay thin because the snippets describe *what* the row is, not
 * *what made it interesting*. This module wraps a routed Claude call that
 * turns each row into a 1–4 sentence narrative grounded in the org's own
 * learned-rates slice, so retrieval surfaces lessons rather than data.
 *
 * Design constraints:
 *   • Zero-trust on the model: the system prompt forbids inventing
 *     numbers and explicitly anchors the model to the row + provided
 *     rate slice. The frontend / retrieval layer never hides which
 *     numbers came from the user's data.
 *   • Best-effort: any failure (Claude down, governance block, parse
 *     error, empty completion) returns null and the caller logs +
 *     continues. The mechanical snippet is always the fallback.
 *   • Routed through `routedChatCompletion` so AI_PROVIDER_TAKEOFF
 *     governs which provider answers, and wrapped in `governedAiCall`
 *     so the audit log + per-org spend caps apply.
 */

import { routedChatCompletion } from "../../ai/providers";
import { governedAiCall } from "../aiGovernance";
import { logWarn } from "../../utils/logger";
import type {
  AiEstimatorKnowledgeIndex,
  AiEstimatorLearnedRate,
} from "@shared/schema";
import { summarizeRate } from "./learnedRates";

export interface EnrichKnowledgeRowOptions {
  organizationId: string;
  /** Estimator user that triggered the ingest run; null for the cron. */
  userId: string | null;
  row: AiEstimatorKnowledgeIndex;
  /**
   * Org's currently learned rates for this row's cost code. The caller
   * pre-filters this list so the prompt stays small and on-topic; pass
   * an empty array when the row has no costCode.
   */
  rates: AiEstimatorLearnedRate[];
}

const SYSTEM_PROMPT = `You write short, factual context summaries for a contractor's AI Estimator knowledge index.
You will be given ONE indexed row from the contractor's own workspace plus the contractor's learned cost rates for that row's cost code.
Write 1 to 4 sentences (≤80 words) of plain-prose narrative that explains what makes this row notable to a senior estimator: how it compares to the org's median for the same cost code, what the takeoff coverage tells us, and any unit-cost / labor-hour signal worth surfacing later.
HARD RULES:
- Use ONLY numbers that appear in the row data or the rates summary you are given. Never invent dollar amounts, percentages, or sample counts.
- If a comparison is not supported by the data (no median, no sample count, no quantity), describe the row qualitatively instead of guessing a number.
- Do not repeat the row's title verbatim, do not add bullet points, and do not include a preamble like "Summary:".
- Output is a single paragraph of plain text, no markdown.`;

function rateSliceForPrompt(rates: AiEstimatorLearnedRate[]): Array<{
  costCode: string;
  metric: string;
  unit: string;
  point: number | null;
  range: { low: number | null; high: number | null };
  n: number;
}> {
  return rates.slice(0, 6).map((r) => ({
    costCode: r.costCode,
    metric: r.metric,
    unit: r.unit,
    ...summarizeRate(r),
  }));
}

function buildUserPrompt(
  row: AiEstimatorKnowledgeIndex,
  rates: AiEstimatorLearnedRate[],
): string {
  const rowBlock = {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    title: row.title,
    contentSnippet: row.contentSnippet,
    costCode: row.costCode,
    tradeType: row.tradeType,
    tags: row.tags ?? [],
    numericFacets: row.numericFacets ?? null,
    bidId: row.bidId,
    projectId: row.projectId,
  };
  const rateBlock = rateSliceForPrompt(rates);
  return [
    `Indexed row:\n${JSON.stringify(rowBlock, null, 2)}`,
    `Org learned rates for this cost code (most-relevant ${rateBlock.length}):`,
    rateBlock.length === 0
      ? "(none — no learned rate exists for this cost code yet)"
      : JSON.stringify(rateBlock, null, 2),
    `Write the 1–4 sentence narrative now.`,
  ].join("\n\n");
}

/**
 * Enrich a single knowledge-index row with a Claude-written narrative.
 *
 * Returns the trimmed narrative string on success, or null when the call
 * was blocked, the provider returned no usable text, or any error
 * bubbled out of the routing/governance stack. Never throws — callers
 * (the ingestion loop) treat null as "fall back to the mechanical
 * snippet" and increment a `failed` counter for observability.
 */
export async function enrichKnowledgeRow(
  opts: EnrichKnowledgeRowOptions,
): Promise<string | null> {
  try {
    const userPrompt = buildUserPrompt(opts.row, opts.rates);
    const gov = await governedAiCall<string | null>({
      orgId: opts.organizationId,
      userId: opts.userId,
      actionType: "ai_estimator.enrichment",
      inputRefs: {
        knowledgeRowId: opts.row.id,
        sourceType: opts.row.sourceType,
        sourceId: opts.row.sourceId,
        rateSliceCount: Math.min(opts.rates.length, 6),
      },
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId: opts.organizationId,
          featureKey: "ai_estimator.enrichment",
          request: {
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            // Narrative is short by design — 200 tokens is plenty for
            // 1–4 sentences and keeps per-row cost predictable.
            max_completion_tokens: 200,
            temperature: 0.2,
          },
        });
        return {
          result: completion.choices[0]?.message?.content ?? null,
          completion,
        };
      },
    });

    if (gov.blocked) {
      logWarn("AI Estimator enrichment blocked by governance", {
        orgId: opts.organizationId,
        knowledgeRowId: opts.row.id,
        reason: gov.reason,
      });
      return null;
    }

    const text = (gov.result ?? "").trim();
    if (!text) return null;
    // Belt-and-suspenders: clip at a sane upper bound so a runaway
    // completion can't bloat the index.
    return text.length > 1200 ? text.slice(0, 1200) : text;
  } catch (err) {
    logWarn("AI Estimator enrichment failed", {
      orgId: opts.organizationId,
      knowledgeRowId: opts.row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
