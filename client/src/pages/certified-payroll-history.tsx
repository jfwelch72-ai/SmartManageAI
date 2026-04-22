import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CertifiedPayrollReportRow {
  id: string;
  payRunId: string;
  projectId: string | null;
  projectName: string | null;
  variant: string;
  objectKey: string;
  fileSize: number;
  generatedAt: string;
  generatedById: string;
  generatedByFirstName: string | null;
  generatedByLastName: string | null;
  generatedByEmail: string | null;
  payRunNumber: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

const ALL = "__all__";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CertifiedPayrollHistoryPage() {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string>(ALL);
  const [variant, setVariant] = useState<string>(ALL);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filterParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (projectId !== ALL) p.projectId = projectId;
    if (variant !== ALL) p.variant = variant;
    if (startDate) p.startDate = startDate;
    if (endDate) p.endDate = endDate;
    return p;
  }, [projectId, variant, startDate, endDate]);

  const { data: reports, isLoading } = useQuery<CertifiedPayrollReportRow[]>({
    queryKey: ["/api/payroll/certified-reports", filterParams],
  });

  const { data: projectList } = useQuery<unknown, Error, ProjectOption[]>({
    queryKey: ["/api/projects"],
    select: (rows) => {
      if (!Array.isArray(rows)) return [];
      const out: ProjectOption[] = [];
      for (const r of rows as Array<{ id?: unknown; name?: unknown }>) {
        if (typeof r?.id === "string" && typeof r?.name === "string") {
          out.push({ id: r.id, name: r.name });
        }
      }
      return out;
    },
  });

  const variantOptions = useMemo(() => {
    const set = new Set<string>();
    (reports || []).forEach((r) => set.add(r.variant));
    return Array.from(set).sort();
  }, [reports]);

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const res = await apiRequest("GET", `/api/payroll/certified-reports/${id}/download-url`);
      const body = (await res.json()) as { url: string };
      if (!body?.url) throw new Error("No download URL returned");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Could not get download link",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ ...filterParams, format: "csv" });
      const res = await fetch(`/api/payroll/certified-reports?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `certified-payroll-history-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export CSV",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleResetFilters = () => {
    setProjectId(ALL);
    setVariant(ALL);
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <title>Certified Payroll History | SmartManageAI</title>
      <meta
        name="description"
        content="Org-wide audit log of every certified payroll PDF generated across all projects."
      />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight" data-testid="heading-certified-history">
          Certified Payroll History
        </h1>
        <p className="text-muted-foreground">
          Audit every certified payroll PDF generated across all projects in your organization.
          State and federal compliance teams frequently request these for prevailing-wage audits.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Narrow the archive by project, form variant, or date range.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="filter-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="filter-project" data-testid="select-filter-project">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All projects</SelectItem>
                  {(projectList || []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-variant">Form variant</Label>
              <Select value={variant} onValueChange={setVariant}>
                <SelectTrigger id="filter-variant" data-testid="select-filter-variant">
                  <SelectValue placeholder="All variants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All variants</SelectItem>
                  {variantOptions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-start">Start date</Label>
              <Input
                id="filter-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-filter-start-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-end">End date</Label>
              <Input
                id="filter-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-filter-end-date"
              />
            </div>

            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                onClick={handleResetFilters}
                data-testid="button-reset-filters"
              >
                Reset
              </Button>
              <Button
                onClick={handleExportCsv}
                disabled={exporting || !reports || reports.length === 0}
                data-testid="button-export-csv"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                <span className="ml-2">Export CSV</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Reports
            {reports && (
              <Badge variant="secondary" data-testid="badge-result-count">
                {reports.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Signed download links are valid for 5 minutes. Each report is an immutable PDF
            generated at the timestamp shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !reports || reports.length === 0 ? (
            <div
              className="text-center py-12 text-muted-foreground"
              data-testid="text-empty-history"
            >
              No certified payroll reports match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-certified-payroll-history">
                <TableHeader>
                  <TableRow>
                    <TableHead>Generated</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Pay Period</TableHead>
                    <TableHead>Pay Run</TableHead>
                    <TableHead>Form</TableHead>
                    <TableHead>Generated By</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => {
                    const generatedBy =
                      [r.generatedByFirstName, r.generatedByLastName].filter(Boolean).join(" ") ||
                      r.generatedByEmail ||
                      "Unknown";
                    return (
                      <TableRow key={r.id} data-testid={`row-certified-report-${r.id}`}>
                        <TableCell data-testid={`text-generated-at-${r.id}`}>
                          {format(new Date(r.generatedAt), "MMM d, yyyy h:mm a")}
                        </TableCell>
                        <TableCell data-testid={`text-project-${r.id}`}>
                          {r.projectName || (
                            <span className="text-muted-foreground italic">All projects</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.payPeriodStart && r.payPeriodEnd
                            ? `${r.payPeriodStart} – ${r.payPeriodEnd}`
                            : "—"}
                        </TableCell>
                        <TableCell>{r.payRunNumber || r.payRunId.slice(0, 8)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" data-testid={`badge-variant-${r.id}`}>
                            {r.variant}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-generated-by-${r.id}`}>{generatedBy}</TableCell>
                        <TableCell className="text-right">{formatBytes(r.fileSize)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(r.id)}
                            disabled={downloadingId === r.id}
                            data-testid={`button-download-${r.id}`}
                          >
                            {downloadingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            <span className="ml-2">Download</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
