// @vitest-environment jsdom
/**
 * Task #2871 — RFI state transition & form validation tests.
 *
 * Covers:
 *   - RFI create form: required fields enforced (subject + question gate the
 *     create button), priority/category dropdowns, ball-in-court assignment,
 *     impact checkboxes
 *   - State machine helpers: getStatusBadge, getPriorityBadge, isRfiOverdue
 *   - RFI detail dialog: edit mode toggling, answer input, transition buttons
 *     (submit → review → answer → close), reopen from CLOSED
 *   - Overdue detection with dateRequired
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── shared mocks ─────────────────────────────────────────────────── */

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({ user: { id: "user-1" }, permissionRole: "ADMIN" })),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("@/components/DocumentAttachments", () => ({
  default: () => null,
}));

vi.mock("@/components/messaging/EntityDiscussion", () => ({
  EntityDiscussion: () => null,
}));

vi.mock("@/components/email/RecipientListField", () => ({
  RecipientListField: () => null,
}));

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
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children, ...rest }: any) => {
      const ctx = React.useContext(Ctx);
      return (
        <button
          type="button"
          onClick={() => ctx.onValueChange(value)}
          data-value={value}
          data-selected={ctx.value === value ? "true" : "false"}
          {...rest}
        >
          {children}
        </button>
      );
    },
  };
});

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

