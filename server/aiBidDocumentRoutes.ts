import { Router, type Response } from "express";
import { db } from "./db";
import { 
  aiBidDocumentAnalysis, 
  bids, 
  organizations,
  insertAIBidDocumentAnalysisSchema,
  type AIBidDocumentAnalysis 
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { openai, AI_MODEL_GPT4O } from "./ai/openaiClient";
import { extractDocumentContent } from "./ai/documentExtractor";

const router = Router();

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

async function analyzeDocumentWithAI(documentUrl: string, documentName: string, tradeType?: string): Promise<BidDocumentAnalysisResult> {
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
    const documentImages = await extractDocumentContent(documentUrl);
    
    let messages: any[] = [
      { role: 'system', content: BID_DOCUMENT_ANALYSIS_SYSTEM_PROMPT },
    ];

    if (documentImages.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          ...documentImages,
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: `${userPrompt}\n\nNote: The document could not be visually rendered. Analyze based on the document name and any available context.`
      });
    }

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return parsed as BidDocumentAnalysisResult;
  } catch (error) {
    console.error("AI document analysis error:", error);
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
router.get("/ai-bid-document/bids", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get bids for AI analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Main endpoint for frontend - GET /api/ai-bid-document
router.get("/ai-bid-document", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get AI bid document analyses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-bid-document/analyze - Create new analysis (frontend endpoint)
router.post("/ai-bid-document/analyze", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
        const result = await analyzeDocumentWithAI(fileUrl, fileName, org?.tradeType || undefined);
        
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
        console.error("Background AI analysis error:", error);
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
    console.error("Create AI bid document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-bid-document/:id/reanalyze - Reanalyze (frontend endpoint)
router.post("/ai-bid-document/:id/reanalyze", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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

        const result = await analyzeDocumentWithAI(existing.documentUrl, existing.documentName, org?.tradeType || undefined);
        
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
        console.error("Background AI reanalysis error:", error);
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
    console.error("Reanalyze AI bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/ai-bid-document/:id/archive - Soft delete (archive) an analysis
router.patch("/ai-bid-document/:id/archive", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Archive AI bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/ai-bid-document/:id/restore - Restore an archived analysis
router.patch("/ai-bid-document/:id/restore", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Restore AI bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/ai-bid-document/:id - Hard delete (permanent) an analysis
router.delete("/ai-bid-document/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Delete AI bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/bid-document-analysis", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get AI bid document analyses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/bid-document-analysis/bid/:bidId", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get bid document analyses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/bid-document-analysis/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get bid document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const createAnalysisSchema = z.object({
  bidId: z.string().optional(),
  documentUrl: z.string().url(),
  documentName: z.string(),
  documentType: z.string().optional(),
});

const createAnalysisSchemaExtended = z.object({
  bidId: z.string().optional(),
  organizationId: z.string().optional(),
  documentUrl: z.string().url(),
  documentName: z.string(),
  documentType: z.string().optional(),
});

router.post("/ai/bid-document-analysis", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
        console.error("Background AI analysis error:", error);
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
    console.error("Create AI bid document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai/bid-document-analysis/:id/reanalyze", requireAuth, requireRole("ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
        console.error("Background AI re-analysis error:", error);
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
    console.error("Reanalyze bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/ai/bid-document-analysis/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Delete bid document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// AI Bid Wizard - Analyze multiple documents for new bid creation
const wizardAnalyzeSchema = z.object({
  documents: z.array(z.object({
    url: z.string().url(),
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
    return false;
  }
}

router.post("/ai-bid-wizard/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res: Response) => {
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

    const allDocumentImages: Array<{type: 'image_url', image_url: {url: string, detail: string}}> = [];
    for (const doc of documents) {
      try {
        const images = await extractDocumentContent(doc.url);
        allDocumentImages.push(...images);
      } catch (extractError) {
        console.error(`[AI Bid Wizard] Failed to extract content from ${doc.name}:`, extractError);
      }
    }

    console.log(`[AI Bid Wizard] Extracted ${allDocumentImages.length} page images from ${documents.length} documents`);

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

      if (allDocumentImages.length > 0) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            ...allDocumentImages,
          ]
        });
      } else {
        messages.push({
          role: 'user',
          content: `${userPrompt}\n\nNote: The documents could not be visually rendered. Analyze based on the document names and any available context.`
        });
      }

      const completion = await openai.chat.completions.create({
        model: AI_MODEL_GPT4O,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI');
      }

      const result = JSON.parse(content);
      
      console.log(`[AI Bid Wizard] Extracted ${result.scopeItems?.length || 0} scope items`);
      
      res.json(result);
    } catch (aiError) {
      console.error('[AI Bid Wizard] AI analysis error:', aiError instanceof Error ? aiError.message : 'Unknown');
      
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
    console.error("[AI Bid Wizard] Error:", error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
