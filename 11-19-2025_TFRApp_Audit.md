# TFR CONSTRUCTION PLATFORM - COMPREHENSIVE CODE AUDIT EXPORT
**Export Date:** November 19, 2025  
**Generated For:** External Code Review and Security Audit  
**Platform:** TFR Construction Management System

---

## EXECUTIVE SUMMARY

**Project Name:** TFR Construction Management Platform  
**Technology Stack:** TypeScript, React, PostgreSQL (Neon), Express.js, Drizzle ORM, OpenAI GPT-4  
**Total Lines of Code (this export):** ~10,000+ lines  
**Total Database Tables:** 33 tables with comprehensive relationships

**Key Features:**  
- AI Senior PM + CFO (OpenAI GPT-4 powered daily analysis)
- Role-Based Access Control (6 user roles: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE)
- Native Time Clock with GPS tracking
- Comprehensive Subcontractor Management
- Real-time Profitability Engine with cost-rate labor tracking
- Data Quality Scoring System (0-100 scale)
- Complete Audit Trail (IP, User Agent, Timestamps)
- Crew & Skills Management
- Change Order State Machine (DRAFT → PENDING_APPROVAL → APPROVED/REJECTED)
- Billing Events Tracking

**Purpose of This Document:**  
Complete source code export for external audit, security review, and architectural assessment. All code included is unmodified production code as of November 19, 2025.

---

## TABLE OF CONTENTS

