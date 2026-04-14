import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, MessageSquare, ClipboardList, CheckCircle2, Plus, Shield } from "lucide-react";
import PpeComplianceSection from "@/components/PpeComplianceSection";
import SafetyOfficerAssignment from "@/components/SafetyOfficerAssignment";

interface TrainingAssignment {
  id: string; employeeId: string; employeeFirstName: string; employeeLastName: string;
  trainingTitle: string; trainingCategory: string; trainingDuration: number | null;
  status: string; assignedAt: string; dueDate: string | null;
  completedAt: string | null; completedByName: string | null; notes: string | null;
}

interface ScheduledTalk {
  id: string; topicTitle: string; topicCategory: string; scheduledDate: string;
  presenter: string | null; status: string;
}

interface ChecklistInstance {
  id: string; templateName: string; templateCategory: string; status: string;
  completedByName: string | null; completedAt: string | null; createdAt: string;
}

interface ChecklistTemplate {
  id: string; name: string; category: string; itemsJson: string;
}

interface SafetyTrainingTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SafetyTrainingTab({ projectId, projectCode, userRole }: SafetyTrainingTabProps) {
  const { toast } = useToast();
  const [section, setSection] = useState<"training" | "talks" | "checklists" | "ppe">("training");
  const [showStartChecklist, setShowStartChecklist] = useState(false);

  const { data: templates = [] } = useQuery<ChecklistTemplate[]>({
    queryKey: ["/api/safety-checklists/templates"],
  });

