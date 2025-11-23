# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is an internal tool for TFR Construction, designed to manage the entire project lifecycle from bid tracking to project completion. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform aims to integrate AI for operational intelligence, streamline crew and subcontractor management, and ensure high data quality within the construction management process.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack for robustness and comprehensive functionality, adhering to a client-server architecture with a strong emphasis on security, scalability, and user experience.

-   **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, and styled with Tailwind CSS and shadcn/ui.
-   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL on Neon, managed with Drizzle ORM, supporting audit logs, billing, time clock, AI operations, crew/skills, equipment, data quality, and subcontractor management.
-   **Authentication**: JWT-based authentication using httpOnly cookies, bcrypt for password hashing, and token versioning, featuring Role-Based Access Control (RBAC) across six user roles and self-service registration.
-   **Security**: Multi-layered protection including rate limiting, comprehensive audit logging, and file validation.
-   **UI/UX**: Clean, functional interface built with shadcn/ui components and Tailwind CSS.
-   **Key Features**:
    -   **Authentication & Authorization**: Secure JWT with RBAC.
    -   **User Management**: Admin tools for accounts, roles, and activation.
    -   **Time-Clock System**: Native time-clock with GPS, shift management, and approvals.
    -   **Audit & Compliance**: Comprehensive audit logging.
    -   **Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, and Change Orders, including a strict Change-Order State Machine.
    -   **Change Order File Attachments**: Full file upload system for change orders using Uppy + Object Storage:
        -   **Upload**: Supports images, PDFs, CAD files (.dwg, .dxf), Office docs (max 10 files, 50MB each)
        -   **Display**: Collapsible file sections showing filename, size, date with download/delete controls
        -   **RBAC**: ADMIN, MANAGER, OFFICE_MANAGER have unrestricted access; project superintendents, estimators, and change order requesters have project-level access
        -   **Delete Permissions**: File uploader OR ADMIN/MANAGER/OFFICE_MANAGER can delete files
        -   **Integration**: Files stored in change order's attachmentsJson field with object storage references and ACL policies
    -   **Change Order Deductions & Adjusted Contract**: Support for both additions and deductions to contract value:
        -   **Additions**: Positive amounts for additional scope (displayed with + prefix in primary color)
        -   **Deductions**: Negative amounts for scope reductions (displayed with - prefix in red/destructive color)
        -   **Validation**: Amounts must be non-zero, range ±$100M, validated on both frontend and backend
        -   **Adjusted Contract Amount**: Displays in Financial Information card as original contract + sum of all APPROVED change orders
        -   **Visual Indicators**: Color-coded amounts with Addition/Deduction badges throughout UI
        -   **Helper Text**: Form inputs include guidance on entering positive/negative values
    -   **Daily Notes & Company Communications**: Comprehensive system for project-specific and company-wide daily communications:
        -   **Project Daily Notes**: Per-project note tracking on each project detail page with auto-generated metadata (author, timestamp, date)
        -   **Company Communications**: Dedicated company-wide communications page accessible from main navigation
        -   **Filtering**: Advanced filtering by author, date range, and project for both note systems
        -   **Note Editing**: Inline editing capability for notes with RBAC (note creator OR admin can edit)
        -   **API**: RESTful endpoints (GET, POST, PATCH) with query parameter support and proper authentication
        -   **Database**: Dedicated tables (projectNotes, companyDailyNotes, aiNoteInsights) with proper indexing for performance
        -   **Auto-generated Metadata**: System automatically captures user ID, timestamp, and date for all notes
        -   **RBAC for Editing**: Note creators and admins can edit notes via inline editing UI with save/cancel controls
        -   **AI-Powered Note Analysis**: OpenAI GPT-4 integration for automated note scanning and actionable task generation:
            -   **Automated Analysis**: Hourly (last 2 hours) and daily (6 PM, last 24 hours) scheduled scans via node-cron
            -   **Manual Trigger**: ADMIN/MANAGER can manually trigger analysis via "Analyze Now" button
            -   **Insight Categories**: SUPPLY_NEED, EQUIPMENT_REPAIR, WEATHER_DELAY, CHANGE_ORDER, SAFETY, CLIENT_COMMUNICATION, OTHER
            -   **Severity Levels**: LOW, MEDIUM, HIGH, CRITICAL with visual badges and color coding
            -   **Smart Routing**: AI determines appropriate recipients (ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER) based on insight type
            -   **RBAC Security**: Role-based filtering ensures users only see insights relevant to their role; admins/managers see all insights
            -   **Deduplication**: Prevents duplicate insights for same note + category combination
            -   **Performance**: Optimized SQL joins to avoid N+1 queries when fetching notes
            -   **UI Component**: Expandable insight cards with recommended actions, severity indicators, and project context
    -   **Daily Operations**: Media uploads and daily scope progress tracking with quantity completion and billing status management.
    -   **AI Senior PM + CFO System**: AI-driven task generation, profitability analysis, scheduling, ordering, bid tracking, and billing automation.
    -   **Takeoff + Estimating Engine**: Comprehensive system for managing project plans, interactive drawing tools, measurement persistence, quantity summaries, and multi-page PDF rendering.
        -   **Phase 1 Complete (November 2025)**: Stabilization & Performance Optimization
            -   **Geometry Utilities**: Centralized calculation library (shared/utils/geometry.ts) for distance, area, volume, arc length, curved boundaries
            -   **Calculation Refactoring**: All TakeoffWorkspace calculations use geometry utils for consistency and maintainability
            -   **Calibration Auto-Recalculation**: Backend automatically recomputes all measurements when sheet scale changes
            -   **Performance Optimization**: Single aggregatedMeasurements memo structure with precomputed grand totals, eliminating redundant filter/reduce operations in render paths
            -   **Schema Fixes**: Resolved depthInches → depthFeet field mismatch, fixed points parsing to handle both JSON strings and pre-parsed arrays
        -   **Phase 2-6 Pending**: STACK-like UX improvements, AI auto-takeoff, spec book parsing, estimate auto-generation, comprehensive logging
    -   **File Storage & Permissions**: Management via Replit Object Storage with presigned URLs and granular ACLs.
    -   **Daily Scope Progress Tracking**: Enables daily tracking of scope item completion quantities, billed quantities, and billing status changes with dedicated API endpoints and UI components for management and visualization.
    -   **Billing Status Workflow**: Production-grade workflow for managing billing lifecycle from field completion to invoicing:
        -   **Field Recording**: Workers record daily progress with initial billing status
        -   **Verification**: Superintendents mark quantities as "READY_TO_BILL" → Office Managers automatically notified
        -   **Billing Completion**: Office Managers update status to "BILLED" via inline dropdown → billedDate and billedById auto-filled
        -   **Audit Trail**: Complete tracking of who billed quantities and when
        -   **RBAC**: Strict role-based access (SUPERINTENDENT, OFFICE_MANAGER, ADMIN, MANAGER can update status)
        -   **Data Integrity**: Database transactions ensure atomic updates, strict enum validation prevents invalid status values
        -   **Notifications**: Automatic alerts to office managers when quantities are ready for billing

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database with HTTP driver (neon-http).
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
-   **OpenAI GPT-4**: Powers the AI Senior PM + CFO system.
-   **JWT**: For authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For file upload progress tracking.
-   **node-cron**: For scheduling tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing, document processing, and PDF rendering in the takeoff engine.