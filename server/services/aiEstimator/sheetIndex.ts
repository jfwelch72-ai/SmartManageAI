/**
 * Task #2466 Phase 1 — Sheet indexing & trade routing.
 *
 * Reads the cover/title pages of plan documents associated with a bid,
 * classifies each sheet by AIA discipline (A, S, M, E, P, C, L, FP, T,
 * Q, G, I, O) and sheet number, and stores the result on the matching
 * `takeoff_sheets` rows so the AI takeoff drafter can pull only the
 * subset relevant to a given trade.
 *
 * Two paths:
 *   1. AI pass — `routedChatCompletion` with a tight JSON schema. Used
 *      when the org has the AI Estimator enabled.
 *   2. Filename heuristic fallback — pure regex over `sheet_name` /
 *      filename. Always available and used when (a) the AI call is
 *      blocked by governance, (b) returns non-JSON, or (c) for a sheet
 *      the AI didn't touch.
 *
 * The function never throws; the worst case is an empty result and
 * unchanged sheet rows.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  bids,
  planDocuments,
  takeoffSheets,
  // Task #2551 — Standalone takeoff source.
  standaloneTakeoffs,
  standaloneTakeoffFiles,
  SHEET_DISCIPLINES,
  type SheetDiscipline,
  type SheetDisciplineSource,
} from "@shared/schema";
import { extractDocumentContent } from "../../ai/documentExtractor";
import { routedChatCompletion } from "../../ai/providers";
import type { AiContentPart } from "../../ai/providers/types";
import { governedAiCall } from "../aiGovernance";
import { assertBidInOrg, ResourceOwnershipError } from "./access";
import { logError, logInfo, logWarn } from "../../utils/logger";
// Task #2494 — All untrusted plan-sheet content sent to the LLM must flow
// through the prompt-injection guard. Refusing on high-signal payloads and
// validating the JSON shape stops a hostile uploaded plan set from
// hijacking the sheet-classifier.
import { z } from "zod";
import {
  detectPromptInjection,
  quarantineDocumentBlocks,
  shouldRefusePromptInjection,
  validateAiJsonOutput,
} from "../../ai/promptInjectionGuard";

const SHEET_INDEX_OUTPUT_SCHEMA = z.object({
  sheets: z.array(z.object({
    sheetIndex: z.number(),
    discipline: z.string(),
    sheetNumber: z.string().nullable().optional(),
    confidence: z.number().optional(),
    // Task #2623 — Free-text rationale for the chosen discipline so
    // reviewers can see *why* the model classified a low-confidence
    // sheet a particular way before confirming or overriding it.
    rationale: z.string().nullable().optional(),
  })),
});

const ALLOWED_DISCIPLINES = new Set<string>(SHEET_DISCIPLINES);

export interface SheetIndexEntry {
  sheetId: string;
  sheetIndex: number;
  sheetName: string | null;
  discipline: SheetDiscipline | null;
  sheetNumber: string | null;
  disciplineConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  disciplineSource: SheetDisciplineSource | null;
  // Task #2623 — Numeric confidence (0..1), free-text rationale,
  // and reviewer audit fields. All nullable for sheets that were
  // never classified or never reviewed.
  disciplineConfidenceScore: number | null;
  disciplineRationale: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
}

interface AiSheetClassification {
  sheetIndex: number;
  discipline: string;
  sheetNumber: string | null;
  confidence: number; // 0..1
  rationale: string | null;
}

/**
 * Filename / sheet-name regex heuristic.
 * Matches patterns like "M-101", "E2.01", "S-001", "FP1.1", "A 100".
 */
