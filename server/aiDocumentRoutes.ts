import { Router, type Response, NextFunction } from "express";
import { db } from "./db";
import { 
  aiBidDocumentAnalysis, 
  aiContractDocumentAnalysis,
  aiInsights, aiGanttRecommendations, aiVendorComparisons,
  bids, 
  projects,
  organizations,
  masterSowItems,
  organizationSowItems,
  unitsOfMeasure,
  scopeItems, estimateLineItems, estimates, changeOrders,
  projectDelays, dailyScopeProgress, projectSchedules, projectScheduleTasks,
  crewMembers, crewProjectAssignments,
  insertAIBidDocumentAnalysisSchema,
  type AIBidDocumentAnalysis,
  type MasterSowItem,
  type OrganizationSowItem,
  type UnitOfMeasure,
} from "@shared/schema";
import { eq, desc, and, sql, ilike, or, inArray } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import { requireAuth, requireRole, requireAnyFeaturePermission, getEffectivePermissions, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { extractDocumentContent } from "./ai/documentExtractor";
import { governedAiCall } from "./services/aiGovernance";
import { ObjectStorageService } from "./objectStorage";
import { aiNotesService } from "./aiNotesService";
import { parsePagination, getUserOrThrow } from "./utils/routeHelpers";
import {logInfo, logError, logWarn } from "./utils/logger";
import { sensitiveLimiter } from "./rateLimiter";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { 
  discoverTradesFromDescription, 
  suggestTradesForBidDocument,
  getTradesWithSowCounts,
  getTradeModifierCategories,
  TRADE_CATEGORIES,
  ALL_TRADES
} from "./ai/tradeDiscoveryService";
import {
  predictRelevantScopeItems,
  searchScopeItems,
  getScopeItemsForTrade,
  suggestScopeFromBidDocument,
  getModifiersForScopeItem
} from "./ai/scopePredictionEngine";

const router = Router();

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: crewProjectAssignments.projectId })
    .from(crewMembers)
    .innerJoin(crewProjectAssignments, eq(crewMembers.crewId, crewProjectAssignments.crewId))
    .where(eq(crewMembers.userId, userId));
  return [...new Set(rows.map(r => r.projectId))];
}

async function isViewOnlyAiUser(user: AuthRequest['user']): Promise<boolean> {
  const effectiveRole = user.effectiveRole || user.role;
  const effective = await getEffectivePermissions(user.id, user.organizationId ?? null, effectiveRole);
  return !!effective.canViewAiSummaries && !effective.canUseAiFeatures;
}

// ========================================
// Routes from aiBidDocumentRoutes.ts
// ========================================

const BID_DOCUMENT_ANALYSIS_SYSTEM_PROMPT = `You are an expert construction estimator AI assistant specialized in analyzing bid invitation documents and construction project scopes.

Your task is to extract key information from bid documents (RFPs, ITBs, scope documents) and provide structured analysis to help construction contractors evaluate and respond to bid opportunities.

For each document, extract:
1. **Project Information**: Name, location, client/GC name, bid due date
2. **Scope of Work**: Detailed description of work required
3. **Line Items**: Specific work items with quantities and units if available
4. **Requirements**: Special requirements, qualifications, certifications needed
5. **Insurance/Bonding**: Insurance and bonding requirements
6. **Risk Factors**: Potential risks or concerns with the project
7. **Pricing Considerations**: Factors that should influence pricing

Be thorough and accurate. If information is not available in the document, indicate "Not specified" rather than guessing.

Respond with valid JSON matching the required structure.`;

interface BidDocumentAnalysisResult {
  projectName: string | null;
  clientName: string | null;
  bidDueDate: string | null;
  projectLocation: string | null;
  projectScope: string | null;
  scopeSummary: string | null;
  lineItems: Array<{
    description: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
  }>;
  requirements: string[];
  qualifications: string[];
  insuranceRequirements: string | null;
  bondingRequirements: string | null;
  suggestedPricingFactors: Array<{
    factor: string;
    impact: "HIGH" | "MEDIUM" | "LOW";
    notes: string;
  }>;
  riskFactors: Array<{
    risk: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    mitigation: string | null;
  }>;
  confidenceScore: number;
}

async function analyzeDocumentWithAI(documentUrl: string, documentName: string, tradeType?: string, governanceOpts?: { userId: string | null; orgId: string }): Promise<BidDocumentAnalysisResult> {
  const tradeContext = tradeType ? `The contractor specializes in ${tradeType} work. Focus on extracting scope items relevant to this trade.` : "";
  
  const userPrompt = `Analyze this bid/scope document and extract all relevant information.

${tradeContext}

Document Name: ${documentName}

Respond with JSON in this format:
{
  "projectName": "Project name or null if not found",
  "clientName": "Client/GC name or null",
  "bidDueDate": "ISO date string or null",
  "projectLocation": "Full address or location description or null",
  "projectScope": "Full detailed scope description",
  "scopeSummary": "2-3 sentence summary of the scope",
  "lineItems": [
    {
      "description": "Line item description",
      "quantity": 100,
      "unit": "SF",
      "notes": "Any relevant notes"
    }
  ],
  "requirements": ["Requirement 1", "Requirement 2"],
  "qualifications": ["Required certification or qualification"],
  "insuranceRequirements": "Insurance requirements text or null",
  "bondingRequirements": "Bonding requirements text or null",
  "suggestedPricingFactors": [
    {
      "factor": "Factor description",
      "impact": "HIGH",
      "notes": "Why this matters"
    }
  ],
  "riskFactors": [
    {
      "risk": "Risk description",
      "severity": "MEDIUM",
      "mitigation": "How to mitigate"
    }
  ],
  "confidenceScore": 85
}`;

  try {
    const documentContent = await extractDocumentContent(documentUrl);
    
    let messages: any[] = [
      { role: 'system', content: BID_DOCUMENT_ANALYSIS_SYSTEM_PROMPT },
    ];

    if (documentContent.length > 0) {
      const hasImages = documentContent.some(c => c.type === 'image_url');
      const textBlocks = documentContent.filter(c => c.type === 'text');
      const imageBlocks = documentContent.filter(c => c.type === 'image_url');

      if (hasImages) {
        const extraText = textBlocks.map(t => (t as {type: 'text', text: string}).text).join('\n\n');
        const promptWithText = extraText
          ? `${userPrompt}\n\nAdditional extracted text:\n${extraText}`
          : userPrompt;
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: promptWithText },
            ...imageBlocks,
          ]
        });
      } else {
        const extractedText = textBlocks.map(t => (t as {type: 'text', text: string}).text).join('\n\n');
        messages.push({
          role: 'user',
          content: `${userPrompt}\n\nExtracted document text:\n${extractedText}`
        });
      }
    } else {
      messages.push({
        role: 'user',
        content: `${userPrompt}\n\nNote: The document could not be visually rendered or text extracted. Analyze based on the document name and any available context.`
      });
    }

    if (governanceOpts) {
      const governed = await governedAiCall({
        orgId: governanceOpts.orgId,
        userId: governanceOpts.userId,
        actionType: "bid_document_analysis",
        inputRefs: { documentName, documentUrl },
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages,
            response_format: { type: 'json_object' },
            max_completion_tokens: 4096,
          });
          const content = completion.choices[0]?.message?.content;
          if (!content) throw new Error('No response from OpenAI');
          return { result: JSON.parse(content) as BidDocumentAnalysisResult, completion };
        },
      });
      if (governed.blocked) {
        throw new Error(`AI_GOVERNANCE_BLOCKED:${governed.reason}`);
      }
      return governed.result;
    }

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT5,
      messages,
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return parsed as BidDocumentAnalysisResult;
  } catch (error) {
    logError("AI document analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
    return {
      projectName: null,
      clientName: null,
      bidDueDate: null,
      projectLocation: null,
      projectScope: `Document analysis pending for: ${documentName}`,
      scopeSummary: "Unable to analyze document automatically. Please review manually.",
      lineItems: [],
      requirements: [],
      qualifications: [],
      insuranceRequirements: null,
      bondingRequirements: null,
      suggestedPricingFactors: [],
      riskFactors: [{
        risk: "Document could not be analyzed automatically",
        severity: "LOW",
        mitigation: "Manual review recommended"
      }],
      confidenceScore: 0
    };
  }
}

function safeJsonParse(value: string | null | undefined, defaultValue: any[] = []): any {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    logWarn("Non-critical operation failed");
    return defaultValue;
  }
}

function parseAnalysis(analysis: any) {
  return {
    ...analysis,
    lineItems: safeJsonParse(analysis.lineItems, []),
    requirements: safeJsonParse(analysis.requirements, []),
    qualifications: safeJsonParse(analysis.qualifications, []),
    suggestedPricingFactors: safeJsonParse(analysis.suggestedPricingFactors, []),
    riskFactors: safeJsonParse(analysis.riskFactors, []),
  };
}

// Get list of bids for AI analysis dropdown
router.get("/ai-bid-document/bids", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select({
        id: bids.id,
        code: bids.code,
        name: bids.name,
        clientName: bids.clientName,
        status: bids.status,
        dueDate: bids.dueDate,
      })
      .from(bids)
      .orderBy(desc(bids.createdAt));

    if (shouldFilter && orgId) {
      query = query.where(eq(bids.gcOrganizationId, orgId)) as typeof query;
    }

    const bidsList = await query;
    res.json(bidsList);
  } catch (error) {
    next(error);
  }
});

// Main endpoint for frontend - GET /api/ai-bid-document
router.get("/ai-bid-document", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    const archived = req.query.archived === "true";
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const conditions = [eq(aiBidDocumentAnalysis.isArchived, archived)];
    
    if (shouldFilter && orgId) {
      conditions.push(eq(aiBidDocumentAnalysis.organizationId, orgId));
    }

    const analyses = await db
      .select({
        id: aiBidDocumentAnalysis.id,
        bidId: aiBidDocumentAnalysis.bidId,
        fileName: aiBidDocumentAnalysis.documentName,
        fileUrl: aiBidDocumentAnalysis.documentUrl,
        analysisStatus: aiBidDocumentAnalysis.status,
        analysisResult: aiBidDocumentAnalysis.rawAiResponse,
        createdAt: aiBidDocumentAnalysis.createdAt,
        analyzedAt: aiBidDocumentAnalysis.analyzedAt,
        confidenceScore: aiBidDocumentAnalysis.confidenceScore,
        projectName: aiBidDocumentAnalysis.projectName,
        clientName: aiBidDocumentAnalysis.clientName,
        scopeSummary: aiBidDocumentAnalysis.scopeSummary,
        isArchived: aiBidDocumentAnalysis.isArchived,
        archivedAt: aiBidDocumentAnalysis.archivedAt,
      })
      .from(aiBidDocumentAnalysis)
      .where(and(...conditions))
      .orderBy(desc(aiBidDocumentAnalysis.createdAt))
      .limit(100);
    
    // Enrich with bid info
    const enrichedAnalyses = await Promise.all(analyses.map(async (analysis) => {
      if (analysis.bidId) {
        const [bid] = await db.select({ code: bids.code, name: bids.name })
          .from(bids)
          .where(eq(bids.id, analysis.bidId))
          .limit(1);
        return {
          ...analysis,
          bidCode: bid?.code || '',
          bidName: bid?.name || '',
        };
      }
      return { ...analysis, bidCode: '', bidName: '' };
    }));
    
    res.json(enrichedAnalyses);
  } catch (error) {
    next(error);
  }
});

// POST /api/ai-bid-document/analyze - Create new analysis (frontend endpoint)
router.post("/ai-bid-document/analyze", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { bidId, fileUrl, fileName } = req.body;

    if (!bidId || !fileUrl || !fileName) {
      return res.status(400).json({ error: "bidId, fileUrl, and fileName are required" });
    }

    const targetOrgId = orgId;
    
    if (!targetOrgId) {
      return res.status(400).json({ error: "Organization ID is required" });
    }

    const [bid] = await db
      .select()
      .from(bids)
      .where(eq(bids.id, bidId))
      .limit(1);

    if (!bid) {
      return res.status(404).json({ error: "Bid not found" });
    }

    if (shouldFilter && bid.gcOrganizationId !== targetOrgId) {
      return res.status(403).json({ error: "Cannot analyze document for another organization's bid" });
    }

    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, bid.gcOrganizationId || targetOrgId))
      .limit(1);

    const [newAnalysis] = await db
      .insert(aiBidDocumentAnalysis)
      .values({
        bidId: bidId,
        organizationId: bid.gcOrganizationId || targetOrgId,
        documentUrl: fileUrl,
        documentName: fileName,
        documentType: "PDF",
        status: "PROCESSING",
        analyzedById: req.user?.id,
      })
      .returning();

    res.status(201).json({ id: newAnalysis.id, status: "PROCESSING" });

    // Background AI analysis
    (async () => {
      try {
        const result = await analyzeDocumentWithAI(fileUrl, fileName, org?.tradeType || undefined, { userId: req.user?.id || null, orgId: targetOrgId });
        
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
          .where(eq(aiBidDocumentAnalysis.id, newAnalysis.id));

        console.log(`AI bid document analysis completed for: ${fileName}`);
      } catch (error) {
        logError("Background AI analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiBidDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiBidDocumentAnalysis.id, newAnalysis.id));
      }
    })();

  } catch (error) {
    next(error);
  }
});

// POST /api/ai-bid-document/:id/reanalyze - Reanalyze (frontend endpoint)
router.post("/ai-bid-document/:id/reanalyze", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(aiBidDocumentAnalysis)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(aiBidDocumentAnalysis.id, id));

    res.json({ id, status: "PROCESSING" });

    // Background reanalysis
    (async () => {
      try {
        const [org] = await db
          .select({ tradeType: organizations.tradeType })
          .from(organizations)
          .where(eq(organizations.id, existing.organizationId))
          .limit(1);

        const result = await analyzeDocumentWithAI(existing.documentUrl, existing.documentName, org?.tradeType || undefined, { userId: req.user?.id || null, orgId: existing.organizationId });
        
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
          .where(eq(aiBidDocumentAnalysis.id, id));

        console.log(`AI bid document reanalysis completed for: ${existing.documentName}`);
      } catch (error) {
        logError("Background AI reanalysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiBidDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiBidDocumentAnalysis.id, id));
      }
    })();

  } catch (error) {
    next(error);
  }
});

