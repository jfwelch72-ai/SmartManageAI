import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const OVERHEAD_PRESETS = [5, 10, 15];
const PROFIT_PRESETS = [10, 15, 20];

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MarkupCalculator() {
  const [materialCost, setMaterialCost] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [equipmentCost, setEquipmentCost] = useState("");
  const [subcontractorCost, setSubcontractorCost] = useState("");
  const [consumablesCost, setConsumablesCost] = useState("");
  const [overheadPercent, setOverheadPercent] = useState(10);
  const [profitPercent, setProfitPercent] = useState(15);

  const parseCost = (val: string) => {
    const n = parseFloat(val);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const directCosts =
    parseCost(materialCost) +
    parseCost(laborCost) +
    parseCost(equipmentCost) +
    parseCost(subcontractorCost) +
    parseCost(consumablesCost);

  const overheadAmount = directCosts * (overheadPercent / 100);
  const costPlusOverhead = directCosts + overheadAmount;
  const profitAmount = costPlusOverhead * (profitPercent / 100);
  const finalBidPrice = costPlusOverhead + profitAmount;
  const combinedMarkup = directCosts > 0 ? ((finalBidPrice - directCosts) / directCosts) * 100 : 0;
  const profitPerDollar = directCosts > 0 ? profitAmount / directCosts : 0;

  const hasCosts = directCosts > 0;

  return (
    <Card data-testid="calculator-markup">
      <CardHeader>
        <CardTitle>Markup Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate overhead, profit, and final bid price from direct costs with separate markup percentages
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mu-material-cost">Material Cost ($)</Label>
              <Input
                id="mu-material-cost"
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
              <Label htmlFor="mu-labor-cost">Labor Cost ($)</Label>
              <Input
                id="mu-labor-cost"
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
              <Label htmlFor="mu-equipment-cost">Equipment Cost ($)</Label>
              <Input
                id="mu-equipment-cost"
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
              <Label htmlFor="mu-subcontractor-cost">Subcontractor Cost ($)</Label>
              <Input
                id="mu-subcontractor-cost"
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
              <Label htmlFor="mu-consumables-cost">Consumables Cost ($)</Label>
              <Input
                id="mu-consumables-cost"
                data-testid="input-consumables-cost"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={consumablesCost}
                onChange={(e) => setConsumablesCost(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <Label>Overhead Percentage</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={overheadPercent}
                  onChange={(e) => {
                    const v = Math.min(30, Math.max(0, Number(e.target.value)));
                    setOverheadPercent(v);
                  }}
                  className="w-20 text-right"
                  data-testid="input-overhead-percent"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <Slider
              value={[overheadPercent]}
              onValueChange={(v) => setOverheadPercent(v[0])}
              min={0}
              max={30}
              step={0.5}
              className="w-full"
              data-testid="slider-overhead-percent"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {OVERHEAD_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant={overheadPercent === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOverheadPercent(preset)}
                  data-testid={`button-preset-overhead-${preset}`}
                >
                  {preset}%
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <Label>Profit Percentage</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={profitPercent}
                  onChange={(e) => {
                    const v = Math.min(50, Math.max(0, Number(e.target.value)));
                    setProfitPercent(v);
                  }}
                  className="w-20 text-right"
                  data-testid="input-profit-percent"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <Slider
              value={[profitPercent]}
              onValueChange={(v) => setProfitPercent(v[0])}
              min={0}
              max={50}
              step={0.5}
              className="w-full"
              data-testid="slider-profit-percent"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {PROFIT_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant={profitPercent === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProfitPercent(preset)}
                  data-testid={`button-preset-profit-${preset}`}
                >
                  {preset}%
                </Button>
              ))}
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
                    <span className="text-muted-foreground text-sm">Direct Costs</span>
                    <Badge variant="secondary" data-testid="result-direct-costs">
                      ${formatCurrency(directCosts)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">+ Overhead ({overheadPercent}%)</span>
                    <Badge variant="secondary" data-testid="result-overhead-amount">
                      ${formatCurrency(overheadAmount)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">= Cost + Overhead</span>
                    <Badge variant="outline" data-testid="result-cost-plus-overhead">
                      ${formatCurrency(costPlusOverhead)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">+ Profit ({profitPercent}%)</span>
                    <Badge variant="secondary" data-testid="result-profit-amount">
                      ${formatCurrency(profitAmount)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">= Final Bid Price</span>
                    <Badge data-testid="result-final-bid-price">
                      ${formatCurrency(finalBidPrice)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Combined Markup</span>
                    <Badge variant="outline" data-testid="result-combined-markup">
                      {combinedMarkup.toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Profit per Dollar of Cost</span>
                    <Badge variant="outline" data-testid="result-profit-per-dollar">
                      ${profitPerDollar.toFixed(4)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
