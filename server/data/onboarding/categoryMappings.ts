import type { TradeType } from "@shared/tradeTypeUtils";

export interface ComponentRule {
  match: string | string[];
  category: string;
}

export interface TradeCategoryConfig {
  materialGroups?: Record<string, string>;
  componentRules?: ComponentRule[];
  defaultMaterialCategory?: string;
  defaultLaborCategory?: string;
  defaultComponentCategory?: string;
}

export const DEFAULT_MATERIAL_GROUP_LABELS: Record<string, string> = {
  concrete: "Cast-In-Place Concrete",
  reinforcing: "Reinforcing Steel",
  drywall: "Drywall & Gypsum",
  electrical: "Electrical Materials",
  equipment: "Equipment & Rentals",
  flooring: "Flooring",
  hvac: "HVAC Equipment & Ductwork",
  insulation: "Insulation",
  low_voltage: "Low Voltage & Communications",
  masonry: "Masonry",
  metals: "Structural & Misc Metals",
  misc: "Consumables & Miscellaneous",
  paint: "Paint & Coatings",
  plumbing: "Plumbing Piping & Fittings",
  roofing: "Roofing Materials",
  site: "Sitework Materials",
  wood: "Wood, Lumber & Sheathing",
};

export const DEFAULT_COMPONENT_RULES: ComponentRule[] = [
  { match: ["Mobilization", "Pressure Washing", "Testing & Certification", "General Scope Item"], category: "General Conditions" },
  { match: "Formwork", category: "Formwork" },
  { match: ["Rebar", "Reinforc"], category: "Reinforcing Steel" },
  { match: ["Slab on Grade", "Elevated Slab", "Footing", "Grade Beam", "Equipment Pad", "Stairs/Landing", "Concrete Joint Sealant"], category: "Cast-In-Place Concrete" },
  { match: ["Concrete Sidewalk", "Concrete Demo", "Sidewalks", "Curb & Gutter"], category: "Concrete Flatwork" },
  { match: ["CMU", "Tuckpointing", "Lintels", "Mortar", "Grouting"], category: "Masonry" },
  { match: ["Anchor Bolts", "Embeds"], category: "Embeds & Anchors" },
  { match: ["Clearing", "Rough Grading", "Backfill", "Trenching", "Topsoil", "Erosion"], category: "Earthwork & Sitework" },
  { match: ["Asphalt", "Sealcoat", "Tack Coat", "Milling", "Pavement Markings", "Stone Base"], category: "Paving" },
  { match: ["Sod", "Seeding", "Hydroseed", "Mulch", "Planting"], category: "Landscaping & Planting" },
  { match: "Fence", category: "Fencing" },
  { match: ["Roof Membrane", "Roof Insulation", "Flashing"], category: "Roofing Assembly" },
  { match: "Conduit", category: "Conduit & Raceway" },
  { match: ["Cabling", "Devices", "Receptacles", "Switches", "Grounding", "Service/Transformer", "Panels"], category: "Electrical Distribution" },
  { match: "Lighting Fixtures", category: "Lighting" },
  { match: ["Racks & Patch Panels"], category: "Low Voltage & Communications" },
  { match: ["Domestic Water", "Sanitary Waste", "Storm Drain", "Gas Piping", "Backflow"], category: "Piping" },
  { match: "Fixtures (Set & Trim)", category: "Plumbing Fixtures" },
  { match: ["Supply Ductwork", "Return Ductwork", "Exhaust Ductwork", "Grilles", "Diffusers", "Registers"], category: "HVAC Ductwork" },
  { match: ["RTU", "Refrigerant"], category: "HVAC Equipment" },
  { match: ["Gypsum Board", "Shaftwall", "Soffits/Bulkheads", "Air/Vapor Barrier", "Access Panels"], category: "Drywall Assemblies" },
  { match: ["Paint ", "Stain & Clear Coat"], category: "Painting" },
  { match: "Siding", category: "Siding & Cladding" },
  { match: "Countertop", category: "Countertops" },
  { match: ["Flooring", "Base Trim", "Tile", "Epoxy Floor"], category: "Flooring" },
];

export const DEFAULT_LABOR_CATEGORY = "Labor & Installation";
export const DEFAULT_COMPONENT_CATEGORY = "Components & Assemblies";
export const DEFAULT_MATERIAL_CATEGORY = "Materials";

