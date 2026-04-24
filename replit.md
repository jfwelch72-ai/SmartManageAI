# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to centralize and streamline the entire construction project lifecycle. It aims to enhance efficiency, ensure compliance, and provide comprehensive oversight through AI-driven features, dynamic navigation, trade-specific dashboards, and a full suite of tools for project management, estimating, CRM, compliance, and workforce management. The platform seeks to deliver a robust, scalable solution that improves project outcomes and operational efficiency within the construction industry. Key capabilities include AI for generation, analysis, scheduling, and automation, comprehensive project lifecycle workflows, an advanced estimating engine with real-time collaboration, a full CRM system, and robust workforce management. The platform also includes extensive compliance and audit features, financial management tools, unified communication, a website builder, and enterprise-grade security and scalability.

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
*   **Multi-Tenancy & Customization**: AI-driven onboarding and dynamic features for specific trade types.
*   **AI Integration**: AI for generation, analysis, scheduling, and automation across modules, governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows including Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking, Contract Management, and CPM Scheduling.
*   **Estimating Engine**: Advanced takeoff workspace with interactive drawing tools, material calculation, 6-step bid workflow, real-time multi-user collaboration, and full takeoff versioning.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline, including web-to-lead, quotes, tasks, and auto-assignment.
*   **Workforce Management**: Native time-clock (GPS/geofence), shift management with cost code tracking, Manager Approval Workflow, configurable overtime rules engine, KPI dashboards, and Certified Payroll Reports.
*   **Compliance & Audit**: Audit logging, document management (versioning, expiration), Approval Workflows Framework, Addenda Tracking, Permits & Licenses Tracking, PPE Compliance Tracker, and QC Material Testing Log, including Safety & Compliance Hub with OSHA Logs and observations.
*   **Financial Management**: Budget vs Actual Cost Engine, CFO Cost Forecasting Dashboard, Live Project Profitability Tracking, Revenue Recognition & WIP Reporting, AIA Progress Billing, Procurement Module with 3-Way Match, and Unified Payment & Invoice Tracking.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, unified AI chat, and Notion-style project notes.
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Website Builder System**: White-label website management with AI Website Wizard.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **SOC 2 Type II Readiness**: Full policy library, runbooks, DPA template, security questionnaire, and controls matrix live in `docs/compliance/`.
*   **Integration Gating**: Feature flags gate unconfigured third-party services.
*   **Structured Error Logging**: Captures production errors with stack trace, user context, route, and request ID.
*   **Consolidated Startup Migrations**: Idempotent schema migration checks with automatic schema drift detection. Every SQL file under `migrations/` must have an entry in `server/utils/migrationStartupCoverage.ts` — either pointing at an `ensure*` helper that is **registered in the `migrations` array** of `runStartupMigrations.ts` (importing the helper is not enough — it must appear as `{ fn: ensureXxx }` so it actually runs on startup) or carrying an explicit `skip` reason. The companion test (`server/utils/__tests__/migrationStartupCoverage.test.ts`) fails CI if a new SQL file lands without coverage, catching the class of regression seen in #1062/#1066/#1076/#1089.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Account Settings Hub**: Unified settings page with URL-based sidebar routing.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer. The `/status` page probes components from multiple vantage points; production runs with `STATUS_PROBE_REGIONS_JSON` pointing at `local` plus two probe Workers we operate (us-east, eu-west, sourced from `probes/cloudflare-worker/`) so a regional CDN/DNS outage must be confirmed by a majority of vantage points before flipping a component. The previous bundled public CORS proxies are no longer used. Vantage point configuration and deploy steps are documented in `docs/runbooks/status-probe-vantage-points.md`. The `/admin` landing page tiles the platform-ops surfaces: a SUPER_ADMIN-only **Transcript backfill** tile with a "N quiet org(s)" badge driven by the existing `/api/crm/calls/transcripts/backfill/alert-failures-digest` JSON endpoint (silent-pipeline detection — orgs that ran backfill in the last 24h but produced zero alert delivery rows); cross-org alert-failure CSV exports (summary, samples, quiet) audited as `action=CREATE entityType=admin_csv_export`; retention-sweep no-op alerting via the `policiesUnsupported` absolute-floor rule; and a grouped **Background jobs** section (`/admin/job-metrics` counters → `/admin/one-shot-jobs` history → `/admin/jobs/metrics` rolling 24h trends) that surfaces the structured `one_shot_job_runs` aggregates introduced for post-deploy backfills.
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags and role-based defaults.
*   **BIM & LiDAR Integration**: Client-side IFC file parsing for quantity extraction, 3D BIM Viewer, and LiDAR Scanner Module for point cloud analysis.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, and AI-powered risk suggestions.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **Performance & Security Patterns**: Includes 4-tier rate limiting, opt-in pagination, N+1 query prevention, DB health check monitoring, Zod validation on all POST/PATCH/PUT routes, safe financial math utilities, password complexity policy, and robust caching strategies.
*   **Email Marketing Campaigns**: Full email campaign lifecycle with template management, contact lists, bulk sending, scheduling, and analytics.
*   **Heavy Civil & Nationwide DOT Coverage**: Foundation schema for FHWA + all 50 state DOTs with global reference data and org-scoped overrides, supporting entities like DBE goals, surety bonds, haul tickets, and material certifications.
*   **Gantt PDF Export**: Server-side PDF export for large schedules using headless Chromium.

