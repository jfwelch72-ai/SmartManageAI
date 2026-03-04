import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Printer,
  Download,
  RotateCcw,
  Filter,
  ChevronsUpDown,
  Camera,
  Ruler,
  DollarSign,
  Hash,
  BarChart3,
  Layers,
  List,
  PieChart,
  LayoutList,
  ClipboardList,
  TrendingDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TAKEOFF_REPORTS = [
  { id: "takeoff-quantity", label: "Takeoff Quantity", icon: Hash, endpoint: "/api/reports/takeoff/quantity" },
  { id: "takeoff-summary", label: "Takeoff Summary", icon: BarChart3, endpoint: "/api/reports/takeoff/summary" },
  { id: "measurements-by-takeoff", label: "Measurements By Takeoff", icon: Layers, endpoint: "/api/reports/takeoff/by-takeoff" },
  { id: "item-list", label: "Item List", icon: List, endpoint: "/api/reports/takeoff/items" },
  { id: "item-cost", label: "Item Cost", icon: DollarSign, endpoint: "/api/reports/takeoff/item-cost" },
  { id: "item-cost-by-type", label: "Item Cost By Type", icon: PieChart, endpoint: "/api/reports/takeoff/item-cost-by-type" },
  { id: "item-cost-by-takeoff", label: "Item Cost By Takeoff", icon: LayoutList, endpoint: "/api/reports/takeoff/item-cost-by-takeoff" },
] as const;

const ESTIMATE_REPORTS = [
  { id: "estimate-summary", label: "Estimate Summary", icon: ClipboardList, endpoint: "/api/reports/estimates/summary" },
  { id: "cost-breakdown", label: "Cost Breakdown", icon: TrendingDown, endpoint: "/api/reports/estimates/cost-breakdown" },
] as const;

type ReportId = typeof TAKEOFF_REPORTS[number]["id"] | typeof ESTIMATE_REPORTS[number]["id"];

function getReportLabel(reportId: ReportId): string {
  const all = [...TAKEOFF_REPORTS, ...ESTIMATE_REPORTS];
  return all.find(r => r.id === reportId)?.label || reportId;
}

