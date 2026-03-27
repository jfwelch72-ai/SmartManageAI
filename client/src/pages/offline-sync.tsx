import { useState, useEffect } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Cloud, CloudOff, RefreshCw, Trash2, Clock, CheckCircle, XCircle, 
  AlertTriangle, FileText, Mic, Camera, Timer, StickyNote, ChevronRight,
  History, WifiOff, Wifi, HardDrive, Send
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { getQueueItems, getSyncHistory, processQueue, clearSyncedItems, deleteQueueItem, retryFailedItem, type OfflineQueueItem, type SyncHistoryEntry } from "@/lib/offlineQueue";

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
  const [activeTab, setActiveTab] = useState("server-queue");
  const [localQueue, setLocalQueue] = useState<OfflineQueueItem[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [conflictItem, setConflictItem] = useState<OfflineQueueItem | null>(null);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    loadLocalData();
  }, []);

  const loadLocalData = async () => {
    try {
      const items = await getQueueItems();
      setLocalQueue(items);
      const history = await getSyncHistory(20);
      setSyncHistory(history);
    } catch {}
  };

  const handleLocalSync = async () => {
    setIsSyncing(true);
    try {
      const result = await processQueue();
      toast({
        title: "Sync complete",
        description: `${result.synced} synced, ${result.failed} failed`,
      });
      await loadLocalData();
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    }
    setIsSyncing(false);
  };

  const handleClearLocalSynced = async () => {
    try {
      await clearSyncedItems();
      toast({ title: "Cleared synced items" });
      await loadLocalData();
    } catch {
      toast({ title: "Failed to clear", variant: "destructive" });
    }
  };

  const handleDeleteLocalItem = async (id: number) => {
    try {
      await deleteQueueItem(id);
      toast({ title: "Item deleted" });
      await loadLocalData();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const handleRetryLocalItem = async (id: number) => {
    try {
      await retryFailedItem(id);
      toast({ title: "Item queued for retry" });
      await loadLocalData();
    } catch {
      toast({ title: "Failed to retry", variant: "destructive" });
    }
  };

  const isConflictError = (item: OfflineQueueItem) =>
    item.status === 'failed' && item.errorMessage?.includes('Conflict');

  const handleForceOverwrite = async (item: OfflineQueueItem) => {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Force-Overwrite': 'true',
        },
        credentials: 'include',
        body: item.body ? JSON.stringify(item.body) : undefined,
      });
      if (response.ok) {
        await deleteQueueItem(item.id!);
        toast({ title: "Changes applied", description: "Server data was overwritten with your local changes" });
      } else {
        toast({ title: "Force overwrite failed", description: `Server returned ${response.status}`, variant: "destructive" });
      }
    } catch (err: unknown) {
      toast({ title: "Force overwrite failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setConflictItem(null);
    await loadLocalData();
  };

  const handleDiscardLocal = async (item: OfflineQueueItem) => {
    await deleteQueueItem(item.id!);
    toast({ title: "Local changes discarded", description: "Server version will be kept" });
    setConflictItem(null);
    await loadLocalData();
  };

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
      case "pending":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "SYNCED":
      case "synced":
        return <Badge className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" /> Synced</Badge>;
      case "FAILED":
      case "failed":
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

  const localPendingCount = localQueue.filter(i => i.status === "pending").length;
  const localSyncedCount = localQueue.filter(i => i.status === "synced").length;
  const localFailedCount = localQueue.filter(i => i.status === "failed").length;

  return (
    <div className="p-6 space-y-6" data-testid="page-offline-sync">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Offline Sync</h1>
          <p className="text-muted-foreground">Monitor and manage offline data synchronization</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border" data-testid="status-connection">
            {isOnline ? (
              <>
                <Wifi className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-600 font-medium">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-red-500" />
                <span className="text-sm text-red-600 font-medium">Offline</span>
              </>
            )}
          </div>
          <Button 
            variant="outline" 
            onClick={() => { refetch(); loadLocalData(); }}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total">
              {(stats?.total || 0) + localQueue.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.total || 0} server, {localQueue.length} local
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500" data-testid="stat-pending">
              {(stats?.pending || 0) + localPendingCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" /> Synced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500" data-testid="stat-synced">
              {(stats?.synced || 0) + localSyncedCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4" /> Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive" data-testid="stat-failed">
              {(stats?.failed || 0) + localFailedCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="server-queue" data-testid="tab-server-queue">
            <Cloud className="h-4 w-4 mr-2" />
            Server Queue
            {stats && stats.pending > 0 && (
              <Badge variant="secondary" className="ml-2">{stats.pending}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="local-queue" data-testid="tab-local-queue">
            <HardDrive className="h-4 w-4 mr-2" />
            Local Queue
            {localPendingCount > 0 && (
              <Badge variant="secondary" className="ml-2">{localPendingCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sync-history" data-testid="tab-sync-history">
            <History className="h-4 w-4 mr-2" />
            Sync History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="server-queue" className="mt-6 space-y-4">
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
        </TabsContent>

        <TabsContent value="local-queue" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {localPendingCount > 0 && isOnline && (
              <Button
                onClick={handleLocalSync}
                disabled={isSyncing}
                data-testid="button-sync-local"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : `Sync ${localPendingCount} Item${localPendingCount !== 1 ? "s" : ""}`}
              </Button>
            )}
            {localSyncedCount > 0 && (
              <Button
                variant="outline"
                onClick={handleClearLocalSynced}
                data-testid="button-clear-local-synced"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Synced ({localSyncedCount})
              </Button>
            )}
          </div>

          {localQueue.length === 0 ? (
            <Card className="p-12 text-center">
              <HardDrive className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Local Items</h3>
              <p className="text-muted-foreground">
                No data is queued in your browser's local storage.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {localQueue.map((item) => (
                <Card key={item.id} data-testid={`card-local-item-${item.id}`}>
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
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          {item.retryCount > 0 && (
                            <span className="ml-2 text-destructive">
                              ({item.retryCount} retries)
                            </span>
                          )}
                        </p>
                        {item.errorMessage && (
                          <p className="text-xs text-destructive mt-1">{item.errorMessage}</p>
                        )}
                      </div>
                      {getStatusBadge(item.status)}
                      <div className="flex items-center gap-1">
                        {isConflictError(item) && item.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConflictItem(item)}
                            className="text-xs text-yellow-700 border-yellow-300"
                            data-testid={`button-resolve-conflict-${item.id}`}
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Resolve
                          </Button>
                        )}
                        {item.status === 'failed' && !isConflictError(item) && item.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRetryLocalItem(item.id!)}
                            data-testid={`button-retry-local-${item.id}`}
                          >
                            <RefreshCw className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => item.id && handleDeleteLocalItem(item.id)}
                          data-testid={`button-delete-local-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sync-history" className="mt-6">
          {syncHistory.length === 0 ? (
            <Card className="p-12 text-center">
              <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Sync History</h3>
              <p className="text-muted-foreground">
                Sync history will appear here after your first sync operation.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {syncHistory.map((entry) => (
                <Card key={entry.id} data-testid={`card-sync-history-${entry.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${entry.itemsFailed > 0 ? "bg-yellow-100 dark:bg-yellow-950" : "bg-green-100 dark:bg-green-950"}`}>
                          {entry.itemsFailed > 0 ? (
                            <AlertTriangle className="h-5 w-5 text-yellow-600" />
                          ) : (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {entry.itemsSynced} synced{entry.itemsFailed > 0 && `, ${entry.itemsFailed} failed`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                            {" · "}
                            {entry.duration < 1000 ? `${entry.duration}ms` : `${(entry.duration / 1000).toFixed(1)}s`}
                          </p>
                        </div>
                      </div>
                      {entry.errors.length > 0 && (
                        <Badge variant="outline" className="text-xs text-destructive">
                          {entry.errors.length} error{entry.errors.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    {entry.errors.length > 0 && (
                      <div className="mt-3 p-2 bg-destructive/5 rounded text-xs text-destructive">
                        {entry.errors.slice(0, 3).map((err, i) => (
                          <p key={i}>{err}</p>
                        ))}
                        {entry.errors.length > 3 && (
                          <p className="text-muted-foreground">+{entry.errors.length - 3} more</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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
      <Dialog open={!!conflictItem} onOpenChange={() => setConflictItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Resolve Sync Conflict
            </DialogTitle>
            <DialogDescription>
              The server version of this record has changed since you made your offline edits.
              Choose how to resolve this conflict.
            </DialogDescription>
          </DialogHeader>
          {conflictItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Entity</span>
                  <p className="font-medium">{conflictItem.entityType.replace("_", " ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Operation</span>
                  <p className="font-medium">{conflictItem.operationType}</p>
                </div>
              </div>

              {conflictItem.body && (
                <div className="space-y-2">
                  <span className="text-sm text-muted-foreground">Your Local Changes</span>
                  <pre className="p-3 bg-muted rounded-lg text-xs overflow-auto max-h-32">
                    {JSON.stringify(conflictItem.body, null, 2)}
                  </pre>
                </div>
              )}

              <div className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
                <p className="font-medium mb-1">What happened?</p>
                <p className="text-xs">
                  While you were offline, someone else updated this record on the server.
                  You can overwrite the server version with your local changes, or discard your local changes and keep the server version.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => conflictItem && handleDiscardLocal(conflictItem)}
              data-testid="button-discard-local"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Keep Server Version
            </Button>
            <Button
              variant="default"
              onClick={() => conflictItem && handleForceOverwrite(conflictItem)}
              data-testid="button-force-overwrite"
            >
              <Send className="h-4 w-4 mr-2" />
              Use My Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
