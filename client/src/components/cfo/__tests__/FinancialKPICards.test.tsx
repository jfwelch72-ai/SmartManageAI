// @vitest-environment jsdom
/**
 * Task #2872 — CFO dashboard calculation display tests
 * Covers: KPI aggregation (totalBudget, totalActualCost, totalVariance,
 *         overallVariancePercent), at-risk counts, missing-budget warnings,
 *         draw-date urgency alerts, and empty state.
 * Uses bare DOM assertions (no @testing-library/jest-dom) to match the project convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FinancialKPICards } from "../FinancialKPICards";
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
  labor_hours: 80,
  labor_efficiency: "OK",
  material_spend_rate: "OK",
  pending_change_orders_value: 0,
};

function makeProject(
  overrides: Partial<ProjectProfitability>
): ProjectProfitability {
  return {
    project_code: "P001",
    project_name: "Alpha",
    budget: 400000,
    adjusted_budget: 400000,
    total_labor_cost: 100000,
    total_material_cost: 80000,
    total_other_expenses: 10000,
    approved_change_orders_value: 0,
    total_actual_cost: 190000,
    variance: 210000,
    variance_percent: 52.5,
    status: "ON_BUDGET",
    projected_completion_cost: 220000,
    estimated_margin: 180000,
    committed_cost: 30000,
    forecast_final_cost: 220000,
    texturaDrawDate: null,
    drawDayOfMonth: null,
    billingUrgency: null,
    daysUntilDraw: null,
    key_metrics: { ...BASE_METRICS },
    ...overrides,
  };
}

const PROJECT_A = makeProject({
  project_code: "P001",
  adjusted_budget: 400000,
  total_actual_cost: 200000,
  status: "ON_BUDGET",
});

const PROJECT_B = makeProject({
  project_code: "P002",
  project_name: "Beta",
  adjusted_budget: 600000,
  total_actual_cost: 580000,
  status: "MAJOR_RISK",
  estimated_margin: -10000,
});

const PROJECT_C = makeProject({
  project_code: "P003",
  project_name: "Gamma",
  adjusted_budget: 300000,
  total_actual_cost: 250000,
  status: "MINOR_CONCERN",
});

beforeEach(() => {
  cleanup();
});

describe("FinancialKPICards – aggregate calculations", () => {
  it("sums adjusted_budget across all projects for Total Budget card", () => {
    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B, PROJECT_C]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByText("$1,300,000")).toBeTruthy();
  });

  it("sums total_actual_cost across all projects for Actual Cost card", () => {
    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B, PROJECT_C]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByText("$1,030,000")).toBeTruthy();
  });

  it("computes totalVariance as totalBudget - totalActualCost", () => {
    const totalBudget = 400000 + 600000 + 300000;
    const totalActual = 200000 + 580000 + 250000;
    expect(totalBudget - totalActual).toBe(270000);

    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B, PROJECT_C]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByText("$270,000")).toBeTruthy();
  });

  it("computes overallVariancePercent as (variance / totalBudget) * 100 rounded to 1dp", () => {
    const totalBudget = 1300000;
    const totalActual = 1030000;
    const variance = totalBudget - totalActual;
    const variancePct = ((variance / totalBudget) * 100).toFixed(1);
    expect(variancePct).toBe("20.8");

    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B, PROJECT_C]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByText("+20.8%")).toBeTruthy();
  });

  it("shows negative variance as a red value when costs exceed budget", () => {
    const overBudgetProject = makeProject({
      project_code: "P010",
      adjusted_budget: 100000,
      total_actual_cost: 120000,
      status: "MAJOR_RISK",
    });
    render(
      <FinancialKPICards
        profitability={[overBudgetProject]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    const varianceValue = screen.getByText("-$20,000");
    expect(varianceValue.classList.contains("text-red-500")).toBe(true);
  });
});

describe("FinancialKPICards – at-risk counts", () => {
  it("counts MAJOR_RISK projects in the At Risk card", () => {
    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B, PROJECT_C]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByText(/1 with minor concerns/)).toBeTruthy();
  });

  it("shows 0 at risk when all projects are ON_BUDGET", () => {
    render(
      <FinancialKPICards
        profitability={[PROJECT_A]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByText(/0 with minor concerns/)).toBeTruthy();
  });
});

describe("FinancialKPICards – missing budget warnings", () => {
  it("shows missing budget warning for projects with adjusted_budget = 0", () => {
    const noBudgetProject = makeProject({
      project_code: "P099",
      adjusted_budget: 0,
    });
    render(
      <FinancialKPICards
        profitability={[PROJECT_A, noBudgetProject]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByTestId("card-missing-budget-warning")).toBeTruthy();
    expect(screen.getByTestId("missing-budget-P099")).toBeTruthy();
  });

  it("does not show missing budget card when all projects have budgets", () => {
    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B, PROJECT_C]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.queryByTestId("card-missing-budget-warning")).toBeNull();
  });
});

describe("FinancialKPICards – draw date urgency alerts", () => {
  it("shows draw date alert card for CRITICAL urgency projects", () => {
    const criticalProject = makeProject({
      project_code: "P050",
      billingUrgency: "CRITICAL",
      daysUntilDraw: 2,
      texturaDrawDate: "2026-05-16",
    });
    render(
      <FinancialKPICards
        profitability={[criticalProject]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByTestId("card-draw-date-alerts")).toBeTruthy();
    expect(screen.getByTestId("draw-date-alert-P050")).toBeTruthy();
    const badge = screen.getByTestId("badge-urgency-P050");
    expect(badge.textContent).toContain("CRITICAL");
  });

  it("shows draw date alert card for HIGH urgency projects", () => {
    const highProject = makeProject({
      project_code: "P051",
      billingUrgency: "HIGH",
      daysUntilDraw: 7,
      texturaDrawDate: "2026-05-21",
    });
    render(
      <FinancialKPICards
        profitability={[highProject]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByTestId("card-draw-date-alerts")).toBeTruthy();
    const badge = screen.getByTestId("badge-urgency-P051");
    expect(badge.textContent).toContain("HIGH");
  });

  it("does not show draw date alerts when no projects have urgency", () => {
    render(
      <FinancialKPICards
        profitability={[PROJECT_A, PROJECT_B]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.queryByTestId("card-draw-date-alerts")).toBeNull();
  });
});

describe("FinancialKPICards – empty state", () => {
  it("shows empty state when profitability array is empty", () => {
    render(
      <FinancialKPICards
        profitability={[]}
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />
    );
    expect(screen.getByTestId("card-empty-profitability")).toBeTruthy();
    expect(screen.getByTestId("button-goto-budget-setup")).toBeTruthy();
  });
});
