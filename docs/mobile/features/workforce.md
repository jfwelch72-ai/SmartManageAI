# Mobile Feature: Workforce

> Mirrors `docs/module-directory.md` §4 (Workforce). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Workforce — specifically **time clock** — is the single highest-priority
mobile surface in the entire app: it is the payroll-sensitive, GPS-tracked,
offline-critical flow every field employee uses every day. This doc treats
time clock with the most detail; the rest of Workforce (crews, payroll,
hiring) is largely manager-facing and read-mostly on mobile.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| Time Clock (self-service) | `time-clock.tsx` | Primary field-worker screen: big clock-in/out button, GPS capture, project/cost-code picker, break tracking. |
| Time Clock Manager | `time-clock-manager.tsx` | SUPERINTENDENT/MANAGER: review + approve crew time; gap/anomaly flags surfaced inline (`mobile-sync.md` Time Clock Risk Audit). |
| Time Entry (manual) | `time-entry.tsx` | Manual correction entry when clock in/out was missed — same offline posture as clock events. |
| Crews | `crews.tsx` | Read-only crew roster + today's assignment; no crew editing on mobile. |
| Leave Requests | `leave-management.tsx` | Submit/view own leave requests (FIELD_WORKER+); approve (SUPERINTENDENT/MANAGER+). |
| Payroll / Certified Payroll | `payroll-management.tsx` | **Not on mobile** — payroll run creation and certified payroll export are desktop/compliance workflows; mobile shows a "view your pay stub" read-only card at most, sourced from the same payroll data. |
| Hiring (ATS) | `hiring/*` | **Not on mobile v1** — interview scheduling notifications may deep-link to a read-only candidate summary, but the ATS pipeline itself is desktop-only. |

## 3. Offline behavior — Time Clock (authoritative detail)

This section operationalizes `docs/architecture/mobile-sync.md`'s Time
Clock Risk Audit and conflict-strategy table for the mobile client:

- **Clock in/out events are append-only** on the wire (`mobile-sync.md`).
  Every tap creates a new local event row immediately, timestamped with
  device clock + GPS, and tagged with the device's Lamport clock value
  before any network call is attempted.
- **Dedup, not merge, on sync.** If the same physical clock-in reaches the
  server twice (e.g., app retried after a timeout that actually succeeded),
  the server-side dedupe window (per `mobile-sync.md`) collapses it to one
  event — the client never needs its own idempotency logic beyond sending a
  stable client-generated event ID with every push.
- **Gap detection surfaces, never auto-fixes.** If the sync coordinator
  detects a missing clock-out (e.g., app was killed mid-shift and reopened
  the next day), the Time Clock screen shows an explicit "you have an open
  shift from yesterday — clock out now or submit a correction" prompt
  rather than silently closing it at midnight or at reopen time. This
  mirrors the audit's core finding: silent gap-filling risks incorrect
  payroll hours.
- **GPS capture is best-effort, not blocking.** If location permission is
  denied or GPS fix fails, the clock event still records locally with
  `location: null` and a `locationError` reason — the worker is never
  blocked from clocking in/out because of a GPS problem, since blocking
  payroll-critical data entry on a device permission is a worse outcome
  than a missing coordinate. This is flagged as a deliberate UX decision,
  not present as an explicit rule in `mobile-sync.md`, so it should be
  confirmed with the payroll/compliance stakeholder before launch.
- **Approval (Time Clock Manager) is online-first.** A supervisor's
  approve/reject of a subordinate's time is treated the same as a
  change-order approval (see `features/projects.md` §3) — it is not queued
  offline, to avoid a manager approving stale, about-to-conflict data.

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/time-clock/events` | POST | Clock in/out; carries client-generated event ID + Lamport clock per `mobile-sync.md` |
| `/api/time-clock/events` | GET | Pull for reconciliation / manager view |
| `/api/time-clock/approve` | POST | Manager approval, online-only |
| `/api/time-entries` | GET/POST | Manual entries; pagination backlog #4 in `docs/api/pagination.md` |
| `/api/crews` | GET | Read-only roster |
| `/api/leave-requests` | GET/POST/PATCH | Submit/approve leave |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap (e.g. `OFFICE_MANAGER`/`HR_MANAGER` → `MANAGER`,
> `MAINTENANCE_MANAGER`/`EQUIPMENT_MANAGER`/`HOURLY_EMPLOYEE` →
> `FIELD_WORKER`) that this table's rows resolve to server-side.

| Role | Own time clock | Approve crew time | Manual time entry | Crews (read) | Leave (submit) | Leave (approve) |
| --- | --- | --- | --- | --- | --- | --- |
| ADMIN | Yes | Yes | Yes | Yes | Yes | Yes |
| MANAGER | Yes | Yes | Yes | Yes | Yes | Yes |
| SUPERINTENDENT | Yes | Yes (assigned crews) | Yes | Yes | Yes | Yes |
| ESTIMATOR | Yes (self) | No | No | Read | Yes | No |
| FIELD_WORKER / HOURLY_EMPLOYEE | Yes (self, GPS-tracked) | No | Self only | Read | Yes | No |
| HUSTLER | Read across linked orgs | No (mobile) | No | Read | No | No |
| VENDOR | No | No | No | No | No | No |

## 6. Gaps vs. today

- The GPS-optional clock-in fallback behavior described in §3 is a proposed
  UX rule for this blueprint, not something already specified in
  `mobile-sync.md` — call it out to the payroll/compliance owner before
  implementation, since it affects a payroll-sensitive record.
- Payroll run creation, certified payroll export, and the full hiring ATS
  pipeline are explicitly out of scope for native mobile v1 (desktop-density
  compliance workflows).
