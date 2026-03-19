import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  FileCheck,
  Eye,
  CheckCircle2,
  XCircle,
  Send,
  RotateCcw,
  Trash2,
  Edit,
  Link as LinkIcon,
  MessageSquare,
  FileText,
  Plus,
  Paperclip,
  Download,
  File,
  Image,
  X,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import type { Submittal, RFI, SubmittalCreateForm, SubmittalItem, SubmittalAttachment } from "@/hooks/useSubmittalMutations";
import { SUBMITTAL_CATEGORIES, SUBMITTAL_CATEGORY_LABELS, type SubmittalCategory } from "@/hooks/useSubmittalMutations";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function getStatusBadge(status: string, prefix = "") {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary" data-testid={`${prefix}badge-status-draft`}>Draft</Badge>;
    case "SUBMITTED":
      return <Badge variant="default" data-testid={`${prefix}badge-status-submitted`}>Submitted</Badge>;
    case "UNDER_REVIEW":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`${prefix}badge-status-under-review`}>Under Review</Badge>;
    case "APPROVED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`${prefix}badge-status-approved`}>Approved</Badge>;
    case "APPROVED_AS_NOTED":
      return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400" data-testid={`${prefix}badge-status-approved-as-noted`}>Approved As Noted</Badge>;
    case "REJECTED":
      return <Badge variant="destructive" data-testid={`${prefix}badge-status-rejected`}>Rejected</Badge>;
    case "REVISE_AND_RESUBMIT":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`${prefix}badge-status-revise`}>Revise & Resubmit</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function getPhaseBadge(phase: string) {
  switch (phase) {
    case "ESTIMATE":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Estimate</Badge>;
    case "AWARDED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Awarded</Badge>;
    case "CONSTRUCTION":
      return <Badge variant="default">Construction</Badge>;
    default:
      return <Badge variant="outline">{phase}</Badge>;
  }
}

