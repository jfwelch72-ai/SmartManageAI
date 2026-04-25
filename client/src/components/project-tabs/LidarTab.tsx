import { useState, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";
import {
  ScanLine, Upload, Eye, Trash2, Plus, Calendar, HardDrive, MapPin,
  Layers, GitCompare, FileSearch, Loader2
} from "lucide-react";
import type { LidarScan } from "@shared/schema";

const PointCloudViewer = lazy(() => import("@/components/lidar/PointCloudViewer"));

interface LidarTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function ScanStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    READY: "default", PROCESSING: "secondary", UPLOADING: "outline", ERROR: "destructive",
  };
  return <Badge variant={variants[status] || "outline"} data-testid={`badge-scan-status-${status}`}>{status}</Badge>;
}

export default function LidarTab({ projectId, projectCode, userRole }: LidarTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isEnabled } = useFeatureFlags();
  const [viewingScan, setViewingScan] = useState<LidarScan | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [newScan, setNewScan] = useState({
    fileName: "", fileUrl: "", fileFormat: "", captureDate: "", captureDevice: "", location: "", notes: "",
  });

  const lidarEnabled = isEnabled("LIDAR_SCANNER");

  const { data: scans = [], isLoading } = useQuery<LidarScan[]>({
    queryKey: ["/api/projects", projectId, "lidar-scans"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/lidar-scans`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: lidarEnabled,
  });

  const createScanMutation = useMutation({
    mutationFn: async (data: typeof newScan) => {
      const res = await apiRequest("POST", "/api/lidar-scans", {
        ...data,
        projectId,
        captureDate: data.captureDate || undefined,
        status: "READY",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "lidar-scans"] });
      setShowUploadDialog(false);
      setNewScan({ fileName: "", fileUrl: "", fileFormat: "", captureDate: "", captureDevice: "", location: "", notes: "" });
      toast({ title: "Scan uploaded" });
    },
  });

  const deleteScanMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/lidar-scans/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "lidar-scans"] });
      toast({ title: "Scan deleted" });
    },
  });

  const saveAnnotationMutation = useMutation({
    mutationFn: async (data: { scanId: string; type: string; label: string; points: string; value?: number; unit?: string }) => {
      const res = await apiRequest("POST", `/api/lidar-scans/${data.scanId}/annotations`, data);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Measurement saved" }); },
  });

  const canUpload = ["ADMIN", "MANAGER", "FIELD_WORKER", "SUPER_ADMIN", "HUSTLER"].includes(userRole);
  const canManage = ["ADMIN", "MANAGER", "SUPER_ADMIN", "HUSTLER"].includes(userRole);

  const filteredScans = scans.filter(s => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      if (!s.fileName?.toLowerCase().includes(q) && !s.location?.toLowerCase().includes(q) && !s.captureDevice?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (!lidarEnabled) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <ScanLine className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">LiDAR Scanner Not Enabled</h3>
          <p className="text-muted-foreground text-sm mt-1">This feature is not enabled for your organization. Contact your administrator.</p>
        </CardContent>
      </Card>
    );
  }

  if (viewingScan) {
    return (
      <div className="space-y-4" data-testid="lidar-tab-viewer">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewingScan(null)} data-testid="button-back-from-viewer">← Back</Button>
          <h3 className="text-lg font-semibold">{viewingScan.fileName}</h3>
          <ScanStatusBadge status={viewingScan.status} />
        </div>
        <div className="h-[600px] border rounded-lg overflow-hidden">
          <Suspense fallback={<div className="flex flex-col items-center justify-center h-full gap-3"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Loading 3D engine...</p></div>}>
            <WidgetErrorBoundary fallbackTitle="Point Cloud Viewer">
              <PointCloudViewer
                fileUrl={viewingScan.fileUrl}
                fileName={viewingScan.fileName}
                fileSize={viewingScan.fileSize}
                uploadDate={viewingScan.createdAt}
                onMeasurement={(m) => {
                  toast({ title: m.label });
                  saveAnnotationMutation.mutate({ scanId: viewingScan.id, type: m.type, label: m.label, points: JSON.stringify(m.points), value: m.value, unit: m.unit });
                }}
              />
            </WidgetErrorBoundary>
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="lidar-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">LiDAR Scans</h3>
        {canUpload && (
          <Button onClick={() => setShowUploadDialog(true)} size="sm" data-testid="button-upload-scan-tab">
            <Upload className="h-4 w-4 mr-2" /> Upload Scan
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Search scans..." className="pl-9 w-48" data-testid="input-search-tab-scans" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36" data-testid="select-filter-tab-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="READY">Ready</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="ERROR">Error</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" data-testid="badge-tab-scan-count">{filteredScans.length} scans</Badge>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => <Card key={i}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>)}
        </div>
      ) : filteredScans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ScanLine className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium" data-testid="text-tab-empty">No LiDAR scans for this project</h3>
            <p className="text-muted-foreground text-sm mt-1">Upload point cloud scans to view and analyze them here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredScans.map(scan => (
            <Card key={scan.id} className="hover:shadow-md transition-shadow" data-testid={`card-tab-scan-${scan.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base truncate">{scan.fileName}</CardTitle>
                  <ScanStatusBadge status={scan.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {scan.captureDate && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>{new Date(scan.captureDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {scan.fileSize && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <HardDrive className="h-3 w-3" />
                      <span>{(scan.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                  )}
                  {scan.location && (
                    <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate">{scan.location}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" className="flex-1" onClick={() => setViewingScan(scan)} disabled={scan.status !== "READY"} data-testid={`button-tab-view-${scan.id}`}>
                    <Eye className="h-3 w-3 mr-1" /> View
                  </Button>
                  {canManage && (
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteScanMutation.mutate(scan.id)} data-testid={`button-tab-delete-${scan.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-tab-upload">
          <DialogHeader>
            <DialogTitle>Upload LiDAR Scan</DialogTitle>
            <DialogDescription>Add a new point cloud scan. Supported: LAS, LAZ, PLY. E57 files can be uploaded but require conversion for browser viewing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Scan File *</Label>
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={MAX_STORAGE_FILE_SIZE}
                fileType="LIDAR"
                allowedFileTypes={[".las", ".laz", ".e57", ".ply"]}
                onComplete={(result) => {
                  const file = result.successful?.[0];
                  if (file) {
                    setNewScan(s => ({ ...s, fileName: file.name || "scan", fileUrl: file.uploadURL || "", fileFormat: file.name?.split(".").pop() || "las" }));
                  }
                }}
                testId="uploader-tab-lidar"
              >
                <Button variant="outline" className="w-full" data-testid="button-tab-select-file">
                  <Upload className="h-4 w-4 mr-2" /> {newScan.fileName || "Select File"}
                </Button>
              </ObjectUploader>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Capture Date</Label>
                <Input type="date" value={newScan.captureDate} onChange={e => setNewScan(s => ({ ...s, captureDate: e.target.value }))} data-testid="input-tab-date" />
              </div>
              <div>
                <Label>Device</Label>
                <Input value={newScan.captureDevice} onChange={e => setNewScan(s => ({ ...s, captureDevice: e.target.value }))} placeholder="e.g. Leica BLK360" data-testid="input-tab-device" />
              </div>
            </div>
            <div>
              <Label>Location</Label>
              <Input value={newScan.location} onChange={e => setNewScan(s => ({ ...s, location: e.target.value }))} placeholder="e.g. Building A, Floor 2" data-testid="input-tab-location" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={newScan.notes} onChange={e => setNewScan(s => ({ ...s, notes: e.target.value }))} placeholder="Additional notes..." rows={2} data-testid="input-tab-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)} data-testid="button-tab-cancel">Cancel</Button>
            <Button onClick={() => createScanMutation.mutate(newScan)} disabled={!newScan.fileName || !newScan.fileUrl || createScanMutation.isPending} data-testid="button-tab-submit">
              {createScanMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