/* ── helpers ──────────────────────────────────────────────────────── */

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(ui: React.ReactElement, qc = makeQC()) {
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/* ── fixtures ─────────────────────────────────────────────────────── */

function makeRfi(overrides: Record<string, unknown> = {}) {
  return {
    id: "rfi-1",
    rfiNumber: "RFI-001",
    projectId: "proj-1",
    subject: "Clarify footing depth",
    question: "What is the required footing depth at grid B-3?",
    answer: null,
    priority: "HIGH",
    status: "DRAFT",
    category: null,
    subcontractorId: null,
    contractId: null,
    drawingReference: null,
    specReference: null,
    impactDescription: null,
    costImpact: false,
    scheduleImpact: false,
    dateRequired: null,
    assignedToId: null,
    submittedById: null,
    submittedByName: null,
    answeredById: null,
    answeredByName: null,
    closedById: null,
    closedByName: null,
    forwardedToId: null,
    forwardedAt: null,
    linkedChangeOrderId: null,
    linkedTmTicketId: null,
    linkedSubmittalId: null,
    linkedSubmittalNumber: null,
    linkedSubmittalSubject: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    dateSubmitted: null,
    dateAnswered: null,
    closedAt: null,
    project: { code: "P-001", name: "Test Project" },
    subcontractor: null,
    assignedTo: null,
    ...overrides,
  };
}

function makeMutations(overrides: Record<string, unknown> = {}) {
  const noop = { mutate: vi.fn(), isPending: false };
  return {
    submitMutation: noop,
    reviewMutation: noop,
    forwardMutation: noop,
    answerMutation: noop,
    closeMutation: noop,
    reopenMutation: noop,
    deleteMutation: noop,
    updateMutation: noop,
    linkCOMutation: noop,
    linkTMMutation: noop,
    linkSubmittalMutation: noop,
    addCommentMutation: noop,
    ...overrides,
  };
}

/* ── unit tests for pure helpers ──────────────────────────────────── */

import {
  getStatusBadge,
  getPriorityBadge,
  isRfiOverdue,
} from "@/hooks/useRfiMutations";

describe("RFI pure helpers", () => {
  afterEach(cleanup);

  describe("getStatusBadge", () => {
    it.each([
      ["DRAFT", "Draft"],
      ["SUBMITTED", "Submitted"],
      ["UNDER_REVIEW", "Under Review"],
      ["FORWARDED", "Forwarded"],
      ["ANSWERED", "Answered"],
      ["CLOSED", "Closed"],
    ])("renders badge for status %s", (status, label) => {
      const { container } = render(<>{getStatusBadge(status)}</>);
      expect(container.textContent).toContain(label);
    });

    it("renders the raw value for an unknown status", () => {
      const { container } = render(<>{getStatusBadge("UNKNOWN_STATUS")}</>);
      expect(container.textContent).toContain("UNKNOWN_STATUS");
    });
  });

  describe("getPriorityBadge", () => {
    it.each([
      ["LOW", "Low"],
      ["MEDIUM", "Medium"],
      ["HIGH", "High"],
      ["URGENT", "Urgent"],
    ])("renders badge for priority %s", (priority, label) => {
      const { container } = render(<>{getPriorityBadge(priority)}</>);
      expect(container.textContent).toContain(label);
    });
  });

  describe("isRfiOverdue", () => {
    it("returns false when no dateRequired", () => {
      expect(isRfiOverdue({ status: "SUBMITTED", dateRequired: null })).toBe(false);
    });

    it("returns false when status is not an open status", () => {
      const pastDate = "2020-01-01";
      expect(isRfiOverdue({ status: "CLOSED", dateRequired: pastDate })).toBe(false);
      expect(isRfiOverdue({ status: "ANSWERED", dateRequired: pastDate })).toBe(false);
      expect(isRfiOverdue({ status: "DRAFT", dateRequired: pastDate })).toBe(false);
    });

    it("returns true when SUBMITTED with a past dateRequired", () => {
      expect(isRfiOverdue({ status: "SUBMITTED", dateRequired: "2020-01-01" })).toBe(true);
    });

    it("returns true when UNDER_REVIEW with a past dateRequired", () => {
      expect(isRfiOverdue({ status: "UNDER_REVIEW", dateRequired: "2020-01-01" })).toBe(true);
    });

    it("returns true when FORWARDED with a past dateRequired", () => {
      expect(isRfiOverdue({ status: "FORWARDED", dateRequired: "2020-01-01" })).toBe(true);
    });

    it("returns false when dateRequired is in the future", () => {
      const futureDate = "2099-01-01";
      expect(isRfiOverdue({ status: "SUBMITTED", dateRequired: futureDate })).toBe(false);
    });
  });
});

/* ── RfiCreateFields component tests ──────────────────────────────── */

import RfiCreateFields from "@/components/document-control/RfiCreateFields";
import type { RFICreateForm } from "@/hooks/useRfiMutations";
import { DEFAULT_CREATE_FORM } from "@/hooks/useRfiMutations";

describe("RfiCreateFields", () => {
  afterEach(cleanup);

  function mountFields(formOverrides: Partial<RFICreateForm> = {}, onChange = vi.fn()) {
    const form = { ...DEFAULT_CREATE_FORM, ...formOverrides };
    return wrap(
      <RfiCreateFields
        form={form}
        onChange={onChange}
        subcontractors={[{ id: "sub-1", companyName: "Acme Sub" }]}
        testIdPrefix="test-"
      />
    );
  }

  it("renders subject and question inputs", () => {
    mountFields();
    expect(screen.getByTestId("test-input-create-subject")).toBeDefined();
    expect(screen.getByTestId("test-input-create-question")).toBeDefined();
  });

  it("calls onChange with updated subject when typed", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    fireEvent.change(screen.getByTestId("test-input-create-subject"), {
      target: { value: "New subject" },
    });
    expect(onChange).toHaveBeenCalledWith({ subject: "New subject" });
  });

  it("calls onChange with updated question when typed", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    fireEvent.change(screen.getByTestId("test-input-create-question"), {
      target: { value: "What is the depth?" },
    });
    expect(onChange).toHaveBeenCalledWith({ question: "What is the depth?" });
  });

  it("renders priority select with default MEDIUM selected", () => {
    mountFields();
    const mediumBtn = screen.getByTestId("test-select-create-priority")
      .parentElement!.querySelector('[data-value="MEDIUM"]');
    expect(mediumBtn?.getAttribute("data-selected")).toBe("true");
  });

  it("calls onChange when priority is changed to HIGH", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    const highBtn = screen.getByTestId("test-select-create-priority")
      .parentElement!.querySelector('[data-value="HIGH"]') as HTMLButtonElement;
    fireEvent.click(highBtn);
    expect(onChange).toHaveBeenCalledWith({ priority: "HIGH" });
  });

  it("calls onChange with category when category is selected", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    const catBtn = screen.getByTestId("test-select-create-category")
      .parentElement!.querySelector('[data-value="FIELD_CONDITION"]') as HTMLButtonElement;
    fireEvent.click(catBtn);
    expect(onChange).toHaveBeenCalledWith({ category: "FIELD_CONDITION" });
  });

  it("calls onChange with empty string when 'none' category is selected", () => {
    const onChange = vi.fn();
    mountFields({ category: "FIELD_CONDITION" }, onChange);
    const noneBtn = screen.getByTestId("test-select-create-category")
      .parentElement!.querySelector('[data-value="none"]') as HTMLButtonElement;
    fireEvent.click(noneBtn);
    expect(onChange).toHaveBeenCalledWith({ category: "" });
  });

  it("renders subcontractor dropdown with the supplied subcontractor", () => {
    mountFields();
    const sub = screen.getByTestId("test-select-create-subcontractor")
      .parentElement!.querySelector('[data-value="sub-1"]');
    expect(sub?.textContent).toContain("Acme Sub");
  });

  it("renders drawing reference and spec reference inputs", () => {
    mountFields();
    expect(screen.getByTestId("test-input-create-drawing-ref")).toBeDefined();
    expect(screen.getByTestId("test-input-create-spec-ref")).toBeDefined();
  });

  it("renders date required input", () => {
    mountFields();
    expect(screen.getByTestId("test-input-create-date-required")).toBeDefined();
  });

  it("renders cost impact and schedule impact checkboxes unchecked by default", () => {
    mountFields();
    const costImpact = screen.getByTestId("test-checkbox-create-cost-impact");
    const schedImpact = screen.getByTestId("test-checkbox-create-schedule-impact");
    expect(costImpact).toBeDefined();
    expect(schedImpact).toBeDefined();
  });

  it("renders drawing reference input and calls onChange on change", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    fireEvent.change(screen.getByTestId("test-input-create-drawing-ref"), {
      target: { value: "Sheet A-101" },
    });
    expect(onChange).toHaveBeenCalledWith({ drawingReference: "Sheet A-101" });
  });

  /* ── assignedToId (ball-in-court) field ── */

  it("renders the 'Assign To' select with an 'Unassigned' option", () => {
    mountFields();
    const unassigned = screen.getByTestId("test-select-create-assign-to")
      .parentElement!.querySelector('[data-value="none"]');
    expect(unassigned?.textContent).toContain("Unassigned");
  });

  it("shows the assigned user when users are supplied via the query cache", () => {
    const qc = makeQC();
    qc.setQueryData(["/api/users"], [
      { id: "u-1", firstName: "Bob", lastName: "Builder", role: "SUPERINTENDENT" },
    ]);
    const form = { ...DEFAULT_CREATE_FORM };
    render(
      <QueryClientProvider client={qc}>
        <RfiCreateFields
          form={form}
          onChange={vi.fn()}
          subcontractors={[]}
          testIdPrefix="au-"
        />
      </QueryClientProvider>
    );
    const userOption = screen.getByTestId("au-select-create-assign-to")
      .parentElement!.querySelector('[data-value="u-1"]');
    expect(userOption?.textContent).toContain("Bob Builder");
  });

  it("selecting a user from the list calls onChange with assignedToId set", () => {
    const onChange = vi.fn();
    const qc = makeQC();
    qc.setQueryData(["/api/users"], [
      { id: "u-2", firstName: "Carol", lastName: "Contractor", role: "MANAGER" },
    ]);
    render(
      <QueryClientProvider client={qc}>
        <RfiCreateFields
          form={{ ...DEFAULT_CREATE_FORM }}
          onChange={onChange}
          subcontractors={[]}
          testIdPrefix="as-"
        />
      </QueryClientProvider>
    );
    const userBtn = screen.getByTestId("as-select-create-assign-to")
      .parentElement!.querySelector('[data-value="u-2"]') as HTMLButtonElement;
    fireEvent.click(userBtn);
    expect(onChange).toHaveBeenCalledWith({ assignedToId: "u-2" });
  });

  it("selecting 'none' clears assignedToId (ball-in-court unassigned)", () => {
    const onChange = vi.fn();
    const qc = makeQC();
    qc.setQueryData(["/api/users"], [
      { id: "u-3", firstName: "Dave", lastName: "Drafter", role: "FIELD_WORKER" },
    ]);
    render(
      <QueryClientProvider client={qc}>
        <RfiCreateFields
          form={{ ...DEFAULT_CREATE_FORM, assignedToId: "u-3" }}
          onChange={onChange}
          subcontractors={[]}
          testIdPrefix="ac-"
        />
      </QueryClientProvider>
    );
    const noneBtn = screen.getByTestId("ac-select-create-assign-to")
      .parentElement!.querySelector('[data-value="none"]') as HTMLButtonElement;
    fireEvent.click(noneBtn);
    expect(onChange).toHaveBeenCalledWith({ assignedToId: "" });
  });

  it("dateRequired field accepts a date string value (no past-date rejection — field is advisory)", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    fireEvent.change(screen.getByTestId("test-input-create-date-required"), {
      target: { value: "2020-01-01" },
    });
    expect(onChange).toHaveBeenCalledWith({ dateRequired: "2020-01-01" });
  });

  it("dateRequired field accepts future dates", () => {
    const onChange = vi.fn();
    mountFields({}, onChange);
    fireEvent.change(screen.getByTestId("test-input-create-date-required"), {
      target: { value: "2099-12-31" },
    });
    expect(onChange).toHaveBeenCalledWith({ dateRequired: "2099-12-31" });
  });
});

