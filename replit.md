# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is an internal tool for TFR Construction, designed to manage the entire project lifecycle from bid tracking to project completion. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform aims to integrate AI for operational intelligence, streamline crew and subcontractor management, and ensure high data quality within the construction management process.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack for robustness and comprehensive functionality, adhering to a client-server architecture with a strong emphasis on security, scalability, and user experience.

-   **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, styled with Tailwind CSS and shadcn/ui.
-   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL on Neon, managed with Drizzle ORM. Bid-Estimate-Project integration uses nullable bidId/projectId with a CHECK constraint and ON DELETE SET NULL for bidId (preserves estimates when bids are deleted). Quote preservation system retains ALL bid quotes (selected and non-selected) during bid-to-project conversion, enabling later selection on project pages.
-   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, Role-Based Access Control (RBAC) across seven user roles (ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE, MAINTENANCE_MANAGER), and self-service registration.
-   **Security**: Multi-layered protection including rate limiting, comprehensive audit logging, and file validation.
-   **UI/UX**: Clean, functional interface built with shadcn/ui components and Tailwind CSS with a focus on intuitive project management workflows.
-   **Key Features**:
    -   **Authentication & Authorization**: Secure JWT with RBAC.
    -   **User Management**: Admin tools for managing accounts, roles, and user activation.
    -   **Time-Clock System**: Native time-clock with GPS, shift management, and approval workflows.
    -   **Project Labor Hours**: Production-ready feature linking time-clock shifts to specific projects for profitability analysis, displaying employee-specific labor hours, rates, and costs. Includes server-side filtering, sorting, time period presets, and aggregate metrics.
    -   **Audit & Compliance**: Comprehensive audit logging for all critical actions.
    -   **Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, and Change Orders. Includes a simplified Change-Order State Machine, attachment management with file uploads, and support for deductions and adjusted contract calculations. Weekly automated alerts for stale change orders.
    -   **Daily Notes & Company Communications**: System for project-specific and company-wide daily communications with filtering, inline editing, and AI-powered analysis.
    -   **Daily Operations**: Media uploads and daily scope progress tracking with quantity completion and billing status management. The Scope & Progress Interface provides individual SOW item cards with metrics, visual progress, and color-coded billing status, filterable by search, unit, and billing status.
    -   **AI Senior PM + CFO System**: AI-driven task generation, profitability analysis, scheduling, ordering, bid tracking, and billing automation. Lead Time Intelligence analyzes procurement and subcontractor contracts to detect scheduling conflicts, identify ordering deadlines, flag resource contention, and generate proactive alerts.
    -   **Takeoff + Estimating Engine**: Comprehensive system for managing project plans, interactive drawing tools (Linear, Area, Volume, Count, Arc/Radius), measurement persistence, quantity summaries, and multi-page PDF rendering. Features advanced pan/zoom, arc tool with 3-point workflow, and comprehensive keyboard shortcuts.
    -   **File Storage & Permissions**: Management via Replit Object Storage with presigned URLs and granular ACLs.
    -   **Billing Status Workflow**: Production-grade workflow for managing billing lifecycle from field recording to invoicing, with strict RBAC and audit trails.
    -   **Project Financials Dashboard**: Real-time financial tracking on project overview displaying Budget, Contract Amount, Adjusted Contract, Projected Profit, and Actual Profit. Includes profit variance tracking.
    -   **Project Labor Rates**: Production-ready feature for configuring project-specific labor rates and overhead costs, with a rate hierarchy and burden multiplier.
    -   **Estimator Handoff Packet**: Comprehensive 7-section job information form for QuickBooks integration, transferring from bids to projects.
    -   **Auto-Assign Bid/Project IDs**: Automatic sequential ID generation (starting at 260001) with shared sequence for bids and projects, and concurrency handling.
    -   **Delete Bid/Project**: Production-ready delete functionality with RBAC, comprehensive cascade deletion, audit logging, and cache invalidation.
    -   **Production Rate Tracking**: Analyzes historical field data from daily scope progress entries to compute production benchmarks for estimating, aggregating by work type with various statistics and filtering options. Unified Production Rates endpoint (`/api/production-rates/unified`) aggregates scope data from daily progress, T&M tickets, and Change Orders using standardized workTypeCode for comprehensive production analysis across all work sources.
    -   **CRM System**: Comprehensive relationship management for CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, and OWNER_REP entities. Features organization management, multi-contact per organization, activity notes with tagging, search/filter, and RBAC. MANAGER+ role access.
        - **Vendor Pricing Catalogs**: Quarterly pricing management for SUPPLIER and VENDOR organizations. Tracks item name, code, category (CONCRETE, STONE, REBAR, etc.), unit, unit price, effective quarter, lead time, and delivery fees. Features standardized item name selector aligned with bid estimate categories (CONCRETE, FLATWORK, EXCAVATION, etc.) plus custom item entry for non-standard materials. `/api/vendor-pricing/search?category={CATEGORY}` endpoint provides catalog lookup for bid estimates.
        - **Bid Estimate Catalog Integration**: Category selection in bid estimate line items triggers automatic catalog lookup via `/api/vendor-pricing/search`. Matching vendor pricing items display below the material cost field with vendor name, unit price, and one-click apply functionality. Works in both add and edit line item dialogs. Uses queryClient default fetcher for CSRF protection.
        - **Rental Equipment Catalogs**: Equipment rental catalog for RENTAL_VENDOR and VENDOR organizations. Tracks equipment name, type, make, model, hourly/daily/weekly/monthly rates, delivery/pickup fees, and minimum rental days. Integrates with bid equipment selection in the Bid Cost Builder.
    -   **T&M Tracking Module**: Site superintendents log work outside contract scope (labor, equipment, materials) with full status workflow (DRAFT→SUBMITTED→APPROVED/REJECTED). Features auto-generated ticket IDs (TM-{projectCode}-{seq}), line item management, PDF ticket generation, role-based approval workflow, attachment support for signed documents, and financial integration with approved totals flowing into adjusted contract calculations. Quick-select from project scope items enables rapid scope selection when creating T&M tickets.
    -   **Scope Integration**: Estimate line items can pre-populate subcontractor quote forms on bids. Project scope items can be quickly selected when creating T&M tickets. All modules use standardized workTypeCode for unified production tracking.
    -   **Material Calculator**: Comprehensive material requirements calculator integrated into bid estimate line items. Supports 8 material types with industry-standard calculation formulas:
        - Concrete: Area × depth or linear × width × height calculations with adjustable waste factors (5-15%)
        - Stone Sub-Base: Toggle-based with stone type selection (crushed stone, limestone, compacted base), density-based tonnage calculations (1.5 tons/yd³ standard)
        - Excavation: Volume calculations with swell factor (20-35%) for soil expansion
        - Wire Mesh: Roll calculations (100 SF per roll) with waste factor for SF items
        - Rebar: Bar count calculations based on spacing (12", 18") and rebar size (#3, #4, #5, #6) with linear footage
        - Dowels: Expansion joint dowel counts based on joint length and spacing (12" typical)
        - Sealer/Cure & Seal: Gallon calculations based on coverage rates (300-500 SF/gal) with multi-coat support
        - Underlayment/Vapor Barrier: Square footage with overlap and waste calculations for plastic sheeting
        Features collapsible UI with material badges, real-time calculations, and job totals summary card. Material calculator appears conditionally for SF/LF units with CONCRETE, EXCAVATION, and related categories.
    -   **Internal Messaging System**: Secure team communication with company-wide channel and direct messages. Features conversation list with search, message composition, unread message badges in navigation, read receipts, and mobile-responsive design. All messaging routes verify participant membership before allowing access (403 for unauthorized users). Company channel auto-created for all users.
    -   **Bid Cost Builder Workflow**: Guided 5-step process for building bid costs with real-time financial aggregation. Steps: (1) Materials & Supplies - supplier quotes with selection, (2) Equipment - owned fleet and rental selections with cost calculations, (3) Scope of Work - estimate line items and labor, (4) Subcontractors - sub quotes with scope linking, (5) Bid Summary - cost aggregation with overhead slider (0-30%), profit margin slider (0-40%), and final bid calculation. Features vertical stepper navigation with cost subtotals per step, running totals sidebar, and step completion indicators.
    -   **Equipment Management System**: Comprehensive fleet and tool tracking with equipment catalog (make, model, year, serial number, current hours), project assignment tracking with availability status, repair workflow with vendor tracking and cost monitoring, preventative maintenance scheduling based on hours or calendar intervals, and weekly hour entry reminders for project managers. Equipment types include Heavy Equipment, Vehicles, Power Tools, Hand Tools, Trailers, and specialized categories. RBAC restricts access to ADMIN, MANAGER, SUPERINTENDENT, and MAINTENANCE_MANAGER roles. Features include:
        - Equipment detail page with Overview, Assignments, Repairs, Hour Logs, and Preventative Maintenance tabs
        - AI-powered maintenance recommendations using GPT-4o for repair tasks, parts suggestions, and preventative maintenance schedules
        - Preventative Maintenance tab with AI-generated schedule based on equipment make, model, type, and current hours
        - Maintenance schedules with status indicators (Overdue, Due Soon, On Schedule) based on hours or calendar intervals
        - Maintenance completion workflow with labor/parts cost tracking, vendor information, and automatic next-due-date calculations
        - Maintenance history table showing all completed maintenance tasks
        - Equipment assignment to projects with expected return date tracking
        - Equipment return workflow with condition reporting and hour updates
        - Weekly hour logging with fuel usage tracking
        - Equipment tab on project detail page showing all equipment assigned to the project
        - Maintenance notification system routing repair requests to Maintenance Managers and admins

## Testing Credentials
-   **Manager Account**: manager2@tfr.com / TFR2025! (MANAGER role)

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database.
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
-   **OpenAI GPT-4**: Powers AI functionalities.
-   **JWT**: For authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For file upload progress tracking.
-   **node-cron**: For scheduling backend tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing, document processing, and PDF rendering in the takeoff engine.