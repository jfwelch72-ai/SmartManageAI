/**
 * Task #715: regression tests for the rapid-fire CRM contact reassignment
 * coalescer in `server/services/notificationService.ts`.
 *
 * The single-PUT contact-owner reassignment route used to fire one
 * notification per contact, so reassigning 50 contacts one-by-one buried
 * the new owner in 50 emails. The coalescing helper:
 *   - Sends the *first* reassignment in a window immediately so single,
 *     occasional reassignments still feel snappy.
 *   - Buffers any further reassignments to the same recipient that arrive
 *     inside a 5-minute window into a single summary notification flushed
 *     when the window closes.
 *   - Tracks the set of distinct reassigners so the summary attributes the
 *     batch correctly (single name vs. "Teammates").
 *
 * The DB layer is mocked so the test stays hermetic.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const insertedNotifications: Array<Record<string, unknown>> = [];

vi.mock("../db", () => {
  return {
    db: {
      insert: () => ({
        values: (vals: Record<string, unknown>) => ({
          returning: async () => {
            insertedNotifications.push(vals);
            return [{ ...vals, id: `notif-${insertedNotifications.length}` }];
          },
        }),
      }),
    },
  };
});

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

import {
  queueContactReassignmentNotification,
  __flushContactReassignmentForTest,
  __resetContactReassignmentQueueForTest,
} from "../services/notificationService";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("queueContactReassignmentNotification (Task #715)", () => {
  beforeEach(() => {
    insertedNotifications.length = 0;
    __resetContactReassignmentQueueForTest();
  });

  it("sends a single reassignment immediately when nothing else is queued", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      organizationId: "org-1",
      reassignerName: "Alice",
      contactId: "contact-1",
      contactName: "Bob Buyer",
    });
    await flushMicrotasks();

    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({
      userId: "user-1",
      type: "CRM_CONTACT_REASSIGNED",
      title: "A CRM contact was assigned to you",
      message: "Alice assigned Bob Buyer to you.",
      relatedEntityId: "contact-1",
    });

    // No additional reassignments → flushing the window produces no follow-up.
    await __flushContactReassignmentForTest("user-1");
    expect(insertedNotifications).toHaveLength(1);
  });

  it("collapses many rapid reassignments into one immediate + one summary", async () => {
    for (let i = 0; i < 50; i += 1) {
      queueContactReassignmentNotification({
        recipientUserId: "user-1",
        organizationId: "org-1",
        reassignerName: "Alice",
        contactId: `contact-${i}`,
        contactName: `Contact ${i}`,
      });
    }
    await flushMicrotasks();

    // Only the very first one fires immediately.
    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({
      message: "Alice assigned Contact 0 to you.",
    });

    await __flushContactReassignmentForTest("user-1");

    // The remaining 49 collapse into a single summary notification.
    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1]).toMatchObject({
      userId: "user-1",
      type: "CRM_CONTACT_REASSIGNED",
      title: "49 more CRM contacts assigned to you",
      relatedEntityId: "contact-1",
    });
    expect(insertedNotifications[1].message).toContain("Alice assigned 49 more contacts");
  });

  it("uses singular noun when exactly one extra reassignment is coalesced", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "contact-a",
      contactName: "Contact A",
    });
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "contact-b",
      contactName: "Contact B",
    });
    await flushMicrotasks();
    await __flushContactReassignmentForTest("user-1");

    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1].title).toBe("1 more CRM contact assigned to you");
  });

  it("attributes the summary to 'Teammates' when multiple users reassign in the same window", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Bob",
      contactId: "c2",
      contactName: "C2",
    });
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Carol",
      contactId: "c3",
      contactName: "C3",
    });
    await flushMicrotasks();
    await __flushContactReassignmentForTest("user-1");

    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1].message).toMatch(/^Teammates assigned 2 more contacts/);
  });

  it("keeps separate windows per recipient", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    queueContactReassignmentNotification({
      recipientUserId: "user-2",
      reassignerName: "Alice",
      contactId: "c2",
      contactName: "C2",
    });
    await flushMicrotasks();

    // Both recipients get their immediate notification.
    expect(insertedNotifications).toHaveLength(2);
    const recipients = insertedNotifications.map((n) => n.userId).sort();
    expect(recipients).toEqual(["user-1", "user-2"]);

    // Pile more onto user-1 only.
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "c3",
      contactName: "C3",
    });
    await __flushContactReassignmentForTest("user-1");
    await __flushContactReassignmentForTest("user-2");

    // user-1 gets a summary; user-2 has no extras so no summary is sent.
    expect(insertedNotifications).toHaveLength(3);
    expect(insertedNotifications[2].userId).toBe("user-1");
    expect(insertedNotifications[2].title).toBe("1 more CRM contact assigned to you");
  });
});
