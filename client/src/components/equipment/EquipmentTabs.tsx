import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import {
  Truck, Wrench, Clock, MapPin, Calendar, DollarSign,
  AlertTriangle, CheckCircle, Edit, History,
  Plus, Loader2, Sparkles, Check, AlertCircle, CalendarClock,
  TrendingDown, Fuel, Trash2
} from "lucide-react";
import type { Equipment } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const REPAIR_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const EQUIPMENT_TYPES = [
  { value: "HEAVY_EQUIPMENT", label: "Heavy Equipment" },
  { value: "POWER_TOOL", label: "Power Tool" },
  { value: "HAND_TOOL", label: "Hand Tool" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "TRAILER", label: "Trailer" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "COMPACTION", label: "Compaction" },
  { value: "SURVEYING", label: "Surveying" },
  { value: "SAFETY", label: "Safety" },
  { value: "OTHER", label: "Other" },
];

export interface MaintenanceSchedule {
  id: string;
  equipmentId: string;
  maintenanceType: string;
  name: string;
  description: string | null;
  intervalHours: number | null;
  intervalDays: number | null;
  lastPerformedAt: string | null;
  lastPerformedHours: string | null;
  nextDueAt: string | null;
  nextDueHours: string | null;
  alertDaysBefore: number;
  alertHoursBefore: number;
  isActive: boolean;
  priority?: string;
  estimatedDuration?: string;
  estimatedCost?: number;
  requiredParts?: string[];
  notes?: string;
}

export interface MaintenanceHistory {
  id: string;
  maintenanceType: string;
  description: string;
  performedAt: string;
  hoursAtMaintenance: string | null;
  performedByVendor: string | null;
  laborCost: string | null;
  partsCost: string | null;
  totalCost: string | null;
  notes: string | null;
  performedByName: string;
}

export interface RateProfile {
  id: string;
  equipmentId: string;
  hourlyRate: string;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
  fuelCostPerHour: string | null;
  maintenanceCostPerHour: string | null;
  operatorCostPerHour: string | null;
  includesOperator: boolean;
  effectiveDate: string;
  expirationDate: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  createdByName?: string;
}

function getTypeLabel(type: string) {
  const typeOption = EQUIPMENT_TYPES.find(t => t.value === type);
  return typeOption ? typeOption.label : type;
}

function getMaintenanceStatus(schedule: MaintenanceSchedule, currentHoursStr: string): { status: string; color: string; icon: any } {
  const now = new Date();
  const currentHours = parseFloat(currentHoursStr || "0");

  if (schedule.nextDueHours) {
    const dueHours = parseFloat(schedule.nextDueHours);
    const hoursRemaining = dueHours - currentHours;
    if (hoursRemaining <= 0) {
      return { status: "Overdue", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: AlertCircle };
    }
    if (hoursRemaining <= (schedule.alertHoursBefore || 25)) {
      return { status: "Due Soon", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: AlertTriangle };
    }
  }

  if (schedule.nextDueAt) {
    const dueDate = new Date(schedule.nextDueAt);
    const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= 0) {
      return { status: "Overdue", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: AlertCircle };
    }
    if (daysRemaining <= (schedule.alertDaysBefore || 7)) {
      return { status: "Due Soon", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: AlertTriangle };
    }
  }

  return { status: "On Schedule", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle };
}

interface OverviewTabProps {
  equipment: Equipment;
}

