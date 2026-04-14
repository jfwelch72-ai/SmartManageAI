import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { ObjectUploader } from "@/components/ObjectUploader";
import { cn } from "@/lib/utils";
import { Upload, Download, Calendar as CalendarIcon } from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import type { OrganizationDocument, TypesResponse } from "./types";

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDocType: string;
  typesData?: TypesResponse;
  organizationId?: string;
  onSuccess: () => void;
}

export function DocumentUploadDialog({ open, onOpenChange, selectedDocType, typesData, organizationId, onSuccess }: DocumentUploadDialogProps) {
  const { toast } = useToast();
  const [uploadForm, setUploadForm] = useState({
    name: typesData?.types.find(t => t.value === selectedDocType)?.label || "",
    description: "",
    visibility: "INTERNAL",
    effectiveDate: "",
    expiresAt: "",
    notes: ""
  });

  const createDocumentMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/organization-documents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organization-documents/summary"] });
      toast({ title: "Document uploaded successfully" });
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to upload document", variant: "destructive" });
    }
  });


  const handleUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "Upload failed", variant: "destructive" });
      return;
    }
    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL?.split('?')[0] || "";
    if (!organizationId) {
      toast({ title: "Error", description: "Organization not found", variant: "destructive" });
      return;
    }
    createDocumentMutation.mutate({
      organizationId,
      type: selectedDocType,
      name: uploadForm.name || uploadedFile.name,
      description: uploadForm.description || null,
      fileUrl,
      objectKey: null,
      mimeType: uploadedFile.type || null,
      fileSize: uploadedFile.size || null,
      visibility: uploadForm.visibility,
      effectiveDate: uploadForm.effectiveDate || null,
      expiresAt: uploadForm.expiresAt || null,
      notes: uploadForm.notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload {typesData?.types.find(t => t.value === selectedDocType)?.label}</DialogTitle>
          <DialogDescription>
            {selectedDocType.includes("INSURANCE") 
              ? "Upload your insurance certificate. Make sure to set the expiration date."
              : "Upload your document. It will be available for use in generated reports."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
          <div className="space-y-2">
            <Label htmlFor="doc-name">Document Name</Label>
            <Input id="doc-name" value={uploadForm.name} onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })} placeholder="Enter document name" data-testid="input-doc-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-description">Description (Optional)</Label>
            <Textarea id="doc-description" value={uploadForm.description} onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })} placeholder="Add a description" rows={2} data-testid="input-doc-description" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-visibility">Visibility</Label>
            <Select value={uploadForm.visibility} onValueChange={(value) => setUploadForm({ ...uploadForm, visibility: value })}>
              <SelectTrigger data-testid="select-visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                {typesData?.visibilities.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {selectedDocType.includes("INSURANCE") && (
            <>
              <div className="space-y-2">
                <Label htmlFor="effective-date">Effective Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !uploadForm.effectiveDate && "text-muted-foreground")} data-testid="input-effective-date">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {uploadForm.effectiveDate ? format(parseISO(uploadForm.effectiveDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker mode="single" selected={uploadForm.effectiveDate ? parseISO(uploadForm.effectiveDate) : undefined} onSelect={(date) => setUploadForm({ ...uploadForm, effectiveDate: date ? format(date, "yyyy-MM-dd") : "" })} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiry-date">Expiration Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !uploadForm.expiresAt && "text-muted-foreground")} data-testid="input-expiry-date">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {uploadForm.expiresAt ? format(parseISO(uploadForm.expiresAt), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker mode="single" selected={uploadForm.expiresAt ? parseISO(uploadForm.expiresAt) : undefined} onSelect={(date) => setUploadForm({ ...uploadForm, expiresAt: date ? format(date, "yyyy-MM-dd") : "" })} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="doc-notes">Notes (Optional)</Label>
            <Textarea id="doc-notes" value={uploadForm.notes} onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })} placeholder="Add any notes" rows={2} data-testid="input-doc-notes" />
          </div>
          <div className="pt-2">
            <ObjectUploader
              maxNumberOfFiles={1}
              maxFileSize={52428800}
              allowedFileTypes={selectedDocType.includes("LOGO") ? ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] : ["image/png", "image/jpeg", "application/pdf"]}
              fileType={selectedDocType.includes("LOGO") ? "MEDIA" : "DOCUMENT"}
              onComplete={handleUploadComplete}
              buttonVariant="default"
              buttonClassName="w-full"
              testId="button-select-file"
            >
              <Upload className="h-4 w-4 mr-2" /> Select File to Upload
            </ObjectUploader>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DocumentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  historyDocType: string;
  typesData?: TypesResponse;
  historyDocs: OrganizationDocument[];
}

export function DocumentHistoryDialog({ open, onOpenChange, historyDocType, typesData, historyDocs }: DocumentHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Version History - {typesData?.types.find(t => t.value === historyDocType)?.label}</DialogTitle>
          <DialogDescription>View previous versions of this document</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4 max-h-96 overflow-y-auto">
          {historyDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No version history available</p>
          ) : (
            historyDocs.map((doc) => (
              <Card key={doc.id}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-medium">Version {doc.version}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.uploadedByName || "Unknown"} - {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={doc.isActive ? "default" : "secondary"} className="text-xs">
                        {doc.isActive ? "Current" : "Archived"}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => window.open(doc.fileUrl, "_blank")} data-testid={`button-view-history-${doc.id}`}>
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
