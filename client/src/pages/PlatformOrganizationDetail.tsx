import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Building2, Users, Mail, Calendar, Globe, MapPin, Briefcase, Pencil, Activity, ChevronRight, Database, FolderKanban, FileText, Hammer, ClipboardList, ListChecks, Wrench, Share2, ScrollText, Image, CalendarDays, DollarSign, ShieldOff, ShieldCheck, Download, Trash2, Gavel, HardHat } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Organization {
  id: string;
  name: string;
  slug: string;
  tradeType: string;
  tradeName: string | null;
  onboardingStatus: string;
  isActive: boolean;
  region: string | null;
  typicalCrewSize: number | null;
  websiteUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  createdAt: string;
  userCount: number;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  organizationId: string | null;
}

interface SowItem {
  id: string;
  name: string;
  categoryName: string;
  code: string;
  unit: string | null;
  isActive: boolean;
}

interface WorkType {
  id: string;
  name: string;
  unit: string;
  defaultProductionRate: string | null;
  isActive: boolean;
}

interface DbUsageMetrics {
  users: number;
  projects: number;
  bids: number;
  estimates: number;
  changeOrders: number;
  tasks: number;
  equipment: number;
  socialPosts: number;
  auditEntries: number;
  documents: number;
  sowItems: number;
  workTypes: number;
  payRuns: number;
  calendarEvents: number;
}

const tradeTypeOptions = [
  { value: "GENERAL_CONTRACTOR", label: "General Contractor" },
  { value: "ROOFING", label: "Roofing" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "PLUMBING", label: "Plumbing" },
  { value: "HVAC", label: "HVAC" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "CARPENTRY", label: "Carpentry" },
  { value: "MASONRY", label: "Masonry" },
  { value: "DRYWALL", label: "Drywall" },
  { value: "PAINTING", label: "Painting" },
  { value: "FLOORING", label: "Flooring" },
  { value: "LANDSCAPING", label: "Landscaping" },
  { value: "EARTHWORK", label: "Earthwork" },
  { value: "DEMOLITION", label: "Demolition" },
  { value: "STEEL_ERECTION", label: "Steel Erection" },
  { value: "GLAZING", label: "Glazing" },
  { value: "INSULATION", label: "Insulation" },
  { value: "FIRE_PROTECTION", label: "Fire Protection" },
  { value: "WATERPROOFING", label: "Waterproofing" },
  { value: "LOW_VOLTAGE", label: "Low Voltage" },
  { value: "SOLAR", label: "Solar" },
  { value: "OTHER", label: "Other" },
];

const onboardingStatusOptions = [
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
];

