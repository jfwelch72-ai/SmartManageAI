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
import { Globe, Copy, Check, Plus, Trash2, Settings, Package, Target, Users, ListPlus, ArrowUp, ArrowDown, Pencil } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

      <EmailLoggingCard />

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList className="grid grid-cols-4 w-full sm:w-auto">
          <TabsTrigger value="catalog" data-testid="tab-settings-catalog"><Package className="w-4 h-4 mr-1" /> Catalog</TabsTrigger>
          <TabsTrigger value="scoring" data-testid="tab-settings-scoring"><Target className="w-4 h-4 mr-1" /> Lead Scoring</TabsTrigger>
          <TabsTrigger value="duplicates" data-testid="tab-settings-duplicates"><Users className="w-4 h-4 mr-1" /> Duplicates</TabsTrigger>
          <TabsTrigger value="customfields" data-testid="tab-settings-customfields"><ListPlus className="w-4 h-4 mr-1" /> Custom Fields</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-4"><CatalogManagerCard /></TabsContent>
        <TabsContent value="scoring" className="mt-4"><LeadScoringRulesCard /></TabsContent>
        <TabsContent value="duplicates" className="mt-4"><DuplicatesCard /></TabsContent>
        <TabsContent value="customfields" className="mt-4"><CustomFieldsCard /></TabsContent>
      </Tabs>
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
                ? `Round-robin (${((r.roundRobinUserIds as string[] | null) || []).length} users)`
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
      setRoundRobinUserIds((rule.roundRobinUserIds as string[] | null) ?? []);
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

interface CatalogItem { id: string; name: string; description: string | null; sku: string | null; unitPrice: string; itemType: string; isActive: boolean }
function CatalogManagerCard() {
  const { toast } = useToast();
  const { data: items = [], isLoading } = useQuery<CatalogItem[]>({ queryKey: ["/api/crm/catalog-items"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", sku: "", description: "", unitPrice: "0", itemType: "PRODUCT" });
  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/crm/catalog-items", { ...form, unitPrice: Number(form.unitPrice) || 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/catalog-items"] }); setOpen(false); setForm({ name: "", sku: "", description: "", unitPrice: "0", itemType: "PRODUCT" }); toast({ title: "Item added" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/catalog-items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/catalog-items"] }); toast({ title: "Removed" }); },
  });
  return (
    <Card data-testid="card-catalog-manager">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Package className="w-5 h-5" /> Product & Service Catalog</CardTitle>
          <CardDescription>Reusable products and services for quotes.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} data-testid="button-add-catalog-item"><Plus className="w-4 h-4 mr-1" /> Add Item</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-20 w-full" /> : items.length === 0 ? (
          <EmptyState icon={Package} title="No catalog items yet" description="Add reusable products and services to speed up quote creation." testId="empty-catalog" />
        ) : (
          <div className="rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr className="text-left"><th className="px-3 py-2">Name</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id} className="border-t hover-elevate" data-testid={`row-catalog-${i.id}`}>
                    <td className="px-3 py-2 font-medium">{i.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i.sku || "—"}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{i.itemType}</Badge></td>
                    <td className="px-3 py-2 text-right font-mono">${Number(i.unitPrice).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => del.mutate(i.id)} data-testid={`button-delete-catalog-${i.id}`}><Trash2 className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="dialog-new-catalog-item">
          <DialogHeader><DialogTitle>New Catalog Item</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-cat-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>SKU</Label><Input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} data-testid="input-cat-sku" /></div>
              <div><Label>Type</Label>
                <Select value={form.itemType} onValueChange={v => setForm(f => ({ ...f, itemType: v }))}>
                  <SelectTrigger data-testid="select-cat-type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="PRODUCT">Product</SelectItem><SelectItem value="SERVICE">Service</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Unit Price</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} data-testid="input-cat-price" /></div>
            <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-cat-desc" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending} data-testid="button-create-catalog">{create.isPending ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface ScoringRule { id: string; name: string; field: string; operator: string; value: string; points: number; isActive: boolean }
