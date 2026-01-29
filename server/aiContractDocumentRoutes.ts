import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { aiContractDocumentAnalysis, projects, organizations } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import OpenAI from "openai";
import { openai } from "./ai/openaiClient";

const router = Router();

const AI_MODEL_GPT4O = "gpt-4o";

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
  tradeType?: string
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

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 6000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(content);
    return parsed as ContractDocumentAnalysisResult;
  } catch (error) {
    console.error("AI contract document analysis error:", error);
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

function safeJsonParse(value: string | null | undefined, defaultValue: any[] = []): any {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
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
router.get("/ai-contract-document/projects", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get projects for contract analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Main endpoint for frontend - GET /api/ai-contract-document
router.get("/ai-contract-document", requireAuth, async (req: AuthRequest, res: Response) => {
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
          console.error('Failed to parse analysisResult:', e);
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
    console.error("Get AI contract document analyses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-contract-document/analyze - Create new analysis (frontend endpoint)
router.post("/ai-contract-document/analyze", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
        const result = await analyzeContractWithAI(fileUrl, fileName, documentType || "CONTRACT");
        
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
        console.error("Background AI contract analysis error:", error);
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
    console.error("Create AI contract document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-contract-document/:id/reanalyze - Reanalyze (frontend endpoint)
router.post("/ai-contract-document/:id/reanalyze", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
        const result = await analyzeContractWithAI(existing.documentUrl, existing.documentName, existing.documentType || "CONTRACT");
        
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
        console.error("Background AI contract reanalysis error:", error);
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
    console.error("Reanalyze AI contract document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/contract-document-analysis", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get AI contract document analyses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/contract-document-analysis/project/:projectId", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get project contract analyses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/contract-document-analysis/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Get contract document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const createContractAnalysisSchema = z.object({
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  documentUrl: z.string().url(),
  documentName: z.string(),
  documentType: z.string().optional(),
});

router.post("/ai/contract-document-analysis", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
        const result = await analyzeContractWithAI(documentUrl, documentName, org?.tradeType || undefined);
        
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
        console.error("Background AI contract analysis error:", error);
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
    console.error("Create AI contract document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai/contract-document-analysis/:id/reanalyze", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "ESTIMATOR", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
          org?.tradeType || undefined
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
        console.error("Background AI contract re-analysis error:", error);
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
    console.error("Reanalyze contract document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/ai/contract-document-analysis/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
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
    console.error("Delete contract document analysis error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
