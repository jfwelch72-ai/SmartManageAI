// @vitest-environment jsdom
/**
 * Task #2871 — Transmittal state transition & form validation tests.
 *
 * Covers:
 *   - getTransmittalStatusBadge helper for each Transmittal status
 *   - TransmittalCreateDialog: subject required gates the create button,
 *     project required when no fixedProjectId, recipient list management
 *     (toggle subcontractors on/off)
 *   - TransmittalDetailDialog: DRAFT shows Send/Edit/Delete buttons,
 *     SENT shows Supersede button, Add Recipients available for SENT/ACKNOWLEDGED
 *   - TransmittalEditDialog: subject required gates save, document type selection
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DocumentAttachments from "@/components/DocumentAttachments";

/* ── shared mocks ─────────────────────────────────────────────────── */

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/email/RecipientListField", () => ({
  RecipientListField: () => null,
}));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
    DialogContent: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children, ...rest }: any) => <h2 {...rest}>{children}</h2>,
    DialogDescription: ({ children, ...rest }: any) => <p {...rest}>{children}</p>,
    DialogFooter: ({ children }: any) => <div>{children}</div>,
  };
});

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ value: string; onValueChange: (v: string) => void }>({
    value: "",
    onValueChange: () => {},
  });
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    SelectValue: ({ placeholder }: any) => <span>{placeholder ?? ""}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children, ...rest }: any) => {
      const ctx = React.useContext(Ctx);
      return (
        <button
          type="button"
          data-value={value}
          data-selected={ctx.value === value ? "true" : "false"}
          onClick={() => ctx.onValueChange(value)}
          {...rest}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/ui/table", () => ({
  Table: ({ children, ...rest }: any) => <table {...rest}>{children}</table>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...rest }: any) => <tr {...rest}>{children}</tr>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableCell: ({ children, ...rest }: any) => <td {...rest}>{children}</td>,
}));

/* ── helpers ──────────────────────────────────────────────────────── */

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(ui: React.ReactElement, qc = makeQC()) {
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/* ── fixtures ─────────────────────────────────────────────────────── */

function makeTransmittal(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "tx-1",
    projectId: "proj-1",
    transmittalNumber: "TX-001",
    subject: "Revised Structural Plans",
    description: "Updated floor framing plans",
    documentType: "Plans",
    revisionNumber: "Rev 2",
    status: "DRAFT",
    attachmentsJson: null,
    notes: "Please review and acknowledge receipt.",
    dateSent: null,
    sentByName: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    project: { code: "P-001", name: "Test Project" },
    recipients: [],
    recipientCount: 0,
    ...overrides,
  };
}

const SUBS = [
  { id: "sub-a", companyName: "Alpha Framing" },
  { id: "sub-b", companyName: "Beta Electric" },
];

/* ── getTransmittalStatusBadge helper tests ───────────────────────── */

import {
  getTransmittalStatusBadge,
  TransmittalDetailDialog,
  TransmittalCreateDialog,
  TransmittalEditDialog,
} from "@/components/document-control/TransmittalDetailDialog";

describe("getTransmittalStatusBadge", () => {
  afterEach(cleanup);

  it.each([
    ["DRAFT", "Draft"],
    ["SENT", "Sent"],
    ["ACKNOWLEDGED", "Acknowledged"],
    ["SUPERSEDED", "Superseded"],
  ])("renders correct label for status %s", (status, label) => {
    const { container } = render(<>{getTransmittalStatusBadge(status)}</>);
    expect(container.textContent).toContain(label);
  });

  it("renders raw value for unknown status", () => {
    const { container } = render(<>{getTransmittalStatusBadge("UNKNOWN_TX")}</>);
    expect(container.textContent).toContain("UNKNOWN_TX");
  });
});

/* ── TransmittalDetailDialog — state-driven button visibility ─────── */

