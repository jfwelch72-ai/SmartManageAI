import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, Users, Archive, Building2, Database, GitBranch, Plus, Pencil, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { SupportUserLookup } from "@/components/platform/SupportUserLookup";
import { SupportAuditPanel } from "@/components/platform/SupportAuditPanel";
import { SupportOrgTools } from "@/components/platform/SupportOrgTools";
import { SupportSystemChecks } from "@/components/platform/SupportSystemChecks";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GlobalWorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  entityType: string;
  isPublished: boolean;
  templateData: any;
  createdAt: string;
  updatedAt: string;
}

const ENTITY_TYPES = [
  { value: "CHANGE_ORDER", label: "Change Order" },
  { value: "SOV_PAY_APP", label: "SOV Pay App" },
  { value: "TIME_APPROVAL", label: "Time Approval" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "PURCHASE_REQUEST", label: "Purchase Request" },
  { value: "VENDOR_BILL", label: "Vendor Bill" },
  { value: "TM_TICKET", label: "T&M Ticket" },
];

function WorkflowTemplatesSection() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    entityType: "CHANGE_ORDER",
    isPublished: false,
    templateData: '{\n  "stages": [\n    { "name": "Draft", "stageOrder": 0, "isInitial": true },\n    { "name": "Review", "stageOrder": 1 },\n    { "name": "Approved", "stageOrder": 2, "isFinal": true }\n  ]\n}',
  });

  const { data: templates, isLoading } = useQuery<GlobalWorkflowTemplate[]>({
    queryKey: ["/api/platform/workflow-templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/platform/workflow-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
      setDialogOpen(false);
      toast({ title: "Template created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/platform/workflow-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
      setDialogOpen(false);
      toast({ title: "Template updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/platform/workflow-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const togglePublishMutation = useMutation({
    mutationFn: async ({ id, isPublished }: { id: string; isPublished: boolean }) => {
      const res = await apiRequest("PATCH", `/api/platform/workflow-templates/${id}`, { isPublished });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
    },
  });

  const resetForm = () => {
    setForm({
      name: "",
      description: "",
      entityType: "CHANGE_ORDER",
      isPublished: false,
      templateData: '{\n  "stages": [\n    { "name": "Draft", "stageOrder": 0, "isInitial": true },\n    { "name": "Review", "stageOrder": 1 },\n    { "name": "Approved", "stageOrder": 2, "isFinal": true }\n  ]\n}',
    });
    setEditingId(null);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = (t: GlobalWorkflowTemplate) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      description: t.description || "",
      entityType: t.entityType,
      isPublished: t.isPublished,
      templateData: JSON.stringify(t.templateData, null, 2),
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    let parsedData;
    try {
      parsedData = JSON.parse(form.templateData);
    } catch {
      toast({ title: "Invalid JSON", description: "Template data must be valid JSON", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name,
      description: form.description || null,
      entityType: form.entityType,
      isPublished: form.isPublished,
      templateData: parsedData,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Global Workflow Templates
              </CardTitle>
              <CardDescription>Manage workflow templates that organizations can import</CardDescription>
            </div>
            <Button onClick={openCreate} data-testid="button-create-workflow-template">
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !templates?.length ? (
            <p className="text-muted-foreground text-center py-8">No global workflow templates yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map(t => (
                  <TableRow key={t.id} data-testid={`row-workflow-template-${t.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{t.name}</p>
                        {t.description && <p className="text-sm text-muted-foreground line-clamp-1">{t.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ENTITY_TYPES.find(e => e.value === t.entityType)?.label || t.entityType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={t.isPublished}
                        onCheckedChange={(checked) => togglePublishMutation.mutate({ id: t.id, isPublished: checked })}
                        data-testid={`switch-template-published-${t.id}`}
                      />
                    </TableCell>
                    <TableCell>{format(new Date(t.updatedAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(t)} data-testid={`button-edit-template-${t.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-delete-template-${t.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Global Workflow Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Template name"
                data-testid="input-template-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                data-testid="input-template-description"
              />
            </div>
            <div>
              <Label>Entity Type</Label>
              <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v }))}>
                <SelectTrigger data-testid="select-template-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.isPublished}
                onCheckedChange={checked => setForm(f => ({ ...f, isPublished: checked }))}
                data-testid="switch-template-form-published"
              />
              <Label>Published (visible to organizations)</Label>
            </div>
            <div>
              <Label>Template Data (JSON)</Label>
              <Textarea
                value={form.templateData}
                onChange={e => setForm(f => ({ ...f, templateData: e.target.value }))}
                rows={10}
                className="font-mono text-sm"
                data-testid="input-template-data"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-template"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PlatformSupportTools() {
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="min-h-screen bg-background">
      <main className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-support-title">Support Tools</h1>
            <p className="text-muted-foreground">Backend support tools for resolving user issues</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="w-full max-w-xs">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger data-testid="select-support-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="users" data-testid="tab-users">
                <span className="flex items-center gap-2"><Users className="h-4 w-4" /> All Users</span>
              </SelectItem>
              <SelectItem value="archived" data-testid="tab-archived">
                <span className="flex items-center gap-2"><Archive className="h-4 w-4" /> Archived Users</span>
              </SelectItem>
              <SelectItem value="sow" data-testid="tab-sow">
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> SOW Items</span>
              </SelectItem>
              <SelectItem value="worktypes" data-testid="tab-worktypes">
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Work Types</span>
              </SelectItem>
              <SelectItem value="workflows" data-testid="tab-workflows">
                <span className="flex items-center gap-2"><GitBranch className="h-4 w-4" /> Workflow Templates</span>
              </SelectItem>
              <SelectItem value="datatools" data-testid="tab-datatools">
                <span className="flex items-center gap-2"><Database className="h-4 w-4" /> Data Tools</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="users" className="space-y-4">
          <SupportUserLookup />
        </TabsContent>

        <TabsContent value="archived" className="space-y-4">
          <SupportAuditPanel />
        </TabsContent>

        <TabsContent value="sow" className="space-y-4">
          <SupportOrgTools tab="sow" />
        </TabsContent>

        <TabsContent value="worktypes" className="space-y-4">
          <SupportOrgTools tab="worktypes" />
        </TabsContent>

        <TabsContent value="workflows" className="space-y-4">
          <WorkflowTemplatesSection />
        </TabsContent>

        <TabsContent value="datatools" className="space-y-4">
          <SupportSystemChecks />
        </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
