import { logInfo } from "./utils/logger";
import { db } from "./db";
import { masterSowItems, masterModifierCategories, masterModifiers, scopeWorkTypeCategories, scopeWorkTypes, scopeModifierCategories, scopeModifiers } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const civilSiteSowItems = [
  // SITE_DEMOLITION
  { tradeType: "SITE_DEMOLITION", csiCode: "02 41", categoryName: "Site Clearing", name: "Clear and Grub", code: "SD-CLR-001", defaultUomCode: "AC", sortOrder: 1 },
  { tradeType: "SITE_DEMOLITION", csiCode: "02 41", categoryName: "Site Clearing", name: "Tree Removal", code: "SD-TREE-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "SITE_DEMOLITION", csiCode: "02 41", categoryName: "Structure Demo", name: "Building Demolition", code: "SD-BLDG-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "SITE_DEMOLITION", csiCode: "02 41", categoryName: "Pavement Demo", name: "Pavement Removal", code: "SD-PV-001", defaultUomCode: "SY", sortOrder: 4 },
  { tradeType: "SITE_DEMOLITION", csiCode: "02 41", categoryName: "Disposal", name: "Debris Hauling", code: "SD-HAUL-001", defaultUomCode: "CY", sortOrder: 5 },

  // MASS_EXCAVATION
  { tradeType: "MASS_EXCAVATION", csiCode: "31 23", categoryName: "Earthwork", name: "Bulk Excavation", code: "ME-BULK-001", defaultUomCode: "CY", sortOrder: 1 },
  { tradeType: "MASS_EXCAVATION", csiCode: "31 23", categoryName: "Earthwork", name: "Rock Excavation", code: "ME-ROCK-001", defaultUomCode: "CY", sortOrder: 2 },
  { tradeType: "MASS_EXCAVATION", csiCode: "31 23", categoryName: "Grading", name: "Fine Grading", code: "ME-GRADE-001", defaultUomCode: "SY", sortOrder: 3 },
  { tradeType: "MASS_EXCAVATION", csiCode: "31 23", categoryName: "Export", name: "Off-Site Disposal", code: "ME-EXP-001", defaultUomCode: "CY", sortOrder: 4 },
  { tradeType: "MASS_EXCAVATION", csiCode: "31 23", categoryName: "Import", name: "Structural Fill Import", code: "ME-IMP-001", defaultUomCode: "CY", sortOrder: 5 },

  // TRENCHING
  { tradeType: "TRENCHING", csiCode: "31 23", categoryName: "Utility Trenching", name: "Trench Excavation", code: "TR-EXC-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "TRENCHING", csiCode: "31 23", categoryName: "Utility Trenching", name: "Bedding Material", code: "TR-BED-001", defaultUomCode: "CY", sortOrder: 2 },
  { tradeType: "TRENCHING", csiCode: "31 23", categoryName: "Utility Trenching", name: "Backfill", code: "TR-BACK-001", defaultUomCode: "CY", sortOrder: 3 },
  { tradeType: "TRENCHING", csiCode: "31 23", categoryName: "Utility Trenching", name: "Compaction", code: "TR-COMP-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "TRENCHING", csiCode: "31 23", categoryName: "Utility Trenching", name: "Flowable Fill", code: "TR-FLOW-001", defaultUomCode: "CY", sortOrder: 5 },

  // SHORING
  { tradeType: "SHORING", csiCode: "31 50", categoryName: "Excavation Support", name: "Steel Sheet Piling", code: "SH-SHEET-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "SHORING", csiCode: "31 50", categoryName: "Excavation Support", name: "Soldier Pile & Lagging", code: "SH-SOLD-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "SHORING", csiCode: "31 50", categoryName: "Excavation Support", name: "Trench Box", code: "SH-BOX-001", defaultUomCode: "DAY", sortOrder: 3 },
  { tradeType: "SHORING", csiCode: "31 50", categoryName: "Excavation Support", name: "Timber Shoring", code: "SH-TIM-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "SHORING", csiCode: "31 50", categoryName: "Excavation Support", name: "Tieback Anchors", code: "SH-TIE-001", defaultUomCode: "EA", sortOrder: 5 },

  // DEWATERING
  { tradeType: "DEWATERING", csiCode: "31 23", categoryName: "Groundwater Control", name: "Wellpoint System", code: "DW-WELL-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "DEWATERING", csiCode: "31 23", categoryName: "Groundwater Control", name: "Sump Pump", code: "DW-SUMP-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "DEWATERING", csiCode: "31 23", categoryName: "Groundwater Control", name: "Deep Well System", code: "DW-DEEP-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "DEWATERING", csiCode: "31 23", categoryName: "Groundwater Control", name: "Water Disposal", code: "DW-DISP-001", defaultUomCode: "GAL", sortOrder: 4 },
  { tradeType: "DEWATERING", csiCode: "31 23", categoryName: "Groundwater Control", name: "Monitoring", code: "DW-MON-001", defaultUomCode: "DAY", sortOrder: 5 },

  // SOIL_STABILIZATION
  { tradeType: "SOIL_STABILIZATION", csiCode: "31 32", categoryName: "Ground Improvement", name: "Lime Stabilization", code: "SS-LIME-001", defaultUomCode: "CY", sortOrder: 1 },
  { tradeType: "SOIL_STABILIZATION", csiCode: "31 32", categoryName: "Ground Improvement", name: "Cement Stabilization", code: "SS-CEM-001", defaultUomCode: "CY", sortOrder: 2 },
  { tradeType: "SOIL_STABILIZATION", csiCode: "31 32", categoryName: "Ground Improvement", name: "Geotextile Fabric", code: "SS-GEO-001", defaultUomCode: "SY", sortOrder: 3 },
  { tradeType: "SOIL_STABILIZATION", csiCode: "31 32", categoryName: "Ground Improvement", name: "Stone Columns", code: "SS-COL-001", defaultUomCode: "VLF", sortOrder: 4 },
  { tradeType: "SOIL_STABILIZATION", csiCode: "31 32", categoryName: "Ground Improvement", name: "Compaction Grouting", code: "SS-GROUT-001", defaultUomCode: "CY", sortOrder: 5 },

  // ENVIRONMENTAL_REMEDIATION
  { tradeType: "ENVIRONMENTAL_REMEDIATION", csiCode: "02 80", categoryName: "Hazmat", name: "Asbestos Abatement", code: "ER-ASB-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "ENVIRONMENTAL_REMEDIATION", csiCode: "02 80", categoryName: "Hazmat", name: "Lead Paint Removal", code: "ER-LEAD-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "ENVIRONMENTAL_REMEDIATION", csiCode: "02 80", categoryName: "Soil Remediation", name: "Contaminated Soil Removal", code: "ER-SOIL-001", defaultUomCode: "CY", sortOrder: 3 },
  { tradeType: "ENVIRONMENTAL_REMEDIATION", csiCode: "02 80", categoryName: "Hazmat", name: "UST Removal", code: "ER-UST-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "ENVIRONMENTAL_REMEDIATION", csiCode: "02 80", categoryName: "Hazmat", name: "Hazardous Waste Disposal", code: "ER-HAZ-001", defaultUomCode: "CY", sortOrder: 5 },

  // WELL_PLUGGING
  { tradeType: "WELL_PLUGGING", csiCode: "02", categoryName: "Well Abandonment", name: "Well Plugging", code: "WP-PLUG-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "WELL_PLUGGING", csiCode: "02", categoryName: "Well Abandonment", name: "Well Cap Installation", code: "WP-CAP-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "WELL_PLUGGING", csiCode: "02", categoryName: "Well Abandonment", name: "Casing Removal", code: "WP-CASE-001", defaultUomCode: "LF", sortOrder: 3 },
  { tradeType: "WELL_PLUGGING", csiCode: "02", categoryName: "Well Abandonment", name: "Grout Fill", code: "WP-GROUT-001", defaultUomCode: "CY", sortOrder: 4 },
  { tradeType: "WELL_PLUGGING", csiCode: "02", categoryName: "Well Abandonment", name: "Documentation & Reporting", code: "WP-DOC-001", defaultUomCode: "EA", sortOrder: 5 },

  // STORMWATER_SYSTEMS
  { tradeType: "STORMWATER_SYSTEMS", csiCode: "33 40", categoryName: "Storm Drainage", name: "Storm Pipe Installation", code: "SW-PIPE-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "STORMWATER_SYSTEMS", csiCode: "33 40", categoryName: "Storm Drainage", name: "Catch Basin", code: "SW-CB-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "STORMWATER_SYSTEMS", csiCode: "33 40", categoryName: "Storm Drainage", name: "Manhole", code: "SW-MH-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "STORMWATER_SYSTEMS", csiCode: "33 40", categoryName: "Detention", name: "Detention Pond", code: "SW-DET-001", defaultUomCode: "CY", sortOrder: 4 },
  { tradeType: "STORMWATER_SYSTEMS", csiCode: "33 40", categoryName: "Storm Drainage", name: "Outfall Structure", code: "SW-OUT-001", defaultUomCode: "EA", sortOrder: 5 },

  // SANITARY_SEWER
  { tradeType: "SANITARY_SEWER", csiCode: "33 30", categoryName: "Sewer Lines", name: "Gravity Sewer Pipe", code: "SS-GRV-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "SANITARY_SEWER", csiCode: "33 30", categoryName: "Sewer Lines", name: "Sewer Manhole", code: "SS-MH-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "SANITARY_SEWER", csiCode: "33 30", categoryName: "Sewer Lines", name: "Sewer Lateral", code: "SS-LAT-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "SANITARY_SEWER", csiCode: "33 30", categoryName: "Testing", name: "Sewer Testing (Air/Vac)", code: "SS-TEST-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "SANITARY_SEWER", csiCode: "33 30", categoryName: "Rehabilitation", name: "CIPP Lining", code: "SS-CIPP-001", defaultUomCode: "LF", sortOrder: 5 },

  // WATERLINE
  { tradeType: "WATERLINE", csiCode: "33 10", categoryName: "Water Distribution", name: "Water Main Pipe", code: "WL-MAIN-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "WATERLINE", csiCode: "33 10", categoryName: "Water Distribution", name: "Fire Hydrant", code: "WL-HYD-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "WATERLINE", csiCode: "33 10", categoryName: "Water Distribution", name: "Gate Valve", code: "WL-VALVE-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "WATERLINE", csiCode: "33 10", categoryName: "Water Distribution", name: "Water Service", code: "WL-SVC-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "WATERLINE", csiCode: "33 10", categoryName: "Testing", name: "Pressure Testing", code: "WL-TEST-001", defaultUomCode: "LF", sortOrder: 5 },

  // FORCE_MAIN
  { tradeType: "FORCE_MAIN", csiCode: "33 30", categoryName: "Pressurized Sewer", name: "Force Main Pipe", code: "FM-PIPE-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "FORCE_MAIN", csiCode: "33 30", categoryName: "Pressurized Sewer", name: "Lift Station", code: "FM-LIFT-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "FORCE_MAIN", csiCode: "33 30", categoryName: "Pressurized Sewer", name: "Air Release Valve", code: "FM-ARV-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "FORCE_MAIN", csiCode: "33 30", categoryName: "Pressurized Sewer", name: "Cleanout", code: "FM-CO-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "FORCE_MAIN", csiCode: "33 30", categoryName: "Testing", name: "Force Main Testing", code: "FM-TEST-001", defaultUomCode: "LF", sortOrder: 5 },

  // ROADWAY_CONSTRUCTION
  { tradeType: "ROADWAY_CONSTRUCTION", csiCode: "32 10", categoryName: "Road Building", name: "Subgrade Preparation", code: "RC-SUB-001", defaultUomCode: "SY", sortOrder: 1 },
  { tradeType: "ROADWAY_CONSTRUCTION", csiCode: "32 10", categoryName: "Road Building", name: "Aggregate Base", code: "RC-BASE-001", defaultUomCode: "SY", sortOrder: 2 },
  { tradeType: "ROADWAY_CONSTRUCTION", csiCode: "32 10", categoryName: "Road Building", name: "Asphalt Paving", code: "RC-ASP-001", defaultUomCode: "TON", sortOrder: 3 },
  { tradeType: "ROADWAY_CONSTRUCTION", csiCode: "32 10", categoryName: "Road Building", name: "Concrete Paving", code: "RC-CONC-001", defaultUomCode: "SY", sortOrder: 4 },
  { tradeType: "ROADWAY_CONSTRUCTION", csiCode: "32 10", categoryName: "Road Building", name: "Shoulder Work", code: "RC-SHLD-001", defaultUomCode: "LF", sortOrder: 5 },

  // CURB_AND_GUTTER
  { tradeType: "CURB_AND_GUTTER", csiCode: "32 16", categoryName: "Curbs", name: "Standard Curb & Gutter", code: "CG-STD-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "CURB_AND_GUTTER", csiCode: "32 16", categoryName: "Curbs", name: "Mountable Curb", code: "CG-MNT-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "CURB_AND_GUTTER", csiCode: "32 16", categoryName: "Curbs", name: "Barrier Curb", code: "CG-BAR-001", defaultUomCode: "LF", sortOrder: 3 },
  { tradeType: "CURB_AND_GUTTER", csiCode: "32 16", categoryName: "Curbs", name: "Curb Inlet", code: "CG-INLET-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "CURB_AND_GUTTER", csiCode: "32 16", categoryName: "Curbs", name: "ADA Ramp", code: "CG-ADA-001", defaultUomCode: "EA", sortOrder: 5 },

  // SIDEWALK
  { tradeType: "SIDEWALK", csiCode: "32 13", categoryName: "Pedestrian Paving", name: "Concrete Sidewalk", code: "SW-CONC-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "SIDEWALK", csiCode: "32 13", categoryName: "Pedestrian Paving", name: "Brick Pavers", code: "SW-PAVER-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "SIDEWALK", csiCode: "32 13", categoryName: "Pedestrian Paving", name: "ADA Detectable Warning", code: "SW-ADA-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "SIDEWALK", csiCode: "32 13", categoryName: "Pedestrian Paving", name: "Sidewalk Repair", code: "SW-REP-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "SIDEWALK", csiCode: "32 13", categoryName: "Pedestrian Paving", name: "Trail/Path", code: "SW-TRAIL-001", defaultUomCode: "SF", sortOrder: 5 },

  // CONCRETE_PAVING
  { tradeType: "CONCRETE_PAVING", csiCode: "32 13", categoryName: "Flatwork", name: "Concrete Driveway", code: "CP-DRV-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "CONCRETE_PAVING", csiCode: "32 13", categoryName: "Flatwork", name: "Concrete Parking Lot", code: "CP-PARK-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "CONCRETE_PAVING", csiCode: "32 13", categoryName: "Flatwork", name: "Concrete Apron", code: "CP-APRON-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "CONCRETE_PAVING", csiCode: "32 13", categoryName: "Flatwork", name: "Saw Cutting", code: "CP-SAW-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "CONCRETE_PAVING", csiCode: "32 13", categoryName: "Flatwork", name: "Joint Sealing", code: "CP-SEAL-001", defaultUomCode: "LF", sortOrder: 5 },

  // TRAFFIC_CONTROL
  { tradeType: "TRAFFIC_CONTROL", csiCode: "32 17", categoryName: "Traffic Systems", name: "Traffic Signal", code: "TC-SIG-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "TRAFFIC_CONTROL", csiCode: "32 17", categoryName: "Traffic Systems", name: "Traffic Signal Pole", code: "TC-POLE-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "TRAFFIC_CONTROL", csiCode: "32 17", categoryName: "Traffic Systems", name: "Signal Controller", code: "TC-CTRL-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "TRAFFIC_CONTROL", csiCode: "32 17", categoryName: "Traffic Systems", name: "Loop Detector", code: "TC-LOOP-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "TRAFFIC_CONTROL", csiCode: "32 17", categoryName: "Traffic Systems", name: "Conduit & Wiring", code: "TC-COND-001", defaultUomCode: "LF", sortOrder: 5 },

  // STRIPING_AND_SIGNAGE
  { tradeType: "STRIPING_AND_SIGNAGE", csiCode: "32 17", categoryName: "Pavement Markings", name: "Striping (4\" Line)", code: "SN-STR4-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "STRIPING_AND_SIGNAGE", csiCode: "32 17", categoryName: "Pavement Markings", name: "Striping (8\" Line)", code: "SN-STR8-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "STRIPING_AND_SIGNAGE", csiCode: "32 17", categoryName: "Pavement Markings", name: "Parking Stall Marking", code: "SN-PARK-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "STRIPING_AND_SIGNAGE", csiCode: "32 17", categoryName: "Signage", name: "Sign Installation", code: "SN-SIGN-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "STRIPING_AND_SIGNAGE", csiCode: "32 17", categoryName: "Signage", name: "Sign Post", code: "SN-POST-001", defaultUomCode: "EA", sortOrder: 5 },

  // EROSION_CONTROL
  { tradeType: "EROSION_CONTROL", csiCode: "31 25", categoryName: "Erosion Protection", name: "Silt Fence", code: "EC-SILT-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "EROSION_CONTROL", csiCode: "31 25", categoryName: "Erosion Protection", name: "Erosion Control Blanket", code: "EC-BLANK-001", defaultUomCode: "SY", sortOrder: 2 },
  { tradeType: "EROSION_CONTROL", csiCode: "31 25", categoryName: "Erosion Protection", name: "Inlet Protection", code: "EC-INLET-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "EROSION_CONTROL", csiCode: "31 25", categoryName: "Erosion Protection", name: "Check Dam", code: "EC-DAM-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "EROSION_CONTROL", csiCode: "31 25", categoryName: "Erosion Protection", name: "Seeding & Mulching", code: "EC-SEED-001", defaultUomCode: "AC", sortOrder: 5 },

  // FENCING_AND_GATES
  { tradeType: "FENCING_AND_GATES", csiCode: "32 31", categoryName: "Fencing", name: "Chain Link Fence", code: "FG-CL-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "FENCING_AND_GATES", csiCode: "32 31", categoryName: "Fencing", name: "Ornamental Fence", code: "FG-ORN-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "FENCING_AND_GATES", csiCode: "32 31", categoryName: "Fencing", name: "Privacy Fence", code: "FG-PRIV-001", defaultUomCode: "LF", sortOrder: 3 },
  { tradeType: "FENCING_AND_GATES", csiCode: "32 31", categoryName: "Gates", name: "Swing Gate", code: "FG-SWING-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "FENCING_AND_GATES", csiCode: "32 31", categoryName: "Gates", name: "Slide Gate", code: "FG-SLIDE-001", defaultUomCode: "EA", sortOrder: 5 },
] as const;

async function seedCivilSiteSowItems() {
  logInfo("🌱 Seeding Civil/Site/Environmental Master SOW Items...");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const item of civilSiteSowItems) {
    const existing = await db.select()
      .from(masterSowItems)
      .where(and(
        eq(masterSowItems.tradeType, item.tradeType as any),
        eq(masterSowItems.code, item.code)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    
    await db.insert(masterSowItems).values({
      tradeType: item.tradeType as any,
      csiCode: item.csiCode,
      categoryName: item.categoryName,
      name: item.name,
      code: item.code,
      defaultUomCode: item.defaultUomCode,
      sortOrder: item.sortOrder,
      isActive: true,
    });
    inserted++;
  }
  
  logInfo(`✅ Civil/Site SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

// === CONCRETE TRADE SOW ITEMS (Original 23 trades - CSI 03) ===
// These are for organizations with trade_type = "CONCRETE"
const concreteSowItems = [
  // Flatwork - Slabs on Grade
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Flatwork", name: "Slab on Grade (SOG)", code: "CONC-SOG-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Flatwork", name: "Slab on Grade - Reinforced", code: "CONC-SOG-002", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Flatwork", name: "Slab on Grade - Post Tension", code: "CONC-SOG-003", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Flatwork", name: "Warehouse Floor", code: "CONC-WH-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Flatwork", name: "Topping Slab", code: "CONC-TOP-001", defaultUomCode: "SF", sortOrder: 5 },
  
  // Flatwork - Exterior Paving
  { tradeType: "CONCRETE", csiCode: "32 13", categoryName: "Flatwork", name: "Parking Lot", code: "CONC-PARK-001", defaultUomCode: "SF", sortOrder: 10 },
  { tradeType: "CONCRETE", csiCode: "32 13", categoryName: "Flatwork", name: "Driveway", code: "CONC-DRV-001", defaultUomCode: "SF", sortOrder: 11 },
  { tradeType: "CONCRETE", csiCode: "32 13", categoryName: "Flatwork", name: "Apron", code: "CONC-APR-001", defaultUomCode: "SF", sortOrder: 12 },
  { tradeType: "CONCRETE", csiCode: "32 13", categoryName: "Flatwork", name: "Sidewalk", code: "CONC-SIDE-001", defaultUomCode: "SF", sortOrder: 13 },
  { tradeType: "CONCRETE", csiCode: "32 13", categoryName: "Flatwork", name: "Patio", code: "CONC-PAT-001", defaultUomCode: "SF", sortOrder: 14 },
  
  // Foundations - Footings
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Strip Footing", code: "CONC-FTG-001", defaultUomCode: "LF", sortOrder: 20 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Spread Footing", code: "CONC-FTG-002", defaultUomCode: "CY", sortOrder: 21 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Mat/Raft Foundation", code: "CONC-FTG-003", defaultUomCode: "SF", sortOrder: 22 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Pier Footing", code: "CONC-FTG-004", defaultUomCode: "EA", sortOrder: 23 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Grade Beam", code: "CONC-GB-001", defaultUomCode: "LF", sortOrder: 24 },
  
  // Foundations - Foundation Walls
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Foundation Wall - Cast", code: "CONC-FDW-001", defaultUomCode: "SF", sortOrder: 30 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Foundation Wall - Block", code: "CONC-FDW-002", defaultUomCode: "SF", sortOrder: 31 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Stem Wall", code: "CONC-STM-001", defaultUomCode: "LF", sortOrder: 32 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Frost Wall", code: "CONC-FRO-001", defaultUomCode: "LF", sortOrder: 33 },
  
  // Walls
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Walls", name: "Retaining Wall - Cast", code: "CONC-RET-001", defaultUomCode: "SF", sortOrder: 40 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Walls", name: "Retaining Wall - Block", code: "CONC-RET-002", defaultUomCode: "SF", sortOrder: 41 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Walls", name: "Tilt-Up Wall Panel", code: "CONC-TU-001", defaultUomCode: "SF", sortOrder: 42 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Walls", name: "Core Wall", code: "CONC-CORE-001", defaultUomCode: "SF", sortOrder: 43 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Walls", name: "Shear Wall", code: "CONC-SHR-001", defaultUomCode: "SF", sortOrder: 44 },
  
  // Structural Elements
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Structural", name: "Concrete Column - Round", code: "CONC-COL-001", defaultUomCode: "LF", sortOrder: 50 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Structural", name: "Concrete Column - Square", code: "CONC-COL-002", defaultUomCode: "LF", sortOrder: 51 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Structural", name: "Concrete Beam", code: "CONC-BM-001", defaultUomCode: "LF", sortOrder: 52 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Structural", name: "Elevated Deck/Slab", code: "CONC-DK-001", defaultUomCode: "SF", sortOrder: 53 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Structural", name: "Stairs", code: "CONC-STR-001", defaultUomCode: "LF", sortOrder: 54 },
  
  // Curbs & Gutters
  { tradeType: "CONCRETE", csiCode: "32 16", categoryName: "Curbs & Gutters", name: "Standard Curb & Gutter", code: "CONC-CG-001", defaultUomCode: "LF", sortOrder: 60 },
  { tradeType: "CONCRETE", csiCode: "32 16", categoryName: "Curbs & Gutters", name: "Mountable Curb", code: "CONC-CG-002", defaultUomCode: "LF", sortOrder: 61 },
  { tradeType: "CONCRETE", csiCode: "32 16", categoryName: "Curbs & Gutters", name: "Barrier Curb", code: "CONC-CG-003", defaultUomCode: "LF", sortOrder: 62 },
  { tradeType: "CONCRETE", csiCode: "32 16", categoryName: "Curbs & Gutters", name: "Gutter Only", code: "CONC-CG-004", defaultUomCode: "LF", sortOrder: 63 },
  { tradeType: "CONCRETE", csiCode: "32 16", categoryName: "Curbs & Gutters", name: "Valley Gutter", code: "CONC-CG-005", defaultUomCode: "LF", sortOrder: 64 },
  
  // Site Accessories
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Site Accessories", name: "ADA Ramp", code: "CONC-ADA-001", defaultUomCode: "EA", sortOrder: 70 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Site Accessories", name: "Equipment Pad", code: "CONC-PAD-001", defaultUomCode: "SF", sortOrder: 71 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Site Accessories", name: "Trash Enclosure Pad", code: "CONC-PAD-002", defaultUomCode: "SF", sortOrder: 72 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Site Accessories", name: "Bollard Foundation", code: "CONC-BOL-001", defaultUomCode: "EA", sortOrder: 73 },
  { tradeType: "CONCRETE", csiCode: "03 30", categoryName: "Site Accessories", name: "Light Pole Base", code: "CONC-LPB-001", defaultUomCode: "EA", sortOrder: 74 },
  
  // Concrete Finishing
  { tradeType: "CONCRETE", csiCode: "03 35", categoryName: "Finishing", name: "Broom Finish", code: "CONC-FIN-001", defaultUomCode: "SF", sortOrder: 80 },
  { tradeType: "CONCRETE", csiCode: "03 35", categoryName: "Finishing", name: "Exposed Aggregate", code: "CONC-FIN-002", defaultUomCode: "SF", sortOrder: 81 },
  { tradeType: "CONCRETE", csiCode: "03 35", categoryName: "Finishing", name: "Stamped/Decorative", code: "CONC-FIN-003", defaultUomCode: "SF", sortOrder: 82 },
  { tradeType: "CONCRETE", csiCode: "03 35", categoryName: "Finishing", name: "Polish/Burnish", code: "CONC-FIN-004", defaultUomCode: "SF", sortOrder: 83 },
  { tradeType: "CONCRETE", csiCode: "03 35", categoryName: "Finishing", name: "Stain/Color", code: "CONC-FIN-005", defaultUomCode: "SF", sortOrder: 84 },
  
  // Concrete Repair
  { tradeType: "CONCRETE", csiCode: "03 01", categoryName: "Repair", name: "Crack Repair", code: "CONC-REP-001", defaultUomCode: "LF", sortOrder: 90 },
  { tradeType: "CONCRETE", csiCode: "03 01", categoryName: "Repair", name: "Spall Repair", code: "CONC-REP-002", defaultUomCode: "SF", sortOrder: 91 },
  { tradeType: "CONCRETE", csiCode: "03 01", categoryName: "Repair", name: "Slab Replacement", code: "CONC-REP-003", defaultUomCode: "SF", sortOrder: 92 },
  { tradeType: "CONCRETE", csiCode: "03 01", categoryName: "Repair", name: "Overlay/Resurfacing", code: "CONC-REP-004", defaultUomCode: "SF", sortOrder: 93 },
  { tradeType: "CONCRETE", csiCode: "02 41", categoryName: "Repair", name: "Sawcutting", code: "CONC-SAW-001", defaultUomCode: "LF", sortOrder: 94 },
  
  // Joints & Sealing
  { tradeType: "CONCRETE", csiCode: "03 15", categoryName: "Joints & Sealing", name: "Control Joint Sawcut", code: "CONC-JNT-001", defaultUomCode: "LF", sortOrder: 100 },
  { tradeType: "CONCRETE", csiCode: "03 15", categoryName: "Joints & Sealing", name: "Expansion Joint", code: "CONC-JNT-002", defaultUomCode: "LF", sortOrder: 101 },
  { tradeType: "CONCRETE", csiCode: "03 15", categoryName: "Joints & Sealing", name: "Joint Sealant", code: "CONC-JNT-003", defaultUomCode: "LF", sortOrder: 102 },
  { tradeType: "CONCRETE", csiCode: "03 05", categoryName: "Joints & Sealing", name: "Cure & Seal", code: "CONC-SEAL-001", defaultUomCode: "SF", sortOrder: 103 },
  { tradeType: "CONCRETE", csiCode: "03 05", categoryName: "Joints & Sealing", name: "Penetrating Sealer", code: "CONC-SEAL-002", defaultUomCode: "SF", sortOrder: 104 },
] as const;

async function seedConcreteSowItems() {
  logInfo("🏗️ Seeding CONCRETE Trade Master SOW Items...");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const item of concreteSowItems) {
    const existing = await db.select()
      .from(masterSowItems)
      .where(and(
        eq(masterSowItems.tradeType, item.tradeType as any),
        eq(masterSowItems.code, item.code)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    
    await db.insert(masterSowItems).values({
      tradeType: item.tradeType as any,
      csiCode: item.csiCode,
      categoryName: item.categoryName,
      name: item.name,
      code: item.code,
      defaultUomCode: item.defaultUomCode,
      sortOrder: item.sortOrder,
      isActive: true,
    });
    inserted++;
  }
  
  logInfo(`✅ CONCRETE SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

// === STRUCTURAL / BUILDING SOW ITEMS (13 trades x 5 items = 65 items) ===
const structuralBuildingSowItems = [
  // CAST_IN_PLACE_CONCRETE
  { tradeType: "CAST_IN_PLACE_CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Spread Footings", code: "CIP-FTG-001", defaultUomCode: "CY", sortOrder: 1 },
  { tradeType: "CAST_IN_PLACE_CONCRETE", csiCode: "03 30", categoryName: "Foundations", name: "Grade Beams", code: "CIP-GB-001", defaultUomCode: "CY", sortOrder: 2 },
  { tradeType: "CAST_IN_PLACE_CONCRETE", csiCode: "03 30", categoryName: "Elevated Slabs", name: "Suspended Slab", code: "CIP-SLAB-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "CAST_IN_PLACE_CONCRETE", csiCode: "03 30", categoryName: "Walls", name: "Cast-in-Place Walls", code: "CIP-WALL-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "CAST_IN_PLACE_CONCRETE", csiCode: "03 30", categoryName: "Columns", name: "Concrete Columns", code: "CIP-COL-001", defaultUomCode: "CY", sortOrder: 5 },

  // PRECAST_CONCRETE
  { tradeType: "PRECAST_CONCRETE", csiCode: "03 40", categoryName: "Structural Precast", name: "Precast Beams", code: "PC-BEAM-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "PRECAST_CONCRETE", csiCode: "03 40", categoryName: "Structural Precast", name: "Precast Columns", code: "PC-COL-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "PRECAST_CONCRETE", csiCode: "03 40", categoryName: "Structural Precast", name: "Double Tees", code: "PC-DT-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "PRECAST_CONCRETE", csiCode: "03 40", categoryName: "Architectural Precast", name: "Precast Panels", code: "PC-PANEL-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "PRECAST_CONCRETE", csiCode: "03 40", categoryName: "Installation", name: "Precast Erection", code: "PC-ERECT-001", defaultUomCode: "EA", sortOrder: 5 },

  // REBAR_AND_POST_TENSION
  { tradeType: "REBAR_AND_POST_TENSION", csiCode: "03 20", categoryName: "Reinforcement", name: "Rebar Fabrication & Install", code: "RB-FAB-001", defaultUomCode: "TON", sortOrder: 1 },
  { tradeType: "REBAR_AND_POST_TENSION", csiCode: "03 20", categoryName: "Reinforcement", name: "Epoxy Coated Rebar", code: "RB-EPOXY-001", defaultUomCode: "TON", sortOrder: 2 },
  { tradeType: "REBAR_AND_POST_TENSION", csiCode: "03 20", categoryName: "Post-Tension", name: "PT Strand Installation", code: "RB-PT-001", defaultUomCode: "LB", sortOrder: 3 },
  { tradeType: "REBAR_AND_POST_TENSION", csiCode: "03 20", categoryName: "Post-Tension", name: "PT Stressing", code: "RB-STRESS-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "REBAR_AND_POST_TENSION", csiCode: "03 20", categoryName: "Accessories", name: "Rebar Accessories", code: "RB-ACC-001", defaultUomCode: "LS", sortOrder: 5 },

  // STRUCTURAL_STEEL
  { tradeType: "STRUCTURAL_STEEL", csiCode: "05 12", categoryName: "Framing", name: "Structural Steel Fabrication", code: "SS-FAB-001", defaultUomCode: "TON", sortOrder: 1 },
  { tradeType: "STRUCTURAL_STEEL", csiCode: "05 12", categoryName: "Framing", name: "Steel Erection", code: "SS-ERECT-001", defaultUomCode: "TON", sortOrder: 2 },
  { tradeType: "STRUCTURAL_STEEL", csiCode: "05 12", categoryName: "Connections", name: "High Strength Bolts", code: "SS-BOLT-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "STRUCTURAL_STEEL", csiCode: "05 12", categoryName: "Decking", name: "Metal Deck", code: "SS-DECK-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "STRUCTURAL_STEEL", csiCode: "05 12", categoryName: "Misc Steel", name: "Miscellaneous Metals", code: "SS-MISC-001", defaultUomCode: "LB", sortOrder: 5 },

  // METAL_BUILDINGS
  { tradeType: "METAL_BUILDINGS", csiCode: "13 34", categoryName: "Pre-Engineered", name: "Metal Building Package", code: "MB-PKG-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "METAL_BUILDINGS", csiCode: "13 34", categoryName: "Pre-Engineered", name: "Metal Building Erection", code: "MB-ERECT-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "METAL_BUILDINGS", csiCode: "13 34", categoryName: "Accessories", name: "Wall Panels", code: "MB-WALL-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "METAL_BUILDINGS", csiCode: "13 34", categoryName: "Accessories", name: "Roof Panels", code: "MB-ROOF-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "METAL_BUILDINGS", csiCode: "13 34", categoryName: "Accessories", name: "Doors & Accessories", code: "MB-DOOR-001", defaultUomCode: "EA", sortOrder: 5 },

  // CARPENTRY_FRAMING
  { tradeType: "CARPENTRY_FRAMING", csiCode: "06 10", categoryName: "Wood Framing", name: "Wall Framing", code: "CF-WALL-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "CARPENTRY_FRAMING", csiCode: "06 10", categoryName: "Wood Framing", name: "Floor Framing", code: "CF-FLOOR-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "CARPENTRY_FRAMING", csiCode: "06 10", categoryName: "Wood Framing", name: "Roof Framing", code: "CF-ROOF-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "CARPENTRY_FRAMING", csiCode: "06 10", categoryName: "Sheathing", name: "Wall Sheathing", code: "CF-SHEATH-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "CARPENTRY_FRAMING", csiCode: "06 10", categoryName: "Blocking", name: "Blocking & Backing", code: "CF-BLOCK-001", defaultUomCode: "LF", sortOrder: 5 },

  // DRYWALL_SYSTEMS
  { tradeType: "DRYWALL_SYSTEMS", csiCode: "09 29", categoryName: "Gypsum Board", name: "Drywall Installation", code: "DW-INST-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "DRYWALL_SYSTEMS", csiCode: "09 29", categoryName: "Gypsum Board", name: "Type X Fire-Rated", code: "DW-FIRE-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "DRYWALL_SYSTEMS", csiCode: "09 29", categoryName: "Finishing", name: "Taping & Finishing", code: "DW-TAPE-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "DRYWALL_SYSTEMS", csiCode: "09 29", categoryName: "Framing", name: "Metal Stud Framing", code: "DW-STUD-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "DRYWALL_SYSTEMS", csiCode: "09 29", categoryName: "Specialty", name: "Moisture Resistant Board", code: "DW-MR-001", defaultUomCode: "SF", sortOrder: 5 },

  // ACOUSTICAL_CEILINGS
  { tradeType: "ACOUSTICAL_CEILINGS", csiCode: "09 51", categoryName: "Suspended Ceilings", name: "Acoustical Tile Grid", code: "AC-GRID-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "ACOUSTICAL_CEILINGS", csiCode: "09 51", categoryName: "Suspended Ceilings", name: "Acoustical Tiles", code: "AC-TILE-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "ACOUSTICAL_CEILINGS", csiCode: "09 51", categoryName: "Specialty", name: "Linear Metal Ceiling", code: "AC-LINEAR-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "ACOUSTICAL_CEILINGS", csiCode: "09 51", categoryName: "Specialty", name: "Wood Ceiling Panels", code: "AC-WOOD-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "ACOUSTICAL_CEILINGS", csiCode: "09 51", categoryName: "Accessories", name: "Access Panels", code: "AC-ACCESS-001", defaultUomCode: "EA", sortOrder: 5 },

  // PAINTING_AND_COATINGS
  { tradeType: "PAINTING_AND_COATINGS", csiCode: "09 90", categoryName: "Interior Paint", name: "Interior Wall Paint", code: "PC-INTW-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "PAINTING_AND_COATINGS", csiCode: "09 90", categoryName: "Interior Paint", name: "Interior Ceiling Paint", code: "PC-INTC-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "PAINTING_AND_COATINGS", csiCode: "09 90", categoryName: "Exterior Paint", name: "Exterior Paint", code: "PC-EXT-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "PAINTING_AND_COATINGS", csiCode: "09 90", categoryName: "Industrial Coatings", name: "Epoxy Floor Coating", code: "PC-EPOXY-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "PAINTING_AND_COATINGS", csiCode: "09 90", categoryName: "Industrial Coatings", name: "Steel Fireproofing", code: "PC-FIRE-001", defaultUomCode: "SF", sortOrder: 5 },

  // FLOORING_SYSTEMS
  { tradeType: "FLOORING_SYSTEMS", csiCode: "09 60", categoryName: "Resilient Flooring", name: "VCT Tile", code: "FS-VCT-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "FLOORING_SYSTEMS", csiCode: "09 60", categoryName: "Resilient Flooring", name: "LVT/LVP Flooring", code: "FS-LVT-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "FLOORING_SYSTEMS", csiCode: "09 60", categoryName: "Tile", name: "Ceramic/Porcelain Tile", code: "FS-TILE-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "FLOORING_SYSTEMS", csiCode: "09 60", categoryName: "Carpet", name: "Carpet Tile", code: "FS-CARPET-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "FLOORING_SYSTEMS", csiCode: "09 60", categoryName: "Wood", name: "Hardwood Flooring", code: "FS-WOOD-001", defaultUomCode: "SF", sortOrder: 5 },

  // ROOFING_SYSTEMS
  { tradeType: "ROOFING_SYSTEMS", csiCode: "07 50", categoryName: "Low-Slope", name: "TPO Roofing", code: "RS-TPO-001", defaultUomCode: "SQ", sortOrder: 1 },
  { tradeType: "ROOFING_SYSTEMS", csiCode: "07 50", categoryName: "Low-Slope", name: "EPDM Roofing", code: "RS-EPDM-001", defaultUomCode: "SQ", sortOrder: 2 },
  { tradeType: "ROOFING_SYSTEMS", csiCode: "07 50", categoryName: "Steep-Slope", name: "Standing Seam Metal", code: "RS-METAL-001", defaultUomCode: "SQ", sortOrder: 3 },
  { tradeType: "ROOFING_SYSTEMS", csiCode: "07 50", categoryName: "Insulation", name: "Roof Insulation", code: "RS-INS-001", defaultUomCode: "SF", sortOrder: 4 },
  { tradeType: "ROOFING_SYSTEMS", csiCode: "07 50", categoryName: "Accessories", name: "Flashings & Copings", code: "RS-FLASH-001", defaultUomCode: "LF", sortOrder: 5 },

  // MASONRY_SYSTEMS
  { tradeType: "MASONRY_SYSTEMS", csiCode: "04 20", categoryName: "Unit Masonry", name: "CMU Block Wall", code: "MS-CMU-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "MASONRY_SYSTEMS", csiCode: "04 20", categoryName: "Unit Masonry", name: "Brick Veneer", code: "MS-BRICK-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "MASONRY_SYSTEMS", csiCode: "04 20", categoryName: "Stone", name: "Natural Stone Veneer", code: "MS-STONE-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "MASONRY_SYSTEMS", csiCode: "04 20", categoryName: "Reinforcement", name: "Masonry Reinforcement", code: "MS-REINF-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "MASONRY_SYSTEMS", csiCode: "04 20", categoryName: "Accessories", name: "Grout & Mortar", code: "MS-GROUT-001", defaultUomCode: "CY", sortOrder: 5 },

  // GLAZING_SYSTEMS
  { tradeType: "GLAZING_SYSTEMS", csiCode: "08 80", categoryName: "Curtain Wall", name: "Aluminum Curtain Wall", code: "GS-CW-001", defaultUomCode: "SF", sortOrder: 1 },
  { tradeType: "GLAZING_SYSTEMS", csiCode: "08 80", categoryName: "Storefronts", name: "Aluminum Storefront", code: "GS-SF-001", defaultUomCode: "SF", sortOrder: 2 },
  { tradeType: "GLAZING_SYSTEMS", csiCode: "08 80", categoryName: "Windows", name: "Aluminum Windows", code: "GS-WIN-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "GLAZING_SYSTEMS", csiCode: "08 80", categoryName: "Entrances", name: "Entrance Doors", code: "GS-DOOR-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "GLAZING_SYSTEMS", csiCode: "08 80", categoryName: "Specialty", name: "Skylights", code: "GS-SKY-001", defaultUomCode: "SF", sortOrder: 5 },
] as const;

async function seedStructuralBuildingSowItems() {
  logInfo("🏗️ Seeding Structural/Building Master SOW Items...");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const item of structuralBuildingSowItems) {
    const existing = await db.select()
      .from(masterSowItems)
      .where(and(
        eq(masterSowItems.tradeType, item.tradeType as any),
        eq(masterSowItems.code, item.code)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    
    await db.insert(masterSowItems).values({
      tradeType: item.tradeType as any,
      csiCode: item.csiCode,
      categoryName: item.categoryName,
      name: item.name,
      code: item.code,
      defaultUomCode: item.defaultUomCode,
      sortOrder: item.sortOrder,
      isActive: true,
    });
    inserted++;
  }
  
  logInfo(`✅ Structural/Building SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

// === MEP / SPECIALTY SOW ITEMS (11 trades x 5 items = 55 items) ===
const mepSpecialtySowItems = [
  // ELECTRICAL_UNDERGROUND
  { tradeType: "ELECTRICAL_UNDERGROUND", csiCode: "26 05", categoryName: "Underground Electric", name: "Primary Conduit", code: "EU-PRIM-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "ELECTRICAL_UNDERGROUND", csiCode: "26 05", categoryName: "Underground Electric", name: "Secondary Conduit", code: "EU-SEC-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "ELECTRICAL_UNDERGROUND", csiCode: "26 05", categoryName: "Underground Electric", name: "Transformer Pad", code: "EU-XFMR-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "ELECTRICAL_UNDERGROUND", csiCode: "26 05", categoryName: "Underground Electric", name: "Pull Box/Handhole", code: "EU-PULL-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "ELECTRICAL_UNDERGROUND", csiCode: "26 05", categoryName: "Underground Electric", name: "Duct Bank", code: "EU-DUCT-001", defaultUomCode: "LF", sortOrder: 5 },

  // ELECTRICAL_OVERHEAD
  { tradeType: "ELECTRICAL_OVERHEAD", csiCode: "26 05", categoryName: "Overhead Power", name: "Wood Pole Installation", code: "EO-POLE-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "ELECTRICAL_OVERHEAD", csiCode: "26 05", categoryName: "Overhead Power", name: "Steel Pole Installation", code: "EO-STEEL-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "ELECTRICAL_OVERHEAD", csiCode: "26 05", categoryName: "Overhead Power", name: "Overhead Primary Wire", code: "EO-PRIM-001", defaultUomCode: "LF", sortOrder: 3 },
  { tradeType: "ELECTRICAL_OVERHEAD", csiCode: "26 05", categoryName: "Overhead Power", name: "Guy Wire & Anchors", code: "EO-GUY-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "ELECTRICAL_OVERHEAD", csiCode: "26 05", categoryName: "Overhead Power", name: "Transformer (Pole Mount)", code: "EO-XFMR-001", defaultUomCode: "EA", sortOrder: 5 },

  // MECHANICAL_PIPING
  { tradeType: "MECHANICAL_PIPING", csiCode: "23 20", categoryName: "Process Piping", name: "Steel Pipe Installation", code: "MP-STEEL-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "MECHANICAL_PIPING", csiCode: "23 20", categoryName: "Process Piping", name: "Copper Pipe Installation", code: "MP-CU-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "MECHANICAL_PIPING", csiCode: "23 20", categoryName: "Process Piping", name: "Pipe Insulation", code: "MP-INS-001", defaultUomCode: "LF", sortOrder: 3 },
  { tradeType: "MECHANICAL_PIPING", csiCode: "23 20", categoryName: "Process Piping", name: "Valves & Fittings", code: "MP-VALVE-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "MECHANICAL_PIPING", csiCode: "23 20", categoryName: "Process Piping", name: "Pipe Hangers & Supports", code: "MP-HANG-001", defaultUomCode: "EA", sortOrder: 5 },

  // HVAC_SYSTEMS
  { tradeType: "HVAC_SYSTEMS", csiCode: "23", categoryName: "Air Handling", name: "AHU Installation", code: "HV-AHU-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "HVAC_SYSTEMS", csiCode: "23", categoryName: "Air Handling", name: "Ductwork Installation", code: "HV-DUCT-001", defaultUomCode: "LB", sortOrder: 2 },
  { tradeType: "HVAC_SYSTEMS", csiCode: "23", categoryName: "Controls", name: "DDC Controls", code: "HV-DDC-001", defaultUomCode: "PT", sortOrder: 3 },
  { tradeType: "HVAC_SYSTEMS", csiCode: "23", categoryName: "Equipment", name: "RTU Installation", code: "HV-RTU-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "HVAC_SYSTEMS", csiCode: "23", categoryName: "Terminal Units", name: "VAV Box Installation", code: "HV-VAV-001", defaultUomCode: "EA", sortOrder: 5 },

  // PLUMBING_SYSTEMS
  { tradeType: "PLUMBING_SYSTEMS", csiCode: "22", categoryName: "Piping", name: "DWV Pipe", code: "PL-DWV-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "PLUMBING_SYSTEMS", csiCode: "22", categoryName: "Piping", name: "Domestic Water Pipe", code: "PL-DW-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "PLUMBING_SYSTEMS", csiCode: "22", categoryName: "Fixtures", name: "Plumbing Fixtures", code: "PL-FIX-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "PLUMBING_SYSTEMS", csiCode: "22", categoryName: "Equipment", name: "Water Heater", code: "PL-WH-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "PLUMBING_SYSTEMS", csiCode: "22", categoryName: "Equipment", name: "Pump Installation", code: "PL-PUMP-001", defaultUomCode: "EA", sortOrder: 5 },

  // FIRE_PROTECTION_SYSTEMS
  { tradeType: "FIRE_PROTECTION_SYSTEMS", csiCode: "21", categoryName: "Sprinkler", name: "Sprinkler Pipe", code: "FP-PIPE-001", defaultUomCode: "LF", sortOrder: 1 },
  { tradeType: "FIRE_PROTECTION_SYSTEMS", csiCode: "21", categoryName: "Sprinkler", name: "Sprinkler Heads", code: "FP-HEAD-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "FIRE_PROTECTION_SYSTEMS", csiCode: "21", categoryName: "Equipment", name: "Fire Pump", code: "FP-PUMP-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "FIRE_PROTECTION_SYSTEMS", csiCode: "21", categoryName: "Equipment", name: "Standpipe System", code: "FP-STAND-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "FIRE_PROTECTION_SYSTEMS", csiCode: "21", categoryName: "Suppression", name: "Clean Agent System", code: "FP-CLEAN-001", defaultUomCode: "EA", sortOrder: 5 },

  // LOW_VOLTAGE_SYSTEMS
  { tradeType: "LOW_VOLTAGE_SYSTEMS", csiCode: "27", categoryName: "Voice/Data", name: "Cat6 Cabling", code: "LV-CAT6-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "LOW_VOLTAGE_SYSTEMS", csiCode: "27", categoryName: "Voice/Data", name: "Fiber Optic Cable", code: "LV-FIBER-001", defaultUomCode: "LF", sortOrder: 2 },
  { tradeType: "LOW_VOLTAGE_SYSTEMS", csiCode: "27", categoryName: "Infrastructure", name: "Cable Tray", code: "LV-TRAY-001", defaultUomCode: "LF", sortOrder: 3 },
  { tradeType: "LOW_VOLTAGE_SYSTEMS", csiCode: "27", categoryName: "Infrastructure", name: "Telecom Rooms", code: "LV-TR-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "LOW_VOLTAGE_SYSTEMS", csiCode: "27", categoryName: "Voice/Data", name: "Patch Panels", code: "LV-PATCH-001", defaultUomCode: "EA", sortOrder: 5 },

  // SECURITY_AND_ACCESS
  { tradeType: "SECURITY_AND_ACCESS", csiCode: "28", categoryName: "Access Control", name: "Card Readers", code: "SA-CARD-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "SECURITY_AND_ACCESS", csiCode: "28", categoryName: "Access Control", name: "Electric Strikes", code: "SA-STRIKE-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "SECURITY_AND_ACCESS", csiCode: "28", categoryName: "Surveillance", name: "IP Cameras", code: "SA-CAM-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "SECURITY_AND_ACCESS", csiCode: "28", categoryName: "Intrusion", name: "Motion Sensors", code: "SA-MOTION-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "SECURITY_AND_ACCESS", csiCode: "28", categoryName: "Head End", name: "Security Panel", code: "SA-PANEL-001", defaultUomCode: "EA", sortOrder: 5 },

  // COMMUNICATIONS_IT
  { tradeType: "COMMUNICATIONS_IT", csiCode: "27", categoryName: "Infrastructure", name: "Server Rack Installation", code: "CI-RACK-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "COMMUNICATIONS_IT", csiCode: "27", categoryName: "Infrastructure", name: "UPS Installation", code: "CI-UPS-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "COMMUNICATIONS_IT", csiCode: "27", categoryName: "AV Systems", name: "Display Installation", code: "CI-DISP-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "COMMUNICATIONS_IT", csiCode: "27", categoryName: "AV Systems", name: "Audio System", code: "CI-AUDIO-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "COMMUNICATIONS_IT", csiCode: "27", categoryName: "Network", name: "Network Switch", code: "CI-SWITCH-001", defaultUomCode: "EA", sortOrder: 5 },

  // SOLAR_INSTALLATION
  { tradeType: "SOLAR_INSTALLATION", csiCode: "48", categoryName: "Photovoltaic", name: "Solar Panel Installation", code: "SI-PANEL-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "SOLAR_INSTALLATION", csiCode: "48", categoryName: "Photovoltaic", name: "Inverter Installation", code: "SI-INV-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "SOLAR_INSTALLATION", csiCode: "48", categoryName: "Mounting", name: "Roof Mounting System", code: "SI-MOUNT-001", defaultUomCode: "SF", sortOrder: 3 },
  { tradeType: "SOLAR_INSTALLATION", csiCode: "48", categoryName: "Electrical", name: "DC Wiring", code: "SI-DC-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "SOLAR_INSTALLATION", csiCode: "48", categoryName: "Electrical", name: "AC Interconnect", code: "SI-AC-001", defaultUomCode: "LS", sortOrder: 5 },

  // TEMPORARY_POWER
  { tradeType: "TEMPORARY_POWER", csiCode: "26 05", categoryName: "Temporary Electric", name: "Temp Power Panel", code: "TP-PANEL-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "TEMPORARY_POWER", csiCode: "26 05", categoryName: "Temporary Electric", name: "Temp Power Distribution", code: "TP-DIST-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "TEMPORARY_POWER", csiCode: "26 05", categoryName: "Temporary Electric", name: "Generator Rental", code: "TP-GEN-001", defaultUomCode: "MO", sortOrder: 3 },
  { tradeType: "TEMPORARY_POWER", csiCode: "26 05", categoryName: "Temporary Electric", name: "Temporary Lighting", code: "TP-LIGHT-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "TEMPORARY_POWER", csiCode: "26 05", categoryName: "Temporary Electric", name: "Spider Boxes", code: "TP-SPIDER-001", defaultUomCode: "EA", sortOrder: 5 },
] as const;

// === SUPPORT / SERVICES SOW ITEMS (5 trades x 5 items = 25 items) ===
const supportServicesSowItems = [
  // SURVEY_AND_LAYOUT
  { tradeType: "SURVEY_AND_LAYOUT", csiCode: "01 71", categoryName: "Survey", name: "Boundary Survey", code: "SL-BOUND-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "SURVEY_AND_LAYOUT", csiCode: "01 71", categoryName: "Survey", name: "Topographic Survey", code: "SL-TOPO-001", defaultUomCode: "AC", sortOrder: 2 },
  { tradeType: "SURVEY_AND_LAYOUT", csiCode: "01 71", categoryName: "Layout", name: "Construction Staking", code: "SL-STAKE-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "SURVEY_AND_LAYOUT", csiCode: "01 71", categoryName: "Layout", name: "Control Points", code: "SL-CTRL-001", defaultUomCode: "EA", sortOrder: 4 },
  { tradeType: "SURVEY_AND_LAYOUT", csiCode: "01 71", categoryName: "As-Built", name: "As-Built Survey", code: "SL-ASBUILT-001", defaultUomCode: "EA", sortOrder: 5 },

  // TESTING_AND_INSPECTIONS
  { tradeType: "TESTING_AND_INSPECTIONS", csiCode: "01 45", categoryName: "QC Testing", name: "Concrete Testing", code: "TI-CONC-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "TESTING_AND_INSPECTIONS", csiCode: "01 45", categoryName: "QC Testing", name: "Soil Compaction Testing", code: "TI-SOIL-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "TESTING_AND_INSPECTIONS", csiCode: "01 45", categoryName: "QC Testing", name: "Weld Inspection", code: "TI-WELD-001", defaultUomCode: "EA", sortOrder: 3 },
  { tradeType: "TESTING_AND_INSPECTIONS", csiCode: "01 45", categoryName: "Third Party", name: "Third Party Inspections", code: "TI-3RD-001", defaultUomCode: "HR", sortOrder: 4 },
  { tradeType: "TESTING_AND_INSPECTIONS", csiCode: "01 45", categoryName: "Documentation", name: "Test Reports", code: "TI-RPT-001", defaultUomCode: "EA", sortOrder: 5 },

  // COMMISSIONING
  { tradeType: "COMMISSIONING", csiCode: "01 91", categoryName: "Cx Services", name: "Pre-Functional Testing", code: "CX-PRE-001", defaultUomCode: "EA", sortOrder: 1 },
  { tradeType: "COMMISSIONING", csiCode: "01 91", categoryName: "Cx Services", name: "Functional Performance Testing", code: "CX-FPT-001", defaultUomCode: "EA", sortOrder: 2 },
  { tradeType: "COMMISSIONING", csiCode: "01 91", categoryName: "Cx Services", name: "TAB (Test & Balance)", code: "CX-TAB-001", defaultUomCode: "CFM", sortOrder: 3 },
  { tradeType: "COMMISSIONING", csiCode: "01 91", categoryName: "Cx Services", name: "Commissioning Agent", code: "CX-AGENT-001", defaultUomCode: "HR", sortOrder: 4 },
  { tradeType: "COMMISSIONING", csiCode: "01 91", categoryName: "Documentation", name: "Cx Documentation", code: "CX-DOC-001", defaultUomCode: "LS", sortOrder: 5 },

  // TEMPORARY_FACILITIES
  { tradeType: "TEMPORARY_FACILITIES", csiCode: "01 50", categoryName: "Site Office", name: "Job Trailer", code: "TF-TRAIL-001", defaultUomCode: "MO", sortOrder: 1 },
  { tradeType: "TEMPORARY_FACILITIES", csiCode: "01 50", categoryName: "Site Office", name: "Temporary Restrooms", code: "TF-REST-001", defaultUomCode: "MO", sortOrder: 2 },
  { tradeType: "TEMPORARY_FACILITIES", csiCode: "01 50", categoryName: "Storage", name: "Storage Containers", code: "TF-STOR-001", defaultUomCode: "MO", sortOrder: 3 },
  { tradeType: "TEMPORARY_FACILITIES", csiCode: "01 50", categoryName: "Barriers", name: "Temporary Fencing", code: "TF-FENCE-001", defaultUomCode: "LF", sortOrder: 4 },
  { tradeType: "TEMPORARY_FACILITIES", csiCode: "01 50", categoryName: "Protection", name: "Temporary Protection", code: "TF-PROT-001", defaultUomCode: "SF", sortOrder: 5 },

  // GENERAL_CONDITIONS
  { tradeType: "GENERAL_CONDITIONS", csiCode: "01", categoryName: "Supervision", name: "Project Superintendent", code: "GC-SUPER-001", defaultUomCode: "MO", sortOrder: 1 },
  { tradeType: "GENERAL_CONDITIONS", csiCode: "01", categoryName: "Supervision", name: "Project Manager", code: "GC-PM-001", defaultUomCode: "MO", sortOrder: 2 },
  { tradeType: "GENERAL_CONDITIONS", csiCode: "01", categoryName: "Equipment", name: "Small Tools & Equipment", code: "GC-TOOLS-001", defaultUomCode: "MO", sortOrder: 3 },
  { tradeType: "GENERAL_CONDITIONS", csiCode: "01", categoryName: "Insurance", name: "Builders Risk Insurance", code: "GC-INS-001", defaultUomCode: "LS", sortOrder: 4 },
  { tradeType: "GENERAL_CONDITIONS", csiCode: "01", categoryName: "Cleanup", name: "Final Cleanup", code: "GC-CLEAN-001", defaultUomCode: "SF", sortOrder: 5 },
] as const;

async function seedMepSpecialtySowItems() {
  logInfo("⚡ Seeding MEP/Specialty Master SOW Items...");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const item of mepSpecialtySowItems) {
    const existing = await db.select()
      .from(masterSowItems)
      .where(and(
        eq(masterSowItems.tradeType, item.tradeType as any),
        eq(masterSowItems.code, item.code)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    
    await db.insert(masterSowItems).values({
      tradeType: item.tradeType as any,
      csiCode: item.csiCode,
      categoryName: item.categoryName,
      name: item.name,
      code: item.code,
      defaultUomCode: item.defaultUomCode,
      sortOrder: item.sortOrder,
      isActive: true,
    });
    inserted++;
  }
  
  logInfo(`✅ MEP/Specialty SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

async function seedSupportServicesSowItems() {
  logInfo("🔧 Seeding Support/Services Master SOW Items...");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const item of supportServicesSowItems) {
    const existing = await db.select()
      .from(masterSowItems)
      .where(and(
        eq(masterSowItems.tradeType, item.tradeType as any),
        eq(masterSowItems.code, item.code)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    
    await db.insert(masterSowItems).values({
      tradeType: item.tradeType as any,
      csiCode: item.csiCode,
      categoryName: item.categoryName,
      name: item.name,
      code: item.code,
      defaultUomCode: item.defaultUomCode,
      sortOrder: item.sortOrder,
      isActive: true,
    });
    inserted++;
  }
  
  logInfo(`✅ Support/Services SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

// Combined seed function for all new trades
async function seedAllNewTradeSowItems() {
  logInfo("🚀 Seeding ALL new trade SOW items...\n");
  
  const concrete = await seedConcreteSowItems();
  const civil = await seedCivilSiteSowItems();
  const structural = await seedStructuralBuildingSowItems();
  const mep = await seedMepSpecialtySowItems();
  const support = await seedSupportServicesSowItems();
  
  const total = {
    inserted: concrete.inserted + civil.inserted + structural.inserted + mep.inserted + support.inserted,
    skipped: concrete.skipped + civil.skipped + structural.skipped + mep.skipped + support.skipped,
  };
  
  logInfo(`\n📊 TOTAL: ${total.inserted} inserted, ${total.skipped} skipped`);
  return total;
}

// ============================================================
// MASTER MODIFIER CATEGORIES AND MODIFIERS FOR NEW TRADES
// ============================================================

type ModifierCategoryDef = {
  tradeType: string;
  name: string;
  description: string;
  displayOrder: number;
  modifiers: Array<{
    name: string;
    code: string;
    description: string;
    displayOrder: number;
  }>;
};

const newTradeModifierCategories: ModifierCategoryDef[] = [
  // === CIVIL / SITE TRADES ===
  // SITE_DEMOLITION
  { tradeType: "SITE_DEMOLITION", name: "Structure Type", description: "Type of structure being demolished", displayOrder: 1, modifiers: [
    { name: "Wood Frame", code: "demo_wood", description: "Wood frame structures", displayOrder: 1 },
    { name: "Masonry", code: "demo_masonry", description: "Brick/block masonry", displayOrder: 2 },
    { name: "Concrete", code: "demo_concrete", description: "Reinforced concrete", displayOrder: 3 },
    { name: "Steel", code: "demo_steel", description: "Steel frame structures", displayOrder: 4 },
  ]},
  { tradeType: "SITE_DEMOLITION", name: "Hazmat Presence", description: "Hazardous materials on site", displayOrder: 2, modifiers: [
    { name: "No Hazmat", code: "hazmat_none", description: "No hazardous materials", displayOrder: 1 },
    { name: "Asbestos", code: "hazmat_asbestos", description: "Asbestos present", displayOrder: 2 },
    { name: "Lead Paint", code: "hazmat_lead", description: "Lead paint present", displayOrder: 3 },
    { name: "Multiple Hazards", code: "hazmat_multi", description: "Multiple hazards", displayOrder: 4 },
  ]},
  { tradeType: "SITE_DEMOLITION", name: "Access Conditions", description: "Site access restrictions", displayOrder: 3, modifiers: [
    { name: "Open Access", code: "access_open", description: "Full site access", displayOrder: 1 },
    { name: "Limited Access", code: "access_limited", description: "Restricted vehicle access", displayOrder: 2 },
    { name: "Urban/Confined", code: "access_urban", description: "Tight urban conditions", displayOrder: 3 },
  ]},

  // MASS_EXCAVATION
  { tradeType: "MASS_EXCAVATION", name: "Soil Type", description: "Type of soil being excavated", displayOrder: 1, modifiers: [
    { name: "Common Earth", code: "soil_common", description: "Standard soil excavation", displayOrder: 1 },
    { name: "Clay", code: "soil_clay", description: "Heavy clay soils", displayOrder: 2 },
    { name: "Rock (Rippable)", code: "soil_rock_rip", description: "Rippable rock", displayOrder: 3 },
    { name: "Rock (Blasting)", code: "soil_rock_blast", description: "Requires blasting", displayOrder: 4 },
    { name: "Wet/Saturated", code: "soil_wet", description: "High water table", displayOrder: 5 },
  ]},
  { tradeType: "MASS_EXCAVATION", name: "Haul Distance", description: "Distance to disposal/borrow site", displayOrder: 2, modifiers: [
    { name: "On-Site", code: "haul_onsite", description: "On-site stockpile", displayOrder: 1 },
    { name: "Short Haul (<5 mi)", code: "haul_short", description: "Under 5 miles", displayOrder: 2 },
    { name: "Medium Haul (5-15 mi)", code: "haul_medium", description: "5-15 miles", displayOrder: 3 },
    { name: "Long Haul (>15 mi)", code: "haul_long", description: "Over 15 miles", displayOrder: 4 },
  ]},
  { tradeType: "MASS_EXCAVATION", name: "Slope Stability", description: "Excavation slope requirements", displayOrder: 3, modifiers: [
    { name: "1:1 Slope", code: "slope_1_1", description: "45 degree slope", displayOrder: 1 },
    { name: "1.5:1 Slope", code: "slope_1_5", description: "Standard slope", displayOrder: 2 },
    { name: "2:1 Slope", code: "slope_2_1", description: "Shallow slope", displayOrder: 3 },
    { name: "Vertical (Shored)", code: "slope_vertical", description: "Requires shoring", displayOrder: 4 },
  ]},

  // TRENCHING
  { tradeType: "TRENCHING", name: "Trench Depth", description: "Depth of utility trench", displayOrder: 1, modifiers: [
    { name: "Shallow (<4')", code: "depth_shallow", description: "Under 4 feet", displayOrder: 1 },
    { name: "Standard (4-8')", code: "depth_standard", description: "4 to 8 feet", displayOrder: 2 },
    { name: "Deep (8-15')", code: "depth_deep", description: "8 to 15 feet", displayOrder: 3 },
    { name: "Very Deep (>15')", code: "depth_very_deep", description: "Over 15 feet", displayOrder: 4 },
  ]},
  { tradeType: "TRENCHING", name: "Soil Classification", description: "OSHA soil classification", displayOrder: 2, modifiers: [
    { name: "Type A", code: "osha_type_a", description: "Stable rock, clay", displayOrder: 1 },
    { name: "Type B", code: "osha_type_b", description: "Angular gravel, silt", displayOrder: 2 },
    { name: "Type C", code: "osha_type_c", description: "Gravel, sand, wet soil", displayOrder: 3 },
  ]},
  { tradeType: "TRENCHING", name: "Protection Method", description: "Cave-in protection", displayOrder: 3, modifiers: [
    { name: "Sloped/Benched", code: "protect_slope", description: "Open cut sloping", displayOrder: 1 },
    { name: "Trench Box", code: "protect_box", description: "Trench shield/box", displayOrder: 2 },
    { name: "Sheet Piling", code: "protect_sheet", description: "Steel sheet piling", displayOrder: 3 },
  ]},

  // SHORING
  { tradeType: "SHORING", name: "Shoring Type", description: "Type of excavation support", displayOrder: 1, modifiers: [
    { name: "Steel Sheet Pile", code: "shore_sheet", description: "Steel sheet piling", displayOrder: 1 },
    { name: "Soldier Pile", code: "shore_soldier", description: "H-pile and lagging", displayOrder: 2 },
    { name: "Secant Pile", code: "shore_secant", description: "Interlocking piles", displayOrder: 3 },
    { name: "Soil Nailing", code: "shore_nail", description: "Soil nail wall", displayOrder: 4 },
  ]},
  { tradeType: "SHORING", name: "Retention Height", description: "Height of retained earth", displayOrder: 2, modifiers: [
    { name: "Low (<10')", code: "retain_low", description: "Under 10 feet", displayOrder: 1 },
    { name: "Medium (10-20')", code: "retain_med", description: "10-20 feet", displayOrder: 2 },
    { name: "High (20-40')", code: "retain_high", description: "20-40 feet", displayOrder: 3 },
    { name: "Very High (>40')", code: "retain_vhigh", description: "Over 40 feet", displayOrder: 4 },
  ]},

  // DEWATERING
  { tradeType: "DEWATERING", name: "Water Source", description: "Source of groundwater", displayOrder: 1, modifiers: [
    { name: "Perched Water", code: "water_perched", description: "Shallow perched water", displayOrder: 1 },
    { name: "Groundwater", code: "water_ground", description: "Continuous aquifer", displayOrder: 2 },
    { name: "Tidal Influence", code: "water_tidal", description: "Coastal/tidal areas", displayOrder: 3 },
  ]},
  { tradeType: "DEWATERING", name: "Flow Rate", description: "Estimated pumping rate", displayOrder: 2, modifiers: [
    { name: "Light (<100 GPM)", code: "flow_light", description: "Under 100 GPM", displayOrder: 1 },
    { name: "Moderate (100-500 GPM)", code: "flow_mod", description: "100-500 GPM", displayOrder: 2 },
    { name: "Heavy (>500 GPM)", code: "flow_heavy", description: "Over 500 GPM", displayOrder: 3 },
  ]},

  // SOIL_STABILIZATION
  { tradeType: "SOIL_STABILIZATION", name: "Treatment Method", description: "Soil stabilization technique", displayOrder: 1, modifiers: [
    { name: "Lime Treatment", code: "stab_lime", description: "Quicklime stabilization", displayOrder: 1 },
    { name: "Cement Treatment", code: "stab_cement", description: "Portland cement", displayOrder: 2 },
    { name: "Chemical Injection", code: "stab_chem", description: "Chemical grouting", displayOrder: 3 },
    { name: "Mechanical", code: "stab_mech", description: "Compaction/densification", displayOrder: 4 },
  ]},
  { tradeType: "SOIL_STABILIZATION", name: "Treatment Depth", description: "Depth of treatment", displayOrder: 2, modifiers: [
    { name: "Shallow (<12\")", code: "treat_shallow", description: "Surface treatment", displayOrder: 1 },
    { name: "Medium (12-24\")", code: "treat_medium", description: "Standard depth", displayOrder: 2 },
    { name: "Deep (>24\")", code: "treat_deep", description: "Deep stabilization", displayOrder: 3 },
  ]},

  // ENVIRONMENTAL_REMEDIATION
  { tradeType: "ENVIRONMENTAL_REMEDIATION", name: "Contaminant Type", description: "Type of contamination", displayOrder: 1, modifiers: [
    { name: "Petroleum", code: "contam_petro", description: "Fuel/oil contamination", displayOrder: 1 },
    { name: "Solvents", code: "contam_solvent", description: "Chemical solvents", displayOrder: 2 },
    { name: "Heavy Metals", code: "contam_metal", description: "Lead, arsenic, etc.", displayOrder: 3 },
    { name: "Asbestos", code: "contam_asbestos", description: "ACM materials", displayOrder: 4 },
  ]},
  { tradeType: "ENVIRONMENTAL_REMEDIATION", name: "Remediation Method", description: "Cleanup approach", displayOrder: 2, modifiers: [
    { name: "Excavation/Disposal", code: "remed_excav", description: "Dig and haul", displayOrder: 1 },
    { name: "In-Situ Treatment", code: "remed_insitu", description: "Treat in place", displayOrder: 2 },
    { name: "Encapsulation", code: "remed_encap", description: "Cap and contain", displayOrder: 3 },
  ]},

  // WELL_PLUGGING
  { tradeType: "WELL_PLUGGING", name: "Well Type", description: "Type of well being plugged", displayOrder: 1, modifiers: [
    { name: "Water Well", code: "well_water", description: "Domestic/irrigation well", displayOrder: 1 },
    { name: "Monitor Well", code: "well_monitor", description: "Environmental monitoring", displayOrder: 2 },
    { name: "Oil/Gas Well", code: "well_oil_gas", description: "Production well", displayOrder: 3 },
  ]},
  { tradeType: "WELL_PLUGGING", name: "Well Depth", description: "Depth of well", displayOrder: 2, modifiers: [
    { name: "Shallow (<100')", code: "welldepth_shallow", description: "Under 100 feet", displayOrder: 1 },
    { name: "Medium (100-500')", code: "welldepth_med", description: "100-500 feet", displayOrder: 2 },
    { name: "Deep (>500')", code: "welldepth_deep", description: "Over 500 feet", displayOrder: 3 },
  ]},

  // STORMWATER_SYSTEMS
  { tradeType: "STORMWATER_SYSTEMS", name: "Pipe Material", description: "Storm pipe material", displayOrder: 1, modifiers: [
    { name: "RCP", code: "storm_rcp", description: "Reinforced concrete pipe", displayOrder: 1 },
    { name: "HDPE", code: "storm_hdpe", description: "High density polyethylene", displayOrder: 2 },
    { name: "CMP", code: "storm_cmp", description: "Corrugated metal pipe", displayOrder: 3 },
    { name: "PVC", code: "storm_pvc", description: "PVC storm pipe", displayOrder: 4 },
  ]},
  { tradeType: "STORMWATER_SYSTEMS", name: "Pipe Size", description: "Storm pipe diameter", displayOrder: 2, modifiers: [
    { name: "Small (12-18\")", code: "stormsize_sm", description: "12-18 inch", displayOrder: 1 },
    { name: "Medium (24-36\")", code: "stormsize_med", description: "24-36 inch", displayOrder: 2 },
    { name: "Large (42-60\")", code: "stormsize_lg", description: "42-60 inch", displayOrder: 3 },
    { name: "Very Large (>60\")", code: "stormsize_xl", description: "Over 60 inch", displayOrder: 4 },
  ]},

  // SANITARY_SEWER
  { tradeType: "SANITARY_SEWER", name: "Pipe Material", description: "Sewer pipe material", displayOrder: 1, modifiers: [
    { name: "PVC SDR-35", code: "sewer_pvc35", description: "Standard PVC sewer", displayOrder: 1 },
    { name: "PVC SDR-26", code: "sewer_pvc26", description: "Heavy wall PVC", displayOrder: 2 },
    { name: "Ductile Iron", code: "sewer_di", description: "Ductile iron pipe", displayOrder: 3 },
    { name: "VCP", code: "sewer_vcp", description: "Vitrified clay pipe", displayOrder: 4 },
  ]},
  { tradeType: "SANITARY_SEWER", name: "Installation Method", description: "Pipe installation technique", displayOrder: 2, modifiers: [
    { name: "Open Cut", code: "install_open", description: "Conventional trenching", displayOrder: 1 },
    { name: "Pipe Bursting", code: "install_burst", description: "Trenchless replacement", displayOrder: 2 },
    { name: "CIPP Lining", code: "install_cipp", description: "Cured-in-place lining", displayOrder: 3 },
    { name: "Directional Drill", code: "install_hdd", description: "HDD installation", displayOrder: 4 },
  ]},

  // WATERLINE
  { tradeType: "WATERLINE", name: "Pipe Material", description: "Water main material", displayOrder: 1, modifiers: [
    { name: "Ductile Iron", code: "water_di", description: "DI pipe", displayOrder: 1 },
    { name: "PVC C900", code: "water_pvc", description: "AWWA C900 PVC", displayOrder: 2 },
    { name: "HDPE", code: "water_hdpe", description: "High density PE", displayOrder: 3 },
    { name: "Copper", code: "water_copper", description: "Copper service", displayOrder: 4 },
  ]},
  { tradeType: "WATERLINE", name: "Pressure Class", description: "Pipe pressure rating", displayOrder: 2, modifiers: [
    { name: "Class 150", code: "press_150", description: "150 PSI", displayOrder: 1 },
    { name: "Class 200", code: "press_200", description: "200 PSI", displayOrder: 2 },
    { name: "Class 250", code: "press_250", description: "250 PSI", displayOrder: 3 },
  ]},

  // FORCE_MAIN
  { tradeType: "FORCE_MAIN", name: "Pipe Material", description: "Force main pipe material", displayOrder: 1, modifiers: [
    { name: "Ductile Iron", code: "fm_di", description: "DI force main", displayOrder: 1 },
    { name: "PVC C905", code: "fm_pvc", description: "AWWA C905 PVC", displayOrder: 2 },
    { name: "HDPE", code: "fm_hdpe", description: "Fused HDPE", displayOrder: 3 },
  ]},
  { tradeType: "FORCE_MAIN", name: "Pump Station Type", description: "Lift station configuration", displayOrder: 2, modifiers: [
    { name: "Submersible", code: "pump_sub", description: "Submersible pumps", displayOrder: 1 },
    { name: "Dry Pit", code: "pump_dry", description: "Dry pit station", displayOrder: 2 },
    { name: "Package Station", code: "pump_pkg", description: "Pre-fabricated", displayOrder: 3 },
  ]},

  // ROADWAY_CONSTRUCTION
  { tradeType: "ROADWAY_CONSTRUCTION", name: "Road Classification", description: "Roadway functional class", displayOrder: 1, modifiers: [
    { name: "Local Street", code: "road_local", description: "Residential street", displayOrder: 1 },
    { name: "Collector", code: "road_collector", description: "Collector road", displayOrder: 2 },
    { name: "Arterial", code: "road_arterial", description: "Major arterial", displayOrder: 3 },
    { name: "Highway", code: "road_highway", description: "State highway", displayOrder: 4 },
  ]},
  { tradeType: "ROADWAY_CONSTRUCTION", name: "Pavement Type", description: "Surface pavement type", displayOrder: 2, modifiers: [
    { name: "Asphalt", code: "pave_asphalt", description: "HMA pavement", displayOrder: 1 },
    { name: "Concrete", code: "pave_concrete", description: "PCCP pavement", displayOrder: 2 },
    { name: "Chip Seal", code: "pave_chip", description: "Surface treatment", displayOrder: 3 },
  ]},

  // CURB_AND_GUTTER
  { tradeType: "CURB_AND_GUTTER", name: "Curb Type", description: "Curb and gutter profile", displayOrder: 1, modifiers: [
    { name: "Type A (Vertical)", code: "curb_a", description: "Standard vertical face", displayOrder: 1 },
    { name: "Type B (Mountable)", code: "curb_b", description: "Rollover/mountable", displayOrder: 2 },
    { name: "Type C (Barrier)", code: "curb_c", description: "High barrier curb", displayOrder: 3 },
  ]},
  { tradeType: "CURB_AND_GUTTER", name: "Concrete Strength", description: "Concrete mix design", displayOrder: 2, modifiers: [
    { name: "3000 PSI", code: "cg_3000", description: "Standard strength", displayOrder: 1 },
    { name: "4000 PSI", code: "cg_4000", description: "High strength", displayOrder: 2 },
  ]},

  // SIDEWALK
  { tradeType: "SIDEWALK", name: "Width", description: "Sidewalk width", displayOrder: 1, modifiers: [
    { name: "4 Foot", code: "sw_4ft", description: "Residential width", displayOrder: 1 },
    { name: "5 Foot", code: "sw_5ft", description: "Standard ADA width", displayOrder: 2 },
    { name: "6+ Foot", code: "sw_6ft", description: "Commercial width", displayOrder: 3 },
  ]},
  { tradeType: "SIDEWALK", name: "Thickness", description: "Concrete thickness", displayOrder: 2, modifiers: [
    { name: "4 Inch", code: "sw_4in", description: "Standard pedestrian", displayOrder: 1 },
    { name: "6 Inch", code: "sw_6in", description: "Driveway crossing", displayOrder: 2 },
  ]},

  // CONCRETE_PAVING
  { tradeType: "CONCRETE_PAVING", name: "Thickness", description: "Pavement thickness", displayOrder: 1, modifiers: [
    { name: "4 Inch", code: "cp_4in", description: "Light duty", displayOrder: 1 },
    { name: "6 Inch", code: "cp_6in", description: "Standard duty", displayOrder: 2 },
    { name: "8 Inch", code: "cp_8in", description: "Heavy duty", displayOrder: 3 },
  ]},
  { tradeType: "CONCRETE_PAVING", name: "Finish", description: "Surface finish type", displayOrder: 2, modifiers: [
    { name: "Broom", code: "cpfin_broom", description: "Standard broom", displayOrder: 1 },
    { name: "Steel Trowel", code: "cpfin_trowel", description: "Smooth finish", displayOrder: 2 },
    { name: "Stamped", code: "cpfin_stamp", description: "Decorative stamp", displayOrder: 3 },
  ]},

  // TRAFFIC_CONTROL
  { tradeType: "TRAFFIC_CONTROL", name: "Signal Type", description: "Traffic signal configuration", displayOrder: 1, modifiers: [
    { name: "Standard Intersection", code: "sig_std", description: "4-way signalized", displayOrder: 1 },
    { name: "Protected Turn", code: "sig_protect", description: "With turn arrows", displayOrder: 2 },
    { name: "Pedestrian Hybrid", code: "sig_hawk", description: "HAWK signal", displayOrder: 3 },
  ]},
  { tradeType: "TRAFFIC_CONTROL", name: "Detection Type", description: "Vehicle detection method", displayOrder: 2, modifiers: [
    { name: "In-Ground Loops", code: "detect_loop", description: "Inductive loops", displayOrder: 1 },
    { name: "Video Detection", code: "detect_video", description: "Camera detection", displayOrder: 2 },
    { name: "Radar", code: "detect_radar", description: "Radar detection", displayOrder: 3 },
  ]},

  // STRIPING_AND_SIGNAGE
  { tradeType: "STRIPING_AND_SIGNAGE", name: "Striping Material", description: "Pavement marking type", displayOrder: 1, modifiers: [
    { name: "Latex Paint", code: "stripe_latex", description: "Water-based paint", displayOrder: 1 },
    { name: "Thermoplastic", code: "stripe_thermo", description: "Hot-applied plastic", displayOrder: 2 },
    { name: "Epoxy", code: "stripe_epoxy", description: "Epoxy markings", displayOrder: 3 },
  ]},
  { tradeType: "STRIPING_AND_SIGNAGE", name: "Sign Mounting", description: "Sign support type", displayOrder: 2, modifiers: [
    { name: "U-Channel Post", code: "sign_uchan", description: "Standard post", displayOrder: 1 },
    { name: "Square Tube", code: "sign_square", description: "Square steel post", displayOrder: 2 },
    { name: "Overhead Structure", code: "sign_overhead", description: "Span wire or truss", displayOrder: 3 },
  ]},

  // EROSION_CONTROL
  { tradeType: "EROSION_CONTROL", name: "BMP Type", description: "Best management practice", displayOrder: 1, modifiers: [
    { name: "Silt Fence", code: "bmp_silt", description: "Standard silt fence", displayOrder: 1 },
    { name: "Wattle/Fiber Roll", code: "bmp_wattle", description: "Straw/coir wattle", displayOrder: 2 },
    { name: "Sediment Basin", code: "bmp_basin", description: "Temporary basin", displayOrder: 3 },
  ]},
  { tradeType: "EROSION_CONTROL", name: "Slope Stabilization", description: "Slope protection method", displayOrder: 2, modifiers: [
    { name: "Seed & Mulch", code: "slope_seed", description: "Hydroseeding", displayOrder: 1 },
    { name: "Erosion Blanket", code: "slope_blanket", description: "ECB/TRM", displayOrder: 2 },
    { name: "Rip Rap", code: "slope_riprap", description: "Rock armoring", displayOrder: 3 },
  ]},

  // FENCING_AND_GATES
  { tradeType: "FENCING_AND_GATES", name: "Fence Type", description: "Fence material/style", displayOrder: 1, modifiers: [
    { name: "Chain Link", code: "fence_cl", description: "Standard chain link", displayOrder: 1 },
    { name: "Ornamental Iron", code: "fence_iron", description: "Decorative metal", displayOrder: 2 },
    { name: "Wood Privacy", code: "fence_wood", description: "Board fence", displayOrder: 3 },
    { name: "Vinyl", code: "fence_vinyl", description: "PVC fencing", displayOrder: 4 },
  ]},
  { tradeType: "FENCING_AND_GATES", name: "Height", description: "Fence height", displayOrder: 2, modifiers: [
    { name: "4 Foot", code: "fence_4ft", description: "Low fence", displayOrder: 1 },
    { name: "6 Foot", code: "fence_6ft", description: "Standard height", displayOrder: 2 },
    { name: "8+ Foot", code: "fence_8ft", description: "Security height", displayOrder: 3 },
  ]},

  // === STRUCTURAL / BUILDING TRADES ===
  // CAST_IN_PLACE_CONCRETE
  { tradeType: "CAST_IN_PLACE_CONCRETE", name: "Concrete Strength", description: "Mix design strength", displayOrder: 1, modifiers: [
    { name: "3000 PSI", code: "cip_3000", description: "Standard strength", displayOrder: 1 },
    { name: "4000 PSI", code: "cip_4000", description: "Structural strength", displayOrder: 2 },
    { name: "5000 PSI", code: "cip_5000", description: "High strength", displayOrder: 3 },
    { name: "6000+ PSI", code: "cip_6000", description: "High performance", displayOrder: 4 },
  ]},
  { tradeType: "CAST_IN_PLACE_CONCRETE", name: "Placement Method", description: "Concrete placement", displayOrder: 2, modifiers: [
    { name: "Direct Chute", code: "cip_chute", description: "Truck chute", displayOrder: 1 },
    { name: "Pump", code: "cip_pump", description: "Concrete pump", displayOrder: 2 },
    { name: "Crane & Bucket", code: "cip_crane", description: "Crane placement", displayOrder: 3 },
  ]},
  { tradeType: "CAST_IN_PLACE_CONCRETE", name: "Form Type", description: "Formwork system", displayOrder: 3, modifiers: [
    { name: "Job-Built", code: "form_job", description: "Site-built forms", displayOrder: 1 },
    { name: "Modular Panel", code: "form_panel", description: "Gang forms", displayOrder: 2 },
    { name: "Slip Form", code: "form_slip", description: "Slip form system", displayOrder: 3 },
  ]},

  // PRECAST_CONCRETE
  { tradeType: "PRECAST_CONCRETE", name: "Element Type", description: "Precast element category", displayOrder: 1, modifiers: [
    { name: "Double Tees", code: "pc_dt", description: "Floor/roof elements", displayOrder: 1 },
    { name: "Hollow Core", code: "pc_hc", description: "Hollow core plank", displayOrder: 2 },
    { name: "Beams/Girders", code: "pc_beam", description: "Structural beams", displayOrder: 3 },
    { name: "Wall Panels", code: "pc_wall", description: "Architectural panels", displayOrder: 4 },
  ]},
  { tradeType: "PRECAST_CONCRETE", name: "Finish", description: "Surface finish", displayOrder: 2, modifiers: [
    { name: "Gray (As-Cast)", code: "pcfin_gray", description: "Standard gray", displayOrder: 1 },
    { name: "Sandblast", code: "pcfin_sand", description: "Light exposure", displayOrder: 2 },
    { name: "Acid Etch", code: "pcfin_acid", description: "Acid wash finish", displayOrder: 3 },
    { name: "Form Liner", code: "pcfin_liner", description: "Textured liner", displayOrder: 4 },
  ]},

  // REBAR_AND_POST_TENSION
  { tradeType: "REBAR_AND_POST_TENSION", name: "Rebar Grade", description: "Steel reinforcement grade", displayOrder: 1, modifiers: [
    { name: "Grade 40", code: "rebar_40", description: "40 ksi yield", displayOrder: 1 },
    { name: "Grade 60", code: "rebar_60", description: "60 ksi yield", displayOrder: 2 },
    { name: "Grade 75", code: "rebar_75", description: "75 ksi yield", displayOrder: 3 },
  ]},
  { tradeType: "REBAR_AND_POST_TENSION", name: "Coating", description: "Corrosion protection", displayOrder: 2, modifiers: [
    { name: "Uncoated (Black)", code: "coat_black", description: "Standard black", displayOrder: 1 },
    { name: "Epoxy Coated", code: "coat_epoxy", description: "Fusion bonded epoxy", displayOrder: 2 },
    { name: "Galvanized", code: "coat_galv", description: "Hot-dip galvanized", displayOrder: 3 },
  ]},
  { tradeType: "REBAR_AND_POST_TENSION", name: "PT System", description: "Post-tension type", displayOrder: 3, modifiers: [
    { name: "Unbonded Monostrand", code: "pt_mono", description: "Unbonded tendons", displayOrder: 1 },
    { name: "Bonded Multistrand", code: "pt_multi", description: "Grouted tendons", displayOrder: 2 },
  ]},

  // STRUCTURAL_STEEL
  { tradeType: "STRUCTURAL_STEEL", name: "Steel Grade", description: "Structural steel grade", displayOrder: 1, modifiers: [
    { name: "A36", code: "steel_a36", description: "Carbon steel", displayOrder: 1 },
    { name: "A572 Gr 50", code: "steel_a572", description: "HSLA steel", displayOrder: 2 },
    { name: "A992", code: "steel_a992", description: "Wide flange steel", displayOrder: 3 },
  ]},
  { tradeType: "STRUCTURAL_STEEL", name: "Connection Type", description: "Steel connection method", displayOrder: 2, modifiers: [
    { name: "Bolted", code: "conn_bolt", description: "High-strength bolts", displayOrder: 1 },
    { name: "Welded", code: "conn_weld", description: "Field welded", displayOrder: 2 },
    { name: "Moment Frame", code: "conn_moment", description: "Moment connections", displayOrder: 3 },
  ]},
  { tradeType: "STRUCTURAL_STEEL", name: "Finish", description: "Steel surface treatment", displayOrder: 3, modifiers: [
    { name: "Primer Only", code: "stfin_primer", description: "Shop primer", displayOrder: 1 },
    { name: "Painted", code: "stfin_paint", description: "Full paint system", displayOrder: 2 },
    { name: "Galvanized", code: "stfin_galv", description: "Hot-dip galvanized", displayOrder: 3 },
    { name: "Fireproofed", code: "stfin_fire", description: "Spray fireproofing", displayOrder: 4 },
  ]},

  // METAL_BUILDINGS
  { tradeType: "METAL_BUILDINGS", name: "Building Type", description: "Metal building classification", displayOrder: 1, modifiers: [
    { name: "Clear Span", code: "mb_clear", description: "No interior columns", displayOrder: 1 },
    { name: "Multi-Span", code: "mb_multi", description: "Interior columns", displayOrder: 2 },
    { name: "Lean-To", code: "mb_leanto", description: "Attached addition", displayOrder: 3 },
  ]},
  { tradeType: "METAL_BUILDINGS", name: "Roof System", description: "Roof panel type", displayOrder: 2, modifiers: [
    { name: "Standing Seam", code: "mbroof_ss", description: "Standing seam metal", displayOrder: 1 },
    { name: "Through-Fastened", code: "mbroof_tf", description: "Exposed fastener", displayOrder: 2 },
    { name: "Insulated Panel", code: "mbroof_ins", description: "Foam core panel", displayOrder: 3 },
  ]},

  // CARPENTRY_FRAMING
  { tradeType: "CARPENTRY_FRAMING", name: "Lumber Grade", description: "Framing lumber grade", displayOrder: 1, modifiers: [
    { name: "Standard & Better", code: "lum_std", description: "#2 or better", displayOrder: 1 },
    { name: "Select Structural", code: "lum_select", description: "High grade", displayOrder: 2 },
    { name: "Engineered (LVL/TJI)", code: "lum_eng", description: "Engineered lumber", displayOrder: 3 },
  ]},
  { tradeType: "CARPENTRY_FRAMING", name: "Wall Type", description: "Wall framing type", displayOrder: 2, modifiers: [
    { name: "2x4 @ 16\" OC", code: "wall_2x4_16", description: "Standard interior", displayOrder: 1 },
    { name: "2x4 @ 24\" OC", code: "wall_2x4_24", description: "Economic spacing", displayOrder: 2 },
    { name: "2x6 @ 16\" OC", code: "wall_2x6_16", description: "Exterior/load bearing", displayOrder: 3 },
    { name: "2x6 @ 24\" OC", code: "wall_2x6_24", description: "Advanced framing", displayOrder: 4 },
  ]},

  // DRYWALL_SYSTEMS
  { tradeType: "DRYWALL_SYSTEMS", name: "Board Type", description: "Gypsum board type", displayOrder: 1, modifiers: [
    { name: "Regular 1/2\"", code: "dw_reg_12", description: "Standard board", displayOrder: 1 },
    { name: "Regular 5/8\"", code: "dw_reg_58", description: "Thicker board", displayOrder: 2 },
    { name: "Type X 5/8\"", code: "dw_x_58", description: "Fire-rated", displayOrder: 3 },
    { name: "Moisture Resistant", code: "dw_mr", description: "Green board", displayOrder: 4 },
  ]},
  { tradeType: "DRYWALL_SYSTEMS", name: "Finish Level", description: "Drywall finish quality", displayOrder: 2, modifiers: [
    { name: "Level 3", code: "dwfin_3", description: "Texture ready", displayOrder: 1 },
    { name: "Level 4", code: "dwfin_4", description: "Flat paint ready", displayOrder: 2 },
    { name: "Level 5", code: "dwfin_5", description: "High-end smooth", displayOrder: 3 },
  ]},

  // ACOUSTICAL_CEILINGS
  { tradeType: "ACOUSTICAL_CEILINGS", name: "Panel Size", description: "Ceiling panel dimensions", displayOrder: 1, modifiers: [
    { name: "2'x2'", code: "ac_2x2", description: "Standard 2x2", displayOrder: 1 },
    { name: "2'x4'", code: "ac_2x4", description: "Standard 2x4", displayOrder: 2 },
  ]},
  { tradeType: "ACOUSTICAL_CEILINGS", name: "Grid Type", description: "Suspension grid", displayOrder: 2, modifiers: [
    { name: "Exposed Grid", code: "acgrid_exp", description: "Standard exposed", displayOrder: 1 },
    { name: "Concealed Grid", code: "acgrid_con", description: "Hidden grid", displayOrder: 2 },
    { name: "Direct Mount", code: "acgrid_direct", description: "Glue-up tiles", displayOrder: 3 },
  ]},

  // PAINTING_AND_COATINGS
  { tradeType: "PAINTING_AND_COATINGS", name: "Paint System", description: "Coating system type", displayOrder: 1, modifiers: [
    { name: "Latex (1 Coat)", code: "paint_1lat", description: "Single coat", displayOrder: 1 },
    { name: "Latex (2 Coat)", code: "paint_2lat", description: "Two coat system", displayOrder: 2 },
    { name: "Epoxy", code: "paint_epoxy", description: "Epoxy coating", displayOrder: 3 },
    { name: "Urethane", code: "paint_ureth", description: "Urethane finish", displayOrder: 4 },
  ]},
  { tradeType: "PAINTING_AND_COATINGS", name: "Surface Prep", description: "Surface preparation", displayOrder: 2, modifiers: [
    { name: "Light Sand", code: "prep_light", description: "Light sanding", displayOrder: 1 },
    { name: "Prime & Patch", code: "prep_prime", description: "Full prime coat", displayOrder: 2 },
    { name: "Sandblast", code: "prep_blast", description: "Abrasive blast", displayOrder: 3 },
  ]},

  // FLOORING_SYSTEMS
  { tradeType: "FLOORING_SYSTEMS", name: "Flooring Type", description: "Floor covering material", displayOrder: 1, modifiers: [
    { name: "Carpet Tile", code: "floor_carpet", description: "Modular carpet", displayOrder: 1 },
    { name: "VCT", code: "floor_vct", description: "Vinyl composition tile", displayOrder: 2 },
    { name: "LVT/LVP", code: "floor_lvt", description: "Luxury vinyl", displayOrder: 3 },
    { name: "Ceramic Tile", code: "floor_ceramic", description: "Ceramic/porcelain", displayOrder: 4 },
    { name: "Epoxy Flooring", code: "floor_epoxy", description: "Resinous coating", displayOrder: 5 },
  ]},
  { tradeType: "FLOORING_SYSTEMS", name: "Substrate", description: "Subfloor condition", displayOrder: 2, modifiers: [
    { name: "Concrete (New)", code: "sub_conc_new", description: "New concrete slab", displayOrder: 1 },
    { name: "Concrete (Existing)", code: "sub_conc_exist", description: "Existing concrete", displayOrder: 2 },
    { name: "Wood Subfloor", code: "sub_wood", description: "Plywood/OSB", displayOrder: 3 },
  ]},

  // ROOFING_SYSTEMS
  { tradeType: "ROOFING_SYSTEMS", name: "Roof Type", description: "Roofing system", displayOrder: 1, modifiers: [
    { name: "TPO", code: "roof_tpo", description: "TPO membrane", displayOrder: 1 },
    { name: "EPDM", code: "roof_epdm", description: "EPDM rubber", displayOrder: 2 },
    { name: "Built-Up", code: "roof_bur", description: "BUR system", displayOrder: 3 },
    { name: "Modified Bitumen", code: "roof_mod", description: "Mod-bit", displayOrder: 4 },
    { name: "Standing Seam", code: "roof_ss", description: "Metal roofing", displayOrder: 5 },
  ]},
  { tradeType: "ROOFING_SYSTEMS", name: "Insulation R-Value", description: "Roof insulation", displayOrder: 2, modifiers: [
    { name: "R-20", code: "rins_20", description: "Standard insulation", displayOrder: 1 },
    { name: "R-30", code: "rins_30", description: "High insulation", displayOrder: 2 },
    { name: "R-40+", code: "rins_40", description: "Maximum insulation", displayOrder: 3 },
  ]},

  // MASONRY_SYSTEMS
  { tradeType: "MASONRY_SYSTEMS", name: "Unit Type", description: "Masonry unit", displayOrder: 1, modifiers: [
    { name: "CMU Standard", code: "mas_cmu", description: "Concrete block", displayOrder: 1 },
    { name: "CMU Split Face", code: "mas_split", description: "Decorative block", displayOrder: 2 },
    { name: "Clay Brick", code: "mas_brick", description: "Face brick", displayOrder: 3 },
    { name: "Stone Veneer", code: "mas_stone", description: "Natural/cultured", displayOrder: 4 },
  ]},
  { tradeType: "MASONRY_SYSTEMS", name: "Reinforcement", description: "Masonry reinforcing", displayOrder: 2, modifiers: [
    { name: "Unreinforced", code: "masrein_none", description: "No reinforcement", displayOrder: 1 },
    { name: "Partially Grouted", code: "masrein_part", description: "Partial grout", displayOrder: 2 },
    { name: "Fully Grouted", code: "masrein_full", description: "Solid grout", displayOrder: 3 },
  ]},

  // GLAZING_SYSTEMS
  { tradeType: "GLAZING_SYSTEMS", name: "System Type", description: "Glazing system", displayOrder: 1, modifiers: [
    { name: "Storefront", code: "glaz_store", description: "Standard storefront", displayOrder: 1 },
    { name: "Curtain Wall", code: "glaz_cw", description: "Curtain wall", displayOrder: 2 },
    { name: "Window Wall", code: "glaz_ww", description: "Window wall system", displayOrder: 3 },
  ]},
  { tradeType: "GLAZING_SYSTEMS", name: "Glass Type", description: "Glazing specification", displayOrder: 2, modifiers: [
    { name: "Clear Insulated", code: "glass_clear", description: "Standard IGU", displayOrder: 1 },
    { name: "Low-E", code: "glass_lowe", description: "Low emissivity", displayOrder: 2 },
    { name: "Tinted", code: "glass_tint", description: "Solar tinted", displayOrder: 3 },
    { name: "Spandrel", code: "glass_span", description: "Opaque spandrel", displayOrder: 4 },
  ]},

  // === MEP / SPECIALTY TRADES ===
  // ELECTRICAL_UNDERGROUND
  { tradeType: "ELECTRICAL_UNDERGROUND", name: "Conduit Type", description: "Underground conduit", displayOrder: 1, modifiers: [
    { name: "PVC Schedule 40", code: "eug_pvc40", description: "Standard PVC", displayOrder: 1 },
    { name: "PVC Schedule 80", code: "eug_pvc80", description: "Heavy wall PVC", displayOrder: 2 },
    { name: "HDPE", code: "eug_hdpe", description: "Directional bore", displayOrder: 3 },
    { name: "Direct Buried", code: "eug_direct", description: "Direct burial cable", displayOrder: 4 },
  ]},
  { tradeType: "ELECTRICAL_UNDERGROUND", name: "Voltage Class", description: "System voltage", displayOrder: 2, modifiers: [
    { name: "Low Voltage (<600V)", code: "eugv_low", description: "Secondary", displayOrder: 1 },
    { name: "Medium Voltage (5-35kV)", code: "eugv_med", description: "Primary", displayOrder: 2 },
    { name: "High Voltage (>35kV)", code: "eugv_high", description: "Transmission", displayOrder: 3 },
  ]},

  // ELECTRICAL_OVERHEAD
  { tradeType: "ELECTRICAL_OVERHEAD", name: "Pole Type", description: "Utility pole material", displayOrder: 1, modifiers: [
    { name: "Wood", code: "eoh_wood", description: "Treated wood pole", displayOrder: 1 },
    { name: "Steel", code: "eoh_steel", description: "Steel pole", displayOrder: 2 },
    { name: "Concrete", code: "eoh_conc", description: "Concrete pole", displayOrder: 3 },
  ]},
  { tradeType: "ELECTRICAL_OVERHEAD", name: "Line Type", description: "Conductor configuration", displayOrder: 2, modifiers: [
    { name: "Single Phase", code: "eohline_1ph", description: "Single phase service", displayOrder: 1 },
    { name: "Three Phase", code: "eohline_3ph", description: "Three phase primary", displayOrder: 2 },
  ]},

  // MECHANICAL_PIPING
  { tradeType: "MECHANICAL_PIPING", name: "Pipe Material", description: "Piping material", displayOrder: 1, modifiers: [
    { name: "Carbon Steel", code: "mp_cs", description: "Standard steel", displayOrder: 1 },
    { name: "Copper", code: "mp_cu", description: "Copper piping", displayOrder: 2 },
    { name: "Stainless Steel", code: "mp_ss", description: "SS piping", displayOrder: 3 },
    { name: "PVC/CPVC", code: "mp_pvc", description: "Plastic piping", displayOrder: 4 },
  ]},
  { tradeType: "MECHANICAL_PIPING", name: "Service Type", description: "Piping service", displayOrder: 2, modifiers: [
    { name: "Chilled Water", code: "mpsvc_chw", description: "CHW system", displayOrder: 1 },
    { name: "Hot Water", code: "mpsvc_hw", description: "HW heating", displayOrder: 2 },
    { name: "Steam", code: "mpsvc_steam", description: "Steam system", displayOrder: 3 },
    { name: "Compressed Air", code: "mpsvc_air", description: "Compressed air", displayOrder: 4 },
  ]},

  // HVAC_SYSTEMS
  { tradeType: "HVAC_SYSTEMS", name: "System Type", description: "HVAC system configuration", displayOrder: 1, modifiers: [
    { name: "Packaged RTU", code: "hvac_rtu", description: "Rooftop unit", displayOrder: 1 },
    { name: "Split System", code: "hvac_split", description: "Split DX", displayOrder: 2 },
    { name: "VAV", code: "hvac_vav", description: "Variable air volume", displayOrder: 3 },
    { name: "VRF", code: "hvac_vrf", description: "Variable refrigerant", displayOrder: 4 },
  ]},
  { tradeType: "HVAC_SYSTEMS", name: "Ductwork", description: "Duct construction", displayOrder: 2, modifiers: [
    { name: "Sheet Metal", code: "duct_metal", description: "Galvanized duct", displayOrder: 1 },
    { name: "Flex Duct", code: "duct_flex", description: "Flexible duct", displayOrder: 2 },
    { name: "Fiberglass Duct", code: "duct_fiber", description: "Duct board", displayOrder: 3 },
  ]},

  // PLUMBING_SYSTEMS
  { tradeType: "PLUMBING_SYSTEMS", name: "Pipe Material", description: "Supply/waste piping", displayOrder: 1, modifiers: [
    { name: "Copper", code: "plumb_cu", description: "Copper supply", displayOrder: 1 },
    { name: "PEX", code: "plumb_pex", description: "PEX tubing", displayOrder: 2 },
    { name: "CPVC", code: "plumb_cpvc", description: "CPVC supply", displayOrder: 3 },
    { name: "Cast Iron DWV", code: "plumb_ci", description: "Cast iron drain", displayOrder: 4 },
    { name: "PVC DWV", code: "plumb_pvcdwv", description: "PVC drain", displayOrder: 5 },
  ]},
  { tradeType: "PLUMBING_SYSTEMS", name: "Fixture Grade", description: "Fixture quality level", displayOrder: 2, modifiers: [
    { name: "Commercial Standard", code: "fix_comm", description: "Standard commercial", displayOrder: 1 },
    { name: "Institutional", code: "fix_inst", description: "Heavy duty", displayOrder: 2 },
    { name: "Designer/High-End", code: "fix_high", description: "Premium fixtures", displayOrder: 3 },
  ]},

  // FIRE_PROTECTION_SYSTEMS
  { tradeType: "FIRE_PROTECTION_SYSTEMS", name: "System Type", description: "Sprinkler system type", displayOrder: 1, modifiers: [
    { name: "Wet Pipe", code: "fp_wet", description: "Standard wet system", displayOrder: 1 },
    { name: "Dry Pipe", code: "fp_dry", description: "Freeze protection", displayOrder: 2 },
    { name: "Pre-Action", code: "fp_preact", description: "Double interlock", displayOrder: 3 },
    { name: "Deluge", code: "fp_deluge", description: "Open head system", displayOrder: 4 },
  ]},
  { tradeType: "FIRE_PROTECTION_SYSTEMS", name: "Hazard Class", description: "Occupancy hazard", displayOrder: 2, modifiers: [
    { name: "Light Hazard", code: "fphaz_light", description: "Office/residential", displayOrder: 1 },
    { name: "Ordinary Hazard", code: "fphaz_ord", description: "Retail/manufacturing", displayOrder: 2 },
    { name: "Extra Hazard", code: "fphaz_extra", description: "High hazard storage", displayOrder: 3 },
  ]},

  // LOW_VOLTAGE_SYSTEMS
  { tradeType: "LOW_VOLTAGE_SYSTEMS", name: "Cable Type", description: "Low voltage cabling", displayOrder: 1, modifiers: [
    { name: "Cat 5e", code: "lv_cat5e", description: "Category 5e", displayOrder: 1 },
    { name: "Cat 6", code: "lv_cat6", description: "Category 6", displayOrder: 2 },
    { name: "Cat 6A", code: "lv_cat6a", description: "Category 6A", displayOrder: 3 },
    { name: "Fiber Optic", code: "lv_fiber", description: "Fiber cabling", displayOrder: 4 },
  ]},
  { tradeType: "LOW_VOLTAGE_SYSTEMS", name: "Pathway", description: "Cable pathway", displayOrder: 2, modifiers: [
    { name: "Above Ceiling", code: "lvpath_ceil", description: "Ceiling plenum", displayOrder: 1 },
    { name: "Cable Tray", code: "lvpath_tray", description: "Open cable tray", displayOrder: 2 },
    { name: "Conduit", code: "lvpath_cond", description: "EMT/rigid conduit", displayOrder: 3 },
  ]},

  // SECURITY_AND_ACCESS
  { tradeType: "SECURITY_AND_ACCESS", name: "Access Control", description: "Access system type", displayOrder: 1, modifiers: [
    { name: "Card Reader", code: "sec_card", description: "Proximity cards", displayOrder: 1 },
    { name: "Biometric", code: "sec_bio", description: "Fingerprint/facial", displayOrder: 2 },
    { name: "Keypad", code: "sec_keypad", description: "PIN entry", displayOrder: 3 },
  ]},
  { tradeType: "SECURITY_AND_ACCESS", name: "Surveillance", description: "Camera system", displayOrder: 2, modifiers: [
    { name: "IP Cameras", code: "surv_ip", description: "Network cameras", displayOrder: 1 },
    { name: "Analog Cameras", code: "surv_analog", description: "Traditional CCTV", displayOrder: 2 },
  ]},

  // COMMUNICATIONS_IT
  { tradeType: "COMMUNICATIONS_IT", name: "Infrastructure", description: "IT infrastructure", displayOrder: 1, modifiers: [
    { name: "MDF/IDF Rooms", code: "it_mdf", description: "Telecom rooms", displayOrder: 1 },
    { name: "Data Center", code: "it_dc", description: "Server room", displayOrder: 2 },
    { name: "Distributed", code: "it_dist", description: "Edge computing", displayOrder: 3 },
  ]},
  { tradeType: "COMMUNICATIONS_IT", name: "Wireless", description: "Wireless systems", displayOrder: 2, modifiers: [
    { name: "WiFi 5 (802.11ac)", code: "wifi_5", description: "Standard wireless", displayOrder: 1 },
    { name: "WiFi 6 (802.11ax)", code: "wifi_6", description: "High performance", displayOrder: 2 },
    { name: "DAS", code: "wifi_das", description: "Distributed antenna", displayOrder: 3 },
  ]},

  // SOLAR_INSTALLATION
  { tradeType: "SOLAR_INSTALLATION", name: "Panel Type", description: "Solar panel technology", displayOrder: 1, modifiers: [
    { name: "Monocrystalline", code: "solar_mono", description: "High efficiency", displayOrder: 1 },
    { name: "Polycrystalline", code: "solar_poly", description: "Standard panels", displayOrder: 2 },
    { name: "Thin Film", code: "solar_thin", description: "Flexible panels", displayOrder: 3 },
  ]},
  { tradeType: "SOLAR_INSTALLATION", name: "Mounting", description: "Panel mounting system", displayOrder: 2, modifiers: [
    { name: "Roof Mount", code: "solmnt_roof", description: "Building rooftop", displayOrder: 1 },
    { name: "Ground Mount", code: "solmnt_ground", description: "Ground racking", displayOrder: 2 },
    { name: "Carport", code: "solmnt_carport", description: "Parking structure", displayOrder: 3 },
    { name: "Tracking", code: "solmnt_track", description: "Single/dual axis", displayOrder: 4 },
  ]},

  // TEMPORARY_POWER
  { tradeType: "TEMPORARY_POWER", name: "Power Source", description: "Temporary power source", displayOrder: 1, modifiers: [
    { name: "Utility Pedestal", code: "temp_ped", description: "Utility service", displayOrder: 1 },
    { name: "Generator", code: "temp_gen", description: "Diesel generator", displayOrder: 2 },
    { name: "Transformer", code: "temp_xfmr", description: "Temp transformer", displayOrder: 3 },
  ]},
  { tradeType: "TEMPORARY_POWER", name: "Distribution", description: "Power distribution", displayOrder: 2, modifiers: [
    { name: "Spider Boxes", code: "tempdist_spider", description: "Portable panels", displayOrder: 1 },
    { name: "Temp Panels", code: "tempdist_panel", description: "Temporary loadcenters", displayOrder: 2 },
  ]},

  // === SUPPORT / SERVICES TRADES ===
  // SURVEY_AND_LAYOUT
  { tradeType: "SURVEY_AND_LAYOUT", name: "Survey Type", description: "Survey service type", displayOrder: 1, modifiers: [
    { name: "Boundary Survey", code: "surv_bound", description: "Property lines", displayOrder: 1 },
    { name: "Topographic", code: "surv_topo", description: "Site contours", displayOrder: 2 },
    { name: "Construction Staking", code: "surv_stake", description: "Layout/staking", displayOrder: 3 },
    { name: "As-Built", code: "surv_asbuilt", description: "Record survey", displayOrder: 4 },
  ]},
  { tradeType: "SURVEY_AND_LAYOUT", name: "Equipment", description: "Survey equipment", displayOrder: 2, modifiers: [
    { name: "Total Station", code: "surveq_ts", description: "Optical survey", displayOrder: 1 },
    { name: "GPS/GNSS", code: "surveq_gps", description: "Satellite positioning", displayOrder: 2 },
    { name: "3D Scanning", code: "surveq_scan", description: "LiDAR scanning", displayOrder: 3 },
  ]},

  // TESTING_AND_INSPECTIONS
  { tradeType: "TESTING_AND_INSPECTIONS", name: "Test Type", description: "Testing category", displayOrder: 1, modifiers: [
    { name: "Concrete Testing", code: "test_conc", description: "Strength/slump", displayOrder: 1 },
    { name: "Soil Testing", code: "test_soil", description: "Compaction/proctor", displayOrder: 2 },
    { name: "Welding Inspection", code: "test_weld", description: "NDT/UT/MT", displayOrder: 3 },
    { name: "MEP Testing", code: "test_mep", description: "Commissioning tests", displayOrder: 4 },
  ]},
  { tradeType: "TESTING_AND_INSPECTIONS", name: "Frequency", description: "Testing frequency", displayOrder: 2, modifiers: [
    { name: "Periodic", code: "testfreq_per", description: "Scheduled intervals", displayOrder: 1 },
    { name: "Continuous", code: "testfreq_cont", description: "Full-time inspector", displayOrder: 2 },
    { name: "As-Needed", code: "testfreq_asn", description: "On-call basis", displayOrder: 3 },
  ]},

  // COMMISSIONING
  { tradeType: "COMMISSIONING", name: "Cx Level", description: "Commissioning scope", displayOrder: 1, modifiers: [
    { name: "Fundamental Cx", code: "cx_fund", description: "Basic commissioning", displayOrder: 1 },
    { name: "Enhanced Cx", code: "cx_enhanced", description: "LEED enhanced", displayOrder: 2 },
    { name: "Monitoring-Based Cx", code: "cx_mbcx", description: "Ongoing monitoring", displayOrder: 3 },
  ]},
  { tradeType: "COMMISSIONING", name: "Systems", description: "Systems commissioned", displayOrder: 2, modifiers: [
    { name: "HVAC Only", code: "cxsys_hvac", description: "Mechanical systems", displayOrder: 1 },
    { name: "MEP", code: "cxsys_mep", description: "All MEP systems", displayOrder: 2 },
    { name: "Building Envelope", code: "cxsys_env", description: "Enclosure systems", displayOrder: 3 },
  ]},

  // TEMPORARY_FACILITIES
  { tradeType: "TEMPORARY_FACILITIES", name: "Office Type", description: "Temporary office", displayOrder: 1, modifiers: [
    { name: "Single Trailer", code: "tempoff_single", description: "Single-wide trailer", displayOrder: 1 },
    { name: "Double Trailer", code: "tempoff_double", description: "Double-wide trailer", displayOrder: 2 },
    { name: "Modular Complex", code: "tempoff_mod", description: "Multi-unit complex", displayOrder: 3 },
  ]},
  { tradeType: "TEMPORARY_FACILITIES", name: "Duration", description: "Rental duration", displayOrder: 2, modifiers: [
    { name: "Short Term (<6 mo)", code: "tempdur_short", description: "Under 6 months", displayOrder: 1 },
    { name: "Medium Term (6-18 mo)", code: "tempdur_med", description: "6-18 months", displayOrder: 2 },
    { name: "Long Term (>18 mo)", code: "tempdur_long", description: "Over 18 months", displayOrder: 3 },
  ]},

  // GENERAL_CONDITIONS
  { tradeType: "GENERAL_CONDITIONS", name: "Project Size", description: "Project scale", displayOrder: 1, modifiers: [
    { name: "Small (<$1M)", code: "gc_small", description: "Under $1 million", displayOrder: 1 },
    { name: "Medium ($1-10M)", code: "gc_med", description: "$1-10 million", displayOrder: 2 },
    { name: "Large ($10-50M)", code: "gc_large", description: "$10-50 million", displayOrder: 3 },
    { name: "Major (>$50M)", code: "gc_major", description: "Over $50 million", displayOrder: 4 },
  ]},
  { tradeType: "GENERAL_CONDITIONS", name: "Duration", description: "Project duration", displayOrder: 2, modifiers: [
    { name: "Short (<6 mo)", code: "gcdur_short", description: "Under 6 months", displayOrder: 1 },
    { name: "Medium (6-18 mo)", code: "gcdur_med", description: "6-18 months", displayOrder: 2 },
    { name: "Long (>18 mo)", code: "gcdur_long", description: "Over 18 months", displayOrder: 3 },
  ]},
];

async function seedNewTradeModifiers() {
  logInfo("🏷️ Seeding Master Modifier Categories and Modifiers for new trades...\n");
  
  let categoriesInserted = 0;
  let categoriesSkipped = 0;
  let modifiersInserted = 0;
  let modifiersSkipped = 0;
  
  for (const categoryDef of newTradeModifierCategories) {
    const existingCategory = await db.select()
      .from(masterModifierCategories)
      .where(and(
        eq(masterModifierCategories.tradeType, categoryDef.tradeType as any),
        eq(masterModifierCategories.name, categoryDef.name)
      ))
      .limit(1);
    
    let categoryId: string;
    
    if (existingCategory.length > 0) {
      categoryId = existingCategory[0].id;
      categoriesSkipped++;
    } else {
      const [newCategory] = await db.insert(masterModifierCategories).values({
        tradeType: categoryDef.tradeType as any,
        name: categoryDef.name,
        description: categoryDef.description,
        displayOrder: categoryDef.displayOrder,
        isActive: true,
      }).returning({ id: masterModifierCategories.id });
      categoryId = newCategory.id;
      categoriesInserted++;
    }
    
    for (const modifierDef of categoryDef.modifiers) {
      const existingModifier = await db.select()
        .from(masterModifiers)
        .where(and(
          eq(masterModifiers.tradeType, categoryDef.tradeType as any),
          eq(masterModifiers.code, modifierDef.code)
        ))
        .limit(1);
      
      if (existingModifier.length > 0) {
        modifiersSkipped++;
        continue;
      }
      
      await db.insert(masterModifiers).values({
        tradeType: categoryDef.tradeType as any,
        categoryId: categoryId,
        name: modifierDef.name,
        code: modifierDef.code,
        description: modifierDef.description,
        displayOrder: modifierDef.displayOrder,
        isActive: true,
      });
      modifiersInserted++;
    }
  }
  
  logInfo(`✅ Modifier Categories: ${categoriesInserted} inserted, ${categoriesSkipped} skipped`);
  logInfo(`✅ Modifiers: ${modifiersInserted} inserted, ${modifiersSkipped} skipped`);
  
  return { categoriesInserted, categoriesSkipped, modifiersInserted, modifiersSkipped };
}

const coreTradeModifierCategories: Array<{ tradeType: string; name: string; description: string; displayOrder: number }> = [
  { tradeType: "CONCRETE", name: "Additives", description: "Chemical additives and admixtures for concrete", displayOrder: 1 },
  { tradeType: "CONCRETE", name: "Finishes", description: "Surface finish types and treatments", displayOrder: 2 },
  { tradeType: "CONCRETE", name: "Reinforcement", description: "Reinforcement materials and methods", displayOrder: 3 },
  { tradeType: "CONCRETE", name: "Thickness", description: "Slab and wall thickness options", displayOrder: 4 },
  { tradeType: "CONCRETE", name: "Grade/Strength", description: "Concrete mix strength and grade specifications", displayOrder: 5 },
  { tradeType: "CONCRETE", name: "Curing", description: "Curing methods and materials", displayOrder: 6 },
  { tradeType: "GENERAL_CONTRACTOR", name: "Complexity", description: "Project complexity levels", displayOrder: 1 },
  { tradeType: "GENERAL_CONTRACTOR", name: "Access", description: "Site access conditions", displayOrder: 2 },
  { tradeType: "GENERAL_CONTRACTOR", name: "Timeline", description: "Schedule and timeline modifiers", displayOrder: 3 },
  { tradeType: "GENERAL_CONTRACTOR", name: "Quality Level", description: "Material and finish quality tiers", displayOrder: 4 },
  { tradeType: "GENERAL_CONTRACTOR", name: "Conditions", description: "Site and environmental conditions", displayOrder: 5 },
  { tradeType: "ELECTRICAL", name: "Wire Type", description: "Wire and cable types", displayOrder: 1 },
  { tradeType: "ELECTRICAL", name: "Conduit", description: "Conduit types and sizes", displayOrder: 2 },
  { tradeType: "ELECTRICAL", name: "Voltage", description: "Voltage classifications", displayOrder: 3 },
  { tradeType: "ELECTRICAL", name: "Installation Method", description: "Installation methods and mounting", displayOrder: 4 },
  { tradeType: "PLUMBING", name: "Pipe Material", description: "Pipe material types", displayOrder: 1 },
  { tradeType: "PLUMBING", name: "Pipe Size", description: "Pipe diameter sizes", displayOrder: 2 },
  { tradeType: "PLUMBING", name: "Fixture Grade", description: "Fixture quality grades", displayOrder: 3 },
  { tradeType: "PLUMBING", name: "Connection Type", description: "Connection and fitting types", displayOrder: 4 },
  { tradeType: "HVAC", name: "System Type", description: "HVAC system types", displayOrder: 1 },
  { tradeType: "HVAC", name: "Duct Material", description: "Ductwork material types", displayOrder: 2 },
  { tradeType: "HVAC", name: "Capacity", description: "System capacity/tonnage", displayOrder: 3 },
  { tradeType: "HVAC", name: "Efficiency Rating", description: "Energy efficiency ratings", displayOrder: 4 },
  { tradeType: "ROOFING", name: "Material Type", description: "Roofing material types", displayOrder: 1 },
  { tradeType: "ROOFING", name: "Slope", description: "Roof slope/pitch categories", displayOrder: 2 },
  { tradeType: "ROOFING", name: "Insulation", description: "Insulation types and R-values", displayOrder: 3 },
  { tradeType: "ROOFING", name: "Warranty", description: "Warranty levels and terms", displayOrder: 4 },
  { tradeType: "PAINTING", name: "Paint Type", description: "Paint and coating types", displayOrder: 1 },
  { tradeType: "PAINTING", name: "Finish", description: "Surface finish levels", displayOrder: 2 },
  { tradeType: "PAINTING", name: "Surface Prep", description: "Surface preparation levels", displayOrder: 3 },
  { tradeType: "PAINTING", name: "Coats", description: "Number of coats", displayOrder: 4 },
  { tradeType: "MASONRY", name: "Material", description: "Masonry material types", displayOrder: 1 },
  { tradeType: "MASONRY", name: "Pattern", description: "Laying patterns and bonds", displayOrder: 2 },
  { tradeType: "MASONRY", name: "Mortar Type", description: "Mortar mix types", displayOrder: 3 },
  { tradeType: "MASONRY", name: "Wall Type", description: "Wall construction types", displayOrder: 4 },
  { tradeType: "LANDSCAPING", name: "Plant Size", description: "Plant size categories", displayOrder: 1 },
  { tradeType: "LANDSCAPING", name: "Soil Type", description: "Soil and fill types", displayOrder: 2 },
  { tradeType: "LANDSCAPING", name: "Hardscape Material", description: "Hardscape material types", displayOrder: 3 },
  { tradeType: "LANDSCAPING", name: "Irrigation", description: "Irrigation system types", displayOrder: 4 },
  { tradeType: "FLOORING", name: "Material", description: "Flooring material types", displayOrder: 1 },
  { tradeType: "FLOORING", name: "Grade", description: "Material grade/quality levels", displayOrder: 2 },
  { tradeType: "FLOORING", name: "Subfloor Prep", description: "Subfloor preparation levels", displayOrder: 3 },
  { tradeType: "FLOORING", name: "Pattern", description: "Installation patterns", displayOrder: 4 },
  { tradeType: "DEMOLITION", name: "Structure Type", description: "Structure types for demolition", displayOrder: 1 },
  { tradeType: "DEMOLITION", name: "Method", description: "Demolition methods", displayOrder: 2 },
  { tradeType: "DEMOLITION", name: "Hazmat", description: "Hazardous material handling levels", displayOrder: 3 },
  { tradeType: "DEMOLITION", name: "Disposal", description: "Disposal and hauling methods", displayOrder: 4 },
  { tradeType: "STEEL_ERECTION", name: "Steel Grade", description: "Steel grade specifications", displayOrder: 1 },
  { tradeType: "STEEL_ERECTION", name: "Connection Type", description: "Connection types (bolted, welded)", displayOrder: 2 },
  { tradeType: "STEEL_ERECTION", name: "Coating", description: "Protective coating types", displayOrder: 3 },
  { tradeType: "STEEL_ERECTION", name: "Height", description: "Erection height categories", displayOrder: 4 },
  { tradeType: "GLAZING", name: "Glass Type", description: "Glass types and specifications", displayOrder: 1 },
  { tradeType: "GLAZING", name: "Frame Material", description: "Frame material types", displayOrder: 2 },
  { tradeType: "GLAZING", name: "Performance", description: "Performance ratings (thermal, acoustic)", displayOrder: 3 },
  { tradeType: "GLAZING", name: "Installation", description: "Installation method types", displayOrder: 4 },
  { tradeType: "INSULATION", name: "Material Type", description: "Insulation material types", displayOrder: 1 },
  { tradeType: "INSULATION", name: "R-Value", description: "R-value ratings", displayOrder: 2 },
  { tradeType: "INSULATION", name: "Application", description: "Application methods", displayOrder: 3 },
  { tradeType: "INSULATION", name: "Location", description: "Installation locations", displayOrder: 4 },
  { tradeType: "FIRE_PROTECTION", name: "System Type", description: "Fire protection system types", displayOrder: 1 },
  { tradeType: "FIRE_PROTECTION", name: "Hazard Class", description: "Occupancy hazard classifications", displayOrder: 2 },
  { tradeType: "FIRE_PROTECTION", name: "Pipe Material", description: "Sprinkler pipe material types", displayOrder: 3 },
  { tradeType: "FIRE_PROTECTION", name: "Coverage", description: "Coverage density requirements", displayOrder: 4 },
  { tradeType: "DRYWALL", name: "Board Type", description: "Drywall board types", displayOrder: 1 },
  { tradeType: "DRYWALL", name: "Finish Level", description: "Drywall finish levels (1-5)", displayOrder: 2 },
  { tradeType: "DRYWALL", name: "Thickness", description: "Board thickness options", displayOrder: 3 },
  { tradeType: "DRYWALL", name: "Fire Rating", description: "Fire resistance ratings", displayOrder: 4 },
  { tradeType: "CARPENTRY", name: "Material", description: "Lumber and material types", displayOrder: 1 },
  { tradeType: "CARPENTRY", name: "Lumber Grade", description: "Lumber grade and dimension", displayOrder: 2 },
  { tradeType: "CARPENTRY", name: "Wall Type", description: "Wall type classifications", displayOrder: 3 },
  { tradeType: "CARPENTRY", name: "Spacing", description: "Stud/joist spacing", displayOrder: 4 },
  { tradeType: "LOW_VOLTAGE", name: "Cable Type", description: "Cable and wire types", displayOrder: 1 },
  { tradeType: "LOW_VOLTAGE", name: "System", description: "System categories (data, security, AV)", displayOrder: 2 },
  { tradeType: "LOW_VOLTAGE", name: "Pathway", description: "Pathway and raceway types", displayOrder: 3 },
  { tradeType: "LOW_VOLTAGE", name: "Termination", description: "Termination and connector types", displayOrder: 4 },
  { tradeType: "SOLAR", name: "Panel Type", description: "Solar panel types", displayOrder: 1 },
  { tradeType: "SOLAR", name: "Mounting", description: "Mounting system types", displayOrder: 2 },
  { tradeType: "SOLAR", name: "Inverter", description: "Inverter types", displayOrder: 3 },
  { tradeType: "SOLAR", name: "System Size", description: "System capacity categories", displayOrder: 4 },
  { tradeType: "WATERPROOFING", name: "Material", description: "Waterproofing material types", displayOrder: 1 },
  { tradeType: "WATERPROOFING", name: "Application", description: "Application methods", displayOrder: 2 },
  { tradeType: "WATERPROOFING", name: "Location", description: "Installation locations (below/above grade)", displayOrder: 3 },
  { tradeType: "WATERPROOFING", name: "Drainage", description: "Drainage system types", displayOrder: 4 },
  { tradeType: "EARTHWORK", name: "Soil Classification", description: "Soil type classifications", displayOrder: 1 },
  { tradeType: "EARTHWORK", name: "Depth", description: "Excavation depth categories", displayOrder: 2 },
  { tradeType: "EARTHWORK", name: "Equipment", description: "Equipment types required", displayOrder: 3 },
  { tradeType: "EARTHWORK", name: "Shoring", description: "Shoring and support requirements", displayOrder: 4 },
  { tradeType: "ASPHALT_PAVING", name: "Mix Type", description: "Asphalt mix types", displayOrder: 1 },
  { tradeType: "ASPHALT_PAVING", name: "Thickness", description: "Paving thickness specs", displayOrder: 2 },
  { tradeType: "ASPHALT_PAVING", name: "Base Prep", description: "Base preparation levels", displayOrder: 3 },
  { tradeType: "ASPHALT_PAVING", name: "Traffic Load", description: "Traffic load classifications", displayOrder: 4 },
];

async function seedCoreTradeModifierCategories() {
  logInfo("Seeding core trade modifier categories...");
  let inserted = 0;
  let skipped = 0;

  for (const cat of coreTradeModifierCategories) {
    const existing = await db.select()
      .from(masterModifierCategories)
      .where(and(
        eq(masterModifierCategories.tradeType, cat.tradeType as any),
        eq(masterModifierCategories.name, cat.name)
      ))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(masterModifierCategories).values({
      tradeType: cat.tradeType as any,
      name: cat.name,
      description: cat.description,
      displayOrder: cat.displayOrder,
      isActive: true,
    });
    inserted++;
  }

  logInfo(`Core modifier categories: ${inserted} inserted, ${skipped} skipped`);
  return { inserted, skipped };
}

// ============================================================
// TRADE-SPECIFIC SCOPE WORK TYPES (for scope standardization auto-seeding)
// ============================================================

const tradeWorkTypeTemplates: Record<string, { categories: { name: string; workTypes: { name: string; code: string; requiresDimensions?: boolean; dimensionLabel?: string }[] }[] }> = {
  CONCRETE: {
    categories: [
      { name: "Sidewalk", workTypes: [
        { name: '4" Sidewalk', code: "sidewalk_4in" },
        { name: '5" Sidewalk', code: "sidewalk_5in" },
        { name: '6" Sidewalk', code: "sidewalk_6in" },
      ]},
      { name: "Driveway", workTypes: [
        { name: '4" Driveway', code: "driveway_4in" },
        { name: '6" Driveway', code: "driveway_6in" },
        { name: '8" Driveway (Heavy Duty)', code: "driveway_8in" },
      ]},
      { name: "Curb & Gutter", workTypes: [
        { name: "Standard Curb & Gutter", code: "curb_gutter_std" },
        { name: "Rolled Curb", code: "curb_rolled" },
        { name: "Mountable Curb", code: "curb_mountable" },
        { name: "Barrier Curb", code: "curb_barrier" },
      ]},
      { name: "Slab on Grade", workTypes: [
        { name: '4" Slab on Grade', code: "slab_4in" },
        { name: '6" Slab on Grade', code: "slab_6in" },
        { name: '8" Slab on Grade', code: "slab_8in" },
      ]},
      { name: "Foundation", workTypes: [
        { name: "Continuous Footing", code: "footing_continuous", requiresDimensions: true, dimensionLabel: "L x W x D" },
        { name: "Spread Footing", code: "footing_spread", requiresDimensions: true, dimensionLabel: "L x W x D" },
        { name: "Grade Beam", code: "grade_beam", requiresDimensions: true, dimensionLabel: "L x W x D" },
        { name: "Pier/Caisson", code: "pier_caisson", requiresDimensions: true, dimensionLabel: "Diameter x Depth" },
      ]},
      { name: "Wall", workTypes: [
        { name: "Retaining Wall", code: "wall_retaining", requiresDimensions: true, dimensionLabel: "L x H x Thickness" },
        { name: "Foundation Wall", code: "wall_foundation", requiresDimensions: true, dimensionLabel: "L x H x Thickness" },
        { name: "Stem Wall", code: "wall_stem", requiresDimensions: true, dimensionLabel: "L x H x Thickness" },
      ]},
      { name: "Flatwork", workTypes: [
        { name: "Patio Slab", code: "flatwork_patio" },
        { name: "Loading Dock", code: "flatwork_loading_dock" },
        { name: "Equipment Pad", code: "flatwork_equip_pad" },
      ]},
    ]
  },
  GENERAL_CONTRACTOR: {
    categories: [
      { name: "Site Work", workTypes: [
        { name: "Site Clearing", code: "gc_site_clearing" },
        { name: "Grading", code: "gc_grading" },
        { name: "Excavation", code: "gc_excavation" },
      ]},
      { name: "Concrete", workTypes: [
        { name: "Foundation", code: "gc_foundation" },
        { name: "Flatwork", code: "gc_flatwork" },
        { name: "Structural Concrete", code: "gc_structural_concrete" },
      ]},
      { name: "Framing", workTypes: [
        { name: "Wood Framing", code: "gc_wood_framing" },
        { name: "Steel Framing", code: "gc_steel_framing" },
      ]},
      { name: "Finishes", workTypes: [
        { name: "Drywall", code: "gc_drywall" },
        { name: "Painting", code: "gc_painting" },
        { name: "Flooring", code: "gc_flooring" },
        { name: "Tile", code: "gc_tile" },
      ]},
      { name: "MEP", workTypes: [
        { name: "Electrical Rough-in", code: "gc_electrical_rough" },
        { name: "Plumbing Rough-in", code: "gc_plumbing_rough" },
        { name: "HVAC Installation", code: "gc_hvac_install" },
      ]},
    ]
  },
  ELECTRICAL: {
    categories: [
      { name: "Conduit", workTypes: [
        { name: 'EMT Conduit - 1/2"', code: "conduit_emt_half" },
        { name: 'EMT Conduit - 3/4"', code: "conduit_emt_3qtr" },
        { name: 'EMT Conduit - 1"', code: "conduit_emt_1in" },
        { name: "Rigid Conduit", code: "conduit_rigid" },
        { name: "PVC Conduit", code: "conduit_pvc" },
      ]},
      { name: "Wire Pull", workTypes: [
        { name: "#12 Wire Pull", code: "wire_12" },
        { name: "#10 Wire Pull", code: "wire_10" },
        { name: "#8 Wire Pull", code: "wire_8" },
        { name: "#6 Wire Pull", code: "wire_6" },
      ]},
      { name: "Devices", workTypes: [
        { name: "Receptacle Installation", code: "device_receptacle" },
        { name: "Switch Installation", code: "device_switch" },
        { name: "GFCI Receptacle", code: "device_gfci" },
      ]},
      { name: "Panels & Distribution", workTypes: [
        { name: "Panel Installation", code: "panel_install" },
        { name: "Transformer Installation", code: "transformer_install" },
        { name: "Disconnect Installation", code: "disconnect_install" },
      ]},
      { name: "Lighting", workTypes: [
        { name: "LED Fixture Install", code: "light_led" },
        { name: "Recessed Light Install", code: "light_recessed" },
        { name: "Exterior Light Install", code: "light_exterior" },
      ]},
    ]
  },
  PLUMBING: {
    categories: [
      { name: "Pipe - Supply", workTypes: [
        { name: 'Copper Pipe - 1/2"', code: "pipe_copper_half" },
        { name: 'Copper Pipe - 3/4"', code: "pipe_copper_3qtr" },
        { name: 'PEX Pipe - 1/2"', code: "pipe_pex_half" },
        { name: 'PEX Pipe - 3/4"', code: "pipe_pex_3qtr" },
      ]},
      { name: "Pipe - Drain", workTypes: [
        { name: 'PVC DWV - 2"', code: "pipe_dwv_2in" },
        { name: 'PVC DWV - 3"', code: "pipe_dwv_3in" },
        { name: 'PVC DWV - 4"', code: "pipe_dwv_4in" },
        { name: 'Cast Iron - 4"', code: "pipe_ci_4in" },
      ]},
      { name: "Fixtures", workTypes: [
        { name: "Toilet Installation", code: "fixture_toilet" },
        { name: "Sink Installation", code: "fixture_sink" },
        { name: "Shower Valve", code: "fixture_shower" },
        { name: "Water Heater", code: "fixture_water_heater" },
      ]},
    ]
  },
  HVAC: {
    categories: [
      { name: "Ductwork", workTypes: [
        { name: "Sheet Metal Duct", code: "duct_sheet_metal" },
        { name: "Flex Duct", code: "duct_flex" },
        { name: "Spiral Duct", code: "duct_spiral" },
      ]},
      { name: "Equipment", workTypes: [
        { name: "RTU Installation", code: "hvac_rtu" },
        { name: "Split System Install", code: "hvac_split" },
        { name: "Mini Split Install", code: "hvac_mini_split" },
        { name: "Boiler Install", code: "hvac_boiler" },
      ]},
      { name: "Controls", workTypes: [
        { name: "Thermostat Install", code: "hvac_thermostat" },
        { name: "BAS Controls", code: "hvac_bas" },
      ]},
    ]
  },
  ROOFING: {
    categories: [
      { name: "Commercial", workTypes: [
        { name: "TPO Single-Ply", code: "roof_tpo" },
        { name: "EPDM Single-Ply", code: "roof_epdm" },
        { name: "Built-Up Roofing", code: "roof_bur" },
        { name: "Modified Bitumen", code: "roof_mod_bit" },
      ]},
      { name: "Residential", workTypes: [
        { name: "Asphalt Shingle", code: "roof_shingle" },
        { name: "Metal Standing Seam", code: "roof_metal_ss" },
        { name: "Clay/Concrete Tile", code: "roof_tile" },
      ]},
      { name: "Accessories", workTypes: [
        { name: "Flashing", code: "roof_flashing" },
        { name: "Gutter Installation", code: "roof_gutter" },
        { name: "Skylights", code: "roof_skylight" },
      ]},
    ]
  },
  PAINTING: {
    categories: [
      { name: "Interior", workTypes: [
        { name: "Wall Paint - Flat", code: "paint_wall_flat" },
        { name: "Wall Paint - Eggshell", code: "paint_wall_eggshell" },
        { name: "Trim Paint", code: "paint_trim" },
        { name: "Ceiling Paint", code: "paint_ceiling" },
      ]},
      { name: "Exterior", workTypes: [
        { name: "Exterior Wall Paint", code: "paint_ext_wall" },
        { name: "Exterior Trim", code: "paint_ext_trim" },
        { name: "Stucco Coating", code: "paint_stucco" },
      ]},
      { name: "Specialty", workTypes: [
        { name: "Epoxy Floor Coating", code: "paint_epoxy" },
        { name: "Fireproofing", code: "paint_fireproof" },
        { name: "Industrial Coating", code: "paint_industrial" },
      ]},
    ]
  },
  MASONRY: {
    categories: [
      { name: "Block", workTypes: [
        { name: '8" CMU Block', code: "masonry_cmu_8" },
        { name: '12" CMU Block', code: "masonry_cmu_12" },
        { name: "Split Face Block", code: "masonry_split_face" },
      ]},
      { name: "Brick", workTypes: [
        { name: "Standard Brick", code: "masonry_brick_std" },
        { name: "Thin Brick Veneer", code: "masonry_thin_brick" },
        { name: "Fire Brick", code: "masonry_fire_brick" },
      ]},
      { name: "Stone", workTypes: [
        { name: "Natural Stone Veneer", code: "masonry_stone_veneer" },
        { name: "Cultured Stone", code: "masonry_cultured" },
      ]},
    ]
  },
  LANDSCAPING: {
    categories: [
      { name: "Softscape", workTypes: [
        { name: "Sod Installation", code: "landscape_sod" },
        { name: "Seeding", code: "landscape_seed" },
        { name: "Tree Planting", code: "landscape_tree" },
        { name: "Shrub Planting", code: "landscape_shrub" },
        { name: "Mulch Installation", code: "landscape_mulch" },
      ]},
      { name: "Hardscape", workTypes: [
        { name: "Paver Installation", code: "landscape_paver" },
        { name: "Retaining Wall", code: "landscape_retaining" },
        { name: "Flagstone Patio", code: "landscape_flagstone" },
      ]},
      { name: "Irrigation", workTypes: [
        { name: "Drip System", code: "landscape_drip" },
        { name: "Sprinkler System", code: "landscape_sprinkler" },
        { name: "Controller Install", code: "landscape_controller" },
      ]},
    ]
  },
  FLOORING: {
    categories: [
      { name: "Hard Surface", workTypes: [
        { name: "Ceramic Tile", code: "floor_ceramic" },
        { name: "Porcelain Tile", code: "floor_porcelain" },
        { name: "Natural Stone", code: "floor_stone" },
        { name: "Hardwood", code: "floor_hardwood" },
      ]},
      { name: "Resilient", workTypes: [
        { name: "LVT/LVP", code: "floor_lvt" },
        { name: "Sheet Vinyl", code: "floor_vinyl" },
        { name: "Rubber Flooring", code: "floor_rubber" },
      ]},
      { name: "Carpet", workTypes: [
        { name: "Carpet Tile", code: "floor_carpet_tile" },
        { name: "Broadloom Carpet", code: "floor_broadloom" },
      ]},
    ]
  },
  DEMOLITION: {
    categories: [
      { name: "Structural", workTypes: [
        { name: "Building Demolition", code: "demo_building" },
        { name: "Wall Demolition", code: "demo_wall" },
        { name: "Slab Demolition", code: "demo_slab" },
      ]},
      { name: "Selective", workTypes: [
        { name: "Interior Strip-out", code: "demo_strip" },
        { name: "Ceiling Removal", code: "demo_ceiling" },
        { name: "Floor Removal", code: "demo_floor" },
      ]},
      { name: "Disposal", workTypes: [
        { name: "Debris Hauling", code: "demo_haul" },
        { name: "Hazmat Removal", code: "demo_hazmat" },
      ]},
    ]
  },
  DRYWALL: {
    categories: [
      { name: "Board", workTypes: [
        { name: '1/2" Standard Drywall', code: "drywall_half_std" },
        { name: '5/8" Type X Drywall', code: "drywall_5_8_x" },
        { name: "Moisture Resistant Board", code: "drywall_mr" },
        { name: "Abuse Resistant Board", code: "drywall_abuse" },
      ]},
      { name: "Finishing", workTypes: [
        { name: "Level 3 Finish", code: "drywall_finish_l3" },
        { name: "Level 4 Finish", code: "drywall_finish_l4" },
        { name: "Level 5 Finish", code: "drywall_finish_l5" },
      ]},
      { name: "Framing", workTypes: [
        { name: "Metal Stud Framing", code: "drywall_metal_stud" },
        { name: "Furring Channel", code: "drywall_furring" },
      ]},
    ]
  },
  CARPENTRY: {
    categories: [
      { name: "Rough", workTypes: [
        { name: "Wall Framing", code: "carp_wall_frame" },
        { name: "Floor Framing", code: "carp_floor_frame" },
        { name: "Roof Framing", code: "carp_roof_frame" },
        { name: "Sheathing", code: "carp_sheathing" },
      ]},
      { name: "Finish", workTypes: [
        { name: "Door Installation", code: "carp_door" },
        { name: "Trim/Millwork", code: "carp_trim" },
        { name: "Cabinet Installation", code: "carp_cabinet" },
        { name: "Countertop Install", code: "carp_countertop" },
      ]},
    ]
  },
  STEEL_ERECTION: {
    categories: [
      { name: "Structural", workTypes: [
        { name: "Column Erection", code: "steel_column" },
        { name: "Beam Erection", code: "steel_beam" },
        { name: "Joist Installation", code: "steel_joist" },
        { name: "Decking", code: "steel_deck" },
      ]},
      { name: "Misc Metals", workTypes: [
        { name: "Handrail", code: "steel_handrail" },
        { name: "Stairs", code: "steel_stairs" },
        { name: "Lintels", code: "steel_lintel" },
      ]},
    ]
  },
  EARTHWORK: {
    categories: [
      { name: "Excavation", workTypes: [
        { name: "Mass Excavation", code: "earth_mass_exc" },
        { name: "Trench Excavation", code: "earth_trench" },
        { name: "Rock Excavation", code: "earth_rock" },
      ]},
      { name: "Fill & Compaction", workTypes: [
        { name: "Structural Fill", code: "earth_struct_fill" },
        { name: "Backfill", code: "earth_backfill" },
        { name: "Compaction", code: "earth_compaction" },
      ]},
      { name: "Grading", workTypes: [
        { name: "Fine Grading", code: "earth_fine_grade" },
        { name: "Rough Grading", code: "earth_rough_grade" },
      ]},
    ]
  },
  ASPHALT_PAVING: {
    categories: [
      { name: "Paving", workTypes: [
        { name: "Hot Mix Asphalt - 2 inch", code: "asphalt_hma_2" },
        { name: "Hot Mix Asphalt - 3 inch", code: "asphalt_hma_3" },
        { name: "Hot Mix Asphalt - 4 inch", code: "asphalt_hma_4" },
      ]},
      { name: "Base", workTypes: [
        { name: "Aggregate Base", code: "asphalt_agg_base" },
        { name: "Lime Treated Base", code: "asphalt_lime_base" },
      ]},
      { name: "Repair", workTypes: [
        { name: "Mill & Overlay", code: "asphalt_mill_overlay" },
        { name: "Crack Seal", code: "asphalt_crack_seal" },
        { name: "Seal Coat", code: "asphalt_seal_coat" },
        { name: "Striping", code: "asphalt_striping" },
      ]},
    ]
  },
  GLAZING: {
    categories: [
      { name: "Storefront", workTypes: [
        { name: "Aluminum Storefront", code: "glaz_alum_store" },
        { name: "Steel Storefront", code: "glaz_steel_store" },
      ]},
      { name: "Curtain Wall", workTypes: [
        { name: "Stick-Built Curtain Wall", code: "glaz_stick_cw" },
        { name: "Unitized Curtain Wall", code: "glaz_unitized_cw" },
      ]},
      { name: "Windows", workTypes: [
        { name: "Fixed Window", code: "glaz_fixed_win" },
        { name: "Operable Window", code: "glaz_oper_win" },
        { name: "Skylight", code: "glaz_skylight" },
      ]},
      { name: "Doors", workTypes: [
        { name: "Glass Entry Door", code: "glaz_entry_door" },
        { name: "Automatic Sliding Door", code: "glaz_auto_slide" },
        { name: "Revolving Door", code: "glaz_revolving" },
      ]},
    ]
  },
  INSULATION: {
    categories: [
      { name: "Batt Insulation", workTypes: [
        { name: "Fiberglass Batt R-13", code: "insul_batt_r13" },
        { name: "Fiberglass Batt R-19", code: "insul_batt_r19" },
        { name: "Fiberglass Batt R-30", code: "insul_batt_r30" },
        { name: "Mineral Wool Batt", code: "insul_batt_mineral" },
      ]},
      { name: "Spray Foam", workTypes: [
        { name: "Open Cell Spray Foam", code: "insul_spray_open" },
        { name: "Closed Cell Spray Foam", code: "insul_spray_closed" },
      ]},
      { name: "Rigid Board", workTypes: [
        { name: "Polyiso Board", code: "insul_polyiso" },
        { name: "XPS Board", code: "insul_xps" },
        { name: "EPS Board", code: "insul_eps" },
      ]},
      { name: "Mechanical Insulation", workTypes: [
        { name: "Pipe Insulation", code: "insul_pipe" },
        { name: "Duct Wrap", code: "insul_duct_wrap" },
        { name: "Equipment Insulation", code: "insul_equipment" },
      ]},
    ]
  },
  FIRE_PROTECTION: {
    categories: [
      { name: "Sprinkler Systems", workTypes: [
        { name: "Wet Pipe System", code: "fire_wet_pipe" },
        { name: "Dry Pipe System", code: "fire_dry_pipe" },
        { name: "Pre-Action System", code: "fire_pre_action" },
        { name: "Deluge System", code: "fire_deluge" },
      ]},
      { name: "Standpipe", workTypes: [
        { name: "Class I Standpipe", code: "fire_standpipe_1" },
        { name: "Class II Standpipe", code: "fire_standpipe_2" },
        { name: "Class III Standpipe", code: "fire_standpipe_3" },
      ]},
      { name: "Fire Alarm", workTypes: [
        { name: "Detection Device Install", code: "fire_detect" },
        { name: "Notification Device Install", code: "fire_notify" },
        { name: "Panel Installation", code: "fire_panel" },
      ]},
    ]
  },
  LOW_VOLTAGE: {
    categories: [
      { name: "Data/Telecom", workTypes: [
        { name: "Cat6 Cable Pull", code: "lv_cat6" },
        { name: "Cat6A Cable Pull", code: "lv_cat6a" },
        { name: "Fiber Optic Cable", code: "lv_fiber" },
        { name: "Data Jack Termination", code: "lv_jack" },
      ]},
      { name: "Security", workTypes: [
        { name: "Camera Installation", code: "lv_camera" },
        { name: "Access Control Reader", code: "lv_access" },
        { name: "Intrusion Panel", code: "lv_intrusion" },
      ]},
      { name: "Audio/Visual", workTypes: [
        { name: "Speaker Installation", code: "lv_speaker" },
        { name: "Display Mount", code: "lv_display" },
        { name: "AV Rack Build", code: "lv_rack" },
      ]},
    ]
  },
  SOLAR: {
    categories: [
      { name: "Panels", workTypes: [
        { name: "Monocrystalline Panel Install", code: "solar_mono" },
        { name: "Polycrystalline Panel Install", code: "solar_poly" },
        { name: "Thin Film Panel Install", code: "solar_thin" },
      ]},
      { name: "Mounting", workTypes: [
        { name: "Roof Mount (Flush)", code: "solar_roof_flush" },
        { name: "Roof Mount (Tilted)", code: "solar_roof_tilt" },
        { name: "Ground Mount", code: "solar_ground" },
        { name: "Carport Mount", code: "solar_carport" },
      ]},
      { name: "Electrical", workTypes: [
        { name: "String Inverter Install", code: "solar_inverter_str" },
        { name: "Micro Inverter Install", code: "solar_inverter_micro" },
        { name: "Battery Storage Install", code: "solar_battery" },
      ]},
    ]
  },
  WATERPROOFING: {
    categories: [
      { name: "Below Grade", workTypes: [
        { name: "Sheet Membrane", code: "wtrpf_sheet_mem" },
        { name: "Fluid Applied Membrane", code: "wtrpf_fluid_mem" },
        { name: "Bentonite Panels", code: "wtrpf_bentonite" },
      ]},
      { name: "Above Grade", workTypes: [
        { name: "Air Barrier", code: "wtrpf_air_barrier" },
        { name: "Vapor Barrier", code: "wtrpf_vapor" },
        { name: "Traffic Coating", code: "wtrpf_traffic" },
      ]},
      { name: "Drainage", workTypes: [
        { name: "Drain Board", code: "wtrpf_drain_board" },
        { name: "French Drain", code: "wtrpf_french_drain" },
        { name: "Sump System", code: "wtrpf_sump" },
      ]},
    ]
  },
};

const tradeModifierTemplates: Record<string, { categories: { name: string; modifiers: { name: string; code: string }[] }[] }> = {
  CONCRETE: {
    categories: [
      { name: "Reinforcement", modifiers: [
        { name: "No Reinforcement", code: "reinf_none" },
        { name: "Rebar (#4)", code: "reinf_rebar_4" },
        { name: "Rebar (#5)", code: "reinf_rebar_5" },
        { name: "Wire Mesh (6x6 W1.4)", code: "reinf_mesh_6x6" },
        { name: "Fiber Mesh", code: "reinf_fiber" },
      ]},
      { name: "Mix Type", modifiers: [
        { name: "3000 PSI", code: "mix_3000" },
        { name: "4000 PSI", code: "mix_4000" },
        { name: "5000 PSI", code: "mix_5000" },
        { name: "High Early", code: "mix_high_early" },
        { name: "Flowable Fill", code: "mix_flowable" },
      ]},
      { name: "Finish Type", modifiers: [
        { name: "Broom Finish", code: "finish_broom" },
        { name: "Smooth/Steel Trowel", code: "finish_smooth" },
        { name: "Exposed Aggregate", code: "finish_exposed" },
        { name: "Stamped", code: "finish_stamped" },
        { name: "Colored", code: "finish_colored" },
      ]},
      { name: "Thickness", modifiers: [
        { name: '4"', code: "thick_4" },
        { name: '5"', code: "thick_5" },
        { name: '6"', code: "thick_6" },
        { name: '8"', code: "thick_8" },
        { name: '10"', code: "thick_10" },
        { name: '12"', code: "thick_12" },
      ]},
    ]
  },
  GENERAL_CONTRACTOR: {
    categories: [
      { name: "Quality Level", modifiers: [
        { name: "Standard", code: "gc_quality_std" },
        { name: "Premium", code: "gc_quality_premium" },
        { name: "Custom/High-End", code: "gc_quality_custom" },
      ]},
      { name: "Project Phase", modifiers: [
        { name: "Pre-Construction", code: "gc_phase_precon" },
        { name: "Rough-In", code: "gc_phase_rough" },
        { name: "Finish", code: "gc_phase_finish" },
        { name: "Punch List", code: "gc_phase_punch" },
      ]},
    ]
  },
  ELECTRICAL: {
    categories: [
      { name: "Conduit Type", modifiers: [
        { name: "EMT", code: "elec_conduit_emt" },
        { name: "Rigid", code: "elec_conduit_rigid" },
        { name: "PVC", code: "elec_conduit_pvc" },
        { name: "Flex", code: "elec_conduit_flex" },
      ]},
      { name: "Voltage", modifiers: [
        { name: "120V", code: "elec_120v" },
        { name: "208V", code: "elec_208v" },
        { name: "277V", code: "elec_277v" },
        { name: "480V", code: "elec_480v" },
      ]},
    ]
  },
  PLUMBING: {
    categories: [
      { name: "Pipe Material", modifiers: [
        { name: "Copper", code: "plumb_copper" },
        { name: "PEX", code: "plumb_pex" },
        { name: "PVC", code: "plumb_pvc" },
        { name: "Cast Iron", code: "plumb_cast_iron" },
        { name: "CPVC", code: "plumb_cpvc" },
      ]},
      { name: "Pipe Size", modifiers: [
        { name: '1/2"', code: "plumb_half" },
        { name: '3/4"', code: "plumb_3qtr" },
        { name: '1"', code: "plumb_1in" },
        { name: '2"', code: "plumb_2in" },
        { name: '3"', code: "plumb_3in" },
        { name: '4"', code: "plumb_4in" },
      ]},
    ]
  },
  HVAC: {
    categories: [
      { name: "System Type", modifiers: [
        { name: "Central Air", code: "hvac_central" },
        { name: "Split System", code: "hvac_split_sys" },
        { name: "VRF", code: "hvac_vrf" },
        { name: "Package Unit", code: "hvac_package" },
      ]},
      { name: "Duct Material", modifiers: [
        { name: "Sheet Metal", code: "hvac_duct_metal" },
        { name: "Flex Duct", code: "hvac_duct_flex" },
        { name: "Fiberglass", code: "hvac_duct_fiber" },
      ]},
    ]
  },
  ROOFING: {
    categories: [
      { name: "Roofing Material", modifiers: [
        { name: "TPO 60 mil", code: "roof_tpo_60" },
        { name: "TPO 80 mil", code: "roof_tpo_80" },
        { name: "EPDM 45 mil", code: "roof_epdm_45" },
        { name: "EPDM 60 mil", code: "roof_epdm_60" },
        { name: "Architectural Shingle", code: "roof_arch_shingle" },
      ]},
      { name: "Roof Insulation", modifiers: [
        { name: "R-20 Polyiso", code: "roof_r20" },
        { name: "R-30 Polyiso", code: "roof_r30" },
        { name: "R-38 Polyiso", code: "roof_r38" },
      ]},
    ]
  },
  MASONRY: {
    categories: [
      { name: "Masonry Material", modifiers: [
        { name: "Standard CMU", code: "mason_cmu_std" },
        { name: "Lightweight CMU", code: "mason_cmu_light" },
        { name: "Clay Brick", code: "mason_clay" },
      ]},
      { name: "Mortar Type", modifiers: [
        { name: "Type S Mortar", code: "mason_mortar_s" },
        { name: "Type N Mortar", code: "mason_mortar_n" },
        { name: "Type M Mortar", code: "mason_mortar_m" },
      ]},
    ]
  },
  LANDSCAPING: {
    categories: [
      { name: "Plant Size", modifiers: [
        { name: '1 Gallon', code: "land_1gal" },
        { name: '5 Gallon', code: "land_5gal" },
        { name: '15 Gallon', code: "land_15gal" },
        { name: '24" Box', code: "land_24box" },
      ]},
      { name: "Soil Type", modifiers: [
        { name: "Topsoil", code: "land_topsoil" },
        { name: "Amended Soil", code: "land_amended" },
        { name: "Decomposed Granite", code: "land_dg" },
      ]},
    ]
  },
  FLOORING: {
    categories: [
      { name: "Flooring Material Grade", modifiers: [
        { name: "Standard Grade", code: "floor_grade_std" },
        { name: "Premium Grade", code: "floor_grade_prem" },
        { name: "Commercial Grade", code: "floor_grade_comm" },
      ]},
      { name: "Subfloor Prep Level", modifiers: [
        { name: "No Prep Required", code: "floor_prep_none" },
        { name: "Level 1 - Light Prep", code: "floor_prep_l1" },
        { name: "Level 2 - Self-Leveler", code: "floor_prep_l2" },
        { name: "Level 3 - Full Prep", code: "floor_prep_l3" },
      ]},
    ]
  },
  DEMOLITION: {
    categories: [
      { name: "Demolition Method", modifiers: [
        { name: "Mechanical", code: "demo_mech" },
        { name: "Manual", code: "demo_manual" },
        { name: "Controlled Explosive", code: "demo_explosive" },
      ]},
      { name: "Hazmat Level", modifiers: [
        { name: "No Hazmat", code: "demo_haz_none" },
        { name: "Asbestos Abatement", code: "demo_haz_asbestos" },
        { name: "Lead Paint Abatement", code: "demo_haz_lead" },
      ]},
    ]
  },
  DRYWALL: {
    categories: [
      { name: "Board Type", modifiers: [
        { name: "Standard Gypsum", code: "dw_std_gyp" },
        { name: "Type X Fire Rated", code: "dw_type_x" },
        { name: "Moisture Resistant", code: "dw_mr" },
        { name: "Abuse Resistant", code: "dw_abuse" },
      ]},
      { name: "Finish Level", modifiers: [
        { name: "Level 3", code: "dw_finish_l3" },
        { name: "Level 4", code: "dw_finish_l4" },
        { name: "Level 5", code: "dw_finish_l5" },
      ]},
    ]
  },
  CARPENTRY: {
    categories: [
      { name: "Lumber Grade", modifiers: [
        { name: "Standard/Utility", code: "carp_grade_std" },
        { name: "#1 Grade", code: "carp_grade_1" },
        { name: "#2 Grade", code: "carp_grade_2" },
        { name: "Select Structural", code: "carp_grade_sel" },
      ]},
      { name: "Stud Spacing", modifiers: [
        { name: '16" O.C.', code: "carp_16oc" },
        { name: '24" O.C.', code: "carp_24oc" },
        { name: '12" O.C.', code: "carp_12oc" },
      ]},
    ]
  },
  STEEL_ERECTION: {
    categories: [
      { name: "Steel Grade", modifiers: [
        { name: "A36", code: "steel_a36" },
        { name: "A992", code: "steel_a992" },
        { name: "A500", code: "steel_a500" },
      ]},
      { name: "Steel Connection Type", modifiers: [
        { name: "Bolted", code: "steel_conn_bolt" },
        { name: "Welded", code: "steel_conn_weld" },
        { name: "Moment", code: "steel_conn_moment" },
      ]},
    ]
  },
  EARTHWORK: {
    categories: [
      { name: "Soil Classification", modifiers: [
        { name: "Type A Soil", code: "earth_soil_a" },
        { name: "Type B Soil", code: "earth_soil_b" },
        { name: "Type C Soil", code: "earth_soil_c" },
        { name: "Rock", code: "earth_rock_class" },
      ]},
      { name: "Excavation Depth", modifiers: [
        { name: "0-4 ft", code: "earth_depth_4" },
        { name: "4-8 ft", code: "earth_depth_8" },
        { name: "8-16 ft", code: "earth_depth_16" },
        { name: "16+ ft", code: "earth_depth_16plus" },
      ]},
    ]
  },
  ASPHALT_PAVING: {
    categories: [
      { name: "Asphalt Mix Type", modifiers: [
        { name: "Type B", code: "asph_mix_b" },
        { name: "Type C", code: "asph_mix_c" },
        { name: "Type D", code: "asph_mix_d" },
        { name: "SMA", code: "asph_mix_sma" },
      ]},
      { name: "Traffic Load Class", modifiers: [
        { name: "Light Duty", code: "asph_load_light" },
        { name: "Medium Duty", code: "asph_load_med" },
        { name: "Heavy Duty", code: "asph_load_heavy" },
      ]},
    ]
  },
  GLAZING: {
    categories: [
      { name: "Glass Type", modifiers: [
        { name: "Clear Tempered", code: "glaz_clear_temp" },
        { name: "Low-E Insulated", code: "glaz_low_e" },
        { name: "Laminated", code: "glaz_laminated" },
        { name: "Spandrel", code: "glaz_spandrel" },
      ]},
      { name: "Frame Material", modifiers: [
        { name: "Aluminum", code: "glaz_frame_alum" },
        { name: "Steel", code: "glaz_frame_steel" },
        { name: "Wood Clad", code: "glaz_frame_wood" },
      ]},
    ]
  },
  INSULATION: {
    categories: [
      { name: "Insulation R-Value", modifiers: [
        { name: "R-13", code: "insul_r13" },
        { name: "R-19", code: "insul_r19" },
        { name: "R-30", code: "insul_r30" },
        { name: "R-38", code: "insul_r38" },
        { name: "R-49", code: "insul_r49" },
      ]},
      { name: "Insulation Application", modifiers: [
        { name: "Wall Cavity", code: "insul_app_wall" },
        { name: "Attic/Ceiling", code: "insul_app_attic" },
        { name: "Pipe/Mechanical", code: "insul_app_pipe" },
        { name: "Foundation", code: "insul_app_found" },
      ]},
    ]
  },
  FIRE_PROTECTION: {
    categories: [
      { name: "Hazard Class", modifiers: [
        { name: "Light Hazard", code: "fire_haz_light" },
        { name: "Ordinary Hazard Group 1", code: "fire_haz_oh1" },
        { name: "Ordinary Hazard Group 2", code: "fire_haz_oh2" },
        { name: "Extra Hazard", code: "fire_haz_extra" },
      ]},
      { name: "Sprinkler Pipe", modifiers: [
        { name: "Black Steel", code: "fire_pipe_black" },
        { name: "Galvanized", code: "fire_pipe_galv" },
        { name: "CPVC", code: "fire_pipe_cpvc" },
      ]},
    ]
  },
  LOW_VOLTAGE: {
    categories: [
      { name: "Cable Type", modifiers: [
        { name: "Cat5e", code: "lv_cable_cat5e" },
        { name: "Cat6", code: "lv_cable_cat6" },
        { name: "Cat6A", code: "lv_cable_cat6a" },
        { name: "Single Mode Fiber", code: "lv_cable_sm_fiber" },
        { name: "Multi Mode Fiber", code: "lv_cable_mm_fiber" },
      ]},
      { name: "Pathway Type", modifiers: [
        { name: "J-Hook", code: "lv_path_jhook" },
        { name: "Cable Tray", code: "lv_path_tray" },
        { name: "Conduit", code: "lv_path_conduit" },
      ]},
    ]
  },
  SOLAR: {
    categories: [
      { name: "Panel Type", modifiers: [
        { name: "Monocrystalline", code: "solar_mod_mono" },
        { name: "Polycrystalline", code: "solar_mod_poly" },
        { name: "Bifacial", code: "solar_mod_bifacial" },
      ]},
      { name: "Mounting Type", modifiers: [
        { name: "Flush Mount", code: "solar_mount_flush" },
        { name: "Tilt Mount", code: "solar_mount_tilt" },
        { name: "Ground Mount", code: "solar_mount_ground" },
        { name: "Ballasted", code: "solar_mount_ballast" },
      ]},
    ]
  },
  WATERPROOFING: {
    categories: [
      { name: "Waterproofing Material", modifiers: [
        { name: "Sheet Membrane", code: "wtrpf_mod_sheet" },
        { name: "Fluid Applied", code: "wtrpf_mod_fluid" },
        { name: "Cementitious", code: "wtrpf_mod_cement" },
        { name: "Bentonite", code: "wtrpf_mod_benton" },
      ]},
      { name: "Application Location", modifiers: [
        { name: "Below Grade", code: "wtrpf_loc_below" },
        { name: "Above Grade", code: "wtrpf_loc_above" },
        { name: "Plaza Deck", code: "wtrpf_loc_plaza" },
        { name: "Wet Area", code: "wtrpf_loc_wet" },
      ]},
    ]
  },
  PAINTING: {
    categories: [
      { name: "Paint Type", modifiers: [
        { name: "Latex", code: "paint_mod_latex" },
        { name: "Alkyd/Oil", code: "paint_mod_alkyd" },
        { name: "Epoxy", code: "paint_mod_epoxy" },
        { name: "Urethane", code: "paint_mod_urethane" },
      ]},
      { name: "Paint Finish", modifiers: [
        { name: "Flat/Matte", code: "paint_mod_flat" },
        { name: "Eggshell", code: "paint_mod_eggshell" },
        { name: "Satin", code: "paint_mod_satin" },
        { name: "Semi-Gloss", code: "paint_mod_semi" },
        { name: "High Gloss", code: "paint_mod_gloss" },
      ]},
    ]
  },
};

async function seedScopeWorkTypesForTrade(tradeType: string): Promise<{ workTypeCatsInserted: number; workTypesInserted: number }> {
  const template = tradeWorkTypeTemplates[tradeType];
  if (!template) return { workTypeCatsInserted: 0, workTypesInserted: 0 };

  let workTypeCatsInserted = 0;
  let workTypesInserted = 0;

  for (let catIdx = 0; catIdx < template.categories.length; catIdx++) {
    const cat = template.categories[catIdx];

    const existing = await db.select().from(scopeWorkTypeCategories)
      .where(eq(scopeWorkTypeCategories.name, cat.name)).limit(1);

    let categoryId: string;
    if (existing.length > 0) {
      categoryId = existing[0].id;
    } else {
      const [inserted] = await db.insert(scopeWorkTypeCategories).values({
        name: cat.name,
        displayOrder: catIdx,
        isActive: true,
      }).returning();
      categoryId = inserted.id;
      workTypeCatsInserted++;
    }

    for (let wtIdx = 0; wtIdx < cat.workTypes.length; wtIdx++) {
      const wt = cat.workTypes[wtIdx];
      const existingWt = await db.select().from(scopeWorkTypes)
        .where(eq(scopeWorkTypes.code, wt.code)).limit(1);

      if (existingWt.length === 0) {
        await db.insert(scopeWorkTypes).values({
          categoryId,
          name: wt.name,
          code: wt.code,
          requiresDimensions: wt.requiresDimensions || false,
          dimensionLabel: wt.dimensionLabel || null,
          displayOrder: wtIdx,
          isActive: true,
          isCustom: false,
        });
        workTypesInserted++;
      }
    }
  }

  return { workTypeCatsInserted, workTypesInserted };
}

async function seedScopeModifiersForTrade(tradeType: string): Promise<{ modCatsInserted: number; modifiersInserted: number }> {
  const template = tradeModifierTemplates[tradeType];
  if (!template) return { modCatsInserted: 0, modifiersInserted: 0 };

  let modCatsInserted = 0;
  let modifiersInserted = 0;

  for (let catIdx = 0; catIdx < template.categories.length; catIdx++) {
    const cat = template.categories[catIdx];

    const existing = await db.select().from(scopeModifierCategories)
      .where(eq(scopeModifierCategories.name, cat.name)).limit(1);

    let categoryId: string;
    if (existing.length > 0) {
      categoryId = existing[0].id;
    } else {
      const [inserted] = await db.insert(scopeModifierCategories).values({
        name: cat.name,
        displayOrder: catIdx,
        isActive: true,
      }).returning();
      categoryId = inserted.id;
      modCatsInserted++;
    }

    for (let modIdx = 0; modIdx < cat.modifiers.length; modIdx++) {
      const mod = cat.modifiers[modIdx];
      const existingMod = await db.select().from(scopeModifiers)
        .where(eq(scopeModifiers.code, mod.code)).limit(1);

      if (existingMod.length === 0) {
        await db.insert(scopeModifiers).values({
          categoryId,
          name: mod.name,
          code: mod.code,
          displayOrder: modIdx,
          isActive: true,
          isCustom: false,
        });
        modifiersInserted++;
      }
    }
  }

  return { modCatsInserted, modifiersInserted };
}

async function seedScopeStandardizationForTrade(tradeType: string) {
  logInfo(`[ScopeSeed] Seeding scope work types and modifiers for trade: ${tradeType}`);

  const wtResult = await seedScopeWorkTypesForTrade(tradeType);
  const modResult = await seedScopeModifiersForTrade(tradeType);

  logInfo(`[ScopeSeed] Work Type Categories: ${wtResult.workTypeCatsInserted} inserted | Work Types: ${wtResult.workTypesInserted} inserted`);
  logInfo(`[ScopeSeed] Modifier Categories: ${modResult.modCatsInserted} inserted | Modifiers: ${modResult.modifiersInserted} inserted`);

  return {
    ...wtResult,
    ...modResult,
  };
}

export { 
  seedConcreteSowItems, concreteSowItems,
  seedCivilSiteSowItems, civilSiteSowItems, 
  seedStructuralBuildingSowItems, structuralBuildingSowItems,
  seedMepSpecialtySowItems, mepSpecialtySowItems,
  seedSupportServicesSowItems, supportServicesSowItems,
  seedAllNewTradeSowItems,
  seedNewTradeModifiers, newTradeModifierCategories,
  seedCoreTradeModifierCategories, coreTradeModifierCategories,
  seedScopeStandardizationForTrade, tradeWorkTypeTemplates, tradeModifierTemplates
};
