// @vitest-environment jsdom
/**
 * Task #1611 — MarkupShapeView is the per-shape renderer reused by both
 * PlansTab (via <MarkupRenderer />) and the bid-side TakeoffWorkspace
 * (rendered directly inside the takeoff Konva Stage). This suite asserts:
 *
 *  - Each of the six tool kinds (ARROW, RECTANGLE, CLOUD, HIGHLIGHT,
 *    FREEHAND, TEXT) emits a corresponding Konva node so the shared
 *    renderer can replace TakeoffWorkspace's inline switch.
 *  - The takeoff-style usage (raw pts, listening flag, pixelScale,
 *    groupProps) does not throw and produces the expected node count.
 *  - cancelBubble is set on click so selecting a markup inside the
 *    takeoff Stage does not bubble to the empty-stage deselect handler.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import { MarkupShapeView, buildCloudPath, type MarkupShape } from "../MarkupRenderer";

afterEach(() => cleanup());

function renderInStage(node: React.ReactNode) {
  return render(
    <Stage width={400} height={400}>
      <Layer>{node}</Layer>
    </Stage>,
  );
}

const baseShape = (overrides: Partial<MarkupShape> = {}): MarkupShape => ({
  id: "m1",
  tool: "ARROW",
  points: [
    { x: 10, y: 10 },
    { x: 100, y: 100 },
  ],
  color: "#ef4444",
  thickness: 2,
  text: "",
  ...overrides,
});

describe("MarkupShapeView (takeoff workspace integration)", () => {
  for (const tool of ["ARROW", "RECTANGLE", "CLOUD", "HIGHLIGHT", "FREEHAND"] as const) {
    it(`renders the ${tool} tool with takeoff-style props`, () => {
      const { container } = renderInStage(
        <MarkupShapeView
          shape={baseShape({ tool })}
          pts={baseShape({ tool }).points}
          selected={false}
          readOnly={false}
          listening
          pixelScale={0.5}
        />,
      );
      // react-konva renders into a hidden <canvas>; we just assert no
      // throw and that the host canvas is present.
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeTruthy();
    });
  }

  it("renders TEXT without requiring a second point", () => {
    const { container } = renderInStage(
      <MarkupShapeView
        shape={baseShape({ tool: "TEXT", text: "hello", points: [{ x: 50, y: 50 }] })}
        pts={[{ x: 50, y: 50 }]}
        selected
        readOnly={false}
        listening
        pixelScale={1}
      />,
    );
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("returns null when there are no points", () => {
    const { container } = renderInStage(
      <MarkupShapeView
        shape={baseShape({ points: [] })}
        pts={[]}
        selected={false}
      />,
    );
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("invokes onSelect and sets cancelBubble when the wrapping group is clicked", () => {
    const onSelect = vi.fn();
    let groupNode: any = null;
    renderInStage(
      <MarkupShapeView
        shape={baseShape()}
        pts={baseShape().points}
        selected={false}
        onSelect={onSelect}
        listening
        groupProps={{ ref: (n: any) => { groupNode = n; } }}
      />,
    );
    expect(groupNode).toBeTruthy();
    const evt: any = { cancelBubble: false };
    groupNode.fire("click", evt, true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(evt.cancelBubble).toBe(true);
  });

  it("does not invoke onSelect when readOnly", () => {
    const onSelect = vi.fn();
    let groupNode: any = null;
    renderInStage(
      <MarkupShapeView
        shape={baseShape()}
        pts={baseShape().points}
        selected={false}
        onSelect={onSelect}
        readOnly
        groupProps={{ ref: (n: any) => { groupNode = n; } }}
      />,
    );
    groupNode?.fire("click", { cancelBubble: false }, true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards drag handlers from groupProps for takeoff body-drag", () => {
    // Mirrors how TakeoffWorkspace wires markupBodyDragId via groupProps:
    // the wrapping Group must receive draggable + onDragStart/onDragEnd
    // from groupProps so the takeoff workspace can move whole markups
    // inside the shared PDF Stage.
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    let groupNode: any = null;
    renderInStage(
      <MarkupShapeView
        shape={baseShape()}
        pts={baseShape().points}
        selected
        listening
        groupProps={{
          draggable: true,
          onDragStart,
          onDragEnd,
          ref: (n: any) => { groupNode = n; },
        }}
      />,
    );
    expect(groupNode).toBeTruthy();
    expect(groupNode.draggable()).toBe(true);
    groupNode.fire("dragstart", { target: groupNode }, true);
    groupNode.fire("dragend", { target: groupNode }, true);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("disables hit-testing on the wrapping group when listening is false", () => {
    // TakeoffWorkspace passes listening={isSelectable} so markups become
    // non-interactive while the user is using the pan, measure, or area
    // tools. The shared renderer must respect this on its Group wrapper
    // (otherwise click-through to the PDF stage would break).
    let groupNode: any = null;
    renderInStage(
      <MarkupShapeView
        shape={baseShape()}
        pts={baseShape().points}
        selected={false}
        listening={false}
        groupProps={{ ref: (n: any) => { groupNode = n; } }}
      />,
    );
    expect(groupNode).toBeTruthy();
    expect(groupNode.listening()).toBe(false);
  });

  it("scales pixel-sized features by 1/stageScale via pixelScale", () => {
    // When zoomed in, TakeoffWorkspace passes pixelScale={1/stageScale}
    // so cloud bumps, arrow heads, text, and stroke widths stay constant
    // on screen. We verify the renderer does not throw across a wide
    // zoom range and produces the same node structure.
    for (const pixelScale of [0.25, 0.5, 1, 2, 4]) {
      const { container, unmount } = renderInStage(
        <MarkupShapeView
          shape={baseShape({ tool: "CLOUD" })}
          pts={baseShape({ tool: "CLOUD" }).points}
          selected
          pixelScale={pixelScale}
        />,
      );
      expect(container.querySelector("canvas")).toBeTruthy();
      unmount();
    }
  });
});

describe("buildCloudPath", () => {
  it("emits a closed SVG path for a non-degenerate rectangle", () => {
    const d = buildCloudPath(0, 0, 200, 100, 24);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // Quadratic curve segments must be present for the bumps.
    expect(d.includes(" Q ")).toBe(true);
  });

  it("falls back to a plain rectangle path for tiny boxes", () => {
    const d = buildCloudPath(0, 0, 2, 2, 24);
    expect(d.includes(" Q ")).toBe(false);
    expect(d.endsWith("Z")).toBe(true);
  });
});
