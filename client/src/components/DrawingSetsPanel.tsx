import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { bulkPinErrorDescription } from "@/lib/drawingSetErrors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Layers,
  Plus,
  Star,
  Trash2,
  Pencil,
  AlertTriangle,
  Loader2,
  Check,
  X,
  GitCompare,
  Pin,
  Info,
} from "lucide-react";
import type { TakeoffSheet } from "@shared/schema";

interface DrawingSet {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  description: string | null;
  isPrimary: boolean;
  createdByUserId: string | null;
  createdAt: string;
}

interface DrawingSetItem {
  id: string;
  drawingSetId: string;
  sheetId: string;
  revisionId: string | null;
  pinnedAt: string;
}

interface ComparisonResult {
  items: DrawingSetItem[];
  comparison: Array<{
    itemId: string;
    sheetId: string;
    pinnedRevisionId: string | null;
    sheetName: string | null;
    currentRevisionLabel: string | null;
    latestRevisionLabel: string | null;
    hasNewerRevision: boolean;
  }>;
}

interface DrawingSetsPanelProps {
  projectId: string;
  sheets: TakeoffSheet[];
  userRole: string;
  onSetActive?: (setId: string | null) => void;
  activeSetId?: string | null;
}

export default function DrawingSetsPanel({
  projectId,
  sheets,
  userRole,
  onSetActive,
  activeSetId,
}: DrawingSetsPanelProps) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<DrawingSet | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [compareSetId, setCompareSetId] = useState<string | null>(null);
  const [manageSetId, setManageSetId] = useState<string | null>(null);

  const isAdmin = ["ADMIN", "MANAGER"].includes(userRole);

  const { data: drawingSets = [], isLoading } = useQuery<DrawingSet[]>({
    queryKey: ["/api/projects", projectId, "drawing-sets"],
    enabled: !!projectId,
  });

  const { data: manageItems = [] } = useQuery<DrawingSetItem[]>({
    queryKey: ["/api/projects", "drawing-sets", manageSetId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${manageSetId}/items`);
      if (!res.ok) throw new Error("Failed to load items");
      return res.json();
    },
    enabled: !!manageSetId,
  });

  const { data: compareData } = useQuery<ComparisonResult>({
    queryKey: ["/api/projects", "drawing-sets", compareSetId, "compare"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${compareSetId}/compare`);
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
    enabled: !!compareSetId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/drawing-sets`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      toast({ title: "Drawing set created" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create drawing set.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/drawing-sets/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      setEditingSet(null);
      toast({ title: "Drawing set updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update drawing set.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/drawing-sets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      toast({ title: "Drawing set deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete drawing set.", variant: "destructive" });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${id}/primary`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      toast({ title: "Primary set updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to set primary.", variant: "destructive" });
    },
  });

  // Task #1661 — bulk-replace mutation: rewrites the entire pinned-sheet
  // list in one call. Used by the "Pin all active sheets" and "Clear all
  // pinned sheets" bulk actions in the slimmed-down Manage modal. Routine
  // per-sheet pin/unpin happens inline on the sheet row, not in this modal.
  const bulkReplaceMutation = useMutation({
    mutationFn: async ({ setId, items }: { setId: string; items: Array<{ sheetId: string }> }) => {
      if (items.length === 0) {
        // Backend rejects empty arrays; clear by deleting each existing item.
        await Promise.all(
          manageItems.map(i =>
            apiRequest("DELETE", `/api/projects/drawing-sets/${setId}/items/${i.id}`),
          ),
        );
        return [];
      }
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${setId}/items/bulk`, { items });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      // Use vars.setId rather than the closure-bound manageSetId so a
      // late-arriving response cannot invalidate the wrong set's caches
      // if the user closes the modal or switches sets mid-flight.
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", vars.setId, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", vars.setId, "sheet-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", vars.setId, "compare"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      toast({ title: "Pinned sheets updated" });
    },
    // Task #1812 — surface duplicate-pin (409) responses with a friendly,
    // set-named toast so users understand why a bulk pin attempt didn't
    // appear to do anything. Other failures keep the generic message.
    onError: (err: unknown, vars) => {
      const setName = drawingSets.find(s => s.id === vars.setId)?.name || null;
      toast({
        title: "Error",
        description: bulkPinErrorDescription(err, { setName }),
        variant: "destructive",
      });
    },
  });

  const managedItemSheetIds = new Set(manageItems.map(i => i.sheetId));
  const activeProjectSheets = sheets.filter(s => s.isActive);

  return (
    <div className="space-y-3" data-testid="drawing-sets-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="w-4 h-4" />
          Drawing Sets
        </h3>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateOpen(true)}
            data-testid="button-create-drawing-set"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Set
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : drawingSets.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-3" data-testid="text-no-drawing-sets">
          No drawing sets created yet.
        </p>
      ) : (
        <div className="space-y-2">
          {drawingSets.map((set) => (
            <Card
              key={set.id}
              className={`cursor-pointer transition-colors ${activeSetId === set.id ? "border-primary bg-primary/5" : ""} ${set.isPrimary ? "border-amber-400/50" : ""}`}
              data-testid={`card-drawing-set-${set.id}`}
              onClick={() => onSetActive?.(activeSetId === set.id ? null : set.id)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate" data-testid={`text-set-name-${set.id}`}>
                        {set.name}
                      </span>
                      {set.isPrimary && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400">
                          <Star className="w-3 h-3 mr-0.5" />
                          Current
                        </Badge>
                      )}
                      {activeSetId === set.id && (
                        <Badge className="text-xs">Active View</Badge>
                      )}
                    </div>
                    {set.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{set.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(set.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCompareSetId(set.id)}
                      title="Compare with latest"
                      data-testid={`button-compare-set-${set.id}`}
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                    </Button>
                    {isAdmin && (
                      <>
                        {!set.isPrimary && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setPrimaryMutation.mutate(set.id)}
                            disabled={setPrimaryMutation.isPending}
                            title="Set as primary"
                            data-testid={`button-set-primary-${set.id}`}
                          >
                            <Star className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setManageSetId(set.id)}
                          title="Manage sheets"
                          data-testid={`button-manage-set-${set.id}`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditingSet(set);
                            setNewName(set.name);
                            setNewDescription(set.description || "");
                          }}
                          title="Edit"
                          data-testid={`button-edit-set-${set.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(set.id)}
                          disabled={deleteMutation.isPending}
                          title="Delete"
                          data-testid={`button-delete-set-${set.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-create-drawing-set">
          <DialogHeader>
            <DialogTitle>Create Drawing Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="set-name">Name</Label>
              <Input
                id="set-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder='e.g. "IFC Set 03/15"'
                data-testid="input-set-name"
              />
            </div>
            <div>
              <Label htmlFor="set-description">Description (optional)</Label>
              <Input
                id="set-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Brief description..."
                data-testid="input-set-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName, description: newDescription || undefined })}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-submit-drawing-set"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingSet} onOpenChange={(open) => { if (!open) setEditingSet(null); }}>
        <DialogContent data-testid="dialog-edit-drawing-set">
          <DialogHeader>
            <DialogTitle>Edit Drawing Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-set-name">Name</Label>
              <Input
                id="edit-set-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                data-testid="input-edit-set-name"
              />
            </div>
            <div>
              <Label htmlFor="edit-set-description">Description</Label>
              <Input
                id="edit-set-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                data-testid="input-edit-set-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSet(null)}>Cancel</Button>
            <Button
              onClick={() => editingSet && updateMutation.mutate({ id: editingSet.id, name: newName, description: newDescription })}
              disabled={!newName.trim() || updateMutation.isPending}
              data-testid="button-save-drawing-set"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manageSetId} onOpenChange={(open) => { if (!open) setManageSetId(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-manage-set-items">
          <DialogHeader>
            <DialogTitle>Bulk Manage Drawing Set</DialogTitle>
          </DialogHeader>
          {/* Task #1661 — slimmed-down modal: routine per-sheet pin/unpin
              now happens inline on each sheet row when this set is active.
              This dialog is kept for bulk operations (replace all, clear all)
              and a read-only summary of what is currently pinned. */}
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30 text-xs text-muted-foreground" data-testid="manage-set-inline-hint">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Tip: pin and unpin individual sheets directly from the sheet
                list while this set is active. Use the actions below for
                bulk changes.
              </span>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">Bulk Actions</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkReplaceMutation.mutate({
                    setId: manageSetId!,
                    items: activeProjectSheets.map(s => ({ sheetId: s.id })),
                  })}
                  disabled={bulkReplaceMutation.isPending || activeProjectSheets.length === 0}
                  data-testid="button-pin-all-active"
                >
                  {bulkReplaceMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                  <Pin className="w-3.5 h-3.5 mr-1" />
                  Pin all active sheets ({activeProjectSheets.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkReplaceMutation.mutate({ setId: manageSetId!, items: [] })}
                  disabled={bulkReplaceMutation.isPending || manageItems.length === 0}
                  data-testid="button-clear-all-pinned"
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Clear all pinned
                </Button>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2" data-testid="text-pinned-count">Currently Pinned ({manageItems.length})</h4>
              {manageItems.length === 0 ? (
                <p className="text-xs text-muted-foreground italic" data-testid="text-no-pinned-sheets">
                  No sheets pinned yet. Pin from the sheet list or use a bulk action above.
                </p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {manageItems.map((item) => {
                    const sheet = sheets.find(s => s.id === item.sheetId);
                    const revLabel = sheet?.revisionLabel || item.revisionId;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2 rounded border text-sm"
                        data-testid={`pinned-sheet-${item.id}`}
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <Pin className="w-3 h-3 text-green-600 shrink-0" />
                          <span className="truncate">{sheet?.sheetName || item.sheetId}</span>
                          {revLabel && (
                            <Badge variant="outline" className="text-xs shrink-0">Rev: {revLabel}</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageSetId(null)} data-testid="button-close-manage-set">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!compareSetId} onOpenChange={(open) => { if (!open) setCompareSetId(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-compare-set">
          <DialogHeader>
            <DialogTitle>Compare Set vs Latest Revisions</DialogTitle>
          </DialogHeader>
          {compareData ? (
            <div className="space-y-2">
              {compareData.comparison.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">
                  No sheets pinned in this set yet.
                </p>
              ) : (
                compareData.comparison.map((item) => (
                  <div
                    key={item.itemId}
                    className={`flex items-center justify-between p-2 rounded border text-sm ${item.hasNewerRevision ? "border-amber-400 bg-amber-50/50 dark:bg-amber-900/10" : ""}`}
                    data-testid={`compare-item-${item.itemId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-medium">{item.sheetName || item.sheetId}</span>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          Pinned: {item.currentRevisionLabel || "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Latest: {item.latestRevisionLabel || "—"}
                        </span>
                      </div>
                    </div>
                    {item.hasNewerRevision ? (
                      <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400 shrink-0">
                        <AlertTriangle className="w-3 h-3 mr-0.5" />
                        Newer Available
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400 shrink-0">
                        <Check className="w-3 h-3 mr-0.5" />
                        Up to Date
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
