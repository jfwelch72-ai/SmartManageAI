// prompt-injection-guard: enrichmentSystemPrompt is static; user content quarantined via quarantineUserText
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { enrichmentLog, enrichmentFeedback, bidOutcomes } from "@shared/schema";
import { type AuthRequest, requireAuth } from "./auth";
import { sensitiveLimiter, apiLimiter } from "./rateLimiter";
import { logError } from "./utils/logger";
import { routedChatCompletion } from "./ai/providers";
import { governedAiCall } from "./services/aiGovernance";
import { quarantineUserText } from "./ai/promptInjectionGuard";
import { ENRICHMENT_SYSTEM_PROMPT } from "./services/aiEstimator/enrichmentSystemPrompt";
import { EnrichmentResponseSchema } from "./services/aiEstimator/enrichmentTrigger";

const router = Router();

const LineItemSchema = z.object({
  description: z.string().min(1),
  costCode: z.string().optional().nullable(),
  quantity: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  manualUnitCostMaterial: z.string().optional().nullable(),
  manualUnitCostLabor: z.string().optional().nullable(),
  manualProductionRate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  mode: z.enum(["AUTO", "ON_DEMAND"]).default("ON_DEMAND"),
});

const ProjectContextSchema = z.object({
  projectType: z.string().optional().nullable(),
  projectSize: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  laborType: z.string().optional().nullable(),
  bidDate: z.string().optional().nullable(),
  relevantSpecSections: z.string().optional().nullable(),
  relevantDrawingData: z.string().optional().nullable(),
  seismicZone: z.string().optional().nullable(),
  soilClass: z.string().optional().nullable(),
  specialConditions: z.string().optional().nullable(),
});

const EnrichRequestSchema = z.object({
  lineItem: LineItemSchema,
  projectContext: ProjectContextSchema.optional().default({}),
  estimateLineItemId: z.string().optional().nullable(),
});

const FeedbackSchema = z.object({
  enrichmentLogId: z.string().uuid().optional().nullable(),
  costCode: z.string().optional().nullable(),
  projectType: z.string().optional().nullable(),
  projectSize: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  laborType: z.string().optional().nullable(),
  fieldName: z.string().min(1),
  outcome: z.enum(["ACCEPTED_AS_IS", "MODIFIED", "REJECTED"]),
  suggestedValue: z.unknown().optional().nullable(),
  acceptedValue: z.unknown().optional().nullable(),
  payload: z.record(z.unknown()).optional().nullable(),
});

const BidOutcomeSchema = z.object({
  projectId: z.string().optional().nullable(),
  bidId: z.string().optional().nullable(),
  costCode: z.string().min(1),
  projectType: z.string().optional().nullable(),
  projectSize: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  laborType: z.string().optional().nullable(),
  finalBidUnitCostMaterial: z.string().optional().nullable(),
  finalBidUnitCostLabor: z.string().optional().nullable(),
  bidOutcome: z.enum(["AWARDED", "NOT_AWARDED", "NO_BID"]),
  competitorLowBid: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional().nullable(),
});

