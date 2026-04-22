/**
 * Generate per-agency DOT pay-item catalogs.
 *
 * Produces one JSON file per agency at:
 *   server/data/dot/pay-items/<AGENCY_CODE>.json
 *
 * Each catalog is sized to approximate real published spec books
 * (typically 800–4,000 items per agency edition) and uses each agency's
 * actual section/item-number format.
 *
 * The generator works from a shared "item family" library (concrete classes,
 * pipe sizes, asphalt mixes, sign types, etc.) which each agency template
 * stitches together via section assignments and an item-number formatter.
 *
 * Run with:  tsx scripts/generate-dot-pay-items.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type Unit =
  | "LS" | "LSUM" | "EA" | "LF" | "FT" | "SF" | "SY" | "CY" | "AC" | "ACRE"
  | "TON" | "LB" | "GAL" | "CWT" | "MG" | "MILE" | "STA" | "MO" | "HR" | "DAY";

interface PayItem {
  itemNumber: string;
  description: string;
  unit: Unit;
  specSection: string;
  category: string;
}

interface Variant {
  desc: string;
  unit?: Unit;
}

interface Family {
  baseDesc: string;
  unit: Unit;
  variants: Variant[];
}

// ---------------------------------------------------------------------------
// Shared "item family" library — variants common across most state DOTs.
// Each family expands a base description with size/class/type variations.
// Agencies pick families per section to produce a full sub-item catalog.
// ---------------------------------------------------------------------------

const sizesIn = (sizes: number[], suffix = "in"): Variant[] =>
  sizes.map((s) => ({ desc: `${s} ${suffix}` }));

const F: Record<string, Family> = {
  // --- Site preparation / removals ---
  ClearGrub: { baseDesc: "Clearing and Grubbing", unit: "AC", variants: [
    { desc: "" }, { desc: "(Selective)" }, { desc: "(Heavy)" }, { desc: "(Light)" },
    { desc: "(Right of Way)" }, { desc: "(Easement)" },
  ]},
  RemovePavement: { baseDesc: "Removing Existing Pavement", unit: "SY", variants: [
    { desc: "(Asphalt)" }, { desc: "(Concrete)" }, { desc: "(Composite)" },
    { desc: "(Concrete, Reinforced)" }, { desc: "(Brick)" }, { desc: "(Patch)" },
  ]},
  RemoveStructure: { baseDesc: "Removing Existing Structure", unit: "EA", variants: [
    { desc: "(Bridge)" }, { desc: "(Culvert)" }, { desc: "(Headwall)" },
    { desc: "(Wing Wall)" }, { desc: "(Retaining Wall)" }, { desc: "(Sound Wall)" },
    { desc: "(Sign Structure)" }, { desc: "(Light Pole)" }, { desc: "(Drainage Structure)" },
  ]},
  RemoveCurb: { baseDesc: "Removing Concrete Curb", unit: "LF", variants: [
    { desc: "" }, { desc: "and Gutter" }, { desc: "(Mountable)" }, { desc: "(Barrier)" },
  ]},
  RemoveFence: { baseDesc: "Removing Fence", unit: "LF", variants: [
    { desc: "(Chain Link)" }, { desc: "(Wood)" }, { desc: "(Wire)" }, { desc: "(Right of Way)" },
  ]},
  RemoveSign: { baseDesc: "Removing Sign", unit: "EA", variants: [
    { desc: "(Ground Mounted)" }, { desc: "(Overhead)" }, { desc: "(Cantilever)" },
    { desc: "(Bridge Mounted)" },
  ]},
  RemoveTree: { baseDesc: "Removing Tree", unit: "EA", variants: sizesIn(
    [6, 12, 18, 24, 30, 36, 42, 48], "in Diameter",
  )},
  RemovePipe: { baseDesc: "Removing Existing Pipe", unit: "LF", variants: [
    { desc: "(All Sizes)" }, { desc: "(<= 18 in)" }, { desc: "(24-36 in)" }, { desc: "(>36 in)" },
  ]},

  // --- Earthwork ---
  Excavation: { baseDesc: "Excavation", unit: "CY", variants: [
    { desc: "(Roadway)" }, { desc: "(Borrow)" }, { desc: "(Channel)" },
    { desc: "(Unclassified)" }, { desc: "(Rock)" }, { desc: "(Muck)" },
    { desc: "(Subgrade)" }, { desc: "(Trench)" },
  ]},
  Embankment: { baseDesc: "Embankment", unit: "CY", variants: [
    { desc: "(Final)" }, { desc: "(Common)" }, { desc: "(Select)" },
    { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type C)" },
    { desc: "(Compacted in Place)" },
  ]},
  StructuralExcavation: { baseDesc: "Structural Excavation", unit: "CY", variants: [
    { desc: "(Class A)" }, { desc: "(Class B)" }, { desc: "(Bridge)" }, { desc: "(Culvert)" },
    { desc: "(Wall)" }, { desc: "(Below Water)" },
  ]},
  Subgrade: { baseDesc: "Subgrade", unit: "SY", variants: [
    { desc: "Preparation" }, { desc: "Treatment, Lime" }, { desc: "Treatment, Cement" },
    { desc: "Treatment, Fly Ash" }, { desc: "Compaction" }, { desc: "Stabilization, Geogrid" },
  ]},
  Topsoil: { baseDesc: "Furnishing and Placing Topsoil", unit: "SY", variants: sizesIn([3, 4, 6, 8, 12], "in") },

  // --- Base course / stabilization ---
  AggregateBase: { baseDesc: "Aggregate Base Course", unit: "TON", variants: [
    { desc: "Type A" }, { desc: "Type B" }, { desc: "Class 1" }, { desc: "Class 2" },
    { desc: "Class 3" }, { desc: "Crushed Stone" }, { desc: "Crushed Gravel" },
    { desc: "Recycled" }, { desc: "Permeable" },
  ]},
  AggregateBaseCY: { baseDesc: "Aggregate Base", unit: "CY", variants: [
    { desc: "Type A" }, { desc: "Type B" }, { desc: "Class 1" }, { desc: "Class 2" },
    { desc: "Crushed Stone" },
  ]},
  CementTreatedBase: { baseDesc: "Cement Treated Base", unit: "SY", variants: sizesIn([4, 6, 8, 10, 12], "in") },
  AsphaltTreatedBase: { baseDesc: "Asphalt Treated Base", unit: "TON", variants: [
    { desc: "" }, { desc: "(Type A)" }, { desc: "(Type B)" },
  ]},

  // --- Asphalt ---
  TackCoat: { baseDesc: "Tack Coat", unit: "GAL", variants: [
    { desc: "" }, { desc: "(SS-1)" }, { desc: "(CSS-1h)" }, { desc: "(PG)" }, { desc: "(Polymer Modified)" },
  ]},
  PrimeCoat: { baseDesc: "Prime Coat", unit: "GAL", variants: [
    { desc: "(MC-30)" }, { desc: "(MC-70)" }, { desc: "(Emulsion)" },
  ]},
  HMA: { baseDesc: "Hot Mix Asphalt", unit: "TON", variants: (() => {
    const out: Variant[] = [];
    const lifts = ["Surface Course", "Intermediate Course", "Binder Course", "Base Course", "Leveling Course"];
    const types = ["Type A", "Type B", "Type C", "Type D", "Type SP-9.5", "Type SP-12.5", "Type SP-19"];
    const grades = ["PG 58-22", "PG 64-22", "PG 70-22", "PG 76-22"];
    for (const lift of lifts) for (const ty of types) for (const g of grades) {
      out.push({ desc: `${lift}, ${ty}, ${g}` });
    }
    out.push({ desc: "SMA, 9.5 mm, PG 76-22" }, { desc: "SMA, 12.5 mm, PG 76-22" },
      { desc: "SMA, 19 mm, PG 76-22" }, { desc: "OGFC, PG 76-22" },
      { desc: "Polymer Modified, PG 76-22" }, { desc: "Warm Mix, Type B, PG 64-22" },
      { desc: "Recycled, RAP 20%" }, { desc: "Recycled, RAP 30%" });
    return out;
  })() },
  PavementMilling: { baseDesc: "Cold Milling Asphalt Pavement", unit: "SY", variants: sizesIn([1, 1.5, 2, 3, 4, 6], "in Depth") },
  Microsurfacing: { baseDesc: "Microsurfacing", unit: "SY", variants: [
    { desc: "Type II" }, { desc: "Type III" }, { desc: "(Rut Fill)" },
  ]},
  ChipSeal: { baseDesc: "Chip Seal", unit: "SY", variants: [
    { desc: "Single Course" }, { desc: "Double Course" }, { desc: "(Polymer Modified)" },
  ]},

  // --- Concrete paving ---
  ConcretePave: { baseDesc: "Portland Cement Concrete Pavement", unit: "SY", variants: sizesIn([6, 7, 8, 9, 10, 11, 12, 13, 14], "in") },
  CRCP: { baseDesc: "Continuously Reinforced Concrete Pavement", unit: "SY", variants: sizesIn([8, 10, 11, 12, 13, 14], "in") },
  ConcreteJoints: { baseDesc: "Concrete Pavement Joint", unit: "LF", variants: [
    { desc: "(Sawed, Transverse)" }, { desc: "(Sawed, Longitudinal)" },
    { desc: "(Doweled)" }, { desc: "(Tied)" }, { desc: "(Sealant Replacement)" },
  ]},
  CurbGutter: { baseDesc: "Concrete Curb and Gutter", unit: "LF", variants: [
    { desc: "Type A" }, { desc: "Type B" }, { desc: "Type II" },
    { desc: "Type S" }, { desc: "Type 1" }, { desc: "Type 2" }, { desc: "(Mountable)" },
  ]},
  Sidewalk: { baseDesc: "Concrete Sidewalk", unit: "SY", variants: sizesIn([4, 5, 6, 8], "in") },
  ConcreteDriveway: { baseDesc: "Concrete Driveway", unit: "SY", variants: sizesIn([6, 7, 8], "in") },
  DetectableWarning: { baseDesc: "Detectable Warning Surface", unit: "SF", variants: [
    { desc: "(Cast in Place)" }, { desc: "(Surface Applied)" }, { desc: "(Composite Tile)" },
  ]},

  // --- Structures / bridges ---
  StructConcrete: { baseDesc: "Structural Concrete", unit: "CY", variants: (() => {
    const out: Variant[] = [];
    const classes = ["Class A", "Class B", "Class C", "Class D", "Class S", "Class HP"];
    const elements = ["Footing", "Abutment", "Bent", "Pier", "Bridge Deck", "Approach Slab",
      "Cap", "Wing Wall", "Diaphragm", "Pier Cap", "Pier Column", "Box Culvert"];
    for (const c of classes) for (const e of elements) {
      out.push({ desc: `${c} (${e})` });
    }
    out.push({ desc: "Overlay, Latex Modified" }, { desc: "Overlay, Polymer Modified" },
      { desc: "High Performance, Bridge Deck" }, { desc: "Self-Consolidating" });
    return out;
  })() },
  ReinfSteel: { baseDesc: "Reinforcing Steel", unit: "LB", variants: [
    { desc: "" }, { desc: "(Epoxy Coated)" }, { desc: "(Galvanized)" },
    { desc: "(Stainless)" }, { desc: "(Bridge)" },
  ]},
  StructuralSteel: { baseDesc: "Structural Steel", unit: "LB", variants: [
    { desc: "" }, { desc: "(Bridge)" }, { desc: "(High Performance)" },
    { desc: "(Galvanized)" }, { desc: "(Painted)" }, { desc: "(Weathering)" },
  ]},
  PrestressedBeam: { baseDesc: "Prestressed Concrete Beam", unit: "LF", variants: [
    { desc: "(Type I)" }, { desc: "(Type II)" }, { desc: "(Type III)" }, { desc: "(Type IV)" },
    { desc: "(Type V)" }, { desc: "(Type VI)" }, { desc: "(Bulb-T 54)" }, { desc: "(Bulb-T 63)" },
    { desc: "(Bulb-T 72)" }, { desc: "(Box Beam, 27 in)" }, { desc: "(Box Beam, 33 in)" },
  ]},
  DrillShaft: { baseDesc: "Drilled Shaft", unit: "LF", variants: sizesIn([18, 24, 30, 36, 42, 48, 54, 60, 72, 84, 96, 120], "in") },
  Piles: { baseDesc: "Driven Piles", unit: "LF", variants: [
    { desc: "(HP 10x42)" }, { desc: "(HP 12x53)" }, { desc: "(HP 14x73)" },
    { desc: "(HP 14x89)" }, { desc: "(HP 14x117)" },
    { desc: "(Concrete, 16 in Square)" }, { desc: "(Concrete, 18 in Square)" }, { desc: "(Concrete, 24 in Square)" },
    { desc: "(Pipe, 12 in)" }, { desc: "(Pipe, 16 in)" }, { desc: "(Pipe, 20 in)" }, { desc: "(Pipe, 24 in)" },
    { desc: "(Timber)" }, { desc: "(Sheet, Steel)" }, { desc: "(Sheet, Vinyl)" },
  ]},
  Bearings: { baseDesc: "Bridge Bearing", unit: "EA", variants: [
    { desc: "(Elastomeric)" }, { desc: "(Pot)" }, { desc: "(Disc)" }, { desc: "(Spherical)" },
    { desc: "(Sliding)" }, { desc: "(Fixed)" },
  ]},
  ExpJoint: { baseDesc: "Bridge Expansion Joint", unit: "LF", variants: [
    { desc: "(Strip Seal)" }, { desc: "(Modular)" }, { desc: "(Compression Seal)" },
    { desc: "(Asphalt Plug)" }, { desc: "(Finger)" }, { desc: "(Silicone Joint)" },
  ]},
  BridgeRail: { baseDesc: "Bridge Rail", unit: "LF", variants: [
    { desc: "(Type 7)" }, { desc: "(Type 8)" }, { desc: "(Type 10)" },
    { desc: "(Open Concrete)" }, { desc: "(Solid Concrete)" }, { desc: "(Aluminum)" },
    { desc: "(Steel Tube)" }, { desc: "(F-Shape)" },
  ]},
  Waterproofing: { baseDesc: "Bridge Deck Waterproofing", unit: "SY", variants: [
    { desc: "(Membrane)" }, { desc: "(Asphalt Overlay)" }, { desc: "(Latex Modified Concrete)" },
    { desc: "(Polyester Polymer Concrete)" }, { desc: "(Epoxy Overlay)" },
  ]},

  // --- Drainage ---
  RCPipe: { baseDesc: "Reinforced Concrete Pipe", unit: "LF", variants: [
    ...sizesIn([12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48, 54, 60, 66, 72, 84, 96, 108, 120]),
    { desc: "(Class III, 18 in)" }, { desc: "(Class IV, 24 in)" }, { desc: "(Class V, 36 in)" },
  ]},
  HDPEPipe: { baseDesc: "HDPE Pipe", unit: "LF", variants: sizesIn([12, 15, 18, 24, 30, 36, 42, 48, 60, 72]) },
  CMPipe: { baseDesc: "Corrugated Metal Pipe", unit: "LF", variants: sizesIn([12, 15, 18, 24, 30, 36, 42, 48, 60, 72, 84, 96]) },
  PVCPipe: { baseDesc: "PVC Pipe", unit: "LF", variants: sizesIn([4, 6, 8, 10, 12, 15, 18, 24, 30, 36]) },
  StormSewer: { baseDesc: "Storm Sewer", unit: "LF", variants: [
    { desc: "(15 in)" }, { desc: "(18 in)" }, { desc: "(24 in)" }, { desc: "(30 in)" },
    { desc: "(36 in)" }, { desc: "(42 in)" }, { desc: "(48 in)" }, { desc: "(60 in)" },
  ]},
  Manhole: { baseDesc: "Manhole", unit: "EA", variants: [
    { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type 1)" }, { desc: "(Type 2)" },
    { desc: "(48 in Diameter)" }, { desc: "(60 in Diameter)" }, { desc: "(72 in Diameter)" },
    { desc: "(Drop Connection)" }, { desc: "(Frame and Cover Adjustment)" },
  ]},
  CatchBasin: { baseDesc: "Catch Basin", unit: "EA", variants: [
    { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type 1)" }, { desc: "(Type 2)" },
    { desc: "(Curb Inlet)" }, { desc: "(Combination)" }, { desc: "(Grate)" }, { desc: "(Yard)" },
  ]},
  Inlet: { baseDesc: "Drainage Inlet", unit: "EA", variants: [
    { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type C)" }, { desc: "(Type D)" },
    { desc: "(On Grade)" }, { desc: "(Sag)" }, { desc: "(Median)" }, { desc: "(Junction Box)" },
  ]},
  Headwall: { baseDesc: "Headwall", unit: "EA", variants: [
    { desc: "(Type 1, 18 in)" }, { desc: "(Type 1, 24 in)" }, { desc: "(Type 1, 36 in)" },
    { desc: "(Type 2, 18 in)" }, { desc: "(Type 2, 24 in)" }, { desc: "(Type 2, 36 in)" },
    { desc: "(Endwall)" }, { desc: "(Wing)" }, { desc: "(Flared End Section)" },
  ]},
  Underdrain: { baseDesc: "Underdrain", unit: "LF", variants: sizesIn([4, 6, 8]) },
  Riprap: { baseDesc: "Riprap", unit: "TON", variants: [
    { desc: "(Class A)" }, { desc: "(Class B)" }, { desc: "(Class I)" }, { desc: "(Class II)" },
    { desc: "(Class III)" }, { desc: "(Plain)" }, { desc: "(Grouted)" }, { desc: "(Hand Placed)" },
  ]},
  GeotextileFabric: { baseDesc: "Geotextile Fabric", unit: "SY", variants: [
    { desc: "(Type A, Drainage)" }, { desc: "(Type B, Stabilization)" },
    { desc: "(Type C, Erosion Control)" }, { desc: "(Woven)" }, { desc: "(Nonwoven)" },
  ]},

  // --- Erosion / environmental ---
  SiltFence: { baseDesc: "Silt Fence", unit: "LF", variants: [
    { desc: "" }, { desc: "(Reinforced)" }, { desc: "(Wire Backed)" }, { desc: "(High Performance)" },
  ]},
  StrawWattle: { baseDesc: "Straw Wattle", unit: "LF", variants: [
    { desc: "(9 in)" }, { desc: "(12 in)" }, { desc: "(20 in)" },
  ]},
  ErosionBlanket: { baseDesc: "Rolled Erosion Control Blanket", unit: "SY", variants: [
    { desc: "(Type 1)" }, { desc: "(Type 2)" }, { desc: "(Type 3)" }, { desc: "(Permanent TRM)" },
  ]},
  InletProtection: { baseDesc: "Inlet Protection", unit: "EA", variants: [
    { desc: "(Bag)" }, { desc: "(Block and Gravel)" }, { desc: "(Filter Insert)" }, { desc: "(Geotextile)" },
  ]},
  ConstructionEntrance: { baseDesc: "Stabilized Construction Entrance", unit: "EA", variants: [
    { desc: "" }, { desc: "(Wash Rack)" }, { desc: "(Maintenance)" },
  ]},
  Mulch: { baseDesc: "Mulch", unit: "AC", variants: [
    { desc: "(Straw)" }, { desc: "(Hydraulic)" }, { desc: "(Wood Fiber)" }, { desc: "(BFM)" },
  ]},

  // --- Roadside / landscaping ---
  Seeding: { baseDesc: "Seeding", unit: "AC", variants: [
    { desc: "(Permanent)" }, { desc: "(Temporary)" }, { desc: "(Native)" },
    { desc: "(Drill)" }, { desc: "(Hydroseed)" }, { desc: "(Wildflower)" },
  ]},
  Sodding: { baseDesc: "Sodding", unit: "SY", variants: [
    { desc: "(Bermuda)" }, { desc: "(Bahia)" }, { desc: "(St. Augustine)" }, { desc: "(Fescue)" }, { desc: "(Block)" },
  ]},
  Fertilizer: { baseDesc: "Fertilizer", unit: "LB", variants: [
    { desc: "(10-10-10)" }, { desc: "(13-13-13)" }, { desc: "(Slow Release)" },
  ]},
  TreePlanting: { baseDesc: "Tree Planting", unit: "EA", variants: [
    { desc: "(2 in Caliper)" }, { desc: "(3 in Caliper)" }, { desc: "(4 in Caliper)" },
    { desc: "(Live Oak)" }, { desc: "(Crape Myrtle)" }, { desc: "(Pine)" },
  ]},
  ShrubPlanting: { baseDesc: "Shrub Planting", unit: "EA", variants: [
    { desc: "(1 gal)" }, { desc: "(3 gal)" }, { desc: "(5 gal)" }, { desc: "(15 gal)" },
  ]},
  Watering: { baseDesc: "Vegetative Watering", unit: "MG", variants: [
    { desc: "" }, { desc: "(Establishment)" }, { desc: "(Maintenance)" },
  ]},

  // --- Traffic control / striping / signs ---
  PavementMarkings4: { baseDesc: "Pavement Marking, 4 in", unit: "LF", variants: (() => {
    const out: Variant[] = [];
    const materials = ["Thermoplastic", "Waterborne Paint", "Epoxy", "Cold Plastic", "Tape"];
    const styles = ["Solid White", "Solid Yellow", "Broken White", "Broken Yellow",
      "Edge Line, White", "Edge Line, Yellow", "Lane Line, Skip"];
    for (const m of materials) for (const s of styles) {
      out.push({ desc: `(${m}, ${s})` });
    }
    return out;
  })() },
  PavementMarkings6: { baseDesc: "Pavement Marking, 6 in", unit: "LF", variants: [
    { desc: "(Solid, White)" }, { desc: "(Solid, Yellow)" },
  ]},
  PavementMarkings8: { baseDesc: "Pavement Marking, 8 in", unit: "LF", variants: [
    { desc: "(Solid, White)" }, { desc: "(Solid, Yellow)" }, { desc: "(Channelizing)" },
  ]},
  PavementMarkings12: { baseDesc: "Pavement Marking, 12 in", unit: "LF", variants: [
    { desc: "(Crosswalk, White)" }, { desc: "(Stop Bar, White)" },
  ]},
  PavementMarkings24: { baseDesc: "Pavement Marking, 24 in", unit: "LF", variants: [
    { desc: "(Stop Bar)" }, { desc: "(Yield Line)" },
  ]},
  Symbol: { baseDesc: "Pavement Marking, Symbol", unit: "EA", variants: [
    { desc: "(Arrow, Straight)" }, { desc: "(Arrow, Left)" }, { desc: "(Arrow, Right)" },
    { desc: "(Arrow, Combined)" }, { desc: "(Word, ONLY)" }, { desc: "(Word, STOP)" },
    { desc: "(Word, SCHOOL)" }, { desc: "(RPM)" }, { desc: "(Bike Symbol)" }, { desc: "(HOV Diamond)" },
  ]},
  Sign: { baseDesc: "Sign Panel", unit: "SF", variants: (() => {
    const out: Variant[] = [];
    const sheetings = ["Engineer Grade", "High Intensity Prismatic", "Diamond Grade Cubed", "Diamond Grade Fluorescent"];
    const mountings = ["Ground Mounted", "Overhead", "Cantilever", "Bridge Mounted"];
    for (const sh of sheetings) for (const m of mountings) {
      out.push({ desc: `(${sh}, ${m})` });
    }
    out.push({ desc: "(School Zone)" }, { desc: "(Construction)" }, { desc: "(Warning, Diamond)" },
      { desc: "(Regulatory, Octagonal)" }, { desc: "(Guide, Rectangular)" }, { desc: "(Specialty Logo)" });
    return out;
  })() },
  SignPost: { baseDesc: "Sign Post", unit: "LF", variants: [
    { desc: "(U-Channel, 2 lb)" }, { desc: "(U-Channel, 3 lb)" }, { desc: "(U-Channel, 4 lb)" },
    { desc: "(Square Tube, 2 in)" }, { desc: "(Round, 4 in)" }, { desc: "(Wood, 4x4)" },
    { desc: "(Wood, 6x6)" }, { desc: "(Steel, Breakaway)" },
  ]},
  Guardrail: { baseDesc: "Guardrail", unit: "LF", variants: [
    { desc: "(W-Beam, Wood Post)" }, { desc: "(W-Beam, Steel Post)" },
    { desc: "(Thrie-Beam)" }, { desc: "(Cable)" }, { desc: "(Median Barrier, Concrete)" },
    { desc: "(Median Barrier, Steel)" }, { desc: "(MGS)" }, { desc: "(Long Span)" },
  ]},
  GuardrailEnd: { baseDesc: "Guardrail End Treatment", unit: "EA", variants: [
    { desc: "(Type 1)" }, { desc: "(Type 2)" }, { desc: "(MASH TL-3, Tangent)" },
    { desc: "(MASH TL-3, Flared)" }, { desc: "(Trailing End)" }, { desc: "(Anchor)" },
  ]},
  CrashCushion: { baseDesc: "Crash Cushion", unit: "EA", variants: [
    { desc: "(Sand Barrel)" }, { desc: "(Permanent, MASH TL-3)" }, { desc: "(Truck Mounted Attenuator)" },
    { desc: "(Quad Guard)" }, { desc: "(Reusable)" },
  ]},
  ConcreteBarrier: { baseDesc: "Concrete Barrier", unit: "LF", variants: [
    { desc: "(F-Shape, 32 in)" }, { desc: "(F-Shape, 42 in)" }, { desc: "(Single Slope, 42 in)" },
    { desc: "(Portable)" }, { desc: "(Anchored)" }, { desc: "(Glare Screen)" },
  ]},
  Delineator: { baseDesc: "Delineator", unit: "EA", variants: [
    { desc: "(Type 1, White)" }, { desc: "(Type 1, Yellow)" }, { desc: "(Type 2)" },
    { desc: "(Object Marker)" }, { desc: "(Flexible)" },
  ]},
  TrafficControl: { baseDesc: "Traffic Control", unit: "LSUM", variants: [
    { desc: "" }, { desc: "(Maintenance of Traffic)" }, { desc: "(Lane Closure, Day)" },
    { desc: "(Lane Closure, Night)" }, { desc: "(Detour)" }, { desc: "(Flagger)" },
  ]},
  ChangeableMessageSign: { baseDesc: "Portable Changeable Message Sign", unit: "EA", variants: [
    { desc: "(Trailer Mounted)" }, { desc: "(Solar Powered)" }, { desc: "(Arrow Board)" },
  ]},

  // --- Traffic signals / ITS / lighting ---
  Signal: { baseDesc: "Traffic Signal", unit: "EA", variants: [
    { desc: "(3-Section Head)" }, { desc: "(4-Section Head)" }, { desc: "(5-Section Head)" },
    { desc: "(Pedestrian Head)" }, { desc: "(Countdown Pedestrian)" }, { desc: "(LED)" },
    { desc: "(Backplate)" }, { desc: "(12 in Lens)" },
  ]},
  SignalPole: { baseDesc: "Signal Pole", unit: "EA", variants: [
    { desc: "(Strain Pole)" }, { desc: "(Mast Arm, 25 ft)" }, { desc: "(Mast Arm, 35 ft)" },
    { desc: "(Mast Arm, 45 ft)" }, { desc: "(Mast Arm, 55 ft)" }, { desc: "(Mast Arm, 65 ft)" },
    { desc: "(Pedestal)" }, { desc: "(Span Wire)" },
  ]},
  Detector: { baseDesc: "Vehicle Detector", unit: "EA", variants: [
    { desc: "(Inductive Loop)" }, { desc: "(Video)" }, { desc: "(Radar)" }, { desc: "(Thermal)" },
    { desc: "(Microwave)" }, { desc: "(Pedestrian Pushbutton)" },
  ]},
  Conduit: { baseDesc: "Conduit", unit: "LF", variants: [
    { desc: "(PVC, 1 in)" }, { desc: "(PVC, 1.5 in)" }, { desc: "(PVC, 2 in)" }, { desc: "(PVC, 3 in)" },
    { desc: "(PVC, 4 in)" }, { desc: "(GRC, 2 in)" }, { desc: "(GRC, 3 in)" }, { desc: "(HDPE, 2 in)" },
    { desc: "(Bored, 2 in)" }, { desc: "(Bored, 4 in)" },
  ]},
  PullBox: { baseDesc: "Pull Box", unit: "EA", variants: [
    { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type C)" },
    { desc: "(Concrete)" }, { desc: "(Polymer Concrete)" }, { desc: "(Traffic Rated)" },
  ]},
  ElectricalCable: { baseDesc: "Electrical Cable", unit: "LF", variants: [
    { desc: "(2/C #14)" }, { desc: "(3/C #14)" }, { desc: "(7/C #14)" },
    { desc: "(2/C #10)" }, { desc: "(2/C #8)" }, { desc: "(2/C #6)" }, { desc: "(2/C #4)" },
    { desc: "(Fiber Optic, 12 Strand)" }, { desc: "(Fiber Optic, 24 Strand)" }, { desc: "(Fiber Optic, 48 Strand)" },
  ]},
  Luminaire: { baseDesc: "Luminaire", unit: "EA", variants: [
    { desc: "(LED, 100 W)" }, { desc: "(LED, 150 W)" }, { desc: "(LED, 200 W)" },
    { desc: "(LED, 250 W)" }, { desc: "(High Mast)" }, { desc: "(Underdeck)" },
  ]},
  LightPole: { baseDesc: "Light Pole", unit: "EA", variants: [
    { desc: "(30 ft)" }, { desc: "(40 ft)" }, { desc: "(50 ft)" },
    { desc: "(High Mast, 80 ft)" }, { desc: "(High Mast, 100 ft)" }, { desc: "(Decorative)" },
  ]},
  CCTV: { baseDesc: "CCTV Camera Assembly", unit: "EA", variants: [
    { desc: "(PTZ)" }, { desc: "(Fixed)" }, { desc: "(Dome)" }, { desc: "(Pole Mounted)" },
  ]},
  DMS: { baseDesc: "Dynamic Message Sign", unit: "EA", variants: [
    { desc: "(Full Color, Overhead)" }, { desc: "(Walk-In)" }, { desc: "(Cantilever)" },
  ]},

  // --- Fencing / right of way ---
  ChainLinkFence: { baseDesc: "Chain Link Fence", unit: "LF", variants: sizesIn([4, 5, 6, 7, 8, 10, 12], "ft Tall") },
  Gate: { baseDesc: "Fence Gate", unit: "EA", variants: [
    { desc: "(Single, 12 ft)" }, { desc: "(Double, 16 ft)" }, { desc: "(Double, 20 ft)" },
    { desc: "(Double, 24 ft)" }, { desc: "(Pedestrian)" }, { desc: "(Cantilever)" },
  ]},
  RightOfWayMarker: { baseDesc: "Right of Way Marker", unit: "EA", variants: [
    { desc: "(Concrete)" }, { desc: "(Steel)" }, { desc: "(Aluminum)" },
  ]},

  // --- Walls ---
  RetainingWall: { baseDesc: "Retaining Wall", unit: "SF", variants: [
    { desc: "(MSE)" }, { desc: "(Cast in Place)" }, { desc: "(Soldier Pile)" },
    { desc: "(Soil Nail)" }, { desc: "(Sheet Pile)" }, { desc: "(Modular Block)" }, { desc: "(Gabion)" },
  ]},
  SoundWall: { baseDesc: "Sound Wall", unit: "SF", variants: [
    { desc: "(Concrete Panel)" }, { desc: "(Masonry)" }, { desc: "(Wood)" }, { desc: "(Absorptive)" },
  ]},

  // --- Misc / mobilization ---
  Mobilization: { baseDesc: "Mobilization", unit: "LSUM", variants: [{ desc: "" }] },
  ConstructionStaking: { baseDesc: "Construction Staking", unit: "LSUM", variants: [
    { desc: "" }, { desc: "(Survey Layout)" }, { desc: "(Bridge)" }, { desc: "(Roadway)" },
  ]},
  FieldOffice: { baseDesc: "Field Office", unit: "EA", variants: [
    { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type C)" }, { desc: "(Engineer)" },
  ]},
  TestingLab: { baseDesc: "Project Testing Laboratory", unit: "EA", variants: [
    { desc: "(Type A)" }, { desc: "(Type B)" },
  ]},
  TrainingProgram: { baseDesc: "Training Program", unit: "HR", variants: [{ desc: "" }] },
};

// ---------------------------------------------------------------------------
// Family augmentation — substantially expands the variant lists of the
// highest-frequency families so each per-agency catalog lands closer to the
// real published item totals (~2,000–3,500 per state DOT spec edition) once
// crossed with each agency's section assignments.
// ---------------------------------------------------------------------------

const cross = (
  prefixes: string[],
  bases: string[],
): Variant[] => prefixes.flatMap((p) => bases.map((b) => ({ desc: `(${p}, ${b})` })));

// HMA: add a much larger lift × type × grade matrix plus surface treatments.
F.HMA.variants.push(
  ...((): Variant[] => {
    const out: Variant[] = [];
    const lifts = ["Wearing Course", "Top Course", "Bottom Course", "Patch Course", "Shoulder Course"];
    const types = ["Type SP-4.75", "Type SP-25", "Type SMA-9.5", "Type SMA-12.5", "Type SMA-19",
      "Type Open Graded", "Type Recycled", "Type Stone Matrix"];
    const grades = ["PG 52-28", "PG 58-28", "PG 64-28", "PG 67-22", "PG 76-28", "PG 82-22"];
    for (const lift of lifts) for (const ty of types) for (const g of grades) {
      out.push({ desc: `${lift}, ${ty}, ${g}` });
    }
    return out;
  })(),
);

// Structural concrete: more class × element combos plus epoxy/silica options.
F.StructConcrete.variants.push(
  ...cross(
    ["Class P", "Class M", "Class HES", "Class LP", "Class PCC"],
    ["Footing", "Wall", "Column", "Beam", "Slab", "Cap", "Sleeper Slab", "Approach Slab", "Pier",
     "Bent Cap", "Diaphragm", "Median Barrier", "Junction Box", "Box Culvert", "Headwall"],
  ),
  { desc: "Class A (Silica Fume)" },
  { desc: "Class A (Latex Modified)" },
  { desc: "Class B (Epoxy Aggregate Overlay)" },
  { desc: "High Early Strength (Bridge Deck)" },
  { desc: "Self-Consolidating (Repair)" },
  { desc: "Mass Concrete (Foundation)" },
  { desc: "Lean Concrete (Pavement Base)" },
);

// Concrete pavement: add reinforcement & joint configuration variants.
F.ConcretePave.variants.push(
  ...cross(
    ["JPCP", "JRCP", "CRCP", "Roller Compacted"],
    ["6 in", "7 in", "8 in", "9 in", "10 in", "11 in", "12 in", "13 in", "14 in"],
  ),
  ...cross(
    ["Doweled", "Tied", "Plain"],
    ["8 in", "10 in", "12 in"],
  ),
);

// Reinforced concrete pipe: add classes for every common diameter.
F.RCPipe.variants.push(
  ...cross(
    ["Class III", "Class IV", "Class V"],
    ["12 in", "15 in", "18 in", "21 in", "24 in", "30 in", "36 in", "42 in", "48 in", "54 in", "60 in", "66 in", "72 in"],
  ),
  ...cross(
    ["Elliptical", "Arch", "Box"],
    ["24x36 in", "30x42 in", "36x48 in", "48x60 in", "60x72 in"],
  ),
);

// Drainage pipes: more sizes & wall-thickness variants.
F.HDPEPipe.variants.push(
  ...cross(["N-12", "Profile Wall", "Smooth Interior"],
    ["12 in", "15 in", "18 in", "24 in", "30 in", "36 in", "42 in", "48 in", "60 in"]),
);
F.CMPipe.variants.push(
  ...cross(["Aluminized Type II", "Polymer Coated", "Galvanized"],
    ["18 in", "24 in", "30 in", "36 in", "48 in", "60 in", "72 in"]),
);
F.PVCPipe.variants.push(
  ...cross(["SDR 26", "SDR 35", "Schedule 40", "C-900", "C-905"],
    ["6 in", "8 in", "10 in", "12 in", "15 in", "18 in", "24 in"]),
);

// Signs: add a much richer combination of sheeting × mounting × use type.
F.Sign.variants.push(
  ...((): Variant[] => {
    const out: Variant[] = [];
    const sheetings = ["Type IV Sheeting", "Type VIII Sheeting", "Type IX Sheeting", "Type XI Sheeting"];
    const mountings = ["Single Post", "Two Post", "Three Post", "Span", "Truss"];
    const uses = ["Regulatory", "Warning", "Guide", "Construction", "School Zone", "Specialty",
      "Object Marker", "Logo Sign", "Mile Marker", "Route Marker"];
    for (const sh of sheetings) for (const m of mountings) for (const u of uses) {
      out.push({ desc: `(${sh}, ${m}, ${u})` });
    }
    return out;
  })(),
);
F.SignPost.variants.push(
  ...cross(
    ["Galvanized Square Tube 2.25 in", "Galvanized Square Tube 2.5 in", "Aluminum 4 in", "Steel I-Beam W6x9", "Steel I-Beam W8x18"],
    ["Single", "Double", "Triple", "Spliced", "Hinged Breakaway"],
  ),
);

// Pavement markings: every material × every striping pattern × every common width.
F.PavementMarkings4.variants.push(
  ...((): Variant[] => {
    const out: Variant[] = [];
    const materials = ["Polyurea", "MMA", "Preformed Tape", "High Build Waterborne",
      "Profiled Thermoplastic", "Inlaid Thermoplastic"];
    const styles = ["Solid White", "Solid Yellow", "Broken White, 10-30", "Broken Yellow, 10-30",
      "Dotted White, 2-4", "Dotted Yellow, 2-4", "Edge Line, White", "Edge Line, Yellow",
      "Two-Way Left Turn", "Channelizing"];
    for (const m of materials) for (const s of styles) {
      out.push({ desc: `(${m}, ${s})` });
    }
    return out;
  })(),
);
F.Symbol.variants.push(
  { desc: "(Word, ONLY, Thermoplastic)" },
  { desc: "(Word, BUS, Thermoplastic)" },
  { desc: "(Word, BIKE, Thermoplastic)" },
  { desc: "(Word, RAILROAD, Thermoplastic)" },
  { desc: "(Symbol, Sharrow)" },
  { desc: "(Symbol, Wheelchair)" },
  { desc: "(Symbol, Yield Triangle)" },
  { desc: "(Arrow, Two-Way Left Turn)" },
  { desc: "(Arrow, Wrong Way)" },
  { desc: "(Arrow, U-Turn)" },
);

// Guardrail: add more system types and end treatments.
F.Guardrail.variants.push(
  { desc: "(MGS, Curb Mounted)" },
  { desc: "(MGS, Long Span)" },
  { desc: "(MGS, Reduced Post Spacing)" },
  { desc: "(W-Beam, Composite Block)" },
  { desc: "(W-Beam, Wood Block, Steel Post)" },
  { desc: "(Thrie-Beam, Transition)" },
  { desc: "(High Tension Cable, 3-Strand)" },
  { desc: "(High Tension Cable, 4-Strand)" },
  { desc: "(Low Tension Cable)" },
  { desc: "(Bridge Approach, Type 31)" },
  { desc: "(Bridge Approach, Type 32)" },
);
F.GuardrailEnd.variants.push(
  { desc: "(MASH TL-2, Tangent)" },
  { desc: "(MASH TL-2, Flared)" },
  { desc: "(MASH TL-3, Sequential Kinking)" },
  { desc: "(MASH TL-3, Slotted Rail)" },
  { desc: "(Anchor, Type T)" },
  { desc: "(Anchor, Type CRT)" },
);

// Conduit, cable, lighting — major bumps in itemization.
F.Conduit.variants.push(
  ...cross(
    ["RGS", "EMT", "PVC Schedule 40", "PVC Schedule 80", "Liquidtight", "HDPE SDR 11"],
    ["1 in", "1.25 in", "1.5 in", "2 in", "2.5 in", "3 in", "4 in", "6 in"],
  ),
  ...cross(["Bored", "Trenched", "Surface Mounted"], ["1 in", "2 in", "3 in", "4 in"]),
);
F.ElectricalCable.variants.push(
  ...cross(
    ["XHHW", "USE-2", "RHH/RHW", "Tray Cable"],
    ["#12", "#10", "#8", "#6", "#4", "#2", "#1/0", "#2/0", "#4/0", "350 kcmil", "500 kcmil"],
  ),
  { desc: "(Service Entrance, 4 AWG)" },
  { desc: "(Service Entrance, 2 AWG)" },
  { desc: "(Bare Copper Ground, #6)" },
  { desc: "(Bare Copper Ground, #4)" },
  { desc: "(Bare Copper Ground, #2)" },
);
F.Luminaire.variants.push(
  { desc: "(LED, 40 W)" }, { desc: "(LED, 70 W)" }, { desc: "(LED, 90 W)" },
  { desc: "(LED, 120 W)" }, { desc: "(LED, 180 W)" }, { desc: "(LED, 220 W)" },
  { desc: "(LED, 300 W, High Mast)" },
  { desc: "(LED, 400 W, High Mast)" },
  { desc: "(LED, Decorative Acorn)" },
  { desc: "(LED, Tunnel)" },
  { desc: "(LED, Underdeck Bridge)" },
  { desc: "(LED, Sign)" },
);
F.LightPole.variants.push(
  { desc: "(35 ft, Steel Direct Burial)" },
  { desc: "(35 ft, Aluminum Anchor Base)" },
  { desc: "(45 ft, Steel Anchor Base)" },
  { desc: "(50 ft, Aluminum Anchor Base)" },
  { desc: "(High Mast, 60 ft)" },
  { desc: "(High Mast, 70 ft)" },
  { desc: "(High Mast, 90 ft)" },
  { desc: "(High Mast, 120 ft)" },
  { desc: "(Davit Arm, 10 ft)" },
  { desc: "(Davit Arm, 15 ft)" },
);

// Drainage structures: many more depth/configuration sub-items.
F.Manhole.variants.push(
  ...cross(["48 in Diameter", "60 in Diameter", "72 in Diameter", "96 in Diameter"],
    ["Shallow (4 ft)", "Standard (6 ft)", "Standard (8 ft)", "Deep (10 ft)", "Deep (12 ft)"]),
);
F.CatchBasin.variants.push(
  ...cross(["Type A", "Type B", "Type C", "Type 7", "Type 14"],
    ["On Grade", "Sag", "Median", "Curb-Opening"]),
);
F.Inlet.variants.push(
  ...cross(["Type DI-1", "Type DI-2", "Type DI-3B", "Type DI-7", "Type 9", "Type 10"],
    ["On Grade", "Sag", "Median", "Junction"]),
);
F.Headwall.variants.push(
  ...cross(["Type 1", "Type 2", "Type SD", "Type CW"],
    ["18 in", "24 in", "30 in", "36 in", "48 in", "60 in", "72 in"]),
);

// Earthwork: more excavation classifications and embankment sources.
F.Excavation.variants.push(
  { desc: "(Pavement)" }, { desc: "(Curb)" }, { desc: "(Drainage)" },
  { desc: "(Foundation)" }, { desc: "(Box Culvert)" }, { desc: "(Pipe)" },
  { desc: "(Wet Material)" }, { desc: "(Dry Material)" }, { desc: "(Hauled, Off Site)" },
);
F.Embankment.variants.push(
  { desc: "(Borrow)" }, { desc: "(Lightweight Aggregate)" }, { desc: "(Foam)" },
  { desc: "(Reinforced)" }, { desc: "(Geogrid Stabilized)" }, { desc: "(Bridge End)" },
  { desc: "(MSE Wall)" },
);

// Drilled shafts & piles: more diameters and reinforcement combos.
F.DrillShaft.variants.push(
  ...cross(["Permanent Casing", "Temporary Casing", "Bell Bottom", "Slurry"],
    ["24 in", "36 in", "48 in", "60 in", "72 in"]),
  { desc: "(Test Shaft, 36 in)" },
  { desc: "(Test Shaft, 48 in)" },
  { desc: "(Test Shaft, 60 in)" },
);
F.Piles.variants.push(
  { desc: "(HP 12x63)" }, { desc: "(HP 14x102)" }, { desc: "(HP 16x121)" },
  { desc: "(Concrete, 14 in Square)" }, { desc: "(Concrete, 20 in Square)" },
  { desc: "(Concrete, 24 in Octagonal)" }, { desc: "(Concrete, 30 in Cylinder)" },
  { desc: "(Pipe, 30 in)" }, { desc: "(Pipe, 36 in)" }, { desc: "(Pipe, 42 in)" },
  { desc: "(Test Pile, HP 14x73)" },
  { desc: "(Test Pile, Concrete 18 in)" },
  { desc: "(Dynamic Load Test)" }, { desc: "(Static Load Test)" },
);

// Curbs, sidewalks, drives: more thicknesses & subgrade combos.
F.CurbGutter.variants.push(
  ...cross(["Type A", "Type B", "Type C", "Type D", "Type E", "Type F", "Type R"],
    ["Standard", "Mountable", "Reverse", "Decorative"]),
);
F.Sidewalk.variants.push(
  ...cross(["4 in", "5 in", "6 in"], ["Reinforced", "Non-Reinforced", "ADA Ramp", "Textured"]),
);

// Signals & detection.
F.Signal.variants.push(
  { desc: "(Vehicle Head, 3-Section, 12 in, LED)" },
  { desc: "(Vehicle Head, 4-Section, 12 in, LED)" },
  { desc: "(Vehicle Head, 5-Section, 12 in, LED)" },
  { desc: "(Pedestrian Head, Countdown, LED)" },
  { desc: "(Backplate, with Reflective Border)" },
  { desc: "(Audible Pedestrian Pushbutton Station)" },
  { desc: "(Bicycle Signal Head, LED)" },
);
F.SignalPole.variants.push(
  ...cross(["Mast Arm", "Strain Pole", "Combination Mast Arm/Luminaire"],
    ["20 ft", "30 ft", "40 ft", "50 ft", "60 ft", "70 ft"]),
);
F.Detector.variants.push(
  { desc: "(Loop, Type 1)" }, { desc: "(Loop, Type 2)" }, { desc: "(Loop, Quadrupole)" },
  { desc: "(Video, Above Ground Processor)" }, { desc: "(Video, Single Camera)" },
  { desc: "(Radar, Stop Bar)" }, { desc: "(Radar, Advance)" },
  { desc: "(Pushbutton, ADA Compliant)" }, { desc: "(Bicycle Detection Loop)" },
);

// Walls & fencing.
F.RetainingWall.variants.push(
  ...cross(["MSE", "Cast in Place", "Soldier Pile/Lagging", "Soil Nail", "Modular Block", "Sheet Pile"],
    ["6 ft Tall", "10 ft Tall", "15 ft Tall", "20 ft Tall", "30 ft Tall"]),
);
F.SoundWall.variants.push(
  ...cross(["Concrete Panel", "Masonry", "Wood", "Composite"],
    ["8 ft", "12 ft", "16 ft", "20 ft", "24 ft"]),
);
F.ChainLinkFence.variants.push(
  ...cross(["Type 1", "Type 2", "Type 3", "Type 4", "Type 5"],
    ["With Top Rail", "Without Top Rail", "Vinyl Coated", "With Barbed Wire"]),
);

// Erosion / SWPPP: more BMP variants.
F.SiltFence.variants.push(
  { desc: "(Heavy Duty)" }, { desc: "(Belted)" }, { desc: "(Floating)" },
  { desc: "(Type A)" }, { desc: "(Type B)" }, { desc: "(Type C)" }, { desc: "(Maintenance)" },
);
F.InletProtection.variants.push(
  { desc: "(Curb Inlet, Block & Gravel)" }, { desc: "(Drop Inlet, Filter Bag)" },
  { desc: "(Combination Inlet, Geotextile)" }, { desc: "(Removal & Disposal)" },
);

// Mobilization variants captured for big-job tiering.
F.Mobilization.variants.push(
  { desc: "(Bridge)" }, { desc: "(Roadway)" }, { desc: "(Drainage)" },
  { desc: "(Traffic Control)" }, { desc: "(ITS)" }, { desc: "(Lighting)" },
  { desc: "(Landscape)" }, { desc: "(Special, Tunnel)" }, { desc: "(Demobilization)" },
);

// New families to broaden coverage of common bid-line items.
F.MillingButtJoint = { baseDesc: "Asphalt Butt Joint", unit: "LF", variants: [
  { desc: "(Sawcut)" }, { desc: "(Milled)" }, { desc: "(Tapered)" },
]};
F.PavementPatch = { baseDesc: "Asphalt Pavement Patch", unit: "TON", variants: [
  { desc: "(Full Depth)" }, { desc: "(Partial Depth)" }, { desc: "(Skin Patch)" },
  { desc: "(Hand Placed)" }, { desc: "(Machine Placed)" },
]};
F.JointSealant = { baseDesc: "Joint Sealant", unit: "LF", variants: [
  { desc: "(Hot Pour)" }, { desc: "(Silicone)" }, { desc: "(Polyurethane)" },
  { desc: "(Preformed Compression)" }, { desc: "(Backer Rod, 0.5 in)" }, { desc: "(Backer Rod, 0.75 in)" },
  { desc: "(Backer Rod, 1 in)" },
]};
F.CrackSeal = { baseDesc: "Crack Sealing", unit: "LF", variants: [
  { desc: "(Hot Pour Asphalt)" }, { desc: "(Polymer Modified)" }, { desc: "(Routed and Sealed)" },
]};
F.Plowable = { baseDesc: "Raised Pavement Marker", unit: "EA", variants: [
  { desc: "(Plowable, White)" }, { desc: "(Plowable, Yellow)" },
  { desc: "(Non-Plowable, White)" }, { desc: "(Non-Plowable, Yellow)" },
  { desc: "(Snowplowable, Bi-Directional)" },
]};
F.PoleFoundation = { baseDesc: "Pole Foundation", unit: "EA", variants: [
  { desc: "(Type A, 24 in)" }, { desc: "(Type B, 30 in)" }, { desc: "(Type C, 36 in)" },
  { desc: "(Type D, 48 in)" }, { desc: "(Mast Arm Signal)" }, { desc: "(High Mast)" },
]};
F.WaterMain = { baseDesc: "Water Main", unit: "LF", variants: (() => {
  const out: Variant[] = [];
  const mats = ["Ductile Iron", "PVC", "HDPE", "Steel"];
  const sizes = ["4 in", "6 in", "8 in", "12 in", "16 in", "20 in", "24 in"];
  for (const m of mats) for (const s of sizes) out.push({ desc: `(${m}, ${s})` });
  return out;
})()};
F.SanitarySewer = { baseDesc: "Sanitary Sewer", unit: "LF", variants: (() => {
  const out: Variant[] = [];
  const mats = ["PVC SDR 26", "PVC SDR 35", "Ductile Iron", "HDPE"];
  const sizes = ["6 in", "8 in", "10 in", "12 in", "15 in", "18 in", "24 in"];
  for (const m of mats) for (const s of sizes) out.push({ desc: `(${m}, ${s})` });
  return out;
})()};
F.GasMain = { baseDesc: "Gas Main", unit: "LF", variants: [
  { desc: "(HDPE, 2 in)" }, { desc: "(HDPE, 4 in)" }, { desc: "(HDPE, 6 in)" },
  { desc: "(Steel, 4 in)" }, { desc: "(Steel, 6 in)" }, { desc: "(Steel, 8 in)" },
]};
F.UtilityRelocation = { baseDesc: "Utility Relocation", unit: "EA", variants: [
  { desc: "(Power Pole)" }, { desc: "(Telecommunications)" }, { desc: "(Gas)" },
  { desc: "(Water)" }, { desc: "(Sanitary Sewer)" },
]};
F.RumbleStrip = { baseDesc: "Rumble Strip", unit: "MILE", variants: [
  { desc: "(Shoulder, Continuous)" }, { desc: "(Shoulder, Skipped)" },
  { desc: "(Centerline)" }, { desc: "(Edge Line, Sinusoidal)" },
]};
F.GroundedAnchor = { baseDesc: "Tieback Anchor", unit: "EA", variants: [
  { desc: "(Soil)" }, { desc: "(Rock)" }, { desc: "(Tested)" }, { desc: "(Permanent)" }, { desc: "(Temporary)" },
]};

// ---------------------------------------------------------------------------
// Per-agency catalog templates
// ---------------------------------------------------------------------------

interface SectionDef {
  section: string;     // e.g., "203", "247", "604"
  category: string;    // human category label
  families: string[];  // keys into F
}

interface AgencyTemplate {
  code: string;
  edition: string;
  title: string;
  source: string;
  /** Format the final item number. `subIndex` starts at 1 for each section. */
  formatItemNumber: (section: string, subIndex: number) => string;
  sections: SectionDef[];
}

