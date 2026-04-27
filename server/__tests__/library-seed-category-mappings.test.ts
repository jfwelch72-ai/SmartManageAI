/**
 * Task #2071 — verify the per-trade default category mapping used by the
 * `POST /api/library-items/seed-from-onboarding` route produces tidy,
 * human-friendly category names rather than raw `group` slugs.
 */

import { describe, it, expect } from "vitest";
import {
  categoryForMaterial,
  categoryForComponent,
  isLaborComponent,
  DEFAULT_MATERIAL_GROUP_LABELS,
} from "../data/onboarding/categoryMappings";

describe("categoryForMaterial", () => {
  it("returns friendly labels for every known material group", () => {
    for (const [group, label] of Object.entries(DEFAULT_MATERIAL_GROUP_LABELS)) {
      expect(categoryForMaterial("GENERAL_CONTRACTOR", group)).toBe(label);
    }
  });

  it("renames the awkward 'concrete' group to 'Cast-In-Place Concrete'", () => {
    expect(categoryForMaterial("CONCRETE", "concrete")).toBe("Cast-In-Place Concrete");
  });

  it("renames 'reinforcing' to 'Reinforcing Steel'", () => {
    expect(categoryForMaterial("CONCRETE", "reinforcing")).toBe("Reinforcing Steel");
  });

  it("applies trade-specific overrides when provided", () => {
    expect(categoryForMaterial("ELECTRICAL", "low_voltage")).toBe("Low Voltage & Communications");
  });

  it("titlecases and humanizes unknown group slugs as a fallback", () => {
    expect(categoryForMaterial("OTHER", "concrete_misc")).toBe("Concrete Misc");
    expect(categoryForMaterial("OTHER", "01_Site_Util")).toBe("Site Util");
  });

  it("returns 'Materials' when no group is provided", () => {
    expect(categoryForMaterial("OTHER", undefined)).toBe("Materials");
    expect(categoryForMaterial(null, "")).toBe("Materials");
  });
});

describe("categoryForComponent", () => {
  it("routes formwork into a Formwork bucket", () => {
    expect(categoryForComponent("CONCRETE", "Formwork")).toBe("Formwork");
  });

  it("routes rebar into Reinforcing Steel", () => {
    expect(categoryForComponent("CONCRETE", "Rebar Install")).toBe("Reinforcing Steel");
  });

  it("uses a trade-specific labor bucket for concrete", () => {
    expect(categoryForComponent("CONCRETE", "Labor Only")).toBe("Labor — Placement & Finishing");
  });

  it("uses a trade-specific labor bucket for electrical", () => {
    expect(categoryForComponent("ELECTRICAL", "Labor Only")).toBe("Labor — Electrical Installation");
  });

  it("uses a specialty labor bucket for the OTHER catch-all trade", () => {
    // Task #2082 — the OTHER bucket previously fell back to the very generic
    // "Labor & Installation" bucket. It now uses a more descriptive label so
    // long-tail trades read as specialty work in the seeded library.
    expect(categoryForComponent("OTHER", "Labor Only")).toBe("Labor — Specialty Installation");
  });

  it("routes conduit (with bracketed variant qualifiers) into Conduit & Raceway", () => {
    expect(categoryForComponent("ELECTRICAL", "Conduit (EMT/PVC/RMC) [conduit_type:EMT]")).toBe("Conduit & Raceway");
  });

  it("routes 'Slab on Grade' variants into Cast-In-Place Concrete", () => {
    expect(
      categoryForComponent("CONCRETE", "Slab on Grade [finish_type:broom, reinforcement_type:wwf]")
    ).toBe("Cast-In-Place Concrete");
  });

  it("routes plumbing piping into the Piping bucket", () => {
    expect(categoryForComponent("PLUMBING", "Domestic Water Piping")).toBe("Piping");
    expect(categoryForComponent("PLUMBING", "Sanitary Waste & Vent")).toBe("Piping");
  });

  it("routes HVAC ductwork separately from HVAC equipment", () => {
    expect(categoryForComponent("HVAC", "Supply Ductwork")).toBe("Ductwork");
    expect(categoryForComponent("HVAC", "RTU Install")).toBe("Equipment & Refrigerant");
  });

  it("routes generic scope items into General Conditions", () => {
    expect(categoryForComponent("GENERAL_CONTRACTOR", "General Scope Item")).toBe("General Conditions");
    expect(categoryForComponent("GENERAL_CONTRACTOR", "Mobilization")).toBe("General Conditions");
  });

  it("routes 'Material Only' into the materials bucket", () => {
    expect(categoryForComponent("ELECTRICAL", "Material Only")).toBe("Materials");
  });

  it("falls back to a 'Specialty Installations' bucket when nothing matches under OTHER", () => {
    // Task #2082 — the OTHER catch-all now uses a friendlier default bucket
    // for genuinely unmatched component names instead of the raw global
    // "Components & Assemblies" placeholder.
    expect(categoryForComponent("OTHER", "Some Brand New Component")).toBe("Specialty Installations");
  });

  it("still falls back to 'Components & Assemblies' when no trade hint is provided", () => {
    expect(categoryForComponent(null, "Some Brand New Component")).toBe("Components & Assemblies");
  });
});

