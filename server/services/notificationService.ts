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
// Task #715 + #722 + #723: coalesce rapid-fire single-entity owner
// reassignments so a new owner doesn't get one email per record when a
// teammate reassigns dozens of records one-by-one through the single PUT
// endpoints. The bulk endpoints already collapse into one notification; this
// helper gives the single-PUT path equivalent behaviour.
//
// Task #715 introduced the coalescer for CRM contacts. Task #723 generalised
// it across the other owner-change paths that suffered the same email-spam
// problem — CRM opportunities and projects — by parameterising on entity
// "kind" so each notification still routes to the correct destination and
// uses entity-appropriate copy.
//
// Strategy: send the *first* reassignment notification immediately so single,
// occasional reassignments still feel snappy. Open a 5-minute coalescing
// window per (kind, recipient); any further reassignments arriving inside
// that window are accumulated into a single summary notification flushed
// when the window closes.
//
// Persistence (Task #722, generalised in Task #723): the per-(kind,
// recipient) buffer lives in `pending_contact_reassignment_notifications` so
// a server restart inside the 5-minute window doesn't drop the bundled
// "extras" summary. The flush step uses `DELETE ... RETURNING` so when
// multiple instances run concurrently, only the instance that successfully
// claims the row sends the summary.
// ---------------------------------------------------------------------------

const REASSIGNMENT_COALESCE_WINDOW_MS = 5 * 60 * 1000;
const PENDING_TABLE = "pending_contact_reassignment_notifications";

export type ReassignmentKind = "contact" | "opportunity" | "project";

interface KindConfig {
  notificationType: NotificationRecord["type"];
  relatedEntityType: string;
  // "CRM contact", "CRM opportunity", "project"
  singularLabel: string;
  pluralLabel: string;
  // Title for the immediate one-off notification.
  immediateTitle: string;
  // Title prefix for the summary notification, used as `${prefix} ${noun}`.
  // For contacts the legacy copy injects an extra "CRM " before the noun, so
  // contact uses "CRM " in the noun via singularLabel/pluralLabel and the
  // summary template is shared.
  summaryIncludesNoun: true;
}

const KIND_CONFIG: Record<ReassignmentKind, KindConfig> = {
  contact: {
    notificationType: "CRM_CONTACT_REASSIGNED",
    relatedEntityType: "CRM_CONTACT",
    singularLabel: "CRM contact",
    pluralLabel: "CRM contacts",
    immediateTitle: "A CRM contact was assigned to you",
    summaryIncludesNoun: true,
  },
  opportunity: {
    notificationType: "CRM_OPPORTUNITY_REASSIGNED" as NotificationRecord["type"],
    relatedEntityType: "CRM_OPPORTUNITY",
    singularLabel: "CRM opportunity",
    pluralLabel: "CRM opportunities",
    immediateTitle: "A CRM opportunity was assigned to you",
    summaryIncludesNoun: true,
  },
  project: {
    notificationType: "PROJECT_REASSIGNED" as NotificationRecord["type"],
    relatedEntityType: "PROJECT",
    singularLabel: "project",
    pluralLabel: "projects",
    immediateTitle: "A project was assigned to you",
    summaryIncludesNoun: true,
  },
};

// Per-process map of scheduled flush timers. The DB row is the source of
// truth; this map only avoids stacking up redundant local timers and lets
// tests cancel pending timers deterministically.
const localFlushTimers = new Map<string, NodeJS.Timeout>();

function pendingKey(kind: ReassignmentKind, recipientUserId: string): string {
  return `${kind}:${recipientUserId}`;
}

export interface QueueReassignmentArgs {
  kind: ReassignmentKind;
  recipientUserId: string;
  organizationId?: string;
  reassignerName: string;
  entityId: string;
  // Display name used in the immediate notification message
  // (e.g. contact full name, opportunity name, project name).
  entityName: string;
}

