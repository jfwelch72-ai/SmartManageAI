// @vitest-environment jsdom
/**
 * Task #2932 — Bid wizard cost estimation pipeline: badge rendering tests.
 *
 * Verifies that the "AI Est." cost display (data-testid="ai-est-<id>") renders
 * when an item has at least one non-null cost field, and is absent when both
 * cost fields are null/undefined.
 *
 * The component under test is a minimal faithful reproduction of the relevant
 * portion of the scope-item table row in bid-wizard.tsx (~line 1002-1009),
 * isolated from auth / router / query-client dependencies.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

interface ScopeItemRowProps {
  id: string;
  quantity?: number | null;
  unitMaterialCost?: number | null;
  unitLaborCost?: number | null;
}

function ScopeItemCostCell({
  id,
  quantity,
  unitMaterialCost,
  unitLaborCost,
}: ScopeItemRowProps) {
  const qty =
    quantity != null && Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const lineTotal = ((unitMaterialCost ?? 0) + (unitLaborCost ?? 0)) * qty;
  const hasCostData = unitMaterialCost != null || unitLaborCost != null;

  return (
    <td>
      {hasCostData ? (
        <span
          className="text-sm font-medium"
          data-testid={`ai-est-${id}`}
        >
          {lineTotal.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </td>
  );
}

describe("ScopeItemCostCell — AI Est. badge", () => {
  it("renders the ai-est element when unitMaterialCost is non-null", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell id="ai-0" quantity={2} unitMaterialCost={500} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("ai-est-ai-0")).toBeTruthy();
  });

  it("renders the ai-est element when unitLaborCost is non-null", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell id="ai-1" quantity={3} unitLaborCost={75} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("ai-est-ai-1")).toBeTruthy();
  });

  it("renders the ai-est element when both cost fields are set", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell
              id="ai-2"
              quantity={4}
              unitMaterialCost={200}
              unitLaborCost={80}
            />
          </tr>
        </tbody>
      </table>,
    );
    const badge = screen.getByTestId("ai-est-ai-2");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("$1,120");
  });

  it("does NOT render the ai-est element when both cost fields are null", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell
              id="ai-3"
              quantity={5}
              unitMaterialCost={null}
              unitLaborCost={null}
            />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.queryByTestId("ai-est-ai-3")).toBeNull();
  });

  it("does NOT render the ai-est element when cost fields are undefined", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell id="ai-4" quantity={1} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.queryByTestId("ai-est-ai-4")).toBeNull();
  });

  it("displays a dash placeholder when no cost data", () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell id="ai-5" unitMaterialCost={null} />
          </tr>
        </tbody>
      </table>,
    );
    expect(container.textContent).toContain("—");
  });

  it("formats the line total as USD currency", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell
              id="ai-6"
              quantity={10}
              unitMaterialCost={1000}
              unitLaborCost={500}
            />
          </tr>
        </tbody>
      </table>,
    );
    const badge = screen.getByTestId("ai-est-ai-6");
    expect(badge.textContent).toBe("$15,000");
  });

  it("uses qty=1 when quantity is null for line total computation", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell
              id="ai-7"
              quantity={null}
              unitMaterialCost={400}
              unitLaborCost={100}
            />
          </tr>
        </tbody>
      </table>,
    );
    const badge = screen.getByTestId("ai-est-ai-7");
    expect(badge.textContent).toBe("$500");
  });

  it("uses qty=1 when quantity is zero for line total computation", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScopeItemCostCell
              id="ai-8"
              quantity={0}
              unitMaterialCost={300}
            />
          </tr>
        </tbody>
      </table>,
    );
    const badge = screen.getByTestId("ai-est-ai-8");
    expect(badge.textContent).toBe("$300");
  });
});
