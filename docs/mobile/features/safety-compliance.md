# Mobile Feature: Safety & Compliance

> Mirrors `docs/module-directory.md` §7 (Safety & Compliance). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Safety & Compliance is, alongside time clock and daily reports, one of the
app's strongest offline-first use cases: safety observations, incident
capture, and heavy-civil DOT inspections (daily inspector reports, SWPPP)
routinely happen at remote sites with no connectivity.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| Safety Hub | `SafetyHubPage.tsx` | Tabbed: Incidents, Observations, Training — mirrors the web tab-deep-linking pattern (`docs/architecture/decisions.md` "URL Tab Deep-linking") using the same `?tab=` convention adapted to a native segmented control. |
| Report Incident | `incidentReviewRoutes` backing UI | Full offline create with photo — an OSHA-reportable incident must never be lost to a connectivity gap. |
| Safety Observation | `safetyObservationsRoutes` backing UI | Full offline create, camera-first, similar to punch list capture. |
| Safety Training | `safety-training.tsx` | Read-only training record + expiry status for self; FIELD_WORKER-only placement per the web nav rule (`decisions.md` "Safety Training / Sequences Nav Cleanup") is mirrored on mobile — other roles reach it via the Safety Hub tab, not a standalone nav item. |
| Compliance Dashboard | `CompliancePage.tsx` | Read-only license/cert/insurance expiry summary; ADMIN/MANAGER/SUPERINTENDENT/HUSTLER only. |
| Daily Inspector Reports (DOT) | `daily-inspector-reports.tsx` | Full offline create — the canonical "remote highway site, no signal" scenario driving this whole blueprint's offline-first requirement. |
| SWPPP Inspections | `swppp-inspections.tsx` | Full offline create, GPS + photo. |
| Material Certifications | `material-certifications.tsx` | Read + attach a cert photo/document offline. |

## 3. Offline behavior

| Data | Offline read | Offline write |
| --- | --- | --- |
| Incidents | Cached list | Outbox, `APPEND_ONLY`; never silently discarded — see explicit failure-surfacing principle in `00-overview.md` §5 |
| Observations | Cached list | Outbox, `APPEND_ONLY` |
| Training records | Cached | N/A (read-only on mobile) |
| Compliance dashboard | Cached, staleness-labeled | N/A |
| Daily inspector reports / SWPPP | N/A (creation-heavy) | Outbox, `LAST_WRITE_WINS` per `ENTITY_STRATEGY_MAP` (`shared/schema/features/mobileSync.ts`) — a resubmission/edit of the same in-progress report before the office reviews it resolves to the latest write, camera + GPS bundled per submission |
| Material certifications | Cached | Attachment upload queues like any media capture |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/safety/incidents` | GET/POST | — |
| `/api/safety/observations` | GET/POST | — |
| `/api/safety/training` | GET | Read-only |
| `/api/compliance/dashboard` | GET | — |
| `/api/dot/daily-inspector-reports` | GET/POST | — |
| `/api/dot/swppp-inspections` | GET/POST | — |
| `/api/dot/material-certifications` | GET/POST | — |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap. `SAFETY_MANAGER` (→ `SUPERINTENDENT`) is the
> one specialist with a real carve-out here: Safety & Compliance is its
> primary landing tab (incident/observation entry, training/cert tracking,
> jobsite roster), rather than a secondary tab as for plain
> `SUPERINTENDENT`. `HR_MANAGER` (→ `MANAGER`) gets a certifications/
> performance read emphasis but no additional write access beyond
> `MANAGER`'s row.

| Role | Incidents/Observations | Training (own) | Compliance dashboard | DOT reports (heavy civil) |
| --- | --- | --- | --- | --- |
| ADMIN | Full | Read | Full | Full |
| MANAGER | Full | Read | Full | Full |
| SUPERINTENDENT | Full | Read | Full | Full |
| ESTIMATOR | Read | Read | Read | Read |
| HUSTLER | Full | Read | Full | Full |
| FIELD_WORKER | Create observation/incident; own training read | Read | No | No (requires ADMIN/MANAGER/SUPERINTENDENT/ESTIMATOR/HUSTLER per web RBAC) |
| VENDOR | Vendor compliance portal only, not native app | — | — | — |

## 6. Gaps vs. today

- No new backend routes required. This module is the strongest existing
  case for mobile offline value, and it inherits the general-purpose
  `APPEND_ONLY` conflict strategy from `mobile-sync.md` without needing a
  bespoke rule — worth flagging in `01-architecture.md`/`workflows.md` as
  the reference case when explaining append-only entities to a new
  contributor.
