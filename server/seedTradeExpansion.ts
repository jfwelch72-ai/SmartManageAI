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

export { seedCivilSiteSowItems, civilSiteSowItems };
