export type SyncEntityType =
  | "DAILY_REPORT"
  | "TIME_CLOCK_EVENT"
  | "PHOTO"
  | "PUNCH_ITEM"
  | "RFI"
  | "INSPECTION"
  | "DRAWING_MARKUP"
  | "HAUL_TICKET"
  | "INSPECTOR_REPORT"
  | "SWPPP_INSPECTION"
  // Task #1599: pulled submittals + the current user's open review
  // assignments + offline-queued review stamps from the mobile
  // reviewer. SUBMITTAL/SUBMITTAL_REVIEW are pull-only cache rows;
  // SUBMITTAL_STAMP outbox rows carry stamp actions (APPROVED /
  // APPROVED_AS_NOTED / REJECTED / REVISE_AND_RESUBMIT) keyed to a
  // submittal review id resolved from the cached review list, so the
  // field user never types a UUID.
  | "SUBMITTAL"
  | "SUBMITTAL_REVIEW"
  | "SUBMITTAL_STAMP"
  // Task #2497: barcode/QR-driven inventory operations posted from the
  // warehouse/yard scan screen. These are pushed directly to the
  // /api/inventory/{receive,issue,transfer} REST endpoints by
  // pushInventory() in the sync coordinator (they are NOT routed through
  // the unified /api/ai-features/mobile/sync envelope, which has no
  // inventory section). Using the existing outbox table keeps offline
  // semantics, retry behavior, and the SyncStatusBar pending count
  // consistent with every other field action.
  | "INVENTORY_RECEIPT"
  | "INVENTORY_ISSUE"
  | "INVENTORY_TRANSFER"
  // Task #3098: jobsite-reported equipment maintenance requests. Pushed by
  // pushMaintenance() in the sync coordinator directly to
  // /api/equipment/:equipmentId/maintenance-requests after attachments
  // (photos) are uploaded via the signed-PUT path. Like the inventory
  // entity types, this is NOT routed through the unified mobile sync
  // envelope; the dedicated endpoint keeps cross-tenant auth, severity
  // validation, and equipment-status side-effects in one place.
  | "MAINT_REQUEST"
  // Task #3095: status / comment updates a field worker makes against a
  // task assigned to them. Pushed directly to /api/tasks/:id (PATCH) or
  // /api/tasks/:id/comments (POST) by pushTaskUpdates() — not routed
  // through the unified mobile sync envelope (the server's /mobile/sync
  // contract has no tasks section). Payload shape:
  //   { kind: "STATUS", taskId, status, dismissReason? }
  //   { kind: "COMMENT", taskId, content }
  | "TASK_UPDATE";

export type SyncOperation = "CREATE" | "UPDATE" | "DELETE";

export interface OutboxRecord {
  localId: string;
  entityType: SyncEntityType;
  operation: SyncOperation;
  serverId?: string | null;
  payload: Record<string, unknown>;
  attachments?: Array<{
    localId: string;
    uri: string;
    mime: string;
    name: string;
    size?: number;
  }>;
  clientTimestamp: string;
  // Task #2693: Lamport logical clock — incremented per mutation on the device,
  // persisted in sync_meta. The server records it on mobile_sync_events but
  // uses it only to break wall-clock ties, not as the sole ordering criterion.
  logicalClock?: number;
  status: "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";
  retryCount: number;
  lastError?: string | null;
  conflictServerUpdatedAt?: string | null;
}
