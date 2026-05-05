import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db } from "./db";
import {
  haulTickets,
  projectDbeGoals,
  subcontractorContracts,
  subcontractorPayments,
  crmOrganisations,
  crmOrganisationCertifications,
  projects,
  planDocuments,
  type FeatureFlagKey,
} from "@shared/schema";
import { type AuthRequest, requireAuth, requireFeaturePermission } from "./auth";
import { sensitiveLimiter } from "./rateLimiter";
import { logError, logWarn } from "./utils/logger";
import { governedAiCall } from "./services/aiGovernance";
// Task #2410 — All heavy-civil AI calls flow through the provider router so
// orgs on `AI_PROVIDER_TAKEOFF` get Anthropic Claude with OpenAI fallback.
// The router picks the per-provider model so we no longer pin AI_MODEL_GPT5
// here; the unrouted `openai` client is no longer referenced in this file.
import { routedChatCompletion } from "./ai/providers";
import { extractDocumentContent } from "./ai/documentExtractor";
import { isFeatureEnabled } from "./services/featureFlagService";
import { validateBody } from "./utils/validation";

const router = Router();

// =====================================================================
// Feature-flag gate for an org-scoped heavy-civil AI feature.
// SUPER_ADMIN bypasses (platform support).
// =====================================================================
function requireOrgFeatureFlag(flag: FeatureFlagKey) {
  return async (req: AuthRequest, res: Response, next: () => void): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: "Authentication required" }); return; }
    if (req.user.role === "SUPER_ADMIN") { next(); return; }
    if (!req.user.organizationId) { res.status(403).json({ error: "Organization required" }); return; }
    const enabled = await isFeatureEnabled(req.user.organizationId, flag);
    if (!enabled) {
      res.status(403).json({ error: `Feature disabled: ${flag}`, featureFlag: flag, upgradeRequired: true });
      return;
    }
    next();
  };
}

// Common error responses for governed calls
function blockedResponse(res: Response, reason?: string) {
  return res.status(429).json({ error: "AI quota exceeded", reason: reason || "AI usage limit reached for this organization. Try again tomorrow or contact your admin." });
}

function fallbackResponse(res: Response, message: string) {
  // Return 200 so the client mutation `onSuccess` runs and can render the
  // structured fallback UX (toast / inline notice). The `fallback: true`
  // flag tells the UI to fall back to manual entry.
  return res.status(200).json({ fallback: true, message });
}

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

// =====================================================================
// FEATURE 1 — BID-TAB EXTRACTOR (DOT_PAY_ITEMS)
// Parse a state-DOT bid-tab document into pay-item rows.
// =====================================================================
const bidTabSchema = z.object({
  // Only accept org-owned uploaded documents (resolved to file URL via the
  // planDocuments tenant check) — never raw URLs, to prevent cross-tenant
  // IDOR / SSRF against internal storage paths.
  documentId: z.string().min(1),
  agencyName: z.string().optional(),
  specBookEdition: z.string().optional(),
});

