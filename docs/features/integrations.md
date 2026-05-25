# integrations — QuickBooks Online, Sage, Autodesk, Zapier Webhooks, OAuth Connections, Sync State, Account Mappings

## Overview

The integrations module provides a unified connector framework for third-party systems. Connections are OAuth 2.0 or API-key–based and stored per-org. The two primary accounting integrations are **QuickBooks Online** (GL sync, invoice push, vendor sync) and **Sage 300/Intacct** (journal entry export, cost code mapping). **Autodesk** connects drawing sets. **Zapier** exposes platform events as triggers and allows external actions. Developer portal API keys provide programmatic access with scope-based permissions.

## Data Models

**Key tables (`shared/schema/features/integrations.ts`)**

| Table | Description |
|---|---|
| `integration_connections` | `organizationId`, `provider` (QBO/SAGE/AUTODESK/ZAPIER/DOCUSIGN/PLANGRID), `status` (CONNECTED/DISCONNECTED/ERROR), `accessToken`, `refreshToken`, `tokenExpiresAt`, `metadata` (JSON) |
| `integration_sync_state` | Last sync timestamps + cursor per connection per entity type |
| `integration_sync_errors` | Individual sync error records for troubleshooting |
| `qbo_account_mappings` | Maps SmartManageAI cost codes to QBO chart of accounts GL codes |
| `qbo_vendor_mappings` | Maps platform vendors to QBO vendor records |
| `qbo_sync_queue` | Queue of pending QBO sync items: `entityType`, `entityId`, `action`, `priority` |
| `sage_journal_entries` | Journal entries staged for Sage export |
| `sage_export_batches` | Batch export records for Sage |
| `zapier_webhooks` | Webhook subscriptions: `eventType`, `targetUrl`, `signingSecret`, `isActive`, `organizationId` |
| `zapier_webhook_delivery_log` | Delivery attempts: `webhookId`, `payload`, `status`, `httpStatus`, `responseBody`, `attemptedAt`, `retryCount` |
| `developer_api_keys` | Public API keys: `name`, `prefix`, `hashedKey`, `scopes`, `rateLimitPerMinute`, `isActive`, `lastUsedAt`, `expiresAt`, `organizationId` |
| `developer_api_request_log` | Per-request log: `apiKeyId`, `method`, `path`, `statusCode`, `durationMs`, `scopeUsed` |
| `developer_webhook_subscriptions` | Developer portal webhook subscriptions |
| `davis_bacon_wage_determinations` | Cached DOL Davis-Bacon wage determinations |
| `wage_decision_rate_changes` | Detected changes in wage decision rates (alerts for payroll admins) |

## Backend Routes

**File: `server/integrationRoutes.ts`** — integration management:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/integrations` | Lists connected integrations | `canManageIntegrations` |
| POST | `/api/integrations/qbo/connect` | Initiates QBO OAuth flow | `canManageIntegrations` |
| GET | `/api/integrations/qbo/callback` | QBO OAuth callback | public (OAuth redirect) |
| POST | `/api/integrations/qbo/disconnect` | Disconnects QBO | `canManageIntegrations` |
| POST | `/api/integrations/qbo/sync` | Triggers manual sync | `canManageIntegrations` |
| GET | `/api/integrations/qbo/account-mappings` | Lists account mappings | `canManageIntegrations` |
| PUT | `/api/integrations/qbo/account-mappings` | Saves account mappings | `canManageIntegrations` |
| POST | `/api/integrations/sage/export` | Exports to Sage | `canManageIntegrations` |
| POST | `/api/integrations/autodesk/connect` | Autodesk OAuth | `canManageIntegrations` |
| GET | `/api/integrations/autodesk/projects` | Lists Autodesk projects for linking | `canManageIntegrations` |
| POST | `/api/integrations/zapier/triggers` | Registers Zapier trigger subscription | public (Zapier-signed) |
| DELETE | `/api/integrations/zapier/triggers/:id` | Unsubscribes Zapier trigger | public (Zapier-signed) |
| POST | `/api/integrations/zapier/actions/:action` | Executes Zapier action | public (Zapier-signed) |

**File: `server/devPortalRoutes.ts`** — developer API portal:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/integrations/dev-portal/keys` | Lists API keys for org | `requireAuth` + `canManageApiKeys` |
| POST | `/api/integrations/dev-portal/keys` | Creates API key; returns plaintext once | same |
| DELETE | `/api/integrations/dev-portal/keys/:id` | Revokes API key | same |
| GET | `/api/integrations/dev-portal/scopes` | Lists available scopes and event types | `requireAuth` |
| GET | `/api/integrations/dev-portal/request-log` | API key request log | `requireAuth` + `canManageApiKeys` |
| GET | `/api/integrations/dev-portal/webhooks` | Lists webhook subscriptions | `requireAuth` + `canManageApiKeys` |
| POST | `/api/integrations/dev-portal/webhooks` | Creates webhook subscription | same |
| DELETE | `/api/integrations/dev-portal/webhooks/:id` | Deletes webhook | same |

**File: `server/integrations/providers/dol_davis_bacon/sync.ts`** — Davis-Bacon sync:
- `queueWageDecisionSync(wageDecisionId)` — enqueues DOL API fetch
- `getWageDecisionSyncStatus(id)` — returns sync status
- `lookupCachedWageRate(orgId, classificationKey)` — returns cached hourly rate

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/developer-portal` | `client/src/pages/developer-portal.tsx` | API key management, webhooks, request log |
| `/company-settings?tab=integrations` | `client/src/pages/company-settings.tsx` | Third-party integration connections |

## Roles & Permissions

| Action | Gate |
|---|---|
| Manage integrations | `canManageIntegrations` — ADMIN, SUPER_ADMIN |
| Manage API keys | `canManageApiKeys` — ADMIN, SUPER_ADMIN |
| View integrations | `requireRole('ADMIN','SUPER_ADMIN')` |

## Integration Points

- **QBO sync** — `server/integrations/providers/quickbooks/` contains `QBOClient`, `syncVendors()`, `pushInvoice()`, `syncPayRun()`; uses OAuth 2.0 with token refresh; sync queue processed by job worker
- **Sage export** — `server/integrations/providers/sage/` generates WIF/XML exports; journal entries staged in `sage_journal_entries` and batched on demand
- **Autodesk** — `server/integrations/providers/autodesk/` links Autodesk Construction Cloud projects to SmartManageAI projects; syncs RFIs and submittals bidirectionally
- **Zapier webhook delivery** — `zapierWebhookRoutes.ts` signs payloads with HMAC-SHA256 using per-subscription `signingSecret`; exponential backoff retry (max 3 attempts) stored in `zapier_webhook_delivery_log`
- **Developer API auth** — `requireApiKeyAuth` middleware in `server/apiKeyAuth.ts` validates `Authorization: Bearer <key>` headers; hashes the submitted key with SHA-256 and compares to `developer_api_keys.hashedKey`
- **Replit integrations** — the Replit JavaScript database, object storage, OpenAI, and SendGrid integrations are managed via the platform's integration SDK (see `.local/skills/integrations/`)
