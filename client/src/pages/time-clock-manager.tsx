import { useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { 
  useActiveShifts, 
  usePendingShiftApprovals, 
  useApproveShift,
  useRejectShift,
  useAdjustShift,
  usePendingTimeEntryApprovals,
  useApproveTimeEntry,
  useRejectTimeEntry,
  useBulkApproveTimeEntries,
  usePendingOvertimeRequests,
  useApproveOvertimeRequest,
  useRejectOvertimeRequest,
} from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Clock, Users, CheckCircle, XCircle, Edit, MapPin, Briefcase, Search, X, FileText, DollarSign, Timer } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export default function TimeClockManagerPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("live");
  
  // Filter state
  const [activeSearchTerm, setActiveSearchTerm] = useState("");
  const [pendingSearchTerm, setPendingSearchTerm] = useState("");
  const [entrySearchTerm, setEntrySearchTerm] = useState("");
  
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [rejectEntryDialogOpen, setRejectEntryDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<any>(null);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [entryRejectReason, setEntryRejectReason] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustClockIn, setAdjustClockIn] = useState("");
  const [adjustClockOut, setAdjustClockOut] = useState("");
  const [createTimeEntry, setCreateTimeEntry] = useState(true);

  const { data: activeShifts = [], isLoading: activeLoading, refetch: refetchActive } = useActiveShifts();
  const { data: pendingShifts = [], isLoading: pendingLoading, refetch: refetchPending } = usePendingShiftApprovals();
  const { data: pendingEntries = [], isLoading: entriesLoading, refetch: refetchEntries } = usePendingTimeEntryApprovals();
  const approveShift = useApproveShift();
  const rejectShift = useRejectShift();
  const adjustShift = useAdjustShift();
  const approveTimeEntry = useApproveTimeEntry();
  const rejectTimeEntry = useRejectTimeEntry();
  const bulkApproveTimeEntries = useBulkApproveTimeEntries();
  const { data: pendingOtRequests = [], isLoading: otLoading, refetch: refetchOt } = usePendingOvertimeRequests();
  const approveOtRequest = useApproveOvertimeRequest();
  const rejectOtRequest = useRejectOvertimeRequest();
  const [otRejectDialogOpen, setOtRejectDialogOpen] = useState(false);
  const [selectedOtRequest, setSelectedOtRequest] = useState<any>(null);
  const [otRejectReason, setOtRejectReason] = useState("");
  const [otSearchTerm, setOtSearchTerm] = useState("");

  const filteredOtRequests = useMemo(() => {
    if (!otSearchTerm) return pendingOtRequests;
    const searchLower = otSearchTerm.toLowerCase();
    return pendingOtRequests.filter((req: any) => {
      const employeeName = `${req.user?.firstName ?? ""} ${req.user?.lastName ?? ""}`.toLowerCase();
      const projectName = (req.project?.name ?? "").toLowerCase();
      return employeeName.includes(searchLower) || projectName.includes(searchLower);
    });
  }, [pendingOtRequests, otSearchTerm]);

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT";

  // Filtering logic for active shifts
  const filteredActiveShifts = useMemo(() => {
    if (!activeSearchTerm) return activeShifts;
    
    const searchLower = activeSearchTerm.toLowerCase();
    return activeShifts.filter((shift: any) => {
      // Safely handle optional fields
      const employeeName = `${shift.user?.firstName ?? ""} ${shift.user?.lastName ?? ""}`.toLowerCase();
      const projectName = (shift.project?.name ?? "").toLowerCase();
      const projectCode = (shift.project?.code ?? "").toLowerCase();
      
      return (
        employeeName.includes(searchLower) ||
        projectName.includes(searchLower) ||
        projectCode.includes(searchLower)
      );
    });
  }, [activeShifts, activeSearchTerm]);

  // Filtering logic for pending shifts
  const filteredPendingShifts = useMemo(() => {
    if (!pendingSearchTerm) return pendingShifts;
    
    const searchLower = pendingSearchTerm.toLowerCase();
    return pendingShifts.filter((shift: any) => {
      const employeeName = `${shift.user?.firstName ?? ""} ${shift.user?.lastName ?? ""}`.toLowerCase();
      const projectName = (shift.project?.name ?? "").toLowerCase();
      const projectCode = (shift.project?.code ?? "").toLowerCase();
      
      return (
        employeeName.includes(searchLower) ||
        projectName.includes(searchLower) ||
        projectCode.includes(searchLower)
      );
    });
  }, [pendingShifts, pendingSearchTerm]);

  // Filtering logic for pending time entries
  const filteredPendingEntries = useMemo(() => {
    if (!entrySearchTerm) return pendingEntries;
    
    const searchLower = entrySearchTerm.toLowerCase();
    return pendingEntries.filter((entry: any) => {
      const employeeName = (entry.userName ?? "").toLowerCase();
      const projectName = (entry.projectName ?? "").toLowerCase();
      const projectCode = (entry.projectCode ?? "").toLowerCase();
      
      return (
        employeeName.includes(searchLower) ||
        projectName.includes(searchLower) ||
        projectCode.includes(searchLower)
      );
    });
  }, [pendingEntries, entrySearchTerm]);

  const getShiftDuration = (clockIn: string, clockOut?: string) => {
    const start = new Date(clockIn);
    const end = clockOut ? new Date(clockOut) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const handleApprove = async (shiftId: string, withTimeEntry: boolean = true) => {
    try {
      await approveShift.mutateAsync({ shiftId, createTimeEntry: withTimeEntry });
      toast({
        title: "Shift Approved",
        description: withTimeEntry ? "Shift approved and time entry created" : "Shift approved",
      });
      refetchPending();
    } catch (error: any) {
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve shift",
        variant: "destructive",
      });
    }
  };

  const handleReject = async () => {
    if (!selectedShift || !rejectReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for rejection",
        variant: "destructive",
      });
      return;
    }

    try {
      await rejectShift.mutateAsync({ 
        shiftId: selectedShift.id, 
        reason: rejectReason 
      });
      toast({
        title: "Shift Rejected",
        description: "Shift has been rejected",
      });
      setRejectDialogOpen(false);
      setSelectedShift(null);
      setRejectReason("");
      refetchPending();
    } catch (error: any) {
      toast({
        title: "Rejection Failed",
        description: error.message || "Failed to reject shift",
        variant: "destructive",
      });
    }
  };

  const handleAdjust = async () => {
    if (!selectedShift || !adjustReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for adjustment",
        variant: "destructive",
      });
      return;
    }

    try {
      await adjustShift.mutateAsync({
        shiftId: selectedShift.id,
        clockIn: adjustClockIn || undefined,
        clockOut: adjustClockOut || undefined,
        reason: adjustReason,
      });
      toast({
        title: "Shift Adjusted",
        description: "Shift times have been updated",
      });
      setAdjustDialogOpen(false);
      setSelectedShift(null);
      setAdjustReason("");
      setAdjustClockIn("");
      setAdjustClockOut("");
      refetchPending();
      refetchActive();
    } catch (error: any) {
      toast({
        title: "Adjustment Failed",
        description: error.message || "Failed to adjust shift",
        variant: "destructive",
      });
    }
  };

  const openAdjustDialog = (shift: any) => {
    setSelectedShift(shift);
    setAdjustClockIn(format(new Date(shift.clockIn), "yyyy-MM-dd'T'HH:mm"));
    setAdjustClockOut(shift.clockOut ? format(new Date(shift.clockOut), "yyyy-MM-dd'T'HH:mm") : "");
    setAdjustDialogOpen(true);
  };

  const openRejectDialog = (shift: any) => {
    setSelectedShift(shift);
    setRejectDialogOpen(true);
  };

  // Time entry approval handlers
  const handleApproveEntry = async (entryId: string) => {
    try {
      await approveTimeEntry.mutateAsync(entryId);
      toast({
        title: "Time Entry Approved",
        description: "Time entry has been approved for payroll",
      });
      refetchEntries();
    } catch (error: any) {
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve time entry",
        variant: "destructive",
      });
    }
  };

  const handleRejectEntry = async () => {
    if (!selectedEntry || !entryRejectReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for rejection",
        variant: "destructive",
      });
      return;
    }

    try {
      await rejectTimeEntry.mutateAsync({ 
        entryId: selectedEntry.id, 
        reason: entryRejectReason 
      });
      toast({
        title: "Time Entry Rejected",
        description: "Time entry has been rejected",
      });
      setRejectEntryDialogOpen(false);
      setSelectedEntry(null);
      setEntryRejectReason("");
      refetchEntries();
    } catch (error: any) {
      toast({
        title: "Rejection Failed",
        description: error.message || "Failed to reject time entry",
        variant: "destructive",
      });
    }
  };

  const handleBulkApprove = async () => {
    if (selectedEntryIds.length === 0) {
      toast({
        title: "No Entries Selected",
        description: "Please select at least one entry to approve",
        variant: "destructive",
      });
      return;
    }

    try {
      await bulkApproveTimeEntries.mutateAsync(selectedEntryIds);
      toast({
        title: "Entries Approved",
        description: `Successfully approved ${selectedEntryIds.length} time entries`,
      });
      setSelectedEntryIds([]);
      refetchEntries();
    } catch (error: any) {
      toast({
        title: "Bulk Approval Failed",
        description: error.message || "Failed to approve entries",
        variant: "destructive",
      });
    }
  };

  const openRejectEntryDialog = (entry: any) => {
    setSelectedEntry(entry);
    setRejectEntryDialogOpen(true);
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds(prev => 
      prev.includes(entryId) 
        ? prev.filter(id => id !== entryId) 
        : [...prev, entryId]
    );
  };

  const toggleAllEntries = () => {
    if (selectedEntryIds.length === filteredPendingEntries.length) {
      setSelectedEntryIds([]);
    } else {
      setSelectedEntryIds(filteredPendingEntries.map((e: any) => e.id));
    }
  };

  if (!isManager) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">Access Denied</p>
                <p className="text-sm mt-2">This page is only accessible to managers and administrators.</p>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">Time Clock Management</h1>
          <p className="text-sm text-muted-foreground">
            Monitor active shifts, approve time, and manage adjustments
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Shifts</p>
                  <p className="text-xl font-bold" data-testid="stat-active-shifts">{activeShifts.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-orange-500/10">
                  <Clock className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Shifts</p>
                  <p className="text-xl font-bold" data-testid="stat-pending-shifts">{pendingShifts.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <FileText className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Entries</p>
                  <p className="text-xl font-bold" data-testid="stat-pending-entries">{pendingEntries.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-green-500/10">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Pending</p>
                  <p className="text-xl font-bold" data-testid="stat-total-pending">{pendingShifts.length + pendingEntries.length + pendingOtRequests.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {isMobile ? (
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="mb-2" data-testid="select-manager-tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live Monitoring</SelectItem>
                <SelectItem value="approvals">
                  Shift Approvals{pendingShifts.length > 0 ? ` (${pendingShifts.length})` : ""}
                </SelectItem>
                <SelectItem value="time-entries">
                  Time Entry Approvals{pendingEntries.length > 0 ? ` (${pendingEntries.length})` : ""}
                </SelectItem>
                <SelectItem value="overtime">
                  OT Requests{pendingOtRequests.length > 0 ? ` (${pendingOtRequests.length})` : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <TabsList data-testid="tabs-manager">
              <TabsTrigger value="live" data-testid="tab-live">
                <Users className="w-4 h-4 mr-2" />
                Live Monitoring
              </TabsTrigger>
              <TabsTrigger value="approvals" data-testid="tab-approvals">
                <CheckCircle className="w-4 h-4 mr-2" />
                Shift Approvals
                {pendingShifts.length > 0 && (
                  <Badge variant="destructive" className="ml-2" data-testid="badge-pending-count">
                    {pendingShifts.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="time-entries" data-testid="tab-time-entries">
                <FileText className="w-4 h-4 mr-2" />
                Time Entry Approvals
                {pendingEntries.length > 0 && (
                  <Badge variant="destructive" className="ml-2" data-testid="badge-entry-count">
                    {pendingEntries.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="overtime" data-testid="tab-overtime">
                <Timer className="w-4 h-4 mr-2" />
                OT Requests
                {pendingOtRequests.length > 0 && (
                  <Badge variant="destructive" className="ml-2" data-testid="badge-ot-count">
                    {pendingOtRequests.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          )}

          {/* Live Monitoring Tab */}
          <TabsContent value="live" data-testid="content-live">
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Active Shifts
                    <Badge variant="secondary" data-testid="badge-active-count">{activeShifts.length}</Badge>
                  </CardTitle>
                  
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search employee or project..."
                        className="pl-9 w-[250px]"
                        value={activeSearchTerm}
                        onChange={(e) => setActiveSearchTerm(e.target.value)}
                        data-testid="input-search-active-shifts"
                      />
                    </div>
                    {activeSearchTerm && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setActiveSearchTerm("")}
                        data-testid="button-clear-active-search"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                
                {activeSearchTerm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Filtering:</span>
                    <Badge variant="secondary" className="gap-1">
                      "{activeSearchTerm}"
                      <X 
                        className="w-3 h-3 cursor-pointer" 
                        onClick={() => setActiveSearchTerm("")}
                      />
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      ({filteredActiveShifts.length} of {activeShifts.length} shifts)
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {activeLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading active shifts...
                  </div>
                ) : filteredActiveShifts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {activeSearchTerm ? "No shifts match your search" : "No active shifts at the moment"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredActiveShifts.map((shift: any) => (
                      <div key={shift.id} className="p-4 rounded-md border" data-testid={`row-active-${shift.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap" data-testid={`cell-employee-${shift.id}`}>
                              <span className="font-medium">
                                {shift.user?.firstName} {shift.user?.lastName}
                              </span>
                              <Badge variant="secondary" className="text-xs">{shift.user?.role}</Badge>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              <div className="flex items-center gap-1 flex-wrap" data-testid={`cell-project-${shift.id}`}>
                                <Briefcase className="w-3.5 h-3.5 shrink-0" />
                                <span>{shift.project?.name || "Unknown"}</span>
                                {shift.project?.code && (
                                  <Badge variant="outline" className="text-xs ml-1">{shift.project.code}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1" data-testid={`cell-clock-in-${shift.id}`}>
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                <span>{format(new Date(shift.clockIn), "h:mm a")}</span>
                                <span className="text-xs">({formatDistanceToNow(new Date(shift.clockIn))} ago)</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap" data-testid={`cell-location-${shift.id}`}>
                              {shift.clockInLatitude && shift.clockInLongitude ? (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span>{shift.clockInLatitude.toFixed(4)}, {shift.clockInLongitude.toFixed(4)}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">No GPS</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0" data-testid={`cell-duration-${shift.id}`}>
                            <p className="text-lg font-bold">{getShiftDuration(shift.clockIn)}</p>
                            <p className="text-xs text-muted-foreground">active</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pending Approvals Tab */}
          <TabsContent value="approvals" data-testid="content-approvals">
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Pending Approvals
                  </CardTitle>
                  
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search employee or project..."
                        className="pl-9 w-[250px]"
                        value={pendingSearchTerm}
                        onChange={(e) => setPendingSearchTerm(e.target.value)}
                        data-testid="input-search-pending-shifts"
                      />
                    </div>
                    {pendingSearchTerm && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setPendingSearchTerm("")}
                        data-testid="button-clear-pending-search"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                
                {pendingSearchTerm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Filtering:</span>
                    <Badge variant="secondary" className="gap-1">
                      "{pendingSearchTerm}"
                      <X 
                        className="w-3 h-3 cursor-pointer" 
                        onClick={() => setPendingSearchTerm("")}
                      />
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      ({filteredPendingShifts.length} of {pendingShifts.length} approvals)
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {pendingLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading pending approvals...
                  </div>
                ) : filteredPendingShifts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {pendingSearchTerm ? "No approvals match your search" : "No pending approvals"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredPendingShifts.map((shift: any) => (
                      <div key={shift.id} className="p-4 rounded-md border" data-testid={`row-pending-${shift.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap" data-testid={`cell-employee-${shift.id}`}>
                              <span className="font-medium">
                                {shift.user?.firstName} {shift.user?.lastName}
                              </span>
                              <Badge variant="secondary" className="text-xs">{shift.user?.role}</Badge>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              <div className="flex items-center gap-1 flex-wrap" data-testid={`cell-project-${shift.id}`}>
                                <Briefcase className="w-3.5 h-3.5 shrink-0" />
                                <span>{shift.project?.name || "Unknown"}</span>
                                {shift.project?.code && (
                                  <Badge variant="outline" className="text-xs ml-1">{shift.project.code}</Badge>
                                )}
                              </div>
                              <span data-testid={`cell-date-${shift.id}`}>
                                {format(new Date(shift.clockIn), "MMM d, yyyy")}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                <span data-testid={`cell-clock-in-${shift.id}`}>
                                  {format(new Date(shift.clockIn), "h:mm a")}
                                </span>
                                <span>-</span>
                                <span data-testid={`cell-clock-out-${shift.id}`}>
                                  {shift.clockOut ? format(new Date(shift.clockOut), "h:mm a") : "Now"}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap" data-testid={`cell-actions-${shift.id}`}>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleApprove(shift.id, createTimeEntry)}
                                disabled={approveShift.isPending}
                                data-testid={`button-approve-${shift.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openAdjustDialog(shift)}
                                disabled={adjustShift.isPending}
                                data-testid={`button-adjust-${shift.id}`}
                              >
                                <Edit className="w-4 h-4 mr-1" />
                                Adjust
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => openRejectDialog(shift)}
                                disabled={rejectShift.isPending}
                                data-testid={`button-reject-${shift.id}`}
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          </div>
                          <div className="text-right shrink-0" data-testid={`cell-duration-${shift.id}`}>
                            <p className="text-lg font-bold">
                              {shift.clockOut ? getShiftDuration(shift.clockIn, shift.clockOut) : "..."}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {shift.clockOut ? "total" : "in progress"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Time Entry Option */}
                {pendingShifts.length > 0 && (
                  <div className="mt-6 flex items-center gap-2 p-4 bg-accent/50 rounded-lg">
                    <Switch 
                      checked={createTimeEntry} 
                      onCheckedChange={setCreateTimeEntry}
                      data-testid="switch-create-time-entry"
                    />
                    <Label className="cursor-pointer">
                      Automatically create time entries when approving shifts
                    </Label>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Time Entry Approvals Tab */}
          <TabsContent value="time-entries" data-testid="content-time-entries">
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Time Entry Approvals
                    <Badge variant="secondary" data-testid="badge-entries-total">{pendingEntries.length}</Badge>
                  </CardTitle>
                  
                  <div className="flex items-center gap-2">
                    {selectedEntryIds.length > 0 && (
                      <Button
                        variant="default"
                        onClick={handleBulkApprove}
                        disabled={bulkApproveTimeEntries.isPending}
                        data-testid="button-bulk-approve"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Approve Selected ({selectedEntryIds.length})
                      </Button>
                    )}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search employee or project..."
                        className="pl-9 w-[250px]"
                        value={entrySearchTerm}
                        onChange={(e) => setEntrySearchTerm(e.target.value)}
                        data-testid="input-search-entries"
                      />
                    </div>
                    {entrySearchTerm && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setEntrySearchTerm("")}
                        data-testid="button-clear-entry-search"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                
                {entrySearchTerm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Filtering:</span>
                    <Badge variant="secondary" className="gap-1">
                      "{entrySearchTerm}"
                      <X 
                        className="w-3 h-3 cursor-pointer" 
                        onClick={() => setEntrySearchTerm("")}
                      />
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      ({filteredPendingEntries.length} of {pendingEntries.length} entries)
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {entriesLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading pending time entries...
                  </div>
                ) : filteredPendingEntries.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {entrySearchTerm ? "No entries match your search" : "No pending time entry approvals"}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <Checkbox
                        checked={selectedEntryIds.length === filteredPendingEntries.length && filteredPendingEntries.length > 0}
                        onCheckedChange={toggleAllEntries}
                        data-testid="checkbox-select-all"
                      />
                      <span className="text-sm text-muted-foreground">Select all</span>
                    </div>
                    <div className="space-y-3">
                    {filteredPendingEntries.map((entry: any) => (
                      <div key={entry.id} className="p-4 rounded-md border" data-testid={`row-entry-${entry.id}`}>
                        <div className="flex items-start gap-3">
                          <div className="pt-1">
                            <Checkbox
                              checked={selectedEntryIds.includes(entry.id)}
                              onCheckedChange={() => toggleEntrySelection(entry.id)}
                              data-testid={`checkbox-entry-${entry.id}`}
                            />
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-2 flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap" data-testid={`cell-entry-employee-${entry.id}`}>
                                  <span className="font-medium">{entry.userName}</span>
                                  <Badge variant="secondary" className="text-xs">{entry.userRole}</Badge>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                  <div className="flex items-center gap-1 flex-wrap" data-testid={`cell-entry-project-${entry.id}`}>
                                    <Briefcase className="w-3.5 h-3.5 shrink-0" />
                                    <span>{entry.projectName || "Unknown"}</span>
                                    {entry.projectCode && (
                                      <Badge variant="outline" className="text-xs ml-1">{entry.projectCode}</Badge>
                                    )}
                                  </div>
                                  <span data-testid={`cell-entry-date-${entry.id}`}>
                                    {format(new Date(entry.date), "MMM d, yyyy")}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap">
                                  <div className="flex items-center gap-1 text-sm" data-testid={`cell-entry-regular-${entry.id}`}>
                                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span>{entry.hoursRegular || "0"}h regular</span>
                                  </div>
                                  {entry.hoursOvertime && parseFloat(entry.hoursOvertime) > 0 && (
                                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400" data-testid={`cell-entry-overtime-${entry.id}`}>
                                      +{entry.hoursOvertime}h OT
                                    </Badge>
                                  )}
                                </div>
                                {entry.notes && (
                                  <p className="text-sm text-muted-foreground truncate max-w-[300px]" data-testid={`cell-entry-notes-${entry.id}`}>
                                    {entry.notes}
                                  </p>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-lg font-bold">
                                  {entry.hoursRegular || "0"}h
                                </p>
                                <p className="text-xs text-muted-foreground">regular</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap" data-testid={`cell-entry-actions-${entry.id}`}>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleApproveEntry(entry.id)}
                                disabled={approveTimeEntry.isPending}
                                data-testid={`button-approve-entry-${entry.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => openRejectEntryDialog(entry)}
                                disabled={rejectTimeEntry.isPending}
                                data-testid={`button-reject-entry-${entry.id}`}
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                )}

                {pendingEntries.length > 0 && (
                  <div className="mt-6 p-4 bg-accent/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      <DollarSign className="inline w-4 h-4 mr-1" />
                      Approved time entries will be forwarded to the Office Manager for payroll processing.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Overtime Requests Tab */}
          <TabsContent value="overtime" data-testid="content-overtime">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Timer className="w-5 h-5" />
                  Pending Overtime Requests ({filteredOtRequests.length})
                </CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or project..."
                    value={otSearchTerm}
                    onChange={(e) => setOtSearchTerm(e.target.value)}
                    className="pl-9"
                    data-testid="input-ot-search"
                  />
                  {otSearchTerm && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setOtSearchTerm("")}
                      data-testid="button-clear-ot-search"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {otLoading ? (
                  <div className="text-center py-8 text-muted-foreground" data-testid="ot-loading">
                    Loading overtime requests...
                  </div>
                ) : filteredOtRequests.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground" data-testid="ot-empty">
                    <Timer className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-lg font-medium">No Pending OT Requests</p>
                    <p className="text-sm">All overtime requests have been processed.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredOtRequests.map((req: any) => {
                      const shiftDate = req.shift?.clockIn ? format(new Date(req.shift.clockIn), "MMM d, yyyy") : "N/A";
                      const employeeName = req.user ? `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() : "Unknown";
                      const projectName = req.project?.name ?? "N/A";
                      const requestedAt = req.createdAt ? formatDistanceToNow(new Date(req.createdAt), { addSuffix: true }) : "N/A";

                      return (
                        <div key={req.id} className="p-4 rounded-md border" data-testid={`row-ot-${req.id}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap" data-testid={`text-ot-employee-${req.id}`}>
                                <span className="font-medium">{employeeName}</span>
                                <Badge variant="outline" className="text-xs" data-testid={`text-ot-project-${req.id}`}>{projectName}</Badge>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                <span data-testid={`text-ot-date-${req.id}`}>{shiftDate}</span>
                                <span data-testid={`text-ot-regular-${req.id}`}>8.00h regular</span>
                                <span className="text-xs" data-testid={`text-ot-requested-at-${req.id}`}>{requestedAt}</span>
                              </div>
                              {req.notes && (
                                <p className="text-sm text-muted-foreground truncate max-w-[300px]" data-testid={`text-ot-notes-${req.id}`}>
                                  {req.notes}
                                </p>
                              )}
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => {
                                    approveOtRequest.mutate(
                                      { id: req.id, approvedHours: String(req.requestedHours) },
                                      {
                                        onSuccess: () => {
                                          toast({ title: "Overtime approved" });
                                          refetchOt();
                                        },
                                        onError: (err: any) => {
                                          toast({ title: "Error", description: err.message, variant: "destructive" });
                                        },
                                      }
                                    );
                                  }}
                                  disabled={approveOtRequest.isPending}
                                  data-testid={`button-approve-ot-${req.id}`}
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    setSelectedOtRequest(req);
                                    setOtRejectReason("");
                                    setOtRejectDialogOpen(true);
                                  }}
                                  data-testid={`button-reject-ot-${req.id}`}
                                >
                                  <XCircle className="w-4 h-4 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            </div>
                            <div className="text-right shrink-0" data-testid={`text-ot-requested-${req.id}`}>
                              <p className="text-lg font-bold">+{Number(req.requestedHours).toFixed(1)}h</p>
                              <p className="text-xs text-muted-foreground">OT requested</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* OT Reject Dialog */}
        <Dialog open={otRejectDialogOpen} onOpenChange={setOtRejectDialogOpen}>
          <DialogContent data-testid="dialog-reject-ot">
            <DialogHeader>
              <DialogTitle>Reject Overtime Request</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this overtime request. The employee will be notified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {selectedOtRequest && (
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Employee:</span> {selectedOtRequest.user ? `${selectedOtRequest.user.firstName ?? ""} ${selectedOtRequest.user.lastName ?? ""}`.trim() : "Unknown"}</p>
                  <p><span className="text-muted-foreground">Requested OT:</span> +{Number(selectedOtRequest.requestedHours).toFixed(2)}h</p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="ot-reject-reason">Reason for Rejection</Label>
                <Textarea
                  id="ot-reject-reason"
                  placeholder="e.g., Overtime not pre-authorized for this project..."
                  value={otRejectReason}
                  onChange={(e) => setOtRejectReason(e.target.value)}
                  data-testid="textarea-ot-reject-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOtRejectDialogOpen(false)} data-testid="button-cancel-ot-reject">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!selectedOtRequest) return;
                  rejectOtRequest.mutate(
                    { id: selectedOtRequest.id, reason: otRejectReason },
                    {
                      onSuccess: () => {
                        toast({ title: "Overtime request rejected" });
                        setOtRejectDialogOpen(false);
                        setSelectedOtRequest(null);
                        setOtRejectReason("");
                        refetchOt();
                      },
                      onError: (err: any) => {
                        toast({ title: "Error", description: err.message, variant: "destructive" });
                      },
                    }
                  );
                }}
                disabled={!otRejectReason.trim() || rejectOtRequest.isPending}
                data-testid="button-confirm-ot-reject"
              >
                {rejectOtRequest.isPending ? "Rejecting..." : "Reject Request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject Shift Dialog */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent data-testid="dialog-reject">
            <DialogHeader>
              <DialogTitle>Reject Shift</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this shift. The employee will be notified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reject-reason">Reason for Rejection</Label>
                <Textarea
                  id="reject-reason"
                  placeholder="e.g., Clock-out time appears incorrect..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  data-testid="textarea-reject-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialogOpen(false)} data-testid="button-cancel-reject">
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleReject}
                disabled={!rejectReason.trim() || rejectShift.isPending}
                data-testid="button-confirm-reject"
              >
                {rejectShift.isPending ? "Rejecting..." : "Reject Shift"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Adjust Dialog */}
        <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
          <DialogContent data-testid="dialog-adjust">
            <DialogHeader>
              <DialogTitle>Adjust Shift Times</DialogTitle>
              <DialogDescription>
                Modify the clock-in or clock-out time. Provide a reason for the adjustment.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="adjust-clock-in">Clock In Time</Label>
                <Input
                  id="adjust-clock-in"
                  type="datetime-local"
                  value={adjustClockIn}
                  onChange={(e) => setAdjustClockIn(e.target.value)}
                  data-testid="input-adjust-clock-in"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adjust-clock-out">Clock Out Time</Label>
                <Input
                  id="adjust-clock-out"
                  type="datetime-local"
                  value={adjustClockOut}
                  onChange={(e) => setAdjustClockOut(e.target.value)}
                  data-testid="input-adjust-clock-out"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adjust-reason">Reason for Adjustment</Label>
                <Textarea
                  id="adjust-reason"
                  placeholder="e.g., Employee forgot to clock in at start of shift..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  data-testid="textarea-adjust-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustDialogOpen(false)} data-testid="button-cancel-adjust">
                Cancel
              </Button>
              <Button 
                onClick={handleAdjust}
                disabled={!adjustReason.trim() || adjustShift.isPending}
                data-testid="button-confirm-adjust"
              >
                {adjustShift.isPending ? "Adjusting..." : "Save Adjustment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject Time Entry Dialog */}
        <Dialog open={rejectEntryDialogOpen} onOpenChange={setRejectEntryDialogOpen}>
          <DialogContent data-testid="dialog-reject-entry">
            <DialogHeader>
              <DialogTitle>Reject Time Entry</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this time entry. The employee will be notified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="entry-reject-reason">Reason for Rejection</Label>
                <Textarea
                  id="entry-reject-reason"
                  placeholder="e.g., Hours recorded do not match project records..."
                  value={entryRejectReason}
                  onChange={(e) => setEntryRejectReason(e.target.value)}
                  data-testid="textarea-entry-reject-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectEntryDialogOpen(false)} data-testid="button-cancel-entry-reject">
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleRejectEntry}
                disabled={!entryRejectReason.trim() || rejectTimeEntry.isPending}
                data-testid="button-confirm-entry-reject"
              >
                {rejectTimeEntry.isPending ? "Rejecting..." : "Reject Entry"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
