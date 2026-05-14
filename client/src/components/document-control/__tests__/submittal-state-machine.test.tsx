// @vitest-environment jsdom
/**
 * Task #2871 — Submittal state transition & form validation tests.
 *
 * Covers:
 *   - getStatusBadge helper for each Submittal status
 *   - SubmittalDetailDialog: status badge display per state, submit button
 *     triggers submitMutation, start-review triggers startReviewMutation,
 *     approve / rejected / revise-and-resubmit branching via the review dialog,
 *     resubmit button for REJECTED state, reviewer assignment panel (ADMIN+DRAFT)
 *   - SubmittalItemsTab: add-item description gate
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", firstName: "Alice", lastName: "Admin" },
    permissionRole: "ADMIN",
  }),
}));

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

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ value: string; setValue: (v: string) => void }>({
    value: "details",
    setValue: () => {},
  });
  return {
    Tabs: ({ defaultValue, children }: any) => {
      const [val, setVal] = React.useState(defaultValue ?? "details");
      return <Ctx.Provider value={{ value: val, setValue: setVal }}>{children}</Ctx.Provider>;
    },
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ value, children, ...rest }: any) => {
      const ctx = React.useContext(Ctx);
      return (
        <button
          type="button"
          data-selected={ctx.value === value ? "true" : "false"}
          onClick={() => ctx.setValue(value)}
          {...rest}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: any) => {
      const ctx = React.useContext(Ctx);
      return ctx.value === value ? <div>{children}</div> : null;
    },
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

function makeSubmittal(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    projectId: "proj-1",
    submittalNumber: "SUB-001",
    subject: "Structural Steel Shop Drawings",
    description: "Fabrication drawings for columns and beams",
    submittalType: "CONTRACTOR",
    phase: "CONSTRUCTION",
    specSection: "05 12 00",
    category: null,
    submittalCategory: "SHOP_DRAWING",
    status: "DRAFT",
    revision: 1,
    previousRevisionId: null,
    subcontractorId: null,
    contractId: null,
    dateRequired: null,
    dateSubmitted: null,
    submittedById: null,
    submittedByName: null,
    reviewerId: null,
    reviewerName: null,
    reviewDate: null,
    reviewComments: null,
    stampAction: null,
    linkedRfiId: null,
    attachmentsJson: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    project: { code: "P-001", name: "Test Project" },
    subcontractor: null,
    activity: [],
    ...overrides,
  };
}

function makeMutations(overrides: Record<string, unknown> = {}) {
  const noop = { mutate: vi.fn(), isPending: false };
  return {
    submitMutation: { ...noop },
    startReviewMutation: { ...noop },
    reviewMutation: { ...noop },
    resubmitMutation: { ...noop },
    linkRfiMutation: { ...noop },
    addCommentMutation: { ...noop },
    deleteMutation: { ...noop },
    updateMutation: { ...noop },
    addItemMutation: { ...noop },
    updateItemMutation: { ...noop },
    deleteItemMutation: { ...noop },
    addAttachmentMutation: { ...noop },
    deleteAttachmentMutation: { ...noop },
    addReviewerMutation: { mutate: vi.fn(), isPending: false },
    removeReviewerMutation: { mutate: vi.fn(), isPending: false },
    startChainMutation: { mutate: vi.fn(), isPending: false },
    stampMutation: { mutate: vi.fn(), isPending: false },
    ...overrides,
  };
}

/* ── getStatusBadge helper tests ──────────────────────────────────── */

import { getStatusBadge } from "@/components/document-control/SubmittalDetailDialog";

describe("Submittal getStatusBadge", () => {
  afterEach(cleanup);

  it.each([
    ["DRAFT", "Draft"],
    ["SUBMITTED", "Submitted"],
    ["UNDER_REVIEW", "Under Review"],
    ["APPROVED", "Approved"],
    ["APPROVED_AS_NOTED", "Approved As Noted"],
    ["REJECTED", "Rejected"],
    ["REVISE_AND_RESUBMIT", "Revise & Resubmit"],
  ])("renders correct label for status %s", (status, label) => {
    const { container } = render(<>{getStatusBadge(status)}</>);
    expect(container.textContent).toContain(label);
  });

  it("renders raw value for unknown status", () => {
    const { container } = render(<>{getStatusBadge("UNKNOWN")}</>);
    expect(container.textContent).toContain("UNKNOWN");
  });
});

