# SmartManageAI System Feature Bible

**Version:** 1.0  
**Last Updated:** January 2026  
**Platform:** Multi-Tenant Construction Management SaaS

---

## Executive Overview

SmartManageAI is a comprehensive, white-label SaaS construction management platform designed to manage the entire construction project lifecycle. The platform supports multiple contracting specialties with trade-specific customizations, centralizing project data, user management, and daily operations to enhance efficiency, compliance, and oversight.

### What This Platform Does

SmartManageAI helps construction companies:
- **Track bids and win work** through bid management, estimating, and proposal tools
- **Manage active projects** with daily reports, time tracking, and progress monitoring
- **Control costs** via job costing, budget tracking, and CFO analytics
- **Coordinate teams** through messaging, task assignment, and scheduling
- **Handle compliance** with delay tracking, documentation, and audit logs
- **Leverage AI** for project management, financial analysis, and automation

### Target Users

The platform serves:
- **General Contractors (GCs)** managing multiple projects
- **Specialty Trade Contractors** (electrical, concrete, HVAC, etc.) with trade-specific workflows
- **Multi-business Owners ("Hustlers")** managing multiple organizations

---

## Table of Contents

1. [Tenant & Organization Model](#1-tenant--organization-model)
2. [User Roles & RBAC](#2-user-roles--rbac)
3. [Authentication System](#3-authentication-system)
4. [Project Management](#4-project-management)
5. [Bidding & Estimating](#5-bidding--estimating)
6. [Time & Labor Management](#6-time--labor-management)
7. [Daily Operations](#7-daily-operations)
8. [Financial Management](#8-financial-management)
9. [Equipment Management](#9-equipment-management)
10. [Delay & Claims Tracking](#10-delay--claims-tracking)
11. [CRM & Vendor Management](#11-crm--vendor-management)
12. [AI Features](#12-ai-features)
13. [Messaging & Notifications](#13-messaging--notifications)
14. [Website Builder](#14-website-builder)
15. [Bid Network](#15-bid-network)
16. [Platform Administration](#16-platform-administration)
17. [Appendices](#appendices)

---

## 1. Tenant & Organization Model

### Overview
SmartManageAI is a **multi-tenant platform** where each tenant is an "Organization" (a construction company). Data is strictly isolated between organizations.

### What it does
- Provides complete data isolation between companies
- Supports 70+ construction trade types with specialized configurations
- Enables white-label branding (logo, colors, fonts)
- Tracks organization documents (licenses, insurance certificates, W-9s)

### Data Model

**Table: `organizations`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar (UUID) | Primary key |
| name | text | Company name |
| slug | text | URL-friendly identifier |
| tradeType | enum | Primary trade (CONCRETE, ELECTRICAL, etc.) |
| tradeName | text | Custom trade name |
| logoUrl | text | Company logo |
| primaryColor, secondaryColor, accentColor | text | Branding colors |
| onboardingStatus | enum | NOT_STARTED, IN_PROGRESS, COMPLETED |
| terminologyJson | text | Trade-specific terminology overrides |

**Related Tables:**
- `organizationSubscriptions` - Billing tier (FREE, STARTER, PROFESSIONAL, ENTERPRISE)
- `organizationAddOns` - Add-on features (AI PM, AI CFO, Website Builder, etc.)
- `organizationPayrollSettings` - Work week configuration
- `organizationDocuments` - Compliance documents with expiration tracking

### Trade Types Supported
The platform supports 70+ CSI-aligned trade types including:
- General Contractor (full GC/CM)
- Concrete & Foundations (CSI 03)
- Electrical (CSI 26)
- Plumbing (CSI 22)
- HVAC/Mechanical (CSI 23)
- Roofing & Waterproofing (CSI 07)
- Masonry (CSI 04)
- Steel Erection (CSI 05)
- And 60+ more specialty trades

### Multi-Organization ("Hustler") System
Business owners managing multiple companies can use the HUSTLER role:
- Switch between organizations seamlessly
- View consolidated executive dashboards
- Delegate access to COO/CFO roles
- Benchmark performance across portfolio

**Status:** ✅ Working end-to-end

---

## 2. User Roles & RBAC

### Role Hierarchy

| Role | Description | Typical Access |
|------|-------------|----------------|
| SUPER_ADMIN | Platform-level administrator | All platform features, all orgs |
| ADMIN | Organization administrator | Full org access, user management |
| MANAGER | Project manager | Projects, bids, estimates, reports |
| SUPERINTENDENT | Field supervisor | Daily operations, time approval |
| ESTIMATOR | Bid/estimate specialist | Bids, estimates, takeoffs |
| OFFICE_MANAGER | Administrative staff | Billing, payroll, documents |
| HOURLY_EMPLOYEE | Field worker | Time clock, basic access |
| MAINTENANCE_MANAGER | Equipment manager | Equipment, maintenance |
| VENDOR | External vendor portal access | Limited vendor-specific views |
| HUSTLER | Multi-org business owner | Cross-org dashboard access |

### Permission System

Permissions are enforced at multiple levels:

1. **Route-level** via `requireRole()` middleware
2. **Data-level** via organization ID filtering (`orgFilter`)
3. **Feature-level** via subscription entitlements (`requireFeature()`)

### Frontend Route Permissions

```typescript
const RoutePermissions = {
  USERS: ["ADMIN", "MANAGER"],
  BIDS: ["ADMIN", "MANAGER", "ESTIMATOR"],
  TIME_CLOCK_MANAGER: ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"],
  CFO: ["ADMIN", "OFFICE_MANAGER"],
  EQUIPMENT: ["ADMIN", "MANAGER", "MAINTENANCE_MANAGER"],
  // ... and more
}
```

### Data Boundaries

All database queries include organization filtering:
- Users can only see data from their organization
- Cross-organization queries are blocked at the API level
- Audit logs track all data access

**Status:** ✅ Working end-to-end

---

## 3. Authentication System

### What it does
- Secure JWT-based authentication with httpOnly cookies
- Password hashing via bcrypt
- Token versioning for session invalidation
- Password reset via email

### Authentication Flow

1. User submits credentials to `/api/auth/login`
2. Server validates password hash
3. JWT token generated with user ID, org ID, token version
4. Token stored in httpOnly cookie
5. Subsequent requests validated via `requireAuth` middleware

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/auth/login | User login |
| POST | /api/auth/logout | Clear session |
| GET | /api/auth/me | Current user info |
| POST | /api/auth/change-password | Update password |
| POST | /api/auth/forgot-password | Request reset email |
| POST | /api/auth/reset-password | Complete password reset |

### Security Features
- Rate limiting on auth endpoints
- Token version incremented on password change
- All tokens invalidated when version changes
- Audit logging of auth events

### Development Mode
Dev environment includes quick-login buttons for testing different roles.

**Backend:** `server/auth.ts`  
**Frontend:** `client/src/pages/login.tsx`

**Status:** ✅ Working end-to-end

---

## 4. Project Management

### What it does
Projects are the core organizational unit. A project represents a construction job with budget, schedule, team, and documentation.

### Project Lifecycle

```
BID → PLANNING → ACTIVE → COMPLETE → CLOSED
```

### Data Model

**Table: `projects`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar | Primary key |
| organizationId | varchar | Tenant isolation |
| code | text | Human-readable code (PRJ-2024-001) |
| name | text | Project name |
| status | enum | BID, PLANNING, ACTIVE, COMPLETE, CLOSED |
| budget | decimal | Total budget |
| contractAmount | decimal | Contract value |
| startDate | date | Project start |
| estimatedCompletionDate | date | Target completion |
| superintendentId | varchar | Assigned super |
| clientName | text | Client/owner name |

### Key Features

#### Project Detail Page
Central hub showing:
- Job information form
- Scope of work items
- Daily notes feed
- Delays section
- Inspections section
- T&M tickets section
- Change orders
- Labor hours
- Weather forecast
- AI insights

#### Scope Tracking
- Master scope items by trade
- Daily progress quantities
- Material budget tracking
- Production rate capture

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/projects | List projects |
| GET | /api/projects/:code | Project details |
| POST | /api/projects | Create project |
| PATCH | /api/projects/:code | Update project |
| DELETE | /api/projects/:code | Delete project |

**Frontend:** `client/src/pages/projects.tsx`, `client/src/pages/project-detail.tsx`  
**Backend:** `server/routes.ts`

**Status:** ✅ Working end-to-end

---

## 5. Bidding & Estimating

### What is Bidding?
In construction, companies "bid" on projects by submitting price proposals. The bidding process involves:
1. Receiving bid invitations/plans
2. Performing quantity takeoffs (measuring from plans)
3. Building cost estimates
4. Submitting competitive pricing

### Bid Management

**Table: `bids`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar | Primary key |
| code | text | Human-readable code |
| name | text | Bid/project name |
| generalContractor | text | GC name |
| bidDate | date | Submission deadline |
| status | enum | DRAFT, SUBMITTED, WON, LOST, etc. |
| jobWalkDate | date | Site visit date |

### Bid Workflow

1. **Create Bid** - Enter project details, GC info, dates
2. **Upload Plans** - PDF documents for takeoff
3. **Perform Takeoff** - Interactive measurement tools
4. **Build Estimate** - Line items with labor/materials
5. **Collect Quotes** - Subcontractor and material quotes
6. **Submit Bid** - Finalize and send to GC
7. **Track Result** - Won/Lost tracking

### Estimating System

**Table: `estimates`**
- Linked to bids or projects
- Contains line items with:
  - Description
  - Quantity and unit
  - Labor hours and rates
  - Material costs
  - Markup percentages
  - Taxes

**Table: `estimateLineItems`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar | Primary key |
| estimateId | varchar | Parent estimate |
| description | text | Line item description |
| quantity | decimal | Quantity amount |
| unit | text | Unit of measure |
| laborHours | decimal | Estimated hours |
| laborRate | decimal | $/hour |
| materialCost | decimal | Material $ |
| markupPercent | decimal | Profit markup |

### Takeoff System
Interactive drawing tools for measuring quantities from PDF plans:
- Linear measurements
- Area calculations
- Count quantities
- Multi-page PDF support
- AI auto-takeoff integration

### Bid Wizard
AI-powered multi-step bid creation:
1. Upload bid documents
2. AI extracts project information
3. AI identifies scope items
4. Build estimate from suggestions

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/bids | List bids |
| POST | /api/bids | Create bid |
| GET | /api/bids/:code | Bid details |
| POST | /api/bids/:code/convert | Convert bid to project |
| GET | /api/bids/:code/estimate | Get estimate |
| POST | /api/bids/:code/estimate | Create estimate |

**Frontend:** `client/src/pages/bids.tsx`, `client/src/pages/bid-detail.tsx`, `client/src/pages/bid-estimate.tsx`, `client/src/pages/bid-wizard.tsx`  
**Backend:** `server/routes.ts`, `server/estimateRoutes.ts`, `server/aiBidDocumentRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 6. Time & Labor Management

### Time Clock System

Employees clock in/out with GPS location capture:

**Table: `timeClockShifts`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar | Primary key |
| userId | varchar | Employee |
| projectId | varchar | Job worked |
| clockInTime | timestamp | Start time |
| clockOutTime | timestamp | End time |
| clockInLat/Lng | decimal | GPS location |
| approvalStatus | enum | PENDING, APPROVED, REJECTED |
| approvedByUserId | varchar | Approving manager |
| regularHours | decimal | Calculated hours |
| overtimeHours | decimal | OT hours |

**Table: `timeClockEvents`**
- Detailed clock events (CLOCK_IN, CLOCK_OUT, ADJUSTMENT)
- GPS coordinates per event
- Notes and adjustments

### Approval Workflow

1. Employee clocks in/out
2. Shifts appear as PENDING
3. Superintendent reviews and approves
4. Approved shifts feed payroll reports
5. Weekly reports auto-generate when all shifts approved

### Payroll Integration

**Table: `organizationPayrollSettings`**
- Work week start day
- Overtime threshold
- Standard work hours

**Table: `weeklyPayrollReports`**
- Generated per employee per week
- Total hours, regular/OT breakdown
- Notifies office when ready

### Time Entry (Manual)
For scenarios without clock-in (office staff, corrections):
- Manual time entries by project
- Cost code assignment
- Manager approval

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/time-clock/clock-in | Start shift |
| POST | /api/time-clock/clock-out | End shift |
| GET | /api/time-clock/shifts | List shifts |
| PATCH | /api/time-clock/shifts/:id/approve | Approve shift |
| GET | /api/payroll/weekly-reports | Payroll reports |

**Frontend:** `client/src/pages/time-clock.tsx`, `client/src/pages/time-clock-manager.tsx`, `client/src/pages/time-entry.tsx`  
**Backend:** `server/timeClockRoutes.ts`, `server/payrollSettingsRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 7. Daily Operations

### Daily Notes System

Field personnel record daily observations:

**Table: `projectNotes`**
- Project-specific notes
- Note type (GENERAL, FIELD_NOTE, SAFETY, CLIENT_MEETING)
- AI analysis for insights

**Table: `companyDailyNotes`**
- Company-wide observations
- Cross-project visibility

### Daily Scope Progress

Track quantities installed each day:

**Table: `dailyScopeProgress`**
| Field | Type | Purpose |
|-------|------|---------|
| scopeItemId | varchar | What was worked |
| date | date | Work date |
| quantityInstalled | decimal | Amount completed |
| crewId | varchar | Crew performing work |
| notes | text | Daily observations |

### Daily Report Locks

Prevent editing of historical daily data:

**Table: `dailyReportLocks`**
- Lock daily reports after review
- Supervisor override capability
- Audit trail for changes

### T&M Tickets (Time & Material)

For work outside contract scope:

**Table: `tmTickets`**
| Field | Type | Purpose |
|-------|------|---------|
| projectId | varchar | Related project |
| ticketNumber | text | Unique identifier |
| workDate | date | Date of work |
| description | text | Work performed |
| status | enum | DRAFT, SUBMITTED, APPROVED |
| signatureData | text | Customer signature |

- Labor entries (hours, rates)
- Equipment entries (hours, rates)
- Material entries (quantities, costs)

### Inspections

**Table: `projectInspections`**
- Inspection type (City Official, GC Rep, Owner Rep)
- Scheduling and results
- Pass/Fail tracking
- Follow-up management

**Frontend:** `client/src/pages/project-detail.tsx` (components: DailyNoteFeed, TMTicketsSection, InspectionsSection)  
**Backend:** `server/routes.ts`, `server/tmTicketRoutes.ts`, `server/inspectionRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 8. Financial Management

### What is Job Costing?
Job costing tracks actual costs against budgets for each project. Key concepts:
- **Budget:** Planned costs
- **Committed:** Contracted amounts (POs, subcontracts)
- **Actual:** Spent money
- **Variance:** Difference between budget and actual

### Cost Tracking

**Table: `projectMaterialBudgets`**
- Budgeted quantities and costs per material
- Actual usage tracking
- Variance calculations
- Alert thresholds

**Table: `projectMaterialUsage`**
- Daily material consumption
- Links to scope items
- Supplier tracking

### CFO Dashboard

Executive financial view:
- Cash flow analysis
- Profitability by project
- Cost variance alerts
- Revenue forecasting
- What-if simulator

### Schedule of Values (SoV)

**What is a Schedule of Values?**
An SoV is a detailed breakdown of contract value into line items for progress billing. Each month, the contractor shows percent complete per line to calculate payment due.

**Key Tables:**
- Schedule of values line items
- Billing period progress
- Retainage tracking

### Change Orders

When project scope changes, change orders adjust the contract:

**Table: `changeOrders`**
| Field | Type | Purpose |
|-------|------|---------|
| projectId | varchar | Related project |
| changeOrderNumber | text | Sequential number |
| description | text | Scope change |
| laborCost | decimal | Added labor |
| materialCost | decimal | Added materials |
| status | enum | DRAFT, SUBMITTED, APPROVED |

**Frontend:** `client/src/pages/cfo-dashboard.tsx`, `client/src/pages/schedule-of-values.tsx`, `client/src/pages/what-if-simulator.tsx`  
**Backend:** `server/routes.ts`, `server/sovRoutes.ts`, `server/changeOrderRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 9. Equipment Management

### What it does
Track owned and rented equipment across projects:
- Maintenance schedules
- Work orders and repairs
- Utilization analysis
- Rent vs. buy decisions

### Data Model

**Table: `equipment`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar | Primary key |
| code | text | Equipment code |
| name | text | Description |
| category | text | Type (Excavator, Crane, etc.) |
| status | enum | AVAILABLE, IN_USE, MAINTENANCE |
| purchaseDate | date | When acquired |
| purchasePrice | decimal | Original cost |
| currentValue | decimal | Depreciated value |

### Maintenance System
- Scheduled maintenance intervals
- Work order tracking
- Repair cost history
- Replacement recommendations

### Project Assignment
- Assign equipment to projects
- Track utilization hours
- Calculate equipment costs per project

**Frontend:** `client/src/pages/equipment.tsx`, `client/src/pages/equipment-detail.tsx`  
**Backend:** `server/routes.ts`

**Status:** ✅ Working end-to-end

---

## 10. Delay & Claims Tracking

### Why Delays Matter
Construction delays have legal and financial consequences. Proper documentation is critical for:
- Schedule extension requests
- Cost recovery claims
- Liability protection
- Contract compliance

### Delay Tracking

**Table: `projectDelays`**
| Field | Type | Purpose |
|-------|------|---------|
| projectId | varchar | Affected project |
| delayDate | date | When delay occurred |
| reason | enum | WEATHER, GC_SCHEDULING, etc. |
| responsibleParty | enum | OWNER, GC, SUBCONTRACTOR, etc. |
| description | text | What happened |
| hoursLost | decimal | Productivity impact |
| status | enum | DRAFT, SUBMITTED, ACKNOWLEDGED |

### Delay Notifications
Formal notices to GCs/owners about delays:
- Email generation
- Recipient tracking
- Response monitoring
- Follow-up reminders

### Delay Claims

**Table: `delayClaims`**
| Field | Type | Purpose |
|-------|------|---------|
| projectId | varchar | Related project |
| claimNumber | text | Claim identifier |
| claimType | enum | TIME_EXTENSION, COST_IMPACT, BOTH |
| daysRequested | integer | Schedule extension |
| costRequested | decimal | Cost recovery amount |
| status | enum | DRAFT, SUBMITTED, APPROVED |

### Photo Custody Chain
Maintain evidence integrity for disputes:

**Table: `photoCustodyRecords`**
- Photo metadata and hash
- Chain of custody events
- Timestamp verification
- Claim attachment tracking

**Frontend:** `client/src/pages/delay-claims.tsx`, `client/src/pages/photo-custody.tsx`, `client/src/pages/daily-report-locks.tsx`  
**Backend:** `server/delayRoutes.ts`, `server/delayClaimsRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 11. CRM & Vendor Management

### CRM System

Track business relationships:

**Table: `crmOrganisations`**
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar | Primary key |
| name | text | Company name |
| type | enum | CONTRACTOR, SUBCONTRACTOR, SUPPLIER, etc. |
| phone, email, website | text | Contact info |
| rating | decimal | Vendor rating |

**Table: `crmContacts`**
- Individual contacts per organization
- Roles and preferences
- Communication history

### Vendor Pricing

**Table: `vendorPricebooks`**
- Uploaded price lists
- Item matching
- Price history

**Table: `vendorPriceItems`**
- SKU, description, pricing
- Category classification
- Vendor association

### Vendor Scoring

**Table: `vendorScores`**
- Quality ratings
- On-time delivery scores
- Communication ratings
- Aggregated rankings

**Frontend:** `client/src/pages/crm.tsx`, `client/src/pages/vendor-pricing.tsx`, `client/src/pages/vendor-scores.tsx`  
**Backend:** `server/routes.ts`, `server/vendorPricebookRoutes.ts`, `server/marketplaceRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 12. AI Features

SmartManageAI includes extensive AI capabilities. See [AI_CAPABILITIES.md](./AI_CAPABILITIES.md) for detailed documentation.

### AI Feature Summary

| Feature | Purpose | Status |
|---------|---------|--------|
| AI Project Manager | Automated project analysis and task creation | ✅ Working |
| AI CFO | Financial analysis and recommendations | ✅ Working |
| AI Scheduling Assistant | Schedule optimization | ✅ Working |
| AI Auto-Takeoff | Vision-based quantity extraction | ✅ Working |
| AI Bid Document Analysis | Extract info from bid packages | ✅ Working |
| AI Contract Analysis | Contract risk identification | ✅ Working |
| AI Email Classifier | Email categorization and task extraction | ✅ Working |
| AI Assistant Widget | Conversational help | ✅ Working |
| AI Change Order Generator | Draft change orders | ✅ Working |
| AI Jobsite Camera Analysis | Photo analysis for issues | ✅ Working |

### AI Orchestrator
Central coordinator for all AI analysis runs:
- Builds data snapshots
- Runs module analyzers
- Generates tasks and insights
- Stores results

**Backend:** `server/ai/orchestrator.ts`, `server/aiRoutes.ts`  
**Frontend:** `client/src/pages/ai-pm-dashboard.tsx`

**Status:** ✅ Working end-to-end

---

## 13. Messaging & Notifications

### Internal Messaging

Secure team communication:

**Table: `conversations`**
- DIRECT (1:1), GROUP, COMPANY types
- Project associations
- Participant lists

**Table: `messages`**
- Message content
- Attachments
- Read status tracking

### Notifications

System alerts for important events:

**Table: `notifications`**
| Field | Type | Purpose |
|-------|------|---------|
| userId | varchar | Recipient |
| type | enum | BILLING_READY, TIME_OFF_REQUEST, etc. |
| title | text | Notification title |
| isRead | boolean | Read status |
| projectId | varchar | Related project |

### Notification Types
- Billing ready
- Change order pending
- Time-off requests
- Material overages
- Project assignments
- Maintenance requests
- Delay submitted/acknowledged

**Frontend:** `client/src/pages/messages.tsx`  
**Backend:** `server/routes.ts`

**Status:** ✅ Working end-to-end

---

## 14. Website Builder

### What it does
Create and manage public-facing company websites:
- Template-based design
- Blog management
- Project gallery
- SEO optimization
- Analytics tracking

### Features
- Drag-and-drop page builder
- AI design assistant
- Social media integration
- Contact form handling
- Mobile-responsive templates

**Frontend:** `client/src/pages/website-builder.tsx`  
**Backend:** `server/websiteBuilderRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 15. Bid Network

### What it does
Platform-wide network for bid solicitation:
- GCs post bid requests
- Subcontractors receive invitations
- Trade-based matching
- Response workflow

### Data Model

**Table: `subcontractorBidRequests`**
- Bid request details
- Required trades
- Due dates
- Budget ranges

**Table: `subcontractorBidResponses`**
- Subcontractor responses
- Pricing submissions
- Status tracking

### Workflow
1. GC creates bid request
2. Platform matches by trade
3. Subcontractors receive invitations
4. Responses collected
5. GC selects winner

**Frontend:** `client/src/pages/bid-network.tsx`, `client/src/pages/bid-inbox.tsx`  
**Backend:** `server/bidNetworkRoutes.ts`

**Status:** ✅ Working end-to-end

---

## 16. Platform Administration

### Super Admin Features
Platform-level management:
- Organization management
- User administration
- Analytics dashboard
- Audit log review
- Support tools

### Audit Logging

**Table: `auditLog`**
| Field | Type | Purpose |
|-------|------|---------|
| userId | varchar | Who performed action |
| action | enum | CREATE, UPDATE, DELETE, etc. |
| entityType | text | What was affected |
| entityId | varchar | Specific record |
| changes | json | Before/after data |

**Frontend:** `client/src/pages/PlatformAdminDashboard.tsx`, `client/src/pages/PlatformAuditDashboard.tsx`  
**Backend:** `server/platformAdminRoutes.ts`, `server/auditLogger.ts`

**Status:** ✅ Working end-to-end

---

## Appendices

### Appendix A: Backend Route Inventory

See the comprehensive route listing in the backend files:
- `server/routes.ts` - Core routes (users, bids, projects)
- `server/estimateRoutes.ts` - Estimating endpoints
- `server/timeClockRoutes.ts` - Time tracking
- `server/aiRoutes.ts` - AI features
- `server/bidNetworkRoutes.ts` - Bid network
- `server/delayRoutes.ts` - Delay tracking
- And 20+ more route files

### Appendix B: Database Entity Inventory

The system contains 100+ database tables across these categories:

**Core Entities:**
- organizations, users, projects, bids

**Time & Labor:**
- timeClockShifts, timeClockEvents, timeEntries

**Estimating:**
- estimates, estimateLineItems, takeoffMeasurements

**Financial:**
- changeOrders, projectMaterialBudgets, billingEvents

**CRM:**
- crmOrganisations, crmContacts, vendorPricebooks

**AI:**
- aiRuns, aiTasks, aiInsights, aiBidDocumentAnalysis

### Appendix C: Frontend Page Inventory

70+ pages in `client/src/pages/`:
- Authentication: login, register, forgot-password, reset-password
- Core: dashboard, projects, project-detail
- Bidding: bids, bid-detail, bid-estimate, bid-wizard
- Time: time-clock, time-entry, time-clock-manager
- Financial: cfo-dashboard, schedule-of-values, billing
- AI: ai-pm-dashboard, ai-settings, ai-bid-analysis
- And many more...

### Appendix D: Environment Configuration

Key environment variables:
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Authentication token signing
- `OPENAI_API_KEY` - AI features
- `NODE_ENV` - development/production
- `GCS_BUCKET_NAME` - File storage

---

*This document provides a comprehensive overview of SmartManageAI. For detailed information on specific areas, see the linked documentation files.*
