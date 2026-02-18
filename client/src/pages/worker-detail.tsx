import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Star,
  Check,
  CheckCircle,
  AlertTriangle,
  UserPlus,
  FileWarning,
  ClipboardList,
  Wrench,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  Clock,
  CalendarDays,
  Briefcase,
  Mail,
  Phone,
  Shield,
  MessageSquareQuote,
  Loader2,
} from "lucide-react";

type TabKey = "overview" | "skills" | "performance" | "projects" | "logs";

interface WorkerData {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    role: string;
    isActive: boolean;
    avatarUrl: string | null;
    tradeSpecialization: string | null;
    employmentType: string | null;
    birthdate: string | null;
    timezone: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactAddress: string | null;
    emergencyContactEmail: string | null;
    profileDescription: string | null;
    createdAt: string;
  };
  performanceProfile: {
    experienceLevel: string | null;
    pastProjects: string | null;
    productivityTendencies: string | null;
  } | null;
  skills: Array<{
    id: string;
    skillName: string;
    rating: number;
    isVerified: boolean;
    verifiedByUserId: string | null;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  certifications: Array<{
    id: string;
    certificationName: string;
    issuedDate: string | null;
    expiryDate: string | null;
    fileUrl: string | null;
    status: string;
    createdAt: string;
  }>;
  attendanceLogs: Array<{
    id: string;
    date: string;
    status: string;
    notes: string | null;
  }>;
  safetyIncidents: Array<{
    id: string;
    date: string;
    severity: string;
    description: string;
    actionTaken: string | null;
  }>;
  qualityIssues: Array<{
    id: string;
    date: string;
    category: string;
    description: string;
    resolution: string | null;
  }>;
  performanceReviews: Array<{
    id: string;
    reviewDate: string;
    reviewerName: string;
    overallRating: number;
    productivityRating: number | null;
    qualityRating: number | null;
    safetyRating: number | null;
    communicationRating: number | null;
    leadershipRating: number | null;
    notes: string | null;
    scheduleAdherence: string | null;
    costControl: string | null;
    subcontractorCoordination: string | null;
    clientInspectionOutcomes: string | null;
  }>;
  supervisorNotes: Array<{
    id: string;
    note: string;
    createdByName: string;
    createdAt: string;
  }>;
  workerLogs: Array<{
    id: string;
    date: string;
    note: string;
    category: string;
    createdByName: string;
    createdAt: string;
  }>;
  timeClockShifts: Array<{
    id: string;
    projectId: string;
    clockIn: string;
    clockOut: string | null;
    totalHours: number | null;
    notes: string | null;
  }>;
  currentShift: {
    id: string;
    projectId: string;
    clockIn: string;
  } | null;
}

function RatingStars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < rating
              ? "text-yellow-500 fill-yellow-500"
              : "text-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}

