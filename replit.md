# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is a comprehensive internal tool designed for TFR Construction. Its primary purpose is to manage the entire project lifecycle, from bid tracking through project completion, using TypeScript, React, and PostgreSQL. The platform aims to centralize project data, user management, and daily operations to enhance efficiency and oversight across all construction activities. Key ambitions include improving compliance tracking, leveraging AI for operations, streamlining crew and subcontractor management, and ensuring robust data quality monitoring.

## Recent Changes (November 21, 2025)
### Time Clock & Calendar Fixes (Completed)
1. **Time Entries Page Fix**: Fixed crash caused by API returning `{data: [...], pagination: {...}}` but frontend expecting direct array
2. **Calendar Time Support**: Added time fields (start/end time) with "All Day Event" checkbox for creating timed events
3. **Calendar Clickable Events**: Made all calendar events clickable to view full details, including "+X more" indicator
4. **Admin Clock Restriction**: Hidden clock in/out controls for admin users (admins don't need to clock in/out)
5. **Active Shifts Monitoring**: Live monitoring page auto-refreshes every 15 seconds to show currently clocked-in employees

### AI Dashboard & Navigation Enhancements (Completed)
1. **Auto-Refresh AI Results**: AI PM dashboard now auto-refreshes every 5 seconds to show new tasks and analysis results without manual page refresh
2. **Success Feedback**: Added completion toast showing how many tasks were created when AI analysis finishes
3. **Back Button**: Added "Back" button on AI PM page using browser history navigation
4. **Comprehensive Navigation**: AppHeader navigation available on all pages with quick access to Dashboard, Projects, Calendar, Time Clock, AI features, and Admin tools
5. **CFO Dashboard Interactive Cards**: All CFO dashboard cards are now clickable and navigate to project detail pages - including Textura draw date alerts, missing budget warnings, and individual project profitability cards
6. **CFO Dashboard AppHeader**: Added consistent AppHeader navigation to CFO dashboard page for seamless site-wide navigation
7. **Context-Aware Back Button**: Project detail page back button now adapts based on origin - displays "Back to CFO" when coming from CFO dashboard, "Back to Projects" when coming from projects list, and navigates to the correct location

## Previous Changes (November 19, 2025)
### Backend Targeted Upgrades (Completed)
1. **Data Quality Route Fix**: Corrected bug where `calculateProjectDataQuality` received `project.id` instead of project `code`
2. **Textura Draw Date Tracking**: Added `texturaDrawDate` field to projects schema for billing deadline management
3. **Financials API Enhancement**: Updated PATCH endpoint to accept and persist `texturaDrawDate`
4. **AI Billing Urgency System**: Enhanced profitability engine with billing urgency calculations (CRITICAL ≤3 days, HIGH ≤7 days from draw date) and `daysUntilDraw` field
5. **AI Task Generation**: Updated system prompt to generate OFFICE_MANAGER tasks for upcoming draw dates with proper priority levels
6. **Subcontractor Payables API**: Enhanced to aggregate and return remaining balance (contract amount - total paid)
7. **Profitability Accuracy**: Modified to use only PAID subcontractor amounts (excluding SCHEDULED/PENDING/APPROVED) for actual cost tracking
8. **OpenAI Validation**: Added fail-fast API key validation to prevent silent failures
9. **Rate Limiting**: Applied rate limiting to manual AI run endpoint for security
10. **Schema Migration**: Successfully pushed all schema changes to production database

### Frontend Enhancements (Completed)
1. **Textura Draw Date Editor**: Added date picker in project detail financials dialog to set/update Textura draw dates
2. **CFO Dashboard Draw Alerts**: Implemented CRITICAL (≤7 days) and HIGH (≤14 days) draw date alert cards with project details and days remaining
3. **Subcontractor Payables Balance**: Added "Remaining Balance" column showing contract amount minus total paid across all subcontractors
4. **Project Detail Payment Tracking**: Enhanced subcontractor section to display total paid and remaining balance per subcontractor
5. **AI PM Dashboard Billing Tasks**: Added urgent billing tasks alert section highlighting OFFICE_MANAGER tasks related to Textura draw dates with action buttons

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