/* ── SubmittalDetailDialog — status badge display ─────────────────── */

import { SubmittalDetailDialog } from "@/components/document-control/SubmittalDetailDialog";

describe("SubmittalDetailDialog — status badge display", () => {
  afterEach(cleanup);

  function mountDialog(submittalOverrides: Record<string, unknown> = {}) {
    const submittal = makeSubmittal(submittalOverrides);
    const mutations = makeMutations();
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={mutations}
        testIdPrefix="s-"
      />
    );
  }

  it("shows the submittal number in the title", () => {
    mountDialog();
    expect(screen.getByTestId("s-text-detail-title").textContent).toContain("SUB-001");
  });

  it("shows DRAFT status badge", () => {
    mountDialog({ status: "DRAFT" });
    expect(screen.getByTestId("s-badge-status-draft")).toBeDefined();
  });

  it("shows SUBMITTED status badge", () => {
    mountDialog({ status: "SUBMITTED" });
    expect(screen.getByTestId("s-badge-status-submitted")).toBeDefined();
  });

  it("shows UNDER_REVIEW status badge", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    expect(screen.getByTestId("s-badge-status-under-review")).toBeDefined();
  });

  it("shows APPROVED status badge", () => {
    mountDialog({ status: "APPROVED" });
    expect(screen.getByTestId("s-badge-status-approved")).toBeDefined();
  });

  it("shows REJECTED status badge", () => {
    mountDialog({ status: "REJECTED" });
    expect(screen.getByTestId("s-badge-status-rejected")).toBeDefined();
  });

  it("shows REVISE_AND_RESUBMIT status badge", () => {
    mountDialog({ status: "REVISE_AND_RESUBMIT" });
    expect(screen.getByTestId("s-badge-status-revise")).toBeDefined();
  });

  it("shows APPROVED_AS_NOTED status badge", () => {
    mountDialog({ status: "APPROVED_AS_NOTED" });
    expect(screen.getByTestId("s-badge-status-approved-as-noted")).toBeDefined();
  });

  it("shows spec section on detail view", () => {
    mountDialog({ specSection: "05 12 00" });
    expect(screen.getByTestId("s-text-detail-spec-section").textContent).toContain("05 12 00");
  });
});

/* ── SubmittalDetailDialog — state transition buttons ─────────────── */

describe("SubmittalDetailDialog — transition buttons", () => {
  afterEach(cleanup);

  function mountDialog(
    submittalOverrides: Record<string, unknown> = {},
    mutationOverrides: Record<string, unknown> = {},
    attachments: unknown[] = []
  ) {
    const submittal = makeSubmittal(submittalOverrides);
    const mutations = makeMutations(mutationOverrides);
    const qc = makeQC();
    qc.setQueryData(["/api/submittals", submittal.id, "attachments"], attachments);
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={mutations}
        testIdPrefix="s-"
      />,
      qc
    );
    return { submittal, mutations };
  }

  const STUB_ATTACHMENT = {
    id: "att-stub",
    fileUrl: "https://storage.example.com/att-stub.pdf",
    fileName: "shop-drawing.pdf",
    fileSize: 51200,
    mimeType: "application/pdf",
    uploadedById: "user-1",
    uploadedByName: "Alice Admin",
    uploadedAt: "2026-04-01T09:00:00Z",
  };

  it("Submit button is visible for DRAFT and calls submitMutation when attachment present", () => {
    const submitMutate = vi.fn();
    mountDialog({ status: "DRAFT" }, { submitMutation: { mutate: submitMutate, isPending: false } }, [STUB_ATTACHMENT]);
    const btn = screen.getByTestId("s-button-action-submit");
    fireEvent.click(btn);
    expect(submitMutate).toHaveBeenCalledWith("sub-1");
  });

  it("Submit button is not shown for SUBMITTED status", () => {
    mountDialog({ status: "SUBMITTED" });
    expect(screen.queryByTestId("s-button-action-submit")).toBeNull();
  });

  it("Start Review button calls startReviewMutation for SUBMITTED status (no review chain)", () => {
    const startReviewMutate = vi.fn();
    mountDialog(
      { status: "SUBMITTED" },
      { startReviewMutation: { mutate: startReviewMutate, isPending: false } }
    );
    const btn = screen.getByTestId("s-button-action-start-review");
    fireEvent.click(btn);
    expect(startReviewMutate).toHaveBeenCalledWith("sub-1");
  });

  it("Approve button is shown for UNDER_REVIEW (no review chain)", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    expect(screen.getByTestId("s-button-action-approve")).toBeDefined();
  });

  it("Reject button is shown for UNDER_REVIEW (no review chain)", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    expect(screen.getByTestId("s-button-action-reject")).toBeDefined();
  });

  it("Approve As Noted button is shown for UNDER_REVIEW", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    expect(screen.getByTestId("s-button-action-approve-as-noted")).toBeDefined();
  });

  it("Revise & Resubmit button is shown for UNDER_REVIEW", () => {
    mountDialog({ status: "UNDER_REVIEW" });
    expect(screen.getByTestId("s-button-action-revise")).toBeDefined();
  });

  it("Resubmit button is shown for REJECTED status and calls resubmitMutation", () => {
    const resubmitMutate = vi.fn();
    mountDialog(
      { status: "REJECTED" },
      { resubmitMutation: { mutate: resubmitMutate, isPending: false } }
    );
    const btn = screen.getByTestId("s-button-action-resubmit");
    fireEvent.click(btn);
    expect(resubmitMutate).toHaveBeenCalledWith("sub-1");
  });

  it("Resubmit button is shown for REVISE_AND_RESUBMIT status", () => {
    mountDialog({ status: "REVISE_AND_RESUBMIT" });
    expect(screen.getByTestId("s-button-action-resubmit")).toBeDefined();
  });

  it("Delete button is shown for DRAFT and calls deleteMutation", () => {
    const deleteMutate = vi.fn();
    mountDialog({ status: "DRAFT" }, { deleteMutation: { mutate: deleteMutate, isPending: false } });
    const btn = screen.getByTestId("s-button-action-delete");
    fireEvent.click(btn);
    expect(deleteMutate).toHaveBeenCalledWith("sub-1");
  });
});

