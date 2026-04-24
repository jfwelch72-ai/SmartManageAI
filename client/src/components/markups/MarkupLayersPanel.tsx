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
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  GripVertical,
  Copy,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// Task #1805 — how long the "Copy to sheet" success toast (and its
// Undo button) stays on screen. Long enough for a user to notice the
// slip and back out, short enough that a successful copy doesn't
// linger forever.
const COPY_TO_SHEET_UNDO_WINDOW_MS = 9000;

// Task #1701 — custom drag-and-drop MIME type used by drop targets
// (e.g. PageThumbnailStrip) to recognise a "copy this layer" drag and
// distinguish it from the panel's internal reorder drag (which uses
// `text/plain` only).
export const PLAN_MARKUP_LAYER_DRAG_MIME = "application/x-plan-markup-layer";

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

/** Task #1722 — per-destination summary of how many "(copy)" layers
 *  derived from a given source layer already exist on each sibling
 *  sheet. The picker uses this to badge destinations the user has
 *  already copied to and to confirm before creating yet another
 *  duplicate. Documents with zero copies are omitted from the array
 *  by the server; the client treats absence as zero. */
interface CopyTarget {
  documentId: string;
  existingCopyCount: number;
  lastCopiedAt: string;
}
interface CopyTargetsResponse {
  targets: CopyTarget[];
}

/** Sibling sheet a user can copy a layer onto (Task #1701). The list
 *  is supplied by the parent (PlansTab) since destinations come from
 *  the project-document query, not from this layer-scoped panel. */
export interface CopyDestination {
  id: string;
  /** User-visible label for the destination (`title` or `fileName`). */
  label: string;
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
  /** Task #1701 — sibling plan documents in the same project that the
   *  user can copy a layer onto. The current document MUST be excluded
   *  by the parent so the menu never offers a self-copy. When omitted
   *  or empty, the "Copy to sheet" affordance is hidden. */
  copyDestinations?: CopyDestination[];
}

