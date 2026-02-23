import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Send,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  Clock,
  Trash2,
  Download,
  Users,
} from "lucide-react";

interface Addendum {
  id: string;
  organizationId: string;
  projectId: string;
  addendumNumber: number;
  title: string;
  description: string | null;
  issuedDate: string | null;
  issuedById: string | null;
  relatedDocumentId: string | null;
  storageKey: string | null;
  fileUrl: string | null;
  fileName: string | null;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED";
  createdAt: string;
  updatedAt: string;
  totalRecipients?: number;
  acknowledgedCount?: number;
}

interface Acknowledgment {
  id: string;
  addendumId: string;
  recipientType: string;
  recipientId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

interface PlanDocument {
  id: string;
  title: string;
  type: string;
  fileName: string;
}

interface ProjectAddendaProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary" data-testid="badge-status-draft"><Clock className="w-3 h-3 mr-1" />Draft</Badge>;
    case "ISSUED":
      return <Badge variant="default" className="bg-blue-600" data-testid="badge-status-issued"><Send className="w-3 h-3 mr-1" />Issued</Badge>;
    case "ACKNOWLEDGED":
      return <Badge variant="default" className="bg-green-600" data-testid="badge-status-acknowledged"><Check className="w-3 h-3 mr-1" />Acknowledged</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function ProjectAddenda({ projectId, projectCode, userRole }: ProjectAddendaProps) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRelatedDoc, setNewRelatedDoc] = useState<string>("");
  const [newFileName, setNewFileName] = useState("");
  const [newFileUrl, setNewFileUrl] = useState("");

  const canManage = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_MANAGER"].includes(userRole);
  const canDelete = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(userRole);

  const { data: addendaList = [], isLoading } = useQuery<Addendum[]>({
    queryKey: ["/api/projects", projectId, "addenda"],
  });

  const { data: documents = [] } = useQuery<PlanDocument[]>({
    queryKey: ["/api/projects", projectCode, "documents"],
    enabled: !!projectCode,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; description?: string; relatedDocumentId?: string; fileName?: string; fileUrl?: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/addenda`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "addenda"] });
      setCreateOpen(false);
      setNewTitle("");
      setNewDescription("");
      setNewRelatedDoc("");
      setNewFileName("");
      setNewFileUrl("");
      toast({ title: "Addendum created", description: "New addendum has been created as a draft." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create addendum.", variant: "destructive" });
    },
  });

  const issueMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/addenda/${id}/issue`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "addenda"] });
      toast({ title: "Addendum issued" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to issue addendum.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/addenda/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "addenda"] });
      setExpandedId(null);
      toast({ title: "Addendum deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete addendum.", variant: "destructive" });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async ({ id, recipientName }: { id: string; recipientName: string }) => {
      const res = await apiRequest("POST", `/api/addenda/${id}/acknowledge`, {
        recipientType: "TEAM_MEMBER",
        recipientName,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "addenda"] });
      toast({ title: "Acknowledgment recorded" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to acknowledge.", variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-lg">Addenda</CardTitle>
        {canManage && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-addendum">
                <Plus className="w-4 h-4 mr-2" />
                New Addendum
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-addendum">
              <DialogHeader>
                <DialogTitle>Create New Addendum</DialogTitle>
                <DialogDescription>
                  Create a new addendum for this project. It will start as a draft.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="addendum-title">Title</Label>
                  <Input
                    id="addendum-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Enter addendum title..."
                    data-testid="input-addendum-title"
                  />
                </div>
                <div>
                  <Label htmlFor="addendum-desc">Description</Label>
                  <Textarea
                    id="addendum-desc"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Describe the addendum..."
                    rows={3}
                    data-testid="input-addendum-description"
                  />
                </div>
                <div>
                  <Label htmlFor="addendum-doc">Related Document</Label>
                  <Select value={newRelatedDoc} onValueChange={setNewRelatedDoc}>
                    <SelectTrigger id="addendum-doc" data-testid="select-addendum-document">
                      <SelectValue placeholder="Select related document (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {documents.map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.title} ({doc.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="addendum-file">File Name (optional)</Label>
                  <Input
                    id="addendum-file"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="e.g., Addendum-001.pdf"
                    data-testid="input-addendum-filename"
                  />
                </div>
                <Button
                  onClick={() =>
                    createMutation.mutate({
                      title: newTitle,
                      description: newDescription || undefined,
                      relatedDocumentId: newRelatedDoc && newRelatedDoc !== "none" ? newRelatedDoc : undefined,
                      fileName: newFileName || undefined,
                      fileUrl: newFileUrl || undefined,
                    })
                  }
                  disabled={!newTitle || createMutation.isPending}
                  data-testid="button-submit-addendum"
                >
                  {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Addendum
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : addendaList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-addenda">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No addenda have been created for this project yet.
          </div>
        ) : (
          <Table data-testid="table-addenda">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Acknowledgments</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {addendaList.map((addendum) => {
                const isExpanded = expandedId === addendum.id;
                return (
                  <>
                    <TableRow
                      key={addendum.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedId(isExpanded ? null : addendum.id)}
                      data-testid={`row-addendum-${addendum.addendumNumber}`}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono font-medium">
                        {String(addendum.addendumNumber).padStart(3, "0")}
                      </TableCell>
                      <TableCell className="font-medium">{addendum.title}</TableCell>
                      <TableCell>{getStatusBadge(addendum.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {addendum.issuedDate
                          ? new Date(addendum.issuedDate).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {(addendum.totalRecipients || 0) > 0 ? (
                          <div className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-sm">
                              {addendum.acknowledgedCount}/{addendum.totalRecipients}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {addendum.status === "DRAFT" && canManage && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => issueMutation.mutate(addendum.id)}
                              disabled={issueMutation.isPending}
                              data-testid={`button-issue-${addendum.addendumNumber}`}
                            >
                              <Send className="w-3.5 h-3.5 mr-1" />
                              Issue
                            </Button>
                          )}
                          {addendum.status === "ISSUED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                acknowledgeMutation.mutate({
                                  id: addendum.id,
                                  recipientName: "Current User",
                                })
                              }
                              disabled={acknowledgeMutation.isPending}
                              data-testid={`button-ack-${addendum.addendumNumber}`}
                            >
                              <Check className="w-3.5 h-3.5 mr-1" />
                              Acknowledge
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => deleteMutation.mutate(addendum.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-${addendum.addendumNumber}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {addendum.fileUrl && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              asChild
                              data-testid={`button-download-addendum-${addendum.addendumNumber}`}
                            >
                              <a href={addendum.fileUrl} target="_blank" rel="noreferrer">
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${addendum.id}-detail`}>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <AddendumDetail
                            addendumId={addendum.id}
                            description={addendum.description}
                            fileName={addendum.fileName}
                            relatedDocumentId={addendum.relatedDocumentId}
                            documents={documents}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddendumDetail({
  addendumId,
  description,
  fileName,
  relatedDocumentId,
  documents,
}: {
  addendumId: string;
  description: string | null;
  fileName: string | null;
  relatedDocumentId: string | null;
  documents: PlanDocument[];
}) {
  const { data: acknowledgments = [], isLoading } = useQuery<Acknowledgment[]>({
    queryKey: ["/api/addenda", addendumId, "acknowledgments"],
    queryFn: async () => {
      const res = await fetch(`/api/addenda/${addendumId}/acknowledgments`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const relatedDoc = relatedDocumentId
    ? documents.find((d) => d.id === relatedDocumentId)
    : null;

  return (
    <div className="p-3 space-y-3" data-testid={`detail-addendum-${addendumId}`}>
      {description && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Description</div>
          <p className="text-sm">{description}</p>
        </div>
      )}
      {fileName && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">File</div>
          <p className="text-sm">{fileName}</p>
        </div>
      )}
      {relatedDoc && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Related Document</div>
          <div className="flex items-center gap-1 text-sm">
            <FileText className="w-3.5 h-3.5" />
            {relatedDoc.title} ({relatedDoc.type})
          </div>
        </div>
      )}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">
          Acknowledgments {acknowledgments.length > 0 && `(${acknowledgments.filter((a) => a.acknowledgedAt).length}/${acknowledgments.length})`}
        </div>
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : acknowledgments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No acknowledgments yet.</p>
        ) : (
          <div className="space-y-1">
            {acknowledgments.map((ack) => (
              <div
                key={ack.id}
                className="flex items-center justify-between text-sm p-1.5 rounded bg-background"
                data-testid={`ack-row-${ack.id}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {ack.recipientType}
                  </Badge>
                  <span>{ack.recipientName}</span>
                  {ack.recipientEmail && (
                    <span className="text-muted-foreground text-xs">({ack.recipientEmail})</span>
                  )}
                </div>
                {ack.acknowledgedAt ? (
                  <Badge variant="default" className="bg-green-600 text-xs">
                    <Check className="w-3 h-3 mr-1" />
                    {new Date(ack.acknowledgedAt).toLocaleDateString()}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    Pending
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
