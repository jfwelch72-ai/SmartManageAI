import { useState, useRef, useEffect, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Button } from "@/components/ui/button";
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
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export default function PdfPreview({ url, onOpenFile, pinMode, onPinDrop, onPageChange, overlay, pageBadges }: PdfPreviewProps) {
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
            const count = pageBadges?.[pn] || 0;
            const active = pn === pageNum;
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
                title={count > 0 ? `Page ${pn} • ${count} open pin${count === 1 ? "" : "s"}` : `Page ${pn}`}
                data-testid={`pdf-page-strip-page-${pn}`}
              >
                {pn}
                {count > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-blue-500 text-white text-[9px] leading-[16px] text-center font-semibold border border-background"
                    data-testid={`pdf-page-strip-badge-${pn}`}
                  >
                    {count > 99 ? "99+" : count}
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