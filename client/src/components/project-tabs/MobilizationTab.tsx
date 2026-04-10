import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardCheck, Plus, CheckCircle2, Clock, FileText,
  ChevronDown, ChevronRight, Shield, HardHat, Loader2,
  Pencil, Trash2, Save, X, ListOrdered, Wrench
} from "lucide-react";
import { hasManagementAccess } from "@/lib/rbac";

interface MobilizationChecklist {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  completedAt: string | null;
  createdAt: string;
}

interface ChecklistItem {
  id: string;
  checklistId: string;
  title: string;
  description: string | null;
  category: string;
  sortOrder: number;
  status: string;
  assignedToName: string | null;
  dueDate: string | null;
  completedAt: string | null;
  notes: string | null;
}

interface MethodStatement {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  workActivity: string;
  sequenceOfOperations: string | null;
  equipmentResources: string | null;
  hazards: string | null;
  controlMeasures: string | null;
  ppe: string | null;
  emergencyProcedures: string | null;
  status: string;
  linkedScheduleTaskId: string | null;
  linkedSafetyChecklistId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface SafetyChecklist {
  id: string;
  status: string;
  templateId: string;
  templateName: string | null;
}

interface ScheduleTask {
  id: string;
  name: string;
}

interface MobilizationTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  DRAFT: { className: "bg-gray-500/15 text-gray-700 border-transparent", label: "Draft" },
  IN_PROGRESS: { className: "bg-blue-500/15 text-blue-700 border-transparent", label: "In Progress" },
  COMPLETED: { className: "bg-green-500/15 text-green-700 border-transparent", label: "Completed" },
  PENDING: { className: "bg-amber-500/15 text-amber-700 border-transparent", label: "Pending" },
  SKIPPED: { className: "bg-gray-500/15 text-gray-500 border-transparent", label: "Skipped" },
  SUBMITTED: { className: "bg-blue-500/15 text-blue-700 border-transparent", label: "Submitted" },
  APPROVED: { className: "bg-green-500/15 text-green-700 border-transparent", label: "Approved" },
  REJECTED: { className: "bg-red-500/15 text-red-700 border-transparent", label: "Rejected" },
};

