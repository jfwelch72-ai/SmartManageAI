import { useState } from "react";
import { Link } from "wouter";
import MobileSyncStatus from "@/components/MobileSyncStatus";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Smartphone,
  Wifi,
  WifiOff,
  Cloud,
  AlertTriangle,
  ArrowRight,
  Shield,
  Loader2,
} from "lucide-react";

interface ConflictItem {
  id: string;
  entityType: string;
  entityId: string;
  localValue: string;
  serverValue: string;
  conflictedAt: string;
  status: "UNRESOLVED" | "LOCAL_WINS" | "SERVER_WINS" | "MERGED";
}

export default function MobileSyncPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const { toast } = useToast();

  const { data: conflicts } = useQuery<ConflictItem[]>({
    queryKey: ["/api/ai-features/mobile-sync/conflicts"],
  });

  const resolveConflictMutation = useMutation({
    mutationFn: async ({
      id,
      resolution,
    }: {
      id: string;
      resolution: "LOCAL_WINS" | "SERVER_WINS";
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/ai-features/mobile-sync/conflicts/${id}`,
        { resolution },
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/ai-features/mobile-sync/conflicts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/ai-features/mobile-sync"],
      });
      toast({
        title: "Conflict Resolved",
        description: `Resolution applied: ${variables.resolution === "LOCAL_WINS" ? "Local changes kept" : "Server version accepted"}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Resolution Failed",
        description: error.message || "Failed to resolve conflict",
        variant: "destructive",
      });
    },
  });

  const unresolvedConflicts = (conflicts || []).filter(
    (c) => c.status === "UNRESOLVED",
  );

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-full px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Mobile & Offline V2
            </h1>
            <p className="text-muted-foreground">
              Device sync, offline capabilities, and conflict resolution
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant={isOnline ? "default" : "destructive"}
              className="flex items-center gap-1"
              data-testid="badge-connection-status"
            >
              {isOnline ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {isOnline ? "Online" : "Offline"}
            </Badge>
            {unresolvedConflicts.length > 0 && (
              <Badge
                variant="destructive"
                className="flex items-center gap-1"
                data-testid="badge-conflicts-count"
              >
                <AlertTriangle className="w-3 h-3" />
                {unresolvedConflicts.length} Conflict
                {unresolvedConflicts.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview" data-testid="tab-sync-overview">
              <Smartphone className="w-4 h-4 mr-2" />
              Sync Overview
            </TabsTrigger>
            <TabsTrigger value="conflicts" data-testid="tab-conflicts">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Conflicts
              {unresolvedConflicts.length > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-2 h-5 px-1.5 text-xs"
                >
                  {unresolvedConflicts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="offline-data" data-testid="tab-offline-data">
              <Cloud className="w-4 h-4 mr-2" />
              Offline Queue
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <MobileSyncStatus userId={user?.id} />
          </TabsContent>

          <TabsContent value="conflicts">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Conflict Resolution
                </CardTitle>
                <CardDescription>
                  When changes are made both offline and on the server,
                  conflicts can arise. Review and resolve them here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {unresolvedConflicts.length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="w-12 h-12 mx-auto text-green-500 mb-4" />
                    <p className="font-medium" data-testid="text-no-conflicts">
                      No Conflicts
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      All data is in sync with no conflicts to resolve
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {unresolvedConflicts.map((conflict) => (
                      <div
                        key={conflict.id}
                        className="flex items-center justify-between p-4 rounded-lg border"
                        data-testid={`conflict-item-${conflict.id}`}
                      >
                        <div>
                          <p className="font-medium">{conflict.entityType}</p>
                          <p className="text-sm text-muted-foreground">
                            ID: {conflict.entityId}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Detected{" "}
                            {new Date(conflict.conflictedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resolveConflictMutation.isPending}
                            onClick={() =>
                              resolveConflictMutation.mutate({
                                id: conflict.id,
                                resolution: "LOCAL_WINS",
                              })
                            }
                            data-testid={`button-use-local-${conflict.id}`}
                          >
                            {resolveConflictMutation.isPending &&
                              resolveConflictMutation.variables?.id ===
                                conflict.id &&
                              resolveConflictMutation.variables?.resolution ===
                                "LOCAL_WINS" && (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              )}
                            Use Local
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resolveConflictMutation.isPending}
                            onClick={() =>
                              resolveConflictMutation.mutate({
                                id: conflict.id,
                                resolution: "SERVER_WINS",
                              })
                            }
                            data-testid={`button-use-server-${conflict.id}`}
                          >
                            {resolveConflictMutation.isPending &&
                              resolveConflictMutation.variables?.id ===
                                conflict.id &&
                              resolveConflictMutation.variables?.resolution ===
                                "SERVER_WINS" && (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              )}
                            Use Server
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="offline-data">
            <Card>
              <CardHeader>
                <CardTitle>Offline Sync Queue</CardTitle>
                <CardDescription>
                  View and manage items queued for synchronization
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    For detailed offline queue management, visit the dedicated
                    offline sync page.
                  </p>
                  <Link href="/offline-sync">
                    <Button variant="outline" data-testid="link-offline-sync">
                      Open Offline Sync Queue
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
