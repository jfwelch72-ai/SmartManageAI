// @vitest-environment jsdom
/**
 * Task #2872 — CFO dashboard calculation display tests
 * Covers: revenue recognition (WIP schedule) chart/table data mapping and
 *         cash-flow (over/under billing) visual flagging.
 *
 * The WIP report uses the cost-to-cost revenue recognition method:
 *   earnedRevenue = contractValue * (costsToDate / estimatedTotalCost)
 *   overUnderBilling = earnedRevenue - billingsToDate
 *     > 0 → underbilled (asset, amber flag)
 *     < 0 → overbilled  (liability, blue flag)
 *
 * Uses bare DOM assertions (no @testing-library/jest-dom) matching the project
 * convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

import WipReportPage from "../wip-report";

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

interface WipProject {
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string | null;
  contractValue: number;
  changeOrderAdjustments: number;
  adjustedContractValue: number;
  costsToDate: number;
  estimatedTotalCost: number;
  percentComplete: number;
  earnedRevenue: number;
  billingsToDate: number;
  overUnderBilling: number;
  grossProfit: number;
  grossProfitPercent: number;
}

function makeProject(overrides: Partial<WipProject>): WipProject {
  return {
    projectId: "proj-1",
    projectCode: "P001",
    projectName: "Alpha Project",
    clientName: "ACME Corp",
    contractValue: 500000,
    changeOrderAdjustments: 10000,
    adjustedContractValue: 510000,
    costsToDate: 255000,
    estimatedTotalCost: 425000,
    percentComplete: 60,
    earnedRevenue: 306000,
    billingsToDate: 280000,
    overUnderBilling: 26000,
    grossProfit: 85000,
    grossProfitPercent: 16.7,
    ...overrides,
  };
}

const UNDERBILLED_PROJECT = makeProject({
  projectCode: "P001",
  earnedRevenue: 306000,
  billingsToDate: 280000,
  overUnderBilling: 26000,
  grossProfit: 85000,
  grossProfitPercent: 16.7,
});

const OVERBILLED_PROJECT = makeProject({
  projectId: "proj-2",
  projectCode: "P002",
  projectName: "Beta Project",
  earnedRevenue: 200000,
  billingsToDate: 240000,
  overUnderBilling: -40000,
  grossProfit: 30000,
  grossProfitPercent: 6.0,
});

const NEGATIVE_PROFIT_PROJECT = makeProject({
  projectId: "proj-3",
  projectCode: "P003",
  projectName: "Loss Project",
  costsToDate: 490000,
  estimatedTotalCost: 490000,
  percentComplete: 100,
  earnedRevenue: 480000,
  billingsToDate: 480000,
  overUnderBilling: 0,
  grossProfit: -10000,
  grossProfitPercent: -2.0,
});

const MOCK_WIP_DATA = {
  projects: [UNDERBILLED_PROJECT, OVERBILLED_PROJECT],
  totals: {
    contractValue: 1000000,
    changeOrderAdjustments: 20000,
    adjustedContractValue: 1020000,
    costsToDate: 495000,
    estimatedTotalCost: 850000,
    percentComplete: 58.2,
    earnedRevenue: 506000,
    billingsToDate: 520000,
    overUnderBilling: -14000,
    grossProfit: 115000,
    grossProfitPercent: 11.3,
  },
};

describe("WIP Report – revenue recognition period-to-value mapping", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/revenue-recognition/wip-report"], MOCK_WIP_DATA);
  });

  it("renders a WIP schedule row for each project in the dataset", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    expect(screen.getByTestId("row-project-P001")).toBeTruthy();
    expect(screen.getByTestId("row-project-P002")).toBeTruthy();
  });

  it("displays earned revenue value for each project row", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const row = screen.getByTestId("row-project-P001");
    expect(row.textContent).toContain("$306,000.00");
  });

  it("displays percent complete for each project row", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const row = screen.getByTestId("row-project-P001");
    expect(row.textContent).toContain("60.0%");
  });

  it("shows the totals row with aggregate earned revenue", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const totalsRow = screen.getByTestId("row-totals");
    expect(totalsRow.textContent).toContain("$506,000.00");
  });

  it("shows total adjusted contract value in the totals row", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const totalsRow = screen.getByTestId("row-totals");
    expect(totalsRow.textContent).toContain("$1,020,000.00");
  });

  it("renders the total earned revenue summary card", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const earnedCard = screen.getByTestId("card-total-earned");
    expect(earnedCard.textContent).toContain("$506,000.00");
  });

  it("renders the total adjusted contract summary card", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const contractCard = screen.getByTestId("card-total-contract");
    expect(contractCard.textContent).toContain("$1,020,000.00");
  });

  it("renders overall percent complete in the earned revenue card", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const earnedCard = screen.getByTestId("card-total-earned");
    expect(earnedCard.textContent).toContain("58.2% complete overall");
  });

  it("shows the WIP schedule table when project data is present", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    expect(screen.getByTestId("table-wip-schedule")).toBeTruthy();
  });

  it("shows empty state when no projects are returned", () => {
    const emptyQc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    emptyQc.setQueryData(["/api/revenue-recognition/wip-report"], {
      projects: [],
      totals: null,
    });
    render(<WipReportPage />, { wrapper: makeWrapper(emptyQc) });
    expect(screen.getByTestId("text-no-projects")).toBeTruthy();
  });
});

describe("WIP Report – cash flow: over/under billing visual flags", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/revenue-recognition/wip-report"], MOCK_WIP_DATA);
  });

  it("shows 'U' badge (underbilled) for projects where earnedRevenue > billingsToDate", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const badge = screen.getByTestId("badge-billing-P001");
    expect(badge.textContent).toBe("U");
  });

  it("shows 'O' badge (overbilled) for projects where earnedRevenue < billingsToDate", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const badge = screen.getByTestId("badge-billing-P002");
    expect(badge.textContent).toBe("O");
  });

  it("renders the underbilled total summary card with amber styling", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const underbilledEl = screen.getByTestId("text-total-underbilled");
    expect(underbilledEl.classList.contains("text-amber-600")).toBe(true);
    expect(underbilledEl.textContent).toContain("$26,000.00");
  });

  it("renders the overbilled total summary card with blue styling", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const overbilledEl = screen.getByTestId("text-total-overbilled");
    expect(overbilledEl.classList.contains("text-blue-600")).toBe(true);
    expect(overbilledEl.textContent).toContain("$40,000.00");
  });

  it("negative overUnderBilling total is shown with parentheses notation", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const totalsRow = screen.getByTestId("row-totals");
    expect(totalsRow.textContent).toContain("($14,000.00)");
  });

  it("underbilled project count displayed in underbilled card", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const card = screen.getByTestId("card-underbilled");
    expect(card.textContent).toContain("1 projects");
  });

  it("overbilled project count displayed in overbilled card", () => {
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const card = screen.getByTestId("card-overbilled");
    expect(card.textContent).toContain("1 projects");
  });
});

describe("WIP Report – gross profit color-coding (negative cash flow flagging)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("displays negative gross profit in red for a loss-making project", () => {
    qc.setQueryData(["/api/revenue-recognition/wip-report"], {
      projects: [NEGATIVE_PROFIT_PROJECT],
      totals: null,
    });
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const row = screen.getByTestId("row-project-P003");
    const redCell = row.querySelector(".text-red-600");
    expect(redCell).toBeTruthy();
    expect(redCell!.textContent).toContain("($10,000.00)");
  });

  it("displays positive gross profit in green", () => {
    qc.setQueryData(["/api/revenue-recognition/wip-report"], {
      projects: [UNDERBILLED_PROJECT],
      totals: null,
    });
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const row = screen.getByTestId("row-project-P001");
    const greenCell = row.querySelector(".text-green-600");
    expect(greenCell).toBeTruthy();
    expect(greenCell!.textContent).toContain("$85,000.00");
  });

  it("shows negative gross profit total as red in the totals row", () => {
    qc.setQueryData(["/api/revenue-recognition/wip-report"], {
      projects: [NEGATIVE_PROFIT_PROJECT],
      totals: {
        ...MOCK_WIP_DATA.totals,
        grossProfit: -10000,
        grossProfitPercent: -2.0,
      },
    });
    render(<WipReportPage />, { wrapper: makeWrapper(qc) });
    const totalsRow = screen.getByTestId("row-totals");
    const redCell = totalsRow.querySelector(".text-red-600");
    expect(redCell).toBeTruthy();
  });
});
