# Mobile Feature: Finance

> Mirrors `docs/module-directory.md` §5 (Finance). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Finance (CFO dashboard, AIA billing, T&M billing, payables, WIP report) is
the most read-heavy, online-first module in the mobile app. The mobile job
here is "glance at the numbers and approve what's in front of me," not
"build a pay application" or "reconcile the WIP schedule" — those stay
desktop-density.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| CFO Snapshot | `cfo-dashboard.tsx` | Read-only KPI cards (AR, cash position, project profitability); online-only, no offline cache (numbers must never be shown stale without a clear warning on a financial screen — see `ui-ux.md` §6 for the staleness-banner pattern applied strictly here). |
| Pay App Approvals | `progress-billing.tsx` (approval sub-flow only) | MANAGER/ADMIN can approve/reject a pending AIA pay application from mobile; building/editing the SOV or G702/G703 itself stays web-only. |
| T&M Ticket Review | `tm-billing.tsx` (review only) | Read T&M tickets pending billing review; approve/flag; full invoicing workflow stays web. |
| Payables Snapshot | `subcontractor-payables.tsx` | Read-only list of payables/lien-waiver status; no payment initiation on mobile. |
| WIP Report | `wip-report.tsx` | Read-only summary card, online-only. |

## 3. Offline behavior

Finance is treated as **online-first across the board** — every screen in
this module either shows a live value or an explicit "requires connection"
state. No Finance screen silently serves a stale cached number without a
visible "as of" timestamp, and no Finance write (approval, flag) is queued
offline:

| Data | Offline read | Offline write |
| --- | --- | --- |
| CFO KPIs, WIP | Not cached (online-only) | N/A |
| Pay app / T&M approvals | Last-fetched list cached, read-only when offline | Approve/reject disabled offline |
| Payables | Last-fetched list cached, read-only when offline | N/A (no mobile write) |

This is the strictest module in the app with respect to offline posture,
matching the money-path caution in `threat_model.md` §5 (audit-log coverage
requirement) — an offline-queued financial approval that later fails
validation server-side (e.g., pay app was already voided) is a worse
outcome than requiring a live connection.

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/cfo/kpis` | GET | Read-only snapshot |
| `/api/aia/pay-applications` | GET | List pending approvals |
| `/api/aia/pay-applications/:id/status` | POST | Approve/reject — audited per `threat_model.md` §5.5 (AIA pay apps already covered) |
| `/api/tm/tickets` | GET | Review list |
| `/api/tm/tickets/:id/flag` | POST | Flag for review |
| `/api/payables` | GET | Read-only |
| `/api/wip-report` | GET | Read-only summary |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap. `OFFICE_MANAGER` and `HR_MANAGER` resolve to
> `MANAGER`'s row (payroll/payables emphasis carried in their web role, not
> a wider mobile grant); `SALES`/`MARKETING`/`PROCUREMENT_MANAGER` also
> resolve to `MANAGER` but have no additional Finance carve-out.

| Role | CFO snapshot | Pay app approve | T&M review | Payables | WIP |
| --- | --- | --- | --- | --- | --- |
| ADMIN | Yes | Yes | Yes | Yes | Yes |
| MANAGER | Yes | Yes | Yes | Yes | Yes |
| HUSTLER | Yes (cross-org, read) | No (cross-org money actions stay web) | Read | Read | Read |
| SUPERINTENDENT | Read (per web parity: dashboard/historical only) | No | No | No | No |
| ESTIMATOR | No | No | No | No | No |
| FIELD_WORKER, VENDOR | No | No | No | No | No |

## 6. Gaps vs. today

- No new backend routes required — every Finance mobile screen consumes
  existing read/approval endpoints from `server/aiaBillingRoutes.ts`,
  `server/tmRoutes.ts`, `server/subcontractorPayablesRoutes.ts`, matching
  the "no new business rules for mobile" principle in `00-overview.md`.
