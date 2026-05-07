// Frontend RUM (Web Vitals) reporter — Task #2488.
//
// Captures the three Core Web Vitals (LCP, INP, CLS) plus TTFB / FCP
// using the native Performance APIs (no `web-vitals` package
// dependency added) and ships them to the backend via
// `navigator.sendBeacon` on `pagehide` / `visibilitychange=hidden`.
// The server endpoint is `POST /api/observability/web-vitals` (see
// `server/webVitalsRoutes.ts`).
//
// Budgets:
//   LCP   ≤ 2500 ms (good) / ≤ 4000 ms (needs improvement)
//   INP   ≤ 200  ms (good) / ≤ 500  ms (needs improvement)
//   CLS   ≤ 0.1  (good)    / ≤ 0.25 (needs improvement)
//   TTFB  ≤ 800  ms (good)
// Aligned with `docs/ops/capacity.md` § "Frontend Web Vitals".

type Metric = {
  name: 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
};

// Narrow typed views over the partially-supported / draft Performance
// APIs. We deliberately model only the fields we read so the rest of
// the file stays free of `any` and the typecheck count does not grow.

interface PerformanceObserverWithSupport {
  supportedEntryTypes?: ReadonlyArray<string>;
}

interface LargestContentfulPaintEntry extends PerformanceEntry {
  renderTime?: number;
  loadTime?: number;
}

interface LayoutShiftEntry extends PerformanceEntry {
  value?: number;
  hadRecentInput?: boolean;
}

interface PerformanceEventTimingEntry extends PerformanceEntry {
  duration: number;
}

interface NetworkInformationLike {
  effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

const buffer: Metric[] = [];

const RATING_THRESHOLDS: Record<Metric['name'], [number, number]> = {
  LCP:  [2500, 4000],
  INP:  [200, 500],
  CLS:  [0.1, 0.25],
  TTFB: [800, 1800],
  FCP:  [1800, 3000],
};

function rate(name: Metric['name'], value: number): Metric['rating'] {
  const [good, ni] = RATING_THRESHOLDS[name];
  if (value <= good) return 'good';
  if (value <= ni) return 'needs-improvement';
  return 'poor';
}

function record(name: Metric['name'], value: number) {
  if (!Number.isFinite(value)) return;
  buffer.push({
    name,
    value: Math.round(name === 'CLS' ? value * 1000 : value),
    rating: rate(name, value),
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  });
}

function safeObserve(type: string, cb: (entries: PerformanceEntry[]) => void): PerformanceObserver | null {
  if (typeof PerformanceObserver === 'undefined') return null;
  const supported = (PerformanceObserver as unknown as PerformanceObserverWithSupport).supportedEntryTypes;
  if (supported && !supported.includes(type)) return null;
  try {
    const po = new PerformanceObserver((list) => cb(list.getEntries()));
    po.observe({ type, buffered: true } as PerformanceObserverInit);
    return po;
  } catch {
    return null;
  }
}

function flush() {
  if (buffer.length === 0) return;
  const payload = {
    href: window.location.href,
    pathname: window.location.pathname,
    timestamp: Date.now(),
    connection: getConnection(),
    metrics: buffer.splice(0, buffer.length),
  };
  const url = '/api/observability/web-vitals';
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'include',
    }).catch(() => {});
  } catch {
    // best-effort only — never break the user session for telemetry
  }
}

function getConnection(): string | null {
  const c = (navigator as NavigatorWithConnection).connection;
  if (!c) return null;
  return c.effectiveType ?? null;
}

export function initWebVitals() {
  if (typeof window === 'undefined') return;
  // Skip in dev — RUM is only meaningful for real production traffic.
  if (import.meta.env?.DEV) return;

  // LCP — last entry wins, finalised on visibility change.
  let lcpValue = 0;
  safeObserve('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1] as LargestContentfulPaintEntry | undefined;
    if (last) lcpValue = last.renderTime || last.loadTime || 0;
  });

  // CLS — sum of session shift deltas (simplified spec).
  let clsValue = 0;
  safeObserve('layout-shift', (entries) => {
    for (const e of entries as LayoutShiftEntry[]) {
      if (!e.hadRecentInput) clsValue += e.value || 0;
    }
  });

  // INP — track the worst event duration above 40ms.
  let inpValue = 0;
  safeObserve('event', (entries) => {
    for (const e of entries as PerformanceEventTimingEntry[]) {
      const d = e.duration || 0;
      if (d > inpValue) inpValue = d;
    }
  });

  // FCP / TTFB from navigation + paint timings.
  safeObserve('paint', (entries) => {
    for (const e of entries) {
      if (e.name === 'first-contentful-paint') record('FCP', e.startTime);
    }
  });
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) record('TTFB', nav.responseStart - nav.startTime);
  } catch {}

  const finalize = () => {
    if (lcpValue) { record('LCP', lcpValue); lcpValue = 0; }
    if (clsValue) { record('CLS', clsValue); clsValue = 0; }
    if (inpValue) { record('INP', inpValue); inpValue = 0; }
    flush();
  };

  // Flush on tab hide (covers SPA navigation) and on page unload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') finalize();
  });
  window.addEventListener('pagehide', finalize);
}
