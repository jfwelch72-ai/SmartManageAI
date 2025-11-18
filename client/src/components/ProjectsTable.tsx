import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "./StatusBadge";

interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: "BID" | "PLANNING" | "ACTIVE" | "COMPLETE" | "CLOSED";
  superintendent?: string;
  estimator?: string;
}

interface ProjectsTableProps {
  projects: Project[];
  onRowClick: (project: Project) => void;
}

export default function ProjectsTable({ projects, onRowClick }: ProjectsTableProps) {
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
