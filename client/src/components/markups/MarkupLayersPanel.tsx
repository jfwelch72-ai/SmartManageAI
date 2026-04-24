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
import { Eye, EyeOff, Plus, Trash2, Pencil, Check, X } from "lucide-react";
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
          return (
            <div
              key={l.id}
              className="flex items-center gap-1 px-2 py-1"
              data-testid={`row-markup-layer-${l.id}`}
            >
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