router.post(
  "/ai-features/heavy-civil/bid-tab/extract",
  requireAuth,
  requireOrgFeatureFlag("DOT_PAY_ITEMS"),
  // The extractor lives on the DOT Library page so we gate on the library
  // permission. Bid-wizard users with `canManageBidWizard` should already be
  // granted `canManageDotLibrary` by the standard role defaults.
  requireFeaturePermission("canManageDotLibrary"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = validateBody(bidTabSchema, req.body, res);
      if (!data) return;

      const url = await resolveDocumentUrl({ documentId: data.documentId }, req.user!.organizationId!);
      if (!url) {
        return res.status(404).json({ error: "Document not found in your organization" });
      }

      const blocks = await extractDocumentContent(url);
      if (blocks.length === 0) {
        return fallbackResponse(res, "Unable to read the uploaded bid tab document. Please enter pay items manually.");
      }

      const govResult = await governedAiCall<string | null>({
        orgId: req.user!.organizationId!,
        userId: req.user!.id,
        actionType: "heavy_civil.bid_tab.extract",
        inputRefs: { documentId: data.documentId, agency: data.agencyName ?? null },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId: req.user!.organizationId!,
            featureKey: "heavy_civil.bid_tab.extract",
            request: {
              messages: [
                {
                  role: "system",
                  content: `You are an estimator extracting pay items from a state-DOT bid tabulation. ${data.agencyName ? `Agency: ${data.agencyName}. ` : ""}${data.specBookEdition ? `Spec book: ${data.specBookEdition}. ` : ""}Output strict JSON: { "items": [{ "itemNumber": "string", "description": "string", "unit": "string", "quantity": number, "specSection": "string|null" }], "confidence": number (0-100), "notes": "string" }. Use AASHTOWare-style item numbers when visible (e.g. "203.20100"). Keep units in the bid-tab's native form (TON, CY, LF, EA, SF, AC, LS, ETC).`,
                },
                {
                  role: "user",
                  content: [
                    ...blocks,
                    { type: "text", text: "Extract every pay item visible. Do not invent rows. If a row is illegible mark its description as \"UNREADABLE\"." },
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

      if (govResult.blocked) return blockedResponse(res, govResult.reason);
      const parsed = safeJson<{ items?: unknown[]; confidence?: number; notes?: string }>(govResult.result);
      if (!parsed || !Array.isArray(parsed.items)) {
        return fallbackResponse(res, "AI returned no parseable pay items. Please enter manually.");
      }
      res.json({ items: parsed.items, confidence: parsed.confidence ?? 0, notes: parsed.notes ?? null });
    } catch (error) {
      logError("Bid-tab extraction failed", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Bid-tab extraction failed", fallback: true });
    }
  },
);

// =====================================================================
// FEATURE 2 — HAUL TICKET OCR (HAUL_TICKETS)
// Read a paper haul-ticket photo into structured fields.
// Accepts an org-owned documentId only (resolved to fileUrl with tenant
// validation). Raw URLs are rejected to prevent IDOR / SSRF.
// =====================================================================
const haulOcrSchema = z.object({
  documentId: z.string().min(1),
});

async function resolveDocumentUrl(input: { documentId?: string }, organizationId: string): Promise<string | null> {
  if (!input.documentId) return null;
  const [doc] = await db
    .select({ fileUrl: planDocuments.fileUrl, projectId: planDocuments.projectId })
    .from(planDocuments)
    .innerJoin(projects, eq(projects.id, planDocuments.projectId))
    .where(and(eq(planDocuments.id, input.documentId), eq(projects.gcOrganizationId, organizationId)))
    .limit(1);
  return doc?.fileUrl ?? null;
}

router.post(
  "/ai-features/heavy-civil/haul-ticket/ocr",
  requireAuth,
  requireOrgFeatureFlag("HAUL_TICKETS"),
  requireFeaturePermission("canManageHaulTickets"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = validateBody(haulOcrSchema, req.body, res);
      if (!data) return;

      const url = await resolveDocumentUrl(data, req.user!.organizationId!);
      if (!url) return res.status(404).json({ error: "Document not found in your organization" });

      const blocks = await extractDocumentContent(url);
      if (blocks.length === 0) {
        return fallbackResponse(res, "Could not read the uploaded ticket photo. Enter values manually.");
      }

      const govResult = await governedAiCall<string | null>({
        orgId: req.user!.organizationId!,
        userId: req.user!.id,
        actionType: "heavy_civil.haul_ticket.ocr",
        inputRefs: { documentId: data.documentId },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId: req.user!.organizationId!,
            featureKey: "heavy_civil.haul_ticket.ocr",
            request: {
              messages: [
                {
                  role: "system",
                  content: `Read a haul-truck delivery ticket photo. Output strict JSON: { "ticketNumber": "string|null", "ticketDate": "YYYY-MM-DD|null", "materialClass": "string|null", "source": "string|null", "destination": "string|null", "truckNumber": "string|null", "driverName": "string|null", "quantity": "string|null", "unit": "TON|CY|LF|EA|LOAD|null", "unitCost": "string|null", "confidence": number (0-100), "notes": "string" }. Use null when illegible. Quantities and costs as decimal strings without currency symbols.`,
                },
                {
                  role: "user",
                  content: [
                    ...blocks,
                    { type: "text", text: "Extract the ticket fields. Do not guess; use null for unreadable fields." },
                  ],
                },
              ],
              max_completion_tokens: 800,
              response_format: { type: "json_object" },
            },
          });
          return { result: completion.choices[0]?.message?.content ?? null, completion };
        },
      });

      if (govResult.blocked) return blockedResponse(res, govResult.reason);
      const parsed = safeJson<Record<string, unknown>>(govResult.result);
      if (!parsed) return fallbackResponse(res, "AI returned no parseable fields. Enter manually.");
      res.json(parsed);
    } catch (error) {
      logError("Haul ticket OCR failed", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Haul ticket OCR failed", fallback: true });
    }
  },
);

// =====================================================================
// FEATURE 3 — IDR SUMMARIZER (DAILY_INSPECTOR_REPORTS)
// Turn raw field notes into a clean DOT-style "Work Performed" paragraph.
// =====================================================================
const idrSummarizeSchema = z.object({
  rawNotes: z.string().min(10).max(8000),
  weather: z.string().optional(),
  crewCount: z.number().int().nonnegative().optional(),
  crewHours: z.string().optional(),
  stationsWorked: z.string().optional(),
});

router.post(
  "/ai-features/heavy-civil/idr/summarize",
  requireAuth,
  requireOrgFeatureFlag("DAILY_INSPECTOR_REPORTS"),
  requireFeaturePermission("canSubmitInspectorReports"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = validateBody(idrSummarizeSchema, req.body, res);
      if (!data) return;

      const govResult = await governedAiCall<string | null>({
        orgId: req.user!.organizationId!,
        userId: req.user!.id,
        actionType: "heavy_civil.idr.summarize",
        inputRefs: { length: data.rawNotes.length },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId: req.user!.organizationId!,
            featureKey: "heavy_civil.idr.summarize",
            request: {
              messages: [
                {
                  role: "system",
                  content: `Rewrite raw inspector field notes into a clean state-DOT-style "Work Performed" narrative. Output strict JSON: { "workPerformed": "string", "delaysEncountered": "string", "safetyIncidents": "string", "confidence": number (0-100) }. Keep facts only — never invent quantities, names, or stations. Use past-tense, third-person, 1-3 short paragraphs.`,
                },
                {
                  role: "user",
                  content: `Weather: ${data.weather ?? "n/a"}\nCrew: ${data.crewCount ?? "?"} workers, ${data.crewHours ?? "?"} hrs\nStations: ${data.stationsWorked ?? "n/a"}\n\nRaw field notes:\n${data.rawNotes}`,
                },
              ],
              max_completion_tokens: 1200,
              response_format: { type: "json_object" },
            },
          });
          return { result: completion.choices[0]?.message?.content ?? null, completion };
        },
      });

      if (govResult.blocked) return blockedResponse(res, govResult.reason);
      const parsed = safeJson<Record<string, unknown>>(govResult.result);
      if (!parsed) return fallbackResponse(res, "Could not generate a summary. Use your raw notes as-is.");
      res.json(parsed);
    } catch (error) {
      logError("IDR summarize failed", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "IDR summarize failed", fallback: true });
    }
  },
);

