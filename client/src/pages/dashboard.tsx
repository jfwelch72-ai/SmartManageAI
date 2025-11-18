import AppHeader from "@/components/AppHeader";
import KPICard from "@/components/KPICard";
import ProjectCard from "@/components/ProjectCard";
import { Briefcase, Clock, AlertCircle, CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardStats, useProjects } from "@/hooks/use-data";

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();

  const activeProjects = projects.filter(p => p.status === 'ACTIVE');

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={() => setLocation('/login')}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Overview of all active projects and key metrics
            </p>
          </div>
          <Button data-testid="button-new-project">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>

        <div className="space-y-8">
          {statsLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading dashboard...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Active Bids</h2>
                <Button variant="outline" onClick={() => setLocation('/bids')} data-testid="button-view-all-bids">
                  View All
                </Button>
              </div>
              <div className="space-y-4">
                <div className="p-4 border rounded-md hover-elevate cursor-pointer" onClick={() => setLocation('/bids/BID-240815')}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="font-mono text-xs">BID-240815</Badge>
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">BID</Badge>
                  </div>
                  <p className="font-medium mb-1">City Hall Renovation - Phase 2</p>
                  <p className="text-sm text-muted-foreground">City of Columbus • Due: 2024-02-15</p>
                </div>
                <div className="p-4 border rounded-md hover-elevate cursor-pointer" onClick={() => setLocation('/bids/BID-240722')}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="font-mono text-xs">BID-240722</Badge>
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">BID</Badge>
                  </div>
                  <p className="font-medium mb-1">Shopping Plaza Foundation</p>
                  <p className="text-sm text-muted-foreground">Retail Development Corp • Due: 2024-02-20</p>
                </div>
              </div>
            </div>

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
