/**
 * Trade Type Utilities
 * Functions for normalizing and validating trade types from various input formats.
 *
 * Task #2100 — `VALID_TRADE_TYPES` is the canonical TypeScript reflection of
 * the database enum `tradeTypeEnum` defined in `shared/schema/enums.ts`. Any
 * value writeable to `organizations.trade_type` (or any other column typed
 * `tradeTypeEnum`) must be present in this list, and `getTradeDisplayName`,
 * `LEGACY_TRADE_CATEGORIES`, the per-trade category configs and the cost-code
 * lookup must all have an entry (or an explicit fallback) for it. A small set
 * of legacy TS-only types (FRAMING, WINDOWS_DOORS, SIDING, TILE, CABINETRY,
 * COUNTERTOPS, FENCING, DECKING) are retained because the library/category UI
 * and a number of estimate/scope screens persist them in `varchar` columns
 * that long predate the heavy-civil expansion of the enum.
 */

export const VALID_TRADE_TYPES = [
  // === EXISTING TRADES (legacy + DB enum) ===
  'GENERAL_CONTRACTOR',
  'CONCRETE',
  'EARTHWORK',
  'ASPHALT_PAVING',
  'ROOFING',
  'ELECTRICAL',
  'PLUMBING',
  'HVAC',
  'CARPENTRY',
  'MASONRY',
  'DRYWALL',
  'PAINTING',
  'FLOORING',
  'LANDSCAPING',
  'DEMOLITION',
  'STEEL_ERECTION',
  'GLAZING',
  'INSULATION',
  'FIRE_PROTECTION',
  'LOW_VOLTAGE',
  'SOLAR',
  'WATERPROOFING',

  // === LEGACY TS-ONLY TYPES (retained for library/UI compatibility) ===
  'FRAMING',
  'WINDOWS_DOORS',
  'SIDING',
  'TILE',
  'CABINETRY',
  'COUNTERTOPS',
  'FENCING',
  'DECKING',

  // === CIVIL / SITE / ENVIRONMENTAL (DB enum) ===
  'SITE_DEMOLITION',
  'MASS_EXCAVATION',
  'TRENCHING',
  'SHORING',
  'DEWATERING',
  'SOIL_STABILIZATION',
  'ENVIRONMENTAL_REMEDIATION',
  'WELL_PLUGGING',
  'STORMWATER_SYSTEMS',
  'SANITARY_SEWER',
  'WATERLINE',
  'FORCE_MAIN',
  'ROADWAY_CONSTRUCTION',
  'CURB_AND_GUTTER',
  'SIDEWALK',
  'CONCRETE_PAVING',
  'TRAFFIC_CONTROL',
  'STRIPING_AND_SIGNAGE',
  'EROSION_CONTROL',
  'FENCING_AND_GATES',

  // === STRUCTURAL / BUILDING (DB enum) ===
  'CAST_IN_PLACE_CONCRETE',
  'PRECAST_CONCRETE',
  'REBAR_AND_POST_TENSION',
  'STRUCTURAL_STEEL',
  'METAL_BUILDINGS',
  'CARPENTRY_FRAMING',
  'DRYWALL_SYSTEMS',
  'ACOUSTICAL_CEILINGS',
  'PAINTING_AND_COATINGS',
  'FLOORING_SYSTEMS',
  'ROOFING_SYSTEMS',
  'MASONRY_SYSTEMS',
  'GLAZING_SYSTEMS',

  // === MEP / SPECIALTY (DB enum) ===
  'ELECTRICAL_UNDERGROUND',
  'ELECTRICAL_OVERHEAD',
  'MECHANICAL_PIPING',
  'HVAC_SYSTEMS',
  'PLUMBING_SYSTEMS',
  'FIRE_PROTECTION_SYSTEMS',
  'LOW_VOLTAGE_SYSTEMS',
  'SECURITY_AND_ACCESS',
  'COMMUNICATIONS_IT',
  'SOLAR_INSTALLATION',
  'TEMPORARY_POWER',

  // === SUPPORT / SERVICES (DB enum) ===
  'SURVEY_AND_LAYOUT',
  'TESTING_AND_INSPECTIONS',
  'COMMISSIONING',
  'TEMPORARY_FACILITIES',
  'GENERAL_CONDITIONS',

  // === CATCH-ALL ===
  'OTHER',
] as const;

export type TradeType = typeof VALID_TRADE_TYPES[number];

/**
 * Task #2100 — explicit fallback map: every "specialised" trade points to the
 * closest "base" trade so cost-code, category-config and seeder lookups can
 * resolve against a sensible bucket without having to duplicate the entire
 * configuration for each new heavy-civil enum value. Base trades map to
 * themselves so callers can walk the chain unconditionally.
 */
