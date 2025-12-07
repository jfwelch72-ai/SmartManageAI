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
