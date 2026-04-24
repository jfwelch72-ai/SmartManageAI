// @vitest-environment jsdom
// Task #1501 — front-end coverage for the Preset history card filters.
// Mirrors Task #1461's server suite by exercising the trade and
// "applied by" dropdowns, the empty state, and NULL-appliedBy rendering.
import React, { type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => ({}),
  };
});

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

// Radix's <Select> needs PointerEvents/scrollIntoView/pointer capture
// that jsdom does not implement. Replace it with a context-driven
// stand-in that exposes each <SelectItem> as a real <button>.
vi.mock("@/components/ui/select", () => {
  type SelectCtx = { onValueChange?: (value: string) => void };
  const Ctx = React.createContext<SelectCtx>({});

  type SelectProps = {
    onValueChange?: (value: string) => void;
    children?: ReactNode;
    value?: string;
  };
  const Select = ({ onValueChange, children }: SelectProps) =>
    React.createElement(Ctx.Provider, { value: { onValueChange } }, children);

  type DivProps = React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  const SelectTrigger = ({ children, ...rest }: DivProps) =>
    React.createElement("div", rest, children);

  const SelectValue = ({ placeholder }: { placeholder?: ReactNode }) =>
    React.createElement("span", null, placeholder ?? null);

  const SelectContent = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  type ItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    value: string;
    children?: ReactNode;
  };
  const SelectItem = ({ value, children, ...rest }: ItemProps) => {
    const ctx = React.useContext(Ctx);
    return React.createElement(
      "button",
      { ...rest, type: "button", onClick: () => ctx.onValueChange?.(value) },
      children,
    );
  };

  const Passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const Label = ({ children }: { children?: ReactNode }) =>
    React.createElement("span", null, children);
  const Empty = () => null;

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectGroup: Passthrough,
    SelectLabel: Label,
    SelectSeparator: Empty,
    SelectScrollUpButton: Empty,
    SelectScrollDownButton: Empty,
  };
});

import { OrgFeaturePresetsTab } from "../OrgFeaturePresetsTab";

const ORG_ID = "org-1";

const userAlice = {
  id: "user-alice",
  firstName: "Alice",
  lastName: "Adams",
  email: "alice@test.invalid",
};
const userBob = {
  id: "user-bob",
  firstName: "Bob",
  lastName: "Builder",
  email: "bob@test.invalid",
};

type Row = {
  id: string;
  tradeType: string;
  appliedAt: string;
  appliedBy: typeof userAlice | null;
  kind: "apply" | "reset_drift";
  flagKeys: string[] | null;
};

