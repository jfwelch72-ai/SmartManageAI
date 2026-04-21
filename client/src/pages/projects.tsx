import { useState, useEffect, useRef } from "react";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useGlobalSearchFocus } from "@/hooks/use-global-search-focus";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";
import ProjectsTable from "@/components/ProjectsTable";
import ViewSwitcher, { type ViewType as ProjectsViewType } from "@/components/ViewSwitcher";
import ProjectsKanbanView from "@/components/ProjectsKanbanView";
import ProjectsCalendarView from "@/components/ProjectsCalendarView";
import ProjectsMapView from "@/components/ProjectsMapView";
import SavedViewsDropdown, { type AppliedView, type BuiltInView } from "@/components/SavedViewsDropdown";

interface ProjectsFilterState {
  status: string;
  search: string;
  special: string | null;
}

const PROJECTS_DEFAULT_FILTERS: ProjectsFilterState = { status: "ALL", search: "", special: null };

const PROJECTS_BUILT_IN_VIEWS: BuiltInView<ProjectsFilterState>[] = [
  { id: "builtin-all", name: "All projects", apply: { view: "table", filters: { status: "ALL", search: "", special: null } } },
  { id: "builtin-active", name: "My active projects", apply: { view: "table", filters: { status: "ACTIVE", search: "", special: "myProjects" } } },
  { id: "builtin-bidding", name: "Bidding", apply: { view: "kanban", filters: { status: "BID", search: "", special: null } } },
  { id: "builtin-onhold", name: "On hold > 14 days", apply: { view: "table", filters: { status: "PLANNING", search: "", special: "onHoldStale14" } } },
];
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, X, Trash2, FolderKanban, Users as UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
} from "@/hooks/use-data";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  FeaturePermissions,
  getAllowedProjectStatuses,
  canViewProjectStatus,
} from "@/lib/rbac";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProjectSchema } from "@shared/schema";
import type { CrmOrganisation, CrmContact } from "@shared/schema";
import { z } from "zod";
import { EmptyState } from "@/components/EmptyState";

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const allowedStatuses = getAllowedProjectStatuses(user?.role);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [specialFilter, setSpecialFilter] = useState<string | null>(null);
  const [viewType, setViewType] = useState<ProjectsViewType>(() => {
    if (typeof window === "undefined") return "table";
    const saved = window.localStorage.getItem("projects-view");
    return saved === "kanban" || saved === "calendar" || saved === "map" || saved === "table"
      ? (saved as ProjectsViewType)
      : "table";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("projects-view", viewType);
    }
  }, [viewType]);

  const handleApplyView = (applied: AppliedView<ProjectsFilterState>) => {
    setViewType(applied.view);
    setStatusFilter(applied.filters.status || "ALL");
    setSearchTerm(applied.filters.search || "");
    setSpecialFilter(applied.filters.special ?? null);
  };
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{
    code: string;
    name: string;
  } | null>(null);

  // CRM organization state for project creation
  const [selectedGcOrg, setSelectedGcOrg] = useState<CrmOrganisation | null>(
    null,
  );
  const [selectedGcContact, setSelectedGcContact] = useState<CrmContact | null>(
    null,
  );
  const [selectedOwnerRepOrg, setSelectedOwnerRepOrg] =
    useState<CrmOrganisation | null>(null);
  const [selectedOwnerRepContact, setSelectedOwnerRepContact] =
    useState<CrmContact | null>(null);

  // Check if user can delete projects (ADMIN or MANAGER only)
  const canDelete = user?.role === "ADMIN" || user?.role === "MANAGER";

  // Check URL for query parameters
  useEffect(() => {
    const params = new URLSearchParams(searchParams);

    if (params.get("new") === "true") {
      setShowCreateDialog(true);
      setLocation("/projects", { replace: true });
    }

    // Handle status filter from URL
    const statusParam = params.get("status");
    if (
      statusParam &&
      ["ACTIVE", "PLANNING", "COMPLETE", "CLOSED"].includes(statusParam)
    ) {
      setStatusFilter(statusParam);
    }

    // Handle special filters from URL
    if (params.get("changeOrders") === "pending") {
      setSpecialFilter("pendingChangeOrders");
    } else if (params.get("filter") === "missingBudget") {
      setSpecialFilter("missingBudget");
    }
  }, [searchParams, setLocation]);

  // Create schema without code - code is auto-generated on the backend
  const createProjectFormSchema = insertProjectSchema.omit({ code: true });
  type CreateProjectFormInput = z.infer<typeof createProjectFormSchema>;

  const form = useForm<CreateProjectFormInput>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: "",
      clientName: "",
      clientContactName: "",
      clientContactEmail: "",
      clientContactPhone: "",
      status: "PLANNING",
      budget: "",
      contractAmount: "",
      locationAddress: "",
      city: "",
      state: "",
      description: "",
      gcOrganizationId: undefined,
      ownerRepOrganizationId: undefined,
    },
  });

  // Handle GC organization selection - auto-populate client fields
  const handleGcSelect = (org: CrmOrganisation | null) => {
    const previousOrgId = selectedGcOrg?.id;
    setSelectedGcOrg(org);

    // Always clear contact when org changes (different org or deselected)
    if (!org || org.id !== previousOrgId) {
      setSelectedGcContact(null);
      form.setValue("clientContactName", "");
      form.setValue("clientContactEmail", "");
      form.setValue("clientContactPhone", "");
    }

    if (org) {
      form.setValue("gcOrganizationId", org.id);
      form.setValue("clientName", org.name);
    } else {
      // Clear GC-related fields when deselected
      form.setValue("gcOrganizationId", undefined);
      form.setValue("clientName", "");
    }
  };

  // Handle GC contact selection - auto-populate contact fields
  const handleGcContactSelect = (contact: CrmContact | null) => {
    setSelectedGcContact(contact);
    if (contact) {
      const fullName = `${contact.firstName} ${contact.lastName}`.trim();
      form.setValue("clientContactName", fullName);
      form.setValue("clientContactEmail", contact.email || "");
      form.setValue(
        "clientContactPhone",
        contact.phone || contact.mobile || "",
      );
    } else {
      // Clear contact fields when deselected
      form.setValue("clientContactName", "");
      form.setValue("clientContactEmail", "");
      form.setValue("clientContactPhone", "");
    }
  };

  // Handle Owner Rep organization selection
  const handleOwnerRepSelect = (org: CrmOrganisation | null) => {
    const previousOrgId = selectedOwnerRepOrg?.id;
    setSelectedOwnerRepOrg(org);

    // Always clear contact when org changes (different org or deselected)
    if (!org || org.id !== previousOrgId) {
      setSelectedOwnerRepContact(null);
    }

    if (org) {
      form.setValue("ownerRepOrganizationId", org.id);
    } else {
      form.setValue("ownerRepOrganizationId", undefined);
    }
  };

  // Handle Owner Rep contact selection
  const handleOwnerRepContactSelect = (contact: CrmContact | null) => {
    setSelectedOwnerRepContact(contact);
  };

  // Handle dialog open/close - reset state when closing
  const handleDialogOpenChange = (open: boolean) => {
    setShowCreateDialog(open);
    if (!open) {
      resetFormAndCrmState();
    }
  };

  const resetFormAndCrmState = () => {
    form.reset();
    setSelectedGcOrg(null);
    setSelectedGcContact(null);
    setSelectedOwnerRepOrg(null);
    setSelectedOwnerRepContact(null);
  };

  const onSubmit = async (data: CreateProjectFormInput) => {
    try {
      // Transform empty strings to undefined for optional fields
      const submitData = {
        ...data,
        clientName: data.clientName || undefined,
        clientContactName: data.clientContactName || undefined,
        clientContactEmail: data.clientContactEmail || undefined,
        clientContactPhone: data.clientContactPhone || undefined,
        budget: data.budget || undefined,
        contractAmount: data.contractAmount || undefined,
        locationAddress: data.locationAddress || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        description: data.description || undefined,
        gcOrganizationId: selectedGcOrg?.id || undefined,
        ownerRepOrganizationId: selectedOwnerRepOrg?.id || undefined,
      };

      const result = await createProject.mutateAsync(submitData);

      if (result && result.code) {
        toast({
          title: "Success",
          description: `Project ${result.code} created successfully!`,
        });
        setShowCreateDialog(false);
        resetFormAndCrmState();
        // Navigate to the new project using the auto-generated code
        setLocation(`/projects/${result.code}`);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    }
  };

  const handleDeleteProject = (code: string, name: string) => {
    setProjectToDelete({ code, name });
    setShowDeleteConfirm(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject.mutateAsync(projectToDelete.code);
      toast({
        title: "Success",
        description: `Project ${projectToDelete.code} has been deleted.`,
      });
      setShowDeleteConfirm(false);
      setProjectToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete project",
        variant: "destructive",
      });
    }
  };

  const { data: projects = [], isLoading } = useProjects();

  // Task #736: bulk "Reassign owner" action for admins/managers on the projects
  // table. Mirrors the contacts bulk-reassign pattern — prompts for which
  // owner-role slot (PM / superintendent / estimator / safety officer) to
  // update and which user to assign, then calls the new bulk endpoint.
  const canBulkReassignProjectOwner =
    user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR";
  type ProjectRoleField =
    | "projectManagerId"
    | "superintendentId"
    | "estimatorId"
    | "safetyOfficerId";
  const PROJECT_ROLE_OPTIONS: { value: ProjectRoleField; label: string }[] = [
    { value: "projectManagerId", label: "Project Manager" },
    { value: "superintendentId", label: "Superintendent" },
    { value: "estimatorId", label: "Estimator" },
    { value: "safetyOfficerId", label: "Safety Officer" },
  ];
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [bulkRoleField, setBulkRoleField] = useState<ProjectRoleField>("projectManagerId");

  interface OrgUserOption {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  }
  const { data: orgUsersForBulk = [] } = useQuery<OrgUserOption[]>({
    queryKey: ["/api/users"],
    enabled: canBulkReassignProjectOwner,
  });
  const bulkOwnerLabelById = new Map<string, string>(
    orgUsersForBulk.map((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
      return [u.id, name || u.email || u.id] as const;
    }),
  );

  const bulkReassignProjectOwnerMutation = useMutation({
    mutationFn: async ({
      projectIds,
      roleField,
      userId,
    }: {
      projectIds: string[];
      roleField: ProjectRoleField;
      userId: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/projects/bulk-reassign-owner", {
        projectIds,
        roleField,
        userId,
      });
      return res.json() as Promise<{ updated: number; roleField: ProjectRoleField; userId: string | null }>;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectIds(new Set());
      const roleLabel =
        PROJECT_ROLE_OPTIONS.find((r) => r.value === vars.roleField)?.label ?? "owner";
      const ownerLabel = vars.userId
        ? (bulkOwnerLabelById.get(vars.userId) ?? "selected user")
        : "Unassigned";
      const n = data?.updated ?? 0;
      toast({
        title: `Reassigned ${n} project${n === 1 ? "" : "s"}`,
        description: `${roleLabel} → ${ownerLabel}`,
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "";
      toast({
        title: "Failed to reassign owner",
        description: message,
        variant: "destructive",
      });
    },
  });

  // Note: filteredProjects is computed below; we'll compute keyboard nav after it.

  // Fetch projects with pending change orders (only when needed)
  const { data: projectsWithPendingCOs = [] } = useQuery<string[]>({
    queryKey: ["/api/projects/with-pending-change-orders"],
    enabled: specialFilter === "pendingChangeOrders",
  });

  const filteredProjects = projects.filter((project) => {
    const matchesSearch =
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (project.clientName &&
        project.clientName.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus =
      statusFilter === "ALL" || project.status === statusFilter;

    // Filter by allowed project statuses based on role
    const isAllowedStatus = canViewProjectStatus(user?.role, project.status);

    // Handle special filters
    let matchesSpecialFilter = true;
    if (specialFilter === "pendingChangeOrders") {
      matchesSpecialFilter = projectsWithPendingCOs.includes(project.id);
    } else if (specialFilter === "missingBudget") {
      const budgetNum = Number(project.budget);
      matchesSpecialFilter =
        !project.budget || isNaN(budgetNum) || budgetNum <= 0;
    } else if (specialFilter === "myProjects") {
      const uid = user?.id;
      matchesSpecialFilter = !!uid && (
        project.estimatorId === uid ||
        project.superintendentId === uid ||
        project.projectManagerId === uid
      );
    } else if (specialFilter === "onHoldStale14") {
      const updated = project.updatedAt ? new Date(project.updatedAt).getTime() : 0;
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      matchesSpecialFilter = updated > 0 && updated < fourteenDaysAgo;
    }

    return (
      matchesSearch && matchesStatus && isAllowedStatus && matchesSpecialFilter
    );
  });

  const { getRowProps: getProjectRowProps } = useTableKeyboardNav({
    rowCount: filteredProjects.length,
    onActivate: (idx) => {
      const project = filteredProjects[idx];
      if (project) setLocation(`/projects/${project.code}`);
    },
  });
  useGlobalSearchFocus(searchInputRef);
  useRegisterShortcuts("projects-list", TABLE_NAV_SHORTCUTS);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-1">
              {specialFilter === "pendingChangeOrders"
                ? "Projects with Pending Change Orders"
                : specialFilter === "missingBudget"
                  ? "Projects Missing Budget Data"
                  : statusFilter !== "ALL"
                    ? `${statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase()} Projects`
                    : "All Projects"}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {specialFilter === "pendingChangeOrders"
                ? "Projects with change orders awaiting client response"
                : specialFilter === "missingBudget"
                  ? "Projects that need budget information added"
                  : "View and manage all awarded construction projects"}
            </p>
            {(specialFilter || statusFilter !== "ALL") && (
              <div className="flex items-center gap-2 mt-2">
                {statusFilter !== "ALL" && (
                  <Badge variant="secondary" className="gap-1">
                    Status: {statusFilter}
                    <X
                      className="w-3 h-3 cursor-pointer"
                      onClick={() => setStatusFilter("ALL")}
                      data-testid="button-clear-status-filter"
                    />
                  </Badge>
                )}
                {specialFilter && (
                  <Badge variant="secondary" className="gap-1">
                    {specialFilter === "pendingChangeOrders"
                      ? "Pending COs"
                      : "Missing Budget"}
                    <X
                      className="w-3 h-3 cursor-pointer"
                      onClick={() => {
                        setSpecialFilter(null);
                        setLocation("/projects", { replace: true });
                      }}
                      data-testid="button-clear-special-filter"
                    />
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <ViewSwitcher value={viewType} onChange={setViewType} testId="projects-view-switcher" />
            <SavedViewsDropdown
              viewKey="projects"
              builtInViews={PROJECTS_BUILT_IN_VIEWS}
              defaultFilters={PROJECTS_DEFAULT_FILTERS}
              current={{ view: viewType, filters: { status: statusFilter, search: searchTerm, special: specialFilter } }}
              onApply={handleApplyView}
            />
            <AIAnalysisButton showDropdown />
            {FeaturePermissions.CREATE_PROJECT(user?.role) && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/bids")}
                  data-testid="button-view-bids"
                >
                  View Bids
                </Button>
                <Button
                  onClick={() => setShowCreateDialog(true)}
                  data-testid="button-new-project"
                >
                  <Plus className="w-4 h-4 mr-1 sm:mr-2" />
                  New Project
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search projects by name, code, or client..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="w-full md:w-48"
              data-testid="select-status-filter"
            >
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {allowedStatuses.includes("PLANNING") && (
                <SelectItem value="PLANNING">Planning</SelectItem>
              )}
              {allowedStatuses.includes("ACTIVE") && (
                <SelectItem value="ACTIVE">Active</SelectItem>
              )}
              {allowedStatuses.includes("COMPLETE") && (
                <SelectItem value="COMPLETE">Complete</SelectItem>
              )}
              {allowedStatuses.includes("CLOSED") && (
                <SelectItem value="CLOSED">Closed</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading projects...
          </div>
        ) : filteredProjects.length === 0 && viewType === "table" ? (
          <EmptyState
            icon={FolderKanban}
            title={searchTerm || statusFilter !== "ALL" ? "No projects match your filters" : "No projects yet"}
            description={searchTerm || statusFilter !== "ALL"
              ? "Try adjusting your search or filter criteria."
              : "Create your first project to start tracking construction work."}
            actionLabel={!(searchTerm || statusFilter !== "ALL") && FeaturePermissions.CREATE_PROJECT(user?.role) ? "New Project" : undefined}
            onAction={!(searchTerm || statusFilter !== "ALL") && FeaturePermissions.CREATE_PROJECT(user?.role) ? () => setShowCreateDialog(true) : undefined}
          />
        ) : viewType === "kanban" ? (
          <ProjectsKanbanView
            projects={filteredProjects}
            onCardClick={(project) => setLocation(`/projects/${project.code}`)}
          />
        ) : viewType === "calendar" ? (
          <ProjectsCalendarView
            projects={filteredProjects}
            onProjectClick={(project) => setLocation(`/projects/${project.code}`)}
          />
        ) : viewType === "map" ? (
          <ProjectsMapView
            projects={filteredProjects}
            onProjectClick={(project) => setLocation(`/projects/${project.code}`)}
          />
        ) : (
          <div className="space-y-3">
            {canBulkReassignProjectOwner && selectedProjectIds.size > 0 && (
              <div
                className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-4 py-3"
                data-testid="bulk-project-actions"
              >
                <UsersIcon className="w-4 h-4 text-muted-foreground" />
                <Badge variant="default" className="text-xs">
                  {selectedProjectIds.size} selected
                </Badge>
                <span className="text-sm text-muted-foreground ml-1">Reassign</span>
                <Select
                  value={bulkRoleField}
                  onValueChange={(v) => setBulkRoleField(v as ProjectRoleField)}
                  disabled={bulkReassignProjectOwnerMutation.isPending}
                >
                  <SelectTrigger
                    className="h-8 w-[180px]"
                    data-testid="select-bulk-project-role"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_ROLE_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        data-testid={`option-bulk-project-role-${opt.value}`}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">to</span>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (!value) return;
                    const ids = Array.from(selectedProjectIds);
                    const userId = value === "__unassigned__" ? null : value;
                    bulkReassignProjectOwnerMutation.mutate({
                      projectIds: ids,
                      roleField: bulkRoleField,
                      userId,
                    });
                  }}
                  disabled={bulkReassignProjectOwnerMutation.isPending}
                >
                  <SelectTrigger
                    className="h-8 w-[220px]"
                    data-testid="select-bulk-project-user"
                  >
                    <SelectValue
                      placeholder={
                        bulkReassignProjectOwnerMutation.isPending
                          ? "Reassigning..."
                          : "Select user..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="__unassigned__"
                      data-testid="option-bulk-project-user-unassigned"
                    >
                      Unassigned
                    </SelectItem>
                    {user?.id && orgUsersForBulk.some((u) => u.id === user.id) && (
                      <SelectItem
                        value={user.id}
                        data-testid="option-bulk-project-user-mine"
                      >
                        Me ({bulkOwnerLabelById.get(user.id) ?? "current user"})
                      </SelectItem>
                    )}
                    {orgUsersForBulk
                      .filter((u) => u.id !== user?.id)
                      .map((u) => (
                        <SelectItem
                          key={u.id}
                          value={u.id}
                          data-testid={`option-bulk-project-user-${u.id}`}
                        >
                          {bulkOwnerLabelById.get(u.id) ?? u.id}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedProjectIds(new Set())}
                  data-testid="button-clear-project-selection"
                >
                  Clear
                </Button>
              </div>
            )}
            <ProjectsTable
              projects={filteredProjects}
              onRowClick={(project) => setLocation(`/projects/${project.code}`)}
              canDelete={canDelete}
              onDelete={handleDeleteProject}
              getRowProps={getProjectRowProps}
              selectable={canBulkReassignProjectOwner}
              selectedIds={selectedProjectIds}
              onToggleSelect={(id, checked) =>
                setSelectedProjectIds((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onToggleSelectAll={(checked) => {
                if (checked) {
                  setSelectedProjectIds(new Set(filteredProjects.map((p) => p.id)));
                } else {
                  setSelectedProjectIds(new Set());
                }
              }}
            />
          </div>
        )}
      </main>

      <Dialog open={showCreateDialog} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="sm:max-w-2xl"
          data-testid="dialog-create-project"
        >
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a new project directly. For projects from won bids, use the
              Bid Board to convert.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Downtown Office Renovation"
                        {...field}
                        data-testid="input-project-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator className="my-2" />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">CRM Integration</Label>
                  <span className="text-xs text-muted-foreground">
                    Select from CRM to auto-fill client info
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">GC / General Contractor</Label>
                    <CrmOrganizationSelector
                      value={selectedGcOrg?.id}
                      onSelect={handleGcSelect}
                      onContactSelect={handleGcContactSelect}
                      filterTypes={["CONTRACTOR"]}
                      placeholder="Select GC..."
                      showContactSelector={true}
                      selectedContactId={selectedGcContact?.id}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Owner Representative</Label>
                    <CrmOrganizationSelector
                      value={selectedOwnerRepOrg?.id}
                      onSelect={handleOwnerRepSelect}
                      onContactSelect={handleOwnerRepContactSelect}
                      filterTypes={["OWNER_REP"]}
                      placeholder="Select Owner Rep..."
                      showContactSelector={true}
                      selectedContactId={selectedOwnerRepContact?.id}
                    />
                  </div>
                </div>
              </div>

              <Separator className="my-2" />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Acme Corporation"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-client-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientContactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="John Smith"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contact-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="clientContactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="john@acme.com"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contact-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientContactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="(555) 123-4567"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contact-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
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
                          value={field.value || ""}
                          data-testid="input-budget"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contractAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Amount</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="275000.00"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contract-amount"
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
                        <Input
                          placeholder="123 Main St"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-address"
                        />
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
                        <Input
                          placeholder="Austin"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-city"
                        />
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
                        <Input
                          placeholder="TX"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-state"
                        />
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
                        placeholder="Brief description of the project scope..."
                        className="min-h-[80px]"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-description"
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
                  onClick={() => handleDialogOpenChange(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createProject.isPending}
                  data-testid="button-create-project"
                >
                  {createProject.isPending ? "Creating..." : "Create Project"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-project">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Delete Project
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete project{" "}
              <strong>{projectToDelete?.code}</strong> ({projectToDelete?.name}
              )?
              <br />
              <br />
              This action cannot be undone. All associated data including
              estimates, change orders, time entries, procurement items, and
              documents will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setProjectToDelete(null)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteProject.isPending ? "Deleting..." : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
