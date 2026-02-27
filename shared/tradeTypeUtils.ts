/**
 * Trade Type Utilities
 * Functions for normalizing and validating trade types from various input formats
 */

export const VALID_TRADE_TYPES = [
  'GENERAL_CONTRACTOR', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'ROOFING',
  'CONCRETE', 'FRAMING', 'DRYWALL', 'PAINTING', 'FLOORING', 'LANDSCAPING',
  'DEMOLITION', 'MASONRY', 'INSULATION', 'WINDOWS_DOORS', 'SIDING', 'TILE',
  'CABINETRY', 'COUNTERTOPS', 'FENCING', 'DECKING', 'SOLAR', 'OTHER'
] as const;

export type TradeType = typeof VALID_TRADE_TYPES[number];

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
  
  // FRAMING
  'framing': 'FRAMING',
  'carpentry': 'FRAMING',
  'framer': 'FRAMING',
  'wood framing': 'FRAMING',
  'framing contractor': 'FRAMING',
  'framing company': 'FRAMING',
  'carpenter': 'FRAMING',
  'rough carpentry': 'FRAMING',
  'structural framing': 'FRAMING',
  
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
  
  // WINDOWS_DOORS
  'windows doors': 'WINDOWS_DOORS',
  'window': 'WINDOWS_DOORS',
  'door': 'WINDOWS_DOORS',
  'windows': 'WINDOWS_DOORS',
  'doors': 'WINDOWS_DOORS',
  'window installation': 'WINDOWS_DOORS',
  'door installation': 'WINDOWS_DOORS',
  'window contractor': 'WINDOWS_DOORS',
  'door contractor': 'WINDOWS_DOORS',
  'glazing': 'WINDOWS_DOORS',
  'glass': 'WINDOWS_DOORS',
  
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
  
  // FENCING
  'fencing': 'FENCING',
  'fence': 'FENCING',
  'fences': 'FENCING',
  'fence contractor': 'FENCING',
  'fence company': 'FENCING',
  'fence installation': 'FENCING',
  'fence builder': 'FENCING',
  
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
  'solar installation': 'SOLAR',
  'photovoltaic': 'SOLAR',
  'pv': 'SOLAR',
  'solar contractor': 'SOLAR',
  'solar company': 'SOLAR',
  'solar installer': 'SOLAR',
  'renewable energy': 'SOLAR',
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
  
  // Partial match - find the best match based on keywords
  for (const [alias, tradeType] of Object.entries(TRADE_TYPE_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return tradeType;
    }
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
 * Get a display-friendly name for a trade type
 */
export function getTradeDisplayName(tradeType: TradeType): string {
  const displayNames: Record<TradeType, string> = {
    GENERAL_CONTRACTOR: 'General Contractor',
    ELECTRICAL: 'Electrical',
    PLUMBING: 'Plumbing',
    HVAC: 'HVAC',
    ROOFING: 'Roofing',
    CONCRETE: 'Concrete',
    FRAMING: 'Framing',
    DRYWALL: 'Drywall',
    PAINTING: 'Painting',
    FLOORING: 'Flooring',
    LANDSCAPING: 'Landscaping',
    DEMOLITION: 'Demolition',
    MASONRY: 'Masonry',
    INSULATION: 'Insulation',
    WINDOWS_DOORS: 'Windows & Doors',
    SIDING: 'Siding',
    TILE: 'Tile',
    CABINETRY: 'Cabinetry',
    COUNTERTOPS: 'Countertops',
    FENCING: 'Fencing',
    DECKING: 'Decking',
    SOLAR: 'Solar',
    OTHER: 'Other/Custom',
  };
  
  return displayNames[tradeType] || tradeType;
}

const LEGACY_TRADE_CATEGORIES: Record<TradeType, string> = {
  GENERAL_CONTRACTOR: '01_Precon_General_Conditions',
  CONCRETE: '03_Concrete_Structural',
  EARTHWORK: '02_Site_Civil',
  ASPHALT_PAVING: '02_Site_Civil',
  ROOFING: '06_Building_Envelope',
  ELECTRICAL: '12_MEP_Electrical',
  PLUMBING: '10_MEP_Plumbing',
  HVAC: '11_MEP_HVAC',
  FRAMING: '05_Framing_Carpentry',
  DRYWALL: '08_Interiors_Drywall_Ceilings',
  PAINTING: '09_Finishes',
  FLOORING: '09_Finishes',
  LANDSCAPING: '02_Site_Civil',
  DEMOLITION: '02_Site_Civil',
  MASONRY: '03_Concrete_Structural',
  INSULATION: '06_Building_Envelope',
  WINDOWS_DOORS: '07_Openings_Glazing',
  SIDING: '06_Building_Envelope',
  TILE: '09_Finishes',
  CABINETRY: '05_Framing_Carpentry',
  COUNTERTOPS: '09_Finishes',
  FENCING: '02_Site_Civil',
  DECKING: '05_Framing_Carpentry',
  SOLAR: '12_MEP_Electrical',
  STEEL_ERECTION: '04_Steel_Metals',
  FIRE_PROTECTION: '14_Fire_Protection',
  LOW_VOLTAGE: '13_LowVoltage_Security_Fire',
  WATERPROOFING: '06_Building_Envelope',
  OTHER: '15_Specialty_Systems',
};

export function getTradeCategory(tradeType: TradeType): string {
  return LEGACY_TRADE_CATEGORIES[tradeType] || '15_Specialty_Systems';
}

export function formatTradeCategoryLabel(category: string): string {
  return category.replace(/^\d+_/, '').replace(/_/g, ' ');
}
