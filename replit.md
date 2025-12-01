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
*   **Multi-Tenant Architecture**: Supports distinct organizations with trade-specific configurations, self-service registration, and AI-driven onboarding. Includes General Contractor (GC) mode and custom trade onboarding for specialties not in preset trades.
*   **Trade-Specific Features System**: Dynamic functionality based on an organization's trade type, including APIs, navigation, dashboards, units of measure, and master scope of work items.
*   **Comprehensive Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material (T&M) Tracking. Includes a guided 5-step Bid Cost Builder Workflow.
*   **Project Tracking Systems**: Comprehensive Project Delay Tracking System and an Inspection Scheduling System.
*   **AI Integration**: Features an AI Senior PM + CFO System for various tasks (generation, analysis, scheduling, automation). Includes AI Auto-Takeoff (with OpenAI Vision), AI Scheduling Assistant, AI Jobsite Camera Analysis (with OpenAI Vision), Vendor Pricing Sync, Client Portal, AI Change Order Generator, and Mobile/Offline Mode. New AI module analyzers (Scheduling, Delays, Costs, Equipment, Vendor Pricing, Project Health) and AI Bid Document Analysis (with OpenAI Vision) are integrated.
*   **Takeoff & Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, and a material calculator.
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing and rental equipment catalogs.
*   **Time-Clock System**: Native time-clock with GPS, shift management, labor hour tracking, and a Manager Approval Workflow.
*   **Audit & Compliance**: Comprehensive audit logging and a system for managing Organization Documents (branding, insurance, compliance) with versioning, expiration tracking, and multi-tenant security.
*   **Production Rate Tracking**: Analyzes historical data for production benchmarks.
*   **Internal Messaging System**: Secure team communication.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.
*   **White-Label Branding**: System-wide rebranding capabilities, including PDF generation and dynamic organization branding.
*   **Onboarding Walkthrough System**: Role-specific onboarding walkthroughs for all user roles, guided by an AI Assistant.

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4 / GPT-4o**: Powers AI functionalities including Vision for image analysis.
*   **JWT**: For secure authentication and authorization.
*   **Bcrypt**: For password hashing.
*   **Uppy**: For enhanced file uploads.
*   **node-cron**: For scheduling backend tasks.
*   **react-konva, konva, pdfjs-dist, xlsx**: Libraries for interactive drawing, PDF rendering, and document processing.