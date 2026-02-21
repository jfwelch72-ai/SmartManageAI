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
*   **AI Integration**: Features an AI Senior PM + CFO System for generation, analysis, scheduling, and automation. Includes AI Auto-Takeoff (OpenAI Vision), AI Scheduling Assistant, AI Jobsite Camera Analysis, and AI Change Order Generator, among other AI modules.
*   **Takeoff & Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, and an enhanced material calculator with a preset system.
*   **Hierarchical Line Item Builder**: Progressive selection interface for adding estimate line items, supporting both "Guided Selection" and "Manual Entry" modes.
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing, rental equipment catalogs, and type-specific fields (License #, Bonding Capacity, Trade Specialty, Material Categories, Service Category, Equipment Category, Rental Terms, Company Represented). Features a 4-card status dashboard (Total Orgs, Active, Compliance Issues, Inactive), mobile-friendly organization card layout, and conditional form fields based on entity type.
*   **Time-Clock System**: Native time-clock with GPS, shift management, labor hour tracking, and Manager Approval Workflow, with automated weekly payroll reports.
*   **Audit & Compliance**: Comprehensive audit logging and a system for managing Organization Documents with versioning and expiration tracking.
*   **Production Rate Tracking & Auto-Population**: Comprehensive production analytics system that tracks crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM). Integrates with AI for insights and natural language queries.
*   **Unified SOW Tracking System**: Ensures scope of work items remain consistently linked across the entire project lifecycle (Estimate → Project → Daily Progress → Production Rates → Schedule of Values).
*   **Scope Standardization Auto-Seeding**: During onboarding, the system automatically populates global scope work type categories, work types, modifier categories, and modifiers based on the admin's selected trade type. Covers 23 trade types with trade-specific templates.
*   **Unified Messaging System**: Single "Messages" page with tabbed navigation combining Team Messages (internal communication) and Portal Chat (subcontractor/client conversations) with real-time updates.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.
*   **White-Label Branding**: System-wide rebranding capabilities for the platform and PDF generation.
*   **Onboarding Walkthrough System**: Role-specific onboarding walkthroughs guided by an AI Assistant.
*   **Email AI System**: Comprehensive email management with AI-powered classification and task extraction across 15 categories, supporting major email providers.
*   **Subcontractor Payables Workflow System**: Automates payable creation upon subcontract completion with workflow, KPI dashboard, and role-based approvals.
*   **Website Builder System**: White-label website management with modules for Setup, Page Builder, Blog, Project Gallery, Social Media, Analytics, SEO, Media Library, AI Design Assistant, and an **AI Website Wizard** that generates entire website structures.
*   **Labor Cost Rate Management System**: Calculates employee costs using job classifications, prevailing wage rates, burden rate configuration, and employee cost assignments.
*   **AI-Powered Bid Wizard**: Multi-step bid creation workflow featuring AI document analysis (OpenAI GPT-4o Vision) to extract project information and scope items from documents.
*   **Dashboard Customization System**: User dashboard personalization with admin-controlled permissions, editable widgets, customizable color schemes, and WCAG AA accessibility compliance.
*   **HUSTLER Multi-Organization System**: Specialized user role for business owners managing multiple organizations, with an organization switcher, executive dashboard, and AI-powered portfolio insights.
*   **Subcontractor Bid Request Network**: Platform-wide bid solicitation network allowing General Contractors to request bids from platform-member subcontractors.
*   **Unified Task Model**: Consolidates manual, email-originated, and AI-generated tasks.
*   **Operational Infrastructure**: Structured logging utility, monitoring hooks, health, and readiness probes.
*   **Subscription & Billing System**: 4-tier membership model with 6 add-ons, featuring backend and frontend feature gating.
*   **Construction Calculator Suite**: Professional construction calculator with 10 specialized tools including waste factor adjustment and cost estimation.
*   **Marketing Landing Page**: Comprehensive public landing page for unauthenticated visitors, showcasing features, pricing, and AI automation.
*   **User Profile Page**: Comprehensive profile management with editable personal info, skills management, avatar display, organization & access level, photo upload, and secure password change. Includes **Skills & Certifications** system with 5-star skill rating matrix, skill verification workflow, certifications with file upload/expiry dates, and automated expiry notifications. Features a **Performance & History** system with employee overview, attendance logs, safety incident tracking, quality & rework history, and performance reviews.
*   **Subcontractor Portal System**: Secure token-based portal allowing subcontractors to access project documents (RFIs, Submittals, Transmittals) without full platform accounts. Features bcrypt-hashed tokens, scoped permissions, activity logging, and email invitations. Extended with bid-phase document distribution.
*   **Client Portal Chat System**: Asynchronous chat between portal users (subcontractors/clients) and internal team members. Features dual authentication, conversation threads with subjects, internal notes, priority flags, status management, unread tracking, email notifications, and in-app notifications.
*   **Unified Portal Access Tab**: In project detail, Client Portal management and Subcontractor Portal management are merged into a single "Portal Access" tab with inner sub-tabs for each portal type.
*   **Workforce Management Page**: Unified page at `/manage-workers` with tabs for Workers (roster + KPI, managers only), Ratings, Rewards, and Analytics.
*   **KPI Dashboard**: Integrated into Workers tab with summary cards, attendance distribution, performance trend, safety & quality bar chart, and top performers list.
*   **Time Entries System Enhancements**: Rebuilt time-entry page with tabbed interface (Entries/Weekly Summary/Add Entry), table layout, edit/delete dialogs, bulk approve, reject workflow, project/status/date filters, summary cards, and CSV export.
*   **Overtime Request System**: Allows workers to request overtime with manager approval workflow and status tracking.
*   **Trade-Specific Cost Code Preset System**: CSI-based cost codes for 23 trade types, integrated via a reusable `CostCodeCombobox` component.

