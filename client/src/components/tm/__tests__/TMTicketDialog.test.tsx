// @vitest-environment jsdom
/**
 * Task #2870 — T&M ticket dialog submission flow tests.
 * Covers: renders dialog, required field validation (description, at least one
 * line item), happy-path API call fires with correct payload, success toast,
 * error handling, loading state, and location passthrough.
 *
 * TMLaborTab is mocked with a lightweight stub so the Radix combobox
 * (which uses portals / pointer events) does not interfere with jsdom.
 * That component's own behaviour is covered in TMLaborTab.test.tsx.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockToast, mockCreateMutation } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockCreateMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/hooks/use-data", () => ({
  useCreateTMTicket: () => mockCreateMutation,
}));

vi.mock("@/components/StandardizedScopeSelector", () => ({
  default: () => <div data-testid="scope-selector" />,
}));

// ── typed mock interfaces ────────────────────────────────────────────────────
interface CCBoxProps { onChange: (code: string) => void; }

interface TabsCtxVal { value: string; onValueChange: (v: string) => void; }
interface TabsRootProps { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode; defaultValue?: string; }
interface TabsListProps { children?: React.ReactNode; }
interface TabsTriggerProps { value: string; children?: React.ReactNode; "data-testid"?: string; }
interface TabsContentProps { value: string; children?: React.ReactNode; }

interface SelCtxVal { value: string; onValueChange: (v: string) => void; }
interface SelProps { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode; }
interface SelTriggerProps { children?: React.ReactNode; className?: string; "data-testid"?: string; }
interface SelValueProps { placeholder?: string; }
interface SelContentProps { children?: React.ReactNode; }
interface SelItemProps { value: string; children?: React.ReactNode; }

interface LaborTabStubProps {
  entries: Array<{ employeeName: string; regularHours: string; rate: string }>;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, field: string, value: string) => void;
}

vi.mock("@/components/CostCodeCombobox", () => ({
  CostCodeCombobox: ({ onChange }: CCBoxProps) => (
    <button type="button" data-testid="cost-code-combobox" onClick={() => onChange("03-100")}>
      Select Cost Code
    </button>
  ),
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const Ctx = React.createContext<TabsCtxVal>({ value: "labor", onValueChange: () => {} });
  return {
    Tabs: ({ value, onValueChange, children, defaultValue }: TabsRootProps) => {
      const [tab, setTab] = React.useState(value ?? defaultValue ?? "labor");
      const change = (v: string) => { setTab(v); onValueChange?.(v); };
      return <Ctx.Provider value={{ value: tab, onValueChange: change }}>{children}</Ctx.Provider>;
    },
    TabsList: ({ children }: TabsListProps) => <div>{children}</div>,
    TabsTrigger: ({ value, children, ...rest }: TabsTriggerProps) => {
      const ctx = React.useContext(Ctx);
      return (
        <button type="button" onClick={() => ctx.onValueChange(value)} {...rest}>
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: TabsContentProps) => {
      const ctx = React.useContext(Ctx);
      return ctx.value === value ? <div>{children}</div> : null;
    },
  };
});

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
        <button type="button" onClick={() => ctx.onValueChange(value)}>{children}</button>
      );
    },
  };
});

/** Stub for TMLaborTab — plain inputs avoid Radix Popover/Command in jsdom. */
vi.mock("../TMLaborTab", async () => {
  const { emptyLaborEntry } = await vi.importActual<typeof import("../TMLaborTab")>("../TMLaborTab");
  return {
    emptyLaborEntry,
    default: ({ entries, onAdd, onRemove, onUpdate }: LaborTabStubProps) => (
      <div data-testid="labor-tab-stub">
        {entries.map((entry, index) => (
          <div key={index}>
            <input
              data-testid={`stub-labor-name-${index}`}
              value={entry.employeeName}
              onChange={(e) => onUpdate(index, "employeeName", e.target.value)}
              aria-label="Employee Name"
            />
            <input
              data-testid={`stub-labor-hours-${index}`}
              type="number"
              value={entry.regularHours}
              onChange={(e) => onUpdate(index, "regularHours", e.target.value)}
              aria-label="Reg Hours"
            />
            <input
              data-testid={`stub-labor-rate-${index}`}
              type="number"
              value={entry.rate}
              onChange={(e) => onUpdate(index, "rate", e.target.value)}
              aria-label="Rate"
            />
            <button
              type="button"
              data-testid={`stub-remove-labor-${index}`}
              onClick={() => onRemove(index)}
              disabled={entries.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" data-testid="button-add-labor" onClick={onAdd}>
          Add Labor Entry
        </button>
      </div>
    ),
  };
});

import TMTicketDialog from "../TMTicketDialog";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDialog(open = true, onOpenChange = vi.fn()) {
  const qc = makeQC();
  return render(
    <QueryClientProvider client={qc}>
      <TMTicketDialog projectId="proj-abc" open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
}

function fillValidLaborEntry() {
  fireEvent.change(screen.getByTestId("stub-labor-name-0"), {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(screen.getByTestId("stub-labor-hours-0"), {
    target: { value: "8" },
  });
  fireEvent.change(screen.getByTestId("stub-labor-rate-0"), {
    target: { value: "45" },
  });
}

describe("TMTicketDialog", () => {
  beforeEach(() => {
    mockCreateMutation.mutateAsync.mockReset();
    mockToast.mockReset();
    mockCreateMutation.isPending = false;
  });
  afterEach(() => cleanup());

  describe("rendering", () => {
    it("renders the dialog when open=true", () => {
      renderDialog();
      expect(screen.getByTestId("dialog-create-tm-ticket")).toBeInTheDocument();
      expect(screen.getByText("Create T&M Work Ticket")).toBeInTheDocument();
    });

    it("renders the description textarea", () => {
      renderDialog();
      expect(screen.getByTestId("input-tm-description")).toBeInTheDocument();
    });

    it("renders the location input", () => {
      renderDialog();
      expect(screen.getByTestId("input-tm-location")).toBeInTheDocument();
    });

    it("renders the submit button", () => {
      renderDialog();
      expect(screen.getByTestId("button-submit-tm-ticket")).toBeInTheDocument();
    });
  });

  describe("field validation", () => {
    it("shows error toast when description is empty and submit is clicked", async () => {
      renderDialog();
      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: "destructive" })
        );
      });
    });

    it("shows 'at least one' error when description filled but no valid line items", async () => {
      renderDialog();
      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Installed rebar" },
      });
      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "destructive",
            description: expect.stringMatching(/at least one/i),
          })
        );
      });
    });
  });

  describe("happy path submission", () => {
    it("calls mutateAsync with correct payload when form is valid", async () => {
      mockCreateMutation.mutateAsync.mockResolvedValue({});
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Foundation pour" },
      });
      fillValidLaborEntry();

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        expect(mockCreateMutation.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj-abc",
            description: "Foundation pour",
            laborEntries: expect.arrayContaining([
              expect.objectContaining({
                employeeName: "Jane Doe",
                regularHours: "8",
                rate: "45",
              }),
            ]),
          })
        );
      });
    });

    it("shows success toast after successful submission", async () => {
      mockCreateMutation.mutateAsync.mockResolvedValue({});
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Framing work" },
      });
      fillValidLaborEntry();

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Success" })
        );
      });
    });

    it("shows error toast when mutateAsync throws", async () => {
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error("Network failure"));
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Grading work" },
      });
      fillValidLaborEntry();

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: "destructive", title: "Error" })
        );
      });
    });

    it("passes location to the payload when filled in", async () => {
      mockCreateMutation.mutateAsync.mockResolvedValue({});
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-location"), {
        target: { value: "Zone B" },
      });
      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Excavation" },
      });
      fillValidLaborEntry();

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        expect(mockCreateMutation.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ location: "Zone B" })
        );
      });
    });
  });

  describe("loading state", () => {
    it("submit button shows 'Creating...' and is disabled while isPending=true", () => {
      mockCreateMutation.isPending = true;
      renderDialog();
      const btn = screen.getByTestId("button-submit-tm-ticket");
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent("Creating...");
    });
  });

  describe("cost code assignment", () => {
    it("includes the selected cost code in the submission payload", async () => {
      mockCreateMutation.mutateAsync.mockResolvedValue({});
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Cost code test" },
      });
      fillValidLaborEntry();
      fireEvent.click(screen.getByTestId("cost-code-combobox"));

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        expect(mockCreateMutation.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ costCode: "03-100" })
        );
      });
    });
  });

  describe("line item management", () => {
    it("adds a second labor entry when 'Add Labor Entry' is clicked", () => {
      renderDialog();
      expect(screen.getByTestId("stub-labor-name-0")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("button-add-labor"));
      expect(screen.getByTestId("stub-labor-name-1")).toBeInTheDocument();
    });

    it("adds a material entry when 'Add Material Manually' is clicked", () => {
      renderDialog();
      fireEvent.click(screen.getByTestId("tab-material-entries"));
      fireEvent.click(screen.getByTestId("button-add-material"));
      expect(screen.getByTestId("input-material-desc-0")).toBeInTheDocument();
    });

    it("includes material entries in the payload when submitted", async () => {
      mockCreateMutation.mutateAsync.mockResolvedValue({});
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Material delivery" },
      });

      fireEvent.click(screen.getByTestId("tab-material-entries"));
      fireEvent.click(screen.getByTestId("button-add-material"));

      fireEvent.change(screen.getByTestId("input-material-desc-0"), {
        target: { value: "Gravel" },
      });
      fireEvent.change(screen.getByTestId("input-material-qty-0"), {
        target: { value: "3" },
      });
      fireEvent.change(screen.getByTestId("input-material-cost-0"), {
        target: { value: "80" },
      });

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        expect(mockCreateMutation.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            materialEntries: expect.arrayContaining([
              expect.objectContaining({
                description: "Gravel",
                quantity: "3",
                unitCost: "80",
              }),
            ]),
          })
        );
      });
    });

    it("does not include invalid labor entries (hours = 0) in the payload", async () => {
      mockCreateMutation.mutateAsync.mockResolvedValue({});
      renderDialog();

      fireEvent.change(screen.getByTestId("input-tm-description"), {
        target: { value: "Concrete pour" },
      });
      fillValidLaborEntry();

      fireEvent.click(screen.getByTestId("button-add-labor"));
      fireEvent.change(screen.getByTestId("stub-labor-name-1"), {
        target: { value: "Bob Smith" },
      });

      fireEvent.click(screen.getByTestId("button-submit-tm-ticket"));

      await waitFor(() => {
        const call = mockCreateMutation.mutateAsync.mock.calls[0][0] as {
          laborEntries: Array<{ employeeName: string }>;
        };
        const names = call.laborEntries.map((e) => e.employeeName);
        expect(names).toContain("Jane Doe");
        expect(names).not.toContain("Bob Smith");
      });
    });
  });
});
