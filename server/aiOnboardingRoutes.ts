import { Router , NextFunction } from "express";
import { safeJsonParse } from "./responseHelper";
import { db } from "./db";
import { users, organizations, organizationSowItems, tradeTemplates, organizationCalculators, organizationWorkTypes, tradeTypeEnum, masterSowItems, hustlerOrganizations, unitsOfMeasure } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest, requireAuth } from "./auth";
import { sensitiveLimiter } from "./rateLimiter";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { logInfo, logError, logWarn } from "./utils/logger";
import { openai, researchCustomTrade, TradeResearchResult } from "./ai/openaiClient";
import { getTotalStepsForRole, getWalkthroughStep, getPersonalizedWalkthrough, personalizeContent } from "./ai/walkthroughContent";
import { governedAiCall } from "./services/aiGovernance";
import { seedScopeStandardizationForTrade } from "./seedTradeExpansion";
import { applyTradePreset } from "./services/featureFlagService";
import { getFeaturePresetForTrade } from "@shared/tradeFeaturePresets";
import { getTradeCategories, getTradesByCategory, getMaterialGroups, getMaterialsByGroup } from "./data/onboarding";

const router = Router();


// ========================================
// Routes from aiOnboardingRoutes.ts
// ========================================

const onboardingCompleteSchema = z.object({
  companyName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(2, "Company name must be at least 2 characters").max(200))
    .transform(s => sanitizeShortText(s)),
  tradeType: z.enum(tradeTypeEnum.enumValues, { 
    errorMap: () => ({ message: "Invalid trade type" }) 
  }),
  tradeName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().max(200))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  crewSize: z.number().int().min(1).max(10000).optional().nullable(),
  region: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().max(200))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  materials: z.array(
    z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(100))
      .transform(s => sanitizeShortText(s))
  ).max(50).optional().nullable(),
  workTypes: z.array(
    z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(100))
      .transform(s => sanitizeShortText(s))
  ).max(50).optional().nullable(),
  websiteUrl: z.string()
    .transform(s => s?.trim() || '')
    .transform(s => {
      if (s && s.length > 0 && !s.startsWith('http://') && !s.startsWith('https://')) {
        return `https://${s}`;
      }
      return s;
    })
    .pipe(z.string().url().max(500).or(z.literal('')))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  suggestedCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
  })).max(20).optional().nullable(),
  customSowItems: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
    unit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    category: z.string().max(100).transform(s => sanitizeShortText(s)).optional(),
  })).max(50).optional().nullable(),
  customWorkTypes: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    unit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    defaultRate: z.number().optional(),
  })).max(30).optional().nullable(),
  customCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
    outputUnit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    inputs: z.array(z.object({
      name: z.string().max(50),
      unit: z.string().max(20).optional(),
    })).max(10).optional(),
  })).max(20).optional().nullable(),
}).refine(
  (data) => data.tradeType !== 'OTHER' || (data.tradeName && data.tradeName.length >= 2),
  { message: "Custom trade name is required for specialty trades", path: ["tradeName"] }
);

const onboardingChatSchema = z.object({
  message: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(1, "Message is required").max(2000))
    .transform(s => sanitizeText(s)),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(5000))
      .transform(s => sanitizeText(s)),
  })).max(30).optional().default([]),
  tradeResearch: z.object({
    tradeName: z.string(),
    tradeDescription: z.string().optional(),
    scopeOfWorkItems: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    commonMaterials: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    workTypes: z.array(z.object({
      name: z.string(),
      unit: z.string().optional(),
      typicalProductionRate: z.string().optional(),
      description: z.string().optional(),
    })).optional(),
    calculators: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      outputUnit: z.string().optional(),
      inputs: z.array(z.object({
        name: z.string(),
        unit: z.string().optional(),
      })).optional(),
    })).optional(),
    vendorCategories: z.array(z.string()).optional(),
    industryNotes: z.string().optional(),
  }).optional().nullable(),
});

const tradeResearchSchema = z.object({
  tradeName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(2, "Trade name must be at least 2 characters").max(100))
    .transform(s => sanitizeShortText(s)),
});


router.get("/ai/onboarding/sow-items/:tradeType", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { tradeType } = req.params;
    
    if (!tradeTypeEnum.enumValues.includes(tradeType as any)) {
      return res.status(400).json({ error: "Invalid trade type" });
    }

    const items = await db
      .select()
      .from(masterSowItems)
      .where(eq(masterSowItems.tradeType, tradeType as any))
      .orderBy(asc(masterSowItems.sortOrder));

    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      const cat = item.categoryName || 'General';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description,
        defaultUomCode: item.defaultUomCode,
        csiCode: item.csiCode,
      });
    }

    res.json({ 
      tradeType,
      items,
      groupedByCategory: grouped,
      totalCount: items.length 
    });
  } catch (error) {
  next(error);
  }
});

router.get("/ai/onboarding/trades", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const templates = await db
      .select({
        tradeType: tradeTemplates.tradeType,
        displayName: tradeTemplates.displayName,
        description: tradeTemplates.description,
        csiDivision: tradeTemplates.csiDivision,
        iconName: tradeTemplates.iconName,
        colorHex: tradeTemplates.colorHex,
        isGcTrade: tradeTemplates.isGcTrade,
      })
      .from(tradeTemplates)
      .where(eq(tradeTemplates.isActive, true))
      .orderBy(asc(tradeTemplates.displayName));

    res.json(templates);
  } catch (error) {
  next(error);
  }
});

