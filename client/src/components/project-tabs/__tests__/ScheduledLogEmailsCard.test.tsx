// @vitest-environment jsdom
// Task #1656 — component tests for the failure-alerts recipient panel
// inside `ScheduledLogEmailsCard.tsx` (added in #1649).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: vi.fn(),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Replace Radix Select (pointer events / portals are flaky in jsdom)
// with a context-driven shim so the cadence dropdowns can render.
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
  type WrapperProps = React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  type ItemProps = React.HTMLAttributes<HTMLButtonElement> & {
    value: string;
    children?: ReactNode;
  };
  return {
    Select: ({ value, onValueChange, children }: SelectProps) => (
      <SelectCtx.Provider value={{ value, onValueChange }}>{children}</SelectCtx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: WrapperProps) => <div {...rest}>{children}</div>,
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

// Replace Radix HoverCard with a passthrough so the email + mailto
// content is queryable without driving pointer events / openDelay.
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

// Mirrors the user shape produced by the GET-recipients server test.
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

function seedSchedules(rows: Array<Record<string, unknown>>) {
  testQueryClient.setQueryData(
    ["/api/projects", PROJECT_ID, "log-email-schedules"],
    { schedules: rows },
  );
}

function renderCard() {
  return render(
    <QueryClientProvider client={testQueryClient}>
      <ScheduledLogEmailsCard projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  testQueryClient.clear();
});

afterEach(() => {
  cleanup();
});

describe("ScheduledLogEmailsCard — failure-alerts recipient panel", () => {
  it("renders the dotted-underline name buttons in PM-first order", () => {
    seedSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastSentAt: null,
        createdAt: null,
        updatedAt: null,
        failureNotificationRecipients: [PM_USER, EDITOR_USER],
      },
    ]);

    renderCard();

    const panel = screen.getByTestId("failure-recipients-rfi");
    const nameButtons = within(panel).getAllByTestId(
      /^failure-recipient-name-rfi-/,
    );
    expect(nameButtons).toHaveLength(2);
    expect(nameButtons[0].getAttribute("data-testid")).toBe(
      `failure-recipient-name-rfi-${PM_ID}`,
    );
    expect(nameButtons[0].textContent).toBe("Pat Manager");
    expect(nameButtons[1].getAttribute("data-testid")).toBe(
      `failure-recipient-name-rfi-${EDITOR_ID}`,
    );
    expect(nameButtons[1].textContent).toBe("Ed Editor");
    for (const btn of nameButtons) {
      expect(btn.className).toMatch(/decoration-dotted/);
    }
  });

  it("shows the empty-state copy when failureNotificationRecipients is empty", () => {
    // RFI seeded with an explicit empty array; the SUBMITTAL row is
    // omitted so it falls through to the default-OFF row that arrives
    // with no `failureNotificationRecipients` field at all.
    seedSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastSentAt: null,
        createdAt: null,
        updatedAt: null,
        failureNotificationRecipients: [],
      },
    ]);

    renderCard();

    const expectedCopy =
      "Nobody — set a project manager or update the cadence to record an editor.";

    expect(
      screen.getByTestId("failure-recipients-empty-rfi").textContent,
    ).toBe(expectedCopy);
    expect(
      screen.getByTestId("failure-recipients-empty-submittal").textContent,
    ).toBe(expectedCopy);
    expect(
      screen.queryByTestId(`failure-recipient-name-rfi-${PM_ID}`),
    ).toBeNull();
  });

  it("reveals the resolved email and a mailto: link inside the HoverCard", () => {
    seedSchedules([
      {
        id: "s-rfi",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        weekday: 1,
        hour: 8,
        timezone: "UTC",
        lastSentAt: null,
        createdAt: null,
        updatedAt: null,
        failureNotificationRecipients: [PM_USER],
      },
    ]);

    renderCard();

    const emailLink = screen.getByTestId(
      `failure-recipient-email-rfi-${PM_ID}`,
    );
    expect(emailLink.textContent).toBe("pm@example.com");
    expect(emailLink.tagName).toBe("A");
    expect(emailLink.getAttribute("href")).toBe("mailto:pm@example.com");
  });
});
