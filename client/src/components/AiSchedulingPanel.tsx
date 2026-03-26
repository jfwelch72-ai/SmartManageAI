import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  Clock,
  AlertTriangle,
  Play,
  Pause,
  Flag,
  Users,
  Zap,
  RefreshCw,
  Lock,
  Unlock,
  TrendingUp,
  BarChart3,
  ArrowRight,
  Link2,
  Target,
} from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, differenceInDays, parseISO } from "date-fns";

interface ScheduleTask {
  id: string;
  name: string;
  tradeType: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  durationDays: number;
  dependencies: string[];
  isCriticalPath: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "DELAYED" | "ON_HOLD";
  percentComplete: number;
  crewId?: string;
  crewIds?: string[];
  sortOrder: number;
  earlyStart?: string;
  earlyFinish?: string;
  lateStart?: string;
  lateFinish?: string;
  totalFloat?: number;
  freeFloat?: number;
  baselineStartDate?: string;
  baselineEndDate?: string;
}

interface ProjectSchedule {
  id: string;
  name: string;
  generatedBy: string;
  baselineStartDate: string;
  baselineEndDate?: string;
  workingDays: number[];
  isActive: boolean;
  createdAt: string;
  baselineLocked?: boolean;
  baselineLockedAt?: string;
  projectedCompletionDate?: string;
  spiValue?: string;
}

interface ForecastData {
  forecast: {
    projectedCompletionDate: string | null;
    spiValue: number | null;
    baselineEndDate: string | null;
    baselineVarianceDays: number | null;
    overallProgress: number;
    criticalPathDaysRemaining: number;
    baselineLocked: boolean;
  } | null;
  snapshots: Array<{
    snapshotDate: string;
    projectedCompletionDate: string;
    spiValue: string;
    overallProgress: number;
  }>;
}

interface ResourceData {
  allocations: Array<{
    crewId: string;
    crewName: string;
    taskId: string;
    taskName: string;
    startDate: string;
    endDate: string;
  }>;
  overAllocations: Array<{
    crewId: string;
    crewName: string;
    date: string;
    tasks: string[];
  }>;
  crews: Array<{ id: string; name: string }>;
}

interface AiSchedulingPanelProps {
  projectId: string;
  projectCode: string;
  projectName: string;
  tradeType?: string;
}

const STATUS_CONFIG = {
  NOT_STARTED: { color: "bg-gray-100 text-gray-600", icon: Clock, label: "Not Started" },
  IN_PROGRESS: { color: "bg-blue-100 text-blue-600", icon: Play, label: "In Progress" },
  COMPLETE: { color: "bg-green-100 text-green-600", icon: CheckCircle2, label: "Complete" },
  DELAYED: { color: "bg-red-100 text-red-600", icon: AlertTriangle, label: "Delayed" },
  ON_HOLD: { color: "bg-yellow-100 text-yellow-600", icon: Pause, label: "On Hold" },
};

