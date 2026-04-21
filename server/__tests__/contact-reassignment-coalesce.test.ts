/**
 * Task #715 + #722: regression tests for the rapid-fire CRM contact
 * reassignment coalescer in `server/services/notificationService.ts`.
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
 *   - Persists the buffer in Postgres (Task #722) so a restart inside the
 *     window doesn't drop the bundled summary, and uses an atomic
 *     `DELETE ... RETURNING` claim so concurrent instances don't double-fire.
 *
 * The DB layer is mocked so the test stays hermetic — `db.insert` records the
 * notifications written, and `pool.query` simulates the persistent
 * pending-buffer table.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const insertedNotifications: Array<Record<string, unknown>> = [];

interface PendingRow {
  kind: string;
  recipient_user_id: string;
  organization_id: string | null;
  additional_count: number;
  reassigner_names: string[];
  first_additional_contact_id: string | null;
  flush_at: Date;
}
const pendingRows = new Map<string, PendingRow>();
const rowKey = (kind: string, recipientUserId: string) => `${kind}:${recipientUserId}`;

function poolQuery(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
  const text = sql.trim();
  if (text.startsWith("INSERT INTO pending_contact_reassignment_notifications")) {
    const [kind, recipientUserId, organizationId, reassignerName, contactId] = params as [
      string,
      string,
      string | null,
      string,
      string,
    ];
    const key = rowKey(kind, recipientUserId);
    const existing = pendingRows.get(key);
    if (!existing) {
      const row: PendingRow = {
        kind,
        recipient_user_id: recipientUserId,
        organization_id: organizationId,
        additional_count: 0,
        reassigner_names: [],
        first_additional_contact_id: null,
        flush_at: new Date(Date.now() + 5 * 60 * 1000),
      };
      pendingRows.set(key, row);
      return Promise.resolve({ rows: [{ inserted: true, flush_at: row.flush_at }] });
    }
    existing.additional_count += 1;
    if (!existing.reassigner_names.includes(reassignerName)) {
      existing.reassigner_names.push(reassignerName);
    }
    if (!existing.first_additional_contact_id) {
      existing.first_additional_contact_id = contactId;
    }
    if (!existing.organization_id && organizationId) {
      existing.organization_id = organizationId;
    }
    return Promise.resolve({ rows: [{ inserted: false, flush_at: existing.flush_at }] });
  }
  if (text.startsWith("DELETE FROM pending_contact_reassignment_notifications")) {
    const [kind, recipientUserId] = params as [string, string];
    const key = rowKey(kind, recipientUserId);
    const row = pendingRows.get(key);
    if (!row) return Promise.resolve({ rows: [] });
    pendingRows.delete(key);
    return Promise.resolve({ rows: [row] });
  }
  if (text.startsWith("SELECT kind, recipient_user_id FROM pending_contact_reassignment_notifications")) {
    const [thresholdMs] = params as [number];
    const cutoff = Date.now() - Number(thresholdMs);
    return Promise.resolve({
      rows: Array.from(pendingRows.values())
        .filter((r) => r.flush_at.getTime() < cutoff)
        .map((r) => ({ kind: r.kind, recipient_user_id: r.recipient_user_id })),
    });
  }
  if (text.startsWith("SELECT kind, recipient_user_id, flush_at FROM pending_contact_reassignment_notifications")) {
    return Promise.resolve({
      rows: Array.from(pendingRows.values()).map((r) => ({
        kind: r.kind,
        recipient_user_id: r.recipient_user_id,
        flush_at: r.flush_at,
      })),
    });
  }
  return Promise.resolve({ rows: [] });
}

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
    pool: {
      query: poolQuery,
    },
  };
});

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

import {
  queueContactReassignmentNotification,
  queueOwnerReassignmentNotification,
  __flushContactReassignmentForTest,
  __flushReassignmentForTest,
  __resetContactReassignmentQueueForTest,
  recoverPendingContactReassignments,
  sweepStaleContactReassignments,
} from "../services/notificationService";

function flushMicrotasks(): Promise<void> {
  // Two ticks so the queue helper's IIFE (which `await`s the pool upsert and
  // then the immediate insertNotification) fully settles before assertions.
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

describe("queueContactReassignmentNotification (Task #715 + #722)", () => {
  beforeEach(() => {
    insertedNotifications.length = 0;
    pendingRows.clear();
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
      await flushMicrotasks();
    }

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
    expect(insertedNotifications[1].message).toContain("Alice assigned 49 more CRM contacts");
  });

  it("uses singular noun when exactly one extra reassignment is coalesced", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "contact-a",
      contactName: "Contact A",
    });
    await flushMicrotasks();
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
    for (const args of [
      { reassignerName: "Alice", contactId: "c1", contactName: "C1" },
      { reassignerName: "Bob", contactId: "c2", contactName: "C2" },
      { reassignerName: "Carol", contactId: "c3", contactName: "C3" },
    ]) {
      queueContactReassignmentNotification({ recipientUserId: "user-1", ...args });
      await flushMicrotasks();
    }
    await __flushContactReassignmentForTest("user-1");

    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1].message).toMatch(/^Teammates assigned 2 more CRM contacts/);
  });

  it("collapses opportunity reassignments using opportunity-flavored copy (Task #723)", async () => {
    for (let i = 0; i < 10; i += 1) {
      queueOwnerReassignmentNotification({
        kind: "opportunity",
        recipientUserId: "user-9",
        organizationId: "org-1",
        reassignerName: "Alice",
        entityId: `opp-${i}`,
        entityName: `Opportunity ${i}`,
      });
    }
    await flushMicrotasks();

    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({
      userId: "user-9",
      type: "CRM_OPPORTUNITY_REASSIGNED",
      title: "A CRM opportunity was assigned to you",
      relatedEntityType: "CRM_OPPORTUNITY",
      relatedEntityId: "opp-0",
    });

    await __flushReassignmentForTest("opportunity", "user-9");
    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1]).toMatchObject({
      type: "CRM_OPPORTUNITY_REASSIGNED",
      title: "9 more CRM opportunities assigned to you",
    });
  });

  it("collapses project reassignments using project-flavored copy (Task #723)", async () => {
    for (let i = 0; i < 5; i += 1) {
      queueOwnerReassignmentNotification({
        kind: "project",
        recipientUserId: "user-7",
        organizationId: "org-1",
        reassignerName: "Alice",
        entityId: `proj-${i}`,
        entityName: `Project ${i}`,
      });
    }
    await flushMicrotasks();

    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({
      userId: "user-7",
      type: "PROJECT_REASSIGNED",
      title: "A project was assigned to you",
      relatedEntityType: "PROJECT",
      relatedEntityId: "proj-0",
    });

    await __flushReassignmentForTest("project", "user-7");
    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1]).toMatchObject({
      type: "PROJECT_REASSIGNED",
      title: "4 more projects assigned to you",
    });
  });

  it("keeps separate coalescing windows per (kind, recipient) (Task #723)", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-x",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    queueOwnerReassignmentNotification({
      kind: "opportunity",
      recipientUserId: "user-x",
      reassignerName: "Alice",
      entityId: "o1",
      entityName: "O1",
    });
    queueOwnerReassignmentNotification({
      kind: "project",
      recipientUserId: "user-x",
      reassignerName: "Alice",
      entityId: "p1",
      entityName: "P1",
    });
    await flushMicrotasks();

    // Each kind has its own immediate notification (3 different first-in-window).
    expect(insertedNotifications).toHaveLength(3);
    const types = insertedNotifications.map((n) => n.type).sort();
    expect(types).toEqual([
      "CRM_CONTACT_REASSIGNED",
      "CRM_OPPORTUNITY_REASSIGNED",
      "PROJECT_REASSIGNED",
    ]);
  });

  it("keeps separate windows per recipient", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-1",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    await flushMicrotasks();
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
    await flushMicrotasks();
    await __flushContactReassignmentForTest("user-1");
    await __flushContactReassignmentForTest("user-2");

    // user-1 gets a summary; user-2 has no extras so no summary is sent.
    expect(insertedNotifications).toHaveLength(3);
    expect(insertedNotifications[2].userId).toBe("user-1");
    expect(insertedNotifications[2].title).toBe("1 more CRM contact assigned to you");
  });

  it("survives a server restart and still flushes the bundled summary (Task #722)", async () => {
    // Simulate the buffered state of a previous process: an immediate
    // notification was already sent for contact-0 and several extras were
    // accumulated before the crash.
    queueContactReassignmentNotification({
      recipientUserId: "user-restart",
      reassignerName: "Alice",
      contactId: "contact-0",
      contactName: "Contact 0",
    });
    await flushMicrotasks();
    for (let i = 1; i <= 5; i += 1) {
      queueContactReassignmentNotification({
        recipientUserId: "user-restart",
        reassignerName: "Alice",
        contactId: `contact-${i}`,
        contactName: `Contact ${i}`,
      });
      await flushMicrotasks();
    }

    // Restart: forget all in-process timers but keep the persisted DB rows.
    __resetContactReassignmentQueueForTest();

    // Recovery on the new process re-arms a flush timer; explicitly trigger it.
    await recoverPendingContactReassignments();
    await __flushContactReassignmentForTest("user-restart");

    // Expect the immediate (1) + the post-restart bundled summary (1) = 2.
    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1]).toMatchObject({
      userId: "user-restart",
      title: "5 more CRM contacts assigned to you",
      relatedEntityId: "contact-1",
    });
  });

  it("does not double-fire the summary when two instances race the flush (Task #722)", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-race",
      reassignerName: "Alice",
      contactId: "c0",
      contactName: "C0",
    });
    await flushMicrotasks();
    queueContactReassignmentNotification({
      recipientUserId: "user-race",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    await flushMicrotasks();

    // Two concurrent flush attempts (e.g. two app instances both reaching the
    // 5-minute mark) — only one should successfully claim the row.
    await Promise.all([
      __flushContactReassignmentForTest("user-race"),
      __flushContactReassignmentForTest("user-race"),
    ]);

    // 1 immediate + 1 summary = 2 total, never 3.
    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1].title).toBe("1 more CRM contact assigned to you");
  });

  it("sweeps stale buffers whose flush_at is past the threshold (Task #730)", async () => {
    // Buffer two extras for a recipient.
    queueContactReassignmentNotification({
      recipientUserId: "user-stale",
      reassignerName: "Alice",
      contactId: "c0",
      contactName: "C0",
    });
    await flushMicrotasks();
    queueContactReassignmentNotification({
      recipientUserId: "user-stale",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    queueContactReassignmentNotification({
      recipientUserId: "user-stale",
      reassignerName: "Alice",
      contactId: "c2",
      contactName: "C2",
    });
    await flushMicrotasks();

    // Simulate a server that was down past the coalescing window: backdate
    // flush_at and wipe local timers so only the sweeper can recover the row.
    const row = pendingRows.get("contact:user-stale")!;
    row.flush_at = new Date(Date.now() - 30 * 60 * 1000);
    __resetContactReassignmentQueueForTest();

    const claimed = await sweepStaleContactReassignments();
    expect(claimed).toBe(1);
    expect(pendingRows.has("contact:user-stale")).toBe(false);

    // 1 immediate + 1 swept summary = 2.
    expect(insertedNotifications).toHaveLength(2);
    expect(insertedNotifications[1]).toMatchObject({
      userId: "user-stale",
      title: "2 more CRM contacts assigned to you",
    });
  });

  it("ignores buffers whose flush_at is still within the threshold (Task #730)", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-fresh",
      reassignerName: "Alice",
      contactId: "c0",
      contactName: "C0",
    });
    await flushMicrotasks();
    queueContactReassignmentNotification({
      recipientUserId: "user-fresh",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    await flushMicrotasks();

    const claimed = await sweepStaleContactReassignments();
    expect(claimed).toBe(0);
    // Buffer is still there for the regular timer-driven flush.
    expect(pendingRows.has("contact:user-fresh")).toBe(true);
  });

  it("sweeper is safe under concurrent invocations (Task #730)", async () => {
    queueContactReassignmentNotification({
      recipientUserId: "user-race-sweep",
      reassignerName: "Alice",
      contactId: "c0",
      contactName: "C0",
    });
    await flushMicrotasks();
    queueContactReassignmentNotification({
      recipientUserId: "user-race-sweep",
      reassignerName: "Alice",
      contactId: "c1",
      contactName: "C1",
    });
    await flushMicrotasks();
    pendingRows.get("contact:user-race-sweep")!.flush_at = new Date(Date.now() - 30 * 60 * 1000);
    __resetContactReassignmentQueueForTest();

    const [a, b] = await Promise.all([
      sweepStaleContactReassignments(),
      sweepStaleContactReassignments(),
    ]);
    // Exactly one sweeper claims the row.
    expect(a + b).toBe(1);
    expect(insertedNotifications).toHaveLength(2);
  });
});
