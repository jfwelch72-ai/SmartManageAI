// @vitest-environment jsdom
/**
 * Task #2355 — Pin the contract for the AI takeoff scale-status banner:
 *
 *   1. When the server emits `scaleNotToScale` (the AI saw "NTS" / "AS SHOWN"
 *      in the title block), a neutral note tells the estimator the AI noticed
 *      and is trusting their calibration.
 *   2. A normal numeric scale (no `scaleNotToScale`, no warning) renders
 *      nothing — no banner, no slot.
 *   3. When both a mismatch warning AND the not-to-scale flag would be
 *      present, the warning takes precedence so the two slots are mutually
 *      exclusive (per the task: "appears alongside the existing scale-mismatch
 *      warning slot, never both at once").
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AiTakeoffScaleStatusBanner } from "../AiTakeoffScaleStatusBanner";

afterEach(() => cleanup());

describe("AiTakeoffScaleStatusBanner (Task #2355)", () => {
  it("renders the NTS banner for an NTS sheet", () => {
    render(<AiTakeoffScaleStatusBanner scaleNotToScale={{ label: "NTS" }} />);
    const banner = screen.getByTestId("banner-scale-not-to-scale");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/Drawing marked NTS/);
    expect(banner.textContent).toMatch(/using calibrated scale/);
    expect(screen.queryByTestId("banner-scale-mismatch")).toBeNull();
  });

  it("renders the AS SHOWN variant when the title block uses that wording", () => {
    render(
      <AiTakeoffScaleStatusBanner scaleNotToScale={{ label: "AS SHOWN" }} />,
    );
    const banner = screen.getByTestId("banner-scale-not-to-scale");
    expect(banner.textContent).toMatch(/Drawing marked AS SHOWN/);
  });

  it("renders nothing for a normal numeric scale", () => {
    const { container } = render(
      <AiTakeoffScaleStatusBanner
        scaleMismatchWarning={null}
        scaleNotToScale={null}
      />,
    );
    expect(screen.queryByTestId("banner-scale-not-to-scale")).toBeNull();
    expect(screen.queryByTestId("banner-scale-mismatch")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("never renders both banners at once — mismatch warning wins", () => {
    render(
      <AiTakeoffScaleStatusBanner
        scaleMismatchWarning={"AI inferred 1\" = 20', sheet calibrated to 1/4\" = 1'-0\"."}
        scaleNotToScale={{ label: "NTS" }}
      />,
    );
    expect(screen.getByTestId("banner-scale-mismatch")).toBeTruthy();
    expect(screen.queryByTestId("banner-scale-not-to-scale")).toBeNull();
  });

  it("includes the Task #2335 dashboard link alongside the mismatch warning", () => {
    render(
      <AiTakeoffScaleStatusBanner
        scaleMismatchWarning={"AI inferred 1\" = 20', sheet calibrated to 1/4\" = 1'-0\"."}
      />,
    );
    const link = screen.getByTestId("link-scale-mismatch-dashboard") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/takeoff/ai-dashboard");
  });
});
