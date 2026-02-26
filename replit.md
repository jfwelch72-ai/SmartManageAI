# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to manage the entire construction project lifecycle for various trades. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. Key features include AI-driven onboarding, dynamic navigation, trade-specific dashboards, and comprehensive tools for project management, estimating, CRM, compliance, and workforce management. The platform aims to be a robust, scalable solution that improves project outcomes and operational efficiency across the construction industry.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack with a multi-tenant architecture, prioritizing security, scalability, and user experience.

**Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
*   **Database**: PostgreSQL on Neon, managed with Drizzle ORM.
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) across ten user roles, and OAuth social login (Google, Apple) with CSRF protection and email verification.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to trade type (e.g., APIs, navigation, dashboards, Master Scope of Work items).
*   **AI Integration**: Features AI for generation, analysis, scheduling, automation (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), and an AI Governance System with daily limits and audit trails.
*   **Project Lifecycle Management**: Comprehensive workflows for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a guided Bid Cost Builder Workflow.
*   **Estimating Engine**: Includes interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder.
*   **CRM System**: Manages various organizational entities with vendor pricing, rental equipment catalogs, and type-specific fields.
*   **Workforce Management**: Features a native time-clock with GPS, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, and KPI dashboards.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM), integrating with AI for insights.
*   **Unified SOW Tracking System**: Ensures consistent linking of scope of work items across the project lifecycle, with auto-seeding based on trade type.
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, and publishing controls.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, and GDPR compliance tooling, gated by feature flags and a 4-tier subscription model.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling. Includes expanded QuickBooks Online integration with 8 sync operations.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, source tracking, and UI for history and comparison.
*   **Addenda Tracking System**: Full addenda lifecycle management per project, including status workflow, related document linking, and acknowledgment tracking.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with outbox dispatcher, including scheduled QBO sync processing every 15 minutes.
*   **Takeoff Enhancements**: Sheet management, visual revision comparison (side-by-side + overlay slider modes), and addenda overlays in TakeoffWorkspace with advanced calibration tools.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support with a service worker.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout (v3), configurable widgets, and a widget configuration system. Widgets support duplication and per-section adding.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **OAuth Social Login**: Integration with Google and Apple for user authentication.
*   **Trend Chart Widget**: New `TREND_CHART` widget type (non-singleton, all roles, hasSettings). Renders line or bar chart via Recharts. Configurable: Metric (Labor Cost, Revenue, Bid Win Rate, Overtime Hours, Cash Flow), Chart Type (Line/Bar), Time Period (7D/30D/90D/6M/1Y), Group By (None/Project/Trade). Backend: `GET /api/dashboard/trend?metric=X&period=Y&groupBy=Z` aggregates from `time_entries`, `projects`, `bids` tables with org-scoping. Multi-series support for grouped data. Components: `TrendChartWidget.tsx`, `TrendChartSettings.tsx`.
*   **Data List Widget**: `DATA_LIST` widget type (non-singleton, all roles, hasSettings). Displays filtered, sorted lists from 6 entity types: Projects, Organizations, Time Entries, Pay Runs, Subcontracts, Change Orders. Configurable: entity source, status filter (entity-specific options), sort field, sort direction, row limit (5/10/20). Backend: `GET /api/dashboard/list?entity=X&status=Y&sortBy=Z&sortDir=W&limit=N` with org-scoping and whitelist-validated sort fields. Components: `ListWidget.tsx`, `ListWidgetSettings.tsx`.
*   **Alerts Widget**: `ALERTS` widget type (non-singleton, no settings). Dynamic alerts across 5 categories: Insurance Expiring (org docs + CRM vendor insurance), Over Budget Projects (contract vs actual costs), Unapproved Time Entries (pending >48h or >7d), Late Subcontractor Payments (approved but unpaid, past-due billing milestones), Low Gross Margin (<5% critical, <15% warning). Backend: `GET /api/dashboard/alerts` returns severity-sorted alerts with counts. Component: `AlertsWidget.tsx`.
*   **Workforce Snapshot Widget**: `WORKFORCE_SNAPSHOT` widget type (non-singleton, no settings). Shows 4 daily workforce KPIs: Active Workers (from time_entries + time_clock_shifts), Overtime % (overtime/total hours), Labor Cost Today (hours * user cost rates with $50/$75 defaults), Absent Workers (total field workers minus active). Backend: `GET /api/dashboard/workforce-snapshot` with org-scoping. Component: `WorkforceSnapshotWidget.tsx`.
*   **Cash Position Widget**: `CASH_POSITION` widget type (non-singleton, no settings). Financial snapshot with 4 KPIs: Accounts Receivable (outstanding T&M invoices with SENT status), Accounts Payable (pending/approved subcontractor payments + ordered/delivered procurement items), Payroll Liability (unpaid pay runs in DRAFT/PENDING_APPROVAL/APPROVED/PROCESSING status), Net Cash Flow (AR - AP - payroll). Backend: `GET /api/dashboard/cash-position` with org-scoping. Component: `CashPositionWidget.tsx`.
*   **SOV Progress Widget**: `SOV_PROGRESS` widget type (non-singleton, no settings). Shows 3 key metrics: % Billed vs % Complete (dual progress bars with variance badge + top 5 project breakdown), Labor Cost vs SOV (labor hours × cost rates compared to total scheduled value), Retainage Held (total retainage with avg % badge). Backend: `GET /api/dashboard/sov-progress` aggregates from `schedule_of_values`, `time_entries`, `projects` tables with org-scoping. Component: `SOVProgressWidget.tsx`.
*   **Bid Pipeline Widget**: `BID_PIPELINE` widget type (non-singleton, no settings). Shows 4 metrics: Active Bids (count of ACTIVE status bids), Pipeline Value (sum of bid_amount for active bids), Win Rate (AWARDED / (AWARDED + LOST) percentage), Estimated Labor Exposure (sum of estimate_line_items.labor_cost for active bid estimates). Backend: `GET /api/dashboard/bid-pipeline` with org-scoping via bids.gc_organization_id. Component: `BidPipelineWidget.tsx`.
*   **Cost Code Breakdown Widget**: `COST_CODE_BREAKDOWN` widget type (non-singleton, hasSettings). Two modes: Labor by Cost Code (pie chart of labor cost per cost code from time_entries) and Budget vs Actual (grouped bar chart comparing estimate_line_items.labor_cost budget to actual time_entries labor cost per code). Configurable: mode (labor/budget_vs_actual), project filter. Backend: `GET /api/dashboard/cost-code-breakdown?mode=X&projectId=Y` with org-scoping. Components: `CostCodeBreakdownWidget.tsx`, `CostCodeBreakdownSettings.tsx`.
*   **Schedule Impact Widget**: `SCHEDULE_IMPACT` widget type (non-singleton, no settings). Shows 3 sections: 7-day labor allocation bar chart (from crew_project_assignments + crew_members), project manpower forecast (top 5 projects by headcount with crew/worker badges), and conflicts/overbooking detection (workers assigned to multiple projects on the same day). Summary stats: Total Workers 7D, Peak Day, Conflict Count. Backend: `GET /api/dashboard/schedule-impact` with org-scoping via projects.gc_organization_id. Component: `ScheduleImpactWidget.tsx`.
*   **Role-Based Default Layouts**: When a user has no custom layout, the system returns a role-appropriate default instead of the generic one. Implemented in `getDefaultLayoutForRole()` in `server/dashboardCustomizationRoutes.ts`. Mappings: `HOURLY_EMPLOYEE`/`SUPERINTENDENT` → Field Worker (task-focused, schedule/safety), `MANAGER`/`MAINTENANCE_MANAGER` → Project Manager (balanced KPIs, financials, operations), `ESTIMATOR` → Estimator (analytical, bid pipeline, cost analysis), `OFFICE_MANAGER` → CFO (financial-heavy, cash position, trending), `ADMIN`/`HUSTLER` → Executive (big-picture, revenue, margin, pipeline). `VENDOR`/`SUPER_ADMIN` → generic default. Each layout uses preconfigured KPI_SUMMARY, TREND_CHART, DATA_LIST, and COST_CODE_BREAKDOWN widgets with role-appropriate settings.

*   **QuickBooks Online Integration (Expanded)**: Full-featured QBO sync with 8 operations. OAuth 2.0 connection flow with token refresh. Sync operations: (1) Import Chart of Accounts, (2) Export Customers, (3) Export Invoices with ID tracking, (4) Import Payment Status, (5) Export Payroll as Journal Entries (maps pay_run_line_items by cost code to QBO accounts), (6) Export Subcontractor Payments as Bills (auto-creates vendors, deduplicates), (7) Export Purchase Orders (groups by PO number), (8) Payment Reconciliation (bulk checks all exported invoices for payment updates, updates local tm_invoices status). Cost Code to QBO Account Mapping system (`qbo_account_mappings` table) with auto-map by name matching. Automatic Sync Scheduling (`qbo_sync_schedules` table) with hourly/6h/daily/weekly frequencies, processed by cron job every 15 minutes. All operations support dry-run preview mode. Frontend: SyncPanel with operation cards, AccountMappingPanel with add/delete/auto-map, SyncSchedulePanel with toggle/frequency controls. Key files: `server/integrations/providers/qbo/sync.ts`, `server/integrationRoutes.ts`, `server/jobs/jobRunner.ts`, `client/src/pages/integrations.tsx`.

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