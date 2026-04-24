// @vitest-environment jsdom
/**
 * Task #1705 — RTL coverage for the Undo-last-group-move button on the
 * plan markup toolbar. Locks down three things:
 *   1. The button is hidden when the parent does not opt in (so the
 *      takeoff popover keeps its existing layout).
 *   2. The button is rendered but disabled when there is nothing to
 *      undo, so its position in the toolbar stays stable.
 *   3. Clicking the button while a snapshot exists fires the parent's
 *      onUndoLastMove callback exactly once.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import PlanMarkupToolbar from "../PlanMarkupToolbar";

afterEach(() => cleanup());

function renderToolbar(props: Partial<React.ComponentProps<typeof PlanMarkupToolbar>>) {
  return render(
    <TooltipProvider>
      <PlanMarkupToolbar
        activeTool={null}
        onChangeTool={() => {}}
        color="#ef4444"
        onChangeColor={() => {}}
        thickness={2}
        onChangeThickness={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("PlanMarkupToolbar — Undo last group move", () => {
  it("does not render the Undo button when onUndoLastMove is omitted", () => {
    renderToolbar({});
    expect(screen.queryByTestId("button-markup-undo-move")).toBeNull();
  });

  it("renders the Undo button as disabled when there is nothing to undo", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndoLastMove: onUndo, canUndoLastMove: false });
    const btn = screen.getByTestId("button-markup-undo-move") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("fires onUndoLastMove when the button is clicked while enabled", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndoLastMove: onUndo, canUndoLastMove: true });
    const btn = screen.getByTestId("button-markup-undo-move") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
