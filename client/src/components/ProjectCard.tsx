import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "./StatusBadge";
import { Building2, MapPin, User } from "lucide-react";

interface ProjectCardProps {
  code: string;
  name: string;
  clientName: string;
  status: "BID" | "PLANNING" | "ACTIVE" | "COMPLETE" | "CLOSED";
  location?: string;
  superintendent?: string;
  onClick?: () => void;
}

export default function ProjectCard({
  code,
  name,
  clientName,
  status,
  location,
  superintendent,
  onClick,
}: ProjectCardProps) {
  return (
    <Card
      className="p-6 hover-elevate cursor-pointer"
      onClick={onClick}
      data-testid={`card-project-${code}`}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {code}
              </Badge>
              <StatusBadge status={status} type="project" />
            </div>
            <h3 className="text-lg font-semibold text-card-foreground truncate mb-1">
              {name}
            </h3>
          </div>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{clientName}</span>
          </div>
          
          {location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0" />
              <span className="truncate">{location}</span>
            </div>
          )}
          
          {superintendent && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="w-4 h-4 shrink-0" />
              <span className="truncate">{superintendent}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