// PATCH /api/ai-bid-document/:id/archive - Soft delete (archive) an analysis
router.patch("/ai-bid-document/:id/archive", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(aiBidDocumentAnalysis)
      .set({ 
        isArchived: true, 
        archivedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(aiBidDocumentAnalysis.id, id));

    res.json({ success: true, message: "Analysis archived successfully" });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/ai-bid-document/:id/restore - Restore an archived analysis
router.patch("/ai-bid-document/:id/restore", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(aiBidDocumentAnalysis)
      .set({ 
        isArchived: false, 
        archivedAt: null,
        updatedAt: new Date() 
      })
      .where(eq(aiBidDocumentAnalysis.id, id));

    res.json({ success: true, message: "Analysis restored successfully" });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/ai-bid-document/:id - Hard delete (permanent) an analysis
router.delete("/ai-bid-document/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .delete(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id));

    res.json({ success: true, message: "Analysis permanently deleted" });
  } catch (error) {
    next(error);
  }
});

router.get("/ai/bid-document-analysis", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select()
      .from(aiBidDocumentAnalysis)
      .orderBy(desc(aiBidDocumentAnalysis.createdAt))
      .limit(100);

    if (shouldFilter && orgId) {
      query = query.where(eq(aiBidDocumentAnalysis.organizationId, orgId)) as typeof query;
    }

    const analyses = await query;
    res.json(analyses.map(parseAnalysis));
  } catch (error) {
    next(error);
  }
});

router.get("/ai/bid-document-analysis/bid/:bidId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bidId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const [bid] = await db
      .select()
      .from(bids)
      .where(eq(bids.id, bidId))
      .limit(1);

    if (!bid) {
      return res.status(404).json({ error: "Bid not found" });
    }

    if (shouldFilter && orgId && bid.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const analyses = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.bidId, bidId))
      .orderBy(desc(aiBidDocumentAnalysis.createdAt))
      .limit(50);

    res.json(analyses.map(parseAnalysis));
  } catch (error) {
    next(error);
  }
});

router.get("/ai/bid-document-analysis/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const [analysis] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && analysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(parseAnalysis(analysis));
  } catch (error) {
    next(error);
  }
});

const documentUrlValidator = z.string().refine(
  (val) => val.startsWith("/objects/") || z.string().url().safeParse(val).success,
  { message: "Must be a valid URL or object storage path" }
);

const createAnalysisSchema = z.object({
  bidId: z.string().optional(),
  documentUrl: documentUrlValidator,
  documentName: z.string(),
  documentType: z.string().optional(),
});

const createAnalysisSchemaExtended = z.object({
  bidId: z.string().optional(),
  organizationId: z.string().optional(),
  documentUrl: documentUrlValidator,
  documentName: z.string(),
  documentType: z.string().optional(),
});

router.post("/ai/bid-document-analysis", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = createAnalysisSchemaExtended.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { bidId, documentUrl, documentName, documentType, organizationId: requestedOrgId } = validationResult.data;

    const targetOrgId = shouldFilter ? orgId! : (requestedOrgId || orgId);
    
    if (!targetOrgId) {
      return res.status(400).json({ error: "Organization ID is required" });
    }

    if (bidId) {
      const [bid] = await db
        .select()
        .from(bids)
        .where(eq(bids.id, bidId))
        .limit(1);

      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (bid.gcOrganizationId !== targetOrgId) {
        return res.status(403).json({ error: "Cannot analyze document for another organization's bid" });
      }
    }

    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, targetOrgId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [newAnalysis] = await db
      .insert(aiBidDocumentAnalysis)
      .values({
        bidId: bidId || null,
        organizationId: targetOrgId,
        documentUrl,
        documentName,
        documentType: documentType || "PDF",
        status: "PROCESSING",
        analyzedById: req.user?.id,
      })
      .returning();

    res.status(201).json(parseAnalysis(newAnalysis));

    (async () => {
      try {
        const result = await analyzeDocumentWithAI(documentUrl, documentName, org?.tradeType || undefined);
        
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
          .where(eq(aiBidDocumentAnalysis.id, newAnalysis.id));

        console.log(`AI bid document analysis completed for: ${documentName}`);
      } catch (error) {
        logError("Background AI analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiBidDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiBidDocumentAnalysis.id, newAnalysis.id));
      }
    })();

  } catch (error) {
    next(error);
  }
});

router.post("/ai/bid-document-analysis/:id/reanalyze", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existingAnalysis] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!existingAnalysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && existingAnalysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(aiBidDocumentAnalysis)
      .set({
        status: "PROCESSING",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(aiBidDocumentAnalysis.id, id));

    res.json({ message: "Re-analysis started", id });

    (async () => {
      try {
        const [org] = await db
          .select({ tradeType: organizations.tradeType })
          .from(organizations)
          .where(eq(organizations.id, existingAnalysis.organizationId))
          .limit(1);

        const result = await analyzeDocumentWithAI(
          existingAnalysis.documentUrl, 
          existingAnalysis.documentName,
          org?.tradeType || undefined
        );
        
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
          .where(eq(aiBidDocumentAnalysis.id, id));

        console.log(`AI bid document re-analysis completed for: ${existingAnalysis.documentName}`);
      } catch (error) {
        logError("Background AI re-analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiBidDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiBidDocumentAnalysis.id, id));
      }
    })();

  } catch (error) {
    next(error);
  }
});

router.delete("/ai/bid-document-analysis/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const [existingAnalysis] = await db
      .select()
      .from(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id))
      .limit(1);

    if (!existingAnalysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && existingAnalysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .delete(aiBidDocumentAnalysis)
      .where(eq(aiBidDocumentAnalysis.id, id));

    res.json({ success: true, message: "Analysis deleted" });
  } catch (error) {
    next(error);
  }
});

// AI Bid Wizard - Analyze multiple documents for new bid creation
const wizardAnalyzeSchema = z.object({
  documents: z.array(z.object({
    url: documentUrlValidator,
    name: z.string(),
  })).min(1, "At least one document is required"),
});

const BID_WIZARD_SYSTEM_PROMPT = `You are an expert construction estimator AI assistant. You are analyzing actual bid invitation documents, construction drawings, and specifications that have been uploaded as images.

Your task is to carefully read the document content shown in the images and extract structured project information and scope of work items for a construction bid.

IMPORTANT INSTRUCTIONS:
- Read ALL text visible in the document images carefully
- Extract REAL information from the documents - do NOT guess or make up data
- If a field is not found in the documents, return null for that field
- For scope items, only use these categories: CONCRETE, EXCAVATION, PAVERS, BOLLARDS, GC, OVERHEAD, PROFIT, GENERAL
- Extract quantities and units accurately from the documents
- Parse dates in YYYY-MM-DD format
- For estimatedValue, provide a numeric value (no currency symbols or text)

Respond with valid JSON matching the required structure.`;

function isValidObjectStorageUrl(url: string): boolean {
  if (url.startsWith("/objects/")) {
    return true;
  }
  try {
    const parsedUrl = new URL(url);
    const allowedHosts = [
      'storage.googleapis.com',
      'storage.cloud.google.com',
      'replit.com',
      'repl.co',
    ];
    return allowedHosts.some(host => parsedUrl.hostname.endsWith(host));
  } catch {
    logWarn("Non-critical operation failed");
    return false;
  }
}

router.post("/ai-bid-wizard/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = wizardAnalyzeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid request", details: validationResult.error.issues });
    }

    const { documents } = validationResult.data;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (shouldFilter && !orgId) {
      return res.status(403).json({ error: "Organization context required" });
    }

    const invalidUrls = documents.filter(doc => !isValidObjectStorageUrl(doc.url));
    if (invalidUrls.length > 0) {
      return res.status(400).json({ 
        error: "Invalid document URLs", 
        details: "Documents must be from organization storage" 
      });
    }

    let tradeType: string | undefined;
    if (orgId) {
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      tradeType = org?.tradeType || undefined;
    }

    console.log(`[AI Bid Wizard] Analyzing ${documents.length} documents for org:${orgId}`);

    const allDocumentContent: Array<{type: 'image_url', image_url: {url: string, detail: string}} | {type: 'text', text: string}> = [];
    for (const doc of documents) {
      try {
        const content = await extractDocumentContent(doc.url);
        allDocumentContent.push(...content);
      } catch (extractError) {
        logError(`[AI Bid Wizard] Failed to extract content from ${doc.name}:`, {}, extractError instanceof Error ? extractError : new Error(String(extractError)));
      }
    }

    const imageCount = allDocumentContent.filter(c => c.type === 'image_url').length;
    const textCount = allDocumentContent.filter(c => c.type === 'text').length;
    console.log(`[AI Bid Wizard] Extracted ${imageCount} page images and ${textCount} text blocks from ${documents.length} documents`);

    const tradeContext = tradeType ? `The contractor specializes in ${tradeType} work. Focus on extracting scope items relevant to this trade.` : "";
    const documentNames = documents.map(d => `- ${d.name}`).join('\n');

    const userPrompt = `Analyze these bid documents and extract project information and scope of work items.

${tradeContext}

Document names:
${documentNames}

Extract and respond with JSON in this exact format:
{
  "projectName": "Extracted project name or null",
  "clientName": "Client/GC/Owner company name or null",
  "clientContactName": "Contact person name or null",
  "clientContactEmail": "Contact email or null",
  "clientContactPhone": "Contact phone or null",
  "dueDate": "YYYY-MM-DD format or null",
  "locationAddress": "Street address or null",
  "city": "City name or null",
  "state": "Two-letter state abbreviation or null",
  "description": "Project description/overview or null",
  "estimatedValue": null,
  "scopeItems": [
    {
      "description": "Specific scope item description",
      "quantity": 100,
      "unit": "SF",
      "category": "CONCRETE",
      "notes": "Any relevant notes"
    }
  ],
  "keyRequirements": ["Requirement 1", "Requirement 2"],
  "specialConditions": ["Condition 1", "Condition 2"],
  "insuranceRequirements": "Insurance requirements text or null",
  "bondingRequirements": "Bonding requirements text or null"
}

CATEGORY VALUES (use only these): CONCRETE, EXCAVATION, PAVERS, BOLLARDS, GC, OVERHEAD, PROFIT, GENERAL

Be thorough in extracting scope items. Include quantities and units when available. If estimatedValue is mentioned or can be inferred from the documents, provide it as a number (no currency symbols).`;

    try {
      let messages: any[] = [
        { role: 'system', content: BID_WIZARD_SYSTEM_PROMPT },
      ];

      if (allDocumentContent.length > 0) {
        const hasImages = allDocumentContent.some(c => c.type === 'image_url');
        const textBlocks = allDocumentContent.filter(c => c.type === 'text');
        const imageBlocks = allDocumentContent.filter(c => c.type === 'image_url');

        if (hasImages) {
          const extraText = textBlocks.map(t => (t as {type: 'text', text: string}).text).join('\n\n');
          const promptWithText = extraText
            ? `${userPrompt}\n\nAdditional extracted text from documents:\n${extraText}`
            : userPrompt;
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: promptWithText },
              ...imageBlocks,
            ]
          });
        } else {
          const extractedText = textBlocks.map(t => (t as {type: 'text', text: string}).text).join('\n\n');
          messages.push({
            role: 'user',
            content: `${userPrompt}\n\nExtracted document text:\n${extractedText}`
          });
        }
      } else {
        messages.push({
          role: 'user',
          content: `${userPrompt}\n\nNote: The documents could not be visually rendered or text extracted. Analyze based on the document names and any available context.`
        });
      }

      const governed = await governedAiCall({
        orgId: orgId || "",
        userId: req.user?.id || null,
        actionType: "bid_document_reanalysis",
        inputRefs: { documentCount: documents.length, documentNames: documents.map((d: any) => d.name) },
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages,
            max_completion_tokens: 4096,
            response_format: { type: "json_object" },
          });
          const content = completion.choices[0]?.message?.content;
          if (!content) {
            throw new Error('No response from AI');
          }
          return { result: JSON.parse(content), completion };
        },
      });

      if (governed.blocked) {
        return res.status(429).json({ error: "AI rate limit exceeded", reason: governed.reason });
      }

      const result = governed.result;
      
      console.log(`[AI Bid Wizard] Extracted ${result.scopeItems?.length || 0} scope items`);
      
      res.json(result);
    } catch (aiError) {
      logError('[AI Bid Wizard] AI analysis error', {}, aiError instanceof Error ? aiError : new Error(String(aiError)));
      
      return res.status(200).json({
        projectName: null,
        clientName: null,
        clientContactName: null,
        clientContactEmail: null,
        clientContactPhone: null,
        dueDate: null,
        locationAddress: null,
        city: null,
        state: null,
        description: null,
        estimatedValue: null,
        scopeItems: [],
        keyRequirements: [],
        specialConditions: [],
        insuranceRequirements: null,
        bondingRequirements: null,
        aiError: true,
        message: "AI analysis could not complete. Please enter information manually.",
      });
    }
  } catch (error) {
    next(error);
  }
});

