/**
 * Task #2220 — Client-side emitter for the three takeoff
 * pen/touch interactions whose defaults Section 7 of the Takeoff
 * Interaction Map currently tunes by hand: palm rejection, the
 * stylus long-press snap-HUD, and the two-finger rotate gesture.
 *
 * Design notes:
 *   - Anonymous & tenant-scoped. We send NOTHING that identifies the
 *     project, sheet, measurement, or user — the server stamps each
 *     row with the authenticated `req.user.organizationId` and
 *     ignores any tenant hint the client might send.
 *   - Buffered. A noisy palm-rejection storm during a single drag
 *     can fire dozens of events per second; we coalesce up to
 *     MAX_BUFFER (=50) into one POST and flush every FLUSH_INTERVAL_MS
 *     or on `visibilitychange` / `pagehide` via `sendBeacon`. This
 *     keeps the takeoff workspace's event loop free.
 *   - Best-effort. Network failures are swallowed silently. If the
 *     buffer overruns we drop the oldest events rather than the
 *     newest, on the theory that the most recent activity is the
 *     most representative of what the user is doing right now.
 *   - Honors Do-Not-Track and a `localStorage["takeoff:telemetry"]
 *     === "off"` opt-out so users can disable client-side collection
 *     without tenant-admin involvement.
 */

export type StylusTelemetryEventType =
  | "PALM_REJECTED"
  | "LONG_PRESS"
  | "ROTATE_GESTURE";

export type StylusPointerType = "pen" | "touch" | "mouse";

export type StylusDeviceClass =
  | "ios"
  | "ipados"
  | "android"
  | "windows"
  | "macos"
  | "linux"
  | "other";

export interface StylusTelemetryEvent {
  eventType: StylusTelemetryEventType;
  pointerType?: StylusPointerType | null;
  deviceClass?: StylusDeviceClass | null;
  dwellMs?: number | null;
  contactSizePx?: number | null;
  rotationDeltaDeg?: number | null;
  bandPx?: number | null;
  configuredThresholdMs?: number | null;
}

const ENDPOINT = "/api/takeoff/stylus-telemetry/batch";
const MAX_BUFFER = 50;
const FLUSH_INTERVAL_MS = 5000;

let buffer: StylusTelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isOptedOut(): boolean {
  if (!isBrowser()) return true;
  try {
    if (
      typeof navigator !== "undefined" &&
      // Some browsers expose msDoNotTrack; check both.
      ((navigator as Navigator & { doNotTrack?: string }).doNotTrack === "1" ||
        (window as Window & { doNotTrack?: string }).doNotTrack === "1")
    ) {
      return true;
    }
    if (window.localStorage?.getItem("takeoff:telemetry") === "off") return true;
  } catch {
    // localStorage can throw in private mode; default to allow.
  }
  return false;
}

let cachedDeviceClass: StylusDeviceClass | null = null;
function getDeviceClass(): StylusDeviceClass {
  if (cachedDeviceClass) return cachedDeviceClass;
  if (!isBrowser() || typeof navigator === "undefined") {
    cachedDeviceClass = "other";
    return cachedDeviceClass;
  }
  const ua = navigator.userAgent || "";
  // Order matters: iPadOS 13+ reports a Mac UA but exposes touch
  // points, so check that compound condition before plain "macos".
  if (/iPhone|iPod/i.test(ua)) cachedDeviceClass = "ios";
  else if (
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  )
    cachedDeviceClass = "ipados";
  else if (/Android/i.test(ua)) cachedDeviceClass = "android";
  else if (/Windows/i.test(ua)) cachedDeviceClass = "windows";
  else if (/Macintosh|Mac OS X/i.test(ua)) cachedDeviceClass = "macos";
  else if (/Linux/i.test(ua)) cachedDeviceClass = "linux";
  else cachedDeviceClass = "other";
  return cachedDeviceClass;
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function bindUnloadListenersOnce(): void {
  if (listenersBound || !isBrowser()) return;
  listenersBound = true;
  // sendBeacon is the only reliable way to ship a payload during
  // pagehide / tab close; visibilitychange covers backgrounded tabs
  // (mobile safari fires this aggressively when a user swipes away).
  // visibilitychange is dispatched on document (the spec target);
  // pagehide is on window. Binding each on its native target keeps
  // the listener firing across browsers that are strict about it.
  const handler = () => {
    if (buffer.length > 0) flushBeacon();
  };
  document.addEventListener("visibilitychange", handler);
  window.addEventListener("pagehide", handler);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      // keepalive lets the request survive a navigation; the server
      // returns 204 so this is harmless.
      keepalive: true,
    });
  } catch {
    // Best-effort: do not requeue on failure to avoid pathological
    // retry storms when the server is down. We'd rather lose a
    // window of events than wedge the takeoff workspace.
  }
}

