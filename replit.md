# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to manage the entire construction project lifecycle for various trades. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform offers AI-driven features, dynamic navigation, trade-specific dashboards, and comprehensive tools for project management, estimating, CRM, compliance, and workforce management. Its purpose is to provide a robust, scalable solution that improves project outcomes and operational efficiency across the construction industry.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack with a multi-tenant architecture, prioritizing security, scalability, and user experience.

**Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript.
*   **Database**: PostgreSQL on Neon, managed with Drizzle ORM.
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) supporting 18 user roles, and OAuth social login (Google, Apple) with CSRF protection and email verification.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to trade type.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking.
*   **Estimating Engine**: Includes interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder.
*   **CRM System**: Manages various organizational entities with vendor pricing and rental equipment catalogs.
*   **Workforce Management**: Features a native time-clock with GPS, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, and KPI dashboards.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Unified SOW Tracking System**: Ensures consistent linking of scope of work items across the project lifecycle.
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, and **Staging Preview Links** (token-protected URLs for sharing draft previews before publishing).
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, and GDPR compliance tooling, managed by feature flags and a 4-tier subscription model.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, including expanded QuickBooks Online integration.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, source tracking, and UI for history and comparison.
*   **Addenda Tracking System**: Full addenda lifecycle management per project.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Takeoff Enhancements**: Sheet management, visual revision comparison, and addenda overlays in TakeoffWorkspace with advanced calibration tools. **Plans & Takeoff 3-Panel UI**: PlansTab redesigned with left sidebar (document tree with folder groups + search), center canvas (TakeoffWorkspace), collapsible left panel. **New Measurement Types**: LINEAR_WITH_DROP (horizontal+vertical), PITCHED_LINEAR (pitch-adjusted linear), PITCHED_AREA (pitch-adjusted area), SURFACE_AREA (3D surface). Pitch ratio selector (1:12–16:12), drop distance input. **Per-Measurement Cost Linking**: `costCodeId`, `unitCost`, `computedSurfaceAreaFt2`, `pitchRatio` columns on `takeoff_measurements`. Measurement Properties panel with cost code/unit cost inputs and estimated total display. `updateMeasurementMutation` for PATCH updates. Undo/redo via `use-takeoff-history.ts` hook with Ctrl+Z/Y keyboard shortcuts. **Sheet Folder Organization**: `folderGroup` column on `takeoff_sheets` (default "Plans"), groups: Plans/Supporting Documents, drag/drop between groups, context menus (rename, duplicate, move to, delete) in PlansTab left sidebar.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support with a service worker.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets (Trend Chart, Data List, Alerts, Workforce Snapshot, Cash Position, SOV Progress, Bid Pipeline, Cost Code Breakdown, Schedule Impact), and role-based default layouts.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Custom KPI Management System**: Org-level custom KPI definitions, assignment to employees with targets, and performance tracking over time.
*   **QuickBooks Online Integration (Expanded)**: Full-featured QBO sync with 8 operations, OAuth 2.0 connection flow, Cost Code to QBO Account Mapping, and Automatic Sync Scheduling.

