import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STONE_DENSITIES: Record<string, number> = {
  CRUSHED_STONE: 1.5,
  LIMESTONE: 1.35,
  COMPACTED_BASE: 1.6,
  PEA_GRAVEL: 1.42,
  RECYCLED_CONCRETE: 1.45,
};

const STONE_TYPE_LABELS: Record<string, string> = {
  CRUSHED_STONE: "Crushed Stone",
  LIMESTONE: "Limestone",
  COMPACTED_BASE: "Compacted Base",
  PEA_GRAVEL: "Pea Gravel",
  RECYCLED_CONCRETE: "Recycled Concrete",
};

const STONE_SIZES: Record<string, { label: string; description: string }> = {
  "304": { label: "#304 Limestone", description: "Fine graded base material" },
  "#1": { label: "#1 Stone", description: "3-4 inch diameter" },
  "#2": { label: "#2 Stone", description: "2-3 inch diameter" },
  "#3": { label: "#3 Stone", description: "1.5-2 inch diameter" },
  "#4": { label: "#4 Stone", description: "1-1.5 inch diameter" },
  "#57": { label: "#57 Stone", description: "3/4-1 inch (common gravel)" },
  "#67": { label: "#67 Stone", description: "1/2-3/4 inch" },
  "#8": { label: "#8 Stone", description: "3/8-1/2 inch (pea gravel)" },
  "#9": { label: "#9 Stone", description: "1/4-3/8 inch (screenings)" },
  "#10": { label: "#10 Stone", description: "1/8 inch (stone dust)" },
  RIP_RAP: { label: "Rip Rap", description: "Large erosion control (6-24 inch)" },
};

const REBAR_FAB_TYPES: Record<string, { label: string; description: string }> = {
  FIELD_TIED: { label: "Field Tied (Loose)", description: "Rebar cut and tied on-site" },
  PREFAB_MAT: { label: "Prefab Mat", description: "Pre-fabricated flat mats" },
  PREFAB_CAGE: { label: "Prefab Cage", description: "Pre-fabricated column/beam cages" },
  FIBER_MESH: { label: "Fiber Mesh", description: "Synthetic fiber reinforcement alternative" },
};

const WIRE_MESH_TYPES: Record<string, { label: string; coverageSF: number }> = {
  "6x6_W1.4": { label: "6x6 W1.4/W1.4 (Light)", coverageSF: 100 },
  "6x6_W2.9": { label: "6x6 W2.9/W2.9 (Medium)", coverageSF: 100 },
  "6x6_W4": { label: "6x6 W4/W4 (Heavy)", coverageSF: 100 },
  "4x4_W2.9": { label: "4x4 W2.9/W2.9 (Extra Heavy)", coverageSF: 100 },
};

const REBAR_SIZES: Record<string, { label: string; lengthFt: number }> = {
  "#3": { label: "#3 (3/8\")", lengthFt: 20 },
  "#4": { label: "#4 (1/2\")", lengthFt: 20 },
  "#5": { label: "#5 (5/8\")", lengthFt: 20 },
  "#6": { label: "#6 (3/4\")", lengthFt: 20 },
};

const SEALER_TYPES: Record<string, { label: string; coverageSFPerGallon: number }> = {
  CURE_SEAL: { label: "Cure & Seal", coverageSFPerGallon: 200 },
  ACRYLIC: { label: "Acrylic Sealer", coverageSFPerGallon: 250 },
  PENETRATING: { label: "Penetrating Sealer", coverageSFPerGallon: 150 },
  EPOXY: { label: "Epoxy Sealer", coverageSFPerGallon: 100 },
};

const UNDERLAYMENT_TYPES: Record<string, { label: string; rollWidthFt: number; rollLengthFt: number }> = {
  "6MIL_POLY": { label: "6 mil Poly (Vapor Barrier)", rollWidthFt: 10, rollLengthFt: 100 },
  "10MIL_POLY": { label: "10 mil Poly (Heavy Duty)", rollWidthFt: 10, rollLengthFt: 100 },
  VISQUEEN: { label: "Visqueen", rollWidthFt: 10, rollLengthFt: 100 },
};

