import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { EstimateFactorsOverrideDrawer } from "@/components/estimate/EstimateFactorsOverrideDrawer";
import { TrendingUp, AlertCircle } from "lucide-react";

interface AppliedTotals {
  directCost: number;
  materialWaste: number;
  laborBurden: number;
  smallTools: number;
  escalation: number;
  overhead: number;
  profit: number;
  bond: number;
  grandTotal: number;
  factors: {
    laborBurdenPercent: number;
    smallToolsPercent: number;
    overheadPercent: number;
    profitPercent: number;
    bondPercent: number;
    escalationPercent: number;
    wasteFactorPercent: number;
  };
}

interface TotalsResponse {
  totals: AppliedTotals;
  source: "estimate_override" | "org_default";
}

interface Props {
  estimateId: string;
  showOverrideDrawer?: boolean;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(f: number) {
  return `${Math.round(f * 10000) / 100}%`;
}

interface RowProps {
  label: string;
  sub?: string;
  value: number;
  positive?: boolean;
  bold?: boolean;
  indent?: boolean;
}

function Row({ label, sub, value, positive = true, bold = false, indent = false }: RowProps) {
  const isZero = Math.abs(value) < 0.005;
  return (
    <div
      className={`flex items-baseline justify-between text-sm ${indent ? "pl-4" : ""} ${bold ? "font-semibold" : ""} ${isZero ? "text-muted-foreground/50" : ""}`}
    >
      <span>
        {label}
        {sub && <span className="ml-1 text-xs text-muted-foreground font-normal">{sub}</span>}
      </span>
      <span className={positive ? "" : "text-muted-foreground"}>
        {isZero ? "—" : `$${fmt(value)}`}
      </span>
    </div>
  );
}

export function OrgMarkupBreakdownCard({ estimateId, showOverrideDrawer = true }: Props) {
  const { data, isLoading, isError, refetch } = useQuery<TotalsResponse>({
    queryKey: ["/api/estimates", estimateId, "totals"],
  });

  const totals = data?.totals;
  const source = data?.source;
  const allZero = totals && totals.grandTotal < 0.005 && totals.directCost < 0.005;

  return (
    <Card data-testid="card-org-markup-breakdown">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Org Markup Breakdown</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Markup-adjusted bid total using org-wide estimating factors
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {source && (
              <Badge
                variant={source === "estimate_override" ? "default" : "outline"}
                className="text-[10px] uppercase tracking-wide"
                data-testid="badge-markup-source"
              >
                {source === "estimate_override" ? "Estimate Override" : "Org Defaults"}
              </Badge>
            )}
            {showOverrideDrawer && <EstimateFactorsOverrideDrawer estimateId={estimateId} />}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive" data-testid="error-markup-breakdown">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load markup breakdown.{" "}
            <button
              onClick={() => refetch()}
              className="underline hover:no-underline"
              data-testid="button-retry-markup-breakdown"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && totals && (
          <div className="space-y-1.5">
            {allZero ? (
              <p className="text-sm text-muted-foreground py-2">
                Add line items to see the markup-adjusted grand total.
              </p>
            ) : (
              <>
                <Row label="Direct Cost" value={totals.directCost} bold />

                {totals.materialWaste > 0 && (
                  <Row
                    label="+ Material Waste"
                    sub={`(${pct(totals.factors.wasteFactorPercent)} of materials)`}
                    value={totals.materialWaste}
                    indent
                  />
                )}

                {totals.laborBurden > 0 && (
                  <Row
                    label="+ Labor Burden"
                    sub={`(${pct(totals.factors.laborBurdenPercent)} of labor)`}
                    value={totals.laborBurden}
                    indent
                  />
                )}

                {totals.smallTools > 0 && (
                  <Row
                    label="+ Small Tools"
                    sub={`(${pct(totals.factors.smallToolsPercent)} of labor)`}
                    value={totals.smallTools}
                    indent
                  />
                )}

                {totals.escalation > 0 && (
                  <Row
                    label="+ Escalation"
                    sub={`(${pct(totals.factors.escalationPercent)})`}
                    value={totals.escalation}
                    indent
                  />
                )}

                {totals.overhead > 0 && (
                  <Row
                    label="+ Overhead"
                    sub={`(${pct(totals.factors.overheadPercent)})`}
                    value={totals.overhead}
                    indent
                  />
                )}

                {totals.profit > 0 && (
                  <Row
                    label="+ Profit"
                    sub={`(${pct(totals.factors.profitPercent)})`}
                    value={totals.profit}
                    indent
                  />
                )}

                {totals.bond > 0 && (
                  <Row
                    label="+ Bond"
                    sub={`(${pct(totals.factors.bondPercent)})`}
                    value={totals.bond}
                    indent
                  />
                )}

                <Separator className="my-2" />

                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold">Grand Total</span>
                  <span
                    className="text-xl font-bold text-primary"
                    data-testid="text-grand-total-markup"
                  >
                    ${fmt(totals.grandTotal)}
                  </span>
                </div>

                {source === "org_default" && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Using org-wide defaults from Company Settings &rarr; Financial &rarr; Estimating Markups.
                    {showOverrideDrawer && <> Click &ldquo;Adjust Markups&rdquo; to override for this estimate only.</>}
                  </p>
                )}
                {source === "estimate_override" && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Using custom markups pinned to this estimate.
                    {showOverrideDrawer && <> Click &ldquo;Adjust Markups&rdquo; to edit or clear the override.</>}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OrgMarkupBreakdownCard;
