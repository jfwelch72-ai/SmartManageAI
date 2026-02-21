# Email & Calendar Integration Specification

## Overview

Functional baseline for Google and Microsoft email ingestion with AI classification, plus calendar two-way sync.

## Email Ingestion

### Google Provider
- OAuth 2.0 with scopes: `gmail.readonly`, `gmail.labels`
- Incremental sync using Gmail History API (historyId cursor)
- Store cursor in integration_sync_state per connection

### Microsoft Provider
- OAuth 2.0 with scopes: `Mail.Read`, `Mail.ReadBasic`
- Incremental sync using Microsoft Graph delta queries
- Store deltaLink cursor in integration_sync_state per connection

### Sync Flow
1. Initial sync: pull last 30 days of messages (configurable)
2. Incremental: pull new messages since last cursor
3. Store metadata + body snippet in existing email tables
4. Trigger AI classification pipeline (if AI_GOVERNANCE flag allows)

### AI Classification Pipeline (Governed)
All AI calls go through the AI governance wrapper.

**Categories**:
- RFI
- Submittal
- Delay Notice
- Change Order Request
- Invoice / Pay App
- General Communication
- Action Required

**Extraction**:
- Project reference (match against org's project codes)
- Due dates
- Sender role (owner/GC/sub)
- Suggested next action

**Output**: DRAFT tasks only — never auto-send or auto-create real entities.

### Inbox Review UI
- List emails with AI classification labels
- Confidence score indicator
- Actions: Create Task, Create Delay Draft, Create CO Draft, Dismiss
- Filter by classification, project, date range

## Calendar Sync

### Export (Internal → External)
- Push project milestones and schedule tasks to Google/Microsoft calendar
- Create events tagged with project code
- Update events when internal schedule changes
- Configurable per org: which event types to export

### Import (External → Internal)
- Read events from connected calendar
- Match events with project codes in title/description
- Create draft schedule entries (not auto-approved)
- Conflict detection: if event changed externally, log conflict

### Conflict Handling
- External changes logged as "calendar conflicts"
- Require approval before updating internal schedule
- Show conflict resolution UI in calendar page

## Environment Variables Required

### Google
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

### Microsoft
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_REDIRECT_URI`
- `MICROSOFT_TENANT_ID`
