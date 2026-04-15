interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 60_000;
const MAX_CACHE_SIZE = 5000;
const CLEANUP_INTERVAL_MS = 120_000;

export function cacheGet<T>(orgId: string, key: string): T | undefined {
  const fullKey = `${orgId}:${key}`;
  const entry = store.get(fullKey) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(fullKey);
    return undefined;
  }
  return entry.data;
}

export function cacheSet<T>(orgId: string, key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  if (store.size >= MAX_CACHE_SIZE) {
    cacheEvictExpired();
    if (store.size >= MAX_CACHE_SIZE) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
  }
  const fullKey = `${orgId}:${key}`;
  store.set(fullKey, { data, expiresAt: Date.now() + ttlMs });
}

export async function orgScopedCache<T>(
  orgId: string | null | undefined,
  cacheKey: string,
  ttlMs: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const resolvedOrg = orgId || "__global__";
  const cached = cacheGet<T>(resolvedOrg, cacheKey);
  if (cached !== undefined) return cached;
  const data = await fetchFn();
  cacheSet(resolvedOrg, cacheKey, data, ttlMs);
  return data;
}

export function cacheInvalidate(orgId: string, key: string): void {
  store.delete(`${orgId}:${key}`);
}

export function cacheInvalidateOrg(orgId: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(`${orgId}:`)) {
      store.delete(k);
    }
  }
}

export function cacheClearAll(): void {
  store.clear();
}

function cacheEvictExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.expiresAt) store.delete(k);
  }
}

export function cacheSize(): number {
  return store.size;
}

setInterval(cacheEvictExpired, CLEANUP_INTERVAL_MS).unref();
