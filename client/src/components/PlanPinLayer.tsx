import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertCircle, Wrench, FileCheck, X, Trash2, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type PinType = "RFI" | "PUNCH" | "SUBMITTAL";

export interface PlanPin {
  id: string;
  organizationId: string;
  projectCode: string;
  planDocumentId: string;
  pageNumber: number;
  x: number;
  y: number;
  pinType: PinType;
  refTable: string;
  refId: string;
  createdById: string;
  createdAt: string;
}

export interface PinMeta {
  title: string;
  status: string;
  dueDate?: string | null;
  ownerName?: string | null;
}

export interface PinFilter {
  type: "ALL" | PinType;
  openOnly: boolean;
}

const PIN_STYLE: Record<PinType, { icon: typeof AlertCircle; color: string; bg: string; label: string }> = {
  RFI: { icon: AlertCircle, color: "text-white", bg: "bg-red-500", label: "RFI" },
  PUNCH: { icon: Wrench, color: "text-white", bg: "bg-orange-500", label: "Punch" },
  SUBMITTAL: { icon: FileCheck, color: "text-white", bg: "bg-blue-500", label: "Submittal" },
};

const OPEN_STATUSES = new Set([
  "OPEN", "DRAFT", "SUBMITTED", "UNDER_REVIEW", "FORWARDED", "IN_PROGRESS", "PENDING",
]);

function isOpen(status: string | undefined): boolean {
  if (!status) return true;
  return OPEN_STATUSES.has(status);
}

function statusDotColor(status: string | undefined): string {
  if (!status) return "bg-gray-300";
  const s = status.toUpperCase();
  if (["CLOSED", "RESOLVED", "VERIFIED", "ANSWERED", "APPROVED", "REVIEWED"].includes(s)) return "bg-green-500";
  if (["REJECTED", "REVISE_AND_RESUBMIT"].includes(s)) return "bg-red-500";
  if (isOpen(s)) return "bg-yellow-400";
  return "bg-gray-300";
}

interface PlanPinLayerProps {
  projectCode: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  filter: PinFilter;
  onOpenSource?: (pin: PlanPin) => void;
}

