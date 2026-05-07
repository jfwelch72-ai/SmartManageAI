/**
 * Task #2577 Phase B (Step 4) — Schedule symbol auto-counting.
 *
 * Construction documents include "schedule" sheets that enumerate every
 * door, window, plumbing fixture, and electrical panel by symbol code
 * and count. We can't reliably *count glyphs* on every floor plan with
 * an LLM, but we *can* parse the schedule itself: a tabular grid the
 * vision model handles well.
 *
 * Pipeline:
 *   1. Filter `takeoff_sheets` for pages whose `sheetName` /
 *      `sheetNumber` / cached extracted text mentions "SCHEDULE" plus
 *      the kind keyword (door/window/fixture/panel).
 *   2. Per matching sheet, run an AI vision pass with a strict JSON
 *      schema asking for [{ kind, code, count, confidence, mark? }].
 *   3. Persist each row to `ai_estimator_legend_symbols` using a
 *      "SCH:KIND:CODE" prefix on `symbolCode` (so it doesn't collide
 *      with legend-glyph entries) and `source = "AI_SCHEDULE"`.
 *   4. UI surfaces an "Accept all" / per-row review list. Accepting
 *      writes COUNT measurements onto the schedule sheet itself with
 *      `source = "AI_DETECTED"` and `status = "DRAFT"` so they pass
 *      through normal estimator review.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  aiEstimatorLegendSymbols,
  projectPlans,
  takeoffSheets,
  takeoffMeasurements,
  type AiEstimatorLegendSymbol,
} from "@shared/schema";
import { extractPageTextsFromUrl } from "../../ai/documentExtractor";
import { routedChatCompletion } from "../../ai/providers";
import { governedAiCall } from "../aiGovernance";
import { assertBidInOrg, ResourceOwnershipError } from "./access";
import { logInfo, logWarn } from "../../utils/logger";
import {
  detectPromptInjection,
  quarantineDocumentBlocks,
  shouldRefusePromptInjection,
  validateAiJsonOutput,
} from "../../ai/promptInjectionGuard";

export type ScheduleSymbolKind = "DOOR" | "WINDOW" | "FIXTURE" | "PANEL";
const SCHEDULE_KINDS = ["DOOR", "WINDOW", "FIXTURE", "PANEL"] as const;

const SCHEDULE_OUTPUT_SCHEMA = z.object({
  rows: z.array(z.object({
    kind: z.enum(["DOOR", "WINDOW", "FIXTURE", "PANEL"]),
    code: z.string(),
    description: z.string().optional(),
    count: z.number().int().min(0),
    confidence: z.number().min(0).max(1).optional(),
  })),
});

const KIND_KEYWORDS: Record<ScheduleSymbolKind, RegExp> = {
  DOOR: /\b(door)\s+(schedule|sched\.?)\b/i,
  WINDOW: /\b(window)\s+(schedule|sched\.?)\b/i,
  FIXTURE: /\b(plumbing\s+)?fixture\s+(schedule|sched\.?)\b/i,
  PANEL: /\b(panel(board)?)\s+(schedule|sched\.?)\b/i,
};

const TRADE_FOR_KIND: Record<ScheduleSymbolKind, string> = {
  DOOR: "A",
  WINDOW: "A",
  FIXTURE: "P",
  PANEL: "E",
};

interface CandidateSheet {
  sheetId: string;
  planDocumentId: string | null;
  sheetIndex: number;
  sheetName: string | null;
  sheetNumber: string | null;
  matchedKinds: ScheduleSymbolKind[];
  /** Cached extracted text for this sheet's specific page (PDF page = sheetIndex+1). */
  cachedPageText: string | null;
}

function detectKindsForSheet(opts: {
  sheetName: string | null;
  sheetNumber: string | null;
  pageText: string | null;
}): ScheduleSymbolKind[] {
  const haystack = [opts.sheetName, opts.sheetNumber, opts.pageText]
    .filter((s): s is string => !!s)
    .join("\n");
  if (!haystack) return [];
  const out: ScheduleSymbolKind[] = [];
  for (const k of SCHEDULE_KINDS) {
    if (KIND_KEYWORDS[k].test(haystack)) out.push(k);
  }
  return out;
}

