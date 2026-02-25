import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Briefcase, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useProjects } from "@/hooks/use-data";

export function ActiveProjectsWidget() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading } = useProjects();
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
          <p className="text-sm text-muted-foreground text-center py-4">
            Loading...
          </p>
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
