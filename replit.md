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
*   **Estimating Engine**: Advanced takeoff workspace with interactive drawing tools, material calculation, hierarchical line item builder, and a 6-step bid workflow. Includes competitive drawing enhancements like undo-last-point, running measurement display, continuous linear mode, intersection snap, batch operations, and quantity delta reports. Features real-time multi-user collaboration via WebSockets and full takeoff versioning.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline.
*   **Workforce Management**: Native time-clock (GPS/geofence), shift management with cost code tracking, labor hour tracking, Manager Approval Workflow, configurable overtime rules engine, KPI dashboards, and Certified Payroll Reports.
*   **Compliance & Audit**: Audit logging, document management (versioning, expiration), Approval Workflows Framework, and Addenda Tracking.
*   **Financial Management**: Budget vs Actual Cost Engine, CFO Cost Forecasting Dashboard, Live Project Profitability Tracking, Revenue Recognition & WIP Reporting, AIA Progress Billing.
*   **Subcontract Management**: Full subcontract lifecycle with SOV scope alignment, AIA G702/G703-style pay applications, and retention tracking.
*   **Procurement Module**: Full procure-to-pay lifecycle with automated 3-Way Match and RBAC approvals.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, and unified AI chat.
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Website Builder System**: White-label website management with AI Website Wizard, page builder, publishing controls, and SEO support.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **Integration Gating**: Feature flags gate unconfigured third-party services, providing graceful degradation (e.g., video call button disables if LiveKit is not configured).
*   **Structured Error Logging**: Captures production errors with stack trace, user context, route, and request ID to a dedicated table.
*   **Consolidated Startup Migrations**: Idempotent schema migration checks managed by a single categorized runner (`runStartupMigrations.ts`) with 23 steps across 4 categories (CREATE_TABLE, ADD_COLUMN, ADD_ENUM, ALTER_TABLE). Includes automatic schema drift detection (`schemaDriftDetector.ts`) that warns when Drizzle-defined tables are missing from the database. Note: `drizzle-kit push` is unreliable with this schema size (300+ tables); the startup ensure* scripts are the authoritative migration mechanism.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management, including STACK CT integration.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, history, and comparisons.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Auto Change Orders from Takeoff Deltas**: Automatic generation of draft PCOs from detected quantity/cost deltas in superseded takeoff sheets.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service (email, web push, SMS, Teams, Slack) with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Account Settings Hub**: Unified settings page (`/settings`) with URL-based sidebar routing.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer.
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags and role-based defaults for 8 consolidated roles, including Permission Presets and audit logging.
*   **Peer Coworker Ratings**: Anonymous peer rating system for field workers.
*   **RBAC (8-Role System)**: Consolidated role system with defined hierarchies and alternate labels.
*   **Role-Based Sidebar Navigation**: Workflow-based sidebar grouping with unique group names and item assignments per role.
*   **Crew Dispatch Board**: Visual weekly grid for managing crew-to-project assignments (crews as rows, days as columns), with drag-and-drop reassignment, conflict detection, unassigned crew highlighting, and day/week/2-week views. RBAC-gated via `hasDispatchAccess`.
*   **Social Media Management System**: Content management with scheduling, AI generation, 7-platform support (Facebook, Instagram, LinkedIn, Twitter/X, TikTok, YouTube, Pinterest), approval workflow, and engagement analytics (likes, comments, shares, reach) with periodic sync.
*   **BIM Quantity Extraction**: Client-side IFC file parsing for building element quantity extraction.
*   **Contract Management Lifecycle**: Full contract lifecycle with E-Signature Integration and AI-Powered Risk Analysis.
*   **Clause Library & Template Builder**: Organization-scoped reusable contract clause management and template assembly.
*   **CPM Schedule Management Engine**: Full Critical Path Method (CPM) scheduling with forward/backward pass, float calculation, critical path identification, and resource loading.
*   **Change Order Workflow Enhancement**: Revision history and multi-level approval chain with AI auto-suggestion.
*   **Cost Overrun Prediction Engine**: Burn-rate trend analysis, confidence-scored predictions, and early warnings on CFO dashboard.
*   **Subcontractor Recommendation Engine**: Ranks subcontractors by composite score from performance history, vendor ratings, and contract track record.
*   **Hiring Module (ATS)**: Applicant Tracking System with job posting, candidate pipeline, interview scheduling, and AI candidate scoring.
*   **Talent Pool & Connected Hiring-Marketplace**: Self-service talent profiles with AI-powered skill match.
*   **Task Detail Modal**: Comprehensive task detail view with subtasks, comments, activity log, and inline actions.
*   **Permits & Licenses Tracking**: Full lifecycle tracking (Applied → Under Review → Approved → Active → Expired → Renewed) with 10 permit types, expiry date monitoring, dashboard alerts for permits expiring within 30 days, and inspection linking. Located as a tab in Project Detail under Field Operations.
*   **QC Material Testing Log**: Material test tracking within QA/QC (Inspections tab) with 7 pre-populated test types (Concrete Cylinder Break, Soil Compaction, Steel Tensile, Aggregate Gradation, Asphalt Core, Moisture Content, Rebar Mill Cert), pass/fail status, auto-generated punch list items on failure, and lab report tracking.
*   **PPE Compliance Tracker**: Per-project PPE compliance logging in Safety Training tab with 6 PPE types (Hard Hat, Safety Vest, Gloves, Eye Protection, Steel Toes, Fall Protection), compliance/violation status, stats dashboard, and date/type/status filtering.
*   **Safety Officer Assignment**: Project-level safety officer assignment dropdown in Safety Training tab with org user selection and display.
*   **Punch List Module**: Tracking deficiency items during project closeout.
*   **Warranty / Post-Construction Module**: Tracking defects, warranty claims, callbacks, and recalls.
*   **Asset & Property Management**: Post-completion lifecycle with Asset Handover, Warranty Tracking, and Maintenance Logs.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, lifecycle tracking, and AI-powered risk suggestions.
*   **Location-Based Takeoff & Field Integration**: Hierarchical location system for organizing takeoff measurements, field takeoff tab for mobile progress tracking, and location cost breakdown.
*   **BIM Viewer**: IFC file upload and 3D viewer with element tree, properties, measurement tools, and split-view.
*   **LiDAR Scanner Module**: Upload, view, and analyze 3D point cloud scans with a Three.js-based viewer, measurement tools, and BIM/IFC overlay.
*   **Contractor Marketplace Directory**: Searchable public directory of organizations.
*   **Leave Management Module**: Employee self-service and manager/HR views for leave management.
*   **Site Mobilization & Method Statements**: Structured site mobilization checklists with default items (10 categories) and method statement templates with Draft→Submitted→Approved workflow and schedule task linking.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **Notion-Style Project Notes**: Block-based note editor in project detail with page management, block editor, and auto-save.
*   **Performance & Security Patterns**: Includes 4-tier rate limiting, opt-in pagination for list endpoints, N+1 query prevention strategies, and DB health check monitoring.
*   **Production Hardening**: Zod validation on all financial route mutations, structured error logging (no silent catch blocks), safe financial math utilities (roundCurrency, safeDivide), pagination utility, and notification framework integration for scheduled reports.
*   **Email Marketing Campaigns**: Full email campaign lifecycle with template management, contact lists, bulk sending via Resend, scheduling, and campaign analytics (open/click/bounce tracking).
*   **Website Builder DNS Verification**: Real DNS lookup verification for custom domains (CNAME and A record validation) with actionable error messages.
*   **Unified Payment & Invoice Tracking**: Cross-billing-type payment recording system (`unified_payments` table) covering AIA pay apps, T&M invoices, and general invoices. Includes AR summary with aging buckets (current, 30-day, 60-day, 90+ day), CFO dashboard AR widget, T&M payment recording UI, and AI snapshot builder integration for real `totalReceived` and `overdueInvoices` data.

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