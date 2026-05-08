# Mobile Sync Architecture

Task #2693 — Mobile Sync Conflict Resolution Hardening

## Overview

The SmartManageAI mobile app uses an offline-first architecture with a structured conflict resolution engine. The sync cycle is:

1. **Pull** — `GET /api/ai-features/mobile/sync?lastSyncAt=<ts>` — device receives a delta of all records changed since its last sync.
2. **Push** — `POST /api/ai-features/mobile/sync` — device sends its outbox. Each entity type is routed through a named conflict strategy. Every operation writes a `mobile_sync_events` row.
3. **Ack** — processed/conflict status returned to the device; the outbox entry is updated accordingly.

---

## Per-Entity Conflict Strategy Table

| Entity Type | Strategy | Server-side execution |
|---|---|---|
| `TIME_CLOCK_EVENT` | `DEDUPLICATE_WINDOW` | Deduplication compares `clientTimestamp` parsed from stored `recordDataJson` (not `createdAt`) within a 5-min window per worker + event type. Duplicates write DEDUPLICATED events and are never silently dropped. Gap detection runs after each push. |
| `DAILY_REPORT` | `MERGE_FIELDS` | Device payload is queued with `_mergeBase` timestamp; the background processor applies non-overlapping scalar fields and preserves server state for overlapping ones. Writes MERGED outcome. |
| `PHOTO` | `APPEND_ONLY` | Conflict check is skipped entirely — every upload is treated as a distinct CREATE. Writes SAVED outcome. |
| `RFI` | `SERVER_WINS_STATUS_CLIENT_WINS_DRAFT` | Fields `status`, `statusReason`, and `workflowState` are stripped from the device payload before queuing so the server state machine is never overridden. Other draft fields pass through normally. |
| `PUNCH_ITEM` | `FLAG_BOTH` | On a version conflict, the device payload is held as `FAILED` (`HELD_FOR_REVIEW`) in `offlineSyncQueue` — the background processor cannot auto-apply it. A FLAGGED event is written with both `localVersion` and `serverVersion` snapshots in `conflictPayload`. Manager reviews via UI and picks the authoritative version; choosing DEVICE re-queues the held row as PENDING with `_resolution: LOCAL_WINS`; choosing SERVER deletes the held row. |
| `INSPECTION` | `FLAG_BOTH` | Same as PUNCH_ITEM — held FAILED until adjudicated, FLAGGED event carries both versions. |
| `DRAWING_MARKUP` | `MERGE_FIELDS` | Same execution as DAILY_REPORT. |
| `HAUL_TICKET` | `LAST_WRITE_WINS` | Standard timestamp-based LWW. On conflict, queued FAILED + CONFLICT event written. |
| `INSPECTOR_REPORT` | `LAST_WRITE_WINS` | Standard timestamp-based LWW. |
| `SWPPP_INSPECTION` | `LAST_WRITE_WINS` | Standard timestamp-based LWW. |
| `SUBMITTAL_STAMP` | `LAST_WRITE_WINS` | Standard timestamp-based LWW. |
| `TIME_CLOCK_GAP` | `FLAG_BOTH` | Synthetic entity written by server-side gap detection only (never pushed from device). Idempotent: one unresolved FLAGGED event per open shiftId. |

The `_syncStrategy` key is injected into every `offlineSyncQueue.payload` so downstream processors and audit queries can trace how the record arrived.

The strategy for each entity type is defined in `shared/schema/features/mobileSync.ts` (`ENTITY_STRATEGY_MAP`).

---

## Lamport Logical Clock Contract

Every outbox mutation on the device increments a device-local counter persisted in `sync_meta` under the key `logicalClock`. The current value is attached to each push payload item as `logicalClock`.

The server records `logicalClock` on every `mobile_sync_events` row. It is used for tie-breaking **only when `clientTimestamp` and the server's `updatedAt` are exactly equal** (same millisecond). In that narrow deterministic-tie scenario a positive logical clock on the device causes the client version to win — indicating the device accumulated more mutations since the last sync.

A broader tolerance window (e.g. ±1 second) was explicitly rejected: since the server has no comparable Lamport counter, allowing `logicalClock > 0` alone to suppress a conflict where the server is even 1 ms newer creates a silent data-loss risk. Exact wall-clock equality is the only safe tie-break criterion today. The server never rejects a push solely because the logical clock is missing or out of order.

