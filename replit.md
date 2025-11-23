# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is an internal tool for TFR Construction, designed to manage the entire project lifecycle from bid tracking to project completion. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform aims to integrate AI for operational intelligence, streamline crew and subcontractor management, and ensure high data quality within the construction management process.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack for robustness and comprehensive functionality, adhering to a client-server architecture with a strong emphasis on security, scalability, and user experience.

-   **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, styled with Tailwind CSS and shadcn/ui.
-   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL on Neon, managed with Drizzle ORM, supporting various modules including audit logs, billing, time clock, AI operations, and project management.
-   **Authentication**: JWT-based authentication using httpOnly cookies, bcrypt for password hashing, and token versioning, featuring Role-Based Access Control (RBAC) across six user roles and self-service registration.
-   **Security**: Multi-layered protection including rate limiting, comprehensive audit logging, and file validation.
-   **UI/UX**: Clean, functional interface built with shadcn/ui components and Tailwind CSS with a focus on intuitive project management workflows.
-   **Key Features**:
    -   **Authentication & Authorization**: Secure JWT with RBAC for granular access control.
    -   **User Management**: Admin tools for managing accounts, roles, and user activation.
    -   **Time-Clock System**: Native time-clock with GPS, shift management, and approval workflows.
    -   **Audit & Compliance**: Comprehensive audit logging for all critical actions.
    -   **Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, and Change Orders, including a strict Change-Order State Machine and attachment management with file uploads (images, PDFs, CAD, Office docs) and RBAC. Support for change order deductions and adjusted contract calculations.
    -   **Daily Notes & Company Communications**: System for project-specific and company-wide daily communications with filtering, inline editing, and AI-powered analysis for actionable task generation, smart routing of insights, and severity levels.
    -   **Daily Operations**: Media uploads and daily scope progress tracking with quantity completion and billing status management.
    -   **AI Senior PM + CFO System**: AI-driven task generation, profitability analysis, scheduling, ordering, bid tracking, and billing automation.
    -   **Takeoff + Estimating Engine**: Comprehensive system for managing project plans, interactive drawing tools (Linear, Area, Volume, Count, Arc/Radius), measurement persistence, quantity summaries, and multi-page PDF rendering. **Phase 2 Complete (Production-Ready):** (1) 5px click vs. drag threshold with Stage drag lifecycle tracking to prevent accidental measurements during pan operations, (2) Advanced pan/zoom with hand tool, spacebar temporary pan (hold to pan, release to restore tool), and cursor-centered mouse wheel zoom with synchronized Stage position during drag to prevent snap-back, (3) Arc tool with 3-point workflow (start, middle, end) where backend computes arc length via geometry utilities and stores in `computedLengthFt` for accurate curved measurements, (4) Comprehensive keyboard shortcuts (L/A/V/C/N/R/S/H, Shift+C, Delete, Esc, ?) with smart guards for text inputs, Radix UI portals, iframes, and multi-point drawing workflows. **Known Limitation:** Konva canvas does not respond to Playwright synthetic pointer events, requiring manual testing for canvas interactions.
    -   **File Storage & Permissions**: Management via Replit Object Storage with presigned URLs and granular ACLs.
    -   **Billing Status Workflow**: Production-grade workflow for managing billing lifecycle from field recording to invoicing, with strict RBAC and audit trails.

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database.
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
-   **OpenAI GPT-4**: Powers AI functionalities including Senior PM + CFO system and note analysis.
-   **JWT**: For authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For file upload progress tracking.
-   **node-cron**: For scheduling backend tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing, document processing, and PDF rendering in the takeoff engine.