/* ── SubmittalDetailDialog — review dialog (approve / reject) ─────── */

describe("SubmittalDetailDialog — review dialog branching", () => {
  afterEach(cleanup);

  function mountUnderReview(mutationOverrides: Record<string, unknown> = {}) {
    const submittal = makeSubmittal({ status: "UNDER_REVIEW" });
    const mutations = makeMutations(mutationOverrides);
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={mutations}
        testIdPrefix="r-"
      />
    );
    return { mutations };
  }

  it("clicking Approve opens the review dialog", () => {
    mountUnderReview();
    fireEvent.click(screen.getByTestId("r-button-action-approve"));
    expect(screen.getByTestId("r-button-confirm-review")).toBeDefined();
  });

  it("clicking Reject opens the review dialog", () => {
    mountUnderReview();
    fireEvent.click(screen.getByTestId("r-button-action-reject"));
    expect(screen.getByTestId("r-button-confirm-review")).toBeDefined();
  });

  it("Approve confirm is enabled without comments (approve does not require comments)", () => {
    mountUnderReview();
    fireEvent.click(screen.getByTestId("r-button-action-approve"));
    const confirmBtn = screen.getByTestId("r-button-confirm-review");
    expect(confirmBtn.hasAttribute("disabled")).toBe(false);
  });

  it("Reject confirm is disabled without comments (reject requires comments)", () => {
    mountUnderReview();
    fireEvent.click(screen.getByTestId("r-button-action-reject"));
    const confirmBtn = screen.getByTestId("r-button-confirm-review");
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
  });

  it("calls reviewMutation with 'approve' when confirmed", () => {
    const reviewMutate = vi.fn();
    mountUnderReview({ reviewMutation: { mutate: reviewMutate, isPending: false } });
    fireEvent.click(screen.getByTestId("r-button-action-approve"));
    fireEvent.click(screen.getByTestId("r-button-confirm-review"));
    expect(reviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub-1", action: "approve" })
    );
  });

  it("calls reviewMutation with 'reject' action and comment when provided", () => {
    const reviewMutate = vi.fn();
    mountUnderReview({ reviewMutation: { mutate: reviewMutate, isPending: false } });
    fireEvent.click(screen.getByTestId("r-button-action-reject"));
    fireEvent.change(screen.getByTestId("r-input-review-comments"), {
      target: { value: "Does not meet spec requirements." },
    });
    fireEvent.click(screen.getByTestId("r-button-confirm-review"));
    expect(reviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub-1",
        action: "reject",
        comments: "Does not meet spec requirements.",
      })
    );
  });

  it("Revise & Resubmit confirm is disabled without comments", () => {
    mountUnderReview();
    fireEvent.click(screen.getByTestId("r-button-action-revise"));
    const confirmBtn = screen.getByTestId("r-button-confirm-review");
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
  });
});

