# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to centralize and streamline the entire construction project lifecycle. It aims to enhance efficiency, ensure compliance, and provide comprehensive oversight through AI-driven features, dynamic navigation, trade-specific dashboards, and a full suite of tools for project management, estimating, CRM, compliance, and workforce management. The platform seeks to deliver a robust, scalable solution that improves project outcomes and operational efficiency within the construction industry.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack within a multi-tenant architecture, prioritizing security, scalability, and user experience.

**Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript.
*   **Database**: PostgreSQL with Drizzle ORM.
*   **Authentication**: JWT-based (httpOnly cookies), bcrypt, RBAC, OAuth (Google, Apple), CSRF protection, and Passkey (WebAuthn).

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: AI-driven onboarding and dynamic features for specific trade types, with trade-aware feature presets.
*   **AI Integration**: AI for generation, analysis, scheduling, and automation across modules, governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows including Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking, Contract Management, and CPM Scheduling.
*   **Estimating Engine**: Advanced takeoff workspace with interactive drawing tools, material calculation, hierarchical line item builder, 6-step bid workflow, real-time multi-user collaboration, and full takeoff versioning. Includes auto-generation of draft PCOs from takeoff deltas.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline.
*   **Workforce Management**: Native time-clock (GPS/geofence), shift management with cost code tracking, labor hour tracking, Manager Approval Workflow, configurable overtime rules engine, KPI dashboards, Certified Payroll Reports, Crew Dispatch Board, Leave Management, and Peer Coworker Ratings.
*   **Compliance & Audit**: Audit logging, document management (versioning, expiration), Approval Workflows Framework, Addenda Tracking, Permits & Licenses Tracking, PPE Compliance Tracker, QC Material Testing Log.
*   **Financial Management**: Budget vs Actual Cost Engine, CFO Cost Forecasting Dashboard, Live Project Profitability Tracking, Revenue Recognition & WIP Reporting, AIA Progress Billing, Procurement Module with 3-Way Match, and Unified Payment & Invoice Tracking.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, unified AI chat, and Notion-style project notes.
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Website Builder System**: White-label website management with AI Website Wizard, page builder, publishing controls, and DNS verification.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **Integration Gating**: Feature flags gate unconfigured third-party services, providing graceful degradation.
*   **Structured Error Logging**: Captures production errors with stack trace, user context, route, and request ID.
*   **Consolidated Startup Migrations**: Idempotent schema migration checks managed by a single runner with automatic schema drift detection.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher and job registry.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Account Settings Hub**: Unified settings page with URL-based sidebar routing.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer.
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags and role-based defaults for 8 consolidated roles.
*   **BIM & LiDAR Integration**: Client-side IFC file parsing for quantity extraction, 3D BIM Viewer, and LiDAR Scanner Module for point cloud analysis.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, and AI-powered risk suggestions.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **Performance & Security Patterns**: Includes 4-tier rate limiting, opt-in pagination, N+1 query prevention, DB health check monitoring, Zod validation on all POST/PATCH/PUT routes via shared `validateBody` helper (`server/utils/validation.ts`), safe financial math utilities, password complexity policy, PATCH route immutable-field stripping, DB pool sized for concurrency (max 60), 8s TTL auth-middleware user cache (`authUserCache` in `server/auth.ts` with auto-eviction and `invalidateAuthCache` on token revocation), size-capped org-scoped cache (max 5000 entries with periodic cleanup in `server/cache.ts`), parallelized dashboard COUNT queries via `Promise.all`, and SQL-side `SUM`/`GROUP BY` for procurement aggregation.
*   **Dashboard Widget Permission Guards**: All dashboard widgets gate their API calls with `enabled` permission checks (`useFeaturePermission` or role-based) to prevent unauthorized fetches. Pattern: `enabled: hasPermission` in `useQuery`.
*   **Email Marketing Campaigns**: Full email campaign lifecycle with template management, contact lists, bulk sending, scheduling, and analytics.
*   **Takeoff Sidebar Collapse**: Right sidebar in `TakeoffWorkspace` is collapsible to a 36px icon strip via a toggle button (state persisted in localStorage key `takeoff-sidebar-collapsed`), reclaiming ~300px of canvas width. Expanded widths reduced to 280/300/320 (`sm`/`md`/`lg`).
*   **Server-Side Gantt PDF Export**: Schedules with >100 tasks or >365-day duration auto-export via headless Chromium (Playwright) on the server. New `POST /api/projects/:code/schedule/export-pdf` (in `server/scheduleRoutes.ts`) launches a cached browser via `server/gantt-pdf-service.ts`, navigates to the new print-only route `/print/projects/:code/schedule` (`client/src/pages/SchedulePrintPage.tsx`) with the user's `auth_token` cookie injected on the browser context, waits for `window.__GANTT_READY`, and prints to A3-landscape PDF with native CSS pagination (`page-break-inside: avoid` per row). Print page honors `?theme=light|dark` and `?baseline=0|1`. Client export logic in `AiSchedulingPanel.tsx` falls back to the in-browser `html2canvas`/`jspdf` path if the server renderer returns 503 (e.g. Chromium unavailable). Browser executable resolved via `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
*   **Takeoff Floating Panels**: The AI Takeoff panel, Cross-Module panel, and expanded TakeoffSidebar render as absolute-positioned overlays (`absolute top-0 right-0 h-full ... z-30 shadow-2xl`) inside `workspaceRef` so the canvas retains full width regardless of open panels. Overlays dim to `opacity-20` when `isDrawing` is active on desktop.
*   **Takeoff Canvas Chrome**: Quick sheet switcher (horizontal chip strip with prev/next arrows, `top-2 left-2`) appears when `sheets.length > 1`. Floating status bar (`bottom-2 left-2`) shows zoom %, active tool, calibration state, and Snap/Ortho/Grid indicators. Persisted takeoff preferences: `takeoff-hide-ai-measurements`, `takeoff-show-ai-overlays`, `takeoff-show-structural-gridlines`, `takeoff-snap-enabled`, `takeoff-ortho-lock`.
*   **Empty States & Mobile Polish**: Reusable `EmptyState` component (`client/src/components/EmptyState.tsx`) with icon, title, description, optional CTA button, and testId prop. Applied across Projects, Bids, CRM, Procurement, Permits, Crews, Users/Team, Contracts, Equipment, Tasks, Leave Management, Approvals, Email Campaigns, and project tabs (Change Orders, RFIs, Submittals, Subcontractors). All `DialogContent` components use `sm:max-w-*` for mobile-first full-screen dialogs (`< sm`) and centered on desktop. CRM tabs are horizontally scrollable on mobile.
*   **Heavy Civil Document Versioning**: Surety bonds, material certifications, haul tickets, and daily inspector reports now carry FK references into `plan_documents` (`document_id`, `ticket_photo_document_id`, `photo_document_ids[]`, `attachment_document_ids[]`). Uploads route through the new `HeavyCivilDocumentField`/`HeavyCivilDocumentList` components (`client/src/components/dot/HeavyCivilDocumentField.tsx`) which create a `plan_documents` parent + initial `document_revisions` entry on first upload, and append a new revision on Replace. Legacy URL columns are retained for back-compat (and as fallback for surety bonds without a project). Startup migration `ensureHeavyCivilDocumentColumns` adds the FK columns and backfills project-scoped legacy URLs into the versioning system. Out of scope: CRM org certifications (`crm_organisation_certifications`) — needs `plan_documents.projectId` to become nullable first.
*   **CRM Sales Enhancements (Web-to-Lead, Quotes, Tasks, Auto-Assignment)**: 4 new tables (`crm_quotes`, `crm_quote_line_items`, `crm_tasks`, `crm_assignment_rules`) created via `ensureCrmEnhancementTables.ts`. Backend: `crmTasksRoutes.ts` (CRUD + summary/mine + auto-`completedAt`), `crmQuotesRoutes.ts` with `quote-pdf-service.ts` PDFKit-based branded PDF generator (`GET /api/crm/quotes/:id/pdf`) and per-org `Q{year}-{0001}` numbering, `crmAssignmentRulesRoutes.ts` + `utils/crmAssignmentEngine.ts` (USER + ROUND_ROBIN with persistent `lastAssignedIndex`), `publicLeadsRoutes.ts` (`POST /api/public/leads/:orgSlug` — honeypot + rate-limited, resolves org by slug, creates LEAD opportunity, runs assignment engine). Auto-assignment hook in `POST /api/crm/opportunities` triggers when no `assignedToId` is provided. Hourly `crmTaskReminderScheduler` cron sends notifications for tasks due tomorrow + overdue (one-shot via `reminderSentAt`). CSRF middleware exempts `/api/public/*`. Frontend: new "Tasks" + "Quotes" tabs on `/crm` (`CrmTasksView` and `CrmQuotesView` in `client/src/components/crm/`), new `/crm-settings` page with Web-to-Lead embed snippet + Auto-Assignment rules manager, public `/leads/:orgSlug` form (honeypot field, embed mode via `?embed=1`, exempt from queryClient login redirect).
*   **Safety & Compliance Hub**: Unified `/safety` page (`client/src/pages/SafetyHubPage.tsx`) with tabs: Dashboard (TRIR/DART/LTIR + leading indicators), Observations (positive & at-risk capture, photos, severity, auto-corrective-action), OSHA Logs (300/300A summary + 300A PDF download), and Modules (links to existing safety-training, compliance/COIs, SWPPP, daily inspector reports, material certs). New `safety_observations` table + `server/safetyObservationsRoutes.ts` (`/api/safety/observations`), KPI endpoint `/api/safety/kpi/dashboard` in `server/safetyKpiRoutes.ts` aggregating recordables, observations, toolbox talks, inspections, training, PPE, and COI expirations. HIGH/CRITICAL at-risk observations on a project auto-create a punch-list corrective action.
*   **Heavy Civil & Nationwide DOT Coverage**: Foundation schema for FHWA + all 50 state DOTs + DC/PR/USVI/Guam + 9 toll/port authorities. Global `dot_agencies`, `dot_spec_books`, `dot_pay_items` reference data (no orgId) seeded from `server/data/dot/agencies.json` + `server/data/dot/sample-pay-items.json` (FHWA FP-14 + ODOT C&MS 2023). Org-scoped overrides via `dot_pay_item_overrides`; per-org agency preferences via `organization_dot_preferences`. Heavy-civil entities: `project_dbe_goals`, `crm_organisation_certifications` (DBE/MBE/WBE/SBE/VOSB/SDVOSB/HUBZONE/8a/ACDBE), `surety_bonds` (Bid/Performance/Payment/Maintenance), `haul_tickets` (with planned-vs-actual reconciliation SQL endpoint), `daily_inspector_reports` (one-per-project-per-day unique constraint), `swppp_inspections`, `material_certifications` (Buy America). `estimate_line_items` and `sov_line_items` carry new `dot_pay_item_id`, `pay_item_number`, `spec_section`, `dot_spec_book_id` columns so DOT pay items flow from bid → SOV → progress estimate. CRM organisations carry `primary_certification_type/expiration/summary` quick-reference. New `HEAVY_CIVIL_PRESET` and 9 new feature flags (`DOT_PAY_ITEMS`, `DBE_TRACKING`, `WH_347_PAYROLL`, `HAUL_TICKETS`, `DAILY_INSPECTOR_REPORTS`, `SWPPP_INSPECTIONS`, `SURETY_BONDS`, `BUY_AMERICA`, `MASS_HAUL_ANALYZER`) — all disabled by default. UI: `client/src/pages/DotLibraryPage.tsx` (`/dot-library`) with agency browser + spec book counts; `client/src/components/dot/PayItemPicker.tsx` reusable agency/spec-book/search dialog. Routes registered in `server/dotRoutes.ts`. Pay item bulk upload (CSV/AASHTOWare format) is SUPER_ADMIN only.

## External Dependencies
*   PostgreSQL (Neon)
*   Replit Object Storage (Google Cloud Storage backend)
*   OpenAI via Replit AI Integrations (gpt-5.2 default, no API key required — billed to Replit credits)
*   Resend
*   JWT
*   Bcrypt
*   Uppy
*   node-cron
*   react-konva, konva, pdfjs-dist, xlsx
*   three, web-ifc, laz-perf
*   Recharts
*   react-grid-layout
*   QuickBooks Online
*   STACK CT (Construction Technologies)
*   Google Workspace (Gmail, Calendar)
*   Microsoft 365 (Mail, Calendar)
*   DocuSign
*   @node-saml/node-saml