export default function MarkupLayersPanel({
  documentId,
  activeLayerId,
  onChangeActiveLayer,
  hiddenLayerIds,
  onChangeHiddenLayerIds,
  copyDestinations = [],
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
  // Task #1722 — which layer's "Copy to sheet" menu is currently open.
  // We use this to scope the existing-copy lookup query (a single
  // request fired only when the user actually opens a picker, not on
  // every layer render).
  const [openCopyMenuLayerId, setOpenCopyMenuLayerId] = useState<string | null>(null);
  // Task #1702 — accessibility parity for the drag handle. Screen
  // reader users are notified of position changes via an aria-live
  // region; the message is set after a successful keyboard reorder.
  const [liveMessage, setLiveMessage] = useState<string>("");

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

  // Task #1722 — fetch the per-destination copy summary for whichever
  // layer the user is currently considering. We scope by `openCopyMenuLayerId`
  // so the request is only fired once the picker is actually opened —
  // no per-layer waterfall on initial render.
  const copyTargetsQueryKey = [
    "/api/plan-markup-layers",
    openCopyMenuLayerId ?? "",
    "copy-targets",
  ] as const;
  const { data: copyTargetsData } = useQuery<CopyTargetsResponse>({
    queryKey: copyTargetsQueryKey,
    queryFn: async () => {
      const r = await fetch(
        `/api/plan-markup-layers/${encodeURIComponent(openCopyMenuLayerId!)}/copy-targets`,
        { credentials: "include" },
      );
      if (!r.ok) return { targets: [] };
      return r.json();
    },
    enabled: !!openCopyMenuLayerId,
  });
  const copyTargetsByDoc = new Map<string, CopyTarget>(
    (copyTargetsData?.targets ?? []).map((t) => [t.documentId, t]),
  );

  // Task #1804 — special-case the sub-minute window so we render
  // "just now" instead of date-fns's awkward "less than a minute ago".
  const formatLastCopied = (iso: string): string | null => {
    const parsed = parseISO(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    if (Date.now() - parsed.getTime() < 60_000) return "just now";
    return formatDistanceToNow(parsed, { addSuffix: true });
  };

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

  // Task #1701 — Copy a layer (and its markups) to another sheet in
  // the same project. Drives both the dropdown menu under each layer
  // row and the drag-onto-thumbnail affordance below.
  const copyToSheetMutation = useMutation({
    mutationFn: async ({
      layerId,
      targetDocumentId,
    }: {
      layerId: string;
      targetDocumentId: string;
    }) => {
      const r = await apiRequest(
        "POST",
        `/api/plan-markup-layers/${layerId}/copy-to-document`,
        { targetDocumentId },
      );
      return r.json() as Promise<{
        ok: boolean;
        layer: { id: string; name: string };
        markupsCopied: number;
      }>;
    },
    onSuccess: (data, variables) => {
      // Invalidate the destination's layers + markups so the next time
      // a user opens that sheet they see the new "(copy)" layer.
      queryClient.invalidateQueries({
        queryKey: [
          "/api/plan-documents",
          variables.targetDocumentId,
          "markup-layers",
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "/api/plan-documents",
          variables.targetDocumentId,
          "markups",
        ],
      });
      // Task #1722 — refresh the copy-targets summary so a follow-up
      // open of the same picker reflects the new "(copy)" we just
      // created (and surfaces the duplicate-warning on the next click).
      queryClient.invalidateQueries({
        queryKey: ["/api/plan-markup-layers", variables.layerId, "copy-targets"],
      });
      const dest = copyDestinations.find((d) => d.id === variables.targetDocumentId);
      // Task #1805 — let the user undo an accidental copy from the
      // success toast. The undo button calls the cascade-delete
      // endpoint so the freshly-created destination layer AND the
      // markups that were just copied with it are removed atomically,
      // restoring the destination sheet to its prior state.
      const newLayerId = data.layer.id;
      const targetDocumentId = variables.targetDocumentId;
      const sourceLayerId = variables.layerId;
      toast({
        title: `Copied "${data.layer.name}" to ${dest?.label ?? "sheet"}`,
        description:
          data.markupsCopied === 0
            ? "Layer was empty; an empty layer was created on the destination."
            : `${data.markupsCopied} markup${data.markupsCopied === 1 ? "" : "s"} copied.`,
        duration: COPY_TO_SHEET_UNDO_WINDOW_MS,
        action: (
          <ToastAction
            altText={`Undo copy of "${data.layer.name}"`}
            onClick={() => {
              undoCopyToSheetMutation.mutate({
                newLayerId,
                targetDocumentId,
                sourceLayerId,
                layerName: data.layer.name,
              });
            }}
            data-testid={`button-undo-copy-layer-${newLayerId}`}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not copy layer",
        description: e.message,
        variant: "destructive",
      }),
  });

  // Task #1805 — back out a "Copy to sheet" action started by the
  // mutation above. Uses the cascade=1 query param so the destination
  // layer and every markup that was just copied with it are deleted
  // together; the SET NULL fallback used by ordinary layer deletion
  // would leave orphaned markups stranded on the destination sheet.
  const undoCopyToSheetMutation = useMutation({
    mutationFn: async ({ newLayerId }: {
      newLayerId: string;
      targetDocumentId: string;
      sourceLayerId: string;
      layerName: string;
    }) => {
      await apiRequest(
        "DELETE",
        `/api/plan-markup-layers/${encodeURIComponent(newLayerId)}?cascade=1`,
      );
    },
    onSuccess: (_data, variables) => {
      // Mirror the invalidations the original copy fired so the
      // destination sheet's layer list and markup overlay both
      // refresh, and the source layer's copy-targets summary forgets
      // the just-undone duplicate so the next picker open is accurate.
      queryClient.invalidateQueries({
        queryKey: ["/api/plan-documents", variables.targetDocumentId, "markup-layers"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/plan-documents", variables.targetDocumentId, "markups"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/plan-markup-layers", variables.sourceLayerId, "copy-targets"],
      });
      toast({
        title: `Undid copy of "${variables.layerName}"`,
        description: "The destination layer and its copied markups were removed.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not undo copy",
        description: e.message,
        variant: "destructive",
      }),
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

  // Task #1702 — keyboard equivalent of the drag interaction. Moves
  // `sourceId` one slot up (-1) or down (+1), reusing the same
  // `reorder` path so PATCH semantics and optimistic updates match
  // drag-and-drop exactly. Announces the new position via aria-live.
  const reorderByKeyboard = (sourceId: string, direction: -1 | 1) => {
    const current = queryClient.getQueryData<MarkupLayer[]>(layersQueryKey) || layers;
    const fromIdx = current.findIndex((l) => l.id === sourceId);
    if (fromIdx === -1) return;
    const moved = current[fromIdx];
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= current.length) {
      // At the boundary — announce so screen reader users know the
      // keypress was received but had no effect.
      setLiveMessage(`${moved.name} is already at position ${fromIdx + 1} of ${current.length}`);
      return;
    }
    // `reorder` interprets targetId as "drop before this layer" (or
    // null = drop at end). Going up: drop before the current toIdx.
    // Going down: after splicing out the source, the next layer is at
    // toIdx + 1 in the original array, so drop before that one (or at
    // end if there isn't one).
    const targetId =
      direction === -1
        ? current[toIdx].id
        : toIdx + 1 < current.length
          ? current[toIdx + 1].id
          : null;
    reorder(sourceId, targetId);
    setLiveMessage(`Moved ${moved.name} to position ${toIdx + 1} of ${current.length}`);
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

      {/* Task #1702 — aria-live region announces keyboard reorders to
          screen readers. Visually hidden via sr-only. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="text-markup-layer-live"
      >
        {liveMessage}
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
                onKeyDown={(e) => {
                  // Task #1702 — Alt+ArrowUp/Down moves the focused
                  // layer one slot. We intentionally require Alt so
                  // the arrow keys remain available for browser /
                  // assistive-tech default navigation.
                  if (isRenaming) return;
                  if (!e.altKey) return;
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    reorderByKeyboard(l.id, -1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    reorderByKeyboard(l.id, 1);
                  }
                }}
                className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                aria-label={`Reorder layer ${l.name}. Drag, or press Alt+Arrow Up or Alt+Arrow Down to move.`}
                title="Drag, or use Alt+Arrow Up/Down to reorder"
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
              {!isRenaming && (
                /* Task #1701 — "Copy to sheet" affordance, available on
                   every layer (including the default) so users can
                   replicate any layer's markup set onto a sibling
                   sheet. The button doubles as a drag-source: dropping
                   onto a `data-layer-drop-target` element (e.g. a
                   PageThumbnailStrip thumbnail) fires the same copy
                   mutation. */
                <DropdownMenu
                  open={openCopyMenuLayerId === l.id}
                  onOpenChange={(open) =>
                    setOpenCopyMenuLayerId(open ? l.id : null)
                  }
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      draggable={copyDestinations.length > 0}
                      onDragStart={(e) => {
                        try {
                          e.dataTransfer.effectAllowed = "copy";
                          e.dataTransfer.setData(
                            PLAN_MARKUP_LAYER_DRAG_MIME,
                            JSON.stringify({
                              layerId: l.id,
                              layerName: l.name,
                              sourceDocumentId: documentId,
                            }),
                          );
                          // Some browsers (Safari) only fire drop events
                          // reliably when text/plain is also set.
                          e.dataTransfer.setData("text/plain", l.name);
                        } catch {
                          // Older browsers may throw on setData; safe to ignore.
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={
                        copyDestinations.length === 0 || copyToSheetMutation.isPending
                      }
                      aria-label={`Copy ${l.name} to another sheet`}
                      title={
                        copyDestinations.length === 0
                          ? "No other sheets available to copy to"
                          : "Copy to another sheet"
                      }
                      data-testid={`button-markup-layer-copy-${l.id}`}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel>Copy to sheet</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {copyDestinations.length === 0 ? (
                      <DropdownMenuItem
                        disabled
                        data-testid={`menu-markup-layer-copy-empty-${l.id}`}
                      >
                        No other sheets available
                      </DropdownMenuItem>
                    ) : (
                      copyDestinations.map((dest) => {
                        // Task #1722 — surface existing copies on each
                        // destination row so users know whether the
                        // click will create a duplicate. The lookup
                        // is keyed off `openCopyMenuLayerId`, so the
                        // map is only populated for the layer whose
                        // menu is currently open.
                        const existing = copyTargetsByDoc.get(dest.id);
                        const existingCount = existing?.existingCopyCount ?? 0;
                        const lastCopiedLabel =
                          existingCount > 0 && existing?.lastCopiedAt
                            ? formatLastCopied(existing.lastCopiedAt)
                            : null;
                        return (
                          <DropdownMenuItem
                            key={dest.id}
                            onSelect={(e) => {
                              if (
                                existingCount > 0 &&
                                typeof window !== "undefined" &&
                                !window.confirm(
                                  `"${dest.label}" already has ${existingCount} ` +
                                    `cop${existingCount === 1 ? "y" : "ies"} of "${l.name}". ` +
                                    `Create another copy anyway?`,
                                )
                              ) {
                                // Block the menu from closing on cancel
                                // so the user can pick a different sheet.
                                e.preventDefault();
                                return;
                              }
                              copyToSheetMutation.mutate({
                                layerId: l.id,
                                targetDocumentId: dest.id,
                              });
                            }}
                            data-testid={`menu-markup-layer-copy-${l.id}-to-${dest.id}`}
                          >
                            <span className="truncate flex-1">{dest.label}</span>
                            {existingCount > 0 && (
                              <span
                                className="ml-2 text-muted-foreground text-[10px] whitespace-nowrap"
                                data-testid={`badge-markup-layer-copy-existing-${l.id}-to-${dest.id}`}
                              >
                                {existingCount === 1
                                  ? "1 copy"
                                  : `${existingCount} copies`}
                                {lastCopiedLabel && (
                                  <>
                                    {" · "}
                                    <span
                                      data-testid={`text-markup-layer-copy-last-copied-${l.id}-to-${dest.id}`}
                                    >
                                      {lastCopiedLabel}
                                    </span>
                                  </>
                                )}
                              </span>
                            )}
                          </DropdownMenuItem>
                        );
                      })
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
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
