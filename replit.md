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
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC), OAuth social login (Google, Apple) with CSRF protection, and Passkey (WebAuthn) passwordless login.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to specific trade types.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation across various modules, governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows covering Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a Unified SOW Tracking System.
*   **Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, material calculation, hierarchical line item builder, 6-step bid workflow, full takeoff workspace, 3-Layer Modifier Selector system, and vendor pricebook match confidence indicators.
*   **Custom Cost Code Management**: Organization-level cost code management with CSI division grouping and custom code support.
*   **CRM System**: Manages organizational entities, vendor pricing, rental equipment catalogs, insurance/compliance tracking, and a 7-stage Sales Pipeline module.
*   **Workforce Management**: Native time-clock with GPS/geofence validation, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, KPI dashboards, crew scheduling, employee deductions, pay stub generation, and Certified Payroll Reports (WH-347) generation.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, an Approval Workflows Framework, and an Addenda Tracking System.
*   **Safety Training Management**: Full in-house safety training lifecycle, including program creation, assignment, tracking, and digital acknowledgments.
*   **Budget vs Actual Cost Engine**: Per-project cost code budget with real-time cost ledger aggregating committed and actual costs, grouped by CSI division, with variance alerts and an editable budget editor.
*   **Live Project Profitability Tracking**: Automated real-time cost monitoring via a background cron job, recalculating costs vs adjusted budget, saving snapshots, and firing in-app notifications.
*   **Procurement Module**: Full procure-to-pay lifecycle covering Purchase Requests, Purchase Orders, Delivery Receipts, Vendor Invoices, and automated 3-Way Match, with RBAC-controlled approvals.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Communication & Collaboration**: Unified Messaging System with Slack-style channels, file attachments, voice messages, task @mentions. Includes Client Portal Chat and Subcontractor Portal System.
*   **Live Takeoff Collaboration**: Real-time multi-user collaboration on takeoff workspaces via WebSockets, featuring live cursor tracking, real-time measurement sync, and presence indicators.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, and full SEO support.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, GDPR compliance, feature flags, and a 4-tier subscription model.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling.
*   **Multi-Source Document Upload**: Supports local files, direct links, and integrated cloud storage services.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, UI for history and comparison, and in-app notifications.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Internal Domain Event Bus**: A typed, in-process EventBus that decouples business action triggers from side-effects.
*   **Notification Delivery Framework**: Multi-channel notification delivery service supporting email, web push, SMS, Microsoft Teams, and Slack, with per-user channel preferences.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Libraries System**: Provides reusable library management for custom items, assemblies, and saved takeoffs, with API for CRUD, bulk import, and trade-aware seeding.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets, and tiered default layouts based on user permissions.
*   **Performance Indexes**: Database indexes are optimized for frequently queried fields across key tables.
*   **Feature Permissions System**: Granular per-user feature access control enforced via backend middleware and frontend hooks.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Contractor Onboarding Library**: A hard-coded, normalized reference data system for trades, scopes, materials, formulas, and grammar, powering AI onboarding and dynamic UI components.
*   **Social Media Management System**: Comprehensive content management with scheduling, AI generation, multi-platform support, rich media picker, and approval workflow.
*   **BIM Quantity Extraction**: Client-side IFC file parsing using web-ifc to extract building element quantities, generating BIM takeoff sheets.
*   **Reports System**: Provides various report types across Takeoff and Estimate categories, with CSV export, browser print, and snapshot creation.
*   **Contract Management Lifecycle**: Full contract lifecycle (Award → Draft → Review → Redlines → Approval → Execution → Versioning) with status pipeline, version history, redline tracking, approval workflow, execution recording, and E-Signature Integration. Includes AI-Powered Contract Risk Analysis.
*   **Clause Library & Template Builder**: Organization-scoped reusable contract clause management with categories, flags, and sort ordering. Template builder assembles clauses with default terms.
*   **CPM Schedule Management Engine**: Full Critical Path Method (CPM) scheduling with forward/backward pass, total/free float calculation, dynamic critical path identification, baseline schedule locking, schedule update ripple, resource loading, SPI forecasting, delay-to-change-order bridge, and upgraded Gantt chart.
*   **Change Order Workflow Enhancement**: Includes revision history tracking and a multi-level approval chain.
*   **Approval Workflow Notifications**: In-app notifications across 6 approval workflows.
*   **Submittal Items & Attachments**: Normalized tables for managing submittal items and attachments with status tracking.
*   **Vendor & Sub RFQ Flow**: Enables sending RFQ emails to subcontractors and material suppliers directly from bid steps, with tracking of RFQ status and in-app notifications.
*   **Hiring Module (ATS)**: Full Applicant Tracking System with job posting lifecycle, candidate pipeline, interview scheduling, hiring task management, AI candidate scoring, analytics dashboard, and customizable per-organization pipeline stages.
*   **Talent Pool & Connected Hiring-Marketplace**: Self-service talent profiles with searchability, AI-powered skill match scoring, and integration with job postings.
*   **Punch List Module**: Dedicated project tab for tracking deficiency items during project closeout, supporting CRUD operations, attachments, and PDF export.
*   **Warranty / Post-Construction Module**: Project tab for tracking defects, warranty claims, callbacks, and recalls, with task management, cost tracking, and audit trail.
*   **Company Overhead & Fixed Costs Manager**: Administration module for tracking fixed overhead costs, with CRUD functionality, summary cards, and suggested overhead percentages.
*   **BIM Viewer**: IFC file upload and 3D viewer in the Plans & Takeoff tab, with orbit/pan/zoom controls, element tree, properties panel, interactive multi-select, measurement tools, 2D/3D storey association, and split-view mode.
*   **Contractor Marketplace Directory**: Searchable, filterable public directory of organizations with profile pages, specialties, service areas, certifications, portfolio, and reviews.
*   **Custom Line Styles & Measurement Grouping**: Measurements support custom line styles and variable line width. Measurement grouping allows organizing measurements into named, collapsible groups with color coding and aggregated totals.
*   **Leave Management Module**: Dedicated leave management under Workforce & Labor with employee self-service and manager/HR views. Configurable leave types with annual allowances.
*   **AIA Progress Billing Engine**: Full AIA G702/G703 progress billing system built on the SOV module. Features: pay application CRUD, PDF generation, period-to-period roll-forward, stored materials workflow, cross-module integration, retention tracking, client approval workflow, payment posting, overpayment validation, and payment aging reports.

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
*   **three, web-ifc**: For BIM/IFC 3D model viewing and client-side IFC parsing.
*   **Recharts**: For data visualization charts.
*   **react-grid-layout**: For dashboard editor layout.
*   **QuickBooks Online**: For accounting integrations.
*   **Google Workspace (Gmail, Calendar)**: For email and calendar integrations.
*   **Microsoft 365 (Mail, Calendar)**: For email and calendar integrations.
*   **DocuSign**: For e-signature workflows.
*   **@node-saml/node-saml**: For SAML 2.0 Service Provider.