// @vitest-environment jsdom
/**
 * Task #2680 — render-based parity test for the public `/sla` page.
 *
 * The unit suite under `server/support/__tests__/slaPolicy.test.ts`
 * pins the canonical SLA module + the markdown doc. This file pins the
 * other end of the chain: when SlaPage actually mounts, every cell it
 * paints must come from `buildTierTableRows()` so a future hand-typed
 * regression in the JSX would fail this test instead of silently
 * drifting from `shared/sla/policy.ts`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SlaPage from "../sla";
import { buildTierTableRows } from "@shared/sla/format";

afterEach(() => cleanup());

function renderPage() {
  const { hook } = memoryLocation({ path: "/sla" });
  return render(
    <Router hook={hook}>
      <SlaPage />
    </Router>,
  );
}

describe("SlaPage renders straight from the canonical SLA module", () => {
  it("paints every label + cell returned by buildTierTableRows() into the tier table", () => {
    renderPage();
    const table = screen.getByTestId("table-sla-tiers");
    const rows = buildTierTableRows();
    expect(rows.length).toBeGreaterThan(0);

    for (const [label, starter, pro, enterprise] of rows) {
      // Locate the row by its label cell, then assert each tier cell
      // appears within the same row. Using a row-scoped query rules
      // out accidental matches from other parts of the page.
      const labelCell = within(table).getByText(label);
      const tr = labelCell.closest("tr");
      expect(tr).not.toBeNull();
      const scoped = within(tr as HTMLElement);
      expect(scoped.getByText(starter)).toBeTruthy();
      expect(scoped.getByText(pro)).toBeTruthy();
      expect(scoped.getByText(enterprise)).toBeTruthy();
    }
  });

  it("renders the canonical Enterprise urgent first-response cell (24×7)", () => {
    renderPage();
    // This is the most-cited SLA promise on the page; pin it explicitly
    // so a copy-paste regression in JSX is caught in isolation.
    const table = screen.getByTestId("table-sla-tiers");
    expect(within(table).getByText("30 minutes (24×7)")).toBeTruthy();
  });

  it("renders the canonical channel strings for every tier", () => {
    renderPage();
    const table = screen.getByTestId("table-sla-tiers");
    expect(within(table).getByText("In-app + email")).toBeTruthy();
    expect(within(table).getByText("In-app + email + Slack")).toBeTruthy();
    expect(within(table).getByText("In-app + email + Slack + CSM")).toBeTruthy();
  });
});
