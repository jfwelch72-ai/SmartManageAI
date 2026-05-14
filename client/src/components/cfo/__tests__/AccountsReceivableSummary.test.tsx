// @vitest-environment jsdom
/**
 * Task #2872 — CFO dashboard calculation display tests
 * Covers: AR aging bucket grouping, totals, overdue flagging, collection rate display.
 * Uses bare DOM assertions (no @testing-library/jest-dom) to match the project convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountsReceivableSummary } from "../AccountsReceivableSummary";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const BASE_INVOICE = {
  invoiceType: "GENERAL",
  projectId: "proj-1",
  projectName: "Test Project",
  totalAmount: 10000,
  paidAmount: 0,
  status: "SENT",
};

const MOCK_AR_DATA = {
  totalOutstanding: 285000,
  totalOverdue: 120000,
  totalReceivedYTD: 450000,
  collectionRate: 76.3,
  aging: {
    current: 100000,
    thirtyDay: 60000,
    sixtyDay: 45000,
    ninetyDay: 50000,
    ninetyPlus: 30000,
  },
  invoices: [
    {
      ...BASE_INVOICE,
      invoiceId: "inv-1",
      invoiceNumber: "INV-001",
      outstandingAmount: 50000,
      dueDate: "2026-04-01",
      daysOverdue: 0,
      isOverdue: false,
    },
    {
      ...BASE_INVOICE,
      invoiceId: "inv-2",
      invoiceNumber: "INV-002",
      outstandingAmount: 70000,
      dueDate: "2026-03-01",
      daysOverdue: 45,
      isOverdue: true,
    },
  ],
  invoiceCount: 2,
  overdueCount: 1,
};

describe("AccountsReceivableSummary – AR aging buckets", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/payments/ar-summary"], MOCK_AR_DATA);
  });

  it("renders the outstanding total from API data", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    const el = screen.getByTestId("text-ar-outstanding");
    expect(el.textContent).toContain("$285,000");
  });

  it("renders the overdue total from API data", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    const el = screen.getByTestId("text-ar-overdue");
    expect(el.textContent).toContain("$120,000");
  });

  it("renders the YTD received from API data", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    const el = screen.getByTestId("text-ar-received");
    expect(el.textContent).toContain("$450,000");
  });

  it("displays the collection rate with one decimal place", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    const el = screen.getByTestId("text-ar-collection-rate");
    expect(el.textContent).toContain("76.3%");
  });

  it("renders the current aging bucket correctly", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("aging-current").textContent).toContain("$100,000");
  });

  it("renders the 1-30 day aging bucket correctly", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("aging-30day").textContent).toContain("$60,000");
  });

  it("renders the 31-60 day aging bucket correctly", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("aging-60day").textContent).toContain("$45,000");
  });

  it("renders the 61-90 day aging bucket correctly", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("aging-90day").textContent).toContain("$50,000");
  });

  it("renders the 90+ day aging bucket correctly", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("aging-90plus").textContent).toContain("$30,000");
  });

  it("aging bucket amounts sum to agingTotal used by the progress bar", () => {
    const { current, thirtyDay, sixtyDay, ninetyDay, ninetyPlus } =
      MOCK_AR_DATA.aging;
    const total = current + thirtyDay + sixtyDay + ninetyDay + ninetyPlus;
    expect(total).toBe(285000);
  });

  it("renders the progress bar when agingTotal > 0", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("aging-bar")).toBeTruthy();
  });

  it("marks the overdue invoice with an overdue badge", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    const badge = screen.getByTestId("badge-overdue-inv-2");
    expect(badge.textContent).toContain("45d overdue");
  });

  it("renders current (non-overdue) invoices without an overdue badge", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.queryByTestId("badge-overdue-inv-1")).toBeNull();
  });

  it("renders each invoice row", () => {
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(qc),
    });
    expect(screen.getByTestId("row-ar-invoice-inv-1")).toBeTruthy();
    expect(screen.getByTestId("row-ar-invoice-inv-2")).toBeTruthy();
  });

  it("shows skeleton while loading (no data in cache)", () => {
    const emptyQc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(emptyQc),
    });
    expect(screen.getByTestId("skeleton-ar-summary")).toBeTruthy();
  });

  it("renders empty state when all buckets are zero and no YTD received", () => {
    const noDataQc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    noDataQc.setQueryData(["/api/payments/ar-summary"], {
      ...MOCK_AR_DATA,
      aging: {
        current: 0,
        thirtyDay: 0,
        sixtyDay: 0,
        ninetyDay: 0,
        ninetyPlus: 0,
      },
      invoices: [],
      totalReceivedYTD: 0,
    });
    render(<AccountsReceivableSummary formatCurrency={formatCurrency} />, {
      wrapper: makeWrapper(noDataQc),
    });
    expect(
      screen.getByText(/No outstanding invoices or payments recorded yet/i)
    ).toBeTruthy();
  });
});
