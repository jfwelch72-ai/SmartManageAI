import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Camera, Search, Eye, Upload, Download, Link2, Shield, Loader2, MapPin, Clock, User, FileText, Plus
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PhotoCustodyRecord, Project, DelayClaim } from "@shared/schema";

interface RecordWithRelations extends PhotoCustodyRecord {
  project?: {
    id: string;
    name: string;
    code: string;
  };
  actionBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  linkedClaim?: {
    id: string;
    claimNumber: string;
    title: string;
  };
}

export default function PhotoCustodyPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [selectedRecord, setSelectedRecord] = useState<RecordWithRelations | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [newRecord, setNewRecord] = useState({
    projectId: "",
    photoUrl: "",
    photoFileName: "",
    action: "CAPTURED" as "CAPTURED" | "UPLOADED" | "VIEWED" | "DOWNLOADED" | "ATTACHED_TO_CLAIM" | "EXPORTED",
    actionNotes: "",
    delayClaimId: "",
  });

  const { data: records = [], isLoading } = useQuery<RecordWithRelations[]>({
    queryKey: ["/api/delay-claims/photo-custody"],
    enabled: !!user,
  });

  const { data: projects = [] } = useQuery<{ data: Project[]; pagination: any }, Error, Project[]>({
    queryKey: ["/api/projects"],
    enabled: !!user,
    select: (response) => response.data || [],
  });

  const { data: claims = [] } = useQuery<DelayClaim[]>({
    queryKey: ["/api/delay-claims"],
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newRecord) => {
      return apiRequest("POST", "/api/delay-claims/photo-custody", {
        ...data,
        delayClaimId: data.delayClaimId || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Custody record created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims/photo-custody"] });
      setIsCreateOpen(false);
      setNewRecord({
        projectId: "",
        photoUrl: "",
        photoFileName: "",
        action: "CAPTURED",
        actionNotes: "",
        delayClaimId: "",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create record", description: error.message, variant: "destructive" });
    }
  });

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      const matchesSearch =
        record.photoFileName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.project?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.project?.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.actionNotes?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesAction = actionFilter === "ALL" || record.action === actionFilter;
      const matchesProject = projectFilter === "ALL" || record.projectId === projectFilter;

      return matchesSearch && matchesAction && matchesProject;
    });
  }, [records, searchTerm, actionFilter, projectFilter]);

  const getActionBadge = (action: string) => {
    switch (action) {
      case "CAPTURED":
        return <Badge className="bg-green-500 hover:bg-green-600"><Camera className="w-3 h-3 mr-1" />Captured</Badge>;
      case "UPLOADED":
        return <Badge className="bg-blue-500 hover:bg-blue-600"><Upload className="w-3 h-3 mr-1" />Uploaded</Badge>;
      case "VIEWED":
        return <Badge variant="outline"><Eye className="w-3 h-3 mr-1" />Viewed</Badge>;
      case "DOWNLOADED":
        return <Badge variant="secondary"><Download className="w-3 h-3 mr-1" />Downloaded</Badge>;
      case "ATTACHED_TO_CLAIM":
        return <Badge className="bg-purple-500 hover:bg-purple-600"><Link2 className="w-3 h-3 mr-1" />Attached</Badge>;
      case "EXPORTED":
        return <Badge className="bg-emerald-500 hover:bg-emerald-600"><Shield className="w-3 h-3 mr-1" />Exported</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  // Group records by photo URL to show chain of custody
  const photoChains = useMemo(() => {
    const chains = new Map<string, RecordWithRelations[]>();
    records.forEach(record => {
      const existing = chains.get(record.photoUrl) || [];
      existing.push(record);
      chains.set(record.photoUrl, existing);
    });
    return chains;
  }, [records]);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Photo Chain of Custody</h1>
          <p className="text-muted-foreground">Track photo access and usage for legal evidence</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-record">
          <Plus className="w-4 h-4 mr-2" />
          Record Event
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Records</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-count">
              {records.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Photos</CardTitle>
            <Camera className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unique-photos">
              {photoChains.size}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Linked to Claims</CardTitle>
            <Link2 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-linked-count">
              {records.filter(r => r.action === "ATTACHED_TO_CLAIM").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Exported</CardTitle>
            <Shield className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-exported-count">
              {records.filter(r => r.action === "EXPORTED").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filter Records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by file name, project, or notes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-records"
                />
              </div>
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-action-filter">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Actions</SelectItem>
                <SelectItem value="CAPTURED">Captured</SelectItem>
                <SelectItem value="UPLOADED">Uploaded</SelectItem>
                <SelectItem value="VIEWED">Viewed</SelectItem>
                <SelectItem value="DOWNLOADED">Downloaded</SelectItem>
                <SelectItem value="ATTACHED_TO_CLAIM">Attached to Claim</SelectItem>
                <SelectItem value="EXPORTED">Exported</SelectItem>
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-project-filter">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Projects</SelectItem>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Records Table / Mobile Cards */}
      {filteredRecords.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No custody records found
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div className="space-y-3">
          {filteredRecords.map((record) => (
            <Card key={record.id} data-testid={`card-record-${record.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-sm break-all" data-testid={`text-filename-${record.id}`}>
                    {record.photoFileName}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSelectedRecord(record);
                      setIsDetailOpen(true);
                    }}
                    data-testid={`button-view-record-${record.id}`}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {getActionBadge(record.action)}
                  {record.linkedClaim && (
                    <Badge variant="outline" className="text-purple-600 border-purple-600">
                      {record.linkedClaim.claimNumber}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Project</span>
                    <p>{record.project?.code || "-"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">By</span>
                    <p>{record.actionBy ? `${record.actionBy.firstName} ${record.actionBy.lastName}` : "-"}</p>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Timestamp</span>
                  <p>{record.actionAt ? format(new Date(record.actionAt), "MM/dd/yyyy HH:mm:ss") : "-"}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Linked Claim</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id} data-testid={`row-record-${record.id}`}>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate">
                      {record.photoFileName}
                    </TableCell>
                    <TableCell>
                      {record.project?.code || "-"}
                    </TableCell>
                    <TableCell>
                      {getActionBadge(record.action)}
                    </TableCell>
                    <TableCell>
                      {record.actionBy ? `${record.actionBy.firstName} ${record.actionBy.lastName}` : "-"}
                    </TableCell>
                    <TableCell>
                      {record.actionAt ? format(new Date(record.actionAt), "MM/dd/yyyy HH:mm:ss") : "-"}
                    </TableCell>
                    <TableCell>
                      {record.linkedClaim ? (
                        <Badge variant="outline" className="text-purple-600 border-purple-600">
                          {record.linkedClaim.claimNumber}
                        </Badge>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedRecord(record);
                          setIsDetailOpen(true);
                        }}
                        data-testid={`button-view-record-${record.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Photo Custody Record
            </DialogTitle>
            <DialogDescription>
              Chain of custody details for this photo
            </DialogDescription>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">File Name</Label>
                  <p className="font-mono text-sm break-all">{selectedRecord.photoFileName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Project</Label>
                  <p className="text-sm">{selectedRecord.project?.code} - {selectedRecord.project?.name}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Action</Label>
                  <div className="mt-1">{getActionBadge(selectedRecord.action)}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Performed By</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {selectedRecord.actionBy ? `${selectedRecord.actionBy.firstName} ${selectedRecord.actionBy.lastName}` : "-"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Timestamp</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {selectedRecord.actionAt ? format(new Date(selectedRecord.actionAt), "PPpp") : "-"}
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">IP Address</Label>
                  <p className="font-mono text-sm">{selectedRecord.ipAddress || "-"}</p>
                </div>
              </div>

              {selectedRecord.originalMetadataJson && (
                <div>
                  <Label className="text-muted-foreground">Original Metadata</Label>
                  <div className="mt-2 p-3 bg-muted rounded-md space-y-2">
                    {(selectedRecord.originalMetadataJson as any).captureTimestamp && (
                      <p className="text-sm">
                        <strong>Captured:</strong> {(selectedRecord.originalMetadataJson as any).captureTimestamp}
                      </p>
                    )}
                    {(selectedRecord.originalMetadataJson as any).deviceModel && (
                      <p className="text-sm">
                        <strong>Device:</strong> {(selectedRecord.originalMetadataJson as any).deviceModel}
                      </p>
                    )}
                    {(selectedRecord.originalMetadataJson as any).gpsLat && (selectedRecord.originalMetadataJson as any).gpsLng && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {(selectedRecord.originalMetadataJson as any).gpsLat.toFixed(6)}, {(selectedRecord.originalMetadataJson as any).gpsLng.toFixed(6)}
                        </span>
                      </div>
                    )}
                    {(selectedRecord.originalMetadataJson as any).fileHash && (
                      <p className="text-sm font-mono">
                        <strong>Hash:</strong> {(selectedRecord.originalMetadataJson as any).fileHash.substring(0, 16)}...
                      </p>
                    )}
                  </div>
                </div>
              )}

              {selectedRecord.actionNotes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="mt-1 text-sm bg-muted p-3 rounded-md">{selectedRecord.actionNotes}</p>
                </div>
              )}

              {selectedRecord.linkedClaim && (
                <div>
                  <Label className="text-muted-foreground">Linked Claim</Label>
                  <div className="mt-1 p-3 bg-purple-50 dark:bg-purple-950 rounded-md">
                    <p className="text-sm font-semibold">{selectedRecord.linkedClaim.claimNumber}</p>
                    <p className="text-sm text-muted-foreground">{selectedRecord.linkedClaim.title}</p>
                  </div>
                </div>
              )}

              {/* Chain of Custody Timeline */}
              {photoChains.get(selectedRecord.photoUrl) && (photoChains.get(selectedRecord.photoUrl)?.length || 0) > 1 && (
                <div>
                  <Label className="text-muted-foreground">Full Chain of Custody</Label>
                  <div className="mt-2 space-y-2">
                    {photoChains.get(selectedRecord.photoUrl)?.sort((a, b) => 
                      new Date(a.actionAt || 0).getTime() - new Date(b.actionAt || 0).getTime()
                    ).map((chainRecord, idx) => (
                      <div 
                        key={chainRecord.id} 
                        className={`flex items-center gap-3 p-2 rounded-md ${chainRecord.id === selectedRecord.id ? 'bg-primary/10' : 'bg-muted/50'}`}
                      >
                        <span className="text-xs text-muted-foreground w-4">{idx + 1}.</span>
                        {getActionBadge(chainRecord.action)}
                        <span className="text-sm">
                          {chainRecord.actionBy ? `${chainRecord.actionBy.firstName} ${chainRecord.actionBy.lastName}` : "Unknown"}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {chainRecord.actionAt ? format(new Date(chainRecord.actionAt), "MM/dd/yy HH:mm") : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Record Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Custody Event</DialogTitle>
            <DialogDescription>
              Document a new chain of custody event for a photo
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={newRecord.projectId} onValueChange={(v) => setNewRecord({ ...newRecord, projectId: v })}>
                <SelectTrigger data-testid="select-new-record-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Photo URL</Label>
              <Input
                placeholder="URL or file path to the photo"
                value={newRecord.photoUrl}
                onChange={(e) => setNewRecord({ ...newRecord, photoUrl: e.target.value })}
                data-testid="input-new-record-url"
              />
            </div>
            <div className="space-y-2">
              <Label>File Name</Label>
              <Input
                placeholder="Original file name"
                value={newRecord.photoFileName}
                onChange={(e) => setNewRecord({ ...newRecord, photoFileName: e.target.value })}
                data-testid="input-new-record-filename"
              />
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={newRecord.action} onValueChange={(v: typeof newRecord.action) => setNewRecord({ ...newRecord, action: v })}>
                <SelectTrigger data-testid="select-new-record-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAPTURED">Captured</SelectItem>
                  <SelectItem value="UPLOADED">Uploaded</SelectItem>
                  <SelectItem value="VIEWED">Viewed</SelectItem>
                  <SelectItem value="DOWNLOADED">Downloaded</SelectItem>
                  <SelectItem value="ATTACHED_TO_CLAIM">Attached to Claim</SelectItem>
                  <SelectItem value="EXPORTED">Exported</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Link to Claim (optional)</Label>
              <Select value={newRecord.delayClaimId || "NONE"} onValueChange={(v) => setNewRecord({ ...newRecord, delayClaimId: v === "NONE" ? "" : v })}>
                <SelectTrigger data-testid="select-new-record-claim">
                  <SelectValue placeholder="Select claim (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No claim</SelectItem>
                  {claims.map(claim => (
                    <SelectItem key={claim.id} value={claim.id}>
                      {claim.claimNumber} - {claim.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Additional notes about this custody event..."
                value={newRecord.actionNotes}
                onChange={(e) => setNewRecord({ ...newRecord, actionNotes: e.target.value })}
                rows={3}
                data-testid="input-new-record-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newRecord)}
              disabled={!newRecord.projectId || !newRecord.photoUrl || !newRecord.photoFileName || createMutation.isPending}
              data-testid="button-submit-record"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
