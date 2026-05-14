// @vitest-environment jsdom
/**
 * Task #2870 — T&M Labor tab unit tests.
 * Covers: renders initial entry, field inputs update correctly,
 * add/remove entries, remove disabled when only one entry.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TMLaborTab, { emptyLaborEntry, type LaborEntry } from "../TMLaborTab";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
  );
}

function renderTab(
  entries: LaborEntry[],
  overrides: {
    onAdd?: () => void;
    onRemove?: (i: number) => void;
    onUpdate?: (i: number, field: keyof LaborEntry, value: string) => void;
    onBulkUpdate?: (i: number, updates: Partial<LaborEntry>) => void;
  } = {}
) {
  const onAdd = overrides.onAdd ?? vi.fn();
  const onRemove = overrides.onRemove ?? vi.fn();
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onBulkUpdate = overrides.onBulkUpdate ?? vi.fn();
  const result = render(
    <Wrapper>
      <TMLaborTab
        entries={entries}
        onAdd={onAdd}
        onRemove={onRemove}
        onUpdate={onUpdate}
        onBulkUpdate={onBulkUpdate}
      />
    </Wrapper>
  );
  return { onAdd, onRemove, onUpdate, onBulkUpdate, ...result };
}

describe("TMLaborTab", () => {
  beforeEach(() => cleanup());

  it("renders a single empty labor entry on load", () => {
    renderTab([emptyLaborEntry()]);
    expect(screen.getByTestId("input-labor-position-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-labor-reg-hours-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-labor-ot-hours-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-labor-rate-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-labor-ot-rate-0")).toBeInTheDocument();
  });

  it("calls onUpdate when position field changes", () => {
    const { onUpdate } = renderTab([emptyLaborEntry()]);
    fireEvent.change(screen.getByTestId("input-labor-position-0"), {
      target: { value: "Carpenter" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "position", "Carpenter");
  });

  it("calls onUpdate when regular hours field changes", () => {
    const { onUpdate } = renderTab([emptyLaborEntry()]);
    fireEvent.change(screen.getByTestId("input-labor-reg-hours-0"), {
      target: { value: "8" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "regularHours", "8");
  });

  it("calls onUpdate when overtime hours field changes", () => {
    const { onUpdate } = renderTab([emptyLaborEntry()]);
    fireEvent.change(screen.getByTestId("input-labor-ot-hours-0"), {
      target: { value: "2" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "overtimeHours", "2");
  });

  it("calls onUpdate when rate field changes", () => {
    const { onUpdate } = renderTab([emptyLaborEntry()]);
    fireEvent.change(screen.getByTestId("input-labor-rate-0"), {
      target: { value: "55" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "rate", "55");
  });

  it("calls onUpdate when OT rate field changes", () => {
    const { onUpdate } = renderTab([emptyLaborEntry()]);
    fireEvent.change(screen.getByTestId("input-labor-ot-rate-0"), {
      target: { value: "82.5" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "overtimeRate", "82.5");
  });

  it("calls onAdd when 'Add Labor Entry' button is clicked", () => {
    const { onAdd } = renderTab([emptyLaborEntry()]);
    fireEvent.click(screen.getByTestId("button-add-labor"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("remove button is disabled when there is only one entry", () => {
    renderTab([emptyLaborEntry()]);
    expect(screen.getByTestId("button-remove-labor-0")).toBeDisabled();
  });

  it("remove button is enabled when there are multiple entries", () => {
    renderTab([emptyLaborEntry(), emptyLaborEntry()]);
    expect(screen.getByTestId("button-remove-labor-0")).not.toBeDisabled();
    expect(screen.getByTestId("button-remove-labor-1")).not.toBeDisabled();
  });

  it("calls onRemove with the correct index when removing an entry", () => {
    const { onRemove } = renderTab([emptyLaborEntry(), emptyLaborEntry()]);
    fireEvent.click(screen.getByTestId("button-remove-labor-1"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("renders multiple entries with correct indices", () => {
    renderTab([emptyLaborEntry(), emptyLaborEntry(), emptyLaborEntry()]);
    expect(screen.getByTestId("input-labor-position-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-labor-position-1")).toBeInTheDocument();
    expect(screen.getByTestId("input-labor-position-2")).toBeInTheDocument();
  });

  it("renders entry values from props", () => {
    const entry: LaborEntry = {
      ...emptyLaborEntry(),
      position: "Superintendent",
      regularHours: "10",
      rate: "75",
    };
    renderTab([entry]);
    expect(screen.getByTestId("input-labor-position-0")).toHaveValue("Superintendent");
    expect(screen.getByTestId("input-labor-reg-hours-0")).toHaveValue(10);
    expect(screen.getByTestId("input-labor-rate-0")).toHaveValue(75);
  });
});
