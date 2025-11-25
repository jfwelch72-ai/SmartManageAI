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
import StatusBadge from "./StatusBadge";
import type { ProjectWithNames } from "@/hooks/use-data";
import { Trash2 } from "lucide-react";

interface ProjectsTableProps {
  projects: ProjectWithNames[];
  onRowClick: (project: ProjectWithNames) => void;
  canDelete?: boolean;
  onDelete?: (code: string, name: string) => void;
}

export default function ProjectsTable({ projects, onRowClick, canDelete, onDelete }: ProjectsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-semibold">Code</TableHead>
            <TableHead className="font-semibold">Project Name</TableHead>
            <TableHead className="font-semibold">Client</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
            <TableHead className="font-semibold">Superintendent</TableHead>
            <TableHead className="font-semibold">Estimator</TableHead>
            {canDelete && <TableHead className="font-semibold w-16">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
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
              <TableCell className="text-muted-foreground">
                {project.superintendent || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {project.estimator || "—"}
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
