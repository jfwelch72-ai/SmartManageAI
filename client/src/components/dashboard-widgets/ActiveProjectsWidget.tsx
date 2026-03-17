import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Briefcase, ChevronRight, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useProjects } from "@/hooks/use-data";

export function ActiveProjectsWidget() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading, isError } = useProjects();
  const activeProjects = projects.filter((p) => p.status === "ACTIVE");

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
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="active-projects-error">
            <AlertCircle className="w-6 h-6 text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">Failed to load projects.</p>
          </div>
        ) : activeProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No active projects
          </p>
        ) : (
          <div className="space-y-3">
            {activeProjects.slice(0, 4).map((project) => (
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
