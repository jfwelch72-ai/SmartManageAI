import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Briefcase, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useProjects } from "@/hooks/use-data";
import { useState } from "react";

export function ActiveProjectsWidget({ config }: { config?: Record<string, unknown> }) {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading, isError, refetch } = useProjects();
  const activeProjects = projects.filter((p) => p.status === "ACTIVE");
  const [showAll, setShowAll] = useState(false);
  const displayLimit = (config?.displayLimit as number) || 4;
  const displayedProjects = showAll ? activeProjects : activeProjects.slice(0, displayLimit);
  const hasMore = activeProjects.length > displayLimit;

  return (
    <Card className="h-full" data-testid="card-active-projects">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="w-4 h-4" />
            Active Projects
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/projects")}
            data-testid="button-view-all-projects"
          >
            View All
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 rounded-md border space-y-2">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-12" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-6 text-center gap-2" data-testid="active-projects-error">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Failed to load projects.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-projects">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : activeProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="active-projects-empty">
            <Briefcase className="w-6 h-6 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No active projects</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedProjects.map((project) => (
              <div
                key={project.code}
                className="p-3 rounded-md border hover-elevate cursor-pointer"
                onClick={() => setLocation(`/projects/${project.code}`)}
                data-testid={`project-item-${project.code}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="font-mono text-xs">
                    {project.code}
                  </Badge>
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                    ACTIVE
                  </Badge>
                </div>
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {project.clientName}
                </p>
              </div>
            ))}
            {hasMore && !showAll && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(true)}
                data-testid="button-show-more-projects"
              >
                Show {activeProjects.length - displayLimit} more
              </Button>
            )}
            {showAll && hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(false)}
                data-testid="button-show-less-projects"
              >
                Show less
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
