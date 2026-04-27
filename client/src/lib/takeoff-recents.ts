import { useEffect, useState } from "react";

export type RecentTakeoffKind = "bid" | "project";

export interface RecentTakeoffEntry {
  kind: RecentTakeoffKind;
  entityId: string;
  entityCode: string;
  entityName?: string | null;
  sheetId?: string | null;
  sheetName?: string | null;
  openedAt: number;
  // Task #2078 — `pinnedAt` is the timestamp when the user pinned this
  // entry (null/undefined = not pinned). Pinned entries always render
  // first and are not capped by the recents limit. `hidden` entries are
  // suppressed from the UI until the user opens them again, in which case
  // `recordRecent` clears the flag.
  //
  // Task #2097 — these flags now sync server-side via the same
  // /api/takeoff/recents endpoints so they follow the user across
  // devices, not just locally.
  pinnedAt?: number | null;
  hidden?: boolean;
}

export interface RecentTakeoffSelector {
  kind: RecentTakeoffKind;
  entityId: string;
  sheetId?: string | null;
}

const MAX_ENTRIES = 24;
const EVENT_NAME = "takeoff-recents-changed";

// Task #2079 — Cross-device sync. We continue to write to localStorage
// for instant UX, but the canonical store now lives on the server. The
// client-side cache is reconciled with the server on /takeoff load (see
// `syncRecentsFromServer` below) and every local write fires a
// best-effort POST so other devices catch up on their next read.
//
// Task #2097 layered pin/unpin/remove endpoints onto the same base URL
// so the pinned/removed state syncs alongside the openedAt ordering.
const SYNC_ENDPOINT = "/api/takeoff/recents";
const lastServerSyncAt = new Map<string, number>();
const inflightSync = new Map<string, Promise<void>>();
const SERVER_SYNC_INTERVAL_MS = 60 * 1000;

function storageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `takeoff-recents-${userId}`;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringOrNullish(v: unknown): v is string | null | undefined {
  return v === null || v === undefined || typeof v === "string";
}

function toEntry(value: unknown): RecentTakeoffEntry | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.openedAt !== "number") return null;
  if (!isStringOrNullish(obj.sheetId)) return null;
  if (!isStringOrNullish(obj.sheetName)) return null;

  // Newer entries carry a `kind` discriminator and generic
  // entity{Id,Code,Name} fields. Older entries (Task #2072 first
  // shipped before project takeoff workspaces existed) only stored
  // bid* fields — treat them as bids for backward compatibility.
  const kindRaw = obj.kind;
  const kind: RecentTakeoffKind | null =
    kindRaw === "bid" || kindRaw === "project"
      ? kindRaw
      : isString(obj.bidId) && isString(obj.bidCode)
        ? "bid"
        : null;
  if (!kind) return null;

  const entityId = isString(obj.entityId)
    ? obj.entityId
    : isString(obj.bidId)
      ? obj.bidId
      : null;
  const entityCode = isString(obj.entityCode)
    ? obj.entityCode
    : isString(obj.bidCode)
      ? obj.bidCode
      : null;
  if (!entityId || !entityCode) return null;

  const entityNameRaw = isStringOrNullish(obj.entityName)
    ? obj.entityName
    : isStringOrNullish(obj.bidName)
      ? obj.bidName
      : null;

  const pinnedAt = typeof obj.pinnedAt === "number" ? obj.pinnedAt : null;
  const hidden = obj.hidden === true;

  return {
    kind,
    entityId,
    entityCode,
    entityName: entityNameRaw ?? null,
    sheetId: obj.sheetId ?? null,
    sheetName: obj.sheetName ?? null,
    openedAt: obj.openedAt,
    pinnedAt,
    hidden,
  };
}

function safeParse(raw: string | null): RecentTakeoffEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: RecentTakeoffEntry[] = [];
    for (const item of parsed) {
      const entry = toEntry(item);
      if (entry) result.push(entry);
    }
    return result;
  } catch {
    return [];
  }
}