export const TRADE_CATEGORY_CONFIGS: Partial<Record<TradeType, TradeCategoryConfig>> = {
  CONCRETE: {
    componentRules: [
      { match: "Formwork", category: "Formwork" },
      { match: ["Rebar", "Reinforc"], category: "Reinforcing Steel" },
      { match: ["Slab on Grade", "Elevated Slab", "Footing", "Grade Beam", "Equipment Pad", "Stairs/Landing"], category: "Cast-In-Place Concrete" },
      { match: ["Concrete Sidewalk", "Sidewalks", "Curb & Gutter", "Concrete Joint Sealant"], category: "Concrete Flatwork" },
      { match: "Concrete Demo", category: "Demolition" },
    ],
    defaultLaborCategory: "Labor — Placement & Finishing",
  },
  ELECTRICAL: {
    materialGroups: { electrical: "Electrical Materials", low_voltage: "Low Voltage & Communications" },
    componentRules: [
      { match: "Conduit", category: "Conduit & Raceway" },
      { match: ["Service/Transformer", "Panels", "Grounding"], category: "Service & Distribution" },
      { match: ["Receptacles", "Switches", "Devices", "Cabling"], category: "Branch Wiring & Devices" },
      { match: "Lighting Fixtures", category: "Lighting" },
    ],
    defaultLaborCategory: "Labor — Electrical Installation",
  },
  PLUMBING: {
    componentRules: [
      { match: ["Domestic Water", "Sanitary Waste", "Storm Drain", "Gas Piping"], category: "Piping" },
      { match: ["Backflow", "Fixtures (Set & Trim)"], category: "Plumbing Fixtures" },
    ],
    defaultLaborCategory: "Labor — Plumbing Installation",
  },
  HVAC: {
    componentRules: [
      { match: ["Supply Ductwork", "Return Ductwork", "Exhaust Ductwork"], category: "Ductwork" },
      { match: ["Grilles", "Diffusers", "Registers"], category: "Air Distribution" },
      { match: ["RTU", "Refrigerant"], category: "Equipment & Refrigerant" },
    ],
    defaultLaborCategory: "Labor — HVAC Installation",
  },
  ROOFING: {
    componentRules: [
      { match: ["Roof Membrane"], category: "Membrane & Underlayment" },
      { match: ["Roof Insulation"], category: "Roof Insulation" },
      { match: ["Flashing"], category: "Flashing & Trim" },
    ],
    defaultLaborCategory: "Labor — Roofing Installation",
  },
  FRAMING: {
    componentRules: [
      { match: ["Sheathing"], category: "Sheathing" },
    ],
    defaultLaborCategory: "Labor — Framing",
  },
  DRYWALL: {
    componentRules: [
      { match: ["Gypsum Board", "Shaftwall"], category: "Drywall Assemblies" },
      { match: ["Soffits/Bulkheads", "Access Panels"], category: "Soffits & Access" },
    ],
    defaultLaborCategory: "Labor — Hang & Finish",
  },
  PAINTING: {
    componentRules: [
      { match: ["Paint Walls"], category: "Wall Painting" },
      { match: ["Paint Ceilings"], category: "Ceiling Painting" },
      { match: ["Paint Trim/Doors", "Stain & Clear Coat"], category: "Trim & Doors" },
    ],
    defaultLaborCategory: "Labor — Painting",
  },
  FLOORING: {
    componentRules: [
      { match: ["Tile"], category: "Tile" },
      { match: ["Epoxy Floor"], category: "Resinous Flooring" },
      { match: ["Base Trim"], category: "Base & Trim" },
      { match: ["Flooring"], category: "Flooring" },
    ],
    defaultLaborCategory: "Labor — Flooring Installation",
  },
  LANDSCAPING: {
    componentRules: [
      { match: ["Sod", "Seeding", "Hydroseed"], category: "Lawn Establishment" },
      { match: ["Planting"], category: "Trees & Shrubs" },
      { match: ["Mulch", "Topsoil"], category: "Soil & Mulch" },
      { match: ["Erosion"], category: "Erosion Control" },
    ],
    defaultLaborCategory: "Labor — Landscape Installation",
  },
  DEMOLITION: {
    componentRules: [
      { match: ["Concrete Demo"], category: "Concrete Demolition" },
    ],
    defaultLaborCategory: "Labor — Demolition",
    defaultComponentCategory: "Demolition",
  },
  MASONRY: {
    componentRules: [
      { match: ["CMU"], category: "CMU Walls" },
      { match: ["Mortar", "Grouting", "Tuckpointing"], category: "Mortar & Grout" },
      { match: ["Lintels"], category: "Lintels & Accessories" },
    ],
    defaultLaborCategory: "Labor — Masonry",
  },
  INSULATION: {
    defaultLaborCategory: "Labor — Insulation",
  },
  WINDOWS_DOORS: {
    defaultLaborCategory: "Labor — Window & Door Installation",
  },
  SIDING: {
    componentRules: [
      { match: "Siding", category: "Siding & Cladding" },
    ],
    defaultLaborCategory: "Labor — Siding Installation",
  },
  TILE: {
    componentRules: [
      { match: "Tile", category: "Tile" },
    ],
    defaultLaborCategory: "Labor — Tile Setting",
  },
  CABINETRY: {
    defaultLaborCategory: "Labor — Cabinet Installation",
  },
  COUNTERTOPS: {
    componentRules: [
      { match: "Countertop", category: "Countertops" },
    ],
    defaultLaborCategory: "Labor — Countertop Installation",
  },
  FENCING: {
    componentRules: [
      { match: "Fence", category: "Fencing" },
    ],
    defaultLaborCategory: "Labor — Fence Installation",
  },
  DECKING: {
    defaultLaborCategory: "Labor — Deck Construction",
  },
  SOLAR: {
    defaultLaborCategory: "Labor — Solar Installation",
  },
  GENERAL_CONTRACTOR: {
    defaultLaborCategory: "Labor & Installation",
  },
  // Task #2082 — civil/utility long-tail trades funneled into the EARTHWORK
  // bucket get their own purpose-built category map so the seeded library
  // produces real sitework groupings instead of "Components & Assemblies".
  EARTHWORK: {
    componentRules: [
      { match: ["Mobilization", "Pressure Washing", "Testing & Certification", "General Scope Item"], category: "General Conditions" },
      { match: ["Clearing", "Grubbing", "Rough Grading", "Fine Grading", "Mass Excavation"], category: "Earthwork & Grading" },
      { match: ["Trenching", "Backfill", "Compaction", "Topsoil"], category: "Trenching & Backfill" },
      { match: ["Stone Base", "Aggregate Base"], category: "Aggregate Base" },
      { match: ["Erosion", "Silt Fence"], category: "Erosion & Sediment Control" },
      { match: ["Dewatering"], category: "Dewatering" },
      { match: ["Shoring"], category: "Shoring & Excavation Support" },
      {
        match: [
          "Sanitary Sewer",
          "Storm Drain",
          "Storm Sewer",
          "Waterline",
          "Water Main",
          "Gas Utility",
          "Gas Piping",
          "Telecom",
          "Duct Bank",
          "Force Main",
          "Site Utilities",
        ],
        category: "Site Utilities",
      },
      { match: ["Concrete Sidewalk", "Curb & Gutter", "Sidewalks"], category: "Concrete Flatwork" },
      { match: ["Asphalt", "Sealcoat", "Tack Coat", "Milling", "Pavement Markings", "Striping"], category: "Paving" },
      { match: "Fence", category: "Fencing" },
      { match: ["Tree Removal", "Arborist"], category: "Tree Removal & Clearing" },
    ],
    defaultMaterialCategory: "Sitework Materials",
    defaultLaborCategory: "Labor — Earthwork & Site Utilities",
    defaultComponentCategory: "Sitework",
  },
  // Task #2082 — the OTHER bucket used to be a bare `{}` which let any unmapped
  // long-tail component fall back to the global "Components & Assemblies"
  // bucket. The rules below cover the building-envelope, low-voltage, finishes
  // and sitework long-tails so the seeded library produces friendly groupings.
  OTHER: {
    componentRules: [
      { match: ["Mobilization", "Pressure Washing", "Testing & Certification", "General Scope Item"], category: "General Conditions" },
      // Building envelope long-tails
      { match: ["Air/Vapor Barrier", "Air Barrier", "Vapor Barrier", "WRB"], category: "Air & Moisture Barriers" },
      { match: ["Roof Membrane", "Roof Insulation"], category: "Roofing Assembly" },
      { match: ["Flashing"], category: "Flashing & Trim" },
      { match: ["Sealants", "Caulking", "Joint Sealant"], category: "Sealants & Caulking" },
      { match: "Siding", category: "Siding & Cladding" },
      // Sitework long-tails (covers stragglers when an org is set to OTHER)
      { match: ["Clearing", "Grubbing", "Rough Grading", "Fine Grading", "Mass Excavation"], category: "Earthwork & Grading" },
      { match: ["Trenching", "Backfill", "Compaction", "Topsoil"], category: "Trenching & Backfill" },
      { match: ["Stone Base", "Aggregate Base"], category: "Aggregate Base" },
      { match: ["Erosion", "Silt Fence"], category: "Erosion & Sediment Control" },
      { match: ["Concrete Sidewalk", "Curb & Gutter", "Sidewalks"], category: "Concrete Flatwork" },
      { match: "Fence", category: "Fencing" },
      // Finishes long-tails
      { match: "Countertop", category: "Countertops" },
      { match: ["Tile"], category: "Tile" },
      { match: ["Base Trim"], category: "Base & Trim" },
      { match: ["Flooring", "Epoxy Floor"], category: "Flooring" },
      // Low voltage / communications long-tails
      { match: ["Cabling", "Racks & Patch Panels"], category: "Low Voltage & Communications" },
      { match: ["Devices", "Receptacles", "Switches"], category: "Devices & Trim" },
      // Landscaping long-tails
      { match: ["Sod", "Seeding", "Hydroseed"], category: "Lawn Establishment" },
      { match: ["Planting"], category: "Trees & Shrubs" },
      { match: ["Mulch"], category: "Soil & Mulch" },
    ],
    defaultLaborCategory: "Labor — Specialty Installation",
    defaultComponentCategory: "Specialty Installations",
  },
};

