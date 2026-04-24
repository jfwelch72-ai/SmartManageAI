// @vitest-environment jsdom
// Task #1674 — round-trip test for the failure-alerts recipient panel
// inside `ScheduledLogEmailsCard.tsx`. The sibling
// `ScheduledLogEmailsCard.test.tsx` (added in #1656) only verifies the
// initial render. This file additionally drives a Save click, asserts
// the PUT mutation invalidates the schedules query, and confirms the
// panel re-renders with the new server-returned recipients (e.g. once
// the just-saved user appears as the editor pointer).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

const { mockApiRequest, mockQueryFn } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockQueryFn: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  // We need an actual queryFn here (unlike the sibling tests which only
  // call `setQueryData`) because invalidation triggers a refetch and we
  // want the second response to flow through the cache as a real round
  // trip rather than a manual `setQueryData`.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: mockQueryFn,
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: mockApiRequest,
    queryClient,
    getQueryFn: () => mockQueryFn,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Same Radix Select shim the sibling test uses — pointer events and
// portals are flaky in jsdom, so swap in a context-driven dropdown that
// exposes each option as a plain <button>.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type SelectContextValue = {
    value: string;
    onValueChange: (v: string) => void;
  };
  const SelectCtx = React.createContext<SelectContextValue>({
    value: "",
    onValueChange: () => {},
  });
  type SelectProps = SelectContextValue & { children?: ReactNode };
  type WrapperProps = React.HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
  };
  type ItemProps = React.HTMLAttributes<HTMLButtonElement> & {
    value: string;
    children?: ReactNode;
  };
  return {
    Select: ({ value, onValueChange, children }: SelectProps) => (
      <SelectCtx.Provider value={{ value, onValueChange }}>
        {children}
      </SelectCtx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: WrapperProps) => (
      <div {...rest}>{children}</div>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: WrapperProps) => <div>{children}</div>,
    SelectItem: ({ value, children, ...rest }: ItemProps) => {
      const ctx = React.useContext(SelectCtx);
      return (
        <button
          type="button"
          onClick={() => ctx.onValueChange(value)}
          data-selected={ctx.value === value ? "true" : "false"}
          {...rest}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/ui/hover-card", () => {
  type HoverProps = { children?: ReactNode };
  return {
    HoverCard: ({ children }: HoverProps) => <span>{children}</span>,
    HoverCardTrigger: ({ children }: HoverProps) => <span>{children}</span>,
    HoverCardContent: ({ children }: HoverProps) => <span>{children}</span>,
  };
});

import ScheduledLogEmailsCard from "../ScheduledLogEmailsCard";
import { queryClient as testQueryClient } from "@/lib/queryClient";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const PM_ID = "44444444-4444-4444-4444-444444444444";
const EDITOR_ID = "55555555-5555-5555-5555-555555555555";

// Mirrors the user shape produced by
// `server/__tests__/project-log-email-schedule-get-recipients.test.ts`
// and consumed by the failure-alerts panel.
const PM_USER = {
  id: PM_ID,
  firstName: "Pat",
  lastName: "Manager",
  email: "pm@example.com",
};
const EDITOR_USER = {
  id: EDITOR_ID,
  firstName: "Ed",
  lastName: "Editor",
  email: "editor@example.com",
};

const SCHEDULES_KEY = ["/api/projects", PROJECT_ID, "log-email-schedules"];

const baseRfiRow = {
  id: "s-rfi",
  organizationId: ORG_ID,
  projectId: PROJECT_ID,
  logType: "RFI" as const,
  cadence: "WEEKLY" as const,
  weekday: 1,
  hour: 8,
  timezone: "UTC",
  lastSentAt: null,
  createdAt: null,
  updatedAt: null,
};

beforeEach(() => {
  testQueryClient.clear();
  mockApiRequest.mockReset();
  mockQueryFn.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ScheduledLogEmailsCard — save round-trip", () => {
  it("invalidates the schedules query on save and re-renders the failure-alerts panel with the new recipients", async () => {
    // 1st GET — only the PM is currently wired up as a failure recipient.
    // 2nd GET (issued after the post-save invalidation) — the just-saved
    // editor pointer now shows up alongside the PM, mirroring how the
    // server response shape evolves once `lastEditedByUserId` is set.
    mockQueryFn.mockImplementationOnce(async () => ({
      schedules: [
        { ...baseRfiRow, failureNotificationRecipients: [PM_USER] },
      ],
    }));
    mockQueryFn.mockImplementationOnce(async () => ({
      schedules: [
        {
          ...baseRfiRow,
          cadence: "DAILY",
          failureNotificationRecipients: [PM_USER, EDITOR_USER],
        },
      ],
    }));

    mockApiRequest.mockResolvedValue({
      json: async () => ({ ok: true }),
    });

    const invalidateSpy = vi.spyOn(testQueryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={testQueryClient}>
        <ScheduledLogEmailsCard projectId={PROJECT_ID} />
      </QueryClientProvider>,
    );

    // Wait for the initial GET to resolve and the panel to render the PM.
    await waitFor(() => {
      expect(
        screen.getByTestId(`failure-recipient-name-rfi-${PM_ID}`),
      ).toBeTruthy();
    });
    // Sanity check: the editor isn't there yet — the test would be
    // useless if the assertion below were already true at this point.
    expect(
      screen.queryByTestId(`failure-recipient-name-rfi-${EDITOR_ID}`),
    ).toBeNull();

    // Flip the cadence WEEKLY → DAILY so the form is dirty and Save is
    // enabled. The Select shim above turns each <SelectItem> into a
    // plain button keyed on the option testid.
    fireEvent.click(
      screen.getByTestId("option-log-email-cadence-rfi-daily"),
    );

    // Click Save and assert the PUT mutation is fired with the new
    // cadence in the body.
    fireEvent.click(
      screen.getByTestId("button-save-log-email-schedule-rfi"),
    );

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "PUT",
        `/api/projects/${PROJECT_ID}/log-email-schedules/RFI`,
        expect.objectContaining({ cadence: "DAILY" }),
      );
    });

    // Assert the schedules query is invalidated with the exact key the
    // panel reads from. A regression that drops or renames this key
    // would silently leave admins looking at stale recipient copy until
    // they refresh — exactly the bug this test is here to catch.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: SCHEDULES_KEY,
      });
    });

    // The invalidation must trigger a refetch — confirm the queryFn
    // was hit a second time.
    await waitFor(() => {
      expect(mockQueryFn).toHaveBeenCalledTimes(2);
    });

    // And once the second GET settles, the panel must reflect the new
    // recipient list (PM + Editor) without a manual refresh.
    await waitFor(() => {
      expect(
        screen.getByTestId(`failure-recipient-name-rfi-${EDITOR_ID}`),
      ).toBeTruthy();
    });
    expect(
      screen.getByTestId(`failure-recipient-name-rfi-${PM_ID}`)
        .textContent,
    ).toBe("Pat Manager");
    expect(
      screen.getByTestId(`failure-recipient-name-rfi-${EDITOR_ID}`)
        .textContent,
    ).toBe("Ed Editor");

    // The "Currently:" status copy mirrors the server payload too — a
    // regression that fails to merge the new cadence into the row would
    // leave this stuck on "Weekly".
    expect(
      screen.getByTestId("text-log-email-status-rfi").textContent,
    ).toBe("Currently: Daily");
  });
});
