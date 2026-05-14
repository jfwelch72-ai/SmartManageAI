// @vitest-environment jsdom
/**
 * Task #2870 — Signature capture component tests.
 * Covers: canvas render, placeholder text, draw simulation,
 * clear action, disabled state.
 *
 * Canvas stubs: we use Object.defineProperty (not vi.spyOn) to avoid
 * TypeScript's HTMLCanvasElement.getContext overload-resolution picking
 * GPUCanvasContext rather than CanvasRenderingContext2D.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SignaturePad from "../SignaturePad";

const FAKE_DATA_URL = "data:image/png;base64,abc123";

/** Minimal CanvasRenderingContext2D stub — only the methods the component uses. */
function makeCtxStub(): Partial<CanvasRenderingContext2D> {
  return {
    fillStyle: "" as string,
    strokeStyle: "" as string,
    lineWidth: 0 as number,
    lineCap: "round" as CanvasLineCap,
    lineJoin: "round" as CanvasLineJoin,
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
}

beforeEach(() => {
  const ctx = makeCtxStub();

  // Replace prototype methods without going through vi.spyOn (which would
  // trigger TypeScript's overload resolution and pick GPUCanvasContext).
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => ctx,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    writable: true,
    value: () => FAKE_DATA_URL,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => ({
      left: 0, top: 0, width: 400, height: 150,
      right: 400, bottom: 150, x: 0, y: 0, toJSON: () => "",
    }),
  });
});

afterEach(() => cleanup());

/** Helper: the prop requires exactly this function signature. */
function makeOnChange(): (dataUrl: string | null) => void {
  return vi.fn();
}

describe("SignaturePad", () => {
  it("renders the canvas element", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} />);
    expect(screen.getByTestId("canvas-signature")).toBeInTheDocument();
  });

  it("shows 'Sign here' placeholder when no signature has been drawn", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} />);
    expect(screen.getByText("Sign here")).toBeInTheDocument();
  });

  it("renders the clear button", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} />);
    expect(screen.getByTestId("button-clear-signature")).toBeInTheDocument();
  });

  it("clear button is disabled when nothing has been drawn", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} />);
    expect(screen.getByTestId("button-clear-signature")).toBeDisabled();
  });

  it("calls onSignatureChange with a data URL after drawing", () => {
    const onChange: (dataUrl: string | null) => void = vi.fn();
    render(<SignaturePad onSignatureChange={onChange} />);
    const canvas = screen.getByTestId("canvas-signature");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(canvas);

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("data:image/png"));
  });

  it("hides placeholder after drawing begins", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} />);
    const canvas = screen.getByTestId("canvas-signature");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });

    expect(screen.queryByText("Sign here")).not.toBeInTheDocument();
  });

  it("enables the clear button after drawing", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} />);
    const canvas = screen.getByTestId("canvas-signature");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    expect(screen.getByTestId("button-clear-signature")).not.toBeDisabled();
  });

  it("calls onSignatureChange(null) and re-shows placeholder after clearing", () => {
    const onChange: (dataUrl: string | null) => void = vi.fn();
    render(<SignaturePad onSignatureChange={onChange} />);
    const canvas = screen.getByTestId("canvas-signature");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);
    fireEvent.click(screen.getByTestId("button-clear-signature"));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Sign here")).toBeInTheDocument();
  });

  it("does not respond to drawing when disabled", () => {
    const onChange: (dataUrl: string | null) => void = vi.fn();
    render(<SignaturePad onSignatureChange={onChange} disabled />);
    const canvas = screen.getByTestId("canvas-signature");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(canvas);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the clear button when disabled", () => {
    render(<SignaturePad onSignatureChange={makeOnChange()} disabled />);
    expect(screen.queryByTestId("button-clear-signature")).not.toBeInTheDocument();
  });

  it("stops drawing and fires onSignatureChange when mouse leaves the canvas", () => {
    const onChange: (dataUrl: string | null) => void = vi.fn();
    render(<SignaturePad onSignatureChange={onChange} />);
    const canvas = screen.getByTestId("canvas-signature");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseLeave(canvas);

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("data:image/png"));
  });
});