const ROWS: Row[] = [
  {
    id: "h-alice-gc",
    tradeType: "GENERAL_CONTRACTOR",
    appliedAt: "2026-01-03T10:00:00Z",
    appliedBy: userAlice,
    kind: "apply",
    flagKeys: null,
  },
  {
    id: "h-bob-earth",
    tradeType: "EARTHWORK",
    appliedAt: "2026-01-02T10:00:00Z",
    appliedBy: userBob,
    kind: "apply",
    flagKeys: null,
  },
  {
    // NULL appliedBy — must be visible in the table but absent from the dropdown.
    id: "h-system-gc",
    tradeType: "GENERAL_CONTRACTOR",
    appliedAt: "2026-01-01T10:00:00Z",
    appliedBy: null,
    kind: "apply",
    flagKeys: null,
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function setupApiMock() {
  mockApiRequest.mockImplementation(async (_method: string, url: string) => {
    const u = new URL(url, "http://localhost");
    const path = u.pathname;

    if (path === `/api/feature-flags/${ORG_ID}`) {
      return jsonResponse({ flags: {}, keys: [] });
    }
    if (path === `/api/feature-flags/${ORG_ID}/last-preset`) {
      return jsonResponse({ lastApplied: null });
    }
    if (path === `/api/feature-flags/${ORG_ID}/preset-history-filters`) {
      // System backfill rows (NULL appliedById) are intentionally excluded here.
      return jsonResponse({
        tradeTypes: ["GENERAL_CONTRACTOR", "EARTHWORK"],
        appliedBy: [userAlice, userBob],
      });
    }
    if (path === `/api/feature-flags/${ORG_ID}/preset-history`) {
      const tradeType = u.searchParams.get("tradeType");
      const appliedById = u.searchParams.get("appliedById");
      const filtered = ROWS.filter((r) => {
        if (tradeType && r.tradeType !== tradeType) return false;
        if (appliedById && r.appliedBy?.id !== appliedById) return false;
        return true;
      });
      return jsonResponse({
        items: filtered,
        total: filtered.length,
        page: 1,
        pageSize: 10,
      });
    }
    if (path === `/api/feature-flags/${ORG_ID}/manual-flag-changes`) {
      return jsonResponse({ items: [], total: 0, page: 1, pageSize: 10 });
    }
    return jsonResponse({});
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgFeaturePresetsTab
        overrideOrgId={ORG_ID}
        overrideTradeType="GENERAL_CONTRACTOR"
      />
    </QueryClientProvider>,
  );
}

function presetHistoryRequests(): URL[] {
  return mockApiRequest.mock.calls
    .map((call) => call[1])
    .filter((url): url is string => typeof url === "string")
    .filter((url) =>
      url.startsWith(`/api/feature-flags/${ORG_ID}/preset-history?`),
    )
    .map((url) => new URL(url, "http://localhost"));
}

describe("OrgFeaturePresetsTab — preset history filters", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    setupApiMock();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders system-backfill rows in the table but omits them from the Applied-by dropdown", async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByTestId("row-preset-history-h-alice-gc")).toBeTruthy();
    });
    expect(screen.getByTestId("row-preset-history-h-bob-earth")).toBeTruthy();
    expect(screen.getByTestId("row-preset-history-h-system-gc")).toBeTruthy();
    expect(
      screen.getByTestId("text-history-user-h-system-gc").textContent,
    ).toBe("Unknown user");

    expect(
      screen.getByTestId("select-item-preset-history-applied-by-user-alice"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("select-item-preset-history-applied-by-user-bob"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(
        "select-item-preset-history-applied-by-h-system-gc",
      ),
    ).toBeNull();

    // Stronger guarantee: only the two seeded real users plus the "Anyone"
    // sentinel option are exposed. Any NULL/system actor leaking into the
    // dropdown would push this count past 3.
    const appliedByOptions = Array.from(
      document.querySelectorAll(
        '[data-testid^="select-item-preset-history-applied-by-"]',
      ),
    ).map((el) => el.getAttribute("data-testid"));
    expect(appliedByOptions.sort()).toEqual(
      [
        "select-item-preset-history-applied-by-all",
        "select-item-preset-history-applied-by-user-alice",
        "select-item-preset-history-applied-by-user-bob",
      ].sort(),
    );
  });

  it("re-fetches with tradeType and appliedById in the query string when the dropdowns change", async () => {
    const user = userEvent.setup();
    renderTab();

    await waitFor(() => {
      expect(screen.getByTestId("row-preset-history-h-alice-gc")).toBeTruthy();
    });

    await user.click(screen.getByTestId("select-item-preset-history-trade-EARTHWORK"));

    await waitFor(() => {
      expect(screen.queryByTestId("row-preset-history-h-alice-gc")).toBeNull();
    });
    expect(screen.getByTestId("row-preset-history-h-bob-earth")).toBeTruthy();
    expect(screen.queryByTestId("row-preset-history-h-system-gc")).toBeNull();

    const sawTradeOnly = presetHistoryRequests().some((u) => {
      return (
        u.searchParams.get("tradeType") === "EARTHWORK" &&
        u.searchParams.get("appliedById") === null
      );
    });
    expect(sawTradeOnly).toBe(true);

    await user.click(screen.getByTestId("select-item-preset-history-trade-all"));
    await user.click(
      screen.getByTestId("select-item-preset-history-applied-by-user-alice"),
    );

    await waitFor(() => {
      expect(screen.getByTestId("row-preset-history-h-alice-gc")).toBeTruthy();
    });
    expect(screen.queryByTestId("row-preset-history-h-bob-earth")).toBeNull();
    expect(screen.queryByTestId("row-preset-history-h-system-gc")).toBeNull();

    const sawActorOnly = presetHistoryRequests().some((u) => {
      return (
        u.searchParams.get("appliedById") === "user-alice" &&
        u.searchParams.get("tradeType") === null
      );
    });
    expect(sawActorOnly).toBe(true);
  });

  it("renders the filtered empty state when no rows match the chosen trade + actor", async () => {
    const user = userEvent.setup();
    renderTab();

    await waitFor(() => {
      expect(screen.getByTestId("row-preset-history-h-alice-gc")).toBeTruthy();
    });

    // Bob never applied a GENERAL_CONTRACTOR preset, so this combo yields zero rows.
    await user.click(
      screen.getByTestId("select-item-preset-history-trade-GENERAL_CONTRACTOR"),
    );
    await user.click(
      screen.getByTestId("select-item-preset-history-applied-by-user-bob"),
    );

    await waitFor(() => {
      expect(screen.getByTestId("text-preset-history-empty")).toBeTruthy();
    });
    expect(screen.queryByTestId("list-preset-history")).toBeNull();
    const empty = screen.getByTestId("text-preset-history-empty");
    expect(empty.textContent).toContain("No ");
    expect(empty.textContent).toContain("match these filters");
    expect(empty.textContent).toContain("GENERAL CONTRACTOR");
    expect(empty.textContent).toContain("Bob Builder");
  });
});
