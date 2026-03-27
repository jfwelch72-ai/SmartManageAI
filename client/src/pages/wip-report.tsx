import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, Camera, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface WipProject {
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

interface WipReportData {
  projects: WipProject[];
  totals: {
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
  } | null;
}

interface HistorySnapshot {
  id: string;
  projectId: string;
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

function pct(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return num.toFixed(1) + "%";
}

export default function WipReportPage() {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"current" | "history">("current");
  const [historyMonths, setHistoryMonths] = useState("12");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: report, isLoading } = useQuery<WipReportData>({
    queryKey: ["/api/revenue-recognition/wip-report"],
  });

  const historyParams = new URLSearchParams({ months: historyMonths });
  if (startDate) historyParams.set("startDate", startDate);
  if (endDate) historyParams.set("endDate", endDate);

  const { data: history = [], isLoading: historyLoading } = useQuery<HistorySnapshot[]>({
    queryKey: ["/api/revenue-recognition/history", historyMonths, startDate, endDate],
    queryFn: () => apiRequest("GET", `/api/revenue-recognition/history?${historyParams.toString()}`).then((r) => r.json()),
  });

  const snapshotMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/revenue-recognition/snapshot"),
    onSuccess: (_, __, ___) => {
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-recognition/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-recognition/wip-report"] });
      toast({ title: "Monthly snapshot saved successfully" });
    },
    onError: () => toast({ title: "Failed to save snapshot", variant: "destructive" }),
  });

  const handleExportCSV = () => {
    const params = new URLSearchParams();
    if (activeView === "history") {
      params.set("mode", "history");
      params.set("months", historyMonths);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    }
    const qs = params.toString();
    window.open(`/api/revenue-recognition/wip-report/csv${qs ? "?" + qs : ""}`, "_blank");
  };

  const handleExportPDF = () => {
    const params = new URLSearchParams();
    if (activeView === "history") {
      params.set("mode", "history");
      params.set("months", historyMonths);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    }
    const qs = params.toString();
    window.open(`/api/revenue-recognition/wip-report/pdf${qs ? "?" + qs : ""}`, "_blank");
  };

  const projects = report?.projects || [];
  const totals = report?.totals;

  const projectLookup = projects.reduce<Record<string, { code: string; name: string }>>((acc, p) => {
    acc[p.projectId] = { code: p.projectCode, name: p.projectName };
    return acc;
  }, {});

  const totalUnderbilled = projects.filter((p) => p.overUnderBilling > 0).reduce((s, p) => s + p.overUnderBilling, 0);
  const totalOverbilled = projects.filter((p) => p.overUnderBilling < 0).reduce((s, p) => s + Math.abs(p.overUnderBilling), 0);

  const groupedHistory = history.reduce<Record<string, HistorySnapshot[]>>((acc, snap) => {
    if (!acc[snap.period]) acc[snap.period] = [];
    acc[snap.period].push(snap);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="wip-report-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/cfo">
            <Button variant="ghost" size="sm" data-testid="button-back-cfo">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to CFO
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">WIP Schedule Report</h1>
            <p className="text-muted-foreground">Work-in-Progress report using cost-to-cost revenue recognition</p>
          </div>
        </div>
        <div className="flex gap-2">
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
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} data-testid="button-export-pdf">
            <Download className="mr-1.5 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total-contract">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Adjusted Contract</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-contract">
              {isLoading ? "..." : fmt(totals?.adjustedContractValue || 0)}
            </div>
            <p className="text-xs text-muted-foreground">{projects.length} active projects</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-earned">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earned Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-earned">
              {isLoading ? "..." : fmt(totals?.earnedRevenue || 0)}
            </div>
            <p className="text-xs text-muted-foreground">{pct(totals?.percentComplete || 0)} complete overall</p>
          </CardContent>
        </Card>

        <Card data-testid="card-underbilled">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Underbilled (Asset)</CardTitle>
            <TrendingDown className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600" data-testid="text-total-underbilled">
              {isLoading ? "..." : fmt(totalUnderbilled)}
            </div>
            <p className="text-xs text-muted-foreground">
              {projects.filter((p) => p.overUnderBilling > 0).length} projects
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-overbilled">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overbilled (Liability)</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" data-testid="text-total-overbilled">
              {isLoading ? "..." : fmt(totalOverbilled)}
            </div>
            <p className="text-xs text-muted-foreground">
              {projects.filter((p) => p.overUnderBilling < 0).length} projects
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button
          variant={activeView === "current" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveView("current")}
          data-testid="button-view-current"
        >
          Current WIP
        </Button>
        <Button
          variant={activeView === "history" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveView("history")}
          data-testid="button-view-history"
        >
          Historical Snapshots
        </Button>
      </div>

      {activeView === "current" && (
        <Card data-testid="card-wip-schedule">
          <CardHeader>
            <CardTitle className="text-base">WIP Schedule — All Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-projects">
                No active projects with financial data found.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="table-wip-schedule">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10">Project</TableHead>
                      <TableHead className="text-right">Contract Value</TableHead>
                      <TableHead className="text-right">Costs to Date</TableHead>
                      <TableHead className="text-right">Est. Total Cost</TableHead>
                      <TableHead className="text-right">% Complete</TableHead>
                      <TableHead className="text-right">Earned Revenue</TableHead>
                      <TableHead className="text-right">Billings to Date</TableHead>
                      <TableHead className="text-right">Over/(Under)</TableHead>
                      <TableHead className="text-right">Gross Profit</TableHead>
                      <TableHead className="text-right">GP %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((p) => {
                      const isUnderbilled = p.overUnderBilling > 0;
                      const isOverbilled = p.overUnderBilling < 0;
                      return (
                        <TableRow key={p.projectId} data-testid={`row-project-${p.projectCode}`}>
                          <TableCell className="sticky left-0 bg-background z-10">
                            <Link href={`/projects/${p.projectCode}?tab=revenue-wip`}>
                              <span className="font-medium text-primary hover:underline cursor-pointer" data-testid={`link-project-${p.projectCode}`}>
                                {p.projectCode}
                              </span>
                            </Link>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{p.projectName}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(p.adjustedContractValue)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(p.costsToDate)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(p.estimatedTotalCost)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{pct(p.percentComplete)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(p.earnedRevenue)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(p.billingsToDate)}</TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono text-sm ${isUnderbilled ? "text-amber-600" : isOverbilled ? "text-blue-600" : ""}`}>
                              {fmt(p.overUnderBilling)}
                            </span>
                            {(isUnderbilled || isOverbilled) && (
                              <Badge
                                variant={isUnderbilled ? "destructive" : "default"}
                                className="ml-1 text-[10px] px-1 py-0"
                                data-testid={`badge-billing-${p.projectCode}`}
                              >
                                {isUnderbilled ? "U" : "O"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${p.grossProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {fmt(p.grossProfit)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{pct(p.grossProfitPercent)}</TableCell>
                        </TableRow>
                      );
                    })}

                    {totals && (
                      <TableRow className="bg-muted/50 font-semibold border-t-2" data-testid="row-totals">
                        <TableCell className="sticky left-0 bg-muted/50 z-10 font-bold">TOTALS</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(totals.adjustedContractValue)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(totals.costsToDate)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(totals.estimatedTotalCost)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{pct(totals.percentComplete)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(totals.earnedRevenue)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(totals.billingsToDate)}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${totals.overUnderBilling > 0 ? "text-amber-600" : totals.overUnderBilling < 0 ? "text-blue-600" : ""}`}>
                          {fmt(totals.overUnderBilling)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${totals.grossProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {fmt(totals.grossProfit)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{pct(totals.grossProfitPercent)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeView === "history" && (
        <Card data-testid="card-history">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Historical WIP Snapshots</CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <label className="text-xs text-muted-foreground">From</label>
                  <input
                    type="month"
                    value={startDate ? startDate.substring(0, 7) : ""}
                    onChange={(e) => setStartDate(e.target.value ? e.target.value + "-01" : "")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    data-testid="input-start-date"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-xs text-muted-foreground">To</label>
                  <input
                    type="month"
                    value={endDate ? endDate.substring(0, 7) : ""}
                    onChange={(e) => setEndDate(e.target.value ? e.target.value + "-01" : "")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    data-testid="input-end-date"
                  />
                </div>
                <Select value={historyMonths} onValueChange={setHistoryMonths}>
                  <SelectTrigger className="w-[140px]" data-testid="select-months">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">Last 6 months</SelectItem>
                    <SelectItem value="12">Last 12 months</SelectItem>
                    <SelectItem value="24">Last 24 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-history">
                  No snapshots yet. Click "Save Snapshot" to capture the current WIP position.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedHistory)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([period, snaps]) => {
                    const periodTotals = snaps.reduce(
                      (acc, s) => ({
                        earnedRevenue: acc.earnedRevenue + parseFloat(s.earnedRevenue),
                        billingsToDate: acc.billingsToDate + parseFloat(s.billingsToDate),
                        overUnderBilling: acc.overUnderBilling + parseFloat(s.overUnderBilling),
                        grossProfit: acc.grossProfit + parseFloat(s.grossProfit),
                      }),
                      { earnedRevenue: 0, billingsToDate: 0, overUnderBilling: 0, grossProfit: 0 },
                    );

                    return (
                      <div key={period} data-testid={`history-period-${period}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-sm">{period}</h4>
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>Earned: {fmt(periodTotals.earnedRevenue)}</span>
                            <span className={periodTotals.overUnderBilling > 0 ? "text-amber-600" : periodTotals.overUnderBilling < 0 ? "text-blue-600" : ""}>
                              Net: {fmt(periodTotals.overUnderBilling)}
                            </span>
                            <span className={periodTotals.grossProfit >= 0 ? "text-green-600" : "text-red-600"}>
                              GP: {fmt(periodTotals.grossProfit)}
                            </span>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Project</TableHead>
                                <TableHead className="text-right">Adj. Contract</TableHead>
                                <TableHead className="text-right">% Complete</TableHead>
                                <TableHead className="text-right">Earned Rev.</TableHead>
                                <TableHead className="text-right">Billings</TableHead>
                                <TableHead className="text-right">Over/(Under)</TableHead>
                                <TableHead className="text-right">GP</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {snaps.map((snap) => {
                                const ou = parseFloat(snap.overUnderBilling);
                                return (
                                  <TableRow key={snap.id}>
                                    <TableCell className="text-sm font-medium" title={projectLookup[snap.projectId]?.name || snap.projectId}>
                                      {projectLookup[snap.projectId]?.code || snap.projectId.substring(0, 8)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">{fmt(snap.adjustedContractValue)}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">{pct(snap.percentComplete)}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">{fmt(snap.earnedRevenue)}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">{fmt(snap.billingsToDate)}</TableCell>
                                    <TableCell className={`text-right font-mono text-sm ${ou > 0 ? "text-amber-600" : ou < 0 ? "text-blue-600" : ""}`}>
                                      {fmt(snap.overUnderBilling)}
                                    </TableCell>
                                    <TableCell className={`text-right font-mono text-sm ${parseFloat(snap.grossProfit) >= 0 ? "text-green-600" : "text-red-600"}`}>
                                      {fmt(snap.grossProfit)}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
