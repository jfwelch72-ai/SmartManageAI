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

The platform is built on a React + Express + PostgreSQL stack with Drizzle ORM, deployed on Replit. As of this audit date, the codebase contains **357,000+ lines of code**, **417 database tables**, **127 route files**, **115 frontend pages**, and **19 AI modules**. The system is operational in development mode with all core features functional. Production-only features (AI schedulers, background jobs) are gated behind `NODE_ENV=production`.

---

## 2. Codebase Statistics

| Metric | Count |
|---|---|
| Total Lines of Code | ~357,454 |
| Database Tables (pgTable definitions) | 417 |
| Schema Files (shared/schema/) | 5 files, 12,707 lines |
| Backend Route Files | 127 |
| Frontend Pages (client/src/pages/) | 115 |
| Frontend Components (client/src/components/) | 157 directories/files |
| AI Modules (server/ai/) | 19 |
| Background Cron Jobs | 16 |
| Domain Event Types | 33 |
| Feature Permission Flags | 73 |
| Billing Feature Keys | 44 |
| Add-On Keys | 9 |
| Startup Migration Scripts (server/migrations/) | 32 |
| Drizzle Kit Migrations (migrations/) | 49 |
| TypeScript ensure* Scripts (server/utils/) | 21 |

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

### Route File Inventory (127 files)

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

### Configured Integration Providers

| Provider | Status | Capabilities |
|---|---|---|
| **QuickBooks Online** | Active | Chart of accounts import, customer export, subcontractor payment export, PO export, payment reconciliation. Scheduled sync support. |
| **STACK CT** | Active | Construction technology data sync |
| **Google Workspace** | Configured (OAuth) | Gmail (email sync), Calendar integration. Google Sign-In for auth. |
| **Microsoft 365** | Code exists | Outlook email sync, Calendar. Requires credentials. |
| **DocuSign** | Code exists | E-signature for contracts. Requires credentials. |
| **LiveKit** | Partially configured | Video calling. See Known Gaps — `LIVEKIT_API_SECRET` missing. |
| **Resend** | Active | Transactional email delivery |
| **OpenAI** | Active (via integration) | GPT-4/4o for all AI features |

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

#### 1. Workflow Builder Tables Missing
- **Impact**: The No-Code Workflow Builder feature is non-functional
- **Details**: `migrations/0024_create_workflow_tables.sql` exists but was never applied. The tables `workflow_definitions`, `workflow_instances`, `workflow_transitions`, `workflow_action_logs` do not exist in the database.
- **Feature gated**: `WORKFLOW_BUILDER` feature key exists in billing plans (Scale tier default)
- **Routes registered**: `workflowRoutes` is mounted at `/api/workflows`
- **Fix**: Apply migration `0024` or add tables to startup migrations

### HIGH

#### 2. LiveKit Video Calling — Partially Configured
- **Impact**: Video call buttons may be disabled; integration reports "NOT configured"
- **Details**: Environment has `LIVEKIT_API_KEY` and `LIVEKIT_URL` but `integrationStatusService.ts` requires all three: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL`. The secret `LIVEKIT_API_SECRET` is not in the available secrets list.
- **Behavior**: Integration status shows `livekit: NOT configured`, video call UI gracefully degrades (button disabled)

#### 3. Apple Sign-In — Not Configured
- **Impact**: Apple OAuth login option non-functional
- **Details**: OAuth routes for Apple exist but no Apple-related environment variables (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`) are configured
- **Behavior**: Apple sign-in button likely hidden or produces an error

#### 4. Social Platform API Keys — Not Configured
- **Impact**: Social media publishing to external platforms will fail
- **Details**: Facebook (`FB_APP_ID`, `FB_APP_SECRET`), LinkedIn (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`), Twitter (`TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`) are all listed as missing secrets
- **Behavior**: Posts can be created/scheduled in-app, but actual publishing requires API keys. Local-only publishing fallback exists.

### MEDIUM

#### 5. Dual Migration System Complexity
- **Impact**: Risk of schema drift between Drizzle Kit and startup migrations
- **Details**: Three parallel migration systems:
  - 49 SQL files in `/migrations/` (Drizzle Kit managed)
  - 32 SQL files in `/server/migrations/` (startup migrations via `runStartupMigrations`)
  - 21 TypeScript `ensure*` scripts in `/server/utils/`
- **Risk**: A table could be defined in schema but not created by the correct migration path

#### 6. Multi-Page PDF Splitting — Incomplete
- **Impact**: Plan document upload with multi-page splitting shows notice-only
- **Details**: The UI shows a notice that multi-page PDF splitting is a future feature; documents are stored as single files

#### 7. IMAP Email — Send-Only via Resend
- **Impact**: Email composition sends via Resend; IMAP sync is receive-only
- **Details**: The IMAP sync job fetches emails from configured accounts but outgoing email always goes through Resend API, not via the user's actual SMTP server

#### 8. AI Schedulers Disabled in Development
- **Impact**: No automated AI analysis in dev/staging
- **Details**: AI PM+CFO scheduler, AI notes scheduler, GCS orphan scan, and job runner only start when `NODE_ENV=production`
- **Workaround**: Manual "Run AI Analysis" button available in UI

### LOW

#### 9. Twilio SMS — Not Configured
- **Impact**: SMS notification channel non-functional
- **Details**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` not in available secrets
- **Behavior**: Notification framework supports SMS channel but delivery silently skips

#### 10. Microsoft 365 / DocuSign — Credentials Not Provided
- **Impact**: Outlook email sync and e-signature features non-functional
- **Details**: Code exists for both integrations but no credentials configured
- **Behavior**: Integration connections will fail to establish

#### 11. CSP Headers Disabled
- **Impact**: No Content-Security-Policy protection
- **Details**: Helmet's `contentSecurityPolicy: false` allows any inline scripts/styles and external resource loading
- **Note**: Common in development; should be enabled and configured for production

#### 12. Password Complexity Not Enforced
- **Impact**: Users can set weak passwords
- **Details**: No visible minimum length, uppercase/lowercase/digit/special character requirements in the auth flow
- **Note**: bcrypt hashing is strong, but weak passwords remain guessable

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
│   ├── components/     (157 component directories)
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
│   ├── routes.ts       (route registration hub - 127 route files)
│   ├── index.ts        (server entry point)
│   └── [*Routes.ts]    (individual route modules)
├── shared/
│   ├── schema/         (5 files, 12,707 lines, 417 tables)
│   ├── billing/        (plan tiers, add-ons, feature keys)
│   └── utils/          (shared utilities)
├── migrations/         (49 Drizzle Kit SQL migrations)
└── references/         (UI/UX guidelines)
```

---

*End of Audit — April 12, 2026*
