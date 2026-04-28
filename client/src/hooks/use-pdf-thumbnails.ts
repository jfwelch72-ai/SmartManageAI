/**
 * Task #2138 — Thumbnail strip rasterizer. After this task pdfjs lives
 * exclusively in `client/src/workers/pdfTileWorker.ts`; this hook
 * delegates every render through `getSharedScheduler().renderThumbnail`.
 * Worker output is an `ImageBitmap`; we copy it once into a hidden
 * canvas to produce a JPEG data URL so existing consumers (which expect
 * `<img src="data:image/jpeg…">`) keep working unchanged.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { TakeoffSheet } from "@shared/schema";
import { getSharedScheduler } from "@/lib/takeoff/tileScheduler";

interface UsePdfThumbnailsResult {
  thumbnails: Map<string, string>;
  failedSheets: Set<string>;
  isLoading: boolean;
  progress: number;
  observeRef: (sheetId: string, el: HTMLElement | null) => void;
}

const MAX_CACHE_SIZE = 100;
const thumbnailCache = new Map<string, string>();

function evictOldest() {
  if (thumbnailCache.size <= MAX_CACHE_SIZE) return;
  const keysToRemove = Array.from(thumbnailCache.keys()).slice(
    0,
    thumbnailCache.size - MAX_CACHE_SIZE,
  );
  keysToRemove.forEach((k) => thumbnailCache.delete(k));
}

let runIdCounter = 0;

function bitmapToJpeg(bitmap: ImageBitmap): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  canvas.width = 0;
  canvas.height = 0;
  try { bitmap.close(); } catch { /* noop */ }
  return dataUrl;
}

export function usePdfThumbnails(
  sheets: TakeoffSheet[],
  options?: { width?: number; height?: number },
): UsePdfThumbnailsResult {
  const { width = 120, height = 90 } = options || {};
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [failedSheets, setFailedSheets] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const activeRunRef = useRef(0);
  const loadingKeyRef = useRef("");
  const visibleSheetsRef = useRef<Set<string>>(new Set());
  const elementMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const observeRef = useCallback((sheetId: string, el: HTMLElement | null) => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const id = entry.target.getAttribute("data-sheet-thumb-id");
            if (!id) return;
            if (entry.isIntersecting) {
              visibleSheetsRef.current.add(id);
            } else {
              visibleSheetsRef.current.delete(id);
            }
          });
        },
        { threshold: 0.1 },
      );
    }

    const prevEl = elementMapRef.current.get(sheetId);
    if (prevEl) {
      observerRef.current.unobserve(prevEl);
      elementMapRef.current.delete(sheetId);
    }

    if (el) {
      el.setAttribute("data-sheet-thumb-id", sheetId);
      observerRef.current.observe(el);
      elementMapRef.current.set(sheetId, el);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      elementMapRef.current.clear();
    };
  }, []);

  const generateThumbnails = useCallback(async () => {
    const scheduler = getSharedScheduler();
    if (!scheduler) {
      // No `Worker` runtime — gracefully no-op so callers (sidebars,
      // pickers) just show empty thumbnails instead of crashing.
      setIsLoading(false);
      setProgress(100);
      return;
    }
    const runId = ++runIdCounter;
    activeRunRef.current = runId;
    const isCurrent = () => activeRunRef.current === runId;

    const uncachedSheets = sheets.filter(
      (s) => s.imageUrl && !thumbnailCache.has(s.id),
    );

    const cached = new Map<string, string>();
    sheets.forEach((s) => {
      const c = thumbnailCache.get(s.id);
      if (c) cached.set(s.id, c);
    });
    if (cached.size > 0) {
      setThumbnails((prev) => {
        const next = new Map(prev);
        cached.forEach((v, k) => next.set(k, v));
        return next;
      });
    }

    if (uncachedSheets.length === 0) {
      setIsLoading(false);
      setProgress(100);
      return;
    }

    setIsLoading(true);
    setProgress(0);

    const visible = visibleSheetsRef.current;
    const visibleFirst = [
      ...uncachedSheets.filter((s) => visible.has(s.id)),
      ...uncachedSheets.filter((s) => !visible.has(s.id)),
    ];

    const activeScheduler = scheduler;
    async function renderThumbnail(
      sheet: TakeoffSheet,
    ): Promise<{ id: string; dataUrl: string } | null> {
      const pdfUrl = `/api/takeoff/sheets/${sheet.id}/pdf`;
      const res = await activeScheduler.renderThumbnail(
        pdfUrl,
        sheet.sheetIndex || 0,
        width,
        height,
      );
      if (!isCurrent()) {
        try { res.bitmap.close(); } catch { /* noop */ }
        return null;
      }
      const dataUrl = bitmapToJpeg(res.bitmap);
      if (!dataUrl) return null;
      thumbnailCache.set(sheet.id, dataUrl);
      evictOldest();
      return { id: sheet.id, dataUrl };
    }

    const batchSize = 3;
    let completed = 0;

    for (let i = 0; i < visibleFirst.length; i += batchSize) {
      if (!isCurrent()) break;

      const batch = visibleFirst.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((sheet) => renderThumbnail(sheet)),
      );

      if (!isCurrent()) break;

      const newEntries = new Map<string, string>();
      const newFailed = new Set<string>();
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const sheetId = batch[j].id;
        if (r.status === "fulfilled" && r.value) {
          newEntries.set(r.value.id, r.value.dataUrl);
        } else if (r.status === "rejected" || (r.status === "fulfilled" && !r.value)) {
          newFailed.add(sheetId);
        }
      }

      if (newFailed.size > 0) {
        setFailedSheets((prev) => {
          const next = new Set(prev);
          newFailed.forEach((id) => next.add(id));
          return next;
        });
      }

      if (newEntries.size > 0) {
        setThumbnails((prev) => {
          const next = new Map(prev);
          newEntries.forEach((v, k) => next.set(k, v));
          return next;
        });
      }

      completed += batch.length;
      setProgress(
        Math.round(((cached.size + completed) / sheets.length) * 100),
      );
    }

    if (isCurrent()) {
      setIsLoading(false);
      setProgress(100);
    }
  }, [sheets, width, height]);

  useEffect(() => {
    const key = sheets.map((s) => s.id).join(",");
    if (key === loadingKeyRef.current && sheets.length > 0) return;
    loadingKeyRef.current = key;

    if (sheets.length === 0) {
      setThumbnails(new Map());
      setIsLoading(false);
      setProgress(0);
      return;
    }

    const timer = setTimeout(() => {
      generateThumbnails();
    }, 50);

    return () => {
      clearTimeout(timer);
      activeRunRef.current = 0;
    };
  }, [generateThumbnails]);

  return { thumbnails, failedSheets, isLoading, progress, observeRef };
}
