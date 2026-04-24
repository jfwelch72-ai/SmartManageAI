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
 *
 * Task #1676 — Now also owns:
 *  - Dragging a selected markup (or any member of a group) repositions
 *    every member of the expanded selection by the same delta. The
 *    plan-side bulk PATCH endpoint persists the new normalized points
 *    atomically. Halos render on every group member during selection so
 *    the user can see exactly what they are about to move.
 *
 * Task #1705 — Single-step undo for the most recent group move:
 *  - Before firing the bulk-PATCH, capture a snapshot of every moved
 *    markup's pre-move points (`buildMoveSnapshot`).
 *  - Cmd/Ctrl+Z (or the toolbar Undo button via `onUndoChange`) re-fires
 *    the same bulk-PATCH with the snapshot points, restoring the prior
 *    layout. The snapshot is consumed (cleared) on undo so a second
 *    Ctrl+Z is a no-op — group moves are explicitly single-step.
 *
 * Task #1723 — Multi-step undo / redo for group moves:
 *  - Replaces the single `lastMoveSnapshot` with a bounded ring buffer
 *    (`undoStack`, capped at `MAX_HISTORY = 20`) plus a forward
 *    `redoStack`. Each entry remembers both the pre-move points
 *    (`before`) and the post-move points (`after`) plus how many
 *    markups participated, so undo and redo can each fire a single
 *    bulk-PATCH and the toolbar tooltip can describe the action that
 *    will be undone/redone (e.g. "Move 5 markups").
 *  - Cmd/Ctrl+Z walks back through the undo stack one entry at a time;
 *    Cmd/Ctrl+Shift+Z (and Ctrl+Y on Windows muscle memory) replays the
 *    redo stack forward. A fresh group move clears the redo stack —
 *    the standard undo-history contract every editor follows.
 *  - The layer reports the full history shape (undo/redo handlers +
 *    descriptive labels) up to the parent via `onHistoryChange` so the
 *    toolbar can render Undo / Redo buttons whose tooltips spell out
 *    exactly which action will be reversed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2, Group as GroupIcon, Ungroup } from "lucide-react";
import type { KonvaEventObject, Node as KonvaNode } from "konva/lib/Node";
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
  /**
   * Task #1705 / Task #1723 — Reports the current undo/redo history shape
   * up to the parent so the plan toolbar can render Undo + Redo buttons
   * whose enabled state and tooltips reflect the actual stack contents.
   * Called whenever the stack contents change. Either handler is `null`
   * when there is nothing to walk in that direction (initial mount, page
   * change, or after the user has stepped fully back/forward). Labels
   * describe the action (e.g. "Move 5 markups") so the tooltip can spell
   * out exactly which edit will be reversed.
   */
  onHistoryChange?: (state: MarkupHistoryState) => void;
}

/**
 * Task #1723 — Shape reported by `<PlanMarkupLayer />` to the parent
 * toolbar via `onHistoryChange`. Both handlers are `null` when their
 * respective stack is empty so the parent can disable the matching
 * button without having to track stack depth itself.
 */
export interface MarkupHistoryState {
  undo: (() => void) | null;
  redo: (() => void) | null;
  /** Human-readable description of the action that Undo would reverse. */
  undoLabel: string | null;
  /** Human-readable description of the action that Redo would replay. */
  redoLabel: string | null;
}

/**
 * Task #1723 — Maximum number of group-move actions kept on the undo
 * stack. Older entries are dropped from the front when the stack grows
 * past this limit, so the user can always step back through their
 * recent edits without unbounded memory growth.
 */
export const MAX_MARKUP_HISTORY = 20;

/**
 * Task #1723 — One entry on the undo / redo stack. We keep both the
 * pre-move and post-move points so undo and redo can each fire a
 * single bulk-PATCH against the same shapes — no need to recompute the
 * delta. `count` powers the toolbar tooltip ("Move N markups").
 */
export interface MarkupMoveHistoryEntry {
  type: "move";
  before: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
  after: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
  count: number;
}

/**
 * Task #1723 — Format a history entry for the toolbar tooltip. Pure
 * helper so the label rendering stays consistent between the Undo and
 * Redo buttons and is unit-testable independently of the layer.
 */
