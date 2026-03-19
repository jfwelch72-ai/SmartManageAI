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
import { ClipboardList, Plus, CheckCircle2, Circle, X } from "lucide-react";
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";

interface HiringTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  hiringCandidateId: string | null;
  hiringJobId: string | null;
  assignedToId: string | null;
  assignedToFirstName: string | null;
  assignedToLastName: string | null;
  createdAt: string;
}

interface HiringCandidate {
  id: string;
  fullName: string;
}

interface HiringJob {
  id: string;
  title: string;
}

interface OrgUser {
  id: string;
  firstName: string;
  lastName: string;
}

const TASKS_QK = ["/api/tasks", "HIRING"] as const;

function useHiringTasksList(filters: {
  status?: string;
  candidateId?: string;
  jobId?: string;
  assignedToId?: string;
}) {
  const params = new URLSearchParams({ context: "HIRING" });
  if (filters.status && filters.status !== "__all__") params.set("status", filters.status.toUpperCase());
  if (filters.candidateId && filters.candidateId !== "__all__") params.set("hiringCandidateId", filters.candidateId);
  if (filters.jobId && filters.jobId !== "__all__") params.set("hiringJobId", filters.jobId);
  if (filters.assignedToId && filters.assignedToId !== "__all__") params.set("assignedToId", filters.assignedToId);
  return useQuery<HiringTask[]>({
    queryKey: [...TASKS_QK, filters.status ?? "__all__", filters.candidateId ?? "__all__", filters.jobId ?? "__all__", filters.assignedToId ?? "__all__"],
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

const SENTINEL = "__none__";
const ALL = "__all__";

export default function HiringTasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const canEdit = ["ADMIN", "HUSTLER", "HR_MANAGER", "MANAGER", "OFFICE_MANAGER"].includes(role ?? "");
  const canCreate = ["ADMIN", "HUSTLER", "HR_MANAGER", "MANAGER"].includes(role ?? "");

  const [showDialog, setShowDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newCandidateId, setNewCandidateId] = useState(SENTINEL);
  const [newJobId, setNewJobId] = useState(SENTINEL);
  const [newAssigneeId, setNewAssigneeId] = useState(SENTINEL);

  const [statusFilter, setStatusFilter] = useState(ALL);
  const [candidateFilter, setCandidateFilter] = useState(ALL);
  const [jobFilter, setJobFilter] = useState(ALL);
  const [assigneeFilter, setAssigneeFilter] = useState(ALL);
  const [dueDateFromFilter, setDueDateFromFilter] = useState("");
  const [dueDateToFilter, setDueDateToFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState(ALL);

  const { data: allTasks = [], isLoading } = useHiringTasksList({
    status: statusFilter,
    candidateId: candidateFilter,
    jobId: jobFilter,
    assignedToId: assigneeFilter,
  });

  const { data: candidates = [] } = useQuery<HiringCandidate[]>({
    queryKey: ["/api/hiring/candidates"],
    queryFn: () => apiRequest("GET", "/api/hiring/candidates").then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<HiringJob[]>({
    queryKey: ["/api/hiring/jobs"],
    queryFn: () => apiRequest("GET", "/api/hiring/jobs").then((r) => r.json()),
  });

  const { data: orgUsers = [] } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
    queryFn: () => apiRequest("GET", "/api/users").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      title: string; description?: string; dueDate?: string; priority?: string;
      hiringCandidateId?: string; hiringJobId?: string; assignedToId?: string;
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

  // Apply local filters for due date and priority (can't push these server-side easily)
  const filtered = allTasks.filter((t) => {
    if (priorityFilter !== ALL && t.priority !== priorityFilter) return false;
    if (dueDateFromFilter && t.dueDate) {
      if (isBefore(parseISO(t.dueDate), startOfDay(new Date(dueDateFromFilter)))) return false;
    }
    if (dueDateToFilter && t.dueDate) {
      if (isAfter(parseISO(t.dueDate), endOfDay(new Date(dueDateToFilter)))) return false;
    }
    if (dueDateFromFilter && !t.dueDate) return false;
    return true;
  });

  const pending = allTasks.filter((t) => t.status !== "COMPLETED").length;
  const done = allTasks.filter((t) => t.status === "COMPLETED").length;

  const hasActiveFilters = statusFilter !== ALL || candidateFilter !== ALL || jobFilter !== ALL
    || assigneeFilter !== ALL || priorityFilter !== ALL || !!dueDateFromFilter || !!dueDateToFilter;

  const resetDialog = () => {
    setNewTitle("");
    setNewDescription("");
    setNewDue("");
    setNewPriority("MEDIUM");
    setNewCandidateId(SENTINEL);
    setNewJobId(SENTINEL);
    setNewAssigneeId(SENTINEL);
  };

  const clearFilters = () => {
    setStatusFilter(ALL);
    setCandidateFilter(ALL);
    setJobFilter(ALL);
    setAssigneeFilter(ALL);
    setPriorityFilter(ALL);
    setDueDateFromFilter("");
    setDueDateToFilter("");
  };

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    createMutation.mutate(
      {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        dueDate: newDue ? new Date(newDue).toISOString() : undefined,
        priority: newPriority,
        hiringCandidateId: newCandidateId !== SENTINEL ? newCandidateId : undefined,
        hiringJobId: newJobId !== SENTINEL ? newJobId : undefined,
        assignedToId: newAssigneeId !== SENTINEL ? newAssigneeId : undefined,
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
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
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
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Status */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-sm" data-testid="filter-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          {/* Candidate */}
          <Select value={candidateFilter} onValueChange={setCandidateFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="filter-candidate">
              <SelectValue placeholder="All candidates" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All candidates</SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Job / Role */}
          <Select value={jobFilter} onValueChange={setJobFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="filter-job">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Assignee */}
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="filter-assignee">
              <SelectValue placeholder="All assignees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All assignees</SelectItem>
              {orgUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Priority */}
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-8 text-sm" data-testid="filter-priority">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All priorities</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Due date range */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground">Due:</span>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={dueDateFromFilter}
              onChange={(e) => setDueDateFromFilter(e.target.value)}
              className="w-36 h-8 text-sm"
              data-testid="filter-due-from"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              type="date"
              value={dueDateToFilter}
              onChange={(e) => setDueDateToFilter(e.target.value)}
              className="w-36 h-8 text-sm"
              data-testid="filter-due-to"
            />
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              data-testid="button-clear-filters"
            >
              <X className="w-3.5 h-3.5 mr-1" />Clear filters
            </Button>
          )}
        </div>
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
                <TaskRow key={task.id} task={task} canEdit={canEdit} candidates={candidates} jobs={jobs} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Hiring Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Task Title *</Label>
              <Input
                placeholder="e.g. Review resume for electrician role"
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Link to Candidate</Label>
                <Select value={newCandidateId} onValueChange={setNewCandidateId}>
                  <SelectTrigger data-testid="select-task-candidate">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL}>None</SelectItem>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Link to Role</Label>
                <Select value={newJobId} onValueChange={setNewJobId}>
                  <SelectTrigger data-testid="select-task-job">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL}>None</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Assign To</Label>
                <Select value={newAssigneeId} onValueChange={setNewAssigneeId}>
                  <SelectTrigger data-testid="select-task-assignee">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL}>Unassigned</SelectItem>
                    {orgUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
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

function TaskRow({
  task, canEdit, candidates, jobs,
}: {
  task: HiringTask;
  canEdit: boolean;
  candidates: HiringCandidate[];
  jobs: HiringJob[];
}) {
  const { toast } = useToast();
  const isDone = task.status === "COMPLETED";
  const toggleMutation = useToggleHiringTask(task.id, task.status);

  const candidateName = task.hiringCandidateId
    ? candidates.find((c) => c.id === task.hiringCandidateId)?.fullName ?? "Candidate"
    : null;

  const jobName = task.hiringJobId
    ? jobs.find((j) => j.id === task.hiringJobId)?.title ?? "Role"
    : null;

  const PRIORITY_VARIANT: Record<string, "destructive" | "outline" | "secondary" | "default"> = {
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
          {jobName && (
            <Badge variant="secondary" className="text-xs" data-testid={`badge-job-${task.id}`}>
              {jobName}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant={PRIORITY_VARIANT[task.priority] ?? "outline"} className="text-xs">
          {task.priority}
        </Badge>
        <Badge variant={isDone ? "secondary" : "outline"} className="text-xs">
          {isDone ? "Done" : "Pending"}
        </Badge>
      </div>
    </li>
  );
}
