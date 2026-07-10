# Mobile App — Architecture

> Part of the Mobile App Architecture Blueprint. Read [`00-overview.md`](./00-overview.md)
> first. Index: [`README.md`](./README.md).

## 1. High-level shape

```
┌──────────────────────────────────────────────────────────────────┐
│                         Expo / React Native app                   │
│                                                                    │
│  UI Layer (screens, navigation)                                   │
│      ↓ reads/writes via hooks                                     │
│  ViewModel Layer (per-screen hooks: useXyzViewModel)               │
│      ↓ calls                                                      │
│  Domain Layer (use-cases: pure functions, no React, no I/O)        │
│      ↓ calls                                                      │
│  Repository Layer (one repo per entity: ProjectRepository, ...)    │
│      ↓ reads/writes                              ↓ calls           │
│  Local Store (SQLite: cache_entities, outbox, sync_meta)            API Client
│      ↑                                             │ (fetch wrapper,
│      └──────────────── Sync Coordinator ───────────┘  interceptors,
│                    (mobile-sync.md contract)           retry/backoff)
└──────────────────────────────────────────────────────────────────┘
                              │  HTTPS (JWT cookie or Bearer)
                              ▼
                    Express API (same backend as web)
                              │
                              ▼
                    Postgres (RLS-scoped per docs/architecture/tenant-isolation.md)
```

This is a **Clean Architecture / MVVM** split. The rule that keeps it honest:
**ViewModels never import a repository directly for business rules** — they
call a use-case in the Domain layer, which calls one or more repositories.
This keeps conflict-resolution, offline-fallback, and validation logic
testable without a React Native runtime.

## 2. Folder structure (proposed)

```
mobile/
├── app.json                        # Expo config (scheme: smartmanageai://)
├── src/
│   ├── app/
│   │   ├── App.tsx                 # Root: providers (Query, Auth, Sync, Theme)
│   │   └── navigation/
│   │       ├── RootNavigator.tsx   # Auth stack vs. authenticated tab/stack switch
│   │       ├── TabNavigator.tsx    # Bottom tabs, per role (see ui-ux.md §2)
│   │       └── linking.ts          # Deep link / universal link config
│   ├── features/                   # One folder per module (mirrors docs/mobile/features/)
│   │   ├── time-clock/
│   │   │   ├── screens/            # UI layer
│   │   │   ├── viewModels/         # useTimeClockViewModel, etc.
│   │   │   ├── domain/             # use-cases: clockIn(), clockOut(), detectGap()
│   │   │   └── components/         # feature-local components
│   │   ├── daily-reports/
│   │   ├── projects/
│   │   ├── rfis/
│   │   ├── punch-list/
│   │   ├── inspections/
│   │   ├── crm/                    # read-mostly
│   │   ├── approvals/
│   │   └── ... (one per docs/mobile/features/*.md)
│   ├── data/
│   │   ├── repositories/           # ProjectRepository, TimeClockRepository, ...
│   │   ├── api/
│   │   │   ├── client.ts           # fetch wrapper: base URL, auth header, interceptors
│   │   │   ├── endpoints/          # typed request/response per docs/mobile/backend-integration.md
│   │   │   └── errors.ts           # typed API error hierarchy
│   │   └── local/
│   │       ├── db.ts               # Expo SQLite instance + migrations
│   │       ├── schema.ts           # cache_entities / outbox / sync_meta table defs
│   │       └── queries/            # typed local-store query helpers
│   ├── sync/
│   │   ├── coordinator.ts          # push/pull cycle — see mobile-sync.md
│   │   ├── outbox.ts               # nextLogicalClock(), enqueue/dequeue
│   │   ├── types.ts                # SyncEntityType, ENTITY_STRATEGY_MAP mirror
│   │   └── conflictUi/             # "Keep device / Keep server" resolution screens
│   ├── auth/
│   │   ├── AuthContext.tsx         # token storage, refresh-on-401, logout
│   │   ├── oauthMobileExchange.ts  # see mobile-auth.md §2
│   │   └── passkey.ts              # see mobile-auth.md §3
│   ├── notifications/
│   │   ├── pushRegistration.ts     # Expo push token registration
│   │   └── handlers.ts             # foreground/background notification routing
│   ├── shared/
│   │   ├── ui/                     # design-system primitives (see ui-ux.md)
│   │   ├── hooks/                  # useNetworkStatus, useSyncStatus, useLocation
│   │   ├── analytics/              # event tracking wrapper
│   │   └── logging/                # crash reporting + structured logs
│   └── config/
│       ├── env.ts                  # per-build-flavor config (see §9)
│       └── featureFlags.ts         # mirrors server-side FEATURE_FLAG_KEYS
└── e2e/                             # Detox/Maestro specs (see testing.md)
```

