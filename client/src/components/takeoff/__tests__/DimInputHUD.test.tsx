// @vitest-environment jsdom
/**
 * Task #2140 — Functional coverage for the typed-dimension HUD.
 *
 * The component-level e2e (`e2e/takeoff-typed-dim-and-calibration.spec.ts`)
 * pins the UI surface; this suite pins the **commit contract** the
 * draw handlers downstream rely on:
 *
 *   1. A typed segment that parses must call `onCommit` with the
 *      exact `{kind, lengthFt}` derived from the buffer, and `mode`
 *      = "continue" for Tab / "finish" for Enter. This is what
 *      "typed segment locks to requested length" means in practice.
 *   2. A typed segment that fails to parse must NOT clear the buffer
 *      and must NOT call `onCommit` — the user has to be able to
 *      correct the typo without retyping the whole expression.
 *   3. The HUD must surface inline live preview + inline error so
 *      the user always sees what the parser is going to commit.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { DimInputHUD } from "../DimInputHUD";

afterEach(() => cleanup());

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function type(str: string) {
  for (const ch of str) press(ch);
}

describe("DimInputHUD (Task #2140)", () => {
  it("does not render when inactive (no key interception)", () => {
    render(<DimInputHUD active={false} units="ft" onCommit={vi.fn()} />);
    expect(screen.queryByTestId("dim-input-hud")).toBeNull();
    // Even key events should be ignored — assert by typing then
    // confirming nothing got committed.
    const onCommit = vi.fn();
    cleanup();
    render(<DimInputHUD active={false} units="ft" onCommit={onCommit} />);
    type("12");
    press("Enter");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits a typed feet-inches length on Enter and clears the buffer", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    type("12");
    press("'");
    type("6");
    press('"');
    expect(screen.getByTestId("dim-input-hud-buffer").textContent).toBe(
      `12'6"`,
    );
    // Live preview shows the parsed length.
    expect(screen.getByTestId("dim-input-hud-preview").textContent).toMatch(
      /^=\s*12 ft 6\.00 in$/,
    );

    press("Enter");

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [parsed, mode] = onCommit.mock.calls[0];
    expect(parsed.kind).toBe("length");
    expect(parsed.lengthFt).toBeCloseTo(12.5, 6);
    expect(mode).toBe("finish");
    // Buffer cleared after a successful commit.
    expect(screen.getByTestId("dim-input-hud-buffer").textContent).not.toBe(
      `12'6"`,
    );
  });

  it("commits with mode='continue' on Tab", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    type("8");
    press("Tab");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({ kind: "length", lengthFt: 8 });
    expect(onCommit.mock.calls[0][1]).toBe("continue");
  });

  it("commits a length+angle expression with the parsed angle", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    type("12");
    press("<");
    type("30");
    press("Enter");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({
      kind: "length-angle",
      lengthFt: 12,
      angleDeg: 30,
    });
  });

  it("preserves the buffer and surfaces an error when the parse fails", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    // `12<<` is composed entirely of accepted grammar chars (digits
    // plus the `<` separator allowed once a number is in the buffer)
    // but the parser rejects it because of the duplicate `<`.
    type("12");
    press("<");
    press("<");
    expect(screen.getByTestId("dim-input-hud-error")).toBeTruthy();
    expect(screen.queryByTestId("dim-input-hud-preview")).toBeNull();

    press("Enter");

    expect(onCommit).not.toHaveBeenCalled();
    // Buffer must still be there so the user can fix the typo.
    expect(screen.getByTestId("dim-input-hud-buffer").textContent).toBe(
      "12<<",
    );
    // Caret marker is rendered for the inline error.
    expect(screen.getByTestId("dim-input-hud-caret")).toBeTruthy();
  });

  it("does NOT swallow shortcut letters (o/t/s) when the buffer is empty", () => {
    // The HUD must not consume O/T/S/etc. while the buffer is empty,
    // otherwise the user can't toggle ortho / open calibrate / cycle
    // snap during a draw.
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    let oEvent: KeyboardEvent | null = null;
    let tEvent: KeyboardEvent | null = null;
    let sEvent: KeyboardEvent | null = null;
    act(() => {
      oEvent = new KeyboardEvent("keydown", { key: "o", bubbles: true, cancelable: true });
      tEvent = new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true });
      sEvent = new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true });
      window.dispatchEvent(oEvent);
      window.dispatchEvent(tEvent);
      window.dispatchEvent(sEvent);
    });
    // None of those keys should have been preventDefault'd by the HUD.
    expect(oEvent!.defaultPrevented).toBe(false);
    expect(tEvent!.defaultPrevented).toBe(false);
    expect(sEvent!.defaultPrevented).toBe(false);
    // And the buffer must still be empty.
    expect(screen.queryByTestId("dim-input-hud-preview")).toBeNull();
  });

  it("Backspace edits the buffer when it has content", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    type("123");
    press("Backspace");
    expect(screen.getByTestId("dim-input-hud-buffer").textContent).toBe("12");
  });

  it("Escape clears the buffer (without cancelling the draw) and fires onCancelTyped", () => {
    const onCommit = vi.fn();
    const onCancelTyped = vi.fn();
    render(
      <DimInputHUD
        active={true}
        units="ft"
        onCommit={onCommit}
        onCancelTyped={onCancelTyped}
      />,
    );
    type("99");
    press("Escape");
    expect(onCancelTyped).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dim-input-hud-buffer").textContent).not.toBe(
      "99",
    );
  });

  it("ignores keystrokes targeted at form controls (so dialogs work)", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="ft" onCommit={onCommit} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "5", bubbles: true }),
      );
    });
    expect(screen.getByTestId("dim-input-hud-buffer").textContent).not.toBe(
      "5",
    );
    document.body.removeChild(input);
  });

  it("interprets a bare number as meters when units=m", () => {
    const onCommit = vi.fn();
    render(<DimInputHUD active={true} units="m" onCommit={onCommit} />);
    type("3");
    press("Enter");
    expect(onCommit).toHaveBeenCalledTimes(1);
    const parsed = onCommit.mock.calls[0][0];
    expect(parsed.kind).toBe("length");
    expect(parsed.lengthFt).toBeCloseTo(9.84251968, 5); // 3 m
  });
});
