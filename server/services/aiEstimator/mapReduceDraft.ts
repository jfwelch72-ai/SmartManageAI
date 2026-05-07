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

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { projectPlans, takeoffSheets } from "@shared/schema";
import { extractPageTextsFromUrl } from "../../ai/documentExtractor";
import { routedChatCompletion } from "../../ai/providers";
import type { AiContentPart } from "../../ai/providers/types";
import { governedAiCall } from "../aiGovernance";
import { assertBidInOrg, ResourceOwnershipError } from "./access";
import { logError, logInfo, logWarn } from "../../utils/logger";
import {
  detectPromptInjection,
  quarantineDocumentBlocks,
  shouldRefusePromptInjection,
  validateAiJsonOutput,
} from "../../ai/promptInjectionGuard";

const PAGES_PER_DISCIPLINE_BATCH = 20;
// Hard ceiling on the number of LLM calls executed per discipline. Beyond
// this we stop and signal `partial: true` so callers can re-run with a
// narrower discipline filter rather than silently dropping pages. Set to
// a large number so a 200+ sheet plan set with one heavy discipline (50+
// pages) still goes end-to-end, while runaway 1000-page disciplines are
// capped instead of bankrupting the AI budget.
const MAX_DISCIPLINE_BATCHES = 25;
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

function makeKey(m: { label: string; type: string; unit: string }): string {
  return `${m.type}|${m.unit.toUpperCase()}|${m.label.trim().toLowerCase()}`;
}

