// @vitest-environment jsdom
/**
 * Task #2724 — Automated tests for the "Estimate updated" notice in
 * `<AiEstimatorChatPanel />` covering both `lineItemsRevision` and the
 * newly added `measurementsRevision` prop.
 *
 * Cases covered (for each prop):
 *   1. Notice does NOT appear on the very first render (rev 0 → nothing).
 *   2. Notice does NOT appear when the prop is undefined.
 *   3. Incrementing the prop causes the notice to appear.
 *   4. Re-rendering with the same value keeps the notice visible (no toggle-off).
 *   5. Clicking the ✕ dismiss button hides the notice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

// ── Hoisted spies (must be declared before vi.mock factories are evaluated) ──

const { toastSpy, invalidateSpy } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  invalidateSpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: invalidateSpy },
}));

// ── Lazy imports (after mocks are wired) ─────────────────────────────────────

import { useQuery, useMutation } from "@tanstack/react-query";
import AiEstimatorChatPanel from "../AiEstimatorChatPanel";

const useQueryMock = useQuery as ReturnType<typeof vi.fn>;
const useMutationMock = useMutation as ReturnType<typeof vi.fn>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION = {
  id: "session-1",
  title: null,
  bidId: "bid-1",
  estimateId: null,
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const MESSAGE = {
  id: "msg-1",
  role: "assistant" as const,
  content: "Here is my analysis of your estimate.",
  citations: null,
  attachments: null,
  feedbackOutcome: null,
  sessionId: "session-1",
  createdAt: "2024-01-01T00:00:00.000Z",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Set up useQuery and useMutation stubs.
 *
 * useQuery — returns a pre-existing session (so the component never calls
 * `createSession.mutate`) and one prior message (so the proactive opener
 * effect is skipped because msgs.length > 0).
 *
 * useMutation — each mutate() immediately calls onSuccess so that
 * sendTurn's onSuccess (which calls setShowUpdateNotice(false)) fires
 * synchronously inside an `act()` block.
 */
function setupMocks() {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    const isSessions =
      queryKey[0] === "/api/ai-estimator/chat/sessions" && queryKey.length === 1;
    if (isSessions) {
      return { isLoading: false, data: { sessions: [SESSION] } };
    }
    return { isLoading: false, data: { session: SESSION, messages: [MESSAGE] } };
  });

  useMutationMock.mockImplementation(
    (opts: { onSuccess?: (...args: unknown[]) => void } = {}) => ({
      mutate: vi.fn((...args: unknown[]) => {
        if (opts.onSuccess) opts.onSuccess(...args);
      }),
      isPending: false,
    }),
  );
}

// ── Suite — measurementsRevision ─────────────────────────────────────────────

describe("AiEstimatorChatPanel — estimate-updated notice (measurementsRevision)", () => {
  beforeEach(() => {
    setupMocks();
    toastSpy.mockReset();
    invalidateSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not show the notice on initial render when measurementsRevision is 0", () => {
    render(<AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={0} />);
    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });

  it("does not show the notice on initial render when measurementsRevision is undefined", () => {
    render(<AiEstimatorChatPanel enabled bidId="bid-1" />);
    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });

  it("shows the notice when measurementsRevision increments after the initial mount", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={0} />,
    );

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={1} />);
    });

    const notice = screen.getByTestId("chat-estimate-updated-notice");
    expect(notice).toBeTruthy();
    expect(notice.textContent).toMatch(/estimate updated/i);
  });

  it("does not toggle off the notice when re-rendered with the same measurementsRevision", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={1} />,
    );

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={2} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={2} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
  });

  it("hides the notice when the ✕ dismiss button is clicked (measurementsRevision)", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={0} />,
    );

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={1} />);
    });

    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();

    act(() => {
      screen.getByTestId("button-dismiss-update-notice").click();
    });

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });

  it("shows the notice when measurementsRevision increments from a non-zero baseline", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={5} />,
    );

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" measurementsRevision={6} />);
    });

    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
    expect(screen.getByTestId("chat-estimate-updated-notice").textContent).toMatch(
      /estimate updated/i,
    );
  });
});

// ── Suite — lineItemsRevision (parallel coverage) ─────────────────────────────

describe("AiEstimatorChatPanel — estimate-updated notice (lineItemsRevision)", () => {
  beforeEach(() => {
    setupMocks();
    toastSpy.mockReset();
    invalidateSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not show the notice on initial render when lineItemsRevision is 0", () => {
    render(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={0} />);
    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });

  it("does not show the notice on initial render when lineItemsRevision is undefined", () => {
    render(<AiEstimatorChatPanel enabled bidId="bid-1" />);
    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });

  it("shows the notice when lineItemsRevision increments after the initial mount", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={0} />,
    );

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={1} />);
    });

    const notice = screen.getByTestId("chat-estimate-updated-notice");
    expect(notice).toBeTruthy();
    expect(notice.textContent).toMatch(/estimate updated/i);
  });

  it("does not toggle off the notice when re-rendered with the same lineItemsRevision", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={1} />,
    );

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={2} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={2} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
  });

  it("hides the notice when the ✕ dismiss button is clicked (lineItemsRevision)", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={0} />,
    );

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={1} />);
    });

    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();

    act(() => {
      screen.getByTestId("button-dismiss-update-notice").click();
    });

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });

  it("shows the notice when lineItemsRevision increments from a non-zero baseline", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={3} />,
    );

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();

    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={4} />);
    });

    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
    expect(screen.getByTestId("chat-estimate-updated-notice").textContent).toMatch(
      /estimate updated/i,
    );
  });
});

// ── Cross-prop interaction ────────────────────────────────────────────────────

describe("AiEstimatorChatPanel — estimate-updated notice (cross-prop)", () => {
  beforeEach(() => {
    setupMocks();
    toastSpy.mockReset();
    invalidateSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the notice when only measurementsRevision increments while lineItemsRevision is stable", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={0} measurementsRevision={0} />,
    );

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();

    act(() => {
      rerender(
        <AiEstimatorChatPanel
          enabled
          bidId="bid-1"
          lineItemsRevision={0}
          measurementsRevision={1}
        />,
      );
    });

    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
    expect(screen.getByTestId("chat-estimate-updated-notice").textContent).toMatch(
      /estimate updated/i,
    );
  });

  it("shows the notice when only lineItemsRevision increments while measurementsRevision is stable", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={0} measurementsRevision={0} />,
    );

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();

    act(() => {
      rerender(
        <AiEstimatorChatPanel
          enabled
          bidId="bid-1"
          lineItemsRevision={1}
          measurementsRevision={0}
        />,
      );
    });

    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
    expect(screen.getByTestId("chat-estimate-updated-notice").textContent).toMatch(
      /estimate updated/i,
    );
  });
});