router.post("/ai-bid-wizard/analyze-text", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return res.status(400).json({ error: "Please provide a project description of at least 10 characters." });
    }

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (shouldFilter && !orgId) {
      return res.status(403).json({ error: "Organization context required" });
    }

    let tradeType: string | undefined;
    if (orgId) {
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      tradeType = org?.tradeType || undefined;
    }

    console.log(`[AI Bid Text Analysis] Analyzing text description for org:${orgId}`);

    const tradeContext = tradeType ? `The contractor specializes in ${tradeType} work. Focus on extracting scope items relevant to this trade.` : "";

    const systemPrompt = `You are an expert construction estimator AI assistant. You help contractors quickly create bids by analyzing project descriptions and bid invitation text.

Your task is to extract structured project information and suggest scope of work items from the provided text description.

IMPORTANT INSTRUCTIONS:
- Extract REAL information from the text - do NOT guess or make up data
- If a field is not mentioned in the text, return null for that field
- For scope items, only use these categories: CONCRETE, EXCAVATION, PAVERS, BOLLARDS, GC, OVERHEAD, PROFIT, GENERAL
- Suggest realistic scope items based on the project description even if specific quantities aren't mentioned
- Parse dates in YYYY-MM-DD format
- For estimatedValue, provide a numeric value if mentioned (no currency symbols or text)

Respond with valid JSON matching the required structure.`;

    const userPrompt = `Analyze this project description / bid invitation text and extract project information and scope of work items.

${tradeContext}

Project Description:
${description.trim()}

Extract and respond with JSON in this exact format:
{
  "projectName": "Extracted project name or null",
  "clientName": "Client/GC/Owner company name or null",
  "clientContactName": "Contact person name or null",
  "clientContactEmail": "Contact email or null",
  "clientContactPhone": "Contact phone or null",
  "dueDate": "YYYY-MM-DD format or null",
  "locationAddress": "Street address or null",
  "city": "City name or null",
  "state": "Two-letter state abbreviation or null",
  "description": "Project description/overview or null",
  "estimatedValue": null,
  "scopeItems": [
    {
      "description": "Specific scope item description",
      "quantity": 1,
      "unit": "SF",
      "category": "GENERAL",
      "notes": "Any relevant notes"
    }
  ],
  "keyRequirements": ["Requirement 1", "Requirement 2"],
  "specialConditions": ["Condition 1", "Condition 2"],
  "insuranceRequirements": "Insurance requirements text or null",
  "bondingRequirements": "Bonding requirements text or null"
}

CATEGORY VALUES (use only these): CONCRETE, EXCAVATION, PAVERS, BOLLARDS, GC, OVERHEAD, PROFIT, GENERAL

Be thorough in suggesting scope items based on the project type described. Include realistic quantities and units when possible. If estimatedValue is mentioned, provide it as a number.`;

    try {
      const governed = await governedAiCall({
        orgId: orgId || "",
        userId: req.user?.id || null,
        actionType: "bid_text_analysis",
        inputRefs: { descriptionLength: description.length },
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_completion_tokens: 4096,
            response_format: { type: "json_object" },
          });
          const content = completion.choices[0]?.message?.content;
          if (!content) {
            throw new Error('No response from AI');
          }
          return { result: JSON.parse(content), completion };
        },
      });

      if (governed.blocked) {
        return res.status(429).json({ error: "AI rate limit exceeded", reason: governed.reason });
      }

      const result = governed.result;
      console.log(`[AI Bid Text Analysis] Extracted ${result.scopeItems?.length || 0} scope items`);
      res.json(result);
    } catch (aiError) {
      logError('[AI Bid Text Analysis] AI analysis error', {}, aiError instanceof Error ? aiError : new Error(String(aiError)));

      return res.status(200).json({
        projectName: null,
        clientName: null,
        clientContactName: null,
        clientContactEmail: null,
        clientContactPhone: null,
        dueDate: null,
        locationAddress: null,
        city: null,
        state: null,
        description: null,
        estimatedValue: null,
        scopeItems: [],
        keyRequirements: [],
        specialConditions: [],
        insuranceRequirements: null,
        bondingRequirements: null,
        aiError: true,
        message: "AI analysis could not complete. Please enter information manually.",
      });
    }
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from aiContractDocumentRoutes.ts
// ========================================

interface ContractDocumentAnalysisResult {
  contractType: string | null;
  contractNumber: string | null;
  contractDate: string | null;
  effectiveDate: string | null;
  completionDate: string | null;
  ownerName: string | null;
  generalContractorName: string | null;
  subcontractorName: string | null;
  ownerAddress: string | null;
  gcAddress: string | null;
  projectName: string | null;
  projectLocation: string | null;
  contractValue: string | null;
  retainage: string | null;
  paymentTerms: string | null;
  billingSchedule: string | null;
  scopeOfWork: string | null;
  scopeSummary: string | null;
  scopeItems: Array<{ section: string; description: string; inclusions?: string[]; exclusions?: string[] }>;
  exclusions: string[];
  startDate: string | null;
  duration: string | null;
  milestones: Array<{ name: string; date?: string; description?: string }>;
  liquidatedDamages: string | null;
  insuranceRequirements: string | null;
  bondingRequirements: string | null;
  warrantyTerms: string | null;
  changeOrderProcess: string | null;
  disputeResolution: string | null;
  terminationClauses: string | null;
  indemnificationClauses: string | null;
  keyTerms: Array<{ term: string; summary: string; section?: string }>;
  riskFactors: Array<{ risk: string; severity: string; mitigation?: string; section?: string }>;
  obligations: Array<{ type: string; description: string; deadline?: string }>;
  confidenceScore: number;
}

async function analyzeContractWithAI(
  documentUrl: string,
  documentName: string,
  tradeType?: string,
  orgId?: string,
  userId?: string | null
): Promise<ContractDocumentAnalysisResult> {
  try {
    const tradeContext = tradeType ? `The analyzing organization specializes in ${tradeType.replace(/_/g, ' ').toLowerCase()} construction work.` : '';

    const systemPrompt = `You are an expert construction contract analyst AI assistant. Your task is to analyze construction contract documents (subcontracts, prime contracts, purchase orders, change orders) and extract key information.

${tradeContext}

Extract the following information from the document and return it as a JSON object:

{
  "contractType": "Type of contract (Subcontract, Prime Contract, Purchase Order, Change Order, Amendment)",
  "contractNumber": "Contract or agreement number",
  "contractDate": "Date contract was signed (ISO 8601 format or null)",
  "effectiveDate": "When contract takes effect (ISO 8601 format or null)",
  "completionDate": "Required completion date (ISO 8601 format or null)",
  
  "ownerName": "Property owner or client name",
  "generalContractorName": "GC or CM name",
  "subcontractorName": "Subcontractor name (if this is a subcontract)",
  "ownerAddress": "Owner's address",
  "gcAddress": "GC's address",
  "projectName": "Name of the project",
  "projectLocation": "Address or location of the project",
  
  "contractValue": "Total contract amount (numeric string)",
  "retainage": "Retainage percentage (numeric string)",
  "paymentTerms": "Payment terms description",
  "billingSchedule": "How often billing occurs (Monthly, Milestone-based, etc.)",
  
  "scopeOfWork": "Full detailed scope of work",
  "scopeSummary": "Brief 2-3 sentence summary of the work",
  "scopeItems": [
    {
      "section": "Section number or name",
      "description": "Work description",
      "inclusions": ["Included items"],
      "exclusions": ["Excluded items"]
    }
  ],
  "exclusions": ["List of explicit exclusions from the contract"],
  
  "startDate": "Project start date (ISO 8601 format or null)",
  "duration": "Contract duration (e.g., '90 days', '3 months')",
  "milestones": [
    {
      "name": "Milestone name",
      "date": "Target date (ISO 8601 format)",
      "description": "Milestone description"
    }
  ],
  "liquidatedDamages": "Liquidated damages clause details",
  
  "insuranceRequirements": "Insurance requirements and limits",
  "bondingRequirements": "Bond requirements",
  
  "warrantyTerms": "Warranty period and terms",
  "changeOrderProcess": "How change orders are handled",
  "disputeResolution": "Dispute resolution process",
  "terminationClauses": "Termination conditions and notice requirements",
  "indemnificationClauses": "Indemnification and hold harmless provisions",
  
  "keyTerms": [
    {
      "term": "Important term name",
      "summary": "Brief explanation",
      "section": "Section reference"
    }
  ],
  "riskFactors": [
    {
      "risk": "Identified risk",
      "severity": "LOW, MEDIUM, HIGH, or CRITICAL",
      "mitigation": "Suggested mitigation",
      "section": "Section reference"
    }
  ],
  "obligations": [
    {
      "type": "DELIVERABLE, NOTICE, PAYMENT, INSURANCE, OTHER",
      "description": "What is required",
      "deadline": "When it's due"
    }
  ],
  
  "confidenceScore": 0-100
}

Important guidelines:
- Carefully identify all scope items, inclusions, and exclusions
- Flag any unusual or non-standard contract terms as risks
- Note any clauses that could lead to disputes or liability
- Extract payment milestone schedules if present
- Identify flow-down provisions from prime contracts
- Look for change order procedures and notice requirements
- Return null for fields that cannot be determined from the document
- Return empty arrays for list fields with no data`;

    const userPrompt = `Please analyze this construction contract document and extract all relevant information:

Document Name: ${documentName}
Document URL: ${documentUrl}

Analyze the document and return the structured JSON with all contract details.`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    const isImageUrl = /\.(jpg|jpeg|png|gif|webp)$/i.test(documentUrl);
    
    if (isImageUrl) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: documentUrl,
              detail: 'high'
            }
          }
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: `${userPrompt}\n\nNote: This is a PDF document. Analyze based on the provided URL and extract any information you can infer from the document name and context.`
      });
    }

    if (orgId) {
      const governed = await governedAiCall({
        orgId,
        userId: userId ?? null,
        actionType: "contract_document_analysis",
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages,
            response_format: { type: 'json_object' },
            max_completion_tokens: 6000,
          });

          const content = completion.choices[0]?.message?.content;
          if (!content) throw new Error('No response from OpenAI');

          const parsed = JSON.parse(content) as ContractDocumentAnalysisResult;
          return { result: parsed, completion };
        },
      });

      if (governed.blocked) {
        const err = new Error(governed.reason || "AI rate limit exceeded");
        (err as any).governed = true;
        (err as any).reason = governed.reason;
        throw err;
      }

      return governed.result;
    }

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT5,
      messages,
      response_format: { type: 'json_object' },
      max_completion_tokens: 6000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return parsed as ContractDocumentAnalysisResult;
  } catch (error) {
    if ((error as any)?.governed) {
      throw error;
    }
    logError("AI contract document analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
    return {
      contractType: null,
      contractNumber: null,
      contractDate: null,
      effectiveDate: null,
      completionDate: null,
      ownerName: null,
      generalContractorName: null,
      subcontractorName: null,
      ownerAddress: null,
      gcAddress: null,
      projectName: null,
      projectLocation: null,
      contractValue: null,
      retainage: null,
      paymentTerms: null,
      billingSchedule: null,
      scopeOfWork: `Contract analysis pending for: ${documentName}`,
      scopeSummary: "Unable to analyze document automatically. Please review manually.",
      scopeItems: [],
      exclusions: [],
      startDate: null,
      duration: null,
      milestones: [],
      liquidatedDamages: null,
      insuranceRequirements: null,
      bondingRequirements: null,
      warrantyTerms: null,
      changeOrderProcess: null,
      disputeResolution: null,
      terminationClauses: null,
      indemnificationClauses: null,
      keyTerms: [],
      riskFactors: [{
        risk: "Document could not be analyzed automatically",
        severity: "LOW",
        mitigation: "Manual review recommended"
      }],
      obligations: [],
      confidenceScore: 0
    };
  }
}

function parseContractAnalysis(analysis: any) {
  return {
    ...analysis,
    scopeItems: safeJsonParse(analysis.scopeItems, []),
    exclusions: safeJsonParse(analysis.exclusions, []),
    milestones: safeJsonParse(analysis.milestones, []),
    keyTerms: safeJsonParse(analysis.keyTerms, []),
    riskFactors: safeJsonParse(analysis.riskFactors, []),
    obligations: safeJsonParse(analysis.obligations, []),
  };
}

// GET /api/ai-contract-document/projects - List projects for the dropdown
router.get("/ai-contract-document/projects", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const baseSelect = {
      id: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: projects.clientName,
      status: projects.status,
    };

    let projectsList;
    if (shouldFilter && orgId) {
      projectsList = await db
        .select(baseSelect)
        .from(projects)
        .where(eq(projects.gcOrganizationId, orgId))
        .orderBy(projects.name);
    } else {
      projectsList = await db
        .select(baseSelect)
        .from(projects)
        .orderBy(projects.name);
    }

    res.json(projectsList);
  } catch (error) {
    next(error);
  }
});

// Main endpoint for frontend - GET /api/ai-contract-document
router.get("/ai-contract-document", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select({
        id: aiContractDocumentAnalysis.id,
        projectId: aiContractDocumentAnalysis.projectId,
        fileName: aiContractDocumentAnalysis.documentName,
        fileUrl: aiContractDocumentAnalysis.documentUrl,
        documentType: aiContractDocumentAnalysis.documentType,
        analysisStatus: aiContractDocumentAnalysis.status,
        analysisResult: aiContractDocumentAnalysis.rawAiResponse,
        createdAt: aiContractDocumentAnalysis.createdAt,
        analyzedAt: aiContractDocumentAnalysis.analyzedAt,
      })
      .from(aiContractDocumentAnalysis)
      .orderBy(desc(aiContractDocumentAnalysis.createdAt))
      .limit(100);

    if (shouldFilter && orgId) {
      query = query.where(eq(aiContractDocumentAnalysis.organizationId, orgId)) as typeof query;
    }

    const analyses = await query;
    
    // Enrich with project info and parse analysisResult
    const enrichedAnalyses = await Promise.all(analyses.map(async (analysis) => {
      let parsedResult = null;
      if (analysis.analysisResult) {
        try {
          parsedResult = typeof analysis.analysisResult === 'string' 
            ? JSON.parse(analysis.analysisResult) 
            : analysis.analysisResult;
        } catch (e) {
          logError('Failed to parse analysisResult:', {}, e instanceof Error ? e : new Error(String(e)));
        }
      }
      
      if (analysis.projectId) {
        const [project] = await db.select({ code: projects.code, name: projects.name })
          .from(projects)
          .where(eq(projects.id, analysis.projectId))
          .limit(1);
        return {
          ...analysis,
          analysisResult: parsedResult,
          projectCode: project?.code || '',
          projectName: project?.name || '',
        };
      }
      return { ...analysis, analysisResult: parsedResult, projectCode: '', projectName: '' };
    }));
    
    res.json(enrichedAnalyses);
  } catch (error) {
    next(error);
  }
});

