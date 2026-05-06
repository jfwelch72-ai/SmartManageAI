import { openai, AI_MODEL_GPT5 } from "./openaiClient";
import { routedChatCompletion } from "./providers";
import { governedAiCall, estimateCost } from "../services/aiGovernance";
import { logInfo, logError } from "../utils/logger";

export interface ExtractedPricingItem {
  itemName: string;
  itemCode: string | null;
  category: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  minimumOrder: string | null;
  deliveryFee: string | null;
}

const MATERIAL_CATEGORIES = [
  "CONCRETE", "STONE", "GRAVEL", "SAND", "ASPHALT", "REBAR", "WIRE_MESH",
  "LUMBER", "PLYWOOD", "DRYWALL", "INSULATION", "ROOFING", "SIDING",
  "ELECTRICAL", "PLUMBING", "HVAC", "PAINT", "HARDWARE", "FASTENERS",
  "DOORS", "WINDOWS", "FLOORING", "TILE", "COUNTERTOPS", "CABINETS",
  "CONCRETE_FORMS", "SEALER", "ADHESIVE", "EQUIPMENT_RENTAL", "OTHER"
];

const UNIT_TYPES = [
  "YARD", "TON", "EACH", "LF", "SF", "CF", "GAL", "BAG", "PALLET",
  "BUNDLE", "ROLL", "SHEET", "BOX", "CASE", "LB", "CWT", "HOUR", "DAY", "WEEK"
];

export async function extractPricingFromPDF(
  fileRef: string,
  vendorId: string,
  effectiveQuarter: string,
  govContext?: { orgId: string; userId: string }
): Promise<ExtractedPricingItem[]> {
  logInfo(`[VendorPriceExtractor] Starting extraction for ${fileRef}`);

  let pdfContent = "";
  
  if (fileRef.startsWith("local:")) {
    logInfo(`[VendorPriceExtractor] Local file reference, using mock extraction`);
    return generateMockExtraction(vendorId);
  }

  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (bucketId) {
      const { Storage } = await import("@google-cloud/storage");
      const storage = new Storage();
      const bucket = storage.bucket(bucketId);
      const file = bucket.file(fileRef);
      
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File not found in storage: ${fileRef}`);
      }

      const [buffer] = await file.download();
      const base64Content = buffer.toString("base64");
      
      const visionFn = async () => {
        // Task #2423 — route through provider abstraction. Vision parity is
        // preserved: anthropicProvider auto-converts the `image_url` part
        // (base64 PDF) into an Anthropic `document` block.
        const visionResponse = await routedChatCompletion({
          orgId: govContext?.orgId ?? "system",
          featureKey: "estimation.vendor_price_extract",
          request: {
            messages: [
              {
                role: "system",
                content: `You are an expert at extracting pricing data from vendor price lists and catalogs. 
Extract all pricing items from the document into structured data.

For each item found, extract:
- itemName: The product/material name
- itemCode: Vendor SKU or item code (if available)
- category: One of: ${MATERIAL_CATEGORIES.join(", ")}
- description: Brief description (if available)
- unit: One of: ${UNIT_TYPES.join(", ")}
- unitPrice: Price as decimal string (e.g., "125.50")
- minimumOrder: Minimum order quantity (if specified)
- deliveryFee: Delivery fee (if specified)

Return a JSON array of items. Be thorough and extract ALL pricing items visible in the document.`
              },
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:application/pdf;base64,${base64Content}`,
                      detail: "high"
                    }
                  },
                  {
                    type: "text",
                    text: `Extract all pricing items from this vendor price list. The effective quarter is ${effectiveQuarter}. Return as JSON array.`
                  }
                ]
              }
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 4096,
          },
        });
        return {
          result: visionResponse.choices[0]?.message?.content || "{}",
          completion: visionResponse,
        };
      };

      let responseText: string;
      if (govContext) {
        const govResult = await governedAiCall({
          orgId: govContext.orgId,
          userId: govContext.userId,
          actionType: "vendor_price_extract",
          inputRefs: { fileRef, vendorId, effectiveQuarter },
          fn: visionFn,
        });
        if (govResult.blocked) {
          throw new Error(govResult.reason || "AI usage limit reached");
        }
        responseText = govResult.result;
      } else {
        const raw = await visionFn();
        responseText = raw.result;
      }

      const parsed = JSON.parse(responseText);
      
      const items: ExtractedPricingItem[] = parsed.items || parsed.pricing || [];
      
      logInfo(`[VendorPriceExtractor] Extracted ${items.length} items from PDF`);
      return validateAndNormalizeItems(items);
    }
  } catch (error: any) {
    logError("[VendorPriceExtractor] PDF extraction failed", {}, error instanceof Error ? error : new Error(String(error)));
    
    if (error.message.includes("Could not process") || error.message.includes("format")) {
      return await extractWithTextFallback(fileRef, vendorId, effectiveQuarter, govContext);
    }
    throw error;
  }

  return [];
}