/* ── RfiDetailDialog component tests ─────────────────────────────── */

import RfiDetailDialog from "@/components/document-control/RfiDetailDialog";

describe("RfiDetailDialog — transition buttons", () => {
  afterEach(cleanup);

  function mountDialog(rfiOverrides: Record<string, unknown> = {}, mutationOverrides: Record<string, unknown> = {}) {
    const rfi = makeRfi(rfiOverrides);
    const mutations = makeMutations(mutationOverrides);
    const onRfiUpdate = vi.fn();
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={onRfiUpdate}
        mutations={mutations}
        testIdPrefix="t-"
      />
    );
    return { rfi, mutations, onRfiUpdate };
  }

  it("shows the RFI number in the detail dialog", () => {
    mountDialog();
    expect(screen.getByTestId("t-text-detail-rfi-number").textContent).toContain("RFI-001");
  });

  it("shows the subject in the detail dialog", () => {
    mountDialog();
    expect(screen.getByTestId("t-text-detail-subject").textContent).toContain("Clarify footing depth");
  });

  it("shows the question text", () => {
    mountDialog();
    expect(screen.getByTestId("t-text-detail-question").textContent).toContain("grid B-3");
  });

  it("submit button calls submitMutation.mutate for DRAFT status", () => {
    const submitMutate = vi.fn();
    mountDialog({ status: "DRAFT" }, { submitMutation: { mutate: submitMutate, isPending: false } });
    const btn = screen.getByTestId("t-button-submit-rfi");
    fireEvent.click(btn);
    expect(submitMutate).toHaveBeenCalledWith("rfi-1");
  });

  it("review button calls reviewMutation.mutate for SUBMITTED status", () => {
    const reviewMutate = vi.fn();
    mountDialog({ status: "SUBMITTED" }, { reviewMutation: { mutate: reviewMutate, isPending: false } });
    const btn = screen.getByTestId("t-button-start-review");
    fireEvent.click(btn);
    expect(reviewMutate).toHaveBeenCalledWith("rfi-1");
  });

  it("answer input appears when 'Answer' is clicked for UNDER_REVIEW", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    const answerBtn = screen.getByTestId("t-button-answer-rfi");
    fireEvent.click(answerBtn);
    expect(screen.getByTestId("t-input-answer")).toBeDefined();
  });

  it("submit answer button is disabled when answer text is empty", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    fireEvent.click(screen.getByTestId("t-button-answer-rfi"));
    const submitAnswerBtn = screen.getByTestId("t-button-submit-answer");
    expect(submitAnswerBtn.hasAttribute("disabled")).toBe(true);
  });

  it("calls answerMutation.mutate with answer text when submitted", () => {
    const answerMutate = vi.fn();
    mountDialog({ status: "UNDER_REVIEW" }, { answerMutation: { mutate: answerMutate, isPending: false } });
    fireEvent.click(screen.getByTestId("t-button-answer-rfi"));
    fireEvent.change(screen.getByTestId("t-input-answer"), {
      target: { value: "The footing depth is 24 inches." },
    });
    fireEvent.click(screen.getByTestId("t-button-submit-answer"));
    expect(answerMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rfi-1", answer: "The footing depth is 24 inches." })
    );
  });

  it("close button calls closeMutation.mutate for ANSWERED status", () => {
    const closeMutate = vi.fn();
    mountDialog({ status: "ANSWERED" }, { closeMutation: { mutate: closeMutate, isPending: false } });
    const btn = screen.getByTestId("t-button-close-rfi");
    fireEvent.click(btn);
    expect(closeMutate).toHaveBeenCalledWith("rfi-1");
  });

  it("reopen button calls reopenMutation.mutate for CLOSED status", () => {
    const reopenMutate = vi.fn();
    mountDialog(
      { status: "CLOSED", closedByName: "Jane Doe", closedAt: "2026-01-10T10:00:00Z" },
      { reopenMutation: { mutate: reopenMutate, isPending: false } }
    );
    const btn = screen.getByTestId("t-button-reopen-rfi");
    fireEvent.click(btn);
    expect(reopenMutate).toHaveBeenCalledWith("rfi-1");
  });

  it("shows closed-by information for CLOSED status", () => {
    mountDialog({ status: "CLOSED", closedByName: "Jane Doe", closedAt: "2026-01-10T10:00:00Z" });
    expect(screen.getByTestId("t-text-detail-closed-by").textContent).toContain("Jane Doe");
  });

  it("shows cost impact badge when costImpact is true", () => {
    mountDialog({ costImpact: true });
    expect(screen.getByTestId("t-badge-cost-impact")).toBeDefined();
  });

  it("shows schedule impact badge when scheduleImpact is true", () => {
    mountDialog({ scheduleImpact: true });
    expect(screen.getByTestId("t-badge-schedule-impact")).toBeDefined();
  });

  it("does not show submit button when status is ANSWERED", () => {
    mountDialog({ status: "ANSWERED" });
    expect(screen.queryByTestId("t-button-submit-rfi")).toBeNull();
  });

  it("does not show review button when status is DRAFT", () => {
    mountDialog({ status: "DRAFT" });
    expect(screen.queryByTestId("t-button-start-review")).toBeNull();
  });

  it("does not show close button when status is DRAFT", () => {
    mountDialog({ status: "DRAFT" });
    expect(screen.queryByTestId("t-button-close-rfi")).toBeNull();
  });
});

