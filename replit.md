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
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation across various modules, governed by an AI Governance System for usage tracking, daily limits, and cost auditing. All AI calls are wrapped with `governedAiCall` for centralized limit enforcement and audit logging, with tier-aware limits.
*   **Project Lifecycle Management**: Comprehensive workflows covering Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a Unified SOW Tracking System.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder. Includes a 6-step bid workflow with a full takeoff workspace.
*   **Custom Cost Code Management**: Organization-level cost code management with CSI division grouping and custom code support.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment catalogs, and tracks insurance/compliance expiration. Includes a full 7-stage Sales Pipeline module with Kanban/list views, opportunity detail, and activity logging, governed by RBAC.
*   **Workforce Management**: Native time-clock with GPS/geofence validation, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, KPI dashboards, crew scheduling, employee deductions, pay stub generation, and Certified Payroll Reports (WH-347) generation. Includes a Unified Performance System for KPI-based employee ratings.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, an Approval Workflows Framework, and an Addenda Tracking System.
*   **Safety Training Management**: Full in-house safety training lifecycle, including program creation, assignment, tracking, digital acknowledgments, and PDF export for compliance and bid submission, accessible via dedicated module and worker profiles, with RBAC.
*   **Budget vs Actual Cost Engine**: Per-project cost code budget with real-time cost ledger aggregating committed and actual costs from all sources, grouped by CSI division, with variance alerts and an ADMIN/MANAGER editable budget editor.
*   **Live Project Profitability Tracking**: Automated real-time cost monitoring via a background cron job, recalculating costs vs adjusted budget, saving snapshots, and firing in-app notifications for significant variance thresholds. A "Live Financials" tab provides detailed financial overview and snapshot history for financial-access roles.
*   **Procurement Module**: Full procure-to-pay lifecycle covering Purchase Requests, Purchase Orders, Delivery Receipts, Vendor Invoices, and automated 3-Way Match, with RBAC-controlled approvals.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, token-protected staging preview links, and full SEO support.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, GDPR compliance, feature flags, and a 4-tier subscription model, including Super Admin tools.
*   **HTTP Security**: Helmet middleware for security headers and API log redaction.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, with security hardened via AES-256-GCM token encryption.
*   **Multi-Source Document Upload**: Supports local files, direct links, and integrated cloud storage services.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, UI for history and comparison, and in-app notifications.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Libraries System**: Provides reusable library management for custom items, assemblies, and saved takeoffs, with API for CRUD, bulk import, and trade-aware seeding.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets, and tiered default layouts based on user permissions. Includes organization-wide color scheme settings and 28 registered widget types, with specific role-gated widgets for labor utilization, project health, RFI status, pending change orders, and safety alerts. Dashboard response caching is implemented with an in-memory TTL cache.
*   **Performance Indexes**: Database indexes are optimized for frequently queried fields across `projects`, `bids`, `users`, and `calendar_events` tables to accelerate dashboard queries.
*   **Feature Permissions System**: Granular per-user feature access control with 8 permissions in 4 categories, enforced via backend middleware and frontend hooks.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Contractor Onboarding Library**: A hard-coded, normalized reference data system for trades, scopes, materials, formulas, and grammar, powering AI onboarding and dynamic UI components.
*   **Social Media Management System**: Comprehensive content management with scheduling, AI generation, multi-platform support, rich media picker, and approval workflow.
*   **Reports System**: Provides 9 report types across Takeoff and Estimate categories, with CSV export, browser print, and snapshot creation.
*   **Change Order Workflow Enhancement**: Includes revision history tracking and a multi-level approval chain.
*   **Approval Workflow Notifications**: In-app notifications across 6 approval workflows (Change Orders, Submittals, T&M Tickets, Overtime Requests, Subcontractor Payables, Unified Approval Center), notifying approvers and submitters.
*   **Vendor & Sub RFQ Flow**: Enables sending RFQ emails to subcontractors and material suppliers directly from bid steps, with tracking of RFQ status and in-app notifications for Bid Network events. Auto-sync updates internal `bidSubcontractorQuote` records from Bid Network responses.

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