router.get("/ai/onboarding/units", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const units = await db
      .select()
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.isActive, true))
      .orderBy(asc(unitsOfMeasure.sortOrder));

    res.json(units);
  } catch (error) {
  next(error);
  }
});

async function getSowSuggestionsForTrade(tradeType: string): Promise<string[]> {
  const items = await db
    .select({ name: masterSowItems.name })
    .from(masterSowItems)
    .where(eq(masterSowItems.tradeType, tradeType as any))
    .orderBy(asc(masterSowItems.sortOrder))
    .limit(20);
  
  return items.map(i => i.name);
}

function buildOnboardingTaxonomyBlock(): string {
  const categories = getTradeCategories();
  return categories.map(cat => {
    const trades = getTradesByCategory(cat);
    const tradeNames = trades.slice(0, 20).map(t => t.trade_name).join(', ');
    const suffix = trades.length > 20 ? ` (+${trades.length - 20} more)` : '';
    return `**${cat}** (${trades.length} trades): ${tradeNames}${suffix}`;
  }).join('\n');
}

function buildOnboardingMaterialBlock(): string {
  const groups = getMaterialGroups();
  return groups.map(g => {
    const mats = getMaterialsByGroup(g);
    const names = mats.slice(0, 8).map(m => m.display_name).join(', ');
    const suffix = mats.length > 8 ? ` (+${mats.length - 8} more)` : '';
    return `**${g}**: ${names}${suffix}`;
  }).join('\n');
}

