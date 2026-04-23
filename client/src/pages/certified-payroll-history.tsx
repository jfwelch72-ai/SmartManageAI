import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, ArchiveRestore, Download, FileSpreadsheet, FileText, History, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

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
  archivedAt: string | null;
  archivedById: string | null;
  archiveReason: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface AuditHistoryEntry {
  id: string;
  action: string;
  createdAt: string;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  reason: string | null;
}

const ALL = "__all__";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Task #1116: weekly digest emails deep-link here with `?startDate=...&endDate=...`
// (and optionally `projectId` / `variant`) so payroll admins land on the
// pre-filtered view that matches the digest they just opened.
function readInitialFilters(): { projectId: string; variant: string; startDate: string; endDate: string } {
  if (typeof window === "undefined") return { projectId: ALL, variant: ALL, startDate: "", endDate: "" };
  const params = new URLSearchParams(window.location.search);
  const isIsoDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    projectId: params.get("projectId") || ALL,
    variant: params.get("variant") || ALL,
    startDate: isIsoDate(params.get("startDate")) ? params.get("startDate")! : "",
    endDate: isIsoDate(params.get("endDate")) ? params.get("endDate")! : "",
  };
}

export default function CertifiedPayrollHistoryPage() {
  const { toast } = useToast();
  const initial = useMemo(readInitialFilters, []);
  const [projectId, setProjectId] = useState<string>(initial.projectId);
  const [variant, setVariant] = useState<string>(initial.variant);
  const [startDate, setStartDate] = useState<string>(initial.startDate);
  const [endDate, setEndDate] = useState<string>(initial.endDate);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState<CertifiedPayrollReportRow | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<CertifiedPayrollReportRow | null>(null);
  const [historyDialog, setHistoryDialog] = useState<CertifiedPayrollReportRow | null>(null);
  const [reasonText, setReasonText] = useState("");

  // Task #1179: load the per-report archive/restore/delete timeline only when the
  // operator opens the inline history panel.
  const { data: historyData, isLoading: historyLoading } = useQuery<{
    reportExists: boolean;
    entries: AuditHistoryEntry[];
  }>({
    queryKey: ["/api/payroll/certified-reports", historyDialog?.id, "audit-history"],
    enabled: !!historyDialog,
  });

  const { permissionRole } = useAuth();
  const isAdmin = permissionRole === "ADMIN" || permissionRole === "SUPER_ADMIN";

  const filterParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (projectId !== ALL) p.projectId = projectId;
    if (variant !== ALL) p.variant = variant;
    if (startDate) p.startDate = startDate;
    if (endDate) p.endDate = endDate;
    if (showArchived) p.includeArchived = "true";
    return p;
  }, [projectId, variant, startDate, endDate, showArchived]);

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

  const archiveMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await apiRequest("POST", `/api/payroll/certified-reports/${id}/archive`, { reason });
    },
    onSuccess: () => {
      toast({ title: "Report archived" });
      setArchiveDialog(null);
      setReasonText("");
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/certified-reports"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Archive failed",
        description: err instanceof Error ? err.message : "Could not archive report",
        variant: "destructive",
      });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/payroll/certified-reports/${id}/unarchive`);
    },
    onSuccess: () => {
      toast({ title: "Report restored" });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/certified-reports"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Restore failed",
        description: err instanceof Error ? err.message : "Could not restore report",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await apiRequest("DELETE", `/api/payroll/certified-reports/${id}`, { reason });
    },
    onSuccess: () => {
      toast({ title: "Report deleted", description: "PDF removed from object storage." });
      setDeleteDialog(null);
      setReasonText("");
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/certified-reports"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Could not delete report",
        variant: "destructive",
      });
    },
  });

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
              {isAdmin && (
                <div className="flex items-center gap-2 pr-2">
                  <Switch
                    id="toggle-show-archived"
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                    data-testid="switch-show-archived"
                  />
                  <Label htmlFor="toggle-show-archived" className="text-sm whitespace-nowrap">
                    Show archived
                  </Label>
                </div>
              )}
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
                      <TableRow
                        key={r.id}
                        data-testid={`row-certified-report-${r.id}`}
                        className={r.archivedAt ? "opacity-60" : undefined}
                      >
                        <TableCell data-testid={`text-generated-at-${r.id}`}>
                          <div className="flex items-center gap-2">
                            {format(new Date(r.generatedAt), "MMM d, yyyy h:mm a")}
                            {r.archivedAt && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                data-testid={`badge-archived-${r.id}`}
                                title={r.archiveReason || "Archived"}
                              >
                                Archived
                              </Badge>
                            )}
                          </div>
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
                          <div className="flex items-center justify-end gap-2">
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
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setHistoryDialog(r)}
                                data-testid={`button-history-${r.id}`}
                                title="View archive/delete history"
                              >
                                <History className="h-4 w-4" />
                              </Button>
                            )}
                            {isAdmin && !r.archivedAt && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setReasonText("");
                                  setArchiveDialog(r);
                                }}
                                data-testid={`button-archive-${r.id}`}
                                title="Archive (soft-hide)"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                            {isAdmin && r.archivedAt && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => unarchiveMutation.mutate(r.id)}
                                disabled={unarchiveMutation.isPending}
                                data-testid={`button-unarchive-${r.id}`}
                                title="Restore"
                              >
                                <ArchiveRestore className="h-4 w-4" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setReasonText("");
                                  setDeleteDialog(r);
                                }}
                                data-testid={`button-delete-${r.id}`}
                                title="Permanently delete (also removes the PDF)"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
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

      <Dialog
        open={!!archiveDialog}
        onOpenChange={(open) => {
          if (!open) {
            setArchiveDialog(null);
            setReasonText("");
          }
        }}
      >
        <DialogContent data-testid="dialog-archive-report">
          <DialogHeader>
            <DialogTitle>Archive certified payroll report</DialogTitle>
            <DialogDescription>
              The report will be hidden from the default list but the underlying PDF stays in
              storage so you can still download or restore it later. The reason is recorded in
              the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="archive-reason">Reason</Label>
            <Textarea
              id="archive-reason"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="e.g. wrong form variant, regenerated with corrected fringes"
              rows={3}
              data-testid="textarea-archive-reason"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setArchiveDialog(null);
                setReasonText("");
              }}
              data-testid="button-archive-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                archiveDialog &&
                archiveMutation.mutate({ id: archiveDialog.id, reason: reasonText.trim() })
              }
              disabled={reasonText.trim().length < 3 || archiveMutation.isPending}
              data-testid="button-archive-confirm"
            >
              {archiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
              <span className="ml-2">Archive</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialog(null);
            setReasonText("");
          }
        }}
      >
        <DialogContent data-testid="dialog-delete-report">
          <DialogHeader>
            <DialogTitle>Permanently delete certified payroll report</DialogTitle>
            <DialogDescription>
              This deletes the row and the PDF in object storage. It cannot be undone. The
              report ID, pay run, and your reason are recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="delete-reason">Reason</Label>
            <Textarea
              id="delete-reason"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="e.g. test data, draft pay run, mistakenly generated"
              rows={3}
              data-testid="textarea-delete-reason"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialog(null);
                setReasonText("");
              }}
              data-testid="button-delete-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteDialog &&
                deleteMutation.mutate({ id: deleteDialog.id, reason: reasonText.trim() })
              }
              disabled={reasonText.trim().length < 3 || deleteMutation.isPending}
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="ml-2">Delete permanently</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!historyDialog}
        onOpenChange={(open) => {
          if (!open) setHistoryDialog(null);
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="dialog-report-history">
          <DialogHeader>
            <DialogTitle>Archive &amp; delete history</DialogTitle>
            <DialogDescription>
              Every archive, restore, and delete action recorded against this certified payroll
              report — newest first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {historyLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !historyData || historyData.entries.length === 0 ? (
              <div
                className="text-center py-8 text-muted-foreground text-sm"
                data-testid="text-empty-report-history"
              >
                No archive, restore, or delete actions have been recorded for this report yet.
              </div>
            ) : (
              <ul className="space-y-3">
                {historyData.entries.map((entry) => {
                  const variant: "default" | "secondary" | "destructive" | "outline" =
                    entry.action === "DELETE"
                      ? "destructive"
                      : entry.action === "ARCHIVE"
                        ? "secondary"
                        : "outline";
                  return (
                    <li
                      key={entry.id}
                      className="border rounded-md p-3 space-y-1"
                      data-testid={`row-history-entry-${entry.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={variant} data-testid={`badge-history-action-${entry.id}`}>
                          {entry.action}
                        </Badge>
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid={`text-history-time-${entry.id}`}
                        >
                          {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      <div className="text-sm" data-testid={`text-history-actor-${entry.id}`}>
                        <span className="font-medium">{entry.actorName}</span>
                        {entry.actorEmail && entry.actorEmail !== entry.actorName && (
                          <span className="text-muted-foreground"> ({entry.actorEmail})</span>
                        )}
                      </div>
                      {entry.reason && (
                        <div
                          className="text-sm text-muted-foreground"
                          data-testid={`text-history-reason-${entry.id}`}
                        >
                          “{entry.reason}”
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setHistoryDialog(null)}
              data-testid="button-history-close"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
