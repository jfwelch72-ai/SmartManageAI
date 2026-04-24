import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import * as pdfjsLib from "pdfjs-dist";
import { renderMarkupToCanvas, type MarkupForRender } from "@/components/markups/markupCanvasRenderer";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

declare global {
  interface Window {
    __PLAN_PDF_READY?: boolean;
    __PLAN_PDF_ERROR?: string;
    __PLAN_PDF_PAGE_COUNT?: number;
  }
}

interface PlanDoc {
  id: string;
  title?: string | null;
  fileName?: string | null;
  projectId?: string | null;
}

interface PinRow {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  pinType: "RFI" | "PUNCH" | "SUBMITTAL";
}

interface MarkupRow {
  id: string;
  pageNumber: number;
  tool: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  text?: string | null;
}

const RENDER_SCALE = 1.5; // print resolution multiplier — keeps file sizes sane

export default function PlanDocumentPrintPage() {
  const params = useParams<{ id: string }>();
  const docId = params?.id || "";
  const search = useSearch();
  const qp = useMemo(() => new URLSearchParams(search), [search]);
  const includeMarkups = qp.get("markups") !== "0";
  const includePins = qp.get("pins") !== "0";
  // Task #1609 — page-count guard. The server passes its `MAX_PAGES`
  // cap as a query param; if the loaded PDF exceeds it we abort the
  // render *before* rasterizing pages so a 5,000-page set cannot pin
  // the renderer.
  const maxPages = (() => {
    const n = parseInt(qp.get("maxPages") || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
  })();

  const [doc, setDoc] = useState<PlanDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [markups, setMarkups] = useState<MarkupRow[]>([]);

  // Step 1 — fetch doc metadata so we know the project + file URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // We don't have a single "GET /api/plan-documents/:id" endpoint, so we
        // use the streaming + (separately) the markups endpoint which carries
        // organizationId. The print render only needs file bytes + overlays;
        // server has already authorized the request via session cookie.
        const meta = await fetch(`/api/plan-documents/${encodeURIComponent(docId)}/markups?page=__none__`, {
          credentials: "include",
        });
        if (!meta.ok && meta.status !== 200) {
          throw new Error(`Failed to fetch document metadata (${meta.status})`);
        }
        // Markups request is OK — fetch actual document via project doc
        // resolver. We rely on the markups endpoint for metadata (server
        // returns []) but for file bytes we hit the dedicated print stream
        // endpoint which is auth-checked the same way.
        const fileRes = await fetch(`/api/plan-documents/${encodeURIComponent(docId)}/print-stream`, {
          credentials: "include",
        });
        if (!fileRes.ok) throw new Error(`Failed to fetch document bytes (${fileRes.status})`);
        const blob = await fileRes.blob();
        if (cancelled) return;
        setPdfBlobUrl(URL.createObjectURL(blob));
        setDoc({ id: docId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (cancelled) return;
        setError(msg);
        window.__PLAN_PDF_ERROR = msg;
        window.__PLAN_PDF_READY = true;
      }
    })();
    return () => {
      cancelled = true;
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Step 2 — fetch overlays in parallel with PDF bytes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tasks: Promise<unknown>[] = [];
        if (includeMarkups) {
          tasks.push(
            fetch(`/api/plan-documents/${encodeURIComponent(docId)}/markups`, { credentials: "include" })
              .then((r) => (r.ok ? r.json() : []))
              .then((rows: MarkupRow[]) => {
                if (!cancelled) setMarkups(rows || []);
              }),
          );
        }
        if (includePins) {
          tasks.push(
            fetch(`/api/plan-pin-rollup-by-doc/${encodeURIComponent(docId)}`, { credentials: "include" })
              .then((r) => (r.ok ? r.json() : []))
              .then((rows: PinRow[]) => {
                if (!cancelled) setPins(rows || []);
              })
              .catch(() => {
                /* pins endpoint optional — silently degrade */
              }),
          );
        }
        await Promise.all(tasks);
      } catch (err) {
        // Overlay failures are non-fatal — proceed with bare PDF rendering.
        // eslint-disable-next-line no-console
        console.warn("[print] overlay fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, includeMarkups, includePins]);

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>Plan PDF export error</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!doc || !pdfBlobUrl) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  }

  return (
    <PrintRenderer
      pdfUrl={pdfBlobUrl}
      pins={includePins ? pins : []}
      markups={includeMarkups ? markups : []}
      maxPages={maxPages}
      onError={setError}
    />
  );
}

