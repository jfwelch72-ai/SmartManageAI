// @vitest-environment jsdom
//
// Task #2079 — Cross-device sync for the Takeoff "Recent" rail. These tests
// pin the merge + sync behaviour so a stale local cache can never lose a
// recent the user opened on another device, and so a fresh sign-in on a
// new machine pulls the rail down from the server.
//
// Task #2098 — Pin/unpin/remove behaviour from Task #2078 is locked down
// here too so future refactors of the recents rail can't silently regress
// the rules: pinned entries always render first and aren't capped by the
// 24-entry cap, removed entries stay hidden across reload, and re-opening a
// hidden entry unhides it.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTakeoffRecentsSyncStateForTests,
  pinRecent,
  readRecents,
  recordRecent,
  removeRecent,
  syncRecentsFromServer,
  unpinRecent,
  useRecentTakeoffs,
  type RecentTakeoffEntry,
} from "../takeoff-recents";

const USER_ID = "user-1";
const STORAGE_KEY = `takeoff-recents-${USER_ID}`;

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function withFetch(fn: FetchMock) {
  // jsdom provides a `fetch` shim but vitest doesn't auto-mock it; replace
  // it for the duration of the test and restore afterwards.
  const original = globalThis.fetch;
  globalThis.fetch = fn as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

beforeEach(() => {
  window.localStorage.clear();
  __resetTakeoffRecentsSyncStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordRecent", () => {
  it("writes the entry to localStorage immediately and POSTs it to the server", async () => {
    const fetchMock: FetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const restore = withFetch(fetchMock);
    try {
      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        entityName: "First Bid",
        sheetId: null,
        sheetName: null,
      });

      // Synchronous local write — the rail must update before the network roundtrip.
      const local = readRecents(USER_ID);
      expect(local).toHaveLength(1);
      expect(local[0].entityCode).toBe("B-1");

      // Best-effort POST.
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/takeoff/recents");
      expect((init as RequestInit).method).toBe("POST");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({ kind: "bid", entityId: "bid-1", entityCode: "B-1" });
      expect(typeof body.openedAt).toBe("number");
    } finally {
      restore();
    }
  });

  it("does not throw when the server POST fails", async () => {
    const fetchMock: FetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const restore = withFetch(fetchMock);
    try {
      expect(() =>
        recordRecent(USER_ID, {
          kind: "project",
          entityId: "project-1",
          entityCode: "P-1",
        }),
      ).not.toThrow();
      // The local cache should still have been updated.
      expect(readRecents(USER_ID)).toHaveLength(1);
      // Allow the rejected fetch to settle so it does not bleed into the next test.
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      restore();
    }
  });
});

