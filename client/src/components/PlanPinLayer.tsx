import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertCircle, Wrench, FileCheck, X, Trash2, Move, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const PIN_STYLE: Record<PinType, { icon: typeof AlertCircle; color: string; bg: string; label: string; hex: string }> = {
  RFI: { icon: AlertCircle, color: "text-white", bg: "bg-red-500", label: "RFI", hex: "#ef4444" },
  PUNCH: { icon: Wrench, color: "text-white", bg: "bg-orange-500", label: "Punch", hex: "#f97316" },
  SUBMITTAL: { icon: FileCheck, color: "text-white", bg: "bg-blue-500", label: "Submittal", hex: "#3b82f6" },
};

const CLUSTER_RADIUS_PX = 36;

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
  clusteringEnabled?: boolean;
  /**
   * Task #1670 — Default behavior when a user clicks a pin cluster.
   * "zoom" (default) calls `onZoomToCluster` to step zoom in toward the
   * cluster centroid, breaking the cluster apart spatially. "list"
   * preserves the legacy popover-of-pins behavior. Holding Shift while
   * clicking inverts whichever default is active so users can always
   * reach the other behavior without changing the setting.
   */
  clusterClickAction?: "zoom" | "list";
  /**
   * Task #1670 — Provided by `<PdfPreview />` via its overlay render
   * prop. When present and the user clicks a cluster (without Shift)
   * with `clusterClickAction === "zoom"`, the preview zooms one step in
   * toward the cluster centroid and scrolls so the cluster stays under
   * the cursor. If omitted (or the preview cannot zoom further), the
   * cluster falls back to the popover list.
   */
  onZoomToCluster?: (xFrac: number, yFrac: number, anchorClientX?: number, anchorClientY?: number) => boolean;
}

interface PinCluster {
  id: string;
  pins: PlanPin[];
  cx: number;
  cy: number;
}

