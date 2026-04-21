/**
 * Task #738: destination mapping coverage for the CRM organisation
 * reassignment notification type.
 *
 * Task #731 added `CRM_ORGANIZATION_REASSIGNED` notifications when a CRM
 * organisation's owner changes. The in-app bell deep-links each notification
 * through `getNotificationDestination` — if that mapping is missing or wrong,
 * the user gets dropped on a generic page and the "jump to the reassigned
 * org" UX silently regresses. These tests pin the mapping:
 *
 *   - Immediate notification (has relatedEntityId) deep-links to the specific
 *     organisation detail dialog on the orgs tab.
 *   - Summary notification (no relatedEntityId) lands on the orgs tab so the
 *     new owner can review the bundled batch.
 */

import { describe, it, expect } from "vitest";

import { getNotificationDestination } from "../../client/src/lib/notificationDestination";

describe("getNotificationDestination — CRM_ORGANIZATION_REASSIGNED (Task #731 / #738)", () => {
  it("routes the immediate notification to the specific organisation on the orgs tab", () => {
    const dest = getNotificationDestination({
      type: "CRM_ORGANIZATION_REASSIGNED",
      relatedEntityId: "org-123",
      relatedEntityType: "CRM_ORGANIZATION",
      message: "Alice assigned Acme Corp to you.",
    });
    expect(dest).toBe("/crm?tab=orgs&organisationId=org-123");
  });

  it("routes the bundled summary (no entity id) to the orgs tab", () => {
    const dest = getNotificationDestination({
      type: "CRM_ORGANIZATION_REASSIGNED",
      relatedEntityId: null,
      relatedEntityType: "CRM_ORGANIZATION",
      message: "Alice assigned 4 more CRM organizations to you in the last few minutes.",
    });
    expect(dest).toBe("/crm?tab=orgs");
  });

  it("still routes to the orgs tab when relatedEntityId is undefined", () => {
    const dest = getNotificationDestination({
      type: "CRM_ORGANIZATION_REASSIGNED",
      message: "Summary message",
    });
    expect(dest).toBe("/crm?tab=orgs");
  });
});
