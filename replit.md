# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS construction management platform designed to manage the entire construction project lifecycle. It supports multiple contracting specialties with trade-specific customizations, centralizing project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform features a multi-tenant architecture with AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite of tools for project management, estimating, CRM, and compliance. The vision is to provide a robust, scalable solution that adapts to various construction trades, improving project outcomes and operational efficiency for its users.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform employs a modern web stack, prioritizing security, scalability, and user experience.

**Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
**Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
**Database**: PostgreSQL on Neon, managed with Drizzle ORM.
**Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, and Role-Based Access Control (RBAC) across ten user roles.
**Security**: Multi-layered protection including rate limiting, audit logging, file validation, and multi-tenant access control.

**Key Architectural Decisions & Features**:
*   **Multi-Tenant Architecture**: Supports distinct organizations with trade-specific configurations and AI-driven onboarding.
*   **Trade-Specific Features System**: Dynamic functionality based on an organization's trade type, including APIs, navigation, dashboards, and master scope of work items.
*   **Master Scope of Work (SOW) System**: Comprehensive database of master scope items across various trade templates, supporting user-defined additions.
*   **Comprehensive Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a guided Bid Cost Builder Workflow.
*   **AI Integration**: Features an AI Senior PM + CFO System for generation, analysis, scheduling, and automation. Includes AI Auto-Takeoff (OpenAI Vision), AI Scheduling Assistant, AI Jobsite Camera Analysis, AI Change Order Generator, and more.
*   **Takeoff & Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, and an enhanced material calculator with a preset system.
*   **Hierarchical Line Item Builder**: Progressive selection interface for adding estimate line items.
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing, rental equipment catalogs, and type-specific fields.
*   **Time-Clock System**: Native time-clock with GPS, shift management, labor hour tracking, and Manager Approval Workflow, with automated weekly payroll reports.
*   **Audit & Compliance**: Comprehensive audit logging and a system for managing Organization Documents with versioning and expiration tracking.
*   **Production Rate Tracking & Auto-Population**: Comprehensive production analytics system that tracks crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM). Integrates with AI for insights and natural language queries.
*   **Unified SOW Tracking System**: Ensures scope of work items remain consistently linked across the entire project lifecycle.
*   **Scope Standardization Auto-Seeding**: During onboarding, the system automatically populates global scope work type categories, work types, modifier categories, and modifiers based on the admin's selected trade type for 23 trade types.
*   **Unified Messaging System**: Single "Messages" page with tabbed navigation combining Team Messages and Portal Chat with real-time updates.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.
*   **White-Label Branding**: System-wide rebranding capabilities for the platform and PDF generation.
*   **Onboarding Walkthrough System**: Role-specific onboarding walkthroughs guided by an AI Assistant.
*   **Email AI System**: Comprehensive email management with AI-powered classification and task extraction across 15 categories, supporting major email providers.
*   **Subcontractor Payables Workflow System**: Automates payable creation upon subcontract completion with workflow, KPI dashboard, and role-based approvals.
*   **Website Builder System**: White-label website management with modules for Setup, Page Builder, Blog, Project Gallery, Social Media, Analytics, SEO, Media Library, AI Design Assistant, an **AI Website Wizard** that generates entire website structures, and a **Publishing Tab** with deployment status, publish/unpublish/maintenance controls, custom domain configuration with DNS verification, pre-publish checklist, publishing settings, and deployment history tracking.
*   **Labor Cost Rate Management System**: Calculates employee costs using job classifications, prevailing wage rates, burden rate configuration, and employee cost assignments.
*   **AI-Powered Bid Wizard**: Multi-step bid creation workflow featuring AI document analysis to extract project information and scope items from documents.
*   **Dashboard Customization System**: User dashboard personalization with admin-controlled permissions, editable widgets, customizable color schemes, and WCAG AA accessibility compliance.
*   **HUSTLER Multi-Organization System**: Specialized user role for business owners managing multiple organizations, with an organization switcher, executive dashboard, and AI-powered portfolio insights.
*   **Subcontractor Bid Request Network**: Platform-wide bid solicitation network allowing General Contractors to request bids from platform-member subcontractors.
*   **Unified Task Model**: Consolidates manual, email-originated, and AI-generated tasks.
*   **Operational Infrastructure**: Structured logging utility, monitoring hooks, health, and readiness probes.
*   **Subscription & Billing System**: 4-tier membership model with 6 add-ons, featuring backend and frontend feature gating. Includes Super Admin Subscription Management page at `/admin/subscriptions` with platform-wide stats (MRR, plan distribution, status breakdown), searchable/filterable subscription table, and detail dialogs for plan changes, status updates, and add-on management.
*   **Construction Calculator Suite**: Professional construction calculator with 10 specialized tools.
*   **Marketing Landing Page**: Comprehensive public landing page for unauthenticated visitors.
*   **User Profile Page**: Comprehensive profile management with editable personal info, skills management (including Skills & Certifications system with skill rating, verification, and automated expiry notifications), and Performance & History (employee overview, attendance, safety, quality, performance reviews).
*   **Subcontractor Portal System**: Secure token-based portal allowing subcontractors to access project documents without full platform accounts.
*   **Client Portal Chat System**: Asynchronous chat between portal users and internal team members with dual authentication, conversation threads, and notifications.
*   **Unified Portal Access Tab**: Client Portal and Subcontractor Portal management merged into a single "Portal Access" tab within project details.
*   **Workforce Management Page**: Unified page at `/manage-workers` with tabs for Workers (roster + KPI), Ratings, Rewards, and Analytics, including an integrated KPI Dashboard.
*   **Time Entries System Enhancements**: Rebuilt time-entry page with tabbed interface, table layout, filters, summary cards, and CSV export.
*   **Overtime Request System**: Allows workers to request overtime with manager approval workflow.
*   **Trade-Specific Cost Code Preset System**: CSI-based cost codes for 23 trade types.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management, event outbox pattern, webhook delivery, and provider registry. Supports QBO, Google, Microsoft, DocuSign, and Zapier.
*   **QuickBooks Online Sync**: OAuth 2.0 connection flow for Chart of Accounts import, Customer export, Invoice export from SOV, Payment status import. Includes dry-run and scheduled sync modes.
*   **Google Workspace Integration**: OAuth 2.0 for Gmail + Calendar with cursor-based incremental email ingestion.
*   **Microsoft 365 Integration**: OAuth 2.0 for Mail + Calendar via Graph API with delta query sync.
*   **E-Sign Integration**: DocuSign OAuth provider for sending COs and Subcontracts for signature, with status tracking and signed PDF storage.
*   **Zapier Webhook Integration**: Webhook-based provider connecting SmartManageAI to 5,000+ apps. Supports 16 outgoing event types (project, bid, CO, invoice, time, task, document, safety), HMAC-signed payloads, incoming webhook endpoints, webhook CRUD management, and per-webhook trigger tracking.
*   **AI Governance System**: Centralized `executeAiAction()` wrapper with per-org daily limits, audit trail, and safe modes.
*   **Approval Workflows Framework**: Generic approval system for various project elements (COs, SOV/Pay Apps, Time, Vendor Bills, E-sign, QBO exports).
*   **Document Control & Revisioning**: Sequential revision numbering, active/superseded status, source tracking.
*   **Project Health Score**: Deterministic 0-100 score from weighted inputs (schedule, budget, RFI/submittal, CO, safety) with snapshots for trending.
*   **Background Jobs Framework**: node-cron based job runner with outbox dispatcher and daily retention policy execution.
*   **Enterprise Procurement Readiness**: Suite of enterprise-grade features gated behind the `enterprise` plan tier with dedicated feature flags (`SSO`, `AUDIT_EXPORT`, `DATA_RETENTION`, `PRIVACY_COMPLIANCE`, `SESSION_MANAGEMENT`).
    *   **SSO / SAML 2.0 Support**: SAML 2.0 Service Provider using `@node-saml/node-saml`. Supports OKTA, Azure AD, OneLogin, and custom IdPs. Admin configures IdP metadata, certificate, and entity ID. SSO-only mode enforceable per org. Routes in `server/ssoRoutes.ts`, schema in `sso_configurations` table.
    *   **Session Security Hardening**: Active session tracking in `active_sessions` table with idle timeout enforcement, concurrent session limits, IP tracking, and device info. Users can view/revoke sessions. Configurable per org (timeout, max sessions).
    *   **Audit Log Export System**: Searchable/filterable audit log viewer with date range, entity type, action, and user filters. Export to CSV or JSON. Summary statistics (actions by type, activity counts). Routes in `server/auditExportRoutes.ts`, UI at `/audit-logs`.
    *   **Data Retention Policies**: Configurable retention periods per entity type (audit_logs, AI actions, documents, time entries, messages, file uploads) with DELETE/ARCHIVE/ANONYMIZE actions. Dry-run preview, manual execution, and automated daily cron at 2 AM. Routes in `server/retentionRoutes.ts`, schema in `retention_policies` table.
    *   **Privacy & Compliance Tooling (GDPR)**: Record of Processing Activities (ROPA) management per GDPR Article 30. Data Subject Request workflow (ACCESS, DELETION, PORTABILITY, RECTIFICATION, OBJECTION) with status tracking. User data export and anonymization capabilities. Routes in `server/privacyRoutes.ts`, schemas in `data_processing_records` and `data_subject_requests` tables.
    *   **Enterprise Settings Page**: Unified admin interface at `/enterprise-settings` with 4 tabs (SSO, Session Security, Data Retention, Privacy & Compliance), each gated by its respective feature flag via FeatureGate components.

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4 / GPT-4o**: Powers AI functionalities including Vision.
*   **Resend**: Transactional email service.
*   **JWT**: For secure authentication and authorization.
*   **Bcrypt**: For password hashing.
*   **Uppy**: For enhanced file uploads.
*   **node-cron**: For scheduling backend tasks.
*   **react-konva, konva, pdfjs-dist, xlsx**: Libraries for interactive drawing, PDF rendering, and document processing.
*   **Recharts**: Library for data visualization charts.
*   **QuickBooks Online**: For accounting integrations.
*   **Google Workspace (Gmail, Calendar)**: For email and calendar integrations.
*   **Microsoft 365 (Mail, Calendar)**: For email and calendar integrations.
*   **DocuSign**: For e-signature workflows.
*   **@node-saml/node-saml**: SAML 2.0 Service Provider for enterprise SSO.