Each `features/<name>/` folder is intentionally shallow (screens → viewModel
→ domain → components) so a contributor working one module never has to
touch `sync/` or `data/api/` internals unless they're adding a new entity
type end-to-end (see the checklist in `docs/architecture/mobile-sync.md`
§"Adding a New Entity Type").

## 3. State management

| Concern | Tool | Why |
| --- | --- | --- |
| Server-state caching (list/detail reads) | **TanStack Query** (`useQuery` / `useInfiniteQuery`), same library as web | Consistency with the web codebase's conventions (`fullstack-js` skill), built-in stale-while-revalidate, and the mobile pagination client checklist in `docs/api/pagination.md` maps directly onto `useInfiniteQuery`. |
| Local/offline entity cache | SQLite (`cache_entities`), read through repositories, exposed to Query as the "network" layer when offline | Matches the already-shipped local storage posture in `mobile-sync.md` §"Local Storage Posture" — no new client-side cache technology introduced. |
| Auth/session | React Context (`AuthContext`) + SecureStore-backed token | Small, infrequently-changing global state; Context is sufficient and avoids adding a global store just for a JWT. |
| Cross-cutting UI state (theme, active org for HUSTLER, offline banner) | React Context | Same reasoning as auth — low churn, no need for Redux/Zustand. |
| Ephemeral form state | `react-hook-form` (same as web) | Consistency with web form conventions; avoids re-deriving validation patterns. |
| Sync status / outbox counts | Dedicated `useSyncStatus()` hook backed by `sync_meta` + a lightweight event emitter in `sync/coordinator.ts` | Sync status must update in near-real-time as the coordinator runs; a query-cache round trip is the wrong tool for this internal, device-local state. |

No global client-state library (Redux/Zustand/Recoil/Jotai) is introduced.
The combination of TanStack Query (server state) + a small number of Context
providers (session-scoped global state) covers every need identified above;
adding a general-purpose store would duplicate what Query already does for
server data and add ceremony for the handful of Context-sized concerns.

## 4. Dependency injection

React Native has no built-in DI container. This blueprint uses **constructor
injection via a root `ServiceProvider`**, not a magic DI framework:

```ts
// src/app/ServiceProvider.tsx
const services = {
  api: buildApiClient(env),
  db: openLocalDb(),
  syncCoordinator: null as SyncCoordinator | null, // built after db + api
};
services.syncCoordinator = buildSyncCoordinator(services.api, services.db);

export const ServiceContext = createContext(services);
export const useServices = () => useContext(ServiceContext);
```

Repositories and the sync coordinator are constructed once at app boot and
handed down via `ServiceContext`; viewModels call `useServices()` to get a
repository rather than importing a singleton module directly. This keeps
every layer trivially mockable in unit tests (see [`testing.md`](./testing.md))
without a DI framework dependency.

## 5. Networking / repository layer

- **`data/api/client.ts`** wraps `fetch` with: base URL resolution per
  build flavor (§9), auth header/cookie attachment, a request-ID header for
  correlation with server logs (`correlationIdMiddleware`, mirrored from
  `threat_model.md` §5.8), automatic retry with exponential backoff on
  `429`/`5xx`/network-timeout (bounded to 3 attempts), and 401 handling that
  triggers the auth refresh/logout flow (`docs/api/mobile-auth.md` §4 — note
  there is **no refresh-token endpoint today**; a 401 mid-session routes the
  user to re-authenticate, it does not silently retry forever).
