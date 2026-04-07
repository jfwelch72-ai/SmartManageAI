# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to centralize and streamline the entire construction project lifecycle for various trades. It aims to enhance efficiency, ensure compliance, and provide comprehensive oversight through AI-driven features, dynamic navigation, trade-specific dashboards, and a full suite of tools for project management, estimating, CRM, compliance, and workforce management. The platform seeks to deliver a robust, scalable solution that improves project outcomes and operational efficiency within the construction industry.

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
*   **Multi-Tenancy & Customization**: AI-driven onboarding and dynamic features for specific trade types.
*   **AI Integration**: AI for generation, analysis, scheduling, and automation across modules, governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows including Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, hierarchical line item builder, 6-step bid workflow, full takeoff workspace with advanced features like Assembly Expansion and Polygon Deductions.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline.
*   **Workforce Management**: Native time-clock (GPS/geofence), shift management with cost code tracking, labor hour tracking, Manager Approval Workflow, configurable overtime rules engine, KPI dashboards, and Certified Payroll Reports.
*   **Compliance & Audit**: Audit logging, document management (versioning, expiration), Approval Workflows Framework, and Addenda Tracking.
*   **Budget vs Actual Cost Engine**: Per-project cost code budget with real-time cost ledger, variance alerts, and construction-grade forecasting.
*   **CFO Cost Forecasting Dashboard**: Portfolio-level FFC vs Budget summary and consolidated budget alerts.
*   **Live Project Profitability Tracking**: Automated real-time cost monitoring.
*   **Subcontract Management**: Full subcontract lifecycle with SOV scope alignment, AIA G702/G703-style pay applications, and retention tracking.
*   **Procurement Module**: Full procure-to-pay lifecycle with automated 3-Way Match and RBAC approvals.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, and unified AI chat (combined assistant help + natural language data queries in a single conversation).
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Takeoff Cross-Module Connections**: Convert takeoff measurements to purchase requests, auto-detect version deltas for PCOs, generate SOV line items, and provide cost lifecycle summaries.
*   **Live Takeoff Collaboration**: Real-time multi-user collaboration on takeoff workspaces via WebSockets.
*   **Takeoff Data Engine & Versioning**: Rich linked data objects on measurements with full takeoff versioning and comparison views.
*   **Website Builder System**: White-label website management with AI Website Wizard, page builder, publishing controls, and SEO support.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, history, and comparisons.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Auto Change Orders from Takeoff Deltas**: Automatic generation of draft PCOs from detected quantity/cost deltas in superseded takeoff sheets.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service (email, web push, SMS, Teams, Slack) with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Account Settings Hub**: Unified settings page (`/settings`) merging Profile and Settings, with URL-based sidebar routing for various sections.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer.
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags in `user_dashboard_permissions` table, with role-based defaults for 8 consolidated roles. Includes Permission Presets system (`permission_presets` table) with built-in role-specific presets and support for custom org-scoped presets. Includes `canSubmitPeerRatings` and `canViewPeerRatings` flags. Financial permissions use a single `financialsAccess` text enum column (`"none" | "view" | "manage"`) — backend derives `canViewFinancials` and `canEditFinancials` booleans at runtime so route guards work unchanged. UI shows a dropdown (None/View/Manage) instead of checkboxes. Role hierarchy utilities (`ROLE_HIERARCHY`, `rolesAtOrAbove()`, `rolesAtOrBelow()`, `isRoleAtOrAbove()`) in both server (`server/dashboardRoutes.ts`) and client (`client/src/lib/rbac.ts`). Manager role has "Project Manager" display alias via `ROLE_ALTERNATE_LABELS`.
*   **Peer Coworker Ratings**: Anonymous peer rating system where field workers can rate coworkers on Teamwork, Reliability, Communication, and Helpfulness (1-5 stars) with optional comments. Features include: org-level anonymity mode (fully anonymous or managers can see), scope mode (project/crew only or org-wide), one-rating-per-coworker-per-month limit, aggregated score display on worker profiles. Schema: `peer_ratings` table with unique constraint on `(organization_id, rater_id, ratee_id, period)`. Org settings: `peer_rating_anonymity_mode` and `peer_rating_scope_mode` columns on organizations table. API routes in `server/peerRatingRoutes.ts`. Frontend: `/rate-coworkers` page (tabs: Rate Others + My Scores, gated by `canSubmitPeerRatings`/`canViewPeerRatings` permissions), peer scores in worker detail Performance tab, admin settings in Organization Settings. Sidebar nav item in Team group (Admin/Manager), Crew group (Superintendent), Info group (Field Worker).
*   **RBAC (8-Role System)**: Consolidated from 18 roles to 8: SUPER_ADMIN, ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER, VENDOR. Migration mapping: OFFICE_MANAGER/HR_MANAGER/SALES/MARKETING/PROCUREMENT_MANAGER→MANAGER, SAFETY_MANAGER/DISPATCHER→SUPERINTENDENT, PROJECT_ENGINEER→ESTIMATOR, MAINTENANCE_MANAGER/EQUIPMENT_MANAGER/HOURLY_EMPLOYEE→FIELD_WORKER. Migration file: `migrations/0025_consolidate_roles_and_permissions.sql`.
*   **Role-Based Sidebar Navigation**: Workflow-based sidebar grouping via `getWorkflowGroups()` and `getVisibleGroupItems()` in `client/src/lib/rbac.ts`. Each role has unique group names reflecting daily workflow: Admin/Hustler (Home, Sales, Projects, Team, Time, Finance, Field Ops, Settings, Marketing, Tools), Manager (same groups, different item assignments), Superintendent (Today, Crew, Jobsite, Review, Reference, Tools), Estimator (Home, Bids, Costs, Projects, Field Ops, Reports, Tools), Field Worker (Today, Projects, Info, Tools — flat list, no collapsible groups). All nav items defined in flat `NavItems` record; per-role `WorkflowGroup[]` arrays specify item assignments per group. `NavigationConfig` preserved for backward compatibility with AppHeader. Messages item shows unread badge. Executive Digest has its own `/executive-digest` route (distinct from CFO Dashboard).
*   **Social Media Management System**: Content management with scheduling, AI generation, multi-platform support, and approval workflow.
*   **BIM Quantity Extraction**: Client-side IFC file parsing using web-ifc for building element quantity extraction.
*   **Contract Management Lifecycle**: Full contract lifecycle with E-Signature Integration and AI-Powered Risk Analysis.
*   **Clause Library & Template Builder**: Organization-scoped reusable contract clause management and template assembly.
*   **CPM Schedule Management Engine**: Full Critical Path Method (CPM) scheduling with forward/backward pass, float calculation, critical path identification, and resource loading.
*   **Change Order Workflow Enhancement**: Revision history and multi-level approval chain with AI auto-suggestion.
*   **Cost Overrun Prediction Engine**: Burn-rate trend analysis, confidence-scored predictions, and early warnings on CFO dashboard.
*   **Subcontractor Recommendation Engine**: Ranks subcontractors by composite score from performance history, vendor ratings, and contract track record.
*   **Hiring Module (ATS)**: Applicant Tracking System with job posting, candidate pipeline, interview scheduling, and AI candidate scoring.
*   **Talent Pool & Connected Hiring-Marketplace**: Self-service talent profiles with AI-powered skill match.
*   **Task Detail Modal**: Comprehensive task detail view with subtasks, comments, activity log, and inline actions.
*   **Punch List Module**: Tracking deficiency items during project closeout.
*   **Warranty / Post-Construction Module**: Tracking defects, warranty claims, callbacks, and recalls.
*   **Asset & Property Management**: Post-completion lifecycle with Asset Handover, Warranty Tracking, and Maintenance Logs.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, lifecycle tracking, and AI-powered risk suggestions.
*   **Location-Based Takeoff & Field Integration**: Hierarchical location system for organizing takeoff measurements, field takeoff tab for mobile progress tracking, and location cost breakdown.
*   **BIM Viewer**: IFC file upload and 3D viewer with element tree, properties, measurement tools, and split-view.
*   **Contractor Marketplace Directory**: Searchable public directory of organizations.
*   **Leave Management Module**: Employee self-service and manager/HR views for leave management.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **AIA Progress Billing Engine**: Full AIA G702/G703 progress billing system based on SOV module.
*   **Revenue Recognition & WIP Reporting**: Cost-to-cost method revenue recognition engine with per-project WIP analysis, standalone WIP Schedule Report page, monthly snapshots, and historical comparison.

## External Dependencies
*   **PostgreSQL (Neon)**
*   **Replit Object Storage (Google Cloud Storage backend)**
*   **OpenAI GPT-4 / GPT-4o**
*   **Resend**
*   **JWT**
*   **Bcrypt**
*   **Uppy**
*   **node-cron**
*   **react-konva, konva, pdfjs-dist, xlsx**
*   **three, web-ifc**
*   **Recharts**
*   **react-grid-layout**
*   **QuickBooks Online**
*   **Google Workspace (Gmail, Calendar)**
*   **Microsoft 365 (Mail, Calendar)**
*   **DocuSign**
*   **@node-saml/node-saml**