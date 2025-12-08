import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Building2, FolderKanban, FileText, Users, ClipboardList, TrendingUp, DollarSign, Calendar, AlertCircle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface Organization {
  id: string;
  name: string;
  slug: string;
  tradeType: string;
  tradeName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  region: string | null;
}

interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
  clientName: string | null;
  address: string | null;
  startDate: string | null;
  createdAt: string;
}

interface Bid {
  id: string;
  code: string;
  name: string;
  status: string;
  clientName: string | null;
  bidAmount: string | null;
  dueDate: string | null;
  createdAt: string;
  estimateSummary?: {
    totalCost: number;
    lineItemCount: number;
    status: string;
  } | null;
}

interface User {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  isActive: boolean;
}

interface ChangeOrder {
  id: string;
  code: string;
  title: string;
  status: string;
  amount: string;
  createdAt: string;
}

export default function HustlerOrgDetail() {
  const params = useParams();
  const orgId = params.orgId;

  // Fetch current user context to get organization info
  const { data: authData } = useQuery<{ user: { organizationId: string }, organization?: Organization }>({
    queryKey: ["/api/auth/me"],
    staleTime: 30000,
  });

  // Fetch organization details from hustler organizations list
  const { data: hustlerOrgs } = useQuery<{ organizations: Array<{ organizationId: string, organization: Organization }> }>({
    queryKey: ["/api/hustler/organizations"],
    staleTime: 30000,
  });

  // Find the current organization from the hustler's linked orgs
  const currentOrg = hustlerOrgs?.organizations?.find(o => o.organizationId === orgId)?.organization;

  // Fetch projects for this org (uses session context)
  const { data: projectsData, isLoading: loadingProjects } = useQuery<{ data: Project[], pagination: { totalCount: number } }>({
    queryKey: ["/api/projects"],
    staleTime: 30000,
  });

  // Fetch bids for this org
  const { data: bidsData, isLoading: loadingBids } = useQuery<Bid[]>({
    queryKey: ["/api/bids"],
    staleTime: 30000,
  });

  // Fetch users for this org
  const { data: usersData, isLoading: loadingUsers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    staleTime: 30000,
  });

  // Fetch change orders
  const { data: changeOrdersData, isLoading: loadingChangeOrders } = useQuery<ChangeOrder[]>({
    queryKey: ["/api/change-orders"],
    staleTime: 30000,
  });

  const projects = projectsData?.data || [];
  const bids = bidsData || [];
  const users = usersData || [];
  const changeOrders = changeOrdersData || [];

  // Calculate stats
  const activeProjects = projects.filter(p => p.status === "ACTIVE").length;
  const planningProjects = projects.filter(p => p.status === "PLANNING").length;
  const openBids = bids.filter(b => b.status === "PENDING" || b.status === "SUBMITTED").length;
  const wonBids = bids.filter(b => b.status === "WON").length;
  const pendingChangeOrders = changeOrders.filter(co => co.status === "SUBMITTED" || co.status === "PENDING").length;
  const activeEmployees = users.filter(u => u.isActive).length;
  const totalBidValue = bids.reduce((sum, b) => sum + (parseFloat(b.bidAmount || "0") || 0), 0);

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "ACTIVE": return "default";
      case "PLANNING": return "secondary";
      case "COMPLETE": return "outline";
      case "WON": return "default";
      case "LOST": return "destructive";
      case "PENDING": case "SUBMITTED": return "secondary";
      default: return "outline";
    }
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/hustler">
          <Button variant="ghost" size="icon" data-testid="button-back-portfolio">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          {currentOrg?.logoUrl ? (
            <img src={currentOrg.logoUrl} alt={currentOrg.name} className="h-10 w-10 rounded-lg" />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-org-name">
              {currentOrg?.name || "Organization"}
            </h1>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {currentOrg?.tradeType?.replace(/_/g, " ") || "Unknown Trade"}
              </Badge>
              {currentOrg?.region && (
                <span className="text-sm text-muted-foreground">{currentOrg.region}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card data-testid="card-stat-projects">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-active-projects">{activeProjects}</div>
                <p className="text-xs text-muted-foreground">
                  {planningProjects} in planning
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-bids">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Bids</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingBids ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-open-bids">{openBids}</div>
                <p className="text-xs text-muted-foreground">
                  {wonBids} won this period
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-cos">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending COs</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingChangeOrders ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-pending-cos">{pendingChangeOrders}</div>
                <p className="text-xs text-muted-foreground">
                  Requiring review
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-team">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Size</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-team-size">{activeEmployees}</div>
                <p className="text-xs text-muted-foreground">
                  Active employees
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList data-testid="tabs-org-content">
          <TabsTrigger value="projects" data-testid="tab-projects">
            <FolderKanban className="h-4 w-4 mr-2" />
            Projects ({projects.length})
          </TabsTrigger>
          <TabsTrigger value="bids" data-testid="tab-bids">
            <FileText className="h-4 w-4 mr-2" />
            Bids ({bids.length})
          </TabsTrigger>
          <TabsTrigger value="change-orders" data-testid="tab-change-orders">
            <ClipboardList className="h-4 w-4 mr-2" />
            Change Orders ({changeOrders.length})
          </TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-team">
            <Users className="h-4 w-4 mr-2" />
            Team ({users.length})
          </TabsTrigger>
        </TabsList>

        {/* Projects Tab */}
        <TabsContent value="projects">
          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>All projects for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingProjects ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderKanban className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No projects found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.map(project => (
                    <div 
                      key={project.id} 
                      className="flex items-center justify-between p-4 border rounded-lg hover-elevate cursor-pointer"
                      data-testid={`row-project-${project.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{project.name}</span>
                          <Badge variant="outline" className="text-xs">{project.code}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {project.clientName && <span>{project.clientName}</span>}
                          {project.address && <span> • {project.address}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {project.startDate && (
                          <div className="text-right text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3 inline mr-1" />
                            {format(new Date(project.startDate), "MMM d, yyyy")}
                          </div>
                        )}
                        <Badge variant={getStatusBadgeVariant(project.status)}>
                          {project.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bids Tab */}
        <TabsContent value="bids">
          <Card>
            <CardHeader>
              <CardTitle>Bids</CardTitle>
              <CardDescription>All bids for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBids ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : bids.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No bids found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {bids.map(bid => (
                    <div 
                      key={bid.id} 
                      className="flex items-center justify-between p-4 border rounded-lg hover-elevate cursor-pointer"
                      data-testid={`row-bid-${bid.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{bid.name}</span>
                          <Badge variant="outline" className="text-xs">{bid.code}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {bid.clientName && <span>{bid.clientName}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {bid.bidAmount && (
                          <div className="text-right">
                            <div className="font-semibold text-green-600 dark:text-green-400">
                              ${parseFloat(bid.bidAmount).toLocaleString()}
                            </div>
                          </div>
                        )}
                        {bid.dueDate && (
                          <div className="text-right text-sm text-muted-foreground">
                            Due {format(new Date(bid.dueDate), "MMM d")}
                          </div>
                        )}
                        <Badge variant={getStatusBadgeVariant(bid.status)}>
                          {bid.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Change Orders Tab */}
        <TabsContent value="change-orders">
          <Card>
            <CardHeader>
              <CardTitle>Change Orders</CardTitle>
              <CardDescription>All change orders for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChangeOrders ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : changeOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ClipboardList className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No change orders found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {changeOrders.map(co => (
                    <div 
                      key={co.id} 
                      className="flex items-center justify-between p-4 border rounded-lg hover-elevate cursor-pointer"
                      data-testid={`row-co-${co.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{co.title}</span>
                          <Badge variant="outline" className="text-xs">{co.code}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          Created {formatDistanceToNow(new Date(co.createdAt))} ago
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="font-semibold">
                          ${parseFloat(co.amount).toLocaleString()}
                        </div>
                        <Badge variant={getStatusBadgeVariant(co.status)}>
                          {co.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>All team members for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingUsers ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No team members found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {users.map(user => (
                    <div 
                      key={user.id} 
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`row-user-${user.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {user.firstName || user.lastName 
                              ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                              : user.email}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {user.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary">{user.role}</Badge>
                        <Badge variant={user.isActive ? "default" : "outline"}>
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
