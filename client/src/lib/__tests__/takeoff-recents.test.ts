// @vitest-environment jsdom
//
// Task #2079 — Cross-device sync for the Takeoff "Recent" rail. These tests
// pin the merge + sync behaviour so a stale local cache can never lose a
// recent the user opened on another device, and so a fresh sign-in on a
// new machine pulls the rail down from the server.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTakeoffRecentsSyncStateForTests,
  readRecents,
  recordRecent,
  syncRecentsFromServer,
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
