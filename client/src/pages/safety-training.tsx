import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
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
  ShieldCheck, Plus, Pencil, Trash2, UserPlus, CheckCircle2, Clock, AlertCircle,
  Download, BookOpen, Users, X, MessageSquare, ClipboardList, FileWarning,
  Calendar, Eye,
} from "lucide-react";

const CATEGORIES = [
  "Fall Protection", "Fire Safety", "PPE (Personal Protective Equipment)",
  "Hazard Communication", "Electrical Safety", "Confined Space Entry",
  "Scaffolding Safety", "Tool & Equipment Safety", "First Aid / CPR",
  "Lockout/Tagout (LOTO)", "Forklift / Heavy Equipment", "Hearing Conservation",
  "Respiratory Protection", "Chemical Handling", "Emergency Procedures",
  "OSHA Compliance", "Other",
];

const FREQUENCIES = [
  { value: "ONCE", label: "One Time Only" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual" },
  { value: "CUSTOM", label: "Custom / As Needed" },
];

const CHECKLIST_CATEGORIES = [
  "Daily Pre-Task", "Scaffolding", "Excavation", "Confined Space",
  "Fall Protection", "Electrical", "Hot Work", "Crane/Rigging",
  "PPE Inspection", "Fire Prevention", "Housekeeping", "Other",
];

const INJURY_TYPES = [
  { value: "INJURY", label: "Injury" },
  { value: "SKIN_DISORDER", label: "Skin Disorder" },
  { value: "RESPIRATORY", label: "Respiratory Condition" },
  { value: "POISONING", label: "Poisoning" },
  { value: "HEARING_LOSS", label: "Hearing Loss" },
  { value: "OTHER_ILLNESS", label: "Other Illness" },
];

const TREATMENT_TYPES = [
  { value: "FIRST_AID", label: "First Aid" },
  { value: "MEDICAL_TREATMENT", label: "Medical Treatment Beyond First Aid" },
  { value: "EMERGENCY_ROOM", label: "Emergency Room" },
  { value: "HOSPITALIZATION", label: "Hospitalization" },
  { value: "NONE", label: "No Treatment" },
];

const CLASSIFICATIONS = [
  { value: "DEATH", label: "Death" },
  { value: "DAYS_AWAY", label: "Days Away From Work" },
  { value: "RESTRICTED", label: "Job Transfer or Restriction" },
  { value: "OTHER_RECORDABLE", label: "Other Recordable Case" },
];

interface Training {
  id: string; title: string; description: string | null; category: string;
  frequency: string; durationMinutes: number | null; materials: string | null;
  isActive: boolean; createdAt: string; totalAssigned: number; totalCompleted: number;
}

interface Assignment {
  id: string; trainingId: string; employeeId: string; status: string;
  assignedAt: string; dueDate: string | null; completedAt: string | null;
  completedByName: string | null; notes: string | null; acknowledgmentSignature: string | null;
  trainingTitle: string; trainingCategory: string; trainingFrequency: string;
  trainingDuration: number | null; trainingDescription: string | null;
  trainingMaterials: string | null; employeeFirstName: string;
  employeeLastName: string; employeeEmail: string;
}

interface Employee {
  id: string; firstName: string; lastName: string; email: string; role: string;
}

interface ToolboxTopic {
  id: string; title: string; content: string | null; category: string;
  attachments: string | null; isActive: boolean; createdAt: string;
}

interface ScheduledTalk {
  id: string; topicId: string; projectId: string | null; scheduledDate: string;
  presenter: string | null; status: string; notes: string | null;
  completedAt: string | null; createdAt: string;
  topicTitle: string; topicCategory: string; topicContent: string | null;
}

interface ChecklistTemplate {
  id: string; name: string; category: string; itemsJson: string;
  isActive: boolean; createdAt: string;
}

interface ChecklistInstance {
  id: string; templateId: string; projectId: string | null;
  completedByName: string | null; status: string; responsesJson: string;
  notes: string | null; completedAt: string | null; createdAt: string;
  templateName: string; templateCategory: string;
}

interface OshaIncident {
  id: string; caseNumber: string; projectId: string | null;
  employeeName: string; employeeJobTitle: string | null;
  dateOfInjury: string; timeOfEvent: string | null;
  locationOfIncident: string | null; eventDescription: string;
  injuryIllnessType: string; bodyPartAffected: string;
  objectOrSubstance: string | null; treatmentType: string;
  hospitalName: string | null; wasHospitalized: boolean;
  daysAwayFromWork: number; daysOfRestrictedDuty: number;
  classification: string; isRecordable: boolean; resultedInDeath: boolean;
  reportedByName: string | null; createdAt: string;
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

type MainTab = "programs" | "assignments" | "toolbox-talks" | "checklists" | "osha-log";

export default function SafetyTrainingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<MainTab>("programs");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [empFilter, setEmpFilter] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");

  const [showCreateProgram, setShowCreateProgram] = useState(false);
  const [editProgram, setEditProgram] = useState<Training | null>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignTrainingId, setAssignTrainingId] = useState("");
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completingAssignment, setCompletingAssignment] = useState<Assignment | null>(null);

  const { permissions } = useDashboardCustomization();
  const canManageSafety = !!permissions.canManageSafety || ["ADMIN", "MANAGER"].includes(user?.role || "");
  const isAdmin = canManageSafety;

  const { data: trainings = [], isLoading: loadingTrainings } = useQuery<Training[]>({ queryKey: ["/api/safety-training"] });
  const { data: assignments = [], isLoading: loadingAssignments } = useQuery<Assignment[]>({ queryKey: ["/api/safety-training/assignments"] });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/auth/manage-workers"], enabled: isAdmin,
    select: (data: Employee[] | { workers: Employee[] }) => (Array.isArray(data) ? data : data?.workers ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/safety-training", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] }); setShowCreateProgram(false); toast({ title: "Training program created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: unknown }) => apiRequest("PATCH", `/api/safety-training/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] }); setEditProgram(null); toast({ title: "Training program updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/safety-training/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] }); toast({ title: "Training program removed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const assignMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/safety-training/assign", body),
    onSuccess: (data: Response) => { queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments"] }); queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] }); setShowAssignDialog(false); toast({ title: "Training assigned" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const completeMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: unknown }) => apiRequest("PATCH", `/api/safety-training/assignments/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments"] }); queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] }); setShowCompleteDialog(false); setCompletingAssignment(null); toast({ title: "Training marked as completed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const removeAssignmentMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/safety-training/assignments/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments"] }); queryClient.invalidateQueries({ queryKey: ["/api/safety-training"] }); toast({ title: "Assignment removed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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

  const tabs: { key: MainTab; label: string; icon: React.ElementType }[] = [
    { key: "programs", label: "Training Programs", icon: BookOpen },
    { key: "assignments", label: "Assignments", icon: Users },
    { key: "toolbox-talks", label: "Toolbox Talks", icon: MessageSquare },
    { key: "checklists", label: "Checklists", icon: ClipboardList },
    { key: "osha-log", label: "OSHA Log", icon: FileWarning },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="safety-training-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="page-title">Safety Training</h1>
            <p className="text-sm text-muted-foreground">Manage safety training, toolbox talks, checklists, and OSHA reporting</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && tab === "programs" && (
            <>
              <Button variant="outline" size="sm" onClick={() => window.open(`/api/safety-training/export/pdf`, "_blank")} data-testid="button-export-all">
                <Download className="h-4 w-4 mr-1" /> Export All (PDF)
              </Button>
              <Button size="sm" onClick={() => setShowCreateProgram(true)} data-testid="button-create-program">
                <Plus className="h-4 w-4 mr-1" /> New Training
              </Button>
            </>
          )}
        </div>
      </div>

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

      {/* Mobile: dropdown tab selector */}
      <div className="md:hidden">
        <Select value={tab} onValueChange={(v) => setTab(v as MainTab)}>
          <SelectTrigger className="h-11" data-testid="select-tab-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tabs.map(t => (
              <SelectItem key={t.key} value={t.key} data-testid={`tab-option-${t.key}`}>
                <span className="flex items-center gap-2">
                  <t.icon className="h-4 w-4" /> {t.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Desktop: horizontal tabs */}
      <div className="hidden md:flex gap-1 border-b overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${t.key}`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

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
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditProgram(t)} data-testid={`button-edit-training-${t.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (confirm("Remove this training program?")) deleteMutation.mutate(t.id); }} data-testid={`button-delete-training-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
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
                    {t.materials && <div className="text-xs text-muted-foreground"><span className="font-medium">Materials:</span> {t.materials}</div>}
                    <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
                      <span>{t.totalAssigned} assigned · {t.totalCompleted} completed</span>
                      {t.totalAssigned > 0 && <span className="font-medium text-green-600">{Math.round((t.totalCompleted / t.totalAssigned) * 100)}%</span>}
                    </div>
                    {isAdmin && (
                      <Button variant="outline" size="sm" className="w-full" onClick={() => { setAssignTrainingId(t.id); setShowAssignDialog(true); }} data-testid={`button-assign-training-${t.id}`}>
                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign Employees
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "assignments" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Search employee or training..." value={searchQ} onChange={e => setSearchQ(e.target.value)} className="max-w-xs min-h-[44px] sm:min-h-0 sm:h-8 text-sm" data-testid="input-search-assignments" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 min-h-[44px] sm:min-h-0 sm:h-8 text-sm" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="OVERDUE">Overdue</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && uniqueEmployees.length > 0 && (
              <Select value={empFilter} onValueChange={setEmpFilter}>
                <SelectTrigger className="w-44 min-h-[44px] sm:min-h-0 sm:h-8 text-sm" data-testid="select-employee-filter"><SelectValue placeholder="Employee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Employees</SelectItem>
                  {uniqueEmployees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {isAdmin && empFilter !== "ALL" && (
              <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0 sm:h-8 text-xs" onClick={() => window.open(`/api/safety-training/export/pdf?employeeId=${empFilter}`, "_blank")} data-testid="button-export-employee">
                <Download className="h-3.5 w-3.5 mr-1" /> Export Employee PDF
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
            <>
            {/* Mobile card view */}
            <div className="md:hidden space-y-3" data-testid="assignments-cards">
              {filteredAssignments.map(a => (
                <Card key={a.id} className="p-4 space-y-3" data-testid={`card-assignment-${a.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm">{a.employeeFirstName} {a.employeeLastName}</div>
                      <div className="text-xs text-muted-foreground">{a.trainingTitle}</div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-xs">{a.trainingCategory}</Badge>
                    {a.trainingDuration && <Badge variant="outline" className="text-xs">{a.trainingDuration} min</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div><span className="font-medium">Assigned:</span> {fmtDate(a.assignedAt)}</div>
                    <div><span className="font-medium">Due:</span> {a.dueDate ? fmtDate(a.dueDate) : "—"}</div>
                    {a.completedAt && (
                      <div className="col-span-2 text-green-700">
                        Completed: {fmtDate(a.completedAt)}
                        {a.completedByName && <span> by {a.completedByName}</span>}
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2 pt-1">
                      {a.status !== "COMPLETED" && (
                        <Button variant="outline" size="sm" className="flex-1 min-h-[44px] text-xs" onClick={() => { setCompletingAssignment(a); setShowCompleteDialog(true); }} data-testid={`button-mark-complete-${a.id}`}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Complete
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => window.open(`/api/safety-training/export/pdf?employeeId=${a.employeeId}`, "_blank")} data-testid={`button-export-row-${a.id}`}><Download className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="min-h-[44px] text-destructive hover:text-destructive" onClick={() => { if (confirm("Remove this assignment?")) removeAssignmentMutation.mutate(a.id); }} data-testid={`button-remove-assignment-${a.id}`}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
            {/* Desktop table view */}
            <div className="hidden md:block rounded-lg border overflow-hidden">
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
                            {a.status !== "COMPLETED" && isAdmin && (
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setCompletingAssignment(a); setShowCompleteDialog(true); }} data-testid={`button-mark-complete-${a.id}`}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                              </Button>
                            )}
                            {isAdmin && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(`/api/safety-training/export/pdf?employeeId=${a.employeeId}`, "_blank")} data-testid={`button-export-row-${a.id}`} title="Export employee PDF"><Download className="h-3 w-3" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (confirm("Remove this assignment?")) removeAssignmentMutation.mutate(a.id); }} data-testid={`button-remove-assignment-${a.id}`}><X className="h-3 w-3" /></Button>
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
            </>
          )}
        </div>
      )}

      {tab === "toolbox-talks" && <ToolboxTalksTab isAdmin={isAdmin} />}
      {tab === "checklists" && <SafetyChecklistsTab isAdmin={isAdmin} />}
      {tab === "osha-log" && <OshaLogTab isAdmin={isAdmin} />}

      <TrainingFormDialog open={showCreateProgram} onClose={() => setShowCreateProgram(false)} onSave={(data) => createMutation.mutate(data)} isSaving={createMutation.isPending} title="New Training Program" />
      {editProgram && <TrainingFormDialog open={!!editProgram} onClose={() => setEditProgram(null)} onSave={(data) => updateMutation.mutate({ id: editProgram.id, ...data })} isSaving={updateMutation.isPending} title="Edit Training Program" defaultValues={editProgram} />}
      <AssignDialog open={showAssignDialog} onClose={() => { setShowAssignDialog(false); setAssignTrainingId(""); }} trainings={trainings} employees={employees} defaultTrainingId={assignTrainingId} onAssign={(data) => assignMutation.mutate(data)} isSaving={assignMutation.isPending} />
      {completingAssignment && <CompleteDialog open={showCompleteDialog} assignment={completingAssignment} onClose={() => { setShowCompleteDialog(false); setCompletingAssignment(null); }} onSave={(data) => completeMutation.mutate({ id: completingAssignment.id, ...data })} isSaving={completeMutation.isPending} isAdmin={isAdmin} />}
    </div>
  );
}

// ==================== Toolbox Talks Tab ====================
function ToolboxTalksTab({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<"topics" | "scheduled">("scheduled");
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingTopic, setEditingTopic] = useState<ToolboxTopic | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showAttendance, setShowAttendance] = useState<string | null>(null);

  const { data: topics = [], isLoading: topicsLoading } = useQuery<ToolboxTopic[]>({ queryKey: ["/api/toolbox-talks/topics"] });
  const { data: scheduled = [], isLoading: scheduledLoading } = useQuery<ScheduledTalk[]>({ queryKey: ["/api/toolbox-talks/scheduled"] });
  const { data: summary } = useQuery<{ total: number; completed: number; upcoming: number; overdue: number }>({ queryKey: ["/api/toolbox-talks/summary"] });

  const createTopic = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/toolbox-talks/topics", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/topics"] }); setShowTopicForm(false); toast({ title: "Topic created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateTopic = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: unknown }) => apiRequest("PATCH", `/api/toolbox-talks/topics/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/topics"] }); setEditingTopic(null); toast({ title: "Topic updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteTopic = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/toolbox-talks/topics/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/topics"] }); toast({ title: "Topic removed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const scheduleTalk = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/toolbox-talks/scheduled", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/scheduled"] }); queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/summary"] }); setShowScheduleForm(false); toast({ title: "Talk scheduled" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const completeTalk = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/toolbox-talks/scheduled/${id}`, { status: "COMPLETED" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/scheduled"] }); queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/summary"] }); toast({ title: "Talk marked complete" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteScheduled = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/toolbox-talks/scheduled/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/scheduled"] }); queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/summary"] }); toast({ title: "Scheduled talk removed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const recordAttendance = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", `/api/toolbox-talks/scheduled/${body.talkId}/attendance`, body),
    onSuccess: () => { toast({ title: "Attendance recorded" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="toolbox-talks-tab">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant={subTab === "scheduled" ? "default" : "outline"} size="sm" onClick={() => setSubTab("scheduled")} data-testid="subtab-scheduled">
            <Calendar className="h-4 w-4 mr-1" /> Scheduled ({summary?.upcoming ?? 0} upcoming)
          </Button>
          <Button variant={subTab === "topics" ? "default" : "outline"} size="sm" onClick={() => setSubTab("topics")} data-testid="subtab-topics">
            <BookOpen className="h-4 w-4 mr-1" /> Topic Library ({topics.length})
          </Button>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {subTab === "topics" && <Button size="sm" onClick={() => setShowTopicForm(true)} data-testid="button-new-topic"><Plus className="h-4 w-4 mr-1" /> New Topic</Button>}
            {subTab === "scheduled" && <Button size="sm" onClick={() => setShowScheduleForm(true)} data-testid="button-schedule-talk"><Plus className="h-4 w-4 mr-1" /> Schedule Talk</Button>}
          </div>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <Card className="p-3 text-center"><div className="text-lg font-bold text-blue-600">{summary.total}</div><div className="text-xs text-muted-foreground">Total</div></Card>
          <Card className="p-3 text-center"><div className="text-lg font-bold text-green-600">{summary.completed}</div><div className="text-xs text-muted-foreground">Completed</div></Card>
          <Card className="p-3 text-center"><div className="text-lg font-bold text-amber-600">{summary.upcoming}</div><div className="text-xs text-muted-foreground">Upcoming</div></Card>
          <Card className="p-3 text-center"><div className="text-lg font-bold text-red-600">{summary.overdue}</div><div className="text-xs text-muted-foreground">Overdue</div></Card>
        </div>
      )}

      {subTab === "topics" && (
        topicsLoading ? <Skeleton className="h-48" /> : topics.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-topics">
            <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="font-medium">No toolbox talk topics yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {topics.map(t => (
              <Card key={t.id} className="group hover:shadow-md transition-shadow" data-testid={`card-topic-${t.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{t.title}</CardTitle>
                    {isAdmin && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingTopic(t)} data-testid={`button-edit-topic-${t.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Remove?")) deleteTopic.mutate(t.id); }} data-testid={`button-delete-topic-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs w-fit">{t.category}</Badge>
                </CardHeader>
                <CardContent>
                  {t.content && <p className="text-sm text-muted-foreground line-clamp-3">{t.content}</p>}
                  {t.attachments && <div className="text-xs text-muted-foreground mt-2"><span className="font-medium">Attachments:</span> {t.attachments}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {subTab === "scheduled" && (
        scheduledLoading ? <Skeleton className="h-48" /> : scheduled.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-scheduled">
            <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="font-medium">No scheduled toolbox talks</p>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduled.map(s => {
              const isOverdue = s.status === "SCHEDULED" && s.scheduledDate < new Date().toISOString().split("T")[0];
              return (
                <Card key={s.id} className="p-4" data-testid={`card-scheduled-${s.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{s.topicTitle}</span>
                        <Badge variant="secondary" className="text-xs">{s.topicCategory}</Badge>
                        {s.status === "COMPLETED" && <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge>}
                        {isOverdue && <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">Overdue</Badge>}
                        {s.status === "SCHEDULED" && !isOverdue && <Badge className="bg-blue-500/15 text-blue-700 border-transparent text-xs">Scheduled</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Date: {fmtDate(s.scheduledDate)}</span>
                        {s.presenter && <span>Presenter: {s.presenter}</span>}
                        {s.notes && <span>Notes: {s.notes}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {s.status !== "COMPLETED" && isAdmin && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => completeTalk.mutate(s.id)} data-testid={`button-complete-talk-${s.id}`}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAttendance(s.id)} data-testid={`button-attendance-${s.id}`}>
                        <Users className="h-3 w-3 mr-1" /> Attendance
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Remove?")) deleteScheduled.mutate(s.id); }} data-testid={`button-delete-scheduled-${s.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      <TopicFormDialog open={showTopicForm} onClose={() => setShowTopicForm(false)} onSave={(data) => createTopic.mutate(data)} isSaving={createTopic.isPending} title="New Toolbox Talk Topic" />
      {editingTopic && <TopicFormDialog open={!!editingTopic} onClose={() => setEditingTopic(null)} onSave={(data) => updateTopic.mutate({ id: editingTopic.id, ...data })} isSaving={updateTopic.isPending} title="Edit Topic" defaultValues={editingTopic} />}
      <ScheduleTalkDialog open={showScheduleForm} onClose={() => setShowScheduleForm(false)} topics={topics} onSave={(data) => scheduleTalk.mutate(data)} isSaving={scheduleTalk.isPending} />
      {showAttendance && <AttendanceDialog talkId={showAttendance} onClose={() => setShowAttendance(null)} onRecord={(data) => recordAttendance.mutate(data)} isSaving={recordAttendance.isPending} />}
    </div>
  );
}

// ==================== Safety Checklists Tab ====================
function SafetyChecklistsTab({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<"completed" | "templates">("completed");
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);
  const [showStartChecklist, setShowStartChecklist] = useState(false);
  const [viewingInstance, setViewingInstance] = useState<ChecklistInstance | null>(null);

  const { data: templates = [], isLoading: templatesLoading } = useQuery<ChecklistTemplate[]>({ queryKey: ["/api/safety-checklists/templates"] });
  const { data: instances = [], isLoading: instancesLoading } = useQuery<ChecklistInstance[]>({ queryKey: ["/api/safety-checklists/instances"] });
  const { data: summary } = useQuery<{ templates: number; completed: number; inProgress: number }>({ queryKey: ["/api/safety-checklists/summary"] });

  const createTemplate = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/safety-checklists/templates", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/templates"] }); queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/summary"] }); setShowTemplateForm(false); toast({ title: "Template created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateTemplate = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: unknown }) => apiRequest("PATCH", `/api/safety-checklists/templates/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/templates"] }); setEditingTemplate(null); toast({ title: "Template updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/safety-checklists/templates/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/templates"] }); queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/summary"] }); toast({ title: "Template removed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const createInstance = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/safety-checklists/instances", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/instances"] }); queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/summary"] }); setShowStartChecklist(false); toast({ title: "Checklist submitted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="checklists-tab">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant={subTab === "completed" ? "default" : "outline"} size="sm" onClick={() => setSubTab("completed")} data-testid="subtab-completed">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Completed ({instances.length})
          </Button>
          <Button variant={subTab === "templates" ? "default" : "outline"} size="sm" onClick={() => setSubTab("templates")} data-testid="subtab-templates">
            <ClipboardList className="h-4 w-4 mr-1" /> Templates ({templates.length})
          </Button>
        </div>
        <div className="flex gap-2">
          {isAdmin && <Button size="sm" onClick={() => setShowStartChecklist(true)} data-testid="button-start-checklist"><Plus className="h-4 w-4 mr-1" /> Start Checklist</Button>}
          {isAdmin && subTab === "templates" && <Button size="sm" variant="outline" onClick={() => setShowTemplateForm(true)} data-testid="button-new-template"><Plus className="h-4 w-4 mr-1" /> New Template</Button>}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center"><div className="text-lg font-bold text-blue-600">{summary.templates}</div><div className="text-xs text-muted-foreground">Templates</div></Card>
          <Card className="p-3 text-center"><div className="text-lg font-bold text-green-600">{summary.completed}</div><div className="text-xs text-muted-foreground">Completed</div></Card>
          <Card className="p-3 text-center"><div className="text-lg font-bold text-amber-600">{summary.inProgress}</div><div className="text-xs text-muted-foreground">In Progress</div></Card>
        </div>
      )}

      {subTab === "templates" && (
        templatesLoading ? <Skeleton className="h-48" /> : templates.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-templates">
            <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="font-medium">No checklist templates yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {templates.map(t => {
              let items: string[] = [];
              try { items = JSON.parse(t.itemsJson); } catch {}
              return (
                <Card key={t.id} className="group hover:shadow-md transition-shadow" data-testid={`card-template-${t.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{t.name}</CardTitle>
                      {isAdmin && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingTemplate(t)} data-testid={`button-edit-template-${t.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Remove?")) deleteTemplate.mutate(t.id); }} data-testid={`button-delete-template-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-xs w-fit">{t.category}</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">{items.length} items</div>
                    {items.length > 0 && (
                      <ul className="text-xs text-muted-foreground mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                        {items.slice(0, 5).map((item, i) => <li key={i}>• {item}</li>)}
                        {items.length > 5 && <li className="text-xs italic">+{items.length - 5} more</li>}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}

      {subTab === "completed" && (
        instancesLoading ? <Skeleton className="h-48" /> : instances.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-instances">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="font-medium">No completed checklists yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {instances.map(inst => (
              <Card key={inst.id} className="p-4 hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setViewingInstance(inst)} data-testid={`card-instance-${inst.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{inst.templateName}</span>
                      <Badge variant="secondary" className="text-xs">{inst.templateCategory}</Badge>
                      {inst.status === "COMPLETED" ? <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge> : <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">In Progress</Badge>}
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      {inst.completedByName && <span>By: {inst.completedByName}</span>}
                      <span>{fmtDate(inst.completedAt || inst.createdAt)}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-view-instance-${inst.id}`}><Eye className="h-4 w-4" /></Button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      <TemplateFormDialog open={showTemplateForm} onClose={() => setShowTemplateForm(false)} onSave={(data) => createTemplate.mutate(data)} isSaving={createTemplate.isPending} title="New Checklist Template" />
      {editingTemplate && <TemplateFormDialog open={!!editingTemplate} onClose={() => setEditingTemplate(null)} onSave={(data) => updateTemplate.mutate({ id: editingTemplate.id, ...data })} isSaving={updateTemplate.isPending} title="Edit Template" defaultValues={editingTemplate} />}
      <StartChecklistDialog open={showStartChecklist} onClose={() => setShowStartChecklist(false)} templates={templates} onSave={(data) => createInstance.mutate(data)} isSaving={createInstance.isPending} />
      {viewingInstance && <ViewInstanceDialog instance={viewingInstance} onClose={() => setViewingInstance(null)} />}
    </div>
  );
}

// ==================== OSHA Log Tab ====================
function OshaLogTab({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="osha-unauthorized">
        <ShieldCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
        <p className="font-medium">Access Restricted</p>
        <p className="text-sm mt-1">OSHA incident logs contain sensitive employee medical information and are only accessible to safety administrators.</p>
      </div>
    );
  }
  return <OshaLogTabContent />;
}

function OshaLogTabContent() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingIncident, setEditingIncident] = useState<OshaIncident | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const { data: oshaLogData, isLoading } = useQuery<{
    year: string;
    records: OshaIncident[];
    summary: {
      totalRecordable: number; deaths: number; daysAwayCases: number;
      restrictedCases: number; otherRecordable: number;
      totalDaysAway: number; totalDaysRestricted: number;
    };
  }>({
    queryKey: ["/api/osha-incidents/300-log", year],
    queryFn: async () => {
      const res = await fetch(`/api/osha-incidents/300-log?year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
  const incidents = oshaLogData?.records ?? [];
  const logSummary = oshaLogData?.summary;

  const createIncident = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/osha-incidents", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/osha-incidents/300-log"] }); setShowForm(false); toast({ title: "Incident report created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateIncident = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: unknown }) => apiRequest("PATCH", `/api/osha-incidents/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/osha-incidents/300-log"] }); setEditingIncident(null); toast({ title: "Incident updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteIncident = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/osha-incidents/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/osha-incidents/300-log"] }); toast({ title: "Incident deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="osha-log-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28 h-8" data-testid="select-osha-year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i)).map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/osha-incidents/300a-pdf?year=${year}`, "_blank")} data-testid="button-export-300a">
            <Download className="h-4 w-4 mr-1" /> Export 300A PDF
          </Button>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} data-testid="button-new-incident"><Plus className="h-4 w-4 mr-1" /> Report Incident</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-3 text-center"><div className="text-lg font-bold text-red-600">{logSummary?.totalRecordable ?? 0}</div><div className="text-xs text-muted-foreground">Recordable Cases</div></Card>
        <Card className="p-3 text-center"><div className="text-lg font-bold text-purple-600">{logSummary?.deaths ?? 0}</div><div className="text-xs text-muted-foreground">Fatalities</div></Card>
        <Card className="p-3 text-center"><div className="text-lg font-bold text-amber-600">{logSummary?.totalDaysAway ?? 0}</div><div className="text-xs text-muted-foreground">Days Away</div></Card>
        <Card className="p-3 text-center"><div className="text-lg font-bold text-blue-600">{logSummary?.totalDaysRestricted ?? 0}</div><div className="text-xs text-muted-foreground">Days Restricted</div></Card>
        <Card className="p-3 text-center"><div className="text-lg font-bold">{logSummary?.otherRecordable ?? 0}</div><div className="text-xs text-muted-foreground">Other Recordable</div></Card>
      </div>

      {isLoading ? <Skeleton className="h-48" /> : incidents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="empty-osha">
          <FileWarning className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="font-medium">No incidents reported for {year}</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="osha-table">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Case #</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Employee</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Date</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Type</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Body Part</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Classification</th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground text-xs">Days Away</th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground text-xs">Restricted</th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground text-xs">Recordable</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map(inc => (
                  <tr key={inc.id} className="border-b hover:bg-muted/30" data-testid={`row-incident-${inc.id}`}>
                    <td className="px-3 py-2 font-mono text-xs">{inc.caseNumber}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-xs">{inc.employeeName}</div>
                      {inc.employeeJobTitle && <div className="text-xs text-muted-foreground">{inc.employeeJobTitle}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{fmtDate(inc.dateOfInjury)}</td>
                    <td className="px-3 py-2 text-xs">{INJURY_TYPES.find(t => t.value === inc.injuryIllnessType)?.label || inc.injuryIllnessType}</td>
                    <td className="px-3 py-2 text-xs">{inc.bodyPartAffected}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">{CLASSIFICATIONS.find(c => c.value === inc.classification)?.label || inc.classification}</Badge>
                    </td>
                    <td className="px-3 py-2 text-center text-xs">{inc.daysAwayFromWork}</td>
                    <td className="px-3 py-2 text-center text-xs">{inc.daysOfRestrictedDuty}</td>
                    <td className="px-3 py-2 text-center">{inc.isRecordable ? <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingIncident(inc)} data-testid={`button-edit-incident-${inc.id}`}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Delete this incident report?")) deleteIncident.mutate(inc.id); }} data-testid={`button-delete-incident-${inc.id}`}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OshaIncidentFormDialog open={showForm} onClose={() => setShowForm(false)} onSave={(data) => createIncident.mutate(data)} isSaving={createIncident.isPending} title="Report Incident" />
      {editingIncident && <OshaIncidentFormDialog open={!!editingIncident} onClose={() => setEditingIncident(null)} onSave={(data) => updateIncident.mutate({ id: editingIncident.id, ...data })} isSaving={updateIncident.isPending} title="Edit Incident" defaultValues={editingIncident} />}
    </div>
  );
}

// ==================== Dialog Components ====================

function TrainingFormDialog({ open, onClose, onSave, isSaving, title, defaultValues }: {
  open: boolean; onClose: () => void; onSave: (data: Record<string, unknown>) => void; isSaving: boolean; title: string; defaultValues?: Partial<Training>;
}) {
  const [form, setForm] = useState({
    title: defaultValues?.title ?? "", description: defaultValues?.description ?? "",
    category: defaultValues?.category ?? "", frequency: defaultValues?.frequency ?? "ONCE",
    durationMinutes: defaultValues?.durationMinutes ?? "", materials: defaultValues?.materials ?? "",
  });
  const set = (key: string, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-training-form">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="training-title">Training Title *</Label><Input id="training-title" value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g., Fall Protection Basics" data-testid="input-training-title" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Category *</Label><Select value={form.category} onValueChange={v => set("category", v)}><SelectTrigger data-testid="select-category"><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Frequency *</Label><Select value={form.frequency} onValueChange={v => set("frequency", v)}><SelectTrigger data-testid="select-frequency"><SelectValue /></SelectTrigger><SelectContent>{FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="duration">Duration (minutes)</Label><Input id="duration" type="number" min={1} value={form.durationMinutes} onChange={e => set("durationMinutes", e.target.value)} placeholder="e.g., 60" data-testid="input-duration" /></div>
          <div className="space-y-1.5"><Label htmlFor="description">Description</Label><Textarea id="description" rows={2} value={form.description} onChange={e => set("description", e.target.value)} placeholder="What does this training cover?" data-testid="input-description" /></div>
          <div className="space-y-1.5"><Label htmlFor="materials">Training Materials / Resources</Label><Textarea id="materials" rows={2} value={form.materials} onChange={e => set("materials", e.target.value)} placeholder="e.g., OSHA 1926.502 manual" data-testid="input-materials" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-form">Cancel</Button>
          <Button onClick={() => onSave({ ...form, durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null })} disabled={!form.title || !form.category || isSaving} data-testid="button-save-program">{isSaving ? "Saving..." : "Save Training"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ open, onClose, trainings, employees, defaultTrainingId, onAssign, isSaving }: {
  open: boolean; onClose: () => void; trainings: Training[]; employees: Employee[]; defaultTrainingId: string; onAssign: (data: Record<string, unknown>) => void; isSaving: boolean;
}) {
  const [trainingId, setTrainingId] = useState(defaultTrainingId);
  const [dueDate, setDueDate] = useState("");
  const [assignAll, setAssignAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleEmployee = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-assign">
        <DialogHeader><DialogTitle>Assign Training to Employees</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Training Program *</Label><Select value={trainingId} onValueChange={setTrainingId}><SelectTrigger data-testid="select-assign-training"><SelectValue placeholder="Select training" /></SelectTrigger><SelectContent>{trainings.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="due-date">Due Date (optional)</Label><Input id="due-date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-due-date" /></div>
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Checkbox id="assign-all" checked={assignAll} onCheckedChange={v => { setAssignAll(!!v); if (v) setSelectedIds([]); }} data-testid="checkbox-assign-all" /><Label htmlFor="assign-all" className="font-medium cursor-pointer">Assign to All Active Employees</Label></div>
            {!assignAll && (
              <div className="border rounded-lg p-3 max-h-52 overflow-y-auto space-y-1" data-testid="employee-list">
                {employees.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No employees found</p> : employees.map(e => (
                  <div key={e.id} className="flex items-center gap-2 py-1"><Checkbox id={`emp-${e.id}`} checked={selectedIds.includes(e.id)} onCheckedChange={() => toggleEmployee(e.id)} data-testid={`checkbox-employee-${e.id}`} /><Label htmlFor={`emp-${e.id}`} className="cursor-pointer text-sm">{e.firstName} {e.lastName}<span className="text-muted-foreground ml-1.5 text-xs">{e.email}</span></Label></div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-assign">Cancel</Button>
          <Button onClick={() => onAssign({ trainingId, dueDate: dueDate || undefined, assignAll, employeeIds: assignAll ? [] : selectedIds })} disabled={!trainingId || (!assignAll && selectedIds.length === 0) || isSaving} data-testid="button-confirm-assign">{isSaving ? "Assigning..." : `Assign${!assignAll && selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ open, assignment, onClose, onSave, isSaving, isAdmin }: {
  open: boolean; assignment: Assignment; onClose: () => void; onSave: (data: Record<string, unknown>) => void; isSaving: boolean; isAdmin: boolean;
}) {
  const { user } = useAuth();
  const [completedByName, setCompletedByName] = useState(`${user?.firstName || ""} ${user?.lastName || ""}`.trim());
  const [notes, setNotes] = useState(assignment.notes ?? "");
  const [ack, setAck] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-complete">
        <DialogHeader><DialogTitle>Mark Training Complete</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted/40 rounded-lg p-3"><p className="font-medium text-sm">{assignment.trainingTitle}</p><p className="text-xs text-muted-foreground mt-0.5">{assignment.employeeFirstName} {assignment.employeeLastName}</p></div>
          <div className="space-y-1.5"><Label htmlFor="completed-by">Completed / Signed off by</Label><Input id="completed-by" value={completedByName} onChange={e => setCompletedByName(e.target.value)} placeholder="Your full name" data-testid="input-completed-by" /></div>
          <div className="space-y-1.5"><Label htmlFor="completion-notes">Notes (optional)</Label><Textarea id="completion-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this training session..." data-testid="input-completion-notes" /></div>
          <div className="space-y-1.5"><Label htmlFor="acknowledgment">Employee Acknowledgment</Label><Input id="acknowledgment" value={ack} onChange={e => setAck(e.target.value)} placeholder='Type "I acknowledge completion of this training"' data-testid="input-acknowledgment" /><p className="text-xs text-muted-foreground">This serves as a digital acknowledgment for record-keeping.</p></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-complete">Cancel</Button>
          <Button onClick={() => onSave({ status: "COMPLETED", completedByName, notes, acknowledgmentSignature: ack })} disabled={!completedByName || isSaving} data-testid="button-confirm-complete"><CheckCircle2 className="h-4 w-4 mr-1" />{isSaving ? "Saving..." : "Mark Complete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopicFormDialog({ open, onClose, onSave, isSaving, title, defaultValues }: {
  open: boolean; onClose: () => void; onSave: (data: Record<string, unknown>) => void; isSaving: boolean; title: string; defaultValues?: Partial<ToolboxTopic>;
}) {
  const [form, setForm] = useState({
    title: defaultValues?.title ?? "", content: defaultValues?.content ?? "",
    category: defaultValues?.category ?? "", attachments: defaultValues?.attachments ?? "",
  });
  const set = (key: string, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-topic-form">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Topic Title *</Label><Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g., Heat Stress Prevention" data-testid="input-topic-title" /></div>
          <div className="space-y-1.5"><Label>Category *</Label><Select value={form.category} onValueChange={v => set("category", v)}><SelectTrigger data-testid="select-topic-category"><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Talk Content</Label><Textarea rows={4} value={form.content} onChange={e => set("content", e.target.value)} placeholder="Key talking points, discussion items..." data-testid="input-topic-content" /></div>
          <div className="space-y-1.5"><Label>Attachments (URLs or descriptions)</Label><Input value={form.attachments} onChange={e => set("attachments", e.target.value)} placeholder="e.g., safety-manual.pdf, osha-poster.jpg" data-testid="input-topic-attachments" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.title || !form.category || isSaving} data-testid="button-save-topic">{isSaving ? "Saving..." : "Save Topic"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleTalkDialog({ open, onClose, topics, onSave, isSaving }: {
  open: boolean; onClose: () => void; topics: ToolboxTopic[]; onSave: (data: Record<string, unknown>) => void; isSaving: boolean;
}) {
  const [form, setForm] = useState({ topicId: "", scheduledDate: "", presenter: "", notes: "", projectId: "" });
  const set = (key: string, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }));
  const { data: projectsResponse } = useQuery<{ data: { id: string; name: string }[] }>({ queryKey: ["/api/projects"] });
  const projects = projectsResponse?.data || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-schedule-talk">
        <DialogHeader><DialogTitle>Schedule Toolbox Talk</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Topic *</Label><Select value={form.topicId} onValueChange={v => set("topicId", v)}><SelectTrigger data-testid="select-schedule-topic"><SelectValue placeholder="Select topic" /></SelectTrigger><SelectContent>{topics.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Date *</Label><Input type="date" value={form.scheduledDate} onChange={e => set("scheduledDate", e.target.value)} data-testid="input-schedule-date" /></div>
          <div className="space-y-1.5"><Label>Project (optional)</Label><Select value={form.projectId || "__NONE__"} onValueChange={v => set("projectId", v === "__NONE__" ? "" : v)}><SelectTrigger data-testid="select-schedule-project"><SelectValue placeholder="Company-wide" /></SelectTrigger><SelectContent><SelectItem value="__NONE__">Company-wide</SelectItem>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Presenter</Label><Input value={form.presenter} onChange={e => set("presenter", e.target.value)} placeholder="Who will lead the talk?" data-testid="input-presenter" /></div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Additional notes..." data-testid="input-schedule-notes" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({ ...form, projectId: form.projectId || undefined })} disabled={!form.topicId || !form.scheduledDate || isSaving} data-testid="button-confirm-schedule">{isSaving ? "Scheduling..." : "Schedule Talk"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttendanceDialog({ talkId, onClose, onRecord, isSaving }: {
  talkId: string; onClose: () => void; onRecord: (data: Record<string, unknown>) => void; isSaving: boolean;
}) {
  const { user } = useAuth();
  const [signature, setSignature] = useState("");
  const { data: attendance = [], isLoading } = useQuery<{ id: string; employeeFirstName: string; employeeLastName: string; signedAt: string }[]>({
    queryKey: ["/api/toolbox-talks/scheduled", talkId, "attendance"],
    queryFn: async () => {
      const res = await fetch(`/api/toolbox-talks/scheduled/${talkId}/attendance`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-attendance">
        <DialogHeader><DialogTitle>Toolbox Talk Attendance</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {isLoading ? <Skeleton className="h-24" /> : attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No attendance recorded yet</p>
          ) : (
            <div className="space-y-1 border rounded-lg p-3 max-h-48 overflow-y-auto">
              {attendance.map((a: { id: string; employeeFirstName: string; employeeLastName: string; signedAt: string }) => (
                <div key={a.id} className="flex items-center justify-between py-1 text-sm">
                  <span>{a.employeeFirstName} {a.employeeLastName}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(a.signedAt)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="border-t pt-3 space-y-2">
            <Label>Sign In (your signature)</Label>
            <Input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Type your name to sign" data-testid="input-attendance-signature" />
            <Button className="w-full" onClick={() => { onRecord({ talkId, employeeIds: [user!.id], signature }); queryClient.invalidateQueries({ queryKey: ["/api/toolbox-talks/scheduled", talkId, "attendance"] }); }} disabled={!signature || isSaving} data-testid="button-record-attendance">
              {isSaving ? "Recording..." : "Record My Attendance"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateFormDialog({ open, onClose, onSave, isSaving, title, defaultValues }: {
  open: boolean; onClose: () => void; onSave: (data: Record<string, unknown>) => void; isSaving: boolean; title: string; defaultValues?: Partial<ChecklistTemplate>;
}) {
  let defaultItems: string[] = [];
  try { if (defaultValues?.itemsJson) defaultItems = JSON.parse(defaultValues.itemsJson); } catch {}
  const [form, setForm] = useState({
    name: defaultValues?.name ?? "", category: defaultValues?.category ?? "",
    itemsText: defaultItems.join("\n"),
  });
  const set = (key: string, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-template-form">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Template Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g., Daily Pre-Task Safety Checklist" data-testid="input-template-name" /></div>
          <div className="space-y-1.5"><Label>Category *</Label><Select value={form.category} onValueChange={v => set("category", v)}><SelectTrigger data-testid="select-template-category"><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{CHECKLIST_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Checklist Items (one per line) *</Label><Textarea rows={8} value={form.itemsText} onChange={e => set("itemsText", e.target.value)} placeholder={"PPE worn correctly\nWork area clear of hazards\nTools inspected\nFall protection in place"} data-testid="input-template-items" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { const items = form.itemsText.split("\n").map(s => s.trim()).filter(Boolean); onSave({ name: form.name, category: form.category, itemsJson: JSON.stringify(items) }); }} disabled={!form.name || !form.category || !form.itemsText.trim() || isSaving} data-testid="button-save-template">{isSaving ? "Saving..." : "Save Template"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartChecklistDialog({ open, onClose, templates, onSave, isSaving }: {
  open: boolean; onClose: () => void; templates: ChecklistTemplate[]; onSave: (data: Record<string, unknown>) => void; isSaving: boolean;
}) {
  const [templateId, setTemplateId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [itemNotes, setItemNotes] = useState<Record<number, string>>({});
  const [itemPhotos, setItemPhotos] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  const { data: projectsResponse } = useQuery<{ data: { id: string; name: string }[] }>({ queryKey: ["/api/projects"] });
  const projects = projectsResponse?.data || [];

  const selectedTemplate = templates.find(t => t.id === templateId);
  let items: string[] = [];
  try { if (selectedTemplate) items = JSON.parse(selectedTemplate.itemsJson); } catch {}

  const setResponse = (idx: number, val: string) => setResponses(prev => ({ ...prev, [idx]: val }));
  const allAnswered = items.length > 0 && items.every((_, i) => responses[i]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-start-checklist">
        <DialogHeader><DialogTitle>Complete Safety Checklist</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Checklist Template *</Label>
            <Select value={templateId} onValueChange={v => { setTemplateId(v); setResponses({}); setItemNotes({}); setItemPhotos({}); }}>
              <SelectTrigger data-testid="select-checklist-template"><SelectValue placeholder="Select checklist" /></SelectTrigger>
              <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.category})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Project (optional)</Label>
            <Select value={projectId || "__NONE__"} onValueChange={v => setProjectId(v === "__NONE__" ? "" : v)}>
              <SelectTrigger data-testid="select-checklist-project"><SelectValue placeholder="Company-wide" /></SelectTrigger>
              <SelectContent><SelectItem value="__NONE__">Company-wide</SelectItem>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {items.length > 0 && (
            <div className="space-y-2 border rounded-lg p-3">
              {items.map((item, i) => (
                <div key={i} className="py-1.5 border-b last:border-0 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm flex-1">{item}</span>
                    <div className="flex gap-1">
                      {["PASS", "FAIL", "N/A"].map(v => (
                        <Button key={v} variant={responses[i] === v ? (v === "PASS" ? "default" : v === "FAIL" ? "destructive" : "secondary") : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => setResponse(i, v)} data-testid={`button-response-${i}-${v}`}>{v}</Button>
                      ))}
                    </div>
                  </div>
                  {responses[i] === "FAIL" && (
                    <>
                      <Input
                        placeholder="Note: describe the issue..."
                        value={itemNotes[i] || ""}
                        onChange={e => setItemNotes(prev => ({ ...prev, [i]: e.target.value }))}
                        className="h-7 text-xs"
                        data-testid={`input-item-note-${i}`}
                      />
                      <Input
                        placeholder="Photo URL (optional)"
                        value={itemPhotos[i] || ""}
                        onChange={e => setItemPhotos(prev => ({ ...prev, [i]: e.target.value }))}
                        className="h-7 text-xs"
                        data-testid={`input-item-photo-${i}`}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional observations..." data-testid="input-checklist-notes" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { const respArr = items.map((item, i) => ({ item, result: responses[i] || "N/A", notes: itemNotes[i] || "", photoUrl: itemPhotos[i] || "" })); onSave({ templateId, projectId: projectId || undefined, responsesJson: JSON.stringify(respArr), notes, status: "COMPLETED" }); }} disabled={!templateId || !allAnswered || isSaving} data-testid="button-submit-checklist">{isSaving ? "Submitting..." : "Submit Checklist"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewInstanceDialog({ instance, onClose }: { instance: ChecklistInstance; onClose: () => void }) {
  let responses: { item: string; result: string; notes?: string; photoUrl?: string }[] = [];
  try { responses = JSON.parse(instance.responsesJson); } catch {}

  const passCount = responses.filter(r => r.result === "PASS").length;
  const failCount = responses.filter(r => r.result === "FAIL").length;
  const naCount = responses.filter(r => r.result === "N/A").length;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-view-instance">
        <DialogHeader><DialogTitle>{instance.templateName}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
            <Badge variant="secondary">{instance.templateCategory}</Badge>
            {instance.completedByName && <span>By: {instance.completedByName}</span>}
            <span>{fmtDate(instance.completedAt || instance.createdAt)}</span>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-green-700">{passCount} Pass</span>
            <span className="text-red-700">{failCount} Fail</span>
            <span className="text-muted-foreground">{naCount} N/A</span>
          </div>
          {responses.length > 0 && (
            <div className="space-y-1 border rounded-lg p-3">
              {responses.map((r, i) => (
                <div key={i} className="py-1 border-b last:border-0">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{r.item}</span>
                    <Badge variant={r.result === "PASS" ? "default" : r.result === "FAIL" ? "destructive" : "secondary"} className="text-xs">{r.result}</Badge>
                  </div>
                  {r.notes && <p className="text-xs text-muted-foreground mt-0.5 pl-2">{r.notes}</p>}
                  {r.photoUrl && (
                    <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline pl-2 inline-block mt-0.5" data-testid={`link-item-photo-${i}`}>
                      View Photo
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {instance.notes && <div className="text-sm"><span className="font-medium">Notes:</span> {instance.notes}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OshaIncidentFormDialog({ open, onClose, onSave, isSaving, title, defaultValues }: {
  open: boolean; onClose: () => void; onSave: (data: Record<string, unknown>) => void; isSaving: boolean; title: string; defaultValues?: Partial<OshaIncident>;
}) {
  const [form, setForm] = useState({
    employeeName: defaultValues?.employeeName ?? "",
    employeeJobTitle: defaultValues?.employeeJobTitle ?? "",
    dateOfInjury: defaultValues?.dateOfInjury ?? new Date().toISOString().split("T")[0],
    timeOfEvent: defaultValues?.timeOfEvent ?? "",
    locationOfIncident: defaultValues?.locationOfIncident ?? "",
    eventDescription: defaultValues?.eventDescription ?? "",
    injuryIllnessType: defaultValues?.injuryIllnessType ?? "",
    bodyPartAffected: defaultValues?.bodyPartAffected ?? "",
    objectOrSubstance: defaultValues?.objectOrSubstance ?? "",
    treatmentType: defaultValues?.treatmentType ?? "",
    hospitalName: defaultValues?.hospitalName ?? "",
    wasHospitalized: defaultValues?.wasHospitalized ?? false,
    daysAwayFromWork: defaultValues?.daysAwayFromWork ?? 0,
    daysOfRestrictedDuty: defaultValues?.daysOfRestrictedDuty ?? 0,
    classification: defaultValues?.classification ?? "",
    isRecordable: defaultValues?.isRecordable ?? true,
    resultedInDeath: defaultValues?.resultedInDeath ?? false,
  });
  const set = (key: string, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-osha-form">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Employee Name *</Label><Input value={form.employeeName} onChange={e => set("employeeName", e.target.value)} placeholder="Full name" data-testid="input-osha-employee" /></div>
            <div className="space-y-1.5"><Label>Job Title</Label><Input value={form.employeeJobTitle} onChange={e => set("employeeJobTitle", e.target.value)} placeholder="Job title" data-testid="input-osha-job-title" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Date of Injury *</Label><Input type="date" value={form.dateOfInjury} onChange={e => set("dateOfInjury", e.target.value)} data-testid="input-osha-date" /></div>
            <div className="space-y-1.5"><Label>Time of Event</Label><Input type="time" value={form.timeOfEvent} onChange={e => set("timeOfEvent", e.target.value)} data-testid="input-osha-time" /></div>
            <div className="space-y-1.5"><Label>Location</Label><Input value={form.locationOfIncident} onChange={e => set("locationOfIncident", e.target.value)} placeholder="Where it happened" data-testid="input-osha-location" /></div>
          </div>
          <div className="space-y-1.5"><Label>Event Description *</Label><Textarea rows={3} value={form.eventDescription} onChange={e => set("eventDescription", e.target.value)} placeholder="Describe what happened..." data-testid="input-osha-description" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Injury/Illness Type *</Label><Select value={form.injuryIllnessType} onValueChange={v => set("injuryIllnessType", v)}><SelectTrigger data-testid="select-osha-injury-type"><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{INJURY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Body Part Affected *</Label><Input value={form.bodyPartAffected} onChange={e => set("bodyPartAffected", e.target.value)} placeholder="e.g., Left hand, lower back" data-testid="input-osha-body-part" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Object/Substance</Label><Input value={form.objectOrSubstance} onChange={e => set("objectOrSubstance", e.target.value)} placeholder="What caused or contributed" data-testid="input-osha-substance" /></div>
            <div className="space-y-1.5"><Label>Treatment Type *</Label><Select value={form.treatmentType} onValueChange={v => set("treatmentType", v)}><SelectTrigger data-testid="select-osha-treatment"><SelectValue placeholder="Select treatment" /></SelectTrigger><SelectContent>{TREATMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Classification *</Label><Select value={form.classification} onValueChange={v => set("classification", v)}><SelectTrigger data-testid="select-osha-classification"><SelectValue placeholder="Select classification" /></SelectTrigger><SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Hospital Name</Label><Input value={form.hospitalName} onChange={e => set("hospitalName", e.target.value)} placeholder="If applicable" data-testid="input-osha-hospital" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Days Away From Work</Label><Input type="number" min={0} value={form.daysAwayFromWork} onChange={e => set("daysAwayFromWork", Number(e.target.value))} data-testid="input-osha-days-away" /></div>
            <div className="space-y-1.5"><Label>Days of Restricted Duty</Label><Input type="number" min={0} value={form.daysOfRestrictedDuty} onChange={e => set("daysOfRestrictedDuty", Number(e.target.value))} data-testid="input-osha-days-restricted" /></div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2"><Checkbox id="recordable" checked={form.isRecordable} onCheckedChange={v => set("isRecordable", !!v)} data-testid="checkbox-recordable" /><Label htmlFor="recordable" className="cursor-pointer">OSHA Recordable</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="hospitalized" checked={form.wasHospitalized} onCheckedChange={v => set("wasHospitalized", !!v)} data-testid="checkbox-hospitalized" /><Label htmlFor="hospitalized" className="cursor-pointer">Was Hospitalized</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="death" checked={form.resultedInDeath} onCheckedChange={v => set("resultedInDeath", !!v)} data-testid="checkbox-death" /><Label htmlFor="death" className="cursor-pointer">Resulted in Death</Label></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.employeeName || !form.dateOfInjury || !form.eventDescription || !form.injuryIllnessType || !form.bodyPartAffected || !form.treatmentType || !form.classification || isSaving} data-testid="button-save-incident">{isSaving ? "Saving..." : "Save Incident Report"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
