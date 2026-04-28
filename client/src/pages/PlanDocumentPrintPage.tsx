import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import { renderMarkupToCanvas, type MarkupForRender } from "@/components/markups/markupCanvasRenderer";
import {
  getSharedScheduler,
  type CancellablePageRender,
} from "@/lib/takeoff/tileScheduler";

// Task #2188 — The print page used to instantiate `pdfjs-dist` on
// the main thread, which froze the headless capture for several
// seconds on a 300+ sheet planset. After this task every render is
// dispatched through the shared `pdfTileWorker` pool the takeoff
// workspace already uses (Task #2138), keeping the main thread free
// for layout, RAFs, and the overlay/legend DOM nodes that the
// headless capture inspects.

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
  // Task #1677 — layer membership flows in from the markups list endpoint.
  // null means the markup is on the auto-created default layer for the
  // sheet (legacy / pre-#1662 rows).
  layerId?: string | null;
}

interface LayerRow {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  // Task #1677 — the layers endpoint already returns the requesting
  // user's per-layer visibility flag (defaulting to `true` when there's
  // no override row). When the export URL omits `layerIds`, the print
  // page mirrors the in-app viewer and honours these visibility toggles
  // so a recipient who hid "QA/QC" doesn't get it back in their PDF.
  isVisible?: boolean;
}

const DEFAULT_LAYER_SENTINEL = "__default__";

const RENDER_SCALE = 1.5; // print resolution multiplier — keeps file sizes sane

// Task #2212 — default number of `renderPage` calls kept in flight
// against the shared worker pool. The pool itself caps at 4 workers
// (see `tileScheduler.defaultPoolSize`), so values >4 are wasted; the
// default of 3 leaves one worker free for overlay/legend draws and
// avoids OOMing Chromium on very tall pages where each page bitmap is
// already ~50–100 MB. Override per-call via the `concurrency` URL
// param (the server-side renderer forwards `PRINT_PAGE_CONCURRENCY`).
const DEFAULT_PRINT_PAGE_CONCURRENCY = 3;
const MAX_PRINT_PAGE_CONCURRENCY = 8;

