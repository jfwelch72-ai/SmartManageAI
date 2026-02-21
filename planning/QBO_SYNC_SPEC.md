# QuickBooks Online Sync Specification

## Overview

Functional baseline integration with QuickBooks Online for financial data synchronization.

## OAuth 2.0 Flow

1. Admin initiates connection from Integrations page
2. Redirect to Intuit OAuth authorization URL with scopes: `com.intuit.quickbooks.accounting`
3. User authorizes access
4. Callback receives auth code, exchanges for access + refresh tokens
5. Tokens stored encrypted in integration_connections metadata
6. Refresh tokens automatically before expiry (1hr access, 100-day refresh)

## Sync Operations

### 1. Import Chart of Accounts (Read)
- Pull all accounts from QBO
- Store mapping in integration_sync_state
- Display in UI for mapping configuration
- Used for invoice line item mapping

### 2. Export Customers (Create/Update)
- Map CRM organizations (type: CONTRACTOR, OWNER_REP) to QBO Customers
- Create new customers if no mapping exists
- Update existing customers on subsequent syncs
- Store QBO Customer ID in connection metadata

### 3. Export Invoices from SOV/Pay Apps (Create)
- When SOV draw request is approved, create Invoice in QBO
- Map SOV line items to QBO invoice lines
- Apply account mapping from Chart of Accounts
- Store QBO Invoice ID for status tracking
- Approval required before export (when APPROVALS_FRAMEWORK is ON)

### 4. Import Payment Status (Read)
- Poll QBO for payment status on exported invoices
- Update internal invoice/SOV status (paid/partial/overdue)
- Log changes in audit trail

## Sync Modes

- **Dry Run**: Shows what would change without making API calls
- **Manual Sync**: Admin triggers sync from UI
- **Scheduled Sync**: Background job runs every 4 hours (configurable)

## Entity Mapping

| Internal Entity | QBO Entity | Direction |
|----------------|------------|-----------|
| CRM Organization | Customer | Export |
| SOV Draw Request | Invoice | Export |
| Payment (tracked) | Payment | Import |
| Chart of Accounts | Account | Import |

## Error Handling

- Rate limiting: respect QBO throttle headers (500 requests/min)
- Conflict detection: compare QBO `SyncToken` before updates
- Failed syncs logged with full error context
- Admin notification on repeated failures

## Environment Variables Required

- `QBO_CLIENT_ID` — Intuit app client ID
- `QBO_CLIENT_SECRET` — Intuit app client secret
- `QBO_REDIRECT_URI` — OAuth callback URL
- `QBO_ENVIRONMENT` — sandbox/production
