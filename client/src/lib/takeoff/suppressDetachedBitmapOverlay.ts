/**
 * Vite dev-overlay error suppressor for the transient
 *   "Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
 *    The image source is detached"
 * exception that Konva can throw when an `ImageBitmap` reference it
 * is mid-paint becomes invalid between React's commit and Konva's
 * batchDraw RAF.
 *
 * Why this exists alongside the other defenses:
 *   - `tileCache.deferredCloseBitmap` already delays every cache-side
 *     `bitmap.close()` past Konva's draw cycle (1.5s wall-clock).
 *   - `<TileLayer>` and the placeholder `<KonvaImage>` already skip
 *     bitmaps that report `width === 0`.
 *   - `usePdfTileRenderer` never calls `.close()` on the placeholder
 *     bitmap and relies on GC.
 *
 * Despite those guards, in some browser/HMR/timing combinations a
 * single transient `drawImage(detachedBitmap)` can still escape into
 * `window.onerror` (e.g. a worker reload, a tab returning from
 * background, an HMR module swap that leaves an old singleton with a
 * stale close-fn closure). Konva will redraw on the next batchDraw
 * tick with the now-correct state, so the visual outcome is fine —
 * but the Vite dev runtime overlay treats every `window.onerror`
 * event as a fatal popup, blocking the entire workspace until the
 * user clicks "fix the code or press Esc".
 *
 * This suppressor:
 *   • Only activates in development (`import.meta.env.DEV`).
 *   • Only suppresses errors whose message matches the exact
 *     `image source is detached` substring — it never swallows other
 *     drawImage failures, type errors, or anything unrelated.
 *   • Logs a single console.warn per session so the underlying race
 *     is still discoverable in support sessions.
 *   • Calls `event.preventDefault()` + `stopImmediatePropagation()`
 *     and registers in the CAPTURE phase so it runs before Vite's
 *     overlay handler attaches in bubble phase.
 *
 * In production the function is a no-op — production builds don't
 * have the dev overlay and `console.error`s from Konva are still
 * captured by the structured error logger.
 */

const DETACHED_RE = /image source is detached/i;

let installed = false;
let warnedOnce = false;

function isDetachedBitmapError(value: unknown): boolean {
  if (!value) return false;
  if (value instanceof Error) return DETACHED_RE.test(value.message);
  if (typeof value === "string") return DETACHED_RE.test(value);
  if (typeof value === "object") {
    const maybeMsg = (value as { message?: unknown }).message;
    if (typeof maybeMsg === "string") return DETACHED_RE.test(maybeMsg);
  }
  return false;
}

function logOnce(source: string, value: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[Takeoff] Suppressed transient "image source is detached" from ${source}. ` +
      `Konva will redraw on the next frame; this overlay is silenced in dev to ` +
      `avoid blocking the workspace. Underlying error:`,
    value,
  );
}

function onError(event: ErrorEvent): void {
  if (!isDetachedBitmapError(event.error ?? event.message)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  logOnce("window.onerror", event.error ?? event.message);
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!isDetachedBitmapError(event.reason)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  logOnce("unhandledrejection", event.reason);
}

export function installDetachedBitmapOverlaySuppressor(): () => void {
  if (typeof window === "undefined") return () => undefined;
  // Only suppress in dev — production has no Vite overlay and
  // structured error logging should record real failures.
  if (!import.meta.env.DEV) return () => undefined;
  if (installed) return () => undefined;
  installed = true;
  window.addEventListener("error", onError, { capture: true });
  window.addEventListener("unhandledrejection", onUnhandledRejection, {
    capture: true,
  });
  return () => {
    installed = false;
    window.removeEventListener("error", onError, { capture: true });
    window.removeEventListener(
      "unhandledrejection",
      onUnhandledRejection,
      { capture: true },
    );
  };
}