*   **Contractor Onboarding Library**: Hard-coded normalized reference data system at `server/data/onboarding/` powering the AI onboarding flow:
    *   **5 Core Pillars**: `trades.json` (230 trades, 17 categories), `scopes.json` (2,946 scopes), `materials.json` (126 material families, 17 groups), `formulas.json` (39 formulas), `line_item_grammar.json` (naming rules, UOM codes, qualifier rules)
    *   **3 Extension Files**: `trade_components.json` (982 components across 229 trades), `variant_expansions.json` (113 variants across 19 component families), `calibration_rates.json` (15 calibration rate stubs)
    *   **TypeScript Module**: `server/data/onboarding/index.ts` — typed accessors with Map-based O(1) lookups, `validateLibraryIntegrity()` for runtime assertions
    *   **AI Integration**: Feeds `tradeDiscoveryService.ts` (230-trade taxonomy for trade matching), `scopePredictionEngine.ts` (supplements DB scopes with library's 2,946 scopes), `buildOnboardingSystemPrompt()` (extended taxonomy + 126 material families in prompt)
    *   **Trade Mapping**: `shared/tradeTypeUtils.ts` exports `EXTENDED_TRADE_REGISTRY` (maps 110+ library trade_ids to 22 legacy TradeType values), `mapOnboardingTradeIdToLegacy()`, `normalizeToOnboardingTradeId()`, `getLibraryTradeIdsForLegacy()` (reverse mapping: legacy trade type → library trade_ids)
    *   **Unified Trade System**: The library is the **single source of truth** for trade presentation (names, categories, sub-categories). The DB enum (22 legacy types) is the **storage layer**. UI dropdowns in scope-settings and company-settings use library trades grouped by `trade_category`; selections are auto-mapped to legacy enum via `mapOnboardingTradeIdToLegacy()`. Display formatting uses `getTradeDisplayName()` (from `shared/tradeTypeUtils.ts`) instead of ad-hoc string replacement. The old hardcoded `TRADE_SUBCATEGORIES` in scope-settings is supplemented by dynamic library scope categories (library is primary, `TRADE_SUBCATEGORIES` kept as fallback for unmapped trades).
    *   **API Endpoints**: `server/onboardingLibraryRoutes.ts` — `GET /api/onboarding-library/trades`, `/trades/:tradeId/scopes`, `/trades/:tradeId/components`, `/materials`, `/formulas`, `/grammar`, `/calibration/:scopeId`, `/integrity`, `/for-org` (org-filtered library data)
    *   **GC Logic**: `general_contractor_gc` has 0 scopes by design; `getScopesByTradeId('general_contractor_gc')` returns ALL 2,946 scopes
    *   **Frontend Access**: `client/src/hooks/use-library-data.ts` — `useLibraryData()` hook provides org-trade-filtered library data (trades, scopes, components, materials) via TanStack Query; `useLibraryScopes(searchTerm?)` for filtered scope access with real-time search
    *   **Scope Library Browser**: `client/src/pages/scope-library.tsx` at route `/scope-library` — searchable catalog page with Scopes/Components/Materials tabs, filtered by org trade type, accessible to ADMIN/MANAGER/ESTIMATOR
    *   **Select From Library Flow**: Scope Settings page (`/scope-settings`) "Add Work Type" button upgraded to dropdown with "Add Manually" (existing) and "Select From Library" (new multi-select modal with search, review/edit step, and batch creation)
    *   **Extending**: Add trades to `trades.json`, scopes to `scopes.json` (update `EXPECTED_*` counts in `index.ts`); add calibration rates by scope_id; all cross-references validated at load time

*   **Social Media Management System**: Comprehensive social content management with scheduling, AI generation, and multi-platform support.
    *   **Database Tables**: `social_accounts` (connected platform accounts with encrypted tokens), `social_media_posts` (managed posts with full lifecycle), `social_post_analytics` (per-post metrics)
    *   **Enums**: `socialPostStatusEnum` (DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → QUEUED → POSTED / FAILED), `socialAccountStatusEnum` (CONNECTED, DISCONNECTED, EXPIRED, ERROR)
    *   **Platforms**: FACEBOOK, INSTAGRAM, LINKEDIN, TWITTER, TIKTOK, YOUTUBE, PINTEREST
    *   **Backend API**: `server/socialMediaRoutes.ts` mounted at `/api/social` — full CRUD for accounts (encrypted AES-256-CBC token storage) and posts, calendar view, stats dashboard, AI content generation, approval workflow, bulk operations, duplicate, reschedule
    *   **Background Worker**: `server/jobs/jobRunner.ts` — 2-minute cron job processes scheduled posts (marks as POSTED at scheduled time), handles recurring post creation (daily/weekly/monthly), retry logic with 3-attempt max
    *   **Frontend**: `client/src/pages/social-media.tsx` at route `/social-media` — 4 views: Dashboard (stats + connected accounts + recent posts), List (filterable/searchable post cards), Calendar (monthly view with post dots), Accounts (connect/disconnect platforms)
    *   **Create/Edit Dialog**: Platform selector, content textarea with platform-specific character limits, AI content generator (topic → GPT-4o), hashtag management, scheduling with recurring options, campaign tags, tone selector, UTM parameters
    *   **Access**: ADMIN, MANAGER roles via RBAC; sidebar nav entry after Website Builder
    *   **Phase 2 (future)**: Direct OAuth callbacks per platform, auto-posting via platform APIs, analytics pull, comment management, content recycling

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4 / GPT-4o**: Powers AI functionalities.
*   **Resend**: Transactional email service.
*   **JWT**: For secure authentication and authorization.
*   **Bcrypt**: For password hashing.
*   **Uppy**: For enhanced file uploads.
*   **node-cron**: For scheduling backend tasks.
*   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing, PDF rendering, and document processing.
*   **Recharts**: For data visualization charts.
*   **react-grid-layout**: For dashboard editor layout.
*   **QuickBooks Online**: For accounting integrations.
*   **Google Workspace (Gmail, Calendar)**: For email and calendar integrations.
*   **Microsoft 365 (Mail, Calendar)**: For email and calendar integrations.
*   **DocuSign**: For e-signature workflows.
*   **@node-saml/node-saml**: For SAML 2.0 Service Provider.