The mobile coordinator reads the logical clock from the outbox row and includes it in the push payload. See `mobile/src/sync/outbox.ts` → `nextLogicalClock()` and `mobile/src/sync/coordinator.ts` → push payload assembly.

---

## Sync Event Log Schema

Table: `mobile_sync_events`

| Column | Type | Description |
|---|---|---|
| `id` | varchar PK | UUID |
| `organization_id` | varchar FK | Multi-tenant boundary |
| `device_id` | text | Installation device ID (from `mobileDevices.deviceId`) |
| `entity_type` | text | e.g. `TIME_CLOCK_EVENT`, `DAILY_REPORT` |
| `local_id` | text | Device-assigned UUID for the outbox record |
| `server_id` | text | Server-assigned UUID after persistence |
| `operation` | text | `CREATE`, `UPDATE`, `DELETE`, or `DETECT` (gap detection) |
| `strategy` | text | Named conflict strategy (see table above) |
| `outcome` | text | `SAVED`, `CONFLICT`, `DEDUPLICATED`, `MERGED`, `FLAGGED`, `DUPLICATE` |
| `client_timestamp` | timestamptz | Device wall-clock time |
| `server_timestamp` | timestamptz | Server time of processing |
| `logical_clock` | integer | Lamport counter from device |
| `resolved_by` | text | userId who resolved (null = unresolved) |
| `resolved_at` | timestamptz | Resolution time |
| `conflict_payload` | jsonb | Both versions for CONFLICT outcomes; gap metadata for FLAGGED |
| `created_at` | timestamptz | Row creation time |

### Querying the log

```
GET /api/mobile-sync/events
  ?entityType=TIME_CLOCK_GAP
  &outcome=FLAGGED
  &deviceId=<id>
  &dateFrom=2026-01-01
  &dateTo=2026-01-31
  &pageSize=50
```

Returns `{ items, nextCursor }` (standard pagination contract — see `docs/api/pagination.md`).

---

## PM Playbook

### When a conflict appears

1. Navigate to **Mobile & Offline Sync → Sync Events** tab.
2. Rows with outcome `CONFLICT` or `FLAGGED` and no resolved timestamp are shown highlighted in red.
3. Expand the row to see both versions (`conflict_payload`).
4. Click **Keep Device Version** or **Keep Server Version** to resolve.

`PATCH /api/mobile-sync/events/:id/resolve` with `{ choice: "DEVICE" }` re-queues the
device payload into `offline_sync_queue` with status `PENDING` and `_resolution: "LOCAL_WINS"`
so the background processor applies it to the domain table without re-entering the conflict
check. `{ choice: "SERVER" }` simply marks the event resolved — no data changes are made.

**Async-apply semantics**: resolution is *eventual* — the sync event is immediately marked
`resolved_at` (the UI updates at once) but the domain-table write happens on the next
background processor tick (typically within seconds). This is by design: it avoids coupling
the resolve endpoint to every domain write path and makes the apply step idempotent and
safe to retry. If you need to confirm the domain-table write succeeded, poll the entity
directly (e.g. the punch list item, haul ticket, etc.) after a few seconds.

**Error fallback events**: when a direct-persist fails and the item falls back to the
offline queue, the sync event outcome is `SAVED` (the item is safely queued) rather than
`FAILED`. `FAILED` is reserved for payload-validation rejections and FLAG_BOTH held rows.
This is an explicit trade-off — the item is not lost, and the event log shows it was
accepted for processing.

### When a time clock gap appears

Gap detection runs automatically after every sync that includes time clock events. An orphaned clock-in (shift start with no shift end after the `SHIFT_GAP_THRESHOLD_MS` threshold, default 12 hours) produces a `TIME_CLOCK_GAP` FLAGGED event.

1. The sync event list shows a **"Flag for Payroll Review"** button on gap rows.
2. Click it to mark the event resolved and attach a note to the conflict payload.
3. Cross-check against the certified payroll report for the affected pay period.
4. If the worker genuinely forgot to clock out, use the workforce time clock admin panel to insert a manual `ADJUSTMENT` event.

### Sync health monitoring

Navigate to **Mobile & Offline Sync → Field Device Health** tab. The table shows:

