// Live-mode helper: reads `{ pagesByDiscipline, organizationId, bidId, userId }`
// JSON from stdin, runs the SAME per-discipline LLM prompt as the production
// `reduceDisciplineBatch` (server/services/aiEstimator/mapReduceDraft.ts),
// reconciles the per-batch outputs via `reconcileMeasurements`, and writes
// `{ measurements: [...] }` to stdout.
//
// This is the live counterpart to `reconcileChild.ts`. It exercises the
// CURRENT model + CURRENT prompt + CURRENT reconciliation logic so the
// nightly bench detects accuracy drift from prompt or model bumps.
//
// Provider selection mirrors the production routing: Anthropic if
// `ANTHROPIC_API_KEY` is set, else OpenAI. We bypass `governedAiCall`
// (no DB write) because the bench runs without a tenant DB.

import { z } from "zod";
import { OpenAIProvider } from "../../../server/ai/providers/openaiProvider";
import { AnthropicProvider } from "../../../server/ai/providers/anthropicProvider";
import {
  detectPromptInjection,
  quarantineDocumentBlocks,
  shouldRefusePromptInjection,
  validateAiJsonOutput,
} from "../../../server/ai/promptInjectionGuard";
import {
  reconcileMeasurements,
  type MapReduceMeasurement,
} from "../../../server/services/aiEstimator/mapReduceDraft";
import type { AiContentPart } from "../../../server/ai/providers/types";

const OUTPUT_SCHEMA = z.object({
  measurements: z.array(z.object({
    label: z.string(),
    type: z.enum(["AREA", "LINEAR", "COUNT", "VOLUME", "ANGULAR", "DIAMETER"]),
    value: z.number(),
    unit: z.string(),
    costCode: z.string().nullable().optional(),
    rationale: z.string(),
    sheetCitations: z.array(z.string()).optional(),
  })).optional(),
  notes: z.string().optional(),
  confidence: z.number().optional(),
}).passthrough();

interface LivePage { sheetCitation: string; text: string; }
interface LiveInput {
  pagesByDiscipline: Record<string, LivePage[]>;
}

function pickProvider() {
  const a = new AnthropicProvider();
  if (a.isConfigured()) return { provider: a, name: "anthropic" as const };
  const o = new OpenAIProvider();
  if (o.isConfigured()) return { provider: o, name: "openai" as const };
  throw new Error(
    "[liveChild] no AI provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)",
  );
}

async function runOneDiscipline(
  provider: ReturnType<typeof pickProvider>["provider"],
  discipline: string,
  pages: LivePage[],
): Promise<MapReduceMeasurement[]> {
  const concatenated = pages
    .map((p) => `<<<SHEET ${p.sheetCitation}>>>\n${p.text}`)
    .join("\n\n");
  const detection = detectPromptInjection(concatenated);
  if (shouldRefusePromptInjection(detection)) {
    process.stderr.write(`[liveChild] discipline ${discipline} refused (prompt injection)\n`);
    return [];
  }
  const blocks = quarantineDocumentBlocks([{ type: "text" as const, text: concatenated }]);

  const sysPrompt = `You are a senior estimator drafting takeoff measurements for the ${discipline} discipline only. The user message contains the text contents of multiple plan sheets, separated by lines like "<<<SHEET A-101>>>". For every quantifiable item visible in those sheets, emit one measurement and include the sheet identifier(s) it came from in "sheetCitations". Be conservative — never invent measurements not visible. Do not emit items that belong to other disciplines.
Return strict JSON: { "measurements": [{ "label": string, "type": "AREA|LINEAR|COUNT|VOLUME|ANGULAR|DIAMETER", "value": number, "unit": string, "costCode": string|null, "rationale": string, "sheetCitations": string[] }], "notes": string, "confidence": number }`;

  const completion = await provider.chatCompletion({
    messages: [
      { role: "system", content: sysPrompt },
      {
        role: "user",
        content: blocks.map<AiContentPart>((b) => ({ type: "text", text: (b as { text: string }).text })),
      },
    ],
    max_completion_tokens: 4000,
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content ?? null;
  const validated = validateAiJsonOutput(OUTPUT_SCHEMA, raw);
  if (!validated.ok) {
    process.stderr.write(`[liveChild] invalid JSON from ${discipline}: ${validated.reason}\n`);
    return [];
  }
  return (validated.data.measurements ?? []).map<MapReduceMeasurement>((m) => ({
    label: m.label,
    type: m.type,
    value: m.value,
    unit: m.unit,
    costCode: m.costCode ?? null,
    rationale: m.rationale,
    sheetCitations: Array.isArray(m.sheetCitations) ? m.sheetCitations : [],
    contributingDisciplines: [discipline],
  }));
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as LiveInput;

  const { provider, name } = pickProvider();
  process.stderr.write(`[liveChild] provider=${name}\n`);

  const batches: Array<{ discipline: string; measurements: MapReduceMeasurement[] }> = [];
  for (const discipline of Object.keys(parsed.pagesByDiscipline).sort()) {
    const pages = parsed.pagesByDiscipline[discipline] ?? [];
    if (pages.length === 0) continue;
    const measurements = await runOneDiscipline(provider, discipline, pages);
    batches.push({ discipline, measurements });
  }

  const measurements = reconcileMeasurements(batches).map((m) => ({
    label: m.label,
    type: m.type,
    value: m.value,
    unit: m.unit,
    sheetCitations: m.sheetCitations,
    contributingDisciplines: m.contributingDisciplines,
  }));
  process.stdout.write(JSON.stringify({ measurements }));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err));
  process.exit(1);
});