// =====================================================================
// FEATURE 4 — SWPPP CORRECTIVE-ACTION DRAFTER (SWPPP_INSPECTIONS)
// Suggest NPDES-compliant corrective-action language from deficiencies.
// =====================================================================
const swpppDraftSchema = z.object({
  deficienciesFound: z.string().min(5).max(4000),
  inspectionType: z.string().optional(),
  rainfall24hrInches: z.string().optional(),
});

router.post(
  "/ai-features/heavy-civil/swppp/draft-corrective",
  requireAuth,
  requireOrgFeatureFlag("SWPPP_INSPECTIONS"),
  requireFeaturePermission("canManageSwppp"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = validateBody(swpppDraftSchema, req.body, res);
      if (!data) return;

      const govResult = await governedAiCall<string | null>({
        orgId: req.user!.organizationId!,
        userId: req.user!.id,
        actionType: "heavy_civil.swppp.draft_corrective",
        inputRefs: { length: data.deficienciesFound.length },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId: req.user!.organizationId!,
            featureKey: "heavy_civil.swppp.draft_corrective",
            request: {
              messages: [
                {
                  role: "system",
                  content: `Draft NPDES/CGP-compliant corrective-action language for a SWPPP inspection. Reference the BMP that failed (silt fence, inlet protection, stabilized construction entrance, sediment basin, etc.) and the corrective step required by EPA 2022 CGP. Output strict JSON: { "correctiveActions": "string", "recommendedDueDays": number, "bmpReferences": ["string"], "confidence": number (0-100) }. Be specific and field-actionable. Never invent rainfall data or timelines outside CGP standards (typically 7 calendar days; 24 hours for discharge-causing failures).`,
                },
                {
                  role: "user",
                  content: `Inspection type: ${data.inspectionType ?? "ROUTINE"}\n24-hr rainfall: ${data.rainfall24hrInches ?? "n/a"} in\n\nDeficiencies found:\n${data.deficienciesFound}`,
                },
              ],
              max_completion_tokens: 800,
              response_format: { type: "json_object" },
            },
          });
          return { result: completion.choices[0]?.message?.content ?? null, completion };
        },
      });

      if (govResult.blocked) return blockedResponse(res, govResult.reason);
      const parsed = safeJson<Record<string, unknown>>(govResult.result);
      if (!parsed) return fallbackResponse(res, "Could not draft corrective actions. Enter manually.");
      res.json(parsed);
    } catch (error) {
      logError("SWPPP draft failed", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "SWPPP draft failed", fallback: true });
    }
  },
);

