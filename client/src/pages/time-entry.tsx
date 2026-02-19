import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { useAuth } from "@/hooks/use-auth";
import {
  useProjects,
  useTimeEntries,
  useCreateTimeEntry,
  useApproveTimeEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
  useRejectTimeEntry,
  useBulkApproveTimeEntries,
} from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Clock,
  CheckCircle,
  XCircle,
  Search,
  X,
  Download,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Plus,
  Timer,
  AlertTriangle,
} from "lucide-react";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  subDays,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
  parseISO,
} from "date-fns";

const DATE_FILTERS = [
  { value: "ALL", label: "All Time" },
  { value: "TODAY", label: "Today" },
  { value: "THIS_WEEK", label: "This Week" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "LAST_7_DAYS", label: "Last 7 Days" },
  { value: "LAST_30_DAYS", label: "Last 30 Days" },
];

const STATUS_FILTERS = [
  { value: "ALL", label: "All Status" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const MANAGER_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT"];

export default function TimeEntryPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const isManager = MANAGER_ROLES.includes(user?.role || "");

  const [activeTab, setActiveTab] = useState("entries");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");

  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [editEntry, setEditEntry] = useState<any>(null);
  const [editDate, setEditDate] = useState("");
  const [editRegular, setEditRegular] = useState("");
  const [editOvertime, setEditOvertime] = useState("");
  const [editCostCode, setEditCostCode] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  const [rejectEntryId, setRejectEntryId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [weekOffset, setWeekOffset] = useState(0);

  const [newProjectId, setNewProjectId] = useState("");
  const [newDate, setNewDate] = useState<Date | undefined>(new Date());
  const [newRegular, setNewRegular] = useState("");
  const [newOvertime, setNewOvertime] = useState("");
  const [newCostCode, setNewCostCode] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: timeEntriesResponse, isLoading: entriesLoading } = useTimeEntries();
  const timeEntries = timeEntriesResponse?.data || [];

  const createEntry = useCreateTimeEntry();
  const approveEntry = useApproveTimeEntry();
  const updateEntry = useUpdateTimeEntry();
  const deleteEntry = useDeleteTimeEntry();
  const rejectEntry = useRejectTimeEntry();
  const bulkApprove = useBulkApproveTimeEntries();

  const filteredTimeEntries = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const searchLower = searchTerm.toLowerCase();

    return timeEntries.filter((entry) => {
      const project = projects.find((p) => p.id === entry.projectId);

      const projectName = (project?.name ?? "").toLowerCase();
      const projectCode = (project?.code ?? "").toLowerCase();
      const costCode = (entry.costCode ?? "").toLowerCase();
      const notes = (entry.notes ?? "").toLowerCase();

      const matchesSearch =
        projectName.includes(searchLower) ||
        projectCode.includes(searchLower) ||
        costCode.includes(searchLower) ||
        notes.includes(searchLower);

      if (searchTerm && !matchesSearch) return false;

      const entryDate = new Date(entry.date);
      if (dateFilter === "TODAY" && entryDate < todayStart) return false;
      if (dateFilter === "THIS_WEEK" && entryDate < weekStart) return false;
      if (dateFilter === "THIS_MONTH" && entryDate < monthStart) return false;
      if (dateFilter === "LAST_7_DAYS" && entryDate < subDays(now, 7)) return false;
      if (dateFilter === "LAST_30_DAYS" && entryDate < subDays(now, 30)) return false;

      if (statusFilter !== "ALL" && entry.approvalStatus !== statusFilter) return false;

      if (projectFilter !== "ALL" && entry.projectId !== projectFilter) return false;

      return true;
    });
  }, [timeEntries, projects, searchTerm, dateFilter, statusFilter, projectFilter]);

  const hasActiveFilters = searchTerm || dateFilter !== "ALL" || statusFilter !== "ALL" || projectFilter !== "ALL";

  const weekStats = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);

    let totalRegular = 0;
    let totalOvertime = 0;
    let pendingCount = 0;
    let approvedCount = 0;

    timeEntries.forEach((entry) => {
      const entryDate = new Date(entry.date);
      if (entryDate >= weekStart && entryDate <= weekEnd) {
        totalRegular += parseFloat(entry.hoursRegular) || 0;
        totalOvertime += parseFloat(entry.hoursOvertime) || 0;
      }
      if (entry.approvalStatus === "PENDING") pendingCount++;
      if (entry.approvalStatus === "APPROVED") approvedCount++;
    });

    return {
      totalHours: (totalRegular + totalOvertime).toFixed(1),
      pendingCount,
      approvedCount,
      overtimeHours: totalOvertime.toFixed(1),
    };
  }, [timeEntries]);

  const weeklySummary = useMemo(() => {
    const baseDate = weekOffset === 0 ? new Date() : addWeeks(new Date(), weekOffset);
    const weekStart = startOfWeek(baseDate);
    const weekEnd = endOfWeek(baseDate);
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

    const dayData = days.map((day) => {
      let regular = 0;
      let overtime = 0;

      timeEntries.forEach((entry) => {
        const entryDate = new Date(entry.date);
        if (isSameDay(entryDate, day)) {
          regular += parseFloat(entry.hoursRegular) || 0;
          overtime += parseFloat(entry.hoursOvertime) || 0;
        }
      });

      return { date: day, regular, overtime, total: regular + overtime };
    });

    return { weekStart, weekEnd, days: dayData };
  }, [timeEntries, weekOffset]);

  const clearAllFilters = () => {
    setSearchTerm("");
    setDateFilter("ALL");
    setStatusFilter("ALL");
    setProjectFilter("ALL");
  };

  const handleApprove = async (entryId: string) => {
    try {
      await approveEntry.mutateAsync(entryId);
      toast({ title: "Success", description: "Time entry approved" });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to approve", variant: "destructive" });
    }
  };

  const handleReject = async () => {
    if (!rejectEntryId || !rejectReason.trim()) return;
    try {
      await rejectEntry.mutateAsync({ entryId: rejectEntryId, reason: rejectReason });
      toast({ title: "Success", description: "Time entry rejected" });
      setRejectEntryId(null);
      setRejectReason("");
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to reject", variant: "destructive" });
    }
  };

  const handleBulkApprove = async () => {
    if (selectedEntries.length === 0) return;
    try {
      await bulkApprove.mutateAsync(selectedEntries);
      toast({ title: "Success", description: `${selectedEntries.length} entries approved` });
      setSelectedEntries([]);
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to bulk approve", variant: "destructive" });
    }
  };

  const openEditDialog = (entry: any) => {
    setEditEntry(entry);
    setEditDate(format(new Date(entry.date), "yyyy-MM-dd"));
    setEditRegular(entry.hoursRegular);
    setEditOvertime(entry.hoursOvertime);
    setEditCostCode(entry.costCode || "");
    setEditNotes(entry.notes || "");
  };

  const handleUpdate = async () => {
    if (!editEntry) return;
    try {
      await updateEntry.mutateAsync({
        id: editEntry.id,
        date: editDate,
        hoursRegular: editRegular,
        hoursOvertime: editOvertime,
        costCode: editCostCode,
        notes: editNotes,
      });
      toast({ title: "Success", description: "Time entry updated" });
      setEditEntry(null);
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to update", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteEntryId) return;
    try {
      await deleteEntry.mutateAsync(deleteEntryId);
      toast({ title: "Success", description: "Time entry deleted" });
      setDeleteEntryId(null);
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to delete", variant: "destructive" });
    }
  };

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectId || !newDate) return;
    try {
      await createEntry.mutateAsync({
        projectId: newProjectId,
        date: newDate,
        hoursRegular: newRegular || "0",
        hoursOvertime: newOvertime || "0",
        costCode: newCostCode,
        notes: newNotes || "",
      });
      toast({ title: "Success", description: "Time entry submitted" });
      setNewRegular("");
      setNewOvertime("");
      setNewCostCode("");
      setNewNotes("");
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to submit", variant: "destructive" });
    }
  };

  const handleExport = () => {
    const params: Record<string, string> = {};
    const now = new Date();

    if (dateFilter === "TODAY") {
      const todayStr = format(now, "yyyy-MM-dd");
      params.startDate = todayStr;
      params.endDate = todayStr;
    } else if (dateFilter === "THIS_WEEK") {
      params.startDate = format(startOfWeek(now), "yyyy-MM-dd");
      params.endDate = format(endOfWeek(now), "yyyy-MM-dd");
    } else if (dateFilter === "THIS_MONTH") {
      params.startDate = format(startOfMonth(now), "yyyy-MM-dd");
      params.endDate = format(now, "yyyy-MM-dd");
    } else if (dateFilter === "LAST_7_DAYS") {
      params.startDate = format(subDays(now, 7), "yyyy-MM-dd");
      params.endDate = format(now, "yyyy-MM-dd");
    } else if (dateFilter === "LAST_30_DAYS") {
      params.startDate = format(subDays(now, 30), "yyyy-MM-dd");
      params.endDate = format(now, "yyyy-MM-dd");
    }

    if (projectFilter !== "ALL") params.projectId = projectFilter;
    if (statusFilter !== "ALL") params.status = statusFilter;

    const exportUrl = "/api/time-entries/export?" + new URLSearchParams(params).toString();
    window.open(exportUrl, "_blank");
  };

  const toggleSelectEntry = (id: string) => {
    setSelectedEntries((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const pendingIds = filteredTimeEntries
      .filter((e) => e.approvalStatus === "PENDING")
      .map((e) => e.id);
    if (selectedEntries.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedEntries([]);
    } else {
      setSelectedEntries(pendingIds);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return (
          <Badge variant="default" data-testid="badge-status-approved">
            <CheckCircle className="w-3 h-3 mr-1" />
            Approved
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="destructive" data-testid="badge-status-rejected">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" data-testid="badge-status-pending">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-page-title">
            {isManager ? "Time Entry Management" : "My Time Entries"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "Review, approve, and manage employee time entries"
              : "Log and track your daily hours worked on projects"}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Hours (This Week)</CardTitle>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-hours">{weekStats.totalHours}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Entries</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-pending-count">{weekStats.pendingCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Approved Entries</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-approved-count">{weekStats.approvedCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overtime Hours (This Week)</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-overtime-hours">{weekStats.overtimeHours}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="entries" data-testid="tab-entries">
              {isManager ? "All Entries" : "My Entries"}
            </TabsTrigger>
            <TabsTrigger value="weekly" data-testid="tab-weekly">
              Weekly Summary
            </TabsTrigger>
            <TabsTrigger value="add" data-testid="tab-add">
              <Plus className="w-4 h-4 mr-1" />
              Add Entry
            </TabsTrigger>
          </TabsList>

          <TabsContent value="entries">
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle>{isManager ? "All Time Entries" : "My Time Entries"}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {isManager && selectedEntries.length > 0 && (
                      <Button
                        size="sm"
                        onClick={handleBulkApprove}
                        disabled={bulkApprove.isPending}
                        data-testid="button-bulk-approve"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Approve ({selectedEntries.length})
                      </Button>
                    )}
                    {isManager && (
                      <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export-csv">
                        <Download className="w-4 h-4 mr-1" />
                        Export CSV
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search project, cost code, notes..."
                      className="pl-9"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      data-testid="input-search-time-entries"
                    />
                  </div>

                  <Select value={dateFilter} onValueChange={setDateFilter}>
                    <SelectTrigger className="w-[150px]" data-testid="select-date-filter">
                      <SelectValue placeholder="Date Range" />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FILTERS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={projectFilter} onValueChange={setProjectFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-project-filter">
                      <SelectValue placeholder="Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Projects</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-all-filters">
                      <X className="w-4 h-4 mr-1" />
                      Clear filters
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {entriesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : filteredTimeEntries.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {hasActiveFilters ? "No time entries match your filters" : "No time entries found"}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {isManager && (
                            <TableHead className="w-[40px]">
                              <Checkbox
                                checked={
                                  selectedEntries.length > 0 &&
                                  selectedEntries.length ===
                                    filteredTimeEntries.filter((e) => e.approvalStatus === "PENDING").length
                                }
                                onCheckedChange={toggleSelectAll}
                                data-testid="checkbox-select-all"
                              />
                            </TableHead>
                          )}
                          <TableHead>Date</TableHead>
                          {isManager && <TableHead>Employee</TableHead>}
                          <TableHead>Project</TableHead>
                          <TableHead className="text-right">Regular Hrs</TableHead>
                          <TableHead className="text-right">OT Hrs</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Cost Code</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTimeEntries.map((entry) => {
                          const project = projects.find((p) => p.id === entry.projectId);
                          const regular = parseFloat(entry.hoursRegular) || 0;
                          const overtime = parseFloat(entry.hoursOvertime) || 0;
                          const total = regular + overtime;

                          return (
                            <TableRow key={entry.id} data-testid={`time-entry-row-${entry.id}`}>
                              {isManager && (
                                <TableCell>
                                  {entry.approvalStatus === "PENDING" && (
                                    <Checkbox
                                      checked={selectedEntries.includes(entry.id)}
                                      onCheckedChange={() => toggleSelectEntry(entry.id)}
                                      data-testid={`checkbox-entry-${entry.id}`}
                                    />
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="font-medium" data-testid={`text-date-${entry.id}`}>
                                {format(new Date(entry.date), "MMM d, yyyy")}
                              </TableCell>
                              {isManager && (
                                <TableCell data-testid={`text-employee-${entry.id}`}>
                                  {entry.userId}
                                </TableCell>
                              )}
                              <TableCell data-testid={`text-project-${entry.id}`}>
                                {project ? `${project.code} - ${project.name}` : "—"}
                              </TableCell>
                              <TableCell className="text-right font-mono" data-testid={`text-regular-${entry.id}`}>
                                {regular.toFixed(1)}
                              </TableCell>
                              <TableCell className="text-right font-mono" data-testid={`text-overtime-${entry.id}`}>
                                {overtime.toFixed(1)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium" data-testid={`text-total-${entry.id}`}>
                                {total.toFixed(1)}
                              </TableCell>
                              <TableCell data-testid={`text-cost-code-${entry.id}`}>
                                {entry.costCode || "—"}
                              </TableCell>
                              <TableCell>{getStatusBadge(entry.approvalStatus)}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  {isManager && entry.approvalStatus === "PENDING" && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleApprove(entry.id)}
                                        disabled={approveEntry.isPending}
                                        data-testid={`button-approve-${entry.id}`}
                                      >
                                        <CheckCircle className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setRejectEntryId(entry.id)}
                                        data-testid={`button-reject-${entry.id}`}
                                      >
                                        <XCircle className="w-4 h-4" />
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openEditDialog(entry)}
                                    data-testid={`button-edit-${entry.id}`}
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setDeleteEntryId(entry.id)}
                                    data-testid={`button-delete-${entry.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
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
          </TabsContent>

          <TabsContent value="weekly">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle>Weekly Summary</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWeekOffset((w) => w - 1)}
                      data-testid="button-prev-week"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium min-w-[180px] text-center" data-testid="text-week-range">
                      {format(weeklySummary.weekStart, "MMM d")} - {format(weeklySummary.weekEnd, "MMM d, yyyy")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWeekOffset((w) => w + 1)}
                      data-testid="button-next-week"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    {weekOffset !== 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setWeekOffset(0)}
                        data-testid="button-current-week"
                      >
                        Today
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        {weeklySummary.days.map((d) => (
                          <TableHead key={d.date.toISOString()} className="text-center min-w-[80px]">
                            <div>{format(d.date, "EEE")}</div>
                            <div className="text-xs text-muted-foreground">{format(d.date, "MMM d")}</div>
                          </TableHead>
                        ))}
                        <TableHead className="text-center font-bold">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Regular</TableCell>
                        {weeklySummary.days.map((d) => (
                          <TableCell key={d.date.toISOString()} className="text-center font-mono">
                            {d.regular > 0 ? d.regular.toFixed(1) : "—"}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-mono font-bold" data-testid="text-weekly-total-regular">
                          {weeklySummary.days.reduce((sum, d) => sum + d.regular, 0).toFixed(1)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Overtime</TableCell>
                        {weeklySummary.days.map((d) => (
                          <TableCell key={d.date.toISOString()} className="text-center font-mono">
                            {d.overtime > 0 ? d.overtime.toFixed(1) : "—"}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-mono font-bold" data-testid="text-weekly-total-overtime">
                          {weeklySummary.days.reduce((sum, d) => sum + d.overtime, 0).toFixed(1)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold">Total</TableCell>
                        {weeklySummary.days.map((d) => (
                          <TableCell key={d.date.toISOString()} className="text-center font-mono font-bold">
                            {d.total > 0 ? d.total.toFixed(1) : "—"}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-mono font-bold" data-testid="text-weekly-grand-total">
                          {weeklySummary.days.reduce((sum, d) => sum + d.total, 0).toFixed(1)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="add">
            <Card>
              <CardHeader>
                <CardTitle>Add Time Entry</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateEntry} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-project">Project</Label>
                      <Select value={newProjectId} onValueChange={setNewProjectId}>
                        <SelectTrigger id="new-project" data-testid="select-new-project">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.code} - {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            type="button"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !newDate && "text-muted-foreground"
                            )}
                            data-testid="button-new-date"
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {newDate ? format(newDate, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarPicker
                            mode="single"
                            selected={newDate}
                            onSelect={(d) => setNewDate(d || undefined)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-regular">Regular Hours</Label>
                      <Input
                        id="new-regular"
                        type="number"
                        step="0.25"
                        min="0"
                        max="24"
                        placeholder="8.0"
                        value={newRegular}
                        onChange={(e) => setNewRegular(e.target.value)}
                        data-testid="input-new-regular-hours"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-overtime">Overtime Hours</Label>
                      <Input
                        id="new-overtime"
                        type="number"
                        step="0.25"
                        min="0"
                        max="24"
                        placeholder="0.0"
                        value={newOvertime}
                        onChange={(e) => setNewOvertime(e.target.value)}
                        data-testid="input-new-overtime-hours"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="new-cost-code">Cost Code</Label>
                      <Input
                        id="new-cost-code"
                        placeholder="e.g., 03-300 - Concrete"
                        value={newCostCode}
                        onChange={(e) => setNewCostCode(e.target.value)}
                        data-testid="input-new-cost-code"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="new-notes">Notes (Optional)</Label>
                      <Textarea
                        id="new-notes"
                        placeholder="Add any additional notes..."
                        value={newNotes}
                        onChange={(e) => setNewNotes(e.target.value)}
                        data-testid="textarea-new-notes"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createEntry.isPending || !newProjectId}
                    data-testid="button-submit-new-entry"
                  >
                    {createEntry.isPending ? "Submitting..." : "Submit Time Entry"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Time Entry</DialogTitle>
              <DialogDescription>Update the time entry details below.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-date">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  data-testid="input-edit-date"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-regular">Regular Hours</Label>
                  <Input
                    id="edit-regular"
                    type="number"
                    step="0.25"
                    min="0"
                    max="24"
                    value={editRegular}
                    onChange={(e) => setEditRegular(e.target.value)}
                    data-testid="input-edit-regular"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-overtime">Overtime Hours</Label>
                  <Input
                    id="edit-overtime"
                    type="number"
                    step="0.25"
                    min="0"
                    max="24"
                    value={editOvertime}
                    onChange={(e) => setEditOvertime(e.target.value)}
                    data-testid="input-edit-overtime"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cost-code">Cost Code</Label>
                <Input
                  id="edit-cost-code"
                  value={editCostCode}
                  onChange={(e) => setEditCostCode(e.target.value)}
                  data-testid="input-edit-cost-code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  data-testid="textarea-edit-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditEntry(null)} data-testid="button-edit-cancel">
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={updateEntry.isPending} data-testid="button-edit-save">
                {updateEntry.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Time Entry</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this time entry? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteEntryId(null)} data-testid="button-delete-cancel">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteEntry.isPending}
                data-testid="button-delete-confirm"
              >
                {deleteEntry.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!rejectEntryId} onOpenChange={(open) => !open && setRejectEntryId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Time Entry</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this time entry.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="reject-reason">Reason</Label>
              <Textarea
                id="reject-reason"
                placeholder="Enter rejection reason..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                data-testid="textarea-reject-reason"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRejectEntryId(null);
                  setRejectReason("");
                }}
                data-testid="button-reject-cancel"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={rejectEntry.isPending || !rejectReason.trim()}
                data-testid="button-reject-confirm"
              >
                {rejectEntry.isPending ? "Rejecting..." : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
