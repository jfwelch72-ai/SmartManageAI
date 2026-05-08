// prompt-injection-guard: draft estimate operates on validated takeoff line items (label/type/unit/cost-code) — no free-text from third parties
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { takeoffMeasurements, takeoffSheets } from "@shared/schema";
import { governedAiCall } from "../aiGovernance";
// Task #2413 — Routed through provider abstraction so this draft path runs on
// Claude when `AI_PROVIDER_TAKEOFF` is enabled for the org, with OpenAI fallback.
import { routedChatCompletion } from "../../ai/providers";
import { listLearnedRatesForOrg, summarizeRate } from "./learnedRates";
import { resolveRegionForBid } from "./regionFactors";
import {
  citationsFromRows,
  formatLessonsForPrompt,
  retrieveContext,
  retrieveLessons,
} from "./retrieval";
import { logError } from "../../utils/logger";
import {
  assertBidInOrg,
  filterSheetsInOrg,
  ResourceOwnershipError,
} from "./access";

export interface DraftLineItem {
  description: string;
  costCode: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  laborHours: number | null;
  totalCost: number;
  rationale: string;
  citationIds: string[];
}

export interface DraftEstimateResult {
  lines: DraftLineItem[];
  notes: string;
  citations: ReturnType<typeof citationsFromRows>;
  confidence: number;
}

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function generateDraftEstimate(opts: {
  organizationId: string;
  userId: string;
  bidId: string;
  takeoffSheetIds?: string[];
  scopeNotes?: string;
  /**
   * Optional progress callback invoked at each major phase. Used by the
   * `ai_estimator_draft` queue handler to surface step-by-step progress
   * to the UI (Task #2535). Best-effort — handler errors are swallowed.
   */
  onProgress?: (pct: number, message: string) => void | Promise<void>;
}): Promise<{ result: DraftEstimateResult | null; blocked?: boolean; reason?: string }> {
  const reportProgress = async (pct: number, message: string): Promise<void> => {
    if (!opts.onProgress) return;
    try {
      await opts.onProgress(pct, message);
    } catch {
      /* progress is best-effort */
    }
  };
  await reportProgress(10, "Verifying bid access");
  // 0. Verify the bid actually belongs to this org (IDOR guard).
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) {
      return { result: null, blocked: true, reason: "Bid not found in this organization" };
    }
    throw err;
  }
  await reportProgress(25, "Loading takeoff measurements");

  // 1. Pull takeoff measurements (if any) for the bid. We always intersect
  //    against the parent bid AND, if the caller supplied sheet ids, against
  //    those — but every sheet is re-checked against the org so cross-tenant
  //    sheets cannot be smuggled in via a forged id list.
  const sheets = await db
    .select()
    .from(takeoffSheets)
    .where(eq(takeoffSheets.bidId, opts.bidId));
  let sheetIds = sheets.map((s) => s.id);
  if (opts.takeoffSheetIds && opts.takeoffSheetIds.length) {
    const requested = opts.takeoffSheetIds.filter((id) => sheetIds.includes(id));
    sheetIds = await filterSheetsInOrg(requested, opts.organizationId);
  }
  const measurements = sheetIds.length
    ? await db
        .select()
        .from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.sheetId, sheetIds))
    : [];

  // Task #2576 — When a measurement has openings (windows / doorways /
  // equipment pads) the AI summarizer should reason about NET area, not
  // gross. `resolveNetAreaFt2` is the single source of truth for this
  // (also used by exports and assembly explosion).
  const { resolveNetAreaFt2 } = await import("../takeoff/measurementDeductions");
  const measurementSummaries = measurements.slice(0, 100).map((m) => {
    let value: number;
    let netInfo: { gross: number; deduction: number; net: number } | undefined;
    if (m.type === "AREA") {
      const breakdown = resolveNetAreaFt2({
        grossAreaFt2: m.computedAreaFt2 ?? 0,
        rawDeductions: m.deductions ?? null,
        scalePxPerFoot: m.scaleAtCapturePxPerFoot ?? null,
      });
      value = breakdown.netAreaFt2;
      if (breakdown.deductionCount > 0) {
        netInfo = {
          gross: Number(breakdown.grossAreaFt2.toFixed(2)),
          deduction: Number(breakdown.deductionAreaFt2.toFixed(2)),
          net: Number(breakdown.netAreaFt2.toFixed(2)),
        };
      }
    } else {
      value = Number(
        m.computedLengthFt ?? m.computedVolumeCy ?? m.count ?? 0,
      );
    }
    return { id: m.id, label: m.label, type: m.type, value, ...(netInfo ? { netInfo } : {}) };
  });

  await reportProgress(45, "Loading learned cost rates");
  // 2. Pull learned-rates so the model can ground unit costs in tenant data.
  //    Task #2627 — apply the project's active region factor (if any) so
  //    the rates handed to the model reflect the regional cost index.
  const [rates, regionInfo] = await Promise.all([
    listLearnedRatesForOrg(opts.organizationId),
    resolveRegionForBid(opts.organizationId, opts.bidId),
  ]);
  const rateSummary = rates.slice(0, 60).map((r) => ({
    costCode: r.costCode,
    metric: r.metric,
    unit: r.unit,
    ...summarizeRate(r, { regionMultiplier: regionInfo.multiplier }),
  }));

  await reportProgress(60, "Retrieving prior estimating context");
  // 3. Pull context from the knowledge index.
  const contextRows = await retrieveContext({
    organizationId: opts.organizationId,
    query: opts.scopeNotes ?? undefined,
    bidId: opts.bidId,
    limit: 12,
  });

  // Task #2415 — pull qualitative lessons. Best-effort; never fails the draft.
  let lessonRows: Awaited<ReturnType<typeof retrieveLessons>> = [];
  try {
    lessonRows = await retrieveLessons({
      organizationId: opts.organizationId,
      surface: "estimate_draft",
      limit: 10,
    });
  } catch {
    lessonRows = [];
  }
  const lessonsBlock = formatLessonsForPrompt(lessonRows);

  await reportProgress(75, "Calling AI estimator");
  const sysPrompt = `You are a senior construction estimator drafting a working estimate for a contractor in their own workspace.
You ONLY use the data provided: the takeoff measurements, the org's learned cost rates, and prior bids/estimates from this org.
Never invent unit costs that are not anchored in the provided rates or context. If a rate is missing, set unitCost to 0 and note it in rationale.
Return strict JSON: {
  "lines": [{ "description": string, "costCode": string|null, "quantity": number, "unit": "EA|LF|SF|SY|CY|TON|HR|LS|PCT",
              "unitCost": number, "laborHours": number|null, "totalCost": number, "rationale": string, "citationIds": string[] }],
  "notes": string, "confidence": number }`;
  const userPrompt = JSON.stringify({
    bidId: opts.bidId,
    scopeNotes: opts.scopeNotes ?? null,
    takeoffMeasurements: measurementSummaries,
    learnedRates: rateSummary,
    priorContext: contextRows.map((r) => ({
      id: r.sourceId,
      type: r.sourceType,
      title: r.title,
      // Task #2414 — prefer the Claude-written narrative when present;
      // fall back to the mechanical snippet so orgs without
      // AI_PROVIDER_TAKEOFF (and not-yet-enriched rows) behave exactly
      // as they did before this task.
      snippet: r.enrichedSummary ?? r.contentSnippet,
      facets: r.numericFacets,
    })),
  });

  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.estimate_generate",
    inputRefs: { bidId: opts.bidId, sheetCount: sheetIds.length, measurementCount: measurementSummaries.length },
    fn: async () => {
      const completion = await routedChatCompletion({
        orgId: opts.organizationId,
        featureKey: "ai_estimator.estimate_generate",
        request: {
          messages: [
            { role: "system", content: sysPrompt },
            // Task #2415 — qualitative lessons learned from prior EDIT feedback,
            // injected as soft guidance just below the main system prompt.
            ...(lessonsBlock ? [{ role: "system" as const, content: lessonsBlock }] : []),
            { role: "user", content: userPrompt },
          ],
          max_completion_tokens: 4000,
          response_format: { type: "json_object" },
        },
      });
      return { result: completion.choices[0]?.message?.content ?? null, completion };
    },
  });
  if (gov.blocked) return { result: null, blocked: true, reason: gov.reason };

  await reportProgress(92, "Validating draft");
  const parsed = safeJson<DraftEstimateResult>(gov.result);
  if (!parsed) {
    logError("Draft estimate AI returned non-JSON", { bidId: opts.bidId });
    return { result: null, reason: "AI did not return parseable JSON" };
  }

  // Task #2576 — Wire assemblies into the AI drafter. For each
  // measurement that matches an active org assembly via
  // (costCode, drivingMeasurementType), explode it through the
  // assembly so the draft includes the bill-of-materials lines the AI
  // wouldn't otherwise know about. Each appended line carries an
  // `assembly_explode` provenance marker on its rationale and a
  // synthetic citation id so the UI can distinguish it from
  // AI-authored lines. Best-effort: failure to look up an assembly
  // never fails the draft.
  const aiLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const assemblyLines: DraftLineItem[] = [];
  try {
    const { findAssemblyForMeasurement } = await import("./assemblies");
    const { buildExplodedLines } = await import("./explodeAssembly");
    for (const m of measurements) {
      const drivingType =
        m.type === "AREA" ? "AREA" :
        m.type === "LINEAR" ? "LINEAR" :
        m.type === "VOLUME" ? "VOLUME" :
        m.type === "COUNT" ? "COUNT" : null;
      if (!drivingType) continue;
      // Cost code on a measurement is recorded via its label / category
      // mapping; we treat the label as the cost-code probe key when
      // present so callers who tag measurements get assembly coverage.
      const costCode = (m.label ?? "").trim() || null;
      if (!costCode) continue;
      const assembly = await findAssemblyForMeasurement({
        organizationId: opts.organizationId,
        costCode,
        drivingMeasurementType: drivingType,
      }).catch(() => null);
      if (!assembly) continue;
      const exploded = buildExplodedLines({
        assembly,
        components: assembly.components,
        measurement: {
          id: m.id,
          computedAreaFt2: m.computedAreaFt2 ?? null,
          computedLengthFt: m.computedLengthFt ?? null,
          computedVolumeCy: m.computedVolumeCy ?? null,
          count: m.count ?? null,
          deductions: m.deductions ?? null,
          scaleAtCapturePxPerFoot: m.scaleAtCapturePxPerFoot ?? null,
        },
      });
      for (const line of exploded) {
        assemblyLines.push({
          description: line.description,
          costCode: assembly.costCode ?? null,
          quantity: line.quantity,
          unit: line.unit,
          unitCost: line.unitCost,
          laborHours: null,
          totalCost: line.totalCost,
          rationale: `assembly_explode:${assembly.id}:${assembly.name}`,
          citationIds: [`assembly:${assembly.id}`, `measurement:${m.id}`],
        });
      }
    }
  } catch (err) {
    logError(
      "Assembly explosion in AI drafter failed (non-fatal)",
      { bidId: opts.bidId },
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  return {
    result: {
      lines: [...aiLines, ...assemblyLines],
      notes: parsed.notes ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
      citations: citationsFromRows(contextRows),
    },
  };
}
