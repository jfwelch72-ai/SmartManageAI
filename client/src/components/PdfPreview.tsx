import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  File,
  ExternalLink,
  RotateCw,
  RotateCcw,
} from "lucide-react";
import {
  getSharedScheduler,
  WorkerPdfError,
  type CancellablePageRender,
} from "@/lib/takeoff/tileScheduler";

// Task #2188 — PdfPreview previously instantiated `pdfjs-dist` on the
// main thread. After this task every render goes through the shared
// `pdfTileWorker` pool the takeoff workspace already uses (Task
// #2138), so a 300+ sheet planset opened in Plan Markup or any of the
// lightweight viewers never blocks the main thread for >100 ms.

interface PdfPreviewProps {
  url: string;
  onOpenFile?: () => void;
  pinMode?: boolean;
  onPinDrop?: (info: { x: number; y: number; pageNumber: number }) => void;
  onPageChange?: (pageNumber: number) => void;
  overlay?: (info: {
    pageNumber: number;
    canvasWidth: number;
    canvasHeight: number;
    /**
     * Task #1670 — Lets overlay children (e.g. cluster markers) request a
     * one-step zoom-in toward a specific fractional point on the current
     * page. The viewport is scrolled so the (xFrac, yFrac) point stays
     * under the same screen position (defaults to its current location).
     * Returns true when a zoom step was scheduled, false when already at
     * max zoom (so the caller can fall back to other behavior).
     */
    zoomInAtPoint: (xFrac: number, yFrac: number, anchorClientX?: number, anchorClientY?: number) => boolean;
    canZoomIn: boolean;
  }) => React.ReactNode;
  pageBadges?: Record<number, number>;
  pageBadgesClosed?: Record<number, number>;
  pageBadgeMode?: "open" | "all";
  /**
   * Task #1659 — When true, the user is holding spacebar to temporarily
   * pan from any tool. Pin drop and other click handlers are suppressed,
   * the cursor switches to grab/grabbing, and pointer-drag scrolls the
   * canvas container (Figma / Bluebeam / Photoshop muscle memory).
   */
  spacePanActive?: boolean;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

// Friendly error text for HTTP-style status codes. Hoisted out of
// render so it's only constructed once.
function friendlyForStatus(status: number): string {
  if (status === 401) return "You must be signed in to view this PDF.";
  if (status === 403) return "You don't have permission to view this PDF.";
  if (status === 404)
    return "This PDF was not found on the server. It may have been moved or deleted.";
  if (status >= 500) return "The server failed to deliver this PDF.";
  return `Could not load PDF (HTTP ${status}).`;
}

// Task #2188 — Map a worker error onto the same friendly text the
// main-thread implementation used to show. We inspect the
// `WorkerPdfError` metadata (forwarded from the worker) so users still
// see "missing on the server" instead of a raw pdfjs message.
function friendlyForWorkerError(err: unknown): string {
  if (err instanceof WorkerPdfError) {
    if (typeof err.status === "number" && err.status > 0) {
      return friendlyForStatus(err.status);
    }
    if (err.errorName === "MissingPDFException") {
      return "This PDF is missing on the server.";
    }
    if (err.errorName === "InvalidPDFException") {
      return "This file is not a valid PDF.";
    }
    if (err.errorName === "UnexpectedResponseException") {
      return "Could not reach the server to load this PDF. Check your connection and try again.";
    }
  }
  return err instanceof Error ? err.message : "Failed to load PDF";
}

export default function PdfPreview({ url, onOpenFile, pinMode, onPinDrop, onPageChange, overlay, pageBadges, pageBadgesClosed, pageBadgeMode = "open", spacePanActive }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Task #2188 — `pdfReady` replaces the old `pdfDoc` reference. The
  // pdfjs document lives in the worker now; the main thread only
  // needs to know "we have loaded the document at this URL" so it can
  // start dispatching page renders.
  const [pdfReady, setPdfReady] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // Task #2780 — Per-document rotation state (0 / 90 / 180 / 270 degrees).
  // Persists across sheet switches within the same component instance via a
  // Map keyed by URL so returning to a previously rotated sheet restores the
  // user's orientation. Resets to 0 only for URLs seen for the first time.
  const rotationCacheRef = useRef<Map<string, number>>(new Map());
  const [rotation, setRotation] = useState(0);


  useEffect(() => {
    onPageChange?.(pageNum);
  }, [pageNum, onPageChange]);

  // Task #2780 — Write rotation back to the cache whenever the user rotates,
  // so switching away and back restores the same orientation.
  useEffect(() => {
    rotationCacheRef.current.set(url, rotation);
  }, [url, rotation]);

  // Task #2188 — Track the in-flight page render so we can cancel the
  // worker-side pdfjs `RenderTask` when the user changes page or zoom
  // mid-render. Without this the worker would keep rasterising a page
  // we no longer plan to display.
  const pageRenderRef = useRef<CancellablePageRender | null>(null);

  // Task #1670 — Pending zoom-at-point request. When set, the layout
  // effect below applies a scroll delta after the next canvas render so
  // the anchored point stays under the user's cursor.
  const pendingZoomTargetRef = useRef<{
    xFrac: number;
    yFrac: number;
    anchorClientX: number;
    anchorClientY: number;
  } | null>(null);

  // Task #1659 — spacebar-hold-to-pan drag state. Refs (not state) so the
  // pointer handlers don't re-render the canvas mid-drag.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const panDraggingRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  const onScrollPanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!spacePanActive) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    panDraggingRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw if pointer already released */
    }
    e.preventDefault();
  }, [spacePanActive]);

  const onScrollPanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDraggingRef.current || !panStartRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    el.scrollLeft = panStartRef.current.scrollLeft - dx;
    el.scrollTop = panStartRef.current.scrollTop - dy;
  }, []);

  const onScrollPanPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDraggingRef.current) return;
    panDraggingRef.current = false;
    panStartRef.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfReady(false);
    setNumPages(0);
    setPageNum(1);
    setZoomIdx(2);
    // Restore cached rotation for this URL (0 for first visit).
    setRotation(rotationCacheRef.current.get(url) ?? 0);

    if (pageRenderRef.current) {
      pageRenderRef.current.cancel();
      pageRenderRef.current = null;
    }

    const scheduler = getSharedScheduler();
    if (!scheduler) {
      // Task #2188 — The worker pool requires `Worker` +
      // `OffscreenCanvas` (Safari 16-, jsdom, very old browsers don't
      // expose them). Per the takeoff workspace's parity stance, we
      // surface a friendly error rather than silently regressing back
      // to a main-thread pdfjs path.
      setError("PDF preview requires a modern browser with worker support.");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const info = await scheduler.getDocumentInfo(url);
        if (cancelled) return;
        setNumPages(info.numPages);
        setPdfReady(true);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("PDF load error:", err);
        setError(friendlyForWorkerError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, retryNonce]);

  const renderPage = useCallback(async () => {
    if (!pdfReady || !canvasRef.current) return;
    const scheduler = getSharedScheduler();
    if (!scheduler) return;
    if (pageRenderRef.current) {
      pageRenderRef.current.cancel();
      pageRenderRef.current = null;
    }

    setRendering(true);
    const scale = ZOOM_LEVELS[zoomIdx];
    const handle = scheduler.renderPage(url, pageNum - 1, scale);
    pageRenderRef.current = handle;
    try {
      const result = await handle.promise;
      if (pageRenderRef.current !== handle) {
        // A newer render has already started — discard this bitmap so
        // the canvas isn't briefly painted with a stale page.
        try { result.bitmap.close(); } catch { /* noop */ }
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        try { result.bitmap.close(); } catch { /* noop */ }
        return;
      }
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        try { result.bitmap.close(); } catch { /* noop */ }
        return;
      }
      ctx.drawImage(result.bitmap, 0, 0);
      try { result.bitmap.close(); } catch { /* noop */ }
      setCanvasSize({ w: result.width, h: result.height });
    } catch (err: unknown) {
      const isCancel =
        err instanceof Error && (err.message === "cancelled" || err.name === "RenderingCancelledException");
      if (!isCancel) {
        // eslint-disable-next-line no-console
        console.error("PDF render error:", err);
        setError(friendlyForWorkerError(err));
      }
    } finally {
      if (pageRenderRef.current === handle) {
        pageRenderRef.current = null;
      }
      setRendering(false);
    }
  }, [pdfReady, url, pageNum, zoomIdx]);

  useEffect(() => {
    renderPage();
    return () => {
      if (pageRenderRef.current) {
        pageRenderRef.current.cancel();
        pageRenderRef.current = null;
      }
    };
  }, [renderPage]);

  const goPrev = () => setPageNum((p) => Math.max(1, p - 1));
  const goNext = () => setPageNum((p) => Math.min(numPages, p + 1));
  const rotateCw = () => setRotation((r) => (r + 90) % 360);
  const rotateCcw = () => setRotation((r) => (r + 270) % 360);
  const zoomIn = () => setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1));
  const zoomOut = () => setZoomIdx((i) => Math.max(0, i - 1));
  const resetZoom = () => setZoomIdx(2);

  // Task #1670 — Zoom one step in toward a fractional point on the page,
  // keeping that point under the same screen position. The actual scroll
  // adjustment happens in a useLayoutEffect after the canvas re-renders
  // at the new zoom level (see below).
  const canZoomIn = zoomIdx < ZOOM_LEVELS.length - 1;
  const zoomInAtPoint = useCallback(
    (xFrac: number, yFrac: number, anchorClientX?: number, anchorClientY?: number): boolean => {
      if (zoomIdx >= ZOOM_LEVELS.length - 1) return false;
      const canvas = canvasRef.current;
      let aX = anchorClientX;
      let aY = anchorClientY;
      if ((aX === undefined || aY === undefined) && canvas) {
        const r = canvas.getBoundingClientRect();
        if (aX === undefined) aX = r.left + xFrac * r.width;
        if (aY === undefined) aY = r.top + yFrac * r.height;
      }
      pendingZoomTargetRef.current = {
        xFrac: Math.max(0, Math.min(1, xFrac)),
        yFrac: Math.max(0, Math.min(1, yFrac)),
        anchorClientX: aX ?? 0,
        anchorClientY: aY ?? 0,
      };
      setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1));
      return true;
    },
    [zoomIdx],
  );

  // After the canvas re-renders at a new zoom level, apply any pending
  // scroll adjustment so the anchored point stays under the cursor.
  useLayoutEffect(() => {
    const t = pendingZoomTargetRef.current;
    if (!t) return;
    const canvas = canvasRef.current;
    const sc = scrollContainerRef.current;
    if (!canvas || !sc) return;
    const cr = canvas.getBoundingClientRect();
    const newClientX = cr.left + t.xFrac * cr.width;
    const newClientY = cr.top + t.yFrac * cr.height;
    const dx = newClientX - t.anchorClientX;
    const dy = newClientY - t.anchorClientY;
    if (dx !== 0 || dy !== 0) {
      sc.scrollLeft += dx;
      sc.scrollTop += dy;
    }
    pendingZoomTargetRef.current = null;
  }, [canvasSize.w, canvasSize.h]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="pdf-preview-loading">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading PDF…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="pdf-preview-error">
        <div className="text-center space-y-4 p-8 max-w-md">
          <File className="w-16 h-16 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Unable to render PDF preview</p>
            <p
              className="text-xs text-muted-foreground break-words"
              data-testid="text-pdf-preview-error-detail"
            >
              {error}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryNonce((n) => n + 1)}
              data-testid="button-pdf-retry"
            >
              <RotateCw className="w-4 h-4 mr-2" />Retry
            </Button>
            {onOpenFile && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenFile}
                data-testid="button-open-pdf-fallback"
              >
                <ExternalLink className="w-4 h-4 mr-2" />Open File
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0 w-full overflow-hidden" data-testid="pdf-preview">
      {pdfReady && numPages > 1 && (
        <PageThumbStrip
          url={url}
          numPages={numPages}
          currentPage={pageNum}
          onSelect={(n) => setPageNum(n)}
        />
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goPrev}
            disabled={pageNum <= 1}
            data-testid="button-pdf-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[60px] text-center" data-testid="text-pdf-page">
            {pageNum} / {numPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goNext}
            disabled={pageNum >= numPages}
            data-testid="button-pdf-next"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={rotateCcw}
            title="Rotate counter-clockwise"
            data-testid="button-pdf-rotate-ccw"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={rotateCw}
            title="Rotate clockwise"
            data-testid="button-pdf-rotate-cw"
          >
            <RotateCw className="w-4 h-4" />
          </Button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={zoomOut}
            disabled={zoomIdx <= 0}
            data-testid="button-pdf-zoom-out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <button
            className="text-xs text-muted-foreground min-w-[40px] text-center hover:underline cursor-pointer bg-transparent border-none"
            onClick={resetZoom}
            data-testid="button-pdf-zoom-reset"
          >
            {Math.round(ZOOM_LEVELS[zoomIdx] * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={zoomIn}
            disabled={zoomIdx >= ZOOM_LEVELS.length - 1}
            data-testid="button-pdf-zoom-in"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {numPages > 1 && (
        // overflow-hidden on the outer wrapper is the key fix: it prevents
        // the inner w-max flex row (e.g. 32 buttons wide) from inflating the
        // wrapper's clientWidth. The inner scroll div is a plain block child
        // so its width = wrapper's content width (bounded by the panel).
        <div
          className="shrink-0 border-b bg-muted/10 overflow-hidden"
          data-testid="pdf-page-num-strip-wrapper"
        >
          <div
            className="overflow-x-auto px-3 py-1"
            data-testid="pdf-page-strip"
          >
          {/* inner flex row — items are shrink-0 so they overflow the bounded
              outer block container, which then scrolls horizontally */}
          <div className="flex items-center gap-1 w-max">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pn) => {
            const openCount = pageBadges?.[pn] || 0;
            const closedCount = pageBadgesClosed?.[pn] || 0;
            const displayCount = pageBadgeMode === "all" ? openCount + closedCount : openCount;
            const active = pn === pageNum;
            const titleParts = [`Page ${pn}`];
            if (openCount > 0 || closedCount > 0) {
              titleParts.push(`${openCount} open`);
              if (closedCount > 0) titleParts.push(`${closedCount} closed`);
            }
            return (
              <button
                key={pn}
                onClick={() => setPageNum(pn)}
                className={
                  "relative shrink-0 inline-flex items-center justify-center text-[11px] h-6 min-w-[28px] px-1.5 rounded border transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-accent border-border text-muted-foreground")
                }
                title={titleParts.join(" • ")}
                data-testid={`pdf-page-strip-page-${pn}`}
              >
                {pn}
                {displayCount > 0 && (
                  <span
                    className={
                      "absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-white text-[9px] leading-[16px] text-center font-semibold border border-background " +
                      (pageBadgeMode === "all" && openCount === 0
                        ? "bg-slate-400 dark:bg-slate-500"
                        : "bg-blue-500")
                    }
                    data-testid={`pdf-page-strip-badge-${pn}`}
                  >
                    {displayCount > 99 ? "99+" : displayCount}
                  </span>
                )}
              </button>
            );
          })}
          </div>
          </div>
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center bg-muted/10 p-4"
        data-testid="pdf-preview-canvas-container"
        style={{ cursor: spacePanActive ? (panDraggingRef.current ? "grabbing" : "grab") : undefined }}
        onPointerDown={onScrollPanPointerDown}
        onPointerMove={onScrollPanPointerMove}
        onPointerUp={onScrollPanPointerUp}
        onPointerCancel={onScrollPanPointerUp}
      >
        {rendering && !canvasRef.current?.width && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <div
          className="relative inline-block"
          style={{
            transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
            transition: "transform 0.2s ease",
            margin: rotation === 90 || rotation === 270 ? "auto" : undefined,
          }}
        >
          <canvas
            ref={canvasRef}
            className="shadow-md block"
            style={{
              maxWidth: "100%",
              cursor: spacePanActive ? "grab" : pinMode ? "crosshair" : "default",
            }}
            onClick={(e) => {
              if (spacePanActive) return; // suppress pin drop while panning
              if (!pinMode || !onPinDrop || !canvasRef.current) return;
              const rect = canvasRef.current.getBoundingClientRect();
              const x = (e.clientX - rect.left) / rect.width;
              const y = (e.clientY - rect.top) / rect.height;
              if (x < 0 || x > 1 || y < 0 || y > 1) return;
              onPinDrop({ x, y, pageNumber: pageNum });
            }}
            data-testid="pdf-preview-canvas"
          />
          {overlay && canvasSize.w > 0 && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ width: "100%", height: "100%" }}
              data-testid="pdf-preview-overlay"
            >
              {overlay({
                pageNumber: pageNum,
                canvasWidth: canvasSize.w,
                canvasHeight: canvasSize.h,
                zoomInAtPoint,
                canZoomIn,
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PageThumbStripProps {
  // Task #2188 — pdfjs lives in the worker now, so the strip just
  // needs the document URL; per-page renders dispatch through the
  // shared scheduler the same way the takeoff thumbnail strip does.
  url: string;
  numPages: number;
  currentPage: number;
  onSelect: (n: number) => void;
}

function PageThumbStrip({ url, numPages, currentPage, onSelect }: PageThumbStripProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Task #1609 — virtualize the strip so 600+ pages stays buttery smooth.
  //
  // overflow-hidden on the outer wrapper is the key containment fix.
  // A block element with overflow:hidden cannot be inflated by its children —
  // its width comes solely from the CSS layout (flex align-items:stretch from
  // the parent panel). parentRef is a plain block child of that wrapper so
  // parentRef.clientWidth always equals the bounded panel width. TanStack
  // Virtual reads that via its own internal ResizeObserver and only renders
  // the visible thumbnails, so the 2 496px virtualizer canvas never escapes
  // the right panel and causes page-level horizontal overflow.
  const ITEM_W = 72 + 6; // tile width + gap
  const virtualizer = useVirtualizer({
    count: numPages,
    horizontal: true,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_W,
    overscan: 8,
  });

  useEffect(() => {
    if (!parentRef.current) return;
    virtualizer.scrollToIndex(Math.max(0, currentPage - 1), { align: "center" });
  }, [currentPage, virtualizer]);

  return (
    <div
      className="shrink-0 border-b bg-muted/20 overflow-hidden"
      data-testid="pdf-thumb-strip-wrapper"
    >
      <div
        ref={parentRef}
        className="overflow-x-auto px-2 py-1.5"
        data-testid="pdf-page-strip"
      >
        <div
          style={{
            width: virtualizer.getTotalSize(),
            height: 96,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const n = vi.index + 1;
            return (
              <div
                key={vi.key}
                style={{
                  position: "absolute",
                  left: vi.start,
                  top: 0,
                  width: vi.size,
                  paddingRight: 6,
                }}
              >
                <PageThumb
                  url={url}
                  pageNumber={n}
                  active={n === currentPage}
                  onSelect={onSelect}
                  buttonRef={n === currentPage ? activeRef : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface PageThumbProps {
  url: string;
  pageNumber: number;
  active: boolean;
  onSelect: (n: number) => void;
  buttonRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

function PageThumb({ url, pageNumber, active, onSelect, buttonRef }: PageThumbProps) {
  const localRef = useRef<HTMLButtonElement | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || thumb) return;
    let cancelled = false;
    (async () => {
      const scheduler = getSharedScheduler();
      if (!scheduler) return;
      try {
        // Task #2188 — Off-thread thumbnail render. The worker returns
        // an `ImageBitmap` that we copy into a one-shot canvas to
        // produce the JPEG data URL the existing `<img>` tag expects.
        const res = await scheduler.renderThumbnail(url, pageNumber - 1, 72, 72);
        if (cancelled) {
          try { res.bitmap.close(); } catch { /* noop */ }
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = res.bitmap.width;
        canvas.height = res.bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          try { res.bitmap.close(); } catch { /* noop */ }
          canvas.width = 0;
          canvas.height = 0;
          return;
        }
        ctx.drawImage(res.bitmap, 0, 0);
        try { res.bitmap.close(); } catch { /* noop */ }
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        canvas.width = 0;
        canvas.height = 0;
        if (!cancelled) setThumb(dataUrl);
      } catch {
        // Ignore render failures; tile remains as numbered placeholder
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, thumb, url, pageNumber]);

  return (
    <button
      ref={(el) => {
        localRef.current = el;
        if (buttonRef) buttonRef.current = el;
      }}
      type="button"
      onClick={() => onSelect(pageNumber)}
      className={cn(
        "relative shrink-0 flex flex-col items-center w-[72px] rounded border transition-all bg-background",
        active ? "border-primary shadow-sm" : "border-border hover:border-primary/50",
        "data-[pin-drop-active=true]:ring-2 data-[pin-drop-active=true]:ring-primary data-[pin-drop-active=true]:bg-primary/10 data-[pin-drop-active=true]:border-primary"
      )}
      data-pin-drop-target=""
      data-pin-drop-page={pageNumber}
      data-testid={`pdf-page-thumb-${pageNumber}`}
      title={`Page ${pageNumber}`}
    >
      <div className="w-full h-[72px] bg-muted flex items-center justify-center overflow-hidden rounded-t">
        {thumb ? (
          <img
            src={thumb}
            alt={`Page ${pageNumber}`}
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        ) : (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/60" />
        )}
      </div>
      <span
        className={cn(
          "text-[10px] leading-none py-0.5",
          active ? "font-semibold text-primary" : "text-muted-foreground"
        )}
      >
        {pageNumber}
      </span>
    </button>
  );
}
