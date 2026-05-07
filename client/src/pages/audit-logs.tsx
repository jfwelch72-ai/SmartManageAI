import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Download, Search, Shield, Activity, FileText, Clock, Loader2, ChevronLeft, ChevronRight, CalendarIcon } from "lucide-react";
import { FeatureGate } from "@/components/FeatureGate";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { enqueueAndDownloadExport } from "@/lib/jobs";

interface AuditStats {
  actionStats: { action: string; count: number }[];
  entityStats: { entityType: string; count: number }[];
  last24Hours: number;
}

interface AuditLogEntry {
  id: number;
  userId: string | null;
  entityType: string | null;
  entityId: string | null;
  action: string;
  ipAddress: string | null;
  userEmail: string | null;
  userName: string | null;
  createdAt: string;
}

interface AuditSearchResponse {
  logs: AuditLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const ENTITY_TYPES = ["users", "projects", "bids", "estimates", "change_orders", "invoices", "contracts", "equipment", "tasks", "submittals"];
const ACTION_TYPES = ["CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT"];

export default function AuditLogsPage() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [entityType, setEntityType] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [appliedFilters, setAppliedFilters] = useState<{
    entityType: string;
    action: string;
    dateFrom: string;
    dateTo: string;
  }>({ entityType: "all", action: "all", dateFrom: "", dateTo: "" });

  const formatDateParam = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : "";

  const buildSearchParams = (filters: typeof appliedFilters, p: number) => {
    const params = new URLSearchParams();
    if (filters.entityType !== "all") params.set("entityType", filters.entityType);
    if (filters.action !== "all") params.set("action", filters.action);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("page", String(p));
    params.set("limit", "25");
    return params.toString();
  };

  const searchQuery = buildSearchParams(appliedFilters, page);

  const { data: stats, isLoading: statsLoading } = useQuery<AuditStats>({
    queryKey: ["/api/audit/stats"],
  });

