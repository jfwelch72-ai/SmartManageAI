# SMARTMANAGEAI — FULL SYSTEM AUDIT
**Date:** March 12, 2026
**Status:** Production Platform — Multi-Tenant SaaS (Construction Management)
**Stack:** React + TypeScript | Express.js | PostgreSQL (Drizzle ORM) | Replit Object Storage | OpenAI GPT-4o

---

## TABLE OF CONTENTS
1. [Platform Overview](#1-platform-overview)
2. [User Roles (18 Total)](#2-user-roles-18-total)
3. [Subscription Tiers (5 Tiers)](#3-subscription-tiers-5-tiers)
4. [Feature Permission System](#4-feature-permission-system)
5. [Frontend Pages (98 Total)](#5-frontend-pages-98-total)
6. [Backend API Route Modules (110 Total)](#6-backend-api-route-modules-110-total)
7. [Database Tables (130+ Tables)](#7-database-tables-130-tables)
8. [AI Features & Capabilities](#8-ai-features--capabilities)
9. [Integration Hub](#9-integration-hub)
10. [Core Platform Systems](#10-core-platform-systems)
11. [Security & Compliance Infrastructure](#11-security--compliance-infrastructure)
12. [Workforce Management Suite](#12-workforce-management-suite)
13. [Estimating & Takeoff Engine](#13-estimating--takeoff-engine)
14. [Project Lifecycle Management](#14-project-lifecycle-management)
15. [Communication & Collaboration](#15-communication--collaboration)
16. [Website Builder System](#16-website-builder-system)
17. [Social Media Management](#17-social-media-management)
18. [CRM System](#18-crm-system)
19. [Dashboard & Analytics](#19-dashboard--analytics)
20. [Super Admin / Platform Admin](#20-super-admin--platform-admin)
21. [Hustler Network (Multi-Org)](#21-hustler-network-multi-org)
22. [External Dependencies](#22-external-dependencies)

---

## 1. PLATFORM OVERVIEW

SmartManageAI is a white-label multi-tenant SaaS platform built for construction contractors across all trades. It centralizes every aspect of the project lifecycle: estimating, bidding, workforce management, compliance, CRM, payroll, communication, and AI-driven automation. The platform is trade-aware and dynamically configures itself based on the organization's trade type during onboarding.

**Architecture:** Multi-tenant with per-organization data isolation. Each organization has its own trade configuration, subscription tier, color palette, AI settings, and user roster. A Super Admin can oversee all organizations from a dedicated platform admin dashboard.

**Deployment:** Hosted on Replit with Neon PostgreSQL, Replit Object Storage (GCS backend), and OpenAI integration.

---

## 2. USER ROLES (18 Total)

All roles are stored in `userRoleEnum` in the database schema. Access control is enforced both on the frontend (RBAC hooks) and backend (requireRole middleware).

| # | Role | Access Level | Key Capabilities |
|---|------|-------------|-----------------|
| 1 | **SUPER_ADMIN** | Platform-wide | Full access to all organizations, platform admin dashboard, impersonation, billing overrides, all platform tools |
| 2 | **ADMIN** | Organization-wide | Full org control, user management, settings, billing, all features within org, AI settings |
| 3 | **MANAGER** | Management | Projects, teams, approvals, timesheets, payroll view, CRM, all operational features |
| 4 | **SUPERINTENDENT** | Field/Operations | Project oversight, crews, schedules, time approvals, safety, RFIs, equipment |
| 5 | **ESTIMATOR** | Estimating/Bids | Bids, takeoffs, estimates, vendor pricebooks, change order generation, procurement |
| 6 | **OFFICE_MANAGER** | Administrative | Documents, CRM, payroll support, reporting, communications |
| 7 | **HOURLY_EMPLOYEE** | Field | Time clock (in/out), own timesheets, own KPIs, own safety training |
| 8 | **MAINTENANCE_MANAGER** | Equipment | Equipment management, maintenance logs, equipment assignments |
| 9 | **VENDOR** | External/Limited | Vendor portal access, bid submissions via subcontractor portal |
| 10 | **HUSTLER** | Multi-Organization | Cross-org access, switch between linked organizations, management-level access per org |
| 11 | **SALES** | CRM/Sales | CRM contacts, organizations, social media, website content, bid inbox |
| 12 | **MARKETING** | Marketing | Social media, website builder, content creation, CRM access |
| 13 | **SAFETY_MANAGER** | Safety | Safety training programs, incident reports, safety compliance, safety assignments |
| 14 | **HR_MANAGER** | Human Resources | Employee records, hiring, performance, payroll setup, certifications |
| 15 | **EQUIPMENT_MANAGER** | Equipment | Equipment catalog, assignments, maintenance, rental equipment |
| 16 | **PROJECT_ENGINEER** | Engineering | RFIs, submittals, transmittals, technical project documents |
| 17 | **PROCUREMENT_MANAGER** | Procurement | Vendor management, pricebooks, purchase orders, material procurement |
| 18 | **DISPATCHER** | Field Operations | Crew scheduling, shift assignments, daily reports, field communications |

### Role Access Function Summary

| Function | Roles Included |
|----------|---------------|
| `isAdmin()` | SUPER_ADMIN, ADMIN |
| `isAdminOrManager()` | ADMIN, MANAGER |
| `hasManagementAccess()` | ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HUSTLER, SAFETY_MANAGER, HR_MANAGER, EQUIPMENT_MANAGER, PROJECT_ENGINEER, PROCUREMENT_MANAGER |
| `hasFinancialAccess()` | ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HUSTLER |
| `hasEquipmentAccess()` | ADMIN, MANAGER, SUPERINTENDENT, MAINTENANCE_MANAGER, EQUIPMENT_MANAGER |
| `hasSafetyAccess()` | ADMIN, MANAGER, SUPERINTENDENT, SAFETY_MANAGER |
| `hasProcurementAccess()` | ADMIN, MANAGER, PROCUREMENT_MANAGER |
| `hasHRAccess()` | ADMIN, MANAGER, HR_MANAGER |
| `hasDispatchAccess()` | ADMIN, MANAGER, SUPERINTENDENT, DISPATCHER |
| `hasCrmAccess()` | hasManagementAccess + SALES + MARKETING |

---

## 3. SUBSCRIPTION TIERS (5 Tiers)

Stored in `subscriptionTierEnum` as: `free`, `starter`, `professional`, `enterprise`. "Hustler" is stored as `enterprise` with a special flag.

| Tier | DB Value | Display Name | Price/mo | Revenue Range | Best For |
|------|----------|-------------|---------|--------------|---------|
| **Trial** | `free` | Trial | $0 | Demo | Platform evaluation (14 days) |
| **Starter** | `starter` | Starter | $89 | Under $500k revenue | Owner-operators and small crews |
| **Growth** | `professional` | Growth | $229 | $500k–$2M revenue | Growing contractors replacing multiple tools |
| **Scale** | `enterprise` | Scale | $579 | $2M–$10M revenue | Multi-project, multi-crew operations |
| **Hustler** | `enterprise` + flag | Hustler | $1,199 | Multi-Company | Business owners running multiple companies |

### Features by Tier

| Feature | Trial | Starter | Growth | Scale | Hustler |
|---------|-------|---------|--------|-------|---------|
| Project management | Limited | ✓ | ✓ | ✓ | ✓ |
| Time clock + GPS | — | ✓ | ✓ | ✓ | ✓ |
| Core estimating | — | ✓ | ✓ | ✓ | ✓ |
| CRM | — | ✓ | ✓ | ✓ | ✓ |
| Documents & messaging | — | ✓ | ✓ | ✓ | ✓ |
| Production rate tracking | — | — | ✓ | ✓ | ✓ |
| Budget vs actuals | — | — | ✓ | ✓ | ✓ |
| Vendor invites | — | — | ✓ | ✓ | ✓ |
| Advanced reports | — | — | ✓ | ✓ | ✓ |
| Approvals framework | — | — | ✓ | ✓ | ✓ |
| Document control & revisioning | — | — | ✓ | ✓ | ✓ |
| Project Health Score | — | — | ✓ | ✓ | ✓ |
| Portfolio dashboards | — | — | — | ✓ | ✓ |
| Bid Network | — | — | — | ✓ | ✓ |
| Website builder (basic) | — | — | — | ✓ | ✓ |
| Executive Digest | — | — | — | ✓ | ✓ |
| AI Governance | — | — | — | ✓ | ✓ |
| Mobile offline v2 | — | — | — | ✓ | ✓ |
| SSO / SAML | — | — | — | ✓ | ✓ |
| Audit export | — | — | — | ✓ | ✓ |
| Data retention | — | — | — | ✓ | ✓ |
| Privacy compliance | — | — | — | ✓ | ✓ |
| Session management | — | — | — | ✓ | ✓ |
| Multi-org / Hustler network | — | — | — | — | ✓ |
| Cross-org analytics | — | — | — | — | ✓ |
| COO Mode | — | — | — | — | ✓ |
| Priority support | — | — | — | ✓ | ✓ |

### Available Add-Ons (Purchase separately)

| Add-On Key | Feature Granted | Description |
|-----------|---------------|-------------|
| `ai_pm` | AI_PM | AI Project Manager — automated task generation, AI-driven project plans |
| `ai_cfo` | AI_CFO | AI CFO Dashboard — profitability analysis, equipment metrics |
| `ai_email` | AI_EMAIL | AI Email Assistant — thread summarization, smart replies, action extraction |
| `website_seo` | WEBSITE_SEO | Advanced SEO tools for the website builder |
| `bid_network` | BID_NETWORK | Bid Network marketplace access |
| `ai_vision` | AI_VISION | AI Jobsite Vision — photo analysis, safety and quality inspection |
| `integration_qbo` | INTEGRATION_QBO | QuickBooks Online sync |
| `integration_esign` | INTEGRATION_ESIGN | DocuSign e-signature integration |
| `ai_governance_pack` | AI_GOVERNANCE | Enhanced AI governance and audit pack |

---

## 4. FEATURE PERMISSION SYSTEM

8 granular permissions across 4 categories. Permissions are an additive merge of role defaults and per-user DB grants. Admins bypass all checks automatically.

| Permission Key | Category | Description | Default Roles With Access |
|---------------|----------|-------------|--------------------------|
| `canAccessFinancials` | Financial | View financial data, invoices, pay rates | ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HUSTLER |
| `canManagePayroll` | Financial | Full payroll management access | ADMIN, MANAGER |
| `canAccessReports` | Financial | View and export reports | ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR |
| `canUseAiFeatures` | Operations | Use AI-powered features | ADMIN, MANAGER |
| `canManageEquipment` | Operations | Equipment catalog and assignment | ADMIN, MANAGER, EQUIPMENT_MANAGER, MAINTENANCE_MANAGER |
| `canManageProcurement` | Operations | Vendor management, pricebooks | ADMIN, MANAGER, PROCUREMENT_MANAGER |
| `canPostSocialMedia` | Marketing | Social media post creation and scheduling | ADMIN, MANAGER, MARKETING, SALES |
| `canManageWebsite` | Management | Website builder access | ADMIN, MANAGER, MARKETING |

---

## 5. FRONTEND PAGES (98 Total)

All pages are React + TypeScript components, routed via Wouter in `client/src/App.tsx`.

### Authentication & Onboarding
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `login.tsx` | `/login` | ✓ Live | JWT login with email/password and OAuth (Google) |
| `register.tsx` | `/register` | ✓ Live | New organization registration |
| `forgot-password.tsx` | `/forgot-password` | ✓ Live | Password reset request |
| `reset-password.tsx` | `/reset-password` | ✓ Live | Password reset with token |
| `onboarding.tsx` | `/onboarding` | ✓ Live | AI-driven trade-specific org setup wizard |
| `landing.tsx` | `/` | ✓ Live | Public marketing landing page |

### Core Operations
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `dashboard.tsx` | `/dashboard` | ✓ Live | Role-tiered customizable dashboard with widgets |
| `projects.tsx` | `/projects` | ✓ Live | Project list with filtering and status tracking |
| `project-detail.tsx` | `/projects/:id` | ✓ Live | Full project detail: overview, docs, SOV, schedule, health |
| `tasks.tsx` | `/tasks` | ✓ Live | Task management board with assignments and priorities |
| `calendar.tsx` | `/calendar` | ✓ Live | Project calendar with scheduling views |
| `reports.tsx` | `/reports` | ✓ Live | 9 report types: takeoff + estimate with CSV/print/snapshot |

### Bidding & Estimating
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `bids.tsx` | `/bids` | ✓ Live | Bid list management |
| `bid-detail.tsx` | `/bids/:id` | ✓ Live | Individual bid detail and management |
| `bid-wizard.tsx` | `/bids/:id/wizard` | ✓ Live | 6-step bid workflow wizard |
| `bid-estimate.tsx` | `/bids/:id/estimate` | ✓ Live | Full estimating and takeoff workspace |
| `bid-inbox.tsx` | `/bid-inbox` | ✓ Live | Incoming bid request inbox |
| `bid-network.tsx` | `/bid-network` | ✓ Live | Marketplace for bid requests and invitations |
| `bid-network-detail.tsx` | `/bid-network/:id` | ✓ Live | Individual bid network opportunity detail |
| `calculator.tsx` | `/calculator` | ✓ Live | Material calculator with presets |
| `scope-library.tsx` | `/scope-library` | ✓ Live | Reusable scope items and assemblies library |
| `scope-settings.tsx` | `/scope-settings` | ✓ Live | Scope configuration and work type management |
| `pricebook-import.tsx` | `/pricebook-import` | ✓ Live | Vendor pricebook import wizard |

### Change Orders & Financial
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `schedule-of-values.tsx` | `/schedule-of-values` | ✓ Live | SOV management with billing and lien waivers |
| `tm-billing.tsx` | `/tm-billing` | ✓ Live | Time & Material billing management |
| `tm-daily.tsx` | `/tm-daily` | ✓ Live | Daily T&M ticket entry |
| `subcontractor-payables.tsx` | `/subcontractor-payables` | ✓ Live | Subcontractor billing and payment tracking |
| `subcontracts.tsx` | `/subcontracts` | ✓ Live | Subcontract agreements and management |
| `cost-rates.tsx` | `/cost-rates` | ✓ Live | Labor and material cost rate management |

### Workforce Management
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `manage-workers.tsx` | `/manage-workers` | ✓ Live | Full employee roster with roles, status, deductions |
| `worker-detail.tsx` | `/workers/:id` | ✓ Live | Individual worker profile: overview, skills, performance, projects, logs, safety training |
| `time-clock.tsx` | `/time-clock` | ✓ Live | Employee time clock with GPS/geofence check-in/out |
| `time-clock-manager.tsx` | `/time-clock-manager` | ✓ Live | Manager time approval dashboard |
| `time-entry.tsx` | `/time-entry` | ✓ Live | Manual time entry and adjustment |
| `time-log-tab.tsx` | (component) | ✓ Live | Embedded time log tab for worker profiles |
| `payroll-management.tsx` | `/payroll-management` | ✓ Live | Payroll runs, pay stubs, Certified Payroll Reports (WH-347) |
| `crews.tsx` | `/crews` | ✓ Live | Crew creation, member management, scheduling |
| `kpi-management.tsx` | `/kpi-management` | ✓ Live | KPI template creation and org-wide assignment |
| `my-kpis.tsx` | `/my-kpis` | ✓ Live | Individual employee KPI tracking view |
| `production-rates.tsx` | `/production-rates` | ✓ Live | Crew productivity, labor/material cost per UOM |

### Safety & Compliance
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `safety-training.tsx` | `/safety-training` | ✓ Live | Full safety training lifecycle: programs, assignments, completion, PDF export |
| `approvals.tsx` | `/approvals` | ✓ Live | Unified approvals center for all 6 approval workflows |
| `audit-logs.tsx` | `/audit-logs` | ✓ Live | Full audit trail with shadcn date picker filters, export |
| `daily-report-locks.tsx` | `/daily-report-locks` | ✓ Live | Daily field report lock management |

### Equipment
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `equipment.tsx` | `/equipment` | ✓ Live | Equipment catalog, tracking, maintenance logs |
| `equipment-detail.tsx` | `/equipment/:id` | ✓ Live | Individual equipment detail, assignments, history |
| `rental-vendors.tsx` | `/rental-vendors` | ✓ Live | Rental equipment vendor catalog management |

### Project Documents
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `rfis.tsx` | `/rfis` | ✓ Live | RFI tracking and response workflow |
| `submittals.tsx` | `/submittals` | ✓ Live | Submittal log with review and approval workflow |
| `transmittals.tsx` | `/transmittals` | ✓ Live | Document transmittal creation and distribution |

### CRM & Vendors
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `crm.tsx` | `/crm` | ✓ Live | CRM organizations and contacts with compliance expiration alerts |
| `vendor-pricing.tsx` | `/vendor-pricing` | ✓ Live | Vendor price management and comparison |
| `vendor-scores.tsx` | `/vendor-scores` | ✓ Live | Vendor performance scoring and ratings |
| `vendor/` (folder) | `/vendor/*` | ✓ Live | Vendor enrollment and subcontractor portal tools |
| `material-price-index.tsx` | `/material-price-index` | ✓ Live | Material price index tracking and trends |

### Communication
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `messages.tsx` | `/messages` | ✓ Live | Unified team messaging system |
| `unified-messages.tsx` | `/unified-messages` | ✓ Live | Cross-channel unified message center |
| `portal-chat.tsx` | `/portal-chat` | ✓ Live | Client portal chat interface |
| `company-communications.tsx` | `/company-communications` | ✓ Live | Company-wide announcements and broadcasts |

### AI Features
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `ai-pm-dashboard.tsx` | `/ai-pm` | ✓ Live | AI Project Manager dashboard with AI-generated tasks and plans |
| `ai-bid-analysis.tsx` | `/ai-bid-analysis` | ✓ Live | AI-powered bid document analysis |
| `ai-contract-analysis.tsx` | `/ai-contract-analysis` | ✓ Live | AI contract document review and risk flagging |
| `ai-governance.tsx` | `/ai-governance` | ✓ Live | AI usage tracking, cost auditing, daily limits |
| `ai-settings.tsx` | `/ai-settings` | ✓ Live | AI configuration (model, limits, features) — ADMIN only |
| `cfo-dashboard.tsx` | `/cfo-dashboard` | ✓ Live | AI CFO — profitability analysis and equipment cost metrics |
| `email-assistant.tsx` | `/email-assistant` | ✓ Live | AI Email Assistant with thread summaries, smart replies |
| `executive-digest.tsx` | `/executive-digest` | ✓ Live | AI-generated daily executive business summary |
| `what-if-simulator.tsx` | `/what-if-simulator` | ✓ Live | Scenario planning and financial modeling simulator |
| `voice-logs.tsx` | `/voice-logs` | ✓ Live | Voice note transcription and log management |
| `issue-captures.tsx` | `/issue-captures` | ✓ Live | AI Jobsite Vision — photo-based issue capture and analysis |

### Website Builder
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `website-builder.tsx` | `/website-builder` | ✓ Live | Full page builder, publishing, SEO, blog, analytics |
| `public-website.tsx` | `/site/:slug` | ✓ Live | Published public-facing contractor website |
| `shared-preview.tsx` | `/preview/:token` | ✓ Live | Token-protected staging preview link |

### Social Media
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `social-media.tsx` | `/social-media` | ✓ Live | Social media content calendar, scheduling, AI generation |

### Platform / Admin
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `users.tsx` | `/users` | ✓ Live | Org user management (invite, roles, permissions, deactivate) |
| `company-settings.tsx` | `/company-settings` | ✓ Live | Organization profile, trade, branding, integrations |
| `enterprise-settings.tsx` | `/enterprise-settings` | ✓ Live | SSO/SAML, data retention, privacy, session security |
| `billing.tsx` | `/billing` | ✓ Live | Subscription management, add-ons, billing history |
| `integrations.tsx` | `/integrations` | ✓ Live | Integration hub — connect QBO, Google, Microsoft, DocuSign |
| `profile.tsx` | `/profile` | ✓ Live | User profile, preferences, password change |
| `mobile-sync.tsx` | `/mobile-sync` | ✓ Live | Mobile device management and sync status |
| `offline-sync.tsx` | `/offline-sync` | ✓ Live | Offline sync queue management |

### Super Admin / Platform Admin
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `PlatformAdminDashboard.tsx` | `/platform-admin` | ✓ Live | Platform overview, stats, health metrics |
| `PlatformOrganizations.tsx` | `/platform-admin/organizations` | ✓ Live | All organizations list |
| `PlatformOrganizationDetail.tsx` | `/platform-admin/organizations/:id` | ✓ Live | Org deep-dive: users, settings, billing, audit |
| `PlatformAnalytics.tsx` | `/platform-admin/analytics` | ✓ Live | Cross-org analytics and trends |
| `PlatformAuditDashboard.tsx` | `/platform-admin/audit` | ✓ Live | Platform-level audit log viewer |
| `PlatformSubscriptions.tsx` | `/platform-admin/subscriptions` | ✓ Live | Subscription management across all orgs |
| `PlatformSupportTools.tsx` | `/platform-admin/support` | ✓ Live | Support tools: impersonation, password reset, debug |
| `impersonate.tsx` | `/impersonate` | ✓ Live | SUPER_ADMIN user impersonation |
| `company-health.tsx` | `/company-health` | ✓ Live | Org health score and metrics |

### Hustler Network
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `hustler-dashboard.tsx` | `/hustler` | ✓ Live | Multi-org Hustler main dashboard |
| `hustler-unified-inbox.tsx` | `/hustler/inbox` | ✓ Live | Cross-org unified inbox |
| `hustler-org-detail.tsx` | `/hustler/orgs/:id` | ✓ Live | Per-org detail from Hustler view |
| `hustler-benchmarking.tsx` | `/hustler/benchmarking` | ✓ Live | Cross-org performance benchmarking |
| `accept-hustler-invite.tsx` | `/hustler/accept-invite` | ✓ Live | Accept Hustler org link invitation |

### Subcontractor / Client Portals
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `sub-portal.tsx` | `/sub-portal/:token` | ✓ Live | Token-authenticated subcontractor portal |
| `client-portal-public.tsx` | `/client-portal/:token` | ✓ Live | Token-authenticated client portal |

### Miscellaneous
| Page File | Route | Status | Description |
|-----------|-------|--------|-------------|
| `crew-marketplace.tsx` | `/crew-marketplace` | ✓ Live | Crew and labor marketplace listings |
| `delay-claims.tsx` | `/delay-claims` | ✓ Live | Delay claim management and documentation |
| `photo-custody.tsx` | `/photo-custody` | ✓ Live | Photo chain-of-custody documentation |
| `not-found.tsx` | `*` | ✓ Live | 404 catch-all page |

---

## 6. BACKEND API ROUTE MODULES (110 Total)

All registered in `server/routes.ts` via `app.use()`. Protected by JWT auth middleware (`requireAuth`) and role checks (`requireRole`).

### Authentication & Profiles
| File | Mount Point | Description |
|------|------------|-------------|
| `authProfileRoutes.ts` | `/api` | Login, logout, me endpoint, profile updates |
| `oauthRoutes.ts` | `/api` | Google/Apple OAuth flows |
| `ssoRoutes.ts` | `/api/sso` | SAML 2.0 SSO configuration and flow |

### Project Management
| File | Mount Point | Description |
|------|------------|-------------|
| `projectCoreRoutes.ts` | `/api` | CRUD for projects, project list, project details |
| `projectOpsRoutes.ts` | `/api` | Project operations: status updates, SOW items |
| `projectContentRoutes.ts` | `/api` | Project content: specs, plans, documents |
| `projectHealthRoutes.ts` | `/api/project-health` | Project Health Score calculation and snapshots |
| `delayRoutes.ts` | `/api` | Project delay tracking |
| `delayClaimsRoutes.ts` | `/api/delay-claims` | Formal delay claims management |
| `taskRoutes.ts` | `/api` | Task CRUD, assignment, priority management |
| `opsRoutes.ts` | (root) | Ops-level routes (public, no auth required) |

### Estimating & Takeoff
| File | Mount Point | Description |
|------|------------|-------------|
| `estimateRoutes.ts` | `/api` | Estimate CRUD, line items, versioning, history |
| `bidRoutes2.ts` | `/api` | Bid creation, workflow, document management |
| `bidTakeoffRoutes.ts` | `/api` | Takeoff measurements, PDF sheets, calibration |
| `takeoffSubRoutes.ts` | `/api` | Takeoff sub-routes: assemblies, quantity categories |
| `assemblyRoutes.ts` | `/api` | Takeoff assembly CRUD |
| `calculatorRoutes.ts` | `/api/calculators` | Material calculator presets CRUD |
| `scopeConfigRoutes.ts` | `/api` | Scope configuration: work types, modifiers |
| `scopeItemRoutes.ts` | `/api` | Scope item CRUD and search |
| `reportRoutes.ts` | `/api` | 9 report types: CSV, print, snapshot generation |
| `libraryRoutes.ts` | `/api` | Custom libraries, items, assemblies, saved takeoffs |

### Bidding & Network
| File | Mount Point | Description |
|------|------------|-------------|
| `bidNetworkRoutes.ts` | `/api/bid-network` | Bid network marketplace: requests, invitations, responses |
| `vendorEnrollmentRoutes.ts` | `/api` | Vendor enrollment and subcontractor portal tokens |
| `vendorPricebookRoutes.ts` | `/api/vendor` | Vendor pricebook CRUD, upload, item management |
| `vendorPricingRoutes.ts` | `/api` | Vendor price comparison and history |
| `pricebookImportRoutes.ts` | `/api` | AI-powered pricebook CSV import |

### Financial & Billing
| File | Mount Point | Description |
|------|------------|-------------|
| `sovRoutes.ts` | `/api` | Schedule of Values CRUD |
| `sovLineItemRoutes.ts` | `/api` | SOV line item management |
| `sovBillingRoutes.ts` | `/api` | SOV billing cycles and lien waivers |
| `sovPaymentRoutes.ts` | `/api` | SOV payment tracking |
| `tmTicketRoutes.ts` | `/api` | T&M ticket creation and management |
| `tmApprovalRoutes.ts` | `/api` | T&M ticket approval workflow |
| `tmInvoiceRoutes.ts` | `/api` | T&M invoice generation |
| `changeOrderRoutes.ts` | `/api/change-orders` | Change order CRUD, revision history, multi-level approval |
| `billingRoutes.ts` | `/api/billing` | Subscription management, plan changes, add-ons |
| `laborRateRoutes.ts` | `/api/labor-rates` | Labor rate management per trade/role |
| `subcontractorPayablesRoutes.ts` | `/api` | Subcontractor billing and payment management |

### Workforce Management
| File | Mount Point | Description |
|------|------------|-------------|
| `workforceRoutes.ts` | `/api` | Worker CRUD, roster management |
| `timeClockRoutes.ts` | `/api` | GPS time clock: check-in, check-out, shift management |
| `timeEntryRoutes.ts` | `/api` | Manual time entry and adjustment |
| `overtimeRoutes.ts` | `/api` | Overtime request and approval workflow |
| `payrollManagementRoutes.ts` | `/api` | Payroll runs, pay stubs, WH-347 generation |
| `payrollSettingsRoutes.ts` | `/api` | Payroll configuration, deduction types |
| `payrollNotificationRoutes.ts` | `/api` | Payroll notification delivery |
| `crewRoutes2.ts` | `/api` | Crew management, scheduling, conflict detection |
| `skillRoutes.ts` | `/api` | Skills, certifications, competency tracking |
| `kpiRoutes.ts` | `/api/kpis` | KPI templates, assignments, entries, ratings |
| `performanceRoutes.ts` | `/api` | Performance reviews and employee rating history |
| `productionRateRoutes.ts` | `/api` | Production rate tracking by UOM |
| `fieldProductivityRoutes.ts` | `/api/field-productivity` | Field crew productivity analytics |
| `marketplaceRoutes.ts` | `/api/marketplace` | Crew marketplace listings |

### Safety & Compliance
| File | Mount Point | Description |
|------|------------|-------------|
| `safetyTrainingRoutes.ts` | `/api/safety-training` | Training programs, assignments, completion, PDF export |
| `inspectionRoutes.ts` | `/api` | Inspection forms and field inspections |
| `approvalRoutes.ts` | `/api/approvals` | Unified approval center for all 6 workflows |
| `auditExportRoutes.ts` | `/api/audit` | Audit log viewer and export |
| `retentionRoutes.ts` | `/api/retention` | Data retention policy management |
| `privacyRoutes.ts` | `/api/privacy` | GDPR/privacy compliance: data subject requests |

### Project Documents
| File | Mount Point | Description |
|------|------------|-------------|
| `rfiRoutes.ts` | `/api` | RFI creation, routing, response tracking |
| `submittalRoutes.ts` | `/api` | Submittal log management |
| `submittalWorkflowRoutes.ts` | `/api` | Submittal review and approval workflow |
| `transmittalRoutes.ts` | `/api` | Document transmittal creation and distribution |
| `addendaRoutes.ts` | `/api` | Addenda tracking and acknowledgment system |
| `documentRevisionRoutes.ts` | `/api/documents` | Document revision control, versioning, comparison |
| `organizationDocumentRoutes.ts` | `/api` | Org-level document management |

### Equipment
| File | Mount Point | Description |
|------|------------|-------------|
| `equipmentMgmtRoutes.ts` | `/api` | Equipment catalog, maintenance, assignments |
| `equipmentPlanRoutes.ts` | `/api` | Equipment planning for projects |
| `rentalEquipmentRoutes.ts` | `/api` | Rental equipment vendor catalog |
| `materialTrackingRoutes.ts` | `/api` | Material usage and budget tracking |

### CRM
| File | Mount Point | Description |
|------|------------|-------------|
| `crmContactRoutes.ts` | `/api` | CRM contacts CRUD, insurance/compliance tracking |
| `crmVendorRoutes.ts` | `/api` | CRM vendor organizations, notes, relationships |

### Communication & Messaging
| File | Mount Point | Description |
|------|------------|-------------|
| `messagingRoutes.ts` | `/api` | Unified messaging: conversations, participants, messages |
| `notificationRoutes2.ts` | `/api` | In-app notification delivery and management |
| `portalChatRoutes.ts` | `/api` | Client portal chat threads and messages |
| `subChatRoutes.ts` | `/api` | Subcontractor portal chat |
| `clientChatRoutes.ts` | `/api` | Client-facing chat (separate from portal chat) |
| `notesRoutes.ts` | `/api` | General project notes |
| `aiNotesRoutes.ts` | `/api/ai-notes` | AI-powered note summarization and generation |

### Portals
| File | Mount Point | Description |
|------|------------|-------------|
| `portalRoutes.ts` | `/api` | Client portal access management |
| `portalTokenRoutes.ts` | `/api` | Portal authentication token generation |
| `portalDocumentRoutes.ts` | `/api` | Portal document sharing |
| `portalActivityRoutes.ts` | `/api` | Portal activity log |
| `clientPortalRoutes.ts` | `/api` | Client portal data serving |

### AI Systems
| File | Mount Point | Description |
|------|------------|-------------|
| `aiRoutes.ts` | `/api` | Core AI: PM run, CFO analysis, assistant chat, analyze |
| `aiFeatureRoutes.ts` | `/api/ai-features` | Takeoff analysis, schedule generation, change order generation, jobsite vision |
| `aiGovernanceRoutes.ts` | `/api/ai-governance` | AI usage tracking, cost audit, daily limits, tier controls |
| `aiInsightsRoutes.ts` | `/api` | AI insights generation for dashboards |
| `aiAssistantRoutes.ts` | `/api/ai-assistant` | Streaming AI assistant chat with context |
| `aiOnboardingRoutes.ts` | `/api` | AI-powered org onboarding flow |
| `aiBidDocumentRoutes.ts` | `/api` | AI bid document analysis |
| `aiContractDocumentRoutes.ts` | `/api` | AI contract analysis and risk identification |
| `aiScopeRoutes.ts` | `/api` | AI scope generation and suggestions |
| `aiScheduleRoutes.ts` | `/api` | AI schedule generation and optimization |

### Website Builder
| File | Mount Point | Description |
|------|------------|-------------|
| `websiteBuilderRoutes.ts` | `/api/website` | Website CRUD, publishing, settings |
| `websitePageRoutes.ts` | `/api/website` | Page builder: create, edit, publish, preview |
| `websiteContentRoutes.ts` | `/api/website` | Content blocks, sections |
| `websiteBlogRoutes.ts` | `/api/website` | Blog posts, comments, categories |
| `websiteAiSeoRoutes.ts` | `/api/website` | AI-generated SEO meta, sitemap.xml, robots.txt |

### Social Media
| File | Mount Point | Description |
|------|------------|-------------|
| `socialAccountRoutes.ts` | `/api/social` | Social account connections |
| `socialPostRoutes.ts` | `/api/social` | Post creation, scheduling, AI generation |
| `socialAnalyticsRoutes.ts` | `/api/social` | Post analytics and engagement tracking |

### Email
| File | Mount Point | Description |
|------|------------|-------------|
| `emailAccountRoutes.ts` | `/api/email` | Email account connection (Gmail/Outlook) |
| `emailAiRoutes.ts` | `/api/email` | AI thread summarization and reply generation |
| `emailAnalysisRoutes.ts` | `/api/email` | Email content analysis and priority tagging |
| `emailTaskRoutes.ts` | `/api/email` | Email-to-task extraction |

### Integrations
| File | Mount Point | Description |
|------|------------|-------------|
| `integrationRoutes.ts` | `/api/integrations` | Integration hub: list, connect, disconnect |
| `integrationConnectionRoutes.ts` | `/api/integrations` | Connection management and credentials |
| `integrationSyncRoutes.ts` | `/api/integrations` | Sync triggers and status |
| `integrationWebhookRoutes.ts` | `/api/integrations` | Webhook subscription management |

### Dashboard & Settings
| File | Mount Point | Description |
|------|------------|-------------|
| `dashboardLayoutRoutes.ts` | `/api/dashboard` | Dashboard layouts, widget configs, feature permissions |
| `dashboardCustomizationRoutes.ts` | `/api/dashboard` | WYSIWYG layout editor |
| `dashboardUserRoutes.ts` | `/api` | User-level dashboard preferences |
| `dashboardPaletteRoutes.ts` | `/api` | Color palette management |
| `featureFlagRoutes.ts` | `/api/feature-flags` | Feature flag management |
| `auditBillingStorageRoutes.ts` | `/api` | Billing and storage usage audit |

### Platform Admin
| File | Mount Point | Description |
|------|------------|-------------|
| `platformAdminRoutes.ts` | `/api` | Platform dashboard stats, org list, support tools |
| `platformOrgRoutes.ts` | `/api` | Org management from platform level |
| `platformUserRoutes.ts` | `/api` | Cross-org user management |
| `platformAuditRoutes.ts` | `/api` | Platform audit log viewer |
| `platformSubscriptionRoutes.ts` | `/api` | Subscription management across all orgs |

### Hustler / Multi-Org
| File | Mount Point | Description |
|------|------------|-------------|
| `hustlerRoutes.ts` | `/api` | Hustler org linking, switching, delegate management |

### Mobile & Sync
| File | Mount Point | Description |
|------|------------|-------------|
| `mobileSyncRoutes.ts` | `/api` | Mobile device management, sync trigger, conflict resolution |

### Miscellaneous
| File | Mount Point | Description |
|------|------------|-------------|
| `weatherRoutes.ts` | `/api/weather` | Weather data for job sites |
| `onboardingLibraryRoutes.ts` | `/api` | Contractor onboarding reference library |

---

## 7. DATABASE TABLES (130+ Tables)

All tables defined in `shared/schema/features.ts` using Drizzle ORM. Primary source of truth for the data model.

### AI / Governance
| Table | Description |
|-------|-------------|
| `ai_settings` | Per-org AI model config, limits, enabled features |
| `ai_runs` | AI PM run history with results |
| `ai_tasks` | AI-generated tasks and assignments |
| `ai_insights` | AI-generated insights for dashboards |
| `ai_gantt_recommendations` | AI schedule/Gantt recommendations |
| `ai_vendor_comparisons` | AI vendor price comparison results |
| `ai_bid_document_analysis` | AI bid document analysis results |
| `ai_contract_document_analysis` | AI contract analysis results |
| `ai_takeoff_analyses` | AI auto-takeoff analysis batches |
| `ai_data_quality` | AI data quality flags and scores |
| `ai_co_drafts` | AI-generated change order drafts |
| `ai_action_audit` | AI action audit log for governance |

### Projects & Planning
| Table | Description |
|-------|-------------|
| `project_plans` | Project plan documents |
| `project_specs` | Technical spec sheets |
| `project_spec_index` | Spec index and cross-references |
| `project_schedules` | AI and manual project schedules |
| `project_schedule_tasks` | Individual schedule tasks with durations, dependencies |
| `project_health_snapshots` | Periodic Project Health Score snapshots |

### Estimating & Takeoff
| Table | Description |
|-------|-------------|
| `quantity_categories` | Takeoff quantity categories (walls, floors, etc.) |
| `takeoff_sheets` | Multi-page PDF takeoff sheets |
| `takeoff_measurements` | Individual measurements on takeoff sheets |
| `takeoff_measurement_assemblies` | Assembly bindings to measurements |
| `takeoff_assemblies` | Reusable measurement assemblies |
| `takeoff_assembly_items` | Items within assemblies |
| `estimate_settings` | Per-org or per-bid estimate configuration |
| `estimate_crews` | Crew assignments within estimates |
| `estimate_versions` | Estimate version history |
| `estimate_vendor_quotes` | Vendor quotes attached to estimate line items |
| `estimate_history` | Full estimate edit/change history |
| `handoff_packets` | Estimate-to-project handoff packets |

### Scope & Work Types
| Table | Description |
|-------|-------------|
| `scope_work_type_categories` | Work type categories |
| `scope_work_types` | Individual work types per trade |
| `scope_modifier_categories` | Modifier category groupings |
| `scope_modifiers` | Scope modifiers (e.g., floor type, height, conditions) |
| `master_modifier_categories` | Platform-level modifier categories |
| `master_modifiers` | Platform-level master modifiers |
| `master_sow_items` | Platform-level SOW item library |
| `master_calculators` | Platform-level material calculators |
| `master_inspection_forms` | Platform-level inspection form templates |
| `organization_sow_items` | Org-specific SOW items |
| `organization_work_types` | Org-specific work type overrides |
| `sow_audit_log` | SOW item change audit log |
| `trade_features` | Trade-specific feature flags |
| `units_of_measure` | UOM definitions (SF, LF, CY, etc.) |
| `material_calculator_presets` | Saved material calculator configurations |

### Workforce
| Table | Description |
|-------|-------------|
| `crews` | Crew definitions with trade, status |
| `crew_members` | Crew membership roster |
| `crew_project_assignments` | Crew-to-project assignment history |
| `skills` | Skill/trade capability definitions |
| `user_skills` | Employee skill assignments with proficiency |
| `skill_verification_requests` | Skill verification requests and outcomes |
| `user_certifications` | Employee certifications with expiry dates |
| `user_equipment_competencies` | Equipment operation certifications |
| `user_photos` | Employee profile photos |
| `attendance_logs` | Attendance tracking log |

### Safety & Performance
| Table | Description |
|-------|-------------|
| `safety_trainings` | Safety training programs (title, category, frequency) |
| `safety_training_assignments` | Employee-training assignments with completion status |
| `safety_incidents` | Safety incident reports |
| `quality_issues` | Quality control issue reports |
| `performance_reviews` | Formal performance review records |
| `supervisor_notes` | Supervisor notes on employee performance |
| `worker_logs` | General worker activity logs |
| `employee_performance_profiles` | Aggregated performance metrics per employee |
| `rating_criteria` | Performance rating criteria |
| `employee_ratings` | Employee rating sessions |
| `rating_scores` | Individual scores per rating criterion |
| `reward_types` | Employee reward/recognition types |
| `reward_assignments` | Reward assignments to employees |

### KPI
| Table | Description |
|-------|-------------|
| `kpi_templates` | KPI template definitions with targets |
| `kpi_assignments` | KPI-to-employee assignments |
| `kpi_entries` | KPI data entries and measurements |

### Time & Payroll
| Table | Description |
|-------|-------------|
| `equipment` | Equipment catalog with type, model, status |
| `equipment_assignments` | Equipment-to-project assignments |

### Financial
| Table | Description |
|-------|-------------|
| `schedule_of_values` | SOV headers per contract |
| `sov_line_items` | SOV line items with completed % and billing |
| `lien_waivers` | Lien waiver documents |
| `sov_payments` | SOV payment applications |
| `subcontractors` | Subcontractor entity records |
| `subcontractor_contracts` | Formal subcontract agreements |
| `subcontractor_payments` | Subcontractor payment records |
| `subcontractor_billing_schedule` | Billing schedule for subcontractors |
| `subcontractor_bid_requests` | Bid requests sent to subcontractors |
| `subcontractor_bid_invitations` | Bid invitation records |
| `subcontractor_bid_responses` | Submitted bid responses |
| `bid_request_clarifications` | Q&A clarifications on bid requests |
| `vendorPricebooks` | Vendor pricebook headers |
| `vendorPricebookItems` | Pricebook line items |
| `vendorPriceHistory` | Price history per pricebook item |
| `vendor_scores` | Vendor performance scores |
| `material_price_index` | Material market price index data |
| `pricebook_import_jobs` | Pricebook import job status and results |
| `crew_marketplace` | Crew marketplace listings |

### CRM
| Table | Description |
|-------|-------------|
| `crm_organisations` | CRM organization records with compliance dates |
| `crm_contacts` | CRM contact profiles |
| `crm_organisation_notes` | Notes attached to CRM organizations |

### Project Documents
| Table | Description |
|-------|-------------|
| `rfis` | RFI records with status, routing |
| `rfi_activity` | RFI activity and response log |
| `document_transmittals` | Transmittal records |
| `transmittal_recipients` | Transmittal recipient list |
| `submittals` | Submittal log entries |
| `submittal_activity` | Submittal review and activity log |
| `addenda` | Addenda documents |
| `addendum_acknowledgments` | Addendum acknowledgment tracking |
| `document_revisions` | Document revision records with version history |
| `organization_documents` | Org-level document library |
| `approval_requests` | Approval requests across all 6 workflows |

### Communication & Messaging
| Table | Description |
|-------|-------------|
| `conversations` | Conversation threads |
| `conversation_participants` | Conversation member list |
| `messages` | Individual messages |
| `message_read_receipts` | Per-user message read tracking |
| `voice_logs` | Voice note recordings and transcriptions |
| `issue_captures` | Photo-based issue captures |

### Portals
| Table | Description |
|-------|-------------|
| `client_portal_access` | Client portal access credentials |
| `client_portal_activity` | Client portal activity log |
| `subcontractor_portal_tokens` | Subcontractor portal auth tokens |
| `portal_activity_log` | General portal activity log |
| `bid_document_distributions` | Bid document distribution tracking |
| `portal_chat_threads` | Portal chat conversation threads |
| `portal_chat_messages` | Portal chat messages |

### Website Builder
| Table | Description |
|-------|-------------|
| `organization_websites` | Website settings, domain, published status |
| `website_deployments` | Deployment history |
| `organization_website_pages` | Individual pages with SEO meta |
| `page_preview_links` | Token-protected preview link records |
| `page_versions` | Page version history |
| `website_blog_posts` | Blog post content and metadata |
| `website_blog_comments` | Blog post comments |
| `website_projects` | Portfolio/project showcase entries |
| `website_project_images` | Images for portfolio entries |
| `website_analytics_daily` | Daily website analytics snapshots |
| `website_analytics_events` | Individual website analytics events |
| `organization_social_links` | Social media links for website |
| `social_post_history` | Social post publish history from website |
| `website_contact_submissions` | Contact form submissions |

### Social Media
| Table | Description |
|-------|-------------|
| `social_accounts` | Connected social media accounts |
| `social_media_posts` | Post drafts and published posts |
| `social_post_analytics` | Per-post analytics data |

### Email
| Table | Description |
|-------|-------------|
| `email_accounts` | Connected email accounts (Gmail/Outlook) |
| `email_threads` | Email thread records |
| `email_messages` | Individual email messages |
| `email_attachments` | Email attachment records |
| `email_tasks` | Tasks extracted from emails |
| `email_summaries` | AI-generated email thread summaries |

### Dashboard & Customization
| Table | Description |
|-------|-------------|
| `user_dashboard_permissions` | Per-user feature permission overrides |
| `user_dashboard_layouts` | Saved dashboard layout configurations |
| `user_color_palettes` | User-level color palette selections |
| `org_color_palettes` | Org-level default color palette |

### Libraries
| Table | Description |
|-------|-------------|
| `custom_libraries` | Custom item library containers |
| `library_items` | Individual library items (materials, labor) |
| `library_assemblies` | Reusable assembly definitions |
| `library_assembly_items` | Assembly line items |
| `library_assembly_item_groups` | Assembly item groups |
| `library_assembly_item_group_members` | Group member items |
| `saved_takeoffs` | Saved takeoff templates |

### Hustler / Multi-Org
| Table | Description |
|-------|-------------|
| `hustler_organizations` | Hustler org linkages |
| `hustler_link_requests` | Org link invitation requests |
| `hustler_delegates` | Delegate access grants between orgs |
| `organization_network_settings` | Org network/sharing settings |

### Integrations
| Table | Description |
|-------|-------------|
| `integration_connections` | Integration connection credentials (AES-256-GCM encrypted) |
| `integration_events_outbox` | Outbound integration event queue |
| `integration_webhook_subscriptions` | Inbound webhook subscriptions |
| `integration_sync_state` | Sync state per integration |
| `qbo_account_mappings` | QuickBooks account mapping config |
| `qbo_sync_schedules` | QBO scheduled sync configuration |
| `zapier_webhooks` | Zapier webhook registrations |

### Enterprise / Security
| Table | Description |
|-------|-------------|
| `sso_configurations` | SAML 2.0 SSO configuration per org |
| `active_sessions` | Active user session tracking |
| `retention_policies` | Data retention policy definitions |
| `data_processing_records` | GDPR data processing records |
| `data_subject_requests` | GDPR data subject access/deletion requests |

### Mobile & Sync
| Table | Description |
|-------|-------------|
| `mobile_devices` | Registered mobile devices |
| `mobile_sync_log` | Mobile sync event history |
| `mobile_pending_uploads` | Pending offline uploads queue |
| `offline_sync_queue` | Offline sync change queue |

### Jobsite Analysis
| Table | Description |
|-------|-------------|
| `jobsite_analysis_batches` | Photo analysis batch jobs |
| `jobsite_analysis_photos` | Individual photos in analysis batches |

---

## 8. AI FEATURES & CAPABILITIES

All AI calls are wrapped in `governedAiCall()` for centralized limit enforcement, cost auditing, and tier-aware daily limits.

| Feature | Route | Roles | Description | Status |
|---------|-------|-------|-------------|--------|
| **AI Project Manager** | `POST /api/ai-pm/run` | All auth | Generates AI task plans, assigns by role, runs analysis on project data | ✓ Live |
| **AI Assistant Chat** | `POST /api/ai/assistant/chat` | All auth | Streaming conversational assistant with project context | ✓ Live |
| **AI Analyze** | `POST /api/ai-analyze` | All auth | General AI analysis endpoint (flexible input) | ✓ Live |
| **AI CFO Dashboard** | `GET /api/cfo/profitability` | Auth | Profitability analysis, equipment cost metrics | ✓ Live |
| **AI Auto-Takeoff** | `POST /api/ai-features/takeoff/analyze` | ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT | Automated PDF takeoff analysis with area/measurement extraction | ✓ Live |
| **AI Schedule Generator** | `POST /api/ai-features/schedule/generate` | ADMIN, MANAGER, SUPERINTENDENT | Generates Gantt-style project schedules from project data | ✓ Live |
| **AI Jobsite Vision** | `POST /api/ai-features/jobsite/analyze` | ADMIN, MANAGER, SUPERINTENDENT | Photo batch analysis for safety, quality, and progress issues | ✓ Live |
| **AI Change Order Generator** | `POST /api/ai-features/change-orders/generate` | ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT | Generates change order drafts from project context | ✓ Live |
| **AI Bid Document Analysis** | `POST /api/ai-bid-document` | Auth | Analyzes bid documents for scope, risks, requirements | ✓ Live |
| **AI Contract Analysis** | `POST /api/ai-contract-document` | Auth | Reviews contracts for risks, obligations, red flags | ✓ Live |
| **AI Scope Generator** | `/api/ai-scope/*` | Auth | Generates trade-specific scope items and work descriptions | ✓ Live |
| **AI Email Assistant** | `POST /api/email/ai/*` | Auth | Thread summarization, smart replies, action item extraction | ✓ Live |
| **AI Notes** | `POST /api/ai-notes/*` | Auth | AI note summarization and generation from project context | ✓ Live |
| **AI Onboarding** | `POST /api/ai-onboarding/*` | Auth | AI-driven organization setup wizard | ✓ Live |
| **AI Insights** | `GET /api/ai-insights/*` | Auth | Dashboard widget insights generation | ✓ Live |
| **AI Vendor Pricebook Import** | `/api/ai-features/vendors/pricebook/upload` | ADMIN, MANAGER, ESTIMATOR | AI-powered pricebook CSV parsing and normalization | ✓ Live |
| **Executive Digest** | `/api/cfo/executive-digest` | Auth | AI-generated daily executive business intelligence summary | ✓ Live |
| **AI Governance System** | `/api/ai-governance/*` | ADMIN | Usage tracking, daily limits per tier, cost auditing, feature enable/disable | ✓ Live |
| **AI Settings** | `PATCH /api/ai-settings` | ADMIN | Model selection, API key config, feature toggles | ✓ Live |
| **AI Website SEO** | `POST /api/website/ai-seo/*` | Auth | AI-generated meta descriptions, titles, keywords for website pages | ✓ Live |
| **AI Social Media** | `POST /api/social/posts/generate` | Auth | AI-generated social media content for multiple platforms | ✓ Live |
| **What-If Simulator** | `/what-if-simulator` | Auth | AI-powered scenario planning and financial impact modeling | ✓ Live |

---

## 9. INTEGRATION HUB

Provider-agnostic framework with AES-256-GCM token encryption. All connections stored in `integration_connections` table.

| Provider | Key | Type | Features | Status |
|----------|-----|------|----------|--------|
| **QuickBooks Online** | `qbo` | Accounting | Invoice sync, expense sync, account mapping, scheduled sync, P&L import | ✓ Live |
| **Google Workspace** | `google` | Email + Calendar | Gmail connection, Google Calendar sync, OAuth2 | ✓ Live |
| **Microsoft 365** | `microsoft` | Email + Calendar | Outlook connection, Teams integration, Calendar sync | ✓ Live |
| **DocuSign** | `esign` | E-Signature | E-signature workflows, document routing, signature tracking | ✓ Live |
| **Zapier** | `zapier` | Automation | Webhook triggers and automation flows | ✓ Live |
| **Dropbox** | `dropbox` | Cloud Storage | File upload source, document retrieval | ✓ Live |
| **Google Drive** | `gdrive` | Cloud Storage | File upload source, document retrieval | ✓ Live |
| **OneDrive** | `onedrive` | Cloud Storage | File upload source, document retrieval | ✓ Live |
| **Box** | `box` | Cloud Storage | File upload source, document retrieval | ✓ Live |

**Outbox Pattern:** Integration events are dispatched via `integration_events_outbox` with a background job runner ensuring reliable delivery.

**Webhook Support:** Inbound webhooks supported via `integration_webhook_subscriptions` with signature verification.

---

## 10. CORE PLATFORM SYSTEMS

### Multi-Tenancy
- Complete data isolation per organization using `organizationId` foreign keys on all tables
- Trade-specific configurations via `trade_features` and `organization_work_types`
- Per-org AI settings, color palettes, subscription tiers, and feature flags

### Authentication
- JWT-based auth stored in httpOnly cookies
- Bcrypt password hashing
- CSRF protection on OAuth flows
- Google OAuth social login
- Apple OAuth (configured)
- SAML 2.0 SSO for enterprise orgs

### Session Management
- `active_sessions` table tracks all active user sessions
- Session revocation available from enterprise settings
- Idle timeout and concurrent session limits configurable per org

### Approval Workflows Framework (6 Workflows)
All 6 workflows send in-app notifications to approvers on submission and to submitters on approval/rejection via shared `approvalNotificationService`.

| Workflow | Trigger | Approvers |
|----------|---------|-----------|
| Change Orders | Submitted for review | ADMIN, MANAGER |
| Submittals | Submitted for review | PROJECT_ENGINEER, MANAGER, ADMIN |
| T&M Tickets | Manager approval requested | MANAGER, ADMIN |
| Overtime Requests | Employee submits overtime | MANAGER, ADMIN |
| Subcontractor Payables | Invoice submitted | MANAGER, ADMIN |
| Unified Approval Center | Central hub for all workflows | Role-dependent |

### Project Health Score
- Deterministic 0–100 score from weighted project inputs
- Inputs: budget variance, schedule adherence, RFI response time, submittal status, crew productivity, change order impact
- Snapshot trending stored in `project_health_snapshots`

### Background Jobs Framework
- `node-cron` based job runner
- Outbox dispatcher for integration events
- Scheduled tasks: sync jobs, notification delivery, data retention enforcement

### Document Control & Revisioning
- Sequential revision numbering (R1, R2, R3...)
- Status tracking: Draft, In Review, Approved, Superseded
- Side-by-side comparison UI
- In-app notification on revision approval/rejection
- Full revision history accessible on document detail

### Libraries System
- Custom item libraries with trade-aware seeding
- Assembly builder with grouped line items
- Saved takeoff templates for reuse across bids
- Bulk import support

### Mobile & Offline Sync
- PWA support for field use
- Device registration via `mobile_devices`
- Sync queue for offline changes (`offline_sync_queue`)
- Conflict resolution endpoint
- Status monitoring from Mobile Sync page

### Feature Flags
- Per-org feature flags managed from `/api/feature-flags`
- SUPER_ADMIN can enable/disable platform-wide flags
- Org-level flags overrideable by admins

---

## 11. SECURITY & COMPLIANCE INFRASTRUCTURE

| Feature | Implementation | Status |
|---------|---------------|--------|
| **Helmet.js** | HTTP security headers on all responses | ✓ Active |
| **API Log Redaction** | Sensitive fields (tokens, passwords, keys) redacted from logs | ✓ Active |
| **Rate Limiting** | `apiLimiter` on all `/api` routes, `sensitiveLimiter` on AI/auth endpoints | ✓ Active |
| **RBAC Middleware** | `requireRole()` enforced on every protected route | ✓ Active |
| **CSRF Protection** | Token verification on OAuth and state-changing requests | ✓ Active |
| **AES-256-GCM Encryption** | Integration credentials encrypted at rest | ✓ Active |
| **Audit Logging** | Full audit trail for all write operations with user, action, timestamp | ✓ Active |
| **GDPR Compliance** | Data subject access/deletion requests, processing records | ✓ Active |
| **Data Retention Policies** | Configurable retention periods with automated enforcement | ✓ Active |
| **SSO / SAML 2.0** | Enterprise SSO via `@node-saml/node-saml` | ✓ Active |
| **Audit Export** | CSV/JSON export of audit logs with date filtering | ✓ Active |
| **Session Security** | Active session tracking, revocation, idle timeout | ✓ Active |

---

## 12. WORKFORCE MANAGEMENT SUITE

| Feature | Key Details | Status |
|---------|------------|--------|
| **Time Clock** | GPS/geofence check-in/out, shift management, clock history | ✓ Live |
| **Time Approval** | Manager dashboard for approving/rejecting timesheets | ✓ Live |
| **Manual Time Entry** | Admin time entry and adjustment with reason codes | ✓ Live |
| **Overtime Requests** | Employee submits OT, manager approves with in-app notification | ✓ Live |
| **Payroll Management** | Payroll runs, deductions, pay stubs PDF | ✓ Live |
| **Certified Payroll Reports** | WH-347 form generation for prevailing wage jobs | ✓ Live |
| **Crew Management** | Crew creation, member roster, project assignments | ✓ Live |
| **Crew Scheduling** | Shift scheduling with conflict detection | ✓ Live |
| **Crew Marketplace** | Post and find crew listings | ✓ Live |
| **KPI Management** | Template creation, employee assignment, entry tracking | ✓ Live |
| **Performance Rating** | Rate employees against KPI criteria, view history | ✓ Live |
| **Skills & Certifications** | Track employee skills, proficiency levels, certifications with expiry | ✓ Live |
| **Safety Training** | Create programs, assign employees, track completion, PDF export | ✓ Live |
| **Production Rate Tracking** | Crew productivity metrics per UOM | ✓ Live |
| **Field Productivity Analytics** | Labor cost, material cost, profitability analytics | ✓ Live |
| **Worker Detail Profile** | 6-tab profile: Overview, Skills, Performance, Projects, Logs, Safety Training | ✓ Live |
| **Employee Rewards** | Reward type definitions and assignment tracking | ✓ Live |

---

## 13. ESTIMATING & TAKEOFF ENGINE

| Feature | Key Details | Status |
|---------|------------|--------|
| **Bid Workflow** | 6-step wizard: scope, docs, estimate, takeoff, pricing, review | ✓ Live |
| **PDF Takeoff Viewer** | Multi-page PDF rendering with `pdfjs-dist` | ✓ Live |
| **Interactive Drawing Tools** | Measurement tools via `react-konva` / `konva` | ✓ Live |
| **Calibration** | Scale calibration per PDF page | ✓ Live |
| **Quantity Categories** | Category-based measurement organization | ✓ Live |
| **Measurements Summary** | Summary panel with quantities by category | ✓ Live |
| **Takeoff Assemblies** | Reusable assemblies bound to measurements | ✓ Live |
| **Document Tree** | Project document hierarchy in takeoff workspace | ✓ Live |
| **Estimate Line Item Builder** | Hierarchical line item editor with labor, material, equipment | ✓ Live |
| **Estimate Versioning** | Version history with comparison | ✓ Live |
| **Vendor Quotes** | Attach vendor quotes to estimate line items | ✓ Live |
| **AI Auto-Takeoff** | AI analyzes PDFs for area, count, linear measurements | ✓ Live |
| **Material Calculator** | Preset-based material quantity calculator | ✓ Live |
| **Scope Library** | Reusable scope items and assemblies | ✓ Live |
| **Pricebook Import** | AI-powered CSV pricebook normalization | ✓ Live |
| **Vendor Pricebooks** | Per-vendor price catalogs with history | ✓ Live |
| **Reports** | 9 report types: Takeoff Summary, Estimate Detail, etc. with CSV + print | ✓ Live |

---

## 14. PROJECT LIFECYCLE MANAGEMENT

| Feature | Key Details | Status |
|---------|------------|--------|
| **Project CRUD** | Full project creation, editing, status management | ✓ Live |
| **SOW Tracking** | Unified Scope of Work tracking system per project | ✓ Live |
| **Change Orders** | Full CRUD, AI generation, revision history, multi-level approval | ✓ Live |
| **Schedule of Values** | SOV with line items, billing cycles, lien waivers | ✓ Live |
| **T&M Tracking** | Daily T&M tickets with manager approval workflow | ✓ Live |
| **RFIs** | RFI creation, routing, deadline tracking, response | ✓ Live |
| **Submittals** | Submittal log with review and approval workflow | ✓ Live |
| **Transmittals** | Document transmittal records and distribution | ✓ Live |
| **Addenda** | Addendum tracking with acknowledgment log | ✓ Live |
| **Document Control** | Revision control, sequential numbering, comparison | ✓ Live |
| **Project Health Score** | 0–100 weighted score with snapshot trending | ✓ Live |
| **AI Schedule Generator** | Auto-generate Gantt schedule from project data | ✓ Live |
| **Delay Claims** | Formal delay claim documentation and management | ✓ Live |
| **Inspection Forms** | Field inspection form creation and completion | ✓ Live |
| **Daily Report Locks** | Lock daily reports after approval | ✓ Live |
| **Photo Custody** | Chain-of-custody photo documentation | ✓ Live |
| **Issue Captures** | AI Jobsite Vision photo-based issue logging | ✓ Live |

---

## 15. COMMUNICATION & COLLABORATION

| Feature | Key Details | Status |
|---------|------------|--------|
| **Team Messaging** | Unified conversations with participants, read receipts | ✓ Live |
| **Unified Message Center** | Cross-channel message aggregation | ✓ Live |
| **Client Portal Chat** | Real-time chat with clients through their portal | ✓ Live |
| **Subcontractor Portal Chat** | Chat with subcontractors through their token portal | ✓ Live |
| **In-App Notifications** | Real-time notifications for approvals, mentions, updates | ✓ Live |
| **Approval Notifications** | 6 workflows send notifications to approvers and submitters | ✓ Live |
| **Email Integration** | Connect Gmail/Outlook, view threads, AI summaries, create tasks | ✓ Live |
| **Company Broadcasts** | Company-wide announcement system | ✓ Live |
| **Voice Logs** | Record and transcribe voice notes | ✓ Live |

---

## 16. WEBSITE BUILDER SYSTEM

| Feature | Key Details | Status |
|---------|------------|--------|
| **Page Builder** | Drag-and-drop section-based page editor | ✓ Live |
| **Publishing Controls** | Draft, preview, publish per page | ✓ Live |
| **AI Website Wizard** | AI-assisted website setup and content generation | ✓ Live |
| **SEO Per-Page** | Custom meta title, description, canonical URL, noindex toggle | ✓ Live |
| **Open Graph / Twitter Cards** | Dynamic social share meta tags per page | ✓ Live |
| **Social Share Images** | Site-wide and per-page social share images | ✓ Live |
| **Dynamic Sitemap** | Auto-generated `sitemap.xml` for all published pages | ✓ Live |
| **Robots.txt** | Dynamic `robots.txt` with crawl control | ✓ Live |
| **AI SEO Generator** | AI-generated SEO meta content per page | ✓ Live |
| **Blog System** | Blog posts, categories, comments | ✓ Live |
| **Portfolio/Projects** | Project showcase with images | ✓ Live |
| **Contact Forms** | Website contact form with submissions inbox | ✓ Live |
| **Staging Preview Links** | Token-protected preview links before publishing | ✓ Live |
| **Analytics** | Daily analytics snapshots and event tracking | ✓ Live |
| **Version History** | Page version history with rollback | ✓ Live |
| **Social Links** | Embedded social media links in website footer | ✓ Live |
| **Multi-deployment** | Deployment history tracking | ✓ Live |

---

## 17. SOCIAL MEDIA MANAGEMENT

| Feature | Key Details | Status |
|---------|------------|--------|
| **Account Connections** | Connect multiple social platforms | ✓ Live |
| **Content Calendar** | Scheduled post calendar view | ✓ Live |
| **Post Scheduling** | Schedule posts for future publish dates | ✓ Live |
| **AI Content Generation** | AI writes social posts from project/company context | ✓ Live |
| **Rich Media Picker** | Select/upload images from shared gallery | ✓ Live |
| **Approval Workflow** | Posts require manager approval before publishing | ✓ Live |
| **Analytics** | Per-post engagement analytics | ✓ Live |
| **Multi-Platform Support** | LinkedIn, Facebook, Instagram, Twitter/X | ✓ Live |
| **Post History** | Full history of published and scheduled posts | ✓ Live |

---

## 18. CRM SYSTEM

| Feature | Key Details | Status |
|---------|------------|--------|
| **Organizations** | CRM org records with industry, contact info, compliance dates | ✓ Live |
| **Contacts** | Contact profiles linked to organizations | ✓ Live |
| **Notes** | Notes attached to CRM organizations | ✓ Live |
| **Insurance/Compliance Alerts** | Expiration date tracking with alert notifications | ✓ Live |
| **Vendor Pricing** | Vendor price management and comparison | ✓ Live |
| **Rental Vendors** | Rental equipment vendor catalog | ✓ Live |
| **Vendor Scores** | Performance scoring for vendors | ✓ Live |
| **Material Price Index** | Track material market price trends | ✓ Live |

---

## 19. DASHBOARD & ANALYTICS

| Feature | Key Details | Status |
|---------|------------|--------|
| **WYSIWYG Dashboard Editor** | Section-based layout with draggable widget grid | ✓ Live |
| **Tiered Layout System** | EXECUTIVE_TIER, OPERATIONS_TIER, FIELD_TIER, BASIC_TIER | ✓ Live |
| **Widget Auto-Show/Hide** | Widgets auto-show based on user permissions | ✓ Live |
| **QUICK_ACTIONS Widget** | Dynamic role-aware shortcut buttons | ✓ Live |
| **Color Scheme Customization** | User and org-level color palette selection | ✓ Live |
| **WCAG AA Compliance** | All theme colors meet 4.5:1 contrast ratio | ✓ Active |
| **Org Default Palette** | Admins set org-wide default color scheme | ✓ Live |
| **AI Insights Widgets** | AI-generated insights for dashboard panels | ✓ Live |
| **CFO Dashboard** | AI profitability analysis, equipment metrics | ✓ Live |
| **Executive Digest** | Daily AI business intelligence summary | ✓ Live |
| **Production Rate Analytics** | Crew productivity, cost, profitability per UOM | ✓ Live |
| **Company Health** | Org-level health metrics and KPI overview | ✓ Live |
| **AI PM Dashboard** | AI-generated project plans and task lists | ✓ Live |

---

## 20. SUPER ADMIN / PLATFORM ADMIN

Access restricted to `SUPER_ADMIN` role only.

| Feature | Location | Description | Status |
|---------|----------|-------------|--------|
| **Platform Dashboard** | `/platform-admin` | Platform overview: org count, user count, revenue metrics | ✓ Live |
| **Organization Management** | `/platform-admin/organizations` | View all orgs, search, filter by tier | ✓ Live |
| **Org Detail** | `/platform-admin/organizations/:id` | Full org detail: users, settings, billing, feature flags | ✓ Live |
| **Platform Analytics** | `/platform-admin/analytics` | Cross-org usage, feature adoption, revenue trends | ✓ Live |
| **Platform Audit Log** | `/platform-admin/audit` | Platform-level audit trail | ✓ Live |
| **Subscription Management** | `/platform-admin/subscriptions` | Override tiers, manage add-ons per org | ✓ Live |
| **Support Tools** | `/platform-admin/support` | User impersonation, password reset, debug tools | ✓ Live |
| **User Impersonation** | `/impersonate` | Log in as any user for support purposes | ✓ Live |

---

## 21. HUSTLER NETWORK (MULTI-ORG)

Reserved for the Hustler subscription tier ($1,199/mo). Allows business owners to manage multiple separate contractor organizations from a single account.

| Feature | Description | Status |
|---------|-------------|--------|
| **Org Linking** | Link multiple organizations to one Hustler account | ✓ Live |
| **Org Switching** | Instant switch between linked orgs | ✓ Live |
| **Hustler Dashboard** | Cross-org summary dashboard | ✓ Live |
| **Unified Inbox** | Cross-org message inbox | ✓ Live |
| **Cross-Org Analytics** | Benchmarking and performance across all linked orgs | ✓ Live |
| **Delegate Access** | Grant delegate access to team members across orgs | ✓ Live |
| **Invite System** | Accept org link invitations | ✓ Live |
| **Benchmarking** | Compare metrics between owned organizations | ✓ Live |

---

## 22. EXTERNAL DEPENDENCIES

| Dependency | Purpose | Integration Method |
|-----------|---------|-------------------|
| **PostgreSQL (Neon)** | Primary database | `DATABASE_URL` env var, Drizzle ORM |
| **Replit Object Storage (GCS)** | File storage for uploads | `javascript_object_storage` integration |
| **OpenAI GPT-4o / GPT-4** | All AI features | `javascript_openai_ai_integrations`, `OPENAI_API_KEY` |
| **Resend** | Transactional email | `RESEND_API_KEY` secret |
| **Google OAuth** | Social login + Gmail integration | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| **QuickBooks Online** | Accounting sync | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` |
| **JWT** | Auth tokens in httpOnly cookies | `jsonwebtoken` library |
| **Bcrypt** | Password hashing | `bcryptjs` library |
| **Uppy** | Enhanced file upload UI | npm package |
| **node-cron** | Background job scheduling | npm package |
| **react-konva / konva** | Interactive takeoff drawing canvas | npm package |
| **pdfjs-dist** | Multi-page PDF rendering | npm package |
| **xlsx** | Spreadsheet import/export | npm package |
| **Recharts** | Data visualization charts | npm package |
| **react-grid-layout** | Dashboard WYSIWYG grid editor | npm package |
| **@node-saml/node-saml** | SAML 2.0 Service Provider | npm package |
| **Helmet** | HTTP security headers | npm package |
| **Drizzle ORM** | Type-safe database access | npm package |
| **Wouter** | Frontend routing | npm package |
| **TanStack Query** | Server state management | npm package |
| **shadcn/ui** | UI component library | npm package |
| **Tailwind CSS** | Utility-first styling | npm package |
| **Zod** | Runtime schema validation | npm package |
| **SendGrid** | Email delivery (additional) | `sendgrid` integration |

---

*End of AUDIT_3_12_26_SYSTEM — SmartManageAI Platform — March 12, 2026*
