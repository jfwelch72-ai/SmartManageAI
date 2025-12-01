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
Document URL: ${documentUrl}

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
    const isImageUrl = documentUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    
    let messages: any[] = [
      { role: 'system', content: BID_DOCUMENT_ANALYSIS_SYSTEM_PROMPT },
    ];

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

router.post("/ai/bid-document-analysis", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"]), async (req: AuthRequest, res: Response) => {
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

router.post("/ai/bid-document-analysis/:id/reanalyze", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"]), async (req: AuthRequest, res: Response) => {
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

router.delete("/ai/bid-document-analysis/:id", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]), async (req: AuthRequest, res: Response) => {
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

export default router;