// =====================================================================
// FEATURE 5 — DBE PARTICIPATION RISK SCORE (DBE_TRACKING)
// Compute deterministic risk + AI commentary for a project's DBE goals.
// Used both by the user-triggered button and the daily background job.
// =====================================================================
// In-memory snapshot of the most recent risk assessment per project so
// dashboards and at-risk tiles can read the latest score without recomputing
// AI on every page load. Keyed by `${organizationId}:${projectId}`.
// (A persistent table would be ideal but the heavy-civil schema push is
// pending — see follow-up task #496.)
const dbeRiskSnapshots = new Map<string, DbeRiskAssessment>();
function snapshotKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}
export function getDbeRiskSnapshot(orgId: string, projectId: string): DbeRiskAssessment | null {
  return dbeRiskSnapshots.get(snapshotKey(orgId, projectId)) ?? null;
}
export function listDbeRiskSnapshots(orgId: string): DbeRiskAssessment[] {
  const prefix = `${orgId}:`;
  const out: DbeRiskAssessment[] = [];
  for (const [k, v] of dbeRiskSnapshots) if (k.startsWith(prefix)) out.push(v);
  return out;
}
export function recordDbeRiskSnapshot(orgId: string, projectId: string, snap: DbeRiskAssessment): void {
  dbeRiskSnapshots.set(snapshotKey(orgId, projectId), snap);
}

export interface DbeRiskAssessment {
  projectId: string;
  projectCode: string;
  goals: Array<{
    certificationType: string;
    goalPercent: number;
    actualPercent: number;
    actualDollars: number;
    committedDollars: number;
    contractAmount: number;
    riskScore: number; // 0-100, higher = more risk of missing the goal
    riskBand: "LOW" | "MEDIUM" | "HIGH";
  }>;
  overallRiskScore: number;
  overallRiskBand: "LOW" | "MEDIUM" | "HIGH";
  aiCommentary: string | null;
  aiRecommendations: string[];
  generatedAt: string;
}

