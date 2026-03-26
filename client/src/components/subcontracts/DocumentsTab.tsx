import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Paperclip, Trash2, Upload, FileText, Loader2, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface DocumentsTabProps {
  contractId: string;
  canEdit: boolean;
}

interface Attachment {
  id: string;
  contractId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  fileType: string | null;
  category: string;
  createdAt: string;
  uploadedBy: { id: string; firstName: string; lastName: string } | null;
}

const CATEGORIES = ["GENERAL", "CONTRACT", "CHANGE_ORDER", "INSURANCE", "LIEN_WAIVER", "SUBMITTAL", "CLOSEOUT"];

export function DocumentsTab({ contractId, canEdit }: DocumentsTabProps) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [category, setCategory] = useState("GENERAL");

  const { data: attachments = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ["/api/subcontracts", contractId, "attachments"],
    queryFn: async () => {
      const r = await fetch(`/api/subcontracts/${contractId}/attachments`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load attachments");
      return r.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: { fileName: string; fileUrl: string; category: string }) =>
      apiRequest("POST", `/api/subcontracts/${contractId}/attachments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "attachments"] });
      setShowAdd(false);
      setFileName("");
      setFileUrl("");
      setCategory("GENERAL");
      toast({ title: "Document added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      apiRequest("DELETE", `/api/subcontracts/${contractId}/attachments/${attachmentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "attachments"] });
      toast({ title: "Document removed" });
    },
  });

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const categoryLabel = (cat: string) => cat.replace(/_/g, " ");

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Paperclip className="h-4 w-4" />Documents & Attachments ({attachments.length})
        </CardTitle>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)} data-testid="button-add-document">
            <Upload className="h-4 w-4 mr-1" />Add Document
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {showAdd && (
          <div className="border rounded-md p-4 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="File name" value={fileName} onChange={e => setFileName(e.target.value)} data-testid="input-doc-name" />
              <Input placeholder="File URL" value={fileUrl} onChange={e => setFileUrl(e.target.value)} data-testid="input-doc-url" />
            </div>
            <div className="flex items-center gap-3">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-48" data-testid="select-doc-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!fileName || !fileUrl || addMutation.isPending}
                onClick={() => addMutation.mutate({ fileName, fileUrl, category })}
                data-testid="button-save-document"
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No documents attached yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map(att => (
                <TableRow key={att.id} data-testid={`row-attachment-${att.id}`}>
                  <TableCell className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1" data-testid={`link-attachment-${att.id}`}>
                      {att.fileName} <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell><Badge variant="outline">{categoryLabel(att.category)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{formatSize(att.fileSize)}</TableCell>
                  <TableCell className="text-muted-foreground">{att.uploadedBy ? `${att.uploadedBy.firstName} ${att.uploadedBy.lastName}` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(att.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(att.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-attachment-${att.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