export const BASE_TRADE_FALLBACKS: Record<TradeType, TradeType> = {
  // Base trades resolve to themselves.
  GENERAL_CONTRACTOR: 'GENERAL_CONTRACTOR',
  CONCRETE: 'CONCRETE',
  EARTHWORK: 'EARTHWORK',
  ASPHALT_PAVING: 'ASPHALT_PAVING',
  ROOFING: 'ROOFING',
  ELECTRICAL: 'ELECTRICAL',
  PLUMBING: 'PLUMBING',
  HVAC: 'HVAC',
  CARPENTRY: 'FRAMING',
  MASONRY: 'MASONRY',
  DRYWALL: 'DRYWALL',
  PAINTING: 'PAINTING',
  FLOORING: 'FLOORING',
  LANDSCAPING: 'LANDSCAPING',
  DEMOLITION: 'DEMOLITION',
  STEEL_ERECTION: 'STEEL_ERECTION',
  GLAZING: 'WINDOWS_DOORS',
  INSULATION: 'INSULATION',
  FIRE_PROTECTION: 'FIRE_PROTECTION',
  LOW_VOLTAGE: 'LOW_VOLTAGE',
  SOLAR: 'SOLAR',
  WATERPROOFING: 'WATERPROOFING',
  FRAMING: 'FRAMING',
  WINDOWS_DOORS: 'WINDOWS_DOORS',
  SIDING: 'SIDING',
  TILE: 'TILE',
  CABINETRY: 'CABINETRY',
  COUNTERTOPS: 'COUNTERTOPS',
  FENCING: 'FENCING',
  DECKING: 'DECKING',
  OTHER: 'OTHER',

  // Civil/Site/Environmental fall back to EARTHWORK or DEMOLITION.
  SITE_DEMOLITION: 'DEMOLITION',
  MASS_EXCAVATION: 'EARTHWORK',
  TRENCHING: 'EARTHWORK',
  SHORING: 'EARTHWORK',
  DEWATERING: 'EARTHWORK',
  SOIL_STABILIZATION: 'EARTHWORK',
  ENVIRONMENTAL_REMEDIATION: 'DEMOLITION',
  WELL_PLUGGING: 'EARTHWORK',
  STORMWATER_SYSTEMS: 'EARTHWORK',
  SANITARY_SEWER: 'EARTHWORK',
  WATERLINE: 'EARTHWORK',
  FORCE_MAIN: 'EARTHWORK',
  ROADWAY_CONSTRUCTION: 'ASPHALT_PAVING',
  CURB_AND_GUTTER: 'CONCRETE',
  SIDEWALK: 'CONCRETE',
  CONCRETE_PAVING: 'CONCRETE',
  TRAFFIC_CONTROL: 'ASPHALT_PAVING',
  STRIPING_AND_SIGNAGE: 'ASPHALT_PAVING',
  EROSION_CONTROL: 'EARTHWORK',
  FENCING_AND_GATES: 'FENCING',

  // Structural/building specialisations fall back to their base trade.
  CAST_IN_PLACE_CONCRETE: 'CONCRETE',
  PRECAST_CONCRETE: 'CONCRETE',
  REBAR_AND_POST_TENSION: 'CONCRETE',
  STRUCTURAL_STEEL: 'STEEL_ERECTION',
  METAL_BUILDINGS: 'STEEL_ERECTION',
  CARPENTRY_FRAMING: 'FRAMING',
  DRYWALL_SYSTEMS: 'DRYWALL',
  ACOUSTICAL_CEILINGS: 'DRYWALL',
  PAINTING_AND_COATINGS: 'PAINTING',
  FLOORING_SYSTEMS: 'FLOORING',
  ROOFING_SYSTEMS: 'ROOFING',
  MASONRY_SYSTEMS: 'MASONRY',
  GLAZING_SYSTEMS: 'WINDOWS_DOORS',

  // MEP/specialty specialisations fall back to their base trade.
  ELECTRICAL_UNDERGROUND: 'ELECTRICAL',
  ELECTRICAL_OVERHEAD: 'ELECTRICAL',
  MECHANICAL_PIPING: 'HVAC',
  HVAC_SYSTEMS: 'HVAC',
  PLUMBING_SYSTEMS: 'PLUMBING',
  FIRE_PROTECTION_SYSTEMS: 'FIRE_PROTECTION',
  LOW_VOLTAGE_SYSTEMS: 'LOW_VOLTAGE',
  SECURITY_AND_ACCESS: 'LOW_VOLTAGE',
  COMMUNICATIONS_IT: 'LOW_VOLTAGE',
  SOLAR_INSTALLATION: 'SOLAR',
  TEMPORARY_POWER: 'ELECTRICAL',

  // Support/services fall back to GENERAL_CONTRACTOR.
  SURVEY_AND_LAYOUT: 'GENERAL_CONTRACTOR',
  TESTING_AND_INSPECTIONS: 'GENERAL_CONTRACTOR',
  COMMISSIONING: 'GENERAL_CONTRACTOR',
  TEMPORARY_FACILITIES: 'GENERAL_CONTRACTOR',
  GENERAL_CONDITIONS: 'GENERAL_CONTRACTOR',
};

/**
 * Resolve a trade type to its closest "base" trade — used by the cost-code
 * and per-trade category-config lookups so newer specialised enum values
 * inherit a sensible default without requiring a hand-written entry for
 * every variant. Returns the input itself if it is already a base trade or
 * is unknown.
 */
export function resolveBaseTradeType(tradeType: string | null | undefined): TradeType {
  if (!tradeType) return 'OTHER';
  const fallback = BASE_TRADE_FALLBACKS[tradeType as TradeType];
  return fallback ?? 'OTHER';
}

