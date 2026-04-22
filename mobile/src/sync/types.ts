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
  | "SWPPP_INSPECTION";

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
