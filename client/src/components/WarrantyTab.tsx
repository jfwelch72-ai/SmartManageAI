import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as globalQC } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Plus, ShieldCheck, CheckCircle2, XCircle, Clock, Loader2, AlertTriangle,
  MapPin, User, Calendar, Trash2, Edit2, FileDown, Paperclip, History,
  ChevronDown, ChevronRight, ListChecks, Wrench, FileText,
} from "lucide-react";
import { ObjectUploader } from "@/components/ObjectUploader";

// ─── Types ────────────────────────────────────────────────────────────────────

type CaseType = "DEFECT" | "WARRANTY_CLAIM" | "CALLBACK" | "RECALL";
type CaseStatus = "OPEN" | "ACKNOWLEDGED" | "IN_REPAIR" | "REPAIRED" | "CLOSED" | "REJECTED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type DocType = "PHOTO" | "INVOICE" | "INSPECTION_REPORT" | "COMMUNICATION" | "OTHER";

interface WarrantyCase {
  id: string;
  projectId: string;
  caseNumber: string;
  type: CaseType;
  status: CaseStatus;
  priority: Priority;
  title: string;
  description?: string | null;
  location?: string | null;
  reportedByName?: string | null;
  reportedByEmail?: string | null;
  reportedByPhone?: string | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  reportedDate?: string | null;
  targetResolutionDate?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  estimatedCost?: string | null;
  actualCost?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  statusHistory: Array<{ status: string; changedBy: string; changedAt: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

interface WarrantyTask {
  id: string;
  caseId: string;
  projectId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  assignedToName?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  estimatedHours?: string | null;
  actualHours?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface WarrantyDocument {
  id: string;
  caseId: string;
  documentType: DocType;
  title: string;
  url: string;
  filename: string;
  mimeType?: string | null;
  createdAt: string;
}

interface WarrantyTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: CaseType; label: string }[] = [
  { value: "DEFECT", label: "Defect" },
  { value: "WARRANTY_CLAIM", label: "Warranty Claim" },
  { value: "CALLBACK", label: "Callback" },
  { value: "RECALL", label: "Recall" },
];

const STATUS_OPTIONS: { value: CaseStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "IN_REPAIR", label: "In Repair" },
  { value: "REPAIRED", label: "Repaired" },
  { value: "CLOSED", label: "Closed" },
  { value: "REJECTED", label: "Rejected" },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: "PHOTO", label: "Photo" },
  { value: "INVOICE", label: "Invoice" },
  { value: "INSPECTION_REPORT", label: "Inspection Report" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "OTHER", label: "Other" },
];

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  LOW: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  ACKNOWLEDGED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  IN_REPAIR: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  REPAIRED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  CLOSED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  OPEN: Clock,
  ACKNOWLEDGED: AlertTriangle,
  IN_REPAIR: Wrench,
  REPAIRED: CheckCircle2,
  CLOSED: ShieldCheck,
  REJECTED: XCircle,
};

const TASK_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300",
  IN_PROGRESS: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

// Role helpers
const MANAGEMENT_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER", "OFFICE_MANAGER", "SAFETY_MANAGER"];
const CLOSE_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT"];

function canManage(role: string) { return MANAGEMENT_ROLES.includes(role); }
function canClose(role: string) { return CLOSE_ROLES.includes(role); }

function fmtDate(d?: string | null) { if (!d) return "—"; return format(new Date(d), "MMM d, yyyy"); }
function fmtType(t: string) { return t.replace(/_/g, " "); }

