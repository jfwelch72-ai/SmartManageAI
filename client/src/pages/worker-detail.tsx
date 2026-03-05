import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
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

      <div className="max-w-5xl mx-auto px-4 md:px-6">
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
