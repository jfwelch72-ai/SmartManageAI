import { openai, AI_MODEL_GPT4O } from './openaiClient';
import { db } from '../db';
import { masterSowItems, masterModifiers, masterModifierCategories, organizationSowItems } from '@shared/schema';
import { eq, inArray, and, like, or, sql } from 'drizzle-orm';
import { ALL_TRADES, TRADE_CATEGORIES } from './tradeDiscoveryService';

export interface ScopePredictionContext {
  tradeType: string;
  projectDescription?: string;
  projectType?: string;
  estimatedValue?: number;
  existingScopeItems?: string[];
  relatedTrades?: string[];
}

export interface PredictedScopeItem {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  defaultUomCode: string | null;
  relevanceScore: number;
  reason: string;
  isFromMaster: boolean;
  tradeType: string;
}

export interface ScopePredictionResult {
  predictedItems: PredictedScopeItem[];
  suggestedModifiers: Array<{
    categoryId: string;
    categoryName: string;
    modifiers: Array<{
      id: string;
      name: string;
      code: string;
    }>;
  }>;
  aiRecommendations: string[];
  completenessScore: number;
  missingScopeAreas: string[];
}

export interface ScopeSearchResult {
  items: Array<{
    id: string;
    tradeType: string;
    name: string;
    code: string;
    categoryName: string;
    defaultUomCode: string | null;
    isFromMaster: boolean;
  }>;
  totalCount: number;
}

const SCOPE_PREDICTION_PROMPT = `You are an expert construction estimator and project manager. Your task is to analyze a project context and predict which scope of work items would be most relevant.

Given a project's trade type, description, and any existing scope items, you will:
1. Identify the most relevant scope items from the provided master list
2. Score each item's relevance (0.0-1.0) based on how likely it is to be needed
3. Provide reasoning for high-relevance items
4. Identify any missing scope areas that might be overlooked
5. Provide recommendations for a complete scope of work

Respond with JSON matching this EXACT structure:
{
  "rankedItemIds": [
    {
      "id": "item_id_here",
      "relevanceScore": 0.95,
      "reason": "Why this item is highly relevant"
    }
  ],
  "missingScopeAreas": ["list of work areas not covered by provided items"],
  "recommendations": ["list of recommendations for complete scope coverage"],
  "completenessScore": 0.85
}

Focus on practical, commonly-used items for the given project type. Consider:
- Standard work items for the trade
- Items that are often overlooked but important
- Seasonal or regional considerations
- Safety and compliance requirements`;

