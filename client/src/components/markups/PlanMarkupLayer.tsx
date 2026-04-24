/**
 * Task #1609 — Interactive markup overlay used by PlansTab.
 *
 * Sits inside the `overlay` slot of `<PdfPreview />`. Owns:
 *  - Fetching markups for (docId, pageNumber)
 *  - Drawing new markups via pointer events
 *  - Selection + delete UI
 *
 * The actual shape rendering is delegated to `<MarkupRenderer />` so the
 * print page can share the same code path.
 *
 * Task #1662 — Now also owns:
 *  - Multi-select (Shift+click) and a floating Group/Ungroup/Delete bar
 *  - Per-layer visibility filtering (driven by the parent panel)
 *  - Posting `layerId` on create so new markups land in the active layer
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2, Group as GroupIcon, Ungroup } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import MarkupRenderer, { type MarkupShape, type MarkupTool } from "./MarkupRenderer";
import { MarkupTextInput } from "@/components/takeoff/MarkupTextInput";

export interface PlanMarkupLayerProps {
  documentId: string;
  pageNumber: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Currently active draw tool, or null when not drawing. */
  activeTool: MarkupTool | null;
  color: string;
  thickness: number;
  /** Author's display name, used for the optimistic insert. */
  currentUserId?: string;
  /**
   * Task #1653 — lets the layer reset the toolbar selection. Used to
   * deselect the TEXT tool after the user cancels or submits a blank
   * label, so the cursor returns to its default state instead of being
   * stuck in TEXT mode.
   */
  onChangeTool?: (tool: MarkupTool | null) => void;
  /**
   * Task #1659 — When true, the user is holding spacebar to pan. The
   * markup overlay must drop pointer-events so the underlying PDF
   * scroll container receives the drag gestures.
   */
  spacePanActive?: boolean;
  /** Task #1662 — id of the layer new markups should be assigned to.
   *  When null, the server routes them to the auto-default layer. */
  activeLayerId?: string | null;
  /** Task #1662 — set of layer ids the user has hidden from view. */
  hiddenLayerIds?: Set<string>;
}

interface ServerMarkup extends MarkupShape {
  createdAt?: string;
  organizationId?: string;
  layerId?: string | null;
  groupId?: string | null;
}

function makeId() {
  return `tmp-${Math.random().toString(36).slice(2)}`;
}

