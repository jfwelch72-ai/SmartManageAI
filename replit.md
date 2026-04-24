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
*   **Performance & Security Patterns**: Includes 4-tier rate limiting, opt-in pagination, N+1 query prevention, DB health check monitoring, Zod validation, safe financial math utilities, password complexity policy, and robust caching strategies.
*   **Email Marketing Campaigns**: Full email campaign lifecycle with template management, contact lists, bulk sending, scheduling, and analytics.
*   **Heavy Civil & Nationwide DOT Coverage**: Foundation schema for FHWA + all 50 state DOTs with global reference data and org-scoped overrides.
*   **Gantt PDF Export**: Server-side PDF export for large schedules using headless Chromium.
*   **Native Mobile Field App**: Expo + React Native field app with offline-first SQLite cache, sync coordinator, and push notifications, supporting daily reports, time clock (GPS), photos, punch list, RFI, inspections, drawings, and conflicts.

## Testing
*   **Auto-Synced Test Database**: Vitest runs `server/__tests__/globalSetup.ts` before any test suites. It hashes `shared/schema/**` + `drizzle.config.ts`, compares against a hash stored in `_test_schema_meta` inside the test DB, and — only when they differ — rebuilds the schema by running `drizzle-kit export --sql`, dropping `public`, and reapplying the exported SQL in one query. Cold rebuild is ~12s; warm path is ~1.5s. Set `SKIP_TEST_DB_PUSH=1` to bypass entirely or `FORCE_TEST_DB_REBUILD=1` to force a rebuild. See `DATABASE_MIGRATION_STRATEGY.md` for details.
*   **One-shot test DB bootstrap for new contributors**: New contributors run `npm run test:setup` once. The script (`scripts/setup-test-db.ts`) provisions a sibling `<dbname>_test` database next to the dev DB and writes a gitignored `.env.test` with a matching `DATABASE_URL`. `server/__tests__/loadEnvTest.ts` (wired into vitest as both a `setupFiles` entry and a `globalSetup` side-effect import) auto-loads `.env.test` before the destructive-rebuild safety check, so plain `npm test` then works without any manual env exports. Inline `DATABASE_URL=… npm test` still wins when the URL already looks like a test DB. Full instructions in `TESTING.md`.