describe("TransmittalDetailDialog — DRAFT state", () => {
  afterEach(cleanup);

  function mountDialog(txOverrides: Partial<Record<string, any>> = {}, propOverrides: Partial<Record<string, any>> = {}) {
    const tx = makeTransmittal(txOverrides);
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="td-"
        {...propOverrides}
      />
    );
    return { tx };
  }

  it("displays the transmittal number", () => {
    mountDialog();
    expect(screen.getByTestId("td-text-detail-tx-number").textContent).toContain("TX-001");
  });

  it("displays the subject", () => {
    mountDialog();
    expect(screen.getByTestId("td-text-detail-subject").textContent).toContain("Revised Structural Plans");
  });

  it("shows Send button for DRAFT", () => {
    mountDialog({ status: "DRAFT" });
    expect(screen.getByTestId("td-button-send-transmittal")).toBeDefined();
  });

  it("shows Edit button for DRAFT", () => {
    mountDialog({ status: "DRAFT" });
    expect(screen.getByTestId("td-button-edit-transmittal")).toBeDefined();
  });

  it("shows Delete button for DRAFT", () => {
    mountDialog({ status: "DRAFT" });
    expect(screen.getByTestId("td-button-delete-transmittal")).toBeDefined();
  });

  it("calls onSend when Send button is clicked", () => {
    const onSend = vi.fn();
    mountDialog({ status: "DRAFT" }, { onSend });
    fireEvent.click(screen.getByTestId("td-button-send-transmittal"));
    expect(onSend).toHaveBeenCalledWith("tx-1");
  });

  it("calls onDelete when Delete button is clicked", () => {
    const onDelete = vi.fn();
    mountDialog({ status: "DRAFT" }, { onDelete });
    fireEvent.click(screen.getByTestId("td-button-delete-transmittal"));
    expect(onDelete).toHaveBeenCalledWith("tx-1");
  });

  it("does not show Send button for SENT status", () => {
    mountDialog({ status: "SENT" });
    expect(screen.queryByTestId("td-button-send-transmittal")).toBeNull();
  });

  it("does not show Delete button for SENT status", () => {
    mountDialog({ status: "SENT" });
    expect(screen.queryByTestId("td-button-delete-transmittal")).toBeNull();
  });
});

describe("TransmittalDetailDialog — SENT state", () => {
  afterEach(cleanup);

  function mountSent(recipients: any[] = [], propOverrides: Partial<Record<string, any>> = {}) {
    const tx = makeTransmittal({
      status: "SENT",
      dateSent: "2026-01-05T10:00:00Z",
      sentByName: "Alice Admin",
      recipients,
    });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ts-"
        {...propOverrides}
      />
    );
    return { tx };
  }

  it("shows Supersede button for SENT status", () => {
    mountSent();
    expect(screen.getByTestId("ts-button-supersede-transmittal")).toBeDefined();
  });

  it("calls onSupersede when Supersede button is clicked", () => {
    const onSupersede = vi.fn();
    mountSent([], { onSupersede });
    fireEvent.click(screen.getByTestId("ts-button-supersede-transmittal"));
    expect(onSupersede).toHaveBeenCalledWith("tx-1");
  });

  it("shows Add Recipients button for SENT status", () => {
    mountSent();
    expect(screen.getByTestId("ts-button-add-recipients")).toBeDefined();
  });

  it("displays recipient rows when recipients are present", () => {
    const recipients = [
      { id: "r-1", transmittalId: "tx-1", subcontractorId: "sub-a", subcontractorName: "Alpha Framing", acknowledged: false, acknowledgedAt: null },
    ];
    mountSent(recipients);
    expect(screen.getByTestId("ts-row-recipient-r-1")).toBeDefined();
    expect(screen.getByTestId("ts-text-recipient-name-r-1").textContent).toContain("Alpha Framing");
  });

  it("shows 'No recipients assigned' when recipients list is empty", () => {
    mountSent([]);
    expect(screen.getByTestId("ts-text-no-recipients")).toBeDefined();
  });

  it("shows recipient pending status when not acknowledged", () => {
    const recipients = [
      { id: "r-1", transmittalId: "tx-1", subcontractorId: "sub-a", subcontractorName: "Alpha Framing", acknowledged: false, acknowledgedAt: null },
    ];
    mountSent(recipients);
    expect(screen.getByTestId("ts-status-recipient-r-1").textContent).toContain("Pending");
  });

  it("shows recipient acknowledged status when acknowledged", () => {
    const recipients = [
      { id: "r-1", transmittalId: "tx-1", subcontractorId: "sub-a", subcontractorName: "Alpha Framing", acknowledged: true, acknowledgedAt: "2026-01-06T09:00:00Z" },
    ];
    mountSent(recipients);
    expect(screen.getByTestId("ts-status-recipient-r-1").textContent).toContain("Acknowledged");
  });
});

