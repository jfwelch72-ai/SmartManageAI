# Integration Hub Specification

## Overview

The Integration Hub provides a provider-agnostic framework for connecting SmartManageAI with external services. It manages connections, secrets, sync state, webhooks, and event dispatch.

## Architecture

```
/server/integrations/
├── types.ts              # Provider-agnostic interfaces
├── registry.ts           # Provider registry + feature flag checks
├── connectionService.ts  # CRUD for connections + secrets
├── webhookService.ts     # HMAC signing/verification
├── outboxService.ts      # Event outbox write + dispatch
├── importExportService.ts # CSV import/export framework
├── audit.ts              # Structured audit logging
└── providers/
    ├── qbo/              # QuickBooks Online
    ├── google/           # Google Workspace
    ├── microsoft/        # Microsoft 365
    └── esign/            # E-signature
```

## Provider Interface

```typescript
interface IntegrationProvider {
  key: string;
  displayName: string;
  authType: 'oauth' | 'apiKey' | 'manual';
  requiredScopes: string[];
  featureFlag: FeatureKey;
  
  getAuthUrl(connection: IntegrationConnection, redirectUri: string): string;
  handleCallback(code: string, state: string): Promise<TokenSet>;
  refreshToken(connection: IntegrationConnection): Promise<TokenSet>;
  testConnection(connection: IntegrationConnection): Promise<boolean>;
  disconnect(connection: IntegrationConnection): Promise<void>;
}
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/integrations/providers | ADMIN+ | List available providers |
| GET | /api/integrations/connections | ADMIN+ | List org connections |
| POST | /api/integrations/connections | ADMIN | Create connection |
| POST | /api/integrations/connections/:id/authorize | ADMIN | Start OAuth flow |
| POST | /api/integrations/connections/:id/callback | System | OAuth callback |
| POST | /api/integrations/connections/:id/disconnect | ADMIN | Disconnect provider |
| GET | /api/integrations/events | ADMIN | View event outbox |
| POST | /api/integrations/webhooks/subscribe | ADMIN | Register webhook |
| POST | /api/integrations/webhooks/test | SUPER_ADMIN | Test webhook delivery |
| POST | /api/integrations/import | ADMIN+ | CSV import |
| GET | /api/integrations/export | ADMIN+ | CSV export |
| GET | /api/integrations/audit | ADMIN | View audit log |

## Security

- All endpoints require authentication + org isolation
- Secrets stored encrypted, never exposed in API responses
- Webhook payloads signed with HMAC-SHA256
- OAuth tokens refreshed automatically before expiry
- All actions logged to integration audit trail
- Idempotency keys required for POST actions

## Event Outbox

Events flow: Business Action → Outbox Write (same transaction) → Dispatcher Poll → Delivery → Status Update

Statuses: `queued` → `processing` → `sent` | `failed`

Retry policy: exponential backoff (1min, 5min, 15min, 1hr, 4hr), max 5 attempts.