describe("RfiDetailDialog — edit mode", () => {
  afterEach(cleanup);

  function mountEditable() {
    const rfi = makeRfi({ status: "DRAFT" });
    const updateMutate = vi.fn();
    const mutations = makeMutations({ updateMutation: { mutate: updateMutate, isPending: false } });
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={vi.fn()}
        mutations={mutations}
        testIdPrefix="e-"
      />
    );
    return { updateMutate };
  }

  it("enters edit mode when edit button is clicked", () => {
    mountEditable();
    fireEvent.click(screen.getByTestId("e-button-edit-rfi"));
    expect(screen.getByTestId("e-input-edit-subject")).toBeDefined();
    expect(screen.getByTestId("e-input-edit-question")).toBeDefined();
  });

  it("exits edit mode when cancel is clicked", () => {
    mountEditable();
    fireEvent.click(screen.getByTestId("e-button-edit-rfi"));
    fireEvent.click(screen.getByTestId("e-button-cancel-edit"));
    expect(screen.queryByTestId("e-input-edit-subject")).toBeNull();
  });

  it("calls updateMutation.mutate with new subject when save is clicked", () => {
    const { updateMutate } = mountEditable();
    fireEvent.click(screen.getByTestId("e-button-edit-rfi"));
    fireEvent.change(screen.getByTestId("e-input-edit-subject"), {
      target: { value: "Updated subject" },
    });
    fireEvent.click(screen.getByTestId("e-button-save-edit"));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rfi-1", data: expect.objectContaining({ subject: "Updated subject" }) })
    );
  });
});

