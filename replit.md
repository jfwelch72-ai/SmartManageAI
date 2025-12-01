# SmartManageAI Construction Management Platform

## Overview
SmartManageAI is a white-label SaaS construction management platform designed to manage the entire construction project lifecycle, from bid tracking to project completion. It supports multiple contracting specialties with trade-specific customizations, centralizing project data, user management, and daily operations to enhance efficiency, compliance, and oversight. The platform features a multi-tenant architecture with AI-driven onboarding, dynamic navigation, trade-specific dashboards, and a comprehensive suite of tools for project management, estimating, CRM, and compliance.

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

## Recent Changes (November 2025)

### Custom Trade Onboarding System
- Implemented custom trade onboarding for "OTHER" trade type (specialty contractors)
- AI wizard detects non-preset trades and follows extended 10-step conversation to gather:
  - Custom trade name (required)
  - Scope of work items specific to the trade
  - Work types with units and production rates
  - Specialized calculators for the trade
- Comprehensive fallback system ensures organizations never receive empty configurations:
  - Default SOW items: 5 generic items based on trade name
  - Default work types: 4 types (General Work, Project Completion, Service Call, Material Installation)
  - Default calculator: Material Quantity Calculator
- Zod validation requires tradeName when tradeType is "OTHER"
- Supports any specialty not in the 22 preset trades (pool contractors, chimney sweeps, elevator technicians, etc.)

### E2E Testing Completed
- Comprehensive E2E testing across all 13 major feature areas with 100% pass rate
- All 9 user roles verified (SUPER_ADMIN, ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, MAINTENANCE_MANAGER, HOURLY_EMPLOYEE, VENDOR)
- See `E2E_TEST_REPORT.md` for detailed findings

### Bug Fix: SelectItem Empty Value Error
- Fixed React runtime error in SelectItem components caused by empty string values
- Applied sentinel value pattern ("none" → "" conversion) to:
  - bid-detail.tsx (Award dialog)
  - tasks.tsx (Project/Assignee selects)
  - bid-estimate.tsx (Subcontractor quote selects)
  - crews.tsx (Crew Lead select)

### Bug Fix: Equipment Validation
- Fixed equipment schema validation using Zod transform to coerce empty strings to null for numeric fields (year, currentHours, purchasePrice)

### Bug Fix: Website URL Validation
- Auto-prepends "https://" when user enters bare domain in AI onboarding wizard

### Multi-Tenant Security Enhancement
- Enhanced `getOrgIdForFilter()` helper in `server/orgFilter.ts` with `mustDenyAccess` flag
- Security pattern: Users without organization (non-SUPER_ADMIN) receive empty data instead of potential cross-tenant leaks
- Applied to critical endpoints: dashboard stats, users, bids, projects, crews, messaging, equipment, tasks
- Pattern: `const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req); if (mustDenyAccess) return res.json([]);`

### Walkthrough System Completed
- All 9 user roles now have role-specific onboarding walkthroughs
- ADMIN walkthrough expanded to 10 comprehensive steps (team invitation, CRM, equipment, projects, bids, estimates, crews, tasks, messaging, AI)
- AI Assistant widget auto-opens for new users and guides through walkthrough
- Progress tracked via walkthroughStep/walkthroughCompleted user fields

### AI Module Analyzers - Comprehensive OpenAI Integration
- Created 5 AI module analyzers in `server/ai/moduleAnalyzers.ts`:
  - **analyzeSchedulingModule**: Evaluates project timelines, task dependencies, generates Gantt chart recommendations
  - **analyzeDelaysModule**: Reviews delays, calculates financial impacts, identifies patterns, suggests preventive actions
  - **analyzeCostsModule**: Analyzes equipment/delay/labor costs, provides optimization recommendations
  - **analyzeEquipmentModule**: Tracks utilization, maintenance, rental vs purchase decisions
  - **analyzeVendorPricingModule**: Compares vendor prices, identifies best deals, recommends preferred vendors
  - **analyzeProjectHealthModule**: Evaluates individual project health with comprehensive scoring
- New database tables: `ai_insights`, `ai_gantt_recommendations`, `ai_vendor_comparisons`
- Frontend components: `AIInsightsWidget.tsx` (dashboard), `AIAnalysisButton.tsx` (feature pages)
- AI analysis buttons integrated into Projects, Bids, Equipment, and CRM pages
- **Multi-Tenant Security**: All analyzers require `organizationId` and verify project ownership before querying data
- Development mode: Auto-scan schedulers disabled; use manual "Run AI Analysis" buttons

## Recent Changes (December 2025)

