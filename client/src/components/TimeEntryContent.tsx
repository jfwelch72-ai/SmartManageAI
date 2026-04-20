import { useState, useMemo, useRef } from "react";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useGlobalSearchFocus } from "@/hooks/use-global-search-focus";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  CheckCircle,
  Search,
  X,
  Download,
  Plus,
} from "lucide-react";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  subDays,
  addWeeks,
  eachDayOfInterval,
  isSameDay,
} from "date-fns";
import { TimeEntryStatsCards } from "@/components/time-entry/TimeEntryStatsCards";
import { TimeEntryListContent } from "@/components/time-entry/TimeEntryListContent";
import { TimeEntryWeeklySummary } from "@/components/time-entry/TimeEntryWeeklySummary";
import { TimeEntryAddForm } from "@/components/time-entry/TimeEntryAddForm";
import { EditTimeEntryDialog, DeleteTimeEntryDialog, RejectTimeEntryDialog } from "@/components/time-entry/TimeEntryDialogs";

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

export default function TimeEntryContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = MANAGER_ROLES.includes(user?.role || "");

  const [activeTab, setActiveTab] = useState("entries");
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
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
      const matchesSearch = projectName.includes(searchLower) || projectCode.includes(searchLower) || costCode.includes(searchLower) || notes.includes(searchLower);
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
    let totalRegular = 0, totalOvertime = 0, pendingCount = 0, approvedCount = 0;
    timeEntries.forEach((entry) => {
      const entryDate = new Date(entry.date);
      if (entryDate >= weekStart && entryDate <= weekEnd) {
        totalRegular += parseFloat(entry.hoursRegular) || 0;
        totalOvertime += parseFloat(entry.hoursOvertime) || 0;
      }
      if (entry.approvalStatus === "PENDING") pendingCount++;
      if (entry.approvalStatus === "APPROVED") approvedCount++;
    });
    return { totalHours: (totalRegular + totalOvertime).toFixed(1), pendingCount, approvedCount, overtimeHours: totalOvertime.toFixed(1) };
  }, [timeEntries]);

  const weeklySummary = useMemo(() => {
    const baseDate = weekOffset === 0 ? new Date() : addWeeks(new Date(), weekOffset);
    const weekStart = startOfWeek(baseDate);
    const weekEnd = endOfWeek(baseDate);
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
    const dayData = days.map((day) => {
      let regular = 0, overtime = 0;
      timeEntries.forEach((entry) => {
        if (isSameDay(new Date(entry.date), day)) {
          regular += parseFloat(entry.hoursRegular) || 0;
          overtime += parseFloat(entry.hoursOvertime) || 0;
        }
      });
      return { date: day, regular, overtime, total: regular + overtime };
    });
    return { weekStart, weekEnd, days: dayData };
  }, [timeEntries, weekOffset]);

  const clearAllFilters = () => { setSearchTerm(""); setDateFilter("ALL"); setStatusFilter("ALL"); setProjectFilter("ALL"); };

  const handleApprove = async (entryId: string) => {
    try { await approveEntry.mutateAsync(entryId); toast({ title: "Success", description: "Time entry approved" }); }
    catch (error: any) { toast({ title: "Error", description: error?.message || "Failed to approve", variant: "destructive" }); }
  };

  const handleReject = async () => {
    if (!rejectEntryId || !rejectReason.trim()) return;
    try { await rejectEntry.mutateAsync({ entryId: rejectEntryId, reason: rejectReason }); toast({ title: "Success", description: "Time entry rejected" }); setRejectEntryId(null); setRejectReason(""); }
    catch (error: any) { toast({ title: "Error", description: error?.message || "Failed to reject", variant: "destructive" }); }
  };

  const handleBulkApprove = async () => {
    if (selectedEntries.length === 0) return;
    try { await bulkApprove.mutateAsync(selectedEntries); toast({ title: "Success", description: `${selectedEntries.length} entries approved` }); setSelectedEntries([]); }
    catch (error: any) { toast({ title: "Error", description: error?.message || "Failed to bulk approve", variant: "destructive" }); }
  };

  const openEditDialog = (entry: any) => {
    setEditEntry(entry);
    setEditDate(format(new Date(entry.date), "yyyy-MM-dd"));
    setEditRegular(entry.hoursRegular);
    setEditOvertime(entry.hoursOvertime);
    setEditCostCode(entry.costCode || "");
    setEditNotes(entry.notes || "");
  };

  const isEntriesTab = activeTab === "entries";
  const { getRowProps: getEntryRowProps } = useTableKeyboardNav({
    rowCount: isEntriesTab ? filteredTimeEntries.length : 0,
    onActivate: (idx) => {
      if (!isEntriesTab) return;
      const entry = filteredTimeEntries[idx];
      if (entry) openEditDialog(entry);
    },
  });
  useGlobalSearchFocus(searchInputRef, isEntriesTab);
  useRegisterShortcuts("time-entries", TABLE_NAV_SHORTCUTS, isEntriesTab);

  const handleUpdate = async () => {
    if (!editEntry) return;
    try { await updateEntry.mutateAsync({ id: editEntry.id, date: editDate, hoursRegular: editRegular, hoursOvertime: editOvertime, costCode: editCostCode, notes: editNotes }); toast({ title: "Success", description: "Time entry updated" }); setEditEntry(null); }
    catch (error: any) { toast({ title: "Error", description: error?.message || "Failed to update", variant: "destructive" }); }
  };

  const handleDelete = async () => {
    if (!deleteEntryId) return;
    try { await deleteEntry.mutateAsync(deleteEntryId); toast({ title: "Success", description: "Time entry deleted" }); setDeleteEntryId(null); }
    catch (error: any) { toast({ title: "Error", description: error?.message || "Failed to delete", variant: "destructive" }); }
  };

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectId || !newDate) return;
    try { await createEntry.mutateAsync({ projectId: newProjectId, date: newDate, hoursRegular: newRegular || "0", hoursOvertime: newOvertime || "0", costCode: newCostCode, notes: newNotes || "" }); toast({ title: "Success", description: "Time entry submitted" }); setNewRegular(""); setNewOvertime(""); setNewCostCode(""); setNewNotes(""); }
    catch (error: any) { toast({ title: "Error", description: error?.message || "Failed to submit", variant: "destructive" }); }
  };

  const handleExport = () => {
    const params: Record<string, string> = {};
    const now = new Date();
    if (dateFilter === "TODAY") { const todayStr = format(now, "yyyy-MM-dd"); params.startDate = todayStr; params.endDate = todayStr; }
    else if (dateFilter === "THIS_WEEK") { params.startDate = format(startOfWeek(now), "yyyy-MM-dd"); params.endDate = format(endOfWeek(now), "yyyy-MM-dd"); }
    else if (dateFilter === "THIS_MONTH") { params.startDate = format(startOfMonth(now), "yyyy-MM-dd"); params.endDate = format(now, "yyyy-MM-dd"); }
    else if (dateFilter === "LAST_7_DAYS") { params.startDate = format(subDays(now, 7), "yyyy-MM-dd"); params.endDate = format(now, "yyyy-MM-dd"); }
    else if (dateFilter === "LAST_30_DAYS") { params.startDate = format(subDays(now, 30), "yyyy-MM-dd"); params.endDate = format(now, "yyyy-MM-dd"); }
    if (projectFilter !== "ALL") params.projectId = projectFilter;
    if (statusFilter !== "ALL") params.status = statusFilter;
    const exportUrl = "/api/time-entries/export?" + new URLSearchParams(params).toString();
    fetch(exportUrl, { credentials: "include" })
      .then(async (res) => { if (!res.ok) { const err = await res.json().catch(() => ({ error: "Export failed" })); throw new Error(err.error || "Export failed"); } return res.blob(); })
      .then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `time-entries-${format(new Date(), "yyyy-MM-dd")}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); toast({ title: "Export Complete", description: "CSV file downloaded successfully" }); })
      .catch((err) => { toast({ title: "Export Failed", description: err.message, variant: "destructive" }); });
  };

  const toggleSelectEntry = (id: string) => { setSelectedEntries((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]); };
  const toggleSelectAll = () => {
    const pendingIds = filteredTimeEntries.filter((e) => e.approvalStatus === "PENDING").map((e) => e.id);
    if (selectedEntries.length === pendingIds.length && pendingIds.length > 0) { setSelectedEntries([]); } else { setSelectedEntries(pendingIds); }
  };
  const toggleExpanded = (entryId: string) => { setExpandedEntries((prev) => { const next = new Set(prev); if (next.has(entryId)) { next.delete(entryId); } else { next.add(entryId); } return next; }); };

  return (
    <div className="space-y-6">
      <TimeEntryStatsCards weekStats={weekStats} />

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
                    <Button size="sm" onClick={handleBulkApprove} disabled={bulkApprove.isPending} data-testid="button-bulk-approve">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Batch Approve Selected ({selectedEntries.length})
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
                  <Input ref={searchInputRef} placeholder="Search project, cost code, notes..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="input-search-time-entries" />
                </div>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-date-filter"><SelectValue placeholder="Date Range" /></SelectTrigger>
                  <SelectContent>{DATE_FILTERS.map((f) => (<SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>{STATUS_FILTERS.map((f) => (<SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-project-filter"><SelectValue placeholder="Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Projects</SelectItem>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>))}
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
            <TimeEntryListContent
              filteredTimeEntries={filteredTimeEntries}
              projects={projects}
              isManager={isManager}
              selectedEntries={selectedEntries}
              expandedEntries={expandedEntries}
              entriesLoading={entriesLoading}
              hasActiveFilters={hasActiveFilters}
              approveEntry={approveEntry}
              toggleSelectEntry={toggleSelectEntry}
              toggleSelectAll={toggleSelectAll}
              toggleExpanded={toggleExpanded}
              handleApprove={handleApprove}
              setRejectEntryId={setRejectEntryId}
              openEditDialog={openEditDialog}
              setDeleteEntryId={setDeleteEntryId}
              getRowProps={getEntryRowProps}
            />
          </Card>
        </TabsContent>

        <TabsContent value="weekly">
          <TimeEntryWeeklySummary weeklySummary={weeklySummary} weekOffset={weekOffset} setWeekOffset={setWeekOffset} />
        </TabsContent>

        <TabsContent value="add">
          <TimeEntryAddForm
            projects={projects}
            newProjectId={newProjectId}
            setNewProjectId={setNewProjectId}
            newDate={newDate}
            setNewDate={setNewDate}
            newRegular={newRegular}
            setNewRegular={setNewRegular}
            newOvertime={newOvertime}
            setNewOvertime={setNewOvertime}
            newCostCode={newCostCode}
            setNewCostCode={setNewCostCode}
            newNotes={newNotes}
            setNewNotes={setNewNotes}
            handleCreateEntry={handleCreateEntry}
            createEntryPending={createEntry.isPending}
          />
        </TabsContent>
      </Tabs>

      <EditTimeEntryDialog
        editEntry={editEntry}
        setEditEntry={setEditEntry}
        editDate={editDate}
        setEditDate={setEditDate}
        editRegular={editRegular}
        setEditRegular={setEditRegular}
        editOvertime={editOvertime}
        setEditOvertime={setEditOvertime}
        editCostCode={editCostCode}
        setEditCostCode={setEditCostCode}
        editNotes={editNotes}
        setEditNotes={setEditNotes}
        handleUpdate={handleUpdate}
        updatePending={updateEntry.isPending}
      />

      <DeleteTimeEntryDialog
        deleteEntryId={deleteEntryId}
        setDeleteEntryId={setDeleteEntryId}
        handleDelete={handleDelete}
        deletePending={deleteEntry.isPending}
      />

      <RejectTimeEntryDialog
        rejectEntryId={rejectEntryId}
        setRejectEntryId={setRejectEntryId}
        rejectReason={rejectReason}
        setRejectReason={setRejectReason}
        handleReject={handleReject}
        rejectPending={rejectEntry.isPending}
      />
    </div>
  );
}