describe("syncRecentsFromServer", () => {
  it("merges newer server entries into the local cache and prefers the freshest openedAt", async () => {
    const localEntry: RecentTakeoffEntry = {
      kind: "bid",
      entityId: "bid-1",
      entityCode: "B-1",
      entityName: "Local Name",
      sheetId: null,
      sheetName: null,
      openedAt: 1_000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([localEntry]));

    const serverEntries = [
      {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        entityName: "Server Name",
        sheetId: null,
        sheetName: null,
        openedAt: 5_000,
      },
      {
        kind: "project",
        entityId: "project-9",
        entityCode: "P-9",
        entityName: "Other Device Project",
        sheetId: null,
        sheetName: null,
        openedAt: 4_000,
      },
    ];

    const fetchMock: FetchMock = vi.fn().mockResolvedValue(jsonResponse(serverEntries));
    const restore = withFetch(fetchMock);
    try {
      await syncRecentsFromServer(USER_ID, { force: true });
      const merged = readRecents(USER_ID);
      // Project from another device shows up.
      expect(merged.some((e) => e.kind === "project" && e.entityCode === "P-9")).toBe(true);
      // The bid entry kept the newer server openedAt and refreshed name.
      const bid = merged.find((e) => e.kind === "bid" && e.entityCode === "B-1");
      expect(bid?.openedAt).toBe(5_000);
      expect(bid?.entityName).toBe("Server Name");
    } finally {
      restore();
    }
  });

  it("prefers the local entry when it is newer than the server's copy", async () => {
    const localEntry: RecentTakeoffEntry = {
      kind: "bid",
      entityId: "bid-1",
      entityCode: "B-1",
      entityName: "Local Name",
      sheetId: null,
      sheetName: null,
      openedAt: 9_000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([localEntry]));

    const fetchMock: FetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          kind: "bid",
          entityId: "bid-1",
          entityCode: "B-1",
          entityName: "Server Name",
          sheetId: null,
          sheetName: null,
          openedAt: 1_000,
        },
      ]),
    );
    const restore = withFetch(fetchMock);
    try {
      await syncRecentsFromServer(USER_ID, { force: true });
      const merged = readRecents(USER_ID);
      const bid = merged.find((e) => e.kind === "bid" && e.entityCode === "B-1");
      expect(bid?.openedAt).toBe(9_000);
      expect(bid?.entityName).toBe("Local Name");
    } finally {
      restore();
    }
  });

  it("rate-limits subsequent calls within the throttle window", async () => {
    const fetchMock: FetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const restore = withFetch(fetchMock);
    try {
      await syncRecentsFromServer(USER_ID);
      await syncRecentsFromServer(USER_ID);
      await syncRecentsFromServer(USER_ID);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("ignores non-array payloads from the server without clobbering local state", async () => {
    const localEntry: RecentTakeoffEntry = {
      kind: "bid",
      entityId: "bid-1",
      entityCode: "B-1",
      sheetId: null,
      openedAt: 2_000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([localEntry]));

    const fetchMock: FetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }));
    const restore = withFetch(fetchMock);
    try {
      await syncRecentsFromServer(USER_ID, { force: true });
      const local = readRecents(USER_ID);
      expect(local).toHaveLength(1);
      expect(local[0].entityCode).toBe("B-1");
    } finally {
      restore();
    }
  });

  it("bails out cleanly without a userId", async () => {
    const fetchMock: FetchMock = vi.fn();
    const restore = withFetch(fetchMock);
    try {
      await syncRecentsFromServer(null);
      await syncRecentsFromServer(undefined);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// Task #2098 — Pin/unpin/remove rules from Task #2078. Each test installs
// its own fetch stub so the fire-and-forget POST/DELETE in the production
// code can't punch through into a real network request during the suite.
function silentFetch(): () => void {
  return withFetch(vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
}

function seedEntries(entries: RecentTakeoffEntry[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function makeEntry(
  overrides: Partial<RecentTakeoffEntry> & Pick<RecentTakeoffEntry, "entityId" | "entityCode">,
): RecentTakeoffEntry {
  return {
    kind: "bid",
    sheetId: null,
    sheetName: null,
    entityName: null,
    openedAt: 1_000,
    pinnedAt: null,
    hidden: false,
    ...overrides,
  };
}

describe("recordRecent (pin/hide preservation)", () => {
  it("preserves an existing entry's pinnedAt when re-recording it", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({
          entityId: "bid-1",
          entityCode: "B-1",
          entityName: "Old Name",
          openedAt: 1_000,
          pinnedAt: 500,
        }),
      ]);

      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        entityName: "New Name",
        openedAt: 9_000,
      });

      const stored = readRecents(USER_ID);
      expect(stored).toHaveLength(1);
      expect(stored[0].pinnedAt).toBe(500);
      expect(stored[0].openedAt).toBe(9_000);
      expect(stored[0].entityName).toBe("New Name");
      expect(stored[0].hidden).toBe(false);
    } finally {
      restore();
    }
  });

  it("clears `hidden` when a previously-removed entry is re-opened", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({
          entityId: "bid-1",
          entityCode: "B-1",
          openedAt: 1_000,
          hidden: true,
        }),
      ]);

      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        openedAt: 5_000,
      });

      const stored = readRecents(USER_ID);
      expect(stored).toHaveLength(1);
      expect(stored[0].hidden).toBe(false);
      expect(stored[0].openedAt).toBe(5_000);
    } finally {
      restore();
    }
  });

  it("treats different sheetIds on the same entity as distinct rows", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({
          entityId: "bid-1",
          entityCode: "B-1",
          sheetId: "sheet-a",
          openedAt: 1_000,
          pinnedAt: 100,
        }),
      ]);

      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        sheetId: "sheet-b",
        openedAt: 2_000,
      });

      const stored = readRecents(USER_ID);
      expect(stored).toHaveLength(2);
      const sheetA = stored.find((e) => e.sheetId === "sheet-a");
      const sheetB = stored.find((e) => e.sheetId === "sheet-b");
      // The pinned sheet-a row is untouched.
      expect(sheetA?.pinnedAt).toBe(100);
      // The new sheet-b row is fresh and unpinned.
      expect(sheetB?.pinnedAt).toBeNull();
      expect(sheetB?.openedAt).toBe(2_000);
    } finally {
      restore();
    }
  });
});

