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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Use a deliberately short cooldown so the re-enable assertion can be
// driven by real wall-clock time without slowing the suite down.
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

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
  cooldownState = {
    latest: null,
    cooldownSeconds: COOLDOWN_SECONDS,
    nextAllowedAt: null,
  };
  cleanup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BackfillNotificationSettingsCard — Send test alert cooldown (Task #1081)", () => {
  it(
    "disables the button with a countdown tooltip after a 429 response and re-enables it once nextAllowedAt passes",
    async () => {
      const user = userEvent.setup();

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

      const button = (await screen.findByTestId(
        "button-send-test-alert",
      )) as HTMLButtonElement;
      // Button starts enabled — the cooldown query initially reports no
      // active window.
      await waitFor(() => expect(button.disabled).toBe(false));

      await user.click(button);

      // After the mutation's `onError` invalidates the cooldown query
      // and the refetch returns the freshly-set `nextAllowedAt`, the
      // button disables and a destructive toast is fired.
      await waitFor(() => expect(button.disabled).toBe(true));
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to send test alert",
          variant: "destructive",
        }),
      );

      // The cooldown helper text and the button's tooltip both surface
      // the remaining seconds so admins know exactly when they can
      // retry.
      const helper = await screen.findByTestId("text-test-alert-cooldown");
      expect(helper.textContent ?? "").toMatch(/Available again in \d+s/);
      const tooltip = button.getAttribute("title") ?? "";
      expect(tooltip).toMatch(/Rate-limited/i);
      expect(tooltip).toMatch(/try again in \d+s/i);

      // Once the cooldown window elapses the component schedules a
      // refetch; with the "server-side" state cleared, the button must
      // re-enable and the helper text must disappear.
      cooldownState = {
        latest: null,
        cooldownSeconds: COOLDOWN_SECONDS,
        nextAllowedAt: null,
      };
      await waitFor(
        () => {
          expect(button.disabled).toBe(false);
        },
        { timeout: COOLDOWN_SECONDS * 1000 + 3000, interval: 100 },
      );
      expect(screen.queryByTestId("text-test-alert-cooldown")).toBeNull();
      expect(button.getAttribute("title") ?? "").not.toMatch(/Rate-limited/i);
    },
    15000,
  );
});
