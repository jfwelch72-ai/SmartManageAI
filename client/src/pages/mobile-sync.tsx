import { ContextualHelpButton } from "@/components/ContextualHelpButton";
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
  CheckCircle,
  Activity,
  Clock,
  ChevronDown,
  ChevronUp,
  Flag,
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

interface SyncEventItem {
  id: string;
  deviceId: string;
  entityType: string;
  localId: string | null;
  serverId: string | null;
  operation: string;
  strategy: string;
  outcome: string;
  clientTimestamp: string | null;
  serverTimestamp: string;
  logicalClock: number | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  conflictPayload: Record<string, unknown> | null;
  createdAt: string;
}

interface DeviceHealth {
  deviceId: string;
  deviceModel: string | null;
  platform: string;
  appVersion: string | null;
  lastSyncAt: string | null;
  pendingOutboxCount: number;
  unresolvedConflicts: number;
  isStale: boolean;
  userId: string;
}

const OUTCOME_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  SAVED: { label: "Saved", variant: "default" },
  CONFLICT: { label: "Conflict", variant: "destructive" },
  DEDUPLICATED: { label: "Deduplicated", variant: "secondary" },
  MERGED: { label: "Merged", variant: "secondary" },
  FLAGGED: { label: "Flagged", variant: "destructive" },
  DUPLICATE: { label: "Duplicate", variant: "outline" },
};

