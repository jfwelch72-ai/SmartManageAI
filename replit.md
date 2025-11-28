# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is an internal tool designed to manage the entire construction project lifecycle, from bid tracking to project completion. It centralizes project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform aims to integrate AI for operational intelligence, streamline crew and subcontractor management, and ensure high data quality within the construction management process. The business vision is to provide a comprehensive, intelligent system that improves project profitability, reduces administrative burden, and offers a competitive edge in the construction market.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform utilizes a modern web stack with a client-server architecture, prioritizing security, scalability, and user experience.

-   **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, styled with Tailwind CSS and shadcn/ui. The UI/UX focuses on a clean, functional interface and intuitive project management workflows.
-   **Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
-   **Database**: PostgreSQL on Neon, managed with Drizzle ORM. The database design supports bid-to-project conversion and quote preservation.
-   **Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, and Role-Based Access Control (RBAC) across seven distinct user roles.
-   **Security**: Multi-layered protection including rate limiting, comprehensive audit logging, and file validation.
-   **Key Features**:
    -   **Personalized Dashboard**: Role-based landing page with quick navigation and overview of active projects, bids, messages, events, and delay alerts.
    -   **Comprehensive Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material (T&M) Tracking with advanced workflows, attachment management, and billing status tracking.
    -   **Project Delay Tracking System**: Track project delays with comprehensive documentation including:
        - Delay Reasons: Weather, GC Scheduling, Other Contractors, Material Delivery, Permit Issues, Inspection Delay, Owner Directive, Design Changes, Site Conditions, Labor Shortage
        - Status Workflow: DRAFT → SUBMITTED → ACKNOWLEDGED → RESOLVED
        - Financial Responsibility Tracking: Owner, GC, Subcontractor, TFR, Force Majeure
        - Proof Documentation: File uploads for evidence (emails, photos, reports)
        - Change Order Integration: Auto-link delays to change orders for cost recovery
        - CRM Integration: Link Owner Rep and GC Rep contacts from CRM
        - RBAC: SUPERINTENDENT+ can create/edit delays, ADMIN/MANAGER can acknowledge
    -   **AI Integration**: AI Senior PM + CFO System for task generation, profitability analysis, scheduling, and billing automation, including Lead Time Intelligence. AI-powered maintenance recommendations for equipment.
    -   **Takeoff & Estimating Engine**: Interactive drawing tools for linear, area, volume, and count measurements, supporting multi-page PDF rendering and a comprehensive material calculator.
    -   **CRM System**: Management for various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing and rental equipment catalogs.
    -   **Time-Clock System**: Native time-clock with GPS, shift management, and project labor hour tracking.
    -   **Audit & Compliance**: Comprehensive audit logging for all critical actions.
    -   **Production Rate Tracking**: Analyzes historical field data to compute production benchmarks across various work types.
    -   **Internal Messaging System**: Secure team communication with company-wide and direct messages, including read receipts and role-based access.
    -   **Bid Cost Builder Workflow**: A guided 5-step process for cost estimation, incorporating SOW-driven requirements, vendor pricing, and PDF generation for internal summaries and customer quotes.
    -   **Equipment Management System**: Comprehensive fleet and tool tracking, including project assignment, repair workflows, preventative maintenance scheduling, and hour logging.

## External Dependencies
-   **PostgreSQL (Neon)**: Primary database service.
-   **Replit Object Storage (Google Cloud Storage backend)**: For file storage and management.
-   **OpenAI GPT-4**: Powers AI functionalities and recommendations.
-   **JWT**: Used for secure authentication and authorization.
-   **Bcrypt**: Used for password hashing.
-   **Uppy**: Utilized for enhanced file upload experiences.
-   **node-cron**: For scheduling backend tasks.
-   **react-konva, konva, pdfjs-dist, xlsx**: Libraries for interactive drawing, PDF rendering, and document processing within the takeoff engine.