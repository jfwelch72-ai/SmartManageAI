// @vitest-environment jsdom
/**
 * Task #1149 — frontend regression for the "Download CSV" button inside
 * `TestAlertHistoryPanel` (added by Task #1096). The button has two
 * non-trivial behaviors that a regression in `handleExportCsv` or the
 * `disabled` binding could quietly break:
 *
 *   * The button is disabled while the filtered total is 0 so admins
 *     don't trigger an empty download (which would also surface a
 *     misleading "no rows" CSV).
 *   * Clicking the button calls `apiRequest("GET", ...)` with the
 *     filtered query string — the same filters as the JSON history
 *     query, minus pagination. A regression that dropped `sender`,
 *     `slackOk`, `emailOk`, `anyFailed`, `sentAfter`, `sentBefore`, or
 *     `organizationId` would silently export the unfiltered set.
 *
 * The page is heavy, so we mock @tanstack/react-query, the auth hook,
 * the toast hook, the queryClient + apiRequest helpers, and shadcn's
 * Radix-backed Select (unusable in jsdom for the same reasons cited in
 * `admin-transcript-backfill-cross-org.test.tsx`). Two `useQuery`
 * implementations are exposed so a single render can swap between
 * "total = 0" and "total > 0" without re-mounting the page.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const baseHistoryAlert = {
  id: "alert-1",
  organizationId: "org-A",
  organizationName: "Acme Tenant",
  sentAt: new Date("2026-04-01T12:00:00Z").toISOString(),
  sentByFirstName: "Jane",
  sentByLastName: "Sender",
  sentByEmail: "jane@example.com",
  operatorDisplay: "Jane Sender",
  slackConfigured: true,
  slackOk: true,
  slackError: null,
  emailConfigured: true,
  emailOk: true,
  emailError: null,
  emailRecipients: [],
};

// Toggled by tests to swap the test-alert history payload between the
// "no rows" and "has rows" shapes without re-rendering.
let historyPayload: { total: number; alerts: unknown[]; crossOrg: boolean } = {
  total: 0,
  alerts: [],
  crossOrg: false,
};

const apiRequestMock = vi.fn(
  async () =>
    new Response("id\nrow-1\n", {
      status: 200,
      headers: { "Content-Type": "text/csv" },
    }),
);

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "admin-1",
      role: "ADMIN",
      organizationId: "org-A",
      firstName: "Jane",
      lastName: "Sender",
      email: "jane@example.com",
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
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

vi.mock("@/components/ui/select", () => {
  const Ctx = React.createContext<{ onValueChange?: (v: string) => void }>({});
  const Select = ({ onValueChange, children }: any) =>
    React.createElement(Ctx.Provider, { value: { onValueChange } }, children);
  const SelectTrigger = ({ children, ...rest }: any) =>
    React.createElement("div", rest, children);
  const SelectValue = ({ placeholder }: any) =>
    React.createElement("span", null, placeholder ?? null);
  const SelectContent = ({ children }: any) =>
    React.createElement(React.Fragment, null, children);
  const SelectItem = ({ value, children, ...rest }: any) => {
    const ctx = React.useContext(Ctx);
    return React.createElement(
      "button",
      {
        ...rest,
        type: "button",
        onClick: () => ctx.onValueChange?.(value),
      },
      children,
    );
  };
  const SelectGroup = ({ children }: any) =>
    React.createElement(React.Fragment, null, children);
  const SelectLabel = ({ children }: any) =>
    React.createElement("span", null, children);
  const SelectSeparator = () => null;
  const SelectScrollUpButton = () => null;
  const SelectScrollDownButton = () => null;
  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
    SelectScrollUpButton,
    SelectScrollDownButton,
  };
});

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
    if (enabled === false) {
      return { ...base, data: undefined };
    }
    if (path === "/api/crm/calls/transcripts/backfill") {
      return {
        ...base,
        data: {
          pending: 0,
          activeJob: null,
          crossOrg: false,
          scopedOrganizationId: "org-A",
          runningJobs: [],
        },
      };
    }
    if (
      path === "/api/crm/calls/transcripts/backfill/test-alert/history"
    ) {
      return { ...base, data: historyPayload };
    }
    if (path === "/api/crm/calls/transcripts/backfill/history") {
      return { ...base, data: { total: 0, limit: 20, offset: 0, jobs: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/pending") {
      return {
        ...base,
        data: { total: 0, limit: 20, offset: 0, recordings: [] },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/operators") {
      return { ...base, data: { operators: [] } };
    }
    if (
      path === "/api/crm/calls/transcripts/backfill/notification-config"
    ) {
      return {
        ...base,
        data: {
          slack: { configured: true, valid: true },
          email: { configured: true, recipients: ["ops@example.com"] },
          lastTestAt: null,
          lastTestResult: null,
          usingEnvFallback: false,
        },
      };
    }
    if (
      path === "/api/crm/calls/transcripts/backfill/notification-settings"
    ) {
      return {
        ...base,
        data: { quietHours: null, recipients: [], suppressEmptyRuns: false },
      };
    }
    if (
      path === "/api/crm/calls/transcripts/backfill/test-alert/usage"
    ) {
      return {
        ...base,
        data: { last24h: 0, last7d: 0, last30d: 0, crossOrg: false },
      };
    }
    if (
      path ===
      "/api/crm/calls/transcripts/backfill/test-alert/usage-buckets"
    ) {
      return { ...base, data: { buckets: [] } };
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
  const useMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
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

beforeEach(() => {
  apiRequestMock.mockClear();
  apiRequestMock.mockImplementation(
    async () =>
      new Response("id\nrow-1\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      }),
  );
  // jsdom doesn't implement these blob URL helpers; the export handler
  // calls them after the apiRequest resolves.
  (URL as any).createObjectURL = vi.fn(() => "blob:mock");
  (URL as any).revokeObjectURL = vi.fn();
  historyPayload = { total: 0, alerts: [], crossOrg: false };
});

afterEach(() => {
  delete (URL as any).createObjectURL;
  delete (URL as any).revokeObjectURL;
});

describe("TestAlertHistoryPanel — Download CSV button (Task #1149)", () => {
  it("disables the Download CSV button when the filtered total is 0", async () => {
    historyPayload = { total: 0, alerts: [], crossOrg: false };
    const user = userEvent.setup();
    render(<AdminTranscriptBackfillPage />);

    // The panel is collapsed by default; expanding it is what mounts the
    // Download CSV button.
    await user.click(screen.getByTestId("button-toggle-test-alert-history"));

    const btn = await screen.findByTestId(
      "button-export-test-alert-history-csv",
    );
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    // Clicking the disabled button must not fire the export request — a
    // regression in the `disabled` binding would let an empty CSV get
    // downloaded with no rows in it.
    await user.click(btn);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("downloads with the current filtered query string when clicked", async () => {
    historyPayload = {
      total: 1,
      crossOrg: false,
      alerts: [baseHistoryAlert],
    };
    const user = userEvent.setup();
    render(<AdminTranscriptBackfillPage />);

    await user.click(screen.getByTestId("button-toggle-test-alert-history"));

    // Apply a sender filter (debounced) and a result filter so the
    // exported URL has to carry both.
    const senderInput = await screen.findByTestId(
      "input-test-alert-history-sender",
    );
    await user.type(senderInput, "jane");
    await user.click(
      screen.getByTestId(
        "select-test-alert-history-result-option-EITHER_FAILED",
      ),
    );

    // The sender input is debounced 300ms before `appliedSender`
    // updates. Sleep a hair longer than that so the click below picks
    // up the debounced value — otherwise the export URL would carry
    // the empty sender (the bug we're guarding against).
    await new Promise((r) => setTimeout(r, 400));

    const btn = await screen.findByTestId(
      "button-export-test-alert-history-csv",
    );
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await user.click(btn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });
    const [method, url] = apiRequestMock.mock.calls[0];
    expect(method).toBe("GET");
    expect(typeof url).toBe("string");
    const u = new URL(url as string, "http://localhost");
    expect(u.pathname).toBe(
      "/api/crm/calls/transcripts/backfill/test-alert/history.csv",
    );
    expect(u.searchParams.get("sender")).toBe("jane");
    expect(u.searchParams.get("anyFailed")).toBe("true");
    // Pagination params from the JSON query must NOT bleed into the
    // export — the route streams the full filtered set.
    expect(u.searchParams.get("limit")).toBeNull();
    expect(u.searchParams.get("offset")).toBeNull();
    // Org-scoped admins must not pass an organizationId; the server
    // would ignore it but emitting it is a code smell that hints the
    // panel is over-sharing scope info.
    expect(u.searchParams.get("organizationId")).toBeNull();

    // The handler should request a Blob URL so the anchor download works
    // — proves the success branch ran end-to-end.
    expect((URL as any).createObjectURL).toHaveBeenCalled();
  });
});