export function describeHistoryEntry(entry: MarkupMoveHistoryEntry): string {
  if (entry.type === "move") {
    const n = entry.count;
    return n === 1 ? "Move 1 markup" : `Move ${n} markups`;
  }
  return "Edit";
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

// Task #1725 — `buildBulkMoveUpdates` and `buildMoveSnapshot` were
// extracted into `./moveHelpers` so the server-side undo round-trip
// integration test can import them under a Node test environment
// without dragging in `react-konva`. Imported AND re-exported here so
// existing call sites (this component's onDragEnd, plus the
// client-side helper unit tests at
// `__tests__/PlanMarkupLayer.bulkMove.test.tsx`) keep working.
// NOTE: `export { ... } from "./moveHelpers"` alone would NOT create
// local bindings — the runtime calls below would throw ReferenceError.
import { buildBulkMoveUpdates, buildMoveSnapshot } from "./moveHelpers";
export { buildBulkMoveUpdates, buildMoveSnapshot };

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
  onHistoryChange,
}: PlanMarkupLayerProps) {
  const { toast } = useToast();
  // Selection is stored as a set so SELECT + Shift can multi-select.
  // The first id is also kept for the legacy single-selection callers
  // (e.g. the floating delete button anchored at the markup).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const drawingRef = useRef(false);
  // Task #1706 — group drag is intentionally NOT React state. With 50+
  // markups in one selection, calling setState on every `onDragMove`
  // re-rendered the whole layer on every frame and dropped frames on
  // mid-range laptops. We now translate sibling Konva nodes directly
  // via `node.position()` and only flush back to React on `onDragEnd`
  // (the single optimistic-cache + bulk PATCH step). The ref tracks
  // the active drag so dragMove/dragEnd can find the cached sibling
  // nodes without traversing the Konva tree on every frame.
  //
  // Task #1676 (original behavior preserved): siblings of the dragged
  // markup are translated by the same pixel delta during the drag and
  // their new normalized points are persisted atomically on drag end.
  const groupDragRef = useRef<{
    id: string;
    origX: number;
    origY: number;
    siblings: KonvaNode[];
  } | null>(null);
  // Task #1705 / Task #1723 — Bounded undo stack + forward redo stack
  // for group/selection drags. The drag handler captures both the
  // pre-move and post-move points (after Task #1706's ref-based drag
  // has resolved the final delta) and pushes a fresh entry onto the
  // undo stack; firing a new move clears any pending redo entries
  // (standard undo-history contract). Refs mirror the state so the
  // global keyboard listener and the parent-facing handlers see the
  // latest stack contents without needing to be re-bound on every
  // edit.
  const [undoStack, setUndoStack] = useState<MarkupMoveHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<MarkupMoveHistoryEntry[]>([]);
  const undoStackRef = useRef<MarkupMoveHistoryEntry[]>([]);
  const redoStackRef = useRef<MarkupMoveHistoryEntry[]>([]);
  undoStackRef.current = undoStack;
  redoStackRef.current = redoStack;
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

  // Task #1676 — atomic bulk reposition. Used after a group/selection
  // drag ends. Optimistically rewrites the cached points so the UI
  // doesn't snap back to the pre-drag location while the request is
  // in flight; rolls back on error.
  const bulkMoveMutation = useMutation({
    mutationFn: async (
      updates: Array<{ id: string; points: Array<{ x: number; y: number }> }>,
    ) =>
      apiRequest(
        "PATCH",
        `/api/plan-documents/${encodeURIComponent(documentId)}/markups/bulk`,
        { updates },
      ),
    onMutate: async (updates) => {
      const queryKey = [
        "/api/plan-documents",
        documentId,
        "markups",
        pageNumber,
      ];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ServerMarkup[]>(queryKey);
      const updateById = new Map(updates.map((u) => [u.id, u.points]));
      queryClient.setQueryData<ServerMarkup[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((m) =>
          updateById.has(m.id)
            ? { ...m, points: updateById.get(m.id)! }
            : m,
        );
      });
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      const queryKey = [
        "/api/plan-documents",
        documentId,
        "markups",
        pageNumber,
      ];
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      toast({
        title: "Could not move markups",
        description: e.message,
        variant: "destructive",
      });
    },
    onSettled: () => invalidate(),
  });

  // Task #1723 — Undo / redo helpers. Both pop from one stack and push
  // onto the other, then re-issue the same bulk-PATCH that originally
  // applied the move (Undo replays `before`, Redo replays `after`). If
  // the bulk-PATCH itself fails the entry is restored to its source
  // stack so the user can retry — symmetric with how a fresh forward
  // move pops itself off the undo stack on failure.
  const undoLastMove = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, entry]);
    bulkMoveMutation.mutate(entry.before, {
      onError: () => {
        // Roll back the stack swap so the user can try again. We push
        // the entry back to the front of the undo stack and remove it
        // from the redo stack — both stacks are mutated optimistically
        // above, so any new edits the user fired in between would
        // already have cleared the redo stack regardless.
        setUndoStack((prev) => [...prev, entry]);
        setRedoStack((prev) => prev.filter((e) => e !== entry));
      },
    });
  }, [bulkMoveMutation]);

  const redoLastMove = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, entry]);
    bulkMoveMutation.mutate(entry.after, {
      onError: () => {
        setRedoStack((prev) => [...prev, entry]);
        setUndoStack((prev) => prev.filter((e) => e !== entry));
      },
    });
  }, [bulkMoveMutation]);

  // Task #1705 / Task #1723 — surface the current history shape to the
  // parent toolbar. Either handler is `null` when its stack is empty so
  // the parent can disable the matching button without tracking depth.
  // The labels describe the action that would be reversed/replayed
  // (e.g. "Move 5 markups") so the tooltip can be specific.
  useEffect(() => {
    if (!onHistoryChange) return;
    const undoTop = undoStack[undoStack.length - 1] ?? null;
    const redoTop = redoStack[redoStack.length - 1] ?? null;
    onHistoryChange({
      undo: undoTop ? undoLastMove : null,
      redo: redoTop ? redoLastMove : null,
      undoLabel: undoTop ? describeHistoryEntry(undoTop) : null,
      redoLabel: redoTop ? describeHistoryEntry(redoTop) : null,
    });
  }, [undoStack, redoStack, undoLastMove, redoLastMove, onHistoryChange]);

  // Task #1705 — clear both stacks when the user navigates to a
  // different page or document. Undo/redo against a stale page would
  // silently mutate hidden markups, which is confusing.
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [documentId, pageNumber]);

  // Task #1705 / Task #1723 — global keyboard handlers for Undo (Ctrl/
  // Cmd+Z) and Redo (Ctrl/Cmd+Shift+Z, plus Ctrl+Y for Windows muscle
  // memory). Attached only while at least one stack has contents so we
  // never compete with browser/text-input undo when there's nothing to
  // walk through. The listener reads the latest stack via refs so a
  // single registration covers any number of subsequent edits.
  useEffect(() => {
    if (undoStack.length === 0 && redoStack.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (editable) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        if (undoStackRef.current.length === 0) return;
        e.preventDefault();
        undoLastMove();
        return;
      }
      // Redo: Ctrl/Cmd+Shift+Z OR Ctrl+Y (Windows convention). Cmd+Y
      // on macOS is "history" in browsers, so we keep the Y shortcut
      // gated on Ctrl rather than the meta key.
      if ((key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey)) {
        if (redoStackRef.current.length === 0) return;
        e.preventDefault();
        redoLastMove();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoStack.length, redoStack.length, undoLastMove, redoLastMove]);

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
    (point: { x: number; y: number }, evt: KonvaEventObject<PointerEvent>) => {
      // SELECT is a non-drawing mode: clicking shapes is handled by
      // MarkupRenderer's onSelect, and clicking empty stage area is
      // already cleared by MarkupRenderer's onClick. We must NOT clear
      // the selection here on every pointerdown — Task #1676's group
      // drag relies on the selection persisting from mouse-down through
      // drag-end so getGroupProps keeps returning draggable handlers.
      if (!activeTool || activeTool === "SELECT") {
        // Belt-and-suspenders: if the pointerdown landed on the empty
        // stage (target === stage), still clear so a quick mousedown
        // before the click event resolves doesn't leave a stale halo.
        if (
          activeTool === "SELECT" &&
          evt.target === evt.target.getStage()
        ) {
          setSelectedIds(new Set());
        }
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

  // Task #1676 — wire per-shape Konva Group props so any markup that is
  // part of the current expanded selection becomes draggable. Dragging
  // any one member translates every other member by the same pixel
  // delta in real time (via Konva Group x/y on the non-dragged members)
  // and persists every member's new normalized points atomically when
  // the drag ends. Single-selected (non-grouped) markups are also
  // draggable so the plan-side surface matches the bid-side takeoff
  // workspace's behavior.
  const getGroupProps = useCallback(
    (shape: MarkupShape) => {
      if (!expandedSelection.has(shape.id)) return undefined;
      // Task #1706 — every selectable group member gets a Konva `name`
      // so onDragStart can locate its siblings via a single `find()`
      // pass on the layer (no React refs to plumb through the shared
      // renderer). The name is namespaced per markup id.
      return {
        name: `markup-drag-member-${shape.id}`,
        draggable: true,
        onMouseEnter: (e: KonvaEventObject<MouseEvent>) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "move";
        },
        onMouseLeave: (e: KonvaEventObject<MouseEvent>) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "default";
        },
        onDragStart: (e: KonvaEventObject<DragEvent>) => {
          e.cancelBubble = true;
          const origX = e.target.x();
          const origY = e.target.y();
          // Cache sibling Konva nodes once at the start of the drag so
          // onDragMove (which fires per pointer frame) doesn't have to
          // walk the layer tree. Disable hit-testing AND draggable on
          // siblings so they don't intercept the gesture mid-drag.
          const layer = e.target.getLayer();
          const siblings: KonvaNode[] = [];
          if (layer) {
            for (const id of expandedSelection) {
              if (id === shape.id) continue;
              const node = layer.findOne(`.markup-drag-member-${id}`);
              if (node) {
                node.draggable(false);
                node.listening(false);
                siblings.push(node);
              }
            }
          }
          groupDragRef.current = {
            id: shape.id,
            origX,
            origY,
            siblings,
          };
        },
        onDragMove: (e: KonvaEventObject<DragEvent>) => {
          const drag = groupDragRef.current;
          if (!drag) return;
          const dx = e.target.x() - drag.origX;
          const dy = e.target.y() - drag.origY;
          // Imperatively translate every sibling by the same pixel
          // delta. No setState / no React reconciliation runs for the
          // duration of the drag — that's what keeps a 50+ selection
          // at 60fps on lower-end laptops.
          for (const node of drag.siblings) {
            node.position({ x: dx, y: dy });
          }
          e.target.getLayer()?.batchDraw();
        },
        onDragEnd: (e: KonvaEventObject<DragEvent>) => {
          const drag = groupDragRef.current;
          if (!drag) return;
          const dx = e.target.x() - drag.origX;
          const dy = e.target.y() - drag.origY;
          // Reset every Konva-managed position before the optimistic
          // cache update lands so no shape "double-shifts" when the
          // re-render rewrites the points with the new normalized
          // coordinates. Restore listening + draggable on siblings so
          // the user can immediately start a new drag from any member.
          e.target.position({ x: drag.origX, y: drag.origY });
          for (const node of drag.siblings) {
            node.position({ x: 0, y: 0 });
            node.listening(true);
            node.draggable(true);
          }
          e.target.getLayer()?.batchDraw();
          groupDragRef.current = null;
          if (dx === 0 && dy === 0) return;
          if (canvasWidth <= 0 || canvasHeight <= 0) return;
          const memberIds = Array.from(expandedSelection);
          const updates = buildBulkMoveUpdates(
            markups,
            memberIds,
            dx / canvasWidth,
            dy / canvasHeight,
          );
          if (updates.length === 0) return;
          // Task #1705 / Task #1723 — capture both the pre-move points
          // (`before`, used by undo) and the post-move points
          // (`after`, used by redo) BEFORE the optimistic update
          // rewrites the cache. The new entry is pushed onto the
          // bounded undo stack and the redo stack is cleared (a fresh
          // edit always invalidates any pending redo entries — the
          // standard contract every editor follows). Older entries
          // beyond `MAX_MARKUP_HISTORY` are dropped from the front so
          // the stack stays bounded.
          const before = buildMoveSnapshot(markups, memberIds);
          const after = updates.map((u) => ({
            id: u.id,
            points: u.points.map((p) => ({ x: p.x, y: p.y })),
          }));
          const entry: MarkupMoveHistoryEntry = {
            type: "move",
            before,
            after,
            count: before.length,
          };
          setUndoStack((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_MARKUP_HISTORY
              ? next.slice(next.length - MAX_MARKUP_HISTORY)
              : next;
          });
          setRedoStack([]);
          bulkMoveMutation.mutate(updates, {
            // If the forward move never landed (server error,
            // permission denied, etc.) the cache rolls back via the
            // shared onError above. Pop the just-pushed entry too so
            // the user does not see an Undo button for a move that
            // didn't actually happen — pressing it would issue a
            // no-op PATCH against the already-restored points.
            onError: () => setUndoStack((prev) => prev.filter((e) => e !== entry)),
          });
        },
      };
    },
    [
      expandedSelection,
      markups,
      canvasWidth,
      canvasHeight,
      bulkMoveMutation,
    ],
  );


  if (canvasWidth <= 0 || canvasHeight <= 0) return null;

  // Task #1676 — every member of the expanded selection now renders
  // with the selection halo (passed through `selectedIds` on the
  // shared renderer), so the user sees the entire group light up when
  // any one member is clicked or shift-extended.
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
        // Task #1676 — halo every member of the selection (incl. group
        // siblings) so the user sees what's about to move.
        selectedIds={expandedSelection}
        onSelect={(id) => handleSelectShape(id)}
        readOnly={false}
        draft={draft}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        getGroupProps={getGroupProps}
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
