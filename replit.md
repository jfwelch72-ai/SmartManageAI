# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is a comprehensive internal tool designed to manage the entire project lifecycle for TFR Construction. Built with TypeScript, React, and PostgreSQL, its purpose is to streamline operations from bid tracking through project completion, enhancing efficiency and oversight across all construction activities. The platform aims to be the central hub for project data, user management, and daily operational tasks.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform is built with a modern web stack:
- **Frontend**: React with TypeScript, utilizing Wouter for routing, TanStack Query for data fetching, and styled with Tailwind CSS alongside shadcn/ui components for a consistent and responsive user interface.
  - **TanStack Query Conventions**: All query keys use hierarchical array format for proper cache invalidation. Simple endpoints use `["/api/endpoint"]`, hierarchical keys use separate segments like `["/api/projects", code, "scope"]`. Never use template literals in query keys. All mutations invalidate related cache segments using `queryClient.invalidateQueries()`.
- **Backend**: An Express.js server written in TypeScript with comprehensive security middleware including CORS (localhost:5173), rate limiting (auth/sensitive/API), and JWT token versioning for session revocation.
- **Database**: PostgreSQL, hosted on Neon, managed with Drizzle ORM. 22 tables including audit_log, billing_events, time_clock_shifts, time_clock_events, ai_settings, ai_runs, and ai_tasks for complete compliance tracking and AI-powered operations.
- **Authentication**: JWT-based authentication using httpOnly cookies with bcrypt password hashing. Token versioning enables "logout all devices" functionality. All passwords require 8+ characters.
- **Security**: Multi-layer protection with rate limiting (5 auth attempts/15min, 100 sensitive/15min, 1000 API/15min), comprehensive audit logging for all sensitive operations, and file validation (MIME types, size limits).
- **UI/UX**: Emphasis on a clean, functional interface using shadcn/ui components and Tailwind CSS for rapid development and maintainability.
- **Key Features**:
    - **Authentication & Authorization**: Secure JWT-based system with token versioning for session revocation. Six distinct user roles (ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE) with RBAC enforcement. Self-service registration with admin activation. Password change and token revocation endpoints.
    - **User Management**: Comprehensive admin interface for managing user accounts, roles, activation status, and force-logout capabilities via token revocation.
    - **Time-Clock System (NEW)**: BusyBusy-style native time-clock with GPS coordinate tracking, shift management, clock-in/clock-out, auto-clock-out API endpoint (requires scheduled task/cron setup for 16-hour automation), manager approval workflows, shift adjustments, admin overrides, and time-entry generation integration.
    - **Audit & Compliance (NEW)**: Comprehensive audit logging system tracking all CREATE, UPDATE, DELETE, APPROVE, REJECT, and custom actions across all entities. Includes IP address, user agent, timestamps, and full before/after snapshots. Admin-accessible query interface with filtering by entity, user, action, and date range.
    - **Billing Events (NEW)**: Financial tracking system for INVOICE_SENT, PAYMENT_RECEIVED, CHANGE_ORDER_INVOICED, RETENTION_RELEASED, and LIEN_WAIVER_RECEIVED events with project linkage and reference tracking.
    - **Project Lifecycle Management**: Full CRUD operations for Bids, Projects, Estimates, Procurement items, and Change Orders, including bid-to-project conversion and project status tracking.
    - **Daily Operations**: Features for project notes, media uploads (photos/videos), and daily progress updates.
    - **Time & Materials**: Time entry system with approval-based locking (approved entries require admin override to edit/delete), role-based approval workflow, and T&M daily sheets for client billing.
    - **Calendar & Time-Off**: Monthly calendar view for events, with time-off request creation, approval workflows, and networking event tracking.
    - **Dashboard**: Real-time Key Performance Indicator (KPI) metrics and quick navigation to active projects, pending change orders, and time-off requests.
    - **File Storage & Permissions**: Comprehensive file management system with Replit Object Storage (Google Cloud Storage backend) for media, documents, and receipts. Features include:
        - Presigned URL uploads with Uppy progress tracking
        - Granular permission-based ACL: Admins/managers have full access; superintendents/hourly employees require explicit permission grants
        - filePermissions table tracking manager-granted access with fileTypeEnum (MEDIA, DOCUMENT, RECEIPT)
        - Private visibility for all uploads with automatic permission grants to uploaders
        - Permission management API endpoints for granting/revoking file access
        - ObjectUploader component integrated into project detail tabs with metadata dialogs
        - Security helpers (fileAccessHelpers.ts) for permission checks, file resolution, and listing filters
        - Orphaned object protection: download route blocks files not tracked in database
    - **AI Senior PM + CFO System (NEW)**: Comprehensive AI-powered daily operating system using OpenAI GPT-4 for automated task generation, profitability analysis, crew scheduling, material ordering, bid tracking, and billing automation. Features include:
        - Daily scheduled runs at 6:00 AM (configurable) using node-cron
        - Role-specific task generation (ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE)
        - Real-time project profitability tracking with ON_BUDGET/MINOR_CONCERN/MAJOR_RISK status
        - CFO-level financial analysis with variance tracking and projected completion costs
        - Crew scheduling optimization recommendations
        - Material ordering automation with urgency detection
        - Bid deadline tracking and follow-ups
        - Billing cycle reminders and overdue invoice alerts
        - Manual trigger capability for on-demand analysis (ADMIN/MANAGER)
        - Complete audit trail with full snapshots and AI responses
        - Frontend dashboards: AI PM Dashboard, CFO Dashboard, AI Settings (admin controls)
        - See AI_PM_CFO_ROLE_OS.md for complete architecture documentation