export function disciplineFromText(input: string | null | undefined): {
  discipline: SheetDiscipline | null;
  sheetNumber: string | null;
} {
  if (!input) return { discipline: null, sheetNumber: null };
  const cleaned = input.toUpperCase().replace(/[\s_]+/g, "");
  // Two-letter codes first (FP) then single-letter.
  const m = cleaned.match(/(FP|[GASMEPCLTQIO])[-.]?(\d{1,4}(?:\.\d{1,3})?)/);
  if (!m) return { discipline: null, sheetNumber: null };
  const code = m[1] as SheetDiscipline;
  if (!ALLOWED_DISCIPLINES.has(code)) {
    return { discipline: "O", sheetNumber: m[2] };
  }
  return { discipline: code, sheetNumber: `${code}-${m[2]}` };
}

function coarseConfidence(p: number): "HIGH" | "MEDIUM" | "LOW" {
  if (p >= 0.8) return "HIGH";
  if (p >= 0.5) return "MEDIUM";
  return "LOW";
}

/**
 * Run the sheet-index pass for every plan document on a bid. Returns
 * the new index. Never throws — partial failures are logged and left
 * with `discipline=null` for downstream UI to flag.
 */
export async function indexPlanSheetsForBid(opts: {
  organizationId: string;
  userId: string;
  bidId: string;
}): Promise<{ indexed: SheetIndexEntry[]; aiBlocked?: boolean; reason?: string }> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) {
      return { indexed: [], reason: "Bid not in org" };
    }
    throw err;
  }

  const sheets = await db
    .select()
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));

  if (sheets.length === 0) {
    return { indexed: [], reason: "No sheets to index" };
  }

  // Fast path: heuristic over sheet_name. Always run first so even
  // if the AI call fails we still get a best-effort classification.
  const heuristicResults = new Map<string, { discipline: SheetDiscipline | null; sheetNumber: string | null }>();
  for (const s of sheets) {
    const h = disciplineFromText(s.sheetName ?? null);
    heuristicResults.set(s.id, h);
  }

  // AI pass — pull plan documents, classify per page.
  const planDocRows = await db
    .select()
    .from(planDocuments)
    .where(eq(planDocuments.projectId, sheets[0].projectId ?? ""));
  // Sheets may belong to multiple plan documents on the same project;
  // we group by `planId` if present.

  let aiBlocked = false;
  let aiReason: string | undefined;
  const aiBySheetId = new Map<string, AiSheetClassification & { source: SheetDisciplineSource }>();

  // Best-effort AI classification per plan document (cap to 8 docs).
  const docs = planDocRows.slice(0, 8);
  for (const doc of docs) {
    if (!doc.fileUrl) continue;
    let rawBlocks;
    try {
      rawBlocks = await extractDocumentContent(doc.fileUrl);
    } catch (e) {
      logWarn("[sheetIndex] extract failed", { url: doc.fileUrl, error: String(e) });
      continue;
    }
    if (!rawBlocks || rawBlocks.length === 0) continue;

    // Task #2494 — refuse on high-signal prompt-injection payloads
    // embedded in the plan set, then wrap every untrusted text/image
    // block in the quarantine envelope.
    const extractedText = rawBlocks
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const detection = detectPromptInjection(extractedText);
    if (shouldRefusePromptInjection(detection)) {
      logWarn("[sheetIndex] AI sheet classification refused (prompt injection)", {
        planDocumentId: doc.id,
        matches: detection.matches.map((m) => m.id),
      });
      continue;
    }
    const blocks = quarantineDocumentBlocks(rawBlocks) as typeof rawBlocks;

    const sysPrompt = `You read construction plan sets and classify each page by AIA discipline.
Return strict JSON: { "sheets": [{ "sheetIndex": number (0-based page), "discipline": "G|A|S|M|E|P|C|L|FP|T|Q|I|O", "sheetNumber": string|null, "confidence": number 0..1, "rationale": string }] }
Include a one-sentence "rationale" explaining the discipline choice (e.g. "title block reads M-101 HVAC Plan").
Only emit one entry per page in the order shown. If you cannot tell, set discipline to "O" and confidence < 0.5.`;

    const gov = await governedAiCall<string | null>({
      orgId: opts.organizationId,
      userId: opts.userId,
      actionType: "ai_estimator.sheet_index",
      inputRefs: { bidId: opts.bidId, planDocumentId: doc.id, pageBlocks: blocks.length },
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId: opts.organizationId,
          featureKey: "ai_estimator.sheet_index",
          request: {
            messages: [
              { role: "system", content: sysPrompt },
              {
                role: "user",
                content: [
                  ...blocks.map<AiContentPart>((b) =>
                    b.type === "image_url"
                      ? { type: "image_url", image_url: { url: b.image_url.url, detail: "auto" } }
                      : { type: "text", text: b.text },
                  ),
                  { type: "text", text: "Classify each page." },
                ],
              },
            ],
            max_completion_tokens: 1500,
            response_format: { type: "json_object" },
          },
        });
        return { result: completion.choices[0]?.message?.content ?? null, completion };
      },
    });

    if (gov.blocked) {
      aiBlocked = true;
      aiReason = gov.reason;
      break;
    }

    const validated = validateAiJsonOutput(SHEET_INDEX_OUTPUT_SCHEMA, gov.result);
    if (!validated.ok) {
      logWarn("[sheetIndex] AI returned non-JSON / invalid shape for doc", { docId: doc.id, reason: validated.reason });
      continue;
    }

    // Map per-page classifications back onto takeoff_sheets rows that
    // share a (planId, sheetIndex) tuple. When planId is missing we
    // fall back to the bid + sheetIndex lookup.
    for (const entry of validated.data.sheets as AiSheetClassification[]) {
      if (typeof entry.sheetIndex !== "number") continue;
      const target = sheets.find((s) =>
        s.planId
          ? s.planId === doc.id && s.sheetIndex === entry.sheetIndex
          : s.sheetIndex === entry.sheetIndex,
      );
      if (!target) continue;
      const code = (entry.discipline ?? "").toUpperCase();
      const safeCode = ALLOWED_DISCIPLINES.has(code) ? (code as SheetDiscipline) : "O";
      aiBySheetId.set(target.id, {
        sheetIndex: entry.sheetIndex,
        discipline: safeCode,
        sheetNumber: entry.sheetNumber ?? null,
        confidence: typeof entry.confidence === "number" ? entry.confidence : 0.5,
        rationale: typeof entry.rationale === "string" ? entry.rationale : null,
        source: "AI_DETECTED",
      });
    }
  }

  // Merge: AI wins when present, heuristic otherwise. Task #2623 —
  // sheets a human has already confirmed (`disciplineSource === 'USER'`)
  // are treated as ground truth and never overwritten by a re-index pass.
  const updates: SheetIndexEntry[] = [];
  for (const s of sheets) {
    if (s.disciplineSource === "USER") {
      // Surface the existing human-confirmed row in the response so the
      // caller can see the full index, but skip the DB write.
      updates.push(toEntry(s));
      continue;
    }
    const ai = aiBySheetId.get(s.id);
    const h = heuristicResults.get(s.id) ?? { discipline: null, sheetNumber: null };
    const discipline = ai?.discipline ?? h.discipline;
    const sheetNumber = ai?.sheetNumber ?? h.sheetNumber;
    const source: SheetDisciplineSource | null = ai
      ? "AI_DETECTED"
      : h.discipline
        ? "FILENAME_HEURISTIC"
        : null;
    const confidence = ai
      ? coarseConfidence(ai.confidence)
      : h.discipline
        ? "MEDIUM"
        : null;
    const confidenceScore = ai
      ? ai.confidence
      : h.discipline
        ? 0.6
        : null;
    const rationale = ai?.rationale ?? (h.discipline ? "Filename / sheet-name heuristic match" : null);
    if (!discipline) continue;
    const disciplineTyped = discipline as SheetDiscipline;
    await db
      .update(takeoffSheets)
      .set({
        discipline: disciplineTyped,
        sheetNumber,
        disciplineConfidence: confidence,
        disciplineSource: source,
        disciplineConfidenceScore: confidenceScore,
        disciplineRationale: rationale,
        // A re-index of an unreviewed row clears any stale reviewer
        // pointer (the human-confirmed early-return above already
        // protects rows that actually were reviewed).
        reviewedById: null,
        reviewedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(takeoffSheets.id, s.id));
    updates.push({
      sheetId: s.id,
      sheetIndex: s.sheetIndex,
      sheetName: s.sheetName,
      discipline: disciplineTyped,
      sheetNumber,
      disciplineConfidence: confidence,
      disciplineSource: source,
      disciplineConfidenceScore: confidenceScore,
      disciplineRationale: rationale,
      reviewedById: null,
      reviewedAt: null,
    });
  }

  logInfo("[sheetIndex] indexed", {
    bidId: opts.bidId,
    sheets: sheets.length,
    classified: updates.length,
    aiBlocked,
  });

  return { indexed: updates, aiBlocked, reason: aiReason };
}

