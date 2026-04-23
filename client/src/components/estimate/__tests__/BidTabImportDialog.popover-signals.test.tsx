// @vitest-environment jsdom
//
// Task #1280 — verify the suggestion-reason popover renders the right signals.
// The BidTabImportDialog explain hover-card and the alternates popover are
// the surface estimators read when they hover a suggestion. None of those
// data fields (alias text, accept/reject counts, per-agency accepts, matched
// keyword chips, the alternates list, swap-on-click) had any test coverage —
// a future change to PayItemMatchExplain or to the matcher response could
// silently break what the user sees. This integration test seeds an import
// flow with three rows whose top match is alias-driven, history-driven, and
// fuzzy respectively, then drives the dialog through hover + click and
// asserts the popover surface area for each.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks -----------------------------------------------------------------

vi.mock("@/hooks/use-feature-flags", () => ({
  useFeatureFlags: () => ({
    flags: { DOT_PAY_ITEMS: true },
    isLoading: false,
    isEnabled: (key: string) => key === "DOT_PAY_ITEMS",
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
  toast: vi.fn(),
}));

const PARSED_ROWS = [
  { rowIndex: 0, description: "Roadway excavation", quantity: 250, unit: "CY" },
  { rowIndex: 1, description: "Asphalt concrete pavement", quantity: 500, unit: "TON" },
  { rowIndex: 2, description: "Concrete pavement", quantity: 100, unit: "SY" },
];

vi.mock("@/lib/bidTabParser", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bidTabParser")>(
    "@/lib/bidTabParser",
  );
  return {
    ...actual,
    parseFile: vi.fn(async () => PARSED_ROWS),
  };
});

const ALIAS_TOP = makeMatch({
  payItem: { id: "pi-alias-top", itemNumber: "201-2.01", description: "Alias-mapped excavation pay item", unit: "CY", specSection: "201", category: "EARTHWORK" },
  agency: { id: "ag-fl", code: "FDOT", name: "Florida DOT" },
  specBook: { id: "sb-fl-2024", edition: "2024" },
  score: 1.85,
  matchReason: "alias",
  aliasText: "site dirt removal",
  matchedTokens: ["roadway", "excavation"],
  historyAccepts: 4,
  historyRejects: 1,
  agencyAccepts: 3,
  orgAffinityAccepts: 7,
});

const ALIAS_ALT = makeMatch({
  payItem: { id: "pi-alias-alt", itemNumber: "201-9.99", description: "Alternate excavation pay item", unit: "CY", specSection: "201", category: "EARTHWORK" },
  agency: { id: "ag-fl", code: "FDOT", name: "Florida DOT" },
  specBook: { id: "sb-fl-2024", edition: "2024" },
  score: 0.62,
  matchReason: "fuzzy",
  matchedTokens: ["excavation", "roadway"],
});

const HISTORY_TOP = makeMatch({
  payItem: { id: "pi-hist-top", itemNumber: "334-1.13", description: "Asphalt pavement (learned)", unit: "TON", specSection: "334", category: "PAVING" },
  agency: { id: "ag-tx", code: "TXDOT", name: "Texas DOT" },
  specBook: { id: "sb-tx-2014", edition: "2014" },
  score: 1.10,
  matchReason: "history",
  matchedTokens: ["asphalt", "concrete", "pavement"],
  historyAccepts: 6,
  historyRejects: 0,
  agencyAccepts: 5,
  orgAffinityAccepts: 9,
});

const FUZZY_TOP = makeMatch({
  payItem: { id: "pi-fuzz-top", itemNumber: "353-2.10", description: "Plain concrete pavement (fuzzy)", unit: "SY", specSection: "353", category: "PAVING" },
  agency: { id: "ag-ca", code: "CALTRANS", name: "California DOT" },
  specBook: { id: "sb-ca-2018", edition: "2018" },
  score: 0.78,
  matchReason: "fuzzy",
  matchedTokens: ["concrete", "pavement"],
  historyAccepts: 0,
  historyRejects: 0,
  agencyAccepts: 0,
  orgAffinityAccepts: 0,
});

interface MatchInput {
  payItem: { id: string; itemNumber: string; description: string; unit: string; specSection: string | null; category: string | null };
  agency: { id: string; code: string; name: string };
  specBook: { id: string; edition: string };
  score: number;
  matchReason: "alias" | "history" | "fuzzy";
  aliasText?: string | null;
  matchedTokens?: string[];
  historyAccepts?: number;
  historyRejects?: number;
  agencyAccepts?: number;
  orgAffinityAccepts?: number;
}

function makeMatch(input: MatchInput) {
  return {
    aliasText: null,
    matchedTokens: [],
    historyAccepts: 0,
    historyRejects: 0,
    agencyAccepts: 0,
    orgAffinityAccepts: 0,
    ...input,
  };
}

