# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is an internal tool for TFR Construction, managing the entire project lifecycle from bid tracking to project completion. Built with TypeScript, React, and PostgreSQL, its core purpose is to centralize project data, user management, and daily operations to boost efficiency and oversight. The platform aims to enhance compliance, integrate AI for operational intelligence, streamline crew and subcontractor management, and ensure high data quality.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform features a modern web stack designed for robustness and comprehensive functionality:

-   **Frontend**: React with TypeScript, utilizing Wouter for routing, TanStack Query for data management, and styled with Tailwind CSS and shadcn/ui for a responsive user experience.
-   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL on Neon, managed with Drizzle ORM. The schema supports audit logs, billing, time clock, AI operations, crew/skills, equipment, data quality, and subcontractor management.
-   **Authentication**: JWT-based authentication using httpOnly cookies, bcrypt for password hashing, and token versioning, featuring RBAC across six user roles and self-service registration.
-   **Security**: Multi-layered protection including rate limiting, comprehensive audit logging, and file validation.
-   **UI/UX**: Clean, functional interface built with shadcn/ui components and Tailwind CSS.
-   **Key Features**:
    -   **Authentication & Authorization**: Secure JWT with RBAC.
    -   **User Management**: Admin tools for accounts, roles, and activation.
    -   **Time-Clock System**: Native time-clock with GPS, shift management, and approvals.
    -   **Audit & Compliance**: Comprehensive audit logging.
    -   **Billing Events**: Financial tracking for various billing events.
    -   **Project Lifecycle Management**: CRUD for Bids, Projects, Estimates, Procurement, and Change Orders, including a strict Change-Order State Machine.
    -   **Daily Operations**: Project notes, media uploads, and daily progress.
    -   **Time & Materials**: Time entry with approval workflows.
    -   **Calendar & Time-Off**: Event and time-off request management.
    -   **Dashboard**: Real-time KPIs and navigation.
    -   **File Storage & Permissions**: Management via Replit Object Storage with presigned URLs and granular ACLs.
    -   **AI Senior PM + CFO System**: AI-driven task generation, profitability analysis, scheduling, ordering, bid tracking, and billing automation using OpenAI GPT-4, including role-specific tasks and CFO-level financial analysis.
    -   **Takeoff + Estimating Engine**: Comprehensive system for managing project plans, interactive drawing tools (linear, area, volume, count, note), measurement persistence, and quantity summaries. Includes document viewing, import of PDF plans, and integration with project details.

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database.
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
-   **OpenAI GPT-4**: Powers the AI Senior PM + CFO system.
-   **JWT**: For authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For file upload progress tracking.
-   **node-cron**: For scheduling tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: For interactive drawing and document processing in the takeoff engine.