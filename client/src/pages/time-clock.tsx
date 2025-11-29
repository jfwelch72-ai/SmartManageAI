import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { 
  useCurrentShift, 
  useClockIn, 
  useClockOut, 
  useMyShifts, 
  useProjects 
} from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Clock, MapPin, Calendar, Briefcase, LogIn, LogOut, AlertCircle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export default function TimeClockPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [gpsError, setGpsError] = useState<string>("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);

  const { data: currentShift, isLoading: currentShiftLoading } = useCurrentShift();
  const { data: myShifts = [], isLoading: shiftsLoading } = useMyShifts();
  const { data: projects = [] } = useProjects();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const isClockedIn = !!currentShift?.shift;
  const shouldShowClockControls = user?.role !== "ADMIN";

  // Get GPS coordinates
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
        }
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
      await clockIn.mutateAsync({
        projectId: selectedProjectId,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      });
      toast({
        title: "Clocked In",
        description: "You have successfully clocked in",
      });
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

  const getShiftDuration = (clockIn: string, clockOut?: string) => {
    const start = new Date(clockIn);
    const end = clockOut ? new Date(clockOut) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return <Badge variant="default" data-testid={`badge-approval-approved`}>Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive" data-testid={`badge-approval-rejected`}>Rejected</Badge>;
      default:
        return <Badge variant="secondary" data-testid={`badge-approval-pending`}>Pending</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">Time Clock</h1>
          <p className="text-sm text-muted-foreground">
            Clock in and out of your shifts
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Clock In/Out Card - Hidden for Admins */}
          {shouldShowClockControls && (
            <Card className="lg:col-span-2" data-testid="card-clock-control">
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
                      <p className="text-sm text-muted-foreground">Clocked in at</p>
                      <p className="text-2xl font-bold" data-testid="text-clock-in-time">
                        {currentShift.shift && format(new Date(currentShift.shift.clockIn), "h:mm a")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {currentShift.shift && formatDistanceToNow(new Date(currentShift.shift.clockIn))} ago
                      </p>
                    </div>
                    <div className="text-right space-y-2">
                      <p className="text-sm text-muted-foreground">Duration</p>
                      <p className="text-2xl font-bold" data-testid="text-shift-duration">
                        {currentShift.shift && getShiftDuration(String(currentShift.shift.clockIn))}
                      </p>
                    </div>
                  </div>

                  {currentShift.project && (
                    <div className="flex items-center gap-2 text-sm">
                      <Briefcase className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{currentShift.project.name}</span>
                      <Badge variant="outline">{currentShift.project.code}</Badge>
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
                    <label className="text-sm font-medium">Select Project</label>
                    <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                      <SelectTrigger data-testid="select-project">
                        <SelectValue placeholder="Choose a project..." />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id} data-testid={`select-option-project-${project.id}`}>
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
                        GPS: {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}
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

          {/* Quick Stats Card */}
          <Card className={shouldShowClockControls ? "" : "lg:col-span-3"} data-testid="card-quick-stats">
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
                    <p className="text-sm text-muted-foreground">Total Shifts</p>
                    <p className="text-3xl font-bold" data-testid="text-total-shifts">
                      {myShifts.length}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Pending Approval</p>
                    <p className="text-3xl font-bold" data-testid="text-pending-approval">
                      {myShifts.filter((s: any) => s.approvalStatus === "PENDING").length}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Shift History */}
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
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Date</TableHead>
                      <TableHead className="whitespace-nowrap">Project</TableHead>
                      <TableHead className="whitespace-nowrap">Clock In</TableHead>
                      <TableHead className="whitespace-nowrap">Clock Out</TableHead>
                      <TableHead className="whitespace-nowrap">Duration</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {myShifts.map((shift: any) => (
                    <TableRow key={shift.id} data-testid={`row-shift-${shift.id}`}>
                      <TableCell data-testid={`cell-date-${shift.id}`}>
                        {format(new Date(shift.clockIn), "MMM d, yyyy")}
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
                        {format(new Date(shift.clockIn), "h:mm a")}
                      </TableCell>
                      <TableCell data-testid={`cell-clock-out-${shift.id}`}>
                        {shift.clockOut ? format(new Date(shift.clockOut), "h:mm a") : "-"}
                      </TableCell>
                      <TableCell data-testid={`cell-duration-${shift.id}`}>
                        {shift.clockOut ? getShiftDuration(shift.clockIn, shift.clockOut) : "In Progress"}
                      </TableCell>
                      <TableCell data-testid={`cell-status-${shift.id}`}>
                        {getApprovalBadge(shift.approvalStatus)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
