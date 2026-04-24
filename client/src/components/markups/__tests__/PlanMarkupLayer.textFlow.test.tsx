// @vitest-environment jsdom
/**
 * Task #1658 — Lock down the project-side plan-markup TEXT flow.
 *
 * Task #1653 replaced the legacy `window.prompt()` modal in
 * `<PlanMarkupLayer />` with the in-canvas `<MarkupTextInput />`
 * editor (mirroring the bid-side takeoff workspace). This spec
 * guards that contract so a future refactor of the plan layer (or a
 * regression in the shared `MarkupTextInput`) cannot silently bring
 * back the legacy prompt-based UX or drop text submissions on the
 * project side.
 *
 * Coverage:
 *   1. Clicking on the Konva stage with the TEXT tool active opens
 *      the in-canvas editor and NEVER calls `window.prompt` (a spy
 *      installed on the global throws if invoked).
 *   2. Submitting a non-blank label fires exactly one
 *      `POST /api/plan-documents/:id/markups` with the expected
 *      normalized point and trimmed text.
 *   3. Pressing Escape (cancel) closes the editor without firing any
 *      POST.
 *   4. Submitting only whitespace closes the editor without firing
 *      any POST.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: vi.fn(async () => ({ ok: true } as unknown as Response)),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import PlanMarkupLayer from "../PlanMarkupLayer";
import { apiRequest, queryClient as testQueryClient } from "@/lib/queryClient";
import Konva from "konva";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const DOC_ID = "doc-text-1";
const PAGE = 1;
const CANVAS = 400;
const queryKey = ["/api/plan-documents", DOC_ID, "markups", PAGE] as const;

beforeEach(() => {
  apiRequestMock.mockClear();
  // Default: any successful POST returns a server-shaped markup so the
  // create mutation's `onSuccess` (which destructures the JSON body to
  // build a history snapshot) does not throw.
  apiRequestMock.mockImplementation(async (_method: string, _url: string, body?: unknown) => {
    const created = {
      id: "srv-text-1",
      pageNumber: PAGE,
      tool: "TEXT",
      points: (body as { points?: unknown })?.points ?? [],
      color: (body as { color?: string })?.color ?? "#ef4444",
      thickness: (body as { thickness?: number })?.thickness ?? 2,
      text: (body as { text?: string | null })?.text ?? null,
      layerId: null,
      groupId: null,
    };
    return {
      ok: true,
      json: async () => created,
    } as unknown as Response;
  });
  // Pre-seed the markups query with an empty list so the layer renders
  // without a real fetch.
  testQueryClient.setQueryData(queryKey, []);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => [],
        } as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
  testQueryClient.clear();
});

interface RenderArgs {
  onChangeTool?: (tool: unknown) => void;
}

function renderLayer(args: RenderArgs = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  );
  return render(
    <PlanMarkupLayer
      documentId={DOC_ID}
      pageNumber={PAGE}
      canvasWidth={CANVAS}
      canvasHeight={CANVAS}
      activeTool="TEXT"
      color="#ef4444"
      thickness={2}
      onChangeTool={args.onChangeTool}
    />,
    { wrapper: Wrapper },
  );
}

function getStage(): Konva.Stage {
  // react-konva pushes each mounted Stage onto Konva.stages; the most
  // recently mounted one is the layer under test.
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  expect(stages.length).toBeGreaterThan(0);
  return stages[stages.length - 1];
}

/**
 * Fire a Konva pointerdown on the stage at the supplied pixel
 * position. The renderer reads the position from
 * `stage.getPointerPosition()`, so we stub it for the duration of the
 * dispatch.
 */
function pointerDownAt(stage: Konva.Stage, x: number, y: number) {
  const spy = vi.spyOn(stage, "getPointerPosition").mockReturnValue({ x, y });
  try {
    act(() => {
      stage.fire(
        "pointerdown",
        {
          target: stage,
          evt: {} as PointerEvent,
        } as never,
        true,
      );
    });
  } finally {
    spy.mockRestore();
  }
}

