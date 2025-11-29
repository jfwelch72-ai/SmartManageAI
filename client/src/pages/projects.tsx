import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import ProjectsTable from "@/components/ProjectsTable";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
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
import { Search, Plus, X, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProjects, useCreateProject, useDeleteProject } from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { FeaturePermissions, getAllowedProjectStatuses, canViewProjectStatus } from "@/lib/rbac";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProjectSchema } from "@shared/schema";
import type { CrmOrganisation, CrmContact } from "@shared/schema";
import { z } from "zod";

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const allowedStatuses = getAllowedProjectStatuses(user?.role);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [specialFilter, setSpecialFilter] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  
  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ code: string; name: string } | null>(null);
  
  // CRM organization state for project creation
  const [selectedGcOrg, setSelectedGcOrg] = useState<CrmOrganisation | null>(null);
  const [selectedGcContact, setSelectedGcContact] = useState<CrmContact | null>(null);
  const [selectedOwnerRepOrg, setSelectedOwnerRepOrg] = useState<CrmOrganisation | null>(null);
  const [selectedOwnerRepContact, setSelectedOwnerRepContact] = useState<CrmContact | null>(null);
  
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
    if (statusParam && ["ACTIVE", "PLANNING", "COMPLETE", "CLOSED"].includes(statusParam)) {
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
      form.setValue("clientContactPhone", contact.phone || contact.mobile || "");
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

  // Fetch projects with pending change orders (only when needed)
  const { data: projectsWithPendingCOs = [] } = useQuery<string[]>({
    queryKey: ["/api/projects/with-pending-change-orders"],
    enabled: specialFilter === "pendingChangeOrders",
  });

  const filteredProjects = projects.filter(project => {
    const matchesSearch = 
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (project.clientName && project.clientName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = statusFilter === "ALL" || project.status === statusFilter;
    
    // Filter by allowed project statuses based on role
    const isAllowedStatus = canViewProjectStatus(user?.role, project.status);
    
    // Handle special filters
    let matchesSpecialFilter = true;
    if (specialFilter === "pendingChangeOrders") {
      matchesSpecialFilter = projectsWithPendingCOs.includes(project.id);
    } else if (specialFilter === "missingBudget") {
      const budgetNum = Number(project.budget);
      matchesSpecialFilter = !project.budget || isNaN(budgetNum) || budgetNum <= 0;
    }
    
    return matchesSearch && matchesStatus && isAllowedStatus && matchesSpecialFilter;
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              {specialFilter === "pendingChangeOrders" ? "Projects with Pending Change Orders" :
               specialFilter === "missingBudget" ? "Projects Missing Budget Data" : 
               statusFilter !== "ALL" ? `${statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase()} Projects` :
               "All Projects"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {specialFilter === "pendingChangeOrders" ? "Projects with change orders awaiting client response" :
               specialFilter === "missingBudget" ? "Projects that need budget information added" :
               "View and manage all awarded construction projects"}
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
                    {specialFilter === "pendingChangeOrders" ? "Pending COs" : "Missing Budget"}
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
          {FeaturePermissions.CREATE_PROJECT(user?.role) && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLocation('/bids')} data-testid="button-view-bids">
                View Bids
              </Button>
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-project">
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search projects by name, code, or client..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {allowedStatuses.includes("PLANNING") && <SelectItem value="PLANNING">Planning</SelectItem>}
              {allowedStatuses.includes("ACTIVE") && <SelectItem value="ACTIVE">Active</SelectItem>}
              {allowedStatuses.includes("COMPLETE") && <SelectItem value="COMPLETE">Complete</SelectItem>}
              {allowedStatuses.includes("CLOSED") && <SelectItem value="CLOSED">Closed</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading projects...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchTerm || statusFilter !== "ALL" ? "No projects match your filters" : "No projects yet"}
          </div>
        ) : (
          <ProjectsTable
            projects={filteredProjects}
            onRowClick={(project) => setLocation(`/projects/${project.code}`)}
            canDelete={canDelete}
            onDelete={handleDeleteProject}
          />
        )}
      </main>

      <Dialog open={showCreateDialog} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-project">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a new project directly. For projects from won bids, use the Bid Board to convert.
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
                      <Input placeholder="Downtown Office Renovation" {...field} data-testid="input-project-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator className="my-2" />
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">CRM Integration</Label>
                  <span className="text-xs text-muted-foreground">Select from CRM to auto-fill client info</span>
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
                        <Input placeholder="Acme Corporation" {...field} value={field.value || ""} data-testid="input-client-name" />
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
                        <Input placeholder="John Smith" {...field} value={field.value || ""} data-testid="input-contact-name" />
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
                        <Input type="email" placeholder="john@acme.com" {...field} value={field.value || ""} data-testid="input-contact-email" />
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
                        <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} data-testid="input-contact-phone" />
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
                        <Input type="number" step="0.01" placeholder="250000.00" {...field} value={field.value || ""} data-testid="input-budget" />
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
                        <Input type="number" step="0.01" placeholder="275000.00" {...field} value={field.value || ""} data-testid="input-contract-amount" />
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
                        <Input placeholder="123 Main St" {...field} value={field.value || ""} data-testid="input-address" />
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
                        <Input placeholder="Austin" {...field} value={field.value || ""} data-testid="input-city" />
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
                        <Input placeholder="TX" {...field} value={field.value || ""} data-testid="input-state" />
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
                <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)} data-testid="button-cancel">
                  Cancel
                </Button>
                <Button type="submit" disabled={createProject.isPending} data-testid="button-create-project">
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
              Are you sure you want to delete project <strong>{projectToDelete?.code}</strong> ({projectToDelete?.name})?
              <br /><br />
              This action cannot be undone. All associated data including estimates, change orders, time entries, procurement items, and documents will also be deleted.
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
