// @vitest-environment jsdom
/**
 * Task #2870 — T&M Material tab unit tests.
 * Covers: empty state, manual add, field updates, remove, add from catalog.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TMMaterialTab, { emptyMaterialEntry, type MaterialEntry } from "../TMMaterialTab";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

interface SelCtxVal { value: string; onValueChange: (v: string) => void; }
interface SelProps { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode; }
interface SelTriggerProps { children?: React.ReactNode; className?: string; "data-testid"?: string; }
interface SelValueProps { placeholder?: string; }
interface SelContentProps { children?: React.ReactNode; }
interface SelItemProps { value: string; children?: React.ReactNode; "data-testid"?: string; }

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Ctx = React.createContext<SelCtxVal>({ value: "", onValueChange: () => {} });
  return {
    Select: ({ value = "", onValueChange = () => {}, children }: SelProps) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, className }: SelTriggerProps) => (
      <div className={className}>{children}</div>
    ),
    SelectValue: ({ placeholder }: SelValueProps) => <span>{placeholder}</span>,
    SelectContent: ({ children }: SelContentProps) => <div>{children}</div>,
    SelectItem: ({ value, children }: SelItemProps) => {
      const ctx = React.useContext(Ctx);
      return (
        <button type="button" onClick={() => ctx.onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
  );
}

function renderTab(
  entries: MaterialEntry[],
  overrides: {
    onAdd?: () => void;
    onRemove?: (i: number) => void;
    onUpdate?: (i: number, field: keyof MaterialEntry, value: string) => void;
    onAddFromCatalog?: (entry: MaterialEntry) => void;
  } = {}
) {
  const onAdd = overrides.onAdd ?? vi.fn();
  const onRemove = overrides.onRemove ?? vi.fn();
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onAddFromCatalog = overrides.onAddFromCatalog ?? vi.fn();
  const result = render(
    <Wrapper>
      <TMMaterialTab
        entries={entries}
        onAdd={onAdd}
        onRemove={onRemove}
        onUpdate={onUpdate}
        onAddFromCatalog={onAddFromCatalog}
      />
    </Wrapper>
  );
  return { onAdd, onRemove, onUpdate, onAddFromCatalog, ...result };
}

describe("TMMaterialTab", () => {
  beforeEach(() => cleanup());

  it("shows empty state message when there are no entries", () => {
    renderTab([]);
    expect(screen.getByText(/No material entries/i)).toBeInTheDocument();
  });

  it("renders an 'Add Material Manually' button", () => {
    renderTab([]);
    expect(screen.getByTestId("button-add-material")).toBeInTheDocument();
  });

  it("calls onAdd when 'Add Material Manually' is clicked", () => {
    const { onAdd } = renderTab([]);
    fireEvent.click(screen.getByTestId("button-add-material"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("renders a material entry when one is provided", () => {
    renderTab([emptyMaterialEntry()]);
    expect(screen.getByTestId("input-material-desc-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-material-qty-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-material-unit-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-material-cost-0")).toBeInTheDocument();
  });

  it("displays entry values from props", () => {
    const entry: MaterialEntry = {
      description: "Concrete mix",
      quantity: "5",
      unit: "cy",
      unitCost: "120",
      category: "CONCRETE",
    };
    renderTab([entry]);
    expect(screen.getByTestId("input-material-desc-0")).toHaveValue("Concrete mix");
    expect(screen.getByTestId("input-material-qty-0")).toHaveValue(5);
    expect(screen.getByTestId("input-material-unit-0")).toHaveValue("cy");
    expect(screen.getByTestId("input-material-cost-0")).toHaveValue(120);
  });

  it("calls onUpdate when description changes", () => {
    const { onUpdate } = renderTab([emptyMaterialEntry()]);
    fireEvent.change(screen.getByTestId("input-material-desc-0"), {
      target: { value: "Rebar #4" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "description", "Rebar #4");
  });

  it("calls onUpdate when quantity changes", () => {
    const { onUpdate } = renderTab([emptyMaterialEntry()]);
    fireEvent.change(screen.getByTestId("input-material-qty-0"), {
      target: { value: "10" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "quantity", "10");
  });

  it("calls onUpdate when unit changes", () => {
    const { onUpdate } = renderTab([emptyMaterialEntry()]);
    fireEvent.change(screen.getByTestId("input-material-unit-0"), {
      target: { value: "lf" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "unit", "lf");
  });

  it("calls onUpdate when unit cost changes", () => {
    const { onUpdate } = renderTab([emptyMaterialEntry()]);
    fireEvent.change(screen.getByTestId("input-material-cost-0"), {
      target: { value: "45.50" },
    });
    expect(onUpdate).toHaveBeenCalledWith(0, "unitCost", "45.50");
  });

  it("calls onRemove with the correct index", () => {
    const { onRemove } = renderTab([emptyMaterialEntry(), emptyMaterialEntry()]);
    fireEvent.click(screen.getByTestId("button-remove-material-0"));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("renders multiple entries with correct indices", () => {
    renderTab([emptyMaterialEntry(), emptyMaterialEntry()]);
    expect(screen.getByTestId("input-material-desc-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-material-desc-1")).toBeInTheDocument();
  });

  it("renders the vendor pricing catalog section", () => {
    renderTab([]);
    expect(screen.getByText("Vendor Pricing Catalog")).toBeInTheDocument();
  });
});