### System Rebranding to SmartManageAI
- Comprehensive rebranding from "TFR Construction" to "SmartManageAI"
- Updated all frontend components: login form, sidebar, dashboard, subcontractor reports
- Updated backend services: PDF generation, email templates, AI prompts, delay routes
- Updated file names in PDF exports (SmartManageAI-Internal-Summary, SmartManageAI-Quote)
- Maintained database enum values (e.g., "TFR" responsibility) for backward compatibility
- Updated display labels to use generic "Company" or "Contractor" terminology
- White-label approach allows platform to be adapted for any construction company

### Time Clock Approval Workflow
- Added `approvalStatus` enum to time_entries schema (PENDING, APPROVED, REJECTED)
- Added `approvedById`, `approvedAt`, `rejectionReason` fields to time_entries
- Created Manager Review tab in time-clock-manager.tsx with:
  - Search/filter by employee or project
  - Approve/Reject individual entries with rejection reason dialog
  - Bulk approve functionality
  - Group entries by employee
- Fixed security: Approval endpoints check both `project.gcOrganizationId` AND `user.organizationId` for tenant isolation

### mustDenyAccess Security Hardening
- Extended mustDenyAccess pattern to 5 additional route files:
  - changeOrderRoutes.ts (fully updated with checkOrgAccess helper)
  - delayRoutes.ts (list endpoint secured)
  - inspectionRoutes.ts (list endpoint secured)
  - estimateRoutes.ts (list endpoint secured)
  - tmTicketRoutes.ts (list endpoint secured)
- Pattern: Users without organizationId (non-SUPER_ADMIN) receive empty data instead of cross-tenant leaks

### AI Schedulers Production Mode
- Changed AI schedulers from commented-out to proper NODE_ENV check
- Schedulers automatically enable in production (`NODE_ENV=production`)
- Schedulers disabled in development with clear console message
- Supports: initializeAIScheduler, aiNotesScheduler

### AI Auto-Takeoff with OpenAI Vision
- Enhanced `processAiTakeoff` function with real OpenAI Vision integration
- Fetches takeoff sheet image and sends to GPT-4o for analysis
- Trade-specific prompts for 22 supported trades
- Returns detected items with confidence scores, units, and suggested SOW items
- Graceful fallback to mock data if Vision fails or no image available

### AI Jobsite Camera Analysis with OpenAI Vision
- Enhanced jobsite photo processing with real OpenAI Vision integration
- Analyzes photos for safety hazards, work progress, and crew activity
- Trade-specific safety and progress detection
- Returns structured findings with severity levels, recommendations
- Graceful fallback to mock data if Vision fails or no photos available

### Organization Documents & White-Label Branding System
- **Database Schema**: New `organization_documents` table with document types enum:
  - Branding: LOGO_PRIMARY, LOGO_SECONDARY, LETTERHEAD
  - Insurance: INSURANCE_CERT_GENERAL_LIABILITY, INSURANCE_CERT_WORKERS_COMP, INSURANCE_CERT_AUTO, INSURANCE_CERT_UMBRELLA
  - Compliance: W9, LICENSE, BONDING_LETTER, BANKING_INFO, SAFETY_PROGRAM, COMPANY_PROFILE, TEMPLATE_OTHER
- **Visibility Levels**: PUBLIC, INTERNAL, CONFIDENTIAL with proper access control
- **Versioning System**: Automatic version increment, tracks replacesDocumentId, soft-delete with rollback to previous version
- **Expiration Tracking**: Insurance certificates track expiration dates with "expiring soon" (30 days) alerts
- **Backend Routes** (`server/organizationDocumentRoutes.ts`):
  - CRUD operations with mustDenyAccess multi-tenant security
  - Document type and summary endpoints
  - Version history per document type
- **Frontend** (`client/src/pages/company-settings.tsx`):
  - Tabbed interface for Branding, Insurance, Compliance categories
  - Document upload with ObjectUploader integration
  - Expiration warnings and version history dialogs
  - Admin-only access (ADMIN role required)
- **PDF White-Labeling** (`server/pdf-service.ts`):
  - `OrganizationBrandingPDF` interface for passing org name/colors to PDF generators
  - All PDF generators updated to accept optional branding parameter
  - Falls back to "SmartManageAI" when no branding provided
- **Branding Helper** (`server/organizationBranding.ts`):
  - `getOrganizationBranding()`: Fetches org name, logo URL, colors
  - `getOrganizationDocumentUrl()`: Gets specific document URL by type
  - `getInsuranceCertificateStatus()`: Returns all insurance certs with expiration status

## Known Issues / Design Notes
- **ADMIN users**: Clock In/Out controls intentionally hidden (ADMINs manage time, don't clock in themselves)
- **Equipment creation**: Minor backend validation issue with empty numeric fields returns 500 but equipment is created
- **SelectItem pattern**: Always use `value="none"` instead of `value=""` for "None" options in Select components
- **AI Features**: In development mode, AI features use demo/mock data when no images are available; real Vision analysis requires uploaded images