export async function computeDbeRiskAssessment(
  projectId: string,
  organizationId: string,
  userId: string | null,
  opts: { withAi: boolean } = { withAi: true },
): Promise<DbeRiskAssessment | null> {
  const [project] = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, contractAmount: projects.contractAmount, gcOrganizationId: projects.gcOrganizationId })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, organizationId)))
    .limit(1);
  if (!project) return null;

  const goals = await db
    .select()
    .from(projectDbeGoals)
    .where(and(eq(projectDbeGoals.projectId, projectId), eq(projectDbeGoals.organizationId, organizationId)));
  if (goals.length === 0) return null;

  const contractAmount = Number(project.contractAmount ?? 0);

  // Sum committed and paid amounts to certified subs by certification type
  const subAgg = await db
    .select({
      crmOrgId: subcontractorContracts.subcontractorId,
      contractAmount: sql<number>`COALESCE(SUM(${subcontractorContracts.contractAmount}::numeric), 0)`.as("contractAmount"),
    })
    .from(subcontractorContracts)
    .where(and(
      eq(subcontractorContracts.projectId, projectId),
      sql`${subcontractorContracts.status} IN ('ACTIVE', 'PENDING', 'APPROVED', 'COMPLETED')`,
    ))
    .groupBy(subcontractorContracts.subcontractorId);

  const subOrgIds = subAgg.map(s => s.crmOrgId).filter((v): v is string => Boolean(v));

  const paidAgg = subOrgIds.length === 0 ? [] : await db
    .select({
      crmOrgId: subcontractorContracts.subcontractorId,
      paid: sql<number>`COALESCE(SUM(${subcontractorPayments.amount}::numeric), 0)`.as("paid"),
    })
    .from(subcontractorPayments)
    .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
    .where(eq(subcontractorContracts.projectId, projectId))
    .groupBy(subcontractorContracts.subcontractorId);

  const paidByOrg = new Map(paidAgg.map(p => [p.crmOrgId, Number(p.paid || 0)]));
  const committedByOrg = new Map(subAgg.map(s => [s.crmOrgId, Number(s.contractAmount || 0)]));

  const certs = subOrgIds.length === 0 ? [] : await db
    .select({
      crmOrgId: crmOrganisationCertifications.crmOrganisationId,
      certificationType: crmOrganisationCertifications.certificationType,
      expirationDate: crmOrganisationCertifications.expirationDate,
    })
    .from(crmOrganisationCertifications)
    .where(eq(crmOrganisationCertifications.organizationId, organizationId));

  const today = new Date().toISOString().slice(0, 10);
  const certsByOrg = new Map<string, Set<string>>();
  for (const c of certs) {
    if (!subOrgIds.includes(c.crmOrgId)) continue;
    if (c.expirationDate && c.expirationDate < today) continue;
    if (!certsByOrg.has(c.crmOrgId)) certsByOrg.set(c.crmOrgId, new Set());
    certsByOrg.get(c.crmOrgId)!.add(c.certificationType as string);
  }

  const goalRows = goals.map(g => {
    let actualDollars = 0;
    let committedDollars = 0;
    for (const orgId of subOrgIds) {
      if (certsByOrg.get(orgId)?.has(g.certificationType as string)) {
        actualDollars += paidByOrg.get(orgId) || 0;
        committedDollars += committedByOrg.get(orgId) || 0;
      }
    }
    const goalPercent = Number(g.goalPercent || 0);
    const actualPercent = contractAmount > 0 ? (actualDollars / contractAmount) * 100 : 0;
    const committedPercent = contractAmount > 0 ? (committedDollars / contractAmount) * 100 : 0;
    // Risk = how short of the goal we are, weighted by commitment vs paid
    const shortfall = Math.max(0, goalPercent - committedPercent);
    const riskScore = Math.min(100, Math.round((shortfall / Math.max(goalPercent, 0.01)) * 100));
    const riskBand: "LOW" | "MEDIUM" | "HIGH" = riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW";
    return {
      certificationType: g.certificationType as string,
      goalPercent,
      actualPercent: Math.round(actualPercent * 100) / 100,
      actualDollars: Math.round(actualDollars * 100) / 100,
      committedDollars: Math.round(committedDollars * 100) / 100,
      contractAmount,
      riskScore,
      riskBand,
    };
  });

  const overallRiskScore = goalRows.length === 0
    ? 0
    : Math.round(goalRows.reduce((s, g) => s + g.riskScore, 0) / goalRows.length);
  const overallRiskBand: "LOW" | "MEDIUM" | "HIGH" = overallRiskScore >= 60 ? "HIGH" : overallRiskScore >= 30 ? "MEDIUM" : "LOW";

  let aiCommentary: string | null = null;
  let aiRecommendations: string[] = [];

  if (opts.withAi) {
    try {
      const govResult = await governedAiCall<string | null>({
        orgId: organizationId,
        userId,
        actionType: "heavy_civil.dbe.risk_score",
        inputRefs: { projectId, projectCode: project.code },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId: organizationId,
            featureKey: "heavy_civil.dbe.risk_score",
            request: {
              messages: [
                {
                  role: "system",
                  content: `You analyze DBE participation risk on a federally-funded construction project. Output strict JSON: { "commentary": "string (2-3 sentences)", "recommendations": ["string", ...] (1-5 specific actions to close shortfalls) }. Recommend mining the firm's existing CRM directory of certified subs/vendors before sourcing new ones. Never claim certification on behalf of any specific firm.`,
                },
                {
                  role: "user",
                  content: `Project ${project.code} — ${project.name}\nContract: $${contractAmount.toLocaleString()}\n\n${goalRows.map(g => `${g.certificationType}: goal ${g.goalPercent}%, committed $${g.committedDollars.toLocaleString()} (${(contractAmount > 0 ? (g.committedDollars / contractAmount) * 100 : 0).toFixed(2)}%), paid $${g.actualDollars.toLocaleString()} (${g.actualPercent.toFixed(2)}%) — risk ${g.riskScore}/100 (${g.riskBand})`).join("\n")}`,
                },
              ],
              max_completion_tokens: 600,
              response_format: { type: "json_object" },
            },
          });
          return { result: completion.choices[0]?.message?.content ?? null, completion };
        },
      });
      if (!govResult.blocked) {
        const parsed = safeJson<{ commentary?: string; recommendations?: string[] }>(govResult.result);
        if (parsed) {
          aiCommentary = parsed.commentary ?? null;
          aiRecommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5) : [];
        }
      }
    } catch (err) {
      logWarn("DBE AI commentary failed (non-fatal)", { error: String(err) });
    }
  }

  const snapshot: DbeRiskAssessment = {
    projectId,
    projectCode: project.code,
    goals: goalRows,
    overallRiskScore,
    overallRiskBand,
    aiCommentary,
    aiRecommendations,
    generatedAt: new Date().toISOString(),
  };
  recordDbeRiskSnapshot(organizationId, projectId, snapshot);
  return snapshot;
}

