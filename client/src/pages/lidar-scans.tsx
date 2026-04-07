import { useState, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  ScanLine, Upload, Eye, Trash2, Plus, Calendar, HardDrive, MapPin,
  Layers, GitCompare, FileSearch, Loader2, AlertCircle
} from "lucide-react";
import type { LidarScan, LidarComparison } from "@shared/schema";

const PointCloudViewer = lazy(() => import("@/components/lidar/PointCloudViewer"));

function ScanStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    READY: "default",
    PROCESSING: "secondary",
    UPLOADING: "outline",
    ERROR: "destructive",
  };
  return <Badge variant={variants[status] || "outline"} data-testid={`badge-scan-status-${status}`}>{status}</Badge>;
}

export default function LidarScansPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("scans");
  const [viewingScan, setViewingScan] = useState<LidarScan | null>(null);
  const [compareScanA, setCompareScanA] = useState<string>("");
  const [compareScanB, setCompareScanB] = useState<string>("");
  const [compareType, setCompareType] = useState<"SCAN_VS_SCAN" | "SCAN_VS_BIM">("SCAN_VS_SCAN");
  const [compareBimUrl, setCompareBimUrl] = useState<string>("");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSearch, setFilterSearch] = useState<string>("");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCompareDialog, setShowCompareDialog] = useState(false);
  const [viewingCompareUrl, setViewingCompareUrl] = useState<string | null>(null);
  const [viewingBimUrl, setViewingBimUrl] = useState<string | null>(null);
  const [newScan, setNewScan] = useState({
    projectId: "",
    fileName: "",
    fileUrl: "",
    fileFormat: "",
    captureDate: "",
    captureDevice: "",
    location: "",
    notes: "",
  });

  const { data: scans = [], isLoading: scansLoading } = useQuery<LidarScan[]>({
    queryKey: ["/api/lidar-scans"],
  });

  const { data: projects = [] } = useQuery<{ data: { id: string; name: string; projectCode: string }[] }, Error, { id: string; name: string; projectCode: string }[]>({
    queryKey: ["/api/projects"],
    select: (response) => response.data,
  });

  const { data: comparisons = [] } = useQuery<LidarComparison[]>({
    queryKey: ["/api/lidar-scans", "comparisons"],
    queryFn: async () => {
      const projectIds = [...new Set(scans.map(s => s.projectId))];
      const all: LidarComparison[] = [];
      for (const pid of projectIds) {
        try {
          const res = await fetch(`/api/projects/${pid}/lidar-comparisons`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            all.push(...data);
          }
        } catch {}
      }
      return all;
    },
    enabled: scans.length > 0,
  });

  const createScanMutation = useMutation({
    mutationFn: async (data: typeof newScan) => {
      const res = await apiRequest("POST", "/api/lidar-scans", {
        ...data,
        captureDate: data.captureDate || undefined,
        status: "READY",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lidar-scans"] });
      setShowUploadDialog(false);
      setNewScan({ projectId: "", fileName: "", fileUrl: "", fileFormat: "", captureDate: "", captureDevice: "", location: "", notes: "" });
      toast({ title: "Scan uploaded", description: "LiDAR scan has been added successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create scan record.", variant: "destructive" });
    },
  });

  const deleteScanMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/lidar-scans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lidar-scans"] });
      toast({ title: "Scan deleted" });
    },
  });

  const saveAnnotationMutation = useMutation({
    mutationFn: async (data: { scanId: string; type: string; label: string; points: string; value?: number; unit?: string }) => {
      const res = await apiRequest("POST", `/api/lidar-scans/${data.scanId}/annotations`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Measurement saved", description: "Annotation saved to scan." });
    },
  });

  const deleteComparisonMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/lidar-comparisons/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lidar-scans", "comparisons"] });
      toast({ title: "Comparison deleted" });
    },
  });

  const createComparisonMutation = useMutation({
    mutationFn: async (data: { projectId: string; scanAId: string; scanBId?: string; bimDocumentUrl?: string; name: string; type: string }) => {
      const res = await apiRequest("POST", "/api/lidar-comparisons", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lidar-scans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lidar-scans", "comparisons"] });
      setShowCompareDialog(false);
      toast({ title: "Comparison created" });
    },
  });

  const filteredScans = scans.filter(s => {
    if (filterProject !== "all" && s.projectId !== filterProject) return false;
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      const matchesName = s.fileName?.toLowerCase().includes(q);
      const matchesLocation = s.location?.toLowerCase().includes(q);
      const matchesDevice = s.captureDevice?.toLowerCase().includes(q);
      const matchesNotes = s.notes?.toLowerCase().includes(q);
      const matchesFormat = s.fileFormat?.toLowerCase().includes(q);
      if (!matchesName && !matchesLocation && !matchesDevice && !matchesNotes && !matchesFormat) return false;
    }
    return true;
  });

  const canUpload = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "FIELD_WORKER" || user?.role === "SUPER_ADMIN" || user?.role === "HUSTLER";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPER_ADMIN" || user?.role === "HUSTLER";

  if (viewingScan) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col" data-testid="lidar-viewer-fullscreen">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setViewingScan(null); setViewingCompareUrl(null); setViewingBimUrl(null); }} data-testid="button-back-to-scans">
              ← Back
            </Button>
            <h2 className="text-lg font-semibold" data-testid="text-viewing-scan-name">{viewingScan.fileName}</h2>
            <ScanStatusBadge status={viewingScan.status} />
          </div>
        </div>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }>
          <PointCloudViewer
            fileUrl={viewingScan.fileUrl}
            fileName={viewingScan.fileName}
            compareFileUrl={viewingCompareUrl || undefined}
            bimOverlayUrl={viewingBimUrl || undefined}
            onMeasurement={(m) => {
              toast({ title: m.label });
              saveAnnotationMutation.mutate({
                scanId: viewingScan.id,
                type: m.type,
                label: m.label,
                points: JSON.stringify(m.points),
                value: m.value,
                unit: m.unit,
              });
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="lidar-scans-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">LiDAR Scans</h1>
          <p className="text-muted-foreground mt-1">Upload, view, and analyze 3D point cloud scans of your jobsites</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="outline" onClick={() => setShowCompareDialog(true)} data-testid="button-compare-scans">
              <GitCompare className="h-4 w-4 mr-2" />
              Compare Scans
            </Button>
          )}
          {canUpload && (
            <Button onClick={() => setShowUploadDialog(true)} data-testid="button-upload-scan">
              <Upload className="h-4 w-4 mr-2" />
              Upload Scan
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-lidar">
          <TabsTrigger value="scans" data-testid="tab-scans">
            <ScanLine className="h-4 w-4 mr-2" />
            Scans
          </TabsTrigger>
          <TabsTrigger value="comparisons" data-testid="tab-comparisons">
            <GitCompare className="h-4 w-4 mr-2" />
            Comparisons
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scans" className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative">
              <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                placeholder="Search scans..."
                className="pl-9 w-56"
                data-testid="input-search-scans"
              />
            </div>
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="w-52" data-testid="select-filter-project">
                <SelectValue placeholder="Filter by project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.projectCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="READY">Ready</SelectItem>
                <SelectItem value="PROCESSING">Processing</SelectItem>
                <SelectItem value="UPLOADING">Uploading</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" data-testid="badge-scan-count">{filteredScans.length} scans</Badge>
          </div>

          {scansLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <Card key={i}><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : filteredScans.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ScanLine className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium" data-testid="text-empty-state">No LiDAR scans yet</h3>
                <p className="text-muted-foreground text-sm mt-1">Upload your first point cloud scan to get started</p>
                {canUpload && (
                  <Button className="mt-4" onClick={() => setShowUploadDialog(true)} data-testid="button-empty-upload">
                    <Upload className="h-4 w-4 mr-2" /> Upload Scan
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredScans.map(scan => (
                <Card key={scan.id} className="hover:shadow-md transition-shadow" data-testid={`card-scan-${scan.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base truncate">{scan.fileName}</CardTitle>
                      <ScanStatusBadge status={scan.status} />
                    </div>
                    <CardDescription className="truncate">
                      {projects.find(p => p.id === scan.projectId)?.name || "Unknown Project"}
                    </CardDescription>
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
                      {scan.fileFormat && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Layers className="h-3 w-3" />
                          <span>{scan.fileFormat.toUpperCase()}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => setViewingScan(scan)}
                        disabled={scan.status !== "READY"}
                        data-testid={`button-view-scan-${scan.id}`}
                      >
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Button>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => deleteScanMutation.mutate(scan.id)}
                          data-testid={`button-delete-scan-${scan.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="comparisons" className="space-y-4">
          {comparisons.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <GitCompare className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium" data-testid="text-compare-info">Scan Comparison</h3>
                <p className="text-muted-foreground text-sm mt-1 text-center max-w-md">
                  Compare two LiDAR scans side-by-side or overlaid to track progress over time.
                  You can also overlay a BIM model on a scan to compare as-built vs. design.
                </p>
                {canManage && scans.length >= 2 && (
                  <Button className="mt-4" onClick={() => setShowCompareDialog(true)} data-testid="button-start-comparison">
                    <GitCompare className="h-4 w-4 mr-2" /> Create Comparison
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {comparisons.map(comp => {
                const scanA = scans.find(s => s.id === comp.scanAId);
                const scanB = scans.find(s => s.id === comp.scanBId);
                return (
                  <Card key={comp.id} className="hover:shadow-md transition-shadow" data-testid={`card-comparison-${comp.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base truncate">{comp.name}</CardTitle>
                        <Badge variant="outline">{comp.type === "SCAN_VS_SCAN" ? "Scan vs Scan" : "Scan vs BIM"}</Badge>
                      </div>
                      <CardDescription>
                        {projects.find(p => p.id === comp.projectId)?.name || "Unknown Project"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="text-sm space-y-1">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <ScanLine className="h-3 w-3" />
                          <span className="truncate">Scan: {scanA?.fileName || "Unknown"}</span>
                        </div>
                        {comp.type === "SCAN_VS_SCAN" && scanB && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <ScanLine className="h-3 w-3" />
                            <span className="truncate">vs: {scanB.fileName}</span>
                          </div>
                        )}
                        {comp.type === "SCAN_VS_BIM" && comp.bimDocumentUrl && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Layers className="h-3 w-3" />
                            <span className="truncate">BIM: {comp.bimDocumentUrl.split("/").pop()}</span>
                          </div>
                        )}
                        {comp.toleranceMm && (
                          <div className="text-xs text-muted-foreground">
                            Tolerance: {comp.toleranceMm}mm
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            if (scanA) {
                              setViewingScan(scanA);
                              setViewingCompareUrl(scanB?.fileUrl || null);
                              setViewingBimUrl(comp.bimDocumentUrl || null);
                            }
                          }}
                          disabled={!scanA || scanA.status !== "READY"}
                          data-testid={`button-view-comparison-${comp.id}`}
                        >
                          <Eye className="h-3 w-3 mr-1" /> View Comparison
                        </Button>
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => deleteComparisonMutation.mutate(comp.id)}
                            data-testid={`button-delete-comparison-${comp.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-lg" data-testid="dialog-upload-scan">
          <DialogHeader>
            <DialogTitle>Upload LiDAR Scan</DialogTitle>
            <DialogDescription>Add a new point cloud scan to a project. Supported formats: LAS, LAZ, PLY. E57 files can be uploaded but require server-side conversion for browser viewing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Project *</Label>
              <Select value={newScan.projectId} onValueChange={v => setNewScan(s => ({ ...s, projectId: v }))}>
                <SelectTrigger data-testid="select-upload-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Scan File *</Label>
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={500 * 1024 * 1024}
                fileType="LIDAR"
                allowedFileTypes={[".las", ".laz", ".e57", ".ply"]}
                onComplete={(result) => {
                  const file = result.successful?.[0];
                  if (file) {
                    const objectPath = file.uploadURL || "";
                    setNewScan(s => ({
                      ...s,
                      fileName: file.name || "scan",
                      fileUrl: objectPath,
                      fileFormat: file.name?.split(".").pop() || "las",
                    }));
                  }
                }}
                testId="uploader-lidar-scan"
              >
                <Button variant="outline" className="w-full" data-testid="button-select-file">
                  <Upload className="h-4 w-4 mr-2" />
                  {newScan.fileName || "Select File"}
                </Button>
              </ObjectUploader>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Capture Date</Label>
                <Input
                  type="date"
                  value={newScan.captureDate}
                  onChange={e => setNewScan(s => ({ ...s, captureDate: e.target.value }))}
                  data-testid="input-capture-date"
                />
              </div>
              <div>
                <Label>Device</Label>
                <Input
                  value={newScan.captureDevice}
                  onChange={e => setNewScan(s => ({ ...s, captureDevice: e.target.value }))}
                  placeholder="e.g. Leica BLK360"
                  data-testid="input-capture-device"
                />
              </div>
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={newScan.location}
                onChange={e => setNewScan(s => ({ ...s, location: e.target.value }))}
                placeholder="e.g. Building A, Floor 2"
                data-testid="input-location"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={newScan.notes}
                onChange={e => setNewScan(s => ({ ...s, notes: e.target.value }))}
                placeholder="Additional notes about the scan..."
                rows={3}
                data-testid="input-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)} data-testid="button-cancel-upload">
              Cancel
            </Button>
            <Button
              onClick={() => createScanMutation.mutate(newScan)}
              disabled={!newScan.projectId || !newScan.fileName || !newScan.fileUrl || createScanMutation.isPending}
              data-testid="button-submit-upload"
            >
              {createScanMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Upload Scan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCompareDialog} onOpenChange={setShowCompareDialog}>
        <DialogContent data-testid="dialog-compare-scans">
          <DialogHeader>
            <DialogTitle>Create Comparison</DialogTitle>
            <DialogDescription>Compare two scans side-by-side/overlaid, or overlay a BIM model on a scan to check as-built vs. design.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Comparison Type</Label>
              <Select value={compareType} onValueChange={(v: "SCAN_VS_SCAN" | "SCAN_VS_BIM") => { setCompareType(v); setCompareScanB(""); setCompareBimUrl(""); }}>
                <SelectTrigger data-testid="select-compare-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCAN_VS_SCAN">Scan vs Scan</SelectItem>
                  <SelectItem value="SCAN_VS_BIM">Scan vs BIM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{compareType === "SCAN_VS_BIM" ? "Scan" : "First Scan"}</Label>
              <Select value={compareScanA} onValueChange={setCompareScanA}>
                <SelectTrigger data-testid="select-compare-scan-a">
                  <SelectValue placeholder="Select scan" />
                </SelectTrigger>
                <SelectContent>
                  {scans.filter(s => s.status === "READY").map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.fileName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {compareType === "SCAN_VS_SCAN" ? (
              <div>
                <Label>Second Scan</Label>
                <Select value={compareScanB} onValueChange={setCompareScanB}>
                  <SelectTrigger data-testid="select-compare-scan-b">
                    <SelectValue placeholder="Select scan B" />
                  </SelectTrigger>
                  <SelectContent>
                    {scans.filter(s => s.status === "READY" && s.id !== compareScanA).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.fileName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>BIM/IFC File URL</Label>
                <Input
                  value={compareBimUrl}
                  onChange={e => setCompareBimUrl(e.target.value)}
                  placeholder="https://... or /api/objects/..."
                  data-testid="input-compare-bim-url"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter the URL of the IFC/BIM file to overlay on the scan for deviation analysis.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompareDialog(false)} data-testid="button-cancel-compare">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const scanA = scans.find(s => s.id === compareScanA);
                if (scanA) {
                  createComparisonMutation.mutate({
                    projectId: scanA.projectId,
                    scanAId: compareScanA,
                    ...(compareType === "SCAN_VS_SCAN" ? { scanBId: compareScanB } : { bimDocumentUrl: compareBimUrl }),
                    name: `${compareType === "SCAN_VS_SCAN" ? "Scan" : "BIM"} Comparison ${new Date().toLocaleDateString()}`,
                    type: compareType,
                  });
                }
              }}
              disabled={
                !compareScanA ||
                (compareType === "SCAN_VS_SCAN" ? !compareScanB : !compareBimUrl) ||
                createComparisonMutation.isPending
              }
              data-testid="button-submit-compare"
            >
              {createComparisonMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Comparison
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
