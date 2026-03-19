import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Plus, CheckCircle2, Circle } from "lucide-react";
import { useHiringTasks, useCreateHiringTask, useUpdateHiringTask } from "@/lib/hiring-api";
import { format } from "date-fns";

interface HiringTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  candidateId: string | null;
  createdAt: string;
}

export default function HiringTasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const canEdit = role === "ADMIN" || role === "HUSTLER" || role === "HR_MANAGER" || role === "MANAGER" || role === "OFFICE_MANAGER";
  const canCreate = role === "ADMIN" || role === "HUSTLER" || role === "HR_MANAGER";

  const [showDialog, setShowDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");

  const { data: tasks = [], isLoading } = useHiringTasks();
  const createMutation = useCreateHiringTask();

  const filtered = (tasks as HiringTask[]).filter((t) => {
    if (filter === "pending") return t.status !== "completed";
    if (filter === "completed") return t.status === "completed";
    return true;
  });

  const pending = (tasks as HiringTask[]).filter((t) => t.status !== "completed").length;
  const done = (tasks as HiringTask[]).filter((t) => t.status === "completed").length;

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

      <div className="flex gap-2">
        {(["all", "pending", "completed"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            data-testid={`filter-${f}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />All Tasks
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
                <TaskRow key={task.id} task={task} canEdit={canEdit} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Hiring Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Task Title</Label>
              <Input
                placeholder="e.g. Review applications for plumber role"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                data-testid="input-task-title"
              />
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
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!newTitle.trim()) return;
                createMutation.mutate(
                  { title: newTitle.trim(), dueDate: newDue ? new Date(newDue).toISOString() : undefined },
                  {
                    onSuccess: () => {
                      toast({ title: "Task created" });
                      setShowDialog(false);
                      setNewTitle("");
                      setNewDue("");
                    },
                    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                  }
                );
              }}
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

function TaskRow({ task, canEdit }: { task: HiringTask; canEdit: boolean }) {
  const { toast } = useToast();
  const isDone = task.status === "completed";
  const updateMutation = useUpdateHiringTask(task.id);

  return (
    <li
      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/40 transition-colors"
      data-testid={`task-row-${task.id}`}
    >
      <button
        type="button"
        onClick={() => {
          if (!canEdit) return;
          updateMutation.mutate(
            { status: isDone ? "pending" : "completed" },
            { onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }) }
          );
        }}
        className="mt-0.5 shrink-0 hover:opacity-70 transition-opacity"
        disabled={!canEdit || updateMutation.isPending}
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
        <div className="flex items-center gap-2 mt-0.5">
          {task.dueDate && (
            <span className="text-xs text-muted-foreground">
              Due {format(new Date(task.dueDate), "MMM d, yyyy")}
            </span>
          )}
          {task.candidateId && (
            <Badge variant="outline" className="text-xs">Linked to candidate</Badge>
          )}
        </div>
      </div>
      <Badge variant={isDone ? "secondary" : "outline"} className="text-xs shrink-0">
        {isDone ? "Done" : "Pending"}
      </Badge>
    </li>
  );
}