async function fetchOrgHistory(orgId: string, costCode: string | null | undefined) {
  if (!costCode) return null;

  const feedbackRows = await db
    .select()
    .from(enrichmentFeedback)
    .where(and(eq(enrichmentFeedback.orgId, orgId), eq(enrichmentFeedback.costCode, costCode)))
    .orderBy(desc(enrichmentFeedback.createdAt))
    .limit(50);

  const outcomeRows = await db
    .select()
    .from(bidOutcomes)
    .where(and(eq(bidOutcomes.orgId, orgId), eq(bidOutcomes.costCode, costCode)))
    .orderBy(desc(bidOutcomes.createdAt))
    .limit(20);

  if (feedbackRows.length === 0 && outcomeRows.length === 0) return null;

  const acceptedMaterialCosts: number[] = [];
  const acceptedLaborCosts: number[] = [];
  const modifierAccepts: string[] = [];
  const modifierRejects: string[] = [];

  for (const row of feedbackRows) {
    if (row.outcome === "ACCEPTED_AS_IS" || row.outcome === "MODIFIED") {
      const v = row.acceptedValue;
      const fn = row.fieldName ?? "";
      if (typeof v === "object" && v !== null) {
        // Legacy object format
        const obj = v as Record<string, unknown>;
        if (typeof obj.materialCost === "number") acceptedMaterialCosts.push(obj.materialCost);
        if (typeof obj.laborCost === "number") acceptedLaborCosts.push(obj.laborCost);
        if (Array.isArray(obj.modifiersAccepted)) modifierAccepts.push(...(obj.modifiersAccepted as string[]));
        if (Array.isArray(obj.modifiersRejected)) modifierRejects.push(...(obj.modifiersRejected as string[]));
      } else if (typeof v === "string") {
        // Current UI posts string values (e.g. "$5.50/SF"); route by fieldName
        const num = parseFloat(v.replace(/[^0-9.]/g, ""));
        if (!isNaN(num) && num > 0) {
          if (fn === "suggestedUnitCostMaterial") acceptedMaterialCosts.push(num);
          else if (fn === "suggestedUnitCostLabor") acceptedLaborCosts.push(num);
        }
      }
    }
  }

  const awardedOutcomes = outcomeRows.filter((r) => r.bidOutcome === "AWARDED");
  const winRate = outcomeRows.length > 0
    ? `${awardedOutcomes.length}/${outcomeRows.length} bids awarded`
    : null;

  const matRange =
    acceptedMaterialCosts.length > 0
      ? `$${Math.min(...acceptedMaterialCosts).toFixed(2)}–$${Math.max(...acceptedMaterialCosts).toFixed(2)}`
      : null;

  const labRange =
    acceptedLaborCosts.length > 0
      ? `$${Math.min(...acceptedLaborCosts).toFixed(2)}–$${Math.max(...acceptedLaborCosts).toFixed(2)}`
      : null;

  return {
    costCode,
    historicalUnitCostMaterial: matRange ?? "no data",
    historicalUnitCostLabor: labRange ?? "no data",
    historicalProductionRate: "see individual entries",
    projectCount: feedbackRows.length,
    winRate: winRate ?? "no bid outcome data",
    modifiersHistoricallyApplied: [...new Set(modifierAccepts)].slice(0, 10),
    modifiersHistoricallyRejected: [...new Set(modifierRejects)].slice(0, 10),
    projectNotes: awardedOutcomes
      .slice(0, 3)
      .map((r) => `Awarded at mat=$${r.finalBidUnitCostMaterial ?? "?"} lab=$${r.finalBidUnitCostLabor ?? "?"}`)
      .join("; ") || null,
  };
}

