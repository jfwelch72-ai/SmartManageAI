# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is a white-label SaaS solution designed to manage the entire construction project lifecycle, from bid tracking to project completion. It supports multiple contracting specialties with trade-specific customizations, centralizing project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform features a multi-tenant architecture with AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite of tools for project management, estimating, CRM, and compliance.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform employs a modern web stack, prioritizing security, scalability, and user experience.

**Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data management, styled with Tailwind CSS and shadcn/ui.
**Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
**Database**: PostgreSQL on Neon, managed with Drizzle ORM.
**Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, and Role-Based Access Control (RBAC) across eight user roles, including a platform-level SUPER_ADMIN.
**Security**: Multi-layered protection including rate limiting, comprehensive audit logging, and file validation.

**Key Architectural Decisions & Features**:
*   **Multi-Tenant Architecture**: Supports distinct organizations with trade-specific configurations, self-service registration, and AI-driven onboarding that extracts trade type, crew size, region, materials, and optionally website brand colors for theme customization. Includes General Contractor (GC) mode with access to all trade templates and messaging isolation per organization.
*   **Trade-Specific Features System**: Dynamic functionality based on an organization's trade type, including trade-specific APIs, navigation menus, dashboard widgets, standardized units of measure (UOM), and master scope of work (SOW) items.
*   **Comprehensive Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material (T&M) Tracking.
*   **Project Delay Tracking System**: Comprehensive tracking of project delays with defined reasons, status workflows, financial responsibility, proof documentation, and integration with change orders and CRM.
*   **Inspection Scheduling System**: Manages scheduling and tracking of various inspection types with status workflows, contact management, PDF generation, and email notifications.
*   **AI Integration**: AI Senior PM + CFO System for task generation, profitability analysis, scheduling, billing automation, and lead time intelligence. Includes seven major AI-enhanced features: AI Auto-Takeoff, AI Scheduling Assistant, AI Jobsite Camera Analysis, Vendor Pricing Sync, Client Portal, AI Change Order Generator, and Mobile/Offline Mode.
*   **Takeoff & Estimating Engine**: Interactive drawing tools for measurements, multi-page PDF rendering, and a material calculator.
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing and rental equipment catalogs.
*   **Time-Clock System**: Native time-clock with GPS, shift management, and labor hour tracking.
*   **Audit & Compliance**: Comprehensive audit logging for all critical actions.
*   **Production Rate Tracking**: Analyzes historical data for production benchmarks.
*   **Internal Messaging System**: Secure team communication with company-wide and direct messages.
*   **Bid Cost Builder Workflow**: A guided 5-step process for cost estimation, integrating SOW, vendor pricing, and PDF generation.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4**: Powers AI functionalities.
*   **JWT**: For secure authentication and authorization.
*   **Bcrypt**: For password hashing.
*   **Uppy**: For enhanced file uploads.
*   **node-cron**: For scheduling backend tasks.
*   **react-konva, konva, pdfjs-dist, xlsx**: Libraries for interactive drawing, PDF rendering, and document processing.