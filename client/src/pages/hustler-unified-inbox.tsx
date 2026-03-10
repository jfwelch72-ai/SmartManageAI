import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Inbox,
  Bell,
  ClipboardList,
  Building2,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronLeft,
  CheckCheck,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

interface UnifiedInboxItem {
  id: string;
  type: "task" | "notification";
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  organizationId: string | null;
  organizationName: string | null;
  projectId: string | null;
  projectName: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string | null;
  dueDate: string | null;
  isRead: boolean | null;
}

interface UnifiedInboxResponse {
  items: UnifiedInboxItem[];
  counts: {
    tasks: number;
    notifications: number;
    unreadNotifications: number;
    total: number;
  };
  organizations: Array<{ id: string; name: string }>;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export default function HustlerUnifiedInbox() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const queryParams = new URLSearchParams();
  if (typeFilter !== "all") queryParams.set("type", typeFilter);
  if (statusFilter === "unread") queryParams.set("status", "unread");
  if (statusFilter === "pending") queryParams.set("status", "pending");

  const { data, isLoading, error } = useQuery<UnifiedInboxResponse>({
    queryKey: ["/api/hustler/unified-inbox", typeFilter, statusFilter],
    staleTime: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiRequest(
        "POST",
        `/api/hustler/notifications/${notificationId}/read`,
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/hustler/unified-inbox"],
      });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/hustler/notifications/mark-all-read",
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/hustler/unified-inbox"],
      });
      toast({
        title: "All Marked Read",
        description: "All notifications have been marked as read",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed",
        description: error.message || "Failed to mark notifications as read",
        variant: "destructive",
      });
    },
  });

  const getPriorityIcon = (priority: string | null) => {
    switch (priority) {
      case "HIGH":
      case "URGENT":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "MEDIUM":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
  };

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">
              Unable to load unified inbox. You may not have HUSTLER access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-full p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/hustler">
          <Button variant="ghost" size="icon" data-testid="button-back-hustler">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1
            className="text-3xl font-bold tracking-tight flex items-center gap-2"
            data-testid="text-inbox-title"
          >
            <Inbox className="h-8 w-8" />
            Unified Inbox
          </h1>
          <p className="text-muted-foreground mt-1">
            Tasks and notifications across all your organizations
          </p>
        </div>
        {(data?.counts?.unreadNotifications || 0) > 0 && (
          <Button
            variant="outline"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark All Read
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card data-testid="card-stat-total">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-stat-total">
                {data?.counts?.total || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-tasks">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Tasks</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-stat-tasks">
                {data?.counts?.tasks || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-notifications">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Notifications</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div
                className="text-2xl font-bold"
                data-testid="text-stat-notifications"
              >
                {data?.counts?.notifications || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-unread">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Unread</CardTitle>
            <Badge variant="destructive" className="text-xs">
              {data?.counts?.unreadNotifications || 0}
            </Badge>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div
                className="text-2xl font-bold text-destructive"
                data-testid="text-stat-unread"
              >
                {data?.counts?.unreadNotifications || 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-lg">Inbox Items</CardTitle>
              <CardDescription>
                {data?.organizations?.length || 0} organizations connected
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger
                  className="w-[140px]"
                  data-testid="select-type-filter"
                >
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="task">Tasks Only</SelectItem>
                  <SelectItem value="notification">Notifications</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="w-[140px]"
                  data-testid="select-status-filter"
                >
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="unread">Unread Only</SelectItem>
                  <SelectItem value="pending">Pending Tasks</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : data?.items?.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No items in your inbox</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.items?.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className={`p-4 rounded-lg border transition-colors ${
                    item.type === "notification" && item.isRead === false
                      ? "bg-primary/5 border-primary/20"
                      : "bg-card"
                  }`}
                  data-testid={`inbox-item-${item.type}-${item.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {item.type === "task" ? (
                        getPriorityIcon(item.priority)
                      ) : (
                        <Bell
                          className={`h-4 w-4 ${item.isRead ? "text-muted-foreground" : "text-primary"}`}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{item.title}</span>
                        <Badge
                          variant={
                            item.type === "task" ? "default" : "secondary"
                          }
                          className="text-xs"
                        >
                          {item.type}
                        </Badge>
                        {item.status && (
                          <Badge variant="outline" className="text-xs">
                            {item.status}
                          </Badge>
                        )}
                        {item.priority && item.type === "task" && (
                          <Badge
                            variant={
                              item.priority === "HIGH" ||
                              item.priority === "URGENT"
                                ? "destructive"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {item.priority}
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                        {item.organizationName && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {item.organizationName}
                          </span>
                        )}
                        {item.projectName && (
                          <span>Project: {item.projectName}</span>
                        )}
                        {item.createdAt && (
                          <span>
                            {formatDistanceToNow(new Date(item.createdAt), {
                              addSuffix: true,
                            })}
                          </span>
                        )}
                        {item.dueDate && (
                          <span className="text-orange-500">
                            Due:{" "}
                            {formatDistanceToNow(new Date(item.dueDate), {
                              addSuffix: true,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    {item.type === "notification" && item.isRead === false && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markReadMutation.mutate(item.id)}
                        disabled={markReadMutation.isPending}
                        data-testid={`button-mark-read-${item.id}`}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