export default function AiSchedulingPanel({ projectId, projectCode, projectName, tradeType }: AiSchedulingPanelProps) {
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selectedTask, setSelectedTask] = useState<ScheduleTask | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [depDialogOpen, setDepDialogOpen] = useState(false);
  const [depTask, setDepTask] = useState<ScheduleTask | null>(null);
  const [depSelected, setDepSelected] = useState<string[]>([]);
  const [activeSubTab, setActiveSubTab] = useState("gantt");

  const { toast } = useToast();

  interface ScheduleResponse {
    schedule: ProjectSchedule | null;
    tasks: ScheduleTask[];
  }

  const { data: scheduleData, isLoading, refetch } = useQuery<ScheduleResponse>({
    queryKey: ["/api/projects", projectCode, "schedule"],
  });

  const { data: forecastData } = useQuery<ForecastData>({
    queryKey: ["/api/projects", projectCode, "schedule", "forecast"],
    enabled: !!scheduleData?.schedule,
  });

  const { data: resourceData } = useQuery<ResourceData>({
    queryKey: ["/api/projects", projectCode, "schedule", "resource-loading"],
    enabled: !!scheduleData?.schedule,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/ai-schedule`, { startDate });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      setGenerateDialogOpen(false);
      toast({ title: "Schedule Generated", description: `AI created ${data.tasks?.length || 0} tasks` });
    },
    onError: (error: any) => {
      toast({ title: "Generation Failed", description: error.message || "Failed to generate schedule", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: string; updates: Partial<ScheduleTask> }) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectCode}/schedule/tasks/${taskId}`, updates);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      setTaskDialogOpen(false);
      toast({ title: "Task Updated", description: "Schedule recalculated with CPM engine" });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message || "Failed to update task", variant: "destructive" });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/recalculate`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      toast({ title: "Schedule Recalculated", description: "CPM engine updated all dates and critical path" });
    },
    onError: (error: any) => {
      toast({ title: "Recalculation Failed", description: error.message, variant: "destructive" });
    },
  });

  const lockBaselineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/lock-baseline`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      toast({ title: "Baseline Locked", description: "Current schedule dates saved as baseline" });
    },
  });

  const unlockBaselineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/unlock-baseline`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      toast({ title: "Baseline Unlocked" });
    },
  });

  const updateDepsMutation = useMutation({
    mutationFn: async ({ taskId, dependencies }: { taskId: string; dependencies: string[] }) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectCode}/schedule/tasks/${taskId}/dependencies`, { dependencies });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      setDepDialogOpen(false);
      toast({ title: "Dependencies Updated", description: "Schedule recalculated" });
    },
  });

  const toggleWorkingDay = (day: number) => {
    setWorkingDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleTaskClick = (task: ScheduleTask) => {
    setSelectedTask(task);
    setTaskDialogOpen(true);
  };

  const handleStatusChange = (status: ScheduleTask["status"]) => {
    if (!selectedTask) return;
    const updates: Partial<ScheduleTask> = { status };
    if (status === "IN_PROGRESS" && !selectedTask.actualStartDate) {
      updates.actualStartDate = format(new Date(), "yyyy-MM-dd");
    }
    if (status === "COMPLETE" && !selectedTask.actualEndDate) {
      updates.actualEndDate = format(new Date(), "yyyy-MM-dd");
      updates.percentComplete = 100;
    }
    updateTaskMutation.mutate({ taskId: selectedTask.id, updates });
  };

  const openDepDialog = (task: ScheduleTask) => {
    setDepTask(task);
    setDepSelected(task.dependencies || []);
    setDepDialogOpen(true);
  };

  const schedule = scheduleData?.schedule;
  const tasks = scheduleData?.tasks || [];
  const criticalPathTasks = tasks.filter(t => t.isCriticalPath);
  const completedTasks = tasks.filter(t => t.status === "COMPLETE");
  const delayedTasks = tasks.filter(t => t.status === "DELAYED");
  const overallProgress = tasks.length > 0
    ? Math.round(tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / tasks.length)
    : 0;

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [tasks]);

  const taskMap = useMemo(() => {
    const map = new Map<string, ScheduleTask>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const getGanttRange = useCallback(() => {
    if (!schedule) return { start: new Date(), end: new Date(), totalDays: 1 };
    const allDates = tasks.flatMap(t => [t.plannedStartDate, t.plannedEndDate, t.baselineStartDate, t.baselineEndDate].filter(Boolean));
    if (schedule.baselineStartDate) allDates.push(schedule.baselineStartDate);
    if (schedule.baselineEndDate) allDates.push(schedule.baselineEndDate);
    if (schedule.projectedCompletionDate) allDates.push(schedule.projectedCompletionDate);

    const dates = allDates.map(d => new Date(d!));
    const start = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const end = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();
    const totalDays = Math.max(differenceInDays(end, start), 1);
    return { start, end, totalDays };
  }, [schedule, tasks]);

  const getBarPosition = useCallback((startStr: string, endStr: string) => {
    const { start, totalDays } = getGanttRange();
    const barStart = differenceInDays(parseISO(startStr), start);
    const barDuration = differenceInDays(parseISO(endStr), parseISO(startStr)) + 1;
    return {
      left: `${Math.max(0, (barStart / totalDays) * 100)}%`,
      width: `${Math.min(100, (barDuration / totalDays) * 100)}%`,
    };
  }, [getGanttRange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const forecast = forecastData?.forecast;
  const spiColor = forecast?.spiValue
    ? forecast.spiValue >= 1 ? "text-green-600" : forecast.spiValue >= 0.9 ? "text-yellow-600" : "text-red-600"
    : "text-muted-foreground";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Project Schedule</h2>
          <p className="text-muted-foreground text-sm">
            {schedule ? `Generated by ${schedule.generatedBy}` : "No schedule yet"}
            {schedule?.baselineLocked && <span className="ml-2 text-green-600">(Baseline Locked)</span>}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {schedule && (
            <>
              <Button variant="outline" size="sm" onClick={() => recalculateMutation.mutate()} disabled={recalculateMutation.isPending} data-testid="button-recalculate">
                <RefreshCw className={cn("w-4 h-4 mr-2", recalculateMutation.isPending && "animate-spin")} />
                Recalculate
              </Button>
              {schedule.baselineLocked ? (
                <Button variant="outline" size="sm" onClick={() => unlockBaselineMutation.mutate()} data-testid="button-unlock-baseline">
                  <Unlock className="w-4 h-4 mr-2" />
                  Unlock Baseline
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => lockBaselineMutation.mutate()} data-testid="button-lock-baseline">
                  <Lock className="w-4 h-4 mr-2" />
                  Lock Baseline
                </Button>
              )}
            </>
          )}
          <Button size="sm" onClick={() => setGenerateDialogOpen(true)} data-testid="button-generate-schedule" className="flex-1 sm:flex-none">
            <Sparkles className="w-4 h-4 mr-2" />
            {schedule ? "Regenerate" : "Generate with AI"}
          </Button>
        </div>
      </div>

      {schedule && tasks.length > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <CalendarIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="text-2xl font-bold" data-testid="text-duration">
                      {differenceInDays(parseISO(schedule.baselineEndDate || schedule.baselineStartDate), parseISO(schedule.baselineStartDate))} days
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Progress</p>
                    <p className="text-2xl font-bold" data-testid="text-progress">{overallProgress}%</p>
                  </div>
                </div>
                <Progress value={overallProgress} className="mt-3 h-2" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Flag className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Critical Path</p>
                    <p className="text-2xl font-bold" data-testid="text-critical-count">{criticalPathTasks.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", forecast?.spiValue ? (forecast.spiValue >= 1 ? "bg-green-100" : forecast.spiValue >= 0.9 ? "bg-yellow-100" : "bg-red-100") : "bg-gray-100")}>
                    <TrendingUp className={cn("w-5 h-5", spiColor)} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">SPI</p>
                    <p className={cn("text-2xl font-bold", spiColor)} data-testid="text-spi">
                      {forecast?.spiValue != null ? forecast.spiValue.toFixed(2) : "N/A"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
            <TabsList>
              <TabsTrigger value="gantt" data-testid="tab-gantt">
                <BarChart3 className="w-4 h-4 mr-1" />
                Gantt Chart
              </TabsTrigger>
              <TabsTrigger value="forecast" data-testid="tab-forecast">
                <TrendingUp className="w-4 h-4 mr-1" />
                Forecast
              </TabsTrigger>
              <TabsTrigger value="resources" data-testid="tab-resources">
                <Users className="w-4 h-4 mr-1" />
                Resources
              </TabsTrigger>
              <TabsTrigger value="critical" data-testid="tab-critical">
                <Flag className="w-4 h-4 mr-1" />
                Critical Path
              </TabsTrigger>
            </TabsList>

            <TabsContent value="gantt">
              <GanttChart
                tasks={sortedTasks}
                schedule={schedule}
                taskMap={taskMap}
                getBarPosition={getBarPosition}
                getGanttRange={getGanttRange}
                onTaskClick={handleTaskClick}
                onEditDeps={openDepDialog}
              />
            </TabsContent>

            <TabsContent value="forecast">
              <ForecastPanel forecast={forecastData} schedule={schedule} />
            </TabsContent>

            <TabsContent value="resources">
              <ResourcePanel data={resourceData} />
            </TabsContent>

            <TabsContent value="critical">
              <CriticalPathPanel tasks={criticalPathTasks} onTaskClick={handleTaskClick} />
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <CalendarIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Schedule Yet</h3>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                Generate an AI-powered schedule based on your {tradeType || "project"}'s typical workflow and production rates.
              </p>
              <Button onClick={() => setGenerateDialogOpen(true)} data-testid="button-create-schedule">
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Schedule with AI
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate AI Schedule</DialogTitle>
            <DialogDescription>AI will create a schedule based on your {tradeType || "project"} type's typical workflow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" type="button" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")} data-testid="input-start-date">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker mode="single" selected={startDate ? parseISO(startDate) : undefined} onSelect={(date) => date && setStartDate(format(date, "yyyy-MM-dd"))} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Working Days</Label>
              <div className="flex gap-2 mt-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                  <Button key={day} variant={workingDays.includes(index) ? "default" : "outline"} size="sm" onClick={() => toggleWorkingDay(index)} data-testid={`button-day-${day.toLowerCase()}`}>
                    {day}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>) : (<><Zap className="w-4 h-4 mr-2" />Generate</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedTask?.name}</DialogTitle>
            <DialogDescription>Update task status, progress, and dates</DialogDescription>
          </DialogHeader>
          {selectedTask && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Planned Start</Label>
                  <p className="font-medium">{format(parseISO(selectedTask.plannedStartDate), "MMM d, yyyy")}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Planned End</Label>
                  <p className="font-medium">{format(parseISO(selectedTask.plannedEndDate), "MMM d, yyyy")}</p>
                </div>
              </div>
              {selectedTask.baselineStartDate && selectedTask.baselineEndDate && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Baseline Start</Label>
                    <p className="font-medium text-gray-500">{format(parseISO(selectedTask.baselineStartDate), "MMM d, yyyy")}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Baseline End</Label>
                    <p className="font-medium text-gray-500">{format(parseISO(selectedTask.baselineEndDate), "MMM d, yyyy")}</p>
                  </div>
                </div>
              )}
              {(selectedTask.totalFloat != null || selectedTask.freeFloat != null) && (
                <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                  <div>
                    <Label className="text-muted-foreground text-xs">Total Float</Label>
                    <p className={cn("font-bold", selectedTask.totalFloat === 0 ? "text-red-600" : "text-green-600")} data-testid="text-total-float">{selectedTask.totalFloat ?? 0} days</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Free Float</Label>
                    <p className="font-bold" data-testid="text-free-float">{selectedTask.freeFloat ?? 0} days</p>
                  </div>
                </div>
              )}
              <Separator />
              <div>
                <Label>Status</Label>
                <Select value={selectedTask.status} onValueChange={(v: ScheduleTask["status"]) => handleStatusChange(v)}>
                  <SelectTrigger data-testid="select-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <config.icon className="w-4 h-4" />
                          {config.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Progress: {selectedTask.percentComplete}%</Label>
                <Input
                  type="range"
                  min={0}
                  max={100}
                  value={selectedTask.percentComplete}
                  onChange={(e) => {
                    updateTaskMutation.mutate({ taskId: selectedTask.id, updates: { percentComplete: parseInt(e.target.value) } });
                  }}
                  data-testid="input-progress"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Actual Start</Label>
                  <Input
                    type="date"
                    value={selectedTask.actualStartDate || ""}
                    onChange={(e) => updateTaskMutation.mutate({ taskId: selectedTask.id, updates: { actualStartDate: e.target.value || undefined } })}
                    data-testid="input-actual-start"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Actual End</Label>
                  <Input
                    type="date"
                    value={selectedTask.actualEndDate || ""}
                    onChange={(e) => updateTaskMutation.mutate({ taskId: selectedTask.id, updates: { actualEndDate: e.target.value || undefined } })}
                    data-testid="input-actual-end"
                  />
                </div>
              </div>
              {selectedTask.isCriticalPath && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg">
                  <Flag className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-600">This task is on the critical path</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setTaskDialogOpen(false); openDepDialog(selectedTask); }} data-testid="button-edit-deps">
                  <Link2 className="w-4 h-4 mr-1" />
                  Edit Dependencies
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={depDialogOpen} onOpenChange={setDepDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Dependencies: {depTask?.name}</DialogTitle>
            <DialogDescription>Select predecessor tasks (Finish-to-Start)</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2 py-2">
              {tasks.filter(t => t.id !== depTask?.id).map(t => (
                <label key={t.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={depSelected.includes(t.id)}
                    onChange={(e) => {
                      setDepSelected(prev => e.target.checked ? [...prev, t.id] : prev.filter(id => id !== t.id));
                    }}
                    data-testid={`checkbox-dep-${t.id}`}
                  />
                  <span className="text-sm">{t.name}</span>
                  {t.isCriticalPath && <Badge variant="destructive" className="text-xs">Critical</Badge>}
                </label>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => depTask && updateDepsMutation.mutate({ taskId: depTask.id, dependencies: depSelected })}
              disabled={updateDepsMutation.isPending}
              data-testid="button-save-deps"
            >
              {updateDepsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Dependencies
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GanttChart({
  tasks,
  schedule,
  taskMap,
  getBarPosition,
  getGanttRange,
  onTaskClick,
  onEditDeps,
}: {
  tasks: ScheduleTask[];
  schedule: ProjectSchedule;
  taskMap: Map<string, ScheduleTask>;
  getBarPosition: (start: string, end: string) => { left: string; width: string };
  getGanttRange: () => { start: Date; end: Date; totalDays: number };
  onTaskClick: (task: ScheduleTask) => void;
  onEditDeps: (task: ScheduleTask) => void;
}) {
  const ganttBodyRef = useRef<HTMLDivElement>(null);
  const { start: ganttStart, end: ganttEnd, totalDays } = getGanttRange();

  const depLines = useMemo(() => {
    const lines: Array<{ fromIdx: number; toIdx: number; fromLeft: number; toLeft: number }> = [];
    tasks.forEach((task, toIdx) => {
      for (const depId of (task.dependencies || [])) {
        const fromTask = taskMap.get(depId);
        if (!fromTask) continue;
        const fromIdx = tasks.findIndex(t => t.id === depId);
        if (fromIdx < 0) continue;

        const fromEnd = fromTask.plannedEndDate;
        const toStart = task.plannedStartDate;
        if (!fromEnd || !toStart) continue;

        const fromEndDay = differenceInDays(parseISO(fromEnd), ganttStart) + 1;
        const toStartDay = differenceInDays(parseISO(toStart), ganttStart);

        lines.push({
          fromIdx,
          toIdx,
          fromLeft: (fromEndDay / totalDays) * 100,
          toLeft: (toStartDay / totalDays) * 100,
        });
      }
    });
    return lines;
  }, [tasks, taskMap, ganttStart, totalDays]);

  const rowHeight = 36;
  const headerHeight = 28;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Gantt Chart
          <div className="ml-auto flex items-center gap-3 text-xs font-normal text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-400 rounded-sm inline-block" />Critical</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-primary/60 rounded-sm inline-block" />Normal</span>
            {schedule.baselineLocked && <span className="flex items-center gap-1"><span className="w-3 h-2 bg-gray-300 rounded-sm inline-block" />Baseline</span>}
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-blue-200 rounded-sm inline-block" />Float</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="hidden md:flex items-center text-xs text-muted-foreground mb-2">
            <div className="w-56 shrink-0 font-medium">Task</div>
            <div className="flex-1 flex justify-between px-2">
              <span>{format(ganttStart, "MMM d")}</span>
              <span>{format(ganttEnd, "MMM d")}</span>
            </div>
          </div>
          <Separator className="hidden md:block" />
          <ScrollArea className="h-[420px]">
            <div className="relative" style={{ minHeight: tasks.length * rowHeight + headerHeight }}>
              <svg className="absolute inset-0 w-full pointer-events-none" style={{ height: tasks.length * rowHeight + headerHeight, zIndex: 5 }}>
                {depLines.map((line, idx) => {
                  const fromY = headerHeight + line.fromIdx * rowHeight + rowHeight / 2;
                  const toY = headerHeight + line.toIdx * rowHeight + rowHeight / 2;
                  const taskAreaStart = 224;
                  const svgWidth = ganttBodyRef.current?.offsetWidth || 800;
                  const ganttWidth = svgWidth - taskAreaStart;
                  const fromX = taskAreaStart + (line.fromLeft / 100) * ganttWidth;
                  const toX = taskAreaStart + (line.toLeft / 100) * ganttWidth;
                  const midX = fromX + 8;

                  return (
                    <g key={idx}>
                      <path
                        d={`M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`}
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                      <polygon
                        points={`${toX},${toY - 3} ${toX},${toY + 3} ${toX + 5},${toY}`}
                        fill="#94a3b8"
                      />
                    </g>
                  );
                })}
              </svg>

              <div ref={ganttBodyRef} className="space-y-0">
                {tasks.map((task) => {
                  const StatusIcon = STATUS_CONFIG[task.status].icon;
                  const barStyle = getBarPosition(task.plannedStartDate, task.plannedEndDate);
                  const hasBaseline = task.baselineStartDate && task.baselineEndDate;
                  const baselineStyle = hasBaseline ? getBarPosition(task.baselineStartDate!, task.baselineEndDate!) : null;

                  const floatWidth = (task.freeFloat || 0) > 0
                    ? `${((task.freeFloat || 0) / totalDays) * 100}%`
                    : "0%";

                  const baselineVariance = hasBaseline
                    ? differenceInDays(parseISO(task.plannedEndDate), parseISO(task.baselineEndDate!))
                    : null;

                  return (
                    <div
                      key={task.id}
                      className="flex flex-col md:flex-row md:items-center hover:bg-muted/50 rounded cursor-pointer px-2 gap-1 md:gap-0"
                      style={{ height: rowHeight }}
                      onClick={() => onTaskClick(task)}
                      data-testid={`task-row-${task.id}`}
                    >
                      <div className="md:w-56 shrink-0 flex items-center gap-1.5 md:pr-2 min-w-0">
                        <StatusIcon className={cn("w-3.5 h-3.5 shrink-0", STATUS_CONFIG[task.status].color.split(" ")[1])} />
                        <span className="text-xs truncate">{task.name}</span>
                        {task.isCriticalPath && <Badge variant="destructive" className="text-[10px] px-1 py-0 shrink-0">CP</Badge>}
                        {baselineVariance != null && baselineVariance > 0 && (
                          <span className="text-[10px] text-red-500 shrink-0">+{baselineVariance}d</span>
                        )}
                      </div>
                      <div className="flex-1 relative h-7 bg-muted/30 rounded" onClick={(e) => e.stopPropagation()}>
                        {hasBaseline && baselineStyle && (
                          <div
                            className="absolute h-2 rounded bg-gray-300 opacity-60"
                            style={{ ...baselineStyle, top: 2 }}
                            title="Baseline"
                          />
                        )}
                        <div
                          className={cn(
                            "absolute rounded",
                            task.isCriticalPath ? "bg-red-400" : "bg-primary/60",
                            task.status === "COMPLETE" && "bg-green-400",
                            task.status === "DELAYED" && "bg-yellow-400",
                            hasBaseline ? "h-3 top-3" : "h-5 top-1"
                          )}
                          style={barStyle}
                          onClick={() => onTaskClick(task)}
                        >
                          {task.percentComplete > 0 && task.percentComplete < 100 && (
                            <div className="h-full bg-primary rounded" style={{ width: `${task.percentComplete}%` }} />
                          )}
                        </div>
                        {(task.freeFloat || 0) > 0 && (
                          <div
                            className="absolute h-2 bg-blue-200 rounded opacity-50"
                            style={{
                              left: `calc(${barStyle.left} + ${barStyle.width})`,
                              width: floatWidth,
                              top: hasBaseline ? 12 : 8,
                            }}
                            title={`Float: ${task.freeFloat} days`}
                          />
                        )}
                        <div
                          className="absolute inset-0 flex items-center justify-center text-[10px] font-medium pointer-events-none"
                          style={barStyle}
                        >
                          {task.durationDays}d
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastPanel({ forecast: forecastData, schedule }: { forecast?: ForecastData; schedule: ProjectSchedule }) {
  const data = forecastData?.forecast;
  const snapshots = forecastData?.snapshots || [];

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No forecast data available. Lock a baseline to enable forecasting.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Projected Completion</p>
              <p className="text-xl font-bold" data-testid="text-projected-completion">
                {data.projectedCompletionDate ? format(parseISO(data.projectedCompletionDate), "MMM d, yyyy") : "N/A"}
              </p>
              {data.baselineEndDate && (
                <p className="text-xs text-muted-foreground mt-1">
                  Baseline: {format(parseISO(data.baselineEndDate), "MMM d, yyyy")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Schedule Performance Index</p>
              <p className={cn("text-3xl font-bold", data.spiValue ? (data.spiValue >= 1 ? "text-green-600" : data.spiValue >= 0.9 ? "text-yellow-600" : "text-red-600") : "text-muted-foreground")} data-testid="text-spi-large">
                {data.spiValue != null ? data.spiValue.toFixed(2) : "N/A"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.spiValue != null ? (data.spiValue >= 1 ? "Ahead of schedule" : data.spiValue >= 0.9 ? "Slightly behind" : "Behind schedule") : "Lock baseline to calculate"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Baseline Variance</p>
              <p className={cn("text-3xl font-bold", data.baselineVarianceDays != null ? (data.baselineVarianceDays <= 0 ? "text-green-600" : data.baselineVarianceDays <= 5 ? "text-yellow-600" : "text-red-600") : "")} data-testid="text-variance">
                {data.baselineVarianceDays != null ? (data.baselineVarianceDays > 0 ? `+${data.baselineVarianceDays}` : data.baselineVarianceDays) : "N/A"} {data.baselineVarianceDays != null ? "days" : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Critical path remaining: {data.criticalPathDaysRemaining} days
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Completion Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-end gap-1 h-40 border-b">
                {snapshots.slice(-15).map((snap, idx) => {
                  const progress = snap.overallProgress || 0;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center justify-end gap-1">
                      <div
                        className={cn("w-full rounded-t", parseFloat(snap.spiValue || "0") >= 1 ? "bg-green-400" : parseFloat(snap.spiValue || "0") >= 0.9 ? "bg-yellow-400" : "bg-red-400")}
                        style={{ height: `${Math.max(progress, 2)}%` }}
                        title={`${snap.snapshotDate}: ${progress}% complete, SPI: ${snap.spiValue}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{snapshots.length > 0 ? snapshots[Math.max(0, snapshots.length - 15)]?.snapshotDate : ""}</span>
                <span>{snapshots[snapshots.length - 1]?.snapshotDate}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResourcePanel({ data }: { data?: ResourceData }) {
  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No resource data available.</p>
        </CardContent>
      </Card>
    );
  }

  const crewGroups = new Map<string, typeof data.allocations>();
  for (const alloc of data.allocations) {
    if (!crewGroups.has(alloc.crewId)) crewGroups.set(alloc.crewId, []);
    crewGroups.get(alloc.crewId)!.push(alloc);
  }

  return (
    <div className="space-y-4">
      {data.overAllocations.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Over-Allocated Crews ({data.overAllocations.length} conflicts)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.overAllocations.slice(0, 10).map((oa, idx) => (
                <div key={idx} className="text-sm">
                  <span className="font-medium text-red-700">{oa.crewName}</span>
                  <span className="text-red-600"> on {format(parseISO(oa.date), "MMM d")}: </span>
                  <span className="text-red-600">{oa.tasks.join(", ")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5" />
            Crew Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {crewGroups.size === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No crews assigned to schedule tasks</p>
          ) : (
            <div className="space-y-4">
              {Array.from(crewGroups.entries()).map(([crewId, allocs]) => (
                <div key={crewId} className="border rounded-lg p-3">
                  <p className="font-medium text-sm mb-2">{allocs[0].crewName}</p>
                  <div className="space-y-1">
                    {allocs.map((a, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{a.taskName}</span>
                        <span>{a.startDate && a.endDate ? `${format(parseISO(a.startDate), "MMM d")} - ${format(parseISO(a.endDate), "MMM d")}` : "No dates"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CriticalPathPanel({ tasks, onTaskClick }: { tasks: ScheduleTask[]; onTaskClick: (task: ScheduleTask) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Flag className="w-5 h-5 text-red-500" />
          Critical Path Chain
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No critical path tasks identified. Run CPM recalculation.</p>
        ) : (
          <div className="space-y-1">
            {tasks.map((task, idx) => (
              <div key={task.id}>
                <div
                  className="flex items-center justify-between gap-2 p-3 rounded-lg border border-red-200 bg-red-50/50 hover:bg-red-100/50 cursor-pointer dark:border-red-900 dark:bg-red-950/30"
                  onClick={() => onTaskClick(task)}
                  data-testid={`critical-task-${task.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{task.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.plannedStartDate && task.plannedEndDate ? `${format(parseISO(task.plannedStartDate), "MMM d")} - ${format(parseISO(task.plannedEndDate), "MMM d")}` : "No dates"}
                      {task.totalFloat != null && <span className="ml-2">Float: {task.totalFloat}d</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={cn(STATUS_CONFIG[task.status].color, "text-xs")}>{STATUS_CONFIG[task.status].label}</Badge>
                    <span className="text-xs font-medium">{task.durationDays}d</span>
                  </div>
                </div>
                {idx < tasks.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowRight className="w-4 h-4 text-red-400" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