// Read the most recent persisted DBE risk snapshot for a project — used by
// dashboard at-risk tiles so the UI does not have to recompute on every load.
router.get(
  "/ai-features/heavy-civil/dbe/risk-snapshot/:projectId",
  requireAuth,
  requireOrgFeatureFlag("DBE_TRACKING"),
  requireFeaturePermission("canViewDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    if (!req.user?.organizationId) return res.status(403).json({ error: "Organization required" });
    const snap = getDbeRiskSnapshot(req.user.organizationId, req.params.projectId);
    if (!snap) return res.status(404).json({ error: "No snapshot yet — run risk score first" });
    res.json(snap);
  },
);

router.get(
  "/ai-features/heavy-civil/dbe/risk-snapshots",
  requireAuth,
  requireOrgFeatureFlag("DBE_TRACKING"),
  requireFeaturePermission("canViewDbeGoals"),
  async (req: AuthRequest, res: Response) => {
    if (!req.user?.organizationId) return res.status(403).json({ error: "Organization required" });
    res.json(listDbeRiskSnapshots(req.user.organizationId));
  },
);

const dbeRiskRequestSchema = z.object({ projectId: z.string().min(1) });

router.post(
  "/ai-features/heavy-civil/dbe/risk-score",
  requireAuth,
  requireOrgFeatureFlag("DBE_TRACKING"),
  requireFeaturePermission("canViewDbeGoals"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = validateBody(dbeRiskRequestSchema, req.body, res);
      if (!data) return;
      if (!req.user?.organizationId) return res.status(403).json({ error: "Organization required" });
      const result = await computeDbeRiskAssessment(data.projectId, req.user.organizationId, req.user.id, { withAi: true });
      if (!result) return res.status(404).json({ error: "Project has no DBE goals or is not in your organization" });
      res.json(result);
    } catch (error) {
      logError("DBE risk score failed", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "DBE risk score failed", fallback: true });
    }
  },
);