// Allowed next-status options for the current role — linear forward-only lifecycle
// OPEN → ACKNOWLEDGED → IN_REPAIR → REPAIRED → CLOSED; REJECTED terminal from any
function allowedTransitions(status: CaseStatus, role: string): CaseStatus[] {
  if (status === "REJECTED" || status === "CLOSED") return [];
  const transitions: Record<string, { targets: CaseStatus[]; roleCheck: (r: string) => boolean }[]> = {
    OPEN: [
      { targets: ["ACKNOWLEDGED"], roleCheck: canManage },
      { targets: ["REJECTED"], roleCheck: canClose },
    ],
    ACKNOWLEDGED: [
      { targets: ["IN_REPAIR"], roleCheck: canManage },
      { targets: ["REJECTED"], roleCheck: canClose },
    ],
    IN_REPAIR: [
      { targets: ["REPAIRED"], roleCheck: (r) => MANAGEMENT_ROLES.includes(r) || r === "HOURLY_EMPLOYEE" },
      { targets: ["REJECTED"], roleCheck: canClose },
    ],
    REPAIRED: [
      { targets: ["CLOSED"], roleCheck: canClose },
      { targets: ["REJECTED"], roleCheck: canClose },
    ],
  };

  const allowed: CaseStatus[] = [];
  for (const rule of transitions[status] ?? []) {
    if (rule.roleCheck(role)) allowed.push(...rule.targets);
  }
  return [...new Set(allowed)];
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd, canAdd }: { onAdd: () => void; canAdd: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShieldCheck className="w-12 h-12 text-muted-foreground mb-4 opacity-40" />
      <h3 className="text-lg font-semibold mb-1">No Warranty Cases</h3>
      <p className="text-muted-foreground text-sm mb-6 max-w-sm">
        Track defects, warranty claims, callbacks, and recalls for this project after construction.
      </p>
      {canAdd && (
        <Button onClick={onAdd} data-testid="button-add-warranty-case">
          <Plus className="w-4 h-4 mr-2" /> Log Warranty Case
        </Button>
      )}
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ cases }: { cases: WarrantyCase[] }) {
  const total = cases.length;
  const open = cases.filter((c) => c.status === "OPEN").length;
  const inRepair = cases.filter((c) => c.status === "ACKNOWLEDGED" || c.status === "IN_REPAIR").length;
  const closed = cases.filter((c) => c.status === "CLOSED").length;
  const rejected = cases.filter((c) => c.status === "REJECTED").length;

  const stats = [
    { label: "Total", value: total, color: "text-foreground" },
    { label: "Open", value: open, color: "text-blue-600 dark:text-blue-400" },
    { label: "In Repair", value: inRepair, color: "text-yellow-600 dark:text-yellow-400" },
    { label: "Closed", value: closed, color: "text-green-600 dark:text-green-400" },
    { label: "Rejected", value: rejected, color: "text-red-600 dark:text-red-400" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-3 text-center">
          <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
        </Card>
      ))}
    </div>
  );
}

// ─── Case Card ────────────────────────────────────────────────────────────────

