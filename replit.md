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
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) supporting 18 user roles, and OAuth social login (Google, Apple) with CSRF protection. AI routes enforce RBAC.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to specific trade types.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation across various modules (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), governed by an AI Governance System for usage tracking, daily limits, and cost auditing. All AI calls are wrapped with `governedAiCall` for centralized limit enforcement and audit logging, with tier-aware limits.
*   **Project Lifecycle Management**: Comprehensive workflows covering Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a Unified SOW Tracking System.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder. Includes a 6-step bid workflow with a full takeoff workspace, document tree, interactive PDF viewer, measurement tools, calibration, quantity categories, and measurements summary.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment catalogs, and tracks insurance/compliance expiration with alerts.
*   **Workforce Management**: Native time-clock with GPS/geofence validation, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, KPI dashboards, and crew scheduling with conflict detection. Includes employee deductions management, pay stub generation, and Certified Payroll Reports (WH-347) generation.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework, including an Addenda Tracking System.
*   **Safety Training Management**: Full in-house safety training lifecycle: create training programs (title, category, frequency, duration, materials), assign to individual employees or company-wide, track completion with digital acknowledgments, mark complete with sign-off. PDF export (per-employee or company-wide) generates professional reports for bid submission. Accessible at `/safety-training`. RBAC-protected (ADMIN, SAFETY_MANAGER, HR_MANAGER, MANAGER). Also exposed as a "Safety Training" tab on each Worker Detail profile. DB tables: `safety_trainings`, `safety_training_assignments`.
*   **Live Project Profitability Tracking**: Automated real-time cost monitoring for all active projects. A background cron job runs every 15 minutes, recalculates actual costs (labor, materials, subs, equipment, T&M, receipts) vs the adjusted budget, saves a snapshot, and fires in-app notifications to all financial-access users when variance crosses 5%, 10%, or 20% thresholds. Each project has a "Live Financials" tab visible to financial-access roles showing: live cost breakdown by category, budget consumed progress bar, variance meter (color-coded), projected completion cost, estimated margin, key metrics, and snapshot history. Auto-refreshes every 5 minutes. DB table: `project_profitability_snapshots`.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, token-protected staging preview links, and full SEO support including dynamic Open Graph/Twitter Card meta tags, per-page canonical URLs and noindex control, social share images (site-wide and per-page), dynamic sitemap.xml, and robots.txt generation.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, GDPR compliance, feature flags, and a 4-tier subscription model, including Super Admin tools.
*   **HTTP Security**: Helmet middleware for security headers and API log redaction for sensitive data.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, with security hardened via AES-256-GCM token encryption.
*   **Multi-Source Document Upload**: Supports local files, direct links, and integrated cloud storage services.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, UI for history and comparison, and in-app notifications.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Libraries System**: Provides reusable library management for custom items, assemblies, and saved takeoffs, with backend API for CRUD, bulk import, and trade-aware seeding.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets, and tiered default layouts. Dashboard layout and color scheme customization are available to all users, with RBAC and feature permissions enforced at multiple layers for widgets. Includes a Tiered Layout System (EXECUTIVE_TIER, OPERATIONS_TIER, FIELD_TIER, BASIC_TIER) where widgets auto-show/hide based on user permissions. A QUICK_ACTIONS widget provides dynamic, role-aware shortcuts. Admins can set an org-wide default color scheme.
*   **Feature Permissions System**: Granular per-user feature access control with 8 permissions in 4 categories (Financial, Operations, Marketing, Management). Admins bypass checks. Permissions are an additive merge of role defaults and DB-stored grants, enforced via middleware on backend routes and hooks on the frontend.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Unified Performance System**: KPI templates serve as rating criteria in a merged "Performance" tab within Workforce Management, allowing employees to be rated against KPI targets, KPI templates to be managed, and rating history to be viewed.
*   **Contractor Onboarding Library**: A hard-coded, normalized reference data system for trades, scopes, materials, formulas, and grammar, powering AI onboarding and dynamic UI components.
*   **Social Media Management System**: Comprehensive content management with scheduling, AI generation, and multi-platform support, including a rich media picker and approval workflow. Uploads are stored in a shared `gallery` path.
*   **Reports System**: Provides 9 report types across Takeoff and Estimate categories, with CSV export, browser print, and snapshot creation.
*   **Change Order Workflow Enhancement**: Includes revision history tracking and a multi-level approval chain.
*   **Approval Workflow Notifications**: In-app notifications across all 6 approval workflows (Change Orders, Submittals, T&M Tickets, Overtime Requests, Subcontractor Payables, Unified Approval Center). Approvers are notified on submission; submitters are notified on approval/rejection. Uses a shared `approvalNotificationService` with non-blocking error handling.
*   **Vendor & Sub RFQ Flow**: Send RFQ emails to subcontractors (via `contactEmail`) and material suppliers (via `supplierEmail`) directly from bid Steps 3 & 5. Schema tracks `rfqSentAt`, `rfqStatus` on both `bidSubcontractorQuotes` and `bidMaterialQuotes`. In-app notifications fire for Bid Network events (invitation received, response submitted, clarification posted/answered). Auto-sync creates/updates internal `bidSubcontractorQuote` records when Bid Network responses are submitted, keyed by `invitationId` in the notes field.

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