async function buildOnboardingSystemPrompt(): Promise<string> {
  const templates = await db
    .select({
      tradeType: tradeTemplates.tradeType,
      displayName: tradeTemplates.displayName,
      materialCategories: tradeTemplates.materialCategories,
    })
    .from(tradeTemplates)
    .where(eq(tradeTemplates.isActive, true));

  const tradeTypes = templates.map(t => t.tradeType).join(', ');

  const materialSuggestions = templates
    .filter(t => t.materialCategories)
    .map(t => `${t.tradeType}: ${t.materialCategories}`)
    .join('\n');

  return `You are an AI assistant helping new contractors set up their construction management platform. Your goal is to have a friendly, in-depth conversation to understand their business so we can configure the system perfectly for their needs, including pre-building their scope of work items and material calculators.

## Your Conversation Flow:

### For Known Trades (22 preset trades):
1. **Welcome & Trade** - Warmly greet them and ask what type of contracting work they specialize in
2. **Crew Size** - Ask about their typical crew size (can be a range like "5-10")
3. **Region** - Ask what geographic area they primarily serve
4. **Work Types/SOW** - Based on their trade, we have pre-built scope of work items. Ask them to confirm which services they offer
5. **Materials** - Based on their trade, suggest material categories they likely use
6. **Website** - Ask if they have a company website (optional) for brand color matching
7. **Confirmation** - Summarize everything and ask them to confirm

### For Unknown/Custom Trades (OTHER):
1. **Welcome & Trade** - Greet them and identify that we don't have a preset for their trade
2. **Trade Name** - Get the specific name of their trade/specialty
3. **Crew Size** - Ask about their typical crew size
4. **Region** - Ask what geographic area they primarily serve
5. **SOW Items** - Have them describe 5-10 common job types/services they perform
6. **Work Types** - Ask about the units they measure work in
7. **Materials** - Ask what materials they commonly use
8. **Calculators** - Suggest helpful calculators based on their trade
9. **Website** - Ask if they have a company website
10. **Confirmation** - Summarize and confirm

## Available Trade Types:
${tradeTypes}

## Material Categories by Trade:
${materialSuggestions}

## RESPONSE FORMAT:
Always respond with VALID JSON in this exact structure:
{
  "message": "Your conversational message here",
  "data": {
    "companyName": null,
    "tradeType": null,
    "tradeName": null,
    "crewSize": null,
    "region": null,
    "materials": null,
    "workTypes": null,
    "websiteUrl": null,
    "suggestedCalculators": null,
    "customSowItems": [
      {"name": "Pool Installation", "description": "Full pool installation service", "unit": "EA", "category": "Installation"}
    ] or null (ONLY for OTHER trade),
    "customWorkTypes": [
      {"name": "Pool Excavation", "unit": "CY", "defaultRate": 50}
    ] or null (ONLY for OTHER trade),
    "customCalculators": [
      {"name": "Pool Volume Calculator", "description": "Calculate gallons from dimensions", "outputUnit": "gallons", "inputs": [{"name": "length", "unit": "ft"}, {"name": "width", "unit": "ft"}, {"name": "depth", "unit": "ft"}]}
    ] or null (ONLY for OTHER trade)
  },
  "suggestions": {
    "workTypes": null,
    "materials": null
  },
  "isComplete": false,
  "isCustomTrade": false,
  "step": 1
}

## Important Guidelines:

### CONVERSATIONAL PRIORITY - THIS IS CRITICAL:
- **ALWAYS acknowledge what the user said before moving on** - If they ask a question, answer it first. If they share something interesting, comment on it. Don't just extract data and rush to the next question.
- **Be genuinely interested** - React to what they share. "Oh, roofing in Texas? You must stay busy after storm season!" is better than "Got it. What's your crew size?"
- **If the user asks a question or goes off-topic, FULLY address it** before continuing the setup flow. Users hate feeling ignored.
- **Match their energy** - If they're brief, be efficient. If they're chatty, engage with them.
- **Use natural transitions** - Instead of "Next question:", say things like "That helps a lot! By the way..." or "Makes sense. One more thing I'm curious about..."

### Smart Research Triggers:
When the user mentions MATERIALS, SUPPLIES, or asks about what they'll need:
- Proactively suggest specific materials relevant to their trade
- Offer insights like "Most roofing contractors I work with track shingles, underlayment, flashing, and vents. Does that sound about right for you?"

When the user asks about SCOPE OF WORK, JOB TYPES, or SERVICES:
- Share the pre-built scope items we have for their trade
- Ask if there are any specific services they want to add or remove

### General Conversation Rules:
- Be conversational and friendly, not robotic
- Ask ONE question at a time - don't overwhelm them
- When you identify their trade from our preset list, tell them we have pre-built scope of work items for their trade that will be loaded automatically
- **SPECIAL: General Contractor Mode** - If user identifies as a GC/General Contractor/Builder, inform them this unlocks access to ALL 22 trade templates with scope of work items, calculators, and work types for subcontractor coordination across every specialty
- **SPECIAL: Custom Trade (OTHER)** - If user's trade doesn't match our 22 presets:
  - Set tradeType to "OTHER" and isCustomTrade to true
  - Tell them: "I don't have a preset template for your trade, but no problem! I'll help you set up a fully customized system. This actually gives you more flexibility to define exactly how you work."
  - Gather customSowItems (at least 5-10 common job types they perform)
  - Gather customWorkTypes with appropriate units
  - Ask about any calculations they frequently need
  - Be extra thorough since we're building their configuration from scratch
- For materials, suggest based on their trade's material categories (or ask if OTHER)
- For the website, explain it's optional but we can match their system colors to their brand
- Set isComplete to true only when you have gathered: trade type, crew size, region, and confirmed they're ready
- For OTHER trades, also ensure you have: tradeName, customSowItems (at least 3), customWorkTypes (at least 2)

### Heavy Civil / DOT Detection:
If the user mentions ANY of these keywords or phrases, treat them as a Heavy Civil / DOT contractor: "DOT", "highway", "roadway", "interstate", "FHWA", "ODOT", "TxDOT", "Caltrans", "FDOT", "asphalt paving", "concrete paving", "haul tickets", "mass excavation", "traffic control", "MUTCD", "striping", "pavement marking", "erosion control", "SWPPP", "stormwater", "WH-347", "certified payroll", "prevailing wage", "Davis-Bacon", "DBE", "MBE", "WBE", "Buy America", "surety bond", "performance bond", "AASHTO", "spec section", "pay item".
When detected:
- Map their tradeType to the closest match (ROADWAY_CONSTRUCTION, ASPHALT_PAVING, CONCRETE_PAVING, MASS_EXCAVATION, TRAFFIC_CONTROL, STRIPING_AND_SIGNAGE, EROSION_CONTROL, STORMWATER_SYSTEMS, etc.)
- Tell them: "Sounds like you're a Heavy Civil / DOT contractor. I'll turn on DOT pay items, DBE tracking, WH-347 certified payroll, haul tickets, daily inspector reports, SWPPP, surety bonds, Buy America, and the mass-haul analyzer for you. You can fine-tune any of these later in Feature Flags."
- Ask one follow-up: which DOT agencies they primarily work with (e.g., FHWA, their state DOT, toll authorities) so we can pin those agencies in their DOT library.

Step progression for preset trades: 1=trade, 2=crew, 3=region, 4=workTypes confirmation, 5=materials, 6=website, 7=confirmation
Step progression for OTHER trades: 1=trade, 2=tradeName, 3=crew, 4=region, 5=customSowItems, 6=customWorkTypes, 7=materials, 8=customCalculators, 9=website, 10=confirmation`;
}

