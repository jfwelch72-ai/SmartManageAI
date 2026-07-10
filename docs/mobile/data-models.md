# Mobile Data Models

> Part of the [Mobile App Architecture Blueprint](./README.md). Reconciles
> mobile client-side data shapes with the authoritative server schema in
> `shared/schema/features/mobile.ts` and `shared/schema/features/mobileSync.ts`.

## 1. Server-side schema (authoritative, already shipped)

The mobile backend already has real tables — this blueprint does not invent
new schema for the sync mechanism itself:

| Table | File | Role |
| --- | --- | --- |
| `mobile_devices` | `shared/schema/features/mobile.ts` | One row per installed app instance: `deviceId`, `platform`, `appVersion`, `pushToken`, `lastSyncAt`, `syncToken`. This is where a future push-registration endpoint (`01-architecture.md` §7) would write `pushToken`. |
| `mobile_sync_log` | `shared/schema/features/mobile.ts` | Coarse-grained sync session log (PULL/PUSH/FULL, counts, conflicts, status) — operational visibility, not the conflict engine itself. |
| `mobile_pending_uploads` | `shared/schema/features/mobile.ts` | Legacy Feature-G upload staging table. Superseded in practice by `offline_sync_queue` + `mobile_sync_events` (see `docs/architecture/mobile-sync.md`); do not build new client code against this table. |
| `offline_sync_queue` | `shared/schema/features/mobile.ts` | The actual outbox: `operationType`, `entityType`, `entityId` (local id pre-sync → `syncedEntityId` post-sync), `payload` (jsonb), `status`, `retryCount`, `logicalClock`. **This is the table the mobile client's outbox pushes into.** |
| `mobile_sync_events` | `shared/schema/features/mobileSync.ts` | Structured, queryable audit trail of every sync outcome — `strategy` (which conflict rule fired), `outcome` (`SAVED / CONFLICT / DEDUPLICATED / MERGED / FLAGGED / DUPLICATE / FAILED`), `conflictPayload`. This is what powers the PM conflict-resolution playbook in `mobile-sync.md`. |

`ENTITY_STRATEGY_MAP` (`shared/schema/features/mobileSync.ts`) is the single
source of truth for which `SyncStrategy` applies to which entity type —
every feature doc under [`features/`](./features/) references this map by
name rather than re-stating the strategy inline where possible:

| `entityType` | Strategy | Feature doc |
| --- | --- | --- |
| `TIME_CLOCK_EVENT` | `DEDUPLICATE_WINDOW` | [`features/workforce.md`](./features/workforce.md) |
| `TIME_CLOCK_GAP` | `FLAG_BOTH` | [`features/workforce.md`](./features/workforce.md) |
| `DAILY_REPORT` | `MERGE_FIELDS` | [`features/projects.md`](./features/projects.md) |
| `PHOTO` | `APPEND_ONLY` | [`features/projects.md`](./features/projects.md) |
| `RFI` | `SERVER_WINS_STATUS_CLIENT_WINS_DRAFT` | [`features/projects.md`](./features/projects.md) |
| `PUNCH_ITEM` | `FLAG_BOTH` | [`features/projects.md`](./features/projects.md) |
| `INSPECTION` | `FLAG_BOTH` | [`features/safety-compliance.md`](./features/safety-compliance.md) |
| `DRAWING_MARKUP` | `MERGE_FIELDS` | [`features/projects.md`](./features/projects.md) |
| `HAUL_TICKET` | `LAST_WRITE_WINS` | [`features/field-ops.md`](./features/field-ops.md) |
| `INSPECTOR_REPORT` | `LAST_WRITE_WINS` | [`features/safety-compliance.md`](./features/safety-compliance.md) |
| `SWPPP_INSPECTION` | `LAST_WRITE_WINS` | [`features/safety-compliance.md`](./features/safety-compliance.md) |
| `SUBMITTAL_STAMP` | `LAST_WRITE_WINS` | [`features/projects.md`](./features/projects.md) |
| `SAFETY_INCIDENT` | `APPEND_ONLY` | [`features/safety-compliance.md`](./features/safety-compliance.md) |

Any new field-data entity added later (e.g., a future "material delivery
confirmation" screen) must add an entry to this map before it ships — this
is the extension point, not a new bespoke conflict mechanism.

## 2. Client-side local store (SQLite)

Three logical tables, matching the local storage posture in
`docs/architecture/mobile-sync.md`:

```
cache_entities (id TEXT, entity_type TEXT, server_id TEXT NULL,
                data JSON, updated_at TEXT, synced_at TEXT NULL)
outbox         (id TEXT, entity_type TEXT, operation TEXT, payload JSON,
                logical_clock INTEGER, status TEXT, retry_count INTEGER,
                created_at TEXT)
sync_meta      (device_id TEXT, last_sync_at TEXT, sync_token TEXT,
                logical_clock INTEGER)
```

- `cache_entities` is the read-cache every repository consults when
  offline; `server_id` is null for entities created offline and not yet
  synced.
- `outbox` mirrors the server's `offline_sync_queue` shape 1:1 so the push
  payload is a direct serialization — no client-side transform layer to
  keep in sync with the server schema.
- `sync_meta` holds exactly the state needed to resume a pull
  (`lastSyncAt`/`syncToken`) and to keep issuing monotonically increasing
  `logicalClock` values for the Lamport tie-break contract in
  `mobile-sync.md`.

No client-side ORM is introduced — direct parameterized SQL via
`expo-sqlite`, wrapped by the typed query helpers under
`data/local/queries/` (see `01-architecture.md` §2).

## 3. DTO shape contract

Every repository method returns the same TypeScript type whether the data
came from network or from `cache_entities`:

```ts
interface SyncedEntity<T> {
  data: T;
  source: "network" | "cache";
  syncedAt: string | null;   // null = never synced (offline-created, pending)
  hasPendingChanges: boolean;
}
```

`T` is the same DTO shape the corresponding web page consumes wherever
practical (e.g., a `DailyReport` DTO shared conceptually with
`server/projectContentRoutes.ts`'s response shape) — this blueprint does
not define new wire formats per entity; see each feature doc's API surface
table for the concrete endpoint/shape to mirror.

## 4. Auth/session data model

Session state on the client (token, refresh state, passkey credential
reference) is governed by `docs/api/mobile-auth.md` and detailed further in
[`security.md`](./security.md) §2 — not duplicated here.
