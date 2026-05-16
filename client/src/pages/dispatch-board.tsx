import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { hasDispatchAccess, type FeaturePerms } from "@/lib/rbac";
import { useDashboardCustomizationSafe } from "@/hooks/use-dashboard-customization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Users,
  AlertTriangle,
  UserX,
  GripVertical,
  Loader2,
  ClipboardList,
} from "lucide-react";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
  isWithinInterval,
  isWeekend,
  startOfDay,
} from "date-fns";

type ViewMode = "day" | "week" | "2week";

interface DispatchCrew {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  lead: { id: string; firstName: string; lastName: string } | null;
}

interface DispatchAssignment {
  assignment: {
    id: string;
    crewId: string;
    projectId: string;
    startDate: string | null;
    endDate: string | null;
    assignedById: string;
    notes: string | null;
    createdAt: string;
  };
  crew: { id: string; name: string } | null;
  project: { id: string; code: string | null; name: string; status: string } | null;
}

interface ScheduleTask {
  id: string;
  name: string;
  crewId: string | null;
  crewIds: string[] | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  status: string;
  percentComplete: number;
  projectId: string;
  projectName: string;
  projectCode: string | null;
}

interface DispatchProject {
  id: string;
  code: string | null;
  name: string;
  status: string;
}

interface DispatchData {
  crews: DispatchCrew[];
  assignments: DispatchAssignment[];
  projects: DispatchProject[];
  scheduleTasks: ScheduleTask[];
}

interface AssignmentUpdatePayload {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  notes?: string | null;
}

const PROJECT_COLORS = [
  "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700",
  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700",
  "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700",
  "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border-purple-300 dark:border-purple-700",
  "bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700",
  "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-200 border-cyan-300 dark:border-cyan-700",
  "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-700",
  "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700",
];

function getProjectColor(projectId: string, projectColorMap: Map<string, string>): string {
  if (!projectColorMap.has(projectId)) {
    projectColorMap.set(projectId, PROJECT_COLORS[projectColorMap.size % PROJECT_COLORS.length]);
  }
  return projectColorMap.get(projectId)!;
}

