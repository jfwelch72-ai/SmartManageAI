import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  UserPlus,
  FileWarning,
  ClipboardList,
  Wrench,
  ToggleLeft,
  ToggleRight,
  Mail,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Download,
} from "lucide-react";
import { type WorkerData, type TabKey } from "@/components/worker/types";
import { OverviewTab, SkillsTab, PerformanceTab, ProjectsTab, LogsTab } from "@/components/worker/WorkerTabs";
import { EvalDialog, SkillsDialog, AssignProjectDialog } from "@/components/worker/WorkerDialogs";

export default function WorkerDetailPage() {
  const [, params] = useRoute("/manage-workers/:id");
  const workerId = params?.id;
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentNote, setIncidentNote] = useState("");
  const [incidentDate, setIncidentDate] = useState(new Date().toISOString().split("T")[0]);

  const [logNote, setLogNote] = useState("");
  const [logCategory, setLogCategory] = useState("GENERAL");
  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showEvalDialog, setShowEvalDialog] = useState(false);
  const [showSkillsDialog, setShowSkillsDialog] = useState(false);

  const { data, isLoading, error } = useQuery<WorkerData>({
    queryKey: ["/api/auth/manage-workers", workerId],
    enabled: !!workerId,
  });

  const statusMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      return await apiRequest("PATCH", `/api/auth/manage-workers/${workerId}/status`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      toast({ title: "Worker status updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
    },
  });

  const incidentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/auth/manage-workers/${workerId}/logs`, {
        note: incidentNote,
        category: "INCIDENT",
        date: incidentDate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      toast({ title: "Incident recorded" });
      setIncidentNote("");
      setShowIncidentForm(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to record incident", description: err.message, variant: "destructive" });
    },
  });

  const addLogMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/auth/manage-workers/${workerId}/logs`, {
        note: logNote,
        category: logCategory,
        date: logDate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      toast({ title: "Log entry added" });
      setLogNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add log", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="worker-detail-loading">
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6" data-testid="worker-detail-error">
        <p className="text-sm text-destructive">Failed to load worker details.</p>
        <Link href="/manage-workers">
          <Button variant="outline" className="mt-4" data-testid="button-back-error">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Workers
          </Button>
        </Link>
      </div>
    );
  }

  const { user, skills, certifications, attendanceLogs, safetyIncidents, qualityIssues, performanceReviews, supervisorNotes, workerLogs, timeClockShifts, currentShift } = data;

  const initials = `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase();
  const fullName = `${user.firstName} ${user.lastName}`;
  const roleDisplay = user.role?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Worker";

  const attendanceReliability = (() => {
    if (attendanceLogs.length === 0) return null;
    const present = attendanceLogs.filter((l) => l.status === "PRESENT").length;
    const late = attendanceLogs.filter((l) => l.status === "LATE").length;
    return Math.round(((present + late) / attendanceLogs.length) * 100);
  })();

  const attendanceTrend = (() => {
    if (attendanceLogs.length < 2) return null;
    const now = Date.now();
    const d30 = 30 * 24 * 60 * 60 * 1000;
    const recent = attendanceLogs.filter((l) => new Date(l.date).getTime() >= now - d30);
    const previous = attendanceLogs.filter((l) => {
      const t = new Date(l.date).getTime();
      return t >= now - 2 * d30 && t < now - d30;
    });
    if (recent.length === 0 || previous.length === 0) return null;
    const recentRate = (recent.filter((l) => l.status === "PRESENT" || l.status === "LATE").length / recent.length) * 100;
    const prevRate = (previous.filter((l) => l.status === "PRESENT" || l.status === "LATE").length / previous.length) * 100;
    if (recentRate > prevRate) return "up";
    if (recentRate < prevRate) return "down";
    return null;
  })();

  const productivityLabel = (() => {
    const prodReviews = performanceReviews.filter((r) => r.productivityRating);
    if (prodReviews.length === 0) return "No Data";
    const avg = prodReviews.reduce((s, r) => s + (r.productivityRating || 0), 0) / prodReviews.length;
    if (avg >= 4) return "High";
    if (avg >= 3) return "Average";
    return "Below Average";
  })();

  const qualityLabel = (() => {
    if (qualityIssues.length === 0) return "None";
    if (qualityIssues.length <= 2) return "Low";
    if (qualityIssues.length <= 5) return "Moderate";
    return "High";
  })();

  const topSkills = [...skills].sort((a, b) => b.rating - a.rating).slice(0, 5);

  const projectGroups = (() => {
    const groups: Record<string, typeof timeClockShifts> = {};
    for (const shift of timeClockShifts) {
      if (!groups[shift.projectId]) groups[shift.projectId] = [];
      groups[shift.projectId].push(shift);
    }
    return groups;
  })();

  const projectNameMap = (() => {
    const map: Record<string, string> = {};
    for (const shift of timeClockShifts) {
      if (shift.projectName && !map[shift.projectId]) {
        map[shift.projectId] = shift.projectName;
      }
    }
    return map;
  })();

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "skills", label: "Skills & Competencies" },
    { key: "performance", label: "Performance" },
    { key: "projects", label: "Project History" },
    { key: "logs", label: "Logs / Notes" },
    { key: "safety-training", label: "Safety Training" },
  ];

  const toggleProject = (pid: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  return (
    <div className="h-full overflow-auto" data-testid="worker-detail-page">
      <div className="bg-gradient-to-r from-primary/20 to-accent/20 h-36 relative" data-testid="banner-area">
        <Link href="/manage-workers">
          <Button
            variant="outline"
            size="sm"
            className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
      </div>

      <div className="px-4 md:px-6">
        <div className="flex flex-col sm:flex-row items-start gap-4 -mt-12 mb-4">
          <Avatar className="h-24 w-24 border-4 border-background" data-testid="avatar-worker">
            <AvatarImage src={user.avatarUrl || undefined} />
            <AvatarFallback className="text-2xl font-semibold bg-primary text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="pt-2 sm:pt-14">
            <h1 className="text-2xl font-bold" data-testid="text-worker-name">{fullName}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge variant="secondary" data-testid="badge-role">{roleDisplay}</Badge>
              <Badge variant={user.isActive ? "secondary" : "destructive"} data-testid="badge-status">
                {user.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1" data-testid="text-worker-email">
              <Mail className="h-3.5 w-3.5" />
              {user.email}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6 border-b pb-4" data-testid="quick-actions">
          <Button variant="outline" size="sm" onClick={() => setShowAssignDialog(true)} data-testid="button-assign-project">
            <UserPlus className="h-4 w-4 mr-1" />
            Assign to Project
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowIncidentForm(!showIncidentForm)} data-testid="button-record-incident">
            <FileWarning className="h-4 w-4 mr-1" />
            Record Incident
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowEvalDialog(true)} data-testid="button-add-evaluation">
            <ClipboardList className="h-4 w-4 mr-1" />
            Add Evaluation
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSkillsDialog(true)} data-testid="button-update-skills">
            <Wrench className="h-4 w-4 mr-1" />
            Update Skills
          </Button>
          <Button
            variant={user.isActive ? "outline" : "default"}
            size="sm"
            onClick={() => statusMutation.mutate(!user.isActive)}
            disabled={statusMutation.isPending}
            data-testid="button-toggle-status"
          >
            {statusMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : user.isActive ? (
              <ToggleRight className="h-4 w-4 mr-1" />
            ) : (
              <ToggleLeft className="h-4 w-4 mr-1" />
            )}
            {user.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>

        {showIncidentForm && (
          <Card className="mb-4">
            <CardContent className="pt-4 space-y-3">
              <Label>Incident Description</Label>
              <Textarea
                value={incidentNote}
                onChange={(e) => setIncidentNote(e.target.value)}
                placeholder="Describe the incident..."
                rows={3}
                className="resize-none"
                data-testid="textarea-incident"
              />
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={incidentDate}
                    onChange={(e) => setIncidentDate(e.target.value)}
                    data-testid="input-incident-date"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => incidentMutation.mutate()}
                  disabled={incidentMutation.isPending || !incidentNote.trim()}
                  data-testid="button-submit-incident"
                >
                  {incidentMutation.isPending ? "Saving..." : "Submit Incident"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowIncidentForm(false)}
                  data-testid="button-cancel-incident"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-1 mb-4 border-b" data-testid="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground"
              }`}
              data-testid={`tab-${tab.key}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pb-8 space-y-4">
          {activeTab === "overview" && (
            <OverviewTab user={user} certifications={certifications} topSkills={topSkills} />
          )}
          {activeTab === "skills" && <SkillsTab skills={skills} />}
          {activeTab === "performance" && (
            <PerformanceTab
              user={user}
              attendanceLogs={attendanceLogs}
              attendanceReliability={attendanceReliability}
              attendanceTrend={attendanceTrend}
              productivityLabel={productivityLabel}
              qualityLabel={qualityLabel}
              qualityIssues={qualityIssues}
              safetyIncidents={safetyIncidents}
              supervisorNotes={supervisorNotes}
              performanceReviews={performanceReviews}
            />
          )}
          {activeTab === "projects" && (
            <ProjectsTab
              projectGroups={projectGroups}
              projectNameMap={projectNameMap}
              currentShift={currentShift}
              expandedProjects={expandedProjects}
              toggleProject={toggleProject}
            />
          )}
          {activeTab === "logs" && (
            <LogsTab
              workerLogs={workerLogs}
              logNote={logNote}
              setLogNote={setLogNote}
              logCategory={logCategory}
              setLogCategory={setLogCategory}
              logDate={logDate}
              setLogDate={setLogDate}
              addLogMutation={addLogMutation}
            />
          )}
          {activeTab === "safety-training" && (
            <WorkerSafetyTrainingTab workerId={workerId!} workerName={fullName} />
          )}
        </div>
      </div>

      <EvalDialog
        open={showEvalDialog}
        onOpenChange={setShowEvalDialog}
        userId={user.id}
        userRole={user.role}
        workerId={workerId!}
      />

      <SkillsDialog
        open={showSkillsDialog}
        onOpenChange={setShowSkillsDialog}
        skills={skills}
        workerId={workerId!}
      />

      <AssignProjectDialog
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        workerId={workerId!}
      />
    </div>
  );
}

interface WorkerAssignment {
  id: string;
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
  employeeId: string;
}

function WorkerSafetyTrainingTab({ workerId, workerName }: { workerId: string; workerName: string }) {
  const { toast } = useToast();
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completing, setCompleting] = useState<WorkerAssignment | null>(null);
  const [completedByName, setCompletedByName] = useState("");
  const [notes, setNotes] = useState("");
  const [ack, setAck] = useState("");

  const { data: assignments = [], isLoading } = useQuery<WorkerAssignment[]>({
    queryKey: ["/api/safety-training/assignments", workerId],
    queryFn: async () => {
      const all = await fetch("/api/safety-training/assignments", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all.filter((a: any) => a.employeeId === workerId) : [];
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, ...body }: any) =>
      apiRequest("PATCH", `/api/safety-training/assignments/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments", workerId] });
      setShowCompleteDialog(false);
      setCompleting(null);
      toast({ title: "Training marked complete" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const completed = assignments.filter(a => a.status === "COMPLETED").length;
  const total = assignments.length;

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded" />)}</div>;
  }

  return (
    <div className="space-y-4" data-testid="worker-safety-training-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Safety Training Records</h3>
        </div>
        <div className="flex gap-3 items-center">
          <span className="text-sm text-muted-foreground">{completed}/{total} completed</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/safety-training/export/pdf?employeeId=${workerId}`, "_blank")}
            data-testid="button-export-worker-pdf"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export PDF
          </Button>
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-worker-training">
          <ShieldCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No safety training assigned</p>
          <p className="text-xs mt-1">Assign training from the Safety Training module.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map(a => (
            <Card key={a.id} className="p-4" data-testid={`card-worker-assignment-${a.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{a.trainingTitle}</span>
                    {a.status === "COMPLETED" && <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge>}
                    {a.status === "OVERDUE" && <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">Overdue</Badge>}
                    {a.status === "PENDING" && <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">Pending</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{a.trainingCategory}</span>
                    {a.trainingDuration && <span>{a.trainingDuration} min</span>}
                    <span>Assigned {fmtDate(a.assignedAt)}</span>
                    {a.dueDate && <span>Due {fmtDate(a.dueDate)}</span>}
                    {a.completedAt && <span className="text-green-700">Completed {fmtDate(a.completedAt)}{a.completedByName ? ` by ${a.completedByName}` : ""}</span>}
                  </div>
                  {a.acknowledgmentSignature && (
                    <p className="text-xs text-muted-foreground mt-1 italic">"{a.acknowledgmentSignature}"</p>
                  )}
                </div>
                {a.status !== "COMPLETED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 text-xs"
                    onClick={() => { setCompleting(a); setCompletedByName(workerName); setNotes(""); setAck(""); setShowCompleteDialog(true); }}
                    data-testid={`button-complete-worker-training-${a.id}`}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Mark Complete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCompleteDialog} onOpenChange={() => setShowCompleteDialog(false)}>
        <DialogContent className="max-w-sm" data-testid="dialog-worker-complete">
          <DialogHeader><DialogTitle>Mark Training Complete</DialogTitle></DialogHeader>
          {completing && (
            <div className="space-y-3 py-2">
              <div className="bg-muted/40 rounded p-2 text-sm font-medium">{completing.trainingTitle}</div>
              <div className="space-y-1.5">
                <Label>Signed off by</Label>
                <Input value={completedByName} onChange={e => setCompletedByName(e.target.value)} data-testid="input-worker-completed-by" />
              </div>
              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-worker-notes" />
              </div>
              <div className="space-y-1.5">
                <Label>Employee Acknowledgment</Label>
                <Input value={ack} onChange={e => setAck(e.target.value)} placeholder='Type acknowledgment statement' data-testid="input-worker-ack" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>Cancel</Button>
            <Button
              onClick={() => completing && completeMutation.mutate({ id: completing.id, status: "COMPLETED", completedByName, notes, acknowledgmentSignature: ack })}
              disabled={!completedByName || completeMutation.isPending}
              data-testid="button-confirm-worker-complete"
            >
              {completeMutation.isPending ? "Saving..." : "Mark Complete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

