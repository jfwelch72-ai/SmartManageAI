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
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing and rental equipment catalogs.
*   **Time-Clock System**: Native time-clock with GPS, shift management, labor hour tracking, and Manager Approval Workflow, with automated weekly payroll reports.
*   **Audit & Compliance**: Comprehensive audit logging and a system for managing Organization Documents with versioning and expiration tracking.
*   **Production Rate Tracking & Auto-Population**: Comprehensive production analytics system that tracks crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM). Integrates with AI for insights and natural language queries.
*   **Unified SOW Tracking System**: Ensures scope of work items remain consistently linked across the entire project lifecycle (Estimate → Project → Daily Progress → Production Rates → Schedule of Values).
*   **Scope Standardization Auto-Seeding**: During onboarding, the system automatically populates global scope work type categories, work types, modifier categories, and modifiers based on the admin's selected trade type. Covers 23 trade types with trade-specific templates. Idempotent seeding prevents duplicates across multiple org registrations.
*   **Unified Messaging System**: Single "Messages" page with tabbed navigation combining Team Messages (internal communication) and Portal Chat (subcontractor/client conversations) with combined unread badges in the sidebar. Real-time polling updates messages every 4 seconds and thread lists every 10 seconds across all chat interfaces.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.
*   **White-Label Branding**: System-wide rebranding capabilities for the platform and PDF generation.
*   **Onboarding Walkthrough System**: Role-specific onboarding walkthroughs guided by an AI Assistant.
*   **Email AI System**: Comprehensive email management with AI-powered classification and task extraction across 15 categories, supporting major email providers.
*   **Subcontractor Payables Workflow System**: Automates payable creation upon subcontract completion with workflow, KPI dashboard, and role-based approvals.
*   **Website Builder System**: White-label website management with modules for Setup, Page Builder, Blog, Project Gallery, Social Media, Analytics, SEO, Media Library, AI Design Assistant, and an **AI Website Wizard** that generates entire website structures based on company info and preferences. Includes Live Preview Sharing, Version History with diff previews, Soft Real-Time Presence, Conflict-Safe Saves, and Performance Monitoring.
*   **Labor Cost Rate Management System**: Calculates employee costs using job classifications, employee assignments, prevailing wage rates, annual salary categories, burden rate configuration (with component breakdown: taxes, benefits, insurance, overhead), and employee cost assignments with fully burdened cost and derived hourly rate computation.
*   **AI-Powered Bid Wizard**: Multi-step bid creation workflow featuring AI document analysis (OpenAI GPT-4o Vision) to extract project information and scope items from documents.
*   **Dashboard Customization System**: User dashboard personalization with admin-controlled permissions, editable widgets, customizable color schemes, and WCAG AA accessibility compliance.
*   **HUSTLER Multi-Organization System**: Specialized user role for business owners managing multiple organizations, with an organization switcher, executive dashboard, and AI-powered portfolio insights.
*   **Subcontractor Bid Request Network**: Platform-wide bid solicitation network allowing General Contractors to request bids from platform-member subcontractors.
*   **Unified Task Model**: Consolidates manual, email-originated, and AI-generated tasks.
*   **Operational Infrastructure**: Structured logging utility, monitoring hooks, health, and readiness probes.
*   **Subscription & Billing System**: 4-tier membership model with 6 add-ons, featuring backend and frontend feature gating.
*   **Construction Calculator Suite**: Professional construction calculator with 10 specialized tools (e.g., Concrete, Masonry, Lumber, Roofing, Tiling) including waste factor adjustment and cost estimation.
*   **Marketing Landing Page**: Comprehensive public landing page for unauthenticated visitors, showcasing features, pricing, and AI automation.
*   **User Profile Page**: Comprehensive profile management with editable personal info (name, phone, birthdate with calendar datepicker, timezone, trade/specialization, employment type, emergency contact), profile description, skills management (add/remove with search), avatar display, organization & access level display, photo upload section, and secure password change with token version rotation. Features a **Skills & Certifications** system with: 5-star skill rating matrix, skill verification workflow (request → manager approval → verified badge with clickable modal showing verifier name/role/date), certifications with file upload/issued/expiry dates/Active-Expired-Expiring Soon badges, automated expiry notifications (30 days and 5 days before), and equipment competency tags. Includes a **Performance & History** system with: employee overview (experience level, past projects, productivity tendencies), attendance logs with stats (Present/Absent/Late/Excused/Half Day), safety incident tracking (severity levels: Low/Medium/High/Critical), quality & rework history (categories: Rework/Defect/Material Waste/Specification Deviation), performance reviews with multi-dimension star ratings (productivity, quality, safety, communication, leadership), and superintendent-specific metrics (schedule adherence, cost control, subcontractor coordination, client/inspection outcomes). Manager roles (SUPERINTENDENT, MANAGER, OFFICE_MANAGER, ADMIN) can create records via API with org-level tenant isolation checks. DB tables: `employee_performance_profiles`, `attendance_logs`, `safety_incidents`, `quality_issues`, `performance_reviews`.
*   **Subcontractor Portal System**: Secure token-based portal allowing subcontractors to access project documents (RFIs, Submittals, Transmittals) without full platform accounts. Features bcrypt-hashed tokens, scoped permissions (view/comment/upload), activity logging, and email invitations via Resend. Includes GC-side management UI for inviting subs, revoking access, and monitoring portal activity. Extended with bid-phase document distribution for sending project documents to prospective subcontractors during bidding, with email tracking and optional portal access creation.
*   **Client Portal Chat System**: Asynchronous chat between portal users (subcontractors/clients) and internal team members. Features dual authentication (portal token-based for subs + email-based for clients + JWT team auth), conversation threads with subjects, internal notes (team-only visibility), priority flags (NORMAL/URGENT), status management (OPEN/CLOSED/ARCHIVED), unread tracking (separate portal/team counts), email notifications for portal users on team replies, in-app notifications for team on portal messages. Portal-side Chat tab in both sub-portal and client portal public pages, team-side as Portal Chat Inbox page with search/filter. Routes in `server/portalChatRoutes.ts`, schema tables `portal_chat_threads` and `portal_chat_messages`. Client portal routes use `/api/client-portal/chat/*` with `x-client-email` and `x-client-project-id` headers.
*   **Unified Portal Access Tab**: In project detail, Client Portal management and Subcontractor Portal management are merged into a single "Portal Access" tab with inner sub-tabs for each portal type.

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

