// @vitest-environment jsdom
/**
 * Task #2872 — CFO dashboard calculation display tests
 * Covers: forecast summary card values, S-curve chart series mapping,
 *         negative variance flagging (red), early warning display,
 *         budget alert level badges, and project-level forecast rows.
 * Uses bare DOM assertions (no @testing-library/jest-dom) to match the project convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CostForecastingSection } from "../CostForecastingSection";
import type { CFOForecastingData, BudgetAlertItem } from "../types";

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

vi.mock("recharts", () => ({
  AreaChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data?: Array<unknown>;
  }) => (
    <div data-testid="area-chart" data-point-count={data?.length}>
      {children}
    </div>
  ),
  Area: ({ dataKey, name }: { dataKey: string; name: string }) => (
    <div data-testid={`area-series-${dataKey}`} data-name={name} />
  ),
  XAxis: ({ dataKey }: { dataKey: string }) => (
    <div data-testid="xaxis" data-key={dataKey} />
  ),
  YAxis: () => <div data-testid="yaxis" />,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
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

const MOCK_FORECASTING: CFOForecastingData = {
  summary: {
    portfolio_budget: 2000000,
    portfolio_ffc: 2150000,
    portfolio_committed: 800000,
    portfolio_actual: 1100000,
    portfolio_variance: -150000,
    project_count: 5,
    at_risk_count: 2,
    early_warning_count: 1,
  },
  projects: [
    {
      project_code: "PA",
      project_name: "Alpha",
      budget: 600000,
      committed: 200000,
      actual: 350000,
      ffc: 620000,
      variance: -20000,
      variance_percent: -3.3,
      status: "MAJOR_RISK",
      cost_prediction: {
        weekly_burn_rate: 15000,
        burn_rate_trend: "INCREASING",
        predicted_overrun: 20000,
        confidence_score: 80,
        weeks_until_overrun: 3,
        forecast_at_completion: 620000,
        early_warning: true,
        warning_message: "Burn rate exceeds budget pace",
      },
    },
    {
      project_code: "PB",
      project_name: "Beta",
      budget: 1400000,
      committed: 600000,
      actual: 750000,
      ffc: 1350000,
      variance: 50000,
      variance_percent: 3.6,
      status: "ON_BUDGET",
    },
  ],
  alerts: [],
  early_warnings: [
    {
      project_code: "PA",
      project_name: "Alpha",
      warning_message: "Burn rate exceeds budget pace",
      predicted_overrun: 20000,
      confidence_score: 80,
      weeks_until_overrun: 3,
      burn_rate_trend: "INCREASING",
      weekly_burn_rate: 15000,
    },
  ],
};

const MOCK_S_CURVE = {
  months: [
    { month: "Jan 2026", planned: 100000, actual: 95000, forecast: null },
    { month: "Feb 2026", planned: 250000, actual: 230000, forecast: null },
    { month: "Mar 2026", planned: 400000, actual: null, forecast: 420000 },
    { month: "Apr 2026", planned: 600000, actual: null, forecast: 650000 },
  ],
};

const MOCK_ALERTS: BudgetAlertItem[] = [
  {
    id: "alert-1",
    projectId: "proj-a",
    costCode: null,
    alertLevel: "CRITICAL",
    thresholdPercent: 90,
    currentPercent: 95,
    budgetAmount: 600000,
    actualAmount: 570000,
    createdAt: "2026-05-01T00:00:00Z",
    projectCode: "PA",
    projectName: "Alpha",
  },
  {
    id: "alert-2",
    projectId: "proj-b",
    costCode: "LABOR",
    alertLevel: "WARNING",
    thresholdPercent: 80,
    currentPercent: 84,
    budgetAmount: 1400000,
    actualAmount: 1176000,
    createdAt: "2026-05-02T00:00:00Z",
    projectCode: "PB",
    projectName: "Beta",
  },
];

describe("CostForecastingSection – summary card values", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qc.setQueryData(["/api/cfo/budget-alerts"], []);
    qc.setQueryData(["/api/cfo/scurve-data"], { months: [] });
  });

  it("renders Portfolio Budget card with correct value", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const card = screen.getByTestId("card-portfolio-budget");
    expect(card.textContent).toContain("$2,000,000");
    expect(card.textContent).toContain("5 active projects");
  });

  it("renders Committed card with correct value", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("card-portfolio-committed").textContent).toContain(
      "$800,000"
    );
  });

  it("renders Forecast Final Cost card with correct value", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("card-portfolio-ffc").textContent).toContain(
      "$2,150,000"
    );
  });

  it("renders FFC Variance as red text when negative (over budget)", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const varianceCard = screen.getByTestId("card-portfolio-variance");
    // The value div uses both text-2xl and text-red-500; the icon uses only text-red-500.
    const redValues = Array.from(varianceCard.querySelectorAll(".text-red-500"));
    const redValueEl = redValues.find((el) => el.textContent && el.textContent.trim().length > 0);
    expect(redValueEl).toBeTruthy();
    expect(redValueEl!.textContent).toContain("-$150,000");
  });

  it("renders At Risk count", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const atRiskCard = screen.getByTestId("card-portfolio-atrisk");
    expect(atRiskCard.textContent).toContain("2");
  });

  it("renders Early Warnings count card when early_warning_count > 0", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const warningCard = screen.getByTestId("card-early-warnings-count");
    expect(warningCard.textContent).toContain("1");
  });
});

describe("CostForecastingSection – S-curve chart series mapping", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qc.setQueryData(["/api/cfo/budget-alerts"], []);
    qc.setQueryData(["/api/cfo/scurve-data"], MOCK_S_CURVE);
  });

  it("renders the S-curve chart card when months data is present", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("card-scurve-chart")).toBeTruthy();
  });

  it("maps planned series to the chart with correct name", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const plannedSeries = screen.getByTestId("area-series-planned");
    expect(plannedSeries).toBeTruthy();
    expect(plannedSeries.getAttribute("data-name")).toBe("Planned (Budget)");
  });

  it("maps actual series to the chart with correct name", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const actualSeries = screen.getByTestId("area-series-actual");
    expect(actualSeries).toBeTruthy();
    expect(actualSeries.getAttribute("data-name")).toBe("Actual Spend");
  });

  it("maps forecast series to the chart with correct name", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const forecastSeries = screen.getByTestId("area-series-forecast");
    expect(forecastSeries).toBeTruthy();
    expect(forecastSeries.getAttribute("data-name")).toBe("Forecast");
  });

  it("passes all 4 months as data points to the AreaChart", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const chart = screen.getByTestId("area-chart");
    expect(chart.getAttribute("data-point-count")).toBe("4");
  });

  it("does not render the S-curve chart when months array is empty", () => {
    const qcEmpty = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qcEmpty.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qcEmpty.setQueryData(["/api/cfo/budget-alerts"], []);
    qcEmpty.setQueryData(["/api/cfo/scurve-data"], { months: [] });

    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qcEmpty) }
    );
    expect(screen.queryByTestId("card-scurve-chart")).toBeNull();
  });
});

describe("CostForecastingSection – early warnings", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qc.setQueryData(["/api/cfo/budget-alerts"], []);
    qc.setQueryData(["/api/cfo/scurve-data"], { months: [] });
  });

  it("renders the early warnings card when early_warnings are present", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("card-early-warnings")).toBeTruthy();
  });

  it("shows warning row for each early warning project", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("warning-PA")).toBeTruthy();
  });

  it("displays the warning message text", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(
      screen.getByText(/Burn rate exceeds budget pace/)
    ).toBeTruthy();
  });

  it("displays predicted overrun value for early warning", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const warningRow = screen.getByTestId("warning-PA");
    expect(warningRow.textContent).toContain("$20,000");
  });

  it("shows weeks until overrun for early warning projects", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByText(/~3 weeks to overrun/)).toBeTruthy();
  });
});

describe("CostForecastingSection – project forecast rows", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qc.setQueryData(["/api/cfo/budget-alerts"], []);
    qc.setQueryData(["/api/cfo/scurve-data"], { months: [] });
  });

  it("renders a row for each project in the forecasting table", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("row-forecast-project-PA")).toBeTruthy();
    expect(screen.getByTestId("row-forecast-project-PB")).toBeTruthy();
  });

  it("shows negative variance as red for over-budget project", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const row = screen.getByTestId("row-forecast-project-PA");
    const redCell = row.querySelector(".text-red-600");
    expect(redCell).toBeTruthy();
    expect(redCell!.textContent).toContain("-$20,000");
  });

  it("shows positive variance as green for on-budget project", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const row = screen.getByTestId("row-forecast-project-PB");
    const greenCell = row.querySelector(".text-green-600");
    expect(greenCell).toBeTruthy();
    expect(greenCell!.textContent).toContain("$50,000");
  });

  it("shows variance percent with sign prefix for on-budget project", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByText("+3.6%")).toBeTruthy();
  });

  it("displays weekly burn rate from cost_prediction", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const row = screen.getByTestId("row-forecast-project-PA");
    expect(row.textContent).toContain("$15,000");
    expect(row.textContent).toContain("/wk");
  });
});

describe("CostForecastingSection – budget alerts", () => {
  let qc: QueryClient;

  beforeEach(() => {
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qc.setQueryData(["/api/cfo/budget-alerts"], MOCK_ALERTS);
    qc.setQueryData(["/api/cfo/scurve-data"], { months: [] });
  });

  it("renders the budget alerts card when alerts are present", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("card-budget-alerts-list")).toBeTruthy();
  });

  it("renders a row for each alert", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(screen.getByTestId("alert-item-alert-1")).toBeTruthy();
    expect(screen.getByTestId("alert-item-alert-2")).toBeTruthy();
  });

  it("shows current percent and threshold for the critical alert", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(
      screen.getByText(/95% of budget used \(threshold: 90%\)/)
    ).toBeTruthy();
  });

  it("shows current percent and threshold for the warning alert", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    expect(
      screen.getByText(/84% of budget used \(threshold: 80%\)/)
    ).toBeTruthy();
  });

  it("shows CRITICAL badge for critical alert", () => {
    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qc) }
    );
    const criticalAlert = screen.getByTestId("alert-item-alert-1");
    expect(criticalAlert.textContent).toContain("CRITICAL");
  });

  it("does not render alert card when alerts list is empty", () => {
    const qcNoAlerts = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qcNoAlerts.setQueryData(["/api/cfo/forecasting"], MOCK_FORECASTING);
    qcNoAlerts.setQueryData(["/api/cfo/budget-alerts"], []);
    qcNoAlerts.setQueryData(["/api/cfo/scurve-data"], { months: [] });

    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qcNoAlerts) }
    );
    expect(screen.queryByTestId("card-budget-alerts-list")).toBeNull();
  });
});

describe("CostForecastingSection – FFC variance sign logic", () => {
  it("renders FFC Variance as green text when positive (under budget)", () => {
    const underBudgetForecast: CFOForecastingData = {
      ...MOCK_FORECASTING,
      summary: {
        ...MOCK_FORECASTING.summary,
        portfolio_variance: 50000,
      },
    };
    const qcPositive = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qcPositive.setQueryData(["/api/cfo/forecasting"], underBudgetForecast);
    qcPositive.setQueryData(["/api/cfo/budget-alerts"], []);
    qcPositive.setQueryData(["/api/cfo/scurve-data"], { months: [] });

    render(
      <CostForecastingSection
        formatCurrency={formatCurrency}
        onProjectClick={vi.fn()}
      />,
      { wrapper: makeWrapper(qcPositive) }
    );
    const varianceCard = screen.getByTestId("card-portfolio-variance");
    // The value div uses both text-2xl and text-green-500; the icon uses only text-green-500.
    const greenValues = Array.from(varianceCard.querySelectorAll(".text-green-500"));
    const greenValueEl = greenValues.find((el) => el.textContent && el.textContent.trim().length > 0);
    expect(greenValueEl).toBeTruthy();
    expect(greenValueEl!.textContent).toContain("$50,000");
  });
});
