import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  ChevronRight,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import type { Submittal, RFI, SubmittalCreateForm, SubmittalItem, SubmittalAttachment, SubmittalReview } from "@/hooks/useSubmittalMutations";
import { SUBMITTAL_CATEGORIES, SUBMITTAL_CATEGORY_LABELS, type SubmittalCategory } from "@/hooks/useSubmittalMutations";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

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

function getReviewStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    case "IN_REVIEW":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs"><Eye className="h-3 w-3 mr-1" />In Review</Badge>;
    case "APPROVED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
    case "APPROVED_AS_NOTED":
      return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Approved As Noted</Badge>;
    case "REJECTED":
      return <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
    case "REVISE_AND_RESUBMIT":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Revise & Resubmit</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
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

const REVIEW_ROLES = ["ARCHITECT", "ENGINEER", "OWNER", "GC_MANAGER"] as const;

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
        <div className="space-y-3">
          {items.map((item) => (
            editingItem?.id === item.id ? (
              <Card key={item.id} className="p-3" data-testid={`card-item-editing-${item.id}`}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Item #{item.itemNumber}</span>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleUpdateItem} data-testid={`button-save-item-${item.id}`}>
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingItem(null)} data-testid={`button-cancel-edit-item-${item.id}`}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    value={editingItem.description}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Description"
                    data-testid={`input-edit-description-${item.id}`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <Select
                        value={editingItem.submittalCategory ?? "NONE"}
                        onValueChange={(v) => setEditingItem({ ...editingItem, submittalCategory: v === "NONE" ? null : v as SubmittalCategory })}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid={`select-edit-category-${item.id}`}>
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">None</SelectItem>
                          {SUBMITTAL_CATEGORIES.map(cat => (
                            <SelectItem key={cat} value={cat}>{SUBMITTAL_CATEGORY_LABELS[cat]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Spec Section</Label>
                      <Input
                        value={editingItem.specSection ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, specSection: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Spec section"
                        data-testid={`input-edit-spec-${item.id}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Manufacturer</Label>
                      <Input
                        value={editingItem.manufacturer ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, manufacturer: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Manufacturer"
                        data-testid={`input-edit-manufacturer-${item.id}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Model #</Label>
                      <Input
                        value={editingItem.modelNumber ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, modelNumber: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Model #"
                        data-testid={`input-edit-model-${item.id}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        value={editingItem.quantity ?? ""}
                        onChange={(e) => setEditingItem({ ...editingItem, quantity: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Qty"
                        data-testid={`input-edit-quantity-${item.id}`}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card key={item.id} className="p-3" data-testid={`card-item-${item.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-medium text-muted-foreground">#{item.itemNumber}</span>
                      <span className="text-sm font-medium" data-testid={`text-item-description-${item.id}`}>{item.description}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {getCategoryBadge(item.submittalCategory)}
                      {getItemStatusBadge(item.status)}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                      {item.specSection && (
                        <div>
                          <span className="text-muted-foreground">Spec: </span>
                          <span data-testid={`text-item-spec-${item.id}`}>{item.specSection}</span>
                        </div>
                      )}
                      {item.manufacturer && (
                        <div>
                          <span className="text-muted-foreground">Mfr: </span>
                          <span data-testid={`text-item-manufacturer-${item.id}`}>{item.manufacturer}</span>
                        </div>
                      )}
                      {item.modelNumber && (
                        <div>
                          <span className="text-muted-foreground">Model: </span>
                          <span data-testid={`text-item-model-${item.id}`}>{item.modelNumber}</span>
                        </div>
                      )}
                      {item.quantity && (
                        <div>
                          <span className="text-muted-foreground">Qty: </span>
                          <span>{item.quantity}{item.unit ? ` ${item.unit}` : ""}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {canEdit && isDraft && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingItem(item)} data-testid={`button-edit-item-${item.id}`}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDeletingItemId(item.id)} data-testid={`button-delete-item-${item.id}`}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          ))}
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
    addReviewerMutation?: { mutate: (args: { submittalId: string; data: Record<string, unknown> }) => void; isPending: boolean };
    removeReviewerMutation?: { mutate: (args: { submittalId: string; reviewId: string }) => void; isPending: boolean };
    startChainMutation?: { mutate: (args: { submittalId: string; reviewId: string }) => void; isPending: boolean };
    stampMutation?: { mutate: (args: { submittalId: string; reviewId: string; action: string; comments: string }) => void; isPending: boolean };
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
  const { user, permissionRole } = useAuth();
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showLinkRfiDialog, setShowLinkRfiDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [newComment, setNewComment] = useState("");
  const [selectedRfiId, setSelectedRfiId] = useState("");

  const [showAddReviewer, setShowAddReviewer] = useState(false);
  const [newReviewerRole, setNewReviewerRole] = useState<string>("");
  const [newReviewerName, setNewReviewerName] = useState("");
  const [newReviewerUserId, setNewReviewerUserId] = useState("");

  const [stampingReviewId, setStampingReviewId] = useState<string | null>(null);
  const [stampAction, setStampAction] = useState<string>("");
  const [stampComments, setStampComments] = useState("");

  const detail = selectedDetail || submittal;

  const canManageChain = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(permissionRole || "");
  const canManageItems = ["ADMIN", "MANAGER", "ESTIMATOR", "SUPER_ADMIN"].includes(userRole);
  const canUploadAttachments = ["ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "SUPER_ADMIN"].includes(userRole);
  const canDeleteAnyAttachment = ["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(userRole);

  const { data: reviews = [] } = useQuery<SubmittalReview[]>({
    queryKey: ["/api/submittals", detail?.id, "reviews"],
    queryFn: async () => {
      const res = await fetch(`/api/submittals/${detail!.id}/reviews`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
    enabled: !!detail?.id && open,
  });

  const { data: orgUsers = [] } = useQuery<{ id: string; firstName: string; lastName: string; role: string }[]>({
    queryKey: ["/api/users"],
    enabled: !!detail?.id && open && canManageChain && detail?.status === "DRAFT",
  });

  const hasReviewChain = reviews.length > 0;

  const { data: rfis = [] } = useQuery<RFI[]>({
    queryKey: ["/api/rfi", submittal?.projectId ? `?projectId=${submittal.projectId}` : ""],
    enabled: !!submittal?.projectId && showLinkRfiDialog
  });

  const openReviewDialog = (action: string) => {
    setReviewAction(action);
    setReviewComments("");
    setShowReviewDialog(true);
  };

  const handleAddReviewer = () => {
    if (!detail || !newReviewerRole || !newReviewerName.trim()) return;
    const nextSeq = reviews.length > 0 ? Math.max(...reviews.map(r => r.sequenceOrder)) + 1 : 1;
    const data: Record<string, unknown> = {
      reviewerRole: newReviewerRole,
      reviewerName: newReviewerName.trim(),
      sequenceOrder: nextSeq,
    };
    if (newReviewerUserId) data.reviewerId = newReviewerUserId;
    mutations.addReviewerMutation?.mutate({ submittalId: detail.id, data });
    setNewReviewerRole("");
    setNewReviewerName("");
    setNewReviewerUserId("");
    setShowAddReviewer(false);
  };

  const handleStartChain = () => {
    if (!detail || reviews.length === 0) return;
    const firstPending = [...reviews].sort((a, b) => a.sequenceOrder - b.sequenceOrder).find(r => r.status === "PENDING");
    if (!firstPending) return;
    mutations.startChainMutation?.mutate({ submittalId: detail.id, reviewId: firstPending.id });
  };

  const handleStamp = () => {
    if (!detail || !stampingReviewId || !stampAction) return;
    mutations.stampMutation?.mutate({
      submittalId: detail.id,
      reviewId: stampingReviewId,
      action: stampAction,
      comments: stampComments,
    });
    setStampingReviewId(null);
    setStampAction("");
    setStampComments("");
  };

  const myActiveReview = reviews.find(r => r.status === "IN_REVIEW" && r.reviewerId === user?.id);

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

                {!hasReviewChain && detail.reviewerName && (
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

                {!hasReviewChain && detail.reviewComments && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Review Comments</Label>
                    <p className="bg-muted p-3 rounded-md text-sm" data-testid={`${testIdPrefix}text-detail-review-comments`}>{detail.reviewComments}</p>
                  </div>
                )}

                {!hasReviewChain && detail.stampAction && (
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

                {/* ==================== Review Chain Panel ==================== */}
                <div className="border rounded-lg p-4 space-y-4" data-testid={`${testIdPrefix}review-chain-panel`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium flex items-center gap-2">
                      <FileCheck className="h-4 w-4" />
                      Review Chain
                    </h3>
                    {canManageChain && detail.status === "DRAFT" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddReviewer(!showAddReviewer)}
                        data-testid={`${testIdPrefix}button-add-reviewer-toggle`}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Reviewer
                      </Button>
                    )}
                  </div>

                  {/* Add Reviewer Form */}
                  {showAddReviewer && canManageChain && detail.status === "DRAFT" && (
                    <div className="border rounded-md p-3 space-y-3 bg-muted/50" data-testid={`${testIdPrefix}add-reviewer-form`}>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Role</Label>
                          <Select value={newReviewerRole} onValueChange={setNewReviewerRole}>
                            <SelectTrigger className="h-8 text-sm" data-testid={`${testIdPrefix}select-reviewer-role`}>
                              <SelectValue placeholder="Select role..." />
                            </SelectTrigger>
                            <SelectContent>
                              {REVIEW_ROLES.map(role => (
                                <SelectItem key={role} value={role}>{role.replace(/_/g, " ")}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">User (optional)</Label>
                          <Select value={newReviewerUserId || "__external__"} onValueChange={(val) => {
                            const userId = val === "__external__" ? "" : val;
                            setNewReviewerUserId(userId);
                            if (userId) {
                              const found = orgUsers.find(u => u.id === userId);
                              if (found) setNewReviewerName(`${found.firstName} ${found.lastName}`);
                            }
                          }}>
                            <SelectTrigger className="h-8 text-sm" data-testid={`${testIdPrefix}select-reviewer-user`}>
                              <SelectValue placeholder="Select user..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__external__">External / No User</SelectItem>
                              {orgUsers.map(u => (
                                <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Reviewer Name</Label>
                        <Input
                          value={newReviewerName}
                          onChange={e => setNewReviewerName(e.target.value)}
                          placeholder="Reviewer name..."
                          className="h-8 text-sm"
                          data-testid={`${testIdPrefix}input-reviewer-name`}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleAddReviewer}
                          disabled={!newReviewerRole || !newReviewerName.trim() || mutations.addReviewerMutation?.isPending}
                          data-testid={`${testIdPrefix}button-confirm-add-reviewer`}
                        >
                          Add
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setShowAddReviewer(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {/* Stepper */}
                  {hasReviewChain ? (
                    <div className="space-y-2" data-testid={`${testIdPrefix}review-chain-stepper`}>
                      {/* Contractor step (always first) */}
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                          </div>
                          {reviews.length > 0 && <div className="w-px h-4 bg-border mt-1" />}
                        </div>
                        <div className="flex-1 pb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{detail.submittedByName || "Contractor"}</span>
                            <Badge variant="outline" className="text-xs">Contractor</Badge>
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />Submitted
                            </Badge>
                          </div>
                          {detail.dateSubmitted && (
                            <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(detail.dateSubmitted), "MMM d, yyyy")}</p>
                          )}
                        </div>
                      </div>

                      {reviews.map((review, idx) => {
                        const isLast = idx === reviews.length - 1;
                        const isActive = review.status === "IN_REVIEW";
                        const isCompleted = ["APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"].includes(review.status);
                        return (
                          <div key={review.id} className="flex items-start gap-3" data-testid={`${testIdPrefix}review-step-${review.id}`}>
                            <div className="flex flex-col items-center">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                                isCompleted
                                  ? review.status === "APPROVED" || review.status === "APPROVED_AS_NOTED"
                                    ? "bg-green-100 dark:bg-green-900"
                                    : "bg-red-100 dark:bg-red-900"
                                  : isActive
                                    ? "bg-blue-100 dark:bg-blue-900"
                                    : "bg-muted"
                              }`}>
                                {isCompleted && (review.status === "APPROVED" || review.status === "APPROVED_AS_NOTED") && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />}
                                {isCompleted && (review.status === "REJECTED" || review.status === "REVISE_AND_RESUBMIT") && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />}
                                {isActive && <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                                {!isCompleted && !isActive && <Clock className="h-4 w-4 text-muted-foreground" />}
                              </div>
                              {!isLast && <div className="w-px h-4 bg-border mt-1" />}
                            </div>
                            <div className="flex-1 pb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{review.reviewerName}</span>
                                <Badge variant="outline" className="text-xs">{review.reviewerRole.replace(/_/g, " ")}</Badge>
                                {getReviewStatusBadge(review.status)}
                                {canManageChain && detail.status === "DRAFT" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1 text-xs text-destructive hover:text-destructive"
                                    onClick={() => mutations.removeReviewerMutation?.mutate({ submittalId: detail.id, reviewId: review.id })}
                                    data-testid={`${testIdPrefix}button-remove-reviewer-${review.id}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                              {review.dateReviewed && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {format(new Date(review.dateReviewed), "MMM d, yyyy")}
                                </p>
                              )}
                              {review.comments && (
                                <p className="text-xs text-muted-foreground mt-1 italic">"{review.comments}"</p>
                              )}

                              {/* Stamp Decision UI — shown to reviewer whose row is IN_REVIEW */}
                              {review.status === "IN_REVIEW" && (review.reviewerId === user?.id || canManageChain) && (
                                <div className="mt-2">
                                  {stampingReviewId === review.id ? (
                                    <div className="space-y-2 border rounded-md p-2 bg-muted/50" data-testid={`${testIdPrefix}stamp-form-${review.id}`}>
                                      <Select value={stampAction} onValueChange={setStampAction}>
                                        <SelectTrigger className="h-8 text-sm" data-testid={`${testIdPrefix}select-stamp-action-${review.id}`}>
                                          <SelectValue placeholder="Select decision..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="APPROVED">Approve</SelectItem>
                                          <SelectItem value="APPROVED_AS_NOTED">Approve As Noted</SelectItem>
                                          <SelectItem value="REJECTED">Reject</SelectItem>
                                          <SelectItem value="REVISE_AND_RESUBMIT">Revise & Resubmit</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <Textarea
                                        value={stampComments}
                                        onChange={e => setStampComments(e.target.value)}
                                        placeholder={stampAction === "APPROVED" ? "Comments (optional)..." : "Comments required..."}
                                        rows={2}
                                        className="text-sm"
                                        data-testid={`${testIdPrefix}input-stamp-comments-${review.id}`}
                                      />
                                      <div className="flex gap-2">
                                        <Button
                                          size="sm"
                                          onClick={handleStamp}
                                          disabled={
                                            !stampAction ||
                                            (stampAction !== "APPROVED" && !stampComments.trim()) ||
                                            mutations.stampMutation?.isPending
                                          }
                                          data-testid={`${testIdPrefix}button-confirm-stamp-${review.id}`}
                                        >
                                          {mutations.stampMutation?.isPending ? "Stamping..." : "Confirm Stamp"}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => { setStampingReviewId(null); setStampAction(""); setStampComments(""); }}>Cancel</Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="mt-1"
                                      onClick={() => { setStampingReviewId(review.id); setStampAction(""); setStampComments(""); }}
                                      data-testid={`${testIdPrefix}button-stamp-decision-${review.id}`}
                                    >
                                      <FileCheck className="h-3 w-3 mr-1" />
                                      Stamp Decision
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}text-no-review-chain`}>
                      No review chain configured.
                      {canManageChain && detail.status === "DRAFT" && " Add reviewers above to set up a sequential review chain."}
                    </p>
                  )}

                  {/* Start Chain button — only when SUBMITTED and chain has pending items */}
                  {hasReviewChain && detail.status === "SUBMITTED" && canManageChain && reviews.some(r => r.status === "PENDING") && !reviews.some(r => r.status === "IN_REVIEW") && (
                    <Button
                      size="sm"
                      onClick={handleStartChain}
                      disabled={mutations.startChainMutation?.isPending}
                      data-testid={`${testIdPrefix}button-start-chain`}
                    >
                      <ChevronRight className="h-4 w-4 mr-1" />
                      {mutations.startChainMutation?.isPending ? "Starting..." : "Start Review Chain"}
                    </Button>
                  )}
                </div>

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
                  {detail.status === "SUBMITTED" && !hasReviewChain && (
                    <Button
                      onClick={() => mutations.startReviewMutation.mutate(detail.id)}
                      disabled={mutations.startReviewMutation.isPending}
                      data-testid={`${testIdPrefix}button-action-start-review`}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Start Review
                    </Button>
                  )}
                  {detail.status === "UNDER_REVIEW" && !hasReviewChain && (
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

      {/* Legacy Review Dialog */}
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
