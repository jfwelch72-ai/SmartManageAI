import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { calculateDistance, GEOFENCE_RADIUS } from "@shared/utils/geofence";
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
  useUpdateShiftCostCode,
  useCostCodes,
  useProjectCostCodes,
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
  Shield,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import TimeLogTab from "./time-log-tab";

export default function TimeClockPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [gpsError, setGpsError] = useState<string>("");
  const [gpsAcquiring, setGpsAcquiring] = useState<boolean>(true);
  const [coordinates, setCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const [otDialogOpen, setOtDialogOpen] = useState(false);
  const [otShift, setOtShift] = useState<any>(null);
  const [otSuperintendentId, setOtSuperintendentId] = useState<string>("");
  const [otNotes, setOtNotes] = useState<string>("");

  const [selectedCostCode, setSelectedCostCode] = useState<string>("");

  const { data: currentShift, isLoading: currentShiftLoading } =
    useCurrentShift();
  const { data: myShifts = [], isLoading: shiftsLoading } = useMyShifts();
  const { data: projects = [] } = useProjects();
  const { data: orgCostCodes = [] } = useCostCodes();
  const { data: projectCostCodes = [] } = useProjectCostCodes(selectedProjectId || null);
  const costCodes = selectedProjectId ? projectCostCodes : orgCostCodes;

  const activeShiftProjectId = currentShift?.shift?.projectId || null;
  const { data: activeShiftCostCodes = [] } = useProjectCostCodes(activeShiftProjectId);
  const shiftCostCodes = activeShiftProjectId ? activeShiftCostCodes : orgCostCodes;
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const updateCostCode = useUpdateShiftCostCode();

  const shiftIds = useMemo(() => myShifts.map((s: Record<string, unknown>) => s.id as string), [myShifts]);
  const { data: otRequests = [] } = useOvertimeRequestsByShifts(shiftIds);
  const { data: approvers = [] } = useOvertimeApprovers();
  const createOtRequest = useCreateOvertimeRequest();

  const otRequestMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    otRequests.forEach((req: Record<string, unknown>) => {
      map.set(req.shiftId as string, req);
    });
    return map;
  }, [otRequests]);

  const isClockedIn = !!currentShift?.shift;
  const shouldShowClockControls = user?.role !== "ADMIN";

  const selectedProjectEnforcement = useMemo(() => {
    if (!selectedProjectId) return "OFF";
    const proj = projects.find((p) => p.id === selectedProjectId);
    return proj?.geofenceEnforcement || "OFF";
  }, [selectedProjectId, projects]);

  const gpsRequiredForClockIn = selectedProjectEnforcement === "WARN" || selectedProjectEnforcement === "BLOCK";
  const clockInDisabledByGps = selectedProjectEnforcement === "BLOCK"
    ? !coordinates
    : gpsRequiredForClockIn && gpsAcquiring && !coordinates;

  const activeProjectEnforcement = useMemo(() => {
    if (!currentShift?.project) return "OFF";
    return (currentShift.project as Record<string, unknown>)?.geofenceEnforcement as string || "OFF";
  }, [currentShift]);

  const clockOutBlockedByGeofence = useMemo(() => {
    if (activeProjectEnforcement !== "BLOCK") return false;
    const proj = currentShift?.project as Record<string, unknown> | null;
    if (!proj) return false;
    const siteLat = proj.siteLatitude as number | null;
    const siteLng = proj.siteLongitude as number | null;
    if (siteLat == null || siteLng == null) return false;
    if (!coordinates) return true;
    const distance = calculateDistance(coordinates.latitude, coordinates.longitude, siteLat, siteLng);
    const radius = (proj.geofenceRadius as number) || GEOFENCE_RADIUS;
    return distance > radius;
  }, [activeProjectEnforcement, currentShift, coordinates]);

  const clockOutGeofenceMessage = useMemo(() => {
    if (activeProjectEnforcement !== "BLOCK") return null;
    const proj = currentShift?.project as Record<string, unknown> | null;
    if (!proj) return null;
    const siteLat = proj.siteLatitude as number | null;
    const siteLng = proj.siteLongitude as number | null;
    if (siteLat == null || siteLng == null) return null;
    if (!coordinates) return "Clock-out is blocked: GPS is required for this project but is unavailable.";
    const distance = calculateDistance(coordinates.latitude, coordinates.longitude, siteLat, siteLng);
    const radius = (proj.geofenceRadius as number) || GEOFENCE_RADIUS;
    if (distance > radius) return `Clock-out is blocked: You are ${Math.round(distance)}m from the project site (allowed: ${radius}m).`;
    return null;
  }, [activeProjectEnforcement, currentShift, coordinates]);

  const startGpsWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (!("geolocation" in navigator)) {
      setGpsError("GPS not supported by browser");
      setGpsAcquiring(false);
      return;
    }

    setGpsAcquiring(true);
    setGpsError("");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setGpsError("");
        setGpsAcquiring(false);
      },
      (error) => {
        setGpsError(`GPS unavailable: ${error.message}`);
        setCoordinates(null);
        setGpsAcquiring(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      },
    );
  }, []);

  useEffect(() => {
    startGpsWatch();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [startGpsWatch]);

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
        costCode: selectedCostCode || undefined,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      });
      toast({
        title: "Clocked In",
        description: "You have successfully clocked in",
      });
      const clockInResult = result as Record<string, unknown>;
      if (
        clockInResult?.geofenceWarning ||
        clockInResult?.geofenceStatus === "OUT_OF_RANGE"
      ) {
        toast({
          title: "Geofence Warning",
          description:
            (clockInResult?.geofenceWarning as string) ||
            "You appear to be outside the project job site area. Your clock-in has been recorded but flagged.",
          variant: "destructive",
        });
      }
      setSelectedProjectId("");
      setSelectedCostCode("");
    } catch (error) {
      toast({
        title: "Clock In Failed",
        description: error instanceof Error ? error.message : "Failed to clock in",
        variant: "destructive",
      });
    }
  };

  const handleClockOut = async () => {
    try {
      const result = await clockOut.mutateAsync({
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      });
      toast({
        title: "Clocked Out",
        description: "You have successfully clocked out",
      });
      const clockOutResult = result as Record<string, unknown>;
      if (
        clockOutResult?.geofenceWarning ||
        clockOutResult?.clockOutGeofenceStatus === "OUT_OF_RANGE" ||
        clockOutResult?.clockOutGeofenceStatus === "NO_GPS"
      ) {
        toast({
          title: "Geofence Warning",
          description:
            (clockOutResult?.geofenceWarning as string) ||
            (clockOutResult?.clockOutGeofenceStatus === "NO_GPS"
              ? "GPS was unavailable during clock-out. Your clock-out has been recorded but flagged."
              : "You appear to be outside the project job site area. Your clock-out has been recorded but flagged."),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Clock Out Failed",
        description: error instanceof Error ? error.message : "Failed to clock out",
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
    } catch (error) {
      toast({
        title: "OT Request Failed",
        description: error instanceof Error ? error.message : "Failed to submit overtime request",
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

                        <div className="flex items-center gap-3 text-sm">
                          <Tag className="w-4 h-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Cost Code:</span>
                          <Select
                            value={(currentShift.shift as Record<string, unknown>)?.costCode as string || "__none__"}
                            onValueChange={(val) => {
                              updateCostCode.mutate({ costCode: val === "__none__" ? null : val || null }, {
                                onSuccess: () => {
                                  toast({ title: "Cost Code Updated" });
                                },
                                onError: (err: Error) => {
                                  toast({ title: "Update Failed", description: err.message, variant: "destructive" });
                                },
                              });
                            }}
                          >
                            <SelectTrigger className="w-[220px] h-8" data-testid="select-active-cost-code">
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" data-testid="option-no-cost-code">No cost code</SelectItem>
                              {shiftCostCodes.map((cc) => (
                                <SelectItem key={cc.code} value={cc.code}>
                                  {cc.code} - {cc.description}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {(() => {
                          const shiftData = currentShift.shift as Record<string, unknown>;
                          const geoStatus = shiftData?.geofenceStatus as string | undefined;
                          if (!geoStatus) return null;
                          if (geoStatus === "WITHIN_RANGE") return (
                            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="text-geofence-status">
                              <ShieldCheck className="w-4 h-4" />
                              <span>Geo-fence: Within Range</span>
                            </div>
                          );
                          return (
                            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400" data-testid="text-geofence-status">
                              <ShieldAlert className="w-4 h-4" />
                              <span>Geo-fence: {geoStatus === "OUT_OF_RANGE" ? "Out of Range" : "No GPS"}</span>
                            </div>
                          );
                        })()}

                        {gpsAcquiring && !coordinates && (
                          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400" data-testid="text-gps-acquiring-clockout">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Acquiring GPS for clock-out...</span>
                          </div>
                        )}

                        {gpsError && (
                          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                            <AlertCircle className="w-4 h-4" />
                            <span data-testid="text-gps-error-clockout">{gpsError}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={startGpsWatch}
                              data-testid="button-retry-gps-clockout"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          </div>
                        )}

                        {clockOutGeofenceMessage && (
                          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400" data-testid="text-clockout-blocked-message">
                            <ShieldAlert className="w-4 h-4" />
                            <span>{clockOutGeofenceMessage}</span>
                          </div>
                        )}

                        <Button
                          size="lg"
                          variant="destructive"
                          className="w-full"
                          onClick={handleClockOut}
                          disabled={clockOut.isPending || clockOutBlockedByGeofence}
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

                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            Cost Code (Optional)
                          </label>
                          <Select
                            value={selectedCostCode}
                            onValueChange={setSelectedCostCode}
                          >
                            <SelectTrigger data-testid="select-cost-code">
                              <SelectValue placeholder="Select cost code..." />
                            </SelectTrigger>
                            <SelectContent>
                              {costCodes.map((cc) => (
                                <SelectItem
                                  key={cc.code}
                                  value={cc.code}
                                  data-testid={`select-option-cost-code-${cc.code}`}
                                >
                                  {cc.code} - {cc.description}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {selectedProjectId && (() => {
                          const proj = projects.find((p) => p.id === selectedProjectId);
                          const mode = proj?.geofenceEnforcement || "OFF";
                          if (mode === "OFF") return null;

                          const hasSiteCoords = proj?.siteLatitude != null && proj?.siteLongitude != null;
                          const hasWorkerCoords = coordinates?.latitude != null && coordinates?.longitude != null;

                          let workerInRange = false;
                          let distanceMeters = 0;
                          const radiusMeters = (proj as Record<string, unknown>)?.geofenceRadius as number || GEOFENCE_RADIUS;
                          if (hasSiteCoords && hasWorkerCoords) {
                            distanceMeters = calculateDistance(coordinates!.latitude, coordinates!.longitude, proj.siteLatitude!, proj.siteLongitude!);
                            workerInRange = distanceMeters <= radiusMeters;
                          }

                          return (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm" data-testid="text-geofence-mode">
                                {mode === "BLOCK" ? (
                                  <ShieldAlert className="w-4 h-4 text-red-500" />
                                ) : (
                                  <Shield className="w-4 h-4 text-amber-500" />
                                )}
                                <span className={mode === "BLOCK" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>
                                  Geo-fence: {mode === "BLOCK" ? "Required — clock-in blocked if out of range" : "Warning — clock-in allowed but flagged"}
                                </span>
                              </div>

                              {hasSiteCoords && (
                                <div className="border rounded-lg p-3 bg-muted/30" data-testid="geofence-map-thumbnail">
                                  <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
                                    <MapPin className="w-3 h-3" />
                                    Geo-fence Boundary
                                  </div>
                                  <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto" aria-label="Geofence map showing worker position relative to site boundary">
                                    <circle cx="100" cy="100" r="70" fill="none" stroke={workerInRange ? "#22c55e" : "#ef4444"} strokeWidth="2" strokeDasharray="6 3" opacity="0.6" />
                                    <circle cx="100" cy="100" r="4" fill="#3b82f6" />
                                    <text x="100" y="120" textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.6">Site Center</text>
                                    {hasWorkerCoords && (() => {
                                      const scale = 70 / Math.max(radiusMeters, distanceMeters * 1.2);
                                      const bearing = Math.atan2(coordinates!.longitude - proj.siteLongitude!, coordinates!.latitude - proj.siteLatitude!);
                                      const dx = Math.sin(bearing) * distanceMeters * scale;
                                      const dy = -Math.cos(bearing) * distanceMeters * scale;
                                      const wx = Math.min(190, Math.max(10, 100 + dx));
                                      const wy = Math.min(190, Math.max(10, 100 + dy));
                                      return (
                                        <>
                                          <line x1="100" y1="100" x2={wx} y2={wy} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />
                                          <circle cx={wx} cy={wy} r="5" fill={workerInRange ? "#22c55e" : "#ef4444"} />
                                          <text x={wx} y={wy + 14} textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">You</text>
                                        </>
                                      );
                                    })()}
                                  </svg>
                                  <div className="text-center text-xs text-muted-foreground mt-1">
                                    {hasWorkerCoords ? (
                                      <span data-testid="text-geofence-distance">
                                        {distanceMeters < 1000 ? `${Math.round(distanceMeters)}m` : `${(distanceMeters / 1000).toFixed(1)}km`} from site
                                        {" · "}Radius: {radiusMeters}m
                                      </span>
                                    ) : (
                                      <span>Awaiting GPS position...</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {gpsAcquiring && !coordinates && (
                          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400" data-testid="text-gps-acquiring">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Acquiring GPS...</span>
                          </div>
                        )}

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
                            <span data-testid="text-gps-error">{gpsError}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={startGpsWatch}
                              data-testid="button-retry-gps"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          </div>
                        )}

                        <Button
                          size="lg"
                          className="w-full"
                          onClick={handleClockIn}
                          disabled={!selectedProjectId || clockIn.isPending || clockInDisabledByGps}
                          data-testid="button-clock-in"
                        >
                          <LogIn className="w-5 h-5 mr-2" />
                          {clockIn.isPending ? "Clocking In..." : "Clock In"}
                        </Button>
                        {clockInDisabledByGps && (
                          <p className="text-xs text-muted-foreground text-center" data-testid="text-gps-required-message">
                            {gpsAcquiring
                              ? "GPS position is required for this project's geo-fence. Please wait for GPS to be acquired."
                              : "GPS position is required to clock in on this project. Please retry GPS or enable location services."}
                          </p>
                        )}
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
                              (s) => s.approvalStatus === "PENDING",
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
                    {myShifts.map((shift) => {
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
                                {shift.costCode && (
                                  <div className="flex items-center gap-1">
                                    <Tag className="w-3.5 h-3.5 shrink-0" />
                                    <Badge variant="outline" className="text-xs" data-testid={`cell-cost-code-${shift.id}`}>
                                      {shift.costCode}
                                    </Badge>
                                  </div>
                                )}
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
                    {approvers.map((approver: { id: string; firstName: string; lastName: string; role: string }) => (
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
