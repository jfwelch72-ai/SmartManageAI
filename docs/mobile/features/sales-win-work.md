# Mobile Feature: Sales / Win Work

> Mirrors `docs/module-directory.md` §2 (Sales / Win Work). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Pre-award work (CRM pipeline, bid creation, takeoff, AI bid/contract
analysis, marketplace) is desktop-density, mouse-and-plan-viewer-driven work.
Mobile's role here is **read + light-touch triage**, not full bid
authoring — the takeoff workspace, plan markup canvas, and cost-builder
sidebar are explicitly out of scope for native mobile (see
`00-overview.md` §6 for the general BIM/heavy-canvas exclusion rationale).

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| Bid List | `bids.tsx` (`/bids`) | Read-only list + status filter; tap opens Bid Summary. |
| Bid Summary | `bid-detail.tsx` (`/bids/:id`) | Read-only: status, key dates, dollar summary, assigned estimator. "Open full workspace" deep-links to the web app via universal link fallback. |
| CRM Pipeline (lite) | `crm.tsx` (`/crm`) | Read-only Kanban/list of deals; tap opens Deal Summary. |
| Deal Summary | `crm-deal-detail.tsx` | Read + **write**: log a call/note, update deal stage (low-risk, no financial figure entry). |
| Field Sales | `field-sales.tsx` (`/field-sales`) | Already mobile-optimized on web — the native screen is a direct port: log a site visit, capture a lead photo, quick contact capture. |
| Bid Inbox (VENDOR) | `bid-inbox.tsx` | Not shipped in v1 native app — VENDOR persona is served by the web portal (`00-overview.md` §6). |

## 3. Offline behavior

| Data | Offline read | Offline write |
| --- | --- | --- |
| Bid list / summary | Cached (last-synced snapshot) | None — bids are edited on web only |
| CRM deal list/summary | Cached | Stage change + notes queue via outbox. **Gap vs. today**: CRM entities (opportunity stage, call/note) are not yet present in `ENTITY_STRATEGY_MAP` (`shared/schema/features/mobileSync.ts`) — `mobile-sync.md` has no shipped strategy for them. This blueprint proposes `LAST_WRITE_WINS` for stage changes (single-writer field, low conflict risk) and `APPEND_ONLY` for notes/calls (message-thread semantics, same shape as `DAILY_REPORT`-adjacent append entities), to be added to `ENTITY_STRATEGY_MAP` when mobile CRM sync ships — not an assumption about already-shipped behavior. |
| Field Sales (site visit, lead capture) | N/A (creation-only flow) | Outbox, `APPEND_ONLY` strategy — same class as daily-report-style field capture; duplicates are harmless and deduped by client-generated UUID |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/bids` | GET | List (read-only on mobile) |
| `/api/bids/:code` | GET | Detail |
| `/api/crm/contacts`, `/api/crm/companies`, `/api/crm/opportunities` | GET | List — `/api/crm/contacts` already supports the pagination envelope (`docs/api/pagination.md`); mobile should use it directly. |
| `/api/crm/opportunities/:id/stage` | PATCH | Deal stage update |
| `/api/crm/calls` | POST | Log call/note |
| `/api/field-sales/visits` | POST | Site visit capture (assumes existing `field-sales.tsx` backing route; confirm exact route name in `server/crmRoutes.ts` family before wiring — flagged as a verification item, not a gap, since the web feature already ships) |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap. `SALES` (→ `MANAGER`) is the one legacy
> specialist with a real carve-out here: full CRM write access (pipeline
> stage moves, lead notes) rather than the read-mostly default for
> `MANAGER`. `MARKETING` (→ `MANAGER`) gets CRM analytics read-only.

| Role | Bids (read) | CRM (read) | CRM (write: stage/notes) | Field Sales |
| --- | --- | --- | --- | --- |
| ADMIN | Yes | Yes | Yes | Yes |
| MANAGER | Yes | Yes | Yes | Yes |
| ESTIMATOR | Yes | Yes | Yes | Yes |
| HUSTLER | Yes | Yes | Yes | Yes |
| SUPERINTENDENT | Yes (view only, per web parity) | Yes (view only) | No | No |
| FIELD_WORKER | No | No | No | No |
| VENDOR | Bid inbox only, via web portal, not native app | No | No | No |

## 6. Gaps vs. today

- Full bid cost-builder, takeoff workspace, and AI bid/contract analysis
  panels are **not** planned for native mobile — flagged as a deliberate
  scope decision (desktop-density, canvas-heavy), not an oversight. Revisit
  only if user research shows a strong field need.
- A dedicated mobile "Bid Summary" read endpoint does not need to be new —
  `GET /api/bids/:code` already returns enough for a summary view; no new
  backend route required.