function stripQualifiers(name: string): string {
  // Component display names sometimes carry variant qualifiers in brackets,
  // e.g. "Slab on Grade [finish_type:broom, reinforcement_type:wwf]". The
  // qualifier text contains words like "reinforcement" that would otherwise
  // trip the rebar rule, so strip it before matching.
  return name.replace(/\s*\[.*?\]\s*/g, " ").trim();
}

function matchesRule(name: string, match: string | string[]): boolean {
  const lower = stripQualifiers(name).toLowerCase();
  const patterns = Array.isArray(match) ? match : [match];
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function tidyFallback(group: string | undefined): string {
  if (!group) return DEFAULT_MATERIAL_CATEGORY;
  const cleaned = group
    .replace(/^\d+[_-]?/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!cleaned) return DEFAULT_MATERIAL_CATEGORY;
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

/** Resolve a friendly category name for a material based on its `group`. */
export function categoryForMaterial(tradeType: string | null | undefined, group: string | undefined): string {
  const cfg = tradeType ? TRADE_CATEGORY_CONFIGS[tradeType as TradeType] : undefined;
  if (group && cfg?.materialGroups?.[group]) return cfg.materialGroups[group];
  if (group && DEFAULT_MATERIAL_GROUP_LABELS[group]) return DEFAULT_MATERIAL_GROUP_LABELS[group];
  if (cfg?.defaultMaterialCategory) return cfg.defaultMaterialCategory;
  return tidyFallback(group);
}

/** Resolve a friendly category name for a trade component based on its display name. */
export function categoryForComponent(tradeType: string | null | undefined, displayName: string): string {
  const cfg = tradeType ? TRADE_CATEGORY_CONFIGS[tradeType as TradeType] : undefined;
  const stripped = stripQualifiers(displayName);
  const isMaterialOnly = /^material only$/i.test(stripped);
  const isLaborOnly = /^labor only$/i.test(stripped);

  if (isMaterialOnly) {
    return cfg?.defaultMaterialCategory ?? DEFAULT_MATERIAL_CATEGORY;
  }
  if (isLaborOnly) {
    return cfg?.defaultLaborCategory ?? DEFAULT_LABOR_CATEGORY;
  }

  // Specific routing rules win over the broad labor/install heuristic so that
  // a name like "Rebar Install" lands in "Reinforcing Steel" instead of the
  // generic labor bucket.
  for (const rule of cfg?.componentRules ?? []) {
    if (matchesRule(displayName, rule.match)) return rule.category;
  }
  for (const rule of DEFAULT_COMPONENT_RULES) {
    if (matchesRule(displayName, rule.match)) return rule.category;
  }
  if (isLaborComponent(displayName)) {
    return cfg?.defaultLaborCategory ?? DEFAULT_LABOR_CATEGORY;
  }
  return cfg?.defaultComponentCategory ?? DEFAULT_COMPONENT_CATEGORY;
}

/** True when the component is treated as labor (used to set costTypes). */
export function isLaborComponent(displayName: string): boolean {
  return /\b(labor|install)/i.test(stripQualifiers(displayName));
}
