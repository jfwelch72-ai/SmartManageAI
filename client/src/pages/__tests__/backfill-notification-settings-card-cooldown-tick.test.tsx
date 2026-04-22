// @vitest-environment jsdom
/**
 * Task #1128 — regression that the "Send test alert" cooldown countdown
 * actually ticks down each second.
 *
 * The Task #1081 sibling test
 * (`backfill-notification-settings-card-cooldown.test.tsx`) only asserts
 * that the helper text and tooltip *include* a positive seconds value
 * after a 429. A regression that froze the component's `nowMs` state
 * (driven by a 1-second `setInterval` inside
 * `BackfillNotificationSettingsCard`) would still pass that test as
 * long as the initial render produced any positive number.
 *
 * This test pins the live tick: with an active server-reported
 * cooldown window, the displayed remaining seconds — both in the
 * `text-test-alert-cooldown` helper and in the button's `title`
 * tooltip — must decrease by ~1 after ~1.5s of real wall-clock time
 * and must stay in lockstep with each other.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TEST_ALERT_LATEST_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert/latest";
const NOTIFICATION_SETTINGS_PATH =
  "/api/crm/calls/transcripts/backfill/notification-settings";

// Long enough window that a ~1.5s wait stays comfortably inside it
// without the cooldown auto-clearing mid-assertion.
const COOLDOWN_SECONDS = 8;

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

function readHelperSeconds(): number {
  const helper = screen.getByTestId("text-test-alert-cooldown");
  const match = (helper.textContent ?? "").match(
    /Available again in (\d+)s/,
  );
  if (!match) {
    throw new Error(
      `helper text did not match countdown shape: ${helper.textContent}`,
    );
  }
  return Number(match[1]);
}

function readTooltipSeconds(button: HTMLButtonElement): number {
  const tooltip = button.getAttribute("title") ?? "";
  const match = tooltip.match(/try again in (\d+)s/i);
  if (!match) {
    throw new Error(`tooltip did not match countdown shape: ${tooltip}`);
  }
  return Number(match[1]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
  // Pre-seed an active server-side cooldown so the card starts in the
  // "rate-limited" state on first render — no need to click through a
  // 429 just to exercise the countdown tick.
  cooldownState = {
    latest: null,
    cooldownSeconds: COOLDOWN_SECONDS,
    nextAllowedAt: new Date(
      Date.now() + COOLDOWN_SECONDS * 1000,
    ).toISOString(),
  };
  cleanup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BackfillNotificationSettingsCard — cooldown countdown ticks (Task #1128)", () => {
  it(
    "decrements the helper text and tooltip seconds in lockstep each second",
    async () => {
      renderCard();

      const button = (await screen.findByTestId(
        "button-send-test-alert",
      )) as HTMLButtonElement;

      // Wait for the cooldown query to resolve and the countdown UI to
      // render — the button must be disabled and the helper text must
      // be present before we can sample seconds values.
      await waitFor(() => {
        expect(button.disabled).toBe(true);
        expect(screen.getByTestId("text-test-alert-cooldown")).toBeTruthy();
      });

      const initialHelper = readHelperSeconds();
      const initialTooltip = readTooltipSeconds(button);

      // Helper and tooltip should be derived from the same `nowMs` /
      // `nextAllowedAtIso` pair, so they must agree on the current
      // remaining seconds.
      expect(initialHelper).toBe(initialTooltip);
      expect(initialHelper).toBeGreaterThan(1);

      // Wait ~1.5s of real wall-clock time so the component's
      // 1-second `setInterval` definitely fires at least once. If a
      // regression froze `nowMs`, both values would still equal the
      // initial sample.
      await sleep(1500);

      await waitFor(
        () => {
          const laterHelper = readHelperSeconds();
          expect(laterHelper).toBeLessThan(initialHelper);
        },
        { timeout: 2000, interval: 100 },
      );

      const laterHelper = readHelperSeconds();
      const laterTooltip = readTooltipSeconds(button);

      // The helper must have ticked down by ~1s (allow 1 or 2 to
      // absorb timer jitter on slow CI). The tooltip must move in
      // lockstep with the helper — both read from the same state.
      const helperDelta = initialHelper - laterHelper;
      const tooltipDelta = initialTooltip - laterTooltip;
      expect(helperDelta).toBeGreaterThanOrEqual(1);
      expect(helperDelta).toBeLessThanOrEqual(2);
      expect(laterTooltip).toBe(laterHelper);
      expect(tooltipDelta).toBe(helperDelta);
    },
    10000,
  );
});
