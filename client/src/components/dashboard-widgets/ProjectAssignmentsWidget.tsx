import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HardHat, Bell, Check } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Notification } from "@shared/schema";

export function ProjectAssignmentsWidget() {
  const [, setLocation] = useLocation();
  const { data: notifications = [] } = useQuery<Notification[]>({
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
