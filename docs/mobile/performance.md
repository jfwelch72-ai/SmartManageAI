# Mobile Performance

> Part of the [Mobile App Architecture Blueprint](./README.md).

## 1. Performance goals

| Metric | Target | Why |
| --- | --- | --- |
| Cold start to interactive | < 2.5s on a mid-tier Android device | Field workers open the app dozens of times a day between tasks; slow starts compound. |
| Time-to-clock-in (tap to confirmed local save) | < 300ms | This is the single highest-frequency action in the app and must never feel gated on network. |
| List screen first paint (cached) | < 500ms | Cache-first reads (§2) should render before any network round trip completes. |
| Sync push of a single outbox item | < 1s on a 3-bar connection | Keeps the "syncing" indicator from lingering distractingly. |
| Photo capture-to-attached | < 1s (excludes upload) | Local save only; the actual upload happens async per `workflows.md` §2. |

## 2. Cache-first rendering

Every list/detail screen renders from `cache_entities` immediately (if
present) and revalidates in the background via TanStack Query's
stale-while-revalidate pattern — the user is never staring at a blank
loading spinner for data that's already on the device, consistent with the
staleness-labeling rule in `ui-ux.md` §1.

## 3. List virtualization

Any list screen with more than ~50 rows uses a virtualized list
(`FlatList`/`FlashList`) rather than mapping into a `ScrollView` — required
per the pagination client checklist (`docs/api/pagination.md`,
`backend-integration.md` §5) once cached rows exceed ~500.

## 4. Image handling

- Captured photos are downscaled/re-encoded client-side to a sane max
  dimension (e.g., 2048px long edge) before queueing for upload — a
  full-resolution 12MP+ photo from a modern phone camera is unnecessary for
  daily-report/punch-list documentation and multiplies sync time and
  cellular data usage on a jobsite with poor signal.
- Thumbnails shown in list views are a separate, smaller cached asset
  (server-generated or client-generated) rather than re-decoding the
  full-size image for every row.

## 5. Sync coordinator efficiency

- Outbox pushes are batched (multiple pending events in one
  `POST .../mobile/sync` call) rather than one request per event, reducing
  round trips on a slow/expensive connection — matches the batch shape
  implied by `mobile_sync_events` being written per-event server-side from
  a single batched request.
- Pull requests use `lastSyncAt`/`syncToken` (per the `mobile_devices`
  schema) to fetch only the delta, never a full re-sync on every foreground
  trigger.
- Background sync (§6 of `01-architecture.md`) is push-only and
  time-boxed to respect OS background-execution budgets (`expo-task-manager`
  typically grants only a short window) — it does not attempt a full pull
  that could get killed mid-transaction.

## 6. Bundle size & startup

- Expo/React Native's Hermes engine (default JS engine) is used for faster
  cold start and lower memory footprint versus JSC.
- Route-based code splitting via lazy screen imports for lower-frequency
  modules (Reports, Administration) keeps the initial bundle focused on the
  high-frequency modules (Home, Time Clock, Projects) most users need
  immediately after login.
- EAS Update (OTA) payloads are diffed, not full-bundle, per Expo's default
  update mechanism — keeps patch downloads small on cellular connections.

## 7. Battery & GPS usage

- GPS is requested **on-demand** at the moment of a clock-in/out or a
  location-tagged capture (photo, haul ticket) — never continuous
  background location tracking, which would be both a battery drain and an
  unnecessary privacy/consent surface not required by any feature in this
  blueprint.
- No feature in this blueprint requires background geofencing or
  continuous location; if a future "auto clock-in on jobsite arrival"
  feature is proposed, it should be scoped and reviewed as new work with
  its own privacy/battery tradeoff analysis, not silently added.

## 8. Monitoring performance in production

- Sentry performance tracing (transactions for cold start, screen
  navigation, sync cycle duration) — same Sentry project as crash reporting
  (`01-architecture.md` §9).
- Sync cycle duration and outbox backlog size are also visible server-side
  via `mobile_sync_log`, giving a second, server-truth vantage point on
  client sync health independent of client-reported telemetry.
