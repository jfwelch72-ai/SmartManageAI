import { useState } from "react";
import { Upload, FileText, Image, File } from "lucide-react";
import type { UploadResult } from "@uppy/core";
import { ObjectUploader } from "./ObjectUploader";
import { MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ChangeOrderFileUploaderProps {
  changeOrderId: string;
  onUploadComplete?: () => void;
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
}

export function ChangeOrderFileUploader({
  changeOrderId,
  onUploadComplete,
  variant = "outline",
  className,
}: ChangeOrderFileUploaderProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);


  const handleComplete = async (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => {
    if (!result.successful || result.successful.length === 0) {
      toast({
        title: "Upload failed",
        description: "No files were uploaded successfully",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      // Upload each file's metadata to the change order
      for (const file of result.successful) {
        await apiRequest(
          "POST",
          `/api/change-orders/${changeOrderId}/files`,
          {
            fileUrl: file.uploadURL,
            fileName: file.name,
            fileSize: file.size || 0,
            mimeType: file.type || "application/octet-stream",
          }
        );
      }

      toast({
        title: "Files uploaded",
        description: `Successfully uploaded ${result.successful.length} file(s)`,
      });

      // Invalidate specific change order files query to refresh file list
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrderId, "files"] });
      
      onUploadComplete?.();
    } catch (error: any) {
      console.error("Failed to attach files to change order:", error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to attach files to change order",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <ObjectUploader
      maxNumberOfFiles={10}
      maxFileSize={MAX_STORAGE_FILE_SIZE}
      allowedFileTypes={[
        "image/*",
        "application/pdf",
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".txt",
        ".dwg",
        ".dxf",
      ]}
      fileType="DOCUMENT"
      onComplete={handleComplete}
      buttonVariant={variant}
      buttonClassName={className}
      testId="button-upload-change-order-files"
    >
      <Upload className="w-4 h-4 mr-2" />
      {isUploading ? "Uploading..." : "Upload Files"}
    </ObjectUploader>
  );
}

// File type icon helper
export function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return <Image className="w-4 h-4" />;
  } else if (mimeType === "application/pdf") {
    return <FileText className="w-4 h-4" />;
  } else {
    return <File className="w-4 h-4" />;
  }
}

// File size formatter
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}
