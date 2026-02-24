# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS construction management platform designed to manage the entire construction project lifecycle. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight across multiple contracting specialties. The platform supports multi-tenancy, features AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite of tools for project management, estimating, CRM, and compliance. The vision is to provide a robust, scalable solution that adapts to various construction trades, improving project outcomes and operational efficiency.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform employs a modern web stack, prioritizing security, scalability, and user experience with a multi-tenant architecture.

**Key Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
*   **Database**: PostgreSQL on Neon, managed with Drizzle ORM.
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, and Role-Based Access Control (RBAC) across ten user roles.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Trade-Specific Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features based on trade type (e.g., APIs, navigation, dashboards, Master Scope of Work items).
*   **AI Integration**: Extensive AI functionalities including AI Senior PM + CFO System for generation, analysis, scheduling, automation (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), and an AI Governance System with daily limits and audit trails.
*   **Project Lifecycle Management**: Comprehensive CRUD operations and workflows for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a guided Bid Cost Builder Workflow.
*   **Estimating Engine**: Features interactive drawing tools, multi-page PDF rendering, an enhanced material calculator, and a hierarchical line item builder.
*   **CRM System**: Manages various organizational entities with vendor pricing, rental equipment catalogs, and type-specific fields.
*   **Workforce Management**: Includes a native time-clock with GPS, shift management, labor hour tracking, Manager Approval Workflow, and an Overtime Request System. Also features a dedicated Workforce Management page with KPI dashboards, ratings, and rewards.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework.
*   **Production Rate Tracking**: Comprehensive analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM), integrating with AI for insights.
*   **Unified SOW Tracking System**: Ensures scope of work items are consistently linked across the project lifecycle, with auto-seeding based on trade type during onboarding.
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System for secure document access.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, and publishing controls.
*   **Enterprise Features**: Includes SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention policies, and GDPR compliance tooling (ROPA, Data Subject Request workflow). These are gated by feature flags and a 4-tier subscription model.
*   **Integration Hub**: Provider-agnostic framework supporting QuickBooks Online, Google Workspace, Microsoft 365, DocuSign, and Zapier for centralized connection management and event handling.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, source tracking, and a UI for revision history and comparison.
*   **Addenda Tracking System**: Full addenda lifecycle management per project, including status workflow, related document linking, and acknowledgment tracking.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with outbox dispatcher.

## Recent Changes (Feb 2026)
*   **Backend Route Extraction**: Extracted all 265 route handlers from the monolithic routes.ts (16,007 lines) into 10+ domain-specific route files. routes.ts is now 488 lines of pure wiring (imports + app.use). Route files: dashboardUserRoutes, projectCoreRoutes, crmVendorRoutes, scopeConfigRoutes, projectContentRoutes, projectOpsRoutes, notificationCrewRoutes, takeoffSubRoutes, messagingRoutes, equipmentMgmtRoutes (plus previously extracted authProfileRoutes, workforceRoutes, bidRoutes2).
*   **Schema Split**: Split the 7,845-line shared/schema.ts into 4 domain modules: shared/schema/enums.ts, core.ts, operations.ts, features.ts with a barrel index.ts. All imports via `@shared/schema` continue working.
*   **project-detail.tsx Decomposition**: Extracted 9 tab components into client/src/components/project-tabs/ (ChangeOrdersTab, OverviewTab, SubcontractorsTab, LaborTab, PlansTab, ProcurementTab, ReceiptsTab, MediaTab, TimeTab). Reduced from 5,438 to 2,098 lines.
*   **Test Infrastructure**: Vitest configured with npm test/test:watch/test:coverage scripts. Schema validation tests and route module structure tests established (254 tests passing).
*   **Org Isolation Test Harness**: Automated multi-tenant isolation testing framework in server/__tests__/org-isolation/. Seeds two orgs, runs cross-org read/write/list/fuzz/snapshot tests against all org-scoped endpoints. Run via `npm run test:isolation`. Uses supertest for HTTP-level testing with real JWT auth tokens.
*   **Subscription Management**: POST/DELETE routes and Assign/Delete subscription UI for Super Admin already implemented in platformAdminRoutes.ts and PlatformSubscriptions.tsx.
*   **Phase 2 Takeoff Enhancements**: Sheet management (rename, reorder, duplicate, delete), visual revision comparison (side-by-side + overlay slider modes), and document revision preview URL endpoint.
*   **Phase 3 Addenda Overlays & Advanced Calibration**: Addenda overlay system in TakeoffWorkspace (toggle addendum images as semi-transparent overlays on plan sheets with per-addendum opacity control). Added addenda preview-url endpoint. Advanced calibration tools: scale verification (measure known distance to check error %), multi-point calibration (average multiple references for higher accuracy), and calibration info display panel.

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4 / GPT-4o**: Powers AI functionalities.
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