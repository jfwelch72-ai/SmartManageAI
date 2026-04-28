import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { takeoffMeasurements, takeoffSheets } from "@shared/schema";
import { openai, AI_MODEL_GPT5 } from "../../ai/openaiClient";
import { governedAiCall } from "../aiGovernance";
import { listLearnedRatesForOrg, summarizeRate } from "./learnedRates";
import { retrieveContext, citationsFromRows } from "./retrieval";
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
}): Promise<{ result: DraftEstimateResult | null; blocked?: boolean; reason?: string }> {
  // 0. Verify the bid actually belongs to this org (IDOR guard).
  try {
    await assertBidInOrg(opts.bidId, opts.organizationId);
  } catch (err) {
    if (err instanceof ResourceOwnershipError) {
      return { result: null, blocked: true, reason: "Bid not found in this organization" };
    }
    throw err;
  }

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

  const measurementSummaries = measurements.slice(0, 100).map((m) => {
    const v =
      m.computedAreaFt2 ??
      m.computedLengthFt ??
      m.computedVolumeCy ??
      m.count ??
      0;
    return { id: m.id, label: m.label, type: m.type, value: Number(v) };
  });

  // 2. Pull learned-rates so the model can ground unit costs in tenant data.
  const rates = await listLearnedRatesForOrg(opts.organizationId);
  const rateSummary = rates.slice(0, 60).map((r) => ({
    costCode: r.costCode,
    metric: r.metric,
    unit: r.unit,
    ...summarizeRate(r),
  }));

  // 3. Pull context from the knowledge index.
  const contextRows = await retrieveContext({
    organizationId: opts.organizationId,
    query: opts.scopeNotes ?? undefined,
    bidId: opts.bidId,
    limit: 12,
  });

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
      snippet: r.contentSnippet,
      facets: r.numericFacets,
    })),
  });

  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.estimate_generate",
    inputRefs: { bidId: opts.bidId, sheetCount: sheetIds.length, measurementCount: measurementSummaries.length },
    fn: async () => {
      const completion = await openai.chat.completions.create({
        model: AI_MODEL_GPT5,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
      });
      return { result: completion.choices[0]?.message?.content ?? null, completion };
    },
  });
  if (gov.blocked) return { result: null, blocked: true, reason: gov.reason };

  const parsed = safeJson<DraftEstimateResult>(gov.result);
  if (!parsed) {
    logError("Draft estimate AI returned non-JSON", { bidId: opts.bidId });
    return { result: null, reason: "AI did not return parseable JSON" };
  }
  return {
    result: {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      notes: parsed.notes ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
      citations: citationsFromRows(contextRows),
    },
  };
}
