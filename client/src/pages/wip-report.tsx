import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Download, ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
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
  const { data: report, isLoading } = useQuery<WipReportData>({
    queryKey: ["/api/revenue-recognition/wip-report"],
  });

  const handleExportCSV = () => {
    window.open(`/api/revenue-recognition/wip-report/csv`, "_blank");
  };

  const handleExportPDF = () => {
    window.open(`/api/revenue-recognition/wip-report/pdf`, "_blank");
  };

  const projects = report?.projects || [];
  const totals = report?.totals;

  const totalUnderbilled = projects.filter((p) => p.overUnderBilling > 0).reduce((s, p) => s + p.overUnderBilling, 0);
  const totalOverbilled = projects.filter((p) => p.overUnderBilling < 0).reduce((s, p) => s + Math.abs(p.overUnderBilling), 0);

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
                            <Link href={`/projects/${p.projectCode}`}>
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

    </div>
  );
}