export default function MobileSyncPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const { toast } = useToast();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const isManagerOrAdmin = user && ["MANAGER", "ADMIN", "SUPER_ADMIN", "SUPERINTENDENT"].includes(user.role);

  const { data: conflicts } = useQuery<ConflictItem[]>({
    queryKey: ["/api/ai-features/mobile-sync/conflicts"],
  });

  const { data: syncEventsData, isLoading: eventsLoading } = useQuery<{ items: SyncEventItem[]; nextCursor: string | null }>({
    queryKey: ["/api/mobile-sync/events"],
    enabled: !!isManagerOrAdmin,
  });

  const { data: devicesData, isLoading: devicesLoading } = useQuery<{ devices: DeviceHealth[]; staleThresholdHours: number }>({
    queryKey: ["/api/mobile-sync/devices"],
    enabled: !!isManagerOrAdmin,
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
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/mobile-sync/conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/mobile-sync"] });
      toast({
        title: "Conflict Resolved",
        description: `Resolution applied: ${variables.resolution === "LOCAL_WINS" ? "Local changes kept" : "Server version accepted"}`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Resolution Failed",
        description: error instanceof Error ? error.message : "Failed to resolve conflict",
        variant: "destructive",
      });
    },
  });

  const resolveSyncEventMutation = useMutation({
    mutationFn: async ({ id, choice, note }: { id: string; choice: "SERVER" | "DEVICE" | "FLAG_PAYROLL"; note?: string }) => {
      const res = await apiRequest("PATCH", `/api/mobile-sync/events/${id}/resolve`, { choice, note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobile-sync/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile-sync/devices"] });
      toast({ title: "Event Resolved", description: "The conflict or flag has been marked as resolved." });
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to Resolve", description: error instanceof Error ? error.message : "Resolve failed", variant: "destructive" });
    },
  });

  const unresolvedConflicts = (conflicts || []).filter((c) => c.status === "UNRESOLVED");
  const pendingEvents = (syncEventsData?.items || []).filter(
    (e) => ["CONFLICT", "FLAGGED"].includes(e.outcome) && !e.resolvedAt
  );

  const totalBadgeCount = unresolvedConflicts.length + pendingEvents.length;

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-full px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Mobile & Offline Sync
            </h1>
            <p className="text-muted-foreground">
              Device sync, conflict resolution, and field device health
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ContextualHelpButton />
            <Badge
              variant={isOnline ? "default" : "destructive"}
              className="flex items-center gap-1"
              data-testid="badge-connection-status"
            >
              {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isOnline ? "Online" : "Offline"}
            </Badge>
            {totalBadgeCount > 0 && (
              <Badge variant="destructive" className="flex items-center gap-1" data-testid="badge-conflicts-count">
                <AlertTriangle className="w-3 h-3" />
                {totalBadgeCount} Issue{totalBadgeCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 flex flex-wrap gap-1">
            <TabsTrigger value="overview" data-testid="tab-sync-overview">
              <Smartphone className="w-4 h-4 mr-2" />
              Sync Overview
            </TabsTrigger>
            <TabsTrigger value="conflicts" data-testid="tab-conflicts">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Conflicts
              {unresolvedConflicts.length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 px-1.5 text-xs">
                  {unresolvedConflicts.length}
                </Badge>
              )}
            </TabsTrigger>
            {isManagerOrAdmin && (
              <TabsTrigger value="sync-events" data-testid="tab-sync-events">
                <Activity className="w-4 h-4 mr-2" />
                Sync Events
                {pendingEvents.length > 0 && (
                  <Badge variant="destructive" className="ml-2 h-5 px-1.5 text-xs">
                    {pendingEvents.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
            {isManagerOrAdmin && (
              <TabsTrigger value="device-health" data-testid="tab-device-health">
                <Clock className="w-4 h-4 mr-2" />
                Field Device Health
              </TabsTrigger>
            )}
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
                  When changes are made both offline and on the server, conflicts can arise. Review and resolve them here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {unresolvedConflicts.length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="w-12 h-12 mx-auto text-green-500 mb-4" />
                    <p className="font-medium" data-testid="text-no-conflicts">No Conflicts</p>
                    <p className="text-sm text-muted-foreground mt-1">All data is in sync with no conflicts to resolve</p>
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
                          <p className="text-sm text-muted-foreground">ID: {conflict.entityId}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Detected {new Date(conflict.conflictedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resolveConflictMutation.isPending}
                            onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: "LOCAL_WINS" })}
                            data-testid={`button-use-local-${conflict.id}`}
                          >
                            {resolveConflictMutation.isPending &&
                              resolveConflictMutation.variables?.id === conflict.id &&
                              resolveConflictMutation.variables?.resolution === "LOCAL_WINS" && (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              )}
                            Keep Device
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resolveConflictMutation.isPending}
                            onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: "SERVER_WINS" })}
                            data-testid={`button-use-server-${conflict.id}`}
                          >
                            {resolveConflictMutation.isPending &&
                              resolveConflictMutation.variables?.id === conflict.id &&
                              resolveConflictMutation.variables?.resolution === "SERVER_WINS" && (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              )}
                            Keep Server
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {isManagerOrAdmin && (
            <TabsContent value="sync-events">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Sync Event Log
                  </CardTitle>
                  <CardDescription>
                    Structured log of every push sync operation. Conflicts and flags require resolution before payroll finalization.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {eventsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : !syncEventsData?.items?.length ? (
                    <div className="text-center py-12">
                      <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="font-medium text-muted-foreground" data-testid="text-no-sync-events">No sync events yet</p>
                      <p className="text-sm text-muted-foreground mt-1">Events are recorded when mobile devices push changes</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {syncEventsData.items.map((event) => {
                        const outcomeInfo = OUTCOME_LABELS[event.outcome] ?? { label: event.outcome, variant: "outline" as const };
                        const needsAction = ["CONFLICT", "FLAGGED"].includes(event.outcome) && !event.resolvedAt;
                        const isExpanded = expandedEventId === event.id;

                        return (
                          <div
                            key={event.id}
                            className={`rounded-lg border p-3 ${needsAction ? "border-destructive/50 bg-destructive/5" : ""}`}
                            data-testid={`sync-event-${event.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <Badge variant={outcomeInfo.variant} className="shrink-0">
                                  {outcomeInfo.label}
                                </Badge>
                                <span className="font-medium text-sm truncate">{event.entityType}</span>
                                <span className="text-xs text-muted-foreground truncate">{event.operation}</span>
                                <span className="text-xs text-muted-foreground">•</span>
                                <span className="text-xs text-muted-foreground truncate" title={event.strategy}>{event.strategy}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {new Date(event.serverTimestamp).toLocaleString()}
                                </span>
                                {event.logicalClock != null && (
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    #{event.logicalClock}
                                  </span>
                                )}
                                {event.conflictPayload && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                                    data-testid={`button-expand-event-${event.id}`}
                                  >
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </Button>
                                )}
                              </div>
                            </div>

                            {event.resolvedAt && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <CheckCircle className="w-3 h-3 text-green-500" />
                                Resolved {new Date(event.resolvedAt).toLocaleString()}
                              </div>
                            )}

                            {isExpanded && event.conflictPayload && (
                              <div className="mt-3 p-2 rounded bg-muted/50 text-xs font-mono overflow-auto max-h-48">
                                <pre>{JSON.stringify(event.conflictPayload, null, 2)}</pre>
                              </div>
                            )}

                            {needsAction && (
                              <div className="mt-3 flex items-center gap-2 flex-wrap">
                                {event.entityType === "TIME_CLOCK_GAP" ? (
                                  <>
                                    <span className="text-xs text-muted-foreground">Clock-in gap detected:</span>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={resolveSyncEventMutation.isPending}
                                      onClick={() => resolveSyncEventMutation.mutate({ id: event.id, choice: "FLAG_PAYROLL", note: "Flagged for payroll review" })}
                                      data-testid={`button-flag-payroll-${event.id}`}
                                    >
                                      <Flag className="w-3 h-3 mr-1" />
                                      Flag for Payroll Review
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={resolveSyncEventMutation.isPending}
                                      onClick={() => resolveSyncEventMutation.mutate({ id: event.id, choice: "SERVER", note: "Acknowledged — no action needed" })}
                                      data-testid={`button-dismiss-gap-${event.id}`}
                                    >
                                      Dismiss
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={resolveSyncEventMutation.isPending}
                                      onClick={() => resolveSyncEventMutation.mutate({ id: event.id, choice: "DEVICE" })}
                                      data-testid={`button-keep-device-${event.id}`}
                                    >
                                      Keep Device Version
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={resolveSyncEventMutation.isPending}
                                      onClick={() => resolveSyncEventMutation.mutate({ id: event.id, choice: "SERVER" })}
                                      data-testid={`button-keep-server-${event.id}`}
                                    >
                                      Keep Server Version
                                    </Button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {isManagerOrAdmin && (
            <TabsContent value="device-health">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5 text-primary" />
                    Field Device Health
                  </CardTitle>
                  <CardDescription>
                    Per-device sync status. Devices not synced in {devicesData?.staleThresholdHours ?? 48}+ hours are flagged.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {devicesLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : !devicesData?.devices?.length ? (
                    <div className="text-center py-12">
                      <Smartphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="font-medium text-muted-foreground" data-testid="text-no-devices">No active devices</p>
                      <p className="text-sm text-muted-foreground mt-1">Devices appear here after registering with the mobile app</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Device</th>
                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Platform</th>
                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">App Version</th>
                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Last Sync</th>
                            <th className="text-right py-2 pr-4 font-medium text-muted-foreground">
                              <span title="Items waiting to sync (PENDING) plus items held for review after a failed push (FAILED). A non-zero count means the device needs attention.">
                                Needs Attention
                              </span>
                            </th>
                            <th className="text-right py-2 font-medium text-muted-foreground">Conflicts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devicesData.devices.map((device) => (
                            <tr
                              key={device.deviceId}
                              className="border-b last:border-0 hover:bg-muted/30"
                              data-testid={`device-row-${device.deviceId}`}
                            >
                              <td className="py-3 pr-4">
                                <div className="flex items-center gap-2">
                                  {device.isStale && (
                                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" aria-label="No sync in 48+ hours" />
                                  )}
                                  <span className="font-medium truncate max-w-[180px]">
                                    {device.deviceModel ?? device.deviceId.slice(0, 12)}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-muted-foreground capitalize">{device.platform.toLowerCase()}</td>
                              <td className="py-3 pr-4 text-muted-foreground">{device.appVersion ?? "—"}</td>
                              <td className="py-3 pr-4">
                                {device.lastSyncAt ? (
                                  <span className={device.isStale ? "text-amber-600" : "text-muted-foreground"}>
                                    {new Date(device.lastSyncAt).toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">Never</span>
                                )}
                              </td>
                              <td className="py-3 pr-4 text-right">
                                {device.pendingOutboxCount > 0 ? (
                                  <Badge variant="secondary" data-testid={`badge-pending-${device.deviceId}`}>
                                    {device.pendingOutboxCount}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </td>
                              <td className="py-3 text-right">
                                {device.unresolvedConflicts > 0 ? (
                                  <Badge variant="destructive" data-testid={`badge-conflicts-${device.deviceId}`}>
                                    {device.unresolvedConflicts}
                                  </Badge>
                                ) : (
                                  <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

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
                    For detailed offline queue management, visit the dedicated offline sync page.
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