export default function PlanDocumentPrintPage() {
  const params = useParams<{ id: string }>();
  const docId = params?.id || "";
  const search = useSearch();
  const qp = useMemo(() => new URLSearchParams(search), [search]);
  const includeMarkups = qp.get("markups") !== "0";
  const includePins = qp.get("pins") !== "0";
  // Task #1677 — read the optional `layerIds` filter forwarded by the
  // server. Empty/missing means "include every layer". The "__default__"
  // sentinel matches markups whose layer_id is NULL (legacy rows).
  const layerIdFilter = useMemo(() => {
    const raw = qp.get("layerIds");
    if (!raw) return null;
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  }, [qp]);
  // Task #1609 — page-count guard. The server passes its `MAX_PAGES`
  // cap as a query param; if the loaded PDF exceeds it we abort the
  // render *before* rasterizing pages so a 5,000-page set cannot pin
  // the renderer.
  const maxPages = (() => {
    const n = parseInt(qp.get("maxPages") || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
  })();
  // Task #2212 — bounded concurrency knob. Read from the URL so the
  // server-side renderer can forward `PRINT_PAGE_CONCURRENCY` without
  // a code change. Clamped to [1, MAX] so a runaway value can't OOM
  // Chromium by keeping dozens of huge ImageBitmap pages alive at
  // once.
  const printConcurrency = (() => {
    const raw = parseInt(qp.get("concurrency") || "0", 10);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PRINT_PAGE_CONCURRENCY;
    return Math.max(1, Math.min(MAX_PRINT_PAGE_CONCURRENCY, raw));
  })();

  const [doc, setDoc] = useState<PlanDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [markups, setMarkups] = useState<MarkupRow[]>([]);
  // Task #1677 — layers metadata so we can (a) tint each markup with
  // its layer color/name on the printed page and (b) render a footer
  // legend listing which layers are included in the export.
  const [layers, setLayers] = useState<LayerRow[]>([]);
  // Explicit per-overlay "fetched" flags. The headless capture must
  // not race ahead of any of the three overlay sources: a fast layers
  // fetch combined with a slow markups fetch could otherwise let the
  // render gate open before markups arrived, and we'd burn an empty
  // PDF marked __PLAN_PDF_READY=true. Each fetch flips its flag in a
  // `.finally()` so failures don't deadlock the render either.
  const [layersLoaded, setLayersLoaded] = useState(false);
  const [markupsLoaded, setMarkupsLoaded] = useState(false);
  const [pinsLoaded, setPinsLoaded] = useState(false);

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
              })
              .catch(() => {
                if (!cancelled) setMarkups([]);
              })
              .finally(() => {
                if (!cancelled) setMarkupsLoaded(true);
              }),
          );
          // Task #1677 — pull layer metadata so we can render per-markup
          // chips and a footer legend. Failure is non-fatal: if the
          // endpoint is unavailable we just skip the chip/legend and
          // proceed with the legacy "untagged" rendering.
          tasks.push(
            fetch(`/api/plan-documents/${encodeURIComponent(docId)}/markup-layers`, { credentials: "include" })
              .then((r) => (r.ok ? r.json() : []))
              .then((rows: LayerRow[]) => {
                if (!cancelled) setLayers(Array.isArray(rows) ? rows : []);
              })
              .catch(() => {
                if (!cancelled) setLayers([]);
              })
              .finally(() => {
                if (!cancelled) setLayersLoaded(true);
              }),
          );
        } else {
          // Markups disabled — short-circuit so the render gate can
          // open without waiting for markups/layers metadata.
          setMarkupsLoaded(true);
          setLayersLoaded(true);
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
              })
              .finally(() => {
                if (!cancelled) setPinsLoaded(true);
              }),
          );
        } else {
          setPinsLoaded(true);
        }
        await Promise.all(tasks);
      } catch (err) {
        // Overlay failures are non-fatal — proceed with bare PDF
        // rendering. Open all gates so the renderer doesn't deadlock.
        // eslint-disable-next-line no-console
        console.warn("[print] overlay fetch failed", err);
        if (!cancelled) {
          setMarkupsLoaded(true);
          setLayersLoaded(true);
          setPinsLoaded(true);
        }
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

  // Gate on every overlay source individually so the headless capture
  // doesn't race ahead of any of them. Without this, a fast layers
  // fetch combined with a slow markups fetch could let the renderer
  // signal __PLAN_PDF_READY=true on an empty (but layer-aware) PDF.
  // Each "loaded" flag flips to true on success *or* failure (see the
  // `.finally()` handlers above), so a flaky overlay endpoint can't
  // deadlock the export.
  const overlaysReady =
    (includeMarkups ? markupsLoaded && layersLoaded : true) &&
    (includePins ? pinsLoaded : true);
  if (!doc || !pdfBlobUrl || !overlaysReady) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  }

  return (
    <PrintRenderer
      pdfUrl={pdfBlobUrl}
      pins={includePins ? pins : []}
      markups={includeMarkups ? markups : []}
      layers={includeMarkups ? layers : []}
      layerIdFilter={layerIdFilter}
      maxPages={maxPages}
      concurrency={printConcurrency}
      onError={setError}
    />
  );
}

