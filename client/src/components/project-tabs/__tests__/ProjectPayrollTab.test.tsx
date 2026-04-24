// @vitest-environment jsdom
/**
 * Task #1399 — locks down the DOL override confirmation flow added in #1382
 * (and refined in #1396/#1398) for `ProjectPayrollTab.tsx`. Verifies:
 *   - Real-id DOL feed rows skip the in-dialog mapping picker entirely and
 *     post the existing classificationId without `confirmCreateClassification`
 *   - Synthetic feed rows whose name exactly matches an existing org
 *     classification pre-select the matched id (no "Create new" default)
 *   - Synthetic feed rows without a near-match show the picker defaulted to
 *     "Create new"
 *   - "Use selected" submits the picked classificationId
 *   - "Create new" submits `confirmCreateClassification: true` plus the
 *     synthetic classification name
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

// Radix Select uses pointer events and portals that don't behave well in
// jsdom. Swap it out for a minimal context-driven shim so the test can drive
// `onValueChange` by clicking a plain <button> rendered for each SelectItem.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectCtx = React.createContext<{
    value: string;
    onValueChange: (v: string) => void;
  }>({ value: "", onValueChange: () => {} });
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <SelectCtx.Provider value={{ value, onValueChange }}>{children}</SelectCtx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children, ...rest }: any) => {
      const ctx = React.useContext(SelectCtx);
      return (
        <button
          type="button"
          onClick={() => ctx.onValueChange(value)}
          data-selected={ctx.value === value ? "true" : "false"}
          {...rest}
        >
          {children}
        </button>
      );
    },
  };
});

import ProjectPayrollTab from "../ProjectPayrollTab";

type Classification = {
  classificationId: string;
  classificationName: string;
  wageRate: number;
  fringeRate: number | null;
  totalRate: number | null;
  overtimeMultiplier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  wageDecision: string | null;
  source: "PROJECT_OVERRIDE" | "DOL_FEED";
  dolFeedName?: string | null;
  rememberedClassificationId?: string | null;
  rememberedFromProjectId?: string | null;
  rememberedFromProjectName?: string | null;
};

const PROJECT_ID = "proj-1";

function makeRow(overrides: Partial<Classification> = {}): Classification {
  return {
    classificationId: "cls-real-1",
    classificationName: "Carpenter",
    wageRate: 42.5,
    fringeRate: 12.25,
    totalRate: 54.75,
    overtimeMultiplier: "1.5",
    effectiveDate: "2026-01-01",
    expirationDate: null,
    wageDecision: "CA20260001",
    source: "DOL_FEED",
    ...overrides,
  };
}

function renderTab(opts: {
  classifications: Classification[];
  orgClassifications: { id: string; name: string }[];
}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        // Catch-all so any unexpected queryKey doesn't try to hit the network.
        queryFn: async () => null,
      },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(["/api/projects", PROJECT_ID, "payroll-summary"], {
    laborCostToDate: 0,
    budget: 0,
    laborVsBudget: 0,
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    overtimePercent: 0,
    totalEntries: 0,
    workers: [],
  });
  qc.setQueryData(["/api/projects", PROJECT_ID, "prevailing-wage-summary"], {
    projectId: PROJECT_ID,
    wageDecision: "CA20260001",
    wageDecisionCached: true,
    classifications: opts.classifications,
  });
  qc.setQueryData(["/api/labor-rates/classifications"], opts.orgClassifications);
  return render(
    <QueryClientProvider client={qc}>
      <ProjectPayrollTab projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

async function lastPostBody() {
  await waitFor(() => {
    expect(mockApiRequest).toHaveBeenCalled();
  });
  const calls = mockApiRequest.mock.calls;
  const [method, url, body] = calls[calls.length - 1];
  expect(method).toBe("POST");
  expect(url).toBe("/api/labor-rates/prevailing-wage-rates");
  return body as Record<string, unknown>;
}

describe("ProjectPayrollTab — DOL override confirmation flow", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue(new Response(null, { status: 200 }));
  });
  afterEach(() => {
    cleanup();
  });

  it("real-id DOL feed row skips the mapping picker and posts the existing classificationId", async () => {
    renderTab({
      classifications: [
        makeRow({ classificationId: "cls-real-1", classificationName: "Carpenter" }),
      ],
      orgClassifications: [{ id: "cls-real-1", name: "Carpenter" }],
    });

    fireEvent.click(screen.getByTestId("button-promote-override-cls-real-1"));
    expect(screen.getByTestId("dialog-promote-override")).toBeTruthy();
    // The "Map to classification" picker is only rendered for synthetic
    // dol-feed:* rows. Real-id rows must not see it at all.
    expect(screen.queryByTestId("field-override-mapping")).toBeNull();

    fireEvent.click(screen.getByTestId("button-save-override"));

    const body = await lastPostBody();
    expect(body.classificationId).toBe("cls-real-1");
    expect(body.confirmCreateClassification).toBeUndefined();
    expect(body.classificationName).toBeUndefined();
    expect(body.projectId).toBe(PROJECT_ID);
  });

  it("synthetic feed name with an exact match pre-selects the existing classification (no Create new default)", async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:Carpenter",
          classificationName: "Carpenter",
          dolFeedName: "Carpenter",
        }),
      ],
      orgClassifications: [
        { id: "cls-existing-carpenter", name: "Carpenter" },
        { id: "cls-other", name: "Laborer" },
      ],
    });

    fireEvent.click(screen.getByTestId("button-promote-override-dol-feed:Carpenter"));
    expect(screen.getByTestId("field-override-mapping")).toBeTruthy();
    // Suggestion badge confirms the auto-match pre-selected the existing row
    // rather than dropping the user on "Create new".
    expect(
      screen.getByTestId("badge-override-mapping-similar-cls-existing-carpenter"),
    ).toBeTruthy();
    const matchedOption = screen.getByTestId(
      "option-override-mapping-cls-existing-carpenter",
    );
    expect(matchedOption.getAttribute("data-selected")).toBe("true");
    expect(
      screen
        .getByTestId("option-override-mapping-create-new")
        .getAttribute("data-selected"),
    ).toBe("false");

    fireEvent.click(screen.getByTestId("button-save-override"));

    const body = await lastPostBody();
    expect(body.classificationId).toBe("cls-existing-carpenter");
    expect(body.confirmCreateClassification).toBeUndefined();
    // Synthetic id was swapped for a real id, so classificationName must
    // not be forwarded (the server only accepts it for create-new flows).
    expect(body.classificationName).toBeUndefined();
  });

  it("synthetic feed name without any near-match defaults the picker to Create new", async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:Specialist Welder",
          classificationName: "Specialist Welder",
          dolFeedName: "Specialist Welder",
        }),
      ],
      orgClassifications: [{ id: "cls-other", name: "Laborer" }],
    });

    fireEvent.click(
      screen.getByTestId("button-promote-override-dol-feed:Specialist Welder"),
    );
    const picker = screen.getByTestId("field-override-mapping");
    expect(picker).toBeTruthy();
    // No suggestion badge when there's no fuzzy match above threshold.
    expect(
      within(picker).queryByTestId(/^badge-override-mapping-similar-/),
    ).toBeNull();
    expect(
      screen
        .getByTestId("option-override-mapping-create-new")
        .getAttribute("data-selected"),
    ).toBe("true");
  });

  it('"Create new" submission posts confirmCreateClassification: true with the synthetic classification name', async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:Specialist Welder",
          classificationName: "Specialist Welder",
          dolFeedName: "Specialist Welder",
        }),
      ],
      orgClassifications: [{ id: "cls-other", name: "Laborer" }],
    });

    fireEvent.click(
      screen.getByTestId("button-promote-override-dol-feed:Specialist Welder"),
    );
    fireEvent.click(screen.getByTestId("button-save-override"));

    const body = await lastPostBody();
    expect(body.classificationId).toBe("dol-feed:Specialist Welder");
    expect(body.confirmCreateClassification).toBe(true);
    expect(body.classificationName).toBe("Specialist Welder");
    expect(body.dolFeedName).toBe("Specialist Welder");
  });

  it("Task #1437 — remembered sibling-project mapping wins over the fuzzy heuristic when pre-selecting", async () => {
    // The synthetic feed name "Carpenter (Group 1)" fuzzy-matches the
    // existing "Carpenter" classification (substring containment, score
    // > 0.7). But the server forwarded `rememberedClassificationId` from
    // a sibling project's previously-saved mapping pointing at the more
    // specific "Carpenter — Form Specialist" row. The dialog must honor
    // that remembered pick instead of running the fuzzy heuristic.
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:carpenter (group 1)",
          classificationName: "Carpenter (Group 1)",
          dolFeedName: "Carpenter (Group 1)",
          rememberedClassificationId: "cls-carpenter-form",
        }),
      ],
      orgClassifications: [
        { id: "cls-carpenter", name: "Carpenter" },
        { id: "cls-carpenter-form", name: "Carpenter — Form Specialist" },
        { id: "cls-other", name: "Laborer" },
      ],
    });

    fireEvent.click(
      screen.getByTestId("button-promote-override-dol-feed:carpenter (group 1)"),
    );
    expect(screen.getByTestId("field-override-mapping")).toBeTruthy();
    // Pre-selection follows the remembered id, not the fuzzy match.
    expect(
      screen
        .getByTestId("option-override-mapping-cls-carpenter-form")
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("option-override-mapping-cls-carpenter")
        .getAttribute("data-selected"),
    ).toBe("false");
    expect(
      screen
        .getByTestId("option-override-mapping-create-new")
        .getAttribute("data-selected"),
    ).toBe("false");

    fireEvent.click(screen.getByTestId("button-save-override"));

    const body = await lastPostBody();
    // Saving propagates the remembered classificationId, not the fuzzy
    // match's "cls-carpenter".
    expect(body.classificationId).toBe("cls-carpenter-form");
    expect(body.confirmCreateClassification).toBeUndefined();
    expect(body.classificationName).toBeUndefined();
    expect(body.dolFeedName).toBe("Carpenter (Group 1)");
  });

  it("Task #1466 — sibling-remembered pre-selection shows attribution hint with the source project name", async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:carpenter (group 1)",
          classificationName: "Carpenter (Group 1)",
          dolFeedName: "Carpenter (Group 1)",
          rememberedClassificationId: "cls-carpenter-form",
          rememberedFromProjectId: "proj-sibling",
          rememberedFromProjectName: "I-95 Phase 2",
        }),
      ],
      orgClassifications: [
        { id: "cls-carpenter", name: "Carpenter" },
        { id: "cls-carpenter-form", name: "Carpenter — Form Specialist" },
      ],
    });

    fireEvent.click(
      screen.getByTestId("button-promote-override-dol-feed:carpenter (group 1)"),
    );
    // The remembered-attribution hint must render and call out the sibling
    // project name; the generic "Looks similar" fuzzy hint must NOT render
    // because the pre-selection was driven by a remembered mapping.
    const hint = screen.getByTestId("text-override-mapping-remembered");
    expect(hint).toBeTruthy();
    const projectLink = screen.getByTestId("text-override-mapping-remembered-project");
    expect(projectLink.textContent).toBe("I-95 Phase 2");
    // Task #1508 — the project name should link to the source project's
    // payroll tab so users can jump over and inspect/fix the original mapping.
    expect(projectLink.tagName).toBe("A");
    expect(projectLink.getAttribute("href")).toBe(
      "/projects/proj-sibling?tab=payroll",
    );
    expect(screen.queryByTestId("text-override-mapping-similar")).toBeNull();
  });

  it("Task #1508 — remembered-attribution hint falls back to plain text when rememberedFromProjectId is missing", async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:carpenter (group 1)",
          classificationName: "Carpenter (Group 1)",
          dolFeedName: "Carpenter (Group 1)",
          rememberedClassificationId: "cls-carpenter-form",
          // Older payloads / fixtures may have the project name without an id.
          rememberedFromProjectName: "I-95 Phase 2",
        }),
      ],
      orgClassifications: [
        { id: "cls-carpenter", name: "Carpenter" },
        { id: "cls-carpenter-form", name: "Carpenter — Form Specialist" },
      ],
    });

    fireEvent.click(
      screen.getByTestId("button-promote-override-dol-feed:carpenter (group 1)"),
    );
    const projectEl = screen.getByTestId("text-override-mapping-remembered-project");
    expect(projectEl.textContent).toBe("I-95 Phase 2");
    expect(projectEl.tagName).toBe("SPAN");
    expect(projectEl.getAttribute("href")).toBeNull();
  });

  it("Task #1466 — fuzzy-only pre-selection does NOT render the remembered-attribution hint", async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:Carpenter",
          classificationName: "Carpenter",
          dolFeedName: "Carpenter",
          // No rememberedClassificationId / rememberedFromProjectName — the
          // pre-selection comes purely from the local fuzzy heuristic.
        }),
      ],
      orgClassifications: [{ id: "cls-existing-carpenter", name: "Carpenter" }],
    });

    fireEvent.click(screen.getByTestId("button-promote-override-dol-feed:Carpenter"));
    expect(screen.queryByTestId("text-override-mapping-remembered")).toBeNull();
    // The standard "Looks similar" fuzzy hint should still render so users
    // know the suggestion came from the local name-match heuristic.
    expect(screen.getByTestId("text-override-mapping-similar")).toBeTruthy();
  });

  it('"Use selected" submission posts the picked classificationId without confirmCreateClassification', async () => {
    renderTab({
      classifications: [
        makeRow({
          classificationId: "dol-feed:Specialist Welder",
          classificationName: "Specialist Welder",
          dolFeedName: "Specialist Welder",
        }),
      ],
      orgClassifications: [
        { id: "cls-laborer", name: "Laborer" },
        { id: "cls-ironworker", name: "Ironworker" },
      ],
    });

    fireEvent.click(
      screen.getByTestId("button-promote-override-dol-feed:Specialist Welder"),
    );
    // Picker defaults to Create new — the user explicitly picks an existing
    // classification from the dropdown ("Use selected" path).
    fireEvent.click(screen.getByTestId("option-override-mapping-cls-ironworker"));
    fireEvent.click(screen.getByTestId("button-save-override"));

    const body = await lastPostBody();
    expect(body.classificationId).toBe("cls-ironworker");
    expect(body.confirmCreateClassification).toBeUndefined();
    // Real-id swap means classificationName is no longer forwarded even
    // though we started from a synthetic dol-feed:* row.
    expect(body.classificationName).toBeUndefined();
    expect(body.dolFeedName).toBe("Specialist Welder");
  });
});