describe("TransmittalDetailDialog — add recipients dialog", () => {
  afterEach(cleanup);

  it("opens add-recipients sub-dialog when button is clicked", () => {
    const tx = makeTransmittal({ status: "SENT", recipients: [] });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ar-"
      />
    );
    fireEvent.click(screen.getByTestId("ar-button-add-recipients"));
    expect(screen.getByTestId("ar-list-add-recipients")).toBeDefined();
  });

  it("submit add-recipients is disabled when no recipients selected", () => {
    const tx = makeTransmittal({ status: "SENT", recipients: [] });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ar-"
      />
    );
    fireEvent.click(screen.getByTestId("ar-button-add-recipients"));
    expect(screen.getByTestId("ar-button-submit-add-recipients").hasAttribute("disabled")).toBe(true);
  });

  it("submit add-recipients is enabled after selecting a subcontractor", () => {
    const tx = makeTransmittal({ status: "SENT", recipients: [] });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ar-"
      />
    );
    fireEvent.click(screen.getByTestId("ar-button-add-recipients"));
    fireEvent.click(screen.getByTestId("ar-checkbox-add-recipient-sub-a"));
    expect(screen.getByTestId("ar-button-submit-add-recipients").hasAttribute("disabled")).toBe(false);
  });

  it("calls onAddRecipients with selected sub IDs when submitted", () => {
    const onAddRecipients = vi.fn();
    const tx = makeTransmittal({ status: "SENT", recipients: [] });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={onAddRecipients}
        testIdPrefix="ar-"
      />
    );
    fireEvent.click(screen.getByTestId("ar-button-add-recipients"));
    fireEvent.click(screen.getByTestId("ar-checkbox-add-recipient-sub-a"));
    fireEvent.click(screen.getByTestId("ar-checkbox-add-recipient-sub-b"));
    fireEvent.click(screen.getByTestId("ar-button-submit-add-recipients"));
    expect(onAddRecipients).toHaveBeenCalledWith("tx-1", ["sub-a", "sub-b"]);
  });

  it("un-selecting a recipient removes it from the list to be added", () => {
    const onAddRecipients = vi.fn();
    const tx = makeTransmittal({ status: "SENT", recipients: [] });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={onAddRecipients}
        testIdPrefix="ar-"
      />
    );
    fireEvent.click(screen.getByTestId("ar-button-add-recipients"));
    fireEvent.click(screen.getByTestId("ar-checkbox-add-recipient-sub-a"));
    fireEvent.click(screen.getByTestId("ar-checkbox-add-recipient-sub-b"));
    fireEvent.click(screen.getByTestId("ar-checkbox-add-recipient-sub-b"));
    fireEvent.click(screen.getByTestId("ar-button-submit-add-recipients"));
    expect(onAddRecipients).toHaveBeenCalledWith("tx-1", ["sub-a"]);
  });

  it("excludes already-added recipients from the add list", () => {
    const tx = makeTransmittal({
      status: "SENT",
      recipients: [
        { id: "r-1", subcontractorId: "sub-a", subcontractorName: "Alpha Framing", acknowledged: false, acknowledgedAt: null },
      ],
    });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ar-"
      />
    );
    fireEvent.click(screen.getByTestId("ar-button-add-recipients"));
    expect(screen.queryByTestId("ar-checkbox-add-recipient-sub-a")).toBeNull();
    expect(screen.getByTestId("ar-checkbox-add-recipient-sub-b")).toBeDefined();
  });
});