describe("Task #2082 — long-tail OTHER trade rules", () => {
  it("routes building-envelope air & vapor barriers into 'Air & Moisture Barriers'", () => {
    expect(categoryForComponent("OTHER", "Air/Vapor Barrier")).toBe("Air & Moisture Barriers");
  });

  it("routes envelope sealants into 'Sealants & Caulking'", () => {
    expect(categoryForComponent("OTHER", "Sealants")).toBe("Sealants & Caulking");
  });

  it("routes envelope siding into 'Siding & Cladding'", () => {
    expect(categoryForComponent("OTHER", "Siding")).toBe("Siding & Cladding");
  });

  it("routes envelope flashing into 'Flashing & Trim'", () => {
    expect(categoryForComponent("OTHER", "Flashing")).toBe("Flashing & Trim");
  });

  it("routes long-tail roofing materials into 'Roofing Assembly'", () => {
    expect(categoryForComponent("OTHER", "Roof Membrane")).toBe("Roofing Assembly");
    expect(categoryForComponent("OTHER", "Roof Insulation")).toBe("Roofing Assembly");
  });

  it("routes low-voltage cabling into 'Low Voltage & Communications'", () => {
    expect(categoryForComponent("OTHER", "Cabling")).toBe("Low Voltage & Communications");
    expect(categoryForComponent("OTHER", "Racks & Patch Panels")).toBe("Low Voltage & Communications");
  });

  it("routes low-voltage devices into a 'Devices & Trim' bucket", () => {
    expect(categoryForComponent("OTHER", "Devices")).toBe("Devices & Trim");
  });

  it("routes finish-trade flooring/base/tile/countertop names into their own buckets", () => {
    expect(categoryForComponent("OTHER", "Flooring")).toBe("Flooring");
    expect(categoryForComponent("OTHER", "Base Trim")).toBe("Base & Trim");
    expect(categoryForComponent("OTHER", "Tile")).toBe("Tile");
    expect(categoryForComponent("OTHER", "Countertop")).toBe("Countertops");
  });

  it("routes leftover sitework names into clear sitework buckets even under OTHER", () => {
    expect(categoryForComponent("OTHER", "Clearing & Grubbing")).toBe("Earthwork & Grading");
    expect(categoryForComponent("OTHER", "Trenching")).toBe("Trenching & Backfill");
    expect(categoryForComponent("OTHER", "Backfill & Compaction")).toBe("Trenching & Backfill");
    expect(categoryForComponent("OTHER", "Stone Base")).toBe("Aggregate Base");
    expect(categoryForComponent("OTHER", "Erosion Control - Silt Fence")).toBe("Erosion & Sediment Control");
    expect(categoryForComponent("OTHER", "Concrete Sidewalk")).toBe("Concrete Flatwork");
    expect(categoryForComponent("OTHER", "Fence - Chain Link")).toBe("Fencing");
  });
});

