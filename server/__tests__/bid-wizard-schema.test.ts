/**
 * Task #2932 — Automated tests for the bid wizard cost estimation pipeline.
 *
 * Covers:
 *   1. BID_WIZARD_RESULT_SCHEMA accepts / rejects cost field shapes.
 *   2. The line-item cost calculation (qty × unitCost) is correct.
 *   3. The frontend coercion mapping: zero / negative → null, positive → kept.
 */
import { describe, it, expect } from "vitest";
import { BID_WIZARD_RESULT_SCHEMA } from "../aiDocumentRoutes";

// ---------------------------------------------------------------------------
// 1. BID_WIZARD_RESULT_SCHEMA — cost field validation
// ---------------------------------------------------------------------------

describe("BID_WIZARD_RESULT_SCHEMA — unitMaterialCost / unitLaborCost", () => {
  const base = { description: "Concrete footing", quantity: 10, unit: "CY" };

  it("accepts a valid positive material cost", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitMaterialCost: 250.5, unitLaborCost: 45 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null for both cost fields", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitMaterialCost: null, unitLaborCost: null }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts omitted (undefined) cost fields", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative unitMaterialCost", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitMaterialCost: -10 }],
    });
    expect(result.success).toBe(false);
    const issues = (result as any).error.issues as Array<{ path: string[] }>;
    expect(issues.some((i) => i.path.includes("unitMaterialCost"))).toBe(true);
  });

  it("rejects zero for unitMaterialCost", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitMaterialCost: 0 }],
    });
    expect(result.success).toBe(false);
    const issues = (result as any).error.issues as Array<{ path: string[] }>;
    expect(issues.some((i) => i.path.includes("unitMaterialCost"))).toBe(true);
  });

  it("rejects a negative unitLaborCost", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitLaborCost: -5 }],
    });
    expect(result.success).toBe(false);
    const issues = (result as any).error.issues as Array<{ path: string[] }>;
    expect(issues.some((i) => i.path.includes("unitLaborCost"))).toBe(true);
  });

  it("rejects zero for unitLaborCost", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitLaborCost: 0 }],
    });
    expect(result.success).toBe(false);
    const issues = (result as any).error.issues as Array<{ path: string[] }>;
    expect(issues.some((i) => i.path.includes("unitLaborCost"))).toBe(true);
  });

  it("accepts a response without scopeItems at all", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      projectName: "Highway 9 Widening",
      confidenceScore: 0.85,
    });
    expect(result.success).toBe(true);
  });

  it("passes through unknown top-level keys (passthrough mode)", () => {
    const result = BID_WIZARD_RESULT_SCHEMA.safeParse({
      scopeItems: [{ ...base, unitMaterialCost: 100 }],
      unknownExtraKey: "some LLM-generated field",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownExtraKey).toBe(
        "some LLM-generated field",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Line-item cost calculation: qty × unitCost (mirrors createBidMutation)
// ---------------------------------------------------------------------------

/**
 * Extracted from client/src/pages/bid-wizard.tsx — `createBidMutation`:
 *
 *   const qty = item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0
 *                 ? item.quantity : 1;
 *   const computedMaterialCost = ((item.unitMaterialCost ?? 0) * qty).toFixed(2);
 *   const computedLaborCost    = ((item.unitLaborCost    ?? 0) * qty).toFixed(2);
 */
function computeLineItemCosts(item: {
  quantity?: number | null;
  unitMaterialCost?: number | null;
  unitLaborCost?: number | null;
}) {
  const qty =
    item.quantity != null &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0
      ? item.quantity
      : 1;
  const computedMaterialCost = ((item.unitMaterialCost ?? 0) * qty).toFixed(2);
  const computedLaborCost = ((item.unitLaborCost ?? 0) * qty).toFixed(2);
  return { qty, computedMaterialCost, computedLaborCost };
}

describe("computeLineItemCosts — qty × unitCost", () => {
  it("multiplies quantity by unit costs correctly", () => {
    const { computedMaterialCost, computedLaborCost } = computeLineItemCosts({
      quantity: 10,
      unitMaterialCost: 250,
      unitLaborCost: 45,
    });
    expect(computedMaterialCost).toBe("2500.00");
    expect(computedLaborCost).toBe("450.00");
  });

  it("defaults qty to 1 when quantity is null", () => {
    const { qty, computedMaterialCost } = computeLineItemCosts({
      quantity: null,
      unitMaterialCost: 300,
    });
    expect(qty).toBe(1);
    expect(computedMaterialCost).toBe("300.00");
  });

  it("defaults qty to 1 when quantity is zero", () => {
    const { qty } = computeLineItemCosts({ quantity: 0, unitMaterialCost: 100 });
    expect(qty).toBe(1);
  });

  it("defaults qty to 1 when quantity is negative", () => {
    const { qty } = computeLineItemCosts({
      quantity: -5,
      unitMaterialCost: 100,
    });
    expect(qty).toBe(1);
  });

  it("returns '0.00' for material cost when unitMaterialCost is null", () => {
    const { computedMaterialCost } = computeLineItemCosts({
      quantity: 5,
      unitMaterialCost: null,
      unitLaborCost: 50,
    });
    expect(computedMaterialCost).toBe("0.00");
  });

  it("returns '0.00' for labor cost when unitLaborCost is undefined", () => {
    const { computedLaborCost } = computeLineItemCosts({
      quantity: 5,
      unitMaterialCost: 100,
      unitLaborCost: undefined,
    });
    expect(computedLaborCost).toBe("0.00");
  });

  it("rounds to 2 decimal places", () => {
    const { computedMaterialCost } = computeLineItemCosts({
      quantity: 3,
      unitMaterialCost: 33.337,
    });
    expect(computedMaterialCost).toBe("100.01");
  });

  it("handles fractional quantity × unit cost", () => {
    const { computedMaterialCost } = computeLineItemCosts({
      quantity: 2.5,
      unitMaterialCost: 120,
    });
    expect(computedMaterialCost).toBe("300.00");
  });
});

// ---------------------------------------------------------------------------
// 3. Frontend coercion mapping: API item → AIExtractedItem
//    (mirrors the onSuccess handler in analyzeMutation, bid-wizard.tsx ~line 242)
// ---------------------------------------------------------------------------

interface RawApiItem {
  quantity?: number | null;
  unit?: string;
  category?: string;
  csiDivision?: string | null;
  unitMaterialCost?: number | null;
  unitLaborCost?: number | null;
  [key: string]: unknown;
}

function mapApiItemToExtracted(item: RawApiItem, idx: number) {
  return {
    ...item,
    id: `ai-${idx}`,
    quantity:
      typeof item.quantity === "number" && !isNaN(item.quantity)
        ? item.quantity
        : null,
    unit: item.unit || "LS",
    category: item.category || "GENERAL",
    csiDivision: item.csiDivision ?? null,
    selected: true,
    unitMaterialCost:
      typeof item.unitMaterialCost === "number" && item.unitMaterialCost > 0
        ? item.unitMaterialCost
        : null,
    unitLaborCost:
      typeof item.unitLaborCost === "number" && item.unitLaborCost > 0
        ? item.unitLaborCost
        : null,
  };
}

describe("mapApiItemToExtracted — coercion of cost fields", () => {
  it("keeps a positive unitMaterialCost as-is", () => {
    const item = mapApiItemToExtracted(
      { description: "Paving", unitMaterialCost: 85.5 },
      0,
    );
    expect(item.unitMaterialCost).toBe(85.5);
  });

  it("coerces zero unitMaterialCost to null", () => {
    const item = mapApiItemToExtracted(
      { description: "Paving", unitMaterialCost: 0 },
      0,
    );
    expect(item.unitMaterialCost).toBeNull();
  });

  it("coerces negative unitMaterialCost to null", () => {
    const item = mapApiItemToExtracted(
      { description: "Paving", unitMaterialCost: -10 },
      0,
    );
    expect(item.unitMaterialCost).toBeNull();
  });

  it("keeps null unitMaterialCost as null", () => {
    const item = mapApiItemToExtracted(
      { description: "Paving", unitMaterialCost: null },
      0,
    );
    expect(item.unitMaterialCost).toBeNull();
  });

  it("keeps a positive unitLaborCost as-is", () => {
    const item = mapApiItemToExtracted(
      { description: "Labor", unitLaborCost: 120 },
      1,
    );
    expect(item.unitLaborCost).toBe(120);
  });

  it("coerces zero unitLaborCost to null", () => {
    const item = mapApiItemToExtracted(
      { description: "Labor", unitLaborCost: 0 },
      1,
    );
    expect(item.unitLaborCost).toBeNull();
  });

  it("coerces negative unitLaborCost to null", () => {
    const item = mapApiItemToExtracted(
      { description: "Labor", unitLaborCost: -5 },
      1,
    );
    expect(item.unitLaborCost).toBeNull();
  });

  it("assigns sequential ids using the index", () => {
    const item0 = mapApiItemToExtracted({ description: "A" }, 0);
    const item3 = mapApiItemToExtracted({ description: "B" }, 3);
    expect(item0.id).toBe("ai-0");
    expect(item3.id).toBe("ai-3");
  });

  it("defaults unit to 'LS' when absent", () => {
    const item = mapApiItemToExtracted({ description: "Site clearing" }, 0);
    expect(item.unit).toBe("LS");
  });

  it("defaults category to 'GENERAL' when absent", () => {
    const item = mapApiItemToExtracted({ description: "Misc" }, 0);
    expect(item.category).toBe("GENERAL");
  });

  it("sets selected to true for all mapped items", () => {
    const item = mapApiItemToExtracted({ description: "Rebar" }, 0);
    expect(item.selected).toBe(true);
  });

  it("coerces NaN quantity to null", () => {
    const item = mapApiItemToExtracted({ description: "X", quantity: NaN }, 0);
    expect(item.quantity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. hasCostData + lineTotal — badge display logic (mirrors bid-wizard.tsx ~936)
// ---------------------------------------------------------------------------

interface ExtractedItem {
  quantity?: number | null;
  unitMaterialCost?: number | null;
  unitLaborCost?: number | null;
}

function computeLineTotalAndBadge(item: ExtractedItem) {
  const qty =
    item.quantity != null &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0
      ? item.quantity
      : 1;
  const lineTotal =
    ((item.unitMaterialCost ?? 0) + (item.unitLaborCost ?? 0)) * qty;
  const hasCostData =
    item.unitMaterialCost != null || item.unitLaborCost != null;
  return { qty, lineTotal, hasCostData };
}

describe("hasCostData — AI Est. badge visibility logic", () => {
  it("hasCostData is true when unitMaterialCost is set", () => {
    const { hasCostData } = computeLineTotalAndBadge({ unitMaterialCost: 100 });
    expect(hasCostData).toBe(true);
  });

  it("hasCostData is true when unitLaborCost is set", () => {
    const { hasCostData } = computeLineTotalAndBadge({ unitLaborCost: 50 });
    expect(hasCostData).toBe(true);
  });

  it("hasCostData is true when both cost fields are set", () => {
    const { hasCostData } = computeLineTotalAndBadge({
      unitMaterialCost: 200,
      unitLaborCost: 80,
    });
    expect(hasCostData).toBe(true);
  });

  it("hasCostData is false when both cost fields are null", () => {
    const { hasCostData } = computeLineTotalAndBadge({
      unitMaterialCost: null,
      unitLaborCost: null,
    });
    expect(hasCostData).toBe(false);
  });

  it("hasCostData is false when both cost fields are undefined", () => {
    const { hasCostData } = computeLineTotalAndBadge({});
    expect(hasCostData).toBe(false);
  });

  it("lineTotal sums material + labor and multiplies by qty", () => {
    const { lineTotal } = computeLineTotalAndBadge({
      quantity: 5,
      unitMaterialCost: 200,
      unitLaborCost: 80,
    });
    expect(lineTotal).toBe(1400);
  });

  it("lineTotal uses qty=1 when quantity is null", () => {
    const { lineTotal } = computeLineTotalAndBadge({
      quantity: null,
      unitMaterialCost: 300,
      unitLaborCost: 100,
    });
    expect(lineTotal).toBe(400);
  });

  it("lineTotal treats null costs as 0", () => {
    const { lineTotal } = computeLineTotalAndBadge({
      quantity: 10,
      unitMaterialCost: null,
      unitLaborCost: 50,
    });
    expect(lineTotal).toBe(500);
  });
});