router.post("/ai/onboarding/complete", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {

    const validationResult = onboardingCompleteSchema.safeParse(req.body);
    if (!validationResult.success) {
      logError(`[Onboarding] Validation failed for user ${req.user!.id}: ${fromZodError(validationResult.error).toString()}`);
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { 
      companyName, tradeType, tradeName, crewSize, region, materials, workTypes, websiteUrl, suggestedCalculators,
      customSowItems, customWorkTypes, customCalculators 
    } = validationResult.data;

    const validTradeTypes = tradeTypeEnum.enumValues;
    if (!validTradeTypes.includes(tradeType as any)) {
      logError(`[Onboarding] INVALID trade type attempted: "${tradeType}" by user ${req.user!.id}`);
      return res.status(400).json({ 
        error: "Invalid trade type", 
        message: `Trade type "${tradeType}" is not valid. Valid options: ${validTradeTypes.join(', ')}` 
      });
    }

    logInfo(`[Onboarding] Starting for user ${req.user!.id} | trade: ${tradeType} | company: ${companyName}`);

    const isHustler = req.user!.role === 'HUSTLER';
    const isCustomTrade = tradeType === 'OTHER';
    const orgName = companyName || 'My Company';
    const sanitizedMaterials = materials || [];
    const sanitizedWorkTypes = (workTypes || []).filter((wt): wt is string => typeof wt === 'string' && wt.length > 0);

    let newOrg: typeof organizations.$inferSelect;
    
    if (req.user!.organizationId && !isHustler) {
      const existingOrg = await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user!.organizationId),
      });
      
      if (existingOrg && existingOrg.onboardingStatus === 'NOT_STARTED') {
        logInfo(`[Onboarding] Updating existing org ${existingOrg.id} for user ${req.user!.id}`);
        
        const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const slug = `${baseSlug}-${Date.now().toString(36)}`;
        
        const [updatedOrg] = await db.update(organizations)
          .set({
            name: orgName,
            slug,
            tradeType: tradeType as any,
            tradeName: tradeName || null,
            typicalCrewSize: crewSize || null,
            region: region || null,
            websiteUrl: websiteUrl || null,
            onboardingStatus: 'COMPLETED',
            onboardingData: JSON.stringify({ 
              materials: sanitizedMaterials, 
              workTypes: sanitizedWorkTypes,
              suggestedCalculators: suggestedCalculators || [],
              customSowItems: customSowItems || [],
              customWorkTypes: customWorkTypes || [],
              customCalculators: customCalculators || [],
              isCustomTrade,
              completedAt: new Date() 
            }),
          })
          .where(eq(organizations.id, existingOrg.id))
          .returning();
        
        newOrg = updatedOrg;
      } else {
        logWarn(`[Onboarding] Non-Hustler user ${req.user!.id} already has completed org ${req.user!.organizationId}`);
        return res.status(400).json({ error: "You already belong to an organization" });
      }
    } else {
      const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const slug = `${baseSlug}-${Date.now().toString(36)}`;

      const [createdOrg] = await db.insert(organizations).values({
        name: orgName,
        slug,
        tradeType: tradeType as any,
        tradeName: tradeName || null,
        typicalCrewSize: crewSize || null,
        region: region || null,
        websiteUrl: websiteUrl || null,
        onboardingStatus: 'COMPLETED',
        onboardingData: JSON.stringify({ 
          materials: sanitizedMaterials, 
          workTypes: sanitizedWorkTypes,
          suggestedCalculators: suggestedCalculators || [],
          customSowItems: customSowItems || [],
          customWorkTypes: customWorkTypes || [],
          customCalculators: customCalculators || [],
          isCustomTrade,
          completedAt: new Date() 
        }),
      }).returning();
      
      newOrg = createdOrg;
    }

    if (isHustler) {
      await db.insert(hustlerOrganizations).values({
        userId: req.user!.id,
        organizationId: newOrg.id,
        roleOverride: 'ADMIN',
        isActive: true,
      }).onConflictDoNothing();
      
      if (!req.user!.organizationId) {
        await db.update(users)
          .set({ 
            organizationId: newOrg.id,
            isActive: true 
          })
          .where(eq(users.id, req.user!.id));
      }
      
      logInfo(`[Onboarding] Hustler ${req.user!.id} linked to new org ${newOrg.id}`);
    } else {
      await db.update(users)
        .set({ 
          organizationId: newOrg.id,
          role: 'ADMIN',
          isActive: true 
        })
        .where(eq(users.id, req.user!.id));
    }

    try {
      await applyTradePreset(newOrg.id, tradeType, req.user?.id ?? null);
      logInfo(`[Onboarding] Feature flags set via trade preset for "${tradeType}"`, { organizationId: newOrg.id });
    } catch (presetErr: any) {
      logWarn(`[Onboarding] Trade feature preset failed, applying fallback defaults: ${presetErr.message}`);
      try {
        const fallbackFlags = JSON.stringify(getFeaturePresetForTrade("OTHER"));
        await db.update(organizations)
          .set({ featureFlags: fallbackFlags, updatedAt: new Date() })
          .where(eq(organizations.id, newOrg.id));
      } catch (fallbackErr: any) {
        logWarn(`[Onboarding] Fallback feature flags also failed: ${fallbackErr.message}`);
      }
    }

    const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
    
    logInfo(`[Onboarding] SOW generation | isGC: ${isGeneralContractor} | isCustom: ${isCustomTrade} | trade: ${tradeType}`);
    
    if (isCustomTrade) {
      const customTradeName = tradeName || 'Custom Trade';
      let sowItemCount = 0;
      
      if (customSowItems && customSowItems.length > 0) {
        for (let i = 0; i < customSowItems.length; i++) {
          const item = customSowItems[i];
          if (item && item.name) {
            const code = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
            await db.insert(organizationSowItems).values({
              organizationId: newOrg.id,
              categoryName: item.category || customTradeName,
              name: item.name,
              code: `custom_${code}_${i}`,
              description: item.description || null,
              unit: item.unit || 'EA',
              displayOrder: i,
              isFromTemplate: false,
              isActive: true,
            }).onConflictDoNothing();
            sowItemCount++;
          }
        }
      }
      
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName: customTradeName,
          name: wt,
          code: `sow_${code}_${i}`,
          displayOrder: sowItemCount + i,
          isFromTemplate: false,
          isActive: true,
        }).onConflictDoNothing();
        sowItemCount++;
      }
      
      if (sowItemCount === 0) {
        const defaultSowItems = [
          { name: `${customTradeName} - Standard Service`, category: customTradeName },
          { name: `${customTradeName} - Repair/Maintenance`, category: customTradeName },
          { name: `${customTradeName} - Installation`, category: customTradeName },
          { name: `${customTradeName} - Consultation`, category: customTradeName },
          { name: `${customTradeName} - Emergency Service`, category: customTradeName },
        ];
        for (let i = 0; i < defaultSowItems.length; i++) {
          const item = defaultSowItems[i];
          const code = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
          await db.insert(organizationSowItems).values({
            organizationId: newOrg.id,
            categoryName: item.category,
            name: item.name,
            code: `default_${code}_${i}`,
            unit: 'EA',
            displayOrder: i,
            isFromTemplate: false,
            isActive: true,
          }).onConflictDoNothing();
        }
      }
      
      let workTypeCount = 0;
      if (customWorkTypes && customWorkTypes.length > 0) {
        for (const wt of customWorkTypes) {
          if (wt && wt.name) {
            await db.insert(organizationWorkTypes).values({
              organizationId: newOrg.id,
              name: wt.name,
              category: customTradeName,
              unit: wt.unit || 'EA',
              defaultProductionRate: wt.defaultRate ? String(wt.defaultRate) : null,
            }).onConflictDoNothing();
            workTypeCount++;
          }
        }
      }
      
      if (workTypeCount === 0) {
        const defaultWorkTypes = [
          { name: 'General Work', unit: 'HR' },
          { name: 'Project Completion', unit: 'EA' },
          { name: 'Service Call', unit: 'EA' },
          { name: 'Material Installation', unit: 'SF' },
        ];
        for (const wt of defaultWorkTypes) {
          await db.insert(organizationWorkTypes).values({
            organizationId: newOrg.id,
            name: wt.name,
            category: customTradeName,
            unit: wt.unit,
          }).onConflictDoNothing();
        }
      }
      
      if (customCalculators && customCalculators.length > 0) {
        for (const calc of customCalculators) {
          if (calc && calc.name) {
            await db.insert(organizationCalculators).values({
              organizationId: newOrg.id,
              name: calc.name,
              category: customTradeName,
              unit: calc.outputUnit || 'units',
              formulaJson: JSON.stringify({ 
                type: 'custom', 
                description: calc.description || '',
                inputs: calc.inputs || [] 
              }),
              inputFieldsJson: JSON.stringify(calc.inputs || []),
            }).onConflictDoNothing();
          }
        }
      }
      
      if (!customCalculators || customCalculators.length === 0) {
        await db.insert(organizationCalculators).values({
          organizationId: newOrg.id,
          name: 'Material Quantity Calculator',
          category: customTradeName,
          unit: 'units',
          formulaJson: JSON.stringify({ 
            type: 'custom', 
            description: 'Calculate material quantity based on area',
            formula: 'area * coverage_rate'
          }),
          inputFieldsJson: JSON.stringify([
            { name: 'area', label: 'Area (sq ft)', type: 'number' },
            { name: 'coverage_rate', label: 'Coverage Rate', type: 'number' }
          ]),
        }).onConflictDoNothing();
      }
      
    } else {
      let masterItems;
      if (isGeneralContractor) {
        masterItems = await db
          .select()
          .from(masterSowItems)
          .where(eq(masterSowItems.isActive, true))
          .orderBy(asc(masterSowItems.tradeType), asc(masterSowItems.sortOrder));
      } else {
        masterItems = await db
          .select()
          .from(masterSowItems)
          .where(and(
            eq(masterSowItems.tradeType, tradeType as any),
            eq(masterSowItems.isActive, true)
          ))
          .orderBy(asc(masterSowItems.sortOrder));
      }

      for (const item of masterItems) {
        const categoryName = isGeneralContractor 
          ? `${item.tradeType} - ${item.categoryName || 'General'}`
          : (item.categoryName || 'General');
        
        const itemCode = isGeneralContractor
          ? `${item.tradeType}_${item.code}`
          : item.code;
        
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName,
          name: item.name,
          code: itemCode,
          description: item.description,
          unit: item.defaultUomCode || 'EA',
          displayOrder: item.sortOrder || 0,
          requiresDimensions: item.requiresDimensions || false,
          dimensionLabel: item.dimensionLabel,
          isFromTemplate: true,
          isActive: true,
        }).onConflictDoNothing();
      }

      const masterItemNames = new Set(masterItems.map(m => m.name.toLowerCase()));
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        if (!masterItemNames.has(wt.toLowerCase())) {
          const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
          await db.insert(organizationSowItems).values({
            organizationId: newOrg.id,
            categoryName: tradeName || tradeType,
            name: wt,
            code: `custom_${code}_${i}`,
            displayOrder: masterItems.length + i,
            isFromTemplate: false,
            isActive: true,
          }).onConflictDoNothing();
        }
      }

      let templates;
      if (isGeneralContractor) {
        templates = await db.select().from(tradeTemplates).where(eq(tradeTemplates.isActive, true));
      } else {
        const [template] = await db.select().from(tradeTemplates).where(
          and(eq(tradeTemplates.tradeType, tradeType as any), eq(tradeTemplates.isActive, true))
        );
        templates = template ? [template] : [];
      }
      
      for (const template of templates) {
        try {
          const templateWorkTypes = safeJsonParse(template.workTypesJson, []);
          for (let wtIdx = 0; wtIdx < templateWorkTypes.length; wtIdx++) {
            const wt = templateWorkTypes[wtIdx];
            if (wt && wt.name) {
              const workTypeName = isGeneralContractor 
                ? `[${template.tradeType}] ${wt.name}`
                : wt.name;
              const category = template.displayName || template.tradeType;
              
              await db.insert(organizationWorkTypes).values({
                organizationId: newOrg.id,
                name: workTypeName,
                category,
                unit: wt.unit || 'EA',
                defaultProductionRate: wt.rate ? String(wt.rate) : null,
              }).onConflictDoNothing();
            }
          }
        } catch (e) {
          logError("Error parsing work types:", {}, e instanceof Error ? e : new Error(String(e)));
        }

        try {
          const calculators = safeJsonParse(template.calculatorConfigJson, []);
          for (let calcIdx = 0; calcIdx < calculators.length; calcIdx++) {
            const calc = calculators[calcIdx];
            if (calc && calc.name) {
              const calcName = isGeneralContractor 
                ? `[${template.tradeType}] ${calc.name}`
                : calc.name;
              const category = template.displayName || template.tradeType;
              
              await db.insert(organizationCalculators).values({
                organizationId: newOrg.id,
                name: calcName,
                category,
                unit: calc.output || 'units',
                formulaJson: JSON.stringify({ type: calc.type, inputs: calc.inputs, output: calc.output }),
                inputFieldsJson: JSON.stringify(calc.inputs || []),
              }).onConflictDoNothing();
            }
          }
        } catch (e) {
          logError("Error parsing calculators:", {}, e instanceof Error ? e : new Error(String(e)));
        }
      }
    }

    if (suggestedCalculators && suggestedCalculators.length > 0) {
      for (const calc of suggestedCalculators) {
        if (calc && calc.name) {
          await db.insert(organizationCalculators).values({
            organizationId: newOrg.id,
            name: calc.name,
            category: tradeName || tradeType,
            unit: 'units',
            formulaJson: JSON.stringify({ formula: 'quantity * rate', description: calc.description || '' }),
            inputFieldsJson: JSON.stringify([{ name: 'quantity', label: 'Quantity', type: 'number' }]),
          }).onConflictDoNothing();
        }
      }
    }

    try {
      await seedScopeStandardizationForTrade(tradeType);
      logInfo(`[Onboarding] Scope standardization seeded for trade: ${tradeType}`);
    } catch (scopeErr: any) {
      logWarn(`[Onboarding] Scope standardization seeding failed (non-fatal): ${scopeErr.message}`);
    }

    if (websiteUrl) {
      extractThemeFromWebsite(newOrg.id, websiteUrl, req.user!.id).catch(err => {
        logError("Theme extraction failed:", {}, err instanceof Error ? err : new Error(String(err)));
      });
    }

    logInfo(`[Onboarding] SUCCESS | org: ${newOrg.id} | trade: ${tradeType} | isHustler: ${isHustler} | company: ${orgName}`);

    res.json({ 
      success: true, 
      organization: newOrg,
      message: "Your account has been configured successfully!",
      isHustler,
    });
  } catch (error: any) {
    next(error);
  }
});