describe("PlanMarkupLayer TEXT flow (Task #1658)", () => {
  it("opens the in-canvas editor on TEXT click and never calls window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error(
        "window.prompt() is forbidden — Task #1653 replaced it with <MarkupTextInput />",
      );
    });

    renderLayer();

    // Editor must NOT be visible until the user clicks the canvas.
    expect(screen.queryByTestId("markup-text-input-wrapper")).toBeNull();
    expect(screen.queryByTestId("input-markup-text")).toBeNull();

    const stage = getStage();
    pointerDownAt(stage, 80, 120);

    // The in-canvas editor mounts at the click point and focuses its
    // input on the next animation frame.
    const wrapper = await screen.findByTestId("markup-text-input-wrapper");
    expect(wrapper).toBeTruthy();
    expect(screen.getByTestId("input-markup-text")).toBeTruthy();

    // The legacy modal must not have been triggered, even once.
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("POSTs the trimmed text and normalized point on Enter", async () => {
    vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("window.prompt() is forbidden");
    });

    const onChangeTool = vi.fn();
    renderLayer({ onChangeTool });

    const stage = getStage();
    // Click at (80, 120) on a 400x400 canvas → normalized (0.2, 0.3).
    pointerDownAt(stage, 80, 120);

    const input = (await screen.findByTestId("input-markup-text")) as HTMLInputElement;

    // Type with surrounding whitespace; the editor (and/or the layer)
    // must trim before POSTing.
    fireEvent.change(input, { target: { value: "  Hello world  " } });
    expect(input.value).toBe("  Hello world  ");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      const posts = apiRequestMock.mock.calls.filter(
        (c) =>
          c[0] === "POST" &&
          /\/api\/plan-documents\/[^/]+\/markups$/.test(String(c[1])),
      );
      expect(posts).toHaveLength(1);
    });

    const posts = apiRequestMock.mock.calls.filter(
      (c) =>
        c[0] === "POST" &&
        /\/api\/plan-documents\/[^/]+\/markups$/.test(String(c[1])),
    );
    expect(posts[0][1]).toBe(`/api/plan-documents/${DOC_ID}/markups`);
    const body = posts[0][2] as {
      pageNumber: number;
      tool: string;
      points: Array<{ x: number; y: number }>;
      text: string;
      color: string;
      thickness: number;
    };
    expect(body.pageNumber).toBe(PAGE);
    expect(body.tool).toBe("TEXT");
    expect(body.text).toBe("Hello world");
    expect(body.color).toBe("#ef4444");
    expect(body.thickness).toBe(2);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].x).toBeCloseTo(80 / CANVAS, 10);
    expect(body.points[0].y).toBeCloseTo(120 / CANVAS, 10);

    // After a successful submit, the editor closes.
    await waitFor(() => {
      expect(screen.queryByTestId("markup-text-input-wrapper")).toBeNull();
    });

    // The active tool stays on TEXT (no `onChangeTool(null)` reset)
    // — this matches the bid-side takeoff workspace, where submitting
    // a label keeps the text tool selected so the user can keep
    // dropping labels without re-picking the tool from the toolbar.
    expect(onChangeTool).not.toHaveBeenCalled();
  });

  it("closes the editor on Escape without POSTing a markup", async () => {
    vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("window.prompt() is forbidden");
    });

    const onChangeTool = vi.fn();
    renderLayer({ onChangeTool });

    const stage = getStage();
    pointerDownAt(stage, 100, 200);

    const input = (await screen.findByTestId("input-markup-text")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "draft to discard" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("markup-text-input-wrapper")).toBeNull();
    });

    // No POST may have fired — the markup was cancelled, not saved.
    const posts = apiRequestMock.mock.calls.filter(
      (c) =>
        c[0] === "POST" &&
        /\/api\/plan-documents\/[^/]+\/markups$/.test(String(c[1])),
    );
    expect(posts).toHaveLength(0);

    // Task #1658 contract: cancelling closes the editor and leaves
    // the active tool unchanged. The toolbar stays on TEXT so the
    // user can immediately try again without re-picking the tool.
    expect(onChangeTool).not.toHaveBeenCalled();
  });

  it("closes the editor on a blank submit without POSTing a markup", async () => {
    vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("window.prompt() is forbidden");
    });

    const onChangeTool = vi.fn();
    renderLayer({ onChangeTool });

    const stage = getStage();
    pointerDownAt(stage, 40, 60);

    const input = (await screen.findByTestId("input-markup-text")) as HTMLInputElement;
    // Whitespace-only content trims to empty and must be treated as a
    // cancel — no markup is created.
    fireEvent.change(input, { target: { value: "   " } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("markup-text-input-wrapper")).toBeNull();
    });

    const posts = apiRequestMock.mock.calls.filter(
      (c) =>
        c[0] === "POST" &&
        /\/api\/plan-documents\/[^/]+\/markups$/.test(String(c[1])),
    );
    expect(posts).toHaveLength(0);

    // Task #1658 contract: a blank/whitespace submit closes the
    // editor and leaves the active tool unchanged — the toolbar
    // stays on TEXT, just like the cancel path.
    expect(onChangeTool).not.toHaveBeenCalled();
  });
});