export async function findScheduleSheets(opts: {
  organizationId: string;
  bidId: string;
}): Promise<CandidateSheet[]> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return [];
  }
  const sheets = await db
    .select({
      id: takeoffSheets.id,
      planId: takeoffSheets.planId,
      sheetIndex: takeoffSheets.sheetIndex,
      sheetName: takeoffSheets.sheetName,
      sheetNumber: takeoffSheets.sheetNumber,
      extractedTextByPage: takeoffSheets.extractedTextByPage,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));

  const out: CandidateSheet[] = [];
  for (const s of sheets) {
    const cached = s.extractedTextByPage as Record<string, string> | null;
    const pageText = cached ? cached[String(s.sheetIndex + 1)] ?? null : null;
    const kinds = detectKindsForSheet({
      sheetName: s.sheetName,
      sheetNumber: s.sheetNumber,
      pageText,
    });
    if (kinds.length === 0) continue;
    out.push({
      sheetId: s.id,
      planDocumentId: s.planId,
      sheetIndex: s.sheetIndex,
      sheetName: s.sheetName,
      sheetNumber: s.sheetNumber,
      matchedKinds: kinds,
      cachedPageText: pageText,
    });
  }
  return out;
}

export interface ExtractedScheduleSymbol {
  symbolId: string;
  kind: ScheduleSymbolKind;
  code: string;
  description: string | null;
  count: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  sheetId: string;
  sheetCitation: string;
  status: "PENDING_REVIEW" | "ACCEPTED";
}

function bandConfidence(p: number | undefined): "HIGH" | "MEDIUM" | "LOW" {
  if (typeof p !== "number") return "MEDIUM";
  if (p >= 0.85) return "HIGH";
  if (p >= 0.55) return "MEDIUM";
  return "LOW";
}

export async function extractScheduleSymbolsForBid(opts: {
  organizationId: string;
  userId: string;
  bidId: string;
}): Promise<{
  extracted: ExtractedScheduleSymbol[];
  candidateSheets: number;
  blocked?: boolean;
  reason?: string;
}> {
  const candidates = await findScheduleSheets({
    organizationId: opts.organizationId,
    bidId: opts.bidId,
  });
  if (candidates.length === 0) {
    return { extracted: [], candidateSheets: 0, reason: "No schedule sheets found" };
  }

  // Resolve plan-doc URLs once. We only need them as a fallback when the
  // candidate sheet has no cached page text yet.
  const planIds = Array.from(new Set(candidates.map((c) => c.planDocumentId).filter((id): id is string => !!id)));
  const docs = planIds.length > 0
    ? await db
        .select({ id: projectPlans.id, fileUrl: projectPlans.originalPdfUrl })
        .from(projectPlans)
        .where(inArray(projectPlans.id, planIds))
    : [];
  const docById = new Map(docs.map((d) => [d.id, d] as const));

  const extracted: ExtractedScheduleSymbol[] = [];
  let blocked = false;
  let blockedReason: string | undefined;

  for (const cand of candidates) {
    // Page-scoped extraction: use the cached text for THIS specific page
    // (not the first 5 pages of the whole document, which would miss
    // schedules on later sheets and duplicate results across candidates).
    let pageText = cand.cachedPageText;
    if (!pageText || pageText.trim().length < 20) {
      const doc = cand.planDocumentId ? docById.get(cand.planDocumentId) : undefined;
      if (!doc?.fileUrl) continue;
      const targetPage = cand.sheetIndex + 1;
      const result = await extractPageTextsFromUrl(doc.fileUrl, {
        startPage: targetPage,
        endPage: targetPage,
        maxPages: 1,
      }).catch(() => null);
      pageText = result?.pages?.[String(targetPage)] ?? null;
    }
    if (!pageText || pageText.trim().length < 20) continue;

    const detection = detectPromptInjection(pageText);
    if (shouldRefusePromptInjection(detection)) {
      logWarn("[scheduleCounts] refused (prompt injection)", {
        bidId: opts.bidId,
        sheetId: cand.sheetId,
      });
      continue;
    }
    const quarantined = quarantineDocumentBlocks([{ type: "text" as const, text: pageText }]);
    const userText = quarantined.map((b) => (b as { text: string }).text).join("\n");

    const sysPrompt = `You read construction "schedule" sheets — door schedules, window schedules, plumbing fixture schedules, and electrical panel schedules. Extract every row of every schedule visible. Return strict JSON: { "rows": [{ "kind": "DOOR|WINDOW|FIXTURE|PANEL", "code": string (the schedule mark/tag e.g. "D-101", "W-3", "F-1", "LP-A"), "description": string|null, "count": integer (the quantity column; if absent, 1), "confidence": number 0..1 }] }. Skip header rows and totals. If a sheet contains multiple schedules, emit rows for all kinds present.`;

    const gov = await governedAiCall<string | null>({
      orgId: opts.organizationId,
      userId: opts.userId,
      actionType: "ai_estimator.schedule_extract",
      inputRefs: { bidId: opts.bidId, sheetId: cand.sheetId, kinds: cand.matchedKinds },
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId: opts.organizationId,
          featureKey: "ai_estimator.sheet_index",
          request: {
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: userText },
            ],
            max_completion_tokens: 2500,
            response_format: { type: "json_object" },
          },
        });
        return { result: completion.choices[0]?.message?.content ?? null, completion };
      },
    });

    if (gov.blocked) {
      blocked = true;
      blockedReason = gov.reason;
      break;
    }
    const validated = validateAiJsonOutput(SCHEDULE_OUTPUT_SCHEMA, gov.result);
    if (!validated.ok) {
      logWarn("[scheduleCounts] invalid JSON", { sheetId: cand.sheetId, reason: validated.reason });
      continue;
    }

    const cite = cand.sheetNumber || cand.sheetName || `sheet ${cand.sheetIndex + 1}`;
    for (const row of validated.data.rows) {
      // Stable code: SCH:<KIND>:<CODE>. Persists per-bid so re-running
      // updates counts in place rather than duplicating.
      const symbolCode = `SCH:${row.kind}:${row.code}`.slice(0, 200);
      const definition = `${row.kind} schedule entry ${row.code}${row.description ? ` — ${row.description}` : ""} (×${row.count}) on ${cite}`;
      try {
        const [persisted] = await db
          .insert(aiEstimatorLegendSymbols)
          .values({
            organizationId: opts.organizationId,
            bidId: opts.bidId,
            legendSheetId: cand.sheetId,
            symbolCode,
            definition,
            trade: TRADE_FOR_KIND[row.kind],
            count: row.count,
            occurrences: { sheetId: cand.sheetId, sheetCitation: cite, kind: row.kind, code: row.code, description: row.description ?? null },
            source: "AI_SCHEDULE",
            confidence: bandConfidence(row.confidence),
          })
          .onConflictDoUpdate({
            target: [
              aiEstimatorLegendSymbols.organizationId,
              aiEstimatorLegendSymbols.bidId,
              aiEstimatorLegendSymbols.symbolCode,
            ],
            set: {
              definition,
              count: row.count,
              occurrences: { sheetId: cand.sheetId, sheetCitation: cite, kind: row.kind, code: row.code, description: row.description ?? null },
              confidence: bandConfidence(row.confidence),
              source: "AI_SCHEDULE",
              updatedAt: new Date(),
            },
          })
          .returning();
        extracted.push({
          symbolId: persisted.id,
          kind: row.kind,
          code: row.code,
          description: row.description ?? null,
          count: row.count,
          confidence: bandConfidence(row.confidence),
          sheetId: cand.sheetId,
          sheetCitation: cite,
          status: "PENDING_REVIEW",
        });
      } catch (err) {
        logWarn("[scheduleCounts] persist failed", { code: symbolCode, error: String(err) });
      }
    }
  }

  logInfo("[scheduleCounts] complete", {
    bidId: opts.bidId,
    candidateSheets: candidates.length,
    extracted: extracted.length,
    blocked,
  });
  return {
    extracted,
    candidateSheets: candidates.length,
    blocked: blocked || undefined,
    reason: blockedReason,
  };
}