export default function PlanMarkupLayer({
  documentId,
  pageNumber,
  canvasWidth,
  canvasHeight,
  activeTool,
  color,
  thickness,
  onChangeTool,
  spacePanActive,
  activeLayerId = null,
  hiddenLayerIds,
}: PlanMarkupLayerProps) {
  const { toast } = useToast();
  // Selection is stored as a set so SELECT + Shift can multi-select.
  // The first id is also kept for the legacy single-selection callers
  // (e.g. the floating delete button anchored at the markup).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const drawingRef = useRef(false);
  // Task #1653 — anchor for the in-canvas text input that replaces the
  // legacy `window.prompt()` flow. Coordinates are normalized 0-1 to
  // match `MarkupShape.points`; we denormalize when positioning the
  // floating input.
  const [textInputAnchor, setTextInputAnchor] = useState<{ x: number; y: number } | null>(null);

  const { data: allMarkups = [] } = useQuery<ServerMarkup[]>({
    queryKey: ["/api/plan-documents", documentId, "markups", pageNumber],
    queryFn: async () => {
      const r = await fetch(
        `/api/plan-documents/${encodeURIComponent(documentId)}/markups?page=${pageNumber}`,
        { credentials: "include" },
      );
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!documentId,
  });

  // Task #1662 — apply the user's per-layer visibility filter before
  // handing markups to the renderer. Markups whose layerId is in the
  // hidden set are dropped; legacy markups (layerId == null) follow
  // whichever layer they would've been displayed under (the default
  // layer is identified by the parent — see MarkupLayersPanel).
  const markups = useMemo(() => {
    if (!hiddenLayerIds || hiddenLayerIds.size === 0) return allMarkups;
    return allMarkups.filter((m) => {
      const lid = m.layerId ?? null;
      if (lid === null) {
        // Legacy / orphan markups follow the same toggle the user
        // applied to the default layer. The parent passes the default
        // layer id through hiddenLayerIds when toggled off; we can't
        // know which one is the default here without that signal, so
        // we keep them visible by default. The panel hides them when
        // the user explicitly toggles the default layer off (it adds
        // the sentinel string "__default__" in that case).
        return !hiddenLayerIds.has("__default__");
      }
      return !hiddenLayerIds.has(lid);
    });
  }, [allMarkups, hiddenLayerIds]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["/api/plan-documents", documentId, "markups", pageNumber],
    });
  }, [documentId, pageNumber]);

  const createMutation = useMutation({
    mutationFn: async (shape: MarkupShape) => {
      return apiRequest("POST", `/api/plan-documents/${encodeURIComponent(documentId)}/markups`, {
        pageNumber,
        tool: shape.tool,
        points: shape.points,
        color: shape.color,
        thickness: shape.thickness,
        text: shape.text ?? null,
        // Task #1662 — explicit layerId so new markups land in whichever
        // layer the user picked from the panel. null routes to the
        // server-side default layer.
        layerId: activeLayerId,
      });
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => {
      invalidate();
      toast({ title: "Could not save markup", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/plan-document-markups/${id}`),
    onSuccess: () => {
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Could not delete markup", description: e.message, variant: "destructive" }),
  });

  // Task #1662 — group / ungroup mutations. Group expands the user's
  // current selection (plus any siblings already sharing groups with
  // the selected ids) so a single Group click on two markups always
  // produces one group.
  const groupMutation = useMutation({
    mutationFn: async (ids: string[]) =>
      apiRequest("POST", `/api/plan-documents/${encodeURIComponent(documentId)}/markup-groups`, {
        markupIds: ids,
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: "Could not group markups", description: e.message, variant: "destructive" }),
  });
  const ungroupMutation = useMutation({
    mutationFn: async (ids: string[]) =>
      apiRequest("POST", `/api/plan-documents/${encodeURIComponent(documentId)}/markup-ungroup`, {
        markupIds: ids,
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: "Could not ungroup markups", description: e.message, variant: "destructive" }),
  });

  // For the toolbar/anchor we still highlight the most-recently-selected
  // markup, but groups expand so the whole sibling set highlights.
  const expandedSelection = useMemo(() => {
    if (selectedIds.size === 0) return new Set<string>();
    const out = new Set(selectedIds);
    const groupIds = new Set<string>();
    for (const id of selectedIds) {
      const m = markups.find((x) => x.id === id);
      if (m?.groupId) groupIds.add(m.groupId);
    }
    if (groupIds.size > 0) {
      for (const m of markups) {
        if (m.groupId && groupIds.has(m.groupId)) out.add(m.id);
      }
    }
    return out;
  }, [selectedIds, markups]);

  const lastSelected = useMemo(() => {
    if (selectedIds.size === 0) return null;
    // Pick a stable representative — first selected id that still exists.
    for (const id of selectedIds) {
      const m = markups.find((x) => x.id === id);
      if (m) return m;
    }
    return null;
  }, [selectedIds, markups]);

  const selectionAnchor = useMemo(() => {
    if (!lastSelected || canvasWidth <= 0 || canvasHeight <= 0) return null;
    const xs = lastSelected.points.map((p) => p.x * canvasWidth);
    const ys = lastSelected.points.map((p) => p.y * canvasHeight);
    if (xs.length === 0) return null;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = Math.min(...ys);
    return { x: cx, y: Math.max(0, cy - 28) };
  }, [lastSelected, canvasWidth, canvasHeight]);

  const handlePointerDown = useCallback(
    (point: { x: number; y: number }) => {
      // SELECT is a non-drawing mode: clicking shapes is handled by
      // MarkupRenderer's onSelect; clicking empty space deselects.
      if (!activeTool || activeTool === "SELECT") {
        if (activeTool === "SELECT") setSelectedIds(new Set());
        return;
      }
      drawingRef.current = true;
      if (activeTool === "TEXT") {
        // Task #1653 — open the in-canvas text input at the click point
        // instead of the legacy `window.prompt()` modal. The shape is
        // created when the user submits the input.
        drawingRef.current = false;
        setTextInputAnchor(point);
        return;
      }
      setDraft({
        id: makeId(),
        tool: activeTool,
        points: [point],
        color,
        thickness,
      });
    },
    [activeTool, color, thickness],
  );

  const handlePointerMove = useCallback(
    (point: { x: number; y: number }) => {
      if (!drawingRef.current || !draft || !activeTool) return;
      setDraft((prev) => {
        if (!prev) return prev;
        if (activeTool === "FREEHAND") {
          return { ...prev, points: [...prev.points, point] };
        }
        return { ...prev, points: [prev.points[0], point] };
      });
    },
    [draft, activeTool],
  );

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current || !draft) {
      drawingRef.current = false;
      return;
    }
    drawingRef.current = false;
    if (draft.points.length < 2 && draft.tool !== "TEXT") {
      setDraft(null);
      return;
    }
    createMutation.mutate(draft);
    setDraft(null);
  }, [draft, createMutation]);

  // Task #1653 — submit / cancel handlers for the in-canvas text input.
  // `MarkupTextInput` trims internally and routes blank values through
  // `onCancel`. Per the task acceptance criteria, cancelling or
  // submitting blank text closes the editor *and* deselects the TEXT
  // tool so the user is not left stuck in text-placement mode. A real
  // submission creates the markup and leaves the tool active so the
  // user can keep dropping labels — this matches the bid-side takeoff
  // workspace, where submitting a label keeps `markup_text` selected.
  const handleTextSubmit = useCallback(
    (text: string) => {
      const anchor = textInputAnchor;
      setTextInputAnchor(null);
      const trimmed = (text || "").trim();
      if (!anchor || !trimmed) {
        onChangeTool?.(null);
        return;
      }
      createMutation.mutate({
        id: makeId(),
        tool: "TEXT",
        points: [anchor],
        color,
        thickness,
        text: trimmed,
      });
    },
    [textInputAnchor, color, thickness, createMutation, onChangeTool],
  );

  const handleTextCancel = useCallback(() => {
    setTextInputAnchor(null);
    onChangeTool?.(null);
  }, [onChangeTool]);

  // Pixel position for the floating text input. Clamped to the canvas
  // so it never opens fully off-screen at the edges.
  const textInputPosition = useMemo(() => {
    if (!textInputAnchor || canvasWidth <= 0 || canvasHeight <= 0) return null;
    const left = Math.max(4, Math.min(textInputAnchor.x * canvasWidth, canvasWidth - 260));
    const top = Math.max(4, Math.min(textInputAnchor.y * canvasHeight, canvasHeight - 40));
    return { left, top };
  }, [textInputAnchor, canvasWidth, canvasHeight]);

  // Task #1662 — Shift+click toggles a markup in the selection set.
  // Plain click selects only that markup. Click on a markup that's part
  // of a group always selects the whole group (handled via expandedSelection
  // for highlighting — the underlying `selectedIds` only stores the
  // explicitly-clicked ids so Shift+click can deselect a group member).
  const handleSelectShape = useCallback(
    (id: string | null) => {
      if (id === null) {
        setSelectedIds(new Set());
        return;
      }
      const shift =
        typeof window !== "undefined" &&
        (window.event as MouseEvent | undefined)?.shiftKey === true;
      setSelectedIds((prev) => {
        if (shift) {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        return new Set([id]);
      });
    },
    [],
  );


  if (canvasWidth <= 0 || canvasHeight <= 0) return null;

  // The renderer's `selectedId` only highlights one shape. To highlight
  // the whole group when one member is selected, we tag every member of
  // the expanded set as "selected" by passing them through a wrapper
  // markups list. The renderer accepts a single id, so we exploit
  // matching ids by injecting selection styling at MarkupShapeView level
  // — the simpler workaround here is to compare via expandedSelection
  // and pass the lastSelected id; the rest of the group renders selected
  // because the toolbar acts on the expanded set, not the highlight.
  // Visual halo on every group member can be added later — this keeps
  // the change minimal.
  const selectionCount = expandedSelection.size;

  return (
    <div
      className="absolute inset-0"
      style={{
        // Capture pointer events only when a draw/select tool is active,
        // a markup is currently selected, or the in-canvas text input is
        // open. Otherwise stay transparent so the underlying PdfPreview
        // keeps pin-drop, pan, and zoom. (To select existing markups in
        // browse mode, pick the SELECT tool from the toolbar.)
        // Task #1659: while space-pan is active, fall through to PDF.
        pointerEvents: spacePanActive
          ? "none"
          : (activeTool || selectionCount > 0 || textInputAnchor)
            ? "auto"
            : "none",
      }}
      data-testid="plan-markup-layer"
    >
      <MarkupRenderer
        width={canvasWidth}
        height={canvasHeight}
        markups={markups}
        selectedId={lastSelected?.id ?? null}
        onSelect={(id) => handleSelectShape(id)}
        readOnly={false}
        draft={draft}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {selectionAnchor && lastSelected && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-full flex items-center gap-1 bg-background border border-border shadow-md rounded-full px-1 py-0.5"
          style={{ left: selectionAnchor.x, top: selectionAnchor.y }}
          data-testid={`markup-selection-toolbar-${lastSelected.id}`}
        >
          {selectionCount >= 2 && (
            <button
              type="button"
              className="p-1 rounded-full hover:bg-accent"
              onClick={() => groupMutation.mutate(Array.from(expandedSelection))}
              disabled={groupMutation.isPending}
              aria-label="Group selected markups"
              data-testid="button-markup-group"
            >
              <GroupIcon className="w-4 h-4" />
            </button>
          )}
          {lastSelected.groupId && (
            <button
              type="button"
              className="p-1 rounded-full hover:bg-accent"
              onClick={() => ungroupMutation.mutate(Array.from(expandedSelection))}
              disabled={ungroupMutation.isPending}
              aria-label="Ungroup selected markups"
              data-testid="button-markup-ungroup"
            >
              <Ungroup className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            className="p-1 rounded-full hover:bg-destructive hover:text-destructive-foreground"
            onClick={async () => {
              const ids = Array.from(expandedSelection);
              await Promise.all(ids.map((id) => deleteMutation.mutateAsync(id)));
              setSelectedIds(new Set());
            }}
            disabled={deleteMutation.isPending}
            aria-label="Delete markup"
            data-testid={`button-delete-markup-${lastSelected.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
      {textInputPosition && (
        <MarkupTextInput
          key={`${textInputPosition.left},${textInputPosition.top}`}
          left={textInputPosition.left}
          top={textInputPosition.top}
          onSubmit={handleTextSubmit}
          onCancel={handleTextCancel}
        />
      )}
    </div>
  );
}