// Exported (Task #1543) so the safeDownload integration can be exercised
// directly by the URL-fetcher test suite.
export async function extractThemeFromWebsite(organizationId: string, websiteUrl: string, userId: string | null): Promise<void> {
  try {
    // Task #1498: route this third-party fetch through the shared
    // safeDownload helper so SSRF checks (incl. DNS resolution),
    // redirect re-validation, and the streaming size cap apply.
    const { safeDownload, SafeDownloadError } = await import("./services/safeDownload");

    let html: string;
    try {
      const result = await safeDownload({
        url: websiteUrl,
        headers: {
          'User-Agent': 'SmartManageAI-Theme-Extractor/1.0',
          'Accept': 'text/html',
        },
        timeoutMs: 10000,
        maxBytes: 1_000_000,
        allowedContentTypes: ['text/html', 'application/xhtml+xml'],
      });
      html = result.buffer.toString('utf8');
    } catch (err: any) {
      if (err instanceof SafeDownloadError) {
        logInfo(`Theme extraction: ${err.message}`);
        return;
      }
      throw err;
    }
    
    const colorPatterns = [
      /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
    ];

    const foundColors: string[] = [];
    for (const pattern of colorPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        foundColors.push(...matches.slice(0, 10));
      }
    }

    if (foundColors.length > 0) {
      const governed = await governedAiCall({
        orgId: organizationId,
        userId,
        actionType: "onboarding_theme_extraction",
        inputRefs: { websiteUrl },
        fn: async () => {
          const colorAnalysis = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'system',
              content: 'You are a design expert. Given a list of colors found on a website, identify the most likely primary brand color, secondary color, and accent color. Return JSON with: {"primaryColor": "#hex", "secondaryColor": "#hex", "accentColor": "#hex"}'
            }, {
              role: 'user',
              content: `Colors found on website: ${foundColors.slice(0, 20).join(', ')}`
            }],
            response_format: { type: "json_object" },
            max_completion_tokens: 100,
          });
          return { result: colorAnalysis.choices[0]?.message?.content || '{}', completion: colorAnalysis };
        },
      });

      if (governed.blocked) {
        logInfo(`Theme extraction blocked: ${governed.reason}`);
        return;
      }

      const themeColors = JSON.parse(governed.result);
      
      if (themeColors.primaryColor || themeColors.secondaryColor || themeColors.accentColor) {
        await db.update(organizations)
          .set({
            primaryColor: themeColors.primaryColor || null,
            secondaryColor: themeColors.secondaryColor || null,
            accentColor: themeColors.accentColor || null,
            themeExtractedAt: new Date(),
          })
          .where(eq(organizations.id, organizationId));
        
        logInfo(`Theme extracted for org ${organizationId}:`, themeColors);
      }
    }
  } catch (error: any) {
    logError("Theme extraction error:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

router.post("/ai/onboarding/research-trade", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const validationResult = tradeResearchSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { tradeName } = validationResult.data;
    
    if (!tradeName) {
      return res.status(400).json({ error: "Trade name is required" });
    }
    
    logInfo(`[Trade Research API] Researching trade: ${tradeName}`);
    const research = await researchCustomTrade(tradeName);
    
    res.json({
      success: true,
      research,
    });
  } catch (error: any) {
    next(error);
  }
});

