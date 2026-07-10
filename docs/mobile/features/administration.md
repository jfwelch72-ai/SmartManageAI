# Mobile Feature: Administration

> Mirrors `docs/module-directory.md` §8 (Administration). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Administration (company settings, branding, feature flags, AI settings,
audit logs, website builder, integrations, Super Admin platform tools) is
the module with the least mobile value — it is fundamentally desktop
configuration work. Mobile's role is limited to personal account settings
and a lightweight audit-log glance for ADMIN.

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| Profile & Account Settings | `profile.tsx` | Full: name, avatar, password change, MFA enroll/disable, notification preferences. This is the one Administration screen every role uses. |
| Notification Preferences | (part of `settings.tsx`) | Full — includes the mobile push toggle introduced by this blueprint (`01-architecture.md` §7). |
| Audit Log Glance (ADMIN) | `audit-logs.tsx` | Read-only, recent-N rows, no export/filter UI; "view full log" deep-links to web. |
| Company Settings, AI Settings, Feature Flags, Website Builder, Integrations, Super Admin | — | **Not on mobile.** Each shows a "manage on web" card that deep-links (universal-link fallback) to the equivalent desktop page, per `00-overview.md` §6. |

## 3. Offline behavior

| Data | Offline read | Offline write |
| --- | --- | --- |
| Profile settings | Cached | Queued, `LAST_WRITE_WINS` (a settings change is idempotent and low-conflict-risk) |
| MFA enable/disable | N/A | **Online-only** — an auth-security-sensitive change should never be queued and silently applied later, matching the audited-and-online posture of money-path actions elsewhere in this blueprint |
| Notification preferences | Cached | Queued, `LAST_WRITE_WINS` |
| Audit log glance | Cached last-fetched page | N/A (read-only) |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/account/profile` | GET/PATCH | — |
| `/api/account/2fa/verify` | POST | MFA enable, online-only, audited (`threat_model.md` §5.5) |
| `/api/account/2fa/disable` | POST | MFA disable, online-only, audited |
| `/api/notification-preferences` | GET/PATCH | — |
| `/api/audit-logs` | GET | Already supports the pagination envelope (`docs/api/pagination.md`) — mobile should use `?pageSize=` directly. |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap. Administration has no per-specialist
> carve-outs — every legacy role (`OFFICE_MANAGER`, `HR_MANAGER`, `SALES`,
> `MARKETING`, `PROCUREMENT_MANAGER`, `SAFETY_MANAGER`, `DISPATCHER`,
> `PROJECT_ENGINEER`, `MAINTENANCE_MANAGER`, `EQUIPMENT_MANAGER`,
> `HOURLY_EMPLOYEE`) inherits exactly its canonical parent's row below,
> since profile/MFA/self-audit-glance are identity-level, not job-role
> features.

| Role | Profile/settings | MFA | Audit log glance |
| --- | --- | --- | --- |
| ADMIN | Full | Full | Full |
| HUSTLER | Full | Full | Full |
| MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER | Full (own profile only) | Full (own) | No |
| VENDOR | Not in mobile persona set | — | — |

## 6. Gaps vs. today

- No new backend routes required. This module's mobile footprint is
  intentionally minimal — the risk here is scope creep (trying to port
  Company Settings/Feature Flags/Website Builder to a phone screen), not a
  missing capability.
