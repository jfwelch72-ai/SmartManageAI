import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Download,
  Filter,
  BookOpen,
  Users,
  BarChart2,
  X,
  ChevronDown,
} from "lucide-react";

const CATEGORIES = [
  "Fall Protection",
  "Fire Safety",
  "PPE (Personal Protective Equipment)",
  "Hazard Communication",
  "Electrical Safety",
  "Confined Space Entry",
  "Scaffolding Safety",
  "Tool & Equipment Safety",
  "First Aid / CPR",
  "Lockout/Tagout (LOTO)",
  "Forklift / Heavy Equipment",
  "Hearing Conservation",
  "Respiratory Protection",
  "Chemical Handling",
  "Emergency Procedures",
  "OSHA Compliance",
  "Other",
];

const FREQUENCIES = [
  { value: "ONCE", label: "One Time Only" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual" },
  { value: "CUSTOM", label: "Custom / As Needed" },
];

interface Training {
  id: string;
  title: string;
  description: string | null;
  category: string;
  frequency: string;
  durationMinutes: number | null;
  materials: string | null;
  isActive: boolean;
  createdAt: string;
  totalAssigned: number;
  totalCompleted: number;
}

interface Assignment {
  id: string;
  trainingId: string;
  employeeId: string;
  status: string;
  assignedAt: string;
  dueDate: string | null;
  completedAt: string | null;
  completedByName: string | null;
  notes: string | null;
  acknowledgmentSignature: string | null;
  trainingTitle: string;
  trainingCategory: string;
  trainingFrequency: string;
  trainingDuration: number | null;
  trainingDescription: string | null;
  trainingMaterials: string | null;
  employeeFirstName: string;
  employeeLastName: string;
  employeeEmail: string;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") return <Badge className="bg-green-500/15 text-green-700 border-transparent hover:bg-green-500/20" data-testid="badge-completed">Completed</Badge>;
  if (status === "OVERDUE") return <Badge className="bg-red-500/15 text-red-700 border-transparent hover:bg-red-500/20" data-testid="badge-overdue">Overdue</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-700 border-transparent hover:bg-amber-500/20" data-testid="badge-pending">Pending</Badge>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function freqLabel(f: string) {
  return FREQUENCIES.find(x => x.value === f)?.label ?? f;
}

export default function SafetyTrainingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"programs" | "assignments">("programs");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [empFilter, setEmpFilter] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");

  const [showCreateProgram, setShowCreateProgram] = useState(false);
  const [editProgram, setEditProgram] = useState<Training | null>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignTrainingId, setAssignTrainingId] = useState("");
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completingAssignment, setCompletingAssignment] = useState<Assignment | null>(null);

  const isAdmin = ["ADMIN", "SUPER_ADMIN", "SAFETY_MANAGER", "HR_MANAGER", "MANAGER"].includes(user?.role || "");

  const { data: trainings = [], isLoading: loadingTrainings } = useQuery<Training[]>({
    queryKey: ["/api/safety-training"],
  });

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery<Assignment[]>({
    queryKey: ["/api/safety-training/assignments"],
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/auth/manage-workers"],
    enabled: isAdmin,
    select: (data: any) => (Array.isArray(data) ? data : data?.workers ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/safety-training", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] });
      setShowCreateProgram(false);
      toast({ title: "Training program created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: any) => apiRequest("PATCH", `/api/safety-training/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] });
      setEditProgram(null);
      toast({ title: "Training program updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/safety-training/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] });
      toast({ title: "Training program removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/safety-training/assign", body),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] });
      setShowAssignDialog(false);
      toast({ title: `Assigned to ${data?.assigned ?? 0} employee(s)` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, ...body }: any) => apiRequest("PATCH", `/api/safety-training/assignments/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] });
      setShowCompleteDialog(false);
      setCompletingAssignment(null);
      toast({ title: "Training marked as completed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeAssignmentMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/safety-training/assignments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] });
      toast({ title: "Assignment removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredAssignments = assignments.filter(a => {
    if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
    if (empFilter !== "ALL" && a.employeeId !== empFilter) return false;
    if (searchQ) {
      const q = searchQ.toLowerCase();
      const name = `${a.employeeFirstName} ${a.employeeLastName}`.toLowerCase();
      if (!name.includes(q) && !a.trainingTitle.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalAssigned = assignments.length;
  const totalCompleted = assignments.filter(a => a.status === "COMPLETED").length;
  const totalPending = assignments.filter(a => a.status === "PENDING").length;
  const totalOverdue = assignments.filter(a => a.status === "OVERDUE").length;

  const uniqueEmployees = Array.from(new Map(assignments.map(a => [a.employeeId, { id: a.employeeId, name: `${a.employeeFirstName} ${a.employeeLastName}` }])).values());

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="safety-training-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="page-title">Safety Training</h1>
            <p className="text-sm text-muted-foreground">Manage, assign, and track in-house safety training</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/safety-training/export/pdf`, "_blank")}
                data-testid="button-export-all"
              >
                <Download className="h-4 w-4 mr-1" />
                Export All (PDF)
              </Button>
              <Button size="sm" onClick={() => setShowCreateProgram(true)} data-testid="button-create-program">
                <Plus className="h-4 w-4 mr-1" />
                New Training
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Assigned", value: totalAssigned, icon: BookOpen, color: "text-blue-600" },
          { label: "Completed", value: totalCompleted, icon: CheckCircle2, color: "text-green-600" },
          { label: "Pending", value: totalPending, icon: Clock, color: "text-amber-600" },
          { label: "Overdue", value: totalOverdue, icon: AlertCircle, color: "text-red-600" },
        ].map(stat => (
          <Card key={stat.label} className="p-4" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: "programs" as const, label: "Training Programs", icon: BookOpen },
          { key: "assignments" as const, label: "Assignments", icon: Users },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${t.key}`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Training Programs Tab */}
      {tab === "programs" && (
        <div>
          {loadingTrainings ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-lg" />)}
            </div>
          ) : trainings.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground" data-testid="empty-programs">
              <ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No training programs yet</p>
              {isAdmin && <p className="text-sm mt-1">Create your first training program to get started.</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {trainings.map(t => (
                <Card key={t.id} className="group hover:shadow-md transition-shadow" data-testid={`card-training-${t.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{t.title}</CardTitle>
                      {isAdmin && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditProgram(t)}
                            data-testid={`button-edit-training-${t.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => { if (confirm("Remove this training program?")) deleteMutation.mutate(t.id); }}
                            data-testid={`button-delete-training-${t.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                      <Badge variant="outline" className="text-xs">{freqLabel(t.frequency)}</Badge>
                      {t.durationMinutes && <Badge variant="outline" className="text-xs">{t.durationMinutes} min</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {t.description && <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>}
                    {t.materials && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Materials:</span> {t.materials}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
                      <span>{t.totalAssigned} assigned · {t.totalCompleted} completed</span>
                      {t.totalAssigned > 0 && (
                        <span className="font-medium text-green-600">
                          {Math.round((t.totalCompleted / t.totalAssigned) * 100)}%
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => { setAssignTrainingId(t.id); setShowAssignDialog(true); }}
                        data-testid={`button-assign-training-${t.id}`}
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        Assign Employees
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assignments Tab */}
      {tab === "assignments" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              placeholder="Search employee or training..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              className="max-w-xs h-8 text-sm"
              data-testid="input-search-assignments"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="OVERDUE">Overdue</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && uniqueEmployees.length > 0 && (
              <Select value={empFilter} onValueChange={setEmpFilter}>
                <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-employee-filter">
                  <SelectValue placeholder="Employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Employees</SelectItem>
                  {uniqueEmployees.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isAdmin && empFilter !== "ALL" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  const empIdParam = empFilter !== "ALL" ? `?employeeId=${empFilter}` : "";
                  window.open(`/api/safety-training/export/pdf${empIdParam}`, "_blank");
                }}
                data-testid="button-export-employee"
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                Export Employee PDF
              </Button>
            )}
          </div>

          {loadingAssignments ? (
            <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded" />)}</div>
          ) : filteredAssignments.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground" data-testid="empty-assignments">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No assignments found</p>
              <p className="text-sm mt-1">Assign training programs to employees from the Programs tab.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="assignments-table">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Training</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assigned</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Due</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Completed</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssignments.map(a => (
                      <tr key={a.id} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-assignment-${a.id}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{a.employeeFirstName} {a.employeeLastName}</div>
                          <div className="text-xs text-muted-foreground">{a.employeeEmail}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{a.trainingTitle}</div>
                          {a.trainingDuration && <div className="text-xs text-muted-foreground">{a.trainingDuration} min</div>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{a.trainingCategory}</td>
                        <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.assignedAt)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.dueDate ? fmtDate(a.dueDate) : "—"}</td>
                        <td className="px-4 py-3">
                          {a.completedAt ? (
                            <div>
                              <div className="text-green-700">{fmtDate(a.completedAt)}</div>
                              {a.completedByName && <div className="text-xs text-muted-foreground">by {a.completedByName}</div>}
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {a.status !== "COMPLETED" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => { setCompletingAssignment(a); setShowCompleteDialog(true); }}
                                data-testid={`button-mark-complete-${a.id}`}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Complete
                              </Button>
                            )}
                            {isAdmin && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => window.open(`/api/safety-training/export/pdf?employeeId=${a.employeeId}`, "_blank")}
                                  data-testid={`button-export-row-${a.id}`}
                                  title="Export employee PDF"
                                >
                                  <Download className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => { if (confirm("Remove this assignment?")) removeAssignmentMutation.mutate(a.id); }}
                                  data-testid={`button-remove-assignment-${a.id}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Program Dialog */}
      <TrainingFormDialog
        open={showCreateProgram}
        onClose={() => setShowCreateProgram(false)}
        onSave={(data) => createMutation.mutate(data)}
        isSaving={createMutation.isPending}
        title="New Training Program"
      />

      {/* Edit Program Dialog */}
      {editProgram && (
        <TrainingFormDialog
          open={!!editProgram}
          onClose={() => setEditProgram(null)}
          onSave={(data) => updateMutation.mutate({ id: editProgram.id, ...data })}
          isSaving={updateMutation.isPending}
          title="Edit Training Program"
          defaultValues={editProgram}
        />
      )}

      {/* Assign Dialog */}
      <AssignDialog
        open={showAssignDialog}
        onClose={() => { setShowAssignDialog(false); setAssignTrainingId(""); }}
        trainings={trainings}
        employees={employees}
        defaultTrainingId={assignTrainingId}
        onAssign={(data) => assignMutation.mutate(data)}
        isSaving={assignMutation.isPending}
      />

      {/* Mark Complete Dialog */}
      {completingAssignment && (
        <CompleteDialog
          open={showCompleteDialog}
          assignment={completingAssignment}
          onClose={() => { setShowCompleteDialog(false); setCompletingAssignment(null); }}
          onSave={(data) => completeMutation.mutate({ id: completingAssignment.id, ...data })}
          isSaving={completeMutation.isPending}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function TrainingFormDialog({
  open, onClose, onSave, isSaving, title, defaultValues,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  isSaving: boolean;
  title: string;
  defaultValues?: Partial<Training>;
}) {
  const [form, setForm] = useState({
    title: defaultValues?.title ?? "",
    description: defaultValues?.description ?? "",
    category: defaultValues?.category ?? "",
    frequency: defaultValues?.frequency ?? "ONCE",
    durationMinutes: defaultValues?.durationMinutes ?? "",
    materials: defaultValues?.materials ?? "",
  });

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-training-form">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="training-title">Training Title *</Label>
            <Input id="training-title" value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g., Fall Protection Basics" data-testid="input-training-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => set("category", v)}>
                <SelectTrigger data-testid="select-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Frequency *</Label>
              <Select value={form.frequency} onValueChange={v => set("frequency", v)}>
                <SelectTrigger data-testid="select-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duration">Duration (minutes)</Label>
            <Input id="duration" type="number" min={1} value={form.durationMinutes} onChange={e => set("durationMinutes", e.target.value)} placeholder="e.g., 60" data-testid="input-duration" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={2} value={form.description} onChange={e => set("description", e.target.value)} placeholder="What does this training cover?" data-testid="input-description" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="materials">Training Materials / Resources</Label>
            <Textarea id="materials" rows={2} value={form.materials} onChange={e => set("materials", e.target.value)} placeholder="e.g., OSHA 1926.502 manual, company safety binder, PPE kit" data-testid="input-materials" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-form">Cancel</Button>
          <Button
            onClick={() => onSave({ ...form, durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null })}
            disabled={!form.title || !form.category || isSaving}
            data-testid="button-save-program"
          >
            {isSaving ? "Saving..." : "Save Training"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  open, onClose, trainings, employees, defaultTrainingId, onAssign, isSaving,
}: {
  open: boolean;
  onClose: () => void;
  trainings: Training[];
  employees: Employee[];
  defaultTrainingId: string;
  onAssign: (data: any) => void;
  isSaving: boolean;
}) {
  const [trainingId, setTrainingId] = useState(defaultTrainingId);
  const [dueDate, setDueDate] = useState("");
  const [assignAll, setAssignAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleEmployee = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleAssign = () => {
    onAssign({ trainingId, dueDate: dueDate || undefined, assignAll, employeeIds: assignAll ? [] : selectedIds });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-assign">
        <DialogHeader><DialogTitle>Assign Training to Employees</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Training Program *</Label>
            <Select value={trainingId} onValueChange={setTrainingId}>
              <SelectTrigger data-testid="select-assign-training"><SelectValue placeholder="Select training" /></SelectTrigger>
              <SelectContent>
                {trainings.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due-date">Due Date (optional)</Label>
            <Input id="due-date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-due-date" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="assign-all"
                checked={assignAll}
                onCheckedChange={v => { setAssignAll(!!v); if (v) setSelectedIds([]); }}
                data-testid="checkbox-assign-all"
              />
              <Label htmlFor="assign-all" className="font-medium cursor-pointer">Assign to All Active Employees</Label>
            </div>
            {!assignAll && (
              <div className="border rounded-lg p-3 max-h-52 overflow-y-auto space-y-1" data-testid="employee-list">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No employees found</p>
                ) : employees.map(e => (
                  <div key={e.id} className="flex items-center gap-2 py-1">
                    <Checkbox
                      id={`emp-${e.id}`}
                      checked={selectedIds.includes(e.id)}
                      onCheckedChange={() => toggleEmployee(e.id)}
                      data-testid={`checkbox-employee-${e.id}`}
                    />
                    <Label htmlFor={`emp-${e.id}`} className="cursor-pointer text-sm">
                      {e.firstName} {e.lastName}
                      <span className="text-muted-foreground ml-1.5 text-xs">{e.email}</span>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-assign">Cancel</Button>
          <Button
            onClick={handleAssign}
            disabled={!trainingId || (!assignAll && selectedIds.length === 0) || isSaving}
            data-testid="button-confirm-assign"
          >
            {isSaving ? "Assigning..." : `Assign${!assignAll && selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({
  open, assignment, onClose, onSave, isSaving, isAdmin,
}: {
  open: boolean;
  assignment: Assignment;
  onClose: () => void;
  onSave: (data: any) => void;
  isSaving: boolean;
  isAdmin: boolean;
}) {
  const { user } = useAuth();
  const [completedByName, setCompletedByName] = useState(`${user?.firstName || ""} ${user?.lastName || ""}`.trim());
  const [notes, setNotes] = useState(assignment.notes ?? "");
  const [ack, setAck] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-complete">
        <DialogHeader>
          <DialogTitle>Mark Training Complete</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted/40 rounded-lg p-3">
            <p className="font-medium text-sm">{assignment.trainingTitle}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{assignment.employeeFirstName} {assignment.employeeLastName}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="completed-by">Completed / Signed off by</Label>
            <Input id="completed-by" value={completedByName} onChange={e => setCompletedByName(e.target.value)} placeholder="Your full name" data-testid="input-completed-by" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="completion-notes">Notes (optional)</Label>
            <Textarea id="completion-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this training session..." data-testid="input-completion-notes" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acknowledgment">Employee Acknowledgment</Label>
            <Input
              id="acknowledgment"
              value={ack}
              onChange={e => setAck(e.target.value)}
              placeholder='Type "I acknowledge completion of this training"'
              data-testid="input-acknowledgment"
            />
            <p className="text-xs text-muted-foreground">This serves as a digital acknowledgment for record-keeping and bid documentation.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-complete">Cancel</Button>
          <Button
            onClick={() => onSave({ status: "COMPLETED", completedByName, notes, acknowledgmentSignature: ack })}
            disabled={!completedByName || isSaving}
            data-testid="button-confirm-complete"
          >
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {isSaving ? "Saving..." : "Mark Complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
