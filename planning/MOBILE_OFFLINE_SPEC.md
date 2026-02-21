# Mobile/Offline Reliability V2 Specification

## Overview

Enhanced mobile/offline capabilities with proper conflict resolution, resilient uploads, and instrumentation. Additive to existing mobile/offline functionality.

## Conflict Resolution Strategy

### Server-Authoritative Merge Rules

| Entity Type | Merge Rule |
|-------------|-----------|
| Time Entry | Server wins on approval_status; client wins on hours/notes if not approved |
| Note | Last-write-wins with conflict log |
| Issue | Server wins on status; client wins on description/photos |
| Voice Log | Append-only (no conflict possible) |
| Photo | Append-only (no conflict possible) |

### Conflict Detection
1. Client sends: entity data + lastSyncedAt timestamp + local version
2. Server compares: server version > client lastSyncedAt?
3. If conflict: apply merge rules, log conflict
4. Return: merged result + conflict details (if any)

### Conflict Log
- Stored in existing offlineSyncQueue with additional conflict metadata
- UI shows "X conflicts need review" banner
- Conflict resolution UI: side-by-side comparison, accept server/client/manual merge

## Resilient Uploads

### Retry Queue
- Failed uploads queued with exponential backoff
- Background retry (1min, 5min, 15min, 1hr)
- Max 5 retries before marking as permanently failed
- User notification on permanent failure

### Chunked Uploads
- Files > 5MB split into chunks
- Each chunk uploaded independently
- Server reassembles on completion
- Resume capability on interrupted uploads

## Instrumentation

### Metrics Tracked
- Pending upload count
- Sync success/failure rate
- Average sync latency
- Conflict count and resolution rate
- Offline session duration

### Error Dashboard
- Admin view of mobile sync health across org
- Per-user sync status
- Failed upload log with retry status
- Conflict resolution queue
