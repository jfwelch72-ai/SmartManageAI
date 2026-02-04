/**
 * AI Assistant Routes for SOW and UOM Item Management
 * Provides AI-powered assistance for adding new items with proper formatting and uniformity
 */

import { Router } from "express";
import { db } from "./db";
import { 
  masterSowItems, 
  organizationSowItems, 
  unitsOfMeasure,
  organizations,
  type MasterSowItem,
  type OrganizationSowItem,
  type UnitOfMeasure
} from "@shared/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { openai, AI_MODEL_GPT4O } from "./ai/openaiClient";
import { type AuthRequest } from "./auth";
import { z } from "zod";
import { sanitizeText, sanitizeShortText } from "./sanitization";

const router = Router();

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
router.post("/sow/suggest", async (req: AuthRequest, res) => {
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

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const suggestion = JSON.parse(content) as SOWSuggestion;

    // Return suggestion with similar items for duplicate detection
    res.json({
      success: true,
      suggestion,
      similarItems: similarItems.slice(0, 5),
      availableUoms: uoms.map(u => ({ code: u.code, name: u.name, abbreviation: u.abbreviation })),
      existingCategories: existingCategories.slice(0, 20),
    });

  } catch (error: any) {
    console.error("AI SOW Assistant error:", error);
    res.status(500).json({ error: "Failed to generate suggestion", details: error.message });
  }
});

/**
 * Add new SOW item to organization
 * POST /api/ai-assistant/sow/add
 */
router.post("/sow/add", async (req: AuthRequest, res) => {
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
    console.error("Add SOW item error:", error);
    res.status(500).json({ error: "Failed to add SOW item", details: error.message });
  }
});

/**
 * AI UOM Assistant - Analyzes user input and suggests properly formatted UOM
 * POST /api/ai-assistant/uom/suggest
 */
router.post("/uom/suggest", async (req: AuthRequest, res) => {
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

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const suggestion = JSON.parse(content) as UOMSuggestion;

    res.json({
      success: true,
      suggestion,
      similarUoms: similarUoms.slice(0, 5),
      existingCategories,
    });

  } catch (error: any) {
    console.error("AI UOM Assistant error:", error);
    res.status(500).json({ error: "Failed to generate suggestion", details: error.message });
  }
});

/**
 * Add new UOM (Admin only)
 * POST /api/ai-assistant/uom/add
 */
router.post("/uom/add", async (req: AuthRequest, res) => {
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
    console.error("Add UOM error:", error);
    res.status(500).json({ error: "Failed to add unit of measure", details: error.message });
  }
});

/**
 * Search existing SOW items
 * GET /api/ai-assistant/sow/search
 */
router.get("/sow/search", async (req: AuthRequest, res) => {
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
    console.error("SOW search error:", error);
    res.status(500).json({ error: "Search failed", details: error.message });
  }
});

/**
 * Get available UOMs
 * GET /api/ai-assistant/uom/list
 */
router.get("/uom/list", async (req: AuthRequest, res) => {
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
    console.error("UOM list error:", error);
    res.status(500).json({ error: "Failed to fetch UOMs" });
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
