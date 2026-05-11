import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorIngestRuns,
  aiEstimatorKnowledgeIndex,
  bids,
  estimates,
  estimateLineItems,
  historicalCosts,
  standaloneTakeoffs,
  takeoffMeasurements,
  takeoffSheets,
  type AiEstimatorIngestRun,
  type AiEstimatorKnowledgeIndex,
  type AiEstimatorLearnedRate,
  type InsertAiEstimatorKnowledgeIndex,
} from "@shared/schema";
import {
  bulkUpsertKnowledgeRows,
  setKnowledgeRowEnrichment,
  type UpsertKnowledgeRowResult,
} from "./retrieval";
import {
  bulkRecordRateSamples,
  listLearnedRatesForOrg,
  type RateMetric,
} from "./learnedRates";
import { enrichKnowledgeRow } from "./enrichment";
import { isFeatureEnabled } from "../featureFlagService";
import { logError, logInfo, logWarn } from "../../utils/logger";

interface IngestCounters {
  bidsIngested: number;
  estimatesIngested: number;
  lineItemsIngested: number;
  takeoffsIngested: number;
  costPostingsIngested: number;
  ratesUpdated: number;
  // Task #2414 — knowledge rows for which the post-ingestion enrichment
  // pass produced a Claude-written narrative. `rowsEnrichmentSkipped`
  // tracks rows we deliberately skipped (cap reached, content unchanged,
  // org without AI_PROVIDER_TAKEOFF) and `rowsEnrichmentFailed` tracks
  // governance-blocked / provider-error rows. The two skip/fail counters
  // are not persisted (the schema only stores the success counter so the
  // dashboards stay simple) but they are surfaced in the success log so
  // ops can spot a sudden spike in failures.
  rowsEnriched: number;
  rowsEnrichmentSkipped: number;
  rowsEnrichmentFailed: number;
}

export async function startIngestRun(opts: {
  organizationId: string;
  triggeredByUserId: string | null;
  triggerType?: "MANUAL" | "SCHEDULED" | "EVENT";
}): Promise<AiEstimatorIngestRun> {
  const [run] = await db
    .insert(aiEstimatorIngestRuns)
    .values({
      organizationId: opts.organizationId,
      triggeredByUserId: opts.triggeredByUserId,
      triggerType: opts.triggerType ?? "MANUAL",
      status: "RUNNING",
    })
    .returning();
  return run;
}

export async function completeIngestRun(
  runId: string,
  status: "SUCCEEDED" | "FAILED",
  counters: IngestCounters,
  errorMessage?: string,
): Promise<void> {
  await db
    .update(aiEstimatorIngestRuns)
    .set({
      status,
      bidsIngested: counters.bidsIngested,
      estimatesIngested: counters.estimatesIngested,
      lineItemsIngested: counters.lineItemsIngested,
      takeoffsIngested: counters.takeoffsIngested,
      costPostingsIngested: counters.costPostingsIngested,
      ratesUpdated: counters.ratesUpdated,
      rowsEnriched: counters.rowsEnriched,
      errorMessage: errorMessage ?? null,
      completedAt: new Date(),
    })
    .where(eq(aiEstimatorIngestRuns.id, runId));
}

export async function listIngestRuns(
  organizationId: string,
  limit: number = 25,
): Promise<AiEstimatorIngestRun[]> {
  return db
    .select()
    .from(aiEstimatorIngestRuns)
    .where(eq(aiEstimatorIngestRuns.organizationId, organizationId))
    .orderBy(sql`${aiEstimatorIngestRuns.startedAt} desc`)
    .limit(limit);
}

/**
 * How many rows the enrichment pass will touch in a single run, before
 * it stops and lets the next ingest pick up the rest. Defaults to 200,
 * overridable via env so ops can throttle without a code change.
 */
function enrichmentMaxPerRun(): number {
  const raw = process.env.AI_ESTIMATOR_ENRICHMENT_MAX_PER_RUN;
  if (!raw) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.floor(n);
}