function LeadScoringRulesCard() {
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useQuery<ScoringRule[]>({ queryKey: ["/api/crm/lead-scoring-rules"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", field: "dealValue", operator: "GTE", value: "100000", points: 20 });
  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/crm/lead-scoring-rules", { ...form, points: Number(form.points) || 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/lead-scoring-rules"] }); setOpen(false); toast({ title: "Rule added" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/lead-scoring-rules/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/lead-scoring-rules"] }); toast({ title: "Removed" }); },
  });
  const recalc = useMutation({
    mutationFn: () => apiRequest("POST", "/api/crm/lead-scoring-rules/recalculate", {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] }); toast({ title: "All opportunities rescored" }); },
    onError: (e: Error) => toast({ title: "Recalc failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Card data-testid="card-lead-scoring">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" /> Lead Scoring Rules</CardTitle>
          <CardDescription>Add points based on opportunity attributes. Total scores appear as badges on cards.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => recalc.mutate()} disabled={recalc.isPending} data-testid="button-recalc-scores">{recalc.isPending ? "Recalculating..." : "Recalculate All"}</Button>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="button-add-rule"><Plus className="w-4 h-4 mr-1" /> Add Rule</Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-20 w-full" /> : rules.length === 0 ? (
          <EmptyState icon={Target} title="No scoring rules yet" description="Add rules like 'deal value ≥ $100k → +20 points'." testId="empty-rules" />
        ) : (
          <div className="rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr className="text-left"><th className="px-3 py-2">Name</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Op</th><th className="px-3 py-2">Value</th><th className="px-3 py-2 text-right">Points</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-t" data-testid={`row-rule-${r.id}`}>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.field}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{r.operator}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs">{r.value}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.points > 0 ? "+" : ""}{r.points}</td>
                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => del.mutate(r.id)} data-testid={`button-delete-rule-${r.id}`}><Trash2 className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="dialog-new-rule">
          <DialogHeader><DialogTitle>New Scoring Rule</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="High value deal" data-testid="input-rule-name" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Field</Label>
                <Select value={form.field} onValueChange={v => setForm(f => ({ ...f, field: v }))}>
                  <SelectTrigger data-testid="select-rule-field"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dealValue">Deal Value</SelectItem>
                    <SelectItem value="probability">Probability</SelectItem>
                    <SelectItem value="source">Source</SelectItem>
                    <SelectItem value="stage">Stage</SelectItem>
                    <SelectItem value="projectType">Project Type</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Operator</Label>
                <Select value={form.operator} onValueChange={v => setForm(f => ({ ...f, operator: v }))}>
                  <SelectTrigger data-testid="select-rule-op"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["EQ","NEQ","GTE","LTE","GT","LT","CONTAINS"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Points</Label><Input type="number" value={form.points} onChange={e => setForm(f => ({ ...f, points: Number(e.target.value) }))} data-testid="input-rule-points" /></div>
            </div>
            <div><Label>Value</Label><Input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} data-testid="input-rule-value" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending} data-testid="button-create-rule">{create.isPending ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface DupeGroup { entityType: string; matchKey: string; ids: string[]; names: string[] }
function DuplicatesCard() {
  const { toast } = useToast();
  const [scope, setScope] = useState<"contacts" | "organizations">("contacts");
  const { data: groups = [], isLoading, refetch } = useQuery<DupeGroup[]>({ queryKey: ["/api/crm/duplicates", scope] });
  const merge = useMutation({
    mutationFn: ({ entityType, primaryId, mergeIds }: { entityType: string; primaryId: string; mergeIds: string[] }) =>
      apiRequest("POST", "/api/crm/duplicates/merge", { entityType, primaryId, mergeIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organizations"] });
      refetch();
      toast({ title: "Merged" });
    },
    onError: (e: Error) => toast({ title: "Merge failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Card data-testid="card-duplicates">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Duplicate Detection</CardTitle>
          <CardDescription>Find and merge duplicate {scope}.</CardDescription>
        </div>
        <Select value={scope} onValueChange={v => setScope(v as any)}>
          <SelectTrigger className="w-40" data-testid="select-dupe-scope"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="contacts">Contacts</SelectItem>
            <SelectItem value="organizations">Organizations</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-20 w-full" /> : groups.length === 0 ? (
          <EmptyState icon={Users} title="No duplicates found" description={`Your ${scope} look clean.`} testId="empty-dupes" />
        ) : (
          <div className="space-y-3">
            {groups.map((g, idx) => (
              <div key={idx} className="border rounded p-3" data-testid={`dupe-group-${idx}`}>
                <p className="text-xs text-muted-foreground mb-2">Match: <span className="font-mono">{g.matchKey}</span></p>
                <ul className="text-sm space-y-1">
                  {g.names.map((n, i) => (
                    <li key={g.ids[i]} className="flex items-center justify-between">
                      <span>{n}</span>
                      <Button size="sm" variant="outline" disabled={merge.isPending}
                        onClick={() => merge.mutate({ entityType: g.entityType, primaryId: g.ids[i], mergeIds: g.ids.filter(id => id !== g.ids[i]) })}
                        data-testid={`button-keep-${g.ids[i]}`}
                      >Keep this, merge others</Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CustomFieldDef {
  id: string;
  organizationId: string;
  entityType: "CONTACT" | "ORGANISATION" | "OPPORTUNITY";
  key: string;
  label: string;
  fieldType: "TEXT" | "LONG_TEXT" | "NUMBER" | "CURRENCY" | "DATE" | "DROPDOWN" | "MULTI_SELECT" | "CHECKBOX" | "URL" | "EMAIL" | "PHONE";
  options: string[] | null;
  isRequired: boolean;
  defaultValue: unknown;
  helpText: string | null;
  sortOrder: number;
  isActive: boolean;
}

const FIELD_TYPE_OPTIONS: { value: CustomFieldDef["fieldType"]; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "LONG_TEXT", label: "Long text" },
  { value: "NUMBER", label: "Number" },
  { value: "CURRENCY", label: "Currency" },
  { value: "DATE", label: "Date" },
  { value: "DROPDOWN", label: "Dropdown" },
  { value: "MULTI_SELECT", label: "Multi-select" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "URL", label: "URL" },
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Phone" },
];

function CustomFieldsCard() {
  const [tab, setTab] = useState<"CONTACT" | "ORGANISATION" | "OPPORTUNITY">("ORGANISATION");
  return (
    <Card data-testid="card-custom-fields">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListPlus className="w-5 h-5" /> Custom Fields</CardTitle>
        <CardDescription>Define custom fields that appear on contact, organization, and opportunity forms.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={v => {
          if (v === "CONTACT" || v === "ORGANISATION" || v === "OPPORTUNITY") setTab(v);
        }}>
          <TabsList className="grid grid-cols-3 w-full sm:w-auto">
            <TabsTrigger value="ORGANISATION" data-testid="tab-cf-org">Organizations</TabsTrigger>
            <TabsTrigger value="CONTACT" data-testid="tab-cf-contact">Contacts</TabsTrigger>
            <TabsTrigger value="OPPORTUNITY" data-testid="tab-cf-opp">Opportunities</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            <CustomFieldsList entityType={tab} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CustomFieldsList({ entityType }: { entityType: "CONTACT" | "ORGANISATION" | "OPPORTUNITY" }) {
  const { toast } = useToast();
  const queryKey = ["/api/crm/custom-field-definitions", { entityType }];
  const { data: defs, isLoading } = useQuery<CustomFieldDef[]>({ queryKey });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const del = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/custom-field-definitions/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Field archived" }); },
    onError: (e: any) => toast({ title: "Failed to archive", description: e?.message, variant: "destructive" }),
  });

  const reorder = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) =>
      apiRequest("POST", `/api/crm/custom-field-definitions/reorder`, { items }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast({ title: "Failed to reorder", description: e?.message, variant: "destructive" }),
  });

  const move = (idx: number, dir: -1 | 1) => {
    if (!defs) return;
    const sorted = [...defs].sort((a, b) => a.sortOrder - b.sortOrder);
    const next = [...sorted];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate(next.map((d, i) => ({ id: d.id, sortOrder: i })));
  };

  const list = (defs ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-3" data-testid={`cf-list-${entityType}`}>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid={`button-add-cf-${entityType}`}>
          <Plus className="w-4 h-4 mr-1" /> Add Field
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-20 w-full" /> : list.length === 0 ? (
        <EmptyState icon={ListPlus} title="No custom fields" description="Add a field to start collecting custom data." />
      ) : (
        <div className="space-y-2">
          {list.map((d, idx) => (
            <div key={d.id} className="flex items-center gap-2 p-3 border rounded-md" data-testid={`row-cf-${d.id}`}>
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => move(idx, -1)} disabled={idx === 0} data-testid={`button-up-${d.id}`}>
                  <ArrowUp className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => move(idx, 1)} disabled={idx === list.length - 1} data-testid={`button-down-${d.id}`}>
                  <ArrowDown className="w-3 h-3" />
                </Button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium" data-testid={`text-cf-label-${d.id}`}>{d.label}</span>
                  <Badge variant="outline" className="text-xs">{d.fieldType}</Badge>
                  {d.isRequired && <Badge variant="secondary" className="text-xs">Required</Badge>}
                  {!d.isActive && <Badge variant="destructive" className="text-xs">Archived</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">key: <span className="font-mono">{d.key}</span>{d.helpText ? ` • ${d.helpText}` : ""}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => { setEditing(d); setDialogOpen(true); }} data-testid={`button-edit-cf-${d.id}`}>
                <Pencil className="w-4 h-4" />
              </Button>
              {d.isActive && (
                <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Archive field "${d.label}"? Existing values are preserved.`)) del.mutate(d.id); }} data-testid={`button-delete-cf-${d.id}`}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <CustomFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityType={entityType}
        editing={editing}
        onSaved={() => { setDialogOpen(false); invalidate(); }}
      />
    </div>
  );
}

function CustomFieldDialog({ open, onOpenChange, entityType, editing, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entityType: "CONTACT" | "ORGANISATION" | "OPPORTUNITY";
  editing: CustomFieldDef | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldDef["fieldType"]>("TEXT");
  const [optionsText, setOptionsText] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [defaultValueText, setDefaultValueText] = useState("");
  const [defaultValueBool, setDefaultValueBool] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel(editing?.label ?? "");
      setKey(editing?.key ?? "");
      setFieldType(editing?.fieldType ?? "TEXT");
      setOptionsText((editing?.options ?? []).join("\n"));
      setIsRequired(editing?.isRequired ?? false);
      setHelpText(editing?.helpText ?? "");
      setIsActive(editing?.isActive ?? true);
      const dv = editing?.defaultValue;
      if (typeof dv === "boolean") { setDefaultValueBool(dv); setDefaultValueText(""); }
      else if (Array.isArray(dv)) { setDefaultValueText(dv.join(", ")); setDefaultValueBool(false); }
      else if (dv === null || dv === undefined) { setDefaultValueText(""); setDefaultValueBool(false); }
      else { setDefaultValueText(String(dv)); setDefaultValueBool(false); }
    }
  }, [open, editing]);

  const slugifyKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

  const computeDefaultValue = (): unknown => {
    const t = defaultValueText.trim();
    switch (fieldType) {
      case "CHECKBOX": return defaultValueBool;
      case "NUMBER":
      case "CURRENCY": {
        if (t === "") return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      }
      case "MULTI_SELECT":
        return t ? t.split(",").map(s => s.trim()).filter(Boolean) : null;
      default:
        return t === "" ? null : t;
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const needsOptions = fieldType === "DROPDOWN" || fieldType === "MULTI_SELECT";
      const opts = needsOptions ? optionsText.split("\n").map(s => s.trim()).filter(Boolean) : null;
      const body: Record<string, unknown> = {
        entityType, label, key: key || slugifyKey(label),
        fieldType, options: opts, isRequired, helpText: helpText || null, isActive,
        defaultValue: computeDefaultValue(),
      };
      if (editing) return apiRequest("PATCH", `/api/crm/custom-field-definitions/${editing.id}`, body);
      return apiRequest("POST", `/api/crm/custom-field-definitions`, body);
    },
    onSuccess: () => { toast({ title: editing ? "Field updated" : "Field added" }); onSaved(); },
    onError: (e: any) => toast({ title: "Failed to save", description: e?.message, variant: "destructive" }),
  });

  const needsOptions = fieldType === "DROPDOWN" || fieldType === "MULTI_SELECT";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-custom-field">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Label *</Label>
            <Input value={label} onChange={e => { setLabel(e.target.value); if (!editing && !key) setKey(slugifyKey(e.target.value)); }} data-testid="input-cf-label" />
          </div>
          <div>
            <Label>Key * <span className="text-xs text-muted-foreground">(unique, lowercase)</span></Label>
            <Input value={key} onChange={e => setKey(slugifyKey(e.target.value))} disabled={!!editing} data-testid="input-cf-key" />
          </div>
          <div>
            <Label>Type *</Label>
            <Select value={fieldType} onValueChange={v => {
              if (FIELD_TYPE_OPTIONS.some(o => o.value === v)) setFieldType(v as CustomFieldDef["fieldType"]);
            }} disabled={!!editing}>
              <SelectTrigger data-testid="select-cf-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {needsOptions && (
            <div>
              <Label>Options (one per line) *</Label>
              <Textarea value={optionsText} onChange={e => setOptionsText(e.target.value)} rows={4} data-testid="textarea-cf-options" />
            </div>
          )}
          <div>
            <Label>Help text</Label>
            <Input value={helpText} onChange={e => setHelpText(e.target.value)} data-testid="input-cf-help" />
          </div>
          <div>
            <Label>Default value <span className="text-xs text-muted-foreground">(optional)</span></Label>
            {fieldType === "CHECKBOX" ? (
              <div className="flex items-center gap-2 pt-2">
                <Switch checked={defaultValueBool} onCheckedChange={setDefaultValueBool} data-testid="switch-cf-default-bool" />
                <span className="text-sm text-muted-foreground">{defaultValueBool ? "Checked" : "Unchecked"}</span>
              </div>
            ) : fieldType === "MULTI_SELECT" ? (
              <Input
                value={defaultValueText}
                onChange={e => setDefaultValueText(e.target.value)}
                placeholder="Comma-separated values"
                data-testid="input-cf-default"
              />
            ) : (
              <Input
                value={defaultValueText}
                onChange={e => setDefaultValueText(e.target.value)}
                type={fieldType === "NUMBER" || fieldType === "CURRENCY" ? "number" : fieldType === "DATE" ? "date" : "text"}
                data-testid="input-cf-default"
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={isRequired} onCheckedChange={setIsRequired} data-testid="switch-cf-required" />
            <Label>Required</Label>
          </div>
          {editing && (
            <div className="flex items-center gap-3">
              <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-cf-active" />
              <Label>Active</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!label.trim() || (!editing && !slugifyKey(key || label)) || (needsOptions && optionsText.trim().split("\n").filter(s => s.trim()).length === 0) || save.isPending}
            data-testid="button-save-cf"
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailLoggingCard() {
  const { toast } = useToast();
  const settingsQuery = useQuery<{ mode: "OFF" | "MY_DOMAIN" | "ALL" }>({
    queryKey: ["/api/crm/email-logging/settings"],
  });
  const suppressionsQuery = useQuery<Array<{ id: string; pattern: string }>>({
    queryKey: ["/api/crm/email-logging/suppressions"],
  });
  type EmailLoggingMode = "OFF" | "MY_DOMAIN" | "ALL";
  const [mode, setMode] = useState<EmailLoggingMode>("OFF");
  const [pattern, setPattern] = useState("");

  useEffect(() => {
    if (settingsQuery.data?.mode) setMode(settingsQuery.data.mode);
  }, [settingsQuery.data?.mode]);

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Failed");

  const saveSettings = useMutation({
    mutationFn: async (newMode: EmailLoggingMode) => apiRequest("PUT", "/api/crm/email-logging/settings", { mode: newMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/email-logging/settings"] });
      toast({ title: "Saved", description: "Email logging mode updated." });
    },
    onError: (e) => toast({ title: "Error", description: errMsg(e), variant: "destructive" }),
  });

  const addSuppression = useMutation({
    mutationFn: async (pat: string) => apiRequest("POST", "/api/crm/email-logging/suppressions", { pattern: pat }),
    onSuccess: () => {
      setPattern("");
      queryClient.invalidateQueries({ queryKey: ["/api/crm/email-logging/suppressions"] });
    },
    onError: (e) => toast({ title: "Error", description: errMsg(e), variant: "destructive" }),
  });

  const deleteSuppression = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/email-logging/suppressions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/email-logging/suppressions"] }),
  });

  const runBackfill = useMutation<{ accounts: number; scanned: number; logged: number }>({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/crm/email-logging/backfill", { days: 90 });
      return r.json();
    },
    onSuccess: (data) => toast({ title: "Backfill complete", description: `${data?.logged ?? 0} messages logged across ${data?.accounts ?? 0} accounts.` }),
    onError: (e) => toast({ title: "Error", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Settings className="w-4 h-4" /> CRM Email Logging</CardTitle>
        <CardDescription>Auto-log Gmail / Outlook messages onto matching CRM contacts &amp; opportunities.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as EmailLoggingMode)}>
              <SelectTrigger data-testid="select-email-logging-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OFF">Off — never log emails</SelectItem>
                <SelectItem value="MY_DOMAIN">My domain — only when one party is on our email domain</SelectItem>
                <SelectItem value="ALL">All — log every matching message</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => saveSettings.mutate(mode)} disabled={saveSettings.isPending} data-testid="button-save-email-logging">
            Save
          </Button>
        </div>

        <div>
          <Label>Suppression list</Label>
          <p className="text-xs text-muted-foreground mb-2">Patterns to skip. Use a full address (a@b.com) or a domain (@example.com).</p>
          <div className="flex gap-2">
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="@example.com or noreply@vendor.com"
              data-testid="input-suppression-pattern"
            />
            <Button onClick={() => addSuppression.mutate(pattern)} disabled={!pattern || addSuppression.isPending} data-testid="button-add-suppression">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(suppressionsQuery.data || []).map((s) => (
              <Badge key={s.id} variant="secondary" className="gap-1" data-testid={`badge-suppression-${s.id}`}>
                {s.pattern}
                <button onClick={() => deleteSuppression.mutate(s.id)} className="hover:text-destructive" data-testid={`button-remove-suppression-${s.id}`}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t">
          <Button variant="outline" onClick={() => runBackfill.mutate()} disabled={runBackfill.isPending} data-testid="button-run-backfill">
            Run 90-day backfill
          </Button>
          <p className="text-xs text-muted-foreground mt-1">Re-scan recent mailbox history and log any matching messages onto CRM contacts.</p>
        </div>
      </CardContent>
    </Card>
  );
}