// Map a takeoff_sheets row (with all the discipline columns selected)
// onto a SheetIndexEntry. Used so we can short-circuit USER-confirmed
// rows during re-indexing without re-reading the DB.
function toEntry(s: {
  id: string;
  sheetIndex: number;
  sheetName: string | null;
  discipline: string | null;
  sheetNumber: string | null;
  disciplineConfidence: string | null;
  disciplineSource: string | null;
  disciplineConfidenceScore: number | null;
  disciplineRationale: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
}): SheetIndexEntry {
  return {
    sheetId: s.id,
    sheetIndex: s.sheetIndex,
    sheetName: s.sheetName,
    discipline: (s.discipline as SheetDiscipline | null) ?? null,
    sheetNumber: s.sheetNumber,
    disciplineConfidence: (s.disciplineConfidence as "HIGH" | "MEDIUM" | "LOW" | null) ?? null,
    disciplineSource: (s.disciplineSource as SheetDisciplineSource | null) ?? null,
    disciplineConfidenceScore: s.disciplineConfidenceScore,
    disciplineRationale: s.disciplineRationale,
    reviewedById: s.reviewedById,
    reviewedAt: s.reviewedAt,
  };
}

/**
 * Task #2551 — Sheet indexer for standalone takeoffs.
 *
 * Mirrors `indexPlanSheetsForBid` but pulls plan-document URLs from
 * `standalone_takeoff_files` and pulls sheets from `takeoff_sheets`
 * scoped by `standalone_takeoff_id`. Standalone sheets do not carry a
 * `planId`, so the AI mapping falls back to (sheetIndex) only.
 */
