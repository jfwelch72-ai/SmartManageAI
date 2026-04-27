// @vitest-environment jsdom
/**
 * Task #2132 — Direct unit coverage for the shared `TakeoffCtaPane`
 * extracted in Task #2090. The bid and project Plans tabs both render
 * this component; the existing e2e specs only touch it in context.
 *
 * These tests pin down the per-`kind` branching that the e2e specs
 * implicitly depend on so a future tweak to one surface can't quietly
 * regress the other:
 *   - `kind: "bid"`     → container `takeoff-cta-pane`,
 *                          button `button-open-takeoff-workspace`,
 *                          href `/takeoff/<code>` (+ `?sheet=<id>`).
 *   - `kind: "project"` → container `project-takeoff-cta-pane`,
 *                          button `button-open-project-takeoff-workspace`,
 *                          href `/takeoff/project/<code>` (+ `?sheet=<id>`).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { TakeoffCtaPane } from "../TakeoffCtaPane";

afterEach(() => {
  cleanup();
});

describe("TakeoffCtaPane (Task #2132)", () => {
  describe('kind: "bid"', () => {
    it("renders the bid container/button and links to /takeoff/<code> when no sheet is selected", () => {
      render(
        <TakeoffCtaPane kind="bid" code="BID-123" selectedSheetId={null} />,
      );

      expect(screen.getByTestId("takeoff-cta-pane")).toBeTruthy();
      expect(screen.queryByTestId("project-takeoff-cta-pane")).toBeNull();

      // Button uses `asChild`, so the testid'd element is the anchor
      // rendered by wouter's <Link>.
      const button = screen.getByTestId("button-open-takeoff-workspace");
      expect(button.tagName).toBe("A");
      expect(
        screen.queryByTestId("button-open-project-takeoff-workspace"),
      ).toBeNull();

      expect(button.getAttribute("href")).toBe("/takeoff/BID-123");
    });

    it("forwards ?sheet=<id> when a sheet is selected", () => {
      render(
        <TakeoffCtaPane
          kind="bid"
          code="BID-123"
          selectedSheetId="sheet-42"
        />,
      );

      const button = screen.getByTestId("button-open-takeoff-workspace");
      expect(button.getAttribute("href")).toBe(
        "/takeoff/BID-123?sheet=sheet-42",
      );
    });
  });

  describe('kind: "project"', () => {
    it("renders the project container/button and links to /takeoff/project/<code> when no sheet is selected", () => {
      render(
        <TakeoffCtaPane
          kind="project"
          code="PRJ-789"
          selectedSheetId={null}
        />,
      );

      expect(screen.getByTestId("project-takeoff-cta-pane")).toBeTruthy();
      expect(screen.queryByTestId("takeoff-cta-pane")).toBeNull();

      const button = screen.getByTestId(
        "button-open-project-takeoff-workspace",
      );
      expect(button.tagName).toBe("A");
      expect(screen.queryByTestId("button-open-takeoff-workspace")).toBeNull();

      expect(button.getAttribute("href")).toBe("/takeoff/project/PRJ-789");
    });

    it("forwards ?sheet=<id> when a sheet is selected", () => {
      render(
        <TakeoffCtaPane
          kind="project"
          code="PRJ-789"
          selectedSheetId="sheet-99"
        />,
      );

      const button = screen.getByTestId(
        "button-open-project-takeoff-workspace",
      );
      expect(button.getAttribute("href")).toBe(
        "/takeoff/project/PRJ-789?sheet=sheet-99",
      );
    });
  });
});
