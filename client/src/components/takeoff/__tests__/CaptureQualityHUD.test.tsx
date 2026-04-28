/**
 * Task #2331 — Capture-quality HUD pure-presentation contract.
 *
 * The on-canvas HUD reads `snapStats` from `useTakeoffInteractions`
 * and converts it into a Snap X/Y pill plus a most-used-mode chip.
 * The hook tests cover the stats lifecycle (record on commit, reset
 * on cancel/commit); this suite pins the rendering contract:
 *
 *   1. Hidden when not drawing or before the second vertex (the
 *      task's done criteria — no value on the first click).
 *   2. Shows "Snap X/Y" once a real draft is in progress.
 *   3. Surfaces the dominant snap mode label and count when ≥1 hit.
 *   4. Quality bucket (low / medium / high) tracks the hit ratio.
 *   5. Helper utilities pickTopMode / pickQualityFill are pure.
 */
import { describe, it, expect } from "vitest";
import {
  CaptureQualityHUD,
  pickTopMode,
  pickQualityFill,
} from "../CaptureQualityHUD";

const baseProps = {
  isDrawing: true as boolean,
  cursorPosition: { x: 100, y: 100 } as { x: number; y: number } | null,
  drawingPointsCount: 3,
  snapStats: { vertices: 4, hits: 3, modeCounts: { midpoint: 2, endpoint: 1 } },
  stageScale: 1,
};

function renderToVdom(node: React.ReactElement | null) {
  // The HUD returns Konva primitives — we don't mount a Konva stage
  // here. Instead we exercise the conditional branches by inspecting
  // the returned ReactElement directly. `null` means "do not render"
  // (the visibility contract); otherwise we walk the tree to assert
  // on the rendered text + data-quality.
  return node;
}

function findText(tree: any): string | null {
  if (!tree) return null;
  const props = tree.props;
  if (!props) return null;
  if (typeof props.text === "string") return props.text;
  const kids = (props.children ?? []).flat ? (props.children ?? []).flat(Infinity) : [props.children];
  for (const k of kids) {
    if (k && typeof k === "object" && "props" in k) {
      const inner = findText(k);
      if (inner) return inner;
    }
  }
  return null;
}

function findQuality(tree: any): string | null {
  if (!tree?.props) return null;
  return (tree.props as any)["data-quality"] ?? null;
}

describe("CaptureQualityHUD (Task #2331)", () => {
  it("returns null when not drawing", () => {
    const out = renderToVdom(
      CaptureQualityHUD({ ...baseProps, isDrawing: false }) as any,
    );
    expect(out).toBeNull();
  });

  it("returns null when cursor position is unavailable", () => {
    const out = renderToVdom(
      CaptureQualityHUD({ ...baseProps, cursorPosition: null }) as any,
    );
    expect(out).toBeNull();
  });

  it("returns null until the draft has 2+ vertices (no value on first click)", () => {
    const beforeSecond = renderToVdom(
      CaptureQualityHUD({ ...baseProps, drawingPointsCount: 1 }) as any,
    );
    expect(beforeSecond).toBeNull();
    const atSecond = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        drawingPointsCount: 2,
        snapStats: { vertices: 2, hits: 2, modeCounts: { endpoint: 2 } },
      }) as any,
    );
    expect(atSecond).not.toBeNull();
  });

  it("returns null when snapStats has no recorded vertices yet", () => {
    const out = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        snapStats: { vertices: 0, hits: 0, modeCounts: {} },
      }) as any,
    );
    expect(out).toBeNull();
  });

  it("renders 'Snap H/V · TopMode ×N' for the dominant mode", () => {
    const out = renderToVdom(CaptureQualityHUD(baseProps) as any);
    const text = findText(out);
    expect(text).toBe("Snap 3/4 · Mid ×2");
  });

  it("omits the count when the dominant mode only fired once", () => {
    const out = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        snapStats: { vertices: 2, hits: 1, modeCounts: { endpoint: 1 } },
      }) as any,
    );
    expect(findText(out)).toBe("Snap 1/2 · End");
  });

  it("renders just the ratio when no snap modes have fired", () => {
    const out = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        snapStats: { vertices: 3, hits: 0, modeCounts: {} },
      }) as any,
    );
    expect(findText(out)).toBe("Snap 0/3");
    expect(findQuality(out)).toBe("low");
  });

  it("tags quality bucket from the hit ratio", () => {
    const high = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        snapStats: { vertices: 5, hits: 5, modeCounts: { endpoint: 5 } },
      }) as any,
    );
    expect(findQuality(high)).toBe("high");
    const medium = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        snapStats: { vertices: 4, hits: 2, modeCounts: { endpoint: 2 } },
      }) as any,
    );
    expect(findQuality(medium)).toBe("medium");
    const low = renderToVdom(
      CaptureQualityHUD({
        ...baseProps,
        snapStats: { vertices: 4, hits: 1, modeCounts: { endpoint: 1 } },
      }) as any,
    );
    expect(findQuality(low)).toBe("low");
  });
});

describe("pickTopMode", () => {
  it("returns null when no modes recorded", () => {
    expect(pickTopMode({})).toBeNull();
  });
  it("picks the most-frequent mode", () => {
    expect(pickTopMode({ endpoint: 1, midpoint: 4, intersection: 2 })).toEqual({
      mode: "midpoint",
      count: 4,
    });
  });
});

describe("pickQualityFill", () => {
  it("buckets >=80% as green", () => {
    expect(pickQualityFill(0.8)).toMatch(/22, 163, 74/);
    expect(pickQualityFill(1)).toMatch(/22, 163, 74/);
  });
  it("buckets 50-79% as amber", () => {
    expect(pickQualityFill(0.5)).toMatch(/217, 119, 6/);
    expect(pickQualityFill(0.79)).toMatch(/217, 119, 6/);
  });
  it("buckets <50% as red", () => {
    expect(pickQualityFill(0)).toMatch(/220, 38, 38/);
    expect(pickQualityFill(0.49)).toMatch(/220, 38, 38/);
  });
});
