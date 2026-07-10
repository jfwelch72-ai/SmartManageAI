# Mobile Scalability

> Part of the [Mobile App Architecture Blueprint](./README.md).

## 1. What scales here, and what doesn't need to

The mobile app itself is stateless client software — "scalability" for
this blueprint is really about three things: (1) the backend's ability to
absorb mobile-originated load on top of existing web load, (2) the sync
protocol's behavior as device count and offline-queue depth grow, and (3)
the app's own ability to stay usable as an org's data volume grows.

## 2. Backend load from mobile

- Mobile traffic rides the same Express process and Postgres-backed rate
  limiters as web (`backend-integration.md` §6) — no separate mobile
  capacity plan is needed at launch; mobile adds incremental load to
  existing routes rather than introducing a new service to capacity-plan.
- The heaviest new load pattern mobile introduces is **sync fan-in**: many
  devices reconnecting after a period offline (e.g., an entire crew coming
  back into signal range at the end of a shift) can produce a burst of
  simultaneous `POST .../mobile/sync` calls. This is the scenario worth
  load-testing before a large-crew customer's rollout — see
  `docs/ops/capacity.md` for the existing capacity-planning framework to
  extend with a mobile sync-burst scenario.
- `mobile_sync_events`/`offline_sync_queue` inherit the standard indexing
  already present in their schema (`organizationId`, `deviceId`,
  `entityType`, `status` indexes) — sufficient for expected query patterns
  at launch scale; revisit only if a specific slow-query is observed in
  production monitoring.

## 3. Sync protocol scaling with offline duration

- The longer a device stays offline, the larger its outbox and the larger
  its next pull delta. The batched-push design (`performance.md` §5)
  already amortizes this, but a device offline for an extended period
  (e.g., a multi-day remote assignment) could accumulate a large local
  outbox.
- Recommended safeguard (flagged as a v1 consideration, not yet a shipped
  control): a soft cap or warning in the UI if the outbox grows past a
  threshold (e.g., 200 pending items), prompting the user to find
  connectivity rather than silently growing local storage indefinitely.
  This is a UX safety valve, not a hard technical limit — `expo-sqlite`
  can hold far more than that comfortably.

## 4. Multi-tenant growth

- Tenant isolation posture (`docs/architecture/tenant-isolation.md`) scales
  by design — RLS is per-row, not per-shard, so adding more organizations
  using the mobile app doesn't require any mobile-specific isolation work
  beyond what's already true for web.
- HUSTLER cross-org portfolio screens (`features/home.md`) are read-only
  and online-only specifically because aggregating across many linked
  orgs is a heavier query pattern best served by the existing
  `server/portfolioRoutes.ts` aggregation rather than something the mobile
  client tries to compute by pulling every org's raw data locally.

## 5. Push notification scale

Expo's push service handles fan-out at the provider level; the app's own
responsibility is keeping payloads small (`security.md` §7) and letting
the existing notification-preferences framework
(`server/notificationPreferencesRoutes.ts`) govern opt-in/opt-out per user
so push volume scales with actual user preference, not a fixed blast to
every device on every event.

## 6. Future roadmap (explicitly out of v1 scope)

These are named here so they're not confused with v1 gaps — they are
deliberate later-phase candidates, not missing work in this blueprint:

- **Universal links** (in addition to custom-scheme deep links) —
  `01-architecture.md` §8.
- **Encrypted local storage (SQLCipher)** for regulated tenants —
  `security.md` §4.
- **BIM/LiDAR mobile viewers** — `00-overview.md` §6.
- **Read-only Gantt/schedule timeline on mobile** — `ui-ux.md` §4.
- **Refresh-token-based seamless session extension** — contingent on the
  backend adding a refresh-token endpoint (`backend-integration.md` §2).
- **Per-app-version sync health tagging** — `deployment.md` §7.
- **Trade-specific mobile tool configuration** (roofing/electrical/
  plumbing tool sets) — explicitly never shipped from the legacy Feature-G
  spec; see `features/field-ops.md` §6 for the full reconciliation note.