/* ── TransmittalCreateDialog — subject and project gate ──────────── */

describe("TransmittalCreateDialog — form validation", () => {
  afterEach(cleanup);

  const PROJECTS = [{ id: "proj-1", code: "P-001", name: "Test Project" }];

  function mountCreate(overrides: Partial<Record<string, any>> = {}) {
    const onSubmit = vi.fn();
    wrap(
      <TransmittalCreateDialog
        open={true}
        onOpenChange={vi.fn()}
        subcontractors={SUBS}
        projects={PROJECTS}
        onSubmit={onSubmit}
        isPending={false}
        testIdPrefix="tc-"
        {...overrides}
      />
    );
    return { onSubmit };
  }

  it("renders subject input", () => {
    mountCreate();
    expect(screen.getByTestId("tc-input-create-subject")).toBeDefined();
  });

  it("create button is disabled when subject is empty and no fixedProjectId", () => {
    mountCreate();
    expect(screen.getByTestId("tc-button-submit-create").hasAttribute("disabled")).toBe(true);
  });

  it("create button is disabled when only subject is filled (no project selected)", () => {
    mountCreate();
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "New transmittal" },
    });
    expect(screen.getByTestId("tc-button-submit-create").hasAttribute("disabled")).toBe(true);
  });

  it("create button is enabled when subject filled and project selected", () => {
    mountCreate();
    const projBtn = screen.getByTestId("tc-select-create-project")
      .parentElement!.querySelector('[data-value="proj-1"]') as HTMLButtonElement;
    fireEvent.click(projBtn);
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "New transmittal" },
    });
    expect(screen.getByTestId("tc-button-submit-create").hasAttribute("disabled")).toBe(false);
  });

  it("with fixedProjectId, create button is enabled when only subject is filled", () => {
    mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "New transmittal" },
    });
    expect(screen.getByTestId("tc-button-submit-create").hasAttribute("disabled")).toBe(false);
  });

  it("calls onSubmit with form data when create button clicked", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "Site Plan Rev 3" },
    });
    fireEvent.change(screen.getByTestId("tc-input-create-description"), {
      target: { value: "Updated site layout" },
    });
    fireEvent.click(screen.getByTestId("tc-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Site Plan Rev 3",
        description: "Updated site layout",
      })
    );
  });

  it("recipients can be toggled via checkboxes", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.click(screen.getByTestId("tc-checkbox-recipient-sub-a"));
    fireEvent.click(screen.getByTestId("tc-checkbox-recipient-sub-b"));
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "Transmittal with recipients" },
    });
    fireEvent.click(screen.getByTestId("tc-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientSubcontractorIds: ["sub-a", "sub-b"],
      })
    );
  });

  it("un-toggling a recipient removes it from the selection", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.click(screen.getByTestId("tc-checkbox-recipient-sub-a"));
    fireEvent.click(screen.getByTestId("tc-checkbox-recipient-sub-a"));
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "Transmittal" },
    });
    fireEvent.click(screen.getByTestId("tc-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientSubcontractorIds: [],
      })
    );
  });

  it("document type selection is captured", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    const dtBtn = screen.getByTestId("tc-select-create-doctype")
      .parentElement!.querySelector('[data-value="Plans"]') as HTMLButtonElement;
    fireEvent.click(dtBtn);
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "Plans transmittal" },
    });
    fireEvent.click(screen.getByTestId("tc-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "Plans" })
    );
  });

  it("revision number is captured in form submission", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.change(screen.getByTestId("tc-input-create-revision"), {
      target: { value: "Rev 3" },
    });
    fireEvent.change(screen.getByTestId("tc-input-create-subject"), {
      target: { value: "Rev 3 plans" },
    });
    fireEvent.click(screen.getByTestId("tc-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ revisionNumber: "Rev 3" })
    );
  });
});

