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
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export default function PdfPreview({ url, onOpenFile }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <div
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center bg-muted/10 p-4"
        data-testid="pdf-preview-canvas-container"
      >
        {rendering && !canvasRef.current?.width && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="shadow-md"
          style={{ maxWidth: "100%" }}
          data-testid="pdf-preview-canvas"
        />
      </div>
    </div>
  );
}