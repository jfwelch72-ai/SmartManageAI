import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Plus, CheckCircle2, Circle } from "lucide-react";
import { format } from "date-fns";

interface HiringTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  hiringCandidateId: string | null;
  assignedToId: string | null;
  assignedToFirstName: string | null;
  assignedToLastName: string | null;
  createdAt: string;
}

interface HiringCandidate {
  id: string;
  fullName: string;
  jobTitle: string | null;
}

interface HiringJob {
  id: string;
  title: string;
}

const TASKS_QK = ["/api/tasks", "HIRING"] as const;

function useHiringTasksList(filters: { status?: string; candidateId?: string }) {
  const params = new URLSearchParams({ context: "HIRING" });
  if (filters.status && filters.status !== "all") params.set("status", filters.status.toUpperCase());
  if (filters.candidateId && filters.candidateId !== "all") params.set("hiringCandidateId", filters.candidateId);
  return useQuery<HiringTask[]>({
    queryKey: [...TASKS_QK, filters.status ?? "all", filters.candidateId ?? "all"],
    queryFn: () => apiRequest("GET", `/api/tasks?${params.toString()}`).then((r) => r.json()),
  });
}

function useToggleHiringTask(taskId: string, currentStatus: string) {
  return useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/tasks/${taskId}`, {
        status: currentStatus === "COMPLETED" ? "PENDING" : "COMPLETED",
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_QK });
    },
  });
}

export default function HiringTasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const canEdit = role === "ADMIN" || role === "HUSTLER" || role === "HR_MANAGER" || role === "MANAGER" || role === "OFFICE_MANAGER";
  const canCreate = role === "ADMIN" || role === "HUSTLER" || role === "HR_MANAGER" || role === "MANAGER";

  const [showDialog, setShowDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newCandidateId, setNewCandidateId] = useState("none");
  const [newJobId, setNewJobId] = useState("none");

  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "completed">("all");
  const [candidateFilter, setCandidateFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data: allTasks = [], isLoading } = useHiringTasksList({
    status: statusFilter,
    candidateId: candidateFilter,
  });

  const { data: candidates = [] } = useQuery<HiringCandidate[]>({
    queryKey: ["/api/hiring/candidates"],
    queryFn: () => apiRequest("GET", "/api/hiring/candidates").then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<HiringJob[]>({
    queryKey: ["/api/hiring/jobs"],
    queryFn: () => apiRequest("GET", "/api/hiring/jobs").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      title: string; description?: string; dueDate?: string; priority?: string;
      hiringCandidateId?: string; hiringJobId?: string;
    }) =>
      apiRequest("POST", "/api/tasks", {
        ...data,
        context: "HIRING",
        sourceType: "MANUAL",
        status: "PENDING",
        priority: data.priority ?? "MEDIUM",
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_QK });
    },
  });

  const filtered = allTasks.filter((t) => {
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    return true;
  });

  const pending = allTasks.filter((t) => t.status !== "COMPLETED").length;
  const done = allTasks.filter((t) => t.status === "COMPLETED").length;

  const resetDialog = () => {
    setNewTitle("");
    setNewDescription("");
    setNewDue("");
    setNewPriority("MEDIUM");
    setNewCandidateId("none");
    setNewJobId("none");
  };

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    createMutation.mutate(
      {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        dueDate: newDue ? new Date(newDue).toISOString() : undefined,
        priority: newPriority,
        hiringCandidateId: newCandidateId !== "none" ? newCandidateId : undefined,
        hiringJobId: newJobId !== "none" ? newJobId : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Task created" });
          setShowDialog(false);
          resetDialog();
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hiring Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pending} pending · {done} completed
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowDialog(true)} data-testid="button-add-task">
            <Plus className="w-4 h-4 mr-1" />Add Task
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {(["all", "pending", "completed"] as const).map((f) => (
            <Button
              key={f}
              variant={statusFilter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(f)}
              data-testid={`filter-status-${f}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>

        <Select value={candidateFilter} onValueChange={setCandidateFilter}>
          <SelectTrigger className="w-44 h-8 text-sm" data-testid="filter-candidate">
            <SelectValue placeholder="All candidates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All candidates</SelectItem>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="filter-priority">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </SelectContent>
        </Select>

        {(candidateFilter !== "all" || priorityFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setCandidateFilter("all"); setPriorityFilter("all"); }}
            data-testid="button-clear-filters"
          >
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            {filtered.length} Task{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks found.</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((task) => (
                <TaskRow key={task.id} task={task} canEdit={canEdit} candidates={candidates} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Hiring Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Task Title *</Label>
              <Input
                placeholder="e.g. Review resume for plumber role"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                data-testid="input-task-title"
              />
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Additional details..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                data-testid="input-task-description"
              />
            </div>
            <div className="space-y-1">
              <Label>Link to Candidate (optional)</Label>
              <Select value={newCandidateId} onValueChange={setNewCandidateId}>
                <SelectTrigger data-testid="select-task-candidate">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Link to Job (optional)</Label>
              <Select value={newJobId} onValueChange={setNewJobId}>
                <SelectTrigger data-testid="select-task-job">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={newPriority} onValueChange={setNewPriority}>
                <SelectTrigger data-testid="select-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Due Date (optional)</Label>
              <Input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                data-testid="input-task-due"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); resetDialog(); }}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newTitle.trim() || createMutation.isPending}
              data-testid="button-save-task"
            >
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({ task, canEdit, candidates }: { task: HiringTask; canEdit: boolean; candidates: HiringCandidate[] }) {
  const { toast } = useToast();
  const isDone = task.status === "COMPLETED";
  const toggleMutation = useToggleHiringTask(task.id, task.status);

  const candidateName = task.hiringCandidateId
    ? candidates.find((c) => c.id === task.hiringCandidateId)?.fullName ?? "Linked candidate"
    : null;

  const priorityColors: Record<string, string> = {
    CRITICAL: "destructive",
    HIGH: "outline",
    MEDIUM: "secondary",
    LOW: "secondary",
  };

  return (
    <li
      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/40 transition-colors"
      data-testid={`task-row-${task.id}`}
    >
      <button
        type="button"
        onClick={() => {
          if (!canEdit) return;
          toggleMutation.mutate(undefined, {
            onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
          });
        }}
        className="mt-0.5 shrink-0 hover:opacity-70 transition-opacity"
        disabled={!canEdit || toggleMutation.isPending}
        data-testid={`button-toggle-task-${task.id}`}
      >
        {isDone
          ? <CheckCircle2 className="w-5 h-5 text-green-600" />
          : <Circle className="w-5 h-5 text-muted-foreground" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-muted-foreground truncate">{task.description}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.dueDate && (
            <span className="text-xs text-muted-foreground">
              Due {format(new Date(task.dueDate), "MMM d, yyyy")}
            </span>
          )}
          {task.assignedToId && (
            <span className="text-xs text-muted-foreground">
              {[task.assignedToFirstName, task.assignedToLastName].filter(Boolean).join(" ") || "Assigned"}
            </span>
          )}
          {candidateName && (
            <Badge variant="outline" className="text-xs" data-testid={`badge-candidate-${task.id}`}>
              {candidateName}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant={(priorityColors[task.priority] ?? "outline") as "destructive" | "outline" | "secondary" | "default"} className="text-xs">
          {task.priority}
        </Badge>
        <Badge variant={isDone ? "secondary" : "outline"} className="text-xs">
          {isDone ? "Done" : "Pending"}
        </Badge>
      </div>
    </li>
  );
}
