import { useState, useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import TimeEntryForm from "@/components/TimeEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useProjects, useTimeEntries, useCreateTimeEntry, useApproveTimeEntry } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Clock, Search, X, Filter } from "lucide-react";
import { format, startOfWeek, startOfMonth, isWithinInterval, subDays } from "date-fns";

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
];

export default function TimeEntryPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  
  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: timeEntriesResponse, isLoading: entriesLoading } = useTimeEntries();
  const timeEntries = timeEntriesResponse?.data || [];
  const createEntry = useCreateTimeEntry();
  const approveEntry = useApproveTimeEntry();

  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";

  // Filtering logic
  const filteredTimeEntries = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const searchLower = searchTerm.toLowerCase();
    
    return timeEntries.filter(entry => {
      const project = projects.find(p => p.id === entry.projectId);
      
      // Search filter - safely handle optional fields
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
      
      // Date filter
      const entryDate = new Date(entry.date);
      if (dateFilter === "TODAY" && entryDate < todayStart) return false;
      if (dateFilter === "THIS_WEEK" && entryDate < weekStart) return false;
      if (dateFilter === "THIS_MONTH" && entryDate < monthStart) return false;
      if (dateFilter === "LAST_7_DAYS" && entryDate < subDays(now, 7)) return false;
      if (dateFilter === "LAST_30_DAYS" && entryDate < subDays(now, 30)) return false;
      
      // Status filter
      const isApproved = !!entry.approvedAt;
      if (statusFilter === "PENDING" && isApproved) return false;
      if (statusFilter === "APPROVED" && !isApproved) return false;
      
      return true;
    });
  }, [timeEntries, projects, searchTerm, dateFilter, statusFilter]);

  const hasActiveFilters = searchTerm || dateFilter !== "ALL" || statusFilter !== "ALL";

  const handleSubmit = async (entry: {
    projectId: string;
    date: string;
    regularHours: number;
    overtimeHours: number;
    costCode: string;
    notes: string;
  }) => {
    try {
      await createEntry.mutateAsync({
        projectId: entry.projectId,
        date: new Date(entry.date),
        hoursRegular: entry.regularHours.toString(),
        hoursOvertime: entry.overtimeHours.toString(),
        costCode: entry.costCode,
        notes: entry.notes || "",
      });
      toast({
        title: "Success",
        description: "Time entry submitted successfully",
      });
    } catch (error: any) {
      console.error("Time entry submission error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to submit time entry",
        variant: "destructive",
      });
    }
  };

  const handleApprove = async (entryId: string) => {
    try {
      await approveEntry.mutateAsync(entryId);
      toast({
        title: "Success",
        description: "Time entry approved",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to approve time entry",
        variant: "destructive",
      });
    }
  };

  const projectsForForm = projects.map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
  }));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />
      
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            {canApprove ? "Time Entries" : "My Time Entries"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {canApprove 
              ? "Review and approve employee time entries"
              : "Log your daily hours worked on projects"
            }
          </p>
        </div>

        <div className="space-y-8">
          {!canApprove && (
            <TimeEntryForm
              projects={projectsForForm}
              onSubmit={handleSubmit}
            />
          )}

          <Card>
            <CardHeader className="space-y-4">
              <CardTitle>
                {canApprove ? "All Time Entries" : "Recent Entries"}
              </CardTitle>
              
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by project, cost code..."
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
                    {DATE_FILTERS.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[130px]" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Active filter badges */}
              {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Active filters:</span>
                  {searchTerm && (
                    <Badge variant="secondary" className="gap-1">
                      Search: "{searchTerm}"
                      <X 
                        className="w-3 h-3 cursor-pointer" 
                        onClick={() => setSearchTerm("")}
                        data-testid="button-clear-search"
                      />
                    </Badge>
                  )}
                  {dateFilter !== "ALL" && (
                    <Badge variant="secondary" className="gap-1">
                      {DATE_FILTERS.find(f => f.value === dateFilter)?.label}
                      <X 
                        className="w-3 h-3 cursor-pointer" 
                        onClick={() => setDateFilter("ALL")}
                        data-testid="button-clear-date-filter"
                      />
                    </Badge>
                  )}
                  {statusFilter !== "ALL" && (
                    <Badge variant="secondary" className="gap-1">
                      {statusFilter}
                      <X 
                        className="w-3 h-3 cursor-pointer" 
                        onClick={() => setStatusFilter("ALL")}
                        data-testid="button-clear-status-filter"
                      />
                    </Badge>
                  )}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setSearchTerm("");
                      setDateFilter("ALL");
                      setStatusFilter("ALL");
                    }}
                    data-testid="button-clear-all-filters"
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {entriesLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading...
                </div>
              ) : filteredTimeEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {hasActiveFilters 
                    ? "No time entries match your filters"
                    : "No time entries found"}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTimeEntries.map(entry => {
                    const project = projects.find(p => p.id === entry.projectId);
                    const isApproved = !!entry.approvedAt;
                    
                    return (
                      <div 
                        key={entry.id} 
                        className="flex items-center justify-between p-4 border rounded-md gap-4"
                        data-testid={`time-entry-${entry.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-date-${entry.id}`}>
                              {format(new Date(entry.date), "MMM d, yyyy")}
                            </span>
                            <Badge 
                              variant={isApproved ? "default" : "secondary"}
                              className="text-xs"
                              data-testid={`badge-status-${entry.id}`}
                            >
                              {isApproved ? (
                                <span className="flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  Approved
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Pending
                                </span>
                              )}
                            </Badge>
                          </div>
                          {project && (
                            <p className="text-sm text-muted-foreground mb-1" data-testid={`text-project-${entry.id}`}>
                              {project.code} - {project.name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground" data-testid={`text-cost-code-${entry.id}`}>
                            {entry.costCode}
                          </p>
                          {entry.notes && (
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              {entry.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-medium font-mono" data-testid={`text-hours-${entry.id}`}>
                              {entry.hoursRegular}h reg
                              {parseFloat(entry.hoursOvertime) > 0 && `, ${entry.hoursOvertime}h OT`}
                            </p>
                          </div>
                          {canApprove && !isApproved && (
                            <Button
                              size="sm"
                              onClick={() => handleApprove(entry.id)}
                              disabled={approveEntry.isPending}
                              data-testid={`button-approve-${entry.id}`}
                            >
                              Approve
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