function buildTradeResearchContext(research: TradeResearchResult): string {
  const sowItems = research.scopeOfWorkItems
    ?.slice(0, 12)
    .map(item => `- ${item.name} (${item.unit}): ${item.description || ''}`)
    .join('\n') || '';
  
  const materials = research.commonMaterials
    ?.slice(0, 10)
    .map(m => `- ${m.name} (${m.unit}): ${m.description || ''}`)
    .join('\n') || '';
  
  const workTypes = research.workTypes
    ?.slice(0, 6)
    .map(wt => `- ${wt.name} (${wt.unit})${wt.typicalProductionRate ? ` - typical rate: ${wt.typicalProductionRate}` : ''}`)
    .join('\n') || '';
  
  const calculators = research.calculators
    ?.slice(0, 4)
    .map(c => `- ${c.name}: ${c.description || ''}`)
    .join('\n') || '';

  return `
## IMPORTANT: Research Data for "${research.tradeName}"

You have access to RESEARCHED INDUSTRY DATA for this specialty trade. Use this information to make educated suggestions during the conversation.

**Trade Description:** ${research.tradeDescription || ''}

**Common Scope of Work Items (suggest these):**
${sowItems}

**Common Materials:**
${materials}

**Work Types with Typical Units:**
${workTypes}

**Useful Calculators:**
${calculators}

**Vendor Categories:** ${research.vendorCategories?.join(', ') || 'General suppliers'}

**Industry Notes:** ${research.industryNotes || ''}

INSTRUCTIONS:
- Use this research to make informed suggestions
- Present the SOW items as "Based on ${research.tradeName} industry standards, here are common services..."
- Offer the materials list as suggestions they can confirm
- Suggest the work types with appropriate units
- Recommend the calculators that would be helpful
- The user can accept, modify, or add to these suggestions
`;
}