type ConcreteShape = "area" | "slab" | "footing" | "column";

export default function MaterialEstimatorCalculator() {
  const [areaMode, setAreaMode] = useState<"dimensions" | "sqft">("dimensions");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [totalSqft, setTotalSqft] = useState("");

  const [enableConcrete, setEnableConcrete] = useState(true);
  const [concreteShape, setConcreteShape] = useState<ConcreteShape>("area");
  const [concreteDepth, setConcreteDepth] = useState("4");
  const [concreteWaste, setConcreteWaste] = useState("10");

  const [slabLength, setSlabLength] = useState("");
  const [slabWidth, setSlabWidth] = useState("");
  const [slabThickness, setSlabThickness] = useState("");

  const [footingLength, setFootingLength] = useState("");
  const [footingWidth, setFootingWidth] = useState("");
  const [footingDepth, setFootingDepth] = useState("");

  const [columnDiameter, setColumnDiameter] = useState("");
  const [columnHeight, setColumnHeight] = useState("");
  const [columnQuantity, setColumnQuantity] = useState("1");

  const [enableStone, setEnableStone] = useState(false);
  const [stoneType, setStoneType] = useState("CRUSHED_STONE");
  const [stoneSize, setStoneSize] = useState("#57");
  const [stoneDepth, setStoneDepth] = useState("4");
  const [stoneWaste, setStoneWaste] = useState("10");

  const [enableExcavation, setEnableExcavation] = useState(false);
  const [excavationDepth, setExcavationDepth] = useState("8");
  const [excavationSwell, setExcavationSwell] = useState("25");

  const [enableReinforcement, setEnableReinforcement] = useState(false);
  const [reinforcementMode, setReinforcementMode] = useState<"wiremesh" | "rebar">("wiremesh");
  const [wireMeshType, setWireMeshType] = useState("6x6_W1.4");
  const [wireMeshWaste, setWireMeshWaste] = useState("10");
  const [rebarSize, setRebarSize] = useState("#4");
  const [rebarSpacing, setRebarSpacing] = useState("12");
  const [rebarWaste, setRebarWaste] = useState("10");

  const [enableSealer, setEnableSealer] = useState(false);
  const [sealerType, setSealerType] = useState("CURE_SEAL");
  const [sealerCoats, setSealerCoats] = useState("1");
  const [sealerWaste, setSealerWaste] = useState("10");

  const [enableUnderlayment, setEnableUnderlayment] = useState(false);
  const [underlaymentType, setUnderlaymentType] = useState("6MIL_POLY");
  const [underlaymentOverlap, setUnderlaymentOverlap] = useState("6");

  const areaSF = useMemo(() => {
    if (areaMode === "sqft") {
      return parseFloat(totalSqft) || 0;
    }
    const l = parseFloat(length);
    const w = parseFloat(width);
    if (!l || !w || l <= 0 || w <= 0) return 0;
    return l * w;
  }, [areaMode, length, width, totalSqft]);

  const concreteResult = useMemo(() => {
    if (!enableConcrete) return null;
    const waste = parseFloat(concreteWaste) || 0;
    let cubicFeet = 0;
    let volumePerColumn: number | null = null;

    if (concreteShape === "area") {
      if (areaSF <= 0) return null;
      const depth = parseFloat(concreteDepth) || 0;
      if (depth <= 0) return null;
      cubicFeet = areaSF * (depth / 12);
    } else if (concreteShape === "slab") {
      const l = parseFloat(slabLength) || 0;
      const w = parseFloat(slabWidth) || 0;
      const t = parseFloat(slabThickness) || 0;
      if (l <= 0 || w <= 0 || t <= 0) return null;
      cubicFeet = l * w * (t / 12);
    } else if (concreteShape === "footing") {
      const l = parseFloat(footingLength) || 0;
      const w = parseFloat(footingWidth) || 0;
      const d = parseFloat(footingDepth) || 0;
      if (l <= 0 || w <= 0 || d <= 0) return null;
      cubicFeet = l * (w / 12) * (d / 12);
    } else if (concreteShape === "column") {
      const dia = parseFloat(columnDiameter) || 0;
      const h = parseFloat(columnHeight) || 0;
      const qty = parseInt(columnQuantity, 10) || 0;
      if (dia <= 0 || h <= 0 || qty <= 0) return null;
      const radiusFt = dia / 2 / 12;
      volumePerColumn = Math.PI * radiusFt * radiusFt * h;
      cubicFeet = volumePerColumn * qty;
    }

    if (cubicFeet <= 0) return null;

    const cubicYards = cubicFeet / 27;
    const withWaste = cubicYards * (1 + waste / 100);
    const totalCuFt = cubicFeet * (1 + waste / 100);
    const bags80 = Math.ceil(totalCuFt / 0.6);
    const bags60 = Math.ceil(totalCuFt / 0.45);

    return {
      cubicFeet,
      cubicYards,
      withWaste: Math.ceil(withWaste * 100) / 100,
      bags80,
      bags60,
      volumePerColumn,
    };
  }, [enableConcrete, concreteShape, areaSF, concreteDepth, concreteWaste, slabLength, slabWidth, slabThickness, footingLength, footingWidth, footingDepth, columnDiameter, columnHeight, columnQuantity]);

  const stoneResult = useMemo(() => {
    if (!enableStone || areaSF <= 0) return null;
    const depth = parseFloat(stoneDepth) || 0;
    if (depth <= 0) return null;
    const waste = parseFloat(stoneWaste) || 0;
    const cubicFeet = areaSF * (depth / 12);
    const cubicYards = cubicFeet / 27;
    const density = STONE_DENSITIES[stoneType] || 1.5;
    const tons = cubicYards * density;
    const withWaste = tons * (1 + waste / 100);
    return { cubicYards, tons, withWaste: Math.ceil(withWaste * 100) / 100 };
  }, [enableStone, areaSF, stoneDepth, stoneType, stoneWaste]);

  const excavationResult = useMemo(() => {
    if (!enableExcavation || areaSF <= 0) return null;
    const depth = parseFloat(excavationDepth) || 0;
    if (depth <= 0) return null;
    const swell = parseFloat(excavationSwell) || 0;
    const cubicFeet = areaSF * (depth / 12);
    const cubicYards = cubicFeet / 27;
    const withSwell = cubicYards * (1 + swell / 100);
    return { cubicYards, withSwell: Math.ceil(withSwell * 100) / 100 };
  }, [enableExcavation, areaSF, excavationDepth, excavationSwell]);

  const reinforcementResult = useMemo(() => {
    if (!enableReinforcement || areaSF <= 0) return null;

    if (reinforcementMode === "wiremesh") {
      const waste = parseFloat(wireMeshWaste) || 0;
      const mesh = WIRE_MESH_TYPES[wireMeshType];
      const coverage = mesh?.coverageSF || 100;
      const totalSF = areaSF * (1 + waste / 100);
      const rolls = Math.ceil(totalSF / coverage);
      return { type: "wiremesh" as const, rolls, totalSF: Math.ceil(totalSF) };
    }

    const spacing = parseFloat(rebarSpacing) || 12;
    const waste = parseFloat(rebarWaste) || 0;
    const rebar = REBAR_SIZES[rebarSize];
    const barLength = rebar?.lengthFt || 20;
    const spacingFeet = spacing / 12;
    const sideLength = Math.sqrt(areaSF);
    const barsPerDirection = Math.ceil(sideLength / spacingFeet) + 1;
    const linearFeetPerDirection = barsPerDirection * sideLength;
    const totalLinearFeet = linearFeetPerDirection * 2;
    const adjustedLF = totalLinearFeet * (1 + waste / 100);
    const count = Math.ceil(adjustedLF / barLength);
    return {
      type: "rebar" as const,
      count,
      linearFeet: Math.ceil(adjustedLF * 100) / 100,
    };
  }, [enableReinforcement, areaSF, reinforcementMode, wireMeshType, wireMeshWaste, rebarSize, rebarSpacing, rebarWaste]);

  const sealerResult = useMemo(() => {
    if (!enableSealer || areaSF <= 0) return null;
    const coats = parseInt(sealerCoats) || 1;
    const waste = parseFloat(sealerWaste) || 0;
    const sealer = SEALER_TYPES[sealerType];
    const coverage = sealer?.coverageSFPerGallon || 200;
    const totalSF = areaSF * (1 + waste / 100) * coats;
    const gallons = Math.ceil((totalSF / coverage) * 100) / 100;
    return { gallons, totalSF: Math.ceil(totalSF) };
  }, [enableSealer, areaSF, sealerType, sealerCoats, sealerWaste]);

  const underlaymentResult = useMemo(() => {
    if (!enableUnderlayment || areaSF <= 0) return null;
    const overlap = parseFloat(underlaymentOverlap) || 6;
    const overlapFactor = 1 + (overlap / 12) / 10;
    const totalSF = Math.ceil(areaSF * overlapFactor);
    const uType = UNDERLAYMENT_TYPES[underlaymentType];
    const rollSF = (uType?.rollWidthFt || 10) * (uType?.rollLengthFt || 100);
    const rolls = Math.ceil(totalSF / rollSF);
    return { totalSF, rolls, rollSF };
  }, [enableUnderlayment, areaSF, underlaymentType, underlaymentOverlap]);

  const hasResults = concreteResult || ((areaSF > 0) && (stoneResult || excavationResult || reinforcementResult || sealerResult || underlaymentResult));

  return (
    <Card data-testid="calculator-material-estimator">
      <CardHeader>
        <CardTitle>Concrete & Materials</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate concrete volumes by shape, plus stone, excavation, reinforcement, sealer, and underlayment quantities
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Area Dimensions</h3>
          <div className="space-y-2">
            <Label>Input Mode</Label>
            <Select value={areaMode} onValueChange={(v) => setAreaMode(v as "dimensions" | "sqft")}>
              <SelectTrigger data-testid="select-area-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dimensions">Length x Width (ft)</SelectItem>
                <SelectItem value="sqft">Total Square Footage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {areaMode === "dimensions" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="me-length">Length (ft)</Label>
                <Input
                  id="me-length"
                  data-testid="input-me-length"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="e.g. 50"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-width">Width (ft)</Label>
                <Input
                  id="me-width"
                  data-testid="input-me-width"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="e.g. 30"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="me-sqft">Total Square Footage</Label>
              <Input
                id="me-sqft"
                data-testid="input-me-sqft"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 1500"
                value={totalSqft}
                onChange={(e) => setTotalSqft(e.target.value)}
              />
            </div>
          )}
          {areaSF > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Total Area:</span>
              <Badge variant="secondary" data-testid="result-total-area">{areaSF.toFixed(1)} SF</Badge>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label htmlFor="toggle-concrete" className="font-semibold">Concrete</Label>
            <Switch
              id="toggle-concrete"
              data-testid="switch-concrete"
              checked={enableConcrete}
              onCheckedChange={setEnableConcrete}
            />
          </div>
          {enableConcrete && (
            <div className="space-y-4">
              <Tabs value={concreteShape} onValueChange={(v) => setConcreteShape(v as ConcreteShape)}>
                <TabsList className="w-full flex-wrap" data-testid="tabs-concrete-shape">
                  <TabsTrigger value="area" data-testid="tab-concrete-area">Simple Area</TabsTrigger>
                  <TabsTrigger value="slab" data-testid="tab-concrete-slab">Slab / Pad</TabsTrigger>
                  <TabsTrigger value="footing" data-testid="tab-concrete-footing">Footing / Wall</TabsTrigger>
                  <TabsTrigger value="column" data-testid="tab-concrete-column">Column / Pier</TabsTrigger>
                </TabsList>

                <TabsContent value="area" data-testid="tabcontent-concrete-area">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="me-concrete-depth">Depth (inches)</Label>
                      <Input
                        id="me-concrete-depth"
                        data-testid="input-concrete-depth"
                        type="number"
                        min="0"
                        step="0.5"
                        value={concreteDepth}
                        onChange={(e) => setConcreteDepth(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="me-concrete-waste-area">Waste Factor (%)</Label>
                      <Input
                        id="me-concrete-waste-area"
                        data-testid="input-concrete-waste"
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        value={concreteWaste}
                        onChange={(e) => setConcreteWaste(e.target.value)}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="slab" data-testid="tabcontent-concrete-slab">
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="me-slab-length">Length (ft)</Label>
                        <Input
                          id="me-slab-length"
                          data-testid="input-slab-length"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={slabLength}
                          onChange={(e) => setSlabLength(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="me-slab-width">Width (ft)</Label>
                        <Input
                          id="me-slab-width"
                          data-testid="input-slab-width"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={slabWidth}
                          onChange={(e) => setSlabWidth(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="me-slab-thickness">Thickness (inches)</Label>
                        <Input
                          id="me-slab-thickness"
                          data-testid="input-slab-thickness"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={slabThickness}
                          onChange={(e) => setSlabThickness(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="me-concrete-waste-slab">Waste Factor (%)</Label>
                        <Input
                          id="me-concrete-waste-slab"
                          data-testid="input-concrete-waste-slab"
                          type="number"
                          min="0"
                          max="50"
                          step="1"
                          value={concreteWaste}
                          onChange={(e) => setConcreteWaste(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="footing" data-testid="tabcontent-concrete-footing">
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="me-footing-length">Length (ft)</Label>
                        <Input
                          id="me-footing-length"
                          data-testid="input-footing-length"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={footingLength}
                          onChange={(e) => setFootingLength(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="me-footing-width">Width (inches)</Label>
                        <Input
                          id="me-footing-width"
                          data-testid="input-footing-width"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={footingWidth}
                          onChange={(e) => setFootingWidth(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="me-footing-depth">Depth (inches)</Label>
                        <Input
                          id="me-footing-depth"
                          data-testid="input-footing-depth"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={footingDepth}
                          onChange={(e) => setFootingDepth(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="me-concrete-waste-footing">Waste Factor (%)</Label>
                        <Input
                          id="me-concrete-waste-footing"
                          data-testid="input-concrete-waste-footing"
                          type="number"
                          min="0"
                          max="50"
                          step="1"
                          value={concreteWaste}
                          onChange={(e) => setConcreteWaste(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="column" data-testid="tabcontent-concrete-column">
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="me-column-diameter">Diameter (inches)</Label>
                        <Input
                          id="me-column-diameter"
                          data-testid="input-column-diameter"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={columnDiameter}
                          onChange={(e) => setColumnDiameter(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="me-column-height">Height (ft)</Label>
                        <Input
                          id="me-column-height"
                          data-testid="input-column-height"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={columnHeight}
                          onChange={(e) => setColumnHeight(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="me-column-quantity">Quantity</Label>
                        <Input
                          id="me-column-quantity"
                          data-testid="input-column-quantity"
                          type="number"
                          min="1"
                          placeholder="1"
                          value={columnQuantity}
                          onChange={(e) => setColumnQuantity(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="me-concrete-waste-column">Waste Factor (%)</Label>
                        <Input
                          id="me-concrete-waste-column"
                          data-testid="input-concrete-waste-column"
                          type="number"
                          min="0"
                          max="50"
                          step="1"
                          value={concreteWaste}
                          onChange={(e) => setConcreteWaste(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label htmlFor="toggle-stone" className="font-semibold">Stone / Aggregate Base</Label>
            <Switch
              id="toggle-stone"
              data-testid="switch-stone"
              checked={enableStone}
              onCheckedChange={setEnableStone}
            />
          </div>
          {enableStone && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stone Type</Label>
                <Select value={stoneType} onValueChange={setStoneType}>
                  <SelectTrigger data-testid="select-stone-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STONE_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stone Size</Label>
                <Select value={stoneSize} onValueChange={setStoneSize}>
                  <SelectTrigger data-testid="select-stone-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STONE_SIZES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label} - {val.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-stone-depth">Depth (inches)</Label>
                <Input
                  id="me-stone-depth"
                  data-testid="input-stone-depth"
                  type="number"
                  min="0"
                  step="0.5"
                  value={stoneDepth}
                  onChange={(e) => setStoneDepth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-stone-waste">Waste Factor (%)</Label>
                <Input
                  id="me-stone-waste"
                  data-testid="input-stone-waste"
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={stoneWaste}
                  onChange={(e) => setStoneWaste(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label htmlFor="toggle-excavation" className="font-semibold">Excavation</Label>
            <Switch
              id="toggle-excavation"
              data-testid="switch-excavation"
              checked={enableExcavation}
              onCheckedChange={setEnableExcavation}
            />
          </div>
          {enableExcavation && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="me-excavation-depth">Depth (inches)</Label>
                <Input
                  id="me-excavation-depth"
                  data-testid="input-excavation-depth"
                  type="number"
                  min="0"
                  step="0.5"
                  value={excavationDepth}
                  onChange={(e) => setExcavationDepth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-excavation-swell">Swell Factor (%)</Label>
                <Input
                  id="me-excavation-swell"
                  data-testid="input-excavation-swell"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={excavationSwell}
                  onChange={(e) => setExcavationSwell(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label htmlFor="toggle-reinforcement" className="font-semibold">Reinforcement</Label>
            <Switch
              id="toggle-reinforcement"
              data-testid="switch-reinforcement"
              checked={enableReinforcement}
              onCheckedChange={setEnableReinforcement}
            />
          </div>
          {enableReinforcement && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Reinforcement Type</Label>
                <Select value={reinforcementMode} onValueChange={(v) => setReinforcementMode(v as "wiremesh" | "rebar")}>
                  <SelectTrigger data-testid="select-reinforcement-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wiremesh">Wire Mesh</SelectItem>
                    <SelectItem value="rebar">Rebar</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reinforcementMode === "wiremesh" ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Wire Mesh Type</Label>
                    <Select value={wireMeshType} onValueChange={setWireMeshType}>
                      <SelectTrigger data-testid="select-wiremesh-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(WIRE_MESH_TYPES).map(([key, val]) => (
                          <SelectItem key={key} value={key}>{val.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="me-wiremesh-waste">Waste Factor (%)</Label>
                    <Input
                      id="me-wiremesh-waste"
                      data-testid="input-wiremesh-waste"
                      type="number"
                      min="0"
                      max="50"
                      step="1"
                      value={wireMeshWaste}
                      onChange={(e) => setWireMeshWaste(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Rebar Size</Label>
                    <Select value={rebarSize} onValueChange={setRebarSize}>
                      <SelectTrigger data-testid="select-rebar-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(REBAR_SIZES).map(([key, val]) => (
                          <SelectItem key={key} value={key}>{val.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="me-rebar-spacing">Spacing (inches)</Label>
                    <Input
                      id="me-rebar-spacing"
                      data-testid="input-rebar-spacing"
                      type="number"
                      min="1"
                      step="1"
                      value={rebarSpacing}
                      onChange={(e) => setRebarSpacing(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="me-rebar-waste">Waste Factor (%)</Label>
                    <Input
                      id="me-rebar-waste"
                      data-testid="input-rebar-waste"
                      type="number"
                      min="0"
                      max="50"
                      step="1"
                      value={rebarWaste}
                      onChange={(e) => setRebarWaste(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label htmlFor="toggle-sealer" className="font-semibold">Sealer</Label>
            <Switch
              id="toggle-sealer"
              data-testid="switch-sealer"
              checked={enableSealer}
              onCheckedChange={setEnableSealer}
            />
          </div>
          {enableSealer && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Sealer Type</Label>
                <Select value={sealerType} onValueChange={setSealerType}>
                  <SelectTrigger data-testid="select-sealer-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SEALER_TYPES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-sealer-coats">Number of Coats</Label>
                <Input
                  id="me-sealer-coats"
                  data-testid="input-sealer-coats"
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={sealerCoats}
                  onChange={(e) => setSealerCoats(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-sealer-waste">Waste Factor (%)</Label>
                <Input
                  id="me-sealer-waste"
                  data-testid="input-sealer-waste"
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={sealerWaste}
                  onChange={(e) => setSealerWaste(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label htmlFor="toggle-underlayment" className="font-semibold">Underlayment / Vapor Barrier</Label>
            <Switch
              id="toggle-underlayment"
              data-testid="switch-underlayment"
              checked={enableUnderlayment}
              onCheckedChange={setEnableUnderlayment}
            />
          </div>
          {enableUnderlayment && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={underlaymentType} onValueChange={setUnderlaymentType}>
                  <SelectTrigger data-testid="select-underlayment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(UNDERLAYMENT_TYPES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-underlayment-overlap">Overlap (inches)</Label>
                <Input
                  id="me-underlayment-overlap"
                  data-testid="input-underlayment-overlap"
                  type="number"
                  min="0"
                  max="24"
                  step="1"
                  value={underlaymentOverlap}
                  onChange={(e) => setUnderlaymentOverlap(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {hasResults && (
          <>
            <Separator />
            <Card data-testid="me-results-summary">
              <CardHeader>
                <CardTitle className="text-lg">Results Summary</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Calculated material quantities{areaSF > 0 ? ` for ${areaSF.toFixed(1)} SF` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {concreteResult && (
                    <>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">Concrete (with {concreteWaste}% waste)</span>
                        <Badge data-testid="result-concrete-yards">{concreteResult.withWaste} cu yd</Badge>
                      </div>
                      {concreteResult.volumePerColumn !== null && (
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="text-sm text-muted-foreground">Volume per Column</span>
                          <Badge variant="secondary" data-testid="result-volume-per-column">
                            {concreteResult.volumePerColumn.toFixed(2)} cu ft / {(concreteResult.volumePerColumn / 27).toFixed(4)} cu yd
                          </Badge>
                        </div>
                      )}
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">80lb Bags (~0.6 cu ft each)</span>
                        <Badge variant="outline" data-testid="result-bags-80">{concreteResult.bags80}</Badge>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">60lb Bags (~0.45 cu ft each)</span>
                        <Badge variant="outline" data-testid="result-bags-60">{concreteResult.bags60}</Badge>
                      </div>
                    </>
                  )}
                  {stoneResult && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-sm text-muted-foreground">
                        {STONE_TYPE_LABELS[stoneType] || "Stone"} (with {stoneWaste}% waste)
                      </span>
                      <Badge data-testid="result-stone-tons">{stoneResult.withWaste} tons</Badge>
                    </div>
                  )}
                  {excavationResult && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-sm text-muted-foreground">Excavation (with {excavationSwell}% swell)</span>
                      <Badge data-testid="result-excavation-yards">{excavationResult.withSwell} cu yd</Badge>
                    </div>
                  )}
                  {reinforcementResult && reinforcementResult.type === "wiremesh" && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-sm text-muted-foreground">
                        Wire Mesh ({WIRE_MESH_TYPES[wireMeshType]?.label})
                      </span>
                      <Badge data-testid="result-wiremesh-rolls">{reinforcementResult.rolls} roll{reinforcementResult.rolls !== 1 ? "s" : ""}</Badge>
                    </div>
                  )}
                  {reinforcementResult && reinforcementResult.type === "rebar" && (
                    <>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">
                          Rebar {REBAR_SIZES[rebarSize]?.label} @ {rebarSpacing}" o.c.
                        </span>
                        <Badge data-testid="result-rebar-count">{reinforcementResult.count} bars</Badge>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">Rebar Linear Feet</span>
                        <Badge variant="secondary" data-testid="result-rebar-lf">{reinforcementResult.linearFeet} LF</Badge>
                      </div>
                    </>
                  )}
                  {sealerResult && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-sm text-muted-foreground">
                        {SEALER_TYPES[sealerType]?.label} ({sealerCoats} coat{parseInt(sealerCoats) !== 1 ? "s" : ""})
                      </span>
                      <Badge data-testid="result-sealer-gallons">{sealerResult.gallons} gal</Badge>
                    </div>
                  )}
                  {underlaymentResult && (
                    <>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">
                          {UNDERLAYMENT_TYPES[underlaymentType]?.label}
                        </span>
                        <Badge data-testid="result-underlayment-sf">{underlaymentResult.totalSF} SF</Badge>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-sm text-muted-foreground">Rolls needed ({underlaymentResult.rollSF} SF/roll)</span>
                        <Badge variant="secondary" data-testid="result-underlayment-rolls">{underlaymentResult.rolls} roll{underlaymentResult.rolls !== 1 ? "s" : ""}</Badge>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </CardContent>
    </Card>
  );
}