### Enterprise Upgrade Wave (February 2026)

*   **Integration Hub**: Provider-agnostic framework at `/server/integrations/` with centralized connection management, event outbox pattern, webhook delivery, and provider registry. Supports QBO, Google, Microsoft, and DocuSign providers. 11 new feature flags (all default OFF, org-scoped, SUPER_ADMIN toggleable). 8 new database tables. Routes at `/api/integrations/*`. UI at `/integrations`.
*   **QuickBooks Online Sync**: OAuth 2.0 connection flow, Chart of Accounts import, Customer export, Invoice export from SOV, Payment status import. Dry-run and scheduled sync modes. Provider at `/server/integrations/providers/qbo/`.
*   **Google Workspace Integration**: OAuth 2.0 for Gmail + Calendar. Cursor-based incremental email ingestion. Provider at `/server/integrations/providers/google/`.
*   **Microsoft 365 Integration**: OAuth 2.0 for Mail + Calendar via Graph API. Delta query sync. Provider at `/server/integrations/providers/microsoft/`.
*   **E-Sign Integration**: DocuSign OAuth provider for sending COs and Subcontracts for signature. Status tracking, signed PDF storage as document revision. Provider at `/server/integrations/providers/esign/`.
*   **AI Governance System**: Centralized `executeAiAction()` wrapper with per-org daily limits (actions, tokens, cost by plan tier), audit trail in `ai_action_audit` table, safe modes (draft-only, approval-required). Service at `/server/services/aiGovernance.ts`. Routes at `/api/ai-governance/*`. UI at `/ai-governance`.
*   **Approval Workflows Framework**: Generic approval system for COs, SOV/Pay Apps, Time, Vendor Bills, E-sign, QBO exports. Service at `/server/services/approvalService.ts`. Routes at `/api/approvals/*`. UI at `/approvals`.
*   **Document Control & Revisioning**: Sequential revision numbering, active/superseded status, source tracking (upload/email/import/esign). Service at `/server/services/documentRevisionService.ts`. Routes at `/api/documents/*`.
*   **Project Health Score**: Deterministic 0-100 score from weighted inputs (schedule, budget, RFI/submittal, CO, safety). Snapshots for trending. Service at `/server/services/projectHealthService.ts`. Routes at `/api/project-health/*`.
*   **Background Jobs Framework**: node-cron based job runner at `/server/jobs/` with outbox dispatcher polling every 2 minutes.
*   **Planning Documentation**: 12 specification documents in `/planning/` directory covering architecture decisions (8 ADRs), per-module specs, security/test plan, and rollout strategy.
*   **Test Harness**: Skeleton test files in `/audit/tests/integrations/` and `/audit/tests/rbac/` for org isolation, RBAC matrix, outbox dispatcher, QBO sync, email ingestion, document revisions, and approvals.

### Dev Testing Infrastructure (February 2026)

*   **Dev Seed Endpoint**: `POST /api/dev/seed-enterprise` (dev-only, Admin+ role required) populates enterprise subscription, add-ons, simulated integration connections, AI audit entries, approval requests, document revisions, and project health snapshots.
*   **OAuth Dev Bypass**: `POST /api/integrations/connections` accepts `devMode: true` in dev to create simulated active connections without real OAuth.
*   **Project Health Widget**: `client/src/components/ProjectHealthWidget.tsx` displays project health score (0-100) with breakdown bars on the project detail Overview tab.
*   **Test Flow**: Login as Admin → POST `/api/dev/seed-enterprise` → Navigate to `/integrations`, `/approvals`, `/ai-governance` → Verify data displays. Open any project → Overview tab → See health score widget.

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