export const TRADE_TYPE_ALIASES: Record<string, TradeType> = {
  // GENERAL_CONTRACTOR - full phrases and variations
  'gc': 'GENERAL_CONTRACTOR',
  'general': 'GENERAL_CONTRACTOR',
  'general contractor': 'GENERAL_CONTRACTOR',
  'general contracting': 'GENERAL_CONTRACTOR',
  'builder': 'GENERAL_CONTRACTOR',
  'home builder': 'GENERAL_CONTRACTOR',
  'residential builder': 'GENERAL_CONTRACTOR',
  'commercial builder': 'GENERAL_CONTRACTOR',
  'construction company': 'GENERAL_CONTRACTOR',
  'construction contractor': 'GENERAL_CONTRACTOR',
  'custom home builder': 'GENERAL_CONTRACTOR',
  'design build': 'GENERAL_CONTRACTOR',
  'general construction': 'GENERAL_CONTRACTOR',

  // ELECTRICAL
  'electrician': 'ELECTRICAL',
  'electric': 'ELECTRICAL',
  'electrical': 'ELECTRICAL',
  'electrical contractor': 'ELECTRICAL',
  'electrical company': 'ELECTRICAL',
  'wiring': 'ELECTRICAL',
  'electrical work': 'ELECTRICAL',
  'commercial electrical': 'ELECTRICAL',
  'residential electrical': 'ELECTRICAL',

  // PLUMBING
  'plumber': 'PLUMBING',
  'plumbing': 'PLUMBING',
  'plumbing contractor': 'PLUMBING',
  'plumbing company': 'PLUMBING',
  'plumber contractor': 'PLUMBING',
  'pipe fitting': 'PLUMBING',
  'pipefitting': 'PLUMBING',

  // HVAC
  'hvac': 'HVAC',
  'heating': 'HVAC',
  'air conditioning': 'HVAC',
  'ac': 'HVAC',
  'hvac contractor': 'HVAC',
  'hvac company': 'HVAC',
  'hvac tech': 'HVAC',
  'hvac technician': 'HVAC',
  'heating and cooling': 'HVAC',
  'heating cooling': 'HVAC',
  'mechanical contractor': 'HVAC',
  'refrigeration': 'HVAC',

  // ROOFING
  'roofer': 'ROOFING',
  'roofing': 'ROOFING',
  'roofing contractor': 'ROOFING',
  'roofing company': 'ROOFING',
  'shingle': 'ROOFING',
  'shingler': 'ROOFING',
  'roof repair': 'ROOFING',
  'roof replacement': 'ROOFING',
  'commercial roofing': 'ROOFING',
  'residential roofing': 'ROOFING',

  // CONCRETE
  'concrete': 'CONCRETE',
  'cement': 'CONCRETE',
  'flatwork': 'CONCRETE',
  'concrete contractor': 'CONCRETE',
  'concrete company': 'CONCRETE',
  'concrete work': 'CONCRETE',
  'concrete finisher': 'CONCRETE',
  'foundation': 'CONCRETE',
  'foundation contractor': 'CONCRETE',
  'slab work': 'CONCRETE',

  // FRAMING (legacy bucket — see CARPENTRY below for the DB enum value)
  'framing': 'FRAMING',
  'framer': 'FRAMING',
  'wood framing': 'FRAMING',
  'framing contractor': 'FRAMING',
  'framing company': 'FRAMING',
  'rough carpentry': 'FRAMING',
  'structural framing': 'FRAMING',

  // CARPENTRY (DB enum value — bare "carpentry"/"carpenter" routes here so
  // the canonical heavy-civil enum value is returned instead of the legacy
  // FRAMING bucket).
  'carpentry': 'CARPENTRY',
  'carpenter': 'CARPENTRY',
  'finish carpentry': 'CARPENTRY',
  'trim carpentry': 'CARPENTRY',
  'millwork': 'CARPENTRY',

  // DRYWALL
  'drywall': 'DRYWALL',
  'sheetrock': 'DRYWALL',
  'drywall installation': 'DRYWALL',
  'drywall contractor': 'DRYWALL',
  'drywall company': 'DRYWALL',
  'drywall hanging': 'DRYWALL',
  'drywall taping': 'DRYWALL',
  'drywall finishing': 'DRYWALL',

  // PAINTING
  'painting': 'PAINTING',
  'painter': 'PAINTING',
  'painting contractor': 'PAINTING',
  'painting company': 'PAINTING',
  'house painter': 'PAINTING',
  'commercial painter': 'PAINTING',
  'residential painter': 'PAINTING',
  'paint': 'PAINTING',

  // FLOORING
  'flooring': 'FLOORING',
  'floor': 'FLOORING',
  'hardwood': 'FLOORING',
  'carpet': 'FLOORING',
  'flooring contractor': 'FLOORING',
  'flooring company': 'FLOORING',
  'flooring co': 'FLOORING',
  'floor installation': 'FLOORING',
  'vinyl flooring': 'FLOORING',
  'laminate': 'FLOORING',

  // LANDSCAPING
  'landscaping': 'LANDSCAPING',
  'yard work': 'LANDSCAPING',
  'lawn care': 'LANDSCAPING',
  'lawn': 'LANDSCAPING',
  'landscaper': 'LANDSCAPING',
  'landscape contractor': 'LANDSCAPING',
  'landscape company': 'LANDSCAPING',
  'hardscape': 'LANDSCAPING',
  'softscape': 'LANDSCAPING',
  'irrigation': 'LANDSCAPING',

  // DEMOLITION
  'demolition': 'DEMOLITION',
  'demo': 'DEMOLITION',
  'teardown': 'DEMOLITION',
  'demolition contractor': 'DEMOLITION',
  'demolition company': 'DEMOLITION',
  'tear out': 'DEMOLITION',
  'strip out': 'DEMOLITION',

  // MASONRY
  'masonry': 'MASONRY',
  'brick': 'MASONRY',
  'stone': 'MASONRY',
  'stonework': 'MASONRY',
  'brickwork': 'MASONRY',
  'mason': 'MASONRY',
  'masonry contractor': 'MASONRY',
  'masonry company': 'MASONRY',
  'block work': 'MASONRY',
  'block layer': 'MASONRY',

  // INSULATION
  'insulation': 'INSULATION',
  'thermal': 'INSULATION',
  'spray foam': 'INSULATION',
  'insulation contractor': 'INSULATION',
  'insulation company': 'INSULATION',
  'insulator': 'INSULATION',
  'blown insulation': 'INSULATION',
  'batt insulation': 'INSULATION',

  // WINDOWS_DOORS / GLAZING — bare "glazing" maps to the DB enum value.
  'windows doors': 'WINDOWS_DOORS',
  'window': 'WINDOWS_DOORS',
  'door': 'WINDOWS_DOORS',
  'windows': 'WINDOWS_DOORS',
  'doors': 'WINDOWS_DOORS',
  'window installation': 'WINDOWS_DOORS',
  'door installation': 'WINDOWS_DOORS',
  'window contractor': 'WINDOWS_DOORS',
  'door contractor': 'WINDOWS_DOORS',
  'glazing': 'GLAZING',
  'glazier': 'GLAZING',
  'glass': 'GLAZING',
  'curtain wall': 'GLAZING',
  'storefront': 'GLAZING',

  // SIDING
  'siding': 'SIDING',
  'exterior': 'SIDING',
  'vinyl siding': 'SIDING',
  'siding contractor': 'SIDING',
  'siding company': 'SIDING',
  'exterior cladding': 'SIDING',
  'hardie board': 'SIDING',
  'james hardie': 'SIDING',

  // TILE
  'tile': 'TILE',
  'tiling': 'TILE',
  'tile work': 'TILE',
  'backsplash': 'TILE',
  'tile contractor': 'TILE',
  'tile company': 'TILE',
  'ceramic tile': 'TILE',
  'porcelain tile': 'TILE',
  'tile setter': 'TILE',

  // CABINETRY
  'cabinetry': 'CABINETRY',
  'cabinet': 'CABINETRY',
  'cabinets': 'CABINETRY',
  'cabinet installation': 'CABINETRY',
  'cabinet contractor': 'CABINETRY',
  'cabinet maker': 'CABINETRY',
  'kitchen cabinets': 'CABINETRY',
  'custom cabinets': 'CABINETRY',

  // COUNTERTOPS
  'countertops': 'COUNTERTOPS',
  'countertop': 'COUNTERTOPS',
  'granite': 'COUNTERTOPS',
  'quartz': 'COUNTERTOPS',
  'countertop installation': 'COUNTERTOPS',
  'countertop contractor': 'COUNTERTOPS',
  'stone fabrication': 'COUNTERTOPS',
  'marble': 'COUNTERTOPS',

  // FENCING / FENCING_AND_GATES
  'fencing': 'FENCING',
  'fence': 'FENCING',
  'fences': 'FENCING',
  'fence contractor': 'FENCING',
  'fence company': 'FENCING',
  'fence installation': 'FENCING',
  'fence builder': 'FENCING',
  'fencing and gates': 'FENCING_AND_GATES',
  'gate installation': 'FENCING_AND_GATES',
  'automatic gate': 'FENCING_AND_GATES',

  // DECKING
  'decking': 'DECKING',
  'deck': 'DECKING',
  'deck building': 'DECKING',
  'patio': 'DECKING',
  'deck contractor': 'DECKING',
  'deck company': 'DECKING',
  'deck builder': 'DECKING',
  'outdoor living': 'DECKING',
  'pergola': 'DECKING',

  // SOLAR
  'solar': 'SOLAR',
  'solar panel': 'SOLAR',
  'solar installation': 'SOLAR_INSTALLATION',
  'photovoltaic': 'SOLAR',
  'pv': 'SOLAR',
  'solar contractor': 'SOLAR',
  'solar company': 'SOLAR',
  'solar installer': 'SOLAR_INSTALLATION',
  'renewable energy': 'SOLAR',

  // EARTHWORK / Site & Civil
  'earthwork': 'EARTHWORK',
  'excavation': 'EARTHWORK',
  'excavator': 'EARTHWORK',
  'grading': 'EARTHWORK',
  'site work': 'EARTHWORK',
  'sitework': 'EARTHWORK',
  'site civil': 'EARTHWORK',
  'site utilities': 'EARTHWORK',
  'civil contractor': 'EARTHWORK',

  // === Heavy-civil / DB enum aliases (Task #2100) ===
  'asphalt': 'ASPHALT_PAVING',
  'asphalt paving': 'ASPHALT_PAVING',
  'paving': 'ASPHALT_PAVING',
  'asphalt contractor': 'ASPHALT_PAVING',
  'paving contractor': 'ASPHALT_PAVING',

  'steel erection': 'STEEL_ERECTION',
  'steel erector': 'STEEL_ERECTION',
  'iron worker': 'STEEL_ERECTION',
  'ironworker': 'STEEL_ERECTION',
  'steel': 'STEEL_ERECTION',

  'fire protection': 'FIRE_PROTECTION',
  'fire sprinkler': 'FIRE_PROTECTION',
  'sprinkler': 'FIRE_PROTECTION',
  'fire suppression': 'FIRE_PROTECTION',

  'low voltage': 'LOW_VOLTAGE',
  'low-voltage': 'LOW_VOLTAGE',
  'av': 'LOW_VOLTAGE',
  'audio visual': 'LOW_VOLTAGE',

  'waterproofing': 'WATERPROOFING',
  'waterproof': 'WATERPROOFING',
  'caulking': 'WATERPROOFING',
  'sealants': 'WATERPROOFING',

  // Civil/Site/Environmental
  'site demolition': 'SITE_DEMOLITION',
  'site demo': 'SITE_DEMOLITION',
  'mass excavation': 'MASS_EXCAVATION',
  'bulk excavation': 'MASS_EXCAVATION',
  'trenching': 'TRENCHING',
  'utility trenching': 'TRENCHING',
  'shoring': 'SHORING',
  'excavation support': 'SHORING',
  'dewatering': 'DEWATERING',
  'soil stabilization': 'SOIL_STABILIZATION',
  'ground improvement': 'SOIL_STABILIZATION',
  'environmental remediation': 'ENVIRONMENTAL_REMEDIATION',
  'remediation': 'ENVIRONMENTAL_REMEDIATION',
  'hazmat': 'ENVIRONMENTAL_REMEDIATION',
  'well plugging': 'WELL_PLUGGING',
  'well abandonment': 'WELL_PLUGGING',
  'stormwater': 'STORMWATER_SYSTEMS',
  'storm sewer': 'STORMWATER_SYSTEMS',
  'storm drain': 'STORMWATER_SYSTEMS',
  'sanitary sewer': 'SANITARY_SEWER',
  'sewer': 'SANITARY_SEWER',
  'waterline': 'WATERLINE',
  'water main': 'WATERLINE',
  'force main': 'FORCE_MAIN',
  'roadway': 'ROADWAY_CONSTRUCTION',
  'road construction': 'ROADWAY_CONSTRUCTION',
  'highway': 'ROADWAY_CONSTRUCTION',
  'curb and gutter': 'CURB_AND_GUTTER',
  'curb gutter': 'CURB_AND_GUTTER',
  'sidewalk': 'SIDEWALK',
  'concrete paving': 'CONCRETE_PAVING',
  'traffic control': 'TRAFFIC_CONTROL',
  'striping': 'STRIPING_AND_SIGNAGE',
  'pavement marking': 'STRIPING_AND_SIGNAGE',
  'signage': 'STRIPING_AND_SIGNAGE',
  'erosion control': 'EROSION_CONTROL',
  'sediment control': 'EROSION_CONTROL',

  // Structural/building
  'cast in place': 'CAST_IN_PLACE_CONCRETE',
  'cast-in-place concrete': 'CAST_IN_PLACE_CONCRETE',
  'cip concrete': 'CAST_IN_PLACE_CONCRETE',
  'precast': 'PRECAST_CONCRETE',
  'precast concrete': 'PRECAST_CONCRETE',
  'rebar': 'REBAR_AND_POST_TENSION',
  'reinforcement': 'REBAR_AND_POST_TENSION',
  'post tension': 'REBAR_AND_POST_TENSION',
  'post-tension': 'REBAR_AND_POST_TENSION',
  'structural steel': 'STRUCTURAL_STEEL',
  'metal building': 'METAL_BUILDINGS',
  'pre engineered metal building': 'METAL_BUILDINGS',
  'pemb': 'METAL_BUILDINGS',
  'carpentry framing': 'CARPENTRY_FRAMING',
  'drywall systems': 'DRYWALL_SYSTEMS',
  'acoustical ceilings': 'ACOUSTICAL_CEILINGS',
  'acoustic ceilings': 'ACOUSTICAL_CEILINGS',
  'painting and coatings': 'PAINTING_AND_COATINGS',
  'industrial coatings': 'PAINTING_AND_COATINGS',
  'flooring systems': 'FLOORING_SYSTEMS',
  'roofing systems': 'ROOFING_SYSTEMS',
  'masonry systems': 'MASONRY_SYSTEMS',
  'glazing systems': 'GLAZING_SYSTEMS',

  // MEP/Specialty
  'electrical underground': 'ELECTRICAL_UNDERGROUND',
  'underground electric': 'ELECTRICAL_UNDERGROUND',
  'duct bank': 'ELECTRICAL_UNDERGROUND',
  'electrical overhead': 'ELECTRICAL_OVERHEAD',
  'overhead power': 'ELECTRICAL_OVERHEAD',
  'mechanical piping': 'MECHANICAL_PIPING',
  'process piping': 'MECHANICAL_PIPING',
  'hvac systems': 'HVAC_SYSTEMS',
  'plumbing systems': 'PLUMBING_SYSTEMS',
  'fire protection systems': 'FIRE_PROTECTION_SYSTEMS',
  'low voltage systems': 'LOW_VOLTAGE_SYSTEMS',
  'security and access': 'SECURITY_AND_ACCESS',
  'security access': 'SECURITY_AND_ACCESS',
  'access control': 'SECURITY_AND_ACCESS',
  'communications it': 'COMMUNICATIONS_IT',
  'communications': 'COMMUNICATIONS_IT',
  'it cabling': 'COMMUNICATIONS_IT',
  'temporary power': 'TEMPORARY_POWER',
  'temp power': 'TEMPORARY_POWER',

  // Support/Services
  'survey': 'SURVEY_AND_LAYOUT',
  'survey and layout': 'SURVEY_AND_LAYOUT',
  'layout': 'SURVEY_AND_LAYOUT',
  'testing and inspections': 'TESTING_AND_INSPECTIONS',
  'inspections': 'TESTING_AND_INSPECTIONS',
  'qc testing': 'TESTING_AND_INSPECTIONS',
  'commissioning': 'COMMISSIONING',
  'cx services': 'COMMISSIONING',
  'temporary facilities': 'TEMPORARY_FACILITIES',
  'temp facilities': 'TEMPORARY_FACILITIES',
  'general conditions': 'GENERAL_CONDITIONS',
};

