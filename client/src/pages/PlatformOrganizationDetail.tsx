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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Building2, Users, Mail, Calendar, Globe, MapPin, Briefcase, Pencil, Activity, ChevronRight } from "lucide-react";
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
      <main className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/organizations">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to Organizations
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-org-name">{organization.name}</h1>
            <p className="text-muted-foreground">{organization.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={openEditDialog} data-testid="button-edit-org">
            <Pencil className="h-4 w-4 mr-2" />
            Edit Organization
          </Button>
          {getStatusBadge(organization.onboardingStatus)}
          <Badge variant="outline">
            {tradeTypeLabels[organization.tradeType] || organization.tradeType}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
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
        <TabsList>
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
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>Organization Users</CardTitle>
              <CardDescription>All users belonging to this organization</CardDescription>
            </CardHeader>
            <CardContent>
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
        </Tabs>

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