export async function predictRelevantScopeItems(
  context: ScopePredictionContext,
  limit: number = 20
): Promise<ScopePredictionResult> {
  console.log(`[ScopePredictionEngine] Predicting scope for trade: ${context.tradeType}`);

  // Get master SOW items for the primary trade and related trades
  const tradesToQuery = [context.tradeType, ...(context.relatedTrades || [])];
  
  const masterItems = await db.select({
    id: masterSowItems.id,
    tradeType: masterSowItems.tradeType,
    name: masterSowItems.name,
    code: masterSowItems.code,
    categoryName: masterSowItems.categoryName,
    defaultUomCode: masterSowItems.defaultUomCode,
    description: masterSowItems.description,
  })
    .from(masterSowItems)
    .where(and(
      inArray(masterSowItems.tradeType, tradesToQuery as any),
      eq(masterSowItems.isActive, true)
    ))
    .limit(100);

  if (masterItems.length === 0) {
    console.log('[ScopePredictionEngine] No master items found, returning empty result');
    return {
      predictedItems: [],
      suggestedModifiers: [],
      aiRecommendations: ['No scope items available for this trade. Consider adding custom items.'],
      completenessScore: 0,
      missingScopeAreas: [],
    };
  }

  // Get modifiers for the trade
  const modifierCategories = await db.select({
    id: masterModifierCategories.id,
    name: masterModifierCategories.name,
    tradeType: masterModifierCategories.tradeType,
  })
    .from(masterModifierCategories)
    .where(and(
      inArray(masterModifierCategories.tradeType, tradesToQuery as any),
      eq(masterModifierCategories.isActive, true)
    ))
    .limit(20);

  const modifiers = modifierCategories.length > 0 
    ? await db.select({
        id: masterModifiers.id,
        categoryId: masterModifiers.categoryId,
        name: masterModifiers.name,
        code: masterModifiers.code,
      })
        .from(masterModifiers)
        .where(and(
          inArray(masterModifiers.categoryId, modifierCategories.map(c => c.id)),
          eq(masterModifiers.isActive, true)
        ))
        .limit(50)
    : [];

  // Use AI to rank and predict relevant items
  const itemsList = masterItems.map(item => ({
    id: item.id,
    name: item.name,
    category: item.categoryName,
    trade: item.tradeType,
  }));

  const userPrompt = `Analyze this project context and rank the scope items by relevance:

Trade Type: ${context.tradeType}
${context.projectType ? `Project Type: ${context.projectType}` : ''}
${context.projectDescription ? `Description: ${context.projectDescription}` : ''}
${context.estimatedValue ? `Estimated Value: $${context.estimatedValue.toLocaleString()}` : ''}
${context.existingScopeItems?.length ? `Existing Scope: ${context.existingScopeItems.join(', ')}` : ''}

Available scope items to rank:
${JSON.stringify(itemsList, null, 2)}

Rank the top ${limit} most relevant items and identify any missing scope areas.`;

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: SCOPE_PREDICTION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2048,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const aiResult = JSON.parse(content);
    
    // Map AI rankings back to full item data
    const rankedItemMap = new Map<string, { relevanceScore: number; reason: string }>();
    for (const ranked of aiResult.rankedItemIds || []) {
      rankedItemMap.set(ranked.id, {
        relevanceScore: ranked.relevanceScore || 0.5,
        reason: ranked.reason || '',
      });
    }

    const predictedItems: PredictedScopeItem[] = masterItems
      .filter(item => rankedItemMap.has(item.id))
      .map(item => {
        const ranking = rankedItemMap.get(item.id)!;
        return {
          id: item.id,
          name: item.name,
          code: item.code,
          categoryName: item.categoryName,
          defaultUomCode: item.defaultUomCode,
          relevanceScore: ranking.relevanceScore,
          reason: ranking.reason,
          isFromMaster: true,
          tradeType: item.tradeType,
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    // Group modifiers by category
    const suggestedModifiers = modifierCategories.map(cat => ({
      categoryId: cat.id,
      categoryName: cat.name,
      modifiers: modifiers
        .filter(m => m.categoryId === cat.id)
        .map(m => ({
          id: m.id,
          name: m.name,
          code: m.code,
        })),
    })).filter(cat => cat.modifiers.length > 0);

    console.log(`[ScopePredictionEngine] Predicted ${predictedItems.length} items with ${suggestedModifiers.length} modifier categories`);

    return {
      predictedItems,
      suggestedModifiers,
      aiRecommendations: aiResult.recommendations || [],
      completenessScore: aiResult.completenessScore || 0.5,
      missingScopeAreas: aiResult.missingScopeAreas || [],
    };
  } catch (error) {
    console.error('[ScopePredictionEngine] Error:', error);
    
    // Return items sorted by default without AI ranking
    return {
      predictedItems: masterItems.slice(0, limit).map(item => ({
        id: item.id,
        name: item.name,
        code: item.code,
        categoryName: item.categoryName,
        defaultUomCode: item.defaultUomCode,
        relevanceScore: 0.5,
        reason: 'Default suggestion',
        isFromMaster: true,
        tradeType: item.tradeType,
      })),
      suggestedModifiers: [],
      aiRecommendations: ['AI analysis unavailable - showing default items'],
      completenessScore: 0.5,
      missingScopeAreas: [],
    };
  }
}

export async function searchScopeItems(
  searchTerm: string,
  tradeTypes?: string[],
  organizationId?: string,
  limit: number = 50
): Promise<ScopeSearchResult> {
  const searchPattern = `%${searchTerm}%`;
  
  // Search master items
  let masterQuery = db.select({
    id: masterSowItems.id,
    tradeType: masterSowItems.tradeType,
    name: masterSowItems.name,
    code: masterSowItems.code,
    categoryName: masterSowItems.categoryName,
    defaultUomCode: masterSowItems.defaultUomCode,
  })
    .from(masterSowItems)
    .where(and(
      eq(masterSowItems.isActive, true),
      or(
        like(masterSowItems.name, searchPattern),
        like(masterSowItems.code, searchPattern),
        like(masterSowItems.categoryName, searchPattern)
      ),
      tradeTypes?.length ? inArray(masterSowItems.tradeType, tradeTypes as any) : undefined
    ))
    .limit(limit);

  const masterResults = await masterQuery;
  
  // Search organization-specific items if organizationId provided
  let orgResults: Array<{
    id: string;
    name: string;
    code: string;
    categoryName: string;
    unit: string | null;
  }> = [];

  if (organizationId) {
    orgResults = await db.select({
      id: organizationSowItems.id,
      name: organizationSowItems.name,
      code: organizationSowItems.code,
      categoryName: organizationSowItems.categoryName,
      unit: organizationSowItems.unit,
    })
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, organizationId),
        eq(organizationSowItems.isActive, true),
        or(
          like(organizationSowItems.name, searchPattern),
          like(organizationSowItems.code, searchPattern),
          like(organizationSowItems.categoryName, searchPattern)
        )
      ))
      .limit(limit);
  }

  const items = [
    ...masterResults.map(item => ({ ...item, isFromMaster: true })),
    ...orgResults.map(item => ({ 
      ...item, 
      tradeType: 'OTHER' as const,
      defaultUomCode: item.unit,
      isFromMaster: false 
    })),
  ];

  return {
    items: items.slice(0, limit),
    totalCount: items.length,
  };
}

