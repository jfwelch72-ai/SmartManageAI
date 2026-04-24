// @vitest-environment jsdom
/**
 * Task #1609 — RTL coverage for PlanMarkupToolbar's tool/color/thickness
 * controls. The toolbar is a fully controlled component so verifying the
 * onChange callbacks fire with the expected value locks down the contract
 * the parent (PlansTab) relies on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PlanMarkupToolbar from "../PlanMarkupToolbar";

afterEach(() => cleanup());

describe("PlanMarkupToolbar", () => {
  it("renders all six tool buttons", () => {
    render(
      <PlanMarkupToolbar
        activeTool={null}
        onChangeTool={() => {}}
        color="#ef4444"
        onChangeColor={() => {}}
        thickness={2}
        onChangeThickness={() => {}}
      />,
    );
    expect(screen.getByTestId("button-markup-tool-arrow")).toBeTruthy();
    expect(screen.getByTestId("button-markup-tool-text")).toBeTruthy();
    expect(screen.getByTestId("button-markup-tool-rectangle")).toBeTruthy();
    expect(screen.getByTestId("button-markup-tool-cloud")).toBeTruthy();
    expect(screen.getByTestId("button-markup-tool-highlight")).toBeTruthy();
    expect(screen.getByTestId("button-markup-tool-freehand")).toBeTruthy();
  });

  it("clicking a tool button toggles it on then off", () => {
    const onChangeTool = vi.fn();
    const { rerender } = render(
      <PlanMarkupToolbar
        activeTool={null}
        onChangeTool={onChangeTool}
        color="#ef4444"
        onChangeColor={() => {}}
        thickness={2}
        onChangeThickness={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-markup-tool-arrow"));
    expect(onChangeTool).toHaveBeenLastCalledWith("ARROW");

    rerender(
      <PlanMarkupToolbar
        activeTool="ARROW"
        onChangeTool={onChangeTool}
        color="#ef4444"
        onChangeColor={() => {}}
        thickness={2}
        onChangeThickness={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-markup-tool-arrow"));
    expect(onChangeTool).toHaveBeenLastCalledWith(null);
  });

  it("color and thickness pickers fire their respective callbacks", () => {
    const onChangeColor = vi.fn();
    const onChangeThickness = vi.fn();
    render(
      <PlanMarkupToolbar
        activeTool={null}
        onChangeTool={() => {}}
        color="#ef4444"
        onChangeColor={onChangeColor}
        thickness={2}
        onChangeThickness={onChangeThickness}
      />,
    );
    fireEvent.click(screen.getByTestId("button-markup-color-3b82f6"));
    expect(onChangeColor).toHaveBeenLastCalledWith("#3b82f6");

    fireEvent.click(screen.getByTestId("button-markup-thickness-8"));
    expect(onChangeThickness).toHaveBeenLastCalledWith(8);
  });
});