describe("Task #2082 — EARTHWORK trade configuration", () => {
  it("uses an Earthwork-specific labor bucket", () => {
    expect(categoryForComponent("EARTHWORK", "Labor Only")).toBe("Labor — Earthwork & Site Utilities");
  });

  it("uses 'Sitework Materials' as the default material bucket", () => {
    expect(categoryForComponent("EARTHWORK", "Material Only")).toBe("Sitework Materials");
    expect(categoryForMaterial("EARTHWORK", undefined)).toBe("Sitework Materials");
  });

  it("routes mass excavation, grading and clearing into 'Earthwork & Grading'", () => {
    expect(categoryForComponent("EARTHWORK", "Mass Excavation")).toBe("Earthwork & Grading");
    expect(categoryForComponent("EARTHWORK", "Rough Grading")).toBe("Earthwork & Grading");
    expect(categoryForComponent("EARTHWORK", "Clearing & Grubbing")).toBe("Earthwork & Grading");
  });

  it("routes trenching/backfill into 'Trenching & Backfill'", () => {
    expect(categoryForComponent("EARTHWORK", "Trenching")).toBe("Trenching & Backfill");
    expect(categoryForComponent("EARTHWORK", "Backfill & Compaction")).toBe("Trenching & Backfill");
  });

  it("routes site utility lines into 'Site Utilities'", () => {
    expect(categoryForComponent("EARTHWORK", "Sanitary Sewer Main")).toBe("Site Utilities");
    expect(categoryForComponent("EARTHWORK", "Storm Drain Lateral")).toBe("Site Utilities");
    expect(categoryForComponent("EARTHWORK", "Waterline Tap")).toBe("Site Utilities");
    expect(categoryForComponent("EARTHWORK", "Gas Utility Crossing")).toBe("Site Utilities");
    expect(categoryForComponent("EARTHWORK", "Telecom Duct Bank")).toBe("Site Utilities");
  });

  it("routes shoring and dewatering into their own buckets", () => {
    expect(categoryForComponent("EARTHWORK", "Shoring & Bracing")).toBe("Shoring & Excavation Support");
    expect(categoryForComponent("EARTHWORK", "Dewatering Pump")).toBe("Dewatering");
  });

  it("routes erosion control, aggregate base, flatwork and fencing into clear buckets", () => {
    expect(categoryForComponent("EARTHWORK", "Erosion Control - Silt Fence")).toBe("Erosion & Sediment Control");
    expect(categoryForComponent("EARTHWORK", "Stone Base")).toBe("Aggregate Base");
    expect(categoryForComponent("EARTHWORK", "Concrete Sidewalk")).toBe("Concrete Flatwork");
    expect(categoryForComponent("EARTHWORK", "Fence - Chain Link")).toBe("Fencing");
  });

  it("falls back to a 'Sitework' bucket for genuinely unknown components", () => {
    expect(categoryForComponent("EARTHWORK", "Some Brand New Earthwork Thing")).toBe("Sitework");
  });
});

describe("Task #2082 — seed sampling produces no leftover Components & Assemblies", () => {
  // Acceptance criterion: sampling the seed for trades currently mapped to
  // OTHER and EARTHWORK produces no "Components & Assemblies" leftovers.
  it("never produces 'Components & Assemblies' for any OTHER or EARTHWORK trade", async () => {
    const { default: tradeComponents } = await import("../data/onboarding/trade_components.json", {
      with: { type: "json" },
    });
    const { EXTENDED_TRADE_REGISTRY } = await import("@shared/tradeTypeUtils");

    const offenders: Array<{ tradeId: string; componentName: string; legacy: string }> = [];
    for (const trade of tradeComponents as Array<{ trade_id: string; components: Array<{ display_name: string }> }>) {
      const legacy = EXTENDED_TRADE_REGISTRY[trade.trade_id];
      if (legacy !== "OTHER" && legacy !== "EARTHWORK") continue;
      for (const comp of trade.components) {
        const cat = categoryForComponent(legacy, comp.display_name);
        if (cat === "Components & Assemblies") {
          offenders.push({ tradeId: trade.trade_id, componentName: comp.display_name, legacy });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("isLaborComponent", () => {
  it("flags Labor Only", () => {
    expect(isLaborComponent("Labor Only")).toBe(true);
  });

  it("flags 'RTU Install'", () => {
    expect(isLaborComponent("RTU Install")).toBe(true);
  });

  it("does not flag pure material components", () => {
    expect(isLaborComponent("Gypsum Board (Walls)")).toBe(false);
    expect(isLaborComponent("Conduit (EMT/PVC/RMC)")).toBe(false);
  });
});