export function OverviewTab({ equipment }: OverviewTabProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Equipment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Type</p>
              <p className="font-medium">{getTypeLabel(equipment.type)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Hours</p>
              <p className="font-medium flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {equipment.currentHours || "0"} hrs
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Make</p>
              <p className="font-medium">{equipment.make || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Model</p>
              <p className="font-medium">{equipment.model || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Year</p>
              <p className="font-medium">{equipment.year || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Serial Number</p>
              <p className="font-medium">{equipment.serialNumber || "-"}</p>
            </div>
            {equipment.vinNumber && (
              <div>
                <p className="text-sm text-muted-foreground">VIN</p>
                <p className="font-medium">{equipment.vinNumber}</p>
              </div>
            )}
            {equipment.licensePlate && (
              <div>
                <p className="text-sm text-muted-foreground">License Plate</p>
                <p className="font-medium">{equipment.licensePlate}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Location & Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Home Location</p>
              <p className="font-medium flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {equipment.homeLocation || "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Location</p>
              <p className="font-medium flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {equipment.currentLocation || equipment.homeLocation || "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Purchase Price</p>
              <p className="font-medium flex items-center gap-1">
                <DollarSign className="h-4 w-4" />
                {equipment.purchasePrice ? `$${parseFloat(equipment.purchasePrice).toLocaleString()}` : "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Last Maintenance</p>
              <p className="font-medium flex items-center gap-1">
                <Wrench className="h-4 w-4" />
                {equipment.lastMaintenanceDate
                  ? format(new Date(equipment.lastMaintenanceDate), "MMM d, yyyy")
                  : "-"
                }
              </p>
            </div>
          </div>

          {equipment.description && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{equipment.description}</p>
            </div>
          )}

          {equipment.notes && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{equipment.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface AssignmentsTabProps {
  assignments: any[];
  canEdit: boolean;
  equipmentStatus: string;
  onOpenAssign: () => void;
}

export function AssignmentsTab({ assignments, canEdit, equipmentStatus, onOpenAssign }: AssignmentsTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Assignment History</CardTitle>
          <CardDescription>Track where this equipment has been assigned</CardDescription>
        </div>
        {canEdit && equipmentStatus === "AVAILABLE" && (
          <Button onClick={onOpenAssign} size="sm" data-testid="button-new-assignment">
            <Plus className="h-4 w-4 mr-2" />
            Assign
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No assignment history</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Returned</TableHead>
                <TableHead>Hours Used</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment: any) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <Link href={`/projects/${assignment.projectCode}`} className="text-primary hover:underline">
                      {assignment.projectName}
                    </Link>
                  </TableCell>
                  <TableCell>{format(new Date(assignment.assignedAt), "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    {assignment.returnedAt
                      ? format(new Date(assignment.returnedAt), "MMM d, yyyy")
                      : "-"
                    }
                  </TableCell>
                  <TableCell>
                    {assignment.hoursAtReturn && assignment.hoursAtAssignment
                      ? `${(parseFloat(assignment.hoursAtReturn) - parseFloat(assignment.hoursAtAssignment)).toFixed(1)} hrs`
                      : "-"
                    }
                  </TableCell>
                  <TableCell>
                    <Badge variant={assignment.isActive ? "default" : "secondary"}>
                      {assignment.isActive ? "Active" : "Returned"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface RepairsTabProps {
  repairs: any[];
  canEdit: boolean;
  onOpenRepair: () => void;
  onUpdateRepairStatus: (repairId: string, status: string) => void;
}

export function RepairsTab({ repairs, canEdit, onOpenRepair, onUpdateRepairStatus }: RepairsTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Repair History</CardTitle>
            <CardDescription>Track repairs and maintenance issues</CardDescription>
          </div>
          {canEdit && (
            <Button onClick={onOpenRepair} size="sm" data-testid="button-new-repair">
              <Plus className="h-4 w-4 mr-2" />
              Report Issue
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {repairs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No repair history</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repair #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {repairs.map((repair: any) => (
                  <TableRow key={repair.id}>
                    <TableCell className="font-mono">{repair.repairNumber}</TableCell>
                    <TableCell>{repair.description}</TableCell>
                    <TableCell>{format(new Date(repair.problemReportedAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      {repair.actualCost
                        ? `$${parseFloat(repair.actualCost).toLocaleString()}`
                        : repair.estimatedCost
                          ? `~$${parseFloat(repair.estimatedCost).toLocaleString()}`
                          : "-"
                      }
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        repair.status === "COMPLETED" ? "default" :
                        repair.status === "IN_PROGRESS" ? "secondary" : "outline"
                      }>
                        {repair.status}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Select
                          value={repair.status}
                          onValueChange={(value) => onUpdateRepairStatus(repair.id, value)}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {REPAIR_STATUS_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface HoursTabProps {
  hourLogs: any[];
  canEdit: boolean;
  onOpenHourLog: () => void;
}

export function HoursTab({ hourLogs, canEdit, onOpenHourLog }: HoursTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Hour Logs</CardTitle>
          <CardDescription>Weekly equipment usage tracking</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={onOpenHourLog} size="sm" data-testid="button-new-hour-log">
            <Plus className="h-4 w-4 mr-2" />
            Log Hours
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {hourLogs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No hour logs recorded</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Starting Hours</TableHead>
                <TableHead>Ending Hours</TableHead>
                <TableHead>Hours Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hourLogs.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell>
                    {format(new Date(log.weekStartDate), "MMM d")} - {format(new Date(log.weekEndDate), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <Link href={`/projects/${log.projectCode}`} className="text-primary hover:underline">
                      {log.projectName}
                    </Link>
                  </TableCell>
                  <TableCell>{log.startingHours}</TableCell>
                  <TableCell>{log.endingHours}</TableCell>
                  <TableCell className="font-medium">{log.hoursUsed} hrs</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface MaintenanceTabProps {
  equipment: Equipment;
  maintenanceSchedules: MaintenanceSchedule[];
  maintenanceHistory: MaintenanceHistory[];
  canEdit: boolean;
  isGenerating: boolean;
  onGenerateSchedule: () => void;
  onCompleteMaintenance: (schedule: MaintenanceSchedule) => void;
}

export function MaintenanceTab({
  equipment,
  maintenanceSchedules,
  maintenanceHistory,
  canEdit,
  isGenerating,
  onGenerateSchedule,
  onCompleteMaintenance,
}: MaintenanceTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Preventative Maintenance Schedule
            </CardTitle>
            <CardDescription>
              AI-generated maintenance schedule based on {equipment.make && equipment.model
                ? `${equipment.make} ${equipment.model} manufacturer recommendations`
                : `${getTypeLabel(equipment.type)} best practices`}
            </CardDescription>
          </div>
          {canEdit && (
            <Button
              onClick={onGenerateSchedule}
              disabled={isGenerating}
              size="sm"
              data-testid="button-generate-schedule"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {maintenanceSchedules.length > 0 ? "Regenerate Schedule" : "Generate Schedule"}
                </>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {maintenanceSchedules.length === 0 ? (
            <div className="text-center py-12">
              <CalendarClock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Maintenance Schedule</h3>
              <p className="text-muted-foreground mb-4">
                Generate an AI-powered maintenance schedule based on this equipment's make, model, and current hours.
              </p>
              {canEdit && (
                <Button onClick={onGenerateSchedule} disabled={isGenerating} data-testid="button-generate-schedule-empty">
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating Schedule...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Maintenance Schedule
                    </>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {maintenanceSchedules.map((schedule) => {
                const statusInfo = getMaintenanceStatus(schedule, equipment.currentHours || "0");
                const StatusIcon = statusInfo.icon;
                return (
                  <Card key={schedule.id} className="border">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold">{schedule.name}</h4>
                            <Badge className={statusInfo.color}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {statusInfo.status}
                            </Badge>
                            <Badge variant="outline">{schedule.maintenanceType}</Badge>
                          </div>

                          {schedule.description && (
                            <p className="text-sm text-muted-foreground">{schedule.description}</p>
                          )}

                          <div className="flex flex-wrap gap-4 text-sm">
                            {schedule.intervalHours && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                Every {schedule.intervalHours} hours
                              </div>
                            )}
                            {schedule.intervalDays && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Calendar className="h-4 w-4" />
                                Every {schedule.intervalDays} days
                              </div>
                            )}
                            {schedule.nextDueHours && (
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground">Next due at:</span>
                                <span className="font-medium">{parseFloat(schedule.nextDueHours).toLocaleString()} hrs</span>
                                <span className="text-muted-foreground">
                                  ({(parseFloat(schedule.nextDueHours) - parseFloat(equipment.currentHours || "0")).toFixed(0)} hrs remaining)
                                </span>
                              </div>
                            )}
                            {schedule.nextDueAt && (
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground">Next due:</span>
                                <span className="font-medium">{format(new Date(schedule.nextDueAt), "MMM d, yyyy")}</span>
                              </div>
                            )}
                          </div>

                          {schedule.lastPerformedAt && (
                            <div className="text-xs text-muted-foreground">
                              Last performed: {format(new Date(schedule.lastPerformedAt), "MMM d, yyyy")}
                              {schedule.lastPerformedHours && ` at ${parseFloat(schedule.lastPerformedHours).toLocaleString()} hrs`}
                            </div>
                          )}
                        </div>

                        {canEdit && (
                          <Button
                            size="sm"
                            onClick={() => onCompleteMaintenance(schedule)}
                            data-testid={`button-complete-maintenance-${schedule.id}`}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Mark Complete
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" />
            Maintenance History
          </CardTitle>
          <CardDescription>Record of completed maintenance tasks</CardDescription>
        </CardHeader>
        <CardContent>
          {maintenanceHistory.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No maintenance history recorded</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Performed</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Performed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maintenanceHistory.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <Badge variant="outline">{record.maintenanceType}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{record.description}</TableCell>
                    <TableCell>{format(new Date(record.performedAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      {record.hoursAtMaintenance
                        ? `${parseFloat(record.hoursAtMaintenance).toLocaleString()} hrs`
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      {record.totalCost
                        ? `$${parseFloat(record.totalCost).toLocaleString()}`
                        : "-"
                      }
                    </TableCell>
                    <TableCell>{record.performedByVendor || record.performedByName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface RatesTabProps {
  rateProfiles: RateProfile[];
  isLoadingRates: boolean;
  canEdit: boolean;
  onAddRate: () => void;
  onEditRate: (profile: RateProfile) => void;
  onActivateRate: (id: string) => void;
  isActivating: boolean;
}

interface DepreciationScheduleItem {
  year: number;
  beginningValue: number;
  depreciation: number;
  endingValue: number;
  accumulatedDepreciation: number;
}

interface DepreciationData {
  configured: boolean;
  currentBookValue: number;
  accumulatedDepreciation: number;
  remainingUsefulLife: number;
  depreciationMethod?: string;
  purchasePrice?: number;
  salvageValue?: number;
  usefulLifeYears?: number;
  inServiceDate?: string;
  schedule: DepreciationScheduleItem[];
}

interface DepreciationTabProps {
  equipment: Equipment;
}

export function DepreciationTab({ equipment }: DepreciationTabProps) {
  const { data: depreciation, isLoading } = useQuery<DepreciationData>({
    queryKey: ["/api/equipment", equipment.id, "depreciation"],
    queryFn: async () => {
      const res = await fetch(`/api/equipment/${equipment.id}/depreciation`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch depreciation");
      return res.json();
    },
    enabled: !!equipment.id,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-2">Loading depreciation data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!depreciation?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Depreciation</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8">
          <TrendingDown className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Depreciation tracking not configured</p>
          <p className="text-sm text-muted-foreground mt-1">
            Set purchase price, useful life, salvage value, and in-service date to enable depreciation tracking.
          </p>
        </CardContent>
      </Card>
    );
  }

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Current Book Value</p>
            <p className="text-2xl font-bold text-primary" data-testid="text-book-value">
              ${depreciation.currentBookValue.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Accumulated Depreciation</p>
            <p className="text-2xl font-bold text-orange-600" data-testid="text-accumulated-depreciation">
              ${depreciation.accumulatedDepreciation.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Remaining Useful Life</p>
            <p className="text-2xl font-bold" data-testid="text-remaining-life">
              {depreciation.remainingUsefulLife} {depreciation.remainingUsefulLife === 1 ? "year" : "years"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Method</p>
            <p className="text-lg font-semibold" data-testid="text-depreciation-method">
              {depreciation.depreciationMethod === "DECLINING_BALANCE" ? "Declining Balance" : "Straight-Line"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Depreciation Schedule</CardTitle>
          <CardDescription>
            Year-by-year depreciation from {depreciation.inServiceDate ? format(new Date(depreciation.inServiceDate + "T00:00:00"), "MMM d, yyyy") : "in-service date"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Beginning Value</TableHead>
                <TableHead className="text-right">Depreciation</TableHead>
                <TableHead className="text-right">Ending Value</TableHead>
                <TableHead className="text-right">Accumulated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depreciation.schedule.map((item) => (
                <TableRow
                  key={item.year}
                  className={item.year === currentYear ? "bg-primary/5 font-medium" : ""}
                  data-testid={`row-depreciation-${item.year}`}
                >
                  <TableCell>
                    {item.year}
                    {item.year === currentYear && (
                      <Badge variant="secondary" className="ml-2 text-xs">Current</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">${item.beginningValue.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-orange-600">${item.depreciation.toLocaleString()}</TableCell>
                  <TableCell className="text-right">${item.endingValue.toLocaleString()}</TableCell>
                  <TableCell className="text-right">${item.accumulatedDepreciation.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

interface FuelLog {
  id: string;
  equipmentId: string;
  projectId: string | null;
  date: string;
  gallons: string;
  pricePerGallon: string;
  totalCost: string;
  fuelType: string;
  meterReading: string | null;
  notes: string | null;
  projectName: string | null;
  submittedByName: string | null;
}

interface FuelSummary {
  totalGallons: number;
  totalCost: number;
  avgPricePerGallon: number;
  costPerHour: number;
  logCount: number;
  projectBreakdown: {
    projectId: string;
    projectName: string | null;
    totalGallons: number;
    totalCost: number;
    logCount: number;
  }[];
}

interface FuelTabProps {
  equipment: Equipment;
  canEdit: boolean;
  onOpenFuelLog: () => void;
}

export function FuelTab({ equipment, canEdit, onOpenFuelLog }: FuelTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: fuelLogs = [], isLoading: isLoadingLogs } = useQuery<FuelLog[]>({
    queryKey: ["/api/equipment", equipment.id, "fuel-logs"],
    queryFn: async () => {
      const res = await fetch(`/api/equipment/${equipment.id}/fuel-logs`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch fuel logs");
      return res.json();
    },
    enabled: !!equipment.id,
  });

  const { data: fuelSummary } = useQuery<FuelSummary>({
    queryKey: ["/api/equipment", equipment.id, "fuel-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/equipment/${equipment.id}/fuel-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch fuel summary");
      return res.json();
    },
    enabled: !!equipment.id,
  });

  const deleteFuelLog = useMutation({
    mutationFn: async (logId: string) => {
      return apiRequest("DELETE", `/api/equipment/fuel-logs/${logId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment.id, "fuel-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment.id, "fuel-summary"] });
      toast({ title: "Success", description: "Fuel log deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete fuel log", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {fuelSummary && fuelSummary.logCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Gallons</p>
              <p className="text-2xl font-bold" data-testid="text-total-gallons">
                {fuelSummary.totalGallons.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Fuel Cost</p>
              <p className="text-2xl font-bold text-primary" data-testid="text-total-fuel-cost">
                ${fuelSummary.totalCost.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Avg Cost/Gallon</p>
              <p className="text-2xl font-bold" data-testid="text-avg-cost-gallon">
                ${fuelSummary.avgPricePerGallon.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Cost/Hour</p>
              <p className="text-2xl font-bold" data-testid="text-fuel-cost-per-hour">
                ${fuelSummary.costPerHour.toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Fuel History</CardTitle>
            <CardDescription>
              {fuelLogs.length} fuel log{fuelLogs.length !== 1 ? "s" : ""} recorded
            </CardDescription>
          </div>
          {canEdit && (
            <Button onClick={onOpenFuelLog} data-testid="button-add-fuel-log">
              <Plus className="h-4 w-4 mr-2" />
              Log Fuel
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoadingLogs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : fuelLogs.length === 0 ? (
            <div className="text-center py-8">
              <Fuel className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No fuel logs recorded</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead className="text-right">Gallons</TableHead>
                  <TableHead className="text-right">$/Gallon</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Running Avg $/Gal</TableHead>
                  <TableHead className="text-right">Cumulative Cost</TableHead>
                  <TableHead>Meter</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  let runningGallons = 0;
                  let runningCost = 0;
                  const sortedLogs = [...fuelLogs].reverse();
                  const runningData = sortedLogs.map((log) => {
                    runningGallons += parseFloat(log.gallons);
                    runningCost += parseFloat(log.totalCost);
                    return { id: log.id, runningAvg: runningCost / runningGallons, cumulativeCost: runningCost };
                  });
                  const runningMap = new Map(runningData.map(d => [d.id, d]));

                  return fuelLogs.map((log) => {
                    const running = runningMap.get(log.id);
                    return (
                  <TableRow key={log.id} data-testid={`row-fuel-${log.id}`}>
                    <TableCell>{format(new Date(log.date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{log.fuelType}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {parseFloat(log.gallons).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      ${parseFloat(log.pricePerGallon).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${parseFloat(log.totalCost).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground" data-testid={`text-running-avg-${log.id}`}>
                      ${running?.runningAvg.toFixed(2) || "0.00"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground" data-testid={`text-cumulative-cost-${log.id}`}>
                      ${running?.cumulativeCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                    </TableCell>
                    <TableCell>{log.meterReading ? `${parseFloat(log.meterReading).toFixed(1)} hrs` : "-"}</TableCell>
                    <TableCell className="text-sm">{log.projectName || "-"}</TableCell>
                    <TableCell>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteFuelLog.mutate(log.id)}
                          data-testid={`button-delete-fuel-${log.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                    );
                  });
                })()}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {fuelSummary && fuelSummary.projectBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Fuel Cost by Project</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Gallons</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fuelSummary.projectBreakdown.map((p) => (
                  <TableRow key={p.projectId} data-testid={`row-fuel-project-${p.projectId}`}>
                    <TableCell className="font-medium">{p.projectName || "Unknown Project"}</TableCell>
                    <TableCell className="text-right">{p.totalGallons.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-medium">${p.totalCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{p.logCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function RatesTab({ rateProfiles, isLoadingRates, canEdit, onAddRate, onEditRate, onActivateRate, isActivating }: RatesTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-lg">Internal Rate Profiles</CardTitle>
          <CardDescription>
            Configure hourly, daily, and weekly rates for estimating and project costing
          </CardDescription>
        </div>
        {canEdit && (
          <Button
            onClick={onAddRate}
            data-testid="button-add-rate"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Rate Profile
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoadingRates ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading rate profiles...</span>
          </div>
        ) : rateProfiles.length === 0 ? (
          <div className="text-center py-8">
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No rate profiles configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add rate profiles to track equipment costs for bids and projects
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Hourly Rate</TableHead>
                <TableHead>Daily Rate</TableHead>
                <TableHead>Weekly Rate</TableHead>
                <TableHead>Fuel/hr</TableHead>
                <TableHead>Effective Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rateProfiles.map((profile) => (
                <TableRow key={profile.id} data-testid={`row-rate-${profile.id}`}>
                  <TableCell>
                    <Badge variant={profile.isActive ? "default" : "secondary"}>
                      {profile.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    ${parseFloat(profile.hourlyRate || "0").toLocaleString()}/hr
                  </TableCell>
                  <TableCell>
                    {profile.dailyRate
                      ? `$${parseFloat(profile.dailyRate).toLocaleString()}/day`
                      : "-"
                    }
                  </TableCell>
                  <TableCell>
                    {profile.weeklyRate
                      ? `$${parseFloat(profile.weeklyRate).toLocaleString()}/wk`
                      : "-"
                    }
                  </TableCell>
                  <TableCell>
                    {profile.fuelCostPerHour
                      ? `$${parseFloat(profile.fuelCostPerHour).toLocaleString()}`
                      : "-"
                    }
                  </TableCell>
                  <TableCell>
                    {format(new Date(profile.effectiveDate), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEditRate(profile)}
                          data-testid={`button-edit-rate-${profile.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        {!profile.isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onActivateRate(profile.id)}
                            disabled={isActivating}
                            data-testid={`button-activate-rate-${profile.id}`}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
