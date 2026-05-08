// @vitest-environment jsdom
/**
 * Task #2584 — Lock down the contract for `<PlanSetIngestBanner />`, the
 * persistent banner that drives the background plan-set ingest job
 * (queued → running → completed/failed → retry).
 *
 * Cases covered:
 *   1. Rehydrates from localStorage on mount so the banner survives
 *      navigation back to the bid.
 *   2. Percent reflects live SSE progress emitted by `useJobProgress`.
 *   3. Transitions to "complete" via the polling endpoint (`/api/jobs/:id`).
 *   4. Transitions to "complete" via the SSE feed even if the poll has
 *      not flipped yet.
 *   5. Retry re-enqueues with the original payload and updates storage
 *      to the new job id.
 *   6. Dismiss clears the localStorage entry and unmounts the banner.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

type LiveProgress = {
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  message?: string;
};

let liveProgress: LiveProgress = { status: "running", progress: 0 };
const liveSubscribers = new Set<() => void>();

function setLiveProgress(next: LiveProgress) {
  liveProgress = next;
  for (const cb of liveSubscribers) cb();
}

vi.mock("@/hooks/use-job-progress", () => ({
  useJobProgress: (_jobId: string | null) => {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => {
      liveSubscribers.add(force);
      return () => {
        liveSubscribers.delete(force);
      };
    }, []);
    return liveProgress;
  },
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const apiRequestMock = vi.fn();
const invalidateSpy = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: {
    invalidateQueries: invalidateSpy,
  },
}));

import {
  PlanSetIngestBanner,
  persistIngestJob,
  loadStoredIngestJob,
  type PlanSetIngestPayload,
} from "../PlanSetIngestBanner";

const BID_ID = "bid-abc";
const PAYLOAD: PlanSetIngestPayload = {
  bidId: BID_ID,
  bidDocumentId: "doc-1",
  fileName: "FloorPlans.pdf",
  objectKey: "uploads/floorplans.pdf",
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  liveSubscribers.clear();
  liveProgress = { status: "running", progress: 0 };
  toastSpy.mockReset();
  apiRequestMock.mockReset();
  invalidateSpy.mockReset();
  fetchMock = vi.fn().mockResolvedValue(
    mockFetchResponse({ id: "job-1", state: "active" }),
  );
  // jsdom provides window.fetch by default; replace it with our spy.
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function flushAsync() {
  // Allow microtasks (resolved fetch promises) to settle before timers.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("<PlanSetIngestBanner /> (Task #2584)", () => {
  it("renders nothing when there is no stored job", () => {
    const { container } = render(<PlanSetIngestBanner bidId={BID_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("rehydrates from localStorage on mount", async () => {
    persistIngestJob(BID_ID, {
      jobId: "job-1",
      payload: PAYLOAD,
      startedAt: Date.now(),
    });

    render(<PlanSetIngestBanner bidId={BID_ID} />);
    await flushAsync();

    expect(screen.getByTestId("banner-plan-set-ingest")).toBeTruthy();
    expect(screen.getByTestId("banner-plan-set-ingest-title").textContent).toMatch(
      /FloorPlans\.pdf/,
    );
    // Polling must have hit the jobs endpoint with the rehydrated id.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("reflects live SSE percent updates in the progress label", async () => {
    persistIngestJob(BID_ID, {
      jobId: "job-1",
      payload: PAYLOAD,
      startedAt: Date.now(),
    });

    render(<PlanSetIngestBanner bidId={BID_ID} />);
    await flushAsync();

    act(() => {
      setLiveProgress({ status: "running", progress: 42, message: "Parsing pages" });
    });

    expect(screen.getByTestId("banner-plan-set-ingest-pct").textContent).toBe("42%");
    expect(screen.getByTestId("banner-plan-set-ingest-message").textContent).toBe(
      "Parsing pages",
    );
    expect(
      screen.getByTestId("banner-plan-set-ingest-icon-running"),
    ).toBeTruthy();
  });

  it("transitions to complete when the poll endpoint returns state=completed", async () => {
    persistIngestJob(BID_ID, {
      jobId: "job-1",
      payload: PAYLOAD,
      startedAt: Date.now(),
    });
    fetchMock.mockResolvedValue(
      mockFetchResponse({ id: "job-1", state: "completed" }),
    );

    render(<PlanSetIngestBanner bidId={BID_ID} />);
    await flushAsync();

    await waitFor(() => {
      expect(
        screen.queryByTestId("banner-plan-set-ingest-icon-complete"),
      ).toBeTruthy();
    });
    expect(screen.getByTestId("banner-plan-set-ingest-pct").textContent).toBe("100%");
    expect(screen.getByTestId("banner-plan-set-ingest-message").textContent).toMatch(
      /complete/i,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/bids", BID_ID, "takeoff", "sheets"],
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Plan set ready" }),
    );
  });

  it("transitions to complete via the live SSE feed even before polling reports it", async () => {
    persistIngestJob(BID_ID, {
      jobId: "job-1",
      payload: PAYLOAD,
      startedAt: Date.now(),
    });

    render(<PlanSetIngestBanner bidId={BID_ID} />);
    await flushAsync();

    act(() => {
      setLiveProgress({ status: "completed", progress: 100 });
    });

    expect(
      screen.getByTestId("banner-plan-set-ingest-icon-complete"),
    ).toBeTruthy();
    expect(screen.getByTestId("banner-plan-set-ingest-pct").textContent).toBe("100%");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/bids", BID_ID, "takeoff", "sheets"],
    });
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it("retry re-enqueues with the original payload and stores the new job id", async () => {
    persistIngestJob(BID_ID, {
      jobId: "job-1",
      payload: PAYLOAD,
      startedAt: 1,
    });
    // Polling reports failed so the Retry button is shown.
    fetchMock.mockResolvedValue(
      mockFetchResponse({ id: "job-1", state: "failed" }),
    );
    apiRequestMock.mockResolvedValue({
      json: async () => ({ jobId: "job-2" }),
    });

    render(<PlanSetIngestBanner bidId={BID_ID} />);
    await flushAsync();

    const retryBtn = await waitFor(() =>
      screen.getByTestId("button-plan-set-ingest-retry"),
    );

    await act(async () => {
      retryBtn.click();
      await Promise.resolve();
    });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/takeoff/plan-set-ingest/enqueue",
      PAYLOAD,
    );
    const stored = loadStoredIngestJob(BID_ID);
    expect(stored?.jobId).toBe("job-2");
    expect(stored?.payload).toEqual(PAYLOAD);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Re-enqueued" }),
    );
  });

  it("dismiss clears localStorage and removes the banner", async () => {
    persistIngestJob(BID_ID, {
      jobId: "job-1",
      payload: PAYLOAD,
      startedAt: Date.now(),
    });

    const { container } = render(<PlanSetIngestBanner bidId={BID_ID} />);
    await flushAsync();

    const dismiss = screen.getByTestId("button-plan-set-ingest-dismiss");
    act(() => {
      dismiss.click();
    });

    expect(loadStoredIngestJob(BID_ID)).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
