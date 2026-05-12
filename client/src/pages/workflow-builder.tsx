import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Copy, ArrowRight, Settings2, Bell, ShieldCheck, ChevronDown, ChevronUp, Pencil, Power, PowerOff, GripVertical } from "lucide-react";
import { useIntegrationStatus } from "@/hooks/use-integration-status";

const ENTITY_TYPES = [
  { value: "CHANGE_ORDER", label: "Change Order" },
  { value: "SOV_PAY_APP", label: "Pay Application" },
  { value: "TIME_APPROVAL", label: "Time Approval" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "PURCHASE_REQUEST", label: "Purchase Request" },
  { value: "VENDOR_BILL", label: "Vendor Bill" },
  { value: "TM_TICKET", label: "T&M Ticket" },
];

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "HUSTLER", label: "Hustler" },
  { value: "MANAGER", label: "Manager" },
  { value: "SUPERINTENDENT", label: "Superintendent" },
  { value: "ESTIMATOR", label: "Estimator" },
  { value: "FIELD_WORKER", label: "Field Worker" },
  { value: "VENDOR", label: "Vendor" },
];

const STAGE_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6b7280",
];

const ALL_CHANNELS = [
  { value: "EMAIL", label: "Email" },
  { value: "PUSH", label: "Push Notification" },
  { value: "SMS", label: "SMS", requiresTwilio: true },
  { value: "SLACK", label: "Slack" },
  { value: "TEAMS", label: "Microsoft Teams" },
];

interface StageForm {
  name: string;
  description: string;
  stageOrder: number;
  color: string;
  isInitial: boolean;
  isFinal: boolean;
  slaDurationHours: number | null;
  autoEscalateRole: string;
  approvalSteps: ApprovalStepForm[];
  notificationRules: NotificationRuleForm[];
}

interface ApprovalStepForm {
  requiredRole: string;
  requiredUserId: string;
  requiredApprovalCount: number;
  stepOrder: number;
}

interface NotificationRuleForm {
  triggerOnEnter: boolean;
  triggerOnExit: boolean;
  channel: string;
  recipientRole: string;
  recipientUserId: string;
  notifySubmitter: boolean;
  messageTemplate: string;
}

function defaultStage(order: number): StageForm {
  return {
    name: "",
    description: "",
    stageOrder: order,
    color: STAGE_COLORS[order % STAGE_COLORS.length],
    isInitial: order === 0,
    isFinal: false,
    slaDurationHours: null,
    autoEscalateRole: "",
    approvalSteps: [],
    notificationRules: [],
  };
}

function defaultApprovalStep(order: number): ApprovalStepForm {
  return { requiredRole: "", requiredUserId: "", requiredApprovalCount: 1, stepOrder: order };
}

function defaultNotificationRule(): NotificationRuleForm {
  return { triggerOnEnter: true, triggerOnExit: false, channel: "EMAIL", recipientRole: "", recipientUserId: "", notifySubmitter: false, messageTemplate: "" };
}

