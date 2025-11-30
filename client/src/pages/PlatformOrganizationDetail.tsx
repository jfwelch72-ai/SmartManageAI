import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Building2, Users, Mail, Calendar, Globe, MapPin, Briefcase } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

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

export default function PlatformOrganizationDetail() {
  const { user, logout, organizationName } = useAuth();
  const params = useParams<{ id: string }>();
  const orgId = params.id;

  const userName = user ? `${user.firstName} ${user.lastName}` : "Admin";
  const userRole = user?.role || "SUPER_ADMIN";

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const organization = organizations?.find((org) => org.id === orgId);

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/platform/users"],
  });

  const orgUsers = allUsers?.filter((user) => user.organizationId === orgId) || [];

  const { data: sowItems, isLoading: sowLoading } = useQuery<SowItem[]>({
    queryKey: ["/api/platform/organizations", orgId, "sow-items"],
    enabled: !!orgId,
  });

  const { data: workTypes, isLoading: workTypesLoading } = useQuery<WorkType[]>({
    queryKey: ["/api/platform/organizations", orgId, "work-types"],
    enabled: !!orgId,
  });

  const tradeTypeLabels: Record<string, string> = {
    GENERAL_CONTRACTOR: "General Contractor",
    ROOFING: "Roofing",
    ELECTRICAL: "Electrical",
    PLUMBING: "Plumbing",
    HVAC: "HVAC",
    CONCRETE: "Concrete",
    CARPENTRY: "Carpentry",
    MASONRY: "Masonry",
    DRYWALL: "Drywall",
    PAINTING: "Painting",
    FLOORING: "Flooring",
    LANDSCAPING: "Landscaping",
    EXCAVATION: "Excavation",
    DEMOLITION: "Demolition",
    STEEL_ERECTION: "Steel Erection",
    GLAZING: "Glazing",
    INSULATION: "Insulation",
    FIRE_PROTECTION: "Fire Protection",
    WATERPROOFING: "Waterproofing",
    OTHER: "Other",
  };

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

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-org-name">{organization.name}</h1>
            <p className="text-muted-foreground">{organization.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
                  {orgUsers.map((user) => (
                    <TableRow key={user.id} data-testid={`row-org-user-${user.id}`}>
                      <TableCell className="font-medium">
                        {user.firstName} {user.lastName}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          {user.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {roleLabels[user.role] || user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? "default" : "destructive"}>
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(user.createdAt), "MMM d, yyyy")}
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
        </Tabs>
      </main>
    </div>
  );
}
