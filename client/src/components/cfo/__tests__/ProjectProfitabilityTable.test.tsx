// @vitest-environment jsdom
/**
 * Task #2872 — CFO dashboard calculation display tests
 * Covers: margin display, variance % formatting, status badges, sort order,
 *         color-coding thresholds, and pending CO warning display.
 * Uses bare DOM assertions (no @testing-library/jest-dom) to match the project convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProjectProfitabilityTable } from "../ProjectProfitabilityTable";
import type { ProjectProfitability } from "../types";

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

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

const BASE_METRICS = {
  labor_hours: 120,
  labor_efficiency: "Good",
  material_spend_rate: "On Track",
  pending_change_orders_value: 0,
};

function makeProject(
  overrides: Partial<ProjectProfitability>
): ProjectProfitability {
  return {
    project_code: "P001",
    project_name: "Test Project",
    budget: 500000,
    total_labor_cost: 150000,
    total_material_cost: 100000,
    total_other_expenses: 20000,
    approved_change_orders_value: 10000,
    adjusted_budget: 510000,
    total_actual_cost: 270000,
    variance: 240000,
    variance_percent: 47.1,
    status: "ON_BUDGET",
    projected_completion_cost: 310000,
    estimated_margin: 200000,
    committed_cost: 50000,
    forecast_final_cost: 310000,
    texturaDrawDate: null,
    drawDayOfMonth: null,
    billingUrgency: null,
    daysUntilDraw: null,
    key_metrics: { ...BASE_METRICS },
    ...overrides,
  };
}

const ON_BUDGET_PROJECT = makeProject({});

const MAJOR_RISK_PROJECT = makeProject({
  project_code: "P002",
  project_name: "Over Budget Project",
  total_actual_cost: 490000,
  variance: 20000,
  variance_percent: 3.9,
  status: "MAJOR_RISK",
  estimated_margin: -20000,
});

const MINOR_CONCERN_PROJECT = makeProject({
  project_code: "P003",
  project_name: "Concern Project",
  total_actual_cost: 370000,
  variance: 140000,
  variance_percent: 27.5,
  status: "MINOR_CONCERN",
  estimated_margin: 80000,
});

const NO_BUDGET_PROJECT = makeProject({
  project_code: "P004",
  project_name: "No Budget Project",
  adjusted_budget: 0,
  estimated_margin: 0,
});

beforeEach(() => {
  cleanup();
});

describe("ProjectProfitabilityTable – margin and variance display", () => {
  it("renders positive estimated margin in green", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[ON_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    const card = screen.getByTestId("card-project-P001");
    const marginEl = card.querySelector(".text-green-500");
    expect(marginEl).toBeTruthy();
    expect(marginEl!.textContent).toContain("$200,000");
  });

  it("renders negative estimated margin in red", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[MAJOR_RISK_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    const card = screen.getByTestId("card-project-P002");
    const marginEl = card.querySelector(".text-red-500");
    expect(marginEl).toBeTruthy();
    expect(marginEl!.textContent).toContain("-$20,000");
  });

  it("renders variance percentage with one decimal place", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[ON_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText(/47\.1%/)).toBeTruthy();
  });

  it("renders formatted budget and actual cost in the card description", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[ON_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText(/\$510,000/)).toBeTruthy();
    expect(screen.getByText(/\$270,000/)).toBeTruthy();
  });
});

describe("ProjectProfitabilityTable – status badge color-coding", () => {
  it("shows On Budget badge for ON_BUDGET status", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[ON_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText("On Budget")).toBeTruthy();
  });

  it("shows Minor Concern badge for MINOR_CONCERN status", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[MINOR_CONCERN_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText("Minor Concern")).toBeTruthy();
  });

  it("shows Major Risk badge for MAJOR_RISK status", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[MAJOR_RISK_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText("Major Risk")).toBeTruthy();
  });
});

describe("ProjectProfitabilityTable – sort order", () => {
  it("sorts MAJOR_RISK before MINOR_CONCERN before ON_BUDGET when budgets are present", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[
          ON_BUDGET_PROJECT,
          MINOR_CONCERN_PROJECT,
          MAJOR_RISK_PROJECT,
        ]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    const cards = screen
      .getAllByTestId(/^card-project-/)
      .map((el) => el.getAttribute("data-testid"));
    expect(cards[0]).toBe("card-project-P002");
    expect(cards[1]).toBe("card-project-P003");
    expect(cards[2]).toBe("card-project-P001");
  });

  it("hoists projects with no budget to the top of the list", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[ON_BUDGET_PROJECT, NO_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    const cards = screen
      .getAllByTestId(/^card-project-/)
      .map((el) => el.getAttribute("data-testid"));
    expect(cards[0]).toBe("card-project-P004");
  });
});

describe("ProjectProfitabilityTable – pending change orders", () => {
  it("shows pending CO warning when pending_change_orders_value > 0", () => {
    const projectWithPendingCOs = makeProject({
      key_metrics: {
        ...BASE_METRICS,
        pending_change_orders_value: 25000,
      },
    });
    render(
      <ProjectProfitabilityTable
        profitability={[projectWithPendingCOs]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText(/Pending Change Orders/)).toBeTruthy();
    expect(screen.getByText(/\$25,000/)).toBeTruthy();
  });

  it("hides the pending CO warning when value is 0", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[ON_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.queryByText(/Pending Change Orders/)).toBeNull();
  });
});

describe("ProjectProfitabilityTable – no budget state", () => {
  it("shows No Budget badge when adjusted_budget is 0", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[NO_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(screen.getByText("No Budget")).toBeTruthy();
  });

  it("shows 'Budget data required' message for no-budget projects", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[NO_BUDGET_PROJECT]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(
      screen.getByText(/Budget data required for profitability tracking/)
    ).toBeTruthy();
  });
});

describe("ProjectProfitabilityTable – empty state", () => {
  it("shows empty state when profitability array is empty", () => {
    render(
      <ProjectProfitabilityTable
        profitability={[]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(
      screen.getByText(/No profitability data available/)
    ).toBeTruthy();
    expect(screen.getByTestId("cfo-empty-state-run-analysis")).toBeTruthy();
  });

  it("shows empty state when profitability is undefined", () => {
    render(
      <ProjectProfitabilityTable
        profitability={undefined}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
        onRunAnalysis={vi.fn()}
        isAnalysisPending={false}
      />
    );
    expect(
      screen.getByText(/No profitability data available/)
    ).toBeTruthy();
  });
});
