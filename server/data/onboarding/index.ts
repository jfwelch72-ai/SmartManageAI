import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = __dirname;

export interface Trade {
  trade_id: string;
  trade_name: string;
  trade_category: string;
  aliases: string[];
  default_scope_tags: string[];
}

export interface Scope {
  scope_id: string;
  trade_id: string;
  trade_name: string;
  category: string;
  scope_name: string;
  uom: string;
  required_parameters: string[];
  optional_parameters: string[];
  material_families: string[];
  quantity_formula_id: string;
  labor_formula_id: string;
  duration_formula_id: string;
  line_item_name_pattern: string;
}

export interface MaterialFamily {
  material_family_id: string;
  display_name: string;
  group: string;
  canonical_uom: string;
  attributes: string[];
  notes: string;
}

export interface Formula {
  id: string;
  name: string;
  expr: string;
}

export interface LineItemGrammar {
  naming_format: string;
  examples: string[];
  actions: string[];
  uom_codes: string[];
  qualifier_rules: Record<string, { description: string; examples?: string[]; format?: string }>;
  mapping_rules: Record<string, string>;
  gc_logic: {
    description: string;
    onboarding_question: string;
    self_perform_behavior: string;
    subcontracted_behavior: string;
  };
}

export interface TradeComponentEntry {
  trade_id: string;
  trade_name: string;
  components: TradeComponent[];
}

export interface TradeComponent {
  component_id: string;
  display_name: string;
  description: string;
  applicable_scope_ids: string[];
}

export interface VariantExpansionEntry {
  component_id: string;
  trade_id: string;
  variants: Variant[];
}

export interface Variant {
  variant_id: string;
  display_name: string;
  qualifiers: Record<string, string>;
  default_parameters: Record<string, number | string>;
}

export interface CalibrationRate {
  scope_id: string;
  labor_rate_per_unit: number | null;
  material_cost_per_unit: number | null;
  equipment_rate_per_unit: number | null;
  production_rate_units_per_hr: number | null;
  crew_size_default: number | null;
  notes: string;
}

function loadJson<T>(filename: string): T {
  const raw = readFileSync(join(DATA_DIR, filename), "utf8");
  return JSON.parse(raw) as T;
}

const tradesData: Trade[] = loadJson<Trade[]>("trades.json");
const scopesData: Scope[] = loadJson<Scope[]>("scopes.json");
const materialsData: MaterialFamily[] = loadJson<MaterialFamily[]>("materials.json");
const formulasData: Formula[] = loadJson<Formula[]>("formulas.json");
const grammarData: LineItemGrammar = loadJson<LineItemGrammar>("line_item_grammar.json");
const tradeComponentsData: TradeComponentEntry[] = loadJson<TradeComponentEntry[]>("trade_components.json");
const variantExpansionsData: VariantExpansionEntry[] = loadJson<VariantExpansionEntry[]>("variant_expansions.json");
const calibrationRatesData: CalibrationRate[] = loadJson<CalibrationRate[]>("calibration_rates.json");

const tradeById = new Map<string, Trade>();
tradesData.forEach(t => tradeById.set(t.trade_id, t));

const scopeById = new Map<string, Scope>();
const scopesByTradeId = new Map<string, Scope[]>();
scopesData.forEach(s => {
  scopeById.set(s.scope_id, s);
  const arr = scopesByTradeId.get(s.trade_id) || [];
  arr.push(s);
  scopesByTradeId.set(s.trade_id, arr);
});

const materialById = new Map<string, MaterialFamily>();
const materialsByGroup = new Map<string, MaterialFamily[]>();
materialsData.forEach(m => {
  materialById.set(m.material_family_id, m);
  const arr = materialsByGroup.get(m.group) || [];
  arr.push(m);
  materialsByGroup.set(m.group, arr);
});

const formulaById = new Map<string, Formula>();
formulasData.forEach(f => formulaById.set(f.id, f));

const componentsByTradeId = new Map<string, TradeComponent[]>();
tradeComponentsData.forEach(tc => {
  componentsByTradeId.set(tc.trade_id, tc.components);
});

const variantsByComponentId = new Map<string, VariantExpansionEntry>();
variantExpansionsData.forEach(ve => {
  variantsByComponentId.set(ve.component_id, ve);
});

const calibrationByScope = new Map<string, CalibrationRate>();
calibrationRatesData.forEach(cr => calibrationByScope.set(cr.scope_id, cr));

const tradesByCategory = new Map<string, Trade[]>();
tradesData.forEach(t => {
  const arr = tradesByCategory.get(t.trade_category) || [];
  arr.push(t);
  tradesByCategory.set(t.trade_category, arr);
});

export function getTrades(): Trade[] {
  return tradesData;
}

export function getTradeById(id: string): Trade | undefined {
  return tradeById.get(id);
}

export function getTradesByCategory(category: string): Trade[] {
  return tradesByCategory.get(category) || [];
}

export function getTradeCategories(): string[] {
  return [...tradesByCategory.keys()].sort();
}

export function getScopes(): Scope[] {
  return scopesData;
}

export function getScopeById(id: string): Scope | undefined {
  return scopeById.get(id);
}

export function getScopesByTradeId(tradeId: string): Scope[] {
  if (tradeId === "general_contractor_gc") {
    return scopesData;
  }
  return scopesByTradeId.get(tradeId) || [];
}