export const EXTENDED_TRADE_REGISTRY: Record<string, TradeType> = {
  'general_contractor_gc': 'GENERAL_CONTRACTOR',
  'concrete_cast_in_place': 'CONCRETE',
  'concrete_foundations': 'CONCRETE',
  'concrete_precast': 'CONCRETE',
  'concrete_tilt_up': 'CONCRETE',
  'concrete_post_tension': 'CONCRETE',
  'rebar_installation': 'CONCRETE',
  'concrete_polishing_finishing': 'CONCRETE',
  'concrete_repair_restoration': 'CONCRETE',
  'concrete_cutting_coring': 'CONCRETE',
  'concrete_pumping': 'CONCRETE',
  'shotcrete': 'CONCRETE',
  'electrical_branch_rough_in': 'ELECTRICAL',
  'electrical_service_distribution': 'ELECTRICAL',
  'electrical_underground_duct_bank': 'ELECTRICAL',
  'electrical_overhead_utility': 'ELECTRICAL',
  'electrical_fire_alarm': 'ELECTRICAL',
  'electrical_generator_ups': 'ELECTRICAL',
  'electrical_lighting_controls': 'ELECTRICAL',
  'electrical_testing_commissioning': 'ELECTRICAL',
  'plumbing_rough_in': 'PLUMBING',
  'plumbing_fixtures_trim': 'PLUMBING',
  'plumbing_underground_utilities': 'PLUMBING',
  'plumbing_medical_gas': 'PLUMBING',
  'plumbing_backflow_prevention': 'PLUMBING',
  'hvac_ductwork_sheet_metal': 'HVAC',
  'hvac_piping': 'HVAC',
  'hvac_equipment_setting': 'HVAC',
  'hvac_controls_automation': 'HVAC',
  'hvac_testing_balancing': 'HVAC',
  'hvac_refrigeration': 'HVAC',
  'roofing_tpo_pvc_epdm': 'ROOFING',
  'roofing_shingle': 'ROOFING',
  'roofing_metal_panel': 'ROOFING',
  'roofing_built_up_modified_bitumen': 'ROOFING',
  'roofing_slate_tile': 'ROOFING',
  'roofing_spray_foam': 'ROOFING',
  'roofing_green_vegetated': 'ROOFING',
  'carpentry_rough': 'FRAMING',
  'carpentry_finish_trim': 'FRAMING',
  'metal_stud_framing_interior': 'FRAMING',
  'metal_stud_framing_exterior': 'FRAMING',
  'drywall_hanging': 'DRYWALL',
  'drywall_finishing_tape_mud': 'DRYWALL',
  'painting_interior_exterior': 'PAINTING',
  'industrial_coatings': 'PAINTING',
  'specialty_finishes_venetian_plaster': 'PAINTING',
  'lvt_lvp': 'FLOORING',
  'carpet': 'FLOORING',
  'tile_ceramic_porcelain': 'TILE',
  'hardwood_engineered': 'FLOORING',
  'polished_concrete_epoxy_floor': 'FLOORING',
  'rubber_sport_flooring': 'FLOORING',
  'terrazzo': 'FLOORING',
  'landscaping_planting': 'LANDSCAPING',
  'landscaping_irrigation': 'LANDSCAPING',
  'landscaping_hardscape': 'LANDSCAPING',
  'demolition_selective_interior': 'DEMOLITION',
  'demolition_structural': 'DEMOLITION',
  'demolition_hazmat_abatement': 'DEMOLITION',
  'structural_steel_erection': 'STEEL_ERECTION',
  'structural_steel_fabrication': 'STEEL_ERECTION',
  'misc_metals_ornamental_iron': 'STEEL_ERECTION',
  'masonry_cmu': 'MASONRY',
  'masonry_brick_veneer': 'MASONRY',
  'masonry_stone_natural_manufactured': 'MASONRY',
  'masonry_restoration': 'MASONRY',
  'insulation_thermal': 'INSULATION',
  'insulation_firestopping': 'INSULATION',
  'insulation_acoustical': 'INSULATION',
  'glazing_storefront_curtain_wall': 'WINDOWS_DOORS',
  'glazing_windows_residential_commercial': 'WINDOWS_DOORS',
  'door_hardware_installation': 'WINDOWS_DOORS',
  'specialty_glass_mirrors': 'WINDOWS_DOORS',
  'fire_sprinkler_wet': 'FIRE_PROTECTION',
  'fire_sprinkler_dry_preaction': 'FIRE_PROTECTION',
  'fire_suppression_clean_agent': 'FIRE_PROTECTION',
  'fire_pump_installation': 'FIRE_PROTECTION',
  'waterproofing_below_grade': 'WATERPROOFING',
  'waterproofing_above_grade': 'WATERPROOFING',
  'caulking_joint_sealants': 'WATERPROOFING',
  'asphalt_paving': 'ASPHALT_PAVING',
  'concrete_paving_sidewalks': 'ASPHALT_PAVING',
  'striping_pavement_markings': 'ASPHALT_PAVING',
  'low_voltage_fire_alarm': 'LOW_VOLTAGE',
  'low_voltage_security_access_control': 'LOW_VOLTAGE',
  'low_voltage_av_telecom': 'LOW_VOLTAGE',
  'low_voltage_nurse_call': 'LOW_VOLTAGE',
  'solar_pv_rooftop': 'SOLAR',
  'solar_pv_ground_mount': 'SOLAR',
  'solar_battery_storage': 'SOLAR',
  'earthwork_grading': 'EARTHWORK',
  'earthwork_excavation': 'EARTHWORK',
  'earthwork_backfill_compaction': 'EARTHWORK',
  'site_utilities_storm_sewer_water': 'EARTHWORK',
  'erosion_control_seeding': 'EARTHWORK',
  // Task #2082 — additional civil/utility long-tail trades that should land in
  // the EARTHWORK bucket so they pick up the dedicated category configuration.
  'earthwork_mass_excavation': 'EARTHWORK',
  'trenching_backfill': 'EARTHWORK',
  'grading_fine_grading': 'EARTHWORK',
  'site_clearing_grubbing': 'EARTHWORK',
  'soil_stabilization': 'EARTHWORK',
  'dewatering': 'EARTHWORK',
  'shoring_excavation_support': 'EARTHWORK',
  'sanitary_sewer_civil': 'EARTHWORK',
  'storm_drain_civil': 'EARTHWORK',
  'waterline_civil': 'EARTHWORK',
  'gas_utility_civil': 'EARTHWORK',
  'telecom_duct_bank_civil': 'EARTHWORK',
  'directional_boring_hdd': 'EARTHWORK',
  'erosion_sediment_control': 'EARTHWORK',
  'tree_removal_arborist': 'EARTHWORK',
  'retaining_walls_segmental_concrete': 'EARTHWORK',
  'site_lighting_electrical': 'EARTHWORK',
  'siding_exterior_cladding': 'SIDING',
  'eifs_stucco': 'SIDING',
  'metal_wall_panels': 'SIDING',
  'cabinetry_millwork': 'CABINETRY',
  'countertops_solid_surface': 'COUNTERTOPS',
  'fencing_gates': 'FENCING',
  'decking_outdoor_structures': 'DECKING',
  'acoustical_ceilings_act': 'OTHER',
  'elevator_escalator': 'OTHER',
  'signage_wayfinding': 'OTHER',
  'swimming_pool_construction': 'OTHER',
  // Task #2082 — long-tail specialty trades that have no closer fit fall into
  // the OTHER bucket so the seed picks them up via the OTHER configuration.
  'elevators_traction_hydraulic': 'OTHER',
  'signage_interior_exterior': 'OTHER',
  'wayfinding_graphics': 'OTHER',
  'pool_spa': 'OTHER',
  'well_drilling': 'OTHER',
  'septic_systems': 'OTHER',
  'asbestos_abatement': 'OTHER',
  'lead_abatement': 'OTHER',
  'mold_remediation': 'OTHER',
  'tank_removal_ust_ast': 'OTHER',
  'hazmat_regulated_waste_handling': 'OTHER',
  'contaminated_soil_remediation': 'OTHER',
  'playground_equipment': 'OTHER',
  'bleachers_athletic_equipment': 'OTHER',
  'conveyors_warehouse': 'OTHER',
  'dock_levelers': 'OTHER',
  'operable_walls': 'OTHER',
  'overhead_crane_systems': 'OTHER',
  'modular_buildings': 'OTHER',
  'pre_engineered_metal_buildings_pemb': 'OTHER',
  'residential_lift': 'OTHER',
  'specialty_equipment_install': 'OTHER',
};