describe("pinRecent / unpinRecent", () => {
  it("only pins the entry matching the (kind, entityId, sheetId) tuple", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({ entityId: "bid-1", entityCode: "B-1", sheetId: null, openedAt: 1_000 }),
        makeEntry({ entityId: "bid-1", entityCode: "B-1", sheetId: "sheet-a", openedAt: 2_000 }),
        makeEntry({ kind: "project", entityId: "bid-1", entityCode: "P-1", sheetId: null, openedAt: 3_000 }),
        makeEntry({ entityId: "bid-2", entityCode: "B-2", sheetId: null, openedAt: 4_000 }),
      ]);

      pinRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });

      const stored = readRecents(USER_ID);
      const pinned = stored.filter((e) => e.pinnedAt);
      expect(pinned).toHaveLength(1);
      expect(pinned[0]).toMatchObject({
        kind: "bid",
        entityId: "bid-1",
        sheetId: null,
      });
      // The same bid on a different sheet, the project sharing the id, and
      // the unrelated bid are all left alone.
      expect(stored.find((e) => e.entityId === "bid-1" && e.sheetId === "sheet-a")?.pinnedAt).toBeNull();
      expect(stored.find((e) => e.kind === "project")?.pinnedAt).toBeNull();
      expect(stored.find((e) => e.entityId === "bid-2")?.pinnedAt).toBeNull();
    } finally {
      restore();
    }
  });

  it("clears `hidden` when an entry is pinned", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({
          entityId: "bid-1",
          entityCode: "B-1",
          openedAt: 1_000,
          hidden: true,
        }),
      ]);

      pinRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });

      const stored = readRecents(USER_ID);
      expect(stored[0].pinnedAt).not.toBeNull();
      expect(stored[0].hidden).toBe(false);
    } finally {
      restore();
    }
  });

  it("unpinRecent clears pinnedAt only on the matching tuple", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({ entityId: "bid-1", entityCode: "B-1", sheetId: null, openedAt: 1_000, pinnedAt: 100 }),
        makeEntry({ entityId: "bid-1", entityCode: "B-1", sheetId: "sheet-a", openedAt: 2_000, pinnedAt: 200 }),
      ]);

      unpinRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });

      const stored = readRecents(USER_ID);
      const noSheet = stored.find((e) => e.sheetId === null);
      const withSheet = stored.find((e) => e.sheetId === "sheet-a");
      expect(noSheet?.pinnedAt).toBeNull();
      expect(withSheet?.pinnedAt).toBe(200);
    } finally {
      restore();
    }
  });
});

