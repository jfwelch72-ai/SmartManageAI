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
*   **Financial Management**: Budget vs Actual Cost Engine, CFO Cost Forecasting Dashboard, Live Project Profitability Tracking, Revenue Recognition & WIP Reporting, AIA Progress Billing.
*   **Subcontract Management**: Full subcontract lifecycle with SOV scope alignment, AIA G702/G703-style pay applications, and retention tracking.
*   **Procurement Module**: Full procure-to-pay lifecycle with automated 3-Way Match and RBAC approvals.
*   **Communication & Collaboration**: Unified Messaging System with Video Calling, Client Portal Chat, Subcontractor Portal System, and unified AI chat.
*   **Unified External Portal**: Single entry point (`/portal`) for Client, Subcontractor, and Vendor access with role-based auto-detection.
*   **Takeoff Cross-Module Connections**: Convert takeoff measurements to purchase requests, auto-detect version deltas for PCOs, generate SOV line items, and provide cost lifecycle summaries.
*   **Live Takeoff Collaboration**: Real-time multi-user collaboration on takeoff workspaces via WebSockets.
*   **Takeoff Data Engine & Versioning**: Rich linked data objects on measurements with full takeoff versioning and comparison views.
*   **Website Builder System**: White-label website management with AI Website Wizard, page builder, publishing controls, and SEO support.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, and feature flags.
*   **Integration Gating**: Feature flags (`VIDEO_CALLS`, `SMS_NOTIFICATIONS`) gate unconfigured third-party services. `/api/integration-status` endpoint reports configuration state. Video call button disables when LiveKit is not configured. SMS silently skips when Twilio is not configured.
*   **Structured Error Logging**: `error_logs` table captures production errors with stack trace, user context, route, and request ID. Global error handler and process-level uncaught exception/rejection handlers persist errors to the database.
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
*   **Feature Permissions System**: Granular per-user feature access control via boolean flags and role-based defaults for 8 consolidated roles. Includes Permission Presets and financial access controls.
*   **Peer Coworker Ratings**: Anonymous peer rating system for field workers with configurable anonymity and scope modes.
*   **RBAC (8-Role System)**: Consolidated role system including SUPER_ADMIN, ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER, VENDOR with defined hierarchies and alternate labels.
*   **Role-Based Sidebar Navigation**: Workflow-based sidebar grouping with unique group names and item assignments per role.
*   **Social Media Management System**: Content management with scheduling, AI generation, multi-platform support, and approval workflow.
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
*   **Punch List Module**: Tracking deficiency items during project closeout.
*   **Warranty / Post-Construction Module**: Tracking defects, warranty claims, callbacks, and recalls.
*   **Asset & Property Management**: Post-completion lifecycle with Asset Handover, Warranty Tracking, and Maintenance Logs.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, lifecycle tracking, and AI-powered risk suggestions.
*   **Location-Based Takeoff & Field Integration**: Hierarchical location system for organizing takeoff measurements, field takeoff tab for mobile progress tracking, and location cost breakdown.
*   **BIM Viewer**: IFC file upload and 3D viewer with element tree, properties, measurement tools, and split-view.
*   **LiDAR Scanner Module**: Upload, view, and analyze 3D point cloud scans (LAS/LAZ/PLY, E57 requires conversion) with a Three.js-based viewer, measurement tools, and BIM/IFC overlay.
*   **Contractor Marketplace Directory**: Searchable public directory of organizations.
*   **Leave Management Module**: Employee self-service and manager/HR views for leave management.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **Notion-Style Project Notes**: Block-based note editor in project detail with page management, block editor (headings, lists, to-do, dividers), and auto-save.

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
*   **three, web-ifc, laz-perf**
*   **Recharts**
*   **react-grid-layout**
*   **QuickBooks Online**
*   **Google Workspace (Gmail, Calendar)**
*   **Microsoft 365 (Mail, Calendar)**
*   **DocuSign**
*   **@node-saml/node-saml**