interface PendingRow {
  kind: ReassignmentKind;
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

async function upsertPendingRow(args: QueueReassignmentArgs): Promise<UpsertResult> {
  const result = await pool.query<{ inserted: boolean; flush_at: Date }>(
    `
    INSERT INTO ${PENDING_TABLE}
      (kind, recipient_user_id, organization_id, additional_count, reassigner_names,
       first_additional_contact_id, window_started_at, flush_at)
    VALUES
      ($1, $2, $3, 0, ARRAY[]::text[], NULL, NOW(),
       NOW() + INTERVAL '${REASSIGNMENT_COALESCE_WINDOW_MS} milliseconds')
    ON CONFLICT (kind, recipient_user_id) DO UPDATE SET
      additional_count = ${PENDING_TABLE}.additional_count + 1,
      reassigner_names = CASE
        WHEN $4::text = ANY(${PENDING_TABLE}.reassigner_names)
          THEN ${PENDING_TABLE}.reassigner_names
        ELSE array_append(${PENDING_TABLE}.reassigner_names, $4::text)
      END,
      first_additional_contact_id = COALESCE(
        ${PENDING_TABLE}.first_additional_contact_id, $5
      ),
      organization_id = COALESCE(${PENDING_TABLE}.organization_id, $3)
    RETURNING (xmax = 0) AS inserted, flush_at
    `,
    [
      args.kind,
      args.recipientUserId,
      args.organizationId ?? null,
      args.reassignerName,
      args.entityId,
    ],
  );
  const row = result.rows[0];
  return { inserted: row.inserted, flushAt: row.flush_at };
}

async function claimPendingRow(
  kind: ReassignmentKind,
  recipientUserId: string,
): Promise<PendingRow | null> {
  const result = await pool.query<PendingRow>(
    `DELETE FROM ${PENDING_TABLE} WHERE kind = $1 AND recipient_user_id = $2 RETURNING *`,
    [kind, recipientUserId],
  );
  return result.rows[0] ?? null;
}

function scheduleLocalFlush(
  kind: ReassignmentKind,
  recipientUserId: string,
  flushAt: Date,
): void {
  const key = pendingKey(kind, recipientUserId);
  if (localFlushTimers.has(key)) return;
  const delay = Math.max(0, flushAt.getTime() - Date.now());
  const timer = setTimeout(() => {
    localFlushTimers.delete(key);
    flushPendingReassignment(kind, recipientUserId).catch((err) => {
      logError(
        "Failed to flush pending owner reassignment summary",
        { kind, recipientUserId },
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  localFlushTimers.set(key, timer);
}

export function queueOwnerReassignmentNotification(args: QueueReassignmentArgs): void {
  // Run async work in the background; callers (route handlers) shouldn't have
  // to await coalescer bookkeeping.
  void (async () => {
    try {
      const cfg = KIND_CONFIG[args.kind];
      const { inserted, flushAt } = await upsertPendingRow(args);
      if (inserted) {
        // First reassignment in the window — fire the immediate notification
        // straight away so single, occasional reassignments still feel snappy.
        await insertNotification({
          userId: args.recipientUserId,
          organizationId: args.organizationId,
          type: cfg.notificationType,
          title: cfg.immediateTitle,
          message: `${args.reassignerName} assigned ${args.entityName} to you.`,
          relatedEntityId: args.entityId,
          relatedEntityType: cfg.relatedEntityType,
        });
      }
      scheduleLocalFlush(args.kind, args.recipientUserId, flushAt);
    } catch (err) {
      logError(
        "Failed to queue owner reassignment notification",
        { kind: args.kind, recipientUserId: args.recipientUserId },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  })();
}

// Backwards-compatible wrapper for the original Task #715 contact path.
export interface QueueContactReassignmentArgs {
  recipientUserId: string;
  organizationId?: string;
  reassignerName: string;
  contactId: string;
  contactName: string;
}

export function queueContactReassignmentNotification(args: QueueContactReassignmentArgs): void {
  queueOwnerReassignmentNotification({
    kind: "contact",
    recipientUserId: args.recipientUserId,
    organizationId: args.organizationId,
    reassignerName: args.reassignerName,
    entityId: args.contactId,
    entityName: args.contactName,
  });
}

async function flushPendingReassignment(
  kind: ReassignmentKind,
  recipientUserId: string,
): Promise<void> {
  // Atomic claim — if another instance already grabbed and flushed this row
  // we get nothing back and quietly stop, preventing duplicate summaries.
  const entry = await claimPendingRow(kind, recipientUserId);
  if (!entry) return;
  if (entry.additional_count === 0) return;

  const cfg = KIND_CONFIG[kind];
  const count = entry.additional_count;
  const noun = count === 1 ? cfg.singularLabel : cfg.pluralLabel;
  const reassigners = entry.reassigner_names ?? [];
  const reassignerName = reassigners.length === 1 ? reassigners[0] : "Teammates";

  await insertNotification({
    userId: recipientUserId,
    organizationId: entry.organization_id ?? undefined,
    type: cfg.notificationType,
    title: `${count} more ${noun} assigned to you`,
    message: `${reassignerName} assigned ${count} more ${noun} to you in the last few minutes.`,
    relatedEntityId: entry.first_additional_contact_id,
    relatedEntityType: cfg.relatedEntityType,
  });
}

// Task #730: belt-and-braces sweeper. The in-process timer + restart recovery
// covers the common path, but a row could be orphaned if (a) the server is
// shut down for longer than the coalescing window and the recovery hook
// silently fails, or (b) a hot redeploy drops timers without the new instance
// observing them. This periodic sweep claims any rows whose flush_at is well
// past so the bundled summary still goes out. Uses the same atomic
// `DELETE ... RETURNING` claim as the timer-driven path so it's safe to run
// alongside other instances or a concurrent timer fire.
const STALE_REASSIGNMENT_THRESHOLD_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
let sweeperInterval: NodeJS.Timeout | null = null;

export async function sweepStaleContactReassignments(
  thresholdMs: number = STALE_REASSIGNMENT_THRESHOLD_MS,
): Promise<number> {
  let staleRows: Array<{ kind: ReassignmentKind; recipient_user_id: string }> = [];
  try {
    const { rows } = await pool.query<{ kind: string; recipient_user_id: string }>(
      `SELECT kind, recipient_user_id FROM ${PENDING_TABLE}
       WHERE flush_at < NOW() - ($1::bigint || ' milliseconds')::interval`,
      [thresholdMs],
    );
    staleRows = rows.map((r) => ({
      kind: r.kind as ReassignmentKind,
      recipient_user_id: r.recipient_user_id,
    }));
  } catch (err) {
    logError(
      "Failed to scan for stale owner reassignment buffers",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return 0;
  }

  if (staleRows.length === 0) return 0;

  let claimed = 0;
  for (const { kind, recipient_user_id: recipientUserId } of staleRows) {
    // Cancel any local timer so we don't race ourselves between the sweeper
    // and a still-armed setTimeout that's about to fire anyway.
    const key = pendingKey(kind, recipientUserId);
    const timer = localFlushTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      localFlushTimers.delete(key);
    }
    try {
      const entry = await claimPendingRow(kind, recipientUserId);
      if (!entry) continue; // another instance / timer beat us to it
      claimed += 1;
      if (entry.additional_count === 0) continue;

      const cfg = KIND_CONFIG[kind];
      const count = entry.additional_count;
      const noun = count === 1 ? cfg.singularLabel : cfg.pluralLabel;
      const reassigners = entry.reassigner_names ?? [];
      const reassignerName = reassigners.length === 1 ? reassigners[0] : "Teammates";

      await insertNotification({
        userId: recipientUserId,
        organizationId: entry.organization_id ?? undefined,
        type: cfg.notificationType,
        title: `${count} more ${noun} assigned to you`,
        message: `${reassignerName} assigned ${count} more ${noun} to you in the last few minutes.`,
        relatedEntityId: entry.first_additional_contact_id,
        relatedEntityType: cfg.relatedEntityType,
      });
    } catch (err) {
      logError(
        "Failed to flush stale owner reassignment buffer",
        { kind, recipientUserId },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  if (claimed > 0) {
    console.log(
      `[notifications] Swept ${claimed} stale owner reassignment buffer(s) past flush_at`,
    );
  }
  return claimed;
}

export function startContactReassignmentSweeper(intervalMs: number = SWEEP_INTERVAL_MS): void {
  if (sweeperInterval) return;
  sweeperInterval = setInterval(() => {
    sweepStaleContactReassignments().catch((err) => {
      logError(
        "Stale CRM contact reassignment sweeper failed",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }, intervalMs);
  if (typeof sweeperInterval.unref === "function") sweeperInterval.unref();
}

export function __stopContactReassignmentSweeperForTest(): void {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
  }
}

// On startup, re-arm timers for any rows still buffered from before the
// restart so the bundled summary is delivered even if the server crashed
// inside the coalescing window.
export async function recoverPendingContactReassignments(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      kind: string;
      recipient_user_id: string;
      flush_at: Date;
    }>(
      `SELECT kind, recipient_user_id, flush_at FROM ${PENDING_TABLE}`,
    );
    for (const row of rows) {
      scheduleLocalFlush(row.kind as ReassignmentKind, row.recipient_user_id, row.flush_at);
    }
    if (rows.length > 0) {
      console.log(
        `[notifications] Recovered ${rows.length} pending owner reassignment buffer(s) after restart`,
      );
    }
  } catch (err) {
    logError(
      "Failed to recover pending owner reassignment buffers",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

// Test-only helpers so unit tests can exercise the coalescer without waiting
// the real five minutes.
export async function __flushReassignmentForTest(
  kind: ReassignmentKind,
  recipientUserId: string,
): Promise<void> {
  const key = pendingKey(kind, recipientUserId);
  const timer = localFlushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    localFlushTimers.delete(key);
  }
  await flushPendingReassignment(kind, recipientUserId);
}

export async function __flushContactReassignmentForTest(recipientUserId: string): Promise<void> {
  await __flushReassignmentForTest("contact", recipientUserId);
}

export function __resetReassignmentQueueForTest(): void {
  localFlushTimers.forEach((timer) => clearTimeout(timer));
  localFlushTimers.clear();
}

export function __resetContactReassignmentQueueForTest(): void {
  __resetReassignmentQueueForTest();
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
