// @vitest-environment jsdom
/**
 * Task #3049 — Unit tests for AiOverlayLayer.
 *
 * AiOverlayLayer is a react-konva component (canvas). react-konva is mocked
 * to render light-weight HTML sentinels so the rendering logic — which
 * measurements get shapes, which are filtered by hiddenDivisions — can be
 * verified without a real canvas.
 *
 * Cases covered:
 *   1. Returns null when pageWidth or pageHeight is 0
 *   2. Returns null when no measurements carry aiGeometry
 *   3. Renders one shape per measurement that has aiGeometry
 *   4. Uses a <Line> for measurements with polygonPoints, <Rect> for bbox-only
 *   5. Hides shapes whose csiDivision is in hiddenDivisions
 *   6. Measurements without csiDivision (empty string) are never filtered out
 *      by hiddenDivisions (they only disappear if "" is explicitly in the set)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TakeoffMeasurement } from "@shared/schema";

vi.mock("react-konva", () => {
  const React = require("react");

  const Group = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-konva": "group" }, children);

  const Line = ({
    points,
    fill,
    stroke,
  }: {
    points: number[];
    fill?: string;
    stroke?: string;
  }) =>
    React.createElement("div", {
      "data-konva": "line",
      "data-points": JSON.stringify(points),
      "data-fill": fill,
      "data-stroke": stroke,
    });

  const Rect = ({
    x,
    y,
    width,
    height,
    fill,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
  }) =>
    React.createElement("div", {
      "data-konva": "rect",
      "data-x": x,
      "data-y": y,
      "data-width": width,
      "data-height": height,
      "data-fill": fill,
    });

  const Text = ({ text }: { text?: string }) =>
    React.createElement("span", { "data-konva": "text" }, text);

  return { Group, Line, Rect, Text };
});

import { AiOverlayLayer } from "../AiOverlayLayer";

function makeMeasurement(
  overrides: Partial<TakeoffMeasurement> & { id: string },
): TakeoffMeasurement {
  return {
    sheetId: "sheet-1",
    type: "LINEAR" as const,
    label: "Test label",
    points: "[]",
    visible: true,
    source: "USER" as const,
    status: "DRAFT" as const,
    lineStyle: "solid",
    lineWidth: 3,
    color: "#3b82f6",
    arcData: null,
    depthFeet: null,
    count: null,
    note: null,
    categoryId: null,
    groupId: null,
    takeoffVersionId: null,
    locationId: null,
    costCodeId: null,
    unitCost: null,
    pitchRatio: null,
    computedLengthFt: null,
    computedAreaFt2: null,
    computedVolumeCy: null,
    computedSurfaceAreaFt2: null,
    lockedScalePxPerFoot: null,
    deductions: null,
    metadata: null,
    aiGeometry: null,
    csiDivision: null,
    aiLegendSymbolId: null,
    snapModesUsed: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TakeoffMeasurement;
}

const BBOX_GEOM = { boundingBox: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 } };
const POLY_GEOM = {
  boundingBox: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
  polygonPoints: [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.4 },
  ],
};

const BASE_PROPS = {
  measurements: [] as TakeoffMeasurement[],
  hiddenDivisions: new Set<string>(),
  pageWidth: 800,
  pageHeight: 600,
  stageScale: 1,
  selectedMeasurementId: null,
  setSelectedMeasurementId: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiOverlayLayer — early-return guards", () => {
  it("renders nothing when pageWidth is 0", () => {
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} pageWidth={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when pageHeight is 0", () => {
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} pageHeight={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no measurements have aiGeometry", () => {
    const measurements = [
      makeMeasurement({ id: "m1", aiGeometry: null }),
      makeMeasurement({ id: "m2", aiGeometry: null }),
    ];
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={measurements} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when measurements array is empty", () => {
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("AiOverlayLayer — shape count", () => {
  it("renders one shape per measurement that has valid aiGeometry", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 05",
      }),
      makeMeasurement({ id: "m3", aiGeometry: null }),
    ];
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={measurements} />,
    );

    const rects = container.querySelectorAll('[data-konva="rect"]');
    expect(rects.length).toBe(2);
  });

  it("renders three shapes when all three measurements have aiGeometry", () => {
    const measurements = [
      makeMeasurement({ id: "m1", aiGeometry: BBOX_GEOM, csiDivision: "DIV 03" }),
      makeMeasurement({ id: "m2", aiGeometry: BBOX_GEOM, csiDivision: "DIV 03" }),
      makeMeasurement({ id: "m3", aiGeometry: BBOX_GEOM, csiDivision: "DIV 05" }),
    ];
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={measurements} />,
    );
    const rects = container.querySelectorAll('[data-konva="rect"]');
    expect(rects.length).toBe(3);
  });
});

describe("AiOverlayLayer — shape type selection", () => {
  it("uses a Line when measurement has polygonPoints with ≥3 vertices", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: POLY_GEOM,
        csiDivision: "DIV 03",
      }),
    ];
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={measurements} />,
    );
    expect(container.querySelectorAll('[data-konva="line"]').length).toBe(1);
    expect(container.querySelectorAll('[data-konva="rect"]').length).toBe(0);
  });

  it("uses a Rect when measurement has only a bounding box", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 03",
      }),
    ];
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={measurements} />,
    );
    expect(container.querySelectorAll('[data-konva="rect"]').length).toBe(1);
    expect(container.querySelectorAll('[data-konva="line"]').length).toBe(0);
  });

  it("scales bbox coordinates by pageWidth and pageHeight", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: { boundingBox: { x: 0.5, y: 0.25, w: 0.4, h: 0.2 } },
        csiDivision: "DIV 03",
      }),
    ];
    const { container } = render(
      <AiOverlayLayer
        {...BASE_PROPS}
        measurements={measurements}
        pageWidth={1000}
        pageHeight={800}
      />,
    );
    const rect = container.querySelector('[data-konva="rect"]');
    expect(rect).not.toBeNull();
    expect(Number(rect!.getAttribute("data-x"))).toBeCloseTo(500);
    expect(Number(rect!.getAttribute("data-y"))).toBeCloseTo(200);
    expect(Number(rect!.getAttribute("data-width"))).toBeCloseTo(400);
    expect(Number(rect!.getAttribute("data-height"))).toBeCloseTo(160);
  });
});

describe("AiOverlayLayer — hiddenDivisions filter", () => {
  it("suppresses shapes whose csiDivision is in hiddenDivisions", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 05",
      }),
    ];
    const { container } = render(
      <AiOverlayLayer
        {...BASE_PROPS}
        measurements={measurements}
        hiddenDivisions={new Set(["DIV 03"])}
      />,
    );
    const rects = container.querySelectorAll('[data-konva="rect"]');
    expect(rects.length).toBe(1);
  });

  it("renders nothing visible when all divisions are hidden", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 05",
      }),
    ];
    const { container } = render(
      <AiOverlayLayer
        {...BASE_PROPS}
        measurements={measurements}
        hiddenDivisions={new Set(["DIV 03", "DIV 05"])}
      />,
    );
    const rects = container.querySelectorAll('[data-konva="rect"]');
    expect(rects.length).toBe(0);
  });

  it("renders shapes for measurements with no csiDivision even when \"\" is not hidden", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: BBOX_GEOM,
        csiDivision: null,
      }),
    ];
    const { container } = render(
      <AiOverlayLayer
        {...BASE_PROPS}
        measurements={measurements}
        hiddenDivisions={new Set(["DIV 03"])}
      />,
    );
    const rects = container.querySelectorAll('[data-konva="rect"]');
    expect(rects.length).toBe(1);
  });

  it("skips shapes for measurements with invalid aiGeometry JSON", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: { boundingBox: null } as unknown,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: BBOX_GEOM,
        csiDivision: "DIV 05",
      }),
    ];
    const { container } = render(
      <AiOverlayLayer {...BASE_PROPS} measurements={measurements} />,
    );
    const rects = container.querySelectorAll('[data-konva="rect"]');
    expect(rects.length).toBe(1);
  });
});
