import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Smartphone,
  RefreshCw,
  Wifi,
  WifiOff,
  Cloud,
  CloudOff,
  Download,
  Upload,
  Clock,
  Trash2,
  QrCode,
  Settings,
  Database,
  HardDrive
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO, formatDistanceToNow } from "date-fns";

interface MobileDevice {
  id: string;
  userId: string;
  deviceName: string;
  deviceType: "IOS" | "ANDROID" | "PWA";
  lastSyncAt?: string;
  syncStatus: "SYNCED" | "PENDING" | "SYNCING" | "ERROR";
  offlineDataSize?: number;
  isActive: boolean;
  registeredAt: string;
}

interface SyncQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  status: "PENDING" | "SYNCING" | "SYNCED" | "FAILED";
  retryCount: number;
  createdAt: string;
}

interface MobileSyncStatusProps {
  userId?: string;
}

const DEVICE_TYPE_CONFIG = {
  IOS: { icon: Smartphone, label: "iPhone/iPad" },
  ANDROID: { icon: Smartphone, label: "Android" },
  PWA: { icon: Cloud, label: "Progressive Web App" },
};

const SYNC_STATUS_CONFIG = {
  SYNCED: { color: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Synced" },
  PENDING: { color: "bg-yellow-100 text-yellow-700", icon: Clock, label: "Pending" },
  SYNCING: { color: "bg-blue-100 text-blue-700", icon: RefreshCw, label: "Syncing" },
  ERROR: { color: "bg-red-100 text-red-700", icon: AlertCircle, label: "Error" },
};

export default function MobileSyncStatus({ userId }: MobileSyncStatusProps) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<MobileDevice | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [syncOnWifiOnly, setSyncOnWifiOnly] = useState(true);
  const [offlineDataEnabled, setOfflineDataEnabled] = useState(true);
  
  const { toast } = useToast();

  interface SyncDataResponse {
    devices: MobileDevice[];
    syncQueue: SyncQueueItem[];
    stats: {
      totalDevices: number;
      pendingChanges: number;
      lastSync: string | null;
      offlineDataSize: number;
    };
  }

  const { data, isLoading, refetch } = useQuery<SyncDataResponse>({
    queryKey: ["/api/ai-features/mobile-sync"],
  });

  const syncNowMutation = useMutation({
    mutationFn: async (deviceId?: string) => {
      const response = await apiRequest("POST", "/api/ai-features/mobile-sync/sync", {
        deviceId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/mobile-sync"] });
      toast({
        title: "Sync Started",
        description: "Your data is being synchronized",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to start sync",
        variant: "destructive",
      });
    },
  });

  const removeDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await apiRequest("DELETE", `/api/ai-features/mobile-sync/devices/${deviceId}`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/mobile-sync"] });
      toast({
        title: "Device Removed",
        description: "The device has been unregistered",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Removal Failed",
        description: error.message || "Failed to remove device",
        variant: "destructive",
      });
    },
  });

  const clearOfflineDataMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-features/mobile-sync/clear-offline", {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/mobile-sync"] });
      toast({
        title: "Offline Data Cleared",
        description: "Local offline data has been cleared",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Clear Failed",
        description: error.message || "Failed to clear offline data",
        variant: "destructive",
      });
    },
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const devices = data?.devices || [];
  const syncQueue = data?.syncQueue || [];
  const stats = data?.stats || { totalDevices: 0, pendingChanges: 0, lastSync: null, offlineDataSize: 0 };
  const isOnline = navigator.onLine;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">Mobile & Offline Sync</h2>
          <p className="text-muted-foreground">
            Manage devices and offline data synchronization
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">Offline</span>
              </>
            )}
          </div>
          <Button 
            variant="outline" 
            onClick={() => setSettingsDialogOpen(true)}
            data-testid="button-sync-settings"
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button 
            onClick={() => syncNowMutation.mutate(undefined)} 
            disabled={syncNowMutation.isPending || !isOnline}
            data-testid="button-sync-now"
          >
            {syncNowMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Sync Now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Smartphone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Devices</p>
                <p className="text-2xl font-bold">{stats.totalDevices}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", stats.pendingChanges > 0 ? "bg-yellow-100" : "bg-green-100")}>
                {stats.pendingChanges > 0 ? (
                  <Upload className="w-5 h-5 text-yellow-600" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending Changes</p>
                <p className="text-2xl font-bold">{stats.pendingChanges}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Database className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offline Data</p>
                <p className="text-2xl font-bold">{formatBytes(stats.offlineDataSize)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Clock className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Sync</p>
                <p className="text-lg font-bold">
                  {stats.lastSync 
                    ? formatDistanceToNow(parseISO(stats.lastSync), { addSuffix: true })
                    : "Never"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Registered Devices</CardTitle>
            <CardDescription>
              Devices connected to your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            {devices.length === 0 ? (
              <div className="text-center py-8">
                <Smartphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="font-medium">No Devices Registered</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Access the app from a mobile device to register it
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[250px]">
                <div className="space-y-3">
                  {devices.map(device => {
                    const DeviceIcon = DEVICE_TYPE_CONFIG[device.deviceType].icon;
                    const StatusConfig = SYNC_STATUS_CONFIG[device.syncStatus];
                    const StatusIcon = StatusConfig.icon;
                    
                    return (
                      <div 
                        key={device.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`device-${device.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded-lg">
                            <DeviceIcon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium">{device.deviceName}</p>
                            <p className="text-xs text-muted-foreground">
                              {DEVICE_TYPE_CONFIG[device.deviceType].label}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={StatusConfig.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {StatusConfig.label}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeDeviceMutation.mutate(device.id)}
                            data-testid={`button-remove-device-${device.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sync Queue</CardTitle>
            <CardDescription>
              Pending changes waiting to sync
            </CardDescription>
          </CardHeader>
          <CardContent>
            {syncQueue.length === 0 ? (
              <div className="text-center py-8">
                <Cloud className="w-12 h-12 mx-auto text-green-500 mb-4" />
                <p className="font-medium">All Synced</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No pending changes to synchronize
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[250px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncQueue.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.entityType}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.action}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            className={SYNC_STATUS_CONFIG[item.status as keyof typeof SYNC_STATUS_CONFIG]?.color || ""}
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDistanceToNow(parseISO(item.createdAt), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {stats.offlineDataSize > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Offline Data Storage</p>
                  <p className="text-sm text-muted-foreground">
                    {formatBytes(stats.offlineDataSize)} of data cached for offline use
                  </p>
                </div>
              </div>
              <Button 
                variant="outline"
                onClick={() => clearOfflineDataMutation.mutate()}
                disabled={clearOfflineDataMutation.isPending}
                data-testid="button-clear-offline"
              >
                {clearOfflineDataMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Clear Offline Data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync Settings</DialogTitle>
            <DialogDescription>
              Configure how data is synchronized across devices
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto Sync</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically sync data when changes are made
                </p>
              </div>
              <Switch
                checked={autoSync}
                onCheckedChange={setAutoSync}
                data-testid="switch-auto-sync"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Sync on Wi-Fi Only</Label>
                <p className="text-sm text-muted-foreground">
                  Only sync when connected to Wi-Fi to save data
                </p>
              </div>
              <Switch
                checked={syncOnWifiOnly}
                onCheckedChange={setSyncOnWifiOnly}
                data-testid="switch-wifi-only"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Offline Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Cache data for offline access
                </p>
              </div>
              <Switch
                checked={offlineDataEnabled}
                onCheckedChange={setOfflineDataEnabled}
                data-testid="switch-offline-mode"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