router.post("/ai/onboarding/chat", sensitiveLimiter, requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const validationResult = onboardingChatSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { message, conversationHistory, tradeResearch } = validationResult.data;

    let systemPrompt = await buildOnboardingSystemPrompt();
    
    if (tradeResearch && tradeResearch.tradeName) {
      const researchContext = buildTradeResearchContext(tradeResearch as TradeResearchResult);
      systemPrompt += researchContext;
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    for (const msg of conversationHistory.slice(-20)) {
      if (msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message || '' });

    const governed = await governedAiCall({
      orgId: req.user!.organizationId!,
      userId: req.user!.id,
      actionType: "onboarding_chat",
      inputRefs: { messageLength: message?.length },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          max_completion_tokens: 800,
          response_format: { type: "json_object" },
        });
        return { result: completion.choices[0]?.message?.content, completion };
      },
    });

    if (governed.blocked) {
      return res.status(429).json({ error: "AI rate limit reached", reason: governed.reason });
    }

    const responseText = governed.result;
    if (!responseText) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(responseText);
    res.json(parsed);
  } catch (error: any) {
    next(error);
  }
});

router.get("/ai/walkthrough/status", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [freshUser] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      walkthroughStartedAt: users.walkthroughStartedAt,
      role: users.role,
      organizationId: users.organizationId,
      firstName: users.firstName,
    }).from(users).where(eq(users.id, req.user!.id));

    if (!freshUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!freshUser.organizationId) {
      return res.json({
        walkthroughCompleted: true,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
        totalSteps: 0,
        role: freshUser.role,
        walkthrough: null,
      });
    }

    const user = freshUser;
    const firstName = user.firstName || 'there';
    const walkthrough = getPersonalizedWalkthrough(user.role, firstName);
    const totalSteps = getTotalStepsForRole(user.role);
    
    const rawStep = user.walkthroughStep > 0 ? getWalkthroughStep(user.role, user.walkthroughStep) : null;
    const currentStep = rawStep ? {
      ...rawStep,
      description: personalizeContent(rawStep.description, firstName),
      action: personalizeContent(rawStep.action, firstName),
      encouragement: rawStep.encouragement ? personalizeContent(rawStep.encouragement, firstName) : undefined,
    } : null;

    res.json({
      walkthroughCompleted: user.walkthroughCompleted,
      walkthroughStep: user.walkthroughStep,
      walkthroughStartedAt: user.walkthroughStartedAt,
      totalSteps,
      role: user.role,
      firstName,
      walkthrough: walkthrough ? {
        roleName: walkthrough.roleName,
        welcomeMessage: walkthrough.welcomeMessage,
        completionMessage: walkthrough.completionMessage,
        currentStep,
      } : null,
    });
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/walkthrough/start", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user!.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const firstName = req.user!.firstName || 'there';
    const walkthrough = getPersonalizedWalkthrough(req.user!.role, firstName);
    if (!walkthrough) {
      return res.status(400).json({ error: "No walkthrough available for this role" });
    }

    await db.update(users)
      .set({
        walkthroughStep: 1,
        walkthroughStartedAt: new Date(),
        walkthroughCompleted: false,
      })
      .where(and(
        eq(users.id, req.user!.id),
        eq(users.organizationId, req.user!.organizationId)
      ));

    const firstStep = walkthrough.steps[0] || null;

    res.json({
      success: true,
      currentStep: 1,
      totalSteps: walkthrough.steps.length,
      welcomeMessage: walkthrough.welcomeMessage,
      step: firstStep,
      firstName,
    });
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/walkthrough/next", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user!.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const [user] = await db.select({
      walkthroughStep: users.walkthroughStep,
      role: users.role,
      firstName: users.firstName,
    }).from(users).where(and(
      eq(users.id, req.user!.id),
      eq(users.organizationId, req.user!.organizationId)
    ));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const firstName = user.firstName || 'there';
    const totalSteps = getTotalStepsForRole(user.role);
    const nextStep = user.walkthroughStep + 1;

    if (nextStep > totalSteps) {
      await db.update(users)
        .set({
          walkthroughCompleted: true,
          walkthroughStep: totalSteps,
        })
        .where(and(
          eq(users.id, req.user!.id),
          eq(users.organizationId, req.user!.organizationId)
        ));

      const walkthrough = getPersonalizedWalkthrough(user.role, firstName);

      res.json({
        success: true,
        completed: true,
        completionMessage: walkthrough?.completionMessage || `Congratulations, ${firstName}! You've completed the walkthrough!`,
        firstName,
      });
    } else {
      await db.update(users)
        .set({ walkthroughStep: nextStep })
        .where(and(
          eq(users.id, req.user!.id),
          eq(users.organizationId, req.user!.organizationId)
        ));

      const rawStep = getWalkthroughStep(user.role, nextStep);
      const stepContent = rawStep ? {
        ...rawStep,
        description: personalizeContent(rawStep.description, firstName),
        action: personalizeContent(rawStep.action, firstName),
        encouragement: rawStep.encouragement ? personalizeContent(rawStep.encouragement, firstName) : undefined,
      } : null;

      res.json({
        success: true,
        completed: false,
        currentStep: nextStep,
        totalSteps,
        step: stepContent,
        firstName,
      });
    }
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/walkthrough/complete", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user!.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const totalSteps = getTotalStepsForRole(req.user!.role);

    await db.update(users)
      .set({
        walkthroughCompleted: true,
        walkthroughStep: totalSteps,
      })
      .where(and(
        eq(users.id, req.user!.id),
        eq(users.organizationId, req.user!.organizationId)
      ));

    res.json({
      success: true,
      message: "Walkthrough completed",
    });
  } catch (error: any) {
    next(error);
  }
});