- Last sync time (amber when stale ≥ 48 hours)
- Pending outbox count (items that haven't reached the server yet)
- Unresolved conflict count (CONFLICT or FLAGGED events with `resolved_at IS NULL`)

A warning icon (⚠) appears on stale devices. Investigate by checking network connectivity on the device.

---

## Local Storage Posture

### What lives on-device (SQLite)

| Table | Contents |
|---|---|
| `cache_entities` | Pulled server records (projects, shifts, haul tickets, RFIs, etc.) — read-only mirror |
| `outbox` | Mutations queued for push — includes payload, logical clock, conflict state |
| `sync_meta` | Key-value store (last pull timestamp, device ID, logical clock counter) |

### Encryption

The SQLite database (`smartmanageai.db`) uses **Expo SQLite** which does **not** enable SQLCipher encryption by default. Encryption-at-rest is delegated to the OS:

- **iOS** — the database file resides in the app's sandboxed `Documents/` directory which is encrypted when the device is locked (Data Protection class `NSFileProtectionCompleteUntilFirstUserAuthentication`).
- **Android** — file-based encryption (FBE) protects the database when the device is locked (Android 10+ mandatory).

**Recommendation for regulated deployments**: evaluate `expo-sqlite/kv-store` + SQLCipher (via `expo-community-flipper` or a custom native module) for HIPAA / SOC 2 environments. Tracked as a roadmap item.

### Multi-tenant shared devices

The outbox and cache are keyed by installation (device ID), not by user. On a shared device:

- A new login clears cached user-specific data but does NOT wipe the outbox.
- Pending outbox items from a previous session are still associated with the previous user's JWT and will fail auth on next push.
- **Mitigation**: the `SyncContext` flushes `clearSynced()` on login and surfaces any remaining FAILED outbox items in the sync status bar so the new user can resolve them.
- **Recommendation**: for shared devices, always complete a manual sync before handing the device to another worker.

### Data accessible without re-authentication

The `cache_entities` table is not encrypted above the OS level and can be read without re-authentication if the device is unlocked. Sensitive columns (pay rates, PII) are not cached — only structural project/entity metadata needed for offline workflow entry.

---

## Time Clock Risk Audit

### Purpose

Time clock sync events are payroll-sensitive. A missed clock-out, a duplicate clock-in, or a geofence-triggered server event that conflicts with a manual mobile submission can result in incorrect pay. The following controls are in place:

### Deduplication (DEDUPLICATE_WINDOW)

Before any `TIME_CLOCK_EVENT` is persisted, the server checks two sources for duplicates within a ±5-minute window around the device's `clientTimestamp`:

1. **`mobile_pending_uploads`** — other events from the same device for the same worker + event type.
2. **`time_clock_shifts`** (authoritative server records) — catches geofence-triggered server events (`CLOCK_IN` checks `clockIn`, `CLOCK_OUT` checks `clockOut`) that were never in the pending table.

Deduplicated events write a `DEDUPLICATED` sync event and are never silently discarded. They appear in the Sync Events tab so supervisors can audit them.

### Gap Detection

After every time clock sync, the server scans open shifts for all worker IDs present in the submitted payload (not just the authenticated submitter — covers supervisors syncing crew batches). An open shift older than `SHIFT_GAP_THRESHOLD_MS` (default 12 hours, configurable via env) triggers a `TIME_CLOCK_GAP` FLAGGED event. Gap detection is idempotent: only one unresolved FLAGGED event per `shiftId` is written.

### Audit Response

| Finding | Recommended action |
|---|---|
| `DEDUPLICATED` event | Verify in Sync Events tab that the surviving record has the correct timestamp. No payroll adjustment needed if timestamp is accurate. |
| `TIME_CLOCK_GAP` FLAGGED | Use the "Flag for Payroll Review" button. Cross-check against the certified payroll report for the pay period. Insert a manual `ADJUSTMENT` via the workforce time clock admin panel if the worker forgot to clock out. |
| Unexplained `CONFLICT` on time clock entity | `TIME_CLOCK_EVENT` uses `DEDUPLICATE_WINDOW`, not LWW — conflicts at this layer are bugs. Escalate to engineering with the sync event ID. |

---

## Adding a New Entity Type — Checklist

1. Add the entity to `SyncEntityType` in `mobile/src/sync/types.ts`.
2. Add its server field name to `SERVER_FIELD_BY_ENTITY` in `mobile/src/sync/coordinator.ts`.
3. Add its strategy to `ENTITY_STRATEGY_MAP` in `shared/schema/features/mobileSync.ts`.
4. Add its push handler in `server/mobileSyncRoutes.ts` (inside `POST /api/ai-features/mobile/sync`), calling `writeSyncEvent()` for every outcome.
5. Add its pull-down query to `GET /api/ai-features/mobile/sync` if it needs a delta pull.
6. Update this document's strategy table.
