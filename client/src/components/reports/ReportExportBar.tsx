import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Printer,
  Download,
  RotateCcw,
  Filter,
  ChevronsUpDown,
  Camera,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type ReportId, getReportLabel, generateCSV } from "./report-utils";

interface ReportExportBarProps {
  selectedReport: ReportId;
  reportData: any;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  projectFilter: string;
  setProjectFilter: (v: string) => void;
  projects: any[];
  isEmbedded: boolean;
  isMobile: boolean;
}

export function ReportExportBar({
  selectedReport,
  reportData,
  expanded,
  setExpanded,
  projectFilter,
  setProjectFilter,
  projects,
  isEmbedded,
  isMobile,
}: ReportExportBarProps) {
  const { toast } = useToast();

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
    if (!isEmbedded) setProjectFilter("all");
    setExpanded(false);
  };

  return (
    <div className={`flex ${isMobile ? "flex-wrap w-full gap-2" : "items-center gap-2"} print:hidden`}>
      <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)} className={isMobile ? "flex-1" : ""} data-testid="button-expand-toggle">
        <ChevronsUpDown className="h-4 w-4 mr-1" />
        {expanded ? "Collapse" : "Expand"}
      </Button>
      {!isEmbedded && (
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
      )}
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
  );
}
