import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import StatusBadge from "./StatusBadge";
import HealthScoreBadge from "./HealthScoreBadge";
import type { ProjectWithNames } from "@/hooks/use-data";
import { Trash2, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface ProjectsTableProps {
  projects: ProjectWithNames[];
  onRowClick: (project: ProjectWithNames) => void;
  canDelete?: boolean;
  onDelete?: (code: string, name: string) => void;
}

export default function ProjectsTable({ projects, onRowClick, canDelete, onDelete }: ProjectsTableProps) {
  const { data: healthOverview = [] } = useQuery<Array<{
    project_id: string;
    overall_score: number;
    trend_direction: string | null;
  }>>({
    queryKey: ["/api/project-health/overview"],
    refetchInterval: 300000,
  });

  const healthMap = new Map(
    healthOverview.map((h) => [h.project_id, h])
  );

  return (
    <>
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-semibold">Code</TableHead>
              <TableHead className="font-semibold">Project Name</TableHead>
              <TableHead className="font-semibold">Client</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Health</TableHead>
              <TableHead className="font-semibold">Superintendent</TableHead>
              <TableHead className="font-semibold">Estimator</TableHead>
              {canDelete && <TableHead className="font-semibold w-16">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const health = healthMap.get(project.id);
              return (
              <TableRow
                key={project.id}
                className="cursor-pointer hover-elevate"
                onClick={() => onRowClick(project)}
                data-testid={`row-project-${project.code}`}
              >
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {project.code}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{project.name}</TableCell>
                <TableCell>{project.clientName}</TableCell>
                <TableCell>
                  <StatusBadge status={project.status} type="project" />
                </TableCell>
                <TableCell>
                  {health ? (
                    <HealthScoreBadge
                      score={health.overall_score}
                      trendDirection={health.trend_direction}
                      size="sm"
                      showTrend
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {project.superintendent || "\u2014"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {project.estimator || "\u2014"}
                </TableCell>
                {canDelete && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(project.code, project.name);
                      }}
                      data-testid={`button-delete-project-${project.code}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden space-y-3">
        {projects.map((project) => {
          const health = healthMap.get(project.id);
          return (
          <Card
            key={project.id}
            className="cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => onRowClick(project)}
            data-testid={`card-project-${project.code}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {project.code}
                    </Badge>
                    <StatusBadge status={project.status} type="project" />
                    {health && (
                      <HealthScoreBadge
                        score={health.overall_score}
                        trendDirection={health.trend_direction}
                        size="sm"
                      />
                    )}
                  </div>
                  <h3 className="font-medium text-sm leading-tight mb-1 truncate" data-testid={`text-project-name-${project.code}`}>
                    {project.name}
                  </h3>
                  {project.clientName && (
                    <p className="text-xs text-muted-foreground truncate" data-testid={`text-project-client-${project.code}`}>
                      {project.clientName}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(project.code, project.name);
                      }}
                      data-testid={`button-delete-project-${project.code}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              {(project.superintendent || project.estimator) && (
                <div className="flex gap-4 mt-2 pt-2 border-t text-xs text-muted-foreground">
                  {project.superintendent && (
                    <span>Super: {project.superintendent}</span>
                  )}
                  {project.estimator && (
                    <span>Est: {project.estimator}</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          );
        })}
      </div>
    </>
  );
}