function getCertStatus(expiryDate: string | null): { label: string; className: string } {
  if (!expiryDate) return { label: "Active", className: "bg-green-500/15 text-green-600 border-transparent" };
  const now = Date.now();
  const expiry = new Date(expiryDate).getTime();
  if (expiry < now) return { label: "Expired", className: "bg-red-500/15 text-red-600 border-transparent" };
  const diff = (expiry - now) / (1000 * 60 * 60 * 24);
  if (diff <= 30) return { label: "Expiring Soon", className: "bg-amber-500/15 text-amber-600 border-transparent" };
  return { label: "Active", className: "bg-green-500/15 text-green-600 border-transparent" };
}

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
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const { data, isLoading, error } = useQuery<WorkerData>({
    queryKey: ["/api/auth/manage-workers", workerId],
    enabled: !!workerId,
  });

  const { data: projectsResponse, isLoading: projectsLoading } = useQuery<{ data: Array<{ id: string; name: string; code: string; status: string }> }>({
    queryKey: ["/api/projects"],
    enabled: showAssignDialog,
  });
  const orgProjects = projectsResponse?.data;

  const assignProjectMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/auth/manage-workers/${workerId}/assign-project`, {
        projectId: selectedProjectId,
        notes: assignNotes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers"] });
      toast({ title: "Worker assigned to project successfully" });
      setShowAssignDialog(false);
      setSelectedProjectId("");
      setAssignNotes("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to assign project", description: err.message, variant: "destructive" });
    },
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

  const { user, performanceProfile, skills, certifications, attendanceLogs, safetyIncidents, qualityIssues, performanceReviews, supervisorNotes, workerLogs, timeClockShifts, currentShift } = data;

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
    const recent = attendanceLogs.filter((l) => {
      const t = new Date(l.date).getTime();
      return t >= now - d30;
    });
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
              <Badge
                variant={user.isActive ? "secondary" : "destructive"}
                data-testid="badge-status"
              >
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAssignDialog(true)}
            data-testid="button-assign-project"
          >
            <UserPlus className="h-4 w-4 mr-1" />
            Assign to Project
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIncidentForm(!showIncidentForm)}
            data-testid="button-record-incident"
          >
            <FileWarning className="h-4 w-4 mr-1" />
            Record Incident
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast({ title: "Coming soon", description: "Evaluation feature is coming soon." })}
            data-testid="button-add-evaluation"
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            Add Evaluation
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast({ title: "Coming soon", description: "Skills update is coming soon." })}
            data-testid="button-update-skills"
          >
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
            <OverviewTab
              user={user}
              certifications={certifications}
              topSkills={topSkills}
            />
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

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Project</Label>
              {projectsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger data-testid="select-assign-project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const activeProjects = (orgProjects || []).filter(
                        (p: any) => p.status !== "COMPLETED" && p.status !== "CANCELLED"
                      );
                      if (activeProjects.length === 0) {
                        return <SelectItem value="__none" disabled>No active projects available</SelectItem>;
                      }
                      return activeProjects.map((p: any) => (
                        <SelectItem key={p.id} value={p.id} data-testid={`option-project-${p.id}`}>
                          {p.name}{p.code ? ` (${p.code})` : ""}
                        </SelectItem>
                      ));
                    })()}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-notes">Notes (optional)</Label>
              <Textarea
                id="assign-notes"
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                placeholder="Add assignment notes..."
                data-testid="input-assign-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAssignDialog(false)}
              data-testid="button-cancel-assign"
            >
              Cancel
            </Button>
            <Button
              onClick={() => assignProjectMutation.mutate()}
              disabled={!selectedProjectId || assignProjectMutation.isPending || projectsLoading}
              data-testid="button-confirm-assign"
            >
              {assignProjectMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OverviewTab({
  user,
  certifications,
  topSkills,
}: {
  user: WorkerData["user"];
  certifications: WorkerData["certifications"];
  topSkills: WorkerData["skills"];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Worker ID</span>
            <span className="text-sm font-mono" data-testid="text-worker-id">{user.id.substring(0, 8)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Contact Phone</span>
            <span className="text-sm flex items-center gap-1" data-testid="text-worker-phone">
              <Phone className="h-3.5 w-3.5" />
              {user.phone || "Not provided"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Employment Type</span>
            <span className="text-sm" data-testid="text-employment-type">{user.employmentType || "Not specified"}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Trade</span>
            <span className="text-sm" data-testid="text-trade">{user.tradeSpecialization || "Not specified"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Certifications</CardTitle>
        </CardHeader>
        <CardContent>
          {certifications.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-certs">No certifications on file</p>
          ) : (
            <div className="space-y-2">
              {certifications.map((cert) => {
                const status = getCertStatus(cert.expiryDate);
                return (
                  <div
                    key={cert.id}
                    className="flex items-center justify-between gap-2"
                    data-testid={`cert-row-${cert.id}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Check className="h-4 w-4 text-green-600 shrink-0" />
                      <span className="text-sm truncate">{cert.certificationName}</span>
                    </div>
                    <Badge variant="secondary" className={`text-xs shrink-0 ${status.className}`}>
                      {status.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Skill Highlights</CardTitle>
        </CardHeader>
        <CardContent>
          {topSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-skills">No skills recorded</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between gap-2"
                  data-testid={`skill-highlight-${skill.id}`}
                >
                  <span className="text-sm truncate">{skill.skillName}</span>
                  <RatingStars rating={skill.rating} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SkillsTab({ skills }: { skills: WorkerData["skills"] }) {
  if (skills.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Wrench className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-skills-full">No skills have been recorded for this worker.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Full Skill Matrix</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0"
              data-testid={`skill-row-${skill.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm">{skill.skillName}</span>
                {skill.isVerified && (
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" data-testid={`verified-badge-${skill.id}`} />
                )}
              </div>
              <RatingStars rating={skill.rating} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceTab({
  user,
  attendanceLogs,
  attendanceReliability,
  attendanceTrend,
  productivityLabel,
  qualityLabel,
  qualityIssues,
  safetyIncidents,
  supervisorNotes,
  performanceReviews,
}: {
  user: WorkerData["user"];
  attendanceLogs: WorkerData["attendanceLogs"];
  attendanceReliability: number | null;
  attendanceTrend: string | null;
  productivityLabel: string;
  qualityLabel: string;
  qualityIssues: WorkerData["qualityIssues"];
  safetyIncidents: WorkerData["safetyIncidents"];
  supervisorNotes: WorkerData["supervisorNotes"];
  performanceReviews: WorkerData["performanceReviews"];
}) {
  const isSuperintendent = user.role === "SUPERINTENDENT";
  const { toast } = useToast();
  const [newNoteText, setNewNoteText] = useState("");

  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await apiRequest("POST", `/api/auth/manage-workers/${user.id}/notes`, { note });
      return res.json();
    },
    onSuccess: () => {
      setNewNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", user.id] });
      toast({ title: "Note added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add note", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="performance-metrics-grid">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Attendance Reliability</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold" data-testid="text-perf-attendance">
                {attendanceReliability !== null ? `${attendanceReliability}%` : "N/A"}
              </span>
              {attendanceTrend === "up" && <ArrowUp className="h-4 w-4 text-green-600" data-testid="icon-trend-up" />}
              {attendanceTrend === "down" && <ArrowDown className="h-4 w-4 text-red-600" data-testid="icon-trend-down" />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Productivity Rating</p>
            <div className="flex items-center gap-2" data-testid="text-perf-productivity">
              <span className="text-2xl font-bold">{productivityLabel}</span>
              {productivityLabel === "Below Average" && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-prod-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Quality Issues</p>
            <div className="flex items-center gap-2" data-testid="text-perf-quality">
              <span className="text-2xl font-bold">{qualityLabel}</span>
              {qualityLabel === "High" && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-quality-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Safety Incidents</p>
            <div className="flex items-center gap-2" data-testid="text-perf-safety">
              <span className="text-2xl font-bold">{safetyIncidents.length}</span>
              {safetyIncidents.length > 0 && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-safety-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4" />
            Supervisor Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2" data-testid="add-note-form">
            <Textarea
              placeholder="Add a supervisor note..."
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="textarea-supervisor-note"
            />
            <Button
              size="sm"
              disabled={!newNoteText.trim() || addNoteMutation.isPending}
              onClick={() => addNoteMutation.mutate(newNoteText.trim())}
              data-testid="button-add-supervisor-note"
            >
              {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
          {supervisorNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-supervisor-notes">No supervisor notes.</p>
          ) : (
            <div className="space-y-3">
              {supervisorNotes.map((n) => (
                <div key={n.id} className="border-b pb-3 last:border-b-0 last:pb-0" data-testid={`supervisor-note-${n.id}`}>
                  <p className="text-sm italic">&ldquo;{n.note}&rdquo;</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    &mdash; {n.createdByName}{n.createdAt ? `, ${new Date(n.createdAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperintendent && performanceReviews.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Superintendent Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(() => {
                const latest = performanceReviews[0];
                return (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Schedule Adherence</p>
                      <p className="text-sm font-medium" data-testid="text-schedule-adherence">
                        {latest.scheduleAdherence || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Cost Impact</p>
                      <p className="text-sm font-medium" data-testid="text-cost-control">
                        {latest.costControl || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Subcontractor Coordination</p>
                      <p className="text-sm font-medium" data-testid="text-sub-coordination">
                        {latest.subcontractorCoordination || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Inspection Outcomes</p>
                      <p className="text-sm font-medium" data-testid="text-inspection-outcomes">
                        {latest.clientInspectionOutcomes || "N/A"}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProjectsTab({
  projectGroups,
  currentShift,
  expandedProjects,
  toggleProject,
}: {
  projectGroups: Record<string, WorkerData["timeClockShifts"]>;
  currentShift: WorkerData["currentShift"];
  expandedProjects: Set<string>;
  toggleProject: (pid: string) => void;
}) {
  const projectIds = Object.keys(projectGroups);

  if (projectIds.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Briefcase className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-projects">No project history</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {projectIds.map((pid) => {
        const shifts = projectGroups[pid];
        const isCurrent = currentShift?.projectId === pid;
        const totalHours = shifts.reduce((sum, s) => sum + (s.totalHours || 0), 0);
        const expanded = expandedProjects.has(pid);
        const firstShift = shifts.reduce((earliest, s) => {
          return new Date(s.clockIn) < new Date(earliest.clockIn) ? s : earliest;
        }, shifts[0]);
        const lastShift = shifts.reduce((latest, s) => {
          const compare = s.clockOut || s.clockIn;
          const latestCompare = latest.clockOut || latest.clockIn;
          return new Date(compare) > new Date(latestCompare) ? s : latest;
        }, shifts[0]);

        return (
          <Card key={pid}>
            <CardContent className="pt-4">
              <div
                className="flex items-center justify-between gap-2 cursor-pointer"
                onClick={() => toggleProject(pid)}
                data-testid={`project-row-${pid}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">Project {pid.substring(0, 8)}</span>
                  {isCurrent ? (
                    <Badge variant="secondary" className="text-xs bg-green-500/15 text-green-600 border-transparent shrink-0">
                      Current
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs shrink-0">Past</Badge>
                  )}
                </div>
                {expanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>
              {expanded && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Duration</span>
                    <span className="text-sm" data-testid={`text-project-duration-${pid}`}>
                      {new Date(firstShift.clockIn).toLocaleDateString()} &ndash;{" "}
                      {lastShift.clockOut
                        ? new Date(lastShift.clockOut).toLocaleDateString()
                        : "Present"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Total Hours</span>
                    <span className="text-sm font-medium" data-testid={`text-project-hours-${pid}`}>
                      {totalHours.toFixed(1)} hrs
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Shifts Logged</span>
                    <span className="text-sm" data-testid={`text-project-shifts-${pid}`}>
                      {shifts.length}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function LogsTab({
  workerLogs,
  logNote,
  setLogNote,
  logCategory,
  setLogCategory,
  logDate,
  setLogDate,
  addLogMutation,
}: {
  workerLogs: WorkerData["workerLogs"];
  logNote: string;
  setLogNote: (v: string) => void;
  logCategory: string;
  setLogCategory: (v: string) => void;
  logDate: string;
  setLogDate: (v: string) => void;
  addLogMutation: ReturnType<typeof useMutation<Response, Error, void>>;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add Note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={logNote}
            onChange={(e) => setLogNote(e.target.value)}
            placeholder="Enter a note about this worker..."
            rows={3}
            className="resize-none"
            data-testid="textarea-log-note"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Label className="text-xs">Category</Label>
              <Select value={logCategory} onValueChange={setLogCategory}>
                <SelectTrigger data-testid="select-log-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="INCIDENT">Incident</SelectItem>
                  <SelectItem value="PERFORMANCE">Performance</SelectItem>
                  <SelectItem value="SAFETY">Safety</SelectItem>
                  <SelectItem value="ATTENDANCE">Attendance</SelectItem>
                  <SelectItem value="COMMENDATION">Commendation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                data-testid="input-log-date"
              />
            </div>
            <Button
              size="sm"
              onClick={() => addLogMutation.mutate()}
              disabled={addLogMutation.isPending || !logNote.trim()}
              data-testid="button-submit-log"
            >
              {addLogMutation.isPending ? "Saving..." : "Add Note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {workerLogs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-logs">No log entries yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...workerLogs]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((log) => (
              <Card key={log.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3" data-testid={`log-row-${log.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{log.note}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.createdByName} &middot; {new Date(log.date).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0" data-testid={`badge-log-category-${log.id}`}>
                      {log.category}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
