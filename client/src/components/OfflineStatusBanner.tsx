import { useState, useEffect, useCallback } from "react";
import { WifiOff, RefreshCw, Check, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getPendingCount, processQueue } from "@/lib/offlineQueue";

export default function OfflineStatusBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {}
  }, []);

  useEffect(() => {
    const goOnline = async () => {
      setIsOffline(false);
      setDismissed(false);
      await refreshPendingCount();
      const count = await getPendingCount();
      if (count > 0) {
        try {
          setIsSyncing(true);
          const result = await processQueue();
          setSyncResult(result);
          await refreshPendingCount();
          setTimeout(() => setSyncResult(null), 5000);
        } catch (e) {
          console.error("Auto-sync on reconnect failed:", e);
        } finally {
          setIsSyncing(false);
        }
      }
    };
    const goOffline = () => {
      setIsOffline(true);
      setDismissed(false);
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    refreshPendingCount();

    const interval = setInterval(refreshPendingCount, 10000);

    const handleSWMessage = async (event: MessageEvent) => {
      if (event.data?.type === "SYNC_COMPLETE") {
        setSyncResult(event.data.results);
        refreshPendingCount();
        setTimeout(() => setSyncResult(null), 5000);
      }
      if (event.data?.type === "TRIGGER_SYNC") {
        try {
          const result = await processQueue();
          setSyncResult(result);
          await refreshPendingCount();
          setTimeout(() => setSyncResult(null), 5000);
        } catch (e) {
          console.error("Background sync failed:", e);
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSWMessage);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
      navigator.serviceWorker?.removeEventListener("message", handleSWMessage);
    };
  }, [refreshPendingCount]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await processQueue();
      setSyncResult(result);
      await refreshPendingCount();
      setTimeout(() => setSyncResult(null), 5000);
    } catch {}
    setIsSyncing(false);
  };

  if (dismissed && !isOffline) return null;
  if (!isOffline && pendingCount === 0 && !syncResult) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2 text-sm transition-all",
        isOffline
          ? "bg-destructive/10 text-destructive border-b border-destructive/20"
          : syncResult
            ? syncResult.failed > 0
              ? "bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-800"
              : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200 border-b border-green-200 dark:border-green-800"
            : "bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-800"
      )}
      data-testid="banner-offline-status"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isOffline ? (
          <>
            <WifiOff className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">You're offline</span>
            <span className="text-xs opacity-75 hidden sm:inline">
              Changes will be saved locally and synced when you're back online
            </span>
          </>
        ) : syncResult ? (
          <>
            {syncResult.failed > 0 ? (
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            ) : (
              <Check className="h-4 w-4 flex-shrink-0" />
            )}
            <span>
              Synced {syncResult.synced} item{syncResult.synced !== 1 ? "s" : ""}
              {syncResult.failed > 0 && `, ${syncResult.failed} failed`}
            </span>
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 flex-shrink-0" />
            <span>{pendingCount} item{pendingCount !== 1 ? "s" : ""} waiting to sync</span>
          </>
        )}
        {pendingCount > 0 && (
          <Badge variant="secondary" className="text-xs" data-testid="badge-pending-count">
            {pendingCount} pending
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {!isOffline && pendingCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="h-7 text-xs"
            data-testid="button-sync-now-banner"
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", isSyncing && "animate-spin")} />
            {isSyncing ? "Syncing..." : "Sync Now"}
          </Button>
        )}
        {!isOffline && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDismissed(true)}
            className="h-7 w-7 p-0"
            data-testid="button-dismiss-banner"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