export default function DispatchBoardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dragData, setDragData] = useState<{ assignmentId: string; crewId: string; projectId: string } | null>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignDialogData, setAssignDialogData] = useState<{
    crewId: string;
    date: Date;
    existingAssignment?: DispatchAssignment;
  } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const { permissions: featurePerms } = useDashboardCustomizationSafe();
  const perms: FeaturePerms | undefined = featurePerms;
  const canModify = hasDispatchAccess(user?.role, perms);

  const dateRange = useMemo(() => {
    if (viewMode === "day") {
      return {
        start: startOfDay(currentDate),
        end: startOfDay(currentDate),
      };
    }
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    if (viewMode === "2week") {
      return {
        start: weekStart,
        end: endOfWeek(addWeeks(weekStart, 1), { weekStartsOn: 1 }),
      };
    }
    return {
      start: weekStart,
      end: endOfWeek(weekStart, { weekStartsOn: 1 }),
    };
  }, [currentDate, viewMode]);

  const days = useMemo(() => eachDayOfInterval({ start: dateRange.start, end: dateRange.end }), [dateRange]);

  const queryStartDate = format(dateRange.start, "yyyy-MM-dd");
  const queryEndDate = format(dateRange.end, "yyyy-MM-dd");

  const { data, isLoading } = useQuery<DispatchData>({
    queryKey: ["/api/dispatch/assignments", queryStartDate, queryEndDate],
    queryFn: async () => {
      const res = await fetch(`/api/dispatch/assignments?startDate=${queryStartDate}&endDate=${queryEndDate}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch dispatch data");
      return res.json();
    },
  });

  const crews = data?.crews ?? [];
  const assignments = data?.assignments ?? [];
  const projects = data?.projects ?? [];
  const scheduleTasks = data?.scheduleTasks ?? [];

  const projectColorMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => getProjectColor(p.id, map));
    return map;
  }, [projects]);

  const getAssignmentsForCrewDay = useCallback(
    (crewId: string, day: Date): DispatchAssignment[] => {
      return assignments.filter((a) => {
        if (a.assignment.crewId !== crewId) return false;
        const start = a.assignment.startDate ? new Date(a.assignment.startDate) : null;
        const end = a.assignment.endDate ? new Date(a.assignment.endDate) : null;
        if (!start && !end) return true;
        if (start && !end) return day >= startOfDay(start);
        if (!start && end) return day <= startOfDay(end);
        return isWithinInterval(day, { start: startOfDay(start!), end: startOfDay(end!) }) || isSameDay(day, start!) || isSameDay(day, end!);
      });
    },
    [assignments]
  );

  const getTasksForCrewDay = useCallback(
    (crewId: string, day: Date): ScheduleTask[] => {
      return scheduleTasks.filter((t) => {
        const isCrewMatch = t.crewId === crewId || (t.crewIds && t.crewIds.includes(crewId));
        if (!isCrewMatch) return false;
        const start = t.plannedStartDate ? new Date(t.plannedStartDate) : null;
        const end = t.plannedEndDate ? new Date(t.plannedEndDate) : null;
        if (!start && !end) return true;
        if (start && !end) return day >= startOfDay(start);
        if (!start && end) return day <= startOfDay(end);
        return isWithinInterval(day, { start: startOfDay(start!), end: startOfDay(end!) }) || isSameDay(day, start!) || isSameDay(day, end!);
      });
    },
    [scheduleTasks]
  );

  const conflictMap = useMemo(() => {
    const map = new Map<string, boolean>();
    crews.forEach((crew) => {
      days.forEach((day) => {
        const dayAssignments = getAssignmentsForCrewDay(crew.id, day);
        const dayTasks = getTasksForCrewDay(crew.id, day);
        if (dayAssignments.length + dayTasks.length > 1) {
          const key = `${crew.id}-${format(day, "yyyy-MM-dd")}`;
          map.set(key, true);
        }
      });
    });
    return map;
  }, [crews, days, getAssignmentsForCrewDay, getTasksForCrewDay]);

  const unassignedCrews = useMemo(() => {
    return crews.filter((crew) => {
      return days.every((day) => getAssignmentsForCrewDay(crew.id, day).length === 0 && getTasksForCrewDay(crew.id, day).length === 0);
    });
  }, [crews, days, getAssignmentsForCrewDay, getTasksForCrewDay]);

  const crewCapacity = useMemo(() => {
    const totalSlots = crews.length * days.length;
    if (totalSlots === 0) return 0;
    let filledSlots = 0;
    crews.forEach((crew) => {
      days.forEach((day) => {
        if (getAssignmentsForCrewDay(crew.id, day).length > 0 || getTasksForCrewDay(crew.id, day).length > 0) {
          filledSlots++;
        }
      });
    });
    return Math.round((filledSlots / totalSlots) * 100);
  }, [crews, days, getAssignmentsForCrewDay, getTasksForCrewDay]);

  const createAssignmentMutation = useMutation({
    mutationFn: async (payload: { crewId: string; projectId: string; startDate: string; endDate: string; notes?: string }) => {
      return apiRequest("POST", "/api/crew-assignments", {
        ...payload,
        allowOverlap: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/assignments"] });
      toast({ title: "Assignment created", description: "Crew has been assigned successfully" });
      closeAssignDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create assignment", variant: "destructive" });
    },
  });

  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ id, data: payload }: { id: string; data: AssignmentUpdatePayload }) => {
      return apiRequest("PUT", `/api/dispatch/assignments/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/assignments"] });
      toast({ title: "Assignment updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update assignment", variant: "destructive" });
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crew-assignments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/assignments"] });
      toast({ title: "Assignment removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove assignment", variant: "destructive" });
    },
  });

  const navigateDate = (direction: "prev" | "next" | "today") => {
    if (direction === "today") {
      setCurrentDate(new Date());
      return;
    }
    const offset = direction === "next" ? 1 : -1;
    if (viewMode === "day") {
      setCurrentDate((d) => addDays(d, offset));
    } else if (viewMode === "week") {
      setCurrentDate((d) => (offset > 0 ? addWeeks(d, 1) : subWeeks(d, 1)));
    } else {
      setCurrentDate((d) => (offset > 0 ? addWeeks(d, 2) : subWeeks(d, 2)));
    }
  };

  const closeAssignDialog = () => {
    setShowAssignDialog(false);
    setAssignDialogData(null);
    setSelectedProjectId("");
    setAssignNotes("");
  };

  const handleCellClick = (crewId: string, day: Date) => {
    if (!canModify) return;
    const existing = getAssignmentsForCrewDay(crewId, day);
    setAssignDialogData({ crewId, date: day, existingAssignment: existing[0] });
    if (existing[0]) {
      setSelectedProjectId(existing[0].assignment.projectId);
      setAssignNotes(existing[0].assignment.notes || "");
    }
    setShowAssignDialog(true);
  };

  const handleAssign = () => {
    if (!assignDialogData || !selectedProjectId) return;
    const dateStr = format(assignDialogData.date, "yyyy-MM-dd");

    if (assignDialogData.existingAssignment) {
      updateAssignmentMutation.mutate({
        id: assignDialogData.existingAssignment.assignment.id,
        data: {
          projectId: selectedProjectId,
          notes: assignNotes || null,
        },
      });
    } else {
      createAssignmentMutation.mutate({
        crewId: assignDialogData.crewId,
        projectId: selectedProjectId,
        startDate: dateStr,
        endDate: dateStr,
        notes: assignNotes || undefined,
      });
    }
    closeAssignDialog();
  };

  const handleDragStart = (e: React.DragEvent, assignment: DispatchAssignment) => {
    if (!canModify) return;
    setDragData({
      assignmentId: assignment.assignment.id,
      crewId: assignment.assignment.crewId,
      projectId: assignment.assignment.projectId,
    });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetCrewId: string, targetDay: Date) => {
    e.preventDefault();
    if (!dragData || !canModify) return;
    const dateStr = format(targetDay, "yyyy-MM-dd");

    if (dragData.crewId === targetCrewId) {
      updateAssignmentMutation.mutate({
        id: dragData.assignmentId,
        data: { startDate: dateStr, endDate: dateStr },
      });
    } else {
      deleteAssignmentMutation.mutate(dragData.assignmentId, {
        onSuccess: () => {
          createAssignmentMutation.mutate({
            crewId: targetCrewId,
            projectId: dragData.projectId,
            startDate: dateStr,
            endDate: dateStr,
          });
        },
      });
    }
    setDragData(null);
  };

  const selectedCrewName = assignDialogData
    ? crews.find((c) => c.id === assignDialogData.crewId)?.name || "Unknown Crew"
    : "";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="dispatch-board-page">
      <main className="mx-auto max-w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-dispatch-title">
              Dispatch Board
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage crew assignments across projects and tasks
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ContextualHelpButton />
            <div className="flex items-center border rounded-md">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateDate("prev")}
                data-testid="button-prev-period"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateDate("today")}
                data-testid="button-today"
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateDate("next")}
                data-testid="button-next-period"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <span className="text-sm font-medium text-foreground min-w-[180px] text-center" data-testid="text-date-range">
              {viewMode === "day"
                ? format(currentDate, "EEEE, MMM d, yyyy")
                : `${format(dateRange.start, "MMM d")} - ${format(dateRange.end, "MMM d, yyyy")}`}
            </span>

            <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <SelectTrigger className="w-[130px]" data-testid="select-view-mode">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day View</SelectItem>
                <SelectItem value="week">Week View</SelectItem>
                <SelectItem value="2week">2-Week View</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <Users className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Total Crews</p>
                <p className="text-xl font-bold" data-testid="text-total-crews">{crews.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <UserX className="w-5 h-5 text-amber-500" />
              <div>
                <p className="text-sm text-muted-foreground">Unassigned Crews</p>
                <p className="text-xl font-bold" data-testid="text-unassigned-crews">{unassignedCrews.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">Conflicts</p>
                <p className="text-xl font-bold" data-testid="text-conflicts">{conflictMap.size}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="w-5 h-5 text-emerald-500" />
                <p className="text-sm text-muted-foreground">Crew Capacity</p>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={crewCapacity} className="h-2 flex-1" data-testid="progress-crew-capacity" />
                <span className="text-sm font-bold" data-testid="text-crew-capacity">{crewCapacity}%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <TooltipProvider>
              <table className="w-full border-collapse min-w-[600px]" data-testid="dispatch-grid">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-muted/50 backdrop-blur-sm px-4 py-3 text-left text-sm font-semibold text-foreground min-w-[180px] border-r">
                      Crew
                    </th>
                    {days.map((day) => {
                      const isToday = isSameDay(day, new Date());
                      const weekend = isWeekend(day);
                      return (
                        <th
                          key={day.toISOString()}
                          className={cn(
                            "px-2 py-3 text-center text-xs font-medium min-w-[120px] border-r last:border-r-0",
                            isToday && "bg-primary/10",
                            weekend && "bg-muted/30"
                          )}
                        >
                          <div className="text-muted-foreground">{format(day, "EEE")}</div>
                          <div className={cn("text-sm", isToday && "text-primary font-bold")}>
                            {format(day, "MMM d")}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {crews.length === 0 ? (
                    <tr>
                      <td colSpan={days.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                        No active crews found. Create crews on the Crews & Skills page.
                      </td>
                    </tr>
                  ) : (
                    crews.map((crew) => {
                      const isUnassigned = unassignedCrews.some((uc) => uc.id === crew.id);
                      return (
                        <tr
                          key={crew.id}
                          className={cn(
                            "border-b last:border-b-0 hover:bg-muted/20 transition-colors",
                            isUnassigned && "bg-amber-50/50 dark:bg-amber-950/10"
                          )}
                          data-testid={`row-crew-${crew.id}`}
                        >
                          <td className="sticky left-0 z-10 bg-background backdrop-blur-sm px-4 py-2 border-r">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate" data-testid={`text-crew-name-${crew.id}`}>
                                  {crew.name}
                                </div>
                                {crew.lead && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    {crew.lead.firstName} {crew.lead.lastName}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground">
                                  {crew.memberCount} member{crew.memberCount !== 1 ? "s" : ""}
                                </div>
                              </div>
                              {isUnassigned && (
                                <Badge variant="outline" className="text-xs shrink-0 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                                  Idle
                                </Badge>
                              )}
                            </div>
                          </td>
                          {days.map((day) => {
                            const dayAssignments = getAssignmentsForCrewDay(crew.id, day);
                            const dayTasks = getTasksForCrewDay(crew.id, day);
                            const conflictKey = `${crew.id}-${format(day, "yyyy-MM-dd")}`;
                            const hasConflict = conflictMap.has(conflictKey);
                            const isToday = isSameDay(day, new Date());
                            const weekend = isWeekend(day);

                            return (
                              <td
                                key={day.toISOString()}
                                className={cn(
                                  "px-1 py-1 border-r last:border-r-0 min-h-[60px] align-top cursor-pointer transition-colors",
                                  isToday && "bg-primary/5",
                                  weekend && "bg-muted/20",
                                  hasConflict && "bg-red-50 dark:bg-red-950/20",
                                  dragData && "hover:bg-primary/10"
                                )}
                                onClick={() => handleCellClick(crew.id, day)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, crew.id, day)}
                                data-testid={`cell-${crew.id}-${format(day, "yyyy-MM-dd")}`}
                              >
                                <div className="min-h-[48px] space-y-1">
                                  {hasConflict && (
                                    <div className="flex items-center justify-center mb-1">
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <AlertTriangle className="w-3.5 h-3.5 text-red-500" data-testid={`icon-conflict-${crew.id}-${format(day, "yyyy-MM-dd")}`} />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Double-booked: {dayAssignments.length + dayTasks.length} items
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                  )}
                                  {dayAssignments.map((a) => (
                                    <div
                                      key={a.assignment.id}
                                      draggable={canModify}
                                      onDragStart={(e) => handleDragStart(e, a)}
                                      className={cn(
                                        "rounded-md px-2 py-1 text-xs font-medium border cursor-grab active:cursor-grabbing truncate",
                                        getProjectColor(a.assignment.projectId, projectColorMap)
                                      )}
                                      data-testid={`assignment-${a.assignment.id}`}
                                    >
                                      <div className="flex items-center gap-1">
                                        {canModify && <GripVertical className="w-3 h-3 shrink-0 opacity-40" />}
                                        <span className="truncate">
                                          {a.project?.code || a.project?.name || "Unknown"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                  {dayTasks.map((t) => (
                                    <Tooltip key={t.id}>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={cn(
                                            "rounded-md px-2 py-1 text-xs border border-dashed truncate",
                                            getProjectColor(t.projectId, projectColorMap),
                                            "opacity-80"
                                          )}
                                          data-testid={`task-${t.id}`}
                                        >
                                          <div className="flex items-center gap-1">
                                            <ClipboardList className="w-3 h-3 shrink-0 opacity-60" />
                                            <span className="truncate">{t.name}</span>
                                          </div>
                                          {t.percentComplete > 0 && (
                                            <div className="mt-0.5">
                                              <Progress value={t.percentComplete} className="h-1" />
                                            </div>
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[250px]">
                                        <div className="space-y-1">
                                          <p className="font-medium">{t.name}</p>
                                          <p className="text-xs">Project: {t.projectCode || t.projectName}</p>
                                          <p className="text-xs">Status: {t.status} ({t.percentComplete}%)</p>
                                          {t.plannedStartDate && t.plannedEndDate && (
                                            <p className="text-xs">{t.plannedStartDate} to {t.plannedEndDate}</p>
                                          )}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  ))}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </TooltipProvider>
          </CardContent>
        </Card>

        {projects.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" data-testid="project-legend">
            <span className="text-xs text-muted-foreground self-center mr-1">Projects:</span>
            {projects.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium border",
                  getProjectColor(p.id, projectColorMap)
                )}
                data-testid={`legend-project-${p.id}`}
              >
                {p.code || p.name}
              </div>
            ))}
          </div>
        )}

        <Dialog open={showAssignDialog} onOpenChange={(open) => !open && closeAssignDialog()}>
          <DialogContent data-testid="dialog-assign-crew">
            <DialogHeader>
              <DialogTitle>
                {assignDialogData?.existingAssignment ? "Edit Assignment" : "Assign Crew"}
              </DialogTitle>
              <DialogDescription>
                {assignDialogData?.existingAssignment
                  ? "Update the project assignment or remove it."
                  : "Assign this crew to a project for the selected date."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Crew</Label>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-assign-crew">{selectedCrewName}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Date</Label>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-assign-date">
                  {assignDialogData ? format(assignDialogData.date, "EEEE, MMM d, yyyy") : ""}
                </p>
              </div>
              <div>
                <Label htmlFor="assign-project">Project</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger data-testid="select-assign-project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code ? `${p.code} - ${p.name}` : p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="assign-notes">Notes (optional)</Label>
                <Textarea
                  id="assign-notes"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  placeholder="Assignment notes..."
                  data-testid="input-assign-notes"
                />
              </div>
              {assignDialogData?.existingAssignment && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (assignDialogData?.existingAssignment) {
                      deleteAssignmentMutation.mutate(assignDialogData.existingAssignment.assignment.id);
                      closeAssignDialog();
                    }
                  }}
                  data-testid="button-remove-assignment"
                >
                  Remove Assignment
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeAssignDialog} data-testid="button-cancel-assign">
                Cancel
              </Button>
              <Button
                onClick={handleAssign}
                disabled={!selectedProjectId || createAssignmentMutation.isPending || updateAssignmentMutation.isPending}
                data-testid="button-confirm-assign"
              >
                {createAssignmentMutation.isPending || updateAssignmentMutation.isPending
                  ? "Saving..."
                  : assignDialogData?.existingAssignment
                  ? "Update"
                  : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
