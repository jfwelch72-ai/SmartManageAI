# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is an internal tool for TFR Construction, designed to manage the entire project lifecycle from bid tracking to project completion. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform aims to integrate AI for operational intelligence, streamline crew and subcontractor management, and ensure high data quality within the construction management process.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack for robustness and comprehensive functionality, adhering to a client-server architecture with a strong emphasis on security, scalability, and user experience.

-   **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, styled with Tailwind CSS and shadcn/ui.
-   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL on Neon, managed with Drizzle ORM. Bid-Estimate-Project integration uses nullable bidId/projectId with a CHECK constraint and ON DELETE SET NULL for bidId (preserves estimates when bids are deleted). Quote transfer automatically creates subcontractor contracts and procurement items during bid-to-project conversion.
-   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, Role-Based Access Control (RBAC) across six user roles, and self-service registration.
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
    -   **Production Rate Tracking**: Analyzes historical field data from daily scope progress entries to compute production benchmarks for estimating, aggregating by work type with various statistics and filtering options.
    -   **CRM System**: Comprehensive relationship management for CONTRACTOR, SUBCONTRACTOR, SUPPLIER, and VENDOR entities. Features organization management, multi-contact per organization, search/filter, and RBAC.

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database.
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
-   **OpenAI GPT-4**: Powers AI functionalities.
-   **JWT**: For authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For file upload progress tracking.
-   **node-cron**: For scheduling backend tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing, document processing, and PDF rendering in the takeoff engine.