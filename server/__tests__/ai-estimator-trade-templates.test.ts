/**
 * Task #2577 Phase B Step 1 — Trade material templates.
 * Verifies primary + accessory line items are emitted with deterministic
 * quantities given fixed inputs.
 */
import { describe, it, expect } from "vitest";
import {
  listTradeTemplates,
  getTradeTemplate,
  applyTradeTemplate,
} from "../services/aiEstimator/tradeMaterialTemplates";

describe("trade material templates", () => {
  it("lists all four trade templates with options", () => {
    const list = listTradeTemplates();
    const ids = list.map((t) => t.id).sort();
    expect(ids).toEqual([
      "DRYWALL_INTERIOR",
      "ELECTRICAL_ROUGH_BRANCH",
      "FRAMING_INTERIOR_WALL",
      "ROOFING_ASPHALT_SHINGLES",
    ]);
    for (const t of list) {
      expect(t.options.length).toBeGreaterThan(0);
    }
  });

  it("FRAMING template emits studs, plates and ALL accessories", () => {
    const out = applyTradeTemplate("FRAMING_INTERIOR_WALL", {
      quantity: 100,
      options: { wallHeightFeet: 8, studSpacingInches: 16, studSize: "2x4", wasteFactor: 10 },
    });
    expect(out).not.toBeNull();
    const codes = out!.lineItems.map((li) => li.code);
    expect(codes).toContain("STUD_2x4");
    expect(codes).toContain("PLATE_BF");
    expect(codes).toContain("NAIL_16D");
    expect(codes).toContain("SCREW_3IN");
    expect(codes).toContain("ANCHOR_BOLT");
    expect(codes).toContain("SILL_SEAL");
    const accessoryCount = out!.lineItems.filter((li) => li.isAccessory).length;
    expect(accessoryCount).toBeGreaterThanOrEqual(4);
    // Stud count = ceil(100*12/16) + 1 = ceil(75)+1 = 76, then +10% waste -> 84
    const studs = out!.lineItems.find((li) => li.code === "STUD_2x4")!;
    expect(studs.quantity).toBeGreaterThanOrEqual(83);
    expect(studs.quantity).toBeLessThanOrEqual(85);
  });

  it("DRYWALL template emits sheets + mud + tape + screws + corner bead", () => {
    const out = applyTradeTemplate("DRYWALL_INTERIOR", { quantity: 1000 });
    expect(out).not.toBeNull();
    const codes = out!.lineItems.map((li) => li.code);
    for (const c of ["DRYWALL_HALF", "JOINT_COMPOUND", "DRYWALL_TAPE", "DRYWALL_SCREW", "CORNER_BEAD"]) {
      expect(codes).toContain(c);
    }
  });

  it("ROOFING template emits shingles, underlayment, drip edge, ridge cap, nails, sealant", () => {
    const out = applyTradeTemplate("ROOFING_ASPHALT_SHINGLES", {
      quantity: 2000,
      options: { pitchRatio: 6, wasteFactor: 12, ridgeLF: 40, eaveLF: 120 },
    });
    expect(out).not.toBeNull();
    const codes = out!.lineItems.map((li) => li.code);
    for (const c of ["SHINGLE_BUNDLE", "UNDERLAYMENT", "DRIP_EDGE", "RIDGE_CAP", "ROOFING_NAILS", "ROOF_SEALANT"]) {
      expect(codes).toContain(c);
    }
  });

  it("ELECTRICAL template emits conduit, wire, boxes, devices, fittings", () => {
    const out = applyTradeTemplate("ELECTRICAL_ROUGH_BRANCH", {
      quantity: 100,
      options: { outletCount: 8, conductorCount: 3, deviceMix: "MIXED" },
    });
    expect(out).not.toBeNull();
    const codes = out!.lineItems.map((li) => li.code);
    for (const c of ["EMT_CONDUIT", "WIRE_THHN", "DEVICE_BOX", "EMT_COUPLING", "EMT_STRAP", "EMT_CONNECTOR", "WIRE_NUTS"]) {
      expect(codes).toContain(c);
    }
    // MIXED mix splits receptacles + switches
    expect(codes).toContain("RECEPTACLE");
    expect(codes).toContain("SWITCH_SP");
  });

  it("rejects negative quantity", () => {
    expect(() => applyTradeTemplate("DRYWALL_INTERIOR", { quantity: -1 })).toThrow();
  });

  it("returns null for unknown template", () => {
    expect(getTradeTemplate("NOPE")).toBeNull();
    expect(applyTradeTemplate("NOPE", { quantity: 1 })).toBeNull();
  });
});
