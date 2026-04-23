import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, AlertTriangle, BellOff, Clock, Loader2, RefreshCw, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface SyncRetry {
  id: string;
  connectionId: string;
  provider: string;
  connectionDisplayName: string | null;
  connectionStatus: string;
  entityType: string;
  lastError: string | null;
  lastAttemptAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  maxRetries: number;
  exhausted: boolean;
  muted: boolean;
  muteScope: "connection" | "entity" | null;
}

interface SyncRetryMute {
  id: string;
  connectionId: string;
  entityType: string | null;
  mutedByUserId: string | null;
  reason: string | null;
  createdAt: string;
}

interface SyncRetryResponse {
  retries: SyncRetry[];
  maxRetries: number;
  mutes: SyncRetryMute[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const absMin = Math.round(Math.abs(diffMs) / 60_000);
  const absHr = Math.round(Math.abs(diffMs) / 3_600_000);
  if (diffMs < 0) {
    if (absMin < 1) return "just now";
    if (absMin < 60) return `${absMin}m ago`;
    if (absHr < 24) return `${absHr}h ago`;
    return date.toLocaleString();
  }
  if (absMin < 1) return "any moment";
  if (absMin < 60) return `in ${absMin}m`;
  if (absHr < 24) return `in ${absHr}h`;
  return date.toLocaleString();
}

function formatEntityType(entityType: string): string {
  return entityType
    .replace(/^sync_log_/, "")
    .replace(/^stackct_sync_log_/, "")
    .replace(/^davis_bacon:/, "Davis-Bacon: ")
    .replace(/_/g, " ");
}

export function SyncRetryPanel() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<SyncRetryResponse>({
    queryKey: ["/api/integrations/sync-retries"],
    refetchInterval: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/integrations/sync-retries/${id}/retry-now`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Retry queued", description: "Will run on the next sweep (within ~5 minutes)." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/sync-retries"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue retry", description: err.message, variant: "destructive" });
    },
  });

  // Task #1404 — mute/unmute "integration sync gave up" admin alerts per
  // connection (or per connection + entityType) without disabling the
  // underlying retries. The backend is authoritative; we refetch on
  // success so the row badge and retry list update together.
  const muteMutation = useMutation({
    mutationFn: async (args: { connectionId: string; entityType?: string }) => {
      const res = await apiRequest("POST", `/api/integrations/sync-retries/mute`, args);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: "Alerts muted",
        description: vars.entityType
          ? "You won't get emails for this entity until you unmute."
          : "You won't get emails for this integration until you unmute.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/sync-retries"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to mute alerts", description: err.message, variant: "destructive" });
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async (muteId: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/sync-retries/mute/${muteId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alerts unmuted", description: "You'll get emails again if the sync gives up." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/sync-retries"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to unmute alerts", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="card-sync-retries-loading">
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading retry status...
        </CardContent>
      </Card>
    );
  }

  const retries = data?.retries ?? [];
  const mutes = data?.mutes ?? [];
  if (retries.length === 0 && mutes.length === 0) {
    return null;
  }

  const exhaustedCount = retries.filter(r => r.exhausted).length;
  const mutesByKey = new Map<string, SyncRetryMute>();
  for (const m of mutes) {
    const key = m.entityType === null ? `${m.connectionId}::*` : `${m.connectionId}::${m.entityType}`;
    mutesByKey.set(key, m);
  }
  const muteIdForRetry = (r: SyncRetry): string | null => {
    if (r.muteScope === "connection") {
      return mutesByKey.get(`${r.connectionId}::*`)?.id ?? null;
    }
    if (r.muteScope === "entity") {
      return mutesByKey.get(`${r.connectionId}::${r.entityType}`)?.id ?? null;
    }
    return null;
  };

  return (
    <Card data-testid="card-sync-retries">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2" data-testid="text-sync-retries-title">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Integration sync retries
              <Badge variant="secondary" data-testid="badge-sync-retries-count">{retries.length}</Badge>
            </CardTitle>
            <CardDescription>
              These integration syncs failed and will retry automatically. You can also retry now.
            </CardDescription>
          </div>
          {exhaustedCount > 0 && (
            <Badge variant="destructive" data-testid="badge-sync-retries-exhausted">
              {exhaustedCount} need manual attention
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {retries.map(retry => {
          const isPending = retryMutation.isPending && retryMutation.variables === retry.id;
          const activeMuteId = muteIdForRetry(retry);
          const isMutePending =
            (muteMutation.isPending &&
              muteMutation.variables?.connectionId === retry.connectionId &&
              muteMutation.variables?.entityType === retry.entityType) ||
            (unmuteMutation.isPending && unmuteMutation.variables === activeMuteId);
          return (
            <div
              key={retry.id}
              className="border rounded-lg p-3 space-y-2"
              data-testid={`row-sync-retry-${retry.id}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm" data-testid={`text-retry-provider-${retry.id}`}>
                      {retry.connectionDisplayName || retry.provider}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-sm" data-testid={`text-retry-entity-${retry.id}`}>
                      {formatEntityType(retry.entityType)}
                    </span>
                    {retry.exhausted ? (
                      <Badge variant="destructive" className="gap-1" data-testid={`badge-retry-exhausted-${retry.id}`}>
                        <AlertTriangle className="h-3 w-3" />
                        Manual attention needed
                      </Badge>
                    ) : (
                      <Badge variant="outline" data-testid={`badge-retry-attempts-${retry.id}`}>
                        Attempt {retry.retryCount} of {retry.maxRetries}
                      </Badge>
                    )}
                    {retry.muted && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-muted-foreground/40 text-muted-foreground"
                        data-testid={`badge-retry-muted-${retry.id}`}
                      >
                        <BellOff className="h-3 w-3" />
                        {retry.muteScope === "connection" ? "Alerts muted (integration)" : "Alerts muted"}
                      </Badge>
                    )}
                  </div>
                  {retry.lastError && (
                    <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`text-retry-error-${retry.id}`}>
                      {retry.lastError}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span data-testid={`text-retry-last-${retry.id}`}>
                      Last attempt: {formatRelative(retry.lastAttemptAt)}
                    </span>
                    {!retry.exhausted && retry.nextRetryAt && (
                      <span className="flex items-center gap-1" data-testid={`text-retry-next-${retry.id}`}>
                        <Clock className="h-3 w-3" />
                        Next: {formatRelative(retry.nextRetryAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {activeMuteId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => unmuteMutation.mutate(activeMuteId)}
                      disabled={isMutePending}
                      data-testid={`button-unmute-${retry.id}`}
                    >
                      {isMutePending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Volume2 className="h-3 w-3 mr-1" />
                      )}
                      Unmute alerts
                    </Button>
                  ) : (
                    retry.exhausted && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          muteMutation.mutate({
                            connectionId: retry.connectionId,
                            entityType: retry.entityType,
                          })
                        }
                        disabled={isMutePending}
                        data-testid={`button-mute-${retry.id}`}
                      >
                        {isMutePending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <BellOff className="h-3 w-3 mr-1" />
                        )}
                        Mute alerts
                      </Button>
                    )
                  )}
                  <Button
                    size="sm"
                    variant={retry.exhausted ? "default" : "outline"}
                    onClick={() => retryMutation.mutate(retry.id)}
                    disabled={isPending}
                    data-testid={`button-retry-now-${retry.id}`}
                  >
                    {isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Retry now
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
