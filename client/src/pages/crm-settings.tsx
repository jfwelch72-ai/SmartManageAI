import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { CrmAssignmentRule } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Copy, Check, Plus, Trash2, Settings } from "lucide-react";

interface OrgUser { id: string; firstName: string | null; lastName: string | null; email: string }

export default function CrmSettingsPage() {
  const { user } = useAuth();
  const orgSlug = (user as any)?.organization?.slug || "your-org";
  const baseUrl = window.location.origin;
  const formUrl = `${baseUrl}/leads/${orgSlug}`;
  const iframeSnippet = `<iframe src="${formUrl}?embed=1" width="100%" height="640" style="border:0;max-width:560px" title="Contact us"></iframe>`;

  const [copied, setCopied] = useState<string | null>(null);
  const copyText = async (key: string, txt: string) => {
    await navigator.clipboard.writeText(txt);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Settings className="w-6 h-6" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-crm-settings">CRM Settings</h1>
          <p className="text-sm text-muted-foreground">Web-to-Lead capture and territory auto-assignment.</p>
        </div>
      </div>

      <Card data-testid="card-web-to-lead">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" /> Web-to-Lead Form</CardTitle>
          <CardDescription>
            Embed a contact form on your website. Submissions create a Lead opportunity automatically and run through your assignment rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Hosted Form URL</Label>
            <div className="flex gap-2 mt-1">
              <Input readOnly value={formUrl} data-testid="input-form-url" />
              <Button variant="outline" onClick={() => copyText("url", formUrl)} data-testid="button-copy-url">
                {copied === "url" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
              <Button variant="outline" asChild data-testid="button-open-form">
                <a href={formUrl} target="_blank" rel="noopener noreferrer">Open</a>
              </Button>
            </div>
          </div>
          <div>
            <Label>Embed Snippet</Label>
            <div className="flex gap-2 mt-1">
              <Textarea readOnly value={iframeSnippet} className="font-mono text-xs" rows={3} data-testid="textarea-embed-snippet" />
              <Button variant="outline" onClick={() => copyText("snippet", iframeSnippet)} data-testid="button-copy-snippet">
                {copied === "snippet" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Paste into any HTML page. Uses a hidden honeypot field for spam protection.</p>
          </div>
        </CardContent>
      </Card>

      <AssignmentRulesCard />
    </div>
  );
}

function AssignmentRulesCard() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CrmAssignmentRule | null>(null);

  const { data: rules = [], isLoading } = useQuery<CrmAssignmentRule[]>({ queryKey: ["/api/crm/assignment-rules"] });
  const { data: users = [] } = useQuery<OrgUser[]>({ queryKey: ["/api/users"] });

  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email]));

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/assignment-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/assignment-rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/crm/assignment-rules/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/assignment-rules"] }),
  });

  return (
    <Card data-testid="card-assignment-rules">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Auto-Assignment Rules</CardTitle>
          <CardDescription>Rules are evaluated top-to-bottom by priority. The first match wins.</CardDescription>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="button-new-rule">
          <Plus className="w-4 h-4 mr-1" /> New Rule
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Settings}
            title="No rules yet"
            description="Route incoming leads automatically based on source, project type, location, or value."
            actionLabel="New Rule"
            onAction={() => { setEditing(null); setDialogOpen(true); }}
            testId="empty-assignment-rules"
          />
        ) : (
          <div className="space-y-2">
            {rules.map(r => {
              const cond = (r.conditions ?? {}) as Record<string, unknown>;
              const condSummary = Object.entries(cond).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${v}`).join(", ") || "Any lead";
              const target = r.assignmentType === "ROUND_ROBIN"
                ? `Round-robin (${(r.roundRobinUserIds || []).length} users)`
                : r.assignedToId ? userMap[r.assignedToId] || "User" : "—";
              return (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded border" data-testid={`row-rule-${r.id}`}>
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: r.id, isActive: v })}
                    data-testid={`switch-rule-${r.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid={`text-rule-name-${r.id}`}>{r.name}</span>
                      <Badge variant="outline" className="text-xs">Priority {r.priority}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">When: {condSummary} → Assign to: {target}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setDialogOpen(true); }} data-testid={`button-edit-rule-${r.id}`}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(r.id)} data-testid={`button-delete-rule-${r.id}`}><Trash2 className="w-4 h-4" /></Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <RuleDialog open={dialogOpen} onOpenChange={setDialogOpen} rule={editing} users={users} />
    </Card>
  );
}

function RuleDialog({ open, onOpenChange, rule, users }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  rule: CrmAssignmentRule | null;
  users: OrgUser[];
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(10);
  const [isActive, setIsActive] = useState(true);
  const [source, setSource] = useState("");
  const [projectType, setProjectType] = useState("");
  const [locationContains, setLocationContains] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [assignmentType, setAssignmentType] = useState<"USER" | "ROUND_ROBIN">("USER");
  const [assignedToId, setAssignedToId] = useState("");
  const [roundRobinUserIds, setRoundRobinUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setPriority(rule.priority);
      setIsActive(rule.isActive);
      setAssignmentType(rule.assignmentType as "USER" | "ROUND_ROBIN");
      setAssignedToId(rule.assignedToId ?? "");
      setRoundRobinUserIds(rule.roundRobinUserIds ?? []);
      const c = (rule.conditions ?? {}) as Record<string, any>;
      setSource(c.source ?? "");
      setProjectType(c.projectType ?? "");
      setLocationContains(c.locationContains ?? "");
      setMinValue(c.minValue?.toString() ?? "");
      setMaxValue(c.maxValue?.toString() ?? "");
    } else {
      setName(""); setPriority(10); setIsActive(true);
      setSource(""); setProjectType(""); setLocationContains("");
      setMinValue(""); setMaxValue("");
      setAssignmentType("USER"); setAssignedToId(""); setRoundRobinUserIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule?.id]);

  const reset = () => {
    setName(""); setPriority(10); setIsActive(true);
    setSource(""); setProjectType(""); setLocationContains("");
    setMinValue(""); setMaxValue("");
    setAssignmentType("USER"); setAssignedToId(""); setRoundRobinUserIds([]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const conditions: Record<string, unknown> = {};
      if (source) conditions.source = source;
      if (projectType) conditions.projectType = projectType;
      if (locationContains) conditions.locationContains = locationContains;
      if (minValue) conditions.minValue = Number(minValue);
      if (maxValue) conditions.maxValue = Number(maxValue);
      const body = {
        name, priority, isActive, conditions, assignmentType,
        assignedToId: assignmentType === "USER" ? (assignedToId || null) : null,
        roundRobinUserIds: assignmentType === "ROUND_ROBIN" ? roundRobinUserIds : [],
      };
      if (rule) return apiRequest("PATCH", `/api/crm/assignment-rules/${rule.id}`, body);
      return apiRequest("POST", "/api/crm/assignment-rules", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/assignment-rules"] });
      toast({ title: rule ? "Rule updated" : "Rule created" });
      onOpenChange(false);
      reset();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) reset(); onOpenChange(b); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-rule-editor">
        <DialogHeader><DialogTitle>{rule ? "Edit Rule" : "New Assignment Rule"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label>Rule Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-rule-name" />
            </div>
            <div>
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} data-testid="input-rule-priority" />
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <p className="text-sm font-medium">Match conditions (all must apply, blank = any)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Source</Label>
                <Input placeholder="e.g. WEB_FORM, REFERRAL" value={source} onChange={(e) => setSource(e.target.value)} data-testid="input-rule-source" />
              </div>
              <div>
                <Label>Project Type</Label>
                <Input placeholder="e.g. RESIDENTIAL" value={projectType} onChange={(e) => setProjectType(e.target.value)} data-testid="input-rule-projecttype" />
              </div>
              <div className="col-span-2">
                <Label>Location contains</Label>
                <Input placeholder="e.g. Denver, CO" value={locationContains} onChange={(e) => setLocationContains(e.target.value)} data-testid="input-rule-location" />
              </div>
              <div>
                <Label>Min value ($)</Label>
                <Input type="number" value={minValue} onChange={(e) => setMinValue(e.target.value)} data-testid="input-rule-minvalue" />
              </div>
              <div>
                <Label>Max value ($)</Label>
                <Input type="number" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} data-testid="input-rule-maxvalue" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Assignment Type</Label>
              <Select value={assignmentType} onValueChange={(v) => setAssignmentType(v as "USER" | "ROUND_ROBIN")}>
                <SelectTrigger data-testid="select-rule-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">Assign to single user</SelectItem>
                  <SelectItem value="ROUND_ROBIN">Round-robin among users</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {assignmentType === "USER" ? (
              <div>
                <Label>Assignee</Label>
                <Select value={assignedToId || "_none"} onValueChange={(v) => setAssignedToId(v === "_none" ? "" : v)}>
                  <SelectTrigger data-testid="select-rule-user"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Round-robin users</Label>
                <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                  {users.map(u => {
                    const checked = roundRobinUserIds.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={checked} onChange={(e) => {
                          if (e.target.checked) setRoundRobinUserIds(arr => [...arr, u.id]);
                          else setRoundRobinUserIds(arr => arr.filter(x => x !== u.id));
                        }} data-testid={`checkbox-rr-user-${u.id}`} />
                        <span>{`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-rule-active" />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} data-testid="button-rule-cancel">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!name || saveMutation.isPending} data-testid="button-rule-save">
            {saveMutation.isPending ? "Saving..." : rule ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
