import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MARGIN_PRESETS = [10, 15, 20, 25];

const UNIT_OPTIONS = [
  { value: "SF", label: "Square Feet (SF)" },
  { value: "LF", label: "Linear Feet (LF)" },
  { value: "CY", label: "Cubic Yards (CY)" },
  { value: "EA", label: "Each (EA)" },
  { value: "HR", label: "Hours (HR)" },
  { value: "TON", label: "Tons" },
  { value: "GAL", label: "Gallons" },
];

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ProfitMarginCalculator() {
  const [materialCost, setMaterialCost] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [equipmentCost, setEquipmentCost] = useState("");
  const [subcontractorCost, setSubcontractorCost] = useState("");
  const [overheadCost, setOverheadCost] = useState("");
  const [profitMargin, setProfitMargin] = useState(15);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");

  const parseCost = (val: string) => {
    const n = parseFloat(val);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const totalDirectCosts =
    parseCost(materialCost) +
    parseCost(laborCost) +
    parseCost(equipmentCost) +
    parseCost(subcontractorCost) +
    parseCost(overheadCost);

  const profitAmount = totalDirectCosts * (profitMargin / 100);
  const totalBidPrice = totalDirectCosts + profitAmount;

  const qty = parseFloat(quantity);
  const hasQuantity = !isNaN(qty) && qty > 0 && unit !== "";
  const costPerUnit = hasQuantity ? totalBidPrice / qty : null;

  const hasCosts = totalDirectCosts > 0;

  return (
    <Card data-testid="calculator-profit-margin">
      <CardHeader>
        <CardTitle>Profit Margin Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate profit amount and total bid price based on project costs and desired margin
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pm-material-cost">Material Cost ($)</Label>
              <Input
                id="pm-material-cost"
                data-testid="input-material-cost"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={materialCost}
                onChange={(e) => setMaterialCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm-labor-cost">Labor Cost ($)</Label>
              <Input
                id="pm-labor-cost"
                data-testid="input-labor-cost"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm-equipment-cost">Equipment Cost ($)</Label>
              <Input
                id="pm-equipment-cost"
                data-testid="input-equipment-cost"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={equipmentCost}
                onChange={(e) => setEquipmentCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm-subcontractor-cost">Subcontractor Cost ($)</Label>
              <Input
                id="pm-subcontractor-cost"
                data-testid="input-subcontractor-cost"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={subcontractorCost}
                onChange={(e) => setSubcontractorCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm-overhead-cost">Overhead Cost ($) <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="pm-overhead-cost"
                data-testid="input-overhead-cost"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={overheadCost}
                onChange={(e) => setOverheadCost(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <Label>Desired Profit Margin</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={profitMargin}
                  onChange={(e) => {
                    const v = Math.min(50, Math.max(0, Number(e.target.value)));
                    setProfitMargin(v);
                  }}
                  className="w-20 text-right"
                  data-testid="input-profit-margin-percent"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <Slider
              value={[profitMargin]}
              onValueChange={(v) => setProfitMargin(v[0])}
              min={0}
              max={50}
              step={0.5}
              className="w-full"
              data-testid="slider-profit-margin"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {MARGIN_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant={profitMargin === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProfitMargin(preset)}
                  data-testid={`button-preset-margin-${preset}`}
                >
                  {preset}%
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pm-quantity">Quantity <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="pm-quantity"
                data-testid="input-quantity"
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm-unit">Unit</Label>
              <Select value={unit} onValueChange={setUnit} data-testid="select-unit">
                <SelectTrigger id="pm-unit" data-testid="select-unit-trigger">
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} data-testid={`select-unit-${opt.value}`}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasCosts && (
            <Card data-testid="results-summary">
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Total Direct Costs</span>
                    <Badge variant="secondary" data-testid="result-total-direct-costs">
                      ${formatCurrency(totalDirectCosts)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Profit Amount ({profitMargin}%)</span>
                    <Badge variant="secondary" data-testid="result-profit-amount">
                      ${formatCurrency(profitAmount)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">Total Bid Price</span>
                    <Badge data-testid="result-total-bid-price">
                      ${formatCurrency(totalBidPrice)}
                    </Badge>
                  </div>
                  {costPerUnit !== null && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-muted-foreground text-sm">Cost per {unit}</span>
                      <Badge variant="outline" data-testid="result-cost-per-unit">
                        ${formatCurrency(costPerUnit)} / {unit}
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