export default function WorkflowBuilderPage({ embedded }: { embedded?: boolean }) {
  const { toast } = useToast();
  const { status: integrationStatus } = useIntegrationStatus();
  const channels = ALL_CHANNELS.filter(c => !c.requiresTwilio || integrationStatus.twilio);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [entityType, setEntityType] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [stages, setStages] = useState<StageForm[]>([defaultStage(0)]);
  const [expandedStage, setExpandedStage] = useState<number | null>(0);

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/workflows"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingId) {
        return apiRequest("PUT", `/api/workflows/${editingId}`, data);
      }
      return apiRequest("POST", "/api/workflows", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      resetEditor();
      toast({ title: editingId ? "Workflow updated" : "Workflow created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save workflow", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/workflows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow deleted" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/workflows/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Status updated" });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/workflows/${id}/clone`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow cloned" });
    },
  });

  function resetEditor() {
    setShowEditor(false);
    setEditingId(null);
    setTemplateName("");
    setTemplateDesc("");
    setEntityType("");
    setIsDefault(false);
    setStages([defaultStage(0)]);
    setExpandedStage(0);
  }

  function openEditor(template?: any) {
    if (template) {
      setEditingId(template.id);
      setTemplateName(template.name);
      setTemplateDesc(template.description || "");
      setEntityType(template.entityType);
      setIsDefault(template.isDefault);
      setStages(
        template.stages?.map((s: any, i: number) => ({
          name: s.name,
          description: s.description || "",
          stageOrder: s.stageOrder,
          color: s.color || STAGE_COLORS[i % STAGE_COLORS.length],
          isInitial: s.isInitial,
          isFinal: s.isFinal,
          slaDurationHours: s.slaDurationHours ?? null,
          autoEscalateRole: s.autoEscalateRole || "",
          approvalSteps: s.approvalSteps?.map((a: any) => ({
            requiredRole: a.requiredRole || "",
            requiredUserId: a.requiredUserId || "",
            requiredApprovalCount: a.requiredApprovalCount || 1,
            stepOrder: a.stepOrder || 1,
          })) || [],
          notificationRules: s.notificationRules?.map((n: any) => ({
            triggerOnEnter: n.triggerOnEnter ?? true,
            triggerOnExit: n.triggerOnExit ?? false,
            channel: n.channel || "EMAIL",
            recipientRole: n.recipientRole || "",
            recipientUserId: n.recipientUserId || "",
            notifySubmitter: n.notifySubmitter ?? false,
            messageTemplate: n.messageTemplate || "",
          })) || [],
        })) || [defaultStage(0)]
      );
      setExpandedStage(0);
    } else {
      resetEditor();
      setStages([defaultStage(0)]);
    }
    setShowEditor(true);
  }

  function handleSave() {
    if (!templateName || !entityType || stages.length === 0) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    for (const s of stages) {
      if (!s.name) {
        toast({ title: "All stages must have a name", variant: "destructive" });
        return;
      }
    }

    const hasInitial = stages.some(s => s.isInitial);
    const hasFinal = stages.some(s => s.isFinal);
    if (!hasInitial) stages[0].isInitial = true;
    if (!hasFinal) stages[stages.length - 1].isFinal = true;

    createMutation.mutate({
      name: templateName,
      description: templateDesc || undefined,
      entityType,
      isDefault,
      stages: stages.map((s, i) => ({
        ...s,
        stageOrder: i,
        approvalSteps: s.approvalSteps.filter(a => a.requiredRole || a.requiredUserId),
        notificationRules: s.notificationRules.filter(n => n.recipientRole || n.recipientUserId || n.notifySubmitter),
      })),
    });
  }

  function addStage() {
    setStages([...stages, defaultStage(stages.length)]);
    setExpandedStage(stages.length);
  }

  function removeStage(index: number) {
    if (stages.length <= 1) return;
    const newStages = stages.filter((_, i) => i !== index);
    newStages.forEach((s, i) => { s.stageOrder = i; });
    if (newStages.length > 0 && !newStages.some(s => s.isInitial)) newStages[0].isInitial = true;
    if (newStages.length > 0 && !newStages.some(s => s.isFinal)) newStages[newStages.length - 1].isFinal = true;
    setStages(newStages);
    setExpandedStage(null);
  }

  function moveStage(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= stages.length) return;
    const newStages = [...stages];
    [newStages[index], newStages[newIndex]] = [newStages[newIndex], newStages[index]];
    newStages.forEach((s, i) => { s.stageOrder = i; });
    setStages(newStages);
    setExpandedStage(newIndex);
  }

  function updateStage(index: number, updates: Partial<StageForm>) {
    const newStages = [...stages];
    newStages[index] = { ...newStages[index], ...updates };
    setStages(newStages);
  }

  const containerClass = embedded ? "" : "p-6 max-w-6xl mx-auto";

  return (
    <div className={containerClass}>
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-workflow-title">Workflow Builder</h1>
            <p className="text-muted-foreground">Create and manage custom approval workflows for your organization</p>
          </div>
          <Button onClick={() => openEditor()} data-testid="button-create-workflow">
            <Plus className="w-4 h-4 mr-2" />
            New Workflow
          </Button>
        </div>
      )}

      {embedded && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">Define custom approval chains and notification rules</p>
          <Button onClick={() => openEditor()} size="sm" data-testid="button-create-workflow">
            <Plus className="w-4 h-4 mr-2" />
            New Workflow
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader><div className="h-5 bg-muted rounded w-1/2" /></CardHeader>
              <CardContent><div className="h-4 bg-muted rounded w-3/4" /></CardContent>
            </Card>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2" data-testid="text-no-workflows">No Workflows Yet</h3>
            <p className="text-muted-foreground text-center mb-4">Create your first custom workflow to define approval chains and notification rules.</p>
            <Button onClick={() => openEditor()} data-testid="button-create-first-workflow">
              <Plus className="w-4 h-4 mr-2" />
              Create Workflow
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template: any) => (
            <Card key={template.id} data-testid={`card-workflow-${template.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg" data-testid={`text-workflow-name-${template.id}`}>{template.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {ENTITY_TYPES.find(e => e.value === template.entityType)?.label || template.entityType}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={template.status === "ACTIVE" ? "default" : template.status === "DRAFT" ? "secondary" : "outline"}
                      data-testid={`badge-status-${template.id}`}
                    >
                      {template.status}
                    </Badge>
                    {template.isDefault && <Badge variant="outline">Default</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {template.description && (
                  <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                )}
                <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
                  {template.stages?.map((stage: any, i: number) => (
                    <div key={stage.id} className="flex items-center">
                      <div
                        className="px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap"
                        style={{ backgroundColor: stage.color || "#6366f1" }}
                        data-testid={`badge-stage-${stage.id}`}
                      >
                        {stage.name}
                      </div>
                      {i < template.stages.length - 1 && (
                        <ArrowRight className="w-3 h-3 mx-1 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditor(template)} data-testid={`button-edit-${template.id}`}>
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => cloneMutation.mutate(template.id)} data-testid={`button-clone-${template.id}`}>
                    <Copy className="w-3 h-3 mr-1" />
                    Clone
                  </Button>
                  {template.status !== "ACTIVE" ? (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: template.id, status: "ACTIVE" })} data-testid={`button-activate-${template.id}`}>
                      <Power className="w-3 h-3 mr-1" />
                      Activate
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: template.id, status: "INACTIVE" })} data-testid={`button-deactivate-${template.id}`}>
                      <PowerOff className="w-3 h-3 mr-1" />
                      Deactivate
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(template.id)} data-testid={`button-delete-${template.id}`}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showEditor} onOpenChange={(open) => { if (!open) resetEditor(); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-editor-title">{editingId ? "Edit Workflow" : "Create Workflow"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="template-name">Workflow Name *</Label>
                <Input
                  id="template-name"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="e.g., Change Order Approval"
                  data-testid="input-workflow-name"
                />
              </div>
              <div>
                <Label htmlFor="entity-type">Entity Type *</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger data-testid="select-entity-type">
                    <SelectValue placeholder="Select entity type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map(e => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="template-desc">Description</Label>
              <Textarea
                id="template-desc"
                value={templateDesc}
                onChange={e => setTemplateDesc(e.target.value)}
                placeholder="Describe this workflow..."
                rows={2}
                data-testid="input-workflow-description"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} id="is-default" data-testid="switch-is-default" />
              <Label htmlFor="is-default">Set as default template for this entity type</Label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-lg">Pipeline Stages</h3>
                <Button size="sm" variant="outline" onClick={addStage} data-testid="button-add-stage">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Stage
                </Button>
              </div>

              <div className="flex items-center gap-1 mb-4 px-2 overflow-x-auto pb-2">
                {stages.map((stage, i) => (
                  <div key={i} className="flex items-center">
                    <div
                      className="px-3 py-1.5 rounded text-xs font-medium text-white cursor-pointer whitespace-nowrap"
                      style={{ backgroundColor: stage.color || "#6366f1", opacity: stage.name ? 1 : 0.5 }}
                      onClick={() => setExpandedStage(expandedStage === i ? null : i)}
                    >
                      {stage.name || `Stage ${i + 1}`}
                      {stage.isInitial && " ●"}
                      {stage.isFinal && " ◼"}
                    </div>
                    {i < stages.length - 1 && <ArrowRight className="w-4 h-4 mx-1 text-muted-foreground flex-shrink-0" />}
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {stages.map((stage, stageIdx) => (
                  <Card
                    key={stageIdx}
                    className={`border-l-4 ${expandedStage === stageIdx ? "" : "cursor-pointer"}`}
                    style={{ borderLeftColor: stage.color || "#6366f1" }}
                    data-testid={`card-stage-${stageIdx}`}
                  >
                    <CardHeader
                      className="py-3 cursor-pointer"
                      onClick={() => setExpandedStage(expandedStage === stageIdx ? null : stageIdx)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{stage.name || `Stage ${stageIdx + 1}`}</span>
                          {stage.isInitial && <Badge variant="secondary" className="text-xs">Start</Badge>}
                          {stage.isFinal && <Badge variant="secondary" className="text-xs">End</Badge>}
                          {stage.approvalSteps.length > 0 && (
                            <Badge variant="outline" className="text-xs"><ShieldCheck className="w-3 h-3 mr-1" />{stage.approvalSteps.length}</Badge>
                          )}
                          {stage.notificationRules.length > 0 && (
                            <Badge variant="outline" className="text-xs"><Bell className="w-3 h-3 mr-1" />{stage.notificationRules.length}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); moveStage(stageIdx, "up"); }} disabled={stageIdx === 0}>
                            <ChevronUp className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); moveStage(stageIdx, "down"); }} disabled={stageIdx === stages.length - 1}>
                            <ChevronDown className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeStage(stageIdx); }} disabled={stages.length <= 1}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    {expandedStage === stageIdx && (
                      <CardContent className="pt-0 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Stage Name *</Label>
                            <Input
                              value={stage.name}
                              onChange={e => updateStage(stageIdx, { name: e.target.value })}
                              placeholder="e.g., Review"
                              data-testid={`input-stage-name-${stageIdx}`}
                            />
                          </div>
                          <div>
                            <Label>Color</Label>
                            <div className="flex items-center gap-2 mt-1">
                              {STAGE_COLORS.map(color => (
                                <button
                                  key={color}
                                  className={`w-6 h-6 rounded-full border-2 ${stage.color === color ? "border-foreground" : "border-transparent"}`}
                                  style={{ backgroundColor: color }}
                                  onClick={() => updateStage(stageIdx, { color })}
                                  data-testid={`color-${color}-${stageIdx}`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label>Description</Label>
                          <Input
                            value={stage.description}
                            onChange={e => updateStage(stageIdx, { description: e.target.value })}
                            placeholder="What happens in this stage?"
                            data-testid={`input-stage-desc-${stageIdx}`}
                          />
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={stage.isInitial}
                              onCheckedChange={checked => {
                                const newStages = stages.map((s, i) => ({ ...s, isInitial: i === stageIdx ? checked : false }));
                                setStages(newStages);
                              }}
                              data-testid={`switch-initial-${stageIdx}`}
                            />
                            <Label>Initial Stage</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={stage.isFinal}
                              onCheckedChange={checked => updateStage(stageIdx, { isFinal: checked })}
                              data-testid={`switch-final-${stageIdx}`}
                            />
                            <Label>Final Stage</Label>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">SLA (hours)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={stage.slaDurationHours ?? ""}
                              onChange={e => updateStage(stageIdx, { slaDurationHours: e.target.value ? Number(e.target.value) : null })}
                              placeholder="No SLA"
                              className="mt-1 text-sm"
                              data-testid={`input-sla-hours-${stageIdx}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Auto-Escalate Role</Label>
                            <Select
                              value={stage.autoEscalateRole || "__none__"}
                              onValueChange={val => updateStage(stageIdx, { autoEscalateRole: val === "__none__" ? "" : val })}
                            >
                              <SelectTrigger className="mt-1 text-sm" data-testid={`select-escalate-role-${stageIdx}`}>
                                <SelectValue placeholder="None" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                <SelectItem value="MANAGER">Manager</SelectItem>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                                <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                                <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4" />
                              <span className="font-medium text-sm">Approval Gates</span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateStage(stageIdx, {
                                approvalSteps: [...stage.approvalSteps, defaultApprovalStep(stage.approvalSteps.length + 1)]
                              })}
                              data-testid={`button-add-approval-${stageIdx}`}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Add
                            </Button>
                          </div>
                          {stage.approvalSteps.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No approval gates. Items pass through automatically.</p>
                          ) : (
                            <div className="space-y-2">
                              {stage.approvalSteps.map((step, stepIdx) => (
                                <div key={stepIdx} className="flex items-center gap-2 bg-muted/50 rounded p-2">
                                  <Select
                                    value={step.requiredRole}
                                    onValueChange={val => {
                                      const newSteps = [...stage.approvalSteps];
                                      newSteps[stepIdx] = { ...newSteps[stepIdx], requiredRole: val };
                                      updateStage(stageIdx, { approvalSteps: newSteps });
                                    }}
                                  >
                                    <SelectTrigger className="w-[160px]" data-testid={`select-approval-role-${stageIdx}-${stepIdx}`}>
                                      <SelectValue placeholder="Required role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-xs whitespace-nowrap">Approvals:</Label>
                                    <Input
                                      type="number"
                                      min={1}
                                      value={step.requiredApprovalCount}
                                      onChange={e => {
                                        const newSteps = [...stage.approvalSteps];
                                        newSteps[stepIdx] = { ...newSteps[stepIdx], requiredApprovalCount: parseInt(e.target.value) || 1 };
                                        updateStage(stageIdx, { approvalSteps: newSteps });
                                      }}
                                      className="w-16"
                                      data-testid={`input-approval-count-${stageIdx}-${stepIdx}`}
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      updateStage(stageIdx, { approvalSteps: stage.approvalSteps.filter((_, i) => i !== stepIdx) });
                                    }}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Bell className="w-4 h-4" />
                              <span className="font-medium text-sm">Notification Rules</span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateStage(stageIdx, {
                                notificationRules: [...stage.notificationRules, defaultNotificationRule()]
                              })}
                              data-testid={`button-add-notification-${stageIdx}`}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Add
                            </Button>
                          </div>
                          {stage.notificationRules.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No notifications configured for this stage.</p>
                          ) : (
                            <div className="space-y-2">
                              {stage.notificationRules.map((rule, ruleIdx) => (
                                <div key={ruleIdx} className="bg-muted/50 rounded p-2 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Select
                                      value={rule.channel}
                                      onValueChange={val => {
                                        const newRules = [...stage.notificationRules];
                                        newRules[ruleIdx] = { ...newRules[ruleIdx], channel: val };
                                        updateStage(stageIdx, { notificationRules: newRules });
                                      }}
                                    >
                                      <SelectTrigger className="w-[140px]" data-testid={`select-notif-channel-${stageIdx}-${ruleIdx}`}>
                                        <SelectValue placeholder="Channel" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {channels.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={rule.recipientRole}
                                      onValueChange={val => {
                                        const newRules = [...stage.notificationRules];
                                        newRules[ruleIdx] = { ...newRules[ruleIdx], recipientRole: val };
                                        updateStage(stageIdx, { notificationRules: newRules });
                                      }}
                                    >
                                      <SelectTrigger className="w-[160px]" data-testid={`select-notif-role-${stageIdx}-${ruleIdx}`}>
                                        <SelectValue placeholder="Recipient role" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        updateStage(stageIdx, { notificationRules: stage.notificationRules.filter((_, i) => i !== ruleIdx) });
                                      }}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <div className="flex items-center gap-4 text-xs">
                                    <div className="flex items-center gap-1">
                                      <Switch
                                        checked={rule.triggerOnEnter}
                                        onCheckedChange={checked => {
                                          const newRules = [...stage.notificationRules];
                                          newRules[ruleIdx] = { ...newRules[ruleIdx], triggerOnEnter: checked };
                                          updateStage(stageIdx, { notificationRules: newRules });
                                        }}
                                      />
                                      <Label className="text-xs">On Enter</Label>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Switch
                                        checked={rule.triggerOnExit}
                                        onCheckedChange={checked => {
                                          const newRules = [...stage.notificationRules];
                                          newRules[ruleIdx] = { ...newRules[ruleIdx], triggerOnExit: checked };
                                          updateStage(stageIdx, { notificationRules: newRules });
                                        }}
                                      />
                                      <Label className="text-xs">On Exit</Label>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Switch
                                        checked={rule.notifySubmitter}
                                        onCheckedChange={checked => {
                                          const newRules = [...stage.notificationRules];
                                          newRules[ruleIdx] = { ...newRules[ruleIdx], notifySubmitter: checked };
                                          updateStage(stageIdx, { notificationRules: newRules });
                                        }}
                                      />
                                      <Label className="text-xs">Notify Submitter</Label>
                                    </div>
                                  </div>
                                  <Input
                                    value={rule.messageTemplate}
                                    onChange={e => {
                                      const newRules = [...stage.notificationRules];
                                      newRules[ruleIdx] = { ...newRules[ruleIdx], messageTemplate: e.target.value };
                                      updateStage(stageIdx, { notificationRules: newRules });
                                    }}
                                    placeholder="Custom notification message (optional)"
                                    className="text-xs"
                                    data-testid={`input-notif-message-${stageIdx}-${ruleIdx}`}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetEditor} data-testid="button-cancel">Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending} data-testid="button-save-workflow">
              {createMutation.isPending ? "Saving..." : editingId ? "Update Workflow" : "Create Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