- **Repositories** (`data/repositories/*.ts`) are the only code that knows
  whether a given read comes from network or from `cache_entities`, and the
  only code that decides whether a given write goes straight to the API
  (online, low-risk) or through the offline outbox (see per-entity strategy
  in `mobile-sync.md`). Every repository method returns the same DTO shape
  regardless of source, per [`data-models.md`](./data-models.md).
- **Pagination**: repositories backing list screens implement the client
  checklist in `docs/api/pagination.md` — `useInfiniteQuery`, cursor-based,
  `pageSize=200` server cap, and virtualization on the screen once the
  cached page count exceeds ~500 rows.

## 6. Offline-first, caching, and background sync

This blueprint does **not** re-specify sync mechanics — `docs/architecture/mobile-sync.md`
is authoritative and already reflects shipped behavior:

- Per-entity conflict strategy table (dedupe window, merge fields,
  flag-both, last-write-wins, append-only).
- The Lamport logical-clock tie-break contract.
- The `mobile_sync_events` audit schema and PM playbook for conflict
  resolution.
- Local storage posture (SQLite tables, OS-level encryption-at-rest,
  shared-device caveats).
- The Time Clock Risk Audit (dedup + gap detection).

**What this blueprint adds on top:** how the app schedules and surfaces
sync, since `mobile-sync.md` describes the server-side contract, not the
client scheduling policy.

| Trigger | Behavior |
| --- | --- |
| App foreground | Immediate pull (`GET .../mobile/sync?lastSyncAt=`), then push any pending outbox items. |
| Network reconnect (`useNetworkStatus` transitions offline→online) | Same as foreground trigger, debounced 2s to avoid flapping on marginal signal. |
| Periodic background (`expo-background-fetch` / `expo-task-manager`) | Best-effort push-only every ~15 min when the OS grants background execution time; pulls are foreground-only today since background pull has no UI to react to a conflict. |
| Explicit pull-to-refresh | Manual pull, bypasses debounce. |
| Outbox write (any offline mutation) | Immediately attempts a push if online; otherwise stays queued until the next trigger above. |

Background sync failures (e.g., OS killed the background task mid-push) are
safe by construction: the outbox item stays `PENDING` until a subsequent
trigger successfully processes it — this is the same idempotent-retry
posture `mobile-sync.md` describes for the server side.

## 7. Push notification architecture

- **Provider**: Expo push notification service (`expo-notifications`) —
  avoids standing up separate APNs/FCM credential management; Expo brokers
  both.
- **Registration**: on login, the app registers a push token via
  `POST /api/mobile/register-device` semantics — note this route name is
  inherited from the legacy Feature-G naming and does not exist yet; the
  concrete route must be added under the same `mobile_devices` table
  documented in `mobile-sync.md`, with `push_token` and `platform` columns
  (already present in that schema). **This is a proposed, net-new backend
  endpoint** — flagged here rather than assumed shipped.
- **Delivery**: server-side notification fan-out (`server/notificationRoutes2.ts`,
  `notifications.md` in `docs/features/`) gains a mobile push channel
  alongside its existing email/web-push channels — reusing the existing
  notification-preferences and delivery-framework abstraction rather than
  building a parallel one.
- **Foreground handling**: `notifications/handlers.ts` intercepts
  foreground pushes and either shows an in-app banner or silently triggers
  a targeted sync pull (e.g., "new RFI assigned" → pull RFIs) instead of an
  OS notification, per the platform's existing notification-preference
  settings.
- **Deep link on tap**: every push payload carries a `deepLink` field
  (`smartmanageai://projects/:id/rfis/:rfiId`) resolved via the same linking
  config used for OAuth callbacks (§8).

## 8. Deep linking

- **Scheme**: `smartmanageai://` — already reserved and validated
  server-side for the OAuth mobile-exchange `redirect` parameter
  (`docs/api/mobile-auth.md` §5). No new scheme is introduced.
- **Universal links** (`https://app.smartmanageai.com/...` opening the app
  directly on iOS/Android) are a v1.1 nice-to-have — v1 ships custom-scheme
  deep links only, since the primary entry points (push notification tap,
  OAuth callback) don't require the App Store fallback behavior universal
  links exist for.
