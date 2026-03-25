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
  const { data: overheadSummary } = useQuery<{
    defaultOverheadPercent: number;
    suggestedPercent: number | null;
    categoryBreakdown?: Record<string, number>;
    totalMonthly?: number;
    categoryWeights?: Record<string, number>;
    weightedCategoryBreakdown?: Record<string, { monthly: number; weight: number; weighted: number }>;
  }>({
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
                    max="50"
                    step="0.5"
                    value={overheadPercent}
                    onChange={(e) => {
                      const value = Math.min(50, Math.max(0, Number(e.target.value)));
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
                max={50}
                step={0.5}
                className="w-full"
                data-testid="slider-overhead"
              />
              <div className="flex gap-1">
                {[5, 10, 15, 25].map((preset) => (
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
              {overheadSummary && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground" data-testid="text-overhead-benchmark">
                    <Link href="/overhead-costs" className="inline-flex items-center gap-1 hover:underline" data-testid="link-overhead-costs">
                      <Building2 className="h-3 w-3" />
                      Org benchmark:
                    </Link>
                    {" "}
                    <span className="font-medium text-foreground">{overheadSummary.defaultOverheadPercent}%</span>
                    {overheadSummary.suggestedPercent != null && (
                      <span className="text-muted-foreground"> · suggested {overheadSummary.suggestedPercent}% based on your fixed overhead costs</span>
                    )}
                  </p>
                  {overheadSummary.categoryBreakdown && overheadSummary.totalMonthly && overheadSummary.totalMonthly > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5" data-testid="overhead-category-breakdown">
                      {Object.entries(overheadSummary.categoryBreakdown)
                        .filter(([, v]) => v > 0)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5)
                        .map(([cat, monthly]) => {
                          const pct = ((monthly / overheadSummary.totalMonthly!) * 100).toFixed(0);
                          const label = cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                          const weight = overheadSummary.categoryWeights?.[cat];
                          return (
                            <span key={cat} className="text-[10px] text-muted-foreground" data-testid={`text-category-share-${cat}`}>
                              {label}: {pct}%{weight != null ? ` @${weight}%` : ""}
                            </span>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
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
