import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Calculator, Building2 } from "lucide-react";
import { Link } from "wouter";

interface MarkupCalculatorProps {
  totals: {
    materialCost: number;
    laborCost: number;
    equipmentCost: number;
    consumablesCost: number;
    subcontractCost: number;
  };
  overheadPercent: number;
  profitMarginPercent: number;
  onOverheadChange: (value: number) => void;
  onProfitChange: (value: number) => void;
}

export function MarkupCalculatorCard({ totals, overheadPercent, profitMarginPercent, onOverheadChange, onProfitChange }: MarkupCalculatorProps) {
  const { data: overheadSummary } = useQuery<{ defaultOverheadPercent: number; suggestedPercent: number | null }>({
    queryKey: ["/api/overhead/summary"],
  });

  return (
    <Card className="border-primary/20 bg-primary/5" data-testid="card-markup-calculator">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Markup Calculator
            </CardTitle>
            <CardDescription className="mt-1">
              Adjust overhead and profit percentages to see impact on total bid amount
            </CardDescription>
          </div>
          {overheadSummary && (
            <div className="text-right text-sm hidden sm:block">
              <Link href="/overhead-costs" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors" data-testid="link-overhead-costs">
                <Building2 className="h-3.5 w-3.5" />
                <span>Company overhead</span>
              </Link>
              <p className="text-xs text-muted-foreground mt-0.5">
                Default: <span className="font-semibold text-foreground">{overheadSummary.defaultOverheadPercent}%</span>
                {overheadSummary.suggestedPercent != null && (
                  <span> · Suggested: <span className="font-semibold text-foreground">{overheadSummary.suggestedPercent}%</span></span>
                )}
              </p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Overhead</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="30"
                    step="0.5"
                    value={overheadPercent}
                    onChange={(e) => {
                      const value = Math.min(30, Math.max(0, Number(e.target.value)));
                      onOverheadChange(value);
                    }}
                    className="w-16 h-8 text-right"
                    data-testid="input-overhead-percent"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <Slider
                value={[overheadPercent]}
                onValueChange={(value) => onOverheadChange(value[0])}
                min={0}
                max={30}
                step={0.5}
                className="w-full"
                data-testid="slider-overhead"
              />
              <div className="flex gap-1">
                {[5, 10, 15].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={overheadPercent === preset ? "default" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onOverheadChange(preset)}
                    data-testid={`button-overhead-preset-${preset}`}
                  >
                    {preset}%
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Profit</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={profitMarginPercent}
                    onChange={(e) => {
                      const value = Math.min(50, Math.max(0, Number(e.target.value)));
                      onProfitChange(value);
                    }}
                    className="w-16 h-8 text-right"
                    data-testid="input-profit-margin-percent"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <Slider
                value={[profitMarginPercent]}
                onValueChange={(value) => onProfitChange(value[0])}
                min={0}
                max={50}
                step={0.5}
                className="w-full"
                data-testid="slider-profit-margin"
              />
              <div className="flex gap-1">
                {[10, 15, 20].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={profitMarginPercent === preset ? "default" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onProfitChange(preset)}
                    data-testid={`button-profit-preset-${preset}`}
                  >
                    {preset}%
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(() => {
              const directCosts = 
                totals.materialCost +
                totals.laborCost +
                totals.equipmentCost +
                totals.consumablesCost +
                totals.subcontractCost;
              
              const projectedOverhead = directCosts * (overheadPercent / 100);
              const costPlusOverhead = directCosts + projectedOverhead;
              const projectedProfit = costPlusOverhead * (profitMarginPercent / 100);
              const projectedTotal = costPlusOverhead + projectedProfit;
              const combinedMarkup = overheadPercent + profitMarginPercent + (overheadPercent * profitMarginPercent / 100);

              return (
                <>
                  <div className="p-4 bg-background rounded-md border">
                    <p className="text-sm text-muted-foreground mb-1">Direct Costs</p>
                    <p className="text-xl font-bold">${directCosts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="p-4 bg-background rounded-md border">
                    <p className="text-sm text-muted-foreground mb-1">+ Overhead</p>
                    <p className="text-xl font-bold text-orange-600 dark:text-orange-400">
                      ${projectedOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {overheadPercent}%
                    </p>
                  </div>
                  <div className="p-4 bg-background rounded-md border">
                    <p className="text-sm text-muted-foreground mb-1">+ Profit</p>
                    <p className="text-xl font-bold text-green-600 dark:text-green-400">
                      ${projectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {profitMarginPercent}%
                    </p>
                  </div>
                  <div className="p-4 bg-primary/10 rounded-md border border-primary/20">
                    <p className="text-sm text-muted-foreground mb-1">Total Bid</p>
                    <p className="text-xl font-bold">${projectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {combinedMarkup.toFixed(1)}% markup
                    </p>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
