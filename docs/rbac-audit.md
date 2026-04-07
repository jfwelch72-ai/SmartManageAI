# RBAC Audit — Roles, Permissions & Sidebar Navigation

**Date:** 2026-04-07  
**Source of truth:** `server/dashboardRoutes.ts` (server-side defaults), `client/src/lib/rbac.ts` (client-side visibility)

---

## Table of Contents

1. [Role Definitions](#1-role-definitions)
2. [Permission Matrix](#2-permission-matrix)
3. [Sidebar Navigation Map](#3-sidebar-navigation-map)
4. [Enforcement Layers](#4-enforcement-layers)
5. [Override System](#5-override-system)
6. [Notable Observations](#6-notable-observations)

---

## 1. Role Definitions

| Role | Type | Description |
|------|------|-------------|
| **SUPER_ADMIN** | Platform | Platform administrator — bypasses the org permission system entirely, has a dedicated admin panel. Not included in `CORE_ROLES`. |
| **ADMIN** | Org | Organization admin — full access to everything within their organization including user management. |
| **HUSTLER** | Org | Multi-organization owner — switches between linked orgs via `effectiveRole` mechanism, per-org permissions. Treated as ADMIN-level in linked orgs. |
| **MANAGER** | Org | Management-level — full org features except user management, website builder, and AI settings. Alternate label: "Project Manager". |
| **SUPERINTENDENT** | Org | Field management — project execution, crew oversight, time approvals, equipment, procurement. No bidding-edit or financial-edit access by default. |
| **ESTIMATOR** | Org | Pre-construction — bidding, cost analysis, project creation. No time management, payroll, or hiring access by default. |
| **FIELD_WORKER** | Org | Basic access — time clock, daily notes, active projects only. Highly restricted feature set. |
| **VENDOR** | Org | External vendor portal — submit pricing to enrolled clients, view enrollments, bid inbox. No contractor features. Routed to a separate vendor portal sidebar. |

**Hierarchy (highest to lowest):** SUPER_ADMIN > ADMIN > HUSTLER > MANAGER > SUPERINTENDENT > ESTIMATOR > FIELD_WORKER > VENDOR

**Assignable roles** (can be set by admins): ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER, VENDOR

---

## 2. Permission Matrix

Source of truth: `ROLE_DEFAULT_PERMISSIONS` in `server/dashboardRoutes.ts`.

The code currently defines **79 feature permission keys** (the original task brief referenced 73; the count has grown as features were added). All 79 are covered in the tables below.

- ADMIN = `ALL_TRUE` (every flag true, `canAccessActiveProjectsOnly` = false)
- SUPER_ADMIN = `ALL_TRUE` (copy of ADMIN)
- HUSTLER = `ALL_TRUE` minus `canAccessActiveProjectsOnly`, `canAccessEnterpriseSettings`, `canManageHiringSettings`
- MANAGER = `ALL_TRUE` minus `canAccessActiveProjectsOnly`, `canAccessCostRates`, `canManageWebsite`, `canManageAISettings`, `canAccessEnterpriseSettings`, `canManageHiringSettings`, `canManageUsers`

Key: ✅ = true, ❌ = false. `canAccessActiveProjectsOnly` marked with ⚠️ where true (restricts to ACTIVE projects only).

### Dashboard & Core

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canAccessDashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| canAccessProjects | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canAccessActiveProjectsOnly | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ ✅ | ❌ |
| canCreateProjects | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canEditProjects | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canAccessCalendar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canAccessTasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canAccessMessages | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| canAccessBulletins | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canAccessEmailAssistant | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Bidding

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canViewBids | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canEditBids | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canDeleteBids | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canGenerateBidPDFs | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canConvertBidToProject | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canAccessBidNetworkGC | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canAccessBidNetworkInbox | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| canManageBidResponses | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canDeleteBidRequests | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canAccessHistoricalCosts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canAccessScopeSettings | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canUseAiBidAnalysis | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canUseAiContractAnalysis | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Financials

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canAccessFinancials | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canViewFinancials | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canEditFinancials | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canAccessCostRates | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| canAccessCFODashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canAccessTMBilling | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canAccessProgressBilling | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canManageContracts | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canAccessSubcontracts | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canAccessOverheadCosts | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canAccessProductionRates | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canAccessVendorPricing | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Workforce & Time

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canAccessTimeClock | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canManageTimeClock | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canApproveTime | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canAccessTMDaily | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canManagePayroll | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canManageCrews | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canManageWorkforce | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canManageLeave | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| canManageSafety | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canManageScheduling | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canAccessKPIs | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canLockDailyReports | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

### Equipment & Procurement

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canManageEquipment | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canManageProcurement | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

### CRM & Hiring

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canAccessCRM | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canCreateCRMContacts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canAccessMarketplace | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canManageHiring | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canAccessHiringInterviews | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canManageHiringSettings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Tools & Admin

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canPostSocialMedia | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canManageWebsite | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| canAccessExecutiveDigest | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canUseAiFeatures | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| canViewSafety | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| canViewAiSummaries | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| canAccessCompanySettings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canManageUsers | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| canAccessApprovals | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canAccessAuditLogs | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canAccessReports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canAccessEnterpriseSettings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| canManageAISettings | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Project Tabs

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canViewProjectBudget | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canViewProjectEstimates | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canViewProjectProcurement | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canViewProjectReceipts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canViewProjectTimeEntries | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canViewProjectSubcontractors | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| canCreateChangeOrders | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| canDeleteScopeItems | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| canEditProjectHandoff | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Peer Ratings

| Permission | SUPER_ADMIN | ADMIN | HUSTLER | MANAGER | SUPERINTENDENT | ESTIMATOR | FIELD_WORKER | VENDOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| canSubmitPeerRatings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| canViewPeerRatings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## 3. Sidebar Navigation Map

The sidebar has two distinct behaviors:
- **Pre-perms (role-string fallback):** Before the server-side permissions are fetched, the client uses role-string checks to determine visibility. This is a brief, transient state.
- **Resolved (server defaults applied):** Once permissions load, the client uses the server-provided permission flags exclusively.

The tables below document **resolved visibility** using the server default permissions from Section 2. Where the pre-perms fallback differs, it is noted in Section 6.1.

### 3.1 Super Admin — Platform Sidebar (`PlatformAdminNavConfig`)

SUPER_ADMIN users see a completely separate sidebar with no contractor/org features:

| Item | Path |
|------|------|
| Dashboard | `/admin` |
| Organizations | `/admin/organizations` |
| Analytics | `/admin/analytics` |
| Support Tools | `/admin/tools` |

### 3.2 Vendor — Vendor Portal Sidebar (`VendorPortalNavConfig`)

VENDOR users see a dedicated vendor portal sidebar. All items are unconditionally shown (no permission gates):

| Item | Path |
|------|------|
| Dashboard | `/vendor` |
| Pricing | `/vendor/pricing` |
| Clients | `/vendor/clients` |
| Messages | `/vendor/messages` |
| Bid Inbox | `/bid-network-inbox` |

### 3.3 Field Worker — Simplified Sidebar

FIELD_WORKER users see a flat (non-collapsible) list. Items are shown only if the corresponding permission is `true` in the resolved permission set.

| Item | Path | Permission Gate | Server Default |
|------|------|-----------------|----------------|
| My Time Clock | `/time-clock` | `canAccessTimeClock` | ✅ Visible |
| Projects | `/projects` | `canAccessProjects` | ✅ Visible |
| Tasks | `/tasks` | `canAccessTasks` | ✅ Visible |
| Calendar | `/calendar` | `canAccessCalendar` | ✅ Visible |
| Leave Management | `/leave-management` | `canManageLeave` | ✅ Visible |
| Rate Coworkers | `/rate-coworkers` | `canSubmitPeerRatings` | ✅ Visible |
| Dashboard | `/dashboard` | `canAccessDashboard` | ✅ Visible |
| Bulletins | `/communications` | `canAccessBulletins` | ✅ Visible |

### 3.4 Standard Contractor Sidebar (ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR)

The standard sidebar uses collapsible section groups. Two factors determine item visibility:
1. The item's permission gate (from the resolved permission set)
2. Whether the section is included in the role's section order

The section order varies by role via `ROLE_SECTION_ORDER`. If a section is not in the role's order, all its items are hidden regardless of permissions.

**Default order** (used by ADMIN, HUSTLER, MANAGER):
`portfolio > dashboard > bulletins > projects > operations > workforce > preconstruction > marketplace > crm > financials > insights > hiring > administration > tools`

**SUPERINTENDENT order:**
`operations > workforce > dashboard > bulletins > projects > preconstruction > financials > administration`

**ESTIMATOR order:**
`preconstruction > operations > dashboard > bulletins > financials > projects > crm > marketplace > administration`

#### Portfolio (HUSTLER only)

| Item | Path | Note |
|------|------|------|
| Portfolio | `/hustler` | Only rendered when the user's original role is HUSTLER |

#### Dashboard (always visible)

| Item | Path |
|------|------|
| Dashboard | `/dashboard` |

#### Bulletins (always visible for contractors)

| Item | Path |
|------|------|
| Bulletins | `/communications` |

#### Projects Section

Included in section order for: ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Calendar | `/calendar` | `canAccessCalendar` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |
| Email Assistant | `/email-assistant` | `canAccessEmailAssistant` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌, ESTIMATOR ❌ |
| Projects | `/projects` | `canAccessProjects` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |
| Tasks | `/tasks` | `canAccessTasks` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |
| Messages | `/messages` | `canAccessMessages` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |

#### Preconstruction Section

Included in section order for: ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Bids | `/bids` | `canViewBids` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |
| Bid Network | `/bid-network` | `canAccessBidNetworkGC` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌, ESTIMATOR ✅ |
| Historical Costs | `/historical-costs` | `canAccessHistoricalCosts` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |

#### Operations Section

Included in section order for: ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Equipment | `/equipment` | `canManageEquipment` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ❌ |
| Procurement | `/procurement-module` | `canManageProcurement` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ❌ |

#### Workforce & Labor Section

Included in section order for: ADMIN, HUSTLER, MANAGER, SUPERINTENDENT (not ESTIMATOR)

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| My Time Clock | `/time-clock` | `canAccessTimeClock` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅ |
| Manage Time Clock | `/time-clock-manager` | `canManageTimeClock` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅ |
| T&M Daily Sheets | `/tm-daily` | `canAccessTMDaily` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅ |
| Crews & Skills | `/crews` | `canManageCrews` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌ |
| Workforce Management | `/manage-workers` | `canManageWorkforce` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅ |
| Rate Coworkers | `/rate-coworkers` | `canSubmitPeerRatings` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅ |
| Payroll Management | `/payroll-management` | `canManagePayroll` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌ |
| Safety Training | `/safety-training` | `canManageSafety` or `canViewSafety` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅ |
| Leave Management | `/leave-management` | `canManageLeave` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌ |

#### Financials Section

Included in section order for: ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| CFO Dashboard | `/cfo-dashboard` | `canAccessCFODashboard` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ❌ |
| T&M Billing | `/tm-billing` | `canAccessTMBilling` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌, ESTIMATOR ❌ |
| AIA / Progress Billing | `/progress-billing` | `canAccessProgressBilling` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌, ESTIMATOR ❌ |
| Cost Rates | `/cost-rates` | `canAccessCostRates` | ADMIN ✅, HUSTLER ✅, MANAGER ❌, SUPERINTENDENT ❌, ESTIMATOR ✅ |
| Production Rates | `/production-rates` | `canAccessProductionRates` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |
| Subcontractor Payables | `/subcontractor-payables` | `canAccessSubcontracts` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ❌ |
| Overhead Costs | `/overhead-costs` | `canAccessOverheadCosts` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌, ESTIMATOR ❌ |

#### CRM Section

Included in section order for: ADMIN, HUSTLER, MANAGER, ESTIMATOR (not SUPERINTENDENT)

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| CRM | `/crm` | `canAccessCRM` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, ESTIMATOR ✅ |

#### Marketplace Section

Included in section order for: ADMIN, HUSTLER, MANAGER, ESTIMATOR (not SUPERINTENDENT)

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Marketplace | `/marketplace` | `canAccessMarketplace` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, ESTIMATOR ❌ |

#### Insights Section

Included in section order for: ADMIN, HUSTLER, MANAGER (not SUPERINTENDENT, not ESTIMATOR)

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Executive Digest | `/executive-digest` | `canAccessExecutiveDigest` | ADMIN ✅, HUSTLER ✅, MANAGER ✅ |

#### Hiring Section

Included in section order for: ADMIN, HUSTLER, MANAGER (not SUPERINTENDENT, not ESTIMATOR)

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Hiring | `/hiring` | `canManageHiring` | ADMIN ✅, HUSTLER ✅, MANAGER ✅ |

#### Administration Section

Included in section order for: ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| User Management | `/users` | `canManageUsers` | ADMIN ✅, HUSTLER ✅, MANAGER ❌, SUPERINTENDENT ❌, ESTIMATOR ❌ |
| Company Settings | `/company-settings` | `canAccessCompanySettings` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ✅, ESTIMATOR ✅ |
| Scope Settings | `/scope-settings` | `canAccessScopeSettings` | ADMIN ✅, HUSTLER ✅, MANAGER ✅, SUPERINTENDENT ❌, ESTIMATOR ✅ |
| AI Settings | `/ai-settings` | `canManageAISettings` | ADMIN ✅, HUSTLER ✅, MANAGER ❌, SUPERINTENDENT ❌, ESTIMATOR ❌ |

#### Tools Section

Included in section order for: ADMIN, HUSTLER, MANAGER (not SUPERINTENDENT, not ESTIMATOR)

| Item | Path | Permission Gate | Resolved Visibility |
|------|------|-----------------|---------------------|
| Website Builder | `/website-builder` | `canManageWebsite` | ADMIN ✅, HUSTLER ✅, MANAGER ❌ |
| Social Media | `/social-media` | `canPostSocialMedia` | ADMIN ✅, HUSTLER ✅, MANAGER ✅ |

---

## 4. Enforcement Layers

The platform enforces access through three distinct middleware layers:

### 4.1 Role-Based Middleware (`requireRole`)
**Location:** `server/auth.ts`

Checks whether the user's role (or `effectiveRole` for Hustler users) matches one of the allowed roles. Returns 403 if neither the effective role nor the original role matches. This is a hard gate — no permission overrides apply.

```
requireRole("ADMIN", "MANAGER")  // Only ADMIN or MANAGER can access
```

### 4.2 Feature Permission Middleware (`requireFeaturePermission` / `requireRoleOrFeature`)
**Location:** `server/auth.ts`

- **`requireFeaturePermission(permKey)`** — Resolves the user's effective permissions (role defaults merged with DB overrides) and checks if the specified permission key is `true`. Returns 403 if not.
- **`requireAnyFeaturePermission(...permKeys)`** — Same as above but passes if any of the specified keys is true.
- **`requireRoleOrFeature(roles, permKey)`** — First checks role membership (fast path), then falls back to checking the feature permission. This hybrid approach lets routes accept either a role match or a specific permission override.

### 4.3 Subscription / Feature Gating (`requireFeature`)
**Location:** `server/middleware/requireFeature.ts`

Checks whether the user's organization has access to a feature based on its subscription plan tier and active add-ons. SUPER_ADMIN bypasses this check entirely. Returns a 403 with `upgradeRequired: true` if the org's plan does not include the feature. This layer is orthogonal to role/permission checks — a user may have the correct role but still be blocked if their org isn't subscribed.

---

## 5. Override System

### 5.1 Per-User Overrides via `user_dashboard_permissions`

Each user can have a row in the `user_dashboard_permissions` table (keyed by `userId` + `organizationId`) that stores boolean overrides for any of the 79 feature permission keys. This allows admins to grant or revoke individual permissions beyond what the role defaults provide.

### 5.2 Merge Logic (`mergePermissions`)
**Location:** `server/dashboardRoutes.ts`

```
mergePermissions(roleDefaults, dbPerms) -> effectivePermissions
```

1. Start with a copy of the role's default permission set.
2. For each key in the DB overrides object, if the value is a `boolean`, overwrite the role default with that value.

This is a straightforward overlay: DB overrides can both **grant** permissions the role doesn't have and **revoke** permissions the role normally has.

### 5.3 Effective Permission Resolution (`getEffectivePermissions`)
**Location:** `server/auth.ts`

1. If the user is `SUPER_ADMIN`, return `getRoleDefaults("SUPER_ADMIN")` immediately (no DB lookup).
2. Otherwise, fetch role defaults for the user's effective role.
3. If the user has an `organizationId`, query `user_dashboard_permissions` for that user+org pair.
4. If a row exists, extract boolean values into a partial overrides object.
5. **Special case:** If the DB row has `canAccessFinancials === true`, the overrides object also forces `canViewFinancials` and `canEditFinancials` to `true`. This auto-expansion happens before the merge step.
6. Call `mergePermissions(roleDefaults, dbPerms)` to produce the final effective set.

### 5.4 Hustler `effectiveRole` Mechanism

When a HUSTLER user switches to a linked organization, their `effectiveRole` is set (typically to `ADMIN`) for that org. This value can also be overridden via a `roleOverride` mechanism. The middleware checks both the `effectiveRole` and the original `role` — this means a HUSTLER operating in a linked org passes both the effective role's checks and `HUSTLER` role checks. Permission resolution uses `effectiveRole` to look up role defaults, so a Hustler in a linked org gets the effective role's defaults (ADMIN-level by default) for that org.

---

## 6. Notable Observations

### 6.1 Client-Side Fallback vs. Server Default Discrepancies

**Methodology note:** Server-side defaults (`ROLE_DEFAULT_PERMISSIONS`) are the authoritative source of truth. Client-side role-string fallbacks in `rbac.ts` are transient UI-only hints that activate before the async permission fetch completes. Once perms load, the client exclusively uses server-provided flags. Discrepancies below are cosmetic flash-of-content issues, not security gaps.

#### Over-visibility (fallback shows items the server denies)

| Sidebar Item | Permission Gate | Client Fallback Roles | Server Default Grants | Affected Roles |
|---|---|---|---|---|
| Marketplace | `canAccessMarketplace` | `hasManagementAccess`: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, HUSTLER | ADMIN, HUSTLER, MANAGER only | SUPERINTENDENT, ESTIMATOR see it briefly then it disappears |
| Leave Management | `canManageLeave` | `hasContractorAccess`: all contractor roles | ADMIN, HUSTLER, MANAGER, FIELD_WORKER only | SUPERINTENDENT, ESTIMATOR see it briefly then it disappears |
| Procurement | `canManageProcurement` | `hasProcurementAccess`: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, HUSTLER | ADMIN, HUSTLER, MANAGER, SUPERINTENDENT only | ESTIMATOR sees it briefly then it disappears |
| Email Assistant | `canAccessEmailAssistant` | `hasManagementAccess`: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, HUSTLER | ADMIN, HUSTLER, MANAGER only | SUPERINTENDENT, ESTIMATOR see it briefly then it disappears |
| Scope Settings | `canAccessScopeSettings` | ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT, HUSTLER | ADMIN, HUSTLER, MANAGER, ESTIMATOR only | SUPERINTENDENT sees it briefly then it disappears |

#### Under-visibility (fallback hides items the server grants)

| Sidebar Item / Route | Permission Gate | Client Fallback Roles | Server Default Grants | Affected Roles |
|---|---|---|---|---|
| Subcontractor Payables | `canAccessSubcontracts` | `isOrganizationAdmin` or HUSTLER | ADMIN, HUSTLER, MANAGER, SUPERINTENDENT | MANAGER, SUPERINTENDENT have server permission but fallback hides it before perms load |
| Executive Digest | `canAccessExecutiveDigest` | ADMIN, HUSTLER only | ADMIN, HUSTLER, MANAGER (MANAGER has `ALL_TRUE`) | MANAGER is denied by fallback but granted once perms load |

**Note:** Sidebar menu visibility is separate from route-level authorization. A missing sidebar entry does not prevent access if the user navigates directly to the URL and the server-side permission check passes.

### 6.2 Section Order Gaps — Permissions Granted but Sidebar Hidden

Some roles have server-default permissions set to `true` for features whose sidebar section is excluded from their `ROLE_SECTION_ORDER`. The permission still works via direct URL access, but the item has no sidebar entry.

| Role | Permission Granted | Sidebar Item | Missing Section |
|---|---|---|---|
| SUPERINTENDENT | `canAccessCRM: true` | CRM | `crm` not in SUPERINTENDENT section order |
| ESTIMATOR | `canAccessTimeClock: true` | My Time Clock | `workforce` not in ESTIMATOR section order |
| ESTIMATOR | `canSubmitPeerRatings: true` | Rate Coworkers | `workforce` not in ESTIMATOR section order |

### 6.3 Vendor Isolation

The VENDOR role is well-isolated: it has its own dedicated sidebar (`VendorPortalNavConfig`), its own routes (`/vendor/*`), and only 3 server-side permissions (`canAccessDashboard`, `canAccessMessages`, `canAccessBidNetworkInbox`). The vendor sidebar items are unconditionally shown without per-item permission gates.

### 6.4 SUPER_ADMIN Gets Full Permissions But Separate Sidebar

SUPER_ADMIN's server-side permission set is a copy of `ALL_TRUE` (identical to ADMIN). However, the sidebar renders a completely separate admin panel (`PlatformAdminNavConfig`) with only 4 items. SUPER_ADMIN would pass any `requireFeaturePermission` check, but they don't see any org-level sidebar items. This is intentional — SUPER_ADMIN is meant for platform management, not org operations.

### 6.5 `canAccessActiveProjectsOnly` Is Not a True Permission

This flag is unique: setting it to `true` **restricts** access (limits to ACTIVE projects only), unlike every other flag which **grants** access. It is set to `true` only for FIELD_WORKER. In `ALL_TRUE` it is explicitly set to `false` (meaning no restriction). This inverted semantics could be confusing for admins configuring overrides.

### 6.6 `canAccessFinancials` Auto-Expansion in DB Overrides

When `canAccessFinancials` is set to `true` in a DB override, `getEffectivePermissions` automatically forces `canViewFinancials` and `canEditFinancials` to `true` as well. This means a DB override of `canAccessFinancials: true` cannot grant view-only access — it always includes edit access. The only way to have `canAccessFinancials` with `canEditFinancials: false` is through role defaults (as SUPERINTENDENT and ESTIMATOR do).
