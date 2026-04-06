import { logError } from "../utils/logger";
import OpenAI from 'openai';

let openaiInstance: OpenAI | null = null;

// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access
// without requiring your own OpenAI API key. Usage is billed to your Replit credits.
// The newest OpenAI model is "gpt-5" which was released August 7, 2025.
function getOpenAI(): OpenAI {
  if (!openaiInstance) {
    // Check for Replit AI Integrations first, fall back to direct OpenAI API key
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error("OpenAI API key is missing. Set up Replit AI Integrations or provide OPENAI_API_KEY.");
    }
    
    openaiInstance = new OpenAI({
      baseURL: baseURL || undefined,
      apiKey: apiKey,
    });
  }
  return openaiInstance;
}

export const openai = new Proxy({} as OpenAI, {
  get(_, prop) {
    return (getOpenAI() as any)[prop];
  }
});

export const AI_MODEL_GPT5 = 'gpt-5';
export const AI_MODEL_GPT4O = 'gpt-4o';
export const AI_MODEL_FALLBACK = AI_MODEL_GPT4O;

export interface AIAnalysisResponse {
  analysis_summary: string;
  profitability_insights: {
    project_code: string;
    project_name: string;
    status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
    budget_variance_percent: number;
    projected_completion_cost: number;
    key_findings: string[];
    recommendations: string[];
  }[];
  tasks: {
    task_type: 'DAILY_TASK' | 'APPROVAL' | 'BILLING' | 'PROCUREMENT' | 'BID' | 'SCHEDULING';
    role: 'ADMIN' | 'MANAGER' | 'SUPERINTENDENT' | 'ESTIMATOR' | 'FIELD_WORKER';
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    due_date_offset_days: number;
    project_code: string | null;
    metadata: {
      estimated_time_minutes: number;
      related_entity_id?: string | null;
      action_required: string;
    };
  }[];
  crew_scheduling: {
    recommendations: string[];
    understaffed_projects: string[];
    overtime_warnings: string[];
  };
  material_ordering: {
    urgent_orders: {
      project_code: string;
      item_description: string;
      needed_by: string;
      estimated_cost: number;
    }[];
  };
  billing_alerts: {
    overdue_invoices: {
      project_code: string;
      days_overdue: number;
      amount: number;
    }[];
    upcoming_billing_cycles: string[];
  };
  bid_reminders: {
    client_name: string;
    bid_amount: number;
    due_date: string;
    status: string;
    action_needed: string;
  }[];
  change_order_suggestions?: {
    project_code: string;
    source_type: 'DELAY' | 'INSPECTION' | 'SCOPE_CHANGE';
    source_id: string;
    title: string;
    description: string;
    justification: string;
    estimated_amount: number;
    confidence: number;
    line_items: {
      labor: { description: string; hours: number; rate: number; amount: number }[];
      materials: { description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
      equipment: { description: string; days: number; dailyRate: number; amount: number }[];
    };
  }[];
  cost_overrun_predictions?: {
    project_code: string;
    predicted_overrun_amount: number;
    confidence_score: number;
    trend_direction: 'INCREASING' | 'STABLE' | 'DECREASING';
    weeks_until_overrun: number | null;
    key_drivers: string[];
    recommended_actions: string[];
  }[];
  subcontractor_recommendations?: {
    task_reference: string;
    trade_specialty: string;
    project_code: string;
    recommended_action: string;
  }[];
}

export async function callOpenAIForAnalysis(
  systemPrompt: string,
  userPrompt: string,
  modelName: string = AI_MODEL_GPT5
): Promise<AIAnalysisResponse> {
  const completion = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  try {
    const parsed = JSON.parse(content);
    return parsed as AIAnalysisResponse;
  } catch (error) {
    logError('Failed to parse OpenAI response:', {}, error instanceof Error ? error : new Error(String(error)));
    logError('Raw response:', { detail: String(content) });
    throw new Error('Invalid JSON response from OpenAI');
  }
}

// Trade Research Types for Custom Trade Onboarding
export interface TradeResearchResult {
  tradeName: string;
  tradeDescription: string;
  scopeOfWorkItems: {
    name: string;
    description: string;
    unit: string;
    category: string;
  }[];
  commonMaterials: {
    name: string;
    description: string;
    unit: string;
    category: string;
  }[];
  workTypes: {
    name: string;
    unit: string;
    typicalProductionRate?: string;
    description: string;
  }[];
  calculators: {
    name: string;
    description: string;
    outputUnit: string;
    inputs: { name: string; unit: string }[];
  }[];
  vendorCategories: string[];
  industryNotes: string;
}

const TRADE_RESEARCH_PROMPT = `You are an expert construction industry researcher with deep knowledge of specialty trades, subcontractors, and niche construction services.

Your task is to research and provide comprehensive, accurate information about a specific construction trade that a contractor is registering for. This information will be used to set up their construction management platform with industry-appropriate templates.

IMPORTANT GUIDELINES:
1. Provide REAL, ACCURATE industry information - not generic placeholders
2. Use standard construction industry units of measure (SF, LF, EA, HR, CY, GAL, etc.)
3. Include trade-specific terminology and common work items
4. Consider both residential and commercial applications where applicable
5. Think about what a contractor in this trade would actually bill for and track

Respond with a JSON object matching this EXACT structure:
{
  "tradeName": "string - the formal trade name",
  "tradeDescription": "string - 1-2 sentence description of what this trade does",
  "scopeOfWorkItems": [
    {
      "name": "string - specific work item name (Title Case)",
      "description": "string - what this work involves",
      "unit": "string - unit of measure (SF, LF, EA, HR, etc.)",
      "category": "string - category grouping for this item"
    }
  ],
  "commonMaterials": [
    {
      "name": "string - material name",
      "description": "string - material description/specifications",
      "unit": "string - how it's purchased/measured",
      "category": "string - material category"
    }
  ],
  "workTypes": [
    {
      "name": "string - type of work activity",
      "unit": "string - how it's measured",
      "typicalProductionRate": "string - e.g., '100 SF/HR' or '2 EA/DAY'",
      "description": "string - what this work type covers"
    }
  ],
  "calculators": [
    {
      "name": "string - calculator name",
      "description": "string - what it calculates",
      "outputUnit": "string - output measurement",
      "inputs": [{ "name": "string", "unit": "string" }]
    }
  ],
  "vendorCategories": ["string - types of vendors/suppliers needed"],
  "industryNotes": "string - any important notes about this trade (licensing, certifications, seasonal considerations, etc.)"
}

Provide at least:
- 8-12 scope of work items covering the main services
- 6-10 common materials
- 4-6 work types
- 2-4 useful calculators
- 3-5 vendor categories`;

export async function researchCustomTrade(tradeName: string): Promise<TradeResearchResult> {
  console.log(`[Trade Research] Researching trade: ${tradeName}`);
  
  const userPrompt = `Research the following construction trade and provide comprehensive industry information:

Trade: "${tradeName}"

Provide detailed, accurate information about this trade including common scope of work items, materials used, work types, useful calculators, and vendor categories. Be specific to this trade - not generic construction items.

If this is a very specialized or niche trade, do your best to provide relevant information based on similar trades or the nature of the work described.`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT5,
      messages: [
        { role: 'system', content: TRADE_RESEARCH_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI for trade research');
    }

    const parsed = JSON.parse(content);
    console.log(`[Trade Research] Successfully researched ${tradeName}: ${parsed.scopeOfWorkItems?.length || 0} SOW items, ${parsed.commonMaterials?.length || 0} materials`);
    
    return parsed as TradeResearchResult;
  } catch (error) {
    logError('[Trade Research] Error researching trade:', {}, error instanceof Error ? error : new Error(String(error)));
    
    // Return a minimal fallback structure if research fails
    return {
      tradeName: tradeName,
      tradeDescription: `${tradeName} contracting services`,
      scopeOfWorkItems: [
        { name: `${tradeName} - Standard Service`, description: 'Standard service work', unit: 'EA', category: tradeName },
        { name: `${tradeName} - Installation`, description: 'Installation work', unit: 'EA', category: tradeName },
        { name: `${tradeName} - Repair`, description: 'Repair work', unit: 'HR', category: tradeName },
        { name: `${tradeName} - Maintenance`, description: 'Maintenance work', unit: 'HR', category: tradeName },
        { name: `${tradeName} - Consultation`, description: 'Consultation services', unit: 'EA', category: tradeName },
      ],
      commonMaterials: [
        { name: 'General Supplies', description: 'Trade-specific supplies', unit: 'EA', category: 'Supplies' },
        { name: 'Consumables', description: 'Consumable materials', unit: 'EA', category: 'Consumables' },
      ],
      workTypes: [
        { name: 'General Work', unit: 'HR', description: 'General labor' },
        { name: 'Project Completion', unit: 'EA', description: 'Complete project work' },
        { name: 'Service Call', unit: 'EA', description: 'Service call work' },
      ],
      calculators: [
        { name: 'Material Quantity Calculator', description: 'Calculate material quantities', outputUnit: 'units', inputs: [{ name: 'area', unit: 'SF' }, { name: 'coverage_rate', unit: 'SF/unit' }] },
      ],
      vendorCategories: ['Suppliers', 'Equipment Rental'],
      industryNotes: 'Research data unavailable - using default configuration.',
    };
  }
}
