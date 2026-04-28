import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorKnowledgeIndex,
  type AiEstimatorKnowledgeIndex,
  type InsertAiEstimatorKnowledgeIndex,
} from "@shared/schema";

export async function upsertKnowledgeRow(
  row: InsertAiEstimatorKnowledgeIndex,
): Promise<void> {
  await db
    .insert(aiEstimatorKnowledgeIndex)
    .values(row)
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
        contentHash: row.contentHash ?? null,
        bidId: row.bidId ?? null,
        projectId: row.projectId ?? null,
        costCode: row.costCode ?? null,
        tradeType: row.tradeType ?? null,
        indexedAt: new Date(),
      },
    });
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
 * then ILIKE-rank rows whose title/content snippet contains query terms.
 * Vector search is intentionally deferred — the data model here keeps
 * the door open without requiring a vector DB.
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
