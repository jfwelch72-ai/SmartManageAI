// @vitest-environment jsdom
/**
 * Task #1346 — covers the SWPPP edit-dialog (`SwpppForm`) reminder
 * badges. Task #1310 already pins the card-level badges; the same
 * component file renders a parallel reminder badge inside the edit
 * dialog (`detail-swppp-reminders` / `detail-swppp-reminders-capped`).
 * This file mounts the dialog by clicking the per-card edit button on
 * the rendered page and asserts:
 *
 *   • OPEN + overdue + 0 < count < cap → mid-cycle copy renders
 *   • OPEN + overdue + count === cap   → paused variant renders
 *   • RESOLVED                         → neither badge renders
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
    lastOverdueNotifiedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

async function renderAndOpenDialog(
  inspection: ReturnType<typeof makeInspection>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["/api/swppp-inspections", {}], [inspection]);
  client.setQueryData(["/api/swppp/settings"], {
    organizationId: "org-1",
    overdueReminderMaxCount: SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
    overdueReminderIntervalHours: 22,
  });
  render(
    <QueryClientProvider client={client}>
      <SwpppInspectionsPage />
    </QueryClientProvider>,
  );
  const editBtn = await screen.findByTestId(`button-edit-swppp-${INSP_ID}`);
  fireEvent.click(editBtn);
  // Dialog mounts asynchronously through Radix portal.
  await waitFor(() =>
    expect(screen.getByTestId("input-swppp-deficiencies")).toBeTruthy(),
  );
}

beforeEach(() => {
  cleanup();
  mockApiRequest.mockReset();
  mockToast.mockReset();
});

describe("SWPPP edit-dialog overdue reminder badge", () => {
  it("renders the mid-cycle 'Reminder N of CAP sent' copy in the dialog", async () => {
    await renderAndOpenDialog(makeInspection({ overdueReminderCount: 2 }));
    const badge = await screen.findByTestId("detail-swppp-reminders");
    expect(badge.textContent).toContain(
      `Reminder 2 of ${SWPPP_OVERDUE_REMINDER_DEFAULT_CAP} sent for this overdue corrective action.`,
    );
    expect(screen.queryByTestId("detail-swppp-reminders-capped")).toBeNull();
  });

  it("renders the paused variant in the dialog once count reaches the cap", async () => {
    await renderAndOpenDialog(
      makeInspection({
        overdueReminderCount: SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
      }),
    );
    const capped = await screen.findByTestId("detail-swppp-reminders-capped");
    expect(capped.textContent).toContain(
      `Overdue reminders paused — cap of ${SWPPP_OVERDUE_REMINDER_DEFAULT_CAP} reached`,
    );
    expect(screen.queryByTestId("detail-swppp-reminders")).toBeNull();
  });

  it("hides both badge variants in the dialog when the inspection is RESOLVED", async () => {
    await renderAndOpenDialog(
      makeInspection({
        overdueReminderCount: 3,
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
      }),
    );
    expect(screen.queryByTestId("detail-swppp-reminders")).toBeNull();
    expect(screen.queryByTestId("detail-swppp-reminders-capped")).toBeNull();
  });
});
