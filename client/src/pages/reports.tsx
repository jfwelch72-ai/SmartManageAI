import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  FileSpreadsheet,
  ChevronDown,
  Ruler,
  DollarSign,
} from "lucide-react";
import {
  TAKEOFF_REPORTS,
  ESTIMATE_REPORTS,
  type ReportId,
  getReportLabel,
  getReportEndpoint,
  EmptyState,
} from "@/components/reports/report-utils";
import { ReportExportBar } from "@/components/reports/ReportExportBar";
import { TakeoffQuantityReport, TakeoffSummaryReport, MeasurementsByTakeoffReport, ItemListReport } from "@/components/reports/TakeoffReports";
import { ItemCostReport, ItemCostByTypeReport, ItemCostByTakeoffReport } from "@/components/reports/CostReports";
import { EstimateSummaryReport, CostBreakdownReport } from "@/components/reports/EstimateReports";

interface ReportsPageProps {
  embeddedProjectId?: string;
}

export default function ReportsPage({ embeddedProjectId }: ReportsPageProps = {}) {
  const isMobile = useIsMobile();
  const [selectedReport, setSelectedReport] = useState<ReportId>("takeoff-quantity");
  const [takeoffOpen, setTakeoffOpen] = useState(true);
  const [estimateOpen, setEstimateOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>(embeddedProjectId || "all");
  const isEmbedded = !!embeddedProjectId;

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

            <ReportExportBar
              selectedReport={selectedReport}
              reportData={reportData}
              expanded={expanded}
              setExpanded={setExpanded}
              projectFilter={projectFilter}
              setProjectFilter={setProjectFilter}
              projects={projects}
              isEmbedded={isEmbedded}
              isMobile={isMobile}
            />
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
