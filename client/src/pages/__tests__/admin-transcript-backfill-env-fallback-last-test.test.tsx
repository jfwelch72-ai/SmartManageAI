// @vitest-environment jsdom
/**
 * Task #1063 — frontend regression for the inline last-test result panel
 * inside the env-var "Notification destinations" summary card. Before this
 * task, env-fallback orgs (no per-org row, or a per-org row with empty
 * destinations) had no inline health indicator on the admin transcript
 * backfill page — the per-org settings card's lastTest panel never
 * appeared because that card has nothing else to show. This test pins the
 * new behavior:
 *
 *   • when /notification-config returns `usingEnvFallback: true` and
 *     non-null lastTestAt + lastTestResult, the panel shows up under the
 *     env-var card with the per-channel chips and timestamp;
 *   • clicking dismiss invokes the DELETE /notification-settings/last-test
 *     endpoint so the persisted lastTest fields are cleared.
 *
 * The page-level mocking pattern matches `admin-transcript-backfill-cross-
 * org.test.tsx` so the panel can be exercised against the real component
 * tree without standing up a full React Query/network stack.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiRequestMock = vi.fn(async () => new Response("{}", { status: 200 }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "admin-1",
      role: "ADMIN",
      organizationId: "org-1",
      firstName: "Site",
      lastName: "Admin",
      email: "admin@test.invalid",
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/admin/transcript-backfill", () => {}],
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", async () => {
  const actual: any = await vi.importActual("@tanstack/react-query");
  const useQuery = ({ queryKey, enabled }: any) => {
    const path = Array.isArray(queryKey) ? queryKey[0] : "";
    const base = {
      isLoading: false,
      isError: false,
      isFetching: false,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    if (enabled === false) return { ...base, data: undefined };
    if (path === "/api/crm/calls/transcripts/backfill") {
      const second = Array.isArray(queryKey) ? queryKey[1] : undefined;
      if (second && typeof second === "object") {
        return {
          ...base,
          data: {
            pending: 0,
            activeJob: null,
            crossOrg: false,
            scopedOrganizationId: null,
            runningJobs: [],
          },
        };
      }
      return { ...base, data: undefined };
    }
    if (path === "/api/crm/calls/transcripts/backfill/history") {
      return { ...base, data: { total: 0, limit: 20, offset: 0, jobs: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/pending") {
      return { ...base, data: { total: 0, limit: 20, offset: 0, recordings: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/operators") {
      return { ...base, data: { operators: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-config") {
      // The scenario this test pins: a deployment where env vars are still
      // wiring up a Slack webhook + recipient list (`configured: true`),
      // but no per-org row has overridden them. The per-org test endpoint
      // has previously persisted a last-test outcome on the (otherwise
      // empty) per-org row — so the env-var summary card should render the
      // inline lastTest panel.
      return {
        ...base,
        data: {
          slack: { configured: true, valid: true },
          email: { configured: true, recipients: ["alerts@example.com"] },
          lastTestAt: new Date("2026-01-02T15:00:00Z").toISOString(),
          lastTestResult: {
            slack: { configured: true, ok: true },
            email: {
              configured: true,
              ok: false,
              error: "550 Recipient mailbox unavailable",
              recipients: ["alerts@example.com"],
            },
            operatorDisplay: "Site Admin <admin@test.invalid>",
          },
          usingEnvFallback: true,
        },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-settings") {
      // The per-org settings card sees an empty row (which is exactly why
      // this test is pinning the env-var card's lastTest panel — the
      // per-org card has nothing else to render here).
      return {
        ...base,
        data: {
          slackWebhookUrl: "",
          emailRecipients: [],
          updatedAt: null,
          lastTestAt: null,
          lastTestResult: null,
        },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/test-alert/latest") {
      return {
        ...base,
        data: { latest: null, cooldownSeconds: 0, nextAllowedAt: null },
      };
    }
    if (path === "/api/platform/organizations") {
      return { ...base, data: [] };
    }
    return { ...base, data: undefined };
  };
  const useMutation = (opts: any) => ({
    mutate: (vars: any) => {
      const fn = opts?.mutationFn;
      if (fn) {
        Promise.resolve(fn(vars)).then(
          (data) => opts?.onSuccess?.(data, vars),
          (err) => opts?.onError?.(err, vars),
        );
      }
    },
    mutateAsync: vi.fn(async (vars: any) => opts?.mutationFn?.(vars)),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
    error: null,
    data: undefined,
  });
  return { ...actual, useQuery, useMutation };
});

import AdminTranscriptBackfillPage from "@/pages/admin-transcript-backfill";

describe("AdminTranscriptBackfillPage env-var fallback last-test panel (Task #1063)", () => {
  it("renders the lastTest panel inside the env-var notification card and dismisses it via DELETE", async () => {
    apiRequestMock.mockClear();
    render(<AdminTranscriptBackfillPage />);

    const panel = screen.getByTestId("panel-notification-config-last-test");
    expect(panel).toBeTruthy();

    // Timestamp + per-channel chips come from the panel body. The email
    // chip should reflect the failed result; Slack should reflect healthy.
    expect(within(panel).getByTestId("text-last-test-at").textContent).toBeTruthy();
    expect(within(panel).getByTestId("chip-last-test-slack").textContent?.toLowerCase()).toContain(
      "healthy",
    );
    expect(within(panel).getByTestId("chip-last-test-email").textContent?.toLowerCase()).toContain(
      "failed",
    );
    expect(within(panel).getByTestId("text-last-test-email-error").textContent).toContain(
      "Recipient mailbox unavailable",
    );

    // Dismiss button hits the same DELETE endpoint that the per-org
    // settings card uses, so clearing from either place wipes the
    // persisted lastTest fields on the per-org row.
    await userEvent.click(within(panel).getByTestId("button-dismiss-last-test"));
    expect(apiRequestMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/crm/calls/transcripts/backfill/notification-settings/last-test",
    );
  });
});
