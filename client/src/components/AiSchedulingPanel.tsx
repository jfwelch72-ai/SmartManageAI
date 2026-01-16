import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Calendar as CalendarIcon,
  Clock,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Play,
  Pause,
  Flag,
  Users,
  Zap,
  RefreshCw
} from "lucide-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, addDays, differenceInDays, parseISO, isAfter, isBefore, isToday } from "date-fns";

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
  notes?: string;
  sortOrder: number;
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
}

interface AiSchedulingPanelProps {
  projectId: string;
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

export default function AiSchedulingPanel({ projectId, projectName, tradeType }: AiSchedulingPanelProps) {
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<ScheduleTask | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  
  const { toast } = useToast();

  interface ScheduleResponse {
    schedule: ProjectSchedule | null;
    tasks: ScheduleTask[];
  }

  const { data: scheduleData, isLoading, refetch } = useQuery<ScheduleResponse>({
    queryKey: ["/api/ai-features/schedule", projectId],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-features/schedule/generate", {
        projectId,
        startDate,
        workingDays,
        tradeType,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/schedule", projectId] });
      setGenerateDialogOpen(false);
      toast({
        title: "Schedule Generated",
        description: `AI created ${data.proposedSchedule.tasks.length} tasks for your ${tradeType || "project"}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate schedule",
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: string; updates: Partial<ScheduleTask> }) => {
      const response = await apiRequest("PATCH", `/api/ai-features/schedule/tasks/${taskId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/schedule", projectId] });
      setTaskDialogOpen(false);
      toast({
        title: "Task Updated",
        description: "Schedule has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const toggleWorkingDay = (day: number) => {
    setWorkingDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleGenerateSchedule = () => {
    generateMutation.mutate();
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

  const schedule = scheduleData?.schedule;
  const tasks = scheduleData?.tasks || [];
  const criticalPathTasks = tasks.filter(t => t.isCriticalPath);
  const completedTasks = tasks.filter(t => t.status === "COMPLETE");
  const delayedTasks = tasks.filter(t => t.status === "DELAYED");
  const overallProgress = tasks.length > 0 
    ? Math.round(tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / tasks.length)
    : 0;

  const getTaskBarStyle = (task: ScheduleTask) => {
    const startDate = parseISO(task.plannedStartDate);
    const scheduleStart = schedule?.baselineStartDate ? parseISO(schedule.baselineStartDate) : new Date();
    const scheduleEnd = schedule?.baselineEndDate ? parseISO(schedule.baselineEndDate) : addDays(new Date(), 30);
    const totalDays = differenceInDays(scheduleEnd, scheduleStart) || 1;
    
    const taskStart = differenceInDays(startDate, scheduleStart);
    const leftPercent = (taskStart / totalDays) * 100;
    const widthPercent = (task.durationDays / totalDays) * 100;
    
    return {
      left: `${Math.max(0, leftPercent)}%`,
      width: `${Math.min(100 - leftPercent, widthPercent)}%`,
    };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Project Schedule</h2>
          <p className="text-muted-foreground">
            {schedule ? `Generated by ${schedule.generatedBy}` : "No schedule yet"}
          </p>
        </div>
        <div className="flex gap-2">
          {schedule && (
            <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-schedule">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          )}
          <Button onClick={() => setGenerateDialogOpen(true)} data-testid="button-generate-schedule">
            <Sparkles className="w-4 h-4 mr-2" />
            {schedule ? "Regenerate" : "Generate with AI"}
          </Button>
        </div>
      </div>

      {schedule && tasks.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <CalendarIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="text-2xl font-bold">
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
                    <p className="text-2xl font-bold">{overallProgress}%</p>
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
                    <p className="text-2xl font-bold">{criticalPathTasks.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Delayed</p>
                    <p className="text-2xl font-bold">{delayedTasks.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5" />
                Gantt Chart
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center text-xs text-muted-foreground mb-2">
                  <div className="w-64 shrink-0 font-medium">Task</div>
                  <div className="flex-1 flex justify-between px-2">
                    <span>{schedule.baselineStartDate && format(parseISO(schedule.baselineStartDate), "MMM d")}</span>
                    <span>{schedule.baselineEndDate && format(parseISO(schedule.baselineEndDate), "MMM d")}</span>
                  </div>
                </div>
                <Separator />
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1 py-2">
                    {tasks.map((task, index) => {
                      const StatusIcon = STATUS_CONFIG[task.status].icon;
                      const barStyle = getTaskBarStyle(task);
                      
                      return (
                        <div 
                          key={task.id}
                          className="flex items-center hover-elevate rounded cursor-pointer py-2"
                          onClick={() => handleTaskClick(task)}
                          data-testid={`task-row-${task.id}`}
                        >
                          <div className="w-64 shrink-0 flex items-center gap-2 pr-4">
                            <StatusIcon className={cn("w-4 h-4", STATUS_CONFIG[task.status].color.split(" ")[1])} />
                            <span className="text-sm truncate">{task.name}</span>
                            {task.isCriticalPath && (
                              <Badge variant="destructive" className="text-xs">Critical</Badge>
                            )}
                          </div>
                          <div className="flex-1 relative h-8 bg-muted rounded">
                            <div
                              className={cn(
                                "absolute h-full rounded",
                                task.isCriticalPath ? "bg-red-400" : "bg-primary/60",
                                task.status === "COMPLETE" && "bg-green-400",
                                task.status === "DELAYED" && "bg-yellow-400"
                              )}
                              style={barStyle}
                            >
                              {task.percentComplete > 0 && task.percentComplete < 100 && (
                                <div 
                                  className="h-full bg-primary rounded"
                                  style={{ width: `${task.percentComplete}%` }}
                                />
                              )}
                            </div>
                            <div 
                              className="absolute inset-0 flex items-center justify-center text-xs font-medium"
                              style={barStyle}
                            >
                              {task.durationDays}d
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Flag className="w-5 h-5 text-red-500" />
                  Critical Path Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {criticalPathTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No critical path tasks identified
                    </p>
                  ) : (
                    criticalPathTasks.map((task) => (
                      <div 
                        key={task.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                        onClick={() => handleTaskClick(task)}
                      >
                        <div>
                          <p className="font-medium">{task.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(parseISO(task.plannedStartDate), "MMM d")} - {format(parseISO(task.plannedEndDate), "MMM d")}
                          </p>
                        </div>
                        <Badge className={STATUS_CONFIG[task.status].color}>
                          {STATUS_CONFIG[task.status].label}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="w-5 h-5" />
                  Upcoming Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {tasks
                    .filter(t => t.status !== "COMPLETE" && !isBefore(parseISO(t.plannedEndDate), new Date()))
                    .slice(0, 5)
                    .map((task) => (
                      <div 
                        key={task.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                        onClick={() => handleTaskClick(task)}
                      >
                        <div>
                          <p className="font-medium">{task.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Starts {format(parseISO(task.plannedStartDate), "MMM d")}
                          </p>
                        </div>
                        <Badge variant="outline">{task.durationDays} days</Badge>
                      </div>
                    ))
                  }
                </div>
              </CardContent>
            </Card>
          </div>
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
            <DialogDescription>
              AI will create a schedule based on your {tradeType || "project"} type's typical workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                    data-testid="input-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={startDate ? parseISO(startDate) : undefined}
                    onSelect={(date) => setStartDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Working Days</Label>
              <div className="flex gap-2 mt-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                  <Button
                    key={day}
                    variant={workingDays.includes(index) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleWorkingDay(index)}
                    data-testid={`button-day-${day.toLowerCase()}`}
                  >
                    {day}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateSchedule} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedTask?.name}</DialogTitle>
            <DialogDescription>
              Update task status and progress
            </DialogDescription>
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
              <Separator />
              <div>
                <Label>Status</Label>
                <Select
                  value={selectedTask.status}
                  onValueChange={(v: ScheduleTask["status"]) => handleStatusChange(v)}
                >
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
                    updateTaskMutation.mutate({
                      taskId: selectedTask.id,
                      updates: { percentComplete: parseInt(e.target.value) }
                    });
                  }}
                  data-testid="input-progress"
                />
              </div>
              {selectedTask.isCriticalPath && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg">
                  <Flag className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-600">This task is on the critical path</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