router.post("/ai/walkthrough/reset", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user!.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    await db.update(users)
      .set({
        walkthroughCompleted: false,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
      })
      .where(and(
        eq(users.id, req.user!.id),
        eq(users.organizationId, req.user!.organizationId)
      ));

    res.json({
      success: true,
      message: "Walkthrough reset",
    });
  } catch (error: any) {
    next(error);
  }
});

router.patch("/ai/walkthrough/step", requireAuth, async (req: AuthRequest, res, next) => {
  try {

    if (!req.user!.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const { step, completed } = req.body;

    if (typeof step !== 'number' || step < 0) {
      return res.status(400).json({ error: "Valid step number is required" });
    }

    const updateData: Record<string, any> = {
      walkthroughStep: step,
    };

    if (typeof completed === 'boolean') {
      updateData.walkthroughCompleted = completed;
    }

    if (step === 1 && !completed) {
      updateData.walkthroughStartedAt = new Date();
    }

    await db.update(users)
      .set(updateData)
      .where(and(
        eq(users.id, req.user!.id),
        eq(users.organizationId, req.user!.organizationId)
      ));

    res.json({
      success: true,
      step,
      completed: updateData.walkthroughCompleted ?? false,
    });
  } catch (error: any) {
    next(error);
  }
});


export default router;
