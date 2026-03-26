import { Fragment, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { BarChart3, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, CheckCircle, Edit2, X, Save, TrendingDown, TrendingUp, Target } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CostCodeLedgerRow {
  costCode: string;
  description: string;
  division: string;
  budgetedTotal: number;
  committedTotal: number;
  actualTotal: number;
  actualLabor: number;
  actualMaterial: number;
  actualSub: number;
  actualEquipment: number;
  actualTM: number;
  actualOther: number;
  remainingBudget: number;
  percentUsed: number;
  forecast: number;
  etc: number;
  ffc: number;
  projectedVariance: number;
  forecastAdjustment: number | null;
  forecastAdjustmentNote: string | null;
  alertLevel: string | null;
}

interface CostLedgerSummary {
  rows: CostCodeLedgerRow[];
  totals: CostCodeLedgerRow;
  projectBudget: number;
  budgetLineTotal: number;
  percentComplete: number;
  budgetAlertThreshold: number;
  budgetCriticalThreshold: number;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function getStatusColor(pctUsed: number): string {
  if (pctUsed > 100) return "text-red-600 dark:text-red-400";
  if (pctUsed >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function getStatusIcon(pctUsed: number) {
  if (pctUsed > 100) return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (pctUsed >= 80) return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <CheckCircle className="h-4 w-4 text-green-500" />;
}

function getProgressColor(pctUsed: number): string {
  if (pctUsed > 100) return "[&>div]:bg-red-500";
  if (pctUsed >= 80) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-green-500";
}

function getRemainingColor(remaining: number, budget: number): string {
  if (remaining < 0) return "text-red-600 dark:text-red-400 font-semibold";
  if (budget > 0 && remaining / budget < 0.2) return "text-amber-600 dark:text-amber-400";
  return "";
}

function getVarianceColor(variance: number): string {
  if (variance < 0) return "text-red-600 dark:text-red-400 font-semibold";
  if (variance === 0) return "";
  return "text-green-600 dark:text-green-400";
}

function getAlertBadge(alertLevel: string | null) {
  if (alertLevel === "CRITICAL") {
    return <Badge variant="destructive" className="text-xs" data-testid="badge-alert-critical">Critical</Badge>;
  }
  if (alertLevel === "WARNING") {
    return <Badge className="bg-amber-500 hover:bg-amber-600 text-xs" data-testid="badge-alert-warning">Warning</Badge>;
  }
  return null;
}

function ForecastAdjustmentPopover({ projectCode, costCode, currentValue, currentNote, onSaved }: {
  projectCode: string;
  costCode: string;
  currentValue: number | null;
  currentNote: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [etcValue, setEtcValue] = useState(currentValue !== null ? String(currentValue) : "");
  const [note, setNote] = useState(currentNote || "");
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/projects/${projectCode}/forecast-adjustments`, {
        costCode,
        adjustedETC: Number(etcValue),
        note: note || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Forecast adjustment saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "cost-ledger"] });
      setOpen(false);
      onSaved();
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/projects/${projectCode}/forecast-adjustments/${costCode}`);
    },
    onSuccess: () => {
      toast({ title: "Forecast adjustment removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "cost-ledger"] });
      setOpen(false);
      onSaved();
    },
    onError: () => {
      toast({ title: "Failed to remove", variant: "destructive" });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" data-testid={`button-edit-forecast-${costCode}`}>
          <Edit2 className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-3">
          <p className="text-sm font-medium">Forecast Adjustment: {costCode}</p>
          <div>
            <label className="text-xs text-muted-foreground">Estimate to Complete (ETC)</label>
            <Input
              type="number"
              value={etcValue}
              onChange={e => setEtcValue(e.target.value)}
              placeholder="Enter ETC amount"
              data-testid={`input-etc-${costCode}`}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Note</label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Reason for adjustment..."
              rows={2}
              data-testid={`input-etc-note-${costCode}`}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!etcValue || saveMutation.isPending} data-testid={`button-save-forecast-${costCode}`}>
              <Save className="h-3 w-3 mr-1" /> Save
            </Button>
            {currentValue !== null && (
              <Button size="sm" variant="outline" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} data-testid={`button-clear-forecast-${costCode}`}>
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function CostLedgerTab({ projectCode }: { projectCode: string }) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: ledger, isLoading, refetch, isFetching } = useQuery<CostLedgerSummary>({
    queryKey: ["/api/projects", projectCode, "cost-ledger"],
    enabled: !!projectCode,
    refetchInterval: 5 * 60 * 1000,
  });

  const toggleDivision = (div: string) => {
    setExpandedDivisions(prev => {
      const next = new Set(prev);
      if (next.has(div)) next.delete(div); else next.add(div);
      return next;
    });
  };

  const expandAll = () => {
    if (!ledger) return;
    const divs = new Set(ledger.rows.map(r => r.division));
    setExpandedDivisions(divs);
  };

  const collapseAll = () => setExpandedDivisions(new Set());

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="cost-ledger-loading">Loading cost ledger...</div>;
  }

  if (!ledger || ledger.rows.length === 0) {
    return (
      <Card data-testid="cost-ledger-empty">
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium mb-1">No Cost Data Available</p>
          <p className="text-sm">Set up budget lines in the Budget tab and record costs to see your cost ledger.</p>
        </CardContent>
      </Card>
    );
  }

  const divisionGroups = new Map<string, CostCodeLedgerRow[]>();
  for (const row of ledger.rows) {
    const group = divisionGroups.get(row.division) || [];
    group.push(row);
    divisionGroups.set(row.division, group);
  }

  const sortedDivisions = [...divisionGroups.keys()].sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });

  const { totals } = ledger;

  return (
    <div className="space-y-4" data-testid="cost-ledger-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Total Budget" value={fmtCurrency(totals.budgetedTotal)} data-testid="text-ledger-total-budget" />
        <SummaryCard label="Committed" value={fmtCurrency(totals.committedTotal)} data-testid="text-ledger-committed" />
        <SummaryCard label="Actual Cost" value={fmtCurrency(totals.actualTotal)} variant={totals.actualTotal > totals.budgetedTotal ? "destructive" : "default"} data-testid="text-ledger-actual" />
        <SummaryCard label="Remaining" value={fmtCurrency(totals.remainingBudget)} variant={totals.remainingBudget < 0 ? "destructive" : "default"} data-testid="text-ledger-remaining" />
        <SummaryCard label="Est. to Complete" value={fmtCurrency(totals.etc)} icon={<Target className="h-4 w-4 text-blue-500" />} data-testid="text-ledger-etc" />
        <SummaryCard label="Forecast Final Cost" value={fmtCurrency(totals.ffc)} icon={<TrendingUp className="h-4 w-4 text-purple-500" />} variant={totals.ffc > totals.budgetedTotal ? "destructive" : "default"} data-testid="text-ledger-ffc" />
        <SummaryCard label="Projected Variance" value={fmtCurrency(totals.projectedVariance)} icon={totals.projectedVariance >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />} variant={totals.projectedVariance < 0 ? "destructive" : "default"} data-testid="text-ledger-proj-variance" />
      </div>

      {totals.alertLevel && (
        <Card className={totals.alertLevel === "CRITICAL" ? "border-red-500 bg-red-50 dark:bg-red-950/20" : "border-amber-500 bg-amber-50 dark:bg-amber-950/20"} data-testid="card-budget-alert-banner">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className={`h-5 w-5 ${totals.alertLevel === "CRITICAL" ? "text-red-500" : "text-amber-500"}`} />
            <div>
              <p className="font-medium text-sm">
                {totals.alertLevel === "CRITICAL" ? "Critical Budget Alert" : "Budget Warning"}
              </p>
              <p className="text-xs text-muted-foreground">
                Project has used {totals.percentUsed.toFixed(0)}% of total budget
                ({totals.alertLevel === "CRITICAL" ? `${ledger.budgetCriticalThreshold}%` : `${ledger.budgetAlertThreshold}%`} threshold)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2" data-testid="text-ledger-title">
            <BarChart3 className="h-5 w-5" />
            Cost Ledger by Cost Code
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={expandAll} data-testid="button-expand-all">Expand All</Button>
            <Button variant="ghost" size="sm" onClick={collapseAll} data-testid="button-collapse-all">Collapse All</Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-ledger">
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-4">
            <span>
              Project % Complete (time-based): <strong>{ledger.percentComplete > 0 ? `${ledger.percentComplete.toFixed(0)}%` : "N/A"}</strong>
              {ledger.percentComplete === 0 && " — Set project start/end dates for time-based forecasting"}
            </span>
          </div>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]" />
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead className="w-[160px]">Description</TableHead>
                  <TableHead className="text-right w-[90px]">Budget</TableHead>
                  <TableHead className="text-right w-[90px]">Committed</TableHead>
                  <TableHead className="text-right w-[90px]">Actual</TableHead>
                  <TableHead className="text-right w-[90px]">ETC</TableHead>
                  <TableHead className="text-right w-[90px]">FFC</TableHead>
                  <TableHead className="text-right w-[90px]">Proj. Var.</TableHead>
                  <TableHead className="w-[120px]">% Used</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDivisions.map(divName => {
                  const rows = divisionGroups.get(divName) || [];
                  const isExpanded = expandedDivisions.has(divName);
                  const divBudget = rows.reduce((s, r) => s + r.budgetedTotal, 0);
                  const divActual = rows.reduce((s, r) => s + r.actualTotal, 0);
                  const divCommitted = rows.reduce((s, r) => s + r.committedTotal, 0);
                  const divETC = rows.reduce((s, r) => s + r.etc, 0);
                  const divFFC = rows.reduce((s, r) => s + r.ffc, 0);
                  const divVariance = rows.reduce((s, r) => s + r.projectedVariance, 0);
                  const divPct = divBudget > 0 ? (divActual / divBudget) * 100 : (divActual > 0 ? 100 : 0);
                  const divAlertLevel = rows.some(r => r.alertLevel === "CRITICAL") ? "CRITICAL" : rows.some(r => r.alertLevel === "WARNING") ? "WARNING" : null;

                  return (
                    <Fragment key={divName}>
                      <TableRow className="cursor-pointer hover:bg-muted/50 bg-muted/30 font-medium" onClick={() => toggleDivision(divName)} data-testid={`row-division-${divName}`}>
                        <TableCell>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell colSpan={2}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="mr-1">{rows.length}</Badge>
                            {divName}
                            {divAlertLevel && getAlertBadge(divAlertLevel)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{fmtCurrency(divBudget)}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(divCommitted)}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(divActual)}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(divETC)}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(divFFC)}</TableCell>
                        <TableCell className={`text-right ${getVarianceColor(divVariance)}`}>{fmtCurrency(divVariance)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(divPct, 100)} className={`h-2 flex-1 ${getProgressColor(divPct)}`} />
                            <span className={`text-xs font-medium ${getStatusColor(divPct)}`}>{divPct.toFixed(0)}%</span>
                          </div>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                      {isExpanded && rows.map(row => (
                        <TableRow key={row.costCode} className="text-sm" data-testid={`row-cost-code-${row.costCode}`}>
                          <TableCell />
                          <TableCell className="font-mono text-xs">{row.costCode}</TableCell>
                          <TableCell>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate block max-w-[150px]">{row.description}</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="text-xs">
                                    Labor: {fmtCurrency(row.actualLabor)} | Material: {fmtCurrency(row.actualMaterial)} | Sub: {fmtCurrency(row.actualSub)}<br />
                                    Equipment: {fmtCurrency(row.actualEquipment)} | T&M: {fmtCurrency(row.actualTM)} | Other: {fmtCurrency(row.actualOther)}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="text-right">{fmtCurrency(row.budgetedTotal)}</TableCell>
                          <TableCell className="text-right">{fmtCurrency(row.committedTotal)}</TableCell>
                          <TableCell className="text-right">{fmtCurrency(row.actualTotal)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className={row.forecastAdjustment !== null ? "text-blue-600 dark:text-blue-400" : ""}>
                                {fmtCurrency(row.etc)}
                              </span>
                              <ForecastAdjustmentPopover
                                projectCode={projectCode}
                                costCode={row.costCode}
                                currentValue={row.forecastAdjustment}
                                currentNote={row.forecastAdjustmentNote}
                                onSaved={() => {}}
                              />
                            </div>
                            {row.forecastAdjustmentNote && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-blue-500 cursor-help">adjusted</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs max-w-[200px]">{row.forecastAdjustmentNote}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{fmtCurrency(row.ffc)}</TableCell>
                          <TableCell className={`text-right ${getVarianceColor(row.projectedVariance)}`}>{fmtCurrency(row.projectedVariance)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={Math.min(row.percentUsed, 100)} className={`h-2 flex-1 ${getProgressColor(row.percentUsed)}`} />
                              <span className={`text-xs ${getStatusColor(row.percentUsed)}`}>{row.percentUsed.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(row.percentUsed)}
                              {getAlertBadge(row.alertLevel)}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold" data-testid="row-ledger-totals">
                  <TableCell />
                  <TableCell colSpan={2}>Project Total</TableCell>
                  <TableCell className="text-right">{fmtCurrency(totals.budgetedTotal)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(totals.committedTotal)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(totals.actualTotal)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(totals.etc)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(totals.ffc)}</TableCell>
                  <TableCell className={`text-right ${getVarianceColor(totals.projectedVariance)}`}>{fmtCurrency(totals.projectedVariance)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(totals.percentUsed, 100)} className={`h-2 flex-1 ${getProgressColor(totals.percentUsed)}`} />
                      <span className={`text-xs font-semibold ${getStatusColor(totals.percentUsed)}`}>{totals.percentUsed.toFixed(0)}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {getAlertBadge(totals.alertLevel)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, variant, icon, ...props }: { label: string; value: string; variant?: "default" | "destructive"; icon?: React.ReactNode; "data-testid"?: string }) {
  return (
    <Card {...props}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1">
          {icon}
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className={`text-lg font-bold mt-1 ${variant === "destructive" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
