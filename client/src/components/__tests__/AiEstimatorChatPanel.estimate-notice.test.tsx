// @vitest-environment jsdom
/**
 * Task #2715 — Automated tests for the "estimate updated" notice in
 * `<AiEstimatorChatPanel />`.
 *
 * The banner fires when `lineItemsRevision` changes after the initial
 * mount and clears when the user either dismisses it or sends a chat turn.
 *
 * Cases covered:
 *   1. Notice does NOT appear on the very first render (rev 0 → nothing).
 *   2. Incrementing `lineItemsRevision` causes the notice to appear.
 *   3. Clicking the ✕ dismiss button hides the notice.
 *   4. Sending a chat turn (which succeeds) also hides the notice.
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

// ── Suite ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setupMocks();
  toastSpy.mockReset();
  invalidateSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiEstimatorChatPanel — estimate-updated notice (Task #2715)", () => {
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

  it("does not show the notice again for the same revision value", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={1} />,
    );

    // Change 1 → 2: notice appears.
    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={2} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();

    // Re-render with the same revision: notice stays (no toggle-off).
    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={2} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();
  });

  it("hides the notice when the ✕ dismiss button is clicked", () => {
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

  it("hides the notice when a chat turn is sent successfully", () => {
    const { rerender } = render(
      <AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={0} />,
    );

    // Show the notice.
    act(() => {
      rerender(<AiEstimatorChatPanel enabled bidId="bid-1" lineItemsRevision={1} />);
    });
    expect(screen.getByTestId("chat-estimate-updated-notice")).toBeTruthy();

    // Type something in the draft textarea so `canSend` becomes true.
    act(() => {
      const textarea = screen.getByTestId("input-chat-prompt") as HTMLTextAreaElement;
      textarea.focus();
      // Simulate a controlled-input change so React updates `draft`.
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Any question about this estimate?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Click send — the useMutation mock fires onSuccess synchronously,
    // which calls setShowUpdateNotice(false).
    act(() => {
      screen.getByTestId("button-send-chat").click();
    });

    expect(screen.queryByTestId("chat-estimate-updated-notice")).toBeNull();
  });
});