describe("removeRecent", () => {
  it("sets hidden = true, unpins, and survives a reload", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({
          entityId: "bid-1",
          entityCode: "B-1",
          openedAt: 1_000,
          pinnedAt: 100,
        }),
      ]);

      removeRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });

      // Re-read straight from storage to simulate a reload.
      const stored = readRecents(USER_ID);
      expect(stored).toHaveLength(1);
      expect(stored[0].hidden).toBe(true);
      expect(stored[0].pinnedAt).toBeNull();
    } finally {
      restore();
    }
  });

  it("re-recording a removed entry brings it back (hidden cleared)", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({
          entityId: "bid-1",
          entityCode: "B-1",
          openedAt: 1_000,
        }),
      ]);

      removeRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });
      expect(readRecents(USER_ID)[0].hidden).toBe(true);

      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        openedAt: 5_000,
      });

      const stored = readRecents(USER_ID);
      expect(stored).toHaveLength(1);
      expect(stored[0].hidden).toBe(false);
      expect(stored[0].openedAt).toBe(5_000);
    } finally {
      restore();
    }
  });

  it("issues a DELETE to the server so other devices stay in sync", async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const restore = withFetch(fetchMock);
    try {
      seedEntries([
        makeEntry({ entityId: "bid-1", entityCode: "B-1", openedAt: 1_000 }),
      ]);

      removeRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });
      // Allow the fire-and-forget DELETE to settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/takeoff/recents");
      expect((init as RequestInit).method).toBe("DELETE");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({ kind: "bid", entityId: "bid-1", sheetId: null });
    } finally {
      restore();
    }
  });
});

