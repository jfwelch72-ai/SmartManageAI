// @vitest-environment jsdom
/**
 * Task #1084 — pin that the cross-org Cancel hint copy reflects the live
 * heartbeat staleness window returned by the notification-config endpoint
 * (Task #1078) instead of the hardcoded 5-minute fallback. The existing
 * cross-org test only exercises the 5-minute default, so a regression
 * that ignored `notificationConfig.heartbeatStaleMs` (or that swapped the
 * formatter for a hardcoded string) would slip through. Here the mocked
 * notification-config response sets `heartbeatStaleMs` to 10 minutes and
 * we assert the rendered hint says "10 minutes".
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

const crossOrgSummaryData = {
  pending: 1,
  activeJob: null,
  crossOrg: true,
  scopedOrganizationId: null,
  runningJobs: [
    {
      id: "job-A",
      status: "RUNNING",
      total: 10,
      processed: 3,
      succeeded: 2,
      failed: 1,
      errors: [],
      failedRecordingIds: [],
      startedAt: new Date("2026-01-01T12:00:00Z").toISOString(),
      completedAt: null,
      parentJobId: null,
      concurrency: 2,
      maxRecords: null,
      organization: { id: "org-A", name: "Acme Tenant", slug: "acme" },
    },
  ],
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "super-1",
      role: "SUPER_ADMIN",
      organizationId: null,
      firstName: "Super",
      lastName: "Admin",
      email: "super@test.invalid",
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
  apiRequest: vi.fn(async () => new Response("{}", { status: 200 })),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

// Same minimal Radix-Select stand-in the sibling test uses, so the page
// renders past the org picker in jsdom without dragging PointerEvent
// shims into the setup.
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
    if (enabled === false) return { ...base, data: undefined };
    if (path === "/api/crm/calls/transcripts/backfill") {
      const second = Array.isArray(queryKey) ? queryKey[1] : undefined;
      if (second && typeof second === "object") {
        return { ...base, data: crossOrgSummaryData };
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
      // Task #1084 — non-default heartbeat window. The hint must echo this
      // value verbatim ("10 minutes") instead of the 5-minute fallback.
      return {
        ...base,
        data: {
          slack: { configured: false, valid: false },
          email: { configured: false, recipients: [] },
          lastTestAt: null,
          lastTestResult: null,
          usingEnvFallback: true,
          heartbeatStaleMs: 10 * 60 * 1000,
        },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-settings") {
      return {
        ...base,
        data: { quietHours: null, recipients: [], suppressEmptyRuns: false },
      };
    }
    if (path === "/api/platform/organizations") {
      return {
        ...base,
        data: [{ id: "org-A", name: "Acme Tenant", slug: "acme" }],
      };
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

describe("AdminTranscriptBackfillPage cross-org Cancel hint reflects tuned heartbeat (Task #1084)", () => {
  it("renders the live heartbeatStaleMs from notification-config (10 minutes) in the hint copy", () => {
    render(<AdminTranscriptBackfillPage />);
    const hint = screen.getByTestId("text-cross-org-cancel-hint");
    const text = (hint.textContent ?? "").toLowerCase();
    // Must reflect the tuned 10-minute window, NOT the hardcoded 5-minute fallback.
    expect(text).toContain("10 minutes");
    expect(text).not.toContain("5 minutes");
    // And the rest of the explanatory copy is still present.
    expect(text).toContain("cancel");
    expect(text).toContain("heartbeat");
    expect(text).toContain("reaped");
  });
});
