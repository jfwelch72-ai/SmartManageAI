// Task #2481 — AI bid document analysis handler.

import { eq } from "drizzle-orm";
import { defineJob, type JobContext } from "../index";
import { db } from "../../db";
import { aiBidDocumentAnalysis, organizations } from "@shared/schema";
import {
  analyzeDocumentWithAI,
} from "../../aiDocumentRoutes";
import { isPromptInjectionRefusal } from "../../ai/promptInjectionGuard";
import { logError, logInfo, logWarn } from "../../utils/logger";

export interface AiDocumentJobPayload {
  analysisId: string;
  documentUrl: string;
  documentName: string;
  organizationId: string;
  userId: string | null;
}

export function registerAiDocumentJob(): void {
  defineJob<AiDocumentJobPayload>(
    "ai_document_analyze",
    async (payload, ctx: JobContext) => {
      await ctx.progress(5, "Loading document context");
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, payload.organizationId))
        .limit(1);

      await ctx.progress(15, "Calling AI analyzer");
      try {
        const result = await analyzeDocumentWithAI(
          payload.documentUrl,
          payload.documentName,
          org?.tradeType || undefined,
          { userId: payload.userId, orgId: payload.organizationId },
        );
        await ctx.progress(85, "Persisting analysis");
        await db
          .update(aiBidDocumentAnalysis)
          .set({
            status: "COMPLETED",
            projectName: result.projectName || null,
            clientName: result.clientName || null,
            bidDueDate: result.bidDueDate ? new Date(result.bidDueDate) : null,
            projectLocation: result.projectLocation || null,
            projectScope: result.projectScope || null,
            scopeSummary: result.scopeSummary || null,
            lineItems: JSON.stringify(result.lineItems || []),
            requirements: JSON.stringify(result.requirements || []),
            qualifications: JSON.stringify(result.qualifications || []),
            insuranceRequirements: result.insuranceRequirements || null,
            bondingRequirements: result.bondingRequirements || null,
            suggestedPricingFactors: JSON.stringify(result.suggestedPricingFactors || []),
            riskFactors: JSON.stringify(result.riskFactors || []),
            confidenceScore: result.confidenceScore ?? 0,
            analyzedAt: new Date(),
            rawAiResponse: JSON.stringify(result),
            updatedAt: new Date(),
          })
          .where(eq(aiBidDocumentAnalysis.id, payload.analysisId));
        logInfo(`AI bid document analysis completed for: ${payload.documentName}`);
        return { analysisId: payload.analysisId, confidenceScore: result.confidenceScore };
      } catch (error) {
        const refused = isPromptInjectionRefusal(error);
        if (refused) {
          logWarn("Job AI document analysis refused (prompt-injection)", {
            analysisId: payload.analysisId,
          });
        } else {
          logError(
            "Job AI document analysis failed",
            { analysisId: payload.analysisId },
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        await db
          .update(aiBidDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: refused
              ? "REFUSED_PROMPT_INJECTION: Document refused — prompt-injection payload detected."
              : (error instanceof Error ? error.message : "Unknown error"),
            updatedAt: new Date(),
          })
          .where(eq(aiBidDocumentAnalysis.id, payload.analysisId));
        // Refusals are terminal — don't burn retries on them.
        if (refused) return { analysisId: payload.analysisId, refused: true };
        throw error;
      }
    },
    { perTenantConcurrency: 2 },
  );
}