const matcherResponses: Record<string, { matches: ReturnType<typeof makeMatch>[] }> = {
  "Roadway excavation": { matches: [ALIAS_TOP, ALIAS_ALT] },
  "Asphalt concrete pavement": { matches: [HISTORY_TOP] },
  "Concrete pavement": { matches: [FUZZY_TOP] },
};

vi.mock("@/lib/queryClient", async () => {
  const real = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  const apiRequest = vi.fn(async (method: string, url: string, body?: unknown) => {
    if (url === "/api/dot/pay-items/match") {
      const desc = (body as { description: string } | undefined)?.description ?? "";
      const data = matcherResponses[desc] ?? { matches: [] };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/line-items/bulk")) {
      return new Response(JSON.stringify({ created: 0 }), { status: 200 });
    }
    if (url === "/api/dot/pay-items/match/feedback") {
      return new Response(JSON.stringify({ recorded: 0, batchId: null }), {
        status: 200,
      });
    }
    return new Response("{}", { status: 200 });
  });
  return {
    ...real,
    apiRequest,
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
  };
});

// --- Helpers ---------------------------------------------------------------

import { BidTabImportDialog } from "../BidTabImportDialog";
import { Toaster } from "@/components/ui/toaster";

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BidTabImportDialog estimateId="est-1" />
      <Toaster />
    </QueryClientProvider>,
  );
}

async function openDialogAndUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("button-open-bid-tab-import"));
  const fileInput = (await screen.findByTestId(
    "input-bid-tab-file",
  )) as HTMLInputElement;
  // Drop a placeholder File — parseFile is mocked so the contents don't matter.
  const file = new File(["placeholder"], "bid-tab.csv", { type: "text/csv" });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