export async function listScheduleSymbolsForBid(opts: {
  organizationId: string;
  bidId: string;
  includeRejected?: boolean;
}): Promise<AiEstimatorLegendSymbol[]> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return [];
  }
  const conds = [
    eq(aiEstimatorLegendSymbols.organizationId, opts.organizationId),
    eq(aiEstimatorLegendSymbols.bidId, opts.bidId),
    eq(aiEstimatorLegendSymbols.source, "AI_SCHEDULE"),
  ];
  if (!opts.includeRejected) {
    conds.push(ne(aiEstimatorLegendSymbols.reviewStatus, "REJECTED"));
  }
  const rows = await db
    .select()
    .from(aiEstimatorLegendSymbols)
    .where(and(...conds));
  return rows;
}

/**
 * Estimator override: tweak the AI's parsed count / code / description
 * before accepting (or instead of accepting). Marks the row as EDITED
 * so the next /extract pass can choose to skip it.
 */
export async function editScheduleSymbol(opts: {
  organizationId: string;
  bidId: string;
  symbolId: string;
  updates: { count?: number; code?: string; description?: string };
}): Promise<AiEstimatorLegendSymbol | null> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return null;
  }
  const [existing] = await db
    .select()
    .from(aiEstimatorLegendSymbols)
    .where(
      and(
        eq(aiEstimatorLegendSymbols.organizationId, opts.organizationId),
        eq(aiEstimatorLegendSymbols.bidId, opts.bidId),
        eq(aiEstimatorLegendSymbols.id, opts.symbolId),
      ),
    );
  if (!existing) return null;
  const occ = (existing.occurrences as Record<string, unknown> | null) ?? {};
  const nextOcc: Record<string, unknown> = { ...occ };
  if (typeof opts.updates.code === "string") nextOcc.code = opts.updates.code;
  if (typeof opts.updates.description === "string") nextOcc.description = opts.updates.description;
  const [updated] = await db
    .update(aiEstimatorLegendSymbols)
    .set({
      count: typeof opts.updates.count === "number" ? Math.max(0, Math.round(opts.updates.count)) : existing.count,
      occurrences: nextOcc,
      reviewStatus: "EDITED",
      updatedAt: new Date(),
    })
    .where(eq(aiEstimatorLegendSymbols.id, opts.symbolId))
    .returning();
  return updated ?? null;
}

