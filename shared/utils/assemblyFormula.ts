export interface FormulaContext {
  length?: number;
  area?: number;
  volume?: number;
  count?: number;
  depth?: number;
}

export function evaluateFormula(formula: string, ctx: FormulaContext): number {
  const safeVars: Record<string, number> = {
    length: ctx.length ?? 0,
    area: ctx.area ?? 0,
    volume: ctx.volume ?? 0,
    count: ctx.count ?? 0,
    depth: ctx.depth ?? 0,
    LF: ctx.length ?? 0,
    SF: ctx.area ?? 0,
    CY: ctx.volume ?? 0,
    QTY: ctx.count ?? 0,
  };

  let expr = formula;
  for (const [key, val] of Object.entries(safeVars)) {
    expr = expr.replace(new RegExp(`\\b${key}\\b`, "gi"), String(val));
  }

  expr = expr.replace(/[^0-9+\-*/().,%\s]/g, "");

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    if (typeof result !== "number" || !Number.isFinite(result)) return 0;
    return Math.max(0, result);
  } catch {
    return 0;
  }
}

export function computeAssemblyQuantity(
  formula: string,
  ctx: FormulaContext,
  wasteFactor: number
): number {
  const base = evaluateFormula(formula, ctx);
  return base * (1 + wasteFactor / 100);
}

export const FORMULA_HELP = [
  { label: "Same as measurement", example: "length", desc: "Uses the measured length directly" },
  { label: "Per stud spacing", example: "length / 1.333 + 1", desc: "16\" OC studs (length in ft / 1.333 + 1)" },
  { label: "Both sides drywall", example: "length * depth * 2", desc: "Both sides of wall (LF * height * 2)" },
  { label: "Perimeter to area", example: "area", desc: "Uses measured area" },
  { label: "Fixed multiplier", example: "length * 2", desc: "Double the measurement" },
  { label: "Count based", example: "count", desc: "Uses the count value" },
];