/* ── SubmittalDetailDialog — reviewer assignment ─────────────────── */

describe("SubmittalDetailDialog — reviewer assignment (ADMIN + DRAFT)", () => {
  afterEach(cleanup);

  it("shows the Add Reviewer toggle button for ADMIN on DRAFT", () => {
    const submittal = makeSubmittal({ status: "DRAFT" });
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={makeMutations()}
        testIdPrefix="rv-"
      />
    );
    expect(screen.getByTestId("rv-button-add-reviewer-toggle")).toBeDefined();
  });

  it("does not show Add Reviewer toggle when status is UNDER_REVIEW", () => {
    const submittal = makeSubmittal({ status: "UNDER_REVIEW" });
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={makeMutations()}
        testIdPrefix="rv-"
      />
    );
    expect(screen.queryByTestId("rv-button-add-reviewer-toggle")).toBeNull();
  });

  it("shows add reviewer form when toggle is clicked", () => {
    const submittal = makeSubmittal({ status: "DRAFT" });
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={makeMutations()}
        testIdPrefix="rv-"
      />
    );
    fireEvent.click(screen.getByTestId("rv-button-add-reviewer-toggle"));
    expect(screen.getByTestId("rv-add-reviewer-form")).toBeDefined();
  });

  it("Confirm Add Reviewer button is disabled when reviewer name is empty", () => {
    const submittal = makeSubmittal({ status: "DRAFT" });
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={makeMutations()}
        testIdPrefix="rv-"
      />
    );
    fireEvent.click(screen.getByTestId("rv-button-add-reviewer-toggle"));
    expect(screen.getByTestId("rv-button-confirm-add-reviewer").hasAttribute("disabled")).toBe(true);
  });

  it("Confirm Add Reviewer button is enabled after filling role and name", () => {
    const submittal = makeSubmittal({ status: "DRAFT" });
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={makeMutations()}
        testIdPrefix="rv-"
      />
    );
    fireEvent.click(screen.getByTestId("rv-button-add-reviewer-toggle"));
    const roleBtn = screen.getByTestId("rv-select-reviewer-role")
      .parentElement!.querySelector('[data-value="ARCHITECT"]') as HTMLButtonElement;
    fireEvent.click(roleBtn);
    fireEvent.change(screen.getByTestId("rv-input-reviewer-name"), {
      target: { value: "John Architect" },
    });
    expect(screen.getByTestId("rv-button-confirm-add-reviewer").hasAttribute("disabled")).toBe(false);
  });
});

/* ── SubmittalItemsTab — add item requires description ───────────── */

describe("SubmittalItemsTab — add item description gate", () => {
  afterEach(cleanup);

  function makeSeededQC(submittalId: string) {
    const qc = makeQC();
    qc.setQueryData(["/api/submittals", submittalId, "items"], []);
    return qc;
  }

  function mountItemsTab() {
    const submittal = makeSubmittal({ status: "DRAFT" });
    const qc = makeSeededQC(submittal.id);
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole="ADMIN"
        mutations={makeMutations()}
        testIdPrefix="si-"
      />,
      qc
    );
    fireEvent.click(screen.getByTestId("si-tab-items"));
  }

  it("Add Item button is present on the Items tab", () => {
    mountItemsTab();
    expect(screen.getByTestId("button-add-item")).toBeDefined();
  });

  it("Confirm add item button is disabled when description is empty", () => {
    mountItemsTab();
    fireEvent.click(screen.getByTestId("button-add-item"));
    expect(screen.getByTestId("button-confirm-add-item").hasAttribute("disabled")).toBe(true);
  });

  it("Confirm add item button is enabled when description is provided", () => {
    mountItemsTab();
    fireEvent.click(screen.getByTestId("button-add-item"));
    fireEvent.change(screen.getByTestId("input-item-description"), {
      target: { value: "Structural steel column caps" },
    });
    expect(screen.getByTestId("button-confirm-add-item").hasAttribute("disabled")).toBe(false);
  });

  it("spec section field is available in the add item form", () => {
    mountItemsTab();
    fireEvent.click(screen.getByTestId("button-add-item"));
    const specInput = screen.getByTestId("input-item-spec-section");
    expect(specInput).toBeDefined();
    fireEvent.change(specInput, { target: { value: "05 12 00" } });
    expect((specInput as HTMLInputElement).value).toBe("05 12 00");
  });
});