/**
 * Reject a schedule symbol so it stops appearing in the review list and
 * is NOT written to takeoff_measurements.
 */
export async function rejectScheduleSymbols(opts: {
  organizationId: string;
  bidId: string;
  symbolIds: string[];
}): Promise<{ rejected: number }> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return { rejected: 0 };
  }
  if (opts.symbolIds.length === 0) return { rejected: 0 };
  const result = await db
    .update(aiEstimatorLegendSymbols)
    .set({ reviewStatus: "REJECTED", updatedAt: new Date() })
    .where(
      and(
        eq(aiEstimatorLegendSymbols.organizationId, opts.organizationId),
        eq(aiEstimatorLegendSymbols.bidId, opts.bidId),
        inArray(aiEstimatorLegendSymbols.id, opts.symbolIds),
      ),
    )
    .returning({ id: aiEstimatorLegendSymbols.id });
  return { rejected: result.length };
}

/**
 * Accept a set of schedule symbol rows: write each as a COUNT
 * `takeoff_measurement` on its source sheet, in DRAFT status with
 * source `AI_DETECTED` so it appears in the normal estimator review
 * queue. Idempotent on (sheetId, label) — re-accepting updates count.
 */
export async function acceptScheduleSymbols(opts: {
  organizationId: string;
  bidId: string;
  symbolIds: string[];
}): Promise<{ accepted: number; skipped: number }> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) return { accepted: 0, skipped: opts.symbolIds.length };
    throw err;
  }
  if (opts.symbolIds.length === 0) return { accepted: 0, skipped: 0 };

  const rows = await db
    .select()
    .from(aiEstimatorLegendSymbols)
    .where(
      and(
        eq(aiEstimatorLegendSymbols.organizationId, opts.organizationId),
        eq(aiEstimatorLegendSymbols.bidId, opts.bidId),
        inArray(aiEstimatorLegendSymbols.id, opts.symbolIds),
      ),
    );

  let accepted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.source !== "AI_SCHEDULE" || !row.legendSheetId) {
      skipped++;
      continue;
    }
    if (row.reviewStatus === "REJECTED") {
      skipped++;
      continue;
    }
    const occ = (row.occurrences as { kind?: string; code?: string; sheetCitation?: string } | null) ?? {};
    const label = `${occ.kind ?? "ITEM"} ${occ.code ?? row.symbolCode.replace(/^SCH:[^:]+:/, "")} (schedule)`;
    const note = `Accepted from schedule on ${occ.sheetCitation ?? "schedule sheet"} (symbol ${row.symbolCode}).`;
    try {
      // Idempotency anchor (Task #2577): re-accepting the same legend
      // symbol must UPDATE the existing measurement instead of inserting
      // a duplicate. The partial-unique index on
      // takeoff_measurements.source_symbol_id (migration 0101) makes
      // ON CONFLICT well-defined.
      const [existingMeasurement] = await db
        .select({ id: takeoffMeasurements.id })
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sourceSymbolId, row.id))
        .limit(1);
      if (existingMeasurement) {
        await db
          .update(takeoffMeasurements)
          .set({
            label,
            count: row.count,
            note,
          })
          .where(eq(takeoffMeasurements.id, existingMeasurement.id));
      } else {
        await db.insert(takeoffMeasurements).values({
          sheetId: row.legendSheetId,
          type: "COUNT",
          label,
          points: "[]",
          count: row.count,
          source: "AI",
          status: "DRAFT",
          note,
          needsReview: true,
          calibrationSource: "AI_DETECTED",
          sourceSymbolId: row.id,
        });
      }
      // Stamp the legend row as ACCEPTED so the review UI can hide it
      // (or render it differently) on the next refetch.
      await db
        .update(aiEstimatorLegendSymbols)
        .set({ reviewStatus: "ACCEPTED", updatedAt: new Date() })
        .where(eq(aiEstimatorLegendSymbols.id, row.id));
      accepted++;
    } catch (err) {
      logWarn("[scheduleCounts] accept failed", { symbolId: row.id, error: String(err) });
      skipped++;
    }
  }
  return { accepted, skipped };
}