## Testing
*   **Auto-Synced Test Database**: Vitest runs `server/__tests__/globalSetup.ts` before any test suites. It hashes `shared/schema/**` + `drizzle.config.ts`, compares against a hash stored in `_test_schema_meta` inside the test DB, and — only when they differ — rebuilds the schema by running `drizzle-kit export --sql`, dropping `public`, and reapplying the exported SQL in one query. Cold rebuild is ~12s; warm path is ~1.5s. Set `SKIP_TEST_DB_PUSH=1` to bypass entirely or `FORCE_TEST_DB_REBUILD=1` to force a rebuild. See `DATABASE_MIGRATION_STRATEGY.md` for details.
*   **One-shot test DB bootstrap for new contributors**: New contributors run `npm run test:setup` once. The script (`scripts/setup-test-db.ts`) provisions a sibling `<dbname>_test` database next to the dev DB and writes a gitignored `.env.test` with a matching `DATABASE_URL`. `server/__tests__/loadEnvTest.ts` (wired into vitest as both a `setupFiles` entry and a `globalSetup` side-effect import) auto-loads `.env.test` before the destructive-rebuild safety check, so plain `npm test` then works without any manual env exports. Inline `DATABASE_URL=… npm test` still wins when the URL already looks like a test DB. Full instructions in `TESTING.md`.

## Backfills
*   **Cloud document import audit backfill (Task #1493)** — Run `npx tsx scripts/backfill-cloud-document-audit.ts` once on 2026-04-24 to synthesize CREATE `audit_log` rows for `plan_documents` previously imported via `POST /api/documents/from-url` and `POST /api/documents/from-cloud`. Those routes silently lost their audit row prior to the circular-JSON fix in Task #1454. The script identifies cloud/URL imports via `file_url = object_key`, skips documents that already have a CREATE audit row, and is safe to re-run.

## External Dependencies
*   PostgreSQL (Neon)
*   Replit Object Storage (Google Cloud Storage backend)
*   OpenAI via Replit AI Integrations (gpt-5.2 default)
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
*   Sage Intacct, Bluebeam, Autodesk Construction Cloud (OAuth integration scaffolds)
*   Public API at `/api/v1/public` (Bearer/X-API-Key auth, scoped permissions, per-key rate limits, request logging, HMAC-signed outbound webhooks). Developer Portal UI at `/developer-portal`.
*   @node-saml/node-saml

## Native Mobile Field App
- `mobile/` — Expo + React Native (TypeScript) field app: offline-first SQLite cache + outbox, sync coordinator against `mobileSyncRoutes`, push tokens via Expo, SSO with the same `auth_token` cookie. Screens: daily reports, time clock (GPS), photos, punch list, RFI, inspections, drawings, conflicts.
- `server/services/nativePushService.ts` — sends Expo push to all `mobileDevices.pushToken` for a user. Wired into `notificationDelivery.deliverPush` so any event that already triggers web push also reaches native.
- `.github/workflows/mobile-eas-build.yml` — EAS preview builds for iOS + Android on changes under `mobile/`.
- Builds and store submissions (TestFlight, Play Internal) require EAS credentials and an Apple Developer + Google Play account; cannot be performed from Replit.
