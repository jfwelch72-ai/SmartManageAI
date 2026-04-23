// @vitest-environment jsdom
/**
 * Task #1130 — pin that the cross-org Cancel hint annotates the effective
 * heartbeat staleness window with "(clamped from X)" when the resolver had
 * to override the operator's stated env value (e.g. ops set
 * `CRM_BACKFILL_HEARTBEAT_STALE_SECONDS=20` expecting a 20-second window
 * and the resolver rounded it up to the 30-second floor). The hint must
 * stay un-annotated when the requested and effective values agree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

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

let notificationConfigForTest: any = null;

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
      return { ...base, data: notificationConfigForTest };
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

const baseConfig = {
  slack: { configured: false, valid: false },
  email: { configured: false, recipients: [] },
  lastTestAt: null,
  lastTestResult: null,
  usingEnvFallback: true,
};

describe("AdminTranscriptBackfillPage cross-org Cancel hint clamped annotation (Task #1130)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders '(clamped from 20 seconds)' when the requested env is below the floor", () => {
    notificationConfigForTest = {
      ...baseConfig,
      heartbeatStaleMs: 30 * 1000, // floor
      heartbeatStaleRequestedMs: 20 * 1000, // ops set CRM_BACKFILL_HEARTBEAT_STALE_SECONDS=20
    };
    render(<AdminTranscriptBackfillPage />);
    const hint = screen.getByTestId("text-cross-org-cancel-hint");
    const text = (hint.textContent ?? "").toLowerCase();
    expect(text).toContain("30 seconds");
    expect(text).toContain("(clamped from 20 seconds)");
    // The clamped sub-span should also be addressable on its own.
    expect(screen.getByTestId("text-cross-org-cancel-hint-clamped")).toBeTruthy();
  });

  it("renders '(clamped from 120 minutes)' when the requested env is above the ceiling", () => {
    notificationConfigForTest = {
      ...baseConfig,
      heartbeatStaleMs: 60 * 60 * 1000, // ceiling
      heartbeatStaleRequestedMs: 2 * 60 * 60 * 1000, // ops set 7200 expecting 2h
    };
    render(<AdminTranscriptBackfillPage />);
    const hint = screen.getByTestId("text-cross-org-cancel-hint");
    const text = (hint.textContent ?? "").toLowerCase();
    expect(text).toContain("60 minutes");
    expect(text).toContain("(clamped from 120 minutes)");
  });

  it("does NOT render the clamped annotation when requested === effective", () => {
    notificationConfigForTest = {
      ...baseConfig,
      heartbeatStaleMs: 10 * 60 * 1000,
      heartbeatStaleRequestedMs: 10 * 60 * 1000,
    };
    render(<AdminTranscriptBackfillPage />);
    expect(screen.queryByTestId("text-cross-org-cancel-hint-clamped")).toBeNull();
    const text = (
      screen.getByTestId("text-cross-org-cancel-hint").textContent ?? ""
    ).toLowerCase();
    expect(text).not.toContain("clamped from");
  });

  it("does NOT render the clamped annotation when env was unset (requestedMs is null)", () => {
    notificationConfigForTest = {
      ...baseConfig,
      heartbeatStaleMs: 5 * 60 * 1000,
      heartbeatStaleRequestedMs: null,
    };
    render(<AdminTranscriptBackfillPage />);
    expect(screen.queryByTestId("text-cross-org-cancel-hint-clamped")).toBeNull();
  });
});