// POST /api/ai-contract-document/analyze - Create new analysis (frontend endpoint)
router.post("/ai-contract-document/analyze", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { projectId, fileUrl, fileName, documentType } = req.body;

    if (!projectId || !fileUrl || !fileName) {
      return res.status(400).json({ error: "projectId, fileUrl, and fileName are required" });
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Cannot analyze document for another organization's project" });
    }

    const [newAnalysis] = await db
      .insert(aiContractDocumentAnalysis)
      .values({
        projectId: projectId,
        organizationId: project.gcOrganizationId!,
        documentUrl: fileUrl,
        documentName: fileName,
        documentType: documentType || "CONTRACT",
        status: "PROCESSING",
        analyzedById: req.user?.id,
      })
      .returning();

    res.status(201).json({ id: newAnalysis.id, status: "PROCESSING" });

    // Background AI analysis
    (async () => {
      try {
        const result = await analyzeContractWithAI(fileUrl, fileName, documentType || "CONTRACT", project.gcOrganizationId!, req.user?.id);
        
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "COMPLETED",
            contractType: result.contractType || null,
            contractNumber: result.contractNumber || null,
            contractDate: result.contractDate ? new Date(result.contractDate) : null,
            effectiveDate: result.effectiveDate ? new Date(result.effectiveDate) : null,
            completionDate: result.completionDate ? new Date(result.completionDate) : null,
            ownerName: result.ownerName || null,
            generalContractorName: result.generalContractorName || null,
            subcontractorName: result.subcontractorName || null,
            ownerAddress: result.ownerAddress || null,
            gcAddress: result.gcAddress || null,
            projectName: result.projectName || null,
            projectLocation: result.projectLocation || null,
            contractValue: result.contractValue || null,
            retainage: result.retainage || null,
            paymentTerms: result.paymentTerms || null,
            billingSchedule: result.billingSchedule || null,
            scopeOfWork: result.scopeOfWork || null,
            scopeSummary: result.scopeSummary || null,
            scopeItems: JSON.stringify(result.scopeItems || []),
            exclusions: JSON.stringify(result.exclusions || []),
            startDate: result.startDate ? new Date(result.startDate) : null,
            duration: result.duration || null,
            milestones: JSON.stringify(result.milestones || []),
            liquidatedDamages: result.liquidatedDamages || null,
            insuranceRequirements: result.insuranceRequirements || null,
            bondingRequirements: result.bondingRequirements || null,
            warrantyTerms: result.warrantyTerms || null,
            changeOrderProcess: result.changeOrderProcess || null,
            disputeResolution: result.disputeResolution || null,
            terminationClauses: result.terminationClauses || null,
            indemnificationClauses: result.indemnificationClauses || null,
            keyTerms: JSON.stringify(result.keyTerms || []),
            riskFactors: JSON.stringify(result.riskFactors || []),
            obligations: JSON.stringify(result.obligations || []),
            confidenceScore: result.confidenceScore ?? 0,
            analyzedAt: new Date(),
            rawAiResponse: JSON.stringify(result),
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, newAnalysis.id));

        console.log(`AI contract document analysis completed for: ${fileName}`);
      } catch (error) {
        if ((error as any)?.governed) {
          console.warn("AI contract analysis blocked by governance:", (error as any).reason);
        }
        logError("Background AI contract analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, newAnalysis.id));
      }
    })();

  } catch (error) {
    if ((error as any)?.governed) {
      return res.status(429).json({ error: (error as any).reason || "AI rate limit exceeded" });
    }
    next(error);
  }
});

// POST /api/ai-contract-document/:id/reanalyze - Reanalyze (frontend endpoint)
router.post("/ai-contract-document/:id/reanalyze", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db
      .select()
      .from(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(aiContractDocumentAnalysis)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(aiContractDocumentAnalysis.id, id));

    res.json({ id, status: "PROCESSING" });

    // Background reanalysis
    (async () => {
      try {
        const result = await analyzeContractWithAI(existing.documentUrl, existing.documentName, existing.documentType || "CONTRACT", existing.organizationId, req.user?.id);
        
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "COMPLETED",
            contractType: result.contractType || null,
            contractNumber: result.contractNumber || null,
            contractDate: result.contractDate ? new Date(result.contractDate) : null,
            effectiveDate: result.effectiveDate ? new Date(result.effectiveDate) : null,
            completionDate: result.completionDate ? new Date(result.completionDate) : null,
            ownerName: result.ownerName || null,
            generalContractorName: result.generalContractorName || null,
            subcontractorName: result.subcontractorName || null,
            ownerAddress: result.ownerAddress || null,
            gcAddress: result.gcAddress || null,
            projectName: result.projectName || null,
            projectLocation: result.projectLocation || null,
            contractValue: result.contractValue || null,
            retainage: result.retainage || null,
            paymentTerms: result.paymentTerms || null,
            billingSchedule: result.billingSchedule || null,
            scopeOfWork: result.scopeOfWork || null,
            scopeSummary: result.scopeSummary || null,
            scopeItems: JSON.stringify(result.scopeItems || []),
            exclusions: JSON.stringify(result.exclusions || []),
            startDate: result.startDate ? new Date(result.startDate) : null,
            duration: result.duration || null,
            milestones: JSON.stringify(result.milestones || []),
            liquidatedDamages: result.liquidatedDamages || null,
            insuranceRequirements: result.insuranceRequirements || null,
            bondingRequirements: result.bondingRequirements || null,
            warrantyTerms: result.warrantyTerms || null,
            changeOrderProcess: result.changeOrderProcess || null,
            disputeResolution: result.disputeResolution || null,
            terminationClauses: result.terminationClauses || null,
            indemnificationClauses: result.indemnificationClauses || null,
            keyTerms: JSON.stringify(result.keyTerms || []),
            riskFactors: JSON.stringify(result.riskFactors || []),
            obligations: JSON.stringify(result.obligations || []),
            confidenceScore: result.confidenceScore ?? 0,
            analyzedAt: new Date(),
            rawAiResponse: JSON.stringify(result),
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, id));

        console.log(`AI contract document reanalysis completed for: ${existing.documentName}`);
      } catch (error) {
        if ((error as any)?.governed) {
          console.warn("AI contract reanalysis blocked by governance:", (error as any).reason);
        }
        logError("Background AI contract reanalysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, id));
      }
    })();

  } catch (error) {
    if ((error as any)?.governed) {
      return res.status(429).json({ error: (error as any).reason || "AI rate limit exceeded" });
    }
    next(error);
  }
});

router.get("/ai/contract-document-analysis", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select()
      .from(aiContractDocumentAnalysis)
      .orderBy(desc(aiContractDocumentAnalysis.createdAt))
      .limit(100);

    if (shouldFilter && orgId) {
      query = query.where(eq(aiContractDocumentAnalysis.organizationId, orgId)) as typeof query;
    }

    const analyses = await query;
    res.json(analyses.map(parseContractAnalysis));
  } catch (error) {
    next(error);
  }
});

router.get("/ai/contract-document-analysis/project/:projectId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const analyses = await db
      .select()
      .from(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.projectId, projectId))
      .orderBy(desc(aiContractDocumentAnalysis.createdAt))
      .limit(50);

    res.json(analyses.map(parseContractAnalysis));
  } catch (error) {
    next(error);
  }
});

router.get("/ai/contract-document-analysis/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const [analysis] = await db
      .select()
      .from(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.id, id))
      .limit(1);

    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && analysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(parseContractAnalysis(analysis));
  } catch (error) {
    next(error);
  }
});

const createContractAnalysisSchema = z.object({
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  documentUrl: documentUrlValidator,
  documentName: z.string(),
  documentType: z.string().optional(),
});

router.post("/ai/contract-document-analysis", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = createContractAnalysisSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { projectId, documentUrl, documentName, documentType, organizationId: requestedOrgId } = validationResult.data;

    const targetOrgId = shouldFilter ? orgId! : (requestedOrgId || orgId);
    
    if (!targetOrgId) {
      return res.status(400).json({ error: "Organization ID is required" });
    }

    if (projectId) {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.gcOrganizationId !== targetOrgId) {
        return res.status(403).json({ error: "Cannot analyze document for another organization's project" });
      }
    }

    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, targetOrgId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [newAnalysis] = await db
      .insert(aiContractDocumentAnalysis)
      .values({
        projectId: projectId || null,
        organizationId: targetOrgId,
        documentUrl,
        documentName,
        documentType: documentType || "PDF",
        status: "PROCESSING",
        analyzedById: req.user?.id,
      })
      .returning();

    res.status(201).json(parseContractAnalysis(newAnalysis));

    (async () => {
      try {
        const result = await analyzeContractWithAI(documentUrl, documentName, org?.tradeType || undefined, targetOrgId, req.user?.id);
        
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "COMPLETED",
            contractType: result.contractType || null,
            contractNumber: result.contractNumber || null,
            contractDate: result.contractDate ? new Date(result.contractDate) : null,
            effectiveDate: result.effectiveDate ? new Date(result.effectiveDate) : null,
            completionDate: result.completionDate ? new Date(result.completionDate) : null,
            ownerName: result.ownerName || null,
            generalContractorName: result.generalContractorName || null,
            subcontractorName: result.subcontractorName || null,
            ownerAddress: result.ownerAddress || null,
            gcAddress: result.gcAddress || null,
            projectName: result.projectName || null,
            projectLocation: result.projectLocation || null,
            contractValue: result.contractValue || null,
            retainage: result.retainage || null,
            paymentTerms: result.paymentTerms || null,
            billingSchedule: result.billingSchedule || null,
            scopeOfWork: result.scopeOfWork || null,
            scopeSummary: result.scopeSummary || null,
            scopeItems: JSON.stringify(result.scopeItems || []),
            exclusions: JSON.stringify(result.exclusions || []),
            startDate: result.startDate ? new Date(result.startDate) : null,
            duration: result.duration || null,
            milestones: JSON.stringify(result.milestones || []),
            liquidatedDamages: result.liquidatedDamages || null,
            insuranceRequirements: result.insuranceRequirements || null,
            bondingRequirements: result.bondingRequirements || null,
            warrantyTerms: result.warrantyTerms || null,
            changeOrderProcess: result.changeOrderProcess || null,
            disputeResolution: result.disputeResolution || null,
            terminationClauses: result.terminationClauses || null,
            indemnificationClauses: result.indemnificationClauses || null,
            keyTerms: JSON.stringify(result.keyTerms || []),
            riskFactors: JSON.stringify(result.riskFactors || []),
            obligations: JSON.stringify(result.obligations || []),
            confidenceScore: result.confidenceScore ?? 0,
            analyzedAt: new Date(),
            rawAiResponse: JSON.stringify(result),
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, newAnalysis.id));

        console.log(`AI contract document analysis completed for: ${documentName}`);
      } catch (error) {
        if ((error as any)?.governed) {
          console.warn("AI contract analysis blocked by governance:", (error as any).reason);
        }
        logError("Background AI contract analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, newAnalysis.id));
      }
    })();

  } catch (error) {
    next(error);
  }
});

router.post("/ai/contract-document-analysis/:id/reanalyze", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existingAnalysis] = await db
      .select()
      .from(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.id, id))
      .limit(1);

    if (!existingAnalysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && existingAnalysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .update(aiContractDocumentAnalysis)
      .set({
        status: "PROCESSING",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(aiContractDocumentAnalysis.id, id));

    res.json({ message: "Re-analysis started", id });

    (async () => {
      try {
        const [org] = await db
          .select({ tradeType: organizations.tradeType })
          .from(organizations)
          .where(eq(organizations.id, existingAnalysis.organizationId))
          .limit(1);

        const result = await analyzeContractWithAI(
          existingAnalysis.documentUrl, 
          existingAnalysis.documentName,
          org?.tradeType || undefined,
          existingAnalysis.organizationId,
          req.user?.id
        );
        
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "COMPLETED",
            contractType: result.contractType || null,
            contractNumber: result.contractNumber || null,
            contractDate: result.contractDate ? new Date(result.contractDate) : null,
            effectiveDate: result.effectiveDate ? new Date(result.effectiveDate) : null,
            completionDate: result.completionDate ? new Date(result.completionDate) : null,
            ownerName: result.ownerName || null,
            generalContractorName: result.generalContractorName || null,
            subcontractorName: result.subcontractorName || null,
            ownerAddress: result.ownerAddress || null,
            gcAddress: result.gcAddress || null,
            projectName: result.projectName || null,
            projectLocation: result.projectLocation || null,
            contractValue: result.contractValue || null,
            retainage: result.retainage || null,
            paymentTerms: result.paymentTerms || null,
            billingSchedule: result.billingSchedule || null,
            scopeOfWork: result.scopeOfWork || null,
            scopeSummary: result.scopeSummary || null,
            scopeItems: JSON.stringify(result.scopeItems || []),
            exclusions: JSON.stringify(result.exclusions || []),
            startDate: result.startDate ? new Date(result.startDate) : null,
            duration: result.duration || null,
            milestones: JSON.stringify(result.milestones || []),
            liquidatedDamages: result.liquidatedDamages || null,
            insuranceRequirements: result.insuranceRequirements || null,
            bondingRequirements: result.bondingRequirements || null,
            warrantyTerms: result.warrantyTerms || null,
            changeOrderProcess: result.changeOrderProcess || null,
            disputeResolution: result.disputeResolution || null,
            terminationClauses: result.terminationClauses || null,
            indemnificationClauses: result.indemnificationClauses || null,
            keyTerms: JSON.stringify(result.keyTerms || []),
            riskFactors: JSON.stringify(result.riskFactors || []),
            obligations: JSON.stringify(result.obligations || []),
            confidenceScore: result.confidenceScore ?? 0,
            analyzedAt: new Date(),
            rawAiResponse: JSON.stringify(result),
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, id));

        console.log(`AI contract document re-analysis completed for: ${existingAnalysis.documentName}`);
      } catch (error) {
        if ((error as any)?.governed) {
          console.warn("AI contract re-analysis blocked by governance:", (error as any).reason);
        }
        logError("Background AI contract re-analysis error:", {}, error instanceof Error ? error : new Error(String(error)));
        await db
          .update(aiContractDocumentAnalysis)
          .set({
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiContractDocumentAnalysis.id, id));
      }
    })();

  } catch (error) {
    next(error);
  }
});

router.delete("/ai/contract-document-analysis/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const [existingAnalysis] = await db
      .select()
      .from(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.id, id))
      .limit(1);

    if (!existingAnalysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && existingAnalysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db
      .delete(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.id, id));

    res.json({ success: true, message: "Analysis deleted" });
  } catch (error) {
    next(error);
  }
});

// Download contract document file
router.get("/ai-contract-document/download/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id;
    const inline = req.query.inline === "true";
    const { shouldFilter, orgId } = getOrgIdForFilter(req);

    const [analysis] = await db
      .select()
      .from(aiContractDocumentAnalysis)
      .where(eq(aiContractDocumentAnalysis.id, id))
      .limit(1);

    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (shouldFilter && orgId && analysis.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!analysis.documentUrl) {
      return res.status(404).json({ error: "No document URL found for this analysis" });
    }

    const objectStorageService = new ObjectStorageService();
    
    // Normalize the GCS URL to internal path format
    const normalizedPath = objectStorageService.normalizeObjectEntityPath(analysis.documentUrl);
    
    if (!normalizedPath.startsWith("/objects/")) {
      // If it can't be normalized, return an error
      return res.status(400).json({ error: "Document URL is not in a valid format for download" });
    }

    const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);

    // Set disposition header - inline for viewing, attachment for download
    const fileName = analysis.documentName || "document.pdf";
    const disposition = inline ? "inline" : "attachment";
    res.set("Content-Disposition", `${disposition}; filename="${fileName}"`);

    await objectStorageService.downloadObject(objectFile, res, 0);
  } catch (error: any) {
    logError("Download contract document error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ObjectNotFoundError") {
      return res.status(404).json({ error: "Document file not found in storage" });
    }
    next(error);
  }
});

