/**
 * Task #2466 Phase 1 (scaffolding) — legend & symbol recognition.
 *
 * Storage helpers + API surface for parsed legend entries. The actual
 * AI legend-parsing pass (vision over the legend pages) is a separate
 * follow-up task; this module provides the persistence layer so it can
 * land independently.
 *
 * Symbols are unique per (organization, bid, symbol_code) so re-running
 * the parser updates counts in place rather than duplicating rows.
 */

import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorLegendSymbols,
  type AiEstimatorLegendSymbol,
  type InsertAiEstimatorLegendSymbol,
} from "@shared/schema";
import { assertBidInOrg, ResourceOwnershipError } from "./access";

/**
 * Read every legend symbol for a bid.
 *
 * Task #2623 — Pipeline guard. By default REJECTED rows are excluded
 * from the result so any downstream consumer (the HITL queue UI, the
 * AI prompt that sketches glossary context for the drafter, schedule
 * acceptance, etc.) sees only the rows the human has not refused.
 * Pass `includeRejected: true` to surface them anyway (e.g. to render
 * a "rejected" tab in the review queue).
 */
export async function listLegendSymbolsForBid(
  organizationId: string,
  bidId: string,
  opts: { includeRejected?: boolean } = {},
): Promise<AiEstimatorLegendSymbol[]> {
  try {
    await assertBidInOrg(bidId, organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) return [];
    throw err;
  }
  const conds = [
    eq(aiEstimatorLegendSymbols.organizationId, organizationId),
    eq(aiEstimatorLegendSymbols.bidId, bidId),
  ];
  if (!opts.includeRejected) {
    conds.push(ne(aiEstimatorLegendSymbols.reviewStatus, "REJECTED"));
  }
  return db
    .select()
    .from(aiEstimatorLegendSymbols)
    .where(and(...conds))
    .orderBy(asc(aiEstimatorLegendSymbols.symbolCode));
}

export async function upsertLegendSymbol(
  data: InsertAiEstimatorLegendSymbol,
): Promise<AiEstimatorLegendSymbol> {
  const [row] = await db
    .insert(aiEstimatorLegendSymbols)
    .values(data)
    .onConflictDoUpdate({
      target: [
        aiEstimatorLegendSymbols.organizationId,
        aiEstimatorLegendSymbols.bidId,
        aiEstimatorLegendSymbols.symbolCode,
      ],
      set: {
        definition: data.definition,
        trade: data.trade ?? null,
        count: data.count ?? 0,
        occurrences: data.occurrences ?? null,
        legendSheetId: data.legendSheetId ?? null,
        glyphBbox: data.glyphBbox ?? null,
        confidence: data.confidence ?? "MEDIUM",
        source: data.source ?? "AI_DETECTED",
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function deleteLegendSymbol(
  organizationId: string,
  id: string,
): Promise<void> {
  await db
    .delete(aiEstimatorLegendSymbols)
    .where(
      and(
        eq(aiEstimatorLegendSymbols.id, id),
        eq(aiEstimatorLegendSymbols.organizationId, organizationId),
      ),
    );
}

/**
 * Task #2623 — Human-in-the-loop review status update for an
 * individual legend symbol (the non-schedule path; schedule rows have
 * their own helpers in `scheduleCounts.ts`). Pipeline guards in
 * `mapReduceDraft` and the schedule-accept flow refuse to count
 * REJECTED symbols.
 */
export async function setLegendSymbolReviewStatus(opts: {
  organizationId: string;
  bidId: string;
  symbolId: string;
  status: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EDITED";
}): Promise<AiEstimatorLegendSymbol | null> {
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch {
    return null;
  }
  const [updated] = await db
    .update(aiEstimatorLegendSymbols)
    .set({ reviewStatus: opts.status, updatedAt: new Date() })
    .where(
      and(
        eq(aiEstimatorLegendSymbols.organizationId, opts.organizationId),
        eq(aiEstimatorLegendSymbols.bidId, opts.bidId),
        eq(aiEstimatorLegendSymbols.id, opts.symbolId),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Task #2623 — Free-form edit of an AI-detected legend row before the
 * estimator confirms it. Symbol code, definition, count, and trade can
 * all be tweaked; the row is stamped EDITED so subsequent re-parses
 * know not to overwrite the human's edit.
 */
export async function editLegendSymbol(opts: {
  organizationId: string;
  bidId: string;
  symbolId: string;
  updates: {
    symbolCode?: string;
    definition?: string;
    trade?: string | null;
    count?: number;
  };
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
  const [updated] = await db
    .update(aiEstimatorLegendSymbols)
    .set({
      symbolCode:
        typeof opts.updates.symbolCode === "string" && opts.updates.symbolCode.length > 0
          ? opts.updates.symbolCode
          : existing.symbolCode,
      definition:
        typeof opts.updates.definition === "string" && opts.updates.definition.length > 0
          ? opts.updates.definition
          : existing.definition,
      trade:
        opts.updates.trade === undefined ? existing.trade : opts.updates.trade,
      count:
        typeof opts.updates.count === "number"
          ? Math.max(0, Math.round(opts.updates.count))
          : existing.count,
      reviewStatus: "EDITED",
      updatedAt: new Date(),
    })
    .where(eq(aiEstimatorLegendSymbols.id, opts.symbolId))
    .returning();
  return updated ?? null;
}
