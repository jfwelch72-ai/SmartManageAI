import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OfflineSyncQueue } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Cloud, CloudOff, RefreshCw, Trash2, Clock, CheckCircle, XCircle, 
  AlertTriangle, FileText, Mic, Camera, Timer, StickyNote, ChevronRight
} from "lucide-react";
import { format } from "date-fns";

interface SyncStats {
  total: number;
  pending: number;
  synced: number;
  failed: number;
  byEntityType: {
    timeEntry: number;
    note: number;
    issue: number;
    voiceLog: number;
    photo: number;
  };
}

export default function OfflineSyncPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");
  const [selectedItem, setSelectedItem] = useState<OfflineSyncQueue | null>(null);

  const { data: items, isLoading, refetch } = useQuery<OfflineSyncQueue[]>({
    queryKey: ["/api/field-productivity/offline-sync", statusFilter, entityFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (entityFilter !== "ALL") params.set("entityType", entityFilter);
      const queryString = params.toString();
      return fetch(`/api/field-productivity/offline-sync${queryString ? `?${queryString}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const { data: stats } = useQuery<SyncStats>({
    queryKey: ["/api/field-productivity/offline-sync/stats"],
  });

  const clearSyncedMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/field-productivity/offline-sync/clear/synced"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/offline-sync"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/offline-sync/stats"] });
      toast({ title: "Synced items cleared" });
    },
    onError: () => {
      toast({ title: "Failed to clear synced items", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/field-productivity/offline-sync/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/offline-sync"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/offline-sync/stats"] });
      toast({ title: "Item deleted" });
      setSelectedItem(null);
    },
    onError: () => {
      toast({ title: "Failed to delete item", variant: "destructive" });
    },
  });

  const retrySyncMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/field-productivity/offline-sync/${id}`, { status: "PENDING" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/offline-sync"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/offline-sync/stats"] });
      toast({ title: "Item queued for retry" });
    },
    onError: () => {
      toast({ title: "Failed to retry sync", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "SYNCED":
        return <Badge className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" /> Synced</Badge>;
      case "FAILED":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case "TIME_ENTRY":
        return <Timer className="h-4 w-4" />;
      case "NOTE":
        return <StickyNote className="h-4 w-4" />;
      case "ISSUE":
        return <AlertTriangle className="h-4 w-4" />;
      case "VOICE_LOG":
        return <Mic className="h-4 w-4" />;
      case "PHOTO":
        return <Camera className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getOperationBadge = (operation: string) => {
    switch (operation) {
      case "CREATE":
        return <Badge variant="outline" className="text-green-600">Create</Badge>;
      case "UPDATE":
        return <Badge variant="outline" className="text-blue-600">Update</Badge>;
      case "DELETE":
        return <Badge variant="outline" className="text-red-600">Delete</Badge>;
      default:
        return <Badge variant="outline">{operation}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-offline-sync">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Offline Sync</h1>
          <p className="text-muted-foreground">Monitor and manage offline data synchronization</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button 
            variant="outline" 
            onClick={() => refetch()}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {stats && stats.synced > 0 && (
            <Button 
              variant="outline" 
              onClick={() => clearSyncedMutation.mutate()}
              disabled={clearSyncedMutation.isPending}
              data-testid="button-clear-synced"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Synced ({stats.synced})
            </Button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-total">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" /> Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-500" data-testid="stat-pending">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle className="h-4 w-4" /> Synced
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500" data-testid="stat-synced">{stats.synced}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <XCircle className="h-4 w-4" /> Failed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive" data-testid="stat-failed">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">By Entity Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Time Entries: <strong>{stats.byEntityType.timeEntry}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Notes: <strong>{stats.byEntityType.note}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Issues: <strong>{stats.byEntityType.issue}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Voice Logs: <strong>{stats.byEntityType.voiceLog}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Photos: <strong>{stats.byEntityType.photo}</strong></span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="SYNCED">Synced</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-entity-filter">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="TIME_ENTRY">Time Entry</SelectItem>
            <SelectItem value="NOTE">Note</SelectItem>
            <SelectItem value="ISSUE">Issue</SelectItem>
            <SelectItem value="VOICE_LOG">Voice Log</SelectItem>
            <SelectItem value="PHOTO">Photo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items && items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <Card 
              key={item.id} 
              className="cursor-pointer hover-elevate transition-all"
              onClick={() => setSelectedItem(item)}
              data-testid={`card-sync-item-${item.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    {getEntityIcon(item.entityType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.entityType.replace("_", " ")}</span>
                      {getOperationBadge(item.operationType)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(item.createdAt), "MMM d, yyyy h:mm a")}
                      {item.retryCount > 0 && (
                        <span className="ml-2 text-destructive">
                          ({item.retryCount} {item.retryCount === 1 ? "retry" : "retries"})
                        </span>
                      )}
                    </p>
                  </div>
                  {getStatusBadge(item.status)}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <Cloud className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">All Synced</h3>
          <p className="text-muted-foreground">
            No pending offline data to synchronize. Your data is up to date.
          </p>
        </Card>
      )}

      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedItem && getEntityIcon(selectedItem.entityType)}
              Sync Item Details
            </DialogTitle>
            <DialogDescription>
              {selectedItem && `Created ${format(new Date(selectedItem.createdAt), "MMMM d, yyyy 'at' h:mm a")}`}
            </DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(selectedItem.status)}
                  {getOperationBadge(selectedItem.operationType)}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Entity Type</span>
                    <p className="font-medium">{selectedItem.entityType.replace("_", " ")}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Operation</span>
                    <p className="font-medium">{selectedItem.operationType}</p>
                  </div>
                  {selectedItem.entityId && (
                    <div>
                      <span className="text-muted-foreground">Local ID</span>
                      <p className="font-mono text-xs">{selectedItem.entityId}</p>
                    </div>
                  )}
                  {selectedItem.syncedEntityId && (
                    <div>
                      <span className="text-muted-foreground">Server ID</span>
                      <p className="font-mono text-xs">{selectedItem.syncedEntityId}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Retry Count</span>
                    <p className="font-medium">{selectedItem.retryCount || 0}</p>
                  </div>
                  {selectedItem.lastRetryAt && (
                    <div>
                      <span className="text-muted-foreground">Last Retry</span>
                      <p className="text-xs">{format(new Date(selectedItem.lastRetryAt), "MMM d, h:mm a")}</p>
                    </div>
                  )}
                  {selectedItem.syncedAt && (
                    <div>
                      <span className="text-muted-foreground">Synced At</span>
                      <p className="text-xs">{format(new Date(selectedItem.syncedAt), "MMM d, h:mm a")}</p>
                    </div>
                  )}
                </div>

                {selectedItem.errorMessage && (
                  <div className="p-4 bg-destructive/10 rounded-lg text-sm text-destructive" data-testid="text-error">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    {selectedItem.errorMessage}
                  </div>
                )}

                {selectedItem.payload && typeof selectedItem.payload === 'object' && (
                  <div className="space-y-2">
                    <span className="text-sm text-muted-foreground">Payload</span>
                    <pre className="p-3 bg-muted rounded-lg text-xs overflow-auto max-h-40">
                      {JSON.stringify(selectedItem.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {selectedItem?.status === "FAILED" && (
              <Button
                variant="outline"
                onClick={() => retrySyncMutation.mutate(selectedItem.id)}
                disabled={retrySyncMutation.isPending}
                data-testid="button-retry-sync"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Sync
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => selectedItem && deleteMutation.mutate(selectedItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-item"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button variant="outline" onClick={() => setSelectedItem(null)} data-testid="button-close-dialog">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
