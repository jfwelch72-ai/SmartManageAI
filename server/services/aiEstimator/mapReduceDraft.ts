/**
 * Task #2577 Phase B (Step 2) — Map-reduce takeoff drafter for large
 * plan sets.
 *
 * The single-pass `draftTakeoffFromPlans` caps at 8 plan documents in
 * one LLM call. Real bid sets ship 200+ sheets across 12+ documents.
 * This module replaces that hard cap with a three-phase pipeline:
 *
 *   1. MAP — for every plan document (no cap), extract per-page text
 *      and group pages by AIA discipline using `takeoffSheets`.
 *   2. REDUCE-PER-DISCIPLINE — for each discipline group (e.g. all "M"
 *      sheets), batch up to PAGES_PER_DISCIPLINE_BATCH pages per LLM
 *      call and ask for measurements with sheet-level citations.
 *   3. RECONCILE — dedupe across disciplines using a (label, type,
 *      unit) key. Identical items aggregate value and concatenate
 *      citations. The result is a single TakeoffDraftResult-shaped
 *      payload with `sheetCitations` per measurement.
 *
 * Every leg uses `governedAiCall`, the prompt-injection guard, and
 * Zod validation. Failures degrade gracefully — a discipline that
 * blows up is logged and skipped; the caller still gets the rest.
 */

import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { bids, projectPlans, takeoffSheets } from "@shared/schema";
import { extractPageTextsFromUrl } from "../../ai/documentExtractor";
import { routedChatCompletion } from "../../ai/providers";
import type { AiContentPart } from "../../ai/providers/types";
import { ESTIMATOR_SYSTEM_PROMPT_V2 } from "./systemPromptV2";
import { governedAiCall } from "../aiGovernance";
import { assertBidInOrg, ResourceOwnershipError } from "./access";
import { getOrgFactors } from "./orgFactors";
import { logInfo, logWarn } from "../../utils/logger";
import {
  detectPromptInjection,
  quarantineDocumentBlocks,
  quarantineUserText,
  recordDetectionMatches,
  shouldRefusePromptInjection,
  validateAiJsonOutput,
} from "../../ai/promptInjectionGuard";
// Task #2624 — Wire org assembly catalog into the map-reduce auto-takeoff
// pipeline (mirrors `takeoffDraft.ts`).
import { applyAssembliesToDraftLines } from "./applyAssembliesToDraft";
import type { AssemblyExpansion } from "./explodeAssembly";
// Task #2942 — Extra file access (bid_documents / plan_documents).
import { objectStorageClient, ObjectStorageService } from "../../objectStorage";
import { getOcrProvider } from "../../ai/ocrProvider";
import { extractSpreadsheetFromBuffer } from "./extractSpreadsheet";
import { resolveEstimatorFiles } from "./fileResolver";
import type { AnalyzedFileRef } from "./takeoffDraft";

const PAGES_PER_DISCIPLINE_BATCH = 20;
// Default ceiling on the number of LLM calls executed per discipline.
// Task #2626 — this default is now overridable per-org via
// `ai_estimator_org_factors.max_discipline_batches`. The live value is
// looked up at the start of each `mapReduceDraftFromPlans` run so an
// admin can raise the cap on a heavy plan set or lower it to throttle
// AI spend without a code change. The hard floor / ceiling below
// guards against pathological values from a misconfigured row.
export const DEFAULT_MAX_DISCIPLINE_BATCHES = 25;
export const ABS_MAX_DISCIPLINE_BATCHES = 200;
export const ABS_MIN_DISCIPLINE_BATCHES = 1;
const MAX_PAGES_PER_DOCUMENT = 1000;

const MAP_REDUCE_OUTPUT_SCHEMA = z.object({
  measurements: z.array(z.object({
    label: z.string(),
    type: z.enum(["AREA", "LINEAR", "COUNT", "VOLUME", "ANGULAR", "DIAMETER"]),
    value: z.number(),
    unit: z.string(),
    costCode: z.string().nullable().optional(),
    rationale: z.string(),
    sheetCitations: z.array(z.string()).optional(),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
    // Task #3044 — AI bounding geometry for visual overlay rendering.
    csiDivision: z.string().optional(),
    boundingBox: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
    }).optional(),
    polygonPoints: z.array(z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })).optional(),
  })).optional(),
  notes: z.string().optional(),
  confidence: z.number().optional(),
}).passthrough();

export interface MapReduceMeasurement {
  label: string;
  type: "AREA" | "LINEAR" | "COUNT" | "VOLUME" | "ANGULAR" | "DIAMETER";
  value: number;
  unit: string;
  costCode: string | null;
  rationale: string;
  sheetCitations: string[];
  contributingDisciplines: string[];
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  // Task #3044 — AI-extracted bounding geometry for visual overlay rendering.
  // All coordinates are page-normalized (0.0–1.0, top-left origin).
  // Carried from the first batch emission for a given (type, unit, label) key;
  // subsequent aggregated emissions for the same key do not overwrite geometry.
  csiDivision?: string;
  boundingBox?: { x: number; y: number; w: number; h: number };
  polygonPoints?: { x: number; y: number }[];
  // Task #2624 — Optional assembly explosion (see takeoffDraft.ts).
  assembly?: AssemblyExpansion | null;
}

