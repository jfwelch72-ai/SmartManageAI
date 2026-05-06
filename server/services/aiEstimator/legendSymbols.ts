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

import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorLegendSymbols,
  type AiEstimatorLegendSymbol,
  type InsertAiEstimatorLegendSymbol,
} from "@shared/schema";
import { assertBidInOrg, ResourceOwnershipError } from "./access";

export async function listLegendSymbolsForBid(
  organizationId: string,
  bidId: string,
): Promise<AiEstimatorLegendSymbol[]> {
  try {
    await assertBidInOrg(bidId, organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) return [];
    throw err;
  }
  return db
    .select()
    .from(aiEstimatorLegendSymbols)
    .where(
      and(
        eq(aiEstimatorLegendSymbols.organizationId, organizationId),
        eq(aiEstimatorLegendSymbols.bidId, bidId),
      ),
    )
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
