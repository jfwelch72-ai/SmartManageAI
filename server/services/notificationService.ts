import { db, pool } from "../db";
import { notifications, type InsertNotification } from "@shared/schema";
import { deliverNotification, type NotificationRecord } from "./notificationDelivery";
import { logError } from "../utils/logger";

export async function insertNotification(values: InsertNotification): Promise<void> {
  const [inserted] = await db.insert(notifications).values(values).returning();
  if (inserted) {
    const record: NotificationRecord = {
      id: inserted.id,
      userId: inserted.userId,
      type: inserted.type as NotificationRecord["type"],
      title: inserted.title,
      message: inserted.message,
      relatedEntityId: inserted.relatedEntityId,
      relatedEntityType: inserted.relatedEntityType,
    };
    setImmediate(() => {
      deliverNotification(record).catch(() => undefined);
    });
  }
}

// ---------------------------------------------------------------------------
// Task #715 + #722: coalesce rapid-fire single-contact CRM reassignments so a
// new owner doesn't get one email per contact when a teammate reassigns dozens
// of contacts one-by-one through the single PUT endpoint. The bulk endpoint
// already collapses into one notification; this helper gives the single-PUT
// path equivalent behaviour.
//
// Strategy: send the *first* reassignment notification immediately so single,
// occasional reassignments still feel snappy. Open a 5-minute coalescing
// window per recipient; any further reassignments arriving inside that window
// are accumulated into a single summary notification flushed when the window
// closes.
//
// Persistence (Task #722): the per-recipient buffer lives in
// `pending_contact_reassignment_notifications` so a server restart inside the
// 5-minute window doesn't drop the bundled "extras" summary. The flush step
// uses `DELETE ... RETURNING` so when multiple instances run concurrently,
// only the instance that successfully claims the row sends the summary.
// ---------------------------------------------------------------------------

const REASSIGNMENT_COALESCE_WINDOW_MS = 5 * 60 * 1000;
const PENDING_TABLE = "pending_contact_reassignment_notifications";

// Per-process map of scheduled flush timers. The DB row is the source of
// truth; this map only avoids stacking up redundant local timers and lets
// tests cancel pending timers deterministically.
const localFlushTimers = new Map<string, NodeJS.Timeout>();

export interface QueueContactReassignmentArgs {
  recipientUserId: string;
  organizationId?: string;
  reassignerName: string;
  contactId: string;
  contactName: string;
}

interface PendingRow {
  recipient_user_id: string;
  organization_id: string | null;
  additional_count: number;
  reassigner_names: string[];
  first_additional_contact_id: string | null;
  flush_at: Date;
}

interface UpsertResult {
  inserted: boolean;
  flushAt: Date;
}

async function upsertPendingRow(args: QueueContactReassignmentArgs): Promise<UpsertResult> {
  const result = await pool.query<{ inserted: boolean; flush_at: Date }>(
    `
    INSERT INTO ${PENDING_TABLE}
      (recipient_user_id, organization_id, additional_count, reassigner_names,
       first_additional_contact_id, window_started_at, flush_at)
    VALUES
      ($1, $2, 0, ARRAY[]::text[], NULL, NOW(),
       NOW() + INTERVAL '${REASSIGNMENT_COALESCE_WINDOW_MS} milliseconds')
    ON CONFLICT (recipient_user_id) DO UPDATE SET
      additional_count = ${PENDING_TABLE}.additional_count + 1,
      reassigner_names = CASE
        WHEN $3::text = ANY(${PENDING_TABLE}.reassigner_names)
          THEN ${PENDING_TABLE}.reassigner_names
        ELSE array_append(${PENDING_TABLE}.reassigner_names, $3::text)
      END,
      first_additional_contact_id = COALESCE(
        ${PENDING_TABLE}.first_additional_contact_id, $4
      ),
      organization_id = COALESCE(${PENDING_TABLE}.organization_id, $2)
    RETURNING (xmax = 0) AS inserted, flush_at
    `,
    [args.recipientUserId, args.organizationId ?? null, args.reassignerName, args.contactId],
  );
  const row = result.rows[0];
  return { inserted: row.inserted, flushAt: row.flush_at };
}

async function claimPendingRow(recipientUserId: string): Promise<PendingRow | null> {
  const result = await pool.query<PendingRow>(
    `DELETE FROM ${PENDING_TABLE} WHERE recipient_user_id = $1 RETURNING *`,
    [recipientUserId],
  );
  return result.rows[0] ?? null;
}