  const createInstance = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/safety-checklists/instances", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists/instances", projectId] });
      setShowStartChecklist(false);
      toast({ title: "Checklist submitted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: crewUserIds = [], isLoading: crewLoading } = useQuery<string[]>({
    queryKey: ["/api/time-entries/project-crew", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/time-entries/project-crew?projectId=${encodeURIComponent(projectId)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: allAssignments = [], isLoading: assignmentsLoading } = useQuery<TrainingAssignment[]>({
    queryKey: ["/api/safety-training/assignments"],
  });

  const { data: scheduledTalks = [], isLoading: talksLoading } = useQuery<ScheduledTalk[]>({
    queryKey: ["/api/toolbox-talks/scheduled", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/toolbox-talks/scheduled?projectId=${encodeURIComponent(projectId)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: checklistInstances = [], isLoading: checklistsLoading } = useQuery<ChecklistInstance[]>({
    queryKey: ["/api/safety-checklists/instances", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/safety-checklists/instances?projectId=${encodeURIComponent(projectId)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const crewSet = new Set(crewUserIds);
  const assignments = allAssignments.filter(a => crewSet.has(a.employeeId));
  const completed = assignments.filter(a => a.status === "COMPLETED").length;
  const pending = assignments.filter(a => a.status === "PENDING").length;
  const overdue = assignments.filter(a => a.status === "OVERDUE").length;
  const total = assignments.length;

  const isLoading = crewLoading || assignmentsLoading;

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded" />)}</div>;
  }

  return (
    <div className="space-y-4" data-testid="project-safety-training-tab">
      <SafetyOfficerAssignment projectCode={projectCode} userRole={userRole} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Safety Training</h3>
        </div>
        <div className="flex gap-3 items-center text-sm text-muted-foreground">
          <span>{completed}/{total} completed</span>
          {pending > 0 && <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">{pending} pending</Badge>}
          {overdue > 0 && <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">{overdue} overdue</Badge>}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setSection("training")} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${section === "training" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`} data-testid="section-training">
          <ShieldCheck className="h-3.5 w-3.5" /> Training ({total})
        </button>
        <button onClick={() => setSection("talks")} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${section === "talks" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`} data-testid="section-talks">
          <MessageSquare className="h-3.5 w-3.5" /> Toolbox Talks ({scheduledTalks.length})
        </button>
        <button onClick={() => setSection("checklists")} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${section === "checklists" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`} data-testid="section-checklists">
          <ClipboardList className="h-3.5 w-3.5" /> Checklists ({checklistInstances.length})
        </button>
        <button onClick={() => setSection("ppe")} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${section === "ppe" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`} data-testid="section-ppe">
          <Shield className="h-3.5 w-3.5" /> PPE Compliance
        </button>
      </div>

      {section === "training" && (
        crewSet.size === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-project-crew">
            <ShieldCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium text-sm">No crew members found for this project</p>
            <p className="text-xs mt-1">Safety training records will appear once workers log time on this project.</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-project-training">
            <ShieldCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium text-sm">No safety training assignments for project crew</p>
            <p className="text-xs mt-1">Assign training from the Safety Training module.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map(a => (
              <Card key={a.id} className="p-4" data-testid={`card-training-assignment-${a.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{a.trainingTitle}</span>
                      {a.status === "COMPLETED" && <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge>}
                      {a.status === "OVERDUE" && <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">Overdue</Badge>}
                      {a.status === "PENDING" && <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">Pending</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{a.employeeFirstName} {a.employeeLastName}</span>
                      <span>{a.trainingCategory}</span>
                      {a.trainingDuration && <span>{a.trainingDuration} min</span>}
                      <span>Assigned {fmtDate(a.assignedAt)}</span>
                      {a.dueDate && <span>Due {fmtDate(a.dueDate)}</span>}
                      {a.completedAt && <span className="text-green-700">Completed {fmtDate(a.completedAt)}{a.completedByName ? ` by ${a.completedByName}` : ""}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {section === "talks" && (
        talksLoading ? <Skeleton className="h-24" /> : scheduledTalks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-project-talks">
            <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium text-sm">No toolbox talks scheduled for this project</p>
          </div>
        ) : (
          <div className="space-y-2">
            {scheduledTalks.map(t => (
              <Card key={t.id} className="p-4" data-testid={`card-project-talk-${t.id}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.topicTitle}</span>
                  <Badge variant="secondary" className="text-xs">{t.topicCategory}</Badge>
                  {t.status === "COMPLETED" ? <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge> : <Badge className="bg-blue-500/15 text-blue-700 border-transparent text-xs">Scheduled</Badge>}
                </div>
                <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{fmtDate(t.scheduledDate)}</span>
                  {t.presenter && <span>Presenter: {t.presenter}</span>}
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {section === "checklists" && (
        <>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowStartChecklist(true)} data-testid="button-start-project-checklist">
            <Plus className="h-4 w-4 mr-1" /> Start Checklist
          </Button>
        </div>
        {checklistsLoading ? <Skeleton className="h-24" /> : checklistInstances.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-project-checklists">
            <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium text-sm">No checklists completed for this project</p>
          </div>
        ) : (
          <div className="space-y-2">
            {checklistInstances.map(c => (
              <Card key={c.id} className="p-4" data-testid={`card-project-checklist-${c.id}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{c.templateName}</span>
                  <Badge variant="secondary" className="text-xs">{c.templateCategory}</Badge>
                  {c.status === "COMPLETED" ? <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge> : <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">In Progress</Badge>}
                </div>
                <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                  {c.completedByName && <span>By: {c.completedByName}</span>}
                  <span>{fmtDate(c.completedAt || c.createdAt)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
        </>
      )}

      {section === "ppe" && (
        <PpeComplianceSection
          projectId={projectId}
          projectCode={projectCode}
          userRole={userRole}
        />
      )}

      {showStartChecklist && (
        <ProjectChecklistDialog
          projectId={projectId}
          templates={templates}
          onClose={() => setShowStartChecklist(false)}
          onSave={(data: Record<string, unknown>) => createInstance.mutate(data)}
          isSaving={createInstance.isPending}
        />
      )}
    </div>
  );
}

function ProjectChecklistDialog({ projectId, templates, onClose, onSave, isSaving }: {
  projectId: string; templates: ChecklistTemplate[];
  onClose: () => void; onSave: (data: Record<string, unknown>) => void; isSaving: boolean;
}) {
  const [templateId, setTemplateId] = useState("");
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [itemNotes, setItemNotes] = useState<Record<number, string>>({});
  const [itemPhotos, setItemPhotos] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");

  const selectedTemplate = templates.find(t => t.id === templateId);
  let items: string[] = [];
  try { if (selectedTemplate) items = JSON.parse(selectedTemplate.itemsJson); } catch (err) { console.warn("[SafetyTraining] Failed to parse template items:", err); }

  const setResponse = (idx: number, val: string) => setResponses(prev => ({ ...prev, [idx]: val }));
  const allAnswered = items.length > 0 && items.every((_, i) => responses[i]);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-project-checklist">
        <DialogHeader><DialogTitle>Complete Safety Checklist</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Checklist Template *</Label>
            <Select value={templateId} onValueChange={v => { setTemplateId(v); setResponses({}); setItemNotes({}); setItemPhotos({}); }}>
              <SelectTrigger data-testid="select-project-checklist-template"><SelectValue placeholder="Select checklist" /></SelectTrigger>
              <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.category})</SelectItem>)}</SelectContent>
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
                        <Button key={v} variant={responses[i] === v ? (v === "PASS" ? "default" : v === "FAIL" ? "destructive" : "secondary") : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => setResponse(i, v)} data-testid={`button-project-response-${i}-${v}`}>{v}</Button>
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
                        data-testid={`input-project-item-note-${i}`}
                      />
                      <Input
                        placeholder="Photo URL (optional)"
                        value={itemPhotos[i] || ""}
                        onChange={e => setItemPhotos(prev => ({ ...prev, [i]: e.target.value }))}
                        className="h-7 text-xs"
                        data-testid={`input-project-item-photo-${i}`}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional observations..." data-testid="input-project-checklist-notes" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const respArr = items.map((item, i) => ({ item, result: responses[i] || "N/A", notes: itemNotes[i] || "", photoUrl: itemPhotos[i] || "" }));
              onSave({ templateId, projectId, responsesJson: JSON.stringify(respArr), notes, status: "COMPLETED" });
            }}
            disabled={!templateId || !allAnswered || isSaving}
            data-testid="button-submit-project-checklist"
          >
            {isSaving ? "Submitting..." : "Submit Checklist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
