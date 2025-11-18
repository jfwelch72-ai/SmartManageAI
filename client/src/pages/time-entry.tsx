import AppHeader from "@/components/AppHeader";
import TimeEntryForm from "@/components/TimeEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useProjects, useTimeEntries, useCreateTimeEntry, useApproveTimeEntry } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export default function TimeEntryPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: timeEntries = [], isLoading: entriesLoading } = useTimeEntries();
  const createEntry = useCreateTimeEntry();
  const approveEntry = useApproveTimeEntry();

  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";

  const handleSubmit = async (entry: {
    projectId: string;
    date: string;
    regularHours: number;
    overtimeHours: number;
    costCode: string;
    notes: string;
  }) => {
    try {
      await createEntry.mutateAsync({
        projectId: entry.projectId,
        date: new Date(entry.date),
        hoursRegular: entry.regularHours.toString(),
        hoursOvertime: entry.overtimeHours.toString(),
        costCode: entry.costCode,
        notes: entry.notes || "",
      });
      toast({
        title: "Success",
        description: "Time entry submitted successfully",
      });
    } catch (error: any) {
      console.error("Time entry submission error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to submit time entry",
        variant: "destructive",
      });
    }
  };

  const handleApprove = async (entryId: string) => {
    try {
      await approveEntry.mutateAsync(entryId);
      toast({
        title: "Success",
        description: "Time entry approved",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to approve time entry",
        variant: "destructive",
      });
    }
  };

  const projectsForForm = projects.map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
  }));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            {canApprove ? "Time Entries" : "My Time Entries"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {canApprove 
              ? "Review and approve employee time entries"
              : "Log your daily hours worked on projects"
            }
          </p>
        </div>

        <div className="space-y-8">
          {!canApprove && (
            <TimeEntryForm
              projects={projectsForForm}
              onSubmit={handleSubmit}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                {canApprove ? "All Time Entries" : "Recent Entries"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entriesLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading...
                </div>
              ) : timeEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No time entries found
                </div>
              ) : (
                <div className="space-y-3">
                  {timeEntries.map(entry => {
                    const project = projects.find(p => p.id === entry.projectId);
                    const isApproved = !!entry.approvedAt;
                    
                    return (
                      <div 
                        key={entry.id} 
                        className="flex items-center justify-between p-4 border rounded-md gap-4"
                        data-testid={`time-entry-${entry.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-date-${entry.id}`}>
                              {format(new Date(entry.date), "MMM d, yyyy")}
                            </span>
                            <Badge 
                              variant={isApproved ? "default" : "secondary"}
                              className="text-xs"
                              data-testid={`badge-status-${entry.id}`}
                            >
                              {isApproved ? (
                                <span className="flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  Approved
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Pending
                                </span>
                              )}
                            </Badge>
                          </div>
                          {project && (
                            <p className="text-sm text-muted-foreground mb-1" data-testid={`text-project-${entry.id}`}>
                              {project.code} - {project.name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground" data-testid={`text-cost-code-${entry.id}`}>
                            {entry.costCode}
                          </p>
                          {entry.notes && (
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              {entry.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-medium font-mono" data-testid={`text-hours-${entry.id}`}>
                              {entry.hoursRegular}h reg
                              {parseFloat(entry.hoursOvertime) > 0 && `, ${entry.hoursOvertime}h OT`}
                            </p>
                          </div>
                          {canApprove && !isApproved && (
                            <Button
                              size="sm"
                              onClick={() => handleApprove(entry.id)}
                              disabled={approveEntry.isPending}
                              data-testid={`button-approve-${entry.id}`}
                            >
                              Approve
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
