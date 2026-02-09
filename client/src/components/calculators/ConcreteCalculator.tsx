import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

function ResultsSection({
  volumeCuFt,
  wasteFactor,
  unitPrice,
  onWasteFactorChange,
  onUnitPriceChange,
  extraRows,
}: {
  volumeCuFt: number;
  wasteFactor: number;
  unitPrice: string;
  onWasteFactorChange: (v: number) => void;
  onUnitPriceChange: (v: string) => void;
  extraRows?: { label: string; value: string; testId: string }[];
}) {
  const wasteAmount = volumeCuFt * (wasteFactor / 100);
  const totalCuFt = volumeCuFt + wasteAmount;
  const totalCuYd = totalCuFt / 27;
  const bags80 = Math.ceil(totalCuFt / 0.6);
  const bags60 = Math.ceil(totalCuFt / 0.45);
  const price = parseFloat(unitPrice);
  const estimatedCost = !isNaN(price) && price > 0 ? totalCuYd * price : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="waste-factor">Waste Factor (%)</Label>
          <Input
            id="waste-factor"
            data-testid="input-waste-factor"
            type="number"
            min={0}
            max={25}
            value={wasteFactor}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0 && val <= 25) onWasteFactorChange(val);
              else if (e.target.value === "") onWasteFactorChange(0);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit-price">Unit Price ($/cubic yard)</Label>
          <Input
            id="unit-price"
            data-testid="input-unit-price"
            type="number"
            min={0}
            step="0.01"
            placeholder="Optional"
            value={unitPrice}
            onChange={(e) => onUnitPriceChange(e.target.value)}
          />
        </div>
      </div>

      {volumeCuFt > 0 && (
        <Card data-testid="results-summary">
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {extraRows?.map((row) => (
                <div key={row.testId} className="flex items-center justify-between flex-wrap gap-1">
                  <span className="text-muted-foreground text-sm">{row.label}</span>
                  <Badge variant="secondary" data-testid={row.testId}>{row.value}</Badge>
                </div>
              ))}
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-muted-foreground text-sm">Volume (before waste)</span>
                <Badge variant="secondary" data-testid="result-volume-before-waste">
                  {volumeCuFt.toFixed(2)} cu ft / {(volumeCuFt / 27).toFixed(2)} cu yd
                </Badge>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-muted-foreground text-sm">Waste ({wasteFactor}%)</span>
                <Badge variant="secondary" data-testid="result-waste-amount">
                  {wasteAmount.toFixed(2)} cu ft
                </Badge>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-sm font-medium">Total Volume (with waste)</span>
                <Badge data-testid="result-total-volume">
                  {totalCuFt.toFixed(2)} cu ft / {totalCuYd.toFixed(2)} cu yd
                </Badge>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-muted-foreground text-sm">80lb Bags (~0.6 cu ft each)</span>
                <Badge variant="outline" data-testid="result-bags-80">{bags80}</Badge>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-muted-foreground text-sm">60lb Bags (~0.45 cu ft each)</span>
                <Badge variant="outline" data-testid="result-bags-60">{bags60}</Badge>
              </div>
              {estimatedCost !== null && (
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="text-sm font-medium">Estimated Cost</span>
                  <Badge data-testid="result-estimated-cost">
                    ${estimatedCost.toFixed(2)}
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ConcreteCalculator() {
  const [activeTab, setActiveTab] = useState("slab");

  const [slabLength, setSlabLength] = useState("");
  const [slabWidth, setSlabWidth] = useState("");
  const [slabThickness, setSlabThickness] = useState("");

  const [footingLength, setFootingLength] = useState("");
  const [footingWidth, setFootingWidth] = useState("");
  const [footingDepth, setFootingDepth] = useState("");

  const [columnDiameter, setColumnDiameter] = useState("");
  const [columnHeight, setColumnHeight] = useState("");
  const [columnQuantity, setColumnQuantity] = useState("1");

  const [wasteFactor, setWasteFactor] = useState(10);
  const [unitPrice, setUnitPrice] = useState("");

  const calcSlabVolume = () => {
    const l = parseFloat(slabLength);
    const w = parseFloat(slabWidth);
    const t = parseFloat(slabThickness);
    if (isNaN(l) || isNaN(w) || isNaN(t) || l <= 0 || w <= 0 || t <= 0) return 0;
    return l * w * (t / 12);
  };

  const calcFootingVolume = () => {
    const l = parseFloat(footingLength);
    const w = parseFloat(footingWidth);
    const d = parseFloat(footingDepth);
    if (isNaN(l) || isNaN(w) || isNaN(d) || l <= 0 || w <= 0 || d <= 0) return 0;
    return l * (w / 12) * (d / 12);
  };

  const calcColumnVolumePerUnit = () => {
    const dia = parseFloat(columnDiameter);
    const h = parseFloat(columnHeight);
    if (isNaN(dia) || isNaN(h) || dia <= 0 || h <= 0) return 0;
    const radiusFt = dia / 2 / 12;
    return Math.PI * radiusFt * radiusFt * h;
  };

  const calcColumnTotalVolume = () => {
    const qty = parseInt(columnQuantity, 10);
    if (isNaN(qty) || qty <= 0) return 0;
    return calcColumnVolumePerUnit() * qty;
  };

  return (
    <Card data-testid="calculator-concrete">
      <CardHeader>
        <CardTitle>Concrete Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate concrete volume, mix quantities, and material costs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full flex-wrap" data-testid="tabs-shape-type">
            <TabsTrigger value="slab" data-testid="tab-slab">Slab / Pad</TabsTrigger>
            <TabsTrigger value="footing" data-testid="tab-footing">Footing / Wall</TabsTrigger>
            <TabsTrigger value="column" data-testid="tab-column">Column / Pier (Round)</TabsTrigger>
          </TabsList>

          <TabsContent value="slab" data-testid="tabcontent-slab">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="slab-length">Length (ft)</Label>
                  <Input
                    id="slab-length"
                    data-testid="input-slab-length"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={slabLength}
                    onChange={(e) => setSlabLength(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slab-width">Width (ft)</Label>
                  <Input
                    id="slab-width"
                    data-testid="input-slab-width"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={slabWidth}
                    onChange={(e) => setSlabWidth(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slab-thickness">Thickness (inches)</Label>
                  <Input
                    id="slab-thickness"
                    data-testid="input-slab-thickness"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={slabThickness}
                    onChange={(e) => setSlabThickness(e.target.value)}
                  />
                </div>
              </div>
              <ResultsSection
                volumeCuFt={calcSlabVolume()}
                wasteFactor={wasteFactor}
                unitPrice={unitPrice}
                onWasteFactorChange={setWasteFactor}
                onUnitPriceChange={setUnitPrice}
              />
            </div>
          </TabsContent>

          <TabsContent value="footing" data-testid="tabcontent-footing">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="footing-length">Length (ft)</Label>
                  <Input
                    id="footing-length"
                    data-testid="input-footing-length"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={footingLength}
                    onChange={(e) => setFootingLength(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="footing-width">Width (inches)</Label>
                  <Input
                    id="footing-width"
                    data-testid="input-footing-width"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={footingWidth}
                    onChange={(e) => setFootingWidth(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="footing-depth">Depth (inches)</Label>
                  <Input
                    id="footing-depth"
                    data-testid="input-footing-depth"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={footingDepth}
                    onChange={(e) => setFootingDepth(e.target.value)}
                  />
                </div>
              </div>
              <ResultsSection
                volumeCuFt={calcFootingVolume()}
                wasteFactor={wasteFactor}
                unitPrice={unitPrice}
                onWasteFactorChange={setWasteFactor}
                onUnitPriceChange={setUnitPrice}
              />
            </div>
          </TabsContent>

          <TabsContent value="column" data-testid="tabcontent-column">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="column-diameter">Diameter (inches)</Label>
                  <Input
                    id="column-diameter"
                    data-testid="input-column-diameter"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={columnDiameter}
                    onChange={(e) => setColumnDiameter(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="column-height">Height (ft)</Label>
                  <Input
                    id="column-height"
                    data-testid="input-column-height"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={columnHeight}
                    onChange={(e) => setColumnHeight(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="column-quantity">Quantity</Label>
                  <Input
                    id="column-quantity"
                    data-testid="input-column-quantity"
                    type="number"
                    min={1}
                    placeholder="1"
                    value={columnQuantity}
                    onChange={(e) => setColumnQuantity(e.target.value)}
                  />
                </div>
              </div>
              <ResultsSection
                volumeCuFt={calcColumnTotalVolume()}
                wasteFactor={wasteFactor}
                unitPrice={unitPrice}
                onWasteFactorChange={setWasteFactor}
                onUnitPriceChange={setUnitPrice}
                extraRows={
                  calcColumnVolumePerUnit() > 0
                    ? [
                        {
                          label: "Volume per Column",
                          value: `${calcColumnVolumePerUnit().toFixed(2)} cu ft / ${(calcColumnVolumePerUnit() / 27).toFixed(4)} cu yd`,
                          testId: "result-volume-per-column",
                        },
                      ]
                    : undefined
                }
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
