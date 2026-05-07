// @vitest-environment jsdom
/**
 * Task #2531 — Lock down the contract for `useJobProgress`, the hook
 * that turns `__jobProgress` SSE events emitted by
 * `server/jobQueue/index.ts → publishJobProgress` into the live
 * progress bar shown across every AI feature that adopts it.
 *
 * The hook subscribes to `message_new` events on the shared
 * GlobalSSE connection and surfaces a `{ status, progress, message }`
 * tuple for the given job id. These tests exercise the public
 * surface by driving a fake GlobalSSE provider with synthetic
 * `MessageEvent`s — exactly the shape the real SSE bus delivers.
 *
 * Cases covered:
 *   1. Idle state when no jobId is provided (and on transition back
 *      to null after running).
 *   2. First matching event flips state to `running` with the
 *      reported progress.
 *   3. Events for unrelated job ids are ignored, as are non
 *      `__jobProgress` payloads and malformed JSON.
 *   4. A `completed` event clamps progress to 100.
 *   5. A `failed` event surfaces the failure message.
 */
import React, { type ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Listener = (e: MessageEvent) => void;

const listeners = new Map<string, Set<Listener>>();

function addListener(eventType: string, cb: Listener) {
  if (!listeners.has(eventType)) listeners.set(eventType, new Set());
  listeners.get(eventType)!.add(cb);
}

function removeListener(eventType: string, cb: Listener) {
  listeners.get(eventType)?.delete(cb);
}

function emit(eventType: string, data: unknown) {
  const evt = new MessageEvent(eventType, {
    data: typeof data === "string" ? data : JSON.stringify(data),
  });
  for (const cb of listeners.get(eventType) ?? []) cb(evt);
}

vi.mock("@/contexts/GlobalSSEContext", () => ({
  useGlobalSSE: () => ({
    addListener,
    removeListener,
    isConnected: true,
  }),
}));

import { useJobProgress } from "../use-job-progress";

const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

describe("useJobProgress", () => {
  beforeEach(() => {
    listeners.clear();
  });

  it("stays idle when no jobId is provided", () => {
    const { result } = renderHook(() => useJobProgress(null), { wrapper });
    expect(result.current).toEqual({ status: "idle", progress: 0 });

    // Even if a stray progress event fires there is no listener to receive
    // it, so state must remain idle.
    act(() => {
      emit("message_new", {
        __jobProgress: true,
        jobId: "job-x",
        status: "running",
        progress: 50,
      });
    });
    expect(result.current).toEqual({ status: "idle", progress: 0 });
  });

  it("transitions to running on the first matching event", () => {
    const { result } = renderHook(() => useJobProgress("job-1"), { wrapper });

    // Initial subscribed state is running@0 so the UI can show a live bar
    // immediately rather than flashing 'idle' for a tick.
    expect(result.current).toEqual({ status: "running", progress: 0 });

    act(() => {
      emit("message_new", {
        __jobProgress: true,
        jobId: "job-1",
        status: "running",
        progress: 42,
        message: "Crunching plans",
      });
    });

    expect(result.current).toEqual({
      status: "running",
      progress: 42,
      message: "Crunching plans",
    });
  });

  it("ignores events for other jobIds, missing __jobProgress, and bad JSON", () => {
    const { result } = renderHook(() => useJobProgress("job-1"), { wrapper });

    act(() => {
      // Wrong job id.
      emit("message_new", {
        __jobProgress: true,
        jobId: "job-2",
        status: "running",
        progress: 80,
      });
      // Missing __jobProgress flag (regular chat message).
      emit("message_new", {
        conversationId: "conv-1",
        body: "hello",
      });
      // Malformed JSON payload — must be a no-op, not throw.
      emit("message_new", "{not json");
    });

    expect(result.current).toEqual({ status: "running", progress: 0 });
  });

  it("clamps to 100 and marks completed on a completion event", () => {
    const { result } = renderHook(() => useJobProgress("job-1"), { wrapper });

    act(() => {
      emit("message_new", {
        __jobProgress: true,
        jobId: "job-1",
        status: "completed",
        // Server-side rounding can occasionally land on >100; the hook
        // must clamp to a clean 100 either way.
        progress: 97,
      });
    });

    expect(result.current.status).toBe("completed");
    expect(result.current.progress).toBe(100);
  });

  it("transitions to failed and surfaces the failure message", () => {
    const { result } = renderHook(() => useJobProgress("job-1"), { wrapper });

    act(() => {
      emit("message_new", {
        __jobProgress: true,
        jobId: "job-1",
        status: "failed",
        progress: 30,
        message: "Plan parse error",
      });
    });

    expect(result.current).toEqual({
      status: "failed",
      progress: 30,
      message: "Plan parse error",
    });
  });

  it("resets to idle when jobId becomes null", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useJobProgress(id),
      { wrapper, initialProps: { id: "job-1" as string | null } },
    );

    act(() => {
      emit("message_new", {
        __jobProgress: true,
        jobId: "job-1",
        status: "running",
        progress: 25,
      });
    });
    expect(result.current.status).toBe("running");

    rerender({ id: null });
    expect(result.current).toEqual({ status: "idle", progress: 0 });
  });
});