export function mapOnboardingTradeIdToLegacy(onboardingTradeId: string): TradeType {
  return EXTENDED_TRADE_REGISTRY[onboardingTradeId] || 'OTHER';
}

export function getLibraryTradeIdsForLegacy(legacyTradeType: string): string[] {
  const result: string[] = [];
  for (const [tradeId, legacy] of Object.entries(EXTENDED_TRADE_REGISTRY)) {
    if (legacy === legacyTradeType) {
      result.push(tradeId);
    }
  }
  return result;
}

export function normalizeToOnboardingTradeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim().replace(/\s+/g, '_');
  if (EXTENDED_TRADE_REGISTRY[lower] !== undefined) {
    return lower;
  }
  for (const [tradeId] of Object.entries(EXTENDED_TRADE_REGISTRY)) {
    if (tradeId.includes(lower) || lower.includes(tradeId)) {
      return tradeId;
    }
  }
  return null;
}

/**
 * Normalize a trade type string to a valid TradeType enum value.
 * Maps common variations, abbreviations, and misspellings to valid trade types.
 *
 * @param extractedType - The trade type string to normalize (e.g., "general contractor", "gc", "electrician")
 * @returns The normalized trade type (e.g., "GENERAL_CONTRACTOR", "ELECTRICAL") or null if input is empty
 */
