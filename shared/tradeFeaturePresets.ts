import type { FeatureFlagKey } from "./schema/features";
import { FEATURE_FLAG_KEYS } from "./schema/features";

export type TradeFeaturePreset = Record<FeatureFlagKey, boolean>;

const CORE_FLAGS: FeatureFlagKey[] = [
  "INTEGRATIONS_HUB",
  "APPROVALS_FRAMEWORK",
  "DOCUMENT_CONTROL",
  "PROJECT_HEALTH_SCORE",
  "SESSION_MANAGEMENT",
];

const FINANCE_CORE_FLAGS: FeatureFlagKey[] = [
  "INTEGRATION_QBO",
];

const FINANCE_ENTERPRISE_FLAGS: FeatureFlagKey[] = [
  "REVENUE_RECOGNITION",
];

const ENTERPRISE_FLAGS: FeatureFlagKey[] = [
  "SSO",
  "AUDIT_EXPORT",
  "DATA_RETENTION",
  "PRIVACY_COMPLIANCE",
  "EXECUTIVE_DIGEST",
  "AI_GOVERNANCE",
];

const HIRING_FLAGS: FeatureFlagKey[] = [
  "HIRING_MODULE",
  "HIRING_AI_SCORING",
  "HIRING_AUTO_TASKS",
  "HIRING_ATS_SYNC",
];

const ADVANCED_TECH_FLAGS: FeatureFlagKey[] = [
  "BIM_VIEWER",
  "LIDAR_SCANNER",
  "WHATIF_SIMULATOR",
];

const COMMS_FLAGS: FeatureFlagKey[] = [
  "VIDEO_CALLS",
  "SMS_NOTIFICATIONS",
  "MOBILE_OFFLINE_V2",
];

const INTEGRATION_FLAGS: FeatureFlagKey[] = [
  "INTEGRATION_GOOGLE",
  "INTEGRATION_MICROSOFT",
  "INTEGRATION_ESIGN",
  "INTEGRATION_ZAPIER",
];

function buildPreset(enabledGroups: FeatureFlagKey[][]): TradeFeaturePreset {
  const preset = {} as TradeFeaturePreset;
  const enabledSet = new Set(enabledGroups.flat());
  for (const key of FEATURE_FLAG_KEYS) {
    preset[key] = enabledSet.has(key);
  }
  return preset;
}

const GC_PRESET = buildPreset([
  CORE_FLAGS,
  FINANCE_CORE_FLAGS,
  FINANCE_ENTERPRISE_FLAGS,
  ENTERPRISE_FLAGS,
  HIRING_FLAGS,
  ADVANCED_TECH_FLAGS,
  COMMS_FLAGS,
  INTEGRATION_FLAGS,
]);

// Specialty trades (roofing, concrete, demolition, masonry, etc.) are field-heavy
// crews that invoice through QuickBooks — both MOBILE_OFFLINE_V2 and the QBO
// integration are part of their day-one workflow.
const SPECIALTY_TRADE_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  ["MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
]);

const TECH_TRADE_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  ["MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
]);

// Finish trades (drywall, paint, flooring, glazing) are small-business shops
// that almost universally book revenue through QuickBooks Online.
const FINISH_TRADE_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  ["MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
]);

// Civil sitework crews need QBO for accounting alongside their mobile workflow;
// the heavy-civil DOT bundle is intentionally not enabled here so private-site
// civil contractors aren't pushed into DOT-only modules.
const CIVIL_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  ["MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
]);

const HEAVY_CIVIL_FLAGS: FeatureFlagKey[] = [
  "DOT_PAY_ITEMS",
  "DBE_TRACKING",
  "WH_347_PAYROLL",
  "HAUL_TICKETS",
  "DAILY_INSPECTOR_REPORTS",
  "SWPPP_INSPECTIONS",
  "SURETY_BONDS",
  "BUY_AMERICA",
  "MASS_HAUL_ANALYZER",
  "DOT_PROGRESS_ESTIMATE",
  "HEAVY_CIVIL_PRESET",
];