## Recent Changes
*   **2026-02-19**: Merged "Manage Workers" and "Performance & Rewards" into unified "Workforce Management" page at `/manage-workers`. Tabbed layout: Workers (roster + KPI, managers only), Ratings, Rewards, Analytics. Sidebar entry renamed to "Workforce Management" with access broadened to all contractor roles. Old `/performance` route removed.
*   **2026-02-19**: Added KPI Dashboard to Workers tab with summary cards, attendance distribution pie chart, performance trend line chart, safety & quality bar chart, and top performers list. Backend endpoint: `GET /api/auth/manage-workers/kpi-dashboard`.
*   **2026-02-19**: Made "Add Evaluation" and "Update Skills" buttons functional on worker detail page. Add Evaluation uses multi-dimension star ratings. Update Skills via `POST/DELETE/PATCH /api/auth/manage-workers/:id/skills`.
*   **2026-02-19**: Enhanced Time Entries system: Fixed shift approval numeric overflow bug (precision 4→8), added 24h safety cap. Rebuilt time-entry page with tabbed interface (Entries/Weekly Summary/Add Entry), table layout, edit/delete dialogs, bulk approve, reject workflow, project/status/date filters, summary cards, and CSV export. Added summary stats cards to Time Clock Manager page. New backend endpoint: `GET /api/time-entries/export`. New frontend hooks: `useUpdateTimeEntry`, `useDeleteTimeEntry`.