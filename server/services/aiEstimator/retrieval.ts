import crypto from "crypto";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
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
        // Task #2415 — preserve lesson-specific fields on upsert. For
        // non-lesson sources these are simply null on both sides.
        lessonScope: row.lessonScope ?? null,
        lessonStatus: row.lessonStatus ?? null,
        lessonSurface: row.lessonSurface ?? null,
        supersedesRowId: row.supersedesRowId ?? null,
        derivedFromFeedbackIds: row.derivedFromFeedbackIds ?? null,
      },
    })
    .returning({ id: aiEstimatorKnowledgeIndex.id });

  return { id: upserted.id, changed: true, contentHash };
}

/**
 * Task #2396 — Batched variant of `upsertKnowledgeRow` for the nightly
 * ingestion path. Big tenants have tens of thousands of indexable rows;
 * the per-row SELECT + UPDATE/INSERT loop in `upsertKnowledgeRow` makes
 * each ingest minutes-to-hours of round-trips. This helper:
 *
 *   1. Pre-fetches `(id, contentHash)` for every (org, sourceType, sourceId)
 *      tuple in the batch with a single SELECT.
 *   2. Computes the new content hash per row.
 *   3. Skips rows whose hash matches what's already stored — those rows
 *      are returned as `changed: false` so the enrichment pass knows to
 *      leave their existing `enrichedSummary` alone.
 *   4. Issues a single bulk INSERT … ON CONFLICT DO UPDATE for everything
 *      that's new or genuinely changed, in chunks to keep parameter
 *      counts well under Postgres' limit. Updates clear `enrichedSummary`
 *      so the post-ingest enrichment pass repopulates it (matching the
 *      semantics of the per-row variant — see its branch-3 comment).
 *
 * The returned array preserves caller order so ingestion can correlate
 * each result back to its input row's `costCode` for the enrichment cap.
 */