/**
 * Task #2626 — Aggregated AI spend recorded over the lifetime of a single
 * map-reduce draft run. Sourced from the per-call `usage` tuple returned
 * by `governedAiCall` so callers (UI, audit) don't need to re-query
 * `ai_action_audit`.
 */
export interface MapReduceCostSummary {
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  byModel: Record<string, { calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
}

/**
 * Task #2626 — A sheet whose batch was dropped because the discipline
 * exceeded the configured `maxDisciplineBatches` cap. Surfaced on the
 * draft so the review UI can show "X sheets skipped — increase cap to N
 * and re-run".
 */
export interface SkippedSheetInfo {
  sheetId: string | null;
  sheetIndex: number;
  sheetNumber: string | null;
  sheetName: string | null;
  discipline: string;
}

export interface MapReduceDraftResult {
  measurements: MapReduceMeasurement[];
  notes: string;
  confidence: number;
  /** Map of disciplineCode → number of pages processed. */
  disciplineCoverage: Record<string, number>;
  /** Total LLM calls executed (map + reduce). */
  llmCallCount: number;
  /** True when at least one discipline was skipped because of governance / blocking. */
  partial: boolean;
  /** Task #2626 — sheets dropped due to per-discipline batch cap. */
  skippedSheets: SkippedSheetInfo[];
  /** Task #2626 — recommended cap that would clear `skippedSheets` (or current cap when none skipped). */
  recommendedMaxDisciplineBatches: number;
  /** Task #2626 — cap that was actually applied for this run. */
  appliedMaxDisciplineBatches: number;
  /** Task #2626 — aggregated AI spend for this draft run. */
  cost: MapReduceCostSummary;
  /** Task #2625 — provider model id observed on the first successful LLM response (e.g. "claude-sonnet-4-5"). */
  modelId?: string | null;
  /** Task #2625 — provider name observed on the first successful LLM response ("anthropic" | "openai"). */
  provider?: string | null;
  /** Task #2942 — extra files from bid_documents / plan_documents included in the draft context. */
  filesAnalyzed?: AnalyzedFileRef[];
}

interface PageInfo {
  planDocumentId: string;
  sheetId: string | null;
  sheetIndex: number;
  sheetNumber: string | null;
  sheetName: string | null;
  discipline: string;
  pageText: string;
}

export function makeMeasurementKey(m: { label: string; type: string; unit: string }): string {
  return `${m.type}|${m.unit.toUpperCase()}|${m.label.trim().toLowerCase()}`;
}

// Backwards-compatible internal alias.
const makeKey = makeMeasurementKey;

/**
 * Pure reconciliation of per-batch measurement emissions into a deduped,
 * citation-aware list. Extracted from `mapReduceDraftFromPlans` so the
 * disjoint/overlap merge rules can be unit-tested directly.
 *
 * Rules (matching the inline implementation):
 *  - Identity key = (type, normalised unit, normalised label).
 *  - For an existing key:
 *    - If the new emission shares ANY sheet citation with the existing
 *      one → duplicate observation of the same scope; keep the larger
 *      value.
 *    - If neither side has any citations → can't prove disjointness;
 *      conservatively take the max.
 *    - Otherwise (DISJOINT citations) → genuinely separate scopes; sum.
 *  - Citations and contributing disciplines union together.
 *  - Rationales concatenate (deduped, capped at 1000 chars).
 */
export function reconcileMeasurements(
  batches: Array<{ discipline: string; measurements: MapReduceMeasurement[] }>,
): MapReduceMeasurement[] {
  const byKey = new Map<string, MapReduceMeasurement>();
  for (const batch of batches) {
    for (const m of batch.measurements) {
      const key = makeKey(m);
      const existing = byKey.get(key);
      if (existing) {
        const newCites = m.sheetCitations ?? [];
        const overlaps = newCites.some((c) => existing.sheetCitations.includes(c));
        if (overlaps) {
          existing.value = Math.max(existing.value, m.value);
        } else if (newCites.length === 0 && existing.sheetCitations.length === 0) {
          existing.value = Math.max(existing.value, m.value);
        } else {
          existing.value += m.value;
        }
        for (const cite of newCites) {
          if (!existing.sheetCitations.includes(cite)) existing.sheetCitations.push(cite);
        }
        if (!existing.contributingDisciplines.includes(batch.discipline)) {
          existing.contributingDisciplines.push(batch.discipline);
        }
        if (m.rationale && !existing.rationale.includes(m.rationale)) {
          existing.rationale = `${existing.rationale}; ${m.rationale}`.slice(0, 1000);
        }
      } else {
        byKey.set(key, {
          ...m,
          sheetCitations: [...m.sheetCitations],
          contributingDisciplines: [batch.discipline],
        });
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * Map phase: pull per-page text from every plan document on a bid and
 * tag each page with the discipline assigned by `sheetIndex`. Pages
 * with no extracted text are dropped (the indexer/OCR layer is
 * responsible for getting text into the page in the first place).
 *
 * Task #2623 — Pipeline guard. We read `takeoffSheets.discipline` as-is,
 * which means human-confirmed sheets (`disciplineSource = 'USER'`)
 * naturally win over the AI's classification because the override
 * route writes the corrected value into that same column before this
 * map runs. Re-indexing also short-circuits USER rows in
 * `sheetIndex.ts`, so an override is sticky across re-runs.
 */
async function mapPagesByDiscipline(opts: {
  organizationId: string;
  bidId: string;
}): Promise<{ pages: PageInfo[]; sheetCitationByIndex: Map<string, string> }> {
  const sheets = await db
    .select({
      id: takeoffSheets.id,
      planId: takeoffSheets.planId,
      sheetIndex: takeoffSheets.sheetIndex,
      sheetName: takeoffSheets.sheetName,
      sheetNumber: takeoffSheets.sheetNumber,
      discipline: takeoffSheets.discipline,
      extractedTextByPage: takeoffSheets.extractedTextByPage,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));

  const planIds = Array.from(new Set(sheets.map((s) => s.planId).filter((id): id is string => !!id)));
  const docs = planIds.length > 0
    ? await db
        .select({ id: projectPlans.id, fileUrl: projectPlans.originalPdfUrl })
        .from(projectPlans)
        .where(inArray(projectPlans.id, planIds))
    : [];
  const docById = new Map(docs.map((d) => [d.id, d] as const));

  // For each unique planDocument, prefer cached per-page text from any
  // sheet row first; fall back to a fresh extraction.
  const cachedPageTextByPlan = new Map<string, Record<string, string>>();
  for (const s of sheets) {
    if (!s.planId || !s.extractedTextByPage) continue;
    if (typeof s.extractedTextByPage !== "object" || Array.isArray(s.extractedTextByPage)) continue;
    const existing = cachedPageTextByPlan.get(s.planId) ?? {};
    Object.assign(existing, s.extractedTextByPage as Record<string, string>);
    cachedPageTextByPlan.set(s.planId, existing);
  }

  const docPageText = new Map<string, Record<string, string>>();
  for (const planId of planIds) {
    const doc = docById.get(planId);
    const cached = cachedPageTextByPlan.get(planId);
    if (cached && Object.keys(cached).length > 0) {
      docPageText.set(planId, cached);
      continue;
    }
    if (!doc || !doc.fileUrl) continue;
    const result = await extractPageTextsFromUrl(doc.fileUrl, { maxPages: MAX_PAGES_PER_DOCUMENT });
    if (result && Object.keys(result.pages).length > 0) {
      docPageText.set(planId, result.pages);
    }
  }

  const pages: PageInfo[] = [];
  const citationByIdx = new Map<string, string>();
  for (const s of sheets) {
    if (!s.planId || !s.discipline) continue;
    const pageMap = docPageText.get(s.planId);
    if (!pageMap) continue;
    // sheet.sheetIndex is 0-based; pdfjs page numbers are 1-based.
    const key1 = String(s.sheetIndex + 1);
    const text = pageMap[key1];
    if (!text || text.trim().length < 20) continue;
    const cite = s.sheetNumber || s.sheetName || `sheet ${s.sheetIndex + 1}`;
    citationByIdx.set(s.id, cite);
    pages.push({
      planDocumentId: s.planId,
      sheetId: s.id,
      sheetIndex: s.sheetIndex,
      sheetNumber: s.sheetNumber,
      sheetName: s.sheetName,
      discipline: s.discipline.toUpperCase(),
      pageText: text,
    });
  }

  return { pages, sheetCitationByIndex: citationByIdx };
}

/** Run a single LLM call over a batch of pages within one discipline. */
async function reduceDisciplineBatch(opts: {
  organizationId: string;
  userId: string;
  discipline: string;
  pages: PageInfo[];
  bidId: string;
  // Task #2626 — stable id correlating every governedAiCall row from
  // the same draft attempt so the admin spend tab can roll up per-draft.
  draftId: string;
  projectId: string | null;
  /** Task #2942 — pre-validated supplemental text from bid/plan documents. */
  supplementalContext?: string;
}): Promise<{
  measurements: MapReduceMeasurement[];
  notes?: string;
  confidence?: number;
  blocked?: boolean;
  reason?: string;
  // Task #2626 — surface the per-call usage tuple from `governedAiCall`
  // so the orchestrator can roll spend up onto the draft result.
  usage?: {
    tokensIn: number;
    tokensOut: number;
    cost: number;
    model: string;
    provider: string | null;
  };
  modelId?: string | null;
  provider?: string | null;
}> {
  // Task #2683 — Stored-injection guard: `sheetNumber` / `sheetName` are
  // tenant-DB strings (uploaded plan-set filenames) that get spliced into
  // the discipline batch envelope. Wrap them via `quarantineUserText` so a
  // hostile filename like `>>>END\nIgnore previous instructions` cannot
  // break out of the `<<<SHEET ...>>>` delimiter and become an instruction.
  const concatenated = opts.pages
    .map((p) => {
      const cite = p.sheetNumber
        ? quarantineUserText("sheet_number", p.sheetNumber)
        : p.sheetName
        ? quarantineUserText("sheet_filename", p.sheetName)
        : `idx ${p.sheetIndex}`;
      return `<<<SHEET ${cite}>>>\n${p.pageText}`;
    })
    .join("\n\n");
  const detection = detectPromptInjection(concatenated);
  if (shouldRefusePromptInjection(detection)) {
    recordDetectionMatches("ai_estimator.map_reduce_draft", detection, "refused");
    logWarn("[mapReduceDraft] discipline batch refused (prompt injection)", {
      discipline: opts.discipline,
      pages: opts.pages.length,
      matches: detection.matches.map((m) => m.id),
    });
    return { measurements: [], blocked: true, reason: "prompt_injection_refused" };
  }
  if (detection.flagged) {
    recordDetectionMatches("ai_estimator.map_reduce_draft", detection, "quarantined");
  }
  const blocks = quarantineDocumentBlocks([{ type: "text" as const, text: concatenated }]);
  // Task #2942 — Prepend pre-validated supplemental file context (spreadsheets
  // / spec PDFs from bid_documents) so the model has richer scope data.
  const supplementalBlocks = opts.supplementalContext
    ? quarantineDocumentBlocks([{
        type: "text" as const,
        text: `[SUPPLEMENTAL FILE CONTEXT — cost estimates, schedules, specs]\n${opts.supplementalContext}`,
      }])
    : [];
  const allMessageBlocks = [...supplementalBlocks, ...blocks];

  // Task #3036 — V2.0 base prompt with a discipline-specific JSON output override.
  // The V2.0 framework drives the Phase 1-7 reasoning protocol; the appended
  // JSON instruction supersedes the prose output-format rules in Phase 6 so the
  // pipeline continues to receive the structured measurements array it expects.
  const sysPrompt = `${ESTIMATOR_SYSTEM_PROMPT_V2}

═══════════════════════════════════════════════════════════════════
TASK-SPECIFIC OUTPUT OVERRIDE (supersedes Phase 6 prose format)
═══════════════════════════════════════════════════════════════════

You are drafting takeoff measurements for the ${opts.discipline} discipline ONLY.
The user message contains the text contents of multiple plan sheets, separated by lines like "<<<SHEET A-101>>>".
For every quantifiable item visible in those sheets, emit one measurement and include the sheet identifier(s) it came from in "sheetCitations".
Be conservative — never invent measurements not visible. Do not emit items that belong to other disciplines.
Apply waste factors per industry standard (cite in rationale). Assign a confidence rating per line (HIGH/MEDIUM/LOW).

Return ONLY a single valid JSON object — no prose, no markdown fences, no explanation before or after:
{ "measurements": [{ "label": string, "type": "AREA|LINEAR|COUNT|VOLUME|ANGULAR|DIAMETER", "value": number, "unit": string, "costCode": string|null, "rationale": string, "sheetCitations": string[], "confidence": "HIGH"|"MEDIUM"|"LOW", "csiDivision": string, "boundingBox": { "x": number, "y": number, "w": number, "h": number }, "polygonPoints": [{"x": number, "y": number}] }], "notes": string, "confidence": number }

COORDINATE RULES: All boundingBox/polygonPoints values are page-normalized (0.0–1.0, top-left origin). Omit polygonPoints for rectangular shapes. csiDivision format: "DIV 03". Cross-check each boundingBox against the sheet scale bar. Every quantity must be verified against two independent drawing sources per the ACCURACY — NON-NEGOTIABLE protocol.`;

  let observedModelId: string | null = null;
  let observedProvider: string | null = null;

  // Task #2628 — calibration feedback loop. Best-effort exemplars +
  // per-trade calibration factors injected as a second system message.
  let calibrationBlock = "";
  try {
    const { loadCalibrationExemplars, formatExemplarsForPrompt, loadTradeCalibrationFactors, formatTradeCalibrationFactorsForPrompt } =
      await import("./calibrationLoop");
    const [exemplars, factors] = await Promise.all([
      loadCalibrationExemplars({ organizationId: opts.organizationId, limit: 15 }),
      loadTradeCalibrationFactors(opts.organizationId),
    ]);
    const parts = [
      formatExemplarsForPrompt(exemplars),
      formatTradeCalibrationFactorsForPrompt(factors, null),
    ].filter((s) => s.length > 0);
    calibrationBlock = parts.join("\n\n");
  } catch {
    calibrationBlock = "";
  }
  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.takeoff_draft.map_reduce",
    inputRefs: {
      discipline: opts.discipline,
      pageCount: opts.pages.length,
      bidId: opts.bidId,
      // Task #2626 — per-draft + per-project rollup keys for the admin
      // spend tab. `draftId` is generated once per `mapReduceDraftFromPlans`
      // invocation; `projectId` is the bid's `convertedToProjectId` (null
      // if the bid hasn't been awarded yet).
      draftId: opts.draftId,
      projectId: opts.projectId,
    },
    fn: async () => {
      // Task #3036 — temperature:0 for deterministic output; web_search
      // tool enables Phase 4 benchmark verification against live cost data.
      const completion = await routedChatCompletion({
        orgId: opts.organizationId,
        featureKey: "ai_estimator.takeoff_draft",
        request: {
          messages: [
            { role: "system", content: sysPrompt },
            ...(calibrationBlock
              ? ([{ role: "system", content: calibrationBlock }] as const)
              : []),
            {
              role: "user",
              content: allMessageBlocks.map<AiContentPart>((b) => ({ type: "text", text: (b as { text: string }).text })),
            },
          ],
          max_completion_tokens: 4000,
          response_format: { type: "json_object" },
          temperature: 0,
          tools: [{ type: "web_search_20250305" as const }],
        },
      });
      // Task #2625 — surface the actual provider model id used so it can
      // be persisted on the resulting `ai_takeoff_revisions` row for
      // run-level traceability.
      observedModelId = completion.model ?? null;
      observedProvider = (completion as { provider?: string | null }).provider ?? null;
      return { result: completion.choices[0]?.message?.content ?? null, completion };
    },
  });
  if (gov.blocked) return { measurements: [], blocked: true, reason: gov.reason };
  const usage = gov.usage
    ? {
        tokensIn: gov.usage.tokensIn,
        tokensOut: gov.usage.tokensOut,
        cost: gov.usage.cost,
        model: gov.usage.model,
        provider: gov.usage.provider,
      }
    : undefined;

  const validated = validateAiJsonOutput(MAP_REDUCE_OUTPUT_SCHEMA, gov.result);
  if (!validated.ok) {
    logWarn("[mapReduceDraft] invalid JSON from discipline batch", {
      discipline: opts.discipline,
      reason: validated.reason,
    });
    return { measurements: [] };
  }
  const out: MapReduceMeasurement[] = (validated.data.measurements ?? []).map((m) => ({
    label: m.label,
    type: m.type,
    value: m.value,
    unit: m.unit,
    costCode: m.costCode ?? null,
    rationale: m.rationale,
    sheetCitations: Array.isArray(m.sheetCitations) ? m.sheetCitations : [],
    contributingDisciplines: [opts.discipline],
    confidence: m.confidence,
    // Task #3044 — forward geometry fields from the AI output.
    csiDivision: typeof m.csiDivision === "string" ? m.csiDivision : undefined,
    boundingBox: m.boundingBox,
    polygonPoints: m.polygonPoints,
  }));
  return {
    measurements: out,
    notes: typeof validated.data.notes === "string" ? validated.data.notes : undefined,
    confidence:
      typeof validated.data.confidence === "number" ? validated.data.confidence : undefined,
    usage,
    modelId: observedModelId,
    provider: observedProvider,
  };
}

function emptyCostSummary(): MapReduceCostSummary {
  return { callCount: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byModel: {} };
}

function accumulateCost(
  summary: MapReduceCostSummary,
  usage: { tokensIn: number; tokensOut: number; cost: number; model: string },
): void {
  summary.callCount += 1;
  summary.tokensIn += usage.tokensIn;
  summary.tokensOut += usage.tokensOut;
  summary.costUsd += usage.cost;
  const m = summary.byModel[usage.model] ?? { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  m.calls += 1;
  m.tokensIn += usage.tokensIn;
  m.tokensOut += usage.tokensOut;
  m.costUsd += usage.cost;
  summary.byModel[usage.model] = m;
}

/**
 * Task #2626 — Resolve the live per-org cap on the number of map-reduce
 * batches per discipline. Falls back to DEFAULT_MAX_DISCIPLINE_BATCHES
 * if the org factors row is missing or the column has not yet been
 * populated. Clamped to the absolute floor / ceiling so a misconfigured
 * row can't crash the run or bankrupt the AI budget.
 */
export async function resolveMaxDisciplineBatches(organizationId: string): Promise<number> {
  try {
    const factors = await getOrgFactors(organizationId);
    const raw = (factors as { maxDisciplineBatches?: number | null }).maxDisciplineBatches;
    const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_MAX_DISCIPLINE_BATCHES;
    if (n < ABS_MIN_DISCIPLINE_BATCHES) return ABS_MIN_DISCIPLINE_BATCHES;
    if (n > ABS_MAX_DISCIPLINE_BATCHES) return ABS_MAX_DISCIPLINE_BATCHES;
    return n;
  } catch {
    return DEFAULT_MAX_DISCIPLINE_BATCHES;
  }
}

export async function mapReduceDraftFromPlans(opts: {
  organizationId: string;
  userId: string;
  bidId: string;
  /** Restrict to specific disciplines. Empty/undefined = process all. */
  disciplines?: string[];
  onProgress?: (pct: number, message: string) => void | Promise<void>;
}): Promise<{ result: MapReduceDraftResult | null; blocked?: boolean; reason?: string }> {
  const reportProgress = async (pct: number, message: string): Promise<void> => {
    if (!opts.onProgress) return;
    try {
      await opts.onProgress(pct, message);
    } catch {
      /* best-effort */
    }
  };

  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) {
      return { result: null, reason: "Bid not in org" };
    }
    throw err;
  }

  // Task #2626 — read the live cap before any LLM work so the run uses
  // the value an admin has just set. Falls back to the default if the
  // factors row / column is missing.
  const maxDisciplineBatches = await resolveMaxDisciplineBatches(opts.organizationId);

  // Task #2626 — generate a stable per-draft id and resolve the bid's
  // current `convertedToProjectId` (null when the bid hasn't been
  // awarded yet) so every governedAiCall row from this attempt can be
  // grouped per-draft / per-project in the admin spend tab.
  const draftId = randomUUID();
  let projectId: string | null = null;
  try {
    const [bidRow] = await db
      .select({ convertedToProjectId: bids.convertedToProjectId })
      .from(bids)
      .where(eq(bids.id, opts.bidId))
      .limit(1);
    projectId = bidRow?.convertedToProjectId ?? null;
  } catch {
    projectId = null;
  }

  await reportProgress(5, "Reading plan sheets");
  const { pages } = await mapPagesByDiscipline({
    organizationId: opts.organizationId,
    bidId: opts.bidId,
  });
  if (pages.length === 0) {
    return { result: null, reason: "No indexed plan-sheet text available — run sheet indexing first." };
  }

  // Task #2942 — Resolve extra files from bid_documents (PDFs, spreadsheets)
  // and build a supplemental text block passed into every discipline-reduce batch.
  const filesAnalyzed: AnalyzedFileRef[] = [];
  let supplementalContext = "";
  try {
    const MAX_SUPPLEMENTAL_CHARS = 80_000;
    const MAX_SUPPLEMENTAL_FILE_BYTES = 50 * 1024 * 1024;
    const SPREADSHEET_EXTS_S = new Set(["xlsx", "xls", "csv", "ods"]);
    const SPREADSHEET_MIMES_S = new Set([
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
    ]);

    async function downloadBufSupp(url: string): Promise<Buffer | null> {
      try {
        if (url.startsWith("/objects/")) {
          const svc = new ObjectStorageService();
          const f = await svc.getObjectEntityFile(url);
          const [buf] = await f.download();
          return buf;
        }
        const m = url.match(/storage\.googleapis\.com\/([^/?]+)\/([^?]+)/);
        if (!m) return null;
        const bucket = objectStorageClient.bucket(m[1]);
        const file = bucket.file(decodeURIComponent(m[2]));
        const [buf] = await file.download();
        return buf;
      } catch {
        return null;
      }
    }

    const extraFiles = await resolveEstimatorFiles({
      bidId: opts.bidId,
      organizationId: opts.organizationId,
    });

    const MAX_IMAGE_OCR_BYTES = 5 * 1024 * 1024;

    for (const fileRef of extraFiles) {
      if (supplementalContext.length >= MAX_SUPPLEMENTAL_CHARS) break;
      if (fileRef.fileType === "other") continue;

      let fileText: string | null = null;
      try {
        const ext = (fileRef.fileName.split(".").pop() ?? "").toLowerCase();
        const mime = (fileRef.mimeType ?? "").toLowerCase();
        const isSpreadsheet = SPREADSHEET_EXTS_S.has(ext) || SPREADSHEET_MIMES_S.has(mime);
        const isPdf = mime === "application/pdf" || ext === "pdf";
        const isImage = fileRef.fileType === "image";

        if (!isSpreadsheet && !isPdf && !isImage) continue;

        // Images: OCR up to 5 MB via the registered provider (Tesseract default).
        if (isImage) {
          if (fileRef.fileSize && fileRef.fileSize > MAX_IMAGE_OCR_BYTES) continue;
          const ocrProv = getOcrProvider();
          if (!ocrProv) continue;
          const imgBuf = await downloadBufSupp(fileRef.fileUrl);
          if (!imgBuf || imgBuf.length > MAX_IMAGE_OCR_BYTES) continue;
          const mimeForOcr = mime.startsWith("image/") ? mime : `image/${ext}`;
          const ocrText = await ocrProv.recognize({ buffer: imgBuf, mimeType: mimeForOcr });
          fileText = ocrText && ocrText.trim().length > 0 ? ocrText.trim() : null;
        } else {
          const buf = await downloadBufSupp(fileRef.fileUrl);
          if (!buf || buf.length > MAX_SUPPLEMENTAL_FILE_BYTES) continue;

          if (isSpreadsheet) {
            const extracted = extractSpreadsheetFromBuffer(buf, fileRef.fileName);
            fileText = extracted?.text ?? null;
          } else {
            const { extractPdfPageTexts } = await import("../../ai/documentExtractor");
            const result = await extractPdfPageTexts(buf, { maxPages: 20 });
            const pagesArr = Object.values(result.pages ?? {});
            fileText = pagesArr.join("\n").trim() || null;
          }
        }
      } catch {
        fileText = null;
      }

      if (!fileText) continue;

      const fileDetection = detectPromptInjection(fileText);
      if (shouldRefusePromptInjection(fileDetection)) {
        logWarn("[mapReduceDraft] supplemental file refused (prompt injection)", {
          fileName: fileRef.fileName,
        });
        continue;
      }
      if (fileDetection.flagged) {
        recordDetectionMatches("ai_estimator.map_reduce_draft", fileDetection, "quarantined");
      }

      const label = fileRef.fileType === "spreadsheet"
        ? `[Spreadsheet: ${fileRef.fileName}]`
        : `[Document: ${fileRef.fileName}]`;
      const chunk = `${label}\n${fileText}`;
      if (supplementalContext.length + chunk.length > MAX_SUPPLEMENTAL_CHARS) continue;

      supplementalContext += (supplementalContext ? "\n\n" : "") + chunk;
      filesAnalyzed.push({
        fileName: fileRef.fileName,
        fileType: fileRef.fileType,
        source: fileRef.source,
      });
    }
  } catch (suppErr) {
    logWarn("[mapReduceDraft] supplemental file resolution failed (best-effort)", {
      error: suppErr instanceof Error ? suppErr.message : String(suppErr),
    });
  }

  const wanted = opts.disciplines && opts.disciplines.length > 0
    ? new Set(opts.disciplines.map((d) => d.toUpperCase()))
    : null;
  const filtered = wanted ? pages.filter((p) => wanted.has(p.discipline)) : pages;

  // Group by discipline
  const byDiscipline = new Map<string, PageInfo[]>();
  for (const p of filtered) {
    const arr = byDiscipline.get(p.discipline) ?? [];
    arr.push(p);
    byDiscipline.set(p.discipline, arr);
  }

  const disciplineCoverage: Record<string, number> = {};
  // Per-batch measurement emissions are accumulated here and reconciled
  // ONCE at the end via the pure `reconcileMeasurements` helper, so the
  // citation-aware dedupe rules are guarded by the unit tests in
  // `server/__tests__/ai-takeoff-map-reduce-reconciliation.test.ts`
  // (Task #2622).
  const collectedBatches: Array<{ discipline: string; measurements: MapReduceMeasurement[] }> = [];
  const notesParts: string[] = [];
  let confidenceSum = 0;
  let confidenceN = 0;
  let llmCallCount = 0;
  let partial = false;
  let firstBlockedReason: string | undefined;
  const skippedSheets: SkippedSheetInfo[] = [];
  const cost = emptyCostSummary();
  // Task #2626 — track the highest per-discipline batch count required by
  // the input set so the UI can suggest a target cap that would clear the
  // skipped-sheet warning on the next run.
  let maxBatchesNeededAcrossDisciplines = 0;
  let observedModelId: string | null = null;
  let observedProvider: string | null = null;

  const disciplines = Array.from(byDiscipline.keys()).sort();
  let processed = 0;
  for (const discipline of disciplines) {
    const disciplinePages = byDiscipline.get(discipline)!;
    disciplineCoverage[discipline] = disciplinePages.length;
    // Batch
    const batches: PageInfo[][] = [];
    for (let i = 0; i < disciplinePages.length && batches.length < maxDisciplineBatches; i += PAGES_PER_DISCIPLINE_BATCH) {
      batches.push(disciplinePages.slice(i, i + PAGES_PER_DISCIPLINE_BATCH));
    }
    const totalBatchesNeeded = Math.ceil(disciplinePages.length / PAGES_PER_DISCIPLINE_BATCH);
    if (totalBatchesNeeded > maxBatchesNeededAcrossDisciplines) {
      maxBatchesNeededAcrossDisciplines = totalBatchesNeeded;
    }
    if (batches.length < totalBatchesNeeded) {
      partial = true;
      // Task #2626 — record every sheet whose batch was dropped so the
      // review UI can render an actionable banner ("3 sheets skipped —
      // increase cap to N and re-run") instead of the previous silent
      // log line.
      const droppedPages = disciplinePages.slice(batches.length * PAGES_PER_DISCIPLINE_BATCH);
      for (const p of droppedPages) {
        skippedSheets.push({
          sheetId: p.sheetId,
          sheetIndex: p.sheetIndex,
          sheetNumber: p.sheetNumber,
          sheetName: p.sheetName,
          discipline,
        });
      }
      logWarn("[mapReduceDraft] discipline truncated", {
        discipline,
        totalPages: disciplinePages.length,
        processedBatches: batches.length,
        skippedBatches: totalBatchesNeeded - batches.length,
        skippedSheetCount: droppedPages.length,
        maxDisciplineBatches,
      });
    }
    for (const batch of batches) {
      processed++;
      await reportProgress(
        Math.min(95, 10 + Math.round((processed / Math.max(1, batches.length * disciplines.length)) * 85)),
        `Drafting discipline ${discipline} (${batch.length} sheets)`,
      );
      const out = await reduceDisciplineBatch({
        organizationId: opts.organizationId,
        userId: opts.userId,
        discipline,
        pages: batch,
        bidId: opts.bidId,
        draftId,
        projectId,
        supplementalContext: supplementalContext || undefined,
      });
      llmCallCount++;
      if (out.usage) accumulateCost(cost, out.usage);
      if (out.blocked) {
        partial = true;
        if (!firstBlockedReason) firstBlockedReason = out.reason;
        // Skip remaining batches for this discipline
        break;
      }
      if (!observedModelId && out.modelId) observedModelId = out.modelId;
      if (!observedProvider && out.provider) observedProvider = out.provider;
      // Task #2577 Phase B — accumulate per-batch notes + confidence so
      // the final result reflects model-reported quality instead of
      // returning empty notes / a hard-coded default.
      if (out.notes && out.notes.trim().length > 0) {
        notesParts.push(`[${discipline}] ${out.notes.trim()}`);
      }
      if (typeof out.confidence === "number" && Number.isFinite(out.confidence)) {
        confidenceSum += Math.max(0, Math.min(100, out.confidence));
        confidenceN += 1;
      }
      collectedBatches.push({ discipline, measurements: out.measurements });
    }
  }

  // Single, pure reconciliation pass — see `reconcileMeasurements`
  // doc-comment above for the disjoint/overlap merge rules.
  const reconciled = reconcileMeasurements(collectedBatches);

  if (reconciled.length === 0 && firstBlockedReason) {
    return { result: null, blocked: true, reason: firstBlockedReason };
  }

  // Round costs to a reasonable precision once at the boundary so we
  // don't ship 17-digit floats to the UI / audit log.
  cost.costUsd = Math.round(cost.costUsd * 1_000_000) / 1_000_000;
  for (const k of Object.keys(cost.byModel)) {
    cost.byModel[k].costUsd = Math.round(cost.byModel[k].costUsd * 1_000_000) / 1_000_000;
  }

  const recommendedMaxDisciplineBatches = Math.min(
    ABS_MAX_DISCIPLINE_BATCHES,
    Math.max(maxDisciplineBatches, maxBatchesNeededAcrossDisciplines),
  );

  logInfo("[mapReduceDraft] complete", {
    bidId: opts.bidId,
    disciplines: disciplines.length,
    measurements: reconciled.length,
    llmCallCount,
    partial,
    skippedSheetCount: skippedSheets.length,
    appliedMaxDisciplineBatches: maxDisciplineBatches,
    recommendedMaxDisciplineBatches,
    costUsd: cost.costUsd,
    tokensIn: cost.tokensIn,
    tokensOut: cost.tokensOut,
  });

  // Task #2624 — Run assembly matcher across the deduped measurements
  // (output of the Task #2622 `reconcileMeasurements` pass above).
  await applyAssembliesToDraftLines({
    organizationId: opts.organizationId,
    lines: reconciled,
  });

  return {
    result: {
      measurements: reconciled,
      notes: notesParts.join("\n").slice(0, 4000),
      confidence: confidenceN > 0 ? Math.round(confidenceSum / confidenceN) : 60,
      disciplineCoverage,
      llmCallCount,
      partial,
      skippedSheets,
      recommendedMaxDisciplineBatches,
      appliedMaxDisciplineBatches: maxDisciplineBatches,
      cost,
      modelId: observedModelId,
      provider: observedProvider,
      filesAnalyzed,
    },
  };
}

/** Persist per-page text on `takeoff_sheets` so subsequent runs are cached. */
export async function cachePageTextOnSheets(opts: {
  organizationId: string;
  bidId: string;
}): Promise<{ updatedSheets: number; pagesOcr: number; ocrProviderId: string | null }> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return { updatedSheets: 0, pagesOcr: 0, ocrProviderId: null };
  }
  const sheets = await db
    .select({
      id: takeoffSheets.id,
      planId: takeoffSheets.planId,
      sheetIndex: takeoffSheets.sheetIndex,
      extractedTextByPage: takeoffSheets.extractedTextByPage,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));

