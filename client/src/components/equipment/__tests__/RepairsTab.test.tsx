// @vitest-environment jsdom
// Task #2870 — Equipment work order (repairs) tab tests.
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RepairsTab } from "../EquipmentTabs";

// ── mock stubs ───────────────────────────────────────────────────────────────
const { mockApiRequest, mockToast } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── typed Select stub ────────────────────────────────────────────────────────
interface SelCtx { value: string; onValueChange: (v: string) => void; }
interface SelProps { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode; }
interface SelTriggerProps { children?: React.ReactNode; className?: string; }
interface SelContentProps { children?: React.ReactNode; }
interface SelItemProps { value: string; children?: React.ReactNode; }

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Ctx = React.createContext<SelCtx>({ value: "", onValueChange: () => {} });
  return {
    Select: ({ value = "", onValueChange = () => {}, children }: SelProps) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, className }: SelTriggerProps) => (
      <div className={className}>{children}</div>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: SelContentProps) => <div>{children}</div>,
    SelectItem: ({ value, children }: SelItemProps) => {
      const ctx = React.useContext(Ctx);
      return (
        <button type="button" data-value={value} onClick={() => ctx.onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

interface LinkProps { href?: string; children?: React.ReactNode; className?: string; }
vi.mock("wouter", () => ({
  Link: ({ href, children, className }: LinkProps) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// ── fixtures ─────────────────────────────────────────────────────────────────
interface RepairFixture {
  id: string;
  repairNumber: string;
  description: string;
  problemReportedAt: string;
  status: string;
  estimatedCost: string | null;
  actualCost: string | null;
  pm_cycle_key?: string;
}

const SAMPLE_REPAIR: RepairFixture = {
  id: "repair-001",
  repairNumber: "REP-2026-001",
  description: "Replace hydraulic hose",
  problemReportedAt: "2026-05-01T00:00:00Z",
  status: "PENDING",
  estimatedCost: "250",
  actualCost: null,
};

const PM_REPAIR: RepairFixture = {
  id: "repair-pm-001",
  repairNumber: "PM-TRUCK01-20260501-ABCD",
  description: "[PM:sched-123] Oil Change (auto-generated, due by date)",
  problemReportedAt: "2026-05-01T00:00:00Z",
  status: "PENDING",
  estimatedCost: null,
  actualCost: null,
  pm_cycle_key: "2026-05-01",
};

const COMPLETED_REPAIR: RepairFixture = {
  id: "repair-002",
  repairNumber: "REP-2026-002",
  description: "Tire replacement",
  problemReportedAt: "2026-04-15T00:00:00Z",
  status: "COMPLETED",
  estimatedCost: null,
  actualCost: "180",
};

// ── helpers ──────────────────────────────────────────────────────────────────
function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={makeQC()}>{children}</QueryClientProvider>;
}

function renderRepairs(repairs: RepairFixture[], canEdit = true) {
  return render(
    <Wrapper>
      <RepairsTab
        repairs={repairs}
        canEdit={canEdit}
        onOpenRepair={vi.fn()}
        onUpdateRepairStatus={vi.fn()}
      />
    </Wrapper>
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe("RepairsTab", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockToast.mockReset();
  });
  afterEach(() => cleanup());

  describe("empty state", () => {
    it("shows 'No repair history' when repairs list is empty", () => {
      renderRepairs([]);
      expect(screen.getByText("No repair history")).toBeInTheDocument();
    });

    it("renders the 'Report Issue' button when canEdit=true", () => {
      renderRepairs([]);
      expect(screen.getByTestId("button-new-repair")).toBeInTheDocument();
    });

    it("does not render 'Report Issue' button when canEdit=false", () => {
      renderRepairs([], false);
      expect(screen.queryByTestId("button-new-repair")).not.toBeInTheDocument();
    });
  });

  describe("creating a repair work order", () => {
    it("calls onOpenRepair when 'Report Issue' is clicked", () => {
      const onOpenRepair = vi.fn();
      render(
        <Wrapper>
          <RepairsTab
            repairs={[]}
            canEdit={true}
            onOpenRepair={onOpenRepair}
            onUpdateRepairStatus={vi.fn()}
          />
        </Wrapper>
      );
      fireEvent.click(screen.getByTestId("button-new-repair"));
      expect(onOpenRepair).toHaveBeenCalledTimes(1);
    });
  });

  describe("repair list rendering", () => {
    it("renders repair number and description", () => {
      renderRepairs([SAMPLE_REPAIR]);
      expect(screen.getByText("REP-2026-001")).toBeInTheDocument();
      expect(screen.getByText("Replace hydraulic hose")).toBeInTheDocument();
    });

    it("shows estimated cost when no actual cost is set", () => {
      renderRepairs([SAMPLE_REPAIR]);
      expect(screen.getByText("~$250")).toBeInTheDocument();
    });

    it("shows actual cost when available", () => {
      renderRepairs([COMPLETED_REPAIR]);
      expect(screen.getByText("$180")).toBeInTheDocument();
    });

    it("renders the status badge for each repair", () => {
      renderRepairs([SAMPLE_REPAIR, COMPLETED_REPAIR]);
      expect(screen.getByText("PENDING")).toBeInTheDocument();
      expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    });

    it("renders multiple repairs", () => {
      renderRepairs([SAMPLE_REPAIR, COMPLETED_REPAIR]);
      expect(screen.getByText("REP-2026-001")).toBeInTheDocument();
      expect(screen.getByText("REP-2026-002")).toBeInTheDocument();
    });
  });

  describe("PM-generated work orders", () => {
    it("renders PM work order with encoded repair number", () => {
      renderRepairs([PM_REPAIR]);
      expect(screen.getByText("PM-TRUCK01-20260501-ABCD")).toBeInTheDocument();
    });

    it("renders PM work order description containing the PM tag", () => {
      renderRepairs([PM_REPAIR]);
      expect(screen.getByText(/Oil Change \(auto-generated, due by date\)/)).toBeInTheDocument();
    });

    it("PM work order starts as PENDING", () => {
      renderRepairs([PM_REPAIR], false);
      expect(screen.getByText("PENDING")).toBeInTheDocument();
    });
  });

  describe("marking a work order complete (status update)", () => {
    it("calls onUpdateRepairStatus with 'COMPLETED' when status is changed", () => {
      const onUpdateRepairStatus = vi.fn();
      render(
        <Wrapper>
          <RepairsTab
            repairs={[SAMPLE_REPAIR]}
            canEdit={true}
            onOpenRepair={vi.fn()}
            onUpdateRepairStatus={onUpdateRepairStatus}
          />
        </Wrapper>
      );
      fireEvent.click(screen.getByText("Completed"));
      expect(onUpdateRepairStatus).toHaveBeenCalledWith("repair-001", "COMPLETED");
    });

    it("calls onUpdateRepairStatus with 'IN_PROGRESS'", () => {
      const onUpdateRepairStatus = vi.fn();
      render(
        <Wrapper>
          <RepairsTab
            repairs={[SAMPLE_REPAIR]}
            canEdit={true}
            onOpenRepair={vi.fn()}
            onUpdateRepairStatus={onUpdateRepairStatus}
          />
        </Wrapper>
      );
      fireEvent.click(screen.getByText("In Progress"));
      expect(onUpdateRepairStatus).toHaveBeenCalledWith("repair-001", "IN_PROGRESS");
    });

    it("status select is not rendered when canEdit=false", () => {
      renderRepairs([SAMPLE_REPAIR], false);
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
      expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
    });
  });

  describe("duplicate PM prevention guard", () => {
    /**
     * The PM engine's (schedule_id, pm_cycle_key) unique index prevents
     * creating two PENDING rows for the same cycle. When the engine blocks
     * a duplicate it returns { generated: 0, skipped: 1,
     * skippedReasons: { alreadyOpen: 1 } }. The tests below verify:
     *   1. The repair list shows exactly one row for an already-open cycle.
     *   2. A component that triggers the API and surfaces the response
     *      correctly shows the "already open" uniqueness feedback to the user.
     */

    it("shows exactly one PENDING row for a PM cycle that is already open", () => {
      renderRepairs([PM_REPAIR]);
      expect(screen.getAllByText("PENDING")).toHaveLength(1);
      expect(screen.getByText("PM-TRUCK01-20260501-ABCD")).toBeInTheDocument();
    });

    it("surfaces 'already open' notice when PM generation is triggered for an existing cycle", async () => {
      // The real RepairsTab component accepts onGeneratePmWorkOrders; when the
      // engine returns alreadyOpen=1 it renders data-testid="pm-already-open-notice".
      const onGeneratePmWorkOrders = vi.fn().mockResolvedValue({
        checked: 1,
        generated: 0,
        skipped: 1,
        skippedReasons: { alreadyOpen: 1, raceLost: 0, notDue: 0 },
        scheduleIds: ["sched-123"],
      });

      render(
        <Wrapper>
          <RepairsTab
            repairs={[PM_REPAIR]}
            canEdit={true}
            onOpenRepair={vi.fn()}
            onUpdateRepairStatus={vi.fn()}
            onGeneratePmWorkOrders={onGeneratePmWorkOrders}
          />
        </Wrapper>
      );

      // The real "Generate PM Work Orders" button is rendered by RepairsTab.
      fireEvent.click(screen.getByTestId("button-generate-pm-work-orders"));

      // RepairsTab processes the PmEngineResult and renders the notice.
      await waitFor(() => {
        expect(screen.getByTestId("pm-already-open-notice")).toBeInTheDocument();
        expect(screen.getByText(/1 work order\(s\) already open/)).toBeInTheDocument();
      });

      // The existing PM repair row is still the only row shown — no duplicate.
      expect(screen.getAllByText("PENDING")).toHaveLength(1);
      expect(screen.getByText("PM-TRUCK01-20260501-ABCD")).toBeInTheDocument();
    });

    it("'Report Issue' can still create a manual repair when an open PM repair exists", () => {
      const onOpenRepair = vi.fn();
      render(
        <Wrapper>
          <RepairsTab
            repairs={[PM_REPAIR]}
            canEdit={true}
            onOpenRepair={onOpenRepair}
            onUpdateRepairStatus={vi.fn()}
          />
        </Wrapper>
      );
      fireEvent.click(screen.getByTestId("button-new-repair"));
      expect(onOpenRepair).toHaveBeenCalledTimes(1);
    });
  });
});
