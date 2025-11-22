import AppHeader from "@/components/AppHeader";
import KPICard from "@/components/KPICard";
import ProjectCard from "@/components/ProjectCard";
import { Briefcase, Clock, AlertCircle, CalendarClock, Plus, DollarSign, AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardStats, useProjects, useBids } from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { FeaturePermissions, hasManagementAccess } from "@/lib/rbac";

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: bids = [], isLoading: bidsLoading } = useBids();

  // Fetch crew assignments for superintendents
  const { data: crewAssignments = [] } = useQuery<import("@shared/schema").CrewProjectAssignment[]>({
    queryKey: ["/api/crew-assignments"],
    enabled: user?.role === "SUPERINTENDENT",
  });

  const { data: crews = [] } = useQuery<import("@shared/schema").Crew[]>({
    queryKey: ["/api/crews"],
    enabled: user?.role === "SUPERINTENDENT",
  });

  const activeProjects = projects.filter(p => p.status === 'ACTIVE');
  // All bids in the bids table are considered "active" (not yet converted to projects)
  const activeBids = bids;

  // Calculate projects missing budget data
  const projectsMissingBudget = projects.filter(p => {
    const budgetNum = Number(p.budget);
    return !p.budget || isNaN(budgetNum) || budgetNum <= 0;
  });
  
  const bidsMissingBudget = bids.filter(b => {
    const bidAmountNum = Number(b.bidAmount);
    return !b.bidAmount || isNaN(bidAmountNum) || bidAmountNum <= 0;
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Overview of all active projects and key metrics
            </p>
          </div>
          {FeaturePermissions.CREATE_PROJECT(user?.role) && (
            <Button data-testid="button-new-project">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          )}
        </div>

        <div className="space-y-8">
          {statsLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading dashboard...</div>
          ) : (
            <>
              <div className={`grid grid-cols-1 md:grid-cols-2 ${hasManagementAccess(user?.role) ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-6`}>
                <KPICard
                  title="Active Projects"
                  value={stats?.activeProjectsCount || 0}
                  icon={Briefcase}
                  data-testid="kpi-active-projects"
                />
                <KPICard
                  title="Pending Change Orders"
                  value={stats?.pendingChangeOrdersCount || 0}
                  icon={AlertCircle}
                  data-testid="kpi-pending-change-orders"
                />
                <KPICard
                  title="Pending Time-Off Requests"
                  value={stats?.pendingTimeOffCount || 0}
                  icon={CalendarClock}
                  data-testid="kpi-pending-time-off"
                />
                {FeaturePermissions.VIEW_BUDGET_METRICS(user?.role) && (
                  <KPICard
                    title="Missing Budget Data"
                    value={projectsMissingBudget.length}
                    icon={DollarSign}
                    data-testid="kpi-missing-budget"
                  />
                )}
              </div>

              {/* Budget Data Warning Alert - Only for management */}
              {FeaturePermissions.VIEW_BUDGET_METRICS(user?.role) && projectsMissingBudget.length > 0 && (
                <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-budget-warning">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                      Projects Missing Budget Data
                    </CardTitle>
                    <CardDescription>
                      {projectsMissingBudget.length} project{projectsMissingBudget.length !== 1 ? 's' : ''} missing budget information. 
                      This affects profitability tracking and AI analysis.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {projectsMissingBudget.slice(0, 5).map(project => (
                        <div 
                          key={project.code}
                          className="flex items-center justify-between p-2 bg-background rounded-md hover-elevate cursor-pointer"
                          onClick={() => setLocation(`/projects/${project.code}`)}
                          data-testid={`warning-project-${project.code}`}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                            <span className="text-sm font-medium">{project.name}</span>
                          </div>
                          <Button variant="outline" size="sm" data-testid={`button-add-budget-${project.code}`}>
                            Add Budget
                          </Button>
                        </div>
                      ))}
                      {projectsMissingBudget.length > 5 && (
                        <p className="text-sm text-muted-foreground text-center pt-2">
                          And {projectsMissingBudget.length - 5} more...
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {user?.role === "SUPERINTENDENT" && crews.length > 0 && (
                <Card data-testid="card-crew-scheduling">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Crew Scheduling Overview
                    </CardTitle>
                    <CardDescription>
                      Crew assignments to active projects
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold">{crews.length}</div>
                          <div className="text-sm text-muted-foreground">Total Crews</div>
                        </div>
                        <div className="text-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold">{crewAssignments.filter((a: any) => a.project?.status === 'ACTIVE').length}</div>
                          <div className="text-sm text-muted-foreground">Assigned</div>
                        </div>
                        <div className="text-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold">
                            {activeProjects.filter((p: any) => !crewAssignments.some((a: any) => a.project?.id === p.id)).length}
                          </div>
                          <div className="text-sm text-muted-foreground">Need Crews</div>
                        </div>
                      </div>
                      
                      {crewAssignments.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">
                          No crew assignments yet
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Recent Assignments:</p>
                          {crewAssignments.slice(0, 3).map((assignment: any) => (
                            <div key={assignment.assignment.id} className="flex items-center justify-between p-2 border rounded-md text-sm">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{assignment.crew?.name}</Badge>
                                <span className="text-muted-foreground">→</span>
                                <span>{assignment.project?.name}</span>
                              </div>
                              <Badge className={assignment.project?.status === 'ACTIVE' ? 'bg-green-500' : ''}>
                                {assignment.project?.status || 'N/A'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}

                      <Button 
                        variant="outline" 
                        className="w-full" 
                        onClick={() => setLocation('/crews')}
                        data-testid="button-manage-crews"
                      >
                        Manage Crews & Assignments
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          <div className={`grid grid-cols-1 ${hasManagementAccess(user?.role) ? 'lg:grid-cols-2' : ''} gap-8`}>
            {/* Active Bids - Only for management users */}
            {hasManagementAccess(user?.role) && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">Active Bids</h2>
                  <Button variant="outline" onClick={() => setLocation('/bids')} data-testid="button-view-all-bids">
                    View All
                  </Button>
                </div>
                {bidsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading bids...</div>
                ) : activeBids.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No active bids</div>
                ) : (
                  <div className="space-y-4">
                    {activeBids.slice(0, 2).map((bid) => {
                      const bidAmountNum = Number(bid.bidAmount);
                      const hasBudget = bid.bidAmount && !isNaN(bidAmountNum) && bidAmountNum > 0;
                      return (
                        <div
                          key={bid.code}
                          className="p-4 border rounded-md hover-elevate cursor-pointer"
                          onClick={() => setLocation(`/bids/${encodeURIComponent(bid.code)}`)}
                          data-testid={`bid-${encodeURIComponent(bid.code)}`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="font-mono text-xs">{bid.code}</Badge>
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">BID</Badge>
                            {!hasBudget && (
                              <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500 text-xs">
                                <DollarSign className="w-3 h-3 mr-1" />
                                No Budget
                              </Badge>
                            )}
                          </div>
                          <p className="font-medium mb-1">{bid.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {bid.clientName}{bid.dueDate && ` • Due: ${new Date(bid.dueDate).toLocaleDateString()}`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Active Projects</h2>
                <Button variant="outline" onClick={() => setLocation('/projects')} data-testid="button-view-all-projects">
                  View All
                </Button>
              </div>
              {projectsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading projects...</div>
              ) : activeProjects.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No active projects</div>
              ) : (
                <div className="space-y-4">
                  {activeProjects.slice(0, 2).map((project) => (
                    <ProjectCard
                      key={project.code}
                      {...project}
                      onClick={() => setLocation(`/projects/${project.code}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