export function getTypeBadge(type: string) {
  switch (type) {
    case "CONTRACTOR":
      return <Badge variant="default">Contractor</Badge>;
    case "SUBCONTRACTOR":
      return <Badge variant="outline">Subcontractor</Badge>;
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

function getCategoryBadge(category: SubmittalCategory | null) {
  if (!category) return null;
  return (
    <Badge variant="outline" className="text-xs">
      {SUBMITTAL_CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

function getItemStatusBadge(status: string) {
  switch (status) {
    case "APPROVED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">Approved</Badge>;
    case "REJECTED":
      return <Badge variant="destructive" className="text-xs">Rejected</Badge>;
    case "REVISE":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs">Revise</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">Pending</Badge>;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string | null) {
  const mt = mimeType ?? "";
  if (mt.startsWith("image/")) return Image;
  if (mt.includes("pdf")) return FileText;
  return File;
}

interface SubmittalItemsTabProps {
  submittal: Submittal;
  canEdit: boolean;
}

function SubmittalItemsTab({ submittal, canEdit }: SubmittalItemsTabProps) {
  const { toast } = useToast();
  const isDraft = submittal.status === "DRAFT";
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<SubmittalItem | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    description: "",
    category: "",
    specSection: "",
    manufacturer: "",
    modelNumber: "",
    quantity: "",
    unit: "",
  });

  const itemsKey = ["/api/submittals", submittal.id, "items"];

  const { data: items = [], isLoading } = useQuery<SubmittalItem[]>({
    queryKey: itemsKey,
    enabled: !!submittal.id,
  });

  const handleAddItem = async () => {
    if (!addForm.description.trim()) return;
    try {
      await apiRequest("POST", `/api/submittals/${submittal.id}/items`, {
        description: addForm.description,
        submittalCategory: addForm.category || undefined,
        specSection: addForm.specSection || undefined,
        manufacturer: addForm.manufacturer || undefined,
        modelNumber: addForm.modelNumber || undefined,
        quantity: addForm.quantity || undefined,
        unit: addForm.unit || undefined,
      });
      queryClient.invalidateQueries({ queryKey: itemsKey });
      toast({ title: "Item added" });
      setAddForm({ description: "", category: "", specSection: "", manufacturer: "", modelNumber: "", quantity: "", unit: "" });
      setShowAddForm(false);
    } catch (error: any) {
      toast({ title: "Failed to add item", description: error.message, variant: "destructive" });
    }
  };

  const handleUpdateItem = async () => {
    if (!editingItem) return;
    try {
      await apiRequest("PATCH", `/api/submittals/${submittal.id}/items/${editingItem.id}`, {
        description: editingItem.description,
        submittalCategory: editingItem.submittalCategory || null,
        specSection: editingItem.specSection || null,
        manufacturer: editingItem.manufacturer || null,
        modelNumber: editingItem.modelNumber || null,
        quantity: editingItem.quantity || null,
        unit: editingItem.unit || null,
      });
      queryClient.invalidateQueries({ queryKey: itemsKey });
      toast({ title: "Item updated" });
      setEditingItem(null);
    } catch (error: any) {
      toast({ title: "Failed to update item", description: error.message, variant: "destructive" });
    }
  };

  const handleDeleteItem = async () => {
    if (!deletingItemId) return;
    try {
      await apiRequest("DELETE", `/api/submittals/${submittal.id}/items/${deletingItemId}`);
      queryClient.invalidateQueries({ queryKey: itemsKey });
      toast({ title: "Item deleted" });
    } catch (error: any) {
      toast({ title: "Failed to delete item", description: error.message, variant: "destructive" });
    } finally {
      setDeletingItemId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="submittal-items-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</p>
        {canEdit && isDraft && (
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        )}
      </div>

      {showAddForm && (
        <div className="border rounded-md p-4 space-y-3 bg-muted/30" data-testid="form-add-item">
          <p className="text-sm font-medium">New Item</p>
          <div className="space-y-2">
            <Label className="text-xs">Description *</Label>
            <Input
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              placeholder="Item description..."
              data-testid="input-item-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Category</Label>
              <Select value={addForm.category} onValueChange={(v) => setAddForm({ ...addForm, category: v })}>
                <SelectTrigger data-testid="select-item-category">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {SUBMITTAL_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{SUBMITTAL_CATEGORY_LABELS[cat]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Spec Section</Label>
              <Input
                value={addForm.specSection}
                onChange={(e) => setAddForm({ ...addForm, specSection: e.target.value })}
                placeholder="e.g., 03 30 00"
                data-testid="input-item-spec-section"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Manufacturer</Label>
              <Input
                value={addForm.manufacturer}
                onChange={(e) => setAddForm({ ...addForm, manufacturer: e.target.value })}
                placeholder="Manufacturer"
                data-testid="input-item-manufacturer"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Model Number</Label>
              <Input
                value={addForm.modelNumber}
                onChange={(e) => setAddForm({ ...addForm, modelNumber: e.target.value })}
                placeholder="Model #"
                data-testid="input-item-model-number"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                value={addForm.quantity}
                onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })}
                placeholder="Qty"
                data-testid="input-item-quantity"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Unit</Label>
              <Input
                value={addForm.unit}
                onChange={(e) => setAddForm({ ...addForm, unit: e.target.value })}
                placeholder="EA, SF, LF..."
                data-testid="input-item-unit"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} data-testid="button-cancel-add-item">Cancel</Button>
            <Button size="sm" onClick={handleAddItem} disabled={!addForm.description.trim()} data-testid="button-confirm-add-item">Add Item</Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-items">No items added yet</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Spec Section</TableHead>
                <TableHead>Manufacturer</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && isDraft && <TableHead className="w-20">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                editingItem?.id === item.id ? (
                  <TableRow key={item.id} data-testid={`row-item-editing-${item.id}`}>
                    <TableCell>{item.itemNumber}</TableCell>
                    <TableCell>
                      <Input
                        value={editingItem.description}
                        onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                        className="h-7 text-xs"
                        data-testid={`input-edit-description-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={editingItem.submittalCategory ?? "NONE"}
                        onValueChange={(v) => setEditingItem({ ...editingItem, submittalCategory: v === "NONE" ? null : v as SubmittalCategory })}
                      >
                        <SelectTrigger className="h-7 text-xs" data-testid={`select-edit-category-${item.id}`}>
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">None</SelectItem>
                          {SUBMITTAL_CATEGORIES.map(cat => (
                            <SelectItem key={cat} value={cat}>{SUBMITTAL_CATEGORY_LABELS[cat]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editingItem.specSection ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, specSection: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="Spec section"
                        data-testid={`input-edit-spec-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editingItem.manufacturer ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, manufacturer: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="Manufacturer"
                        data-testid={`input-edit-manufacturer-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editingItem.modelNumber ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, modelNumber: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="Model #"
                        data-testid={`input-edit-model-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editingItem.quantity ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, quantity: e.target.value })}
                        className="h-7 text-xs w-16"
                        placeholder="Qty"
                        data-testid={`input-edit-quantity-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>{getItemStatusBadge(item.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleUpdateItem} data-testid={`button-save-item-${item.id}`}>
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingItem(null)} data-testid={`button-cancel-edit-item-${item.id}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                    <TableCell className="text-sm">{item.itemNumber}</TableCell>
                    <TableCell className="text-sm" data-testid={`text-item-description-${item.id}`}>{item.description}</TableCell>
                    <TableCell>{getCategoryBadge(item.submittalCategory)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-item-spec-${item.id}`}>{item.specSection || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-item-manufacturer-${item.id}`}>{item.manufacturer || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-item-model-${item.id}`}>{item.modelNumber || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.quantity ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "-"}
                    </TableCell>
                    <TableCell>{getItemStatusBadge(item.status)}</TableCell>
                    {canEdit && isDraft && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingItem(item)} data-testid={`button-edit-item-${item.id}`}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setDeletingItemId(item.id)} data-testid={`button-delete-item-${item.id}`}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!deletingItemId} onOpenChange={(open) => { if (!open) setDeletingItemId(null); }}>
        <DialogContent data-testid="dialog-confirm-delete-item">
          <DialogHeader>
            <DialogTitle>Delete Item</DialogTitle>
            <DialogDescription>Are you sure you want to delete this item? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingItemId(null)} data-testid="button-cancel-delete-item">Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteItem} data-testid="button-confirm-delete-item">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SubmittalAttachmentsTabProps {
  submittal: Submittal;
  canUpload: boolean;
  canDeleteAny: boolean;
  currentUserId: string;
}

function SubmittalAttachmentsTab({ submittal, canUpload, canDeleteAny, currentUserId }: SubmittalAttachmentsTabProps) {
  const { toast } = useToast();
  const [selectedItemId, setSelectedItemId] = useState("SUBMITTAL_LEVEL");

  const attachKey = ["/api/submittals", submittal.id, "attachments"];
  const itemsKey = ["/api/submittals", submittal.id, "items"];

  const { data: attachments = [], isLoading } = useQuery<SubmittalAttachment[]>({
    queryKey: attachKey,
    enabled: !!submittal.id,
  });

  const { data: items = [] } = useQuery<SubmittalItem[]>({
    queryKey: itemsKey,
    enabled: !!submittal.id,
  });

  const handleUploadComplete = useCallback(async (result: any) => {
    if (result.successful && result.successful.length > 0) {
      const uploaded = result.successful[0];
      const fileUrl = (uploaded.uploadURL || uploaded.response?.uploadURL || "").split("?")[0];
      try {
        await apiRequest("POST", `/api/submittals/${submittal.id}/attachments`, {
          fileUrl,
          fileName: uploaded.name || "document",
          fileSize: uploaded.size || 0,
          mimeType: uploaded.type || "application/octet-stream",
          submittalItemId: selectedItemId === "SUBMITTAL_LEVEL" ? undefined : selectedItemId,
        });
        queryClient.invalidateQueries({ queryKey: attachKey });
        toast({ title: "Attachment uploaded successfully" });
      } catch (error: any) {
        toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      }
    }
  }, [submittal.id, selectedItemId, toast]);

  const handleDelete = async (attachId: string, uploadedById: string) => {
    if (!canDeleteAny && uploadedById !== currentUserId) {
      toast({ title: "Permission denied", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("DELETE", `/api/submittals/${submittal.id}/attachments/${attachId}`);
      queryClient.invalidateQueries({ queryKey: attachKey });
      toast({ title: "Attachment deleted" });
    } catch (error: any) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    }
  };

  const getItemLabel = (itemId: string | null) => {
    if (!itemId) return "Submittal Level";
    const item = items.find(i => i.id === itemId);
    return item ? `Item #${item.itemNumber}: ${item.description}` : "Item";
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="submittal-attachments-tab">
      {canUpload && (
        <div className="flex items-center gap-3 flex-wrap border rounded-md p-3 bg-muted/30">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Label className="text-xs whitespace-nowrap">Attach to:</Label>
            <Select value={selectedItemId} onValueChange={setSelectedItemId}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-attach-to-item">
                <SelectValue placeholder="Submittal Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUBMITTAL_LEVEL">Submittal Level</SelectItem>
                {items.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    Item #{item.itemNumber}: {item.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ObjectUploader
            maxNumberOfFiles={5}
            maxFileSize={52428800}
            fileType="DOCUMENT"
            onComplete={handleUploadComplete}
            testId="button-upload-submittal-attachment"
          >
            <span className="flex items-center gap-1.5">
              <Paperclip className="h-3 w-3" />
              Upload File
            </span>
          </ObjectUploader>
        </div>
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-attachments">No attachments yet</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((att) => {
            const IconComponent = getFileIcon(att.mimeType);
            const canDelete = canDeleteAny || att.uploadedById === currentUserId;
            return (
              <div
                key={att.id}
                className="flex items-center gap-3 p-2 rounded-md border bg-card"
                data-testid={`attachment-item-${att.id}`}
              >
                <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" data-testid={`text-attach-name-${att.id}`}>{att.fileName}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{formatFileSize(att.fileSize ?? 0)}</span>
                    {att.uploadedByName && (
                      <span className="text-xs text-muted-foreground">by {att.uploadedByName}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{format(new Date(att.createdAt), "MMM d, yyyy")}</span>
                    <Badge variant="outline" className="text-xs" data-testid={`badge-attach-scope-${att.id}`}>
                      {getItemLabel(att.submittalItemId)}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/submittals/${submittal.id}/attachments/${att.id}/download`, { credentials: "include" });
                        if (!res.ok) throw new Error("Download failed");
                        const { url } = await res.json();
                        window.open(url, "_blank");
                      } catch {
                        toast({ title: "Failed to get download link", variant: "destructive" });
                      }
                    }}
                    data-testid={`button-download-attach-${att.id}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  {canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleDelete(att.id, att.uploadedById)}
                      data-testid={`button-delete-attach-${att.id}`}
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

interface SubmittalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submittal: Submittal | null;
  selectedDetail?: Submittal | null;
  testIdPrefix?: string;
  mutations: {
    submitMutation: { mutate: (id: string) => void; isPending: boolean };
    startReviewMutation: { mutate: (id: string) => void; isPending: boolean };
    resubmitMutation: { mutate: (id: string) => void; isPending: boolean };
    deleteMutation: { mutate: (id: string) => void; isPending: boolean };
    addCommentMutation: { mutate: (args: { id: string; comment: string }) => void; isPending: boolean };
    reviewMutation: { mutate: (args: { id: string; action: string; comments: string }) => void; isPending: boolean };
    linkRfiMutation: { mutate: (args: { id: string; rfiId: string }) => void; isPending: boolean };
  };
  onEdit?: (submittal: Submittal) => void;
  userRole?: string;
  currentUserId?: string;
  attachmentsSlot?: React.ReactNode;
}

export function SubmittalDetailDialog({
  open,
  onOpenChange,
  submittal,
  selectedDetail,
  testIdPrefix = "",
  mutations,
  onEdit,
  userRole = "",
  currentUserId = "",
  attachmentsSlot
}: SubmittalDetailDialogProps) {
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showLinkRfiDialog, setShowLinkRfiDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [newComment, setNewComment] = useState("");
  const [selectedRfiId, setSelectedRfiId] = useState("");

  const { data: rfis = [] } = useQuery<RFI[]>({
    queryKey: ["/api/rfi", submittal?.projectId ? `?projectId=${submittal.projectId}` : ""],
    enabled: !!submittal?.projectId && showLinkRfiDialog
  });

  const detail = selectedDetail || submittal;

  const canManageItems = ["ADMIN", "MANAGER", "PROJECT_ENGINEER", "SUPER_ADMIN"].includes(userRole);
  const canUploadAttachments = ["ADMIN", "MANAGER", "PROJECT_ENGINEER", "SUPERINTENDENT", "SUPER_ADMIN"].includes(userRole);
  const canDeleteAnyAttachment = ["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(userRole);

  const openReviewDialog = (action: string) => {
    setReviewAction(action);
    setReviewComments("");
    setShowReviewDialog(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid={`${testIdPrefix}text-detail-title`}>
              <FileCheck className="h-5 w-5" />
              {detail?.submittalNumber}
              {detail && getStatusBadge(detail.status, testIdPrefix)}
              {detail && getTypeBadge(detail.submittalType)}
              {detail && getPhaseBadge(detail.phase)}
            </DialogTitle>
            <DialogDescription>{detail?.subject}</DialogDescription>
          </DialogHeader>
          {detail && (
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="mb-2">
                <TabsTrigger value="details" data-testid={`${testIdPrefix}tab-details`}>Details</TabsTrigger>
                <TabsTrigger value="items" data-testid={`${testIdPrefix}tab-items`}>Items</TabsTrigger>
                <TabsTrigger value="attachments" data-testid={`${testIdPrefix}tab-attachments`}>Attachments</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-6 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Subject</Label>
                    <p className="font-medium" data-testid={`${testIdPrefix}text-detail-subject`}>{detail.subject}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Revision</Label>
                    <p className="font-medium" data-testid={`${testIdPrefix}text-detail-revision`}>Rev {detail.revision}</p>
                  </div>
                </div>

                {detail.description && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Description</Label>
                    <p data-testid={`${testIdPrefix}text-detail-description`}>{detail.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {detail.specSection && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Spec Section</Label>
                      <p data-testid={`${testIdPrefix}text-detail-spec-section`}>{detail.specSection}</p>
                    </div>
                  )}
                  {detail.submittalCategory && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Category</Label>
                      <p data-testid={`${testIdPrefix}text-detail-category`}>
                        {SUBMITTAL_CATEGORY_LABELS[detail.submittalCategory as SubmittalCategory] ?? detail.submittalCategory}
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Project</Label>
                    <p data-testid={`${testIdPrefix}text-detail-project`}>{detail.project?.code} - {detail.project?.name}</p>
                  </div>
                  {detail.subcontractor && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Subcontractor</Label>
                      <p data-testid={`${testIdPrefix}text-detail-subcontractor`}>{detail.subcontractor.companyName || detail.subcontractor.name}</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {detail.submittedByName && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Submitted By</Label>
                      <p data-testid={`${testIdPrefix}text-detail-submitted-by`}>{detail.submittedByName}</p>
                    </div>
                  )}
                  {detail.dateSubmitted && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Date Submitted</Label>
                      <p data-testid={`${testIdPrefix}text-detail-date-submitted`}>{format(new Date(detail.dateSubmitted), "MMM d, yyyy")}</p>
                    </div>
                  )}
                </div>

                {detail.reviewerName && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground text-xs">Reviewer</Label>
                      <p data-testid={`${testIdPrefix}text-detail-reviewer`}>{detail.reviewerName}</p>
                    </div>
                    {detail.reviewDate && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Review Date</Label>
                        <p data-testid={`${testIdPrefix}text-detail-review-date`}>{format(new Date(detail.reviewDate), "MMM d, yyyy")}</p>
                      </div>
                    )}
                  </div>
                )}

                {detail.reviewComments && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Review Comments</Label>
                    <p className="bg-muted p-3 rounded-md text-sm" data-testid={`${testIdPrefix}text-detail-review-comments`}>{detail.reviewComments}</p>
                  </div>
                )}

                {detail.stampAction && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Stamp</Label>
                    <p data-testid={`${testIdPrefix}text-detail-stamp`}>{detail.stampAction}</p>
                  </div>
                )}

                {detail.linkedRfiId && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Linked RFI</Label>
                    <p data-testid={`${testIdPrefix}text-detail-linked-rfi`}>{detail.linkedRfiId}</p>
                  </div>
                )}

                {detail.dateRequired && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Date Required</Label>
                    <p data-testid={`${testIdPrefix}text-detail-date-required`}>{format(new Date(detail.dateRequired), "MMM d, yyyy")}</p>
                  </div>
                )}

                {detail.revision > 1 && detail.previousRevisionId && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Previous Revision</Label>
                    <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}text-detail-previous-revision`}>
                      Revision {detail.revision - 1} (ID: {detail.previousRevisionId})
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap border-t pt-4">
                  {detail.status === "DRAFT" && (
                    <>
                      <Button
                        onClick={() => mutations.submitMutation.mutate(detail.id)}
                        disabled={mutations.submitMutation.isPending}
                        data-testid={`${testIdPrefix}button-action-submit`}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Submit
                      </Button>
                      {onEdit && (
                        <Button variant="outline" data-testid={`${testIdPrefix}button-action-edit`} onClick={() => onEdit(detail)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        onClick={() => mutations.deleteMutation.mutate(detail.id)}
                        disabled={mutations.deleteMutation.isPending}
                        data-testid={`${testIdPrefix}button-action-delete`}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </>
                  )}
                  {detail.status === "SUBMITTED" && (
                    <Button
                      onClick={() => mutations.startReviewMutation.mutate(detail.id)}
                      disabled={mutations.startReviewMutation.isPending}
                      data-testid={`${testIdPrefix}button-action-start-review`}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Start Review
                    </Button>
                  )}
                  {detail.status === "UNDER_REVIEW" && (
                    <>
                      <Button
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => openReviewDialog("approve")}
                        data-testid={`${testIdPrefix}button-action-approve`}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        className="border-green-500 text-green-700 dark:text-green-400"
                        onClick={() => openReviewDialog("approve-as-noted")}
                        data-testid={`${testIdPrefix}button-action-approve-as-noted`}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Approve As Noted
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => openReviewDialog("reject")}
                        data-testid={`${testIdPrefix}button-action-reject`}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                      <Button
                        variant="outline"
                        className="border-orange-500 text-orange-700 dark:text-orange-400"
                        onClick={() => openReviewDialog("revise")}
                        data-testid={`${testIdPrefix}button-action-revise`}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Revise & Resubmit
                      </Button>
                    </>
                  )}
                  {(detail.status === "REJECTED" || detail.status === "REVISE_AND_RESUBMIT") && (
                    <Button
                      onClick={() => mutations.resubmitMutation.mutate(detail.id)}
                      disabled={mutations.resubmitMutation.isPending}
                      data-testid={`${testIdPrefix}button-action-resubmit`}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Resubmit
                    </Button>
                  )}
                  {(detail.status === "APPROVED" || detail.status === "APPROVED_AS_NOTED") && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedRfiId("");
                        setShowLinkRfiDialog(true);
                      }}
                      data-testid={`${testIdPrefix}button-action-link-rfi`}
                    >
                      <LinkIcon className="h-4 w-4 mr-2" />
                      Link to RFI
                    </Button>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Activity Log
                  </h3>
                  {detail.activity && detail.activity.length > 0 ? (
                    <div className="space-y-3" data-testid={`${testIdPrefix}activity-log`}>
                      {detail.activity.map((act) => (
                        <div key={act.id} className="flex items-start gap-3 text-sm" data-testid={`${testIdPrefix}activity-item-${act.id}`}>
                          <div className="p-1 bg-muted rounded-md mt-0.5">
                            <FileText className="h-3 w-3" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{act.userName || "System"}</span>
                              <span className="text-muted-foreground text-xs">{format(new Date(act.createdAt), "MMM d, yyyy h:mm a")}</span>
                            </div>
                            <p className="text-muted-foreground">{act.action}{act.comment ? `: ${act.comment}` : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}text-no-activity`}>No activity yet</p>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium mb-2">Add Comment</h3>
                  <div className="flex gap-2">
                    <Textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment..."
                      rows={2}
                      className="flex-1"
                      data-testid={`${testIdPrefix}input-add-comment`}
                    />
                    <Button
                      onClick={() => {
                        if (newComment.trim() && detail.id) {
                          mutations.addCommentMutation.mutate({ id: detail.id, comment: newComment.trim() });
                          setNewComment("");
                        }
                      }}
                      disabled={!newComment.trim() || mutations.addCommentMutation.isPending}
                      data-testid={`${testIdPrefix}button-add-comment`}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="items" className="py-2">
                <SubmittalItemsTab submittal={detail} canEdit={canManageItems} />
              </TabsContent>

              <TabsContent value="attachments" className="py-2">
                {attachmentsSlot ? (
                  attachmentsSlot
                ) : (
                  <SubmittalAttachmentsTab
                    submittal={detail}
                    canUpload={canUploadAttachments}
                    canDeleteAny={canDeleteAnyAttachment}
                    currentUserId={currentUserId}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" && "Approve Submittal"}
              {reviewAction === "approve-as-noted" && "Approve As Noted"}
              {reviewAction === "reject" && "Reject Submittal"}
              {reviewAction === "revise" && "Revise & Resubmit"}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approve" ? "Optionally add review comments." : "Please provide review comments."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Review Comments {reviewAction !== "approve" ? "*" : ""}</Label>
              <Textarea
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                placeholder="Enter review comments..."
                rows={4}
                data-testid={`${testIdPrefix}input-review-comments`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)} data-testid={`${testIdPrefix}button-cancel-review`}>Cancel</Button>
            <Button
              onClick={() => {
                if (submittal) {
                  mutations.reviewMutation.mutate({
                    id: submittal.id,
                    action: reviewAction,
                    comments: reviewComments
                  });
                  setShowReviewDialog(false);
                  setReviewComments("");
                }
              }}
              disabled={
                (reviewAction !== "approve" && !reviewComments.trim()) ||
                mutations.reviewMutation.isPending
              }
              data-testid={`${testIdPrefix}button-confirm-review`}
            >
              {mutations.reviewMutation.isPending ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkRfiDialog} onOpenChange={setShowLinkRfiDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link to RFI</DialogTitle>
            <DialogDescription>Select an RFI to link to this submittal</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>RFI</Label>
              <Select value={selectedRfiId} onValueChange={setSelectedRfiId}>
                <SelectTrigger data-testid={`${testIdPrefix}select-link-rfi`}>
                  <SelectValue placeholder="Select an RFI..." />
                </SelectTrigger>
                <SelectContent>
                  {rfis.map(rfi => (
                    <SelectItem key={rfi.id} value={rfi.id}>{rfi.rfiNumber} - {rfi.subject}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkRfiDialog(false)} data-testid={`${testIdPrefix}button-cancel-link-rfi`}>Cancel</Button>
            <Button
              onClick={() => {
                if (submittal && selectedRfiId) {
                  mutations.linkRfiMutation.mutate({ id: submittal.id, rfiId: selectedRfiId });
                  setShowLinkRfiDialog(false);
                  setSelectedRfiId("");
                }
              }}
              disabled={!selectedRfiId || mutations.linkRfiMutation.isPending}
              data-testid={`${testIdPrefix}button-confirm-link-rfi`}
            >
              {mutations.linkRfiMutation.isPending ? "Linking..." : "Link RFI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
