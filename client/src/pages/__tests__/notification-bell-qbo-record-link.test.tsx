// @vitest-environment jsdom
/**
 * Task #1974 — covers the secondary "Open <recordLabel>" link on
 * INTEGRATION_SYNC_RETRIES_EXHAUSTED notification rows in the inbox
 * page. Verifies that:
 *  - the link renders + uses the friendly recordLabel from
 *    notification.metadata, and
 *  - orphan rows (metadata null / missing fields) gracefully omit the
 *    secondary link, mirroring the email's secondary CTA from
 *    Task #1945.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/lib/notificationDestination", () => ({
  getNotificationDestination: () => null,
}));

import { StandardNotificationItem } from "../notifications";
import type { Notification } from "@shared/schema";

function renderItem(notification: Notification) {
  const { hook } = memoryLocation({ path: "/", record: true });
  return render(
    <Router hook={hook}>
      <StandardNotificationItem
        notification={notification}
        onDismiss={() => undefined}
        isDismissing={false}
      />
    </Router>,
  );
}

function makeNotification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: "notif-1",
    userId: "user-1",
    organizationId: "org-1",
    type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
    title: "Integration sync gave up: QuickBooks — Acme Co (qbo_sync:customer:abc)",
    message: "QuickBooks ran out of automatic retries while syncing Acme Co.",
    isRead: false,
    relatedEntityId: "sync-state-1",
    relatedEntityType: "INTEGRATION_SYNC_STATE",
    metadata: null,
    createdAt: new Date("2026-04-25T10:00:00Z") as unknown as Notification["createdAt"],
    ...overrides,
  } as Notification;
}

beforeEach(() => {
  cleanup();
});

describe("StandardNotificationItem QBO record secondary link", () => {
  it("renders an Open <recordLabel> link when metadata.recordLink + recordLabel are present", () => {
    renderItem(
      makeNotification({
        metadata: {
          recordLink: "/crm?organisationId=org-acme",
          recordLabel: "Acme Co",
        },
      }),
    );

    const link = screen.getByTestId("link-notification-record-notif-1");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/crm?organisationId=org-acme");
    expect(link.textContent).toContain("Open Acme Co");
  });

  it("omits the secondary link when metadata is null (orphan record)", () => {
    renderItem(makeNotification({ metadata: null }));

    expect(screen.queryByTestId("link-notification-record-notif-1")).toBeNull();
  });

  it("omits the secondary link when metadata fields are missing", () => {
    renderItem(
      makeNotification({
        // recordLink without recordLabel — guard should still skip render.
        metadata: { recordLink: "/crm?organisationId=org-acme" },
      }),
    );

    expect(screen.queryByTestId("link-notification-record-notif-1")).toBeNull();
  });
});