/* ── SubmittalDetailDialog — Attachments tab (role-based upload gate) */

describe("SubmittalDetailDialog — Attachments tab role-based upload gate", () => {
  afterEach(cleanup);

  function makeSeededAttachQC(submittalId: string, attachments: any[] = []) {
    const qc = makeQC();
    qc.setQueryData(["/api/submittals", submittalId, "items"], []);
    qc.setQueryData(["/api/submittals", submittalId, "attachments"], attachments);
    return qc;
  }

  function mountAttachmentsTab(userRole: string, attachments: any[] = []) {
    const submittal = makeSubmittal({ status: "DRAFT" });
    const qc = makeSeededAttachQC(submittal.id, attachments);
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={submittal}
        userRole={userRole}
        mutations={makeMutations()}
        testIdPrefix="at-"
      />,
      qc
    );
    fireEvent.click(screen.getByTestId("at-tab-attachments"));
  }

  it("Attachments tab renders the attachment container", () => {
    mountAttachmentsTab("ADMIN");
    expect(screen.getByTestId("submittal-attachments-tab")).toBeDefined();
  });

  it("ADMIN sees the upload button on the Attachments tab", () => {
    mountAttachmentsTab("ADMIN");
    expect(screen.getByTestId("button-upload-submittal-attachment")).toBeDefined();
  });

  it("MANAGER sees the upload button on the Attachments tab", () => {
    mountAttachmentsTab("MANAGER");
    expect(screen.getByTestId("button-upload-submittal-attachment")).toBeDefined();
  });

  it("SUPERINTENDENT sees the upload button on the Attachments tab", () => {
    mountAttachmentsTab("SUPERINTENDENT");
    expect(screen.getByTestId("button-upload-submittal-attachment")).toBeDefined();
  });

  it("FIELD_WORKER cannot see the upload button on the Attachments tab", () => {
    mountAttachmentsTab("FIELD_WORKER");
    expect(screen.queryByTestId("button-upload-submittal-attachment")).toBeNull();
  });

  it("ESTIMATOR cannot see the upload button on the Attachments tab", () => {
    mountAttachmentsTab("ESTIMATOR");
    expect(screen.queryByTestId("button-upload-submittal-attachment")).toBeNull();
  });

  it("shows 'No attachments yet' when no attachments exist", () => {
    mountAttachmentsTab("ADMIN");
    expect(screen.getByTestId("text-no-attachments").textContent).toContain("No attachments");
  });

  it("renders attachment rows when attachments are present", () => {
    const attachments = [
      {
        id: "att-1",
        fileUrl: "https://example.com/file.pdf",
        fileName: "shop-drawing.pdf",
        fileSize: 204800,
        mimeType: "application/pdf",
        uploadedById: "user-1",
        uploadedByName: "Alice Admin",
        createdAt: "2026-03-01T10:00:00Z",
        submittalItemId: null,
      },
    ];
    mountAttachmentsTab("ADMIN", attachments);
    expect(screen.getByTestId("attachment-item-att-1")).toBeDefined();
  });

  it("ADMIN sees the 'select attach-to item' dropdown when uploading", () => {
    mountAttachmentsTab("ADMIN");
    expect(screen.getByTestId("select-attach-to-item")).toBeDefined();
  });

  it("non-uploader role does not see the 'select attach-to item' dropdown", () => {
    mountAttachmentsTab("FIELD_WORKER");
    expect(screen.queryByTestId("select-attach-to-item")).toBeNull();
  });
});

/* ── Submittal detail dialog — state machine transition buttons per status ─ */

