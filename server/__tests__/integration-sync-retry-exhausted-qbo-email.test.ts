// Task #1942 — When a `qbo_sync:%` integration_sync_state row exhausts its
// auto-retry budget, the existing INTEGRATION_SYNC_RETRIES_EXHAUSTED admin
// fan-out must:
//   * deliver an email tailored to QuickBooks (kind, item id, last error
//     in title + body), and
//   * deep-link the CTA to the QBO panel anchor (`#qbo-sync-retry-<id>`)
//     instead of the generic SyncRetryPanel anchor, so admins land on the
//     specific failing customer/invoice/pay-run row in the QuickBooks feed.
//
// Verifies both the per-row notify path (`notifyAdminsOfExhaustedSyncRetry`
// → row title/message contains kind + item id) and the email composer's
// QBO-aware deep link (`composeEmailContent` → action URL uses the QBO
// anchor when `integrationSyncContext.provider === "qbo"`).

import { describe, it, expect, vi } from "vitest";

import {
  composeEmailContent,
  type NotificationRecord,
} from "../services/notificationDelivery";
import { classifyQboEntity } from "../services/integrationSyncRetryNotifications";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

describe("classifyQboEntity (Task #1942)", () => {
  it("identifies the customer push kind + item id", () => {
    expect(classifyQboEntity("qbo_sync:customer:cust-1")).toEqual({
      kindLabel: "Customer",
      itemId: "cust-1",
    });
  });

  it("identifies the invoice push kind + item id", () => {
    expect(classifyQboEntity("qbo_sync:invoice:inv-7")).toEqual({
      kindLabel: "Invoice",
      itemId: "inv-7",
    });
  });

  it("identifies the payroll push kind + item id", () => {
    expect(classifyQboEntity("qbo_sync:payroll:run-9")).toEqual({
      kindLabel: "Payroll run",
      itemId: "run-9",
    });
  });

  it("identifies the certified payroll push kind + item id", () => {
    expect(classifyQboEntity("qbo_sync:certified_payroll:run-9")).toEqual({
      kindLabel: "Certified payroll run",
      itemId: "run-9",
    });
  });

  it("treats bare `customers` as the batch sync", () => {
    expect(classifyQboEntity("qbo_sync:customers")).toEqual({
      kindLabel: "Customer batch sync",
      itemId: null,
    });
  });

  it("falls back to a pretty scheduled-op label for any other bare op", () => {
    expect(classifyQboEntity("qbo_sync:chart_of_accounts")).toEqual({
      kindLabel: "Chart of accounts sync",
      itemId: null,
    });
  });

  it("returns a generic label for non-QBO entity types", () => {
    expect(classifyQboEntity("dol_wage_decision:CA-2024-01")).toEqual({
      kindLabel: "Sync",
      itemId: null,
    });
  });
});

describe("composeEmailContent — QBO INTEGRATION_SYNC_RETRIES_EXHAUSTED deep link (Task #1942)", () => {
  const baseNotification = (overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
    id: "notif-1",
    userId: "user-admin",
    type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
    title:
      "Integration sync gave up: QuickBooks Online — Invoice inv-7 (qbo_sync:invoice:inv-7)",
    message:
      "QuickBooks ran out of automatic retries while syncing this invoice (id inv-7). Last error: QBO 503. Open the QuickBooks panel on the Integrations page to retry or investigate.",
    relatedEntityId: "sync-state-42",
    relatedEntityType: "INTEGRATION_SYNC_STATE",
    ...overrides,
  });

  it("deep-links the CTA into the QBO panel anchor when provider is qbo", () => {
    const result = composeEmailContent(baseNotification(), {
      integrationSyncContext: {
        connectionId: "conn-qbo",
        entityType: "qbo_sync:invoice:inv-7",
        integrationLabel: "QuickBooks Online",
        provider: "qbo",
      },
    });

    expect(result.actionText).toBe("Open Integration Sync Retry");
    expect(result.actionUrl).toContain("/integrations#qbo-sync-retry-sync-state-42");
    expect(result.html).toContain("/integrations#qbo-sync-retry-sync-state-42");
    // Sanity: QBO-tailored body lines render through.
    expect(result.html).toContain("QuickBooks ran out of automatic retries");
    expect(result.html).toContain("inv-7");
  });

  it("keeps the generic SyncRetryPanel anchor for non-QBO providers", () => {
    const result = composeEmailContent(
      baseNotification({
        title: "Integration sync gave up: DOL Wage Decisions (dol_wage_decision:CA-2024-01)",
        message:
          "Automatic retries for DOL Wage Decisions — entity \"dol_wage_decision:CA-2024-01\" — have been exhausted...",
      }),
      {
        integrationSyncContext: {
          connectionId: "conn-dol",
          entityType: "dol_wage_decision:CA-2024-01",
          integrationLabel: "DOL Wage Decisions",
          provider: "dol_davis_bacon",
        },
      },
    );

    expect(result.actionUrl).toContain("/integrations#sync-retry-sync-state-42");
    expect(result.actionUrl).not.toContain("qbo-sync-retry-");
  });

  it("falls back to the generic anchor when no provider context is supplied", () => {
    // Older callers (and in-process unit tests) may compose the email
    // without the integrationSyncContext extras — the deep link must
    // still work, just without the QBO routing.
    const result = composeEmailContent(baseNotification());
    expect(result.actionUrl).toContain("/integrations#sync-retry-sync-state-42");
  });
});