export function normalizeTradeType(extractedType: string | null | undefined): TradeType | null {
  if (!extractedType) return null;

  const normalized = extractedType.toLowerCase().trim();

  // Direct match (case-insensitive)
  const upperType = extractedType.toUpperCase().replace(/\s+/g, '_');
  if ((VALID_TRADE_TYPES as readonly string[]).includes(upperType)) {
    return upperType as TradeType;
  }

  // Check aliases
  if (TRADE_TYPE_ALIASES[normalized]) {
    return TRADE_TYPE_ALIASES[normalized];
  }

  // Partial match - find the best match based on keywords. Prefer the longest
  // alias match so e.g. "asphalt paving" wins over plain "paving" → both map
  // to ASPHALT_PAVING but the targeted alias is more deterministic. Skip very
  // short aliases (<4 chars) for substring matching so initialisms like "av",
  // "gc", "pv" don't false-positive on words like "weaving" or "construction".
  let bestAlias: string | null = null;
  for (const alias of Object.keys(TRADE_TYPE_ALIASES)) {
    if (alias.length < 4) continue;
    if (normalized.includes(alias) || alias.includes(normalized)) {
      if (!bestAlias || alias.length > bestAlias.length) {
        bestAlias = alias;
      }
    }
  }
  if (bestAlias) {
    return TRADE_TYPE_ALIASES[bestAlias];
  }

  // No match found - return OTHER for custom trades
  return 'OTHER';
}