/* ── TransmittalEditDialog — subject gate ────────────────────────── */

describe("TransmittalEditDialog — form validation", () => {
  afterEach(cleanup);

  const baseForm = {
    subject: "",
    description: "",
    documentType: "",
    revisionNumber: "",
    notes: "",
  };

  it("Save Changes button is disabled when subject is empty", () => {
    const setEditForm = vi.fn();
    wrap(
      <TransmittalEditDialog
        open={true}
        onOpenChange={vi.fn()}
        editForm={{ ...baseForm, subject: "" }}
        setEditForm={setEditForm}
        onSubmit={vi.fn()}
        isPending={false}
        testIdPrefix="te-"
      />
    );
    expect(screen.getByTestId("te-button-submit-edit").hasAttribute("disabled")).toBe(true);
  });

  it("Save Changes button is enabled when subject is filled", () => {
    const setEditForm = vi.fn();
    wrap(
      <TransmittalEditDialog
        open={true}
        onOpenChange={vi.fn()}
        editForm={{ ...baseForm, subject: "Updated subject" }}
        setEditForm={setEditForm}
        onSubmit={vi.fn()}
        isPending={false}
        testIdPrefix="te-"
      />
    );
    expect(screen.getByTestId("te-button-submit-edit").hasAttribute("disabled")).toBe(false);
  });

  it("calls onSubmit when Save button clicked with subject", () => {
    const onSubmit = vi.fn();
    wrap(
      <TransmittalEditDialog
        open={true}
        onOpenChange={vi.fn()}
        editForm={{ ...baseForm, subject: "Revised subject" }}
        setEditForm={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
        testIdPrefix="te-"
      />
    );
    fireEvent.click(screen.getByTestId("te-button-submit-edit"));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("calls setEditForm when subject input changes", () => {
    const setEditForm = vi.fn();
    wrap(
      <TransmittalEditDialog
        open={true}
        onOpenChange={vi.fn()}
        editForm={{ ...baseForm, subject: "Old subject" }}
        setEditForm={setEditForm}
        onSubmit={vi.fn()}
        isPending={false}
        testIdPrefix="te-"
      />
    );
    fireEvent.change(screen.getByTestId("te-input-edit-subject"), {
      target: { value: "New subject" },
    });
    expect(setEditForm).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "New subject" })
    );
  });

  it("calls setEditForm when document type is changed", () => {
    const setEditForm = vi.fn();
    wrap(
      <TransmittalEditDialog
        open={true}
        onOpenChange={vi.fn()}
        editForm={{ ...baseForm, subject: "S" }}
        setEditForm={setEditForm}
        onSubmit={vi.fn()}
        isPending={false}
        testIdPrefix="te-"
      />
    );
    const dtBtn = screen.getByTestId("te-select-edit-doctype")
      .parentElement!.querySelector('[data-value="Drawings"]') as HTMLButtonElement;
    fireEvent.click(dtBtn);
    expect(setEditForm).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "Drawings" })
    );
  });

  it("Cancel button calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    wrap(
      <TransmittalEditDialog
        open={true}
        onOpenChange={onOpenChange}
        editForm={{ ...baseForm, subject: "S" }}
        setEditForm={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
        testIdPrefix="te-"
      />
    );
    fireEvent.click(screen.getByTestId("te-button-cancel-edit"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/* ── TransmittalCreateDialog — notes and description attachment fields */

describe("TransmittalCreateDialog — notes and description fields", () => {
  afterEach(cleanup);

  const PROJECTS = [{ id: "proj-1", code: "P-001", name: "Test Project" }];

  function mountCreate(overrides: Partial<Record<string, unknown>> = {}) {
    const onSubmit = vi.fn();
    wrap(
      <TransmittalCreateDialog
        open={true}
        onOpenChange={vi.fn()}
        subcontractors={SUBS}
        projects={PROJECTS}
        onSubmit={onSubmit}
        isPending={false}
        testIdPrefix="tn-"
        {...overrides}
      />
    );
    return { onSubmit };
  }

  it("notes field is present and accepts text input", () => {
    mountCreate({ fixedProjectId: "proj-1" });
    const notesInput = screen.getByTestId("tn-input-create-notes");
    fireEvent.change(notesInput, { target: { value: "Please review sections 1-3 only." } });
    expect((notesInput as HTMLInputElement).value).toBe("Please review sections 1-3 only.");
  });

  it("notes are included in the submission payload", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.change(screen.getByTestId("tn-input-create-subject"), {
      target: { value: "Foundation plans" },
    });
    fireEvent.change(screen.getByTestId("tn-input-create-notes"), {
      target: { value: "Urgent — needed for permit review." },
    });
    fireEvent.click(screen.getByTestId("tn-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Urgent — needed for permit review." })
    );
  });

  it("description is included in the submission payload", () => {
    const { onSubmit } = mountCreate({ fixedProjectId: "proj-1" });
    fireEvent.change(screen.getByTestId("tn-input-create-subject"), {
      target: { value: "Structural sheets" },
    });
    fireEvent.change(screen.getByTestId("tn-input-create-description"), {
      target: { value: "Sheets S1 through S12" },
    });
    fireEvent.click(screen.getByTestId("tn-button-submit-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Sheets S1 through S12" })
    );
  });

  it("create button shows loading state and is disabled while pending", () => {
    mountCreate({ fixedProjectId: "proj-1", isPending: true });
    const btn = screen.getByTestId("tn-button-submit-create");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.textContent).toMatch(/creating/i);
  });
});

