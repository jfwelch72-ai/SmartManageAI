import { logError, logInfo } from "../utils/logger";
import { openai, AI_MODEL_GPT5 } from './openaiClient';
import { routedChatCompletion } from './providers';
import { governedAiCall } from '../services/aiGovernance';
import { db } from '../db';
import { masterSowItems, masterModifierCategories, masterModifiers, tradeTypeEnum } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { getTrades, getTradeCategories, getTradesByCategory, type Trade } from '../data/onboarding';
import { mapOnboardingTradeIdToLegacy, isValidTradeType } from '@shared/tradeTypeUtils';

export interface TradeDiscoveryResult {
  primaryTrade: string;
  primaryTradeConfidence: number;
  relatedTrades: Array<{
    tradeType: string;
    relevance: number;
    reason: string;
  }>;
  projectCharacteristics: {
    projectType: string;
    estimatedScope: 'SMALL' | 'MEDIUM' | 'LARGE';
    keyWorkItems: string[];
    specialConsiderations: string[];
  };
  aiNotes: string;
}

export interface TradeMatchingContext {
  projectDescription?: string;
  projectName?: string;
  projectType?: string;
  existingScope?: string[];
  bidDocumentExtracts?: string[];
}

const TRADE_CATEGORIES = {
  CIVIL_SITE: [
    'SITE_DEMOLITION', 'MASS_EXCAVATION', 'TRENCHING', 'SHORING', 'DEWATERING',
    'SOIL_STABILIZATION', 'ENVIRONMENTAL_REMEDIATION', 'WELL_PLUGGING',
    'STORMWATER_SYSTEMS', 'SANITARY_SEWER', 'WATERLINE', 'FORCE_MAIN',
    'ROADWAY_CONSTRUCTION', 'CURB_AND_GUTTER', 'SIDEWALK', 'CONCRETE_PAVING',
    'TRAFFIC_CONTROL', 'STRIPING_AND_SIGNAGE', 'EROSION_CONTROL', 'FENCING_AND_GATES'
  ],
  STRUCTURAL_BUILDING: [
    'CAST_IN_PLACE_CONCRETE', 'PRECAST_CONCRETE', 'REBAR_AND_POST_TENSION',
    'STRUCTURAL_STEEL', 'METAL_BUILDINGS', 'CARPENTRY_FRAMING', 'DRYWALL_SYSTEMS',
    'ACOUSTICAL_CEILINGS', 'PAINTING_AND_COATINGS', 'FLOORING_SYSTEMS',
    'ROOFING_SYSTEMS', 'MASONRY_SYSTEMS', 'GLAZING_SYSTEMS'
  ],
  MEP_SPECIALTY: [
    'ELECTRICAL_UNDERGROUND', 'ELECTRICAL_OVERHEAD', 'MECHANICAL_PIPING',
    'HVAC_SYSTEMS', 'PLUMBING_SYSTEMS', 'FIRE_PROTECTION_SYSTEMS',
    'LOW_VOLTAGE_SYSTEMS', 'SECURITY_AND_ACCESS', 'COMMUNICATIONS_IT',
    'SOLAR_INSTALLATION', 'TEMPORARY_POWER'
  ],
  SUPPORT_SERVICES: [
    'SURVEY_AND_LAYOUT', 'TESTING_AND_INSPECTIONS', 'COMMISSIONING',
    'TEMPORARY_FACILITIES', 'GENERAL_CONDITIONS'
  ],
  ORIGINAL_TRADES: [
    'GENERAL_CONTRACTOR', 'CONCRETE', 'EARTHWORK', 'ASPHALT_PAVING', 'ROOFING',
    'ELECTRICAL', 'PLUMBING', 'HVAC', 'CARPENTRY', 'MASONRY', 'DRYWALL',
    'PAINTING', 'FLOORING', 'LANDSCAPING', 'DEMOLITION', 'STEEL_ERECTION',
    'GLAZING', 'INSULATION', 'FIRE_PROTECTION', 'LOW_VOLTAGE', 'SOLAR',
    'WATERPROOFING', 'OTHER'
  ]
};

const ALL_TRADES = [
  ...TRADE_CATEGORIES.ORIGINAL_TRADES,
  ...TRADE_CATEGORIES.CIVIL_SITE,
  ...TRADE_CATEGORIES.STRUCTURAL_BUILDING,
  ...TRADE_CATEGORIES.MEP_SPECIALTY,
  ...TRADE_CATEGORIES.SUPPORT_SERVICES
];