## External Dependencies
- **PostgreSQL (Neon)**: Primary database for all application data.
- **Replit Object Storage (Google Cloud Storage backend)**: Used for storing media files, documents, and receipts, leveraging presigned URLs for direct uploads.
- **OpenAI GPT-4**: Powers the AI Senior PM + CFO system for daily operational insights and task generation.
- **JWT (JSON Web Tokens)**: For secure user authentication.
- **Bcrypt**: For hashing user passwords securely.
- **Uppy**: Frontend library for robust file upload progress tracking.
- **node-cron**: For scheduling daily AI analysis runs.

## Recent Changes (November 2025 - AI System, Security & Time-Clock Upgrade)
- **Security Infrastructure**: Added CORS with localhost:5173 default, three-tier rate limiting (auth 10/15min, sensitive 100/15min, API 1000/15min), JWT token versioning for session management with null-safe implementation, and comprehensive audit logging for compliance.
- **Time-Clock System**: Complete BusyBusy-style implementation with 13+ endpoints for clock-in/out, GPS tracking, shift management, approvals, adjustments, live monitoring, and auto-clock-out worker endpoint (requires external cron/scheduler for automation).
- **Time-Entry Locking**: Approved time entries are locked and require explicit admin override to modify or delete, ensuring billing integrity.
- **Audit Logging**: All sensitive operations logged with entity type, action, old/new values, IP address, user agent, and timestamps. Query endpoints with pagination and filtering.
- **Billing Events**: Financial milestone tracking system integrated with projects for comprehensive billing history.
- **User Token Revocation**: Admin capability to force-logout users across all devices by incrementing tokenVersion. Fully null-safe with defensive coalescing in both token generation and auth middleware. Migration 001_backfill_token_version.sql ensures all users have valid tokenVersion values. See server/RUNBOOK_TOKEN_REVOCATION.md for operational procedures.
- **File Validation**: MIME type whitelisting and size limits enforced for all uploads (100MB media, 50MB documents, 10MB receipts).
- **Backend Modules**: Created rateLimiter.ts, auditLogger.ts, fileValidation.ts, timeClockRoutes.ts, and migrations/ directory for organized, maintainable code.
- **Password Security**: Minimum password length increased from 6 to 8 characters for registration and password changes.
- **Change-Order State Machine (NEW)**: Enforces strict DRAFT→PENDING_APPROVAL→SUBMITTED→APPROVED/REJECTED workflow with proper transition validation, audit logging, and bypass prevention. All transitions validated server-side with role-based permissions.
- **API Pagination (NEW)**: Added pagination to high-volume endpoints (/api/projects, /api/time-entries) with strict parameter validation using Number() + Number.isInteger() to prevent NaN/negative/oversized values. Defaults to page=1, limit=50, max 1000 per page.
- **Database Indexes (NEW)**: Added 13 performance indexes across 5 high-volume tables (projects, timeEntries, changeOrders, auditLog, timeClockShifts) targeting status filters, foreign keys, and date-range queries. Eliminated redundant indexes on unique constraint columns.
- **TanStack Query Standards**: Validated and documented hierarchical array-based query key conventions across all 60+ frontend queries. All keys follow `["/api/endpoint", variable]` pattern with no template literals for proper cache invalidation.
- **AI Senior PM + CFO System (November 2025)**: Complete implementation of AI-powered daily operating system using OpenAI GPT-4. Backend includes orchestrator (runAIAnalysis), snapshot builder (19-table aggregation), profitability engine (per-project CFO analysis), scheduler (node-cron at 6 AM), and 10+ REST API endpoints. Frontend includes AI PM Dashboard (role-based tasks), CFO Dashboard (profitability overview), and AI Settings page (admin controls). System generates 10-30 daily tasks across all roles with crew scheduling, material ordering, bid tracking, and billing automation. Full documentation in AI_PM_CFO_ROLE_OS.md.