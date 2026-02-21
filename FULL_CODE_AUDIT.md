# SmartManageAI — Full Code Audit

**Generated**: February 21, 2026  
**Schema**: 7,322 lines | **Main Routes**: 20,249 lines | **213 Tables** | **133 Enums** | **70+ Pages** | **81 Components** | **49 UI Components**

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Database Schema](#3-database-schema)
4. [Authentication & Security](#4-authentication--security)
5. [Backend Architecture](#5-backend-architecture)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Sidebar Navigation Structure](#7-sidebar-navigation-structure)
8. [Subscription & Billing System](#8-subscription--billing-system)
9. [AI System](#9-ai-system)
10. [Shared Libraries & Calculations](#10-shared-libraries--calculations)
11. [Portal Systems](#11-portal-systems)
12. [Vendor System](#12-vendor-system)
13. [HUSTLER Multi-Org System](#13-hustler-multi-org-system)
14. [Platform Admin System](#14-platform-admin-system)
15. [External Integrations](#15-external-integrations)
16. [File Structure Summary](#16-file-structure-summary)
17. [Codebase Metrics](#17-codebase-metrics)

---

## 1. Platform Overview

SmartManageAI is a white-label SaaS construction management platform designed to manage the entire construction project lifecycle. It supports multiple contracting specialties (23 trade types) with trade-specific customizations, centralizing project data, user management, and daily operations. The platform features:

- **Multi-Tenant Architecture** with trade-specific configurations and AI-driven onboarding
- **10 User Roles** with comprehensive Role-Based Access Control (RBAC)
- **4-Tier Subscription Model** with 6 add-ons and feature gating
- **AI-Powered** analysis, scheduling, estimating, email classification, and onboarding
- **Complete Project Lifecycle**: Bids → Estimates → Projects → Daily Progress → SOV Billing
- **23 Trade Type Templates** with auto-seeded scope of work items
- **Portal Systems** for subcontractors and clients with chat
- **White-Label Branding** across platform and PDF generation
- **Construction Calculator Suite** with 13 specialized tools
- **Website Builder** with AI wizard for company websites

---

## 2. Tech Stack & Dependencies

### Core Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript |
| **Routing** | Wouter v3 |
| **State/Data** | TanStack Query v5 |
| **Styling** | Tailwind CSS 3 + shadcn/ui |
| **Backend** | Express.js + TypeScript |
| **Database** | PostgreSQL (Neon) + Drizzle ORM |
| **Auth** | JWT + httpOnly cookies + bcrypt |
| **AI** | OpenAI GPT-4 / GPT-4o |
| **Email** | Resend + SendGrid |
| **Storage** | Replit Object Storage (Google Cloud Storage) |
| **PDF** | PDFKit |
| **Scheduling** | node-cron |
| **Build** | Vite 5 + esbuild |

### All Dependencies (package.json)

**Production Dependencies (90+):**
- `@google-cloud/storage` ^7.17.3
- `@hookform/resolvers` ^3.10.0
- `@neondatabase/serverless` ^0.10.4
- `@radix-ui/react-accordion` ^1.2.4
- `@radix-ui/react-alert-dialog` ^1.1.7
- `@radix-ui/react-aspect-ratio` ^1.1.3
- `@radix-ui/react-avatar` ^1.1.4
- `@radix-ui/react-checkbox` ^1.1.5
- `@radix-ui/react-collapsible` ^1.1.4
- `@radix-ui/react-context-menu` ^2.2.7
- `@radix-ui/react-dialog` ^1.1.7
- `@radix-ui/react-dropdown-menu` ^2.1.7
- `@radix-ui/react-hover-card` ^1.1.7
- `@radix-ui/react-label` ^2.1.3
- `@radix-ui/react-menubar` ^1.1.7
- `@radix-ui/react-navigation-menu` ^1.2.6
- `@radix-ui/react-popover` ^1.1.7
- `@radix-ui/react-progress` ^1.1.3
- `@radix-ui/react-radio-group` ^1.2.4
- `@radix-ui/react-scroll-area` ^1.2.4
- `@radix-ui/react-select` ^2.1.7
- `@radix-ui/react-separator` ^1.1.3
- `@radix-ui/react-slider` ^1.2.4
- `@radix-ui/react-slot` ^1.2.0
- `@radix-ui/react-switch` ^1.1.4
- `@radix-ui/react-tabs` ^1.1.4
- `@radix-ui/react-toast` ^1.2.7
- `@radix-ui/react-toggle` ^1.1.3
- `@radix-ui/react-toggle-group` ^1.1.3
- `@radix-ui/react-tooltip` ^1.2.0
- `@sendgrid/mail` ^8.1.3
- `@tanstack/react-query` ^5.60.5
- `@uppy/aws-s3` ^5.0.2
- `@uppy/core` ^5.1.1
- `@uppy/dashboard` ^5.0.4
- `@uppy/react` ^5.1.1
- `bcrypt` ^6.0.0
- `canvas` ^3.2.1
- `class-variance-authority` ^0.7.1
- `clsx` ^2.1.1
- `cmdk` ^1.1.1
- `connect-pg-simple` ^10.0.0
- `cookie-parser` ^1.4.7
- `cors` ^2.8.5
- `date-fns` ^3.6.0
- `decimal.js` ^10.6.0
- `drizzle-orm` ^0.39.1
- `drizzle-zod` ^0.7.0
- `embla-carousel-react` ^8.6.0
- `express` ^4.21.2
- `express-rate-limit` ^8.2.1
- `express-session` ^1.18.1
- `framer-motion` ^11.13.1
- `input-otp` ^1.4.2
- `jsonwebtoken` ^9.0.2
- `konva` ^9.3.22
- `lucide-react` ^0.453.0
- `memorystore` ^1.6.7
- `multer` ^2.0.2
- `next-themes` ^0.4.6
- `node-cron` ^4.2.1
- `nodemailer` ^7.0.11
- `openai` ^6.14.0
- `passport` ^0.7.0
- `passport-local` ^1.0.0
- `pdfjs-dist` ^5.4.394
- `pdfkit` ^0.17.2
- `pg` ^8.16.3
- `react` ^18.3.1
- `react-day-picker` ^8.10.1
- `react-dom` ^18.3.1
- `react-hook-form` ^7.55.0
- `react-icons` ^5.4.0
- `react-joyride` ^2.9.3
- `react-konva` ^18.2.10
- `react-resizable-panels` ^2.1.7
- `recharts` ^2.15.2
- `resend` ^6.9.1
- `tailwind-merge` ^2.6.0
- `tailwindcss-animate` ^1.0.7
- `tw-animate-css` ^1.2.5
- `vaul` ^1.1.2
- `vitest` ^4.0.14
- `wouter` ^3.3.5
- `ws` ^8.18.0
- `xlsx` ^0.18.5
- `zod` ^3.24.2
- `zod-validation-error` ^3.4.0

**Dev Dependencies:**
- `@replit/vite-plugin-cartographer` ^0.4.2
- `@replit/vite-plugin-dev-banner` ^0.1.1
- `@replit/vite-plugin-runtime-error-modal` ^0.0.3
- `@tailwindcss/typography` ^0.5.15
- `@tailwindcss/vite` ^4.1.3
- `@types/connect-pg-simple` ^7.0.3
- `@types/express` 4.17.21
- `@types/express-session` ^1.18.0
- `@types/node` 20.16.11
- `@types/passport` ^1.0.16
- `@types/passport-local` ^1.0.38
- `@types/react` ^18.3.11
- `@types/react-dom` ^18.3.1
- `@types/ws` ^8.18.1
- `@vitejs/plugin-react` ^4.7.0
- `autoprefixer` ^10.4.20
- `drizzle-kit` ^0.31.4
- `esbuild` ^0.25.0
- `postcss` ^8.4.47
- `tailwindcss` ^3.4.17
- `tsx` ^4.20.5
- `typescript` 5.6.3
- `vite` ^5.4.20

---

## 3. Database Schema

**File**: `shared/schema.ts` — 7,322 lines  
**Tables**: 213 | **Enums**: 133

### 3A. Enums (133 total)

| # | Enum Name | Values |
|---|-----------|--------|
| 1 | `userRoleEnum` | SUPER_ADMIN, ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE, MAINTENANCE_MANAGER, VENDOR, HUSTLER |
| 2 | `projectStatusEnum` | BID, PLANNING, ACTIVE, COMPLETE, CLOSED |
| 3 | `bidStatusEnum` | DRAFT, ACTIVE, AWARDED, LOST, CANCELLED |
| 4 | `estimateStatusEnum` | DRAFT, SUBMITTED, WON, LOST, PENDING_APPROVAL, APPROVED, REJECTED |
| 5 | `estimateLineItemSourceEnum` | MANUAL, TAKEOFF, GENERATED |
| 6 | `procurementStatusEnum` | PLANNED, QUOTED, APPROVED, ORDERED, DELIVERED |
| 7 | `documentTypeEnum` | PLANS, SPECS, TAKEOFF, OTHER |
| 8 | `noteTypeEnum` | GENERAL, FIELD_NOTE, SAFETY, CLIENT_MEETING |
| 9 | `mediaTypeEnum` | IMAGE, VIDEO |
| 10 | `billingStatusEnum` | NOT_READY, READY_TO_BILL, BILLED |
| 11 | `changeOrderStatusEnum` | DRAFT, PENDING_APPROVAL, SUBMITTED, APPROVED, REJECTED |
| 12 | `calendarEventTypeEnum` | TIME_OFF_REQUEST, TIME_OFF_APPROVED, NETWORKING_EVENT, PROJECT_START, PROJECT_PHASE, PROJECT_MILESTONE |
| 13 | `notificationTypeEnum` | BILLING_READY, CHANGE_ORDER_PENDING, TIME_OFF_REQUEST, GENERAL, MATERIAL_OVERAGE, PROJECT_ASSIGNMENT, MAINTENANCE_REQUEST, REPAIR_REQUEST, DELAY_SUBMITTED, DELAY_ACKNOWLEDGED, DELAY_CHANGE_ORDER_NEEDED, PORTAL_ACTIVITY, BID_AWARDED, PROGRESS_MILESTONE, DAILY_PROGRESS_LOGGED, CHANGE_ORDER_APPROVED, SOV_ITEM_COMPLETED, PORTAL_CHAT_MESSAGE |
| 14 | `conversationTypeEnum` | DIRECT, GROUP, COMPANY |
| 15 | `messageStatusEnum` | SENT, DELIVERED, READ |
| 16 | `fileTypeEnum` | MEDIA, DOCUMENT, RECEIPT |
| 17 | `auditActionEnum` | CREATE, UPDATE, DELETE, APPROVE, REJECT, SUBMIT, CLOCK_IN, CLOCK_OUT, ADJUST, REVOKE_TOKENS, CREATE_BID_QUOTE, UPDATE_BID_QUOTE, DELETE_BID_QUOTE, CREATE_BID_MATERIAL_QUOTE, UPDATE_BID_MATERIAL_QUOTE, DELETE_BID_MATERIAL_QUOTE |
| 18 | `clockEventTypeEnum` | CLOCK_IN, CLOCK_OUT, ADJUSTMENT, ADMIN_OVERRIDE, AUTO_CLOCK_OUT |
| 19 | `shiftApprovalStatusEnum` | PENDING, APPROVED, REJECTED |
| 20 | `aiNoteInsightCategoryEnum` | SUPPLY_NEED, EQUIPMENT_REPAIR, WEATHER_DELAY, CHANGE_ORDER, SAFETY, CLIENT_COMMUNICATION, OTHER |
| 21 | `aiNoteInsightSeverityEnum` | LOW, MEDIUM, HIGH, CRITICAL |
| 22 | `aiNoteInsightSourceTypeEnum` | PROJECT, COMPANY |
| 23 | `aiTaskStatusEnum` | PENDING, IN_PROGRESS, COMPLETED, DISMISSED |
| 24 | `aiTaskPriorityEnum` | CRITICAL, HIGH, MEDIUM, LOW |
| 25 | `taskSourceTypeEnum` | MANUAL, EMAIL, AI_GENERATED, SYSTEM |
| 26 | `crmOrganisationTypeEnum` | CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, OWNER_REP, RENTAL_VENDOR |
| 27 | `crmOrgStatusEnum` | ACTIVE, PREQUALIFIED, COMPLIANCE_ISSUE, INACTIVE |
| 28 | `crmContactRoleEnum` | PM, ESTIMATOR, SUPERINTENDENT, SALES, ACCOUNTS_PAYABLE, ACCOUNTS_RECEIVABLE, OWNER, GENERAL_MANAGER, FOREMAN, OTHER |
| 29 | `crmPreferredContactEnum` | EMAIL, PHONE, TEXT, OTHER |
| 30 | `crmNoteTypeEnum` | CALL, EMAIL, MEETING, HOT_LEAD, COLD_LEAD, FOLLOW_UP, ISSUE, GENERAL |
| 31 | `pricingSourceTypeEnum` | MANUAL, PRICEBOOK_IMPORT, VENDOR_PORTAL |
| 32 | `vendorEnrollmentStatusEnum` | PENDING, ACTIVE, SUSPENDED, REJECTED |
| 33 | `pricingApprovalStatusEnum` | PENDING_REVIEW, APPROVED, REJECTED, AUTO_APPROVED |
| 34 | `delayReasonEnum` | WEATHER, GC_SCHEDULING, OTHER_CONTRACTORS, MATERIAL_DELIVERY, PERMIT_ISSUES, INSPECTION_DELAY, OWNER_DIRECTIVE, DESIGN_CHANGES, SITE_CONDITIONS, LABOR_SHORTAGE, OTHER |
| 35 | `delayStatusEnum` | DRAFT, SUBMITTED, ACKNOWLEDGED, RESOLVED |
| 36 | `delayResponsibilityEnum` | OWNER, GC, SUBCONTRACTOR, TFR, FORCE_MAJEURE |
| 37 | `delayNotificationStatusEnum` | DRAFT, FINALIZED |
| 38 | `delayNotificationRecipientTypeEnum` | OWNER_REP, GC_REP, OTHER |
| 39 | `delayClaimStatusEnum` | DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CLOSED |
| 40 | `delayClaimTypeEnum` | TIME_EXTENSION, COST_IMPACT, BOTH |
| 41 | `dailyReportLockStatusEnum` | UNLOCKED, LOCKED, SUPERVISOR_LOCKED |
| 42 | `photoCustodyActionEnum` | CAPTURED, UPLOADED, VIEWED, DOWNLOADED, ATTACHED_TO_CLAIM, EXPORTED |
| 43 | `inspectionTypeEnum` | CITY_OFFICIAL, GC_REPRESENTATIVE, OWNER_REPRESENTATIVE |
| 44 | `inspectionStatusEnum` | REQUESTED, SCHEDULED, PASSED, FAILED, CANCELLED |
| 45 | `inspectionRequestMethodEnum` | CALL, EMAIL, PORTAL, OTHER |
| 46 | `tradeTypeEnum` | GENERAL_CONTRACTOR, CONCRETE, EARTHWORK, ASPHALT_PAVING, ROOFING, ELECTRICAL, PLUMBING, HVAC, CARPENTRY, MASONRY, DRYWALL, PAINTING, FLOORING, LANDSCAPING, DEMOLITION, STEEL_ERECTION, GLAZING, INSULATION, FIRE_PROTECTION, LOW_VOLTAGE, FENCING, WATERPROOFING, ENVIRONMENTAL_REMEDIATION + 30+ expanded CSI trade divisions |
| 47 | `onboardingStatusEnum` | NOT_STARTED, IN_PROGRESS, COMPLETED |
| 48 | `organizationDocumentTypeEnum` | LOGO_PRIMARY, LOGO_SECONDARY, LETTERHEAD, INSURANCE_CERT_GENERAL_LIABILITY, INSURANCE_CERT_WORKERS_COMP, INSURANCE_CERT_AUTO, INSURANCE_CERT_UMBRELLA, W9, LICENSE, BONDING_LETTER, BANKING_INFO, SAFETY_PROGRAM, COMPANY_PROFILE, TEMPLATE_OTHER |
| 49 | `organizationDocumentVisibilityEnum` | PUBLIC, INTERNAL, CONFIDENTIAL |
| 50 | `planTierEnum` | free, starter, professional, enterprise |
| 51 | `subscriptionStatusEnum` | trialing, active, past_due, canceled |
| 52 | `billingProviderEnum` | stripe, manual |
| 53 | `addonStatusEnum` | active, inactive |
| 54 | `addonKeyEnum` | ai_pm, ai_cfo, ai_email, website_seo, bid_network, ai_vision |
| 55 | `usageKeyEnum` | ai_vision_docs |
| 56 | `pricebookImportJobStatusEnum` | PENDING, PROCESSING, COMPLETED, FAILED |
| 57 | `measurementTypeEnum` | LINEAR, AREA, VOLUME, COUNT, NOTE |
| 58 | `measurementSourceEnum` | USER, AI |
| 59 | `measurementStatusEnum` | DRAFT, CONFIRMED |
| 60 | `scopeTypeEnum` | CONCRETE, EXCAVATION, PAVERS, BOLLARDS, UNDERDRAIN, BASE, BEDDING, GENERAL |
| 61 | `estimateItemCategoryEnum` | CONCRETE, EXCAVATION, PAVERS, BOLLARDS, GC, OVERHEAD, PROFIT, GENERAL |
| 62 | `stoneTypeEnum` | CRUSHED_STONE, LIMESTONE, COMPACTED_BASE, PEA_GRAVEL, RECYCLED_CONCRETE |
| 63 | `wireMeshTypeEnum` | 6X6_W1.4_W1.4, 6X6_W2.9_W2.9, 4X4_W1.4_W1.4, 4X4_W2.9_W2.9 |
| 64 | `rebarSizeEnum` | #3, #4, #5, #6 |
| 65 | `sealerTypeEnum` | CURE_AND_SEAL, PENETRATING, ACRYLIC, EPOXY |
| 66 | `underlaymentTypeEnum` | POLY_6MIL, POLY_10MIL, VAPOR_BARRIER |
| 67 | `dowelSizeEnum` | 3/4_INCH, 1_INCH, 1_1/4_INCH |
| 68 | `equipmentStatusEnum` | ACTIVE, MAINTENANCE, REPAIR, RETIRED, SOLD |
| 69 | `equipmentTypeEnum` | HEAVY_EQUIPMENT, LIGHT_EQUIPMENT, VEHICLE, TOOL, SAFETY_EQUIPMENT, SCAFFOLDING, FORMWORK, SURVEY, OTHER |
| 70 | `repairStatusEnum` | REPORTED, DIAGNOSED, IN_REPAIR, PARTS_ORDERED, COMPLETED, CANCELLED |
| 71 | `maintenanceTypeEnum` | OIL_CHANGE, FILTER_REPLACEMENT, TIRE_ROTATION, BRAKE_INSPECTION, HYDRAULIC_SERVICE, ELECTRICAL_CHECK, GENERAL_INSPECTION, CALIBRATION |
| 72 | `aiBidDocumentAnalysisStatusEnum` | PENDING, PROCESSING, COMPLETED, FAILED |
| 73 | `aiContractDocumentAnalysisStatusEnum` | PENDING, PROCESSING, COMPLETED, FAILED |
| 74 | `aiInsightModuleEnum` | SCHEDULING, DELAYS, COSTS, EQUIPMENT, VENDOR_PRICING, PROJECT_HEALTH, GANTT_CHART, LABOR, BIDS, CHANGE_ORDERS |
| 75 | `aiInsightSeverityEnum` | INFO, SUGGESTION, WARNING, CRITICAL |
| 76 | `sovStatusEnum` | DRAFT, PENDING, APPROVED, SUBMITTED, PAID, ARCHIVED |
| 77 | `websiteStatusEnum` | DRAFT, PUBLISHED, MAINTENANCE |
| 78 | `websitePageTypeEnum` | HOME, ABOUT, SERVICES, SAFETY, GALLERY, BLOG, CONTACT, CUSTOM |
| 79 | `blogPostStatusEnum` | DRAFT, PUBLISHED, ARCHIVED |
| 80 | `blogCommentStatusEnum` | PENDING, APPROVED, REJECTED, SPAM |
| 81 | `websiteProjectStatusEnum` | DRAFT, PUBLISHED, ARCHIVED |
| 82 | `socialPlatformEnum` | FACEBOOK, INSTAGRAM, LINKEDIN, TWITTER, TIKTOK, YOUTUBE |
| 83 | `emailProviderEnum` | GMAIL, OUTLOOK, IMAP |
| 84 | `emailThreadStatusEnum` | OPEN, ARCHIVED, IGNORED |
| 85 | `emailClassificationEnum` | PROJECT_UPDATE, BID_INVITE, BID_RFI, CHANGE_ORDER_REQUEST, SUBMITTAL_REQUEST, PAY_APP, INVOICE, DELAY_NOTICE, SAFETY_ISSUE, DELIVERY_NOTICE, TIME_CLOCK_ISSUE, VENDOR_PRICING, GENERAL_COMMUNICATION, SPAM_OR_IRRELEVANT, OTHER |
| 86 | `emailTaskSourceEnum` | EMAIL, MANUAL, AI_GENERATED |
| 87 | `dashboardWidgetTypeEnum` | QUICK_STATS, AI_INSIGHTS, MESSAGES, NOTIFICATIONS, CALENDAR_EVENTS, ACTIVE_PROJECTS, ACTIVE_BIDS, AI_TASKS, CREW_ASSIGNMENTS, RECENT_ACTIVITY, PROJECT_HEALTH, BUDGET_OVERVIEW |
| 88 | `hustlerLinkRequestStatusEnum` | PENDING, APPROVED, REJECTED, EXPIRED, REVOKED |
| 89 | `hustlerDelegateRoleEnum` | COO, CFO, OPERATIONS_MANAGER |
| 90 | `bidRequestStatusEnum` | DRAFT, OPEN, CLOSED, AWARDED, CANCELLED |
| 91 | `bidInvitationStatusEnum` | PENDING, VIEWED, DECLINED, RESPONDED, WITHDRAWN |
| 92 | `bidResponseStatusEnum` | DRAFT, SUBMITTED, UNDER_REVIEW, SHORTLISTED, AWARDED, NOT_SELECTED, WITHDRAWN |
| 93 | `voiceLogStatusEnum` | PENDING, TRANSCRIBED, FAILED |
| 94 | `issueSeverityEnum` | LOW, MEDIUM, HIGH, CRITICAL |
| 95 | `issueStatusEnum` | OPEN, IN_PROGRESS, RESOLVED, CLOSED |
| 96 | `offlineSyncStatusEnum` | PENDING, SYNCED, FAILED |
| 97 | `offlineOperationTypeEnum` | CREATE, UPDATE, DELETE |
| 98 | `offlineEntityTypeEnum` | TIME_ENTRY, NOTE, ISSUE, VOICE_LOG, PHOTO |
| 99 | `vendorScoreCategoryEnum` | QUALITY, TIMELINESS, COMMUNICATION, PRICING, RELIABILITY |
| 100 | `crewAvailabilityStatusEnum` | AVAILABLE, PARTIALLY_AVAILABLE, BOOKED, UNAVAILABLE |
| 101 | `rfiStatusEnum` | DRAFT, SUBMITTED, UNDER_REVIEW, ANSWERED, CLOSED |
| 102 | `rfiPriorityEnum` | LOW, MEDIUM, HIGH, URGENT |
| 103 | `transmittalStatusEnum` | DRAFT, SENT, ACKNOWLEDGED, SUPERSEDED |
| 104 | `submittalStatusEnum` | DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, APPROVED_AS_NOTED, REJECTED, REVISE_AND_RESUBMIT |
| 105 | `submittalPhaseEnum` | ESTIMATE, AWARDED, CONSTRUCTION |
| 106 | `submittalTypeEnum` | CONTRACTOR, SUBCONTRACTOR |
| 107 | `rewardTypeEnum` | BONUS, INCENTIVE, RECOGNITION, POINTS, CUSTOM |
| 108 | `portalChatThreadStatusEnum` | OPEN, CLOSED, ARCHIVED |
| 109 | `portalChatThreadCategoryEnum` | PROJECT, RFI, SUBMITTAL, TASK, GENERAL |
| 110 | `portalChatPriorityEnum` | NORMAL, URGENT |

*Note: The 133 total includes additional enums defined inline within table blocks for pay run statuses, handoff packet types, material calculator types, website component sub-types, and SOV-related statuses throughout the 7,322-line schema.*

### 3B. Tables (214 total)

#### Multi-Tenant & Organization

| # | Table | Line | Description |
|---|-------|------|-------------|
| 1 | `organizations` | 191 | Multi-tenant organization records with trade type, branding |
| 2 | `organizationSubscriptions` | 225 | Subscription plan per org (tier, billing period, status) |
| 3 | `organizationAddOns` | 245 | Add-on features per org |
| 4 | `organizationUsage` | 263 | Usage tracking per org (AI calls, storage, etc.) |
| 5 | `organizationPayrollSettings` | 284 | Payroll configuration per org |

#### Payroll & Pay Runs

| # | Table | Line | Description |
|---|-------|------|-------------|
| 6 | `weeklyPayrollReports` | 304 | Weekly payroll summaries |
| 7 | `payRuns` | 330 | Pay run records with status workflow |
| 8 | `payRunLineItems` | 358 | Individual pay run line items per employee |

#### Users & Auth

| # | Table | Line | Description |
|---|-------|------|-------------|
| 9 | `users` | 383 | User accounts with role, org, onboarding status |
| 10 | `passwordResetTokens` | 2153 | Password reset token records |

#### Projects & Bids

| # | Table | Line | Description |
|---|-------|------|-------------|
| 11 | `projects` | 414 | Construction project records with status, dates, budget |
| 12 | `bids` | 446 | Bid proposals with status, dates, amounts |
| 13 | `bidSubcontractorQuotes` | 473 | Subcontractor quotes attached to bids |
| 14 | `bidMaterialQuotes` | 498 | Material quotes attached to bids |

#### Estimates & Takeoff

| # | Table | Line | Description |
|---|-------|------|-------------|
| 15 | `estimates` | 520 | Project cost estimates |
| 16 | `estimateLineItems` | 1995 | Detailed estimate line items with quantities, rates |
| 17 | `estimateVersions` | 2106 | Estimate version history |
| 18 | `estimateVendorQuotes` | 2117 | Vendor quotes for estimates |
| 19 | `estimateHistory` | 2136 | Estimate change audit trail |
| 20 | `estimateSettings` | 1959 | Estimate configuration |
| 21 | `estimateCrews` | 1973 | Crew definitions for estimates |
| 22 | `projectPlans` | 1870 | Plan file references for takeoff |
| 23 | `quantityCategories` | 1881 | Takeoff quantity categories |
| 24 | `takeoffSheets` | 1894 | Takeoff sheet records |
| 25 | `takeoffMeasurements` | 1911 | Individual takeoff measurements |
| 26 | `projectSpecs` | 1940 | Project specification documents |
| 27 | `projectSpecIndex` | 1950 | Spec section index entries |

#### Procurement & Materials

| # | Table | Line | Description |
|---|-------|------|-------------|
| 28 | `procurementItems` | 539 | Procurement tracking items |
| 29 | `planDocuments` | 555 | Project plan document records |
| 30 | `projectMaterialBudgets` | 1139 | Material budget per scope item |
| 31 | `projectMaterialUsage` | 1176 | Actual material usage records |
| 32 | `materialCalculatorPresets` | 3510 | Calculator preset configurations |

#### Time Tracking & Labor

| # | Table | Line | Description |
|---|-------|------|-------------|
| 33 | `timeEntries` | 570 | Time tracking entries |
| 34 | `timeClockShifts` | 1524 | Time clock shift records with GPS |
| 35 | `timeClockEvents` | 1549 | Clock in/out events |
| 36 | `overtimeRequests` | 1565 | Overtime request records |
| 37 | `projectLaborRates` | 595 | Project-specific labor rates |
| 38 | `projectEmployeeRates` | 607 | Employee rate assignments |
| 39 | `jobClassifications` | 622 | Job classification definitions |
| 40 | `employeeClassifications` | 639 | Employee-to-classification mappings |
| 41 | `prevailingWageRates` | 659 | Prevailing wage rate data |
| 42 | `annualSalaryCategories` | 681 | Annual salary categories |
| 43 | `burdenRates` | 696 | Labor burden rate configuration |
| 44 | `employeeCostAssignments` | 714 | Employee cost assignments |

#### T&M (Time & Material)

| # | Table | Line | Description |
|---|-------|------|-------------|
| 45 | `tmDailySheets` | 734 | T&M daily sheet records |
| 46 | `tmInvoices` | 764 | T&M invoice records |
| 47 | `tmTickets` | 804 | T&M ticket records |
| 48 | `tmTicketLaborEntries` | 871 | T&M ticket labor line items |
| 49 | `tmTicketEquipmentEntries` | 887 | T&M ticket equipment entries |
| 50 | `tmTicketMaterialEntries` | 901 | T&M ticket material entries |
| 51 | `receipts` | 915 | Expense receipt records |

#### Notes & Communication

| # | Table | Line | Description |
|---|-------|------|-------------|
| 52 | `projectNotes` | 933 | Project-level notes |
| 53 | `companyDailyNotes` | 947 | Company-wide daily notes |
| 54 | `conversations` | 3624 | Chat conversation records |
| 55 | `conversationParticipants` | 3640 | Chat participants |
| 56 | `messages` | 3654 | Chat messages |
| 57 | `messageReadReceipts` | 3672 | Message read tracking |

#### Tasks

| # | Table | Line | Description |
|---|-------|------|-------------|
| 58 | `tasks` | 989 | Unified task model (manual, email, AI-generated, system) |

#### Scope of Work

| # | Table | Line | Description |
|---|-------|------|-------------|
| 59 | `scopeItems` | 1051 | Scope of work items per project |
| 60 | `dailyScopeProgress` | 1094 | Daily progress tracking per scope item |
| 61 | `scopeWorkTypeCategories` | 3436 | Global scope work type categories |
| 62 | `scopeWorkTypes` | 3446 | Global scope work types |
| 63 | `scopeModifierCategories` | 3463 | Global scope modifier categories |
| 64 | `scopeModifiers` | 3473 | Global scope modifiers |
| 65 | `masterModifierCategories` | 3580 | Master modifier categories |
| 66 | `masterModifiers` | 3594 | Master modifiers |

#### Media & Files

| # | Table | Line | Description |
|---|-------|------|-------------|
| 67 | `media` | 1208 | Project media files (images, videos) |
| 68 | `filePermissions` | 1483 | File access control records |
| 69 | `photoCustodyRecords` | 2663 | Photo chain of custody |

#### Change Orders

| # | Table | Line | Description |
|---|-------|------|-------------|
| 70 | `changeOrders` | 1224 | Change order records |
| 71 | `changeOrderLaborEntries` | 1256 | CO labor line items |
| 72 | `changeOrderEquipmentEntries` | 1267 | CO equipment entries |
| 73 | `changeOrderMaterialEntries` | 1279 | CO material entries |

#### Delays & Inspections

| # | Table | Line | Description |
|---|-------|------|-------------|
| 74 | `projectDelays` | 1292 | Delay records with weather/impact |
| 75 | `delayNotifications` | 1346 | Delay notification records |
| 76 | `delayClaims` | 2546 | Delay claim records |
| 77 | `projectInspections` | 1364 | Inspection records |
| 78 | `dailyReportLocks` | 2619 | Daily report lock records |

#### Calendar & Notifications

| # | Table | Line | Description |
|---|-------|------|-------------|
| 79 | `calendarEvents` | 1429 | Calendar events |
| 80 | `notifications` | 1446 | In-app notifications |
| 81 | `payrollNotifications` | 1459 | Payroll-specific notifications |

#### Audit & Billing

| # | Table | Line | Description |
|---|-------|------|-------------|
| 82 | `auditLog` | 1493 | Comprehensive audit trail |
| 83 | `billingEvents` | 1512 | Billing event records |

#### AI System

| # | Table | Line | Description |
|---|-------|------|-------------|
| 84 | `aiSettings` | 1587 | AI configuration per org |
| 85 | `aiRuns` | 1602 | AI analysis run history |
| 86 | `aiTasks` | 1618 | AI-generated tasks |
| 87 | `aiNoteInsights` | 960 | AI note analysis insights |
| 88 | `aiInsights` | 1662 | AI analytical insights |
| 89 | `aiGanttRecommendations` | 1691 | AI schedule recommendations |
| 90 | `aiVendorComparisons` | 1711 | AI vendor comparison results |
| 91 | `aiBidDocumentAnalysis` | 1730 | AI bid document analysis (Vision) |
| 92 | `aiContractDocumentAnalysis` | 1784 | AI contract document analysis |
| 93 | `aiDataQuality` | 3082 | Data quality scoring |

#### Crews & Workers

| # | Table | Line | Description |
|---|-------|------|-------------|
| 94 | `crews` | 2845 | Crew definitions |
| 95 | `crewMembers` | 2861 | Crew membership records |
| 96 | `crewProjectAssignments` | 3066 | Crew-to-project assignments |
| 97 | `skills` | 2874 | Skill definitions |
| 98 | `userSkills` | 2887 | User skill ratings (5-star) |
| 99 | `skillVerificationRequests` | 2906 | Skill verification workflow |
| 100 | `userCertifications` | 2922 | User certifications with expiry |
| 101 | `userEquipmentCompetencies` | 2944 | Equipment competency records |
| 102 | `userPhotos` | 2957 | User photo records |

#### Equipment

| # | Table | Line | Description |
|---|-------|------|-------------|
| 103 | `equipment` | 2971 | Equipment inventory |
| 104 | `equipmentAssignments` | 3744 | Equipment project assignments |
| 105 | `equipmentRepairs` | 3773 | Repair records |
| 106 | `equipmentMaintenanceSchedules` | 3816 | Maintenance schedules |
| 107 | `equipmentMaintenanceHistory` | 3849 | Maintenance history |

#### Subcontractors

| # | Table | Line | Description |
|---|-------|------|-------------|
| 108 | `subcontractors` | 3101 | Subcontractor records |
| 109 | `subcontractorContracts` | 3121 | Subcontract agreements |
| 110 | `subcontractorPayments` | 3144 | Sub payment tracking |
| 111 | `subcontractorBillingSchedule` | 3184 | Sub billing schedules |

#### CRM

| # | Table | Line | Description |
|---|-------|------|-------------|
| 112 | `crmOrganisations` | 3207 | CRM organization records |
| 113 | `crmContacts` | 3255 | CRM contact records |
| 114 | `crmOrganisationNotes` | 3285 | CRM organization notes |

#### Handoff Packets

| # | Table | Line | Description |
|---|-------|------|-------------|
| 115 | `handoffPackets` | 3355 | Project handoff packet records |

#### Equipment Extended

| # | Table | Line | Description |
|---|-------|------|-------------|
| 116 | `equipmentHourLogs` | 3879 | Equipment hour logging |
| 117 | `equipmentHourReminders` | 3911 | Equipment hour reminders |
| 118 | `equipmentRateProfiles` | 3959 | Equipment rate profiles |

#### Rental Vendors

| # | Table | Line | Description |
|---|-------|------|-------------|
| 119 | `rentalVendors` | 3994 | Rental vendor records |
| 120 | `rentalEquipmentCatalog` | 4030 | Rental equipment catalog |
| 121 | `bidEquipmentSelections` | 4078 | Bid equipment selections |
| 122 | `projectEquipmentPlans` | 4136 | Project equipment plans |
| 123 | `rentalEquipmentUsages` | 4191 | Rental equipment usage records |

#### Vendor Pricing

| # | Table | Line | Description |
|---|-------|------|-------------|
| 124 | `vendorPricingCatalogs` | 4248 | Vendor pricing catalogs |
| 125 | `vendorEnrollments` | 4304 | Vendor enrollment records |
| 126 | `vendorUsers` | 4340 | Vendor user accounts |

#### Trade & SOW Configuration

| # | Table | Line | Description |
|---|-------|------|-------------|
| 127 | `tradeTemplates` | 4365 | Trade-specific templates |
| 128 | `organizationCalculators` | 4390 | Org calculator configs |
| 129 | `organizationWorkTypes` | 4411 | Org work type overrides |
| 130 | `organizationSowItems` | 4431 | Org SOW item overrides |
| 131 | `sowAuditLog` | 4459 | SOW change audit trail |
| 132 | `organizationDocuments` | 4485 | Organization document records |
| 133 | `unitsOfMeasure` | 4519 | Unit of measure definitions |
| 134 | `masterSowItems` | 4541 | Master scope of work items |
| 135 | `masterCalculators` | 4571 | Master calculator definitions |
| 136 | `masterInspectionForms` | 4597 | Master inspection form templates |
| 137 | `tradeFeatures` | 4622 | Trade-specific feature flags |

#### AI Takeoff & Schedule

| # | Table | Line | Description |
|---|-------|------|-------------|
| 138 | `aiTakeoffAnalyses` | 4651 | AI takeoff analysis records |
| 139 | `projectSchedules` | 4685 | Project schedule records |
| 140 | `projectScheduleTasks` | 4712 | Schedule task items |
| 141 | `jobsiteAnalysisBatches` | 4752 | Jobsite camera batch records |
| 142 | `jobsiteAnalysisPhotos` | 4780 | Jobsite analysis photos |

#### Vendor Pricebooks

| # | Table | Line | Description |
|---|-------|------|-------------|
| 143 | `vendorPricebooks` | 4806 | Vendor pricebook records |
| 144 | `vendorPricebookItems` | 4833 | Pricebook line items |
| 145 | `vendorPriceHistory` | 4862 | Price change history |

#### Client Portal

| # | Table | Line | Description |
|---|-------|------|-------------|
| 146 | `clientPortalAccess` | 4882 | Client portal access tokens |
| 147 | `clientPortalActivity` | 4905 | Client portal activity log |

#### AI Change Orders & Mobile

| # | Table | Line | Description |
|---|-------|------|-------------|
| 148 | `aiCoDrafts` | 4929 | AI-generated CO drafts |
| 149 | `mobileDevices` | 4960 | Mobile device registrations |
| 150 | `mobileSyncLog` | 4983 | Mobile sync history |
| 151 | `mobilePendingUploads` | 5003 | Mobile pending upload queue |

#### Schedule of Values

| # | Table | Line | Description |
|---|-------|------|-------------|
| 152 | `scheduleOfValues` | 5027 | SOV header records |
| 153 | `sovLineItems` | 5077 | SOV line items |

#### Website Builder

| # | Table | Line | Description |
|---|-------|------|-------------|
| 154 | `organizationWebsites` | 5131 | Website configuration per org |
| 155 | `organizationWebsitePages` | 5229 | Website page records |
| 156 | `pagePreviewLinks` | 5272 | Shared preview links |
| 157 | `pageVersions` | 5291 | Page version history |
| 158 | `websiteBlogPosts` | 5313 | Blog post records |
| 159 | `websiteBlogComments` | 5368 | Blog comment records |
| 160 | `websiteProjects` | 5402 | Website project gallery items |
| 161 | `websiteProjectImages` | 5459 | Project gallery images |
| 162 | `websiteAnalyticsDaily` | 5482 | Daily analytics data |
| 163 | `websiteAnalyticsEvents` | 5519 | Analytics event records |
| 164 | `organizationSocialLinks` | 5563 | Social media links |
| 165 | `socialPostHistory` | 5590 | Social post records |
| 166 | `websiteContactSubmissions` | 5627 | Contact form submissions |

#### Email System

| # | Table | Line | Description |
|---|-------|------|-------------|
| 167 | `emailAccounts` | 5714 | Email account configurations |
| 168 | `emailThreads` | 5753 | Email thread records |
| 169 | `emailMessages` | 5792 | Email message records |
| 170 | `emailAttachments` | 5837 | Email attachment records |
| 171 | `emailTasks` | 5862 | Email-derived task records |
| 172 | `emailSummaries` | 5898 | AI email summary records |

#### Dashboard Customization

| # | Table | Line | Description |
|---|-------|------|-------------|
| 173 | `userDashboardPermissions` | 5945 | Admin dashboard permissions per user |
| 174 | `userDashboardLayouts` | 5971 | User dashboard layout configs |
| 175 | `userColorPalettes` | 5996 | Custom color scheme palettes |

#### HUSTLER Multi-Org

| # | Table | Line | Description |
|---|-------|------|-------------|
| 176 | `hustlerOrganizations` | 6055 | Multi-org ownership links |
| 177 | `hustlerLinkRequests` | 6075 | Organization link requests |
| 178 | `hustlerDelegates` | 6115 | Delegate role assignments |

#### Bid Network

| # | Table | Line | Description |
|---|-------|------|-------------|
| 179 | `organizationNetworkSettings` | 6185 | Network participation settings |
| 180 | `subcontractorBidRequests` | 6221 | GC bid request records |
| 181 | `subcontractorBidInvitations` | 6291 | Bid invitation records |
| 182 | `subcontractorBidResponses` | 6334 | Sub bid response records |
| 183 | `bidRequestClarifications` | 6396 | Bid clarification Q&A |

#### Pricebook & Vendor

| # | Table | Line | Description |
|---|-------|------|-------------|
| 184 | `pricebookImportJobs` | 6428 | Pricebook import job records |
| 185 | `vendorScores` | 6639 | Vendor scoring records |
| 186 | `materialPriceIndex` | 6676 | Material price tracking index |

#### Field Operations

| # | Table | Line | Description |
|---|-------|------|-------------|
| 187 | `voiceLogs` | 6502 | Voice log records |
| 188 | `issueCaptures` | 6542 | Issue capture records |
| 189 | `offlineSyncQueue` | 6592 | Offline sync queue |

#### Crew Marketplace

| # | Table | Line | Description |
|---|-------|------|-------------|
| 190 | `crewMarketplace` | 6716 | Crew marketplace listings |

#### RFIs, Transmittals, Submittals

| # | Table | Line | Description |
|---|-------|------|-------------|
| 150 | `rfis` | 6779 | Request for Information records |
| 151 | `rfiActivity` | 6819 | RFI activity log |
| 152 | `documentTransmittals` | 6845 | Transmittal records |
| 153 | `transmittalRecipients` | 6870 | Transmittal recipient tracking |
| 154 | `submittals` | 6900 | Submittal records |
| 155 | `submittalActivity` | 6939 | Submittal activity log |

#### Worker Ratings & Rewards

| # | Table | Line | Description |
|---|-------|------|-------------|
| 156 | `ratingCriteria` | 6962 | Rating criteria definitions |
| 157 | `employeeRatings` | 6977 | Employee rating records |
| 158 | `ratingScores` | 6995 | Individual rating scores |
| 159 | `rewardTypes` | 7008 | Reward type definitions |
| 160 | `rewardAssignments` | 7022 | Reward assignment records |

#### Portal Systems

| # | Table | Line | Description |
|---|-------|------|-------------|
| 161 | `subcontractorPortalTokens` | 7059 | Portal access tokens (bcrypt-hashed) |
| 162 | `portalActivityLog` | 7088 | Portal activity tracking |
| 163 | `bidDocumentDistributions` | 7108 | Bid document distributions |
| 164 | `portalChatThreads` | 7150 | Portal chat threads |
| 165 | `portalChatMessages` | 7175 | Portal chat messages |

#### Performance & HR

| # | Table | Line | Description |
|---|-------|------|-------------|
| 166 | `employeePerformanceProfiles` | 7207 | Performance profiles |
| 167 | `attendanceLogs` | 7222 | Attendance records |
| 168 | `safetyIncidents` | 7237 | Safety incident records |
| 169 | `qualityIssues` | 7253 | Quality issue records |
| 170 | `performanceReviews` | 7269 | Performance reviews |
| 171 | `supervisorNotes` | 7294 | Supervisor notes |
| 172 | `workerLogs` | 7308 | Worker activity logs |

*Note: The tables above enumerate 190 of the 213 pgTable definitions. The remaining ~23 tables are inline pgTable definitions for SOV draw requests, retention records, lien waivers, email sub-tables, and additional junction/linking tables that are defined within larger code blocks in the schema.*

---

## 4. Authentication & Security

### 4A. Authentication System (`server/auth.ts`)

- **JWT-based** authentication with httpOnly cookies
- **bcrypt** password hashing (cost factor default)
- **Token versioning** for session invalidation (increment to force re-login)
- **Cookie settings**: httpOnly, secure (production), sameSite: strict, 7-day expiry
- **Endpoints**: Login, Register, Logout, /api/me, Forgot Password, Reset Password
- **Impersonation**: SUPER_ADMIN can impersonate other users

**Exports:**
- `hashPassword(password)` - bcrypt hash
- `verifyPassword(password, hash)` - bcrypt compare
- `generateToken(userId, tokenVersion)` - JWT sign
- `verifyToken(token)` - JWT verify
- `authMiddleware(req, res, next)` - Global auth middleware
- `requireAuth(req, res, next)` - Route-level auth guard
- `requireRole(...roles)` - Role-based route guard
- `getEffectiveRole(user)` - Get user's effective role
- `revokeUserTokens(userId)` - Invalidate all sessions
- `setAuthCookie(res, token)` - Set JWT cookie
- `clearAuthCookie(res)` - Clear JWT cookie

### 4B. Rate Limiting (`server/rateLimiter.ts`)

| Limiter | Limit | Window | Applied To |
|---------|-------|--------|-----------|
| `authLimiter` | 5 requests | 15 minutes | Auth endpoints (login, register) |
| `sensitiveLimiter` | 10 requests | 15 minutes | Sensitive operations |
| `apiLimiter` | 100 requests | 15 minutes | All `/api/*` routes |

### 4C. Multi-Tenant Isolation (`server/orgFilter.ts`)

- `getOrgFilter(column, user)` - Returns SQL WHERE clause for org filtering
- `verifyOrgAccess(req, res, resourceOrgId)` - Verify resource belongs to user's org
- `verifyUserOrgAccess(req, res, targetUser)` - Verify user org match
- `shouldFilterByOrg(user)` - Check if org filtering is needed
- `getUserOrgId(user)` - Get user's org ID
- `isSuperAdmin(user)` - SUPER_ADMIN bypasses all org filters
- `getOrgIdForFilter(req)` - Extract org ID for query filtering

### 4D. Role-Based Access Control (`client/src/lib/rbac.ts`)

**10 User Roles:**

| # | Role | Description |
|---|------|-------------|
| 1 | `SUPER_ADMIN` | Platform-wide access, bypasses org filter |
| 2 | `ADMIN` | Full organization access |
| 3 | `MANAGER` | Project management, team oversight |
| 4 | `SUPERINTENDENT` | Field operations, progress tracking |
| 5 | `ESTIMATOR` | Bid/estimate creation and management |
| 6 | `OFFICE_MANAGER` | Administrative tasks, billing |
| 7 | `HOURLY_EMPLOYEE` | Basic access, time clock only |
| 8 | `MAINTENANCE_MANAGER` | Equipment/maintenance management |
| 9 | `VENDOR` | External vendor portal access |
| 10 | `HUSTLER` | Multi-organization owner role |

**Permission Helper Functions:**
- `isSuperAdmin(role)` - SUPER_ADMIN check
- `isAdmin(role)` - ADMIN or SUPER_ADMIN
- `isAdminOrManager(role)` - ADMIN, SUPER_ADMIN, or MANAGER
- `isOrganizationAdmin(role)` - ADMIN only
- `isVendor(role)` - VENDOR check
- `isHustler(role)` - HUSTLER check
- `isHourlyEmployee(role)` - HOURLY_EMPLOYEE check
- `isSuperintendent(role)` - SUPERINTENDENT check
- `isMaintenanceManager(role)` - MAINTENANCE_MANAGER check
- `hasContractorAccess(role)` - All roles except VENDOR, HUSTLER
- `hasManagementAccess(role)` - ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER
- `hasExtendedManagementAccess(role)` - Management + MAINTENANCE_MANAGER
- `hasEquipmentAccess(role)` - Equipment-related access
- `canAccessBids(role)` - Bid viewing access
- `canEditBids(role)` - Bid editing access
- `canDeleteBids(role)` - Bid deletion access
- `canGenerateBidPDFs(role)` - PDF generation
- `canAccessBidNetworkAsGC(role)` - GC bid network access
- `canAccessBidNetworkAsSub(role)` - Sub bid network access
- `canManageBidResponseStatus(role)` - Bid response management
- `canDeleteBidRequests(role)` - Bid request deletion
- `canEditProject(role, userId, estimatorId)` - Project editing
- `canDeleteScopeItems(role, userId, superintendentId)` - Scope deletion
- `canEditProjectHandoff(role, userId, superintendentId)` - Handoff editing
- `canCreateCrmContact(role)` - CRM contact creation
- `canCreateChangeOrder(role)` - Change order creation
- `canViewTimeApprovals(role)` - Time approval viewing
- `canApproveTime(role)` - Time approval action

**Route Permissions (RoutePermissions object):**
- USERS, AI_SETTINGS, COMPANY_SETTINGS, COST_RATES, CREWS
- SUBCONTRACTOR_PAYABLES, BIDS, BID_DETAIL
- TIME_ENTRY, TIME_CLOCK_MANAGER, AI_PM, CFO
- TM_DAILY, TM_BILLING, CRM, SCOPE_SETTINGS
- EQUIPMENT, EQUIPMENT_DETAIL, PRODUCTION_RATES
- DASHBOARD, PROJECTS, PROJECT_DETAIL, CALENDAR, TIME_CLOCK, MESSAGES
- AI_BID_ANALYSIS, AI_CONTRACT_ANALYSIS
- MANAGE_WORKERS, PAYROLL_MANAGEMENT, SCHEDULE_OF_VALUES, SUBCONTRACTS
- WEBSITE_BUILDER, PLATFORM_ADMIN, BID_NETWORK
- RENTAL_VENDORS, PRICEBOOK_IMPORT, VOICE_LOGS, ISSUE_CAPTURES

**Feature Permissions (FeaturePermissions object):**
- VIEW_BUDGET_METRICS, VIEW_FINANCIAL_KPIs
- CREATE_PROJECT, EDIT_PROJECT, VIEW_PROJECT_BUDGET, VIEW_PROJECT_FINANCIALS
- CONVERT_BID_TO_PROJECT
- VIEW_BUDGET_TAB, VIEW_ESTIMATES_TAB, VIEW_PROCUREMENT_TAB
- VIEW_RECEIPTS_TAB, VIEW_TIME_ENTRIES_TAB, VIEW_SUBCONTRACTORS_TAB

### 4E. Audit Logging (`server/auditLogger.ts`)

- All CRUD operations logged with user, action, resource, timestamp
- Actions: CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT
- IP address tracking
- Stored in `auditLog` table

### 4F. Additional Security

- **Input Sanitization** (`server/sanitization.ts`)
- **File Validation** (`server/fileValidation.ts`)
- **Object ACL** (`server/objectAcl.ts`) - File access control
- **CORS** configuration
- **Helmet-style** security headers

---

## 5. Backend Architecture

### 5A. Server Entry (`server/index.ts`)

- Express app with CORS, cookie-parser, express-session
- Auth middleware applied globally via `authMiddleware`
- Routes registered via `registerRoutes(app)`
- Vite dev server integration via `server/vite.ts`
- Binds to port 5000

### 5B. Route Registration (`server/routes.ts` line 114-232)

```
app.use(opsRoutes)                           // Health/readiness probes
app.use("/api", apiLimiter)                  // Global rate limiting
app.use("/api/change-orders", changeOrderRoutes)
app.use("/api", delayRoutes)
app.use("/api/delay-claims", delayClaimsRoutes)
app.use("/api/field-productivity", fieldProductivityRoutes)
app.use("/api/marketplace", marketplaceRoutes)
app.use(aiScheduleRoutes)
app.use("/api", inspectionRoutes)
app.use("/api", aiRoutes)
app.use("/api", notesRoutes)
app.use("/api/ai-notes", aiNotesRoutes)
app.use(taskRoutes)
app.use("/api", platformAdminRoutes)
app.use("/api/calculators", calculatorRoutes)
app.use("/api/ai-assistant", aiAssistantRoutes)
app.use("/api/ai-features", aiFeatureRoutes)
app.use("/api", organizationDocumentRoutes)
app.use("/api", aiBidDocumentRoutes)
app.use("/api", aiContractDocumentRoutes)
app.use("/api", sovRoutes)
app.use("/api", subcontractRoutes)
app.use("/api", subcontractorPayablesRoutes)
app.use("/api/website", websiteBuilderRoutes)
app.use("/api/labor-rates", laborRateRoutes)
app.use("/api/email", emailAccountRoutes)
app.use("/api/email", emailAiRoutes)
app.use("/api/dashboard", dashboardCustomizationRoutes)
app.use("/api", hustlerRoutes)
app.use("/api/bid-network", bidNetworkRoutes)
app.use("/api", rfiRoutes)
app.use("/api", transmittalRoutes)
app.use("/api", submittalRoutes)
app.use("/api", portalRoutes)
app.use("/api", portalChatRoutes)
app.use("/api/billing", billingRoutes)
app.use("/api/weather", weatherRoutes)
app.use("/api/vendor", vendorPricebookRoutes)
```

### 5C. All Route Modules (43 files)

| # | File | Path Prefix | Description |
|---|------|-------------|-------------|
| 1 | `routes.ts` | `/api/*` | Core routes (20,249 lines): auth, users, projects, bids, estimates, procurement, time entries, messaging, equipment, media, calendar, notifications, files, takeoff, scope items, production rates, daily progress, material budgets, financials, workers, conversations, subcontractor payables, data quality |
| 2 | `aiRoutes.ts` | `/api` | AI PM dashboard, analysis runs |
| 3 | `aiAssistantRoutes.ts` | `/api/ai-assistant` | AI assistant chat |
| 4 | `aiBidDocumentRoutes.ts` | `/api` | AI bid document analysis (GPT-4o Vision) |
| 5 | `aiContractDocumentRoutes.ts` | `/api` | AI contract document analysis |
| 6 | `aiFeatureRoutes.ts` | `/api/ai-features` | AI feature endpoints |
| 7 | `aiNotesRoutes.ts` | `/api/ai-notes` | AI note analysis |
| 8 | `aiScheduleRoutes.ts` | (root) | AI scheduling assistant |
| 9 | `bidNetworkRoutes.ts` | `/api/bid-network` | Bid request network system |
| 10 | `billingRoutes.ts` | `/api/billing` | Subscription/billing management |
| 11 | `calculatorRoutes.ts` | `/api/calculators` | Construction calculators |
| 12 | `changeOrderRoutes.ts` | `/api/change-orders` | Change order CRUD |
| 13 | `dashboardCustomizationRoutes.ts` | `/api/dashboard` | Dashboard customization |
| 14 | `delayRoutes.ts` | `/api` | Project delay management |
| 15 | `delayClaimsRoutes.ts` | `/api/delay-claims` | Delay claims |
| 16 | `emailAccountRoutes.ts` | `/api/email` | Email account management |
| 17 | `emailAiRoutes.ts` | `/api/email` | Email AI classification |
| 18 | `estimateRoutes.ts` | (imported inline) | Estimate management |
| 19 | `fieldProductivityRoutes.ts` | `/api/field-productivity` | Field productivity tracking |
| 20 | `hustlerRoutes.ts` | `/api` | Multi-org management |
| 21 | `inspectionRoutes.ts` | `/api` | Project inspections |
| 22 | `laborRateRoutes.ts` | `/api/labor-rates` | Labor rate management |
| 23 | `marketplaceRoutes.ts` | `/api/marketplace` | Crew marketplace |
| 24 | `notesRoutes.ts` | `/api` | Project/company notes |
| 25 | `organizationDocumentRoutes.ts` | `/api` | Org document management |
| 26 | `opsRoutes.ts` | (root) | Health/readiness probes |
| 27 | `payrollManagementRoutes.ts` | (imported inline) | Payroll management |
| 28 | `payrollSettingsRoutes.ts` | (imported inline) | Payroll settings |
| 29 | `performanceRoutes.ts` | (imported inline) | Worker performance |
| 30 | `platformAdminRoutes.ts` | `/api` | Platform admin system |
| 31 | `portalRoutes.ts` | `/api` | Subcontractor portal |
| 32 | `portalChatRoutes.ts` | `/api` | Portal chat system |
| 33 | `rfiRoutes.ts` | `/api` | RFI management |
| 34 | `sovRoutes.ts` | `/api` | Schedule of Values |
| 35 | `subcontractRoutes.ts` | `/api` | Subcontract management |
| 36 | `subcontractorPayablesRoutes.ts` | `/api` | Sub payables workflow |
| 37 | `submittalRoutes.ts` | `/api` | Submittal management |
| 38 | `taskRoutes.ts` | (root) | Task management |
| 39 | `timeClockRoutes.ts` | (imported inline) | Time clock operations |
| 40 | `tmTicketRoutes.ts` | (imported inline) | T&M ticket management |
| 41 | `transmittalRoutes.ts` | `/api` | Transmittal management |
| 42 | `vendorPricebookRoutes.ts` | `/api/vendor` | Vendor pricebook |
| 43 | `weatherRoutes.ts` | `/api/weather` | Weather integration |
| 44 | `websiteBuilderRoutes.ts` | `/api/website` | Website builder (3,550+ lines) |

### 5D. Services

| File | Purpose |
|------|---------|
| `services/emailService.ts` | Email sending via Resend + SendGrid |
| `services/featureAccess.ts` | Feature gating, entitlements, usage tracking |
| `pdf-service.ts` | PDF generation (estimates, bids, reports) |
| `sov-pdf-service.ts` | Schedule of Values PDF generation |
| `subcontract-pdf-service.ts` | Subcontract PDF generation |
| `productionRateService.ts` | Production rate calculations |
| `dataPipelineService.ts` | Data pipeline processing |
| `aiNotesService.ts` | AI note analysis processing |
| `aiNotesScheduler.ts` | Scheduled AI analysis (node-cron) |
| `materialCalculator.ts` | Material quantity calculations |
| `tradeCalculators.ts` | Trade-specific calculator logic |
| `organizationBranding.ts` | White-label branding config |
| `calculatorVerification.ts` | Calculator result verification |
| `bidNetworkNotifications.ts` | Bid network notification logic |

### 5E. Infrastructure & Utilities

| File | Purpose |
|------|---------|
| `db.ts` | PostgreSQL connection via Neon serverless |
| `storage.ts` | Storage interface (3 lines - re-export) |
| `objectStorage.ts` | Replit Object Storage / GCS integration |
| `objectAcl.ts` | File access control lists |
| `fileValidation.ts` | Upload file type/size validation |
| `fileAccessHelpers.ts` | File access utility functions |
| `sanitization.ts` | Input sanitization |
| `portalAuth.ts` | Portal token authentication |
| `auditLogger.ts` | Audit log writing |
| `seed.ts` | Database seeding |
| `seedCalculators.ts` | Calculator data seeding |
| `seedTradeExpansion.ts` | Trade expansion data seeding |
| `vite.ts` | Vite dev server integration |
| `utils/logger.ts` | Structured logging (logDebug, logInfo, logWarn, logError) |
| `utils/monitoring.ts` | Health monitoring, exception capture |

---

## 6. Frontend Architecture

### 6A. App Entry & Routing (`client/src/App.tsx`)

**60+ routes** organized into categories:

#### Public Routes (no auth required)
| Path | Component | Description |
|------|-----------|-------------|
| `/` | Landing redirect | Redirects to /dashboard or /login |
| `/login` | LoginPage | User login |
| `/register` | RegisterPage | User registration |
| `/forgot-password` | ForgotPasswordPage | Password reset request |
| `/reset-password` | ResetPasswordPage | Password reset form |
| `/impersonate` | ImpersonatePage | Admin impersonation |
| `/site/:subdomain` | PublicWebsite | Public website renderer |
| `/shared-preview/:token` | SharedPreviewPage | Shared website preview |
| `/portal/:projectId` | ClientPortalPublic | Client portal access |
| `/sub-portal` | SubPortalPage | Subcontractor portal |

#### Protected Routes (auth required)
| Path | Component | Permission |
|------|-----------|------------|
| `/onboarding` | OnboardingPage | Any authenticated (skip onboarding check) |
| `/dashboard` | DashboardPage | DASHBOARD |
| `/profile` | ProfilePage | Any authenticated |
| `/projects` | ProjectsPage | PROJECTS |
| `/projects/:code` | ProjectDetailPage | PROJECT_DETAIL |
| `/calendar` | CalendarPage | CALENDAR |
| `/communications` | CompanyCommunicationsPage | Any authenticated |
| `/tasks` | TasksPage | Any authenticated |
| `/time-clock` | TimeClockPage | TIME_CLOCK |
| `/messages` | UnifiedMessagesPage | MESSAGES |
| `/portal-chat` | UnifiedMessagesPage | MESSAGES |
| `/users` | UsersPage | USERS |
| `/ai-settings` | AISettingsPage | AI_SETTINGS |
| `/cost-rates` | CostRatesPage | COST_RATES |
| `/crews` | CrewsPage | CREWS |
| `/subcontractor-payables` | SubcontractorPayablesPage | SUBCONTRACTOR_PAYABLES |
| `/company-settings` | CompanySettingsPage | COMPANY_SETTINGS |
| `/bids/new` | BidWizardPage | BIDS |
| `/bids` | BidsPage | BIDS |
| `/bids/:code/estimate` | BidEstimate | BID_DETAIL |
| `/bids/:code` | BidDetailPage | BID_DETAIL |
| `/time-entry` | TimeEntryPage | TIME_ENTRY |
| `/tm-daily` | TMDailyPage | TM_DAILY |
| `/tm-billing` | TMBillingPage | TM_BILLING |
| `/time-clock-manager` | TimeClockManagerPage | TIME_CLOCK_MANAGER |
| `/ai-pm` | AIPMDashboard | AI_PM |
| `/cfo-dashboard` | CFODashboard | CFO |
| `/crm` | CRMPage | CRM |
| `/scope-settings` | ScopeSettings | SCOPE_SETTINGS |
| `/equipment` | EquipmentPage | EQUIPMENT |
| `/equipment/:id` | EquipmentDetailPage | EQUIPMENT_DETAIL |
| `/calculator` | CalculatorPage | Any authenticated |
| `/production-rates` | ProductionRatesPage | PRODUCTION_RATES |
| `/daily-report-locks` | DailyReportLocksPage | COMPANY_SETTINGS |
| `/delay-claims` | DelayClaimsPage | hasManagementAccess |
| `/executive-digest` | ExecutiveDigestPage | isAdminOrManager |
| `/company-health` | CompanyHealthPage | isAdminOrManager |
| `/what-if-simulator` | WhatIfSimulatorPage | isAdminOrManager |
| `/bid-inbox` | BidInboxPage | BID_NETWORK |
| `/bid-network` | BidNetworkPage | BID_NETWORK |
| `/bid-network/:id` | BidNetworkDetailPage | BID_NETWORK |
| `/pricebook-import` | PricebookImportPage | PRICEBOOK_IMPORT |
| `/rental-vendors` | RentalVendorsPage | RENTAL_VENDORS |
| `/vendor-scores` | VendorScoresPage | hasManagementAccess |
| `/voice-logs` | VoiceLogsPage | VOICE_LOGS |
| `/issue-captures` | IssueCapturesPage | ISSUE_CAPTURES |
| `/manage-workers/:id` | WorkerDetailPage | MANAGE_WORKERS |
| `/manage-workers` | ManageWorkersPage | MANAGE_WORKERS |
| `/payroll-management` | PayrollManagementPage | PAYROLL_MANAGEMENT |
| `/schedule-of-values` | ScheduleOfValuesPage | SCHEDULE_OF_VALUES |
| `/subcontracts` | SubcontractsPage | SUBCONTRACTS |
| `/rfis` | RFIsPage | SUBCONTRACTS |
| `/transmittals` | TransmittalsPage | SUBCONTRACTS |
| `/submittals` | SubmittalsPage | SUBCONTRACTS |
| `/website-builder` | WebsiteBuilderPage | WEBSITE_BUILDER |
| `/email-assistant` | EmailAssistantPage | Any authenticated |
| `/billing` | BillingPage | COMPANY_SETTINGS |
| `/ai-bid-analysis` | AIBidAnalysisPage | AI_BID_ANALYSIS |
| `/ai-contract-analysis` | AIContractAnalysisPage | AI_CONTRACT_ANALYSIS |

#### Vendor Routes
| Path | Component | Permission |
|------|-----------|------------|
| `/vendor/pricing` | VendorPortalPricing | VENDOR_PRICING |
| `/vendor/clients` | VendorClients | VENDOR_CLIENTS |
| `/vendor` | VendorDashboard | VENDOR_DASHBOARD |

#### Platform Admin Routes
| Path | Component | Permission |
|------|-----------|------------|
| `/admin` | PlatformAdminDashboard | PLATFORM_ADMIN |
| `/admin/organizations/:id` | PlatformOrganizationDetail | PLATFORM_ADMIN |
| `/admin/organizations` | PlatformOrganizations | PLATFORM_ADMIN |
| `/admin/analytics` | PlatformAnalytics | PLATFORM_ADMIN |
| `/admin/support` | PlatformSupportTools | PLATFORM_ADMIN |
| `/admin/audit` | PlatformAuditDashboard | PLATFORM_ADMIN |

#### HUSTLER Routes
| Path | Component | Permission |
|------|-----------|------------|
| `/hustler/inbox` | HustlerUnifiedInbox | HUSTLER role |
| `/hustler/benchmarking` | HustlerBenchmarking | HUSTLER role |
| `/hustler/org/:orgId` | HustlerOrgDetail | HUSTLER role |
| `/hustler` | HustlerDashboard | HUSTLER role |

### 6B. All Pages (`client/src/pages/`) — 70+ files

| File | Component | Description |
|------|-----------|-------------|
| `ai-bid-analysis.tsx` | AIBidAnalysisPage | AI bid document analysis with Vision |
| `ai-contract-analysis.tsx` | AIContractAnalysisPage | AI contract document analysis |
| `ai-pm-dashboard.tsx` | AIPMDashboard | AI Project Manager dashboard |
| `ai-settings.tsx` | AISettingsPage | AI configuration settings |
| `bid-detail.tsx` | BidDetailPage | Individual bid detail view |
| `bid-estimate.tsx` | BidEstimate | Bid estimate builder |
| `bid-inbox.tsx` | BidInboxPage | Bid inbox management |
| `bid-network-detail.tsx` | BidNetworkDetailPage | Bid network request detail |
| `bid-network.tsx` | BidNetworkPage | Bid network listing |
| `bids.tsx` | BidsPage | Bids listing page |
| `bid-wizard.tsx` | BidWizardPage | Multi-step AI bid creation |
| `billing.tsx` | BillingPage | Subscription billing management |
| `calculator.tsx` | CalculatorPage | Construction calculator suite (13 tools) |
| `calendar.tsx` | CalendarPage | Calendar management |
| `cfo-dashboard.tsx` | CFODashboard | CFO analytics dashboard |
| `client-portal-public.tsx` | ClientPortalPublic | Public client portal |
| `company-communications.tsx` | CompanyCommunicationsPage | Company bulletins |
| `company-health.tsx` | CompanyHealthPage | Company health metrics |
| `company-settings.tsx` | CompanySettings | Organization settings |
| `cost-rates.tsx` | CostRatesPage | Labor cost rate management |
| `crew-marketplace.tsx` | CrewMarketplacePage | Crew marketplace listings |
| `crews.tsx` | CrewsPage | Crew management |
| `crm.tsx` | CRMPage | CRM system |
| `daily-report-locks.tsx` | DailyReportLocksPage | Daily report lock management |
| `dashboard.tsx` | DashboardPage | Main dashboard (customizable) |
| `delay-claims.tsx` | DelayClaimsPage | Delay claims management |
| `email-assistant.tsx` | EmailAssistantPage | Email AI assistant |
| `equipment-detail.tsx` | EquipmentDetailPage | Equipment detail view |
| `equipment.tsx` | EquipmentPage | Equipment management |
| `executive-digest.tsx` | ExecutiveDigestPage | Executive summary digest |
| `forgot-password.tsx` | ForgotPasswordPage | Password reset request |
| `hustler-benchmarking.tsx` | HustlerBenchmarking | Multi-org benchmarking |
| `hustler-dashboard.tsx` | HustlerDashboard | Hustler main dashboard |
| `hustler-org-detail.tsx` | HustlerOrgDetail | Org detail for hustler |
| `hustler-unified-inbox.tsx` | HustlerUnifiedInbox | Hustler unified inbox |
| `impersonate.tsx` | ImpersonatePage | User impersonation |
| `issue-captures.tsx` | IssueCapturesPage | Issue capture system |
| `landing.tsx` | LandingPage | Marketing landing page |
| `login.tsx` | LoginPage | Login page |
| `manage-workers.tsx` | ManageWorkersPage | Worker management (tabs: Workers, Ratings, Rewards, Analytics) |
| `not-found.tsx` | NotFound | 404 page |
| `onboarding.tsx` | OnboardingPage | AI-guided onboarding |
| `payroll-management.tsx` | PayrollManagementPage | Payroll (5 tabs: Overview, Time Entries, Workers, Pay Runs, Archived) |
| `PlatformAdminDashboard.tsx` | PlatformAdminDashboard | Platform admin dashboard |
| `PlatformAnalytics.tsx` | PlatformAnalytics | Platform analytics |
| `PlatformAuditDashboard.tsx` | PlatformAuditDashboard | Platform audit dashboard |
| `PlatformOrganizationDetail.tsx` | PlatformOrganizationDetail | Org detail (admin) |
| `PlatformOrganizations.tsx` | PlatformOrganizations | Org listing (admin) |
| `PlatformSupportTools.tsx` | PlatformSupportTools | Support tools (admin) |
| `portal-chat.tsx` | PortalChatContent | Portal chat content |
| `pricebook-import.tsx` | PricebookImportPage | Pricebook import |
| `production-rates.tsx` | ProductionRatesPage | Production rate tracking |
| `profile.tsx` | ProfilePage | User profile (info, skills, certs, performance) |
| `project-detail.tsx` | ProjectDetailPage | Project detail (multi-tab, 1,956 lines) |
| `projects.tsx` | ProjectsPage | Projects listing |
| `public-website.tsx` | PublicWebsite | Public website renderer |
| `register.tsx` | RegisterPage | Registration page |
| `rental-vendors.tsx` | RentalVendorsPage | Rental vendor management |
| `reset-password.tsx` | ResetPasswordPage | Password reset form |
| `rfis.tsx` | RFIsPage | RFI management |
| `schedule-of-values.tsx` | ScheduleOfValuesPage | SOV management |
| `scope-settings.tsx` | ScopeSettings | Scope settings |
| `shared-preview.tsx` | SharedPreviewPage | Shared website preview |
| `subcontractor-payables.tsx` | SubcontractorPayablesPage | Sub payables |
| `subcontracts.tsx` | SubcontractsPage | Subcontract management |
| `submittals.tsx` | SubmittalsPage | Submittal management |
| `sub-portal.tsx` | SubPortalPage | Subcontractor portal |
| `tasks.tsx` | Tasks | Task management |
| `time-clock-manager.tsx` | TimeClockManagerPage | Time clock manager view |
| `time-clock.tsx` | TimeClockPage | Employee time clock |
| `time-entry.tsx` | TimeEntryPage | Time entry wrapper |
| `time-log-tab.tsx` | TimeLogTab | Time log tab |
| `tm-billing.tsx` | TMBillingPage | T&M billing |
| `tm-daily.tsx` | TMDailyPage | T&M daily sheets |
| `transmittals.tsx` | TransmittalsPage | Transmittal management |
| `unified-messages.tsx` | UnifiedMessagesPage | Unified messaging |
| `users.tsx` | UsersPage | User management |
| `vendor-pricing.tsx` | VendorPricingPage | Vendor pricing |
| `vendor-scores.tsx` | VendorScoresPage | Vendor scoring |
| `voice-logs.tsx` | VoiceLogsPage | Voice log management |
| `website-builder.tsx` | WebsiteBuilderPage | Website builder |
| `what-if-simulator.tsx` | WhatIfSimulatorPage | What-if financial simulator |
| `worker-detail.tsx` | WorkerDetailPage | Worker detail view |

### 6C. Custom Components (`client/src/components/`) — 81 files

| Component | Description |
|-----------|-------------|
| `ActualMaterialsInput.tsx` | Material actual quantity input |
| `AIAnalysisButton.tsx` | Trigger AI analysis |
| `AIAssistantWidget.tsx` | Floating AI chat assistant |
| `AiChangeOrderGenerator.tsx` | AI change order generation |
| `AIInsights.tsx` | AI insights display |
| `AIInsightsWidget.tsx` | AI insights dashboard widget |
| `AiJobsiteAnalysis.tsx` | AI jobsite camera analysis |
| `AiSchedulingPanel.tsx` | AI scheduling panel |
| `AISowAssistantDialog.tsx` | AI scope of work assistant |
| `AiTakeoffPanel.tsx` | AI takeoff panel |
| `AIUomAssistantDialog.tsx` | AI unit of measure assistant |
| `AppHeader.tsx` | Application header bar |
| `AppSidebar.tsx` | Main sidebar navigation |
| `BidCard.tsx` | Bid display card |
| `BidDocumentDistribution.tsx` | Bid document distribution manager |
| `branding-color-picker.tsx` | White-label branding color picker |
| `ChangeOrderDialog.tsx` | Change order creation/edit dialog |
| `ChangeOrderFiles.tsx` | Change order file attachments |
| `ChangeOrderFileUploader.tsx` | Change order file upload |
| `ClientPortal.tsx` | Client portal management component |
| `CostCodeCombobox.tsx` | CSI cost code selector (combobox) |
| `CrmOrganizationSelector.tsx` | CRM organization selector |
| `DailyNoteFeed.tsx` | Daily notes feed display |
| `DashboardEditMode.tsx` | Dashboard edit/customize mode |
| `DelaysSection.tsx` | Project delays section |
| `DocumentAttachments.tsx` | Document attachment manager |
| `EquipmentRateSelector.tsx` | Equipment rate selector |
| `FeatureGate.tsx` | Feature gating wrapper component |
| `FileUploadZone.tsx` | Drag-and-drop file upload |
| `FirstTimeWelcomeModal.tsx` | First-time welcome modal |
| `HierarchicalLineItemBuilder.tsx` | Progressive line item builder |
| `InspectionsSection.tsx` | Inspections display section |
| `JobInformationForm.tsx` | Job information form |
| `KPICard.tsx` | KPI metric display card |
| `LaborRateSelector.tsx` | Labor rate selector |
| `LoginForm.tsx` | Login form component |
| `ManualMaterialPricing.tsx` | Manual material pricing input |
| `MaterialBudgetTracker.tsx` | Material budget tracking widget |
| `MaterialCalculator.tsx` | Material calculator component |
| `MediaGallery.tsx` | Photo/video media gallery |
| `media-library.tsx` | Website builder media library |
| `MobileSyncStatus.tsx` | Offline/mobile sync status |
| `ObjectUploader.tsx` | Object storage uploader (Uppy) |
| `OrganizationSwitcher.tsx` | Multi-org switcher (Hustler) |
| `page-editor.tsx` | Website page editor |
| `PerformanceHistoryTab.tsx` | Worker performance history tab |
| `PlanSelectionStep.tsx` | Onboarding plan selection step |
| `ProjectCard.tsx` | Project display card |
| `ProjectEstimate.tsx` | Project estimate viewer |
| `ProjectLaborHours.tsx` | Project labor hours display |
| `ProjectRFIs.tsx` | Project RFI list |
| `ProjectsTable.tsx` | Projects data table |
| `ProjectSubmittals.tsx` | Project submittal list |
| `ProjectTransmittals.tsx` | Project transmittal list |
| `RegisterForm.tsx` | Registration form component |
| `ScopeItemProgressRow.tsx` | Scope item progress row |
| `ScopeOfWorkTable.tsx` | Scope of work data table |
| `ScopeProgressTracker.tsx` | Scope progress tracker widget |
| `SkillsCertificationsTab.tsx` | Skills & certifications tab |
| `StandardizedScopeSelector.tsx` | Standardized scope selector |
| `StatusBadge.tsx` | Status badge component |
| `SubcontractorPortalManager.tsx` | Sub portal management |
| `SubcontractorScopeReport.tsx` | Sub scope report |
| `TakeoffWorkspace.tsx` | Interactive takeoff drawing workspace (Konva) |
| `text-style-editor.tsx` | Rich text style editor |
| `ThemePicker.tsx` | Theme color picker |
| `ThemeToggle.tsx` | Dark/light mode toggle |
| `TimeEntryContent.tsx` | Full time entry content (tabbed) |
| `TimeEntryForm.tsx` | Time entry form |
| `TMDailyForm.tsx` | T&M daily sheet form |
| `TMTicketsSection.tsx` | T&M tickets section |
| `TopHeader.tsx` | Top header bar |
| `TourProvider.tsx` | Onboarding tour provider (react-joyride) |
| `UomSelect.tsx` | Unit of measure selector |
| `VendorPricebookUpload.tsx` | Vendor pricebook file upload |
| `VendorPricingSync.tsx` | Vendor pricing sync |
| `WeatherEvidenceCard.tsx` | Weather evidence card for delays |
| `WeatherForecastWidget.tsx` | Weather forecast widget |
| `website-body-components.tsx` | Website builder body components |
| `website-components-tab.tsx` | Website builder components tab |
| `website-preview-renderer.tsx` | Website preview renderer |

### 6D. Calculator Components (`client/src/components/calculators/`) — 13 tools

| Calculator | Description |
|-----------|-------------|
| `AggregatesCalculator.tsx` | Aggregates/gravel volume calculator |
| `DrywallCalculator.tsx` | Drywall sheets calculator |
| `GeometryCalculator.tsx` | Area/volume geometry calculator |
| `LaborCostEstimator.tsx` | Labor cost estimation |
| `LumberCalculator.tsx` | Lumber board-feet calculator |
| `MarkupCalculator.tsx` | Markup/margin calculator |
| `MasonryCalculator.tsx` | Masonry block/brick calculator |
| `MaterialEstimatorCalculator.tsx` | General material estimator |
| `PaintCalculator.tsx` | Paint coverage calculator |
| `ProfitMarginCalculator.tsx` | Profit margin analysis |
| `RoofingCalculator.tsx` | Roofing material calculator |
| `TilingCalculator.tsx` | Tile quantity calculator |
| `UnitConverter.tsx` | Construction unit converter |

### 6E. shadcn/ui Components (`client/src/components/ui/`) — 49 components

accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, date-picker, date-time-picker, dialog, drawer, dropdown-menu, form, hover-card, input-otp, input, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, switch, table, tabs, textarea, toaster, toast, toggle-group, toggle, tooltip

### 6F. Hooks (`client/src/hooks/`) — 6 hooks

| Hook | Description |
|------|-------------|
| `use-auth.tsx` | Authentication state, login, logout, register |
| `use-dashboard-customization.tsx` | Dashboard layout/widget customization |
| `use-data.ts` | Data fetching utilities |
| `use-mobile.tsx` | Mobile viewport detection |
| `use-toast.ts` | Toast notification management |
| `useEntitlements.ts` | Feature entitlement checking |

### 6G. Libraries (`client/src/lib/`) — 4 files

| File | Description |
|------|-------------|
| `queryClient.ts` | TanStack Query client with default fetcher |
| `rbac.ts` | Role-based access control (permissions, navigation) |
| `utils.ts` | Utility functions (cn, formatting) |
| `notificationDestination.ts` | Notification routing logic |

---

## 7. Sidebar Navigation Structure

Defined in `client/src/lib/rbac.ts` → `NavigationConfig` object:

### Menu Sections

1. **Projects Menu** (`projectsMenu`)
   - Projects
   - CRM
   - Scope Settings

2. **Time Clock Menu** (`timeClockMenu`)
   - My Time Clock
   - Manage Time Clock
   - T&M Daily Sheets

3. **Operations Menu** (`operationsMenu`)
   - Equipment
   - Subcontracts
   - RFIs
   - Transmittals
   - Submittals
   - Rental Vendors

4. **Preconstruction Menu** (`preconstructionMenu`)
   - Bids
   - Bid Wizard
   - Calculator
   - Bid Network
   - Bid Inbox

5. **Financials Menu** (`financialsMenu`)
   - Schedule of Values
   - Payroll Management
   - Estimates
   - Cost Rates
   - Production Rates
   - Subcontractor Payables
   - T&M Billing
   - CFO Dashboard

6. **Insights Menu** (`insightsMenu`)
   - AI PM Dashboard
   - Executive Digest
   - Company Health
   - What-If Simulator
   - AI Bid Analysis
   - AI Contract Analysis
   - Vendor Scores
   - Pricebook Import

7. **Administration Menu** (`administrationMenu`)
   - Users
   - Company Settings
   - AI Settings
   - Billing
   - Daily Report Locks
   - Scope Settings

8. **Tools Menu** (`toolsMenu`)
   - Calculator
   - Voice Logs
   - Issue Captures
   - Website Builder
   - Email Assistant

---

## 8. Subscription & Billing System

**Config**: `shared/billing/plans.ts`

### Plan Tiers

| Tier | DB Value | Display Name | Price | Target Revenue |
|------|----------|-------------|-------|----------------|
| Trial | `free` | Trial | $0/mo | Evaluation |
| Starter | `starter` | Starter | $89/mo | Under $500k |
| Growth | `professional` | Growth | $229/mo | $500k-$2M |
| Scale | `enterprise` | Scale | $579/mo | $2M-$10M |
| Hustler | `enterprise` + flag | Hustler | $1,199/mo | Multi-company |

### Add-Ons (6 total)

| Key | Feature | Description |
|-----|---------|-------------|
| `ai_pm` | AI_PM | AI Project Manager |
| `ai_cfo` | AI_CFO | AI CFO Analytics |
| `ai_email` | AI_EMAIL | AI Email Assistant |
| `website_seo` | WEBSITE_SEO | Website & SEO Tools |
| `bid_network` | BID_NETWORK | Bid Network Access |
| `ai_vision` | AI_VISION | AI Vision (Takeoff/Camera) |

### Feature Gating Implementation

- **Backend**: `server/services/featureAccess.ts`
  - `getOrgEntitlements(orgId)` - Get all features for org
  - `hasFeature(orgId, feature)` - Check specific feature
  - `getUsage(orgId, feature)` - Get usage count
  - `incrementUsage(orgId, feature)` - Increment usage
  - `isWithinUsageLimit(orgId, feature)` - Check usage limits
  - `isDevMode()` - Dev mode override
- **Frontend**: `FeatureGate` component wraps feature-gated UI
- **Frontend**: `useEntitlements` hook for programmatic checks

---

## 9. AI System

### AI Modules & Capabilities

| Module | Route/Component | Description |
|--------|----------------|-------------|
| AI Senior PM | `aiRoutes.ts`, `ai-pm-dashboard.tsx` | Project health analysis, risk assessment |
| AI CFO | `cfo-dashboard.tsx` | Financial analysis, forecasting |
| AI Auto-Takeoff | `aiBidDocumentRoutes.ts`, `AiTakeoffPanel.tsx` | OpenAI Vision for document analysis |
| AI Scheduling | `aiScheduleRoutes.ts`, `AiSchedulingPanel.tsx` | Schedule optimization |
| AI Jobsite Camera | `AiJobsiteAnalysis.tsx` | Jobsite photo analysis |
| AI Change Orders | `AiChangeOrderGenerator.tsx` | Automated CO generation |
| AI Note Analysis | `aiNotesService.ts`, `aiNotesScheduler.ts` | Automated note insight extraction |
| AI SOW Assistant | `AISowAssistantDialog.tsx` | Scope of work recommendations |
| AI UOM Assistant | `AIUomAssistantDialog.tsx` | Unit of measure recommendations |
| AI Data Quality | `aiDataQuality` table | Data completeness scoring |
| AI Vendor Compare | `aiVendorComparisons` table | Vendor comparison analysis |
| AI Gantt | `aiGanttRecommendations` table | Schedule recommendations |
| AI Email | `emailAiRoutes.ts` | Email classification (15 categories) |
| AI Website Wizard | `websiteBuilderRoutes.ts` | Generate entire website structures |
| AI Bid Wizard | `bid-wizard.tsx`, `aiBidDocumentAnalysis` | Multi-step AI bid creation |
| AI Contract Analysis | `aiContractDocumentRoutes.ts` | Contract document analysis |
| AI Onboarding | `TourProvider.tsx`, react-joyride | Guided onboarding walkthroughs |
| AI Insights Widget | `AIInsightsWidget.tsx` | Dashboard AI insights |
| AI Assistant Chat | `aiAssistantRoutes.ts`, `AIAssistantWidget.tsx` | General AI assistant |

### AI Infrastructure

- OpenAI GPT-4 / GPT-4o integration via `openai` npm package
- AI settings per organization (`aiSettings` table)
- AI run history tracking (`aiRuns` table)
- AI-generated tasks integration (`aiTasks` table)
- Scheduled analysis via `node-cron` (`aiNotesScheduler.ts`)
- Usage tracking and limits via feature access service

---

## 10. Shared Libraries & Calculations

### Calculation Modules (`shared/calculations/`)

| File | Purpose |
|------|---------|
| `bidCalculations.ts` | Bid cost calculations, markup, margin |
| `bidCalculations.test.ts` | Bid calculation tests |
| `productionRates.ts` | Production rate formulas |
| `productionRates.test.ts` | Production rate tests |
| `projectFinancials.ts` | Project financial calculations |
| `projectFinancials.test.ts` | Financial calculation tests |

### Shared Utilities

| File | Purpose |
|------|---------|
| `tradeTypeUtils.ts` | 23 trade type definitions and utilities |
| `tradeTypeUtils.test.ts` | Trade type tests |
| `costCodes.ts` | CSI-based cost code definitions for 23 trades |
| `utils/geometry.ts` | Area, volume, perimeter calculations |

### 23 Trade Types

The platform supports trade-specific templates for:
General Contractor, Electrical, Plumbing, HVAC, Concrete, Masonry, Roofing, Painting, Flooring, Landscaping, Demolition, Steel/Iron, Carpentry, Drywall, Insulation, Fire Protection, Elevator, Glazing, Waterproofing, Excavation/Sitework, Fencing, Paving, Solar/Renewable Energy

---

## 11. Portal Systems

### 11A. Subcontractor Portal (`server/portalRoutes.ts`, `server/portalAuth.ts`)

- **Token-based access** with bcrypt-hashed tokens
- **Scoped permissions** per project (view RFIs, submittals, transmittals)
- **Activity logging** via `portalActivityLog` table
- **Email invitations** for portal access
- **Bid-phase document distribution** via `bidDocumentDistributions` table
- **Frontend**: `sub-portal.tsx`, `SubcontractorPortalManager.tsx`

### 11B. Client Portal (`client-portal-public.tsx`, `ClientPortal.tsx`)

- **Project-specific** portal access
- **Document viewing** and status tracking
- **Public URL** at `/portal/:projectId`

### 11C. Portal Chat System (`server/portalChatRoutes.ts`)

- **Asynchronous chat** between portal users and internal team
- **Dual authentication**: Portal tokens + JWT
- **Conversation threads** with subjects and categories
- **Internal notes** for team-only communication
- **Priority flags**: NORMAL, URGENT
- **Status management**: OPEN, CLOSED, ARCHIVED
- **Unread tracking** and email notifications
- **Categories**: PROJECT, RFI, SUBMITTAL, TASK, GENERAL

---

## 12. Vendor System

| Feature | Route/Page | Description |
|---------|-----------|-------------|
| Vendor Dashboard | `/vendor` | Main vendor interface |
| Vendor Pricing Portal | `/vendor/pricing` | Manage pricing/pricebooks |
| Vendor Clients | `/vendor/clients` | View client organizations |
| Pricebook Upload | `VendorPricebookUpload.tsx` | Upload pricebook data |
| Vendor Scoring | `vendor-scores.tsx` | Score vendors on 5 categories |
| Rental Vendors | `rental-vendors.tsx` | Rental equipment vendor management |
| Pricebook Import | `pricebook-import.tsx` | Import pricebook data |

---

## 13. HUSTLER Multi-Org System

| Feature | Component/Route | Description |
|---------|----------------|-------------|
| Dashboard | `hustler-dashboard.tsx` | Multi-org executive overview |
| Org Switcher | `OrganizationSwitcher.tsx` | Switch between managed orgs |
| Benchmarking | `hustler-benchmarking.tsx` | Cross-org performance comparison |
| Unified Inbox | `hustler-unified-inbox.tsx` | Aggregated notifications |
| Org Detail | `hustler-org-detail.tsx` | Individual org deep-dive |
| Delegates | `hustlerDelegates` table | COO, CFO, OPERATIONS_MANAGER delegation |
| Link Requests | `hustlerLinkRequests` table | Request/approve org linkage |

---

## 14. Platform Admin System

| Feature | Page | Description |
|---------|------|-------------|
| Admin Dashboard | `PlatformAdminDashboard.tsx` | Platform-wide overview |
| Organizations | `PlatformOrganizations.tsx` | Manage all organizations |
| Org Detail | `PlatformOrganizationDetail.tsx` | Individual org management |
| Analytics | `PlatformAnalytics.tsx` | Platform usage analytics |
| Support Tools | `PlatformSupportTools.tsx` | Support & debugging tools |
| Audit Dashboard | `PlatformAuditDashboard.tsx` | Platform-wide audit logs |

---

## 15. External Integrations

| Service | Package | Usage |
|---------|---------|-------|
| OpenAI GPT-4/GPT-4o | `openai` ^6.14.0 | All AI features including Vision |
| Resend | `resend` ^6.9.1 | Primary transactional email |
| SendGrid | `@sendgrid/mail` ^8.1.3 | Backup email delivery |
| PostgreSQL (Neon) | `@neondatabase/serverless` ^0.10.4 | Database |
| Google Cloud Storage | `@google-cloud/storage` ^7.17.3 | File storage (via Replit Object Storage) |
| Weather API | Custom integration | Weather data for delays |

---

## 16. File Structure Summary

```
/
├── client/src/
│   ├── App.tsx                    # Main app with 60+ routes
│   ├── index.css                  # Global styles + CSS variables
│   ├── override-style.css         # Style overrides
│   ├── uppy-core.css              # Uppy uploader styles
│   ├── uppy-dashboard.css         # Uppy dashboard styles
│   ├── components/                # 81 custom components
│   │   ├── ui/                    # 49 shadcn/ui components
│   │   ├── calculators/           # 13 calculator components
│   │   └── examples/              # Example/reference components
│   ├── hooks/                     # 6 custom hooks
│   ├── lib/                       # 4 utility/config files
│   └── pages/                     # 70+ page components
├── server/
│   ├── index.ts                   # Express server entry
│   ├── routes.ts                  # 20,249 lines - core routes
│   ├── auth.ts                    # JWT authentication
│   ├── db.ts                      # Database connection
│   ├── storage.ts                 # Storage interface
│   ├── orgFilter.ts               # Multi-tenant isolation
│   ├── rateLimiter.ts             # Rate limiting
│   ├── auditLogger.ts             # Audit logging
│   ├── sanitization.ts            # Input sanitization
│   ├── fileValidation.ts          # File upload validation
│   ├── objectStorage.ts           # Object storage
│   ├── objectAcl.ts               # File ACL
│   ├── portalAuth.ts              # Portal authentication
│   ├── vite.ts                    # Vite dev server
│   ├── seed.ts                    # DB seeding
│   ├── seedCalculators.ts         # Calculator seeding
│   ├── seedTradeExpansion.ts      # Trade data seeding
│   ├── 30+ route modules          # Modular route files
│   ├── services/
│   │   ├── emailService.ts        # Email (Resend/SendGrid)
│   │   └── featureAccess.ts       # Feature gating
│   └── utils/
│       ├── logger.ts              # Structured logging
│       └── monitoring.ts          # Health monitoring
├── shared/
│   ├── schema.ts                  # 7,322 lines - full DB schema
│   ├── billing/plans.ts           # Subscription plans config
│   ├── costCodes.ts               # CSI cost codes (23 trades)
│   ├── tradeTypeUtils.ts          # Trade type utilities
│   ├── calculations/
│   │   ├── bidCalculations.ts     # Bid cost calculations
│   │   ├── productionRates.ts     # Production rates
│   │   └── projectFinancials.ts   # Financial calculations
│   └── utils/geometry.ts          # Geometry calculations
├── audit/                         # Automated audit test suite
│   ├── index.ts
│   ├── runner.ts
│   ├── types.ts
│   ├── utils/
│   ├── tests/
│   └── reports/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
├── vitest.config.ts
├── postcss.config.js
├── components.json                # shadcn/ui config
└── FULL_CODE_AUDIT.md             # This file
```

---

## 17. Codebase Metrics

| Metric | Count |
|--------|-------|
| Schema file lines | 7,322 |
| Database tables | 213 |
| Database enums | 133 |
| Main routes.ts lines | 20,249 |
| Total route modules | 43+ files |
| Frontend pages | 70+ |
| Custom components | 81 |
| Calculator components | 13 |
| shadcn/ui components | 49 |
| Custom hooks | 6 |
| User roles | 10 |
| Trade types | 23 |
| Subscription tiers | 4 (+Hustler) |
| Add-ons | 6 |
| AI modules | 17+ |
| NPM dependencies | 90+ |
| Frontend routes | 60+ |
| Backend services | 14 |
| Email classification categories | 15 |
| Dashboard widget types | 12 |
| Social platforms supported | 6 |

---

*End of Full Code Audit*
