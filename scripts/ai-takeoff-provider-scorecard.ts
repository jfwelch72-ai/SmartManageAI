/**
 * Task #2410 — Provider regression scorecard.
 *
 * Runs a fixed bench of Takeoff-family prompts against BOTH OpenAI and
 * Anthropic, prints a side-by-side diff (latency, tokens, parsed JSON shape
 * conformance) so we can decide whether to flip a tenant from GPT to Claude.
 *
 * Usage:
 *   tsx scripts/ai-takeoff-provider-scorecard.ts                   # run all
 *   tsx scripts/ai-takeoff-provider-scorecard.ts --case=trade      # single
 *
 * Env required: ANTHROPIC_API_KEY (or skip Anthropic side automatically)
 *               AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY
 *
 * The script does NOT touch the DB or feature flags — it pins the provider
 * directly so it's safe to run against production credentials in dev.
 */

import { openaiProvider, anthropicProvider } from "../server/ai/providers";
import type {
  AiChatRequest,
  AiChatResponse,
  AiProvider,
} from "../server/ai/providers/types";

interface ScoreCase {
  id: string;
  description: string;
  request: AiChatRequest;
  /** Returns null when the response shape looks correct, or a reason string. */
  validate: (text: string | null) => string | null;
}

const CASES: ScoreCase[] = [
  {
    id: "trade-classify",
    description: "Trade classifier — text-only sanity (no image)",
    request: {
      messages: [
        {
          role: "system",
          content: `You classify a construction drawing into one of: ELECTRICAL, PLUMBING, HVAC, ROOFING, GENERAL_CONTRACTOR. Return JSON: { "trade": "<one>", "confidence": 0-100, "reasoning": "string" }.`,
        },
        {
          role: "user",
          content:
            "The drawing shows a panel schedule, conduit runs, and circuit symbols. What trade is this?",
        },
      ],
      max_completion_tokens: 256,
      response_format: { type: "json_object" },
    },
    validate: (text) => {
      if (!text) return "empty response";
      try {
        const parsed = JSON.parse(text);
        if (!parsed.trade) return "missing trade";
        if (typeof parsed.confidence !== "number") return "missing confidence";
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  {
    id: "idr-summarize",
    description: "Heavy-civil IDR summarizer — multi-paragraph JSON",
    request: {
      messages: [
        {
          role: "system",
          content: `Rewrite raw inspector field notes into a state-DOT-style narrative. Output strict JSON: { "workPerformed": "string", "delaysEncountered": "string", "safetyIncidents": "string", "confidence": 0-100 }.`,
        },
        {
          role: "user",
          content:
            "Weather: 78F sunny. Crew: 6 workers, 9 hrs. Stations: 14+50 to 22+00.\n\nNotes: paved 850 LF S-9.5B mainline, two delays for paver pin replacement (~25 min), no safety issues.",
        },
      ],
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
    },
    validate: (text) => {
      if (!text) return "empty response";
      try {
        const parsed = JSON.parse(text);
        const required = ["workPerformed", "delaysEncountered", "safetyIncidents"];
        for (const k of required) {
          if (typeof parsed[k] !== "string") return `missing ${k}`;
        }
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  // Task #2423 — estimation-family migrations onto the router.
  {
    id: "estimate-analyze",
    description: "AI CFO estimate analysis — prose recommendations",
    request: {
      messages: [
        {
          role: "system",
          content:
            "You are an AI CFO analyzing a construction project estimate. Reply with: 1) Budget Health (Low/Medium/High), 2) 3 key insights, 3) cost recommendations.",
        },
        {
          role: "user",
          content:
            "Estimate: 1500 sqft remodel. Labor: $45k (1200 hrs). Materials: $32k. Overhead: 12%. Profit margin: 15%. Actual labor logged so far: 320 hrs / $11.5k.",
        },
      ],
      max_completion_tokens: 600,
    },
    validate: (text) => {
      if (!text) return "empty response";
      if (text.length < 80) return "too short for an analysis";
      return null;
    },
  },
  {
    id: "scope-predict",
    description: "Scope prediction — JSON ranking of SOW items",
    request: {
      messages: [
        {
          role: "system",
          content:
            "You rank construction SOW items by relevance. Output JSON: { \"items\": [{ \"id\": \"string\", \"score\": 0-100 }], \"missingScope\": [\"string\"] }.",
        },
        {
          role: "user",
          content:
            "Trade: ELECTRICAL. Project: panel upgrade.\nCandidates: [{id:\"a\",name:\"Install 200A panel\"},{id:\"b\",name:\"Pour foundation\"},{id:\"c\",name:\"Run feeder\"}].\nRank top 3.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 400,
    },
    validate: (text) => {
      if (!text) return "empty";
      try {
        const j = JSON.parse(text);
        if (!Array.isArray(j.items)) return "missing items[]";
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  {
    id: "win-probability",
    description: "CRM win-probability — small JSON score object",
    request: {
      messages: [
        {
          role: "system",
          content:
            "Score the close probability of this construction sales opportunity. Output JSON: { \"score\": 0-100, \"reasoning\": \"string\" }.",
        },
        {
          role: "user",
          content:
            "Score this deal:\n{\"stage\":\"PROPOSAL_SENT\",\"value\":85000,\"daysOpen\":12,\"contactCount\":3,\"competitors\":1}",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 200,
    },
    validate: (text) => {
      if (!text) return "empty";
      try {
        const j = JSON.parse(text);
        if (typeof j.score !== "number") return "missing score";
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  {
    id: "module-analyze",
    description: "Module insight generator — JSON insights[] envelope",
    request: {
      messages: [
        {
          role: "system",
          content:
            "Analyze a project module and return JSON: { \"insights\": [{ \"module\": \"string\", \"severity\": \"INFO|WARN|CRITICAL\", \"title\": \"string\", \"summary\": \"string\", \"recommendations\": [\"string\"] }] }.",
        },
        {
          role: "user",
          content:
            "Module: COSTS. Budget: $250k. Committed: $230k. Actual: $215k. Outstanding POs: $40k. Identify the top 1-2 risks.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
    },
    validate: (text) => {
      if (!text) return "empty";
      try {
        const j = JSON.parse(text);
        if (!Array.isArray(j.insights) || j.insights.length === 0)
          return "missing insights[]";
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  {
    id: "trade-discovery",
    description: "Trade discovery — JSON primary trade + related trades",
    request: {
      messages: [
        {
          role: "system",
          content:
            "Identify the primary construction trade and related trades for this project. Output JSON: { \"primaryTrade\": \"string\", \"relatedTrades\": [\"string\"], \"confidence\": 0-100 }.",
        },
        {
          role: "user",
          content:
            "Project: New 6-unit apartment building, 3 stories, slab on grade, asphalt-shingle roof, copper plumbing, electrical service 400A.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 400,
    },
    validate: (text) => {
      if (!text) return "empty";
      try {
        const j = JSON.parse(text);
        if (!j.primaryTrade) return "missing primaryTrade";
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  {
    id: "vendor-price-extract-fallback",
    description: "Vendor price-list fallback synth — JSON items[]",
    request: {
      messages: [
        {
          role: "system",
          content:
            "Generate realistic construction vendor pricing. Output JSON: { \"items\": [{ \"itemName\": \"string\", \"unit\": \"string\", \"unitPrice\": \"string\" }] }.",
        },
        {
          role: "user",
          content: "Generate 5 sample pricing items for a lumberyard catalog, effective 2026-Q2.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
    },
    validate: (text) => {
      if (!text) return "empty";
      try {
        const j = JSON.parse(text);
        if (!Array.isArray(j.items) || j.items.length === 0) return "missing items[]";
        return null;
      } catch (e) {
        return `non-JSON: ${(e as Error).message}`;
      }
    },
  },
  {
    id: "estimator-chat",
    description: "AI Estimator chat — plain prose answer (no JSON mode)",
    request: {
      messages: [
        {
          role: "system",
          content:
            "You are 'Ask the Estimator'. Reply in 1-2 short sentences in plain prose. No code fences.",
        },
        {
          role: "user",
          content:
            "What's a typical productivity rate for a 4-person framing crew on a single-family wood frame, in SF/day?",
        },
      ],
      max_completion_tokens: 200,
    },
    validate: (text) => {
      if (!text) return "empty response";
      if (text.trim().startsWith("{") || text.trim().startsWith("```"))
        return "looks like JSON or fenced code, not prose";
      if (text.length < 10) return "too short";
      return null;
    },
  },
];

interface CaseResult {
  caseId: string;
  provider: string;
  model: string;
  ok: boolean;
  validationError: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  preview: string;
}

async function runOne(provider: AiProvider, c: ScoreCase): Promise<CaseResult> {
  const started = Date.now();
  try {
    const resp: AiChatResponse = await provider.chatCompletion(c.request);
    const text = resp.choices[0]?.message?.content ?? null;
    const err = c.validate(text);
    return {
      caseId: c.id,
      provider: provider.name,
      model: resp.model,
      ok: err === null,
      validationError: err,
      latencyMs: resp.latencyMs,
      inputTokens: resp.usage.prompt_tokens,
      outputTokens: resp.usage.completion_tokens,
      preview: (text ?? "").replace(/\s+/g, " ").slice(0, 120),
    };
  } catch (err) {
    return {
      caseId: c.id,
      provider: provider.name,
      model: provider.defaultModel,
      ok: false,
      validationError: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      preview: "",
    };
  }
}

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  const filterArg = process.argv.find((a) => a.startsWith("--case="));
  const filter = filterArg ? filterArg.split("=")[1] : null;
  const cases = filter ? CASES.filter((c) => c.id.includes(filter)) : CASES;
  if (cases.length === 0) {
    console.error(`No cases matched --case=${filter}`);
    process.exit(1);
  }

  const providers: AiProvider[] = [];
  if (openaiProvider.isConfigured()) providers.push(openaiProvider);
  else console.warn("[scorecard] OpenAI not configured — skipping its column");
  if (anthropicProvider.isConfigured()) providers.push(anthropicProvider);
  else console.warn("[scorecard] Anthropic not configured — skipping its column");

  if (providers.length === 0) {
    console.error("No providers configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    process.exit(2);
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    console.log(`\n— ${c.id} — ${c.description}`);
    for (const p of providers) {
      const r = await runOne(p, c);
      results.push(r);
      console.log(
        `  ${pad(r.provider, 10)} ${pad(r.model, 24)} ${pad(r.ok ? "PASS" : "FAIL", 5)} ${pad(`${r.latencyMs}ms`, 8)} in=${r.inputTokens} out=${r.outputTokens}` +
          (r.validationError ? `  -> ${r.validationError}` : ""),
      );
      if (r.preview) console.log(`    ${r.preview}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\nScorecard: ${passed}/${total} passed across ${providers.length} provider(s) on ${cases.length} case(s).`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("Scorecard failed:", err);
  process.exit(99);
});