export function PlanPinLayer({
  projectCode,
  projectId,
  documentId,
  pageNumber,
  filter,
  onOpenSource,
}: PlanPinLayerProps) {
  const { toast } = useToast();

  const { data: pins = [] } = useQuery<PlanPin[]>({
    queryKey: ["/api/projects", projectCode, "plan-pins", { documentId, pageNumber }],
    queryFn: async () => {
      const params = new URLSearchParams({ documentId, page: String(pageNumber) });
      const r = await fetch(`/api/projects/${projectCode}/plan-pins?${params}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!documentId,
  });

  // Fetch source object meta in batch (for hover popover details)
  const { data: rfiList = [] } = useQuery<any[]>({
    queryKey: ["/api/rfi", { projectId }],
    queryFn: async () => {
      const r = await fetch(`/api/rfi?projectId=${projectId}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId && pins.some(p => p.pinType === "RFI"),
  });

  const { data: punchList = [] } = useQuery<any[]>({
    queryKey: ["/api/projects", projectCode, "punch-list", "for-pins"],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/punch-list`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectCode && pins.some(p => p.pinType === "PUNCH"),
  });

  const { data: submittalList = [] } = useQuery<any[]>({
    queryKey: ["/api/submittals", { projectId }],
    queryFn: async () => {
      const r = await fetch(`/api/submittals?projectId=${projectId}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId && pins.some(p => p.pinType === "SUBMITTAL"),
  });

  const metaMap = useMemo(() => {
    const m = new Map<string, PinMeta>();
    for (const r of rfiList) {
      const rfi = r.rfi || r;
      if (rfi?.id) m.set(rfi.id, {
        title: rfi.subject || rfi.rfiNumber || "RFI",
        status: rfi.status || "DRAFT",
        dueDate: rfi.dateRequired || null,
        ownerName: rfi.submittedByName || null,
      });
    }
    for (const it of punchList) {
      if (it?.id) m.set(it.id, {
        title: it.title || it.itemNumber || "Punch Item",
        status: it.status || "OPEN",
        dueDate: it.dueDate || null,
        ownerName: it.assignedToName || null,
      });
    }
    for (const s of submittalList) {
      const sub = s.submittal || s;
      if (sub?.id) m.set(sub.id, {
        title: sub.subject || sub.submittalNumber || "Submittal",
        status: sub.status || "DRAFT",
        dueDate: sub.dateRequired || null,
        ownerName: sub.submittedByName || null,
      });
    }
    return m;
  }, [rfiList, punchList, submittalList]);

  const deleteMutation = useMutation({
    mutationFn: async (pinId: string) => apiRequest("DELETE", `/api/plan-pins/${pinId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "plan-pins"] });
      toast({ title: "Pin removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ pinId, x, y }: { pinId: string; x: number; y: number; onError?: () => void }) =>
      apiRequest("PATCH", `/api/plan-pins/${pinId}`, { x, y }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "plan-pins"] });
    },
    onError: (e: Error, vars) => {
      vars.onError?.();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "plan-pins"] });
      toast({ title: "Could not move pin", description: e.message, variant: "destructive" });
    },
  });

  const movePageMutation = useMutation({
    mutationFn: async (vars: { pinId: string; pageNumber: number; planDocumentId?: string }) => {
      const body: Record<string, unknown> = { pageNumber: vars.pageNumber };
      if (vars.planDocumentId) body.planDocumentId = vars.planDocumentId;
      return apiRequest("PATCH", `/api/plan-pins/${vars.pinId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "plan-pins"] });
      toast({ title: "Pin moved" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not move pin", description: e.message, variant: "destructive" });
    },
  });

  const { data: projectDocs = [] } = useQuery<Array<{ id: string; title: string; fileName: string; mimeType: string | null; type: string }>>({
    queryKey: ["/api/projects", projectCode, "documents"],
    enabled: !!projectCode,
  });

  const movableDocs = useMemo(
    () =>
      projectDocs.filter((d) =>
        (d.mimeType || "").toLowerCase().includes("pdf") ||
        (d.fileName || "").toLowerCase().endsWith(".pdf"),
      ),
    [projectDocs],
  );

  const visiblePins = useMemo(() => {
    return pins.filter((p) => {
      if (filter.type !== "ALL" && p.pinType !== filter.type) return false;
      if (filter.openOnly) {
        const meta = metaMap.get(p.refId);
        if (meta && !isOpen(meta.status)) return false;
      }
      return true;
    });
  }, [pins, filter, metaMap]);

  return (
    <>
      {visiblePins.map((pin) => (
        <PinItem
          key={pin.id}
          pin={pin}
          meta={metaMap.get(pin.refId)}
          onOpenSource={onOpenSource}
          onDelete={(id) => deleteMutation.mutate(id)}
          deletePending={deleteMutation.isPending}
          onMove={(id, x, y, onError) => moveMutation.mutate({ pinId: id, x, y, onError })}
          onMoveToPage={(id, pageNumber, planDocumentId) =>
            movePageMutation.mutate({ pinId: id, pageNumber, planDocumentId })
          }
          movePagePending={movePageMutation.isPending}
          documents={movableDocs}
        />
      ))}
    </>
  );
}

interface PinItemProps {
  pin: PlanPin;
  meta?: PinMeta;
  onOpenSource?: (pin: PlanPin) => void;
  onDelete: (pinId: string) => void;
  deletePending: boolean;
  onMove: (pinId: string, x: number, y: number, onError?: () => void) => void;
  onMoveToPage: (pinId: string, pageNumber: number, planDocumentId?: string) => void;
  movePagePending: boolean;
  documents: Array<{ id: string; title: string; fileName: string }>;
}

const DRAG_THRESHOLD_PX = 4;

function PinItem({
  pin,
  meta,
  onOpenSource,
  onDelete,
  deletePending,
  onMove,
  onMoveToPage,
  movePagePending,
  documents,
}: PinItemProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDocId, setMoveDocId] = useState<string>(pin.planDocumentId);
  const [movePage, setMovePage] = useState<string>(String(pin.pageNumber));

  useEffect(() => {
    if (moveOpen) {
      setMoveDocId(pin.planDocumentId);
      setMovePage(String(pin.pageNumber));
    }
  }, [moveOpen, pin.planDocumentId, pin.pageNumber]);

  const submitMove = () => {
    const pageNumber = parseInt(movePage, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    const targetDocId = moveDocId !== pin.planDocumentId ? moveDocId : undefined;
    if (targetDocId === undefined && pageNumber === pin.pageNumber) {
      setMoveOpen(false);
      return;
    }
    onMoveToPage(pin.id, pageNumber, targetDocId);
    setMoveOpen(false);
  };

  const styleDef = PIN_STYLE[pin.pinType];
  const Icon = styleDef.icon;
  const dot = statusDotColor(meta?.status);

  // Transient drag position (fractions 0..1) — null when not dragging
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startRef = useRef<{ px: number; py: number; rect: DOMRect } | null>(null);
  const suppressClickRef = useRef(false);
  const dropTargetRef = useRef<Element | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; btn: HTMLElement } | null>(null);

  const clearDropTarget = () => {
    if (dropTargetRef.current) {
      try { (dropTargetRef.current as HTMLElement).removeAttribute("data-pin-drop-active"); } catch {}
      dropTargetRef.current = null;
    }
  };

  const updateDropTarget = (clientX: number, clientY: number, btn: HTMLElement) => {
    const prevDisplay = btn.style.display;
    btn.style.display = "none";
    const el = document.elementFromPoint(clientX, clientY);
    btn.style.display = prevDisplay;
    const target = el && (el.closest('[data-pin-drop-target]') as HTMLElement | null);
    if (target !== dropTargetRef.current) {
      clearDropTarget();
      if (target) {
        target.setAttribute("data-pin-drop-active", "true");
        dropTargetRef.current = target;
      }
    }
    return target;
  };

  const EDGE_PX = 60;
  const MAX_SPEED_PX = 18;

  const findScrollableAncestors = (el: Element | null): HTMLElement[] => {
    const out: HTMLElement[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur instanceof HTMLElement) {
        const cs = getComputedStyle(cur);
        const scrollableX =
          (cs.overflowX === "auto" || cs.overflowX === "scroll") && cur.scrollWidth > cur.clientWidth;
        const scrollableY =
          (cs.overflowY === "auto" || cs.overflowY === "scroll") && cur.scrollHeight > cur.clientHeight;
        if (scrollableX || scrollableY) out.push(cur);
      }
      cur = cur.parentElement;
    }
    return out;
  };

  const autoScrollTick = () => {
    autoScrollRafRef.current = null;
    if (!draggingRef.current) return;
    const ptr = lastPointerRef.current;
    if (ptr) {
      const btn = ptr.btn;
      const prevDisplay = btn.style.display;
      btn.style.display = "none";
      const el = document.elementFromPoint(ptr.x, ptr.y);
      btn.style.display = prevDisplay;
      const ancestors = findScrollableAncestors(el);
      let scrolled = false;
      for (const sc of ancestors) {
        const r = sc.getBoundingClientRect();
        const cs = getComputedStyle(sc);
        if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && sc.scrollWidth > sc.clientWidth) {
          if (ptr.x < r.left + EDGE_PX && sc.scrollLeft > 0) {
            const factor = Math.min(1, (r.left + EDGE_PX - ptr.x) / EDGE_PX);
            const before = sc.scrollLeft;
            sc.scrollLeft = Math.max(0, before - Math.max(2, Math.round(MAX_SPEED_PX * factor)));
            if (sc.scrollLeft !== before) scrolled = true;
          } else if (ptr.x > r.right - EDGE_PX && sc.scrollLeft + sc.clientWidth < sc.scrollWidth) {
            const factor = Math.min(1, (ptr.x - (r.right - EDGE_PX)) / EDGE_PX);
            const before = sc.scrollLeft;
            sc.scrollLeft = before + Math.max(2, Math.round(MAX_SPEED_PX * factor));
            if (sc.scrollLeft !== before) scrolled = true;
          }
        }
        if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && sc.scrollHeight > sc.clientHeight) {
          if (ptr.y < r.top + EDGE_PX && sc.scrollTop > 0) {
            const factor = Math.min(1, (r.top + EDGE_PX - ptr.y) / EDGE_PX);
            const before = sc.scrollTop;
            sc.scrollTop = Math.max(0, before - Math.max(2, Math.round(MAX_SPEED_PX * factor)));
            if (sc.scrollTop !== before) scrolled = true;
          } else if (ptr.y > r.bottom - EDGE_PX && sc.scrollTop + sc.clientHeight < sc.scrollHeight) {
            const factor = Math.min(1, (ptr.y - (r.bottom - EDGE_PX)) / EDGE_PX);
            const before = sc.scrollTop;
            sc.scrollTop = before + Math.max(2, Math.round(MAX_SPEED_PX * factor));
            if (sc.scrollTop !== before) scrolled = true;
          }
        }
        if (scrolled) break;
      }
      if (scrolled) {
        // After scrolling, the element under the pointer may have changed.
        updateDropTarget(ptr.x, ptr.y, btn);
      }
    }
    autoScrollRafRef.current = requestAnimationFrame(autoScrollTick);
  };

  const startAutoScroll = () => {
    if (autoScrollRafRef.current == null) {
      autoScrollRafRef.current = requestAnimationFrame(autoScrollTick);
    }
  };

  const stopAutoScroll = () => {
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    lastPointerRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current != null) cancelAnimationFrame(autoScrollRafRef.current);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const parent = e.currentTarget.offsetParent as HTMLElement | null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    startRef.current = { px: e.clientX, py: e.clientY, rect };
    draggingRef.current = true;
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current || !startRef.current) return;
    const { px, py, rect } = startRef.current;
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    if (!movedRef.current && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    movedRef.current = true;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setDragPos({ x, y });
    updateDropTarget(e.clientX, e.clientY, e.currentTarget);
    lastPointerRef.current = { x: e.clientX, y: e.clientY, btn: e.currentTarget };
    startAutoScroll();
  };

  const finishDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    stopAutoScroll();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}

    const target = movedRef.current
      ? updateDropTarget(e.clientX, e.clientY, e.currentTarget)
      : null;
    clearDropTarget();

    if (target) {
      const pageStr = target.getAttribute("data-pin-drop-page");
      const docId = target.getAttribute("data-pin-drop-doc");
      const targetPage = pageStr ? parseInt(pageStr, 10) : NaN;
      const crossDoc = !!docId && docId !== pin.planDocumentId;
      const samePage = Number.isInteger(targetPage) && targetPage === pin.pageNumber;
      if (crossDoc || (Number.isInteger(targetPage) && !samePage)) {
        suppressClickRef.current = true;
        setDragPos(null);
        const pageNumber = Number.isInteger(targetPage) ? targetPage : 1;
        onMoveToPage(pin.id, pageNumber, crossDoc ? docId! : undefined);
        startRef.current = null;
        return;
      }
      // Dropped on a target that doesn't change page or document (e.g. the
      // pin's own document row, or its current page thumbnail) — treat as a
      // no-op rather than snapping the pin to the cursor's clamped coords.
      suppressClickRef.current = true;
      setDragPos(null);
      startRef.current = null;
      return;
    }

    if (movedRef.current && dragPos) {
      suppressClickRef.current = true;
      onMove(pin.id, dragPos.x, dragPos.y, () => setDragPos(null));
    } else {
      setDragPos(null);
    }
    startRef.current = null;
  };

  const onClickCapture = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const displayX = dragPos ? dragPos.x : pin.x;
  const displayY = dragPos ? dragPos.y : pin.y;

  // Reconcile transient drag position with refreshed canonical pin data.
  // Clears the override when the server result is close enough (epsilon),
  // ensuring we don't get stuck if there's any rounding drift.
  useEffect(() => {
    if (!dragPos) return;
    const epsilon = 1e-4;
    if (Math.abs(pin.x - dragPos.x) < epsilon && Math.abs(pin.y - dragPos.y) < epsilon) {
      setDragPos(null);
    }
  }, [pin.x, pin.y, dragPos]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "absolute -translate-x-1/2 -translate-y-full pointer-events-auto touch-none cursor-grab active:cursor-grabbing",
            "flex items-center justify-center rounded-full shadow-md hover:scale-110 transition-transform",
            "min-w-[28px] min-h-[28px] sm:min-w-[24px] sm:min-h-[24px]",
            styleDef.bg,
          )}
          style={{
            left: `${displayX * 100}%`,
            top: `${displayY * 100}%`,
          }}
          title={meta?.title || styleDef.label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onClickCapture={onClickCapture}
          data-testid={`plan-pin-${pin.id}`}
        >
          <Icon className={cn("w-3.5 h-3.5", styleDef.color)} />
          <span
            className={cn(
              "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-white",
              dot,
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 p-3 text-sm" data-testid={`plan-pin-popover-${pin.id}`}>
        <div className="flex items-start gap-2 mb-2">
          <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded", styleDef.bg)}>
            <Icon className="w-3.5 h-3.5 text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate" data-testid="plan-pin-popover-title">
              {meta?.title || `${styleDef.label} pin`}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] h-4 px-1">{styleDef.label}</Badge>
              {meta?.status && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{meta.status}</Badge>
              )}
            </div>
          </div>
        </div>
        {meta?.dueDate && (
          <div className="text-xs text-muted-foreground mb-1">
            Due: {new Date(meta.dueDate).toLocaleDateString()}
          </div>
        )}
        {meta?.ownerName && (
          <div className="text-xs text-muted-foreground mb-2">
            Owner: {meta.ownerName}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mb-2">
          Tip: drag the pin to reposition it on this page, or use Move to send it to another page.
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs flex-1"
            onClick={() => onOpenSource?.(pin)}
            data-testid={`button-open-pin-source-${pin.id}`}
          >
            Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setMoveOpen(true)}
            disabled={movePagePending}
            data-testid={`button-move-pin-${pin.id}`}
            title="Move to another page or document"
          >
            <Move className="w-3.5 h-3.5 mr-1" />
            Move
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onDelete(pin.id)}
            disabled={deletePending}
            data-testid={`button-delete-pin-${pin.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PopoverContent>
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent data-testid={`dialog-move-pin-${pin.id}`}>
          <DialogHeader>
            <DialogTitle>Move pin</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {documents.length > 1 && (
              <div>
                <Label htmlFor={`move-doc-${pin.id}`}>Plan document</Label>
                <Select value={moveDocId} onValueChange={setMoveDocId}>
                  <SelectTrigger id={`move-doc-${pin.id}`} data-testid={`select-move-pin-doc-${pin.id}`}>
                    <SelectValue placeholder="Choose a plan document" />
                  </SelectTrigger>
                  <SelectContent>
                    {documents.map((d) => (
                      <SelectItem key={d.id} value={d.id} data-testid={`option-move-pin-doc-${d.id}`}>
                        {d.title || d.fileName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor={`move-page-${pin.id}`}>Page number</Label>
              <Input
                id={`move-page-${pin.id}`}
                type="number"
                min={1}
                step={1}
                value={movePage}
                onChange={(e) => setMovePage(e.target.value)}
                data-testid={`input-move-pin-page-${pin.id}`}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                The pin will keep its current x/y position on the new page.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMoveOpen(false)}
              data-testid={`button-move-pin-cancel-${pin.id}`}
            >
              Cancel
            </Button>
            <Button
              onClick={submitMove}
              disabled={
                movePagePending ||
                !movePage ||
                !Number.isInteger(parseInt(movePage, 10)) ||
                parseInt(movePage, 10) < 1
              }
              data-testid={`button-move-pin-confirm-${pin.id}`}
            >
              {movePagePending ? "Moving…" : "Move pin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Popover>
  );
}

// ─── Pin picker (small dropdown shown at click position) ─────────────────────
interface PinPickerProps {
  position: { left: number; top: number };
  onPick: (type: PinType) => void;
  onCancel: () => void;
}

export function PinPicker({ position, onPick, onCancel }: PinPickerProps) {
  return (
    <div
      className="absolute z-50 -translate-x-1/2 bg-popover border rounded-md shadow-lg p-1 pointer-events-auto"
      style={{ left: `${position.left}%`, top: `${position.top}%` }}
      onClick={(e) => e.stopPropagation()}
      data-testid="pin-picker"
    >
      <div className="flex flex-col min-w-[200px]">
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded text-left"
          onClick={() => onPick("RFI")}
          data-testid="pin-picker-rfi"
        >
          <AlertCircle className="w-4 h-4 text-red-500" />
          Create RFI here
        </button>
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded text-left"
          onClick={() => onPick("PUNCH")}
          data-testid="pin-picker-punch"
        >
          <Wrench className="w-4 h-4 text-orange-500" />
          Create Punch Item here
        </button>
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded text-left"
          onClick={() => onPick("SUBMITTAL")}
          data-testid="pin-picker-submittal"
        >
          <FileCheck className="w-4 h-4 text-blue-500" />
          Create Submittal note here
        </button>
        <div className="border-t my-1" />
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded text-left text-muted-foreground"
          onClick={onCancel}
          data-testid="pin-picker-cancel"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Filter chips ────────────────────────────────────────────────────────────
interface PinFilterChipsProps {
  filter: PinFilter;
  onChange: (f: PinFilter) => void;
  pinModeActive: boolean;
  onTogglePinMode: () => void;
}

export function PinFilterChips({ filter, onChange, pinModeActive, onTogglePinMode }: PinFilterChipsProps) {
  const chip = (label: string, active: boolean, onClick: () => void, testId: string) => (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 text-xs rounded-full border transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border",
      )}
      data-testid={testId}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button
        size="sm"
        variant={pinModeActive ? "default" : "outline"}
        className="h-7 text-xs"
        onClick={onTogglePinMode}
        data-testid="button-toggle-pin-mode"
      >
        {pinModeActive ? "Exit Pin Mode" : "Pin Mode"}
      </Button>
      <span className="w-px h-5 bg-border mx-1" />
      {chip("All", filter.type === "ALL", () => onChange({ ...filter, type: "ALL" }), "chip-filter-all")}
      {chip("RFIs", filter.type === "RFI", () => onChange({ ...filter, type: "RFI" }), "chip-filter-rfi")}
      {chip("Punch", filter.type === "PUNCH", () => onChange({ ...filter, type: "PUNCH" }), "chip-filter-punch")}
      {chip("Submittals", filter.type === "SUBMITTAL", () => onChange({ ...filter, type: "SUBMITTAL" }), "chip-filter-submittal")}
      <span className="w-px h-5 bg-border mx-1" />
      {chip("Open only", filter.openOnly, () => onChange({ ...filter, openOnly: !filter.openOnly }), "chip-filter-open")}
    </div>
  );
}

// ─── Pin create dialog (creates source object, then pin) ────────────────────
interface PinCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinType: PinType | null;
  projectCode: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  position: { x: number; y: number } | null;
}

export function PinCreateDialog({
  open,
  onOpenChange,
  pinType,
  projectCode,
  projectId,
  documentId,
  pageNumber,
  position,
}: PinCreateDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setSubmitting(false);
  };

  const close = (success = false) => {
    reset();
    onOpenChange(false);
    if (success) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "plan-pins"] });
    }
  };

  const handleSubmit = async () => {
    if (!pinType || !position || !title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      let refTable = "";
      let refId = "";

      if (pinType === "RFI") {
        const r = await apiRequest("POST", "/api/rfi", {
          projectId,
          subject: title.trim(),
          question: description.trim() || title.trim(),
          status: "DRAFT",
        });
        const created = await r.json();
        refTable = "rfis";
        refId = created.id;
      } else if (pinType === "PUNCH") {
        const r = await apiRequest("POST", `/api/projects/${projectCode}/punch-list`, {
          title: title.trim(),
          description: description.trim() || null,
        });
        const created = await r.json();
        refTable = "punch_list_items";
        refId = created.id;
      } else if (pinType === "SUBMITTAL") {
        const r = await apiRequest("POST", "/api/submittals", {
          projectId,
          subject: title.trim(),
          description: description.trim() || null,
          submittalType: "CONTRACTOR",
          phase: "CONSTRUCTION",
        });
        const created = await r.json();
        refTable = "submittals";
        refId = created.id;
      }

      await apiRequest("POST", `/api/projects/${projectCode}/plan-pins`, {
        planDocumentId: documentId,
        pageNumber,
        x: position.x,
        y: position.y,
        pinType,
        refTable,
        refId,
      });

      // Invalidate related lists so newly-created records show up everywhere
      queryClient.invalidateQueries({ queryKey: ["/api/rfi"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "punch-list"] });

      toast({ title: "Pin dropped", description: `${pinType} created and pinned to plan.` });
      close(true);
    } catch (err: any) {
      toast({ title: "Failed to create pin", description: err?.message || "Unknown error", variant: "destructive" });
      setSubmitting(false);
    }
  };

  const label = pinType === "RFI" ? "RFI" : pinType === "PUNCH" ? "Punch Item" : "Submittal";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent data-testid="dialog-pin-create">
        <DialogHeader>
          <DialogTitle>Create {label} at this location</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="pin-title">Title / Subject</Label>
            <Input
              id="pin-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Brief ${label.toLowerCase()} title`}
              data-testid="input-pin-title"
            />
          </div>
          <div>
            <Label htmlFor="pin-description">
              {pinType === "RFI" ? "Question" : "Description"}
            </Label>
            <Textarea
              id="pin-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional details"
              data-testid="input-pin-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close()} data-testid="button-pin-create-cancel">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !title.trim()} data-testid="button-pin-create-submit">
            {submitting ? "Creating…" : `Create & Pin`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