/**
 * Check if a string is a valid trade type
 */
export function isValidTradeType(value: string): value is TradeType {
  return (VALID_TRADE_TYPES as readonly string[]).includes(value);
}

/**
 * Get a display-friendly name for a trade type. The map below is exhaustive
 * by virtue of TS's `Record<TradeType, string>` so every enum value (Task
 * #2100) is guaranteed to have a human label.
 */
export function getTradeDisplayName(tradeType: TradeType): string {
  const displayNames: Record<TradeType, string> = {
    GENERAL_CONTRACTOR: 'General Contractor',
    CONCRETE: 'Concrete',
    EARTHWORK: 'Earthwork & Site Utilities',
    ASPHALT_PAVING: 'Asphalt Paving',
    ROOFING: 'Roofing',
    ELECTRICAL: 'Electrical',
    PLUMBING: 'Plumbing',
    HVAC: 'HVAC',
    CARPENTRY: 'Carpentry',
    MASONRY: 'Masonry',
    DRYWALL: 'Drywall',
    PAINTING: 'Painting',
    FLOORING: 'Flooring',
    LANDSCAPING: 'Landscaping',
    DEMOLITION: 'Demolition',
    STEEL_ERECTION: 'Steel Erection',
    GLAZING: 'Glazing',
    INSULATION: 'Insulation',
    FIRE_PROTECTION: 'Fire Protection',
    LOW_VOLTAGE: 'Low Voltage',
    SOLAR: 'Solar',
    WATERPROOFING: 'Waterproofing',

    FRAMING: 'Framing',
    WINDOWS_DOORS: 'Windows & Doors',
    SIDING: 'Siding',
    TILE: 'Tile',
    CABINETRY: 'Cabinetry',
    COUNTERTOPS: 'Countertops',
    FENCING: 'Fencing',
    DECKING: 'Decking',

    SITE_DEMOLITION: 'Site Demolition',
    MASS_EXCAVATION: 'Mass Excavation',
    TRENCHING: 'Trenching',
    SHORING: 'Shoring',
    DEWATERING: 'Dewatering',
    SOIL_STABILIZATION: 'Soil Stabilization',
    ENVIRONMENTAL_REMEDIATION: 'Environmental Remediation',
    WELL_PLUGGING: 'Well Plugging',
    STORMWATER_SYSTEMS: 'Stormwater Systems',
    SANITARY_SEWER: 'Sanitary Sewer',
    WATERLINE: 'Waterline',
    FORCE_MAIN: 'Force Main',
    ROADWAY_CONSTRUCTION: 'Roadway Construction',
    CURB_AND_GUTTER: 'Curb & Gutter',
    SIDEWALK: 'Sidewalk',
    CONCRETE_PAVING: 'Concrete Paving',
    TRAFFIC_CONTROL: 'Traffic Control',
    STRIPING_AND_SIGNAGE: 'Striping & Signage',
    EROSION_CONTROL: 'Erosion Control',
    FENCING_AND_GATES: 'Fencing & Gates',

    CAST_IN_PLACE_CONCRETE: 'Cast-in-Place Concrete',
    PRECAST_CONCRETE: 'Precast Concrete',
    REBAR_AND_POST_TENSION: 'Rebar & Post-Tension',
    STRUCTURAL_STEEL: 'Structural Steel',
    METAL_BUILDINGS: 'Metal Buildings',
    CARPENTRY_FRAMING: 'Carpentry & Framing',
    DRYWALL_SYSTEMS: 'Drywall Systems',
    ACOUSTICAL_CEILINGS: 'Acoustical Ceilings',
    PAINTING_AND_COATINGS: 'Painting & Coatings',
    FLOORING_SYSTEMS: 'Flooring Systems',
    ROOFING_SYSTEMS: 'Roofing Systems',
    MASONRY_SYSTEMS: 'Masonry Systems',
    GLAZING_SYSTEMS: 'Glazing Systems',

    ELECTRICAL_UNDERGROUND: 'Electrical (Underground)',
    ELECTRICAL_OVERHEAD: 'Electrical (Overhead)',
    MECHANICAL_PIPING: 'Mechanical Piping',
    HVAC_SYSTEMS: 'HVAC Systems',
    PLUMBING_SYSTEMS: 'Plumbing Systems',
    FIRE_PROTECTION_SYSTEMS: 'Fire Protection Systems',
    LOW_VOLTAGE_SYSTEMS: 'Low Voltage Systems',
    SECURITY_AND_ACCESS: 'Security & Access',
    COMMUNICATIONS_IT: 'Communications / IT',
    SOLAR_INSTALLATION: 'Solar Installation',
    TEMPORARY_POWER: 'Temporary Power',

    SURVEY_AND_LAYOUT: 'Survey & Layout',
    TESTING_AND_INSPECTIONS: 'Testing & Inspections',
    COMMISSIONING: 'Commissioning',
    TEMPORARY_FACILITIES: 'Temporary Facilities',
    GENERAL_CONDITIONS: 'General Conditions',

    OTHER: 'Other/Custom',
  };

  return displayNames[tradeType] || tradeType;
}

