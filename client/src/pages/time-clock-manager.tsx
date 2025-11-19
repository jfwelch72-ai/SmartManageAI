import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { 
  useActiveShifts, 
  usePendingShiftApprovals, 
  useApproveShift,
  useRejectShift,
  useAdjustShift,
} from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Clock, Users, CheckCircle, XCircle, Edit, MapPin, Briefcase } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export default function TimeClockManagerPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustClockIn, setAdjustClockIn] = useState("");
  const [adjustClockOut, setAdjustClockOut] = useState("");
  const [createTimeEntry, setCreateTimeEntry] = useState(true);

  const { data: activeShifts = [], isLoading: activeLoading, refetch: refetchActive } = useActiveShifts();
  const { data: pendingShifts = [], isLoading: pendingLoading, refetch: refetchPending } = usePendingShiftApprovals();
  const approveShift = useApproveShift();
  const rejectShift = useRejectShift();
  const adjustShift = useAdjustShift();

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

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

  if (!isManager) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
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
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">Time Clock Management</h1>
          <p className="text-sm text-muted-foreground">
            Monitor active shifts, approve time, and manage adjustments
          </p>
        </div>

        <Tabs defaultValue="live" className="space-y-6">
          <TabsList data-testid="tabs-manager">
            <TabsTrigger value="live" data-testid="tab-live">
              <Users className="w-4 h-4 mr-2" />
              Live Monitoring
            </TabsTrigger>
            <TabsTrigger value="approvals" data-testid="tab-approvals">
              <CheckCircle className="w-4 h-4 mr-2" />
              Pending Approvals
              {pendingShifts.length > 0 && (
                <Badge variant="destructive" className="ml-2" data-testid="badge-pending-count">
                  {pendingShifts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Live Monitoring Tab */}
          <TabsContent value="live" data-testid="content-live">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Active Shifts
                  <Badge variant="secondary" data-testid="badge-active-count">{activeShifts.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activeLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading active shifts...
                  </div>
                ) : activeShifts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No active shifts at the moment
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeShifts.map((shift: any) => (
                        <TableRow key={shift.id} data-testid={`row-active-${shift.id}`}>
                          <TableCell data-testid={`cell-employee-${shift.id}`}>
                            <div className="space-y-1">
                              <p className="font-medium">
                                {shift.user?.firstName} {shift.user?.lastName}
                              </p>
                              <p className="text-sm text-muted-foreground">{shift.user?.role}</p>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`cell-project-${shift.id}`}>
                            <div className="space-y-1">
                              <p className="font-medium">{shift.project?.name || "Unknown"}</p>
                              {shift.project?.code && (
                                <Badge variant="outline">{shift.project.code}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell data-testid={`cell-clock-in-${shift.id}`}>
                            <div className="space-y-1">
                              <p>{format(new Date(shift.clockIn), "h:mm a")}</p>
                              <p className="text-sm text-muted-foreground">
                                {formatDistanceToNow(new Date(shift.clockIn))} ago
                              </p>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`cell-duration-${shift.id}`}>
                            <span className="font-medium">{getShiftDuration(shift.clockIn)}</span>
                          </TableCell>
                          <TableCell data-testid={`cell-location-${shift.id}`}>
                            {shift.clockInLatitude && shift.clockInLongitude ? (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <MapPin className="w-3 h-3" />
                                <span>
                                  {shift.clockInLatitude.toFixed(4)}, {shift.clockInLongitude.toFixed(4)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">No GPS</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pending Approvals Tab */}
          <TabsContent value="approvals" data-testid="content-approvals">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Pending Approvals
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pendingLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading pending approvals...
                  </div>
                ) : pendingShifts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No pending approvals
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingShifts.map((shift: any) => (
                        <TableRow key={shift.id} data-testid={`row-pending-${shift.id}`}>
                          <TableCell data-testid={`cell-employee-${shift.id}`}>
                            <div className="space-y-1">
                              <p className="font-medium">
                                {shift.user?.firstName} {shift.user?.lastName}
                              </p>
                              <p className="text-sm text-muted-foreground">{shift.user?.role}</p>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`cell-project-${shift.id}`}>
                            <div className="space-y-1">
                              <p className="font-medium">{shift.project?.name || "Unknown"}</p>
                              {shift.project?.code && (
                                <Badge variant="outline">{shift.project.code}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell data-testid={`cell-date-${shift.id}`}>
                            {format(new Date(shift.clockIn), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell data-testid={`cell-clock-in-${shift.id}`}>
                            {format(new Date(shift.clockIn), "h:mm a")}
                          </TableCell>
                          <TableCell data-testid={`cell-clock-out-${shift.id}`}>
                            {shift.clockOut ? format(new Date(shift.clockOut), "h:mm a") : "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-duration-${shift.id}`}>
                            {shift.clockOut ? getShiftDuration(shift.clockIn, shift.clockOut) : "In Progress"}
                          </TableCell>
                          <TableCell data-testid={`cell-actions-${shift.id}`}>
                            <div className="flex items-center gap-2">
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
        </Tabs>

        {/* Reject Dialog */}
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
      </main>
    </div>
  );
}