describe("storage cap", () => {
  it("only evicts unpinned entries when the 24-entry cap is exceeded", () => {
    const restore = silentFetch();
    try {
      // Seed three pinned entries plus 24 unpinned ones, ordered with the
      // freshest unpinned first so we can verify which one falls off the
      // bottom when a new write pushes the rail past the cap.
      const pinned: RecentTakeoffEntry[] = [
        makeEntry({ entityId: "pin-1", entityCode: "PN-1", openedAt: 100, pinnedAt: 100 }),
        makeEntry({ entityId: "pin-2", entityCode: "PN-2", openedAt: 200, pinnedAt: 200 }),
        makeEntry({ entityId: "pin-3", entityCode: "PN-3", openedAt: 300, pinnedAt: 300 }),
      ];
      const unpinned: RecentTakeoffEntry[] = Array.from({ length: 24 }, (_, i) =>
        makeEntry({
          entityId: `bid-${i}`,
          entityCode: `B-${i}`,
          // Larger i => older entry (so the new write becomes the freshest).
          openedAt: 10_000 - i,
        }),
      );
      seedEntries([...pinned, ...unpinned]);

      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-new",
        entityCode: "B-NEW",
        openedAt: 99_999,
      });

      const stored = readRecents(USER_ID);
      const storedPinned = stored.filter((e) => e.pinnedAt);
      const storedUnpinned = stored.filter((e) => !e.pinnedAt);

      // All three pinned entries are still present.
      expect(storedPinned).toHaveLength(3);
      expect(storedPinned.map((e) => e.entityId).sort()).toEqual(["pin-1", "pin-2", "pin-3"]);

      // Unpinned bucket is capped at 24 — so the new entry pushes the
      // oldest unpinned entry off the bottom (bid-23, openedAt 9_977),
      // not any pinned entry.
      expect(storedUnpinned).toHaveLength(24);
      expect(storedUnpinned.find((e) => e.entityId === "bid-new")).toBeDefined();
      expect(storedUnpinned.find((e) => e.entityId === "bid-23")).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("never evicts pinned entries even if many more than 24 exist", () => {
    const restore = silentFetch();
    try {
      const pinned: RecentTakeoffEntry[] = Array.from({ length: 30 }, (_, i) =>
        makeEntry({
          entityId: `pin-${i}`,
          entityCode: `PN-${i}`,
          openedAt: 1_000 + i,
          pinnedAt: 1_000 + i,
        }),
      );
      seedEntries(pinned);

      recordRecent(USER_ID, {
        kind: "bid",
        entityId: "bid-new",
        entityCode: "B-NEW",
        openedAt: 99_999,
      });

      const stored = readRecents(USER_ID);
      // All 30 pinned entries plus the one new unpinned entry.
      expect(stored.filter((e) => e.pinnedAt)).toHaveLength(30);
      expect(stored.filter((e) => !e.pinnedAt)).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("useRecentTakeoffs", () => {
  it("returns pinned entries separately and only applies the limit to the recents bucket", () => {
    const restore = silentFetch();
    try {
      const pinned: RecentTakeoffEntry[] = [
        makeEntry({ entityId: "pin-1", entityCode: "PN-1", openedAt: 100, pinnedAt: 100 }),
        makeEntry({ entityId: "pin-2", entityCode: "PN-2", openedAt: 200, pinnedAt: 200 }),
        makeEntry({ entityId: "pin-3", entityCode: "PN-3", openedAt: 300, pinnedAt: 300 }),
        makeEntry({ entityId: "pin-4", entityCode: "PN-4", openedAt: 400, pinnedAt: 400 }),
      ];
      const unpinned: RecentTakeoffEntry[] = Array.from({ length: 8 }, (_, i) =>
        makeEntry({
          entityId: `bid-${i}`,
          entityCode: `B-${i}`,
          openedAt: 1_000 + i,
        }),
      );
      seedEntries([...pinned, ...unpinned]);

      const { result } = renderHook(() => useRecentTakeoffs(USER_ID, 3));

      // Pinned bucket includes every pinned entry (4), sorted newest-pinned-first.
      expect(result.current.pinned).toHaveLength(4);
      expect(result.current.pinned.map((e) => e.entityId)).toEqual([
        "pin-4",
        "pin-3",
        "pin-2",
        "pin-1",
      ]);

      // Recents bucket is capped at the requested limit (3) and is sorted
      // by openedAt desc — the freshest 3 unpinned entries only.
      expect(result.current.recent).toHaveLength(3);
      expect(result.current.recent.map((e) => e.entityId)).toEqual([
        "bid-7",
        "bid-6",
        "bid-5",
      ]);
      // No pinned entry leaks into the recents bucket.
      expect(result.current.recent.every((e) => !e.pinnedAt)).toBe(true);
    } finally {
      restore();
    }
  });

  it("hides removed entries from both pinned and recent buckets", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({ entityId: "bid-1", entityCode: "B-1", openedAt: 1_000 }),
        makeEntry({ entityId: "bid-2", entityCode: "B-2", openedAt: 2_000, hidden: true }),
        makeEntry({
          entityId: "bid-3",
          entityCode: "B-3",
          openedAt: 3_000,
          pinnedAt: 100,
          hidden: true,
        }),
      ]);

      const { result } = renderHook(() => useRecentTakeoffs(USER_ID));

      expect(result.current.pinned).toHaveLength(0);
      expect(result.current.recent).toHaveLength(1);
      expect(result.current.recent[0].entityId).toBe("bid-1");
    } finally {
      restore();
    }
  });

  it("re-renders when an entry is pinned via the imperative API", () => {
    const restore = silentFetch();
    try {
      seedEntries([
        makeEntry({ entityId: "bid-1", entityCode: "B-1", openedAt: 1_000 }),
      ]);

      const { result } = renderHook(() => useRecentTakeoffs(USER_ID));
      expect(result.current.pinned).toHaveLength(0);
      expect(result.current.recent).toHaveLength(1);

      act(() => {
        pinRecent(USER_ID, { kind: "bid", entityId: "bid-1", sheetId: null });
      });

      expect(result.current.pinned).toHaveLength(1);
      expect(result.current.recent).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
