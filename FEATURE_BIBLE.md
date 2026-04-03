# SmartManageAI Feature Bible

> The authoritative reference for every module, feature, integration, and user role in the SmartManageAI construction management platform.

**Last validated:** April 2026
**Source of truth:** This document is derived from the live codebase — specifically the Drizzle schema files (`shared/schema/`), route registrations (`server/routes.ts`), RBAC configuration (`client/src/lib/rbac.ts`), and frontend page definitions (`client/src/App.tsx`). Features marked with *(flagged)* are gated behind feature flags and may not be enabled for all organizations. This document should be reviewed quarterly alongside the codebase to prevent drift.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Authentication & Security](#3-authentication--security)
4. [Dashboard & Company Health](#4-dashboard--company-health)
5. [Project Management](#5-project-management)
6. [Bid Management & Estimating](#6-bid-management--estimating)
7. [Financial Controls](#7-financial-controls)
8. [Field Operations](#8-field-operations)
9. [Payroll & HR](#9-payroll--hr)
10. [Procurement](#10-procurement)
11. [AI Intelligence Suite](#11-ai-intelligence-suite)
12. [CRM](#12-crm)
13. [Hiring & Recruitment](#13-hiring--recruitment)
14. [Subcontractor & Vendor Management](#14-subcontractor--vendor-management)
15. [Communication & Messaging](#15-communication--messaging)
16. [Portal & External Access](#16-portal--external-access)
17. [Website Builder](#17-website-builder)
18. [Safety & Compliance](#18-safety--compliance)
19. [Integrations & Platform](#19-integrations--platform)
20. [Platform Administration](#20-platform-administration)
21. [Performance & Infrastructure](#21-performance--infrastructure)

---

## 1. Platform Overview

### Mission

SmartManageAI is an all-in-one construction management platform that combines project management, estimating, financials, field operations, CRM, hiring, and AI-powered intelligence into a single cloud application. It is designed to serve contractors of every size — from small specialty trades to large general contractors — by digitizing and automating the end-to-end construction workflow.

### Target Audience

- **Small to mid-size contractors** who need an affordable, integrated alternative to juggling spreadsheets and multiple point solutions.
- **Enterprise general contractors** managing large portfolios of projects, crews, and subcontractors across multiple regions.
- **Specialty trade contractors** (concrete, electrical, plumbing, HVAC, roofing, and more) who need trade-specific estimating and production rate tracking.

### Multi-Tenant SaaS Model

- Each contracting company is an **Organization** with its own slug, branding, feature flags, and subscription tier.
- Organizations subscribe to a **plan tier** (Free, Pro, Enterprise) with optional add-ons, managed through Stripe billing.
- A **Super Admin** role monitors all organizations from a platform-level dashboard for support, analytics, and system health.
- The **Hustler** role enables multi-organization management for owners or executives who oversee several contracting firms.

### Technology Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Wouter routing, TanStack Query v5 |
| Backend | Node.js + Express, TypeScript |
| Database | PostgreSQL via Drizzle ORM |
| AI | OpenAI GPT integration (configurable model) |
| File Storage | Replit Object Storage |
| Email | SendGrid |
| Payments | Stripe (subscriptions, add-ons) |
| Real-Time | Server-Sent Events (SSE) |
| BIM Viewer | Web-IFC |

---

## 2. User Roles & Permissions

SmartManageAI supports **18 distinct roles**, each with carefully scoped access levels. Roles are divided into four tiers: Platform, Organization Admin, Management, and Field/External.

### Role Directory

| # | Role | Tier | Description |
|---|------|------|-------------|
| 1 | **Super Admin** | Platform | Monitors all organizations, analytics, support tools. No access to contractor features. |
| 2 | **Admin** | Org Admin | Full access to everything within their organization, including user management and company settings. |
| 3 | **Manager** | Management | Full project and financial access except user management. |
| 4 | **Estimator** | Management | Bids, estimates, takeoffs, cost rates. Can edit projects they are assigned to as estimator. |
| 5 | **Office Manager** | Management | Financial controls, payroll, T&M billing, progress billing, time approvals. |
| 6 | **Superintendent** | Management | Field operations, daily reports, project oversight, equipment. View-only access to bids. |
| 7 | **Project Engineer** | Management | RFIs, submittals, document control, drawings, change events. No payroll or banking. |
| 8 | **Dispatcher** | Management | Crew and technician schedules, assignments, daily dispatch plans. No payroll or banking. |
| 9 | **Safety Manager** | Management | Safety logs, incidents, training, certifications, jobsite roster. No payroll or banking. |
| 10 | **HR Manager** | Management | Hiring, onboarding, employee profiles, certifications, performance. No banking or invoices. |
| 11 | **Equipment Manager** | Management | Equipment registry, assignments, maintenance, utilization. No payroll or banking. |
| 12 | **Procurement Manager** | Management | Material requests, POs, vendor catalogs, deliveries. No payroll or banking. |
| 13 | **Maintenance Manager** | Specialized | Equipment management and maintenance/repair requests. Limited access elsewhere. |
| 14 | **Hustler** | Multi-Org | Multi-organization executive role. Management-level access across linked organizations. |
| 15 | **Sales** | Scoped | CRM, leads, pipeline, proposals. No payroll, banking, or full financials. |
| 16 | **Marketing** | Scoped | Marketing campaigns, lead sources, CRM analytics, social media. No payroll or banking. |
| 17 | **Hourly Employee** | Field | Limited access: active projects, daily notes, calendar, time clock. No financial data. |
| 18 | **Vendor** | External | External vendor portal. Submit pricing to enrolled clients, view enrollments. No contractor features. |

### Permission Model

- **Financial Access**: Admin, Manager, Superintendent, Estimator, Office Manager, Hustler.
- **Equipment Access**: Admin, Manager, Superintendent, Maintenance Manager, Equipment Manager.
- **Safety Access**: Admin, Manager, Superintendent, Safety Manager.
- **Procurement Access**: Admin, Manager, Procurement Manager, Superintendent.
- **HR Access**: Admin, Manager, HR Manager.
- **CRM/Sales Access**: All management roles plus Sales and Marketing.
- **Dispatch Access**: Admin, Manager, Superintendent, Dispatcher.

### Feature Permission Flags

Organizations can grant additional permissions via configurable feature flags:

- `canAccessFinancials`, `canManagePayroll`, `canAccessReports`
- `canUseAiFeatures`, `canPostSocialMedia`, `canManageWebsite`
- `canManageEquipment`, `canManageProcurement`, `canManageContracts`
- `canManageHiring`, `canManageSafety`, `canManageScheduling`
- `canAccessBidNetwork`, `canManageLeave`, `canAccessTimeMaterial`

---

## 3. Authentication & Security

### Login Methods

| Method | Description |
|--------|-------------|
| **Email & Password** | Standard registration and login with bcrypt-hashed passwords. |
| **OAuth (Google)** | Social login via Google OAuth 2.0. |
| **OAuth (Apple)** | Social login via Apple Sign-In. |
| **Passkey / WebAuthn** | Passwordless authentication using FIDO2/WebAuthn credentials stored per user. |

### SSO / SAML

- Enterprise organizations can configure SSO/SAML providers. *(flagged)*
- SSO configuration is managed per-organization through company settings.
- Gated behind the `SSO` feature flag.

### Two-Factor Authentication

- Users can enroll in 2FA for an additional layer of login security.
- Enforced based on organization policy.

### Session Management

- JWT-based authentication with token versioning for instant revocation.
- `tokenVersion` field on user records enables mass token revocation (e.g., password change invalidates all sessions).
- Auth cookies with secure settings; clear-cookie endpoint for logout.

### Account Security

- **Failed login lockout**: Accounts lock after repeated failed attempts (`failedLoginAttempts`, `lockedUntil`).
- **Password reset**: Token-based password reset flow with expiring tokens and email delivery via SendGrid.
- **Email verification**: Verified flag on user records; required for sensitive operations.
- **Rate limiting**: Separate rate limiters for auth endpoints (`authLimiter`), sensitive operations (`sensitiveLimiter`), and general API calls (`apiLimiter`).

---

## 4. Dashboard & Company Health

### Customizable Widget Dashboard

The main dashboard is a fully customizable, widget-based interface that adapts to each user's role.

**Available Widget Categories:**

| Widget | Description |
|--------|-------------|
| **Active Projects** | Summary of current projects with status indicators and key metrics. |
| **Cash Position** | Current cash flow and financial health overview. |
| **AI Tasks** | AI-generated tasks prioritized by role and urgency. |
| **Schedule Impact** | Schedule variance and delay tracking summary. |
| **Weather** | Weather conditions for active project sites. |
| **Safety** | Safety incident and training compliance metrics. |
| **Equipment** | Equipment utilization and maintenance alert summary. |
| **Procurement** | Pending purchase requests, orders, and delivery status. |
| **Crew** | Crew assignment overview and availability. |

**Dashboard Features:**

- Drag-and-drop widget arrangement via edit mode.
- Widget library for adding/removing widgets by section.
- Theme picker for personalization.
- Announcement banner for company-wide bulletins.
- Role-based widget visibility (financial widgets hidden from Hourly Employees).
- Time-of-day greeting with user avatar.

### Company Health Page

An executive-level metrics page accessible to Admin and Manager roles:

- Organization-wide KPI tracking.
- Revenue target vs. actual performance.
- Project portfolio health score.
- Overhead monitoring with warning and critical thresholds.
- Monthly revenue target tracking.

### Executive Digest

- AI-generated daily/weekly executive summaries.
- Profitability warnings and billing alerts.
- Accessible to Admin and Manager roles.

### What-If Simulator

- Scenario modeling for financial planning.
- Project mix analysis and margin forecasting.
- Accessible through the CFO Dashboard.

---

## 5. Project Management

### Project Lifecycle

Projects follow a defined state machine:

```
BID → PLANNING → ACTIVE → COMPLETE → CLOSED
```

- Reverse transitions are allowed (e.g., COMPLETE → ACTIVE if more work is needed).
- CLOSED is a terminal state.
- Hourly employees only see ACTIVE projects.

### Project Creation

- Direct creation with auto-generated project codes.
- Conversion from awarded bids (preserving all estimates, quotes, and scope items).
- CRM integration for auto-populating client and contact fields.
- Fields include: name, client info, location, budget, contract amount, team assignments (estimator, superintendent, project manager), GC/owner rep organizations.

### Project Detail Tabs

| Tab | Description | Access |
|-----|-------------|--------|
| **Overview** | Project summary, team, status, key dates, AI data quality score. | All contractors |
| **Financials** | Budget vs. actual, cost breakdown, revenue tracking. | Financial roles |
| **Labor** | Time entries, labor hours, labor cost tracking. | Financial roles |
| **Equipment** | Equipment assigned to project, usage tracking. | Equipment roles |
| **Risks** | Risk register, delay tracking, AI risk identification. | All contractors |
| **Documents** | Plan documents, specs, uploaded files with version control. | All contractors |
| **Procurement** | Material orders, POs, delivery tracking. | Financial + Procurement roles |
| **Daily Reports** | Daily notes with AI insight analysis. | All contractors |
| **Scope** | Scope items with quantity tracking and billing status. | All contractors |
| **Change Orders** | Change order management with approval workflow. | All contractors |
| **Takeoff** | Plan sheets with measurement tools. | All contractors |
| **Media** | Photos and videos with AI tagging and descriptions. | All contractors |

### Task Management

- Unified task system supporting manual, email-derived, AI-generated, and system tasks.
- Tasks linked to projects, bids, vendors, email threads, and hiring candidates.
- Subtasks, comments, and attachments.
- Priority levels: Critical, High, Medium, Low.
- Status workflow: Pending → In Progress → Completed / Dismissed.
- Category-based organization (Safety, Financial, Schedule, Procurement, etc.).

### Calendar

- Organization-wide and project-specific event views.
- Event types for meetings, deadlines, inspections, milestones.
- Integration with project timelines and bid due dates.

### Punch Lists

- Trade-specific punch list items with priority levels.
- Status tracking: Open → In Progress → Complete → Verified.
- Assignee management and due date tracking.

### Inspections

- Inspection scheduling with type and method tracking.
- Status workflow: Scheduled → Passed / Failed / Cancelled.
- Integration with daily reports and project timeline.

### Project Delays

- Delay tracking with reason codes and responsibility assignment.
- Delay types: Weather, Owner, Subcontractor, Material, Permit, Design.
- Notification system for stakeholders.
- Delay claim documentation for disputes.

### Daily Notes

- Project-specific and company-wide daily notes.
- AI analysis of notes to surface insights, risks, and action items.
- Photo and attachment support.

---

## 6. Bid Management & Estimating

### Bid Wizard

- Step-by-step guided bid creation workflow.
- AI-powered text analysis: paste a scope description and the system extracts project details, scope items, requirements, and pricing factors.
- CRM integration for auto-populating client information.
- Due date tracking with overdue alerts.

### Bid Pipeline

- Pipeline view with status stages: Draft → Submitted → Pending Approval → Approved → Won / Lost.
- Filtering by due date, status, estimator assignment.
- Estimator assignment tracking.
- AI win probability scoring per bid.
- Bid-to-project conversion with team assignment (superintendent, project manager), overhead/profit percentages, and starting status selection.

### Estimate Builder

- Multi-version estimate management per bid or project.
- Detailed line items with:
  - Description, quantity, unit, unit cost, total cost.
  - Category classification (labor, material, equipment, subcontractor).
  - Source tracking (manual, AI-generated, imported).
  - Cost code assignment.
  - Waste factor calculation.
- Estimate versions with snapshot history.
- Vendor quote attachment and linking to line items.
- Alternate pricing (base bid + alternates).
- Cost breakdown JSON for detailed analysis.

### Takeoff Sheets & Measurements

- PDF plan upload with per-page image extraction.
- Interactive measurement tools:
  - Linear measurements (length in feet).
  - Area measurements (square feet).
  - Volume measurements (cubic yards).
  - Count measurements (each).
  - Arc/curve measurements with arc data.
  - Depth calculations for volume.
  - Pitch ratio adjustments for roofing.
- Scale calibration (pixels per foot).
- Measurement categories with color coding, line styles, and waste factors.
- Measurement groups for organization.
- Version control on takeoff measurements.
- Location tagging (Building → Floor → Room/Zone hierarchy).
- Installation status tracking (Not Started → In Progress → Complete → Verified).
- Deduction support for openings and exclusions.
- Sheet rotation and revision management.

### BIM Viewer (Web-IFC)

- IFC file upload and rendering.
- Quantity extraction from BIM models.
- Mapping extracted data to estimate line items.
- Integration with takeoff measurements.

### Assemblies

- Reusable assembly definitions with component materials.
- Production rate mapping per assembly.
- Blended crew rate calculations.

### Production Rates

- Historical production rate tracking across projects.
- Per-unit metrics: labor hours/unit, labor cost/unit, material cost/unit, total cost/unit.
- Organization-wide scope of work (SOW) library for standardized tracking.
- Daily scope progress entries capturing crew size, labor hours, material and equipment costs.

### Bid-to-Project Conversion

- One-click conversion preserving:
  - All estimate line items (converted to scope items).
  - Subcontractor and material quotes.
  - Document attachments.
- Team assignment during conversion (superintendent, project manager).
- Overhead and profit percentage configuration.
- Starting status selection (Active or Planning).

### Overhead & Profit Calculations

- Configurable default overhead percentage per organization.
- Per-bid overhead and profit percentage overrides.
- Subcontractor markup percentage.
- Overhead warning and critical thresholds.
- Overhead category weight configuration.

### Addenda Tracking

- Addendum management with status tracking.
- Recipient notification system.
- Document attachment support.

---

## 7. Financial Controls

### Schedule of Values (SOV)

- SOV creation per project with line items.
- Line items linked to cost codes.
- Quantity-based and lump-sum billing support.
- Retainage tracking.
- Integration with progress billing.

### AIA Progress Billing

- Industry-standard AIA G702/G703 progress billing.
- Application for payment generation.
- Previous, current period, and total tracking.
- Retainage management.
- PDF export for client submission.

### Change Order Management

- Full CRUD with approval workflow: Draft → Submitted → Approved / Rejected.
- Multi-level approval chain with configurable approvers.
- Line item breakdown by type:
  - **Labor entries**: employee, position, hours, hourly rate, total.
  - **Equipment entries**: type, description, quantity, hours, rate, total.
  - **Material entries**: description, category, quantity, unit, unit cost, total (with vendor catalog lookup).
- Overhead, profit, and subcontractor markup percentages.
- Revision history with full audit trail.
- Void functionality with reason tracking.
- PDF/export generation.
- Linked to T&M tickets, RFIs, and contracts.
- Auto-change-order capability with configurable thresholds.
- Takeoff delta JSON for measurement-based change orders.

### Cost Codes

- **CSI Division support**: Industry-standard Construction Specifications Institute division codes.
- **Custom cost codes**: Organization-level custom code definitions.
- **Project-level assignment**: Cost codes linked to time entries, change orders, T&M tickets, and procurement.
- Organization-wide cost code management through company settings.

### Budget vs. Actual Tracking

- Project budget amount vs. actual cost comparison.
- Budget alert thresholds (warning at 80%, critical at 95% — configurable).
- Material budget snapshots from estimates at project creation.
- Material usage tracking with variance calculations.
- Variance percentage and quantity tracking.

### Cost Ledger

- Centralized cost ledger with cost source categorization.
- Cost origin module tracking (which module generated the cost entry).
- Transaction status management.

### Revenue Recognition

- Revenue recognition tracking per project.
- WIP (Work in Progress) report generation.
- Earned revenue vs. billed revenue analysis.

### Cost Engine

- Automated cost calculation engine.
- Burden rate application (taxes, benefits, insurance, overhead percentages).
- Fully burdened cost computation per employee.
- Derived hourly rate calculations.
- Annual salary category management.
- Employee cost assignment with effective date tracking.

---

## 8. Field Operations

### GPS-Enabled Time Clock

- Clock in/out with GPS location capture.
- **Geofencing**: Per-project geofence radius and enforcement levels (Off, Warning, Block).
- Site latitude/longitude configuration.
- Clock event types: clock-in, clock-out, break-start, break-end.
- Photo capture on clock events with custody chain tracking.

### Time Entry Management

- Manual time entry creation with project and cost code assignment.
- Regular and overtime hour tracking.
- Approval workflow: Pending → Approved / Rejected.
- Approver assignment with rejection reason.
- Shift approval status management.

### Overtime Rules

- Configurable overtime threshold (default 40 hours/week).
- Work week start day configuration (any day, default Monday).
- Overtime request management with approval workflow.
- Automatic overtime calculation.

### Crew Scheduling & Assignments

- Crew creation with member management and lead assignment.
- Crew-to-project assignment with date ranges.
- Crew availability status tracking.
- Skills and competency tracking per crew member.
- Skill verification requests and approval.
- User certifications with expiry notifications (30-day and 5-day alerts).
- Equipment competency tracking.

### T&M Tickets & Invoicing

- Comprehensive Time & Material ticket system:
  - Ticket number, work date, scope description.
  - Standardized scope of work linking (category, work type, modifiers).
  - Labor line items with hours and rates.
  - Equipment line items with hours and rates.
  - Material line items with quantities and costs.
  - Grand total calculation from line items.
- Approval workflow: Draft → Submitted → Approved / Rejected.
- Client digital sign-off with signature capture.
- Signed document upload.
- Billing workflow: Pending → Approved → Billed.
- T&M Invoice generation with:
  - Invoice number, date, due date.
  - Client billing information.
  - Subtotal, tax, total calculations.
  - PDF generation and delivery.
  - Status tracking: Draft → Sent → Paid.

### Equipment & Fleet Tracking

- Comprehensive equipment registry:
  - Equipment code, type (Heavy Equipment, Vehicle, Tool, etc.).
  - Make, model, year, serial number, VIN, license plate.
  - Status: Available, Assigned, In Repair, Out of Service, Retired.
- **Usage tracking**: Current meter hours with hour log entries.
- **Assignment management**: Equipment-to-project and equipment-to-crew assignments.
- **Preventive maintenance alerts**:
  - Maintenance schedules with recurring intervals.
  - Maintenance history tracking.
  - Next maintenance date calculation.
  - Hour-based maintenance reminders.
- **Repair tracking**: Repair requests, costs, and resolution.
- **Depreciation**: Straight-line and declining balance methods with useful life and salvage value.
- **Rate profiles**: Equipment billing rates for different usage scenarios.
- **Rental management**: Rental vendor catalog, rental equipment usage tracking.

### Field Productivity Metrics

- Voice dictation for hands-free daily reporting.
- Issue capture from the field.
- Offline sync capability for areas with poor connectivity.
- Daily scope progress tracking with per-unit production metrics.

---

## 9. Payroll & HR

### Pay Runs

- Pay run creation with period start/end dates.
- Status workflow: Draft → Pending Approval → Approved → Paid / Voided.
- Automatic run number generation.
- Aggregated totals: regular hours, overtime hours, labor cost, gross amount, deductions, net amount, total workers.
- Approval tracking with approver and approval timestamp.

### Pay Run Line Items

- Per-employee, per-project line items.
- Regular, overtime, and double-time hours with separate rates.
- Cost code assignment.
- Gross amount, deductions, and net amount calculation.
- Time entry linkage (which clock entries contributed to this line).
- Wage type tracking (Standard, Prevailing Wage).

### Job Classifications

- Trade-based classifications (e.g., Carpenter, Electrician, Laborer).
- Code and description per classification.
- Default regular and overtime rates.
- Organization-level management with unique naming.

### Employee Classifications

- Assign employees to job classifications with specific rates.
- Primary classification designation.
- Effective date and end date for historical tracking.

### Prevailing Wage Rates

- Per-project, per-classification prevailing wage rates.
- Base wage, fringe rate, and total rate.
- Overtime multiplier (default 1.5x).
- Wage decision reference numbers.
- Effective and expiration dates.

### Deduction Types

- Organization-level deduction type definitions.
- Categories: Federal Tax, State Tax, Insurance, Retirement, Union Dues, Garnishment, Other.
- Calculation methods: Fixed Amount, Percentage.
- Pre-tax / post-tax designation.
- Maximum annual amount caps.
- Sort order for display.

### Employee Deductions

- Per-employee deduction assignments from type catalog.
- Override amounts for individual employees.
- Effective date and end date tracking.

### Pay Stub Deductions

- Per-line-item deduction application.
- Year-to-date amount tracking.

### Payroll Settings

- Organization-level payroll configuration:
  - Work week start day.
  - Overtime threshold hours.
  - Work week end notification toggle and recipient emails.
  - Auto-generate weekly reports toggle.
  - Superintendent approval requirement toggle.

### WH-347 Certified Payroll

- Federal certified payroll report generation (WH-347 format).
- Prevailing wage compliance verification.
- Fringe benefit tracking.

### Weekly Payroll Reports

- Auto-generated end-of-week reports.
- Total regular hours, overtime hours, employee count.
- Report data with notification tracking.
- Organization-week uniqueness enforced.

### Batch Approvals

- Bulk time entry approval for superintendents and managers.
- Batch pay run processing.

### Void Functionality

- Pay run void with reason tracking.
- Voided-at timestamp and voided-by user recording.

### Leave Management

- Leave request submission and approval workflow.
- Leave request status: Pending → Approved / Rejected.
- Leave balance tracking.

---

## 10. Procurement

### Full Procurement Pipeline

The procurement module implements a complete PR → PO → Receipt → Invoice pipeline:

#### Purchase Requests (PR)

- Request creation with description, quantity, unit, estimated cost.
- Project and cost code assignment.
- Status workflow: Draft → Submitted → Approved → Ordered / Rejected.
- Approval workflow integration.

#### Purchase Orders (PO)

- PO generation from approved purchase requests.
- Vendor assignment, PO number, terms.
- Line item management.
- Status tracking: Draft → Issued → Partially Received → Received → Closed.

#### PO Receipts

- Receipt recording against purchase orders.
- Item condition tracking.
- Partial receipt support.
- Status: Pending → Accepted / Rejected.

#### Vendor Invoices

- Invoice recording against purchase orders.
- Invoice matching against POs and receipts.

### 3-Way Matching

- Automated matching of PO, Receipt, and Invoice.
- Match tolerance percentage (configurable per organization, default 5%).
- Match status tracking with discrepancy flagging.

### Integration with Cost Tracking

- Procurement costs flow into project cost codes.
- Integration with the cost ledger for budget vs. actual tracking.
- Procurement items linked to project scope items.

---

## 11. AI Intelligence Suite

### AI Project Manager

- **Task Generation**: AI analyzes project data and generates role-specific prioritized tasks.
- **Risk Identification**: Automatic detection of schedule, budget, and resource risks.
- **Daily Summaries**: AI-generated project status summaries with actionable insights.
- **Daily Runs**: Configurable automated daily AI analysis (time, enabled/disabled toggles).
- **AI Insights**: Module-specific insights with severity levels (Info, Warning, Critical).
  - Gantt scheduling recommendations (task ordering, resource allocation, critical path, parallel work).
  - Vendor comparison analysis with potential savings calculations.
  - Profitability warnings.
  - Crew scheduling optimization.
  - Bid deadline reminders.
  - Material ordering suggestions.

### AI CFO

- **Cashflow Forecasting**: Predictive cash position modeling based on project timelines and billing schedules.
- **Margin Tracking**: Real-time profit margin analysis across projects.
- **What-If Simulators**: Scenario modeling for financial planning decisions.
- **WIP Reports**: Work-in-progress reporting with earned vs. billed analysis.
- **Profitability Alerts**: Automated warnings when project margins fall below thresholds.
- **KPI Dashboard**: Key financial performance indicators with trend analysis.

### AI Document Analysis

- **Blueprint Analysis**: AI extraction of quantities, dimensions, and scope from uploaded construction plans.
- **Contract Analysis**: AI-powered review of contracts and award documents extracting:
  - Contract type, number, dates, parties.
  - Contract value, retainage, payment terms.
  - Scope of work with inclusions and exclusions.
  - Insurance and bonding requirements.
  - Key terms, risk factors, obligations.
  - Warranty, change order process, dispute resolution clauses.
- **Bid Document Analysis**: AI extraction from bid invitations and scope documents:
  - Project details, client info, due dates.
  - Line items with quantities and units.
  - Requirements and qualifications.
  - Pricing factors and risk assessment.
  - Confidence scoring (0-100).

### AI Hiring Assistant

- **Job Posting Generation**: AI-assisted creation of job listings with trade-specific language.
- **Resume Scoring**: Automated candidate evaluation and ranking.
- **Interview Scheduling**: AI-optimized interview scheduling.
- Detailed in the [Hiring & Recruitment](#13-hiring--recruitment) section.

### AI Scheduling

- CPM (Critical Path Method) engine for schedule optimization.
- Baseline scheduling with resource loading.
- AI-driven schedule forecasting.
- Gantt chart recommendations for task ordering and parallel work opportunities.

### AI Takeoff

- AI-assisted measurement detection on plan sheets.
- Automated quantity extraction from uploaded blueprints.
- AI takeoff mode and status tracking.
- Integration with manual measurement tools for verification.

### AI Onboarding

- Guided organization onboarding with AI assistance.
- Trade-specific setup recommendations.
- Terminology customization per organization.
- Theme extraction from uploaded logos.
- Walkthrough steps with progress tracking.

### AI Governance

- Model configuration (AI model selection).
- Feature toggle controls for each AI capability.
- AI run history and audit trail.
- Data quality scoring per project.
- AI insight acknowledgment and dismissal tracking.

---

## 12. CRM

### Contact & Organization Management

- **CRM Organizations**: Company records with:
  - Type classification (Client, Subcontractor, Vendor, Partner, Other).
  - Status tracking (Active, Inactive, Prospect, etc.).
  - Industry, website, address, phone, email.
  - Preferred contact method.
  - Notes and internal tags.
- **CRM Contacts**: Individual contact records linked to organizations:
  - Role classification (Primary, Billing, Technical, Executive, Other).
  - Contact details (email, phone, mobile).
  - LinkedIn profile linking.

### Sales Pipeline

- **Pipeline Stages**: Lead → Qualified → Proposal → Negotiation → Won / Lost.
- Stage tracking with timestamps.
- Revenue forecasting based on pipeline stage.

### Pipeline Reporting

- Pipeline value by stage.
- Win/loss ratio analysis.
- Average deal cycle time.

### Advanced Filters

- Multi-criteria filtering across organization and contact records.
- Filter by type, status, industry, location, and activity recency.

### Duplicate Detection

- Automatic detection of potential duplicate contacts and organizations.
- Merge recommendations.

### Idle Lead Alerts

- Automated notifications for leads without recent activity.
- Configurable idle period thresholds.

### Email & Calendar Visibility

- Email thread visibility per CRM organization.
- Calendar event linkage to CRM contacts.

### CRM-to-Bid/Project Linking

- Direct linking from CRM organizations to bids and projects.
- Auto-population of client fields from CRM records during bid/project creation.
- Activity logging on CRM records from project and bid interactions.

---

## 13. Hiring & Recruitment

### Applicant Tracking System

The hiring module provides a complete ATS with the following capabilities:

#### Job Listings

- Job posting creation with:
  - Title, description, trade requirements.
  - Location, compensation type and range.
  - Employment type (Full-time, Part-time, Contract, Seasonal).
  - Status: Draft → Open → Paused → Closed → Filled.
- AI-assisted job description generation.
- External ATS provider sync (Indeed, LinkedIn, ZipRecruiter, Greenhouse, Lever, etc.).

#### Candidate Pipeline

- Candidate records with:
  - Personal information, contact details.
  - Resume URL, cover letter, portfolio.
  - Stage tracking: Applied → Screening → Interview → Offer → Hired / Rejected.
  - Source tracking (job board, referral, direct, ATS sync).
  - AI resume score (0-100).
- Kanban-style pipeline board view.

#### Resume Scoring

- AI-powered resume evaluation against job requirements.
- Scoring criteria: experience match, skills alignment, certification relevance.
- *(flagged)* via `HIRING_AI_SCORING`.

#### Interview Scheduling

- Interview creation with date, time, duration, location.
- Interviewer assignment.
- Status: Scheduled → Completed → Cancelled → No Show.
- Feedback and notes capture post-interview.

#### Hiring Dashboard

- Overview metrics: open positions, candidates in pipeline, interviews scheduled.
- Time-to-fill analytics.
- Source effectiveness analysis.
- Task management integration for hiring-related follow-ups.
- Auto-task generation for hiring workflows. *(flagged)* via `HIRING_AUTO_TASKS`.

#### Hiring Settings

- ATS integration configuration.
- Auto-task toggle and preferences.
- AI scoring enablement.
- Admin-only access.

### Talent Pool

- Maintain a database of past candidates for future openings.
- Search and filter by skills, trade, and availability.

---

## 14. Subcontractor & Vendor Management

### Subcontractor Contracts

- Contract creation with scope, value, and terms.
- Contract types: Subcontract, Prime Contract, Amendment.
- Status tracking: Draft → Active → Complete → Terminated.
- Retainage management.
- Contract redlining and approval workflow.

### Subcontractor Payables

- Payment tracking against subcontractor contracts.
- Pay application processing.
- Retention release management.
- Performance tracking.

### Vendor Management

- Vendor catalog with pricing history.
- Vendor scoring and performance evaluation.
- Material price benchmarking.
- Pricebook import capability.

### Bid Network

- **For GCs**: Create bid requests and send invitations to subcontractors.
- **For Subs**: Receive bid invitations and submit responses.
- Bid invitation status tracking.
- Response management with shortlisting and awarding.
- Bid request deletion controls (Admin/Manager only).

### RFQ Workflow

- Request for Quote generation and distribution.
- External response tokens for vendor/sub portal access.
- Response attachment collection.
- Quote comparison and selection.

### Marketplace

- **Equipment Rental**: Browse and compare rental equipment from vendors.
- **Material Price Benchmarking**: Compare material prices across vendors.
- **Contractor Profiles**: Public contractor profiles in the marketplace.
- **Crew Marketplace**: Find and hire crews.

---

## 15. Communication & Messaging

### Internal Messaging System

- **Real-time delivery** via Server-Sent Events (SSE).
- **Typing indicators** for live conversation feedback.
- **Message history** with infinite scroll pagination.
- **Edit and delete** messages after sending.
- **Reactions** on messages.
- **Mentions** (@user) for targeted notifications.
- Conversation types: Direct, Group, Project, Channel.
- Message entity type linking (to projects, bids, tasks).
- Video call integration with global video call overlay.

### Company Bulletins & Announcements

- Company-wide bulletin creation and management.
- Announcement banners on the dashboard.
- Platform-level announcements from Super Admin.
- Targeted announcements by organization.

### Notification Framework

| Channel | Description |
|---------|-------------|
| **Email (SendGrid)** | Transactional emails for password resets, notifications, and alerts. |
| **Web Push** | Browser push notifications with subscription management. |
| **SMS** | Text message notifications for critical alerts. |
| **Teams** | Microsoft Teams channel notifications. |
| **Slack** | Slack channel integration for notifications. |

- Notification types: Task assignment, approval request, deadline reminder, safety alert, etc.
- User-level notification preferences.
- Push subscription management per device.

---

## 16. Portal & External Access

### Client Portal

- **Project Progress Tracking**: Clients view project status, milestones, and completion percentages.
- **Change Order Approvals**: Clients review, approve, or request modifications to change orders.
- **Chat**: Threaded chat between client and project team.
  - Thread categories and priority levels.
  - Thread status tracking: Open → In Progress → Resolved → Closed.
- Public access via unique project URL (`/portal/:projectId`).

### Subcontractor Portal

- **Scope Management**: Subcontractors view their assigned scope and progress requirements.
- **Chat**: Direct communication channel with the GC project team.
- Access via `/sub-portal` route.

### Vendor Dashboard

- Dedicated vendor portal with:
  - **Dashboard**: Overview of active engagements and pricing submissions.
  - **My Pricing**: Manage and submit pricing catalogs to enrolled clients.
  - **Enrolled Clients**: View and manage client enrollments.
  - **Messages**: Communication with contractor clients.
  - **Documents**: Document management and sharing.

### Shared Preview Links

- Generate shareable preview links for external stakeholders.
- Token-based access without requiring login.
- Configurable content visibility.

### Hustler Multi-Org Dashboard

- **Cross-organization view**: Aggregate metrics across all linked organizations.
- **Organization switching**: Quick switch between linked organizations.
- **Unified inbox**: Single inbox for communications across all organizations.
- **Benchmarking**: Compare performance metrics across organizations.
- **Delegate roles**: Assign delegate access levels per organization.
- Link request system for connecting organizations.

---

## 17. Website Builder

### White-Label Website Builder

- Contractors can build and publish their own company website.
- **Subdomain routing**: Each organization gets a unique subdomain (e.g., `yourcompany.smartmanageai.com`).
- **Staging previews**: Preview changes before publishing at `/site/:subdomain/staging`.

### SEO Features

- **Open Graph tags**: Configurable OG title, description, and images for social sharing.
- **Sitemap generation**: Automatic XML sitemap.
- **robots.txt management**: Configurable search engine crawling rules.
- **Social images**: Auto-generated or uploaded social media preview images.
- Meta description and title tag management per page.

### AI-Assisted Content Generation

- AI-powered content writing for website pages.
- Trade-specific content suggestions.
- Auto-generated company descriptions and service pages.

### Social Media Post Scheduling

- Create and schedule social media posts.
- Auto-publish to connected platforms.
- Content calendar view.
- Post analytics and engagement tracking.
- Accessible to Admin, Manager, and Marketing roles.

---

## 18. Safety & Compliance

### Safety Training Tracking

- Training course management with assignment and completion tracking.
- Certification tracking with expiry date management.
- 30-day and 5-day expiry notification alerts.
- Safety training dashboard.

### Safety Workflows

- Configurable safety workflows for incidents, inspections, and audits.
- Incident reporting and investigation tracking.
- Safety incident severity classification.

### Daily Report Locks

- Lock daily reports to prevent retroactive editing.
- Lock status: Unlocked → Locked → Admin Override.
- Admin, Manager, and Superintendent access for lock management.

### Audit Logging

- Comprehensive audit trail for all data modifications.
- Audit log entries capture:
  - Action type: Create, Update, Delete, Approve, Reject, Login, and custom actions.
  - Entity type and ID.
  - Before/after values for change tracking.
  - User ID and timestamp.
  - IP address and user agent.
- Organization-scoped audit logs.

### Audit Export *(flagged)*

- Export audit logs for external compliance review.
- Gated behind the `AUDIT_EXPORT` feature flag.

### Data Retention Policies *(flagged)*

- Configurable data retention periods.
- Automated data archival.
- Gated behind the `DATA_RETENTION` feature flag.

### Privacy Controls

- Data subject request management (GDPR): *(flagged)*
  - Request types: Access, Deletion, Rectification, Portability, Restriction.
  - Status tracking: Pending → In Progress → Completed → Denied.
- Gated behind the `PRIVACY_COMPLIANCE` feature flag.

### GDPR Compliance

- Right to access, right to erasure, data portability.
- Consent management.
- Data processing records.

---

## 19. Integrations & Platform

### Cloud Storage Integrations

| Provider | Capability |
|----------|------------|
| **Box** | File sync and document management. |
| **Dropbox** | File sync and document management. |
| **Google Drive** | File sync and document management. |
| **OneDrive** | File sync and document management. |

- Integration connection management with status tracking.
- OAuth-based authentication per provider.
- *(flagged)* via `INTEGRATION_GOOGLE`, `INTEGRATION_MICROSOFT`.

### Accounting Integration

- **QuickBooks Online (QBO)**: Bi-directional sync for invoices, expenses, and chart of accounts.
- *(flagged)* via `INTEGRATION_QBO`.

### Email Delivery (SendGrid)

- Transactional email delivery for:
  - Password reset emails.
  - Notification emails.
  - Invitation emails.
  - Report delivery.
- Email template management.
- Email classification and thread management.
- Email-to-task conversion.

### Automation (Zapier)

- Zapier integration for connecting SmartManageAI with 5,000+ apps.
- Trigger events on key actions (project created, bid submitted, etc.).
- *(flagged)* via `INTEGRATION_ZAPIER`.

### SSO / SAML Providers

- Enterprise SSO configuration.
- SAML 2.0 support.
- Feature-flagged via `SSO`.

### Object Storage

- File uploads with MIME type and file size validation.
- Object key-based file management.
- 10 MB upload limit per file.
- Support for documents, images, PDFs, and IFC files.

### Internal Domain Event Bus

- Domain events for cross-module communication.
- Event types for all major entity lifecycle changes.
- Event status tracking: Pending → Processed → Failed.
- Audit trail for event processing.

### Integration Hub

- Centralized integration management dashboard.
- Connection status monitoring (Connected, Disconnected, Error, Expired).
- Provider configuration (QBO, Google, Microsoft, E-Sign, Zapier).
- Integration event logging.
- *(flagged)* via `INTEGRATIONS_HUB`.

---

## 20. Platform Administration

### Super Admin Dashboard

- Organization count and health overview.
- API request analytics and error rate monitoring.
- System health indicators.
- Recent subscription events.

### Organization Management

- View all organizations with filtering and search.
- Organization detail view with:
  - Subscription tier and status.
  - User count and active user metrics.
  - Feature flag management.
  - Add-on management.
  - Usage tracking.

### Impersonation

- Super Admin can impersonate any user in any organization for support and debugging.
- Impersonation banner displayed to indicate active impersonation session.
- Full audit trail of impersonation sessions.

### Subscription & Add-On Management

- Plan tier management: Free, Pro, Enterprise.
- Subscription status: Active, Past Due, Cancelled, Trialing.
- Add-on activation and deactivation:
  - Available add-ons tracked via `addonKey` enum.
  - Per-organization add-on status management.
  - Stripe price ID linking for billing.
- Subscription event logging for all changes.

### Usage Tracking

- Per-organization usage monitoring.
- Usage key tracking for consumption-based features (e.g., AI Vision analysis calls).
- Period-based usage aggregation.

### API Request Analytics

- Request volume tracking per organization.
- Error rate monitoring.
- Rate limiting enforcement.

### System Health Monitoring

- Platform monitoring dashboard.
- Error tracking and alerting.
- Database connection and performance monitoring.

---

## 21. Performance & Infrastructure

### Code Splitting & Lazy Loading

- All page components use React `lazy()` with `Suspense` for on-demand loading.
- Loading spinner fallback during chunk downloads.
- Route-level code splitting via dynamic imports.

### Database Indexing & Caching

- Comprehensive database indexing on:
  - Foreign keys (organization IDs, project IDs, user IDs).
  - Status fields for filtered queries.
  - Date fields for range queries.
  - Composite indexes for common query patterns.
  - Unique constraints for data integrity.
- TanStack Query client-side caching with cache invalidation on mutations.

### Response Compression

- Gzip/Brotli compression on API responses.
- Optimized payload sizes for mobile and low-bandwidth clients.

### Rate Limiting

- Three-tier rate limiting:
  - **Auth limiter**: Strict limits on login and registration endpoints.
  - **Sensitive limiter**: Limits on password reset and security operations.
  - **API limiter**: General rate limiting on all API routes.

### Connection Pool Sizing

- PostgreSQL connection pool tuning for concurrent request handling.
- Optimized for multi-tenant workloads.

### File Upload Hardening

- **File existence validation**: Verify files exist before processing.
- **MIME type validation**: Whitelist of allowed file types.
- **File size validation**: 10 MB maximum per upload.
- **Input sanitization**: Dedicated sanitizers for short text, long text, email, and phone inputs.
- **Monetary amount validation**: Range and format checks on all financial inputs.
- **JSON field validation**: Parse verification on all JSON string fields.

### Offline Support

- Mobile offline sync capability for field workers.
- Offline entity types with operation tracking (Create, Update, Delete).
- Sync status management: Pending → Synced → Failed → Conflict.
- Conflict resolution handling.

---

*This document is the authoritative reference for the SmartManageAI platform. For API endpoint documentation, refer to the Swagger/OpenAPI docs at `/api-docs`. For database schema details, refer to the Drizzle schema files in `shared/schema/`.*
