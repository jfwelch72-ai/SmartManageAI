import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChangeOrderFileUploader, getFileIcon, formatFileSize } from "./ChangeOrderFileUploader";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";

interface ChangeOrderFilesProps {
  changeOrderId: string;
  alwaysExpanded?: boolean;
}

export function ChangeOrderFiles({ changeOrderId, alwaysExpanded = false }: ChangeOrderFilesProps) {
  const [showFiles, setShowFiles] = useState(alwaysExpanded);
  const { toast } = useToast();
  const { user } = useAuth();

  // Query files for this change order
  const { data: files = [], isLoading, refetch } = useQuery<Array<{
    id: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    description: string;
    uploadedById: string;
    uploadedAt: string;
  }>>({
    queryKey: ["/api/change-orders", changeOrderId, "files"],
    enabled: showFiles || alwaysExpanded,
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      return apiRequest("DELETE", `/api/change-orders/${changeOrderId}/files/${fileId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrderId, "files"] });
      toast({ title: "File deleted", description: "File removed from change order" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete file", variant: "destructive" });
    },
  });

  const handleDelete = async (fileId: string, fileName: string) => {
    if (!window.confirm(`Delete ${fileName}?`)) return;
    deleteMutation.mutate(fileId);
  };

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      const response = await fetch(fileUrl, { credentials: "include" });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({ title: "Error", description: "Failed to download file", variant: "destructive" });
    }
  };

  const content = (
    <>
      {isLoading ? (
        <div className="text-sm text-muted-foreground mt-2">Loading files...</div>
      ) : files.length === 0 ? (
        <div className="text-sm text-muted-foreground mt-2">No files attached</div>
      ) : (
        <div className="mt-3 space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between gap-3 p-2 rounded border text-sm hover-elevate active-elevate-2"
              data-testid={`file-${file.id}`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {getFileIcon(file.mimeType)}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.fileSize)} • {format(new Date(file.uploadedAt), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDownload(file.fileUrl, file.fileName)}
                  data-testid={`button-download-${file.id}`}
                >
                  <Download className="w-4 h-4" />
                </Button>
                {(file.uploadedById === user?.id || ["ADMIN", "MANAGER"].includes(user?.role || "")) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(file.id, file.fileName)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-${file.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (alwaysExpanded) {
    return <div className="mt-3">{content}</div>;
  }

  return (
    <div className="mt-3">
      <Collapsible open={showFiles} onOpenChange={setShowFiles}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="hover-elevate active-elevate-2">
              {showFiles ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
              Files {files.length > 0 && `(${files.length})`}
            </Button>
          </CollapsibleTrigger>
          <ChangeOrderFileUploader
            changeOrderId={changeOrderId}
            onUploadComplete={() => refetch()}
            variant="outline"
            className="text-xs"
          />
        </div>
        
        <CollapsibleContent>
          {content}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
