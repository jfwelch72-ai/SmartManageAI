# Mobile App — System Overview

> Part of the Mobile App Architecture Blueprint. Start here, then read
> [`01-architecture.md`](./01-architecture.md). Index: [`README.md`](./README.md).

## 1. Purpose

SmartManageAI's native mobile app (Expo / React Native, iOS + Android) gives
field-based roles — superintendents, field workers, project engineers,
inspectors, and managers on the move — a first-class, offline-capable way to
do the parts of their job that happen away from a desk: clocking in/out,
logging daily activity, capturing photos and markups, responding to RFIs,
walking punch lists, and approving time or change orders from a job site with
no reliable connectivity.

The mobile app is **not** a second product. It is a thin, purpose-built
client against the *same* Express/Postgres backend that powers the web app
(`docs/module-directory.md`), reusing the same auth, RBAC, tenant isolation,
and business logic. No new backend routes, schema, or business rules should
be invented for mobile unless a gap is explicitly identified (see each
feature doc's "Gaps vs. today" section).

## 2. Business objectives

1. **Reduce field data latency.** Daily reports, time clock events, and
   photos should reach the office same-day even from job sites with
   intermittent signal — this is the reason the app is offline-first, not
   offline-optional.
2. **Cut double-entry.** Field workers currently use the mobile-optimized
   web views (`/time-clock`, daily notes) from a browser; the native app
   replaces that with a purpose-built UI backed by structured local storage,
   not a browser tab that loses state on backgrounding.
3. **Preserve trust in payroll and compliance data.** Time clock and
   inspection data are payroll- and compliance-sensitive (see
   `docs/architecture/mobile-sync.md` §"Time Clock Risk Audit"); the mobile
   architecture must never silently drop or silently overwrite a
   field-submitted record.
4. **Extend — never fork — the permission model.** Every role already
   defined for web (`docs/ACCOUNT_ROLES_RBAC.md`) must resolve to a coherent,
   scoped-down mobile experience. Mobile does not introduce new roles.

## 3. Personas

| Persona | Role(s) | Primary mobile jobs-to-be-done |
| --- | --- | --- |
| **Field Worker** | `FIELD_WORKER`, `HOURLY_EMPLOYEE` | Clock in/out (GPS), submit daily notes, capture photos, view assigned project info, submit leave requests. |
| **Superintendent** | `SUPERINTENDENT` | Approve crew time, log daily reports, manage punch list & inspections, respond to RFIs, dispatch crews, review delay documentation. |
| **Project Engineer** | `PROJECT_ENGINEER` | Create/track RFIs and submittals, review drawings/markups, log change events. |
| **Manager / Estimator** | `MANAGER`, `ESTIMATOR` | Approve time & change orders on the go, review bid/estimate status, view CFO/financial summaries (read-mostly on mobile). |
| **Inspector (DOT/heavy-civil)** | `SUPERINTENDENT`, `ESTIMATOR` (heavy-civil orgs) | Daily inspector reports (IDRs), SWPPP inspections, haul ticket capture, material certifications — all camera- and GPS-heavy, frequently offline (remote highway/utility sites). |
| **Executive / Owner** | `HUSTLER`, `ADMIN` | Cross-org portfolio glance, approvals inbox, executive digest — read-heavy, online-first (office/travel, not jobsite). |
| **Admin** | `ADMIN` | User/role housekeeping, approvals, notifications — mobile is a convenience surface, not primary. |
| **Vendor/Sub** | `VENDOR` | Bid inbox, RFQ response, portal document upload — **out of scope for v1 native app**; served by the existing web portal (`/portal`), which is already mobile-responsive. See §6. |

`SUPER_ADMIN` is intentionally excluded from the mobile app's persona set —
platform administration is a desktop-density workflow with no offline or
field requirement.

## 4. Roles → mobile access matrix

This is the mobile-specific overlay on top of `docs/ACCOUNT_ROLES_RBAC.md`.
"Full" means the module's mobile screens are usable end-to-end offline where
applicable; "Read" means the module is view-only on mobile even though the
role has write access on web; "Self" means the role only sees its own
records within that module; "—" means the module is not surfaced in the
mobile nav for that role (the role can still use the web app).

### 4.1 Canonical-role quick reference

`docs/ACCOUNT_ROLES_RBAC.md` documents 18 named roles. As of the most
recent role-consolidation migration (`scripts/scrub-legacy-roles.ts`), the
`user_role` Postgres enum (`shared/schema/enums.ts`) has been narrowed to
**8 canonical values**: `SUPER_ADMIN`, `ADMIN`, `HUSTLER`, `MANAGER`,
`SUPERINTENDENT`, `ESTIMATOR`, `FIELD_WORKER`, `VENDOR`. Any account still
carrying one of the 10 legacy specialist role labels is remapped to its
canonical parent server-side during migration, per this table:

| Legacy role (`docs/ACCOUNT_ROLES_RBAC.md`) | Canonical role today | Mobile access = |
| --- | --- | --- |
| `OFFICE_MANAGER` | `MANAGER` | MANAGER row below |
| `HR_MANAGER` | `MANAGER` | MANAGER row below |
| `SALES` | `MANAGER` | MANAGER row below |
| `MARKETING` | `MANAGER` | MANAGER row below |
| `PROCUREMENT_MANAGER` | `MANAGER` | MANAGER row below |
| `SAFETY_MANAGER` | `SUPERINTENDENT` | SUPERINTENDENT row below |
| `DISPATCHER` | `SUPERINTENDENT` | SUPERINTENDENT row below |
| `PROJECT_ENGINEER` | `ESTIMATOR` | ESTIMATOR row below, **plus** the
  document-control (`RFIs`/submittals/drawings/change events) full-access
  carve-out documented per-module below, since that is the specialist's
  primary job-to-be-done |
| `MAINTENANCE_MANAGER` | `FIELD_WORKER` | FIELD_WORKER row below, **plus**
  the equipment/maintenance read carve-out noted in the Workforce column |
| `EQUIPMENT_MANAGER` | `FIELD_WORKER` | FIELD_WORKER row below, **plus**
  the equipment/maintenance read carve-out noted in the Workforce column |
| `HOURLY_EMPLOYEE` | `FIELD_WORKER` | FIELD_WORKER row below (identical —
  `docs/ACCOUNT_ROLES_RBAC.md` describes these as the same field-worker
  tier under two historical labels) |

This is a server-enforced fact, not a mobile-app decision: the app cannot
give a legacy-labeled account behavior its canonical role doesn't have,
because every API call is re-checked against the canonical role. Where a
legacy specialist's stated purpose in `docs/ACCOUNT_ROLES_RBAC.md`
("Purpose:" / "Capabilities:") implies a narrower or additional mobile
carve-out than its plain canonical parent (e.g. `PROJECT_ENGINEER`'s
document-control focus, `MAINTENANCE_MANAGER`/`EQUIPMENT_MANAGER`'s
equipment focus), that carve-out is called out explicitly in the table
below and in the relevant `features/*.md` doc's permissions section — it
is a UX-layer emphasis (which screen the nav opens to, which cards surface
first), never a grant of API access the canonical role lacks.

### 4.2 Full matrix — all 18 documented roles

| Role | Home | Sales/Win Work | Projects | Workforce | Finance | Field Ops | Safety & Compliance | Admin | Reports |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SUPER_ADMIN | — (excluded, see below) | — | — | — | — | — | — | — | — |
| ADMIN | Full | Read | Full | Full | Read | Full | Full | Read | Read |
| MANAGER | Full | Read | Full | Full | Read | Full | Full | — | Read |
| OFFICE_MANAGER *(→ MANAGER)* | Full | Read | Full | Full (payroll-adjacent read; approvals online-only) | Read | Full | Full | — | Read |
| HR_MANAGER *(→ MANAGER)* | Full | Read | Full | Full (hiring/onboarding/cert emphasis) | Read | Full | Full | — | Read |
| SALES *(→ MANAGER)* | Full | Full (CRM/pipeline emphasis) | Full | Full | Read | Full | Full | — | Read |
| MARKETING *(→ MANAGER)* | Full | Read (CRM analytics emphasis) | Full | Full | Read | Full | Full | — | Read |
| PROCUREMENT_MANAGER *(→ MANAGER)* | Full | Read | Full | Full | Read | Full (material requests/PO emphasis) | Full | — | Read |
| SUPERINTENDENT | Full | Read (bids) | Full (assigned) | Full (crew/time) | — | Full | Full | — | — |
| SAFETY_MANAGER *(→ SUPERINTENDENT)* | Full | Read (bids) | Full (assigned) | Full (crew/time) | — | Full | Full (primary landing screen) | — | — |
| DISPATCHER *(→ SUPERINTENDENT)* | Full | Read (bids) | Full (assigned) | Full (crew/dispatch emphasis) | — | Full | Full | — | — |
| ESTIMATOR | Full | Read | Read | Read | — | — | Read | — | — |
| PROJECT_ENGINEER *(→ ESTIMATOR)* | Full | Read | Full (documents: RFIs/submittals/drawings/change events) | — | — | Read | — | — | — |
| FIELD_WORKER / HOURLY_EMPLOYEE | Full (My Day) | — | Read (assigned) | Self | — | Full (own) | Read (training) | — | — |
| MAINTENANCE_MANAGER *(→ FIELD_WORKER)* | Full (My Day) | — | Read (assigned) | Self, plus Read on equipment/maintenance registry | — | Full (own) + Read (equipment work orders) | Read (training) | — | — |
| EQUIPMENT_MANAGER *(→ FIELD_WORKER)* | Full (My Day) | — | Read (assigned) | Self, plus Read on equipment/maintenance registry | — | Full (own) + Read (equipment assignments) | Read (training) | — | — |
| HUSTLER | Full (portfolio) | Read | Read | Read | Read | — | Read | — | Read |
| VENDOR | — (out of scope, see §6) | — | — | — | — | — | — | — | — |

Every cell is enforced twice, exactly as on web: the mobile nav / screen
registry hides items the role cannot use (UX layer, not a security
boundary), and every API call is re-checked server-side by the existing
`requireRole` / `requireFeature` middleware, the canonical-role remap
above, and Postgres RLS (`docs/architecture/tenant-isolation.md`). The
mobile client must never rely on client-side role checks as its only gate.

`SUPER_ADMIN` is intentionally excluded from the mobile app's role set for
the same reason it is excluded from personas (§3): platform administration
is a desktop-density workflow with no offline or field requirement.
`VENDOR` is intentionally excluded per §6 — served by the existing
responsive web portal instead of a native surface. Both exclusions are
deliberate scope decisions, not omissions — see each feature doc's
Permissions section for the corresponding "—" rationale repeated in
context.

## 5. Core principles

1. **Offline-first, not offline-only.** Every field-data-entry screen
   (time clock, daily reports, photos, punch items, inspections) writes to
   local storage first and queues a sync; read screens show cached data with
   a clear staleness indicator when offline. Screens with no realistic
   offline value (CFO dashboard, CRM pipeline) are online-only and show a
   "requires connection" state instead of pretending to cache.
2. **One conflict-resolution engine, reused, not reinvented.**
   `docs/architecture/mobile-sync.md` is the authoritative, already-shipped
   design for conflict strategy per entity type (dedupe window, merge
   fields, flag-both, last-write-wins, append-only) and the Lamport clock
   tie-break contract. This blueprint's [`01-architecture.md`](./01-architecture.md)
   and [`workflows.md`](./workflows.md) reference it rather than
   re-describing the mechanics.
3. **One auth contract, reused, not reinvented.** `docs/api/mobile-auth.md`
   (OAuth mobile-exchange + passkey) is authoritative for how the app
   authenticates. [`security.md`](./security.md) builds secure-storage,
   biometric-unlock, and token-lifecycle guidance on top of it.
4. **Same RBAC, same tenant isolation, no shortcuts.** The mobile API
   surface is the same Express routes, same RLS-scoped Postgres. Mobile does
   not get a "lighter" auth or a bespoke read replica with weaker isolation.
5. **Explicit, visible failure over silent data loss.** Sync conflicts are
   surfaced to the right human (see `mobile-sync.md` PM Playbook) rather than
   auto-resolved in a way that could silently overwrite payroll- or
   compliance-sensitive data.
6. **Every module gets real mobile treatment, not a WebView wrapper.**
   Desktop-density modules (CFO Dashboard, Website Builder, Super Admin) are
   deliberately reduced to a read-only or "open in browser" surface on
   mobile rather than force-fit into a phone screen — see each module's
   feature doc under [`features/`](./features/).

## 6. What's explicitly out of scope for the native app (v1)

- **Vendor/Sub/Client portal** — already served by the responsive web portal
  (`/portal`, `client-portal`, `sub-portal`); no native app needed since
  these personas are not construction-company employees and don't need
  offline field capture.
- **Website Builder, Social Media Scheduler, Super Admin platform tools** —
  desktop-density, non-time-sensitive; mobile shows a "manage on web" card
  linking out via a deep link / universal link to the equivalent web page.
- **BIM 3D viewer, LiDAR point-cloud analysis** — heavy client-side compute
  and desktop input patterns (orbit/pan/measure with mouse); mobile shows
  the 2D takeoff/plan viewer only in v1. Full BIM/LiDAR parity is a
  post-v1 roadmap item, not a present target (see
  [`scalability.md`](./scalability.md) §"Future roadmap").

## 7. Relationship to legacy Feature-G spec

`docs/feature-G-mobile-offline.md` is the original 2025-era planning spec.
Its device-registration and sync endpoint shapes (`/api/mobile/register-device`,
`/api/mobile/sync`) were **never implemented as designed** — they were
superseded by the shipped `mobile_devices` / `mobile_sync_events` /
`GET|POST /api/ai-features/mobile/sync` design documented in
`docs/architecture/mobile-sync.md`. Treat Feature-G as historical context
only; every API shape, schema table, and conflict-resolution rule in this
blueprint follows `mobile-sync.md` and `mobile-auth.md`, not Feature-G. The
trade-specific tool configuration section of Feature-G (roofing/electrical/
plumbing/etc. mobile tool sets) has **not** shipped anywhere in the current
codebase and is called out as a proposed, unbuilt idea in
[`features/field-ops.md`](./features/field-ops.md) rather than treated as
ground truth.

## 8. Document set

See [`README.md`](./README.md) for the full index and reading order.
