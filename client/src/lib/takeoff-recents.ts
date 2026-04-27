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
  if (changed) writeRecents(userId, next);
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
  if (changed) writeRecents(userId, capEntries(next));
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
  if (changed) writeRecents(userId, capEntries(next));
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
    const key = storageKey(userId);
    const refresh = () => setEntries(readRecents(userId));
    const onStorage = (e: StorageEvent) => {
      if (!key || e.key === key) refresh();
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail as { userId?: string } | undefined;
      if (!detail?.userId || detail.userId === userId) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NAME, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NAME, onCustom as EventListener);
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
