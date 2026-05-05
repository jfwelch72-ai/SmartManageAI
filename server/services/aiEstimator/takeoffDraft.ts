import { eq } from "drizzle-orm";
import { db } from "../../db";
import { planDocuments, projects } from "@shared/schema";
import { extractDocumentContent } from "../../ai/documentExtractor";
import { governedAiCall } from "../aiGovernance";
// Task #2410 — Routed through provider abstraction so this draft path runs on
// Claude when `AI_PROVIDER_TAKEOFF` is enabled for the org.
import { routedChatCompletion } from "../../ai/providers";
import type { AiContentPart } from "../../ai/providers/types";
import { logError, logWarn } from "../../utils/logger";

export interface DraftTakeoffMeasurement {
  label: string;
  type: "AREA" | "LINEAR" | "COUNT" | "VOLUME" | "ANGULAR" | "DIAMETER";
  value: number;
  unit: string;
  costCode: string | null;
  rationale: string;
}

export interface TakeoffDraftResult {
  measurements: DraftTakeoffMeasurement[];
  notes: string;
  confidence: number;
}

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

async function resolveOrgPlanDocuments(
  organizationId: string,
  opts: { documentIds?: string[]; projectId?: string },
): Promise<string[]> {
  // Always restrict to documents whose project belongs to this organization.
  const baseRows = await db
    .select({
      id: planDocuments.id,
      fileUrl: planDocuments.fileUrl,
      projectId: planDocuments.projectId,
    })
    .from(planDocuments)
    .innerJoin(projects, eq(projects.id, planDocuments.projectId))
    .where(eq(projects.gcOrganizationId, organizationId));

  let scoped = baseRows;
  if (opts.documentIds && opts.documentIds.length > 0) {
    const allowed = new Set(opts.documentIds);
    scoped = baseRows.filter((r) => allowed.has(r.id));
  } else if (opts.projectId) {
    scoped = baseRows.filter((r) => r.projectId === opts.projectId);
  }
  return scoped.map((r) => r.fileUrl).filter((u): u is string => !!u);
}

/**
 * Drafts a full takeoff from a set of plan-document IDs. Restricted to
 * documents owned by the caller's org (resolved via projects.gcOrganizationId).
 */
export async function draftTakeoffFromPlans(opts: {
  organizationId: string;
  userId: string;
  planDocumentIds?: string[];
  projectId?: string;
  scopeNotes?: string;
}): Promise<{ result: TakeoffDraftResult | null; blocked?: boolean; reason?: string }> {
  const urls = await resolveOrgPlanDocuments(opts.organizationId, {
    documentIds: opts.planDocumentIds,
    projectId: opts.projectId,
  });
  if (urls.length === 0) {
    return { result: null, reason: "No plan documents found for your organization" };
  }
  // Cap at first 4 documents to keep the prompt under control.
  const blocks = (
    await Promise.all(
      urls.slice(0, 4).map(async (u) => {
        try {
          return await extractDocumentContent(u);
        } catch (err) {
          logWarn("AI Estimator failed to extract plan document content", {
            url: u,
            error: String(err),
          });
          return [];
        }
      }),
    )
  ).flat();
  if (blocks.length === 0) {
    return { result: null, reason: "Unable to read any of the provided plan documents" };
  }

  const sysPrompt = `You are a senior estimator drafting an initial takeoff from construction drawings. Identify quantifiable items (areas in SF/SY, lengths in LF, volumes in CY, counts in EA). Be conservative — never invent measurements that are not visible. ${opts.scopeNotes ? `Scope notes: ${opts.scopeNotes}.` : ""} Respond with strict JSON: { "measurements": [{ "label": string, "type": "AREA|LINEAR|COUNT|VOLUME|ANGULAR|DIAMETER", "value": number, "unit": string, "costCode": string|null, "rationale": string }], "notes": string, "confidence": number }.`;

  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.takeoff_draft",
    inputRefs: { planCount: urls.length, scopeNotes: opts.scopeNotes ?? null },
    fn: async () => {
      const completion = await routedChatCompletion({
        orgId: opts.organizationId,
        featureKey: "ai_estimator.takeoff_draft",
        request: {
          messages: [
            { role: "system", content: sysPrompt },
            {
              role: "user",
              content: [
                ...blocks.map<AiContentPart>((b) =>
                  b.type === "image_url"
                    ? { type: "image_url", image_url: { url: b.image_url.url, detail: "auto" } }
                    : { type: "text", text: b.text },
                ),
                { type: "text", text: "Draft the takeoff." },
              ],
            },
          ],
          max_completion_tokens: 4000,
          response_format: { type: "json_object" },
        },
      });
      return { result: completion.choices[0]?.message?.content ?? null, completion };
    },
  });
  if (gov.blocked) return { result: null, blocked: true, reason: gov.reason };

  const parsed = safeJson<TakeoffDraftResult>(gov.result);
  if (!parsed) {
    logError("AI Estimator takeoff draft returned non-JSON", {});
    return { result: null, reason: "AI did not return parseable JSON" };
  }
  return {
    result: {
      measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
      notes: parsed.notes ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
    },
  };
}