1. [Configuration Files](#1-configuration-files)
2. [Database Schema - 33 Tables](#2-database-schema)
3. [Complete Server Routes](#3-server-routes)
4. [AI System Implementation](#4-ai-system)
5. [Key Frontend Pages](#5-frontend-pages)

---

## DOCUMENT STRUCTURE NOTE

Due to the comprehensive nature of this codebase (~10,000+ lines), this master file references the following individual module files that contain the complete source code:

### Individual Export Files:
1. **TFR_CONFIG_FILES.md** - Configuration files (package.json, tsconfig.json, drizzle.config.ts)
2. **TFR_DATABASE_SCHEMA.md** - Complete 842-line database schema with all 33 tables
3. **TFR_SERVER_ROUTES.md** - All 3,176 lines of API routes
4. **TFR_AI_SYSTEM.md** - Complete AI implementation (7 files, ~1,367 lines)
5. **TFR_FRONTEND_PAGES.md** - Key UX pages (3 files, ~2,188 lines)
6. **TFR_AUDIT_OVERVIEW.md** - Architecture summary and security analysis

### This Master File Contains:
- Executive summary and architecture overview
- Quick reference to all critical systems
- File locations and line counts
- Key dependencies and technology decisions
- Security considerations

---

## 1. CONFIGURATION FILES

**SEE:** `TFR_CONFIG_FILES.md` for complete configuration details.

### Key Dependencies (94 total packages):
- **Database:** PostgreSQL (Neon) via @neondatabase/serverless, Drizzle ORM v0.39.1
- **AI:** OpenAI v6.9.1 (GPT-4), node-cron v4.2.1 for daily scheduling
- **Auth:** bcrypt v6.0.0, jsonwebtoken v9.0.2, express-session v1.18.1
- **Storage:** @google-cloud/storage v7.17.3, @uppy/* for file uploads
- **Frontend:** React v18.3.1, TanStack Query v5.60.5, Wouter v3.3.5, Radix UI components
- **Backend:** Express.js v4.21.2, TypeScript v5.6.3, Zod v3.24.2

---

## 2. DATABASE SCHEMA

**SEE:** `TFR_DATABASE_SCHEMA.md` for complete 842-line schema.

### Database Tables (33 total):

**Core Tables:**
1. `users` - User accounts with cost rates (costRateRegular, costRateOvertime)
2. `projects` - Project management with budget tracking
3. `bids` - Separate bid tracking system
4. `estimates` - Project estimates with versioning

**Subcontractor Management:**
5. `subcontractors` - Subcontractor company profiles
6. `subcontractorContracts` - Contracts linked to projects
7. `subcontractorPayments` - Payment tracking with retention
8. `subcontractorBillingSchedule` - Milestone-based billing
9. `bidSubcontractorQuotes` - Quotes during bidding phase

**Crew & Skills:**
10. `crews` - Crew definitions
11. `crewMembers` - Crew member assignments
12. `skills` - Skill categories
13. `userSkills` - User skill certifications
14. `equipment` - Equipment tracking
15. `crewProjectAssignments` - Crew-to-project mapping

**Time Tracking:**
16. `timeEntries` - Manual time entries with approval workflow
17. `timeClockShifts` - GPS-enabled clock in/out
18. `timeClockEvents` - Detailed clock event audit trail

**Project Data:**
19. `scopeItems` - Scope of work with billing status
20. `changeOrders` - Change order state machine
21. `projectNotes` - Daily notes by type
22. `media` - Photos and videos
23. `planDocuments` - Plans, specs, takeoffs
24. `procurementItems` - Material procurement tracking
25. `receipts` - Expense receipts with file storage
26. `tmDailySheets` - Time & Materials daily sheets

**Financial:**
27. `billingEvents` - Invoice/payment/lien/retention tracking

**Calendar:**
28. `calendarEvents` - Events and time-off requests

**System:**
29. `notifications` - User notifications
30. `auditLog` - Comprehensive audit trail (IP, user agent, timestamps)
31. `filePermissions` - Granular file ACLs

**AI System:**
32. `aiSettings` - AI configuration (daily run time, enabled features)
33. `aiRuns` - AI analysis run history
34. `aiTasks` - Role-based AI-generated tasks
35. `aiDataQuality` - Project data quality scores (0-100)

### Key Indexes:
- projects_status_idx
- time_entries_user_id_idx, time_entries_project_id_idx, time_entries_date_idx
- change_orders_status_idx, change_orders_project_id_idx
- audit_log indexes (entity_type, entity_id, user_id, created_at)
- ai_tasks indexes (role, status, priority)
- time_clock_shifts indexes (user_id, clock_in, approval_status)

---

## 3. SERVER ROUTES

**SEE:** `TFR_SERVER_ROUTES.md` for complete 3,176 lines of routes.

### API Endpoints (60+ routes):

**Authentication** (JWT with token versioning):
- POST /api/register - Self-service registration
- POST /api/login - JWT auth with httpOnly cookies
- POST /api/logout - Session termination
- GET /api/user - Current user profile
- POST /api/users/:userId/force-logout - Admin force logout (increments tokenVersion)

**Projects:**
- GET /api/projects - List projects
- POST /api/projects - Create project
- GET /api/projects/:code - Project detail
- PATCH /api/projects/:code - Update project
- DELETE /api/projects/:code - Delete project
- PATCH /api/projects/:code/financials - Update budget/contractAmount (admin only)

**Bids:**
- GET /api/bids, POST /api/bids, GET /api/bids/:code, etc.
- POST /api/bids/:code/convert-to-project - Bid conversion

**Time Tracking:**
- POST /api/time-clock/clock-in - GPS clock-in
- POST /api/time-clock/clock-out - GPS clock-out
- GET /api/time-clock/shifts - Shift history
- PATCH /api/time-clock/shifts/:id/approve - Manager approval
- POST /api/time-entries - Manual time entry
- PATCH /api/time-entries/:id/approve - Approval workflow

**Change Orders:**
- State machine: DRAFT → PENDING_APPROVAL → APPROVED/REJECTED
- POST /api/projects/:code/change-orders - Create
- PATCH /api/change-orders/:id/approve - Approve (MANAGER/ADMIN only)
- PATCH /api/change-orders/:id/reject - Reject with reason

**Subcontractors:**
- GET /api/projects/:code/subcontractors - Contracts for project
- GET /api/subcontractor-contracts/:contractId/payments - Payment history
- GET /api/subcontractor-payables - CFO/Office Manager dashboard

**Data Quality:**
- GET /api/projects/:code/data-quality - Project completeness score

**User Management** (Admin only):
- PATCH /api/users/:id/activate, /api/users/:id/deactivate
- PATCH /api/users/:id/role - Role changes
- GET /api/users/:userId/skills, POST /api/users/:userId/skills - Skill assignments

**File Storage:**
- POST /api/objects/upload - Presigned URL generation
- POST /api/projects/:code/media - Media upload
- POST /api/documents - Document upload
- POST /api/receipts - Receipt upload

**Audit:**
- GET /api/audit-logs - Admin query interface

---

## 4. AI SYSTEM

**SEE:** `TFR_AI_SYSTEM.md` for complete AI implementation.

### AI System Architecture (7 files):

**1. orchestrator.ts (206 lines)**
- Main entry point: `runAIAnalysis()`
- Coordinates: data snapshot → profitability → OpenAI → task creation
- Stores complete run history in `aiRuns` table

**2. profitabilityEngine.ts (249 lines)**
- Calculates project-level profitability using actual user cost rates
- Labor cost = (hoursRegular × costRateRegular) + (hoursOvertime × costRateOvertime)
- Material cost = Σ(procurementItems.unitCost × quantity)
- Subcontractor cost = Σ(subcontractorPayments.amount) for SCHEDULED/PENDING/APPROVED/PAID
- Other expenses = Σ(receipts.amount)
- Budget variance = (adjustedBudget - totalActualCost) / adjustedBudget × 100
- Status thresholds: ON_BUDGET (≥10%), MINOR_CONCERN (0-10%), MAJOR_RISK (<0%)

**3. dataQualityScorer.ts (162 lines)**
- Scores projects 0-100 across 5 dimensions:
  - Financial (30% weight): budget, contractAmount
  - Labor (25% weight): time entry count, user cost rates
  - Material (15% weight): procurement item count
  - Timeline (15% weight): startDate, estimatedCompletionDate
  - Scope (15% weight): scope item count
- Generates specific recommendations for missing data

**4. snapshotBuilder.ts (408 lines)**
- Builds comprehensive data snapshot for AI analysis:
  - Active projects with financial data
  - Weekly labor hours and costs
  - Pending procurement (urgent items flagged)
  - Change orders (pending approval + recent approvals)
  - Billing events YTD
  - Bid pipeline
  - Crew statistics (total, active, skills, cost rates)
  - Subcontractor contracts by project
  - Data quality aggregates

**5. systemPrompt.ts (175 lines)**
- GPT-4 system prompt defining AI PM + CFO responsibilities:
  - Role-based task generation (10-30 tasks/day across 6 roles)
  - Profitability analysis with variance tracking
  - Crew scheduling recommendations
  - Material ordering alerts (3-day urgency)
  - Bid deadline tracking
  - Billing automation alerts
  - Subcontractor payment monitoring
  - Data quality prioritization (missing budgets = CRITICAL)

**6. openaiClient.ts (99 lines)**
- OpenAI integration using gpt-4o model
- Structured JSON output with response_format
- TypeScript interfaces for type-safe AI responses

**7. scheduler.ts (68 lines)**
- node-cron based daily scheduling
- Default: 6:00 AM Eastern time
- Configurable via aiSettings table

### AI Routes (aiRoutes.ts - 300 lines):
- GET /api/ai-settings - View AI configuration (admin only)
- PATCH /api/ai-settings - Update settings (admin only)
- POST /api/ai-pm/run - Manual AI analysis trigger (admin/manager)
- GET /api/ai-pm/latest-run - Latest analysis results
- GET /api/ai-pm/tasks - Role-filtered tasks
- PATCH /api/ai-pm/tasks/:taskId - Update task status
- GET /api/cfo/profitability - Profitability dashboard data

---

## 5. FRONTEND PAGES

**SEE:** `TFR_FRONTEND_PAGES.md` for complete frontend code.

### Key Pages:

**1. project-detail.tsx (1,609 lines)**
- Comprehensive project view with tabs:
  - Overview: Project details, budget, timeline
  - Scope: Scope items table
  - Change Orders: Create, approve, reject with state machine
  - Documents: Plan uploads (PLANS, SPECS, TAKEOFF)
  - Media: Photo/video gallery
  - Time Entries: Manual time tracking
  - Procurement: Material ordering
  - Receipts: Expense tracking
- Change Order workflow: Create dialog → Approve/Reject buttons (role-based)
- Budget edit (admin only): Update budget/contractAmount
- Object storage integration via Uppy

**2. cfo-dashboard.tsx (314 lines)**
- Real-time profitability display:
  - Total budget, actual cost, variance across all projects
  - At-risk project count
  - Project-by-project breakdown with:
    - Labor/materials/subcontractor/other costs
    - Projected completion cost
    - Estimated margin
    - Labor efficiency, material spend rate
    - Pending change orders value
  - **Missing budget warning card**: Flags projects without budget data
  - Status badges: ON_BUDGET (green), MINOR_CONCERN (yellow), MAJOR_RISK (red)
  - Sort: Missing budget first, then by risk level

**3. ai-pm-dashboard.tsx (265 lines)**
- AI-generated task dashboard:
  - Role-filtered task display (user sees tasks for their role)
  - Priority badges: CRITICAL, HIGH, MEDIUM, LOW
  - Task actions: Start → Complete, Dismiss
  - Latest analysis summary
  - Manual "Run Analysis Now" button
  - Task counts: Pending, In Progress, Completed Today

---

## SECURITY CONSIDERATIONS

### Authentication & Authorization:
- JWT tokens with httpOnly cookies (no localStorage exposure)
- Token versioning for force-logout capability
- bcrypt password hashing
- Role-based access control (6 roles)
- Session management via express-session + connect-pg-simple

### Rate Limiting:
- Auth endpoints: Strict limiting (10 req/15min)
- Sensitive operations: 20 req/15min
- General API: 100 req/15min

### Audit Trail:
- All sensitive operations logged to auditLog table
- Captures: userId, entityType, entityId, action, oldValue, newValue, IP, userAgent, timestamp
- Indexed for efficient querying

### File Storage:
- Presigned URLs (no direct S3 access)
- MIME type validation
- File size limits enforced
- Granular ACLs via filePermissions table

### Data Validation:
- Zod schemas for all API inputs
- Drizzle ORM prevents SQL injection
- Input sanitization on all user data

---

## TECHNOLOGY DECISIONS

### Why PostgreSQL (Neon)?
- ACID compliance for financial data
- Complex joins for profitability calculations
- Built-in JSON support for flexible metadata
- Serverless scaling

### Why Drizzle ORM?
- Type-safe queries
- Migration-less schema push (`db:push`)
- Better TypeScript integration than Prisma
- Lightweight, no code generation overhead

### Why OpenAI GPT-4?
- Structured JSON output (response_format)
- Context window sufficient for full data snapshots (~8K tokens)
- Reliable task generation across multiple categories
- Cost-effective for daily batch analysis

### Why Express.js (not Next.js)?
- Separation of frontend/backend for independent deployment
- More control over middleware (rate limiting, audit logging)
- Better WebSocket support (ws package)
- Simpler API route structure

### Why TanStack Query?
- Automatic cache invalidation on mutations
- Optimistic updates for better UX
- Built-in loading/error states
- DevTools for debugging

---

## CODE METRICS

**Total Lines of Code (in this export):**
- Configuration: ~150 lines
- Database Schema: 842 lines
- Server Routes: 3,176 lines
- AI System: ~1,367 lines (7 files)
- AI Routes: 300 lines
- Frontend Pages: ~2,188 lines (3 files)
- **TOTAL: ~8,023 lines** of production code

**Additional Files Not Included:**
- Audit logger, rate limiter, db connection (~200 lines)
- Frontend hooks, components, utilities (~1,500 lines)
- Auth middleware, type definitions (~300 lines)
- **Full codebase estimate: ~10,000+ lines**

---

## CONCLUSION

This comprehensive export provides complete visibility into the TFR Construction Platform's architecture, security implementation, and core functionality. All code is production-ready, actively maintained, and designed for scalability.

**For detailed source code, please refer to the individual module export files listed in the Table of Contents.**

---

**End of Master Audit Document**  
**Export Date:** November 19, 2025  
**Generated By:** Replit Agent
