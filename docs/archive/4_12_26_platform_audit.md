# SmartManageAI — Platform Audit
**Date**: April 12, 2026  
**Scope**: Full codebase architecture, schema, routes, frontend, RBAC, AI, integrations, billing, jobs, events, security, and known gaps

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Codebase Statistics](#2-codebase-statistics)
3. [Architecture Overview](#3-architecture-overview)
4. [Database Schema](#4-database-schema)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [RBAC — 8-Role System](#6-rbac--8-role-system)
7. [Feature Permissions System](#7-feature-permissions-system)
8. [Backend Routes](#8-backend-routes)
9. [Frontend Pages & Components](#9-frontend-pages--components)
10. [AI Modules](#10-ai-modules)
11. [Background Jobs & Cron](#11-background-jobs--cron)
12. [Domain Event Bus](#12-domain-event-bus)
13. [Integration Hub](#13-integration-hub)
14. [Billing & Subscription Plans](#14-billing--subscription-plans)
15. [Security Posture](#15-security-posture)
16. [Known Gaps & Non-Functional Systems](#16-known-gaps--non-functional-systems)

---

## 1. Executive Summary

SmartManageAI is a white-label, multi-tenant SaaS platform for construction project lifecycle management. It serves multiple trades through AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite spanning project management, estimating, CRM, compliance, workforce, financial management, hiring, and more.

The platform is built on a React + Express + PostgreSQL stack with Drizzle ORM, deployed on Replit. As of this audit date, the codebase contains **357,000+ lines of code**, **413 database tables** (pgTable definitions), **128 route files**, **115 frontend pages**, **447 component files**, and **19 AI modules**. The system is operational in development mode with all core features functional. Production-only features (AI schedulers, background jobs) are gated behind `NODE_ENV=production`.

---

## 2. Codebase Statistics

| Metric | Count |
|---|---|
| Total Lines of Code | ~357,454 |
| Database Tables (pgTable definitions) | 413 |
| Schema Files (shared/schema/) | 5 files, 12,707 lines |
| Backend Route Files | 128 |
| Frontend Pages (client/src/pages/) | 115 |
| Frontend Component Files (client/src/components/) | 447 |
| AI Modules (server/ai/) | 19 |
| Background Cron Jobs | 16 |
| Domain Event Types | 33 |
| Feature Permission Flags | 73 |
| Billing Feature Keys | 44 |
| Add-On Keys | 9 |
| Startup Migration Scripts (server/migrations/) | 32 |
| Drizzle Kit Migrations (migrations/) | 48 |
| TypeScript ensure* Scripts (server/utils/) | 21 |
| Integration Providers (registered) | 10 |
| Remaining `console.error` Usages | 72 |

---

## 3. Architecture Overview

### Technology Stack
- **Frontend**: React 18 + TypeScript, Wouter (routing), TanStack Query v5, Tailwind CSS, shadcn/ui, Recharts, react-grid-layout, react-konva
- **Backend**: Express.js + TypeScript, single-process Node server
- **Database**: PostgreSQL (Neon), Drizzle ORM, Drizzle-Zod for validation
- **Authentication**: JWT (httpOnly cookies, 7-day expiry), bcrypt (10 rounds), CSRF double-submit, token versioning for revocation
- **Real-time**: WebSocket support (messaging), LiveKit (video calls, gated)
- **File Storage**: Replit Object Storage (GCS backend), multer (10MB memory limit)
- **AI**: OpenAI GPT-4/GPT-4o via integration key
- **Email**: Resend API
- **Scheduling**: node-cron
- **PDF**: Custom PDF generation service
- **3D/BIM**: Three.js, web-ifc, laz-perf

### Server Architecture
- Single Express server on `PORT` (default 5000), serving both API and Vite-bundled frontend
- Trust proxy enabled for accurate IP behind Replit proxy
- Helmet security headers (CSP disabled for development flexibility)
- CORS configured from `REPLIT_DEV_DOMAIN` and `REPLIT_DOMAINS`
- Compression enabled via `compression` middleware
- Global error handler persists errors to `error_logs` table
- Uncaught exceptions and unhandled rejections both caught and persisted

### Startup Sequence
1. Express app created with middleware stack
2. Routes registered (`registerRoutes`)
3. Ops routes registered BEFORE auth middleware (health checks public)
4. Auth middleware applied globally
5. Organization suspension check applied globally (SUPER_ADMIN bypasses)
6. API rate limiter applied to `/api/*`
7. Vite dev server (development) or static serving (production)
8. Event bus initialized
9. Startup migrations run (`runStartupMigrations`)
10. Built-in permission presets seeded
11. Feature flags backfilled
12. Server listens, then conditionally starts AI schedulers + job runner (production only)

---

## 4. Database Schema

### Schema Organization
The schema is split across 5 files in `shared/schema/`:
- **index.ts** — Main tables (users, organizations, projects, bids, estimates, etc.)
- **enums.ts** — All PostgreSQL enum types
- **features.ts** — Feature flags, permissions, dashboard customization
- **hiring.ts** — ATS tables (jobs, candidates, interviews, talent pool)
- **Additional schema files** — Various domain-specific tables

### Key Tables by Domain

**Core Identity**
- `users` — User accounts with role, org linkage, cost rates, walkthrough state
- `organizations` — Tenant orgs with trade type, plan tier, feature flags, branding
- `hustler_organizations` — HUSTLER multi-org linkage with role override

**Projects & Bids**
- `projects` — Project records with status state machine (BID→PLANNING→ACTIVE→COMPLETE→CLOSED)
- `bids` — 6-step bid workflow with AI scoring
- `estimates`, `estimate_line_items` — Hierarchical estimate builder
- `scope_items` — Project scope breakdown
- `change_orders` — Change order lifecycle with multi-level approval

**Takeoff & Measurement**
- `takeoff_sheets` — Versioned takeoff sheets with supersede tracking
- `takeoff_measurements` — Individual measurements with geometry data
- `quantity_categories` — Measurement categorization
- `takeoff_locations` — Hierarchical location system

**Financial**
- `time_entries`, `time_clock_shifts` — Time tracking with GPS/geofence
- `receipts` — Expense tracking
- `tm_daily_sheets`, `tm_tickets` — Time & Material billing
- `schedule_of_values`, `sov_line_items` — SOV management
- `aia_billing_*` — AIA G702/G703 progress billing
- `cost_ledger_entries` — Unified cost ledger
- `project_profitability_snapshots` — Point-in-time profitability capture
- `revenue_recognition_*` — WIP reporting tables
- `overhead_cost_*` — Overhead allocation

**Subcontracts**
- `subcontractors`, `subcontractor_contracts`, `subcontractor_payments`
- `subcontract_pay_applications` — Pay app workflow
- `subcontractor_performance_reviews` — Performance tracking

**Procurement**
- `purchase_orders`, `po_line_items`, `po_receipts` — Full procure-to-pay
- `three_way_match_results` — Automated PO/receipt/invoice matching

**CRM**
- `crm_organisations`, `crm_contacts`, `crm_opportunities` — Full CRM
- `crm_opportunity_activities` — Activity tracking
- 7-stage sales pipeline

**Workforce**
- `crews`, `crew_members` — Crew management
- `skills`, `user_skills` — Skill tracking and verification
- `payroll_runs`, `payroll_entries` — Payroll processing
- `overtime_rules`, `overtime_requests` — Configurable overtime
- `leave_requests`, `leave_balances` — Leave management
- `peer_coworker_ratings` — Anonymous peer ratings

**Hiring (ATS)**
- `hiring_jobs`, `hiring_candidates`, `hiring_interviews`
- `hiring_candidate_scores` — AI candidate scoring
- `talent_profiles` — Talent pool with AI skill match

**Safety & Compliance**
- `safety_trainings`, `safety_incidents` — Safety tracking
- `ppe_compliance_logs` — PPE compliance per project
- `material_test_logs` — QC material testing (7 test types)
- `permits_licenses` — Permit lifecycle tracking (10 types)
- `inspections` — Inspection scheduling and tracking

**Communication**
- `messages`, `message_threads` — Unified messaging
- `notifications` — Multi-channel notifications
- `notification_preferences` — Per-user channel preferences
- `push_subscriptions` — Web push subscriptions

**Documents**
- `plan_documents`, `media` — File management
- `document_revisions` — Versioned document control
- `drawing_sets`, `drawing_sheets` — Drawing management
- `addenda`, `addendum_items` — Addenda tracking

**Website & Social**
- `website_config`, `website_pages` — Website builder
- `social_accounts`, `social_media_posts` — Social media management (7 platforms)
- `email_campaigns`, `email_campaign_contacts`, `email_campaign_templates` — Email marketing

**Contracts**
- `contracts` — Contract lifecycle with e-sign
- `contract_clauses`, `clause_templates` — Clause library
- `contract_risk_analyses` — AI risk analysis

**Asset Management**
- `asset_handovers`, `asset_warranties`, `maintenance_logs`

**Risk Management**
- `project_risks` — Risk register with probability/impact scoring

**Scheduling**
- `schedule_tasks`, `task_dependencies` — CPM scheduling
- `schedule_baselines` — Baseline comparison

**Integration**
- `integration_connections`, `integration_sync_state` — Connection management
- `integration_outbox_events` — Outbox pattern for webhooks
- `qbo_sync_schedules` — QuickBooks sync scheduling

**Platform Administration**
- `audit_log` — Comprehensive audit trail
- `error_logs` — Structured error persistence
- `billing_events` — Billing event tracking
- `retention_policies` — Data retention configuration
- `feature_flags` — Organization-level feature gating
- `sso_configs` — SSO/SAML 2.0 configuration
- `api_usage_daily`, `ai_usage_daily` — Platform usage tracking

**Workflow & Approvals**
- `approval_chains`, `approval_chain_steps`, `approval_requests` — Multi-step approval
- `workflow_definitions`, `workflow_instances`, `workflow_transitions` — No-code workflow builder (NOTE: tables may not exist — see Known Gaps)

---

## 5. Authentication & Authorization

### Authentication Flow
1. **Login**: Email + password → bcrypt verify → JWT generated with `userId` + `tokenVersion` → httpOnly cookie set (7d expiry)
2. **Token Verification**: Every request → extract cookie → verify JWT → load user from DB → check `tokenVersion` match → check `isActive`
3. **Token Revocation**: Increment `tokenVersion` in DB → all existing tokens immediately invalid
4. **OAuth**: Google Sign-In (configured), Apple Sign-In (env vars missing)
5. **Passkey/WebAuthn**: Full FIDO2 registration and authentication flow
6. **SSO/SAML 2.0**: Enterprise SSO with SAML configuration per org

### Cookie Configuration
```
Name: auth_token
HttpOnly: true
Secure: true (production only)
SameSite: lax
MaxAge: 7 days
```

### CSRF Protection
- Double-submit cookie pattern via `setCsrfToken` + `validateCsrf` middleware
- Applied globally to all routes

### Password Security
- bcrypt with 10 salt rounds
- Account lockout after failed attempts (`locked_until`, `failed_login_attempts`)
- Password reset via time-limited tokens with email notification

### Rate Limiting (4-Tier)
| Limiter | Window | Max Requests | Scope |
|---|---|---|---|
| `authLimiter` | 15 min | 15 | Auth endpoints (login, register, reset) |
| `sensitiveLimiter` | 15 min | 100 | Sensitive operations (per user/IP) |
| `apiLimiter` | 15 min | 1,000 | All `/api/*` routes (per user/IP) |
| `exportLimiter` | 15 min | 20 | Export/download endpoints (per user/IP) |

---

## 6. RBAC — 8-Role System

### Roles (Hierarchical)
| Role | Description | Access Level |
|---|---|---|
| `SUPER_ADMIN` | Platform-wide administrator | All orgs, all features, bypasses org suspension |
| `HUSTLER` | Multi-company owner | Gets ADMIN-level effective role per linked org via `hustler_organizations` |
| `ADMIN` | Organization administrator | Full org access |
| `MANAGER` | Project/team manager | Broad project + workforce access |
| `SUPERINTENDENT` | Field superintendent | Field operations, safety, daily reports |
| `ESTIMATOR` | Estimating specialist | Bids, estimates, takeoffs |
| `FIELD_WORKER` | Field crew member | Time clock, daily tasks, limited views |
| `VENDOR` | External vendor/subcontractor | Portal access, limited document views |

### HUSTLER Role Mechanics
- Base role is `HUSTLER` in the `users` table
- Linked to multiple orgs via `hustler_organizations` table
- `effectiveRole` determined at auth middleware time: `link.roleOverride || "ADMIN"`
- `isHustlerOwner = true` when active link exists
- Permission checks use `effectiveRole` (not base role) for gating

### Route Protection Pattern
```typescript
requireAuth → requireRole(...roles) → verifyOrgAccess(req, res, orgId)
```
- `verifyOrgAccess`: Returns 404 if user's `organizationId` doesn't match requested org (SUPER_ADMIN bypasses)
- `requireActiveOrganization`: Blocks all requests if org is suspended (403)

---

## 7. Feature Permissions System

### Architecture
- **73 boolean permission flags** defined in `FeaturePermissionKey` type
- **Per-role defaults** via `getRoleDefaults(role)` — every role gets a base set
- **Per-user overrides** stored in `user_dashboard_permissions` table
- **Merge logic**: DB overrides take precedence over role defaults; SUPER_ADMIN always gets full access
- **Financial access**: Special 3-tier model (`none` / `view` / `manage`) mapping to `canViewFinancials` + `canEditFinancials`

### Permission Categories
- **Dashboard & Navigation**: `canAccessDashboard`, `canAccessProjects`, `canAccessCalendar`, etc.
- **Bid Management**: `canViewBids`, `canEditBids`, `canDeleteBids`, `canGenerateBidPDFs`, `canConvertBidToProject`
- **Financial**: `canViewFinancials`, `canEditFinancials`, `canAccessCFODashboard`, `canAccessTMBilling`, `canAccessProgressBilling`
- **Workforce**: `canAccessTimeClock`, `canManageTimeClock`, `canApproveTime`, `canManagePayroll`, `canManageCrews`
- **Safety**: `canManageSafety`, `canViewSafety`
- **AI**: `canUseAiFeatures`, `canViewAiSummaries`, `canUseAiBidAnalysis`, `canUseAiContractAnalysis`
- **Admin**: `canAccessCompanySettings`, `canManageUsers`, `canAccessAuditLogs`, `canAccessEnterpriseSettings`
- **Project-Specific**: `canViewProjectBudget`, `canViewProjectEstimates`, `canCreateChangeOrders`, etc.
- **Social/Marketing**: `canPostSocialMedia`, `canManageWebsite`, `canAccessExecutiveDigest`
- **Hiring**: `canManageHiring`, `canAccessHiringInterviews`, `canManageHiringSettings`

### Permission Presets
- Built-in presets seeded on startup (`seedBuiltInPresets`)
- Admins can create custom presets and apply to users

### Middleware Variants
| Middleware | Usage |
|---|---|
| `requireFeaturePermission(key)` | Single permission gate |
| `requireAnyFeaturePermission(...keys)` | OR-gate (any one is sufficient) |
| `requireRoleOrFeature(roles, key)` | Role OR permission (hybrid) |

---

## 8. Backend Routes

### Route Registration Order (in `registerRoutes`)
All routes are registered after auth middleware and API rate limiter. Organization suspension check applies globally.

### Route File Inventory (128 files)

**Core CRUD & Project**
- `projectCrudRoutes` — Project create/read/update/delete
- `projectContentRoutes` — Notes, media, documents
- `projectFinancialRoutes` — Budget, actuals, financials
- `projectOpsRoutes` — Operational project data
- `projectReportRoutes` — Project reporting

**Estimating & Takeoff**
- `estimateRoutes` — Estimates and line items
- `bidRoutes2` — Bid CRUD with 6-step workflow
- `takeoffSheetRoutes`, `takeoffMeasurementRoutes`, `takeoffCategoryRoutes`, `takeoffIssueRoutes` — Takeoff workspace
- `takeoffCrossModuleRoutes` — Cross-module takeoff data
- `scopeRoutes` — Scope management
- `locationRoutes` — Hierarchical location system
- `assemblyRoutes` — Assembly library

**Financial**
- `billingRoutes` — Subscription billing
- `platformBillingRoutes` — Platform billing admin
- `aiaBillingRoutes` — AIA progress billing
- `costEngineRoutes` — Budget vs actual cost engine
- `costLedgerRoutes` — Unified cost ledger
- `profitabilityAlertRoutes` — Profitability monitoring
- `revenueRecognitionRoutes` — WIP reporting
- `overheadRoutes` — Overhead cost allocation
- `laborRateRoutes` — Labor rate management

**Workforce & Time**
- `timeClockRoutes` — GPS time clock
- `timeEntryRoutes` — Time entry approval
- `overtimeRoutes` — Overtime management
- `payrollRoutes` — Payroll processing
- `crewRoutes2` — Crew management
- `skillRoutes` — Skills management
- `workforceRoutes` — Worker management
- `leaveRoutes` — Leave management
- `kpiRoutes` — KPI dashboards

**Change Orders**
- `changeOrderCrudRoutes` — CRUD operations
- `changeOrderApprovalRoutes` — Multi-level approval
- `changeOrderExportRoutes` — PDF export

**Subcontracts**
- `subcontractRoutes` — Subcontract agreements
- `subcontractorPayablesRoutes` — Payment processing
- `subcontractManagementRoutes` — SOV, pay apps, retention, performance

**Procurement**
- `procurementModuleRoutes` — Full procure-to-pay lifecycle

**CRM**
- `crmRoutes` — Full CRM with pipeline
- `vendorRoutes` — Vendor management

**Communication**
- `messagingRoutes` — Unified messaging with WebSocket
- `notificationRoutes2` — Notification CRUD
- `notificationPreferencesRoutes` — Per-user preferences
- `pushSubscriptionRoutes` — Web push
- `clientChatRoutes` — Client portal chat
- `subChatRoutes` — Subcontractor chat

**Documents**
- `organizationDocumentRoutes` — Org documents
- `documentRevisionRoutes` — Version control
- `drawingSetRoutes` — Drawing management
- `addendaRoutes` — Addenda tracking

**AI**
- `aiOrchestrationRoutes` — Unified AI endpoint (document, scheduling, takeoff, CFO analytics)
- `aiOnboardingRoutes` — AI trade discovery and onboarding

**Safety & Compliance**
- `inspectionRoutes` — Inspection scheduling
- `permitRoutes` — Permits & licenses
- `safetyTrainingRoutes` — Safety training management
- `safetyWorkflowRoutes` — Safety workflows
- `materialTestRoutes` — QC material testing
- `ppeComplianceRoutes` — PPE compliance

**Field Operations**
- `punchListRoutes` — Punch list management
- `warrantyRoutes` — Warranty tracking
- `delayRoutes` — Delay tracking
- `fieldProductivityRoutes` — Field productivity
- `rfiRoutes` — RFIs
- `transmittalRoutes` — Transmittals
- `submittalRoutes` — Submittals
- `mobilizationRoutes` — Site mobilization & method statements

**Website & Marketing**
- `websiteRoutes` — Website builder
- `websiteAiRoutes` — AI website wizard
- `socialRoutes` — Social media management (7 platforms)
- `emailCampaignRoutes` — Email marketing campaigns
- `emailRoutes` — Email management

**Integration**
- `integrationRoutes` — Integration hub
- `weatherRoutes` — Weather data

**Portals**
- `portalRoutes` — Legacy portal routes
- `unifiedPortalRoutes` — Unified external portal (`/portal`)
- `clientPortalRoutes` — Client portal

**Hiring**
- `hiringRoutes` — ATS job postings, candidates, interviews
- `talentPoolRoutes` — Talent pool and marketplace

**Contracts**
- `contractRoutes` — Contract lifecycle
- `clauseLibraryRoutes` — Clause library

**Asset & Risk**
- `assetManagementRoutes` — Asset handover, warranty, maintenance
- `riskRoutes` — Risk register

**BIM & LiDAR**
- `bimRoutes` — IFC viewer
- `lidarRoutes` — Point cloud scanner

**Scheduling**
- `scheduleRoutes` — CPM scheduling engine

**Platform Admin**
- `platformRoutes` — Super admin, org management, API usage
- `dashboardRoutes` — Dashboard + user management + permission presets
- `featureFlagRoutes` — Feature flag management
- `ssoRoutes` — SSO/SAML configuration
- `auditExportRoutes` — Audit log export
- `retentionRoutes` — Data retention policies
- `privacyRoutes` — GDPR/privacy compliance
- `reportRoutes` — Report generation
- `executiveDigestRoutes` — Executive digest emails
- `auditBillingStorageRoutes` — Audit, billing, storage admin views

**Auth**
- `authProfileRoutes` — Login, register, profile, password
- `oauthRoutes` — Google/Apple OAuth
- `passkeyRoutes` — WebAuthn/FIDO2

**Other**
- `opsRoutes` — Health checks (registered before auth)
- `devSeedEnterpriseRoutes` — Dev seed data (gated by flag)
- `hustlerRoutes` — Hustler multi-org management
- `bidNetworkRoutes` — Subcontractor bid network
- `marketplaceRoutes` — Contractor marketplace directory
- `modifierRoutes` — Scope modifiers
- `libraryRoutes` — Onboarding libraries
- `calculatorRoutes` — Material calculators
- `sovRoutes` — Schedule of values
- `approvalRoutes` — Approval framework
- `workflowRoutes` — No-code workflow builder
- `userSettingsRoutes` — Account settings
- `mobileSyncRoutes` — Mobile/offline sync
- `productionRateRoutes` — Production rates
- `materialTrackingRoutes` — Material tracking
- `equipmentRoutes` — Equipment management
- `notesRoutes` — Daily notes
- `projectNotePagesRoutes` — Notion-style notes
- `taskRoutes` — Task management
- `onboardingLibraryRoutes` — Reference data

---

## 9. Frontend Pages & Components

### Page Count: 115 pages in `client/src/pages/`

### Key Page Categories
- **Dashboard**: Main dashboard with WYSIWYG customization
- **Projects**: List, detail (multi-tab), creation wizard
- **Bids**: 6-step bid workflow, bid detail, bid network
- **Estimating**: Takeoff workspace with interactive drawing tools
- **Financial**: CFO dashboard, cost tracking, AIA billing, profitability
- **Workforce**: Time clock, crews, payroll, KPIs, scheduling
- **CRM**: Contact management, opportunity pipeline, activities
- **Safety**: Training, incidents, PPE compliance, material testing
- **Hiring**: Job postings, candidate pipeline, interviews, talent pool
- **Settings**: Unified settings hub with sidebar routing (`/settings/*`)
- **Portal**: Unified external portal for clients/subs/vendors
- **Website**: Page builder, publishing, DNS management
- **Social**: Post scheduling, analytics, engagement tracking
- **Admin**: Platform admin, super admin dashboard, feature flags

### Component Count: 157 directories/files in `client/src/components/`

### UI Framework
- **shadcn/ui** — All form components, dialogs, dropdowns, etc.
- **Tailwind CSS** — Utility-first styling with dark mode support
- **Recharts** — Charts and data visualization
- **react-grid-layout** — Dashboard widget layout
- **react-konva** — Interactive drawing canvas for takeoffs
- **Lucide React** — Icon system
- **Wouter** — Client-side routing

---

## 10. AI Modules

### 19 Modules in `server/ai/`

| Module | Purpose |
|---|---|
| `orchestrator.ts` | Central AI request routing and response formatting |
| `openaiClient.ts` | OpenAI API client wrapper |
| `systemPrompt.ts` | System prompt construction for construction context |
| `assistantPrompt.ts` | Assistant prompt templates |
| `scheduler.ts` | AI PM + CFO scheduled analysis (production only) |
| `documentExtractor.ts` | AI-powered document text extraction and analysis |
| `scopePredictionEngine.ts` | Scope item prediction from project data |
| `changeOrderAutomation.ts` | Auto-generate change orders from takeoff deltas |
| `profitabilityEngine.ts` | Project profitability calculation and prediction |
| `subRecommendationEngine.ts` | Subcontractor ranking by composite score |
| `dataQualityScorer.ts` | Data quality assessment across modules |
| `moduleAnalyzers.ts` | Per-module AI analysis (project, bid, safety, etc.) |
| `tradeDiscoveryService.ts` | AI trade type detection during onboarding |
| `vendorPriceListExtractor.ts` | AI extraction from vendor price list documents |
| `walkthroughContent.ts` | AI-generated onboarding walkthrough content |
| `winProbabilityService.ts` | AI bid win probability scoring |
| `modifierPrompt.ts` | AI scope modifier suggestions |
| `emailAi.ts` | AI email categorization, task extraction, replies |
| `snapshotBuilder.ts` | Point-in-time data snapshot construction |

### AI Scheduling
- **AI PM + CFO Scheduler**: Runs daily at configured time (default 6:00 AM), production only
- **AI Notes Scheduler**: Hourly + daily at 6 PM, production only
- **Manual Trigger**: "Run AI Analysis" button available in development mode

### AI Governance
- Feature-gated via `AI_GOVERNANCE` feature key
- Add-on: `ai_governance_pack` ($49/mo implied from add-on list)

---

## 11. Background Jobs & Cron

### 16 Scheduled Jobs (Production Only)

| Job | Schedule | Description |
|---|---|---|
| Outbox Processor | Every 2 min | Process integration outbox events, deliver webhooks |
| Retention Processor | Daily 2:00 AM | Execute data retention policies (delete old audit logs, etc.) |
| Sync Schedule Processor | Every 15 min | Run due QBO sync operations (chart of accounts, customers, payments, POs, reconciliation) |
| Social Post Publisher | Every 2 min | Publish scheduled social media posts (7 platforms) with retry (max 3) |
| Token Expiry Checker | Daily 3:00 AM | Check social account token expiration, notify owners |
| Compliance Checker | Daily 7:00 AM | Check document/insurance/license expiration, send alerts |
| Profitability Monitor | Every 15 min | Calculate project profitability snapshots, trigger alerts |
| Idle Opportunity Detector | Daily 8:00 AM | Find CRM opportunities with no activity for 7+ days, notify |
| Orphan Upload Cleaner | Every 30 min | Clean up upload intents older than 24 hours |
| Bid Due Date Monitor | Hourly | Check for bids due within 24/48 hours, notify estimators |
| IMAP Email Sync | Every 15 min | Sync IMAP and Outlook email accounts |
| Weekly Report Generator | Monday 7:00 AM | Generate weekly project/org reports |
| Monthly Report Generator | 1st of month 7:00 AM | Generate monthly reports |
| DB Health Check | Every 6 hours | Run database health check queries |
| Social Engagement Sync | Every 4 hours | Fetch engagement metrics for published social posts |
| GCS Orphan Scan | Daily 2:00 AM | Nightly scan for orphaned files in object storage |

### Additional Schedulers (Separate from Job Runner)
- **AI PM+CFO Scheduler** — `server/ai/scheduler.ts` (daily)
- **AI Notes Scheduler** — `server/aiNotesScheduler.ts` (hourly + daily)
- **Storage Orphan Scan** — `server/storageOrphanScanJob.ts` (daily)

---

## 12. Domain Event Bus

### Architecture
- **In-process, typed EventBus** initialized at startup before server listens
- **33 domain event types** defined in `server/events/eventTypes.ts`
- **Envelope pattern**: Every event carries `version`, `orgId`, `actorId`, `timestamp`
- **Listeners** registered in `server/events/index.ts` via `initializeEventBus()`

### Event Types

| Event | Trigger |
|---|---|
| `project.created` | New project created |
| `project.status_changed` | Project status transition |
| `bid.submitted` | Bid submitted |
| `bid.converted_to_project` | Bid converted to project |
| `bid.status_changed` | Bid status change |
| `bid.assigned` | Bid assigned to estimator |
| `bid.due_date_approaching` | Bid within 24/48h of due date |
| `change_order.approved` | Change order approved |
| `change_order.rejected` | Change order rejected |
| `timeclock.checked_in` | Worker clock-in |
| `timeclock.checked_out` | Worker clock-out |
| `payroll.run.completed` | Payroll run finalized |
| `hiring.job_published` | Job posting published |
| `hiring.candidate_applied` | New candidate application |
| `hiring.candidate_stage_changed` | Candidate pipeline stage change |
| `hiring.candidate_hired` | Candidate hired |
| `hiring.interview_scheduled` | Interview scheduled |
| `hiring.integration_connected` | Hiring integration connected |
| `budget.alert_triggered` | Budget threshold exceeded |
| `crm.opportunity_created` | New CRM opportunity |
| `crm.opportunity_stage_changed` | Opportunity pipeline stage change |
| `crm.activity_created` | CRM activity logged |
| `document.revision_created` | New document revision uploaded |
| `safety.incident_created` | Safety incident reported |
| `cost_ledger.posted` | Cost ledger entry posted |
| `inspection.completed` | Inspection completed |
| `po.receipt_recorded` | PO receipt recorded |
| `tm_ticket.approved` | T&M ticket approved |
| `subcontractor.payment_made` | Subcontractor payment issued |
| `equipment.actual_logged` | Equipment actual cost logged |
| `receipt.created` | Receipt/expense created |
| `risk.status_changed` | Risk status changed |
| `takeoff.version_superseded` | Takeoff sheet version superseded (triggers auto PCO) |

---

## 13. Integration Hub

### Provider-Agnostic Framework
- Centralized connection management in `server/integrations/`
- Provider registry with `registerAllProviders()` called at startup
- Token refresh handling in sync scheduler
- Outbox pattern for webhook delivery

### Registered Integration Providers (10)
All providers are registered in `server/integrations/providers/index.ts` via `registerAllProviders()`:

| # | Provider | Registry Key | Status | Capabilities |
|---|---|---|---|---|
| 1 | **QuickBooks Online** | `qbo` | Active | Chart of accounts import, customer export, subcontractor payment export, PO export, payment reconciliation. Scheduled sync support. Only provider with sync operations implemented. |
| 2 | **Google Workspace** | `google` | Configured (OAuth) | Gmail (email sync), Calendar integration. Google Sign-In for auth. |
| 3 | **Microsoft 365** | `microsoft` | Code exists | Outlook email sync, Calendar. Requires credentials. |
| 4 | **DocuSign** | `esign` | Code exists | E-signature for contracts. Requires credentials. |
| 5 | **Zapier** | `zapier` | Code exists | Automation webhooks. Requires credentials. |
| 6 | **Dropbox** | `dropbox` | Code exists | Cloud file storage sync. Requires credentials. |
| 7 | **Google Drive** | `gdrive` | Code exists | Cloud file storage sync. Requires credentials. |
| 8 | **OneDrive** | `onedrive` | Code exists | Cloud file storage sync. Requires credentials. |
| 9 | **Box** | `box` | Code exists | Cloud file storage sync. Requires credentials. |
| 10 | **STACK CT** | `stackct` | Active | Construction technology data sync |

### Non-Registry Services (Not Integration Providers, But Core Dependencies)
| Service | Status | Purpose |
|---|---|---|
| **OpenAI** | Active (via Replit integration) | GPT-4/4o for all AI features |
| **Resend** | Active | Transactional + campaign email delivery |
| **LiveKit** | Partially configured | Video calling (see Known Gaps — `LIVEKIT_API_SECRET` missing) |
| **Metered** | Configured | TURN/STUN server for WebRTC |

### Integration Status Service
Checks environment variables at startup and reports status:
- `livekit`: Requires `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` + `LIVEKIT_URL`
- `twilio`: Requires `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER`
- `openai`: Requires `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`
- `resend`: Requires `RESEND_API_KEY`

### Social Platform Integrations (7 Platforms)
All have real API publishing implementations in `server/social/publishService.ts`:
1. **Facebook** — Requires `FB_APP_ID`, `FB_APP_SECRET`
2. **Instagram** — Via Facebook Graph API
3. **LinkedIn** — Requires `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
4. **Twitter/X** — Requires `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`
5. **TikTok** — Video upload API
6. **YouTube** — Video upload via YouTube Data API
7. **Pinterest** — Pin creation API

---

## 14. Billing & Subscription Plans

### Plan Tiers

| DB Value | Display Name | Price | Target |
|---|---|---|---|
| `free` | Trial | $0 | Evaluation (14-day) |
| `starter` | Starter | $89/mo | Under $500k revenue |
| `professional` | Growth | $229/mo | $500k–$2M revenue |
| `enterprise` | Scale | $579/mo | $2M–$10M revenue |
| `enterprise` + flag | Hustler | $1,199/mo | Multi-company owners |

### Add-Ons (9)

| Key | Name | Price | Category |
|---|---|---|---|
| `ai_pm` | AI PM Pack | $39/mo | AI |
| `ai_cfo` | AI CFO Pack | $59/mo | AI |
| `ai_email` | AI Email & Admin Pack | $29/mo | AI |
| `website_seo` | Website + SEO Pack | $39/mo | Growth |
| `bid_network` | Bid Network Pack | $49/mo | Growth |
| `ai_vision` | AI Vision Pack | $79/mo | AI |
| `integration_qbo` | QuickBooks Integration | — | Growth |
| `integration_esign` | E-Signature Integration | — | Growth |
| `ai_governance_pack` | AI Governance Pack | — | AI |

### Feature Gating
- **44 feature keys** defined in `FeatureKey` type
- Each plan tier has default features via `PLAN_DEFAULT_FEATURES`
- Add-ons map to individual feature keys via `ADDON_FEATURES`
- Feature checks: `hasFeatureAccess(org, featureKey)` function
- Organization `feature_flags` JSON column stores per-org overrides

---

## 15. Security Posture

### Strengths
1. **JWT with token versioning** — Immediate revocation by incrementing `tokenVersion`
2. **httpOnly + Secure cookies** — No XSS access to auth tokens
3. **CSRF double-submit** — Protection on all mutating requests
4. **4-tier rate limiting** — Prevents brute force and API abuse
5. **bcrypt password hashing** — 10 salt rounds
6. **Account lockout** — Failed login attempt tracking
7. **Input sanitization** — `sanitizeShortText`, `sanitizeText`, `sanitizeEmail`, `sanitizePhone`
8. **Zod validation** — Request body validation on all financial mutations
9. **PII/secret redaction** — Automatic log redaction for passwords, tokens, emails
10. **Organization isolation** — `verifyOrgAccess` on all org-scoped routes
11. **SUPER_ADMIN bypass** — Only for org access, not for destructive operations
12. **Structured error logging** — Stack trace, user context, route, request ID persisted to DB
13. **Helmet headers** — Basic HTTP security headers (CSP disabled for dev)
14. **Trust proxy** — Accurate IP detection behind Replit proxy
15. **Safe financial math** — `roundCurrency`, `safeDivide` utilities prevent floating-point errors
16. **Sensitive operation gating** — `sensitiveLimiter` on critical endpoints
17. **Global error handler** — Catches unhandled errors, persists to `error_logs`, returns sanitized message

### Areas of Note
- **CSP disabled** — `contentSecurityPolicy: false` in Helmet configuration
- **CORS open in dev** — Falls back to `localhost:5173` if no env vars set
- **Session-less JWT** — No server-side session store; relies on token versioning for revocation
- **File upload limit** — 10MB via multer; no additional virus/malware scanning
- **Password complexity** — Not enforced beyond bcrypt hashing (no min-length/complexity rules visible in auth)

---

## 16. Known Gaps & Non-Functional Systems

### CRITICAL

#### 1. Workflow Builder Database Tables Missing
- **Impact**: The No-Code Workflow Builder feature is entirely non-functional; any API call to `/api/workflows` will throw a database error
- **Details**: `migrations/0024_create_workflow_tables.sql` defines 5 tables (`workflow_templates`, `workflow_stages`, `workflow_approval_steps`, `workflow_notification_rules`, `workflow_instances`) plus 4 enum types (`workflow_entity_type`, `workflow_template_status`, `workflow_instance_status`, `workflow_notification_channel`). This migration was never applied to the database.
- **Feature gated**: `WORKFLOW_BUILDER` feature key exists in billing plans as a Scale-tier default
- **Routes registered**: `workflowRoutes` is mounted at `/api/workflows` in `server/routes.ts`
- **Fix**: Run `psql "$DATABASE_URL" -f migrations/0024_create_workflow_tables.sql` or add equivalent to `server/utils/runStartupMigrations.ts`

### HIGH

#### 2. LiveKit Video Calling — `LIVEKIT_API_SECRET` Missing
- **Impact**: Video call buttons disabled platform-wide; startup log reports `livekit: NOT configured`
- **Details**: Environment has `LIVEKIT_API_KEY` and `LIVEKIT_URL` configured, but `server/services/integrationStatusService.ts` requires all three: `LIVEKIT_API_KEY` AND `LIVEKIT_API_SECRET` AND `LIVEKIT_URL`. The secret `LIVEKIT_API_SECRET` is not in the available secrets list.
- **File**: `server/services/integrationStatusService.ts` lines 11–15
- **Behavior**: `getIntegrationStatus()` returns `livekit: false`, video call UI gracefully degrades (button disabled via integration gating)

#### 3. Apple Sign-In — Environment Variables Not Configured
- **Impact**: Apple OAuth login option non-functional
- **Details**: OAuth routes for Apple exist in `server/oauthRoutes.ts` but no Apple-related environment variables (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`) are configured
- **Behavior**: Apple sign-in button likely hidden or returns an error on click

#### 4. Social Platform `publishStub()` Fallback for Unsupported Platforms
- **Impact**: Any social platform not explicitly handled in the switch statement (all 7 are handled, but future platforms) falls through to `publishStub()` which marks the post as "published locally" without actually publishing
- **Details**: In `server/social/publishService.ts`, the `default` case in `publishToPlatform()` calls `publishStub(platform)` which returns `{ success: true, platformSupported: false }` and logs a console message. This means new platforms added to the enum but not to the switch will silently appear to succeed.
- **File**: `server/social/publishService.ts` lines 484–552
- **Current platforms handled**: Facebook, Instagram, LinkedIn, Twitter, TikTok, YouTube, Pinterest
- **Risk**: Silent false-positive publishing if new platforms are added without implementation

#### 5. Integration Sync Only Supported for QBO Provider
- **Impact**: The `/api/integrations/:connectionId/sync` endpoint only supports QuickBooks Online; all other providers return 400
- **Details**: In `server/integrationRoutes.ts`, the sync trigger route explicitly checks `if (connection.provider !== "qbo")` and returns `{ error: "Sync not yet supported for provider: ${connection.provider}" }`. The 9 other registered providers (Google, Microsoft, DocuSign, Zapier, Dropbox, GDrive, OneDrive, Box, STACK CT) cannot be synced via this endpoint.
- **File**: `server/integrationRoutes.ts` line 576
- **Impact**: Integration hub UI may show sync buttons for all providers, but only QBO sync operations actually execute

### MEDIUM

#### 6. 72 Remaining `console.error` Usages Across Server Code
- **Impact**: Production errors logged via `console.error` bypass the structured `logError()` system, meaning they are not persisted to the `error_logs` table and lack context (user ID, org ID, request ID, stack trace)
- **Details**: 72 instances of `console.error` remain across server `.ts` files. The platform has a dedicated `logError(message, context, error)` function and `persistErrorLog()` service, but these `console.error` calls predate or were missed during the production hardening pass.
- **Recommendation**: Replace all `console.error` with `logError()` calls for consistent structured error capture

#### 7. Email Send Endpoint Uses Resend Only — No Per-Account SMTP
- **Impact**: When users compose/send emails from the Email Assistant, messages are always sent via Resend API from the platform's default sender address, not from the user's own email address/account
- **Details**: `server/services/emailService.ts` uses `new Resend(process.env.RESEND_API_KEY)` with `DEFAULT_FROM_EMAIL = 'SmartManageAI <onboarding@resend.dev>'`. IMAP sync in `server/emailRoutes.ts` is receive-only (imports incoming mail). The email send endpoint does not route through the user's configured IMAP/SMTP account.
- **File**: `server/services/emailService.ts` lines 2–6, 73
- **User Impact**: Recipients see emails from `SmartManageAI` rather than the user's actual business email address

#### 8. Dual Migration System Complexity
- **Impact**: Risk of schema drift between Drizzle Kit and startup migrations; operational complexity for new developers
- **Details**: Three parallel migration systems coexist:
  - 48 SQL files in `/migrations/` (Drizzle Kit managed, applied via `npm run db:push`)
  - 32 SQL files in `/server/migrations/` (startup migrations via `runStartupMigrations()`, applied on every server start with idempotent `IF NOT EXISTS` guards)
  - 21 TypeScript `ensure*` scripts in `/server/utils/` (backfill/alter scripts)
- **Risk**: A table could be defined in the Drizzle schema (`shared/schema/`) but only created by a startup migration, or vice versa. The workflow builder gap (item #1) is a direct consequence.
- **File**: `server/utils/runStartupMigrations.ts`

#### 9. Multi-Page PDF Splitting — Incomplete
- **Impact**: Plan document upload with multi-page splitting shows notice-only in the UI
- **Details**: The takeoff workspace shows a notice that multi-page PDF splitting is a future feature; uploaded multi-page PDFs are stored as single files without page-level separation

#### 10. AI Schedulers Disabled in Development
- **Impact**: No automated AI analysis, no background jobs, no social post publishing, no compliance checks run in dev/staging
- **Details**: AI PM+CFO scheduler, AI notes scheduler, GCS orphan scan, and the entire job runner (16 cron jobs) only start when `NODE_ENV=production`. This is intentional but means dev/staging environments have no automated processing.
- **File**: `server/index.ts` lines 262–297
- **Workaround**: Manual "Run AI Analysis" button available in UI; social posts and sync schedules must be triggered manually

### LOW

#### 11. Social Platform API Keys Not Configured
- **Impact**: Social media publishing to Facebook, LinkedIn, and Twitter will fail with API errors
- **Details**: `FB_APP_ID`, `FB_APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` are all listed as missing secrets. Posts can be created and scheduled in the app, but actual API publishing requires these keys. Posts to these platforms will fail and retry up to 3 times before being marked as `FAILED`.
- **Behavior**: The social post publisher job catches failures and notifies post owners

#### 12. Twilio SMS — Not Configured
- **Impact**: SMS notification channel non-functional
- **Details**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` not in available secrets. The notification delivery framework supports SMS as a channel but delivery silently skips when Twilio is unconfigured.

#### 13. Microsoft 365 / DocuSign / Cloud Storage — Credentials Not Provided
- **Impact**: Outlook email sync, e-signature, and cloud file storage features non-functional for 6 of 10 registered providers
- **Details**: Code and provider registrations exist for Microsoft 365, DocuSign, Zapier, Dropbox, Google Drive, OneDrive, and Box. None have credentials configured. Integration connection attempts will fail.

#### 14. CSP Headers Disabled
- **Impact**: No Content-Security-Policy protection in HTTP responses
- **Details**: Helmet's `contentSecurityPolicy: false` in `server/index.ts` allows any inline scripts/styles and external resource loading. Common in development but should be enabled and configured for production deployment.

#### 15. Password Complexity Not Enforced
- **Impact**: Users can set weak passwords
- **Details**: No visible minimum length, uppercase/lowercase/digit/special character requirements in the auth registration or password change flows. bcrypt hashing (10 rounds) is strong against offline attacks, but weak passwords remain guessable via credential stuffing.

---

## Appendix A: Environment Variables

### Configured Secrets
| Secret | Used By |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `LIVEKIT_API_KEY` | LiveKit video (partial) |
| `LIVEKIT_URL` | LiveKit video (partial) |
| `METERED_API_KEY` | TURN/STUN servers |
| `QBO_CLIENT_ID` | QuickBooks Online |
| `QBO_CLIENT_SECRET` | QuickBooks Online |
| `RESEND_API_KEY` | Email delivery |

### Missing Secrets (May Be Needed)
| Secret | Feature |
|---|---|
| `FB_APP_ID` / `FB_APP_SECRET` | Facebook/Instagram publishing |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn publishing |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | Twitter/X publishing |
| `LIVEKIT_API_SECRET` | LiveKit video calling |
| `TWILIO_*` | SMS notifications |
| `APPLE_*` | Apple Sign-In |
| `DOCUSIGN_*` | E-signature |
| `MICROSOFT_*` | Microsoft 365 |

### Auto-Configured (via Replit Integrations)
- `DATABASE_URL` — PostgreSQL connection
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API
- Object Storage credentials — GCS backend

---

## Appendix B: File Structure Summary

```
├── client/src/
│   ├── pages/          (115 page components)
│   ├── components/     (447 component files)
│   ├── hooks/          (custom React hooks)
│   ├── lib/            (utilities, queryClient, apiRequest)
│   └── App.tsx         (route registration)
├── server/
│   ├── ai/             (19 AI modules)
│   ├── events/         (domain event bus + types)
│   ├── integrations/   (provider framework, outbox, webhooks)
│   ├── jobs/           (jobRunner with 16 cron jobs)
│   ├── migrations/     (32 startup SQL migrations)
│   ├── services/       (notification, error log, feature flags, integration status)
│   ├── social/         (social publishing to 7 platforms)
│   ├── utils/          (logger, helpers, ensure* scripts)
│   ├── auth.ts         (JWT auth, RBAC, feature permissions)
│   ├── routes.ts       (route registration hub - 128 route files)
│   ├── index.ts        (server entry point)
│   └── [*Routes.ts]    (individual route modules)
├── shared/
│   ├── schema/         (5 files, 12,707 lines, 413 tables)
│   ├── billing/        (plan tiers, add-ons, feature keys)
│   └── utils/          (shared utilities)
├── migrations/         (48 Drizzle Kit SQL migrations)
└── references/         (UI/UX guidelines)
```

---

## Appendix C: Complete Database Table Inventory (413 pgTable definitions)

  Extracted via: `grep "pgTable(" shared/schema/*.ts | grep -v "import " | sed 's/.*pgTable("\([^"]*\)".*/\1/' | sort -u`

  ```
  1. active_sessions
  2. activity_log
  3. addenda
  4. addendum_acknowledgments
  5. ai_action_audit
  6. ai_bid_document_analysis
  7. ai_co_drafts
  8. ai_contract_document_analysis
  9. ai_data_quality
 10. ai_gantt_recommendations
 11. ai_insights
 12. ai_note_insights
 13. ai_runs
 14. ai_settings
 15. ai_takeoff_analyses
 16. ai_tasks
 17. ai_vendor_comparisons
 18. announcement_dismissals
 19. annual_salary_categories
 20. approval_requests
 21. asset_handover_items
 22. asset_handover_signoffs
 23. attendance_logs
 24. audit_log
 25. bid_document_distributions
 26. bid_documents
 27. bid_equipment_selections
 28. bid_material_quotes
 29. bid_modifier_selections
 30. bid_request_clarifications
 31. bids
 32. bid_subcontractor_quotes
 33. billing_events
 34. bim_extractions
 35. bim_storey_associations
 36. budget_alerts
 37. budget_line_items
 38. burden_rates
 39. calendar_events
 40. change_order_approvals
 41. change_order_attachments
 42. change_order_comments
 43. change_order_equipment_entries
 44. change_order_labor_entries
 45. change_order_material_entries
 46. change_order_revisions
 47. change_orders
 48. change_order_scope_modifiers
 49. client_portal_access
 50. client_portal_activity
 51. company_daily_notes
 52. contract_approvals
 53. contract_clauses
 54. contract_redlines
 55. contract_risk_analyses
 56. contracts
 57. contract_templates
 58. contract_versions
 59. conversation_participants
 60. conversations
 61. cost_ledger_postings
 62. cost_transactions
 63. crew_marketplace
 64. crew_members
 65. crew_project_assignments
 66. crews
 67. crm_contacts
 68. crm_opportunities
 69. crm_opportunity_activities
 70. crm_organisation_notes
 71. crm_organisations
 72. custom_libraries
 73. daily_report_locks
 74. daily_scope_progress
 75. data_processing_records
 76. data_subject_requests
 77. delay_claims
 78. delay_notifications
 79. document_revisions
 80. document_transmittals
 81. domain_events
 82. drawing_set_items
 83. drawing_sets
 84. email_accounts
 85. email_attachments
 86. email_campaign_contacts
 87. email_campaigns
 88. email_campaign_templates
 89. email_messages
 90. email_summaries
 91. email_tasks
 92. email_threads
 93. email_verification_tokens
 94. employee_classifications
 95. employee_cost_assignments
 96. employee_deductions
 97. employee_performance_profiles
 98. employee_ratings
 99. equipment
100. equipment_assignments
101. equipment_fuel_logs
102. equipment_hour_logs
103. equipment_hour_reminders
104. equipment_listings
105. equipment_maintenance_history
106. equipment_maintenance_schedules
107. equipment_rate_profiles
108. equipment_rental_requests
109. equipment_repairs
110. error_logs
111. estimate_crews
112. estimate_history
113. estimate_line_items
114. estimate_line_item_subcontractors
115. estimates
116. estimate_settings
117. estimate_vendor_quotes
118. estimate_versions
119. executive_digests
120. file_permissions
121. forecast_adjustments
122. global_workflow_templates
123. handoff_packets
124. hiring_activity_logs
125. hiring_ai_reviews
126. hiring_candidate_documents
127. hiring_candidate_notes
128. hiring_candidates
129. hiring_candidate_stage_history
130. hiring_integrations
131. hiring_interviews
132. hiring_jobs
133. hiring_job_templates
134. hiring_pipeline_configs
135. hiring_pipeline_stages
136. hiring_sync_logs
137. hiring_tasks
138. historical_costs
139. hustler_delegates
140. hustler_link_requests
141. hustler_organizations
142. integration_connections
143. integration_events_outbox
144. integration_sync_state
145. integration_webhook_subscriptions
146. invoice_matches
147. invoice_payments
148. issue_captures
149. job_classifications
150. jobsite_analysis_batches
151. jobsite_analysis_photos
152. kpi_assignments
153. kpi_entries
154. kpi_templates
155. leave_requests
156. leave_types
157. library_assemblies
158. library_assembly_item_group_members
159. library_assembly_item_groups
160. library_assembly_items
161. library_items
162. lidar_annotations
163. lidar_comparisons
164. lidar_scans
165. lien_waivers
166. maintenance_logs
167. maintenance_recurring_schedules
168. marketplace_reviews
169. master_calculators
170. master_inspection_forms
171. master_modifier_categories
172. master_modifiers
173. master_sow_items
174. material_calculator_presets
175. material_price_index
176. material_tests
177. media
178. message_entity_links
179. message_reactions
180. message_read_receipts
181. messages
182. method_statements
183. mobile_devices
184. mobile_pending_uploads
185. mobile_sync_log
186. mobilization_checklist_items
187. mobilization_checklists
188. modifiers
189. notification_channel_prefs
190. notifications
191. notification_type_prefs
192. object_acl_policies
193. offline_sync_queue
194. organization_addons
195. organization_calculators
196. organization_documents
197. organization_network_settings
198. organization_payroll_settings
199. organizations
200. organization_social_links
201. organization_sow_items
202. organization_subscriptions
203. organization_usage
204. organization_website_pages
205. organization_websites
206. organization_work_types
207. org_color_palettes
208. org_cost_codes
209. osha_incidents
210. overhead_cost_history
211. overhead_cost_items
212. overtime_requests
213. overtime_rules
214. page_preview_links
215. page_versions
216. passkey_credentials
217. password_reset_tokens
218. pay_applications
219. payroll_deduction_types
220. payroll_notifications
221. pay_run_line_items
222. pay_runs
223. pay_stub_deductions
224. peer_ratings
225. performance_reviews
226. permission_presets
227. photo_custody_records
228. plan_documents
229. platform_announcements
230. po_receipt_items
231. po_receipts
232. portal_activity_log
233. portal_chat_messages
234. portal_chat_threads
235. ppe_compliance_logs
236. prevailing_wage_rates
237. pricebook_import_jobs
238. procurement_items
239. project_cost_codes
240. project_delays
241. project_employee_rates
242. project_equipment_plans
243. project_health_snapshots
244. project_inspections
245. project_labor_rates
246. project_locations
247. project_material_budgets
248. project_material_usage
249. project_note_blocks
250. project_note_pages
251. project_notes
252. project_permits
253. project_plans
254. project_profitability_snapshots
255. project_reports
256. project_risks
257. projects
258. project_schedules
259. project_schedule_tasks
260. project_specs
261. punch_list_items
262. purchase_order_items
263. purchase_orders
264. purchase_request_items
265. purchase_requests
266. push_subscriptions
267. qbo_account_mappings
268. qbo_sync_schedules
269. quality_issues
270. quantity_categories
271. rating_criteria
272. rating_scores
273. receipts
274. rental_equipment_catalog
275. rental_equipment_usages
276. rental_vendors
277. retention_policies
278. retention_releases
279. revenue_recognition
280. reward_assignments
281. reward_types
282. rfi_activity
283. rfi_attachments
284. rfis
285. safety_checklist_instances
286. safety_checklist_templates
287. safety_incidents
288. safety_training_assignments
289. safety_trainings
290. saved_scale_templates
291. saved_takeoffs
292. schedule_forecast_snapshots
293. schedule_of_values
294. scope_items
295. scope_modifier_categories
296. scope_modifier_rules
297. scope_modifiers
298. scope_work_type_categories
299. scope_work_types
300. signature_requests
301. skills
302. skill_verification_requests
303. social_accounts
304. social_media_posts
305. social_post_analytics
306. social_post_history
307. sov_line_items
308. sov_payments
309. sov_revision_history
310. sow_audit_log
311. sso_configurations
312. stored_materials
313. subcontract_attachments
314. subcontractor_bid_invitations
315. subcontractor_bid_requests
316. subcontractor_bid_responses
317. subcontractor_billing_schedule
318. subcontractor_contracts
319. subcontractor_payments
320. subcontractor_portal_tokens
321. subcontractors
322. subcontract_sov_line_items
323. submittal_activity
324. submittal_attachments
325. submittal_items
326. submittal_reviews
327. submittals
328. sub_pay_applications
329. sub_pay_app_line_items
330. sub_performance_scores
331. sub_retention_releases
332. subscription_events
333. supervisor_notes
334. takeoff_assemblies
335. takeoff_assembly_items
336. takeoff_conditions
337. takeoff_issue_comments
338. takeoff_issues
339. takeoff_markups
340. takeoff_measurement_assemblies
341. takeoff_measurement_groups
342. takeoff_measurements
343. takeoff_sheet_links
344. takeoff_sheets
345. takeoff_versions
346. talent_profiles
347. task_attachments
348. task_comments
349. tasks
350. task_subtasks
351. time_clock_events
352. time_clock_shifts
353. time_entries
354. tm_daily_sheets
355. tm_invoices
356. tm_ticket_equipment_entries
357. tm_ticket_labor_entries
358. tm_ticket_material_entries
359. tm_tickets
360. tm_ticket_scope_modifiers
361. toolbox_talk_attendance
362. toolbox_talk_scheduled
363. toolbox_talk_topics
364. trade_features
365. trade_templates
366. transmittal_recipients
367. units_of_measure
368. upload_intents
369. user_api_keys
370. user_certifications
371. user_color_palettes
372. user_dashboard_layouts
373. user_dashboard_permissions
374. user_equipment_competencies
375. user_photos
376. users
377. user_sessions
378. user_settings
379. user_skills
380. user_totp_secrets
381. vendor_enrollments
382. vendor_invoice_items
383. vendor_invoices
384. vendor_pricebook_items
385. vendor_pricebooks
386. vendor_price_history
387. vendor_pricing_catalogs
388. vendor_scores
389. vendor_service_catalog
390. vendor_users
391. video_call_notes
392. video_call_participants
393. video_calls
394. voice_logs
395. warranty_cases
396. warranty_documents
397. warranty_tasks
398. website_analytics_daily
399. website_analytics_events
400. website_blog_comments
401. website_blog_posts
402. website_contact_submissions
403. website_deployments
404. website_project_images
405. website_projects
406. weekly_payroll_reports
407. worker_logs
408. workflow_approval_steps
409. workflow_instances
410. workflow_notification_rules
411. workflow_stages
412. workflow_templates
413. zapier_webhooks
  ```

  Note: Tables 408–412 (workflow_*) are defined in the Drizzle schema but their database migration (`migrations/0024_create_workflow_tables.sql`) has NOT been applied. These tables do not exist in the running database. See Known Gap #1.

  ---

  ## Appendix D: Complete Route File Inventory (128 files)

```
  1. server/addendaRoutes.ts
  2. server/aiaBillingRoutes.ts
  3. server/aiCfoAnalyticsRoutes.ts
  4. server/aiDocumentRoutes.ts
  5. server/aiOnboardingRoutes.ts
  6. server/aiOrchestrationRoutes.ts
  7. server/aiSchedulingRoutes.ts
  8. server/aiTakeoffFeatureRoutes.ts
  9. server/approvalRoutes.ts
 10. server/assemblyRoutes.ts
 11. server/assetManagementRoutes.ts
 12. server/auditBillingStorageRoutes.ts
 13. server/auditExportRoutes.ts
 14. server/authProfileRoutes.ts
 15. server/bidNetworkRoutes.ts
 16. server/bidRoutes2.ts
 17. server/billingRoutes.ts
 18. server/bimRoutes.ts
 19. server/calculatorRoutes.ts
 20. server/changeOrderApprovalRoutes.ts
 21. server/changeOrderCrudRoutes.ts
 22. server/changeOrderExportRoutes.ts
 23. server/clauseLibraryRoutes.ts
 24. server/clientChatRoutes.ts
 25. server/clientPortalRoutes.ts
 26. server/contractRoutes.ts
 27. server/costEngineRoutes.ts
 28. server/costLedgerRoutes.ts
 29. server/crewRoutes2.ts
 30. server/crmRoutes.ts
 31. server/dashboardRoutes.ts
 32. server/delayRoutes.ts
 33. server/documentRevisionRoutes.ts
 34. server/drawingSetRoutes.ts
 35. server/emailCampaignRoutes.ts
 36. server/emailRoutes.ts
 37. server/equipmentRoutes.ts
 38. server/estimateRoutes.ts
 39. server/executiveDigestRoutes.ts
 40. server/featureFlagRoutes.ts
 41. server/fieldProductivityRoutes.ts
 42. server/hiringRoutes.ts
 43. server/hustlerRoutes.ts
 44. server/inspectionRoutes.ts
 45. server/integrationRoutes.ts
 46. server/kpiRoutes.ts
 47. server/laborRateRoutes.ts
 48. server/leaveRoutes.ts
 49. server/libraryRoutes.ts
 50. server/lidarRoutes.ts
 51. server/locationRoutes.ts
 52. server/marketingPdfRoute.ts
 53. server/marketplaceRoutes.ts
 54. server/materialTestRoutes.ts
 55. server/materialTrackingRoutes.ts
 56. server/messagingRoutes.ts
 57. server/mobileSyncRoutes.ts
 58. server/mobilizationRoutes.ts
 59. server/modifierRoutes.ts
 60. server/notesRoutes.ts
 61. server/notificationPreferencesRoutes.ts
 62. server/notificationRoutes2.ts
 63. server/oauthRoutes.ts
 64. server/onboardingLibraryRoutes.ts
 65. server/opsRoutes.ts
 66. server/organizationDocumentRoutes.ts
 67. server/overheadRoutes.ts
 68. server/overtimeRoutes.ts
 69. server/passkeyRoutes.ts
 70. server/payrollRoutes.ts
 71. server/peerRatingRoutes.ts
 72. server/performanceRoutes.ts
 73. server/permitRoutes.ts
 74. server/platformBillingRoutes.ts
 75. server/platformRoutes.ts
 76. server/portalRoutes.ts
 77. server/ppeComplianceRoutes.ts
 78. server/privacyRoutes.ts
 79. server/procurementModuleRoutes.ts
 80. server/productionRateRoutes.ts
 81. server/profitabilityAlertRoutes.ts
 82. server/projectContentRoutes.ts
 83. server/projectCrudRoutes.ts
 84. server/projectFinancialRoutes.ts
 85. server/projectNotePagesRoutes.ts
 86. server/projectOpsRoutes.ts
 87. server/projectReportRoutes.ts
 88. server/punchListRoutes.ts
 89. server/pushSubscriptionRoutes.ts
 90. server/reportRoutes.ts
 91. server/retentionRoutes.ts
 92. server/revenueRecognitionRoutes.ts
 93. server/rfiRoutes.ts
 94. server/riskRoutes.ts
 95. server/routes.ts
 96. server/safetyTrainingRoutes.ts
 97. server/safetyWorkflowRoutes.ts
 98. server/scheduleRoutes.ts
 99. server/scopeRoutes.ts
100. server/skillRoutes.ts
101. server/socialRoutes.ts
102. server/sovRoutes.ts
103. server/ssoRoutes.ts
104. server/subChatRoutes.ts
105. server/subcontractManagementRoutes.ts
106. server/subcontractorPayablesRoutes.ts
107. server/subcontractRoutes.ts
108. server/submittalRoutes.ts
109. server/takeoffCategoryRoutes.ts
110. server/takeoffCrossModuleRoutes.ts
111. server/takeoffIssueRoutes.ts
112. server/takeoffMeasurementRoutes.ts
113. server/takeoffSheetRoutes.ts
114. server/talentPoolRoutes.ts
115. server/taskRoutes.ts
116. server/timeClockRoutes.ts
117. server/timeEntryRoutes.ts
118. server/tmRoutes.ts
119. server/transmittalRoutes.ts
120. server/unifiedPortalRoutes.ts
121. server/userSettingsRoutes.ts
122. server/vendorRoutes.ts
123. server/warrantyRoutes.ts
124. server/weatherRoutes.ts
125. server/websiteAiRoutes.ts
126. server/websiteRoutes.ts
127. server/workflowRoutes.ts
128. server/workforceRoutes.ts
```

---

## Appendix E: Complete Frontend Page Inventory (115 pages)

```
  1. accept-hustler-invite.tsx          2. ai-bid-analysis.tsx
  3. ai-contract-analysis.tsx           4. ai-document-analysis.tsx
  5. ai-governance.tsx                  6. ai-pm-dashboard.tsx
  7. ai-settings.tsx                    8. approvals.tsx
  9. audit-logs.tsx                    10. bid-detail.tsx
 11. bid-estimate.tsx                  12. bid-inbox.tsx
 13. bid-network-detail.tsx            14. bid-network.tsx
 15. bids.tsx                          16. bid-wizard.tsx
 17. billing.tsx                       18. calculator.tsx
 19. calendar.tsx                      20. cfo-dashboard.tsx
 21. clause-library.tsx                22. client-portal-public.tsx
 23. company-communications.tsx        24. company-health.tsx
 25. company-settings.tsx              26. contracts.tsx
 27. cost-codes.tsx                    28. cost-rates.tsx
 29. crew-marketplace.tsx              30. crews.tsx
 31. crm.tsx                           32. daily-report-locks.tsx
 33. dashboard.tsx                     34. dispatch-board.tsx
 35. email-assistant.tsx               36. email-campaigns.tsx
 37. enterprise-settings.tsx           38. equipment-detail.tsx
 39. equipment-rental-marketplace.tsx  40. equipment.tsx
 41. executive-digest.tsx              42. forgot-password.tsx
 43. historical-costs.tsx              44. hustler-benchmarking.tsx
 45. hustler-dashboard.tsx             46. hustler-org-detail.tsx
 47. hustler-unified-inbox.tsx         48. impersonate.tsx
 49. integrations.tsx                  50. issue-captures.tsx
 51. kpi-management.tsx                52. landing.tsx
 53. leave-management.tsx              54. lidar-scans.tsx
 55. login.tsx                         56. manage-workers.tsx
 57. marketplace.tsx                   58. material-price-index.tsx
 59. messages.tsx                      60. mobile-sync.tsx
 61. my-kpis.tsx                       62. not-found.tsx
 63. offline-sync.tsx                  64. onboarding.tsx
 65. overhead-costs.tsx                66. overtime-rules.tsx
 67. payroll-management.tsx            68. permits.tsx
 69. PlatformAdminDashboard.tsx        70. PlatformAnalyticsMonitoring.tsx
 71. PlatformOrganizationDetail.tsx    72. PlatformOrganizations.tsx
 73. PlatformTools.tsx                 74. portal-chat.tsx
 75. pricebook-import.tsx              76. procurement-module.tsx
 77. production-rates.tsx              78. profile.tsx
 79. progress-billing.tsx              80. project-detail.tsx
 81. projects.tsx                      82. public-website.tsx
 83. register.tsx                      84. rental-vendors.tsx
 85. reports.tsx                       86. reset-password.tsx
 87. rfq-response.tsx                  88. safety-training.tsx
 89. scope-settings.tsx                90. settings.tsx
 91. shared-preview.tsx                92. social-media.tsx
 93. subcontractor-payables.tsx        94. subcontracts.tsx
 95. sub-portal.tsx                    96. talent-pool.tsx
 97. tasks.tsx                         98. time-clock-manager.tsx
 99. time-clock.tsx                   100. time-entry.tsx
101. time-log-tab.tsx                 102. tm-billing.tsx
103. tm-daily.tsx                     104. unified-messages.tsx
105. unified-portal.tsx               106. users.tsx
107. vendor-pricing.tsx               108. vendor-scores.tsx
109. view-as-organization.tsx         110. voice-logs.tsx
111. website-builder.tsx              112. what-if-simulator.tsx
113. wip-report.tsx                   114. worker-detail.tsx
115. workflow-builder.tsx
```

---

## Appendix F: Complete Component File Inventory (447 files)

  Extracted via: `find client/src/components -name "*.tsx" -o -name "*.ts" | sort`

  ```
  1. ActualMaterialsInput.tsx
  2. AIAnalysisButton.tsx
  3. AIAssistantWidget.tsx
  4. AIBidAnalysisPanel.tsx
  5. AiChangeOrderGenerator.tsx
  6. AIContractAnalysisPanel.tsx
  7. AIDashboardPanel.tsx
  8. ai-document/DocumentAnalysisPage.tsx
  9. AIFeatureDialog.tsx
 10. AIInsights.tsx
 11. AIInsightsWidget.tsx
 12. AiJobsiteAnalysis.tsx
 13. AiSchedulingPanel.tsx
 14. AISowAssistantDialog.tsx
 15. AiTakeoffPanel.tsx
 16. AIUomAssistantDialog.tsx
 17. AnnouncementBanner.tsx
 18. AppHeader.tsx
 19. AppSidebar.tsx
 20. AskQuestionsContent.tsx
 21. AssemblyPanel.tsx
 22. AssetHandoverTab.tsx
 23. bid/BidDetailDialogs.tsx
 24. bid/BidEquipmentStep.tsx
 25. bid/BidLevelingSection.tsx
 26. bid/BidLibrarySection.tsx
 27. bid/BidMaterialsStep.tsx
 28. bid/BidPlansStep.tsx
 29. bid/BidPlansTab.tsx
 30. bid/BidScopeStep.tsx
 31. bid/BidSubcontractorsStep.tsx
 32. bid/BidSummaryStep.tsx
 33. bid/BimViewer.tsx
 34. BidCard.tsx
 35. bid/CostBuilderSidebar.tsx
 36. BidDocumentDistribution.tsx
 37. bim/BimDiffDialog.tsx
 38. bim/BimQuantityDialog.tsx
 39. branding-color-picker.tsx
 40. calculators/AggregatesCalculator.tsx
 41. calculators/DrywallCalculator.tsx
 42. calculators/GeometryCalculator.tsx
 43. calculators/LaborCostEstimator.tsx
 44. calculators/LumberCalculator.tsx
 45. calculators/MarkupCalculator.tsx
 46. calculators/MasonryCalculator.tsx
 47. calculators/MaterialEstimatorCalculator.tsx
 48. calculators/PaintCalculator.tsx
 49. calculators/ProfitMarginCalculator.tsx
 50. calculators/RoofingCalculator.tsx
 51. calculators/TilingCalculator.tsx
 52. calculators/UnitConverter.tsx
 53. cfo/CostForecastingSection.tsx
 54. cfo/EquipmentMetrics.tsx
 55. cfo/FinancialKPICards.tsx
 56. cfo/ProjectProfitabilityTable.tsx
 57. cfo/types.ts
 58. ChangeOrderDialog.tsx
 59. ChangeOrderFiles.tsx
 60. ChangeOrderFileUploader.tsx
 61. client-portal/PortalActivityFeed.tsx
 62. client-portal/PortalChangeOrdersTab.tsx
 63. client-portal/PortalChatTab.tsx
 64. client-portal/PortalDashboardCards.tsx
 65. client-portal/PortalDocumentsTab.tsx
 66. client-portal/PortalLoginForm.tsx
 67. client-portal/PortalPaymentsTab.tsx
 68. client-portal/PortalPhotosTab.tsx
 69. client-portal/PortalProgressTab.tsx
 70. client-portal/PortalProjectInfo.tsx
 71. client-portal/PortalScheduleTab.tsx
 72. ClientPortal.tsx
 73. CostCodeCombobox.tsx
 74. cost-rates/BurdenMultipliersTab.tsx
 75. cost-rates/ClassificationsTab.tsx
 76. cost-rates/EmployeeRatesTab.tsx
 77. cost-rates/PrevailingWageTab.tsx
 78. crm/CrmContactDialogs.tsx
 79. crm/CrmOrgDetail.tsx
 80. crm/CrmOrgDialogs.tsx
 81. crm/CrmPipelineView.tsx
 82. CrmOrganizationSelector.tsx
 83. DailyNoteFeed.tsx
 84. DashboardEditMode.tsx
 85. DashboardGrid.tsx
 86. DashboardSection.tsx
 87. dashboard-widgets/ActiveBidsWidget.tsx
 88. dashboard-widgets/ActiveProjectsWidget.tsx
 89. dashboard-widgets/AITasksWidget.tsx
 90. dashboard-widgets/AlertsWidget.tsx
 91. dashboard-widgets/BidPipelineWidget.tsx
 92. dashboard-widgets/CalendarWidget.tsx
 93. dashboard-widgets/CashPositionWidget.tsx
 94. dashboard-widgets/ChangeOrdersPendingSettings.tsx
 95. dashboard-widgets/ChangeOrdersPendingWidget.tsx
 96. dashboard-widgets/CostCodeBreakdownSettings.tsx
 97. dashboard-widgets/CostCodeBreakdownWidget.tsx
 98. dashboard-widgets/CrewOverviewWidget.tsx
 99. dashboard-widgets/DisplayLimitSettings.tsx
100. dashboard-widgets/KPISummarySettings.tsx
101. dashboard-widgets/KPISummaryWidget.tsx
102. dashboard-widgets/LaborUtilizationSettings.tsx
103. dashboard-widgets/LaborUtilizationWidget.tsx
104. dashboard-widgets/ListWidgetSettings.tsx
105. dashboard-widgets/ListWidget.tsx
106. dashboard-widgets/MessagesWidget.tsx
107. dashboard-widgets/NotificationsWidget.tsx
108. dashboard-widgets/OutstandingItemsWidget.tsx
109. dashboard-widgets/ProjectAssignmentsWidget.tsx
110. dashboard-widgets/ProjectHealthSummarySettings.tsx
111. dashboard-widgets/ProjectHealthSummaryWidget.tsx
112. dashboard-widgets/QuickActionsWidget.tsx
113. dashboard-widgets/QuickStatsSettings.tsx
114. dashboard-widgets/QuickStatsWidget.tsx
115. dashboard-widgets/RFIStatusSettings.tsx
116. dashboard-widgets/RFIStatusWidget.tsx
117. dashboard-widgets/SafetyAlertsSettings.tsx
118. dashboard-widgets/SafetyAlertsWidget.tsx
119. dashboard-widgets/ScheduleImpactWidget.tsx
120. dashboard-widgets/SOVProgressWidget.tsx
121. dashboard-widgets/TrendChartSettings.tsx
122. dashboard-widgets/TrendChartWidget.tsx
123. dashboard-widgets/WidgetRegistry.tsx
124. dashboard-widgets/WorkforceSnapshotWidget.tsx
125. delay-claims/DelayClaimDialogs.tsx
126. delay-claims/DelayClaimTable.tsx
127. delay-claims/types.ts
128. DelaysSection.tsx
129. DocumentAttachments.tsx
130. document-control/RfiCreateFields.tsx
131. document-control/RfiDetailDialog.tsx
132. document-control/SubmittalDetailDialog.tsx
133. document-control/TransmittalDetailDialog.tsx
134. DocumentRevisionPanel.tsx
135. DrawingSetsPanel.tsx
136. email/EmailAccountsDialog.tsx
137. email/EmailThreadDetail.tsx
138. email/EmailThreadList.tsx
139. email/shared.tsx
140. equipment/EquipmentDialogs.tsx
141. equipment/EquipmentTabs.tsx
142. EquipmentRateSelector.tsx
143. estimate/AssemblyInsertDialog.tsx
144. estimate/EstimateRevisionHistory.tsx
145. estimate/EstimateSummaryCards.tsx
146. estimate/LineItemForm.tsx
147. estimate/LineItemsTable.tsx
148. estimate/MarkupCalculator.tsx
149. ExpiringPermitsBanner.tsx
150. FeatureGate.tsx
151. FileUploadZone.tsx
152. FirstTimeWelcomeModal.tsx
153. GlobalIncomingCallModal.tsx
154. HealthScoreBadge.tsx
155. HierarchicalLineItemBuilder.tsx
156. ImpersonationBanner.tsx
157. InspectionsSection.tsx
158. integrations/IntegrationProviderCard.tsx
159. integrations/IntegrationSyncPanel.tsx
160. integrations/QboMappingPanel.tsx
161. integrations/StackCTSyncPanel.tsx
162. integrations/types.ts
163. integrations/WebhookConfigPanel.tsx
164. JobInformationForm.tsx
165. KPICard.tsx
166. LaborRateSelector.tsx
167. LibraryAssemblyDialog.tsx
168. LibraryItemDialog.tsx
169. LibraryPanel.tsx
170. lidar/PointCloudViewer.tsx
171. LoginForm.tsx
172. MaintenanceLogsTab.tsx
173. ManualMaterialPricing.tsx
174. MaterialBudgetTracker.tsx
175. MaterialCalculator.tsx
176. MaterialTestingSection.tsx
177. MediaGallery.tsx
178. media-library.tsx
179. messaging/AllCallNotes.tsx
180. messaging/AttachmentRenderer.tsx
181. messaging/CallHistory.tsx
182. messaging/CallNotesPanel.tsx
183. messaging/EntityDiscussion.tsx
184. messaging/EntityLinkPicker.tsx
185. messaging/IncomingCallBanner.tsx
186. messaging/MentionAutocomplete.tsx
187. messaging/MessageBubble.tsx
188. messaging/MessageComposer.tsx
189. messaging/MessageList.tsx
190. messaging/OngoingCallBanner.tsx
191. messaging/SidebarSection.tsx
192. messaging/Sidebar.tsx
193. messaging/types.ts
194. messaging/VideoCallOverlay.tsx
195. messaging/VoicePlayer.tsx
196. MessagingWidget.tsx
197. MobileSyncStatus.tsx
198. ModifierSelector.tsx
199. ObjectUploader.tsx
200. OfflineStatusBanner.tsx
201. OrganizationSwitcher.tsx
202. page-editor/PageEditorCanvas.tsx
203. page-editor/PageEditorDialogs.tsx
204. page-editor/PageEditorSidebar.tsx
205. page-editor/PageEditorToolbar.tsx
206. page-editor.tsx
207. page-editor/types.ts
208. payables/PayableApprovalDialogs.tsx
209. payables/PayablesKPICards.tsx
210. payables/PayablesTable.tsx
211. payables/types.ts
212. payroll/CertifiedPayrollReport.tsx
213. payroll/DeductionsTab.tsx
214. payroll/PayStubView.tsx
215. PdfPreview.tsx
216. PerformanceHistoryTab.tsx
217. PermitsTab.tsx
218. PlanSelectionStep.tsx
219. platform/SubscriptionAddonsPanel.tsx
220. platform/SubscriptionOrgList.tsx
221. platform/SubscriptionPlanCards.tsx
222. platform/SupportAuditPanel.tsx
223. platform/SupportOrgTools.tsx
224. platform/SupportSystemChecks.tsx
225. platform/SupportUserLookup.tsx
226. PpeComplianceSection.tsx
227. production-rates/BenchmarksTab.tsx
228. production-rates/CostAnalyticsTab.tsx
229. production-rates/ProductionRateDetail.tsx
230. production-rates/types.ts
231. ProjectAddenda.tsx
232. ProjectCard.tsx
233. ProjectEstimate.tsx
234. ProjectHealthWidget.tsx
235. ProjectLaborHours.tsx
236. ProjectRFIs.tsx
237. ProjectsTable.tsx
238. ProjectSubmittals.tsx
239. project-tabs/BillingTab.tsx
240. project-tabs/BudgetTab.tsx
241. project-tabs/ChangeOrdersTab.tsx
242. project-tabs/ContractsTab.tsx
243. project-tabs/CostExplorerTab.tsx
244. project-tabs/CostLedgerTab.tsx
245. project-tabs/FieldTakeoffTab.tsx
246. project-tabs/FinancialsTab.tsx
247. project-tabs/LaborTab.tsx
248. project-tabs/LidarTab.tsx
249. project-tabs/LocationManagerTab.tsx
250. project-tabs/MediaTab.tsx
251. project-tabs/MobilizationTab.tsx
252. project-tabs/OverviewTab.tsx
253. project-tabs/PlansTab.tsx
254. project-tabs/ProcurementTab.tsx
255. project-tabs/ProductionRatesTab.tsx
256. project-tabs/ProfitabilityTab.tsx
257. project-tabs/ProjectEmailTab.tsx
258. project-tabs/ProjectEquipmentTab.tsx
259. project-tabs/ProjectNotesTab.tsx
260. project-tabs/ProjectPayrollTab.tsx
261. project-tabs/ProjectReportsTab.tsx
262. project-tabs/ProjectVaultTab.tsx
263. project-tabs/ReceiptsTab.tsx
264. project-tabs/RevenueWipTab.tsx
265. project-tabs/RisksTab.tsx
266. project-tabs/SafetyTrainingTab.tsx
267. project-tabs/SovTab.tsx
268. project-tabs/SubcontractorsTab.tsx
269. project-tabs/TimeTab.tsx
270. ProjectTransmittals.tsx
271. PunchListTab.tsx
272. PushNotificationBanner.tsx
273. RegisterForm.tsx
274. reports/CostReports.tsx
275. reports/EstimateReports.tsx
276. reports/ReportExportBar.tsx
277. reports/report-utils.tsx
278. reports/TakeoffReports.tsx
279. RevisionCompareDialog.tsx
280. SafetyOfficerAssignment.tsx
281. ScopeItemProgressRow.tsx
282. ScopeOfWorkTable.tsx
283. ScopeProgressTracker.tsx
284. settings/CompanyBrandingTab.tsx
285. settings/CompanyNotificationsTab.tsx
286. settings/CompanyProfileTab.tsx
287. settings/CompanyTradeConfigTab.tsx
288. settings/CompanyUserInviteTab.tsx
289. settings/LeaveTypesSettings.tsx
290. settings/NotificationPrefsSection.tsx
291. settings/PasskeySection.tsx
292. settings/PasswordChangeSection.tsx
293. settings/ProfileEditSection.tsx
294. settings/SkillsSection.tsx
295. settings/types.ts
296. SkillsCertificationsTab.tsx
297. social-media/SocialAccountsPanel.tsx
298. social-media/SocialAiContentGenerator.tsx
299. social-media/SocialCalendarView.tsx
300. social-media/SocialPlatformPreview.tsx
301. social-media/SocialPostCard.tsx
302. social-media/SocialPostEditor.tsx
303. social-media/SocialPostMediaSection.tsx
304. social-media/SocialPostScheduleSection.tsx
305. social-media/SocialStatsPanel.tsx
306. social-media/types.tsx
307. sov/SovCoTieoutPanel.tsx
308. sov/SovLienWaiverPanel.tsx
309. sov/SovLineItemsEditor.tsx
310. sov/SovPaymentsPanel.tsx
311. sov/SovSummaryCards.tsx
312. sov/types.ts
313. StandardizedScopeSelector.tsx
314. StatusBadge.tsx
315. SubcontractorPortalManager.tsx
316. SubcontractorScopeReport.tsx
317. subcontracts/ContractDetailView.tsx
318. subcontracts/DocumentsTab.tsx
319. subcontracts/PerformanceSummaryTab.tsx
320. subcontracts/PerformanceTab.tsx
321. subcontracts/RetentionDashboardTab.tsx
322. subcontracts/RetentionTab.tsx
323. subcontracts/RevisionHistoryTab.tsx
324. subcontracts/SubcontractScopeTab.tsx
325. subcontracts/SubPayApplicationsTab.tsx
326. sub-portal/SubPortalChatTab.tsx
327. sub-portal/SubPortalHeader.tsx
328. sub-portal/SubPortalRfiTab.tsx
329. sub-portal/SubPortalSubmittalTab.tsx
330. sub-portal/SubPortalTransmittalTab.tsx
331. sub-portal/sub-portal-utils.tsx
332. takeoff/FormulaEditor.tsx
333. takeoff/IssueDetailPanel.tsx
334. takeoff/IssuesTab.tsx
335. takeoff/LiveCostPanel.tsx
336. takeoff/MeasurementTable.tsx
337. takeoff/PageThumbnailStrip.tsx
338. takeoff/PlanScaleModal.tsx
339. takeoff/TakeoffCrossModulePanel.tsx
340. takeoff/TakeoffDialogs.tsx
341. takeoff/TakeoffPropertiesPanel.tsx
342. takeoff/TakeoffSheetCompareDialog.tsx
343. takeoff/TakeoffSidebar.tsx
344. takeoff/TakeoffToolbar.tsx
345. takeoff/TakeoffVersionHistory.tsx
346. takeoff/types.ts
347. TakeoffWorkspace.tsx
348. TaskDetailModal.tsx
349. text-style-editor.tsx
350. ThemePicker.tsx
351. ThemeToggle.tsx
352. TimeEntryContent.tsx
353. TimeEntryForm.tsx
354. time-entry/TimeEntryAddForm.tsx
355. time-entry/TimeEntryDialogs.tsx
356. time-entry/TimeEntryListContent.tsx
357. time-entry/TimeEntryStatsCards.tsx
358. time-entry/TimeEntryWeeklySummary.tsx
359. TMDailyForm.tsx
360. tm/SignaturePad.tsx
361. TMTicketsSection.tsx
362. tm/TMEquipmentTab.tsx
363. tm/TMLaborTab.tsx
364. tm/TMMaterialTab.tsx
365. tm/TMTicketDetail.tsx
366. tm/TMTicketDialog.tsx
367. TopHeader.tsx
368. TourProvider.tsx
369. ui/accordion.tsx
370. ui/alert-dialog.tsx
371. ui/alert.tsx
372. ui/aspect-ratio.tsx
373. ui/avatar.tsx
374. ui/badge.tsx
375. ui/breadcrumb.tsx
376. ui/button.tsx
377. ui/calendar.tsx
378. ui/card.tsx
379. ui/carousel.tsx
380. ui/chart.tsx
381. ui/checkbox.tsx
382. ui/collapsible.tsx
383. ui/command.tsx
384. ui/context-menu.tsx
385. ui/date-picker.tsx
386. ui/date-time-picker.tsx
387. ui/dialog.tsx
388. ui/drawer.tsx
389. ui/dropdown-menu.tsx
390. ui/form.tsx
391. ui/hover-card.tsx
392. ui/input-otp.tsx
393. ui/input.tsx
394. ui/label.tsx
395. ui/menubar.tsx
396. ui/navigation-menu.tsx
397. ui/pagination.tsx
398. ui/popover.tsx
399. ui/progress.tsx
400. ui/radio-group.tsx
401. ui/resizable.tsx
402. ui/scroll-area.tsx
403. ui/select.tsx
404. ui/separator.tsx
405. ui/sheet.tsx
406. ui/sidebar.tsx
407. ui/skeleton.tsx
408. ui/slider.tsx
409. ui/switch.tsx
410. ui/table.tsx
411. ui/tabs.tsx
412. ui/textarea.tsx
413. ui/toaster.tsx
414. ui/toast.tsx
415. ui/toggle-group.tsx
416. ui/toggle.tsx
417. ui/tooltip.tsx
418. UomSelect.tsx
419. UploadSourcePicker.tsx
420. VendorPricebookUpload.tsx
421. VendorPricingSync.tsx
422. VoiceDictation.tsx
423. WarrantyTab.tsx
424. WeatherEvidenceCard.tsx
425. WeatherForecastWidget.tsx
426. website-blocks/ContentBlocks.tsx
427. website-blocks/HeroBlocks.tsx
428. website-blocks/InteractionBlocks.tsx
429. website-blocks/MediaBlocks.tsx
430. website-blocks/shared.tsx
431. website-blocks/SocialProofBlocks.tsx
432. website-blocks/types.ts
433. website-body-components.tsx
434. website-builder/types.ts
435. website-builder/WebsiteBlogTab.tsx
436. website-builder/WebsiteGalleryTab.tsx
437. website-builder/WebsitePagesTab.tsx
438. website-builder/WebsitePublishingTab.tsx
439. website-builder/WebsiteSetupTab.tsx
440. website-components-tab.tsx
441. website-preview-renderer.tsx
442. WidgetLibrary.tsx
443. WidgetSettingsDialog.tsx
444. worker/types.tsx
445. worker/WorkerDialogs.tsx
446. worker/WorkerTabs.tsx
447. workflow-tracker.tsx
  ```

  ---

  ## Appendix G: Complete Environment Variable Inventory (80 variables)

### SET (Configured in Environment)
| Variable | Source |
|---|---|
| `DATABASE_URL` | Replit PostgreSQL integration |
| `GOOGLE_CLIENT_ID` | User secret |
| `GOOGLE_CLIENT_SECRET` | User secret |
| `LIVEKIT_API_KEY` | User secret |
| `LIVEKIT_URL` | User secret |
| `METERED_API_KEY` | User secret |
| `QBO_CLIENT_ID` | User secret |
| `QBO_CLIENT_SECRET` | User secret |
| `RESEND_API_KEY` | User secret |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Replit OpenAI integration |
| `SESSION_SECRET` | Auto-generated (required for startup) |
| `PORT` | Replit environment |
| `NODE_ENV` | Replit environment |
| `REPLIT_DEV_DOMAIN` | Replit environment |
| `REPLIT_DOMAINS` | Replit environment |
| `REPL_OWNER` | Replit environment |
| `REPL_SLUG` | Replit environment |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Replit Object Storage integration |

### NOT SET (Referenced in Code but Missing)
| Variable | Feature Affected |
|---|---|
| `LIVEKIT_API_SECRET` | LiveKit video calling (blocks integration status) |
| `FB_APP_ID` | Facebook/Instagram social publishing |
| `FB_APP_SECRET` | Facebook/Instagram social publishing |
| `LINKEDIN_CLIENT_ID` | LinkedIn social publishing |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn social publishing |
| `TWITTER_CLIENT_ID` | Twitter/X social publishing |
| `TWITTER_CLIENT_SECRET` | Twitter/X social publishing |
| `TIKTOK_CLIENT_ID` | TikTok social publishing |
| `TIKTOK_CLIENT_SECRET` | TikTok social publishing |
| `YOUTUBE_CLIENT_ID` | YouTube social publishing |
| `YOUTUBE_CLIENT_SECRET` | YouTube social publishing |
| `PINTEREST_APP_ID` | Pinterest social publishing |
| `PINTEREST_APP_SECRET` | Pinterest social publishing |
| `APPLE_CLIENT_ID` | Apple Sign-In |
| `APPLE_TEAM_ID` | Apple Sign-In |
| `APPLE_KEY_ID` | Apple Sign-In |
| `APPLE_PRIVATE_KEY` | Apple Sign-In |
| `MICROSOFT_CLIENT_ID` | Microsoft 365 integration |
| `MICROSOFT_CLIENT_SECRET` | Microsoft 365 integration |
| `MICROSOFT_TENANT_ID` | Microsoft 365 integration |
| `MICROSOFT_REDIRECT_URI` | Microsoft 365 integration |
| `DOCUSIGN_CLIENT_ID` | DocuSign e-signature |
| `DOCUSIGN_CLIENT_SECRET` | DocuSign e-signature |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign e-signature |
| `DOCUSIGN_BASE_URL` | DocuSign e-signature |
| `DROPBOX_CLIENT_ID` | Dropbox cloud storage |
| `DROPBOX_CLIENT_SECRET` | Dropbox cloud storage |
| `GDRIVE_CLIENT_ID` | Google Drive cloud storage |
| `GDRIVE_CLIENT_SECRET` | Google Drive cloud storage |
| `ONEDRIVE_CLIENT_ID` | OneDrive cloud storage |
| `ONEDRIVE_CLIENT_SECRET` | OneDrive cloud storage |
| `BOX_CLIENT_ID` | Box cloud storage |
| `BOX_CLIENT_SECRET` | Box cloud storage |
| `TWILIO_ACCOUNT_SID` | SMS notifications |
| `TWILIO_AUTH_TOKEN` | SMS notifications |
| `TWILIO_FROM_NUMBER` | SMS notifications |
| `VAPID_PUBLIC_KEY` | Web push notifications |
| `VAPID_PRIVATE_KEY` | Web push notifications |
| `VAPID_SUBJECT` | Web push notifications |
| `ENCRYPTION_KEY` | General encryption |
| `INTEGRATION_ENCRYPTION_KEY` | Integration token encryption |
| `SENTRY_DSN` | Error monitoring (Sentry) |
| `OPS_STATUS_TOKEN` | Ops health check authentication |
| `WEBAUTHN_RP_ID` | WebAuthn/Passkey relying party |
| `WEBAUTHN_ORIGIN` | WebAuthn/Passkey origin |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback |
| `BILLING_MODE` | Billing mode configuration |
| `EMAIL_FROM_ADDRESS` | Custom email sender address |
| `ENABLE_DEV_SEED` | Dev seed data toggle |
| `FRONTEND_URL` | Frontend URL override |
| `APP_BASE_URL` | Application base URL |
| `APP_URL` | Application URL |
| `QBO_ENVIRONMENT` | QuickBooks sandbox/production |
| `DEBUG_LINE_ITEMS` | Debug logging for line items |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Custom OpenAI API base URL |
| `OPENAI_API_KEY` | Fallback OpenAI key |
| `JWT_SECRET` | Alternative JWT secret reference |
| `PRIVATE_OBJECT_DIR` | Private object storage directory |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public object storage paths |
| `REPLIT_OBJECT_STORAGE_PRIVATE_DIR` | Replit private storage dir |
| `REPLIT_DEPLOYED_URL` | Deployed URL (set in production) |
| `REPLIT_DEPLOYMENT` | Deployment indicator |
| `npm_package_version` | Package version (auto-set) |

---

*End of Audit — April 12, 2026*