export async function indexPlanSheetsForStandaloneTakeoff(opts: {
  organizationId: string;
  userId: string;
  standaloneTakeoffId: string;
}): Promise<{ indexed: SheetIndexEntry[]; aiBlocked?: boolean; reason?: string }> {
  const [takeoff] = await db
    .select({ id: standaloneTakeoffs.id, organizationId: standaloneTakeoffs.organizationId })
    .from(standaloneTakeoffs)
    .where(eq(standaloneTakeoffs.id, opts.standaloneTakeoffId))
    .limit(1);
  if (!takeoff || takeoff.organizationId !== opts.organizationId) {
    return { indexed: [], reason: "Standalone takeoff not in org" };
  }

  const sheets = await db
    .select()
    .from(takeoffSheets)
    .where(eq(takeoffSheets.standaloneTakeoffId, opts.standaloneTakeoffId));
  if (sheets.length === 0) {
    return { indexed: [], reason: "No sheets to index" };
  }

  const heuristicResults = new Map<string, { discipline: SheetDiscipline | null; sheetNumber: string | null }>();
  for (const s of sheets) {
    heuristicResults.set(s.id, disciplineFromText(s.sheetName ?? null));
  }

  const fileRows = await db
    .select({ id: standaloneTakeoffFiles.id, fileUrl: standaloneTakeoffFiles.fileUrl })
    .from(standaloneTakeoffFiles)
    .where(eq(standaloneTakeoffFiles.standaloneTakeoffId, opts.standaloneTakeoffId));

  let aiBlocked = false;
  let aiReason: string | undefined;
  const aiBySheetId = new Map<string, AiSheetClassification & { source: SheetDisciplineSource }>();

  const docs = fileRows.slice(0, 8);
  for (const doc of docs) {
    if (!doc.fileUrl) continue;
    let rawBlocks;
    try {
      rawBlocks = await extractDocumentContent(doc.fileUrl);
    } catch (e) {
      logWarn("[sheetIndex] standalone extract failed", { url: doc.fileUrl, error: String(e) });
      continue;
    }
    if (!rawBlocks || rawBlocks.length === 0) continue;

    const extractedText = rawBlocks
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const detection = detectPromptInjection(extractedText);
    if (shouldRefusePromptInjection(detection)) {
      logWarn("[sheetIndex] standalone AI sheet classification refused (prompt injection)", {
        standaloneTakeoffId: opts.standaloneTakeoffId,
        fileId: doc.id,
        matches: detection.matches.map((m) => m.id),
      });
      continue;
    }
    const blocks = quarantineDocumentBlocks(rawBlocks) as typeof rawBlocks;

    const sysPrompt = `You read construction plan sets and classify each page by AIA discipline.
Return strict JSON: { "sheets": [{ "sheetIndex": number (0-based page), "discipline": "G|A|S|M|E|P|C|L|FP|T|Q|I|O", "sheetNumber": string|null, "confidence": number 0..1, "rationale": string }] }
Include a one-sentence "rationale" explaining the discipline choice (e.g. "title block reads M-101 HVAC Plan").
Only emit one entry per page in the order shown. If you cannot tell, set discipline to "O" and confidence < 0.5.`;

    const gov = await governedAiCall<string | null>({
      orgId: opts.organizationId,
      userId: opts.userId,
      actionType: "ai_estimator.sheet_index",
      inputRefs: { standaloneTakeoffId: opts.standaloneTakeoffId, fileId: doc.id, pageBlocks: blocks.length },
      fn: async () => {
        const completion = await routedChatCompletion({
          orgId: opts.organizationId,
          featureKey: "ai_estimator.sheet_index",
          request: {
            messages: [
              { role: "system", content: sysPrompt },
              {
                role: "user",
                content: [
                  ...blocks.map<AiContentPart>((b) =>
                    b.type === "image_url"
                      ? { type: "image_url", image_url: { url: b.image_url.url, detail: "auto" } }
                      : { type: "text", text: b.text },
                  ),
                  { type: "text", text: "Classify each page." },
                ],
              },
            ],
            max_completion_tokens: 1500,
            response_format: { type: "json_object" },
          },
        });
        return { result: completion.choices[0]?.message?.content ?? null, completion };
      },
    });

    if (gov.blocked) {
      aiBlocked = true;
      aiReason = gov.reason;
      break;
    }

    const validated = validateAiJsonOutput(SHEET_INDEX_OUTPUT_SCHEMA, gov.result);
    if (!validated.ok) {
      logWarn("[sheetIndex] standalone AI returned non-JSON / invalid shape", {
        fileId: doc.id,
        reason: validated.reason,
      });
      continue;
    }

    for (const entry of validated.data.sheets as AiSheetClassification[]) {
      if (typeof entry.sheetIndex !== "number") continue;
      const target = sheets.find((s) => s.sheetIndex === entry.sheetIndex);
      if (!target) continue;
      const code = (entry.discipline ?? "").toUpperCase();
      const safeCode = ALLOWED_DISCIPLINES.has(code) ? (code as SheetDiscipline) : "O";
      aiBySheetId.set(target.id, {
        sheetIndex: entry.sheetIndex,
        discipline: safeCode,
        sheetNumber: entry.sheetNumber ?? null,
        confidence: typeof entry.confidence === "number" ? entry.confidence : 0.5,
        rationale: typeof entry.rationale === "string" ? entry.rationale : null,
        source: "AI_DETECTED",
      });
    }
  }

  const updates: SheetIndexEntry[] = [];
  for (const s of sheets) {
    if (s.disciplineSource === "USER") {
      updates.push(toEntry(s));
      continue;
    }
    const ai = aiBySheetId.get(s.id);
    const h = heuristicResults.get(s.id) ?? { discipline: null, sheetNumber: null };
    const discipline = ai?.discipline ?? h.discipline;
    const sheetNumber = ai?.sheetNumber ?? h.sheetNumber;
    const source: SheetDisciplineSource | null = ai
      ? "AI_DETECTED"
      : h.discipline
        ? "FILENAME_HEURISTIC"
        : null;
    const confidence = ai
      ? coarseConfidence(ai.confidence)
      : h.discipline
        ? "MEDIUM"
        : null;
    const confidenceScore = ai
      ? ai.confidence
      : h.discipline
        ? 0.6
        : null;
    const rationale = ai?.rationale ?? (h.discipline ? "Filename / sheet-name heuristic match" : null);
    if (!discipline) continue;
    const disciplineTyped = discipline as SheetDiscipline;
    await db
      .update(takeoffSheets)
      .set({
        discipline: disciplineTyped,
        sheetNumber,
        disciplineConfidence: confidence,
        disciplineSource: source,
        disciplineConfidenceScore: confidenceScore,
        disciplineRationale: rationale,
        reviewedById: null,
        reviewedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(takeoffSheets.id, s.id));
    updates.push({
      sheetId: s.id,
      sheetIndex: s.sheetIndex,
      sheetName: s.sheetName,
      discipline: disciplineTyped,
      sheetNumber,
      disciplineConfidence: confidence,
      disciplineSource: source,
      disciplineConfidenceScore: confidenceScore,
      disciplineRationale: rationale,
      reviewedById: null,
      reviewedAt: null,
    });
  }

  logInfo("[sheetIndex] standalone indexed", {
    standaloneTakeoffId: opts.standaloneTakeoffId,
    sheets: sheets.length,
    classified: updates.length,
    aiBlocked,
  });

  return { indexed: updates, aiBlocked, reason: aiReason };
}

/** Fire-and-forget standalone indexing (best-effort, swallows errors). */
export function indexPlanSheetsForStandaloneTakeoffSafe(opts: {
  organizationId: string;
  userId: string;
  standaloneTakeoffId: string;
}): void {
  indexPlanSheetsForStandaloneTakeoff(opts).catch((err) => {
    logWarn("standalone sheet indexing failed", {
      standaloneTakeoffId: opts.standaloneTakeoffId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Read the current sheet index for a bid. Read-only; no AI. */
export async function getSheetIndexForBid(opts: {
  organizationId: string;
  bidId: string;
}): Promise<SheetIndexEntry[]> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return [];
  }
  const rows = await db
    .select({
      id: takeoffSheets.id,
      sheetIndex: takeoffSheets.sheetIndex,
      sheetName: takeoffSheets.sheetName,
      discipline: takeoffSheets.discipline,
      sheetNumber: takeoffSheets.sheetNumber,
      disciplineConfidence: takeoffSheets.disciplineConfidence,
      disciplineSource: takeoffSheets.disciplineSource,
      disciplineConfidenceScore: takeoffSheets.disciplineConfidenceScore,
      disciplineRationale: takeoffSheets.disciplineRationale,
      reviewedById: takeoffSheets.reviewedById,
      reviewedAt: takeoffSheets.reviewedAt,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));
  return rows.map(toEntry);
}

/**
 * Task #2623 — "Needs review" queue. Returns sheets where the AI /
 * heuristic confidence is below the org-configured threshold AND a
 * human has not yet confirmed the classification. Sheets already
 * stamped `disciplineSource = 'USER'` are excluded — those are ground
 * truth.
 *
 * Caller is expected to have resolved the org's threshold via
 * `getOrgFactors(...)`. We accept it as a parameter rather than
 * importing orgFactors here to keep this module dependency-free of
 * the factors module.
 */
export async function getSheetReviewQueueForBid(opts: {
  organizationId: string;
  bidId: string;
  threshold: number;
}): Promise<SheetIndexEntry[]> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return [];
  }
  const all = await getSheetIndexForBid({
    organizationId: opts.organizationId,
    bidId: opts.bidId,
  });
  return all.filter((s) => {
    if (s.disciplineSource === "USER") return false;
    // Treat unscored sheets (null score) as needing review when there
    // *is* a discipline assigned so we don't lose track of heuristic-
    // only or pre-#2623 rows.
    if (s.discipline && s.disciplineConfidenceScore === null) return true;
    return (
      typeof s.disciplineConfidenceScore === "number" &&
      s.disciplineConfidenceScore < opts.threshold
    );
  });
}

/**
 * Task #2623 — Estimator confirms or overrides a sheet's AI-classified
 * discipline. Stamps `disciplineSource = 'USER'`, the reviewer's id and
 * a timestamp so later re-index passes leave the row alone.
 *
 * Returns the updated entry, or `null` if the sheet does not belong to
 * the caller's org / bid.
 */
export async function setSheetDiscipline(opts: {
  organizationId: string;
  bidId: string;
  sheetId: string;
  userId: string;
  discipline: SheetDiscipline;
  sheetNumber?: string | null;
}): Promise<SheetIndexEntry | null> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return null;
  }
  if (!ALLOWED_DISCIPLINES.has(opts.discipline)) return null;
  const now = new Date();
  const setPatch: Record<string, unknown> = {
    discipline: opts.discipline,
    disciplineSource: "USER",
    disciplineConfidence: "HIGH",
    disciplineConfidenceScore: 1,
    reviewedById: opts.userId,
    reviewedAt: now,
    updatedAt: now,
  };
  if (opts.sheetNumber !== undefined) {
    setPatch.sheetNumber = opts.sheetNumber;
  }
  const [updated] = await db
    .update(takeoffSheets)
    .set(setPatch)
    .where(
      and(
        eq(takeoffSheets.id, opts.sheetId),
        eq(takeoffSheets.bidId, opts.bidId),
      ),
    )
    .returning({
      id: takeoffSheets.id,
      sheetIndex: takeoffSheets.sheetIndex,
      sheetName: takeoffSheets.sheetName,
      discipline: takeoffSheets.discipline,
      sheetNumber: takeoffSheets.sheetNumber,
      disciplineConfidence: takeoffSheets.disciplineConfidence,
      disciplineSource: takeoffSheets.disciplineSource,
      disciplineConfidenceScore: takeoffSheets.disciplineConfidenceScore,
      disciplineRationale: takeoffSheets.disciplineRationale,
      reviewedById: takeoffSheets.reviewedById,
      reviewedAt: takeoffSheets.reviewedAt,
    });
  if (!updated) return null;
  return toEntry(updated);
}

/**
 * Resolve plan-document URLs to feed into the takeoff drafter, optionally
 * filtered by AIA discipline. When `disciplines` is empty the function
 * returns every plan-document URL in the bid.
 */
export async function resolvePlanUrlsForDisciplines(opts: {
  organizationId: string;
  bidId: string;
  disciplines?: string[];
}): Promise<string[]> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return [];
  }
  const sheets = await db
    .select({
      planId: takeoffSheets.planId,
      discipline: takeoffSheets.discipline,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));

  const wanted = opts.disciplines && opts.disciplines.length > 0
    ? new Set(opts.disciplines.map((d) => d.toUpperCase()))
    : null;
  const planIds = Array.from(
    new Set(
      sheets
        .filter((s) => (wanted ? !!s.discipline && wanted.has(s.discipline) : true))
        .map((s) => s.planId)
        .filter((id): id is string => !!id),
    ),
  );
  if (planIds.length === 0) return [];

  const docs = await db
    .select({ fileUrl: planDocuments.fileUrl })
    .from(planDocuments)
    .where(inArray(planDocuments.id, planIds));
  return docs.map((d) => d.fileUrl).filter((u): u is string => !!u);
}
