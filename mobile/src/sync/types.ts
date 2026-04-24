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
  | "SUBMITTAL_STAMP";

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
  status: "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";
  retryCount: number;
  lastError?: string | null;
  conflictServerUpdatedAt?: string | null;
}
