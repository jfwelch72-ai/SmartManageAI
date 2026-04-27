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

  it("falls back to the global labor bucket when the trade has no override", () => {
    expect(categoryForComponent("OTHER", "Labor Only")).toBe("Labor & Installation");
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

  it("falls back to a 'Components & Assemblies' bucket when nothing matches", () => {
    expect(categoryForComponent("OTHER", "Some Brand New Component")).toBe("Components & Assemblies");
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