export async function getScopeItemsForTrade(
  tradeType: string,
  organizationId?: string
): Promise<Array<{
  id: string;
  name: string;
  code: string;
  categoryName: string;
  defaultUomCode: string | null;
  isFromMaster: boolean;
}>> {
  // Get master items
  const masterItems = await db.select({
    id: masterSowItems.id,
    name: masterSowItems.name,
    code: masterSowItems.code,
    categoryName: masterSowItems.categoryName,
    defaultUomCode: masterSowItems.defaultUomCode,
  })
    .from(masterSowItems)
    .where(and(
      eq(masterSowItems.tradeType, tradeType as any),
      eq(masterSowItems.isActive, true)
    ));

  // Get org-specific items (organizationSowItems doesn't have tradeType, so get all for org)
  let orgItems: Array<{
    id: string;
    name: string;
    code: string;
    categoryName: string;
    unit: string | null;
  }> = [];

  if (organizationId) {
    orgItems = await db.select({
      id: organizationSowItems.id,
      name: organizationSowItems.name,
      code: organizationSowItems.code,
      categoryName: organizationSowItems.categoryName,
      unit: organizationSowItems.unit,
    })
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, organizationId),
        eq(organizationSowItems.isActive, true)
      ));
  }

  return [
    ...masterItems.map(item => ({ ...item, isFromMaster: true })),
    ...orgItems.map(item => ({ 
      id: item.id,
      name: item.name,
      code: item.code,
      categoryName: item.categoryName,
      defaultUomCode: item.unit,
      isFromMaster: false 
    })),
  ];
}

export async function suggestScopeFromBidDocument(
  documentText: string,
  tradeType: string,
  limit: number = 30
): Promise<ScopePredictionResult> {
  return predictRelevantScopeItems({
    tradeType,
    projectDescription: documentText.slice(0, 8000), // Limit for API
  }, limit);
}

export async function getModifiersForScopeItem(
  tradeType: string,
  categoryId?: string
): Promise<Array<{
  category: { id: string; name: string };
  modifiers: Array<{ id: string; name: string; code: string }>;
}>> {
  const categories = await db.select({
    id: masterModifierCategories.id,
    name: masterModifierCategories.name,
  })
    .from(masterModifierCategories)
    .where(and(
      eq(masterModifierCategories.tradeType, tradeType as any),
      eq(masterModifierCategories.isActive, true),
      categoryId ? eq(masterModifierCategories.id, categoryId) : undefined
    ));

  if (categories.length === 0) return [];

  const modifiers = await db.select({
    id: masterModifiers.id,
    categoryId: masterModifiers.categoryId,
    name: masterModifiers.name,
    code: masterModifiers.code,
  })
    .from(masterModifiers)
    .where(and(
      inArray(masterModifiers.categoryId, categories.map(c => c.id)),
      eq(masterModifiers.isActive, true)
    ));

  return categories.map(cat => ({
    category: { id: cat.id, name: cat.name },
    modifiers: modifiers
      .filter(m => m.categoryId === cat.id)
      .map(m => ({ id: m.id, name: m.name, code: m.code })),
  }));
}

export { TRADE_CATEGORIES, ALL_TRADES };
