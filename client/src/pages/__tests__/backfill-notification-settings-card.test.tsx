// @vitest-environment jsdom
/**
 * Task #1044 — covers the "Send test alert" button on the admin transcript
 * backfill settings card. The server-side dispatcher tests live in
 * `server/__tests__/transcript-backfill-notifications.test.ts`; this file
 * specifically exercises the UI side of the verify flow:
 *
 *   • clicking the button POSTs to the test-alert endpoint, and
 *   • the per-channel response shape drives the right toast wording —
 *     success on a configured channel, the dedicated "no destinations
 *     configured" toast when both Slack and email are empty.
 *
 * We mock `apiRequest` so the test never touches the network and
 * `useToast` so we can capture exactly what the card asks the toast system
 * to render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockApiRequest, mockToast } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { BackfillNotificationSettingsCard } from "../admin-transcript-backfill";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BackfillNotificationSettingsCard />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
  cleanup();
});

describe("BackfillNotificationSettingsCard — Send test alert button", () => {
  it("shows the 'no destinations configured' toast when neither channel is saved", async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET") {
        return jsonResponse({
          slackWebhookUrl: null,
          emailRecipients: [],
          updatedAt: null,
        });
      }
      // POST /test-alert — server reports both channels unconfigured.
      return jsonResponse({
        slack: { configured: false, ok: false },
        email: { configured: false, ok: false },
        operatorDisplay: "Test Admin",
      });
    });

    renderCard();
    const button = await screen.findByTestId("button-send-test-alert");
    await userEvent.click(button);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No alert destinations configured",
        variant: "destructive",
      }),
    );
  });

  it("shows success toasts for each configured channel when the test alert succeeds", async () => {
    mockApiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") {
        return jsonResponse({
          slackWebhookUrl: "https://hooks.slack.com/services/ORG",
          emailRecipients: ["alerts@example.com"],
          updatedAt: new Date().toISOString(),
        });
      }
      return jsonResponse({
        slack: { configured: true, ok: true },
        email: {
          configured: true,
          ok: true,
          recipients: ["alerts@example.com"],
        },
        operatorDisplay: "Test Admin",
      });
    });

    renderCard();
    const button = await screen.findByTestId("button-send-test-alert");
    await userEvent.click(button);

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
    const titles = mockToast.mock.calls.map((c) => c[0].title);
    expect(titles).toContain("Slack test alert sent");
    expect(titles).toContain("Email test alert sent");
    // The email toast should mention the recipient list so admins can verify
    // it went to the right place at a glance.
    const emailCall = mockToast.mock.calls.find(
      (c) => c[0].title === "Email test alert sent",
    );
    expect(emailCall?.[0].description).toContain("alerts@example.com");
    // No destructive toasts on the happy path.
    for (const call of mockToast.mock.calls) {
      expect(call[0].variant).not.toBe("destructive");
    }
  });

  it("shows a destructive toast for a channel that fails", async () => {
    mockApiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") {
        return jsonResponse({
          slackWebhookUrl: "https://hooks.slack.com/services/ORG",
          emailRecipients: [],
          updatedAt: null,
        });
      }
      return jsonResponse({
        slack: {
          configured: true,
          ok: false,
          error: "Slack webhook returned 500: boom",
        },
        email: { configured: false, ok: false },
        operatorDisplay: "Test Admin",
      });
    });

    renderCard();
    const button = await screen.findByTestId("button-send-test-alert");
    await userEvent.click(button);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Slack test alert failed",
        description: "Slack webhook returned 500: boom",
        variant: "destructive",
      }),
    );
  });
});