export default function PlatformOrganizationDetail() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    tradeType: "",
    region: "",
    typicalCrewSize: "",
    onboardingStatus: "",
    phone: "",
    email: "",
    websiteUrl: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
  });

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const organization = organizations?.find((org) => org.id === orgId);

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/platform/users"],
  });

  const orgUsers = allUsers?.filter((u) => u.organizationId === orgId) || [];

  const { data: sowItems, isLoading: sowLoading } = useQuery<SowItem[]>({
    queryKey: ["/api/platform/organizations", orgId, "sow-items"],
    enabled: !!orgId,
  });

  const { data: workTypes, isLoading: workTypesLoading } = useQuery<WorkType[]>({
    queryKey: ["/api/platform/organizations", orgId, "work-types"],
    enabled: !!orgId,
  });

  const { data: dbUsage, isLoading: dbUsageLoading } = useQuery<DbUsageMetrics>({
    queryKey: ["/api/platform/organizations", orgId, "db-usage"],
    queryFn: async () => {
      const res = await fetch(`/api/platform/organizations/${orgId}/db-usage`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch database usage");
      return res.json();
    },
    enabled: !!orgId,
  });

  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: orgProjects, isLoading: projectsLoading } = useQuery<any[]>({
    queryKey: ["/api/platform/organizations", orgId, "projects"],
    enabled: !!orgId,
  });

  const { data: orgBids, isLoading: bidsLoading } = useQuery<any[]>({
    queryKey: ["/api/platform/organizations", orgId, "bids"],
    enabled: !!orgId,
  });

  const { data: orgContracts, isLoading: contractsLoading } = useQuery<any[]>({
    queryKey: ["/api/platform/organizations", orgId, "contracts"],
    enabled: !!orgId,
  });

  const { data: orgEquipment, isLoading: equipmentLoading } = useQuery<any[]>({
    queryKey: ["/api/platform/organizations", orgId, "equipment"],
    enabled: !!orgId,
  });

  const { data: orgFinancials, isLoading: financialsLoading } = useQuery<any>({
    queryKey: ["/api/platform/organizations", orgId, "financials"],
    enabled: !!orgId,
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/platform/organizations/${orgId}/export`, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-export-${orgId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast({ title: "Export downloaded" }),
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (confirmationName: string) => {
      const res = await apiRequest("POST", `/api/platform/organizations/${orgId}/delete-all-data`, { confirmationName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      toast({ title: "Organization data deleted", description: "All data has been permanently removed." });
      setDeleteDialogOpen(false);
      window.location.href = "/admin/organizations";
    },
    onError: (e: Error) => toast({ title: "Deletion failed", description: e.message, variant: "destructive" }),
  });

  const [activityPage, setActivityPage] = useState(1);
  const { data: activityData, isLoading: activityLoading } = useQuery<{
    entries: Array<{
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      createdAt: string;
      userName: string;
      userEmail: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ["/api/platform/organizations", orgId, "activity", activityPage],
    queryFn: async () => {
      const res = await fetch(`/api/platform/organizations/${orgId}/activity?page=${activityPage}&limit=50`);
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
    enabled: !!orgId,
  });

  const updateOrgMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/platform/organizations/${orgId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      setEditOpen(false);
      toast({ title: "Organization updated", description: "Changes saved successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const suspendOrgMutation = useMutation({
    mutationFn: async () => {
      const action = organization?.isActive ? "suspend" : "reactivate";
      const res = await apiRequest("POST", `/api/platform/organizations/${orgId}/suspend`, { action });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      toast({ title: data.organization.isActive ? "Organization Reactivated" : "Organization Suspended", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Action failed", description: error.message, variant: "destructive" });
    },
  });

  const openEditDialog = () => {
    if (!organization) return;
    setEditForm({
      name: organization.name || "",
      tradeType: organization.tradeType || "GENERAL_CONTRACTOR",
      region: organization.region || "",
      typicalCrewSize: organization.typicalCrewSize?.toString() || "",
      onboardingStatus: organization.onboardingStatus || "NOT_STARTED",
      phone: organization.phone || "",
      email: organization.email || "",
      websiteUrl: organization.websiteUrl || "",
      address: organization.address || "",
      city: organization.city || "",
      state: organization.state || "",
      zipCode: organization.zipCode || "",
    });
    setEditOpen(true);
  };

  const handleEditSubmit = () => {
    const payload: Record<string, unknown> = {
      name: editForm.name,
      tradeType: editForm.tradeType,
      region: editForm.region || null,
      typicalCrewSize: editForm.typicalCrewSize ? parseInt(editForm.typicalCrewSize) : null,
      onboardingStatus: editForm.onboardingStatus,
      phone: editForm.phone || null,
      email: editForm.email || null,
      websiteUrl: editForm.websiteUrl || null,
      address: editForm.address || null,
      city: editForm.city || null,
      state: editForm.state || null,
      zipCode: editForm.zipCode || null,
    };
    updateOrgMutation.mutate(payload);
  };

  const tradeTypeLabels: Record<string, string> = {};
  for (const opt of tradeTypeOptions) {
    tradeTypeLabels[opt.value] = opt.label;
  }

  const roleLabels: Record<string, string> = {
    ADMIN: "Admin",
    MANAGER: "Manager",
    SUPERINTENDENT: "Superintendent",
    ESTIMATOR: "Estimator",
    OFFICE_MANAGER: "Office Manager",
    HOURLY_EMPLOYEE: "Hourly Employee",
    MAINTENANCE_MANAGER: "Maintenance Manager",
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge variant="default">Active</Badge>;
      case "IN_PROGRESS":
        return <Badge variant="secondary">Onboarding</Badge>;
      default:
        return <Badge variant="outline">Not Started</Badge>;
    }
  };

  if (!organization) {
    return (
      <div className="min-h-screen bg-background">
        <main className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/organizations">
              <Button variant="ghost" size="sm">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
          </div>
          <Card>
            <CardContent className="p-8">
              <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
                <div className="grid gap-4 md:grid-cols-3 mt-6">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/organizations">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Back to Organizations</span>
              <span className="sm:hidden">Back</span>
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-org-name">{organization.name}</h1>
            <p className="text-muted-foreground text-sm">{organization.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} data-testid="button-export-org">
            <Download className="h-4 w-4 mr-2" />
            {exportMutation.isPending ? "Exporting..." : "Export Data"}
          </Button>
          <Button variant="destructive" onClick={() => { setDeleteConfirmName(""); setDeleteDialogOpen(true); }} data-testid="button-delete-org">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete All Data
          </Button>
          <Button variant="outline" onClick={openEditDialog} data-testid="button-edit-org">
            <Pencil className="h-4 w-4 mr-2" />
            Edit Organization
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant={organization.isActive ? "outline" : "default"}
                data-testid="button-toggle-suspend"
                disabled={suspendOrgMutation.isPending}
                className={organization.isActive ? "text-destructive border-destructive/50 hover:bg-destructive/10" : ""}
              >
                {organization.isActive ? (
                  <><ShieldOff className="h-4 w-4 mr-2" /> Suspend</>
                ) : (
                  <><ShieldCheck className="h-4 w-4 mr-2" /> Reactivate</>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {organization.isActive ? "Suspend Organization" : "Reactivate Organization"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {organization.isActive
                    ? `Are you sure you want to suspend "${organization.name}"? All users in this organization will be immediately blocked from logging in and will see a suspended message.`
                    : `Are you sure you want to reactivate "${organization.name}"? All users will regain access to the platform.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => suspendOrgMutation.mutate()}
                  className={organization.isActive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                  data-testid="button-confirm-suspend"
                >
                  {organization.isActive ? "Suspend Organization" : "Reactivate Organization"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {!organization.isActive && (
            <Badge variant="destructive" data-testid="badge-suspended">Suspended</Badge>
          )}
          {getStatusBadge(organization.onboardingStatus)}
          <Badge variant="outline">
            {tradeTypeLabels[organization.tradeType] || organization.tradeType}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{organization.userCount}</div>
            <p className="text-xs text-muted-foreground">Total users</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Region</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{organization.region || "-"}</div>
            <p className="text-xs text-muted-foreground">Service area</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Crew Size</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{organization.typicalCrewSize || "-"}</div>
            <p className="text-xs text-muted-foreground">Typical crew</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Created</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {format(new Date(organization.createdAt), "MMM d, yyyy")}
            </div>
            <p className="text-xs text-muted-foreground">Registration date</p>
          </CardContent>
        </Card>
      </div>

      {organization.websiteUrl && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Website
            </CardTitle>
          </CardHeader>
          <CardContent>
            <a
              href={organization.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {organization.websiteUrl}
            </a>
            {(organization.primaryColor || organization.secondaryColor || organization.accentColor) && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">Brand Colors:</span>
                {organization.primaryColor && (
                  <div
                    className="w-6 h-6 rounded border"
                    style={{ backgroundColor: organization.primaryColor }}
                    title={`Primary: ${organization.primaryColor}`}
                  />
                )}
                {organization.secondaryColor && (
                  <div
                    className="w-6 h-6 rounded border"
                    style={{ backgroundColor: organization.secondaryColor }}
                    title={`Secondary: ${organization.secondaryColor}`}
                  />
                )}
                {organization.accentColor && (
                  <div
                    className="w-6 h-6 rounded border"
                    style={{ backgroundColor: organization.accentColor }}
                    title={`Accent: ${organization.accentColor}`}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="users" className="space-y-4">
        <div className="overflow-x-auto -mx-3 sm:-mx-6 px-3 sm:px-6">
        <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
          <TabsTrigger value="users" data-testid="tab-org-users">
            <Users className="h-4 w-4 mr-2" />
            Users ({orgUsers.length})
          </TabsTrigger>
          <TabsTrigger value="sow" data-testid="tab-org-sow">
            SOW Items ({sowItems?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="worktypes" data-testid="tab-org-worktypes">
            Work Types ({workTypes?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-org-activity">
            <Activity className="h-4 w-4 mr-2" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="db-usage" data-testid="tab-org-db-usage">
            <Database className="h-4 w-4 mr-2" />
            DB Usage
          </TabsTrigger>
          <TabsTrigger value="projects" data-testid="tab-org-projects">
            <FolderKanban className="h-4 w-4 mr-2" />
            Projects
          </TabsTrigger>
          <TabsTrigger value="bids" data-testid="tab-org-bids">
            <FileText className="h-4 w-4 mr-2" />
            Bids
          </TabsTrigger>
          <TabsTrigger value="contracts" data-testid="tab-org-contracts">
            <Gavel className="h-4 w-4 mr-2" />
            Contracts
          </TabsTrigger>
          <TabsTrigger value="equipment" data-testid="tab-org-equipment">
            <HardHat className="h-4 w-4 mr-2" />
            Equipment
          </TabsTrigger>
          <TabsTrigger value="financials" data-testid="tab-org-financials">
            <DollarSign className="h-4 w-4 mr-2" />
            Financials
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>Organization Users</CardTitle>
              <CardDescription>All users belonging to this organization</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgUsers.map((u) => (
                    <TableRow key={u.id} data-testid={`row-org-user-${u.id}`}>
                      <TableCell className="font-medium">
                        {u.firstName} {u.lastName}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          {u.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {roleLabels[u.role] || u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? "default" : "destructive"}>
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(u.createdAt), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                  {orgUsers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No users in this organization
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sow">
          <Card>
            <CardHeader>
              <CardTitle>Scope of Work Items</CardTitle>
              <CardDescription>SOW items configured for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {sowLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sowItems?.map((item) => (
                      <TableRow key={item.id} data-testid={`row-org-sow-${item.id}`}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.categoryName}</TableCell>
                        <TableCell className="font-mono">{item.code}</TableCell>
                        <TableCell>{item.unit || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={item.isActive ? "default" : "secondary"}>
                            {item.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!sowItems || sowItems.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No SOW items configured
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="worktypes">
          <Card>
            <CardHeader>
              <CardTitle>Work Types</CardTitle>
              <CardDescription>Work types configured for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {workTypesLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Production Rate</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workTypes?.map((type) => (
                      <TableRow key={type.id} data-testid={`row-org-worktype-${type.id}`}>
                        <TableCell className="font-medium">{type.name}</TableCell>
                        <TableCell>{type.unit}</TableCell>
                        <TableCell>{type.defaultProductionRate || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={type.isActive ? "default" : "secondary"}>
                            {type.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!workTypes || workTypes.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No work types configured
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <CardTitle>Organization Activity</CardTitle>
                <CardDescription>Recent audit log entries for users in this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {activityLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : !activityData?.entries?.length ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-activity">
                    No activity recorded for this organization
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Entity Type</TableHead>
                          <TableHead>Entity ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activityData.entries.map((entry) => (
                          <TableRow key={entry.id} data-testid={`row-activity-${entry.id}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                            </TableCell>
                            <TableCell className="font-medium">{entry.userName}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" data-testid={`badge-action-${entry.id}`}>{entry.action}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{entry.entityType}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{entry.entityId || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                    {activityData.total > activityData.limit && (
                      <div className="flex items-center justify-between mt-4">
                        <span className="text-xs text-muted-foreground" data-testid="text-activity-pagination">
                          Page {activityData.page} of {Math.ceil(activityData.total / activityData.limit)} ({activityData.total} entries)
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={activityPage <= 1}
                            onClick={() => setActivityPage(p => p - 1)}
                            data-testid="button-activity-prev"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={activityPage >= Math.ceil(activityData.total / activityData.limit)}
                            onClick={() => setActivityPage(p => p + 1)}
                            data-testid="button-activity-next"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="db-usage">
            <Card>
              <CardHeader>
                <CardTitle>Database Usage Metrics</CardTitle>
                <CardDescription>Record counts across all tables for this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {dbUsageLoading ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <Skeleton key={i} className="h-24 rounded-lg" />
                    ))}
                  </div>
                ) : dbUsage ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {[
                        { label: "Users", value: dbUsage.users, icon: Users, color: "text-blue-500" },
                        { label: "Projects", value: dbUsage.projects, icon: FolderKanban, color: "text-green-500" },
                        { label: "Bids", value: dbUsage.bids, icon: FileText, color: "text-orange-500" },
                        { label: "Estimates", value: dbUsage.estimates, icon: ClipboardList, color: "text-purple-500" },
                        { label: "Change Orders", value: dbUsage.changeOrders, icon: Hammer, color: "text-red-500" },
                        { label: "Tasks", value: dbUsage.tasks, icon: ListChecks, color: "text-cyan-500" },
                        { label: "Equipment", value: dbUsage.equipment, icon: Wrench, color: "text-amber-500" },
                        { label: "Documents", value: dbUsage.documents, icon: Image, color: "text-pink-500" },
                        { label: "SOW Items", value: dbUsage.sowItems, icon: ClipboardList, color: "text-indigo-500" },
                        { label: "Work Types", value: dbUsage.workTypes, icon: Briefcase, color: "text-teal-500" },
                        { label: "Social Posts", value: dbUsage.socialPosts, icon: Share2, color: "text-violet-500" },
                        { label: "Pay Runs", value: dbUsage.payRuns, icon: DollarSign, color: "text-emerald-500" },
                        { label: "Calendar Events", value: dbUsage.calendarEvents, icon: CalendarDays, color: "text-sky-500" },
                        { label: "Audit Entries", value: dbUsage.auditEntries, icon: ScrollText, color: "text-slate-500" },
                      ].map(({ label, value, icon: Icon, color }) => (
                        <div
                          key={label}
                          className="flex items-center gap-3 p-4 rounded-lg border bg-card"
                          data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <div className={`p-2 rounded-md bg-muted ${color}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-2xl font-bold">{value.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">{label}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 p-4 rounded-lg border bg-muted/50">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Total Records</span>
                        <span className="text-lg font-bold" data-testid="text-total-records">
                          {Object.values(dbUsage).reduce((sum, val) => sum + val, 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Failed to load database usage metrics</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projects">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="h-5 w-5" />
                  Projects (Read-Only)
                </CardTitle>
                <CardDescription>All projects associated with this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {projectsLoading ? <Skeleton className="h-40 w-full" /> : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Contract Amount</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgProjects?.map((p: any) => (
                        <TableRow key={p.id} data-testid={`row-org-project-${p.id}`}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                          <TableCell>{p.clientName || "-"}</TableCell>
                          <TableCell>{p.contractAmount ? `$${Number(p.contractAmount).toLocaleString()}` : "-"}</TableCell>
                          <TableCell>{p.createdAt ? format(new Date(p.createdAt), "MMM d, yyyy") : "-"}</TableCell>
                        </TableRow>
                      ))}
                      {(!orgProjects || orgProjects.length === 0) && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No projects found</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bids">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Bids (Read-Only)
                </CardTitle>
                <CardDescription>All bids associated with this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {bidsLoading ? <Skeleton className="h-40 w-full" /> : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Bid Amount</TableHead>
                        <TableHead>Bid Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgBids?.map((b: any) => (
                        <TableRow key={b.id} data-testid={`row-org-bid-${b.id}`}>
                          <TableCell className="font-medium">{b.projectName}</TableCell>
                          <TableCell><Badge variant="secondary">{b.status}</Badge></TableCell>
                          <TableCell>{b.clientName || "-"}</TableCell>
                          <TableCell>{b.bidAmount ? `$${Number(b.bidAmount).toLocaleString()}` : "-"}</TableCell>
                          <TableCell>{b.bidDate ? format(new Date(b.bidDate), "MMM d, yyyy") : "-"}</TableCell>
                        </TableRow>
                      ))}
                      {(!orgBids || orgBids.length === 0) && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No bids found</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contracts">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gavel className="h-5 w-5" />
                  Contracts (Read-Only)
                </CardTitle>
                <CardDescription>All contracts associated with this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {contractsLoading ? <Skeleton className="h-40 w-full" /> : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Effective Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgContracts?.map((c: any) => (
                        <TableRow key={c.id} data-testid={`row-org-contract-${c.id}`}>
                          <TableCell className="font-mono font-medium">{c.contractNumber || "-"}</TableCell>
                          <TableCell>{c.contractType || "-"}</TableCell>
                          <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                          <TableCell>{c.contractValue ? `$${Number(c.contractValue).toLocaleString()}` : "-"}</TableCell>
                          <TableCell>{c.effectiveDate ? format(new Date(c.effectiveDate), "MMM d, yyyy") : "-"}</TableCell>
                        </TableRow>
                      ))}
                      {(!orgContracts || orgContracts.length === 0) && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No contracts found</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="equipment">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardHat className="h-5 w-5" />
                  Equipment (Read-Only)
                </CardTitle>
                <CardDescription>All equipment registered to this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {equipmentLoading ? <Skeleton className="h-40 w-full" /> : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Make / Model</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgEquipment?.map((e: any) => (
                        <TableRow key={e.id} data-testid={`row-org-equipment-${e.id}`}>
                          <TableCell className="font-medium">{e.name}</TableCell>
                          <TableCell className="font-mono">{e.equipmentCode || "-"}</TableCell>
                          <TableCell>{e.type || "-"}</TableCell>
                          <TableCell><Badge variant="secondary">{e.status}</Badge></TableCell>
                          <TableCell>{[e.make, e.model].filter(Boolean).join(" ") || "-"}</TableCell>
                        </TableRow>
                      ))}
                      {(!orgEquipment || orgEquipment.length === 0) && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No equipment found</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financials">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Financial Summary (Read-Only)
                </CardTitle>
                <CardDescription>High-level financial overview for this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {financialsLoading ? <Skeleton className="h-40 w-full" /> : orgFinancials ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                    <div className="p-4 rounded-lg border bg-card" data-testid="metric-total-contract-value">
                      <div className="text-2xl font-bold">${Number(orgFinancials.totalContractValue || 0).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Total Contract Value</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-card" data-testid="metric-total-budget">
                      <div className="text-2xl font-bold">${Number(orgFinancials.totalBudget || 0).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Total Budget</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-card" data-testid="metric-project-count">
                      <div className="text-2xl font-bold">{orgFinancials.projectCount}</div>
                      <div className="text-xs text-muted-foreground">Projects</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-card" data-testid="metric-total-bid-value">
                      <div className="text-2xl font-bold">${Number(orgFinancials.totalBidValue || 0).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Total Bid Value</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-card" data-testid="metric-bid-count">
                      <div className="text-2xl font-bold">{orgFinancials.bidCount}</div>
                      <div className="text-xs text-muted-foreground">Bids</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-card" data-testid="metric-payroll-runs">
                      <div className="text-2xl font-bold">{orgFinancials.payrollRuns}</div>
                      <div className="text-xs text-muted-foreground">Payroll Runs</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Failed to load financial data</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">Delete All Organization Data</DialogTitle>
              <DialogDescription>
                This action is irreversible. All users, projects, bids, tasks, equipment, and associated data for <strong>{organization.name}</strong> will be permanently deleted.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Type the organization name to confirm:</Label>
                <Input
                  value={deleteConfirmName}
                  onChange={e => setDeleteConfirmName(e.target.value)}
                  placeholder={organization.name}
                  data-testid="input-delete-confirm-name"
                />
              </div>
              {deleteConfirmName && deleteConfirmName !== organization.name && (
                <p className="text-sm text-destructive">Name does not match</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteConfirmName !== organization.name || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteConfirmName)}
                data-testid="button-confirm-delete-org"
              >
                {deleteMutation.isPending ? "Deleting..." : "Permanently Delete All Data"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Organization</DialogTitle>
              <DialogDescription>Update organization details below.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Organization Name</Label>
                <Input
                  id="edit-name"
                  data-testid="input-edit-org-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-tradeType">Trade Type</Label>
                  <Select
                    value={editForm.tradeType}
                    onValueChange={(val) => setEditForm((prev) => ({ ...prev, tradeType: val }))}
                  >
                    <SelectTrigger data-testid="select-edit-org-trade">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tradeTypeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-onboardingStatus">Onboarding Status</Label>
                  <Select
                    value={editForm.onboardingStatus}
                    onValueChange={(val) => setEditForm((prev) => ({ ...prev, onboardingStatus: val }))}
                  >
                    <SelectTrigger data-testid="select-edit-org-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {onboardingStatusOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-region">Region</Label>
                  <Input
                    id="edit-region"
                    data-testid="input-edit-org-region"
                    value={editForm.region}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, region: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-crewSize">Typical Crew Size</Label>
                  <Input
                    id="edit-crewSize"
                    data-testid="input-edit-org-crew-size"
                    type="number"
                    value={editForm.typicalCrewSize}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, typicalCrewSize: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    data-testid="input-edit-org-phone"
                    value={editForm.phone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    data-testid="input-edit-org-email"
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-websiteUrl">Website URL</Label>
                <Input
                  id="edit-websiteUrl"
                  data-testid="input-edit-org-website"
                  value={editForm.websiteUrl}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, websiteUrl: e.target.value }))}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-address">Address</Label>
                <Input
                  id="edit-address"
                  data-testid="input-edit-org-address"
                  value={editForm.address}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-city">City</Label>
                  <Input
                    id="edit-city"
                    data-testid="input-edit-org-city"
                    value={editForm.city}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-state">State</Label>
                  <Input
                    id="edit-state"
                    data-testid="input-edit-org-state"
                    value={editForm.state}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, state: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-zip">Zip Code</Label>
                  <Input
                    id="edit-zip"
                    data-testid="input-edit-org-zip"
                    value={editForm.zipCode}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, zipCode: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-edit-org-cancel">
                Cancel
              </Button>
              <Button
                onClick={handleEditSubmit}
                disabled={!editForm.name || updateOrgMutation.isPending}
                data-testid="button-edit-org-save"
              >
                {updateOrgMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