- **Route table**: `navigation/linking.ts` maps deep-link paths 1:1 to the
  screen registry, mirroring the web route table in `docs/module-directory.md`
  wherever a mobile screen exists for that module (e.g. `/projects/:id` on
  web ↔ `projects/:id` on mobile); modules with no mobile screen (Website
  Builder, Super Admin) resolve their deep link to an in-app "open in
  browser" handoff instead of a 404.

## 9. Analytics, logging, and crash reporting

| Concern | Approach |
| --- | --- |
| Crash reporting | Sentry (React Native SDK) — reuses the same Sentry project/org already wired server-side (`threat_model.md` §5.8 references Sentry for error correlation); mobile crash events tag `organizationId`/`userId` (never PII beyond that) so field incidents can be cross-referenced with server logs via the shared `x-request-id` correlation header. |
| Structured logging | A thin `shared/logging/` wrapper that no-ops in production builds except for warn/error, and forwards warn/error to Sentry breadcrumbs. No raw `console.log` of API payloads (payloads may contain tenant business data). |
| Product analytics | Event-based (`track(event, props)`) funneled through the same analytics pipeline as web (whichever the web app already uses — see `docs/product/features.md` for context); mobile-only events (offline sync conflict shown, background sync completed) are namespaced `mobile.*`. |
| Redaction | Mirrors `server/utils/redactForLog`'s intent — no password/token/JWT ever enters a log line or analytics prop on the client either. |

## 10. Security architecture (summary — full detail in `security.md`)

Authentication and the JWT lifecycle are governed by `docs/api/mobile-auth.md`
(authoritative, do not re-derive). This blueprint's [`security.md`](./security.md)
adds the mobile-specific layer on top: secure token storage (Keychain/
Keystore via `expo-secure-store`), optional biometric app-lock, certificate
pinning posture, and how the local SQLite cache's encryption-at-rest gap
(documented in `mobile-sync.md` §"Local Storage Posture") is handled for
regulated tenants.

## 11. Feature flags

Mobile reads the same `FEATURE_FLAG_KEYS` surface the web app uses
(`docs/module-directory.md` → Administration → Feature Flags), fetched once
per session via the existing feature-flag endpoint and cached in
`config/featureFlags.ts`. No separate mobile-only flag system is
introduced — a flag disabled for an org on web is disabled for that org on
mobile in the same request cycle.

## 12. Environment / build-flavor configuration

Three Expo build profiles, matching the existing web environment story
(`REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS` in `threat_model.md` §5.1):

| Flavor | API base URL source | Push env | Notes |
| --- | --- | --- | --- |
| `development` | `EXPO_PUBLIC_API_URL` pointed at the Replit dev domain / `REPLIT_DEV_DOMAIN`, added to `ADDITIONAL_ALLOWED_ORIGINS` per `replit.md`'s optional env var | Expo push (dev) | Metro/Expo Go, hot reload. |
| `staging` | Staging deployment domain | Expo push (dev) | Internal TestFlight/Play Internal Track builds. |
| `production` | Production custom domain | Expo push (prod) | Store builds; see [`deployment.md`](./deployment.md). |

`ADDITIONAL_ALLOWED_ORIGINS` (documented in `replit.md`) is the mechanism
that lets the CORS allowlist admit the Expo dev/staging preview domains
without a code change — the mobile team should request the relevant
`https://*.expo.dev` / EAS preview domain be added there rather than
patching `server/index.ts` CORS logic directly.

## 13. CI/CD recommendations

See [`deployment.md`](./deployment.md) for the full release process. At the
architecture level: EAS Build for native binaries, EAS Update for
JS-only OTA patches (gated the same way server-side feature flags gate a
web rollout — i.e., a broken OTA update should be revertible without an app
store review cycle), and EAS Submit for store delivery. CI runs unit +
component tests on every PR and the Detox/Maestro e2e suite
([`testing.md`](./testing.md)) on merge to the release branch, mirroring the
"Green Baseline" discipline already used for the web app's `typecheck` /
`Start application` workflows (`replit.md`).
