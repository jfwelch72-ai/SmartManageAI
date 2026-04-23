// @vitest-environment jsdom
/**
 * Task #1330 — verifies the payroll-page MissingWageDecisionsBanner only
 * renders when the /api/payroll/missing-wage-decisions response includes a
 * non-empty list, and that it lists each affected project + decision number
 * with a link to the Davis-Bacon import flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => ({ items: [] }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { MissingWageDecisionsBanner } from "../MissingWageDecisionsBanner";

function renderBanner(items: Array<{ projectId: string; projectName: string; wageDecision: string }>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/payroll/missing-wage-decisions"], { items });
  const { hook } = memoryLocation({ path: "/payroll" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <MissingWageDecisionsBanner />
      </Router>
    </QueryClientProvider>,
  );
}

describe("MissingWageDecisionsBanner", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("does not render when the list is empty", () => {
    renderBanner([]);
    expect(screen.queryByTestId("banner-payroll-missing-wage-decisions")).toBeNull();
  });

  it("renders the affected projects + decision numbers and the import link when non-empty", () => {
    renderBanner([
      { projectId: "p1", projectName: "Bridge Repair", wageDecision: "CA20240001" },
      { projectId: "p2", projectName: "Levee Rehab", wageDecision: "CA20240002" },
    ]);

    const banner = screen.getByTestId("banner-payroll-missing-wage-decisions");
    expect(banner).toBeTruthy();
    expect(screen.getByTestId("text-missing-wage-decisions-title").textContent).toBe(
      "2 projects reference wage decisions that haven't been imported",
    );

    const row0 = screen.getByTestId("text-payroll-missing-decision-0");
    expect(row0.textContent).toContain("Bridge Repair");
    expect(row0.textContent).toContain("CA20240001");

    const row1 = screen.getByTestId("text-payroll-missing-decision-1");
    expect(row1.textContent).toContain("Levee Rehab");
    expect(row1.textContent).toContain("CA20240002");

    expect(screen.getByTestId("button-payroll-import-decision-0")).toBeTruthy();
    expect(screen.getByTestId("button-payroll-import-decision-1")).toBeTruthy();

    const link = screen.getByTestId("link-davis-bacon-import").closest("a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/integrations");
  });

  it("uses the singular title when exactly one project is missing", () => {
    renderBanner([
      { projectId: "p1", projectName: "Bridge Repair", wageDecision: "CA20240001" },
    ]);
    expect(screen.getByTestId("text-missing-wage-decisions-title").textContent).toBe(
      "1 project references a wage decision that hasn't been imported",
    );
  });
});
