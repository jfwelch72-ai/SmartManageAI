import type { IntegrationConnection, IntegrationSyncState } from "@shared/schema";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
  raw?: Record<string, any>;
}

export interface IntegrationProvider {
  key: string;
  displayName: string;
  authType: "oauth" | "apiKey" | "manual";
  requiredScopes: string[];
  featureFlag: string;

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string;
  handleCallback(code: string, state: string): Promise<TokenSet>;
  refreshToken(connection: IntegrationConnection): Promise<TokenSet>;
  testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }>;
  disconnect(connection: IntegrationConnection): Promise<void>;
}

export interface SyncOperation {
  entityType: string;
  direction: "import" | "export" | "bidirectional";
  execute(connectionId: string, orgId: string, dryRun?: boolean): Promise<SyncResult>;
}

export interface SyncResult {
  success: boolean;
  entityType: string;
  direction: "import" | "export";
  created: number;
  updated: number;
  skipped: number;
  errors: SyncError[];
  cursor?: string;
}

export interface SyncError {
  entityId?: string;
  message: string;
  details?: Record<string, any>;
}

export interface WebhookPayload {
  eventType: string;
  data: Record<string, any>;
  timestamp: string;
  signature?: string;
}

export interface OutboxEvent {
  connectionId: string;
  eventType: string;
  payload: Record<string, any>;
  idempotencyKey?: string;
}