function PrintRenderer({
  pdfUrl,
  pins,
  markups,
  layers,
  layerIdFilter,
  maxPages,
  concurrency,
  onError,
}: {
  pdfUrl: string;
  pins: PinRow[];
  markups: MarkupRow[];
  // Task #1677 — full layer roster for the document (independent of
  // filter) so we can resolve layer color/name for each markup chip
  // and render the footer legend describing what was included.
  layers: LayerRow[];
  // Task #1677 — null means "include every layer". A populated set
  // restricts both rendering and the legend to the chosen subset.
  layerIdFilter: Set<string> | null;
  // Task #1609 — `maxPages` and `onError` were previously referenced
  // here but only ever existed in the parent component's scope, so
  // every render of PrintRenderer threw a ReferenceError and the
  // headless print page never reached __PLAN_PDF_READY = true. They
  // are now passed in explicitly.
  maxPages: number;
  // Task #2212 — number of `renderPage` calls to keep in flight at
  // once. Pre-clamped by the parent to [1, MAX_PRINT_PAGE_CONCURRENCY].
  concurrency: number;
  onError: (msg: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Resolve the canonical default layer once so we can map any markup
  // with `layerId === null` (legacy / pre-#1662 rows) to the same chip
  // that the in-app viewer shows.
  const defaultLayer = useMemo(
    () => layers.find((l) => l.isDefault) || null,
    [layers],
  );
  const layersById = useMemo(() => {
    const m = new Map<string, LayerRow>();
    for (const l of layers) m.set(l.id, l);
    return m;
  }, [layers]);

  // Task #1677 — resolve the *effective* set of layer ids that should
  // be rendered. Two cases:
  //
  //  1. URL supplies `layerIds`: that set wins (overrides per-user
  //     visibility, since an explicit request is a stronger signal
  //     than a stored preference). The "__default__" sentinel maps
  //     to the auto-created default layer's id.
  //  2. URL omits `layerIds`: fall back to "all visible layers" — i.e.
  //     respect the requester's per-layer visibility toggles from
  //     `/markup-layers`. Layers without an explicit override are
  //     visible by default (the API returns `isVisible: true` for them).
  //
  // The result is the canonical inclusion set used by both the markup
  // filter and the legend so they can never disagree about what's in
  // the export.
  const effectiveIncludedLayerIds = useMemo<Set<string>>(() => {
    if (layerIdFilter) {
      const out = new Set<string>();
      for (const id of layerIdFilter) {
        if (id === DEFAULT_LAYER_SENTINEL) {
          if (defaultLayer) out.add(defaultLayer.id);
        } else {
          out.add(id);
        }
      }
      return out;
    }
    // No explicit filter — use per-user visibility. Treat missing
    // `isVisible` as `true` to match the server's coalescing.
    return new Set(
      layers.filter((l) => l.isVisible !== false).map((l) => l.id),
    );
  }, [layerIdFilter, layers, defaultLayer]);

  // True iff the export is narrower than "every layer this document
  // has". Used by the legend strip to surface "filtered (X of N)".
  const filterIsActive = useMemo(() => {
    if (layerIdFilter) return true;
    return effectiveIncludedLayerIds.size < layers.length;
  }, [layerIdFilter, effectiveIncludedLayerIds, layers.length]);

  // Markup-level inclusion check. Legacy rows with a NULL layerId
  // resolve through the auto-default layer so they participate in
  // the same visibility/filter semantics as everything else.
  const isLayerIncluded = useMemo(() => {
    return (layerId: string | null | undefined): boolean => {
      const resolved = layerId ?? defaultLayer?.id ?? null;
      if (!resolved) {
        // No default layer materialised yet (extremely unusual — only
        // happens for documents whose layers fetch failed). Fall back
        // to including the markup so we never silently drop content
        // when nothing in scope was explicitly excluded.
        return !layerIdFilter;
      }
      return effectiveIncludedLayerIds.has(resolved);
    };
  }, [effectiveIncludedLayerIds, defaultLayer, layerIdFilter]);

  // Legend membership: list every layer the export is *scoped* to,
  // not just the ones that happen to have markups on the rendered
  // pages. Recipients need to see e.g. "QA/QC was included but is
  // empty for this sheet" — silently omitting empty-but-included
  // layers would miscommunicate the export's scope.
  const includedLayers: LayerRow[] = useMemo(() => {
    return layers
      .filter((l) => effectiveIncludedLayerIds.has(l.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [layers, effectiveIncludedLayerIds]);

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
      if (!isLayerIncluded(x.layerId)) continue;
      if (!m.has(x.pageNumber)) m.set(x.pageNumber, []);
      m.get(x.pageNumber)!.push(x);
    }
    return m;
  }, [markups, isLayerIncluded]);

  useEffect(() => {
    let cancelled = false;
    // Task #2212 — track every in-flight `renderPage` handle so the
    // effect cleanup can actively `cancel()` them on unmount or prop
    // change. With parallel dispatch (up to `concurrency` in flight)
    // an unguarded teardown would let several pdfjs RenderTasks burn
    // CPU + memory after the consumer is gone.
    const activeHandles = new Set<CancellablePageRender>();
    (async () => {
      try {
        // Task #2188 — All pdfjs work happens in the shared worker
        // pool. The worker pool needs `Worker` + `OffscreenCanvas`; if
        // either is missing (jsdom unit tests, very old browsers) we
        // surface an explicit error rather than silently regressing
        // back to a main-thread pdfjs path.
        const scheduler = getSharedScheduler();
        if (!scheduler) {
          const msg = "Browser does not support off-thread PDF rendering.";
          window.__PLAN_PDF_ERROR = msg;
          window.__PLAN_PDF_READY = true;
          setStatus("error");
          onError(msg);
          return;
        }

        const info = await scheduler.getDocumentInfo(pdfUrl);
        if (cancelled) return;
        const numPages = info.numPages;
        window.__PLAN_PDF_PAGE_COUNT = numPages;
        // Task #1609 — bail out *before* rasterizing pages if the PDF
        // exceeds the server-supplied cap. Without this early exit the
        // 500-page guard in the server only kicks in after every page
        // has already rendered (defeating the purpose of the limit).
        if (numPages > maxPages) {
          const msg = `Plan document has ${numPages} pages; export is capped at ${maxPages}.`;
          window.__PLAN_PDF_ERROR = msg;
          window.__PLAN_PDF_READY = true;
          setStatus("error");
          onError(msg);
          return;
        }
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        // Task #2212 — pre-create a wrapper for every page in document
        // order *before* dispatching any renders, then fill each
        // wrapper as its bitmap arrives. This is what preserves the
        // printed page order: the DOM is locked in before any of the
        // parallel `renderPage` calls can race to completion.
        // (page.pdf() walks the DOM in document order, so as long as
        // the wrappers are appended in order the canvases inside them
        // can land out-of-order without affecting the printed output.)
        const pageWrappers: HTMLDivElement[] = new Array(numPages);
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          const pageWrap = document.createElement("div");
          pageWrap.className = "plan-pdf-page";
          pageWrap.style.cssText = `display:block;break-after:page;page-break-after:always;`;
          container.appendChild(pageWrap);
          pageWrappers[pageNum - 1] = pageWrap;
        }

        // Render a single page end-to-end (worker rasterise + on-main
        // overlay draws + DOM attach). Hoisted out of the dispatch
        // loop so each "lane" of the sliding window invokes the same
        // body and DOM ordering stays driven by `pageWrappers`.
        const renderPageInto = async (pageNum: number): Promise<void> => {
          // Task #2188 — pdfjs renders happen in the worker; the
          // main thread only blits the returned `ImageBitmap` into a
          // visible canvas (a sub-millisecond `drawImage`).
          const handle = scheduler.renderPage(
            pdfUrl,
            pageNum - 1,
            RENDER_SCALE,
          );
          activeHandles.add(handle);
          let result;
          try {
            result = await handle.promise;
          } finally {
            activeHandles.delete(handle);
          }
          if (cancelled) {
            try { result.bitmap.close(); } catch { /* noop */ }
            return;
          }
          const canvas = doc_create_canvas(result.width, result.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            try { result.bitmap.close(); } catch { /* noop */ }
            return;
          }
          ctx.drawImage(result.bitmap, 0, 0);
          try { result.bitmap.close(); } catch { /* noop */ }

          // Burn markups for this page.
          const pageMarkups = markupsByPage.get(pageNum) || [];
          for (const m of pageMarkups) {
            // Task #1677 — resolve the markup's layer (falling back to
            // the auto-created Default for legacy null-layer rows) so
            // the canvas renderer can stamp a small color-coded chip
            // identifying the layer.
            const layer = m.layerId
              ? layersById.get(m.layerId) || defaultLayer
              : defaultLayer;
            renderMarkupToCanvas(ctx, {
              tool: m.tool,
              points: Array.isArray(m.points) ? m.points : [],
              color: m.color || "#ff0000",
              thickness: m.thickness || 2,
              text: m.text || undefined,
              layer: layer ? { name: layer.name, color: layer.color } : null,
            } as MarkupForRender, result.width, result.height);
          }

          // Burn pins.
          const pagePins = pinsByPage.get(pageNum) || [];
          for (const p of pagePins) {
            drawPin(ctx, p, result.width, result.height);
          }

          const pageWrap = pageWrappers[pageNum - 1];
          pageWrap.appendChild(canvas);

          // Task #1677 — render a per-page footer legend so a recipient
          // looking at any page can see which layers were included
          // (and, by extension, which were filtered out). Suppressed
          // when no layers metadata is loaded so legacy single-layer
          // exports stay visually unchanged.
          if (layers.length > 0) {
            const footer = renderLegendFooter({
              layers: includedLayers,
              filterActive: filterIsActive,
              totalLayerCount: layers.length,
              pageNumber: pageNum,
              totalPages: numPages,
            });
            pageWrap.appendChild(footer);
          }
        };

        // Task #2212 — sliding-window dispatcher. We spawn `lanes`
        // async loops; each loop pulls the next page index off the
        // shared `nextPage` cursor and renders it. This bounds in-
        // flight renders to `lanes` regardless of how fast individual
        // pages complete, which is the property that protects
        // Chromium from holding N huge ImageBitmaps at once.
        let nextPage = 1;
        let workerError: unknown = null;
        const workerLoop = async (): Promise<void> => {
          while (!cancelled && workerError === null) {
            const pageNum = nextPage++;
            if (pageNum > numPages) return;
            try {
              await renderPageInto(pageNum);
            } catch (err) {
              // Capture the first error so the other lanes can drain
              // (cleanly cancelling their in-flight handles via the
              // `workerError !== null` short-circuit) without burying
              // the original failure under a later "cancelled" reject.
              if (workerError === null) workerError = err;
              return;
            }
          }
        };
        const lanes = Math.max(1, Math.min(concurrency, numPages));
        const workers: Promise<void>[] = [];
        for (let i = 0; i < lanes; i++) {
          workers.push(workerLoop());
        }
        await Promise.all(workers);
        if (workerError) throw workerError;

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
      // Task #2212 — actively cancel any pdfjs RenderTasks that are
      // still in flight in the worker pool. Without this, a quick
      // unmount/prop-change would leave several full-page renders
      // burning CPU + memory until they completed naturally.
      activeHandles.forEach((h) => {
        try { h.cancel(); } catch { /* noop */ }
      });
      activeHandles.clear();
    };
    // Task #1677 — `layers`/`includedLayers`/`layerIdFilter`/`layersById`/
    // `defaultLayer`/`filterIsActive` are read inside the render loop
    // above (for chips + legend). They are stable across renders for a
    // given prop set, but we list them here so a re-render with a
    // different filter (e.g. future client-side toggle) regenerates
    // the burned-in artwork.
  }, [
    pdfUrl,
    markupsByPage,
    pinsByPage,
    layers,
    includedLayers,
    layerIdFilter,
    layersById,
    defaultLayer,
    filterIsActive,
    concurrency,
  ]);

  return (
    <div style={{ background: "#fff" }}>
      <style>{`
        @page { size: auto; margin: 0; }
        body { margin: 0; }
        .plan-pdf-page canvas { display: block; width: 100%; height: auto; }
        .plan-pdf-legend {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          font-size: 9px;
          color: #0f172a;
          border-top: 1px solid #cbd5e1;
          background: #f8fafc;
          padding: 6px 12px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 14px;
          line-height: 1.3;
        }
        .plan-pdf-legend .label { font-weight: 600; margin-right: 4px; }
        .plan-pdf-legend .swatch {
          display: inline-block;
          width: 9px;
          height: 9px;
          margin-right: 4px;
          vertical-align: middle;
          border: 1px solid rgba(15, 23, 42, 0.2);
        }
        .plan-pdf-legend .chip { white-space: nowrap; }
        .plan-pdf-legend .meta {
          margin-left: auto;
          color: #475569;
          font-style: italic;
        }
      `}</style>
      <div ref={containerRef} data-testid="plan-pdf-print-root" />
      {status === "loading" && (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Rendering pages…</div>
      )}
    </div>
  );
}

/**
 * Task #1677 — DOM helper that builds the per-page legend strip
 * appended below each rasterised plan page. Lists which named layers
 * were included (color swatch + name) and notes when the export was
 * scoped to a subset of available layers so recipients can tell what
 * is missing.
 */
function renderLegendFooter(args: {
  layers: LayerRow[];
  filterActive: boolean;
  totalLayerCount: number;
  pageNumber: number;
  totalPages: number;
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "plan-pdf-legend";
  wrap.setAttribute("data-testid", "plan-pdf-legend");

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Layers included:";
  wrap.appendChild(label);

  if (args.layers.length === 0) {
    const none = document.createElement("span");
    none.className = "chip";
    // `includedLayers` is the *scope* of the export, not "layers that
    // have markups". An empty list therefore means every available
    // layer is out of scope — either via an explicit `?layerIds=` that
    // cleared everything, or via per-user visibility hiding the lot.
    none.textContent = args.filterActive
      ? "(none — every available layer was excluded)"
      : "(none)";
    wrap.appendChild(none);
  } else {
    for (const layer of args.layers) {
      const chip = document.createElement("span");
      chip.className = "chip";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.backgroundColor = layer.color || "#94a3b8";
      chip.appendChild(swatch);
      chip.appendChild(document.createTextNode(layer.name));
      wrap.appendChild(chip);
    }
  }

  const meta = document.createElement("span");
  meta.className = "meta";
  const filteredNote = args.filterActive
    ? ` · filtered (${args.layers.length} of ${args.totalLayerCount} layers)`
    : "";
  meta.textContent = `Page ${args.pageNumber} of ${args.totalPages}${filteredNote}`;
  wrap.appendChild(meta);

  return wrap;
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