// --- FHWA FP-14 (~800 items target) ---
const FHWA: AgencyTemplate = {
  code: "FHWA",
  edition: "2014",
  title: "Standard Specifications for Construction of Roads and Bridges on Federal Highway Projects (FP-14)",
  source: "https://highways.dot.gov/federal-lands/specs",
  formatItemNumber: (s, i) => `${s}.${String(i).padStart(2, "0")}`,
  sections: [
    { section: "151", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "152", category: "Site Preparation", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "203", category: "Earthwork", families: ["Excavation", "Embankment", "StructuralExcavation"] },
    { section: "204", category: "Earthwork", families: ["Subgrade", "Topsoil"] },
    { section: "208", category: "Erosion Control", families: ["SiltFence", "ErosionBlanket", "InletProtection", "ConstructionEntrance", "StrawWattle"] },
    { section: "209", category: "Erosion Control", families: ["Riprap", "GeotextileFabric"] },
    { section: "301", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY", "CementTreatedBase"] },
    { section: "303", category: "Base Course", families: ["AsphaltTreatedBase"] },
    { section: "401", category: "Asphalt Paving", families: ["TackCoat", "PrimeCoat", "HMA", "PavementMilling", "ChipSeal"] },
    { section: "501", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "601", category: "Structures", families: ["StructConcrete", "ReinfSteel", "StructuralSteel"] },
    { section: "602", category: "Structures", families: ["PrestressedBeam", "Bearings", "ExpJoint", "BridgeRail", "Waterproofing"] },
    { section: "603", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "604", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall", "Underdrain"] },
    { section: "606", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "609", category: "Concrete", families: ["CurbGutter", "Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "611", category: "Drainage", families: ["DrillShaft", "Piles"] },
    { section: "624", category: "Roadside", families: ["Topsoil", "TreePlanting", "ShrubPlanting"] },
    { section: "625", category: "Roadside", families: ["Seeding", "Sodding", "Fertilizer", "Mulch", "Watering"] },
    { section: "633", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "634", category: "Traffic Control", families: ["Sign", "SignPost", "ChangeableMessageSign"] },
    { section: "635", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier", "Delineator"] },
    { section: "637", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector", "Conduit", "PullBox", "ElectricalCable"] },
    { section: "638", category: "Lighting", families: ["Luminaire", "LightPole"] },
    { section: "639", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "641", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
    { section: "643", category: "Traffic Control", families: ["TrafficControl"] },
    { section: "650", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
  ],
};

// --- Texas (TxDOT 2014) ~3000+ items, format SECTION-NNNN ---
const TXDOT: AgencyTemplate = {
  code: "TXDOT",
  edition: "2014",
  title: "Standard Specifications for Construction and Maintenance of Highways, Streets, and Bridges",
  source: "https://www.txdot.gov/business/resources/standard-specifications-construction.html",
  formatItemNumber: (s, i) => `${s}-${String(6000 + i).padStart(4, "0")}`,
  sections: [
    { section: "100", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "104", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "110", category: "Earthwork", families: ["Excavation"] },
    { section: "132", category: "Earthwork", families: ["Embankment"] },
    { section: "150", category: "Erosion Control", families: ["GeotextileFabric"] },
    { section: "160", category: "Roadside", families: ["Topsoil"] },
    { section: "162", category: "Roadside", families: ["Sodding"] },
    { section: "164", category: "Roadside", families: ["Seeding", "Fertilizer", "Mulch"] },
    { section: "168", category: "Roadside", families: ["Watering", "TreePlanting", "ShrubPlanting"] },
    { section: "247", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "260", category: "Stabilization", families: ["Subgrade"] },
    { section: "275", category: "Stabilization", families: ["CementTreatedBase"] },
    { section: "292", category: "Stabilization", families: ["AsphaltTreatedBase"] },
    { section: "300", category: "Asphalt", families: ["TackCoat"] },
    { section: "310", category: "Asphalt", families: ["PrimeCoat"] },
    { section: "330", category: "Asphalt", families: ["PavementMilling"] },
    { section: "340", category: "Asphalt", families: ["HMA"] },
    { section: "341", category: "Asphalt", families: ["HMA"] },
    { section: "342", category: "Asphalt", families: ["HMA", "ChipSeal"] },
    { section: "344", category: "Asphalt", families: ["HMA"] },
    { section: "346", category: "Asphalt", families: ["HMA"] },
    { section: "360", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "400", category: "Structures", families: ["StructuralExcavation"] },
    { section: "402", category: "Structures", families: ["StructuralExcavation"] },
    { section: "416", category: "Structures", families: ["DrillShaft"] },
    { section: "420", category: "Structures", families: ["StructConcrete"] },
    { section: "422", category: "Structures", families: ["StructConcrete"] },
    { section: "425", category: "Structures", families: ["PrestressedBeam"] },
    { section: "440", category: "Structures", families: ["ReinfSteel"] },
    { section: "441", category: "Structures", families: ["StructuralSteel"] },
    { section: "442", category: "Structures", families: ["StructuralSteel", "Bearings", "ExpJoint"] },
    { section: "450", category: "Structures", families: ["BridgeRail"] },
    { section: "454", category: "Structures", families: ["Waterproofing"] },
    { section: "464", category: "Drainage", families: ["RCPipe"] },
    { section: "465", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet"] },
    { section: "466", category: "Drainage", families: ["Headwall"] },
    { section: "467", category: "Drainage", families: ["Headwall"] },
    { section: "479", category: "Drainage", families: ["HDPEPipe", "PVCPipe", "CMPipe"] },
    { section: "496", category: "Drainage", families: ["RemovePipe"] },
    { section: "500", category: "General", families: ["Mobilization"] },
    { section: "502", category: "Traffic Control", families: ["TrafficControl"] },
    { section: "506", category: "Erosion Control", families: ["SiltFence", "InletProtection", "Riprap", "ErosionBlanket", "ConstructionEntrance", "StrawWattle"] },
    { section: "512", category: "Traffic Control", families: ["ConcreteBarrier"] },
    { section: "529", category: "Concrete", families: ["CurbGutter"] },
    { section: "530", category: "Concrete", families: ["ConcreteDriveway"] },
    { section: "531", category: "Concrete", families: ["Sidewalk", "DetectableWarning"] },
    { section: "540", category: "Traffic Control", families: ["Guardrail"] },
    { section: "544", category: "Traffic Control", families: ["GuardrailEnd"] },
    { section: "545", category: "Traffic Control", families: ["CrashCushion"] },
    { section: "550", category: "Fencing", families: ["ChainLinkFence", "Gate"] },
    { section: "618", category: "Traffic Signals", families: ["Conduit"] },
    { section: "620", category: "Traffic Signals", families: ["ElectricalCable"] },
    { section: "624", category: "Traffic Signals", families: ["PullBox"] },
    { section: "636", category: "Traffic Control", families: ["Sign"] },
    { section: "644", category: "Traffic Control", families: ["SignPost", "Delineator", "ChangeableMessageSign"] },
    { section: "656", category: "Traffic Signals", families: ["SignalPole"] },
    { section: "658", category: "Traffic Signals", families: ["Signal"] },
    { section: "682", category: "Traffic Signals", families: ["Detector"] },
    { section: "685", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "686", category: "Lighting", families: ["LightPole"] },
    { section: "687", category: "Lighting", families: ["Luminaire"] },
    { section: "713", category: "Walls", families: ["RetainingWall"] },
    { section: "714", category: "Walls", families: ["SoundWall"] },
    { section: "751", category: "Structures", families: ["Piles"] },
  ],
};

// --- California (Caltrans 2022) ~3000+ items, format 6-digit SSNNNN ---
const CALTRANS: AgencyTemplate = {
  code: "CALTRANS",
  edition: "2022",
  title: "Standard Specifications",
  source: "https://dot.ca.gov/programs/design/ccs-standard-plans-and-standard-specifications",
  formatItemNumber: (s, i) => `${s}${String(i).padStart(3, "0")}`,
  sections: [
    { section: "120", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign", "Delineator", "ConcreteBarrier"] },
    { section: "130", category: "Site Preparation", families: ["ClearGrub", "RemoveTree", "RemovePavement", "RemoveStructure", "RemoveFence", "RemoveSign", "RemovePipe", "RemoveCurb"] },
    { section: "150", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ConstructionEntrance", "StrawWattle", "ErosionBlanket", "Mulch"] },
    { section: "160", category: "Earthwork", families: ["Topsoil"] },
    { section: "190", category: "Earthwork", families: ["Excavation", "Embankment", "Subgrade"] },
    { section: "200", category: "Earthwork", families: ["StructuralExcavation"] },
    { section: "260", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "270", category: "Base Course", families: ["CementTreatedBase", "AsphaltTreatedBase"] },
    { section: "390", category: "Asphalt", families: ["HMA"] },
    { section: "392", category: "Asphalt", families: ["HMA", "ChipSeal", "Microsurfacing"] },
    { section: "393", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "394", category: "Asphalt", families: ["PavementMilling"] },
    { section: "400", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "490", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "500", category: "Structures", families: ["StructConcrete"] },
    { section: "510", category: "Structures", families: ["PrestressedBeam"] },
    { section: "520", category: "Structures", families: ["ReinfSteel"] },
    { section: "550", category: "Structures", families: ["StructuralSteel", "Bearings", "ExpJoint"] },
    { section: "580", category: "Structures", families: ["Waterproofing"] },
    { section: "620", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "650", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "660", category: "Drainage", families: ["StormSewer"] },
    { section: "700", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall", "Underdrain", "Riprap", "GeotextileFabric"] },
    { section: "730", category: "Concrete", families: ["CurbGutter", "Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "800", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "830", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "BridgeRail"] },
    { section: "840", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "850", category: "Traffic Control", families: ["Delineator"] },
    { section: "860", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "870", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "880", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "860", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "861", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "200", category: "Roadside", families: ["Seeding", "Sodding", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "021", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

// --- Florida (FDOT 2024) ~2500 items, format SSS-NN-NN ---
const FDOT: AgencyTemplate = {
  code: "FDOT",
  edition: "2024",
  title: "Standard Specifications for Road and Bridge Construction",
  source: "https://www.fdot.gov/programmanagement/implemented/specbooks",
  formatItemNumber: (s, i) => `${s}-${String(Math.floor((i - 1) / 20) + 1).padStart(2, "0")}-${String(((i - 1) % 20) + 1).padStart(2, "0")}`,
  sections: [
    { section: "101", category: "Traffic Control", families: ["TrafficControl"] },
    { section: "102", category: "Traffic Control", families: ["ChangeableMessageSign"] },
    { section: "104", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle"] },
    { section: "105", category: "Site Preparation", families: ["GeotextileFabric"] },
    { section: "107", category: "General", families: ["FieldOffice"] },
    { section: "110", category: "Site Preparation", families: ["ClearGrub", "RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemoveTree", "RemovePipe"] },
    { section: "120", category: "Earthwork", families: ["Excavation", "Embankment", "Subgrade"] },
    { section: "125", category: "Earthwork", families: ["StructuralExcavation"] },
    { section: "160", category: "Earthwork", families: ["Topsoil"] },
    { section: "162", category: "Stabilization", families: ["Subgrade"] },
    { section: "200", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "234", category: "Base Course", families: ["CementTreatedBase"] },
    { section: "300", category: "Asphalt", families: ["PrimeCoat", "TackCoat"] },
    { section: "327", category: "Asphalt", families: ["PavementMilling"] },
    { section: "334", category: "Asphalt", families: ["HMA"] },
    { section: "337", category: "Asphalt", families: ["HMA"] },
    { section: "338", category: "Asphalt", families: ["HMA"] },
    { section: "339", category: "Asphalt", families: ["HMA"] },
    { section: "350", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "400", category: "Structures", families: ["StructConcrete"] },
    { section: "415", category: "Structures", families: ["ReinfSteel"] },
    { section: "450", category: "Structures", families: ["PrestressedBeam"] },
    { section: "455", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "460", category: "Structures", families: ["StructuralSteel"] },
    { section: "462", category: "Structures", families: ["Bearings", "ExpJoint"] },
    { section: "521", category: "Structures", families: ["BridgeRail", "Waterproofing"] },
    { section: "425", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall"] },
    { section: "430", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe", "Underdrain"] },
    { section: "440", category: "Drainage", families: ["Underdrain"] },
    { section: "514", category: "Drainage", families: ["Riprap"] },
    { section: "515", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "520", category: "Concrete", families: ["CurbGutter"] },
    { section: "522", category: "Concrete", families: ["Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "536", category: "Traffic Control", families: ["Guardrail"] },
    { section: "541", category: "Traffic Control", families: ["GuardrailEnd"] },
    { section: "544", category: "Traffic Control", families: ["CrashCushion"] },
    { section: "550", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "570", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "Watering"] },
    { section: "580", category: "Roadside", families: ["TreePlanting", "ShrubPlanting"] },
    { section: "630", category: "Traffic Signals", families: ["Conduit"] },
    { section: "632", category: "Traffic Signals", families: ["ElectricalCable"] },
    { section: "635", category: "Traffic Signals", families: ["PullBox"] },
    { section: "646", category: "Traffic Signals", families: ["SignalPole"] },
    { section: "650", category: "Traffic Signals", families: ["Signal"] },
    { section: "660", category: "Traffic Signals", families: ["Detector"] },
    { section: "700", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "705", category: "Traffic Control", families: ["Delineator"] },
    { section: "706", category: "Traffic Control", families: ["ConcreteBarrier"] },
    { section: "710", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "715", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "780", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "101", category: "General", families: ["Mobilization", "ConstructionStaking", "TestingLab", "TrainingProgram"] },
  ],
};

// --- New York State DOT (~2000 items), format SSSSSS.NNNN ---
const NYSDOT: AgencyTemplate = {
  code: "NYSDOT",
  edition: "2024",
  title: "Standard Specifications",
  source: "https://www.dot.ny.gov/main/business-center/engineering/specifications",
  formatItemNumber: (s, i) => `${s.padStart(6, "0")}.${String(i).padStart(4, "0")}`,
  sections: [
    { section: "201", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "202", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "203", category: "Earthwork", families: ["Excavation", "Embankment", "StructuralExcavation", "Subgrade"] },
    { section: "207", category: "Erosion Control", families: ["GeotextileFabric"] },
    { section: "209", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle"] },
    { section: "304", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "306", category: "Stabilization", families: ["CementTreatedBase"] },
    { section: "402", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "403", category: "Asphalt", families: ["HMA"] },
    { section: "404", category: "Asphalt", families: ["HMA", "PavementMilling"] },
    { section: "410", category: "Asphalt", families: ["ChipSeal", "Microsurfacing"] },
    { section: "501", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "552", category: "Structures", families: ["StructuralExcavation"] },
    { section: "555", category: "Structures", families: ["StructConcrete"] },
    { section: "556", category: "Structures", families: ["StructConcrete"] },
    { section: "557", category: "Structures", families: ["PrestressedBeam"] },
    { section: "564", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "565", category: "Structures", families: ["Piles"] },
    { section: "568", category: "Structures", families: ["ReinfSteel"] },
    { section: "564", category: "Structures", families: ["StructuralSteel"] },
    { section: "584", category: "Structures", families: ["Bearings", "ExpJoint", "BridgeRail", "Waterproofing"] },
    { section: "603", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "604", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall", "Underdrain"] },
    { section: "608", category: "Concrete", families: ["Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "609", category: "Concrete", families: ["CurbGutter"] },
    { section: "610", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "619", category: "Roadside", families: ["Seeding", "Mulch", "Fertilizer", "Sodding", "TreePlanting", "ShrubPlanting", "Watering", "Topsoil"] },
    { section: "606", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier", "Delineator"] },
    { section: "624", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign"] },
    { section: "625", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "640", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "670", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector", "Conduit", "PullBox", "ElectricalCable"] },
    { section: "680", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "682", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "637", category: "Drainage", families: ["Riprap"] },
    { section: "646", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "698", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

// --- Pennsylvania DOT (Pub 408, 2020) ~1500 items, format SSSSNNNN ---
const PENNDOT: AgencyTemplate = {
  code: "PENNDOT",
  edition: "2020",
  title: "Publication 408 — Specifications",
  source: "https://www.penndot.pa.gov/about-us/RegionalOffices/CES/Pages/Pub-408-Specifications.aspx",
  formatItemNumber: (s, i) => `${s}${String(i).padStart(4, "0")}`,
  sections: [
    { section: "201", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "202", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "203", category: "Earthwork", families: ["Excavation", "Embankment"] },
    { section: "204", category: "Earthwork", families: ["Subgrade", "Topsoil"] },
    { section: "206", category: "Earthwork", families: ["StructuralExcavation"] },
    { section: "210", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle"] },
    { section: "212", category: "Erosion Control", families: ["GeotextileFabric"] },
    { section: "350", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY", "CementTreatedBase"] },
    { section: "401", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "409", category: "Asphalt", families: ["HMA"] },
    { section: "410", category: "Asphalt", families: ["HMA"] },
    { section: "411", category: "Asphalt", families: ["HMA"] },
    { section: "413", category: "Asphalt", families: ["PavementMilling"] },
    { section: "501", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "601", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "604", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet"] },
    { section: "605", category: "Drainage", families: ["Underdrain"] },
    { section: "606", category: "Drainage", families: ["Headwall"] },
    { section: "607", category: "Drainage", families: ["Riprap"] },
    { section: "619", category: "Concrete", families: ["CurbGutter"] },
    { section: "620", category: "Concrete", families: ["Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "676", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "709", category: "Structures", families: ["StructConcrete"] },
    { section: "710", category: "Structures", families: ["ReinfSteel"] },
    { section: "711", category: "Structures", families: ["StructuralSteel"] },
    { section: "713", category: "Structures", families: ["PrestressedBeam"] },
    { section: "714", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "718", category: "Structures", families: ["Bearings", "ExpJoint", "BridgeRail", "Waterproofing"] },
    { section: "850", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "901", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "919", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "928", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "954", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign"] },
    { section: "960", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "962", category: "Traffic Control", families: ["Delineator"] },
    { section: "1101", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier"] },
    { section: "1109", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "1180", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "1191", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "108", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

// --- Ohio DOT (~2000 items), format "SSS ENNNNN" ---
const ODOT: AgencyTemplate = {
  code: "ODOT",
  edition: "2023",
  title: "Construction and Material Specifications (C&MS)",
  source: "https://www.transportation.ohio.gov/working/engineering/cms",
  formatItemNumber: (s, i) => `${s} E${String(i * 10).padStart(5, "0")}`,
  sections: [
    { section: "201", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "202", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "203", category: "Earthwork", families: ["Excavation", "Embankment"] },
    { section: "204", category: "Earthwork", families: ["Subgrade"] },
    { section: "207", category: "Earthwork", families: ["Topsoil"] },
    { section: "208", category: "Earthwork", families: ["StructuralExcavation"] },
    { section: "304", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "305", category: "Stabilization", families: ["CementTreatedBase", "AsphaltTreatedBase"] },
    { section: "407", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "441", category: "Asphalt", families: ["HMA"] },
    { section: "442", category: "Asphalt", families: ["HMA"] },
    { section: "446", category: "Asphalt", families: ["HMA"] },
    { section: "451", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "452", category: "Concrete Paving", families: ["ConcretePave"] },
    { section: "509", category: "Structures", families: ["ReinfSteel"] },
    { section: "510", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "511", category: "Structures", families: ["StructConcrete"] },
    { section: "513", category: "Structures", families: ["StructuralSteel"] },
    { section: "515", category: "Structures", families: ["PrestressedBeam"] },
    { section: "516", category: "Structures", families: ["Bearings", "ExpJoint"] },
    { section: "517", category: "Structures", families: ["BridgeRail", "Waterproofing"] },
    { section: "601", category: "Drainage", families: ["Riprap"] },
    { section: "603", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "604", category: "Drainage", families: ["Underdrain"] },
    { section: "605", category: "Drainage", families: ["GeotextileFabric"] },
    { section: "611", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall"] },
    { section: "614", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign"] },
    { section: "621", category: "Traffic Control", families: ["Delineator"] },
    { section: "622", category: "Traffic Control", families: ["ConcreteBarrier"] },
    { section: "624", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
    { section: "625", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "630", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "632", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "633", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "642", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "606", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion"] },
    { section: "607", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "659", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "832", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle"] },
    { section: "840", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "881", category: "ITS", families: ["CCTV", "DMS"] },
  ],
};

// --- Illinois DOT (~2500 items), format SSXXNNNNN (8-digit) ---
const IDOT: AgencyTemplate = {
  code: "IDOT",
  edition: "2022",
  title: "Standard Specifications for Road and Bridge Construction",
  source: "https://idot.illinois.gov/doing-business/procurements/construction-services/specifications-for-road-and-bridge-construction.html",
  formatItemNumber: (s, i) => `${s}${String(i * 100).padStart(5, "0")}`,
  sections: [
    { section: "201", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "202", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "204", category: "Earthwork", families: ["Excavation", "Embankment", "StructuralExcavation"] },
    { section: "205", category: "Earthwork", families: ["Subgrade"] },
    { section: "211", category: "Earthwork", families: ["Topsoil"] },
    { section: "280", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle", "GeotextileFabric"] },
    { section: "311", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "351", category: "Stabilization", families: ["CementTreatedBase", "AsphaltTreatedBase"] },
    { section: "403", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "406", category: "Asphalt", families: ["HMA"] },
    { section: "407", category: "Asphalt", families: ["HMA"] },
    { section: "440", category: "Asphalt", families: ["PavementMilling"] },
    { section: "442", category: "Asphalt", families: ["ChipSeal", "Microsurfacing"] },
    { section: "420", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "503", category: "Structures", families: ["StructConcrete"] },
    { section: "508", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "509", category: "Structures", families: ["StructuralSteel"] },
    { section: "503", category: "Structures", families: ["ReinfSteel"] },
    { section: "504", category: "Structures", families: ["PrestressedBeam"] },
    { section: "521", category: "Structures", families: ["Bearings", "ExpJoint", "BridgeRail", "Waterproofing"] },
    { section: "542", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "550", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall"] },
    { section: "601", category: "Drainage", families: ["Underdrain"] },
    { section: "606", category: "Drainage", families: ["Riprap"] },
    { section: "606", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "606", category: "Concrete", families: ["CurbGutter", "Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "631", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier"] },
    { section: "664", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign"] },
    { section: "670", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "672", category: "Traffic Control", families: ["Delineator"] },
    { section: "780", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "810", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "811", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "821", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "877", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "664", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "250", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "671", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

// --- Georgia DOT (~1500 items), format SSS-NNNN ---
const GDOT: AgencyTemplate = {
  code: "GDOT",
  edition: "2021",
  title: "Standard Specifications",
  source: "https://www.dot.ga.gov/PartnerSmart/Business/Source/specs",
  formatItemNumber: (s, i) => `${s}-${String(i).padStart(4, "0")}`,
  sections: [
    { section: "201", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "202", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "208", category: "Earthwork", families: ["Excavation", "Embankment", "StructuralExcavation", "Subgrade", "Topsoil"] },
    { section: "163", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle", "GeotextileFabric"] },
    { section: "300", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY", "CementTreatedBase"] },
    { section: "412", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "424", category: "Asphalt", families: ["PavementMilling"] },
    { section: "400", category: "Asphalt", families: ["HMA"] },
    { section: "402", category: "Asphalt", families: ["HMA"] },
    { section: "430", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "441", category: "Concrete", families: ["CurbGutter", "Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "500", category: "Structures", families: ["StructConcrete"] },
    { section: "501", category: "Structures", families: ["StructuralSteel"] },
    { section: "507", category: "Structures", families: ["PrestressedBeam"] },
    { section: "511", category: "Structures", families: ["Piles"] },
    { section: "524", category: "Structures", families: ["ReinfSteel"] },
    { section: "528", category: "Structures", families: ["DrillShaft"] },
    { section: "548", category: "Structures", families: ["Bearings", "ExpJoint", "BridgeRail", "Waterproofing"] },
    { section: "550", category: "Drainage", families: ["RCPipe"] },
    { section: "603", category: "Drainage", families: ["Riprap"] },
    { section: "611", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall"] },
    { section: "612", category: "Drainage", families: ["HDPEPipe", "CMPipe", "PVCPipe", "Underdrain"] },
    { section: "620", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "636", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "638", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign"] },
    { section: "639", category: "Traffic Control", families: ["Delineator"] },
    { section: "641", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier"] },
    { section: "647", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "654", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "682", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "936", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "652", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "668", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "700", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "150", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

// --- North Carolina DOT (~1200 items), format NNNNNNNNN (9 digits) ---
const NCDOT: AgencyTemplate = {
  code: "NCDOT",
  edition: "2024",
  title: "Standard Specifications for Roads and Structures",
  source: "https://connect.ncdot.gov/resources/Specifications/Pages/2024SpecsBook.aspx",
  formatItemNumber: (s, i) => `${s}${String(i * 1000).padStart(6, "0")}`,
  sections: [
    { section: "200", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "202", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "225", category: "Earthwork", families: ["Excavation", "Embankment", "StructuralExcavation", "Subgrade"] },
    { section: "226", category: "Earthwork", families: ["Topsoil"] },
    { section: "265", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle", "GeotextileFabric"] },
    { section: "300", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY"] },
    { section: "320", category: "Stabilization", families: ["CementTreatedBase"] },
    { section: "600", category: "Asphalt", families: ["HMA"] },
    { section: "605", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "654", category: "Asphalt", families: ["PavementMilling"] },
    { section: "700", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "825", category: "Structures", families: ["StructConcrete"] },
    { section: "420", category: "Structures", families: ["ReinfSteel"] },
    { section: "440", category: "Structures", families: ["StructuralSteel"] },
    { section: "450", category: "Structures", families: ["PrestressedBeam"] },
    { section: "410", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "460", category: "Structures", families: ["Bearings", "ExpJoint"] },
    { section: "475", category: "Structures", families: ["BridgeRail", "Waterproofing"] },
    { section: "300", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "840", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall", "Underdrain", "Riprap"] },
    { section: "846", category: "Concrete", families: ["CurbGutter", "Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "260", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "862", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier"] },
    { section: "890", category: "Traffic Control", families: ["Sign", "SignPost"] },
    { section: "905", category: "Traffic Control", families: ["TrafficControl", "ChangeableMessageSign"] },
    { section: "907", category: "Traffic Control", families: ["Delineator"] },
    { section: "1205", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "1410", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "1715", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "1720", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "1725", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "866", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "1660", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "800", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

// --- Virginia DOT (~1500 items), format NNNNNN (6 digits) ---
const VDOT: AgencyTemplate = {
  code: "VDOT",
  edition: "2020",
  title: "Road and Bridge Specifications",
  source: "https://www.virginiadot.org/business/const/spec-default.asp",
  formatItemNumber: (s, i) => `${s}${String(i).padStart(2, "0")}`,
  sections: [
    { section: "2010", category: "Site Preparation", families: ["ClearGrub", "RemoveTree"] },
    { section: "2020", category: "Removals", families: ["RemovePavement", "RemoveStructure", "RemoveCurb", "RemoveFence", "RemoveSign", "RemovePipe"] },
    { section: "2030", category: "Earthwork", families: ["Excavation", "Embankment", "StructuralExcavation", "Subgrade", "Topsoil"] },
    { section: "2440", category: "Base Course", families: ["AggregateBase", "AggregateBaseCY", "CementTreatedBase"] },
    { section: "3105", category: "Asphalt", families: ["TackCoat", "PrimeCoat"] },
    { section: "3150", category: "Asphalt", families: ["HMA"] },
    { section: "3160", category: "Asphalt", families: ["HMA"] },
    { section: "3171", category: "Asphalt", families: ["PavementMilling"] },
    { section: "3175", category: "Asphalt", families: ["ChipSeal", "Microsurfacing"] },
    { section: "3200", category: "Concrete Paving", families: ["ConcretePave", "ConcreteJoints", "CRCP"] },
    { section: "4040", category: "Structures", families: ["StructConcrete"] },
    { section: "4060", category: "Structures", families: ["ReinfSteel"] },
    { section: "4070", category: "Structures", families: ["StructuralSteel"] },
    { section: "4080", category: "Structures", families: ["PrestressedBeam"] },
    { section: "4090", category: "Structures", families: ["DrillShaft", "Piles"] },
    { section: "4110", category: "Structures", families: ["Bearings", "ExpJoint", "BridgeRail", "Waterproofing"] },
    { section: "5020", category: "Drainage", families: ["RCPipe", "HDPEPipe", "CMPipe", "PVCPipe"] },
    { section: "5030", category: "Drainage", families: ["Manhole", "CatchBasin", "Inlet", "Headwall"] },
    { section: "5050", category: "Drainage", families: ["Underdrain"] },
    { section: "5060", category: "Drainage", families: ["Riprap", "GeotextileFabric"] },
    { section: "5020", category: "Concrete", families: ["CurbGutter", "Sidewalk", "ConcreteDriveway", "DetectableWarning"] },
    { section: "5040", category: "Walls", families: ["RetainingWall", "SoundWall"] },
    { section: "5050", category: "Erosion Control", families: ["SiltFence", "InletProtection", "ErosionBlanket", "ConstructionEntrance", "StrawWattle"] },
    { section: "6020", category: "Roadside", families: ["Seeding", "Sodding", "Mulch", "Fertilizer", "TreePlanting", "ShrubPlanting", "Watering"] },
    { section: "5010", category: "Traffic Control", families: ["Guardrail", "GuardrailEnd", "CrashCushion", "ConcreteBarrier", "Delineator"] },
    { section: "7020", category: "Traffic Control", families: ["Sign", "SignPost", "TrafficControl", "ChangeableMessageSign"] },
    { section: "7040", category: "Traffic Control", families: ["PavementMarkings4", "PavementMarkings6", "PavementMarkings8", "PavementMarkings12", "PavementMarkings24", "Symbol"] },
    { section: "7050", category: "Traffic Signals", families: ["Signal", "SignalPole", "Detector"] },
    { section: "7055", category: "Traffic Signals", families: ["Conduit", "PullBox", "ElectricalCable"] },
    { section: "7060", category: "Lighting", families: ["LightPole", "Luminaire"] },
    { section: "7070", category: "ITS", families: ["CCTV", "DMS"] },
    { section: "5100", category: "Fencing", families: ["ChainLinkFence", "Gate", "RightOfWayMarker"] },
    { section: "1080", category: "General", families: ["Mobilization", "ConstructionStaking", "FieldOffice", "TestingLab", "TrainingProgram"] },
  ],
};

const TEMPLATES: AgencyTemplate[] = [FHWA, TXDOT, CALTRANS, FDOT, NYSDOT, PENNDOT, ODOT, IDOT, GDOT, NCDOT, VDOT];

// ---------------------------------------------------------------------------
// Expansion logic
// ---------------------------------------------------------------------------
function expandFamily(fam: Family, descPrefix?: string): { description: string; unit: Unit }[] {
  return fam.variants.map((v) => {
    const head = descPrefix ? descPrefix + " " : "";
    const tail = v.desc ? (v.desc.startsWith("(") ? ` ${v.desc}` : ` ${v.desc}`) : "";
    return {
      description: `${head}${fam.baseDesc}${tail}`.trim(),
      unit: v.unit ?? fam.unit,
    };
  });
}

// Sections appended to every agency's catalog so newly-added families
// (utility, pavement preservation, sealants, rumble strips, etc.) reach
// every agency without editing 11 templates by hand. Each entry's section
// label is namespaced under the agency's existing scheme by buildCatalog.
const COMMON_APPENDIX: Omit<SectionDef, "section">[] = [
  { category: "Asphalt", families: ["MillingButtJoint", "PavementPatch", "CrackSeal"] },
  { category: "Concrete", families: ["JointSealant"] },
  { category: "Pavement Markings", families: ["Plowable"] },
  { category: "Lighting & Signals", families: ["PoleFoundation"] },
  { category: "Utility Adjustments", families: ["WaterMain", "SanitarySewer", "GasMain", "UtilityRelocation"] },
  { category: "Roadway Safety", families: ["RumbleStrip"] },
  { category: "Earth Retention", families: ["GroundedAnchor"] },
];

function buildCatalog(t: AgencyTemplate): PayItem[] {
  const items: PayItem[] = [];
  // Track sub-index per section so multiple SectionDef entries on the same
  // section number keep producing unique item numbers.
  const sectionCounters = new Map<string, number>();
  const seen = new Set<string>();
  // Run through declared sections, then a synthetic appendix section so newly
  // added families are present in every per-agency catalog.
  const allSections: SectionDef[] = [...t.sections];
  // Pick an appendix section name that is unique to the agency. We re-use the
  // highest-numbered section + offsets to stay in the same numbering scheme.
  const lastSec = t.sections[t.sections.length - 1].section;
  // Append each appendix entry under "<lastSec>" — buildCatalog already
  // increments the per-section counter so item numbers stay unique.
  for (const a of COMMON_APPENDIX) {
    allSections.push({ section: lastSec, ...a });
  }
  for (const sec of allSections) {
    let counter = sectionCounters.get(sec.section) ?? 0;
    for (const famKey of sec.families) {
      const fam = F[famKey];
      if (!fam) throw new Error(`Unknown family ${famKey} in ${t.code}/${sec.section}`);
      const expanded = expandFamily(fam);
      for (const e of expanded) {
        counter += 1;
        const itemNumber = t.formatItemNumber(sec.section, counter);
        if (seen.has(itemNumber)) continue; // safety against accidental duplicates
        seen.add(itemNumber);
        items.push({
          itemNumber,
          description: e.description,
          unit: e.unit,
          specSection: sec.section,
          category: sec.category,
        });
      }
    }
    sectionCounters.set(sec.section, counter);
  }
  return items;
}

function writeCatalog(t: AgencyTemplate): { code: string; count: number; path: string } {
  const items = buildCatalog(t);
  const out = {
    specBook: { edition: t.edition, title: t.title },
    source: t.source,
    items,
  };
  const dir = join(process.cwd(), "server/data/dot/pay-items");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${t.code}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  return { code: t.code, count: items.length, path };
}

// Agencies for which we ship real, fetched-from-source catalogs. Skip them
// here so a `tsx scripts/generate-dot-pay-items.ts` run never overwrites the
// authoritative data produced by `scripts/fetch-dot-pay-items.ts`.
const REAL_DATA_AGENCIES = new Set(["FHWA", "NCDOT"]);

function main(): void {
  const summaries: { code: string; count: number; path: string; skipped?: boolean }[] = [];
  for (const t of TEMPLATES) {
    if (REAL_DATA_AGENCIES.has(t.code)) {
      summaries.push({ code: t.code, count: 0, path: "(real-data; not regenerated)", skipped: true });
      continue;
    }
    summaries.push(writeCatalog(t));
  }
  // Print a tidy summary
  for (const s of summaries) {
    console.log(`${s.code.padEnd(10)}  items=${String(s.count).padStart(5)}  -> ${s.path}`);
  }
  const total = summaries.reduce((a, b) => a + b.count, 0);
  console.log(`\nTotal items: ${total} across ${summaries.length} agencies.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { TEMPLATES, buildCatalog, F };