  const { data: searchData, isLoading: searchLoading } = useQuery<AuditSearchResponse>({
    queryKey: ["/api/audit/search", searchQuery],
    queryFn: async () => {
      const res = await fetch(`/api/audit/search?${searchQuery}`);
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  const handleSearch = () => {
    setAppliedFilters({ entityType, action, dateFrom: formatDateParam(dateFrom), dateTo: formatDateParam(dateTo) });
    setPage(1);
  };

  const buildExportUrl = (format: string) => {
    const params = new URLSearchParams();
    params.set("format", format);
    if (appliedFilters.entityType !== "all") params.set("entityType", appliedFilters.entityType);
    if (appliedFilters.action !== "all") params.set("action", appliedFilters.action);
    if (appliedFilters.dateFrom) params.set("dateFrom", appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set("dateTo", appliedFilters.dateTo);
    return `/api/audit/export?${params.toString()}`;
  };

  // Task #2517 — Audit-log export now runs on the pg-boss queue.
  // Hit the GET endpoint to enqueue, poll until the worker uploads the
  // artifact to GCS, then trigger a download from the signed URL.
  const [exportingFormat, setExportingFormat] = useState<"csv" | "json" | null>(null);
  const handleExport = async (format: "csv" | "json") => {
    setExportingFormat(format);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await enqueueAndDownloadExport(buildExportUrl(format), `audit-log-${today}.${format}`);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export audit log",
        variant: "destructive",
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const totalLogs = stats?.actionStats.reduce((sum, s) => sum + s.count, 0) ?? 0;
  const pagination = searchData?.pagination;

  return (
    <FeatureGate feature="AUDIT_EXPORT">
      <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Shield className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-bold" data-testid="text-audit-logs-title">Audit Logs</h1>
          </div>
          <p className="text-muted-foreground mt-1" data-testid="text-audit-logs-subtitle">Enterprise Compliance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => handleExport("csv")}
            disabled={exportingFormat !== null}
            data-testid="button-export-csv"
          >
            {exportingFormat === "csv" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport("json")}
            disabled={exportingFormat !== null}
            data-testid="button-export-json"
          >
            {exportingFormat === "json" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Export JSON
          </Button>
        </div>
      </div>

      {statsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card data-testid="card-stat-total">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Logs</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold" data-testid="text-stat-total">{totalLogs.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-24h">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Last 24 Hours</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold" data-testid="text-stat-24h">{(stats?.last24Hours ?? 0).toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-actions">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Action Types</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {(stats?.actionStats ?? []).slice(0, 5).map((s) => (
                  <Badge key={s.action} variant="secondary" data-testid={`badge-action-stat-${s.action}`}>
                    {s.action} ({s.count})
                  </Badge>
                ))}
                {(!stats?.actionStats || stats.actionStats.length === 0) && (
                  <p className="text-sm text-muted-foreground">No data</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-entities">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Entity Types</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {(stats?.entityStats ?? []).slice(0, 5).map((s) => (
                  <Badge key={s.entityType} variant="outline" data-testid={`badge-entity-stat-${s.entityType}`}>
                    {s.entityType} ({s.count})
                  </Badge>
                ))}
                {(!stats?.entityStats || stats.entityStats.length === 0) && (
                  <p className="text-sm text-muted-foreground">No data</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-[160px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}
                    data-testid="input-date-from"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "MMM dd, yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={(d) => { setDateFrom(d); setDateFromOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-[160px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}
                    data-testid="input-date-to"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "MMM dd, yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={(d) => { setDateTo(d); setDateToOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Entity Type</label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger className="w-[160px]" data-testid="select-entity-type">
                  <SelectValue placeholder="All Entities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-[140px]" data-testid="select-action-type">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {ACTION_TYPES.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSearch} data-testid="button-search">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {searchLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !searchData?.logs?.length ? (
            <div className="py-12 text-center">
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-results">No audit logs found</p>
            </div>
          ) : (
            <>
              {isMobile ? (
                <div className="space-y-3 p-3">
                  {searchData.logs.map((entry) => (
                    <Card key={entry.id} data-testid={`row-audit-${entry.id}`}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" data-testid={`badge-action-${entry.id}`}>
                            {entry.action}
                          </Badge>
                          <span className="text-xs text-muted-foreground" data-testid={`text-timestamp-${entry.id}`}>
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm font-medium" data-testid={`text-user-${entry.id}`}>
                          {entry.userEmail || "System"}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Entity Type</p>
                            <p data-testid={`text-entity-type-${entry.id}`}>{entry.entityType || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Entity ID</p>
                            <p className="font-mono text-xs truncate" data-testid={`text-entity-id-${entry.id}`}>{entry.entityId || "—"}</p>
                          </div>
                        </div>
                        {entry.ipAddress && (
                          <p className="text-xs text-muted-foreground" data-testid={`text-ip-${entry.id}`}>
                            IP: {entry.ipAddress}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-audit-logs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Timestamp</th>
                      <th className="text-left p-3 font-medium">User</th>
                      <th className="text-left p-3 font-medium">Action</th>
                      <th className="text-left p-3 font-medium">Entity Type</th>
                      <th className="text-left p-3 font-medium">Entity ID</th>
                      <th className="text-left p-3 font-medium">IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchData.logs.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0" data-testid={`row-audit-${entry.id}`}>
                        <td className="p-3 text-muted-foreground whitespace-nowrap" data-testid={`text-timestamp-${entry.id}`}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                        <td className="p-3" data-testid={`text-user-${entry.id}`}>
                          {entry.userEmail || "System"}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" data-testid={`badge-action-${entry.id}`}>
                            {entry.action}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground" data-testid={`text-entity-type-${entry.id}`}>
                          {entry.entityType || "—"}
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground" data-testid={`text-entity-id-${entry.id}`}>
                          {entry.entityId || "—"}
                        </td>
                        <td className="p-3 text-muted-foreground" data-testid={`text-ip-${entry.id}`}>
                          {entry.ipAddress || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-t">
                  <p className="text-sm text-muted-foreground" data-testid="text-pagination-info">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total.toLocaleString()} total)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </FeatureGate>
  );
}