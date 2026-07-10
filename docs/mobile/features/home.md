# Mobile Feature: Home

> Mirrors `docs/module-directory.md` §1 (Home). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Home is the app's landing surface post-login: "My Day" agenda, a unified
inbox of assigned tasks/approvals, notifications, and — for `HUSTLER` — the
cross-org portfolio view. On mobile this is the default tab and the natural
place to surface offline/sync status, since it's the screen every user sees
most often.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| My Day | `my-day.tsx` (`/my-day`) | Default landing screen post-login. Agenda: today's assigned tasks, active time-clock state, weather. |
| My Work / Inbox | `my-work.tsx` (`/my-work`) | Unified list of assigned approvals + tasks across modules; tapping an item deep-links into the owning feature. |
| Notifications | `notifications.tsx` | Notification history list; supports mark-read; taps deep-link per §8 of `01-architecture.md`. |
| Portfolio (HUSTLER only) | `portfolio.tsx`, `hustler-dashboard.tsx` | Cross-org summary cards + org switcher; online-only (see §5). |
| Executive Digest (ADMIN/HUSTLER only) | `executive-digest.tsx` | Read-only rendering of the AI-generated weekly digest; online-only. |

Navigation placement: Home is the leftmost/first bottom tab for every role
(see [`ui-ux.md`](../ui-ux.md) §2 for the full tab layout per role).

## 3. Offline behavior

| Data | Offline read | Offline write |
| --- | --- | --- |
| My Day agenda (today's tasks, time-clock state) | Cached, shown with "as of HH:MM" staleness label | N/A (read-only aggregation; underlying writes happen in Workforce/Field Ops) |
| My Work inbox | Cached list; approve/deny actions queue to outbox if the underlying entity type supports offline write (e.g., time-entry approval), otherwise disabled offline with a "requires connection" affordance | Delegated to the owning module's sync strategy |
| Notifications | Cached last N (e.g. 100) notifications | Mark-read queues locally, flushed on reconnect |
| Portfolio / Executive Digest | Not cached — online-only | N/A |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/my-day` | GET | Aggregation endpoint (`server/myDayRoutes.ts`) |
| `/api/my-work` | GET | Unified inbox (`server/myWorkRoutes.ts`) |
| `/api/notifications` | GET | Paginated per `docs/api/pagination.md` backlog item #1 — mobile client should implement the `useInfiniteQuery` pattern from `01-architecture.md` §5 even before the server migrates this route, since the legacy array shape still works with `pageSize`/`cursor` omitted. |
| `/api/notifications/:id/read` | POST | Mark single notification read |
| `/api/hustler/portfolio` | GET | HUSTLER only (`server/portfolioRoutes.ts`) |
| `/api/executive-digest` | GET | ADMIN/HUSTLER only |

All requests go through the standard auth/RBAC/RLS stack described in
[`backend-integration.md`](../backend-integration.md) — no Home-specific
auth exception exists.

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap this table's rows resolve to server-side (every
> legacy specialist role lands Home on the same tab set as its canonical
> parent — Home has no per-specialist carve-outs).

| Role | My Day / My Work | Notifications | Portfolio | Executive Digest |
| --- | --- | --- | --- | --- |
| ADMIN | Full | Full | — | Full |
| MANAGER | Full | Full | — | — |
| SUPERINTENDENT | Full | Full | — | — |
| ESTIMATOR | Full | Full | — | — |
| FIELD_WORKER / HOURLY_EMPLOYEE | Full | Full | — | — |
| HUSTLER | Full | Full | Full | Full |
| VENDOR | Not in mobile persona set (see `00-overview.md` §6) | — | — | — |

## 6. Gaps vs. today

- No mobile-specific backend gap — every endpoint above already exists for
  the web app; mobile is a pure consumer.
- The notifications route has not yet been migrated to the cursor-pagination
  envelope (`docs/api/pagination.md` backlog #1); until it is, the mobile
  client's infinite-scroll should be prepared to switch from legacy-array
  parsing to envelope parsing behind a single response-shape check, not
  block on the migration.