function getReportEndpoint(reportId: ReportId): string {
  const all = [...TAKEOFF_REPORTS, ...ESTIMATE_REPORTS];
  return all.find(r => r.id === reportId)?.endpoint || "";
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [selectedReport, setSelectedReport] = useState<ReportId>("takeoff-quantity");
  const [takeoffOpen, setTakeoffOpen] = useState(true);
  const [estimateOpen, setEstimateOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const { data: projectsData } = useQuery<any>({
    queryKey: ["/api/projects"],
  });
  const projects = projectsData?.data || projectsData || [];

  const isEstimateReport = selectedReport === "estimate-summary" || selectedReport === "cost-breakdown";
  const endpoint = getReportEndpoint(selectedReport);
  const fullUrl = projectFilter && projectFilter !== "all" ? `${endpoint}?projectId=${projectFilter}` : endpoint;

  const { data: reportData, isLoading } = useQuery<any>({
    queryKey: [fullUrl],
    enabled: !!endpoint && !(isEstimateReport && projectFilter === "all"),
  });

  const handlePrint = () => window.print();

  const handleExport = () => {
    if (!reportData) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const csv = generateCSV(selectedReport, reportData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedReport}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Report exported", description: "CSV file downloaded successfully." });
  };

  const handleSnapshot = () => {
    toast({ title: "Snapshot created", description: `${getReportLabel(selectedReport)} snapshot saved.` });
  };

  const handleReset = () => {
    setProjectFilter("all");
    setExpanded(false);
  };

  const allReports = [
    ...TAKEOFF_REPORTS.map(r => ({ ...r, group: "Takeoff Reports" })),
    ...ESTIMATE_REPORTS.map(r => ({ ...r, group: "Estimate Reports" })),
  ];

  return (
    <div className="flex h-full print:block">
      {!isMobile && (
        <aside className="w-60 border-r bg-muted/30 p-3 space-y-1 overflow-y-auto print:hidden flex-shrink-0">
          <div className="flex items-center gap-2 px-2 py-2 mb-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Reports</span>
          </div>

          <Collapsible open={takeoffOpen} onOpenChange={setTakeoffOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="toggle-takeoff-reports">
              <span className="flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5" /> Takeoff Reports</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${takeoffOpen ? "" : "-rotate-90"}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5">
                {TAKEOFF_REPORTS.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedReport(r.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-2 ${
                      selectedReport === r.id ? "bg-primary/10 text-primary font-medium" : "text-foreground/80 hover:bg-muted"
                    }`}
                    data-testid={`nav-report-${r.id}`}
                  >
                    <r.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {r.label}
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={estimateOpen} onOpenChange={setEstimateOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2" data-testid="toggle-estimate-reports">
              <span className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Estimate Reports</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${estimateOpen ? "" : "-rotate-90"}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5">
                {ESTIMATE_REPORTS.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedReport(r.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-2 ${
                      selectedReport === r.id ? "bg-primary/10 text-primary font-medium" : "text-foreground/80 hover:bg-muted"
                    }`}
                    data-testid={`nav-report-${r.id}`}
                  >
                    <r.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {r.label}
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </aside>
      )}

      <div className="flex-1 overflow-auto">
        <div className={`${isMobile ? "px-3 py-4" : "p-6"} max-w-6xl mx-auto space-y-4`}>
          <div className={`flex ${isMobile ? "flex-col gap-3" : "items-center justify-between gap-4 flex-wrap"}`}>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary print:hidden" />
              <h1 className="text-xl font-bold" data-testid="text-reports-title">
                {getReportLabel(selectedReport)}
              </h1>
            </div>

            <div className={`flex ${isMobile ? "flex-wrap w-full gap-2" : "items-center gap-2"} print:hidden`}>
              <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)} className={isMobile ? "flex-1" : ""} data-testid="button-expand-toggle">
                <ChevronsUpDown className="h-4 w-4 mr-1" />
                {expanded ? "Collapse" : "Expand"}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={isMobile ? "flex-1" : ""} data-testid="button-data-filters">
                    <Filter className="h-4 w-4 mr-1" />
                    Data Filters
                    {projectFilter !== "all" && <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-xs">1</Badge>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72" align="end">
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Filter by Project</p>
                    <Select value={projectFilter} onValueChange={setProjectFilter}>
                      <SelectTrigger data-testid="select-project-filter">
                        <SelectValue placeholder="All Projects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Projects</SelectItem>
                        {Array.isArray(projects) && projects.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} {p.code ? `(${p.code})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="sm" onClick={handleReset} className={isMobile ? "flex-1" : ""} data-testid="button-reset">
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint} className={isMobile ? "flex-1" : ""} data-testid="button-print">
                <Printer className="h-4 w-4 mr-1" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} className={isMobile ? "flex-1" : ""} data-testid="button-export">
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
              <Button variant="outline" size="sm" onClick={handleSnapshot} className={isMobile ? "flex-1" : ""} data-testid="button-snapshot">
                <Camera className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Create </span>Snapshot
              </Button>
            </div>
          </div>

          {isMobile && (
            <Select value={selectedReport} onValueChange={(v) => setSelectedReport(v as ReportId)}>
              <SelectTrigger className="w-full" data-testid="select-report-type-mobile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allReports.map((r, i) => {
                  const prevGroup = i > 0 ? allReports[i - 1].group : null;
                  const showGroupLabel = r.group !== prevGroup;
                  const Icon = r.icon;
                  return (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {showGroupLabel && i > 0 ? "— " : ""}{r.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}

          {!isMobile && (
            <div className="flex items-center gap-2 print:hidden">
              <Select value={selectedReport} onValueChange={(v) => setSelectedReport(v as ReportId)}>
                <SelectTrigger className="w-64" data-testid="select-report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allReports.map(r => {
                    const Icon = r.icon;
                    return (
                      <SelectItem key={r.id} value={r.id}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          {r.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {isEstimateReport && projectFilter === "all" ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState message="Estimate reports require a project selection. Use the Data Filters button above to choose a project." />
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Card>
              <CardContent className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <ReportContent reportId={selectedReport} data={reportData} expanded={expanded} isMobile={isMobile} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          nav, aside, header, [data-testid="button-sidebar-toggle"], .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
        }
      `}</style>
    </div>
  );
}

function ReportContent({ reportId, data, expanded, isMobile }: { reportId: ReportId; data: any; expanded: boolean; isMobile: boolean }) {
  switch (reportId) {
    case "takeoff-quantity": return <TakeoffQuantityReport data={data} isMobile={isMobile} />;
    case "takeoff-summary": return <TakeoffSummaryReport data={data} isMobile={isMobile} />;
    case "measurements-by-takeoff": return <MeasurementsByTakeoffReport data={data} expanded={expanded} isMobile={isMobile} />;
    case "item-list": return <ItemListReport data={data} isMobile={isMobile} />;
    case "item-cost": return <ItemCostReport data={data} isMobile={isMobile} />;
    case "item-cost-by-type": return <ItemCostByTypeReport data={data} expanded={expanded} isMobile={isMobile} />;
    case "item-cost-by-takeoff": return <ItemCostByTakeoffReport data={data} expanded={expanded} isMobile={isMobile} />;
    case "estimate-summary": return <EstimateSummaryReport data={data} isMobile={isMobile} />;
    case "cost-breakdown": return <CostBreakdownReport data={data} isMobile={isMobile} />;
    default: return <EmptyState />;
  }
}

function ReportHeader({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-emerald-700 dark:bg-emerald-800 text-white text-sm">
        {children}
      </tr>
    </thead>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium whitespace-nowrap ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 border-b border-border/50 ${className}`}>{children}</td>;
}

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="py-12 text-center text-muted-foreground" data-testid="text-empty-report">
      <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{message || "No data available for this report."}</p>
      <p className="text-xs mt-1">Select a project or adjust filters to view report data.</p>
    </div>
  );
}

function TakeoffQuantityReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-takeoff-quantity">
        <ReportHeader>
          <Th className="text-left">Takeoff Description</Th>
          <Th className="text-right">Takeoff Quantity</Th>
          <Th className="text-left">Takeoff Unit</Th>
          <Th className="text-left">Scale</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id || i} className="hover:bg-muted/30" data-testid={`row-quantity-${i}`}>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-right font-mono">{fmtInt(row.quantity)}</Td>
              <Td className="text-left">{row.unit}</Td>
              <Td className="text-left text-muted-foreground">{row.scale}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {isMobile && (
        <div className="space-y-2 p-3">
          {data.map((row: any, i: number) => (
            <div key={row.id || i} className="border rounded-lg p-3 space-y-1" data-testid={`card-quantity-${i}`}>
              <p className="font-medium text-sm">{row.description}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Qty: <span className="font-mono text-foreground">{fmtInt(row.quantity)} {row.unit}</span></span>
                <span className="text-muted-foreground">Scale: {row.scale}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TakeoffSummaryReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-takeoff-summary">
        <ReportHeader>
          <Th className="text-left">Type</Th>
          <Th className="text-right">Total Quantity</Th>
          <Th className="text-left">Unit</Th>
          <Th className="text-right">Measurement Count</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.type || i} className="hover:bg-muted/30" data-testid={`row-summary-${i}`}>
              <Td className="text-left"><Badge variant="outline">{row.type}</Badge></Td>
              <Td className="text-right font-mono font-medium">{fmtInt(row.totalQuantity)}</Td>
              <Td className="text-left">{row.unit}</Td>
              <Td className="text-right">{row.measurementCount}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {isMobile && (
        <div className="space-y-2 p-3">
          {data.map((row: any, i: number) => (
            <div key={row.type || i} className="border rounded-lg p-3" data-testid={`card-summary-${i}`}>
              <div className="flex items-center justify-between mb-1">
                <Badge variant="outline">{row.type}</Badge>
                <span className="text-xs text-muted-foreground">{row.measurementCount} measurements</span>
              </div>
              <p className="font-mono font-semibold text-lg">{fmtInt(row.totalQuantity)} <span className="text-sm font-normal text-muted-foreground">{row.unit}</span></p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MeasurementsByTakeoffReport({ data, expanded, isMobile }: { data: any[]; expanded: boolean; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const [openSheets, setOpenSheets] = useState<Set<string>>(expanded ? new Set(data.map((g: any) => g.sheetName)) : new Set());

  const toggleSheet = (name: string) => {
    setOpenSheets(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className={isMobile ? "p-3 space-y-2" : ""}>
      {!isMobile && (
        <table className="w-full text-sm" data-testid="table-measurements-by-takeoff">
          <ReportHeader>
            <Th className="text-left">Takeoff Sheet</Th>
            <Th className="text-left">Description</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-left">Unit</Th>
          </ReportHeader>
          <tbody>
            {data.map((group: any) => (
              <Fragment key={group.sheetName}>
                <tr
                  className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                  onClick={() => toggleSheet(group.sheetName)}
                  data-testid={`row-sheet-group-${group.sheetName}`}
                >
                  <Td className="text-left font-semibold" colSpan={4}>
                    <span className="flex items-center gap-2">
                      {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {group.sheetName}
                      <Badge variant="secondary" className="text-xs">{group.measurements.length}</Badge>
                    </span>
                  </Td>
                </tr>
                {(openSheets.has(group.sheetName) || expanded) && group.measurements.map((m: any, j: number) => (
                  <tr key={m.id || j} className="hover:bg-muted/20">
                    <Td className="text-left pl-10 text-muted-foreground">{group.sheetName}</Td>
                    <Td className="text-left">{m.description}</Td>
                    <Td className="text-right font-mono">{fmtInt(m.quantity)}</Td>
                    <Td className="text-left">{m.unit}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {isMobile && data.map((group: any) => (
        <div key={group.sheetName} className="border rounded-lg overflow-hidden" data-testid={`card-sheet-group-${group.sheetName}`}>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40"
            onClick={() => toggleSheet(group.sheetName)}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {group.sheetName}
            </span>
            <Badge variant="secondary" className="text-xs">{group.measurements.length}</Badge>
          </button>
          {(openSheets.has(group.sheetName) || expanded) && (
            <div className="divide-y">
              {group.measurements.map((m: any, j: number) => (
                <div key={m.id || j} className="px-3 py-2 flex items-center justify-between">
                  <span className="text-sm truncate mr-2">{m.description}</span>
                  <span className="text-xs font-mono flex-shrink-0">{fmtInt(m.quantity)} {m.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemListReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-item-list">
        <ReportHeader>
          <Th className="text-left">Description</Th>
          <Th className="text-left">Type</Th>
          <Th className="text-left">Unit</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={i} className="hover:bg-muted/30" data-testid={`row-item-${i}`}>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-left"><Badge variant="outline">{row.type}</Badge></Td>
              <Td className="text-left">{row.unit}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {isMobile && (
        <div className="space-y-2 p-3">
          {data.map((row: any, i: number) => (
            <div key={i} className="border rounded-lg p-3 flex items-center justify-between" data-testid={`card-item-${i}`}>
              <span className="text-sm font-medium truncate mr-2">{row.description}</span>
              <div className="flex gap-1.5 flex-shrink-0">
                <Badge variant="outline" className="text-xs">{row.type}</Badge>
                <Badge variant="secondary" className="text-xs">{row.unit}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ItemCostReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const grandTotal = data.reduce((s: number, r: any) => s + (r.totalCost || 0), 0);
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-item-cost">
        <ReportHeader>
          <Th className="text-left">Description</Th>
          <Th className="text-right">Quantity</Th>
          <Th className="text-right">Unit Cost</Th>
          <Th className="text-right">Total Cost</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id || i} className="hover:bg-muted/30" data-testid={`row-cost-${i}`}>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-right font-mono">{fmtInt(row.quantity)} {row.unit}</Td>
              <Td className="text-right font-mono">${fmt(row.unitCost)}</Td>
              <Td className="text-right font-mono font-medium">${fmt(row.totalCost)}</Td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <Td className="text-left" colSpan={3}>Grand Total</Td>
            <Td className="text-right font-mono">${fmt(grandTotal)}</Td>
          </tr>
        </tbody>
      </table>
      {isMobile && (
        <div className="p-3 space-y-2">
          {data.map((row: any, i: number) => (
            <div key={row.id || i} className="border rounded-lg p-3 space-y-1" data-testid={`card-cost-${i}`}>
              <p className="font-medium text-sm">{row.description}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Qty</span>
                  <p className="font-mono">{fmtInt(row.quantity)} {row.unit}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Unit Cost</span>
                  <p className="font-mono">${fmt(row.unitCost)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Total</span>
                  <p className="font-mono font-semibold">${fmt(row.totalCost)}</p>
                </div>
              </div>
            </div>
          ))}
          <div className="border-t pt-2 flex items-center justify-between text-sm font-semibold">
            <span>Grand Total</span>
            <span className="font-mono">${fmt(grandTotal)}</span>
          </div>
        </div>
      )}
    </>
  );
}

function ItemCostByTypeReport({ data, expanded, isMobile }: { data: any[]; expanded: boolean; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const [openTypes, setOpenTypes] = useState<Set<string>>(expanded ? new Set(data.map((g: any) => g.type)) : new Set());

  const toggleType = (t: string) => {
    setOpenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  return (
    <div className={isMobile ? "p-3 space-y-2" : ""}>
      {!isMobile && (
        <table className="w-full text-sm" data-testid="table-item-cost-by-type">
          <ReportHeader>
            <Th className="text-left">Type</Th>
            <Th className="text-left">Description</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Unit Cost</Th>
            <Th className="text-right">Total Cost</Th>
          </ReportHeader>
          <tbody>
            {data.map((group: any) => (
              <Fragment key={group.type}>
                <tr
                  className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                  onClick={() => toggleType(group.type)}
                  data-testid={`row-type-group-${group.type}`}
                >
                  <Td className="text-left font-semibold" colSpan={4}>
                    <span className="flex items-center gap-2">
                      {openTypes.has(group.type) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Badge variant="outline">{group.type}</Badge>
                      <span className="text-xs text-muted-foreground">({group.items.length} items)</span>
                    </span>
                  </Td>
                  <Td className="text-right font-mono font-semibold">${fmt(group.subtotal)}</Td>
                </tr>
                {(openTypes.has(group.type) || expanded) && group.items.map((item: any, j: number) => (
                  <tr key={item.id || j} className="hover:bg-muted/20">
                    <Td className="text-left pl-10 text-muted-foreground">{group.type}</Td>
                    <Td className="text-left">{item.description}</Td>
                    <Td className="text-right font-mono">{fmtInt(item.quantity)} {item.unit}</Td>
                    <Td className="text-right font-mono">${fmt(item.unitCost)}</Td>
                    <Td className="text-right font-mono">${fmt(item.totalCost)}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {isMobile && data.map((group: any) => (
        <div key={group.type} className="border rounded-lg overflow-hidden" data-testid={`card-type-group-${group.type}`}>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40"
            onClick={() => toggleType(group.type)}
          >
            <span className="flex items-center gap-2 text-sm">
              {openTypes.has(group.type) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Badge variant="outline">{group.type}</Badge>
              <span className="text-xs text-muted-foreground">({group.items.length})</span>
            </span>
            <span className="text-sm font-mono font-semibold">${fmt(group.subtotal)}</span>
          </button>
          {(openTypes.has(group.type) || expanded) && (
            <div className="divide-y">
              {group.items.map((item: any, j: number) => (
                <div key={item.id || j} className="px-3 py-2 space-y-1">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{fmtInt(item.quantity)} {item.unit} × ${fmt(item.unitCost)}</span>
                    <span className="font-mono font-medium text-foreground">${fmt(item.totalCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemCostByTakeoffReport({ data, expanded, isMobile }: { data: any[]; expanded: boolean; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const [openSheets, setOpenSheets] = useState<Set<string>>(expanded ? new Set(data.map((g: any) => g.sheetName)) : new Set());

  const toggleSheet = (name: string) => {
    setOpenSheets(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className={isMobile ? "p-3 space-y-2" : ""}>
      {!isMobile && (
        <table className="w-full text-sm" data-testid="table-item-cost-by-takeoff">
          <ReportHeader>
            <Th className="text-left">Takeoff Sheet</Th>
            <Th className="text-left">Description</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Unit Cost</Th>
            <Th className="text-right">Total Cost</Th>
          </ReportHeader>
          <tbody>
            {data.map((group: any) => (
              <Fragment key={group.sheetName}>
                <tr
                  className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                  onClick={() => toggleSheet(group.sheetName)}
                  data-testid={`row-takeoff-group-${group.sheetName}`}
                >
                  <Td className="text-left font-semibold" colSpan={4}>
                    <span className="flex items-center gap-2">
                      {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {group.sheetName}
                      <Badge variant="secondary" className="text-xs">{group.items.length}</Badge>
                    </span>
                  </Td>
                  <Td className="text-right font-mono font-semibold">${fmt(group.subtotal)}</Td>
                </tr>
                {(openSheets.has(group.sheetName) || expanded) && group.items.map((item: any, j: number) => (
                  <tr key={item.id || j} className="hover:bg-muted/20">
                    <Td className="text-left pl-10 text-muted-foreground">{group.sheetName}</Td>
                    <Td className="text-left">{item.description}</Td>
                    <Td className="text-right font-mono">{fmtInt(item.quantity)} {item.unit}</Td>
                    <Td className="text-right font-mono">${fmt(item.unitCost)}</Td>
                    <Td className="text-right font-mono">${fmt(item.totalCost)}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {isMobile && data.map((group: any) => (
        <div key={group.sheetName} className="border rounded-lg overflow-hidden" data-testid={`card-takeoff-group-${group.sheetName}`}>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40"
            onClick={() => toggleSheet(group.sheetName)}
          >
            <span className="flex items-center gap-2 text-sm">
              {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="font-semibold truncate">{group.sheetName}</span>
              <Badge variant="secondary" className="text-xs">{group.items.length}</Badge>
            </span>
            <span className="text-sm font-mono font-semibold flex-shrink-0">${fmt(group.subtotal)}</span>
          </button>
          {(openSheets.has(group.sheetName) || expanded) && (
            <div className="divide-y">
              {group.items.map((item: any, j: number) => (
                <div key={item.id || j} className="px-3 py-2 space-y-1">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{fmtInt(item.quantity)} {item.unit} × ${fmt(item.unitCost)}</span>
                    <span className="font-mono font-medium text-foreground">${fmt(item.totalCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EstimateSummaryReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState message="No estimate data. Select a project with estimates using Data Filters." />;
  const totals = data.reduce((acc: any, r: any) => ({
    material: acc.material + (r.materialCost || 0),
    labor: acc.labor + (r.laborCost || 0),
    equipment: acc.equipment + (r.equipmentCost || 0),
    total: acc.total + (r.totalCost || 0),
  }), { material: 0, labor: 0, equipment: 0, total: 0 });

  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-estimate-summary">
        <ReportHeader>
          <Th className="text-left">Category</Th>
          <Th className="text-left">Description</Th>
          <Th className="text-right">Qty</Th>
          <Th className="text-left">Unit</Th>
          <Th className="text-right">Material</Th>
          <Th className="text-right">Labor</Th>
          <Th className="text-right">Equipment</Th>
          <Th className="text-right">Total Cost</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id || i} className="hover:bg-muted/30" data-testid={`row-estimate-${i}`}>
              <Td className="text-left"><Badge variant="outline" className="text-xs">{row.category}</Badge></Td>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-right font-mono">{fmtInt(row.quantity)}</Td>
              <Td className="text-left">{row.unit}</Td>
              <Td className="text-right font-mono">${fmt(row.materialCost)}</Td>
              <Td className="text-right font-mono">${fmt(row.laborCost)}</Td>
              <Td className="text-right font-mono">${fmt(row.equipmentCost)}</Td>
              <Td className="text-right font-mono font-medium">${fmt(row.totalCost)}</Td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <Td className="text-left" colSpan={4}>Totals</Td>
            <Td className="text-right font-mono">${fmt(totals.material)}</Td>
            <Td className="text-right font-mono">${fmt(totals.labor)}</Td>
            <Td className="text-right font-mono">${fmt(totals.equipment)}</Td>
            <Td className="text-right font-mono">${fmt(totals.total)}</Td>
          </tr>
        </tbody>
      </table>
      {isMobile && (
        <div className="p-3 space-y-2">
          {data.map((row: any, i: number) => (
            <div key={row.id || i} className="border rounded-lg p-3 space-y-2" data-testid={`card-estimate-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{row.description}</p>
                  <Badge variant="outline" className="text-xs mt-0.5">{row.category}</Badge>
                </div>
                <p className="font-mono font-semibold text-sm flex-shrink-0">${fmt(row.totalCost)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty</span>
                  <span className="font-mono">{fmtInt(row.quantity)} {row.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Material</span>
                  <span className="font-mono">${fmt(row.materialCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labor</span>
                  <span className="font-mono">${fmt(row.laborCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Equipment</span>
                  <span className="font-mono">${fmt(row.equipmentCost)}</span>
                </div>
              </div>
            </div>
          ))}
          <div className="border-t pt-3 space-y-1 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Grand Total</span>
              <span className="font-mono">${fmt(totals.total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div className="text-center">
                <p className="font-mono text-foreground">${fmt(totals.material)}</p>
                <p>Material</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-foreground">${fmt(totals.labor)}</p>
                <p>Labor</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-foreground">${fmt(totals.equipment)}</p>
                <p>Equipment</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CostBreakdownReport({ data, isMobile }: { data: any; isMobile: boolean }) {
  const categories = data?.categories || [];
  const grandTotal = data?.grandTotal || 0;
  if (categories.length === 0) return <EmptyState message="No estimate data. Select a project with estimates using Data Filters." />;

  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-cost-breakdown">
        <ReportHeader>
          <Th className="text-left">Category</Th>
          <Th className="text-right">Subtotal</Th>
          <Th className="text-right">% of Total</Th>
        </ReportHeader>
        <tbody>
          {categories.map((row: any, i: number) => (
            <tr key={row.category || i} className="hover:bg-muted/30" data-testid={`row-breakdown-${i}`}>
              <Td className="text-left font-medium">{row.category}</Td>
              <Td className="text-right font-mono">${fmt(row.subtotal)}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-16 bg-muted rounded-full h-2 overflow-hidden">
                    <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                  </div>
                  <span className="font-mono text-xs w-12 text-right">{row.percentage}%</span>
                </div>
              </Td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <Td className="text-left">Grand Total</Td>
            <Td className="text-right font-mono">${fmt(grandTotal)}</Td>
            <Td className="text-right font-mono">100%</Td>
          </tr>
        </tbody>
      </table>
      {isMobile && (
        <div className="p-3 space-y-2">
          {categories.map((row: any, i: number) => (
            <div key={row.category || i} className="border rounded-lg p-3" data-testid={`card-breakdown-${i}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{row.category}</span>
                <span className="font-mono font-semibold text-sm">${fmt(row.subtotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                </div>
                <span className="text-xs font-mono w-12 text-right">{row.percentage}%</span>
              </div>
            </div>
          ))}
          <div className="border-t pt-2 flex items-center justify-between text-sm font-semibold">
            <span>Grand Total</span>
            <span className="font-mono">${fmt(grandTotal)}</span>
          </div>
        </div>
      )}
    </>
  );
}

function generateCSV(reportId: ReportId, data: any): string {
  if (!data) return "";

  const escape = (v: any) => {
    const str = String(v ?? "");
    return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const toCSV = (headers: string[], rows: any[][]) => {
    return [headers.join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  };

  switch (reportId) {
    case "takeoff-quantity":
      return toCSV(
        ["Description", "Quantity", "Unit", "Scale"],
        (data as any[]).map(r => [r.description, r.quantity, r.unit, r.scale])
      );
    case "takeoff-summary":
      return toCSV(
        ["Type", "Total Quantity", "Unit", "Measurement Count"],
        (data as any[]).map(r => [r.type, r.totalQuantity, r.unit, r.measurementCount])
      );
    case "measurements-by-takeoff":
      return toCSV(
        ["Sheet Name", "Description", "Quantity", "Unit"],
        (data as any[]).flatMap(g => g.measurements.map((m: any) => [g.sheetName, m.description, m.quantity, m.unit]))
      );
    case "item-list":
      return toCSV(
        ["Description", "Type", "Unit"],
        (data as any[]).map(r => [r.description, r.type, r.unit])
      );
    case "item-cost":
      return toCSV(
        ["Description", "Quantity", "Unit", "Unit Cost", "Total Cost"],
        (data as any[]).map(r => [r.description, r.quantity, r.unit, r.unitCost, r.totalCost])
      );
    case "item-cost-by-type":
      return toCSV(
        ["Type", "Description", "Quantity", "Unit", "Unit Cost", "Total Cost"],
        (data as any[]).flatMap(g => g.items.map((item: any) => [g.type, item.description, item.quantity, item.unit, item.unitCost, item.totalCost]))
      );
    case "item-cost-by-takeoff":
      return toCSV(
        ["Sheet Name", "Description", "Quantity", "Unit", "Unit Cost", "Total Cost"],
        (data as any[]).flatMap(g => g.items.map((item: any) => [g.sheetName, item.description, item.quantity, item.unit, item.unitCost, item.totalCost]))
      );
    case "estimate-summary":
      return toCSV(
        ["Category", "Description", "Quantity", "Unit", "Material Cost", "Labor Cost", "Equipment Cost", "Total Cost"],
        (data as any[]).map(r => [r.category, r.description, r.quantity, r.unit, r.materialCost, r.laborCost, r.equipmentCost, r.totalCost])
      );
    case "cost-breakdown": {
      const cats = data?.categories || [];
      return toCSV(
        ["Category", "Subtotal", "Percentage"],
        cats.map((r: any) => [r.category, r.subtotal, `${r.percentage}%`])
      );
    }
    default:
      return "";
  }
}
