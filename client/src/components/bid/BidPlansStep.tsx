import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";
import {
  Upload,
  FileText,
  Trash2,
  ChevronRight,
  File,
  Image,
  FileSpreadsheet,
} from "lucide-react";

interface BidPlansStepProps {
  bidId: string;
  bidCode: string;
  canEdit: boolean;
  onNextStep: () => void;
}

interface BidDocument {
  id: string;
  bidId: string;
  type: string;
  title: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedAt: string;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return File;
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet;
  return FileText;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  PLANS: "Plans",
  SPECS: "Specs",
  TAKEOFF: "Takeoff",
  OTHER: "Other",
};

export default function BidPlansStep({ bidId, bidCode, canEdit, onNextStep }: BidPlansStepProps) {
  const { toast } = useToast();
  const [docType, setDocType] = useState<string>("PLANS");
  const [docTitle, setDocTitle] = useState("");

  const { data: documents = [], isLoading } = useQuery<BidDocument[]>({
    queryKey: ["/api/bids", bidCode, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidCode}/documents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const createDocMutation = useMutation({
    mutationFn: async (data: { title: string; fileName: string; fileUrl: string; objectKey?: string; fileSize?: number; mimeType?: string; type: string }) => {
      const res = await apiRequest("POST", `/api/bids/${bidCode}/documents`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "documents"] });
      setDocTitle("");
      toast({ title: "Document uploaded", description: "Plan document has been added to this bid." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiRequest("DELETE", `/api/bids/${bidCode}/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "documents"] });
      toast({ title: "Document removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove document", variant: "destructive" });
    },
  });

  const onGetUploadParameters = async () => {
    const res = await apiRequest("POST", "/api/objects/upload");
    const data = await res.json();
    return { method: "PUT" as const, url: data.uploadURL };
  };

  const handleUploadComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (!result.successful?.length) {
      toast({ title: "Error", description: "No file uploaded", variant: "destructive" });
      return;
    }
    const uploaded = result.successful[0];
    const file = uploaded.data as File;
    const fileUrl = uploaded.uploadURL?.split("?")[0] || "";
    const title = docTitle.trim() || file.name.replace(/\.[^/.]+$/, "");

    createDocMutation.mutate({
      title,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      mimeType: file.type,
      type: docType,
    });
  };

  const plansDocs = documents.filter(d => d.type === "PLANS");
  const specsDocs = documents.filter(d => d.type === "SPECS");
  const takeoffDocs = documents.filter(d => d.type === "TAKEOFF");
  const otherDocs = documents.filter(d => d.type === "OTHER");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="text-plans-step-title">
                <Upload className="w-5 h-5" />
                Step 1: Plans & Takeoff
              </CardTitle>
              <CardDescription>
                Upload all project plans, specifications, and takeoff files needed for this bid
              </CardDescription>
            </div>
            <Badge variant="outline" data-testid="badge-doc-count">{documents.length} file{documents.length !== 1 ? "s" : ""}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {canEdit && (
            <div className="border-2 border-dashed rounded-lg p-6 space-y-4" data-testid="upload-section">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label data-testid="label-doc-title">Document Title (optional)</Label>
                  <Input
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="e.g. Site Plan Sheet A1"
                    data-testid="input-doc-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label data-testid="label-doc-type">Document Type</Label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger data-testid="select-doc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLANS">Plans</SelectItem>
                      <SelectItem value="SPECS">Specifications</SelectItem>
                      <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={104857600}
                allowedFileTypes={[".pdf", ".dwg", ".dxf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".doc", ".docx"]}
                onGetUploadParameters={onGetUploadParameters}
                onComplete={handleUploadComplete}
                testId="button-upload-plan"
              >
                <Button variant="outline" className="w-full" disabled={createDocMutation.isPending} data-testid="button-upload-plan">
                  <Upload className="w-4 h-4 mr-2" />
                  {createDocMutation.isPending ? "Saving..." : "Upload Document"}
                </Button>
              </ObjectUploader>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-documents">
              <Upload className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No documents uploaded yet</p>
              <p className="text-sm">Upload project plans, specs, and takeoff files to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {[
                { label: "Plans", docs: plansDocs, type: "PLANS" },
                { label: "Specifications", docs: specsDocs, type: "SPECS" },
                { label: "Takeoff Files", docs: takeoffDocs, type: "TAKEOFF" },
                { label: "Other Documents", docs: otherDocs, type: "OTHER" },
              ].filter(group => group.docs.length > 0).map(group => (
                <div key={group.type}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">{group.label}</h4>
                  <div className="space-y-2">
                    {group.docs.map(doc => {
                      const DocIcon = getFileIcon(doc.mimeType);
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                          data-testid={`doc-item-${doc.id}`}
                        >
                          <DocIcon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" data-testid={`doc-title-${doc.id}`}>{doc.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.fileName} • {formatFileSize(doc.fileSize)}
                            </p>
                          </div>
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            {DOC_TYPE_LABELS[doc.type] || doc.type}
                          </Badge>
                          {doc.fileUrl && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 flex-shrink-0"
                              onClick={() => window.open(doc.fileUrl, "_blank")}
                              data-testid={`button-view-doc-${doc.id}`}
                            >
                              <FileText className="w-4 h-4" />
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                              onClick={() => deleteDocMutation.mutate(doc.id)}
                              disabled={deleteDocMutation.isPending}
                              data-testid={`button-delete-doc-${doc.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNextStep} data-testid="button-continue-scope">
          Continue to Scope of Work <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
