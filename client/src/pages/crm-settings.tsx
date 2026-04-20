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
import { Globe, Copy, Check, Plus, Trash2, Settings, Package, Target, Users } from "lucide-react";
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

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList className="grid grid-cols-3 w-full sm:w-auto">
          <TabsTrigger value="catalog" data-testid="tab-settings-catalog"><Package className="w-4 h-4 mr-1" /> Catalog</TabsTrigger>
          <TabsTrigger value="scoring" data-testid="tab-settings-scoring"><Target className="w-4 h-4 mr-1" /> Lead Scoring</TabsTrigger>
          <TabsTrigger value="duplicates" data-testid="tab-settings-duplicates"><Users className="w-4 h-4 mr-1" /> Duplicates</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-4"><CatalogManagerCard /></TabsContent>
        <TabsContent value="scoring" className="mt-4"><LeadScoringRulesCard /></TabsContent>
        <TabsContent value="duplicates" className="mt-4"><DuplicatesCard /></TabsContent>
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
