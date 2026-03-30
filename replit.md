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
*   **Project Lifecycle Management**: Comprehensive workflows including Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking, and Unified SOW Tracking.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, hierarchical line item builder, 6-step bid workflow, full takeoff workspace, 3-Layer Modifier Selector, vendor pricebook integration, Bid Leveling, Historical Cost Database, and Assembly Integration.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment, insurance/compliance tracking, and a 7-stage Sales Pipeline.
*   **Workforce Management**: Native time-clock (GPS/geofence with OFF/WARN/BLOCK enforcement), shift management with cost code tracking, labor hour tracking, Manager Approval Workflow, Overtime Request, configurable overtime rules engine, KPI dashboards, crew scheduling, employee deductions, pay stub generation, Certified Payroll Reports, and cost ledger postings.
*   **Compliance & Audit**: Audit logging, document management (versioning, expiration), Approval Workflows Framework, and Addenda Tracking.
*   **Budget vs Actual Cost Engine**: Per-project cost code budget with real-time cost ledger, variance alerts, construction-grade forecasting, and configurable alert thresholds.
*   **CFO Cost Forecasting Dashboard**: Portfolio-level FFC vs Budget summary and consolidated budget alerts.
*   **Live Project Profitability Tracking**: Automated real-time cost monitoring via background cron job with in-app notifications.
*   **Subcontract Management**: Full subcontract lifecycle with SOV scope alignment, AIA G702/G703-style pay applications, retention tracking, performance scorecards, and document attachments.
*   **Procurement Module**: Full procure-to-pay lifecycle with automated 3-Way Match and RBAC approvals.
*   **Communication & Collaboration**: Unified Messaging System, Client Portal Chat, and Subcontractor Portal System.
*   **Live Takeoff Collaboration**: Real-time multi-user collaboration on takeoff workspaces via WebSockets.
*   **Website Builder System**: White-label website management with AI Website Wizard, page builder, publishing controls, and SEO support.
*   **Enterprise Features**: SSO/SAML 2.0, advanced session security, audit log export, data retention, GDPR compliance, feature flags, and a 4-tier subscription model.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, history, and comparisons.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs.
*   **Internal Domain Event Bus**: Typed, in-process EventBus for decoupling business actions.
*   **Notification Delivery Framework**: Multi-channel notification service (email, web push, SMS, Teams, Slack) with per-user preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Dashboard Customization**: WYSIWYG editor with configurable widgets and tiered default layouts.
*   **Platform Monitoring & Observability**: Super Admin monitoring dashboard with API usage tracking, AI usage analytics, object storage usage, platform integration health checks, and cross-organization audit log viewer.
*   **Feature Permissions System**: Granular per-user feature access control.
*   **Social Media Management System**: Content management with scheduling, AI generation, multi-platform support, and approval workflow.
*   **BIM Quantity Extraction**: Client-side IFC file parsing using web-ifc for building element quantity extraction.
*   **Contract Management Lifecycle**: Full contract lifecycle with E-Signature Integration and AI-Powered Risk Analysis.
*   **Clause Library & Template Builder**: Organization-scoped reusable contract clause management and template assembly.
*   **CPM Schedule Management Engine**: Full Critical Path Method (CPM) scheduling with forward/backward pass, float calculation, critical path identification, baseline locking, and resource loading.
*   **Change Order Workflow Enhancement**: Revision history and multi-level approval chain. AI auto-suggest change orders from detected delays/inspections.
*   **Cost Overrun Prediction Engine**: Burn-rate trend analysis, confidence-scored predictions, weeks-until-overrun, and early warnings on CFO dashboard.
*   **Subcontractor Recommendation Engine**: Ranks subcontractors by composite score from performance history, vendor ratings, and contract track record with trade-specialty filtering.
*   **Hiring Module (ATS)**: Applicant Tracking System with job posting, candidate pipeline, interview scheduling, AI candidate scoring, and customizable stages.
*   **Talent Pool & Connected Hiring-Marketplace**: Self-service talent profiles with AI-powered skill match.
*   **Task Detail Modal**: Comprehensive task detail view with subtasks, comments, activity log, and inline actions.
*   **Punch List Module**: Tracking deficiency items during project closeout.
*   **Warranty / Post-Construction Module**: Tracking defects, warranty claims, callbacks, and recalls with task and cost management.
*   **Asset & Property Management**: Post-completion lifecycle with Asset Handover, Warranty Tracking, and Maintenance Logs.
*   **Risk Management Module**: Full risk register per project with category/probability/impact scoring, risk matrix heat map visualization, lifecycle tracking, cost/schedule impact linking, auto change order generation on occurrence, and AI-powered risk suggestions.
*   **BIM Viewer**: IFC file upload and 3D viewer with orbit/pan/zoom, element tree, properties, measurement tools, and split-view.
*   **Contractor Marketplace Directory**: Searchable public directory of organizations.
*   **Leave Management Module**: Employee self-service and manager/HR views for leave management.
*   **No-Code Workflow Builder**: Visual pipeline editor for custom approval chains, status pipelines, and notification triggers.
*   **AIA Progress Billing Engine**: Full AIA G702/G703 progress billing system based on SOV module.
*   **Revenue Recognition & WIP Reporting**: Cost-to-cost method revenue recognition engine with per-project WIP analysis, standalone WIP Schedule Report page, monthly snapshots, historical comparison, and CSV export.

**API Documentation**:
*   **Swagger UI** served at `/api-docs` with OpenAPI 3.0 spec.

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