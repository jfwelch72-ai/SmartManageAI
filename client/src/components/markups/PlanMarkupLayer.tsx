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
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
}

interface ServerMarkup extends MarkupShape {
  createdAt?: string;
  organizationId?: string;
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
}: PlanMarkupLayerProps) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const drawingRef = useRef(false);
  // Task #1653 — anchor for the in-canvas text input that replaces the
  // legacy `window.prompt()` flow. Coordinates are normalized 0-1 to
  // match `MarkupShape.points`; we denormalize when positioning the
  // floating input.
  const [textInputAnchor, setTextInputAnchor] = useState<{ x: number; y: number } | null>(null);

  const { data: markups = [] } = useQuery<ServerMarkup[]>({
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
      setSelectedId(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Could not delete markup", description: e.message, variant: "destructive" }),
  });

  // Selected markup screen position for the floating delete button.
  const selected = useMemo(
    () => markups.find((m) => m.id === selectedId) || null,
    [markups, selectedId],
  );

  const selectionAnchor = useMemo(() => {
    if (!selected || canvasWidth <= 0 || canvasHeight <= 0) return null;
    const xs = selected.points.map((p) => p.x * canvasWidth);
    const ys = selected.points.map((p) => p.y * canvasHeight);
    if (xs.length === 0) return null;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = Math.min(...ys);
    return { x: cx, y: Math.max(0, cy - 28) };
  }, [selected, canvasWidth, canvasHeight]);

  const handlePointerDown = useCallback(
    (point: { x: number; y: number }) => {
      // SELECT is a non-drawing mode: clicking shapes is handled by
      // MarkupRenderer's onSelect; clicking empty space deselects.
      if (!activeTool || activeTool === "SELECT") {
        if (activeTool === "SELECT") setSelectedId(null);
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

  if (canvasWidth <= 0 || canvasHeight <= 0) return null;

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
          : (activeTool || selectedId || textInputAnchor)
            ? "auto"
            : "none",
      }}
      data-testid="plan-markup-layer"
    >
      <MarkupRenderer
        width={canvasWidth}
        height={canvasHeight}
        markups={markups}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
        readOnly={false}
        draft={draft}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {selectionAnchor && selected && (
        <button
          type="button"
          className="absolute z-10 -translate-x-1/2 -translate-y-full bg-background border border-border shadow-md rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground"
          style={{ left: selectionAnchor.x, top: selectionAnchor.y }}
          onClick={() => deleteMutation.mutate(selected.id)}
          disabled={deleteMutation.isPending}
          aria-label="Delete markup"
          data-testid={`button-delete-markup-${selected.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