export default function MobilizationTab({ projectId, projectCode, userRole }: MobilizationTabProps) {
  const { toast } = useToast();
  const [section, setSection] = useState<"checklists" | "method-statements">("checklists");
  const [showNewChecklist, setShowNewChecklist] = useState(false);
  const [showNewMethodStatement, setShowNewMethodStatement] = useState(false);
  const [expandedChecklist, setExpandedChecklist] = useState<string | null>(null);
  const [showMethodDetail, setShowMethodDetail] = useState<MethodStatement | null>(null);
  const canManage = hasManagementAccess(userRole);

  const { data: checklists = [], isLoading: checklistsLoading } = useQuery<MobilizationChecklist[]>({
    queryKey: ["/api/projects", projectId, "mobilization", "checklists"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/mobilization/checklists`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: methodStmts = [], isLoading: methodsLoading } = useQuery<MethodStatement[]>({
    queryKey: ["/api/projects", projectId, "method-statements"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/method-statements`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: scheduleData } = useQuery<{ tasks: ScheduleTask[] }>({
    queryKey: ["/api/projects", projectCode, "schedule"],
  });
  const scheduleTasks = scheduleData?.tasks || [];

  const { data: safetyChecklists = [] } = useQuery<SafetyChecklist[]>({
    queryKey: ["/api/projects", projectId, "safety-checklists"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/safety-checklists`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createChecklist = useMutation({
    mutationFn: (body: { title: string; description?: string; useDefaults?: boolean }) =>
      apiRequest("POST", `/api/projects/${projectId}/mobilization/checklists`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "mobilization", "checklists"] });
      setShowNewChecklist(false);
      toast({ title: "Checklist created with default items" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMethod = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("POST", `/api/projects/${projectId}/method-statements`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "method-statements"] });
      setShowNewMethodStatement(false);
      toast({ title: "Method statement created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMethodStatus = useMutation({
    mutationFn: ({ id, status, rejectionReason }: { id: string; status: string; rejectionReason?: string }) =>
      apiRequest("PATCH", `/api/method-statements/${id}`, { status, rejectionReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "method-statements"] });
      setShowMethodDetail(null);
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMethodContent = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/method-statements/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "method-statements"] });
      setShowMethodDetail(null);
      toast({ title: "Method statement updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completedChecklists = checklists.filter(c => c.status === "COMPLETED").length;
  const approvedMethods = methodStmts.filter(m => m.status === "APPROVED").length;

  const isLoading = checklistsLoading || methodsLoading;
  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded" />)}</div>;
  }

  return (
    <div className="space-y-4" data-testid="project-mobilization-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Site Mobilization</h3>
        </div>
        <div className="flex gap-3 items-center text-sm text-muted-foreground">
          <span>{completedChecklists}/{checklists.length} checklists done</span>
          <span>{approvedMethods}/{methodStmts.length} methods approved</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setSection("checklists")}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${section === "checklists" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          data-testid="section-mobilization-checklists"
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> Checklists ({checklists.length})
        </button>
        <button
          onClick={() => setSection("method-statements")}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${section === "method-statements" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          data-testid="section-method-statements"
        >
          <FileText className="h-3.5 w-3.5" /> Method Statements ({methodStmts.length})
        </button>
      </div>

      {section === "checklists" && (
        <>
          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowNewChecklist(true)} data-testid="button-new-mobilization-checklist">
                <Plus className="h-4 w-4 mr-1" /> New Checklist
              </Button>
            </div>
          )}
          {checklists.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-mobilization-checklists">
              <ClipboardCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No mobilization checklists yet</p>
              <p className="text-xs mt-1">Create a checklist to track site setup tasks.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checklists.map(cl => (
                <ChecklistCard
                  key={cl.id}
                  checklist={cl}
                  expanded={expandedChecklist === cl.id}
                  onToggle={() => setExpandedChecklist(expandedChecklist === cl.id ? null : cl.id)}
                  canManage={canManage}
                  projectId={projectId}
                />
              ))}
            </div>
          )}
        </>
      )}

      {section === "method-statements" && (
        <>
          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowNewMethodStatement(true)} data-testid="button-new-method-statement">
                <Plus className="h-4 w-4 mr-1" /> New Method Statement
              </Button>
            </div>
          )}
          {methodStmts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-method-statements">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No method statements yet</p>
              <p className="text-xs mt-1">Create method statements to document safe work procedures.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {methodStmts.map(ms => (
                <Card
                  key={ms.id}
                  className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setShowMethodDetail(ms)}
                  data-testid={`card-method-statement-${ms.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{ms.title}</span>
                        <Badge className={`text-xs ${STATUS_BADGE[ms.status]?.className || ""}`}>
                          {STATUS_BADGE[ms.status]?.label || ms.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{ms.workActivity}</span>
                        {ms.linkedScheduleTaskId && (
                          <span className="text-blue-600">
                            Linked to: {scheduleTasks.find(t => t.id === ms.linkedScheduleTaskId)?.name || "Task"}
                          </span>
                        )}
                        <span>Created {fmtDate(ms.createdAt)}</span>
                        {ms.approvedAt && <span className="text-green-700">Approved {fmtDate(ms.approvedAt)}</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {showNewChecklist && (
        <NewChecklistDialog
          onClose={() => setShowNewChecklist(false)}
          onSave={(data) => createChecklist.mutate(data)}
          isSaving={createChecklist.isPending}
        />
      )}

      {showNewMethodStatement && (
        <NewMethodStatementDialog
          scheduleTasks={scheduleTasks}
          safetyChecklists={safetyChecklists}
          onClose={() => setShowNewMethodStatement(false)}
          onSave={(data) => createMethod.mutate(data)}
          isSaving={createMethod.isPending}
        />
      )}

      {showMethodDetail && (
        <MethodStatementDetailDialog
          statement={showMethodDetail}
          scheduleTasks={scheduleTasks}
          safetyChecklists={safetyChecklists}
          canManage={canManage}
          onClose={() => setShowMethodDetail(null)}
          onStatusChange={(status, rejectionReason) =>
            updateMethodStatus.mutate({ id: showMethodDetail.id, status, rejectionReason })
          }
          onSave={(updates) =>
            updateMethodContent.mutate({ id: showMethodDetail.id, updates })
          }
          isUpdating={updateMethodStatus.isPending}
          isSaving={updateMethodContent.isPending}
        />
      )}
    </div>
  );
}

function ChecklistCard({ checklist, expanded, onToggle, canManage, projectId }: {
  checklist: MobilizationChecklist;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
  projectId: string;
}) {
  const { toast } = useToast();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editAssignee, setEditAssignee] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("General");
  const [newItemDescription, setNewItemDescription] = useState("");

  const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
    queryKey: ["/api/mobilization/checklists", checklist.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/mobilization/checklists/${checklist.id}/items`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: expanded,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, updates }: { itemId: string; updates: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/mobilization/checklist-items/${itemId}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobilization/checklists", checklist.id, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "mobilization", "checklists"] });
      setEditingItemId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addItem = useMutation({
    mutationFn: (body: { title: string; description?: string; category?: string }) =>
      apiRequest("POST", `/api/mobilization/checklists/${checklist.id}/items`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobilization/checklists", checklist.id, "items"] });
      setShowAddItem(false);
      setNewItemTitle("");
      setNewItemCategory("General");
      setNewItemDescription("");
      toast({ title: "Item added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteChecklist = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/mobilization/checklists/${checklist.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "mobilization", "checklists"] });
      toast({ title: "Checklist deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function startEditing(item: ChecklistItem) {
    setEditingItemId(item.id);
    setEditAssignee(item.assignedToName || "");
    setEditDueDate(item.dueDate ? new Date(item.dueDate).toISOString().split("T")[0] : "");
    setEditNotes(item.notes || "");
  }

  function saveItemEdit(itemId: string) {
    updateItem.mutate({
      itemId,
      updates: {
        assignedToName: editAssignee || null,
        dueDate: editDueDate || null,
        notes: editNotes || null,
      },
    });
  }

  const completedCount = items.filter(i => i.status === "COMPLETED").length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const categories = [...new Set(items.map(i => i.category))];

  return (
    <Card className="overflow-hidden" data-testid={`card-mobilization-checklist-${checklist.id}`}>
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
        data-testid={`toggle-checklist-${checklist.id}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{checklist.title}</span>
              <Badge className={`text-xs ${STATUS_BADGE[checklist.status]?.className || ""}`}>
                {STATUS_BADGE[checklist.status]?.label || checklist.status}
              </Badge>
            </div>
            {checklist.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{checklist.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 ml-3">
          {canManage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); deleteChecklist.mutate(); }}
              data-testid={`button-delete-checklist-${checklist.id}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{completedCount}/{totalCount}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 pb-4">
          {isLoading ? (
            <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No items in this checklist.</p>
          ) : (
            <div className="space-y-3 mt-3">
              {categories.map(cat => (
                <div key={cat}>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{cat}</h4>
                  <div className="space-y-1">
                    {items.filter(i => i.category === cat).map(item => (
                      <div
                        key={item.id}
                        className="py-2 px-2 rounded hover:bg-muted/50 group"
                        data-testid={`checklist-item-${item.id}`}
                      >
                        <div className="flex items-start gap-3">
                          {canManage ? (
                            <Checkbox
                              checked={item.status === "COMPLETED"}
                              onCheckedChange={(checked) => {
                                updateItem.mutate({
                                  itemId: item.id,
                                  updates: { status: checked ? "COMPLETED" : "PENDING" },
                                });
                              }}
                              className="mt-0.5"
                              data-testid={`checkbox-item-${item.id}`}
                            />
                          ) : (
                            <div className="mt-0.5">
                              {item.status === "COMPLETED" ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <Clock className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm ${item.status === "COMPLETED" ? "line-through text-muted-foreground" : ""}`}>
                              {item.title}
                            </span>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                            )}
                            <div className="flex gap-2 mt-0.5 text-xs text-muted-foreground">
                              {item.assignedToName && <span>Assigned: {item.assignedToName}</span>}
                              {item.dueDate && <span>Due: {fmtDate(item.dueDate)}</span>}
                              {item.notes && <span>Notes: {item.notes}</span>}
                              {item.completedAt && <span className="text-green-600">Done {fmtDate(item.completedAt)}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {canManage && editingItemId !== item.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => startEditing(item)}
                                data-testid={`button-edit-item-${item.id}`}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                            <Badge className={`text-xs ${STATUS_BADGE[item.status]?.className || ""}`}>
                              {STATUS_BADGE[item.status]?.label || item.status}
                            </Badge>
                          </div>
                        </div>
                        {editingItemId === item.id && (
                          <div className="mt-2 ml-7 p-3 bg-muted/50 rounded-md space-y-2" data-testid={`edit-panel-item-${item.id}`}>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Responsible Person</Label>
                                <Input
                                  value={editAssignee}
                                  onChange={e => setEditAssignee(e.target.value)}
                                  placeholder="Enter name"
                                  className="h-8 text-xs"
                                  data-testid={`input-item-assignee-${item.id}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Target Date</Label>
                                <Input
                                  type="date"
                                  value={editDueDate}
                                  onChange={e => setEditDueDate(e.target.value)}
                                  className="h-8 text-xs"
                                  data-testid={`input-item-due-date-${item.id}`}
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Notes</Label>
                              <Textarea
                                value={editNotes}
                                onChange={e => setEditNotes(e.target.value)}
                                placeholder="Add notes..."
                                rows={2}
                                className="text-xs"
                                data-testid={`input-item-notes-${item.id}`}
                              />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingItemId(null)}
                                className="h-7 text-xs"
                                data-testid={`button-cancel-edit-${item.id}`}
                              >
                                <X className="h-3 w-3 mr-1" /> Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => saveItemEdit(item.id)}
                                disabled={updateItem.isPending}
                                className="h-7 text-xs"
                                data-testid={`button-save-item-${item.id}`}
                              >
                                <Save className="h-3 w-3 mr-1" /> Save
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {canManage && (
            <div className="mt-3 pt-3 border-t">
              {!showAddItem ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddItem(true)}
                  data-testid={`button-add-item-${checklist.id}`}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Custom Item
                </Button>
              ) : (
                <div className="space-y-2 p-3 bg-muted/50 rounded-md" data-testid={`add-item-form-${checklist.id}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Item Title *</Label>
                      <Input
                        value={newItemTitle}
                        onChange={e => setNewItemTitle(e.target.value)}
                        placeholder="e.g. Safety briefing"
                        className="h-8 text-xs"
                        data-testid={`input-new-item-title-${checklist.id}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Category</Label>
                      <Input
                        value={newItemCategory}
                        onChange={e => setNewItemCategory(e.target.value)}
                        placeholder="e.g. Safety"
                        className="h-8 text-xs"
                        data-testid={`input-new-item-category-${checklist.id}`}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={newItemDescription}
                      onChange={e => setNewItemDescription(e.target.value)}
                      placeholder="Optional description..."
                      rows={2}
                      className="text-xs"
                      data-testid={`input-new-item-desc-${checklist.id}`}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddItem(false)}
                      className="h-7 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => addItem.mutate({
                        title: newItemTitle,
                        description: newItemDescription || undefined,
                        category: newItemCategory || "General",
                      })}
                      disabled={!newItemTitle.trim() || addItem.isPending}
                      className="h-7 text-xs"
                      data-testid={`button-save-new-item-${checklist.id}`}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Item
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function NewChecklistDialog({ onClose, onSave, isSaving }: {
  onClose: () => void;
  onSave: (data: { title: string; description?: string; useDefaults?: boolean }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState("Site Mobilization Checklist");
  const [description, setDescription] = useState("");
  const [useDefaults, setUseDefaults] = useState(true);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-new-mobilization-checklist">
        <DialogHeader><DialogTitle>New Mobilization Checklist</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} data-testid="input-checklist-title" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} data-testid="input-checklist-description" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={useDefaults}
              onCheckedChange={(v) => setUseDefaults(!!v)}
              data-testid="checkbox-use-defaults"
            />
            <Label className="text-sm cursor-pointer" onClick={() => setUseDefaults(!useDefaults)}>
              Include 10 default mobilization items
            </Label>
          </div>
          {useDefaults && (
            <p className="text-xs text-muted-foreground ml-6">
              Site office, facilities, utilities, fencing, security, equipment, workforce, environmental, safety, materials.
            </p>
          )}
          {!useDefaults && (
            <p className="text-xs text-muted-foreground ml-6">
              An empty checklist will be created. You can add custom items after creation.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({ title, description: description || undefined, useDefaults })}
            disabled={!title.trim() || isSaving}
            data-testid="button-create-checklist"
          >
            {isSaving ? "Creating..." : "Create Checklist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewMethodStatementDialog({ scheduleTasks, safetyChecklists, onClose, onSave, isSaving }: {
  scheduleTasks: ScheduleTask[];
  safetyChecklists: SafetyChecklist[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [workActivity, setWorkActivity] = useState("");
  const [sequenceOfOperations, setSequenceOfOperations] = useState("");
  const [equipmentResources, setEquipmentResources] = useState("");
  const [hazards, setHazards] = useState("");
  const [controlMeasures, setControlMeasures] = useState("");
  const [ppe, setPpe] = useState("");
  const [emergencyProcedures, setEmergencyProcedures] = useState("");
  const [linkedTaskId, setLinkedTaskId] = useState("");
  const [linkedSafetyChecklistId, setLinkedSafetyChecklistId] = useState("");

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-new-method-statement">
        <DialogHeader><DialogTitle>New Method Statement</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Concrete Pour Procedure" data-testid="input-method-title" />
          </div>
          <div className="space-y-1.5">
            <Label>Work Activity *</Label>
            <Textarea rows={2} value={workActivity} onChange={e => setWorkActivity(e.target.value)} placeholder="Describe the work activity..." data-testid="input-method-work-activity" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><ListOrdered className="h-3.5 w-3.5" /> Sequence of Operations</Label>
            <Textarea rows={3} value={sequenceOfOperations} onChange={e => setSequenceOfOperations(e.target.value)} placeholder="Step-by-step procedure for carrying out the work..." data-testid="input-method-sequence" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" /> Equipment & Resources</Label>
            <Textarea rows={2} value={equipmentResources} onChange={e => setEquipmentResources(e.target.value)} placeholder="List equipment, tools, and resources needed..." data-testid="input-method-equipment" />
          </div>
          <div className="space-y-1.5">
            <Label>Hazards</Label>
            <Textarea rows={2} value={hazards} onChange={e => setHazards(e.target.value)} placeholder="Identify potential hazards..." data-testid="input-method-hazards" />
          </div>
          <div className="space-y-1.5">
            <Label>Control Measures</Label>
            <Textarea rows={2} value={controlMeasures} onChange={e => setControlMeasures(e.target.value)} placeholder="Safety controls to mitigate hazards..." data-testid="input-method-controls" />
          </div>
          <div className="space-y-1.5">
            <Label>PPE Required</Label>
            <Input value={ppe} onChange={e => setPpe(e.target.value)} placeholder="e.g. Hard hat, safety boots, hi-vis vest" data-testid="input-method-ppe" />
          </div>
          <div className="space-y-1.5">
            <Label>Emergency Procedures</Label>
            <Textarea rows={2} value={emergencyProcedures} onChange={e => setEmergencyProcedures(e.target.value)} placeholder="Emergency response steps..." data-testid="input-method-emergency" />
          </div>
          {scheduleTasks.length > 0 && (
            <div className="space-y-1.5">
              <Label>Link to Schedule Task</Label>
              <Select value={linkedTaskId} onValueChange={setLinkedTaskId}>
                <SelectTrigger data-testid="select-method-linked-task"><SelectValue placeholder="Select a task (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {scheduleTasks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {safetyChecklists.length > 0 && (
            <div className="space-y-1.5">
              <Label>Link to Safety Checklist</Label>
              <Select value={linkedSafetyChecklistId} onValueChange={setLinkedSafetyChecklistId}>
                <SelectTrigger data-testid="select-method-linked-checklist"><SelectValue placeholder="Select a safety checklist (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {safetyChecklists.map(c => <SelectItem key={c.id} value={c.id}>{c.templateName || `Checklist ${c.id.slice(0, 8)}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({
              title,
              workActivity,
              sequenceOfOperations: sequenceOfOperations || undefined,
              equipmentResources: equipmentResources || undefined,
              hazards: hazards || undefined,
              controlMeasures: controlMeasures || undefined,
              ppe: ppe || undefined,
              emergencyProcedures: emergencyProcedures || undefined,
              linkedScheduleTaskId: linkedTaskId && linkedTaskId !== "none" ? linkedTaskId : undefined,
              linkedSafetyChecklistId: linkedSafetyChecklistId && linkedSafetyChecklistId !== "none" ? linkedSafetyChecklistId : undefined,
            })}
            disabled={!title.trim() || !workActivity.trim() || isSaving}
            data-testid="button-create-method-statement"
          >
            {isSaving ? "Creating..." : "Create Method Statement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MethodStatementDetailDialog({ statement, scheduleTasks, safetyChecklists, canManage, onClose, onStatusChange, onSave, isUpdating, isSaving }: {
  statement: MethodStatement;
  scheduleTasks: ScheduleTask[];
  safetyChecklists: SafetyChecklist[];
  canManage: boolean;
  onClose: () => void;
  onStatusChange: (status: string, rejectionReason?: string) => void;
  onSave: (updates: Record<string, unknown>) => void;
  isUpdating: boolean;
  isSaving: boolean;
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(statement.title);
  const [editWorkActivity, setEditWorkActivity] = useState(statement.workActivity);
  const [editSequence, setEditSequence] = useState(statement.sequenceOfOperations || "");
  const [editEquipment, setEditEquipment] = useState(statement.equipmentResources || "");
  const [editHazards, setEditHazards] = useState(statement.hazards || "");
  const [editControls, setEditControls] = useState(statement.controlMeasures || "");
  const [editPpe, setEditPpe] = useState(statement.ppe || "");
  const [editEmergency, setEditEmergency] = useState(statement.emergencyProcedures || "");
  const [editLinkedTaskId, setEditLinkedTaskId] = useState(statement.linkedScheduleTaskId || "none");
  const [editLinkedChecklistId, setEditLinkedChecklistId] = useState(statement.linkedSafetyChecklistId || "none");

  const linkedTask = scheduleTasks.find(t => t.id === statement.linkedScheduleTaskId);
  const linkedChecklist = safetyChecklists.find(c => c.id === statement.linkedSafetyChecklistId);
  const canEdit = canManage && statement.status === "DRAFT";

  function handleSave() {
    onSave({
      title: editTitle,
      workActivity: editWorkActivity,
      sequenceOfOperations: editSequence || undefined,
      equipmentResources: editEquipment || undefined,
      hazards: editHazards || undefined,
      controlMeasures: editControls || undefined,
      ppe: editPpe || undefined,
      emergencyProcedures: editEmergency || undefined,
      linkedScheduleTaskId: editLinkedTaskId !== "none" ? editLinkedTaskId : undefined,
      linkedSafetyChecklistId: editLinkedChecklistId !== "none" ? editLinkedChecklistId : undefined,
    });
  }

  if (isEditing) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-edit-method-statement">
          <DialogHeader><DialogTitle>Edit Method Statement</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} data-testid="input-edit-method-title" />
            </div>
            <div className="space-y-1.5">
              <Label>Work Activity *</Label>
              <Textarea rows={2} value={editWorkActivity} onChange={e => setEditWorkActivity(e.target.value)} data-testid="input-edit-method-work-activity" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><ListOrdered className="h-3.5 w-3.5" /> Sequence of Operations</Label>
              <Textarea rows={3} value={editSequence} onChange={e => setEditSequence(e.target.value)} data-testid="input-edit-method-sequence" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" /> Equipment & Resources</Label>
              <Textarea rows={2} value={editEquipment} onChange={e => setEditEquipment(e.target.value)} data-testid="input-edit-method-equipment" />
            </div>
            <div className="space-y-1.5">
              <Label>Hazards</Label>
              <Textarea rows={2} value={editHazards} onChange={e => setEditHazards(e.target.value)} data-testid="input-edit-method-hazards" />
            </div>
            <div className="space-y-1.5">
              <Label>Control Measures</Label>
              <Textarea rows={2} value={editControls} onChange={e => setEditControls(e.target.value)} data-testid="input-edit-method-controls" />
            </div>
            <div className="space-y-1.5">
              <Label>PPE Required</Label>
              <Input value={editPpe} onChange={e => setEditPpe(e.target.value)} data-testid="input-edit-method-ppe" />
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Procedures</Label>
              <Textarea rows={2} value={editEmergency} onChange={e => setEditEmergency(e.target.value)} data-testid="input-edit-method-emergency" />
            </div>
            {scheduleTasks.length > 0 && (
              <div className="space-y-1.5">
                <Label>Link to Schedule Task</Label>
                <Select value={editLinkedTaskId} onValueChange={setEditLinkedTaskId}>
                  <SelectTrigger><SelectValue placeholder="Select a task (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {scheduleTasks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {safetyChecklists.length > 0 && (
              <div className="space-y-1.5">
                <Label>Link to Safety Checklist</Label>
                <Select value={editLinkedChecklistId} onValueChange={setEditLinkedChecklistId}>
                  <SelectTrigger><SelectValue placeholder="Select a safety checklist (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {safetyChecklists.map(c => <SelectItem key={c.id} value={c.id}>{c.templateName || `Checklist ${c.id.slice(0, 8)}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!editTitle.trim() || !editWorkActivity.trim() || isSaving} data-testid="button-save-method-edit">
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-method-statement-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {statement.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`text-xs ${STATUS_BADGE[statement.status]?.className || ""}`}>
              {STATUS_BADGE[statement.status]?.label || statement.status}
            </Badge>
            {linkedTask && (
              <Badge variant="secondary" className="text-xs">
                Task: {linkedTask.name}
              </Badge>
            )}
            {linkedChecklist && (
              <Badge variant="secondary" className="text-xs">
                Safety: {linkedChecklist.templateName || "Checklist"}
              </Badge>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Work Activity</h4>
              <p className="text-sm">{statement.workActivity}</p>
            </div>
            {statement.sequenceOfOperations && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
                  <ListOrdered className="h-3.5 w-3.5" /> Sequence of Operations
                </h4>
                <p className="text-sm whitespace-pre-line">{statement.sequenceOfOperations}</p>
              </div>
            )}
            {statement.equipmentResources && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
                  <Wrench className="h-3.5 w-3.5" /> Equipment & Resources
                </h4>
                <p className="text-sm whitespace-pre-line">{statement.equipmentResources}</p>
              </div>
            )}
            {statement.hazards && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Hazards</h4>
                <p className="text-sm">{statement.hazards}</p>
              </div>
            )}
            {statement.controlMeasures && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Control Measures</h4>
                <p className="text-sm">{statement.controlMeasures}</p>
              </div>
            )}
            {statement.ppe && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">PPE Required</h4>
                <p className="text-sm flex items-center gap-1"><Shield className="h-3.5 w-3.5 text-blue-600" /> {statement.ppe}</p>
              </div>
            )}
            {statement.emergencyProcedures && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Emergency Procedures</h4>
                <p className="text-sm">{statement.emergencyProcedures}</p>
              </div>
            )}
            {statement.rejectionReason && (
              <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded border border-red-200">
                <h4 className="text-xs font-semibold text-red-700 uppercase mb-1">Rejection Reason</h4>
                <p className="text-sm text-red-700">{statement.rejectionReason}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground border-t pt-3">
            <span>Created {fmtDate(statement.createdAt)}</span>
            {statement.submittedAt && <span>Submitted {fmtDate(statement.submittedAt)}</span>}
            {statement.approvedAt && <span className="text-green-700">Approved {fmtDate(statement.approvedAt)}</span>}
          </div>
        </div>

        {canManage && (
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {canEdit && (
              <Button
                variant="outline"
                onClick={() => setIsEditing(true)}
                data-testid="button-edit-method"
              >
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
            {statement.status === "DRAFT" && (
              <Button
                onClick={() => onStatusChange("SUBMITTED")}
                disabled={isUpdating}
                data-testid="button-submit-method"
              >
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Submit for Approval
              </Button>
            )}
            {statement.status === "SUBMITTED" && (
              <>
                <Button
                  onClick={() => onStatusChange("APPROVED")}
                  disabled={isUpdating}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-approve-method"
                >
                  Approve
                </Button>
                {!showReject ? (
                  <Button variant="destructive" onClick={() => setShowReject(true)} data-testid="button-show-reject">
                    Reject
                  </Button>
                ) : (
                  <div className="flex gap-2 w-full">
                    <Input
                      placeholder="Rejection reason..."
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      className="flex-1"
                      data-testid="input-rejection-reason"
                    />
                    <Button
                      variant="destructive"
                      onClick={() => onStatusChange("REJECTED", rejectionReason)}
                      disabled={isUpdating || !rejectionReason.trim()}
                      data-testid="button-confirm-reject"
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </>
            )}
            {statement.status === "REJECTED" && (
              <Button
                onClick={() => onStatusChange("DRAFT")}
                disabled={isUpdating}
                variant="outline"
                data-testid="button-revert-to-draft"
              >
                Revert to Draft
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
