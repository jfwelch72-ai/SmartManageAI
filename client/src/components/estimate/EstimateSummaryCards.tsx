import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, FileText, TrendingUp } from "lucide-react";

interface EstimateSummaryCardsProps {
  totals: {
    materialCost: number;
    laborCost: number;
    laborHours: number;
    equipmentCost: number;
    consumablesCost: number;
    subcontractCost: number;
    overheadAllocation: number;
    profitAllocation: number;
    totalCost: number;
  };
  lineItemCount: number;
  overheadPercent: number;
  profitMarginPercent: number;
}

export function EstimateSummaryCards({ totals, lineItemCount, overheadPercent, profitMarginPercent }: EstimateSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
          <CardTitle className="text-sm font-medium">Total Estimate</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-estimate">
            ${totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {lineItemCount} line items
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
          <CardTitle className="text-sm font-medium">Material Cost</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-material-cost">
            ${totals.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totals.totalCost > 0 
              ? `${((totals.materialCost / totals.totalCost) * 100).toFixed(1)}% of total`
              : "0% of total"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
          <CardTitle className="text-sm font-medium">Labor Cost</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-labor-cost">
            ${totals.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totals.laborHours.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hours estimated
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
          <CardTitle className="text-sm font-medium">Profit Margin</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {(() => {
            const directCosts = totals.materialCost + totals.laborCost + totals.equipmentCost + 
              totals.consumablesCost + totals.subcontractCost;
            const projectedOverhead = directCosts * (overheadPercent / 100);
            const costPlusOverhead = directCosts + projectedOverhead;
            const projectedProfit = costPlusOverhead * (profitMarginPercent / 100);
            return (
              <>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-profit-margin">
                  ${projectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {profitMarginPercent}% of cost + overhead
                </p>
              </>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
