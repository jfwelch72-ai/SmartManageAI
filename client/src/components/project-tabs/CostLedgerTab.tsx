import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart3, ChevronDown, ChevronRight, RefreshCw, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";

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
}

interface CostLedgerSummary {
  rows: CostCodeLedgerRow[];
  totals: CostCodeLedgerRow;
  projectBudget: number;
  budgetLineTotal: number;
  percentComplete: number;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function getStatusColor(pctUsed: number): string {
  if (pctUsed >= 100) return "text-red-600 dark:text-red-400";
  if (pctUsed >= 90) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function getStatusIcon(pctUsed: number) {
  if (pctUsed >= 100) return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (pctUsed >= 90) return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <CheckCircle className="h-4 w-4 text-green-500" />;
}

function getProgressColor(pctUsed: number): string {
  if (pctUsed >= 100) return "[&>div]:bg-red-500";
  if (pctUsed >= 90) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-green-500";
}

export default function CostLedgerTab({ projectCode }: { projectCode: string }) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total Budget" value={fmtCurrency(totals.budgetedTotal)} data-testid="text-ledger-total-budget" />
        <SummaryCard label="Committed" value={fmtCurrency(totals.committedTotal)} data-testid="text-ledger-committed" />
        <SummaryCard label="Actual Cost" value={fmtCurrency(totals.actualTotal)} variant={totals.actualTotal > totals.budgetedTotal ? "destructive" : "default"} data-testid="text-ledger-actual" />
        <SummaryCard label="Remaining" value={fmtCurrency(totals.remainingBudget)} variant={totals.remainingBudget < 0 ? "destructive" : "default"} data-testid="text-ledger-remaining" />
        <SummaryCard label="Forecast at Completion" value={fmtCurrency(totals.forecast)} data-testid="text-ledger-forecast" />
      </div>

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
            <span>Project % Complete (time-based): <strong>{ledger.percentComplete.toFixed(0)}%</strong></span>
          </div>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]" />
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead className="w-[180px]">Description</TableHead>
                  <TableHead className="text-right w-[100px]">Budget</TableHead>
                  <TableHead className="text-right w-[100px]">Committed</TableHead>
                  <TableHead className="text-right w-[100px]">Actual</TableHead>
                  <TableHead className="text-right w-[100px]">Remaining</TableHead>
                  <TableHead className="w-[140px]">% Used</TableHead>
                  <TableHead className="text-right w-[100px]">Forecast</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDivisions.map(divName => {
                  const rows = divisionGroups.get(divName) || [];
                  const isExpanded = expandedDivisions.has(divName);
                  const divBudget = rows.reduce((s, r) => s + r.budgetedTotal, 0);
                  const divActual = rows.reduce((s, r) => s + r.actualTotal, 0);
                  const divCommitted = rows.reduce((s, r) => s + r.committedTotal, 0);
                  const divRemaining = rows.reduce((s, r) => s + r.remainingBudget, 0);
                  const divForecast = rows.reduce((s, r) => s + r.forecast, 0);
                  const divPct = divBudget > 0 ? (divActual / divBudget) * 100 : (divActual > 0 ? 100 : 0);

                  return (
                    <Fragment key={divName}>
                      <TableRow className="cursor-pointer hover:bg-muted/50 bg-muted/30 font-medium" onClick={() => toggleDivision(divName)} data-testid={`row-division-${divName}`}>
                        <TableCell>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell colSpan={2}>
                          <Badge variant="outline" className="mr-2">{rows.length}</Badge>
                          {divName}
                        </TableCell>
                        <TableCell className="text-right">{fmtCurrency(divBudget)}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(divCommitted)}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(divActual)}</TableCell>
                        <TableCell className={`text-right ${divRemaining < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmtCurrency(divRemaining)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(divPct, 100)} className={`h-2 flex-1 ${getProgressColor(divPct)}`} />
                            <span className={`text-xs font-medium ${getStatusColor(divPct)}`}>{divPct.toFixed(0)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{fmtCurrency(divForecast)}</TableCell>
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
                                  <span className="truncate block max-w-[170px]">{row.description}</span>
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
                          <TableCell className={`text-right ${row.remainingBudget < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmtCurrency(row.remainingBudget)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={Math.min(row.percentUsed, 100)} className={`h-2 flex-1 ${getProgressColor(row.percentUsed)}`} />
                              <span className={`text-xs ${getStatusColor(row.percentUsed)}`}>{row.percentUsed.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{fmtCurrency(row.forecast)}</TableCell>
                          <TableCell>{getStatusIcon(row.percentUsed)}</TableCell>
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
                  <TableCell className={`text-right ${totals.remainingBudget < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmtCurrency(totals.remainingBudget)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(totals.percentUsed, 100)} className={`h-2 flex-1 ${getProgressColor(totals.percentUsed)}`} />
                      <span className={`text-xs font-semibold ${getStatusColor(totals.percentUsed)}`}>{totals.percentUsed.toFixed(0)}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{fmtCurrency(totals.forecast)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, variant, ...props }: { label: string; value: string; variant?: "default" | "destructive"; "data-testid"?: string }) {
  return (
    <Card {...props}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold mt-1 ${variant === "destructive" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
