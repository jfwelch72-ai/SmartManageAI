import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isVendor } from "@/lib/rbac";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  FileText,
  Building2,
  Calendar,
  Download,
  Eye,
} from "lucide-react";

interface SharedDocument {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string | null;
  sharedByName: string;
  contractorOrgName: string;
  sharedAt: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function getDocumentUrl(docId: string): Promise<string | null> {
  try {
    const res = await apiRequest("GET", `/api/documents/${docId}/download-url`);
    const data = await res.json();
    return data.url || null;
  } catch {
    return null;
  }
}

export default function VendorDocumentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: documents = [], isLoading } = useQuery<SharedDocument[]>({
    queryKey: ["/api/vendor/documents"],
  });

  async function handleDownload(doc: SharedDocument) {
    const url = await getDocumentUrl(doc.id);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      toast({ title: "Unable to download", description: "Could not retrieve the document URL.", variant: "destructive" });
    }
  }

  async function handlePreview(doc: SharedDocument) {
    const url = await getDocumentUrl(doc.id);
    if (url) {
      const previewable = /\.(pdf|png|jpg|jpeg|gif|webp|svg)$/i.test(doc.fileName) ||
        doc.fileType === "pdf" || (doc.fileType && /^image/.test(doc.fileType));
      if (previewable) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } else {
      toast({ title: "Unable to preview", description: "Could not retrieve the document URL.", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-background" data-testid="vendor-documents-page">
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-vendor-documents-title">
            Shared Documents
          </h1>
          <p className="text-muted-foreground">
            View documents shared by your contractor clients (read-only)
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium">No documents shared yet</p>
                <p className="text-sm mt-1">
                  Documents will appear here when contractors share them with you
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {documents.map(doc => (
              <Card key={doc.id} data-testid={`card-document-${doc.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm" data-testid={`text-doc-name-${doc.id}`}>
                          {doc.fileName}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {doc.contractorOrgName}
                          </span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">
                            {formatFileSize(doc.fileSize)}
                          </span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(doc.sharedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.category && (
                        <Badge variant="outline" className="text-xs">
                          {doc.category}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {doc.fileType}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePreview(doc)}
                        data-testid={`button-preview-doc-${doc.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(doc)}
                        data-testid={`button-download-doc-${doc.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
