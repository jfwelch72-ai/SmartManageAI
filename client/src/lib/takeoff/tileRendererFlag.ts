/**
 * Task #2138 — Single source of truth for the `takeoff_tile_renderer`
 * feature flag. Defaults to ON; flips OFF if any of the following are
 * true:
 *
 *   • `localStorage.getItem('takeoff_tile_renderer') === 'off'`
 *     (per-user kill switch a developer or support engineer can flip
 *     in the browser console without re-deploying).
 *   • `window.__TAKEOFF_TILE_RENDERER__ === false` (set by the
 *     Playwright perf harness so it can A/B legacy vs tile renderer).
 *   • The browser doesn't expose `OffscreenCanvas` or `Worker`
 *     (Safari 16-, jsdom unit tests, etc.) — in that case we report
 *     the flag as off so the caller can degrade gracefully. Per task
 *     constraint, pdfjs only runs in the worker, so a true non-worker
 *     fallback is not provided; consumers handle the unsupported case
 *     by surfacing an error state to the user.
 *
 * Read once per render of the consuming component; flag changes
 * require a reload (matching how the existing `useFeatureFlags()`
 * hook treats server-side flags).
 */

const STORAGE_KEY = "takeoff_tile_renderer";

declare global {
  interface Window {
    __TAKEOFF_TILE_RENDERER__?: boolean;
  }
}

export function isTileRendererSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof Worker === "undefined") return false;
  if (typeof OffscreenCanvas === "undefined") return false;
  return true;
}

// Single console emission per session per reason — so opening 300
// sheets doesn't spam the console when tile streaming is disabled.
let fallbackLogged: string | null = null;

function logFallback(reason: string): void {
  if (fallbackLogged === reason) return;
  fallbackLogged = reason;
  // Visible enough for support engineers to spot in a screenshare,
  // quiet enough to not pollute normal use.
  // eslint-disable-next-line no-console
  console.info(
    `[Takeoff] tile_renderer fallback active — reason=${reason}`,
  );
}

export function isTileRendererEnabled(): boolean {
  if (!isTileRendererSupported()) {
    logFallback("unsupported_runtime");
    return false;
  }
  try {
    if (window.__TAKEOFF_TILE_RENDERER__ === false) {
      logFallback("window_flag_off");
      return false;
    }
    const ls = window.localStorage?.getItem(STORAGE_KEY);
    if (ls === "off") {
      logFallback("localstorage_off");
      return false;
    }
  } catch {
    /* localStorage may throw in restricted contexts; ignore */
  }
  return true;
}

export const TAKEOFF_TILE_RENDERER_FLAG_KEY = STORAGE_KEY;
