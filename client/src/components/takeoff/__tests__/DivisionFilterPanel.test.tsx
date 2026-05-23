// @vitest-environment jsdom
/**
 * Task #3049 — Unit tests for DivisionFilterPanel.
 *
 * Cases covered:
 *   1. Empty state when no measurement has aiGeometry
 *   2. Initial render with all divisions visible (all checkboxes checked)
 *   3. Toggling a single division off calls onToggleDivision with its code
 *   4. Show all / Hide all master checkbox behaviour
 *   5. Panel is not rendered when open=false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DivisionFilterPanel } from "../DivisionFilterPanel";
import type { TakeoffMeasurement } from "@shared/schema";

vi.mock("@/components/ui/scroll-area", () => {
  const React = require("react");
  return {
    ScrollArea: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-mock-scroll-area": true }, children),
    ScrollBar: () => null,
  };
});

vi.mock("@/components/ui/checkbox", () => {
  const React = require("react");
  return {
    Checkbox: ({
      checked,
      onCheckedChange,
      "data-testid": testId,
      id,
      className,
    }: {
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
      "data-testid"?: string;
      id?: string;
      className?: string;
    }) =>
      React.createElement("input", {
        type: "checkbox",
        "data-testid": testId,
        id,
        checked: !!checked,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
          onCheckedChange?.(e.target.checked),
        className,
        readOnly: !onCheckedChange,
      }),
  };
});

vi.mock("@/components/ui/button", () => {
  const React = require("react");
  return {
    Button: ({ children, onClick, "data-testid": testId, ...rest }: any) =>
      React.createElement(
        "button",
        { "data-testid": testId, onClick, ...rest },
        children,
      ),
  };
});

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

const AI_GEOMETRY_03 = {
  boundingBox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
};

const AI_GEOMETRY_05 = {
  boundingBox: { x: 0.5, y: 0.5, w: 0.1, h: 0.2 },
};

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  measurements: [] as TakeoffMeasurement[],
  hiddenDivisions: new Set<string>(),
  onToggleDivision: vi.fn(),
  onShowAll: vi.fn(),
  onHideAll: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DivisionFilterPanel — not rendered when closed", () => {
  it("returns null when open is false", () => {
    const { container } = render(
      <DivisionFilterPanel {...defaultProps} open={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("DivisionFilterPanel — empty state", () => {
  it("shows empty-state message when no measurement has aiGeometry", () => {
    const measurements = [
      makeMeasurement({ id: "m1", aiGeometry: null }),
      makeMeasurement({ id: "m2", aiGeometry: null }),
    ];
    render(<DivisionFilterPanel {...defaultProps} measurements={measurements} />);
    expect(screen.getByText(/No AI geometry on this sheet/i)).toBeTruthy();
    expect(
      screen.queryByTestId("checkbox-division-filter-all"),
    ).toBeNull();
  });

  it("shows empty-state when measurements array is empty", () => {
    render(<DivisionFilterPanel {...defaultProps} measurements={[]} />);
    expect(screen.getByText(/No AI geometry on this sheet/i)).toBeTruthy();
  });
});

describe("DivisionFilterPanel — division rows", () => {
  it("renders a row for each distinct CSI division that has aiGeometry", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m3",
        aiGeometry: AI_GEOMETRY_05,
        csiDivision: "DIV 05",
      }),
      makeMeasurement({ id: "m4", aiGeometry: null, csiDivision: "DIV 05" }),
    ];
    render(<DivisionFilterPanel {...defaultProps} measurements={measurements} />);

    expect(screen.getByTestId("division-row-DIV-03")).toBeTruthy();
    expect(screen.getByTestId("division-row-DIV-05")).toBeTruthy();
    expect(screen.queryByTestId("division-row-DIV-01")).toBeNull();
  });

  it("shows the item count per division", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
    ];
    render(<DivisionFilterPanel {...defaultProps} measurements={measurements} />);
    const row = screen.getByTestId("division-row-DIV-03");
    expect(row.textContent).toContain("2");
  });

  it("all division checkboxes start checked when hiddenDivisions is empty", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: AI_GEOMETRY_05,
        csiDivision: "DIV 05",
      }),
    ];
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        hiddenDivisions={new Set()}
      />,
    );

    const div03Checkbox = screen.getByTestId("checkbox-division-DIV-03") as HTMLInputElement;
    const div05Checkbox = screen.getByTestId("checkbox-division-DIV-05") as HTMLInputElement;
    expect(div03Checkbox.checked).toBe(true);
    expect(div05Checkbox.checked).toBe(true);
  });

  it("unchecked state reflected when division is in hiddenDivisions", () => {
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
      makeMeasurement({
        id: "m2",
        aiGeometry: AI_GEOMETRY_05,
        csiDivision: "DIV 05",
      }),
    ];
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        hiddenDivisions={new Set(["DIV 03"])}
      />,
    );

    const div03Checkbox = screen.getByTestId("checkbox-division-DIV-03") as HTMLInputElement;
    const div05Checkbox = screen.getByTestId("checkbox-division-DIV-05") as HTMLInputElement;
    expect(div03Checkbox.checked).toBe(false);
    expect(div05Checkbox.checked).toBe(true);
  });
});

describe("DivisionFilterPanel — toggling a single division", () => {
  it("calls onToggleDivision with the division code when its checkbox is clicked", () => {
    const onToggle = vi.fn();
    const measurements = [
      makeMeasurement({
        id: "m1",
        aiGeometry: AI_GEOMETRY_03,
        csiDivision: "DIV 03",
      }),
    ];
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        onToggleDivision={onToggle}
      />,
    );

    const checkbox = screen.getByTestId("checkbox-division-DIV-03");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledWith("DIV 03");
  });
});

describe("DivisionFilterPanel — Show all / Hide all", () => {
  const measurements = [
    makeMeasurement({
      id: "m1",
      aiGeometry: AI_GEOMETRY_03,
      csiDivision: "DIV 03",
    }),
    makeMeasurement({
      id: "m2",
      aiGeometry: AI_GEOMETRY_05,
      csiDivision: "DIV 05",
    }),
  ];

  it("master checkbox is checked when all divisions are visible", () => {
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        hiddenDivisions={new Set()}
      />,
    );
    const master = screen.getByTestId("checkbox-division-filter-all") as HTMLInputElement;
    expect(master.checked).toBe(true);
  });

  it("master checkbox is unchecked when all divisions are hidden", () => {
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        hiddenDivisions={new Set(["DIV 03", "DIV 05"])}
      />,
    );
    const master = screen.getByTestId("checkbox-division-filter-all") as HTMLInputElement;
    expect(master.checked).toBe(false);
  });

  it("clicking master checkbox when all visible calls onHideAll with all codes", () => {
    const onHideAll = vi.fn();
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        hiddenDivisions={new Set()}
        onHideAll={onHideAll}
      />,
    );
    const master = screen.getByTestId("checkbox-division-filter-all");
    fireEvent.click(master);
    expect(onHideAll).toHaveBeenCalledOnce();
    const args: string[] = onHideAll.mock.calls[0][0];
    expect(args).toContain("DIV 03");
    expect(args).toContain("DIV 05");
  });

  it("clicking master checkbox when all hidden calls onShowAll", () => {
    const onShowAll = vi.fn();
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        hiddenDivisions={new Set(["DIV 03", "DIV 05"])}
        onShowAll={onShowAll}
      />,
    );
    const master = screen.getByTestId("checkbox-division-filter-all");
    fireEvent.click(master);
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <DivisionFilterPanel
        {...defaultProps}
        measurements={measurements}
        onClose={onClose}
      />,
    );
    const closeBtn = screen.getByTestId("button-close-division-filter");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