/**
 * Map phase: pull per-page text from every plan document on a bid and
 * tag each page with the discipline assigned by `sheetIndex`. Pages
 * with no extracted text are dropped (the indexer/OCR layer is
 * responsible for getting text into the page in the first place).
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
}): Promise<{
  measurements: MapReduceMeasurement[];
  notes?: string;
  confidence?: number;
  blocked?: boolean;
  reason?: string;
}> {
  const concatenated = opts.pages
    .map((p) => `<<<SHEET ${p.sheetNumber || p.sheetName || `idx ${p.sheetIndex}`}>>>\n${p.pageText}`)
    .join("\n\n");
  const detection = detectPromptInjection(concatenated);
  if (shouldRefusePromptInjection(detection)) {
    logWarn("[mapReduceDraft] discipline batch refused (prompt injection)", {
      discipline: opts.discipline,
      pages: opts.pages.length,
      matches: detection.matches.map((m) => m.id),
    });
    return { measurements: [], blocked: true, reason: "prompt_injection_refused" };
  }
  const blocks = quarantineDocumentBlocks([{ type: "text" as const, text: concatenated }]);

  const sysPrompt = `You are a senior estimator drafting takeoff measurements for the ${opts.discipline} discipline only. The user message contains the text contents of multiple plan sheets, separated by lines like "<<<SHEET A-101>>>". For every quantifiable item visible in those sheets, emit one measurement and include the sheet identifier(s) it came from in "sheetCitations". Be conservative — never invent measurements not visible. Do not emit items that belong to other disciplines.
Return strict JSON: { "measurements": [{ "label": string, "type": "AREA|LINEAR|COUNT|VOLUME|ANGULAR|DIAMETER", "value": number, "unit": string, "costCode": string|null, "rationale": string, "sheetCitations": string[] }], "notes": string, "confidence": number }`;

  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.takeoff_draft.map_reduce",
    inputRefs: { discipline: opts.discipline, pageCount: opts.pages.length, bidId: opts.bidId },
    fn: async () => {
      const completion = await routedChatCompletion({
        orgId: opts.organizationId,
        featureKey: "ai_estimator.takeoff_draft",
        request: {
          messages: [
            { role: "system", content: sysPrompt },
            {
              role: "user",
              content: blocks.map<AiContentPart>((b) => ({ type: "text", text: (b as { text: string }).text })),
            },
          ],
          max_completion_tokens: 4000,
          response_format: { type: "json_object" },
        },
      });
      return { result: completion.choices[0]?.message?.content ?? null, completion };
    },
  });
  if (gov.blocked) return { measurements: [], blocked: true, reason: gov.reason };

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
  }));
  return {
    measurements: out,
    notes: typeof validated.data.notes === "string" ? validated.data.notes : undefined,
    confidence:
      typeof validated.data.confidence === "number" ? validated.data.confidence : undefined,
  };
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

  await reportProgress(5, "Reading plan sheets");
  const { pages } = await mapPagesByDiscipline({
    organizationId: opts.organizationId,
    bidId: opts.bidId,
  });
  if (pages.length === 0) {
    return { result: null, reason: "No indexed plan-sheet text available — run sheet indexing first." };
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
  const measurementsByKey = new Map<string, MapReduceMeasurement>();
  const notesParts: string[] = [];
  let confidenceSum = 0;
  let confidenceN = 0;
  let llmCallCount = 0;
  let partial = false;
  let firstBlockedReason: string | undefined;

  const disciplines = Array.from(byDiscipline.keys()).sort();
  let processed = 0;
  for (const discipline of disciplines) {
    const disciplinePages = byDiscipline.get(discipline)!;
    disciplineCoverage[discipline] = disciplinePages.length;
    // Batch
    const batches: PageInfo[][] = [];
    for (let i = 0; i < disciplinePages.length && batches.length < MAX_DISCIPLINE_BATCHES; i += PAGES_PER_DISCIPLINE_BATCH) {
      batches.push(disciplinePages.slice(i, i + PAGES_PER_DISCIPLINE_BATCH));
    }
    const totalBatchesNeeded = Math.ceil(disciplinePages.length / PAGES_PER_DISCIPLINE_BATCH);
    if (batches.length < totalBatchesNeeded) {
      partial = true;
      logWarn("[mapReduceDraft] discipline truncated", {
        discipline,
        totalPages: disciplinePages.length,
        processedBatches: batches.length,
        skippedBatches: totalBatchesNeeded - batches.length,
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
      });
      llmCallCount++;
      if (out.blocked) {
        partial = true;
        if (!firstBlockedReason) firstBlockedReason = out.reason;
        // Skip remaining batches for this discipline
        break;
      }
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
      for (const m of out.measurements) {
        const key = makeKey(m);
        const existing = measurementsByKey.get(key);
        if (existing) {
          // Task #2577 Phase B — citation-aware dedupe. Plan sets
          // commonly repeat the same scope on multiple sheets (key
          // plan + enlarged plan + detail) and the LLM emits the same
          // measurement on each. Naive summing overcounts. Strategy:
          //  - If the new measurement's citations OVERLAP any
          //    citation already attributed to this key, the new
          //    emission is a duplicate observation of the same
          //    scope → keep the larger of the two values.
          //  - If the citations are DISJOINT, treat as additive
          //    (genuinely separate scopes that happen to share label
          //    + unit + type) and sum.
          // This matches how an estimator would reconcile by hand:
          // never double-count the same sheet, but do roll up scope
          // that appears on different sheets.
          const newCites = m.sheetCitations ?? [];
          const overlaps = newCites.some((c) => existing.sheetCitations.includes(c));
          if (overlaps) {
            existing.value = Math.max(existing.value, m.value);
          } else if (newCites.length === 0 && existing.sheetCitations.length === 0) {
            // No citations on either side — can't prove disjointness;
            // be conservative and take the max rather than sum.
            existing.value = Math.max(existing.value, m.value);
          } else {
            existing.value += m.value;
          }
          for (const cite of newCites) {
            if (!existing.sheetCitations.includes(cite)) existing.sheetCitations.push(cite);
          }
          if (!existing.contributingDisciplines.includes(discipline)) {
            existing.contributingDisciplines.push(discipline);
          }
          if (m.rationale && !existing.rationale.includes(m.rationale)) {
            existing.rationale = `${existing.rationale}; ${m.rationale}`.slice(0, 1000);
          }
        } else {
          measurementsByKey.set(key, { ...m });
        }
      }
    }
  }

  if (measurementsByKey.size === 0 && firstBlockedReason) {
    return { result: null, blocked: true, reason: firstBlockedReason };
  }

  logInfo("[mapReduceDraft] complete", {
    bidId: opts.bidId,
    disciplines: disciplines.length,
    measurements: measurementsByKey.size,
    llmCallCount,
    partial,
  });

  return {
    result: {
      measurements: Array.from(measurementsByKey.values()),
      notes: notesParts.join("\n").slice(0, 4000),
      confidence: confidenceN > 0 ? Math.round(confidenceSum / confidenceN) : 60,
      disciplineCoverage,
      llmCallCount,
      partial,
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
