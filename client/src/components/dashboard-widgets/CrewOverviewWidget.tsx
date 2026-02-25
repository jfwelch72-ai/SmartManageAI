import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "@/hooks/use-data";

export function CrewOverviewWidget() {
  const [, setLocation] = useLocation();
  const { data: projects = [] } = useProjects();
  const activeProjects = projects.filter((p) => p.status === "ACTIVE");

  const { data: crewAssignments = [] } = useQuery<any[]>({
    queryKey: ["/api/crew-assignments"],
  });

  const { data: crews = [] } = useQuery<any[]>({
    queryKey: ["/api/crews"],
  });

  return (
    <Card className="h-full" data-testid="card-crew-overview">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" />
          Crew Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mb-4">
          <div className="text-center p-1.5 sm:p-2 bg-muted rounded-md">
            <div className="text-base sm:text-lg font-bold">{crews.length}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center p-1.5 sm:p-2 bg-muted rounded-md">
            <div className="text-base sm:text-lg font-bold">
              {
                crewAssignments.filter(
                  (a: any) => a.project?.status === "ACTIVE"
                ).length
              }
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Assigned</div>
          </div>
          <div className="text-center p-1.5 sm:p-2 bg-muted rounded-md">
            <div className="text-base sm:text-lg font-bold">
              {
                activeProjects.filter(
                  (p: any) =>
                    !crewAssignments.some(
                      (a: any) => a.project?.id === p.id
                    )
                ).length
              }
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Need Crews</div>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setLocation("/crews")}
          data-testid="button-manage-crews"
        >
          Manage Crews
        </Button>
      </CardContent>
    </Card>
  );
}
