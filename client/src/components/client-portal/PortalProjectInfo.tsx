import { Card, CardContent } from "@/components/ui/card";
import { Calendar, MapPin, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";

interface ProjectInfo {
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface PortalProjectInfoProps {
  project: ProjectInfo;
}

export function PortalProjectInfo({ project }: PortalProjectInfoProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="font-medium" data-testid="text-portal-status">
                {project.status?.replace(/_/g, " ") || "Active"}
              </p>
            </div>
          </div>
          {project.startDate && (
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Start Date</p>
                <p className="font-medium">
                  {format(new Date(project.startDate), "MMM d, yyyy")}
                </p>
              </div>
            </div>
          )}
          {project.endDate && (
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">End Date</p>
                <p className="font-medium">
                  {format(new Date(project.endDate), "MMM d, yyyy")}
                </p>
              </div>
            </div>
          )}
          {(project.address || project.city) && (
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="font-medium">
                  {[project.address, project.city, project.state]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
