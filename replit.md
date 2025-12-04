# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS construction management platform designed to manage the entire construction project lifecycle, from bid tracking to project completion. It supports multiple contracting specialties with trade-specific customizations, centralizing project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform features a multi-tenant architecture with AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite of tools for project management, estimating, CRM, and compliance. The vision is to provide a robust, scalable solution that adapts to various construction trades, improving project outcomes and operational efficiency for its users.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform employs a modern web stack, prioritizing security, scalability, and user experience.

**Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, styled with Tailwind CSS and shadcn/ui.
**Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
**Database**: PostgreSQL on Neon, managed with Drizzle ORM.
**Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, and Role-Based Access Control (RBAC) across eight user roles, including a platform-level SUPER_ADMIN.
**Security**: Multi-layered protection including rate limiting, comprehensive audit logging, file validation, and multi-tenant access control with `mustDenyAccess` pattern to prevent cross-tenant data leaks.

**Key Architectural Decisions & Features**:
*   **Multi-Tenant Architecture**: Supports distinct organizations with trade-specific configurations, self-service registration, and AI-driven onboarding. Includes General Contractor (GC) mode and custom trade onboarding.
*   **Trade-Specific Features System**: Dynamic functionality based on an organization's trade type, including APIs, navigation, dashboards, units of measure, and master scope of work items.
*   **Comprehensive Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material (T&M) Tracking. Includes a guided 5-step Bid Cost Builder Workflow.
*   **Project Tracking Systems**: Comprehensive Project Delay Tracking System and an Inspection Scheduling System.
*   **AI Integration**: Features an AI Senior PM + CFO System for various tasks (generation, analysis, scheduling, automation). Includes AI Auto-Takeoff (with OpenAI Vision), AI Scheduling Assistant, AI Jobsite Camera Analysis (with OpenAI Vision), Vendor Pricing Sync, Client Portal, AI Change Order Generator, Mobile/Offline Mode, AI module analyzers (Scheduling, Delays, Costs, Equipment, Vendor Pricing, Project Health), and AI Bid Document Analysis (with OpenAI Vision).
*   **Takeoff & Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, and a material calculator.
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing and rental equipment catalogs.
*   **Time-Clock System**: Native time-clock with GPS, shift management, labor hour tracking, and a Manager Approval Workflow.
*   **Audit & Compliance**: Comprehensive audit logging and a system for managing Organization Documents (branding, insurance, compliance) with versioning, expiration tracking, and multi-tenant security.
*   **Production Rate Tracking & Auto-Population**: Analyzes historical data from daily scope progress entries to calculate production rate statistics (avg/min/max/median/stdDev). Features automatic labor hour estimation for estimate line items based on historical production rates, with confidence scoring (HIGH/MEDIUM/LOW/NONE). API endpoints: `/api/estimates/production-rates/suggestions`, `/api/estimates/production-rates/lookup`, `/api/estimates/production-rates/estimate-labor`, and `/api/estimates/:estimateId/line-items/auto-populate-labor`. Security: Enforces strict organization scoping - regular users query only their own org's data; super-admins must explicitly specify target organization; all unauthorized requests return uniform 404 responses to prevent cross-tenant inference.
*   **Internal Messaging System**: Secure team communication.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.
*   **White-Label Branding**: System-wide rebranding capabilities, including PDF generation and dynamic organization branding.
*   **Onboarding Walkthrough System**: Role-specific onboarding walkthroughs for all user roles, guided by an AI Assistant.
*   **Email AI System**: Comprehensive email management with AI-powered classification and task extraction across 15 categories (BID_INVITE, CHANGE_ORDER, SUBMITTAL_REQUEST, DELAY_NOTICE, SAFETY_ISSUE, APPROVAL_NEEDED, INSPECTION_REQUEST, RFI, CONTRACT_NOTICE, SCHEDULE_UPDATE, PAYMENT_NOTICE, LIEN_WAIVER, PUNCH_LIST, WARRANTY_CLAIM, GENERAL). Supports Gmail, Outlook, and IMAP/SMTP providers, offering features like task extraction, smart replies, and project integration. Uses unified tasks table with email-specific fields (emailThreadId, emailMessageId, sourceType).
*   **Subcontractor Payables Workflow System**: Automates payable creation upon subcontract completion with a workflow of PENDING → APPROVED → PAID. Includes a KPI dashboard and role-based approvals.
*   **Website Builder System**: Comprehensive white-label website management with modules for Setup, Page Builder, Blog, Project Gallery, Social Media, Analytics, SEO, and an AI Design Assistant.
*   **Labor Cost Rate Management System**: Calculates employee costs using job classifications, employee assignments, and prevailing wage rates, with a defined rate resolution priority.
*   **AI-Powered Bid Wizard**: A multi-step bid creation workflow featuring AI document analysis (OpenAI GPT-4o) to extract project information and scope items from uploaded documents, followed by estimation.
*   **Dashboard Customization System**: Comprehensive user dashboard personalization with admin-controlled permissions, edit mode toggle for safe widget management, and customizable color schemes. Features WCAG AA accessibility compliance (4.5:1 contrast ratio validation), preset themes (Default Blue, Forest Green, Sunset Orange, Ocean Blue, Royal Purple), and live preview with validation to prevent invisible text/buttons. Database tables: user_dashboard_permissions, user_dashboard_layouts, user_color_palettes.

*   **Unified Task Model**: Tasks table consolidates manual, email-originated, and AI-generated tasks with sourceType enum (EMAIL/MANUAL/AI_GENERATED/SYSTEM). Email-specific fields (emailThreadId, emailMessageId) enable email-to-task linking. Deprecated: email_tasks table (use unified tasks table instead).
*   **Operational Infrastructure**: Logger utility (server/utils/logger.ts) with levels (debug/info/warn/error), monitoring hooks (server/utils/monitoring.ts) for response time and error tracking, health endpoint (/healthz) and readiness probe (/readyz) for deployment and load balancer integration.

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4 / GPT-4o**: Powers AI functionalities including Vision for image analysis.
*   **JWT**: For secure authentication and authorization.
*   **Bcrypt**: For password hashing.
*   **Uppy**: For enhanced file uploads.
*   **node-cron**: For scheduling backend tasks.
*   **react-konva, konva, pdfjs-dist, xlsx**: Libraries for interactive drawing, PDF rendering, and document processing.