/**
 * Sequential rate limiting between enrichment calls. We don't need the
 * sophistication of a token bucket here: the calls are sequential and a
 * tiny randomized sleep is enough to keep us well under any per-minute
 * provider cap and to avoid synchronized bursts when multiple orgs
 * ingest on the cron at the same minute.
 */
async function enrichmentJitter(): Promise<void> {
  const ms = 50 + Math.floor(Math.random() * 50); // 50–99ms
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk the org's bids, estimates, takeoffs, and cost ledger and rebuild
 * the per-org learned-rates store + retrieval index. Designed to be
 * idempotent: re-running over the same data produces the same final
 * state. Hot path is bounded by the number of estimate line items.
 */
export async function runIngestion(
  organizationId: string,
  triggeredByUserId: string | null,
  triggerType: "MANUAL" | "SCHEDULED" | "EVENT" = "MANUAL",
): Promise<AiEstimatorIngestRun> {
  const run = await startIngestRun({ organizationId, triggeredByUserId, triggerType });
  const counters: IngestCounters = {
    bidsIngested: 0,
    estimatesIngested: 0,
    lineItemsIngested: 0,
    takeoffsIngested: 0,
    costPostingsIngested: 0,
    ratesUpdated: 0,
    rowsEnriched: 0,
    rowsEnrichmentSkipped: 0,
    rowsEnrichmentFailed: 0,
  };
  // Task #2414 — collect knowledge-row ids that were inserted or whose
  // content hash changed during this run. Rows whose content matched
  // their existing hash are skipped: their stored `enrichedSummary` is
  // still valid, so we'd be paying for an LLM call to produce identical
  // text. The (id, costCode) shape lets the post-loop enrichment fetch
  // the matching rate slice with a single per-code lookup.
  const changedRows: Array<{ id: string; costCode: string | null }> = [];
  const recordChanges = (
    results: UpsertKnowledgeRowResult[],
    codes: Array<string | null>,
  ): void => {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.changed) changedRows.push({ id: r.id, costCode: codes[i] ?? null });
    }
  };
  try {
    // Task #2396 — Incremental window. We pull the most recent
    // SUCCEEDED ingest for this org and only re-walk source rows that
    // were created/updated since its `completedAt`. The first ever run
    // (or a recovery after a long failure streak) finds no prior
    // success and falls back to a full scan, so initial-population
    // semantics are unchanged.
    const [lastSuccess] = await db
      .select({ completedAt: aiEstimatorIngestRuns.completedAt })
      .from(aiEstimatorIngestRuns)
      .where(and(
        eq(aiEstimatorIngestRuns.organizationId, organizationId),
        eq(aiEstimatorIngestRuns.status, "SUCCEEDED"),
        sql`${aiEstimatorIngestRuns.completedAt} IS NOT NULL`,
      ))
      .orderBy(sql`${aiEstimatorIngestRuns.completedAt} desc`)
      .limit(1);
    // Re-walk a small overlap window (5 minutes) before the prior
    // completion so rows whose updated_at landed mid-flight aren't
    // missed because of clock skew or the prior run's read snapshot.
    const since = lastSuccess?.completedAt
      ? new Date(lastSuccess.completedAt.getTime() - 5 * 60 * 1000)
      : null;

    // 1. Bids — index by name + description for retrieval. We always
    // need the full set of (id) for the org so estimates/line items
    // below can be filtered to this org, but we only re-ingest the
    // bids whose content actually changed since `since`.
    const orgBidIdRows = await db
      .select({ id: bids.id })
      .from(bids)
      .where(eq(bids.gcOrganizationId, organizationId));
    const allBidIds = orgBidIdRows.map((r) => r.id);

    const changedBids = await db
      .select()
      .from(bids)
      .where(
        since
          ? and(
              eq(bids.gcOrganizationId, organizationId),
              gte(bids.updatedAt, since),
            )
          : eq(bids.gcOrganizationId, organizationId),
      );
    counters.bidsIngested = changedBids.length;
    if (changedBids.length > 0) {
      const bidRows: InsertAiEstimatorKnowledgeIndex[] = changedBids.map((b) => ({
        organizationId,
        sourceType: "bid",
        sourceId: b.id,
        bidId: b.id,
        projectId: null,
        costCode: null,
        tradeType: null,
        title: `Bid: ${b.name} (${b.code})`,
        contentSnippet: [
          b.name,
          b.clientName ? `Client: ${b.clientName}` : null,
          b.locationAddress
            ? `Location: ${[b.locationAddress, b.city, b.state].filter(Boolean).join(", ")}`
            : null,
          b.description ?? null,
          b.bidAmount ? `Bid amount: $${b.bidAmount}` : null,
          b.status ? `Status: ${b.status}` : null,
        ].filter(Boolean).join("\n"),
        tags: [b.status, b.state].filter((v): v is string => !!v),
        numericFacets: b.bidAmount ? { bidAmount: Number(b.bidAmount) } : null,
        contentHash: null,
      }));
      const upserts = await bulkUpsertKnowledgeRows(bidRows);
      recordChanges(upserts, bidRows.map(() => null));
    }

    // 2. Estimates + line items — drive learned-rates and retrieval.
    // Estimates are scoped via `bidId IN (org bids)`. Only estimates
    // updated since `since` get re-ingested; line items are pulled in a
    // single query filtered by org-scoped estimate ids + `updated_at`,
    // avoiding the per-estimate SELECT loop the previous version used.
    const changedEstimates = allBidIds.length
      ? await db
          .select()
          .from(estimates)
          .where(
            since
              ? and(
                  inArray(estimates.bidId, allBidIds),
                  gte(estimates.updatedAt, since),
                )
              : inArray(estimates.bidId, allBidIds),
          )
      : [];
    counters.estimatesIngested = changedEstimates.length;

    const rateUpdates: Array<{
      costCode: string;
      metric: RateMetric;
      unit: string;
      value: number;
      sourceType: "estimate_line_item" | "historical_actual";
      sourceRowId?: string;
      projectId?: string | null;
      bidId?: string | null;
    }> = [];

    if (changedEstimates.length > 0) {
      const estRows: InsertAiEstimatorKnowledgeIndex[] = changedEstimates.map((est) => ({
        organizationId,
        sourceType: "estimate",
        sourceId: est.id,
        bidId: est.bidId ?? null,
        projectId: null,
        costCode: null,
        tradeType: null,
        title: `Estimate ${est.id.slice(0, 8)}`,
        contentSnippet: `Estimate for bid ${est.bidId ?? "n/a"}: base bid ${est.baseBidAmount ?? "0"}`,
        tags: [],
        numericFacets: est.baseBidAmount ? { baseBidAmount: Number(est.baseBidAmount) } : null,
        contentHash: null,
      }));
      const estUpserts = await bulkUpsertKnowledgeRows(estRows);
      recordChanges(estUpserts, estRows.map(() => null));
    }

    // For line items we need the full org-estimate set so we can map
    // each line item back to its bidId for sample provenance, even when
    // only a subset of estimates is "changed" this run.
    const allEstimateIds: string[] = [];
    const estimateBidByEstimateId = new Map<string, string | null>();
    if (allBidIds.length) {
      const allEsts = await db
        .select({ id: estimates.id, bidId: estimates.bidId })
        .from(estimates)
        .where(inArray(estimates.bidId, allBidIds));
      for (const e of allEsts) {
        allEstimateIds.push(e.id);
        estimateBidByEstimateId.set(e.id, e.bidId ?? null);
      }
    }

    // Pull only line items that changed in the window. For very large
    // orgs we chunk the IN-list to keep each query reasonable; the
    // database's `estimate_line_items_estimate_idx` covers the join.
    const ESTIMATE_ID_CHUNK = 500;
    const changedLineItems: typeof estimateLineItems.$inferSelect[] = [];
    for (let i = 0; i < allEstimateIds.length; i += ESTIMATE_ID_CHUNK) {
      const slice = allEstimateIds.slice(i, i + ESTIMATE_ID_CHUNK);
      const rows = await db
        .select()
        .from(estimateLineItems)
        .where(
          since
            ? and(
                inArray(estimateLineItems.estimateId, slice),
                gte(estimateLineItems.updatedAt, since),
              )
            : inArray(estimateLineItems.estimateId, slice),
        );
      for (const r of rows) changedLineItems.push(r);
    }

    if (changedLineItems.length > 0) {
      const liRows: InsertAiEstimatorKnowledgeIndex[] = [];
      const liCodes: Array<string | null> = [];
      for (const li of changedLineItems) {
        counters.lineItemsIngested++;
        const qty = Number(li.quantity ?? 0);
        const totalCost = Number(li.totalCost ?? 0);
        const labor = Number(li.laborHours ?? 0);
        const unitCost = qty > 0 ? totalCost / qty : 0;
        const laborPerUnit = qty > 0 ? labor / qty : 0;
        const code = li.workTypeCode ?? null;
        const bidId = estimateBidByEstimateId.get(li.estimateId) ?? null;
        if (code && unitCost > 0) {
          rateUpdates.push({
            costCode: code,
            metric: "unit_cost",
            unit: li.unit,
            value: unitCost,
            sourceType: "estimate_line_item",
            sourceRowId: li.id,
            projectId: null,
            bidId,
          });
        }
        if (code && laborPerUnit > 0) {
          rateUpdates.push({
            costCode: code,
            metric: "labor_hours_per_unit",
            unit: li.unit,
            value: laborPerUnit,
            sourceType: "estimate_line_item",
            sourceRowId: li.id,
            projectId: null,
            bidId,
          });
        }
        liRows.push({
          organizationId,
          sourceType: "estimate_line_item",
          sourceId: li.id,
          bidId,
          projectId: null,
          costCode: code,
          tradeType: null,
          title: `Line item: ${li.description.slice(0, 80)}`,
          contentSnippet: `Qty ${li.quantity} ${li.unit} • $${li.totalCost} total • code ${code ?? "—"}`,
          tags: code ? [code] : [],
          numericFacets: { qty, totalCost, unitCost, laborHours: labor },
          contentHash: null,
        });
        liCodes.push(code);
      }
      // Chunked bulk upsert keeps a single statement size sane even on
      // a five-figure delta — the helper itself further chunks under
      // the hood at 500 rows / statement.
      const liUpserts = await bulkUpsertKnowledgeRows(liRows);
      recordChanges(liUpserts, liCodes);
    }

    // 3. Takeoff measurements — light retrieval index. Only re-walk
    // sheets whose `updated_at` is newer than the window; for each
    // such sheet we still cap to 200 measurements per sheet (matches
    // prior behaviour). Bulk upsert across all changed sheets in one
    // go so we pay one round trip rather than one per measurement.
    const orgTakeoffs = allBidIds.length
      ? await db
          .select()
          .from(takeoffSheets)
          .where(
            since
              ? and(
                  inArray(takeoffSheets.bidId, allBidIds),
                  gte(takeoffSheets.updatedAt, since),
                )
              : inArray(takeoffSheets.bidId, allBidIds),
          )
      : [];
    if (orgTakeoffs.length > 0) {
      const measRows: InsertAiEstimatorKnowledgeIndex[] = [];
      for (const sheet of orgTakeoffs) {
        const measurements = await db
          .select()
          .from(takeoffMeasurements)
          .where(eq(takeoffMeasurements.sheetId, sheet.id));
        counters.takeoffsIngested += measurements.length;
        for (const m of measurements.slice(0, 200)) {
          const v =
            m.computedAreaFt2 ??
            m.computedLengthFt ??
            m.computedVolumeCy ??
            m.count ??
            0;
          measRows.push({
            organizationId,
            sourceType: "takeoff_measurement",
            sourceId: m.id,
            bidId: sheet.bidId ?? null,
            projectId: null,
            costCode: null,
            tradeType: null,
            title: `Takeoff: ${m.label}`,
            contentSnippet: `${m.type} value=${v}`,
            tags: [m.type],
            numericFacets: { value: Number(v) },
            contentHash: null,
          });
        }
      }
      if (measRows.length > 0) {
        const mUpserts = await bulkUpsertKnowledgeRows(measRows);
        recordChanges(mUpserts, measRows.map(() => null));
      }
    }

    // 3b. Standalone takeoff measurements — Task #2701. Same KV shape as bid
    // takeoff measurements above; scoped to the org's non-archived standalone
    // takeoffs via takeoffSheets.standaloneTakeoffId.
    const orgStandalones = await db
      .select({ id: standaloneTakeoffs.id })
      .from(standaloneTakeoffs)
      .where(and(
        eq(standaloneTakeoffs.organizationId, organizationId),
        isNull(standaloneTakeoffs.archivedAt),
      ));
    if (orgStandalones.length > 0) {
      const standaloneIds = orgStandalones.map((s) => s.id);
      const standaloneSheets = await db
        .select()
        .from(takeoffSheets)
        .where(
          since
            ? and(inArray(takeoffSheets.standaloneTakeoffId, standaloneIds), gte(takeoffSheets.updatedAt, since))
            : inArray(takeoffSheets.standaloneTakeoffId, standaloneIds),
        );
      if (standaloneSheets.length > 0) {
        const saMeasRows: InsertAiEstimatorKnowledgeIndex[] = [];
        for (const sheet of standaloneSheets) {
          const measurements = await db
            .select()
            .from(takeoffMeasurements)
            .where(eq(takeoffMeasurements.sheetId, sheet.id));
          counters.takeoffsIngested += measurements.length;
          for (const m of measurements.slice(0, 200)) {
            const v = m.computedAreaFt2 ?? m.computedLengthFt ?? m.computedVolumeCy ?? m.count ?? 0;
            saMeasRows.push({
              organizationId,
              sourceType: "takeoff_measurement",
              sourceId: m.id,
              bidId: null,
              projectId: null,
              costCode: null,
              tradeType: null,
              title: `Standalone Takeoff: ${m.label}`,
              contentSnippet: `${m.type} value=${v}`,
              tags: [m.type, "standalone_takeoff"],
              numericFacets: { value: Number(v) },
              contentHash: null,
            });
          }
        }
        if (saMeasRows.length > 0) {
          const saUpserts = await bulkUpsertKnowledgeRows(saMeasRows);
          recordChanges(saUpserts, saMeasRows.map(() => null));
        }
      }
    }

    // 4. Historical costs — completed-project actuals feed the learned-rates store.
    // `historical_costs` only has `created_at`, not `updated_at`, so we
    // window on `created_at >= since` for incremental runs and fall
    // back to the prior 2000-row cap on the first ever run.
    const histQuery = db
      .select()
      .from(historicalCosts);
    const hist = since
      ? await histQuery.where(and(
          eq(historicalCosts.organizationId, organizationId),
          gte(historicalCosts.createdAt, since),
        ))
      : await histQuery
          .where(eq(historicalCosts.organizationId, organizationId))
          .limit(2000);
    for (const h of hist) {
      const code = h.costCode ?? null;
      const qty = Number(h.quantity ?? 0);
      const total = Number(h.totalCost ?? 0);
      if (code && qty > 0 && total > 0 && h.unit) {
        rateUpdates.push({
          costCode: code,
          metric: "unit_cost",
          unit: h.unit,
          value: total / qty,
          sourceType: "historical_actual",
          sourceRowId: h.id,
          projectId: h.projectId ?? null,
          bidId: null,
        });
      }
    }

    counters.ratesUpdated = await bulkRecordRateSamples(organizationId, rateUpdates);

    // 5. Task #2414 — Claude knowledge-row enrichment.
    //
    // Gated on AI_PROVIDER_TAKEOFF so orgs that haven't opted into the
    // Claude-routed feature don't pay for it. Sequential with jitter to
    // stay well under provider per-minute caps; capped via env so a
    // pathological "every row changed" run can't blow the AI budget.
    // Wrapped in try/catch — enrichment is best-effort and must never
    // mark the ingest run as failed.
    try {
      const takeoffEnabled = await isFeatureEnabled(
        organizationId,
        "AI_PROVIDER_TAKEOFF",
      );
      if (!takeoffEnabled) {
        counters.rowsEnrichmentSkipped += changedRows.length;
      } else if (changedRows.length === 0) {
        // Nothing changed — every existing enrichedSummary is still valid.
      } else {
        const cap = enrichmentMaxPerRun();
        const targets = changedRows.slice(0, cap);
        counters.rowsEnrichmentSkipped += changedRows.length - targets.length;

        // Pre-fetch the org's learned rates once and bucket by costCode
        // so each enrichment call gets a small, on-topic slice without
        // an extra DB round-trip per row.
        const allRates = await listLearnedRatesForOrg(organizationId);
        const ratesByCode = new Map<string, AiEstimatorLearnedRate[]>();
        for (const r of allRates) {
          const arr = ratesByCode.get(r.costCode) ?? [];
          arr.push(r);
          ratesByCode.set(r.costCode, arr);
        }

        // Fetch the target rows in one query; we already have the ids
        // and the row body needs the latest snippet/title (in case the
        // upsert changed them in this same run).
        const targetIds = targets.map((t) => t.id);
        const rows: AiEstimatorKnowledgeIndex[] = targetIds.length
          ? await db
              .select()
              .from(aiEstimatorKnowledgeIndex)
              .where(inArray(aiEstimatorKnowledgeIndex.id, targetIds))
          : [];
        const rowById = new Map(rows.map((r) => [r.id, r]));

        for (const target of targets) {
          const row = rowById.get(target.id);
          if (!row) {
            counters.rowsEnrichmentFailed++;
            continue;
          }
          const rates = target.costCode ? ratesByCode.get(target.costCode) ?? [] : [];
          const summary = await enrichKnowledgeRow({
            organizationId,
            userId: triggeredByUserId,
            row,
            rates,
          });
          if (summary) {
            try {
              await setKnowledgeRowEnrichment(row.id, summary);
              counters.rowsEnriched++;
            } catch (writeErr) {
              counters.rowsEnrichmentFailed++;
              logWarn("AI Estimator enrichment write failed", {
                organizationId,
                knowledgeRowId: row.id,
                error: writeErr instanceof Error ? writeErr.message : String(writeErr),
              });
            }
          } else {
            counters.rowsEnrichmentFailed++;
          }
          await enrichmentJitter();
        }
      }
    } catch (enrichErr) {
      // Outer-loop failure (e.g. rates fetch threw). Log and continue —
      // the ingest itself succeeded and we never want enrichment to
      // surface as a hard ingest failure.
      logWarn("AI Estimator enrichment pass aborted", {
        organizationId,
        error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
      });
    }

    await completeIngestRun(run.id, "SUCCEEDED", counters);
    logInfo("AI Estimator ingestion completed", {
      organizationId,
      ...counters,
      changedRowCount: changedRows.length,
    });
    return {
      ...run,
      status: "SUCCEEDED",
      bidsIngested: counters.bidsIngested,
      estimatesIngested: counters.estimatesIngested,
      lineItemsIngested: counters.lineItemsIngested,
      takeoffsIngested: counters.takeoffsIngested,
      costPostingsIngested: counters.costPostingsIngested,
      ratesUpdated: counters.ratesUpdated,
      rowsEnriched: counters.rowsEnriched,
      completedAt: new Date(),
    };
  } catch (err) {
    logError("AI Estimator ingestion failed", {
      organizationId,
      error: String(err),
    });
    await completeIngestRun(run.id, "FAILED", counters, String(err));
    return {
      ...run,
      status: "FAILED",
      bidsIngested: counters.bidsIngested,
      estimatesIngested: counters.estimatesIngested,
      lineItemsIngested: counters.lineItemsIngested,
      takeoffsIngested: counters.takeoffsIngested,
      costPostingsIngested: counters.costPostingsIngested,
      ratesUpdated: counters.ratesUpdated,
      rowsEnriched: counters.rowsEnriched,
      errorMessage: String(err),
      completedAt: new Date(),
    };
  }
}