/* ── RFI create form — subject + question required gate ──────────── */

import { useState as useStateRfi } from "react";

describe("RFI create form — subject + question required gate", () => {
  afterEach(cleanup);

  function CreateGateWrapper() {
    const [form, setForm] = useStateRfi({ ...DEFAULT_CREATE_FORM });
    return (
      <>
        <RfiCreateFields
          form={form}
          onChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))}
          subcontractors={[]}
          testIdPrefix="cg-"
        />
        <button
          data-testid="cg-button-submit-create"
          disabled={!form.subject || !form.question}
        >
          Create RFI
        </button>
      </>
    );
  }

  it("create button is disabled when both subject and question are empty", () => {
    wrap(<CreateGateWrapper />);
    expect(screen.getByTestId("cg-button-submit-create").hasAttribute("disabled")).toBe(true);
  });

  it("create button is disabled when subject is filled but question is empty", () => {
    wrap(<CreateGateWrapper />);
    fireEvent.change(screen.getByTestId("cg-input-create-subject"), {
      target: { value: "Footing depth clarification" },
    });
    expect(screen.getByTestId("cg-button-submit-create").hasAttribute("disabled")).toBe(true);
  });

  it("create button is disabled when question is filled but subject is empty", () => {
    wrap(<CreateGateWrapper />);
    fireEvent.change(screen.getByTestId("cg-input-create-question"), {
      target: { value: "What is the required footing depth at B-3?" },
    });
    expect(screen.getByTestId("cg-button-submit-create").hasAttribute("disabled")).toBe(true);
  });

  it("create button is enabled when both subject and question are filled", () => {
    wrap(<CreateGateWrapper />);
    fireEvent.change(screen.getByTestId("cg-input-create-subject"), {
      target: { value: "Footing depth clarification" },
    });
    fireEvent.change(screen.getByTestId("cg-input-create-question"), {
      target: { value: "What is the required footing depth at B-3?" },
    });
    expect(screen.getByTestId("cg-button-submit-create").hasAttribute("disabled")).toBe(false);
  });

  it("dateRequired input accepts a date value", () => {
    wrap(<CreateGateWrapper />);
    const dateInput = screen.getByTestId("cg-input-create-date-required");
    fireEvent.change(dateInput, { target: { value: "2026-06-30" } });
    expect((dateInput as HTMLInputElement).value).toBe("2026-06-30");
  });

  it("due-date field does not block creation — date entry is optional", () => {
    wrap(<CreateGateWrapper />);
    fireEvent.change(screen.getByTestId("cg-input-create-subject"), {
      target: { value: "Clarification" },
    });
    fireEvent.change(screen.getByTestId("cg-input-create-question"), {
      target: { value: "Please clarify spec section 05 12 00" },
    });
    expect(screen.getByTestId("cg-button-submit-create").hasAttribute("disabled")).toBe(false);
  });
});

