// @vitest-environment jsdom
/**
 * Task #2870 — TMTicketDetail client sign-off guard tests.
 *
 * The "Confirm Sign-off" button is guarded by:
 *   disabled={!signoffName || !signoffSignature || signoffMutation.isPending}
 *
 * Tests confirm:
 *  - Sign-off form is not shown until "Capture Client Sign-off" is clicked
 *  - Confirm button is disabled without a name
 *  - Confirm button is disabled without a signature even when name is set
 *  - Confirm button is enabled when both name and signature are present
 *  - Clicking confirm calls the client-signoff API endpoint
 *  - Existing signature image is shown when ticket already has clientSignoffAt
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

/**
 * Stub for SignaturePad: renders a "Draw" button that simulates capturing a
 * signature and a "Clear" button that clears it, so tests can verify the
 * signoff guard without real canvas interaction.
 */
vi.mock("../SignaturePad", () => ({
  default: ({
    onSignatureChange,
    disabled,
  }: {
    onSignatureChange: (dataUrl: string | null) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="stub-signature-pad">
      <button
        type="button"
        data-testid="stub-draw-signature"
        disabled={!!disabled}
        onClick={() => onSignatureChange("data:image/png;base64,fakeSignature")}
      >
        Simulate Draw
      </button>
      <button
        type="button"
        data-testid="stub-clear-signature"
        disabled={!!disabled}
        onClick={() => onSignatureChange(null)}
      >
        Clear
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import TMTicketDetail from "../TMTicketDetail";
import type { TMTicket } from "@/hooks/use-data";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={makeQC()}>{children}</QueryClientProvider>;
}

const BASE_TICKET: TMTicket = {
  id: "ticket-001",
  ticketNumber: "TM-001",
  projectId: "proj-abc",
  workDate: "2026-05-01",
  scopeDescription: "Foundation pour",
  notes: null,
  status: "SUBMITTED",
  totalLaborHours: "8",
  totalLaborCost: "800",
  totalEquipmentCost: "100",
  totalMaterialCost: "100",
  grandTotal: "1000",
  rejectionReason: null,
  clientSignoffAt: null,
  clientSignoffName: null,
  clientSignoffSignature: null,
  signedDocumentUrl: null,
  billingStatus: "",
  location: null,
  costCode: null,
  createdById: "user-1",
  createdByName: "Jane Doe",
  approvedById: null,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
  approvedAt: null,
  submittedAt: "2026-05-01T12:00:00Z",
  laborEntries: [],
  equipmentEntries: [],
  materialEntries: [],
};

function renderDetail(ticketOverrides: Partial<TMTicket> = {}) {
  const ticket = { ...BASE_TICKET, ...ticketOverrides };
  return render(
    <Wrapper>
      <TMTicketDetail
        ticket={ticket}
        canCreate={true}
        canApprove={true}
        onSubmit={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDelete={vi.fn()}
        onViewPDF={vi.fn()}
        submitPending={false}
        approvePending={false}
      />
    </Wrapper>
  );
}

describe("TMTicketDetail — client sign-off guard", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockToast.mockReset();
  });
  afterEach(() => cleanup());

  it("does not show the signoff form until 'Capture Client Sign-off' is clicked", () => {
    renderDetail();
    expect(screen.queryByTestId("signoff-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-start-signoff")).toBeInTheDocument();
  });

  it("reveals the signoff form after clicking 'Capture Client Sign-off'", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    expect(screen.getByTestId("signoff-form")).toBeInTheDocument();
  });

  it("confirm button is disabled when name is empty and no signature drawn", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    expect(screen.getByTestId("button-confirm-signoff")).toBeDisabled();
  });

  it("confirm button is disabled when name is filled but no signature drawn", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    fireEvent.change(screen.getByTestId("input-signoff-name"), {
      target: { value: "Bob Client" },
    });
    expect(screen.getByTestId("button-confirm-signoff")).toBeDisabled();
  });

  it("confirm button is disabled when signature is drawn but name is empty", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    fireEvent.click(screen.getByTestId("stub-draw-signature"));
    expect(screen.getByTestId("button-confirm-signoff")).toBeDisabled();
  });

  it("confirm button is enabled when both name and signature are present", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    fireEvent.change(screen.getByTestId("input-signoff-name"), {
      target: { value: "Bob Client" },
    });
    fireEvent.click(screen.getByTestId("stub-draw-signature"));
    expect(screen.getByTestId("button-confirm-signoff")).not.toBeDisabled();
  });

  it("confirm button becomes disabled again after clearing the signature", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    fireEvent.change(screen.getByTestId("input-signoff-name"), {
      target: { value: "Bob Client" },
    });
    fireEvent.click(screen.getByTestId("stub-draw-signature"));
    fireEvent.click(screen.getByTestId("stub-clear-signature"));
    expect(screen.getByTestId("button-confirm-signoff")).toBeDisabled();
  });

  it("clicking confirm calls the client-signoff API with name and signature", async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    renderDetail();
    fireEvent.click(screen.getByTestId("button-start-signoff"));
    fireEvent.change(screen.getByTestId("input-signoff-name"), {
      target: { value: "Bob Client" },
    });
    fireEvent.click(screen.getByTestId("stub-draw-signature"));
    fireEvent.click(screen.getByTestId("button-confirm-signoff"));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        `/api/tm-tickets/${BASE_TICKET.id}/client-signoff`,
        expect.objectContaining({
          clientName: "Bob Client",
          signature: "data:image/png;base64,fakeSignature",
        })
      );
    });
  });

  it("'Capture Client Sign-off' button is not shown when ticket is already signed off", () => {
    renderDetail({
      clientSignoffAt: "2026-05-02T10:00:00Z",
      clientSignoffName: "Bob Client",
      clientSignoffSignature: "data:image/png;base64,realSignature",
    });
    expect(screen.queryByTestId("button-start-signoff")).not.toBeInTheDocument();
    expect(screen.getByTestId("signoff-completed")).toBeInTheDocument();
  });

  it("renders the captured signature image when ticket is already signed off", () => {
    renderDetail({
      clientSignoffAt: "2026-05-02T10:00:00Z",
      clientSignoffName: "Bob Client",
      clientSignoffSignature: "data:image/png;base64,realSignature",
    });
    const sigImg = screen.getByTestId("img-client-signature");
    expect(sigImg).toHaveAttribute("src", "data:image/png;base64,realSignature");
  });

  it("sign-off button is not shown for DRAFT tickets (canSignoff is false)", () => {
    renderDetail({ status: "DRAFT" });
    expect(screen.queryByTestId("button-start-signoff")).not.toBeInTheDocument();
  });
});
