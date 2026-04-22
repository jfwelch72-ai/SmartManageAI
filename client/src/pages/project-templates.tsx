import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { FeaturePermissions } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers, Sparkles, Trash2, Search, FileText, Calendar, Pencil, History } from "lucide-react";
import type { ProjectTemplate } from "@shared/schema";

interface TemplatesResponse {
  templates: ProjectTemplate[];
}

interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  notes: string | null;
  createdAt: string;
}

interface TemplateDetailResponse {
  template: ProjectTemplate;
  versions: TemplateVersion[];
}

const instantiateSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  clientName: z.string().min(1, "Client name is required").max(200),
  projectStartDate: z.string().min(1, "Start date is required"),
  description: z.string().max(2000).optional(),
  locationAddress: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  contractAmount: z.string().max(40).optional(),
  budget: z.string().max(40).optional(),
});
type InstantiateInput = z.infer<typeof instantiateSchema>;

export default function ProjectTemplatesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, permissionRole } = useAuth();
  void user;
  const canManage = FeaturePermissions.MANAGE_PROJECT_TEMPLATES(permissionRole);
  const canCreate = FeaturePermissions.CREATE_PROJECT(permissionRole);

  const [search, setSearch] = useState("");
  const [useDialogOpen, setUseDialogOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<ProjectTemplate | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | "latest">("latest");
  const [deleteTarget, setDeleteTarget] = useState<ProjectTemplate | null>(null);
  const [editTarget, setEditTarget] = useState<ProjectTemplate | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const detailQuery = useQuery<TemplateDetailResponse>({
    queryKey: ["/api/project-templates", activeTemplate?.id],
    enabled: !!activeTemplate,
  });

  const { data, isLoading } = useQuery<TemplatesResponse>({
    queryKey: ["/api/project-templates"],
  });

  const filtered = useMemo(() => {
    const list = data?.templates ?? [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.category ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [data?.templates, search]);

  const form = useForm<InstantiateInput>({
    resolver: zodResolver(instantiateSchema),
    defaultValues: {
      name: "",
      clientName: "",
      projectStartDate: new Date().toISOString().slice(0, 10),
      description: "",
      locationAddress: "",
      city: "",
      state: "",
      contractAmount: "",
      budget: "",
    },
  });

  const instantiateMutation = useMutation({
    mutationFn: async (vars: { templateId: string; versionId?: string; input: InstantiateInput }) => {
      const res = await apiRequest("POST", "/api/project-templates/instantiate", {
        templateId: vars.templateId,
        versionId: vars.versionId,
        projectStartDate: vars.input.projectStartDate,
        project: {
          name: vars.input.name,
          clientName: vars.input.clientName,
          description: vars.input.description || null,
          locationAddress: vars.input.locationAddress || null,
          city: vars.input.city || null,
          state: vars.input.state || null,
          contractAmount: vars.input.contractAmount || null,
          budget: vars.input.budget || null,
        },
      });
      return res.json() as Promise<{ projectId: string; projectCode: string; taskCount: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Project created",
        description: `Created project ${result.projectCode} with ${result.taskCount} task(s).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/project-templates"] });
      setUseDialogOpen(false);
      setActiveTemplate(null);
      form.reset();
      setLocation(`/projects/${result.projectCode}`);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create project", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/project-templates/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Template archived" });
      queryClient.invalidateQueries({ queryKey: ["/api/project-templates"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete template", description: err.message, variant: "destructive" });
    },
  });

  function openUseDialog(tpl: ProjectTemplate) {
    setActiveTemplate(tpl);
    setSelectedVersionId("latest");
    form.reset({
      name: "",
      clientName: "",
      projectStartDate: new Date().toISOString().slice(0, 10),
      description: tpl.description ?? "",
      locationAddress: "",
      city: "",
      state: "",
      contractAmount: "",
      budget: "",
    });
    setUseDialogOpen(true);
  }

  function onSubmit(values: InstantiateInput) {
    if (!activeTemplate) return;
    instantiateMutation.mutate({
      templateId: activeTemplate.id,
      versionId: selectedVersionId === "latest" ? undefined : selectedVersionId,
      input: values,
    });
  }

  const editMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      name: string;
      description: string;
      category: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/project-templates/${vars.id}`, {
        name: vars.name,
        description: vars.description || undefined,
        category: vars.category || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/project-templates"] });
      setEditTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update template", description: err.message, variant: "destructive" });
    },
  });

  const newVersionMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const res = await apiRequest("POST", `/api/project-templates/${templateId}/versions`, {
        recaptureFromSource: true,
        notes: "Re-captured from source project",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "New version created" });
      queryClient.invalidateQueries({ queryKey: ["/api/project-templates"] });
      if (activeTemplate) {
        queryClient.invalidateQueries({ queryKey: ["/api/project-templates", activeTemplate.id] });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create new version", description: err.message, variant: "destructive" });
    },
  });

  function openEditDialog(tpl: ProjectTemplate) {
    setEditTarget(tpl);
    setEditName(tpl.name);
    setEditDescription(tpl.description ?? "");
    setEditCategory(tpl.category ?? "");
  }

  return (
    <main className="container max-w-6xl py-8 space-y-6" data-testid="page-project-templates">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-templates-title">
            <Layers className="w-7 h-7" />
            Project Templates
          </h1>
          <p className="text-muted-foreground mt-1">
            Re-usable project archetypes — WBS, dependencies, distribution lists, cost
            codes and SoV captured as a versioned snapshot.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/projects")}
          data-testid="button-back-projects"
        >
          Back to projects
        </Button>
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-templates"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground" data-testid="text-loading">
          Loading templates...
        </p>
      ) : filtered.length === 0 ? (
        <Card data-testid="card-empty">
          <CardContent className="py-12 text-center text-muted-foreground">
            No templates match your search.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tpl) => (
            <Card
              key={tpl.id}
              className="flex flex-col"
              data-testid={`card-template-${tpl.id}`}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg" data-testid={`text-template-name-${tpl.id}`}>
                    {tpl.name}
                  </CardTitle>
                  {tpl.isSystemSeed && (
                    <Badge variant="secondary" className="shrink-0" data-testid={`badge-system-${tpl.id}`}>
                      <Sparkles className="w-3 h-3 mr-1" /> System
                    </Badge>
                  )}
                </div>
                {tpl.category && (
                  <Badge variant="outline" className="w-fit mt-1" data-testid={`badge-category-${tpl.id}`}>
                    {tpl.category}
                  </Badge>
                )}
                <CardDescription className="mt-2">{tpl.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between gap-3">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />v{tpl.currentVersion} • used {tpl.usageCount} time(s)
                  </div>
                  {tpl.lastUsedAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Last used {new Date(tpl.lastUsedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => openUseDialog(tpl)}
                    disabled={!canCreate}
                    data-testid={`button-use-template-${tpl.id}`}
                  >
                    Use template
                  </Button>
                  {canManage && !tpl.isSystemSeed && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditDialog(tpl)}
                        data-testid={`button-edit-template-${tpl.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {tpl.sourceProjectId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={newVersionMutation.isPending}
                          onClick={() => newVersionMutation.mutate(tpl.id)}
                          data-testid={`button-new-version-${tpl.id}`}
                          title="Re-capture from source project as a new version"
                        >
                          <History className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteTarget(tpl)}
                        data-testid={`button-delete-template-${tpl.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={useDialogOpen} onOpenChange={setUseDialogOpen}>
        <DialogContent className="sm:max-w-2xl" data-testid="dialog-use-template">
          <DialogHeader>
            <DialogTitle>Start from template: {activeTemplate?.name}</DialogTitle>
            <DialogDescription>
              We'll seed your new project's WBS, dependencies, distribution lists,
              cost codes, and SoV from this template's most recent version. You can
              adjust any of it after the project is created.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.data && detailQuery.data.versions.length > 0 && (
            <div className="space-y-1" data-testid="version-selector">
              <label className="text-sm font-medium">Template version</label>
              <Select
                value={selectedVersionId}
                onValueChange={(v) => setSelectedVersionId(v)}
              >
                <SelectTrigger data-testid="select-template-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest" data-testid="select-version-latest">
                    Latest (v{activeTemplate?.currentVersion ?? 1})
                  </SelectItem>
                  {detailQuery.data.versions.map((v) => (
                    <SelectItem
                      key={v.id}
                      value={v.id}
                      data-testid={`select-version-${v.id}`}
                    >
                      v{v.version}
                      {v.notes ? ` — ${v.notes}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Downtown Office Renovation"
                        {...field}
                        data-testid="input-template-project-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client name *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Acme Corp"
                          {...field}
                          data-testid="input-template-client"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="projectStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-template-start" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contractAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract amount</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="275000.00"
                          {...field}
                          data-testid="input-template-contract"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="budget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Budget</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="250000.00"
                          {...field}
                          data-testid="input-template-budget"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="locationAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St" {...field} data-testid="input-template-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="Austin" {...field} data-testid="input-template-city" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="TX" {...field} data-testid="input-template-state" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[80px]"
                        {...field}
                        data-testid="input-template-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setUseDialogOpen(false)}
                  data-testid="button-template-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={instantiateMutation.isPending}
                  data-testid="button-template-create"
                >
                  {instantiateMutation.isPending ? "Creating..." : "Create project"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-template">
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
            <DialogDescription>
              Update the template's metadata. To change the captured WBS,
              dependencies and SoV, edit the source project and create a new
              version with the history button.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                data-testid="input-edit-template-name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Category</label>
              <Input
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                data-testid="input-edit-template-category"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                className="min-h-[100px]"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                data-testid="input-edit-template-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditTarget(null)}
              data-testid="button-edit-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={editMutation.isPending || !editName.trim()}
              onClick={() =>
                editTarget &&
                editMutation.mutate({
                  id: editTarget.id,
                  name: editName.trim(),
                  description: editDescription,
                  category: editCategory,
                })
              }
              data-testid="button-edit-save"
            >
              {editMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="dialog-delete-template">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive template?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be hidden from the library. Existing
              projects already created from it are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-delete-confirm"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
