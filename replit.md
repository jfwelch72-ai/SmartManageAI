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
*   **Drawings & Markup at Scale**: Includes plan-document markups with various tools, carryover-on-revision functionality, burned-in PDF export, searchable sheet navigation, and virtualization for efficient rendering.
*   **Submittals & RFI Production Field Workflow**: Automated escalations, external document email service, PDF log endpoints, and scheduled log emails. Mobile app supports field stamping and updates.

## Development Workflow

### Type-checking

Run the project's TypeScript type-check via the registered `typecheck` validation step (it executes `NODE_OPTIONS='--max-old-space-size=8192' npx tsc -p tsconfig.json`). The compiler runs with `incremental: true` and persists its build cache at `node_modules/.cache/typecheck/tsbuildinfo`, so warm runs reuse cached output.

- Cold run (no cache): ~3 minutes for the full ~1,500-file project.
- Warm run (cache present): ~10 seconds.

Always invoke type-checking through the validation step rather than calling `tsc` ad-hoc — the validation harness streams full output, summarizes failures, and avoids re-running a 2+ minute cold compile every time. The cache lives under `node_modules`, so it survives between agent steps but is rebuilt after a fresh `npm install`. If you need to force a clean rebuild, delete `node_modules/.cache/typecheck/tsbuildinfo`.

The codebase currently has pre-existing type errors (tracked separately) — the validation step's job is to surface *new* regressions added by a change, not to be at zero today.

## Domain Conventions

### Takeoff Measurement Units
Volume measurements are reported in **cubic yards (CY)** everywhere — the Measurement Summary Report, all report exports (`server/reportRoutes.ts`), the takeoff measurement table, and the schema (`takeoffMeasurements.computedVolumeCy`). This was confirmed with estimating users in April 2026 (task #1924, follow-up to #1876). CY is the standard estimating unit for earthwork, concrete, and aggregate volumes in heavy-civil and building work, and matches AASHTOWare/DOT conventions.

If a future export ever needs cubic feet (CF), the conversion (×27) must be applied in a single shared quantity helper rather than scattered per-call-site, and the unit label must be changed in the same place. Do not introduce ad-hoc CF conversions in individual components or routes.

### Upload limits
Every multi-file uploader in the app shares the same per-batch file count cap, defined as `MAX_BATCH_UPLOAD_FILES = 50` in `client/src/lib/uploadLimits.ts` (alongside `MAX_STORAGE_FILE_SIZE`). All `<ObjectUploader>` call sites that accept more than one file at a time must import and pass this constant — do not hard-code per-call-site numbers like `5`, `10`, or `20`. Single-file pickers (avatar, company logo, single LiDAR scan, single receipt, single project media item, equipment maintenance photo, asset handover doc, individual heavy-civil DOT cert slot) are deliberately exempt and stay at `maxNumberOfFiles={1}` — they fill one form field and must not silently turn into multi-uploaders. The 50-file batch cap is the per-batch limit only; there is no cap on total files per bid/project, so users can run a second batch right after.

### CLI scripts imported by the server bundle
Any TS file under `scripts/` that the server transitively imports (e.g. `scripts/fetch-dot-pay-items.ts`, imported by `server/jobs/dotPayItemsRefresh.ts` for `runFetcher`) gets folded into `dist/index.js` by `esbuild --bundle`. The classic ESM "is this the entrypoint?" guard

```ts
const isMain = import.meta.url === `file://${process.argv[1]}`;
```

is **not safe in that case** — after bundling, both sides resolve to the bundle path (`/dist/index.js`), so `isMain` becomes `true` in production and the CLI's `main()` runs unconditionally on server boot. That blocked the port from opening and caused a publish failure (April 2026). When a `scripts/*.ts` file both exports helpers AND has a CLI `main()`, also require the entry filename to actually be the script:

```ts
const isMain =
  import.meta.url === `file://${process.argv[1]}` &&
  /(?:^|[\\/])my-script-name\.(?:ts|mts|cts|js|mjs|cjs)$/.test(process.argv[1]);
```

Or, equivalently, split the file so the bundled code path imports a pure-export module and the CLI lives in a separate `*-cli.ts` wrapper.

## External Dependencies
*   PostgreSQL (Neon)
*   Replit Object Storage (Google Cloud Storage backend)
*   OpenAI via Replit AI Integrations
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