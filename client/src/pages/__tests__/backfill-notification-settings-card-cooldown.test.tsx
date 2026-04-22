// @vitest-environment jsdom
/**
 * Task #1081 — frontend regression that the "Send test alert" button on the
 * admin transcript backfill notification settings card actually consumes the
 * 429 cooldown contract pinned by Task #1073's server test
 * (`server/__tests__/crm-transcript-backfill-test-alert-cooldown.test.ts`).
 *
 * Documented 429 contract:
 *   HTTP 429 + Retry-After header, JSON body shape
 *     { error, cooldownSeconds, retryAfterSeconds, nextAllowedAt }
 *
 * After the mutation hits 429, the card invalidates the
 * `/test-alert/latest` query, which re-reads `nextAllowedAt` from the
 * server. This test pins that the button:
 *   • disables itself while `nextAllowedAt` is in the future,
 *   • surfaces the remaining seconds via the button's `title` tooltip and
 *     the `text-test-alert-cooldown` helper, and
 *   • re-enables once wall-clock time crosses `nextAllowedAt` (the
 *     component schedules a `setTimeout` at `nextAllowedAt` that
 *     invalidates the cooldown query so the next refetch sees the
 *     server-side window cleared).
 *
 * Mirrors the mocking pattern of
 * `backfill-notification-settings-card.test.tsx` so we exercise the real
 * component with a minimal in-test API surface.
 *
 * Task #1129 — uses Vitest fake timers (including a faked `Date`) so the
 * cooldown re-enable assertion no longer waits the full 2 wall-clock
 * seconds. We pair `vi.advanceTimersByTimeAsync` with `act()` so React
 * Query's microtask-driven refetches still flush between timer advances,
 * keeping the test deterministic and sub-second. The pattern (faked
 * timers + `advanceTimersByTimeAsync` inside `act`) is reusable for any
 * other React Query timing test on this page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const COOLDOWN_SECONDS = 2;
const TEST_ALERT_LATEST_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert/latest";
const TEST_ALERT_POST_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert";
const NOTIFICATION_SETTINGS_PATH =
  "/api/crm/calls/transcripts/backfill/notification-settings";

type CooldownState = {
  latest: null;
  cooldownSeconds: number;
  nextAllowedAt: string | null;
};

let cooldownState: CooldownState = {
  latest: null,
  cooldownSeconds: COOLDOWN_SECONDS,
  nextAllowedAt: null,
};

const { mockApiRequest, mockToast, sharedClient } = vi.hoisted(() => {
  // Holder shared between the `@/lib/queryClient` mock factory (which
  // initializes the instance lazily) and `makeClient()` below (which swaps
  // in the QueryClient that React Query renders against). Typed as a
  // mutable ref to avoid an `any` cast.
  const holder: { current: QueryClient | null } = { current: null };
  return {
    mockApiRequest: vi.fn(),
    mockToast: vi.fn(),
    sharedClient: holder,
  };
});

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  if (!sharedClient.current) {
    sharedClient.current = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }
  return {
    apiRequest: mockApiRequest,
    // The card calls `queryClient.invalidateQueries(...)` on this exported
    // instance from inside its mutation handlers. We swap in the same
    // QueryClient that React Query renders against (see `renderCard`) so
    // the invalidate actually triggers a refetch of the cooldown query.
    get queryClient() {
      return sharedClient.current;
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { BackfillNotificationSettingsCard } from "../admin-transcript-backfill";

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const path = Array.isArray(queryKey) ? queryKey[0] : queryKey;
          if (path === TEST_ALERT_LATEST_PATH) {
            return cooldownState;
          }
          if (path === NOTIFICATION_SETTINGS_PATH) {
            return {
              slackWebhookUrl: "https://hooks.slack.com/services/ORG",
              emailRecipients: ["alerts@example.com"],
              updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
              lastTestAt: null,
              lastTestResult: null,
            };
          }
          return null;
        },
      },
      mutations: { retry: false },
    },
  });
  sharedClient.current = client;
  return client;
}

function renderCard() {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <BackfillNotificationSettingsCard />
    </QueryClientProvider>,
  );
}

// Drain pending fake timers + microtasks inside an `act()` so React
// Query's async refetches and React's render commits both settle before
// the next assertion. Wrapping `advanceTimersByTimeAsync` in `act` is the
// reusable bit other React Query timing tests on this page can copy.
async function flushAsync(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
  cooldownState = {
    latest: null,
    cooldownSeconds: COOLDOWN_SECONDS,
    nextAllowedAt: null,
  };
  cleanup();
  // Fake the timer surface the cooldown actually uses (setTimeout +
  // setInterval + Date) and leave everything else — most importantly
  // `queueMicrotask` and React's scheduling primitives — real so React
  // Query's Promise-based refetch chain and React 18's scheduler keep
  // working between virtual ticks.
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
    shouldAdvanceTime: false,
  });
  vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BackfillNotificationSettingsCard — Send test alert cooldown (Task #1081)", () => {
  it("disables the button with a countdown tooltip after a 429 response and re-enables it once nextAllowedAt passes", async () => {
    // Simulate the documented 429 contract on POST /test-alert: flip
    // the "server-side" cooldown state and throw the same Error shape
    // the real `apiRequest` would have raised from the JSON `error`
    // field of a 429 body.
    mockApiRequest.mockImplementation(
      async (method: string, url: string) => {
        if (method === "POST" && url === TEST_ALERT_POST_PATH) {
          const nextAllowedAt = new Date(
            Date.now() + COOLDOWN_SECONDS * 1000,
          ).toISOString();
          const body = {
            error: `Test alerts are rate-limited to one every ${COOLDOWN_SECONDS} seconds per organization. Try again in ${COOLDOWN_SECONDS}s.`,
            cooldownSeconds: COOLDOWN_SECONDS,
            retryAfterSeconds: COOLDOWN_SECONDS,
            nextAllowedAt,
          };
          // Mirror what the server would have written: subsequent GETs
          // to `/test-alert/latest` now report an active window.
          cooldownState = {
            latest: null,
            cooldownSeconds: COOLDOWN_SECONDS,
            nextAllowedAt,
          };
          throw new Error(body.error);
        }
        return new Response("{}", { status: 200 }) as unknown as Response;
      },
    );

    renderCard();
    // Drain the initial cooldown/notification-settings queries.
    await flushAsync();

    const button = screen.getByTestId(
      "button-send-test-alert",
    ) as HTMLButtonElement;
    // Button starts enabled — the cooldown query initially reports no
    // active window.
    expect(button.disabled).toBe(false);

    // Use `fireEvent.click` instead of `userEvent.click`: userEvent v14
    // schedules its own internal pacing setTimeouts that, even with
    // `delay: null` and an `advanceTimers` shim, deadlock against
    // Vitest's faked-timer scheduling. `fireEvent` dispatches the click
    // synchronously, and the surrounding `act` lets React flush the
    // resulting state updates.
    await act(async () => {
      fireEvent.click(button);
    });
    // Let the mutation reject → onError invalidate → cooldown refetch
    // → React commit cycle settle.
    await flushAsync();

    // After the mutation's `onError` invalidates the cooldown query
    // and the refetch returns the freshly-set `nextAllowedAt`, the
    // button disables and a destructive toast is fired.
    expect(button.disabled).toBe(true);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Failed to send test alert",
        variant: "destructive",
      }),
    );

    // The cooldown helper text and the button's tooltip both surface
    // the remaining seconds so admins know exactly when they can
    // retry.
    const helper = screen.getByTestId("text-test-alert-cooldown");
    expect(helper.textContent ?? "").toMatch(/Available again in \d+s/);
    const tooltip = button.getAttribute("title") ?? "";
    expect(tooltip).toMatch(/Rate-limited/i);
    expect(tooltip).toMatch(/try again in \d+s/i);

    // Once the cooldown window elapses the component schedules a
    // refetch; with the "server-side" state cleared, the button must
    // re-enable and the helper text must disappear. Clearing the
    // mocked state *before* advancing fake time ensures the component's
    // scheduled `setTimeout(invalidateQueries, ...)` refetches against
    // a clean window.
    cooldownState = {
      latest: null,
      cooldownSeconds: COOLDOWN_SECONDS,
      nextAllowedAt: null,
    };
    // Advance past the cooldown window plus the 250ms buffer the
    // component adds to its `setTimeout`. Microtasks (the refetch
    // Promise chain) still drain between virtual ticks.
    await flushAsync(COOLDOWN_SECONDS * 1000 + 500);

    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("text-test-alert-cooldown")).toBeNull();
    expect(button.getAttribute("title") ?? "").not.toMatch(/Rate-limited/i);
  });
});