  const planIds = Array.from(new Set(sheets.map((s) => s.planId).filter((id): id is string => !!id)));
  const docs = planIds.length > 0
    ? await db.select({ id: projectPlans.id, fileUrl: projectPlans.originalPdfUrl })
        .from(projectPlans)
        .where(inArray(projectPlans.id, planIds))
    : [];
  const docById = new Map(docs.map((d) => [d.id, d] as const));

  let updatedSheets = 0;
  let pagesOcr = 0;
  let ocrProviderId: string | null = null;

  for (const planId of planIds) {
    const doc = docById.get(planId);
    if (!doc || !doc.fileUrl) continue;
    const result = await extractPageTextsFromUrl(doc.fileUrl, { maxPages: MAX_PAGES_PER_DOCUMENT });
    if (!result) continue;
    if (result.ocrProviderId) ocrProviderId = result.ocrProviderId;
    pagesOcr += result.pagesOcr;

    for (const s of sheets.filter((x) => x.planId === planId)) {
      const key1 = String(s.sheetIndex + 1);
      const text = result.pages[key1];
      if (!text) continue;
      const merged = { ...(s.extractedTextByPage as Record<string, string> | null ?? {}), [key1]: text };
      await db
        .update(takeoffSheets)
        .set({
          extractedTextByPage: merged,
          extractedTextSource: result.source === "OCR" || result.source === "MIXED"
            ? `OCR_${result.ocrProviderId ?? "UNKNOWN"}`
            : "PDF_TEXT",
          extractedTextAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(takeoffSheets.id, s.id));
      updatedSheets++;
    }
  }

  return { updatedSheets, pagesOcr, ocrProviderId };
}
