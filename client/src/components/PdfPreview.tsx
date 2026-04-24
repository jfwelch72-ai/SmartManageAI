import { useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as pdfjsLib from "pdfjs-dist";
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
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfPreviewProps {
  url: string;
  onOpenFile?: () => void;
  pinMode?: boolean;
  onPinDrop?: (info: { x: number; y: number; pageNumber: number }) => void;
  onPageChange?: (pageNumber: number) => void;
  overlay?: (info: { pageNumber: number; canvasWidth: number; canvasHeight: number }) => React.ReactNode;
  pageBadges?: Record<number, number>;
  pageBadgesClosed?: Record<number, number>;
  pageBadgeMode?: "open" | "all";
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export default function PdfPreview({ url, onOpenFile, pinMode, onPinDrop, onPageChange, overlay, pageBadges, pageBadgesClosed, pageBadgeMode = "open" }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onPageChange?.(pageNum);
  }, [pageNum, onPageChange]);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc((prev) => {
      if (prev) prev.destroy();
      return null;
    });
    setPageNum(1);
    setZoomIdx(2);

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const isSameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);

    const loadPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(
          isSameOrigin ? { url, withCredentials: true } : { url }
        );
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error("PDF load error:", err);
        setError(err instanceof Error ? err.message : "Failed to load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadPdf();

    return () => {
      cancelled = true;
      if (loadingTaskRef.current) {
        loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
    };
  }, [url]);

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    setRendering(true);
    try {
      const page = await pdfDoc.getPage(pageNum);
      const scale = ZOOM_LEVELS[zoomIdx];
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCanvasSize({ w: viewport.width, h: viewport.height });
      const ctx = canvas.getContext("2d")!;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err: unknown) {
      const isCancel = err instanceof Error && err.name === "RenderingCancelledException";
      if (!isCancel) {
        console.error("PDF render error:", err);
        setError(err instanceof Error ? err.message : "Failed to render PDF page");
      }
    } finally {
      setRendering(false);
    }
  }, [pdfDoc, pageNum, zoomIdx]);

  useEffect(() => {
    renderPage();
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [renderPage]);

  const goPrev = () => setPageNum((p) => Math.max(1, p - 1));
  const goNext = () => setPageNum((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1));
  const zoomOut = () => setZoomIdx((i) => Math.max(0, i - 1));
  const resetZoom = () => setZoomIdx(2);

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
        <div className="text-center space-y-4 p-8 max-w-sm">
          <File className="w-16 h-16 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Unable to render PDF preview.</p>
          {onOpenFile && (
            <Button variant="outline" onClick={onOpenFile} data-testid="button-open-pdf-fallback">
              <ExternalLink className="w-4 h-4 mr-2" />Open File
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="pdf-preview">
      {pdfDoc && numPages > 1 && (
        <PageThumbStrip
          pdfDoc={pdfDoc}
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
        <div
          className="flex items-center gap-1 px-3 py-1 border-b bg-muted/10 shrink-0 overflow-x-auto"
          data-testid="pdf-page-strip"
        >
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
      )}
      <div
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center bg-muted/10 p-4"
        data-testid="pdf-preview-canvas-container"
      >
        {rendering && !canvasRef.current?.width && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="relative inline-block">
          <canvas
            ref={canvasRef}
            className="shadow-md block"
            style={{ maxWidth: "100%", cursor: pinMode ? "crosshair" : "default" }}
            onClick={(e) => {
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
              {overlay({ pageNumber: pageNum, canvasWidth: canvasSize.w, canvasHeight: canvasSize.h })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PageThumbStripProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  onSelect: (n: number) => void;
}

function PageThumbStrip({ pdfDoc, numPages, currentPage, onSelect }: PageThumbStripProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Task #1609 — virtualize the strip so 600+ pages stays buttery smooth.
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
      ref={parentRef}
      className="flex items-center px-2 py-1.5 border-b bg-muted/20 shrink-0 overflow-x-auto"
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
                pdfDoc={pdfDoc}
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
  );
}

interface PageThumbProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onSelect: (n: number) => void;
  buttonRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

function PageThumb({ pdfDoc, pageNumber, active, onSelect, buttonRef }: PageThumbProps) {
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
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const v = page.getViewport({ scale: 1 });
        const targetW = 72;
        const scale = targetW / v.width;
        const sv = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = sv.width;
        canvas.height = sv.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: sv, canvas }).promise;
        if (cancelled) return;
        setThumb(canvas.toDataURL("image/jpeg", 0.7));
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        // Ignore render failures; tile remains as numbered placeholder
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, thumb, pdfDoc, pageNumber]);

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