export function readRecents(userId: string | null | undefined): RecentTakeoffEntry[] {
  if (typeof window === "undefined") return [];
  const key = storageKey(userId);
  if (!key) return [];
  try {
    return safeParse(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function matchesSelector(entry: RecentTakeoffEntry, selector: RecentTakeoffSelector): boolean {
  if (entry.kind !== selector.kind) return false;
  if (entry.entityId !== selector.entityId) return false;
  const entrySheet = entry.sheetId ?? null;
  const selectorSheet = selector.sheetId ?? null;
  return entrySheet === selectorSheet;
}

// Cap unpinned entries at MAX_ENTRIES so localStorage doesn't grow without
// bound. Pinned entries are always preserved — that's the whole point of
// pinning.
function capEntries(entries: RecentTakeoffEntry[]): RecentTakeoffEntry[] {
  const pinned: RecentTakeoffEntry[] = [];
  const unpinned: RecentTakeoffEntry[] = [];
  for (const entry of entries) {
    if (entry.pinnedAt) pinned.push(entry);
    else unpinned.push(entry);
  }
  return [...pinned, ...unpinned.slice(0, MAX_ENTRIES)];
}

function writeRecents(userId: string, entries: RecentTakeoffEntry[]): void {
  const key = storageKey(userId);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId } }));
  } catch {
    // localStorage may be full or unavailable
  }
}

// Task #2097 — When merging local and server entries, prefer the
// "stronger signal" per field so a user who pinned offline doesn't lose
// the pin when the server snapshot (which doesn't yet know about it)
// arrives. Hidden tombstones are always preserved.
function mergeFields(a: RecentTakeoffEntry, b: RecentTakeoffEntry): RecentTakeoffEntry {
  // Pick the side with the more recent openedAt as the base for snapshot
  // text, then overlay the strongest pin/hide state from either side.
  const fresher = a.openedAt >= b.openedAt ? a : b;
  const other = fresher === a ? b : a;
  return {
    kind: fresher.kind,
    entityId: fresher.entityId,
    entityCode: fresher.entityCode,
    entityName: fresher.entityName ?? other.entityName ?? null,
    sheetId: fresher.sheetId ?? null,
    sheetName: fresher.sheetName ?? other.sheetName ?? null,
    openedAt: fresher.openedAt,
    pinnedAt: a.pinnedAt ?? b.pinnedAt ?? null,
    hidden: (a.hidden ?? false) || (b.hidden ?? false),
  };
}

// Merges two lists keyed by (kind, entityId, sheetId), keeping the entry
// with the most recent `openedAt` and the fresher entityName/sheetName
// (preferring the side that bumped the timestamp). Server-derived entries
// override stale local ones so a recent open from another device wins.
function mergeEntries(
  a: RecentTakeoffEntry[],
  b: RecentTakeoffEntry[],
): RecentTakeoffEntry[] {
  const byKey = new Map<string, RecentTakeoffEntry>();
  const keyOf = (e: RecentTakeoffEntry) =>
    `${e.kind}:${e.entityId}:${e.sheetId ?? ""}`;
  for (const list of [a, b]) {
    for (const entry of list) {
      const key = keyOf(entry);
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeFields(existing, entry) : entry);
    }
  }
  // Sort by openedAt desc and keep pinned + a cap of unpinned. Pinned
  // never get trimmed; hidden tombstones are kept (filtered at render time).
  const all = Array.from(byKey.values()).sort((x, y) => y.openedAt - x.openedAt);
  return capEntries(all);
}

async function postRecentToServer(entry: RecentTakeoffEntry): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(SYNC_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch {
    // Network errors are tolerable — the next sync will reconcile.
  }
}

// Task #2097 — fire-and-forget POST helper for the new pin/unpin/remove
// endpoints. The local cache is the authoritative source for the UI; the
// server write is best-effort. If the user is offline (or the request
// fails for any reason), the local copy still reflects the change so the
// UI doesn't regress, and the next successful syncRecentsFromServer
// round-trip reconciles us with the server.
async function postSelectorToServer(
  path: "pin" | "unpin" | "remove",
  selector: RecentTakeoffSelector,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${SYNC_ENDPOINT}/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: selector.kind,
        entityId: selector.entityId,
        sheetId: selector.sheetId ?? null,
      }),
    });
  } catch {
    // Best-effort. Local state is already correct.
  }
}