/* ── TransmittalDetailDialog — ACKNOWLEDGED state + edge cases ────── */

describe("TransmittalDetailDialog — ACKNOWLEDGED state and edge cases", () => {
  afterEach(cleanup);

  it("ACKNOWLEDGED status shows Supersede button", () => {
    const tx = makeTransmittal({ status: "ACKNOWLEDGED" });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ac-"
      />
    );
    expect(screen.getByTestId("ac-button-supersede-transmittal")).toBeDefined();
    expect(screen.queryByTestId("ac-button-send-transmittal")).toBeNull();
    expect(screen.queryByTestId("ac-button-delete-transmittal")).toBeNull();
  });

  it("ACKNOWLEDGED status shows Add Recipients button", () => {
    const tx = makeTransmittal({ status: "ACKNOWLEDGED" });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ac-"
      />
    );
    expect(screen.getByTestId("ac-button-add-recipients")).toBeDefined();
  });

  it("SUPERSEDED status shows neither Send nor Supersede nor Add Recipients", () => {
    const tx = makeTransmittal({ status: "SUPERSEDED" });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="sp-"
      />
    );
    expect(screen.queryByTestId("sp-button-send-transmittal")).toBeNull();
    expect(screen.queryByTestId("sp-button-supersede-transmittal")).toBeNull();
    expect(screen.queryByTestId("sp-button-add-recipients")).toBeNull();
  });

  it("shows 'all subcontractors added' message when all subs are already recipients", () => {
    const tx = makeTransmittal({
      status: "SENT",
      recipients: [
        { id: "r-a", subcontractorId: "sub-a", subcontractorName: "Alpha Framing", acknowledged: false, acknowledgedAt: null },
        { id: "r-b", subcontractorId: "sub-b", subcontractorName: "Beta Concrete", acknowledged: false, acknowledgedAt: null },
      ],
    });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="ae-"
      />
    );
    fireEvent.click(screen.getByTestId("ae-button-add-recipients"));
    const list = screen.getByTestId("ae-list-add-recipients");
    expect(list.textContent).toContain("All subcontractors have been added");
  });

  it("notes field is displayed in the detail view when transmittal has notes", () => {
    const tx = makeTransmittal({ notes: "Includes revised fire egress plan." });
    wrap(
      <TransmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        transmittal={tx}
        subcontractors={SUBS}
        onSend={vi.fn()}
        onSupersede={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onAddRecipients={vi.fn()}
        testIdPrefix="nt-"
      />
    );
    expect(screen.getByTestId("nt-text-detail-notes").textContent).toContain(
      "Includes revised fire egress plan."
    );
  });
});