// ========================================
// Routes from aiNotesRoutes.ts
// ========================================

router.post("/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { sinceDate, hoursBack } = req.body;
    
    let cutoffDate: Date | undefined;
    if (sinceDate) {
      cutoffDate = new Date(sinceDate);
    } else if (hoursBack) {
      cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    }

    const result = await aiNotesService.analyzeRecentNotes(req.user!.id, cutoffDate);
    
    res.json({
      success: true,
      runId: result.runId,
      insightsGenerated: result.insightsCount,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/insights", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const { limit } = parsePagination(req, { limit: 100 });
    const insights = await aiNotesService.getAllInsights(limit, user.role);
    res.json({ insights });
  } catch (error) {
    next(error);
  }
});

router.get("/insights/role", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const { limit } = parsePagination(req);
    const insights = await aiNotesService.getInsightsForRole(user.role, limit);
    res.json({ insights });
  } catch (error) {
    next(error);
  }
});

router.get("/insights/project/:projectId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const { projectId } = req.params;
    const { limit } = parsePagination(req);

    const isAdminOrManager = ["ADMIN", "MANAGER"].includes(user.role);
    
    if (!isAdminOrManager) {
      const project = await db
        .select({ 
          id: projects.id, 
          superintendentId: projects.superintendentId,
          estimatorId: projects.estimatorId 
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (project.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }

      const isAssignedToProject = 
        project[0].superintendentId === user.id || 
        project[0].estimatorId === user.id;

      if (!isAssignedToProject) {
        return res.status(403).json({ 
          error: "Access denied",
          message: "You are not assigned to this project" 
        });
      }
    }

    const insights = await aiNotesService.getProjectInsights(projectId, limit, user.role);
    res.json({ insights });
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from aiScopeRoutes.ts
// ========================================

router.get("/ai/trades", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const tradesWithCounts = await getTradesWithSowCounts();
    
    res.json({
      trades: tradesWithCounts,
      categories: TRADE_CATEGORIES,
      allTrades: ALL_TRADES,
    });
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/trades/discover", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { projectName, projectDescription, projectType, existingScope, bidDocumentExtracts } = req.body;

    if (!projectDescription && !bidDocumentExtracts?.length) {
      return res.status(400).json({ error: "Project description or bid document extracts required" });
    }

    const result = await discoverTradesFromDescription({
      projectName,
      projectDescription,
      projectType,
      existingScope,
      bidDocumentExtracts,
    }, { orgId: req.user.organizationId || "system", userId: req.user.id });

    logInfo(`[AI Trades] Trade discovery completed for user ${req.user.id} | primaryTrade: ${result.primaryTrade} | relatedTrades: ${result.relatedTrades.length}`);

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("limit reached") || error.message?.includes("blocked")) {
      return res.status(429).json({ error: error.message });
    }
    next(error);
  }
});

router.post("/ai/scope/predict", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { tradeType, projectDescription, projectType, estimatedValue, existingScopeItems, relatedTrades, limit } = req.body;

    if (!tradeType) {
      return res.status(400).json({ error: "Trade type is required" });
    }

    const result = await predictRelevantScopeItems({
      tradeType,
      projectDescription,
      projectType,
      estimatedValue,
      existingScopeItems,
      relatedTrades,
    }, limit || 20, { orgId: req.user.organizationId || "system", userId: req.user.id });

    logInfo(`[AI Scope] Scope prediction completed for user ${req.user.id} | trade: ${tradeType} | items: ${result.predictedItems.length} | completeness: ${result.completenessScore}`);

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("limit reached") || error.message?.includes("blocked")) {
      return res.status(429).json({ error: error.message });
    }
    next(error);
  }
});

router.get("/ai/scope/search", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { q, trades, limit } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: "Search query is required" });
    }

    const tradeTypes = trades ? (trades as string).split(',') : undefined;
    const searchLimit = limit ? parseInt(limit as string, 10) : 50;

    const result = await searchScopeItems(
      q,
      tradeTypes,
      req.user.organizationId || undefined,
      searchLimit
    );

    res.json(result);
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai/scope/trade/:tradeType", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { tradeType } = req.params;

    const items = await getScopeItemsForTrade(
      tradeType,
      req.user.organizationId || undefined
    );

    res.json({ items, count: items.length });
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai/scope/modifiers/:tradeType", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { tradeType } = req.params;
    const { categoryId } = req.query;

    const modifiers = await getModifiersForScopeItem(
      tradeType,
      categoryId as string | undefined
    );

    res.json({ modifiers });
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/trades/modifiers", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { tradeTypes } = req.body;

    if (!tradeTypes || !Array.isArray(tradeTypes)) {
      return res.status(400).json({ error: "Trade types array is required" });
    }

    const result = await getTradeModifierCategories(tradeTypes);

    res.json(result);
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/scope/from-document", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { documentText, tradeType, limit } = req.body;

    if (!documentText || !tradeType) {
      return res.status(400).json({ error: "Document text and trade type are required" });
    }

    const result = await suggestScopeFromBidDocument(
      documentText,
      tradeType,
      limit || 30,
      { orgId: req.user.organizationId || "system", userId: req.user.id }
    );

    logInfo(`[AI Scope] Scope from document completed for user ${req.user.id} | trade: ${tradeType} | items: ${result.predictedItems.length}`);

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("limit reached") || error.message?.includes("blocked")) {
      return res.status(429).json({ error: error.message });
    }
    next(error);
  }
});

// ========================================
// Routes from aiInsightsRoutes.ts
// ========================================

router.get("/ai-insights/dashboard-summary", requireAuth, requireAnyFeaturePermission('canUseAiFeatures', 'canViewAiSummaries'), async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user!.organizationId;

    const conditions: any[] = [
      eq(aiInsights.isAcknowledged, false),
      sql`(${aiInsights.expiresAt} IS NULL OR ${aiInsights.expiresAt} > NOW())`,
    ];

    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(
        sql`(${aiInsights.organizationId} = ${organizationId} OR ${aiInsights.organizationId} IS NULL)`
      );
    }

    if (await isViewOnlyAiUser(req.user)) {
      const assignedIds = await getAssignedProjectIds(req.user.id);
      if (assignedIds.length === 0) {
        return res.json({ recentInsights: [], countBySeverity: {}, countByModule: {}, totalUnacknowledged: 0 });
      }
      conditions.push(inArray(aiInsights.projectId, assignedIds));
    }

    const recentInsights = await db
      .select({
        id: aiInsights.id,
        module: aiInsights.module,
        severity: aiInsights.severity,
        title: aiInsights.title,
        summary: aiInsights.summary,
        estimatedImpact: aiInsights.estimatedImpact,
        isAcknowledged: aiInsights.isAcknowledged,
        createdAt: aiInsights.createdAt,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .orderBy(desc(aiInsights.createdAt))
      .limit(10);

    const countBySeverity = await db
      .select({
        severity: aiInsights.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .groupBy(aiInsights.severity);

    const countByModule = await db
      .select({
        module: aiInsights.module,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .groupBy(aiInsights.module);

    res.json({
      recentInsights,
      countBySeverity: Object.fromEntries(countBySeverity.map(c => [c.severity, c.count])),
      countByModule: Object.fromEntries(countByModule.map(c => [c.module, c.count])),
      totalUnacknowledged: countBySeverity.reduce((sum, c) => sum + c.count, 0),
    });
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai-insights", requireAuth, requireAnyFeaturePermission('canUseAiFeatures', 'canViewAiSummaries'), async (req: AuthRequest, res, next) => {
  try {
    const { module, projectId, severity, acknowledged } = req.query;
    const organizationId = req.user.organizationId;

    const conditions: any[] = [];
    
    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(
        sql`(${aiInsights.organizationId} = ${organizationId} OR ${aiInsights.organizationId} IS NULL)`
      );
    }

    if (await isViewOnlyAiUser(req.user)) {
      const assignedIds = await getAssignedProjectIds(req.user.id);
      if (assignedIds.length === 0) {
        return res.json([]);
      }
      if (projectId) {
        if (!assignedIds.includes(projectId as string)) {
          return res.status(403).json({ error: "Access denied to this project's insights" });
        }
        conditions.push(eq(aiInsights.projectId, projectId as string));
      } else {
        conditions.push(inArray(aiInsights.projectId, assignedIds));
      }
    } else if (projectId) {
      conditions.push(eq(aiInsights.projectId, projectId as string));
    }

    if (module) {
      conditions.push(eq(aiInsights.module, module as any));
    }

    if (severity) {
      conditions.push(eq(aiInsights.severity, severity as any));
    }

    if (acknowledged !== undefined) {
      conditions.push(eq(aiInsights.isAcknowledged, acknowledged === 'true'));
    }

    conditions.push(
      sql`(${aiInsights.expiresAt} IS NULL OR ${aiInsights.expiresAt} > NOW())`
    );

    const insights = await db
      .select()
      .from(aiInsights)
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(aiInsights.createdAt))
      .limit(100);

    const parsedInsights = insights.map(insight => ({
      ...insight,
      metrics: insight.metrics ? JSON.parse(insight.metrics) : null,
      affectedEntities: insight.affectedEntities ? JSON.parse(insight.affectedEntities) : null,
      actionItems: insight.actionItems ? JSON.parse(insight.actionItems) : null,
    }));

    res.json(parsedInsights);
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai-insights/:id", requireAuth, requireAnyFeaturePermission('canUseAiFeatures', 'canViewAiSummaries'), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const [insight] = await db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.id, id))
      .limit(1);

    if (!insight) {
      return res.status(404).json({ error: "Insight not found" });
    }

    if (req.user.role !== 'SUPER_ADMIN' && 
        insight.organizationId && 
        insight.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (await isViewOnlyAiUser(req.user)) {
      const assignedIds = await getAssignedProjectIds(req.user.id);
      if (!insight.projectId || !assignedIds.includes(insight.projectId)) {
        return res.status(403).json({ error: "Access denied to this project's insights" });
      }
    }

    const parsedInsight = {
      ...insight,
      metrics: insight.metrics ? JSON.parse(insight.metrics) : null,
      affectedEntities: insight.affectedEntities ? JSON.parse(insight.affectedEntities) : null,
      actionItems: insight.actionItems ? JSON.parse(insight.actionItems) : null,
    };

    res.json(parsedInsight);
  } catch (error: any) {
    next(error);
  }
});

router.patch("/ai-insights/:id/acknowledge", requireAuth, requireAnyFeaturePermission('canUseAiFeatures'), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const [insight] = await db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.id, id))
      .limit(1);

    if (!insight) {
      return res.status(404).json({ error: "Insight not found" });
    }

    if (req.user.role !== 'SUPER_ADMIN' && 
        insight.organizationId && 
        insight.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [updated] = await db
      .update(aiInsights)
      .set({
        isAcknowledged: true,
        acknowledgedById: req.user.id,
        acknowledgedAt: new Date(),
      })
      .where(eq(aiInsights.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai-gantt-recommendations/:projectId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;

    const recommendations = await db
      .select()
      .from(aiGanttRecommendations)
      .where(eq(aiGanttRecommendations.projectId, projectId))
      .orderBy(desc(aiGanttRecommendations.createdAt))
      .limit(20);

    const parsedRecommendations = recommendations.map(rec => ({
      ...rec,
      suggestedTasks: rec.suggestedTasks ? JSON.parse(rec.suggestedTasks) : null,
      suggestedDependencies: rec.suggestedDependencies ? JSON.parse(rec.suggestedDependencies) : null,
    }));

    res.json(parsedRecommendations);
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai-vendor-comparisons", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {

    const organizationId = req.user.organizationId;
    const { category } = req.query;

    const conditions: any[] = [];
    
    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(eq(aiVendorComparisons.organizationId, organizationId));
    }

    if (category) {
      conditions.push(eq(aiVendorComparisons.materialCategory, category as string));
    }

    const comparisons = await db
      .select()
      .from(aiVendorComparisons)
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(aiVendorComparisons.createdAt))
      .limit(50);

    const parsedComparisons = comparisons.map(comp => ({
      ...comp,
      analysisData: comp.analysisData ? JSON.parse(comp.analysisData) : null,
    }));

    res.json(parsedComparisons);
  } catch (error: any) {
    next(error);
  }
});

// ========================================
// Routes from aiScheduleRoutes.ts
// ========================================

const VALID_TRADE_TYPES = [
  "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING",
  "ELECTRICAL", "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL",
  "PAINTING", "FLOORING", "LANDSCAPING", "DEMOLITION", "STEEL_ERECTION",
  "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE", "SOLAR",
  "WATERPROOFING", "OTHER", "SITE_DEMOLITION", "MASS_EXCAVATION", "TRENCHING",
  "SHORING", "DEWATERING", "SOIL_STABILIZATION", "ENVIRONMENTAL_REMEDIATION",
  "WELL_PLUGGING", "STORMWATER_SYSTEMS", "SANITARY_SEWER", "WATERLINE",
  "FORCE_MAIN", "ROADWAY_CONSTRUCTION", "CURB_AND_GUTTER", "SIDEWALK",
  "CONCRETE_PAVING", "TRAFFIC_CONTROL", "STRIPING_AND_SIGNAGE", "EROSION_CONTROL",
  "FENCING_AND_GATES", "CAST_IN_PLACE_CONCRETE", "PRECAST_CONCRETE",
  "REBAR_AND_POST_TENSION", "STRUCTURAL_STEEL", "METAL_BUILDINGS",
  "CARPENTRY_FRAMING", "DRYWALL_SYSTEMS", "ACOUSTICAL_CEILINGS",
  "PAINTING_AND_COATINGS", "FLOORING_SYSTEMS", "ROOFING_SYSTEMS",
  "MASONRY_SYSTEMS", "GLAZING_SYSTEMS", "ELECTRICAL_UNDERGROUND",
  "ELECTRICAL_OVERHEAD", "MECHANICAL_PIPING", "HVAC_SYSTEMS", "PLUMBING_SYSTEMS",
  "FIRE_PROTECTION_SYSTEMS", "LOW_VOLTAGE_SYSTEMS", "SECURITY_AND_ACCESS",
  "COMMUNICATIONS_IT", "SOLAR_INSTALLATION", "TEMPORARY_POWER",
  "SURVEY_AND_LAYOUT", "TESTING_AND_INSPECTIONS", "COMMISSIONING",
  "TEMPORARY_FACILITIES", "GENERAL_CONDITIONS"
] as const;