function CaseCard({
  wc, onSelect, onDelete, canDelete,
}: {
  wc: WarrantyCase;
  onSelect: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const StatusIcon = STATUS_ICONS[wc.status] ?? Clock;

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      data-testid={`card-warranty-case-${wc.id}`}
      onClick={onSelect}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-mono text-muted-foreground">{wc.caseNumber}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[wc.priority]}`}>
                {wc.priority}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[wc.status]}`}>
                <StatusIcon className="inline w-3 h-3 mr-0.5" />
                {fmtType(wc.status)}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {fmtType(wc.type)}
              </span>
            </div>
            <h3 className="font-semibold text-sm leading-tight truncate">{wc.title}</h3>
            {wc.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{wc.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-muted-foreground">
              {wc.location && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{wc.location}</span>
              )}
              {wc.assignedToName && (
                <span className="flex items-center gap-1"><User className="w-3 h-3" />{wc.assignedToName}</span>
              )}
              {wc.targetResolutionDate && (
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Due {fmtDate(wc.targetResolutionDate)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onSelect(); }}
              data-testid={`button-edit-warranty-${wc.id}`}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`button-delete-warranty-${wc.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Warranty Case</AlertDialogTitle>
                    <AlertDialogDescription>
                      Delete case <strong>{wc.caseNumber}</strong> — "{wc.title}"? This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task, onUpdate, onDelete, canManage: canMgr,
}: {
  task: WarrantyTask;
  onUpdate: (id: string, data: Partial<WarrantyTask>) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  const done = task.status === "COMPLETED";
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0 text-sm" data-testid={`row-warranty-task-${task.id}`}>
      <button
        type="button"
        className="shrink-0"
        onClick={() => onUpdate(task.id, { status: done ? "IN_PROGRESS" : "COMPLETED" })}
        data-testid={`button-toggle-task-${task.id}`}
      >
        {done
          ? <CheckCircle2 className="w-4 h-4 text-green-500" />
          : <div className="w-4 h-4 rounded-full border-2 border-muted-foreground" />}
      </button>
      <div className="flex-1 min-w-0">
        <span className={done ? "line-through text-muted-foreground" : ""}>{task.title}</span>
        {task.assignedToName && (
          <span className="ml-2 text-xs text-muted-foreground">({task.assignedToName})</span>
        )}
        {task.dueDate && (
          <span className="ml-2 text-xs text-muted-foreground">Due {fmtDate(task.dueDate)}</span>
        )}
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full ${TASK_STATUS_COLORS[task.status]}`}>
        {fmtType(task.status)}
      </span>
      {canMgr && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
              data-testid={`button-delete-task-${task.id}`}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Task</AlertDialogTitle>
              <AlertDialogDescription>Delete task "{task.title}"? This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(task.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ─── Add Task Form ────────────────────────────────────────────────────────────

function AddTaskForm({ caseId, projectCode, onSaved }: { caseId: string; projectCode: string; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: object) =>
      apiRequest("POST", `/api/projects/${projectCode}/warranty/cases/${caseId}/tasks`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectCode, "warranty", "cases", caseId, "tasks"] });
      setTitle(""); setAssignedToName(""); setDueDate("");
      onSaved();
    },
    onError: () => toast({ title: "Error", description: "Failed to create task.", variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate({ title: title.trim(), assignedToName: assignedToName.trim() || null, dueDate: dueDate || null });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
      <Input
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="flex-1 h-8 text-sm"
        data-testid="input-task-title"
      />
      <Input
        placeholder="Assigned to"
        value={assignedToName}
        onChange={(e) => setAssignedToName(e.target.value)}
        className="w-32 h-8 text-sm"
        data-testid="input-task-assigned"
      />
      <Input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="w-36 h-8 text-sm"
        data-testid="input-task-due"
      />
      <Button type="submit" size="sm" disabled={mutation.isPending} data-testid="button-submit-task">
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      </Button>
    </form>
  );
}

// ─── Case Detail Dialog ───────────────────────────────────────────────────────

function CaseDetailDialog({
  wc, open, onOpenChange, projectCode, userRole,
}: {
  wc: WarrantyCase;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectCode: string;
  userRole: string;
}) {
  const [section, setSection] = useState<"details" | "tasks" | "documents" | "history">("details");
  const [editMode, setEditMode] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [editForm, setEditForm] = useState<Partial<WarrantyCase>>({});
  const [newStatus, setNewStatus] = useState<CaseStatus | "">("");
  const [statusNote, setStatusNote] = useState("");
  const [pendingDocType, setPendingDocType] = useState<DocType>("PHOTO");
  const { toast } = useToast();
  const qc = useQueryClient();
  const isManager = canManage(userRole);

  const caseKey = ["/api/projects", projectCode, "warranty", "cases", wc.id];
  const tasksKey = ["/api/projects", projectCode, "warranty", "cases", wc.id, "tasks"];
  const docsKey = ["/api/projects", projectCode, "warranty", "cases", wc.id, "documents"];

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<WarrantyTask[]>({
    queryKey: tasksKey,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/warranty/cases/${wc.id}/tasks`);
      if (!r.ok) throw new Error("Failed to load tasks");
      return r.json();
    },
    enabled: open && section === "tasks",
  });

  const { data: docs = [], isLoading: docsLoading } = useQuery<WarrantyDocument[]>({
    queryKey: docsKey,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/warranty/cases/${wc.id}/documents`);
      if (!r.ok) throw new Error("Failed to load documents");
      return r.json();
    },
    enabled: open && section === "documents",
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<WarrantyCase>) =>
      apiRequest("PATCH", `/api/projects/${projectCode}/warranty/cases/${wc.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectCode, "warranty", "cases"] });
      setEditMode(false);
      toast({ title: "Case updated" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to update case";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (data: { status: CaseStatus; statusNote?: string }) =>
      apiRequest("PATCH", `/api/projects/${projectCode}/warranty/cases/${wc.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectCode, "warranty", "cases"] });
      setNewStatus(""); setStatusNote("");
      toast({ title: "Status updated" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to change status";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const taskUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WarrantyTask> }) =>
      apiRequest("PATCH", `/api/projects/${projectCode}/warranty/tasks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
    onError: () => toast({ title: "Error", description: "Failed to update task", variant: "destructive" }),
  });

  const taskDeleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/projects/${projectCode}/warranty/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
    onError: () => toast({ title: "Error", description: "Failed to delete task", variant: "destructive" }),
  });

  const docDeleteMutation = useMutation({
    mutationFn: (docId: string) =>
      apiRequest("DELETE", `/api/projects/${projectCode}/warranty/cases/${wc.id}/documents/${docId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: docsKey }),
    onError: () => toast({ title: "Error", description: "Failed to delete document", variant: "destructive" }),
  });

  const transitions = allowedTransitions(wc.status, userRole);
  const StatusIcon = STATUS_ICONS[wc.status] ?? Clock;

  function startEdit() {
    setEditForm({
      title: wc.title,
      description: wc.description,
      location: wc.location,
      type: wc.type,
      priority: wc.priority,
      assignedToName: wc.assignedToName,
      reportedByName: wc.reportedByName,
      reportedByEmail: wc.reportedByEmail,
      reportedByPhone: wc.reportedByPhone,
      reportedDate: wc.reportedDate ? wc.reportedDate.substring(0, 10) : "",
      targetResolutionDate: wc.targetResolutionDate ? wc.targetResolutionDate.substring(0, 10) : "",
      estimatedCost: wc.estimatedCost ?? "",
      actualCost: wc.actualCost ?? "",
      rootCause: wc.rootCause,
      resolution: wc.resolution,
    });
    setEditMode(true);
  }

  function handleDocUploadComplete(result: import("@uppy/core").UploadResult<Record<string, unknown>, Record<string, unknown>>) {
    const successful = result.successful ?? [];
    for (const f of successful) {
      const url = f.uploadURL ?? "";
      const filename = f.name ?? "attachment";
      const mimeType = f.type ?? "application/octet-stream";
      apiRequest("POST", `/api/projects/${projectCode}/warranty/cases/${wc.id}/documents`, {
        url, filename, mimeType, documentType: pendingDocType, title: filename,
      }).then(() => {
        qc.invalidateQueries({ queryKey: docsKey });
        toast({ title: "Document uploaded" });
      }).catch(() => toast({ title: "Error", description: "Failed to save document", variant: "destructive" }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <DialogTitle className="text-base">
                <span className="font-mono text-muted-foreground text-sm mr-2">{wc.caseNumber}</span>
                {wc.title}
              </DialogTitle>
              <DialogDescription className="mt-1 flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[wc.priority]}`}>{wc.priority}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[wc.status]}`}>
                  <StatusIcon className="inline w-3 h-3 mr-0.5" />{fmtType(wc.status)}
                </span>
                <span className="text-xs text-muted-foreground">{fmtType(wc.type)}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-4">
          {(["details", "tasks", "documents", "history"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${section === s ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-warranty-${s}`}
            >
              {s === "tasks" ? <><ListChecks className="inline w-3.5 h-3.5 mr-1" />Tasks</> :
               s === "documents" ? <><FileText className="inline w-3.5 h-3.5 mr-1" />Documents</> :
               s === "history" ? <><History className="inline w-3.5 h-3.5 mr-1" />History</> :
               "Details"}
            </button>
          ))}
        </div>

        {/* ── Details ── */}
        {section === "details" && (
          <div>
            {!editMode ? (
              <div className="space-y-4">
                {wc.description && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</div>
                    <p className="text-sm">{wc.description}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {wc.location && <div><span className="text-muted-foreground">Location: </span>{wc.location}</div>}
                  {wc.reportedByName && <div><span className="text-muted-foreground">Reported by: </span>{wc.reportedByName}</div>}
                  {wc.reportedByEmail && <div><span className="text-muted-foreground">Email: </span>{wc.reportedByEmail}</div>}
                  {wc.reportedByPhone && <div><span className="text-muted-foreground">Phone: </span>{wc.reportedByPhone}</div>}
                  {wc.reportedDate && <div><span className="text-muted-foreground">Reported: </span>{fmtDate(wc.reportedDate)}</div>}
                  {wc.targetResolutionDate && <div><span className="text-muted-foreground">Target date: </span>{fmtDate(wc.targetResolutionDate)}</div>}
                  {wc.resolvedAt && <div><span className="text-muted-foreground">Resolved: </span>{fmtDate(wc.resolvedAt)}</div>}
                  {wc.closedAt && <div><span className="text-muted-foreground">Closed: </span>{fmtDate(wc.closedAt)}</div>}
                  {wc.assignedToName && <div><span className="text-muted-foreground">Assigned: </span>{wc.assignedToName}</div>}
                  {wc.estimatedCost && <div><span className="text-muted-foreground">Est. cost: </span>${Number(wc.estimatedCost).toLocaleString()}</div>}
                  {wc.actualCost && <div><span className="text-muted-foreground">Actual cost: </span>${Number(wc.actualCost).toLocaleString()}</div>}
                </div>
                {wc.rootCause && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Root Cause</div>
                    <p className="text-sm">{wc.rootCause}</p>
                  </div>
                )}
                {wc.resolution && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Resolution</div>
                    <p className="text-sm">{wc.resolution}</p>
                  </div>
                )}

                {/* Status transition */}
                {transitions.length > 0 && (
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Change Status</div>
                    <div className="flex gap-2 flex-wrap">
                      <Select value={newStatus} onValueChange={(v) => setNewStatus(v as CaseStatus)}>
                        <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-new-status">
                          <SelectValue placeholder="Select new status…" />
                        </SelectTrigger>
                        <SelectContent>
                          {transitions.map((t) => (
                            <SelectItem key={t} value={t}>{fmtType(t)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {newStatus && (
                        <Fragment>
                          <Input
                            placeholder="Optional note…"
                            value={statusNote}
                            onChange={(e) => setStatusNote(e.target.value)}
                            className="flex-1 h-8 text-sm min-w-32"
                            data-testid="input-status-note"
                          />
                          <Button size="sm" disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate({ status: newStatus as CaseStatus, statusNote: statusNote || undefined })}
                            data-testid="button-apply-status">
                            {statusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
                          </Button>
                        </Fragment>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Edit Form */
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label htmlFor="edit-title">Title</Label>
                    <Input id="edit-title" value={editForm.title ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} data-testid="input-edit-title" />
                  </div>
                  <div>
                    <Label htmlFor="edit-type">Type</Label>
                    <Select value={editForm.type ?? ""} onValueChange={(v) => setEditForm((f) => ({ ...f, type: v as CaseType }))}>
                      <SelectTrigger id="edit-type" data-testid="select-edit-type"><SelectValue /></SelectTrigger>
                      <SelectContent>{TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="edit-priority">Priority</Label>
                    <Select value={editForm.priority ?? ""} onValueChange={(v) => setEditForm((f) => ({ ...f, priority: v as Priority }))}>
                      <SelectTrigger id="edit-priority" data-testid="select-edit-priority"><SelectValue /></SelectTrigger>
                      <SelectContent>{PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="edit-desc">Description</Label>
                    <Textarea id="edit-desc" value={editForm.description ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={3} data-testid="textarea-edit-description" />
                  </div>
                  <div>
                    <Label htmlFor="edit-location">Location</Label>
                    <Input id="edit-location" value={editForm.location ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} data-testid="input-edit-location" />
                  </div>
                  <div>
                    <Label htmlFor="edit-assigned">Assigned To</Label>
                    <Input id="edit-assigned" value={editForm.assignedToName ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, assignedToName: e.target.value }))} data-testid="input-edit-assigned" />
                  </div>
                  <div>
                    <Label htmlFor="edit-reporter">Reported By</Label>
                    <Input id="edit-reporter" value={editForm.reportedByName ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, reportedByName: e.target.value }))} data-testid="input-edit-reporter" />
                  </div>
                  <div>
                    <Label htmlFor="edit-reporter-email">Reporter Email</Label>
                    <Input id="edit-reporter-email" type="email" value={editForm.reportedByEmail ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, reportedByEmail: e.target.value }))} data-testid="input-edit-reporter-email" />
                  </div>
                  <div>
                    <Label htmlFor="edit-reported-date">Reported Date</Label>
                    <Input id="edit-reported-date" type="date" value={(editForm.reportedDate ?? "").substring(0, 10)} onChange={(e) => setEditForm((f) => ({ ...f, reportedDate: e.target.value }))} data-testid="input-edit-reported-date" />
                  </div>
                  <div>
                    <Label htmlFor="edit-target-date">Target Resolution</Label>
                    <Input id="edit-target-date" type="date" value={(editForm.targetResolutionDate ?? "").substring(0, 10)} onChange={(e) => setEditForm((f) => ({ ...f, targetResolutionDate: e.target.value }))} data-testid="input-edit-target-date" />
                  </div>
                  <div>
                    <Label htmlFor="edit-est-cost">Estimated Cost ($)</Label>
                    <Input id="edit-est-cost" type="number" step="0.01" value={editForm.estimatedCost ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, estimatedCost: e.target.value }))} data-testid="input-edit-est-cost" />
                  </div>
                  <div>
                    <Label htmlFor="edit-actual-cost">Actual Cost ($)</Label>
                    <Input id="edit-actual-cost" type="number" step="0.01" value={editForm.actualCost ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, actualCost: e.target.value }))} data-testid="input-edit-actual-cost" />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="edit-root-cause">Root Cause</Label>
                    <Textarea id="edit-root-cause" value={editForm.rootCause ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, rootCause: e.target.value }))} rows={2} data-testid="textarea-edit-root-cause" />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="edit-resolution">Resolution</Label>
                    <Textarea id="edit-resolution" value={editForm.resolution ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, resolution: e.target.value }))} rows={2} data-testid="textarea-edit-resolution" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tasks ── */}
        {section === "tasks" && (
          <div>
            {tasksLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : tasks.length === 0 && !showNewTask ? (
              <div className="text-center py-8 text-sm text-muted-foreground">No repair tasks yet.</div>
            ) : (
              <div>
                {tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onUpdate={(id, data) => taskUpdateMutation.mutate({ id, data })}
                    onDelete={(id) => taskDeleteMutation.mutate(id)}
                    canManage={isManager}
                  />
                ))}
              </div>
            )}
            {isManager && (
              showNewTask ? (
                <AddTaskForm caseId={wc.id} projectCode={projectCode} onSaved={() => setShowNewTask(false)} />
              ) : (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowNewTask(true)} data-testid="button-add-task">
                  <Plus className="w-4 h-4 mr-1" /> Add Task
                </Button>
              )
            )}
          </div>
        )}

        {/* ── Documents ── */}
        {section === "documents" && (
          <div className="space-y-3">
            {docsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 p-2 border rounded text-sm" data-testid={`row-warranty-doc-${doc.id}`}>
                    <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <a href={doc.url} target="_blank" rel="noreferrer" className="font-medium hover:underline truncate block">{doc.title}</a>
                      <span className="text-xs text-muted-foreground">{fmtType(doc.documentType)} · {fmtDate(doc.createdAt)}</span>
                    </div>
                    {isManager && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" data-testid={`button-delete-doc-${doc.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Document</AlertDialogTitle>
                            <AlertDialogDescription>Delete "{doc.title}"?</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => docDeleteMutation.mutate(doc.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                ))}
                {docs.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No documents attached.</p>}
              </div>
            )}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Document Type</Label>
                <Select value={pendingDocType} onValueChange={(v) => setPendingDocType(v as DocType)}>
                  <SelectTrigger className="w-40 h-8 text-sm" data-testid="select-doc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ObjectUploader
                fileType="DOCUMENT"
                maxNumberOfFiles={5}
                onComplete={handleDocUploadComplete}
                testId="uploader-warranty-doc"
              >
                <Button variant="outline" size="sm" data-testid="button-add-warranty-doc">
                  <Paperclip className="w-4 h-4 mr-1.5" />
                  Attach Document / Photo
                </Button>
              </ObjectUploader>
            </div>
          </div>
        )}

        {/* ── History ── */}
        {section === "history" && (
          <div className="space-y-2">
            {wc.statusHistory.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">No status history available.</p>
            ) : (
              [...wc.statusHistory].reverse().map((h, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
                  <div className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${STATUS_COLORS[h.status] ?? "bg-muted text-muted-foreground"}`}>
                    {fmtType(h.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{h.changedBy}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(h.changedAt)}</span>
                    </div>
                    {h.note && <p className="text-muted-foreground text-xs mt-0.5">{h.note}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
          {section === "details" && isManager && (
            editMode ? (
              <Fragment>
                <Button variant="outline" onClick={() => setEditMode(false)} data-testid="button-cancel-edit">Cancel</Button>
                <Button disabled={updateMutation.isPending} onClick={() => updateMutation.mutate(editForm)} data-testid="button-save-edit">
                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
                </Button>
              </Fragment>
            ) : (
              <Button variant="outline" onClick={startEdit} data-testid="button-start-edit">
                <Edit2 className="w-4 h-4 mr-1" /> Edit Case
              </Button>
            )
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-close-dialog">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Case Dialog ───────────────────────────────────────────────────────

function CreateCaseDialog({
  open, onOpenChange, projectCode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectCode: string;
}) {
  const [form, setForm] = useState({
    title: "",
    type: "DEFECT" as CaseType,
    priority: "MEDIUM" as Priority,
    description: "",
    location: "",
    reportedByName: "",
    reportedByEmail: "",
    reportedByPhone: "",
    reportedDate: "",
    targetResolutionDate: "",
    assignedToName: "",
    estimatedCost: "",
  });

  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: object) =>
      apiRequest("POST", `/api/projects/${projectCode}/warranty/cases`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectCode, "warranty", "cases"] });
      onOpenChange(false);
      setForm({ title: "", type: "DEFECT", priority: "MEDIUM", description: "", location: "", reportedByName: "", reportedByEmail: "", reportedByPhone: "", reportedDate: "", targetResolutionDate: "", assignedToName: "", estimatedCost: "" });
      toast({ title: "Warranty case created" });
    },
    onError: () => toast({ title: "Error", description: "Failed to create warranty case.", variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    mutation.mutate({
      ...form,
      estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : null,
      reportedDate: form.reportedDate || null,
      targetResolutionDate: form.targetResolutionDate || null,
    });
  }

  function setF(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Warranty Case</DialogTitle>
          <DialogDescription>Create a new warranty case, defect, or callback for this project.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="c-title">Title *</Label>
            <Input id="c-title" required value={form.title} onChange={(e) => setF("title", e.target.value)} placeholder="e.g. Roof leak at Ridge Cap" data-testid="input-create-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-type">Type</Label>
              <Select value={form.type} onValueChange={(v) => setF("type", v)}>
                <SelectTrigger id="c-type" data-testid="select-create-type"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="c-priority">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setF("priority", v)}>
                <SelectTrigger id="c-priority" data-testid="select-create-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="c-desc">Description</Label>
            <Textarea id="c-desc" value={form.description} onChange={(e) => setF("description", e.target.value)} rows={3} placeholder="Describe the issue…" data-testid="textarea-create-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-location">Location</Label>
              <Input id="c-location" value={form.location} onChange={(e) => setF("location", e.target.value)} placeholder="Room, floor, area…" data-testid="input-create-location" />
            </div>
            <div>
              <Label htmlFor="c-assigned">Assigned To</Label>
              <Input id="c-assigned" value={form.assignedToName} onChange={(e) => setF("assignedToName", e.target.value)} placeholder="Name" data-testid="input-create-assigned" />
            </div>
            <div>
              <Label htmlFor="c-reporter">Reported By</Label>
              <Input id="c-reporter" value={form.reportedByName} onChange={(e) => setF("reportedByName", e.target.value)} placeholder="Client name" data-testid="input-create-reporter" />
            </div>
            <div>
              <Label htmlFor="c-reporter-email">Reporter Email</Label>
              <Input id="c-reporter-email" type="email" value={form.reportedByEmail} onChange={(e) => setF("reportedByEmail", e.target.value)} data-testid="input-create-reporter-email" />
            </div>
            <div>
              <Label htmlFor="c-reported-date">Reported Date</Label>
              <Input id="c-reported-date" type="date" value={form.reportedDate} onChange={(e) => setF("reportedDate", e.target.value)} data-testid="input-create-reported-date" />
            </div>
            <div>
              <Label htmlFor="c-target-date">Target Resolution</Label>
              <Input id="c-target-date" type="date" value={form.targetResolutionDate} onChange={(e) => setF("targetResolutionDate", e.target.value)} data-testid="input-create-target-date" />
            </div>
            <div>
              <Label htmlFor="c-est-cost">Estimated Cost ($)</Label>
              <Input id="c-est-cost" type="number" step="0.01" value={form.estimatedCost} onChange={(e) => setF("estimatedCost", e.target.value)} data-testid="input-create-est-cost" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-create">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Case
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function WarrantyTab({ projectId, projectCode, userRole }: WarrantyTabProps) {
  const [searchQ, setSearchQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [selectedCase, setSelectedCase] = useState<WarrantyCase | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { toast } = useToast();
  const qc = useQueryClient();
  const isManager = canManage(userRole);
  const isCloser = canClose(userRole);

  const params = new URLSearchParams();
  if (filterStatus !== "all") params.set("status", filterStatus);
  if (filterType !== "all") params.set("type", filterType);
  if (filterPriority !== "all") params.set("priority", filterPriority);
  if (searchQ.trim()) params.set("q", searchQ.trim());

  const casesKey = ["/api/projects", projectCode, "warranty", "cases", filterStatus, filterType, filterPriority, searchQ];

  const { data: cases = [], isLoading } = useQuery<WarrantyCase[]>({
    queryKey: casesKey,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/warranty/cases?${params}`);
      if (!r.ok) throw new Error("Failed to load warranty cases");
      return r.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/projects/${projectCode}/warranty/cases/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectCode, "warranty", "cases"] });
      toast({ title: "Case deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete case.", variant: "destructive" }),
  });

  function handleExport() {
    window.open(`/api/projects/${projectCode}/warranty/export`, "_blank");
  }

  const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...cases].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

  return (
    <div className="space-y-4" data-testid="warranty-tab">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Warranty & Post-Construction
          </h2>
          <p className="text-sm text-muted-foreground">Track defects, warranty claims, and repair callbacks.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-warranty-export">
            <FileDown className="w-4 h-4 mr-1" /> Export
          </Button>
          {isManager && (
            <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-warranty-case-header">
              <Plus className="w-4 h-4 mr-1" /> Log Case
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {cases.length > 0 && <StatsBar cases={cases} />}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search cases…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          className="w-52 h-8 text-sm"
          data-testid="input-warranty-search"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40 h-8 text-sm" data-testid="select-filter-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-filter-priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : cases.length === 0 ? (
        <EmptyState onAdd={() => setShowCreate(true)} canAdd={isManager} />
      ) : (
        <div className="space-y-2">
          {sorted.map((wc) => (
            <CaseCard
              key={wc.id}
              wc={wc}
              onSelect={() => setSelectedCase(wc)}
              onDelete={() => deleteMutation.mutate(wc.id)}
              canDelete={isCloser}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateCaseDialog open={showCreate} onOpenChange={setShowCreate} projectCode={projectCode} />

      {selectedCase && (
        <CaseDetailDialog
          key={selectedCase.id}
          wc={selectedCase}
          open={!!selectedCase}
          onOpenChange={(v) => { if (!v) setSelectedCase(null); }}
          projectCode={projectCode}
          userRole={userRole}
        />
      )}
    </div>
  );
}

export default WarrantyTab;