// =====================================================================
// FEATURE 6 — MASS-HAUL OPTIMIZER (MASS_HAUL_ANALYZER)
// Take a project's haul-ticket history and propose source/dest balancing.
// =====================================================================
const massHaulSchema = z.object({
  projectId: z.string().min(1),
  cutFillSummary: z.string().optional(),
});

router.post(
  "/ai-features/heavy-civil/mass-haul/analyze",
  requireAuth,
  requireOrgFeatureFlag("MASS_HAUL_ANALYZER"),
  requireFeaturePermission("canViewHaulTickets"),
  sensitiveLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = validateBody(massHaulSchema, req.body, res);
      if (!data) return;

      const orgId = req.user!.organizationId!;

      // Aggregate ticket movement by source/destination/material
      const movements = await db
        .select({
          source: haulTickets.source,
          destination: haulTickets.destination,
          materialClass: haulTickets.materialClass,
          unit: haulTickets.unit,
          totalQty: sql<number>`COALESCE(SUM(${haulTickets.quantity}::numeric), 0)`.as("totalQty"),
          totalCost: sql<number>`COALESCE(SUM(${haulTickets.totalCost}::numeric), 0)`.as("totalCost"),
          tickets: sql<number>`COUNT(*)`.as("tickets"),
        })
        .from(haulTickets)
        .where(and(
          eq(haulTickets.projectId, data.projectId),
          eq(haulTickets.organizationId, orgId),
          sql`${haulTickets.status} IN ('SUBMITTED', 'APPROVED')`,
        ))
        .groupBy(haulTickets.source, haulTickets.destination, haulTickets.materialClass, haulTickets.unit)
        .limit(200);

      if (movements.length === 0) {
        return res.json({ movements: [], analysis: null, message: "No haul-ticket data yet for this project." });
      }

      const summaryLines = movements.slice(0, 100).map(m =>
        `${m.materialClass}: ${m.source ?? "?"} → ${m.destination ?? "?"} = ${Number(m.totalQty).toLocaleString()} ${m.unit} across ${m.tickets} tickets ($${Number(m.totalCost).toLocaleString()})`
      ).join("\n");

      const govResult = await governedAiCall<string | null>({
        orgId,
        userId: req.user!.id,
        actionType: "heavy_civil.mass_haul.analyze",
        inputRefs: { projectId: data.projectId, movementCount: movements.length },
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId,
            featureKey: "heavy_civil.mass_haul.analyze",
            request: {
              messages: [
                {
                  role: "system",
                  content: `You are a heavy-civil earthwork analyst. Given haul-ticket movements (and optional cut/fill summary), suggest mass-haul optimizations: balance points, free-haul vs over-haul splits, and re-routing opportunities to cut cost or trips. Output strict JSON: { "summary": "string (2-4 sentences)", "imbalances": [{ "material": "string", "issue": "string", "estimatedSavings": "string|null" }], "recommendations": ["string"], "confidence": number (0-100) }. Use only the data given — never invent volumes or distances.`,
                },
                {
                  role: "user",
                  content: `${data.cutFillSummary ? `Cut/fill summary:\n${data.cutFillSummary}\n\n` : ""}Haul movement totals:\n${summaryLines}`,
                },
              ],
              max_completion_tokens: 1200,
              response_format: { type: "json_object" },
            },
          });
          return { result: completion.choices[0]?.message?.content ?? null, completion };
        },
      });

      if (govResult.blocked) return blockedResponse(res, govResult.reason);
      const parsed = safeJson<Record<string, unknown>>(govResult.result);
      if (!parsed) return fallbackResponse(res, "Mass-haul analysis unavailable. Review tickets manually.");
      res.json({ movements, analysis: parsed });
    } catch (error) {
      logError("Mass-haul analyze failed", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Mass-haul analyze failed", fallback: true });
    }
  },
);

export default router;