function normalizeTradeType(tradeType: string | undefined | null): string | null {
  if (!tradeType) return null;
  const normalized = tradeType.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (VALID_TRADE_TYPES.includes(normalized as any)) {
    return normalized;
  }
  return null;
}

interface ScheduleTaskData {
  name: string;
  description: string;
  durationDays: number;
  dependencies: string[];
  isCriticalPath: boolean;
  isMilestone: boolean;
  tradeType?: string;
  sowItemIds?: string[];
  sequenceOrder: number;
}

interface AIScheduleResponse {
  schedule_name: string;
  baseline_start_date: string;
  baseline_end_date: string;
  ai_notes: string;
  delay_adjustment_days: number;
  change_order_impact_days: number;
  tasks: ScheduleTaskData[];
}

router.post("/projects/:code/ai-schedule", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const { startDate: rawStartDate } = req.body;
    const orgId = req.user?.organizationId;

    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const startDate = rawStartDate || new Date().toISOString().split('T')[0];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
      res.status(400).json({ error: "Invalid start date format. Use YYYY-MM-DD." });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const projectScopeItems = await db
      .select({
        id: scopeItems.id,
        description: scopeItems.description,
        unit: scopeItems.unit,
        totalQuantity: scopeItems.totalQuantity,
        completedQuantity: scopeItems.completedQuantity,
        organizationSowItemId: scopeItems.organizationSowItemId,
      })
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));

    const projectEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, project.id))
      .orderBy(desc(estimates.createdAt))
      .limit(1);

    let lineItems: any[] = [];
    if (projectEstimates.length > 0) {
      lineItems = await db
        .select({
          id: estimateLineItems.id,
          description: estimateLineItems.description,
          quantity: estimateLineItems.quantity,
          unit: estimateLineItems.unit,
          laborHours: estimateLineItems.laborHours,
          category: estimateLineItems.category,
          workTypeCode: estimateLineItems.workTypeCode,
        })
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, projectEstimates[0].id));
    }

    const projectChangeOrders = await db
      .select({
        id: changeOrders.id,
        changeOrderNumber: changeOrders.changeOrderNumber,
        description: changeOrders.description,
        amount: changeOrders.amount,
        status: changeOrders.status,
        workTypeCode: changeOrders.workTypeCode,
      })
      .from(changeOrders)
      .where(and(
        eq(changeOrders.projectId, project.id),
        eq(changeOrders.status, "APPROVED")
      ));

    const delays = await db
      .select({
        id: projectDelays.id,
        delayNumber: projectDelays.delayNumber,
        reason: projectDelays.reason,
        reasonNotes: projectDelays.reasonNotes,
        startDateTime: projectDelays.startDateTime,
        endDateTime: projectDelays.endDateTime,
        estimatedDuration: projectDelays.estimatedDuration,
        status: projectDelays.status,
      })
      .from(projectDelays)
      .where(eq(projectDelays.projectId, project.id));

    let productionRates: any[] = [];
    const sowItemIds = projectScopeItems
      .map(s => s.organizationSowItemId)
      .filter((id): id is string => id !== null);
    
    if (sowItemIds.length > 0) {
      const progressData = await db
        .select({
          organizationSowItemId: dailyScopeProgress.organizationSowItemId,
          quantityCompleted: dailyScopeProgress.quantityCompleted,
          laborHours: dailyScopeProgress.laborHours,
          crewSize: dailyScopeProgress.crewSize,
        })
        .from(dailyScopeProgress)
        .where(and(
          inArray(dailyScopeProgress.organizationSowItemId, sowItemIds),
          eq(dailyScopeProgress.projectId, project.id)
        ));

      const ratesBySowItem = new Map<string, { totalQty: number; totalHours: number; count: number }>();
      for (const p of progressData) {
        if (p.organizationSowItemId && p.quantityCompleted && p.laborHours) {
          const existing = ratesBySowItem.get(p.organizationSowItemId) || { totalQty: 0, totalHours: 0, count: 0 };
          existing.totalQty += parseFloat(p.quantityCompleted);
          existing.totalHours += parseFloat(p.laborHours);
          existing.count++;
          ratesBySowItem.set(p.organizationSowItemId, existing);
        }
      }
      
      productionRates = Array.from(ratesBySowItem.entries()).map(([sowItemId, data]) => ({
        sowItemId,
        avgQuantityPerHour: data.totalHours > 0 ? data.totalQty / data.totalHours : 0,
        dataPoints: data.count,
      }));
    }

    const systemPrompt = `You are an expert construction project scheduler with deep knowledge of construction sequencing, dependencies, and realistic duration estimation.
You analyze scope of work, estimate line items, change orders, historical delays, and production rates to generate accurate construction schedules.
Consider:
1. Logical sequencing of construction activities (site prep → foundation → structure → MEP → finishes)
2. Weather and seasonal impacts based on delay history
3. Resource constraints and crew productivity from production rates
4. Change order scope additions that extend timelines
5. Critical path identification

Respond in valid JSON with this structure:
{
  "schedule_name": "AI Generated Master Schedule",
  "baseline_start_date": "YYYY-MM-DD",
  "baseline_end_date": "YYYY-MM-DD",
  "ai_notes": "Summary of schedule assumptions and key risks",
  "delay_adjustment_days": 0,
  "change_order_impact_days": 0,
  "tasks": [
    {
      "name": "Task Name",
      "description": "Detailed task description",
      "durationDays": 5,
      "dependencies": [],
      "isCriticalPath": true,
      "isMilestone": false,
      "tradeType": "CONCRETE",
      "sowItemIds": ["scope-item-id"],
      "sequenceOrder": 1
    }
  ]
}`;

    const userPrompt = `Generate a comprehensive construction schedule for this project:

PROJECT: ${project.name} (Code: ${project.code})
Requested Start Date: ${startDate || 'ASAP - use today'}

SCOPE ITEMS (${projectScopeItems.length} items):
${projectScopeItems.map(s => `- ${s.description}: ${s.totalQuantity} ${s.unit} (${s.completedQuantity || 0} completed)`).join('\n')}

ESTIMATE LINE ITEMS (${lineItems.length} items):
${lineItems.map(l => `- ${l.description}: ${l.quantity} ${l.unit}, ${l.laborHours}hrs labor, Category: ${l.category}`).join('\n')}

APPROVED CHANGE ORDERS (${projectChangeOrders.length}):
${projectChangeOrders.map(c => `- CO#${c.changeOrderNumber}: ${c.description} (+$${c.amount})`).join('\n') || 'None'}

HISTORICAL DELAYS (${delays.length}):
${delays.map(d => {
  const duration = d.endDateTime && d.startDateTime 
    ? Math.ceil((new Date(d.endDateTime).getTime() - new Date(d.startDateTime).getTime()) / (1000 * 60 * 60 * 24))
    : d.estimatedDuration || 'Ongoing';
  return `- ${d.reason}: ${duration} days - ${d.reasonNotes || 'No notes'}`;
}).join('\n') || 'None'}

PRODUCTION RATES (historical data):
${productionRates.map(r => `- SOW Item ${r.sowItemId}: ${r.avgQuantityPerHour.toFixed(2)} units/hr (${r.dataPoints} data points)`).join('\n') || 'No historical data - use industry standards'}