// Task #2104 — Mirror of `deleteRecentOnServer` that wipes every entry for
// the authenticated user. Used by `clearRecents` so a user who hits "Clear
// all" on one device sees an empty rail when they next load /takeoff on
// any other device.
async function deleteAllRecentsOnServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${SYNC_ENDPOINT}/all`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // Network errors are tolerable — local state is the source of truth
    // until the next sync round-trip.
  }
}

// Pulls the canonical server-side rail and merges it into the local cache.
// Coalesced per-user so concurrent callers (e.g. takeoff-index + the
// workspace mounting at the same time) only issue one network request,
// and rate-limited so route changes don't hammer the endpoint.
export async function syncRecentsFromServer(
  userId: string | null | undefined,
  options: { force?: boolean } = {},
): Promise<void> {
  if (typeof window === "undefined" || !userId) return;
  const now = Date.now();
  const last = lastServerSyncAt.get(userId) ?? 0;
  if (!options.force && now - last < SERVER_SYNC_INTERVAL_MS) return;

  const existing = inflightSync.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(SYNC_ENDPOINT, { credentials: "include" });
      if (!res.ok) return;
      const payload: unknown = await res.json();
      if (!Array.isArray(payload)) return;
      const serverEntries: RecentTakeoffEntry[] = [];
      for (const item of payload) {
        const entry = toEntry(item);
        if (entry) serverEntries.push(entry);
      }
      const local = readRecents(userId);
      const merged = mergeEntries(local, serverEntries);
      writeRecents(userId, merged);
      lastServerSyncAt.set(userId, Date.now());
    } catch {
      // Swallow — UI will fall back to whatever is in localStorage.
    } finally {
      inflightSync.delete(userId);
    }
  })();

  inflightSync.set(userId, promise);
  return promise;
}

export function recordRecent(
  userId: string | null | undefined,
  entry: Omit<RecentTakeoffEntry, "openedAt" | "pinnedAt" | "hidden"> & {
    openedAt?: number;
  },
): void {
  if (!userId || typeof window === "undefined") return;
  if (!entry.entityId || !entry.entityCode) return;
  const existing = readRecents(userId);
  const sheetId = entry.sheetId ?? null;
  const openedAt = entry.openedAt ?? Date.now();
  // Preserve any existing pinnedAt so re-opening a pinned entry doesn't
  // unpin it. Re-opening a previously-hidden entry clears the hidden flag
  // because the user clearly wants to see it again.
  const prior = existing.find((e) =>
    matchesSelector(e, { kind: entry.kind, entityId: entry.entityId, sheetId }),
  );
  const next: RecentTakeoffEntry = {
    kind: entry.kind,
    entityId: entry.entityId,
    entityCode: entry.entityCode,
    entityName: entry.entityName ?? null,
    sheetId,
    sheetName: entry.sheetName ?? null,
    openedAt,
    pinnedAt: prior?.pinnedAt ?? null,
    hidden: false,
  };
  const filtered = existing.filter(
    (e) => !matchesSelector(e, { kind: entry.kind, entityId: entry.entityId, sheetId }),
  );
  filtered.unshift(next);
  writeRecents(userId, capEntries(filtered));

  // Task #2079 — Fire-and-forget POST so the entry follows the user to
  // their other devices. Local writes already updated the rail
  // synchronously above so the user never waits on the network. The
  // server-side POST also clears `hidden=false` on re-open (Task #2097).
  void postRecentToServer(next);
}

export function pinRecent(
  userId: string | null | undefined,
  selector: RecentTakeoffSelector,
): void {
  if (!userId || typeof window === "undefined") return;
  const existing = readRecents(userId);
  let changed = false;
  const next = existing.map((e) => {
    if (!matchesSelector(e, selector)) return e;
    if (e.pinnedAt) return e;
    changed = true;
    // Clear `hidden` when pinning so the user sees the entry they just
    // pinned. (Pinning an already-hidden entry would otherwise be silent.)
    return { ...e, pinnedAt: Date.now(), hidden: false };
  });
  if (changed) {
    writeRecents(userId, next);
    // Task #2097 — Mirror the pin on the server so it follows the user.
    void postSelectorToServer("pin", selector);
  }
}

export function unpinRecent(
  userId: string | null | undefined,
  selector: RecentTakeoffSelector,
): void {
  if (!userId || typeof window === "undefined") return;
  const existing = readRecents(userId);
  let changed = false;
  const next = existing.map((e) => {
    if (!matchesSelector(e, selector)) return e;
    if (!e.pinnedAt) return e;
    changed = true;
    return { ...e, pinnedAt: null };
  });
  if (changed) {
    writeRecents(userId, capEntries(next));
    // Task #2097 — Mirror the unpin on the server.
    void postSelectorToServer("unpin", selector);
  }
}

export function removeRecent(
  userId: string | null | undefined,
  selector: RecentTakeoffSelector,
): void {
  if (!userId || typeof window === "undefined") return;
  const existing = readRecents(userId);
  let changed = false;
  const next = existing.map((e) => {
    if (!matchesSelector(e, selector)) return e;
    if (e.hidden && !e.pinnedAt) return e;
    changed = true;
    // Removing also unpins so a "removed" entry stays gone until the user
    // opens it again.
    return { ...e, hidden: true, pinnedAt: null };
  });
  if (changed) {
    writeRecents(userId, capEntries(next));
    // Task #2097 — Soft-hide on the server (NOT a hard DELETE) so the
    // tombstone follows the user across devices. Without this, an open
    // from another device would resurrect the entry the user dismissed.
    void postSelectorToServer("remove", selector);
  }
}

// Task #2104 — "Clear all" affordance on the Takeoff index. Wipes the
// localStorage cache for the user (including pinned entries) and mirrors
// the wipe to the server so other devices come back to an empty rail.
// Also resets the per-user sync throttle so the next visit to /takeoff
// won't immediately refill the cache from a stale server fetch in flight.
export function clearRecents(userId: string | null | undefined): void {
  if (!userId || typeof window === "undefined") return;
  writeRecents(userId, []);
  lastServerSyncAt.delete(userId);
  void deleteAllRecentsOnServer();
}

export interface UseRecentTakeoffsResult {
  pinned: RecentTakeoffEntry[];
  recent: RecentTakeoffEntry[];
}

export function useRecentTakeoffs(
  userId: string | null | undefined,
  limit = 6,
): UseRecentTakeoffsResult {
  const [entries, setEntries] = useState<RecentTakeoffEntry[]>(() =>
    readRecents(userId),
  );

  useEffect(() => {
    setEntries(readRecents(userId));
    if (typeof window === "undefined" || !userId) return;
    // Pull the latest server-side rail as soon as a user is in scope
    // (Task #2079 — switching devices should show the same recents,
    // Task #2097 — pinned/removed state too).
    void syncRecentsFromServer(userId);
    const key = storageKey(userId);
    const refresh = () => setEntries(readRecents(userId));
    const onStorage = (e: StorageEvent) => {
      if (!key || e.key === key) refresh();
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail as { userId?: string } | undefined;
      if (!detail?.userId || detail.userId === userId) refresh();
    };
    const onFocus = () => {
      void syncRecentsFromServer(userId);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NAME, onCustom as EventListener);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NAME, onCustom as EventListener);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  const visible = entries.filter((e) => !e.hidden);
  const pinned = visible
    .filter((e) => e.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const recent = visible
    .filter((e) => !e.pinnedAt)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, limit);
  return { pinned, recent };
}

// Test-only escape hatch so unit tests can reset the per-user sync throttle
// without exporting it through the public API surface.
export function __resetTakeoffRecentsSyncStateForTests(): void {
  lastServerSyncAt.clear();
  inflightSync.clear();
}