function scheduleLocalFlush(recipientUserId: string, flushAt: Date): void {
  if (localFlushTimers.has(recipientUserId)) return;
  const delay = Math.max(0, flushAt.getTime() - Date.now());
  const timer = setTimeout(() => {
    localFlushTimers.delete(recipientUserId);
    flushPendingReassignment(recipientUserId).catch((err) => {
      logError(
        "Failed to flush pending CRM contact reassignment summary",
        { recipientUserId },
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  localFlushTimers.set(recipientUserId, timer);
}

export function queueContactReassignmentNotification(args: QueueContactReassignmentArgs): void {
  // Run async work in the background; callers (route handlers) shouldn't have
  // to await coalescer bookkeeping.
  void (async () => {
    try {
      const { inserted, flushAt } = await upsertPendingRow(args);
      if (inserted) {
        // First reassignment in the window — fire the immediate notification
        // straight away so single, occasional reassignments still feel snappy.
        await insertNotification({
          userId: args.recipientUserId,
          organizationId: args.organizationId,
          type: "CRM_CONTACT_REASSIGNED",
          title: "A CRM contact was assigned to you",
          message: `${args.reassignerName} assigned ${args.contactName} to you.`,
          relatedEntityId: args.contactId,
          relatedEntityType: "CRM_CONTACT",
        });
      }
      scheduleLocalFlush(args.recipientUserId, flushAt);
    } catch (err) {
      logError(
        "Failed to queue CRM contact reassignment notification",
        { recipientUserId: args.recipientUserId },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  })();
}

async function flushPendingReassignment(recipientUserId: string): Promise<void> {
  // Atomic claim — if another instance already grabbed and flushed this row
  // we get nothing back and quietly stop, preventing duplicate summaries.
  const entry = await claimPendingRow(recipientUserId);
  if (!entry) return;
  if (entry.additional_count === 0) return;

  const count = entry.additional_count;
  const noun = count === 1 ? "contact" : "contacts";
  const reassigners = entry.reassigner_names ?? [];
  const reassignerName = reassigners.length === 1 ? reassigners[0] : "Teammates";

  await insertNotification({
    userId: recipientUserId,
    organizationId: entry.organization_id ?? undefined,
    type: "CRM_CONTACT_REASSIGNED",
    title: `${count} more CRM ${noun} assigned to you`,
    message: `${reassignerName} assigned ${count} more ${noun} to you in the last few minutes. Review them in the CRM.`,
    relatedEntityId: entry.first_additional_contact_id,
    relatedEntityType: "CRM_CONTACT",
  });
}

// On startup, re-arm timers for any rows still buffered from before the
// restart so the bundled summary is delivered even if the server crashed
// inside the coalescing window.
export async function recoverPendingContactReassignments(): Promise<void> {
  try {
    const { rows } = await pool.query<{ recipient_user_id: string; flush_at: Date }>(
      `SELECT recipient_user_id, flush_at FROM ${PENDING_TABLE}`,
    );
    for (const row of rows) {
      scheduleLocalFlush(row.recipient_user_id, row.flush_at);
    }
    if (rows.length > 0) {
      console.log(
        `[notifications] Recovered ${rows.length} pending CRM contact reassignment buffer(s) after restart`,
      );
    }
  } catch (err) {
    logError(
      "Failed to recover pending CRM contact reassignment buffers",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

// Test-only helpers so unit tests can exercise the coalescer without waiting
// the real five minutes.
export async function __flushContactReassignmentForTest(recipientUserId: string): Promise<void> {
  const timer = localFlushTimers.get(recipientUserId);
  if (timer) {
    clearTimeout(timer);
    localFlushTimers.delete(recipientUserId);
  }
  await flushPendingReassignment(recipientUserId);
}

export function __resetContactReassignmentQueueForTest(): void {
  localFlushTimers.forEach((timer) => clearTimeout(timer));
  localFlushTimers.clear();
}

export async function insertNotifications(valuesList: InsertNotification[]): Promise<void> {
  if (valuesList.length === 0) return;
  const inserted = await db.insert(notifications).values(valuesList).returning();
  if (inserted.length > 0) {
    const records: NotificationRecord[] = inserted.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type as NotificationRecord["type"],
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId,
      relatedEntityType: n.relatedEntityType,
    }));
    setImmediate(() => {
      Promise.allSettled(records.map((r) => deliverNotification(r))).catch(() => undefined);
    });
  }
}