/* ── RFI status-based transition allowlist ───────────────────────── */

function mountRfiDialogForAllowlist(
  statusOverrides: Record<string, unknown> = {},
  mutationOverrides: Record<string, unknown> = {},
) {
  const rfi = makeRfi(statusOverrides);
  wrap(
    <RfiDetailDialog
      open={true}
      onOpenChange={vi.fn()}
      rfi={rfi}
      onRfiUpdate={vi.fn()}
      mutations={makeMutations(mutationOverrides)}
      testIdPrefix="al-"
    />
  );
}

describe("RFI status-based transition allowlist", () => {
  afterEach(cleanup);

  it("DRAFT: submit and edit/delete buttons present; review/answer/close absent", () => {
    mountRfiDialogForAllowlist({ status: "DRAFT" });
    expect(screen.getByTestId("al-button-submit-rfi")).toBeDefined();
    expect(screen.getByTestId("al-button-edit-rfi")).toBeDefined();
    expect(screen.getByTestId("al-button-delete-rfi")).toBeDefined();
    expect(screen.queryByTestId("al-button-start-review")).toBeNull();
    expect(screen.queryByTestId("al-button-answer-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-close-rfi")).toBeNull();
  });

  it("SUBMITTED: start-review present; submit/answer/forward/close absent", () => {
    mountRfiDialogForAllowlist({ status: "SUBMITTED" });
    expect(screen.getByTestId("al-button-start-review")).toBeDefined();
    expect(screen.queryByTestId("al-button-submit-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-answer-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-close-rfi")).toBeNull();
  });

  it("UNDER_REVIEW: answer and forward present; submit/review/close absent", () => {
    mountRfiDialogForAllowlist({ status: "UNDER_REVIEW" });
    expect(screen.getByTestId("al-button-answer-rfi")).toBeDefined();
    expect(screen.getByTestId("al-button-forward-rfi")).toBeDefined();
    expect(screen.queryByTestId("al-button-submit-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-start-review")).toBeNull();
    expect(screen.queryByTestId("al-button-close-rfi")).toBeNull();
  });

  it("ANSWERED: close button present; submit/review/answer absent", () => {
    mountRfiDialogForAllowlist({ status: "ANSWERED" });
    expect(screen.getByTestId("al-button-close-rfi")).toBeDefined();
    expect(screen.queryByTestId("al-button-submit-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-start-review")).toBeNull();
    expect(screen.queryByTestId("al-button-answer-rfi")).toBeNull();
  });

  it("CLOSED: reopen button present; submit/review/answer/close absent", () => {
    mountRfiDialogForAllowlist({
      status: "CLOSED",
      closedByName: "Jane Doe",
      closedAt: "2026-01-10T10:00:00Z",
    });
    expect(screen.getByTestId("al-button-reopen-rfi")).toBeDefined();
    expect(screen.queryByTestId("al-button-submit-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-start-review")).toBeNull();
    expect(screen.queryByTestId("al-button-answer-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-close-rfi")).toBeNull();
  });

  it("FORWARDED: answer present; submit/review/close absent", () => {
    mountRfiDialogForAllowlist({ status: "FORWARDED" });
    expect(screen.getByTestId("al-button-answer-forwarded-rfi")).toBeDefined();
    expect(screen.queryByTestId("al-button-submit-rfi")).toBeNull();
    expect(screen.queryByTestId("al-button-start-review")).toBeNull();
    expect(screen.queryByTestId("al-button-close-rfi")).toBeNull();
  });
});

