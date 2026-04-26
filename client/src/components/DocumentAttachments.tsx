import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_BATCH_UPLOAD_FILES, MAX_BATCH_UPLOAD_HELPER_TEXT, MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";
import {
  Paperclip,
  Upload,
  Download,
  Trash2,
  FileText,
  Image,
  File,
  Loader2,
} from "lucide-react";

interface FileAttachment {
  id: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  description?: string;
  uploadedById: string;
  uploadedByName?: string;
  uploadedAt: string;
  objectKey?: string;
}

interface DocumentAttachmentsProps {
  entityType: "rfi" | "rfi-answer" | "transmittals" | "submittals";
  entityId: string;
  canUpload: boolean;
  canDelete: boolean;
  compact?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.includes("pdf")) return FileText;
  return File;
}

export default function DocumentAttachments({
  entityType,
  entityId,
  canUpload,
  canDelete,
  compact = false,
}: DocumentAttachmentsProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);

  const isAnswerAttachment = entityType === "rfi-answer";
  const baseApiPath = (entityType === "rfi" || entityType === "rfi-answer")
    ? `/api/rfi/${entityId}/attachments`
    : `/api/${entityType}/${entityId}/files`;
  const queryParam = isAnswerAttachment ? "?isAnswerAttachment=true" : "";
  const basePath = `${baseApiPath}${queryParam}`;

  const { data: files = [], isLoading } = useQuery<FileAttachment[]>({
    queryKey: [basePath],
    enabled: !!entityId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (fileData: { fileUrl: string; fileName: string; fileSize: number; mimeType: string }) => {
      return await apiRequest("POST", basePath, fileData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [basePath] });
      toast({ title: "File uploaded", description: "Document attached successfully" });
      setIsUploading(false);
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Could not attach document", variant: "destructive" });
      setIsUploading(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      return await apiRequest("DELETE", `${baseApiPath}/${fileId}${queryParam}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [basePath] });
      toast({ title: "File removed", description: "Document removed successfully" });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not remove document", variant: "destructive" });
    },
  });


  const handleUploadComplete = useCallback((result: any) => {
    if (result.successful && result.successful.length > 0) {
      const uploaded = result.successful[0];
      const fileUrl = uploaded.uploadURL || uploaded.response?.uploadURL || "";
      const cleanUrl = fileUrl.split("?")[0];

      uploadMutation.mutate({
        fileUrl: cleanUrl,
        fileName: uploaded.name || "document",
        fileSize: uploaded.size || 0,
        mimeType: uploaded.type || "application/octet-stream",
      });
    }
  }, [uploadMutation]);

  const handleDownload = useCallback((file: FileAttachment) => {
    window.open(file.fileUrl, "_blank");
  }, []);

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <span>Attachments ({files.length})</span>
          </div>
          {canUpload && (
            <div className="flex flex-col items-end gap-0.5">
              <ObjectUploader
                maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES}
                maxFileSize={MAX_STORAGE_FILE_SIZE}
                fileType="DOCUMENT"
                onComplete={handleUploadComplete}
                testId={`button-upload-${entityType}-file`}
              >
                {isUploading || uploadMutation.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Upload className="h-3 w-3" />
                    Attach
                  </span>
                )}
              </ObjectUploader>
              <p className="text-[10px] text-muted-foreground" data-testid="hint-batch-upload-limit">{MAX_BATCH_UPLOAD_HELPER_TEXT}</p>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground py-2">Loading...</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No documents attached</div>
        ) : (
          <div className="space-y-1">
            {files.map((file) => {
              const IconComponent = getFileIcon(file.mimeType);
              return (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md border bg-card"
                  data-testid={`file-attachment-${file.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.fileSize)}
                        {file.uploadedByName ? ` by ${file.uploadedByName}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDownload(file)}
                      data-testid={`button-download-file-${file.id}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {canDelete && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(file.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-file-${file.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" />
          Documents & Attachments
          {files.length > 0 && (
            <Badge variant="secondary">{files.length}</Badge>
          )}
        </CardTitle>
        {canUpload && (
          <div className="flex flex-col items-end gap-0.5">
            <ObjectUploader
              maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES}
              maxFileSize={MAX_STORAGE_FILE_SIZE}
              fileType="DOCUMENT"
              onComplete={handleUploadComplete}
              testId={`button-upload-${entityType}-file`}
            >
              {isUploading || uploadMutation.isPending ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Uploading...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Document
                </span>
              )}
            </ObjectUploader>
            <p className="text-xs text-muted-foreground" data-testid="hint-batch-upload-limit">{MAX_BATCH_UPLOAD_HELPER_TEXT}</p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Loading attachments...</div>
        ) : files.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-md">
            No documents attached. {canUpload ? "Click \"Upload Document\" to add files." : ""}
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file) => {
              const IconComponent = getFileIcon(file.mimeType);
              return (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-md border bg-card"
                  data-testid={`file-attachment-${file.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-md bg-muted shrink-0">
                      <IconComponent className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file.fileName}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{formatFileSize(file.fileSize)}</span>
                        {file.uploadedByName && (
                          <>
                            <span>by {file.uploadedByName}</span>
                          </>
                        )}
                        <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDownload(file)}
                      data-testid={`button-download-file-${file.id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {canDelete && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(file.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-file-${file.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
