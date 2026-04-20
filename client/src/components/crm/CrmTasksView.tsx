import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrmTask } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { CheckSquare, Plus, AlertCircle, Calendar, Clock } from "lucide-react";
import { format, isPast, isToday } from "date-fns";

interface OrgUser { id: string; firstName: string | null; lastName: string | null; email: string }

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    PENDING: { variant: "outline", label: "Pending" },
    IN_PROGRESS: { variant: "default", label: "In Progress" },
    COMPLETED: { variant: "secondary", label: "Done" },
    CANCELLED: { variant: "secondary", label: "Cancelled" },
  };
  const c = map[status] ?? { variant: "outline", label: status };
  return <Badge variant={c.variant} data-testid={`badge-task-status-${status}`}>{c.label}</Badge>;
}

function priorityBadge(p: string) {
  const map: Record<string, { className: string; label: string }> = {
    LOW: { className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", label: "Low" },
    NORMAL: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", label: "Normal" },
    HIGH: { className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300", label: "High" },
    URGENT: { className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300", label: "Urgent" },
  };
  const c = map[p] ?? map.NORMAL;
  return <span className={`text-xs px-1.5 py-0.5 rounded ${c.className}`} data-testid={`badge-task-priority-${p}`}>{c.label}</span>;
}

export function CrmTasksView() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "mine" | "overdue" | "open">("open");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CrmTask | null>(null);

  const { data: tasks = [], isLoading } = useQuery<CrmTask[]>({ queryKey: ["/api/crm/tasks"] });
  const { data: users = [] } = useQuery<OrgUser[]>({ queryKey: ["/api/users"] });

  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email])), [users]);

  const completeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/crm/tasks/${id}`, { status: "COMPLETED" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] });
      toast({ title: "Task completed" });
    },
    onError: (e: Error) => toast({ title: "Could not complete", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] });
      toast({ title: "Task deleted" });
    },
  });

  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "mine") list = list; // server-side coming below
    if (filter === "overdue") list = list.filter(t => t.status !== "COMPLETED" && t.dueDate && isPast(new Date(t.dueDate)) && !isToday(new Date(t.dueDate)));
    if (filter === "open") list = list.filter(t => t.status !== "COMPLETED" && t.status !== "CANCELLED");
    return list;
  }, [tasks, filter]);

  return (
    <Card data-testid="card-crm-tasks">
      <CardHeader className="pb-4 flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <CheckSquare className="w-5 h-5" /> CRM Tasks
          {!isLoading && <Badge variant="secondary" className="text-xs">{filtered.length}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[140px]" data-testid="select-task-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="button-new-task">
            <Plus className="w-4 h-4 mr-1" /> New Task
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No tasks"
            description="Create follow-up tasks to keep deals moving."
            actionLabel="New Task"
            onAction={() => { setEditing(null); setDialogOpen(true); }}
            testId="empty-crm-tasks"
          />
        ) : (
          <div className="space-y-2">
            {filtered.map(t => {
              const due = t.dueDate ? new Date(t.dueDate) : null;
              const overdue = due && t.status !== "COMPLETED" && isPast(due) && !isToday(due);
              return (
                <div key={t.id} className="flex items-start gap-3 p-3 rounded border hover-elevate" data-testid={`row-task-${t.id}`}>
                  <Checkbox
                    checked={t.status === "COMPLETED"}
                    onCheckedChange={() => t.status !== "COMPLETED" && completeMutation.mutate(t.id)}
                    disabled={completeMutation.isPending}
                    data-testid={`checkbox-task-${t.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => { setEditing(t); setDialogOpen(true); }}
                        className={`font-medium text-left truncate hover:underline ${t.status === "COMPLETED" ? "line-through text-muted-foreground" : ""}`}
                        data-testid={`text-task-title-${t.id}`}
                      >
                        {t.title}
                      </button>
                      {priorityBadge(t.priority)}
                      {statusBadge(t.status)}
                      {overdue && <Badge variant="destructive" className="text-xs gap-1"><AlertCircle className="w-3 h-3" />Overdue</Badge>}
                    </div>
                    {t.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{t.description}</p>}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      {due && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(due, "MMM d, h:mm a")}</span>}
                      {t.assignedToId && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{userMap[t.assignedToId] || "Assigned"}</span>}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-delete-task-${t.id}`}>Delete</Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        users={users}
      />
    </Card>
  );
}

function TaskDialog({ open, onOpenChange, task, users }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  task: CrmTask | null;
  users: OrgUser[];
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd'T'HH:mm") : format(new Date(Date.now() + 86400000), "yyyy-MM-dd'T'HH:mm"));
  const [priority, setPriority] = useState(task?.priority ?? "NORMAL");
  const [status, setStatus] = useState(task?.status ?? "PENDING");
  const [assignedToId, setAssignedToId] = useState(task?.assignedToId ?? "");

  // Reset on open
  useMemoizedReset(open, task, { setTitle, setDescription, setDueDate, setPriority, setStatus, setAssignedToId });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { title, description: description || null, dueDate, priority, status, assignedToId: assignedToId || null };
      if (task) return apiRequest("PATCH", `/api/crm/tasks/${task.id}`, body);
      return apiRequest("POST", "/api/crm/tasks", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] });
      toast({ title: task ? "Task updated" : "Task created" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-task-editor">
        <DialogHeader><DialogTitle>{task ? "Edit Task" : "New Task"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-task-title" />
          </div>
          <div>
            <Label htmlFor="task-desc">Description</Label>
            <Textarea id="task-desc" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} data-testid="input-task-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="task-due">Due</Label>
              <Input id="task-due" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-task-due" />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-task-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assignee</Label>
              <Select value={assignedToId || "_unassigned"} onValueChange={(v) => setAssignedToId(v === "_unassigned" ? "" : v)}>
                <SelectTrigger data-testid="select-task-assignee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_unassigned">Unassigned</SelectItem>
                  {users.map(u => <SelectItem key={u.id} value={u.id}>{`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-task-cancel">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!title || saveMutation.isPending} data-testid="button-task-save">
            {saveMutation.isPending ? "Saving..." : task ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useMemoizedReset(open: boolean, task: CrmTask | null, setters: any) {
  useEffect(() => {
    if (open) {
      setters.setTitle(task?.title ?? "");
      setters.setDescription(task?.description ?? "");
      setters.setDueDate(task?.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd'T'HH:mm") : format(new Date(Date.now() + 86400000), "yyyy-MM-dd'T'HH:mm"));
      setters.setPriority(task?.priority ?? "NORMAL");
      setters.setStatus(task?.status ?? "PENDING");
      setters.setAssignedToId(task?.assignedToId ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);
}