describe("Submittal detail dialog — state machine transition buttons per status", () => {
  afterEach(cleanup);

  function makeAttachment(id: string) {
    return {
      id,
      fileUrl: `https://storage.example.com/${id}.pdf`,
      fileName: `drawing-${id}.pdf`,
      fileSize: 102400,
      mimeType: "application/pdf",
      uploadedById: "user-1",
      uploadedByName: "Alice Admin",
      uploadedAt: "2026-04-01T09:00:00Z",
    };
  }

  function mountStatus(
    status: string,
    opts: {
      prefix: string;
      role?: string;
      mutateFns?: Record<string, unknown>;
      attachments?: ReturnType<typeof makeAttachment>[];
    }
  ) {
    const qc = makeQC();
    const sub = makeSubmittal({ status });
    qc.setQueryData(["/api/submittals", sub.id, "items"], []);
    qc.setQueryData(["/api/submittals", sub.id, "attachments"], opts.attachments ?? []);
    wrap(
      <SubmittalDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        submittal={sub}
        userRole={opts.role ?? "ADMIN"}
        mutations={makeMutations(opts.mutateFns ?? {})}
        testIdPrefix={opts.prefix}
      />,
      qc
    );
    return sub;
  }

  it("DRAFT: 'Submit for Review' button is rendered in the DOM", () => {
    mountStatus("DRAFT", { prefix: "sm-d-" });
    expect(screen.getByTestId("sm-d-button-action-submit")).toBeDefined();
  });

  it("DRAFT: submit button disabled when no attachments (required-attachment gate)", () => {
    mountStatus("DRAFT", { prefix: "sm-dna-", attachments: [] });
    expect(screen.getByTestId("sm-dna-button-action-submit").hasAttribute("disabled")).toBe(true);
  });

  it("DRAFT: submit button enabled once at least one attachment is present", () => {
    mountStatus("DRAFT", { prefix: "sm-da-", attachments: [makeAttachment("att-1")] });
    expect(screen.getByTestId("sm-da-button-action-submit").hasAttribute("disabled")).toBe(false);
  });

  it("DRAFT: submit button disabled while mutation is pending (even with attachment)", () => {
    mountStatus("DRAFT", {
      prefix: "sm-dp-",
      attachments: [makeAttachment("att-2")],
      mutateFns: { submitMutation: { mutate: vi.fn(), isPending: true } },
    });
    expect(screen.getByTestId("sm-dp-button-action-submit").hasAttribute("disabled")).toBe(true);
  });

  it("DRAFT: clicking enabled submit button calls submitMutation with submittal id", () => {
    const submitMutate = vi.fn();
    const sub = mountStatus("DRAFT", {
      prefix: "sm-dc-",
      attachments: [makeAttachment("att-3")],
      mutateFns: { submitMutation: { mutate: submitMutate, isPending: false } },
    });
    fireEvent.click(screen.getByTestId("sm-dc-button-action-submit"));
    expect(submitMutate).toHaveBeenCalledWith(sub.id);
  });

  it("DRAFT: MANAGER role with attachment can also submit (role-agnostic gate)", () => {
    const submitMutate = vi.fn();
    const sub = mountStatus("DRAFT", {
      prefix: "sm-dmgr-",
      role: "MANAGER",
      attachments: [makeAttachment("att-4")],
      mutateFns: { submitMutation: { mutate: submitMutate, isPending: false } },
    });
    const btn = screen.getByTestId("sm-dmgr-button-action-submit");
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(submitMutate).toHaveBeenCalledWith(sub.id);
  });

  it("SUBMITTED: 'Start Review' action button present; 'Submit for Review' absent", () => {
    mountStatus("SUBMITTED", { prefix: "sm-s-" });
    expect(screen.getByTestId("sm-s-button-action-start-review")).toBeDefined();
    expect(screen.queryByTestId("sm-s-button-action-submit")).toBeNull();
  });

  it("UNDER_REVIEW: approve action present; 'Submit for Review' and 'Start Review' absent", () => {
    mountStatus("UNDER_REVIEW", { prefix: "sm-ur-" });
    expect(screen.getByTestId("sm-ur-button-action-approve")).toBeDefined();
    expect(screen.queryByTestId("sm-ur-button-action-submit")).toBeNull();
    expect(screen.queryByTestId("sm-ur-button-action-start-review")).toBeNull();
  });

  it("APPROVED: 'Submit for Review' and 'Start Review' absent (terminal state)", () => {
    mountStatus("APPROVED", { prefix: "sm-a-" });
    expect(screen.queryByTestId("sm-a-button-action-submit")).toBeNull();
    expect(screen.queryByTestId("sm-a-button-action-start-review")).toBeNull();
  });

  it("CLOSED: all forward-transition buttons absent", () => {
    mountStatus("CLOSED", { prefix: "sm-cl-" });
    expect(screen.queryByTestId("sm-cl-button-action-submit")).toBeNull();
    expect(screen.queryByTestId("sm-cl-button-action-start-review")).toBeNull();
    expect(screen.queryByTestId("sm-cl-button-action-approve")).toBeNull();
  });
});
