import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  History,
  Upload,
  Download,
  Archive,
  FileCheck,
  Loader2,
  GitCompare,
  Mail,
  FileInput,
  PenTool,
} from "lucide-react";
import RevisionCompareDialog from "./RevisionCompareDialog";

interface DocumentRevision {
  id: string;
  organizationId: string;
  documentId: string;
  revisionNumber: number;
  sourceType: string;
  supersedesRevisionId: string | null;
  status: string;
  storageKey: string | null;
  checksum: string | null;
  metadata: Record<string, any> | null;
  createdByUserId: string | null;
  createdAt: string;
}

interface DocumentRevisionPanelProps {
  documentId: string;
  documentTitle: string;
  userRole: string;
}

function getSourceIcon(source: string) {
  switch (source) {
    case "email": return Mail;
    case "import": return FileInput;
    case "esign": return PenTool;
    default: return Upload;
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentRevisionPanel({
  documentId,
  documentTitle,
  userRole,
}: DocumentRevisionPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [sourceType, setSourceType] = useState<string>("upload");
  const [storageKey, setStorageKey] = useState("");

  const { data: revisions = [], isLoading } = useQuery<DocumentRevision[]>({
    queryKey: ["/api/documents", documentId, "revisions"],
    enabled: open,
  });

  const createRevisionMutation = useMutation({
    mutationFn: async (data: { sourceType: string; storageKey: string; metadata?: Record<string, any> }) => {
      const res = await apiRequest("POST", `/api/documents/${documentId}/revisions`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", documentId, "revisions"] });
      setUploadOpen(false);
      setStorageKey("");
      toast({ title: "Revision created", description: "New revision has been uploaded successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create revision.", variant: "destructive" });
    },
  });

  const supersedeMutation = useMutation({
    mutationFn: async (revisionId: string) => {
      const res = await apiRequest("POST", `/api/documents/revisions/${revisionId}/supersede`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", documentId, "revisions"] });
      toast({ title: "Revision superseded" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to supersede revision.", variant: "destructive" });
    },
  });

  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(userRole);
  const canUpload = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" data-testid={`button-revisions-${documentId}`}>
          <History className="w-4 h-4 mr-1" />
          Revisions
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto" data-testid="sheet-revision-history">
        <SheetHeader>
          <SheetTitle>Revision History</SheetTitle>
          <SheetDescription>{documentTitle}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            {canUpload && (
              <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-upload-revision">
                    <Upload className="w-4 h-4 mr-1" />
                    New Revision
                  </Button>
                </DialogTrigger>
                <DialogContent data-testid="dialog-upload-revision">
                  <DialogHeader>
                    <DialogTitle>Upload New Revision</DialogTitle>
                    <DialogDescription>
                      This will supersede the current active revision.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="rev-source-type">Source Type</Label>
                      <Select value={sourceType} onValueChange={setSourceType}>
                        <SelectTrigger id="rev-source-type" data-testid="select-revision-source">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="upload">Upload</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="import">Import</SelectItem>
                          <SelectItem value="esign">E-Sign</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="rev-storage-key">Storage Key / File Path</Label>
                      <Input
                        id="rev-storage-key"
                        value={storageKey}
                        onChange={(e) => setStorageKey(e.target.value)}
                        placeholder="Enter storage key..."
                        data-testid="input-revision-storage-key"
                      />
                    </div>
                    <Button
                      onClick={() => createRevisionMutation.mutate({ sourceType, storageKey })}
                      disabled={!storageKey || createRevisionMutation.isPending}
                      data-testid="button-submit-revision"
                    >
                      {createRevisionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Create Revision
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {revisions.length >= 2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompareOpen(true)}
                data-testid="button-compare-revisions"
              >
                <GitCompare className="w-4 h-4 mr-1" />
                Compare
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : revisions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-revisions">
              No revisions tracked for this document yet.
            </div>
          ) : (
            <div className="space-y-2">
              {revisions.map((rev) => {
                const SourceIcon = getSourceIcon(rev.sourceType);
                const isActive = rev.status === "active";
                const meta = rev.metadata || {};
                const fileSize = meta.fileSize || meta.size;

                return (
                  <Card
                    key={rev.id}
                    className={`transition-colors ${isActive ? "border-primary/50 bg-primary/5" : "opacity-70"}`}
                    data-testid={`card-revision-${rev.revisionNumber}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-sm font-semibold shrink-0">
                            {rev.revisionNumber}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge
                                variant={isActive ? "default" : "secondary"}
                                className="text-xs"
                                data-testid={`badge-status-${rev.revisionNumber}`}
                              >
                                {isActive ? (
                                  <><FileCheck className="w-3 h-3 mr-1" />Active</>
                                ) : (
                                  <><Archive className="w-3 h-3 mr-1" />Superseded</>
                                )}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                <SourceIcon className="w-3 h-3 mr-1" />
                                {rev.sourceType}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatDate(rev.createdAt)}
                              {fileSize && <span className="ml-2">{formatFileSize(fileSize)}</span>}
                              {meta.fileName && <span className="ml-2 truncate">{meta.fileName}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {rev.storageKey && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild data-testid={`button-download-rev-${rev.revisionNumber}`}>
                              <a href={`/api/storage/${rev.storageKey}`} target="_blank" rel="noreferrer">
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            </Button>
                          )}
                          {isActive && isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => supersedeMutation.mutate(rev.id)}
                              disabled={supersedeMutation.isPending}
                              data-testid={`button-supersede-rev-${rev.revisionNumber}`}
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {compareOpen && (
          <RevisionCompareDialog
            documentId={documentId}
            revisions={revisions}
            open={compareOpen}
            onOpenChange={setCompareOpen}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
