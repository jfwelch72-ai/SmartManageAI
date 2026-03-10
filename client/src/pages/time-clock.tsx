import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import {
  useCurrentShift,
  useClockIn,
  useClockOut,
  useMyShifts,
  useProjects,
  useOvertimeApprovers,
  useOvertimeRequestsByShifts,
  useCreateOvertimeRequest,
} from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  MapPin,
  Calendar,
  Briefcase,
  LogIn,
  LogOut,
  AlertCircle,
  Timer,
  Send,
  History,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import TimeLogTab from "./time-log-tab";

export default function TimeClockPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [gpsError, setGpsError] = useState<string>("");
  const [coordinates, setCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [otDialogOpen, setOtDialogOpen] = useState(false);
  const [otShift, setOtShift] = useState<any>(null);
  const [otSuperintendentId, setOtSuperintendentId] = useState<string>("");
  const [otNotes, setOtNotes] = useState<string>("");

  const { data: currentShift, isLoading: currentShiftLoading } =
    useCurrentShift();
  const { data: myShifts = [], isLoading: shiftsLoading } = useMyShifts();
  const { data: projects = [] } = useProjects();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const shiftIds = useMemo(() => myShifts.map((s: any) => s.id), [myShifts]);
  const { data: otRequests = [] } = useOvertimeRequestsByShifts(shiftIds);
  const { data: approvers = [] } = useOvertimeApprovers();
  const createOtRequest = useCreateOvertimeRequest();

  const otRequestMap = useMemo(() => {
    const map = new Map<string, any>();
    otRequests.forEach((req: any) => {
      map.set(req.shiftId, req);
    });
    return map;
  }, [otRequests]);

  const isClockedIn = !!currentShift?.shift;
  const shouldShowClockControls = user?.role !== "ADMIN";

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoordinates({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          setGpsError("");
        },
        (error) => {
          setGpsError(`GPS unavailable: ${error.message}`);
        },
      );
    } else {
      setGpsError("GPS not supported by browser");
    }
  }, []);

  const handleClockIn = async () => {
    if (!selectedProjectId) {
      toast({
        title: "Project Required",
        description: "Please select a project before clocking in",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await clockIn.mutateAsync({
        projectId: selectedProjectId,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      });
      toast({
        title: "Clocked In",
        description: "You have successfully clocked in",
      });
      if (
        (result as any)?.geofenceWarning ||
        (result as any)?.geofenceStatus === "OUT_OF_RANGE"
      ) {
        toast({
          title: "Geofence Warning",
          description:
            (result as any)?.geofenceWarning ||
            "You appear to be outside the project job site area. Your clock-in has been recorded but flagged.",
          variant: "destructive",
        });
      }
      setSelectedProjectId("");
    } catch (error: any) {
      toast({
        title: "Clock In Failed",
        description: error.message || "Failed to clock in",
        variant: "destructive",
      });
    }
  };

  const handleClockOut = async () => {
    try {
      await clockOut.mutateAsync({
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      });
      toast({
        title: "Clocked Out",
        description: "You have successfully clocked out",
      });
    } catch (error: any) {
      toast({
        title: "Clock Out Failed",
        description: error.message || "Failed to clock out",
        variant: "destructive",
      });
    }
  };

  const getShiftDuration = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getRegularDuration = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const totalHours = durationMs / (1000 * 60 * 60);
    const cappedMs = Math.min(totalHours, 8) * (1000 * 60 * 60);
    const hours = Math.floor(cappedMs / (1000 * 60 * 60));
    const minutes = Math.floor((cappedMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getOvertimeDuration = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const totalHours = durationMs / (1000 * 60 * 60);
    if (totalHours <= 8) return "\u2014";
    const excessMs = (totalHours - 8) * (1000 * 60 * 60);
    const hours = Math.floor(excessMs / (1000 * 60 * 60));
    const minutes = Math.floor((excessMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getRegularHours = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const totalHours = durationMs / (1000 * 60 * 60);
    const cappedMs = Math.min(totalHours, 8) * (1000 * 60 * 60);
    const hours = Math.floor(cappedMs / (1000 * 60 * 60));
    const minutes = Math.floor((cappedMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getOvertimeHours = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const totalHours = durationMs / (1000 * 60 * 60);
    if (totalHours <= 8) return null;
    const excessMs = (totalHours - 8) * (1000 * 60 * 60);
    const hours = Math.floor(excessMs / (1000 * 60 * 60));
    const minutes = Math.floor((excessMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getOvertimeDecimal = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const totalHours = durationMs / (1000 * 60 * 60);
    if (totalHours <= 8) return "0.00";
    return (totalHours - 8).toFixed(2);
  };

  const hasOvertime = (clockInTime: string, clockOutTime?: string) => {
    const start = new Date(clockInTime);
    const end = clockOutTime ? new Date(clockOutTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const totalHours = durationMs / (1000 * 60 * 60);
    return totalHours > 8;
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
      toast({
        title: "OT Request Submitted",
        description: "Your overtime request has been submitted for approval",
      });
      setOtDialogOpen(false);
      setOtShift(null);
      setOtSuperintendentId("");
      setOtNotes("");
    } catch (error: any) {
      toast({
        title: "OT Request Failed",
        description: error.message || "Failed to submit overtime request",
        variant: "destructive",
      });
    }
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return (
          <Badge variant="default" data-testid={`badge-approval-approved`}>
            Approved
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="destructive" data-testid={`badge-approval-rejected`}>
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" data-testid={`badge-approval-pending`}>
            Pending
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            Time Clock
          </h1>
          <p className="text-sm text-muted-foreground">
            Clock in and out of your shifts
          </p>
        </div>

        <Tabs defaultValue="clock" className="space-y-6">
          <TabsList data-testid="tabs-time-clock">
            <TabsTrigger value="clock" data-testid="tab-clock">
              <Clock className="w-4 h-4 mr-1.5" />
              Clock In/Out
            </TabsTrigger>
            <TabsTrigger value="log" data-testid="tab-time-log">
              <History className="w-4 h-4 mr-1.5" />
              Time Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clock" className="space-y-6 mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {shouldShowClockControls && (
                <Card
                  className="lg:col-span-2"
                  data-testid="card-clock-control"
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="w-5 h-5" />
                      {isClockedIn ? "Currently Clocked In" : "Clock In"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {currentShiftLoading ? (
                      <div className="text-center py-12 text-muted-foreground">
                        Loading shift status...
                      </div>
                    ) : isClockedIn ? (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-6 bg-accent/50 rounded-lg">
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              Clocked in at
                            </p>
                            <p
                              className="text-2xl font-bold"
                              data-testid="text-clock-in-time"
                            >
                              {currentShift.shift &&
                                format(
                                  new Date(currentShift.shift.clockIn),
                                  "h:mm a",
                                )}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {currentShift.shift &&
                                formatDistanceToNow(
                                  new Date(currentShift.shift.clockIn),
                                )}{" "}
                              ago
                            </p>
                          </div>
                          <div className="text-right space-y-2">
                            <p className="text-sm text-muted-foreground">
                              Duration
                            </p>
                            <p
                              className="text-2xl font-bold"
                              data-testid="text-shift-duration"
                            >
                              {currentShift.shift &&
                                getShiftDuration(
                                  String(currentShift.shift.clockIn),
                                )}
                            </p>
                          </div>
                        </div>

                        {currentShift.project && (
                          <div className="flex items-center gap-2 text-sm">
                            <Briefcase className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">
                              {currentShift.project.name}
                            </span>
                            <Badge variant="outline">
                              {currentShift.project.code}
                            </Badge>
                          </div>
                        )}

                        {gpsError && (
                          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                            <AlertCircle className="w-4 h-4" />
                            <span>{gpsError}</span>
                          </div>
                        )}

                        <Button
                          size="lg"
                          variant="destructive"
                          className="w-full"
                          onClick={handleClockOut}
                          disabled={clockOut.isPending}
                          data-testid="button-clock-out"
                        >
                          <LogOut className="w-5 h-5 mr-2" />
                          {clockOut.isPending ? "Clocking Out..." : "Clock Out"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            Select Project
                          </label>
                          <Select
                            value={selectedProjectId}
                            onValueChange={setSelectedProjectId}
                          >
                            <SelectTrigger data-testid="select-project">
                              <SelectValue placeholder="Choose a project..." />
                            </SelectTrigger>
                            <SelectContent>
                              {projects.map((project) => (
                                <SelectItem
                                  key={project.id}
                                  value={project.id}
                                  data-testid={`select-option-project-${project.id}`}
                                >
                                  {project.name} ({project.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {coordinates && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="w-4 h-4" />
                            <span data-testid="text-gps-coordinates">
                              GPS: {coordinates.latitude.toFixed(6)},{" "}
                              {coordinates.longitude.toFixed(6)}
                            </span>
                          </div>
                        )}

                        {gpsError && (
                          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                            <AlertCircle className="w-4 h-4" />
                            <span>{gpsError}</span>
                          </div>
                        )}

                        <Button
                          size="lg"
                          className="w-full"
                          onClick={handleClockIn}
                          disabled={!selectedProjectId || clockIn.isPending}
                          data-testid="button-clock-in"
                        >
                          <LogIn className="w-5 h-5 mr-2" />
                          {clockIn.isPending ? "Clocking In..." : "Clock In"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card
                className={shouldShowClockControls ? "" : "lg:col-span-3"}
                data-testid="card-quick-stats"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    This Week
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {shiftsLoading ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Loading stats...
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Total Shifts
                        </p>
                        <p
                          className="text-3xl font-bold"
                          data-testid="text-total-shifts"
                        >
                          {myShifts.length}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Pending Approval
                        </p>
                        <p
                          className="text-3xl font-bold"
                          data-testid="text-pending-approval"
                        >
                          {
                            myShifts.filter(
                              (s: any) => s.approvalStatus === "PENDING",
                            ).length
                          }
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-shift-history">
              <CardHeader>
                <CardTitle>Shift History</CardTitle>
              </CardHeader>
              <CardContent>
                {shiftsLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Loading shift history...
                  </div>
                ) : myShifts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No shifts recorded yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {myShifts.map((shift: any) => {
                      const existingOtRequest = otRequestMap.get(shift.id);
                      return (
                        <div
                          key={shift.id}
                          className="p-4 rounded-md border"
                          data-testid={`row-shift-${shift.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="font-medium text-sm"
                                  data-testid={`cell-date-${shift.id}`}
                                >
                                  {format(
                                    new Date(shift.clockIn),
                                    "EEE, MMM d, yyyy",
                                  )}
                                </span>
                                {getApprovalBadge(shift.approvalStatus)}
                                {!shift.clockOut && (
                                  <Badge
                                    variant="outline"
                                    className="text-green-600 border-green-600 dark:text-green-400 dark:border-green-400"
                                  >
                                    In Progress
                                  </Badge>
                                )}
                              </div>

                              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                <div
                                  className="flex items-center gap-1 flex-wrap"
                                  data-testid={`cell-project-${shift.id}`}
                                >
                                  <Briefcase className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[200px]">
                                    {shift.project?.name || "Unknown"}
                                  </span>
                                  {shift.project?.code && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs ml-1"
                                    >
                                      {shift.project.code}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 flex-wrap">
                                  <Clock className="w-3.5 h-3.5 shrink-0" />
                                  <span
                                    data-testid={`cell-clock-in-${shift.id}`}
                                  >
                                    {format(new Date(shift.clockIn), "h:mm a")}
                                  </span>
                                  <span>-</span>
                                  <span
                                    data-testid={`cell-clock-out-${shift.id}`}
                                  >
                                    {shift.clockOut
                                      ? format(
                                          new Date(shift.clockOut),
                                          "h:mm a",
                                        )
                                      : "Now"}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                {existingOtRequest?.status === "APPROVED" && (
                                  <Badge
                                    className="bg-green-600 dark:bg-green-700 text-white no-default-hover-elevate"
                                    data-testid={`badge-ot-approved-${shift.id}`}
                                  >
                                    <Timer className="w-3 h-3 mr-1" />
                                    OT{" "}
                                    {existingOtRequest.approvedHours ||
                                      existingOtRequest.requestedHours}
                                    h
                                  </Badge>
                                )}
                                {existingOtRequest?.status === "PENDING" && (
                                  <Badge
                                    className="bg-orange-500 dark:bg-orange-600 text-white no-default-hover-elevate"
                                    data-testid={`badge-ot-pending-${shift.id}`}
                                  >
                                    <Timer className="w-3 h-3 mr-1" />
                                    OT Pending
                                  </Badge>
                                )}
                                {existingOtRequest?.status === "REJECTED" && (
                                  <Badge
                                    variant="destructive"
                                    data-testid={`badge-ot-action-rejected-${shift.id}`}
                                  >
                                    OT Rejected
                                  </Badge>
                                )}
                                {shift.clockOut &&
                                  hasOvertime(shift.clockIn, shift.clockOut) &&
                                  !existingOtRequest && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
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

                            <div className="text-right shrink-0">
                              <p
                                className="text-lg font-bold"
                                data-testid={`cell-duration-${shift.id}`}
                              >
                                {shift.clockOut
                                  ? getRegularDuration(
                                      shift.clockIn,
                                      shift.clockOut,
                                    )
                                  : "..."}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {shift.clockOut &&
                                hasOvertime(shift.clockIn, shift.clockOut)
                                  ? `+${getOvertimeDuration(shift.clockIn, shift.clockOut)} OT`
                                  : "total"}
                              </p>
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

          <TabsContent value="log" className="mt-0">
            <TimeLogTab />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={otDialogOpen} onOpenChange={setOtDialogOpen}>
        <DialogContent data-testid="dialog-ot-request">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Timer className="w-5 h-5" />
              Request Overtime
            </DialogTitle>
          </DialogHeader>
          {otShift && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  <span className="font-medium" data-testid="text-ot-date">
                    {format(new Date(otShift.clockIn), "MMM d, yyyy")}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Project:</span>{" "}
                  <span className="font-medium" data-testid="text-ot-project">
                    {otShift.project?.name || "Unknown"}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Excess Hours</Label>
                <div
                  className="flex items-center gap-2 p-2 rounded-md bg-accent/50"
                  data-testid="text-ot-excess-hours"
                >
                  <Timer className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">
                    {getOvertimeDuration(otShift.clockIn, otShift.clockOut)} (
                    {getOvertimeDecimal(otShift.clockIn, otShift.clockOut)} hrs)
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ot-approver" className="text-sm">
                  Approver
                </Label>
                <Select
                  value={otSuperintendentId}
                  onValueChange={setOtSuperintendentId}
                >
                  <SelectTrigger data-testid="select-ot-approver">
                    <SelectValue placeholder="Select approver..." />
                  </SelectTrigger>
                  <SelectContent>
                    {approvers.map((approver: any) => (
                      <SelectItem
                        key={approver.id}
                        value={approver.id}
                        data-testid={`select-option-approver-${approver.id}`}
                      >
                        {approver.firstName} {approver.lastName} (
                        {approver.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ot-notes" className="text-sm">
                  Reason / Notes
                </Label>
                <Textarea
                  id="ot-notes"
                  value={otNotes}
                  onChange={(e) => setOtNotes(e.target.value)}
                  placeholder="Explain why overtime is needed..."
                  className="resize-none"
                  data-testid="textarea-ot-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOtDialogOpen(false);
                setOtShift(null);
                setOtSuperintendentId("");
                setOtNotes("");
              }}
              data-testid="button-ot-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitOtRequest}
              disabled={!otSuperintendentId || createOtRequest.isPending}
              data-testid="button-ot-submit"
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