router.post(
  "/api/line-items/enrich",
  sensitiveLimiter,
  requireAuth,
  async (req: AuthRequest, res) => {
    const parse = EnrichRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid request", details: parse.error.flatten() });
    }

    const { lineItem, projectContext, estimateLineItemId } = parse.data;
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    const userId = req.user!.id;
    const started = Date.now();

    const orgHistory = await fetchOrgHistory(orgId, lineItem.costCode);

    const specText = quarantineUserText(
      "relevantSpecSections",
      projectContext.relevantSpecSections ?? "",
    );
    const drawingText = quarantineUserText(
      "relevantDrawingData",
      projectContext.relevantDrawingData ?? "",
    );

    const safeContext = {
      ...projectContext,
      relevantSpecSections: specText,
      relevantDrawingData: drawingText,
    };

    const userMessage = JSON.stringify(
      { lineItem, projectContext: safeContext, orgHistory: orgHistory ?? undefined },
      null,
      2,
    );

    let logId: string | null = null;
    let enrichmentResponse: unknown = null;
    let errorMessage: string | null = null;

    try {
      const gov = await governedAiCall<unknown>({
        orgId,
        userId,
        actionType: "line_item.enrichment",
        inputRefs: {
          costCode: lineItem.costCode ?? null,
          mode: lineItem.mode,
          hasSpecText: !!projectContext.relevantSpecSections,
          hasOrgHistory: !!orgHistory,
        },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId,
            featureKey: "ai_estimator.enrichment",
            request: {
              messages: [
                { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
                { role: "user", content: userMessage },
              ],
              temperature: 0,
              max_completion_tokens: 2000,
              tools: [{ type: "web_search_20250305" as const }],
            },
          });

          const raw = completion.choices[0]?.message?.content ?? "";

          let parsed: unknown;
          try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
          } catch {
            throw new Error(`Claude returned non-JSON: ${raw.slice(0, 200)}`);
          }

          const validated = EnrichmentResponseSchema.safeParse(parsed);
          if (!validated.success) {
            throw new Error(
              `Enrichment response failed Zod validation: ${JSON.stringify(
                validated.error.flatten().fieldErrors,
              ).slice(0, 300)}`,
            );
          }

          return { result: validated.data, completion };
        },
      });

      if (gov.blocked) {
        return res.status(503).json({
          error: "Enrichment blocked by governance policy",
          reason: gov.reason ?? "governance_block",
        });
      }

      enrichmentResponse = gov.result;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      logError("Line item enrichment Claude call failed", { orgId }, err instanceof Error ? err : new Error(errorMessage));
    }

    const durationMs = String(Date.now() - started);

    const [logRow] = await db
      .insert(enrichmentLog)
      .values({
        orgId,
        userId,
        estimateLineItemId: estimateLineItemId ?? null,
        costCode: lineItem.costCode ?? null,
        mode: lineItem.mode,
        request: { lineItem, projectContext: safeContext, orgHistory } as unknown as Record<string, unknown>,
        response: enrichmentResponse as Record<string, unknown> | null ?? null,
        durationMs,
        errorMessage,
      })
      .returning({ id: enrichmentLog.id });

    logId = logRow?.id ?? null;

    if (errorMessage) {
      return res.status(502).json({
        error: "Enrichment failed — the AI provider returned an unusable response. Please try again.",
        enrichmentLogId: logId,
      });
    }

    return res.json({
      enrichmentLogId: logId,
      ...(enrichmentResponse as object),
    });
  },
);

router.post(
  "/api/line-items/enrich/feedback",
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res) => {
    const parse = FeedbackSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid request", details: parse.error.flatten() });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    const userId = req.user!.id;
    const data = parse.data;

    await db.insert(enrichmentFeedback).values({
      orgId,
      userId,
      enrichmentLogId: data.enrichmentLogId ?? null,
      costCode: data.costCode ?? null,
      projectType: data.projectType ?? null,
      projectSize: data.projectSize ?? null,
      location: data.location ?? null,
      laborType: data.laborType ?? null,
      fieldName: data.fieldName,
      outcome: data.outcome,
      suggestedValue: data.suggestedValue as Record<string, unknown> | null ?? null,
      acceptedValue: data.acceptedValue as Record<string, unknown> | null ?? null,
      payload: data.payload as Record<string, unknown> | null ?? null,
    });

    return res.json({ ok: true });
  },
);

router.post(
  "/api/line-items/enrich/bid-outcome",
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res) => {
    const parse = BidOutcomeSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid request", details: parse.error.flatten() });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    const data = parse.data;

    await db.insert(bidOutcomes).values({
      orgId,
      projectId: data.projectId ?? null,
      bidId: data.bidId ?? null,
      costCode: data.costCode,
      projectType: data.projectType ?? null,
      projectSize: data.projectSize ?? null,
      location: data.location ?? null,
      laborType: data.laborType ?? null,
      finalBidUnitCostMaterial: data.finalBidUnitCostMaterial ?? null,
      finalBidUnitCostLabor: data.finalBidUnitCostLabor ?? null,
      bidOutcome: data.bidOutcome,
      competitorLowBid: data.competitorLowBid ?? null,
      payload: data.payload as Record<string, unknown> | null ?? null,
    });

    return res.json({ ok: true });
  },
);

export default router;