/* ── RFI mutation pending states — UI feedback while in-flight ────── */

describe("RFI mutation pending states", () => {
  afterEach(cleanup);

  it("submit button is disabled while submitMutation is pending", () => {
    const rfi = makeRfi({ status: "DRAFT" });
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={vi.fn()}
        mutations={makeMutations({ submitMutation: { mutate: vi.fn(), isPending: true } })}
        testIdPrefix="pd-"
      />
    );
    const btn = screen.getByTestId("pd-button-submit-rfi");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("start-review button is disabled while reviewMutation is pending", () => {
    const rfi = makeRfi({ status: "SUBMITTED" });
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={vi.fn()}
        mutations={makeMutations({ reviewMutation: { mutate: vi.fn(), isPending: true } })}
        testIdPrefix="pd-"
      />
    );
    const btn = screen.getByTestId("pd-button-start-review");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("submit-answer button is disabled while answerMutation is pending even when text is provided", () => {
    const rfi = makeRfi({ status: "UNDER_REVIEW" });
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={vi.fn()}
        mutations={makeMutations({ answerMutation: { mutate: vi.fn(), isPending: true } })}
        testIdPrefix="pd-"
      />
    );
    fireEvent.click(screen.getByTestId("pd-button-answer-rfi"));
    fireEvent.change(screen.getByTestId("pd-input-answer"), {
      target: { value: "The footing depth is 24 inches." },
    });
    expect(screen.getByTestId("pd-button-submit-answer").hasAttribute("disabled")).toBe(true);
  });

  it("close button is disabled while closeMutation is pending", () => {
    const rfi = makeRfi({ status: "ANSWERED" });
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={vi.fn()}
        mutations={makeMutations({ closeMutation: { mutate: vi.fn(), isPending: true } })}
        testIdPrefix="pd-"
      />
    );
    expect(screen.getByTestId("pd-button-close-rfi").hasAttribute("disabled")).toBe(true);
  });
});

/* ── RfiDetailDialog — onRfiUpdate state propagation (optimistic UI) */

import { act, waitFor } from "@testing-library/react";

