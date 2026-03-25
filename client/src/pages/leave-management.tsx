import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  useLeaveTypes,
  useLeaveBalances,
  useLeaveRequests,
  useCreateLeaveRequest,
  useApproveLeaveRequest,
  useDenyLeaveRequest,
  useTeamLeaveCalendar,
  useCancelLeaveRequest,
  type LeaveBalance,
  type LeaveRequestWithDetails,
  type TeamLeaveEntry,
} from "@/hooks/use-data";
import { Plus, Calendar, CheckCircle, XCircle, Clock, TreePalm, Stethoscope, User, Briefcase, Scale, HelpCircle, AlertCircle, type LucideIcon } from "lucide-react";
import { format, parseISO, differenceInCalendarDays, eachDayOfInterval, isSameMonth, isSameDay, isWithinInterval, startOfMonth, endOfMonth } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const leaveTypeIcons: Record<string, LucideIcon> = {
  "Vacation": TreePalm,
  "Sick": Stethoscope,
  "Personal": User,
  "Bereavement": HelpCircle,
  "Jury Duty": Scale,
  "Other": Briefcase,
};

function getLeaveIcon(name: string) {
  const Icon = leaveTypeIcons[name] || Briefcase;
  return <Icon className="w-5 h-5" />;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return <Badge variant="secondary" className="gap-1" data-testid="badge-status-pending"><Clock className="w-3 h-3" />Pending</Badge>;
    case "APPROVED":
      return <Badge className="gap-1 bg-green-600" data-testid="badge-status-approved"><CheckCircle className="w-3 h-3" />Approved</Badge>;
    case "DENIED":
      return <Badge variant="destructive" className="gap-1" data-testid="badge-status-denied"><XCircle className="w-3 h-3" />Denied</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getDayCount(startDate: string, endDate: string): number {
  return differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
}

function BalanceCards({ balances, isLoading, isError }: { balances: LeaveBalance[]; isLoading: boolean; isError: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-muted rounded w-16 mb-2" />
              <div className="h-8 bg-muted rounded w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-balance-error">
        <CardContent className="p-6 flex items-center gap-3 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">Failed to load leave balances. Please try refreshing the page.</span>
        </CardContent>
      </Card>
    );
  }

  if (balances.length === 0) {
    return (
      <Card data-testid="card-balance-empty">
        <CardContent className="p-6 text-center text-muted-foreground">
          <span className="text-sm">No leave types configured for your organization.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {balances.map((balance) => (
        <Card key={balance.leaveTypeId} data-testid={`card-balance-${balance.leaveTypeName}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              {getLeaveIcon(balance.leaveTypeName)}
              <span className="text-sm font-medium truncate">{balance.leaveTypeName}</span>
            </div>
            <div className="text-2xl font-bold">{balance.remaining}</div>
            <div className="text-xs text-muted-foreground">
              {balance.used} used / {balance.annualAllowance} total
            </div>
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  balance.remaining <= 0 ? "bg-red-500" : balance.remaining <= 2 ? "bg-yellow-500" : "bg-green-500"
                )}
                style={{ width: `${balance.annualAllowance > 0 ? Math.min(100, ((balance.annualAllowance - balance.used) / balance.annualAllowance) * 100) : 0}%` }}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RequestForm({ onClose }: { onClose: () => void }) {
  const { data: leaveTypes = [] } = useLeaveTypes();
  const createRequest = useCreateLeaveRequest();
  const { toast } = useToast();

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    if (!leaveTypeId || !startDate || !endDate) {
      toast({ title: "Error", description: "Please select leave type, start date, and end date", variant: "destructive" });
      return;
    }

    if (endDate < startDate) {
      toast({ title: "Error", description: "End date must be after start date", variant: "destructive" });
      return;
    }

    try {
      await createRequest.mutateAsync({
        leaveTypeId,
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
        reason: reason || undefined,
      });
      toast({ title: "Success", description: "Leave request submitted successfully" });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to submit leave request", variant: "destructive" });
    }
  };

  const activeTypes = leaveTypes.filter((t) => t.isActive);

  return (
    <div className="space-y-4">
      <div>
        <Label>Leave Type</Label>
        <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
          <SelectTrigger data-testid="select-leave-type">
            <SelectValue placeholder="Select leave type" />
          </SelectTrigger>
          <SelectContent>
            {activeTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                data-testid="input-leave-start-date"
              >
                <Calendar className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarPicker mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2">
          <Label>End Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}
                data-testid="input-leave-end-date"
              >
                <Calendar className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarPicker mode="single" selected={endDate} onSelect={setEndDate} initialFocus disabled={startDate ? { before: startDate } : undefined} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {startDate && endDate && endDate >= startDate && (
        <div className="text-sm text-muted-foreground">
          Duration: {getDayCount(format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd"))} day(s)
        </div>
      )}
      <div>
        <Label>Reason (optional)</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Provide a reason for your leave request..."
          data-testid="input-leave-reason"
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-leave">Cancel</Button>
        <Button onClick={handleSubmit} disabled={createRequest.isPending} data-testid="button-submit-leave">
          {createRequest.isPending ? "Submitting..." : "Submit Request"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function RequestHistory() {
  const { data: requests = [], isLoading } = useLeaveRequests({ scope: "mine" });
  const cancelRequest = useCancelLeaveRequest();
  const { toast } = useToast();

  const handleCancel = async (id: string) => {
    try {
      await cancelRequest.mutateAsync(id);
      toast({ title: "Cancelled", description: "Leave request has been cancelled" });
    } catch {
      toast({ title: "Error", description: "Failed to cancel leave request", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No leave requests yet. Submit your first request above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <div
          key={request.id}
          className="flex items-center justify-between p-4 border rounded-lg"
          data-testid={`request-history-${request.id}`}
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{request.leaveTypeName}</span>
              {getStatusBadge(request.status)}
            </div>
            <div className="text-sm text-muted-foreground">
              {request.startDate} to {request.endDate} ({getDayCount(request.startDate, request.endDate)} days)
            </div>
            {request.reason && (
              <div className="text-sm text-muted-foreground mt-1">{request.reason}</div>
            )}
            {request.reviewerNote && (
              <div className="text-sm mt-1 italic text-muted-foreground">
                Reviewer note: {request.reviewerNote}
              </div>
            )}
          </div>
          {(request.status === "PENDING" || request.status === "APPROVED") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCancel(request.id)}
              disabled={cancelRequest.isPending}
              data-testid={`button-cancel-request-${request.id}`}
            >
              <XCircle className="w-4 h-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function PendingRequestQueue() {
  const { data: pendingRequests = [], isLoading: pendingLoading } = useLeaveRequests({ status: "PENDING" });
  const { data: approvedRequests = [], isLoading: approvedLoading } = useLeaveRequests({ status: "APPROVED" });
  const approveRequest = useApproveLeaveRequest();
  const denyRequest = useDenyLeaveRequest();
  const { toast } = useToast();
  const [reviewNote, setReviewNote] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "deny" | "revoke" | null>(null);

  const handleAction = async () => {
    if (!reviewingId || !reviewAction) return;

    try {
      if (reviewAction === "approve") {
        await approveRequest.mutateAsync({ id: reviewingId, note: reviewNote || undefined });
        toast({ title: "Approved", description: "Leave request has been approved" });
      } else {
        await denyRequest.mutateAsync({ id: reviewingId, note: reviewNote || undefined });
        toast({ title: reviewAction === "revoke" ? "Revoked" : "Denied", description: `Leave request has been ${reviewAction === "revoke" ? "revoked" : "denied"}. Balance restored.` });
      }
      setReviewingId(null);
      setReviewAction(null);
      setReviewNote("");
    } catch {
      toast({ title: "Error", description: "Failed to process leave request", variant: "destructive" });
    }
  };

  const isLoading = pendingLoading || approvedLoading;

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  if (pendingRequests.length === 0 && approvedRequests.length === 0) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-3" />
        <h3 className="text-lg font-medium mb-1">All Caught Up!</h3>
        <p className="text-muted-foreground">There are no pending leave requests to review.</p>
      </div>
    );
  }

  return (
    <>
      {pendingRequests.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pending Requests</h3>
          {pendingRequests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between p-4 border rounded-lg"
              data-testid={`pending-leave-${request.id}`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">
                    {request.employeeFirstName} {request.employeeLastName}
                  </span>
                  <Badge variant="outline">{request.leaveTypeName}</Badge>
                  {getStatusBadge(request.status)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {request.startDate} to {request.endDate} ({getDayCount(request.startDate, request.endDate)} days)
                </div>
                {request.reason && (
                  <div className="text-sm text-muted-foreground mt-1">{request.reason}</div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => { setReviewingId(request.id); setReviewAction("approve"); }}
                  data-testid={`button-approve-leave-${request.id}`}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { setReviewingId(request.id); setReviewAction("deny"); }}
                  data-testid={`button-deny-leave-${request.id}`}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Deny
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {approvedRequests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Approved Leave (can be revoked)</h3>
          {approvedRequests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between p-4 border rounded-lg"
              data-testid={`approved-leave-${request.id}`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">
                    {request.employeeFirstName} {request.employeeLastName}
                  </span>
                  <Badge variant="outline">{request.leaveTypeName}</Badge>
                  {getStatusBadge(request.status)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {request.startDate} to {request.endDate} ({getDayCount(request.startDate, request.endDate)} days)
                </div>
                {request.reason && (
                  <div className="text-sm text-muted-foreground mt-1">{request.reason}</div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { setReviewingId(request.id); setReviewAction("revoke"); }}
                  data-testid={`button-revoke-leave-${request.id}`}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Revoke
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!reviewingId} onOpenChange={(open) => { if (!open) { setReviewingId(null); setReviewAction(null); setReviewNote(""); } }}>
        <DialogContent data-testid="dialog-review-leave">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? "Approve" : reviewAction === "revoke" ? "Revoke" : "Deny"} Leave Request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {reviewAction === "revoke" && (
              <p className="text-sm text-muted-foreground">
                Revoking an approved leave request will restore the employee's leave balance and remove the associated calendar event.
              </p>
            )}
            <div>
              <Label>Note (optional)</Label>
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Add a note for the employee..."
                data-testid="input-review-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewingId(null); setReviewAction(null); setReviewNote(""); }} data-testid="button-cancel-review">
              Cancel
            </Button>
            <Button
              variant={reviewAction === "approve" ? "default" : "destructive"}
              onClick={handleAction}
              disabled={approveRequest.isPending || denyRequest.isPending}
              data-testid="button-confirm-review"
            >
              {approveRequest.isPending || denyRequest.isPending
                ? "Processing..."
                : reviewAction === "approve"
                  ? "Approve"
                  : reviewAction === "revoke"
                    ? "Revoke"
                    : "Deny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamLeaveCalendar() {
  const { data: teamLeave = [], isLoading } = useTeamLeaveCalendar();
  const [currentDate, setCurrentDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getLeaveForDay = (day: Date) => {
    return teamLeave.filter((leave: TeamLeaveEntry) => {
      const start = parseISO(leave.startDate);
      const end = parseISO(leave.endDate);
      return isWithinInterval(day, { start, end }) || isSameDay(day, start) || isSameDay(day, end);
    });
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  const startPadding = monthStart.getDay();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{format(currentDate, "MMMM yyyy")}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} data-testid="button-team-calendar-prev">
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())} data-testid="button-team-calendar-today">
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} data-testid="button-team-calendar-next">
            Next
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-center text-sm font-medium text-muted-foreground p-2">{day}</div>
        ))}
        {Array.from({ length: startPadding }).map((_, i) => (
          <div key={`pad-${i}`} className="min-h-20 p-1" />
        ))}
        {daysInMonth.map((day) => {
          const dayLeave = getLeaveForDay(day);
          const isToday = isSameDay(day, new Date());

          return (
            <div
              key={day.toString()}
              className={cn(
                "min-h-20 p-1 border rounded-md bg-background",
                isToday && "border-primary border-2"
              )}
              data-testid={`team-calendar-day-${format(day, "yyyy-MM-dd")}`}
            >
              <div className="text-xs font-medium mb-1">{format(day, "d")}</div>
              <div className="space-y-0.5">
                {dayLeave.slice(0, 3).map((leave: TeamLeaveEntry) => (
                  <div
                    key={leave.id}
                    className="text-[10px] truncate bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded px-1"
                    title={`${leave.employeeFirstName} ${leave.employeeLastName} - ${leave.leaveTypeName}`}
                  >
                    {leave.employeeFirstName} {leave.employeeLastName?.[0]}.
                  </div>
                ))}
                {dayLeave.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">+{dayLeave.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LeaveManagementPage() {
  const { user } = useAuth();
  const [showRequestDialog, setShowRequestDialog] = useState(false);

  const isManager = ["ADMIN", "MANAGER", "HR_MANAGER"].includes(user?.role || "");

  const { data: balances = [], isLoading: balancesLoading, isError: balancesError } = useLeaveBalances();

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Leave Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage time-off requests and leave balances
            </p>
          </div>
          <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-leave-request">
                <Plus className="w-4 h-4 mr-2" />
                Request Leave
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-new-leave-request">
              <DialogHeader>
                <DialogTitle>New Leave Request</DialogTitle>
              </DialogHeader>
              <RequestForm onClose={() => setShowRequestDialog(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3" data-testid="text-balance-heading">My Leave Balances</h2>
          <BalanceCards balances={balances} isLoading={balancesLoading} isError={balancesError} />
        </div>

        <Tabs defaultValue="my-requests" className="space-y-4">
          <TabsList data-testid="tabs-leave-management">
            <TabsTrigger value="my-requests" data-testid="tab-my-requests">My Requests</TabsTrigger>
            {isManager && (
              <TabsTrigger value="pending-review" data-testid="tab-pending-review">Pending Review</TabsTrigger>
            )}
            {isManager && (
              <TabsTrigger value="team-calendar" data-testid="tab-team-calendar">Team Calendar</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="my-requests">
            <Card>
              <CardHeader>
                <CardTitle>My Leave Request History</CardTitle>
              </CardHeader>
              <CardContent>
                <RequestHistory />
              </CardContent>
            </Card>
          </TabsContent>

          {isManager && (
            <TabsContent value="pending-review">
              <Card>
                <CardHeader>
                  <CardTitle>Pending Leave Requests</CardTitle>
                </CardHeader>
                <CardContent>
                  <PendingRequestQueue />
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {isManager && (
            <TabsContent value="team-calendar">
              <Card>
                <CardHeader>
                  <CardTitle>Team Leave Calendar</CardTitle>
                </CardHeader>
                <CardContent>
                  <TeamLeaveCalendar />
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
