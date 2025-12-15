import { db } from "./db";
import { masterSowItems } from "@shared/schema";
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
  console.log("🌱 Seeding Civil/Site/Environmental Master SOW Items...");
  
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
  
  console.log(`✅ Civil/Site SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
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
  console.log("🏗️ Seeding Structural/Building Master SOW Items...");
  
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
  
  console.log(`✅ Structural/Building SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
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
  console.log("⚡ Seeding MEP/Specialty Master SOW Items...");
  
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
  
  console.log(`✅ MEP/Specialty SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

async function seedSupportServicesSowItems() {
  console.log("🔧 Seeding Support/Services Master SOW Items...");
  
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
  
  console.log(`✅ Support/Services SOW Items: ${inserted} inserted, ${skipped} skipped (already exist)`);
  return { inserted, skipped };
}

// Combined seed function for all new trades
async function seedAllNewTradeSowItems() {
  console.log("🚀 Seeding ALL new trade SOW items...\n");
  
  const civil = await seedCivilSiteSowItems();
  const structural = await seedStructuralBuildingSowItems();
  const mep = await seedMepSpecialtySowItems();
  const support = await seedSupportServicesSowItems();
  
  const total = {
    inserted: civil.inserted + structural.inserted + mep.inserted + support.inserted,
    skipped: civil.skipped + structural.skipped + mep.skipped + support.skipped,
  };
  
  console.log(`\n📊 TOTAL: ${total.inserted} inserted, ${total.skipped} skipped`);
  return total;
}

export { 
  seedCivilSiteSowItems, civilSiteSowItems, 
  seedStructuralBuildingSowItems, structuralBuildingSowItems,
  seedMepSpecialtySowItems, mepSpecialtySowItems,
  seedSupportServicesSowItems, supportServicesSowItems,
  seedAllNewTradeSowItems
};