function clusterPins(pins: PlanPin[], canvasW: number, canvasH: number, radiusPx: number): PinCluster[] {
  if (canvasW <= 0 || canvasH <= 0) {
    return pins.map((p) => ({ id: p.id, pins: [p], cx: p.x, cy: p.y }));
  }
  const clusters: PinCluster[] = [];
  for (const pin of pins) {
    let best: PinCluster | null = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const dx = (pin.x - c.cx) * canvasW;
      const dy = (pin.y - c.cy) * canvasH;
      const d = Math.hypot(dx, dy);
      if (d < radiusPx && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    if (best) {
      best.pins.push(pin);
      const n = best.pins.length;
      best.cx = best.pins.reduce((s, p) => s + p.x, 0) / n;
      best.cy = best.pins.reduce((s, p) => s + p.y, 0) / n;
    } else {
      clusters.push({ id: pin.id, pins: [pin], cx: pin.x, cy: pin.y });
    }
  }
  for (const c of clusters) {
    if (c.pins.length > 1) {
      c.id = "cluster-" + c.pins.map((p) => p.id).sort().join("-");
    }
  }
  return clusters;
}

export function PlanPinLayer({
  projectCode,
  projectId,
  documentId,
  pageNumber,
  filter,
  onOpenSource,
  clusteringEnabled = true,
  clusterClickAction = "zoom",
  onZoomToCluster,
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clusters = useMemo(() => {
    if (!clusteringEnabled) {
      return visiblePins.map<PinCluster>((p) => ({ id: p.id, pins: [p], cx: p.x, cy: p.y }));
    }
    return clusterPins(visiblePins, containerSize.w, containerSize.h, CLUSTER_RADIUS_PX);
  }, [visiblePins, containerSize.w, containerSize.h, clusteringEnabled]);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none" data-testid="plan-pin-layer">
      {clusters.map((c) =>
        c.pins.length > 1 ? (
          <ClusterMarker
            key={c.id}
            cluster={c}
            metaMap={metaMap}
            onOpenSource={onOpenSource}
            clickAction={clusterClickAction}
            onZoomToCluster={onZoomToCluster}
          />
        ) : (
          <PinItem
            key={c.pins[0].id}
            pin={c.pins[0]}
            meta={metaMap.get(c.pins[0].refId)}
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
        ),
      )}
    </div>
  );
}

interface ClusterMarkerProps {
  cluster: PinCluster;
  metaMap: Map<string, PinMeta>;
  onOpenSource?: (pin: PlanPin) => void;
  /**
   * Task #1670 — When "zoom" (default), a plain click zooms the PDF in
   * one step toward the cluster centroid; Shift-click opens the popover
   * list. When "list", the click opens the popover and Shift-click
   * zooms instead. Either way the popover is always reachable.
   */
  clickAction?: "zoom" | "list";
  onZoomToCluster?: (xFrac: number, yFrac: number, anchorClientX?: number, anchorClientY?: number) => boolean;
}

function ClusterMarker({
  cluster,
  metaMap,
  onOpenSource,
  clickAction = "zoom",
  onZoomToCluster,
}: ClusterMarkerProps) {
  const total = cluster.pins.length;
  const counts: Record<PinType, number> = { RFI: 0, PUNCH: 0, SUBMITTAL: 0 };
  for (const p of cluster.pins) counts[p.pinType] += 1;
  const sorted = (Object.entries(counts) as [PinType, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const style: React.CSSProperties = {
    left: `${cluster.cx * 100}%`,
    top: `${cluster.cy * 100}%`,
  };
  if (sorted.length === 1 || sorted[0][1] / total > 0.5) {
    style.backgroundColor = PIN_STYLE[sorted[0][0]].hex;
  } else {
    const stops: string[] = [];
    let acc = 0;
    for (const [type, n] of sorted) {
      const start = (acc / total) * 360;
      acc += n;
      const end = (acc / total) * 360;
      stops.push(`${PIN_STYLE[type].hex} ${start}deg ${end}deg`);
    }
    style.background = `conic-gradient(${stops.join(", ")})`;
  }

  const size = total >= 100 ? 40 : total >= 10 ? 36 : 32;
  style.width = `${size}px`;
  style.height = `${size}px`;

  // Task #1670 — Controlled popover so a plain click can zoom (default)
  // while Shift-click opens the popover list. Without controlling state
  // the Radix trigger would always toggle the popover on click.
  const [popoverOpen, setPopoverOpen] = useState(false);

  const zoomEnabled = clickAction === "zoom" && !!onZoomToCluster;
  const titleHint = zoomEnabled
    ? `${total} pins in this area — click to zoom in, Shift-click for list`
    : onZoomToCluster
      ? `${total} pins in this area — click for list, Shift-click to zoom in`
      : `${total} pins in this area`;

  const handleClusterClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const wantsZoom = e.shiftKey ? clickAction === "list" : clickAction === "zoom";
    if (wantsZoom && onZoomToCluster) {
      const ok = onZoomToCluster(cluster.cx, cluster.cy, e.clientX, e.clientY);
      if (ok) {
        // Successfully zoomed — explicitly close any popover that may
        // have been left open (e.g. from a prior Shift-click) so the
        // user can stay focused on the now-spatially-broken-apart
        // cluster instead of tracking a stale list.
        setPopoverOpen(false);
        return;
      }
      // At max zoom (or zoom unavailable): fall through to popover so
      // the user still has a way to reach individual pins.
    }
    setPopoverOpen(true);
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={handleClusterClick}
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto",
            "flex items-center justify-center rounded-full shadow-md hover:scale-110 transition-transform",
            "border-2 border-white text-white font-semibold",
          )}
          style={style}
          title={titleHint}
          aria-label={titleHint}
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
          data-testid={`plan-pin-cluster-${cluster.id}`}
          data-cluster-action={zoomEnabled ? "zoom" : "list"}
        >
          <Layers className="absolute opacity-30 w-4 h-4" />
          <span
            className="relative text-xs leading-none drop-shadow"
            data-testid={`plan-pin-cluster-count-${cluster.id}`}
          >
            {total > 999 ? "999+" : total}
          </span>
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        className="w-72 p-2 text-sm"
        data-testid={`plan-pin-cluster-popover-${cluster.id}`}
      >
        <div className="px-1 pb-2 mb-1 border-b">
          <div className="font-medium text-xs text-muted-foreground">
            {total} pins in this area
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {sorted.map(([type, n]) => {
              const sd = PIN_STYLE[type];
              return (
                <Badge
                  key={type}
                  variant="outline"
                  className="text-[10px] h-4 px-1 gap-1"
                  data-testid={`plan-pin-cluster-type-${cluster.id}-${type}`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: sd.hex }}
                  />
                  {sd.label}: {n}
                </Badge>
              );
            })}
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto -mr-1 pr-1">
          {cluster.pins.map((pin) => {
            const sd = PIN_STYLE[pin.pinType];
            const Icon = sd.icon;
            const meta = metaMap.get(pin.refId);
            return (
              <button
                key={pin.id}
                type="button"
                className="w-full flex items-start gap-2 px-2 py-1.5 rounded hover:bg-accent text-left"
                onClick={() => onOpenSource?.(pin)}
                data-testid={`plan-pin-cluster-item-${pin.id}`}
              >
                <span
                  className={cn("inline-flex items-center justify-center w-5 h-5 rounded shrink-0", sd.bg)}
                >
                  <Icon className="w-3 h-3 text-white" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium truncate">
                    {meta?.title || `${sd.label} pin`}
                  </span>
                  <span className="flex items-center gap-1 mt-0.5">
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                      {sd.label}
                    </Badge>
                    {meta?.status && (
                      <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
                        {meta.status}
                      </Badge>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-muted-foreground mt-2 px-1">
          {zoomEnabled
            ? "Tip: click the cluster to zoom in one step (Shift-click opens this list)."
            : onZoomToCluster
              ? "Tip: Shift-click the cluster to zoom in one step instead."
              : "Tip: zoom in to break this cluster into individual pins."}
        </div>
      </PopoverContent>
    </Popover>
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
  clusteringEnabled?: boolean;
  onToggleClustering?: () => void;
}

export function PinFilterChips({
  filter,
  onChange,
  pinModeActive,
  onTogglePinMode,
  clusteringEnabled,
  onToggleClustering,
}: PinFilterChipsProps) {
  // Task #1663 — Every chip gets a hover tooltip explaining what the
  // filter does. None of these have keyboard shortcuts wired, so the
  // tooltip is name + description only.
  const chip = (
    label: string,
    tooltip: string,
    active: boolean,
    onClick: () => void,
    testId: string,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "px-2.5 py-1 text-xs rounded-full border transition-colors",
            active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border",
          )}
          aria-label={label}
          aria-pressed={active}
          data-testid={testId}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom"><span>{tooltip}</span></TooltipContent>
    </Tooltip>
  );
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={pinModeActive ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={onTogglePinMode}
            aria-pressed={pinModeActive}
            data-testid="button-toggle-pin-mode"
          >
            {pinModeActive ? "Exit Pin Mode" : "Pin Mode"}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>
            {pinModeActive
              ? "Exit Pin Mode — stop dropping pins"
              : "Enter Pin Mode — click the plan to drop a pin"}
          </span>
        </TooltipContent>
      </Tooltip>
      <span className="w-px h-5 bg-border mx-1" />
      {chip("All", "Show all pin types", filter.type === "ALL", () => onChange({ ...filter, type: "ALL" }), "chip-filter-all")}
      {chip("RFIs", "Show only RFI pins", filter.type === "RFI", () => onChange({ ...filter, type: "RFI" }), "chip-filter-rfi")}
      {chip("Punch", "Show only punch list pins", filter.type === "PUNCH", () => onChange({ ...filter, type: "PUNCH" }), "chip-filter-punch")}
      {chip("Submittals", "Show only submittal pins", filter.type === "SUBMITTAL", () => onChange({ ...filter, type: "SUBMITTAL" }), "chip-filter-submittal")}
      <span className="w-px h-5 bg-border mx-1" />
      {chip("Open only", "Hide pins linked to closed items", filter.openOnly, () => onChange({ ...filter, openOnly: !filter.openOnly }), "chip-filter-open")}
      {onToggleClustering && (
        <>
          <span className="w-px h-5 bg-border mx-1" />
          {chip(
            "Cluster pins",
            "Group nearby pins into clusters when zoomed out",
            !!clusteringEnabled,
            onToggleClustering,
            "chip-filter-cluster",
          )}
        </>
      )}
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
