import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HardHat, Bell, Check, AlertCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Notification } from "@shared/schema";

export function ProjectAssignmentsWidget() {
  const [, setLocation] = useLocation();
  const { data: notifications = [], isLoading, isError, refetch } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiRequest(
        "PATCH",
        `/api/notifications/${notificationId}/read`
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  if (isLoading) {
    return (
      <Card className="h-full" data-testid="card-project-assignments-loading">
        <CardContent className="flex items-center justify-center h-full">
          <div className="w-full space-y-3 pt-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-md bg-muted/30">
                <Skeleton className="h-4 w-4 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full" data-testid="card-project-assignments-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load assignments.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const projectAssignmentNotifications = notifications.filter(
    (n) => n.type === "PROJECT_ASSIGNMENT" && !n.isRead
  );

  if (projectAssignmentNotifications.length === 0) {
    return (
      <Card className="h-full" data-testid="card-project-assignments">
        <CardContent className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            No new project assignments
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="h-full border-blue-500 bg-blue-50 dark:bg-blue-950/20"
      data-testid="card-project-assignments"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <HardHat className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          New Project Assignments
          <Badge variant="default" className="ml-2">
            {projectAssignmentNotifications.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          You have been assigned to new projects. Click to view details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {projectAssignmentNotifications.map((notification) => (
            <div
              key={notification.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-background rounded-md"
              data-testid={`assignment-notification-${notification.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Bell className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{notification.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {notification.message}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 pl-7 sm:pl-0">
                {notification.relatedEntityId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      markAsReadMutation.mutate(notification.id);
                      setLocation(
                        `/projects/${notification.relatedEntityId}`
                      );
                    }}
                    data-testid={`button-view-project-${notification.id}`}
                  >
                    View Project
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => markAsReadMutation.mutate(notification.id)}
                  disabled={markAsReadMutation.isPending}
                  data-testid={`button-dismiss-${notification.id}`}
                >
                  <Check className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