Generate a realistic schedule that:
1. Sequences tasks logically for construction workflow
2. Accounts for delay patterns (add buffer for ${delays.filter(d => d.reason === 'WEATHER').length} weather delays)
3. Includes change order scope in timeline
4. Uses production rates where available, industry standards otherwise
5. Identifies critical path tasks
6. Includes key milestones`;

    const governed = await governedAiCall({
      orgId: orgId,
      userId: req.user?.id || null,
      actionType: "schedule_generation",
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 4000,
        });
        const result = completion.choices[0]?.message?.content;
        return { result, completion };
      },
    });

    if (governed.blocked) {
      res.status(429).json({ error: governed.reason || "AI usage limit reached" });
      return;
    }

    const responseContent = governed.result;
    if (!responseContent) {
      return res.status(500).json({ error: "AI did not return a response" });
    }

    let aiResponse: AIScheduleResponse;
    try {
      aiResponse = JSON.parse(responseContent);
    } catch (parseError) {
      next(parseError);
      return;
    }

    const existingSchedules = await db
      .select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, project.id),
        eq(projectSchedules.isActive, true)
      ));
    
    if (existingSchedules.length > 0) {
      await db
        .update(projectSchedules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(projectSchedules.id, existingSchedules.map(s => s.id)));
    }

    const [newSchedule] = await db
      .insert(projectSchedules)
      .values({
        organizationId: orgId,
        projectId: project.id,
        name: aiResponse.schedule_name || "AI Generated Schedule",
        generatedBy: "AI",
        baselineStartDate: aiResponse.baseline_start_date,
        baselineEndDate: aiResponse.baseline_end_date,
        aiNotes: aiResponse.ai_notes,
        optionsJson: JSON.stringify({
          delayAdjustmentDays: aiResponse.delay_adjustment_days,
          changeOrderImpactDays: aiResponse.change_order_impact_days,
          generatedAt: new Date().toISOString(),
        }),
        isActive: true,
      })
      .returning();

    const taskInserts = aiResponse.tasks.map((task, index) => ({
      scheduleId: newSchedule.id,
      name: task.name,
      description: task.description,
      durationDays: task.durationDays,
      dependencies: task.dependencies || [],
      isCriticalPath: task.isCriticalPath || false,
      isMilestone: task.isMilestone || false,
      tradeType: normalizeTradeType(task.tradeType) as any,
      sowItemIds: task.sowItemIds || [],
      percentComplete: 0,
      plannedStartDate: calculateTaskStartDate(aiResponse.baseline_start_date, aiResponse.tasks, index),
      plannedEndDate: calculateTaskEndDate(aiResponse.baseline_start_date, aiResponse.tasks, index),
    }));

    if (taskInserts.length > 0) {
      await db.insert(projectScheduleTasks).values(taskInserts);
    }

    const insertedTasks = await db
      .select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, newSchedule.id));

    const nameToIdMap = new Map<string, string>();
    for (const t of insertedTasks) {
      nameToIdMap.set(t.name, t.id);
    }
    for (const t of insertedTasks) {
      if (t.dependencies && t.dependencies.length > 0) {
        const resolvedDeps = t.dependencies
          .map(dep => nameToIdMap.get(dep) || dep)
          .filter(dep => insertedTasks.some(it => it.id === dep));
        if (JSON.stringify(resolvedDeps) !== JSON.stringify(t.dependencies)) {
          await db.update(projectScheduleTasks)
            .set({ dependencies: resolvedDeps, updatedAt: new Date() })
            .where(eq(projectScheduleTasks.id, t.id));
        }
      }
    }

    const { recalculateSchedule } = await import("./cpmEngine");
    await recalculateSchedule(newSchedule.id);

    const createdTasks = await db
      .select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, newSchedule.id));

    try {
      await db.delete(aiGanttRecommendations).where(eq(aiGanttRecommendations.projectId, project.id));

      const recommendations: Array<{
        recommendationType: string;
        title: string;
        description: string;
        estimatedDaysImprovement?: number;
      }> = [];

      const criticalTasks = createdTasks.filter(t => t.isCriticalPath);
      const nonCriticalTasks = createdTasks.filter(t => !t.isCriticalPath);

      const highFloatTasks = createdTasks.filter(t => (t.totalFloat || 0) > 5);
      if (highFloatTasks.length > 0) {
        recommendations.push({
          recommendationType: "CRITICAL_PATH",
          title: "Tasks with Excessive Float",
          description: `${highFloatTasks.length} task(s) have more than 5 days of float: ${highFloatTasks.slice(0, 3).map(t => t.name).join(", ")}${highFloatTasks.length > 3 ? "..." : ""}. Consider reallocating resources from these tasks to critical path items.`,
          estimatedDaysImprovement: Math.min(Math.max(...highFloatTasks.map(t => t.totalFloat || 0)), 5),
        });
      }

      const noDeps = nonCriticalTasks.filter(t => !t.dependencies || t.dependencies.length === 0);
      if (noDeps.length > 2) {
        recommendations.push({
          recommendationType: "PARALLEL_WORK",
          title: "Parallelization Opportunity",
          description: `${noDeps.length} tasks have no dependencies and could potentially be executed in parallel: ${noDeps.slice(0, 3).map(t => t.name).join(", ")}${noDeps.length > 3 ? "..." : ""}. Verify resource availability to compress the schedule.`,
          estimatedDaysImprovement: Math.round(noDeps.reduce((s, t) => s + (t.durationDays || 0), 0) * 0.3),
        });
      }

      if (criticalTasks.length > 3) {
        const longestCritical = criticalTasks.sort((a, b) => (b.durationDays || 0) - (a.durationDays || 0))[0];
        recommendations.push({
          recommendationType: "RESOURCE_ALLOCATION",
          title: "Resource Leveling Suggestion",
          description: `The critical path has ${criticalTasks.length} tasks. Consider adding resources to "${longestCritical.name}" (${longestCritical.durationDays} days) to reduce its duration and compress the overall schedule.`,
          estimatedDaysImprovement: Math.ceil((longestCritical.durationDays || 1) * 0.2),
        });
      }

      const tradeGroups = new Map<string, number>();
      for (const t of createdTasks) {
        if (t.tradeType) {
          tradeGroups.set(t.tradeType, (tradeGroups.get(t.tradeType) || 0) + 1);
        }
      }
      for (const [trade, count] of tradeGroups) {
        if (count >= 4) {
          recommendations.push({
            recommendationType: "TASK_ORDER",
            title: `${trade} Task Sequencing`,
            description: `${count} tasks are assigned to ${trade}. Ensure proper sequencing to avoid crew conflicts and optimize workflow continuity.`,
          });
        }
      }

      if (recommendations.length > 0) {
        await db.insert(aiGanttRecommendations).values(
          recommendations.map(r => ({
            projectId: project.id,
            recommendationType: r.recommendationType,
            title: r.title,
            description: r.description,
            estimatedDaysImprovement: r.estimatedDaysImprovement || null,
          }))
        );
      }
    } catch (recErr) {
      logError("Failed to generate AI recommendations:", {}, recErr instanceof Error ? recErr : new Error(String(recErr)));
    }

    const [updatedSchedule] = await db
      .select()
      .from(projectSchedules)
      .where(eq(projectSchedules.id, newSchedule.id));

    const generatedRecommendations = await db
      .select()
      .from(aiGanttRecommendations)
      .where(eq(aiGanttRecommendations.projectId, project.id));

    res.json({
      schedule: updatedSchedule || newSchedule,
      tasks: createdTasks,
      recommendations: generatedRecommendations,
      summary: {
        totalTasks: createdTasks.length,
        criticalPathTasks: createdTasks.filter(t => t.isCriticalPath).length,
        milestones: createdTasks.filter(t => t.isMilestone).length,
        delayAdjustmentDays: aiResponse.delay_adjustment_days,
        changeOrderImpactDays: aiResponse.change_order_impact_days,
      }
    });

  } catch (error) {
    next(error);
  }
});

function calculateTaskStartDate(baselineStart: string, tasks: ScheduleTaskData[], currentIndex: number): string {
  let startDate = new Date(baselineStart);
  
  for (let i = 0; i < currentIndex; i++) {
    const prevTask = tasks[i];
    const currentTask = tasks[currentIndex];
    
    if (currentTask.dependencies?.includes(prevTask.name) || 
        (currentTask.dependencies?.length === 0 && i === currentIndex - 1)) {
      startDate.setDate(startDate.getDate() + prevTask.durationDays);
    }
  }
  
  return startDate.toISOString().split('T')[0];
}

function calculateTaskEndDate(baselineStart: string, tasks: ScheduleTaskData[], currentIndex: number): string {
  const startDateStr = calculateTaskStartDate(baselineStart, tasks, currentIndex);
  const startDate = new Date(startDateStr);
  const task = tasks[currentIndex];
  
  startDate.setDate(startDate.getDate() + task.durationDays);
  return startDate.toISOString().split('T')[0];
}

const reorderSchema = z.object({
  taskIds: z.array(z.string()).min(1),
});

router.patch("/projects/:code/schedule/tasks/reorder", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const orgId = req.user?.organizationId;
    if (!orgId) { res.status(403).json({ error: "Organization required" }); return; }

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" }); return;
    }

    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.errors }); return; }

    const [schedule] = await db.select().from(projectSchedules)
      .where(and(eq(projectSchedules.projectId, project.id), eq(projectSchedules.isActive, true)))
      .limit(1);
    if (!schedule) { res.status(404).json({ error: "No active schedule" }); return; }

    const uniqueIds = new Set(parsed.data.taskIds);
    if (uniqueIds.size !== parsed.data.taskIds.length) {
      res.status(400).json({ error: "Duplicate task IDs in reorder request" }); return;
    }

    const existingTasks = await db.select({ id: projectScheduleTasks.id }).from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    const existingIds = new Set(existingTasks.map(t => t.id));
    for (const id of parsed.data.taskIds) {
      if (!existingIds.has(id)) {
        res.status(400).json({ error: `Task ${id} not found in schedule` }); return;
      }
    }

    for (let i = 0; i < parsed.data.taskIds.length; i++) {
      await db.update(projectScheduleTasks)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(and(eq(projectScheduleTasks.id, parsed.data.taskIds[i]), eq(projectScheduleTasks.scheduleId, schedule.id)));
    }

    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    res.json({ tasks });
  } catch (error) {
    next(error);
  }
});

router.patch("/projects/:code/schedule/tasks/:taskId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, taskId } = req.params;
    const orgId = req.user?.organizationId;

    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const taskWithSchedule = await db
      .select({
        task: projectScheduleTasks,
        scheduleProjectId: projectSchedules.projectId,
      })
      .from(projectScheduleTasks)
      .innerJoin(projectSchedules, eq(projectScheduleTasks.scheduleId, projectSchedules.id))
      .where(eq(projectScheduleTasks.id, taskId))
      .limit(1);
    
    if (taskWithSchedule.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (taskWithSchedule[0].scheduleProjectId !== project.id) {
      res.status(403).json({ error: "Task does not belong to this project" });
      return;
    }

    const { name, description, plannedStartDate, plannedEndDate, actualStartDate, actualEndDate, percentComplete, isCriticalPath, status, dependencies, crewIds, durationDays, parentTaskId } = req.body;

    if (parentTaskId !== undefined && parentTaskId !== null) {
      const scheduleId = taskWithSchedule[0].task.scheduleId;
      const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, scheduleId));
      const parentTask = allTasks.find(t => t.id === parentTaskId);
      if (!parentTask) {
        res.status(400).json({ error: "Parent task not found in this schedule" });
        return;
      }
      if (parentTaskId === taskId) {
        res.status(400).json({ error: "Task cannot be its own parent" });
        return;
      }
      let currentId: string | null = parentTask.parentTaskId;
      while (currentId) {
        if (currentId === taskId) {
          res.status(400).json({ error: "Circular parent hierarchy detected" });
          return;
        }
        const ancestor = allTasks.find(t => t.id === currentId);
        currentId = ancestor?.parentTaskId || null;
      }
    }

    if (percentComplete !== undefined && (percentComplete < 0 || percentComplete > 100)) {
      res.status(400).json({ error: "percentComplete must be between 0 and 100" });
      return;
    }

    if (dependencies !== undefined && Array.isArray(dependencies)) {
      const scheduleId = taskWithSchedule[0].task.scheduleId;
      const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, scheduleId));
      for (const depId of dependencies) {
        if (depId === taskId) {
          res.status(400).json({ error: "Task cannot depend on itself" });
          return;
        }
        if (!allTasks.some(t => t.id === depId)) {
          res.status(400).json({ error: `Dependency task ${depId} not found in schedule` });
          return;
        }
      }
      const { detectCycle } = await import("./cpmEngine");
      if (detectCycle(taskId, dependencies, allTasks.map(t => ({ id: t.id, dependencies: t.dependencies })))) {
        res.status(400).json({ error: "Circular dependency detected" });
        return;
      }
    }

    const [updatedTask] = await db
      .update(projectScheduleTasks)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(plannedStartDate !== undefined && { plannedStartDate }),
        ...(plannedEndDate !== undefined && { plannedEndDate }),
        ...(actualStartDate !== undefined && { actualStartDate }),
        ...(actualEndDate !== undefined && { actualEndDate }),
        ...(percentComplete !== undefined && { percentComplete }),
        ...(isCriticalPath !== undefined && { isCriticalPath }),
        ...(status !== undefined && { status }),
        ...(dependencies !== undefined && { dependencies }),
        ...(crewIds !== undefined && { crewIds }),
        ...(durationDays !== undefined && { durationDays }),
        ...(parentTaskId !== undefined && { parentTaskId }),
        updatedAt: new Date(),
      })
      .where(eq(projectScheduleTasks.id, taskId))
      .returning();

    if (updatedTask) {
      try {
        const { recalculateSchedule } = await import("./cpmEngine");
        await recalculateSchedule(updatedTask.scheduleId);
      } catch (e) {
        logError("CPM recalculation failed:", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }

    const allTasks = updatedTask
      ? await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, updatedTask.scheduleId))
      : [];

    res.json({ task: updatedTask, tasks: allTasks });
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:code/schedule", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const orgId = req.user?.organizationId;

    const [project] = await db.select().from(projects).where(eq(projects.code, code));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.gcOrganizationId !== orgId && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [schedule] = await db
      .select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, project.id),
        eq(projectSchedules.isActive, true)
      ))
      .orderBy(desc(projectSchedules.createdAt))
      .limit(1);

    if (!schedule) {
      res.json({ schedule: null, tasks: [] });
      return;
    }

    const tasks = await db
      .select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.json({ schedule, tasks });

  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from aiAssistantRoutes.ts
// ========================================

/**
 * AI Assistant Routes for SOW and UOM Item Management
 * Provides AI-powered assistance for adding new items with proper formatting and uniformity
 */

// Validation schemas
const sowAssistantRequestSchema = z.object({
  userInput: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(1, "Description is required").max(500))
    .transform(s => sanitizeText(s)),
  tradeType: z.string().optional(),
  organizationId: z.string().optional(),
});

const uomAssistantRequestSchema = z.object({
  userInput: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(1, "Description is required").max(200))
    .transform(s => sanitizeText(s)),
});

const addSowItemSchema = z.object({
  categoryName: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(100))
    .transform(s => sanitizeShortText(s) || ''),
  name: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(200))
    .transform(s => sanitizeShortText(s) || ''),
  code: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(50))
    .transform(s => (sanitizeShortText(s) || '').toUpperCase().replace(/\s+/g, '_')),
  description: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().max(500))
    .transform(s => sanitizeText(s) || '')
    .optional(),
  unit: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().max(20))
    .transform(s => sanitizeShortText(s) || '')
    .optional(),
  requiresDimensions: z.boolean().optional().default(false),
  dimensionLabel: z.string().max(100).optional(),
});

const addUomSchema = z.object({
  code: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(10))
    .transform(s => (sanitizeShortText(s) || '').toUpperCase()),
  name: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(100))
    .transform(s => sanitizeShortText(s) || ''),
  abbreviation: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(20))
    .transform(s => (sanitizeShortText(s) || '').toLowerCase()),
  category: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().min(1).max(50))
    .transform(s => (sanitizeShortText(s) || '').toLowerCase()),
  description: z.string()
    .transform(s => (s || '').trim())
    .pipe(z.string().max(200))
    .transform(s => sanitizeText(s) || '')
    .optional(),
});

// Interface for AI SOW suggestion response
interface SOWSuggestion {
  categoryName: string;
  name: string;
  code: string;
  description: string;
  suggestedUom: string;
  requiresDimensions: boolean;
  dimensionLabel: string | null;
  confidence: number;
  reasoning: string;
}

// Interface for AI UOM suggestion response
interface UOMSuggestion {
  code: string;
  name: string;
  abbreviation: string;
  category: string;
  description: string;
  confidence: number;
  reasoning: string;
}

interface SimilarItem {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  unit?: string;
  similarity: number;
}

/**
 * AI SOW Assistant - Analyzes user input and suggests properly formatted SOW item
 * POST /api/ai-assistant/sow/suggest
 */
router.post("/ai-assistant/sow/suggest", sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validation = sowAssistantRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const { userInput, tradeType, organizationId } = validation.data;
    const orgId = organizationId || req.user.organizationId;

    // Fetch existing SOW items for context and duplicate detection
    let existingItems: (MasterSowItem | OrganizationSowItem)[] = [];
    
    // Get master SOW items for the trade
    if (tradeType) {
      const masterItems = await db
        .select()
        .from(masterSowItems)
        .where(eq(masterSowItems.tradeType, tradeType as any))
        .limit(100);
      existingItems.push(...masterItems);
    }

    // Get organization SOW items
    if (orgId) {
      const orgItems = await db
        .select()
        .from(organizationSowItems)
        .where(eq(organizationSowItems.organizationId, orgId))
        .limit(100);
      existingItems.push(...orgItems);
    }

    // Get available UOMs
    const uoms = await db
      .select()
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.isActive, true))
      .orderBy(unitsOfMeasure.sortOrder);

    // Find similar existing items (simple keyword matching)
    const similarItems = findSimilarItems(userInput || '', existingItems);

    // Build context for AI
    const existingCategories = Array.from(new Set(existingItems.map(i => i.categoryName)));
    const existingCodes = existingItems.map(i => i.code);
    const uomList = uoms.map(u => `${u.code} (${u.name})`).join(', ');

    // Call OpenAI for suggestion
    const systemPrompt = `You are a construction industry expert helping standardize Scope of Work (SOW) items.
Your task is to analyze the user's description and suggest a properly formatted SOW item that maintains consistency with existing items.

IMPORTANT RULES:
1. Use Title Case for the name (e.g., "Install 4-inch PVC Drain Line")
2. Create a short, uppercase code using underscores (e.g., "INSTALL_4IN_PVC_DRAIN")
3. Match the category to existing categories when possible: ${existingCategories.slice(0, 20).join(', ') || 'General'}
4. Suggest the most appropriate UOM from: ${uomList}
5. If the item requires area/length measurements, set requiresDimensions to true
6. Avoid duplicating existing codes: ${existingCodes.slice(0, 30).join(', ')}

Respond with a JSON object matching this structure:
{
  "categoryName": "string - category for grouping",
  "name": "string - descriptive name in Title Case",
  "code": "string - short uppercase code with underscores",
  "description": "string - brief description of the work",
  "suggestedUom": "string - UOM code like SF, LF, EA, CY",
  "requiresDimensions": boolean,
  "dimensionLabel": "string or null - e.g., 'Area (SF)' if dimensions required",
  "confidence": number 0-100,
  "reasoning": "string - brief explanation of your choices"
}`;

    const userPrompt = `User wants to add this SOW item: "${userInput}"
${tradeType ? `Trade type: ${tradeType}` : ''}

