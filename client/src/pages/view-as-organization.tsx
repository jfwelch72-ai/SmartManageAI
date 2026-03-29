import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  Building2,
  Users,
  Briefcase,
  FolderKanban,
  DollarSign,
  Wrench,
  Eye,
  ShieldCheck,
  Calendar,
} from "lucide-react";

interface OrgDashboardData {
  organization: {
    id: string;
    name: string;
    slug: string;
    tradeType: string;
    isActive: boolean;
    region: string | null;
    createdAt: string;
  };
  stats: {
    userCount: number;
    projectCount: number;
    bidCount: number;
    activeProjects: number;
    completedProjects: number;
    totalEquipment: number;
    totalTasks: number;
  };
  recentProjects: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
  }>;
  recentBids: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
  }>;
  users: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    isActive: boolean;
  }>;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "ACTIVE" ? "default" : status === "COMPLETE" ? "secondary" : "outline";
  return <Badge variant={variant} className="text-xs">{status}</Badge>;
}

export default function ViewAsOrganization() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;

  const { data, isLoading } = useQuery<OrgDashboardData>({
    queryKey: ["/api/platform/organizations", orgId, "view-dashboard"],
    queryFn: async () => {
      const res = await fetch(`/api/platform/organizations/${orgId}/view-dashboard`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load organization dashboard");
      return res.json();
    },
    enabled: !!orgId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="container mx-auto space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">Organization not found</p>
          <Link href="/admin/organizations">
            <Button variant="outline" data-testid="button-back-orgs">Back to Organizations</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="view-as-org-page">
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Link href={`/admin/organizations/${orgId}`}>
              <Button variant="ghost" size="sm" data-testid="button-back-org-detail">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Org Detail
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-amber-600" />
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                READ-ONLY VIEW
              </Badge>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground mt-2" data-testid="text-view-as-org-title">
            {data.organization.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            Viewing organization data for support purposes — no edit capabilities
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-org-user-count">{data.stats.userCount}</div>
              <p className="text-xs text-muted-foreground">Team members</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Projects</CardTitle>
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-org-project-count">{data.stats.projectCount}</div>
              <p className="text-xs text-muted-foreground">
                {data.stats.activeProjects} active · {data.stats.completedProjects} completed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bids</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-org-bid-count">{data.stats.bidCount}</div>
              <p className="text-xs text-muted-foreground">Total bids</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Equipment</CardTitle>
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-org-equipment-count">{data.stats.totalEquipment}</div>
              <p className="text-xs text-muted-foreground">Equipment items</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="projects" className="w-full">
          <TabsList className="mb-4" data-testid="tabs-org-view">
            <TabsTrigger value="projects" data-testid="tab-projects">Projects</TabsTrigger>
            <TabsTrigger value="bids" data-testid="tab-bids">Bids</TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          </TabsList>

          <TabsContent value="projects">
            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
                <CardDescription>Organization's projects (read-only)</CardDescription>
              </CardHeader>
              <CardContent>
                {data.recentProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No projects found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentProjects.map(project => (
                        <TableRow key={project.id} data-testid={`row-project-${project.id}`}>
                          <TableCell className="font-medium">{project.name}</TableCell>
                          <TableCell><StatusBadge status={project.status} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(project.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bids">
            <Card>
              <CardHeader>
                <CardTitle>Bids</CardTitle>
                <CardDescription>Organization's bids (read-only)</CardDescription>
              </CardHeader>
              <CardContent>
                {data.recentBids.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No bids found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bid Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentBids.map(bid => (
                        <TableRow key={bid.id} data-testid={`row-bid-${bid.id}`}>
                          <TableCell className="font-medium">{bid.name}</TableCell>
                          <TableCell><StatusBadge status={bid.status} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(bid.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>Organization's users (read-only)</CardDescription>
              </CardHeader>
              <CardContent>
                {data.users.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No users found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.users.map(u => (
                        <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                          <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                          <TableCell className="text-sm">{u.email}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{u.role}</Badge></TableCell>
                          <TableCell>
                            <Badge variant={u.isActive ? "default" : "secondary"} className="text-xs">
                              {u.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
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
