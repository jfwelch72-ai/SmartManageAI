interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 60_000;

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
  const fullKey = `${orgId}:${key}`;
  store.set(fullKey, { data, expiresAt: Date.now() + ttlMs });
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
