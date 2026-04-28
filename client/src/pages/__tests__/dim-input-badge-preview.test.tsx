// @vitest-environment jsdom
/**
 * Task #2270 — Storybook-style preview surface for the locked-length
 * cursor badge.
 *
 * The preview page mounts `DimInputCursorBadge` inside throwaway Konva
 * stages so designers can iterate on the cyan "Lock" vs amber "Chain"
 * palette without launching a real takeoff session. This suite pins
 * the two contracts the task calls out in "Done looks like":
 *
 *   1. Both Lock (cyan) and Chain (amber) variants render side-by-side
 *      at the typical 1× and 2× stage scales.
 *   2. The chain-mode toggle swaps the live badge between Lock and
 *      Chain without re-mounting the page.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import Konva from "konva";
import DimInputBadgePreviewPage from "../test/dim-input-badge-preview";

afterEach(() => cleanup());

function findBadgeByMode(mode: "lock" | "chain"): Konva.Group | undefined {
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  for (const stage of stages) {
    for (const layer of stage.getLayers()) {
      const matches = layer.find(".dim-input-cursor-badge") as Konva.Group[];
      const hit = matches.find((node) => node.getAttr("data-mode") === mode);
      if (hit) return hit;
    }
  }
  return undefined;
}

function findBadgesByMode(mode: "lock" | "chain"): Konva.Group[] {
  const out: Konva.Group[] = [];
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  for (const stage of stages) {
    for (const layer of stage.getLayers()) {
      const matches = layer.find(".dim-input-cursor-badge") as Konva.Group[];
      for (const node of matches) {
        if (node.getAttr("data-mode") === mode) out.push(node);
      }
    }
  }
  return out;
}

describe("DimInputBadgePreviewPage (Task #2270)", () => {
  it("renders both Lock and Chain variants side-by-side at 1× and 2× scales", () => {
    render(<DimInputBadgePreviewPage />);

    expect(screen.getByTestId("badge-preview-lock-1x")).toBeTruthy();
    expect(screen.getByTestId("badge-preview-chain-1x")).toBeTruthy();
    expect(screen.getByTestId("badge-preview-lock-2x")).toBeTruthy();
    expect(screen.getByTestId("badge-preview-chain-2x")).toBeTruthy();

    // The static side-by-side grid contributes two Lock badges (1× and
    // 2×). The live preview also starts in Lock mode, bringing the
    // total to three. Asserting `>= 2` keeps the live preview's
    // initial state from over-constraining this contract.
    const lockBadges = findBadgesByMode("lock");
    const chainBadges = findBadgesByMode("chain");
    expect(lockBadges.length).toBeGreaterThanOrEqual(2);
    expect(chainBadges.length).toBeGreaterThanOrEqual(2);

    const lock = lockBadges[0];
    const chain = chainBadges[0];
    const lockRect = lock.findOne("Rect") as Konva.Rect;
    const chainRect = chain.findOne("Rect") as Konva.Rect;
    // Cyan vs amber palette swap — see `DimInputCursorBadge.tsx`.
    expect(lockRect.fill()).toBe("rgba(8, 145, 178, 0.9)");
    expect(chainRect.fill()).toBe("rgba(180, 83, 9, 0.9)");
  });

  it("swaps the live badge when chain mode is toggled", () => {
    render(<DimInputBadgePreviewPage />);

    // Live preview starts in Lock mode.
    expect(screen.getByTestId("text-chain-mode-state").textContent).toBe("off");
    expect(findBadgeByMode("lock")).toBeTruthy();

    // Static grid always contributes one Chain badge, so we cannot
    // assert "no chain anywhere" — instead assert the live preview's
    // own label flips alongside the toggle.
    fireEvent.click(screen.getByTestId("button-toggle-chain-mode"));
    expect(screen.getByTestId("text-chain-mode-state").textContent).toBe("on");
    expect(screen.getByTestId("text-live-mode-label").textContent).toContain(
      "Chain (amber)",
    );

    fireEvent.click(screen.getByTestId("button-toggle-chain-mode"));
    expect(screen.getByTestId("text-chain-mode-state").textContent).toBe("off");
    expect(screen.getByTestId("text-live-mode-label").textContent).toContain(
      "Lock (cyan)",
    );
  });
});
