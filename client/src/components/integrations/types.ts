export interface Provider {
  key: string;
  displayName: string;
  authType: string;
  featureFlag: string;
}

export interface Connection {
  id: string;
  provider: string;
  displayName: string | null;
  status: "pending" | "active" | "disconnected" | "error";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  tokenStatus?: "valid" | "expired" | "missing";
  tokensEncrypted?: boolean;
  metadata?: {
    scope?: string;
    expiresAt?: string;
    realmId?: string;
    tokenType?: string;
    devMode?: boolean;
  };
}

export interface SecurityAuditEntry {
  action: string;
  timestamp: string;
  connectionId?: string;
  provider?: string;
  userId?: string;
  success: boolean;
  details?: string;
}

export interface SyncLogEntry {
  operation: string;
  dryRun: boolean;
  result: {
    success: boolean;
    entityType: string;
    direction: string;
    created: number;
    updated: number;
    skipped: number;
    errors: { entityId?: string; message: string }[];
  };
  duration: number;
  triggeredBy: string;
  triggeredAt: string;
}

export interface SyncHistoryItem {
  operation: string;
  lastSyncAt: string | null;
  latestResult: SyncLogEntry["result"] | null;
  logs: SyncLogEntry[];
}

export interface SyncHistoryResponse {
  history: SyncHistoryItem[];
  chartOfAccounts: { lastSyncAt: string; accountCount: number } | null;
  connectionId: string;
  provider: string;
}

export interface AccountMapping {
  id: string;
  costCode: string;
  qboAccountId: string;
  qboAccountName: string;
  mappingType: string;
}

export interface QboAccount {
  qboId: string;
  name: string;
  accountType: string;
  accountSubType: string;
  classification: string;
  active: boolean;
}

export interface SyncSchedule {
  id: string;
  operation: string;
  frequency: string;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface ZapierWebhook {
  id: string;
  name: string;
  webhookUrl: string;
  eventTypes: string[];
  isActive: boolean;
  secretKey: string;
  lastTriggeredAt: string | null;
  lastStatus: string | null;
  triggerCount: number;
  connectionId: string;
  createdAt: string;
}

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  qbo: "Sync invoices, customers, and chart of accounts with QuickBooks Online.",
  google: "Connect Gmail and Google Calendar for email ingestion and scheduling.",
  microsoft: "Integrate Outlook mail and Microsoft 365 Calendar.",
  docusign: "Send contracts and change orders for electronic signature.",
  zapier: "Connect SmartManageAI to 5,000+ apps via webhooks and automation triggers.",
  stackct: "Sync projects, plans, and takeoff/estimate data with STACK Construction Technologies.",
};
