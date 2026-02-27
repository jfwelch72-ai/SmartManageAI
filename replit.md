# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to manage the entire construction project lifecycle for various trades. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform offers AI-driven features, dynamic navigation, trade-specific dashboards, and comprehensive tools for project management, estimating, CRM, compliance, and workforce management. Its purpose is to provide a robust, scalable solution that improves project outcomes and operational efficiency across the construction industry.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack with a multi-tenant architecture, prioritizing security, scalability, and user experience.

**Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript.
*   **Database**: PostgreSQL on Neon, managed with Drizzle ORM.
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) supporting 18 user roles, and OAuth social login (Google, Apple) with CSRF protection and email verification.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to trade type.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking.
*   **Estimating Engine**: Includes interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder.
*   **CRM System**: Manages various organizational entities with vendor pricing and rental equipment catalogs.
*   **Workforce Management**: Features a native time-clock with GPS, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, and KPI dashboards.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Unified SOW Tracking System**: Ensures consistent linking of scope of work items across the project lifecycle.
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, and publishing controls.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, and GDPR compliance tooling, managed by feature flags and a 4-tier subscription model.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, including expanded QuickBooks Online integration.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, source tracking, and UI for history and comparison.
*   **Addenda Tracking System**: Full addenda lifecycle management per project.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Takeoff Enhancements**: Sheet management, visual revision comparison, and addenda overlays in TakeoffWorkspace with advanced calibration tools.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support with a service worker.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets (Trend Chart, Data List, Alerts, Workforce Snapshot, Cash Position, SOV Progress, Bid Pipeline, Cost Code Breakdown, Schedule Impact), and role-based default layouts.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Custom KPI Management System**: Org-level custom KPI definitions, assignment to employees with targets, and performance tracking over time.
*   **QuickBooks Online Integration (Expanded)**: Full-featured QBO sync with 8 operations, OAuth 2.0 connection flow, Cost Code to QBO Account Mapping, and Automatic Sync Scheduling.

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