## Drawings & Markup at Scale (Task #1609)
*   **Plan-document markups (`plan_document_markups`)** — Project-side counterpart to `takeoff_markups`, keyed to `(plan_document_id, page_number)` and carrying the same six tools (ARROW, TEXT, RECTANGLE, CLOUD, HIGHLIGHT, FREEHAND). Routes live in `server/planDocumentMarkupRoutes.ts` (CRUD, carryover, PDF export, print-stream, pin-rollup) and emit `recordJobMetrics` on every operation. The shared React renderer is `client/src/components/markups/MarkupRenderer.tsx` (react-konva) so the interactive PlansTab overlay (`PlanMarkupLayer` + `PlanMarkupToolbar`) and the headless print page reuse the same shapes. RBAC: create + delete are gated to `ADMIN | MANAGER | SUPERINTENDENT | FIELD_WORKER` (with per-row "owner-or-manager" rule on delete); export.pdf is gated to `ADMIN | MANAGER | SUPERINTENDENT` because it spins up a headless browser.
*   **Carryover-on-revision** — `POST /api/plan-documents/:id/carryover-annotations` copies pins/markups from a prior `plan_documents` row to a newer one inside a single `db.transaction`, so a partial copy can never appear as `ok: true`. Idempotency comes from `UNIQUE (plan_document_id, source_pin_id)` on `plan_pins` and `UNIQUE (plan_document_id, source_markup_id)` on `plan_document_markups`, combined with `ON CONFLICT DO NOTHING` in the route. UI surface: `<CarryoverAnnotationsDialog />` (manually triggered from the PlansTab document menu).
*   **Burned-in PDF export** — `GET /api/plan-documents/:id/export.pdf?includeMarkups=&includePins=` mirrors the gantt-pdf-service Chromium pattern (`server/planDocumentPdfExport.ts`) by navigating headless Chromium to `client/src/pages/PlanDocumentPrintPage.tsx`. The print page sets `window.__PLAN_PDF_READY` once all pages + overlays are rendered. Hard cap of 500 pages → HTTP 413; the cap is checked **before** rasterization (the server forwards `MAX_PAGES` as a `?maxPages=` query param so the print page can short-circuit on `pdf.numPages > maxPages` and avoid pinning the renderer on a 5,000-page document).
*   **Searchable sheet navigation** — `<SheetJumpPalette />` registers a project-scoped `Cmd/Ctrl+K` listener via `useSheetJumpPaletteHotkey` and fuzzy-searches across `plan_documents` and `takeoff_sheets`.
*   **Virtualization** — PdfPreview's thumbnail strip uses `@tanstack/react-virtual` so 600+ page documents render only a small windowed slice. Test coverage in `client/src/components/markups/__tests__/PdfPreviewVirtualization.test.tsx`.

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
*   Sage Intacct — Phase A (Task #1600) ships QBO-parity sync (`importChartOfAccounts`, `exportCustomers`, `exportInvoice`, `importPaymentStatus`) via the legacy XML Gateway at `api.intacct.com/ia/xml/xmlgw.phtml`. Requires `SAGE_INTACCT_SENDER_ID` + `SAGE_INTACCT_SENDER_PASSWORD` (developer/sender account, shared across tenants) plus per-tenant `companyId` / `userId` / `userPassword` captured into `integration_connections.metadata` after the OAuth callback. `companyId` and an optional `locationId` are passed through OAuth `state`; `userId` / `userPassword` are **never** carried in OAuth state and are uploaded post-authorization via the authenticated `POST /api/integrations/sage/credentials` endpoint (SUPER_ADMIN/ADMIN only). The `userPassword` field is encrypted at rest by `encryptMetadata` (AES-256-GCM, alongside `accessToken` / `refreshToken` / `clientSecret`) and only decrypted on demand inside `resolveSageCredentials`. Cost-code → GL mappings live in `sage_account_mappings` (mirrors `qbo_account_mappings`). Idempotency is via `integration_sync_state` (`exported_sage_customers`, `exported_sage_invoices`); `exportInvoice` returns `alreadyExported: true` on re-submit of the same `localInvoiceId` so SOV approval pipelines don't double-count. `importPaymentStatus` snapshots Sage AR status *and* promotes `paid` / `partial` results back into the local `pay_applications.paidAmount` / `paidAt` columns by inverting the local→Sage `idMapping`. `xmlGateway.sageRequest` exposes `SageGatewayError` with `status` / `retryable` / `bodyExcerpt`; 5xx + network/abort errors are retried with 500/1500/4000 ms backoff (configurable via `timeoutMs` / `maxAttempts` / `retryBackoffMs`) while 4xx errors fail fast. Failures from the periodic job and per-call helpers are routed through `recordSyncFailure` / `recordSyncSuccess` with `sage_sync:<op>` entity types so the shared `SyncRetryPanel` and 5/15/45/120/360 min retry sweep treat Sage like QBO. Explicit named REST routes — `POST /api/integrations/sage/sync` (batch push/pull for active project connections).
*   Bluebeam, Autodesk Construction Cloud (OAuth integration scaffolds)
*   Public API at `/api/v1/public` (Bearer/X-API-Key auth, scoped permissions, per-key rate limits, request logging, HMAC-signed outbound webhooks). Developer Portal UI at `/developer-portal`.
*   @node-saml/node-saml

## Submittals & RFI Production Field Workflow (Task #1599)
- Nightly overdue escalation crons in `server/jobs/jobRunner.ts` (`processRfiOverdueNotifications`, `processSubmittalReviewOverdueNotifications`) mirror the SWPPP sweep (per-org cap + interval, dedupe marker + reminder counter). Both registered at `0 7 * * *`.
- `server/services/externalDocEmailService.ts` — gated by per-org `EXTERNAL_DOC_EMAIL` flag (default OFF). Resolves recipient via `crm_contacts` join, mints a 90-day `subcontractor_portal_tokens` row, and sends a Resend email with a `/sub-portal?token=…` deep link. Wired into RFI forward (`server/rfiRoutes.ts`) and submittal review-start (`server/submittalRoutes.ts`).
- `server/services/logPdfService.ts` + `GET /api/projects/:projectId/(rfis|submittals)/log.pdf` — PDFKit log endpoints (manager-auth + org-scoped). "Download log (PDF)" buttons on the desktop `ProjectRFIs` and `ProjectSubmittals` tabs.
- **Task #1606 — scheduled log emails.** `project_log_email_schedules` (one row per project + RFI/SUBMITTAL log type, default cadence OFF) drives an hourly cron `processProjectLogEmailSchedules` in `server/jobs/jobRunner.ts`. Cadence/weekday/hour/timezone gating mirrors the certified-payroll digest (DAILY/WEEKLY 23h dedupe, BIWEEKLY 13d dedupe). Recipients flatten from `project_email_distribution_lists` (project-scoped + org-level fallback). PDFs are built via `server/services/projectLogService.ts` (`buildProjectLogPdfBuffer`), which is the same row+branding resolution the on-demand `log.pdf` routes now call. CRUD lives in `server/projectLogEmailScheduleRoutes.ts` (`GET /api/projects/:projectId/log-email-schedules`, `PUT /api/projects/:projectId/log-email-schedules/:logType`). Tests: `server/__tests__/project-log-email-schedule.test.ts`.
- Mobile: `mobile/src/screens/Submittals.tsx` field stamp UI (queues `SUBMITTAL_STAMP` via outbox); pull adds `submittals` to the cache; `server/mobileSyncRoutes.ts` push handler updates `submittal_reviews` (status = stamp action) + writes `submittal_activity`.

## Native Mobile Field App
- `mobile/` — Expo + React Native (TypeScript) field app: offline-first SQLite cache + outbox, sync coordinator against `mobileSyncRoutes`, push tokens via Expo, SSO with the same `auth_token` cookie. Screens: daily reports, time clock (GPS), photos, punch list, RFI, inspections, drawings, conflicts.
- `server/services/nativePushService.ts` — sends Expo push to all `mobileDevices.pushToken` for a user. Wired into `notificationDelivery.deliverPush` so any event that already triggers web push also reaches native.
- `.github/workflows/mobile-eas-build.yml` — EAS preview builds for iOS + Android on changes under `mobile/`.
- Builds and store submissions (TestFlight, Play Internal) require EAS credentials and an Apple Developer + Google Play account; cannot be performed from Replit.