beforeEach(() => {
  // Many Radix components query window.matchMedia / ResizeObserver / Pointer
  // events that jsdom doesn't ship by default; install minimal stubs so the
  // hover-card + popover open without throwing.
  if (!(window as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = (() => ({
      matches: false,
      media: "",
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  }
  // Radix uses PointerEvent; jsdom only ships it in newer versions. Patch a
  // minimal subclass of MouseEvent that satisfies HoverCard / Popover.
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
        this.pointerType = params.pointerType ?? "mouse";
      }
    }
    (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent =
      PointerEventPolyfill;
  }
  // Radix's Dismissable layer also uses Element#hasPointerCapture etc.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BidTabImportDialog suggestion-reason popover", () => {
  it("shows alias text, accept/reject counts, per-agency accepts, and keyword chips for the top suggestion", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialogAndUpload(user);

    // Wait for the matcher to finish all three rows and the dialog to enter
    // review phase (the explain trigger only renders when status === "matched").
    const aliasTrigger = await screen.findByTestId(
      "button-explain-top-match-0",
      {},
      { timeout: 4000 },
    );
    const historyTrigger = await screen.findByTestId("button-explain-top-match-1");
    const fuzzyTrigger = await screen.findByTestId("button-explain-top-match-2");

    // The matchReason badge that lives on the score column is the user's
    // at-a-glance signal — assert each row got the right one before opening
    // any popovers.
    expect(screen.getByTestId("badge-match-reason-0").textContent).toContain(
      "alias",
    );
    expect(screen.getByTestId("badge-match-reason-1").textContent).toContain(
      "learned",
    );
    expect(screen.queryByTestId("badge-match-reason-2")).toBeNull();

    // --- Row 0: alias-driven top match ------------------------------------
    await user.hover(aliasTrigger);
    const aliasPopover = await screen.findByTestId(
      "hovercard-top-match-0",
      {},
      { timeout: 2000 },
    );
    const inAlias = within(aliasPopover);
    expect(
      inAlias.getByTestId("explain-item-number-top-0").textContent,
    ).toBe("201-2.01");
    expect(inAlias.getByTestId("explain-score-top-0")).toBeTruthy();
    // Alias text box only renders when the match reason is "alias".
    expect(
      inAlias.getByTestId("explain-alias-text-top-0").textContent,
    ).toContain("site dirt removal");
    // Accept/reject counts come from historyAccepts / historyRejects.
    expect(inAlias.getByTestId("explain-accepts-top-0").textContent).toContain(
      "4 accepts",
    );
    expect(inAlias.getByTestId("explain-rejects-top-0").textContent).toContain(
      "1 reject",
    );
    // Per-agency accepts.
    expect(
      inAlias.getByTestId("explain-agency-accepts-top-0").textContent,
    ).toContain("3 accepts");
    // Org affinity surface for >0.
    expect(
      inAlias.getByTestId("explain-org-affinity-top-0").textContent,
    ).toContain("7");
    // Reason chip group: alias chip is present (alias suppresses keyword chips
    // by design — the chips component swaps reason="alias" into an alias-only
    // chip set).
    expect(
      inAlias.getByTestId("badge-match-reason-alias-explain-top-0").textContent,
    ).toMatch(/site dirt removal/);


    // --- Row 1: learned (history-driven) top match ------------------------
    await user.hover(historyTrigger);
    const historyPopover = await screen.findByTestId(
      "hovercard-top-match-1",
      {},
      { timeout: 2000 },
    );
    const inHistory = within(historyPopover);
    expect(
      inHistory.getByTestId("explain-reason-top-1").textContent,
    ).toMatch(/learned/i);
    expect(
      inHistory.getByTestId("explain-accepts-top-1").textContent,
    ).toContain("6 accepts");
    expect(
      inHistory.getByTestId("explain-rejects-top-1").textContent,
    ).toContain("0 rejects");
    expect(
      inHistory.getByTestId("explain-agency-accepts-top-1").textContent,
    ).toContain("5 accepts");
    // History reason renders fuzzy chips internally (matchReason "history" is
    // mapped to "fuzzy" so estimators see what keywords drove the match).
    expect(
      inHistory.getByTestId("badge-match-reason-keywords-explain-top-1")
        .textContent,
    ).toMatch(/asphalt/);


    // --- Row 2: pure fuzzy top match --------------------------------------
    await user.hover(fuzzyTrigger);
    const fuzzyPopover = await screen.findByTestId(
      "hovercard-top-match-2",
      {},
      { timeout: 2000 },
    );
    const inFuzzy = within(fuzzyPopover);
    expect(
      inFuzzy.getByTestId("explain-reason-top-2").textContent,
    ).toMatch(/fuzzy/i);
    // No alias text box for a fuzzy match.
    expect(inFuzzy.queryByTestId("explain-alias-text-top-2")).toBeNull();
    // Keyword chips drive the reason explanation here.
    expect(
      inFuzzy.getByTestId("badge-match-reason-keywords-explain-top-2")
        .textContent,
    ).toMatch(/concrete/);
    expect(
      inFuzzy.getByTestId("explain-accepts-top-2").textContent,
    ).toContain("0 accepts");
    // No org-affinity line when affinity == 0.
    expect(inFuzzy.queryByTestId("explain-org-affinity-top-2")).toBeNull();

  });

  it("opens the alternates popover, shows an alternate's explain hover, and swaps the top suggestion on click", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialogAndUpload(user);

    // Sanity: the alias top row currently shows the alias item number.
    const topNumber = await screen.findByTestId("text-top-match-number-0");
    expect(topNumber.textContent).toBe("201-2.01");

    // Row 0 is the only one with alternates (one extra suggestion).
    const altButton = await screen.findByTestId("button-alternates-0");
    expect(altButton.textContent).toMatch(/1 other/);
    await user.click(altButton);

    const altPopover = await screen.findByTestId("popover-alternates-0");
    const inAltPopover = within(altPopover);
    const altRowButton = inAltPopover.getByTestId(
      "button-alternate-0-pi-alias-alt",
    );
    expect(altRowButton.textContent).toContain("201-9.99");

    // Hover the alternate row to confirm its explain hover renders the
    // PayItemMatchExplain content, then click to swap the top suggestion.
    await user.hover(altRowButton);
    const altHover = await screen.findByTestId(
      "hovercard-alternate-0-pi-alias-alt",
      {},
      { timeout: 2000 },
    );
    const inAltHover = within(altHover);
    expect(
      inAltHover.getByTestId("explain-item-number-alt-0-pi-alias-alt")
        .textContent,
    ).toBe("201-9.99");
    expect(
      inAltHover.getByTestId("explain-reason-alt-0-pi-alias-alt").textContent,
    ).toMatch(/fuzzy/i);
    expect(
      inAltHover.getByTestId(
        "badge-match-reason-keywords-explain-alt-0-pi-alias-alt",
      ).textContent,
    ).toMatch(/excavation/);

    await user.click(altRowButton);

    // Swap should: a) close the alternates popover, b) replace the top match
    // on row 0, c) move the previous top into the alternates list.
    const swapped = await screen.findByTestId("text-top-match-number-0");
    expect(swapped.textContent).toBe("201-9.99");
    // The popover closes itself after onChoose — assert the popover and the
    // hovered alternate button are both gone so we know the close path fired
    // (not just that the top label changed).
    expect(screen.queryByTestId("popover-alternates-0")).toBeNull();
    expect(
      screen.queryByTestId("button-alternate-0-pi-alias-alt"),
    ).toBeNull();
    const altButtonAfter = screen.getByTestId("button-alternates-0");
    expect(altButtonAfter.textContent).toMatch(/1 other/);
  });
});