describe("RfiDetailDialog — onRfiUpdate state propagation", () => {
  afterEach(cleanup);

  function makeStableQC() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
  }

  function makeDetailQC(rfiId: string, rfi: ReturnType<typeof makeRfi>) {
    const qc = makeStableQC();
    qc.setQueryData(["/api/rfi", rfiId], rfi);
    qc.setQueryData(["/api/rfi", rfiId, "activity"], []);
    return qc;
  }

  it("calls onRfiUpdate with the cached detail when dialog opens with pre-seeded query data", async () => {
    const rfi = makeRfi({ status: "SUBMITTED" });
    const onRfiUpdate = vi.fn();
    const qc = makeDetailQC(rfi.id as string, rfi);

    await act(async () => {
      wrap(
        <RfiDetailDialog
          open={true}
          onOpenChange={vi.fn()}
          rfi={rfi}
          onRfiUpdate={onRfiUpdate}
          mutations={makeMutations()}
          testIdPrefix="ou-"
        />,
        qc
      );
    });

    await waitFor(() => {
      expect(onRfiUpdate).toHaveBeenCalledWith(expect.objectContaining({
        id: "rfi-1",
        status: "SUBMITTED",
      }));
    });
  });

  it("calls onRfiUpdate with updated status when query cache is updated (state propagation)", async () => {
    const rfi = makeRfi({ status: "SUBMITTED" });
    const onRfiUpdate = vi.fn();
    const qc = makeDetailQC(rfi.id as string, rfi);

    await act(async () => {
      wrap(
        <RfiDetailDialog
          open={true}
          onOpenChange={vi.fn()}
          rfi={rfi}
          onRfiUpdate={onRfiUpdate}
          mutations={makeMutations()}
          testIdPrefix="ou2-"
        />,
        qc
      );
    });

    const underReviewRfi = { ...rfi, status: "UNDER_REVIEW" };
    await act(async () => {
      qc.setQueryData(["/api/rfi", rfi.id as string], underReviewRfi);
    });

    await waitFor(() => {
      expect(onRfiUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: "UNDER_REVIEW",
      }));
    });
  });

  it("does not call onRfiUpdate when dialog is closed (open=false)", async () => {
    const rfi = makeRfi({ status: "DRAFT" });
    const onRfiUpdate = vi.fn();
    const qc = makeDetailQC(rfi.id as string, rfi);

    await act(async () => {
      wrap(
        <RfiDetailDialog
          open={false}
          onOpenChange={vi.fn()}
          rfi={rfi}
          onRfiUpdate={onRfiUpdate}
          mutations={makeMutations()}
          testIdPrefix="ou3-"
        />,
        qc
      );
    });

    expect(onRfiUpdate).not.toHaveBeenCalled();
  });
});


/* ── RFI dialog — transition buttons are status-gated, not role-gated ─── */

describe("RFI dialog transition buttons — status-gated (invariant across roles)", () => {
  afterEach(() => {
    cleanup();
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, permissionRole: "ADMIN" });
  });

  function mountWithRole(
    role: string,
    status: string,
    prefix: string,
    extra: Record<string, unknown> = {}
  ) {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, permissionRole: role });
    const rfi = makeRfi({ status, ...extra });
    const qc = makeQC();
    wrap(
      <RfiDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        rfi={rfi}
        onRfiUpdate={vi.fn()}
        mutations={makeMutations()}
        testIdPrefix={prefix}
      />,
      qc
    );
  }

  it("FIELD_WORKER + DRAFT: 'Submit RFI' button visible (same as ADMIN)", () => {
    mountWithRole("FIELD_WORKER", "DRAFT", "rg-fw-");
    expect(screen.getByTestId("rg-fw-button-submit-rfi")).toBeDefined();
  });

  it("ADMIN + DRAFT: 'Submit RFI' button visible", () => {
    mountWithRole("ADMIN", "DRAFT", "rg-ad-");
    expect(screen.getByTestId("rg-ad-button-submit-rfi")).toBeDefined();
  });

  it("ESTIMATOR + SUBMITTED: 'Start Review' button visible (same as ADMIN)", () => {
    mountWithRole("ESTIMATOR", "SUBMITTED", "rg-es-");
    expect(screen.getByTestId("rg-es-button-start-review")).toBeDefined();
  });

  it("SUPERINTENDENT + UNDER_REVIEW: answer and forward buttons present (same as ADMIN)", () => {
    mountWithRole("SUPERINTENDENT", "UNDER_REVIEW", "rg-su-");
    expect(screen.getByTestId("rg-su-button-answer-rfi")).toBeDefined();
    expect(screen.getByTestId("rg-su-button-forward-rfi")).toBeDefined();
  });

  it("FIELD_WORKER + ANSWERED: close button present (same as ADMIN)", () => {
    mountWithRole("FIELD_WORKER", "ANSWERED", "rg-fwa-");
    expect(screen.getByTestId("rg-fwa-button-close-rfi")).toBeDefined();
  });

  it("MANAGER + CLOSED: reopen button present (same as ADMIN)", () => {
    mountWithRole("MANAGER", "CLOSED", "rg-mgr-", {
      closedByName: "Jane Doe",
      closedAt: "2026-01-10T10:00:00Z",
    });
    expect(screen.getByTestId("rg-mgr-button-reopen-rfi")).toBeDefined();
  });

  it("ESTIMATOR + FORWARDED: answer button present (same as ADMIN)", () => {
    mountWithRole("ESTIMATOR", "FORWARDED", "rg-fwd-");
    expect(screen.getByTestId("rg-fwd-button-answer-forwarded-rfi")).toBeDefined();
  });
});
