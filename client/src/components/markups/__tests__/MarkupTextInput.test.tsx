// @vitest-environment jsdom
/**
 * Task #456 — verify the takeoff TEXT markup input handles its focus race
 * conditions and submission paths correctly. Covers:
 *
 *   • Enter submits the trimmed value once.
 *   • Escape cancels without submitting.
 *   • Blur submits the current value after the focus-handoff delay.
 *   • Double-submission is prevented across rapid Enter / blur / Save click
 *     sequences (the original bug spawned duplicate markups when blur fired
 *     after Enter).
 *   • Empty values cancel rather than submit a blank label.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { MarkupTextInput } from "../MarkupTextInput";

const BLUR_DELAY = 50;

function renderInput() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <MarkupTextInput
      left={10}
      top={20}
      onSubmit={onSubmit}
      onCancel={onCancel}
      blurDelayMs={BLUR_DELAY}
    />,
  );
  const input = screen.getByTestId("input-markup-text") as HTMLInputElement;
  return { onSubmit, onCancel, input };
}

function setValue(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

afterEach(() => {
  cleanup();
});

describe("MarkupTextInput", () => {
  it("submits the trimmed value when Enter is pressed", async () => {
    const { onSubmit, onCancel, input } = renderInput();
    setValue(input, "  Hello label  ");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Hello label");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels (no submit) when Escape is pressed", async () => {
    const { onSubmit, onCancel, input } = renderInput();
    setValue(input, "draft text");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    // Even after the blur timeout would fire, no late submit should sneak in.
    fireEvent.blur(input);
    await wait(BLUR_DELAY + 30);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("submits on blur once the focus-handoff delay elapses", async () => {
    const { onSubmit, onCancel, input } = renderInput();
    setValue(input, "blur value");
    fireEvent.blur(input);

    // Submit is delayed so a Save-button click can win the race.
    expect(onSubmit).not.toHaveBeenCalled();
    await wait(BLUR_DELAY + 30);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("blur value");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("treats a blank/whitespace blur as cancel, not a phantom submit", async () => {
    const { onSubmit, onCancel, input } = renderInput();
    setValue(input, "   ");
    fireEvent.blur(input);
    await wait(BLUR_DELAY + 30);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("prevents double-submission when Enter and a delayed blur both fire", async () => {
    const { onSubmit, onCancel, input } = renderInput();
    setValue(input, "racy");
    fireEvent.keyDown(input, { key: "Enter" });
    // In real DOM flows Enter often causes blur; the trailing blur must not
    // re-trigger the submit.
    fireEvent.blur(input);
    await wait(BLUR_DELAY + 30);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("prevents double-submission when Save is clicked after Enter", async () => {
    const { onSubmit, input } = renderInput();
    setValue(input, "click-after-enter");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByTestId("button-save-markup-text"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Cancel button cancels and suppresses the trailing blur submit", async () => {
    const { onSubmit, onCancel, input } = renderInput();
    setValue(input, "should-not-save");
    fireEvent.click(screen.getByTestId("button-cancel-markup-text"));
    fireEvent.blur(input);
    await wait(BLUR_DELAY + 30);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("auto-focuses the input on mount so users can type immediately", async () => {
    const { input } = renderInput();
    // requestAnimationFrame schedules focus; flush it.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(input);
  });
});
