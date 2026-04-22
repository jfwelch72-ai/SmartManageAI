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
import { Layers, Sparkles, Trash2, Search, FileText, Calendar, Pencil, History, ChevronRight, ChevronDown, Flag, ArrowRight, ListTree, Eye } from "lucide-react";
import type { ProjectTemplate } from "@shared/schema";
import { TemplateContentEditorDialog } from "@/components/templates/template-content-editor-dialog";

interface SnapshotTask {
  refId: string;
  parentRefId: string | null;
  name: string;
  durationDays: number | null;
  isMilestone: boolean;
  sortOrder: number;
  outlineLevel: number;
  wbsCode: string | null;
}
interface SnapshotDependency {
  predecessorRefId: string;
  successorRefId: string;
  dependencyType: string;
  lagDays: number;
}
interface SnapshotResponse {
  versionId: string;
  version: number;
  tasks: SnapshotTask[];
  dependencies: SnapshotDependency[];
}

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
  const [contentEditorTarget, setContentEditorTarget] = useState<ProjectTemplate | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [excludedRefIds, setExcludedRefIds] = useState<Set<string>>(new Set());
  const [collapsedRefIds, setCollapsedRefIds] = useState<Set<string>>(new Set());
  const [previewTemplate, setPreviewTemplate] = useState<ProjectTemplate | null>(null);
  const [previewCollapsedRefIds, setPreviewCollapsedRefIds] = useState<Set<string>>(new Set());

  const previewSnapshotQuery = useQuery<SnapshotResponse>({
    queryKey: ["/api/project-templates", previewTemplate?.id, "snapshot", "latest"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/project-templates/${previewTemplate!.id}/snapshot`,
      );
      return res.json();
    },
    enabled: !!previewTemplate,
  });

  const previewChildrenByParent = useMemo(() => {
    const map = new Map<string | null, SnapshotTask[]>();
    const tasks = previewSnapshotQuery.data?.tasks ?? [];
    for (const t of tasks) {
      const key = t.parentRefId ?? null;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return map;
  }, [previewSnapshotQuery.data?.tasks]);

  const previewTaskByRefId = useMemo(() => {
    const map = new Map<string, SnapshotTask>();
    for (const t of previewSnapshotQuery.data?.tasks ?? []) map.set(t.refId, t);
    return map;
  }, [previewSnapshotQuery.data?.tasks]);

  function togglePreviewCollapsed(refId: string) {
    setPreviewCollapsedRefIds((prev) => {
      const next = new Set(prev);
      if (next.has(refId)) next.delete(refId);
      else next.add(refId);
      return next;
    });
  }

  function renderPreviewTaskNode(task: SnapshotTask, depth: number): JSX.Element {
    const kids = previewChildrenByParent.get(task.refId) ?? [];
    const hasKids = kids.length > 0;
    const collapsed = previewCollapsedRefIds.has(task.refId);
    return (
      <div key={task.refId}>
        <div
          className="flex items-center gap-2 py-1 px-1 rounded hover-elevate text-sm"
          style={{ paddingLeft: depth * 14 + 4 }}
          data-testid={`row-preview-task-${task.refId}`}
        >
          {hasKids ? (
            <button
              type="button"
              onClick={() => togglePreviewCollapsed(task.refId)}
              className="shrink-0 text-muted-foreground"
              data-testid={`button-preview-toggle-${task.refId}`}
            >
              {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-3 h-3 shrink-0" />
          )}
          {task.isMilestone && <Flag className="w-3 h-3 text-amber-600 shrink-0" />}
          <span className="truncate flex-1" title={task.name}>
            {task.wbsCode ? <span className="text-muted-foreground mr-1">{task.wbsCode}</span> : null}
            {task.name}
          </span>
          {task.durationDays !== null && (
            <span className="text-xs text-muted-foreground shrink-0">{task.durationDays}d</span>
          )}
        </div>
        {hasKids && !collapsed && (
          <div>{kids.map((k) => renderPreviewTaskNode(k, depth + 1))}</div>
        )}
      </div>
    );
  }

  function openPreviewDialog(tpl: ProjectTemplate) {
    setPreviewTemplate(tpl);
    setPreviewCollapsedRefIds(new Set());
  }

  const detailQuery = useQuery<TemplateDetailResponse>({
    queryKey: ["/api/project-templates", activeTemplate?.id],
    enabled: !!activeTemplate,
  });

  const snapshotVersionParam = selectedVersionId === "latest" ? undefined : selectedVersionId;
  const snapshotQuery = useQuery<SnapshotResponse>({
    queryKey: [
      "/api/project-templates",
      activeTemplate?.id,
      "snapshot",
      snapshotVersionParam ?? "latest",
    ],
    queryFn: async () => {
      const url = snapshotVersionParam
        ? `/api/project-templates/${activeTemplate!.id}/snapshot?versionId=${snapshotVersionParam}`
        : `/api/project-templates/${activeTemplate!.id}/snapshot`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: !!activeTemplate && useDialogOpen,
  });

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, SnapshotTask[]>();
    const tasks = snapshotQuery.data?.tasks ?? [];
    for (const t of tasks) {
      const key = t.parentRefId ?? null;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return map;
  }, [snapshotQuery.data?.tasks]);

  const taskByRefId = useMemo(() => {
    const map = new Map<string, SnapshotTask>();
    for (const t of snapshotQuery.data?.tasks ?? []) map.set(t.refId, t);
    return map;
  }, [snapshotQuery.data?.tasks]);

  function descendantsOf(refId: string): string[] {
    const out: string[] = [];
    const stack: string[] = [refId];
    while (stack.length) {
      const cur = stack.pop()!;
      const kids = childrenByParent.get(cur) ?? [];
      for (const k of kids) {
        out.push(k.refId);
        stack.push(k.refId);
      }
    }
    return out;
  }

  function toggleExcluded(refId: string) {
    setExcludedRefIds((prev) => {
      const next = new Set(prev);
      const affected = [refId, ...descendantsOf(refId)];
      const isExcluding = !next.has(refId);
      for (const id of affected) {
        if (isExcluding) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleCollapsed(refId: string) {
    setCollapsedRefIds((prev) => {
      const next = new Set(prev);
      if (next.has(refId)) next.delete(refId);
      else next.add(refId);
      return next;
    });
  }

  const includedCount = useMemo(() => {
    const tasks = snapshotQuery.data?.tasks ?? [];
    return tasks.filter((t) => !excludedRefIds.has(t.refId)).length;
  }, [snapshotQuery.data?.tasks, excludedRefIds]);

  const includedDependencies = useMemo(() => {
    const deps = snapshotQuery.data?.dependencies ?? [];
    return deps.filter(
      (d) => !excludedRefIds.has(d.predecessorRefId) && !excludedRefIds.has(d.successorRefId),
    );
  }, [snapshotQuery.data?.dependencies, excludedRefIds]);

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
    mutationFn: async (vars: {
      templateId: string;
      versionId?: string;
      input: InstantiateInput;
      excludedRefIds?: string[];
    }) => {
      const res = await apiRequest("POST", "/api/project-templates/instantiate", {
        templateId: vars.templateId,
        versionId: vars.versionId,
        projectStartDate: vars.input.projectStartDate,
        excludedRefIds: vars.excludedRefIds,
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
      setExcludedRefIds(new Set());
      setCollapsedRefIds(new Set());
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
    setExcludedRefIds(new Set());
    setCollapsedRefIds(new Set());
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
      excludedRefIds: excludedRefIds.size > 0 ? Array.from(excludedRefIds) : undefined,
    });
  }

  function renderTaskNode(task: SnapshotTask, depth: number): JSX.Element {
    const kids = childrenByParent.get(task.refId) ?? [];
    const hasKids = kids.length > 0;
    const collapsed = collapsedRefIds.has(task.refId);
    const excluded = excludedRefIds.has(task.refId);
    return (
      <div key={task.refId}>
        <div
          className={`flex items-center gap-2 py-1 px-1 rounded hover-elevate text-sm ${
            excluded ? "opacity-50 line-through" : ""
          }`}
          style={{ paddingLeft: depth * 14 + 4 }}
          data-testid={`row-snapshot-task-${task.refId}`}
        >
          {hasKids ? (
            <button
              type="button"
              onClick={() => toggleCollapsed(task.refId)}
              className="shrink-0 text-muted-foreground"
              data-testid={`button-toggle-${task.refId}`}
            >
              {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-3 h-3 shrink-0" />
          )}
          <input
            type="checkbox"
            checked={!excluded}
            onChange={() => toggleExcluded(task.refId)}
            className="shrink-0"
            data-testid={`checkbox-snapshot-task-${task.refId}`}
          />
          {task.isMilestone && <Flag className="w-3 h-3 text-amber-600 shrink-0" />}
          <span className="truncate flex-1" title={task.name}>
            {task.wbsCode ? <span className="text-muted-foreground mr-1">{task.wbsCode}</span> : null}
            {task.name}
          </span>
          {task.durationDays !== null && (
            <span className="text-xs text-muted-foreground shrink-0">{task.durationDays}d</span>
          )}
        </div>
        {hasKids && !collapsed && (
          <div>{kids.map((k) => renderTaskNode(k, depth + 1))}</div>
        )}
      </div>
    );
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
                    variant="outline"
                    onClick={() => openPreviewDialog(tpl)}
                    data-testid={`button-preview-template-${tpl.id}`}
                  >
                    <Eye className="w-4 h-4 mr-1" /> Preview
                  </Button>
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
                        title="Edit metadata (name/category/description)"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setContentEditorTarget(tpl)}
                        data-testid={`button-edit-content-${tpl.id}`}
                        title="Edit tasks, dependencies, folders and SoV (creates a new version)"
                      >
                        <ListTree className="w-4 h-4" />
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
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-use-template">
          <DialogHeader>
            <DialogTitle>Start from template: {activeTemplate?.name}</DialogTitle>
            <DialogDescription>
              We'll seed your new project's WBS, dependencies, distribution lists,
              cost codes, and SoV from this template's most recent version. You can
              adjust any of it after the project is created.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
          {detailQuery.data && detailQuery.data.versions.length > 0 && (
            <div className="space-y-1" data-testid="version-selector">
              <label className="text-sm font-medium">Template version</label>
              <Select
                value={selectedVersionId}
                onValueChange={(v) => {
                  setSelectedVersionId(v);
                  setExcludedRefIds(new Set());
                  setCollapsedRefIds(new Set());
                }}
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
          </div>

          <div className="space-y-4 lg:border-l lg:pl-6" data-testid="panel-template-preview">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4" /> WBS preview
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Uncheck any task you don't want seeded into the new project.
                Toggling a parent off cascades to its children and removes
                dependencies that touch excluded tasks.
              </p>
            </div>

            {snapshotQuery.isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-snapshot-loading">
                Loading snapshot...
              </p>
            ) : snapshotQuery.isError ? (
              <p className="text-sm text-destructive" data-testid="text-snapshot-error">
                Could not load template snapshot.
              </p>
            ) : (snapshotQuery.data?.tasks ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-snapshot-empty">
                This template has no schedule tasks captured.
              </p>
            ) : (
              <>
                <div
                  className="text-xs text-muted-foreground flex items-center justify-between"
                  data-testid="text-snapshot-counts"
                >
                  <span>
                    {includedCount} of {snapshotQuery.data!.tasks.length} task(s) selected
                  </span>
                  {excludedRefIds.size > 0 && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setExcludedRefIds(new Set())}
                      data-testid="button-include-all"
                    >
                      Include all
                    </button>
                  )}
                </div>
                <div
                  className="border rounded-md p-2 max-h-64 overflow-y-auto bg-muted/20"
                  data-testid="tree-snapshot-tasks"
                >
                  {(childrenByParent.get(null) ?? []).map((t) => renderTaskNode(t, 0))}
                </div>

                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" /> Dependencies
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {includedDependencies.length} of{" "}
                    {snapshotQuery.data!.dependencies.length} link(s) will be created.
                  </p>
                  <div
                    className="border rounded-md p-2 max-h-40 overflow-y-auto mt-2 space-y-1 bg-muted/20"
                    data-testid="list-snapshot-dependencies"
                  >
                    {(snapshotQuery.data?.dependencies ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No dependencies captured.
                      </p>
                    ) : (
                      (snapshotQuery.data?.dependencies ?? []).map((d, i) => {
                        const pred = taskByRefId.get(d.predecessorRefId);
                        const succ = taskByRefId.get(d.successorRefId);
                        const skipped =
                          excludedRefIds.has(d.predecessorRefId) ||
                          excludedRefIds.has(d.successorRefId);
                        return (
                          <div
                            key={`${d.predecessorRefId}-${d.successorRefId}-${i}`}
                            className={`text-xs flex items-center gap-1 ${
                              skipped ? "opacity-40 line-through" : ""
                            }`}
                            data-testid={`row-dependency-${i}`}
                          >
                            <span className="truncate">{pred?.name ?? d.predecessorRefId}</span>
                            <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{succ?.name ?? d.successorRefId}</span>
                            <Badge variant="outline" className="ml-auto shrink-0 text-[10px] py-0 px-1">
                              {d.dependencyType}
                              {d.lagDays ? ` ${d.lagDays > 0 ? "+" : ""}${d.lagDays}d` : ""}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previewTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewTemplate(null);
            setPreviewCollapsedRefIds(new Set());
          }
        }}
      >
        <DialogContent
          className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
          data-testid="dialog-preview-template"
        >
          <DialogHeader>
            <DialogTitle data-testid="text-preview-title">
              Preview: {previewTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              Read-only view of the WBS and dependencies captured in v
              {previewTemplate?.currentVersion ?? 1}. Use this to evaluate the
              template's scope before starting a new project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4" /> WBS
              </h3>
            </div>
            {previewSnapshotQuery.isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-preview-loading">
                Loading template snapshot...
              </p>
            ) : previewSnapshotQuery.isError ? (
              <p className="text-sm text-destructive" data-testid="text-preview-error">
                Could not load template snapshot.
              </p>
            ) : (previewSnapshotQuery.data?.tasks ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-preview-empty">
                This template has no schedule tasks captured.
              </p>
            ) : (
              <>
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="text-preview-counts"
                >
                  {previewSnapshotQuery.data!.tasks.length} task(s) •{" "}
                  {previewSnapshotQuery.data!.dependencies.length} dependency
                  link(s)
                </p>
                <div
                  className="border rounded-md p-2 max-h-80 overflow-y-auto bg-muted/20"
                  data-testid="tree-preview-tasks"
                >
                  {(previewChildrenByParent.get(null) ?? []).map((t) =>
                    renderPreviewTaskNode(t, 0),
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" /> Dependencies
                  </h4>
                  <div
                    className="border rounded-md p-2 max-h-56 overflow-y-auto mt-2 space-y-1 bg-muted/20"
                    data-testid="list-preview-dependencies"
                  >
                    {(previewSnapshotQuery.data?.dependencies ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No dependencies captured.
                      </p>
                    ) : (
                      (previewSnapshotQuery.data?.dependencies ?? []).map((d, i) => {
                        const pred = previewTaskByRefId.get(d.predecessorRefId);
                        const succ = previewTaskByRefId.get(d.successorRefId);
                        return (
                          <div
                            key={`${d.predecessorRefId}-${d.successorRefId}-${i}`}
                            className="text-xs flex items-center gap-1"
                            data-testid={`row-preview-dependency-${i}`}
                          >
                            <span className="truncate">{pred?.name ?? d.predecessorRefId}</span>
                            <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{succ?.name ?? d.successorRefId}</span>
                            <Badge
                              variant="outline"
                              className="ml-auto shrink-0 text-[10px] py-0 px-1"
                            >
                              {d.dependencyType}
                              {d.lagDays
                                ? ` ${d.lagDays > 0 ? "+" : ""}${d.lagDays}d`
                                : ""}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreviewTemplate(null);
                setPreviewCollapsedRefIds(new Set());
              }}
              data-testid="button-preview-close"
            >
              Close
            </Button>
            {previewTemplate && canCreate && (
              <Button
                type="button"
                onClick={() => {
                  const tpl = previewTemplate;
                  setPreviewTemplate(null);
                  setPreviewCollapsedRefIds(new Set());
                  openUseDialog(tpl);
                }}
                data-testid="button-preview-use-template"
              >
                Use template
              </Button>
            )}
          </DialogFooter>
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

      <TemplateContentEditorDialog
        template={contentEditorTarget}
        open={!!contentEditorTarget}
        onOpenChange={(open) => !open && setContentEditorTarget(null)}
      />

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
