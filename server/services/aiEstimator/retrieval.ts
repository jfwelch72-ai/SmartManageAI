import crypto from "crypto";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorKnowledgeIndex,
  type AiEstimatorKnowledgeIndex,
  type InsertAiEstimatorKnowledgeIndex,
} from "@shared/schema";

/**
 * Result of an `upsertKnowledgeRow` call. Task #2414's enrichment pass
 * uses `changed` to decide whether to spend a Claude call on this row:
 * if the row's content hash matches what's already stored, the existing
 * `enrichedSummary` is still valid and we skip the LLM call entirely.
 */
export interface UpsertKnowledgeRowResult {
  id: string;
  /** True when the row was inserted, or its content hash differs from
   *  what was previously stored (so the prior enriched summary is stale). */
  changed: boolean;
  /** The contentHash actually stored on the row after this upsert. */
  contentHash: string;
}

/**
 * Compute a deterministic SHA-256 hash over the fields that materially
 * change a row's meaning. Excludes book-keeping (`indexedAt`, ids) and
 * the LLM-written `enrichedSummary` itself — the hash represents the
 * mechanical-snippet content, not the enrichment that derives from it.
 */
function computeKnowledgeContentHash(row: InsertAiEstimatorKnowledgeIndex): string {
  const payload = JSON.stringify({
    title: row.title,
    contentSnippet: row.contentSnippet,
    costCode: row.costCode ?? null,
    tradeType: row.tradeType ?? null,
    bidId: row.bidId ?? null,
    projectId: row.projectId ?? null,
    tags: Array.isArray(row.tags) ? [...row.tags].sort() : null,
    numericFacets: row.numericFacets ?? null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function upsertKnowledgeRow(
  row: InsertAiEstimatorKnowledgeIndex,
): Promise<UpsertKnowledgeRowResult> {
  // Caller may pass a pre-computed hash (e.g. webResearch); fall back to
  // computing one from the row content so the enrichment pass can detect
  // changes deterministically.
  const contentHash = row.contentHash ?? computeKnowledgeContentHash(row);

  // Read the existing row's hash up-front so we can decide whether this
  // call is a true content change or just a re-index of identical data.
  // Three branches:
  //   1. No existing row  → INSERT (no enrichment yet, nothing to clear).
  //   2. Existing + hash matches → no-op write. The mechanical fields
  //      already match what we'd write; touching indexedAt would defeat
  //      the "cheap rerun" intent and waste an LLM call later.
  //   3. Existing + hash differs → UPDATE mechanical fields AND clear
  //      `enrichedSummary` / `enrichedAt`. The prior Claude narrative
  //      describes the OLD content; if the upcoming enrichment call
  //      fails (governance block, provider down) we MUST fall back to
  //      the new mechanical snippet rather than the stale summary,
  //      which is what retrieval expects (`enrichedSummary ?? snippet`).
  const [existing] = await db
    .select({
      id: aiEstimatorKnowledgeIndex.id,
      contentHash: aiEstimatorKnowledgeIndex.contentHash,
    })
    .from(aiEstimatorKnowledgeIndex)
    .where(
      and(
        eq(aiEstimatorKnowledgeIndex.organizationId, row.organizationId),
        eq(aiEstimatorKnowledgeIndex.sourceType, row.sourceType),
        eq(aiEstimatorKnowledgeIndex.sourceId, row.sourceId),
      ),
    )
    .limit(1);

  if (existing && existing.contentHash === contentHash) {
    // Branch 2 — content unchanged. Skip the write entirely so a
    // cron-driven re-ingest over an idle org is effectively free.
    return { id: existing.id, changed: false, contentHash };
  }

  if (existing) {
    // Branch 3 — content changed. Clear stale enrichment alongside the
    // mechanical update; the post-ingestion pass will repopulate it.
    await db
      .update(aiEstimatorKnowledgeIndex)
      .set({
        title: row.title,
        contentSnippet: row.contentSnippet,
        tags: row.tags ?? null,
        numericFacets: row.numericFacets ?? null,
        contentHash,
        bidId: row.bidId ?? null,
        projectId: row.projectId ?? null,
        costCode: row.costCode ?? null,
        tradeType: row.tradeType ?? null,
        indexedAt: new Date(),
        enrichedSummary: null,
        enrichedAt: null,
      })
      .where(eq(aiEstimatorKnowledgeIndex.id, existing.id));
    return { id: existing.id, changed: true, contentHash };
  }

  // Branch 1 — INSERT. We still go through onConflictDoUpdate as a
  // belt-and-suspenders against a concurrent ingestion racing the
  // SELECT above (rare; ingest is normally sequential per org) — and
  // in that race we apply the same "clear stale enrichment" semantics
  // as branch 3 so the fallback contract still holds.
  const [upserted] = await db
    .insert(aiEstimatorKnowledgeIndex)
    .values({ ...row, contentHash })
    .onConflictDoUpdate({
      target: [
        aiEstimatorKnowledgeIndex.organizationId,
        aiEstimatorKnowledgeIndex.sourceType,
        aiEstimatorKnowledgeIndex.sourceId,
      ],
      set: {
        title: row.title,
        contentSnippet: row.contentSnippet,
        tags: row.tags ?? null,
        numericFacets: row.numericFacets ?? null,
        contentHash,
        bidId: row.bidId ?? null,
        projectId: row.projectId ?? null,
        costCode: row.costCode ?? null,
        tradeType: row.tradeType ?? null,
        indexedAt: new Date(),
        enrichedSummary: null,
        enrichedAt: null,
      },
    })
    .returning({ id: aiEstimatorKnowledgeIndex.id });

  return { id: upserted.id, changed: true, contentHash };
}

/**
 * Persist a Claude-written narrative summary for a knowledge row. Called
 * by the post-ingestion enrichment pass (Task #2414).
 */
export async function setKnowledgeRowEnrichment(
  rowId: string,
  enrichedSummary: string,
): Promise<void> {
  await db
    .update(aiEstimatorKnowledgeIndex)
    .set({ enrichedSummary, enrichedAt: new Date() })
    .where(eq(aiEstimatorKnowledgeIndex.id, rowId));
}

export interface RetrievalQuery {
  organizationId: string;
  query?: string;
  costCode?: string | null;
  bidId?: string | null;
  projectId?: string | null;
  limit?: number;
}

/**
 * Keyword retrieval over the knowledge index. We keep this simple and
 * predictable: filter by org + optional context (bid/project/cost code),
 * then ILIKE-rank rows whose title/content snippet/enriched summary
 * contains query terms. Vector search is intentionally deferred — the
 * data model here keeps the door open without requiring a vector DB.
 */
export async function retrieveContext(
  q: RetrievalQuery,
): Promise<AiEstimatorKnowledgeIndex[]> {
  const conditions = [eq(aiEstimatorKnowledgeIndex.organizationId, q.organizationId)];
  if (q.bidId) conditions.push(eq(aiEstimatorKnowledgeIndex.bidId, q.bidId));
  if (q.projectId) conditions.push(eq(aiEstimatorKnowledgeIndex.projectId, q.projectId));
  if (q.costCode) conditions.push(eq(aiEstimatorKnowledgeIndex.costCode, q.costCode));
  if (q.query && q.query.trim()) {
    const pat = `%${q.query.trim()}%`;
    const titleOrSnippet = or(
      ilike(aiEstimatorKnowledgeIndex.title, pat),
      ilike(aiEstimatorKnowledgeIndex.contentSnippet, pat),
      ilike(aiEstimatorKnowledgeIndex.enrichedSummary, pat),
    );
    if (titleOrSnippet) conditions.push(titleOrSnippet);
  }
  return db
    .select()
    .from(aiEstimatorKnowledgeIndex)
    .where(and(...conditions))
    .orderBy(desc(aiEstimatorKnowledgeIndex.indexedAt))
    .limit(Math.min(q.limit ?? 10, 50));
}

/**
 * The text the chat / draft-estimate prompts should show as the "what
 * happened on this row" body. Task #2414 prefers the Claude-written
 * narrative when present and falls back to the mechanical snippet so
 * orgs without AI_PROVIDER_TAKEOFF (and rows whose enrichment hasn't run
 * yet, or errored) keep behaving exactly as they did pre-2414.
 */
export function knowledgeRowBody(row: AiEstimatorKnowledgeIndex): string {
  const enriched = row.enrichedSummary?.trim();
  if (enriched) return enriched;
  return row.contentSnippet;
}

export function citationsFromRows(
  rows: AiEstimatorKnowledgeIndex[],
): Array<{
  type: "org";
  sourceType: string;
  sourceId: string;
  title: string;
  bidId: string | null;
  projectId: string | null;
}> {
  return rows.map((r) => ({
    type: "org",
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    title: r.title,
    bidId: r.bidId,
    projectId: r.projectId,
  }));
}
