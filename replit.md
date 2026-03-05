# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS platform designed to streamline and manage the entire construction project lifecycle for various trades. It aims to centralize project data, user management, and daily operations to enhance efficiency, ensure compliance, and provide comprehensive oversight. The platform integrates AI-driven features, dynamic navigation, trade-specific dashboards, and a full suite of tools for project management, estimating, CRM, compliance, and workforce management. The core purpose is to deliver a robust, scalable solution that significantly improves project outcomes and operational efficiency within the construction industry, offering substantial market potential for widespread adoption.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform is built on a modern web stack featuring a multi-tenant architecture, designed for security, scalability, and an optimal user experience.

**Technology Stack**:
*   **Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
*   **Backend**: Express.js in TypeScript.
*   **Database**: PostgreSQL, managed with Drizzle ORM.
*   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, Role-Based Access Control (RBAC) supporting 18 user roles, and OAuth social login (Google, Apple) with CSRF protection and email verification.

**Core Architectural Decisions & Features**:
*   **Multi-Tenancy & Customization**: Supports distinct organizations with AI-driven onboarding and dynamic features tailored to specific trade types.
*   **AI Integration**: Features AI for generation, analysis, scheduling, and automation across various modules (e.g., AI Auto-Takeoff, AI Scheduling Assistant, AI Change Order Generator), governed by an AI Governance System.
*   **Project Lifecycle Management**: Comprehensive workflows covering Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking.
*   **Estimating Engine**: Includes interactive drawing tools, multi-page PDF rendering, material calculation, and a hierarchical line item builder.
*   **CRM System**: Manages various organizational entities, vendor pricing, and rental equipment catalogs.
*   **Workforce Management**: Features a native time-clock with GPS, shift management, labor hour tracking, Manager Approval Workflow, Overtime Request System, and KPI dashboards.
*   **Compliance & Audit**: Comprehensive audit logging, document management with versioning, expiration tracking, and an Approval Workflows Framework.
*   **Production Rate Tracking**: Analytics for crew productivity, labor cost, material cost, and profitability per Unit of Measure (UOM).
*   **Unified SOW Tracking System**: Ensures consistent linking of scope of work items across the project lifecycle.
*   **Communication & Collaboration**: Unified Messaging System (Team Messages, Portal Chat), Client Portal Chat, and Subcontractor Portal System.
*   **Website Builder System**: White-label website management with an AI Website Wizard, page builder, publishing controls, and token-protected staging preview links.
*   **Enterprise Features**: SSO/SAML 2.0 support, advanced session security, audit log export, configurable data retention, and GDPR compliance tooling, managed by feature flags and a 4-tier subscription model.
*   **HTTP Security Headers**: Helmet middleware (`server/index.ts`) sets `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `Referrer-Policy`, and `X-XSS-Protection`. CSP and COEP disabled for compatibility with dynamic content and external resources.
*   **API Log Redaction**: Response logging middleware redacts sensitive fields (passwords, tokens, secrets, API keys) and masks PII (email, phone) before writing to server logs. Depth-limited to 3 levels with array summarization for large payloads.
*   **Integration Hub**: Provider-agnostic framework for centralized connection management and event handling, including expanded QuickBooks Online integration. Security hardened with AES-256-GCM token encryption at rest (`server/integrations/encryption.ts`), token stripping from API responses via `sanitizeConnection()`, separate `getDecryptedConnection()` for internal server-side operations, security audit logging, and UI trust indicators (security banner, token status badges, security details panel, security audit log). Cloud storage providers: Dropbox (`server/integrations/providers/dropbox/`), Google Drive (`server/integrations/providers/gdrive/`), OneDrive (`server/integrations/providers/onedrive/`), Box (`server/integrations/providers/box/`) — OAuth2 stubs with minimal read-only scopes, ready for credential configuration.
*   **Multi-Source Document Upload**: Upload Source Picker modal (`client/src/components/UploadSourcePicker.tsx`) in Plans & Takeoff tab supports 6 sources: Local File (ObjectUploader/Uppy), Direct Link (server-side fetch via `POST /api/documents/from-url` with SSRF protection), Dropbox, Google Drive, OneDrive, Box (cloud sources check Integration Hub connection status). Direct Link endpoint validates HTTPS-only, follows up to 3 safe redirects (re-validating each against SSRF blocklist), blocks private IPs via hostname regex + DNS resolution, enforces 100MB limit and allowed Content-Types. Project/org access is verified before any network activity. All error messages are user-friendly plain language. Upload button shows time-based progress messages during long downloads.
*   **Document Control & Revisioning**: Manages document revisions with sequential numbering, status tracking, source tracking, and UI for history and comparison.
*   **Addenda Tracking System**: Full addenda lifecycle management per project.
*   **Project Health Score**: Deterministic 0-100 score based on weighted project inputs with snapshot trending.
*   **Background Jobs Framework**: node-cron based job runner with an outbox dispatcher.
*   **Takeoff Enhancements**: Sheet management, visual revision comparison, addenda overlays, and advanced calibration in TakeoffWorkspace. New measurement types include LINEAR_WITH_DROP, PITCHED_LINEAR, PITCHED_AREA, and SURFACE_AREA. Supports per-measurement cost linking and properties panel for cost code/unit cost inputs.
*   **Libraries System**: Provides reusable library management for custom items, assemblies, and saved takeoffs, with a backend API for CRUD operations, bulk import, and trade-aware seeding from an onboarding library. Includes a frontend panel for item/assembly management and custom library filtering.
*   **Mobile & Offline Sync Backend**: API endpoints for status, sync trigger, device management, conflict resolution, and PWA support with a service worker.
*   **Dashboard Customization**: WYSIWYG editor with section-based layout, configurable widgets (Trend Chart, Data List, Alerts, Workforce Snapshot, Cash Position, SOV Progress, Bid Pipeline, Cost Code Breakdown, Schedule Impact), and role-based default layouts.
*   **WCAG Compliance**: Theme picker colors meet WCAG AA 4.5:1 contrast ratio.
*   **Custom KPI Management System**: Org-level custom KPI definitions, assignment to employees with targets, and performance tracking.
*   **Contractor Onboarding Library**: A hard-coded, normalized reference data system serving as the single source of truth for trade presentation, powering AI onboarding, scope prediction, and material definitions. It comprises core pillars (trades, scopes, materials, formulas, grammar) and extension files for trade components and variant expansions. This system enables dynamic filtering of library data and integration into UI components for trade selection and scope management.
*   **Social Media Management System**: Comprehensive content management with scheduling, AI generation, and multi-platform support (FACEBOOK, INSTAGRAM, LINKEDIN, TWITTER, TIKTOK, YOUTUBE, PINTEREST). Features full CRUD for accounts and posts, a calendar view, stats dashboard, approval workflow with rejection reasons, and bulk operations. A background worker processes scheduled and recurring posts with real platform API publishing via `server/social/publishService.ts` (Facebook, Instagram, LinkedIn, Twitter/X implemented; TikTok, YouTube, Pinterest stubbed). Includes platform-specific post preview (mock renderers for each platform), media URL attachments (up to 4 per post), duplicate content detection with warnings, post rejection with reason display, social account linkage requirement for scheduling, and token lifecycle management (daily expiry check cron, auto-refresh, status validation endpoints, expired account indicators in UI). The `social_media_posts` table includes `rejectionReason` column for storing rejection feedback. **Multi-platform selection**: Posts can target multiple platforms simultaneously via checkbox multi-select; `platforms` JSON column stores the array alongside `platform` (first selected) for backward compatibility. **Rich media picker**: Three methods for adding media — local file upload (ObjectUploader/Uppy), URL paste, and AI image generation (`POST /api/social/posts/generate-image` using OpenAI `gpt-image-1`, stored in Object Storage, served via `/api/social/image/:orgId/:fileName` proxy).
*   **Reports System**: Accessible as a sub-tab within Projects → Plans & Takeoff (after Libraries), with a standalone `/reports` route as fallback. 9 report types across two categories: **Takeoff Reports** (7): Takeoff Quantity, Summary, Measurements By Takeoff, Item List, Item Cost, Item Cost By Type, Item Cost By Takeoff. **Estimate Reports** (2): Estimate Summary, Cost Breakdown. When embedded in project detail, reports are auto-scoped to the current project (project filter hidden). Features CSV export, browser print, expandable grouped tables, and snapshot creation. Backend API in `server/reportRoutes.ts` with org-scoped queries using Drizzle `inArray()` for proper array parameterization. Fully mobile-responsive with card layouts and dropdown navigation replacing sidebar.

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