/* ── DocumentAttachments — transmittal attachment picker ─────────── */

vi.mock("@/components/ObjectUploader", () => ({
  ObjectUploader: ({ testId, children }: any) => (
    <button type="button" data-testid={testId}>{children ?? "Upload"}</button>
  ),
}));

vi.mock("@/lib/uploadLimits", () => ({
  MAX_BATCH_UPLOAD_FILES: 10,
  MAX_BATCH_UPLOAD_HELPER_TEXT: "Max 10 files",
  MAX_STORAGE_FILE_SIZE: 100 * 1024 * 1024,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children, ...rest }: any) => <h3 {...rest}>{children}</h3>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

describe("DocumentAttachments — transmittal attachment picker", () => {
  afterEach(cleanup);

  const TX_ID = "tx-attach-1";
  const FILES_QUERY_KEY = [`/api/transmittals/${TX_ID}/files`];

  function makeFileRecord(id: string, overrides: Partial<Record<string, any>> = {}) {
    return {
      id,
      fileUrl: `https://storage.example.com/${id}.pdf`,
      fileName: `document-${id}.pdf`,
      fileSize: 102400,
      mimeType: "application/pdf",
      uploadedById: "user-1",
      uploadedByName: "Alice Admin",
      uploadedAt: "2026-03-01T10:00:00Z",
      ...overrides,
    };
  }

  function mountPicker(opts: { canUpload: boolean; canDelete: boolean; files?: any[] }) {
    const qc = makeQC();
    qc.setQueryData(FILES_QUERY_KEY, opts.files ?? []);
    wrap(
      <DocumentAttachments
        entityType="transmittals"
        entityId={TX_ID}
        canUpload={opts.canUpload}
        canDelete={opts.canDelete}
      />,
      qc
    );
  }

  it("renders the upload button when canUpload is true", () => {
    mountPicker({ canUpload: true, canDelete: false });
    expect(screen.getByTestId("button-upload-transmittals-file")).toBeDefined();
  });

  it("does not render the upload button when canUpload is false", () => {
    mountPicker({ canUpload: false, canDelete: false });
    expect(screen.queryByTestId("button-upload-transmittals-file")).toBeNull();
  });

  it("shows 'No documents attached' when file list is empty", () => {
    mountPicker({ canUpload: false, canDelete: false, files: [] });
    expect(screen.getByText(/No documents attached/i)).toBeDefined();
  });

  it("renders a row for each attached file", () => {
    const files = [makeFileRecord("f-1"), makeFileRecord("f-2")];
    mountPicker({ canUpload: false, canDelete: false, files });
    expect(screen.getByTestId("file-attachment-f-1")).toBeDefined();
    expect(screen.getByTestId("file-attachment-f-2")).toBeDefined();
  });

  it("shows download button for each file", () => {
    const files = [makeFileRecord("f-1")];
    mountPicker({ canUpload: false, canDelete: false, files });
    expect(screen.getByTestId("button-download-file-f-1")).toBeDefined();
  });

  it("shows delete button for each file when canDelete is true", () => {
    const files = [makeFileRecord("f-1")];
    mountPicker({ canUpload: false, canDelete: true, files });
    expect(screen.getByTestId("button-delete-file-f-1")).toBeDefined();
  });

  it("hides delete button when canDelete is false and file was uploaded by another user", () => {
    const files = [makeFileRecord("f-1", { uploadedById: "other-user" })];
    mountPicker({ canUpload: false, canDelete: false, files });
    expect(screen.queryByTestId("button-delete-file-f-1")).toBeNull();
  });

  it("upload hint text shows file limit when canUpload is true", () => {
    mountPicker({ canUpload: true, canDelete: false });
    expect(screen.getByTestId("hint-batch-upload-limit").textContent).toContain("Max 10 files");
  });

  it("renders multiple files with correct file names", () => {
    const files = [
      makeFileRecord("f-a", { fileName: "foundation-plan.pdf" }),
      makeFileRecord("f-b", { fileName: "steel-schedule.pdf" }),
    ];
    mountPicker({ canUpload: true, canDelete: true, files });
    expect(screen.getByTestId("file-attachment-f-a").textContent).toContain("foundation-plan.pdf");
    expect(screen.getByTestId("file-attachment-f-b").textContent).toContain("steel-schedule.pdf");
  });
});

/* ── DocumentAttachments — RFI attachment picker (role-based gating) */

describe("DocumentAttachments — RFI attachment picker role-based gating", () => {
  afterEach(cleanup);

  const RFI_ID = "rfi-attach-1";
  const RFI_FILES_KEY = [`/api/rfi/${RFI_ID}/attachments`];

  function makeRfiFile(id: string) {
    return {
      id,
      fileUrl: `https://storage.example.com/${id}.pdf`,
      fileName: `rfi-doc-${id}.pdf`,
      fileSize: 51200,
      mimeType: "application/pdf",
      uploadedById: "user-1",
      uploadedByName: "Alice Admin",
      uploadedAt: "2026-03-01T10:00:00Z",
    };
  }

  function mountRfiPicker(opts: { canUpload: boolean; canDelete: boolean; files?: ReturnType<typeof makeRfiFile>[] }) {
    const qc = makeQC();
    qc.setQueryData(RFI_FILES_KEY, opts.files ?? []);
    wrap(
      <DocumentAttachments
        entityType="rfi"
        entityId={RFI_ID}
        canUpload={opts.canUpload}
        canDelete={opts.canDelete}
      />,
      qc
    );
  }

  it("ADMIN/MANAGER/SUPERINTENDENT: upload button visible when canUpload=true", () => {
    mountRfiPicker({ canUpload: true, canDelete: true });
    expect(screen.getByTestId("button-upload-rfi-file")).toBeDefined();
  });

  it("FIELD_WORKER: upload button hidden when canUpload=false", () => {
    mountRfiPicker({ canUpload: false, canDelete: false });
    expect(screen.queryByTestId("button-upload-rfi-file")).toBeNull();
  });

  it("ADMIN/MANAGER: delete button visible on attachments when canDelete=true", () => {
    mountRfiPicker({ canUpload: true, canDelete: true, files: [makeRfiFile("rf-1")] });
    expect(screen.getByTestId("button-delete-file-rf-1")).toBeDefined();
  });

  it("SUPERINTENDENT: upload allowed but delete not allowed (canDelete=false)", () => {
    mountRfiPicker({ canUpload: true, canDelete: false, files: [makeRfiFile("rf-2")] });
    expect(screen.getByTestId("button-upload-rfi-file")).toBeDefined();
    expect(screen.queryByTestId("button-delete-file-rf-2")).toBeNull();
  });

  it("shows 'No documents attached' empty state when file list is empty", () => {
    mountRfiPicker({ canUpload: false, canDelete: false, files: [] });
    expect(screen.getByText(/No documents attached/i)).toBeDefined();
  });

  it("download button visible for every attachment regardless of role", () => {
    mountRfiPicker({ canUpload: false, canDelete: false, files: [makeRfiFile("rf-3")] });
    expect(screen.getByTestId("button-download-file-rf-3")).toBeDefined();
  });

  it("renders a row per attached file", () => {
    const files = [makeRfiFile("rf-4"), makeRfiFile("rf-5")];
    mountRfiPicker({ canUpload: true, canDelete: true, files });
    expect(screen.getByTestId("file-attachment-rf-4")).toBeDefined();
    expect(screen.getByTestId("file-attachment-rf-5")).toBeDefined();
  });
});
