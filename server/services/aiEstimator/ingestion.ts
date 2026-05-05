import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorIngestRuns,
  aiEstimatorKnowledgeIndex,
  bids,
  estimates,
  estimateLineItems,
  historicalCosts,
  takeoffMeasurements,
  takeoffSheets,
  type AiEstimatorIngestRun,
  type AiEstimatorKnowledgeIndex,
  type AiEstimatorLearnedRate,
} from "@shared/schema";
import { upsertKnowledgeRow, setKnowledgeRowEnrichment } from "./retrieval";
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
  const recordChange = (
    result: { id: string; changed: boolean },
    costCode: string | null,
  ): void => {
    if (result.changed) changedRows.push({ id: result.id, costCode });
  };
  try {
    // 1. Bids — index by name + description for retrieval.
    const orgBids = await db
      .select()
      .from(bids)
      .where(eq(bids.gcOrganizationId, organizationId));
    for (const b of orgBids) {
      counters.bidsIngested++;
      const upsert = await upsertKnowledgeRow({
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
      });
      recordChange(upsert, null);
    }
    // 2. Estimates + line items — drive learned-rates and retrieval.
    const bidIds = orgBids.map((b) => b.id);
    const bidById = new Map(orgBids.map((b) => [b.id, b]));
    const orgEstimates = bidIds.length
      ? await db
          .select()
          .from(estimates)
          .where(inArray(estimates.bidId, bidIds))
      : [];
    counters.estimatesIngested = orgEstimates.length;

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

    for (const est of orgEstimates) {
      const estUpsert = await upsertKnowledgeRow({
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
      });
      recordChange(estUpsert, null);
      const items = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, est.id));
      const bid = est.bidId ? bidById.get(est.bidId) : null;
      for (const li of items) {
        counters.lineItemsIngested++;
        const qty = Number(li.quantity ?? 0);
        const totalCost = Number(li.totalCost ?? 0);
        const labor = Number(li.laborHours ?? 0);
        const unitCost = qty > 0 ? totalCost / qty : 0;
        const laborPerUnit = qty > 0 ? labor / qty : 0;
        const code = li.workTypeCode ?? null;
        if (code && unitCost > 0) {
          rateUpdates.push({
            costCode: code,
            metric: "unit_cost",
            unit: li.unit,
            value: unitCost,
            sourceType: "estimate_line_item",
            sourceRowId: li.id,
            projectId: null,
            bidId: est.bidId ?? null,
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
            bidId: est.bidId ?? null,
          });
        }
        const liUpsert = await upsertKnowledgeRow({
          organizationId,
          sourceType: "estimate_line_item",
          sourceId: li.id,
          bidId: est.bidId ?? null,
          projectId: null,
          costCode: code,
          tradeType: null,
          title: `Line item: ${li.description.slice(0, 80)}`,
          contentSnippet: `Qty ${li.quantity} ${li.unit} • $${li.totalCost} total • code ${code ?? "—"}`,
          tags: code ? [code] : [],
          numericFacets: { qty, totalCost, unitCost, laborHours: labor },
          contentHash: null,
        });
        recordChange(liUpsert, code);
      }
    }

    // 3. Takeoff measurements — light retrieval index.
    const orgTakeoffs = bidIds.length
      ? await db
          .select()
          .from(takeoffSheets)
          .where(inArray(takeoffSheets.bidId, bidIds))
      : [];
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
        const mUpsert = await upsertKnowledgeRow({
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
        recordChange(mUpsert, null);
      }
    }

    // 4. Historical costs — completed-project actuals feed the learned-rates store.
    const hist = await db
      .select()
      .from(historicalCosts)
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
