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
*   **Authentication**: JWT-based (httpOnly cookies), bcrypt, RBAC, OAuth (Google, Apple), CSRF protection, and Passkey (WebAuthn).

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: AI-driven onboarding and dynamic features for specific trade types, with trade-aware feature presets.
*   **AI Integration**: AI for generation, analysis, scheduling, and automation across modules, governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows including Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking, Contract Management, and CPM Scheduling.
*   **Estimating Engine**: Advanced takeoff workspace with interactive drawing tools, material calculation, hierarchical line item builder, 6-step bid workflow, real-time multi-user collaboration, and full takeoff versioning. Includes auto-generation of draft PCOs from takeoff deltas.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline.
*   **Workforce Management**: Native time-clock (GPS/geofence), shift management with cost code tracking, labor hour tracking, Manager Approval Workflow, configurable overtime rules engine, KPI dashboards, Certified Payroll Reports, Crew Dispatch Board, Leave Management, and Peer Coworker Ratings.
*   **Compliance & Audit**: Audit logging, document management (versioning, expiration), Approval Workflows Framework, Addenda Tracking, Permits & Licenses Tracking, PPE Compliance Tracker, QC Material Testing Log.
*   **Financial Management**: Budget vs Actual Cost Engine, CFO Cost Forecasting Dashboard, Live Project Profitability Tracking, Revenue Recognition & WIP Reporting, AIA Progress Billing, Procurement Module with 3-Way Match, and Unified Payment & Invoice Tracking.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, unified AI chat, and Notion-style project notes.
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Website Builder System**: White-label website management with AI Website Wizard, page builder, publishing controls, and DNS verification.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **Integration Gating**: Feature flags gate unconfigured third-party services, providing graceful degradation.
*   **Structured Error Logging**: Captures production errors with stack trace, user context, route, and request ID.
*   **Consolidated Startup Migrations**: Idempotent schema migration checks managed by a single runner with automatic schema drift detection.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher and job registry.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Account Settings Hub**: Unified settings page with URL-based sidebar routing.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer.
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags and role-based defaults for 8 consolidated roles.
*   **BIM & LiDAR Integration**: Client-side IFC file parsing for quantity extraction, 3D BIM Viewer, and LiDAR Scanner Module for point cloud analysis.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, and AI-powered risk suggestions.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **Performance & Security Patterns**: Includes 4-tier rate limiting, opt-in pagination, N+1 query prevention, DB health check monitoring, Zod validation on all POST/PATCH/PUT routes via shared `validateBody` helper (`server/utils/validation.ts`), safe financial math utilities, password complexity policy, PATCH route immutable-field stripping, DB pool sized for concurrency (max 60), 8s TTL auth-middleware user cache (`authUserCache` in `server/auth.ts` with auto-eviction and `invalidateAuthCache` on token revocation), size-capped org-scoped cache (max 5000 entries with periodic cleanup in `server/cache.ts`), parallelized dashboard COUNT queries via `Promise.all`, and SQL-side `SUM`/`GROUP BY` for procurement aggregation.
*   **Dashboard Widget Permission Guards**: All dashboard widgets gate their API calls with `enabled` permission checks (`useFeaturePermission` or role-based) to prevent unauthorized fetches. Pattern: `enabled: hasPermission` in `useQuery`.
*   **Email Marketing Campaigns**: Full email campaign lifecycle with template management, contact lists, bulk sending, scheduling, and analytics.
*   **Empty States & Mobile Polish**: Reusable `EmptyState` component (`client/src/components/EmptyState.tsx`) with icon, title, description, optional CTA button, and testId prop. Applied across Projects, Bids, CRM, Procurement, Permits, Crews, Users/Team, Contracts, Equipment, Tasks, Leave Management, Approvals, Email Campaigns, and project tabs (Change Orders, RFIs, Submittals, Subcontractors). All `DialogContent` components use `sm:max-w-*` for mobile-first full-screen dialogs (`< sm`) and centered on desktop. CRM tabs are horizontally scrollable on mobile.

## External Dependencies
*   PostgreSQL (Neon)
*   Replit Object Storage (Google Cloud Storage backend)
*   OpenAI GPT-4 / GPT-4o
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
*   @node-saml/node-saml