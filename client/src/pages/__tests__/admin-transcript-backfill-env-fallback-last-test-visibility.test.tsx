// @vitest-environment jsdom
/**
 * Task #1072 — pins the visibility rules for the inline last-test panel
 * inside the env-var "Notification destinations" card. Task #1063 added
 * the panel + the `usingEnvFallback` flag, and the existing
 * `admin-transcript-backfill-env-fallback-last-test.test.tsx` covers the
 * happy-path (panel renders + dismiss button hits the DELETE endpoint).
 *
 * The new coverage here pins the *negative* branches and the
 * cache-invalidation behavior, both of which would silently regress
 * without a test:
 *
 *   • Panel must NOT render when `usingEnvFallback` is false (per-org
 *     destinations are saved — the per-org settings card owns the
 *     lastTest panel in that mode).
 *   • Panel must NOT render when `usingEnvFallback` is true but the
 *     persisted `lastTestResult` is null (no test has ever been fired).
 *   • When the panel IS rendered, it lives inside the
 *     `card-notification-destinations` card (so it's visually grouped
 *     with the env-var destinations it describes).
 *   • Clicking dismiss invalidates BOTH the `/notification-config` and
 *     the `/notification-settings` query keys so the panel disappears
 *     from either card immediately, regardless of which one the admin
 *     was looking at.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { apiRequestMock, invalidateQueriesMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(async () => new Response("{}", { status: 200 })),
  invalidateQueriesMock: vi.fn(),
}));

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

type LinkProps = {
  children?: React.ReactNode;
  href?: string;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>;

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: LinkProps) =>
    React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/admin/transcript-backfill", () => {}],
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: {
    invalidateQueries: invalidateQueriesMock,
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

// Per-test scenario knob — set BEFORE rendering. The useQuery mock reads
// this to decide what to return for `/notification-config` so each test
// case can exercise a different branch without redefining vi.mock factories.
type NotificationConfigScenario = {
  usingEnvFallback: boolean;
  lastTestResult:
    | null
    | {
        slack: { configured: boolean; ok: boolean };
        email: {
          configured: boolean;
          ok: boolean;
          error?: string;
          recipients?: string[];
        };
        operatorDisplay: string;
      };
  lastTestAt: string | null;
};

let currentScenario: NotificationConfigScenario = {
  usingEnvFallback: true,
  lastTestResult: null,
  lastTestAt: null,
};

function setNotificationConfigScenario(s: NotificationConfigScenario) {
  currentScenario = s;
}

type UseQueryArgs = { queryKey: readonly unknown[]; enabled?: boolean };
type MutationOpts<TData, TVars> = {
  mutationFn?: (vars: TVars) => Promise<TData> | TData;
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: unknown, vars: TVars) => void;
};

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  const useQuery = ({ queryKey, enabled }: UseQueryArgs) => {
    const path = Array.isArray(queryKey) ? (queryKey[0] as string) : "";
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
      return {
        ...base,
        data: {
          slack: { configured: true, valid: true },
          email: { configured: true, recipients: ["alerts@example.com"] },
          lastTestAt: currentScenario.lastTestAt,
          lastTestResult: currentScenario.lastTestResult,
          usingEnvFallback: currentScenario.usingEnvFallback,
        },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-settings") {
      // The per-org settings card sees an empty row when usingEnvFallback
      // is true; for the saved-destinations scenario we still return the
      // empty defaults because the panel-visibility branches are driven by
      // the /notification-config response, not this one.
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
  const useMutation = <TData, TVars>(opts: MutationOpts<TData, TVars>) => ({
    mutate: (vars: TVars) => {
      const fn = opts?.mutationFn;
      if (fn) {
        Promise.resolve(fn(vars)).then(
          (data) => opts?.onSuccess?.(data, vars),
          (err) => opts?.onError?.(err, vars),
        );
      }
    },
    mutateAsync: vi.fn(async (vars: TVars) => opts?.mutationFn?.(vars)),
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

describe("AdminTranscriptBackfillPage env-var lastTest panel visibility (Task #1072)", () => {
  it("does NOT render the panel when usingEnvFallback is false (per-org destinations are saved)", () => {
    setNotificationConfigScenario({
      usingEnvFallback: false,
      lastTestAt: new Date("2026-04-22T12:00:00Z").toISOString(),
      lastTestResult: {
        slack: { configured: true, ok: true },
        email: { configured: true, ok: true, recipients: ["team@example.com"] },
        operatorDisplay: "Site Admin <admin@test.invalid>",
      },
    });

    render(<AdminTranscriptBackfillPage />);

    const card = screen.getByTestId("card-notification-destinations");
    expect(within(card).queryByTestId("panel-notification-config-last-test")).toBeNull();
  });

  it("does NOT render the panel when usingEnvFallback is true but lastTestResult is null", () => {
    setNotificationConfigScenario({
      usingEnvFallback: true,
      lastTestAt: null,
      lastTestResult: null,
    });

    render(<AdminTranscriptBackfillPage />);

    const card = screen.getByTestId("card-notification-destinations");
    expect(within(card).queryByTestId("panel-notification-config-last-test")).toBeNull();
  });

  it("renders the panel inside card-notification-destinations and invalidates both caches on dismiss", async () => {
    setNotificationConfigScenario({
      usingEnvFallback: true,
      lastTestAt: new Date("2026-04-22T12:00:00Z").toISOString(),
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
    });
    apiRequestMock.mockClear();
    invalidateQueriesMock.mockClear();

    render(<AdminTranscriptBackfillPage />);

    // The panel must live INSIDE the env-var "Notification destinations"
    // card so it's visually grouped with the destinations it describes.
    const card = screen.getByTestId("card-notification-destinations");
    const panel = within(card).getByTestId("panel-notification-config-last-test");
    expect(panel).toBeTruthy();

    await userEvent.click(within(panel).getByTestId("button-dismiss-last-test"));

    // Same DELETE endpoint that the per-org settings card uses, so the
    // lastTest fields on the shared per-org row are cleared regardless of
    // which card the admin dismissed from.
    expect(apiRequestMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/crm/calls/transcripts/backfill/notification-settings/last-test",
    );

    // Both query caches must be invalidated so the panel disappears from
    // EITHER card immediately — a regression here would leave a stale
    // panel visible until the next manual refetch.
    const invalidatedKeys = invalidateQueriesMock.mock.calls.map((call) => {
      const arg = call[0] as { queryKey: readonly unknown[] };
      return arg.queryKey[0];
    });
    expect(invalidatedKeys).toContain(
      "/api/crm/calls/transcripts/backfill/notification-config",
    );
    expect(invalidatedKeys).toContain(
      "/api/crm/calls/transcripts/backfill/notification-settings",
    );
  });
});
