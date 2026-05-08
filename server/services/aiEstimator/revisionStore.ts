// Task #2625 — Revision storage helpers for the auto-takeoff diff view.
//
// `recordTakeoffRevision` is invoked by the AI estimator job handler at
// the end of every successful map-reduce drafter run so the resulting
// measurement set becomes an immutable, citable revision the estimator
// can later diff against.

import { createHash } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  aiTakeoffRevisions,
  projectPlans,
  takeoffSheets,
  type AiTakeoffRevision,
} from "@shared/schema";
import type { MapReduceMeasurement, MapReduceDraftResult } from "./mapReduceDraft";
import type { PlanSetSnapshot } from "./revisionDiff";
import { assertBidInOrg, ResourceOwnershipError } from "./access";
import { logWarn, logInfo } from "../../utils/logger";

export const TAKEOFF_DRAFT_PROMPT_VERSION = "mr-v1";

/**
 * Snapshot the current plan-set for a bid (plan documents + indexed
 * sheets) so a revision row carries enough context to a) detect when
 * the underlying plans changed between two revisions and b) flag any
 * diff entry whose citations overlap a sheet that was added/removed.
 */
export async function snapshotPlanSetForBid(bidId: string): Promise<PlanSetSnapshot> {
  const sheets = await db
    .select({
      id: takeoffSheets.id,
      planId: takeoffSheets.planId,
      sheetIndex: takeoffSheets.sheetIndex,
      sheetNumber: takeoffSheets.sheetNumber,
      sheetName: takeoffSheets.sheetName,
      discipline: takeoffSheets.discipline,
      revisionLabel: takeoffSheets.revisionLabel,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, bidId));

  const planIds = Array.from(new Set(sheets.map((s) => s.planId).filter((id): id is string => !!id)));
  const docs = planIds.length > 0
    ? await db
        .select({
          id: projectPlans.id,
          fileName: projectPlans.fileName,
          updatedAt: projectPlans.updatedAt,
        })
        .from(projectPlans)
        .where(inArray(projectPlans.id, planIds))
    : [];

  const planDocuments = docs.map((d) => ({
    id: d.id,
    fileName: d.fileName ?? "",
    updatedAt: d.updatedAt ? d.updatedAt.toISOString() : undefined,
  }));

  const snapshot: PlanSetSnapshot = {
    planDocuments,
    sheets: sheets.map((s) => ({
      id: s.id,
      planId: s.planId,
      sheetIndex: s.sheetIndex,
      sheetNumber: s.sheetNumber,
      sheetName: s.sheetName,
      discipline: s.discipline,
      revisionLabel: s.revisionLabel,
    })),
  };
  snapshot.hash = hashPlanSet(snapshot);
  return snapshot;
}

function hashPlanSet(snapshot: PlanSetSnapshot): string {
  const docPart = (snapshot.planDocuments ?? [])
    .map((d) => `${d.id}:${d.updatedAt ?? ""}`)
    .sort()
    .join("|");
  const sheetPart = (snapshot.sheets ?? [])
    .map((s) => `${s.id}:${s.revisionLabel ?? ""}`)
    .sort()
    .join("|");
  return createHash("sha1").update(`${docPart}#${sheetPart}`).digest("hex");
}

export interface RecordRevisionInput {
  organizationId: string;
  bidId: string;
  userId?: string | null;
  result: MapReduceDraftResult;
  modelId?: string | null;
  provider?: string | null;
  disciplines?: string[] | null;
  mode?: "map_reduce" | "single";
}

export async function recordTakeoffRevision(input: RecordRevisionInput): Promise<AiTakeoffRevision | null> {
  try {
    // Defense-in-depth: only record for bids that belong to this org.
    try {
      await assertBidInOrg(input.bidId, input.organizationId);
    } catch (err) {
      if (err instanceof ResourceOwnershipError) {
        logWarn("[recordTakeoffRevision] bid not in org; skip", {
          bidId: input.bidId,
          organizationId: input.organizationId,
        });
        return null;
      }
      throw err;
    }
    const planSetVersion = await snapshotPlanSetForBid(input.bidId);
    const [row] = await db
      .insert(aiTakeoffRevisions)
      .values({
        organizationId: input.organizationId,
        bidId: input.bidId,
        createdById: input.userId ?? null,
        mode: input.mode ?? "map_reduce",
        planSetVersion: planSetVersion as unknown as object,
        modelId: input.modelId ?? null,
        promptVersion: TAKEOFF_DRAFT_PROMPT_VERSION,
        provider: input.provider ?? null,
        disciplines: (input.disciplines && input.disciplines.length > 0
          ? input.disciplines
          : null) as unknown as object | null,
        measurements: input.result.measurements as unknown as object,
        notes: input.result.notes,
        confidence: Number.isFinite(input.result.confidence) ? Math.round(input.result.confidence) : null,
        disciplineCoverage: input.result.disciplineCoverage as unknown as object,
        llmCallCount: Number.isFinite(input.result.llmCallCount) ? input.result.llmCallCount : null,
        partial: !!input.result.partial,
      })
      .returning();
    if (row) {
      logInfo("[recordTakeoffRevision] persisted revision", {
        revisionId: row.id,
        bidId: input.bidId,
        measurementCount: input.result.measurements.length,
        planSetHash: planSetVersion.hash,
      });
    }
    return row ?? null;
  } catch (err) {
    // Never let revision recording failures take down a successful draft
    // run; the diff view degrades gracefully when no revisions exist.
    logWarn("[recordTakeoffRevision] failed", {
      bidId: input.bidId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface RevisionListItem {
  id: string;
  createdAt: string;
  createdById: string | null;
  mode: string;
  modelId: string | null;
  promptVersion: string | null;
  provider: string | null;
  confidence: number | null;
  partial: boolean;
  measurementCount: number;
  planSetHash: string | null;
  disciplines: string[] | null;
  notes: string | null;
  llmCallCount: number | null;
}

export async function listRevisionsForBid(opts: {
  organizationId: string;
  bidId: string;
  limit?: number;
}): Promise<RevisionListItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await db
    .select()
    .from(aiTakeoffRevisions)
    .where(
      and(
        eq(aiTakeoffRevisions.organizationId, opts.organizationId),
        eq(aiTakeoffRevisions.bidId, opts.bidId),
      ),
    )
    .orderBy(desc(aiTakeoffRevisions.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const measurements = Array.isArray(r.measurements) ? (r.measurements as MapReduceMeasurement[]) : [];
    const planSet = (r.planSetVersion ?? null) as PlanSetSnapshot | null;
    const disciplines = Array.isArray(r.disciplines) ? (r.disciplines as string[]) : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      createdById: r.createdById,
      mode: r.mode,
      modelId: r.modelId,
      promptVersion: r.promptVersion,
      provider: r.provider,
      confidence: r.confidence,
      partial: r.partial,
      measurementCount: measurements.length,
      planSetHash: planSet?.hash ?? null,
      disciplines,
      notes: r.notes,
      llmCallCount: r.llmCallCount,
    };
  });
}

export async function getRevisionById(opts: {
  organizationId: string;
  revisionId: string;
}): Promise<AiTakeoffRevision | null> {
  const [row] = await db
    .select()
    .from(aiTakeoffRevisions)
    .where(
      and(
        eq(aiTakeoffRevisions.id, opts.revisionId),
        eq(aiTakeoffRevisions.organizationId, opts.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}
