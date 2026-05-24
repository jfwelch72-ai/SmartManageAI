// prompt-injection-guard: user content quarantined via quarantineUserText before any LLM call
/**
 * Task #3064 — Line Item Auto-Enrichment Service.
 *
 * Exposes:
 *   1. EnrichmentResponseSchema — Zod validator for Claude's structured JSON output.
 *      Used by /api/line-items/enrich and the auto-enrich trigger.
 *   2. triggerMeasurementAutoEnrichment — fires non-blocking enrichment after the
 *      map-reduce apply path inserts each takeoff measurement (mode: "AUTO").
 *      Back-patches takeoff_measurements.enrichment_id on success.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  enrichmentLog,
  enrichmentFeedback,
  bidOutcomes,
  takeoffMeasurements,
} from "@shared/schema";
import { routedChatCompletion } from "../../ai/providers";
import { governedAiCall } from "../aiGovernance";
import { quarantineUserText } from "../../ai/promptInjectionGuard";
import { logError, logWarn } from "../../utils/logger";
import { ENRICHMENT_SYSTEM_PROMPT } from "./enrichmentSystemPrompt";

const confidenceEnum = z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional();

/** Zod validation schema for the Claude enrichment JSON response. */
export const EnrichmentResponseSchema = z
  .object({
    specSuggestion: z
      .object({
        specifiedMaterialStandard: z.string().nullable().optional(),
        specifiedProductGrade: z.string().nullable().optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
        applicableSpecSections: z.array(z.string()).optional(),
        drawingReferences: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    materialSuggestion: z
      .object({
        suggestedUnitCostMaterial: z.string().nullable().optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
        priceDate: z.string().nullable().optional(),
        volatilityFlag: z.string().nullable().optional(),
        leadTimeFlag: z.string().nullable().optional(),
        manualVsBenchmarkVariance: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    laborSuggestion: z
      .object({
        suggestedUnitCostLabor: z.string().nullable().optional(),
        suggestedProductionRate: z.string().nullable().optional(),
        crewComposition: z.string().nullable().optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
      })
      .passthrough()
      .optional(),
    modifierSuggestion: z
      .object({
        requiredModifiers: z.array(z.string()).optional(),
        optionalModifiers: z.array(z.string()).optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
      })
      .passthrough()
      .optional(),
    sowSuggestion: z
      .object({
        scopeStatement: z.string().nullable().optional(),
        inclusions: z.array(z.string()).optional(),
        exclusions: z.array(z.string()).optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
      })
      .passthrough()
      .optional(),
    orgRiskFactor: z
      .object({
        riskFactorNote: z.string().nullable().optional(),
        suggestedContingencyPct: z.string().nullable().optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
      })
      .passthrough()
      .optional(),
    benchmarkRating: z
      .object({
        ratingVsBenchmark: z.string().nullable().optional(),
        benchmarkSource: z.string().nullable().optional(),
        _source: z.string().nullable().optional(),
        _confidence: confidenceEnum,
      })
      .passthrough()
      .optional(),
    clarifications: z
      .array(z.object({ field: z.string(), question: z.string() }).passthrough())
      .optional(),
    conflictAlerts: z
      .array(
        z
          .object({ type: z.string(), message: z.string(), severity: z.string().optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type EnrichmentResponseData = z.infer<typeof EnrichmentResponseSchema>;

export interface AutoEnrichParams {
  orgId: string;
  userId: string;
  measurementId: string;
  label: string;
  costCode: string | null;
  unit: string;
  value: number;
}

async function fetchOrgHistoryCompact(
  orgId: string,
  costCode: string | null | undefined,
): Promise<string | null> {
  if (!costCode) return null;
  const [fb, oc] = await Promise.all([
    db
      .select()
      .from(enrichmentFeedback)
      .where(and(eq(enrichmentFeedback.orgId, orgId), eq(enrichmentFeedback.costCode, costCode)))
      .orderBy(desc(enrichmentFeedback.createdAt))
      .limit(20),
    db
      .select()
      .from(bidOutcomes)
      .where(and(eq(bidOutcomes.orgId, orgId), eq(bidOutcomes.costCode, costCode)))
      .orderBy(desc(bidOutcomes.createdAt))
      .limit(10),
  ]);
  if (fb.length === 0 && oc.length === 0) return null;
  return JSON.stringify({ feedbackRows: fb, outcomeRows: oc });
}

/**
 * Fire non-blocking enrichment for a takeoff measurement inserted by the
 * map-reduce apply path. Call with `void` — never await on the hot request
 * path. On success, back-patches `takeoff_measurements.enrichment_id`.
 */
export async function triggerMeasurementAutoEnrichment(
  params: AutoEnrichParams,
): Promise<void> {
  const { orgId, userId, measurementId, label, costCode, unit, value } = params;
  const started = Date.now();
  let responseData: Record<string, unknown> | null = null;
  let errorMessage: string | null = null;

  try {
    const orgHistory = await fetchOrgHistoryCompact(orgId, costCode);
    const safeLabel = quarantineUserText("label", label);
    const lineItem = {
      description: safeLabel,
      costCode: costCode ?? null,
      quantity: String(value),
      unit,
      mode: "AUTO" as const,
    };
    const userMessage = JSON.stringify(
      { lineItem, projectContext: {}, orgHistory: orgHistory ?? undefined },
      null,
      2,
    );

    const gov = await governedAiCall<unknown>({
      orgId,
      userId,
      actionType: "line_item.enrichment",
      inputRefs: { costCode: costCode ?? null, mode: "AUTO", measurementId },
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
            `Enrichment Zod validation failed: ${JSON.stringify(
              validated.error.flatten().fieldErrors,
            ).slice(0, 300)}`,
          );
        }
        return { result: validated.data, completion };
      },
    });

    if (!gov.blocked && gov.result != null) {
      responseData = gov.result as Record<string, unknown>;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logWarn("[enrichmentTrigger] auto-enrich failed", { measurementId, orgId, error: errorMessage });
  }

  const durationMs = String(Date.now() - started);

  try {
    const [logRow] = await db
      .insert(enrichmentLog)
      .values({
        orgId,
        userId,
        measurementId,
        estimateLineItemId: null,
        costCode: costCode ?? null,
        mode: "AUTO",
        request: { label, costCode, unit, value } as unknown as Record<string, unknown>,
        response: responseData,
        durationMs,
        errorMessage,
      })
      .returning({ id: enrichmentLog.id });

    if (logRow?.id) {
      await db
        .update(takeoffMeasurements)
        .set({ enrichmentId: logRow.id })
        .where(eq(takeoffMeasurements.id, measurementId));
    }
  } catch (dbErr) {
    logError(
      "[enrichmentTrigger] failed to persist enrichment log",
      { measurementId, orgId },
      dbErr instanceof Error ? dbErr : new Error(String(dbErr)),
    );
  }
}
