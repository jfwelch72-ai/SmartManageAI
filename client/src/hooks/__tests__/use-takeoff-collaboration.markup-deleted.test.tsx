// @vitest-environment jsdom
/**
 * Task #1971 — When the server broadcasts a `MARKUP_DELETED` collab
 * event (a teammate removed one or more markups via the single or
 * bulk DELETE route), `useTakeoffCollaboration` must surgically
 * remove those ids from the active sheet's `markups` query cache so
 * the canvas refreshes in seconds instead of waiting for the next
 * failed PATCH to discover the row is gone (#1837 fallback path).
 *
 * It must also forward the deleted ids to the workspace via the
 * `onMarkupDeleted` callback so the workspace can prune its local
 * selection set — mirroring the `pruneSelectedMarkupIds` wiring the
 * #1837 not_found path uses.
 *
 * These tests lock in:
 *   1. A `MARKUP_DELETED` message removes only the affected ids from
 *      the cached markups list (siblings stay).
 *   2. The `onMarkupDeleted` callback is invoked exactly once with
 *      the same sheetId + ids the server sent.
 *   3. A malformed payload (missing sheetId or empty markupIds) is a
 *      safe no-op — no callback fires, no cache mutation happens.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  // The hook calls `queryClient.setQueryData` directly (not via the
  // <QueryClientProvider> wrapper below) so the test exposes the same
  // instance for seeding and assertion.
  const queryClient = new actual.QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { useTakeoffCollaboration } from "../use-takeoff-collaboration";
import { queryClient as mockedQueryClient } from "@/lib/queryClient";

const ROOM_ID = "bid-room-1";
const SHEET_ID = "sheet-1";
const MARKUPS_KEY = ["/api/takeoff/sheets", SHEET_ID, "markups"];

/**
 * Minimal WebSocket stand-in that exposes the real-WebSocket lifecycle
 * surface the hook touches (onopen / onmessage / onclose / onerror /
 * readyState / send / close) plus a `_dispatch(msg)` helper so tests
 * can simulate a server-pushed broadcast without spinning up a real
 * server. Mirrors how the existing hook is exercised in production —
 * `ws.onmessage` is the only ingress for collab events.
 */
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.({});
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  /** Simulate a server-pushed message reaching the client. */
  _dispatch(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const seedMarkupsCache = (markups: Array<{ id: string }>) => {
  mockedQueryClient.setQueryData(MARKUPS_KEY, markups);
};

const readCachedMarkups = () =>
  mockedQueryClient.getQueryData<Array<{ id: string }>>(MARKUPS_KEY) ?? [];

beforeEach(() => {
  toastMock.mockReset();
  mockedQueryClient.clear();
  MockWebSocket.instances = [];
  // jsdom doesn't ship a WebSocket — install the mock for every test.
  (globalThis as any).WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Task #1971 — useTakeoffCollaboration prunes deleted markups on MARKUP_DELETED", () => {
  it("removes the broadcast ids from the cached markups list and invokes onMarkupDeleted", async () => {
    seedMarkupsCache([
      { id: "m-deleted-by-teammate" },
      { id: "m-survives-1" },
      { id: "m-survives-2" },
    ]);

    const onMarkupDeleted = vi.fn();
    renderHook(
      () =>
        useTakeoffCollaboration({
          roomId: ROOM_ID,
          selectedSheet: SHEET_ID,
          currentUserId: "viewer-1",
          onMarkupDeleted,
        }),
      { wrapper: makeWrapper() },
    );

    // Wait for the WebSocket to be constructed by the connect effect.
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws._dispatch({
        type: "MARKUP_DELETED",
        payload: {
          sheetId: SHEET_ID,
          markupIds: ["m-deleted-by-teammate"],
        },
        senderId: "deleter-2",
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached.find((m) => m.id === "m-deleted-by-teammate")).toBeUndefined();
      expect(cached.find((m) => m.id === "m-survives-1")).toBeDefined();
      expect(cached.find((m) => m.id === "m-survives-2")).toBeDefined();
    });

    expect(onMarkupDeleted).toHaveBeenCalledTimes(1);
    expect(onMarkupDeleted).toHaveBeenCalledWith(SHEET_ID, [
      "m-deleted-by-teammate",
    ]);
  });

  it("handles a multi-id (bulk) MARKUP_DELETED broadcast in one pass", async () => {
    seedMarkupsCache([
      { id: "m-1" },
      { id: "m-2" },
      { id: "m-3" },
      { id: "m-4" },
    ]);

    const onMarkupDeleted = vi.fn();
    renderHook(
      () =>
        useTakeoffCollaboration({
          roomId: ROOM_ID,
          selectedSheet: SHEET_ID,
          currentUserId: "viewer-1",
          onMarkupDeleted,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws._dispatch({
        type: "MARKUP_DELETED",
        payload: {
          sheetId: SHEET_ID,
          markupIds: ["m-1", "m-3"],
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      const cached = readCachedMarkups();
      const ids = cached.map((m) => m.id).sort();
      expect(ids).toEqual(["m-2", "m-4"]);
    });

    expect(onMarkupDeleted).toHaveBeenCalledTimes(1);
    expect(onMarkupDeleted).toHaveBeenCalledWith(SHEET_ID, ["m-1", "m-3"]);
  });

  it("ignores a malformed broadcast (missing sheetId or empty ids) — no cache mutation, no callback", async () => {
    seedMarkupsCache([{ id: "m-1" }, { id: "m-2" }]);

    const onMarkupDeleted = vi.fn();
    renderHook(
      () =>
        useTakeoffCollaboration({
          roomId: ROOM_ID,
          selectedSheet: SHEET_ID,
          currentUserId: "viewer-1",
          onMarkupDeleted,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });
    const ws = MockWebSocket.instances[0];

    // Missing sheetId
    act(() => {
      ws._dispatch({
        type: "MARKUP_DELETED",
        payload: { markupIds: ["m-1"] },
      });
    });
    // Empty ids
    act(() => {
      ws._dispatch({
        type: "MARKUP_DELETED",
        payload: { sheetId: SHEET_ID, markupIds: [] },
      });
    });
    // Non-array ids
    act(() => {
      ws._dispatch({
        type: "MARKUP_DELETED",
        payload: { sheetId: SHEET_ID, markupIds: "m-1" as any },
      });
    });

    // Cache and callback both untouched.
    const cached = readCachedMarkups();
    expect(cached.map((m) => m.id).sort()).toEqual(["m-1", "m-2"]);
    expect(onMarkupDeleted).not.toHaveBeenCalled();
  });
});
