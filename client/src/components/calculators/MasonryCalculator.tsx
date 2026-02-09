import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface Opening {
  id: number;
  width: string;
  height: string;
}

const BRICK_TYPES = [
  { value: "standard", label: 'Standard Brick (8"x2.25"x3.75")', unitsPerSqFt: 6.75, mortarPerUnit: 40, unitLabel: "bricks" },
  { value: "modular", label: 'Modular Brick (7.625"x2.25"x3.625")', unitsPerSqFt: 6.86, mortarPerUnit: 40, unitLabel: "bricks" },
  { value: "cmu8", label: 'CMU 8" Block (15.625"x7.625"x7.625")', unitsPerSqFt: 1.125, mortarPerUnit: 12, unitLabel: "blocks" },
  { value: "cmu12", label: 'CMU 12" Block (15.625"x7.625"x11.625")', unitsPerSqFt: 1.125, mortarPerUnit: 12, unitLabel: "blocks" },
];

const MORTAR_JOINTS = [
  { value: "0.375", label: '3/8"' },
  { value: "0.5", label: '1/2"' },
];

function formatNumber(num: number): string {
  return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatCurrency(num: number): string {
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MasonryCalculator() {
  const [wallLength, setWallLength] = useState("");
  const [wallHeight, setWallHeight] = useState("");
  const [brickType, setBrickType] = useState("standard");
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [mortarJoint, setMortarJoint] = useState("0.375");
  const [wasteFactor, setWasteFactor] = useState("10");
  const [unitPrice, setUnitPrice] = useState("");
  const [mortarPrice, setMortarPrice] = useState("");

  let nextId = openings.length > 0 ? Math.max(...openings.map((o) => o.id)) + 1 : 1;

  const addOpening = () => {
    if (openings.length >= 10) return;
    setOpenings([...openings, { id: nextId, width: "", height: "" }]);
  };

  const removeOpening = (id: number) => {
    setOpenings(openings.filter((o) => o.id !== id));
  };

  const updateOpening = (id: number, field: "width" | "height", value: string) => {
    setOpenings(openings.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const lengthNum = parseFloat(wallLength) || 0;
  const heightNum = parseFloat(wallHeight) || 0;
  const wasteNum = (parseFloat(wasteFactor) || 0) / 100;
  const unitPriceNum = parseFloat(unitPrice) || 0;
  const mortarPriceNum = parseFloat(mortarPrice) || 0;

  const selectedBrick = BRICK_TYPES.find((b) => b.value === brickType) || BRICK_TYPES[0];

  const grossWallArea = lengthNum * heightNum;
  const openingArea = openings.reduce((sum, o) => {
    const w = parseFloat(o.width) || 0;
    const h = parseFloat(o.height) || 0;
    return sum + w * h;
  }, 0);
  const netWallArea = Math.max(0, grossWallArea - openingArea);

  const totalUnits = Math.ceil(netWallArea * selectedBrick.unitsPerSqFt * (1 + wasteNum));
  const mortarBags = Math.ceil(totalUnits / selectedBrick.mortarPerUnit);

  const unitCost = unitPriceNum > 0 ? totalUnits * unitPriceNum : 0;
  const mortarCost = mortarPriceNum > 0 ? mortarBags * mortarPriceNum : 0;
  const totalCost = unitCost + mortarCost;

  const hasValidInput = lengthNum > 0 && heightNum > 0;
  const hasPricing = unitPriceNum > 0 || mortarPriceNum > 0;

  return (
    <Card data-testid="calculator-masonry">
      <CardHeader>
        <CardTitle>Masonry Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Estimate brick, block, and mortar requirements for masonry walls
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="wall-length">Wall Length (ft)</Label>
            <Input
              id="wall-length"
              data-testid="input-wall-length"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 40"
              value={wallLength}
              onChange={(e) => setWallLength(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wall-height">Wall Height (ft)</Label>
            <Input
              id="wall-height"
              data-testid="input-wall-height"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 8"
              value={wallHeight}
              onChange={(e) => setWallHeight(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="brick-type">Block / Brick Type</Label>
          <Select value={brickType} onValueChange={setBrickType} data-testid="select-brick-type">
            <SelectTrigger id="brick-type" data-testid="select-trigger-brick-type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {BRICK_TYPES.map((bt) => (
                <SelectItem key={bt.value} value={bt.value} data-testid={`select-item-brick-${bt.value}`}>
                  {bt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label>Openings (Doors / Windows)</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={addOpening}
              disabled={openings.length >= 10}
              data-testid="button-add-opening"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Opening
            </Button>
          </div>
          {openings.length === 0 && (
            <p className="text-sm text-muted-foreground">No openings added. Click "Add Opening" to deduct door/window areas.</p>
          )}
          {openings.map((opening, index) => (
            <div key={opening.id} className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1 flex-1 min-w-[100px]">
                <Label htmlFor={`opening-width-${opening.id}`} className="text-xs text-muted-foreground">
                  Width (ft)
                </Label>
                <Input
                  id={`opening-width-${opening.id}`}
                  data-testid={`input-opening-width-${index}`}
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="Width"
                  value={opening.width}
                  onChange={(e) => updateOpening(opening.id, "width", e.target.value)}
                />
              </div>
              <div className="space-y-1 flex-1 min-w-[100px]">
                <Label htmlFor={`opening-height-${opening.id}`} className="text-xs text-muted-foreground">
                  Height (ft)
                </Label>
                <Input
                  id={`opening-height-${opening.id}`}
                  data-testid={`input-opening-height-${index}`}
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="Height"
                  value={opening.height}
                  onChange={(e) => updateOpening(opening.id, "height", e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeOpening(opening.id)}
                data-testid={`button-remove-opening-${index}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>

        <Separator />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="mortar-joint">Mortar Joint Thickness</Label>
            <Select value={mortarJoint} onValueChange={setMortarJoint} data-testid="select-mortar-joint">
              <SelectTrigger id="mortar-joint" data-testid="select-trigger-mortar-joint">
                <SelectValue placeholder="Select thickness" />
              </SelectTrigger>
              <SelectContent>
                {MORTAR_JOINTS.map((mj) => (
                  <SelectItem key={mj.value} value={mj.value} data-testid={`select-item-mortar-${mj.value}`}>
                    {mj.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="waste-factor">Waste Factor (%)</Label>
            <Input
              id="waste-factor"
              data-testid="input-waste-factor"
              type="number"
              min="0"
              max="50"
              step="1"
              placeholder="10"
              value={wasteFactor}
              onChange={(e) => setWasteFactor(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="unit-price">Unit Price ($/each)</Label>
            <Input
              id="unit-price"
              data-testid="input-unit-price"
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Price per brick or block</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mortar-price">Mortar Price ($/bag)</Label>
            <Input
              id="mortar-price"
              data-testid="input-mortar-price"
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional"
              value={mortarPrice}
              onChange={(e) => setMortarPrice(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Price per 80lb bag of mortar</p>
          </div>
        </div>

        <Separator />

        {hasValidInput ? (
          <Card data-testid="results-section">
            <CardHeader>
              <CardTitle className="text-lg">Results</CardTitle>
              <CardDescription className="text-muted-foreground">
                Estimated materials for {selectedBrick.unitLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Gross Wall Area</p>
                  <Badge variant="secondary" data-testid="result-gross-area">
                    {formatNumber(grossWallArea)} sq ft
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Net Wall Area (after openings)</p>
                  <Badge variant="secondary" data-testid="result-net-area">
                    {formatNumber(netWallArea)} sq ft
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {selectedBrick.unitLabel.charAt(0).toUpperCase() + selectedBrick.unitLabel.slice(1)} Needed (incl. {wasteFactor || "0"}% waste)
                  </p>
                  <Badge variant="default" data-testid="result-total-units">
                    {formatNumber(totalUnits)} {selectedBrick.unitLabel}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Mortar Bags (80lb)</p>
                  <Badge variant="default" data-testid="result-mortar-bags">
                    {formatNumber(mortarBags)} bags
                  </Badge>
                </div>
              </div>

              {hasPricing && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Cost Estimate</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {unitPriceNum > 0 && (
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">
                            {selectedBrick.unitLabel.charAt(0).toUpperCase() + selectedBrick.unitLabel.slice(1)} Cost
                          </p>
                          <Badge variant="outline" data-testid="result-unit-cost">
                            ${formatCurrency(unitCost)}
                          </Badge>
                        </div>
                      )}
                      {mortarPriceNum > 0 && (
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Mortar Cost</p>
                          <Badge variant="outline" data-testid="result-mortar-cost">
                            ${formatCurrency(mortarCost)}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Total Estimated Cost</p>
                      <Badge variant="default" data-testid="result-total-cost">
                        ${formatCurrency(totalCost)}
                      </Badge>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-6" data-testid="results-placeholder">
            <p className="text-sm text-muted-foreground">
              Enter wall dimensions above to see calculated results.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