const HEAVY_CIVIL_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  HEAVY_CIVIL_FLAGS,
  ["MOBILE_OFFLINE_V2", "BIM_VIEWER", "LIDAR_SCANNER"] as FeatureFlagKey[],
]);

const STRUCTURAL_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  ["MOBILE_OFFLINE_V2", "BIM_VIEWER"] as FeatureFlagKey[],
]);

// MEP coordination (HVAC, mechanical piping, plumbing systems, fire protection,
// low-voltage, electrical raceway) is the primary commercial use case for the
// 3D BIM viewer — clash detection between trades is a near-universal need.
const MEP_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  FINANCE_CORE_FLAGS,
  ["MOBILE_OFFLINE_V2", "BIM_VIEWER"] as FeatureFlagKey[],
]);

// Support trades (survey, testing/inspection, commissioning, temporary
// facilities, general conditions) operate primarily in the field and need
// the offline-capable mobile experience to capture data on site.
const SUPPORT_PRESET = buildPreset([
  CORE_FLAGS,
  INTEGRATION_FLAGS,
  ["MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
]);

// Notes on intentional opt-ins (NOT bundled into any non-GC preset):
//   - HIRING_* flags: hiring is a back-office function that smaller trades
//     prefer to leave off until they actually staff up; GC keeps the bundle.
//   - EXECUTIVE_DIGEST: leadership weekly digest, GC-only.
//   - SMS_NOTIFICATIONS, VIDEO_CALLS, TWILIO_INTEGRATION: paid third-party
//     services (Twilio, Daily.co) — must be opted-in by the customer.
//   - LIDAR_SCANNER: specialized as-built capture; structural/heavy-civil
//     enable it explicitly, others opt in.
//   - REVENUE_RECOGNITION, SSO, AUDIT_EXPORT, DATA_RETENTION,
//     PRIVACY_COMPLIANCE, AI_GOVERNANCE: enterprise-tier compliance modules
//     that don't belong in a starter preset for a smaller subcontractor.

const EXPLICIT_PRESETS: Record<string, TradeFeaturePreset> = {
  GENERAL_CONTRACTOR: GC_PRESET,

  ELECTRICAL: TECH_TRADE_PRESET,
  PLUMBING: TECH_TRADE_PRESET,
  HVAC: TECH_TRADE_PRESET,
  SOLAR: buildPreset([
    CORE_FLAGS,
    INTEGRATION_FLAGS,
    FINANCE_CORE_FLAGS,
    ["BIM_VIEWER", "MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
  ]),

  ROOFING: SPECIALTY_TRADE_PRESET,
  CONCRETE: SPECIALTY_TRADE_PRESET,
  DEMOLITION: SPECIALTY_TRADE_PRESET,
  MASONRY: SPECIALTY_TRADE_PRESET,
  INSULATION: SPECIALTY_TRADE_PRESET,
  LANDSCAPING: SPECIALTY_TRADE_PRESET,
  WATERPROOFING: SPECIALTY_TRADE_PRESET,
  CARPENTRY: SPECIALTY_TRADE_PRESET,

  DRYWALL: FINISH_TRADE_PRESET,
  PAINTING: FINISH_TRADE_PRESET,
  FLOORING: FINISH_TRADE_PRESET,
  GLAZING: FINISH_TRADE_PRESET,

  STEEL_ERECTION: STRUCTURAL_PRESET,
  FIRE_PROTECTION: MEP_PRESET,
  LOW_VOLTAGE: MEP_PRESET,

  EARTHWORK: CIVIL_PRESET,
  ASPHALT_PAVING: HEAVY_CIVIL_PRESET,

  SITE_DEMOLITION: CIVIL_PRESET,
  MASS_EXCAVATION: HEAVY_CIVIL_PRESET,
  TRENCHING: HEAVY_CIVIL_PRESET,
  SHORING: HEAVY_CIVIL_PRESET,
  DEWATERING: HEAVY_CIVIL_PRESET,
  SOIL_STABILIZATION: HEAVY_CIVIL_PRESET,
  ENVIRONMENTAL_REMEDIATION: CIVIL_PRESET,
  WELL_PLUGGING: CIVIL_PRESET,
  STORMWATER_SYSTEMS: HEAVY_CIVIL_PRESET,
  SANITARY_SEWER: HEAVY_CIVIL_PRESET,
  WATERLINE: HEAVY_CIVIL_PRESET,
  FORCE_MAIN: HEAVY_CIVIL_PRESET,
  ROADWAY_CONSTRUCTION: HEAVY_CIVIL_PRESET,
  CURB_AND_GUTTER: HEAVY_CIVIL_PRESET,
  SIDEWALK: HEAVY_CIVIL_PRESET,
  CONCRETE_PAVING: HEAVY_CIVIL_PRESET,
  TRAFFIC_CONTROL: HEAVY_CIVIL_PRESET,
  STRIPING_AND_SIGNAGE: HEAVY_CIVIL_PRESET,
  EROSION_CONTROL: HEAVY_CIVIL_PRESET,
  FENCING_AND_GATES: CIVIL_PRESET,

  CAST_IN_PLACE_CONCRETE: STRUCTURAL_PRESET,
  PRECAST_CONCRETE: STRUCTURAL_PRESET,
  REBAR_AND_POST_TENSION: STRUCTURAL_PRESET,
  STRUCTURAL_STEEL: STRUCTURAL_PRESET,
  METAL_BUILDINGS: STRUCTURAL_PRESET,
  CARPENTRY_FRAMING: STRUCTURAL_PRESET,
  DRYWALL_SYSTEMS: FINISH_TRADE_PRESET,
  ACOUSTICAL_CEILINGS: FINISH_TRADE_PRESET,
  PAINTING_AND_COATINGS: FINISH_TRADE_PRESET,
  FLOORING_SYSTEMS: FINISH_TRADE_PRESET,
  ROOFING_SYSTEMS: SPECIALTY_TRADE_PRESET,
  MASONRY_SYSTEMS: SPECIALTY_TRADE_PRESET,
  GLAZING_SYSTEMS: FINISH_TRADE_PRESET,

  ELECTRICAL_UNDERGROUND: MEP_PRESET,
  ELECTRICAL_OVERHEAD: MEP_PRESET,
  MECHANICAL_PIPING: MEP_PRESET,
  HVAC_SYSTEMS: MEP_PRESET,
  PLUMBING_SYSTEMS: MEP_PRESET,
  FIRE_PROTECTION_SYSTEMS: MEP_PRESET,
  LOW_VOLTAGE_SYSTEMS: MEP_PRESET,
  SECURITY_AND_ACCESS: MEP_PRESET,
  COMMUNICATIONS_IT: MEP_PRESET,
  SOLAR_INSTALLATION: buildPreset([
    CORE_FLAGS,
    INTEGRATION_FLAGS,
    FINANCE_CORE_FLAGS,
    ["BIM_VIEWER", "MOBILE_OFFLINE_V2"] as FeatureFlagKey[],
  ]),
  TEMPORARY_POWER: MEP_PRESET,

  SURVEY_AND_LAYOUT: SUPPORT_PRESET,
  TESTING_AND_INSPECTIONS: SUPPORT_PRESET,
  COMMISSIONING: SUPPORT_PRESET,
  TEMPORARY_FACILITIES: SUPPORT_PRESET,
  GENERAL_CONDITIONS: SUPPORT_PRESET,

  OTHER: SPECIALTY_TRADE_PRESET,
};

export function getFeaturePresetForTrade(tradeType: string): TradeFeaturePreset {
  return EXPLICIT_PRESETS[tradeType] ?? SPECIALTY_TRADE_PRESET;
}

export function hasExplicitPresetForTrade(tradeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXPLICIT_PRESETS, tradeType);
}
