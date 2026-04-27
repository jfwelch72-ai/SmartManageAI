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

  return {
    kind,
    entityId,
    entityCode,
    entityName: entityNameRaw ?? null,
    sheetId: obj.sheetId ?? null,
    sheetName: obj.sheetName ?? null,
    openedAt: obj.openedAt,
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
  entry: Omit<RecentTakeoffEntry, "openedAt"> & { openedAt?: number },
): void {
  if (!userId || typeof window === "undefined") return;
  if (!entry.entityId || !entry.entityCode) return;
  const existing = readRecents(userId);
  const sheetId = entry.sheetId ?? null;
  const openedAt = entry.openedAt ?? Date.now();
  const next: RecentTakeoffEntry = {
    kind: entry.kind,
    entityId: entry.entityId,
    entityCode: entry.entityCode,
    entityName: entry.entityName ?? null,
    sheetId,
    sheetName: entry.sheetName ?? null,
    openedAt,
  };
  const filtered = existing.filter((e) => {
    if (e.kind !== entry.kind) return true;
    if (e.entityId !== entry.entityId) return true;
    const eSheet = e.sheetId ?? null;
    return eSheet !== sheetId;
  });
  filtered.unshift(next);
  writeRecents(userId, filtered.slice(0, MAX_ENTRIES));
}

export function useRecentTakeoffs(
  userId: string | null | undefined,
  limit = 6,
): RecentTakeoffEntry[] {
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

  return entries
    .slice()
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, limit);
}
