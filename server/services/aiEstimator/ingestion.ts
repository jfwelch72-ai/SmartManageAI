import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorIngestRuns,
  bids,
  estimates,
  estimateLineItems,
  historicalCosts,
  takeoffMeasurements,
  takeoffSheets,
  type AiEstimatorIngestRun,
} from "@shared/schema";
import { upsertKnowledgeRow } from "./retrieval";
import { bulkRecordRateSamples, type RateMetric } from "./learnedRates";
import { logError, logInfo } from "../../utils/logger";

interface IngestCounters {
  bidsIngested: number;
  estimatesIngested: number;
  lineItemsIngested: number;
  takeoffsIngested: number;
  costPostingsIngested: number;
  ratesUpdated: number;
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
  };
  try {
    // 1. Bids — index by name + description for retrieval.
    const orgBids = await db
      .select()
      .from(bids)
      .where(eq(bids.gcOrganizationId, organizationId));
    for (const b of orgBids) {
      counters.bidsIngested++;
      await upsertKnowledgeRow({
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
    }
    // 2. Estimates + line items — drive learned-rates and retrieval.
    const bidIds = orgBids.map((b) => b.id);
    const bidById = new Map(orgBids.map((b) => [b.id, b]));
    const orgEstimates = bidIds.length
      ? await db
          .select()
          .from(estimates)
          .where(sql`${estimates.bidId} = ANY(${bidIds})`)
      : [];
    counters.estimatesIngested = orgEstimates.length;

    const rateUpdates: Array<{
      costCode: string;
      metric: RateMetric;
      unit: string;
      value: number;
      sourceType: "estimate_line_item";
      sourceRowId?: string;
      projectId?: string | null;
      bidId?: string | null;
    }> = [];

    for (const est of orgEstimates) {
      await upsertKnowledgeRow({
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
        await upsertKnowledgeRow({
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
      }
    }

    // 3. Takeoff measurements — light retrieval index.
    const orgTakeoffs = bidIds.length
      ? await db
          .select()
          .from(takeoffSheets)
          .where(sql`${takeoffSheets.bidId} = ANY(${bidIds})`)
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
        await upsertKnowledgeRow({
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
    await completeIngestRun(run.id, "SUCCEEDED", counters);
    logInfo("AI Estimator ingestion completed", { organizationId, ...counters });
    return { ...run, status: "SUCCEEDED", ...counters, completedAt: new Date() };
  } catch (err) {
    logError("AI Estimator ingestion failed", {
      organizationId,
      error: String(err),
    });
    await completeIngestRun(run.id, "FAILED", counters, String(err));
    return {
      ...run,
      status: "FAILED",
      ...counters,
      errorMessage: String(err),
      completedAt: new Date(),
    };
  }
}