Analyze and suggest the properly formatted SOW item.`;

    const governed = await governedAiCall<SOWSuggestion>({
      orgId: req.user.organizationId || '',
      userId: req.user.id?.toString() || null,
      actionType: "sow_assistant",
      inputRefs: { userInput, tradeType },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: 1000,
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response from AI');
        }

        return { result: JSON.parse(content) as SOWSuggestion, completion };
      },
    });

    if (governed.blocked) {
      return res.status(429).json({ error: "AI rate limit reached", reason: governed.reason });
    }

    const suggestion = governed.result;

    // Return suggestion with similar items for duplicate detection
    res.json({
      success: true,
      suggestion,
      similarItems: similarItems.slice(0, 5),
      availableUoms: uoms.map(u => ({ code: u.code, name: u.name, abbreviation: u.abbreviation })),
      existingCategories: existingCategories.slice(0, 20),
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * Add new SOW item to organization
 * POST /api/ai-assistant/sow/add
 */
router.post("/ai-assistant/sow/add", async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Only allow management roles to add SOW items
    const allowedRoles = ['ADMIN', 'MANAGER', 'ESTIMATOR', 'SUPERINTENDENT'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const validation = addSowItemSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization not found for user" });
    }

    const { categoryName, name, code, description, unit, requiresDimensions, dimensionLabel } = validation.data;

    // Check for duplicate code in organization
    const existing = await db
      .select()
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, orgId),
        eq(organizationSowItems.code, code)
      ))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: "An item with this code already exists", existingItem: existing[0] });
    }

    // Get max display order for the category
    const maxOrder = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(display_order), 0)` })
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, orgId),
        eq(organizationSowItems.categoryName, categoryName)
      ));

    const displayOrder = (maxOrder[0]?.maxOrder || 0) + 1;

    // Insert new SOW item
    const [newItem] = await db
      .insert(organizationSowItems)
      .values({
        organizationId: orgId,
        categoryName,
        name,
        code,
        description: description || null,
        unit: unit || null,
        requiresDimensions: requiresDimensions || false,
        dimensionLabel: dimensionLabel || null,
        displayOrder,
        isFromTemplate: false,
        isActive: true,
      })
      .returning();

    res.status(201).json({
      success: true,
      item: newItem,
      message: "SOW item added successfully",
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * AI UOM Assistant - Analyzes user input and suggests properly formatted UOM
 * POST /api/ai-assistant/uom/suggest
 */
router.post("/ai-assistant/uom/suggest", sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validation = uomAssistantRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const { userInput } = validation.data;

    // Get existing UOMs for context
    const existingUoms = await db
      .select()
      .from(unitsOfMeasure)
      .orderBy(unitsOfMeasure.sortOrder);

    // Find similar UOMs
    const similarUoms = findSimilarUoms(userInput || '', existingUoms);

    // Build context
    const existingCodes = existingUoms.map(u => u.code);
    const existingCategories = Array.from(new Set(existingUoms.map(u => u.category)));
    const uomExamples = existingUoms.slice(0, 15).map(u => 
      `${u.code}: ${u.name} (${u.abbreviation}) - ${u.category}`
    ).join('\n');

    // Call OpenAI for suggestion
    const systemPrompt = `You are a construction industry expert helping standardize Units of Measure (UOM).
Your task is to analyze the user's description and suggest a properly formatted UOM that maintains consistency with existing units.

EXISTING UOM EXAMPLES:
${uomExamples}

EXISTING CATEGORIES: ${existingCategories.join(', ')}
EXISTING CODES (avoid duplicates): ${existingCodes.join(', ')}

IMPORTANT RULES:
1. Code should be 2-4 uppercase letters (e.g., SF, LF, CY, EA, GAL)
2. Name should be the full name in Title Case (e.g., "Square Foot", "Linear Foot")
3. Abbreviation should be lowercase, commonly used form (e.g., "sq ft", "lin ft")
4. Category should match existing categories: ${existingCategories.join(', ')}
5. Check if a similar UOM already exists before suggesting a new one

Respond with a JSON object:
{
  "code": "string - 2-4 uppercase letters",
  "name": "string - full name in Title Case",
  "abbreviation": "string - lowercase common abbreviation",
  "category": "string - area, length, volume, quantity, time, weight, or capacity",
  "description": "string - brief description",
  "confidence": number 0-100,
  "reasoning": "string - explain if this might duplicate an existing UOM or why it's needed"
}`;

    const userPrompt = `User wants to add this unit of measure: "${userInput}"

Analyze and suggest the properly formatted UOM, or explain if a similar one already exists.`;

    const governed = await governedAiCall<UOMSuggestion>({
      orgId: req.user.organizationId || '',
      userId: req.user.id?.toString() || null,
      actionType: "uom_assistant",
      inputRefs: { userInput },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: 500,
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response from AI');
        }

        return { result: JSON.parse(content) as UOMSuggestion, completion };
      },
    });

    if (governed.blocked) {
      return res.status(429).json({ error: "AI rate limit reached", reason: governed.reason });
    }

    const suggestion = governed.result;

    res.json({
      success: true,
      suggestion,
      similarUoms: similarUoms.slice(0, 5),
      existingCategories,
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * Add new UOM (Admin only)
 * POST /api/ai-assistant/uom/add
 */
router.post("/ai-assistant/uom/add", async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Only admins can add new UOMs
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Admin access required to add new units of measure" });
    }

    const validation = addUomSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const { code, name, abbreviation, category, description } = validation.data;

    // Check for duplicate code
    const existing = await db
      .select()
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.code, code))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: "A UOM with this code already exists", existingUom: existing[0] });
    }

    // Get max sort order
    const maxOrder = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(sort_order), 0)` })
      .from(unitsOfMeasure);

    const sortOrder = (maxOrder[0]?.maxOrder || 0) + 1;

    // Insert new UOM
    const [newUom] = await db
      .insert(unitsOfMeasure)
      .values({
        code,
        name,
        abbreviation,
        category,
        description: description || null,
        sortOrder,
        isActive: true,
      })
      .returning();

    res.status(201).json({
      success: true,
      uom: newUom,
      message: "Unit of measure added successfully",
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * Search existing SOW items
 * GET /api/ai-assistant/sow/search
 */
router.get("/ai-assistant/sow/search", async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const query = (req.query.q as string || '').trim();
    const tradeType = req.query.tradeType as string;
    const orgId = req.user.organizationId;

    if (!query || query.length < 2) {
      return res.json({ items: [] });
    }

    const searchPattern = `%${query}%`;
    
    // Search organization items
    let orgItems: OrganizationSowItem[] = [];
    if (orgId) {
      orgItems = await db
        .select()
        .from(organizationSowItems)
        .where(and(
          eq(organizationSowItems.organizationId, orgId),
          eq(organizationSowItems.isActive, true),
          or(
            ilike(organizationSowItems.name, searchPattern),
            ilike(organizationSowItems.code, searchPattern),
            ilike(organizationSowItems.categoryName, searchPattern)
          )
        ))
        .limit(20);
    }

    // Search master items
    let masterItems: MasterSowItem[] = [];
    if (tradeType) {
      masterItems = await db
        .select()
        .from(masterSowItems)
        .where(and(
          eq(masterSowItems.tradeType, tradeType as any),
          eq(masterSowItems.isActive, true),
          or(
            ilike(masterSowItems.name, searchPattern),
            ilike(masterSowItems.code, searchPattern),
            ilike(masterSowItems.categoryName, searchPattern)
          )
        ))
        .limit(20);
    }

    res.json({
      organizationItems: orgItems,
      masterItems: masterItems,
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * Get available UOMs
 * GET /api/ai-assistant/uom/list
 */
router.get("/ai-assistant/uom/list", async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const uoms = await db
      .select()
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.isActive, true))
      .orderBy(unitsOfMeasure.sortOrder);

    res.json({ uoms });

  } catch (error: any) {
    next(error);
  }
});

// Single-word primary work-type nouns - what the item IS
// These prevent false positives when comparing items across different work types
const PRIMARY_WORK_TYPE_NOUNS = new Set([
  // CONCRETE - Flatwork & structural
  'curb', 'sidewalk', 'slab', 'driveway', 'patio', 'walkway', 'apron', 'pavement', 'paver',
  'footing', 'foundation', 'pier', 'pillar', 'bollard', 'retaining',
  
  // FRAMING - Structural elements
  'stud', 'joist', 'rafter', 'truss', 'header', 'sheathing', 'beam', 'column',
  
  // ROOFING - Distinct roofing items
  'shingle', 'ridge', 'eave', 'soffit', 'fascia', 'downspout', 'gutter', 'flashing',
  
  // ELECTRICAL - Distinct electrical items
  'outlet', 'breaker', 'circuit', 'receptacle', 'transformer', 'panel', 'switch',
  
  // PLUMBING - Distinct plumbing items
  'faucet', 'toilet', 'tub', 'septic', 'sewage', 'sink', 'shower', 'drain',
  
  // HVAC - Distinct HVAC items
  'ductwork', 'duct', 'furnace', 'condenser', 'thermostat', 'diffuser', 'register',
  
  // DRYWALL - Distinct drywall items
  'drywall', 'sheetrock', 'wallboard',
  
  // PAINTING - Distinct painting items
  'paint', 'primer', 'stain', 'coating',
  
  // FLOORING - Distinct flooring items
  'hardwood', 'laminate', 'carpet', 'subfloor', 'baseboard', 'flooring', 'vinyl',
  
  // TILE - Distinct tile items
  'tile', 'grout', 'backsplash', 'mosaic', 'ceramic', 'porcelain',
  
  // MASONRY - Distinct masonry items
  'brick', 'block', 'chimney', 'fireplace', 'hearth', 'lintel', 'capstone', 'stone', 'mortar',
  
  // INSULATION - Distinct insulation items
  'insulation', 'batt', 'sprayfoam',
  
  // WINDOWS_DOORS - Distinct items
  'window', 'door', 'skylight', 'casement', 'transom', 'jamb',
  
  // SIDING - Distinct siding items
  'siding', 'cladding', 'housewrap',
  
  // CABINETRY - Distinct cabinet items
  'cabinet', 'millwork', 'pantry', 'vanity', 'closet',
  
  // COUNTERTOPS - Distinct countertop items
  'countertop', 'granite', 'quartz', 'marble',
  
  // FENCING - Distinct fencing items
  'fence', 'picket', 'gate', 'post',
  
  // DECKING - Distinct decking items
  'deck', 'porch', 'railing', 'baluster', 'pergola', 'gazebo', 'tread', 'stringer',
  
  // LANDSCAPING - Distinct landscaping items
  'lawn', 'turf', 'irrigation', 'sprinkler', 'shrub', 'mulch', 'sod', 'tree', 'grading',
  
  // DEMOLITION - Distinct demo items
  'demo', 'demolition', 'tearout',
  
  // SOLAR - Distinct solar items
  'solar', 'inverter', 'array', 'module',
  
  // VERTICAL ACCESS - Distinct items
  'stair', 'ramp', 'handrail', 'guardrail',
  
  // INFRASTRUCTURE - Distinct items
  'manhole', 'catchbasin', 'culvert', 'inlet', 'drainage',
]);

// Multi-word primary work-type phrases (normalized, no punctuation)
const PRIMARY_WORK_TYPE_PHRASES = [
  'water heater', 'shower pan', 'vapor barrier', 'chain link', 'retaining wall',
  'catch basin', 'curb and gutter', 'curb gutter', 'air handler', 'heat pump',
  'exhaust fan', 'floor drain', 'roof drain', 'fire pit', 'hot tub',
];

// Normalize word to base form (simple stemming for plurals)
function normalizeWord(word: string): string {
  if (word.endsWith('s') && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

// Clean text for matching (remove punctuation, lowercase)
function cleanText(text: string): string {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extract and clean words from text
function extractWords(text: string): string[] {
  return cleanText(text).split(' ').filter(w => w.length > 2).map(normalizeWord);
}

// Build n-grams (bigrams, trigrams) from word list for phrase matching
function buildNgrams(words: string[]): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i < words.length; i++) {
    // Bigrams
    if (i + 1 < words.length) {
      ngrams.push(`${words[i]} ${words[i + 1]}`);
    }
    // Trigrams
    if (i + 2 < words.length) {
      ngrams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }
  return ngrams;
}

// Convert phrases to Set for O(1) lookup
const PRIMARY_PHRASE_SET = new Set(PRIMARY_WORK_TYPE_PHRASES);

// Find primary work types (single words + multi-word phrases) in text
function findPrimaryTypes(text: string): string[] {
  const words = extractWords(text);
  const found: string[] = [];
  
  // Build n-grams and check for phrase matches (token-boundary safe)
  const ngrams = buildNgrams(words);
  for (const ngram of ngrams) {
    if (PRIMARY_PHRASE_SET.has(ngram)) {
      found.push(ngram);
    }
  }
  
  // Check for single-word nouns
  for (const word of words) {
    if (PRIMARY_WORK_TYPE_NOUNS.has(word)) {
      found.push(word);
    }
  }
  
  return found;
}

// Helper function to find similar SOW items with improved matching
function findSimilarItems(
  userInput: string, 
  existingItems: (MasterSowItem | OrganizationSowItem)[]
): SimilarItem[] {
  const inputWords = extractWords(userInput);
  const inputPrimaryTypes = findPrimaryTypes(userInput);
  
  return existingItems
    .map(item => {
      const itemText = `${item.name} ${item.code}`;
      const itemWords = extractWords(itemText);
      const itemPrimaryTypes = findPrimaryTypes(itemText);
      
      // STRICT RULE: If user input has primary work types, item MUST have at least one matching
      if (inputPrimaryTypes.length > 0) {
        const hasMatchingPrimaryType = inputPrimaryTypes.some(inputType => 
          itemPrimaryTypes.includes(inputType)
        );
        
        // No matching primary work type = not similar (curb != sidewalk)
        if (!hasMatchingPrimaryType) {
          return {
            id: item.id,
            name: item.name,
            code: item.code,
            categoryName: item.categoryName,
            unit: 'unit' in item ? item.unit || undefined : ('defaultUomCode' in item ? item.defaultUomCode || undefined : undefined),
            similarity: 0,
          };
        }
      }
      
      // Calculate exact word match similarity (no substring matching)
      const inputWordSet = new Set(inputWords);
      const itemWordSet = new Set(itemWords);
      const matchCount = Array.from(inputWordSet).filter(w => itemWordSet.has(w)).length;
      const similarity = inputWordSet.size > 0 ? (matchCount / inputWordSet.size) * 100 : 0;
      
      return {
        id: item.id,
        name: item.name,
        code: item.code,
        categoryName: item.categoryName,
        unit: 'unit' in item ? item.unit || undefined : ('defaultUomCode' in item ? item.defaultUomCode || undefined : undefined),
        similarity,
      };
    })
    .filter(item => item.similarity >= 50) // Require 50%+ exact word overlap
    .sort((a, b) => b.similarity - a.similarity);
}

// Helper function to find similar UOMs
function findSimilarUoms(userInput: string, existingUoms: UnitOfMeasure[]): UnitOfMeasure[] {
  const inputLower = userInput.toLowerCase();
  
  return existingUoms
    .filter(uom => 
      uom.code.toLowerCase().includes(inputLower) ||
      uom.name.toLowerCase().includes(inputLower) ||
      uom.abbreviation.toLowerCase().includes(inputLower) ||
      inputLower.includes(uom.code.toLowerCase()) ||
      inputLower.includes(uom.name.toLowerCase())
    )
    .slice(0, 5);
}

export default router;
