# Mobile Feature: Projects

> Mirrors `docs/module-directory.md` §3 (Projects). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Projects is the largest module and the one field roles touch most: project
info, daily notes, RFIs, submittals, punch list, tasks, media, and (for
managers) change-order and approval review. This is the module with the
richest offline story outside of Workforce time clock.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| Project List | `projects.tsx` | List/card view only on mobile — no kanban/map/calendar variants (those are desktop-density; see `ui-ux.md` §4). Filtered to the user's assigned projects for SUPERINTENDENT/FIELD_WORKER per RBAC. |
| Project Detail | `project-detail.tsx` | Tabs collapse into a mobile segmented view: Overview, Daily Notes, RFIs, Submittals, Punch List, Tasks, Media, Change Orders (per role). |
| Daily Notes / Daily Reports | `daily-reports.tsx`, `DailyNoteFeed.tsx` | Full offline create + photo attach. Primary field-data-entry surface alongside time clock. |
| RFIs | `ProjectRFIs.tsx` (component) | List + detail read; create new RFI (SUPERINTENDENT/PROJECT_ENGINEER); respond (any assigned role). |
| Submittals | `ProjectSubmittals.tsx` | Read + status update; full submittal creation stays web-only in v1 (multi-attachment, routing-heavy workflow). |
| Punch List | `punch-list` component family | Full offline: walk a punch list room-by-room, mark items complete with a photo, matches the existing `walkthrough` grouping-by-location endpoint. |
| Tasks | `tasks.tsx` | Read assigned tasks; mark complete. |
| Media Gallery | `MediaGallery.tsx` | Camera-first capture flow — this is the single most field-native surface in the whole app; see [`ui-ux.md`](../ui-ux.md) §5. |
| Change Orders / Approvals | `ChangeOrderDialog.tsx`, `approvals.tsx` | Read + approve/reject for MANAGER/ADMIN/SUPERINTENDENT (per their existing web approval rights) — dollar-figure creation stays web-only. |
| Messages | `messages.tsx` | Thin native chat view; reuses the existing messaging schema/routes (`shared/schema/features/messaging.ts`). Messaging is not one of the 9 top-level modules in `docs/module-directory.md`, so it is covered here rather than in a dedicated feature doc. |

## 3. Offline behavior

Per-entity strategy is defined once in `docs/architecture/mobile-sync.md`
and reused here, not redefined:

| Entity | Strategy (per `mobile-sync.md`) | Mobile UX implication |
| --- | --- | --- |
| Daily notes / reports | Dedupe window + merge on non-conflicting fields | User sees "saved offline, will sync" chip; a same-day duplicate note from two devices is merged, not doubled. |
| Photos / media | Append-only | Every photo capture is its own row; no conflict possible by construction. |
| Punch list item status | Flag-both on conflicting status changes within the window | If two people close the same punch item offline, both flags are recorded and a super/manager resolves which stands (see `mobile-sync.md`'s PM Playbook). |
| RFI responses | Append-only (each response is a new message in the thread) | No conflict; thread just gets both responses in Lamport-clock order. |
| Task completion | Last-write-wins | Rare double-completion race is harmless. |
| Change order approve/reject | **Online-only, not queued** | Money-path decisions are never taken while offline and silently applied later — the button is disabled with a "requires connection" state offline, consistent with `00-overview.md` principle 5 (no silent overwrite on payroll/compliance-sensitive data, extended here to approval decisions). |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/projects` | GET | List, filtered server-side by assignment for scoped roles |
| `/api/projects/:code` | GET | Detail |
| `/api/projects/:code/daily-reports` | GET/POST | Pagination backlog #3 in `docs/api/pagination.md` — implement client-side per the checklist regardless of server migration status |
| `/api/projects/:code/rfis` | GET/POST | Backlog #8 |
| `/api/projects/:code/submittals` | GET/PATCH | Backlog #9 |
| `/api/projects/:code/punch-list` | GET/PATCH | Backlog #11; `GET .../punch-list/walkthrough` for location-grouped field walks |
| `/api/projects/:code/photos` | POST (multipart via signed URL, see `backend-integration.md` §4) | Backlog #5 |
| `/api/tasks` | GET/PATCH | — |
| `/api/change-orders/:id/approve` | POST | Online-only per §3 |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap. `PROJECT_ENGINEER` (→ `ESTIMATOR`) is the one
> specialist with a real carve-out in this module: full document-control
> access (RFI/submittal create+respond, drawing markups, change-event
> initiation) rather than `ESTIMATOR`'s plain read-only row, since
> document control is `PROJECT_ENGINEER`'s primary job-to-be-done per
> `docs/ACCOUNT_ROLES_RBAC.md`.

| Role | Project list/detail | Daily notes | RFIs | Submittals | Punch list | Media | CO approve |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ADMIN | All projects | Full | Full | Full | Full | Full | Yes |
| MANAGER | All projects | Full | Full | Full | Full | Full | Yes |
| SUPERINTENDENT | Assigned only | Full | Full (create/respond) | Read + status | Full | Full | Yes |
| PROJECT_ENGINEER | Assigned only | Read | Full | Full | Read | Read | No |
| ESTIMATOR | Most, read-only | Read | Read | Read | Read | Read | No |
| FIELD_WORKER | Assigned, active only | Create (own) | Read | — | Update status | Full (capture) | No |
| HUSTLER | Read across linked orgs | Read | Read | Read | Read | Read | No (cross-org approvals stay web) |
| VENDOR | Portal only, not native app | — | — | — | — | — | — |

## 6. Gaps vs. today

- No dedicated "mobile daily note" backend shape exists yet — the mobile
  client should POST to the same `daily-reports` endpoint the web app uses,
  with photo attachment via the standard signed-upload flow
  (`backend-integration.md` §4); no new route is required.
- Full submittal *creation* (multi-document routing) is deliberately web-only
  in v1; only status-update and read are mobile-native.