/**
 * Maps every trade type to the CSI-style category folder used by the
 * library/scope seeders. Made exhaustive in Task #2100 so heavy-civil enum
 * values are no longer silently funneled to the "Specialty Systems" bucket.
 */
const LEGACY_TRADE_CATEGORIES: Record<TradeType, string> = {
  // Precon / general
  GENERAL_CONTRACTOR: '01_Precon_General_Conditions',
  SURVEY_AND_LAYOUT: '01_Precon_General_Conditions',
  TESTING_AND_INSPECTIONS: '01_Precon_General_Conditions',
  COMMISSIONING: '01_Precon_General_Conditions',
  TEMPORARY_FACILITIES: '01_Precon_General_Conditions',
  GENERAL_CONDITIONS: '01_Precon_General_Conditions',

  // Site/civil
  EARTHWORK: '02_Site_Civil',
  ASPHALT_PAVING: '02_Site_Civil',
  LANDSCAPING: '02_Site_Civil',
  DEMOLITION: '02_Site_Civil',
  FENCING: '02_Site_Civil',
  SITE_DEMOLITION: '02_Site_Civil',
  MASS_EXCAVATION: '02_Site_Civil',
  TRENCHING: '02_Site_Civil',
  SHORING: '02_Site_Civil',
  DEWATERING: '02_Site_Civil',
  SOIL_STABILIZATION: '02_Site_Civil',
  ENVIRONMENTAL_REMEDIATION: '02_Site_Civil',
  WELL_PLUGGING: '02_Site_Civil',
  STORMWATER_SYSTEMS: '02_Site_Civil',
  SANITARY_SEWER: '02_Site_Civil',
  WATERLINE: '02_Site_Civil',
  FORCE_MAIN: '02_Site_Civil',
  ROADWAY_CONSTRUCTION: '02_Site_Civil',
  CURB_AND_GUTTER: '02_Site_Civil',
  SIDEWALK: '02_Site_Civil',
  CONCRETE_PAVING: '02_Site_Civil',
  TRAFFIC_CONTROL: '02_Site_Civil',
  STRIPING_AND_SIGNAGE: '02_Site_Civil',
  EROSION_CONTROL: '02_Site_Civil',
  FENCING_AND_GATES: '02_Site_Civil',

  // Concrete & masonry
  CONCRETE: '03_Concrete_Structural',
  MASONRY: '03_Concrete_Structural',
  CAST_IN_PLACE_CONCRETE: '03_Concrete_Structural',
  PRECAST_CONCRETE: '03_Concrete_Structural',
  REBAR_AND_POST_TENSION: '03_Concrete_Structural',
  MASONRY_SYSTEMS: '03_Concrete_Structural',

  // Steel
  STEEL_ERECTION: '04_Steel_Metals',
  STRUCTURAL_STEEL: '04_Steel_Metals',
  METAL_BUILDINGS: '04_Steel_Metals',

  // Carpentry / framing
  FRAMING: '05_Framing_Carpentry',
  CABINETRY: '05_Framing_Carpentry',
  DECKING: '05_Framing_Carpentry',
  CARPENTRY: '05_Framing_Carpentry',
  CARPENTRY_FRAMING: '05_Framing_Carpentry',

  // Envelope
  ROOFING: '06_Building_Envelope',
  INSULATION: '06_Building_Envelope',
  SIDING: '06_Building_Envelope',
  WATERPROOFING: '06_Building_Envelope',
  ROOFING_SYSTEMS: '06_Building_Envelope',

  // Openings/glazing
  WINDOWS_DOORS: '07_Openings_Glazing',
  GLAZING: '07_Openings_Glazing',
  GLAZING_SYSTEMS: '07_Openings_Glazing',

  // Drywall / ceilings
  DRYWALL: '08_Interiors_Drywall_Ceilings',
  DRYWALL_SYSTEMS: '08_Interiors_Drywall_Ceilings',
  ACOUSTICAL_CEILINGS: '08_Interiors_Drywall_Ceilings',

  // Finishes
  PAINTING: '09_Finishes',
  FLOORING: '09_Finishes',
  TILE: '09_Finishes',
  COUNTERTOPS: '09_Finishes',
  PAINTING_AND_COATINGS: '09_Finishes',
  FLOORING_SYSTEMS: '09_Finishes',

  // MEP
  PLUMBING: '10_MEP_Plumbing',
  PLUMBING_SYSTEMS: '10_MEP_Plumbing',
  MECHANICAL_PIPING: '10_MEP_Plumbing',
  HVAC: '11_MEP_HVAC',
  HVAC_SYSTEMS: '11_MEP_HVAC',
  ELECTRICAL: '12_MEP_Electrical',
  SOLAR: '12_MEP_Electrical',
  ELECTRICAL_UNDERGROUND: '12_MEP_Electrical',
  ELECTRICAL_OVERHEAD: '12_MEP_Electrical',
  SOLAR_INSTALLATION: '12_MEP_Electrical',
  TEMPORARY_POWER: '12_MEP_Electrical',

  // Low voltage / fire
  LOW_VOLTAGE: '13_LowVoltage_Security_Fire',
  LOW_VOLTAGE_SYSTEMS: '13_LowVoltage_Security_Fire',
  SECURITY_AND_ACCESS: '13_LowVoltage_Security_Fire',
  COMMUNICATIONS_IT: '13_LowVoltage_Security_Fire',
  FIRE_PROTECTION: '14_Fire_Protection',
  FIRE_PROTECTION_SYSTEMS: '14_Fire_Protection',

  // Catch-all
  OTHER: '15_Specialty_Systems',
};

export function getTradeCategory(tradeType: TradeType): string {
  return LEGACY_TRADE_CATEGORIES[tradeType] || '15_Specialty_Systems';
}

export function formatTradeCategoryLabel(category: string): string {
  return category.replace(/^\d+_/, '').replace(/_/g, ' ');
}
