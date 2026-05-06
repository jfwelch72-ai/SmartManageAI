/**
 * Seed Master Calculators Table
 * Pre-built material calculators for all 19 construction trades
 */

import { logError, logInfo } from "./utils/logger";
import { db } from "./db";
import { masterCalculators, tradeTypeEnum } from "@shared/schema";
import { sql } from "drizzle-orm";

interface CalculatorSeed {
  tradeType: typeof tradeTypeEnum.enumValues[number];
  name: string;
  category: string;
  description: string;
  outputUomCode: string;
  formulaJson: string;
  inputFieldsJson: string;
  defaultValuesJson: string;
  helpText: string;
  sortOrder: number;
}

const calculatorSeeds: CalculatorSeed[] = [
  // ============================================
  // CONCRETE CALCULATORS (CSI 03)
  // ============================================
  {
    tradeType: "CONCRETE",
    name: "Concrete Slab Volume",
    category: "Slabs",
    description: "Calculate concrete volume in cubic yards for slab pours",
    outputUomCode: "CY",
    formulaJson: JSON.stringify({
      formula: "(areaSF * thicknessInches / 12 / 27) * (1 + wasteFactor)",
      variables: ["areaSF", "thicknessInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "thicknessInches", label: "Thickness (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ thicknessInches: 4, wasteFactor: 0.10 }),
    helpText: "Enter the slab area in square feet and thickness in inches. Default waste factor is 10%.",
    sortOrder: 1,
  },
  {
    tradeType: "CONCRETE",
    name: "Concrete Footing Volume",
    category: "Foundations",
    description: "Calculate concrete volume for continuous footings",
    outputUomCode: "CY",
    formulaJson: JSON.stringify({
      formula: "(lengthLF * widthInches/12 * depthInches/12 / 27) * (1 + wasteFactor)",
      variables: ["lengthLF", "widthInches", "depthInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "lengthLF", label: "Length (LF)", type: "number", required: true },
      { name: "widthInches", label: "Width (inches)", type: "number", required: true },
      { name: "depthInches", label: "Depth (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ widthInches: 24, depthInches: 12, wasteFactor: 0.10 }),
    helpText: "Enter footing length in linear feet, width and depth in inches.",
    sortOrder: 2,
  },
  {
    tradeType: "CONCRETE",
    name: "Rebar Calculator",
    category: "Reinforcement",
    description: "Calculate rebar pieces for a given area and spacing",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(((sqrt(areaSF) / (spacingInches/12) + 1) * 2 * sqrt(areaSF) * 1.1) / barLengthFeet * (1 + wasteFactor))",
      variables: ["areaSF", "spacingInches", "barLengthFeet", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "spacingInches", label: "Spacing O.C. (inches)", type: "number", required: true },
      { name: "barLengthFeet", label: "Bar Length (feet)", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ spacingInches: 12, barLengthFeet: 20, wasteFactor: 0.10 }),
    helpText: "Enter area and on-center spacing. Standard bars are 20 feet long.",
    sortOrder: 3,
  },
  {
    tradeType: "CONCRETE",
    name: "Wire Mesh Rolls",
    category: "Reinforcement",
    description: "Calculate wire mesh rolls for slab reinforcement",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF * (1 + wasteFactor) / sfPerRoll)",
      variables: ["areaSF", "sfPerRoll", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "sfPerRoll", label: "SF per Roll", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sfPerRoll: 150, wasteFactor: 0.10 }),
    helpText: "Standard 6x6 W1.4/W1.4 mesh covers 150 SF per roll.",
    sortOrder: 4,
  },

  // ============================================
  // EARTHWORK CALCULATORS (CSI 31)
  // ============================================
  {
    tradeType: "EARTHWORK",
    name: "Excavation Volume",
    category: "Excavation",
    description: "Calculate excavation volume with swell factor",
    outputUomCode: "CY",
    formulaJson: JSON.stringify({
      formula: "(areaSF * depthInches/12 / 27) * (1 + swellFactor)",
      variables: ["areaSF", "depthInches", "swellFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "depthInches", label: "Depth (inches)", type: "number", required: true },
      { name: "swellFactor", label: "Swell Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ depthInches: 6, swellFactor: 0.25 }),
    helpText: "Swell factor accounts for soil expansion when excavated. Typical values: 25% for soil, 35% for rock.",
    sortOrder: 1,
  },
  {
    tradeType: "EARTHWORK",
    name: "Stone Base Tonnage",
    category: "Base Materials",
    description: "Calculate stone base tonnage for sub-base preparation",
    outputUomCode: "TON",
    formulaJson: JSON.stringify({
      formula: "(areaSF * depthInches/12 / 27) * (1 + wasteFactor) * 1.5",
      variables: ["areaSF", "depthInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "depthInches", label: "Depth (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ depthInches: 4, wasteFactor: 0.10 }),
    helpText: "Crushed stone weighs approximately 1.5 tons per cubic yard.",
    sortOrder: 2,
  },

  // ============================================
  // ASPHALT CALCULATORS (CSI 32)
  // ============================================
  {
    tradeType: "ASPHALT_PAVING",
    name: "Asphalt Tonnage",
    category: "Paving",
    description: "Calculate hot mix asphalt tonnage",
    outputUomCode: "TON",
    formulaJson: JSON.stringify({
      formula: "(areaSF * thicknessInches/12 / 27) * 2.025 * (1 + wasteFactor)",
      variables: ["areaSF", "thicknessInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "thicknessInches", label: "Thickness (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ thicknessInches: 2, wasteFactor: 0.05 }),
    helpText: "HMA weighs 2.025 tons per cubic yard. Standard commercial thickness is 2-3 inches.",
    sortOrder: 1,
  },
  {
    tradeType: "ASPHALT_PAVING",
    name: "Sealcoat Coverage",
    category: "Coatings",
    description: "Calculate sealcoat gallons for parking lots",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "ceil((areaSF * coats / coverageSFPerGal) * (1 + wasteFactor))",
      variables: ["areaSF", "coats", "coverageSFPerGal", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "coats", label: "Number of Coats", type: "number", required: false },
      { name: "coverageSFPerGal", label: "SF per Gallon", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ coats: 2, coverageSFPerGal: 60, wasteFactor: 0.05 }),
    helpText: "Standard sealcoat covers 50-70 SF per gallon. Two coats recommended for commercial.",
    sortOrder: 2,
  },

  // ============================================
  // ROOFING CALCULATORS (CSI 07)
  // ============================================
  {
    tradeType: "ROOFING",
    name: "Roofing Squares",
    category: "Shingles/Tiles",
    description: "Calculate roofing squares with pitch adjustment",
    outputUomCode: "SQ",
    formulaJson: JSON.stringify({
      formula: "(footprintSF * (sqrt(144 + pitchRise^2) / 12) / 100) * (1 + wasteFactor)",
      variables: ["footprintSF", "pitchRise", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "footprintSF", label: "Footprint Area (SF)", type: "number", required: true },
      { name: "pitchRise", label: "Pitch Rise per 12\"", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ pitchRise: 4, wasteFactor: 0.10 }),
    helpText: "Enter the building footprint and roof pitch (rise per 12\" run). 1 square = 100 SF.",
    sortOrder: 1,
  },
  {
    tradeType: "ROOFING",
    name: "Silicone Coating",
    category: "Coatings",
    description: "Calculate silicone roof coating gallons",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "(areaSF * milThickness / 1604) * (1 + wasteFactor)",
      variables: ["areaSF", "milThickness", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "milThickness", label: "Mil Thickness", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ milThickness: 20, wasteFactor: 0.10 }),
    helpText: "1604 mil-SF per gallon is the industry standard. Silicone typically applied at 20-30 mils.",
    sortOrder: 2,
  },
  {
    tradeType: "ROOFING",
    name: "Acrylic Coating",
    category: "Coatings",
    description: "Calculate acrylic roof coating gallons",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "(areaSF * milThickness / 1604) * (1 + wasteFactor)",
      variables: ["areaSF", "milThickness", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "milThickness", label: "Mil Thickness", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ milThickness: 16, wasteFactor: 0.10 }),
    helpText: "Acrylic typically applied at 16-24 mils dry film thickness.",
    sortOrder: 3,
  },
  {
    tradeType: "ROOFING",
    name: "Polyurea Coating",
    category: "Coatings",
    description: "Calculate polyurea roof coating gallons",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "(areaSF * milThickness / 1604) * (1 + wasteFactor)",
      variables: ["areaSF", "milThickness", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "milThickness", label: "Mil Thickness", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ milThickness: 50, wasteFactor: 0.10 }),
    helpText: "Polyurea typically applied at 40-60 mils for waterproofing.",
    sortOrder: 4,
  },

  // ============================================
  // ELECTRICAL CALCULATORS (CSI 26)
  // ============================================
  {
    tradeType: "ELECTRICAL",
    name: "Wire Pull Length",
    category: "Wiring",
    description: "Calculate wire length for conduit runs",
    outputUomCode: "LF",
    formulaJson: JSON.stringify({
      formula: "ceil((conduitLengthLF * wiresPerRun + pullBoxCount * 10) * (1 + wasteFactor))",
      variables: ["conduitLengthLF", "wiresPerRun", "pullBoxCount", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "conduitLengthLF", label: "Conduit Length (LF)", type: "number", required: true },
      { name: "wiresPerRun", label: "Wires per Run", type: "number", required: true },
      { name: "pullBoxCount", label: "Pull Box Count", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wiresPerRun: 3, pullBoxCount: 0, wasteFactor: 0.10 }),
    helpText: "Add 10 LF per pull box for connections. Standard 3-wire runs for 120/208V.",
    sortOrder: 1,
  },
  {
    tradeType: "ELECTRICAL",
    name: "Circuit Load Calculator",
    category: "Design",
    description: "Calculate circuit amperage from device loads",
    outputUomCode: "AMPS",
    formulaJson: JSON.stringify({
      formula: "(deviceCount * wattsPerDevice) / voltage",
      variables: ["deviceCount", "wattsPerDevice", "voltage"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "deviceCount", label: "Device Count", type: "number", required: true },
      { name: "wattsPerDevice", label: "Watts per Device", type: "number", required: true },
      { name: "voltage", label: "Voltage", type: "number", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ voltage: 120 }),
    helpText: "Calculate amperage for sizing breakers and wire. Use 120V for residential, 277V for commercial lighting.",
    sortOrder: 2,
  },

  // ============================================
  // PLUMBING CALCULATORS (CSI 22)
  // ============================================
  {
    tradeType: "PLUMBING",
    name: "Pipe Length",
    category: "Piping",
    description: "Calculate pipe length with fittings allowance",
    outputUomCode: "LF",
    formulaJson: JSON.stringify({
      formula: "ceil(lengthLF * (1 + wasteFactor))",
      variables: ["lengthLF", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "lengthLF", label: "Pipe Length (LF)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wasteFactor: 0.10 }),
    helpText: "10% waste factor accounts for fittings, cuts, and threading.",
    sortOrder: 1,
  },
  {
    tradeType: "PLUMBING",
    name: "Pipe Hangers",
    category: "Supports",
    description: "Calculate pipe hangers based on spacing",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil((lengthLF / spacingFeet + 1) * (1 + wasteFactor))",
      variables: ["lengthLF", "spacingFeet", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "lengthLF", label: "Pipe Length (LF)", type: "number", required: true },
      { name: "spacingFeet", label: "Hanger Spacing (feet)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ spacingFeet: 8, wasteFactor: 0.05 }),
    helpText: "Spacing: 1/2-1\" pipe = 6 ft, 1.5-3\" = 8 ft, 4\"+ = 10 ft per ASME B31.",
    sortOrder: 2,
  },

  // ============================================
  // HVAC CALCULATORS (CSI 23)
  // ============================================
  {
    tradeType: "HVAC",
    name: "Rectangular Duct SF",
    category: "Ductwork",
    description: "Calculate duct surface area for material ordering",
    outputUomCode: "SF",
    formulaJson: JSON.stringify({
      formula: "((2 * widthInches + 2 * heightInches) / 12 * lengthLF) * (1 + wasteFactor)",
      variables: ["lengthLF", "widthInches", "heightInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "lengthLF", label: "Duct Length (LF)", type: "number", required: true },
      { name: "widthInches", label: "Width (inches)", type: "number", required: true },
      { name: "heightInches", label: "Height (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wasteFactor: 0.10 }),
    helpText: "Surface area for sheet metal ordering. Add 10% for seams and connections.",
    sortOrder: 1,
  },
  {
    tradeType: "HVAC",
    name: "HVAC Tonnage",
    category: "Equipment",
    description: "Calculate HVAC tonnage for building",
    outputUomCode: "TON",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / sfPerTon * 2) / 2",
      variables: ["areaSF", "sfPerTon"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Building Area (SF)", type: "number", required: true },
      { name: "sfPerTon", label: "SF per Ton", type: "number", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sfPerTon: 500 }),
    helpText: "Residential: 500-600 SF/ton. Commercial: 300-400 SF/ton. Rounds to nearest 0.5 ton.",
    sortOrder: 2,
  },

  // ============================================
  // FIRE PROTECTION CALCULATORS (CSI 21)
  // ============================================
  {
    tradeType: "FIRE_PROTECTION",
    name: "Sprinkler Head Count",
    category: "Fire Suppression",
    description: "Calculate sprinkler heads by hazard classification",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / sfPerHead * (1 + wasteFactor))",
      variables: ["areaSF", "sfPerHead", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "sfPerHead", label: "SF per Head", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sfPerHead: 130, wasteFactor: 0.05 }),
    helpText: "Light hazard: 200 SF/head. Ordinary hazard: 130 SF/head. Extra hazard: 100 SF/head.",
    sortOrder: 1,
  },

  // ============================================
  // LOW VOLTAGE CALCULATORS (CSI 27/28)
  // ============================================
  {
    tradeType: "LOW_VOLTAGE",
    name: "Cable Drop Length",
    category: "Structured Cabling",
    description: "Calculate total cable length for data drops",
    outputUomCode: "LF",
    formulaJson: JSON.stringify({
      formula: "ceil(dropCount * avgDropLengthLF * (1 + wasteFactor))",
      variables: ["dropCount", "avgDropLengthLF", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "dropCount", label: "Number of Drops", type: "number", required: true },
      { name: "avgDropLengthLF", label: "Average Drop Length (LF)", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ avgDropLengthLF: 100, wasteFactor: 0.15 }),
    helpText: "Cat6a max run: 295 ft. Add 15% waste for terminations and routing.",
    sortOrder: 1,
  },
  {
    tradeType: "LOW_VOLTAGE",
    name: "Patch Panel Ports",
    category: "Structured Cabling",
    description: "Calculate patch panel ports with spare capacity",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(activeDrops * spareCapacity)",
      variables: ["activeDrops", "spareCapacity"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "activeDrops", label: "Active Drops", type: "number", required: true },
      { name: "spareCapacity", label: "Spare Capacity Multiplier", type: "number", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ spareCapacity: 1.2 }),
    helpText: "Standard practice: 20% spare capacity for future expansion.",
    sortOrder: 2,
  },

  // ============================================
  // LANDSCAPING CALCULATORS (CSI 32)
  // ============================================
  {
    tradeType: "LANDSCAPING",
    name: "Mulch Volume",
    category: "Ground Cover",
    description: "Calculate mulch cubic yards",
    outputUomCode: "CY",
    formulaJson: JSON.stringify({
      formula: "(areaSF * depthInches/12 / 27) * (1 + wasteFactor)",
      variables: ["areaSF", "depthInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "depthInches", label: "Depth (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ depthInches: 3, wasteFactor: 0.10 }),
    helpText: "Standard mulch depth is 3-4 inches. 1 CY covers ~100 SF at 3\" depth.",
    sortOrder: 1,
  },
  {
    tradeType: "LANDSCAPING",
    name: "Sod Pallets",
    category: "Turf",
    description: "Calculate sod pallets for lawn installation",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / sfPerPallet * (1 + wasteFactor))",
      variables: ["areaSF", "sfPerPallet", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "sfPerPallet", label: "SF per Pallet", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sfPerPallet: 450, wasteFactor: 0.10 }),
    helpText: "Standard sod pallet covers 450 SF. Add 10% for cuts and shaping.",
    sortOrder: 2,
  },

  // ============================================
  // DEMOLITION CALCULATORS (CSI 02)
  // ============================================
  {
    tradeType: "DEMOLITION",
    name: "Demo Haul-off Volume",
    category: "Removal",
    description: "Calculate debris haul-off volume with expansion",
    outputUomCode: "CY",
    formulaJson: JSON.stringify({
      formula: "(areaSF * depthInches/12 / 27) * expansionFactor",
      variables: ["areaSF", "depthInches", "expansionFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "depthInches", label: "Depth (inches)", type: "number", required: true },
      { name: "expansionFactor", label: "Expansion Factor", type: "number", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ expansionFactor: 1.5 }),
    helpText: "Debris expands when demolished. Concrete: 1.5x, Wood: 2x, Mixed: 1.75x.",
    sortOrder: 1,
  },
  {
    tradeType: "DEMOLITION",
    name: "Dumpster Loads",
    category: "Removal",
    description: "Calculate number of dumpster loads needed",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(totalCY / dumpsterSizeCY)",
      variables: ["totalCY", "dumpsterSizeCY"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "totalCY", label: "Total Debris (CY)", type: "number", required: true },
      { name: "dumpsterSizeCY", label: "Dumpster Size (CY)", type: "number", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ dumpsterSizeCY: 20 }),
    helpText: "Common sizes: 10 CY, 20 CY, 30 CY, 40 CY. Weight limits may apply.",
    sortOrder: 2,
  },

  // ============================================
  // MASONRY CALCULATORS (CSI 04)
  // ============================================
  {
    tradeType: "MASONRY",
    name: "CMU Block Count",
    category: "Block Walls",
    description: "Calculate CMU blocks for wall construction",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(lengthFeet * heightFeet * 1.125 * (1 + wasteFactor))",
      variables: ["lengthFeet", "heightFeet", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "lengthFeet", label: "Wall Length (feet)", type: "number", required: true },
      { name: "heightFeet", label: "Wall Height (feet)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wasteFactor: 0.05 }),
    helpText: "Standard 8×16 CMU: 1.125 blocks per SF. Add 5% for cuts and breakage.",
    sortOrder: 1,
  },
  {
    tradeType: "MASONRY",
    name: "Mortar Bags",
    category: "Block Walls",
    description: "Calculate mortar bags for CMU installation",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(blockCount / 35 * (1 + wasteFactor))",
      variables: ["blockCount", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "blockCount", label: "Block Count", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wasteFactor: 0.05 }),
    helpText: "70 lb bag covers approximately 35 standard CMU blocks.",
    sortOrder: 2,
  },

  // ============================================
  // CARPENTRY CALCULATORS (CSI 06)
  // ============================================
  {
    tradeType: "CARPENTRY",
    name: "Wall Stud Count",
    category: "Framing",
    description: "Calculate stud count for wall framing",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil((lengthFeet * 12 / spacingInches + 1) * (1 + wasteFactor))",
      variables: ["lengthFeet", "spacingInches", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "lengthFeet", label: "Wall Length (feet)", type: "number", required: true },
      { name: "spacingInches", label: "Stud Spacing (inches)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ spacingInches: 16, wasteFactor: 0.10 }),
    helpText: "Standard spacing: 16\" O.C. for bearing walls, 24\" O.C. for non-bearing.",
    sortOrder: 1,
  },
  {
    tradeType: "CARPENTRY",
    name: "Plywood Sheets",
    category: "Sheathing",
    description: "Calculate plywood sheets for sheathing",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / sheetSizeSF * (1 + wasteFactor))",
      variables: ["areaSF", "sheetSizeSF", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "sheetSizeSF", label: "Sheet Size (SF)", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sheetSizeSF: 32, wasteFactor: 0.10 }),
    helpText: "Standard 4×8 sheet = 32 SF. Add 10% for cuts and waste.",
    sortOrder: 2,
  },

  // ============================================
  // DRYWALL CALCULATORS (CSI 09)
  // ============================================
  {
    tradeType: "DRYWALL",
    name: "Drywall Sheet Count",
    category: "Wall Board",
    description: "Calculate drywall sheets needed",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / sheetSizeSF * (1 + wasteFactor))",
      variables: ["areaSF", "sheetSizeSF", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "sheetSizeSF", label: "Sheet Size (SF)", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sheetSizeSF: 32, wasteFactor: 0.10 }),
    helpText: "4×8 = 32 SF, 4×12 = 48 SF. 12-ft sheets reduce joints for ceilings.",
    sortOrder: 1,
  },
  {
    tradeType: "DRYWALL",
    name: "Joint Compound",
    category: "Finishing",
    description: "Calculate joint compound gallons for finishing",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "ceil(sheetCount * 0.5 * (1 + wasteFactor))",
      variables: ["sheetCount", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "sheetCount", label: "Sheet Count", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wasteFactor: 0.10 }),
    helpText: "Approximately 0.5 gallons per sheet for 3-coat finish.",
    sortOrder: 2,
  },

  // ============================================
  // PAINTING CALCULATORS (CSI 09)
  // ============================================
  {
    tradeType: "PAINTING",
    name: "Paint Coverage",
    category: "Wall Paint",
    description: "Calculate paint gallons for wall/ceiling coverage",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "ceil((areaSF * coats / coverageSFPerGal) * (1 + wasteFactor))",
      variables: ["areaSF", "coats", "coverageSFPerGal", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "coats", label: "Number of Coats", type: "number", required: false },
      { name: "coverageSFPerGal", label: "SF per Gallon", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ coats: 2, coverageSFPerGal: 350, wasteFactor: 0.10 }),
    helpText: "Premium paint: 350-400 SF/gal. Builder grade: 250-300 SF/gal. Two coats recommended.",
    sortOrder: 1,
  },
  {
    tradeType: "PAINTING",
    name: "Primer Coverage",
    category: "Prep Coats",
    description: "Calculate primer gallons",
    outputUomCode: "GAL",
    formulaJson: JSON.stringify({
      formula: "ceil((areaSF / coverageSFPerGal) * (1 + wasteFactor))",
      variables: ["areaSF", "coverageSFPerGal", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "coverageSFPerGal", label: "SF per Gallon", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ coverageSFPerGal: 350, wasteFactor: 0.10 }),
    helpText: "Standard primer: 300-400 SF/gal. Stain-blocking primer may cover less.",
    sortOrder: 2,
  },

  // ============================================
  // FLOORING CALCULATORS (CSI 09)
  // ============================================
  {
    tradeType: "FLOORING",
    name: "Flooring Cartons",
    category: "Hard Surface",
    description: "Calculate flooring cartons for plank/tile",
    outputUomCode: "EA",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / sfPerCarton * (1 + wasteFactor))",
      variables: ["areaSF", "sfPerCarton", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "sfPerCarton", label: "SF per Carton", type: "number", required: false },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ sfPerCarton: 20, wasteFactor: 0.10 }),
    helpText: "Carton coverage varies by product (15-25 SF typical). Add 10% for cuts.",
    sortOrder: 1,
  },
  {
    tradeType: "FLOORING",
    name: "Carpet Square Yards",
    category: "Soft Surface",
    description: "Calculate carpet in square yards",
    outputUomCode: "SY",
    formulaJson: JSON.stringify({
      formula: "ceil(areaSF / 9 * (1 + wasteFactor))",
      variables: ["areaSF", "wasteFactor"],
    }),
    inputFieldsJson: JSON.stringify([
      { name: "areaSF", label: "Area (SF)", type: "number", required: true },
      { name: "wasteFactor", label: "Waste Factor", type: "percentage", required: false },
    ]),
    defaultValuesJson: JSON.stringify({ wasteFactor: 0.10 }),
    helpText: "Carpet sold by SY. 12-ft wide rolls. Add 10% for seams and waste.",
    sortOrder: 2,
  },
];

export async function seedMasterCalculators(): Promise<void> {
  logInfo('Seeding master calculators...');
  
  try {
    // Clear existing calculators
    await db.delete(masterCalculators);
    
    // Insert all calculators
    for (const calc of calculatorSeeds) {
      await db.insert(masterCalculators).values({
        tradeType: calc.tradeType,
        name: calc.name,
        category: calc.category,
        description: calc.description,
        outputUomCode: calc.outputUomCode,
        formulaJson: calc.formulaJson,
        inputFieldsJson: calc.inputFieldsJson,
        defaultValuesJson: calc.defaultValuesJson,
        helpText: calc.helpText,
        sortOrder: calc.sortOrder,
        isActive: true,
      });
    }
    
    logInfo(`✓ Seeded ${calculatorSeeds.length} master calculators`);
  } catch (error) {
    logError('Error seeding master calculators:', {}, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// Export for manual execution
export default seedMasterCalculators;
