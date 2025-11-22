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
    -   **Daily Operations**: Project notes, media uploads, and daily scope progress tracking with quantity completion and billing status management.
    -   **AI Senior PM + CFO System**: AI-driven task generation, profitability analysis, scheduling, ordering, bid tracking, and billing automation.
    -   **Takeoff + Estimating Engine**: Comprehensive system for managing project plans, interactive drawing tools, measurement persistence, quantity summaries, and multi-page PDF rendering.
    -   **File Storage & Permissions**: Management via Replit Object Storage with presigned URLs and granular ACLs.
    -   **Daily Scope Progress Tracking**: Enables daily tracking of scope item completion quantities, billed quantities, and billing status changes with dedicated API endpoints and UI components for management and visualization.

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database with HTTP driver (neon-http).
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
-   **OpenAI GPT-4**: Powers the AI Senior PM + CFO system.
-   **JWT**: For authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For file upload progress tracking.
-   **node-cron**: For scheduling tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing, document processing, and PDF rendering in the takeoff engine.