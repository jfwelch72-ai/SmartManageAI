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
*   **Authentication**: JWT-based, bcrypt, RBAC, OAuth (Google, Apple), CSRF protection, and Passkey (WebAuthn).

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: AI-driven onboarding and dynamic features for specific trade types.
*   **AI Integration**: AI for generation, analysis, scheduling, and automation across modules, governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows including Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking, Contract Management, and CPM Scheduling.
*   **Estimating Engine**: Advanced takeoff workspace with interactive drawing tools, material calculation, 6-step bid workflow, real-time multi-user collaboration, and full takeoff versioning.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline.
*   **Workforce Management**: Native time-clock (GPS/geofence), shift management with cost code tracking, Manager Approval Workflow, configurable overtime rules engine, KPI dashboards, and Certified Payroll Reports.
*   **Compliance & Audit**: Audit logging, document management, Approval Workflows Framework, Addenda Tracking, Permits & Licenses Tracking, PPE Compliance Tracker, QC Material Testing Log, and Safety & Compliance Hub.
*   **Financial Management**: Budget vs Actual Cost Engine, CFO Cost Forecasting Dashboard, Live Project Profitability Tracking, Revenue Recognition & WIP Reporting, AIA Progress Billing, Procurement Module with 3-Way Match, and Unified Payment & Invoice Tracking.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, unified AI chat, and Notion-style project notes.
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Website Builder System**: White-label website management with AI Website Wizard.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **SOC 2 Type II Readiness**: Full policy library, runbooks, DPA template, security questionnaire, and controls matrix.
*   **Integration Gating**: Feature flags gate unconfigured third-party services.
*   **Structured Error Logging**: Captures production errors with detailed context.
*   **Consolidated Startup Migrations**: Idempotent schema migration checks with automatic schema drift detection.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Account Settings Hub**: Unified settings page with URL-based sidebar routing.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer.
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags and role-based defaults.
*   **BIM & LiDAR Integration**: Client-side IFC file parsing for quantity extraction, 3D BIM Viewer, and LiDAR Scanner Module for point cloud analysis.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, and AI-powered risk suggestions.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **Pagination Contract (Task #2430)**: `server/utils/pagination.ts` defines `paginationSchema`, `parsePagination`, `encodeCursor`/`decodeCursor`, `cursorWhere`, `setNextLinkHeader`, and `buildPage` (cap `MAX_PAGE_SIZE=200`). Cursors are base64url JSON `{ts,id}` over `(sortColumn DESC, id DESC)`. Pilot routes `/api/audit-logs`, `/api/crm/contacts`, `/api/crm/calls/transcripts/backfill/history` opt into the `{items,nextCursor,total?}` envelope when the request includes `?cursor=` or `?pageSize=`; legacy array shape is preserved otherwise to avoid breaking existing callers. CRM contacts table on `client/src/pages/crm.tsx` uses `useInfiniteQuery` (200/page, up to 50 pages = 10k rows) + TanStack Virtual padding-row pattern. See `docs/api/pagination.md` for the full contract and author checklist.
*   **Performance & Security Patterns**: Includes 4-tier rate limiting, opt-in pagination, N+1 query prevention, DB health check monitoring, Zod validation, safe financial math utilities, password complexity policy, and robust caching strategies.
*   **Email Marketing Campaigns**: Full email campaign lifecycle with template management, contact lists, bulk sending, scheduling, and analytics.
*   **Heavy Civil & Nationwide DOT Coverage**: Foundation schema for FHWA + all 50 state DOTs with global reference data and org-scoped overrides.
*   **Gantt PDF Export**: Server-side PDF export for large schedules using headless Chromium.
*   **Native Mobile Field App**: Expo + React Native field app with offline-first SQLite cache, sync coordinator, and push notifications, supporting daily reports, time clock (GPS), photos, punch list, RFI, inspections, drawings, and conflicts.
*   **Drawings & Markup at Scale**: Includes plan-document markups with various tools, carryover-on-revision functionality, burned-in PDF export, searchable sheet navigation, and virtualization for efficient rendering.
*   **Submittals & RFI Production Field Workflow**: Automated escalations, external document email service, PDF log endpoints, and scheduled log emails. Mobile app supports field stamping and updates.
*   **Schema Layout (Task #2426)**: `shared/schema/features.ts` was split into 35 per-domain files under `shared/schema/features/` (ai, ai_estimator, campaigns, compliance, contracts, crew, crm, dot, drawings, email, equipment, estimate, financial, flags, hiring, hustler, integrations, kpi, library, lidar, messaging, mobile, org_catalog, performance, portal, reports, rfi, safety, schedule, subcontractor, takeoff, user_settings, vendor_pricing, website, workflows, misc). Pure relocation — Drizzle pgTable names + column definitions are byte-identical (no SQL migrations). `shared/schema/features.ts` is kept as a re-export shim so every existing `@shared/schema` import keeps working. Bucketing rule + per-domain map live in `shared/schema/features/index.ts`; the splitter that produced the layout is `scripts/split-features.cjs`.
*   **Per-Domain Storage Seam (Task #2431, pilot: bids)**: `server/storage.ts` is being broken up domain-by-domain. The bids pilot lives at `server/bids/storage.ts` (`IBidStorage` + `CrossOrgAccessError`) and `server/bids/storage.drizzle.ts` (`BidStorageDrizzle(orgId: string|null)`). `server/bidRoutes2.ts` no longer imports `db` — it goes through a `getBidStorage(req,res)` helper that uses `getOrgIdForFilter` and a shared `handleStorageError` that maps `CrossOrgAccessError` → 403. `orgId=null` is the unscoped form (`SUPER_ADMIN` + public RFQ token paths). Pattern, contract, route adoption rules, and "how to migrate the next domain" are documented in `docs/architecture/storage-pattern.md`. `server/storage.ts` is intentionally **not** deleted; other domains will adopt this seam incrementally. Contract tests in `server/bids/__tests__/storage.test.ts`.
*   **Repo hygiene (Task #2432)**: Historical audits, code dumps, and one-off snapshot reports live under `docs/archive/` (with a brief README); only current operational docs stay at the repo root. `.gitignore` blocks root-level `new-*.{js,css,map}` build artifacts. Test-only deps (`@types/*`, `vitest`, `@vitest/*`, `@testing-library/*`, `supertest`, `jsdom`) live under `devDependencies`, dropping the pruned prod install by ~200 MB. Migration filename collisions at 0044/0045/0046/0057 were renumbered to 0085–0093; `server/utils/migrationStartupCoverage.ts` keys were updated to match. The legacy parallel `drizzle/` directory was removed (its sole entry, `0028_vendor_service_catalog_and_rental_approval.sql`, is superseded by `vendorServiceCatalog` in `shared/schema/features.ts` and auto-applied by `reconcileSchemaDrift`). `server/bidRoutes2.ts` was renamed to `server/bidRoutes.ts` (no legacy `bidRoutes.ts` predecessor existed). `server/seedTradeExpansion.ts` intentionally stays under `server/` — production routes (`server/routes.ts`, `server/aiOnboardingRoutes.ts`) import live helpers from it (`seedCoreTradeModifierCategories`, `seedScopeStandardizationForTrade`), so it is not a one-shot script.
*   **AI Provider Routing (Task #2410)**: The Takeoff family of AI calls (`aiTakeoffFeatureRoutes`, `aiHeavyCivilFeatureRoutes`, AI Estimator's `takeoffDraft` + `chat`) flows through a provider abstraction at `server/ai/providers/` that wraps both OpenAI and Anthropic Claude (`claude-sonnet-4-5`). Routing is per-org via the `AI_PROVIDER_TAKEOFF` feature flag (off by default — existing tenants stay on GPT-5.2). When the flag is on, calls go to Claude with automatic single-retry fallback to OpenAI on 5xx/408/429/529 or network errors; the audit row stamps `provider`, `fallback_used`, `latencyMs`, input/output token counts so the Super Admin dashboard can prove which model answered each call. Embeddings, daily-run AI, hiring scoring, and every other AI feature continue to use OpenAI directly. Vision parity preserved — image_url parts auto-convert to Anthropic image/document blocks; JSON-mode is replicated via system-prompt nudge plus assistant `{` prefill. Toggle lives in the existing Super Admin → Organization → Feature Flags UI (auto-rendered from `FEATURE_FLAG_KEYS`). Regression scorecard at `scripts/ai-takeoff-provider-scorecard.ts` runs a fixed bench against both providers for cutover decisions.

## External Dependencies
*   PostgreSQL (Neon)
*   Replit Object Storage (Google Cloud Storage backend)
*   OpenAI via Replit AI Integrations
*   Anthropic Claude (`@anthropic-ai/sdk`, requires `ANTHROPIC_API_KEY` secret) — used only by the Takeoff family routing path (Task #2410)
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
*   Sage Intacct
*   Bluebeam, Autodesk Construction Cloud (OAuth integration scaffolds)
*   Public API at `/api/v1/public`
*   @node-saml/node-saml