function buildLibraryTradeTaxonomy(): { categories: Record<string, string[]>; allTradeIds: string[] } {
  const categories: Record<string, string[]> = {};
  const allTradeIds: string[] = [];
  for (const cat of getTradeCategories()) {
    const trades = getTradesByCategory(cat);
    categories[cat] = trades.map(t => t.trade_id);
    allTradeIds.push(...categories[cat]);
  }
  return { categories, allTradeIds };
}

const LIBRARY_TAXONOMY = buildLibraryTradeTaxonomy();

const EXTENDED_ALL_TRADES = [...new Set([...ALL_TRADES, ...LIBRARY_TAXONOMY.allTradeIds])];

function buildTradeDiscoveryPrompt(): string {
  const categoryBlock = Object.entries(LIBRARY_TAXONOMY.categories)
    .map(([cat, tradeIds]) => `${cat}:\n${tradeIds.join(', ')}`)
    .join('\n\n');

  return `You are an expert construction industry analyst specializing in trade classification and project scoping.

Your task is to analyze a project description and identify the most relevant construction trades from our comprehensive taxonomy of ${LIBRARY_TAXONOMY.allTradeIds.length} trades.

AVAILABLE TRADES (grouped by ${Object.keys(LIBRARY_TAXONOMY.categories).length} categories):

${categoryBlock}

LEGACY TRADE CODES (also accepted):
${ALL_TRADES.join(', ')}

IMPORTANT GUIDELINES:
1. Identify the PRIMARY trade that best matches the project scope — prefer specific library trade_ids (e.g., "concrete_cast_in_place") over legacy codes (e.g., "CONCRETE")
2. List RELATED trades that would typically be involved or subcontracted
3. Assign confidence scores (0.0-1.0) based on how clearly the project matches
4. Consider both explicit mentions and implied work (e.g., "building a parking lot" implies asphalt_paving, striping_pavement_markings, erosion_control_seeding)
5. Identify key work items that would be part of this project
6. Note any special considerations (permits, environmental, safety, etc.)

Respond with JSON matching this EXACT structure:
{
  "primaryTrade": "trade_id_here",
  "primaryTradeConfidence": 0.85,
  "relatedTrades": [
    {
      "tradeType": "trade_id",
      "relevance": 0.75,
      "reason": "Why this trade is relevant"
    }
  ],
  "projectCharacteristics": {
    "projectType": "Commercial/Residential/Industrial/Infrastructure/Municipal",
    "estimatedScope": "SMALL|MEDIUM|LARGE",
    "keyWorkItems": ["list of main work items"],
    "specialConsiderations": ["permits needed", "environmental concerns", "safety requirements"]
  },
  "aiNotes": "Additional observations about the project scope"
}`;
}

const TRADE_DISCOVERY_PROMPT = buildTradeDiscoveryPrompt();