function PrintRenderer({
  pdfUrl,
  pins,
  markups,
  maxPages,
  onError,
}: {
  pdfUrl: string;
  pins: PinRow[];
  markups: MarkupRow[];
  // Task #1609 — `maxPages` and `onError` were previously referenced
  // here but only ever existed in the parent component's scope, so
  // every render of PrintRenderer threw a ReferenceError and the
  // headless print page never reached __PLAN_PDF_READY = true. They
  // are now passed in explicitly.
  maxPages: number;
  onError: (msg: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Group overlays by page once.
  const pinsByPage = useMemo(() => {
    const m = new Map<number, PinRow[]>();
    for (const p of pins) {
      if (!m.has(p.pageNumber)) m.set(p.pageNumber, []);
      m.get(p.pageNumber)!.push(p);
    }
    return m;
  }, [pins]);

  const markupsByPage = useMemo(() => {
    const m = new Map<number, MarkupRow[]>();
    for (const x of markups) {
      if (!m.has(x.pageNumber)) m.set(x.pageNumber, []);
      m.get(x.pageNumber)!.push(x);
    }
    return m;
  }, [markups]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        window.__PLAN_PDF_PAGE_COUNT = pdf.numPages;
        // Task #1609 — bail out *before* rasterizing pages if the PDF
        // exceeds the server-supplied cap. Without this early exit the
        // 500-page guard in the server only kicks in after every page
        // has already rendered (defeating the purpose of the limit).
        if (pdf.numPages > maxPages) {
          pdf.destroy();
          const msg = `Plan document has ${pdf.numPages} pages; export is capped at ${maxPages}.`;
          window.__PLAN_PDF_ERROR = msg;
          window.__PLAN_PDF_READY = true;
          setStatus("error");
          onError(msg);
          return;
        }
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = doc_create_canvas(viewport.width, viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;

          // Burn markups for this page.
          const pageMarkups = markupsByPage.get(pageNum) || [];
          for (const m of pageMarkups) {
            renderMarkupToCanvas(ctx, {
              tool: m.tool,
              points: Array.isArray(m.points) ? m.points : [],
              color: m.color || "#ff0000",
              thickness: m.thickness || 2,
              text: m.text || undefined,
            } as MarkupForRender, viewport.width, viewport.height);
          }

          // Burn pins.
          const pagePins = pinsByPage.get(pageNum) || [];
          for (const p of pagePins) {
            drawPin(ctx, p, viewport.width, viewport.height);
          }

          const pageWrap = document.createElement("div");
          pageWrap.className = "plan-pdf-page";
          pageWrap.style.cssText = `display:block;break-after:page;page-break-after:always;`;
          pageWrap.appendChild(canvas);
          container.appendChild(pageWrap);
        }

        if (cancelled) return;
        setStatus("ready");
        // Two RAFs so the browser has finished the layout pass before we
        // signal readiness.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.__PLAN_PDF_READY = true;
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[print] render failed", err);
        if (cancelled) return;
        setStatus("error");
        window.__PLAN_PDF_ERROR = msg;
        window.__PLAN_PDF_READY = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, markupsByPage, pinsByPage]);

  return (
    <div style={{ background: "#fff" }}>
      <style>{`
        @page { size: auto; margin: 0; }
        body { margin: 0; }
        .plan-pdf-page canvas { display: block; width: 100%; height: auto; }
      `}</style>
      <div ref={containerRef} data-testid="plan-pdf-print-root" />
      {status === "loading" && (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Rendering pages…</div>
      )}
    </div>
  );
}

function doc_create_canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  pin: PinRow,
  w: number,
  h: number,
): void {
  const cx = pin.x * w;
  const cy = pin.y * h;
  const radius = 14;
  const fill =
    pin.pinType === "RFI" ? "#2563eb" : pin.pinType === "PUNCH" ? "#dc2626" : "#7c3aed";
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pin.pinType[0], cx, cy + 0.5);
  ctx.restore();
}
