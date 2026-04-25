// @vitest-environment jsdom
/**
 * Task #1952 — Companion to the server-side integration test in
 * `server/__tests__/website-republish-db-timeout.test.ts`. Task #1949
 * added a 30-second client-side `AbortController` race inside the
 * `republishMutation` in `WebsitePublishingTab.tsx` so the spinner can
 * never hang forever when the server is slow. This file mocks `fetch`
 * with a Promise that never resolves and uses fake timers to fast-
 * forward past the 30 s budget. It then asserts:
 *
 *   • The destructive toast fires with copy that mentions "30 seconds"
 *     and points the user at the deployment history (the exact wording
 *     Task #1949 surfaces when the AbortController fires).
 *   • The button comes out of its `isPending` state so the user can
 *     retry without reloading the page.
 *
 * If anyone removes the AbortController or the timer in the future the
 * `findByText` for the timeout copy will time out and this test will
 * fail loudly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
  };
});

import WebsitePublishingTab from "../WebsitePublishingTab";
import type { Website } from "../types";

function makeWebsite(overrides: Partial<Website> = {}): Website {
  return {
    id: "site-1",
    organizationId: "org-1",
    subdomain: "demo",
    customDomain: null,
    domainVerified: false,
    status: "PUBLISHED",
    siteTitle: "Demo Site",
    siteTagline: null,
    logoUrl: null,
    faviconUrl: null,
    logoHeight: null,
    primaryColor: "#000",
    secondaryColor: null,
    accentColor: null,
    fontFamily: null,
    templateId: null,
    metaTitle: null,
    metaDescription: null,
    showBlog: false,
    showProjects: false,
    showTestimonials: false,
    contactEmail: "x@y.test",
    contactPhone: null,
    contentWidth: null,
    maxWidth: null,
    sectionPadding: null,
    breakpointDesktop: null,
    breakpointTablet: null,
    breakpointMobile: null,
    headerType: null,
    headerHeight: null,
    logoPosition: null,
    navigationLayout: null,
    mobileNavStyle: null,
    showOnScroll: null,
    pageLayout: null,
    sidebarWidth: null,
    pagePadding: null,
    showBreadcrumb: null,
    footerVisibility: null,
    footerColumns: null,
    footerWidth: null,
    footerPadding: null,
    footerSectionSettings: null,
    headerSectionSettings: null,
    headerComponentsConfig: null,
    footerComponentsConfig: null,
    bodyComponentsConfig: null,
    globalComponentsConfig: null,
    lastPublishedAt: "2026-04-20T12:00:00.000Z",
    defaultMetaTitle: null,
    defaultMetaDescription: null,
    ogImageUrl: null,
    googleAnalyticsId: null,
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: "2026-04-20T12:00:00.000Z",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

function renderTab(website: Website) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Pre-seed the supporting queries so the component doesn't try to
  // fetch them through the (mocked) fetch and starve waiting for a
  // response.
  client.setQueryData(["/api/website/deployments"], []);
  client.setQueryData(["/api/website/staging-token"], {
    token: null,
    subdomain: website.subdomain,
  });
  return render(
    <QueryClientProvider client={client}>
      <WebsitePublishingTab
        website={website}
        onPublish={() => {}}
        publishPending={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  mockToast.mockReset();
  // Fake setTimeout/clearTimeout/Date only — leave queueMicrotask /
  // setImmediate alone so React's scheduler and React Query's promise
  // chains keep settling between virtual ticks. This mirrors the
  // pattern in `backfill-notification-settings-card-cooldown.test.tsx`.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date"],
    shouldAdvanceTime: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe("WebsitePublishingTab — republish 30s client-side timeout (Task #1952)", () => {
  it("surfaces the destructive timeout toast within 30s when fetch never resolves", async () => {
    // Mock fetch to return a Promise that NEVER resolves. The only
    // thing that can complete the mutation is the 30 s AbortController
    // race added in Task #1949.
    let abortReason: unknown = null;
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            abortReason = (signal as AbortSignal).reason;
            // Match the real fetch contract: aborted requests reject
            // with a DOMException whose name is "AbortError".
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        }
      });
    }) as any;

    renderTab(makeWebsite());

    // The component renders synchronously with the pre-seeded React
    // Query cache, so the republish button is in the DOM right away —
    // we use `getByTestId` instead of `findByTestId` because
    // `findByTestId` polls with setTimeout, and that's the surface we
    // are mocking.
    const button = screen.getByTestId("button-republish") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(button);
      // React Query flips `isPending` after a microtask + render, so
      // we tick virtual time by 0 to drain the queued work.
      await vi.advanceTimersByTimeAsync(0);
    });

    // Sanity check: the mutation went into its pending state, so the
    // user is staring at a spinner and we must rescue them within 30 s.
    const pending = screen.getByTestId(
      "button-republish",
    ) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);

    // Advance time to 29 999 ms — JUST short of the 30 s budget. The
    // abort must NOT have fired yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(mockToast).not.toHaveBeenCalled();
    expect(abortReason).toBeNull();

    // Cross the boundary: 2 ms more should fire the AbortController,
    // reject the fetch, and surface the destructive toast.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    expect(mockToast).toHaveBeenCalled();
    const lastCall = mockToast.mock.calls[mockToast.mock.calls.length - 1][0];
    expect(lastCall.variant).toBe("destructive");
    expect(lastCall.title).toMatch(/republish/i);
    // The user-facing copy from Task #1949 explicitly mentions the
    // 30-second budget and points at the deployment history. Both bits
    // matter for the user to understand what to do next, so pin them.
    expect(lastCall.description).toMatch(/30 seconds/i);
    expect(lastCall.description).toMatch(/deployment history/i);

    // After the toast fires the button must come out of its pending
    // state so the user can retry. If the mutation got stuck in
    // `isPending`, the spinner would never go away.
    const after = screen.getByTestId("button-republish") as HTMLButtonElement;
    expect(after.disabled).toBe(false);
  });
});
