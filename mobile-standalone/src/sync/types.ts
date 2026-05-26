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
  | "TASK_UPDATE"
  // Safety incidents reported on-the-spot from the field. Pushed through
  // the unified mobile sync envelope (changes.safetyIncidents) and
  // persisted server-side into osha_incidents with sensible defaults so
  // office staff can complete the OSHA-grade record in the web app.
  | "SAFETY_INCIDENT"
  // Task #3090: Field-app Time & Materials tickets. CREATE-only from the
  // mobile outbox today (edit/void is web-only). Pushed by pushTmTickets()
  // in the sync coordinator via a 3-step flow (create → submit →
  // client-signoff) against the existing web endpoints; not routed through
  // the unified mobile sync envelope.
  | "TM_TICKET"
  // Task #3099: field-originated purchase request. Pushed directly to
  // /api/procurement-module/requests by pushMaterialRequests() in the
  // sync coordinator (not via the unified mobile sync envelope, which
  // has no procurement section). The coordinator follows up with
  // /requests/:id/submit so the office sees the row as
  // PENDING_APPROVAL instead of stuck in DRAFT.
  | "MATERIAL_REQUEST"
  // Task #3097: per-equipment meter-hour entries logged from the
  // jobsite. Pushed by pushEquipmentHours() to
  // POST /api/equipment/{equipmentId}/hour-logs (NOT through the
  // unified mobile sync envelope, same pattern as INVENTORY_*).
  // The payload carries equipmentId in addition to the body fields
  // the REST endpoint expects (projectId, weekStartDate,
  // weekEndDate, startingHours, endingHours, notes, fuelUsed).
  // Attachments (meter photo) are uploaded first via the signed-
  // URL helper and the resulting objectKey is appended to `notes`
  // as `[Meter photo: <key>]` so the office can pull it from
  // object storage — the server endpoint has no first-class photo
  // field today.
  | "EQUIPMENT_HOUR_LOG"
  // Task #3094: outgoing chat message from the mobile messaging UI.
  // Pushed directly to POST /api/conversations/:id/messages by
  // pushMessages() in the sync coordinator — not routed through the
  // unified mobile sync envelope (the server-side handler is part of
  // the web messaging system, not mobileSyncRoutes).
  | "MESSAGE"
  // Task #3100: jobsite delivery-receipt confirmations against an open PO.
  // Pushed by pushDeliveryReceipts() directly to
  // /api/procurement-module/orders/:poId/receipts after attachments are
  // uploaded via the signed-PUT path. Like inventory and maintenance, this
  // bypasses the unified mobile sync envelope — the procurement endpoint
  // owns receivable-status validation, line quantity rollup, and the
  // po.receipt_recorded event emission.
  | "DELIVERY_RECEIPT"
  // Task #3092: real-time field issue captures (quality defects,
  // coordination problems, blockers) posted from the mobile app. Pushed
  // directly to /api/field-productivity/issue-captures by
  // pushIssueCaptures() in the sync coordinator — the unified mobile
  // sync envelope has no issueCaptures section. Photo attachments are
  // uploaded to object storage first; the resulting object keys land on
  // the issue capture row as photoObjectKeys.
  | "ISSUE_CAPTURE"
  // Task #3102: worker-submitted PTO / sick / unpaid leave requests. Pushed
  // directly to POST /api/leave/requests by pushLeave() in the sync
  // coordinator — not routed through the unified mobile sync envelope (the
  // /mobile/sync contract has no leave section). Payload shape:
  //   { leaveType, leaveTypeId?, startDate, endDate, partialDayHours?, reason? }
  // The mobile screen resolves `leaveType` (PTO/SICK/UNPAID/OTHER) to a
  // server-side leaveTypeId at submit time (or, when offline, on push) by
  // consulting the cached /api/leave/types list.
  | "LEAVE_REQUEST";

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
