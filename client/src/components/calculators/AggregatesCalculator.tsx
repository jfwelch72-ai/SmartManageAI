import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const MATERIAL_DENSITIES: Record<string, number> = {
  gravel: 1.4,
  sand: 1.35,
  crushed_stone: 1.4,
  topsoil: 1.1,
  fill_dirt: 1.15,
  pea_gravel: 1.35,
};

const MATERIAL_LABELS: Record<string, string> = {
  gravel: "Gravel",
  sand: "Sand",
  crushed_stone: "Crushed Stone",
  topsoil: "Topsoil",
  fill_dirt: "Fill Dirt",
  pea_gravel: "Pea Gravel",
};

export default function AggregatesCalculator() {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [materialType, setMaterialType] = useState("gravel");
  const [density, setDensity] = useState("1.4");
  const [wasteFactor, setWasteFactor] = useState("5");
  const [pricePerTon, setPricePerTon] = useState("");
  const [pricePerCubicYard, setPricePerCubicYard] = useState("");

  const handleMaterialChange = (value: string) => {
    setMaterialType(value);
    setDensity(String(MATERIAL_DENSITIES[value]));
  };

  const results = useMemo(() => {
    const l = parseFloat(length);
    const w = parseFloat(width);
    const d = parseFloat(depth);
    const dens = parseFloat(density);
    const waste = parseFloat(wasteFactor) || 0;
    const ppt = parseFloat(pricePerTon);
    const ppcy = parseFloat(pricePerCubicYard);

    if (!l || !w || !d || !dens || l <= 0 || w <= 0 || d <= 0 || dens <= 0) return null;

    const volumeCuFt = l * w * (d / 12);
    const volumeCuYd = volumeCuFt / 27;
    const volumeWithWaste = volumeCuYd * (1 + waste / 100);
    const weightTons = volumeWithWaste * dens;
    const truckLoads = volumeWithWaste / 10;

    let costEstimate: number | null = null;
    if (!isNaN(ppt) && ppt > 0) {
      costEstimate = weightTons * ppt;
    } else if (!isNaN(ppcy) && ppcy > 0) {
      costEstimate = volumeWithWaste * ppcy;
    }

    return {
      volumeCuFt: volumeCuFt.toFixed(2),
      volumeCuYd: volumeCuYd.toFixed(2),
      volumeWithWaste: volumeWithWaste.toFixed(2),
      weightTons: weightTons.toFixed(2),
      truckLoads: Math.ceil(truckLoads),
      truckLoadsExact: truckLoads.toFixed(1),
      costEstimate: costEstimate !== null ? costEstimate.toFixed(2) : null,
    };
  }, [length, width, depth, density, wasteFactor, pricePerTon, pricePerCubicYard]);

  return (
    <Card data-testid="calculator-aggregates">
      <CardHeader>
        <CardTitle>Aggregates Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Estimate gravel, sand, and fill material volumes and tonnage
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="agg-length">Length (ft)</Label>
            <Input
              id="agg-length"
              data-testid="input-agg-length"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 20"
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-width">Width (ft)</Label>
            <Input
              id="agg-width"
              data-testid="input-agg-width"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 10"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-depth">Depth (inches)</Label>
            <Input
              id="agg-depth"
              data-testid="input-agg-depth"
              type="number"
              min="0"
              step="0.5"
              placeholder="e.g. 4"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-material">Material Type</Label>
            <Select value={materialType} onValueChange={handleMaterialChange}>
              <SelectTrigger id="agg-material" data-testid="select-agg-material">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MATERIAL_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-density">Density (tons/cu yd)</Label>
            <Input
              id="agg-density"
              data-testid="input-agg-density"
              type="number"
              min="0"
              step="0.05"
              value={density}
              onChange={(e) => setDensity(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Auto-filled from material type</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-waste">Waste Factor (%)</Label>
            <Input
              id="agg-waste"
              data-testid="input-agg-waste"
              type="number"
              min="0"
              max="100"
              step="1"
              value={wasteFactor}
              onChange={(e) => setWasteFactor(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-price-ton">Price per Ton ($)</Label>
            <Input
              id="agg-price-ton"
              data-testid="input-agg-price-ton"
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional"
              value={pricePerTon}
              onChange={(e) => setPricePerTon(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agg-price-yard">Price per Cubic Yard ($)</Label>
            <Input
              id="agg-price-yard"
              data-testid="input-agg-price-yard"
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional (alternate)"
              value={pricePerCubicYard}
              onChange={(e) => setPricePerCubicYard(e.target.value)}
            />
          </div>
        </div>

        {results && (
          <div className="mt-6 space-y-3" data-testid="agg-results">
            <h3 className="font-semibold text-sm">Results</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Volume</span>
                <Badge variant="secondary" data-testid="result-agg-volume-cuft">
                  {results.volumeCuFt} cu ft
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Volume</span>
                <Badge variant="secondary" data-testid="result-agg-volume-cuyd">
                  {results.volumeCuYd} cu yd
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Volume (with {wasteFactor}% waste)</span>
                <Badge variant="secondary" data-testid="result-agg-volume-waste">
                  {results.volumeWithWaste} cu yd
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Weight</span>
                <Badge data-testid="result-agg-weight">
                  {results.weightTons} tons
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Dump Truck Loads (~10 cu yd)</span>
                <Badge variant="secondary" data-testid="result-agg-trucks">
                  {results.truckLoads} load{results.truckLoads !== 1 ? "s" : ""} ({results.truckLoadsExact})
                </Badge>
              </div>
              {results.costEstimate && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Estimated Cost</span>
                  <Badge data-testid="result-agg-cost">
                    ${results.costEstimate}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
