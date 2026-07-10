# Mobile Feature: Reports

> Mirrors `docs/module-directory.md` §9 (Reports). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Reports (report library, KPI management, company health, bid analytics) is
read-only on mobile across the board — report *generation/export* (CSV/PDF)
is a desktop workflow; the mobile job is checking a KPI or company-health
score while away from a desk.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| My KPIs | `my-kpis.tsx` | Full — personal KPI cards, the one genuinely mobile-native surface in this module. |
| Company Health | `company-health.tsx` | Read-only scorecard. |
| Report Library | `reports.tsx` | Read-only list of pre-built reports; tapping one shows a summary view, not the full export UI — "open full report on web" deep-link for anything requiring CSV/PDF export. |
| Bid Analytics | `bid-hit-rate.tsx` | Read-only summary, ADMIN/MANAGER/ESTIMATOR/SUPERINTENDENT/HUSTLER. |
| Cross-org Benchmarking (HUSTLER) | `hustler-benchmarking.tsx` | Read-only, online-only. |

## 3. Offline behavior

Reports mirrors Finance's online-first posture (§3 of `features/finance.md`):
every screen shows either a live value with a staleness timestamp when
cached, or an explicit "requires connection" state. No report data is
editable, so there is no write/outbox story for this module at all.

| Data | Offline read | Offline write |
| --- | --- | --- |
| My KPIs | Cached, staleness-labeled | N/A |
| Company Health | Cached | N/A |
| Report Library summaries | Cached | N/A |
| Bid Analytics / Benchmarking | Not cached (online-only) | N/A |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/my-kpis` | GET | — |
| `/api/company-health` | GET | — |
| `/api/reports` | GET | List/summary only on mobile |
| `/api/bids/analytics` | GET | — |
| `/api/hustler/benchmarking` | GET | HUSTLER only |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap this table's rows resolve to server-side.
> `MARKETING` (→ `MANAGER`) gets a CRM-analytics-flavored Report Library
> filter; no other legacy specialist has a Reports-specific carve-out.

| Role | My KPIs | Company Health | Report Library | Bid Analytics |
| --- | --- | --- | --- | --- |
| ADMIN | Yes | Yes | Yes | Yes |
| MANAGER | Yes | Yes | Yes | Yes |
| ESTIMATOR | Yes | Yes | Yes | Yes |
| SUPERINTENDENT | Yes | Yes | Yes | Yes |
| HUSTLER | Yes | Yes | Yes | Yes (+ cross-org benchmarking) |
| FIELD_WORKER | No (per web RBAC — Reports has no FIELD_WORKER access) | No | No | No |
| VENDOR | No | No | No | No |

## 6. Gaps vs. today

- No new backend routes required — Reports is a pure read consumer of
  existing endpoints, with export/generation functionality deliberately
  excluded from the native app.