export function getScopesForGC(): Scope[] {
  return scopesData;
}

export function getMaterials(): MaterialFamily[] {
  return materialsData;
}

export function getMaterialById(id: string): MaterialFamily | undefined {
  return materialById.get(id);
}

export function getMaterialsByGroup(group: string): MaterialFamily[] {
  return materialsByGroup.get(group) || [];
}

export function getMaterialGroups(): string[] {
  return [...materialsByGroup.keys()].sort();
}

export function getFormulas(): Formula[] {
  return formulasData;
}

export function getFormulaById(id: string): Formula | undefined {
  return formulaById.get(id);
}

export function getComponentsByTradeId(tradeId: string): TradeComponent[] {
  return componentsByTradeId.get(tradeId) || [];
}

export function getVariantsByComponentId(componentId: string): VariantExpansionEntry | undefined {
  return variantsByComponentId.get(componentId);
}

export function getCalibrationRate(scopeId: string): CalibrationRate | undefined {
  return calibrationByScope.get(scopeId);
}

export function getLineItemGrammar(): LineItemGrammar {
  return grammarData;
}

export interface IntegrityResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    trades: number;
    scopes: number;
    materials: number;
    formulas: number;
    components: number;
    variants: number;
    calibrationRates: number;
  };
}

export function validateLibraryIntegrity(): IntegrityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const EXPECTED_TRADES = 230;
  const EXPECTED_SCOPES = 2946;
  const EXPECTED_MATERIALS = 126;
  const EXPECTED_FORMULAS = 39; // 38 base + F_Q_GENERIC

  if (tradesData.length !== EXPECTED_TRADES) {
    errors.push(`Trade count mismatch: expected ${EXPECTED_TRADES}, got ${tradesData.length}`);
  }
  if (scopesData.length !== EXPECTED_SCOPES) {
    errors.push(`Scope count mismatch: expected ${EXPECTED_SCOPES}, got ${scopesData.length}`);
  }
  if (materialsData.length !== EXPECTED_MATERIALS) {
    errors.push(`Material count mismatch: expected ${EXPECTED_MATERIALS}, got ${materialsData.length}`);
  }
  if (formulasData.length !== EXPECTED_FORMULAS) {
    errors.push(`Formula count mismatch: expected ${EXPECTED_FORMULAS}, got ${formulasData.length}`);
  }

  for (const scope of scopesData) {
    if (!tradeById.has(scope.trade_id)) {
      errors.push(`Scope "${scope.scope_id}" references unknown trade "${scope.trade_id}"`);
    }
    if (!formulaById.has(scope.quantity_formula_id)) {
      errors.push(`Scope "${scope.scope_id}" references unknown quantity formula "${scope.quantity_formula_id}"`);
    }
    if (!formulaById.has(scope.labor_formula_id)) {
      errors.push(`Scope "${scope.scope_id}" references unknown labor formula "${scope.labor_formula_id}"`);
    }
    if (!formulaById.has(scope.duration_formula_id)) {
      errors.push(`Scope "${scope.scope_id}" references unknown duration formula "${scope.duration_formula_id}"`);
    }
  }

  const allComponentIds = new Set<string>();
  for (const tc of tradeComponentsData) {
    if (!tradeById.has(tc.trade_id)) {
      errors.push(`Trade component entry references unknown trade "${tc.trade_id}"`);
    }
    for (const comp of tc.components) {
      allComponentIds.add(comp.component_id);
      for (const sid of comp.applicable_scope_ids) {
        if (!scopeById.has(sid)) {
          errors.push(`Component "${comp.component_id}" references unknown scope "${sid}"`);
        }
      }
    }
  }

  for (const ve of variantExpansionsData) {
    if (!allComponentIds.has(ve.component_id)) {
      errors.push(`Variant expansion references unknown component "${ve.component_id}"`);
    }
  }

  for (const cr of calibrationRatesData) {
    if (!scopeById.has(cr.scope_id)) {
      errors.push(`Calibration rate references unknown scope "${cr.scope_id}"`);
    }
  }

  const tradesWithNoScopes = tradesData.filter(
    t => t.trade_id !== "general_contractor_gc" && !scopesByTradeId.has(t.trade_id)
  );
  if (tradesWithNoScopes.length > 0) {
    for (const t of tradesWithNoScopes) {
      warnings.push(`Trade "${t.trade_id}" has no scopes`);
    }
  }

  const tradesWithNoComponents = tradesData.filter(
    t => t.trade_id !== "general_contractor_gc" && !componentsByTradeId.has(t.trade_id)
  );
  if (tradesWithNoComponents.length > 0) {
    for (const t of tradesWithNoComponents) {
      warnings.push(`Trade "${t.trade_id}" has no components`);
    }
  }

  const totalComponents = tradeComponentsData.reduce((sum, tc) => sum + tc.components.length, 0);
  const totalVariants = variantExpansionsData.reduce((sum, ve) => sum + ve.variants.length, 0);

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    counts: {
      trades: tradesData.length,
      scopes: scopesData.length,
      materials: materialsData.length,
      formulas: formulasData.length,
      components: totalComponents,
      variants: totalVariants,
      calibrationRates: calibrationRatesData.length,
    },
  };
}
