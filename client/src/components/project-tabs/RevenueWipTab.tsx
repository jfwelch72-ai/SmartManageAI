import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, TrendingUp, TrendingDown, ArrowRight, Camera, Download, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WipData {
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string | null;
  contractValue: number;
  changeOrderAdjustments: number;
  adjustedContractValue: number;
  costsToDate: number;
  estimatedTotalCost: number;
  percentComplete: number;
  earnedRevenue: number;
  billingsToDate: number;
  overUnderBilling: number;
  grossProfit: number;
  grossProfitPercent: number;
}

interface HistorySnapshot {
  id: string;
  period: string;
  snapshotDate: string;
  contractValue: string;
  adjustedContractValue: string;
  costsToDate: string;
  estimatedTotalCost: string;
  percentComplete: string;
  earnedRevenue: string;
  billingsToDate: string;
  overUnderBilling: string;
  grossProfit: string;
  grossProfitPercent: string;
}

function fmt(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  const abs = Math.abs(num);
  const formatted = "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `(${formatted})` : formatted;
}

function pct(value: number): string {
  return value.toFixed(1) + "%";
}

interface RevenueWipTabProps {
  projectId: string;
  projectCode: string;
}

export default function RevenueWipTab({ projectId, projectCode }: RevenueWipTabProps) {
  const { toast } = useToast();

  const { data: wipData, isLoading } = useQuery<WipData>({
    queryKey: ["/api/revenue-recognition/project", projectId],
    queryFn: () => apiRequest("GET", `/api/revenue-recognition/project/${projectId}`).then((r) => r.json()),
    enabled: !!projectId,
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<HistorySnapshot[]>({
    queryKey: ["/api/revenue-recognition/history", projectId],
    queryFn: () => apiRequest("GET", `/api/revenue-recognition/history?projectId=${projectId}&months=12`).then((r) => r.json()),
    enabled: !!projectId,
  });

  const snapshotMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/revenue-recognition/snapshot"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-recognition/history"] });
      toast({ title: "Monthly snapshot saved" });
    },
    onError: () => toast({ title: "Failed to save snapshot", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!wipData) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-wip-data">
          No revenue recognition data available for this project.
        </CardContent>
      </Card>
    );
  }

  const billingPosition = wipData.overUnderBilling;
  const isUnderbilled = billingPosition > 0;
  const isOverbilled = billingPosition < 0;

  return (
    <div className="space-y-6" data-testid="revenue-wip-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Revenue & WIP Analysis</h3>
          <p className="text-sm text-muted-foreground">Cost-to-cost method revenue recognition</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => snapshotMutation.mutate()}
          disabled={snapshotMutation.isPending}
          data-testid="button-save-snapshot"
        >
          {snapshotMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
          Save Snapshot
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-percent-complete">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">% Complete (Cost-to-Cost)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-percent-complete">{pct(wipData.percentComplete)}</div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, wipData.percentComplete)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-earned-revenue">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Earned Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-earned-revenue">{fmt(wipData.earnedRevenue)}</div>
            <p className="text-xs text-muted-foreground">of {fmt(wipData.adjustedContractValue)} adjusted contract</p>
          </CardContent>
        </Card>

        <Card data-testid="card-billing-position">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Billing Position</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${isUnderbilled ? "text-amber-600" : isOverbilled ? "text-blue-600" : ""}`} data-testid="text-billing-position">
                {fmt(Math.abs(billingPosition))}
              </span>
              <Badge
                variant={isUnderbilled ? "destructive" : isOverbilled ? "default" : "secondary"}
                data-testid="badge-billing-status"
              >
                {isUnderbilled ? "Underbilled" : isOverbilled ? "Overbilled" : "Even"}
              </Badge>
            </div>
            {isUnderbilled && (
              <p className="text-xs text-amber-600 mt-1">Revenue earned exceeds billings</p>
            )}
            {isOverbilled && (
              <p className="text-xs text-blue-600 mt-1">Billings exceed earned revenue</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-gross-profit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gross Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${wipData.grossProfit >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-gross-profit">
                {fmt(wipData.grossProfit)}
              </span>
              {wipData.grossProfit >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{pct(wipData.grossProfitPercent)} margin</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-calculation-breakdown">
        <CardHeader>
          <CardTitle className="text-base">Revenue Recognition Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm font-medium">Contract Value</span>
              <span className="text-sm font-mono text-right" data-testid="text-contract-value">{fmt(wipData.contractValue)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm text-muted-foreground pl-4">+ Approved Change Orders</span>
              <span className="text-sm font-mono text-right" data-testid="text-co-adjustments">{fmt(wipData.changeOrderAdjustments)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b bg-muted/50 px-2 rounded">
              <span className="text-sm font-semibold">= Adjusted Contract Value</span>
              <span className="text-sm font-mono font-semibold text-right" data-testid="text-adjusted-contract">{fmt(wipData.adjustedContractValue)}</span>
            </div>

            <div className="pt-4" />

            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm font-medium">Actual Costs to Date</span>
              <span className="text-sm font-mono text-right" data-testid="text-costs-to-date">{fmt(wipData.costsToDate)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm text-muted-foreground pl-4">/ Estimated Total Cost (EAC)</span>
              <span className="text-sm font-mono text-right" data-testid="text-estimated-total-cost">{fmt(wipData.estimatedTotalCost)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b bg-muted/50 px-2 rounded">
              <span className="text-sm font-semibold flex items-center gap-2">
                = % Complete (Cost-to-Cost)
                <ArrowRight className="h-3 w-3" />
              </span>
              <span className="text-sm font-mono font-semibold text-right" data-testid="text-pct-complete-breakdown">{pct(wipData.percentComplete)}</span>
            </div>

            <div className="pt-4" />

            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm text-muted-foreground pl-4">{pct(wipData.percentComplete)} x {fmt(wipData.adjustedContractValue)}</span>
              <span className="text-sm text-muted-foreground text-right" />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b bg-muted/50 px-2 rounded">
              <span className="text-sm font-semibold">= Earned Revenue</span>
              <span className="text-sm font-mono font-semibold text-right" data-testid="text-earned-rev-breakdown">{fmt(wipData.earnedRevenue)}</span>
            </div>

            <div className="pt-4" />

            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm font-medium">Earned Revenue</span>
              <span className="text-sm font-mono text-right">{fmt(wipData.earnedRevenue)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 py-2 border-b">
              <span className="text-sm text-muted-foreground pl-4">- Actual Billings to Date</span>
              <span className="text-sm font-mono text-right" data-testid="text-billings-to-date">{fmt(wipData.billingsToDate)}</span>
            </div>
            <div className={`grid grid-cols-[1fr_auto] gap-4 py-2 px-2 rounded ${isUnderbilled ? "bg-amber-50 dark:bg-amber-950/20" : isOverbilled ? "bg-blue-50 dark:bg-blue-950/20" : "bg-muted/50"}`}>
              <span className="text-sm font-semibold">
                = WIP Position ({isUnderbilled ? "Underbilled" : isOverbilled ? "Overbilled" : "Even"})
              </span>
              <span className={`text-sm font-mono font-semibold text-right ${isUnderbilled ? "text-amber-600" : isOverbilled ? "text-blue-600" : ""}`} data-testid="text-wip-position">
                {fmt(wipData.overUnderBilling)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card data-testid="card-historical-snapshots">
          <CardHeader>
            <CardTitle className="text-base">Historical Snapshots</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-history">
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Adj. Contract</TableHead>
                    <TableHead className="text-right">Costs</TableHead>
                    <TableHead className="text-right">% Complete</TableHead>
                    <TableHead className="text-right">Earned Rev.</TableHead>
                    <TableHead className="text-right">Billings</TableHead>
                    <TableHead className="text-right">Over/(Under)</TableHead>
                    <TableHead className="text-right">GP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((snap) => {
                    const ou = parseFloat(snap.overUnderBilling);
                    return (
                      <TableRow key={snap.id} data-testid={`row-snapshot-${snap.period}`}>
                        <TableCell className="font-medium">{snap.period}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(snap.adjustedContractValue)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(snap.costsToDate)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{parseFloat(snap.percentComplete).toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(snap.earnedRevenue)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(snap.billingsToDate)}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${ou > 0 ? "text-amber-600" : ou < 0 ? "text-blue-600" : ""}`}>
                          {fmt(snap.overUnderBilling)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(snap.grossProfit)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
