# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to streamline and manage the entire construction project lifecycle for various trades. It centralizes project data, user management, and daily operations to enhance efficiency, ensure compliance, and provide comprehensive oversight. The platform integrates AI-driven features, dynamic navigation, trade-specific dashboards, and a full suite of tools for project management, estimating, CRM, compliance, and workforce management. Its purpose is to deliver a robust, scalable solution that improves project outcomes and operational efficiency within the construction industry, offering significant market potential.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform is built on a modern web stack featuring a multi-tenant architecture, designed for security, scalability, and an optimal user experience.

**Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript.
*   **Database**: PostgreSQL, managed with Drizzle ORM.
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) supporting 18 user roles, and OAuth social login (Google, Apple) with CSRF protection, email verification, account lockout, and a strong password policy. AI routes enforce RBAC.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to specific trade types.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation across various modules (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), governed by an AI Governance System for usage tracking, daily limits, and cost audit. All AI calls (including website SEO, social media, estimates, blog, equipment plans, vendor extraction, trade discovery, scope prediction) are wrapped with `governedAiCall` for centralized limit enforcement and audit logging. Limits are tier-aware (free/starter/professional/enterprise) with cached org plan tier lookup. DALL-E image generation costs are tracked. The AI Governance dashboard shows usage progress bars with limits, paginated audit log with user names, date range filtering, and cost breakdown by action type.
*   **Project Lifecycle Management**: Comprehensive workflows covering Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking. Includes a Unified SOW Tracking System.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment catalogs, and tracks insurance/compliance expiration with alerts.
*   **Workforce Management**: Native time-clock with GPS/geofence validation, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, KPI dashboards, and crew scheduling with conflict detection.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework. Includes Addenda Tracking System.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, and token-protected staging preview links.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, GDPR compliance, feature flags, and a 4-tier subscription model. Includes Super Admin tools for platform management and security audits.
*   **HTTP Security Headers**: Helmet middleware sets various security headers.
*   **API Log Redaction**: Middleware redacts sensitive fields and masks PII in server logs.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, with security hardened via AES-256-GCM token encryption.
*   **Multi-Source Document Upload**: Supports local files, direct links (with SSRF protection), and integrated cloud storage services.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, UI for history and comparison, and in-app notifications for RFIs, Submittals, and Transmittals.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Takeoff Enhancements**: Sheet management, visual revision comparison, addenda overlays, advanced calibration, and new measurement types.
*   **Libraries System**: Provides reusable library management for custom items, assemblies, and saved takeoffs, with backend API for CRUD, bulk import, and trade-aware seeding.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets, and role-based default layouts. Dashboard layout and color scheme customization are now available to all users without permission gating.
*   **Feature Permissions System**: Granular per-user feature access control with 8 permissions in 4 categories: Financial (`canAccessFinancials`, `canManagePayroll`), Operations (`canAccessReports`, `canUseAiFeatures`), Marketing (`canPostSocialMedia`, `canManageWebsite`), Management (`canManageEquipment`, `canManageProcurement`). Admins always bypass all checks. Managed via "Feature Permissions" tab in User Management (`/users`). Backend routes at `/api/dashboard/permissions` and `/api/dashboard/my-permissions`. Hook: `useFeaturePermission(key)` for frontend gating.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Custom KPI Management System**: Org-level custom KPI definitions, assignment to employees with targets, and performance tracking. Integrated as tabs within Workforce Management (`/manage-workers`).
*   **Contractor Onboarding Library**: A hard-coded, normalized reference data system for trades, scopes, materials, formulas, and grammar, powering AI onboarding and dynamic UI components.
*   **Social Media Management System**: Comprehensive content management with scheduling, AI generation, and multi-platform support (FACEBOOK, INSTAGRAM, LINKEDIN, TWITTER, TIKTOK, YOUTUBE, PINTEREST), including a rich media picker and approval workflow. Social media uploads (manual and AI-generated) are stored in the shared `gallery/{orgId}/` storage path and appear in the Website -> Media library with "Social" source badges, enabling centralized file size visibility and upload control.
*   **Reports System**: Provides 9 report types across Takeoff and Estimate categories, with CSV export, browser print, and snapshot creation. Mobile-responsive design.
*   **Change Order Workflow Enhancement**: Includes revision history tracking and a multi-level approval chain.
*   **Bid Plans & Takeoff Step**: 6-step bid workflow with a full takeoff workspace in Step 1. Features document tree sidebar (Plans, Specs, Takeoff, Supporting Documents), interactive PDF viewer with measurement tools (linear, area, count, volume), calibration, quantity categories, and measurements summary. Uses context-aware `useTakeoffData` hook and `TakeoffWorkspace` component that support both project and bid contexts. Takeoff sheets and quantity categories have nullable `bidId`/`projectId` columns. Bid-specific API routes at `/api/bids/:bidId/takeoff/*` with org access verification. Generic sheet-level routes (calibration, rename, delete, duplicate, folder-group) use `verifySheetAccess()` helper for dual project/bid authorization.
*   **Payroll Enhancement System**: Full payroll processing with three core features:
    *   **Employee Deductions Management**: Organization-level deduction types (13 categories: Federal Tax, State Tax, FICA, Medicare, Union Dues, Health/Dental/Vision Insurance, 401k, Garnishment, Child Support, etc.) with percentage/fixed/tiered calculation methods, max annual limits, and pre-tax flags. Employee-specific deduction assignments with optional override amounts and effective date ranges.
    *   **Pay Stub Generation**: Itemized pay stubs per employee per pay run showing earnings breakdown (regular/OT by project), all applied deductions with YTD totals, and net pay. Individual and batch print support via printable HTML views.
    *   **Certified Payroll Reports (WH-347)**: Federal form WH-347 generation with contractor/project headers, employee rows (classification, daily hours, rates, gross, FICA, withholding, other deductions, net wages), prevailing wage compliance checking per worker classification, Statement of Compliance section, CSV export, and printable report views.
    *   Schema tables: `payroll_deduction_types`, `employee_deductions`, `pay_stub_deductions`. Extended `pay_runs` and `pay_run_line_items` with gross/deductions/net fields.
    *   UI components: `DeductionsTab`, `PayStubView`, `CertifiedPayrollReport` in `client/src/components/payroll/`.
    *   Backend routes in `server/payrollManagementRoutes.ts` with tenant-isolated CRUD (whitelisted fields, org-scoped FK validation).

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