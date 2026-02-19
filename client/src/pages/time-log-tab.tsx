import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  useMyShifts,
  useProjects,
  useOvertimeApprovers,
  useOvertimeRequestsByShifts,
  useCreateOvertimeRequest,
} from "@/hooks/use-data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  MapPin,
  Briefcase,
  CheckCircle2,
  AlertCircle,
  Timer,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileText,
  Camera,
  Pencil,
  Send,
  TrendingUp,
} from "lucide-react";
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

type FilterPeriod = "today" | "week" | "month" | "year" | "custom" | "all";

export default function TimeLogTab() {
  const { toast } = useToast();
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>("week");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined);
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined);
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);

  const [otDialogOpen, setOtDialogOpen] = useState(false);
  const [otShift, setOtShift] = useState<any>(null);
  const [otSuperintendentId, setOtSuperintendentId] = useState<string>("");
  const [otNotes, setOtNotes] = useState<string>("");

  const { data: projects = [] } = useProjects();
  const { data: approvers = [] } = useOvertimeApprovers();
  const createOtRequest = useCreateOvertimeRequest();

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (filterPeriod) {
      case "today":
        return { startDate: startOfDay(now).toISOString(), endDate: endOfDay(now).toISOString() };
      case "week":
        return { startDate: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), endDate: endOfWeek(now, { weekStartsOn: 1 }).toISOString() };
      case "month":
        return { startDate: startOfMonth(now).toISOString(), endDate: endOfMonth(now).toISOString() };
      case "year":
        return { startDate: startOfYear(now).toISOString(), endDate: endOfYear(now).toISOString() };
      case "custom":
        return {
          startDate: customStart ? startOfDay(customStart).toISOString() : undefined,
          endDate: customEnd ? endOfDay(customEnd).toISOString() : undefined,
        };
      default:
        return {};
    }
  }, [filterPeriod, customStart, customEnd]);

  const { data: allShifts = [], isLoading } = useMyShifts({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    pageSize: 200,
  });

  const shifts = useMemo(() => {
    if (projectFilter === "all") return allShifts;
    return allShifts.filter((s: any) => s.projectId === projectFilter);
  }, [allShifts, projectFilter]);

  const shiftIds = useMemo(() => shifts.map((s: any) => s.id), [shifts]);
  const { data: otRequests = [] } = useOvertimeRequestsByShifts(shiftIds);

  const otRequestMap = useMemo(() => {
    const map = new Map<string, any>();
    otRequests.forEach((req: any) => map.set(req.shiftId, req));
    return map;
  }, [otRequests]);

  const stats = useMemo(() => {
    let approvedCount = 0;
    let pendingCount = 0;
    let totalMinutes = 0;

    shifts.forEach((s: any) => {
      if (s.approvalStatus === "APPROVED") approvedCount++;
      else if (s.approvalStatus === "PENDING") pendingCount++;

      if (s.clockOut) {
        const start = new Date(s.clockIn).getTime();
        const end = new Date(s.clockOut).getTime();
        totalMinutes += (end - start) / (1000 * 60);
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);

    return { approvedCount, pendingCount, totalHours: `${hours}h ${mins}m`, totalShifts: shifts.length };
  }, [shifts]);

  const getShiftDuration = (clockIn: string, clockOut?: string) => {
    const start = new Date(clockIn).getTime();
    const end = clockOut ? new Date(clockOut).getTime() : Date.now();
    const ms = end - start;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const hasOvertime = (clockIn: string, clockOut?: string) => {
    const start = new Date(clockIn).getTime();
    const end = clockOut ? new Date(clockOut).getTime() : Date.now();
    return (end - start) / 3600000 > 8;
  };

  const getOvertimeDecimal = (clockIn: string, clockOut?: string) => {
    const start = new Date(clockIn).getTime();
    const end = clockOut ? new Date(clockOut).getTime() : Date.now();
    const totalHours = (end - start) / 3600000;
    if (totalHours <= 8) return "0.00";
    return (totalHours - 8).toFixed(2);
  };

  const getOvertimeDuration = (clockIn: string, clockOut?: string) => {
    const start = new Date(clockIn).getTime();
    const end = clockOut ? new Date(clockOut).getTime() : Date.now();
    const totalHours = (end - start) / 3600000;
    if (totalHours <= 8) return null;
    const excessMs = (totalHours - 8) * 3600000;
    const h = Math.floor(excessMs / 3600000);
    const m = Math.floor((excessMs % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const handleSubmitOtRequest = async () => {
    if (!otShift || !otSuperintendentId) return;
    try {
      await createOtRequest.mutateAsync({
        shiftId: otShift.id,
        requestedHours: getOvertimeDecimal(otShift.clockIn, otShift.clockOut),
        superintendentId: otSuperintendentId,
        notes: otNotes || undefined,
      });
      toast({ title: "OT Request Submitted", description: "Your overtime request has been submitted for approval" });
      setOtDialogOpen(false);
      setOtShift(null);
      setOtSuperintendentId("");
      setOtNotes("");
    } catch (error: any) {
      toast({ title: "OT Request Failed", description: error.message || "Failed to submit overtime request", variant: "destructive" });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "APPROVED": return "default";
      case "REJECTED": return "destructive";
      default: return "secondary";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "APPROVED": return "Approved";
      case "REJECTED": return "Rejected";
      default: return "Pending";
    }
  };

  const filterButtons: { label: string; value: FilterPeriod }[] = [
    { label: "Today", value: "today" },
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Year", value: "year" },
    { label: "Custom", value: "custom" },
    { label: "All", value: "all" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap" data-testid="filter-bar-time-log">
        <div className="flex gap-1 flex-wrap">
          {filterButtons.map((btn) => (
            <Button
              key={btn.value}
              size="sm"
              variant={filterPeriod === btn.value ? "default" : "outline"}
              onClick={() => setFilterPeriod(btn.value)}
              data-testid={`button-filter-${btn.value}`}
              className={filterPeriod === btn.value ? "toggle-elevate toggle-elevated" : "toggle-elevate"}
            >
              {btn.label}
            </Button>
          ))}
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          {filterPeriod === "custom" && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-custom-start">
                    <CalendarDays className="w-4 h-4 mr-1" />
                    {customStart ? format(customStart, "MMM d, yyyy") : "Start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customStart}
                    onSelect={setCustomStart}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-custom-end">
                    <CalendarDays className="w-4 h-4 mr-1" />
                    {customEnd ? format(customEnd, "MMM d, yyyy") : "End date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customEnd}
                    onSelect={setCustomEnd}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </>
          )}

          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-project-filter">
              <Briefcase className="w-4 h-4 mr-1 text-muted-foreground" />
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="select-option-project-all">All Projects</SelectItem>
              {projects.map((p: any) => (
                <SelectItem key={p.id} value={p.id} data-testid={`select-option-project-filter-${p.id}`}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="summary-cards-time-log">
        <Card data-testid="card-total-shifts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Total Shifts</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalShifts}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-approved-shifts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground font-medium">Approved</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.approvedCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-pending-shifts">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground font-medium">Pending</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pendingCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-total-hours">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Hours Worked</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalHours}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3" data-testid="shift-list-time-log">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading your work history...</div>
        ) : shifts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No shifts found for this period
          </div>
        ) : (
          shifts.map((shift: any) => {
            const isExpanded = expandedShiftId === shift.id;
            const existingOtRequest = otRequestMap.get(shift.id);
            const projectName = shift.project?.name || "Unknown Project";
            const projectCode = shift.project?.code;
            const isInProgress = !shift.clockOut;

            return (
              <Card
                key={shift.id}
                className="cursor-pointer transition-all"
                onClick={() => setExpandedShiftId(isExpanded ? null : shift.id)}
                data-testid={`card-shift-${shift.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" data-testid={`text-shift-date-${shift.id}`}>
                          {format(new Date(shift.clockIn), "EEE, MMM d, yyyy")}
                        </span>
                        <Badge variant={getStatusColor(shift.approvalStatus)} data-testid={`badge-status-${shift.id}`}>
                          {getStatusLabel(shift.approvalStatus)}
                        </Badge>
                        {isInProgress && (
                          <Badge variant="outline" className="text-green-600 border-green-600 dark:text-green-400 dark:border-green-400">
                            In Progress
                          </Badge>
                        )}
                        {existingOtRequest?.status === "APPROVED" && (
                          <Badge className="bg-green-600 text-white no-default-hover-elevate">
                            <Timer className="w-3 h-3 mr-1" />
                            OT {existingOtRequest.approvedHours || existingOtRequest.requestedHours}h
                          </Badge>
                        )}
                        {existingOtRequest?.status === "PENDING" && (
                          <Badge className="bg-orange-500 text-white no-default-hover-elevate">
                            <Timer className="w-3 h-3 mr-1" />
                            OT Pending
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <div className="flex items-center gap-1">
                          <Briefcase className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[150px]" data-testid={`text-project-${shift.id}`}>{projectName}</span>
                          {projectCode && <span className="text-xs opacity-70">({projectCode})</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span data-testid={`text-time-range-${shift.id}`}>
                            {format(new Date(shift.clockIn), "h:mm a")}
                            {" - "}
                            {shift.clockOut ? format(new Date(shift.clockOut), "h:mm a") : "Now"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-lg font-bold" data-testid={`text-duration-${shift.id}`}>
                          {getShiftDuration(shift.clockIn, shift.clockOut)}
                        </p>
                        <p className="text-xs text-muted-foreground">total</p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t space-y-3" data-testid={`detail-shift-${shift.id}`}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex items-start gap-2 text-sm">
                          <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Location</p>
                            {shift.clockInLatitude && shift.clockInLongitude ? (
                              <p data-testid={`text-gps-${shift.id}`}>
                                {Number(shift.clockInLatitude).toFixed(6)}, {Number(shift.clockInLongitude).toFixed(6)}
                              </p>
                            ) : (
                              <p className="text-muted-foreground italic">No GPS recorded</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-2 text-sm">
                          <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                            {shift.notes ? (
                              <p data-testid={`text-notes-${shift.id}`}>{shift.notes}</p>
                            ) : (
                              <p className="text-muted-foreground italic">No notes</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-2 text-sm">
                          <Camera className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Photo</p>
                            {shift.photoUrl ? (
                              <a href={shift.photoUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline" data-testid={`link-photo-${shift.id}`}>
                                View attachment
                              </a>
                            ) : (
                              <p className="text-muted-foreground italic">No photo</p>
                            )}
                          </div>
                        </div>

                        {shift.clockOut && hasOvertime(shift.clockIn, shift.clockOut) && (
                          <div className="flex items-start gap-2 text-sm">
                            <Timer className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs text-muted-foreground mb-0.5">Overtime</p>
                              <p>{getOvertimeDuration(shift.clockIn, shift.clockOut)}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 pt-1 flex-wrap">
                        {shift.approvalStatus === "PENDING" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); }}
                            data-testid={`button-edit-request-${shift.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Edit Request
                          </Button>
                        )}
                        {shift.clockOut && hasOvertime(shift.clockIn, shift.clockOut) && !existingOtRequest && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOtShift(shift);
                              setOtDialogOpen(true);
                            }}
                            data-testid={`button-request-ot-${shift.id}`}
                          >
                            <Send className="w-3.5 h-3.5 mr-1" />
                            Request OT
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={otDialogOpen} onOpenChange={setOtDialogOpen}>
        <DialogContent data-testid="dialog-ot-request-log">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Timer className="w-5 h-5" />
              Request Overtime
            </DialogTitle>
          </DialogHeader>
          {otShift && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 text-sm flex-wrap">
                <div>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  <span className="font-medium">{format(new Date(otShift.clockIn), "MMM d, yyyy")}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Project:</span>{" "}
                  <span className="font-medium">{otShift.project?.name || "Unknown"}</span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Excess Hours</Label>
                <div className="flex items-center gap-2 p-2 rounded-md bg-accent/50">
                  <Timer className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">
                    {getOvertimeDuration(otShift.clockIn, otShift.clockOut)} ({getOvertimeDecimal(otShift.clockIn, otShift.clockOut)} hrs)
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Approver</Label>
                <Select value={otSuperintendentId} onValueChange={setOtSuperintendentId}>
                  <SelectTrigger data-testid="select-ot-approver-log">
                    <SelectValue placeholder="Select approver..." />
                  </SelectTrigger>
                  <SelectContent>
                    {approvers.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.firstName} {a.lastName} ({a.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Reason / Notes</Label>
                <Textarea
                  value={otNotes}
                  onChange={(e) => setOtNotes(e.target.value)}
                  placeholder="Explain why overtime is needed..."
                  className="resize-none"
                  data-testid="textarea-ot-notes-log"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setOtDialogOpen(false); setOtShift(null); setOtSuperintendentId(""); setOtNotes(""); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitOtRequest}
              disabled={!otSuperintendentId || createOtRequest.isPending}
            >
              <Send className="w-4 h-4 mr-2" />
              {createOtRequest.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
