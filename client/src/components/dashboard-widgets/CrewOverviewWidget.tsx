import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, AlertCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "@/hooks/use-data";

export function CrewOverviewWidget() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading: projectsLoading, isError: projectsError, refetch: refetchProjects } = useProjects();
  const activeProjects = projects.filter((p) => p.status === "ACTIVE");

  const { data: crewAssignments = [], isLoading: assignmentsLoading, isError: assignmentsError, refetch: refetchAssignments } = useQuery<any[]>({
    queryKey: ["/api/crew-assignments"],
  });

  const { data: crews = [], isLoading: crewsLoading, isError: crewsError, refetch: refetchCrews } = useQuery<any[]>({
    queryKey: ["/api/crews"],
  });

  const isLoading = projectsLoading || assignmentsLoading || crewsLoading;
  const isError = projectsError || assignmentsError || crewsError;

  if (isLoading) {
    return (
      <Card className="h-full" data-testid="card-crew-overview">
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-muted rounded-md p-2 space-y-1.5">
                <Skeleton className="h-6 w-8 mx-auto" />
                <Skeleton className="h-3 w-12 mx-auto" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full" data-testid="card-crew-overview-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load crew data.</p>
              <Button variant="outline" size="sm" onClick={() => { refetchProjects(); refetchAssignments(); refetchCrews(); }} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

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
              {crewAssignments.filter((a: any) => a.project?.status === "ACTIVE").length}
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Assigned</div>
          </div>
          <div className="text-center p-1.5 sm:p-2 bg-muted rounded-md">
            <div className="text-base sm:text-lg font-bold">
              {activeProjects.filter((p: any) => !crewAssignments.some((a: any) => a.project?.id === p.id)).length}
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
