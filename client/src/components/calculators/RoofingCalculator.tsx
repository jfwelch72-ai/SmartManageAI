import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const PITCH_OPTIONS = [
  { label: "2/12", value: "2" },
  { label: "3/12", value: "3" },
  { label: "4/12", value: "4" },
  { label: "5/12", value: "5" },
  { label: "6/12", value: "6" },
  { label: "7/12", value: "7" },
  { label: "8/12", value: "8" },
  { label: "9/12", value: "9" },
  { label: "10/12", value: "10" },
  { label: "12/12", value: "12" },
];

const MATERIAL_OPTIONS = [
  { label: "Asphalt 3-Tab", value: "asphalt-3tab" },
  { label: "Architectural Shingles", value: "architectural" },
  { label: "Metal Roofing (sq ft panels)", value: "metal" },
];

export default function RoofingCalculator() {
  const [buildingLength, setBuildingLength] = useState<string>("40");
  const [buildingWidth, setBuildingWidth] = useState<string>("30");
  const [roofPitch, setRoofPitch] = useState<string>("6");
  const [overhang, setOverhang] = useState<string>("12");
  const [materialType, setMaterialType] = useState<string>("architectural");
  const [wasteFactor, setWasteFactor] = useState<string>("15");
  const [unitPrice, setUnitPrice] = useState<string>("");

  const results = useMemo(() => {
    const len = parseFloat(buildingLength) || 0;
    const wid = parseFloat(buildingWidth) || 0;
    const pitch = parseFloat(roofPitch) || 0;
    const oh = parseFloat(overhang) || 0;
    const waste = (parseFloat(wasteFactor) || 0) / 100;

    const ohFt = oh / 12;
    const footprintLength = len + 2 * ohFt;
    const footprintWidth = wid + 2 * ohFt;
    const footprintArea = footprintLength * footprintWidth;

    const pitchMultiplier = Math.sqrt(1 + Math.pow(pitch / 12, 2));
    // Roof area = horizontal footprint × slope multiplier. The footprint
    // already covers the horizontal projection of *both* slopes of a gable
    // roof, so we do NOT multiply by 2 (a previous version did, which
    // doubled every estimate — for example a flat roof would have come
    // back as 2× its true area). See server/__tests__/materialCalculator
    // for the canonical roofing test case.
    const roofArea = footprintArea * pitchMultiplier;
    const roofAreaWithWaste = roofArea * (1 + waste);

    const squares = roofAreaWithWaste / 100;

    let bundlesOrPanels: number;
    let bundleLabel: string;
    if (materialType === "metal") {
      bundlesOrPanels = Math.ceil(roofAreaWithWaste);
      bundleLabel = "Sq Ft of Panels";
    } else {
      bundlesOrPanels = Math.ceil(squares * 3);
      bundleLabel = "Bundles of Shingles";
    }

    const underlaymentRolls = Math.ceil(roofAreaWithWaste / 400);

    const ridgeCap = len;

    const roofEdgeLength = footprintLength;
    const rakeLength = Math.sqrt(Math.pow(footprintWidth / 2, 2) + Math.pow((footprintWidth / 2) * (pitch / 12), 2));
    const dripEdge = 2 * roofEdgeLength + 4 * rakeLength;

    return {
      roofArea: Math.round(roofArea * 100) / 100,
      roofAreaWithWaste: Math.round(roofAreaWithWaste * 100) / 100,
      squares: Math.round(squares * 100) / 100,
      bundlesOrPanels,
      bundleLabel,
      underlaymentRolls,
      ridgeCap: Math.round(ridgeCap * 100) / 100,
      dripEdge: Math.round(dripEdge * 100) / 100,
    };
  }, [buildingLength, buildingWidth, roofPitch, overhang, materialType, wasteFactor]);

  const costEstimate = useMemo(() => {
    const price = parseFloat(unitPrice);
    if (!price || price <= 0) return null;
    return Math.round(results.squares * price * 100) / 100;
  }, [unitPrice, results.squares]);

  return (
    <Card data-testid="calculator-roofing">
      <CardHeader>
        <CardTitle>Roofing Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Estimate roofing squares, underlayment, and material quantities
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="roof-length">Building Length (ft)</Label>
              <Input
                id="roof-length"
                data-testid="input-building-length"
                type="number"
                min="0"
                value={buildingLength}
                onChange={(e) => setBuildingLength(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roof-width">Building Width (ft)</Label>
              <Input
                id="roof-width"
                data-testid="input-building-width"
                type="number"
                min="0"
                value={buildingWidth}
                onChange={(e) => setBuildingWidth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roof-pitch">Roof Pitch</Label>
              <Select value={roofPitch} onValueChange={setRoofPitch}>
                <SelectTrigger id="roof-pitch" data-testid="select-roof-pitch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PITCH_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="roof-overhang">Overhang (inches)</Label>
              <Input
                id="roof-overhang"
                data-testid="input-overhang"
                type="number"
                min="0"
                value={overhang}
                onChange={(e) => setOverhang(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roof-material">Material Type</Label>
              <Select value={materialType} onValueChange={setMaterialType}>
                <SelectTrigger id="roof-material" data-testid="select-material-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Results</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Roof Area</p>
                <p className="text-lg font-semibold" data-testid="result-roof-area">
                  {results.roofArea.toLocaleString()} sq ft
                </p>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Roofing Squares</p>
                <p className="text-lg font-semibold" data-testid="result-squares">
                  {results.squares}
                </p>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">{results.bundleLabel}</p>
                <p className="text-lg font-semibold" data-testid="result-bundles">
                  {results.bundlesOrPanels.toLocaleString()}
                </p>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Underlayment Rolls</p>
                <p className="text-lg font-semibold" data-testid="result-underlayment">
                  {results.underlaymentRolls}
                </p>
                <p className="text-xs text-muted-foreground">~400 sq ft per roll</p>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Ridge Cap</p>
                <p className="text-lg font-semibold" data-testid="result-ridge-cap">
                  {results.ridgeCap} linear ft
                </p>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Drip Edge</p>
                <p className="text-lg font-semibold" data-testid="result-drip-edge">
                  {results.dripEdge} linear ft
                </p>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h4 className="font-semibold text-sm">Cost Settings</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="roof-waste">Waste Factor (%)</Label>
                <Input
                  id="roof-waste"
                  data-testid="input-roof-waste"
                  type="number"
                  min="0"
                  max="100"
                  value={wasteFactor}
                  onChange={(e) => setWasteFactor(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roof-price">Unit Price per Square ($)</Label>
                <Input
                  id="roof-price"
                  data-testid="input-roof-unit-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Optional"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                />
              </div>
            </div>

            {costEstimate !== null && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Estimated Cost:</span>
                <Badge variant="secondary" data-testid="badge-roofing-cost">
                  ${costEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Badge>
                <span className="text-xs text-muted-foreground">(includes {wasteFactor}% waste)</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
