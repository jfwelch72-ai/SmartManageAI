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
 *
 * Task #1739 — Extended to cover the Redo button (added in #1723) and
 * the multi-step `undoLabel` / `redoLabel` flow. The toolbar now
 * surfaces both buttons whenever the parent wires them; their
 * enabled/disabled state must reflect the current depth of each stack
 * independently so a partial undo (Ctrl+Z once after three moves)
 * leaves both Undo AND Redo enabled, with their tooltips spelling out
 * exactly which action will be reversed/replayed.
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

describe("PlanMarkupToolbar — Redo last group move (Task #1739)", () => {
  it("does not render the Redo button when onRedoLastMove is omitted", () => {
    // Surfaces that haven't opted into Redo (e.g. a future read-only
    // viewer) should keep their existing layout.
    renderToolbar({ onUndoLastMove: vi.fn(), canUndoLastMove: true });
    expect(screen.queryByTestId("button-markup-redo-move")).toBeNull();
  });

  it("renders the Redo button as disabled when there is nothing to redo", () => {
    const onRedo = vi.fn();
    renderToolbar({
      onUndoLastMove: vi.fn(),
      canUndoLastMove: true,
      onRedoLastMove: onRedo,
      canRedoLastMove: false,
    });
    const btn = screen.getByTestId("button-markup-redo-move") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("fires onRedoLastMove when the button is clicked while enabled", () => {
    const onRedo = vi.fn();
    renderToolbar({
      onUndoLastMove: vi.fn(),
      canUndoLastMove: true,
      onRedoLastMove: onRedo,
      canRedoLastMove: true,
    });
    const btn = screen.getByTestId("button-markup-redo-move") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("leaves both Undo and Redo enabled in the partial-undo state", () => {
    // After at least one Ctrl+Z (but not a full unwind) both stacks
    // are non-empty and both buttons must be clickable so the user
    // can step forward OR continue stepping back. The regression
    // Task #1739 fixes is exactly that the second Ctrl+Z used to be
    // a no-op; once both stacks have entries, the parent reflects
    // that with `canUndoLastMove=true` AND `canRedoLastMove=true`.
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderToolbar({
      onUndoLastMove: onUndo,
      canUndoLastMove: true,
      onRedoLastMove: onRedo,
      canRedoLastMove: true,
      undoLabel: "Move 5 markups",
      redoLabel: "Move 3 markups",
    });
    const undoBtn = screen.getByTestId("button-markup-undo-move") as HTMLButtonElement;
    const redoBtn = screen.getByTestId("button-markup-redo-move") as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(false);
    // Each button's aria-label spells out which specific action is
    // about to be reversed/replayed so screen-reader users get the
    // same context the visual tooltip provides.
    expect(undoBtn.getAttribute("aria-label")).toBe(
      "Undo: Move 5 markups (Ctrl+Z)",
    );
    expect(redoBtn.getAttribute("aria-label")).toBe(
      "Redo: Move 3 markups (Ctrl+Shift+Z)",
    );
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
    fireEvent.click(redoBtn);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("falls back to the generic aria-label when no action description is provided", () => {
    // The parent passes `undoLabel: null` when the layer hasn't
    // captured a labelled entry yet (initial mount, page swap). The
    // button stays usable but the aria-label reads as the generic
    // shortcut hint.
    renderToolbar({
      onUndoLastMove: vi.fn(),
      canUndoLastMove: true,
      onRedoLastMove: vi.fn(),
      canRedoLastMove: true,
      undoLabel: null,
      redoLabel: null,
    });
    const undoBtn = screen.getByTestId("button-markup-undo-move") as HTMLButtonElement;
    const redoBtn = screen.getByTestId("button-markup-redo-move") as HTMLButtonElement;
    expect(undoBtn.getAttribute("aria-label")).toBe("Undo (Ctrl+Z)");
    expect(redoBtn.getAttribute("aria-label")).toBe("Redo (Ctrl+Shift+Z)");
  });
});