export async function bulkUpsertKnowledgeRows(
  rows: InsertAiEstimatorKnowledgeIndex[],
): Promise<UpsertKnowledgeRowResult[]> {
  if (rows.length === 0) return [];

  // Compute (or carry) a hash per input row up-front so the existence
  // check below can answer "is this a no-op?" without re-walking the row.
  const hashed = rows.map((row) => ({
    row,
    contentHash: row.contentHash ?? computeKnowledgeContentHash(row),
  }));

  // All rows in the batch must share the same organizationId — the
  // ingestion path always feeds one org at a time, and the existence
  // lookup keys on `(organizationId, sourceType, sourceId)`.
  const organizationId = hashed[0].row.organizationId;

  // Pre-fetch existing rows for the batch in chunks, keyed by
  // `${sourceType}:${sourceId}` so caller-order can be reconstructed
  // cheaply. The unique index `ai_estimator_knowledge_uniq_source` makes
  // this lookup index-served.
  const existingByKey = new Map<string, { id: string; contentHash: string | null }>();
  const sourceIds = Array.from(new Set(hashed.map((h) => h.row.sourceId)));
  const LOOKUP_CHUNK = 1000;
  for (let i = 0; i < sourceIds.length; i += LOOKUP_CHUNK) {
    const slice = sourceIds.slice(i, i + LOOKUP_CHUNK);
    const found = await db
      .select({
        id: aiEstimatorKnowledgeIndex.id,
        sourceType: aiEstimatorKnowledgeIndex.sourceType,
        sourceId: aiEstimatorKnowledgeIndex.sourceId,
        contentHash: aiEstimatorKnowledgeIndex.contentHash,
      })
      .from(aiEstimatorKnowledgeIndex)
      .where(
        and(
          eq(aiEstimatorKnowledgeIndex.organizationId, organizationId),
          inArray(aiEstimatorKnowledgeIndex.sourceId, slice),
        ),
      );
    for (const f of found) {
      existingByKey.set(`${f.sourceType}:${f.sourceId}`, {
        id: f.id,
        contentHash: f.contentHash,
      });
    }
  }

  // Decide per-row what to do. Skipped rows return immediately with
  // `changed: false` and the existing id so the enrichment pass can
  // leave them alone. Changed/new rows get queued for the bulk write.
  type Pending = {
    index: number;
    row: InsertAiEstimatorKnowledgeIndex;
    contentHash: string;
    existingId: string | null;
  };
  const results: UpsertKnowledgeRowResult[] = new Array(hashed.length);
  const toWrite: Pending[] = [];
  for (let i = 0; i < hashed.length; i++) {
    const { row, contentHash } = hashed[i];
    const key = `${row.sourceType}:${row.sourceId}`;
    const existing = existingByKey.get(key);
    if (existing && existing.contentHash === contentHash) {
      results[i] = { id: existing.id, changed: false, contentHash };
      continue;
    }
    toWrite.push({
      index: i,
      row,
      contentHash,
      existingId: existing?.id ?? null,
    });
  }

  if (toWrite.length === 0) return results;

  // Bulk INSERT … ON CONFLICT DO UPDATE in chunks. Postgres caps
  // parameters at 65 535 — knowledge rows have ~17 columns so 1000 rows
  // per batch (~17 000 params) leaves plenty of headroom.
  const WRITE_CHUNK = 500;
  for (let i = 0; i < toWrite.length; i += WRITE_CHUNK) {
    const slice = toWrite.slice(i, i + WRITE_CHUNK);
    const values = slice.map(({ row, contentHash }) => ({
      ...row,
      contentHash,
    }));
    const upserted = await db
      .insert(aiEstimatorKnowledgeIndex)
      .values(values)
      .onConflictDoUpdate({
        target: [
          aiEstimatorKnowledgeIndex.organizationId,
          aiEstimatorKnowledgeIndex.sourceType,
          aiEstimatorKnowledgeIndex.sourceId,
        ],
        set: {
          // Pull updated values from the EXCLUDED pseudo-row that
          // Postgres exposes during ON CONFLICT — this lets one bulk
          // statement update each conflicting row to its own values
          // rather than to a single shared scalar.
          title: sql`excluded.title`,
          contentSnippet: sql`excluded.content_snippet`,
          tags: sql`excluded.tags`,
          numericFacets: sql`excluded.numeric_facets`,
          contentHash: sql`excluded.content_hash`,
          bidId: sql`excluded.bid_id`,
          projectId: sql`excluded.project_id`,
          costCode: sql`excluded.cost_code`,
          tradeType: sql`excluded.trade_type`,
          indexedAt: new Date(),
          // Drop stale Claude narrative — the post-ingest enrichment
          // pass will repopulate it for changed rows. Mirrors the
          // per-row variant's branch-3 contract so retrieval keeps
          // falling back to `contentSnippet` until enrichment lands.
          enrichedSummary: null,
          enrichedAt: null,
          // Lesson fields are only ever set for sourceType='qualitative_lesson'.
          // Ingestion never writes lesson rows, but we still mirror the
          // per-row helper's behaviour so a future caller can use this
          // bulk helper for lessons too.
          lessonScope: sql`excluded.lesson_scope`,
          lessonStatus: sql`excluded.lesson_status`,
          lessonSurface: sql`excluded.lesson_surface`,
          supersedesRowId: sql`excluded.supersedes_row_id`,
          derivedFromFeedbackIds: sql`excluded.derived_from_feedback_ids`,
        },
      })
      .returning({
        id: aiEstimatorKnowledgeIndex.id,
        sourceType: aiEstimatorKnowledgeIndex.sourceType,
        sourceId: aiEstimatorKnowledgeIndex.sourceId,
      });

    const idByKey = new Map(
      upserted.map((r) => [`${r.sourceType}:${r.sourceId}`, r.id] as const),
    );
    for (const pending of slice) {
      const id =
        idByKey.get(`${pending.row.sourceType}:${pending.row.sourceId}`) ??
        pending.existingId;
      if (!id) {
        // Should never happen — RETURNING gives one row per inserted/
        // updated tuple. Keep the result well-typed so the caller's
        // `recordChange` doesn't crash.
        throw new Error(
          `bulkUpsertKnowledgeRows: missing returned id for ${pending.row.sourceType}:${pending.row.sourceId}`,
        );
      }
      results[pending.index] = {
        id,
        changed: true,
        contentHash: pending.contentHash,
      };
    }
  }

  return results;
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
 *
 * Task #2415 — qualitative-lesson rows are excluded here so retrieval
 * stays focused on historical bids/estimates/takeoffs. Lessons are pulled
 * separately via `retrieveLessons` and injected under their own clearly
 * labelled prompt section so the model treats them as guidance rather
 * than mixed in with historical evidence.
 */
export async function retrieveContext(
  q: RetrievalQuery,
): Promise<AiEstimatorKnowledgeIndex[]> {
  const conditions = [
    eq(aiEstimatorKnowledgeIndex.organizationId, q.organizationId),
    ne(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
  ];
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

// =====================================================================
// Task #2415 — qualitative lesson retrieval.
// =====================================================================

export interface LessonRetrievalQuery {
  organizationId: string;
  costCode?: string | null;
  tradeType?: string | null;
  surface?: string | null;
  limit?: number;
}

/**
 * Pull the most relevant active qualitative lessons for the current call
 * site. We OR-match on (costCode | tradeType | surface) and always
 * include `lessonScope = 'global'` rows so org-wide guidance is always
 * present. Stale and deleted rows are excluded.
 */
export async function retrieveLessons(
  q: LessonRetrievalQuery,
): Promise<AiEstimatorKnowledgeIndex[]> {
  const orConds: any[] = [eq(aiEstimatorKnowledgeIndex.lessonScope, "global")];
  if (q.costCode) {
    orConds.push(
      and(
        eq(aiEstimatorKnowledgeIndex.lessonScope, "cost_code"),
        eq(aiEstimatorKnowledgeIndex.costCode, q.costCode),
      ),
    );
  }
  if (q.tradeType) {
    orConds.push(
      and(
        eq(aiEstimatorKnowledgeIndex.lessonScope, "trade"),
        eq(aiEstimatorKnowledgeIndex.tradeType, q.tradeType),
      ),
    );
  }
  if (q.surface) {
    orConds.push(
      and(
        eq(aiEstimatorKnowledgeIndex.lessonScope, "surface"),
        eq(aiEstimatorKnowledgeIndex.lessonSurface, q.surface),
      ),
    );
  }

  const matchScope = orConds.length === 1 ? orConds[0] : or(...orConds);
  const conditions = [
    eq(aiEstimatorKnowledgeIndex.organizationId, q.organizationId),
    eq(aiEstimatorKnowledgeIndex.sourceType, "qualitative_lesson"),
    eq(aiEstimatorKnowledgeIndex.lessonStatus, "active"),
  ];
  if (matchScope) conditions.push(matchScope);

  return db
    .select()
    .from(aiEstimatorKnowledgeIndex)
    .where(and(...conditions))
    .orderBy(desc(aiEstimatorKnowledgeIndex.indexedAt))
    .limit(Math.min(q.limit ?? 10, 25));
}

/** Render an array of lesson rows into a prompt section the model can read. */
export function formatLessonsForPrompt(
  lessons: AiEstimatorKnowledgeIndex[],
): string {
  if (lessons.length === 0) return "";
  const lines = lessons.map((l) => {
    const tag = l.costCode
      ? `[cost_code ${l.costCode}]`
      : l.tradeType
        ? `[trade ${l.tradeType}]`
        : l.lessonSurface
          ? `[surface ${l.lessonSurface}]`
          : "[org-wide]";
    return `- ${tag} ${l.contentSnippet}`;
  });
  return `Lessons from your team's prior edits (treat as soft guidance, not hard rules):\n${lines.join("\n")}`;
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
