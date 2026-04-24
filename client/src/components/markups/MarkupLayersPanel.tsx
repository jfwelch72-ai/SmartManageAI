/**
 * Task #1662 — Markup Layers panel.
 *
 * Renders the per-document layer list with:
 *   - per-user visibility toggles (eye icon),
 *   - the "active layer" radio (new markups land here),
 *   - add / rename / delete actions (RBAC-gated server-side).
 *
 * Default behaviour: when a project has never used layers, the server
 * auto-materialises a single "Default" layer so this panel always has
 * at least one row and no UI changes are forced on existing users.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Plus, Trash2, Pencil, Check, X, GripVertical } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export interface MarkupLayer {
  id: string;
  planDocumentId: string;
  name: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  isVisible: boolean;
  markupCount: number;
}

export interface MarkupLayersPanelProps {
  documentId: string;
  activeLayerId: string | null;
  onChangeActiveLayer: (id: string | null) => void;
  /** Lifted up so the parent can hide markups whose layer the user
   *  toggled off. The set contains layer ids (or `null` for legacy
   *  unassigned markups, which inherit the default layer's state). */
  hiddenLayerIds: Set<string>;
  onChangeHiddenLayerIds: (next: Set<string>) => void;
}

export default function MarkupLayersPanel({
  documentId,
  activeLayerId,
  onChangeActiveLayer,
  hiddenLayerIds,
  onChangeHiddenLayerIds,
}: MarkupLayersPanelProps) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Drag-and-drop reorder state. `draggingId` is the row being dragged
  // and `dragOverId` is the row currently hovered (used purely as a
  // visual affordance — the drop target is computed at drop time).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const layersQueryKey = ["/api/plan-documents", documentId, "markup-layers"] as const;

  const { data: layers = [], isLoading } = useQuery<MarkupLayer[]>({
    queryKey: layersQueryKey,
    queryFn: async () => {
      const r = await fetch(
        `/api/plan-documents/${encodeURIComponent(documentId)}/markup-layers`,
        { credentials: "include" },
      );
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!documentId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: layersQueryKey });
  };

  const createMutation = useMutation({
    mutationFn: async (name: string) =>
      apiRequest("POST", `/api/plan-documents/${encodeURIComponent(documentId)}/markup-layers`, {
        name,
      }),
    onSuccess: () => {
      setNewName("");
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Could not create layer", description: e.message, variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      apiRequest("PATCH", `/api/plan-markup-layers/${id}`, { name }),
    onSuccess: () => {
      setRenamingId(null);
      setRenameValue("");
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Could not rename layer", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/plan-markup-layers/${id}`),
    onSuccess: (_data, id) => {
      // If we just removed the active layer, fall back to default.
      if (activeLayerId === id) onChangeActiveLayer(null);
      // Also invalidate markups: the FK SET NULL on the server moved
      // those markups back into the default bucket.
      queryClient.invalidateQueries({ queryKey: ["/api/plan-documents", documentId, "markups"] });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Could not delete layer", description: e.message, variant: "destructive" }),
  });

  const visibilityMutation = useMutation({
    mutationFn: async ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      apiRequest("PUT", `/api/plan-markup-layers/${id}/visibility`, { isVisible }),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: "Could not toggle visibility", description: e.message, variant: "destructive" }),
  });

  // Persist a new layer order. The caller computes the minimal set of
  // (id, sortOrder) updates *before* the optimistic cache write so we
  // can PATCH only the rows whose value actually changed.
  const reorderMutation = useMutation({
    mutationFn: async (updates: { id: string; sortOrder: number }[]) => {
      // Run PATCHes in parallel; the server orders rows by
      // (sortOrder, createdAt) so partial failures still leave a
      // sensible ordering and the subsequent invalidate() will
      // reconcile to the server's truth.
      await Promise.all(
        updates.map((u) =>
          apiRequest("PATCH", `/api/plan-markup-layers/${u.id}`, { sortOrder: u.sortOrder }),
        ),
      );
    },
    onError: (e: Error) => {
      toast({ title: "Could not reorder layers", description: e.message, variant: "destructive" });
      invalidate();
    },
    onSettled: () => invalidate(),
  });

  // Optimistically reorder the cached list and kick off the PATCHes.
  // `targetId` may be null to mean "drop at end".
  const reorder = (sourceId: string, targetId: string | null) => {
    if (sourceId === targetId) return;
    const current = queryClient.getQueryData<MarkupLayer[]>(layersQueryKey) || [];
    const fromIdx = current.findIndex((l) => l.id === sourceId);
    if (fromIdx === -1) return;
    const without = current.slice();
    const [moved] = without.splice(fromIdx, 1);
    let toIdx = targetId == null ? without.length : without.findIndex((l) => l.id === targetId);
    if (toIdx === -1) toIdx = without.length;
    without.splice(toIdx, 0, moved);
    if (without.every((l, i) => l.id === current[i]?.id)) return;
    // Compute the minimal diff *before* writing the optimistic cache,
    // otherwise the new sortOrders would already be in place and we'd
    // PATCH nothing.
    const updates: { id: string; sortOrder: number }[] = [];
    const renumbered = without.map((l, i) => {
      const nextSort = (i + 1) * 1000;
      if (l.sortOrder !== nextSort) {
        updates.push({ id: l.id, sortOrder: nextSort });
      }
      return { ...l, sortOrder: nextSort };
    });
    queryClient.setQueryData<MarkupLayer[]>(layersQueryKey, renumbered);
    if (updates.length > 0) reorderMutation.mutate(updates);
  };

  const toggleVisibility = (layer: MarkupLayer) => {
    const nextVisible = !layer.isVisible;
    // Optimistic local update so the canvas reflects the toggle without
    // waiting for the round-trip.
    const next = new Set(hiddenLayerIds);
    if (nextVisible) next.delete(layer.id);
    else next.add(layer.id);
    onChangeHiddenLayerIds(next);
    visibilityMutation.mutate({ id: layer.id, isVisible: nextVisible });
  };

  return (
    <div
      className="flex flex-col border rounded-md bg-card text-xs"
      data-testid="markup-layers-panel"
    >
      <div className="flex items-center justify-between px-2 py-1 border-b">
        <span className="font-medium text-foreground">Layers</span>
        <span className="text-muted-foreground" data-testid="text-markup-layers-count">
          {layers.length}
        </span>
      </div>

      <div className="max-h-48 overflow-y-auto divide-y">
        {isLoading && (
          <div className="px-2 py-1 text-muted-foreground" data-testid="text-markup-layers-loading">
            Loading…
          </div>
        )}
        {!isLoading && layers.length === 0 && (
          <div className="px-2 py-1 text-muted-foreground">No layers yet.</div>
        )}
        {layers.map((l) => {
          const isActive = activeLayerId === l.id || (!activeLayerId && l.isDefault);
          const isRenaming = renamingId === l.id;
          const isDragging = draggingId === l.id;
          const isDropTarget = dragOverId === l.id && draggingId !== null && draggingId !== l.id;
          return (
            <div
              key={l.id}
              className={`flex items-center gap-1 px-2 py-1 ${isDragging ? "opacity-50" : ""} ${
                isDropTarget ? "border-t-2 border-t-primary" : ""
              }`}
              data-testid={`row-markup-layer-${l.id}`}
              onDragOver={(e) => {
                if (!draggingId || isRenaming) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverId !== l.id) setDragOverId(l.id);
              }}
              onDragLeave={() => {
                if (dragOverId === l.id) setDragOverId(null);
              }}
              onDrop={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                const sourceId = draggingId;
                setDraggingId(null);
                setDragOverId(null);
                reorder(sourceId, l.id);
              }}
            >
              <button
                type="button"
                draggable={!isRenaming}
                onDragStart={(e) => {
                  if (isRenaming) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = "move";
                  // Some browsers require data on the transfer to fire
                  // subsequent drag events.
                  try {
                    e.dataTransfer.setData("text/plain", l.id);
                  } catch {
                    // Older browsers may throw on setData; safe to ignore.
                  }
                  setDraggingId(l.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                aria-label={`Drag to reorder layer ${l.name}`}
                title="Drag to reorder"
                data-testid={`button-markup-layer-drag-${l.id}`}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => toggleVisibility(l)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={l.isVisible ? `Hide layer ${l.name}` : `Show layer ${l.name}`}
                data-testid={`button-markup-layer-visibility-${l.id}`}
              >
                {l.isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm border"
                style={{ background: l.color }}
                aria-hidden
              />
              {isRenaming ? (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-6 text-xs flex-1 min-w-0"
                    data-testid={`input-markup-layer-rename-${l.id}`}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1"
                    onClick={() =>
                      renameValue.trim() &&
                      renameMutation.mutate({ id: l.id, name: renameValue.trim() })
                    }
                    disabled={renameMutation.isPending}
                    aria-label="Save rename"
                    data-testid={`button-markup-layer-rename-save-${l.id}`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1"
                    onClick={() => {
                      setRenamingId(null);
                      setRenameValue("");
                    }}
                    aria-label="Cancel rename"
                    data-testid={`button-markup-layer-rename-cancel-${l.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`flex-1 text-left truncate ${isActive ? "font-semibold" : ""}`}
                  onClick={() => onChangeActiveLayer(l.isDefault ? null : l.id)}
                  data-testid={`button-markup-layer-activate-${l.id}`}
                  title={isActive ? "Active layer" : "Set as active layer"}
                >
                  {l.name}
                  <span className="ml-1 text-muted-foreground">({l.markupCount})</span>
                </button>
              )}
              {!isRenaming && !l.isDefault && (
                <>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setRenamingId(l.id);
                      setRenameValue(l.name);
                    }}
                    aria-label={`Rename ${l.name}`}
                    data-testid={`button-markup-layer-rename-${l.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (
                        l.markupCount > 0 &&
                        typeof window !== "undefined" &&
                        !window.confirm(
                          `Delete layer "${l.name}"? Its ${l.markupCount} markup(s) will move to the default layer.`,
                        )
                      ) {
                        return;
                      }
                      deleteMutation.mutate(l.id);
                    }}
                    aria-label={`Delete ${l.name}`}
                    data-testid={`button-markup-layer-delete-${l.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
        {layers.length > 1 && (
          <div
            className={`h-2 ${
              dragOverId === "__end__" && draggingId ? "border-t-2 border-t-primary" : ""
            }`}
            data-testid="dropzone-markup-layer-end"
            onDragOver={(e) => {
              if (!draggingId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOverId !== "__end__") setDragOverId("__end__");
            }}
            onDragLeave={() => {
              if (dragOverId === "__end__") setDragOverId(null);
            }}
            onDrop={(e) => {
              if (!draggingId) return;
              e.preventDefault();
              const sourceId = draggingId;
              setDraggingId(null);
              setDragOverId(null);
              reorder(sourceId, null);
            }}
          />
        )}
      </div>

      <form
        className="flex items-center gap-1 px-2 py-1 border-t"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = newName.trim();
          if (!trimmed) return;
          createMutation.mutate(trimmed);
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New layer name"
          className="h-6 text-xs flex-1 min-w-0"
          data-testid="input-markup-layer-new"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="h-6 px-1"
          disabled={!newName.trim() || createMutation.isPending}
          aria-label="Add layer"
          data-testid="button-markup-layer-add"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </form>
    </div>
  );
}