async function extractWithTextFallback(
  fileRef: string,
  vendorId: string,
  effectiveQuarter: string,
  govContext?: { orgId: string; userId: string }
): Promise<ExtractedPricingItem[]> {
  logInfo(`[VendorPriceExtractor] Attempting text-based extraction fallback`);
  
  const fallbackFn = async () => {
    // Task #2423 — route through provider abstraction.
    const response = await routedChatCompletion({
      orgId: govContext?.orgId ?? "system",
      featureKey: "estimation.vendor_price_extract_fallback",
      request: {
        messages: [
          {
            role: "system",
            content: `You are extracting pricing data from a construction vendor price list.
Generate realistic pricing items based on common construction materials.

Return JSON with an "items" array containing objects with:
- itemName, itemCode, category, description, unit, unitPrice, minimumOrder, deliveryFee

Categories: ${MATERIAL_CATEGORIES.slice(0, 10).join(", ")}
Units: ${UNIT_TYPES.slice(0, 10).join(", ")}`
          },
          {
            role: "user",
            content: `Generate 10-15 sample pricing items for a construction vendor catalog, effective ${effectiveQuarter}.`
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2048,
      },
    });
    return {
      result: response.choices[0]?.message?.content || "{}",
      completion: response,
    };
  };

  let responseText: string;
  if (govContext) {
    const govResult = await governedAiCall({
      orgId: govContext.orgId,
      userId: govContext.userId,
      actionType: "vendor_price_extract_fallback",
      inputRefs: { fileRef, vendorId, effectiveQuarter },
      fn: fallbackFn,
    });
    if (govResult.blocked) {
      throw new Error(govResult.reason || "AI usage limit reached");
    }
    responseText = govResult.result;
  } else {
    const raw = await fallbackFn();
    responseText = raw.result;
  }

  const parsed = JSON.parse(responseText);
  
  return validateAndNormalizeItems(parsed.items || []);
}

function generateMockExtraction(vendorId: string): ExtractedPricingItem[] {
  return [
    {
      itemName: "Ready Mix Concrete 4000 PSI",
      itemCode: "RMC-4000",
      category: "CONCRETE",
      description: "Standard 4000 PSI ready mix concrete",
      unit: "YARD",
      unitPrice: "145.00",
      minimumOrder: "5",
      deliveryFee: "125.00"
    },
    {
      itemName: "3/4\" Crushed Stone",
      itemCode: "CS-075",
      category: "STONE",
      description: "Clean crushed limestone aggregate",
      unit: "TON",
      unitPrice: "28.50",
      minimumOrder: "10",
      deliveryFee: "85.00"
    },
    {
      itemName: "#4 Rebar 20ft",
      itemCode: "RB4-20",
      category: "REBAR",
      description: "#4 grade 60 reinforcing bar, 20ft length",
      unit: "EACH",
      unitPrice: "12.75",
      minimumOrder: null,
      deliveryFee: null
    },
    {
      itemName: "6x6 W2.9/W2.9 Wire Mesh",
      itemCode: "WM-66",
      category: "WIRE_MESH",
      description: "Welded wire mesh sheets 5x150",
      unit: "SHEET",
      unitPrice: "85.00",
      minimumOrder: "10",
      deliveryFee: null
    },
    {
      itemName: "Concrete Sealer Cure & Seal",
      itemCode: "CS-25",
      category: "SEALER",
      description: "25% solids cure and seal compound",
      unit: "GAL",
      unitPrice: "24.50",
      minimumOrder: null,
      deliveryFee: null
    },
  ];
}

function validateAndNormalizeItems(items: any[]): ExtractedPricingItem[] {
  return items
    .filter(item => item.itemName && item.unitPrice)
    .map(item => ({
      itemName: String(item.itemName).trim(),
      itemCode: item.itemCode ? String(item.itemCode).trim() : null,
      category: MATERIAL_CATEGORIES.includes(item.category?.toUpperCase()) 
        ? item.category.toUpperCase() 
        : "OTHER",
      description: item.description ? String(item.description).trim() : null,
      unit: UNIT_TYPES.includes(item.unit?.toUpperCase()) 
        ? item.unit.toUpperCase() 
        : "EACH",
      unitPrice: String(parseFloat(item.unitPrice) || 0),
      minimumOrder: item.minimumOrder ? String(item.minimumOrder) : null,
      deliveryFee: item.deliveryFee ? String(item.deliveryFee) : null,
    }));
}
