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
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) supporting 18 user roles, and OAuth social login (Google, Apple) with CSRF protection.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to specific trade types.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation across various modules, governed by an AI Governance System for usage tracking, daily limits, and cost auditing.
*   **Project Lifecycle Management**: Comprehensive workflows covering Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a Unified SOW Tracking System.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder, with a 6-step bid workflow and full takeoff workspace.
*   **Custom Cost Code Management**: Organization-level cost code management with CSI division grouping and custom code support.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment catalogs, insurance/compliance tracking, and a 7-stage Sales Pipeline module.
*   **Workforce Management**: Native time-clock with GPS/geofence validation, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, KPI dashboards, crew scheduling, employee deductions, pay stub generation, and Certified Payroll Reports (WH-347) generation. Includes a Unified Performance System for KPI-based employee ratings.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, an Approval Workflows Framework, and an Addenda Tracking System.
*   **Safety Training Management**: Full in-house safety training lifecycle, including program creation, assignment, tracking, digital acknowledgments, and PDF export for compliance.
*   **Budget vs Actual Cost Engine**: Per-project cost code budget with real-time cost ledger aggregating committed and actual costs from all sources, grouped by CSI division, with variance alerts and an editable budget editor.
*   **Live Project Profitability Tracking**: Automated real-time cost monitoring via a background cron job, recalculating costs vs adjusted budget, saving snapshots, and firing in-app notifications for significant variance thresholds.
*   **Procurement Module**: Full procure-to-pay lifecycle covering Purchase Requests, Purchase Orders, Delivery Receipts, Vendor Invoices, and automated 3-Way Match, with RBAC-controlled approvals.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Communication & Collaboration**: Unified Messaging System with Slack-style channels, file attachments, voice messages, task @mentions, and a grouped sidebar. Includes Client Portal Chat and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, and full SEO support.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, GDPR compliance, feature flags, and a 4-tier subscription model, including Super Admin tools.
*   **HTTP Security**: Helmet middleware for security headers and API log redaction.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, with security hardened via AES-256-GCM token encryption.
*   **Multi-Source Document Upload**: Supports local files, direct links, and integrated cloud storage services.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, UI for history and comparison, and in-app notifications.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Internal Domain Event Bus**: A typed, in-process EventBus that decouples business action triggers from side-effects, handling audit logging, notifications, and webhook fan-out.
*   **Notification Delivery Framework**: Multi-channel notification delivery service supporting email, web push, SMS, Microsoft Teams, and Slack, with per-user channel preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Libraries System**: Provides reusable library management for custom items, assemblies, and saved takeoffs, with API for CRUD, bulk import, and trade-aware seeding.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets, and tiered default layouts based on user permissions. Includes organization-wide color scheme settings and 28 registered widget types.
*   **Performance Indexes**: Database indexes are optimized for frequently queried fields across key tables.
*   **Feature Permissions System**: Granular per-user feature access control with 8 permissions in 4 categories, enforced via backend middleware and frontend hooks.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Contractor Onboarding Library**: A hard-coded, normalized reference data system for trades, scopes, materials, formulas, and grammar, powering AI onboarding and dynamic UI components.
*   **Social Media Management System**: Comprehensive content management with scheduling, AI generation, multi-platform support, rich media picker, and approval workflow.
*   **BIM Quantity Extraction (Phase 2)**: Client-side IFC file parsing using web-ifc to extract building element quantities (count, length, area, volume) grouped by type (walls, slabs, beams, etc.). 3-step import dialog (review → map categories → confirm) creates BIM takeoff sheets with measurements. Supports re-extraction diff view comparing new vs previous quantities, BIM source badges on takeoff items, and category mapping memory across extractions. Backend: `server/bimRoutes.ts` at `/api/bids/:id/bim-extractions`. DB: `bim_extractions` table. Frontend: `client/src/components/bim/BimQuantityDialog.tsx`, `client/src/components/bim/BimDiffDialog.tsx`. Parser: `client/src/utils/ifc-quantity-parser.ts`. WASM files served from `client/public/web-ifc/`.
*   **Reports System**: Provides 9 report types across Takeoff and Estimate categories, with CSV export, browser print, and snapshot creation.
*   **Change Order Workflow Enhancement**: Includes revision history tracking and a multi-level approval chain.
*   **Approval Workflow Notifications**: In-app notifications across 6 approval workflows, notifying approvers and submitters.
*   **Submittal Items & Attachments**: Normalized `submittal_items` and `submittal_attachments` tables with `submittalCategory` and `submittalItemStatus` enums, featuring a tabbed interface in the SubmittalDetailDialog.
*   **Vendor & Sub RFQ Flow**: Enables sending RFQ emails to subcontractors and material suppliers directly from bid steps, with tracking of RFQ status and in-app notifications for Bid Network events.
*   **Hiring Module (ATS)**: Full Applicant Tracking System with job posting lifecycle, 10-stage candidate pipeline, interview scheduling, hiring task management, ATS provider abstraction with AES-256-GCM encrypted credentials and async background sync, AI candidate scoring (GPT-4o via governed AI call with `HIRING_AI_SCORING` feature flag), and analytics dashboard with Recharts visualizations. Dedicated pages for Interviews, Tasks, and Analytics.
*   **Punch List Module**: Dedicated project tab for tracking deficiency items during project closeout. Supports 17 trade types, 4 priority levels, and a 5-state status workflow. Features item CRUD with location, assignee, due date, photo/file attachments, priority-sorted list with filters, summary stats, detail/edit dialogs, PDF export, and RBAC-gated actions.
*   **Warranty / Post-Construction Module**: Project tab for tracking defects, warranty claims, callbacks, and recalls. Supports 4 case types, 6-state status lifecycle, 4 priority levels, per-case repair tasks with toggle-completion, ObjectUploader document attachments, status history audit trail, cost tracking, and HTML export.
*   **Company Overhead & Fixed Costs Manager**: Administration module for ADMIN/MANAGER/OFFICE_MANAGER roles to track fixed overhead costs. Features CRUD table of cost items, summary cards showing monthly/annual totals and calculated suggested overhead %, annual revenue target input, default bid overhead % setting, and auto-calculated suggestion.
*   **BIM Viewer (Phase 1)**: IFC file upload and 3D viewer in the Plans & Takeoff tab. Users upload `.ifc` files, which are rendered with orbit/pan/zoom controls, a model element tree panel, and an element properties panel. Client-side parsing via `web-ifc` WASM.
*   **Contractor Marketplace Directory**: Searchable, filterable public directory of organizations that have opted into the network. Accessible at `/marketplace` with three tabs: Contractor Directory, Crew Marketplace (coming soon), and Equipment Rentals (coming soon). Features per-org profile pages with about section, trade specialties, service areas, certifications, portfolio gallery, and star reviews.

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
*   **three, web-ifc**: For BIM/IFC 3D model viewing and client-side IFC parsing via WebAssembly.
*   **Recharts**: For data visualization charts.
*   **react-grid-layout**: For dashboard editor layout.
*   **QuickBooks Online**: For accounting integrations.
*   **Google Workspace (Gmail, Calendar)**: For email and calendar integrations.
*   **Microsoft 365 (Mail, Calendar)**: For email and calendar integrations.
*   **DocuSign**: For e-signature workflows.
*   **@node-saml/node-saml**: For SAML 2.0 Service Provider.