export async function discoverTradesFromDescription(context: TradeMatchingContext, govContext?: { orgId: string; userId: string }): Promise<TradeDiscoveryResult> {
  logInfo('[TradeDiscoveryService] Analyzing project for trade matching');

  const userPrompt = `Analyze the following project information and identify the most relevant construction trades:

${context.projectName ? `Project Name: ${context.projectName}` : ''}
${context.projectType ? `Project Type: ${context.projectType}` : ''}
${context.projectDescription ? `Description: ${context.projectDescription}` : ''}
${context.existingScope?.length ? `Existing Scope Items: ${context.existingScope.join(', ')}` : ''}
${context.bidDocumentExtracts?.length ? `Bid Document Extracts:\n${context.bidDocumentExtracts.join('\n')}` : ''}

Identify the primary trade and all related trades that would be involved in this project.`;

  try {
    const aiCallFn = async () => {
      // Task #2423 — route through provider abstraction. Trade discovery is
      // typically the FIRST estimation-family call for a project, so it
      // bootstraps the prior-context bridge ring keyed by project name.
      const completion = await routedChatCompletion({
        orgId: govContext?.orgId ?? "system",
        featureKey: "estimation.trade_discovery",
        priorContext: govContext && context.projectName
          ? { orgId: govContext.orgId, scopeId: `project-name:${context.projectName}` }
          : undefined,
        request: {
          messages: [
            { role: 'system', content: TRADE_DISCOVERY_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: 2048,
        },
      });
      return {
        result: completion.choices[0]?.message?.content,
        completion,
      };
    };

    let content: string | null | undefined;
    if (govContext) {
      const govResult = await governedAiCall({
        orgId: govContext.orgId,
        userId: govContext.userId,
        actionType: "trade_discovery",
        inputRefs: { projectName: context.projectName, projectType: context.projectType },
        fn: aiCallFn,
      });
      if (govResult.blocked) {
        throw new Error(govResult.reason || "AI usage limit reached");
      }
      content = govResult.result;
    } else {
      const raw = await aiCallFn();
      content = raw.result;
    }

    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const result = JSON.parse(content) as TradeDiscoveryResult;
    
    if (!EXTENDED_ALL_TRADES.includes(result.primaryTrade)) {
      result.primaryTrade = 'GENERAL_CONTRACTOR';
      result.primaryTradeConfidence = 0.5;
    }
    
    if (!isValidTradeType(result.primaryTrade)) {
      const legacyType = mapOnboardingTradeIdToLegacy(result.primaryTrade);
      (result as any).libraryTradeId = result.primaryTrade;
      (result as any).legacyTradeType = legacyType;
    }
    
    result.relatedTrades = result.relatedTrades.filter(t => EXTENDED_ALL_TRADES.includes(t.tradeType));

    logInfo(`[TradeDiscoveryService] Identified primary trade: ${result.primaryTrade} (${result.primaryTradeConfidence} confidence), ${result.relatedTrades.length} related trades`);
    
    return result;
  } catch (error) {
    logError('[TradeDiscoveryService] Error:', {}, error instanceof Error ? error : new Error(String(error)));
    
    // Return a safe fallback
    return {
      primaryTrade: 'GENERAL_CONTRACTOR',
      primaryTradeConfidence: 0.3,
      relatedTrades: [],
      projectCharacteristics: {
        projectType: 'Unknown',
        estimatedScope: 'MEDIUM',
        keyWorkItems: [],
        specialConsiderations: [],
      },
      aiNotes: 'Trade analysis unavailable - using default configuration',
    };
  }
}

export async function getTradesWithSowCounts(): Promise<Array<{ tradeType: string; sowCount: number; categories: string[] }>> {
  const sowItems = await db.select({
    tradeType: masterSowItems.tradeType,
    categoryName: masterSowItems.categoryName,
  }).from(masterSowItems).where(eq(masterSowItems.isActive, true));

  const tradeMap = new Map<string, { count: number; categories: Set<string> }>();
  
  for (const item of sowItems) {
    if (!tradeMap.has(item.tradeType)) {
      tradeMap.set(item.tradeType, { count: 0, categories: new Set() });
    }
    const entry = tradeMap.get(item.tradeType)!;
    entry.count++;
    entry.categories.add(item.categoryName);
  }

  return Array.from(tradeMap.entries()).map(([tradeType, data]) => ({
    tradeType,
    sowCount: data.count,
    categories: Array.from(data.categories),
  }));
}

export async function suggestTradesForBidDocument(documentText: string, govContext?: { orgId: string; userId: string }): Promise<TradeDiscoveryResult> {
  return discoverTradesFromDescription({
    bidDocumentExtracts: [documentText.slice(0, 10000)],
  }, govContext);
}

export async function getTradeModifierCategories(tradeTypes: string[]): Promise<Array<{
  tradeType: string;
  categories: Array<{ id: string; name: string; description: string | null }>;
}>> {
  if (!tradeTypes.length) return [];

  const categories = await db.select({
    id: masterModifierCategories.id,
    tradeType: masterModifierCategories.tradeType,
    name: masterModifierCategories.name,
    description: masterModifierCategories.description,
  })
    .from(masterModifierCategories)
    .where(inArray(masterModifierCategories.tradeType, tradeTypes as any));

  const grouped = new Map<string, Array<{ id: string; name: string; description: string | null }>>();
  
  for (const cat of categories) {
    if (!grouped.has(cat.tradeType)) {
      grouped.set(cat.tradeType, []);
    }
    grouped.get(cat.tradeType)!.push({
      id: cat.id,
      name: cat.name,
      description: cat.description,
    });
  }

  return Array.from(grouped.entries()).map(([tradeType, cats]) => ({
    tradeType,
    categories: cats,
  }));
}

export { TRADE_CATEGORIES, ALL_TRADES, EXTENDED_ALL_TRADES, LIBRARY_TAXONOMY };
