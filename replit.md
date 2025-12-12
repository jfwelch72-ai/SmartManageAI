# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS construction management platform designed to manage the entire construction project lifecycle, from bid tracking to project completion. It supports multiple contracting specialties with trade-specific customizations, centralizing project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform features a multi-tenant architecture with AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite of tools for project management, estimating, CRM, and compliance. The vision is to provide a robust, scalable solution that adapts to various construction trades, improving project outcomes and operational efficiency for its users.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform employs a modern web stack, prioritizing security, scalability, and user experience.

**Frontend**: React with TypeScript, Wouter, TanStack Query, Tailwind CSS, and shadcn/ui.
**Backend**: Express.js in TypeScript, secured with CORS, rate limiting, and JWT token versioning.
**Database**: PostgreSQL on Neon, managed with Drizzle ORM.
**Authentication**: JWT-based with httpOnly cookies, bcrypt for password hashing, token versioning, and Role-Based Access Control (RBAC) across ten user roles.
**Security**: Multi-layered protection including rate limiting, audit logging, file validation, and multi-tenant access control.

**Key Architectural Decisions & Features**:
*   **Multi-Tenant Architecture**: Supports distinct organizations with trade-specific configurations, self-service registration, and AI-driven onboarding (General Contractor mode and custom trade onboarding).
*   **Trade-Specific Features System**: Dynamic functionality based on an organization's trade type, including APIs, navigation, dashboards, units of measure, and master scope of work items across 23 trade templates.
*   **Master Scope of Work (SOW) System**: Comprehensive database of 392 master scope items across 23 trade templates, supporting user-defined scope items for custom trades.
*   **Comprehensive Project Lifecycle Management**: CRUD operations for Bids, Projects, Estimates, Procurement, Change Orders, and Time & Material Tracking, including a guided 5-step Bid Cost Builder Workflow.
*   **Project Tracking Systems**: Project Delay Tracking and Inspection Scheduling.
*   **AI Integration**: Features an AI Senior PM + CFO System for generation, analysis, scheduling, and automation. Includes AI Auto-Takeoff (OpenAI Vision), AI Scheduling Assistant, AI Jobsite Camera Analysis, Vendor Pricing Sync, Client Portal, AI Change Order Generator, Mobile/Offline Mode, and various AI module analyzers.
*   **Takeoff & Estimating Engine**: Interactive drawing tools, multi-page PDF rendering, and an enhanced material calculator for concrete, stone sub-base, excavation, wire mesh, rebar, dowels, sealer, and underlayment, with a preset system.
*   **Hierarchical Line Item Builder**: Progressive selection interface for adding estimate line items, supporting both "Guided Selection" and "Manual Entry" modes. Uses `organizationSowItems` table for scope data.
*   **CRM System**: Manages various organizational entities (CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP) with vendor pricing and rental equipment catalogs.
*   **Time-Clock System**: Native time-clock with GPS, shift management, labor hour tracking, and Manager Approval Workflow.
*   **Audit & Compliance**: Comprehensive audit logging and a system for managing Organization Documents with versioning and expiration tracking.
*   **Production Rate Tracking & Auto-Population**: Comprehensive production analytics system that tracks crew productivity, labor cost per UOM, material cost per UOM (from budgeted estimates), and profitability per UOM. Auto-captures metrics when time clock shifts are approved, linking to scope items worked. Features a Cost Analytics dashboard with KPI cards, sortable metrics table by description/unit, and confidence scoring (HIGH/MEDIUM/LOW based on data quantity). Supports quantity-size bucketing for size-based analysis. Integrates with AI Orchestrator for profitability insights and AI Assistant for natural language production rate queries.
*   **Internal Messaging System**: Secure team communication.
*   **Equipment Management System**: Fleet and tool tracking, project assignment, repair workflows, and preventative maintenance.
*   **White-Label Branding**: System-wide rebranding capabilities for the platform and PDF generation.
*   **Onboarding Walkthrough System**: Role-specific onboarding walkthroughs guided by an AI Assistant.
*   **Email AI System**: Comprehensive email management with AI-powered classification and task extraction across 15 categories, supporting Gmail, Outlook, and IMAP/SMTP providers.
*   **Subcontractor Payables Workflow System**: Automates payable creation upon subcontract completion with a workflow (PENDING → APPROVED → PAID), KPI dashboard, and role-based approvals.
*   **Website Builder System**: White-label website management with modules for Setup, Page Builder, Blog, Project Gallery, Social Media, Analytics, SEO, and an AI Design Assistant.
*   **Labor Cost Rate Management System**: Calculates employee costs using job classifications, employee assignments, and prevailing wage rates.
*   **AI-Powered Bid Wizard**: Multi-step bid creation workflow featuring AI document analysis (OpenAI GPT-4o) to extract project information and scope items.
*   **Dashboard Customization System**: User dashboard personalization with admin-controlled permissions, editable widgets, customizable color schemes, and WCAG AA accessibility compliance.
*   **HUSTLER Multi-Organization System**: Specialized user role for business owners managing multiple organizations, with an organization switcher, executive dashboard, COO delegation, and AI-powered portfolio insights.
*   **Subcontractor Bid Request Network**: Platform-wide bid solicitation network allowing GCs to request bids from platform-member subcontractors with trade matching, invitation system, response workflow, clarifications, and status tracking.
*   **Unified Task Model**: Consolidates manual, email-originated, and AI-generated tasks, with email-specific fields for linking.
*   **Operational Infrastructure**: Structured logging utility, monitoring hooks, health, and readiness probes.
*   **Subscription & Billing System**: 4-tier membership model (FREE, STARTER, PROFESSIONAL, ENTERPRISE) with 6 add-ons (AI PM, AI CFO, AI Email, Website Builder, Bid Network, AI Vision). Backend feature gating via `requireFeature` middleware, frontend gating via `FeatureGate` component and `useEntitlements` hook. Plan matrix and pricing defined in `shared/billing/plans.ts`. Supports manual billing mode for development/testing.

## External Dependencies
*   **PostgreSQL (Neon)**: Primary database service.
*   **Replit Object Storage (Google Cloud Storage backend)**: For file storage.
*   **OpenAI GPT-4 / GPT-4o**: Powers AI functionalities including Vision.
*   **JWT**: For secure authentication and authorization.
*   **Bcrypt**: For password hashing.
*   **Uppy**: For enhanced file uploads.
*   **node-cron**: For scheduling backend tasks.
*   **react-konva, konva, pdfjs-dist, xlsx**: Libraries for interactive drawing, PDF rendering, and document processing.