function flushBeacon(): void {
  if (buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([JSON.stringify({ events })], {
        type: "application/json",
      });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    }
  } catch {
    // Fall through to fetch below.
  }
  // Last-ditch fetch with keepalive — safe even on pagehide.
  void fetch(ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
  }).catch(() => {});
}

function emit(event: StylusTelemetryEvent): void {
  if (isOptedOut()) return;
  bindUnloadListenersOnce();
  const enriched: StylusTelemetryEvent = {
    deviceClass: event.deviceClass ?? getDeviceClass(),
    ...event,
  };
  buffer.push(enriched);
  if (buffer.length >= MAX_BUFFER) {
    // Drop the oldest if somehow we shot past (shouldn't happen given
    // we flush at the cap, but defensive).
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(buffer.length - MAX_BUFFER);
    }
    void flush();
    return;
  }
  scheduleFlush();
}

/** Palm rejection — fired every time the workspace drops a touch
 *  because its contact size exceeded the configured palm band. */
export function recordPalmReject(opts: {
  pointerType?: StylusPointerType | null;
  contactSizePx?: number | null;
  bandPx?: number | null;
}): void {
  emit({
    eventType: "PALM_REJECTED",
    pointerType: opts.pointerType ?? "touch",
    contactSizePx:
      opts.contactSizePx == null ? null : Math.round(opts.contactSizePx * 10) / 10,
    bandPx: opts.bandPx ?? null,
  });
}

/** Long-press — fired when the snap HUD opens after a stylus
 *  hold. `dwellMs` is the *measured* wall-clock elapsed time from
 *  pointer-down to fire (always >= the configured threshold; the gap
 *  reflects timer/main-thread drift). `configuredThresholdMs` is the
 *  user's `stylus_long_press_ms` pref in effect for this gesture, so
 *  the dashboard can distinguish setting-distribution from observed
 *  behavior. */
export function recordLongPress(opts: {
  pointerType?: StylusPointerType | null;
  dwellMs?: number | null;
  configuredThresholdMs?: number | null;
}): void {
  emit({
    eventType: "LONG_PRESS",
    pointerType: opts.pointerType ?? "pen",
    dwellMs: opts.dwellMs ?? null,
    configuredThresholdMs: opts.configuredThresholdMs ?? null,
  });
}

/** Two-finger rotate — fired once per discrete 90° step the gesture
 *  triggered. `rotationDeltaDeg` is signed (+ = CCW, − = CW) and
 *  matches the cumulative angle the gesture traversed before the
 *  step fired (typically ±90°). */
export function recordRotateGesture(opts: {
  rotationDeltaDeg: number;
}): void {
  emit({
    eventType: "ROTATE_GESTURE",
    pointerType: "touch",
    rotationDeltaDeg:
      Math.round(opts.rotationDeltaDeg * 10) / 10,
  });
}

/** Test-only helper — not part of the public surface. */
export function __resetTakeoffStylusTelemetryForTests(): void {
  buffer = [];
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  cachedDeviceClass = null;
}
