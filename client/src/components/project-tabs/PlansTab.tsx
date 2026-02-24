import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ObjectUploader } from "@/components/ObjectUploader";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import DocumentRevisionPanel from "@/components/DocumentRevisionPanel";
import ProjectAddenda from "@/components/ProjectAddenda";
import { Upload, Download, Eye, FileText, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useProjectDocuments } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface PlansTabProps {
  projectCode: string;
  project: any;
}

export default function PlansTab({ projectCode, project }: PlansTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);

  const [plansSubTab, setPlansSubTab] = useState<"takeoff" | "documents" | "addenda">("documents");
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<"PLANS" | "SPECS" | "TAKEOFF" | "OTHER">("OTHER");
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleDocumentUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingDocument(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/documents", {
        projectId: project?.id,
        title: documentTitle,
        type: documentType,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      toast({ title: "Success", description: "Document uploaded successfully" });
      setShowDocumentDialog(false);
      setDocumentTitle("");
      setDocumentType("OTHER");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  return (
    <>
      <div className="border-b mb-4">
        <div className="flex gap-2">
          <Button
            variant={plansSubTab === "documents" ? "default" : "ghost"}
            onClick={() => setPlansSubTab("documents")}
            data-testid="tab-documents"
            className="rounded-b-none"
          >
            Documents
          </Button>
          <Button
            variant={plansSubTab === "takeoff" ? "default" : "ghost"}
            onClick={() => setPlansSubTab("takeoff")}
            data-testid="tab-takeoff-workspace"
            className="rounded-b-none"
          >
            Takeoff Workspace
          </Button>
          <Button
            variant={plansSubTab === "addenda" ? "default" : "ghost"}
            onClick={() => setPlansSubTab("addenda")}
            data-testid="tab-addenda"
            className="rounded-b-none"
          >
            Addenda
          </Button>
        </div>
      </div>
      
      {plansSubTab === "documents" && (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Documents</CardTitle>
              <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-upload-document">
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Document
                  </Button>
                </DialogTrigger>
                <DialogContent data-testid="dialog-upload-document">
                  <DialogHeader>
                    <DialogTitle>Upload Document</DialogTitle>
                    <DialogDescription>
                      Fill in the details below and then select a file to upload.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="document-title">Title</Label>
                      <Input
                        id="document-title"
                        value={documentTitle}
                        onChange={(e) => setDocumentTitle(e.target.value)}
                        placeholder="Enter document title..."
                        data-testid="input-document-title"
                      />
                    </div>
                    <div>
                      <Label htmlFor="document-type">Type</Label>
                      <Select
                        value={documentType}
                        onValueChange={(value: "PLANS" | "SPECS" | "TAKEOFF" | "OTHER") => setDocumentType(value)}
                      >
                        <SelectTrigger id="document-type" data-testid="select-document-type">
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
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDocumentDialog(false);
                        setDocumentTitle("");
                        setDocumentType("OTHER");
                      }}
                      data-testid="button-cancel-document"
                    >
                      Cancel
                    </Button>
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={104857600}
                      onGetUploadParameters={onGetUploadParameters}
                      onComplete={(result) => {
                        setIsUploadingDocument(true);
                        handleDocumentUploadComplete(result);
                      }}
                      buttonVariant="default"
                      testId="button-select-document-file"
                    >
                      {isUploadingDocument ? "Uploading..." : "Select File"}
                    </ObjectUploader>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {documentsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
              ) : documents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No documents uploaded yet</div>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate gap-4" data-testid={`document-${doc.id}`}>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{doc.title || doc.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <Badge variant="outline">{doc.type}</Badge>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(doc.fileUrl, '_blank')}
                          data-testid={`button-view-document-${doc.id}`}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = doc.fileUrl;
                            link.download = doc.fileName;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          data-testid={`button-download-document-${doc.id}`}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                        {doc.mimeType === 'application/pdf' && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={async () => {
                              try {
                                await apiRequest("POST", `/api/projects/${project!.id}/takeoff/import-plan`, { documentId: doc.id });
                                toast({ title: "Success", description: "Plan imported to takeoff workspace" });
                                await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                await queryClient.refetchQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                              } catch (error: any) {
                                const errorMessage = error?.message || error?.error || "Failed to import plan";
                                toast({ title: "Error", description: errorMessage, variant: "destructive" });
                              }
                            }}
                            data-testid={`button-import-takeoff-${doc.id}`}
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            Import to Takeoff
                          </Button>
                        )}
                        <DocumentRevisionPanel
                          documentId={doc.id}
                          documentTitle={doc.title || doc.fileName}
                          userRole={user?.role || ""}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-delete-document-${doc.id}`}
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent data-testid={`dialog-delete-confirm-${doc.id}`}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Document</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{doc.title || doc.fileName}"? This action cannot be undone and will also remove any takeoff sheets associated with this document.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-cancel-delete-${doc.id}`}>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => {
                                  try {
                                    await apiRequest("DELETE", `/api/documents/${doc.id}`);
                                    toast({ title: "Success", description: "Document deleted successfully" });
                                    await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.code, "documents"] });
                                    await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                  } catch (error: any) {
                                    const errorMessage = error?.message || error?.error || "Failed to delete document";
                                    toast({ title: "Error", description: errorMessage, variant: "destructive" });
                                  }
                                }}
                                data-testid={`button-confirm-delete-${doc.id}`}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
      )}
      
      {plansSubTab === "addenda" && project && (
        <ProjectAddenda
          projectId={project.id}
          projectCode={project.code}
          userRole={user?.role || ""}
        />
      )}

      {plansSubTab === "takeoff" && project && (
        <div className="h-[calc(100vh-200px)]">
          <TakeoffWorkspace projectId={project.id} projectCode={project.code} />
        </div>
      )}
    </>
  );
}
