// @vitest-environment jsdom
/**
 * Task #1310 — covers the SWPPP inspection page's "overdue reminder"
 * badge rendering. The backend sweep that increments
 * `overdueReminderCount` and stops at the per-org cap is exercised by
 * `server/__tests__/swppp-overdue-notifications.test.ts`; this file
 * pins the UI side: given a stored inspection in each interesting
 * state, the card must render (or hide) the right badge variant.
 *
 * States covered:
 *   • OPEN + overdue + count = 0 → no badge
 *   • OPEN + overdue + 0 < count < cap → "Reminder N of CAP sent"
 *   • OPEN + overdue + count >= cap → "Reminders paused — cap of CAP reached"
 *   • RESOLVED → badge cleared regardless of stored count
 *   • OPEN but reminder count reset (post-reopen behavior) → no badge
 *   • OPEN with the corrective-action due date pushed into the
 *     future → no badge (no longer overdue)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/hooks/use-dashboard-customization", () => ({
  useFeaturePermission: () => true,
}));

vi.mock("@/components/dot/FieldFormHelpers", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/dot/FieldFormHelpers")>(
      "@/components/dot/FieldFormHelpers",
    );
  return {
    ...actual,
    ProjectSelect: () => null,
  };
});

import SwpppInspectionsPage from "../swppp-inspections";
import { SWPPP_OVERDUE_REMINDER_DEFAULT_CAP } from "@shared/schema";

const INSP_ID = "insp-1";

function isoDaysFromToday(deltaDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function makeInspection(overrides: Partial<Record<string, unknown>> = {}) {
  const overdueIso = isoDaysFromToday(-5);
  return {
    id: INSP_ID,
    organizationId: "org-1",
    projectId: "proj-1",
    inspectionDate: overdueIso,
    inspectionType: "ROUTINE",
    inspectorName: null,
    inspectorCertNumber: null,
    rainfall24hrInches: null,
    rainfallTriggerInches: null,
    deficienciesFound: "Silt fence damaged near inlet",
    correctiveActions: "Repair silt fence and re-stake",
    correctiveActionDueDate: overdueIso,
    notes: null,
    status: "OPEN",
    overdueReminderCount: 0,
    resolvedAt: null,
    ...overrides,
  };
}

function renderPage(inspection: ReturnType<typeof makeInspection>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["/api/swppp-inspections", {}], [inspection]);
  client.setQueryData(["/api/swppp/settings"], {
    organizationId: "org-1",
    overdueReminderMaxCount: SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
    overdueReminderIntervalHours: 22,
  });
  return render(
    <QueryClientProvider client={client}>
      <SwpppInspectionsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  mockApiRequest.mockReset();
  mockToast.mockReset();
});

describe("SWPPP overdue reminder badge", () => {
  it("renders no reminder badge when overdueReminderCount is 0", () => {
    renderPage(makeInspection({ overdueReminderCount: 0 }));
    expect(
      screen.queryByTestId(`badge-swppp-reminders-${INSP_ID}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`badge-swppp-reminders-capped-${INSP_ID}`),
    ).toBeNull();
  });

  it("renders the mid-cycle 'Reminder N of CAP sent' badge", () => {
    renderPage(makeInspection({ overdueReminderCount: 2 }));
    const badge = screen.getByTestId(`badge-swppp-reminders-${INSP_ID}`);
    expect(badge.textContent).toContain(
      `Reminder 2 of ${SWPPP_OVERDUE_REMINDER_DEFAULT_CAP} sent`,
    );
    expect(
      screen.queryByTestId(`badge-swppp-reminders-capped-${INSP_ID}`),
    ).toBeNull();
  });

  it("renders the paused variant once the reminder count reaches the cap", () => {
    renderPage(
      makeInspection({
        overdueReminderCount: SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
      }),
    );
    const badge = screen.getByTestId(
      `badge-swppp-reminders-capped-${INSP_ID}`,
    );
    expect(badge.textContent).toContain(
      `Reminders paused — cap of ${SWPPP_OVERDUE_REMINDER_DEFAULT_CAP} reached`,
    );
    expect(
      screen.queryByTestId(`badge-swppp-reminders-${INSP_ID}`),
    ).toBeNull();
  });

  it("also renders the paused variant when count exceeds the cap", () => {
    renderPage(
      makeInspection({
        overdueReminderCount: SWPPP_OVERDUE_REMINDER_DEFAULT_CAP + 3,
      }),
    );
    const cappedBadge = screen.getByTestId(
      `badge-swppp-reminders-capped-${INSP_ID}`,
    );
    expect(cappedBadge.textContent).toContain(
      `Reminders paused — cap of ${SWPPP_OVERDUE_REMINDER_DEFAULT_CAP} reached`,
    );
    expect(
      screen.queryByTestId(`badge-swppp-reminders-${INSP_ID}`),
    ).toBeNull();
  });

  it("clears the badge once the inspection is RESOLVED", () => {
    renderPage(
      makeInspection({
        overdueReminderCount: 3,
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
      }),
    );
    expect(
      screen.queryByTestId(`badge-swppp-reminders-${INSP_ID}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`badge-swppp-reminders-capped-${INSP_ID}`),
    ).toBeNull();
  });

  it("clears the badge after a reopen resets the reminder count to zero", () => {
    // After /reopen the server resets status → OPEN and overdueReminderCount → 0,
    // so the badge should not render even though the inspection is still overdue.
    renderPage(makeInspection({ overdueReminderCount: 0, status: "OPEN" }));
    expect(
      screen.queryByTestId(`badge-swppp-reminders-${INSP_ID}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`badge-swppp-reminders-capped-${INSP_ID}`),
    ).toBeNull();
  });

  it("clears the badge once the corrective-action due date is pushed into the future", () => {
    renderPage(
      makeInspection({
        overdueReminderCount: 3,
        correctiveActionDueDate: isoDaysFromToday(10),
      }),
    );
    expect(
      screen.queryByTestId(`badge-swppp-reminders-${INSP_ID}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`badge-swppp-reminders-capped-${INSP_ID}`),
    ).toBeNull();
  });
});
