# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is a comprehensive internal tool designed for TFR Construction. Its primary purpose is to manage the entire project lifecycle, from bid tracking through project completion, using TypeScript, React, and PostgreSQL. The platform aims to centralize project data, user management, and daily operations to enhance efficiency and oversight across all construction activities. Key ambitions include improving compliance tracking, leveraging AI for operations, streamlining crew and subcontractor management, and ensuring robust data quality monitoring.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack with a focus on robust architecture and comprehensive features:

-   **Frontend**: React with TypeScript, employing Wouter for routing, TanStack Query for data fetching (with hierarchical array query keys), and styled with Tailwind CSS and shadcn/ui components for a responsive interface.
-   **Backend**: Express.js server in TypeScript, incorporating comprehensive security measures including CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL, hosted on Neon, managed with Drizzle ORM. The schema includes 33 tables covering audit logs, billing events, time clock management, AI operations, crew and skill management, equipment, data quality tracking, and comprehensive subcontractor management.
-   **Authentication**: JWT-based authentication using httpOnly cookies, bcrypt for password hashing, and token versioning for session revocation. Features RBAC with six user roles and self-service registration.
-   **Security**: Multi-layer protection with rate limiting (auth, sensitive, API), comprehensive audit logging for all sensitive operations, and file validation (MIME types, size limits).
-   **UI/UX**: Clean, functional interface designed with shadcn/ui components and Tailwind CSS.
-   **Key Features**:
    -   **Authentication & Authorization**: Secure JWT system with token versioning and role-based access control across six distinct user roles.
    -   **User Management**: Admin interface for managing accounts, roles, activation, and force-logout.
    -   **Time-Clock System**: Native time-clock with GPS tracking, shift management, manager approvals, and time-entry generation.
    -   **Audit & Compliance**: Comprehensive audit logging for all critical actions with admin-accessible query interface.
    -   **Billing Events**: Financial tracking for invoice, payment, change order, retention, and lien waiver events.
    -   **Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, and Change Orders, including bid-to-project conversion and project status tracking. Includes a strict Change-Order State Machine.
    -   **Daily Operations**: Features for project notes, media uploads, and daily progress updates.
    -   **Time & Materials**: Time entry system with approval workflows and locked entries for billing integrity.
    -   **Calendar & Time-Off**: Monthly calendar view for events and time-off request management.
    -   **Dashboard**: Real-time KPI metrics and quick navigation.
    -   **File Storage & Permissions**: Comprehensive file management using Replit Object Storage with presigned URLs, granular ACLs, and metadata management.
    -   **AI Senior PM + CFO System**: AI-powered daily operating system using OpenAI GPT-4 for automated task generation, profitability analysis, crew scheduling, material ordering, bid tracking, and billing automation. Includes role-specific task generation, CFO-level financial analysis, and an audit trail. Encompasses cost-rate labor system, comprehensive crew and skills management, data quality scoring, and detailed subcontractor management.

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database.
-   **Replit Object Storage (Google Cloud Storage backend)**: For media, documents, and receipts storage.
-   **OpenAI GPT-4**: Powers the AI Senior PM + CFO system.
-   **JWT (JSON Web Tokens)**: For secure authentication.
-   **Bcrypt**: For password hashing.
-   **Uppy**: For robust file upload progress tracking.
-   **node-cron**: For scheduling daily AI analysis runs.