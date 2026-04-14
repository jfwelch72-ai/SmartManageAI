import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { BookOpen, Plus, FileText, Trash2, Edit, LayoutTemplate, Eye, CheckSquare } from "lucide-react";

interface Clause {
  id: string;
  title: string;
  category: string;
  content: string;
  isRequired: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  contractType: string;
  clauseIdsJson: string;
  defaultPaymentTerms: string | null;
  defaultRetentionPercent: string | null;
  defaultInsuranceRequirements: string | null;
  isActive: boolean;
  createdAt: string;
}

const CLAUSE_CATEGORIES = [
  "PAYMENT", "INSURANCE", "INDEMNIFICATION", "SCOPE", "TERMINATION",
  "DISPUTE_RESOLUTION", "WARRANTY", "SAFETY", "COMPLIANCE", "RETENTION",
  "LIQUIDATED_DAMAGES", "FORCE_MAJEURE", "CHANGE_ORDER", "CONFIDENTIALITY", "OTHER"
];

const CATEGORY_LABELS: Record<string, string> = {
  PAYMENT: "Payment",
  INSURANCE: "Insurance",
  INDEMNIFICATION: "Indemnification",
  SCOPE: "Scope of Work",
  TERMINATION: "Termination",
  DISPUTE_RESOLUTION: "Dispute Resolution",
  WARRANTY: "Warranty",
  SAFETY: "Safety",
  COMPLIANCE: "Compliance",
  RETENTION: "Retention",
  LIQUIDATED_DAMAGES: "Liquidated Damages",
  FORCE_MAJEURE: "Force Majeure",
  CHANGE_ORDER: "Change Orders",
  CONFIDENTIALITY: "Confidentiality",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  PAYMENT: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  INSURANCE: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  INDEMNIFICATION: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  SCOPE: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  TERMINATION: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  DISPUTE_RESOLUTION: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  WARRANTY: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  SAFETY: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  COMPLIANCE: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  RETENTION: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  LIQUIDATED_DAMAGES: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
  FORCE_MAJEURE: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  CHANGE_ORDER: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  CONFIDENTIALITY: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  OTHER: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const TYPE_LABELS: Record<string, string> = {
  PRIME: "Prime Contract",
  SUBCONTRACT: "Subcontract",
  JV: "Joint Venture",
  T_AND_M: "Time & Materials",
};

export default function ClauseLibraryPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("clauses");
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [showClauseDialog, setShowClauseDialog] = useState(false);
  const [editingClause, setEditingClause] = useState<Clause | null>(null);
  const [clauseForm, setClauseForm] = useState({ title: "", category: "PAYMENT", content: "", isRequired: false, isDefault: false, sortOrder: 0 });

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "", contractType: "PRIME", clauseIds: [] as string[], defaultPaymentTerms: "", defaultRetentionPercent: "", defaultInsuranceRequirements: "" });
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [previewClauses, setPreviewClauses] = useState<Clause[]>([]);

  const { data: clauses = [], isLoading: clausesLoading } = useQuery<Clause[]>({
    queryKey: ["/api/clause-library/clauses"],
  });

  const { data: templatesList = [], isLoading: templatesLoading } = useQuery<Template[]>({
    queryKey: ["/api/clause-library/templates"],
  });

  const createClauseMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/clause-library/clauses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clause-library/clauses"] });
      setShowClauseDialog(false);
      resetClauseForm();
      toast({ title: "Clause created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to create clause", variant: "destructive" }),
  });

  const updateClauseMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/clause-library/clauses/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clause-library/clauses"] });
      setShowClauseDialog(false);
      setEditingClause(null);
      resetClauseForm();
      toast({ title: "Clause updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to update clause", variant: "destructive" }),
  });

  const deleteClauseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/clause-library/clauses/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clause-library/clauses"] });
      toast({ title: "Clause deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to delete clause", variant: "destructive" }),
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/clause-library/templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clause-library/templates"] });
      setShowTemplateDialog(false);
      resetTemplateForm();
      toast({ title: "Template created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to create template", variant: "destructive" }),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/clause-library/templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clause-library/templates"] });
      setShowTemplateDialog(false);
      setEditingTemplate(null);
      resetTemplateForm();
      toast({ title: "Template updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to update template", variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/clause-library/templates/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clause-library/templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to delete template", variant: "destructive" }),
  });

  const resetClauseForm = () => {
    setClauseForm({ title: "", category: "PAYMENT", content: "", isRequired: false, isDefault: false, sortOrder: 0 });
  };

  const resetTemplateForm = () => {
    setTemplateForm({ name: "", description: "", contractType: "PRIME", clauseIds: [], defaultPaymentTerms: "", defaultRetentionPercent: "", defaultInsuranceRequirements: "" });
  };

  const openEditClause = (clause: Clause) => {
    setEditingClause(clause);
    setClauseForm({
      title: clause.title,
      category: clause.category,
      content: clause.content,
      isRequired: clause.isRequired,
      isDefault: clause.isDefault,
      sortOrder: clause.sortOrder,
    });
    setShowClauseDialog(true);
  };

  const openEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      description: template.description || "",
      contractType: template.contractType,
      clauseIds: JSON.parse(template.clauseIdsJson || "[]"),
      defaultPaymentTerms: template.defaultPaymentTerms || "",
      defaultRetentionPercent: template.defaultRetentionPercent || "",
      defaultInsuranceRequirements: template.defaultInsuranceRequirements || "",
    });
    setShowTemplateDialog(true);
  };

  const openTemplatePreview = async (template: Template) => {
    const clauseIds: string[] = JSON.parse(template.clauseIdsJson || "[]");
    const matched = clauses.filter(c => clauseIds.includes(c.id));
    setPreviewClauses(matched);
    setPreviewTemplate(template);
    setShowTemplatePreview(true);
  };

  const filteredClauses = filterCategory === "ALL" ? clauses : clauses.filter(c => c.category === filterCategory);

  const handleSubmitClause = () => {
    if (!clauseForm.title || !clauseForm.content) {
      toast({ title: "Error", description: "Title and content are required", variant: "destructive" });
      return;
    }
    if (editingClause) {
      updateClauseMutation.mutate({ id: editingClause.id, data: clauseForm });
    } else {
      createClauseMutation.mutate(clauseForm);
    }
  };

  const handleSubmitTemplate = () => {
    if (!templateForm.name) {
      toast({ title: "Error", description: "Template name is required", variant: "destructive" });
      return;
    }
    const data = {
      ...templateForm,
      defaultRetentionPercent: templateForm.defaultRetentionPercent || null,
      defaultPaymentTerms: templateForm.defaultPaymentTerms || null,
      defaultInsuranceRequirements: templateForm.defaultInsuranceRequirements || null,
    };
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data });
    } else {
      createTemplateMutation.mutate(data);
    }
  };

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <BookOpen className="h-6 w-6" />
            Clause Library & Templates
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage reusable contract clauses and build templates</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="clauses" data-testid="tab-clauses">
            <FileText className="h-4 w-4 mr-1" /> Clauses ({clauses.length})
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">
            <LayoutTemplate className="h-4 w-4 mr-1" /> Templates ({templatesList.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clauses">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[200px]" data-testid="select-clause-category-filter">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {CLAUSE_CATEGORIES.map(cat => (
                  <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => { resetClauseForm(); setEditingClause(null); setShowClauseDialog(true); }} data-testid="button-create-clause">
              <Plus className="h-4 w-4 mr-2" /> New Clause
            </Button>
          </div>

          {clausesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading clauses...</div>
          ) : filteredClauses.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground" data-testid="text-no-clauses">
                  {filterCategory === "ALL" ? "No clauses yet. Create your first clause to build your library." : `No clauses in ${CATEGORY_LABELS[filterCategory]}.`}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredClauses.map(clause => (
                <Card key={clause.id} data-testid={`card-clause-${clause.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">{clause.title}</span>
                          <Badge className={CATEGORY_COLORS[clause.category] || ""} data-testid={`badge-clause-category-${clause.id}`}>
                            {CATEGORY_LABELS[clause.category]}
                          </Badge>
                          {clause.isRequired && <Badge variant="destructive" className="text-xs">Required</Badge>}
                          {clause.isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{clause.content}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => openEditClause(clause)} data-testid={`button-edit-clause-${clause.id}`}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteClauseMutation.mutate(clause.id)} data-testid={`button-delete-clause-${clause.id}`}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates">
          <div className="flex items-center justify-end mb-4">
            <Button onClick={() => { resetTemplateForm(); setEditingTemplate(null); setShowTemplateDialog(true); }} data-testid="button-create-template">
              <Plus className="h-4 w-4 mr-2" /> New Template
            </Button>
          </div>

          {templatesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading templates...</div>
          ) : templatesList.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <LayoutTemplate className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground" data-testid="text-no-templates">No templates yet. Create a template to speed up contract creation.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templatesList.map(template => {
                const clauseIds: string[] = JSON.parse(template.clauseIdsJson || "[]");
                return (
                  <Card key={template.id} data-testid={`card-template-${template.id}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>{template.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{TYPE_LABELS[template.contractType] || template.contractType}</Badge>
                          {!template.isActive && <Badge variant="secondary">Inactive</Badge>}
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {template.description && <p className="text-sm text-muted-foreground">{template.description}</p>}
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>{clauseIds.length} clause(s) included</p>
                        {template.defaultPaymentTerms && <p>Payment: {template.defaultPaymentTerms}</p>}
                        {template.defaultRetentionPercent && <p>Retention: {template.defaultRetentionPercent}%</p>}
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" variant="ghost" onClick={() => openTemplatePreview(template)} data-testid={`button-preview-template-${template.id}`}>
                          <Eye className="h-3 w-3 mr-1" /> Preview
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEditTemplate(template)} data-testid={`button-edit-template-${template.id}`}>
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteTemplateMutation.mutate(template.id)} data-testid={`button-delete-template-${template.id}`}>
                          <Trash2 className="h-3 w-3 mr-1 text-destructive" /> Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showClauseDialog} onOpenChange={setShowClauseDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-clause-form">
          <DialogHeader>
            <DialogTitle>{editingClause ? "Edit Clause" : "Create Clause"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Title *</Label>
                <Input
                  value={clauseForm.title}
                  onChange={(e) => setClauseForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., Standard Payment Terms"
                  data-testid="input-clause-title"
                />
              </div>
              <div>
                <Label>Category *</Label>
                <Select value={clauseForm.category} onValueChange={(v) => setClauseForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="select-clause-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUSE_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Content *</Label>
              <Textarea
                value={clauseForm.content}
                onChange={(e) => setClauseForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Enter the full clause text..."
                className="min-h-[200px]"
                data-testid="input-clause-content"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isRequired"
                  checked={clauseForm.isRequired}
                  onCheckedChange={(checked) => setClauseForm(f => ({ ...f, isRequired: !!checked }))}
                  data-testid="checkbox-clause-required"
                />
                <Label htmlFor="isRequired" className="text-sm">Required clause</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isDefault"
                  checked={clauseForm.isDefault}
                  onCheckedChange={(checked) => setClauseForm(f => ({ ...f, isDefault: !!checked }))}
                  data-testid="checkbox-clause-default"
                />
                <Label htmlFor="isDefault" className="text-sm">Include by default</Label>
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={clauseForm.sortOrder}
                  onChange={(e) => setClauseForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                  data-testid="input-clause-sort-order"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowClauseDialog(false); setEditingClause(null); }}>Cancel</Button>
            <Button onClick={handleSubmitClause} disabled={createClauseMutation.isPending || updateClauseMutation.isPending} data-testid="button-submit-clause">
              {(createClauseMutation.isPending || updateClauseMutation.isPending) ? "Saving..." : editingClause ? "Save Changes" : "Create Clause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-template-form">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Template Name *</Label>
                <Input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Standard Subcontract"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <Label>Contract Type</Label>
                <Select value={templateForm.contractType} onValueChange={(v) => setTemplateForm(f => ({ ...f, contractType: v }))}>
                  <SelectTrigger data-testid="select-template-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIME">Prime Contract</SelectItem>
                    <SelectItem value="SUBCONTRACT">Subcontract</SelectItem>
                    <SelectItem value="JV">Joint Venture</SelectItem>
                    <SelectItem value="T_AND_M">Time & Materials</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={templateForm.description}
                onChange={(e) => setTemplateForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of this template"
                data-testid="input-template-description"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Default Payment Terms</Label>
                <Input
                  value={templateForm.defaultPaymentTerms}
                  onChange={(e) => setTemplateForm(f => ({ ...f, defaultPaymentTerms: e.target.value }))}
                  placeholder="e.g., Net 30"
                  data-testid="input-template-payment-terms"
                />
              </div>
              <div>
                <Label>Default Retention %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={templateForm.defaultRetentionPercent}
                  onChange={(e) => setTemplateForm(f => ({ ...f, defaultRetentionPercent: e.target.value }))}
                  placeholder="e.g., 10"
                  data-testid="input-template-retention"
                />
              </div>
            </div>
            <div>
              <Label>Default Insurance Requirements</Label>
              <Textarea
                value={templateForm.defaultInsuranceRequirements}
                onChange={(e) => setTemplateForm(f => ({ ...f, defaultInsuranceRequirements: e.target.value }))}
                placeholder="Default insurance requirements for this template..."
                data-testid="input-template-insurance"
              />
            </div>
            <div>
              <Label className="mb-2 block">Select Clauses</Label>
              {clauses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clauses available. Create clauses first to include them in templates.</p>
              ) : (
                <div className="border rounded-lg max-h-[300px] overflow-y-auto p-2 space-y-1">
                  {CLAUSE_CATEGORIES.map(cat => {
                    const catClauses = clauses.filter(c => c.category === cat);
                    if (catClauses.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="text-xs font-semibold text-muted-foreground px-2 py-1">{CATEGORY_LABELS[cat]}</p>
                        {catClauses.map(clause => (
                          <label key={clause.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-sm">
                            <Checkbox
                              checked={templateForm.clauseIds.includes(clause.id)}
                              onCheckedChange={(checked) => {
                                setTemplateForm(f => ({
                                  ...f,
                                  clauseIds: checked ? [...f.clauseIds, clause.id] : f.clauseIds.filter(id => id !== clause.id),
                                }));
                              }}
                              data-testid={`checkbox-template-clause-${clause.id}`}
                            />
                            <span>{clause.title}</span>
                            {clause.isRequired && <Badge variant="destructive" className="text-xs">Required</Badge>}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{templateForm.clauseIds.length} clause(s) selected</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowTemplateDialog(false); setEditingTemplate(null); }}>Cancel</Button>
            <Button onClick={handleSubmitTemplate} disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending} data-testid="button-submit-template">
              {(createTemplateMutation.isPending || updateTemplateMutation.isPending) ? "Saving..." : editingTemplate ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTemplatePreview} onOpenChange={setShowTemplatePreview}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-template-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Template Preview: {previewTemplate?.name}
            </DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Contract Type</span>
                  <p className="font-medium">{TYPE_LABELS[previewTemplate.contractType]}</p>
                </div>
                {previewTemplate.defaultPaymentTerms && (
                  <div>
                    <span className="text-muted-foreground">Payment Terms</span>
                    <p className="font-medium">{previewTemplate.defaultPaymentTerms}</p>
                  </div>
                )}
                {previewTemplate.defaultRetentionPercent && (
                  <div>
                    <span className="text-muted-foreground">Retention</span>
                    <p className="font-medium">{previewTemplate.defaultRetentionPercent}%</p>
                  </div>
                )}
              </div>
              {previewTemplate.defaultInsuranceRequirements && (
                <div>
                  <span className="text-sm text-muted-foreground">Insurance Requirements</span>
                  <p className="text-sm">{previewTemplate.defaultInsuranceRequirements}</p>
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold mb-2">Included Clauses ({previewClauses.length})</h3>
                <div className="space-y-3">
                  {previewClauses.map(clause => (
                    <div key={clause.id} className="p-3 rounded-lg border">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{clause.title}</span>
                        <Badge className={CATEGORY_COLORS[clause.category] || ""} data-testid={`preview-clause-badge-${clause.id}`}>
                          {CATEGORY_LABELS[clause.category]}
                        </Badge>
                        {clause.isRequired && <Badge variant="destructive" className="text-xs">Required</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{clause.content}</p>
                    </div>
                  ))}
                  {previewClauses.length === 0 && (
                    <p className="text-sm text-muted-foreground">No clauses included in this template.</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplatePreview(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
